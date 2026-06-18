"""
routes/shoot_plan.py — "Plan This Shoot" feature (Jun 2025).

Goals
─────
1. Generate a practical, mobile-first shoot plan for any spot a
   photographer is looking at. The plan combines four signals:
     • Best time to arrive (sun-based light windows)
     • 24-hour light-quality timeline (gold / amber / neutral / gray)
     • 5-day weather forecast from Open-Meteo
     • Composition tips inferred from the spot's category / shoot_types
     • Up to 2 nearby backup spots within 10 mi
2. Versioned save — every tap of "Save Plan" creates a new doc in the
   `shoot_plans` Mongo collection (history of weather/light/tips at
   plan time) AND adds the spot to a user-default "Shoot Plans"
   collection so plans surface in the existing Collections UI.

Stability rules
───────────────
• Weather is non-critical. If Open-Meteo is down/slow we still return
  the rest of the plan and the frontend renders a "Weather temporarily
  unavailable" tile.
• Missing lat/lng returns a polished fallback plan (no sun/weather).
• Backup spots query excludes is_test_data, is_flagged, deleted, and
  the source spot itself. Falls back to empty list gracefully.

Endpoints
─────────
  GET  /api/spots/{spot_id}/shoot-plan
  POST /api/collections/save-shoot-plan
"""
from __future__ import annotations

import asyncio
import math
import os
import uuid
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List, Optional

import httpx
from astral import LocationInfo
from astral.sun import sun, golden_hour, blue_hour, SunDirection
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from zoneinfo import ZoneInfo

try:
    # Resolve the IANA timezone for an arbitrary lat/lng so the 24-hour
    # light-quality timeline is rendered in the SPOT's local hours, not
    # UTC. Without this Texas spots would say "excellent at 1 AM" which
    # is technically sunrise UTC but reads as midnight locally.
    from timezonefinder import TimezoneFinder
    _TZ_FINDER: Optional["TimezoneFinder"] = TimezoneFinder()
except Exception:  # pragma: no cover — defensive
    _TZ_FINDER = None

from server import (
    db,
    get_current_user,
    get_optional_user,
    haversine_km,
    public_spot_view,
    utcnow,
)

router = APIRouter(prefix="/api", tags=["shoot-plan"])

# ─────────────────────────────────────────────────────────────────────
# Tunables
# ─────────────────────────────────────────────────────────────────────

# Hard cap on nearby backup spots so the modal stays snappy.
NEARBY_BACKUPS_LIMIT = 2
NEARBY_BACKUPS_RADIUS_KM = 16.1  # ≈ 10 miles

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_TIMEOUT_S = 4.5  # short — weather is non-critical
OPEN_METEO_FORECAST_DAYS = 5

SHOOT_PLANS_COLLECTION_NAME = "Shoot Plans"

