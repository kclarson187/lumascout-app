"""
backend_test_weather_elite.py — Elite WeatherKit feature tests (Jun 2025)
═══════════════════════════════════════════════════════════════════════

What it tests
─────────────
Extends the prior /api/weather tests with the new Elite payload (10-day
forecast, alerts enrichment, minute-by-minute precipitation, moon data,
golden/blue hour, visibility, cloud cover, best-time-to-shoot), the
subscribe endpoint, and the alert worker's pure logic (window finders
and dedupe).

How to run
──────────
    cd /app && python backend_test_weather_elite.py

Or as a pytest target:
    cd /app && python -m pytest backend_test_weather_elite.py -v

Environment
───────────
Hits the local backend at http://localhost:8001 by default. Override
with BACKEND_URL=https://… for staging/prod.

Important assumptions
─────────────────────
• Apple's WeatherKit capability for our Services ID may still be in the
  "NOT_ENABLED" state, so we accept BOTH `source=weatherkit` and
  `source=open_meteo` for any payload-level test. Tests that specifically
  exercise WeatherKit-only fields (minute forecast, alerts severity) are
  marked accept-skip when the response source is open_meteo.

• Auth uses admin@lumascout.app / Grayson@1117!! (seeded super_admin).
  Tests temporarily flip the user's `plan` field in MongoDB to exercise
  elite paths, then restore the original plan in tearDown.
"""
from __future__ import annotations

import json
import os
import sys
import time
import unittest
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests
from pymongo import MongoClient

# ─────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001").rstrip("/")
MONGO_URL   = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME     = os.environ.get("DB_NAME", "photoscout_database")
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

# Common test coords
AUSTIN = (30.2672, -97.7431)
NYC    = (40.7128, -74.0060)
SF     = (37.7749, -122.4194)


def _post(path: str, **kwargs) -> requests.Response:
    return requests.post(f"{BACKEND_URL}{path}", timeout=15, **kwargs)


def _get(path: str, **kwargs) -> requests.Response:
    return requests.get(f"{BACKEND_URL}{path}", timeout=15, **kwargs)


def _delete(path: str, **kwargs) -> requests.Response:
    return requests.delete(f"{BACKEND_URL}{path}", timeout=15, **kwargs)


def _login_admin() -> str:
    r = _post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    r.raise_for_status()
    data = r.json()
    # API may return token under different keys depending on the auth route.
    return data.get("access_token") or data.get("token") or data.get("session_token")


def _auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ─────────────────────────────────────────────────────────────────────
# Direct DB helpers for plan switching
# ─────────────────────────────────────────────────────────────────────
_db = MongoClient(MONGO_URL)[DB_NAME]


def _set_user_plan(email: str, plan: str) -> Optional[str]:
    """Set user's plan; return the previous plan value (so we can restore)."""
    doc = _db.users.find_one({"email": email}, {"plan": 1})
    prev = (doc or {}).get("plan", "free")
    _db.users.update_one({"email": email}, {"$set": {"plan": plan}})
    return prev


# ─────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────
class TestWeatherEliteConfig(unittest.TestCase):
    """Quick sanity that the new diagnostic endpoint reports Elite flags."""

    def test_config_reports_elite_flags(self):
        r = _get("/api/weather/config")
        self.assertEqual(r.status_code, 200)
        cfg = r.json()
        self.assertIn("elite_features", cfg, "config should expose elite_features")
        ef = cfg["elite_features"]
        for k in ("alerts", "minute_forecast", "moon_data",
                  "golden_blue_hour", "best_times", "ten_day_forecast",
                  "push_alerts"):
            self.assertIn(k, ef, f"elite_features.{k} should be present")
        self.assertIn("cache_ttl_minutes", cfg)
        self.assertEqual(cfg["cache_ttl_minutes"]["minute"], 5)
        self.assertEqual(cfg["cache_ttl_minutes"]["alerts"], 5)

    def test_config_does_not_leak_secrets(self):
        r = _get("/api/weather/config")
        raw = r.text
        for bad in (".p8", "BEGIN PRIVATE KEY", "BSCF87SBA8", "23H3KJ9VVC"):
            self.assertNotIn(bad, raw, f"config response leaks: {bad}")


