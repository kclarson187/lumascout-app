"""
routes/weather.py — Unified weather endpoint (Jun 2025)
═══════════════════════════════════════════════════════

Why this exists
───────────────
The frontend's home hero (and Spot Detail / shoot plan tiles) want a
single, simple weather payload. Previously the only weather data came
from Open-Meteo via shoot_plan.py — but Elite tier promises premium
data, so we add Apple WeatherKit as the primary source with Open-Meteo
as a graceful fallback when WeatherKit returns 4xx/5xx or isn't
configured.

Endpoint
────────
  GET /api/weather?lat={lat}&lng={lng}
       optional:  &include=current,hourly,daily,alerts
                  &timezone=America/Chicago   (IANA tz; improves alignment)
                  &country=US                  (required for weather alerts)

Returns a normalized payload (all platforms read this same shape):

  {
    "ok": true,
    "source": "weatherkit" | "open_meteo" | "none",
    "as_of": "2026-06-01T16:00:00Z",
    "current": {
      "temp_f": 78, "temp_c": 26,
      "condition_code": "PartlyCloudy",
      "label": "Partly Cloudy",
      "sf_symbol": "cloud.sun.fill",
      "precip_chance_pct": 5,
      "wind_mph": 8,
      "humidity_pct": 0.45,
      "uv_index": 6,
      "is_daylight": true
    },
    "hourly": [{...} × 24],
    "daily": [{...} × up to 10],
    "alerts": [{...}],     # only when country code provided
    "attribution_url": "https://weatherkit.apple.com/legal-attribution.html"
  }

Caching
───────
Responses are cached in Mongo collection `weather_cache` keyed by:
  • lat/lng rounded to 2 decimals (~1.1 km grid)
  • include-set
TTLs:
  • current/hourly: 15 min
  • daily:          60 min
We blend two TTLs by storing `expires_at` on the doc and using a
TTL index that lets MongoDB delete expired rows automatically.

Free vs Pro vs Elite tier gating
────────────────────────────────
This endpoint is OPEN (no auth required) by design — the home hero on
unauthenticated previews should still render a single-line weather pill.
However, the response is intentionally tier-aware:

  • Free:  current only (frontend uses temp_f + label).
  • Pro:   current + hourly + daily.
  • Elite: current + hourly + daily + alerts.

If the caller is authenticated, we tailor the payload to their plan.
If unauthenticated, we return current only (no hourly/daily/alerts).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, HTTPException, Query, Depends

from server import db, get_optional_user, plan_of, _effective_plan
from services.weatherkit import (
    fetch_weather as fetch_weatherkit,
    weatherkit_configured,
    sf_symbol_for,
    human_label_for,
    c_to_f, mps_to_mph, mm_to_in,
    DATASET_CURRENT, DATASET_HOURLY, DATASET_DAILY, DATASET_ALERTS, DATASET_MINUTE,
)
from services.apns import apns_configured  # for /api/weather/config diagnostic

log = logging.getLogger("lumascout.weather")

router = APIRouter(prefix="/api", tags=["weather"])

# ─────────────────────────────────────────────────────────────────────
# Tunables
# ─────────────────────────────────────────────────────────────────────
WEATHER_CACHE_COLL = "weather_cache"
CACHE_TTL_CURRENT_MIN = 15
CACHE_TTL_DAILY_MIN   = 60

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_TIMEOUT_S = 4.5

# Tier-based include defaults.
#
# Elite adds five new payload buckets on top of pro:
#   • 10-day daily forecast (auto when 'daily' is requested and plan='elite')
#   • severe weather alerts (only when `country` query param supplied)
#   • minute-by-minute precipitation (next 60 min)
#   • moon phase/illumination/moonrise/moonset (enriched into daily)
#   • golden_hour / blue_hour windows for each day (computed from sunrise/sunset)
#   • visibility miles+km (enriched into current)
#   • cloud_cover_pct on current & hourly (enriched in place)
#   • best_times — top-3 server-side ranked shooting windows for next 48h
INCLUDE_BY_PLAN: Dict[str, List[str]] = {
    "anon":  ["current"],
    "free":  ["current"],
    "pro":   ["current", "hourly", "daily"],
    "elite": ["current", "hourly", "daily", "alerts", "minute", "best_times"],
}

# Map our short include names to WeatherKit dataset names.
# best_times is a server-side computation, not a WeatherKit dataset, so it
# is intentionally absent from this mapping (we just consume `daily`+`hourly`).
INCLUDE_TO_DATASET: Dict[str, str] = {
    "current": DATASET_CURRENT,
    "hourly":  DATASET_HOURLY,
    "daily":   DATASET_DAILY,
    "alerts":  DATASET_ALERTS,
    "minute":  DATASET_MINUTE,
}

# "best_times" is derived; the upstream datasets it depends on:
BEST_TIMES_REQUIRES = {"hourly", "daily"}

# Days returned: pro=5, elite=10. Free/anon don't get daily at all,
# but we keep generous defaults in case a route ever bypasses the gate.
DAILY_DAYS_BY_PLAN = {"anon": 0, "free": 0, "pro": 5, "elite": 10}

# ─────────────────────────────────────────────────────────────────────
# Tier feature catalog (Jun-2026 spec)
#
# This is the canonical answer to "what does each tier unlock on the
# weather payload?" — shared between the API response wrapper and the
# /api/weather/config diagnostic. Keep this in sync with INCLUDE_BY_PLAN
# and the strip-helper below.
#
# Frontend reads `available_features` + `locked_features` to decide
# which cards to render and which to show as upgrade teasers. The set is
# semantic (e.g. "ten_day_forecast"), not field-name-shaped, so the
# frontend doesn't need to know about Apple's WeatherKit dataset names.
# ─────────────────────────────────────────────────────────────────────
TIER_FEATURE_CATALOG: Dict[str, Dict[str, Any]] = {
    "anon": {
        "available": ["current", "sunrise_sunset"],
        "locked":    ["hourly", "daily", "ten_day_forecast",
                      "severe_weather_alerts", "minute_precipitation",
                      "sun_path_planning", "best_simple_window",
                      "best_time_to_shoot_48h", "lunar_data"],
        "upgrade_target": "pro",
    },
    "free": {
        "available": ["current", "sunrise_sunset"],
        "locked":    ["hourly", "daily", "ten_day_forecast",
                      "severe_weather_alerts", "minute_precipitation",
                      "sun_path_planning", "best_simple_window",
                      "best_time_to_shoot_48h", "lunar_data"],
        "upgrade_target": "pro",
    },
    "pro": {
        "available": ["current", "hourly", "daily", "sunrise_sunset",
                      "best_simple_window"],
        "locked":    ["ten_day_forecast", "severe_weather_alerts",
                      "minute_precipitation", "sun_path_planning",
                      "best_time_to_shoot_48h", "lunar_data"],
        "upgrade_target": "elite",
    },
    "elite": {
        "available": ["current", "hourly", "daily", "ten_day_forecast",
                      "sunrise_sunset", "severe_weather_alerts",
                      "minute_precipitation", "sun_path_planning",
                      "best_simple_window", "best_time_to_shoot_48h",
                      "lunar_data"],
        "locked":    [],
        "upgrade_target": None,
    },
}


def tier_feature_block(plan: str) -> Dict[str, Any]:
    """Return {tier, available_features, locked_features, upgrade_target}
    for the given plan. Defaults to 'anon' if plan is unknown."""
    entry = TIER_FEATURE_CATALOG.get(plan) or TIER_FEATURE_CATALOG["anon"]
    return {
        "tier": "anon" if plan == "anon" else plan,
        "available_features": list(entry["available"]),
        "locked_features":    list(entry["locked"]),
        "upgrade_target":     entry["upgrade_target"],
    }


# ─────────────────────────────────────────────────────────────────────
# Centralized entitlement resolver (Jun 2026)
#
# Replaces the old `(user or {}).get("plan") or "anon"` ad-hoc lookups
# with a single source-of-truth resolver that honors:
#
#   1. Super-admin / admin / moderator / support / founding_scout roles
#      → auto-Elite (delegated to `plan_of()` in server.py).
#   2. Comp / trial overrides (comp_pro, comp_elite, trial_pro,
#      trial_elite) with expiry checks (delegated to `plan_of()`).
#   3. Active Stripe subscriptions (the `plan` field is written by the
#      Stripe webhook → trusted directly).
#   4. Free for logged-in users with no entitlement.
#   5. Anon for unauthenticated callers.
#
# The output is normalized to the four canonical buckets the weather
# routes know how to gate on: anon | free | pro | elite. Comp/trial
# plans collapse to their underlying tier via `_effective_plan()`.
# ─────────────────────────────────────────────────────────────────────
def _resolve_user_tier(user: Optional[Dict[str, Any]]) -> str:
    """Return one of: 'anon' | 'free' | 'pro' | 'elite'.

    Uses the same `plan_of()` resolver every other entitlement check in
    the app calls, so weather gating is guaranteed to match paywalls,
    save-limits, etc. Comp/trial plans are flattened to their underlying
    tier ('comp_elite' → 'elite', 'trial_pro' → 'pro') because the
    weather feature catalog is keyed on the canonical four.
    """
    if not user:
        return "anon"
    raw = plan_of(user)                       # honors role-based comp + expiry
    eff = _effective_plan(raw)                # comp_pro → pro, comp_elite → elite
    # `suspended` accounts shouldn't get any paid features.
    if eff in ("free", "pro", "elite"):
        return eff
    return "free"


def _debug_should_log(user: Optional[Dict[str, Any]]) -> bool:
    """Decide whether to emit verbose tier-resolution debug logs.

    Auto-on for admins/super_admins (so we can debug their own accounts
    without redeploying), and gated by WEATHER_DEBUG_TIER=1 for everyone
    else. Cheap to call — short-circuits on the env flag.
    """
    if os.environ.get("WEATHER_DEBUG_TIER") == "1":
        return True
    if not user:
        return False
    return (user.get("role") in ("admin", "super_admin"))


def _log_tier_resolution(
    user: Optional[Dict[str, Any]],
    *,
    resolved: str,
    endpoint: str,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Emit a single structured info-line capturing how a user's tier
    was resolved. Safe to call on every request — does nothing unless
    `_debug_should_log()` is true."""
    if not _debug_should_log(user):
        return
    fields = {
        "endpoint": endpoint,
        "user_id":  (user or {}).get("user_id") or (user or {}).get("id"),
        "email":    (user or {}).get("email"),
        "role":     (user or {}).get("role"),
        "raw_plan": (user or {}).get("plan"),
        "plan_of":  plan_of(user) if user else None,
        "effective":  resolved,
        "comp_expiration": (user or {}).get("comp_expiration"),
        "stripe_subscription_id": (user or {}).get("stripe_subscription_id"),
        "stripe_status": (user or {}).get("subscription_status"),
    }
    if extra:
        fields.update(extra)
    log.info("weather_tier_resolution %s", fields)