# Composition tips keyed by spot category. Each entry returns up to 3
# short, practical tips. Falls back to GENERIC_TIPS when no match.
GENERIC_TIPS: List[str] = [
    "Use leading lines to guide the eye toward your subject.",
    "Place your subject in open shade for soft, even skin tones.",
    "Watch for clean horizons and remove distractions from the frame.",
]
COMPOSITION_TIPS_BY_CATEGORY: Dict[str, List[str]] = {
    "wildflower": [
        "Shoot low through foreground blooms to add depth.",
        "Use a wide aperture (f/2.8–f/4) to soften the background.",
        "Backlight petals during golden hour for a glow effect.",
    ],
    "field": [
        "Shoot low through foreground grasses for layered depth.",
        "Place your subject one-third in from the edge for breathing room.",
        "Use golden hour backlight for separation from the field.",
    ],
    "beach": [
        "Include a strong foreground element (driftwood, shells, footprints).",
        "Use blue hour for soft, even sky and water tones.",
        "Watch the tide line — keep horizons level and clean.",
    ],
    "coast": [
        "Use long exposure during blue hour to smooth the water.",
        "Frame your subject against the horizon for scale.",
        "Lead the eye with shoreline curves or rocks.",
    ],
    "mountain": [
        "Include a person or object for scale.",
        "Shoot at golden hour for warm rim light on ridges.",
        "Use a polarizer mid-day to cut haze and deepen sky tones.",
    ],
    "forest": [
        "Look for shafts of light through the canopy for drama.",
        "Use open shade for soft, even portrait light.",
        "Frame your subject between trunks for natural leading lines.",
    ],
    "urban": [
        "Use reflections in puddles or storefronts for layering.",
        "Shoot blue hour to balance ambient and tungsten light.",
        "Watch for clean architectural lines — keep verticals straight.",
    ],
    "downtown": [
        "Use leading lines from streets and sidewalks.",
        "Frame your subject in front of neon or signage for color pop.",
        "Blue hour balances ambient sky with city lights.",
    ],
    "lake": [
        "Use the lake as a natural reflector during golden hour.",
        "Shoot from low angle for clean foreground water.",
        "Look for symmetry in still-water reflections.",
    ],
    "waterfall": [
        "Use a tripod and slow shutter (1/4–1s) to silk the water.",
        "Shoot in open shade or overcast for even tones.",
        "Watch your gear for spray — use a microfiber and lens hood.",
    ],
    "river": [
        "Use long exposure to smooth the flow during blue hour.",
        "Shoot from a low bank angle for foreground rocks.",
        "Include sky reflections on slower stretches.",
    ],
    "desert": [
        "Use golden hour for warm tones on sand and rock.",
        "Lead the eye with dune ridges or shadows.",
        "Avoid harsh midday light — shoot near sunrise or sunset.",
    ],
    "garden": [
        "Use a wide aperture (f/2.8–f/4) for soft backgrounds.",
        "Shoot in open shade for soft, true colours.",
        "Frame your subject between leaves or blooms for natural framing.",
    ],
    "park": [
        "Find the best light pocket — open shade or backlit edges.",
        "Use trees as natural frames around your subject.",
        "Avoid busy backgrounds — step a few feet to clean the frame.",
    ],
    "studio": [
        "Soften your key light with a large diffuser or window.",
        "Add a hair light to separate the subject from the backdrop.",
        "Watch for catchlights in the eyes — keep them present.",
    ],
}

# ─────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────

class SaveShootPlanIn(BaseModel):
    spot_id: str
    spot_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    best_time_to_arrive: Optional[Dict[str, Any]] = None
    light_quality_timeline: Optional[List[Dict[str, Any]]] = None
    weather_snapshot: Optional[List[Dict[str, Any]]] = None
    composition_tips: Optional[List[str]] = None
    gear_suggestions: Optional[List[str]] = None
    backup_spot_ids: Optional[List[str]] = Field(default_factory=list)
    notes: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def _hour_quality(hour: int, sunrise_h: float, sunset_h: float) -> str:
    """Classify a clock-hour into a 4-tier light bucket relative to the
    local sunrise/sunset times. Pure math, no external IO.

    Returns one of: "excellent" | "great" | "okay" | "poor".
    """
    # Golden hour windows are ±60 min around sunrise/sunset.
    def _within(h: float, center: float, half_window: float) -> bool:
        return abs(h - center) <= half_window

    # Excellent — within ±30 min of sunrise/sunset (true golden core)
    if _within(hour, sunrise_h, 0.5) or _within(hour, sunset_h, 0.5):
        return "excellent"
    # Great — within ±60 min (extended golden hour)
    if _within(hour, sunrise_h, 1.0) or _within(hour, sunset_h, 1.0):
        return "great"
    # Great — blue hour (30 min before sunrise / 30 min after sunset)
    if _within(hour, sunrise_h - 0.5, 0.25) or _within(hour, sunset_h + 0.5, 0.25):
        return "great"
    # Okay — first 2 hr after sunrise / last 2 hr before sunset
    if (sunrise_h + 1.0) < hour < (sunrise_h + 3.0):
        return "okay"
    if (sunset_h - 3.0) < hour < (sunset_h - 1.0):
        return "okay"
    # Poor — outside daylight or harsh midday
    if hour < sunrise_h - 1.0 or hour > sunset_h + 1.0:
        return "poor"
    return "okay"


