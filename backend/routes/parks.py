"""
routes/parks.py — Park-Based Multi-Spot Workflow (Feature 3 · Phase 1).

Adds the lightweight "parent park" data model + supporting endpoints so a
photographer can group multiple individual photo spots under a single
larger park / preserve / venue / trail system and keep adding to it over
multiple sessions.

Why a separate collection (db.parks) instead of dual-role spots?
  • Cleaner queries: spot list filters never have to defend against
    accidentally pulling parent rows.
  • Easier merge / move / audit: park-level moderation actions don't
    risk touching child spots.
  • Denormalized `park_group_id` + `park_name` on each child spot keeps
    list/feed cards fast — no extra fetch needed at render time.

This module is ADDITIVE only. Existing spots without a `park_group_id`
behave exactly as before. The Add Spot flow opts a spot in by passing
`park_group_id` (Phase 2).

Endpoints (all prefixed with /api):
  • GET    /parks/search                  — fuzzy name + bbox proximity
  • POST   /parks                         — create a new parent park
  • POST   /parks/check-duplicates        — nearby same-name detection
  • GET    /parks/{park_id}               — detail w/ first 50 children
  • GET    /parks/{park_id}/children      — paginated children
  • PATCH  /parks/{park_id}               — owner or admin edit
  • GET    /me/park-session               — current active session
  • POST   /me/park-session               — start / refresh session
  • DELETE /me/park-session               — end session
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from server import (
    db,
    get_current_user,
    get_optional_user,
    utcnow,
    haversine_km,
    require_role,
    audit_log,
)

router = APIRouter(prefix="/api", tags=["parks"])


# ─── Helpers ──────────────────────────────────────────────────────────

_PARK_SESSION_TTL_HOURS = 24


def _normalize_name(s: Optional[str]) -> str:
    """Lowercase + strip non-alphanumeric for fuzzy duplicate matching."""
    if not s:
        return ""
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def _park_public_view(park: dict) -> dict:
    """Shape a park doc for clients. Drops mongo _id, normalizes timestamps."""
    park = dict(park)
    park.pop("_id", None)
    # Defensive: clamp counts to non-negative
    if isinstance(park.get("child_spot_count"), int) and park["child_spot_count"] < 0:
        park["child_spot_count"] = 0
    # Normalize datetime fields to ISO strings so this view is safe to
    # embed inside HTTPException(detail=...) JSON payloads.
    for k in ("created_at", "updated_at"):
        v = park.get(k)
        if isinstance(v, datetime):
            park[k] = v.isoformat()
    return park


async def _recompute_child_count(park_id: str) -> int:
    """Recompute and persist the child_spot_count for a park.

    Excludes deleted / rejected. Includes drafts so the owner sees the
    full count of their work-in-progress; public consumers can filter
    again on the spot list endpoints.
    """
    count = await db.spots.count_documents({
        "park_group_id": park_id,
        "visibility_status": {"$nin": ["deleted", "rejected"]},
    })
    await db.parks.update_one(
        {"park_id": park_id},
        {"$set": {"child_spot_count": int(count), "updated_at": utcnow()}},
    )
    return int(count)


async def _find_duplicate_candidates(
    name: str,
    latitude: float,
    longitude: float,
    radius_km: float = 1.5,
    limit: int = 5,
) -> List[dict]:
    """Find existing parks with a similar normalized name within radius_km.

    We over-fetch a bounded bbox first (cheap, indexed), then refine with
    haversine + normalized substring overlap so a user typing
    "Eisenhower Park" matches "Eisenhower Natural Area" only if they're
    physically nearby.
    """
    normalized = _normalize_name(name)
    if not normalized or len(normalized) < 3:
        return []

    # Rough degree window: ~111 km per degree latitude
    lat_window = radius_km / 111.0
    lng_window = radius_km / max(0.1, 111.0 * abs(__import__("math").cos(__import__("math").radians(latitude))))
    candidates = await db.parks.find(
        {
            "status": {"$ne": "merged_into"},
            "latitude": {"$gte": latitude - lat_window, "$lte": latitude + lat_window},
            "longitude": {"$gte": longitude - lng_window, "$lte": longitude + lng_window},
        },
        {"_id": 0},
    ).limit(50).to_list(50)

    hits: List[dict] = []
    for p in candidates:
        plat, plng = p.get("latitude"), p.get("longitude")
        if plat is None or plng is None:
            continue
        dist = haversine_km(latitude, longitude, plat, plng)
        if dist > radius_km:
            continue
        p_norm = _normalize_name(p.get("name", ""))
        if not p_norm:
            continue
        # Substring / prefix overlap (cheap fuzzy)
        overlap = normalized in p_norm or p_norm in normalized
        if not overlap:
            # Token-level overlap fallback (handles "Eisenhower Park" vs
            # "Eisenhower Natural Area"): if 1st 5 chars match, accept.
            if normalized[:5] != p_norm[:5]:
                continue
        p["_distance_km"] = round(dist, 3)
        hits.append(p)
        if len(hits) >= limit:
            break

    # Sort closer-first then by name length similarity
    hits.sort(key=lambda h: (h.get("_distance_km", 99.0), abs(len(_normalize_name(h.get("name", ""))) - len(normalized))))
    return [_park_public_view(h) for h in hits]


# ─── Pydantic models ──────────────────────────────────────────────────


class ParkCreateIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=160)
    address: Optional[str] = Field(None, max_length=240)
    city: Optional[str] = Field(None, max_length=120)
    state: Optional[str] = Field(None, max_length=80)
    country_code: Optional[str] = Field(None, max_length=4)
    latitude: float
    longitude: float
    description: Optional[str] = Field(None, max_length=4000)
    general_parking_notes: Optional[str] = Field(None, max_length=1500)
    general_permit_notes: Optional[str] = Field(None, max_length=1500)
    general_safety_notes: Optional[str] = Field(None, max_length=1500)
    general_access_notes: Optional[str] = Field(None, max_length=1500)
    # When the caller already saw the duplicate prompt and chose to
    # "Create new park anyway", they pass force=True to skip the
    # server-side soft-block on near-identical nearby parks.
    force_create: bool = False

    @field_validator("name")
    @classmethod
    def _trim_name(cls, v: str) -> str:
        v = (v or "").strip()
        if len(v) < 2:
            raise ValueError("Park name must be at least 2 characters.")
        return v

    @field_validator("latitude")
    @classmethod
    def _validate_lat(cls, v: float) -> float:
        if v is None or not (-90.0 <= v <= 90.0) or v == 0.0:
            raise ValueError("Latitude must be a valid coordinate (not 0).")
        return v

    @field_validator("longitude")
    @classmethod
    def _validate_lng(cls, v: float) -> float:
        if v is None or not (-180.0 <= v <= 180.0) or v == 0.0:
            raise ValueError("Longitude must be a valid coordinate (not 0).")
        return v


class ParkUpdateIn(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=160)
    address: Optional[str] = Field(None, max_length=240)
    city: Optional[str] = Field(None, max_length=120)
    state: Optional[str] = Field(None, max_length=80)
    country_code: Optional[str] = Field(None, max_length=4)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    description: Optional[str] = Field(None, max_length=4000)
    general_parking_notes: Optional[str] = Field(None, max_length=1500)
    general_permit_notes: Optional[str] = Field(None, max_length=1500)
    general_safety_notes: Optional[str] = Field(None, max_length=1500)
    general_access_notes: Optional[str] = Field(None, max_length=1500)


class ParkDuplicateCheckIn(BaseModel):
    name: str
    latitude: float
    longitude: float
    radius_km: float = Field(1.5, ge=0.1, le=10.0)


class ParkSessionIn(BaseModel):
    park_id: str
    park_name: Optional[str] = None
    last_added_spot_id: Optional[str] = None


# ─── Endpoints ────────────────────────────────────────────────────────


@router.get("/parks/search")
async def search_parks(
    q: Optional[str] = Query(None, description="Free-text query against park name / city / address."),
    near_lat: Optional[float] = Query(None),
    near_lng: Optional[float] = Query(None),
    radius_km: float = Query(50.0, ge=0.1, le=500.0),
    limit: int = Query(20, ge=1, le=50),
    user: Optional[dict] = Depends(get_optional_user),
) -> List[dict]:
    """Search parent parks. Returns small summary records.

    Behavior:
      • If `q` is provided, case-insensitive prefix-or-contains match on
        `name`, with secondary match on `city` for safety.
      • If `near_lat`/`near_lng` are provided, results are filtered to
        within `radius_km` and sorted closer-first.
      • If neither is provided, returns recently-active parks (highest
        child_spot_count first).
    """
    query: Dict[str, Any] = {"status": {"$ne": "merged_into"}}

    if q and q.strip():
        # Escape regex specials so user input is treated literally
        safe = re.escape(q.strip())
        query["$or"] = [
            {"name": {"$regex": safe, "$options": "i"}},
            {"city": {"$regex": safe, "$options": "i"}},
            {"address": {"$regex": safe, "$options": "i"}},
        ]

    if near_lat is not None and near_lng is not None:
        # Cheap bbox prefilter
        import math
        lat_window = radius_km / 111.0
        lng_window = radius_km / max(0.1, 111.0 * abs(math.cos(math.radians(near_lat))))
        query["latitude"] = {"$gte": near_lat - lat_window, "$lte": near_lat + lat_window}
        query["longitude"] = {"$gte": near_lng - lng_window, "$lte": near_lng + lng_window}

    docs = await db.parks.find(query, {"_id": 0}).limit(limit * 3).to_list(limit * 3)

    # Distance filter + sort
    if near_lat is not None and near_lng is not None:
        for d in docs:
            d["_distance_km"] = round(haversine_km(near_lat, near_lng, d["latitude"], d["longitude"]), 3)
        docs = [d for d in docs if d.get("_distance_km", 9999) <= radius_km]
        docs.sort(key=lambda d: d.get("_distance_km", 9999))
    else:
        docs.sort(key=lambda d: -(d.get("child_spot_count") or 0))

    return [_park_public_view(d) for d in docs[:limit]]


@router.post("/parks/check-duplicates")
async def parks_check_duplicates(body: ParkDuplicateCheckIn, user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Soft-check for near-identical parks before creation.

    Returns a list of candidate matches. Client should show
    "Is this the same park?" UI when len(matches) > 0.
    """
    matches = await _find_duplicate_candidates(body.name, body.latitude, body.longitude, body.radius_km)
    return {"matches": matches, "count": len(matches)}


