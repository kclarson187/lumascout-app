"""
routes/super_admin.py — Super-admin-only destructive operations.

Provides:
  DELETE /api/admin/spots/{spot_id}     — hard delete a spot with archive + cascade
  DELETE /api/admin/users/{user_id}     — soft delete (anonymize) a user + related cleanup
  GET    /api/admin/deleted-spots       — list archived spot snapshots
  GET    /api/admin/deleted-users       — list archived user snapshots

Only `super_admin` may call these endpoints. Everything is logged to audit_logs
with a human-readable `notes` field so the Audit screen reads clearly.

Strategy picks (confirmed with product):
  - SPOT delete    : hard delete + snapshot to deleted_spots
  - USER delete    : soft delete / anonymize, content stays attributed to "Deleted user"
"""
from typing import Any, Dict, List, Optional
import uuid

import stripe
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from server import (
    db,
    audit_log,
    require_role,
    utcnow,
    logger,
)

router = APIRouter(prefix="/api", tags=["super-admin"])


# ----- Input models ----------------------------------------------------------

VALID_SPOT_REASONS = {
    "policy_violation",
    "duplicate",
    "spam",
    "user_requested",
    "low_quality",
    "other",
}
VALID_USER_REASONS = {
    "policy_violation",
    "spam_network",
    "duplicate",
    "user_requested",
    "inactive",
    "other",
}


class SpotDeleteIn(BaseModel):
    reason_code: Optional[str] = Field(default=None, description="Preset reason key")
    reason_note: Optional[str] = Field(default=None, max_length=500)


class UserDeleteIn(BaseModel):
    reason_code: Optional[str] = Field(default=None)
    reason_note: Optional[str] = Field(default=None, max_length=500)


