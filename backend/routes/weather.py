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

from server import db, get_optional_user
from services.weatherkit import (
    fetch_weather as fetch_weatherkit,
    weatherkit_configured,
    sf_symbol_for,
    human_label_for,
    c_to_f, mps_to_mph, mm_to_in,
    DATASET_CURRENT, DATASET_HOURLY, DATASET_DAILY, DATASET_ALERTS,
)

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

# Tier-based include defaults
INCLUDE_BY_PLAN: Dict[str, List[str]] = {
    "anon":  ["current"],
    "free":  ["current"],
    "pro":   ["current", "hourly", "daily"],
    "elite": ["current", "hourly", "daily", "alerts"],
}

# Map our short include names to WeatherKit dataset names
INCLUDE_TO_DATASET: Dict[str, str] = {
    "current": DATASET_CURRENT,
    "hourly":  DATASET_HOURLY,
    "daily":   DATASET_DAILY,
    "alerts":  DATASET_ALERTS,
}

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
    return f"{_round_coord(lat)}:{_round_coord(lng)}:{','.join(sorted(include))}"


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
        "visibility_mi": _r(_km_to_mi(cur.get("visibility"))),
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
            "uv_index": h.get("uvIndex"),
            "is_daylight": h.get("daylight"),
        })
    return out


def _norm_apple_daily(days: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for d in days[:10]:
        cond = d.get("conditionCode")
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
            "moon_phase": d.get("moonPhase"),
        })
    return out


def _norm_apple_alerts(alerts_block: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    items = (alerts_block or {}).get("alerts") or []
    for a in items[:5]:
        out.append({
            "id": a.get("id"),
            "title": a.get("description") or a.get("eventOnsetTime"),
            "severity": a.get("severity"),
            "certainty": a.get("certainty"),
            "urgency": a.get("urgency"),
            "issued_at": a.get("issuedTime"),
            "expires_at": a.get("expireTime"),
            "source": a.get("source"),
            "url": a.get("detailsUrl"),
        })
    return out


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
# Endpoint
# ─────────────────────────────────────────────────────────────────────
@router.get("/weather")
async def get_weather(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    include: Optional[str] = Query(None, description="Comma-separated subset of current,hourly,daily,alerts"),
    country: Optional[str] = Query(None, min_length=2, max_length=2),
    timezone_name: Optional[str] = Query(None, alias="timezone"),
    user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    """Return normalized weather for `lat`,`lng`. WeatherKit primary, Open-Meteo fallback."""
    plan = (user or {}).get("plan") or "anon"
    if not user:
        plan = "anon"

    # Build include list — explicit param overrides plan default.
    if include:
        wanted = tuple(p.strip() for p in include.split(",") if p.strip())
    else:
        wanted = tuple(INCLUDE_BY_PLAN.get(plan, ["current"]))
    # Validate.
    wanted = tuple(p for p in wanted if p in INCLUDE_TO_DATASET)
    if not wanted:
        wanted = ("current",)
    # Alerts require a country code; silently drop if not provided.
    if "alerts" in wanted and not country:
        wanted = tuple(p for p in wanted if p != "alerts")

    # Try cache.
    ckey = _cache_key(lat, lng, wanted)
    cached = await _cache_get(ckey)
    if cached:
        # Back-compat: also surface `temp_f`/`label` at the root for the
        # existing home hero pill that reads them directly (index.tsx L441).
        cur = cached.get("current") or {}
        cached.setdefault("temp_f", cur.get("temp_f"))
        cached.setdefault("label", cur.get("label"))
        cached.setdefault("condition", cur.get("label"))
        return cached

    # Primary: Apple WeatherKit
    apple_payload: Optional[Dict[str, Any]] = None
    if weatherkit_configured():
        datasets = [INCLUDE_TO_DATASET[w] for w in wanted]
        apple = await fetch_weatherkit(
            lat, lng, datasets=datasets,
            country_code=country, timezone=timezone_name,
        )
        if apple:
            current = apple.get(DATASET_CURRENT) or {}
            hourly_block = (apple.get(DATASET_HOURLY) or {}).get("hours") or []
            daily_block  = (apple.get(DATASET_DAILY)  or {}).get("days")  or []
            alerts_block = apple.get(DATASET_ALERTS)  or {}
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
                apple_payload["daily"]   = _norm_apple_daily(daily_block)
            if "alerts"  in wanted and alerts_block:
                apple_payload["alerts"]  = _norm_apple_alerts(alerts_block)

    # Fallback: Open-Meteo (always free + public)
    payload = apple_payload
    if payload is None:
        payload = await _fetch_open_meteo(lat, lng, wanted)

    if payload is None:
        # Don't 500 — frontend treats missing weather as "no pill" and that's fine.
        return {"ok": False, "source": "none", "current": None}

    # Cache: shortest TTL of any included dataset (current=15min, daily=60min).
    ttl_min = CACHE_TTL_CURRENT_MIN if ("current" in wanted or "hourly" in wanted) else CACHE_TTL_DAILY_MIN
    await _cache_put(ckey, payload, ttl_min=ttl_min)

    # Back-compat shim — older callers (home hero) read `temp_f` and `label`
    # off the root of the response. Surface them so we don't break them.
    cur = payload.get("current") or {}
    payload["temp_f"] = cur.get("temp_f")
    payload["label"] = cur.get("label")
    payload["condition"] = cur.get("label")
    payload["cached"] = False
    return payload


# ─────────────────────────────────────────────────────────────────────
# Diagnostic: confirm config without leaking secrets
# ─────────────────────────────────────────────────────────────────────
@router.get("/weather/config")
async def weather_config():
    """Return whether WeatherKit is configured. Admins can use this to debug
    why a coordinate is falling back to Open-Meteo. No secrets returned."""
    return {
        "weatherkit_configured": weatherkit_configured(),
        "team_id_set": bool(os.environ.get("WEATHERKIT_TEAM_ID") or os.environ.get("APNS_TEAM_ID")),
        "key_id_set":  bool(os.environ.get("WEATHERKIT_KEY_ID")  or os.environ.get("APNS_KEY_ID")),
        "service_id_set": bool(os.environ.get("WEATHERKIT_SERVICE_ID") or os.environ.get("APNS_BUNDLE_ID")),
    }