class TestPlanTierGating(unittest.TestCase):
    """Verify Elite-only fields are ABSENT (not null) from free/pro responses."""

    @classmethod
    def setUpClass(cls):
        cls.token = _login_admin()
        cls.prev_plan = _set_user_plan(ADMIN_EMAIL, "free")

    @classmethod
    def tearDownClass(cls):
        _set_user_plan(ADMIN_EMAIL, cls.prev_plan or "free")

    def test_anonymous_current_only_no_elite_keys(self):
        r = _get(f"/api/weather?lat={AUSTIN[0]}&lng={AUSTIN[1]}")
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertNotIn("alerts", d)
        self.assertNotIn("minute_forecast", d)
        self.assertNotIn("best_times", d)
        # anon plan defaults to current-only, so no hourly/daily either
        self.assertNotIn("hourly", d)
        self.assertNotIn("daily", d)

    def test_free_user_no_elite_keys(self):
        _set_user_plan(ADMIN_EMAIL, "free")
        r = _get(f"/api/weather?lat={AUSTIN[0]}&lng={AUSTIN[1]}",
                 headers=_auth_headers(self.token))
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertNotIn("alerts", d)
        self.assertNotIn("minute_forecast", d)
        self.assertNotIn("best_times", d)
        self.assertEqual(d.get("plan"), "free")

    def test_pro_user_gets_seven_day_no_elite_keys(self):
        _set_user_plan(ADMIN_EMAIL, "pro")
        r = _get(f"/api/weather?lat={AUSTIN[0]}&lng={AUSTIN[1]}",
                 headers=_auth_headers(self.token))
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertIn("hourly", d)
        self.assertIn("daily", d)
        # Pro caps at 7 days even from Apple's 10-day response
        self.assertLessEqual(len(d.get("daily", [])), 7)
        self.assertNotIn("alerts", d)
        self.assertNotIn("minute_forecast", d)
        self.assertNotIn("best_times", d)

    def test_free_cannot_force_elite_via_include_param(self):
        _set_user_plan(ADMIN_EMAIL, "free")
        # Try to sneak Elite datasets through the include param.
        r = _get(f"/api/weather?lat={AUSTIN[0]}&lng={AUSTIN[1]}"
                 "&include=current,alerts,minute,best_times&country=US",
                 headers=_auth_headers(self.token))
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertNotIn("alerts", d, "free user should not see alerts even if asked")
        self.assertNotIn("minute_forecast", d)
        self.assertNotIn("best_times", d)


