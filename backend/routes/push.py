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
    send_push,
    require_role,
    DEFAULT_NOTIFICATION_PREFERENCES,
)
from services import apns as apns_service

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
    token_type: Optional[str] = None  # "expo" | "apns" | "fcm" (auto-detected if None)

# --- register_push_token (server.py:5518-5538) ---
@router.post("/me/push-token")
async def register_push_token(body: PushTokenIn, user: dict = Depends(get_current_user)):
    # Accept Expo tokens (ExponentPushToken[...]) AND raw APNs device tokens
    # (64 hex chars). token_type is optional — if absent we auto-detect.
    raw = (body.token or "").strip().replace("<", "").replace(">", "").replace(" ", "")
    if not raw:
        raise HTTPException(status_code=400, detail="Empty push token")

    ttype = (body.token_type or "").lower() or None
    if not ttype:
        if raw.startswith("ExponentPushToken"):
            ttype = "expo"
        elif all(c in "0123456789abcdefABCDEF" for c in raw) and len(raw) >= 32:
            ttype = "apns"
        else:
            ttype = "expo"  # default — keep backward compat

    # Minimal validation per type
    if ttype == "expo" and not raw.startswith("ExponentPushToken"):
        raise HTTPException(status_code=400, detail="Not a valid Expo push token")
    if ttype == "apns" and not (all(c in "0123456789abcdefABCDEF" for c in raw) and len(raw) >= 32):
        raise HTTPException(status_code=400, detail="Not a valid APNs device token")

    now = utcnow()
    set_doc = {
        "user_id": user["user_id"],
        "token": raw,
        "token_type": ttype,
        "platform": body.platform or ("ios" if ttype == "apns" else "unknown"),
        "device_id": body.device_id,
        "updated_at": now,
    }
    # Upsert by (user_id, token) so reinstalls don't duplicate.
    # created_at lives only in $setOnInsert so it's preserved on updates and
    # doesn't conflict with $set on the same path.
    await db.push_tokens.update_one(
        {"user_id": user["user_id"], "token": raw},
        {"$set": set_doc, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return {"ok": True, "token_type": ttype}

# --- unregister_push_token (server.py:5541-5544) ---
@router.delete("/me/push-token")
async def unregister_push_token(token: str, user: dict = Depends(get_current_user)):
    await db.push_tokens.delete_one({"user_id": user["user_id"], "token": token})
    return {"ok": True}



# ──────────────────────────────────────────────────────────────────────────
# APNs direct-dispatch admin endpoints (May 2026)
# ──────────────────────────────────────────────────────────────────────────
# These live next to the push-token registry because they share the
# concept of "what tokens does this user have and which transport path
# are they on?". Admin/super_admin only — regular users don't need to
# see APNs internals.

class ApnsTestIn(BaseModel):
    device_token: str
    title: Optional[str] = None
    body: Optional[str] = None


@router.get("/admin/apns/status")
async def apns_status(user: dict = Depends(require_role("admin"))):
    """Return APNs service configuration status.

    Used by /admin/diagnostics to confirm the .p8 key is readable, the
    team/bundle IDs are wired in, and the target endpoint (sandbox vs
    production) is correct. Safe to call in production — returns no secrets.
    """
    # Also report how many APNs-typed tokens are currently on file
    # so operators know whether ANY iOS device has registered yet.
    try:
        apns_count = await db.push_tokens.count_documents({"token_type": "apns"})
    except Exception:
        apns_count = 0
    try:
        expo_count = await db.push_tokens.count_documents(
            {"$or": [{"token_type": "expo"}, {"token_type": {"$exists": False}}]}
        )
    except Exception:
        expo_count = 0
    return {
        **apns_service.debug_status(),
        "registered_apns_tokens": apns_count,
        "registered_expo_tokens": expo_count,
    }


@router.post("/admin/apns/test")
async def apns_test_admin(body: ApnsTestIn, user: dict = Depends(require_role("admin"))):
    """
    Admin-only: dispatch a single APNs push directly to an arbitrary device
    token. Used to validate the .p8 + team + bundle configuration without
    involving a user's preference gating or the daily cap.
    """
    if not apns_service.apns_configured():
        raise HTTPException(status_code=409, detail="APNs not configured on this server")
    result = await apns_service.send_apns(
        body.device_token,
        title=body.title or "LumaScout APNs test",
        body=body.body or "Direct APNs dispatch is working.",
        data={"kind": "apns_test"},
    )
    return result


@router.post("/me/notifications/test-apns")
async def test_apns_me(user: dict = Depends(get_current_user)):
    """
    Caller-facing test — dispatch to EVERY registered push token on the
    caller's account, then report the per-transport breakdown. Bypasses
    quiet hours / daily caps so operators can verify delivery instantly.
    """
    # Reuse the centralized send_push which now handles Expo + APNs split.
    await send_push(
        [user["user_id"]],
        "APNs wiring test 🎯",
        "Direct APNs dispatch should arrive alongside the Expo copy.",
        {"kind": "apns_test", "deep_link": "/notifications"},
    )
    rows = await db.push_tokens.find(
        {"user_id": user["user_id"]}, {"_id": 0, "token": 1, "token_type": 1, "platform": 1},
    ).to_list(20)
    return {"ok": True, "tokens_targeted": len(rows), "tokens": [
        {"type": r.get("token_type") or "expo", "platform": r.get("platform"),
         "token_preview": (r.get("token") or "")[:12] + "…"}
        for r in rows
    ]}

