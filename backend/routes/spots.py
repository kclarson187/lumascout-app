"""
routes/spots.py — Spots core domain.

Phase 3 of the server.py modularization. The largest and highest-risk
extraction: 25 endpoints + 7 request models + 1 small helper covering:
  • Spot CRUD (create, read, list, delete, nearby search, duplicate-check)
  • Community uploads + reactions + spot updates
  • Save / unsave toggle (with trending_spot fanout at the 4th save)
  • Reviews + checkins
  • Draft publish + my_spots + my_saved
  • Collections (create/list/add/get)
  • Astronomy + shot-list generation (spot-scoped LLM calls)

Core shaping + moderation helpers STAY in server.py (cross-domain):
  • public_spot_view — used by admin + feed + marketplace
  • _apply_moderation — used by admin community moderation
  • _recompute_spot_freshness — used by admin upload-moderate path
  • _can_auto_approve — spot auto-approval logic
  • _hydrate_contributors, _compute_astronomy, _generate_shot_list — services
  • send_growth_push, _emit_notification, send_push — push dispatch
  • haversine_km — geo math
  • limits_for, plan_of — plan limits
  • check_rate_limit — rate limiter

PRESERVED SEMANTICS — no behaviour change, no path change. Every endpoint
was moved verbatim from server.py.
"""
from __future__ import annotations

import uuid
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Query, Header
from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict
from pymongo.errors import DocumentTooLarge

from server import (
    raise_paywall,
    db,
    get_current_user, get_optional_user,
    utcnow,
    # Constants
    ALLOWED_CONDITION_TAGS,
    # Models kept in server.py (cross-domain)
    CheckinIn, ReviewIn,
    # Spot domain helpers that stay shared
    public_spot_view,
    _recompute_spot_freshness,
    _can_auto_approve,
    _hydrate_contributors,
    _compute_astronomy,
    _generate_shot_list,
    # Push infra
    _emit_notification,
    send_growth_push,
    send_push,
    # Utilities
    check_rate_limit,
    haversine_km,
    limits_for,
    attach_owners,
    attach_sample_photos,
)

router = APIRouter(prefix="/api", tags=["spots"])


# --- SpotImageIn (server.py:487-490) ---
class SpotImageIn(BaseModel):
    image_url: str  # base64 data URL or remote URL
    caption: Optional[str] = None
    is_cover: bool = False