# Apple's required attribution URL (must be linked from any UI showing
# WeatherKit data — see Apple's legal terms).
APPLE_ATTRIBUTION_URL = "https://weatherkit.apple.com/legal-attribution.html"


# ─────────────────────────────────────────────────────────────────────
# Cache helpers
# ─────────────────────────────────────────────────────────────────────
def _round_coord(v: float, ndigits: int = 2) -> float:
    """Round lat/lng to ~1.1km grid for cache key reuse."""
    return round(v, ndigits)


def _cache_key(lat: float, lng: float, include: Tuple[str, ...]) -> str:
    # `v2:` prefix bumped Jun 2026 to invalidate stale entries that
    # contained the visibility-meters-as-km bug (visibility_mi was the
    # raw meter value). Bump again if normalizer shape changes.
    return f"v2:{_round_coord(lat)}:{_round_coord(lng)}:{','.join(sorted(include))}"


async def _ensure_indexes() -> None:
    """Create TTL + lookup indexes once on first call. Cheap, idempotent."""
    try:
        await db[WEATHER_CACHE_COLL].create_index(
            "expires_at", expireAfterSeconds=0
        )
        await db[WEATHER_CACHE_COLL].create_index("key")
    except Exception as e:
        log.debug("weather_cache_index_skip err=%r", e)


async def _cache_get(key: str) -> Optional[Dict[str, Any]]:
    try:
        await _ensure_indexes()
        doc = await db[WEATHER_CACHE_COLL].find_one({"key": key})
        if not doc:
            return None
        # Defense in depth: even if TTL hasn't reaped yet, treat as expired.
        # MongoDB stores datetimes as naive UTC, so compare against naive utcnow.
        exp = doc.get("expires_at")
        if exp is not None:
            if exp.tzinfo is not None:
                exp = exp.replace(tzinfo=None)
            if exp < datetime.utcnow():
                return None
        payload = doc.get("payload") or {}
        # Mark as cache hit so callers can monitor.
        payload["cached"] = True
        return payload
    except Exception as e:
        log.debug("weather_cache_get_err err=%r", e)
        return None


