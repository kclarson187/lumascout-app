"""
backend_test_weather_elite_pro_v2.py — Independent v2 verification of the
Apple WeatherKit Pro tier (Jun 2026) scope:
  • 5-day forecast cap (was 7)
  • photoPlanning helper (Pro + Elite)
  • tier_features diagnostic on /api/weather/config
  • Defense-in-depth tier gating against unknown query params
  • Pro-safe Open-Meteo fallback path
  • Cache TTL routing (Pro must NOT land in the 5-min Elite bucket)

This test independently re-verifies the spec rather than reusing the
existing harness. It logs in as the seeded admin, flips db.users.plan
to {free,pro,elite} per scenario, and ALWAYS restores the original plan
in tearDown.

Run:
    cd /app && python3 backend_test_weather_elite_pro_v2.py
"""
from __future__ import annotations

import os
import sys
import time
import re
import unittest
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

import requests
from pymongo import MongoClient

# ──────────────────────────────────────────────────────────────────────
# Config — REACT_APP_BACKEND_URL is the only public surface we test.
# In this repo, the frontend uses EXPO_PUBLIC_BACKEND_URL — they point
# at the same external host. We honor either env, then fall back to
# the value pinned in /app/frontend/.env.
# ──────────────────────────────────────────────────────────────────────

def _read_frontend_backend_url() -> str:
    candidates = (
        os.environ.get("REACT_APP_BACKEND_URL"),
        os.environ.get("EXPO_PUBLIC_BACKEND_URL"),
    )
    for c in candidates:
        if c:
            return c.rstrip("/")
    # Fallback to /app/frontend/.env
    try:
        with open("/app/frontend/.env", "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("EXPO_PUBLIC_BACKEND_URL=") or line.startswith(
                    "REACT_APP_BACKEND_URL="
                ):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except Exception:
        pass
    raise RuntimeError("No backend URL available in env or frontend/.env")


BACKEND_URL = _read_frontend_backend_url()
API = f"{BACKEND_URL}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

# Austin TX – matches the spec's example coords.
LAT, LNG = 30.27, -97.74
# A different coord for the cache-TTL test so we don't collide.
LAT_CACHE, LNG_CACHE = 42.0, -71.0

# Mongo direct access (used only to flip users.plan and inspect weather_cache).
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "photoscout_database")
mongo = MongoClient(MONGO_URL, serverSelectionTimeoutMS=2000)
db = mongo[DB_NAME]

# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────


def login_admin() -> Tuple[str, str]:
    """Return (token, user_id). Raises on auth failure."""
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token")
    user = data.get("user") or {}
    uid = user.get("user_id")
    assert token and uid, f"bad login payload: {data}"
    return token, uid


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def set_plan(uid: str, plan: str) -> None:
    res = db.users.update_one({"user_id": uid}, {"$set": {"plan": plan}})
    assert res.matched_count == 1, f"plan flip failed for {uid} -> {plan}"


def get_plan(uid: str) -> Optional[str]:
    u = db.users.find_one({"user_id": uid}) or {}
    return u.get("plan")


def parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def naive(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


# ──────────────────────────────────────────────────────────────────────
# Base class — captures admin token + original plan once per class
# ──────────────────────────────────────────────────────────────────────


class _AdminBase(unittest.TestCase):
    token: str
    uid: str
    original_plan: Optional[str]

    @classmethod
    def setUpClass(cls):
        cls.token, cls.uid = login_admin()
        cls.original_plan = get_plan(cls.uid)

    @classmethod
    def tearDownClass(cls):
        # Always restore the original plan so we never leave the
        # admin user in a tier they didn't start in.
        plan = cls.original_plan or "free"
        try:
            db.users.update_one({"user_id": cls.uid}, {"$set": {"plan": plan}})
        except Exception:
            pass


# ──────────────────────────────────────────────────────────────────────
# 1. Free / anonymous gating
# ──────────────────────────────────────────────────────────────────────


class TestAnonAndFreeGating(_AdminBase):

    BANNED_KEYS_FOR_FREE = (
        "hourly", "daily", "photoPlanning",
        "alerts", "minute_forecast", "best_times",
    )

    def test_anonymous_is_current_only(self):
        """No auth header — must be current-only with no premium fields."""
        r = requests.get(f"{API}/weather", params={"lat": LAT, "lng": LNG}, timeout=20)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        for k in self.BANNED_KEYS_FOR_FREE:
            self.assertNotIn(k, body, f"anon must NOT have {k}; got keys={list(body.keys())}")
        # Required surface for the home hero pill.
        self.assertIn("current", body)
        self.assertIn("temp_f", body)
        self.assertIn("label", body)
        self.assertIn("attribution_url", body)

    def test_free_user_is_current_only(self):
        set_plan(self.uid, "free")
        r = requests.get(
            f"{API}/weather",
            params={"lat": LAT, "lng": LNG},
            headers=auth_headers(self.token),
            timeout=20,
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body.get("plan"), "free")
        for k in self.BANNED_KEYS_FOR_FREE:
            self.assertNotIn(k, body, f"free must NOT have {k}; got keys={list(body.keys())}")
        self.assertIn("current", body)
        self.assertIn("attribution_url", body)


# ──────────────────────────────────────────────────────────────────────
# 2-3. Pro payload + photoPlanning math correctness
# ──────────────────────────────────────────────────────────────────────


class TestProPayload(_AdminBase):
    proPayload: Dict[str, Any] = {}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        set_plan(cls.uid, "pro")
        r = requests.get(
            f"{API}/weather",
            params={"lat": LAT, "lng": LNG},
            headers=auth_headers(cls.token),
            timeout=25,
        )
        assert r.status_code == 200, r.text
        cls.proPayload = r.json()

    def test_pro_top_level_markers(self):
        body = self.proPayload
        self.assertEqual(body.get("plan"), "pro")
        self.assertIn(body.get("source"), ("weatherkit", "open_meteo"))
        self.assertTrue(body.get("attribution_url"))
        self.assertIsInstance(body.get("current"), dict)
        self.assertTrue(body["current"])  # populated

    def test_pro_hourly_shape(self):
        hourly = self.proPayload.get("hourly")
        self.assertIsInstance(hourly, list)
        self.assertGreater(len(hourly), 0)
        self.assertLessEqual(len(hourly), 24)
        h0 = hourly[0]
        for key in ("time", "temp_f", "label", "precip_chance_pct", "wind_mph"):
            self.assertIn(key, h0, f"hourly entry missing {key}: {h0}")

    def test_pro_daily_capped_at_5(self):
        daily = self.proPayload.get("daily")
        self.assertIsInstance(daily, list)
        self.assertGreater(len(daily), 0)
        self.assertLessEqual(len(daily), 5, f"Pro daily MUST be ≤5; got {len(daily)}")
        d0 = daily[0]
        for key in ("date", "high_f", "low_f", "label",
                    "sunrise", "sunset", "precip_chance_pct"):
            self.assertIn(key, d0, f"daily[0] missing {key}: {d0}")

    def test_pro_does_NOT_have_elite_fields(self):
        body = self.proPayload
        for k in ("alerts", "minute_forecast", "best_times",
                  "moon_phase_label", "moon_illumination_pct"):
            self.assertNotIn(k, body, f"Pro MUST NOT have {k}")
        # Daily entries MUST NOT have Elite's per-day enrichment blocks.
        for d in body.get("daily") or []:
            self.assertNotIn("golden_hour", d, f"daily entry leaked golden_hour: {d}")
            self.assertNotIn("blue_hour",   d, f"daily entry leaked blue_hour: {d}")

    def test_pro_photo_planning_present_with_all_7_keys(self):
        pp = self.proPayload.get("photoPlanning")
        self.assertIsInstance(pp, dict, "Pro MUST have photoPlanning object")
        for k in ("todayGoldenHourMorning", "todayGoldenHourEvening",
                  "todayBlueHourMorning",   "todayBlueHourEvening",
                  "sunrise", "sunset", "bestSimpleWindow"):
            self.assertIn(k, pp, f"photoPlanning missing key {k}")

    def test_pro_photo_planning_math_matches_spec(self):
        daily = self.proPayload["daily"]
        d0 = daily[0]
        sr = parse_iso(d0.get("sunrise"))
        ss = parse_iso(d0.get("sunset"))
        self.assertIsNotNone(sr, "daily[0].sunrise should parse")
        self.assertIsNotNone(ss, "daily[0].sunset should parse")
        pp = self.proPayload["photoPlanning"]

        def window(d):
            return parse_iso(d["start"]), parse_iso(d["end"])

        gh_am_s, gh_am_e = window(pp["todayGoldenHourMorning"])
        gh_pm_s, gh_pm_e = window(pp["todayGoldenHourEvening"])
        bh_am_s, bh_am_e = window(pp["todayBlueHourMorning"])
        bh_pm_s, bh_pm_e = window(pp["todayBlueHourEvening"])

        self.assertEqual(gh_am_s, sr, "GH morning start should equal sunrise")
        self.assertEqual(gh_am_e, sr + timedelta(minutes=30))
        self.assertEqual(gh_pm_s, ss - timedelta(minutes=30))
        self.assertEqual(gh_pm_e, ss)
        self.assertEqual(bh_am_s, sr - timedelta(minutes=20))
        self.assertEqual(bh_am_e, sr)
        self.assertEqual(bh_pm_s, ss)
        self.assertEqual(bh_pm_e, ss + timedelta(minutes=20))

    def test_pro_best_simple_window_shape(self):
        pp = self.proPayload["photoPlanning"]
        bsw = pp["bestSimpleWindow"]
        self.assertIsInstance(bsw, dict)
        for k in ("label", "start", "end", "reason"):
            self.assertIn(k, bsw, f"bestSimpleWindow missing {k}")
        self.assertIn(
            "Golden Hour", bsw["label"],
            f"bestSimpleWindow.label must contain 'Golden Hour'; got {bsw['label']!r}",
        )
        reason = bsw["reason"]
        self.assertLessEqual(len(reason), 200, f"reason too long: {len(reason)}")
        self.assertTrue(reason.endswith("."), f"reason must end with '.': {reason!r}")


# ──────────────────────────────────────────────────────────────────────
# 4. Elite STILL gets full Elite payload (incl. Elite-only enrichments).
# ──────────────────────────────────────────────────────────────────────


class TestElitePayloadStillFull(_AdminBase):

    def test_elite_payload_has_full_surface(self):
        set_plan(self.uid, "elite")
        r = requests.get(
            f"{API}/weather",
            params={"lat": LAT, "lng": LNG, "country": "US"},
            headers=auth_headers(self.token),
            timeout=25,
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body.get("plan"), "elite")

        # Daily length ≤10
        daily = body.get("daily") or []
        self.assertIsInstance(daily, list)
        self.assertLessEqual(len(daily), 10, f"Elite daily must be ≤10; got {len(daily)}")
        self.assertGreater(len(daily), 0, "Elite daily must have at least 1 day")

        # Per-day golden/blue enrichment exists on at least one entry
        # (Apple may omit on edge cases — assert at least one carries it).
        gh_seen = any(isinstance(d.get("golden_hour"), dict) for d in daily)
        bh_seen = any(isinstance(d.get("blue_hour"),  dict) for d in daily)
        self.assertTrue(gh_seen, "Elite daily must include per-day golden_hour enrichment")
        self.assertTrue(bh_seen, "Elite daily must include per-day blue_hour enrichment")

        # Elite still gets the photoPlanning helper (a superset of Pro's).
        self.assertIsInstance(body.get("photoPlanning"), dict,
                              "Elite must include photoPlanning")

        # best_times capped at 3 (the Elite engine)
        bt = body.get("best_times")
        # best_times may be absent if engine found no valid windows; if
        # present, must be a list ≤3.
        if bt is not None:
            self.assertIsInstance(bt, list)
            self.assertLessEqual(len(bt), 3)


# ──────────────────────────────────────────────────────────────────────
# 5. Unknown params cannot bypass tier gating
# ──────────────────────────────────────────────────────────────────────


class TestUnknownParamsNoBypass(_AdminBase):

    BANNED = ("alerts", "minute_forecast", "best_times",
              "photoPlanning", "hourly", "daily")

    PARAMS_TO_PROBE = (
        {"date": "2024-10-31"},
        {"historical": "2024-10-31"},
        {"plan": "elite"},
        {"tier": "elite"},
        {"premium": "1"},
        {"unlock": "alerts,minute,best_times"},
    )

    def test_unknown_params_do_not_bypass_free_tier(self):
        set_plan(self.uid, "free")
        for extra in self.PARAMS_TO_PROBE:
            params = {"lat": LAT, "lng": LNG, **extra}
            r = requests.get(
                f"{API}/weather",
                params=params,
                headers=auth_headers(self.token),
                timeout=20,
            )
            self.assertEqual(r.status_code, 200, r.text)
            body = r.json()
            self.assertEqual(
                body.get("plan"), "free",
                f"plan flipped via {extra!r}? plan={body.get('plan')}",
            )
            for k in self.BANNED:
                self.assertNotIn(
                    k, body,
                    f"Free leaked {k} when adding {extra!r}; keys={list(body.keys())}",
                )


# ──────────────────────────────────────────────────────────────────────
# 6. /api/weather/config tier_features block
# ──────────────────────────────────────────────────────────────────────


class TestWeatherConfigTierFeatures(unittest.TestCase):

    REQUIRED_TIER_KEYS = (
        "free_current_weather",
        "pro_hourly_forecast",
        "pro_five_day_forecast",
        "pro_basic_photo_planning",
        "elite_ten_day_forecast",
        "elite_alerts",
        "elite_minute_forecast",
        "elite_lunar_data",
        "elite_best_time_to_shoot",
        "elite_push_alerts",
    )

    def setUp(self):
        r = requests.get(f"{API}/weather/config", timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        self.body = r.json()
        self.raw_text = r.text

    def test_tier_features_block_has_all_10_boolean_keys(self):
        tf = self.body.get("tier_features")
        self.assertIsInstance(tf, dict, "tier_features must be a dict")
        for k in self.REQUIRED_TIER_KEYS:
            self.assertIn(k, tf, f"tier_features missing {k}")
            self.assertIsInstance(tf[k], bool, f"{k} must be bool; got {type(tf[k]).__name__}")

    def test_jwt_and_cache_and_daily_days_diagnostic(self):
        self.assertIn("jwt_signing_configured", self.body)
        self.assertIsInstance(self.body["jwt_signing_configured"], bool)
        self.assertIn("cache_status", self.body)
        self.assertIsInstance(self.body["cache_status"], str)
        ddp = self.body.get("daily_days_by_plan")
        self.assertIsInstance(ddp, dict)
        self.assertEqual(ddp.get("pro"), 5)
        self.assertEqual(ddp.get("elite"), 10)

    def test_backwards_compat_elite_features_block_present(self):
        self.assertIn("elite_features", self.body,
                      "backwards-compat elite_features block missing")
        ef = self.body["elite_features"]
        self.assertIsInstance(ef, dict)
        # Sanity — old callers expected some classic keys.
        for k in ("alerts", "minute_forecast", "moon_data",
                  "golden_blue_hour", "best_times"):
            self.assertIn(k, ef, f"elite_features missing legacy key {k}")

    def test_config_does_not_leak_secrets(self):
        # No PEM/key markers, no .p8 path, no key/team/service IDs.
        forbidden = (
            "BEGIN PRIVATE KEY",
            "BEGIN EC PRIVATE KEY",
            ".p8",
            "BSCF87SBA8",     # APNS_KEY_ID from .env
            "23H3KJ9VVC",     # APNS_TEAM_ID from .env
            "app.emergent.photofinder60669d6fa1",  # bundle id (treated as secret-adjacent)
        )
        for f in forbidden:
            self.assertNotIn(f, self.raw_text,
                             f"/api/weather/config leaks {f!r}")


# ──────────────────────────────────────────────────────────────────────
# 7. Cache TTL routing for Pro (NOT the 5-min Elite bucket)
# ──────────────────────────────────────────────────────────────────────


class TestProCacheTTLRouting(_AdminBase):

    def test_pro_cache_ttl_is_not_5min(self):
        """
        Spec: Pro should NOT use the 5-min Elite (alerts/minute) cache bucket.
        Pro's wanted=('current','hourly','daily') → CACHE_TTL_CURRENT_MIN=15
        (or capped to 10 when Open-Meteo fallback is exercised). We verify
        the stored doc's expires_at is between ~8 and ~16 minutes ahead
        of now — which proves we did NOT land in the 5-minute bucket.
        """
        set_plan(self.uid, "pro")

        # Wipe any pre-existing cache row for this coord (defensive).
        try:
            db.weather_cache.delete_many({"key": {"$regex": "42\\.0:-71\\.0"}})
        except Exception:
            pass

        params = {"lat": LAT_CACHE, "lng": LNG_CACHE}
        r1 = requests.get(
            f"{API}/weather", params=params,
            headers=auth_headers(self.token), timeout=25,
        )
        self.assertEqual(r1.status_code, 200, r1.text)
        body1 = r1.json()
        self.assertFalse(body1.get("cached", False), "first call must NOT be a cache hit")

        # Inspect the cache document directly.
        # The exact key format is "lat:lng:include1,include2,..." — we
        # just search for any doc with our rounded coords.
        time.sleep(0.2)
        rows = list(db.weather_cache.find({"key": {"$regex": "^42\\.0:-71\\.0:"}}))
        self.assertGreaterEqual(len(rows), 1,
                                f"no cache row written; coll has {db.weather_cache.count_documents({})} docs")
        doc = rows[-1]
        exp = doc.get("expires_at")
        self.assertIsNotNone(exp, "cache row missing expires_at")
        if exp.tzinfo is None:
            exp_utc = exp.replace(tzinfo=timezone.utc)
        else:
            exp_utc = exp
        now = datetime.now(timezone.utc)
        ttl_min = (exp_utc - now).total_seconds() / 60.0
        # Acceptable: 15min (WeatherKit primary) or 10min (Open-Meteo
        # fallback ceiling). NEVER 5min (Elite alerts/minute bucket).
        self.assertGreater(ttl_min, 6.0,
                           f"Pro TTL fell into the 5-min Elite bucket: {ttl_min:.2f}min")
        self.assertLess(ttl_min, 17.0,
                        f"Pro TTL too long ({ttl_min:.2f}min); expected ≤16min")

        # 2nd call should be cached:true.
        r2 = requests.get(
            f"{API}/weather", params=params,
            headers=auth_headers(self.token), timeout=20,
        )
        self.assertEqual(r2.status_code, 200, r2.text)
        body2 = r2.json()
        self.assertTrue(body2.get("cached") is True,
                        f"2nd call expected cached=true; got cached={body2.get('cached')!r}")


# ──────────────────────────────────────────────────────────────────────
# 8. Open-Meteo fallback is Pro-safe
# ──────────────────────────────────────────────────────────────────────


class TestOpenMeteoFallbackIsProSafe(_AdminBase):

    def test_open_meteo_fallback_produces_complete_pro_payload(self):
        set_plan(self.uid, "pro")
        # Force a fresh fetch by picking a brand-new coord.
        r = requests.get(
            f"{API}/weather",
            params={"lat": 47.61, "lng": -122.33},  # Seattle
            headers=auth_headers(self.token),
            timeout=25,
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        # In this environment WK is NOT_ENABLED → source should be
        # open_meteo. If WK ever lights up, we still accept it.
        self.assertIn(body.get("source"), ("open_meteo", "weatherkit"))
        # If we actually exercised the fallback, sanity-check the surface.
        self.assertEqual(body.get("plan"), "pro")
        self.assertIsInstance(body.get("current"), dict)
        self.assertIsInstance(body.get("hourly"),  list)
        daily = body.get("daily")
        self.assertIsInstance(daily, list)
        self.assertLessEqual(len(daily), 5,
                             f"Pro fallback daily must be ≤5; got {len(daily)}")
        self.assertIsInstance(body.get("photoPlanning"), dict,
                              "Pro fallback must still produce photoPlanning")
        # No Elite leakage via fallback.
        for k in ("alerts", "minute_forecast", "best_times"):
            self.assertNotIn(k, body, f"fallback leaked Elite key {k}")
        for d in daily:
            self.assertNotIn("golden_hour", d)
            self.assertNotIn("blue_hour",   d)


# ──────────────────────────────────────────────────────────────────────
# 9. Regression smoke — /api/health, /api/auth/me, /api/feed/home
# ──────────────────────────────────────────────────────────────────────


class TestRegressionSmoke(_AdminBase):

    def test_health(self):
        r = requests.get(f"{API}/health", timeout=10)
        self.assertEqual(r.status_code, 200, r.text)

    def test_auth_me(self):
        r = requests.get(
            f"{API}/auth/me",
            headers=auth_headers(self.token),
            timeout=10,
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body.get("email"), ADMIN_EMAIL)

    def test_feed_home(self):
        r = requests.get(
            f"{API}/feed/home",
            headers=auth_headers(self.token),
            timeout=15,
        )
        self.assertEqual(r.status_code, 200, r.text)


# ──────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"[v2] API base: {API}")
    print(f"[v2] Mongo:    {MONGO_URL} / db={DB_NAME}")
    unittest.main(verbosity=2)
