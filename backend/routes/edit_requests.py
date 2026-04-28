"""
Spot Edit Request workflow (Batch 2 · Apr 2026).

Owners of a spot can submit a "change request" that proposes new values
for title / description / tags / best_light_notes / parking_notes /
access_notes / safety_notes / tips / photo_order / featured_image_url.
An admin or super_admin reviews the diff and approves or rejects.

All approvals are applied atomically to the spot document and emit an
audit_log entry + a notification to the owner. Rejections also emit a
notification (with the admin's note). Approved/rejected requests stay
in the DB for audit — they're never deleted.

This module is imported by server.py's `app.include_router(router)` call
so all endpoints hit the `/api` prefix.
"""
from __future__ import annotations

import uuid
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from server import (
    db, get_current_user, require_role, utcnow,
    audit_log, _emit_notification,
)

router = APIRouter(prefix="/api", tags=["edit_requests"])

# ----------------------------------------------------------------------------
# Whitelist of fields the owner may propose via a request. Keeping this
# explicit prevents a malicious request body from sneaking in unexpected
# fields (role, plan, etc.) that aren't supposed to be user-editable.
# ----------------------------------------------------------------------------
ALLOWED_EDIT_FIELDS = {
    "title",
    "description",
    "shoot_types",         # tags
    "best_light_notes",    # new-style best-time field
    "best_time_of_day",    # legacy multi-chip field (kept for back-compat)
    "parking_notes",
    "access_notes",
    "safety_notes",
    "tips",
    "photo_order",         # list[str] of image_urls in order
    "featured_image_url",  # url of image within spot.images to set as cover
}


class EditRequestIn(BaseModel):
    changes: Dict[str, Any] = Field(default_factory=dict)
    reason_note: Optional[str] = None  # why the owner is requesting


class EditRequestDecisionIn(BaseModel):
    note: Optional[str] = None  # admin note (required for reject, optional approve)


