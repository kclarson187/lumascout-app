"""
routes/account_deletion.py — App Store-compliant self-service account deletion
══════════════════════════════════════════════════════════════════════════════

Apple App Store Guideline 5.1.1(v) requires apps that allow account creation
to also allow in-app account deletion. This route exposes that flow.

Endpoint
────────
DELETE /api/account/delete

  • Auth required (JWT). Unauthenticated → 401.
  • Idempotent: re-deletion after the user doc is already gone returns
    200 with `success: true` instead of 404. Once an account is deleted,
    its JWT is rejected by `get_current_user` (deleted/status checks) so
    a second-tap from a cached token can't even reach this handler — but
    if it ever does, we return success.

What gets deleted
─────────────────
• User row from `users` (PII archived to `deleted_users` first).
• Push tokens, weather alert subscriptions, notifications, follows,
  spot_saves, poll_votes, post_likes/reactions, post_comments, group
  memberships, spot_reviews, spot_checkins, shoot_plans, edit_requests,
  profile_views (in either direction), dm_participants, blocks, requests.
• `collections` owned by the user where privacy_mode != "public".
• Spots owned by the user that are NOT approved-public (drafts /
  pending / rejected / private / hidden / flagged) — hard-deleted.

What is preserved (per product rule)
─────────────────────────────────────
Approved public spots remain visible to the community, anonymized:
  • spot.owner_user_id stays (for foreign-key compatibility on internal
    moderation tooling) BUT spot.creator_anonymized=true is set.
  • spot.creator_display_name = "LumaScout user"
  • spot.creator_avatar_url    = null
  • All public read paths (spot detail, public shared link, explore
    cards) substitute the anonymized placeholder when this flag is
    present OR when the owner lookup returns None.

Stripe handling
───────────────
If the user has an active Stripe subscription, we issue
Subscription.delete() best-effort. Errors are swallowed (logged) so
the user-facing delete always completes — they can't be trapped on
the platform by a failed Stripe call.

Defensive logging
─────────────────
Every operation is logged at INFO with the user_id only — never the
email, name, push tokens, or Stripe secrets.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from server import (
    db,
    get_current_user,
    utcnow,
    audit_log,
)

log = logging.getLogger("lumascout.account_deletion")

router = APIRouter(prefix="/api", tags=["account"])


# ─────────────────────────────────────────────────────────────────────
# Constants — placeholder identity for anonymized public content
# ─────────────────────────────────────────────────────────────────────
ANON_DISPLAY_NAME = "LumaScout user"
ANON_AVATAR_URL = None
ANON_USERNAME = None  # never expose any reference back to the deleted user


def anonymized_owner_placeholder() -> Dict[str, Any]:
    """The owner object that public API responses should substitute when
    a spot/collection/post was created by a now-deleted account.

    Shape matches the contract that frontend code reads (name / username /
    avatar_url) so existing components render without conditional logic.
    """
    return {
        "user_id":     None,
        "name":        ANON_DISPLAY_NAME,
        "username":    ANON_USERNAME,
        "avatar_url":  ANON_AVATAR_URL,
        "bio":         None,
        "deleted":     True,
        # Fields that the frontend may try to read — explicit None values
        # so JS-side `?.` chains don't surprise with undefined.
        "instagram":   None,
        "website":     None,
        "city":        None,
        "state":       None,
        "specialties": [],
        "plan":        None,
        "role":        None,
    }


# ─────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────
@router.delete("/account/delete")
async def delete_my_account(user: dict = Depends(get_current_user)):
    """Self-service account deletion. See module docstring for full
    behavior. Returns `{success: True, message: ...}` on success."""
    user_id: str = user["user_id"]
    log.info("account_delete_start user_id=%s", user_id)

    # ─── 0. Idempotency guard ────────────────────────────────────────
    # `get_current_user` already 401s deleted users, so we only get here
    # for live accounts. Belt-and-suspenders re-check in case a race
    # delivered us here twice.
    live = await db.users.find_one({"user_id": user_id})
    if not live or live.get("deleted") or live.get("status") == "deleted":
        log.info("account_delete_idempotent user_id=%s already_gone=%s", user_id, live is None)
        return {
            "success": True,
            "message": "Account deletion completed",
        }

    # ─── 1. Archive PII for compliance/forensics ─────────────────────
    archive_id = f"selfdel_{uuid.uuid4().hex[:12]}"
    archive_doc = {
        "archive_id": archive_id,
        "original_user_id":  user_id,
        "original_email":    live.get("email"),
        "original_username": live.get("username"),
        "original_name":     live.get("name"),
        "original_role":     live.get("role"),
        "original_plan":     live.get("plan"),
        "original_stripe_customer_id":      live.get("stripe_customer_id"),
        "original_stripe_subscription_id":  live.get("stripe_subscription_id"),
        "deleted_by_user_id": user_id,             # self-delete
        "deleted_at":         utcnow(),
        "reason_code":        "user_requested",
        "reason_note":        "self-service in-app account deletion",
        "strategy":           "self_service",
    }
    try:
        await db.deleted_users.insert_one(archive_doc)
    except Exception as e:
        # Don't block deletion on archive write failure — log + continue.
        log.warning("account_delete_archive_failed user_id=%s err=%r", user_id, e)

    # ─── 2. Cancel Stripe subscription (best-effort, never fatal) ────
    stripe_cancelled = False
    sub_id = live.get("stripe_subscription_id")
    if sub_id:
        try:
            import stripe  # noqa: WPS433 — local import: not all installs ship stripe
            stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")
            if stripe.api_key:
                stripe.Subscription.delete(sub_id)
                stripe_cancelled = True
                log.info("account_delete_stripe_cancel_ok user_id=%s", user_id)
            else:
                log.info("account_delete_stripe_skip_no_key user_id=%s", user_id)
        except Exception as exc:
            # Common safe failures: subscription already canceled, doesn't
            # exist, or Stripe is in test mode without that sub id. Swallow.
            log.warning("account_delete_stripe_cancel_failed user_id=%s err=%r", user_id, exc)

    # ─── 3. Anonymize approved public spots (PRESERVE for community) ──
    # Approved public means visibility_status == "approved" AND
    # privacy_mode in {public, premium} AND not flagged/removed.
    # All other spots owned by the user → deleted.
    anon_set = {
        "creator_anonymized":  True,
        "creator_deleted":     True,
        "creator_display_name": ANON_DISPLAY_NAME,
        "creator_avatar_url":   None,
        "creator_username":     None,
        # Keep owner_user_id so internal moderation joins still work,
        # but the public API substitutes the placeholder identity.
        "creator_anonymized_at": utcnow(),
    }
    anon_unset = {
        # Wipe any inline creator profile cache fields if they exist.
        "owner_profile":  "",
        "owner_snapshot": "",
    }

    APPROVED_FILTER = {
        "owner_user_id":     user_id,
        "visibility_status": "approved",
        "privacy_mode":      {"$in": ["public", "premium"]},
        # Don't preserve flagged content — it falls through to the
        # delete path below.
        "$or": [
            {"flagged":   {"$ne": True}},
            {"flagged":   {"$exists": False}},
        ],
    }

    preserved = await db.spots.update_many(
        APPROVED_FILTER,
        {"$set": anon_set, "$unset": anon_unset},
    )

    # Everything else owned by the user → hard delete.
    purged_spots = await db.spots.delete_many({
        "owner_user_id": user_id,
        # Inverse of the preserve filter.
        "$or": [
            {"visibility_status": {"$ne": "approved"}},
            {"privacy_mode":      {"$nin": ["public", "premium"]}},
            {"flagged":           True},
        ],
    })

    # ─── 4. Delete user-personal data across collections ─────────────
    cascade: Dict[str, int] = {}

    async def _drop(coll_name: str, query: Dict[str, Any]) -> None:
        try:
            r = await db[coll_name].delete_many(query)
            cascade[coll_name] = r.deleted_count
        except Exception as e:
            log.warning("account_delete_cascade_err coll=%s user_id=%s err=%r",
                        coll_name, user_id, e)
            cascade[coll_name] = -1

    # Auth-related
    await _drop("push_tokens",                 {"user_id": user_id})
    await _drop("password_resets",             {"user_id": user_id})
    await _drop("email_changes",               {"user_id": user_id})

    # Engagement / personal lists
    await _drop("spot_saves",                  {"user_id": user_id})
    await _drop("park_saves",                  {"user_id": user_id})
    await _drop("follows",                     {"$or": [
                                                  {"follower_user_id": user_id},
                                                  {"followed_user_id": user_id},
                                              ]})
    await _drop("notifications",               {"user_id": user_id})
    await _drop("weather_alert_subscriptions", {"user_id": user_id})

    # Personal content
    await _drop("shoot_plans",                 {"user_id": user_id})
    await _drop("spot_reviews",                {"user_id": user_id})
    await _drop("spot_checkins",               {"user_id": user_id})
    await _drop("spot_edit_requests",          {"user_id": user_id})
    await _drop("spot_community_uploads",      {"user_id": user_id})
    await _drop("ugc_uploads",                 {"user_id": user_id})
    await _drop("spot_upload_reactions",       {"user_id": user_id})
    await _drop("spot_cover_overrides",        {"user_id": user_id})
    await _drop("seasonal_entries",            {"user_id": user_id})

    # Community
    await _drop("community_posts",             {"user_id": user_id})
    await _drop("community_comments",          {"user_id": user_id})
    await _drop("post_likes",                  {"user_id": user_id})
    await _drop("post_reactions",              {"user_id": user_id})
    await _drop("post_comments",               {"user_id": user_id})
    await _drop("poll_votes",                  {"user_id": user_id})

    # Direct messaging
    await _drop("dm_participants",             {"user_id": user_id})
    await _drop("dm_blocks",                   {"$or": [
                                                  {"blocker_user_id": user_id},
                                                  {"blocked_user_id": user_id},
                                              ]})
    await _drop("dm_requests",                 {"$or": [
                                                  {"from_user_id": user_id},
                                                  {"to_user_id":   user_id},
                                              ]})
    # We leave dm_messages alone for the other participant's history;
    # the sender's name will resolve to the placeholder via the
    # public-response helper.

    # Profile views / analytics — drop in both directions
    await _drop("profile_views",               {"$or": [
                                                  {"viewer_user_id": user_id},
                                                  {"viewed_user_id": user_id},
                                              ]})
    await _drop("user_blocks",                 {"$or": [
                                                  {"blocker_user_id": user_id},
                                                  {"blocked_user_id": user_id},
                                              ]})

    # Groups
    await _drop("group_members",               {"user_id": user_id})

    # Private collections only — public collections are preserved with
    # the anonymized creator placeholder injected at read time.
    private_cols = await db.collections.delete_many({
        "owner_user_id": user_id,
        "privacy_mode": {"$ne": "public"},
    })
    cascade["collections_private"] = private_cols.deleted_count

    # Anonymize any public collections the user owned.
    pub_cols = await db.collections.update_many(
        {"owner_user_id": user_id, "privacy_mode": "public"},
        {"$set": {
            "creator_anonymized":   True,
            "creator_deleted":      True,
            "creator_display_name": ANON_DISPLAY_NAME,
            "creator_avatar_url":   None,
        }},
    )
    cascade["collections_public_anonymized"] = pub_cols.modified_count

    cascade["spots_anonymized"] = preserved.modified_count
    cascade["spots_purged"]     = purged_spots.deleted_count

    # ─── 5. Hard-delete the user document ────────────────────────────
    # PII is already archived in deleted_users. Removing the row
    # eliminates every join target (no ghost "Deleted user" rows in the
    # directory) — public spots fall through to the placeholder helper.
    await db.users.delete_one({"user_id": user_id})

    # ─── 6. Audit log (no PII in the notes) ──────────────────────────
    try:
        await audit_log(
            user,
            "account.self_delete",
            target_type="user",
            target_id=user_id,
            before=None,
            after={
                "archive_id":        archive_id,
                "stripe_cancelled":  stripe_cancelled,
                "cascade_summary":   {k: v for k, v in cascade.items() if v},
            },
            notes="[SELF DELETE] user-initiated in-app account deletion",
        )
    except Exception as e:
        log.warning("account_delete_audit_failed user_id=%s err=%r", user_id, e)

    log.info(
        "account_delete_complete user_id=%s archive_id=%s "
        "spots_anonymized=%d spots_purged=%d stripe_cancelled=%s",
        user_id, archive_id,
        cascade.get("spots_anonymized", 0),
        cascade.get("spots_purged", 0),
        stripe_cancelled,
    )

    return {
        "success": True,
        "message": "Account deletion completed",
    }
