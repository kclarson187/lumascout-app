from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import math
import logging
# Batch #7 — graceful fallback wrapper. See /app/backend/common/graceful.py
# for docs. Used to keep high-traffic endpoints from returning raw 500s on
# aggregation failures / flaky third-party sub-calls.
from common.graceful import graceful
import asyncio
import time
import bcrypt
import jwt
import httpx
from datetime import datetime, timezone, timedelta
import math
from typing import List, Optional, Any, Dict

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DocumentTooLarge
from pydantic import BaseModel, Field, EmailStr, field_validator

# ============================================================================
# Setup
# ============================================================================
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("photoscout")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@lumascout.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

# APP_URL — canonical public origin for user-facing links emitted by the
# backend (password reset emails, email-change verification links, Stripe
# billing portal return URLs, etc.). Defaults to the production domain so
# production deploys work without extra config; preview/staging can
# override via supervisor environment= block or .env. (Deploy audit fix,
# v2.0.25: was previously hardcoded in 3 places.)
APP_URL = os.environ.get("APP_URL", "https://lumascout.app").rstrip("/")

# FIX(Commit 7b / 2026-04): Reserved handles. These literals are blocked from
# new registration so they can't be squatted by end-users. `admin` is reserved
# because we used to assign it to the super-admin account — that account is
# now `@keith`, and `@admin` must never be reclaimable. `support`, `help`,
# `staff`, `lumascout`, `scout`, `scout_ai` are reserved for brand/product use.
RESERVED_USERNAMES = {
    "admin", "administrator", "root", "sysop",
    "staff", "support", "help", "mod", "moderator",
    "lumascout", "luma", "scout", "scout_ai", "scoutai",
    "official", "team", "security", "billing",
}
JWT_ALGO = "HS256"
ACCESS_TOKEN_DAYS = 30

# Plan feature gating
PLAN_LIMITS = {
    # FIX(membership conversion update): Free tier tightened to drive upgrades
    # while keeping the experience usable — saves 5→3, collections fully
    # locked, new outbound DMs capped at 3/mo, route plans capped at 1
    # active, uploads capped at 5 lifetime, advanced filters locked.
    "free": {
        "saves": 3,
        "private_spots": 1,
        "collections": 0,
        "advanced_filters": False,
        "sell_packs": False,
        "creator_analytics": False,
        "monthly_outbound_dms": 3,
        "active_routes": 1,
        "max_uploads": 5,
    },
    "pro": {
        "saves": 10_000,
        "private_spots": 10_000,
        "collections": 500,
        "advanced_filters": True,
        "sell_packs": False,
        "creator_analytics": False,
        "monthly_outbound_dms": 10_000,
        "active_routes": 10_000,
        "max_uploads": 10_000,
    },
    "elite": {
        "saves": 10_000,
        "private_spots": 10_000,
        "collections": 10_000,
        "advanced_filters": True,
        "sell_packs": True,
        "creator_analytics": True,
        "monthly_outbound_dms": 10_000,
        "active_routes": 10_000,
        "max_uploads": 10_000,
    },
    # Comp plans mirror their paid counterparts for feature gating purposes.
    "comp_pro": {
        "saves": 10_000, "private_spots": 10_000, "collections": 500,
        "advanced_filters": True, "sell_packs": False, "creator_analytics": False,
        "monthly_outbound_dms": 10_000, "active_routes": 10_000, "max_uploads": 10_000,
    },
    "comp_elite": {
        "saves": 10_000, "private_spots": 10_000, "collections": 10_000,
        "advanced_filters": True, "sell_packs": True, "creator_analytics": True,
        "monthly_outbound_dms": 10_000, "active_routes": 10_000, "max_uploads": 10_000,
    },
    "trial_pro": {
        "saves": 10_000, "private_spots": 10_000, "collections": 500,
        "advanced_filters": True, "sell_packs": False, "creator_analytics": False,
        "monthly_outbound_dms": 10_000, "active_routes": 10_000, "max_uploads": 10_000,
    },
    "trial_elite": {
        "saves": 10_000, "private_spots": 10_000, "collections": 10_000,
        "advanced_filters": True, "sell_packs": True, "creator_analytics": True,
        "monthly_outbound_dms": 10_000, "active_routes": 10_000, "max_uploads": 10_000,
    },
    "suspended": {
        "saves": 0, "private_spots": 0, "collections": 0,
        "advanced_filters": False, "sell_packs": False, "creator_analytics": False,
        "monthly_outbound_dms": 0, "active_routes": 0, "max_uploads": 0,
    },
}

# Display pricing in USD (cents). Stripe billing is not wired yet — these power
# the paywall/pricing UI and are returned by /api/plans.
PLAN_PRICING = {
    "free":  {"monthly_cents": 0,    "annual_cents": 0},
    "pro":   {"monthly_cents": 999,  "annual_cents": 9900},   # $9.99/mo · $99/yr
    "elite": {"monthly_cents": 1999, "annual_cents": 20000},  # $19.99/mo · $200/yr
}

# Normalise any comp/trial plan to the underlying tier for feature gating.
def _effective_plan(plan: str) -> str:
    if plan in ("comp_pro", "trial_pro"):
        return "pro"
    if plan in ("comp_elite", "trial_elite"):
        return "elite"
    return plan


# ─── Comped Elite Roles (May 2026) ──────────────────────────────────────
# Roles in this set automatically resolve to `comp_elite` for ENTITLEMENT
# purposes. This is purely about subscription access (Elite-gated features,
# saves limits, weather overlays, forecast tools, etc.) — it has NO effect
# on permission boundaries (who can moderate, who can hit /admin/* routes,
# etc.). Permission gating uses a different system: ROLE_LEVELS + the
# require_role() dependency in routes/, neither of which read this set.
#
# Why it lives here and not in the user document
#   • Single source of truth — every entitlement check (`plan_of()` is
#     the ONE helper used by paywalls, gates, and limits_for()) sees
#     this without a Mongo write per role grant.
#   • No back-write to the `plan` field — a moderator stripped of their
#     role tomorrow reverts to whatever Stripe says they actually pay
#     for, automatically. No DB cleanup script needed.
#   • Idempotent — adding/removing a role doesn't have to run a "now
#     comp them / now uncomp them" migration. The role IS the comp.
#
# What this does NOT do
#   • Grant moderation tools to founding_scout.
#   • Grant admin tools to moderator/support.
#   • Grant super_admin tools to admin.
# Permission checks (require_role, ROLE_LEVELS) remain authoritative.
ELITE_COMP_ROLES = frozenset({
    "founding_scout",  # honorary scout role
    "moderator",       # community moderation staff
    "support",         # customer-support staff
    "admin",           # platform admin
    "super_admin",     # superuser (founders, ops)
})


def plan_of(user: dict) -> str:
    raw = (user or {}).get("plan") or "free"
    role = (user or {}).get("role") or ""
    # Expired comp plans silently revert to 'free'.
    expiry = (user or {}).get("comp_expiration")
    if expiry and raw in ("comp_pro", "comp_elite", "trial_pro", "trial_elite"):
        try:
            exp_dt = expiry if isinstance(expiry, datetime) else datetime.fromisoformat(str(expiry).replace("Z", "+00:00"))
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            if exp_dt < datetime.now(timezone.utc):
                # Comped-role users keep Elite even if their own
                # comp_expiration lapses — the role itself is the
                # entitlement, so a stale `comp_expiration` field
                # left over from a previous grant doesn't matter.
                if role in ELITE_COMP_ROLES:
                    return "comp_elite"
                return "free"
        except Exception:
            pass
    # Comped-role auto-Elite. If the user already has a paid Elite
    # subscription (`raw == "elite"`), leave that alone — the billing
    # state is truthful and switching them to comp_elite would muddy
    # revenue reporting. Same logic for explicit higher-priority comp
    # overrides ("comp_elite" already, "trial_elite" still active).
    if role in ELITE_COMP_ROLES and raw in ("free", None, "", "trial_pro", "comp_pro", "trial_elite"):
        return "comp_elite"
    return raw


def limits_for(user: dict) -> dict:
    effective = _effective_plan(plan_of(user))
    return PLAN_LIMITS.get(effective, PLAN_LIMITS["free"])


# ============================================================================
# Rate limiting (in-memory, process-local) — basic spam prevention
# Keyed by (endpoint, user_id). Values are deques of request timestamps.
# NOTE: This resets on server restart. For production, use Redis. Good enough
# for MVP + demo traffic.
# ============================================================================
from collections import defaultdict, deque

RATE_LIMITS = {
    "spot_create": (10, 3600),       # 10 per hour
    "report_create": (20, 86400),    # 20 per day
    "review_create": (30, 86400),    # 30 per day
    "checkin_create": (30, 86400),   # 30 per day
}
_rate_buckets: dict = defaultdict(deque)


# ----------------------------------------------------------------------------
# Paywall helper (Batch #8, May 2026)
#
# Emits a STRUCTURED 402 detail so the mobile app can switch on a canonical
# `reason_code` rather than fragile substring regex on the message. The
# frontend UpgradeGateModal switches on reason_code to pick copy + target
# plan; the legacy substring fallback is kept for backwards compatibility.
#
# Canonical reason codes (MUST mirror /app/frontend/src/components/UpgradeGateModal.tsx):
#   saves, collections, filters, private, ai_planner, messaging,
#   analytics, uploads, routes, viewers, spot_packs, referrals, generic
#
# Shape returned in `detail`:
#   {
#     "reason_code": "saves",
#     "message":     "Free plan allows 3 saves. Upgrade for unlimited.",
#     "target_plan": "pro" | "elite",   # optional, UI hint
#   }
#
# Callers MUST pass a reason_code. `message` is what pre-Batch-#8 clients
# show (kept so nothing breaks during the rollout).
# ----------------------------------------------------------------------------
PAYWALL_REASON_CODES = {
    "saves", "collections", "filters", "private",
    "ai_planner", "messaging", "analytics",
    "uploads", "routes", "viewers",
    "spot_packs", "referrals", "generic",
}


def raise_paywall(reason_code: str, message: str, target_plan: Optional[str] = None):
    """Raise a structured 402 the frontend can switch on by `reason_code`."""
    code = reason_code if reason_code in PAYWALL_REASON_CODES else "generic"
    raise HTTPException(
        status_code=402,
        detail={
            "reason_code": code,
            "message": message,
            "target_plan": target_plan,
        },
    )



def check_rate_limit(bucket_key: str, user_id: str):
    """Raise HTTPException(429) if user has exceeded the rate limit for this bucket."""
    if bucket_key not in RATE_LIMITS:
        return
    max_count, window_sec = RATE_LIMITS[bucket_key]
    key = (bucket_key, user_id)
    now_ts = datetime.now(timezone.utc).timestamp()
    bucket = _rate_buckets[key]
    # drop old entries
    while bucket and (now_ts - bucket[0]) > window_sec:
        bucket.popleft()
    if len(bucket) >= max_count:
        retry_in = int(window_sec - (now_ts - bucket[0]))
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests. Try again in {max(1, retry_in)}s.",
        )
    bucket.append(now_ts)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="LumaScout API")
api = APIRouter(prefix="/api")

# PERF: in-memory home-feed cache (30s TTL per user).
# Keyed by (user_id, lat_bin, lng_bin); value is (written_at, payload).
# Populated + read inside `home_feed()`. Safe under single-worker uvicorn;
# with multi-worker, each worker gets its own cache which is fine for this use.
_HOME_FEED_CACHE: Dict[Any, tuple] = {}
security = HTTPBearer(auto_error=False)


# ============================================================================
# Helpers
# ============================================================================
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": utcnow() + timedelta(days=ACCESS_TOKEN_DAYS),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def clean_doc(d: Optional[dict]) -> Optional[dict]:
    if d is None:
        return None
    d.pop("_id", None)
    d.pop("password_hash", None)
    return d


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("deleted") or user.get("status") == "deleted":
        raise HTTPException(status_code=401, detail="Account has been deleted")
    return user


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[dict]:
    if not credentials or not credentials.credentials:
        return None
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
        user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        return user
    except Exception:
        return None


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def compute_shoot_score(spot: dict) -> int:
    # Weighted shoot score (0-100)
    light = (
        (spot.get("sunrise_rating", 3) + spot.get("sunset_rating", 3)
         + spot.get("morning_golden_hour_rating", 3) + spot.get("evening_golden_hour_rating", 3)) / 4
    )
    variety = spot.get("variety_rating", 3)
    safety = spot.get("safety_rating", 3)
    shade = spot.get("shade_rating", 3)
    crowd = 6 - spot.get("crowd_level", 3)  # lower crowd = better
    image_bonus = min(len(spot.get("images", [])), 5)

    raw = (light * 20) + (variety * 8) + (safety * 6) + (shade * 4) + (crowd * 4) + (image_bonus * 2)
    return max(0, min(100, int(raw)))


def public_spot_view(spot: dict, user: Optional[dict] = None) -> dict:
    spot = dict(spot)
    spot.pop("_id", None)
    # Privacy enforcement for exact coordinates
    privacy = spot.get("privacy_mode", "public")
    display = spot.get("location_display_mode", "exact")
    is_owner = user and user.get("user_id") == spot.get("owner_user_id")

    if not is_owner and privacy == "private":
        return None  # hide entirely
    if not is_owner and display == "approximate":
        # round to ~1km
        spot["latitude"] = round(spot["latitude"], 2)
        spot["longitude"] = round(spot["longitude"], 2)
    if not is_owner and display == "hidden":
        spot["latitude"] = None
        spot["longitude"] = None

    # --- Hero cover passthrough for Explore / map / list cards ---
    # If an admin has pinned a cover, surface it here so every list/feed
    # endpoint (not just /spots/{id}) picks it up. Fallback: first is_cover
    # image, else images[0].
    ov = spot.get("admin_cover_override") or {}
    hero_cover = None
    hero_src = None
    if ov.get("image_url"):
        hero_cover = ov["image_url"]; hero_src = "admin_override"
    else:
        for im in (spot.get("images") or []):
            if isinstance(im, dict) and im.get("is_cover") and im.get("image_url"):
                hero_cover = im["image_url"]; hero_src = "first_cover"; break
        if not hero_cover:
            imgs = spot.get("images") or []
            if imgs and isinstance(imgs[0], dict):
                hero_cover = imgs[0].get("image_url"); hero_src = "first_image"
    spot["hero_cover_image_url"] = hero_cover
    spot["hero_cover_source"] = hero_src
    spot["hero_cover_meta"] = {
        "focal_x": ov.get("focal_x", 0.5),
        "focal_y": ov.get("focal_y", 0.5),
        "scale":   ov.get("scale",   1.0),
        "rotation": ov.get("rotation", 0),
    } if ov else {"focal_x": 0.5, "focal_y": 0.5, "scale": 1.0, "rotation": 0}

    spot["shoot_score"] = compute_shoot_score(spot)

    # Freshness indicator based on last_verified_at
    lv = spot.get("last_verified_at")
    if lv:
        lv_norm = lv if getattr(lv, "tzinfo", None) else lv.replace(tzinfo=timezone.utc)
        age_days = (utcnow() - lv_norm).days
        if age_days <= 30:
            spot["freshness"] = "fresh"
        elif age_days <= 90:
            spot["freshness"] = "recent"
        else:
            spot["freshness"] = "stale"
        # Human label
        if age_days == 0:
            spot["freshness_label"] = "Verified today"
        elif age_days == 1:
            spot["freshness_label"] = "Verified yesterday"
        elif age_days < 7:
            spot["freshness_label"] = f"Verified {age_days}d ago"
        elif age_days < 30:
            spot["freshness_label"] = f"Verified {age_days // 7}w ago"
        elif age_days < 365:
            spot["freshness_label"] = f"Verified {age_days // 30}mo ago"
        else:
            spot["freshness_label"] = "Needs refresh"
    else:
        spot["freshness"] = "unknown"
        spot["freshness_label"] = None

    # ------------------------------------------------------------------
    # Quality score + discovery badges (Explore ranking, Phase P0-B)
    # quality_score (0-100) weights:
    #   cover image present (15), description length ≥ 80 (10),
    #   2+ photos (10), 4+ photos (+5), shoot_score (30 scaled), rating_count
    #   (10 scaled log), recent activity (10), verification fresh (10),
    #   verified owner (10).
    # Badges (at most 2 rendered on card; rest are advisory):
    #   is_new       — created ≤ 7 days
    #   is_fresh     — last_verified_at ≤ 7 days OR admin_cover_override
    #                  set_at ≤ 7 days
    #   is_trending  — save_count + like_count growth approximation (>=4 saves
    #                  AND created ≤ 30 days, OR shoot_score ≥ 80 with 3+ photos)
    #   is_verified  — spot owner verification_status='verified' OR community
    #                  verifications exist
    # ------------------------------------------------------------------
    now = utcnow()
    def _norm_dt(val):
        if not val: return None
        if isinstance(val, str):
            try: val = datetime.fromisoformat(val.replace("Z", "+00:00"))
            except Exception: return None
        if isinstance(val, datetime) and val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val

    created_at = _norm_dt(spot.get("created_at"))
    last_verified = _norm_dt(spot.get("last_verified_at"))
    cover_override = spot.get("admin_cover_override") or {}
    admin_override_at = _norm_dt(cover_override.get("set_at"))

    created_age_days = (now - created_at).days if created_at else 9999
    verify_age_days = (now - last_verified).days if last_verified else 9999
    override_age_days = (now - admin_override_at).days if admin_override_at else 9999

    is_new = created_age_days <= 7
    is_fresh = (
        verify_age_days <= 7
        or override_age_days <= 7
    )
    photo_count = len(spot.get("images") or [])
    desc_len = len(spot.get("description") or "")
    save_count = int(spot.get("save_count") or 0)
    like_count = int(spot.get("like_count") or 0)
    rating_count = int(spot.get("rating_count") or 0)
    view_count = int(spot.get("view_count") or 0)

    import math as _math
    qs = 0.0
    # Cover image presence
    first_img = None
    if spot.get("images"):
        for im in spot["images"]:
            if isinstance(im, dict) and im.get("image_url"):
                first_img = im; break
    if first_img: qs += 15
    # Description depth
    if desc_len >= 80: qs += 10
    if desc_len >= 200: qs += 3
    # Photo variety
    if photo_count >= 2: qs += 5
    if photo_count >= 4: qs += 5
    # Shoot score (0..100 from compute_shoot_score)
    qs += min(30.0, float(spot["shoot_score"]) * 0.3)
    # Ratings (log-scaled so 10 ratings caps)
    if rating_count > 0:
        qs += min(10.0, _math.log(1 + rating_count) * 3.0)
    # Engagement: saves + views
    if save_count >= 5: qs += 5
    if view_count >= 50: qs += 3
    # Recent activity
    if is_fresh: qs += 5
    if is_new: qs += 3
    # Verification bonuses
    if cover_override and cover_override.get("image_url"): qs += 5
    if spot.get("verification_status") == "verified" or spot.get("verified"): qs += 5
    # Stale penalty
    if verify_age_days > 180 and not is_new: qs -= 8

    quality_score = max(0, min(100, int(round(qs))))
    is_trending = (
        (save_count >= 4 and created_age_days <= 30)
        or (quality_score >= 80 and photo_count >= 3)
    )
    is_verified_flag = (
        bool(spot.get("verified"))
        or spot.get("verification_status") == "verified"
        or int(spot.get("community_verification_count") or 0) >= 2
    )

    spot["quality_score"] = quality_score
    spot["is_new"] = bool(is_new)
    spot["is_fresh"] = bool(is_fresh) and not is_new  # "Fresh" replaces "New" after 7d
    spot["is_trending"] = bool(is_trending)
    spot["is_verified_discovery"] = bool(is_verified_flag)

    return spot


async def attach_owners(spots: List[dict]) -> List[dict]:
    """Batch-attach lightweight owner info (name, username, avatar_url,
    verification_status) to a list of spot views. Used by list/feed endpoints
    so cards can render verified badges without per-row round trips.
    """
    if not spots:
        return spots
    ids = list({s.get("owner_user_id") for s in spots if s.get("owner_user_id")})
    if not ids:
        return spots
    users = await db.users.find(
        {"user_id": {"$in": ids}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1},
    ).to_list(500)
    umap = {u["user_id"]: u for u in users}
    for s in spots:
        owner = umap.get(s.get("owner_user_id"))
        if owner:
            s["owner"] = owner
    return spots


# ============================================================================
# Models
# ============================================================================
class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    specialties: Optional[List[str]] = []


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class GoogleSessionIn(BaseModel):
    session_id: str


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    specialties: Optional[List[str]] = None
    website: Optional[str] = None
    instagram: Optional[str] = None
    avatar_url: Optional[str] = None
    # --- Community fields ----------------------------------------------------
    service_area: Optional[str] = None
    years_shooting: Optional[int] = None
    available_for_second_shooter: Optional[bool] = None
    available_for_associate: Optional[bool] = None
    mentorship_available: Optional[bool] = None
    looking_for_mentor: Optional[bool] = None
    community_onboarded: Optional[bool] = None
    # --- Social profile (Phase A) -------------------------------------------
    banner_image_url: Optional[str] = None
    avatar_image_url: Optional[str] = None
    years_experience: Optional[int] = None
    service_radius_miles: Optional[int] = None
    booking_available: Optional[bool] = None
    facebook_url: Optional[str] = None
    tiktok_url: Optional[str] = None
    # --- Location scalability -----------------------------------------------
    primary_country: Optional[str] = None   # ISO alpha-2, e.g. "US", "CA", "MX"
    primary_region: Optional[str] = None    # State/Province
    timezone: Optional[str] = None          # IANA zone, e.g. "America/Chicago"
    language_hint: Optional[str] = None     # "en", "es", "fr"
    # --- Settings prefs (Apr 2026) ------------------------------------------
    # Stored as flat sub-documents so we can grow without migrations.
    location_prefs: Optional[Dict[str, Any]] = None
    gear_prefs: Optional[Dict[str, Any]] = None
    travel_prefs: Optional[Dict[str, Any]] = None






class ReviewIn(BaseModel):
    overall_rating: int
    light_rating: Optional[int] = None
    access_rating: Optional[int] = None
    variety_rating: Optional[int] = None
    crowd_rating: Optional[int] = None
    safety_rating: Optional[int] = None
    comment: Optional[str] = ""


class CheckinIn(BaseModel):
    status_summary: str
    crowd_level: Optional[int] = 3
    access_issue: bool = False
    lighting_accuracy: Optional[str] = "accurate"
    notes: Optional[str] = ""
    checkin_image_url: Optional[str] = None


REPORT_REASONS = {
    "not_a_location",   # not a real place
    "unsafe",           # unsafe / private property
    "inappropriate",    # inappropriate content
    "spam",             # spam / promotional
    "wrong_info",       # incorrect info
    "other",
}


# ============================================================================
# Auth endpoints
# ============================================================================
@api.post("/auth/register")
async def register(body: RegisterIn):
    email = body.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    # FIX(Commit 7b / 2026-04): Reserve handles that map to staff, brand, or
    # system entities so end-users can't register them. If the derived
    # username collides with a reserved name, suffix it with a short uuid
    # slug so the user still gets a valid handle but not the reserved one.
    username = email.split("@")[0]
    if username.lower() in RESERVED_USERNAMES:
        username = f"{username}_{uuid.uuid4().hex[:4]}"
    # Belt-and-suspenders: a user whose handle *would* collide with an existing
    # user also gets the same suffix treatment.
    if await db.users.find_one({"username": username}):
        username = f"{username}_{uuid.uuid4().hex[:4]}"
    doc = {
        "user_id": user_id,
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name,
        "username": username,
        "avatar_url": None,
        "avatar_image_url": None,
        "banner_image_url": None,
        "bio": "",
        "city": "",
        "state": "",
        "specialties": body.specialties or [],
        "website": "",
        "instagram": "",
        "facebook_url": "",
        "tiktok_url": "",
        "role": "user",
        "verification_status": "unverified",
        "auth_provider": "email",
        "plan": "free",
        "billing_cycle": None,
        # --- North America defaults (overridable in profile) ----------------
        "primary_country": "US",
        "primary_region": None,
        "timezone": None,
        "language_hint": "en",
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id, email)
    return {"token": token, "user": clean_doc(doc)}


@api.post("/auth/login")
async def login(body: LoginIn):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("deleted") or user.get("status") == "deleted":
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user["user_id"], email)
    return {"token": token, "user": clean_doc(user)}


# ============================================================================
# Forgot / reset password — dev-mode (on-screen reset link). The outbound email
# hook is a stub; swap `send_password_reset_email` to Resend/SendGrid later.
# ============================================================================
class ForgotPasswordIn(BaseModel):
    # Optional so a missing / null email returns the canonical generic 200
    # response instead of a pydantic 422. We still want the response shape
    # to be IDENTICAL across valid / unknown / malformed / missing email so
    # attackers can't enumerate accounts by probing the error surface.
    email: Optional[str] = None


class ResetPasswordIn(BaseModel):
    token: str
    new_password: str


async def send_password_reset_email(email: str, reset_link: str) -> None:
    """Send a password reset link via Postmark (Item #7).

    Uses the noreply@lumascout.app sender for transactional notices.
    Falls back to a log line if no Postmark token is configured.
    """
    try:
        from email_service import send_email, SENDER_NOREPLY
        # Deploy audit fix (v2.0.25): use APP_URL constant instead of
        # hardcoded "https://lumascout.app". Lets preview / staging
        # environments point reset emails at the right host.
        full_link = f"{APP_URL}{reset_link}"
        await send_email(
            to=email,
            subject="Reset your LumaScout password",
            text_body=(
                "Tap the link below to reset your LumaScout password.\n"
                f"{full_link}\n\n"
                "This link expires in 30 minutes. If you didn't request this, "
                "you can safely ignore this email."
            ),
            html_body=(
                f"<p>Tap the link below to reset your LumaScout password.</p>"
                f"<p><a href=\"{full_link}\">Reset password</a></p>"
                f"<p style=\"color:#888\">This link expires in 30 minutes.</p>"
            ),
            sender=SENDER_NOREPLY,
            tag="password-reset",
        )
    except Exception as exc:  # never block auth flow
        logger.warning("[email] reset send failed for %s: %s", email, exc)
    logger.info("[email] password reset link for %s -> %s", email, reset_link)


@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn, request: Request):
    """
    Generates a 30-minute single-use reset token. ALWAYS responds `ok:true` so
    we don't leak which emails are registered (no enumeration).

    SECURITY (Batch #6, May 2026):
      · Response NEVER contains `reset_token` / `reset_link` in production.
      · Dev convenience (token echoed back so the tester can continue without
        email delivery) is gated behind the explicit env flag
        `EXPOSE_DEV_RESET_TOKEN=1` — OFF by default, OFF on every deployed
        environment. Without that flag set, the response shape is identical
        for a valid email, an unknown email, a malformed email, and a
        deleted account: `{ok: true, message: "If an account..."}`.
      · The token itself is still generated + persisted + emailed whenever
        possible; we simply stop echoing it over the wire.
    """
    email = (body.email or "").lower().strip()
    generic_resp: Dict[str, Any] = {
        "ok": True,
        "message": "If an account with that email exists, we've sent password reset instructions.",
    }
    if not email or "@" not in email:
        return generic_resp

    user = await db.users.find_one({"email": email})
    if not user or user.get("deleted") or user.get("status") == "deleted" or not user.get("password_hash"):
        # silently succeed to avoid user-enumeration
        return generic_resp

    # Invalidate any prior unused tokens for this user
    await db.password_resets.update_many(
        {"user_id": user["user_id"], "used": False},
        {"$set": {"used": True, "superseded_at": utcnow()}},
    )

    token = uuid.uuid4().hex + uuid.uuid4().hex  # 64-char random
    reset_doc = {
        "reset_id": f"pwr_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "email": email,
        "token": token,
        "expires_at": utcnow() + timedelta(minutes=30),
        "used": False,
        "created_at": utcnow(),
        "ip": (request.client.host if request.client else None),
    }
    await db.password_resets.insert_one(reset_doc)

    # Build a link the FE can open. Uses the app's auth reset screen.
    reset_link = f"/reset-password?token={token}"
    try:
        await send_password_reset_email(email, reset_link)
    except Exception as exc:  # pragma: no cover — never block the response
        logger.warning("email dispatch failed for %s: %s", email, exc)

    # Production default: return ONLY the generic response. No token leaks.
    #
    # Local-dev escape hatch: setting EXPOSE_DEV_RESET_TOKEN=1 in the backend
    # `.env` (NOT recommended for any deployed environment) echoes the token
    # back so a developer without email delivery can continue the flow in the
    # UI. This flag is NEVER set in staging/prod.
    if os.environ.get("EXPOSE_DEV_RESET_TOKEN") == "1":
        return {
            **generic_resp,
            "dev_mode": True,
            "reset_token": token,
            "reset_link": reset_link,
            "expires_at": reset_doc["expires_at"].isoformat(),
        }
    return generic_resp


@api.post("/auth/reset-password")
async def reset_password(body: ResetPasswordIn):
    token = (body.token or "").strip()
    pw = body.new_password or ""
    if not token:
        raise HTTPException(status_code=400, detail="Reset token is required")
    if len(pw) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    reset = await db.password_resets.find_one({"token": token})
    if not reset:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")
    if reset.get("used"):
        raise HTTPException(status_code=400, detail="This reset link has already been used")
    if reset.get("expires_at"):
        exp = reset["expires_at"]
        now = utcnow()
        # Mongo returns naïve UTC datetimes; align tz-awareness for comparison
        if exp.tzinfo is None and now.tzinfo is not None:
            exp = exp.replace(tzinfo=now.tzinfo)
        elif exp.tzinfo is not None and now.tzinfo is None:
            now = now.replace(tzinfo=exp.tzinfo)
        if exp < now:
            raise HTTPException(status_code=400, detail="Reset link has expired — request a new one")

    user = await db.users.find_one({"user_id": reset["user_id"]})
    if not user or user.get("deleted") or user.get("status") == "deleted":
        raise HTTPException(status_code=400, detail="Account unavailable")

    new_hash = hash_password(pw)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": new_hash, "password_updated_at": utcnow()}},
    )
    await db.password_resets.update_one(
        {"reset_id": reset["reset_id"]},
        {"$set": {"used": True, "used_at": utcnow()}},
    )
    # Invalidate any other outstanding tokens for this user
    await db.password_resets.update_many(
        {"user_id": user["user_id"], "used": False},
        {"$set": {"used": True, "superseded_at": utcnow()}},
    )
    return {"ok": True, "message": "Password updated — please sign in with your new password."}




@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    user["plan"] = plan_of(user)
    user["limits"] = limits_for(user)
    uid = user["user_id"]
    # FIX(membership conversion update): expose `uploads` and
    # `outbound_threads_30d` so the frontend can show tasteful upgrade
    # nudges before the user attempts an action that exceeds the new
    # Free tier caps. Old fields (saves / private_spots / collections)
    # remain unchanged for backwards compatibility.
    month_ago = utcnow() - timedelta(days=30)
    outbound_30d = await db.dm_threads.count_documents({
        "creator_user_id": uid,
        "created_at": {"$gte": month_ago},
    })
    # live counts
    user["usage"] = {
        "saves": await db.spot_saves.count_documents({"user_id": uid}),
        "private_spots": await db.spots.count_documents({
            "owner_user_id": uid,
            "privacy_mode": {"$in": ["private", "followers", "invite_only"]},
        }),
        "collections": await db.collections.count_documents({"owner_user_id": uid}),
        "uploads": await db.spots.count_documents({"owner_user_id": uid}),
        "outbound_threads_30d": outbound_30d,
    }
    # Social stats for creator profile (Phase B)
    user["stats"] = {
        "followers": await db.follows.count_documents({"followed_user_id": uid}),
        "following": await db.follows.count_documents({"follower_user_id": uid}),
        "spots_created": await db.spots.count_documents({"owner_user_id": uid}),
        "reviews_received": await db.spot_reviews.count_documents({
            "spot_id": {"$in": [s["spot_id"] async for s in db.spots.find({"owner_user_id": uid}, {"spot_id": 1, "_id": 0})]},
        }),
        "posts_count": await db.community_posts.count_documents({"author_user_id": uid}),
    }
    return user




@api.get("/plans")
async def list_plans():
    """Public plans catalogue used by the paywall / onboarding comparison."""
    def _price(cents: int) -> str:
        return f"${cents / 100:.2f}" if cents else "$0"
    return {
        "plans": [
            {
                "key": "free",
                "name": "Free",
                "tagline": "Browse, follow, and explore",
                "monthly_price": _price(PLAN_PRICING["free"]["monthly_cents"]),
                "annual_price": _price(PLAN_PRICING["free"]["annual_cents"]),
                "monthly_cents": PLAN_PRICING["free"]["monthly_cents"],
                "annual_cents": PLAN_PRICING["free"]["annual_cents"],
                "limits": PLAN_LIMITS["free"],
                "features": [
                    "Browse all public spots",
                    "Follow photographers + community feed",
                    "Save up to 3 spots",
                    "Up to 5 spots you can upload",
                    "Plan 1 active route",
                    "3 new message threads / month",
                ],
            },
            {
                "key": "pro",
                "name": "Pro",
                "tagline": "For serious scouting & shooting",
                "monthly_price": _price(PLAN_PRICING["pro"]["monthly_cents"]),
                "annual_price": _price(PLAN_PRICING["pro"]["annual_cents"]),
                "monthly_cents": PLAN_PRICING["pro"]["monthly_cents"],
                "annual_cents": PLAN_PRICING["pro"]["annual_cents"],
                "limits": PLAN_LIMITS["pro"],
                "features": [
                    "Unlimited saved spots & uploads",
                    "Unlimited custom collections",
                    "Unlimited active routes",
                    "Advanced map & search filters",
                    "Unlimited photographer DMs",
                    "See full Profile Viewers list",
                    "Pro creator badge",
                ],
                "popular": True,
            },
            {
                "key": "elite",
                "name": "Elite",
                "tagline": "For creators who sell",
                "monthly_price": _price(PLAN_PRICING["elite"]["monthly_cents"]),
                "annual_price": _price(PLAN_PRICING["elite"]["annual_cents"]),
                "monthly_cents": PLAN_PRICING["elite"]["monthly_cents"],
                "annual_cents": PLAN_PRICING["elite"]["annual_cents"],
                "limits": PLAN_LIMITS["elite"],
                "features": [
                    "Everything in Pro",
                    "Animated Elite badge",
                    "Advanced spot analytics (views, saves, reach)",
                    "Sell curated spot packs",
                    "Featured spotlight rotation",
                    "Early access to new features",
                    "Priority support",
                ],
            },
        ],
    }