def _compute_light_plan(lat: float, lng: float, when: Optional[date] = None) -> Dict[str, Any]:
    """Compute sun events + 24h light quality timeline for the given
    coordinates. Returns a dict with `best_time_to_arrive` and
    `light_quality_timeline`. Falls back to a neutral plan on error.

    Important: the 24-hour timeline is rendered in the SPOT's LOCAL
    timezone (resolved from lat/lng via timezonefinder). Without this
    a Texas spot's "golden hour" cells would land at 1 AM in the
    payload because all astral events are UTC.
    """
    # Resolve the spot's local timezone. Falls back to UTC if the
    # timezonefinder is unavailable or returns nothing (e.g. an ocean
    # cell or a polar coordinate).
    tz: Any = timezone.utc
    if _TZ_FINDER is not None:
        try:
            tz_name = _TZ_FINDER.timezone_at(lng=lng, lat=lat)
            if tz_name:
                tz = ZoneInfo(tz_name)
        except Exception:
            tz = timezone.utc

    target_date = when or datetime.now(tz).date()
    try:
        loc = LocationInfo(latitude=lat, longitude=lng)
        events = sun(loc.observer, date=target_date, tzinfo=tz)
        try:
            gh_morning = golden_hour(loc.observer, date=target_date, direction=SunDirection.RISING, tzinfo=tz)
        except Exception:
            gh_morning = (events["sunrise"], events["sunrise"] + timedelta(minutes=60))
        try:
            gh_evening = golden_hour(loc.observer, date=target_date, direction=SunDirection.SETTING, tzinfo=tz)
        except Exception:
            gh_evening = (events["sunset"] - timedelta(minutes=60), events["sunset"])
        try:
            bh_morning = blue_hour(loc.observer, date=target_date, direction=SunDirection.RISING, tzinfo=tz)
        except Exception:
            bh_morning = (events["sunrise"] - timedelta(minutes=30), events["sunrise"])
        try:
            bh_evening = blue_hour(loc.observer, date=target_date, direction=SunDirection.SETTING, tzinfo=tz)
        except Exception:
            bh_evening = (events["sunset"], events["sunset"] + timedelta(minutes=30))
    except Exception:
        # Polar night / polar day / library hiccup — return a safe
        # neutral plan so the modal still renders.
        return {
            "best_time_to_arrive": None,
            "light_quality_timeline": [],
            "sun_events": None,
            "timezone": str(tz),
        }

    # Convert sun events to local-tz floating-point hours for the
    # bucketing helper.
    sr_local = events["sunrise"].astimezone(tz)
    ss_local = events["sunset"].astimezone(tz)
    sunrise_h = sr_local.hour + sr_local.minute / 60.0
    sunset_h = ss_local.hour + ss_local.minute / 60.0

    timeline: List[Dict[str, Any]] = []
    for h in range(0, 24):
        timeline.append({
            "hour": h,
            "label": f"{(h % 12) or 12} {'AM' if h < 12 else 'PM'}",
            "quality": _hour_quality(h, sunrise_h, sunset_h),
        })

    # "Best time to arrive" — prefer the morning golden hour start.
    # If the morning window is already in the past locally, switch to
    # the evening window.
    now = datetime.now(tz)
    best_dt = gh_morning[0]
    if best_dt < now:
        best_dt = gh_evening[0] if gh_evening[0] > now else gh_morning[0]
    is_morning = best_dt == gh_morning[0]

    return {
        "best_time_to_arrive": {
            "label": "Morning golden hour" if is_morning else "Evening golden hour",
            "iso": best_dt.isoformat(),
            "local_label": best_dt.strftime("%I:%M %p").lstrip("0"),
            "duration_min": int(round((gh_morning[1] - gh_morning[0]).total_seconds() / 60))
                if is_morning
                else int(round((gh_evening[1] - gh_evening[0]).total_seconds() / 60)),
        },
        "light_quality_timeline": timeline,
        "sun_events": {
            "sunrise_iso": events["sunrise"].isoformat(),
            "sunset_iso": events["sunset"].isoformat(),
            "sunrise_local": sr_local.strftime("%I:%M %p").lstrip("0"),
            "sunset_local": ss_local.strftime("%I:%M %p").lstrip("0"),
            "golden_morning": [gh_morning[0].isoformat(), gh_morning[1].isoformat()],
            "golden_evening": [gh_evening[0].isoformat(), gh_evening[1].isoformat()],
            "blue_morning":   [bh_morning[0].isoformat(), bh_morning[1].isoformat()],
            "blue_evening":   [bh_evening[0].isoformat(), bh_evening[1].isoformat()],
        },
        "timezone": str(tz),
    }


# Compact mapping of Open-Meteo WMO weather codes to human labels.
# Source: https://open-meteo.com/en/docs (weather_code section).
_WMO_LABEL: Dict[int, str] = {
    0: "Clear sky",
    1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Freezing fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers", 81: "Heavy showers", 82: "Violent showers",
    85: "Snow showers", 86: "Heavy snow showers",
    95: "Thunderstorms",
    96: "Thunderstorms w/ hail", 99: "Severe thunderstorms",
}


