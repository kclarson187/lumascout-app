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
from typing import List, Optional, Any

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

# ============================================================================
# Setup
# ============================================================================
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("photoscout")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@photoscout.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
JWT_ALGO = "HS256"
ACCESS_TOKEN_DAYS = 30

# Plan feature gating
PLAN_LIMITS = {
    "free": {"saves": 20, "private_spots": 3, "collections": 3, "advanced_filters": False, "sell_packs": False},
    "pro": {"saves": 10_000, "private_spots": 10_000, "collections": 500, "advanced_filters": True, "sell_packs": False},
    "elite": {"saves": 10_000, "private_spots": 10_000, "collections": 10_000, "advanced_filters": True, "sell_packs": True},
}


def plan_of(user: dict) -> str:
    return (user or {}).get("plan") or "free"


def limits_for(user: dict) -> dict:
    return PLAN_LIMITS.get(plan_of(user), PLAN_LIMITS["free"])


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

app = FastAPI(title="PhotoScout API")
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
    username = email.split("@")[0]
    doc = {
        "user_id": user_id,
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name,
        "username": username,
        "avatar_url": None,
        "bio": "",
        "city": "",
        "state": "",
        "specialties": body.specialties or [],
        "website": "",
        "instagram": "",
        "role": "user",
        "verification_status": "unverified",
        "auth_provider": "email",
        "plan": "free",
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
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user["user_id"], email)
    return {"token": token, "user": clean_doc(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    user["plan"] = plan_of(user)
    user["limits"] = limits_for(user)
    # live counts
    user["usage"] = {
        "saves": await db.spot_saves.count_documents({"user_id": user["user_id"]}),
        "private_spots": await db.spots.count_documents({
            "owner_user_id": user["user_id"],
            "privacy_mode": {"$in": ["private", "followers", "invite_only"]},
        }),
        "collections": await db.collections.count_documents({"owner_user_id": user["user_id"]}),
    }
    return user


class UpgradeIn(BaseModel):
    plan: str  # free | pro | elite


@api.post("/me/upgrade")
async def upgrade_plan(body: UpgradeIn, user: dict = Depends(get_current_user)):
    if body.plan not in PLAN_LIMITS:
        raise HTTPException(status_code=400, detail="Unknown plan")
    # NOTE: billing is not wired yet; this is a preview toggle until Stripe ships.
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"plan": body.plan, "updated_at": utcnow()}})
    return {"ok": True, "plan": body.plan, "limits": PLAN_LIMITS[body.plan]}


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
            "bio": "",
            "city": "",
            "state": "",
            "specialties": [],
            "website": "",
            "instagram": "",
            "role": "user",
            "verification_status": "unverified",
            "auth_provider": "google",
            "plan": "free",
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
    is_following = False
    if viewer:
        is_following = await db.follows.count_documents({"follower_user_id": viewer["user_id"], "followed_user_id": user_id}) > 0
    user["stats"] = {"spots": spots_count, "followers": followers, "following": following}
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
        {"privacy_mode": {"$in": ["public", "premium"]}, "visibility_status": "approved"},
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

    doc = body.dict()
    doc.pop("images", None)
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
    await db.spots.insert_one(doc)
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
    q: Optional[str] = None,
    sort: str = "recent",  # recent, trending, golden_hour, score
    limit: int = 40,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    query: dict = {
        "privacy_mode": {"$in": ["public", "premium"]},
        "visibility_status": "approved",
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
    query = {"privacy_mode": {"$in": ["public", "premium"]}, "visibility_status": "approved"}
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
async def home_feed(viewer: Optional[dict] = Depends(get_optional_user)):
    base_query = {"privacy_mode": {"$in": ["public", "premium"]}, "visibility_status": "approved"}
    all_spots = await db.spots.find(base_query, {"_id": 0}).to_list(500)
    scored = []
    for s in all_spots:
        v = public_spot_view(s, viewer)
        if v:
            scored.append(v)

    # Batch-attach owner info once across ALL buckets since the same objects are
    # referenced in multiple sorted slices below.
    await attach_owners(scored)

    # Nearby (if we don't have user location, pick random by default — use Austin TX center)
    center_lat, center_lng = 30.2672, -97.7431
    if viewer and viewer.get("city"):
        # try to find a spot in their city first
        for s in scored:
            if s["city"].lower() == (viewer.get("city") or "").lower():
                center_lat, center_lng = s["latitude"], s["longitude"]
                break

    nearby_list = sorted(
        scored,
        key=lambda s: haversine_km(center_lat, center_lng, s["latitude"], s["longitude"]),
    )[:10]

    trending = sorted(scored, key=lambda s: s["shoot_score"] + len(s.get("images", [])) * 2, reverse=True)[:10]
    golden = sorted(scored, key=lambda s: (s.get("morning_golden_hour_rating", 0) + s.get("evening_golden_hour_rating", 0)), reverse=True)[:10]
    recent = sorted(scored, key=lambda s: s.get("created_at") or utcnow(), reverse=True)[:10]

    best_for_you = []
    if viewer and viewer.get("specialties"):
        specs = set(viewer["specialties"])
        best_for_you = [s for s in scored if set(s.get("shoot_types", [])) & specs][:10]

    following_feed = []
    if viewer:
        follow_rows = await db.follows.find({"follower_user_id": viewer["user_id"]}, {"_id": 0}).to_list(200)
        followed_ids = [r["followed_user_id"] for r in follow_rows]
        if followed_ids:
            following_feed = [s for s in scored if s["owner_user_id"] in followed_ids][:10]

    # Seasonal (highest shade / best recent)
    current_month = datetime.now().strftime("%B")
    seasonal = [s for s in scored if current_month in s.get("best_months", [])][:10]
    if not seasonal:
        seasonal = sorted(scored, key=lambda s: s.get("variety_rating", 0), reverse=True)[:10]

    return {
        "nearby": nearby_list,
        "trending": trending,
        "golden_hour": golden,
        "recent": recent,
        "best_for_you": best_for_you,
        "following": following_feed,
        "seasonal": seasonal,
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
    return {"ok": True}


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
    return {"saved": True}


@api.get("/me/saved")
async def my_saves(user: dict = Depends(get_current_user)):
    saves = await db.spot_saves.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    spot_ids = [s["spot_id"] for s in saves]
    spots = await db.spots.find({"spot_id": {"$in": spot_ids}}, {"_id": 0}).to_list(500)
    spot_map = {s["spot_id"]: public_spot_view(s, user) for s in spots}
    return [spot_map[sid] for sid in spot_ids if sid in spot_map and spot_map[sid]]


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
    cols = await db.collections.find({"owner_user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Attach preview images
    for c in cols:
        previews = []
        for sid in (c.get("spot_ids") or [])[:4]:
            s = await db.spots.find_one({"spot_id": sid}, {"_id": 0, "images": 1})
            if s and s.get("images"):
                cover = next((i for i in s["images"] if i.get("is_cover")), s["images"][0])
                previews.append(cover["image_url"])
        c["previews"] = previews
        c["count"] = len(c.get("spot_ids") or [])
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
    "app_name": "PhotoScout",
    "support_email": "support@photoscout.app",
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
async def admin_pending(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    pending = await db.spots.find({"visibility_status": "pending_review"}, {"_id": 0}).to_list(200)
    return [public_spot_view(s, user) for s in pending]


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
async def admin_reports(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
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
    page: int = 1,
    limit: int = 25,
    user: dict = Depends(require_role("support")),
):
    """Paginated + filterable user search for the admin users table."""
    limit = max(1, min(100, limit))
    page = max(1, page)
    query: dict = {}
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
    return {"app": "PhotoScout", "status": "ok"}


app.include_router(api)

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
    await seed_admin()
    # Promote the seeded admin to super_admin for Phase 1 — creates a usable
    # platform owner. Idempotent: skipped if already super_admin.
    await db.users.update_one(
        {"email": ADMIN_EMAIL, "role": {"$ne": "super_admin"}},
        {"$set": {"role": "super_admin"}},
    )
    await seed_demo_content()
    await backfill_freshness()


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
            "name": "PhotoScout Admin",
            "username": "admin",
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


# ----------------------------------------------------------------------------
# Demo content
# ----------------------------------------------------------------------------
DEMO_PHOTOGRAPHERS = [
    {"email": "sophie@photoscout.app", "name": "Sophie Reyes", "username": "sophiereyes",
     "avatar_url": "https://images.unsplash.com/photo-1697063882499-f7fca7d2d713?w=400&q=80",
     "bio": "Family & senior photographer — hill country golden hour specialist.",
     "city": "Austin", "state": "TX", "specialties": ["Family", "Seniors"], "verification_status": "verified"},
    {"email": "marco@photoscout.app", "name": "Marco Alvarez", "username": "marcoalvarez",
     "avatar_url": "https://images.unsplash.com/photo-1582070595814-fe36a8d39532?w=400&q=80",
     "bio": "Wedding + engagement. Chasing light across Texas since 2014.",
     "city": "San Antonio", "state": "TX", "specialties": ["Wedding", "Portrait"], "verification_status": "verified"},
    {"email": "priya@photoscout.app", "name": "Priya Chen", "username": "priyachen",
     "avatar_url": "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&q=80",
     "bio": "Pet photography. Yes, your dog IS the moment.",
     "city": "Dallas", "state": "TX", "specialties": ["Pet", "Lifestyle"], "verification_status": "verified"},
    {"email": "jordan@photoscout.app", "name": "Jordan Blake", "username": "jordanblake",
     "avatar_url": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80",
     "bio": "Urban and editorial. Shadows > sunshine.",
     "city": "Houston", "state": "TX", "specialties": ["Urban", "Branding"], "verification_status": "unverified"},
    {"email": "lena@photoscout.app", "name": "Lena Okafor", "username": "lenaokafor",
     "avatar_url": "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&q=80",
     "bio": "Nature, wildflowers, and slow photography.",
     "city": "Fredericksburg", "state": "TX", "specialties": ["Nature", "Portrait"], "verification_status": "verified"},
]

DEMO_SPOTS = [
    {
        "title": "Bluebonnet Fields at Muleshoe Bend",
        "description": "A sprawling sea of bluebonnets every spring, backed by Lake Travis and twisted live oaks. Best at first or last light.",
        "city": "Spicewood", "state": "TX", "latitude": 30.5225, "longitude": -98.0017,
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
    count = await db.users.count_documents({"email": {"$regex": "@photoscout.app$"}})
    if count >= len(DEMO_PHOTOGRAPHERS):
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

    for i, sp in enumerate(DEMO_SPOTS):
        owner = photographer_ids[i % len(photographer_ids)]
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
            "country": "USA",
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


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
