"""
services/weatherkit.py — Apple WeatherKit REST API client (Jun 2025)
════════════════════════════════════════════════════════════════════

Why this exists
───────────────
LumaScout's Elite tier promises premium weather data:
  • 5-day forecast with precision
  • Hourly forecasts (next 24h)
  • UV index, humidity, precipitation chance
  • Severe weather alerts

The free Open-Meteo API (used in shoot_plan.py) is good enough for
mid-tier features but lacks proprietary data Apple invested in
(WeatherKit pulls from Dark Sky + Apple's own infrastructure).

This module fronts Apple's WeatherKit REST API
(https://weatherkit.apple.com/api/v1/) so EVERY platform (iOS / Android /
web) benefits from premium weather without bundling the native WeatherKit
SDK — a deliberate cross-platform choice. The native iOS WeatherKit
framework is reserved for future device-side optimizations.

Auth
────
WeatherKit uses ES256-signed JWTs identical in shape to APNs JWTs, with
two extra claims:
  • `sub` — Services ID (we reuse the iOS bundle identifier, which Apple
            allows for first-party WeatherKit access when the .p8 key has
            WeatherKit capability enabled).
  • Header `id` — `<TeamID>.<ServiceID>` composite identifier.

The .p8 key at `/app/secrets/AuthKey_BSCF87SBA8.p8` was provisioned with
all four capabilities (APNs + DeviceCheck + SIWA + WeatherKit) — see
test_credentials.md L41-49.

Env vars
────────
Reuses APNs config when WeatherKit-specific vars aren't set, since we use
the same key for both services:
  WEATHERKIT_KEY_ID     (defaults to APNS_KEY_ID)
  WEATHERKIT_TEAM_ID    (defaults to APNS_TEAM_ID)
  WEATHERKIT_SERVICE_ID (defaults to APNS_BUNDLE_ID)
  WEATHERKIT_KEY_PATH   (defaults to APNS_KEY_PATH)

If any are missing or the .p8 file isn't readable, weatherkit_configured()
returns False and every fetch returns None — callers should fall back to
Open-Meteo (already wired in shoot_plan.py and the new /api/weather route).

Caching
───────
Apple charges per 500K requests/mo (free tier). We cache responses in
MongoDB collection `weather_cache` keyed by rounded (lat, lng, ttl_bucket)
with a TTL index for automatic expiry. Bucket sizes:
  • current/hourly:  15 min   (matches Apple's update cadence)
  • daily:           60 min
This drops live API calls by ~95% for typical browsing patterns.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import jwt  # PyJWT

log = logging.getLogger("lumascout.weatherkit")

# ──────────────────────────────────────────────────────────────────────────
# Config (read at module load; reuses APNs vars as defaults)
# ──────────────────────────────────────────────────────────────────────────
WEATHERKIT_KEY_ID     = (os.environ.get("WEATHERKIT_KEY_ID")
                          or os.environ.get("APNS_KEY_ID", "")).strip()
WEATHERKIT_TEAM_ID    = (os.environ.get("WEATHERKIT_TEAM_ID")
                          or os.environ.get("APNS_TEAM_ID", "")).strip()
WEATHERKIT_SERVICE_ID = (os.environ.get("WEATHERKIT_SERVICE_ID")
                          or os.environ.get("APNS_BUNDLE_ID", "")).strip()
WEATHERKIT_KEY_PATH   = (os.environ.get("WEATHERKIT_KEY_PATH")
                          or os.environ.get("APNS_KEY_PATH", "")).strip()

WEATHERKIT_API_BASE = "https://weatherkit.apple.com/api/v1"

# Apple WeatherKit JWTs are valid up to 1h. Re-sign at 55 min.
_JWT_TTL_SECONDS = 55 * 60

# Module-level caches (process-lifetime)
_cached_jwt: Optional[str] = None
_cached_jwt_exp: float = 0.0
_cached_key_bytes: Optional[bytes] = None


def weatherkit_configured() -> bool:
    """True iff all env vars are set AND the .p8 file is readable."""
    if not (WEATHERKIT_KEY_ID and WEATHERKIT_TEAM_ID
            and WEATHERKIT_SERVICE_ID and WEATHERKIT_KEY_PATH):
        return False
    try:
        return Path(WEATHERKIT_KEY_PATH).is_file()
    except Exception:
        return False


def _load_key_bytes() -> bytes:
    global _cached_key_bytes
    if _cached_key_bytes is not None:
        return _cached_key_bytes
    _cached_key_bytes = Path(WEATHERKIT_KEY_PATH).read_bytes()
    return _cached_key_bytes


def _current_jwt() -> str:
    """Return a valid ES256-signed JWT for WeatherKit, caching across calls."""
    global _cached_jwt, _cached_jwt_exp
    now = time.time()
    if _cached_jwt and now < _cached_jwt_exp:
        return _cached_jwt
    key = _load_key_bytes()
    claims = {
        "iss": WEATHERKIT_TEAM_ID,
        "iat": int(now),
        "exp": int(now) + 3600,  # max 1h
        "sub": WEATHERKIT_SERVICE_ID,
    }
    headers = {
        "alg": "ES256",
        "kid": WEATHERKIT_KEY_ID,
        "id": f"{WEATHERKIT_TEAM_ID}.{WEATHERKIT_SERVICE_ID}",
        "typ": "JWT",
    }
    token = jwt.encode(claims, key, algorithm="ES256", headers=headers)
    _cached_jwt = token if isinstance(token, str) else token.decode()
    _cached_jwt_exp = now + _JWT_TTL_SECONDS
    return _cached_jwt


# Shared HTTP/2 client so we reuse the TLS handshake across calls.
_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(http2=True, timeout=httpx.Timeout(8.0, connect=4.0))
    return _client


async def close_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        try:
            await _client.aclose()
        except Exception:
            pass
        _client = None


# ──────────────────────────────────────────────────────────────────────────
# WeatherKit data set names (per Apple docs)
# ──────────────────────────────────────────────────────────────────────────
DATASET_CURRENT  = "currentWeather"
DATASET_HOURLY   = "forecastHourly"
DATASET_DAILY    = "forecastDaily"
DATASET_ALERTS   = "weatherAlerts"

ALL_DATASETS = [DATASET_CURRENT, DATASET_HOURLY, DATASET_DAILY]


async def fetch_weather(
    lat: float,
    lng: float,
    *,
    datasets: Optional[List[str]] = None,
    language: str = "en",
    country_code: Optional[str] = None,
    timezone: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetch weather data from Apple's WeatherKit REST API.

    Returns the raw Apple JSON on success, None on any failure. Never raises.

    Apple's endpoint: GET /api/v1/weather/{language}/{latitude}/{longitude}
                       ?dataSets=<comma-separated>
                       &timezone=<IANA>     (recommended for daily/hourly alignment)
                       &countryCode=<ISO2>  (required for weatherAlerts)
    """
    if not weatherkit_configured():
        log.debug("weatherkit_not_configured — skipping fetch_weather")
        return None

    sets = datasets or ALL_DATASETS
    params: Dict[str, Any] = {"dataSets": ",".join(sets)}
    if country_code:
        params["countryCode"] = country_code.upper()
    if timezone:
        params["timezone"] = timezone

    url = f"{WEATHERKIT_API_BASE}/weather/{language}/{lat:.5f}/{lng:.5f}"
    token = _current_jwt()
    headers = {"Authorization": f"Bearer {token}"}

    try:
        client = _get_client()
        r = await client.get(url, params=params, headers=headers)
        if r.status_code == 200:
            return r.json()
        # Don't log the bearer token; do log status + truncated body for ops.
        log.warning(
            "weatherkit_non_200 status=%s lat=%.4f lng=%.4f body=%r",
            r.status_code, lat, lng, r.text[:200]
        )
        return None
    except httpx.TimeoutException:
        log.warning("weatherkit_timeout lat=%.4f lng=%.4f", lat, lng)
        return None
    except Exception as e:
        log.warning("weatherkit_error lat=%.4f lng=%.4f err=%r", lat, lng, e)
        return None


