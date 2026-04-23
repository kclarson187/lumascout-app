"""
routes/push.py — Notification preferences + push-token registry + in-app
notifications list.

Phase 2c of the server.py modularization. 7 endpoints + 2 models covering:
  • GET + PATCH /me/notification-preferences
  • POST /me/notifications/test-push
  • GET /notifications + POST /notifications/mark-read
  • POST + DELETE /me/push-token

The core push dispatch INFRASTRUCTURE (send_growth_push, _emit_notification,
send_push, NOTIFICATION_CATEGORIES, BYPASS_CAP_KINDS, DEFAULT_NOTIFICATION_
PREFERENCES, _is_in_quiet_hours, _BG_PUSH_TASKS) stays in server.py — it is
called from every domain module (marketplace, admin, network, referrals).

PRESERVED SEMANTICS — no behaviour change, no path change.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from server import (
    db,
    get_current_user,
    utcnow,
    send_growth_push,
    DEFAULT_NOTIFICATION_PREFERENCES,
)

router = APIRouter(prefix="/api", tags=["push"])


# --- NotificationPrefsIn (server.py:2709-2714) ---
class NotificationPrefsIn(BaseModel):
    categories: Optional[Dict[str, bool]] = None
    quiet_hours: Optional[Dict[str, Any]] = None  # {enabled, start, end}
    timezone: Optional[str] = None
    daily_cap: Optional[int] = None
    push_enabled: Optional[bool] = None

# --- get_notification_prefs (server.py:2717-2725) ---
@router.get("/me/notification-preferences")
async def get_notification_prefs(user: dict = Depends(get_current_user)):
    """Returns the caller's notification preferences (merged with defaults)."""
    stored = user.get("notification_preferences") or {}
    merged = {**DEFAULT_NOTIFICATION_PREFERENCES, **stored}
    # Deep-merge categories so new categories added later auto-appear as True.
    merged["categories"] = {**DEFAULT_NOTIFICATION_PREFERENCES["categories"],
                             **(stored.get("categories") or {})}
    return merged

# --- update_notification_prefs (server.py:2728-2755) ---
@router.patch("/me/notification-preferences")
async def update_notification_prefs(body: NotificationPrefsIn, user: dict = Depends(get_current_user)):
    """Partial-update of notification_preferences. Each field is optional."""
    current = user.get("notification_preferences") or {}
    merged = {**DEFAULT_NOTIFICATION_PREFERENCES, **current}
    merged["categories"] = {**DEFAULT_NOTIFICATION_PREFERENCES["categories"],
                             **(current.get("categories") or {})}
    if body.categories is not None:
        merged["categories"] = {**merged["categories"], **body.categories}
    if body.quiet_hours is not None:
        # Sanitize time strings to HH:MM
        qh = body.quiet_hours
        merged["quiet_hours"] = {
            "enabled": bool(qh.get("enabled", merged["quiet_hours"]["enabled"])),
            "start":   str(qh.get("start", merged["quiet_hours"]["start"]))[:5],
            "end":     str(qh.get("end",   merged["quiet_hours"]["end"]))[:5],
        }
    if body.timezone is not None:
        merged["timezone"] = body.timezone[:60]
    if body.daily_cap is not None:
        merged["daily_cap"] = max(1, min(50, int(body.daily_cap)))
    if body.push_enabled is not None:
        merged["push_enabled"] = bool(body.push_enabled)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"notification_preferences": merged, "updated_at": utcnow()}},
    )
    return merged

# --- test_push (server.py:2758-2768) ---
@router.post("/me/notifications/test-push")
async def test_push(user: dict = Depends(get_current_user)):
    """Send a test push to the caller to verify device-level delivery.
    Respects quiet-hours / category gating to make debugging obvious."""
    ok = await send_growth_push(
        user["user_id"], kind="upgrade_nudge",
        title="Notifications are working 🎉",
        body="This is a test push from LumaScout. Tap to see recent activity.",
        deep_link="/notifications",
    )
    return {"delivered": ok}

# --- list_notifications (server.py:2771-2794) ---
@router.get("/notifications")
async def list_notifications(
    limit: int = 30,
    unread_only: bool = False,
    user: dict = Depends(get_current_user),
):
    q: dict = {"user_id": user["user_id"]}
    if unread_only:
        q["read_at"] = None
    limit = max(1, min(100, limit))
    items = await db.notifications.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    # Hydrate actor (name + avatar) for nicer UI
    actor_ids = list({n.get("actor_user_id") for n in items if n.get("actor_user_id")})
    amap: Dict[str, dict] = {}
    if actor_ids:
        rows = await db.users.find(
            {"user_id": {"$in": actor_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1},
        ).to_list(len(actor_ids))
        amap = {r["user_id"]: r for r in rows}
    for n in items:
        n["actor"] = amap.get(n.get("actor_user_id"))
    unread = await db.notifications.count_documents({"user_id": user["user_id"], "read_at": None})
    return {"items": items, "unread_count": unread}

# --- mark_notifications_read (server.py:2797-2814) ---
@router.post("/notifications/mark-read")
async def mark_notifications_read(
    notification_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Mark one by id, or ALL unread if no id is supplied."""
    now = utcnow()
    if notification_id:
        await db.notifications.update_one(
            {"notification_id": notification_id, "user_id": user["user_id"]},
            {"$set": {"read_at": now}},
        )
    else:
        await db.notifications.update_many(
            {"user_id": user["user_id"], "read_at": None},
            {"$set": {"read_at": now}},
        )
    return {"ok": True}

# --- PushTokenIn (server.py:5512-5515) ---
class PushTokenIn(BaseModel):
    token: str
    platform: Optional[str] = None   # "ios" | "android" | "web"
    device_id: Optional[str] = None

# --- register_push_token (server.py:5518-5538) ---
@router.post("/me/push-token")
async def register_push_token(body: PushTokenIn, user: dict = Depends(get_current_user)):
    if not body.token or not body.token.startswith("ExponentPushToken"):
        raise HTTPException(status_code=400, detail="Not a valid Expo push token")
    now = utcnow()
    set_doc = {
        "user_id": user["user_id"],
        "token": body.token,
        "platform": body.platform or "unknown",
        "device_id": body.device_id,
        "updated_at": now,
    }
    # Upsert by (user_id, token) so reinstalls don't duplicate.
    # created_at lives only in $setOnInsert so it's preserved on updates and
    # doesn't conflict with $set on the same path.
    await db.push_tokens.update_one(
        {"user_id": user["user_id"], "token": body.token},
        {"$set": set_doc, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return {"ok": True}

# --- unregister_push_token (server.py:5541-5544) ---
@router.delete("/me/push-token")
async def unregister_push_token(token: str, user: dict = Depends(get_current_user)):
    await db.push_tokens.delete_one({"user_id": user["user_id"], "token": token})
    return {"ok": True}

