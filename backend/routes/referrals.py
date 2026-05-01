"""
routes/referrals.py — Referral Marketplace (gig-board).

Phase 2b of the server.py modularization. 10 endpoints + 3 request models +
1 shaper covering:
  • Create / list / search / rails / get / update / delete referral needs
  • Apply to a need (opens DM thread with poster)
  • Accept / reject an application (notifies applicants)
  • My needs + my applications

PRESERVED SEMANTICS — no behaviour change, no path change.
"""
# Batch #7 — intentionally NOT using `from __future__ import annotations`
# in this module. That future import stringifies every annotation, and
# when combined with @_graceful (which uses functools.wraps and thus
# preserves the wrapped signature) FastAPI fails to resolve
# `body: ReferralCreateIn` as a JSON body — it degrades to a Query
# parameter, which in turn breaks /openapi.json and every POST /referrals
# call. Leaving annotations eagerly-evaluated here fixes both.

import logging as _logging
import uuid

# Batch #7 — graceful fallback wrapper. Used on `POST /referrals` so a
# single unhandled validator / DB hiccup doesn't surface as a raw 500
# to the creator composer UI.
from common.graceful import graceful as _graceful
_ref_logger = _logging.getLogger("referrals.create")
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

from server import (
    db,
    get_current_user, get_optional_user,
    utcnow, plan_of, _effective_plan,
    _emit_notification, send_growth_push,
    _dm_get_or_create_thread, _dm_insert_message,
    _hydrate_poster,
    GIG_TYPES, REFERRAL_STATUSES, REFERRAL_APPLY_CAP_FREE_MONTH,
)

router = APIRouter(prefix="/api", tags=["referrals"])