@api.patch("/auth/me")
async def update_me(body: UserUpdateIn, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    updates["updated_at"] = utcnow()
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return updated


# ============================================================================
# EMAIL CHANGE FLOW (Item #8 — Apr 2026)
# ----------------------------------------------------------------------------
# Two-step verified change to support pros who want to switch from a free
# email (gmail) to their custom domain (john@johnsphoto.com), without ever
# orphaning the account.
#
#   POST /api/auth/email-change/request    {new_email, current_password}
#       -> creates email_changes doc, sends verification link to NEW email
#   GET  /api/auth/email-change/verify?token=...
#       -> on first hit by the new owner, the email is switched. The OLD
#          email is also notified that the change happened, per spec.
#
# Security:
#   - Re-auth required (current_password) to initiate
#   - Duplicate email block (no email change to an address already in use)
#   - Audit log entry written to `email_change_audit` collection
#   - Old email notified upon successful change
# ============================================================================
class EmailChangeRequestIn(BaseModel):
    new_email: str
    current_password: Optional[str] = None  # required for password accounts


@api.post("/auth/email-change/request")
async def request_email_change(body: EmailChangeRequestIn, user: dict = Depends(get_current_user)):
    new_email = (body.new_email or "").lower().strip()
    if not new_email or "@" not in new_email or "." not in new_email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if new_email == (user.get("email") or "").lower():
        raise HTTPException(status_code=400, detail="That's already your current email")

    # Reauth: password accounts must supply current_password. Google-only
    # accounts (no password_hash) skip this step — they reauth via Google.
    if user.get("password_hash"):
        if not body.current_password:
            raise HTTPException(status_code=400, detail="Enter your current password to confirm")
        if not verify_password(body.current_password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Incorrect password")

    # Duplicate check
    other = await db.users.find_one({"email": new_email})
    if other and other.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=409, detail="This email is already in use")

    # Invalidate any prior pending changes for this user
    await db.email_changes.update_many(
        {"user_id": user["user_id"], "used": False},
        {"$set": {"used": True, "superseded_at": utcnow()}},
    )

    token = uuid.uuid4().hex + uuid.uuid4().hex
    doc = {
        "change_id": f"ec_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "old_email": (user.get("email") or "").lower(),
        "new_email": new_email,
        "token": token,
        "expires_at": utcnow() + timedelta(hours=2),
        "used": False,
        "created_at": utcnow(),
    }
    await db.email_changes.insert_one(doc)

    # Deploy audit fix (v2.0.25): previously hardcoded "https://lumascout.app"
    # — now routed through APP_URL constant so preview / staging can
    # override. Falls back to lumascout.app in production.
    verify_link = f"{APP_URL}/verify-email?token={token}"
    try:
        from email_service import send_email, SENDER_NOREPLY
        await send_email(
            to=new_email,
            subject="Verify your new LumaScout email",
            text_body=(
                "We received a request to change your LumaScout login email "
                f"to this address.\n\nVerify within 2 hours:\n{verify_link}\n\n"
                "If you didn't request this, you can ignore this email."
            ),
            sender=SENDER_NOREPLY,
            tag="email-change-verify",
        )
    except Exception as exc:
        logger.warning("[email-change] verify send failed: %s", exc)

    return {
        "ok": True,
        "message": "Check your new email for a verification link.",
        "expires_at": doc["expires_at"].isoformat(),
        # Dev convenience — remove once Postmark sender domain is verified
        "dev_token": token,
    }


@api.get("/auth/email-change/verify")
async def verify_email_change(token: str):
    if not token:
        raise HTTPException(status_code=400, detail="Token is required")
    rec = await db.email_changes.find_one({"token": token})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="Invalid or expired link")
    exp = rec.get("expires_at")
    now = utcnow()
    if exp and (exp.replace(tzinfo=now.tzinfo) if exp.tzinfo is None else exp) < now:
        raise HTTPException(status_code=400, detail="This verification link has expired")

    user = await db.users.find_one({"user_id": rec["user_id"]})
    if not user:
        raise HTTPException(status_code=400, detail="Account not found")

    # Final duplicate check (in case someone else grabbed the email since)
    other = await db.users.find_one({"email": rec["new_email"]})
    if other and other.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=409, detail="This email is now in use by another account")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"email": rec["new_email"], "email_updated_at": utcnow()}},
    )
    await db.email_changes.update_one(
        {"change_id": rec["change_id"]},
        {"$set": {"used": True, "used_at": utcnow()}},
    )
    # Audit log + notify old email
    await db.email_change_audit.insert_one({
        "audit_id": f"eca_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "old_email": rec["old_email"],
        "new_email": rec["new_email"],
        "at": utcnow(),
    })
    try:
        from email_service import send_email, SENDER_NOREPLY
        if rec.get("old_email"):
            await send_email(
                to=rec["old_email"],
                subject="Your LumaScout email was changed",
                text_body=(
                    f"Your LumaScout login email was changed to {rec['new_email']}.\n\n"
                    "If this wasn't you, please contact support@lumascout.app immediately."
                ),
                sender=SENDER_NOREPLY,
                tag="email-change-notice-old",
            )
    except Exception:
        pass

    return {"ok": True, "message": "Email updated. Sign in with your new email next time."}


@api.post("/auth/google/session")
async def google_session(body: GoogleSessionIn):
    """Exchange Emergent session_id for our app JWT.
    REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH"""
    url = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url, headers={"X-Session-ID": body.session_id})
            if r.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid session")
            data = r.json()
    except httpx.HTTPError:
        raise HTTPException(status_code=500, detail="Google auth service error")

    email = (data.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="No email from Google")

    user = await db.users.find_one({"email": email})
    if user is None:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        username = email.split("@")[0]
        user = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name") or username,
            "username": username,
            "avatar_url": data.get("picture"),
            "avatar_image_url": data.get("picture"),
            "banner_image_url": None,
            "bio": "",
            "city": "",
            "state": "",
            "specialties": [],
            "website": "",
            "instagram": "",
            "facebook_url": "",
            "tiktok_url": "",
            "role": "user",
            "verification_status": "unverified",
            "auth_provider": "google",
            "plan": "free",
            "billing_cycle": None,
            "primary_country": "US",
            "primary_region": None,
            "timezone": None,
            "language_hint": "en",
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
        await db.users.insert_one(user)
    else:
        # update picture if changed
        if data.get("picture") and user.get("avatar_url") != data.get("picture"):
            await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"avatar_url": data.get("picture")}})
            user["avatar_url"] = data.get("picture")

    token = create_access_token(user["user_id"], email)
    return {"token": token, "user": clean_doc(user)}


# ============================================================================
# Users
# ============================================================================


# ============================================================================
# Who Viewed Your Profile (Phase B.1)
# Free:   blurred count + top-3 blurred avatars + "upgrade to unlock"
# Pro:    full list, names, city, timestamp, follow-back + message CTAs
# Elite:  full list + analytics (top cities, specialty breakdown, repeat
#         viewers, trend line)
# ============================================================================








# ============================================================================
# Spots
# ============================================================================










@api.get("/feed/home")
@graceful(
    fallback={"hero": [], "nearby": [], "golden": [], "seasonal": [],
              "new": [], "trending": [], "featured": [], "degraded": True},
    label="/feed/home",
    logger=logging.getLogger("feed.home"),
)
async def home_feed(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    """Personalized, diversified home feed.

    Signals used when viewer is authenticated:
      - viewer.specialties → boosts matching shoot_types
      - viewer.saved_spots → boosts similar spots (same city / shoot_type overlap)
      - viewer.city/state → prefers local spots
      - recent save/view counters (save_count, view_count, comment_count on spot)
    Signals for everyone:
      - proximity to device GPS or profile city
      - freshness (recent create/update)
      - verification/approval recency
      - golden-hour strength for the golden section
      - month-of-year match for seasonal
    Diversification:
      - each section cap 10 items
      - no single spot duplicated within one section
      - hero and bucket-to-bucket repetition is smoothed client-side
    """
    # PERF: per-user in-memory cache with 30s TTL. Home feed is expensive to
    # compute (scans up to 800 spots + rescores). A 30s cache gives 10–100x
    # speedup for the common case (user opens Home, navigates away, returns).
    # Keyed by (user_id, lat_bin, lng_bin) so moving more than ~300m invalidates.
    try:
        cache_key = (
            viewer.get("user_id") if viewer else "anon",
            round(float(lat), 3) if lat is not None else None,
            round(float(lng), 3) if lng is not None else None,
        )
        cached = _HOME_FEED_CACHE.get(cache_key)
        if cached and (time.time() - cached[0] < 30):
            return cached[1]
    except Exception:
        cache_key = None

    base_query = {"privacy_mode": {"$in": ["public", "premium"]}, "visibility_status": "approved", "is_test_data": {"$ne": True}}
    all_spots = await db.spots.find(base_query, {"_id": 0}).to_list(800)
    scored = []
    for s in all_spots:
        v = public_spot_view(s, viewer)
        if v:
            scored.append(v)
    await attach_owners(scored)

    # ---- Distance center --------------------------------------------------
    # FIX(2026-04 / Item #3): Strict policy — distance is computed ONLY from
    # the device GPS. Previously we fell back to (a) the first profile-city
    # spot's coordinates, and (b) Austin defaults — both produced wildly
    # incorrect mileage (e.g. "Muleshoe Bend 1.4 mi" for a San Antonio user).
    # Now: no GPS → distance_km/distance_mi remain None, and the frontend
    # renders "Distance unavailable" instead of a fabricated value.
    center_lat: Optional[float] = None
    center_lng: Optional[float] = None
    center_source = "unavailable"
    if lat is not None and lng is not None:
        center_lat, center_lng = float(lat), float(lng)
        center_source = "device_gps"
    for s in scored:
        if center_lat is None or center_lng is None:
            s["distance_km"], s["distance_mi"] = None, None
            s["distance_source"] = "unavailable"
            continue
        try:
            d_km = haversine_km(center_lat, center_lng, s["latitude"], s["longitude"])
            s["distance_km"] = round(d_km, 2)
            s["distance_mi"] = round(d_km * 0.621371, 2)
            s["distance_source"] = center_source
        except Exception:
            s["distance_km"], s["distance_mi"] = None, None
            s["distance_source"] = "unavailable"

    # ---- Personalization inputs -------------------------------------------
    viewer_specialties: set = set(viewer.get("specialties") or []) if viewer else set()
    viewer_city = (viewer.get("city") or "").lower() if viewer else ""
    saved_shoot_types: set = set()
    saved_cities: set = set()
    recent_saved_ids: set = set()
    if viewer:
        my_saves = await db.spot_saves.find(
            {"user_id": viewer["user_id"]}, {"_id": 0, "spot_id": 1}
        ).sort("created_at", -1).limit(50).to_list(50)
        saved_ids = [sv["spot_id"] for sv in my_saves]
        recent_saved_ids = set(saved_ids[:20])
        if saved_ids:
            sspots = await db.spots.find(
                {"spot_id": {"$in": saved_ids}},
                {"_id": 0, "shoot_types": 1, "city": 1},
            ).to_list(200)
            for sp in sspots:
                for st in (sp.get("shoot_types") or []):
                    saved_shoot_types.add(st)
                if sp.get("city"):
                    saved_cities.add(sp["city"].lower())

    # ---- Scoring helpers --------------------------------------------------
    now = utcnow()
    def _freshness(s):
        created = s.get("created_at") or s.get("updated_at")
        if not created: return 0
        if isinstance(created, str):
            try:
                created = datetime.fromisoformat(created.replace("Z", "+00:00"))
            except Exception:
                return 0
        if isinstance(created, datetime) and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        age_days = max(0, (now - created).total_seconds() / 86400)
        # Linear decay — full credit at 0 days, zero at 30 days, small negative after.
        return max(0.0, 1.0 - (age_days / 30.0))

    def _proximity_boost(s):
        if s.get("distance_km") is None: return 0
        if s["distance_km"] < 25: return 1.0
        if s["distance_km"] < 100: return 0.5
        if s["distance_km"] < 400: return 0.2
        return 0.0

    def _personal_boost(s):
        score = 0.0
        st = set(s.get("shoot_types") or [])
        if viewer_specialties and (st & viewer_specialties):
            score += 0.8
        if saved_shoot_types and (st & saved_shoot_types):
            score += 0.6
        if viewer_city and (s.get("city") or "").lower() == viewer_city:
            score += 0.5
        if saved_cities and (s.get("city") or "").lower() in saved_cities:
            score += 0.3
        return score

    def _engagement(s):
        # Mild signal from accumulated saves/views/comments.
        return min(
            2.0,
            0.05 * (s.get("save_count") or 0)
            + 0.02 * (s.get("view_count") or 0)
            + 0.05 * (s.get("comment_count") or 0)
        )

    def _golden_strength(s):
        mh = s.get("morning_golden_hour_rating") or 0
        eh = s.get("evening_golden_hour_rating") or 0
        sr = s.get("sunrise_quality") or s.get("sunrise_rating") or 0
        ss = s.get("sunset_quality") or s.get("sunset_rating") or 0
        return mh + eh + (sr + ss) * 0.5

    # Exclude spots the viewer already saved from "Best for your shoots" so it
    # always shows fresh suggestions, not reminders of spots they know.
    def _exclude_saved(arr):
        if not recent_saved_ids: return arr
        return [s for s in arr if s["spot_id"] not in recent_saved_ids]

    # ---- Section builders -------------------------------------------------
    nearby_list = sorted(
        [s for s in scored if s.get("distance_km") is not None],
        key=lambda s: s["distance_km"],
    )[:12]

    # "Trending this week" — recent engagement weighted, capped radius
    week_ago = now - timedelta(days=7)
    def _recent_weight(s):
        # Boost spots updated or approved in last 7 days
        upd = s.get("updated_at") or s.get("created_at")
        if isinstance(upd, str):
            try: upd = datetime.fromisoformat(upd.replace("Z", "+00:00"))
            except Exception: upd = None
        if isinstance(upd, datetime) and upd.tzinfo is None:
            upd = upd.replace(tzinfo=timezone.utc)
        fresh = 1.0 if (isinstance(upd, datetime) and upd > week_ago) else 0.0
        return (
            _engagement(s) * 2.0
            + s["shoot_score"] * 0.5
            + fresh * 1.2
            + _proximity_boost(s) * 0.6
        )
    trending = sorted(scored, key=_recent_weight, reverse=True)[:10]

    # "Golden hour favorites" — strong light + recently confirmed + proximity
    def _golden_weight(s):
        return (
            _golden_strength(s) * 1.2
            + _freshness(s) * 0.8
            + _proximity_boost(s) * 0.5
            + (1.0 if s.get("verification_status") == "verified" else 0.0)
        )
    golden = sorted(
        [s for s in scored if _golden_strength(s) > 0],
        key=_golden_weight, reverse=True,
    )[:10]

    # "Recently added" — strict by created_at, with fallback, exclude viewer's own spots
    def _created_ts(s):
        v = s.get("created_at")
        if isinstance(v, datetime): return v
        if isinstance(v, str):
            try: return datetime.fromisoformat(v.replace("Z", "+00:00"))
            except Exception: return datetime.min.replace(tzinfo=timezone.utc)
        return datetime.min.replace(tzinfo=timezone.utc)
    recent_pool = [s for s in scored if not viewer or s.get("owner_user_id") != viewer["user_id"]]
    recent = sorted(recent_pool, key=_created_ts, reverse=True)[:10]

    # "Best for your shoots" — only populated when we know specialties or saves.
    best_for_you = []
    if viewer and (viewer_specialties or saved_shoot_types):
        matches = [s for s in scored if _personal_boost(s) > 0]
        matches = _exclude_saved(matches)
        best_for_you = sorted(
            matches,
            key=lambda s: _personal_boost(s) * 2 + s["shoot_score"] * 0.3 + _freshness(s) * 0.4,
            reverse=True,
        )[:10]

    # "From photographers you follow"
    following_feed = []
    if viewer:
        follow_rows = await db.follows.find(
            {"follower_user_id": viewer["user_id"]}, {"_id": 0}
        ).to_list(300)
        followed_ids = [r["followed_user_id"] for r in follow_rows]
        if followed_ids:
            following_feed = sorted(
                [s for s in scored if s["owner_user_id"] in followed_ids],
                key=lambda s: _freshness(s) * 2 + s["shoot_score"] * 0.2, reverse=True,
            )[:10]

    # "Seasonal highlights" — month match + variety + verification recency
    current_month = datetime.now().strftime("%B")
    def _seasonal_weight(s):
        month_match = 1.0 if current_month in (s.get("best_months") or []) else 0.0
        return (
            month_match * 2.0
            + (s.get("variety_rating") or 0) * 0.2
            + _freshness(s) * 0.7
            + _proximity_boost(s) * 0.4
        )
    seasonal = sorted(scored, key=_seasonal_weight, reverse=True)[:10]
    # Drop zero-weight items if we have any with month match; otherwise keep variety fallback
    if any(current_month in (s.get("best_months") or []) for s in seasonal):
        seasonal = [s for s in seasonal if current_month in (s.get("best_months") or [])][:10]

    # Hero pick — highest shoot_score with recency and image count as tiebreakers.
    hero_pool = sorted(
        scored,
        key=lambda s: s["shoot_score"] + _freshness(s) * 3 + min(3, len(s.get("images") or [])) * 0.5,
        reverse=True,
    )
    hero = hero_pool[0] if hero_pool else None

    # "Freshly Updated Near You" — spots with recent community uploads or
    # updates, sorted by last_activity_at and proximity.
    # (Feature 9 / 2026-04 — drives the retention loop on the home screen.)
    now_ = utcnow()
    fresh_cutoff = now_ - timedelta(days=30)
    def _activity_ts(s: dict):
        v = s.get("last_activity_at")
        if isinstance(v, datetime): return v
        if isinstance(v, str):
            try: return datetime.fromisoformat(v.replace("Z", "+00:00"))
            except Exception: return None
        return None
    fresh_candidates = []
    for s in scored:
        ts = _activity_ts(s)
        if not ts:
            continue
        # Normalize to aware UTC
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if ts < fresh_cutoff:
            continue
        age_h = max(1.0, (now_ - ts).total_seconds() / 3600.0)
        # Closer + more-recent = higher weight.
        recency = 1.0 / (1.0 + age_h / 24.0)  # decays across days
        s = dict(s)
        s["_fresh_recency"] = recency
        s["_fresh_last_activity"] = ts.isoformat()
        fresh_candidates.append(s)
    freshly_updated = sorted(
        fresh_candidates,
        key=lambda s: s["_fresh_recency"] * 2 + _proximity_boost(s) * 1.5 + (s.get("freshness_score") or 0) * 0.3,
        reverse=True,
    )[:10]
    # strip private helpers before returning
    for s in freshly_updated:
        s.pop("_fresh_recency", None)

    # Phase 2 rails (Feature 9) — additional home-feed sections to drive
    # daily open frequency. Each is derived from the already-hydrated
    # `scored` pool so we avoid a second DB pass.
    week_cutoff = now_ - timedelta(days=7)

    # NEW PHOTOS ADDED — spots whose latest_photo_at is within 7 days,
    # ranked by recency and recent upload volume.
    def _ts(v):
        if isinstance(v, datetime): return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        if isinstance(v, str):
            try: return datetime.fromisoformat(v.replace("Z", "+00:00"))
            except Exception: return None
        return None
    new_photos = []
    for s in scored:
        lp = _ts(s.get("latest_photo_at"))
        if lp and lp >= week_cutoff:
            new_photos.append(s)
    new_photos = sorted(
        new_photos,
        key=lambda s: (_ts(s.get("latest_photo_at")) or datetime.min.replace(tzinfo=timezone.utc),
                       s.get("recent_upload_count_7d") or 0),
        reverse=True,
    )[:10]

    # VERIFIED THIS WEEK — spots that have received a "verified_today"
    # condition tag in the last 7 days.
    verified_spot_ids: set = set()
    try:
        async for r in db.spot_community_uploads.find(
            {"moderation_status": "approved", "condition_tags": "verified_today",
             "created_at": {"$gte": week_cutoff}},
            {"_id": 0, "spot_id": 1},
        ):
            verified_spot_ids.add(r["spot_id"])
        async for r in db.spot_updates.find(
            {"moderation_status": "approved", "condition_tags": "verified_today",
             "created_at": {"$gte": week_cutoff}},
            {"_id": 0, "spot_id": 1},
        ):
            verified_spot_ids.add(r["spot_id"])
    except Exception:
        verified_spot_ids = set()
    verified_this_week = [s for s in scored if s.get("spot_id") in verified_spot_ids][:10]

    # BLOOMING NOW — spots flagged with "blooming" condition in last 14d.
    # Slightly wider window since flower seasons cluster.
    bloom_cutoff = now_ - timedelta(days=14)
    bloom_ids: set = set()
    try:
        async for r in db.spot_community_uploads.find(
            {"moderation_status": "approved", "condition_tags": "blooming",
             "created_at": {"$gte": bloom_cutoff}},
            {"_id": 0, "spot_id": 1},
        ):
            bloom_ids.add(r["spot_id"])
        async for r in db.spot_updates.find(
            {"moderation_status": "approved", "condition_tags": "blooming",
             "created_at": {"$gte": bloom_cutoff}},
            {"_id": 0, "spot_id": 1},
        ):
            bloom_ids.add(r["spot_id"])
    except Exception:
        bloom_ids = set()
    blooming_now = [s for s in scored if s.get("spot_id") in bloom_ids][:10]

    # TRENDING AGAIN — spots that had a fresh burst (3+ uploads last 7d)
    # AND are scoring well on the feed's score field. Useful for
    # rediscovery of spots that previously went quiet.
    trending_again = sorted(
        [s for s in scored if (s.get("recent_upload_count_7d") or 0) >= 3],
        key=lambda s: (s.get("recent_upload_count_7d") or 0, s.get("score") or 0),
        reverse=True,
    )[:10]

    result = {
        "hero": hero,
        "nearby": nearby_list,
        "trending": trending,
        "golden_hour": golden,
        "recent": recent,
        "best_for_you": best_for_you,
        "following": following_feed,
        "seasonal": seasonal,
        "freshly_updated": freshly_updated,
        "new_photos": new_photos,
        "verified_this_week": verified_this_week,
        "blooming_now": blooming_now,
        "trending_again": trending_again,
    }
    # PERF: strip heavy base64 blobs from the feed payload. Some spots have
    # raw base64 data URLs stored in `hero_cover_image_url` /
    # `admin_cover_override` (admin-uploaded originals that never got pushed
    # to a CDN). Left unmodified, a single spot appearing in 5 feed sections
    # can bloat the response to 80+ MB and push load time past 8 seconds.
    # This slim pass drops it back to ~1 MB without changing product behavior
    # — the client falls back to `images[0].image_url` (Unsplash URLs)
    # for any stripped covers via the existing SpotCard cover-resolution.
    _slim_feed_payload(result)
    # PERF: write to per-user in-memory cache (30s TTL — see top of function).
    try:
        if cache_key is not None:
            _HOME_FEED_CACHE[cache_key] = (time.time(), result)
    except Exception:
        pass
    return result


def _slim_feed_payload(payload: dict) -> None:
    """Remove heavy base64 data URLs from a feed payload, in place.

    Any image-shaped field that holds a `data:` URL is replaced with None
    (or stripped-out for objects whose image_url is nested inside). The
    50 KB ceiling was too lenient — any compressed avatar-sized JPEG fits
    under it yet still wastes bandwidth across 80 spot cards (80 × 15 KB
    = 1.2 MB). Apr 2026: dropped the limit to 2 KB (below which the
    string is likely a 1x1 placeholder), expanded the owner sweep to
    cover banner_url, and added spot-level sweeps for fields that were
    leaking through (community_uploads_preview, reviews[].author.avatar_url,
    spot_updates[].image_url).
    """
    LIMIT = 2 * 1024  # 2 KB

    def _is_heavy_b64(v: Any) -> bool:
        return isinstance(v, str) and v.startswith("data:") and len(v) > LIMIT

    def _strip_user_obj(u: Any) -> None:
        if not isinstance(u, dict):
            return
        # Both the short (`avatar_url`) and the legacy long-form
        # (`avatar_image_url`) field names live in the wild — a handful
        # of endpoints emit the longer ones. Sweep both, plus banner
        # variants.
        for k in (
            "avatar_url", "banner_url", "cover_photo_url",
            "avatar_image_url", "banner_image_url", "header_image_url",
        ):
            if _is_heavy_b64(u.get(k)):
                u[k] = None

    def _strip_image_list(items: Any) -> None:
        if not isinstance(items, list):
            return
        for im in items:
            if isinstance(im, dict) and _is_heavy_b64(im.get("image_url")):
                im["image_url"] = None
            if isinstance(im, dict):
                # Some items embed the uploader — sweep their avatar too
                _strip_user_obj(im.get("user") or im.get("author") or im.get("owner"))

    def _slim_spot(s: Any) -> None:
        if not isinstance(s, dict):
            return
        if _is_heavy_b64(s.get("hero_cover_image_url")):
            s["hero_cover_image_url"] = None
        aco = s.get("admin_cover_override")
        if isinstance(aco, dict) and _is_heavy_b64(aco.get("image_url")):
            aco["image_url"] = None
        elif _is_heavy_b64(aco):
            s["admin_cover_override"] = None
        _strip_image_list(s.get("images"))
        _strip_image_list(s.get("community_uploads"))
        _strip_image_list(s.get("community_uploads_preview"))
        _strip_image_list(s.get("recent_uploads"))
        _strip_image_list(s.get("ugc_uploads"))
        _strip_image_list(s.get("spot_updates"))
        _strip_user_obj(s.get("owner"))
        _strip_user_obj(s.get("created_by_user"))
        reviews = s.get("reviews")
        if isinstance(reviews, list):
            for rv in reviews:
                if isinstance(rv, dict):
                    _strip_user_obj(rv.get("author") or rv.get("user"))

    for k, v in payload.items():
        if isinstance(v, list):
            for s in v:
                _slim_spot(s)
        elif isinstance(v, dict):
            _slim_spot(v)




# ============================================================================
# Community uploads & updates — the "living spot" retention feature.
# (Commit 9 / 2026-04) Lets any logged-in user contribute fresh photos +
# short text check-ins to existing spots. Auto-approved for admin /
# verified / spot-owner; pending for everyone else. Drives the
# "Freshly Updated Near You" home rail and the per-spot community sections.
# ============================================================================

# Canonical condition tag vocabulary — keep short + capped. Frontend mirrors
# this list for the chip selector on the upload screen.
ALLOWED_CONDITION_TAGS = [
    "verified_today",  # "Verified today" check-in
    "blooming",
    "great_sunset",
    "crowded",
    "quiet",
    "muddy",
    "dog_friendly",
    "family_friendly",
    "closed_gate",
    "construction",
    "good_parking",
    "fall_colors",
]








def _can_auto_approve(user: dict, spot: dict) -> bool:
    """Rule: auto-approve for admins/mods/support, verified users, and the spot's author."""
    if not user:
        return False
    if user.get("role") in ("admin", "super_admin", "moderator", "support"):
        return True
    if user.get("verification_status") == "verified":
        return True
    if spot and spot.get("owner_user_id") == user.get("user_id"):
        return True
    return False




async def _hydrate_contributors(items: List[dict]) -> List[dict]:
    """Attach a minimal contributor object to each upload/update."""
    if not items:
        return items
    uids = list({i.get("user_id") for i in items if i.get("user_id")})
    if not uids:
        return items
    rows = await db.users.find(
        {"user_id": {"$in": uids}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1,
         "avatar_url": 1, "verification_status": 1, "plan": 1,
         "is_official": 1, "is_bot": 1},
    ).to_list(len(uids))
    umap = {u["user_id"]: u for u in rows}
    for it in items:
        it["contributor"] = umap.get(it.get("user_id"))
    return items


async def _recompute_spot_freshness(spot_id: str):
    """Recalculate `freshness_score`, `recent_upload_count_7d`,
    `latest_photo_at`, `last_activity_at` on the spot. Called after any
    new approved upload or update. Kept simple: weights per user spec.
    """
    now = utcnow()
    seven_days_ago = now - timedelta(days=7)
    # Count recent APPROVED uploads + updates
    approved_uploads = await db.spot_community_uploads.count_documents({
        "spot_id": spot_id,
        "moderation_status": "approved",
        "created_at": {"$gte": seven_days_ago},
    })
    approved_updates = await db.spot_updates.count_documents({
        "spot_id": spot_id,
        "moderation_status": "approved",
        "created_at": {"$gte": seven_days_ago},
    })
    # Verified-user recent uploads (extra boost)
    verified_recent = await db.spot_community_uploads.count_documents({
        "spot_id": spot_id,
        "moderation_status": "approved",
        "contributor_verified": True,
        "created_at": {"$gte": seven_days_ago},
    })
    # Sum of helpful-count across recent approved uploads (cheap, no aggregate)
    recent_approved_docs = await db.spot_community_uploads.find({
        "spot_id": spot_id,
        "moderation_status": "approved",
        "created_at": {"$gte": seven_days_ago},
    }, {"_id": 0, "like_count": 1, "helpful_count": 1}).to_list(200)
    reactions = sum((d.get("like_count") or 0) + (d.get("helpful_count") or 0)
                    for d in recent_approved_docs)
    # Latest approved photo timestamp (for "Updated X ago" chip)
    latest_photo = await db.spot_community_uploads.find_one(
        {"spot_id": spot_id, "moderation_status": "approved"},
        {"_id": 0, "created_at": 1},
        sort=[("created_at", -1)],
    )
    # Any activity (photo OR update) for last_activity_at
    latest_update = await db.spot_updates.find_one(
        {"spot_id": spot_id, "moderation_status": "approved"},
        {"_id": 0, "created_at": 1},
        sort=[("created_at", -1)],
    )
    last_activity_at = None
    if latest_photo and latest_update:
        a, b = latest_photo.get("created_at"), latest_update.get("created_at")
        last_activity_at = max(a, b) if a and b else (a or b)
    else:
        last_activity_at = (latest_photo or {}).get("created_at") or (latest_update or {}).get("created_at")
    # Simple weighted score in [0, 10+]
    score = (
        approved_uploads * 2.0
        + approved_updates * 1.0
        + verified_recent * 1.5
        + min(10, reactions) * 0.3
    )
    await db.spots.update_one(
        {"spot_id": spot_id},
        {"$set": {
            "freshness_score": round(score, 2),
            "recent_upload_count_7d": approved_uploads,
            "recent_update_count_7d": approved_updates,
            "latest_photo_at": (latest_photo or {}).get("created_at"),
            "last_activity_at": last_activity_at,
        }},
    )












# ---- Admin moderation ------------------------------------------------------







# ============================================================================
# Notifications — lightweight in-app inbox.
# (Feature 9 Phase 2 / 2026-04) Fires on: like on user's upload; upload posted
# to a spot the user saved; moderator approved user's upload; "verified today"
# or "blooming" flagged on a saved spot. Push-ready: each notification carries
# a `deep_link` that the push payload can reuse later.
# ============================================================================

async def _emit_notification(
    user_id: str,
    kind: str,
    title: str,
    body: str,
    *,
    actor_user_id: Optional[str] = None,
    spot_id: Optional[str] = None,
    upload_id: Optional[str] = None,
    update_id: Optional[str] = None,
    deep_link: Optional[str] = None,
    image_url: Optional[str] = None,
) -> None:
    """Persist a notification row AND dispatch a push notification (best effort).

    Central emitter for the app. Rules applied in send_growth_push:
      • category opt-out via user.notification_preferences.categories
      • quiet hours in the user's local timezone
      • daily frequency cap (default 10/day)
      • 10-min dedupe window on (user, kind, title)
    Never raises — notifications are side-channel and must not block flows.
    """
    if not user_id or user_id == actor_user_id:
        return
    try:
        await db.notifications.insert_one({
            "notification_id": f"ntf_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "kind": kind,
            "title": title[:120],
            "body": body[:280],
            "actor_user_id": actor_user_id,
            "spot_id": spot_id,
            "upload_id": upload_id,
            "update_id": update_id,
            "image_url": image_url,
            "deep_link": deep_link,
            "read_at": None,
            "created_at": utcnow(),
        })
    except Exception:
        pass
    # Dispatch push (fire-and-forget). Schedule as a task so long webhooks
    # don't await on network I/O. Hold a strong reference to the task until
    # it completes — otherwise the asyncio loop may GC the coroutine before
    # its inner awaits (db.push_log.insert_one, httpx post) complete.
    try:
        t = asyncio.create_task(send_growth_push(
            user_id=user_id, kind=kind, title=title, body=body,
            deep_link=deep_link, image_url=image_url,
        ))
        _BG_PUSH_TASKS.add(t)
        t.add_done_callback(_BG_PUSH_TASKS.discard)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Push Notification Growth System (Phase 2026-04-23)
# ---------------------------------------------------------------------------
# Categories map app events (kind) to user-toggleable preference buckets.
# This lets users say "no marketplace pushes" without also losing messages.
# ---------------------------------------------------------------------------
NOTIFICATION_CATEGORIES: Dict[str, str] = {
    # explore
    "new_spot_nearby": "explore",
    "saved_spot_update": "explore",
    "saved_spot_fresh_photo": "explore",
    "saved_spot_verified": "explore",
    "saved_spot_blooming": "explore",
    "trending_spot": "explore",
    "golden_hour": "explore",
    # network
    "profile_view": "network",
    "new_follower": "network",
    # messages
    "dm_request": "messages",
    "dm_message": "messages",
    "new_message": "messages",
    "new_message_request": "messages",
    # referrals
    "referral_nearby": "referrals",
    "referral_application": "referrals",
    "new_referral_applicant": "referrals",
    "referral_application_accepted": "referrals",
    # marketplace
    "marketplace_sale": "marketplace",
    "marketplace_refund": "marketplace",
    "marketplace_payout": "marketplace",
    "wishlist_discount": "marketplace",
    "featured_pack": "marketplace",
    # community
    "upload_featured": "community",
    "upload_reaction": "community",
    "upload_approved": "community",
    "upload_rejected": "community",
    "reply_on_post": "community",
    "comment_reply": "community",
    "comment_mention": "community",
    "poll_update": "community",
    # security — always delivered (maps to network so master off still blocks)
    "user_sanction_warning": "network",
    "user_sanction_suspension": "network",
    "security_alert": "network",
    # promotional / monetization nudges
    "upgrade_nudge": "promotions",
    "pack_creator_nudge": "promotions",
}

# ---------------------------------------------------------------------------
# Transactional / safety pushes that bypass quiet-hours + daily-cap gates.
# These are high-signal, user-initiated, or revenue/safety critical events
# the user expects to receive immediately. They STILL respect:
#   - master push_enabled flag
#   - category opt-out
#   - 10-min dedupe window
# ---------------------------------------------------------------------------
BYPASS_CAP_KINDS: set = {
    # Direct messages — user explicitly reached out
    "new_message", "new_message_request", "dm_message", "dm_request",
    # Revenue + payouts — seller expects instant awareness
    "marketplace_sale", "marketplace_refund", "marketplace_payout",
    # Referral acceptance — applicant just got a gig
    "referral_application_accepted",
    # Security / account safety
    "user_sanction_warning", "user_sanction_suspension", "security_alert",
}

# Strong references for fire-and-forget push tasks. Without this, Python may
# GC the task before its inner db.push_log insert + httpx POST complete,
# causing silent push drops and missing log entries (observed 2026-04-23 QA).
_BG_PUSH_TASKS: set = set()
DEFAULT_NOTIFICATION_PREFERENCES: Dict[str, Any] = {
    "categories": {
        "explore": True, "network": True, "messages": True,
        "referrals": True, "marketplace": True, "community": True,
        "promotions": False,   # off by default (respect users)
    },
    "quiet_hours": {"enabled": True, "start": "22:00", "end": "07:00"},  # local TZ
    "timezone": "UTC",
    "daily_cap": 10,
    "push_enabled": True,
}


def _tz_from_user(user: dict) -> str:
    prefs = user.get("notification_preferences") or {}
    return prefs.get("timezone") or user.get("timezone") or "UTC"


def _is_in_quiet_hours(user: dict) -> bool:
    """True if user's local time falls inside their quiet-hours window."""
    prefs = user.get("notification_preferences") or {}
    qh = prefs.get("quiet_hours") or {}
    if not qh.get("enabled"):
        return False
    start = qh.get("start") or "22:00"
    end = qh.get("end") or "07:00"
    try:
        sh, sm = (int(x) for x in start.split(":"))
        eh, em = (int(x) for x in end.split(":"))
    except Exception:
        return False
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(_tz_from_user(user))
    except Exception:
        from datetime import timezone as _tz
        tz = _tz.utc
    now_local = datetime.now(tz).time()
    start_t = datetime.min.replace(hour=sh, minute=sm).time()
    end_t = datetime.min.replace(hour=eh, minute=em).time()
    # Windows that wrap midnight (22:00 → 07:00) are a union.
    if start_t <= end_t:
        return start_t <= now_local <= end_t
    return (now_local >= start_t) or (now_local <= end_t)


async def send_growth_push(
    user_id: str, kind: str, title: str, body: str,
    deep_link: Optional[str] = None, image_url: Optional[str] = None,
) -> bool:
    """Core push dispatcher. Returns True if a push was queued/sent.

    Gates:
      1. User exists + has push_enabled
      2. Category preference ON (inferred from kind)
      3. Not currently in quiet hours (local TZ)
      4. Under daily_cap
      5. Not duplicated in the last 10 min
    """
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not u:
        return False
    prefs = u.get("notification_preferences") or DEFAULT_NOTIFICATION_PREFERENCES
    if not prefs.get("push_enabled", True):
        return False
    category = NOTIFICATION_CATEGORIES.get(kind, "network")
    cats = prefs.get("categories") or DEFAULT_NOTIFICATION_PREFERENCES["categories"]
    if cats.get(category) is False:
        return False

    # Transactional / safety pushes bypass quiet hours and daily cap.
    # Master toggle, category opt-out, and dedupe still apply above/below.
    is_bypass = kind in BYPASS_CAP_KINDS

    if not is_bypass and _is_in_quiet_hours(u):
        return False

    now = utcnow()
    if not is_bypass:
        # Rate limit (daily cap) — non-transactional only
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        sent_today = await db.push_log.count_documents({
            "user_id": user_id,
            "sent_at": {"$gte": day_start},
            # Count only non-transactional sends against the cap
            "kind": {"$nin": list(BYPASS_CAP_KINDS)},
        })
        cap = int(prefs.get("daily_cap") or DEFAULT_NOTIFICATION_PREFERENCES["daily_cap"])
        if sent_today >= cap:
            return False

    # Dedupe: 10-min window on (user_id, kind, title)
    dup = await db.push_log.find_one({
        "user_id": user_id, "kind": kind, "title": title[:120],
        "sent_at": {"$gte": now - timedelta(minutes=10)},
    })
    if dup:
        return False

    # Dispatch to Expo
    data: Dict[str, Any] = {"kind": kind}
    if deep_link:
        data["deep_link"] = deep_link
        data["url"] = deep_link   # Expo + linking helpers
    if image_url:
        data["image_url"] = image_url
    await send_push([user_id], title, body, data)

    # Record for rate-limiting / analytics
    try:
        await db.push_log.insert_one({
            "log_id": f"pl_{uuid.uuid4().hex[:10]}",
            "user_id": user_id, "kind": kind, "category": category,
            "title": title[:120], "body": body[:240],
            "deep_link": deep_link,
            "sent_at": now,
        })
    except Exception:
        pass
    return True














# ============================================================================
# Direct Messages (DM) + Network/Discover (Network Phase A — 2026-04)
# ============================================================================

class DMSendIn(BaseModel):
    type: str = "text"          # text | image | spot_share | profile_share
    body: Optional[str] = None
    attachment_url: Optional[str] = None  # for image
    ref_spot_id: Optional[str] = None     # for spot_share
    ref_user_id: Optional[str] = None     # for profile_share


class DMStartIn(BaseModel):
    user_id: str
    opening_body: Optional[str] = None   # optional first message text
    kind: Optional[str] = None           # "message" | "refer" | "collab"


class DMReportIn(BaseModel):
    reason: str
    notes: Optional[str] = None


def _thread_key(u1: str, u2: str) -> str:
    return "::".join(sorted([u1, u2]))


async def _dm_get_or_create_thread(a: str, b: str, creator_user_id: Optional[str] = None) -> dict:
    """Idempotently return the 1:1 thread between two users.

    `creator_user_id` (optional) — when supplied on first creation, the
    thread is stamped with the user who initiated the conversation so we
    can later enforce the Free-tier 'monthly outbound thread' cap. For
    backwards compat, callers that don't pass it (legacy code paths)
    won't break.
    """
    key = _thread_key(a, b)
    t = await db.dm_threads.find_one({"thread_key": key})
    if t:
        return t
    now = utcnow()
    t = {
        "thread_id": f"dm_{uuid.uuid4().hex[:12]}",
        "thread_key": key,
        "participant_user_ids": sorted([a, b]),
        "creator_user_id": creator_user_id or a,
        "created_at": now,
        "updated_at": now,
        "last_message_at": None,
        "last_message_preview": None,
    }
    await db.dm_threads.insert_one(t)
    # Seed per-participant state docs
    for uid in t["participant_user_ids"]:
        await db.dm_participants.insert_one({
            "thread_id": t["thread_id"],
            "user_id": uid,
            "joined_at": now,
            "last_read_at": None,
            "is_muted": False,
            "is_blocked": False,
            "hidden": False,  # soft-delete for this viewer
        })
    return t


async def _thread_is_accepted(thread: dict, viewer_id: str) -> bool:
    """A thread is 'accepted' for the viewer if:
       - viewer follows the other participant, OR
       - any message_request for this pair is status=accepted, OR
       - viewer was the sender of the first message (their own thread)
    """
    others = [u for u in thread["participant_user_ids"] if u != viewer_id]
    if not others:
        return True
    other = others[0]
    fol = await db.follows.find_one({"follower_user_id": viewer_id, "followed_user_id": other})
    if fol:
        return True
    req = await db.dm_requests.find_one({
        "$or": [
            {"from_user_id": viewer_id, "to_user_id": other},
            {"from_user_id": other, "to_user_id": viewer_id},
        ],
        "status": "accepted",
    })
    return bool(req)


async def _emit_dm_notification(recipient_id: str, sender: dict, preview: str, thread_id: str):
    await _emit_notification(
        recipient_id,
        "new_message",
        f"New message from {sender.get('name') or 'a photographer'}",
        preview[:140],
        actor_user_id=sender["user_id"],
        deep_link=f"/inbox/{thread_id}",
        image_url=sender.get("avatar_url"),
    )




async def _dm_insert_message(thread: dict, sender: dict, payload: dict) -> dict:
    """Create a message + touch the thread. Shared by /start (opening body)
    and /messages endpoint. Rate-limits at 30 msgs/min per sender per thread.
    """
    msg_type = (payload.get("type") or "text").lower()
    if msg_type not in ("text", "image", "spot_share", "profile_share"):
        raise HTTPException(status_code=400, detail="Invalid message type")
    body_txt = (payload.get("body") or "").strip()
    if msg_type == "text" and len(body_txt) < 1:
        raise HTTPException(status_code=422, detail="Empty message")
    if msg_type == "text" and len(body_txt) > 2000:
        raise HTTPException(status_code=422, detail="Message too long")
    # Rate limit
    min_ago = utcnow() - timedelta(minutes=1)
    recent = await db.dm_messages.count_documents({
        "thread_id": thread["thread_id"],
        "sender_user_id": sender["user_id"],
        "created_at": {"$gte": min_ago},
    })
    if recent >= 30:
        raise HTTPException(status_code=429, detail="Sending too fast, slow down")
    doc = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "thread_id": thread["thread_id"],
        "sender_user_id": sender["user_id"],
        "type": msg_type,
        "body": body_txt or None,
        "attachment_url": payload.get("attachment_url") or None,
        "ref_spot_id": payload.get("ref_spot_id") or None,
        "ref_user_id": payload.get("ref_user_id") or None,
        "is_deleted": False,
        "created_at": utcnow(),
        # Read-receipt pipeline (Tier 1 messaging upgrade):
        # delivered_at is stamped at insert time since we immediately dispatch
        # an Expo push to the recipient — 95%+ accurate for our use case
        # without a websocket layer. seen_at is set later by mark-read.
        "delivered_at": utcnow(),
        "seen_at": None,
    }
    await db.dm_messages.insert_one(doc)
    preview = body_txt or {
        "image": "📷 Photo",
        "spot_share": "📍 Shared a spot",
        "profile_share": "👤 Shared a profile",
    }.get(msg_type, "")
    await db.dm_threads.update_one(
        {"thread_id": thread["thread_id"]},
        {"$set": {"last_message_at": doc["created_at"], "last_message_preview": preview[:160],
                  "updated_at": doc["created_at"]}},
    )
    # Unhide for both participants (in case they soft-deleted) AND
    # auto-unarchive for the recipient so a new inbound message always
    # surfaces back in their "All" tab (Instagram / iMessage behavior).
    # Pinned / muted state is preserved — only `hidden` and
    # `is_archived` are flipped back off.
    await db.dm_participants.update_many(
        {"thread_id": thread["thread_id"]},
        {"$set": {"hidden": False, "is_archived": False}},
    )
    # Notify the other participant
    others = [u for u in thread["participant_user_ids"] if u != sender["user_id"]]
    for other_id in others:
        try: await _emit_dm_notification(other_id, sender, preview, thread["thread_id"])
        except Exception: pass
    return doc






