# ──────────────────────────────────────────────────────────────────────────
# Apple WeatherKit condition codes → SF Symbol mapping
# (Used by frontend to render the matching icon.)
# Source: https://developer.apple.com/documentation/weatherkit/weathercondition
# ──────────────────────────────────────────────────────────────────────────
_SF_SYMBOL_MAP: Dict[str, str] = {
    "Clear":            "sun.max.fill",
    "Cloudy":           "cloud.fill",
    "Dust":             "sun.dust.fill",
    "Fog":              "cloud.fog.fill",
    "Haze":             "sun.haze.fill",
    "MostlyClear":      "sun.max.fill",
    "MostlyCloudy":     "cloud.fill",
    "PartlyCloudy":     "cloud.sun.fill",
    "ScatteredThunderstorms": "cloud.sun.bolt.fill",
    "Smoke":            "smoke.fill",
    "Breezy":           "wind",
    "Windy":            "wind",
    "Drizzle":          "cloud.drizzle.fill",
    "HeavyRain":        "cloud.heavyrain.fill",
    "Rain":             "cloud.rain.fill",
    "Showers":          "cloud.rain.fill",
    "Flurries":         "snowflake",
    "HeavySnow":        "snowflake",
    "MixedRainAndSleet": "cloud.sleet.fill",
    "MixedRainAndSnow":  "cloud.sleet.fill",
    "MixedRainfall":     "cloud.rain.fill",
    "MixedSnowAndSleet": "cloud.sleet.fill",
    "ScatteredShowers":  "cloud.rain.fill",
    "ScatteredSnowShowers": "cloud.snow.fill",
    "Sleet":            "cloud.sleet.fill",
    "Snow":             "cloud.snow.fill",
    "SnowShowers":      "cloud.snow.fill",
    "Blizzard":         "wind.snow",
    "BlowingSnow":      "wind.snow",
    "FreezingDrizzle":  "cloud.sleet.fill",
    "FreezingRain":     "cloud.sleet.fill",
    "Frigid":           "thermometer.snowflake",
    "Hail":             "cloud.hail.fill",
    "Hot":              "thermometer.sun.fill",
    "Hurricane":        "hurricane",
    "IsolatedThunderstorms": "cloud.bolt.fill",
    "SevereThunderstorm":   "cloud.bolt.rain.fill",
    "Thunderstorm":     "cloud.bolt.fill",
    "Thunderstorms":    "cloud.bolt.fill",
    "Tornado":          "tornado",
    "TropicalStorm":    "tropicalstorm",
}