# --- ReferralCreateIn (server.py:6633-6680) ---
class ReferralCreateIn(BaseModel):
    title: str
    shoot_type: str
    gig_type: str
    city: str
    state: Optional[str] = None
    country: Optional[str] = "US"
    event_date: Optional[str] = None           # ISO date (YYYY-MM-DD)
    duration_hours: Optional[float] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    budget_currency: Optional[str] = "USD"
    notes: Optional[str] = None
    reference_images: Optional[List[str]] = None  # base64 data: urls (up to 4)
    urgency: Optional[str] = "normal"          # "urgent" | "normal"
    expires_in_days: Optional[int] = 30        # 1..90

    @field_validator("title")
    @classmethod
    def _title_guard(cls, v: str) -> str:
        v = (v or "").strip()
        if len(v) < 4:
            raise ValueError("Title must be at least 4 characters.")
        if len(v) > 140:
            raise ValueError("Title must be 140 characters or fewer.")
        return v

    @field_validator("gig_type")
    @classmethod
    def _gig_guard(cls, v: str) -> str:
        if v not in GIG_TYPES:
            raise ValueError(f"gig_type must be one of {', '.join(GIG_TYPES)}")
        return v

    @field_validator("urgency")
    @classmethod
    def _urgency_guard(cls, v: Optional[str]) -> str:
        v = (v or "normal").lower()
        return "urgent" if v == "urgent" else "normal"

    @field_validator("reference_images")
    @classmethod
    def _refs_guard(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if not v:
            return None
        if len(v) > 4:
            raise ValueError("Up to 4 reference images allowed.")
        return v

# --- ReferralUpdateIn (server.py:6683-6695) ---
class ReferralUpdateIn(BaseModel):
    status: Optional[str] = None               # open | reviewing | filled | closed
    notes: Optional[str] = None
    urgency: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _s_guard(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if v not in REFERRAL_STATUSES:
            raise ValueError("Invalid status")
        return v

# --- ReferralApplyIn (server.py:6698-6707) ---
class ReferralApplyIn(BaseModel):
    pitch: Optional[str] = None

    @field_validator("pitch")
    @classmethod
    def _pitch_guard(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip() or None
        if v and len(v) > 1000:
            raise ValueError("Pitch must be 1000 characters or fewer.")
        return v

# --- _shape_need (server.py:6730-6753) ---
async def _shape_need(need: dict, viewer: Optional[dict] = None) -> dict:
    """Public-safe representation; hydrates poster + applicant_count + is_mine
    + my_application (for viewer). Never leaks email/password_hash."""
    need = dict(need)
    need.pop("_id", None)
    need["poster"] = await _hydrate_poster(need.get("poster_user_id"))
    need["applicant_count"] = await db.referral_applications.count_documents(
        {"need_id": need["need_id"]}
    )
    need["is_mine"] = bool(viewer and viewer.get("user_id") == need.get("poster_user_id"))
    need["my_application"] = None
    if viewer and not need["is_mine"]:
        app = await db.referral_applications.find_one(
            {"need_id": need["need_id"], "applicant_user_id": viewer["user_id"]},
            {"_id": 0},
        )
        if app:
            need["my_application"] = {
                "app_id": app.get("app_id"),
                "status": app.get("status"),
                "created_at": app.get("created_at"),
                "thread_id": app.get("thread_id"),
            }
    return need

# --- create_referral_need (server.py:6756-6825) ---
@router.post("/referrals")
@_graceful(
    fallback={"ok": False, "error": "We couldn't create your referral right now. Please try again.",
              "degraded": True, "need_id": None},
    label="/referrals",
    logger=_ref_logger,
)
async def create_referral_need(
    # Batch #7 — explicit Body(...) annotation is REQUIRED here because this
    # file uses `from __future__ import annotations` AND the handler is
    # wrapped by @_graceful (functools.wraps). Under those two conditions
    # FastAPI's dependency resolver cannot tell that `ReferralCreateIn` is
    # a pydantic model rather than a raw Query parameter, which blows up
    # the body parse (and /openapi.json). Naming Body() explicitly sidesteps
    # the inference step entirely.
    body: ReferralCreateIn = Body(...),
    user: dict = Depends(get_current_user),
):
    now = utcnow()
    exp_days = max(1, min(int(body.expires_in_days or 30), 90))
    event_date_dt = None
    if body.event_date:
        try:
            event_date_dt = datetime.fromisoformat(body.event_date.replace("Z", "+00:00"))
        except Exception:
            event_date_dt = None
    doc = {
        "need_id": f"need_{uuid.uuid4().hex[:12]}",
        "poster_user_id": user["user_id"],
        "poster_plan": plan_of(user),
        "title": body.title,
        "shoot_type": body.shoot_type,
        "gig_type": body.gig_type,
        "city": body.city,
        "state": body.state,
        "country": body.country or "US",
        "event_date": event_date_dt,
        "duration_hours": body.duration_hours,
        "budget_min": body.budget_min,
        "budget_max": body.budget_max,
        "budget_currency": (body.budget_currency or "USD").upper(),
        "notes": (body.notes or "").strip() or None,
        "reference_images": body.reference_images or [],
        "urgency": body.urgency,
        "status": "open",
        "accepted_user_id": None,
        "posted_at": now,
        "updated_at": now,
        "expires_at": now + timedelta(days=exp_days),
        # Elite posters get a featured flag for rail sorting
        "is_featured": plan_of(user) == "elite",
    }
    await db.referral_needs.insert_one(doc)

    # Push "referral opportunity nearby" to available photographers in the
    # same city (excluding the poster). 1-hr same-city dedupe handled by
    # send_growth_push's 10-min dedupe on (user_id, kind, title). Cap batch
    # to 50 to respect Expo limits + platform quiet-hours.
    try:
        city = (body.city or "").strip()
        if city:
            q_targets = {
                "available_for_referrals": True,
                "user_id": {"$ne": user["user_id"]},
                "city": city,
            }
            cursor = db.users.find(q_targets, {"_id": 0, "user_id": 1}).limit(50)
            async for tgt in cursor:
                tid = tgt.get("user_id")
                if not tid:
                    continue
                shoot = (body.shoot_type or "shoot").replace("_", " ")
                await _emit_notification(
                    tid,
                    "referral_nearby",
                    f"New {shoot} gig in {city}",
                    f"{(body.title or 'A photographer')[:80]} — tap to apply",
                    actor_user_id=user["user_id"],
                    deep_link=f"/referrals/{doc['need_id']}",
                )
    except Exception:
        pass

    return await _shape_need(doc, user)

# --- list_referral_needs (server.py:6828-6884) ---
@router.get("/referrals")
async def list_referral_needs(
    q: Optional[str] = None,
    city: Optional[str] = None,
    gig_type: Optional[str] = None,
    shoot_type: Optional[str] = None,
    status: Optional[str] = None,            # defaults to "open" below
    urgent: Optional[bool] = None,
    sort: Optional[str] = "recent",          # recent | soonest | oldest
    limit: int = 30,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    """Browse referral needs. Default filters to status=open."""
    filt: dict = {}
    if status:
        filt["status"] = status
    else:
        filt["status"] = "open"
    if city:
        filt["city"] = {"$regex": f"^{city}$", "$options": "i"}
    if gig_type:
        filt["gig_type"] = gig_type
    if shoot_type:
        filt["shoot_type"] = shoot_type
    if urgent:
        filt["urgency"] = "urgent"
    if q:
        filt["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"notes": {"$regex": q, "$options": "i"}},
            {"shoot_type": {"$regex": q, "$options": "i"}},
            {"city": {"$regex": q, "$options": "i"}},
        ]
    # Auto-expire: mark anything past expires_at as expired (non-blocking)
    try:
        await db.referral_needs.update_many(
            {"status": "open", "expires_at": {"$lt": utcnow()}},
            {"$set": {"status": "expired", "updated_at": utcnow()}},
        )
    except Exception:
        pass
    # Sort: featured first, then chosen order
    if sort == "soonest":
        cur = db.referral_needs.find(filt, {"_id": 0}).sort(
            [("is_featured", -1), ("event_date", 1), ("posted_at", -1)]
        )
    elif sort == "oldest":
        cur = db.referral_needs.find(filt, {"_id": 0}).sort(
            [("is_featured", -1), ("posted_at", 1)]
        )
    else:
        cur = db.referral_needs.find(filt, {"_id": 0}).sort(
            [("is_featured", -1), ("posted_at", -1)]
        )
    rows = await cur.limit(max(1, min(limit, 100))).to_list(length=max(1, min(limit, 100)))
    items = [await _shape_need(r, viewer) for r in rows]
    return {"items": items, "count": len(items)}

# --- referral_rails (server.py:6887-6942) ---
@router.get("/referrals/rails")
async def referral_rails(
    city: Optional[str] = None,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    """Return 6 horizontal rails of referral needs for the Network tab.
       Each rail caps at 10 items, filtered to open+non-expired."""
    viewer_city = city or (viewer or {}).get("city")
    base = {"status": "open"}
    try:
        await db.referral_needs.update_many(
            {"status": "open", "expires_at": {"$lt": utcnow()}},
            {"$set": {"status": "expired", "updated_at": utcnow()}},
        )
    except Exception:
        pass

    async def _fetch(q: dict, sort_fields: list, limit: int = 10) -> list:
        cur = db.referral_needs.find(q, {"_id": 0}).sort(sort_fields)
        rows = await cur.limit(limit).to_list(length=limit)
        return [await _shape_need(r, viewer) for r in rows]

    rails = {
        "urgent": await _fetch(
            {**base, "urgency": "urgent"},
            [("is_featured", -1), ("posted_at", -1)],
        ),
        "nearby": await _fetch(
            {**base, "city": {"$regex": f"^{viewer_city}$", "$options": "i"}}
            if viewer_city else base,
            [("is_featured", -1), ("posted_at", -1)],
        ),
        "wedding": await _fetch(
            {**base, "$or": [
                {"gig_type": "wedding_support"},
                {"shoot_type": {"$regex": "wedding", "$options": "i"}},
            ]},
            [("is_featured", -1), ("posted_at", -1)],
        ),
        "pet": await _fetch(
            {**base, "$or": [
                {"gig_type": "pet_session"},
                {"shoot_type": {"$regex": "pet", "$options": "i"}},
            ]},
            [("is_featured", -1), ("posted_at", -1)],
        ),
        "second_shooter": await _fetch(
            {**base, "gig_type": {"$in": ["second_shooter", "associate_shooter"]}},
            [("is_featured", -1), ("posted_at", -1)],
        ),
        "new_today": await _fetch(
            {**base, "posted_at": {"$gte": utcnow() - timedelta(days=1)}},
            [("is_featured", -1), ("posted_at", -1)],
        ),
    }
    return rails

# --- my_referral_needs (server.py:6945-6950) ---
@router.get("/me/referrals")
async def my_referral_needs(user: dict = Depends(get_current_user)):
    cur = db.referral_needs.find({"poster_user_id": user["user_id"]}, {"_id": 0}).sort("posted_at", -1)
    rows = await cur.to_list(length=200)
    items = [await _shape_need(r, user) for r in rows]
    return {"items": items, "count": len(items)}

# --- my_referral_applications (server.py:6953-6968) ---
@router.get("/me/applications")
async def my_referral_applications(user: dict = Depends(get_current_user)):
    cur = db.referral_applications.find(
        {"applicant_user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1)
    apps = await cur.to_list(length=200)
    items: List[dict] = []
    for a in apps:
        need = await db.referral_needs.find_one({"need_id": a["need_id"]}, {"_id": 0})
        if not need:
            continue
        items.append({
            **a,
            "need": await _shape_need(need, user),
        })
    return {"items": items, "count": len(items)}

# --- get_referral_need (server.py:6971-6991) ---
@router.get("/referrals/{need_id}")
async def get_referral_need(
    need_id: str,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    need = await db.referral_needs.find_one({"need_id": need_id}, {"_id": 0})
    if not need:
        raise HTTPException(status_code=404, detail="Referral not found")
    shaped = await _shape_need(need, viewer)
    # If viewer is the poster, include the full applicant list
    if viewer and viewer.get("user_id") == need.get("poster_user_id"):
        cur = db.referral_applications.find({"need_id": need_id}, {"_id": 0}).sort("created_at", -1)
        apps = await cur.to_list(length=500)
        hydrated_apps: List[dict] = []
        for a in apps:
            hydrated_apps.append({
                **a,
                "applicant": await _hydrate_poster(a.get("applicant_user_id")),
            })
        shaped["applications"] = hydrated_apps
    return shaped

# --- update_referral_need (server.py:6994-7013) ---
@router.patch("/referrals/{need_id}")
async def update_referral_need(
    need_id: str, body: ReferralUpdateIn,
    user: dict = Depends(get_current_user),
):
    need = await db.referral_needs.find_one({"need_id": need_id})
    if not need:
        raise HTTPException(status_code=404, detail="Referral not found")
    if need["poster_user_id"] != user["user_id"] and user.get("role") not in ("admin", "super_admin", "moderator"):
        raise HTTPException(status_code=403, detail="Not authorized")
    patch = {"updated_at": utcnow()}
    if body.status is not None:
        patch["status"] = body.status
    if body.notes is not None:
        patch["notes"] = body.notes.strip() or None
    if body.urgency is not None:
        patch["urgency"] = "urgent" if body.urgency == "urgent" else "normal"
    await db.referral_needs.update_one({"need_id": need_id}, {"$set": patch})
    need = await db.referral_needs.find_one({"need_id": need_id}, {"_id": 0})
    return await _shape_need(need, user)

# --- delete_referral_need (server.py:7016-7025) ---
@router.delete("/referrals/{need_id}")
async def delete_referral_need(need_id: str, user: dict = Depends(get_current_user)):
    need = await db.referral_needs.find_one({"need_id": need_id})
    if not need:
        raise HTTPException(status_code=404, detail="Referral not found")
    if need["poster_user_id"] != user["user_id"] and user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Not authorized")
    await db.referral_needs.delete_one({"need_id": need_id})
    await db.referral_applications.delete_many({"need_id": need_id})
    return {"ok": True}

# --- apply_to_referral (server.py:7028-7101) ---
@router.post("/referrals/{need_id}/apply")
async def apply_to_referral(
    need_id: str, body: ReferralApplyIn,
    user: dict = Depends(get_current_user),
):
    need = await db.referral_needs.find_one({"need_id": need_id})
    if not need:
        raise HTTPException(status_code=404, detail="Referral not found")
    if need["poster_user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="You cannot apply to your own referral")
    if need.get("status") not in ("open", "reviewing"):
        raise HTTPException(status_code=400, detail="This referral is no longer accepting applicants")
    # Dedupe — one application per (need, applicant)
    existing = await db.referral_applications.find_one({
        "need_id": need_id, "applicant_user_id": user["user_id"],
    })
    if existing:
        raise HTTPException(status_code=409, detail="You have already applied to this referral")
    # Tier-based monthly cap (free = 5 / month)
    tier = _effective_plan(plan_of(user))
    if tier == "free":
        month_start = utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        used = await db.referral_applications.count_documents({
            "applicant_user_id": user["user_id"],
            "created_at": {"$gte": month_start},
        })
        if used >= REFERRAL_APPLY_CAP_FREE_MONTH:
            raise HTTPException(
                status_code=402,
                detail=f"Free plan limit: {REFERRAL_APPLY_CAP_FREE_MONTH} applications per month. Upgrade to Pro for unlimited.",
            )
    # Auto-create DM thread so poster + applicant can chat
    thread = await _dm_get_or_create_thread(user["user_id"], need["poster_user_id"])
    opening_body = (body.pitch or "").strip() or (
        f"Hi! I'd love to apply for \"{need.get('title')}\"."
    )
    try:
        await _dm_insert_message(thread, user, {
            "type": "text",
            "body": f"📌 Applied to your referral: \"{need.get('title')}\"\n\n{opening_body}",
        })
    except Exception:
        pass
    now = utcnow()
    app_doc = {
        "app_id": f"app_{uuid.uuid4().hex[:12]}",
        "need_id": need_id,
        "applicant_user_id": user["user_id"],
        "pitch": opening_body,
        "status": "pending",
        "thread_id": thread["thread_id"],
        "created_at": now,
        "updated_at": now,
    }
    await db.referral_applications.insert_one(app_doc)
    # Flip need to "reviewing" on first applicant
    await db.referral_needs.update_one(
        {"need_id": need_id, "status": "open"},
        {"$set": {"status": "reviewing", "updated_at": now}},
    )
    # Notify the poster
    try:
        await _emit_notification(
            need["poster_user_id"],
            "new_referral_applicant",
            f"New applicant: {user.get('name') or 'Someone'}",
            (opening_body[:140] + "…") if len(opening_body) > 140 else opening_body,
            actor_user_id=user["user_id"],
            deep_link=f"/referrals/{need_id}",
        )
    except Exception:
        pass
    app_doc.pop("_id", None)
    return app_doc

# --- accept_referral_application (server.py:7104-7142) ---
@router.post("/referrals/{need_id}/applications/{app_id}/accept")
async def accept_referral_application(
    need_id: str, app_id: str,
    user: dict = Depends(get_current_user),
):
    need = await db.referral_needs.find_one({"need_id": need_id})
    if not need:
        raise HTTPException(status_code=404, detail="Referral not found")
    if need["poster_user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    app = await db.referral_applications.find_one({"app_id": app_id, "need_id": need_id})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    now = utcnow()
    await db.referral_applications.update_one(
        {"app_id": app_id}, {"$set": {"status": "accepted", "updated_at": now}},
    )
    # Auto-reject any other pending apps for this need
    await db.referral_applications.update_many(
        {"need_id": need_id, "app_id": {"$ne": app_id}, "status": "pending"},
        {"$set": {"status": "rejected", "updated_at": now}},
    )
    await db.referral_needs.update_one(
        {"need_id": need_id},
        {"$set": {"status": "filled", "accepted_user_id": app["applicant_user_id"], "updated_at": now}},
    )
    # Notify the applicant
    try:
        await _emit_notification(
            app["applicant_user_id"],
            "referral_application_accepted",
            "You got the job! 🎉",
            f"{user.get('name') or 'A photographer'} accepted your application for \"{need.get('title')}\"",
            actor_user_id=user["user_id"],
            deep_link=f"/referrals/{need_id}",
        )
    except Exception:
        pass
    return {"ok": True, "need_id": need_id, "accepted_app_id": app_id}

# --- reject_referral_application (server.py:7145-7159) ---
@router.post("/referrals/{need_id}/applications/{app_id}/reject")
async def reject_referral_application(
    need_id: str, app_id: str,
    user: dict = Depends(get_current_user),
):
    need = await db.referral_needs.find_one({"need_id": need_id})
    if not need:
        raise HTTPException(status_code=404, detail="Referral not found")
    if need["poster_user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    await db.referral_applications.update_one(
        {"app_id": app_id, "need_id": need_id},
        {"$set": {"status": "rejected", "updated_at": utcnow()}},
    )
    return {"ok": True}