# ---- Network / Discover -----------------------------------------------------

def _user_public_view(u: dict) -> dict:
    u = {**u}
    u.pop("_id", None)
    u.pop("password_hash", None)
    u.pop("email", None)
    return u


async def _compute_trust_metrics(user_id: str) -> dict:
    """Compute live trust metrics for a user. Kept cheap — 3 small queries.
    Response-rate = % of inbound threads where the user replied at least once.
    Average-reply-time = median (approx via mean for cheapness) of (first-reply
    ts − inbound-msg ts) across last 30 replies.
    Community-rating = simple average of likes-per-approved-upload, capped 5.
    """
    try:
        # Threads where user received a message
        my_threads_as_recipient = await db.dm_messages.distinct(
            "thread_id", {"sender_user_id": {"$ne": user_id}},
        )
        threads_in = [t for t in my_threads_as_recipient
                      if await db.dm_participants.find_one(
                          {"thread_id": t, "user_id": user_id})]
        responded = 0
        reply_samples = []
        for tid in threads_in[:80]:
            inbound = await db.dm_messages.find_one(
                {"thread_id": tid, "sender_user_id": {"$ne": user_id}},
                sort=[("created_at", 1)])
            if not inbound: continue
            outbound = await db.dm_messages.find_one(
                {"thread_id": tid, "sender_user_id": user_id,
                 "created_at": {"$gt": inbound["created_at"]}},
                sort=[("created_at", 1)])
            if outbound:
                responded += 1
                secs = (outbound["created_at"] - inbound["created_at"]).total_seconds()
                if secs > 0: reply_samples.append(secs / 3600.0)
        response_rate = round((responded / max(1, len(threads_in))) * 100) if threads_in else None
        avg_reply_h = round(sum(reply_samples) / max(1, len(reply_samples)), 1) if reply_samples else None
    except Exception:
        response_rate, avg_reply_h = None, None
    # Community rating: avg likes per approved upload, capped 5
    try:
        docs = await db.spot_community_uploads.find(
            {"user_id": user_id, "moderation_status": "approved"},
            {"_id": 0, "like_count": 1, "helpful_count": 1},
        ).to_list(200)
        if docs:
            avg_lk = sum((d.get("like_count") or 0) + (d.get("helpful_count") or 0) for d in docs) / len(docs)
            community_rating = round(min(5.0, 1.0 + avg_lk * 1.5), 1)
        else:
            community_rating = None
    except Exception:
        community_rating = None
    # Completed referrals — count accepted referral-kind requests sent by this user
    try:
        completed_referrals = await db.dm_requests.count_documents({
            "from_user_id": user_id, "kind": "refer", "status": "accepted",
        })
    except Exception:
        completed_referrals = 0
    return {
        "response_rate_pct": response_rate,
        "average_reply_time_hours": avg_reply_h,
        "community_rating": community_rating,
        "completed_referrals": completed_referrals,
    }








# ============================================================================
# Saves
# ============================================================================




# =============================================================================
# Location helpers — geocode proxy + recent-locations for manual spot creation.
# Nominatim (OpenStreetMap) is used as a keyless geocoder. Per their usage
# policy we set a descriptive User-Agent and cap rate on the client side.
# =============================================================================
NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
NOMINATIM_HEADERS = {
    "User-Agent": "LumaScout/1.0 (support@lumascout.app)",
    "Accept-Language": "en",
}

# FIX(Commit 7.7 / 2026-04): Mapbox primary geocoding provider. When the env
# var is set, the /geocode/search endpoint tries Mapbox first and falls back
# to Nominatim only if Mapbox returns nothing. This is the launch-grade
# enterprise stack — Mapbox handles business names, POIs, rural TX FM roads,
# and park/preserve names much more reliably than Nominatim alone.
MAPBOX_TOKEN = os.environ.get("MAPBOX_TOKEN", "").strip()
# Search Box API — the good one for POIs, parks, businesses, landmarks.
# Handles "Joshua Springs Preserve", "Pearl District", "McAllister Park".
MAPBOX_SEARCHBOX_BASE = "https://api.mapbox.com/search/searchbox/v1"
# v6 Geocoding API — used for reverse geocode and as a secondary signal.
MAPBOX_BASE = "https://api.mapbox.com/search/geocode/v6"


def _parse_mapbox_feature(f: dict) -> dict:
    """Shape a Mapbox feature (Search Box v1 OR Geocoding v6) into our format.

    Both APIs return GeoJSON features with a similar `properties.context`
    structure, so this parser handles both. Differences we normalize:
      - Search Box returns `feature_type: poi` with POI categories
      - v6 returns `feature_type: address` and a `match_code.confidence` string
    """
    props = f.get("properties", {}) or {}
    ctx = props.get("context", {}) or {}
    geom = f.get("geometry", {}) or {}
    coords = geom.get("coordinates") or [None, None]
    # Search Box sometimes nests coords in properties.coordinates too.
    if (coords[0] is None or coords[1] is None) and isinstance(props.get("coordinates"), dict):
        pc = props["coordinates"]
        coords = [pc.get("longitude"), pc.get("latitude")]
    # Prefer place (municipality) over region (state) for the city field.
    place = ctx.get("place", {}) or {}
    locality = ctx.get("locality", {}) or {}
    region = ctx.get("region", {}) or {}
    postcode = ctx.get("postcode", {}) or {}
    country = ctx.get("country", {}) or {}
    district = ctx.get("district", {}) or {}
    neighborhood = ctx.get("neighborhood", {}) or {}
    city = (
        place.get("name")
        or locality.get("name")
        or district.get("name")
        or neighborhood.get("name")
        or ""
    )
    state_full = region.get("name") or ""
    state_abbr = (region.get("region_code") or "").upper() or state_full[:2].upper()
    country_code = (country.get("country_code") or "").upper() or None
    # v6 returns a match_code with confidence; Search Box does not. Fall back
    # to a POI/place heuristic for Search Box results.
    mc = props.get("match_code", {}) or {}
    confidence_map = {"exact": 0.95, "high": 0.85, "medium": 0.65, "low": 0.35, "plausible": 0.25}
    conf_str = (mc.get("confidence") or "").lower()
    feature_type = (props.get("feature_type") or "").lower()
    if conf_str:
        confidence = confidence_map.get(conf_str, 0.6)
    else:
        # Search Box heuristic: POIs and full addresses are strong, streets/places weaker.
        confidence = {"poi": 0.9, "address": 0.85, "street": 0.55, "place": 0.5,
                      "locality": 0.5, "neighborhood": 0.55, "district": 0.4}.get(feature_type, 0.6)
    display_name = props.get("full_address") or props.get("place_formatted") or props.get("name") or ""
    # Prepend POI name to the formatted address when feature is a POI — so the
    # UI shows "Joshua Springs Preserve — 716 FM 289, Comfort, TX" rather than
    # just the street.
    if feature_type == "poi" and props.get("name") and display_name and props["name"] not in display_name:
        display_name = f"{props['name']}, {display_name}"
    return {
        "place_id": props.get("mapbox_id") or "",
        "display_name": display_name,
        "latitude": float(coords[1]) if coords[1] is not None else None,
        "longitude": float(coords[0]) if coords[0] is not None else None,
        "name": props.get("name") or "",
        "city": city,
        "state": state_abbr,
        "province_state": state_full,
        "county_region": district.get("name") or "",
        "country": country.get("name") or "",
        "country_name": country.get("name") or "",
        "country_code": country_code,
        "postcode": postcode.get("name") or "",
        "type": feature_type,
        "confidence": confidence,
        "language_hint": "en",
        "source_provider": "mapbox",
        "formatted_address": display_name,
        "poi_category": props.get("poi_category") or [],
    }


async def _mapbox_search(q: str, limit: int, country: Optional[str], proximity: Optional[str]) -> list:
    """Query Mapbox Search Box API v1 (POI-capable). Returns [] on error.

    Search Box handles parks, preserves, businesses, neighborhoods, and
    landmarks far better than the v6 Geocoding API (which rejects `poi` as
    a type entirely). This is the launch-grade primary provider.
    """
    if not MAPBOX_TOKEN:
        return []
    params: dict = {
        "q": q,
        "access_token": MAPBOX_TOKEN,
        "limit": str(max(1, min(10, limit))),
        "language": "en",
    }
    if country:
        params["country"] = country
    else:
        # Default bias to where the app has traction. Keeps "Pearl District"
        # anchored to San Antonio, TX and not Peru.
        params["country"] = "us,ca,mx"
    if proximity:
        params["proximity"] = proximity  # "lng,lat"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(f"{MAPBOX_SEARCHBOX_BASE}/forward", params=params)
            if r.status_code != 200:
                return []
            data = r.json() or {}
            return [_parse_mapbox_feature(f) for f in (data.get("features") or [])]
    except Exception:
        return []


def _progressive_query_variants(q: str) -> list:
    """Generate fallback query variants of decreasing specificity.

    Examples:
      "Joshua Springs Preserve 716 FM 289 Comfort TX 78013" →
        ["…78013", "…Comfort TX", "Joshua Springs Preserve Comfort TX",
         "Joshua Springs Preserve TX", "Joshua Springs Preserve"]
      "McAllister Park San Antonio" →
        ["McAllister Park San Antonio", "McAllister Park San",
         "McAllister Park", "McAllister"]

    We strip ZIP first (Nominatim hates mismatched ZIPs), then street
    numbers + FM-road prefixes (often wrong in the DB), then comma
    chunks, then trailing space-separated tokens. The original query is
    always index 0.
    """
    q = (q or "").strip()
    if not q:
        return []
    variants = [q]
    import re as _re
    _STATE_ABBR = {"AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID",
                   "IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS",
                   "MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK",
                   "OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV",
                   "WI","WY","USA"}
    # Drop trailing ZIP
    no_zip = _re.sub(r'\s+\b\d{5}(?:-\d{4})?\b\s*,?\s*$', '', q).strip().rstrip(",")
    if no_zip and no_zip != q:
        variants.append(no_zip)
    # Drop street numbers + FM/RR/CR/Highway prefixes (rural TX)
    no_street = _re.sub(
        r'\b\d+\s+(?:FM|RR|CR|US|SH|TX|Hwy|Highway|FR|Farm\s+Road|Ranch\s+Road|County\s+Road)\s*\d+\b',
        '', no_zip or q, flags=_re.IGNORECASE).strip().rstrip(",").strip()
    # Also drop plain leading street numbers like "716 Main St"
    no_street = _re.sub(r'^\d+\s+', '', no_street).strip()
    no_street = _re.sub(r'\s{2,}', ' ', no_street).strip()
    if no_street and no_street not in variants:
        variants.append(no_street)
    # Keep only first 3 comma-separated chunks (title, city, state)
    chunks = [c.strip() for c in (no_street or q).split(",") if c.strip()]
    if len(chunks) > 2:
        shorter = ", ".join(chunks[:2])
        if shorter not in variants:
            variants.append(shorter)
    # Just the title (first chunk)
    if chunks and chunks[0] not in variants and len(chunks[0]) >= 3:
        variants.append(chunks[0])

    # Space-separated token trimming — rescues queries like
    # "McAllister Park San Antonio" that have no ZIP/street/commas.
    # Strategy: progressively drop trailing tokens from the right, stopping
    # when we hit 2 tokens or the trimmed form still has ≥1 non-state word.
    base = chunks[0] if chunks else (no_street or q)
    tokens = base.split()
    if len(tokens) >= 3:
        # 1. Drop trailing state abbreviation (e.g. "... TX")
        if tokens[-1].upper() in _STATE_ABBR:
            tail_state = " ".join(tokens[:-1]).strip()
            if tail_state and tail_state not in variants:
                variants.append(tail_state)
            tokens = tokens[:-1]
        # 2. Drop trailing 1 token at a time down to 2 tokens (keeps POI name core)
        while len(tokens) > 2:
            tokens = tokens[:-1]
            form = " ".join(tokens).strip()
            if form and form not in variants:
                variants.append(form)
    return variants


def _parse_nominatim_item(it: dict) -> dict:
    addr = it.get("address", {}) or {}
    # City resolution — ONLY real municipalities. County/region go into county_region
    # so they never bleed into the "city" field (a notorious Nominatim gotcha
    # that previously put "Travis County" into the City input).
    city = (
        addr.get("city")
        or addr.get("town")
        or addr.get("village")
        or addr.get("hamlet")
        or addr.get("municipality")
        or addr.get("suburb")
        or addr.get("city_district")
        or addr.get("locality")
        or ""
    )
    country_code = (addr.get("country_code") or "").upper() or None
    # Heuristic: English-speaking in US/CA, Spanish in MX, French-speaking in QC.
    province_state = addr.get("state") or ""
    lang = "en"
    if country_code == "MX":
        lang = "es"
    elif country_code == "CA" and ("Québec" in province_state or "Quebec" in province_state):
        lang = "fr"
    return {
        "place_id": str(it.get("place_id", "")),
        "display_name": it.get("display_name", ""),
        "latitude": float(it.get("lat")) if it.get("lat") else None,
        "longitude": float(it.get("lon")) if it.get("lon") else None,
        "name": it.get("name") or (it.get("display_name", "").split(",")[0].strip() if it.get("display_name") else ""),
        "city": city,
        "state": province_state,
        "province_state": province_state,
        "county_region": addr.get("county") or "",
        "country": addr.get("country", ""),
        "country_name": addr.get("country", ""),
        "country_code": country_code,
        "postcode": addr.get("postcode", ""),
        "type": it.get("type") or it.get("class"),
        "confidence": float(it.get("importance", 0.0)),
        "language_hint": lang,
    }


async def _nominatim_search(q: str, limit: int, country: Optional[str], proximity: Optional[str]) -> list:
    """Provider adapter: Nominatim forward search. Returns parsed results or []."""
    params: dict = {
        "q": q,
        "format": "jsonv2",
        "addressdetails": 1,
        "limit": str(limit),
    }
    if country:
        params["countrycodes"] = country
    else:
        # Default to where the app has traction. Keeps "Pearl District" in TX
        # and not Peru. Comma-separated lower-case codes per Nominatim spec.
        params["countrycodes"] = "us,ca,mx"
    try:
        async with httpx.AsyncClient(timeout=8.0, headers=NOMINATIM_HEADERS) as client:
            r = await client.get(f"{NOMINATIM_BASE}/search", params=params)
            if r.status_code != 200:
                return []
            items = r.json() or []
        parsed = []
        for it in items:
            if not it:
                continue
            p = _parse_nominatim_item(it)
            p["source_provider"] = "nominatim"
            parsed.append(p)
        return parsed
    except Exception:
        return []


async def _nominatim_reverse(lat: float, lng: float) -> Optional[dict]:
    """Provider adapter: Nominatim reverse geocode."""
    params = {"lat": lat, "lon": lng, "format": "jsonv2", "addressdetails": 1, "zoom": 14}
    try:
        async with httpx.AsyncClient(timeout=8.0, headers=NOMINATIM_HEADERS) as client:
            r = await client.get(f"{NOMINATIM_BASE}/reverse", params=params)
            if r.status_code != 200:
                return None
            data = r.json() or {}
        if not data:
            return None
        p = _parse_nominatim_item(data)
        p["source_provider"] = "nominatim"
        return p
    except Exception:
        return None