def _sanitize_changes(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Only keep known fields with non-None values."""
    out: Dict[str, Any] = {}
    for k, v in (raw or {}).items():
        if k in ALLOWED_EDIT_FIELDS and v is not None:
            out[k] = v
    return out


def _public_edit_request(doc: dict) -> dict:
    return {
        "request_id": doc["request_id"],
        "spot_id": doc["spot_id"],
        "owner_user_id": doc["owner_user_id"],
        "status": doc.get("status", "pending"),
        "changes": doc.get("changes", {}),
        "before": doc.get("before", {}),
        "reason_note": doc.get("reason_note"),
        "created_at": doc.get("created_at"),
        "decided_at": doc.get("decided_at"),
        "decided_by_user_id": doc.get("decided_by_user_id"),
        "decision_note": doc.get("decision_note"),
    }


# ============================================================================
# OWNER: submit an edit request
# ============================================================================
@router.post("/spots/{spot_id}/edit-request")
async def owner_submit_edit_request(
    spot_id: str,
    body: EditRequestIn,
    user: dict = Depends(get_current_user),
):
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")

    # Only the owner can request edits. Admins use direct-edit instead.
    owner_fields = (spot.get("owner_user_id"), spot.get("created_by"), spot.get("user_id"))
    if user["user_id"] not in owner_fields:
        raise HTTPException(status_code=403, detail="Only the uploader can request edits")

    changes = _sanitize_changes(body.changes)
    if not changes:
        raise HTTPException(status_code=400, detail="No valid fields to change")

    # Snapshot the "before" values for exactly the fields being changed so
    # admins see a true diff without pulling the whole doc.
    before = {k: spot.get(k) for k in changes.keys()}

    # Idempotency-ish: reject if an open request already exists for this
    # user+spot. Owners shouldn't spam the queue.
    existing = await db.spot_edit_requests.find_one({
        "spot_id": spot_id,
        "owner_user_id": user["user_id"],
        "status": "pending",
    })
    if existing:
        raise HTTPException(
            status_code=409,
            detail="You already have a pending edit request on this spot. Wait for review or edit that one.",
        )

    doc = {
        "request_id": f"edr_{uuid.uuid4().hex[:12]}",
        "spot_id": spot_id,
        "spot_title": spot.get("title"),
        "owner_user_id": user["user_id"],
        "owner_name": user.get("name") or user.get("email"),
        "changes": changes,
        "before": before,
        "reason_note": (body.reason_note or "").strip() or None,
        "status": "pending",
        "created_at": utcnow(),
    }
    await db.spot_edit_requests.insert_one(doc)
    await audit_log(
        user, "spot.edit_request.submit", "spot", spot_id,
        after={"request_id": doc["request_id"], "field_count": len(changes)},
    )
    return _public_edit_request(doc)


# ============================================================================
# OWNER: view my edit requests on a spot
# ============================================================================
@router.get("/spots/{spot_id}/edit-requests/mine")
async def owner_list_my_edit_requests(
    spot_id: str,
    user: dict = Depends(get_current_user),
):
    items = await db.spot_edit_requests.find(
        {"spot_id": spot_id, "owner_user_id": user["user_id"]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    return {"items": [_public_edit_request(d) for d in items]}


# ============================================================================
# ADMIN: queue of pending requests
# ============================================================================
@router.get("/admin/edit-requests")
async def admin_list_edit_requests(
    status: str = "pending",
    limit: int = 100,
    me: dict = Depends(require_role("moderator")),
):
    q: dict = {}
    if status != "all":
        q["status"] = status
    items = await db.spot_edit_requests.find(q, {"_id": 0}) \
        .sort("created_at", -1).limit(max(1, min(limit, 200))).to_list(200)
    # Hydrate minimal spot/owner context so the admin list UI doesn't need
    # extra round-trips. Keep payload small — just titles + avatar.
    spot_ids = sorted({i["spot_id"] for i in items})
    user_ids = sorted({i["owner_user_id"] for i in items})
    spots = {
        s["spot_id"]: s async for s in db.spots.find(
            {"spot_id": {"$in": spot_ids}},
            {"_id": 0, "spot_id": 1, "title": 1, "city": 1, "state": 1, "images": 1, "hero_cover_image_url": 1},
        )
    }
    users = {
        u["user_id"]: u async for u in db.users.find(
            {"user_id": {"$in": user_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1, "role": 1, "plan": 1},
        )
    }
    out: List[dict] = []
    for i in items:
        pub = _public_edit_request(i)
        s = spots.get(i["spot_id"]) or {}
        pub["spot"] = {
            "spot_id": s.get("spot_id"),
            "title": s.get("title"),
            "city": s.get("city"),
            "state": s.get("state"),
            "cover_image_url": s.get("hero_cover_image_url") or (
                (s.get("images") or [{}])[0].get("image_url") if s.get("images") else None
            ),
        }
        pub["owner"] = users.get(i["owner_user_id"]) or None
        out.append(pub)
    return {"items": out, "count": len(out)}


# ============================================================================
# ADMIN: approve a request → apply changes to the spot atomically
# ============================================================================
@router.post("/admin/edit-requests/{request_id}/approve")
async def admin_approve_edit_request(
    request_id: str,
    body: EditRequestDecisionIn,
    me: dict = Depends(require_role("moderator")),
):
    req = await db.spot_edit_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Edit request not found")
    if req.get("status") != "pending":
        raise HTTPException(status_code=409, detail=f"Already {req.get('status')}")

    changes = _sanitize_changes(req.get("changes") or {})
    if not changes:
        raise HTTPException(status_code=400, detail="No changes to apply")

    spot = await db.spots.find_one({"spot_id": req["spot_id"]}, {"_id": 0})
    if not spot:
        # Spot was deleted after the request was created — clean up and tell admin.
        await db.spot_edit_requests.update_one(
            {"request_id": request_id},
            {"$set": {
                "status": "rejected",
                "decided_at": utcnow(),
                "decided_by_user_id": me["user_id"],
                "decision_note": "Spot no longer exists.",
            }},
        )
        raise HTTPException(status_code=410, detail="Spot was deleted — request auto-rejected")

    # Apply changes. If the request includes `featured_image_url`, also
    # stamp `admin_cover_override` so the server-side hero_cover
    # computation picks it up — this is the field Explore cards, map
    # cards, and the Detail page all read from (via
    # _decorate_spot_with_hero_cover). Writing only to
    # `hero_cover_image_url` would be overwritten on the next read; the
    # admin_cover_override object is the durable source of truth.
    update_set: dict = dict(changes)
    if "featured_image_url" in changes and changes["featured_image_url"]:
        update_set["admin_cover_override"] = {
            "image_url": changes["featured_image_url"],
            "set_by_user_id": me["user_id"],
            "set_by_role": me.get("role"),
            "set_at": utcnow(),
            "source": "owner_edit_request_approved",
        }
        # Also set the denormalised field so clients that already cached
        # the spot (and won't re-fetch it immediately) still pick it up
        # on their next list refresh.
        update_set["hero_cover_image_url"] = changes["featured_image_url"]
    update_set["updated_at"] = utcnow()

    # If photo_order was requested, actually re-sort spot.images to match.
    if "photo_order" in changes and isinstance(changes["photo_order"], list):
        order = changes["photo_order"]
        existing_imgs = spot.get("images") or []
        url_to_img = {img.get("image_url"): img for img in existing_imgs if img.get("image_url")}
        reordered = [url_to_img[u] for u in order if u in url_to_img]
        # Append any images not listed (keeps safety — never drops photos here)
        remaining = [img for img in existing_imgs if img.get("image_url") not in set(order)]
        update_set["images"] = reordered + remaining

    await db.spots.update_one({"spot_id": req["spot_id"]}, {"$set": update_set})

    await db.spot_edit_requests.update_one(
        {"request_id": request_id},
        {"$set": {
            "status": "approved",
            "decided_at": utcnow(),
            "decided_by_user_id": me["user_id"],
            "decision_note": (body.note or "").strip() or None,
        }},
    )

    await audit_log(
        me, "spot.edit_request.approve", "spot", req["spot_id"],
        before=req.get("before") or {},
        after={"applied": list(changes.keys()), "request_id": request_id},
        notes=(body.note or None),
    )

    # Notify the owner.
    try:
        await _emit_notification(
            user_id=req["owner_user_id"],
            kind="spot_edit_approved",
            title="Your edits were approved",
            body=f'Changes to "{req.get("spot_title") or "your spot"}" are live.',
            spot_id=req["spot_id"],
            deep_link=f"/spot/{req['spot_id']}",
            actor_user_id=me["user_id"],
        )
    except Exception:
        pass

    return {"ok": True, "request_id": request_id, "applied": list(changes.keys())}


# ============================================================================
# ADMIN: reject
# ============================================================================
@router.post("/admin/edit-requests/{request_id}/reject")
async def admin_reject_edit_request(
    request_id: str,
    body: EditRequestDecisionIn,
    me: dict = Depends(require_role("moderator")),
):
    req = await db.spot_edit_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Edit request not found")
    if req.get("status") != "pending":
        raise HTTPException(status_code=409, detail=f"Already {req.get('status')}")

    note = (body.note or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="A rejection note is required so the uploader knows why")

    await db.spot_edit_requests.update_one(
        {"request_id": request_id},
        {"$set": {
            "status": "rejected",
            "decided_at": utcnow(),
            "decided_by_user_id": me["user_id"],
            "decision_note": note,
        }},
    )
    await audit_log(
        me, "spot.edit_request.reject", "spot", req["spot_id"],
        after={"request_id": request_id, "note": note},
    )
    try:
        await _emit_notification(
            user_id=req["owner_user_id"],
            kind="spot_edit_rejected",
            title="Your edit request wasn't approved",
            body=note[:180],
            spot_id=req["spot_id"],
            deep_link=f"/spot/{req['spot_id']}",
            actor_user_id=me["user_id"],
        )
    except Exception:
        pass
    return {"ok": True, "request_id": request_id}