async def _fetch_weather(
    lat: float, lng: float, days: Optional[int] = None,
) -> Optional[List[Dict[str, Any]]]:
    """Call Open-Meteo for a daily forecast.

    Returns a list of day dicts shaped for the client, or `None` on any
    failure (the client renders a fallback tile in that case). Best-
    effort only — we never raise out of this function.

    Jun 2026 — `days` parameter added so Elite shares can request up to
    10 days. Open-Meteo supports up to 16, but we clamp to a sensible
    [1, 16] range. Default stays at `OPEN_METEO_FORECAST_DAYS` (5) for
    every existing caller that didn't pass the new arg.
    """
    forecast_days = OPEN_METEO_FORECAST_DAYS
    if isinstance(days, int) and days > 0:
        forecast_days = max(1, min(int(days), 16))
    try:
        params = {
            "latitude": lat,
            "longitude": lng,
            "daily": ",".join([
                "weather_code",
                "temperature_2m_max",
                "temperature_2m_min",
                "precipitation_probability_max",
                "wind_speed_10m_max",
            ]),
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "auto",
            "forecast_days": forecast_days,
        }
        async with httpx.AsyncClient(timeout=OPEN_METEO_TIMEOUT_S) as client:
            r = await client.get(OPEN_METEO_FORECAST_URL, params=params)
            if r.status_code != 200:
                return None
            data = r.json()
    except Exception:
        return None

    daily = data.get("daily") or {}
    times = daily.get("time") or []
    if not times:
        return None
    out: List[Dict[str, Any]] = []
    codes = daily.get("weather_code") or []
    highs = daily.get("temperature_2m_max") or []
    lows = daily.get("temperature_2m_min") or []
    rains = daily.get("precipitation_probability_max") or []
    winds = daily.get("wind_speed_10m_max") or []
    for i, t in enumerate(times):
        try:
            d = datetime.fromisoformat(t).date()
            code = int(codes[i]) if i < len(codes) and codes[i] is not None else None
            out.append({
                "date": t,
                "weekday": d.strftime("%a"),
                "label": _WMO_LABEL.get(code or -1, "Mixed"),
                "code": code,
                "high_f": int(round(highs[i])) if i < len(highs) and highs[i] is not None else None,
                "low_f":  int(round(lows[i]))  if i < len(lows)  and lows[i]  is not None else None,
                "rain_chance_pct": int(round(rains[i])) if i < len(rains) and rains[i] is not None else None,
                "wind_mph": int(round(winds[i])) if i < len(winds) and winds[i] is not None else None,
            })
        except Exception:
            continue
    return out


def _composition_tips_for(spot: Dict[str, Any]) -> List[str]:
    """Pick 2-3 tips by walking the spot's category + shoot_types in
    order. Always returns at least the generic set so the section is
    never empty."""
    keys: List[str] = []
    cat = (spot.get("category") or "").strip().lower()
    if cat:
        keys.append(cat)
    for st in (spot.get("shoot_types") or []):
        if st:
            keys.append(str(st).strip().lower())
    # PRD canonical tags from server.SHOOT_TYPES tend to be mixed-case;
    # we lowercase both sides so "Wildflower" / "wildflower" both match.
    for k in keys:
        if k in COMPOSITION_TIPS_BY_CATEGORY:
            return COMPOSITION_TIPS_BY_CATEGORY[k][:3]
    return GENERIC_TIPS[:3]


def _gear_suggestions_for(spot: Dict[str, Any]) -> List[str]:
    """Light gear hints — currently a small heuristic table driven by
    category. Kept tiny so the modal stays focused."""
    cat = (spot.get("category") or "").strip().lower()
    table = {
        "waterfall": ["Tripod", "Polarizer", "ND filter (3-6 stop)", "Microfiber for spray"],
        "wildflower": ["50–85mm prime for portraits", "Wide for sweeping fields", "Reflector or diffuser"],
        "coast":   ["Tripod", "ND filter for long exposure", "Lens cloth for salt spray"],
        "beach":   ["Wide lens", "Polarizer", "Spare strap (sand traps zippers)"],
        "mountain":["Wide + tele", "Polarizer", "Extra battery for cold weather"],
        "forest":  ["Tripod for low light", "Standard zoom", "Reflector for shaded subjects"],
        "urban":   ["35mm or 50mm prime", "Tripod for blue hour", "Lens hood"],
        "studio":  ["Strobe + softbox", "Reflector", "Color checker"],
    }
    return table.get(cat, [])[:4]