async def _cache_put(
    key: str, payload: Dict[str, Any], *, ttl_min: int
) -> None:
    try:
        await _ensure_indexes()
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=ttl_min)
        await db[WEATHER_CACHE_COLL].update_one(
            {"key": key},
            {"$set": {
                "key": key,
                "payload": payload,
                "expires_at": expires_at,
                "updated_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
    except Exception as e:
        log.debug("weather_cache_put_err err=%r", e)


# ─────────────────────────────────────────────────────────────────────
# Normalizers — Apple WeatherKit JSON → our shape
# ─────────────────────────────────────────────────────────────────────
def _norm_apple_current(cur: Dict[str, Any]) -> Dict[str, Any]:
    t_c = cur.get("temperature")
    cond = cur.get("conditionCode")
    # WeatherKit `visibility` is METERS per Apple's REST schema, NOT
    # kilometers. Convert m → km → mi so the UI displays sane values
    # (was previously showing ~23,000 "miles" — the raw meter value).
    vis_m = cur.get("visibility")
    vis_km = (vis_m / 1000.0) if isinstance(vis_m, (int, float)) else None
    return {
        "temp_f": _r(c_to_f(t_c)),
        "temp_c": _r(t_c),
        "feels_like_f": _r(c_to_f(cur.get("temperatureApparent"))),
        "condition_code": cond,
        "label": human_label_for(cond),
        "sf_symbol": sf_symbol_for(cond),
        "precip_chance_pct": _r(_pct(cur.get("precipitationIntensity"))),
        "wind_mph": _r(mps_to_mph(cur.get("windSpeed"))),
        "wind_dir_deg": cur.get("windDirection"),
        "humidity_pct": cur.get("humidity"),  # already 0-1
        "uv_index": cur.get("uvIndex"),
        "visibility_mi": _r(_km_to_mi(vis_km)),
        "visibility_km": _r(vis_km),
        "cloud_cover_pct": _pct_from_fraction(cur.get("cloudCover")),
        "pressure_mb": cur.get("pressure"),
        "is_daylight": cur.get("daylight"),
        "as_of": cur.get("asOf"),
    }


def _norm_apple_hourly(hours: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for h in hours[:24]:
        cond = h.get("conditionCode")
        out.append({
            "time": h.get("forecastStart"),
            "temp_f": _r(c_to_f(h.get("temperature"))),
            "temp_c": _r(h.get("temperature")),
            "condition_code": cond,
            "label": human_label_for(cond),
            "sf_symbol": sf_symbol_for(cond),
            "precip_chance_pct": _r(_pct_from_fraction(h.get("precipitationChance"))),
            "wind_mph": _r(mps_to_mph(h.get("windSpeed"))),
            "humidity_pct": h.get("humidity"),
            "cloud_cover_pct": _pct_from_fraction(h.get("cloudCover")),
            "uv_index": h.get("uvIndex"),
            "is_daylight": h.get("daylight"),
        })
    return out


def _norm_apple_daily(days: List[Dict[str, Any]], *, limit: int = 7) -> List[Dict[str, Any]]:
    """Normalize Apple's daily forecast.

    Elite plans pass limit=10 to get the full 10-day window WeatherKit
    supports; everyone else stays at 7. Moon illumination is computed
    from the moonPhase name when Apple doesn't include moonPhaseAngle.
    """
    out: List[Dict[str, Any]] = []
    for d in days[:limit]:
        cond = d.get("conditionCode")
        moon_phase = d.get("moonPhase")
        out.append({
            "date": d.get("forecastStart"),
            "high_f": _r(c_to_f(d.get("temperatureMax"))),
            "high_c": _r(d.get("temperatureMax")),
            "low_f":  _r(c_to_f(d.get("temperatureMin"))),
            "low_c":  _r(d.get("temperatureMin")),
            "condition_code": cond,
            "label": human_label_for(cond),
            "sf_symbol": sf_symbol_for(cond),
            "precip_chance_pct": _r(_pct_from_fraction(d.get("precipitationChance"))),
            "uv_index_max": d.get("maxUvIndex"),
            "sunrise": d.get("sunrise"),
            "sunset":  d.get("sunset"),
            "moonrise": d.get("moonrise"),
            "moonset":  d.get("moonset"),
            "moon_phase": moon_phase,
            "moon_phase_label": _moon_phase_label(moon_phase),
            "moon_illumination_pct": _moon_illumination_pct(moon_phase),
        })
    return out


def _norm_apple_alerts(alerts_block: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Surface every field the Elite UI needs: event/severity/source/onset/
    expires/description + a direct link to the issuer's detailsUrl."""
    out: List[Dict[str, Any]] = []
    items = (alerts_block or {}).get("alerts") or []
    for a in items[:10]:
        out.append({
            "id":          a.get("id"),
            "event":       a.get("eventOnsetTime") and a.get("description") or a.get("description"),
            "description": a.get("description"),
            "severity":    a.get("severity"),
            "certainty":   a.get("certainty"),
            "urgency":     a.get("urgency"),
            "source":      a.get("source"),
            "issued_at":   a.get("issuedTime"),
            "onset":       a.get("eventOnsetTime"),
            "expires":     a.get("eventEndTime") or a.get("expireTime"),
            "regions":     a.get("areaName") and [a.get("areaName")] or None,
            "url":         a.get("detailsUrl"),
        })
    return out


def _norm_apple_minute(minute_block: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Apple's `forecastNextHour` block has `minutes`, `summary`, and a
    high-level "is it about to rain?" hint. We surface a compact shape:
        {
          "summary": "Rain starting in ~12 min",
          "starts_in_min": 12,
          "minutes": [{"time": "...", "intensity_mm_h": 0.4, "chance_pct": 80}, …×60]
        }
    Returns None if the block is missing (WeatherKit doesn't have
    minute-level data for every region — common outside the US/EU)."""
    if not minute_block:
        return None
    minutes_raw = minute_block.get("minutes") or []
    minutes: List[Dict[str, Any]] = []
    starts_in_min: Optional[int] = None
    for i, m in enumerate(minutes_raw[:60]):
        intensity = m.get("precipitationIntensity")
        chance = m.get("precipitationChance")
        minutes.append({
            "time": m.get("startTime"),
            "intensity_mm_h": _r(intensity),
            "chance_pct": _r(_pct_from_fraction(chance)),
        })
        if starts_in_min is None and intensity is not None and intensity > 0.01:
            starts_in_min = i
    summary = None
    if isinstance(minute_block.get("summary"), list) and minute_block["summary"]:
        s0 = minute_block["summary"][0] or {}
        summary = s0.get("condition") or None
    if not minutes:
        return None
    return {
        "summary": summary,
        "starts_in_min": starts_in_min,
        "minutes": minutes,
    }


# ─────────────────────────────────────────────────────────────────────
# Moon-phase helpers
# ─────────────────────────────────────────────────────────────────────
# Apple returns one of these moonPhase strings.
_MOON_PHASE_LABELS: Dict[str, str] = {
    "new":             "New Moon",
    "waxingCrescent":  "Waxing Crescent",
    "firstQuarter":    "First Quarter",
    "waxingGibbous":   "Waxing Gibbous",
    "full":            "Full Moon",
    "waningGibbous":   "Waning Gibbous",
    "lastQuarter":     "Last Quarter",
    "waningCrescent":  "Waning Crescent",
}
# Mid-phase illumination (%). Real-day value oscillates; this is a stable
# label-level approximation good enough for a photographer's planning UI.
_MOON_PHASE_ILLUMINATION: Dict[str, float] = {
    "new":             0,
    "waxingCrescent":  25,
    "firstQuarter":    50,
    "waxingGibbous":   75,
    "full":            100,
    "waningGibbous":   75,
    "lastQuarter":     50,
    "waningCrescent":  25,
}


def _moon_phase_label(phase: Optional[str]) -> Optional[str]:
    if not phase:
        return None
    return _MOON_PHASE_LABELS.get(phase, phase)


def _moon_illumination_pct(phase: Optional[str]) -> Optional[float]:
    if not phase:
        return None
    return _MOON_PHASE_ILLUMINATION.get(phase)


# ─────────────────────────────────────────────────────────────────────
# Golden / Blue Hour from sunrise + sunset (per day)
# Spec:
#   golden hour AM:  sunrise          → sunrise + 30 min
#   golden hour PM:  sunset  - 30 min → sunset
#   blue   hour AM:  sunrise - 20 min → sunrise
#   blue   hour PM:  sunset           → sunset  + 20 min
# ─────────────────────────────────────────────────────────────────────
def _compute_golden_blue_for_day(day: Dict[str, Any]) -> Dict[str, Any]:
    """Return {"golden_hour":{"am":{start,end},"pm":{...}}, "blue_hour":{...}}.
    Tolerates missing sunrise/sunset by returning None for that side."""
    sr = _parse_iso(day.get("sunrise"))
    ss = _parse_iso(day.get("sunset"))
    out: Dict[str, Any] = {"golden_hour": {"am": None, "pm": None},
                            "blue_hour":   {"am": None, "pm": None}}
    if sr is not None:
        out["golden_hour"]["am"] = {
            "start": sr.isoformat(),
            "end":   (sr + timedelta(minutes=30)).isoformat(),
        }
        out["blue_hour"]["am"] = {
            "start": (sr - timedelta(minutes=20)).isoformat(),
            "end":   sr.isoformat(),
        }
    if ss is not None:
        out["golden_hour"]["pm"] = {
            "start": (ss - timedelta(minutes=30)).isoformat(),
            "end":   ss.isoformat(),
        }
        out["blue_hour"]["pm"] = {
            "start": ss.isoformat(),
            "end":   (ss + timedelta(minutes=20)).isoformat(),
        }
    return out


def _enrich_daily_with_light_windows(daily: List[Dict[str, Any]]) -> None:
    """Mutates each daily entry to add golden_hour + blue_hour blocks."""
    for d in daily:
        windows = _compute_golden_blue_for_day(d)
        d["golden_hour"] = windows["golden_hour"]
        d["blue_hour"]   = windows["blue_hour"]


# ─────────────────────────────────────────────────────────────────────
# Best Time to Shoot — server-side ranking
#
# Walk the next 48 hours of `hourly`. For each hour:
#   - quality = passes_clouds(<30%) AND passes_precip(<10%) AND passes_wind(<15mph)
#   - in_window = falls into ANY golden_hour or blue_hour for the
#                 corresponding day
# Group contiguous hours that are BOTH quality and in_window into
# "windows". Score each by: shorter windows that align with golden
# hour rank higher than longer dawn-to-dusk clear days. Return top 3.
# ─────────────────────────────────────────────────────────────────────
BEST_TIME_CLOUD_MAX     = 30.0
BEST_TIME_PRECIP_MAX    = 10.0
BEST_TIME_WIND_MAX      = 15.0
BEST_TIME_LOOKAHEAD_H   = 48


def _hour_passes_quality(h: Dict[str, Any]) -> bool:
    cc = h.get("cloud_cover_pct")
    pp = h.get("precip_chance_pct")
    ws = h.get("wind_mph")
    # Treat missing fields as "pass" so a region with no cloud data
    # doesn't blank out the whole feature. The downstream UI badge can
    # still surface "data may be partial".
    if cc is not None and cc > BEST_TIME_CLOUD_MAX:
        return False
    if pp is not None and pp > BEST_TIME_PRECIP_MAX:
        return False
    if ws is not None and ws > BEST_TIME_WIND_MAX:
        return False
    return True


def _hour_in_light_window(h_time: Optional[datetime], daily: List[Dict[str, Any]]) -> Optional[str]:
    """Return 'golden' or 'blue' if h_time falls in any window across the
    next several days; None otherwise."""
    if h_time is None:
        return None
    for d in daily:
        gh = d.get("golden_hour") or {}
        bh = d.get("blue_hour") or {}
        for side in ("am", "pm"):
            g = gh.get(side)
            if g and _between(h_time, g["start"], g["end"]):
                return "golden"
            b = bh.get(side)
            if b and _between(h_time, b["start"], b["end"]):
                return "blue"
    return None


def _between(t: datetime, start_iso: str, end_iso: str) -> bool:
    s = _parse_iso(start_iso); e = _parse_iso(end_iso)
    if s is None or e is None:
        return False
    return s <= t <= e


def _compute_best_times(
    hourly: List[Dict[str, Any]], daily: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Return up to 3 ranked time windows for the next 48 hours."""
    if not hourly or not daily:
        return []
    # Each hourly item is annotated with quality + window type.
    annotated: List[Dict[str, Any]] = []
    for h in hourly[:BEST_TIME_LOOKAHEAD_H]:
        ht = _parse_iso(h.get("time"))
        passes = _hour_passes_quality(h)
        win = _hour_in_light_window(ht, daily)
        annotated.append({
            "h": h, "time": ht, "passes": passes, "window": win,
        })

    # Group contiguous (passes AND window-present) hours.
    groups: List[List[Dict[str, Any]]] = []
    cur: List[Dict[str, Any]] = []
    for row in annotated:
        if row["passes"] and row["window"]:
            cur.append(row)
        else:
            if cur:
                groups.append(cur); cur = []
    if cur:
        groups.append(cur)

    # Score each group. Higher = better.
    def score(group: List[Dict[str, Any]]) -> float:
        if not group:
            return 0.0
        # Reward golden over blue and reward concentrated windows.
        golden_count = sum(1 for r in group if r["window"] == "golden")
        blue_count   = sum(1 for r in group if r["window"] == "blue")
        # Average clouds (lower is better).
        clouds = [r["h"].get("cloud_cover_pct") for r in group if r["h"].get("cloud_cover_pct") is not None]
        avg_clouds = sum(clouds) / len(clouds) if clouds else 50.0
        # The closer in time, the more relevant.
        first_t = group[0]["time"]
        proximity_bonus = 0.0
        if first_t is not None:
            hours_away = max(0.0, (first_t - datetime.utcnow().replace(tzinfo=first_t.tzinfo)).total_seconds() / 3600)
            proximity_bonus = max(0.0, 24 - hours_away) * 0.3
        return (golden_count * 3.0 + blue_count * 2.0) + (100 - avg_clouds) * 0.05 + proximity_bonus

    groups.sort(key=score, reverse=True)
    top = groups[:3]

    out: List[Dict[str, Any]] = []
    for g in top:
        first = g[0]; last = g[-1]
        window_type = "golden" if any(r["window"] == "golden" for r in g) else "blue"
        label = _human_window_label(first["time"], window_type, first["h"])
        avg_clouds = None
        clouds = [r["h"].get("cloud_cover_pct") for r in g if r["h"].get("cloud_cover_pct") is not None]
        if clouds:
            avg_clouds = round(sum(clouds) / len(clouds), 1)
        out.append({
            "start": first["h"].get("time"),
            "end":   last["h"].get("time"),
            "window_type": window_type,
            "label": label,
            "hours": len(g),
            "avg_cloud_cover_pct": avg_clouds,
            "score": round(score(g), 2),
        })
    return out


def _human_window_label(t: Optional[datetime], window_type: str, h: Dict[str, Any]) -> str:
    """Generate a label like 'Tomorrow — Golden Hour, Clear Skies'."""
    if t is None:
        return f"{window_type.title()} Hour"
    now = datetime.utcnow().replace(tzinfo=t.tzinfo)
    delta_days = (t.date() - now.date()).days
    when = "Today" if delta_days <= 0 else "Tomorrow" if delta_days == 1 else t.strftime("%a")
    cond = h.get("label") or "Clear"
    return f"{when} — {window_type.title()} Hour, {cond}"


# ─────────────────────────────────────────────────────────────────────
# Pro Photo Planning — lightweight server-calculated daily plan
#
# Distinct from Elite's _compute_best_times in three ways:
#   1. Scope: today only (Elite spans next 48h).
#   2. Algorithm: simple, deterministic preferences (Elite uses ranked scoring).
#   3. Shape: a single object with `today*` keys + one `bestSimpleWindow`,
#      not an array of ranked windows.
#
# Pro users see "When is golden hour today, and which is better — morning
# or evening?" without unlocking Elite's premium ranking engine.
# ─────────────────────────────────────────────────────────────────────
PRO_PLAN_PRECIP_MAX = 20.0     # prefer < 20%
PRO_PLAN_WIND_MAX   = 20.0     # prefer < 20 mph
PRO_PLAN_CLOUD_MAX  = 50.0     # prefer < 50%


def _window_dict(start: Optional[datetime], end: Optional[datetime]) -> Optional[Dict[str, str]]:
    if start is None or end is None:
        return None
    return {"start": start.isoformat(), "end": end.isoformat()}


def _compute_photo_planning(
    daily: List[Dict[str, Any]],
    hourly: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Build Pro's `photoPlanning` object for *today*.

    Returns None when we don't have enough data (no daily / no sunrise &
    sunset) — caller should then omit the field rather than emit broken
    data, per spec.
    """
    if not daily:
        return None
    today = daily[0]
    sr = _parse_iso(today.get("sunrise"))
    ss = _parse_iso(today.get("sunset"))
    if sr is None and ss is None:
        return None

    # Build windows.
    gh_am = _window_dict(sr, (sr + timedelta(minutes=30))) if sr else None
    gh_pm = _window_dict((ss - timedelta(minutes=30)), ss) if ss else None
    bh_am = _window_dict((sr - timedelta(minutes=20)), sr) if sr else None
    bh_pm = _window_dict(ss, (ss + timedelta(minutes=20))) if ss else None

    # Choose bestSimpleWindow: prefer golden, prefer favorable hourly stats,
    # prefer the next-upcoming golden window over a past one.
    best = _choose_best_simple_window(gh_am, gh_pm, hourly)

    out: Dict[str, Any] = {
        "todayGoldenHourMorning": gh_am,
        "todayGoldenHourEvening": gh_pm,
        "todayBlueHourMorning":   bh_am,
        "todayBlueHourEvening":   bh_pm,
        "sunrise": today.get("sunrise"),
        "sunset":  today.get("sunset"),
        "bestSimpleWindow": best,
    }
    return out


def _choose_best_simple_window(
    gh_am: Optional[Dict[str, str]],
    gh_pm: Optional[Dict[str, str]],
    hourly: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Pick today's recommended shoot window with a simple ruleset:
      • Prefer golden hour (Pro never sees blue-only recs)
      • Prefer a window where the overlapping hourly entry shows
        precipitation < 20%, wind < 20 mph, cloud cover < 50%
      • Prefer the next-upcoming window relative to "now"
    Returns a dict like:
      {"label": "Tonight — Golden Hour",
       "start": "...", "end": "...",
       "reason": "Low wind, low rain chance, and better light near sunset."}
    """
    candidates: List[Dict[str, Any]] = []
    for tag, w in (("morning", gh_am), ("evening", gh_pm)):
        if not w:
            continue
        score = _score_simple_window(w, hourly)
        if score is None:
            continue
        candidates.append({"tag": tag, "window": w, **score})

    if not candidates:
        return None

    now = datetime.utcnow()
    # Phase 1: include only future windows (haven't ended yet).
    def _ends_in_future(c: Dict[str, Any]) -> bool:
        end = _parse_iso(c["window"]["end"])
        return end is not None and (end.replace(tzinfo=None) if end.tzinfo else end) > now

    future = [c for c in candidates if _ends_in_future(c)]
    pool   = future or candidates  # if every golden hour is past, pick "today" anyway

    # Phase 2: prefer windows that pass ALL preferences.
    passing = [c for c in pool if c["passes_all"]]
    pool2 = passing or pool

    # Phase 3: if both AM and PM survive, prefer PM (sunset/"tonight" feel).
    pool2.sort(key=lambda c: 0 if c["tag"] == "evening" else 1)
    chosen = pool2[0]
    w = chosen["window"]
    label = "Tonight — Golden Hour" if chosen["tag"] == "evening" else "Today — Golden Hour"
    return {
        "label": label,
        "start": w["start"],
        "end":   w["end"],
        "reason": chosen["reason"],
    }


def _score_simple_window(
    w: Dict[str, str], hourly: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """Inspect the hourly entry overlapping the window's start time and
    summarize the conditions. Returns None if we cannot find an overlap
    (caller will fall back to a weaker recommendation)."""
    start_dt = _parse_iso(w["start"])
    if start_dt is None or not hourly:
        # Without data, we still allow the recommendation but with a
        # generic reason ("Best natural light of the day.").
        return {
            "passes_all": False,
            "precip_ok":  None,
            "wind_ok":    None,
            "cloud_ok":   None,
            "reason":     "Best natural light of the day.",
        }
    # Find the hourly entry whose forecast window contains start_dt (we
    # assume each hour entry covers [time, time+1h)).
    overlap = None
    for h in hourly:
        ht = _parse_iso(h.get("time"))
        if ht is None:
            continue
        # Normalize tz: compare naive.
        ht_naive = ht.replace(tzinfo=None) if ht.tzinfo else ht
        st_naive = start_dt.replace(tzinfo=None) if start_dt.tzinfo else start_dt
        if ht_naive <= st_naive < ht_naive + timedelta(hours=1):
            overlap = h
            break
    if overlap is None:
        return {
            "passes_all": False,
            "precip_ok":  None,
            "wind_ok":    None,
            "cloud_ok":   None,
            "reason":     "Best natural light of the day.",
        }
    precip = overlap.get("precip_chance_pct")
    wind   = overlap.get("wind_mph")
    cloud  = overlap.get("cloud_cover_pct")
    precip_ok = precip is None or precip < PRO_PLAN_PRECIP_MAX
    wind_ok   = wind   is None or wind   < PRO_PLAN_WIND_MAX
    cloud_ok  = cloud  is None or cloud  < PRO_PLAN_CLOUD_MAX
    passes_all = precip_ok and wind_ok and cloud_ok

    reasons: List[str] = []
    if wind_ok and wind is not None:
        reasons.append("low wind")
    if precip_ok and precip is not None:
        reasons.append("low rain chance")
    if cloud_ok and cloud is not None:
        reasons.append("clearer skies")
    if not reasons:
        # Lean negative — call out what's likely to disappoint.
        if precip is not None and not precip_ok:
            reasons.append("rain risk later")
        if wind is not None and not wind_ok:
            reasons.append("breezy conditions")
        if cloud is not None and not cloud_ok:
            reasons.append("heavier cloud cover")
    reason_clause = ", ".join(reasons) if reasons else "favorable golden light"
    reason = f"{reason_clause.capitalize()} during golden hour."
    return {
        "passes_all": passes_all,
        "precip_ok":  precip_ok,
        "wind_ok":    wind_ok,
        "cloud_ok":   cloud_ok,
        "reason":     reason,
    }


# ─────────────────────────────────────────────────────────────────────
# ISO datetime helper
# ─────────────────────────────────────────────────────────────────────
def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        # Apple returns RFC3339 with Z; fromisoformat in Python 3.11+
        # accepts that pattern directly.
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────
# Open-Meteo fallback (no auth, public API)
# ─────────────────────────────────────────────────────────────────────
_OM_CODE_LABEL: Dict[int, str] = {
    0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Overcast",
    45: "Fog", 48: "Fog",
    51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
    61: "Rain", 63: "Rain", 65: "Rain",
    71: "Snow", 73: "Snow", 75: "Snow",
    80: "Showers", 81: "Showers", 82: "Showers",
    95: "Thunderstorms", 96: "Thunderstorms", 99: "Thunderstorms",
}
_OM_CODE_SYMBOL: Dict[int, str] = {
    0: "sun.max.fill", 1: "sun.max.fill", 2: "cloud.sun.fill", 3: "cloud.fill",
    45: "cloud.fog.fill", 48: "cloud.fog.fill",
    51: "cloud.drizzle.fill", 53: "cloud.drizzle.fill", 55: "cloud.drizzle.fill",
    61: "cloud.rain.fill", 63: "cloud.rain.fill", 65: "cloud.heavyrain.fill",
    71: "cloud.snow.fill", 73: "cloud.snow.fill", 75: "snowflake",
    80: "cloud.rain.fill", 81: "cloud.rain.fill", 82: "cloud.heavyrain.fill",
    95: "cloud.bolt.fill", 96: "cloud.bolt.rain.fill", 99: "cloud.bolt.rain.fill",
}


async def _fetch_open_meteo(lat: float, lng: float, include: Tuple[str, ...]) -> Optional[Dict[str, Any]]:
    """Fallback: query Open-Meteo and adapt to our normalized shape."""
    params = {
        "latitude": lat,
        "longitude": lng,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,uv_index,is_day",
        "hourly": "temperature_2m,precipitation_probability,weather_code,wind_speed_10m,uv_index,is_day",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset",
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "timezone": "auto",
        "forecast_days": 7,
    }
    try:
        async with httpx.AsyncClient(timeout=OPEN_METEO_TIMEOUT_S) as client:
            r = await client.get(OPEN_METEO_URL, params=params)
            if r.status_code != 200:
                return None
            data = r.json()
    except Exception as e:
        log.warning("open_meteo_err err=%r", e)
        return None

    cur = data.get("current") or {}
    code_cur = cur.get("weather_code")
    payload: Dict[str, Any] = {
        "ok": True,
        "source": "open_meteo",
        "as_of": cur.get("time"),
        "current": {
            "temp_f": _r(cur.get("temperature_2m")),
            "temp_c": _r(_f_to_c(cur.get("temperature_2m"))),
            "feels_like_f": _r(cur.get("apparent_temperature")),
            "condition_code": str(code_cur) if code_cur is not None else None,
            "label": _OM_CODE_LABEL.get(int(code_cur) if code_cur is not None else -1, "Mixed"),
            "sf_symbol": _OM_CODE_SYMBOL.get(int(code_cur) if code_cur is not None else -1, "cloud.fill"),
            "precip_chance_pct": _r((cur.get("precipitation") or 0) * 100 if cur.get("precipitation") is not None else None),
            "wind_mph": _r(cur.get("wind_speed_10m")),
            "wind_dir_deg": cur.get("wind_direction_10m"),
            "humidity_pct": (cur.get("relative_humidity_2m") or 0) / 100.0 if cur.get("relative_humidity_2m") is not None else None,
            "uv_index": cur.get("uv_index"),
            "is_daylight": bool(cur.get("is_day")),
        },
        "attribution_url": "https://open-meteo.com/",
    }

    if "hourly" in include:
        h = data.get("hourly") or {}
        times = h.get("time") or []
        out: List[Dict[str, Any]] = []
        # Find the index closest to "now" so we only emit forward-looking hours.
        now_iso = (cur.get("time") or "")[:13]  # YYYY-MM-DDTHH
        start = 0
        for i, t in enumerate(times):
            if str(t).startswith(now_iso):
                start = i
                break
        temps = h.get("temperature_2m") or []
        codes = h.get("weather_code") or []
        probs = h.get("precipitation_probability") or []
        winds = h.get("wind_speed_10m") or []
        uvs   = h.get("uv_index") or []
        days  = h.get("is_day") or []
        for i in range(start, min(start + 24, len(times))):
            code = codes[i] if i < len(codes) else None
            out.append({
                "time": times[i],
                "temp_f": _r(temps[i]) if i < len(temps) else None,
                "condition_code": str(code) if code is not None else None,
                "label": _OM_CODE_LABEL.get(int(code) if code is not None else -1, "Mixed"),
                "sf_symbol": _OM_CODE_SYMBOL.get(int(code) if code is not None else -1, "cloud.fill"),
                "precip_chance_pct": probs[i] if i < len(probs) else None,
                "wind_mph": _r(winds[i]) if i < len(winds) else None,
                "uv_index": uvs[i] if i < len(uvs) else None,
                "is_daylight": bool(days[i]) if i < len(days) else None,
            })
        payload["hourly"] = out

    if "daily" in include:
        d = data.get("daily") or {}
        ts = d.get("time") or []
        out2: List[Dict[str, Any]] = []
        highs = d.get("temperature_2m_max") or []
        lows  = d.get("temperature_2m_min") or []
        codes = d.get("weather_code") or []
        probs = d.get("precipitation_probability_max") or []
        uvs   = d.get("uv_index_max") or []
        srises = d.get("sunrise") or []
        ssets  = d.get("sunset") or []
        for i, t in enumerate(ts[:7]):
            code = codes[i] if i < len(codes) else None
            out2.append({
                "date": t,
                "high_f": _r(highs[i]) if i < len(highs) else None,
                "low_f":  _r(lows[i])  if i < len(lows)  else None,
                "condition_code": str(code) if code is not None else None,
                "label": _OM_CODE_LABEL.get(int(code) if code is not None else -1, "Mixed"),
                "sf_symbol": _OM_CODE_SYMBOL.get(int(code) if code is not None else -1, "cloud.fill"),
                "precip_chance_pct": probs[i] if i < len(probs) else None,
                "uv_index_max": uvs[i] if i < len(uvs) else None,
                "sunrise": srises[i] if i < len(srises) else None,
                "sunset":  ssets[i]  if i < len(ssets)  else None,
            })
        payload["daily"] = out2

    return payload


# ─────────────────────────────────────────────────────────────────────
# Small math helpers
# ─────────────────────────────────────────────────────────────────────
def _r(v: Optional[float]) -> Optional[float]:
    return None if v is None else round(v, 1)


def _f_to_c(f: Optional[float]) -> Optional[float]:
    return None if f is None else (f - 32) * 5 / 9


def _pct(v: Optional[float]) -> Optional[float]:
    """Apple's precipitation intensity is mm/h; convert to a 0-100 chance-ish
    bucket only if we don't have a dedicated `precipitationChance` field
    (currentWeather doesn't include one). Empirically: 0 mm/h → 0%, 0.5 → 25%,
    1+ → 60%, 4+ → 90%.
    """
    if v is None:
        return None
    if v <= 0:
        return 0.0
    if v < 0.5:
        return v * 50  # 0-25%
    if v < 1.0:
        return 25 + (v - 0.5) * 70  # 25-60%
    if v < 4.0:
        return 60 + (v - 1.0) * 10  # 60-90%
    return 95.0


def _pct_from_fraction(v: Optional[float]) -> Optional[float]:
    """Apple returns chance as 0-1 fraction; we surface it as 0-100."""
    if v is None:
        return None
    return min(100.0, max(0.0, float(v) * 100))


def _km_to_mi(km: Optional[float]) -> Optional[float]:
    return None if km is None else km * 0.621371


# ─────────────────────────────────────────────────────────────────────
# Cache TTL router — Elite datasets are short-lived (alerts/minute change fast)
# ─────────────────────────────────────────────────────────────────────
CACHE_TTL_MINUTE_MIN = 5
CACHE_TTL_ALERTS_MIN = 5


def _ttl_for_wanted(wanted: Tuple[str, ...]) -> int:
    """Cache as long as the SHORTEST-lived requested dataset allows."""
    if "minute" in wanted or "alerts" in wanted:
        return CACHE_TTL_MINUTE_MIN
    if "current" in wanted or "hourly" in wanted:
        return CACHE_TTL_CURRENT_MIN
    return CACHE_TTL_DAILY_MIN


def _strip_elite_for_non_elite(payload: Dict[str, Any], plan: str) -> Dict[str, Any]:
    """Per spec, ensure tier-specific fields are ABSENT (not null) when a
    lower-tier user reads a cached upper-tier response. We can't fully
    avoid this overlap because cache keys are coord+include — not plan —
    so a later non-elite call may hit an Elite-seeded entry. Belt-and-
    suspenders defense.
    """
    # Elite-only fields: scrub on anything below Elite.
    if plan != "elite":
        for k in ("alerts", "minute_forecast", "best_times"):
            payload.pop(k, None)
        # Strip Elite's per-day golden_hour/blue_hour enrichment from any
        # cached Pro/Free daily. Pro keeps the lightweight photoPlanning
        # summary instead.
        for d in (payload.get("daily") or []):
            if isinstance(d, dict):
                d.pop("golden_hour", None)
                d.pop("blue_hour", None)

    # Pro+Elite-only fields: scrub on anything below Pro.
    if plan in ("anon", "free"):
        payload.pop("photoPlanning", None)
        payload.pop("hourly", None)
        payload.pop("daily", None)

    # Daily-day cap: re-enforce based on plan.
    cap = DAILY_DAYS_BY_PLAN.get(plan, 7)
    daily = payload.get("daily")
    if isinstance(daily, list) and len(daily) > cap:
        payload["daily"] = daily[:cap]
    return payload


# ─────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────
@router.get("/weather")
async def get_weather(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    include: Optional[str] = Query(
        None,
        description="Comma-separated subset of "
                    "current,hourly,daily,alerts,minute,best_times "
                    "(alerts/minute/best_times require Elite plan)"
    ),
    country: Optional[str] = Query(None, min_length=2, max_length=2),
    timezone_name: Optional[str] = Query(None, alias="timezone"),
    user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    """Return normalized weather for `lat`,`lng`.

    Plan-tier policy:
      • anon/free → current only
      • pro       → current + hourly + daily(7)
      • elite     → current + hourly + daily(10) + alerts(if country)
                    + minute forecast + golden/blue hours
                    + best_times (top 3 windows for next 48h)

    WeatherKit primary, Open-Meteo fallback. All Elite-only fields are
    ABSENT (not null) from free/pro responses.
    """
    plan = _resolve_user_tier(user)
    is_elite = (plan == "elite")
    _log_tier_resolution(user, resolved=plan, endpoint="GET /api/weather")

    # Build include list — explicit param overrides plan default, but
    # Elite-only keys are silently dropped for non-Elite users.
    if include:
        wanted_raw = tuple(p.strip() for p in include.split(",") if p.strip())
    else:
        wanted_raw = tuple(INCLUDE_BY_PLAN.get(plan, ["current"]))
    # Filter to known keys + tier-allowed keys.
    allowed = set(INCLUDE_TO_DATASET.keys()) | {"best_times"}
    elite_only = {"alerts", "minute", "best_times"}
    wanted_filtered: List[str] = []
    for p in wanted_raw:
        if p not in allowed:
            continue
        if p in elite_only and not is_elite:
            continue
        wanted_filtered.append(p)
    # best_times needs hourly+daily to compute; auto-include them if user
    # asked for best_times but not the dependencies.
    if "best_times" in wanted_filtered:
        for dep in BEST_TIMES_REQUIRES:
            if dep not in wanted_filtered:
                wanted_filtered.append(dep)
    wanted = tuple(wanted_filtered) or ("current",)
    # Alerts require a country code; silently drop if not provided.
    if "alerts" in wanted and not country:
        wanted = tuple(p for p in wanted if p != "alerts")

    # Try cache.
    ckey = _cache_key(lat, lng, wanted)
    cached = await _cache_get(ckey)
    if cached:
        cached = _strip_elite_for_non_elite(dict(cached), plan)
        cur = cached.get("current") or {}
        cached.setdefault("temp_f", cur.get("temp_f"))
        cached.setdefault("label", cur.get("label"))
        cached.setdefault("condition", cur.get("label"))
        cached.setdefault("plan", plan)
        cached.update(tier_feature_block(plan))
        return cached

    # Daily-day limit varies by plan.
    daily_limit = DAILY_DAYS_BY_PLAN.get(plan, 7)

    # Primary: Apple WeatherKit
    apple_payload: Optional[Dict[str, Any]] = None
    if weatherkit_configured():
        # Translate wanted → WeatherKit dataset names (skip best_times — derived).
        datasets = [INCLUDE_TO_DATASET[w] for w in wanted if w in INCLUDE_TO_DATASET]
        apple = await fetch_weatherkit(
            lat, lng, datasets=datasets,
            country_code=country, timezone=timezone_name,
        )
        if apple:
            current = apple.get(DATASET_CURRENT) or {}
            hourly_block = (apple.get(DATASET_HOURLY) or {}).get("hours") or []
            daily_block  = (apple.get(DATASET_DAILY)  or {}).get("days")  or []
            alerts_block = apple.get(DATASET_ALERTS)  or {}
            minute_block = apple.get(DATASET_MINUTE)  or {}
            apple_payload = {
                "ok": True,
                "source": "weatherkit",
                "as_of": current.get("asOf"),
                "attribution_url": APPLE_ATTRIBUTION_URL,
            }
            if "current" in wanted and current:
                apple_payload["current"] = _norm_apple_current(current)
            if "hourly"  in wanted and hourly_block:
                apple_payload["hourly"]  = _norm_apple_hourly(hourly_block)
            if "daily"   in wanted and daily_block:
                daily_norm = _norm_apple_daily(daily_block, limit=daily_limit)
                # Always enrich daily with golden_hour/blue_hour windows on
                # Elite plans; cheap and unlocks the Elite UI.
                if is_elite:
                    _enrich_daily_with_light_windows(daily_norm)
                apple_payload["daily"] = daily_norm
                # Pro (and Elite, since Elite ⊇ Pro) gets a lightweight
                # photoPlanning object summarizing today's golden/blue hours
                # + one bestSimpleWindow. Elite still has the richer
                # bestTimeToShoot engine as a separate field — Pro doesn't.
                if plan in ("pro", "elite"):
                    plan_obj = _compute_photo_planning(
                        daily_norm, apple_payload.get("hourly") or [],
                    )
                    if plan_obj is not None:
                        apple_payload["photoPlanning"] = plan_obj
            if "alerts"  in wanted and is_elite:
                apple_payload["alerts"] = _norm_apple_alerts(alerts_block)
            if "minute"  in wanted and is_elite:
                m = _norm_apple_minute(minute_block)
                if m is not None:
                    apple_payload["minute_forecast"] = m
            if "best_times" in wanted and is_elite:
                hourly_for_calc = apple_payload.get("hourly") or []
                daily_for_calc  = apple_payload.get("daily")  or []
                bt = _compute_best_times(hourly_for_calc, daily_for_calc)
                if bt:
                    apple_payload["best_times"] = bt

    # Fallback: Open-Meteo (always free + public; no Elite extras)
    payload = apple_payload
    used_fallback = False
    if payload is None:
        used_fallback = True
        payload = await _fetch_open_meteo(lat, lng, wanted)
        # Pro photo-planning runs against the Open-Meteo fallback too —
        # we still get sunrise/sunset and hourly cloud/wind/precip from
        # the Open-Meteo daily/hourly blocks. Elite enrichment is more
        # nuanced (golden_hour on each daily entry + best_times engine).
        if payload:
            d = payload.get("daily")
            if isinstance(d, list):
                # Trim fallback daily to plan's max days.
                payload["daily"] = d[:daily_limit]
                if is_elite:
                    _enrich_daily_with_light_windows(payload["daily"])
                if plan in ("pro", "elite"):
                    plan_obj = _compute_photo_planning(
                        payload["daily"], payload.get("hourly") or [],
                    )
                    if plan_obj is not None:
                        payload["photoPlanning"] = plan_obj
            if is_elite and "best_times" in wanted:
                bt = _compute_best_times(payload.get("hourly") or [], payload.get("daily") or [])
                if bt:
                    payload["best_times"] = bt

    if payload is None:
        return {"ok": False, "source": "none", "plan": plan, "current": None}

    # Cache with the appropriate TTL for the shortest-lived dataset requested.
    ttl_min = _ttl_for_wanted(wanted)
    # Don't cache the fallback as long as the primary — Open-Meteo changes
    # less aggressively but we want to retry Apple sooner once it comes back.
    if used_fallback:
        ttl_min = min(ttl_min, 10)
    await _cache_put(ckey, payload, ttl_min=ttl_min)

    # Strip Elite fields from non-elite responses (defense in depth — if
    # Elite caller seeded the cache, a subsequent non-elite read won't leak).
    payload = _strip_elite_for_non_elite(payload, plan)

    # Back-compat root keys for the home hero pill.
    cur = payload.get("current") or {}
    payload["temp_f"] = cur.get("temp_f")
    payload["label"]  = cur.get("label")
    payload["condition"] = cur.get("label")
    payload["plan"] = plan
    payload["cached"] = False

    # Jun 2026 tier wrapper — frontend reads available_features /
    # locked_features to decide which cards to render and which to show
    # as upgrade teasers. Backwards-compatible: existing keys at root
    # (current, hourly, daily, etc.) are preserved alongside.
    payload.update(tier_feature_block(plan))
    return payload


# ─────────────────────────────────────────────────────────────────────
# Diagnostic: confirm config without leaking secrets
# ─────────────────────────────────────────────────────────────────────
@router.get("/weather/config")
async def weather_config():
    """Diagnostic: confirm WeatherKit + APNs config without leaking secrets."""
    return {
        "weatherkit_configured": weatherkit_configured(),
        "team_id_set":    bool(os.environ.get("WEATHERKIT_TEAM_ID") or os.environ.get("APNS_TEAM_ID")),
        "key_id_set":     bool(os.environ.get("WEATHERKIT_KEY_ID")  or os.environ.get("APNS_KEY_ID")),
        "service_id_set": bool(os.environ.get("WEATHERKIT_SERVICE_ID") or os.environ.get("APNS_BUNDLE_ID")),
        "jwt_signing_configured": weatherkit_configured(),
        "cache_status": "mongo:weather_cache:ttl_indexed",
        # Tier-aware feature flags — keeps the docs honest and surfaces
        # what each subscription tier actually unlocks. (Per spec — no
        # secret material; this just answers "which feature buckets are
        # wired in this build?")
        "tier_features": {
            "free_current_weather":            True,
            "pro_hourly_forecast":             True,
            "pro_five_day_forecast":           True,
            "pro_basic_photo_planning":        True,
            "elite_ten_day_forecast":          True,
            "elite_alerts":                    True,
            "elite_minute_forecast":           True,
            "elite_lunar_data":                True,
            "elite_best_time_to_shoot":        True,
            "elite_push_alerts":               apns_configured(),
        },
        # Backwards-compat — older callers used `elite_features`. Keep
        # them functional, but the canonical block above is `tier_features`.
        "elite_features": {
            "alerts":          True,
            "minute_forecast": True,
            "moon_data":       True,
            "golden_blue_hour": True,
            "best_times":      True,
            "ten_day_forecast": True,
            "push_alerts":     apns_configured(),
        },
        "push_apns_configured": apns_configured(),
        "cache_ttl_minutes": {
            "current": CACHE_TTL_CURRENT_MIN,
            "hourly":  CACHE_TTL_CURRENT_MIN,
            "daily":   CACHE_TTL_DAILY_MIN,
            "alerts":  CACHE_TTL_ALERTS_MIN,
            "minute":  CACHE_TTL_MINUTE_MIN,
        },
        "daily_days_by_plan": DAILY_DAYS_BY_PLAN,
    }


# ─────────────────────────────────────────────────────────────────────
# Diagnostic: resolve the calling user's effective weather tier
#
# Jun 2026: super-admin / comp_elite users were unexpectedly seeing the
# Free upgrade prompt because the endpoint was reading `user.plan`
# directly instead of going through `plan_of()`. This endpoint surfaces
# every field that contributes to the resolved tier so QA and the user
# can verify their own account in one tap.
#
# Auth required. Never returns secrets — just role/plan/subscription
# state already in the user document.
# ─────────────────────────────────────────────────────────────────────
@router.get("/weather/_debug_tier")
async def weather_debug_tier(
    user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    """Surface every field that contributes to weather tier resolution.

    Use this to verify why a particular account sees a particular tier:

        curl -H "Authorization: Bearer <jwt>" \
             https://api.lumascout.app/api/weather/_debug_tier

    Returns:
        {
          "authenticated": bool,
          "user_id": str|null,
          "email": str|null,
          "role": str|null,
          "is_super_admin": bool,
          "raw_plan": "free"|"pro"|"elite"|"comp_pro"|"comp_elite"|...|null,
          "comp_expiration": "<iso>"|null,
          "stripe_subscription_id": str|null,
          "stripe_subscription_status": str|null,
          "plan_of_user": "<post-role-resolution plan>",
          "effective_tier": "anon"|"free"|"pro"|"elite",
          "feature_block": { tier, available_features, locked_features, upgrade_target },
        }
    """
    if not user:
        return {
            "authenticated": False,
            "effective_tier": "anon",
            "feature_block": tier_feature_block("anon"),
        }
    raw_plan = user.get("plan")
    role     = user.get("role")
    plan_of_user = plan_of(user)
    eff = _resolve_user_tier(user)
    out = {
        "authenticated": True,
        "user_id":  user.get("user_id") or user.get("id"),
        "email":    user.get("email"),
        "role":     role,
        "is_super_admin": role == "super_admin",
        "is_admin":       role in ("admin", "super_admin"),
        "raw_plan":       raw_plan,
        "comp_expiration": user.get("comp_expiration"),
        "stripe_subscription_id":     user.get("stripe_subscription_id"),
        "stripe_subscription_status": user.get("subscription_status"),
        "plan_of_user":  plan_of_user,
        "effective_tier": eff,
        "feature_block":  tier_feature_block(eff),
        # Helpful for the React frontend — shows which paths through the
        # resolver fired.
        "resolution_path": _describe_resolution_path(user, raw_plan, role, plan_of_user, eff),
    }
    # Echo to logs (gated on admin / env flag) for cross-checking.
    _log_tier_resolution(user, resolved=eff, endpoint="GET /api/weather/_debug_tier")
    return out


def _describe_resolution_path(
    user: Dict[str, Any],
    raw_plan: Optional[str],
    role: Optional[str],
    plan_of_user: str,
    effective: str,
) -> List[str]:
    """Best-effort textual trace of which resolver branches activated.
    Useful for support / debugging. Not load-bearing."""
    notes: List[str] = []
    if role in ("admin", "super_admin", "moderator", "support", "founding_scout"):
        notes.append(f"role={role} → comped via ELITE_COMP_ROLES")
    if raw_plan in ("comp_pro", "comp_elite"):
        notes.append(f"raw_plan={raw_plan} → admin-granted complimentary tier")
    if raw_plan in ("trial_pro", "trial_elite"):
        notes.append(f"raw_plan={raw_plan} → in trial window")
    if user.get("comp_expiration"):
        notes.append(f"comp_expiration={user.get('comp_expiration')}")
    if user.get("stripe_subscription_id"):
        notes.append(
            f"stripe_subscription_id={user.get('stripe_subscription_id')} "
            f"(status={user.get('subscription_status')})"
        )
    if raw_plan == effective:
        notes.append(f"plan_of()={plan_of_user} == effective={effective}")
    else:
        notes.append(f"raw={raw_plan} → plan_of={plan_of_user} → effective={effective}")
    return notes


# ═════════════════════════════════════════════════════════════════════
# Elite Weather Alert Subscriptions
# ═════════════════════════════════════════════════════════════════════
WEATHER_ALERTS_COLL = "weather_alert_subscriptions"
ALERT_PREF_KEYS = ("severe", "clear_sky", "golden_hour")


class _AlertPrefs(Dict[str, bool]):
    """Just a typing aid — we accept dict[str,bool] in JSON."""


@router.post("/weather/alerts/subscribe", status_code=201)
async def subscribe_alerts(
    body: Dict[str, Any],
    user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    """Subscribe the calling user (Elite-only) to push notifications for a
    spot's weather conditions.

    Request body:
        {
          "device_token": "<APNs hex>",
          "lat": 30.27, "lng": -97.74,
          "spot_id": "...",                    (optional — for deep linking)
          "preferences": {
            "severe":      true,
            "clear_sky":   true,
            "golden_hour": false
          }
        }
    """
    if not user:
        raise HTTPException(status_code=401, detail="auth_required")
    plan = _resolve_user_tier(user)
    _log_tier_resolution(user, resolved=plan, endpoint="POST /api/weather/alerts/subscribe")

    device_token = (body.get("device_token") or "").strip()
    if not device_token or len(device_token) < 32:
        raise HTTPException(status_code=400, detail="invalid_device_token")
    try:
        lat = float(body.get("lat"))
        lng = float(body.get("lng"))
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_coords")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(status_code=400, detail="coords_out_of_range")

    spot_id = (body.get("spot_id") or "").strip() or None
    prefs_in = body.get("preferences") or {}
    prefs = {k: bool(prefs_in.get(k, False)) for k in ALERT_PREF_KEYS}
    if not any(prefs.values()):
        raise HTTPException(status_code=400, detail="at_least_one_pref_required")

    # Phase 1 (Jun 2026) — Golden Hour push opens to Pro+ tier.
    # • Free:  blocked (must upgrade)
    # • Pro:   golden_hour ONLY
    # • Elite: golden_hour + severe + clear_sky (existing behaviour)
    is_pro_only = (plan == "pro")
    elite_only_triggers = {k for k, v in prefs.items() if v and k != "golden_hour"}
    if plan == "free" or plan == "anon":
        raise HTTPException(status_code=402, detail="pro_required")
    if is_pro_only and elite_only_triggers:
        # Surface a 402 with a precise reason so the client can route to
        # paywall?reason=elite. We DON'T silently drop the unsupported
        # triggers — the user explicitly opted in, so they deserve a
        # truthful "needs Elite" response.
        raise HTTPException(status_code=402, detail="elite_required_for_advanced_triggers")

    user_id = user.get("id") or user.get("_id")
    # Upsert keyed by (user, lat-rounded, lng-rounded) so re-subscribing
    # the same spot updates rather than duplicates. Round to ~111m grid.
    key = {
        "user_id": user_id,
        "lat_grid": round(lat, 3),
        "lng_grid": round(lng, 3),
    }
    now = datetime.utcnow()
    doc = {
        **key,
        "lat": lat, "lng": lng,
        "spot_id": spot_id,
        "device_token": device_token,
        "preferences": prefs,
        "active": True,
        "created_at": now,
        "updated_at": now,
        "last_check_at": None,
        # Per-alert-type dedupe — prevents spamming user with same alert.
        "last_alert_at": {k: None for k in ALERT_PREF_KEYS},
    }
    await db[WEATHER_ALERTS_COLL].update_one(
        key, {"$set": doc, "$setOnInsert": {"first_subscribed_at": now}},
        upsert=True,
    )
    # Compose a stable subscription_id for the client to delete later.
    sub_id = f"{user_id}:{key['lat_grid']}:{key['lng_grid']}"
    return {
        "ok": True,
        "subscription_id": sub_id,
        "preferences": prefs,
        "lat": lat, "lng": lng,
        "spot_id": spot_id,
        "next_check_within_minutes": 15,
    }


@router.get("/weather/alerts/subscriptions")
async def list_alerts(
    user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    """List the calling user's active weather alert subscriptions."""
    if not user:
        raise HTTPException(status_code=401, detail="auth_required")
    user_id = user.get("id") or user.get("_id")
    cur = db[WEATHER_ALERTS_COLL].find(
        {"user_id": user_id, "active": True},
        {"device_token": 0},  # don't echo back the token
    ).sort("created_at", -1)
    out: List[Dict[str, Any]] = []
    async for d in cur:
        d["_id"] = str(d.get("_id"))
        out.append(d)
    return {"ok": True, "subscriptions": out, "count": len(out)}


@router.delete("/weather/alerts/subscribe")
async def unsubscribe_alerts(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    """Unsubscribe the calling user from a single spot. Idempotent —
    `removed` reflects whether the row was *actively* deactivated by this
    call (1 on first call, 0 on subsequent calls). We scope the filter
    on `active: True` so the modified_count is meaningful even though
    `$set.updated_at` always changes."""
    if not user:
        raise HTTPException(status_code=401, detail="auth_required")
    user_id = user.get("id") or user.get("_id")
    res = await db[WEATHER_ALERTS_COLL].update_one(
        {
            "user_id": user_id,
            "lat_grid": round(lat, 3),
            "lng_grid": round(lng, 3),
            "active": True,  # only count the first transition true→false
        },
        {"$set": {"active": False, "updated_at": datetime.utcnow()}},
    )
    return {"ok": True, "removed": res.modified_count}


# ═════════════════════════════════════════════════════════════════════
# Public Shared-Spot Weather (Jun 2026)
#
# Endpoint: GET /api/public/shared/{token}/weather
#
# Tier-aware weather for a public Share Location page. The tier is
# fully determined by the SHARER's plan snapshot at share-create time,
# not by the anonymous viewer. This means a Pro photographer's shared
# page surfaces Pro-level weather to the client, even though the client
# is unauthenticated. Anonymous viewers cannot upgrade themselves by
# visiting a share — the tier is fixed by the sharer's snapshot.
# ═════════════════════════════════════════════════════════════════════
def _normalize_sharer_plan(raw: Optional[str], was_elite: bool) -> str:
    """Convert the share-row snapshot into one of {free, pro, elite}.
    `was_elite` is the legacy boolean used by older share rows."""
    if was_elite:
        return "elite"
    if not raw:
        return "free"
    raw = raw.lower().strip()
    if raw in ("comp_elite", "elite"):
        return "elite"
    if raw in ("comp_pro", "pro"):
        return "pro"
    return "free"


# ═════════════════════════════════════════════════════════════════════
# Phase 1 (Jun 2026) — Golden Hour Notification Preferences
# ═════════════════════════════════════════════════════════════════════
# User-level prefs that drive the weather_alerts_worker. Persisted as a
# single sub-doc on the user row at `golden_hour_notification_preferences`.
# Free users get a read-only view of the defaults so the settings screen
# can still render the (locked) toggles with sensible values.
# ─────────────────────────────────────────────────────────────────────
GOLDEN_HOUR_PREFS_FIELD = "golden_hour_notification_preferences"
DEFAULT_GOLDEN_HOUR_PREFS: Dict[str, Any] = {
    "enabled": False,
    "startingSoonEnabled": True,
    "startsNowEnabled": True,
    "reminderMinutesBefore": 30,           # one of: 15 | 30 | 60
    "savedSpotsOnly": True,
    "quietHoursEnabled": False,
    "quietHoursStart": "21:00",
    "quietHoursEnd": "07:00",
    "maxGoldenHourNotificationsPerDay": 2,
    "updatedAt": None,
}

_ALLOWED_REMINDER_MIN = (15, 30, 60)


def _coerce_golden_hour_prefs(
    incoming: Dict[str, Any], existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Merge user-supplied prefs with defaults, dropping unknown keys
    and coercing types. Idempotent — safe to call on every PATCH."""
    base = dict(DEFAULT_GOLDEN_HOUR_PREFS)
    if existing:
        for k in base:
            if k in existing and existing[k] is not None:
                base[k] = existing[k]
    if incoming:
        # bools
        for k in (
            "enabled", "startingSoonEnabled", "startsNowEnabled",
            "savedSpotsOnly", "quietHoursEnabled",
        ):
            if k in incoming:
                base[k] = bool(incoming[k])
        # reminder timing (15/30/60)
        if "reminderMinutesBefore" in incoming:
            try:
                v = int(incoming["reminderMinutesBefore"])
                if v in _ALLOWED_REMINDER_MIN:
                    base["reminderMinutesBefore"] = v
            except Exception:
                pass
        # quiet-hours strings
        for k in ("quietHoursStart", "quietHoursEnd"):
            if k in incoming and isinstance(incoming[k], str):
                v = incoming[k].strip()
                if len(v) == 5 and v[2] == ":":
                    base[k] = v
        # daily cap
        if "maxGoldenHourNotificationsPerDay" in incoming:
            try:
                v = int(incoming["maxGoldenHourNotificationsPerDay"])
                base["maxGoldenHourNotificationsPerDay"] = max(0, min(20, v))
            except Exception:
                pass
    return base


@router.get("/me/golden-hour-preferences")
async def get_golden_hour_preferences(
    user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    if not user:
        raise HTTPException(status_code=401, detail="auth_required")
    plan = _resolve_user_tier(user)
    existing = user.get(GOLDEN_HOUR_PREFS_FIELD) or None
    prefs = _coerce_golden_hour_prefs({}, existing)
    return {
        "ok": True,
        "tier": plan,
        # Free users can READ the defaults so the UI can render the
        # locked toggles with sensible values. They just can't enable
        # them — that's enforced on PATCH below.
        "can_enable": plan in ("pro", "elite"),
        "preferences": prefs,
        "reminder_options": list(_ALLOWED_REMINDER_MIN),
    }


@router.patch("/me/golden-hour-preferences")
async def patch_golden_hour_preferences(
    body: Dict[str, Any],
    user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    if not user:
        raise HTTPException(status_code=401, detail="auth_required")
    plan = _resolve_user_tier(user)
    # Allow READ-style merging for Free (e.g. setting quiet hours while
    # locked) but block actually enabling the master toggle.
    if plan not in ("pro", "elite") and bool(body.get("enabled")):
        raise HTTPException(status_code=402, detail="pro_required")
    user_id = user.get("user_id") or user.get("id") or user.get("_id")
    existing = user.get(GOLDEN_HOUR_PREFS_FIELD) or None
    merged = _coerce_golden_hour_prefs(body, existing)
    merged["updatedAt"] = datetime.utcnow()
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {GOLDEN_HOUR_PREFS_FIELD: merged}},
    )
    return {"ok": True, "tier": plan, "preferences": merged}


@router.get("/public/shared/{token}/weather")
async def get_shared_spot_weather(
    token: str,
    include: Optional[str] = Query(None),
    country: Optional[str] = Query(None, min_length=2, max_length=2),
):
    """Tier-aware weather for a public Share Location page.

    Errors:
      • 404 if the token is missing, revoked, expired, or the spot was
        deleted. We don't differentiate (avoid token-existence oracle).
      • 200 with `weather: null` if the spot's coordinates are unavailable.
    """
    from routes.spot_shares import _resolve_share_or_unavailable  # noqa: WPS433
    share = await _resolve_share_or_unavailable(token)
    if not share:
        raise HTTPException(status_code=404, detail="share_not_found_or_expired")

    spot = await db["spots"].find_one(
        {"_id": share.get("spot_id")},
        {"latitude": 1, "longitude": 1, "country_code": 1, "timezone": 1,
         "name": 1, "_id": 0},
    )
    if not spot:
        raise HTTPException(status_code=404, detail="spot_unavailable")

    lat = spot.get("latitude")
    lng = spot.get("longitude")
    if lat is None or lng is None:
        return {
            "ok": True,
            "weather": None,
            "tier": "anon",
            "available_features": [],
            "locked_features": [],
            "upgrade_target": None,
            "as_shared_by_tier": "free",
            "spot_name": spot.get("name"),
        }

    sharer_plan = _normalize_sharer_plan(
        share.get("sharer_plan_at_create"),
        bool(share.get("created_by_was_elite")),
    )

    # Build wanted set, respecting sharer tier ceiling.
    if include:
        wanted_raw = tuple(p.strip() for p in include.split(",") if p.strip())
    else:
        wanted_raw = tuple(INCLUDE_BY_PLAN.get(sharer_plan, ["current"]))
    elite_only = {"alerts", "minute", "best_times"}
    allowed = set(INCLUDE_TO_DATASET.keys()) | {"best_times"}
    is_elite = sharer_plan == "elite"
    wanted_filtered = []
    for p in wanted_raw:
        if p not in allowed:
            continue
        if p in elite_only and not is_elite:
            continue
        wanted_filtered.append(p)
    if "best_times" in wanted_filtered:
        for dep in BEST_TIMES_REQUIRES:
            if dep not in wanted_filtered:
                wanted_filtered.append(dep)
    wanted = tuple(wanted_filtered) or ("current",)
    if "alerts" in wanted and not country:
        country = (spot.get("country_code") or "US")[:2].upper()
    if "alerts" in wanted and not country:
        wanted = tuple(p for p in wanted if p != "alerts")

    # Cache namespaced by tier so different-tier shares of the same coord
    # don't poison each other.
    ckey = f"share:{sharer_plan}:" + _cache_key(lat, lng, wanted)
    cached = await _cache_get(ckey)
    if cached:
        cached = _strip_elite_for_non_elite(dict(cached), sharer_plan)
        cur = cached.get("current") or {}
        cached.setdefault("temp_f", cur.get("temp_f"))
        cached.setdefault("label", cur.get("label"))
        cached.update(tier_feature_block(sharer_plan))
        cached["as_shared_by_tier"] = sharer_plan
        cached["spot_name"] = spot.get("name")
        return cached

    daily_limit = DAILY_DAYS_BY_PLAN.get(sharer_plan, 5)

    apple_payload: Optional[Dict[str, Any]] = None
    if weatherkit_configured():
        datasets = [INCLUDE_TO_DATASET[w] for w in wanted if w in INCLUDE_TO_DATASET]
        apple = await fetch_weatherkit(
            lat, lng, datasets=datasets,
            country_code=country, timezone=spot.get("timezone"),
        )
        if apple:
            current = apple.get(DATASET_CURRENT) or {}
            hourly_block = (apple.get(DATASET_HOURLY) or {}).get("hours") or []
            daily_block  = (apple.get(DATASET_DAILY)  or {}).get("days")  or []
            alerts_block = apple.get(DATASET_ALERTS)  or {}
            minute_block = apple.get(DATASET_MINUTE)  or {}
            apple_payload = {
                "ok": True,
                "source": "weatherkit",
                "as_of": current.get("asOf"),
                "attribution_url": APPLE_ATTRIBUTION_URL,
            }
            if "current" in wanted and current:
                apple_payload["current"] = _norm_apple_current(current)
            if "hourly" in wanted and hourly_block:
                apple_payload["hourly"] = _norm_apple_hourly(hourly_block)
            if "daily" in wanted and daily_block:
                daily_norm = _norm_apple_daily(daily_block, limit=daily_limit)
                if is_elite:
                    _enrich_daily_with_light_windows(daily_norm)
                apple_payload["daily"] = daily_norm
                if sharer_plan in ("pro", "elite"):
                    pp = _compute_photo_planning(
                        daily_norm, apple_payload.get("hourly") or [],
                    )
                    if pp is not None:
                        apple_payload["photoPlanning"] = pp
            if "alerts" in wanted and is_elite:
                apple_payload["alerts"] = _norm_apple_alerts(alerts_block)
            if "minute" in wanted and is_elite:
                m = _norm_apple_minute(minute_block)
                if m is not None:
                    apple_payload["minute_forecast"] = m
            if "best_times" in wanted and is_elite:
                bt = _compute_best_times(
                    apple_payload.get("hourly") or [],
                    apple_payload.get("daily")  or [],
                )
                if bt:
                    apple_payload["best_times"] = bt

    payload = apple_payload
    if payload is None:
        payload = await _fetch_open_meteo(lat, lng, wanted)
        if payload:
            d = payload.get("daily")
            if isinstance(d, list):
                payload["daily"] = d[:daily_limit]
                if is_elite:
                    _enrich_daily_with_light_windows(payload["daily"])
                if sharer_plan in ("pro", "elite"):
                    pp = _compute_photo_planning(
                        payload["daily"], payload.get("hourly") or [],
                    )
                    if pp is not None:
                        payload["photoPlanning"] = pp

    if payload is None:
        return {
            "ok": True,
            "weather": None,
            **tier_feature_block(sharer_plan),
            "as_shared_by_tier": sharer_plan,
            "spot_name": spot.get("name"),
        }

    ttl_min = _ttl_for_wanted(wanted)
    await _cache_put(ckey, payload, ttl_min=ttl_min)

    payload = _strip_elite_for_non_elite(payload, sharer_plan)
    cur = payload.get("current") or {}
    payload["temp_f"] = cur.get("temp_f")
    payload["label"]  = cur.get("label")
    payload["cached"] = False
    payload.update(tier_feature_block(sharer_plan))
    payload["as_shared_by_tier"] = sharer_plan
    payload["spot_name"] = spot.get("name")
    return payload