async def _mapbox_reverse(lat: float, lng: float) -> Optional[dict]:
    """Provider adapter: Mapbox v6 reverse geocode."""
    if not MAPBOX_TOKEN:
        return None
    params = {
        "longitude": str(lng),
        "latitude": str(lat),
        "access_token": MAPBOX_TOKEN,
        "limit": "1",
        "language": "en",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(f"{MAPBOX_BASE}/reverse", params=params)
            if r.status_code != 200:
                return None
            data = r.json() or {}
        feats = data.get("features") or []
        if not feats:
            return None
        return _parse_mapbox_feature(feats[0])
    except Exception:
        return None


# =============================================================================
# Geocoding provider stack — adapters registered in priority order.
# To add Google or Apple later: write an async adapter with the same signature
# and slot it at the front of the list. No other code changes required.
# Forward adapter signature: (q: str, limit: int, country, proximity) -> list[dict]
# Reverse adapter signature: (lat: float, lng: float) -> Optional[dict]
# =============================================================================
GEOCODE_FORWARD_PROVIDERS: list = [
    # ("google", _google_search),   # future
    # ("apple", _apple_search),     # future
    ("mapbox", _mapbox_search),
    ("nominatim", _nominatim_search),
]

GEOCODE_REVERSE_PROVIDERS: list = [
    ("mapbox", _mapbox_reverse),
    ("nominatim", _nominatim_reverse),
]


@api.get("/geocode/search")
@graceful(
    fallback=lambda: {
        "query": "",
        "results": [],
        "error": "Location search is temporarily unavailable. Please try again or drop a pin manually.",
        "degraded": True,
    },
    label="/geocode/search",
    logger=logging.getLogger("geocode.search"),
)
async def geocode_search(
    q: str,
    limit: int = 8,
    country: Optional[str] = None,
    proximity: Optional[str] = None,
    debug: int = 0,
):
    """Enterprise multi-provider geocoding search.

    Pipeline:
      1. Cache lookup (24h TTL on (q, country, limit)).
      2. Generate a query-variant ladder (full → no-ZIP → no-street → title-only).
      3. Walk providers in priority order (Mapbox → Nominatim). For each
         provider, try every variant in sequence until one returns results.
      4. Cache the first successful (provider, variant) result set.
      5. On total failure, fall back to stale cache if available; else
         return empty `results` with a human-readable `error`.

    Never returns 5xx — frontend treats empty results as "no match".
    """
    q = (q or "").strip()
    if len(q) < 2:
        return {"query": q, "results": []}
    limit = max(1, min(15, limit))
    cache_key = f"search::{country or '*'}::{limit}::{q.lower()}"
    cached = await db.geocode_cache.find_one({"key": cache_key})
    if cached:
        ts = cached["created_at"]
        if ts.tzinfo is not None:
            ts = ts.replace(tzinfo=None)
        age_s = (utcnow().replace(tzinfo=None) - ts).total_seconds()
        if age_s < 86400 and cached.get("results"):
            out = {
                "query": q,
                "results": cached["results"],
                "cached": True,
                "provider": cached.get("provider"),
            }
            if debug:
                out["matched_query"] = cached.get("matched_query")
            return out

    variants = _progressive_query_variants(q) or [q]
    attempted: list = []
    # Extract meaningful query tokens (3+ chars) so we can score how well a
    # candidate name actually matches what the user typed. This is what
    # rescues "McAllister Park San Antonio" — variant 0 returns SA Missions
    # NHP, variant 2 returns McAllister Park. Both end up in the merged
    # pool and the ranker promotes the real match.
    import re as _re
    _STOP = {"the", "and", "city", "county", "saint", "north", "south",
             "east", "west", "new", "old", "street", "road", "ave", "avenue",
             "drive", "lane", "blvd", "boulevard", "district", "downtown"}
    # US state abbreviations — stopword them so they don't dominate scoring.
    _STATES = {"al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id",
               "il","in","ia","ks","ky","la","me","md","ma","mi","mn","ms",
               "mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok",
               "or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv",
               "wi","wy","usa","us","tex","texas","tejas"}
    raw_tokens = [t.lower() for t in _re.findall(r"[A-Za-z]{2,}", q)]
    query_tokens = {t for t in raw_tokens if t not in _STOP and t not in _STATES and len(t) >= 3}
    # Head-name = first 1-3 meaningful words of the query. This is almost
    # always the POI/landmark proper-noun. If the candidate's `name` field
    # includes the head-name, it's a strong exact-intent match.
    head_tokens = []
    for t in raw_tokens:
        if t in _STATES or t in {"the", "and"}:
            continue
        head_tokens.append(t)
        if len(head_tokens) >= 3:
            break
    head_name = " ".join(head_tokens).strip()

    def _name_score(r: dict, variant: str, variant_idx: int) -> float:
        """Score a candidate: head-name match + token overlap + confidence + type."""
        name_only = (r.get("name") or "").lower()
        display = (r.get("display_name") or "").lower()
        combined = f"{name_only} {display}"
        # Token overlap ratio (light signal).
        overlap = sum(1 for t in query_tokens if t in combined)
        token_ratio = (overlap / max(1, len(query_tokens))) if query_tokens else 0
        conf = float(r.get("confidence") or 0.5)
        ftype = (r.get("type") or "").lower()
        type_boost = {"poi": 0.10, "address": 0.08, "neighborhood": 0.06,
                      "locality": 0.05, "place": 0.04, "street": 0.02,
                      "district": 0.04}.get(ftype, 0.0)
        # HEAD-NAME BOOST: the strongest signal. If the POI/landmark name
        # (first ~2 words of query) appears IN the candidate's name field,
        # this is almost certainly what the user meant.
        head_boost = 0.0
        if head_name:
            if head_name in name_only:
                head_boost = 0.45  # exact head match in the short name
            elif head_name in display:
                head_boost = 0.15  # head appears only in long address
            else:
                # Partial head match: e.g. "mcallister park" → "mcallister" in name
                head_parts = head_name.split()
                if head_parts and head_parts[0] in name_only and len(head_parts[0]) >= 4:
                    head_boost = 0.25
        # Commercial-listing penalty: rental/condo/hotel POI listings often
        # contain the user's entire query in their name (e.g. "Luxury Condo
        # Downtown Austin, TX") and would otherwise hijack neighborhood
        # queries. We demote these so the neighborhood/landmark wins.
        listing_words = ("condo", "apartment", "apartments", "airbnb", "vrbo",
                         "rental", "rentals", "for sale", "for rent",
                         "suites", "luxury suite", "bed and breakfast",
                         "listing")
        listing_penalty = 0.0
        if any(w in name_only for w in listing_words):
            listing_penalty = 0.25
        # Earlier variant = fuller query context = slightly preferred when tied.
        variant_penalty = variant_idx * 0.02
        return head_boost + (token_ratio * 0.25) + (conf * 0.20) + type_boost - variant_penalty - listing_penalty

    for provider_name, provider_fn in GEOCODE_FORWARD_PROVIDERS:
        merged: dict = {}  # place_id -> best-scored result
        for idx, variant in enumerate(variants):
            try:
                results = await provider_fn(variant, limit, country, proximity)
            except Exception as ex:
                attempted.append({"provider": provider_name, "q": variant, "error": str(ex)[:80]})
                continue
            attempted.append({"provider": provider_name, "q": variant, "count": len(results)})
            for r in results:
                lat = r.get("latitude")
                lng = r.get("longitude")
                if lat is None or lng is None:
                    continue
                # Filter (0,0) and near-null island coords — never let the ocean leak.
                if abs(float(lat)) < 1e-4 and abs(float(lng)) < 1e-4:
                    continue
                key = r.get("place_id") or f"{round(float(lat), 5)},{round(float(lng), 5)}"
                r.setdefault("source_provider", provider_name)
                r["matched_query"] = variant
                r["matched_variant_index"] = idx
                r["_score"] = _name_score(r, variant, idx)
                # Keep the highest-scoring version of each dedup key.
                if key not in merged or r["_score"] > merged[key]["_score"]:
                    merged[key] = r

        if not merged:
            continue
        clean = sorted(merged.values(), key=lambda x: x["_score"], reverse=True)[:limit]
        for r in clean:
            r.pop("_score", None)
        await db.geocode_cache.update_one(
            {"key": cache_key},
            {"$set": {
                "key": cache_key,
                "results": clean,
                "provider": provider_name,
                "created_at": utcnow(),
            }},
            upsert=True,
        )
        out = {
            "query": q,
            "results": clean,
            "provider": provider_name,
            "matched_query": clean[0].get("matched_query"),
            "variant_index": clean[0].get("matched_variant_index"),
        }
        if debug:
            out["attempted"] = attempted
        return out

    # All providers + variants failed — serve stale cache if we have it.
    if cached and cached.get("results"):
        return {
            "query": q,
            "results": cached["results"],
            "cached": True,
            "stale": True,
            "provider": cached.get("provider"),
        }
    out = {
        "query": q,
        "results": [],
        "error": "No results found. Try a simpler query (e.g. place name + city).",
    }
    if debug:
        out["attempted"] = attempted
    return out


@api.get("/geocode/reverse")
async def geocode_reverse(lat: float, lng: float):
    """Reverse geocode via the provider stack (Mapbox → Nominatim)."""
    for provider_name, provider_fn in GEOCODE_REVERSE_PROVIDERS:
        try:
            result = await provider_fn(lat, lng)
        except Exception:
            continue
        if result:
            result.setdefault("source_provider", provider_name)
            return result
    return {"latitude": lat, "longitude": lng, "error": "No reverse result"}










# ============================================================================
# Collections
# ============================================================================








# ============================================================================
# Reviews & Check-ins
# ============================================================================




# ============================================================================
# Reports
# ============================================================================
# ============================================================================
# Reports — unified public report endpoint (Batch #6, May 2026).
#
# Consolidates the legacy `/reports` (target_type: spot|user|review) and the
# community `/report` (target_type: post|poll|comment|user) handlers into a
# single surface that accepts every target type used across the product,
# validates via pydantic (bad bodies -> 422, not 500), dedupes on
# (reporter, target, pending), and writes a uniform report doc.
#
# App Store UGC compliance (Guideline 1.2) requires a working in-app
# reporting path for user-generated content; this endpoint is that path.
#
# Backwards compatibility:
#   · Frontends currently call `POST /reports` (plural). Path preserved.
#   · `POST /report` (singular, community) is kept as a thin alias that
#     reuses the same handler — zero BE copy, zero behaviour change for
#     existing call-sites.
#   · Both `detail` and `details` body keys are accepted (first one was
#     used by the community schema, second by the spot/user/review schema).
# ============================================================================

_REPORT_TARGET_TYPES = {
    # legacy /reports
    "spot", "user", "review",
    # legacy /report (community)
    "post", "poll", "comment",
    # marketplace (new in Batch #6)
    "marketplace_item",
}


class ReportIn(BaseModel):
    target_type: str
    target_id: str
    reason: str
    # Accept BOTH field names — older clients use `details`, newer use `detail`.
    # Pydantic v1 style Field alias → either accepted; canonicalised below.
    details: Optional[str] = None
    detail: Optional[str] = None

    @field_validator("target_type")
    @classmethod
    def _validate_target_type(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in _REPORT_TARGET_TYPES:
            raise ValueError(
                f"target_type must be one of {sorted(_REPORT_TARGET_TYPES)}"
            )
        return v

    @field_validator("target_id")
    @classmethod
    def _validate_target_id(cls, v: str) -> str:
        v = (v or "").strip()
        if not v or len(v) > 128:
            raise ValueError("target_id must be a non-empty string (≤128 chars)")
        return v

    @field_validator("reason")
    @classmethod
    def _validate_reason(cls, v: str) -> str:
        v = (v or "").strip()
        if not v or len(v) > 40:
            raise ValueError("reason is required (≤40 chars)")
        return v


async def _create_report_unified(body: ReportIn, user: dict) -> Dict[str, Any]:
    """Shared implementation used by both `/reports` and `/report`."""
    check_rate_limit("report_create", user["user_id"])
    # Canonicalise the free-form description — prefer the newer `detail`
    # field if both were sent, cap length to the community handler's
    # original 1000-char limit.
    note = (body.detail or body.details or "").strip()[:1000]
    # Dedupe pending reports from the same reporter on the same target
    existing = await db.reports.find_one({
        "reporter_user_id": user["user_id"],
        "target_type": body.target_type,
        "target_id": body.target_id,
        "status": "pending",
    })
    if existing:
        # Update the note if the user is resubmitting with more context
        await db.reports.update_one(
            {"report_id": existing["report_id"]},
            {"$set": {
                "reason": body.reason,
                "detail": note,
                "details": note,
                "updated_at": utcnow(),
            }},
        )
        return {
            "ok": True,
            "report_id": existing["report_id"],
            "deduped": True,
            "target_type": body.target_type,
            "target_id": body.target_id,
            "status": "pending",
        }
    rid = f"rpt_{uuid.uuid4().hex[:12]}"
    doc = {
        "report_id": rid,
        "reporter_user_id": user["user_id"],
        "reporter_email": user.get("email"),
        "target_type": body.target_type,
        "target_id": body.target_id,
        "reason": body.reason,
        "detail": note,
        "details": note,  # mirror for legacy admin consumers
        "status": "pending",
        "created_at": utcnow(),
    }
    await db.reports.insert_one(doc)
    return {
        "ok": True,
        "report_id": rid,
        "deduped": False,
        "target_type": body.target_type,
        "target_id": body.target_id,
        "status": "pending",
    }


@api.post("/reports")
async def create_report(body: ReportIn, user: dict = Depends(get_current_user)):
    """Unified user-report endpoint. Accepts spot, user, review, post, poll,
    comment, and marketplace_item targets. Bad bodies → 422 via pydantic.
    Rate-limited per user. Deduped on (reporter, target, pending)."""
    return await _create_report_unified(body, user)


@api.get("/reports/reasons")
async def report_reasons():
    """Enumerate allowed report reasons with human labels for the mobile UI."""
    return [
        {"key": "not_a_location", "label": "Not a real location"},
        {"key": "unsafe", "label": "Unsafe or private property"},
        {"key": "inappropriate", "label": "Inappropriate content"},
        {"key": "spam", "label": "Spam or promotional"},
        {"key": "wrong_info", "label": "Incorrect information"},
        {"key": "harassment", "label": "Harassment or hate"},
        {"key": "stolen", "label": "Stolen / copied content"},
        {"key": "other", "label": "Something else"},
    ]


# ============================================================================
# Creator dashboard
# ============================================================================
@api.get("/me/billing")
async def me_billing(user: dict = Depends(get_current_user)):
    """Billing overview — usage, limits, invoices.
    Note: Stripe is NOT wired yet. This endpoint returns a live snapshot of
    usage + plan limits so the Billing screen can render honestly today.
    """
    plan = plan_of(user)
    limits = limits_for(user)
    # Live usage counts
    saves = await db.spot_saves.count_documents({"user_id": user["user_id"]})
    private_spots = await db.spots.count_documents({
        "owner_user_id": user["user_id"],
        "privacy_mode": {"$in": ["private", "followers", "invite_only"]},
    })
    collections = await db.collections.count_documents({"owner_user_id": user["user_id"]})
    return {
        "plan": plan,
        "plan_status": "active" if plan != "free" else "free",
        "renews_at": None,  # wired with Stripe
        "payment_method": None,  # wired with Stripe
        "invoices": [],
        "usage": {
            "saves": saves,
            "private_spots": private_spots,
            "collections": collections,
        },
        "limits": limits,
    }






# ============================================================================
# Admin — role system, audit trail, platform management
# ============================================================================
# Role hierarchy (higher level = more power). Used by require_role() to gate
# endpoints. Treat 'admin' on existing accounts as level 3 for BC.
ROLE_LEVELS = {
    "user": 0,
    # Founding Scout — honorary early-member role. Permission level 0
    # (same as user) because it grants zero moderation/admin powers;
    # its only functional effect is auto-comped Elite access (see
    # plan_of() below). We still keep it as a distinct role key so
    # `role == "founding_scout"` checks everywhere light up the
    # dedicated badge + free-Elite entitlement UI.
    "founding_scout": 0,
    "moderator": 1,
    "support": 1,        # read-heavy staff role
    "admin": 3,
    "super_admin": 4,
}

ADMIN_ROLES = ("moderator", "support", "admin", "super_admin")


def role_level(u: dict) -> int:
    return ROLE_LEVELS.get(u.get("role") or "user", 0)


def require_role(*allowed: str):
    """Dependency factory. allowed can be specific roles (e.g. 'admin') OR
    the lowest role string ('moderator') — if a single role is given we admit
    anyone with an equal or higher level. Always admits super_admin.
    """
    allowed_set = set(allowed)

    async def _dep(user: dict = Depends(get_current_user)):
        if user.get("role") == "super_admin":
            return user
        if user.get("role") in allowed_set:
            return user
        # Level-based admission when a single min role is given
        if len(allowed) == 1:
            min_lv = ROLE_LEVELS.get(allowed[0], 99)
            if role_level(user) >= min_lv:
                return user
        raise HTTPException(status_code=403, detail="Forbidden")

    return _dep


async def audit_log(
    admin_user: dict,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    notes: Optional[str] = None,
):
    """Write one audit entry for an admin action. Keep this dirt-simple and
    deterministic — the dashboard depends on consistent shape.
    """
    await db.audit_logs.insert_one({
        "audit_id": f"aud_{uuid.uuid4().hex[:12]}",
        "admin_user_id": admin_user.get("user_id"),
        "admin_email": admin_user.get("email"),
        "admin_role": admin_user.get("role"),
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "before": before,
        "after": after,
        "notes": notes,
        "created_at": utcnow(),
    })


SETTINGS_SINGLETON_ID = "platform_v1"

DEFAULT_SETTINGS = {
    "settings_id": SETTINGS_SINGLETON_ID,
    "app_name": "LumaScout",
    "support_email": "support@lumascout.app",
    "maintenance_mode": False,
    "public_registration": True,
    "auto_approve_verified": True,
    "require_moderation_spots": True,
    "require_moderation_photos": False,
    "duplicate_radius_m": 200,
    "default_privacy_mode": "public",
    "approximate_radius_km": 1.0,
    "updated_at": None,
    "updated_by": None,
}


async def get_platform_settings() -> dict:
    doc = await db.platform_settings.find_one({"settings_id": SETTINGS_SINGLETON_ID}, {"_id": 0})
    if not doc:
        doc = {**DEFAULT_SETTINGS}
        await db.platform_settings.insert_one(doc)
        doc.pop("_id", None)
    return doc


# --------------- Legacy simple admin endpoints (kept for compatibility) ------











# ============================================================================
# Super Admin Community Control Center
# Unified moderation layer for community posts / polls / comments.
# Actions available (tier-gated):
#   moderator : hide, restore, lock, unlock, pin, unpin, feature, unfeature,
#               mark_spam, clear_spam, soft_delete
#   admin     : all of the above + user warn / suspend
#   super_admin : all of the above + hard_delete + user ban
# ============================================================================

ALLOWED_MOD_ACTIONS = {
    "soft_delete", "hard_delete", "hide", "restore",
    "pin", "unpin", "feature", "unfeature",
    "lock", "unlock", "mark_spam", "clear_spam",
}
SUPER_ADMIN_ONLY_ACTIONS = {"hard_delete"}
CONTENT_COLLECTIONS = {
    "post": ("community_posts", "post_id"),
    "poll": ("community_polls", "poll_id"),
    "comment": ("community_comments", "comment_id"),
}


async def _apply_moderation(
    actor: dict,
    kind: str,
    target_id: str,
    action: str,
    reason: Optional[str] = None,
) -> dict:
    """Apply one moderation action + write an audit log. Returns the updated
    document (minus _id / cursor fields) or raises HTTPException on error."""
    if kind not in CONTENT_COLLECTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown target kind '{kind}'")
    if action not in ALLOWED_MOD_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action '{action}'")
    if action in SUPER_ADMIN_ONLY_ACTIONS and actor.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin only")

    coll_name, id_field = CONTENT_COLLECTIONS[kind]
    coll = getattr(db, coll_name)
    doc = await coll.find_one({id_field: target_id})
    if not doc:
        raise HTTPException(status_code=404, detail=f"{kind} not found")

    now = utcnow()
    before = {
        "status": doc.get("status", "active"),
        "hidden": bool(doc.get("hidden")),
        "pinned": bool(doc.get("pinned")),
        "featured": bool(doc.get("featured")),
        "locked": bool(doc.get("locked")),
        "spam": bool(doc.get("spam")),
    }
    patch: Dict[str, Any] = {"moderated_by": actor["user_id"], "moderated_at": now}
    unset: Dict[str, Any] = {}

    if action == "soft_delete":
        patch.update({
            "status": "removed", "removed_by": actor["user_id"], "removed_at": now,
            "removal_reason": reason or "admin removal",
        })
    elif action == "hard_delete":
        # super-admin only — physically removes the doc
        await coll.delete_one({id_field: target_id})
        await audit_log(
            actor, f"{kind}.hard_delete", kind, target_id,
            before=before, after={"status": "deleted"},
            notes=reason or "hard delete (super admin)",
        )
        # Also auto-resolve any reports referencing this target
        await db.reports.update_many(
            {"target_type": kind, "target_id": target_id, "status": "pending"},
            {"$set": {"status": "resolved", "resolved_by": actor["user_id"],
                      "resolved_at": now, "resolution_note": "hard-deleted"}},
        )
        return {"ok": True, "action": "hard_delete", "target_id": target_id}
    elif action == "hide":
        patch.update({"hidden": True, "hidden_by": actor["user_id"], "hidden_at": now})
    elif action == "restore":
        patch.update({"status": "active", "hidden": False,
                      "restored_by": actor["user_id"], "restored_at": now})
        unset.update({"removed_by": "", "removed_at": "", "removal_reason": "",
                      "hidden_by": "", "hidden_at": "", "spam": ""})
    elif action == "pin":
        patch.update({"pinned": True, "pinned_by": actor["user_id"], "pinned_at": now})
    elif action == "unpin":
        patch.update({"pinned": False})
        unset.update({"pinned_by": "", "pinned_at": ""})
    elif action == "feature":
        patch.update({"featured": True, "featured_by": actor["user_id"], "featured_at": now})
    elif action == "unfeature":
        patch.update({"featured": False})
        unset.update({"featured_by": "", "featured_at": ""})
    elif action == "lock":
        patch.update({"locked": True, "locked_by": actor["user_id"], "locked_at": now,
                      "lock_reason": reason})
    elif action == "unlock":
        patch.update({"locked": False})
        unset.update({"locked_by": "", "locked_at": "", "lock_reason": ""})
    elif action == "mark_spam":
        patch.update({"spam": True, "status": "removed",
                      "removed_by": actor["user_id"], "removed_at": now,
                      "removal_reason": reason or "spam"})
    elif action == "clear_spam":
        patch.update({"status": "active", "spam": False})
        unset.update({"removed_by": "", "removed_at": "", "removal_reason": ""})

    update_doc: Dict[str, Any] = {"$set": patch}
    if unset:
        update_doc["$unset"] = unset

    await coll.update_one({id_field: target_id}, update_doc)

    # If content was removed/hidden/marked-spam, auto-resolve pending reports.
    if action in ("soft_delete", "hide", "mark_spam"):
        await db.reports.update_many(
            {"target_type": kind, "target_id": target_id, "status": "pending"},
            {"$set": {"status": "resolved", "resolved_by": actor["user_id"],
                      "resolved_at": now, "resolution_note": f"{kind} {action}"}},
        )

    after = {**before, **{k: patch[k] for k in patch if k in before}}
    await audit_log(
        actor, f"{kind}.{action}", kind, target_id,
        before=before, after=after,
        notes=reason,
    )
    updated = await coll.find_one({id_field: target_id}, {"_id": 0})
    return {"ok": True, "action": action, "target": updated}


class ModerationActionIn(BaseModel):
    type: str              # post | poll | comment
    id: str
    action: str            # see ALLOWED_MOD_ACTIONS
    reason: Optional[str] = None












# ------ Public report endpoint — BACKCOMPAT ALIAS (Batch #6, May 2026) ------
# The canonical endpoint is now `POST /reports` (plural, unified). This
# singular path is preserved so older community clients don't break; it
# forwards into the same handler so behavior is identical.
class PublicReportIn(ReportIn):
    """Deprecated alias kept for type-export stability; identical to ReportIn."""
    pass


@api.post("/report")
async def create_report_singular_alias(
    body: ReportIn,
    user: dict = Depends(get_current_user),
):
    return await _create_report_unified(body, user)


# ------ User sanction endpoints --------------------------------------------












# ---------------------------------------------------------------------------
# Admin Explore Cover-Photo Editor
# Lets admins pick + crop the hero cover image used across Explore feed,
# spot detail pages, and map markers. Uses the hero_cover_image_url
# priority stack (see build_spot_detail_response) — admin_override wins.
# ---------------------------------------------------------------------------



















class ReportResolveIn(BaseModel):
    action: str  # dismissed | removed | warned




# =============================================================================
# Admin Dashboard — overview, users, audit, analytics, settings, notes
# =============================================================================







class AdminUserPatch(BaseModel):
    plan: Optional[str] = None  # free | pro | elite | comp_pro | comp_elite | trial_pro | trial_elite
    role: Optional[str] = None  # user | moderator | support | admin | super_admin
    status: Optional[str] = None  # active | suspended
    verification_status: Optional[str] = None  # verified | none
    suspension_reason: Optional[str] = None
    comp_expiration: Optional[str] = None  # ISO date string or None to clear
    reason: Optional[str] = None  # audit-log note


VALID_PLANS = {"free", "pro", "elite", "comp_pro", "comp_elite", "trial_pro", "trial_elite", "suspended"}
VALID_ROLES = {"user", "founding_scout", "moderator", "support", "admin", "super_admin"}
VALID_STATUSES = {"active", "suspended"}


















class PlatformSettingsPatch(BaseModel):
    app_name: Optional[str] = None
    support_email: Optional[str] = None
    maintenance_mode: Optional[bool] = None
    public_registration: Optional[bool] = None
    auto_approve_verified: Optional[bool] = None
    require_moderation_spots: Optional[bool] = None
    require_moderation_photos: Optional[bool] = None
    duplicate_radius_m: Optional[float] = None
    default_privacy_mode: Optional[str] = None
    approximate_radius_km: Optional[float] = None




# --------------- End admin dashboard block ----------------------------------


# ============================================================================
# Spot Packs (future creator monetization — Elite plan)
# ============================================================================
class SpotPackIn(BaseModel):
    name: str
    description: Optional[str] = ""
    cover_image_url: Optional[str] = None
    price_cents: int = 0  # 0 = free / preview
    spot_ids: List[str] = []
    published: bool = False


@api.post("/packs")
async def create_pack(body: SpotPackIn, user: dict = Depends(get_current_user)):
    if not limits_for(user)["sell_packs"]:
        raise_paywall("spot_packs", "Creating spot packs requires the Elite plan.", target_plan="elite")
    pid = f"pack_{uuid.uuid4().hex[:12]}"
    doc = {
        "pack_id": pid,
        "creator_user_id": user["user_id"],
        "name": body.name,
        "description": body.description,
        "cover_image_url": body.cover_image_url,
        "price_cents": body.price_cents,
        "currency": "USD",
        "spot_ids": body.spot_ids,
        "published": body.published,
        "sales_count": 0,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.spot_packs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/packs")
async def list_packs(published: Optional[bool] = True):
    q = {"published": True} if published else {}
    packs = await db.spot_packs.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
    return packs




@api.post("/packs/{pack_id}/purchase")
async def purchase_pack(pack_id: str, user: dict = Depends(get_current_user)):
    # Marketplace scaffolding — logs intent and returns a clear "coming soon" response.
    pack = await db.spot_packs.find_one({"pack_id": pack_id}, {"_id": 0})
    if not pack:
        raise HTTPException(status_code=404, detail="Pack not found")
    await db.pack_interest.insert_one({
        "interest_id": f"intent_{uuid.uuid4().hex[:12]}",
        "pack_id": pack_id,
        "user_id": user["user_id"],
        "status": "waitlist",
        "created_at": utcnow(),
    })
    return {
        "status": "waitlist",
        "message": "Marketplace launches with Stripe next release. You're on the waitlist for this pack — we'll notify you the moment checkout opens.",
        "pack_id": pack_id,
    }


@api.get("/packs/{pack_id}")
async def get_pack(pack_id: str, viewer: Optional[dict] = Depends(get_optional_user)):
    pack = await db.spot_packs.find_one({"pack_id": pack_id}, {"_id": 0})
    if not pack:
        raise HTTPException(status_code=404, detail="Not found")
    if not pack.get("published") and (not viewer or viewer["user_id"] != pack["creator_user_id"]):
        raise HTTPException(status_code=403, detail="Pack not published")
    creator = await db.users.find_one({"user_id": pack["creator_user_id"]}, {"_id": 0, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1})
    pack["creator"] = creator
    spots = await db.spots.find({"spot_id": {"$in": pack.get("spot_ids") or []}}, {"_id": 0}).to_list(500)
    pack["spot_count"] = len(spots)
    # Teaser preview only — full spot list locked until purchase when marketplace launches
    pack["preview_spots"] = [public_spot_view(s, viewer) for s in spots[:3] if public_spot_view(s, viewer)]
    return pack


# ============================================================================
# Health
# ============================================================================
@api.get("/")
async def root():
    return {"app": "LumaScout", "status": "ok"}


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Startup: indexes, admin seed, demo content
# ============================================================================
# =============================================================================
# Community — posts, comments, likes, direct messaging, discovery
# =============================================================================

POST_CATEGORIES = {
    "win", "question", "tip", "gear", "critique", "bts",
    "referral", "collab", "meetup", "intro", "poll",
}


class PollOptionIn(BaseModel):
    text: str


class SupportTicketIn(BaseModel):
    subject: str
    body: str
    category: Optional[str] = "general"  # general | bug | billing | abuse | feature


class SupportReplyIn(BaseModel):
    body: str


class GroupIn(BaseModel):
    name: str
    tagline: Optional[str] = ""
    description: Optional[str] = ""
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = "US"
    specialties: Optional[List[str]] = None
    cover_image_url: Optional[str] = None
    visibility: Optional[str] = "public"  # public | private


class CommunityPostIn(BaseModel):
    category: str
    title: str
    body: Optional[str] = ""
    image_url: Optional[str] = None  # single base64 data URL for MVP
    city: Optional[str] = None
    state: Optional[str] = None
    # Polls (optional; only used when category == 'poll')
    poll_options: Optional[List[str]] = None  # 2-6 option labels
    # Groups — if set, post is scoped to the group feed.
    group_id: Optional[str] = None
    # Optional spot this post references (shown as an inline card + kept in
    # sync with super-admin spot deletes which null this field out).
    spot_id: Optional[str] = None


async def _hydrate_posts(posts: List[dict], viewer: Optional[dict]) -> List[dict]:
    """Attach author (name, avatar, verification, plan) + viewer's liked flag.

    FIX(Commit 8c / 2026-04): also hydrate a minimal `spot_ref` preview
    ({spot_id, title, city, state, cover_image_url}) when the post
    references a spot. Without this, the community feed renders as
    walls of text — since few posts carry their own images, the spot
    cover becomes the richest media signal on most cards.
    """
    if not posts:
        return posts
    uids = list({p.get("author_user_id") for p in posts})
    users = await db.users.find(
        {"user_id": {"$in": uids}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1,
         "verification_status": 1, "plan": 1, "role": 1, "city": 1, "state": 1,
         "is_bot": 1, "is_official": 1, "avatar_kind": 1, "specialties": 1},
    ).to_list(200)
    umap = {u["user_id"]: u for u in users}
    liked_ids: set = set()
    if viewer:
        pids = [p["post_id"] for p in posts]
        liked = await db.post_likes.find(
            {"user_id": viewer["user_id"], "post_id": {"$in": pids}},
            {"_id": 0, "post_id": 1},
        ).to_list(500)
        liked_ids = {lk["post_id"] for lk in liked}
    # Poll vote lookup — per post, per viewer.
    poll_votes: Dict[str, int] = {}
    if viewer:
        poll_pids = [p["post_id"] for p in posts if p.get("poll")]
        if poll_pids:
            pv = await db.poll_votes.find(
                {"user_id": viewer["user_id"], "post_id": {"$in": poll_pids}},
                {"_id": 0, "post_id": 1, "option_index": 1},
            ).to_list(500)
            poll_votes = {v["post_id"]: v["option_index"] for v in pv}
    # Spot-ref hydration — minimal preview so the card can render the cover
    # as an inline attachment. Filters out test data + deleted spots.
    spot_ids = list({p["spot_id"] for p in posts if p.get("spot_id")})
    smap: Dict[str, dict] = {}
    if spot_ids:
        spot_rows = await db.spots.find(
            {"spot_id": {"$in": spot_ids},
             "is_test_data": {"$ne": True},
             "visibility_status": {"$ne": "deleted"}},
            {"_id": 0, "spot_id": 1, "title": 1, "city": 1, "state": 1,
             "images": 1, "privacy_mode": 1},
        ).to_list(len(spot_ids))
        for s in spot_rows:
            imgs = s.get("images") or []
            cover = None
            for img in imgs:
                if isinstance(img, dict) and img.get("is_cover") and img.get("image_url"):
                    cover = img["image_url"]
                    break
            if not cover and imgs and isinstance(imgs[0], dict):
                cover = imgs[0].get("image_url")
            smap[s["spot_id"]] = {
                "spot_id": s["spot_id"],
                "title": s.get("title"),
                "city": s.get("city"),
                "state": s.get("state"),
                "cover_image_url": cover,
                "privacy_mode": s.get("privacy_mode"),
            }
    for p in posts:
        p["author"] = umap.get(p.get("author_user_id"))
        p["liked_by_me"] = p["post_id"] in liked_ids
        if p.get("poll"):
            p["poll"]["my_vote_index"] = poll_votes.get(p["post_id"])
        sid = p.get("spot_id")
        if sid and sid in smap:
            p["spot_ref"] = smap[sid]

    # PRD #10: per-post typed reaction counts (win/tip) + viewer's own state.
    # Stored in a separate collection so we don't overload post_likes; makes
    # it easy to add more reaction types later without a schema migration.
    pids_all = [p["post_id"] for p in posts]
    reaction_counts: Dict[str, Dict[str, int]] = {pid: {"win": 0, "tip": 0} for pid in pids_all}
    try:
        # Aggregate counts across all posts in one round-trip.
        cur = db.post_reactions.aggregate([
            {"$match": {"post_id": {"$in": pids_all}, "reaction_type": {"$in": ["win", "tip"]}}},
            {"$group": {"_id": {"post_id": "$post_id", "type": "$reaction_type"}, "n": {"$sum": 1}}},
        ])
        async for row in cur:
            pid = row["_id"]["post_id"]
            t = row["_id"]["type"]
            if pid in reaction_counts and t in reaction_counts[pid]:
                reaction_counts[pid][t] = row["n"]
    except Exception:
        pass

    my_reactions: Dict[str, List[str]] = {pid: [] for pid in pids_all}
    if viewer and pids_all:
        try:
            rows = await db.post_reactions.find(
                {"user_id": viewer["user_id"], "post_id": {"$in": pids_all}},
                {"_id": 0, "post_id": 1, "reaction_type": 1},
            ).to_list(len(pids_all) * 3)
            for r in rows:
                my_reactions.setdefault(r["post_id"], []).append(r["reaction_type"])
        except Exception:
            pass

    for p in posts:
        p["reaction_counts"] = reaction_counts.get(p["post_id"], {"win": 0, "tip": 0})
        p["my_reactions"] = my_reactions.get(p["post_id"], [])
    return posts


@api.post("/posts")
async def create_post(body: CommunityPostIn, user: dict = Depends(get_current_user)):
    check_rate_limit("review_create", user["user_id"])  # reuse 30/day limiter
    if body.category not in POST_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category. Expected one of {sorted(POST_CATEGORIES)}")
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Title required")
    doc = {
        "post_id": f"pst_{uuid.uuid4().hex[:12]}",
        "author_user_id": user["user_id"],
        "category": body.category,
        "title": body.title.strip()[:140],
        "body": (body.body or "").strip()[:2000],
        "image_url": body.image_url,
        "city": body.city or user.get("city"),
        "state": body.state or user.get("state"),
        "like_count": 0,
        "comment_count": 0,
        "status": "active",
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    # Polls: attach options with zero-initial counts when category==poll.
    if body.category == "poll":
        raw_opts = [str(o).strip() for o in (body.poll_options or []) if str(o).strip()]
        if not (2 <= len(raw_opts) <= 6):
            raise HTTPException(status_code=400, detail="Poll needs 2-6 options")
        doc["poll"] = {
            "options": [{"index": i, "text": t[:120], "votes": 0} for i, t in enumerate(raw_opts)],
            "total_votes": 0,
        }
    # Group scoping (must be a member of the group)
    if body.group_id:
        g = await db.groups.find_one({"group_id": body.group_id})
        if not g:
            raise HTTPException(status_code=404, detail="Group not found")
        m = await db.group_members.find_one({"group_id": body.group_id, "user_id": user["user_id"]})
        if not m:
            raise HTTPException(status_code=403, detail="Join the group to post in it")
        doc["group_id"] = body.group_id
    # Optional spot reference — validate it exists, then persist. Super-admin
    # spot-delete will null this field out for cleanup.
    if body.spot_id:
        sp = await db.spots.find_one({"spot_id": body.spot_id}, {"_id": 0, "spot_id": 1})
        if not sp:
            raise HTTPException(status_code=404, detail="Spot not found")
        doc["spot_id"] = body.spot_id
    # ---- Auto-spam scoring (Apr 2026 Community Moderation Stage 2) ----
    # Compute heuristic signals on every new post. Posts scoring >= 70
    # auto-hide pending review; 40-69 auto-flag for the Reported queue.
    try:
        from utils.spam_signals import compute_spam_signals  # local import keeps server.py boot fast
        # Cheap context lookups
        ten_min_ago = utcnow() - timedelta(minutes=10)
        recent_count = await db.community_posts.count_documents({
            "author_user_id": user["user_id"],
            "created_at": {"$gte": ten_min_ago},
        })
        twentyfour_h_ago = utcnow() - timedelta(hours=24)
        dup_count = 0
        if doc["body"]:
            dup_count = await db.community_posts.count_documents({
                "author_user_id": user["user_id"],
                "body": doc["body"],
                "created_at": {"$gte": twentyfour_h_ago},
            })
        author_age_h: Optional[float] = None
        u_created = user.get("created_at")
        if u_created:
            try:
                author_age_h = max(0.0, (utcnow() - u_created).total_seconds() / 3600.0)
            except Exception:
                author_age_h = None
        spam = compute_spam_signals(
            doc["body"],
            author_recent_post_count=recent_count,
            duplicate_count_24h=dup_count,
            author_age_hours=author_age_h,
        )
        doc["spam_score"] = spam["score"]
        doc["spam_signals"] = spam["signals"]
        if spam["auto_hide"]:
            doc["status"] = "hidden"
            doc["auto_hidden_reason"] = "spam_score>=70"
        elif spam["auto_flag"]:
            doc["auto_flagged"] = True
    except Exception as _spam_err:  # never let spam scoring block writes
        logger.warning("spam scoring failed: %s", _spam_err)

    await db.community_posts.insert_one(doc)
    doc.pop("_id", None)
    out = await _hydrate_posts([doc], user)
    return out[0]


@api.get("/posts")
async def list_posts(
    category: Optional[str] = None,
    city: Optional[str] = None,
    author_user_id: Optional[str] = None,
    page: int = 1,
    limit: int = 25,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    limit = max(1, min(50, limit))
    page = max(1, page)
    q: dict = {"status": "active", "is_test_data": {"$ne": True}}
    if category and category != "all":
        q["category"] = category
    if city:
        q["city"] = {"$regex": f"^{city}$", "$options": "i"}
    if author_user_id:
        q["author_user_id"] = author_user_id
    total = await db.community_posts.count_documents(q)
    skip = (page - 1) * limit
    posts = await db.community_posts.find(q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    posts = await _hydrate_posts(posts, viewer)
    return {"total": total, "page": page, "limit": limit, "pages": (total + limit - 1) // limit, "items": posts}


@api.get("/posts/{post_id}")
async def get_post(post_id: str, viewer: Optional[dict] = Depends(get_optional_user)):
    p = await db.community_posts.find_one({"post_id": post_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    out = await _hydrate_posts([p], viewer)
    return out[0]


@api.delete("/posts/{post_id}")
async def delete_post(post_id: str, user: dict = Depends(get_current_user)):
    p = await db.community_posts.find_one({"post_id": post_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    is_admin = user.get("role") in ADMIN_ROLES
    if p["author_user_id"] != user["user_id"] and not is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.community_posts.update_one({"post_id": post_id}, {"$set": {"status": "removed"}})
    if is_admin and p["author_user_id"] != user["user_id"]:
        await audit_log(user, "post.remove", "post", post_id, notes=f"by admin; author={p['author_user_id']}")
    return {"ok": True}


@api.post("/posts/{post_id}/like")
async def like_post(post_id: str, user: dict = Depends(get_current_user)):
    p = await db.community_posts.find_one({"post_id": post_id})
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        await db.post_likes.insert_one({
            "post_id": post_id, "user_id": user["user_id"], "created_at": utcnow(),
        })
        await db.community_posts.update_one({"post_id": post_id}, {"$inc": {"like_count": 1}})
    except Exception:
        # Already liked (unique index) — no-op
        pass
    return {"ok": True}


@api.delete("/posts/{post_id}/like")
async def unlike_post(post_id: str, user: dict = Depends(get_current_user)):
    r = await db.post_likes.delete_one({"post_id": post_id, "user_id": user["user_id"]})
    if r.deleted_count:
        await db.community_posts.update_one({"post_id": post_id}, {"$inc": {"like_count": -1}})
    return {"ok": True}


class CommentIn(BaseModel):
    body: str


# --- PRD #10: Typed community-post reactions (Win / Tip) -----------------
# These are *in addition to* the existing Heart like, not a replacement.
# A single endpoint toggles a user's reaction of a given type. Stored in a
# separate collection (`post_reactions`) keyed by (user_id, post_id,
# reaction_type). Hydration lives in `_hydrate_posts`.
class ReactionIn(BaseModel):
    type: str  # 'win' | 'tip'


_ALLOWED_REACTION_TYPES = {"win", "tip"}


@api.post("/posts/{post_id}/react")
async def react_to_post(post_id: str, body: ReactionIn, user: dict = Depends(get_current_user)):
    rtype = (body.type or "").lower().strip()
    if rtype not in _ALLOWED_REACTION_TYPES:
        raise HTTPException(status_code=400, detail="Invalid reaction type")
    p = await db.community_posts.find_one({"post_id": post_id})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    key = {"post_id": post_id, "user_id": user["user_id"], "reaction_type": rtype}
    existing = await db.post_reactions.find_one(key)
    if existing:
        await db.post_reactions.delete_one(key)
        reacted = False
    else:
        await db.post_reactions.insert_one({**key, "created_at": utcnow()})
        reacted = True
        # Notify author (fire-and-forget, skip self).
        try:
            if p.get("author_user_id") and p["author_user_id"] != user["user_id"]:
                emoji = "🔥" if rtype == "win" else "💡"
                label = "Win" if rtype == "win" else "Tip"
                await _emit_notification(
                    p["author_user_id"],
                    f"post_react_{rtype}",
                    f"{emoji} {label} on your post",
                    f"{user.get('name') or 'Someone'} reacted to your post",
                    actor_user_id=user["user_id"],
                    deep_link=f"/community/post/{post_id}",
                )
        except Exception:
            pass
    count = await db.post_reactions.count_documents({"post_id": post_id, "reaction_type": rtype})
    return {"reacted": reacted, "type": rtype, "count": count}


@api.get("/posts/{post_id}/comments")
async def list_comments(post_id: str):
    comments = await db.post_comments.find({"post_id": post_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    if not comments:
        return []
    uids = list({c["author_user_id"] for c in comments})
    users = await db.users.find(
        {"user_id": {"$in": uids}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1, "plan": 1, "role": 1},
    ).to_list(200)
    umap = {u["user_id"]: u for u in users}
    for c in comments:
        c["author"] = umap.get(c["author_user_id"])
    return comments


@api.post("/posts/{post_id}/comments")
async def create_comment(post_id: str, body: CommentIn, user: dict = Depends(get_current_user)):
    check_rate_limit("review_create", user["user_id"])
    if not body.body.strip():
        raise HTTPException(status_code=400, detail="Comment body required")
    p = await db.community_posts.find_one({"post_id": post_id})
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    doc = {
        "comment_id": f"cmt_{uuid.uuid4().hex[:12]}",
        "post_id": post_id,
        "author_user_id": user["user_id"],
        "body": body.body.strip()[:1000],
        "created_at": utcnow(),
    }
    await db.post_comments.insert_one(doc)
    await db.community_posts.update_one({"post_id": post_id}, {"$inc": {"comment_count": 1}})
    doc.pop("_id", None)

    # ------------------------------------------------------------------
    # Notify post author of a reply + @mention parsing
    # ------------------------------------------------------------------
    body_text = doc["body"]
    actor_name = user.get("name") or "Someone"
    post_owner = p.get("author_id") or p.get("author_user_id")
    post_title = (p.get("title") or "your post")[:60]
    notified: set = set()

    # 1) Reply-on-post → post author (skip if self-reply)
    try:
        if post_owner and post_owner != user["user_id"]:
            await _emit_notification(
                post_owner,
                "comment_reply",
                "New reply on your post",
                f"{actor_name} replied to “{post_title}”",
                actor_user_id=user["user_id"],
                deep_link=f"/community/post/{post_id}",
                image_url=user.get("avatar_url"),
            )
            notified.add(post_owner)
    except Exception:
        pass

    # 2) @mentions — extract tokens like @handle, resolve via users.username,
    #    notify each unique mentioned user (skip actor, skip already-notified).
    try:
        import re as _re
        tokens = _re.findall(r"@([a-zA-Z0-9_]{2,24})", body_text)
        if tokens:
            uniq = {t.lower() for t in tokens}
            mentioned = await db.users.find(
                {"username": {"$in": list(uniq)}},
                {"_id": 0, "user_id": 1, "username": 1},
            ).to_list(20)
            for mu in mentioned:
                mid = mu.get("user_id")
                if not mid or mid == user["user_id"] or mid in notified:
                    continue
                await _emit_notification(
                    mid,
                    "comment_mention",
                    f"{actor_name} mentioned you",
                    f"@{mu.get('username')} — in a reply on “{post_title}”",
                    actor_user_id=user["user_id"],
                    deep_link=f"/community/post/{post_id}",
                    image_url=user.get("avatar_url"),
                )
                notified.add(mid)
    except Exception:
        pass

    return doc


# ----- Polls ---------------------------------------------------------------
class PollVoteIn(BaseModel):
    option_index: int


@api.post("/posts/{post_id}/vote")
async def cast_poll_vote(post_id: str, body: PollVoteIn, user: dict = Depends(get_current_user)):
    """Cast or change a poll vote. Idempotent per user per post."""
    p = await db.community_posts.find_one({"post_id": post_id})
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    poll = p.get("poll")
    if not poll:
        raise HTTPException(status_code=400, detail="This post is not a poll")
    opts = poll.get("options") or []
    idx = body.option_index
    if not (0 <= idx < len(opts)):
        raise HTTPException(status_code=400, detail="Invalid option index")
    # Remove previous vote from this user (if any) and decrement old bucket.
    prev = await db.poll_votes.find_one({"post_id": post_id, "user_id": user["user_id"]})
    if prev and prev.get("option_index") == idx:
        # No-op: same option — return current state.
        p.pop("_id", None)
        out = await _hydrate_posts([p], user)
        return {"poll": out[0].get("poll")}
    if prev:
        await db.community_posts.update_one(
            {"post_id": post_id},
            {"$inc": {f"poll.options.{prev['option_index']}.votes": -1, "poll.total_votes": -1}},
        )
        await db.poll_votes.delete_one({"_id": prev["_id"]})
    # Record new vote.
    await db.poll_votes.insert_one({
        "post_id": post_id,
        "user_id": user["user_id"],
        "option_index": idx,
        "created_at": utcnow(),
    })
    await db.community_posts.update_one(
        {"post_id": post_id},
        {"$inc": {f"poll.options.{idx}.votes": 1, "poll.total_votes": 1}},
    )
    fresh = await db.community_posts.find_one({"post_id": post_id}, {"_id": 0})
    out = await _hydrate_posts([fresh], user)
    return {"poll": out[0].get("poll")}


@api.delete("/posts/{post_id}/vote")
async def revoke_poll_vote(post_id: str, user: dict = Depends(get_current_user)):
    prev = await db.poll_votes.find_one({"post_id": post_id, "user_id": user["user_id"]})
    if not prev:
        return {"ok": True}
    await db.community_posts.update_one(
        {"post_id": post_id},
        {"$inc": {f"poll.options.{prev['option_index']}.votes": -1, "poll.total_votes": -1}},
    )
    await db.poll_votes.delete_one({"_id": prev["_id"]})
    return {"ok": True}


# ----- Mentorship matching ------------------------------------------------


@api.get("/mentees")
async def list_mentees(
    specialty: Optional[str] = None,
    city: Optional[str] = None,
    limit: int = 50,
    user: dict = Depends(get_current_user),
):
    """List photographers looking for a mentor. Mirror endpoint for /mentors."""
    q: Dict[str, Any] = {
        "looking_for_mentor": True,
        "user_id": {"$ne": user["user_id"]},
        "plan": {"$ne": "suspended"},
    }
    if specialty:
        q["specialties"] = specialty
    if city:
        q["city"] = city
    items = await db.users.find(
        q,
        {"_id": 0, "password_hash": 0},
    ).sort("created_at", -1).limit(min(limit, 100)).to_list(100)
    return {"count": len(items), "items": items}


# ----- Reviews received on your spots -------------------------------------


# ============================================================================
# SUPPORT HUB — User tickets + admin inbox
# ============================================================================
SUPPORT_FAQS = [
    {"id": "pricing", "q": "How does LumaScout pricing work?", "a": "Free gives you up to 5 saved spots, community access, and public maps. Pro ($9.99/mo) removes the save limit, unlocks unlimited collections, AI shot lists, and direct messaging. Elite ($19.99/mo) adds verified photographer badge, featured placement in discovery, and mentorship matchmaking priority."},
    {"id": "cancel", "q": "How do I cancel my subscription?", "a": "Open Profile → Plan card → Manage billing. Stripe's portal lets you cancel any time. You keep access until the end of your current billing period."},
    {"id": "refunds", "q": "Do you offer refunds?", "a": "If something feels off in your first 7 days after upgrading, message us via the Contact form and we'll sort it out."},
    {"id": "verify", "q": "How do I get verified?", "a": "Upload a portfolio of at least 10 high-quality images to your spots, keep your profile complete (bio, specialties, city), and our team reviews verification requests within 3–5 business days."},
    {"id": "report", "q": "Someone is posting spam or harassing me. What do I do?", "a": "Long-press any post or tap the ⋯ menu and choose Report. Our moderators triage within 24 hours. For urgent safety concerns, use the Contact form with category 'Abuse'."},
    {"id": "data", "q": "Can I export my data or delete my account?", "a": "Yes — message us via the Contact form with category 'General' and we'll respond within 72 hours with your export or deletion confirmation."},
]


# MIGRATED to routes/support.py — see REFACTOR_PLAN.md
# @api.get("/support/faqs")
async def support_faqs_LEGACY():
    return {"items": SUPPORT_FAQS}


# MIGRATED to routes/support.py — see REFACTOR_PLAN.md
# @api.post("/support/tickets")
async def create_support_ticket_LEGACY(body: SupportTicketIn, user: dict = Depends(get_current_user)):
    subj = (body.subject or "").strip()
    msg = (body.body or "").strip()
    if not subj or not msg:
        raise HTTPException(status_code=400, detail="Subject and message are required")
    cat = (body.category or "general").lower()
    if cat not in ("general", "bug", "billing", "abuse", "feature"):
        cat = "general"
    doc = {
        "ticket_id": f"sup_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "user_email": user.get("email"),
        "user_name": user.get("name") or user.get("username"),
        "subject": subj[:140],
        "body": msg[:4000],
        "category": cat,
        "status": "open",  # open | pending | resolved | closed
        "replies": [],
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.support_tickets.insert_one(doc)
    doc.pop("_id", None)
    return doc


# MIGRATED to routes/support.py — see REFACTOR_PLAN.md
# @api.get("/me/support/tickets")
async def my_support_tickets_LEGACY(user: dict = Depends(get_current_user)):
    items = await db.support_tickets.find(
        {"user_id": user["user_id"]},
        {"_id": 0},
    ).sort("created_at", -1).limit(100).to_list(100)
    return {"count": len(items), "items": items}


# MIGRATED to routes/support.py — see REFACTOR_PLAN.md
# @api.get("/admin/support/tickets")
async def admin_list_tickets_LEGACY(
    status: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 50,
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in ("admin", "super_admin", "support"):
        raise HTTPException(status_code=403, detail="Staff only")
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    if category:
        q["category"] = category
    items = await db.support_tickets.find(q, {"_id": 0}).sort("created_at", -1).limit(min(limit, 200)).to_list(200)
    counts = {
        "open": await db.support_tickets.count_documents({"status": "open"}),
        "pending": await db.support_tickets.count_documents({"status": "pending"}),
        "resolved": await db.support_tickets.count_documents({"status": "resolved"}),
        "closed": await db.support_tickets.count_documents({"status": "closed"}),
    }
    return {"items": items, "counts": counts}


# MIGRATED to routes/support.py — see REFACTOR_PLAN.md
# @api.post("/admin/support/tickets/{ticket_id}/reply")
async def admin_reply_ticket_LEGACY(ticket_id: str, body: SupportReplyIn, user: dict = Depends(get_current_user)):
    if user.get("role") not in ("admin", "super_admin", "support"):
        raise HTTPException(status_code=403, detail="Staff only")
    if not (body.body or "").strip():
        raise HTTPException(status_code=400, detail="Reply body required")
    reply = {
        "from": "staff",
        "staff_id": user["user_id"],
        "staff_name": user.get("name") or user.get("username"),
        "body": body.body.strip()[:4000],
        "created_at": utcnow(),
    }
    r = await db.support_tickets.update_one(
        {"ticket_id": ticket_id},
        {"$push": {"replies": reply}, "$set": {"status": "pending", "updated_at": utcnow()}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {"ok": True, "reply": reply}


# MIGRATED to routes/support.py — see REFACTOR_PLAN.md
# @api.post("/admin/support/tickets/{ticket_id}/resolve")
async def admin_resolve_ticket_LEGACY(ticket_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") not in ("admin", "super_admin", "support"):
        raise HTTPException(status_code=403, detail="Staff only")
    r = await db.support_tickets.update_one(
        {"ticket_id": ticket_id},
        {"$set": {"status": "resolved", "updated_at": utcnow()}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {"ok": True}


# ============================================================================
# LOCAL GROUPS / CHAPTERS
# ============================================================================
async def _hydrate_group(g: dict, viewer: Optional[dict] = None) -> dict:
    g = dict(g)
    g.pop("_id", None)
    g["member_count"] = await db.group_members.count_documents({"group_id": g["group_id"]})
    g["post_count"] = await db.community_posts.count_documents({"group_id": g["group_id"], "status": "active"})
    if viewer:
        m = await db.group_members.find_one({"group_id": g["group_id"], "user_id": viewer["user_id"]})
        g["is_member"] = bool(m)
        g["my_role"] = m.get("role") if m else None
    else:
        g["is_member"] = False
        g["my_role"] = None
    return g


@api.post("/groups")
async def create_group(body: GroupIn, user: dict = Depends(get_current_user)):
    name = (body.name or "").strip()
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="Group name must be at least 3 characters")
    # Prevent near-duplicate names in the same city
    dup_q = {"name": {"$regex": f"^{name}$", "$options": "i"}}
    if body.city:
        dup_q["city"] = body.city
    if await db.groups.find_one(dup_q):
        raise HTTPException(status_code=409, detail="A group with this name already exists in that city")
    gid = f"grp_{uuid.uuid4().hex[:12]}"
    doc = {
        "group_id": gid,
        "name": name[:80],
        "tagline": (body.tagline or "").strip()[:140],
        "description": (body.description or "").strip()[:2000],
        "city": body.city or user.get("city"),
        "state": body.state or user.get("state"),
        "country": body.country or user.get("primary_country") or "US",
        "specialties": body.specialties or [],
        "cover_image_url": body.cover_image_url,
        "visibility": body.visibility or "public",
        "owner_user_id": user["user_id"],
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.groups.insert_one(doc)
    # Owner is automatically an admin member.
    await db.group_members.insert_one({
        "group_id": gid,
        "user_id": user["user_id"],
        "role": "owner",
        "joined_at": utcnow(),
    })
    return await _hydrate_group(doc, user)


@api.get("/groups")
async def list_groups(
    q: Optional[str] = None,
    city: Optional[str] = None,
    specialty: Optional[str] = None,
    mine: bool = False,
    limit: int = 50,
    user: dict = Depends(get_current_user),
):
    query: Dict[str, Any] = {"visibility": "public"}
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"tagline": {"$regex": q, "$options": "i"}},
        ]
    if city:
        query["city"] = city
    if specialty:
        query["specialties"] = specialty
    if mine:
        my_ids = [m["group_id"] async for m in db.group_members.find({"user_id": user["user_id"]}, {"group_id": 1, "_id": 0})]
        query = {"group_id": {"$in": my_ids}}  # my groups override other filters
    groups = await db.groups.find(query).sort("created_at", -1).limit(min(limit, 100)).to_list(100)
    items = [await _hydrate_group(g, user) for g in groups]
    return {"count": len(items), "items": items}


@api.get("/groups/{group_id}")
async def get_group(group_id: str, user: dict = Depends(get_current_user)):
    g = await db.groups.find_one({"group_id": group_id})
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    return await _hydrate_group(g, user)


@api.post("/groups/{group_id}/join")
async def join_group(group_id: str, user: dict = Depends(get_current_user)):
    g = await db.groups.find_one({"group_id": group_id})
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    await db.group_members.update_one(
        {"group_id": group_id, "user_id": user["user_id"]},
        {"$setOnInsert": {
            "group_id": group_id,
            "user_id": user["user_id"],
            "role": "member",
            "joined_at": utcnow(),
        }},
        upsert=True,
    )
    return await _hydrate_group(g, user)


@api.delete("/groups/{group_id}/join")
async def leave_group(group_id: str, user: dict = Depends(get_current_user)):
    g = await db.groups.find_one({"group_id": group_id})
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    if g.get("owner_user_id") == user["user_id"]:
        raise HTTPException(status_code=400, detail="Owner cannot leave — transfer ownership first")
    await db.group_members.delete_one({"group_id": group_id, "user_id": user["user_id"]})
    return await _hydrate_group(g, user)


@api.get("/groups/{group_id}/members")
async def list_group_members(group_id: str, user: dict = Depends(get_current_user)):
    members = await db.group_members.find({"group_id": group_id}, {"_id": 0}).sort("joined_at", 1).to_list(500)
    uids = [m["user_id"] for m in members]
    users = await db.users.find(
        {"user_id": {"$in": uids}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "city": 1, "verification_status": 1, "plan": 1, "role": 1, "specialties": 1},
    ).to_list(500)
    umap = {u["user_id"]: u for u in users}
    for m in members:
        m["profile"] = umap.get(m["user_id"])
    return {"count": len(members), "items": members}


@api.get("/groups/{group_id}/posts")
async def list_group_posts(group_id: str, limit: int = 30, user: dict = Depends(get_current_user)):
    g = await db.groups.find_one({"group_id": group_id})
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    posts = await db.community_posts.find(
        {"group_id": group_id, "status": "active"},
        {"_id": 0},
    ).sort("created_at", -1).limit(min(limit, 100)).to_list(100)
    items = await _hydrate_posts(posts, user)
    return {"count": len(items), "items": items}


# ----- Discovery -------------------------------------------------------------
@api.get("/photographers/nearby")
async def photographers_nearby(
    city: Optional[str] = None,
    specialty: Optional[str] = None,
    limit: int = 20,
    viewer: dict = Depends(get_current_user),
):
    """List photographers in a city (defaults to viewer's city)."""
    limit = max(1, min(50, limit))
    target_city = (city or viewer.get("city") or "").strip()
    q: dict = {"user_id": {"$ne": viewer["user_id"]}, "status": {"$ne": "suspended"}, "is_test_account": {"$ne": True}, "deleted": {"$ne": True}}
    if target_city:
        q["city"] = {"$regex": f"^{target_city}$", "$options": "i"}
    if specialty:
        q["specialties"] = {"$in": [specialty]}
    users = await db.users.find(
        q,
        {"_id": 0, "password_hash": 0},
    ).limit(limit).to_list(limit)
    return {"city": target_city, "count": len(users), "items": users}


# ----- Direct Messaging ------------------------------------------------------












@api.get("/community/onboarding-status")
async def community_onboarding_status(user: dict = Depends(get_current_user)):
    return {"community_onboarded": bool(user.get("community_onboarded"))}


# --------------- End community block -----------------------------------------


# =============================================================================
# Phase D — Astronomy (golden hour), Push notifications, AI shot list, GPS feed
# =============================================================================

def _compute_astronomy(lat: float, lng: float, date: Optional[datetime] = None) -> dict:
    """Return sunrise, sunset, and golden-hour windows for a lat/lng on a date.
    Pure-math port of common SunCalc formulas — no network required.
    Times are returned as ISO-8601 UTC strings so the client renders them in
    the device's local timezone.
    """
    d = date or datetime.now(timezone.utc)
    # Round to the noon of the date so the math is symmetric and stable.
    d = datetime(d.year, d.month, d.day, 12, 0, 0, tzinfo=timezone.utc)
    # Julian date
    jd = d.timestamp() / 86400.0 + 2440587.5
    n = jd - 2451545.0 + 0.0008
    J_star = n - (lng / 360.0)
    M = math.radians((357.5291 + 0.98560028 * J_star) % 360)
    C = 1.9148 * math.sin(M) + 0.0200 * math.sin(2 * M) + 0.0003 * math.sin(3 * M)
    lam = math.radians((math.degrees(M) + C + 180.0 + 102.9372) % 360)
    J_transit = 2451545.0 + J_star + 0.0053 * math.sin(M) - 0.0069 * math.sin(2 * lam)
    sin_dec = math.sin(lam) * math.sin(math.radians(23.44))
    dec = math.asin(sin_dec)
    lat_r = math.radians(lat)

    def _event(altitude_deg: float) -> Optional[datetime]:
        try:
            cos_h = (
                math.sin(math.radians(altitude_deg)) - math.sin(lat_r) * math.sin(dec)
            ) / (math.cos(lat_r) * math.cos(dec))
            if cos_h < -1 or cos_h > 1:
                return None
            H = math.degrees(math.acos(cos_h))
            J_event = J_transit + (H / 360.0)
            ts = (J_event - 2440587.5) * 86400.0
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except Exception:
            return None

    def _event_rise(altitude_deg: float) -> Optional[datetime]:
        try:
            cos_h = (
                math.sin(math.radians(altitude_deg)) - math.sin(lat_r) * math.sin(dec)
            ) / (math.cos(lat_r) * math.cos(dec))
            if cos_h < -1 or cos_h > 1:
                return None
            H = math.degrees(math.acos(cos_h))
            J_event = J_transit - (H / 360.0)
            ts = (J_event - 2440587.5) * 86400.0
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except Exception:
            return None

    # Altitudes (degrees): official sunrise/sunset at -0.833°,
    # golden hour typically 6° above → -4° below horizon.
    sunrise = _event_rise(-0.833)
    sunset = _event(-0.833)
    golden_morning_end = _event_rise(6)       # end of morning golden hour
    golden_evening_start = _event(6)          # start of evening golden hour
    blue_hour_evening = _event(-4)            # end of evening blue-ish light

    def _iso(x: Optional[datetime]) -> Optional[str]:
        return x.isoformat() if x else None

    return {
        "date": d.date().isoformat(),
        "sunrise": _iso(sunrise),
        "sunset": _iso(sunset),
        "morning_golden_hour": {
            "start": _iso(sunrise),
            "end": _iso(golden_morning_end),
        },
        "evening_golden_hour": {
            "start": _iso(golden_evening_start),
            "end": _iso(sunset),
        },
        "blue_hour_evening_end": _iso(blue_hour_evening),
    }


@api.get("/astronomy")
async def astronomy(lat: float, lng: float, date: Optional[str] = None):
    """Light public endpoint — any client (even unauthenticated) can query
    golden-hour times for an arbitrary lat/lng."""
    d: Optional[datetime] = None
    if date:
        try:
            d = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(status_code=400, detail="date must be ISO YYYY-MM-DD")
    return _compute_astronomy(lat, lng, d)




# ----------------------------------------------------------------------------
# Push notifications — Expo push tokens + sender helper
# ----------------------------------------------------------------------------







async def send_push(user_ids: List[str], title: str, body: str, data: Optional[dict] = None):
    """Fire-and-forget push delivery. Never raises.

    Dual transport:
      • Expo tokens (`ExponentPushToken[...]`) → exp.host/--/api/v2/push/send
      • Raw APNs device tokens (hex, iOS)    → api.push.apple.com direct dispatch
        when services.apns is configured via env vars.

    We pull the device rows once and split by token_type (stored on the
    push_tokens document; rows without it default to "expo" for backward
    compatibility with the pre-APNs schema).
    """
    if not user_ids:
        return
    try:
        import httpx
        from services.apns import apns_configured, send_apns_many

        rows = await db.push_tokens.find(
            {"user_id": {"$in": list(set(user_ids))}},
            {"_id": 0, "token": 1, "token_type": 1, "platform": 1},
        ).to_list(500)
        if not rows:
            return

        expo_tokens: List[str] = []
        apns_tokens: List[str] = []
        for r in rows:
            token = r.get("token") or ""
            if not token:
                continue
            ttype = (r.get("token_type") or "").lower()
            # Auto-detect when older rows don't carry token_type.
            if not ttype:
                ttype = "expo" if token.startswith("ExponentPushToken") else (
                    "apns" if all(c in "0123456789abcdefABCDEF" for c in token) and len(token) >= 32 else "expo"
                )
            if ttype == "apns":
                apns_tokens.append(token)
            else:
                expo_tokens.append(token)

        # ─── Expo batch ───────────────────────────────────────────
        if expo_tokens:
            messages = [
                {
                    "to": t,
                    "sound": "default",
                    "title": title[:120],
                    "body": body[:240],
                    "data": data or {},
                    "priority": "high",
                }
                for t in expo_tokens
            ]
            async with httpx.AsyncClient(timeout=8.0) as client_h:
                # Expo accepts up to 100 messages per call.
                for i in range(0, len(messages), 100):
                    await client_h.post(
                        "https://exp.host/--/api/v2/push/send",
                        json=messages[i:i + 100],
                        headers={"Accept": "application/json", "Content-Type": "application/json"},
                    )

        # ─── APNs direct dispatch (optional) ──────────────────────
        if apns_tokens and apns_configured():
            summary = await send_apns_many(
                apns_tokens,
                title=title, body=body,
                data=data,
            )
            # Clean up tokens Apple told us are dead (uninstalled / migrated).
            dead = summary.get("invalid_tokens") or []
            if dead:
                try:
                    await db.push_tokens.delete_many({"token": {"$in": dead}})
                    logger.info("apns pruned %d dead tokens", len(dead))
                except Exception:
                    pass
    except Exception as e:
        # Push delivery is best-effort — never block the caller.
        logger.warning("Push delivery failed: %s", e)



# ============================================================================
# SCOUT AI — Official LumaScout in-app assistant (Phase 1: stateless chat)
# ============================================================================
# Spec highlights honoured here:
#   • Official AI product assistant — never impersonates a real photographer.
#   • Useful first, trustworthy always. Confidence levels in replies.
#   • Only uses live LumaScout data (current user plan, nearby/saved spots,
#     optional pinned spot) for context — no hallucinated permits/access.
#   • Stateless per user's Phase-1 decision (no server-side chat history).

SCOUT_AI_SYSTEM_PROMPT = (
    "You are Scout AI, the official AI assistant inside LumaScout, a photographer-"
    "focused location discovery, planning, and community app.\n\n"
    "Your job is to help users discover, save, plan, and share great photo locations, "
    "understand the app, and make better use of LumaScout's tools.\n\n"
    "You are NOT a real photographer profile. You are an official AI product assistant. "
    "Never imply you are human or that you personally visited a place.\n\n"
    "Core rules:\n"
    "- Be useful, concise, and trustworthy.\n"
    "- Use only available app data, user context, and clearly supported metadata.\n"
    "- Do not invent spot details, permit rules, safety claims, or personal experience.\n"
    "- Distinguish clearly between known information and suggestions.\n"
    "- Optimise for real field usefulness: light, access, parking, crowd, background "
    "variety, distance, and fit for shoot type.\n"
    "- Recommend premium features (Pro / Elite) only when directly relevant to the "
    "user's intent. Never spam upsells.\n"
    "- Encourage verification when conditions may change (weather, bloom, crowds).\n"
    "- Help users choose, compare, upload, and understand locations.\n"
    "- If data is missing, say so clearly and provide the next best action.\n\n"
    "Style:\n"
    "- Lead with the recommendation or answer.\n"
    "- Follow with 2-4 practical reasons.\n"
    "- Mention uncertainty when needed.\n"
    "- Keep the tone premium and creator-focused. Short paragraphs, no emoji spam.\n"
    "- Under 180 words unless the user clearly wants depth."
)


async def _build_scout_ai_context(
    user: dict,
    spot_id: Optional[str],
    placement: Optional[str],
) -> str:
    """Compile a compact, factual block the model can ground its reply in.

    Only real data from the database — no invented fields. Surfaces the
    viewer's plan, a few saved-spot titles, and the pinned spot's public
    metadata if one was provided.
    """
    lines: List[str] = []
    plan = user.get("plan") or "free"
    lines.append(
        f"VIEWER: name={user.get('name') or 'user'} "
        f"plan={plan} "
        f"city={user.get('city') or '?'} "
        f"state={user.get('state') or '?'}"
    )
    specs = user.get("specialties") or []
    if specs:
        lines.append("VIEWER_SPECIALTIES: " + ", ".join(specs[:4]))

    # PRD Phase 2 — Scout AI onboarding preferences (set via /api/ai/preferences).
    prefs = user.get("scout_prefs") or {}
    if prefs:
        shoots = prefs.get("shoots") or []
        pris = prefs.get("priorities") or []
        dist = prefs.get("max_distance")
        ptime = prefs.get("preferred_time")
        if shoots or pris or dist or ptime:
            lines.append("VIEWER_PREFERENCES:")
            if shoots:
                lines.append("  shoots: " + ", ".join(shoots[:6]))
            if pris:
                lines.append("  priorities: " + ", ".join(pris[:3]))
            if dist:
                lines.append(f"  max_distance_miles: {dist}")
            if ptime:
                lines.append(f"  preferred_time: {ptime}")

    if placement:
        lines.append(f"PLACEMENT: {placement}  (surface where the user opened Scout AI)")

    # Up to 5 recently-saved spot titles for "choose between saved" prompts.
    try:
        saved_ids = user.get("saved_spot_ids") or []
        if saved_ids:
            saved = await db.spots.find(
                {"spot_id": {"$in": saved_ids[:20]}},
                {"_id": 0, "spot_id": 1, "title": 1, "city": 1, "state": 1,
                 "shoot_types": 1, "best_time_of_day": 1, "shoot_score": 1},
            ).limit(5).to_list(5)
            if saved:
                lines.append("VIEWER_SAVED_SPOTS:")
                for s in saved:
                    lines.append(
                        f"  - {s.get('title')} ({s.get('city')}, {s.get('state')}) "
                        f"score={s.get('shoot_score')} "
                        f"best={s.get('best_time_of_day')} "
                        f"shoots={','.join((s.get('shoot_types') or [])[:3])}"
                    )
    except Exception as e:
        logger.debug("Scout AI saved-spot context failed: %s", e)

    # Pinned spot (if the user opened Scout AI from the Spot detail page).
    if spot_id:
        try:
            s = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
            if s:
                v = public_spot_view(s, user) or {}
                lines.append(
                    "CURRENT_SPOT:\n"
                    f"  title={v.get('title')}\n"
                    f"  city={v.get('city')}, {v.get('state')}\n"
                    f"  shoot_types={','.join(v.get('shoot_types') or [])}\n"
                    f"  style_tags={','.join(v.get('style_tags') or [])}\n"
                    f"  best_time_of_day={v.get('best_time_of_day')}\n"
                    f"  shoot_score={v.get('shoot_score')}\n"
                    f"  parking_rating={v.get('parking_rating')}\n"
                    f"  walk_rating={v.get('walk_rating')}\n"
                    f"  crowd_level={v.get('crowd_level')}\n"
                    f"  privacy_mode={v.get('privacy_mode')}"
                )
        except Exception as e:
            logger.debug("Scout AI current-spot context failed: %s", e)

    return "\n".join(lines) if lines else "(no additional context available)"


class ScoutAIMessageIn(BaseModel):
    role: str
    content: str


class ScoutAIChatIn(BaseModel):
    messages: List[ScoutAIMessageIn]
    spot_id: Optional[str] = None
    placement: Optional[str] = None


class ScoutAIPreferencesIn(BaseModel):
    """PRD Phase 2: persist user's Scout AI onboarding preferences so every
    chat reply can be grounded in their shoot style + priorities + drive radius."""
    shoots: List[str] = []
    priorities: List[str] = []
    max_distance: Optional[str] = None
    preferred_time: Optional[str] = None


# MIGRATED to routes/scout_ai.py — kept here temporarily as dead code during the
# incremental refactor (see /app/backend/REFACTOR_PLAN.md). Safe to delete once
# the refactor is verified stable in production.
# @api.get("/ai/preferences")
async def scout_ai_get_preferences_LEGACY(user: dict = Depends(get_current_user)):
    prefs = user.get("scout_prefs") or {}
    return {
        "shoots": prefs.get("shoots") or [],
        "priorities": prefs.get("priorities") or [],
        "max_distance": prefs.get("max_distance"),
        "preferred_time": prefs.get("preferred_time"),
        "completed_at": prefs.get("completed_at"),
    }


# MIGRATED to routes/scout_ai.py — see REFACTOR_PLAN.md
# @api.post("/ai/preferences")
async def scout_ai_set_preferences_LEGACY(body: ScoutAIPreferencesIn, user: dict = Depends(get_current_user)):
    payload = {
        "shoots": (body.shoots or [])[:8],
        "priorities": (body.priorities or [])[:3],
        "max_distance": body.max_distance,
        "preferred_time": body.preferred_time,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"scout_prefs": payload}},
    )
    return {"ok": True, **payload}




def _scout_ai_follow_ups(placement: Optional[str]) -> List[str]:
    """Deterministic follow-up chips (no extra model round-trip)."""
    p = (placement or "").lower()
    if p == "upload":
        return [
            "Help me write this description",
            "Should this be public or private?",
            "What notes should I include?",
        ]
    if p == "saved":
        return [
            "Which saved spot fits tonight's golden hour?",
            "Compare my saved portrait spots",
            "Best saved spot for a branding shoot",
        ]
    if p == "spot_detail":
        return [
            "Does this fit a family session?",
            "Compare this with similar spots nearby",
            "Best light here",
        ]
    if p == "explore":
        return [
            "Hidden gems nearby",
            "Dog-friendly sunset spots",
            "Places good for branding sessions",
        ]
    return [
        "Where should I shoot this weekend?",
        "Best sunset portrait spots near me",
        "Explain my Shoot Score",
    ]


# MIGRATED to routes/scout_ai.py — see REFACTOR_PLAN.md
# @api.post("/ai/chat")
async def scout_ai_chat_LEGACY(body: ScoutAIChatIn, user: dict = Depends(get_current_user)):
    check_rate_limit("scout_ai_chat", user["user_id"])

    if not body.messages:
        raise HTTPException(status_code=400, detail="No messages supplied.")
    last_user = None
    for m in reversed(body.messages):
        if m.role == "user" and (m.content or "").strip():
            last_user = m.content.strip()
            break
    if not last_user:
        raise HTTPException(status_code=400, detail="Empty user message.")

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        raise HTTPException(status_code=500, detail="AI service is not available.")

    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="AI service is not configured.")

    context_block = await _build_scout_ai_context(user, body.spot_id, body.placement)
    sys_msg = (
        f"{SCOUT_AI_SYSTEM_PROMPT}\n\n"
        "=== LIVE APP CONTEXT (this session only - do not quote verbatim) ===\n"
        f"{context_block}\n"
        "=== END CONTEXT ==="
    )

    session_id = f"scout:{user['user_id']}:{uuid.uuid4().hex[:8]}"
    chat = LlmChat(
        api_key=key,
        session_id=session_id,
        system_message=sys_msg,
    ).with_model("openai", "gpt-5.2")

    try:
        reply = await chat.send_message(UserMessage(text=last_user))
    except Exception as e:
        logger.warning("Scout AI chat failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Scout AI is briefly unavailable. Please try again in a moment.",
        )

    return {
        "reply": (reply or "").strip(),
        "follow_ups": _scout_ai_follow_ups(body.placement),
        "model": "gpt-5.2",
        "disclosure": "Scout AI is an official LumaScout AI assistant. Replies are AI-generated.",
    }


# ============================================================================
# SCOUT AI — Phase 3 (community enhancement): admin toggles + editorial posts +
# unanswered-Q&A auto-replies. All actions are admin-triggered for MVP; a future
# scheduler can run _scout_ai_generate_editorial on a cron when the admin
# enables `editorial_posts_enabled`.
# ============================================================================

SCOUT_AI_USER_ID = "user_scoutai"


async def _get_scout_settings() -> dict:
    s = await db.app_settings.find_one({"_id": "scout_ai_settings"}) or {}
    return {
        "enabled": bool(s.get("enabled", True)),
        "community_replies_enabled": bool(s.get("community_replies_enabled", False)),
        "editorial_posts_enabled": bool(s.get("editorial_posts_enabled", False)),
        "max_posts_per_day": int(s.get("max_posts_per_day", 4)),
        "unanswered_reply_delay_hours": int(s.get("unanswered_reply_delay_hours", 24)),
        "updated_at": s.get("updated_at"),
    }


async def _scout_posts_today() -> int:
    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    return await db.community_posts.count_documents({
        "author_user_id": SCOUT_AI_USER_ID,
        "created_at": {"$gte": start},
    })


class ScoutSettingsIn(BaseModel):
    enabled: Optional[bool] = None
    community_replies_enabled: Optional[bool] = None
    editorial_posts_enabled: Optional[bool] = None
    max_posts_per_day: Optional[int] = None
    unanswered_reply_delay_hours: Optional[int] = None


# MIGRATED to routes/scout_ai.py — see REFACTOR_PLAN.md
# @api.get("/admin/ai/settings")
async def admin_ai_settings_get_LEGACY(user: dict = Depends(require_role("moderator"))):
    s = await _get_scout_settings()
    s["posts_today"] = await _scout_posts_today()
    return s


# MIGRATED to routes/scout_ai.py — see REFACTOR_PLAN.md
# @api.post("/admin/ai/settings")
async def admin_ai_settings_set_LEGACY(body: ScoutSettingsIn, user: dict = Depends(require_role("super_admin"))):
    patch = {}
    for k in ("enabled", "community_replies_enabled", "editorial_posts_enabled"):
        v = getattr(body, k)
        if v is not None:
            patch[k] = bool(v)
    if body.max_posts_per_day is not None:
        patch["max_posts_per_day"] = max(0, min(20, int(body.max_posts_per_day)))
    if body.unanswered_reply_delay_hours is not None:
        patch["unanswered_reply_delay_hours"] = max(1, min(168, int(body.unanswered_reply_delay_hours)))
    patch["updated_at"] = utcnow()
    await db.app_settings.update_one({"_id": "scout_ai_settings"}, {"$set": patch}, upsert=True)
    await audit_log(user, "scout_ai.settings_update", "scout_ai", after=patch)
    return await _get_scout_settings()


EDITORIAL_TEMPLATES = [
    ("Strong sunset picks near you",
     "A short Scout AI shortlist of recently verified LumaScout spots with strong evening light, ordered by distance and crowd-friendliness."),
    ("Worth scouting this weekend",
     "A Scout AI pick list of spots that match common weekend shoot styles, filtered to ones with recent verification and clear field notes."),
    ("Best for family sessions",
     "A Scout AI shortlist of family-friendly LumaScout spots, prioritising easier access, lower friction, and flexible backgrounds."),
    ("Golden hour favourites",
     "A Scout AI pick list of spots with stronger late-day light and more predictable portrait conditions."),
    ("Recently verified nearby",
     "A Scout AI-curated list of freshly confirmed LumaScout spots that look more trustworthy right now."),
]


async def _scout_llm_compose(system_prompt: str, user_prompt: str, context: str = "") -> str:
    """Shared helper to call GPT-5.2 with Scout AI guardrails."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        raise HTTPException(status_code=500, detail="AI service is not available.")
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="AI service is not configured.")
    full_sys = system_prompt
    if context:
        full_sys = f"{system_prompt}\n\n=== CONTEXT ===\n{context}\n=== END CONTEXT ==="
    session_id = f"scout_bot:{uuid.uuid4().hex[:8]}"
    chat = LlmChat(api_key=key, session_id=session_id, system_message=full_sys).with_model("openai", "gpt-5.2")
    try:
        out = await chat.send_message(UserMessage(text=user_prompt))
        return (out or "").strip()
    except Exception as e:
        logger.warning("Scout AI compose failed: %s", e)
        raise HTTPException(status_code=502, detail="Scout AI is briefly unavailable.")


# MIGRATED to routes/scout_ai.py — see REFACTOR_PLAN.md
# @api.post("/admin/ai/generate-editorial")
async def admin_ai_generate_editorial_LEGACY(
    city: Optional[str] = None,
    template_index: Optional[int] = None,
    user: dict = Depends(require_role("moderator")),
):
    """Admin-triggered: Scout AI composes + publishes an editorial post to the
    community feed authored by @scoutai. Every post is clearly labeled as
    official AI-generated content by the frontend via the author's is_bot flag.
    """
    settings = await _get_scout_settings()
    if not settings["enabled"]:
        raise HTTPException(status_code=400, detail="Scout AI is disabled.")
    if settings["max_posts_per_day"] > 0 and (await _scout_posts_today()) >= settings["max_posts_per_day"]:
        raise HTTPException(status_code=429, detail="Daily Scout AI post cap reached.")

    idx = template_index if template_index is not None else (datetime.now(timezone.utc).day % len(EDITORIAL_TEMPLATES))
    idx = max(0, min(idx, len(EDITORIAL_TEMPLATES) - 1))
    title_stub, brief = EDITORIAL_TEMPLATES[idx]

    # Pull 6-10 recent approved spots (scoped by city when supplied) to ground the post.
    q: dict = {"privacy_mode": "public"}
    if city:
        q["city"] = city
    spots = await db.spots.find(q, {
        "_id": 0, "title": 1, "city": 1, "state": 1, "shoot_types": 1,
        "best_time_of_day": 1, "shoot_score": 1, "updated_at": 1,
    }).sort("updated_at", -1).limit(10).to_list(10)
    ctx_lines = [f"EDITORIAL_BRIEF: {brief}"]
    if city:
        ctx_lines.append(f"CITY_FOCUS: {city}")
    if spots:
        ctx_lines.append("CANDIDATE_SPOTS:")
        for s in spots:
            ctx_lines.append(
                f"  - {s.get('title')} ({s.get('city')}, {s.get('state')}) "
                f"score={s.get('shoot_score')} best={s.get('best_time_of_day')} "
                f"shoots={','.join((s.get('shoot_types') or [])[:3])}"
            )
    context = "\n".join(ctx_lines)

    system = (
        SCOUT_AI_SYSTEM_PROMPT
        + "\n\nYou are composing a short editorial community post for the LumaScout feed. "
        + "Output plain text only (no markdown headings, no hashtags). Keep it under 140 words. "
        + "Open with the concrete value, name 3-5 spots from CANDIDATE_SPOTS (one per line with a 1-sentence reason). "
        + "End with one short question to invite real-user comments."
    )
    body_text = await _scout_llm_compose(
        system,
        f"Write the post body for the editorial '{title_stub}'.",
        context,
    )

    post_id = f"pst_{uuid.uuid4().hex[:12]}"
    doc = {
        "post_id": post_id,
        "author_user_id": SCOUT_AI_USER_ID,
        "category": "guide",
        "title": title_stub,
        "body": body_text[:2000],
        "image_url": None,
        "city": city,
        "state": None,
        "like_count": 0,
        "comment_count": 0,
        "status": "active",
        "ai_generated": True,
        "ai_template_index": idx,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.community_posts.insert_one(doc)
    await audit_log(user, "scout_ai.editorial_post", "community_post", post_id, after={"title": title_stub, "city": city})
    return {"ok": True, "post_id": post_id, "title": title_stub, "body": body_text}


# MIGRATED to routes/scout_ai.py — see REFACTOR_PLAN.md
# @api.post("/admin/ai/reply-to-post/{post_id}")
async def admin_ai_reply_to_post_LEGACY(post_id: str, user: dict = Depends(require_role("moderator"))):
    """Admin-triggered: Scout AI drafts and publishes a reply comment on a
    specific community post (for MVP usage on unanswered Q&A threads)."""
    settings = await _get_scout_settings()
    if not settings["enabled"]:
        raise HTTPException(status_code=400, detail="Scout AI is disabled.")

    post = await db.community_posts.find_one({"post_id": post_id})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    # Build grounding context: the post title/body, author city/state, and any
    # prior comments so Scout AI doesn't repeat itself.
    prior = await db.community_comments.find({"post_id": post_id}, {"_id": 0, "body": 1, "author_user_id": 1}).limit(20).to_list(20)
    ctx_lines = [
        f"POST_TITLE: {post.get('title')}",
        f"POST_CATEGORY: {post.get('category')}",
        f"POST_BODY: {(post.get('body') or '')[:1200]}",
    ]
    if post.get("city"):
        ctx_lines.append(f"POST_CITY: {post['city']}, {post.get('state') or ''}")
    if prior:
        ctx_lines.append(f"PRIOR_COMMENTS: {len(prior)} existing — do not repeat obvious points.")

    system = (
        SCOUT_AI_SYSTEM_PROMPT
        + "\n\nYou are writing a single helpful reply to a LumaScout community post. "
        + "Plain text only. Under 120 words. Lead with the most practical answer, "
        + "then 2-4 concrete considerations. If the question cannot be answered from "
        + "the data you have, say what would be needed to help further."
    )
    reply_txt = await _scout_llm_compose(
        system,
        "Write the reply comment body now.",
        "\n".join(ctx_lines),
    )

    comment = {
        "comment_id": f"cmt_{uuid.uuid4().hex[:12]}",
        "post_id": post_id,
        "author_user_id": SCOUT_AI_USER_ID,
        "body": reply_txt[:2000],
        "ai_generated": True,
        "status": "active",
        "created_at": utcnow(),
    }
    await db.community_comments.insert_one(comment)
    await db.community_posts.update_one({"post_id": post_id}, {"$inc": {"comment_count": 1}})
    await audit_log(user, "scout_ai.reply", "community_post", post_id, after={"comment_id": comment["comment_id"]})
    return {"ok": True, "comment_id": comment["comment_id"], "body": reply_txt}





# ----------------------------------------------------------------------------
# AI shot list — emergentintegrations / GPT (cached per spot for 7 days)
# ----------------------------------------------------------------------------

async def _generate_shot_list(spot: dict) -> List[str]:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="AI service is not configured")
    style = ", ".join(spot.get("style_tags") or []) or "general"
    shoots = ", ".join(spot.get("shoot_types") or []) or "portrait"
    best = spot.get("best_time_of_day") or "golden_hour"
    loc = f"{spot.get('city') or ''}, {spot.get('state') or ''}".strip(", ") or "this location"
    chat = LlmChat(
        api_key=key,
        session_id=f"shotlist:{spot.get('spot_id')}",
        system_message=(
            "You are a professional location scout and photography coach. "
            "Return a JSON array of 6-8 concise shot-list bullets (max 18 words each). "
            "Each bullet names a composition, a subject pose or action, and the ideal camera/light cue. "
            "No numbering, no preamble, no explanation — only the JSON array."
        ),
    ).with_model("openai", "gpt-5.2")
    user_msg = UserMessage(
        text=(
            f'Location: "{spot.get("title")}" in {loc}. '
            f'Best for: {shoots}. Style tags: {style}. Best time of day: {best}. '
            'Generate the shot list JSON.'
        ),
    )
    resp = await chat.send_message(user_msg)
    raw = (resp or "").strip()
    # Parse JSON array; strip possible code fences
    import json as _json
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()
    try:
        items = _json.loads(raw)
        if not isinstance(items, list):
            raise ValueError()
        out = [str(x).strip() for x in items if str(x).strip()]
        if not out:
            raise ValueError()
        return out[:10]
    except Exception:
        # Graceful fallback: split by newlines/bullets.
        lines = [ln.strip(" -•*\t\u2022") for ln in raw.splitlines() if ln.strip()]
        return [ln for ln in lines if ln][:10] or ["Wide establishing shot at golden hour."]




# ============================================================================
# STRIPE BILLING — Real subscription flow (Checkout + Customer Portal + Webhooks)
# ----------------------------------------------------------------------------
# Uses the official `stripe` Python SDK with STRIPE_API_KEY from .env. Products
# and Prices are upserted on startup keyed on lookup_key so price IDs are stable
# across deploys without hardcoding values.
# ============================================================================
import stripe as _stripe  # type: ignore

_STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "").strip()
_STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
_stripe.api_key = _STRIPE_API_KEY or None

# Cache populated by bootstrap_stripe_products() on startup:
#   {"pro": "price_xxx_monthly", "elite": "price_yyy_monthly"}
_STRIPE_PRICE_IDS: Dict[str, str] = {}

# Mapping Stripe price → plan tier (populated alongside _STRIPE_PRICE_IDS).
_STRIPE_PRICE_TO_PLAN: Dict[str, str] = {}


def _stripe_ready() -> bool:
    return bool(_STRIPE_API_KEY)


async def bootstrap_stripe_products():
    """Idempotently ensure Pro & Elite Products + monthly Prices exist in Stripe.

    Safe to call on every startup — uses Stripe's `lookup_key` to dedupe.
    Prices for LumaScout: Pro $9.99/mo · Elite $19.99/mo.
    """
    if not _stripe_ready():
        print("[stripe] STRIPE_API_KEY not set — billing routes are disabled.")
        return
    plan_catalog = [
        {"key": "pro",   "name": "LumaScout Pro",   "amount": 999,  "lookup": "pro_monthly"},
        {"key": "elite", "name": "LumaScout Elite", "amount": 1999, "lookup": "elite_monthly"},
    ]
    try:
        for entry in plan_catalog:
            # 1) Find or create Price by lookup_key.
            existing = _stripe.Price.list(lookup_keys=[entry["lookup"]], active=True, limit=1)
            if existing and existing.data:
                price = existing.data[0]
            else:
                # Find or create Product by name — filter by name to stay idempotent.
                prod_list = _stripe.Product.list(active=True, limit=100)
                prod = next((p for p in prod_list.data if p.name == entry["name"]), None)
                if not prod:
                    prod = _stripe.Product.create(
                        name=entry["name"],
                        description=f'Monthly subscription to {entry["name"]}.',
                    )
                price = _stripe.Price.create(
                    unit_amount=entry["amount"],
                    currency="usd",
                    recurring={"interval": "month"},
                    product=prod.id,
                    lookup_key=entry["lookup"],
                    nickname=entry["lookup"],
                )
            _STRIPE_PRICE_IDS[entry["key"]] = price.id
            _STRIPE_PRICE_TO_PLAN[price.id] = entry["key"]
        print(f"[stripe] price map ready: {_STRIPE_PRICE_IDS}")
    except Exception as e:  # noqa: BLE001
        # Never block startup on Stripe errors — billing routes will just 503.
        print(f"[stripe] bootstrap failed (billing disabled): {e}")


async def _ensure_stripe_customer(user: dict) -> str:
    """Return the Stripe customer_id for a user, creating it lazily."""
    cid = user.get("stripe_customer_id")
    if cid:
        return cid
    customer = _stripe.Customer.create(
        email=user["email"],
        name=user.get("name") or None,
        metadata={"user_id": user["user_id"]},
    )
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"stripe_customer_id": customer.id, "updated_at": utcnow()}},
    )
    return customer.id


class BillingCheckoutIn(BaseModel):
    plan: str  # 'pro' | 'elite'
    origin_url: Optional[str] = None  # e.g. https://example.emergent.host


@api.post("/billing/checkout")
async def billing_checkout(body: BillingCheckoutIn, request: Request, user: dict = Depends(get_current_user)):
    """Create a Stripe Checkout Session (mode=subscription) and return the URL."""
    if not _stripe_ready():
        raise HTTPException(status_code=503, detail="Billing is not configured")
    plan = (body.plan or "").lower()
    if plan not in ("pro", "elite"):
        raise HTTPException(status_code=400, detail="plan must be 'pro' or 'elite'")
    price_id = _STRIPE_PRICE_IDS.get(plan)
    if not price_id:
        # Retry bootstrap once in case startup missed it.
        await bootstrap_stripe_products()
        price_id = _STRIPE_PRICE_IDS.get(plan)
    if not price_id:
        raise HTTPException(status_code=503, detail="Stripe price not available")

    # Prefer caller-supplied origin; fall back to the request's own base (works
    # on web preview + production deployments). Strip trailing slash.
    origin = (body.origin_url or "").rstrip("/")
    if not origin or not origin.startswith(("http://", "https://")):
        origin = str(request.base_url).rstrip("/")
        # Swap backend host (localhost:8001) for the public frontend URL when
        # available via the Host header — Kubernetes ingress forwards 80/443
        # to frontend by default, backend to /api.
        fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        if fwd_host and "localhost" not in fwd_host:
            origin = f"https://{fwd_host}"

    customer_id = await _ensure_stripe_customer(user)

    success_url = f"{origin}/billing?session_id={{CHECKOUT_SESSION_ID}}&status=success"
    cancel_url = f"{origin}/paywall?status=cancelled"

    try:
        session = _stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            allow_promotion_codes=True,
            metadata={
                "user_id": user["user_id"],
                "plan": plan,
            },
            subscription_data={
                "metadata": {"user_id": user["user_id"], "plan": plan},
            },
        )
    except _stripe.error.StripeError as e:  # type: ignore
        raise HTTPException(status_code=400, detail=f"Stripe error: {e.user_message or str(e)}")

    # Track the session in payment_transactions for traceability.
    await db.payment_transactions.insert_one({
        "session_id": session.id,
        "user_id": user["user_id"],
        "plan_target": plan,
        "amount_cents": PLAN_PRICING[plan]["monthly_cents"],
        "currency": "usd",
        "status": "initiated",
        "payment_status": "unpaid",
        "created_at": utcnow(),
    })
    return {"url": session.url, "session_id": session.id}


@api.post("/billing/portal")
async def billing_portal(user: dict = Depends(get_current_user)):
    """Create a Stripe Customer Portal session. Handles change-plan, cancel,
    payment method, invoice history. Users without a customer record get a
    customer created on the fly (they'll see no subscriptions)."""
    if not _stripe_ready():
        raise HTTPException(status_code=503, detail="Billing is not configured")
    customer_id = await _ensure_stripe_customer(user)
    try:
        session = _stripe.billing_portal.Session.create(
            customer=customer_id,
            # Deploy audit fix (v2.0.25): previously hardcoded
            # "https://lumascout.app/billing" — now uses APP_URL so the
            # Stripe portal returns users back to the right origin in
            # preview vs staging vs production.
            return_url=f"{APP_URL}/billing",
        )
    except _stripe.error.StripeError as e:  # type: ignore
        raise HTTPException(status_code=400, detail=f"Stripe error: {e.user_message or str(e)}")
    return {"url": session.url}


@api.get("/billing/status")
async def billing_status(user: dict = Depends(get_current_user)):
    """Return the viewer's current subscription status, renewal date, payment
    method, and last 10 invoices. Safe for users without a customer yet."""
    effective_plan = plan_of(user)
    out = {
        "plan": effective_plan,
        "billing_status": user.get("billing_status") or ("active" if effective_plan != "free" else None),
        "stripe_customer_id": user.get("stripe_customer_id"),
        "stripe_subscription_id": user.get("stripe_subscription_id"),
        "renewal_date": (user.get("renewal_date").isoformat() if isinstance(user.get("renewal_date"), datetime) else user.get("renewal_date")),
        "canceled_at": (user.get("canceled_at").isoformat() if isinstance(user.get("canceled_at"), datetime) else user.get("canceled_at")),
        "payment_failed_at": (user.get("payment_failed_at").isoformat() if isinstance(user.get("payment_failed_at"), datetime) else user.get("payment_failed_at")),
        "cancel_at_period_end": bool(user.get("cancel_at_period_end") or False),
        "payment_method": None,
        "invoices": [],
    }
    # Comp plans surface as "comp" for the UI.
    if (user.get("plan") or "").startswith("comp_"):
        out["billing_status"] = "comp"
    if not _stripe_ready() or not user.get("stripe_customer_id"):
        return out

    try:
        # Payment method (the customer's default invoice source)
        cust = _stripe.Customer.retrieve(user["stripe_customer_id"], expand=["invoice_settings.default_payment_method"])
        pm = getattr(cust.invoice_settings, "default_payment_method", None) if cust.invoice_settings else None
        if pm and getattr(pm, "card", None):
            out["payment_method"] = {"brand": pm.card.brand, "last4": pm.card.last4, "exp_month": pm.card.exp_month, "exp_year": pm.card.exp_year}
        # Invoices — last 10
        inv_list = _stripe.Invoice.list(customer=user["stripe_customer_id"], limit=10)
        out["invoices"] = [
            {
                "id": inv.id,
                "number": inv.number,
                "status": inv.status,
                "amount_paid": inv.amount_paid,
                "amount_due": inv.amount_due,
                "currency": inv.currency,
                "created": inv.created,
                "hosted_invoice_url": inv.hosted_invoice_url,
                "invoice_pdf": inv.invoice_pdf,
                "period_end": inv.period_end,
            }
            for inv in inv_list.auto_paging_iter()
        ][:10]
    except Exception as e:  # noqa: BLE001
        # Never 500 the status endpoint on a Stripe transient failure.
        print(f"[stripe] billing_status soft-fail: {e}")
    return out


async def _apply_subscription_to_user(sub: dict):
    """Given a Stripe Subscription object, update the associated user doc.
    Idempotent — safe to call from any webhook event that carries a Subscription."""
    customer_id = sub.get("customer")
    if not customer_id:
        return
    user = await db.users.find_one({"stripe_customer_id": customer_id})
    if not user:
        # Fall back to metadata.user_id if we haven't linked yet.
        md_uid = (sub.get("metadata") or {}).get("user_id")
        if md_uid:
            user = await db.users.find_one({"user_id": md_uid})
    if not user:
        return

    # Pull plan from the first subscription item's price.
    plan_key = None
    try:
        items = sub.get("items", {}).get("data", [])
        if items:
            pid = items[0].get("price", {}).get("id")
            plan_key = _STRIPE_PRICE_TO_PLAN.get(pid)
    except Exception:
        pass

    status = sub.get("status")  # active, trialing, past_due, canceled, incomplete, unpaid
    cancel_at_period_end = bool(sub.get("cancel_at_period_end"))
    current_period_end = sub.get("current_period_end")
    canceled_at = sub.get("canceled_at")

    updates: Dict[str, Any] = {
        "stripe_customer_id": customer_id,
        "stripe_subscription_id": sub.get("id"),
        "billing_status": status,
        "cancel_at_period_end": cancel_at_period_end,
        "updated_at": utcnow(),
    }
    if plan_key:
        updates["plan"] = plan_key
        updates["billing_cycle"] = "monthly"
        updates["comp_expiration"] = None  # real paid plan wipes comp window
    if current_period_end:
        updates["renewal_date"] = datetime.fromtimestamp(current_period_end, tz=timezone.utc)
    if canceled_at:
        updates["canceled_at"] = datetime.fromtimestamp(canceled_at, tz=timezone.utc)
    else:
        updates["canceled_at"] = None

    # Terminal cancel → downgrade to free. Stripe fires `subscription.deleted`
    # at the end of the billing period when a user had set cancel_at_period_end.
    if status in ("canceled", "incomplete_expired", "unpaid"):
        updates["plan"] = "free"
        updates["billing_cycle"] = None

    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})


@app.post("/api/webhook/stripe")
async def stripe_webhook(request: Request):
    """Stripe webhook receiver. Mounted on the raw app (not the /api router)
    because the body must NOT be touched before signature verification.

    Handles: checkout.session.completed, customer.subscription.created/updated/
    deleted, invoice.payment_failed, invoice.paid.
    """
    if not _stripe_ready():
        raise HTTPException(status_code=503, detail="Billing is not configured")
    payload = await request.body()
    sig = request.headers.get("Stripe-Signature")

    try:
        if _STRIPE_WEBHOOK_SECRET:
            event = _stripe.Webhook.construct_event(payload, sig, _STRIPE_WEBHOOK_SECRET)
        else:
            # Test-mode convenience: accept the body as JSON without verification.
            # Production MUST set STRIPE_WEBHOOK_SECRET.
            import json as _json
            event = _json.loads(payload)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid webhook: {e}")

    etype = event.get("type") if isinstance(event, dict) else event["type"]
    obj = (event.get("data") or {}).get("object") if isinstance(event, dict) else event["data"]["object"]
    # Record for audit/debug (fire-and-forget)
    try:
        await db.stripe_events.insert_one({
            "event_id": event.get("id") if isinstance(event, dict) else event["id"],
            "type": etype,
            "received_at": utcnow(),
            "livemode": event.get("livemode") if isinstance(event, dict) else event.get("livemode"),
        })
    except Exception:
        pass

    try:
        if etype == "checkout.session.completed":
            # Link customer to user if missing, mark payment_transactions paid.
            session_id = obj.get("id")
            metadata = obj.get("metadata") or {}
            uid = metadata.get("user_id")
            customer = obj.get("customer")
            if uid and customer:
                await db.users.update_one(
                    {"user_id": uid, "stripe_customer_id": {"$in": [None, ""]}},
                    {"$set": {"stripe_customer_id": customer, "updated_at": utcnow()}},
                )
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {"status": "completed", "payment_status": "paid", "completed_at": utcnow()}},
            )
            # Marketplace purchase fulfillment
            if metadata.get("kind") == "marketplace_purchase":
                purchase_id = metadata.get("purchase_id")
                purchase = None
                if purchase_id:
                    purchase = await db.marketplace_purchases.find_one({"purchase_id": purchase_id})
                if not purchase:
                    purchase = await db.marketplace_purchases.find_one({"stripe_session_id": session_id})
                if purchase and purchase.get("status") != "completed":
                    now = utcnow()
                    await db.marketplace_purchases.update_one(
                        {"purchase_id": purchase["purchase_id"]},
                        {"$set": {
                            "status": "completed",
                            "completed_at": now,
                            "stripe_payment_intent": obj.get("payment_intent"),
                        }},
                    )
                    await db.marketplace_products.update_one(
                        {"product_id": purchase["product_id"]},
                        {"$inc": {"sales_count": 1}},
                    )
                    try:
                        await _emit_notification(
                            purchase["seller_user_id"],
                            "marketplace_sale",
                            "You made a sale! 🎉",
                            f"+${purchase['seller_payout_cents'] / 100:.2f} — {purchase['product_id']}",
                            actor_user_id=purchase["buyer_user_id"],
                            deep_link=f"/marketplace/{purchase['product_id']}",
                        )
                    except Exception: pass

        elif etype == "charge.refunded":
            # Mark any purchase tied to this charge as refunded.
            charge_id = obj.get("id")
            pi = obj.get("payment_intent")
            q = {"$or": [{"stripe_charge_id": charge_id}, {"stripe_payment_intent": pi}]} if pi else {"stripe_charge_id": charge_id}
            purchase = await db.marketplace_purchases.find_one(q)
            if purchase:
                await db.marketplace_purchases.update_one(
                    {"purchase_id": purchase["purchase_id"]},
                    {"$set": {"status": "refunded", "refunded_at": utcnow()}},
                )
                # Reverse sales_count (floor at 0)
                await db.marketplace_products.update_one(
                    {"product_id": purchase["product_id"], "sales_count": {"$gt": 0}},
                    {"$inc": {"sales_count": -1}},
                )
                try:
                    await _emit_notification(
                        purchase["buyer_user_id"],
                        "marketplace_refund",
                        "Refund processed",
                        f"Your purchase was refunded — ${purchase['price_cents']/100:.2f}",
                        deep_link=f"/marketplace/{purchase['product_id']}",
                    )
                except Exception: pass

        elif etype == "account.updated":
            # Connect account status changed — refresh cache.
            acct_id = obj.get("id")
            if acct_id:
                seller = await db.users.find_one({"stripe_connect_account_id": acct_id}, {"_id": 0, "user_id": 1})
                if seller:
                    await _refresh_connect_status(seller["user_id"], acct_id)

        elif etype in ("customer.subscription.created", "customer.subscription.updated"):
            await _apply_subscription_to_user(obj)

        elif etype == "customer.subscription.deleted":
            # Force downgrade.
            obj["status"] = "canceled"
            await _apply_subscription_to_user(obj)

        elif etype == "invoice.payment_failed":
            cust = obj.get("customer")
            if cust:
                await db.users.update_one(
                    {"stripe_customer_id": cust},
                    {"$set": {"payment_failed_at": utcnow(), "billing_status": "past_due", "updated_at": utcnow()}},
                )

        elif etype == "invoice.paid":
            cust = obj.get("customer")
            if cust:
                await db.users.update_one(
                    {"stripe_customer_id": cust},
                    {"$set": {"payment_failed_at": None, "updated_at": utcnow()}},
                )
    except Exception as e:  # noqa: BLE001
        # Stripe retries non-2xx. We swallow handler errors after logging so
        # we don't loop on malformed payloads — but you can tune this.
        print(f"[stripe] webhook handler error for {etype}: {e}")

    return {"received": True, "type": etype}


# ============================================================================
# Phase B.2 — Referral Marketplace
# Photographers post "needs" (e.g. Need Austin family photographer Sat) and
# other photographers apply. Posting is free; applying has tier-based caps
# (free=5/mo, pro=unlimited, elite=unlimited+featured). Accepting an
# application auto-opens a DM thread between poster + applicant.
# ============================================================================

GIG_TYPES = [
    "full_session_referral",
    "second_shooter",
    "associate_shooter",
    "content_creator",
    "pet_session",
    "wedding_support",
    "event_coverage",
]

REFERRAL_STATUSES = ["open", "reviewing", "filled", "closed", "expired"]

# Free-tier monthly apply cap. Pro/Elite are unlimited.
REFERRAL_APPLY_CAP_FREE_MONTH = 5








async def _hydrate_poster(uid: str) -> Optional[dict]:
    u = await db.users.find_one(
        {"user_id": uid},
        {"_id": 0, "password_hash": 0, "email": 0},
    )
    if not u:
        return None
    return {
        "user_id": u.get("user_id"),
        "name": u.get("name"),
        "username": u.get("username"),
        "avatar_url": u.get("avatar_url"),
        "city": u.get("city"),
        "state": u.get("state"),
        "specialties": u.get("specialties") or [],
        "verification_status": u.get("verification_status"),
        "plan": plan_of(u),
    }


























# ============================================================================
# Pack Marketplace
# Premium creator store for photographers to sell digital goods:
#   - Lightroom presets, spot packs, city guides, route packs, LUTs,
#     templates, mentorship calls.
# Platform takes 15% of gross; rest is payable to seller (Stripe Connect
# split-payouts TBD — we record the split now and store it for payout).
# ============================================================================

MARKETPLACE_TYPES = {
    "preset":     "Lightroom Presets",
    "spot_pack":  "Spot Pack",
    "city_guide": "City Guide",
    "route_pack": "Route Pack",
    "lut":        "LUT",
    "template":   "Template",
    "mentorship": "Mentorship Call",
}
MARKETPLACE_STATUSES = {"pending", "active", "denied", "suspended", "removed"}
PLATFORM_FEE_PCT = 15  # percent

# ---------------------------------------------------------------------------
# Stripe Connect (Express) — seller onboarding + payouts.
# Sellers must connect a Stripe account to receive payouts. We use Express
# because it's the fastest path (Stripe handles KYC/bank collection via
# hosted pages). Platform takes 15% via application_fee_amount; 85% is
# transferred to the seller's connected account.
# ---------------------------------------------------------------------------
CONNECT_COUNTRY = "US"   # MVP: US-only
CONNECT_STATUS_DISCONNECTED = "disconnected"
CONNECT_STATUS_ONBOARDING   = "onboarding"
CONNECT_STATUS_RESTRICTED   = "restricted"
CONNECT_STATUS_ACTIVE       = "active"


def _app_origin(request: Request) -> str:
    """Best-effort resolver for the public app origin (for redirect URLs)."""
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    fwd_proto = request.headers.get("x-forwarded-proto") or "https"
    if fwd_host and "localhost" not in fwd_host and "0.0.0.0" not in fwd_host:
        return f"{fwd_proto}://{fwd_host}"
    # Fall back to request.base_url (dev / local)
    return str(request.base_url).rstrip("/")


async def _refresh_connect_status(user_id: str, acct_id: Optional[str] = None) -> dict:
    """Pull latest account state from Stripe and cache onto the user doc.
    Returns {status, charges_enabled, payouts_enabled, details_submitted,
    requirements, acct_id}. Best-effort: errors downgrade to 'disconnected'.
    """
    if not _stripe_ready():
        return {"status": CONNECT_STATUS_DISCONNECTED, "acct_id": None}
    if not acct_id:
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "stripe_connect_account_id": 1})
        acct_id = (u or {}).get("stripe_connect_account_id")
    if not acct_id:
        return {"status": CONNECT_STATUS_DISCONNECTED, "acct_id": None}
    try:
        acct = _stripe.Account.retrieve(acct_id)
    except Exception as e:  # noqa: BLE001
        print(f"[connect] retrieve failed for {acct_id}: {e}")
        return {"status": CONNECT_STATUS_DISCONNECTED, "acct_id": acct_id}
    charges_enabled = bool(acct.get("charges_enabled"))
    payouts_enabled = bool(acct.get("payouts_enabled"))
    details_submitted = bool(acct.get("details_submitted"))
    req = acct.get("requirements") or {}
    currently_due = req.get("currently_due") or []
    if charges_enabled and payouts_enabled:
        status = CONNECT_STATUS_ACTIVE
    elif details_submitted and (not charges_enabled or not payouts_enabled):
        status = CONNECT_STATUS_RESTRICTED
    elif details_submitted:
        status = CONNECT_STATUS_RESTRICTED
    else:
        status = CONNECT_STATUS_ONBOARDING
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {
            "stripe_connect_account_id": acct_id,
            "stripe_connect_status": status,
            "stripe_connect_charges_enabled": charges_enabled,
            "stripe_connect_payouts_enabled": payouts_enabled,
            "stripe_connect_details_submitted": details_submitted,
            "stripe_connect_requirements": currently_due,
            "stripe_connect_updated_at": utcnow(),
            "updated_at": utcnow(),
        }},
    )
    return {
        "status": status,
        "acct_id": acct_id,
        "charges_enabled": charges_enabled,
        "payouts_enabled": payouts_enabled,
        "details_submitted": details_submitted,
        "requirements": currently_due,
    }











# Simulate completion in non-production environments (e.g. emergent previews
# where Stripe webhooks aren't round-tripping). Real environments MUST rely on
# the Stripe webhook handler already in place.












# ─────────────────────────────────────────────────────────────────────
# CR #1 Ticket #6 · Client error telemetry (option B — no Sentry).
#
# Receives error reports from the mobile client's error boundaries and
# persists them to `db.client_errors` for post-mortem soak analysis.
# We deliberately rate-cap payload size so a runaway client can't spam
# the DB, and we silently accept unauthenticated reports because the
# error itself may be blocking the auth layer.
# ─────────────────────────────────────────────────────────────────────
class ClientErrorIn(BaseModel):
    surface: str = "unknown"           # e.g. "explore", "spot_detail"
    message: str = ""
    stack: Optional[str] = None
    component_stack: Optional[str] = None
    # Arbitrary small JSON context (spotsCount, activeFilterKeys,
    # viewport bounds, view mode). We cap serialized size below.
    context: Optional[Dict[str, Any]] = None
    route: Optional[str] = None
    app_version: Optional[str] = None
    platform: Optional[str] = None


@api.post("/errors")
@graceful(fallback={"ok": True}, label="client_errors.create")
async def client_errors_create(
    body: ClientErrorIn,
    request: Request,
    user: Optional[dict] = Depends(get_optional_user),
):
    # Hard cap on stored payload — keep it tiny. Even a 5 KB report is
    # way more than we need for triage. Oversized strings get truncated
    # with a marker so we can still see there was more.
    def _clip(s: Optional[str], n: int) -> Optional[str]:
        if not s:
            return s
        if len(s) <= n:
            return s
        return s[:n] + f"…[+{len(s) - n}B]"

    ctx = body.context or {}
    # JSON-size guard on context: if it's huge, drop all but the keys.
    try:
        if len(json.dumps(ctx, default=str)) > 2048:
            ctx = {"_keys_only": list(ctx.keys())}
    except Exception:
        ctx = {"_context_unserializable": True}

    doc = {
        "error_id": str(uuid.uuid4()),
        "surface": (body.surface or "unknown")[:32],
        "message": _clip(body.message or "", 512),
        "stack": _clip(body.stack, 2000),
        "component_stack": _clip(body.component_stack, 2000),
        "context": ctx,
        "route": _clip(body.route, 256),
        "app_version": _clip(body.app_version, 32),
        "platform": _clip(body.platform, 16),
        "user_id": (user or {}).get("user_id"),
        "ip": (request.client.host if request.client else None),
        "user_agent": request.headers.get("user-agent", "")[:256],
        "created_at": utcnow(),
    }
    try:
        await db.client_errors.insert_one(doc)
    except Exception:
        # Even DB failures must not bubble up — we're a sink, not a
        # source of app errors.
        pass
    return {"ok": True, "error_id": doc["error_id"]}


# Register the api router AFTER every @api.<method> decorator above has run.
# FastAPI's include_router() snapshots routes at call-time, so this must be the
# very last route-registration step before startup.
app.include_router(api)


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.spots.create_index("spot_id", unique=True)
    await db.spots.create_index("owner_user_id")
    # ─────────────────────────────────────────────────────────────
    # Explore Speed CR — Batch 1 (June 2025)
    # Hot-path indexes for /api/spots and /api/spots/markers.
    # All are idempotent; create_index is a no-op if the index already
    # exists with the same key spec.
    # ─────────────────────────────────────────────────────────────
    await db.spots.create_index([("latitude", 1), ("longitude", 1)])
    await db.spots.create_index([("created_at", -1)])
    await db.spots.create_index("category")
    await db.spots.create_index("visibility_status")
    await db.spots.create_index("privacy_mode")
    await db.spots.create_index("is_test_data")
    await db.spots.create_index("is_premium")
    await db.spots.create_index("is_hidden_gem")
    await db.spots.create_index("city")
    await db.spots.create_index([("shoot_score", -1)])
    await db.spots.create_index([("quality_score", -1)])
    # 2dsphere index on a GeoJSON `location` field. We back-fill missing
    # `location` documents with a one-shot migration below so the index
    # is immediately usable for /spots/markers $geoWithin queries on
    # legacy data. New uploads should populate `location` on insert.
    try:
        # Back-fill `location` for spots that have lat/lng but no
        # GeoJSON shape yet. Tiny payload + idempotent ($exists=False).
        await db.spots.update_many(
            {
                "latitude": {"$type": "number"},
                "longitude": {"$type": "number"},
                "location": {"$exists": False},
            },
            [
                {
                    "$set": {
                        "location": {
                            "type": "Point",
                            "coordinates": ["$longitude", "$latitude"],
                        }
                    }
                }
            ],
        )
    except Exception:
        # Mongo < 4.2 doesn't support pipeline updates; non-fatal.
        pass
    try:
        await db.spots.create_index([("location", "2dsphere")])
    except Exception:
        # If a doc somewhere has a malformed location, skip — the
        # compound (lat, lng) index still backs bbox queries.
        pass
    await db.spot_saves.create_index([("user_id", 1), ("spot_id", 1)], unique=True)
    await db.follows.create_index([("follower_user_id", 1), ("followed_user_id", 1)], unique=True)
    await db.audit_logs.create_index("created_at")
    await db.audit_logs.create_index("admin_user_id")
    await db.audit_logs.create_index("target_id")
    await db.admin_notes.create_index("subject_user_id")
    await db.community_posts.create_index("post_id", unique=True)
    await db.community_posts.create_index([("created_at", -1)])
    await db.community_posts.create_index("city")
    await db.post_likes.create_index([("post_id", 1), ("user_id", 1)], unique=True)
    await db.post_comments.create_index("post_id")
    await db.poll_votes.create_index([("post_id", 1), ("user_id", 1)], unique=True)
    await db.support_tickets.create_index("user_id")
    await db.support_tickets.create_index("status")
    await db.groups.create_index([("city", 1), ("name", 1)])
    await db.group_members.create_index([("group_id", 1), ("user_id", 1)], unique=True)
    await db.group_members.create_index("user_id")
    await db.community_posts.create_index("group_id")
    await db.conversations.create_index("participant_key", unique=True)
    await db.conversations.create_index("participant_user_ids")
    await db.messages.create_index([("conversation_id", 1), ("created_at", 1)])
    # Phase B.1 — Who Viewed Your Profile
    await db.profile_views.create_index([("viewed_user_id", 1), ("last_viewed_at", -1)])
    await db.profile_views.create_index([("viewer_user_id", 1), ("viewed_user_id", 1), ("last_viewed_at", -1)])
    # Phase B.2 — Referral Marketplace
    await db.referral_needs.create_index("need_id", unique=True)
    await db.referral_needs.create_index([("status", 1), ("posted_at", -1)])
    await db.referral_needs.create_index([("city", 1), ("status", 1)])
    await db.referral_needs.create_index("poster_user_id")
    await db.referral_applications.create_index("app_id", unique=True)
    await db.referral_applications.create_index([("need_id", 1), ("applicant_user_id", 1)], unique=True)
    await db.referral_applications.create_index("applicant_user_id")
    # Super Admin Community Control Center
    await db.reports.create_index([("status", 1), ("created_at", -1)])
    await db.reports.create_index([("target_type", 1), ("target_id", 1), ("status", 1)])
    await db.user_sanctions.create_index([("user_id", 1), ("issued_at", -1)])
    await db.user_sanctions.create_index([("active", 1), ("type", 1)])
    await db.community_posts.create_index([("pinned", -1), ("created_at", -1)])
    await db.community_posts.create_index([("status", 1), ("created_at", -1)])
    # Pack Marketplace
    await db.marketplace_products.create_index("product_id", unique=True)
    await db.marketplace_products.create_index([("status", 1), ("created_at", -1)])
    await db.marketplace_products.create_index([("type", 1), ("sales_count", -1)])
    await db.marketplace_products.create_index("seller_user_id")
    await db.marketplace_purchases.create_index("purchase_id", unique=True)
    await db.marketplace_purchases.create_index([("buyer_user_id", 1), ("status", 1)])
    await db.marketplace_purchases.create_index([("seller_user_id", 1), ("created_at", -1)])
    await db.marketplace_purchases.create_index("stripe_session_id")
    await db.marketplace_reviews.create_index([("product_id", 1), ("buyer_user_id", 1)], unique=True)
    await db.marketplace_wishlist.create_index([("user_id", 1), ("product_id", 1)], unique=True)
    await seed_admin()
    # Promote the seeded admin to super_admin for Phase 1 — creates a usable
    # platform owner. Idempotent: skipped if already super_admin.
    await db.users.update_one(
        {"email": ADMIN_EMAIL, "role": {"$ne": "super_admin"}},
        {"$set": {"role": "super_admin"}},
    )
    await seed_demo_content()
    await backfill_freshness()
    await backfill_country_fields()
    await seed_na_content()
    # Marketplace demo products (idempotent).
    await seed_marketplace_demo()
    # Stripe products/prices (idempotent).
    await bootstrap_stripe_products()


async def backfill_freshness():
    """One-time migration: stagger last_verified_at across existing spots so the
    freshness UI has meaningful variety. Only runs on spots that are still at
    the default 'freshly verified' timestamp (verified within the last 60 seconds
    of their created_at), to avoid stomping on real data.
    """
    i = 0
    async for s in db.spots.find({}, {"spot_id": 1, "last_verified_at": 1, "created_at": 1, "_id": 0}):
        lv = s.get("last_verified_at")
        cr = s.get("created_at")
        if not lv or not cr:
            continue
        # Normalize tz
        lv_n = lv if getattr(lv, "tzinfo", None) else lv.replace(tzinfo=timezone.utc)
        cr_n = cr if getattr(cr, "tzinfo", None) else cr.replace(tzinfo=timezone.utc)
        # If last_verified_at is within 60s of created_at (i.e. never refreshed),
        # stagger it so we have fresh/recent/stale spots in the demo set.
        if abs((lv_n - cr_n).total_seconds()) < 60:
            offset_days = (i * 18) % 180
            new_lv = utcnow() - timedelta(days=offset_days)
            await db.spots.update_one(
                {"spot_id": s["spot_id"]},
                {"$set": {"last_verified_at": new_lv}},
            )
        i += 1


async def seed_admin():
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if existing is None:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": ADMIN_EMAIL,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "name": "Keith Larson",
            # FIX(Commit 7b / 2026-04): seed with a real-looking handle instead
            # of the generic 'admin' literal so screenshots and public-profile
            # views don't leak staff-ness. The 'admin' handle is now reserved
            # and blocked from new registrations.
            "username": "keith",
            "avatar_url": None,
            "bio": "Platform administrator",
            "city": "Austin",
            "state": "TX",
            "specialties": [],
            "website": "",
            "instagram": "",
            "role": "admin",
            "verification_status": "verified",
            "auth_provider": "email",
            "created_at": utcnow(),
            "updated_at": utcnow(),
        })
        logger.info("Seeded admin user")
    elif not verify_password(ADMIN_PASSWORD, existing.get("password_hash", "")):
        await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": {"password_hash": hash_password(ADMIN_PASSWORD), "role": "admin"}})
    # FIX(Commit 7b / 2026-04): auto-migrate any legacy "admin" handle on the
    # super-admin account to the new "keith" handle. Safe to run on every
    # boot; idempotent after first fix.
    if existing and existing.get("username") == "admin":
        await db.users.update_one(
            {"email": ADMIN_EMAIL},
            {"$set": {"username": "keith", "name": "Keith Larson"}},
        )
        logger.info("Migrated super-admin handle 'admin' → 'keith'")


# ----------------------------------------------------------------------------
# Demo content
# ----------------------------------------------------------------------------
DEMO_PHOTOGRAPHERS = [
    {"email": "sophie@lumascout.app", "name": "Sophie Reyes", "username": "sophiereyes",
     "avatar_url": "https://images.unsplash.com/photo-1697063882499-f7fca7d2d713?w=400&q=80",
     "bio": "Family & senior photographer — hill country golden hour specialist.",
     "city": "Austin", "state": "TX", "specialties": ["Family", "Seniors"], "verification_status": "verified"},
    {"email": "marco@lumascout.app", "name": "Marco Alvarez", "username": "marcoalvarez",
     "avatar_url": "https://images.unsplash.com/photo-1582070595814-fe36a8d39532?w=400&q=80",
     "bio": "Wedding + engagement. Chasing light across Texas since 2014.",
     "city": "San Antonio", "state": "TX", "specialties": ["Wedding", "Portrait"], "verification_status": "verified"},
    {"email": "priya@lumascout.app", "name": "Priya Chen", "username": "priyachen",
     "avatar_url": "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&q=80",
     "bio": "Pet photography. Yes, your dog IS the moment.",
     "city": "Dallas", "state": "TX", "specialties": ["Pet", "Lifestyle"], "verification_status": "verified"},
    {"email": "jordan@lumascout.app", "name": "Jordan Blake", "username": "jordanblake",
     "avatar_url": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80",
     "bio": "Urban and editorial. Shadows > sunshine.",
     "city": "Houston", "state": "TX", "specialties": ["Urban", "Branding"], "verification_status": "unverified"},
    {"email": "lena@lumascout.app", "name": "Lena Okafor", "username": "lenaokafor",
     "avatar_url": "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&q=80",
     "bio": "Nature, wildflowers, and slow photography.",
     "city": "Fredericksburg", "state": "TX", "specialties": ["Nature", "Portrait"], "verification_status": "verified"},
]

DEMO_SPOTS = [
    {
        "title": "Bluebonnet Fields at Muleshoe Bend",
        "description": "A sprawling sea of bluebonnets every spring, backed by Lake Travis and twisted live oaks. Best at first or last light.",
        "city": "Spicewood", "state": "TX", "latitude": 30.5378, "longitude": -98.0242,
        "shoot_types": ["Family", "Portrait", "Wedding"], "style_tags": ["Sunset", "Nature", "Wildflowers"],
        "best_time_of_day": "sunset", "sunrise_rating": 4, "sunset_rating": 5,
        "morning_golden_hour_rating": 4, "evening_golden_hour_rating": 5,
        "shade_rating": 2, "variety_rating": 4, "crowd_level": 4, "safety_rating": 5,
        "dog_friendly": True, "kid_friendly": True, "accessible": False, "indoor": False,
        "permit_required": True, "permit_notes": "LCRA day pass required ($5).",
        "parking_notes": "Large gravel lot, fills up by 5pm on weekends in April.",
        "walking_notes": "200m easy walk from lot to main field.",
        "lens_recommendations": "35mm for environmental, 85mm for portraits.",
        "best_months": ["March", "April"], "fee_required": True, "fee_notes": "$5 LCRA day use.",
        "images": ["https://images.unsplash.com/photo-1682458856875-7bc127399b77?w=1200&q=85",
                   "https://images.pexels.com/photos/18554161/pexels-photo-18554161.jpeg?w=1200"],
    },
    {
        "title": "Enchanted Rock Summit",
        "description": "Massive pink granite dome with 360° Hill Country views. Sunrise at the summit is unreal.",
        "city": "Fredericksburg", "state": "TX", "latitude": 30.5068, "longitude": -98.8187,
        "shoot_types": ["Portrait", "Wedding", "Branding"], "style_tags": ["Sunrise", "Nature", "Adventure"],
        "best_time_of_day": "sunrise", "sunrise_rating": 5, "sunset_rating": 4,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 4,
        "shade_rating": 1, "variety_rating": 5, "crowd_level": 3, "safety_rating": 3,
        "dog_friendly": False, "kid_friendly": True, "accessible": False, "indoor": False,
        "permit_required": True, "permit_notes": "Texas State Park entry + photo permit for commercial work.",
        "parking_notes": "Park fills by 10am on weekends. Arrive before sunrise.",
        "walking_notes": "1 mile uphill granite scramble to summit.",
        "lens_recommendations": "16-35mm wide, 70-200mm for compressing the dome.",
        "best_months": ["October", "November", "March", "April"], "fee_required": True,
        "images": ["https://images.unsplash.com/photo-1632452888109-af6d83269329?w=1200&q=85",
                   "https://images.unsplash.com/photo-1769913995907-e1cc7ff527a1?w=1200&q=85"],
    },
    {
        "title": "San Antonio River Walk at Blue Hour",
        "description": "Cypress trees, stone bridges, string lights over the river — peak romance.",
        "city": "San Antonio", "state": "TX", "latitude": 29.4260, "longitude": -98.4860,
        "shoot_types": ["Wedding", "Portrait"], "style_tags": ["Urban", "Night", "Indoor"],
        "best_time_of_day": "evening", "sunrise_rating": 2, "sunset_rating": 4,
        "morning_golden_hour_rating": 2, "evening_golden_hour_rating": 5,
        "shade_rating": 5, "variety_rating": 5, "crowd_level": 4, "safety_rating": 4,
        "dog_friendly": True, "kid_friendly": True, "accessible": True, "indoor": False,
        "permit_required": False, "parking_notes": "City parking garages nearby ($15-20).",
        "walking_notes": "Easy flat walkway. Many staircases down from street level.",
        "lens_recommendations": "24-70mm, fast prime like 35 f/1.4 for low light.",
        "best_months": ["October", "November", "December", "February", "March"], "fee_required": False,
        "images": ["https://images.unsplash.com/photo-1776437209500-7595b5e0be72?w=1200&q=85",
                   "https://images.unsplash.com/photo-1533106418989-88406c7cc8ca?w=1200&q=85"],
    },
    {
        "title": "Austin East Side Mural Alleys",
        "description": "A dense 6-block cluster of street art behind Cesar Chavez. New walls every month.",
        "city": "Austin", "state": "TX", "latitude": 30.2614, "longitude": -97.7271,
        "shoot_types": ["Portrait", "Branding", "Seniors"], "style_tags": ["Urban", "Color", "Indoor"],
        "best_time_of_day": "morning", "sunrise_rating": 3, "sunset_rating": 3,
        "morning_golden_hour_rating": 4, "evening_golden_hour_rating": 3,
        "shade_rating": 4, "variety_rating": 5, "crowd_level": 3, "safety_rating": 4,
        "dog_friendly": True, "kid_friendly": True, "accessible": True, "indoor": False,
        "permit_required": False, "parking_notes": "Metered street parking. Use ParkATX app.",
        "walking_notes": "Flat walkable blocks. Plan 45min loop.",
        "lens_recommendations": "35mm or 50mm prime. Avoid ultra-wide — walls are close.",
        "best_months": ["March", "April", "May", "October", "November"], "fee_required": False,
        "images": ["https://images.unsplash.com/photo-1682306550051-2f133f24572e?w=1200&q=85",
                   "https://images.pexels.com/photos/7877261/pexels-photo-7877261.jpeg?w=1200"],
    },
    {
        "title": "Fredericksburg Vineyard at Sunset",
        "description": "Rolling vineyards and a big Texas sky. Great for wedding parties and engagement sessions.",
        "city": "Fredericksburg", "state": "TX", "latitude": 30.2752, "longitude": -98.8720,
        "shoot_types": ["Wedding", "Family", "Portrait"], "style_tags": ["Sunset", "Nature", "Romantic"],
        "best_time_of_day": "sunset", "sunrise_rating": 3, "sunset_rating": 5,
        "morning_golden_hour_rating": 3, "evening_golden_hour_rating": 5,
        "shade_rating": 3, "variety_rating": 4, "crowd_level": 2, "safety_rating": 5,
        "dog_friendly": False, "kid_friendly": True, "accessible": True, "indoor": False,
        "permit_required": True, "permit_notes": "Book with vineyard. $150 session fee.",
        "parking_notes": "Gravel lot next to tasting room.",
        "walking_notes": "Flat vineyard rows, 2 min walk.",
        "lens_recommendations": "85mm for portraits, 35mm for wider scenes.",
        "best_months": ["May", "June", "September", "October"], "fee_required": True, "fee_notes": "$150.",
        "images": ["https://images.pexels.com/photos/33508032/pexels-photo-33508032.jpeg?w=1200",
                   "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=85"],
    },
    {
        "title": "McKinney Falls State Park",
        "description": "Limestone falls, cypress trees, and a hidden grotto. Great for family sessions with kids.",
        "city": "Austin", "state": "TX", "latitude": 30.1841, "longitude": -97.7222,
        "shoot_types": ["Family", "Pet", "Seniors"], "style_tags": ["Nature", "Water", "Forest"],
        "best_time_of_day": "morning", "sunrise_rating": 4, "sunset_rating": 3,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 3,
        "shade_rating": 5, "variety_rating": 5, "crowd_level": 3, "safety_rating": 4,
        "dog_friendly": True, "kid_friendly": True, "accessible": True, "indoor": False,
        "permit_required": False, "parking_notes": "State park day use. Lot gets crowded after 10am.",
        "walking_notes": "Paved paths near falls, gravel deeper in park.",
        "lens_recommendations": "24-70mm for versatility, ND filter for water motion.",
        "best_months": ["March", "April", "October", "November"], "fee_required": True, "fee_notes": "$6 per adult.",
        "images": ["https://images.unsplash.com/photo-1506260408121-e353d10b87c7?w=1200&q=85",
                   "https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=1200&q=85"],
    },
    {
        "title": "Marfa Prada Installation",
        "description": "Iconic art installation in the middle of nowhere. Unreal desert light.",
        "city": "Valentine", "state": "TX", "latitude": 30.6036, "longitude": -104.5239,
        "shoot_types": ["Branding", "Portrait", "Urban"], "style_tags": ["Desert", "Art", "Minimalist"],
        "best_time_of_day": "sunset", "sunrise_rating": 5, "sunset_rating": 5,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 5,
        "shade_rating": 1, "variety_rating": 3, "crowd_level": 2, "safety_rating": 4,
        "dog_friendly": True, "kid_friendly": True, "accessible": True, "indoor": False,
        "permit_required": False, "parking_notes": "Dirt pullout on US-90.",
        "walking_notes": "Very short walk from road.",
        "lens_recommendations": "35mm or 24mm — frame the structure against vast sky.",
        "best_months": ["March", "April", "October", "November"], "fee_required": False,
        "images": ["https://images.unsplash.com/photo-1600101720232-3b37ebde93be?w=1200&q=85",
                   "https://images.unsplash.com/photo-1510253687831-9f65dce00bcc?w=1200&q=85"],
    },
    {
        "title": "Dallas Arts District Rooftop",
        "description": "Downtown skyline backdrop with warm tungsten lights. Ideal for urban branding.",
        "city": "Dallas", "state": "TX", "latitude": 32.7864, "longitude": -96.8008,
        "shoot_types": ["Branding", "Portrait", "Wedding"], "style_tags": ["Urban", "Night", "Skyline"],
        "best_time_of_day": "evening", "sunrise_rating": 2, "sunset_rating": 5,
        "morning_golden_hour_rating": 2, "evening_golden_hour_rating": 5,
        "shade_rating": 3, "variety_rating": 4, "crowd_level": 2, "safety_rating": 4,
        "dog_friendly": False, "kid_friendly": False, "accessible": True, "indoor": True,
        "permit_required": True, "permit_notes": "Contact building management. $200/hr.",
        "parking_notes": "Paid garage attached.",
        "walking_notes": "Elevator access to rooftop.",
        "lens_recommendations": "24-70 f/2.8, tripod for long exposure.",
        "best_months": ["October", "November", "December", "January", "February"], "fee_required": True,
        "images": ["https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&q=85",
                   "https://images.unsplash.com/photo-1544717297-fa95b6ee9643?w=1200&q=85"],
    },
    {
        "title": "Houston Buffalo Bayou Park",
        "description": "Urban greenspace with skyline views, bridges, and cypress-lined paths.",
        "city": "Houston", "state": "TX", "latitude": 29.7633, "longitude": -95.3798,
        "shoot_types": ["Family", "Pet", "Portrait"], "style_tags": ["Urban", "Nature", "Skyline"],
        "best_time_of_day": "sunset", "sunrise_rating": 4, "sunset_rating": 5,
        "morning_golden_hour_rating": 4, "evening_golden_hour_rating": 5,
        "shade_rating": 4, "variety_rating": 5, "crowd_level": 3, "safety_rating": 4,
        "dog_friendly": True, "kid_friendly": True, "accessible": True, "indoor": False,
        "permit_required": False, "parking_notes": "Lots off Sabine St and Memorial Dr.",
        "walking_notes": "Paved flat trails. Several miles of walking paths.",
        "lens_recommendations": "24-70mm and 70-200mm for skyline compression.",
        "best_months": ["March", "April", "October", "November"], "fee_required": False,
        "images": ["https://images.unsplash.com/photo-1543158181-e6f9f6712055?w=1200&q=85",
                   "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=85"],
    },
    {
        "title": "Big Bend Rio Grande Overlook",
        "description": "Cinematic canyon walls and desert mountain light. The holy grail for epic portraits.",
        "city": "Terlingua", "state": "TX", "latitude": 29.2500, "longitude": -103.2500,
        "shoot_types": ["Wedding", "Branding", "Portrait"], "style_tags": ["Desert", "Adventure", "Sunrise"],
        "best_time_of_day": "sunrise", "sunrise_rating": 5, "sunset_rating": 5,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 5,
        "shade_rating": 1, "variety_rating": 5, "crowd_level": 1, "safety_rating": 3,
        "dog_friendly": True, "kid_friendly": False, "accessible": False, "indoor": False,
        "permit_required": True, "permit_notes": "National park entry + commercial photo permit.",
        "parking_notes": "Remote — plan for 2hr drive from Terlingua.",
        "walking_notes": "Short trail but uneven footing.",
        "lens_recommendations": "16-35mm for landscapes, 85mm for compression.",
        "best_months": ["November", "December", "January", "February", "March"], "fee_required": True,
        "images": ["https://images.unsplash.com/photo-1533069027836-fa937181a8ce?w=1200&q=85",
                   "https://images.unsplash.com/photo-1528164344705-47542687000d?w=1200&q=85"],
    },
    {
        "title": "Hamilton Pool Preserve",
        "description": "Natural limestone grotto with a 50ft waterfall. Reservations required.",
        "city": "Dripping Springs", "state": "TX", "latitude": 30.3428, "longitude": -98.1269,
        "shoot_types": ["Wedding", "Portrait", "Family"], "style_tags": ["Nature", "Water", "Grotto"],
        "best_time_of_day": "morning", "sunrise_rating": 3, "sunset_rating": 4,
        "morning_golden_hour_rating": 4, "evening_golden_hour_rating": 4,
        "shade_rating": 5, "variety_rating": 5, "crowd_level": 4, "safety_rating": 3,
        "dog_friendly": False, "kid_friendly": True, "accessible": False, "indoor": False,
        "permit_required": True, "permit_notes": "Advance reservation required via Travis County.",
        "parking_notes": "Small lot, timed entry.",
        "walking_notes": "Steep 1/4 mile trail down to pool.",
        "lens_recommendations": "16-35mm, tripod, ND for silky water.",
        "best_months": ["May", "June", "September", "October"], "fee_required": True, "fee_notes": "$15.",
        "images": ["https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=1200&q=85",
                   "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&q=85"],
    },
    {
        "title": "Hill Country Live Oak Grove",
        "description": "Twisted oak canopies with dappled light. A family session classic.",
        "city": "Boerne", "state": "TX", "latitude": 29.7947, "longitude": -98.7320,
        "shoot_types": ["Family", "Pet", "Seniors"], "style_tags": ["Forest", "Shade", "Nature"],
        "best_time_of_day": "golden_hour", "sunrise_rating": 4, "sunset_rating": 4,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 5,
        "shade_rating": 5, "variety_rating": 3, "crowd_level": 1, "safety_rating": 5,
        "dog_friendly": True, "kid_friendly": True, "accessible": True, "indoor": False,
        "permit_required": False, "parking_notes": "Roadside pullout, easy.",
        "walking_notes": "Flat grove, 2 min walk in.",
        "lens_recommendations": "85mm f/1.4 for dreamy bokeh.",
        "best_months": ["April", "May", "October", "November"], "fee_required": False,
        "images": ["https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=85",
                   "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=85"],
    },
    {
        "title": "South Congress Cactus Garden",
        "description": "Walkable public cactus garden in south Austin. Perfect quirky Texas vibe.",
        "city": "Austin", "state": "TX", "latitude": 30.2490, "longitude": -97.7500,
        "shoot_types": ["Portrait", "Seniors", "Branding"], "style_tags": ["Urban", "Cactus", "Minimalist"],
        "best_time_of_day": "morning", "sunrise_rating": 4, "sunset_rating": 4,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 4,
        "shade_rating": 2, "variety_rating": 3, "crowd_level": 3, "safety_rating": 5,
        "dog_friendly": True, "kid_friendly": True, "accessible": True, "indoor": False,
        "permit_required": False, "parking_notes": "Metered street. Use meter app.",
        "walking_notes": "Flat sidewalk access.",
        "lens_recommendations": "50mm f/1.8 for bright simple portraits.",
        "best_months": ["March", "April", "October", "November"], "fee_required": False,
        "images": ["https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=1200&q=85",
                   "https://images.unsplash.com/photo-1459257831348-f0cdd359235f?w=1200&q=85"],
    },
    {
        "title": "Galveston Beach Pier",
        "description": "Weathered pier and Gulf sunrises. Great for maternity and newborn sessions.",
        "city": "Galveston", "state": "TX", "latitude": 29.2616, "longitude": -94.7847,
        "shoot_types": ["Family", "Wedding", "Portrait"], "style_tags": ["Beach", "Sunrise", "Water"],
        "best_time_of_day": "sunrise", "sunrise_rating": 5, "sunset_rating": 3,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 3,
        "shade_rating": 2, "variety_rating": 3, "crowd_level": 2, "safety_rating": 4,
        "dog_friendly": True, "kid_friendly": True, "accessible": True, "indoor": False,
        "permit_required": False, "parking_notes": "Beach parking $12/day.",
        "walking_notes": "Sandy beach walk. Bring waterproof shoes.",
        "lens_recommendations": "35mm and 85mm. Keep sand away from gear.",
        "best_months": ["April", "May", "September", "October"], "fee_required": True, "fee_notes": "$12 parking.",
        "images": ["https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=85",
                   "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=1200&q=85"],
    },
    {
        "title": "Guadalupe River Cypress Stand",
        "description": "Emerald river, towering cypresses, and warm summer light.",
        "city": "Hunt", "state": "TX", "latitude": 30.0747, "longitude": -99.3320,
        "shoot_types": ["Family", "Wedding"], "style_tags": ["River", "Forest", "Summer"],
        "best_time_of_day": "golden_hour", "sunrise_rating": 4, "sunset_rating": 4,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 5,
        "shade_rating": 5, "variety_rating": 4, "crowd_level": 2, "safety_rating": 4,
        "dog_friendly": True, "kid_friendly": True, "accessible": False, "indoor": False,
        "permit_required": False, "parking_notes": "Roadside access at river crossings.",
        "walking_notes": "River bank walking. Wet rocks — careful.",
        "lens_recommendations": "35mm, polarizing filter to cut glare.",
        "best_months": ["May", "June", "July", "September"], "fee_required": False,
        "images": ["https://images.unsplash.com/photo-1465056836041-7f43ac27dcb5?w=1200&q=85",
                   "https://images.unsplash.com/photo-1473773508845-188df298d2d1?w=1200&q=85"],
    },
    {
        "title": "Kemah Boardwalk at Dusk",
        "description": "Carnival lights, ferris wheel, and Gulf reflections — perfect for dreamy engagements.",
        "city": "Kemah", "state": "TX", "latitude": 29.5452, "longitude": -95.0205,
        "shoot_types": ["Wedding", "Portrait"], "style_tags": ["Urban", "Night", "Lights"],
        "best_time_of_day": "evening", "sunrise_rating": 2, "sunset_rating": 5,
        "morning_golden_hour_rating": 2, "evening_golden_hour_rating": 5,
        "shade_rating": 3, "variety_rating": 4, "crowd_level": 4, "safety_rating": 4,
        "dog_friendly": False, "kid_friendly": True, "accessible": True, "indoor": False,
        "permit_required": False, "parking_notes": "Boardwalk lot, $10.",
        "walking_notes": "Flat boardwalk.",
        "lens_recommendations": "35mm f/1.4 for carnival lights.",
        "best_months": ["March", "April", "October", "November"], "fee_required": True, "fee_notes": "$10 parking.",
        "images": ["https://images.unsplash.com/photo-1508248467877-aec1b08de376?w=1200&q=85",
                   "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&q=85"],
    },
    {
        "title": "Krause Springs Wildflower Meadow",
        "description": "Private meadow with wildflowers, cypresses, and 32 natural springs.",
        "city": "Spicewood", "state": "TX", "latitude": 30.5002, "longitude": -98.1202,
        "shoot_types": ["Family", "Wedding", "Pet"], "style_tags": ["Wildflowers", "Water", "Summer"],
        "best_time_of_day": "morning", "sunrise_rating": 4, "sunset_rating": 4,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 4,
        "shade_rating": 4, "variety_rating": 5, "crowd_level": 3, "safety_rating": 4,
        "dog_friendly": True, "kid_friendly": True, "accessible": False, "indoor": False,
        "permit_required": True, "permit_notes": "$9 entry + photo fee $50.",
        "parking_notes": "Gravel lot at entrance.",
        "walking_notes": "Mix of grass and stairs — wear sneakers.",
        "lens_recommendations": "85mm for close portraits, 24mm for scene.",
        "best_months": ["April", "May", "June", "September"], "fee_required": True, "fee_notes": "$9 + $50 photo fee.",
        "images": ["https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&q=85",
                   "https://images.unsplash.com/photo-1470114716159-e389f8712fda?w=1200&q=85"],
    },
    {
        "title": "Lost Maples Fall Colors",
        "description": "Texas autumn — yes it exists. Brilliant maples in November.",
        "city": "Vanderpool", "state": "TX", "latitude": 29.8194, "longitude": -99.5703,
        "shoot_types": ["Family", "Seniors", "Pet"], "style_tags": ["Autumn", "Forest", "Nature"],
        "best_time_of_day": "afternoon", "sunrise_rating": 3, "sunset_rating": 4,
        "morning_golden_hour_rating": 4, "evening_golden_hour_rating": 4,
        "shade_rating": 5, "variety_rating": 5, "crowd_level": 5, "safety_rating": 4,
        "dog_friendly": True, "kid_friendly": True, "accessible": False, "indoor": False,
        "permit_required": True, "permit_notes": "State park entry. Extremely crowded in November.",
        "parking_notes": "Lots fill by 9am on fall weekends.",
        "walking_notes": "Miles of trails, bring water and sturdy shoes.",
        "lens_recommendations": "70-200mm for color compression.",
        "best_months": ["November"], "fee_required": True, "fee_notes": "$6 per adult.",
        "images": ["https://images.unsplash.com/photo-1507692049790-de58290a4334?w=1200&q=85",
                   "https://images.unsplash.com/photo-1477322524744-0eece9e79640?w=1200&q=85"],
    },
    {
        "title": "Hueco Tanks Historical Site",
        "description": "Ancient pictographs and unusual rock formations near El Paso.",
        "city": "El Paso", "state": "TX", "latitude": 31.9200, "longitude": -106.0350,
        "shoot_types": ["Branding", "Portrait"], "style_tags": ["Desert", "Adventure", "Rocks"],
        "best_time_of_day": "morning", "sunrise_rating": 5, "sunset_rating": 4,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 4,
        "shade_rating": 2, "variety_rating": 4, "crowd_level": 1, "safety_rating": 3,
        "dog_friendly": False, "kid_friendly": True, "accessible": False, "indoor": False,
        "permit_required": True, "permit_notes": "Reservations required + guided tour for North Mountain.",
        "parking_notes": "State park lot.",
        "walking_notes": "Moderate scrambling required.",
        "lens_recommendations": "24-70mm.",
        "best_months": ["October", "November", "March"], "fee_required": True, "fee_notes": "$7/adult.",
        "images": ["https://images.unsplash.com/photo-1506748686214-e9df14d4d9d0?w=1200&q=85",
                   "https://images.unsplash.com/photo-1516939884455-1445c8652f83?w=1200&q=85"],
    },
    {
        "title": "Waco Silos at Golden Hour",
        "description": "Industrial chic backdrop with that Magnolia magic. Great for branding work.",
        "city": "Waco", "state": "TX", "latitude": 31.5567, "longitude": -97.1287,
        "shoot_types": ["Branding", "Portrait", "Family"], "style_tags": ["Urban", "Industrial", "Sunset"],
        "best_time_of_day": "sunset", "sunrise_rating": 3, "sunset_rating": 5,
        "morning_golden_hour_rating": 3, "evening_golden_hour_rating": 5,
        "shade_rating": 3, "variety_rating": 4, "crowd_level": 4, "safety_rating": 5,
        "dog_friendly": True, "kid_friendly": True, "accessible": True, "indoor": True,
        "permit_required": False, "parking_notes": "Free lots, busy weekends.",
        "walking_notes": "Flat walkable complex.",
        "lens_recommendations": "35mm and 85mm.",
        "best_months": ["March", "April", "October", "November"], "fee_required": False,
        "images": ["https://images.unsplash.com/photo-1542889601-399c4f3a8402?w=1200&q=85",
                   "https://images.unsplash.com/photo-1519817650390-64a93db51149?w=1200&q=85"],
    },
    {
        "title": "Pedernales Falls State Park",
        "description": "Layered limestone river falls with dramatic cypress reflections.",
        "city": "Johnson City", "state": "TX", "latitude": 30.3078, "longitude": -98.2561,
        "shoot_types": ["Family", "Portrait", "Wedding"], "style_tags": ["Water", "Nature", "Rocks"],
        "best_time_of_day": "morning", "sunrise_rating": 5, "sunset_rating": 4,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 4,
        "shade_rating": 3, "variety_rating": 5, "crowd_level": 2, "safety_rating": 3,
        "dog_friendly": True, "kid_friendly": True, "accessible": False, "indoor": False,
        "permit_required": True, "permit_notes": "State park day pass.",
        "parking_notes": "Main lot near visitor center.",
        "walking_notes": "Short rocky walk down to falls overlook.",
        "lens_recommendations": "16-35mm wide + polarizer.",
        "best_months": ["March", "April", "October", "November"], "fee_required": True, "fee_notes": "$6/adult.",
        "images": ["https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=1200&q=85",
                   "https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=1200&q=85"],
    },
]


async def seed_demo_content():
    # Only seed if no demo photographers exist
    count = await db.users.count_documents({"email": {"$regex": "@lumascout.app$"}})
    if count >= len(DEMO_PHOTOGRAPHERS):
        # Demo users already present — still make sure NA content is seeded on
        # previously-bootstrapped databases.
        await seed_na_content()
        return
    photographer_ids = []
    for p in DEMO_PHOTOGRAPHERS:
        existing = await db.users.find_one({"email": p["email"]})
        if existing:
            photographer_ids.append(existing["user_id"])
            continue
        uid = f"user_{uuid.uuid4().hex[:12]}"
        doc = {
            "user_id": uid,
            "email": p["email"],
            "password_hash": hash_password("demo123"),
            "username": p["username"],
            "name": p["name"],
            "avatar_url": p["avatar_url"],
            "bio": p["bio"],
            "city": p["city"],
            "state": p["state"],
            "specialties": p["specialties"],
            "website": "",
            "instagram": f"@{p['username']}",
            "role": "user",
            "verification_status": p["verification_status"],
            "auth_provider": "email",
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
        await db.users.insert_one(doc)
        photographer_ids.append(uid)
    logger.info(f"Seeded {len(photographer_ids)} demo photographers")

    # Seed spots (skip if already have any)
    spots_count = await db.spots.count_documents({})
    if spots_count > 0:
        return

    # FIX(Commit 7 / 2026-04): Include the admin account in the round-robin so
    # future re-seeds give the staff account a lived-in share of spots instead
    # of 0. Historically DEMO_PHOTOGRAPHERS excluded admin, which meant a
    # freshly-seeded DB always left the LumaScout admin profile looking empty —
    # confusing in demos and for launch screenshots. Admin participates as an
    # ordinary rotation slot (same weighting as a demo photographer). If no
    # admin is found, fall back to photographer-only rotation. See
    # /app/memory/_audit_reattribution_2026_04.md for the one-off backfill
    # that corrected the existing seeded DB.
    admin_user = await db.users.find_one({"email": ADMIN_EMAIL}, {"user_id": 1, "_id": 0})
    owner_rotation = ([admin_user["user_id"]] if admin_user else []) + photographer_ids

    for i, sp in enumerate(DEMO_SPOTS):
        owner = owner_rotation[i % len(owner_rotation)] if owner_rotation else photographer_ids[i % len(photographer_ids)]
        images = []
        for j, url in enumerate(sp["images"]):
            images.append({
                "image_id": f"img_{uuid.uuid4().hex[:10]}",
                "image_url": url,
                "caption": None,
                "is_cover": j == 0,
                "sort_order": j,
            })
        doc = {
            "spot_id": f"spot_{uuid.uuid4().hex[:12]}",
            "owner_user_id": owner,
            "title": sp["title"],
            "slug": "-".join(sp["title"].lower().split())[:60],
            "description": sp["description"],
            "latitude": sp["latitude"],
            "longitude": sp["longitude"],
            "privacy_mode": "public",
            "visibility_status": "approved",
            "city": sp["city"],
            "state": sp["state"],
            "country": sp.get("country_name", "United States"),
            "country_code": sp.get("country_code", "US"),
            "country_name": sp.get("country_name", "United States"),
            "province_state": sp.get("province_state", sp["state"]),
            "county_region": sp.get("county_region"),
            "timezone": sp.get("timezone", "America/Chicago"),
            "language_hint": sp.get("language_hint", "en"),
            "location_display_mode": "exact",
            "shoot_types": sp["shoot_types"],
            "style_tags": sp["style_tags"],
            "best_time_of_day": sp["best_time_of_day"],
            "sunrise_rating": sp["sunrise_rating"],
            "sunset_rating": sp["sunset_rating"],
            "morning_golden_hour_rating": sp["morning_golden_hour_rating"],
            "evening_golden_hour_rating": sp["evening_golden_hour_rating"],
            "shade_rating": sp["shade_rating"],
            "variety_rating": sp["variety_rating"],
            "crowd_level": sp["crowd_level"],
            "safety_rating": sp["safety_rating"],
            "dog_friendly": sp["dog_friendly"],
            "kid_friendly": sp["kid_friendly"],
            "accessible": sp["accessible"],
            "indoor": sp["indoor"],
            "permit_required": sp["permit_required"],
            "permit_notes": sp.get("permit_notes"),
            "parking_notes": sp.get("parking_notes"),
            "restroom_notes": None,
            "walking_notes": sp.get("walking_notes"),
            "accessibility_notes": None,
            "safety_notes": None,
            "weather_notes": None,
            "lens_recommendations": sp.get("lens_recommendations"),
            "best_months": sp["best_months"],
            "fee_required": sp["fee_required"],
            "fee_notes": sp.get("fee_notes"),
            "images": images,
            # Stagger last_verified_at across the demo set so the freshness
            # indicators on the UI have variety: fresh / recent / stale.
            "last_verified_at": utcnow() - timedelta(days=(i * 18) % 180),
            "created_at": utcnow() - timedelta(days=len(DEMO_SPOTS) - i),
            "updated_at": utcnow(),
        }
        await db.spots.insert_one(doc)

    # Seed a few reviews and checkins on first spot
    first_spot = await db.spots.find_one({}, {"_id": 0})
    if first_spot:
        for reviewer_id in photographer_ids[:3]:
            await db.spot_reviews.insert_one({
                "review_id": f"rev_{uuid.uuid4().hex[:12]}",
                "spot_id": first_spot["spot_id"],
                "user_id": reviewer_id,
                "overall_rating": 5,
                "light_rating": 5,
                "access_rating": 4,
                "variety_rating": 5,
                "crowd_rating": 3,
                "safety_rating": 5,
                "comment": "Absolutely magical. Got there 45 min before sunset — chef's kiss.",
                "created_at": utcnow() - timedelta(days=3),
                "updated_at": utcnow() - timedelta(days=3),
            })

    # Seed a few follows
    if len(photographer_ids) >= 2:
        await db.follows.insert_one({
            "follow_id": f"follow_{uuid.uuid4().hex[:12]}",
            "follower_user_id": photographer_ids[0],
            "followed_user_id": photographer_ids[1],
            "created_at": utcnow(),
        })

    logger.info(f"Seeded {len(DEMO_SPOTS)} demo spots")
    await seed_na_content()


# -----------------------------------------------------------------------------
# North America scalability seed — US/CA/MX cities with realistic users + spots.
# Idempotent: only fires when no non-US seed data exists yet.
# -----------------------------------------------------------------------------
NA_PHOTOGRAPHERS = [
    {"email": "emily.toronto@lumascout.app", "username": "emilytoronto", "name": "Emily Chen",
     "bio": "Urban portraits across the GTA.", "city": "Toronto", "state": "Ontario",
     "country_code": "CA", "country_name": "Canada", "timezone": "America/Toronto", "language_hint": "en",
     "specialties": ["Urban", "Portrait"], "avatar_url": None},
    {"email": "noah.vancouver@lumascout.app", "username": "noahvancouver", "name": "Noah Kim",
     "bio": "PNW landscapes + wedding work.", "city": "Vancouver", "state": "British Columbia",
     "country_code": "CA", "country_name": "Canada", "timezone": "America/Vancouver", "language_hint": "en",
     "specialties": ["Nature", "Wedding"], "avatar_url": None},
    {"email": "diego.cdmx@lumascout.app", "username": "diegocdmx", "name": "Diego Ramírez",
     "bio": "Fotógrafo de bodas en Ciudad de México.", "city": "Mexico City", "state": "CDMX",
     "country_code": "MX", "country_name": "Mexico", "timezone": "America/Mexico_City", "language_hint": "es",
     "specialties": ["Wedding", "Portrait"], "avatar_url": None},
    {"email": "valeria.gdl@lumascout.app", "username": "valeriagdl", "name": "Valeria Morales",
     "bio": "Retratos de familia en Guadalajara.", "city": "Guadalajara", "state": "Jalisco",
     "country_code": "MX", "country_name": "Mexico", "timezone": "America/Mexico_City", "language_hint": "es",
     "specialties": ["Family", "Lifestyle"], "avatar_url": None},
    {"email": "alex.la@lumascout.app", "username": "alexla", "name": "Alex Rivera",
     "bio": "LA creative + brand shooter.", "city": "Los Angeles", "state": "CA",
     "country_code": "US", "country_name": "United States", "timezone": "America/Los_Angeles", "language_hint": "en",
     "specialties": ["Branding", "Urban"], "avatar_url": None},
    {"email": "sophie.montreal@lumascout.app", "username": "sophiemontreal", "name": "Sophie Tremblay",
     "bio": "Photographe de mariage à Montréal.", "city": "Montréal", "state": "Québec",
     "country_code": "CA", "country_name": "Canada", "timezone": "America/Montreal", "language_hint": "fr",
     "specialties": ["Wedding", "Portrait"], "avatar_url": None},
    {"email": "luis.monterrey@lumascout.app", "username": "luismonterrey", "name": "Luis Hernández",
     "bio": "Fotógrafo editorial en Monterrey.", "city": "Monterrey", "state": "Nuevo León",
     "country_code": "MX", "country_name": "Mexico", "timezone": "America/Monterrey", "language_hint": "es",
     "specialties": ["Urban", "Branding"], "avatar_url": None},
]

NA_SPOTS = [
    {
        "title": "Toronto Harbourfront at Golden Hour",
        "description": "CN Tower skyline mirrored in Lake Ontario — best from the foot of York St.",
        "city": "Toronto", "state": "Ontario", "province_state": "Ontario",
        "country_code": "CA", "country_name": "Canada", "timezone": "America/Toronto", "language_hint": "en",
        "latitude": 43.6396, "longitude": -79.3805,
        "shoot_types": ["Wedding", "Portrait"], "style_tags": ["Urban", "Sunset", "Skyline"],
        "best_time_of_day": "sunset", "sunrise_rating": 3, "sunset_rating": 5,
        "morning_golden_hour_rating": 3, "evening_golden_hour_rating": 5,
        "shade_rating": 3, "variety_rating": 4, "crowd_level": 4, "safety_rating": 5,
        "best_months": ["May", "June", "September", "October"], "fee_required": False,
        "permit_required": False,
        "owner_email": "emily.toronto@lumascout.app",
        "images": ["https://images.unsplash.com/photo-1517935706615-2717063c2225?w=1200&q=85"],
    },
    {
        "title": "Stanley Park Seawall Sunrise",
        "description": "Cedar giants, ocean, and the Lions Gate Bridge — everything a PNW portrait needs.",
        "city": "Vancouver", "state": "British Columbia", "province_state": "British Columbia",
        "country_code": "CA", "country_name": "Canada", "timezone": "America/Vancouver", "language_hint": "en",
        "latitude": 49.3017, "longitude": -123.1444,
        "shoot_types": ["Nature", "Portrait", "Wedding"], "style_tags": ["Sunrise", "Nature", "Forest"],
        "best_time_of_day": "sunrise", "sunrise_rating": 5, "sunset_rating": 3,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 3,
        "shade_rating": 4, "variety_rating": 5, "crowd_level": 3, "safety_rating": 5,
        "best_months": ["April", "May", "September", "October"], "fee_required": False,
        "permit_required": True, "permit_notes": "Park board permit for weddings.",
        "owner_email": "noah.vancouver@lumascout.app",
        "images": ["https://images.unsplash.com/photo-1609825488888-3a766db05542?w=1200&q=85"],
    },
    {
        "title": "Coyoacán Cobblestone Courtyards",
        "description": "Coloured walls, bougainvillea, and intimate Frida-era courtyards.",
        "city": "Mexico City", "state": "CDMX", "province_state": "CDMX",
        "country_code": "MX", "country_name": "Mexico", "timezone": "America/Mexico_City", "language_hint": "es",
        "latitude": 19.3467, "longitude": -99.1618,
        "shoot_types": ["Family", "Portrait", "Wedding"], "style_tags": ["Color", "Urban", "Culture"],
        "best_time_of_day": "morning", "sunrise_rating": 3, "sunset_rating": 4,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 4,
        "shade_rating": 4, "variety_rating": 5, "crowd_level": 4, "safety_rating": 4,
        "best_months": ["November", "December", "January", "February", "March"], "fee_required": False,
        "permit_required": False,
        "owner_email": "diego.cdmx@lumascout.app",
        "images": ["https://images.unsplash.com/photo-1518659526054-190340b61bee?w=1200&q=85"],
    },
    {
        "title": "Centro Histórico Guadalajara",
        "description": "Cathedral towers, plazas, and warm stone for cinematic family portraits.",
        "city": "Guadalajara", "state": "Jalisco", "province_state": "Jalisco",
        "country_code": "MX", "country_name": "Mexico", "timezone": "America/Mexico_City", "language_hint": "es",
        "latitude": 20.6767, "longitude": -103.3467,
        "shoot_types": ["Family", "Lifestyle", "Branding"], "style_tags": ["Urban", "Culture", "Warm"],
        "best_time_of_day": "golden_hour", "sunrise_rating": 3, "sunset_rating": 4,
        "morning_golden_hour_rating": 4, "evening_golden_hour_rating": 5,
        "shade_rating": 3, "variety_rating": 5, "crowd_level": 4, "safety_rating": 4,
        "best_months": ["October", "November", "February", "March"], "fee_required": False,
        "permit_required": False,
        "owner_email": "valeria.gdl@lumascout.app",
        "images": ["https://images.unsplash.com/photo-1585975406140-f2b8e7f1f472?w=1200&q=85"],
    },
    {
        "title": "Griffith Observatory Overlook",
        "description": "Classic LA skyline at dusk — Hollywood sign over your shoulder.",
        "city": "Los Angeles", "state": "CA", "province_state": "California",
        "country_code": "US", "country_name": "United States", "timezone": "America/Los_Angeles", "language_hint": "en",
        "latitude": 34.1184, "longitude": -118.3004,
        "shoot_types": ["Urban", "Portrait", "Branding"], "style_tags": ["Sunset", "Skyline", "Urban"],
        "best_time_of_day": "sunset", "sunrise_rating": 3, "sunset_rating": 5,
        "morning_golden_hour_rating": 3, "evening_golden_hour_rating": 5,
        "shade_rating": 2, "variety_rating": 4, "crowd_level": 5, "safety_rating": 4,
        "best_months": ["March", "April", "October", "November"], "fee_required": False,
        "permit_required": True, "permit_notes": "Tripod permit for commercial work.",
        "owner_email": "alex.la@lumascout.app",
        "images": ["https://images.unsplash.com/photo-1503891617560-5b8c2e28cbbf?w=1200&q=85"],
    },
    {
        "title": "Red Rocks Amphitheatre Morning Glow",
        "description": "Sandstone stage and endless plains — arrive pre-dawn for magic.",
        "city": "Morrison", "state": "CO", "province_state": "Colorado",
        "country_code": "US", "country_name": "United States", "timezone": "America/Denver", "language_hint": "en",
        "latitude": 39.6654, "longitude": -105.2057,
        "shoot_types": ["Wedding", "Branding"], "style_tags": ["Sunrise", "Nature", "Rock"],
        "best_time_of_day": "sunrise", "sunrise_rating": 5, "sunset_rating": 4,
        "morning_golden_hour_rating": 5, "evening_golden_hour_rating": 4,
        "shade_rating": 2, "variety_rating": 5, "crowd_level": 3, "safety_rating": 4,
        "best_months": ["May", "June", "September", "October"], "fee_required": False,
        "permit_required": True, "permit_notes": "Commercial photo permit via Denver Arts & Venues.",
        "owner_email": "maya.denver@lumascout.app",
        "images": ["https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=1200&q=85"],
    },
    {
        "title": "Old Montréal Cobblestones at Sunset",
        "description": "17th-century stone architecture and warm lantern light — perfect for timeless weddings.",
        "city": "Montréal", "state": "Québec", "province_state": "Québec",
        "country_code": "CA", "country_name": "Canada", "timezone": "America/Montreal", "language_hint": "fr",
        "latitude": 45.5050, "longitude": -73.5547,
        "shoot_types": ["Wedding", "Portrait"], "style_tags": ["Urban", "Sunset", "Architecture"],
        "best_time_of_day": "sunset", "sunrise_rating": 3, "sunset_rating": 5,
        "morning_golden_hour_rating": 3, "evening_golden_hour_rating": 5,
        "shade_rating": 4, "variety_rating": 5, "crowd_level": 4, "safety_rating": 5,
        "best_months": ["May", "June", "September", "October"], "fee_required": False,
        "permit_required": False,
        "owner_email": "sophie.montreal@lumascout.app",
        "images": ["https://images.unsplash.com/photo-1519178614-68673b201f36?w=1200&q=85"],
    },
    {
        "title": "Cerro de la Silla at Golden Hour",
        "description": "Iconic twin-peak silhouette of Monterrey — ideal for editorial and brand work.",
        "city": "Monterrey", "state": "Nuevo León", "province_state": "Nuevo León",
        "country_code": "MX", "country_name": "Mexico", "timezone": "America/Monterrey", "language_hint": "es",
        "latitude": 25.6335, "longitude": -100.2421,
        "shoot_types": ["Branding", "Urban"], "style_tags": ["Sunset", "Mountain", "Editorial"],
        "best_time_of_day": "golden_hour", "sunrise_rating": 4, "sunset_rating": 5,
        "morning_golden_hour_rating": 4, "evening_golden_hour_rating": 5,
        "shade_rating": 2, "variety_rating": 4, "crowd_level": 2, "safety_rating": 4,
        "best_months": ["November", "December", "February", "March"], "fee_required": False,
        "permit_required": False,
        "owner_email": "luis.monterrey@lumascout.app",
        "images": ["https://images.unsplash.com/photo-1518659526054-190340b61bee?w=1200&q=85"],
    },
]


async def seed_na_content():
    """Idempotent top-up seed of US/CA/MX content. Seeds any missing NA_SPOTS
    rows by matching on title within city — safe to re-run after adding entries.
    """
    # Short-circuit only when the set is complete, not merely 'any non-US row'.
    existing_titles = set()
    async for s in db.spots.find({"country_code": {"$in": ["CA", "MX", "US"]}}, {"title": 1, "city": 1, "_id": 0}):
        existing_titles.add((s.get("title"), s.get("city")))
    missing_rows = [sp for sp in NA_SPOTS if (sp["title"], sp["city"]) not in existing_titles]
    if not missing_rows:
        return

    owner_by_email: dict = {}
    for p in NA_PHOTOGRAPHERS:
        existing = await db.users.find_one({"email": p["email"]})
        if existing:
            owner_by_email[p["email"]] = existing["user_id"]
            continue
        uid = f"user_{uuid.uuid4().hex[:12]}"
        doc = {
            "user_id": uid,
            "email": p["email"],
            "password_hash": hash_password("demo123"),
            "username": p["username"],
            "name": p["name"],
            "avatar_url": p.get("avatar_url"),
            "avatar_image_url": p.get("avatar_url"),
            "banner_image_url": None,
            "bio": p["bio"],
            "city": p["city"],
            "state": p["state"],
            "specialties": p["specialties"],
            "website": "",
            "instagram": f"@{p['username']}",
            "facebook_url": "",
            "tiktok_url": "",
            "role": "user",
            "verification_status": "verified",
            "auth_provider": "email",
            "plan": "free",
            "billing_cycle": None,
            "primary_country": p["country_code"],
            "primary_region": p["state"],
            "timezone": p["timezone"],
            "language_hint": p["language_hint"],
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
        await db.users.insert_one(doc)
        owner_by_email[p["email"]] = uid

    for i, sp in enumerate(missing_rows):
        owner_id = owner_by_email.get(sp["owner_email"])
        if not owner_id:
            continue
        images = [{
            "image_id": f"img_{uuid.uuid4().hex[:10]}",
            "image_url": url,
            "caption": None,
            "is_cover": j == 0,
            "sort_order": j,
        } for j, url in enumerate(sp["images"])]
        doc = {
            "spot_id": f"spot_{uuid.uuid4().hex[:12]}",
            "owner_user_id": owner_id,
            "title": sp["title"],
            "slug": "-".join(sp["title"].lower().split())[:60],
            "description": sp["description"],
            "latitude": sp["latitude"],
            "longitude": sp["longitude"],
            "privacy_mode": "public",
            "visibility_status": "approved",
            "city": sp["city"],
            "state": sp["state"],
            "country": sp["country_name"],
            "country_code": sp["country_code"],
            "country_name": sp["country_name"],
            "province_state": sp["province_state"],
            "county_region": None,
            "timezone": sp["timezone"],
            "language_hint": sp["language_hint"],
            "location_display_mode": "exact",
            "shoot_types": sp["shoot_types"],
            "style_tags": sp["style_tags"],
            "best_time_of_day": sp["best_time_of_day"],
            "sunrise_rating": sp["sunrise_rating"],
            "sunset_rating": sp["sunset_rating"],
            "morning_golden_hour_rating": sp["morning_golden_hour_rating"],
            "evening_golden_hour_rating": sp["evening_golden_hour_rating"],
            "shade_rating": sp["shade_rating"],
            "variety_rating": sp["variety_rating"],
            "crowd_level": sp["crowd_level"],
            "safety_rating": sp["safety_rating"],
            "dog_friendly": True,
            "kid_friendly": True,
            "accessible": True,
            "indoor": False,
            "permit_required": sp.get("permit_required", False),
            "permit_notes": sp.get("permit_notes"),
            "parking_notes": None,
            "restroom_notes": None,
            "walking_notes": None,
            "accessibility_notes": None,
            "safety_notes": None,
            "weather_notes": None,
            "lens_recommendations": None,
            "best_months": sp["best_months"],
            "fee_required": sp.get("fee_required", False),
            "fee_notes": None,
            "images": images,
            "last_verified_at": utcnow() - timedelta(days=(i * 11) % 90),
            "created_at": utcnow() - timedelta(days=len(NA_SPOTS) - i),
            "updated_at": utcnow(),
        }
        await db.spots.insert_one(doc)
    logger.info(f"Seeded {len(NA_SPOTS)} North America spots across {len(set(s['country_code'] for s in NA_SPOTS))} countries")


async def backfill_country_fields():
    """Idempotent one-time migration: ensure every spot & user has NA fields."""
    await db.spots.update_many(
        {"country_code": {"$exists": False}},
        {"$set": {"country_code": "US", "country_name": "United States", "language_hint": "en"}},
    )
    await db.users.update_many(
        {"primary_country": {"$exists": False}},
        {"$set": {"primary_country": "US", "language_hint": "en"}},
    )


# ----------------------------------------------------------------------------
# Pack Marketplace — demo seed data (idempotent).
# Ensures the storefront never looks empty in demos / previews.
# ----------------------------------------------------------------------------
DEMO_PRODUCTS = [
    {
        "key": "golden_hour_austin_presets",
        "title": "Golden Hour Austin — Lightroom Preset Pack",
        "type": "preset",
        "description": "14 warm golden-hour presets handcrafted for Central Texas light. Dialed-in skin tones, desaturated greens, and creamy highlights. Includes desktop + mobile DNG files and a quick-start PDF.",
        "price_cents": 2900,
        "thumbnail_url": "https://images.unsplash.com/photo-1522682078546-47888fe04e81?w=1000&q=80",
        "preview_urls": [
            "https://images.unsplash.com/photo-1522682078546-47888fe04e81?w=1400&q=85",
            "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=1400&q=85",
            "https://images.unsplash.com/photo-1539638254465-3db8a3a2f5ad?w=1400&q=85",
        ],
        "tags": ["austin", "preset", "portrait", "golden-hour"],
        "category": "Presets",
        "featured": True,
    },
    {
        "key": "banff_city_guide",
        "title": "Banff Photographer's Guide — Autumn Edition",
        "type": "city_guide",
        "description": "48-page PDF guide to every hidden trail, lookout, and dawn spot around Banff National Park. Written by a 7-year local photographer. Includes GPS pins, parking tips, best months, and permit requirements.",
        "price_cents": 1900,
        "thumbnail_url": "https://images.unsplash.com/photo-1503614472-8c93d56e92ce?w=1000&q=80",
        "preview_urls": [
            "https://images.unsplash.com/photo-1503614472-8c93d56e92ce?w=1400&q=85",
            "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1400&q=85",
        ],
        "tags": ["banff", "canada", "mountains", "guide"],
        "category": "Guides",
        "featured": True,
    },
    {
        "key": "sedona_spot_pack",
        "title": "Sedona Red Rocks — 12 Spot Pack",
        "type": "spot_pack",
        "description": "12 curated Sedona shooting locations with GPS pins, best times, composition notes, and sample images. Airdrop-ready .gpx file included.",
        "price_cents": 1500,
        "thumbnail_url": "https://images.unsplash.com/photo-1526481280695-3c469368c08a?w=1000&q=80",
        "preview_urls": [
            "https://images.unsplash.com/photo-1526481280695-3c469368c08a?w=1400&q=85",
            "https://images.unsplash.com/photo-1472396961693-142e6e269027?w=1400&q=85",
        ],
        "tags": ["sedona", "arizona", "landscape", "gps"],
        "category": "Spots",
        "featured": False,
    },
    {
        "key": "wedding_route_sf",
        "title": "San Francisco Wedding Route — 8hr Itinerary",
        "type": "route_pack",
        "description": "A proven 8-hour itinerary for SF bay-area wedding couples: 6 scenic stops, drive times, lighting windows, and backup rainy-day spots. Battle-tested by 22 shoots.",
        "price_cents": 3900,
        "thumbnail_url": "https://images.unsplash.com/photo-1519741497674-611481863552?w=1000&q=80",
        "preview_urls": [
            "https://images.unsplash.com/photo-1519741497674-611481863552?w=1400&q=85",
        ],
        "tags": ["wedding", "san-francisco", "itinerary"],
        "category": "Routes",
        "featured": False,
    },
    {
        "key": "cinematic_luts_pack",
        "title": "Cinematic Teal & Orange LUTs (10 pack)",
        "type": "lut",
        "description": "10 broadcast-safe LUTs engineered for skin-tone preservation. Compatible with Premiere, DaVinci, FCPX, and log footage from Sony / Canon / Panasonic.",
        "price_cents": 2400,
        "thumbnail_url": "https://images.unsplash.com/photo-1518930259200-3e4c29f8d1d7?w=1000&q=80",
        "preview_urls": [
            "https://images.unsplash.com/photo-1518930259200-3e4c29f8d1d7?w=1400&q=85",
        ],
        "tags": ["lut", "cinematic", "video"],
        "category": "LUTs",
        "featured": False,
    },
    {
        "key": "invoice_template",
        "title": "Photographer Invoice + Contract Templates",
        "type": "template",
        "description": "Editable Google Doc + Notion templates: shoot contract, model release, deposit invoice, and late-payment reminder sequence. Reviewed by a photography-law attorney.",
        "price_cents": 900,
        "thumbnail_url": "https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=1000&q=80",
        "preview_urls": [
            "https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=1400&q=85",
        ],
        "tags": ["template", "business", "invoice"],
        "category": "Templates",
        "featured": False,
    },
    {
        "key": "portfolio_review_call",
        "title": "1-on-1 Portfolio Review (45 min)",
        "type": "mentorship",
        "description": "Book a Zoom session with a seasoned wedding + portrait pro. Walk through your portfolio, get editing pointers, SEO tips, and a pricing audit. Includes follow-up notes.",
        "price_cents": 7900,
        "thumbnail_url": "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1000&q=80",
        "preview_urls": [
            "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1400&q=85",
        ],
        "tags": ["mentorship", "coaching", "portfolio"],
        "category": "Mentorship",
        "featured": True,
    },
    {
        "key": "moody_film_presets",
        "title": "Moody Film — 20 Desktop + Mobile Presets",
        "type": "preset",
        "description": "Hand-tuned film emulation presets inspired by Portra 400 and Cinestill 800T. One-click mood; adjustable grain + fade sliders.",
        "price_cents": 3200,
        "thumbnail_url": "https://images.unsplash.com/photo-1509114397022-ed747cca3f65?w=1000&q=80",
        "preview_urls": [
            "https://images.unsplash.com/photo-1509114397022-ed747cca3f65?w=1400&q=85",
        ],
        "tags": ["preset", "film", "moody"],
        "category": "Presets",
        "featured": False,
    },
]


async def seed_marketplace_demo():
    """Idempotent seeder for marketplace demo products.

    Distributes products round-robin across demo photographers so the
    storefront feels like a multi-seller catalogue even on a fresh DB.
    """
    sellers = await db.users.find(
        {"email": {"$regex": "@lumascout.app$"}, "role": {"$ne": "super_admin"}},
        {"user_id": 1, "plan": 1, "_id": 0},
    ).limit(12).to_list(12)
    if not sellers:
        return
    created = 0
    for i, p in enumerate(DEMO_PRODUCTS):
        existing = await db.marketplace_products.find_one({"title": p["title"]})
        if existing:
            continue
        seller = sellers[i % len(sellers)]
        now = utcnow() - timedelta(days=(i * 3) % 45)
        doc = {
            "product_id": f"prod_demo_{uuid.uuid4().hex[:10]}",
            "seller_user_id": seller["user_id"],
            "seller_plan": seller.get("plan", "free"),
            "title": p["title"],
            "type": p["type"],
            "description": p["description"],
            "price_cents": p["price_cents"],
            "currency": "USD",
            "thumbnail_url": p["thumbnail_url"],
            "preview_urls": p["preview_urls"],
            "contents_url": "https://example.com/demo-content-placeholder.zip",
            "tags": p["tags"],
            "category": p["category"],
            "status": "active",
            "featured": p.get("featured", False),
            "view_count": 40 + (i * 17) % 300,
            "sales_count": (i * 3) % 24,
            "rating_avg": round(4.2 + (i % 7) * 0.1, 2),
            "rating_count": (i * 2 + 3) % 18,
            "created_at": now,
            "updated_at": now,
        }
        await db.marketplace_products.insert_one(doc)
        created += 1
    if created:
        logger.info(f"Seeded {created} demo marketplace products.")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


# ----------------------------------------------------------------------------
# Per-domain routers (see /app/backend/REFACTOR_PLAN.md).
# Mounted AFTER every server.py definition so route modules can import helpers
# from this file without circular-import issues.
# ----------------------------------------------------------------------------
from routes import scout_ai as _scout_ai_routes  # noqa: E402
from routes import support as _support_routes  # noqa: E402
from routes import super_admin as _super_admin_routes  # noqa: E402
from routes import brand as _brand_routes  # noqa: E402
from routes import marketplace as _marketplace_routes  # noqa: E402
from routes import admin as _admin_routes  # noqa: E402
from routes import network as _network_routes  # noqa: E402
from routes import referrals as _referrals_routes  # noqa: E402
from routes import push as _push_routes  # noqa: E402
from routes import spots as _spots_routes  # noqa: E402
from routes import users as _users_routes  # noqa: E402
from routes import edit_requests as _edit_requests_routes  # noqa: E402
from routes import uploads as _uploads_routes  # noqa: E402
from routes import share as _share_routes  # noqa: E402
from routes import img_proxy as _img_proxy_routes  # noqa: E402

app.include_router(_scout_ai_routes.router)
app.include_router(_support_routes.router)
app.include_router(_super_admin_routes.router)
app.include_router(_brand_routes.router)
app.include_router(_marketplace_routes.router)
app.include_router(_admin_routes.router)
app.include_router(_network_routes.router)
app.include_router(_referrals_routes.router)
app.include_router(_push_routes.router)
app.include_router(_spots_routes.router)
app.include_router(_users_routes.router)
app.include_router(_edit_requests_routes.router)
app.include_router(_uploads_routes.router)
# CR Items 7 & 8 (May 2026) — smart-link share endpoints (HTML responses,
# returned outside of `api` APIRouter because they're consumed by external
# clients pasting the URL into iMessage / Twitter / Slack and need full
# Open Graph metadata at the document root, not inside a JSON wrapper).
app.include_router(_share_routes.router)
# v2.0.24 — image-resize proxy. Exposed under /api prefix with its own
# router (not inside the main `api` APIRouter) so the `/img` path lives
# at /api/img and cache headers / streaming Response objects aren't
# wrapped in the JSON helpers the core APIRouter applies.
from fastapi import APIRouter as _ImgAPIRouter  # noqa: E402
_img_api = _ImgAPIRouter(prefix="/api")
_img_api.include_router(_img_proxy_routes.router)
app.include_router(_img_api)