async def _nearby_backups(spot: Dict[str, Any], viewer: Optional[dict]) -> List[Dict[str, Any]]:
    """Find up to 2 approved, public-visible backup spots within
    NEARBY_BACKUPS_RADIUS_KM that are NOT the current spot. Falls back
    to an empty list on any failure."""
    lat = spot.get("latitude")
    lng = spot.get("longitude")
    if lat is None or lng is None:
        return []
    try:
        candidates: List[Dict[str, Any]] = []
        async for s in db.spots.find(
            {
                "privacy_mode": {"$in": ["public", "premium"]},
                "visibility_status": "approved",
                "is_test_data": {"$ne": True},
                "spot_id": {"$ne": spot.get("spot_id")},
            },
            {"_id": 0},
        ):
            slat = s.get("latitude")
            slng = s.get("longitude")
            if slat is None or slng is None:
                continue
            d_km = haversine_km(lat, lng, slat, slng)
            if d_km > NEARBY_BACKUPS_RADIUS_KM:
                continue
            v = public_spot_view(s, viewer)
            if not v:
                continue
            # Distance in miles for the card label.
            v["distance_mi"] = round(d_km * 0.621371, 1)
            v["distance_km"] = round(d_km, 2)
            # Trim payload — the modal only needs hero + identity.
            cover = None
            for img in (s.get("images") or []):
                if img.get("is_cover") and img.get("image_url"):
                    cover = img["image_url"]
                    break
            if not cover and s.get("images"):
                cover = (s["images"][0] or {}).get("image_url")
            candidates.append({
                "spot_id": v.get("spot_id"),
                "title": v.get("title"),
                "city": v.get("city"),
                "state": v.get("state"),
                "category": v.get("category"),
                "best_time_of_day": v.get("best_time_of_day"),
                "quality_score": v.get("quality_score"),
                "distance_mi": v["distance_mi"],
                "cover_image_url": cover,
            })
        candidates.sort(key=lambda c: (c.get("distance_mi") or 99, -(c.get("quality_score") or 0)))
        return candidates[:NEARBY_BACKUPS_LIMIT]
    except Exception:
        return []


# ─────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────