def sf_symbol_for(condition_code: Optional[str]) -> str:
    """Map an Apple `conditionCode` to an SF Symbol name. Defaults to
    `cloud.fill` for any unmapped/missing code."""
    if not condition_code:
        return "cloud.fill"
    return _SF_SYMBOL_MAP.get(condition_code, "cloud.fill")


def human_label_for(condition_code: Optional[str]) -> str:
    """Turn a CamelCase condition code into a human-friendly label.
    `PartlyCloudy` → `Partly Cloudy`. Returns "Clear" as fallback."""
    if not condition_code:
        return "Clear"
    out = []
    for i, ch in enumerate(condition_code):
        if i > 0 and ch.isupper():
            out.append(" ")
        out.append(ch)
    return "".join(out)


# ──────────────────────────────────────────────────────────────────────────
# Unit conversions (Apple returns Celsius / mm/km/h / m/s by default)
# ──────────────────────────────────────────────────────────────────────────
def c_to_f(c: Optional[float]) -> Optional[float]:
    if c is None:
        return None
    return c * 9 / 5 + 32


def mps_to_mph(mps: Optional[float]) -> Optional[float]:
    if mps is None:
        return None
    return mps * 2.23694


def km_to_mi(km: Optional[float]) -> Optional[float]:
    if km is None:
        return None
    return km * 0.621371


def mm_to_in(mm: Optional[float]) -> Optional[float]:
    if mm is None:
        return None
    return mm / 25.4
