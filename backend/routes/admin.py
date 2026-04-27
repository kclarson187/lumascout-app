"""
routes/admin.py — Admin + Super Admin moderation endpoints.

Phase 1B of the server.py modularization (extracted 2026-04-23, after
marketplace.py in Phase 1A). 33 endpoints + 8 request models.

Covers:
  • Spot upload moderation (2 endpoints — near the push infra for historical reasons)
  • General admin triage (pending counts, recent approvals — 2)
  • Community moderation (posts + bulk + browse + summary — 6)
  • User sanctions (apply, lift, history — 3)
  • Spot moderation (approve/reject/action/cover editor/gallery — 7)
  • Reports queue (list + resolve — 2)
  • Dashboards (overview, analytics — 2)
  • User management (list, detail, patch, grant-plan, notes — 5)
  • Audit logs (1)
  • Platform settings (get + patch — 2)

PRESERVED SEMANTICS — no behaviour change, no path change. Every endpoint
was moved verbatim from server.py. Any refactor is a separate commit.

All endpoints are guarded by `require_role("admin")` or `require_role("super_admin")`
via the Depends chain — auth logic stays in server.py. We import the guard
fresh for every request.

DO NOT MOVE:
  • require_role / role decorators themselves (used across the codebase)
  • audit_log (used by marketplace, billing, and non-admin destructive paths)
  • _apply_moderation, _hydrate_posts, _hydrate_contributors, _recompute_spot_freshness
    (community moderation helpers used by non-admin code too)
  • public_spot_view (used by spot approve/reject for cache invalidation;
    lives in spots.py worth split)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from server import (
    db,
    get_current_user,
    require_role,
    utcnow,
    audit_log,
    _emit_notification,
    _apply_moderation,
    _hydrate_posts,
    _hydrate_contributors,
    _recompute_spot_freshness,
    public_spot_view,
    get_platform_settings,
    # Models reused from server.py (not admin-specific)
    AdminUserPatch,
    ModerationActionIn,
    PlatformSettingsPatch,
    ReportResolveIn,
    # Constants
    CONTENT_COLLECTIONS,
    SETTINGS_SINGLETON_ID,
    SUPER_ADMIN_ONLY_ACTIONS,
    VALID_PLANS,
    VALID_ROLES,
    VALID_STATUSES,
)

router = APIRouter(prefix="/api", tags=["admin"])


# --- spot_upload_moderate_model (server.py:2747-2748) ---
class SpotUploadModerationIn(BaseModel):
    action: str  # "approve" | "deny" | "feature" | "unfeature" | "set_as_cover" | "remove"

# --- admin_list_pending_uploads (server.py:2726-2744) ---
@router.get("/admin/spot-uploads/pending")
async def admin_list_pending_uploads(
    limit: int = 50,
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in ("admin", "super_admin", "moderator", "support"):
        raise HTTPException(status_code=403, detail="Admin only")
    limit = max(1, min(200, limit))
    items = await db.spot_community_uploads.find(
        {"moderation_status": "pending"}, {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    items = await _hydrate_contributors(items)
    # Enrich with spot title
    sids = list({i["spot_id"] for i in items})
    spots = await db.spots.find({"spot_id": {"$in": sids}}, {"_id": 0, "spot_id": 1, "title": 1, "city": 1, "state": 1}).to_list(len(sids))
    smap = {s["spot_id"]: s for s in spots}
    for it in items:
        it["spot"] = smap.get(it["spot_id"])
    return {"items": items, "count": len(items)}

# --- admin_moderate_upload (server.py:2751-2820) ---
@router.patch("/admin/spot-uploads/{upload_id}")
async def admin_moderate_upload(
    upload_id: str,
    body: SpotUploadModerationIn,
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in ("admin", "super_admin", "moderator", "support"):
        raise HTTPException(status_code=403, detail="Admin only")
    upload = await db.spot_community_uploads.find_one({"upload_id": upload_id})
    if not upload:
        raise HTTPException(status_code=404, detail="Not found")
    now = utcnow()
    updates: dict = {"updated_at": now, "moderated_by": user["user_id"], "moderated_at": now}
    action = body.action
    if action == "approve":
        updates["moderation_status"] = "approved"
    elif action == "deny":
        updates["moderation_status"] = "denied"
    elif action == "remove":
        updates["moderation_status"] = "removed"
    elif action == "feature":
        updates["featured"] = True
    elif action == "unfeature":
        updates["featured"] = False
    elif action == "set_as_cover":
        # Promote this community upload to the spot's cover image.
        spot = await db.spots.find_one({"spot_id": upload["spot_id"]})
        if spot:
            existing = spot.get("images") or []
            # Clear previous cover, then prepend this as new cover.
            for im in existing:
                if isinstance(im, dict):
                    im["is_cover"] = False
            new_cover = {
                "image_url": upload["image_url"],
                "caption": upload.get("caption"),
                "is_cover": True,
                "sourced_from_upload_id": upload_id,
                "sourced_from_user_id": upload["user_id"],
            }
            await db.spots.update_one(
                {"spot_id": upload["spot_id"]},
                {"$set": {"images": [new_cover] + existing}},
            )
    else:
        raise HTTPException(status_code=400, detail="Unknown action")
    await db.spot_community_uploads.update_one({"upload_id": upload_id}, {"$set": updates})
    await _recompute_spot_freshness(upload["spot_id"])
    # Notify uploader on approve/deny/feature/set_as_cover
    try:
        if action in ("approve", "feature", "set_as_cover") and upload.get("user_id"):
            notif_title = {
                "approve": "Your upload was approved",
                "feature": "Your upload was featured",
                "set_as_cover": "Your photo is now the cover!",
            }[action]
            await _emit_notification(
                upload["user_id"],
                f"upload_{action}",
                notif_title,
                (upload.get("caption") or "Thanks for keeping the community fresh").strip()[:200],
                actor_user_id=user["user_id"],
                spot_id=upload["spot_id"],
                upload_id=upload_id,
                image_url=upload.get("image_url"),
                deep_link=f"/spot/{upload['spot_id']}",
            )
    except Exception:
        pass
    return {"ok": True, "action": action}

# --- admin_pending (server.py:4993-4996) ---
@router.get("/admin/pending")
async def admin_pending(user: dict = Depends(require_role("moderator"))):
    pending = await db.spots.find({"visibility_status": "pending_review"}, {"_id": 0}).to_list(200)
    return [public_spot_view(s, user) for s in pending]

# --- admin_recent_approvals (server.py:4999-5013) ---
@router.get("/admin/stats/recent-approvals")
async def admin_recent_approvals(
    days: int = 7,
    user: dict = Depends(require_role("moderator")),
):
    """PRD UX Polish #8 — feed the celebratory empty state on /admin/spots with a
    real "X approved in the last N days" number rather than a placeholder stat.
    """
    safe_days = max(1, min(days, 90))
    since = datetime.now(timezone.utc) - timedelta(days=safe_days)
    count = await db.spots.count_documents({
        "visibility_status": "approved",
        "reviewed_at": {"$gte": since.isoformat()},
    })
    return {"count": count, "days": safe_days}

# --- admin_list_posts (server.py:5017-5046) ---
@router.get("/admin/posts")
async def admin_list_posts(
    status: Optional[str] = None,
    limit: int = 50,
    me: dict = Depends(require_role("moderator")),
):
    """Community post moderation list. Supports ?status=flagged|active|removed.

    Also returns report count per post (aggregated from the reports collection)
    so moderators can triage by community signal.
    """
    q: dict = {}
    if status and status != "all":
        q["status"] = status
    limit = max(1, min(200, limit))
    posts = await db.community_posts.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    # Attach report counts per post
    post_ids = [p["post_id"] for p in posts]
    if post_ids:
        reports_agg = await db.reports.aggregate([
            {"$match": {"target_type": "post", "target_id": {"$in": post_ids}, "status": "pending"}},
            {"$group": {"_id": "$target_id", "count": {"$sum": 1}}},
        ]).to_list(500)
        report_map = {r["_id"]: r["count"] for r in reports_agg}
    else:
        report_map = {}
    posts = await _hydrate_posts(posts, me)
    for p in posts:
        p["open_reports"] = report_map.get(p["post_id"], 0)
    return {"items": posts, "count": len(posts)}

# --- admin_delete_post (server.py:5049-5078) ---
@router.delete("/admin/posts/{post_id}")
async def admin_delete_post(
    post_id: str,
    reason: Optional[str] = None,
    me: dict = Depends(require_role("moderator")),
):
    post = await db.community_posts.find_one({"post_id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    await db.community_posts.update_one(
        {"post_id": post_id},
        {"$set": {
            "status": "removed",
            "removed_by": me["user_id"],
            "removed_at": utcnow(),
            "removal_reason": reason or "admin removal",
        }},
    )
    # Auto-resolve any pending reports that referenced this post.
    await db.reports.update_many(
        {"target_type": "post", "target_id": post_id, "status": "pending"},
        {"$set": {"status": "resolved", "resolved_by": me["user_id"], "resolved_at": utcnow(), "resolution_note": "post removed"}},
    )
    await audit_log(
        me, "post.remove", "post", post_id,
        before={"status": post.get("status", "active"), "title": post.get("title")},
        after={"status": "removed", "removal_reason": reason or "admin removal"},
        notes=reason or "admin removal",
    )
    return {"ok": True, "post_id": post_id, "status": "removed"}

# --- admin_restore_post (server.py:5081-5095) ---
@router.post("/admin/posts/{post_id}/restore")
async def admin_restore_post(
    post_id: str,
    me: dict = Depends(require_role("admin")),
):
    post = await db.community_posts.find_one({"post_id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    await db.community_posts.update_one(
        {"post_id": post_id},
        {"$set": {"status": "active", "restored_by": me["user_id"], "restored_at": utcnow()}},
    )
    await audit_log(me, "post.restore", "post", post_id,
                    before={"status": post.get("status")}, after={"status": "active"})
    return {"ok": True, "post_id": post_id, "status": "active"}


# ============================================================================
# EXPORT EVIDENCE LOG (Apr 2026 — Community Moderation Stage 2)
# ============================================================================
@router.get("/admin/community/export-evidence")
async def admin_export_evidence(
    target_type: Optional[str] = "post",   # post | comment | user
    action: Optional[str] = None,          # filter to a specific action
    moderator_id: Optional[str] = None,    # filter to one mod's actions
    days: int = 30,                        # window
    me: dict = Depends(require_role("admin")),
):
    """Streams a CSV of moderation actions for the given window.

    Used for off-platform legal/compliance archiving and quarterly reviews.
    Each row: timestamp, moderator_name, moderator_role, action, target_type,
    target_id, reason, before_status, after_status.
    """
    days = max(1, min(days, 365))
    cutoff = utcnow() - timedelta(days=days)
    filt: Dict[str, Any] = {
        "created_at": {"$gte": cutoff},
        "target_type": target_type,
        "action": {"$regex": "^(post\\.|comment\\.|user\\.)", "$options": ""},
    }
    if action:
        filt["action"] = action
    if moderator_id:
        filt["actor_id"] = moderator_id

    async def _row_iter():
        # CSV header
        yield "timestamp,moderator_id,moderator_name,moderator_role,action,target_type,target_id,reason,before,after\n"
        cur = db.audit_logs.find(filt, {"_id": 0}).sort("created_at", -1).limit(50_000)
        # Cache moderator lookups for nicer rows
        cache: Dict[str, Dict[str, Any]] = {}
        async for log in cur:
            actor_id = log.get("actor_id") or ""
            if actor_id and actor_id not in cache:
                u = await db.users.find_one(
                    {"user_id": actor_id},
                    {"_id": 0, "user_id": 1, "name": 1, "role": 1},
                )
                cache[actor_id] = u or {}
            actor = cache.get(actor_id, {})
            row = [
                (log.get("created_at") or "").isoformat() if log.get("created_at") else "",
                actor_id,
                _csv_escape(actor.get("name", "")),
                actor.get("role", ""),
                log.get("action", ""),
                log.get("target_type", ""),
                log.get("target_id", ""),
                _csv_escape(log.get("notes", "") or log.get("reason", "")),
                _csv_escape(str(log.get("before", ""))),
                _csv_escape(str(log.get("after", ""))),
            ]
            yield ",".join(row) + "\n"

    filename = f"lumascout_moderation_evidence_{days}d_{utcnow().strftime('%Y%m%d')}.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    await audit_log(
        me, "admin.export_evidence", "audit", "csv",
        notes=f"days={days} target_type={target_type} action={action or '*'}",
    )
    return StreamingResponse(_row_iter(), media_type="text/csv", headers=headers)


def _csv_escape(v: Any) -> str:
    """Minimal CSV-safe escaping: wrap in quotes if contains special chars."""
    s = str(v) if v is not None else ""
    if any(c in s for c in [",", "\"", "\n", "\r"]):
        s = s.replace("\"", "\"\"")
        return f'"{s}"'
    return s

# --- BulkModerationIn (server.py:5237-5241) ---
class BulkModerationIn(BaseModel):
    type: str
    ids: List[str]
    action: str
    reason: Optional[str] = None

# --- admin_community_moderate (server.py:5244-5249) ---
@router.post("/admin/community/moderate")
async def admin_community_moderate(
    body: ModerationActionIn,
    me: dict = Depends(require_role("moderator")),
):
    return await _apply_moderation(me, body.type, body.id, body.action, body.reason)

# --- admin_community_bulk_moderate (server.py:5252-5274) ---
@router.post("/admin/community/bulk-moderate")
async def admin_community_bulk_moderate(
    body: BulkModerationIn,
    me: dict = Depends(require_role("admin")),
):
    """Apply the same moderation action to many items. Reports actor errors
    per-item without aborting the whole batch."""
    if len(body.ids) == 0:
        raise HTTPException(status_code=400, detail="No ids provided")
    if len(body.ids) > 200:
        raise HTTPException(status_code=400, detail="Max 200 items per bulk action")
    if body.action in SUPER_ADMIN_ONLY_ACTIONS and me.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin only for hard_delete")
    results = {"applied": 0, "failed": 0, "items": []}
    for tid in body.ids:
        try:
            r = await _apply_moderation(me, body.type, tid, body.action, body.reason)
            results["applied"] += 1
            results["items"].append({"id": tid, "ok": True, "action": r.get("action")})
        except HTTPException as e:
            results["failed"] += 1
            results["items"].append({"id": tid, "ok": False, "error": e.detail})
    return results

# --- admin_community_content (server.py:5277-5341) ---
@router.get("/admin/community/content")
async def admin_community_content(
    type: str = "post",
    status: Optional[str] = None,        # active | removed | hidden | spam | pinned | featured
    reported: Optional[bool] = None,     # only items with pending reports
    auto_flagged: Optional[bool] = None, # Apr 2026: items with spam_score>=40
    no_comments: Optional[bool] = None,  # Apr 2026: posts with 0 comments
    q: Optional[str] = None,
    limit: int = 50,
    skip: int = 0,
    me: dict = Depends(require_role("moderator")),
):
    if type not in CONTENT_COLLECTIONS:
        raise HTTPException(status_code=400, detail="Unknown type")
    coll_name, id_field = CONTENT_COLLECTIONS[type]
    coll = getattr(db, coll_name)
    filt: dict = {}
    if status == "active":
        filt["$and"] = [
            {"status": {"$ne": "removed"}},
            {"$or": [{"hidden": {"$exists": False}}, {"hidden": False}]},
        ]
    elif status == "removed":
        filt["status"] = "removed"
    elif status == "hidden":
        filt["hidden"] = True
    elif status == "spam":
        filt["spam"] = True
    elif status == "pinned":
        filt["pinned"] = True
    elif status == "featured":
        filt["featured"] = True
    if q:
        filt["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"body": {"$regex": q, "$options": "i"}},
        ]
    if reported:
        # Intersect with ids that have pending reports
        report_cur = db.reports.find(
            {"target_type": type, "status": "pending"},
            {"target_id": 1, "_id": 0},
        )
        ids = list({r["target_id"] async for r in report_cur})
        filt[id_field] = {"$in": ids}
    # ---- Apr 2026 — auto-spam filter ----
    if auto_flagged:
        # Show anything our heuristic flagged. Either auto_flagged=True OR
        # has any signals (covers older auto-hidden posts).
        filt["$or"] = filt.get("$or", []) + [
            {"auto_flagged": True},
            {"spam_signals.0": {"$exists": True}},
            {"spam_score": {"$gte": 40}},
        ]
    # ---- Apr 2026 — no comments filter ----
    if no_comments and type == "post":
        filt["$and"] = filt.get("$and", []) + [
            {"$or": [
                {"comment_count": {"$exists": False}},
                {"comment_count": 0},
            ]},
        ]

    limit = max(1, min(limit, 200))
    skip = max(0, skip)
    total = await coll.count_documents(filt)
    cursor = coll.find(filt, {"_id": 0}).sort([("pinned", -1), ("created_at", -1)]).skip(skip).limit(limit)
    items = await cursor.to_list(limit)

    # Hydrate author info for each item (name/avatar)
    author_ids = list({i.get("author_user_id") for i in items if i.get("author_user_id")})
    authors = {}
    if author_ids:
        async for u in db.users.find({"user_id": {"$in": author_ids}},
                                     {"_id": 0, "user_id": 1, "name": 1, "username": 1,
                                      "avatar_url": 1, "plan": 1, "role": 1}):
            authors[u["user_id"]] = u
    for i in items:
        i["_author"] = authors.get(i.get("author_user_id"))
        # Each item annotates pending report count for the dashboard
        i["_report_count"] = await db.reports.count_documents({
            "target_type": type, "target_id": i.get(id_field), "status": "pending",
        })
    return {"items": items, "total": total, "type": type}

# --- admin_community_summary (server.py:5344-5371) ---
@router.get("/admin/community/summary")
async def admin_community_summary(me: dict = Depends(require_role("moderator"))):
    """Counts for the Community Control Center dashboard badges."""
    async def _counts(coll_name: str) -> dict:
        coll = getattr(db, coll_name)
        return {
            "active": await coll.count_documents({"status": {"$ne": "removed"}}),
            "removed": await coll.count_documents({"status": "removed"}),
            "hidden": await coll.count_documents({"hidden": True}),
            "spam": await coll.count_documents({"spam": True}),
            "pinned": await coll.count_documents({"pinned": True}),
            "featured": await coll.count_documents({"featured": True}),
        }
    return {
        "posts": await _counts("community_posts"),
        "polls": await _counts("community_polls"),
        "comments": await _counts("community_comments"),
        "reports": {
            "pending": await db.reports.count_documents({"status": "pending"}),
            "resolved": await db.reports.count_documents({"status": "resolved"}),
            "total": await db.reports.count_documents({}),
        },
        "sanctions": {
            "active_warnings": await db.user_sanctions.count_documents({"type": "warn", "active": True}),
            "active_suspensions": await db.user_sanctions.count_documents({"type": "suspend", "active": True}),
            "active_bans": await db.user_sanctions.count_documents({"type": "ban", "active": True}),
        },
    }

# --- UserSanctionIn (server.py:5416-5419) ---
class UserSanctionIn(BaseModel):
    type: str                # warn | suspend | ban
    reason: str
    duration_days: Optional[int] = None   # only for suspend; ban is permanent by default

# --- admin_sanction_user (server.py:5422-5483) ---
@router.post("/admin/users/{user_id}/sanction")
async def admin_sanction_user(
    user_id: str, body: UserSanctionIn,
    me: dict = Depends(require_role("admin")),
):
    if body.type not in ("warn", "suspend", "ban"):
        raise HTTPException(status_code=400, detail="type must be warn|suspend|ban")
    if body.type == "ban" and me.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can ban users")
    target = await db.users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    now = utcnow()
    expires_at: Optional[datetime] = None
    if body.type == "suspend":
        dd = max(1, min(int(body.duration_days or 7), 365))
        expires_at = now + timedelta(days=dd)

    sanction_id = f"san_{uuid.uuid4().hex[:12]}"
    await db.user_sanctions.insert_one({
        "sanction_id": sanction_id,
        "user_id": user_id,
        "type": body.type,
        "reason": body.reason,
        "issued_by": me["user_id"],
        "issued_at": now,
        "expires_at": expires_at,
        "active": True,
    })
    # Flip user flags for auth guards
    user_patch: Dict[str, Any] = {}
    if body.type == "suspend":
        user_patch["suspended_until"] = expires_at
        user_patch["status"] = "suspended"
    elif body.type == "ban":
        user_patch["status"] = "banned"
        user_patch["banned_at"] = now
    if user_patch:
        await db.users.update_one({"user_id": user_id}, {"$set": user_patch})

    # Fire a notification to the sanctioned user
    try:
        await _emit_notification(
            user_id,
            f"user_sanction_{body.type}",
            {
                "warn": "You received a warning",
                "suspend": "Your account has been suspended",
                "ban": "Your account has been banned",
            }[body.type],
            body.reason[:140],
        )
    except Exception:
        pass

    await audit_log(
        me, f"user.{body.type}", "user", user_id,
        after={"type": body.type, "reason": body.reason, "expires_at": expires_at},
        notes=body.reason,
    )
    return {"ok": True, "sanction_id": sanction_id, "expires_at": expires_at}

# --- admin_unsanction_user (server.py:5486-5508) ---
@router.post("/admin/users/{user_id}/unsanction")
async def admin_unsanction_user(
    user_id: str,
    me: dict = Depends(require_role("admin")),
):
    """Revoke the most-recent active sanction on this user."""
    san = await db.user_sanctions.find_one(
        {"user_id": user_id, "active": True}, sort=[("issued_at", -1)],
    )
    if not san:
        raise HTTPException(status_code=404, detail="No active sanction")
    await db.user_sanctions.update_one(
        {"sanction_id": san["sanction_id"]},
        {"$set": {"active": False, "revoked_by": me["user_id"], "revoked_at": utcnow()}},
    )
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"status": "active"},
         "$unset": {"suspended_until": "", "banned_at": ""}},
    )
    await audit_log(me, "user.unsanction", "user", user_id,
                    before={"sanction_type": san.get("type")}, after={"status": "active"})
    return {"ok": True, "revoked_sanction_id": san["sanction_id"]}

# --- admin_user_sanctions (server.py:5511-5519) ---
@router.get("/admin/users/{user_id}/sanctions")
async def admin_user_sanctions(
    user_id: str,
    me: dict = Depends(require_role("moderator")),
):
    items = await db.user_sanctions.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("issued_at", -1).limit(200).to_list(200)
    return {"items": items, "count": len(items)}

# --- admin_approve (server.py:5522-5538) ---
@router.post("/admin/spots/{spot_id}/approve")
async def admin_approve(spot_id: str, user: dict = Depends(require_role("moderator"))):
    before = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "visibility_status": 1})
    await db.spots.update_one(
        {"spot_id": spot_id},
        {"$set": {
            "visibility_status": "approved",
            "moderated_by": user["user_id"],
            "moderated_at": utcnow(),
        }},
    )
    await audit_log(
        user, "spot.approve", "spot", spot_id,
        before={"visibility_status": (before or {}).get("visibility_status")},
        after={"visibility_status": "approved"},
    )
    return {"ok": True}

# --- admin_reject (server.py:5541-5557) ---
@router.post("/admin/spots/{spot_id}/reject")
async def admin_reject(spot_id: str, user: dict = Depends(require_role("moderator"))):
    before = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "visibility_status": 1})
    await db.spots.update_one(
        {"spot_id": spot_id},
        {"$set": {
            "visibility_status": "rejected",
            "moderated_by": user["user_id"],
            "moderated_at": utcnow(),
        }},
    )
    await audit_log(
        user, "spot.reject", "spot", spot_id,
        before={"visibility_status": (before or {}).get("visibility_status")},
        after={"visibility_status": "rejected"},
    )
    return {"ok": True}

# --- AdminSpotCoverIn (server.py:5566-5572) ---
class AdminSpotCoverIn(BaseModel):
    image_url: str
    focal_x: float = 0.5     # 0..1 horizontal focal point
    focal_y: float = 0.5     # 0..1 vertical focal point
    scale: float = 1.0       # 1.0 = fit; >1 zooms in
    rotation: int = 0        # degrees, 0 | 90 | 180 | 270
    caption: Optional[str] = None

# --- admin_set_spot_cover (server.py:5575-5628) ---
@router.patch("/admin/spots/{spot_id}/cover")
async def admin_set_spot_cover(
    spot_id: str, body: AdminSpotCoverIn,
    user: dict = Depends(get_current_user),
):
    """Set the cover override on a spot. Now (Apr 2026) allows spot owners
    to choose their own featured photo, in addition to admins/super_admins.
    Falls through priority 0 over the community rotation, persists focal
    point + scale + rotation so the crop survives rehydration.

    The image_url must already exist on the spot or in its community uploads —
    we reject arbitrary URLs so nobody can inject off-platform media.
    """
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")

    is_admin_role = user.get("role") in ("admin", "super_admin", "moderator")
    is_owner = spot.get("created_by") == user["user_id"] or spot.get("user_id") == user["user_id"]
    if not (is_admin_role or is_owner):
        raise HTTPException(status_code=403, detail="Only the spot owner or an admin can set the cover.")

    # Validate image_url exists on spot.images[] or in community uploads
    allowed_urls: set[str] = set()
    for im in (spot.get("images") or []):
        if isinstance(im, dict) and im.get("image_url"):
            allowed_urls.add(im["image_url"])
    uploads = await db.spot_community_uploads.find(
        {"spot_id": spot_id, "moderation_status": "approved"},
        {"_id": 0, "image_url": 1},
    ).to_list(500)
    for u in uploads:
        if u.get("image_url"): allowed_urls.add(u["image_url"])
    if body.image_url not in allowed_urls:
        raise HTTPException(status_code=400, detail="image_url not part of this spot's gallery")

    fx = max(0.0, min(1.0, float(body.focal_x)))
    fy = max(0.0, min(1.0, float(body.focal_y)))
    scale = max(1.0, min(3.5, float(body.scale)))
    rot = int(body.rotation) % 360
    if rot not in (0, 90, 180, 270): rot = 0

    override = {
        "image_url": body.image_url,
        "focal_x": fx, "focal_y": fy,
        "scale": scale, "rotation": rot,
        "caption": (body.caption or "")[:200] or None,
        "set_by_user_id": user["user_id"],
        "set_at": utcnow(),
    }
    await db.spots.update_one(
        {"spot_id": spot_id},
        {"$set": {"admin_cover_override": override, "updated_at": utcnow()}},
    )
    await audit_log(
        user, "spot.cover.override", "spot", spot_id,
        before={"admin_cover_override": spot.get("admin_cover_override")},
        after=override,
    )
    return {"ok": True, "admin_cover_override": override}

# --- admin_clear_spot_cover (server.py:5631-5648) ---
@router.delete("/admin/spots/{spot_id}/cover")
async def admin_clear_spot_cover(
    spot_id: str, user: dict = Depends(require_role("admin")),
):
    """Remove the admin cover override — reverts to the community rotation."""
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "spot_id": 1, "admin_cover_override": 1})
    if spot is None:
        raise HTTPException(status_code=404, detail="Spot not found")
    await db.spots.update_one(
        {"spot_id": spot_id},
        {"$unset": {"admin_cover_override": ""}, "$set": {"updated_at": utcnow()}},
    )
    await audit_log(
        user, "spot.cover.clear", "spot", spot_id,
        before={"admin_cover_override": spot.get("admin_cover_override")},
        after=None,
    )
    return {"ok": True}

# --- AdminSpotGalleryReorderIn (server.py:5651-5652) ---
class AdminSpotGalleryReorderIn(BaseModel):
    image_urls: list[str]    # full ordered list of URLs; first becomes the cover fallback

# --- admin_reorder_spot_gallery (server.py:5655-5687) ---
@router.patch("/admin/spots/{spot_id}/gallery")
async def admin_reorder_spot_gallery(
    spot_id: str, body: AdminSpotGalleryReorderIn,
    user: dict = Depends(require_role("admin")),
):
    """Reorder the spot.images[] array. First item becomes is_cover=True
    (fallback cover when no admin_cover_override). Unknown URLs are ignored."""
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "images": 1})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    images = spot.get("images") or []
    by_url = {}
    for im in images:
        if isinstance(im, dict) and im.get("image_url"):
            by_url[im["image_url"]] = im
    ordered = []
    for u in body.image_urls:
        if u in by_url:
            im = dict(by_url[u])
            im["is_cover"] = (len(ordered) == 0)
            ordered.append(im)
    # Preserve any images not in the requested order at the end
    for u, im in by_url.items():
        if u not in body.image_urls:
            im2 = dict(im); im2["is_cover"] = False
            ordered.append(im2)
    await db.spots.update_one(
        {"spot_id": spot_id},
        {"$set": {"images": ordered, "updated_at": utcnow()}},
    )
    await audit_log(user, "spot.gallery.reorder", "spot", spot_id,
                    before={"count": len(images)}, after={"count": len(ordered)})
    return {"ok": True, "count": len(ordered)}

# --- admin_spot_cover_editor (server.py:5690-5747) ---
@router.get("/admin/spots/{spot_id}/cover-editor")
async def admin_spot_cover_editor(
    spot_id: str, user: dict = Depends(get_current_user),
):
    """Bundled payload for the cover-editor UI: spot meta, all available
    cover-candidate image URLs, current override, and admin quick actions.

    (Apr 2026) Open to spot owner OR admin/super_admin so creators can
    pick their own featured photo without an admin gate.
    """
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    is_admin_role = user.get("role") in ("admin", "super_admin", "moderator")
    is_owner = spot.get("created_by") == user["user_id"] or spot.get("user_id") == user["user_id"]
    if not (is_admin_role or is_owner):
        raise HTTPException(status_code=403, detail="Only the spot owner or an admin can edit the cover.")

    images: list[dict] = []
    for im in (spot.get("images") or []):
        if isinstance(im, dict) and im.get("image_url"):
            images.append({
                "image_url": im["image_url"],
                "caption": im.get("caption"),
                "is_cover": im.get("is_cover", False),
                "source": "spot",
            })
    uploads = await db.spot_community_uploads.find(
        {"spot_id": spot_id, "moderation_status": "approved"},
        {"_id": 0, "upload_id": 1, "image_url": 1, "caption": 1,
         "user_id": 1, "featured": 1, "like_count": 1, "created_at": 1},
    ).sort("created_at", -1).limit(60).to_list(60)
    contrib_ids = list({u["user_id"] for u in uploads if u.get("user_id")})
    contribs = {}
    if contrib_ids:
        async for u in db.users.find(
            {"user_id": {"$in": contrib_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "avatar_url": 1},
        ):
            contribs[u["user_id"]] = u
    for u in uploads:
        images.append({
            "image_url": u["image_url"],
            "caption": u.get("caption"),
            "is_cover": False,
            "source": "community",
            "featured": u.get("featured", False),
            "like_count": u.get("like_count", 0),
            "upload_id": u.get("upload_id"),
            "contributor": contribs.get(u.get("user_id")),
        })

    return {
        "spot": {
            "spot_id": spot["spot_id"],
            "title": spot.get("title"),
            "city": spot.get("city"),
            "state": spot.get("state"),
            "country_code": spot.get("country_code"),
            "visibility_status": spot.get("visibility_status"),
            "featured": spot.get("featured", False),
            "hidden_from_explore": spot.get("hidden_from_explore", False),
        },
        "images": images,
        "admin_cover_override": spot.get("admin_cover_override"),
    }

# --- AdminSpotActionIn (server.py:5750-5752) ---
class AdminSpotActionIn(BaseModel):
    action: str   # feature | unfeature | hide | unhide | approve | reject | delete
    reason: Optional[str] = None

# --- admin_spot_action (server.py:5755-5799) ---
@router.post("/admin/spots/{spot_id}/action")
async def admin_spot_action(
    spot_id: str, body: AdminSpotActionIn,
    user: dict = Depends(get_current_user),
):
    """Composite admin actions for the cover editor toolbar.
    - moderator+ can approve, reject, hide, unhide
    - admin+ can feature, unfeature
    - super_admin can delete
    """
    role = user.get("role") or "user"
    action = body.action
    mod_roles = {"moderator", "admin", "super_admin"}
    admin_roles = {"admin", "super_admin"}
    if action in ("approve", "reject", "hide", "unhide") and role not in mod_roles:
        raise HTTPException(status_code=403, detail="Moderator role required")
    if action in ("feature", "unfeature") and role not in admin_roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    if action == "delete" and role != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin only")

    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    before_snap = {k: spot.get(k) for k in ("visibility_status", "featured", "hidden_from_explore")}

    if action == "approve":
        await db.spots.update_one({"spot_id": spot_id}, {"$set": {"visibility_status": "approved", "moderated_by": user["user_id"], "moderated_at": utcnow()}})
    elif action == "reject":
        await db.spots.update_one({"spot_id": spot_id}, {"$set": {"visibility_status": "rejected", "moderated_by": user["user_id"], "moderated_at": utcnow()}})
    elif action == "feature":
        await db.spots.update_one({"spot_id": spot_id}, {"$set": {"featured": True, "updated_at": utcnow()}})
    elif action == "unfeature":
        await db.spots.update_one({"spot_id": spot_id}, {"$set": {"featured": False, "updated_at": utcnow()}})
    elif action == "hide":
        await db.spots.update_one({"spot_id": spot_id}, {"$set": {"hidden_from_explore": True, "updated_at": utcnow()}})
    elif action == "unhide":
        await db.spots.update_one({"spot_id": spot_id}, {"$set": {"hidden_from_explore": False, "updated_at": utcnow()}})
    elif action == "delete":
        await db.spots.update_one({"spot_id": spot_id}, {"$set": {"deleted_at": utcnow(), "visibility_status": "deleted"}})
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action {action}")

    await audit_log(user, f"spot.{action}", "spot", spot_id, before=before_snap, after={"action": action, "reason": body.reason})
    return {"ok": True, "action": action}

# --- admin_reports (server.py:5803-5816) ---
@router.get("/admin/reports")
async def admin_reports(status: Optional[str] = None, user: dict = Depends(require_role("moderator"))):
    q: dict = {}
    if status:
        q["status"] = status
    reports = await db.reports.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    # attach target context
    for r in reports:
        if r["target_type"] == "spot":
            s = await db.spots.find_one({"spot_id": r["target_id"]}, {"_id": 0, "title": 1, "city": 1, "state": 1, "images": 1, "spot_id": 1})
            r["target"] = s
        reporter = await db.users.find_one({"user_id": r["reporter_user_id"]}, {"_id": 0, "name": 1, "username": 1, "avatar_url": 1})
        r["reporter"] = reporter
    return reports

# --- admin_resolve_report (server.py:5823-5840) ---
@router.post("/admin/reports/{report_id}/resolve")
async def admin_resolve_report(report_id: str, body: ReportResolveIn, user: dict = Depends(require_role("moderator"))):
    if body.action not in ("dismissed", "removed", "warned"):
        raise HTTPException(status_code=400, detail="Invalid action")
    rep = await db.reports.find_one({"report_id": report_id})
    if not rep:
        raise HTTPException(status_code=404, detail="Not found")
    await db.reports.update_one(
        {"report_id": report_id},
        {"$set": {"status": "resolved", "resolution": body.action, "resolved_at": utcnow(), "resolved_by": user["user_id"]}},
    )
    if body.action == "removed" and rep["target_type"] == "spot":
        await db.spots.update_one({"spot_id": rep["target_id"]}, {"$set": {"visibility_status": "rejected"}})
    await audit_log(
        user, f"report.resolve.{body.action}", rep["target_type"], rep["target_id"],
        notes=f"report_id={report_id}",
    )
    return {"ok": True}

# --- admin_overview (server.py:5847-5918) ---
@router.get("/admin/overview")
async def admin_overview(user: dict = Depends(require_role("moderator"))):
    """Top-level metrics for the admin dashboard home."""
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now - timedelta(days=7)
    month_start = now - timedelta(days=30)

    total_users = await db.users.count_documents({})
    new_today = await db.users.count_documents({"created_at": {"$gte": today_start}})
    new_7d = await db.users.count_documents({"created_at": {"$gte": week_start}})
    plan_counts = {
        "free": await db.users.count_documents({"plan": {"$in": [None, "free"]}}),
        "pro": await db.users.count_documents({"plan": "pro"}),
        "elite": await db.users.count_documents({"plan": "elite"}),
    }
    suspended = await db.users.count_documents({"status": "suspended"})
    pending_spots = await db.spots.count_documents({"visibility_status": "pending_review"})
    reports_pending = await db.reports.count_documents({"status": "pending"})

    # Top contributors this month (saves received on own spots)
    recent_spots = await db.spots.find(
        {"created_at": {"$gte": month_start}},
        {"_id": 0, "owner_user_id": 1},
    ).to_list(1000)
    contrib_counts: dict = {}
    for s in recent_spots:
        contrib_counts[s["owner_user_id"]] = contrib_counts.get(s["owner_user_id"], 0) + 1
    top_ids = sorted(contrib_counts.items(), key=lambda x: -x[1])[:5]
    top_users = []
    if top_ids:
        users = await db.users.find(
            {"user_id": {"$in": [u for u, _ in top_ids]}},
            {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1, "plan": 1, "role": 1},
        ).to_list(20)
        umap = {u["user_id"]: u for u in users}
        for uid, count in top_ids:
            u = umap.get(uid)
            if u:
                u["spots_this_month"] = count
                top_users.append(u)

    # Trending cities (by spot count, last 30 days)
    city_counts: dict = {}
    for s in await db.spots.find(
        {"created_at": {"$gte": month_start}}, {"_id": 0, "city": 1, "state": 1}
    ).to_list(1000):
        key = f"{s.get('city', '—')}, {s.get('state', '')}".strip(", ")
        city_counts[key] = city_counts.get(key, 0) + 1
    top_cities = [{"city": k, "count": v} for k, v in sorted(city_counts.items(), key=lambda x: -x[1])[:5]]

    return {
        "users": {
            "total": total_users,
            "new_today": new_today,
            "active_7d": new_7d,  # proxy: we don't track DAU — treat as new-in-7d
            "suspended": suspended,
            "by_plan": plan_counts,
        },
        "moderation": {
            "pending_spots": pending_spots,
            "pending_reports": reports_pending,
            "pending_photos": 0,  # photo moderation queue comes in Phase 2
        },
        "top_contributors": top_users,
        "top_cities": top_cities,
        "revenue": {
            "monthly_estimate_usd": plan_counts["pro"] * 9 + plan_counts["elite"] * 19,
            "note": "Mock — Stripe not wired yet",
        },
        "generated_at": now.isoformat(),
    }

# --- admin_users (server.py:5921-5984) ---
@router.get("/admin/users")
async def admin_users(
    q: Optional[str] = None,
    role: Optional[str] = None,
    plan: Optional[str] = None,
    status: Optional[str] = None,
    include_test: bool = False,  # FIX(2026-04): [7.2] default-exclude QA accounts
    page: int = 1,
    limit: int = 25,
    user: dict = Depends(require_role("support")),
):
    """Paginated + filterable user search for the admin users table."""
    limit = max(1, min(100, limit))
    page = max(1, page)
    query: dict = {}
    if not include_test:
        query["is_test_account"] = {"$ne": True}
    if q:
        # Case-insensitive partial match across multiple identifying fields
        rgx = {"$regex": q, "$options": "i"}
        query["$or"] = [
            {"email": rgx}, {"name": rgx}, {"username": rgx}, {"user_id": q},
        ]
    if role:
        query["role"] = role
    if plan:
        query["plan"] = plan
    if status:
        query["status"] = status

    total = await db.users.count_documents(query)
    skip = (page - 1) * limit
    users = await db.users.find(
        query,
        {"_id": 0, "password_hash": 0},
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)

    # Enrich with spot + report counts (cheap — small batches)
    uids = [u["user_id"] for u in users]
    spot_counts_agg = await db.spots.aggregate([
        {"$match": {"owner_user_id": {"$in": uids}}},
        {"$group": {"_id": "$owner_user_id", "count": {"$sum": 1}}},
    ]).to_list(500)
    spot_map = {x["_id"]: x["count"] for x in spot_counts_agg}
    report_counts_agg = await db.reports.aggregate([
        {"$match": {"target_type": "user", "target_id": {"$in": uids}, "status": "pending"}},
        {"$group": {"_id": "$target_id", "count": {"$sum": 1}}},
    ]).to_list(500)
    rep_map = {x["_id"]: x["count"] for x in report_counts_agg}

    for u in users:
        u["spot_count"] = spot_map.get(u["user_id"], 0)
        u["open_reports"] = rep_map.get(u["user_id"], 0)
        u["role"] = u.get("role") or "user"
        u["plan"] = u.get("plan") or "free"
        u["status"] = u.get("status") or "active"

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit,
        "items": users,
    }

# --- admin_user_detail (server.py:5987-6009) ---
@router.get("/admin/users/{user_id}")
async def admin_user_detail(user_id: str, me: dict = Depends(require_role("support"))):
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target["role"] = target.get("role") or "user"
    target["plan"] = target.get("plan") or "free"
    target["status"] = target.get("status") or "active"
    target["spot_count"] = await db.spots.count_documents({"owner_user_id": user_id})
    target["save_count"] = await db.spot_saves.count_documents({"user_id": user_id})
    target["open_reports"] = await db.reports.count_documents(
        {"target_type": "user", "target_id": user_id, "status": "pending"}
    )
    target["recent_spots"] = await db.spots.find(
        {"owner_user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(5).to_list(5)
    target["notes"] = await db.admin_notes.find(
        {"subject_user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(20).to_list(20)
    target["recent_audit"] = await db.audit_logs.find(
        {"target_type": "user", "target_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(20).to_list(20)
    return target

# --- admin_update_user (server.py:6027-6095) ---
@router.patch("/admin/users/{user_id}")
async def admin_update_user(
    user_id: str,
    body: AdminUserPatch,
    me: dict = Depends(require_role("admin")),
):
    """Update plan / role / status / verification / comp expiration in one call.
    - Role promotions to admin/super_admin require super_admin.
    - Admins cannot demote a super_admin.
    - Every change is audit-logged with before/after deltas and an optional reason.
    """
    target = await db.users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Authorization rules for sensitive fields
    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role. Expected one of {sorted(VALID_ROLES)}")
        if body.role in ("admin", "super_admin") and me.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Only super_admin can grant admin/super_admin")
        if target.get("role") == "super_admin" and me.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Cannot modify a super_admin")
        if target.get("user_id") == me.get("user_id") and body.role != me.get("role"):
            raise HTTPException(status_code=400, detail="Admins cannot change their own role")

    if body.plan is not None and body.plan not in VALID_PLANS:
        raise HTTPException(status_code=400, detail=f"Invalid plan. Expected one of {sorted(VALID_PLANS)}")
    if body.status is not None and body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Expected one of {sorted(VALID_STATUSES)}")

    # Build the $set patch with a before/after diff for audit
    updates: dict = {}
    before: dict = {}
    after: dict = {}
    for field in ("plan", "role", "status", "verification_status", "suspension_reason"):
        val = getattr(body, field)
        if val is not None and target.get(field) != val:
            updates[field] = val
            before[field] = target.get(field)
            after[field] = val
    if body.comp_expiration is not None:
        # Accept empty string as "clear"
        if body.comp_expiration == "":
            updates["comp_expiration"] = None
            before["comp_expiration"] = target.get("comp_expiration")
            after["comp_expiration"] = None
        else:
            try:
                parsed = datetime.fromisoformat(body.comp_expiration.replace("Z", "+00:00"))
                updates["comp_expiration"] = parsed
                before["comp_expiration"] = target.get("comp_expiration")
                after["comp_expiration"] = parsed.isoformat()
            except Exception:
                raise HTTPException(status_code=400, detail="comp_expiration must be ISO-8601")

    if not updates:
        return {"ok": True, "no_changes": True}

    updates["updated_at"] = utcnow()
    updates["updated_by"] = me["user_id"]
    await db.users.update_one({"user_id": user_id}, {"$set": updates})
    await audit_log(
        me, "user.update", "user", user_id,
        before=before, after=after, notes=body.reason,
    )
    # Return the fresh user view (no password)
    fresh = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "user": fresh}

# --- AdminNoteIn (server.py:6098-6100) ---
class AdminNoteIn(BaseModel):
    body: str
    pinned: bool = False

# --- AdminGrantPlanIn (server.py:6103-6106) ---
class AdminGrantPlanIn(BaseModel):
    plan: str  # pro | elite | comp_pro | comp_elite | trial_pro | trial_elite | free
    duration_days: Optional[int] = None  # 30 / 90 / 365 / None(=never expire)
    reason: Optional[str] = None

# --- admin_grant_plan (server.py:6109-6150) ---
@router.post("/admin/users/{user_id}/grant-plan")
async def admin_grant_plan(
    user_id: str,
    body: AdminGrantPlanIn,
    me: dict = Depends(require_role("admin")),
):
    """Grant or revoke a paid / comp / trial plan in one call.
    - duration_days: 30, 90, 365 → sets comp_expiration that many days out.
    - duration_days: None → plan never expires (use for paid upgrades).
    - Granting "free" clears plan + comp_expiration.
    """
    target = await db.users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if body.plan not in VALID_PLANS:
        raise HTTPException(status_code=400, detail=f"Invalid plan. Expected one of {sorted(VALID_PLANS)}")

    updates: dict = {"plan": body.plan, "updated_at": utcnow(), "updated_by": me["user_id"]}
    before = {"plan": target.get("plan"), "comp_expiration": target.get("comp_expiration")}

    if body.plan == "free":
        updates["comp_expiration"] = None
        updates["billing_cycle"] = None
    elif body.duration_days and body.duration_days > 0:
        expiry = datetime.now(timezone.utc) + timedelta(days=int(body.duration_days))
        updates["comp_expiration"] = expiry
    else:
        # Permanent grant — clear any previous expiration.
        updates["comp_expiration"] = None

    after = {"plan": updates["plan"], "comp_expiration": updates.get("comp_expiration")}
    if after.get("comp_expiration"):
        after["comp_expiration"] = after["comp_expiration"].isoformat()

    await db.users.update_one({"user_id": user_id}, {"$set": updates})
    await audit_log(
        me, "user.grant_plan", "user", user_id,
        before=before, after=after,
        notes=body.reason or f"Granted {body.plan}" + (f" for {body.duration_days}d" if body.duration_days else " (permanent)"),
    )
    fresh = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "user": fresh}

# --- admin_add_note (server.py:6153-6169) ---
@router.post("/admin/users/{user_id}/notes")
async def admin_add_note(user_id: str, body: AdminNoteIn, me: dict = Depends(require_role("support"))):
    if not (body.body or "").strip():
        raise HTTPException(status_code=400, detail="Note body required")
    doc = {
        "note_id": f"nte_{uuid.uuid4().hex[:12]}",
        "subject_user_id": user_id,
        "author_user_id": me["user_id"],
        "author_email": me.get("email"),
        "body": body.body.strip()[:2000],
        "pinned": bool(body.pinned),
        "created_at": utcnow(),
    }
    await db.admin_notes.insert_one(doc)
    await audit_log(me, "user.note.add", "user", user_id, notes=doc["body"][:100])
    doc.pop("_id", None)
    return doc

# --- admin_audit_logs (server.py:6172-6193) ---
@router.get("/admin/audit-logs")
async def admin_audit_logs(
    page: int = 1,
    limit: int = 50,
    action: Optional[str] = None,
    admin_user_id: Optional[str] = None,
    target_id: Optional[str] = None,
    me: dict = Depends(require_role("admin")),
):
    limit = max(1, min(200, limit))
    page = max(1, page)
    query: dict = {}
    if action:
        query["action"] = {"$regex": f"^{action}", "$options": "i"}
    if admin_user_id:
        query["admin_user_id"] = admin_user_id
    if target_id:
        query["target_id"] = target_id
    total = await db.audit_logs.count_documents(query)
    skip = (page - 1) * limit
    items = await db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"total": total, "page": page, "limit": limit, "items": items}

# --- admin_analytics (server.py:6196-6303) ---
@router.get("/admin/analytics")
async def admin_analytics(days: int = 30, me: dict = Depends(require_role("moderator"))):
    days = max(1, min(90, days))
    now = utcnow()
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

    def _norm(dt):
        if not dt:
            return None
        if getattr(dt, "tzinfo", None) is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    users = await db.users.find({"created_at": {"$gte": start}}, {"_id": 0, "created_at": 1}).to_list(5000)
    spots = await db.spots.find(
        {"created_at": {"$gte": start}},
        {"_id": 0, "created_at": 1, "visibility_status": 1, "city": 1, "state": 1},
    ).to_list(5000)
    approvals = [s for s in spots if s.get("visibility_status") == "approved"]
    rejections = [s for s in spots if s.get("visibility_status") == "rejected"]

    series = []
    for i in range(days):
        d_start = start + timedelta(days=i)
        d_end = d_start + timedelta(days=1)
        series.append({
            "date": d_start.strftime("%Y-%m-%d"),
            "label": d_start.strftime("%a"),
            "signups": sum(1 for u in users if _norm(u.get("created_at")) and d_start <= _norm(u["created_at"]) < d_end),
            "spots": sum(1 for s in spots if _norm(s.get("created_at")) and d_start <= _norm(s["created_at"]) < d_end),
            "approvals": sum(1 for s in approvals if _norm(s.get("created_at")) and d_start <= _norm(s["created_at"]) < d_end),
            "rejections": sum(1 for s in rejections if _norm(s.get("created_at")) and d_start <= _norm(s["created_at"]) < d_end),
        })

    # Saved spots leaderboard (all time)
    saves_agg = await db.spot_saves.aggregate([
        {"$group": {"_id": "$spot_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]).to_list(5)
    most_saved = []
    for row in saves_agg:
        s = await db.spots.find_one({"spot_id": row["_id"]}, {"_id": 0, "spot_id": 1, "title": 1, "city": 1, "state": 1})
        if s:
            s["save_count"] = row["count"]
            most_saved.append(s)

    # Top cities (by approved spot count, all-time — gives a geographic heatmap)
    cities_agg = await db.spots.aggregate([
        {"$match": {"visibility_status": "approved"}},
        {"$group": {
            "_id": {
                "city": "$city",
                "state": "$state",
                "country_code": "$country_code",
            },
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]).to_list(10)
    top_cities = [
        {
            "city": (row["_id"].get("city") or "Unknown"),
            "state": row["_id"].get("state") or "",
            "country_code": row["_id"].get("country_code") or "US",
            "count": row["count"],
        }
        for row in cities_agg
        if row["_id"].get("city")
    ]

    # Top contributors (by approved spot count, all-time)
    contrib_agg = await db.spots.aggregate([
        {"$match": {"visibility_status": "approved"}},
        {"$group": {"_id": "$owner_user_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]).to_list(10)
    contrib_uids = [r["_id"] for r in contrib_agg if r.get("_id")]
    contrib_users = {
        u["user_id"]: u
        for u in await db.users.find(
            {"user_id": {"$in": contrib_uids}},
            {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1,
             "verification_status": 1, "plan": 1, "city": 1, "state": 1},
        ).to_list(20)
    }
    top_contributors = []
    for r in contrib_agg:
        u = contrib_users.get(r["_id"]) if r.get("_id") else None
        if u:
            u["spot_count"] = r["count"]
            top_contributors.append(u)

    return {
        "days": days,
        "series": series,
        "totals": {
            "signups": sum(s["signups"] for s in series),
            "spots": sum(s["spots"] for s in series),
            "approvals": sum(s["approvals"] for s in series),
            "rejections": sum(s["rejections"] for s in series),
        },
        "most_saved": most_saved,
        "top_cities": top_cities,
        "top_contributors": top_contributors,
    }

# --- admin_get_settings (server.py:6306-6308) ---
@router.get("/admin/settings")
async def admin_get_settings(me: dict = Depends(require_role("admin"))):
    return await get_platform_settings()

# --- admin_patch_settings (server.py:6324-6341) ---
@router.patch("/admin/settings")
async def admin_patch_settings(body: PlatformSettingsPatch, me: dict = Depends(require_role("super_admin"))):
    current = await get_platform_settings()
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        return {"ok": True, "settings": current}
    updates["updated_at"] = utcnow()
    updates["updated_by"] = me["user_id"]
    await db.platform_settings.update_one(
        {"settings_id": SETTINGS_SINGLETON_ID}, {"$set": updates}, upsert=True
    )
    await audit_log(
        me, "settings.update", "settings", SETTINGS_SINGLETON_ID,
        before={k: current.get(k) for k in updates.keys()},
        after=updates,
    )
    new = await get_platform_settings()
    return {"ok": True, "settings": new}