@router.get("/spots/{spot_id}/shoot-plan")
async def get_shoot_plan(
    spot_id: str,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    """Build a shoot plan for the given spot. Auth is optional —
    viewers without an account still see the same plan. Owner-private
    spots are gated (only owner / admins see them) consistent with the
    rest of the spot APIs.
    """
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")

    # Visibility gate: private spots require auth + owner/admin.
    privacy = (spot.get("privacy_mode") or "public").lower()
    if privacy not in ("public", "premium"):
        if not viewer or (
            viewer.get("user_id") != spot.get("owner_user_id")
            and viewer.get("role") not in ("admin", "super_admin", "moderator")
        ):
            raise HTTPException(status_code=403, detail="Private spot")

    lat = spot.get("latitude")
    lng = spot.get("longitude")
    has_coords = isinstance(lat, (int, float)) and isinstance(lng, (int, float))

    # Compute light + fetch weather in parallel for speed.
    if has_coords:
        light_task = asyncio.to_thread(_compute_light_plan, lat, lng)
        weather_task = _fetch_weather(lat, lng)
        backups_task = _nearby_backups(spot, viewer)
        light_plan, weather, backups = await asyncio.gather(
            light_task, weather_task, backups_task,
            return_exceptions=False,
        )
    else:
        light_plan = {"best_time_to_arrive": None, "light_quality_timeline": [], "sun_events": None}
        weather = None
        backups = []

    return {
        "spot_id": spot_id,
        "spot_name": spot.get("title"),
        "coordinates": {"latitude": lat, "longitude": lng} if has_coords else None,
        "best_time_to_arrive": light_plan.get("best_time_to_arrive"),
        "light_quality_timeline": light_plan.get("light_quality_timeline") or [],
        "sun_events": light_plan.get("sun_events"),
        "five_day_weather": weather,  # may be None — client renders fallback
        "weather_available": weather is not None,
        "composition_tips": _composition_tips_for(spot),
        "gear_suggestions": _gear_suggestions_for(spot),
        "nearby_backup_spots": backups,
        "generated_at": utcnow().isoformat(),
    }


@router.post("/collections/save-shoot-plan")
async def save_shoot_plan(
    body: SaveShootPlanIn,
    user: dict = Depends(get_current_user),
):
    """Persist a versioned shoot plan and surface it via the user's
    "Shoot Plans" collection.

    Behaviour:
      • Ensures a default "Shoot Plans" collection exists for the
        signed-in user (creates one on first save). This is a NORMAL
        collection — appears alongside the user's other Collections
        in the existing UI.
      • Adds the spot to that collection (no-op if already present).
      • Writes a new doc to `shoot_plans` with the full payload
        snapshot. Each tap creates a NEW plan_id so history is kept.
    """
    # Validate the spot still exists + is visible to this user.
    spot = await db.spots.find_one({"spot_id": body.spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    privacy = (spot.get("privacy_mode") or "public").lower()
    if privacy not in ("public", "premium"):
        if user.get("user_id") != spot.get("owner_user_id") and user.get("role") not in (
            "admin", "super_admin", "moderator",
        ):
            raise HTTPException(status_code=403, detail="Private spot")

    # 1. Ensure a "Shoot Plans" collection exists for this user.
    col = await db.collections.find_one(
        {"owner_user_id": user["user_id"], "name": SHOOT_PLANS_COLLECTION_NAME, "is_shoot_plans": True},
        {"_id": 0},
    )
    if not col:
        # Try a name-only lookup so we don't duplicate if a user already
        # made a "Shoot Plans" collection manually.
        col = await db.collections.find_one(
            {"owner_user_id": user["user_id"], "name": SHOOT_PLANS_COLLECTION_NAME},
            {"_id": 0},
        )
    if not col:
        cid = f"col_{uuid.uuid4().hex[:12]}"
        col_doc = {
            "collection_id": cid,
            "owner_user_id": user["user_id"],
            "name": SHOOT_PLANS_COLLECTION_NAME,
            "description": "Auto-generated by Plan This Shoot. Holds the spots you've planned a shoot for.",
            "privacy_mode": "private",
            "spot_ids": [],
            "is_shoot_plans": True,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
        await db.collections.insert_one(col_doc)
        col = col_doc
        col.pop("_id", None)

    # 2. Add the spot to that collection (idempotent — no-op if there).
    spot_ids = list(col.get("spot_ids") or [])
    if body.spot_id not in spot_ids:
        spot_ids.append(body.spot_id)
        await db.collections.update_one(
            {"collection_id": col["collection_id"]},
            {"$set": {"spot_ids": spot_ids, "updated_at": utcnow(), "is_shoot_plans": True}},
        )

    # 3. Insert the versioned plan doc.
    plan_id = f"plan_{uuid.uuid4().hex[:14]}"
    plan_doc = {
        "plan_id": plan_id,
        "user_id": user["user_id"],
        "spot_id": body.spot_id,
        "spot_name": body.spot_name or spot.get("title"),
        "coordinates": {
            "latitude": body.latitude if body.latitude is not None else spot.get("latitude"),
            "longitude": body.longitude if body.longitude is not None else spot.get("longitude"),
        },
        "best_time_to_arrive": body.best_time_to_arrive,
        "light_quality_timeline": body.light_quality_timeline,
        "weather_snapshot": body.weather_snapshot,
        "composition_tips": body.composition_tips,
        "gear_suggestions": body.gear_suggestions,
        "backup_spot_ids": body.backup_spot_ids or [],
        "collection_id": col["collection_id"],
        "notes": body.notes,
        "created_at": utcnow(),
    }
    await db.shoot_plans.insert_one(plan_doc)

    return {
        "ok": True,
        "plan_id": plan_id,
        "collection_id": col["collection_id"],
        "collection_name": SHOOT_PLANS_COLLECTION_NAME,
        "message": "Shoot plan saved to Collections.",
    }


@router.get("/me/shoot-plans")
async def list_my_shoot_plans(
    user: dict = Depends(get_current_user),
    spot_id: Optional[str] = None,
    limit: int = 50,
):
    """List the signed-in user's saved shoot plans, newest first.
    Optionally filter to plans for a single spot. Used by the modal
    to show 'You've planned this spot N times before' affordances
    (future). Cheap, indexed by user_id."""
    q: Dict[str, Any] = {"user_id": user["user_id"]}
    if spot_id:
        q["spot_id"] = spot_id
    cur = db.shoot_plans.find(q, {"_id": 0}).sort("created_at", -1).limit(max(1, min(200, limit)))
    items = [p async for p in cur]
    return {"items": items, "count": len(items)}



# ─────────────────────────────────────────────────────────────────────
# Profile portfolio (Jun 2025)
# ─────────────────────────────────────────────────────────────────────

@router.get("/me/portfolio-photos")
async def my_portfolio_photos(
    user: dict = Depends(get_current_user),
    limit: int = 120,
):
    """Return the signed-in user's combined photo portfolio:
      • Photos from spots they uploaded (`spots.images`).
      • Their community uploads (`spot_community_uploads`).

    Dedupes by URL. Returns lightweight thumbnails preferred.
    Used by the Profile "Portfolio" tab masonry grid (Jun 2025).
    Two indexed Mongo queries — never N+1.
    """
    uid = user.get("user_id")
    if not uid:
        return {"items": [], "count": 0}

    seen: set = set()
    items: List[Dict[str, Any]] = []

    # 1. Photos from spots this user owns. Approved + non-private only.
    cur_spots = db.spots.find(
        {
            "owner_user_id": uid,
            "visibility_status": "approved",
            "privacy_mode": {"$in": ["public", "premium"]},
        },
        {"_id": 0, "spot_id": 1, "title": 1, "images": 1, "category": 1, "shoot_types": 1},
    )
    async for s in cur_spots:
        category = s.get("category") or ((s.get("shoot_types") or [None])[0])
        for im in (s.get("images") or []):
            if not isinstance(im, dict):
                continue
            url = im.get("thumb_url") or im.get("thumbnail_url") or im.get("small_url") or im.get("preview_url") or im.get("image_url")
            if not url or url in seen:
                continue
            seen.add(url)
            ar = im.get("aspect_ratio")
            items.append({
                "url": url,
                "spot_id": s.get("spot_id"),
                "spot_title": s.get("title"),
                "category": category,
                "aspect_ratio": float(ar) if isinstance(ar, (int, float)) and ar > 0 else None,
                "source": "spot",
            })
            if len(items) >= limit:
                break
        if len(items) >= limit:
            break

    # 2. Community uploads contributed by this user. Approved + non-private.
    if len(items) < limit:
        try:
            cur_uploads = db.spot_community_uploads.find(
                {
                    "user_id": uid,
                    "$or": [{"moderation_status": "approved"}, {"is_approved": True}],
                    "is_flagged": {"$ne": True},
                    "visibility": {"$ne": "private"},
                },
                {"_id": 0, "spot_id": 1, "image_url": 1, "thumbnail_url": 1, "thumb_url": 1, "aspect_ratio": 1, "category": 1, "created_at": 1},
            ).sort("created_at", -1)
            # Pre-fetch each spot's title + category if missing on the
            # upload doc itself. Batch via $in for perf.
            uploads = [u async for u in cur_uploads]
            spot_ids = list({u.get("spot_id") for u in uploads if u.get("spot_id")})
            spot_meta: Dict[str, Dict[str, Any]] = {}
            if spot_ids:
                async for s in db.spots.find(
                    {"spot_id": {"$in": spot_ids}},
                    {"_id": 0, "spot_id": 1, "title": 1, "category": 1, "shoot_types": 1},
                ):
                    spot_meta[s["spot_id"]] = s
            for u in uploads:
                url = u.get("thumbnail_url") or u.get("thumb_url") or u.get("image_url")
                if not url or url in seen:
                    continue
                seen.add(url)
                meta = spot_meta.get(u.get("spot_id") or "", {})
                category = u.get("category") or meta.get("category") or ((meta.get("shoot_types") or [None])[0])
                ar = u.get("aspect_ratio")
                items.append({
                    "url": url,
                    "spot_id": u.get("spot_id"),
                    "spot_title": meta.get("title"),
                    "category": category,
                    "aspect_ratio": float(ar) if isinstance(ar, (int, float)) and ar > 0 else None,
                    "source": "community",
                })
                if len(items) >= limit:
                    break
        except Exception:
            # Community uploads are non-critical — never break the tab.
            pass

    return {"items": items, "count": len(items)}