# --- SpotCreateIn (server.py:493-606) ---
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
    # FIX(UX cleanup #2): free-text "Best light notes" replacing the old
    # multi-option time-of-day chip. Optional, capped to 240 chars.
    best_light_notes: Optional[str] = Field(default=None, max_length=240)
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
    # FIX(2026-05): Camera-capture provenance → "On-Site Verified" badge.
    # `capture_source` is one of 'camera_capture' | 'gallery_upload' |
    # 'manual_entry'. When camera_capture + gps_accuracy_m <= 100 we set
    # `on_site_verified = True` and surface the badge in the UI.
    capture_source: Optional[str] = None
    captured_at: Optional[str] = None
    gps_accuracy_m: Optional[float] = None
    gps_heading: Optional[float] = None
    gps_altitude_m: Optional[float] = None
    on_site_verified: Optional[bool] = None
    # FIX(2026-04): [1.2] freeform photographer notes captured on the Ratings step.
    # Max 2000 chars, stripped, stored as null if empty after strip.
    notes: Optional[str] = None
    # FIX(2026-04 / Item #1): Land access — required disclosure for trust
    # & responsible sharing. One of: 'public' | 'private' | 'unsure'.
    # Optional `access_notes` lets owners share permission/permit details
    # (esp. for private-land spots).
    land_access: Optional[str] = None  # public | private | unsure
    access_notes: Optional[str] = None

    @field_validator("land_access")
    @classmethod
    def _validate_land_access(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip().lower()
        if v not in ("public", "private", "unsure"):
            raise ValueError("Land access must be 'public', 'private', or 'unsure'.")
        return v

    @field_validator("access_notes")
    @classmethod
    def _validate_access_notes(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) > 1000:
            raise ValueError("Access notes must be 1000 characters or fewer.")
        return v

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
    # --- Park grouping (Feature 3 · Phase 1) -------------------------
    # When present, this spot is a child of a parent park record in
    # `db.parks`. `park_name` is denormalized so cards / list endpoints
    # don't need an extra fetch. Both are optional; standalone spots
    # leave them null.
    park_group_id: Optional[str] = None
    park_name: Optional[str] = Field(default=None, max_length=160)

# --- CollectionIn (server.py:628-631) ---
class CollectionIn(BaseModel):
    name: str
    description: Optional[str] = ""
    privacy_mode: str = "private"

# --- CollectionAddIn (server.py:634-635) ---
class CollectionAddIn(BaseModel):
    spot_id: str

# --- SpotUploadImageIn (server.py:1965-1967) ---
class SpotUploadImageIn(BaseModel):
    image_url: str  # base64 data URL or remote URL
    caption: Optional[str] = None
    # May 2026: R2 object key (e.g. "uploads/2026/05/<uuid>.jpg" — or
    # for the new organized layout,
    # "locations/{slug}_{spot_id}/gallery/<uuid>.jpg") so we can re-sign
    # or rewrite to a new public domain later, AND so the admin delete
    # path can call storage_r2.delete_object on the exact stored key
    # without trying to reconstruct it from the URL.
    # Legacy clients / local-disk uploads leave this null — perfectly fine.
    storage_key: Optional[str] = None
    # May 2026 (organized R2 layout) — additional metadata returned by
    # POST /api/uploads/image. Persisting these alongside the upload
    # row gives admin tooling a single source of truth for size/dim
    # without re-fetching bytes, and gives debug surfaces a stable
    # `image_id` to reference. All optional for backwards-compat.
    image_id: Optional[str] = None
    content_type: Optional[str] = None
    size_bytes: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None

# --- SpotCommunityUploadIn (server.py:1970-2003) ---
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

# --- SpotUpdateIn (server.py:2006-2033) ---
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

# --- _upload_to_public_view (server.py:2049-2053) ---
def _upload_to_public_view(doc: dict) -> dict:
    """Strip _id + compute public shape."""
    doc = dict(doc)
    doc.pop("_id", None)
    return doc

# ─────────────────────────────────────────────────────────────────────
# Explore Speed CR — Batch 1 (June 2025): lightweight markers endpoint.
# Map view consumes this instead of /spots so cold-start payload drops
# from ~80 KB → ~6 KB per 200 spots. Only the fields a marker needs
# are returned: spot_id, title, lat, lng, category, thumb_url,
# is_premium, is_hidden_gem, score. NO descriptions, NO image arrays,
# NO comments, NO analytics blobs.
#
# IMPORTANT: This handler MUST be declared BEFORE @router.get("/spots/
# {spot_id}") because FastAPI matches routes in declaration order — if
# /{spot_id} were declared first, GET /spots/markers would match
# spot_id="markers" and return 404 from get_spot.
# ─────────────────────────────────────────────────────────────────────
@router.get("/spots/markers")
async def list_spot_markers(
    # Geo bbox filter — when supplied, only return markers within the
    # rectangular viewport. This is the single biggest perf win for
    # zoomed-in map views.
    sw_lat: Optional[float] = None,
    sw_lng: Optional[float] = None,
    ne_lat: Optional[float] = None,
    ne_lng: Optional[float] = None,
    # Optional category / type filter for the same family of niche
    # filters Explore supports (passes through to query).
    category: Optional[str] = None,
    shoot_type: Optional[str] = None,
    # Hard cap kept at 500 since these payloads are tiny.
    limit: int = 500,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    limit = max(1, min(500, int(limit or 500)))
    query: dict = {
        "privacy_mode": {"$in": ["public", "premium"]},
        "visibility_status": "approved",
        "is_test_data": {"$ne": True},
    }
    if category:
        query["category"] = category
    if shoot_type:
        query["shoot_types"] = shoot_type
    # Geo bbox using the compound (latitude, longitude) index.
    if (sw_lat is not None and sw_lng is not None
            and ne_lat is not None and ne_lng is not None):
        try:
            lat_lo, lat_hi = sorted([float(sw_lat), float(ne_lat)])
            lng_lo, lng_hi = sorted([float(sw_lng), float(ne_lng)])
            query["latitude"] = {"$gte": lat_lo, "$lte": lat_hi}
            query["longitude"] = {"$gte": lng_lo, "$lte": lng_hi}
        except Exception:
            pass

    # Project ONLY the fields a marker needs. Excludes description,
    # images[] beyond the first, comments, analytics, owner blob.
    projection = {
        "_id": 0,
        "spot_id": 1,
        "title": 1,
        "latitude": 1,
        "longitude": 1,
        "category": 1,
        "shoot_types": 1,
        "is_premium": 1,
        "is_hidden_gem": 1,
        "shoot_score": 1,
        "quality_score": 1,
        "privacy_mode": 1,
        # Surface the FIRST image URL only as `thumb_url` so the marker
        # callout can preview a tiny thumbnail without us shipping the
        # full images[] payload.
        "images": {"$slice": 1},
        "owner_user_id": 1,
        # CR May 2026 — also surface admin-pinned/legacy cover fields so
        # the markers endpoint never returns thumb_url=None when a spot
        # genuinely has a cover. Previously we only looked at images[0],
        # which missed spots whose primary cover lived at the top level
        # (rotation pin, legacy import, hero override).
        "hero_cover_image_url": 1,
        "cover_image_url": 1,
        "card_url": 1,
        "image_url": 1,
    }
    rows = await db.spots.find(query, projection).limit(limit).to_list(limit)
    out = []
    # v2.0.24 continuation — Cover-Image Source-of-Truth CR (2026-05).
    # Track spots that have NO primary cover so we can do a SINGLE
    # batch query against spot_community_uploads at the end. For a
    # location like McAllister Park where the admin hasn't uploaded
    # primary images but 5 community photographers have, the map
    # preview must still surface their shots — not a placeholder.
    # One aggregate call is O(1) regardless of marker count.
    missing_cover_ids: list[str] = []
    missing_cover_indices: dict[str, int] = {}
    for s in rows:
        first_img = (s.get("images") or [{}])[0] if s.get("images") else {}
        # Cascade priority (mirror of frontend resolveSpotCover):
        # 1) admin-pinned hero  2) legacy cover  3) legacy card/image
        # 4) images[0].thumb→card→image  Avoid base64 data URIs over
        # the wire — they bloat the markers payload (some legacy spots
        # have multi-MB data: URLs which would crash slow connections).
        def _safe(u):
            if not isinstance(u, str) or not u:
                return None
            if u.startswith("data:"):
                return None  # too large for a markers feed
            return u
        thumb_url = (
            _safe(s.get("hero_cover_image_url"))
            or _safe(s.get("cover_image_url"))
            or _safe(s.get("card_url"))
            or _safe(s.get("image_url"))
        )
        if not thumb_url and isinstance(first_img, dict):
            thumb_url = (
                _safe(first_img.get("thumb_url"))
                or _safe(first_img.get("card_url"))
                or _safe(first_img.get("image_url"))
            )
        # v2.0.24 — route every thumb_url through /api/img?w=280 so the
        # markers payload ships RESIZED URLs to the client. This drops
        # per-thumbnail bytes from ~500 KB (Pexels at ?w=1200) or ~4 MB
        # (raw user upload) down to ~16-25 KB. Combined with 7-day
        # immutable client cache, a 2-minute explore session drops from
        # ~379 MB (v2.0.22 measured) to well under 15 MB.
        if thumb_url:
            try:
                from urllib.parse import quote as _urlquote
                thumb_url = f"/api/img?u={_urlquote(thumb_url, safe='')}&w=280&q=70"
            except Exception:
                pass  # keep raw URL on quote failure — belt-and-suspenders
        else:
            # Cover-Image Source-of-Truth CR — track for batch community-
            # upload fallback query below. Position index = len(out).
            sid_for_fallback = s.get("spot_id")
            if sid_for_fallback:
                missing_cover_indices[sid_for_fallback] = len(out)
                missing_cover_ids.append(sid_for_fallback)
        out.append({
            "spot_id": s.get("spot_id"),
            "title": s.get("title"),
            "lat": s.get("latitude"),
            "lng": s.get("longitude"),
            "category": s.get("category"),
            "shoot_types": s.get("shoot_types") or [],
            "is_premium": bool(s.get("is_premium")) or s.get("privacy_mode") == "premium",
            "is_hidden_gem": bool(s.get("is_hidden_gem")),
            "score": s.get("shoot_score") or s.get("quality_score") or 0,
            "thumb_url": thumb_url,
        })

    # Cover-Image Source-of-Truth CR (2026-05) — community-upload fallback.
    # ────────────────────────────────────────────────────────────────────
    # For every spot that still has thumb_url=None (admin uploaded no
    # primary cover / images[]), fall back to the OLDEST approved
    # community upload. One aggregate query for all such spots —
    # O(1) regardless of marker count. Preserves single-source-of-truth
    # with the detail page, which now does the same cascade.
    if missing_cover_ids:
        try:
            cu_pipeline = [
                {"$match": {
                    "spot_id": {"$in": missing_cover_ids},
                    "moderation_status": "approved",
                    "image_url": {"$nin": [None, ""]},
                }},
                {"$sort": {"created_at": 1}},
                {"$group": {
                    "_id": "$spot_id",
                    "image_url": {"$first": "$image_url"},
                }},
            ]
            async for doc in db.spot_community_uploads.aggregate(cu_pipeline):
                sid = doc.get("_id")
                url = doc.get("image_url")
                idx = missing_cover_indices.get(sid)
                if idx is None or not url or not isinstance(url, str):
                    continue
                if url.startswith("data:"):
                    continue
                try:
                    from urllib.parse import quote as _urlquote
                    out[idx]["thumb_url"] = f"/api/img?u={_urlquote(url, safe='')}&w=280&q=70"
                except Exception:
                    out[idx]["thumb_url"] = url
        except Exception:
            # Non-fatal — markers still render, just without community
            # fallback thumbs for spots with no admin-uploaded primary.
            pass
    return {"items": out, "count": len(out)}


# --- check_duplicates (server.py:1153-1189) ---
@router.get("/spots/check-duplicates")
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

# --- create_spot (server.py:1192-1253) ---
@router.post("/spots")
async def create_spot(body: SpotCreateIn, user: dict = Depends(get_current_user)):
    check_rate_limit("spot_create", user["user_id"])
    # FIX(membership conversion update): Free tier total upload cap.
    # Drafts don't count — drafts are owner-only and shouldn't punish
    # exploration. Once a user moves a draft to public/private, the
    # outgoing count goes up. The error message includes the word
    # 'upload' so the global UpgradeGateModal can route to the
    # 'uploads' reason and show the right upsell copy.
    if not body.save_as_draft:
        upload_limits = limits_for(user)
        max_uploads = upload_limits.get("max_uploads", 10_000)
        if max_uploads < 10_000:  # only enforce on Free / suspended
            existing_uploads = await db.spots.count_documents({
                "owner_user_id": user["user_id"],
                "visibility_status": {"$ne": "draft"},
            })
            if existing_uploads >= max_uploads:
                raise_paywall(
                    "uploads",
                    f"Free plan allows {max_uploads} uploaded spots. Upgrade to Pro for unlimited uploads.",
                    target_plan="pro",
                )
    # Feature gating: free plan can only create 3 private/followers/invite_only spots
    if body.privacy_mode in ("private", "followers", "invite_only"):
        limits = limits_for(user)
        current = await db.spots.count_documents({
            "owner_user_id": user["user_id"],
            "privacy_mode": {"$in": ["private", "followers", "invite_only"]},
        })
        if current >= limits["private_spots"]:
            raise_paywall(
                "private",
                f"Free plan limit reached ({limits['private_spots']} private spots). Upgrade to Pro for unlimited.",
                target_plan="pro",
            )
    # Elite-only: premium (sellable) spots
    if body.privacy_mode == "premium" and not limits_for(user)["sell_packs"]:
        raise_paywall(
            "uploads",
            "Premium spots require the Elite plan. Upgrade to publish sellable locations.",
            target_plan="elite",
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

    # --- Park grouping (Feature 3 · Phase 1) -------------------------
    # If a park_group_id was passed, validate it exists and follow any
    # merge redirects so we always link to the canonical park. Reject
    # silently-bad ids (404) so the client surfaces a clear error.
    park_doc = None
    if body.park_group_id:
        park_doc = await db.parks.find_one({"park_id": body.park_group_id}, {"_id": 0})
        if not park_doc:
            raise HTTPException(status_code=404, detail="Park not found for park_group_id.")
        # Follow 1 merge hop
        if park_doc.get("status") == "merged_into" and park_doc.get("merged_into_park_id"):
            canon = await db.parks.find_one({"park_id": park_doc["merged_into_park_id"]}, {"_id": 0})
            if canon:
                park_doc = canon

    visibility_status = "pending_review" if body.privacy_mode in ("public", "premium") else "approved"
    if user.get("verification_status") == "verified" and body.privacy_mode in ("public", "premium"):
        visibility_status = "approved"
    # Drafts override everything — stays owner-only, never hits moderation.
    if body.save_as_draft:
        visibility_status = "draft"

    doc = body.dict()
    doc.pop("images", None)
    doc.pop("save_as_draft", None)  # not persisted as a spot field
    # Apply canonical park linkage (in case of merge redirect)
    if park_doc:
        doc["park_group_id"] = park_doc["park_id"]
        doc["park_name"] = park_doc.get("name") or body.park_name
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

    # Bump parent park's child_spot_count. Best-effort; failures are
    # non-fatal and the count can be recomputed by GET /parks/{id}.
    if park_doc:
        try:
            await db.parks.update_one(
                {"park_id": park_doc["park_id"]},
                {
                    "$inc": {"child_spot_count": 1},
                    "$set": {"updated_at": utcnow()},
                },
            )
        except Exception:
            pass

    return public_spot_view(doc, user)

# --- get_spot (server.py:1256-1402) ---
@router.get("/spots/{spot_id}")
async def get_spot(spot_id: str, viewer: Optional[dict] = Depends(get_optional_user)):
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    # privacy check
    if spot.get("privacy_mode") == "private":
        if not viewer or viewer.get("user_id") != spot["owner_user_id"]:
            raise HTTPException(status_code=403, detail="Private spot")
    view = public_spot_view(spot, viewer)
    # Jun 2025 — attach community sample photos for the bottom-card row.
    # Single-row call (per_spot=3) — does one indexed Mongo lookup.
    await attach_sample_photos([view])

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

    # ---- Feature 9 Phase 2 ----
    # (A) Rotating cover image: pick the best cover from a priority stack and
    #     surface it as `hero_cover_image_url`. Original images[] is untouched
    #     so existing logic isn't disrupted.
    # (D) Seasonal timeline: group approved community uploads by season
    #     (Spring / Summer / Fall / Winter) for a dedicated spot-detail
    #     section aimed at photographers planning by season.
    now_ = utcnow()
    recent_cutoff = now_ - timedelta(days=90)
    community_uploads = await db.spot_community_uploads.find(
        {"spot_id": spot_id, "moderation_status": "approved"},
        {"_id": 0, "upload_id": 1, "image_url": 1, "caption": 1,
         "featured": 1, "like_count": 1, "helpful_count": 1,
         "user_id": 1, "created_at": 1, "contributor_verified": 1,
         "visibility": 1},
    ).sort("created_at", -1).to_list(200)

    # --- Cover rotation priority stack ---
    chosen_cover: Optional[str] = None
    rotation_source: Optional[str] = None
    cover_override = spot.get("admin_cover_override") or None
    # 0. Admin-pinned cover (highest priority — bypasses all community logic)
    if cover_override and cover_override.get("image_url"):
        chosen_cover = cover_override["image_url"]; rotation_source = "admin_override"
    # 1. Admin-featured community upload
    if not chosen_cover:
        for u in community_uploads:
            if u.get("featured") and u.get("image_url"):
                chosen_cover = u["image_url"]; rotation_source = "admin_featured"; break
    # 2. Highest-reacted recent upload (within 90 days)
    if not chosen_cover:
        recent = [u for u in community_uploads if u.get("created_at") and (u["created_at"] if isinstance(u["created_at"], datetime) else datetime.fromisoformat(str(u["created_at"]).replace("Z", "+00:00"))) >= recent_cutoff.replace(tzinfo=None) if u.get("image_url")]
        if recent:
            best = sorted(recent, key=lambda r: (r.get("like_count", 0) + r.get("helpful_count", 0)), reverse=True)[0]
            if (best.get("like_count", 0) + best.get("helpful_count", 0)) >= 1:
                chosen_cover = best["image_url"]; rotation_source = "recent_most_liked"
    # 3. Seasonal match (current season first)
    if not chosen_cover:
        def _season(dt: datetime) -> str:
            m = dt.month
            if m in (3, 4, 5): return "spring"
            if m in (6, 7, 8): return "summer"
            if m in (9, 10, 11): return "fall"
            return "winter"
        current_season = _season(now_.replace(tzinfo=None) if now_.tzinfo else now_)
        for u in community_uploads:
            ts = u.get("created_at")
            if isinstance(ts, str):
                try: ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except Exception: continue
            if ts and _season(ts.replace(tzinfo=None) if ts.tzinfo else ts) == current_season and u.get("image_url"):
                chosen_cover = u["image_url"]; rotation_source = f"seasonal_{current_season}"; break
    # 4. Original cover fallback (preserves creator's shot identity)
    if not chosen_cover:
        imgs = spot.get("images") or []
        for im in imgs:
            if isinstance(im, dict) and im.get("is_cover") and im.get("image_url"):
                chosen_cover = im["image_url"]; rotation_source = "original_cover"; break
        if not chosen_cover and imgs and isinstance(imgs[0], dict):
            chosen_cover = imgs[0].get("image_url"); rotation_source = "first_image"
    view["hero_cover_image_url"] = chosen_cover
    view["hero_cover_source"] = rotation_source
    view["hero_cover_meta"] = {
        "focal_x": (cover_override or {}).get("focal_x", 0.5),
        "focal_y": (cover_override or {}).get("focal_y", 0.5),
        "scale":   (cover_override or {}).get("scale",   1.0),
        "rotation": (cover_override or {}).get("rotation", 0),
    } if cover_override else {"focal_x": 0.5, "focal_y": 0.5, "scale": 1.0, "rotation": 0}

    # Cover-Image Source-of-Truth CR (2026-05) — canonical `cover_image_url`.
    # ────────────────────────────────────────────────────────────────────
    # Exposes the SAME cover URL as /api/spots/markers using the identical
    # cascade. MUST match markers exactly or the map preview thumbnail
    # and the detail hero will drift. Critical: do NOT fall back to
    # `view["hero_cover_image_url"]` here — that's been recomputed by
    # the runtime rotation logic above and can pick a different image
    # than markers' raw-doc read. Parity requires both endpoints to
    # read the same stored fields in the same priority order.
    def _safe_cover(u):
        if not isinstance(u, str) or not u or u.startswith("data:"):
            return None
        return u
    _canon = (
        _safe_cover(spot.get("hero_cover_image_url"))
        or _safe_cover(spot.get("cover_image_url"))
        or _safe_cover(spot.get("card_url"))
        or _safe_cover(spot.get("image_url"))
    )
    if not _canon:
        imgs_ = spot.get("images") or []
        # is_cover=True first (matches markers' first_img pickup order
        # when users haven't set the legacy fields but have marked a
        # primary image as the cover explicitly).
        first_cover = next(
            (im for im in imgs_ if isinstance(im, dict) and im.get("is_cover") is True),
            None,
        )
        for im in ([first_cover] if first_cover else []) + [im for im in imgs_ if im is not first_cover]:
            if isinstance(im, dict):
                _canon = _safe_cover(im.get("image_url")) or _safe_cover(im.get("card_url")) or _safe_cover(im.get("thumb_url"))
                if _canon:
                    break
    if not _canon:
        # Final fallback: oldest approved community upload (matches markers).
        for u in community_uploads:
            _canon = _safe_cover(u.get("image_url"))
            if _canon:
                break
    view["cover_image_url"] = _canon

    # --- Seasonal timeline ---
    seasonal_timeline: Dict[str, list] = {"spring": [], "summer": [], "fall": [], "winter": []}
    for u in community_uploads:
        ts = u.get("created_at")
        if isinstance(ts, str):
            try: ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except Exception: continue
        if not ts:
            continue
        m = ts.month
        key = "spring" if m in (3, 4, 5) else "summer" if m in (6, 7, 8) else "fall" if m in (9, 10, 11) else "winter"
        # Only keep images for the timeline
        if not u.get("image_url"):
            continue
        if len(seasonal_timeline[key]) < 8:
            seasonal_timeline[key].append({
                "upload_id": u["upload_id"],
                "image_url": u["image_url"],
                "caption": u.get("caption"),
                "created_at": u["created_at"].isoformat() if isinstance(u["created_at"], datetime) else u["created_at"],
            })
    view["seasonal_timeline"] = seasonal_timeline
    view["seasonal_timeline_total"] = sum(len(v) for v in seasonal_timeline.values())

    # CRITICAL (Apr 2026): strip legacy base64 data URLs from the
    # payload before shipping it. With 20+ images plus an owner avatar
    # any one of which could be 3-6 MB, the unslimmed response could
    # approach MongoDB's 16 MB document limit and definitely times out
    # the cover editor's parse step. The same helper is already applied
    # to list endpoints; centralising it here closes the last hole.
    try:
        from server import _slim_feed_payload
        _slim_feed_payload({"spots": [view], "similar_spots": view.get("similar_spots") or []})
    except Exception:
        pass

    return view

# --- list_spots (server.py:1405-1536) ---
@router.get("/spots")
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
    sort: str = "recent",  # recent, trending, golden_hour, score, quality, distance
    limit: int = 40,
    # Explore Speed CR — Batch 1 (June 2025): cursor pagination.
    # Frontend now pages: initial 24, then 12 per scroll. Server caps
    # `limit` at 30 by default (200 hard-cap retained for legacy map
    # callers passing `limit=200`). When `cursor` is provided OR
    # `paginated=1` is sent, the response wraps as
    # `{items: [...], next_cursor: int|null, total_estimate: int}`.
    cursor: Optional[int] = 0,
    paginated: Optional[int] = 0,
    # CR #1 Item 6 (June 2025): enforce hard cap of 200 spots per /spots
    # request. Previously the frontend was free to pass limit=1000+, which
    # blew RN-Maps memory on Android and was the root cause of Explore
    # tab crashes on mid-range devices. Cap at 200 server-side so no
    # client can ever over-fetch.
    # FIX(2026-04 Item #3 round 3): URGENT distance bug.
    # Explore was calling /spots WITHOUT user GPS, so distance_km was
    # never computed and the frontend rendered any stale value present.
    # Now we accept lat/lng and apply the same strict policy as
    # /api/feed/home: device GPS or null+distance_source='unavailable'.
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    # CR #1 Item 6 (June 2025): enforce 200-spot hard cap server-side.
    limit = max(1, min(200, int(limit or 40)))
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
    elif sort == "quality":
        # P0-B: Explore default — boost quality_score with trending/new kickers
        def _q(s):
            q = float(s.get("quality_score") or 0)
            if s.get("is_trending"): q += 8
            if s.get("is_fresh"): q += 4
            if s.get("is_new"): q += 3
            if s.get("is_verified_discovery"): q += 2
            # Tie-break: newer wins
            ts = s.get("created_at")
            if isinstance(ts, str):
                try: ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except Exception: ts = None
            ts = ts or datetime.min.replace(tzinfo=timezone.utc)
            return (q, ts)
        out.sort(key=_q, reverse=True)
    elif sort == "trending":
        # Approximate trending: score + image count
        out.sort(key=lambda s: s["shoot_score"] + len(s.get("images", [])) * 2, reverse=True)
    elif sort == "golden_hour":
        out.sort(
            key=lambda s: (s.get("morning_golden_hour_rating", 0) + s.get("evening_golden_hour_rating", 0)),
            reverse=True,
        )
    elif sort == "distance":
        # Explore Speed CR — Batch 1 (June 2025): explicit distance sort.
        # Frontend passes sort=distance + lat/lng so the server returns
        # results pre-sorted closest-first. We push spots without
        # computable distance to the bottom and tie-break ascending by
        # spot_id so paging stays stable.
        def _d(s):
            try:
                if (lat is not None and lng is not None
                        and s.get("latitude") is not None
                        and s.get("longitude") is not None):
                    return (
                        haversine_km(float(lat), float(lng),
                                     float(s["latitude"]), float(s["longitude"])),
                        str(s.get("spot_id") or ""),
                    )
            except Exception:
                pass
            # Push spots without coords or without user GPS to the bottom.
            return (1e9, str(s.get("spot_id") or ""))
        out.sort(key=_d)
    else:  # recent
        out.sort(key=lambda s: s.get("created_at") or utcnow(), reverse=True)

    # ─── Cursor pagination (Explore Speed CR — Batch 1) ──────────────
    # Total before slicing — used for the wrapped response shape so the
    # client can compute `has_more` cheaply without a second round-trip.
    total_estimate = len(out)
    start = max(0, int(cursor or 0))
    end = start + limit
    page = out[start:end]
    next_cursor = end if end < total_estimate else None
    out = page
    # FIX(2026-04 Item #3 round 3): compute distance from device GPS.
    # Strict policy: device GPS or null+distance_source='unavailable'.
    # Never fabricate. If no lat/lng was provided we still scrub any
    # stale distance fields baked into the document so the UI cannot
    # render a wrong number.
    for s in out:
        try:
            if lat is not None and lng is not None and s.get("latitude") is not None and s.get("longitude") is not None:
                d_km = haversine_km(float(lat), float(lng), float(s["latitude"]), float(s["longitude"]))
                s["distance_km"] = round(d_km, 2)
                s["distance_mi"] = round(d_km * 0.621371, 2)
                s["distance_source"] = "device_gps"
            else:
                s["distance_km"] = None
                s["distance_mi"] = None
                s["distance_source"] = "unavailable"
        except Exception:
            s["distance_km"] = None
            s["distance_mi"] = None
            s["distance_source"] = "unavailable"
    # When user GPS is present and they're sorting by quality, blend in
    # a small proximity bonus so closer high-quality spots win ties.
    if lat is not None and lng is not None and sort == "quality":
        out.sort(key=lambda s: (
            -(float(s.get("quality_score") or 0)
              + (8 if s.get("is_trending") else 0)
              + (4 if s.get("is_fresh") else 0)),
            (s.get("distance_km") if s.get("distance_km") is not None else 99999),
        ))
    await attach_owners(out)
    # Jun 2025 — premium Explore card payload (sample community photos
    # row). Batched single Mongo lookup; never per-card.
    await attach_sample_photos(out)
    # ─── Wrapped pagination response (Explore Speed CR — Batch 1) ────
    # When the client passes `paginated=1` OR `cursor>0`, return the
    # wrapped object the new infinite-scroll list expects. Legacy
    # callers (existing map fetches, internal scripts) keep getting
    # the raw list shape so nothing breaks.
    if int(paginated or 0) == 1 or int(cursor or 0) > 0:
        return {
            "items": out,
            "next_cursor": next_cursor,
            "total_estimate": total_estimate,
            "limit": limit,
        }
    return out


# --- nearby (server.py:1539-1560) ---
@router.get("/spots/nearby/search")
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
    await attach_sample_photos(out)
    return out

# --- delete_spot (server.py:1923-1936) ---
@router.delete("/spots/{spot_id}")
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

# --- post_spot_upload (server.py:2145-2241) ---
@router.post("/spots/{spot_id}/uploads")
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
        # May 2026 (organized R2 layout) — image_id is the stable
        # identifier returned by /api/uploads/image. Older clients
        # don't send it; fall back to a freshly-minted one so the row
        # always has a non-null `image_id` for admin tooling to
        # reference.
        img_id = (img.image_id or f"img_{uuid.uuid4().hex[:10]}")
        docs.append({
            "upload_id": f"upl_{uuid.uuid4().hex[:12]}",
            "batch_id": batch_id,
            "spot_id": spot_id,
            "user_id": user["user_id"],
            # Mirrors `user_id` under the contract name documented in the
            # PRD ("uploaded_by"). Kept as a separate field so existing
            # readers of `user_id` stay untouched.
            "uploaded_by": user["user_id"],
            "image_id": img_id,
            "image_url": img.image_url,
            # Carry the R2 storage_key alongside image_url so a future
            # rewrite of the public domain (or a periodic garbage sweep
            # of orphaned R2 objects) can key off the stable object
            # identity rather than parsing URLs.
            "storage_key": img.storage_key,
            # `r2_key` mirrors `storage_key` under the contract name from
            # the PRD. We persist BOTH so existing code that reads
            # `storage_key` keeps working untouched, and new tooling can
            # use the friendlier `r2_key`. They always carry the same
            # value (or both null for legacy local-disk uploads).
            "r2_key": img.storage_key,
            "image_type": "gallery",
            "content_type": img.content_type,
            "size_bytes": img.size_bytes,
            "width": img.width,
            "height": img.height,
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
        # Notify savers of this spot that a fresh photo dropped.
        # (Fire-and-forget; failures don't affect the upload response.)
        try:
            saver_ids = await db.spot_saves.find(
                {"spot_id": spot_id}, {"_id": 0, "user_id": 1}
            ).to_list(500)
            preview_img = docs[0].get("image_url") if docs else None
            for sv in saver_ids:
                await _emit_notification(
                    sv["user_id"],
                    "saved_spot_fresh_photo",
                    f"New photos at {spot.get('title') or 'a saved spot'}",
                    f"{user.get('name') or 'A photographer'} just added fresh photos",
                    actor_user_id=user["user_id"],
                    spot_id=spot_id,
                    upload_id=docs[0]["upload_id"] if docs else None,
                    image_url=preview_img,
                    deep_link=f"/spot/{spot_id}",
                )
            # Verified-today / blooming alerts
            if "verified_today" in (body.condition_tags or []):
                for sv in saver_ids:
                    await _emit_notification(
                        sv["user_id"],
                        "saved_spot_verified",
                        f"{spot.get('title') or 'A saved spot'} verified today",
                        f"{user.get('name') or 'A photographer'} confirmed the spot is good right now",
                        actor_user_id=user["user_id"],
                        spot_id=spot_id,
                        deep_link=f"/spot/{spot_id}",
                    )
            if "blooming" in (body.condition_tags or []):
                for sv in saver_ids:
                    await _emit_notification(
                        sv["user_id"],
                        "saved_spot_blooming",
                        f"Blooming now at {spot.get('title') or 'a saved spot'}",
                        "Get there before the bloom fades",
                        actor_user_id=user["user_id"],
                        spot_id=spot_id,
                        image_url=preview_img,
                        deep_link=f"/spot/{spot_id}",
                    )
        except Exception:
            pass
    return {
        "ok": True,
        "batch_id": batch_id,
        "moderation_status": status_,
        "auto_approved": auto_approve,
        "count": len(docs),
        "message": "Posted to the spot!" if auto_approve else "Submitted for review — you'll be notified when it's approved.",
    }

# --- list_spot_uploads (server.py:2244-2309) ---
@router.get("/spots/{spot_id}/uploads")
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
    # Followers-only visibility: drop items whose author the viewer doesn't
    # follow. Own items + items authored by followed users + public items
    # always pass. Moderators/owner keep full visibility for review.
    if items and not include_pending:
        followed_ids: set = set()
        if viewer:
            followed_ids = {viewer["user_id"]}  # always see own
            fr = await db.follows.find(
                {"follower_user_id": viewer["user_id"]}, {"_id": 0, "followed_user_id": 1}
            ).to_list(1000)
            for f in fr:
                followed_ids.add(f.get("followed_user_id"))
        def _visible(it: dict) -> bool:
            vis = it.get("visibility") or "public"
            if vis != "followers":
                return True
            return it.get("user_id") in followed_ids
        items = [it for it in items if _visible(it)]
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

# --- post_spot_update (server.py:2312-2347) ---
@router.post("/spots/{spot_id}/updates")
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

# --- list_spot_updates (server.py:2350-2378) ---
@router.get("/spots/{spot_id}/updates")
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

# --- react_spot_upload (server.py:2381-2436) ---
@router.post("/spot-uploads/{upload_id}/react")
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
        # Notify the upload's author (not self)
        try:
            if upload.get("user_id") and upload["user_id"] != user["user_id"]:
                await _emit_notification(
                    upload["user_id"],
                    "upload_reaction",
                    f"{user.get('name') or 'Someone'} {'liked' if kind=='like' else 'found helpful'} your photo",
                    (upload.get("caption") or "").strip()[:140] or "Your contribution is being appreciated",
                    actor_user_id=user["user_id"],
                    spot_id=upload["spot_id"],
                    upload_id=upload_id,
                    image_url=upload.get("image_url"),
                    deep_link=f"/spot/{upload['spot_id']}",
                )
        except Exception:
            pass
    # Refresh freshness lazily (counts affect score)
    await _recompute_spot_freshness(upload["spot_id"])
    updated = await db.spot_community_uploads.find_one(
        {"upload_id": upload_id},
        {"_id": 0, "like_count": 1, "helpful_count": 1},
    )
    return {"ok": True, "acted": acted, **(updated or {})}

# --- toggle_save (server.py:2988-3096) ---
@router.post("/spots/{spot_id}/save")
async def toggle_save(spot_id: str, user: dict = Depends(get_current_user)):
    existing = await db.spot_saves.find_one({"user_id": user["user_id"], "spot_id": spot_id})
    if existing:
        await db.spot_saves.delete_one({"user_id": user["user_id"], "spot_id": spot_id})
        return {"saved": False}
    # Feature gating: free plan save cap
    limits = limits_for(user)
    current = await db.spot_saves.count_documents({"user_id": user["user_id"]})
    if current >= limits["saves"]:
        raise_paywall(
            "saves",
            f"Free plan allows {limits['saves']} saves. Upgrade to Pro for unlimited saves.",
            target_plan="pro",
        )
    await db.spot_saves.insert_one({
        "save_id": f"save_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "spot_id": spot_id,
        "created_at": utcnow(),
    })
    # Live-count saves after the insert — used for trending signal.
    saves_after = await db.spot_saves.count_documents({"spot_id": spot_id})

    # Notify the spot owner (routes through gates + deep link).
    try:
        spot = await db.spots.find_one(
            {"spot_id": spot_id},
            {"_id": 0, "owner_user_id": 1, "title": 1, "city": 1,
             "created_at": 1, "images": 1},
        )
        if spot and spot.get("owner_user_id") and spot["owner_user_id"] != user["user_id"]:
            cover = None
            try:
                imgs = spot.get("images") or []
                if imgs:
                    cover = (imgs[0] or {}).get("image_url")
            except Exception:
                cover = None
            await _emit_notification(
                spot["owner_user_id"],
                "upload_featured",  # community bucket — low-frequency
                f"{user.get('name') or 'Someone'} saved your spot",
                f"“{(spot.get('title') or 'your spot')[:60]}” just got saved",
                actor_user_id=user["user_id"],
                spot_id=spot_id,
                deep_link=f"/spot/{spot_id}",
                image_url=cover,
            )

        # Trending-spot fanout: when saves cross 4 on a recently-created
        # spot, push to nearby photographers who haven't saved it yet.
        # Dedupe: send_growth_push's 10-min (user, kind, title) window
        # plus the 7-day per-spot dedupe via push_log.
        if spot and saves_after == 4:
            created_at = spot.get("created_at") or utcnow()
            # Motor returns naive datetimes from MongoDB — normalise to UTC
            # before subtracting a tz-aware `utcnow()` to avoid TypeError that
            # the surrounding try/except would silently swallow.
            try:
                if created_at.tzinfo is None:
                    from datetime import timezone as _tz
                    created_at = created_at.replace(tzinfo=_tz.utc)
            except Exception:
                created_at = utcnow()
            age_days = (utcnow() - created_at).days
            if age_days <= 30:
                spot_city = (spot.get("city") or "").strip()
                spot_title = (spot.get("title") or "a new spot")[:60]
                existing_savers = await db.spot_saves.find(
                    {"spot_id": spot_id}, {"_id": 0, "user_id": 1}
                ).to_list(50)
                saver_ids = {s["user_id"] for s in existing_savers}
                saver_ids.add(user["user_id"])
                # 7-day per-spot dedupe across users
                seven_ago = utcnow() - timedelta(days=7)
                recent_log = await db.push_log.find({
                    "kind": "trending_spot",
                    "deep_link": f"/spot/{spot_id}",
                    "sent_at": {"$gte": seven_ago},
                }, {"_id": 0, "user_id": 1}).to_list(500)
                already_pushed = {r["user_id"] for r in recent_log}

                target_q = {"user_id": {"$nin": list(saver_ids | already_pushed)}}
                if spot_city:
                    target_q["city"] = spot_city
                cover = None
                try:
                    imgs = spot.get("images") or []
                    if imgs:
                        cover = (imgs[0] or {}).get("image_url")
                except Exception:
                    cover = None
                cur = db.users.find(target_q, {"_id": 0, "user_id": 1}).limit(40)
                async for tgt in cur:
                    tid = tgt.get("user_id")
                    if not tid:
                        continue
                    await _emit_notification(
                        tid,
                        "trending_spot",
                        f"🔥 Trending in {spot_city or 'your area'}",
                        f"{spot_title} just hit 4 saves — check it out",
                        spot_id=spot_id,
                        deep_link=f"/spot/{spot_id}",
                        image_url=cover,
                    )
    except Exception:
        pass
    return {"saved": True}

# --- my_saves (server.py:3099-3105) ---
@router.get("/me/saved")
async def my_saves(user: dict = Depends(get_current_user)):
    saves = await db.spot_saves.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    spot_ids = [s["spot_id"] for s in saves]
    spots = await db.spots.find({"spot_id": {"$in": spot_ids}}, {"_id": 0}).to_list(500)
    spot_map = {s["spot_id"]: public_spot_view(s, user) for s in spots}
    return [spot_map[sid] for sid in spot_ids if sid in spot_map and spot_map[sid]]

# --- publish_draft (server.py:3693-3712) ---
@router.post("/spots/{spot_id}/publish-draft")
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

# --- my_spots (server.py:3715-3718) ---
@router.get("/me/spots")
async def my_spots(user: dict = Depends(get_current_user)):
    spots = await db.spots.find({"owner_user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [public_spot_view(s, user) for s in spots]

# --- create_collection (server.py:3724-3746) ---
@router.post("/collections")
async def create_collection(body: CollectionIn, user: dict = Depends(get_current_user)):
    limits = limits_for(user)
    current = await db.collections.count_documents({"owner_user_id": user["user_id"]})
    if current >= limits["collections"]:
        raise_paywall(
            "collections",
            f"Free plan allows {limits['collections']} collections. Upgrade to Pro for unlimited.",
            target_plan="pro",
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

# --- list_my_collections (server.py:3749-3775) ---
@router.get("/me/collections")
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

# --- add_to_collection (server.py:3778-3791) ---
@router.post("/collections/{collection_id}/spots")
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

# --- get_collection (server.py:3794-3803) ---
@router.get("/collections/{collection_id}")
async def get_collection(collection_id: str, viewer: Optional[dict] = Depends(get_optional_user)):
    col = await db.collections.find_one({"collection_id": collection_id}, {"_id": 0})
    if not col:
        raise HTTPException(status_code=404, detail="Not found")
    if col["privacy_mode"] == "private" and (not viewer or viewer["user_id"] != col["owner_user_id"]):
        raise HTTPException(status_code=403, detail="Private collection")
    spots = await db.spots.find({"spot_id": {"$in": col.get("spot_ids") or []}}, {"_id": 0}).to_list(500)
    col["spots"] = [public_spot_view(s, viewer) for s in spots if public_spot_view(s, viewer)]
    return col

# --- create_review (server.py:3809-3836) ---
@router.post("/spots/{spot_id}/reviews")
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

# --- create_checkin (server.py:3839-3856) ---
@router.post("/spots/{spot_id}/checkins")
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

# --- spot_astronomy (server.py:5398-5409) ---
@router.get("/spots/{spot_id}/astronomy")
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

# --- spot_shot_list (server.py:6018-6046) ---
@router.post("/spots/{spot_id}/shot-list")
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