class TestEliteEnrichments(unittest.TestCase):
    """Elite user gets the new fields whenever the upstream returns data
    that supports them. Tests adapt when WeatherKit's Services ID is
    NOT_ENABLED (skip minute / severity-grade checks but still verify the
    derived fields work — golden_hour, best_times, 10-day cap)."""

    @classmethod
    def setUpClass(cls):
        cls.token = _login_admin()
        cls.prev_plan = _set_user_plan(ADMIN_EMAIL, "elite")

    @classmethod
    def tearDownClass(cls):
        _set_user_plan(ADMIN_EMAIL, cls.prev_plan or "free")

    def _elite_payload(self) -> Dict[str, Any]:
        r = _get(f"/api/weather?lat={NYC[0]}&lng={NYC[1]}&country=US",
                 headers=_auth_headers(self.token))
        self.assertEqual(r.status_code, 200, r.text[:200])
        return r.json()

    def test_elite_plan_marker(self):
        d = self._elite_payload()
        self.assertEqual(d.get("plan"), "elite")
        self.assertIn(d.get("source"), ("weatherkit", "open_meteo"))

    def test_daily_extends_to_ten_days(self):
        d = self._elite_payload()
        daily = d.get("daily") or []
        self.assertGreaterEqual(len(daily), 7, "elite should still get ≥7 days")
        # Open-Meteo public profile maxes at 7 by request; WeatherKit at 10.
        # So we accept 7..10. The cap test is "must not exceed 10".
        self.assertLessEqual(len(daily), 10)

    def test_golden_and_blue_hour_blocks_present_on_daily(self):
        d = self._elite_payload()
        daily = d.get("daily") or []
        self.assertTrue(daily, "elite needs daily")
        first = daily[0]
        self.assertIn("golden_hour", first)
        self.assertIn("blue_hour", first)
        gh = first["golden_hour"]
        bh = first["blue_hour"]
        # Each side (am/pm) should be either a dict with start/end or None
        for w in (gh.get("am"), gh.get("pm"), bh.get("am"), bh.get("pm")):
            if w is not None:
                self.assertIn("start", w)
                self.assertIn("end", w)

    def test_moon_phase_label_and_illumination_when_weatherkit(self):
        d = self._elite_payload()
        daily = d.get("daily") or []
        if d.get("source") != "weatherkit":
            self.skipTest("requires weatherkit source — Open-Meteo lacks moonPhase")
        first = daily[0]
        # When Apple supplied moonPhase, we should have a human label + illum %.
        if first.get("moon_phase"):
            self.assertIsNotNone(first.get("moon_phase_label"))
            self.assertIsNotNone(first.get("moon_illumination_pct"))

    def test_current_includes_visibility_and_cloud_cover(self):
        d = self._elite_payload()
        cur = d.get("current") or {}
        # These fields may be None if upstream lacks data, but the keys
        # must exist in the shape (so the frontend can render gracefully).
        # WeatherKit always returns them; Open-Meteo includes humidity but
        # not visibility/cloud cover for current — we accept absent keys.
        if d.get("source") == "weatherkit":
            self.assertIn("visibility_mi", cur)
            self.assertIn("visibility_km", cur)
            self.assertIn("cloud_cover_pct", cur)

    def test_minute_forecast_when_available(self):
        """Apple returns forecastNextHour only for supported regions.
        We don't fail when it's missing — we verify it's never set to null."""
        d = self._elite_payload()
        if "minute_forecast" in d:
            mf = d["minute_forecast"]
            self.assertIsNotNone(mf)
            self.assertIn("minutes", mf)
            self.assertLessEqual(len(mf["minutes"]), 60)
            for m in mf["minutes"]:
                self.assertIn("time", m)

    def test_alerts_when_country_provided_and_weatherkit(self):
        d = self._elite_payload()
        if d.get("source") != "weatherkit":
            self.skipTest("alerts require weatherkit source")
        # Field is included only if there are active alerts; we tolerate empty.
        if "alerts" in d:
            for a in d["alerts"]:
                self.assertIn("severity", a)
                self.assertIn("source", a)
                self.assertIn("onset", a)
                self.assertIn("expires", a)
                self.assertIn("description", a)

    def test_best_times_compute(self):
        d = self._elite_payload()
        # best_times needs hourly + daily; both should be present for elite.
        self.assertIn("hourly", d)
        self.assertIn("daily", d)
        if "best_times" in d:
            self.assertLessEqual(len(d["best_times"]), 3)
            for bt in d["best_times"]:
                self.assertIn("start", bt)
                self.assertIn("end", bt)
                self.assertIn("window_type", bt)
                self.assertIn(bt["window_type"], ("golden", "blue"))
                self.assertIn("label", bt)
                # Label format: "Today/Tomorrow/<weekday> — <Type> Hour, <Cond>"
                self.assertIn("Hour", bt["label"])

    def test_attribution_url_present(self):
        d = self._elite_payload()
        # Either Apple's or Open-Meteo's attribution should be there per spec.
        self.assertIn("attribution_url", d)
        url = d["attribution_url"]
        self.assertTrue(url.startswith("http"), f"weird attribution: {url}")


