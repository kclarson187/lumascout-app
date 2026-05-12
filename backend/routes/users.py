"""
routes/users.py — Public user profiles + /me dashboards + user reports.

Phase 4 of the server.py modularization (smaller, tactical split — many
/me/* endpoints already migrated with their domain modules in earlier phases).
9 endpoints + 2 request models covering:
  • GET  /users/{user_id} — public profile with hydrated stats
  • POST /users/{user_id}/report — flag a user for moderation
  • POST /me/upgrade — plan upgrade handshake (NOT the Stripe checkout)
  • GET  /me/recent-locations, /me/drafts, /me/trends, /me/dashboard
  • GET  /me/packs (marketplace-adjacent listing)
  • GET  /me/reviews-received

INTENTIONALLY LEFT in server.py for Phase 5 (auth.py):
  • /auth/login, /auth/register, /auth/forgot-password, /auth/reset-password
  • /auth/me (GET), /auth/me (PATCH), /auth/google/session

INTENTIONALLY LEFT in server.py for Phase 7 (billing.py):
  • /me/billing
  • /billing/* (checkout, portal)

PRESERVED SEMANTICS — no behaviour change, no path change.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel, field_validator

from server import (
    db,
    get_current_user, get_optional_user,
    utcnow, plan_of,
    _emit_notification,
    public_spot_view,
    PLAN_LIMITS, PLAN_PRICING,
    DMReportIn,
    RESERVED_USERNAMES,
)

router = APIRouter(prefix="/api", tags=["users"])


# ─── Username availability (Phase 1 onboarding v2, Jun 2025) ──────────────
import re as _re
_USERNAME_RE = _re.compile(r"^[a-z0-9_]{3,24}$")


@router.get("/users/username-available")
async def username_available(u: str = Query(..., min_length=1, max_length=64)):
    """Live-check for the signup/profile-basics username field.
    Returns {available: bool, reason: str|null}.
    Never raises 4xx for client validation — always returns a structured
    payload so the field can show the right helper text.
    """
    raw = (u or "").strip().lstrip("@")
    norm = raw.lower()
    if not norm:
        return {"available": False, "reason": "empty"}
    if len(norm) < 3:
        return {"available": False, "reason": "too_short"}
    if len(norm) > 24:
        return {"available": False, "reason": "too_long"}
    if not _USERNAME_RE.match(norm):
        return {"available": False, "reason": "invalid_chars"}
    if norm in RESERVED_USERNAMES:
        return {"available": False, "reason": "reserved"}
    existing = await db.users.find_one(
        {"username": {"$regex": f"^{norm}$", "$options": "i"}},
        {"_id": 1},
    )
    if existing:
        return {"available": False, "reason": "taken"}
    return {"available": True, "reason": None}



# --- UpgradeIn (server.py:754-756) ---
class UpgradeIn(BaseModel):
    plan: str  # free | pro | elite
    cycle: Optional[str] = "monthly"  # 'monthly' or 'annual'

# --- upgrade_plan (server.py:823-847) ---
@router.post("/me/upgrade")
async def upgrade_plan(body: UpgradeIn, user: dict = Depends(get_current_user)):
    if body.plan not in ("free", "pro", "elite"):
        raise HTTPException(status_code=400, detail="Unknown plan")
    cycle = (body.cycle or "monthly").lower()
    if cycle not in ("monthly", "annual"):
        raise HTTPException(status_code=400, detail="cycle must be 'monthly' or 'annual'")
    # NOTE: billing is not wired yet; this is a preview toggle until Stripe ships.
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "plan": body.plan,
            "billing_cycle": None if body.plan == "free" else cycle,
            # Preview-toggle upgrades clear any comp_expiration since this is a real plan transition.
            "comp_expiration": None,
            "updated_at": utcnow(),
        }},
    )
    return {
        "ok": True,
        "plan": body.plan,
        "cycle": cycle,
        "limits": PLAN_LIMITS[body.plan],
        "pricing": PLAN_PRICING.get(body.plan, PLAN_PRICING["free"]),
    }

# --- get_user (server.py:923-1008) ---
@router.get("/users/{user_id}")
async def get_user(user_id: str, viewer: Optional[dict] = Depends(get_optional_user)):
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Not found")
    spots_count = await db.spots.count_documents({"owner_user_id": user_id, "privacy_mode": {"$in": ["public", "premium"]}})
    followers = await db.follows.count_documents({"followed_user_id": user_id})
    following = await db.follows.count_documents({"follower_user_id": user_id})
    posts_count = await db.community_posts.count_documents({"author_user_id": user_id})
    reviews_received = await db.spot_reviews.count_documents({
        "spot_id": {"$in": [s["spot_id"] async for s in db.spots.find({"owner_user_id": user_id}, {"spot_id": 1, "_id": 0})]},
    })
    is_following = False
    is_blocked = False
    if viewer:
        is_following = await db.follows.count_documents({"follower_user_id": viewer["user_id"], "followed_user_id": user_id}) > 0
        # PRD #12: viewer needs to know if they've blocked this user so the UI
        # can swap the Follow button for Unblock + show a blocked notice.
        is_blocked = await db.user_blocks.count_documents({
            "blocker_user_id": viewer["user_id"], "blocked_user_id": user_id,
        }) > 0
    # Alias fields so the public profile UI can share rendering code with /auth/me.
    user["stats"] = {
        "spots": spots_count,
        "spots_count": spots_count,  # alias for frontend consistency
        "spots_created": spots_count,
        "followers": followers,
        "following": following,
        "posts_count": posts_count,
        "reviews_received": reviews_received,
    }
    user["is_following"] = is_following
    user["is_blocked"] = is_blocked
    # ================================================================
    # Phase B.1 — Who Viewed Your Profile
    # Record a view when an authenticated viewer loads someone else's
    # profile. Self-views are ignored. Views are deduped on a 1-hour
    # window per (viewer_user_id, viewed_user_id) pair: subsequent
    # loads within the hour update `last_viewed_at` + increment the
    # `count` instead of stacking rows. Fire-and-forget — never blocks
    # the user-profile response.
    # ================================================================
    if viewer and viewer.get("user_id") and viewer["user_id"] != user_id:
        try:
            now = utcnow()
            cutoff = now - timedelta(hours=1)
            existing = await db.profile_views.find_one({
                "viewer_user_id": viewer["user_id"],
                "viewed_user_id": user_id,
                "last_viewed_at": {"$gte": cutoff},
            })
            if existing:
                await db.profile_views.update_one(
                    {"view_id": existing["view_id"]},
                    {"$set": {"last_viewed_at": now},
                     "$inc": {"count": 1}},
                )
            else:
                await db.profile_views.insert_one({
                    "view_id": f"pv_{uuid.uuid4().hex[:12]}",
                    "viewer_user_id": viewer["user_id"],
                    "viewed_user_id": user_id,
                    "viewer_city": viewer.get("city"),
                    "viewer_state": viewer.get("state"),
                    "viewer_country": viewer.get("country"),
                    "viewer_plan": plan_of(viewer),
                    "viewer_specialties": viewer.get("specialties") or [],
                    "first_viewed_at": now,
                    "last_viewed_at": now,
                    "count": 1,
                })
                # Profile-view push — Pro/Elite perk (who-viewed feature).
                # Only on the first row per 1h dedupe window. Actor + deep
                # link so tap routes straight to /network/viewers.
                try:
                    viewed_user_plan = plan_of(user)
                    if viewed_user_plan in ("pro", "elite"):
                        viewer_name = viewer.get("name") or "A photographer"
                        viewer_city = viewer.get("city") or "your network"
                        await _emit_notification(
                            user_id,
                            "profile_view",
                            "Someone viewed your profile 👀",
                            f"{viewer_name} from {viewer_city} checked out your profile",
                            actor_user_id=viewer["user_id"],
                            deep_link="/network/viewers",
                            image_url=viewer.get("avatar_url"),
                        )
                except Exception:
                    pass
        except Exception:
            pass  # never block profile loads on view-tracking failures
    return user

# --- by_username (added for web /u/[username] public profile) ---
# Additive, read-only helper for the Next.js web app. Preserves all prior
# semantics of /users/{user_id}; we simply resolve username → user_id here
# and delegate to the same underlying data shape. Never leaks password_hash.
@router.get("/users/by-username/{username}")
async def get_user_by_username(username: str, viewer: Optional[dict] = Depends(get_optional_user)):
    uname = (username or "").strip().lstrip("@").lower()
    if not uname:
        raise HTTPException(status_code=404, detail="Not found")
    user = await db.users.find_one(
        {"username": {"$regex": f"^{uname}$", "$options": "i"}},
        {"_id": 0, "password_hash": 0},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Not found")
    # Reuse the same response shape as get_user by delegating.
    return await get_user(user["user_id"], viewer)


# --- report_user (server.py:1999-2012) ---
@router.post("/users/{user_id}/report")
async def report_user(user_id: str, body: DMReportIn, user: dict = Depends(get_current_user)):
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot report yourself")
    await db.user_reports.insert_one({
        "report_id": f"rpt_{uuid.uuid4().hex[:12]}",
        "reporter_user_id": user["user_id"],
        "reported_user_id": user_id,
        "reason": (body.reason or "unspecified")[:80],
        "notes": (body.notes or "")[:500] or None,
        "status": "pending",
        "created_at": utcnow(),
    })
    return {"ok": True}

# --- my_recent_locations (server.py:2644-2672) ---
@router.get("/me/recent-locations")
async def my_recent_locations(user: dict = Depends(get_current_user), limit: int = 10):
    """Distinct recent locations from the user's own spots, for one-tap reuse
    when importing multiple historical photos from the same place.
    """
    limit = max(1, min(30, limit))
    cursor = db.spots.find(
        {"owner_user_id": user["user_id"]},
        {"_id": 0, "title": 1, "city": 1, "state": 1, "latitude": 1, "longitude": 1, "created_at": 1, "source_type": 1},
    ).sort("created_at", -1).limit(80)
    seen: set = set()
    out: list = []
    async for s in cursor:
        key = (round(s["latitude"], 3), round(s["longitude"], 3), (s.get("city") or "").lower())
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "title": s.get("title"),
            "city": s.get("city"),
            "state": s.get("state"),
            "latitude": s.get("latitude"),
            "longitude": s.get("longitude"),
            "source_type": s.get("source_type"),
            "last_used_at": s.get("created_at"),
        })
        if len(out) >= limit:
            break
    return {"count": len(out), "items": out}

# --- my_drafts (server.py:2675-2682) ---
@router.get("/me/drafts")
async def my_drafts(user: dict = Depends(get_current_user)):
    """All draft spots for the current user (visibility_status == 'draft')."""
    drafts = await db.spots.find(
        {"owner_user_id": user["user_id"], "visibility_status": "draft"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    return [public_spot_view(s, user) for s in drafts]

# --- me_trends (server.py:2784-2837) ---
@router.get("/me/trends")
async def me_trends(days: int = 7, user: dict = Depends(get_current_user)):
    """Activity trends — last N days of spots created + saves received on own spots."""
    days = max(1, min(30, days))
    now = utcnow()
    start = now - timedelta(days=days - 1)
    # Normalize start to midnight UTC
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    own_spots = await db.spots.find(
        {"owner_user_id": user["user_id"]}, {"_id": 0, "spot_id": 1, "created_at": 1}
    ).to_list(2000)
    own_spot_ids = [s["spot_id"] for s in own_spots]
    saves = await db.spot_saves.find(
        {"spot_id": {"$in": own_spot_ids}, "created_at": {"$gte": start}},
        {"_id": 0, "created_at": 1},
    ).to_list(5000) if own_spot_ids else []

    def _norm(dt):
        """Coerce stored datetime to tz-aware UTC so comparisons are consistent.
        Mongo/BSON may return tz-naive values on some drivers — treat those as UTC.
        """
        if not dt:
            return None
        if getattr(dt, "tzinfo", None) is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    # Bucket by day
    buckets = []
    for i in range(days):
        day_start = start + timedelta(days=i)
        day_end = day_start + timedelta(days=1)
        spots_count = sum(
            1 for s in own_spots
            if (d := _norm(s.get("created_at"))) and day_start <= d < day_end
        )
        saves_count = sum(
            1 for s in saves
            if (d := _norm(s.get("created_at"))) and day_start <= d < day_end
        )
        buckets.append({
            "date": day_start.strftime("%Y-%m-%d"),
            "label": day_start.strftime("%a"),
            "spots": spots_count,
            "saves": saves_count,
        })
    return {
        "days": days,
        "series": buckets,
        "totals": {
            "spots": sum(b["spots"] for b in buckets),
            "saves": sum(b["saves"] for b in buckets),
        },
    }

# --- creator_dashboard (server.py:2840-2859) ---
@router.get("/me/dashboard")
async def creator_dashboard(user: dict = Depends(get_current_user)):
    spots = await db.spots.find({"owner_user_id": user["user_id"]}, {"_id": 0}).to_list(500)
    public = [s for s in spots if s.get("privacy_mode") in ("public", "premium")]
    private = [s for s in spots if s.get("privacy_mode") in ("private", "followers", "invite_only")]
    spot_ids = [s["spot_id"] for s in spots]
    saves_received = await db.spot_saves.count_documents({"spot_id": {"$in": spot_ids}}) if spot_ids else 0
    reviews_received = await db.spot_reviews.count_documents({"spot_id": {"$in": spot_ids}}) if spot_ids else 0
    followers = await db.follows.count_documents({"followed_user_id": user["user_id"]})
    top = sorted([public_spot_view(s, user) for s in public], key=lambda x: x["shoot_score"], reverse=True)[:5]
    return {
        "total_spots": len(spots),
        "public_spots": len(public),
        "private_spots": len(private),
        "saves_received": saves_received,
        "reviews_received": reviews_received,
        "followers": followers,
        "profile_views": 0,  # placeholder for future event tracking
        "top_spots": top,
    }

# --- my_packs (server.py:3307-3309) ---
@router.get("/me/packs")
async def my_packs(user: dict = Depends(get_current_user)):
    return await db.spot_packs.find({"creator_user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)

# --- my_reviews_received (server.py:3805-3840) ---
@router.get("/me/reviews-received")
async def my_reviews_received(limit: int = 50, user: dict = Depends(get_current_user)):
    """Reviews that other photographers left on spots you created.
    Ordered newest first. Hydrates reviewer + spot info."""
    spot_ids = [s["spot_id"] async for s in db.spots.find({"owner_user_id": user["user_id"]}, {"spot_id": 1, "_id": 0})]
    if not spot_ids:
        return {"count": 0, "items": []}
    reviews = await db.spot_reviews.find(
        {"spot_id": {"$in": spot_ids}, "user_id": {"$ne": user["user_id"]}},
        {"_id": 0},
    ).sort("created_at", -1).limit(min(limit, 100)).to_list(100)
    # Hydrate reviewer + spot
    ruids = list({r.get("user_id") for r in reviews if r.get("user_id")})
    rspids = list({r.get("spot_id") for r in reviews})
    users = await db.users.find(
        {"user_id": {"$in": ruids}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1, "plan": 1, "role": 1},
    ).to_list(200)
    umap = {u["user_id"]: u for u in users}
    spots = await db.spots.find(
        {"spot_id": {"$in": rspids}},
        {"_id": 0, "spot_id": 1, "title": 1, "city": 1, "state": 1, "images": 1},
    ).to_list(200)
    smap = {s["spot_id"]: s for s in spots}
    for r in reviews:
        r["reviewer"] = umap.get(r.get("user_id"))
        s = smap.get(r.get("spot_id")) or {}
        imgs = s.get("images") or []
        r["spot"] = {
            "spot_id": s.get("spot_id"),
            "title": s.get("title"),
            "city": s.get("city"),
            "state": s.get("state"),
            "cover_image_url": imgs[0]["image_url"] if imgs and isinstance(imgs[0], dict) else None,
        }
    return {"count": len(reviews), "items": reviews}

