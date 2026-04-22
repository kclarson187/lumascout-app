from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import math
import logging
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
    "free": {"saves": 5, "private_spots": 1, "collections": 1, "advanced_filters": False, "sell_packs": False, "creator_analytics": False},
    "pro": {"saves": 10_000, "private_spots": 10_000, "collections": 500, "advanced_filters": True, "sell_packs": False, "creator_analytics": False},
    "elite": {"saves": 10_000, "private_spots": 10_000, "collections": 10_000, "advanced_filters": True, "sell_packs": True, "creator_analytics": True},
    # Comp plans mirror their paid counterparts for feature gating purposes.
    "comp_pro": {"saves": 10_000, "private_spots": 10_000, "collections": 500, "advanced_filters": True, "sell_packs": False, "creator_analytics": False},
    "comp_elite": {"saves": 10_000, "private_spots": 10_000, "collections": 10_000, "advanced_filters": True, "sell_packs": True, "creator_analytics": True},
    "trial_pro": {"saves": 10_000, "private_spots": 10_000, "collections": 500, "advanced_filters": True, "sell_packs": False, "creator_analytics": False},
    "trial_elite": {"saves": 10_000, "private_spots": 10_000, "collections": 10_000, "advanced_filters": True, "sell_packs": True, "creator_analytics": True},
    "suspended": {"saves": 0, "private_spots": 0, "collections": 0, "advanced_filters": False, "sell_packs": False, "creator_analytics": False},
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


def plan_of(user: dict) -> str:
    raw = (user or {}).get("plan") or "free"
    # Expired comp plans silently revert to 'free'.
    expiry = (user or {}).get("comp_expiration")
    if expiry and raw in ("comp_pro", "comp_elite", "trial_pro", "trial_elite"):
        try:
            exp_dt = expiry if isinstance(expiry, datetime) else datetime.fromisoformat(str(expiry).replace("Z", "+00:00"))
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            if exp_dt < datetime.now(timezone.utc):
                return "free"
        except Exception:
            pass
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


class SpotImageIn(BaseModel):
    image_url: str  # base64 data URL or remote URL
    caption: Optional[str] = None
    is_cover: bool = False


class SpotCreateIn(BaseModel):
    title: str
    description: Optional[str] = ""
    latitude: float
    longitude: float
    city: str
    state: str
    country: str = "USA"
    privacy_mode: str = "public"  # private, followers, invite_only, public, premium
    location_display_mode: str = "exact"  # exact, approximate, hidden
    shoot_types: List[str] = []
    style_tags: List[str] = []
    best_time_of_day: Optional[str] = None
    sunrise_rating: int = 3
    sunset_rating: int = 3
    morning_golden_hour_rating: int = 3
    evening_golden_hour_rating: int = 3
    shade_rating: int = 3
    variety_rating: int = 3
    crowd_level: int = 3
    safety_rating: int = 4
    dog_friendly: bool = False
    kid_friendly: bool = True
    accessible: bool = False
    indoor: bool = False
    permit_required: bool = False
    permit_notes: Optional[str] = None
    parking_notes: Optional[str] = None
    restroom_notes: Optional[str] = None
    walking_notes: Optional[str] = None
    accessibility_notes: Optional[str] = None
    safety_notes: Optional[str] = None
    weather_notes: Optional[str] = None
    lens_recommendations: Optional[str] = None
    best_months: List[str] = []
    fee_required: bool = False
    fee_notes: Optional[str] = None
    images: List[SpotImageIn] = []
    # --- Location provenance (new) -------------------------------------------
    source_type: Optional[str] = None
    # one of: gps, searched_place, dropped_pin, manual_entry, metadata_detected
    original_search_query: Optional[str] = None
    geocode_confidence: Optional[float] = None  # 0..1 — from Nominatim importance
    imported_from_bulk_mode: Optional[bool] = False
    # When True, spot is saved as a private draft (no moderation / no feed).
    save_as_draft: Optional[bool] = False
    # --- Optional extended address for manual-entry spots --------------------
    address_line1: Optional[str] = None
    postal_code: Optional[str] = None
    landmark_notes: Optional[str] = None
    # FIX(Commit 7.5 / 2026-04): location-integrity fields.
    # `original_address_input` captures the raw text the user typed
    # (e.g. "716 FM 289, Comfort, TX 78013") so if the later geocode is
    # wrong we can re-run it or let an admin fix it. `geocode_status` is
    # one of: 'success' | 'failed' | 'low_confidence' | 'skipped'.
    original_address_input: Optional[str] = None
    geocode_status: Optional[str] = None
    # FIX(2026-04): [1.2] freeform photographer notes captured on the Ratings step.
    # Max 2000 chars, stripped, stored as null if empty after strip.
    notes: Optional[str] = None

    @field_validator("latitude")
    @classmethod
    def _validate_lat(cls, v: float) -> float:
        # FIX(Commit 7.5): hard-reject the "Null Island" ocean bug. Any spot
        # submitted with exactly (0, 0) is almost certainly a failed geocode
        # being silently coerced. Also reject out-of-range values.
        if v is None:
            raise ValueError("Latitude is required. Drop a pin or search for a place.")
        if not (-90.0 <= v <= 90.0):
            raise ValueError("Latitude must be between -90 and 90.")
        if v == 0.0:
            raise ValueError("Could not determine a valid location. Please refine the address or drop a pin manually.")
        return v

    @field_validator("longitude")
    @classmethod
    def _validate_lng(cls, v: float) -> float:
        if v is None:
            raise ValueError("Longitude is required. Drop a pin or search for a place.")
        if not (-180.0 <= v <= 180.0):
            raise ValueError("Longitude must be between -180 and 180.")
        if v == 0.0:
            raise ValueError("Could not determine a valid location. Please refine the address or drop a pin manually.")
        return v

    @field_validator("notes")
    @classmethod
    def _validate_notes(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        stripped = v.strip()
        if not stripped:
            return None
        if len(stripped) > 2000:
            raise ValueError("Notes must be 2000 characters or fewer.")
        return stripped
    # --- North America scalability ------------------------------------------
    country_code: Optional[str] = None     # ISO alpha-2: "US", "CA", "MX"
    country_name: Optional[str] = None     # "United States", "Canada", "Mexico"
    province_state: Optional[str] = None   # fuller label than 2-letter state
    county_region: Optional[str] = None
    timezone: Optional[str] = None         # IANA zone
    language_hint: Optional[str] = None    # "en", "es", "fr"


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


class CollectionIn(BaseModel):
    name: str
    description: Optional[str] = ""
    privacy_mode: str = "private"


class CollectionAddIn(BaseModel):
    spot_id: str


class ReportIn(BaseModel):
    target_type: str  # spot, user, review
    target_id: str
    reason: str
    details: Optional[str] = ""


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
    email: str


class ResetPasswordIn(BaseModel):
    token: str
    new_password: str


async def send_password_reset_email(email: str, reset_link: str) -> None:
    """Stub: logs the link for now. Replace with Resend/SendGrid in production."""
    logger.info("[email.stub] password reset link for %s → %s", email, reset_link)


@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn, request: Request):
    """
    Generates a 30-minute single-use reset token. ALWAYS responds `ok:true` so
    we don't leak which emails are registered (no enumeration).

    In dev mode, also returns `reset_token` + `reset_link` so the frontend can
    display the link on-screen. Remove these from the response once a real
    email provider is wired.
    """
    email = (body.email or "").lower().strip()
    generic_resp: Dict[str, Any] = {
        "ok": True,
        "message": "If an account with that email exists, we've sent a reset link.",
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

    # DEV MODE: include token + link so FE can show them on-screen.
    # Remove these two fields once a real email provider is wired.
    return {
        **generic_resp,
        "dev_mode": True,
        "reset_token": token,
        "reset_link": reset_link,
        "expires_at": reset_doc["expires_at"].isoformat(),
    }


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
    # live counts
    user["usage"] = {
        "saves": await db.spot_saves.count_documents({"user_id": uid}),
        "private_spots": await db.spots.count_documents({
            "owner_user_id": uid,
            "privacy_mode": {"$in": ["private", "followers", "invite_only"]},
        }),
        "collections": await db.collections.count_documents({"owner_user_id": uid}),
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


class UpgradeIn(BaseModel):
    plan: str  # free | pro | elite
    cycle: Optional[str] = "monthly"  # 'monthly' or 'annual'


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
                "tagline": "For casual scouting",
                "monthly_price": _price(PLAN_PRICING["free"]["monthly_cents"]),
                "annual_price": _price(PLAN_PRICING["free"]["annual_cents"]),
                "monthly_cents": PLAN_PRICING["free"]["monthly_cents"],
                "annual_cents": PLAN_PRICING["free"]["annual_cents"],
                "limits": PLAN_LIMITS["free"],
                "features": [
                    "Browse all public spots",
                    "Save up to 5 spots",
                    "1 collection",
                    "Basic community access",
                ],
            },
            {
                "key": "pro",
                "name": "Pro",
                "tagline": "For working photographers",
                "monthly_price": _price(PLAN_PRICING["pro"]["monthly_cents"]),
                "annual_price": _price(PLAN_PRICING["pro"]["annual_cents"]),
                "monthly_cents": PLAN_PRICING["pro"]["monthly_cents"],
                "annual_cents": PLAN_PRICING["pro"]["annual_cents"],
                "limits": PLAN_LIMITS["pro"],
                "features": [
                    "Unlimited saved spots",
                    "Unlimited collections",
                    "Advanced map filters",
                    "Better discovery",
                    "Advanced messaging",
                    "Priority support",
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
                    "Creator analytics dashboard",
                    "Sell curated spot packs",
                    "Verified creator badge",
                    "Priority in discovery",
                    "DM read receipts",
                ],
            },
        ],
    }