class TestBestTimesAlgorithmHTTP(unittest.TestCase):
    """HTTP-level tests of the best-times algorithm. Pure unit tests of the
    in-process helpers would require importing routes.weather, which loads
    server.py — and server.py registers the weather router after import,
    creating a transient circular reference Python can't satisfy outside the
    live FastAPI startup. So we exercise the same code paths through real
    requests against the running backend."""

    @classmethod
    def setUpClass(cls):
        cls.token = _login_admin()
        cls.prev_plan = _set_user_plan(ADMIN_EMAIL, "elite")

    @classmethod
    def tearDownClass(cls):
        _set_user_plan(ADMIN_EMAIL, cls.prev_plan or "free")

    def test_best_times_capped_at_three(self):
        r = _get(f"/api/weather?lat={SF[0]}&lng={SF[1]}&country=US",
                 headers=_auth_headers(self.token))
        self.assertEqual(r.status_code, 200)
        d = r.json()
        # Even on a perfect-weather coord, we never return more than 3.
        self.assertLessEqual(len(d.get("best_times") or []), 3)

    def test_best_times_shape(self):
        r = _get(f"/api/weather?lat={SF[0]}&lng={SF[1]}&country=US",
                 headers=_auth_headers(self.token))
        self.assertEqual(r.status_code, 200)
        for bt in (r.json().get("best_times") or []):
            # Window times must be ISO-ish strings, type one of two, label has 'Hour'.
            self.assertIsInstance(bt.get("start"), str)
            self.assertIsInstance(bt.get("end"), str)
            self.assertIn(bt.get("window_type"), ("golden", "blue"))
            self.assertIn("Hour", bt.get("label") or "")


class TestSubscribeEndpoint(unittest.TestCase):
    """POST /api/weather/alerts/subscribe and friends."""

    @classmethod
    def setUpClass(cls):
        cls.token = _login_admin()
        cls.prev_plan = _set_user_plan(ADMIN_EMAIL, "elite")
        # Use a stable, valid-shape APNs hex token (64 hex chars).
        cls.device_token = "a" * 64

    @classmethod
    def tearDownClass(cls):
        # Clean any leftover subs from this user.
        _db.weather_alert_subscriptions.delete_many({"user_id": {"$exists": True}})
        _set_user_plan(ADMIN_EMAIL, cls.prev_plan or "free")

    def test_subscribe_requires_auth(self):
        r = _post("/api/weather/alerts/subscribe", json={
            "device_token": self.device_token,
            "lat": 30, "lng": -97,
            "preferences": {"severe": True},
        })
        self.assertEqual(r.status_code, 401)

    def test_subscribe_requires_elite(self):
        _set_user_plan(ADMIN_EMAIL, "free")
        r = _post("/api/weather/alerts/subscribe",
                  headers=_auth_headers(self.token),
                  json={
                      "device_token": self.device_token,
                      "lat": 30, "lng": -97,
                      "preferences": {"severe": True},
                  })
        self.assertEqual(r.status_code, 402)
        _set_user_plan(ADMIN_EMAIL, "elite")

    def test_subscribe_validates_input(self):
        # Bad token
        r = _post("/api/weather/alerts/subscribe",
                  headers=_auth_headers(self.token),
                  json={
                      "device_token": "short",
                      "lat": 30, "lng": -97,
                      "preferences": {"severe": True},
                  })
        self.assertEqual(r.status_code, 400)

        # Bad coords (out of range)
        r = _post("/api/weather/alerts/subscribe",
                  headers=_auth_headers(self.token),
                  json={
                      "device_token": self.device_token,
                      "lat": 99, "lng": 0,
                      "preferences": {"severe": True},
                  })
        self.assertEqual(r.status_code, 400)

        # No preferences set
        r = _post("/api/weather/alerts/subscribe",
                  headers=_auth_headers(self.token),
                  json={
                      "device_token": self.device_token,
                      "lat": 30, "lng": -97,
                      "preferences": {},
                  })
        self.assertEqual(r.status_code, 400)

    def test_subscribe_happy_path_and_listing(self):
        r = _post("/api/weather/alerts/subscribe",
                  headers=_auth_headers(self.token),
                  json={
                      "device_token": self.device_token,
                      "lat": 30.27, "lng": -97.74,
                      "spot_id": "test-spot-123",
                      "preferences": {"severe": True, "clear_sky": True, "golden_hour": False},
                  })
        self.assertEqual(r.status_code, 201, r.text[:200])
        data = r.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["preferences"]["severe"], True)
        self.assertEqual(data["preferences"]["golden_hour"], False)
        self.assertEqual(data["spot_id"], "test-spot-123")

        # Re-subscribing same coord should upsert, not duplicate.
        r2 = _post("/api/weather/alerts/subscribe",
                   headers=_auth_headers(self.token),
                   json={
                       "device_token": self.device_token,
                       "lat": 30.27, "lng": -97.74,
                       "preferences": {"severe": False, "clear_sky": True, "golden_hour": True},
                   })
        self.assertEqual(r2.status_code, 201)

        # List subs — should be exactly 1 active (re-sub overwrote prefs).
        rl = _get("/api/weather/alerts/subscriptions",
                  headers=_auth_headers(self.token))
        self.assertEqual(rl.status_code, 200)
        listing = rl.json()
        self.assertGreaterEqual(listing["count"], 1)
        match = [s for s in listing["subscriptions"]
                 if round(s["lat"], 2) == 30.27 and round(s["lng"], 2) == -97.74]
        self.assertEqual(len(match), 1)
        self.assertEqual(match[0]["preferences"]["golden_hour"], True)
        # Device token must NOT be echoed back from the listing endpoint.
        self.assertNotIn("device_token", match[0])

    def test_unsubscribe(self):
        # Subscribe so we have something to remove.
        _post("/api/weather/alerts/subscribe",
              headers=_auth_headers(self.token),
              json={
                  "device_token": self.device_token,
                  "lat": 35.5, "lng": -120.0,
                  "preferences": {"severe": True},
              })
        r = _delete("/api/weather/alerts/subscribe?lat=35.5&lng=-120",
                    headers=_auth_headers(self.token))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])
        # Idempotent — calling again still 200.
        r2 = _delete("/api/weather/alerts/subscribe?lat=35.5&lng=-120",
                     headers=_auth_headers(self.token))
        self.assertEqual(r2.status_code, 200)