def _clean(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return doc
    doc = dict(doc)
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


def _compose_reason(code: Optional[str], note: Optional[str]) -> str:
    parts: List[str] = []
    if code:
        parts.append(code.replace("_", " "))
    if note:
        parts.append(note.strip()[:500])
    return " — ".join([p for p in parts if p]) or "no reason provided"


# ============================================================================
# SPOT DELETE (hard delete + archive)
# ============================================================================
@router.delete("/admin/spots/{spot_id}")
async def super_delete_spot(
    spot_id: str,
    body: SpotDeleteIn,
    me: dict = Depends(require_role("super_admin")),
):
    spot = await db.spots.find_one({"spot_id": spot_id})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")

    # Validate reason code
    code = (body.reason_code or "").strip().lower() or None
    if code and code not in VALID_SPOT_REASONS:
        code = "other"
    reason = _compose_reason(code, body.reason_note)

    # ---- Archive snapshot -------------------------------------------------
    snapshot = dict(spot)
    snapshot.pop("_id", None)
    archive_doc = {
        "archive_id": f"delspot_{uuid.uuid4().hex[:12]}",
        "original_spot_id": spot_id,
        "original_title": spot.get("title"),
        "original_owner_user_id": spot.get("owner_user_id"),
        "original_city": spot.get("city"),
        "original_state": spot.get("state"),
        "original_country": spot.get("country"),
        "deleted_by_user_id": me["user_id"],
        "deleted_by_email": me.get("email"),
        "deleted_by_role": me.get("role"),
        "deleted_at": utcnow(),
        "reason_code": code,
        "reason_note": (body.reason_note or "").strip() or None,
        "snapshot": snapshot,
    }
    await db.deleted_spots.insert_one(archive_doc)

    # ---- Cascade cleanup --------------------------------------------------
    cascade: Dict[str, int] = {}
    r = await db.spot_saves.delete_many({"spot_id": spot_id})
    cascade["spot_saves"] = r.deleted_count
    r = await db.spot_reviews.delete_many({"spot_id": spot_id})
    cascade["spot_reviews"] = r.deleted_count
    r = await db.spot_checkins.delete_many({"spot_id": spot_id})
    cascade["spot_checkins"] = r.deleted_count
    r = await db.reports.delete_many({"target_type": "spot", "target_id": spot_id})
    cascade["reports"] = r.deleted_count
    # Remove from collections
    r = await db.collections.update_many(
        {"spot_ids": spot_id},
        {"$pull": {"spot_ids": spot_id}, "$set": {"updated_at": utcnow()}},
    )
    cascade["collections_updated"] = r.modified_count
    # Unlink from community posts (keep post, drop the spot reference)
    r = await db.community_posts.update_many(
        {"spot_id": spot_id},
        {"$set": {"spot_id": None, "updated_at": utcnow()}},
    )
    cascade["posts_unlinked"] = r.modified_count
    # Pull from spot_packs
    r = await db.spot_packs.update_many(
        {"spot_ids": spot_id},
        {"$pull": {"spot_ids": spot_id}, "$set": {"updated_at": utcnow()}},
    )
    cascade["packs_updated"] = r.modified_count

    # ---- Delete the spot itself ------------------------------------------
    await db.spots.delete_one({"spot_id": spot_id})

    # ---- Audit -----------------------------------------------------------
    await audit_log(
        me,
        "spot.delete_hard",
        target_type="spot",
        target_id=spot_id,
        before={
            "title": spot.get("title"),
            "owner_user_id": spot.get("owner_user_id"),
            "city": spot.get("city"),
            "state": spot.get("state"),
        },
        after={"archive_id": archive_doc["archive_id"], "cascade": cascade},
        notes=f"[SUPER ADMIN] Hard-deleted spot '{(spot.get('title') or '')[:60]}' — {reason}",
    )

    return {
        "ok": True,
        "spot_id": spot_id,
        "archive_id": archive_doc["archive_id"],
        "reason_code": code,
        "cascade": cascade,
        "strategy": "hard_delete_with_archive",
    }


# ============================================================================
# USER DELETE (soft delete + anonymize)
# ============================================================================
@router.delete("/admin/users/{user_id}")
async def super_delete_user(
    user_id: str,
    body: UserDeleteIn,
    me: dict = Depends(require_role("super_admin")),
):
    target = await db.users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Safety rails
    if target["user_id"] == me["user_id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if target.get("deleted"):
        raise HTTPException(status_code=400, detail="User is already deleted")
    if target.get("role") == "super_admin":
        raise HTTPException(status_code=400, detail="Cannot delete another super_admin — demote first")

    code = (body.reason_code or "").strip().lower() or None
    if code and code not in VALID_USER_REASONS:
        code = "other"
    reason = _compose_reason(code, body.reason_note)

    short = uuid.uuid4().hex[:8]
    anon_email = f"deleted+{short}@lumascout.app"
    anon_username = f"deleted_user_{short}"

    # ---- Archive original PII --------------------------------------------
    archive_doc = {
        "archive_id": f"deluser_{uuid.uuid4().hex[:12]}",
        "original_user_id": user_id,
        "original_email": target.get("email"),
        "original_username": target.get("username"),
        "original_name": target.get("name"),
        "original_role": target.get("role"),
        "original_plan": target.get("plan"),
        "original_stripe_customer_id": target.get("stripe_customer_id"),
        "deleted_by_user_id": me["user_id"],
        "deleted_by_email": me.get("email"),
        "deleted_by_role": me.get("role"),
        "deleted_at": utcnow(),
        "reason_code": code,
        "reason_note": (body.reason_note or "").strip() or None,
    }
    await db.deleted_users.insert_one(archive_doc)

    # ---- Best-effort cancel Stripe subscription --------------------------
    stripe_cancelled = False
    sub_id = target.get("stripe_subscription_id")
    if sub_id:
        try:
            stripe.Subscription.delete(sub_id)
            stripe_cancelled = True
        except Exception as exc:
            logger.warning("stripe cancel failed for user %s: %s", user_id, exc)

    # ---- Anonymize user doc ---------------------------------------------
    await db.users.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "email": anon_email,
                "username": anon_username,
                "name": "Deleted user",
                "bio": None,
                "avatar_url": None,
                "cover_image_url": None,
                "phone": None,
                "city": None,
                "state": None,
                "country": None,
                "password_hash": None,
                "role": "user",
                "plan": "free",
                "status": "deleted",
                "deleted": True,
                "deleted_at": utcnow(),
                "deleted_by": me["user_id"],
                "delete_reason": reason,
                "mentorship_available": False,
                "looking_for_mentor": False,
                "is_bot": False,
                "stripe_customer_id": None,
                "stripe_subscription_id": None,
                "stripe_subscription_status": None,
                "website": None,
                "instagram_handle": None,
                "facebook_url": None,
                "twitter_handle": None,
                "twitter_url": None,
                "specialties": [],
                "portfolio_links": [],
            },
        },
    )

    # ---- Revoke sessions & related personal data -------------------------
    cascade: Dict[str, int] = {}
    r = await db.push_tokens.delete_many({"user_id": user_id})
    cascade["push_tokens"] = r.deleted_count
    r = await db.follows.delete_many({"$or": [{"follower_user_id": user_id}, {"followed_user_id": user_id}]})
    cascade["follows"] = r.deleted_count
    r = await db.group_members.delete_many({"user_id": user_id})
    cascade["group_memberships"] = r.deleted_count
    r = await db.spot_saves.delete_many({"user_id": user_id})
    cascade["spot_saves"] = r.deleted_count
    r = await db.poll_votes.delete_many({"user_id": user_id})
    cascade["poll_votes"] = r.deleted_count
    r = await db.post_likes.delete_many({"user_id": user_id})
    cascade["post_likes"] = r.deleted_count
    # Drop any pending admin-granted comp plan
    # (handled by the anonymize $set above)

    await audit_log(
        me,
        "user.delete_soft",
        target_type="user",
        target_id=user_id,
        before={
            "email": target.get("email"),
            "username": target.get("username"),
            "role": target.get("role"),
            "plan": target.get("plan"),
        },
        after={
            "archive_id": archive_doc["archive_id"],
            "stripe_cancelled": stripe_cancelled,
            "cascade": cascade,
        },
        notes=(
            f"[SUPER ADMIN] Soft-deleted user @{target.get('username')} "
            f"({target.get('email')}) — {reason}"
        ),
    )

    return {
        "ok": True,
        "user_id": user_id,
        "archive_id": archive_doc["archive_id"],
        "reason_code": code,
        "strategy": "soft_delete_anonymize",
        "stripe_cancelled": stripe_cancelled,
        "cascade": cascade,
    }


# ============================================================================
# Archive inspection (read-only, super_admin)
# ============================================================================
@router.get("/admin/deleted-spots")
async def list_deleted_spots(
    limit: int = 50,
    me: dict = Depends(require_role("super_admin")),
):
    items = await db.deleted_spots.find({}, {"_id": 0, "snapshot": 0}).sort("deleted_at", -1).limit(min(limit, 200)).to_list(200)
    return {"count": len(items), "items": items}


@router.get("/admin/deleted-users")
async def list_deleted_users(
    limit: int = 50,
    me: dict = Depends(require_role("super_admin")),
):
    items = await db.deleted_users.find({}, {"_id": 0}).sort("deleted_at", -1).limit(min(limit, 200)).to_list(200)
    return {"count": len(items), "items": items}