@api.post("/me/upgrade")
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


@api.patch("/auth/me")
async def update_me(body: UserUpdateIn, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    updates["updated_at"] = utcnow()
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return updated


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
@api.get("/users/{user_id}")
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
    if viewer:
        is_following = await db.follows.count_documents({"follower_user_id": viewer["user_id"], "followed_user_id": user_id}) > 0
    # Alias fields so the public profile UI can share rendering code with /auth/me.
    user["stats"] = {
        "spots": spots_count,
        "spots_created": spots_count,
        "followers": followers,
        "following": following,
        "posts_count": posts_count,
        "reviews_received": reviews_received,
    }
    user["is_following"] = is_following
    return user


@api.post("/users/{user_id}/follow")
async def follow_user(user_id: str, user: dict = Depends(get_current_user)):
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    existing = await db.follows.find_one({"follower_user_id": user["user_id"], "followed_user_id": user_id})
    if existing:
        await db.follows.delete_one({"follower_user_id": user["user_id"], "followed_user_id": user_id})
        return {"following": False}
    await db.follows.insert_one({
        "follow_id": f"follow_{uuid.uuid4().hex[:12]}",
        "follower_user_id": user["user_id"],
        "followed_user_id": user_id,
        "created_at": utcnow(),
    })
    return {"following": True}


# ============================================================================
# Spots
# ============================================================================
@api.get("/spots/check-duplicates")
async def check_duplicates(
    latitude: float,
    longitude: float,
    title: Optional[str] = None,
    radius_m: float = 200,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    """Return nearby approved public spots that might duplicate what the user is about to submit.
    Radius is in METERS (default 200m). Only considers approved public/premium spots.
    Optionally scores string similarity if a title is provided.
    """
    radius_km = max(0.05, min(2.0, radius_m / 1000.0))
    candidates = []
    async for s in db.spots.find(
        {"privacy_mode": {"$in": ["public", "premium"]}, "visibility_status": "approved", "is_test_data": {"$ne": True}},
        {"_id": 0},
    ):
        d_km = haversine_km(latitude, longitude, s["latitude"], s["longitude"])
        if d_km > radius_km:
            continue
        sim = 0.0
        if title:
            try:
                from difflib import SequenceMatcher
                sim = SequenceMatcher(None, title.strip().lower(), (s.get("title") or "").strip().lower()).ratio()
            except Exception:
                sim = 0.0
        v = public_spot_view(s, viewer)
        if not v:
            continue
        v["distance_m"] = int(round(d_km * 1000))
        v["title_similarity"] = round(sim, 2)
        candidates.append(v)
    # Rank: closer + higher similarity first
    candidates.sort(key=lambda c: (c["distance_m"], -c["title_similarity"]))
    return {"count": len(candidates), "candidates": candidates[:5]}


@api.post("/spots")
async def create_spot(body: SpotCreateIn, user: dict = Depends(get_current_user)):
    check_rate_limit("spot_create", user["user_id"])
    # Feature gating: free plan can only create 3 private/followers/invite_only spots
    if body.privacy_mode in ("private", "followers", "invite_only"):
        limits = limits_for(user)
        current = await db.spots.count_documents({
            "owner_user_id": user["user_id"],
            "privacy_mode": {"$in": ["private", "followers", "invite_only"]},
        })
        if current >= limits["private_spots"]:
            raise HTTPException(
                status_code=402,
                detail=f"Free plan limit reached ({limits['private_spots']} private spots). Upgrade to Pro for unlimited.",
            )
    # Elite-only: premium (sellable) spots
    if body.privacy_mode == "premium" and not limits_for(user)["sell_packs"]:
        raise HTTPException(
            status_code=402,
            detail="Premium spots require the Elite plan. Upgrade to publish sellable locations.",
        )
    spot_id = f"spot_{uuid.uuid4().hex[:12]}"
    images = []
    for i, img in enumerate(body.images):
        images.append({
            "image_id": f"img_{uuid.uuid4().hex[:10]}",
            "image_url": img.image_url,
            "caption": img.caption,
            "is_cover": img.is_cover or (i == 0),
            "sort_order": i,
        })
    if images and not any(i["is_cover"] for i in images):
        images[0]["is_cover"] = True

    visibility_status = "pending_review" if body.privacy_mode in ("public", "premium") else "approved"
    if user.get("verification_status") == "verified" and body.privacy_mode in ("public", "premium"):
        visibility_status = "approved"
    # Drafts override everything — stays owner-only, never hits moderation.
    if body.save_as_draft:
        visibility_status = "draft"

    doc = body.dict()
    doc.pop("images", None)
    doc.pop("save_as_draft", None)  # not persisted as a spot field
    doc.update({
        "spot_id": spot_id,
        "owner_user_id": user["user_id"],
        "images": images,
        "visibility_status": visibility_status,
        "slug": "-".join(body.title.lower().split())[:60],
        "last_verified_at": utcnow(),
        "created_at": utcnow(),
        "updated_at": utcnow(),
    })
    try:
        await db.spots.insert_one(doc)
    except DocumentTooLarge:
        raise HTTPException(
            status_code=413,
            detail="Your photos are too large to store together. Please remove a photo or re-add them so they can be compressed.",
        )
    return public_spot_view(doc, user)


@api.get("/spots/{spot_id}")
async def get_spot(spot_id: str, viewer: Optional[dict] = Depends(get_optional_user)):
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    # privacy check
    if spot.get("privacy_mode") == "private":
        if not viewer or viewer.get("user_id") != spot["owner_user_id"]:
            raise HTTPException(status_code=403, detail="Private spot")
    view = public_spot_view(spot, viewer)

    # owner info
    owner = await db.users.find_one({"user_id": spot["owner_user_id"]}, {"_id": 0, "password_hash": 0})
    view["owner"] = owner

    # saved state
    view["is_saved"] = False
    if viewer:
        view["is_saved"] = await db.spot_saves.count_documents(
            {"user_id": viewer["user_id"], "spot_id": spot_id}
        ) > 0

    # reviews
    reviews = await db.spot_reviews.find({"spot_id": spot_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    for r in reviews:
        u = await db.users.find_one({"user_id": r["user_id"]}, {"_id": 0, "name": 1, "avatar_url": 1, "username": 1})
        r["user"] = u
    view["reviews"] = reviews
    view["review_count"] = len(reviews)
    view["average_rating"] = round(sum(r["overall_rating"] for r in reviews) / len(reviews), 1) if reviews else None

    # checkins
    checkins = await db.spot_checkins.find({"spot_id": spot_id}, {"_id": 0}).sort("created_at", -1).to_list(10)
    for c in checkins:
        u = await db.users.find_one({"user_id": c["user_id"]}, {"_id": 0, "name": 1, "avatar_url": 1, "username": 1})
        c["user"] = u
    view["checkins"] = checkins

    # similar spots (same shoot types, within 100km)
    similar = []
    async for s in db.spots.find({"spot_id": {"$ne": spot_id}, "privacy_mode": {"$in": ["public", "premium"]}, "visibility_status": "approved"}, {"_id": 0}):
        d = haversine_km(spot["latitude"], spot["longitude"], s["latitude"], s["longitude"])
        if d <= 100:
            shared = set(s.get("shoot_types", [])) & set(spot.get("shoot_types", []))
            if shared:
                sv = public_spot_view(s, viewer)
                if sv:
                    sv["distance_km"] = round(d, 1)
                    similar.append(sv)
        if len(similar) >= 6:
            break
    view["similar_spots"] = similar
    return view


@api.get("/spots")
async def list_spots(
    shoot_type: Optional[str] = None,
    tag: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    dog_friendly: Optional[bool] = None,
    kid_friendly: Optional[bool] = None,
    accessible: Optional[bool] = None,
    indoor: Optional[bool] = None,
    permit_required: Optional[bool] = None,
    fee_required: Optional[bool] = None,
    best_time_of_day: Optional[str] = None,
    min_rating: Optional[int] = None,
    # ------ New photographer-specific filters (Priority #3) ----------------
    min_parking_ease: Optional[int] = None,       # 1..5 (5 = easy, lots of spots)
    max_walking_distance: Optional[int] = None,   # 1..5 (1 = trailhead; 5 = long hike)
    max_crowd_level: Optional[int] = None,        # 1..5 (lower = less crowded)
    best_season: Optional[str] = None,            # matches best_months item
    hidden_gem: Optional[bool] = None,            # shoot_score >= 60 and low visit count
    proven_spot: Optional[bool] = None,           # shoot_score >= 80 and images >= 3
    verified_recently: Optional[bool] = None,     # verified in last 60 days
    min_sunrise_strength: Optional[int] = None,   # 1..5
    min_sunset_strength: Optional[int] = None,    # 1..5
    min_morning_golden: Optional[int] = None,     # 1..5
    min_evening_golden: Optional[int] = None,     # 1..5
    min_variety: Optional[int] = None,            # 1..5 (background_variety / variety_rating)
    # -----------------------------------------------------------------------
    q: Optional[str] = None,
    sort: str = "recent",  # recent, trending, golden_hour, score
    limit: int = 40,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    query: dict = {
        "privacy_mode": {"$in": ["public", "premium"]},
        "visibility_status": "approved",
        "is_test_data": {"$ne": True},  # FIX(2026-04): [5.1/7.2]
    }
    if shoot_type:
        query["shoot_types"] = shoot_type
    if tag:
        query["style_tags"] = tag
    if city:
        query["city"] = {"$regex": f"^{city}$", "$options": "i"}
    if state:
        query["state"] = {"$regex": f"^{state}$", "$options": "i"}
    if dog_friendly is not None:
        query["dog_friendly"] = dog_friendly
    if kid_friendly is not None:
        query["kid_friendly"] = kid_friendly
    if accessible is not None:
        query["accessible"] = accessible
    if indoor is not None:
        query["indoor"] = indoor
    if permit_required is not None:
        query["permit_required"] = permit_required
    if fee_required is not None:
        query["fee_required"] = fee_required
    if best_time_of_day:
        query["best_time_of_day"] = best_time_of_day
    if best_season:
        query["best_months"] = best_season
    if min_parking_ease is not None:
        query["parking_rating"] = {"$gte": int(min_parking_ease)}
    if max_walking_distance is not None:
        query["walk_rating"] = {"$lte": int(max_walking_distance)}
    if max_crowd_level is not None:
        query["crowd_level"] = {"$lte": int(max_crowd_level)}
    if min_sunrise_strength is not None:
        query["sunrise_quality"] = {"$gte": int(min_sunrise_strength)}
    if min_sunset_strength is not None:
        query["sunset_quality"] = {"$gte": int(min_sunset_strength)}
    if min_morning_golden is not None:
        query["morning_golden_hour_rating"] = {"$gte": int(min_morning_golden)}
    if min_evening_golden is not None:
        query["evening_golden_hour_rating"] = {"$gte": int(min_evening_golden)}
    if min_variety is not None:
        query["variety_rating"] = {"$gte": int(min_variety)}
    if verified_recently:
        cutoff = utcnow() - timedelta(days=60)
        query["verified_at"] = {"$gte": cutoff}
    if q:
        query["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
            {"city": {"$regex": q, "$options": "i"}},
            {"style_tags": {"$regex": q, "$options": "i"}},
        ]

    spots = await db.spots.find(query, {"_id": 0}).to_list(500)
    out = [public_spot_view(s, viewer) for s in spots]
    out = [s for s in out if s is not None]
    if min_rating is not None:
        out = [s for s in out if s["shoot_score"] >= min_rating]
    # Hidden gem / proven spot are derived flags on public view
    if hidden_gem:
        out = [s for s in out if s["shoot_score"] >= 60 and (s.get("save_count") or 0) < 5]
    if proven_spot:
        out = [s for s in out if s["shoot_score"] >= 80 and len(s.get("images") or []) >= 3]

    if sort == "score":
        out.sort(key=lambda s: s["shoot_score"], reverse=True)
    elif sort == "trending":
        # Approximate trending: score + image count
        out.sort(key=lambda s: s["shoot_score"] + len(s.get("images", [])) * 2, reverse=True)
    elif sort == "golden_hour":
        out.sort(
            key=lambda s: (s.get("morning_golden_hour_rating", 0) + s.get("evening_golden_hour_rating", 0)),
            reverse=True,
        )
    else:  # recent
        out.sort(key=lambda s: s.get("created_at") or utcnow(), reverse=True)

    out = out[:limit]
    await attach_owners(out)
    return out


@api.get("/spots/nearby/search")
async def nearby(
    lat: float,
    lng: float,
    radius_km: float = 100,
    limit: int = 40,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    query = {"privacy_mode": {"$in": ["public", "premium"]}, "visibility_status": "approved", "is_test_data": {"$ne": True}}
    spots = await db.spots.find(query, {"_id": 0}).to_list(500)
    out = []
    for s in spots:
        d = haversine_km(lat, lng, s["latitude"], s["longitude"])
        if d <= radius_km:
            v = public_spot_view(s, viewer)
            if v:
                v["distance_km"] = round(d, 1)
                out.append(v)
    out.sort(key=lambda s: s["distance_km"])
    out = out[:limit]
    await attach_owners(out)
    return out


@api.get("/feed/home")
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
    base_query = {"privacy_mode": {"$in": ["public", "premium"]}, "visibility_status": "approved", "is_test_data": {"$ne": True}}
    all_spots = await db.spots.find(base_query, {"_id": 0}).to_list(800)
    scored = []
    for s in all_spots:
        v = public_spot_view(s, viewer)
        if v:
            scored.append(v)
    await attach_owners(scored)

    # ---- Distance center --------------------------------------------------
    center_lat, center_lng = 30.2672, -97.7431  # Austin fallback
    center_source = "default"
    if lat is not None and lng is not None:
        center_lat, center_lng = float(lat), float(lng)
        center_source = "device_gps"
    elif viewer and viewer.get("city"):
        for s in scored:
            if (s.get("city") or "").lower() == (viewer.get("city") or "").lower():
                center_lat, center_lng = s["latitude"], s["longitude"]
                center_source = "profile_city"
                break
    for s in scored:
        try:
            d_km = haversine_km(center_lat, center_lng, s["latitude"], s["longitude"])
            s["distance_km"] = round(d_km, 2)
            s["distance_mi"] = round(d_km * 0.621371, 2)
        except Exception:
            s["distance_km"], s["distance_mi"] = None, None

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

    return {
        "hero": hero,
        "nearby": nearby_list,
        "trending": trending,
        "golden_hour": golden,
        "recent": recent,
        "best_for_you": best_for_you,
        "following": following_feed,
        "seasonal": seasonal,
        "freshly_updated": freshly_updated,
    }


@api.delete("/spots/{spot_id}")
async def delete_spot(spot_id: str, user: dict = Depends(get_current_user)):
    spot = await db.spots.find_one({"spot_id": spot_id})
    if not spot:
        raise HTTPException(status_code=404, detail="Not found")
    if spot["owner_user_id"] != user["user_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.spots.delete_one({"spot_id": spot_id})
    await db.spot_saves.delete_many({"spot_id": spot_id})
    await db.spot_reviews.delete_many({"spot_id": spot_id})
    await db.spot_checkins.delete_many({"spot_id": spot_id})
    await db.spot_community_uploads.delete_many({"spot_id": spot_id})
    await db.spot_updates.delete_many({"spot_id": spot_id})
    return {"ok": True}


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


class SpotUploadImageIn(BaseModel):
    image_url: str  # base64 data URL or remote URL
    caption: Optional[str] = None


class SpotCommunityUploadIn(BaseModel):
    """Body for POST /api/spots/{id}/uploads.

    Bundles 1..N photos into a single community upload submission. The
    submission as a whole gets one caption, one set of condition tags,
    and one visibility flag — individual per-photo captions are optional.
    """
    images: List[SpotUploadImageIn] = Field(..., min_length=1, max_length=12)
    caption: Optional[str] = None
    condition_tags: List[str] = []
    visibility: str = "public"  # "public" | "followers" (followers is future-ready)

    @field_validator("condition_tags")
    @classmethod
    def _norm_tags(cls, v):
        if not v:
            return []
        norm = []
        seen = set()
        for t in v:
            if not isinstance(t, str):
                continue
            k = t.strip().lower().replace(" ", "_")
            if k in ALLOWED_CONDITION_TAGS and k not in seen:
                norm.append(k)
                seen.add(k)
            if len(norm) >= 6:
                break
        return norm

    @field_validator("visibility")
    @classmethod
    def _norm_vis(cls, v):
        return v if v in ("public", "followers") else "public"


class SpotUpdateIn(BaseModel):
    """Body for POST /api/spots/{id}/updates — short text-only check-in."""
    text: str = Field(..., min_length=3, max_length=500)
    condition_tags: List[str] = []

    @field_validator("text")
    @classmethod
    def _strip_text(cls, v):
        v = (v or "").strip()
        if len(v) < 3:
            raise ValueError("Text too short")
        return v

    @field_validator("condition_tags")
    @classmethod
    def _norm_tags(cls, v):
        if not v:
            return []
        out, seen = [], set()
        for t in v:
            if isinstance(t, str):
                k = t.strip().lower().replace(" ", "_")
                if k in ALLOWED_CONDITION_TAGS and k not in seen:
                    out.append(k)
                    seen.add(k)
            if len(out) >= 6:
                break
        return out


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


def _upload_to_public_view(doc: dict) -> dict:
    """Strip _id + compute public shape."""
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


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


@api.post("/spots/{spot_id}/uploads")
async def post_spot_upload(
    spot_id: str,
    body: SpotCommunityUploadIn,
    user: dict = Depends(get_current_user),
):
    """Submit 1..N community photos to an existing spot. Each image becomes
    its own `spot_community_uploads` row so moderation/reactions work per
    photo. All rows share the same `batch_id` for grouping in the UI.
    """
    spot = await db.spots.find_one({"spot_id": spot_id})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    if spot.get("visibility_status") == "deleted":
        raise HTTPException(status_code=410, detail="Spot no longer exists")
    auto_approve = _can_auto_approve(user, spot)
    status_ = "approved" if auto_approve else "pending"
    now = utcnow()
    batch_id = f"batch_{uuid.uuid4().hex[:12]}"
    docs = []
    for img in body.images:
        docs.append({
            "upload_id": f"upl_{uuid.uuid4().hex[:12]}",
            "batch_id": batch_id,
            "spot_id": spot_id,
            "user_id": user["user_id"],
            "image_url": img.image_url,
            "caption": (img.caption or body.caption or "").strip() or None,
            "condition_tags": body.condition_tags,
            "visibility": body.visibility,
            "moderation_status": status_,
            "featured": False,
            "like_count": 0,
            "helpful_count": 0,
            "contributor_verified": user.get("verification_status") == "verified",
            "contributor_role": user.get("role"),
            "auto_approved": auto_approve,
            "created_at": now,
            "updated_at": now,
        })
    if docs:
        await db.spot_community_uploads.insert_many(docs)
    if auto_approve:
        await _recompute_spot_freshness(spot_id)
    return {
        "ok": True,
        "batch_id": batch_id,
        "moderation_status": status_,
        "auto_approved": auto_approve,
        "count": len(docs),
        "message": "Posted to the spot!" if auto_approve else "Submitted for review — you'll be notified when it's approved.",
    }


@api.get("/spots/{spot_id}/uploads")
async def list_spot_uploads(
    spot_id: str,
    page: int = 1,
    limit: int = 24,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    """Public listing of approved community uploads, newest first.

    Admins and the spot's owner additionally see pending items so they can
    review inline from the spot page.
    """
    limit = max(1, min(60, limit))
    page = max(1, page)
    q: dict = {"spot_id": spot_id}
    # What statuses can the viewer see?
    include_pending = False
    if viewer:
        spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "owner_user_id": 1})
        if viewer.get("role") in ("admin", "super_admin", "moderator", "support") or (spot and spot.get("owner_user_id") == viewer["user_id"]):
            include_pending = True
    q["moderation_status"] = {"$in": ["approved", "pending"]} if include_pending else "approved"
    total = await db.spot_community_uploads.count_documents(q)
    skip = (page - 1) * limit
    items = await db.spot_community_uploads.find(q, {"_id": 0}) \
        .sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    items = await _hydrate_contributors(items)
    # Attach viewer's reaction state
    if viewer and items:
        upload_ids = [i["upload_id"] for i in items]
        reacted = await db.spot_upload_reactions.find(
            {"user_id": viewer["user_id"], "upload_id": {"$in": upload_ids}},
            {"_id": 0, "upload_id": 1, "kind": 1},
        ).to_list(500)
        rmap: Dict[str, set] = {}
        for r in reacted:
            rmap.setdefault(r["upload_id"], set()).add(r["kind"])
        for it in items:
            kinds = rmap.get(it["upload_id"], set())
            it["liked_by_me"] = "like" in kinds
            it["marked_helpful_by_me"] = "helpful" in kinds
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit,
        "items": items,
    }


@api.post("/spots/{spot_id}/updates")
async def post_spot_update(
    spot_id: str,
    body: SpotUpdateIn,
    user: dict = Depends(get_current_user),
):
    """Submit a short text-only check-in/update on an existing spot."""
    spot = await db.spots.find_one({"spot_id": spot_id})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    if spot.get("visibility_status") == "deleted":
        raise HTTPException(status_code=410, detail="Spot no longer exists")
    auto_approve = _can_auto_approve(user, spot)
    now = utcnow()
    doc = {
        "update_id": f"upd_{uuid.uuid4().hex[:12]}",
        "spot_id": spot_id,
        "user_id": user["user_id"],
        "text": body.text,
        "condition_tags": body.condition_tags,
        "moderation_status": "approved" if auto_approve else "pending",
        "auto_approved": auto_approve,
        "contributor_verified": user.get("verification_status") == "verified",
        "contributor_role": user.get("role"),
        "created_at": now,
        "updated_at": now,
    }
    await db.spot_updates.insert_one(doc)
    if auto_approve:
        await _recompute_spot_freshness(spot_id)
    return {
        "ok": True,
        "update_id": doc["update_id"],
        "moderation_status": doc["moderation_status"],
        "auto_approved": auto_approve,
    }


@api.get("/spots/{spot_id}/updates")
async def list_spot_updates(
    spot_id: str,
    page: int = 1,
    limit: int = 20,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    """List approved updates, newest first. Admin/owner see pending too."""
    limit = max(1, min(50, limit))
    page = max(1, page)
    q: dict = {"spot_id": spot_id}
    include_pending = False
    if viewer:
        spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "owner_user_id": 1})
        if viewer.get("role") in ("admin", "super_admin", "moderator", "support") or (spot and spot.get("owner_user_id") == viewer["user_id"]):
            include_pending = True
    q["moderation_status"] = {"$in": ["approved", "pending"]} if include_pending else "approved"
    total = await db.spot_updates.count_documents(q)
    skip = (page - 1) * limit
    items = await db.spot_updates.find(q, {"_id": 0}) \
        .sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    items = await _hydrate_contributors(items)
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit,
        "items": items,
    }


@api.post("/spot-uploads/{upload_id}/react")
async def react_spot_upload(
    upload_id: str,
    kind: str = "like",  # "like" | "helpful"
    user: dict = Depends(get_current_user),
):
    """Toggle a reaction on a community upload. Returns new counts."""
    if kind not in ("like", "helpful"):
        raise HTTPException(status_code=400, detail="Invalid reaction kind")
    upload = await db.spot_community_uploads.find_one({"upload_id": upload_id})
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    existing = await db.spot_upload_reactions.find_one({
        "upload_id": upload_id, "user_id": user["user_id"], "kind": kind,
    })
    inc_field = "like_count" if kind == "like" else "helpful_count"
    if existing:
        await db.spot_upload_reactions.delete_one({"_id": existing["_id"]})
        await db.spot_community_uploads.update_one(
            {"upload_id": upload_id}, {"$inc": {inc_field: -1}}
        )
        acted = False
    else:
        await db.spot_upload_reactions.insert_one({
            "upload_id": upload_id,
            "user_id": user["user_id"],
            "kind": kind,
            "created_at": utcnow(),
        })
        await db.spot_community_uploads.update_one(
            {"upload_id": upload_id}, {"$inc": {inc_field: 1}}
        )
        acted = True
    # Refresh freshness lazily (counts affect score)
    await _recompute_spot_freshness(upload["spot_id"])
    updated = await db.spot_community_uploads.find_one(
        {"upload_id": upload_id},
        {"_id": 0, "like_count": 1, "helpful_count": 1},
    )
    return {"ok": True, "acted": acted, **(updated or {})}


# ---- Admin moderation ------------------------------------------------------

@api.get("/admin/spot-uploads/pending")
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


class SpotUploadModerationIn(BaseModel):
    action: str  # "approve" | "deny" | "feature" | "unfeature" | "set_as_cover" | "remove"


@api.patch("/admin/spot-uploads/{upload_id}")
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
    return {"ok": True, "action": action}


# ============================================================================
# Saves
# ============================================================================
@api.post("/spots/{spot_id}/save")
async def toggle_save(spot_id: str, user: dict = Depends(get_current_user)):
    existing = await db.spot_saves.find_one({"user_id": user["user_id"], "spot_id": spot_id})
    if existing:
        await db.spot_saves.delete_one({"user_id": user["user_id"], "spot_id": spot_id})
        return {"saved": False}
    # Feature gating: free plan save cap
    limits = limits_for(user)
    current = await db.spot_saves.count_documents({"user_id": user["user_id"]})
    if current >= limits["saves"]:
        raise HTTPException(
            status_code=402,
            detail=f"Free plan allows {limits['saves']} saves. Upgrade to Pro for unlimited saves.",
        )
    await db.spot_saves.insert_one({
        "save_id": f"save_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "spot_id": spot_id,
        "created_at": utcnow(),
    })
    # Notify the spot owner (fire-and-forget, never blocks).
    try:
        spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "owner_user_id": 1, "title": 1})
        if spot and spot.get("owner_user_id") and spot["owner_user_id"] != user["user_id"]:
            await send_push(
                [spot["owner_user_id"]],
                "New save",
                f"{user.get('name') or 'Someone'} saved “{(spot.get('title') or 'your spot')[:60]}”",
                {"type": "spot.save", "spot_id": spot_id},
            )
    except Exception:
        pass
    return {"saved": True}


@api.get("/me/saved")
async def my_saves(user: dict = Depends(get_current_user)):
    saves = await db.spot_saves.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    spot_ids = [s["spot_id"] for s in saves]
    spots = await db.spots.find({"spot_id": {"$in": spot_ids}}, {"_id": 0}).to_list(500)
    spot_map = {s["spot_id"]: public_spot_view(s, user) for s in spots}
    return [spot_map[sid] for sid in spot_ids if sid in spot_map and spot_map[sid]]


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


@api.get("/me/recent-locations")
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


@api.get("/me/drafts")
async def my_drafts(user: dict = Depends(get_current_user)):
    """All draft spots for the current user (visibility_status == 'draft')."""
    drafts = await db.spots.find(
        {"owner_user_id": user["user_id"], "visibility_status": "draft"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    return [public_spot_view(s, user) for s in drafts]


@api.post("/spots/{spot_id}/publish-draft")
async def publish_draft(spot_id: str, user: dict = Depends(get_current_user)):
    """Promote a draft spot to its intended visibility (public → pending_review
    or approved for verified contributors, private → approved).
    """
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Not found")
    if spot.get("owner_user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your draft")
    if spot.get("visibility_status") != "draft":
        raise HTTPException(status_code=400, detail="Not a draft")
    new_status = "pending_review" if spot.get("privacy_mode") in ("public", "premium") else "approved"
    if user.get("verification_status") == "verified" and spot.get("privacy_mode") in ("public", "premium"):
        new_status = "approved"
    await db.spots.update_one(
        {"spot_id": spot_id},
        {"$set": {"visibility_status": new_status, "updated_at": utcnow()}},
    )
    return {"ok": True, "visibility_status": new_status}


@api.get("/me/spots")
async def my_spots(user: dict = Depends(get_current_user)):
    spots = await db.spots.find({"owner_user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [public_spot_view(s, user) for s in spots]


# ============================================================================
# Collections
# ============================================================================
@api.post("/collections")
async def create_collection(body: CollectionIn, user: dict = Depends(get_current_user)):
    limits = limits_for(user)
    current = await db.collections.count_documents({"owner_user_id": user["user_id"]})
    if current >= limits["collections"]:
        raise HTTPException(
            status_code=402,
            detail=f"Free plan allows {limits['collections']} collections. Upgrade to Pro for unlimited.",
        )
    cid = f"col_{uuid.uuid4().hex[:12]}"
    doc = {
        "collection_id": cid,
        "owner_user_id": user["user_id"],
        "name": body.name,
        "description": body.description,
        "privacy_mode": body.privacy_mode,
        "spot_ids": [],
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.collections.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/me/collections")
async def list_my_collections(user: dict = Depends(get_current_user)):
    cols = await db.collections.find({"owner_user_id": user["user_id"]}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    # Attach preview images + city summary for richer list cards.
    for c in cols:
        previews = []
        cities: List[str] = []
        for sid in (c.get("spot_ids") or [])[:8]:
            s = await db.spots.find_one(
                {"spot_id": sid},
                {"_id": 0, "images": 1, "city": 1, "state": 1},
            )
            if not s:
                continue
            if s.get("images"):
                cover = next((i for i in s["images"] if i.get("is_cover")), s["images"][0])
                if cover.get("image_url"):
                    previews.append(cover["image_url"])
            if s.get("city") and s["city"] not in cities:
                cities.append(s["city"])
        c["previews"] = previews[:4]
        c["cover_image_url"] = previews[0] if previews else None
        c["count"] = len(c.get("spot_ids") or [])
        c["cities"] = cities[:3]  # surface up to 3 distinct cities for trip-plan feel
        # Normalise last_updated so client can render a relative label.
        c["last_updated"] = c.get("updated_at") or c.get("created_at")
    return cols


@api.post("/collections/{collection_id}/spots")
async def add_to_collection(collection_id: str, body: CollectionAddIn, user: dict = Depends(get_current_user)):
    col = await db.collections.find_one({"collection_id": collection_id})
    if not col or col["owner_user_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Not found")
    spot_ids = col.get("spot_ids") or []
    if body.spot_id in spot_ids:
        spot_ids.remove(body.spot_id)
        op = "removed"
    else:
        spot_ids.append(body.spot_id)
        op = "added"
    await db.collections.update_one({"collection_id": collection_id}, {"$set": {"spot_ids": spot_ids, "updated_at": utcnow()}})
    return {"ok": True, "op": op, "count": len(spot_ids)}


@api.get("/collections/{collection_id}")
async def get_collection(collection_id: str, viewer: Optional[dict] = Depends(get_optional_user)):
    col = await db.collections.find_one({"collection_id": collection_id}, {"_id": 0})
    if not col:
        raise HTTPException(status_code=404, detail="Not found")
    if col["privacy_mode"] == "private" and (not viewer or viewer["user_id"] != col["owner_user_id"]):
        raise HTTPException(status_code=403, detail="Private collection")
    spots = await db.spots.find({"spot_id": {"$in": col.get("spot_ids") or []}}, {"_id": 0}).to_list(500)
    col["spots"] = [public_spot_view(s, viewer) for s in spots if public_spot_view(s, viewer)]
    return col


# ============================================================================
# Reviews & Check-ins
# ============================================================================
@api.post("/spots/{spot_id}/reviews")
async def create_review(spot_id: str, body: ReviewIn, user: dict = Depends(get_current_user)):
    check_rate_limit("review_create", user["user_id"])
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    doc = {
        "review_id": f"rev_{uuid.uuid4().hex[:12]}",
        "spot_id": spot_id,
        "user_id": user["user_id"],
        **body.dict(),
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.spot_reviews.insert_one(doc)
    doc.pop("_id", None)
    # Notify the spot owner
    try:
        if spot.get("owner_user_id") and spot["owner_user_id"] != user["user_id"]:
            await send_push(
                [spot["owner_user_id"]],
                "New review",
                f"{user.get('name') or 'Someone'} reviewed “{(spot.get('title') or 'your spot')[:60]}”",
                {"type": "spot.review", "spot_id": spot_id, "review_id": doc["review_id"]},
            )
    except Exception:
        pass
    return doc


@api.post("/spots/{spot_id}/checkins")
async def create_checkin(spot_id: str, body: CheckinIn, user: dict = Depends(get_current_user)):
    check_rate_limit("checkin_create", user["user_id"])
    spot = await db.spots.find_one({"spot_id": spot_id})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    doc = {
        "checkin_id": f"chk_{uuid.uuid4().hex[:12]}",
        "spot_id": spot_id,
        "user_id": user["user_id"],
        **body.dict(),
        "created_at": utcnow(),
    }
    await db.spot_checkins.insert_one(doc)
    # Update last_verified_at
    await db.spots.update_one({"spot_id": spot_id}, {"$set": {"last_verified_at": utcnow()}})
    doc.pop("_id", None)
    return doc


# ============================================================================
# Reports
# ============================================================================
@api.post("/reports")
async def create_report(body: ReportIn, user: dict = Depends(get_current_user)):
    if body.reason not in REPORT_REASONS:
        raise HTTPException(status_code=400, detail=f"Invalid reason. Expected one of {sorted(REPORT_REASONS)}.")
    if body.target_type not in ("spot", "user", "review"):
        raise HTTPException(status_code=400, detail="Invalid target_type")
    check_rate_limit("report_create", user["user_id"])
    # Dedupe: don't create another pending report from the same user on the same target
    existing = await db.reports.find_one({
        "reporter_user_id": user["user_id"],
        "target_id": body.target_id,
        "status": "pending",
    })
    if existing:
        existing.pop("_id", None)
        return existing
    doc = {
        "report_id": f"rep_{uuid.uuid4().hex[:12]}",
        "reporter_user_id": user["user_id"],
        **body.dict(),
        "status": "pending",
        "created_at": utcnow(),
    }
    await db.reports.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/reports/reasons")
async def report_reasons():
    """Enumerate allowed report reasons with human labels for the mobile UI."""
    return [
        {"key": "not_a_location", "label": "Not a real location"},
        {"key": "unsafe", "label": "Unsafe or private property"},
        {"key": "inappropriate", "label": "Inappropriate content"},
        {"key": "spam", "label": "Spam or promotional"},
        {"key": "wrong_info", "label": "Incorrect information"},
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


@api.get("/me/trends")
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


@api.get("/me/dashboard")
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


# ============================================================================
# Admin — role system, audit trail, platform management
# ============================================================================
# Role hierarchy (higher level = more power). Used by require_role() to gate
# endpoints. Treat 'admin' on existing accounts as level 3 for BC.
ROLE_LEVELS = {
    "user": 0,
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
@api.get("/admin/pending")
async def admin_pending(user: dict = Depends(require_role("moderator"))):
    pending = await db.spots.find({"visibility_status": "pending_review"}, {"_id": 0}).to_list(200)
    return [public_spot_view(s, user) for s in pending]


@api.get("/admin/stats/recent-approvals")
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



@api.get("/admin/posts")
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


@api.delete("/admin/posts/{post_id}")
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


@api.post("/admin/posts/{post_id}/restore")
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


@api.post("/admin/spots/{spot_id}/approve")
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


@api.post("/admin/spots/{spot_id}/reject")
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


@api.get("/admin/reports")
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


class ReportResolveIn(BaseModel):
    action: str  # dismissed | removed | warned


@api.post("/admin/reports/{report_id}/resolve")
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


# =============================================================================
# Admin Dashboard — overview, users, audit, analytics, settings, notes
# =============================================================================

@api.get("/admin/overview")
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
            {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1},
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


@api.get("/admin/users")
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


@api.get("/admin/users/{user_id}")
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


class AdminUserPatch(BaseModel):
    plan: Optional[str] = None  # free | pro | elite | comp_pro | comp_elite | trial_pro | trial_elite
    role: Optional[str] = None  # user | moderator | support | admin | super_admin
    status: Optional[str] = None  # active | suspended
    verification_status: Optional[str] = None  # verified | none
    suspension_reason: Optional[str] = None
    comp_expiration: Optional[str] = None  # ISO date string or None to clear
    reason: Optional[str] = None  # audit-log note


VALID_PLANS = {"free", "pro", "elite", "comp_pro", "comp_elite", "trial_pro", "trial_elite", "suspended"}
VALID_ROLES = {"user", "moderator", "support", "admin", "super_admin"}
VALID_STATUSES = {"active", "suspended"}


@api.patch("/admin/users/{user_id}")
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


class AdminNoteIn(BaseModel):
    body: str
    pinned: bool = False


class AdminGrantPlanIn(BaseModel):
    plan: str  # pro | elite | comp_pro | comp_elite | trial_pro | trial_elite | free
    duration_days: Optional[int] = None  # 30 / 90 / 365 / None(=never expire)
    reason: Optional[str] = None


@api.post("/admin/users/{user_id}/grant-plan")
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


@api.post("/admin/users/{user_id}/notes")
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


@api.get("/admin/audit-logs")
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


@api.get("/admin/analytics")
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


@api.get("/admin/settings")
async def admin_get_settings(me: dict = Depends(require_role("admin"))):
    return await get_platform_settings()


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


@api.patch("/admin/settings")
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
        raise HTTPException(status_code=402, detail="Creating spot packs requires the Elite plan.")
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


@api.get("/me/packs")
async def my_packs(user: dict = Depends(get_current_user)):
    return await db.spot_packs.find({"creator_user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)


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
         "verification_status": 1, "plan": 1, "city": 1, "state": 1,
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


@api.get("/posts/{post_id}/comments")
async def list_comments(post_id: str):
    comments = await db.post_comments.find({"post_id": post_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    if not comments:
        return []
    uids = list({c["author_user_id"] for c in comments})
    users = await db.users.find(
        {"user_id": {"$in": uids}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1},
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
    # Notify the post author
    try:
        if p.get("author_id") and p["author_id"] != user["user_id"]:
            await send_push(
                [p["author_id"]],
                "New comment",
                f"{user.get('name') or 'Someone'} replied to “{(p.get('title') or 'your post')[:60]}”",
                {"type": "post.comment", "post_id": post_id, "comment_id": doc["comment_id"]},
            )
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
@api.get("/mentors")
async def list_mentors(
    specialty: Optional[str] = None,
    city: Optional[str] = None,
    limit: int = 50,
    user: dict = Depends(get_current_user),
):
    """List photographers offering mentorship. Excludes viewer + suspended."""
    q: Dict[str, Any] = {
        "mentorship_available": True,
        "user_id": {"$ne": user["user_id"]},
        "plan": {"$ne": "suspended"},
    }
    if specialty:
        q["specialties"] = specialty
    if city:
        q["city"] = city
    items = await db.users.find(
        q,
        {
            "_id": 0, "password_hash": 0,
        },
    ).sort([("verification_status", -1), ("created_at", -1)]).limit(min(limit, 100)).to_list(100)
    return {"count": len(items), "items": items}


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
@api.get("/me/reviews-received")
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
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1, "plan": 1},
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
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "city": 1, "verification_status": 1, "plan": 1, "specialties": 1},
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
class ConversationCreateIn(BaseModel):
    participant_user_id: str


@api.post("/conversations")
async def create_or_get_conversation(body: ConversationCreateIn, user: dict = Depends(get_current_user)):
    """Idempotent — returns existing 1:1 conversation if already created."""
    if body.participant_user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot DM yourself")
    target = await db.users.find_one({"user_id": body.participant_user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Recipient not found")
    ids = sorted([user["user_id"], body.participant_user_id])
    convo = await db.conversations.find_one({"participant_key": "|".join(ids)}, {"_id": 0})
    if convo:
        return convo
    convo = {
        "conversation_id": f"conv_{uuid.uuid4().hex[:12]}",
        "participant_user_ids": ids,
        "participant_key": "|".join(ids),
        "last_message": None,
        "last_message_at": utcnow(),
        "created_at": utcnow(),
    }
    await db.conversations.insert_one(convo)
    convo.pop("_id", None)
    return convo


@api.get("/me/conversations")
async def list_my_conversations(user: dict = Depends(get_current_user)):
    convos = await db.conversations.find(
        {"participant_user_ids": user["user_id"]}, {"_id": 0},
    ).sort("last_message_at", -1).to_list(100)
    # Attach other participant summary + unread count
    other_ids = []
    for c in convos:
        other = next((p for p in c["participant_user_ids"] if p != user["user_id"]), None)
        c["other_user_id"] = other
        other_ids.append(other)
    others = await db.users.find(
        {"user_id": {"$in": [o for o in other_ids if o]}},
        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1, "verification_status": 1},
    ).to_list(200)
    umap = {u["user_id"]: u for u in others}
    for c in convos:
        c["other"] = umap.get(c["other_user_id"])
        c["unread"] = await db.messages.count_documents({
            "conversation_id": c["conversation_id"],
            "sender_user_id": {"$ne": user["user_id"]},
            "read_by": {"$ne": user["user_id"]},
        })
    return convos


@api.get("/conversations/{conversation_id}/messages")
async def list_messages(conversation_id: str, user: dict = Depends(get_current_user)):
    convo = await db.conversations.find_one({"conversation_id": conversation_id})
    if not convo or user["user_id"] not in convo["participant_user_ids"]:
        raise HTTPException(status_code=404, detail="Not found")
    msgs = await db.messages.find({"conversation_id": conversation_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    # Mark all read by this viewer in one shot
    await db.messages.update_many(
        {"conversation_id": conversation_id, "sender_user_id": {"$ne": user["user_id"]}, "read_by": {"$ne": user["user_id"]}},
        {"$addToSet": {"read_by": user["user_id"]}},
    )
    return msgs


class MessageIn(BaseModel):
    body: str


@api.post("/conversations/{conversation_id}/messages")
async def send_message(conversation_id: str, body: MessageIn, user: dict = Depends(get_current_user)):
    check_rate_limit("review_create", user["user_id"])
    convo = await db.conversations.find_one({"conversation_id": conversation_id})
    if not convo or user["user_id"] not in convo["participant_user_ids"]:
        raise HTTPException(status_code=404, detail="Not found")
    if not body.body.strip():
        raise HTTPException(status_code=400, detail="Empty message")
    doc = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "conversation_id": conversation_id,
        "sender_user_id": user["user_id"],
        "body": body.body.strip()[:2000],
        "read_by": [user["user_id"]],
        "created_at": utcnow(),
    }
    await db.messages.insert_one(doc)
    await db.conversations.update_one(
        {"conversation_id": conversation_id},
        {"$set": {"last_message": doc["body"][:120], "last_message_at": doc["created_at"]}},
    )
    doc.pop("_id", None)
    return doc


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


@api.get("/spots/{spot_id}/astronomy")
async def spot_astronomy(spot_id: str, date: Optional[str] = None):
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "latitude": 1, "longitude": 1})
    if not spot or spot.get("latitude") is None or spot.get("longitude") is None:
        raise HTTPException(status_code=404, detail="Spot or coordinates not found")
    d: Optional[datetime] = None
    if date:
        try:
            d = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(status_code=400, detail="date must be ISO YYYY-MM-DD")
    return _compute_astronomy(spot["latitude"], spot["longitude"], d)


# ----------------------------------------------------------------------------
# Push notifications — Expo push tokens + sender helper
# ----------------------------------------------------------------------------

class PushTokenIn(BaseModel):
    token: str
    platform: Optional[str] = None   # "ios" | "android" | "web"
    device_id: Optional[str] = None


@api.post("/me/push-token")
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


@api.delete("/me/push-token")
async def unregister_push_token(token: str, user: dict = Depends(get_current_user)):
    await db.push_tokens.delete_one({"user_id": user["user_id"], "token": token})
    return {"ok": True}


async def send_push(user_ids: List[str], title: str, body: str, data: Optional[dict] = None):
    """Fire-and-forget push delivery via Expo's push API. Never raises."""
    if not user_ids:
        return
    try:
        import httpx
        tokens = await db.push_tokens.find(
            {"user_id": {"$in": list(set(user_ids))}},
            {"_id": 0, "token": 1},
        ).to_list(500)
        if not tokens:
            return
        messages = [
            {
                "to": t["token"],
                "sound": "default",
                "title": title[:120],
                "body": body[:240],
                "data": data or {},
                "priority": "high",
            }
            for t in tokens
        ]
        async with httpx.AsyncClient(timeout=8.0) as client_h:
            # Expo accepts up to 100 messages per call.
            for i in range(0, len(messages), 100):
                await client_h.post(
                    "https://exp.host/--/api/v2/push/send",
                    json=messages[i:i + 100],
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                )
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


@api.post("/spots/{spot_id}/shot-list")
async def spot_shot_list(spot_id: str, refresh: bool = False, user: dict = Depends(get_current_user)):
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    cache_key = f"shotlist:{spot_id}"
    if not refresh:
        cached = await db.ai_cache.find_one({"_id": cache_key})
        if cached and cached.get("expires_at"):
            exp = cached["expires_at"]
            # Motor may return tz-naive datetimes depending on BSON codec options;
            # normalise to UTC-aware before comparison.
            if isinstance(exp, datetime) and exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp > datetime.now(timezone.utc):
                return {"items": cached["items"], "cached": True, "cached_at": cached.get("created_at")}
    items = await _generate_shot_list(spot)
    now = datetime.now(timezone.utc)
    await db.ai_cache.update_one(
        {"_id": cache_key},
        {"$set": {
            "items": items,
            "created_at": now,
            "expires_at": now + timedelta(days=7),
            "spot_id": spot_id,
        }},
        upsert=True,
    )
    return {"items": items, "cached": False, "cached_at": now.isoformat()}


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
            return_url="https://lumascout.app/billing",
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
            uid = (obj.get("metadata") or {}).get("user_id")
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
            # The subscription.created event that follows will set plan/dates.

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

app.include_router(_scout_ai_routes.router)
app.include_router(_support_routes.router)
app.include_router(_super_admin_routes.router)
app.include_router(_brand_routes.router)