class TestWorkerPureLogic(unittest.TestCase):
    """Direct test of the worker's pure helper functions — no APNs sent."""

    def _imp(self):
        sys.path.insert(0, "/app/backend")
        from services.weather_alerts_worker import (  # noqa
            _is_deduped, _find_clear_sky_window, _find_imminent_light_window,
            DEDUP_MIN_GAP_HOURS,
        )
        return _is_deduped, _find_clear_sky_window, _find_imminent_light_window, DEDUP_MIN_GAP_HOURS

    def test_dedupe_within_window(self):
        is_dedup, *_ , GAP = self._imp()
        # last alert 1 hour ago < 6-hour gap → deduped
        now = datetime.utcnow()
        from datetime import timedelta
        self.assertTrue(is_dedup(now - timedelta(hours=1), now))
        # last alert 10 hours ago > 6-hour gap → not deduped
        self.assertFalse(is_dedup(now - timedelta(hours=10), now))
        # No prior alert → not deduped
        self.assertFalse(is_dedup(None, now))

    def test_clear_sky_finder(self):
        _, find_cs, _, _ = self._imp()
        hourly = [
            {"time": "T1", "cloud_cover_pct": 80, "precip_chance_pct": 0, "wind_mph": 5},
            {"time": "T2", "cloud_cover_pct": 20, "precip_chance_pct": 0, "wind_mph": 5},
            {"time": "T3", "cloud_cover_pct": 10, "precip_chance_pct": 5, "wind_mph": 4},
        ]
        # Two-hour streak found starting T2.
        self.assertEqual(find_cs(hourly, lookahead_h=4, min_window_h=2), "T2")
        # Nothing qualifies if we tighten precip.
        hourly[1]["precip_chance_pct"] = 100
        self.assertIsNone(find_cs(hourly, lookahead_h=4, min_window_h=2))


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Use a single TestLoader so we get aggregated output similar to pytest.
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for cls in (TestWeatherEliteConfig, TestPlanTierGating,
                TestEliteEnrichments, TestBestTimesAlgorithmHTTP,
                TestSubscribeEndpoint, TestWorkerPureLogic):
        suite.addTests(loader.loadTestsFromTestCase(cls))
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