@router.post("/parks")
async def create_park(body: ParkCreateIn, user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Create a new parent park record.

    Soft duplicate prevention: if a similar park exists within ~500m
    AND the caller didn't pass `force_create=True`, returns 409 with
    the candidate list so the client can prompt the user.
    """
    if not body.force_create:
        dupes = await _find_duplicate_candidates(body.name, body.latitude, body.longitude, radius_km=0.5)
        if dupes:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "duplicate_park_candidate",
                    "message": "A similar park already exists nearby.",
                    "matches": dupes,
                },
            )

    park_id = f"park_{uuid.uuid4().hex[:12]}"
    doc = {
        "park_id": park_id,
        "name": body.name,
        "address": body.address,
        "city": body.city,
        "state": body.state,
        "country_code": (body.country_code or "").upper() or None,
        "latitude": body.latitude,
        "longitude": body.longitude,
        "description": body.description,
        "general_parking_notes": body.general_parking_notes,
        "general_permit_notes": body.general_permit_notes,
        "general_safety_notes": body.general_safety_notes,
        "general_access_notes": body.general_access_notes,
        "created_by": user["user_id"],
        "status": "active",
        "child_spot_count": 0,
        "merged_into_park_id": None,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.parks.insert_one(doc)
    return _park_public_view(doc)


@router.get("/parks/{park_id}")
async def get_park(
    park_id: str,
    children_limit: int = Query(50, ge=0, le=200),
    viewer: Optional[dict] = Depends(get_optional_user),
) -> Dict[str, Any]:
    """Park detail page payload: park metadata + first N children.

    Follows merge redirects: if this park was merged into another,
    transparently returns the canonical park.
    """
    park = await db.parks.find_one({"park_id": park_id}, {"_id": 0})
    if not park:
        raise HTTPException(status_code=404, detail="Park not found")

    # Resolve merge chain (1 hop is enough — admin merge code prevents
    # cycles by setting merged_into_park_id to a non-merged park).
    if park.get("status") == "merged_into" and park.get("merged_into_park_id"):
        canonical = await db.parks.find_one({"park_id": park["merged_into_park_id"]}, {"_id": 0})
        if canonical:
            park = canonical

    # Fetch children — exclude hard-deleted, exclude private spots
    # owned by someone else.
    viewer_id = viewer.get("user_id") if viewer else None
    children_query: Dict[str, Any] = {
        "park_group_id": park["park_id"],
        "visibility_status": {"$nin": ["deleted", "rejected"]},
    }
    if viewer_id:
        children_query["$or"] = [
            {"privacy_mode": {"$ne": "private"}},
            {"owner_user_id": viewer_id},
        ]
    else:
        children_query["privacy_mode"] = {"$ne": "private"}

    children = await db.spots.find(
        children_query,
        {
            "_id": 0,
            "spot_id": 1,
            "title": 1,
            "latitude": 1,
            "longitude": 1,
            "best_time_of_day": 1,
            "privacy_mode": 1,
            "visibility_status": 1,
            "owner_user_id": 1,
            "images": 1,
            "admin_cover_override": 1,
            "shoot_types": 1,
            "created_at": 1,
            "park_group_id": 1,
            "park_name": 1,
        },
    ).sort("created_at", -1).limit(children_limit).to_list(children_limit)

    # Slim image shaping — hero cover only, base64 stays untouched
    for c in children:
        ov = c.pop("admin_cover_override", None) or {}
        hero = ov.get("image_url")
        if not hero:
            for im in (c.get("images") or []):
                if isinstance(im, dict) and im.get("is_cover") and im.get("image_url"):
                    hero = im["image_url"]
                    break
            if not hero:
                imgs = c.get("images") or []
                if imgs and isinstance(imgs[0], dict):
                    hero = imgs[0].get("image_url")
        c["hero_cover_image_url"] = hero
        c.pop("images", None)

    park = _park_public_view(park)
    park["children"] = children
    park["children_returned"] = len(children)
    # Save state — useful for the "Save park" toggle on the detail page.
    park["saved_count"] = await db.park_saves.count_documents({"park_id": park["park_id"]})
    if viewer_id:
        existing = await db.park_saves.find_one(
            {"user_id": viewer_id, "park_id": park["park_id"]},
            {"_id": 0},
        )
        park["is_saved"] = bool(existing)
    else:
        park["is_saved"] = False
    return park


@router.get("/parks/{park_id}/children")
async def list_park_children(
    park_id: str,
    cursor: Optional[str] = Query(None, description="ISO timestamp from last result for cursor pagination."),
    limit: int = Query(30, ge=1, le=100),
    viewer: Optional[dict] = Depends(get_optional_user),
) -> Dict[str, Any]:
    """Paginated children listing for /park/[id] page."""
    park = await db.parks.find_one({"park_id": park_id}, {"_id": 0, "park_id": 1, "status": 1, "merged_into_park_id": 1})
    if not park:
        raise HTTPException(status_code=404, detail="Park not found")
    canonical_id = park["park_id"]
    if park.get("status") == "merged_into" and park.get("merged_into_park_id"):
        canonical_id = park["merged_into_park_id"]

    viewer_id = viewer.get("user_id") if viewer else None
    q: Dict[str, Any] = {
        "park_group_id": canonical_id,
        "visibility_status": {"$nin": ["deleted", "rejected"]},
    }
    if viewer_id:
        q["$or"] = [{"privacy_mode": {"$ne": "private"}}, {"owner_user_id": viewer_id}]
    else:
        q["privacy_mode"] = {"$ne": "private"}
    if cursor:
        try:
            cur = datetime.fromisoformat(cursor.replace("Z", "+00:00"))
            q["created_at"] = {"$lt": cur}
        except Exception:
            pass

    children = await db.spots.find(q, {"_id": 0}).sort("created_at", -1).limit(limit + 1).to_list(limit + 1)
    next_cursor = None
    if len(children) > limit:
        last = children[limit - 1]
        ts = last.get("created_at")
        if isinstance(ts, datetime):
            next_cursor = ts.isoformat()
        children = children[:limit]

    return {"items": children, "next_cursor": next_cursor}


@router.patch("/parks/{park_id}")
async def update_park(park_id: str, body: ParkUpdateIn, user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Edit a park's metadata.

    Allowed: park creator, or anyone with role admin / super_admin.
    """
    park = await db.parks.find_one({"park_id": park_id}, {"_id": 0})
    if not park:
        raise HTTPException(status_code=404, detail="Park not found")
    role = (user.get("role") or "user").lower()
    if park["created_by"] != user["user_id"] and role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Only the park creator or an admin can edit this park.")

    patch: Dict[str, Any] = {}
    for k, v in body.dict(exclude_unset=True).items():
        if v is not None:
            patch[k] = v
    if not patch:
        return _park_public_view(park)
    patch["updated_at"] = utcnow()
    # If name changed, also update denormalized `park_name` on all children
    name_changed = "name" in patch and patch["name"] != park.get("name")

    await db.parks.update_one({"park_id": park_id}, {"$set": patch})
    if name_changed:
        await db.spots.update_many({"park_group_id": park_id}, {"$set": {"park_name": patch["name"]}})

    updated = await db.parks.find_one({"park_id": park_id}, {"_id": 0})
    return _park_public_view(updated)


# ─── Park Session ─────────────────────────────────────────────────────


@router.get("/me/park-session")
async def get_park_session(user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Return the user's active park session if non-expired."""
    sess = await db.park_sessions.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not sess:
        return {"session": None}
    exp = sess.get("expires_at")
    if isinstance(exp, datetime):
        exp_norm = exp if getattr(exp, "tzinfo", None) else exp.replace(tzinfo=timezone.utc)
        if exp_norm < utcnow():
            await db.park_sessions.delete_one({"user_id": user["user_id"]})
            return {"session": None}
    # Hydrate the park summary if it still exists
    park = await db.parks.find_one({"park_id": sess.get("active_park_id")}, {"_id": 0})
    if not park:
        await db.park_sessions.delete_one({"user_id": user["user_id"]})
        return {"session": None}
    if park.get("status") == "merged_into" and park.get("merged_into_park_id"):
        canon = await db.parks.find_one({"park_id": park["merged_into_park_id"]}, {"_id": 0})
        if canon:
            park = canon
            # Heal the session pointer
            await db.park_sessions.update_one(
                {"user_id": user["user_id"]},
                {"$set": {"active_park_id": canon["park_id"], "active_park_name": canon["name"]}},
            )
    return {
        "session": {
            "active_park_id": park["park_id"],
            "active_park_name": park["name"],
            "last_added_spot_id": sess.get("last_added_spot_id"),
            "last_activity_at": sess.get("last_activity_at"),
            "expires_at": sess.get("expires_at"),
        },
        "park": _park_public_view(park),
    }


@router.post("/me/park-session")
async def set_park_session(body: ParkSessionIn, user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Start or refresh the user's active park session.

    The session expires `_PARK_SESSION_TTL_HOURS` after the last
    refresh / spot-add. The frontend should call this:
      • after a successful child spot creation
      • when the user picks "Continue adding spots to X"
    """
    park = await db.parks.find_one({"park_id": body.park_id}, {"_id": 0})
    if not park:
        raise HTTPException(status_code=404, detail="Park not found")
    if park.get("status") == "merged_into" and park.get("merged_into_park_id"):
        canon = await db.parks.find_one({"park_id": park["merged_into_park_id"]}, {"_id": 0})
        if canon:
            park = canon

    now = utcnow()
    sess_doc = {
        "user_id": user["user_id"],
        "active_park_id": park["park_id"],
        "active_park_name": park["name"],
        "last_added_spot_id": body.last_added_spot_id,
        "last_activity_at": now,
        "expires_at": now + timedelta(hours=_PARK_SESSION_TTL_HOURS),
    }
    await db.park_sessions.update_one(
        {"user_id": user["user_id"]},
        {"$set": sess_doc},
        upsert=True,
    )
    return {
        "session": {
            "active_park_id": park["park_id"],
            "active_park_name": park["name"],
            "last_added_spot_id": body.last_added_spot_id,
            "last_activity_at": now,
            "expires_at": sess_doc["expires_at"],
        },
        "park": _park_public_view(park),
    }


@router.delete("/me/park-session")
async def end_park_session(user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """End the active park session immediately."""
    await db.park_sessions.delete_one({"user_id": user["user_id"]})
    return {"ok": True}


# ─── Save Park (Phase 3) ──────────────────────────────────────────────


@router.post("/parks/{park_id}/save")
async def save_park(park_id: str, user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Save a park to the user's library.

    Idempotent — re-saving an already-saved park is a no-op. Returns
    the canonical park_id (in case of merge redirect) and the current
    saved-count.
    """
    park = await db.parks.find_one({"park_id": park_id}, {"_id": 0})
    if not park:
        raise HTTPException(status_code=404, detail="Park not found")
    canon_id = park["park_id"]
    if park.get("status") == "merged_into" and park.get("merged_into_park_id"):
        canon = await db.parks.find_one({"park_id": park["merged_into_park_id"]}, {"_id": 0})
        if canon:
            canon_id = canon["park_id"]

    await db.park_saves.update_one(
        {"user_id": user["user_id"], "park_id": canon_id},
        {"$set": {"saved_at": utcnow()}},
        upsert=True,
    )
    saved_count = await db.park_saves.count_documents({"park_id": canon_id})
    return {"park_id": canon_id, "saved": True, "saved_count": saved_count}


@router.delete("/parks/{park_id}/save")
async def unsave_park(park_id: str, user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Remove a park from the user's library."""
    await db.park_saves.delete_one({"user_id": user["user_id"], "park_id": park_id})
    saved_count = await db.park_saves.count_documents({"park_id": park_id})
    return {"park_id": park_id, "saved": False, "saved_count": saved_count}


@router.get("/me/saved-parks")
async def list_my_saved_parks(
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """List parks the current user has saved (most recent first)."""
    saves = await db.park_saves.find({"user_id": user["user_id"]}, {"_id": 0}).sort("saved_at", -1).limit(limit).to_list(limit)
    park_ids = [s["park_id"] for s in saves]
    parks = await db.parks.find({"park_id": {"$in": park_ids}}, {"_id": 0}).to_list(len(park_ids))
    by_id = {p["park_id"]: _park_public_view(p) for p in parks}
    items = [by_id[pid] for pid in park_ids if pid in by_id]
    return {"items": items, "total": len(items)}


# ─── Admin operations (Phase 5) ────────────────────────────────────────


class AdminMoveChildIn(BaseModel):
    """Move a single child spot to a different parent park (or unparent)."""
    park_group_id: Optional[str] = None  # None / "" → unparent (standalone)


class AdminMergeParksIn(BaseModel):
    """Absorb `source_park_id` into `target_park_id`.

    All child spots are re-pointed to the target; the source park is
    marked status="merged_into" and saved against the target so any
    bookmarks / saves transparently follow.
    """
    target_park_id: str


@router.get("/admin/parks")
async def admin_list_parks(
    q: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    me: dict = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """List parks for the admin Parks tab.

    Returns active + merged-into parks (merged ones flagged so the UI
    can show them dimmed). Sortable by child_spot_count desc.
    """
    query: Dict[str, Any] = {}
    if q and q.strip():
        safe = re.escape(q.strip())
        query["$or"] = [
            {"name": {"$regex": safe, "$options": "i"}},
            {"city": {"$regex": safe, "$options": "i"}},
            {"address": {"$regex": safe, "$options": "i"}},
        ]
    docs = await db.parks.find(query, {"_id": 0}).sort([("status", 1), ("child_spot_count", -1), ("created_at", -1)]).limit(limit).to_list(limit)
    return {"items": [_park_public_view(d) for d in docs], "total": len(docs)}


@router.post("/admin/spots/{spot_id}/park")
async def admin_move_spot_park(
    spot_id: str,
    body: AdminMoveChildIn,
    me: dict = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Move a child spot from one park to another (or remove from a park).

    Bumps `child_spot_count` on the relevant park(s). Audit-logged.
    """
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")

    old_park_id: Optional[str] = spot.get("park_group_id")
    new_park_id: Optional[str] = (body.park_group_id or "").strip() or None
    new_park_name: Optional[str] = None

    if new_park_id:
        new_park = await db.parks.find_one({"park_id": new_park_id}, {"_id": 0})
        if not new_park:
            raise HTTPException(status_code=404, detail="Target park not found")
        # Follow 1 merge hop so we never point at a defunct record
        if new_park.get("status") == "merged_into" and new_park.get("merged_into_park_id"):
            canon = await db.parks.find_one({"park_id": new_park["merged_into_park_id"]}, {"_id": 0})
            if canon:
                new_park = canon
                new_park_id = canon["park_id"]
        new_park_name = new_park.get("name")

    # No-op short-circuit
    if (old_park_id or None) == (new_park_id or None):
        return {"ok": True, "spot_id": spot_id, "park_group_id": new_park_id, "noop": True}

    # Apply spot update
    update_set: Dict[str, Any] = {"updated_at": utcnow()}
    update_unset: Dict[str, Any] = {}
    if new_park_id:
        update_set["park_group_id"] = new_park_id
        update_set["park_name"] = new_park_name
    else:
        update_unset["park_group_id"] = ""
        update_unset["park_name"] = ""
    update_doc: Dict[str, Any] = {"$set": update_set}
    if update_unset:
        update_doc["$unset"] = update_unset
    await db.spots.update_one({"spot_id": spot_id}, update_doc)

    # Adjust counts
    if old_park_id:
        await db.parks.update_one(
            {"park_id": old_park_id},
            {"$inc": {"child_spot_count": -1}, "$set": {"updated_at": utcnow()}},
        )
    if new_park_id:
        await db.parks.update_one(
            {"park_id": new_park_id},
            {"$inc": {"child_spot_count": 1}, "$set": {"updated_at": utcnow()}},
        )

    await audit_log(
        me, "spot.move_park", "spot", spot_id,
        before={"park_group_id": old_park_id, "park_name": spot.get("park_name")},
        after={"park_group_id": new_park_id, "park_name": new_park_name},
        notes=f"admin re-parented spot {spot_id}",
    )

    return {
        "ok": True, "spot_id": spot_id,
        "park_group_id": new_park_id, "park_name": new_park_name,
        "old_park_id": old_park_id,
    }


@router.post("/admin/parks/{source_park_id}/merge")
async def admin_merge_parks(
    source_park_id: str,
    body: AdminMergeParksIn,
    me: dict = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Absorb the source park into the target park.

    • All child spots re-pointed to target (park_group_id + park_name updated).
    • Target's child_spot_count = recomputed.
    • Source park flipped to status="merged_into" with merged_into_park_id=target.
    • Park saves on the source are also rewritten to target (deduped).
    • Audit-logged.

    Idempotent against re-merging an already-merged source.
    """
    target_id = (body.target_park_id or "").strip()
    if not target_id or target_id == source_park_id:
        raise HTTPException(status_code=400, detail="target_park_id must differ from source_park_id")

    source = await db.parks.find_one({"park_id": source_park_id}, {"_id": 0})
    if not source:
        raise HTTPException(status_code=404, detail="Source park not found")
    target = await db.parks.find_one({"park_id": target_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Target park not found")

    # If target is itself merged, resolve it
    if target.get("status") == "merged_into" and target.get("merged_into_park_id"):
        canon = await db.parks.find_one({"park_id": target["merged_into_park_id"]}, {"_id": 0})
        if canon:
            target = canon
            target_id = canon["park_id"]
            if target_id == source_park_id:
                raise HTTPException(status_code=400, detail="Merge would create a loop")

    # Re-point children
    move_result = await db.spots.update_many(
        {"park_group_id": source_park_id},
        {"$set": {"park_group_id": target_id, "park_name": target.get("name"), "updated_at": utcnow()}},
    )
    moved = move_result.modified_count

    # Re-point saves (merge into target's save set; dedupe via upsert + delete)
    src_saves = await db.park_saves.find({"park_id": source_park_id}, {"_id": 0}).to_list(10_000)
    for s in src_saves:
        await db.park_saves.update_one(
            {"user_id": s["user_id"], "park_id": target_id},
            {"$setOnInsert": {"saved_at": s.get("saved_at") or utcnow()}},
            upsert=True,
        )
    await db.park_saves.delete_many({"park_id": source_park_id})

    # Flip source status
    await db.parks.update_one(
        {"park_id": source_park_id},
        {"$set": {
            "status": "merged_into",
            "merged_into_park_id": target_id,
            "updated_at": utcnow(),
        }},
    )

    # Recompute target count (cheaper + safer than incremental)
    new_count = await db.spots.count_documents({
        "park_group_id": target_id,
        "visibility_status": {"$nin": ["deleted", "rejected"]},
    })
    await db.parks.update_one(
        {"park_id": target_id},
        {"$set": {"child_spot_count": int(new_count), "updated_at": utcnow()}},
    )

    # Heal any park sessions still pointing at the source so users on
    # the field don't see "Continue adding spots to <deleted park>".
    await db.park_sessions.update_many(
        {"active_park_id": source_park_id},
        {"$set": {
            "active_park_id": target_id,
            "active_park_name": target.get("name"),
        }},
    )

    await audit_log(
        me, "park.merge", "park", source_park_id,
        before={"name": source.get("name"), "status": source.get("status", "active"), "child_spot_count": source.get("child_spot_count", 0)},
        after={"merged_into_park_id": target_id, "moved_spots": moved, "target_name": target.get("name")},
        notes=f"merged into {target_id}",
    )

    return {
        "ok": True,
        "source_park_id": source_park_id,
        "target_park_id": target_id,
        "moved_spots": moved,
        "moved_saves": len(src_saves),
        "target_child_spot_count": int(new_count),
    }


@router.delete("/admin/parks/{park_id}")
async def admin_delete_park(
    park_id: str,
    me: dict = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Soft-delete a park (status="hidden").

    Refuses if the park still has children — admin must move them first
    or merge. Use the merge endpoint to absorb into another park
    instead of deletion when in doubt.
    """
    park = await db.parks.find_one({"park_id": park_id}, {"_id": 0})
    if not park:
        raise HTTPException(status_code=404, detail="Park not found")
    children = await db.spots.count_documents({
        "park_group_id": park_id,
        "visibility_status": {"$nin": ["deleted", "rejected"]},
    })
    if children > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete park with {children} active child spot(s). Move or merge them first.",
        )
    await db.parks.update_one(
        {"park_id": park_id},
        {"$set": {"status": "hidden", "updated_at": utcnow()}},
    )
    await db.park_saves.delete_many({"park_id": park_id})
    await db.park_sessions.delete_many({"active_park_id": park_id})
    await audit_log(
        me, "park.delete", "park", park_id,
        before={"name": park.get("name"), "status": park.get("status", "active")},
        after={"status": "hidden"},
    )
    return {"ok": True, "park_id": park_id, "status": "hidden"}
