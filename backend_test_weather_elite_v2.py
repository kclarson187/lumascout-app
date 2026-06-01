"""
backend_test_weather_elite_v2.py — Independent verification of Elite
weather endpoints, written by the testing agent (Jun 2025).

Covers ALL 10 review-request sections beyond what backend_test_weather_elite.py
already covers. Uses the public preview URL (REACT_APP_BACKEND_URL) when
available, otherwise falls back to localhost:8001.

    cd /app && python3 backend_test_weather_elite_v2.py
"""
from __future__ import annotations

import os
import sys
import time
import unittest
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import requests
from pymongo import MongoClient

# ─────────────────────────────────────────────────────────────────────
# Config — prefer public preview URL per environment rules
# ─────────────────────────────────────────────────────────────────────
BACKEND_URL = os.environ.get(
    "BACKEND_URL",
    "https://photo-finder-60.preview.emergentagent.com",
).rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "photoscout_database")
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

AUSTIN = (30.27, -97.74)
NYC = (40.7128, -74.0060)
SF = (37.7749, -122.4194)
LA_OCEAN = (33.0, -118.0)  # unused-anywhere-else coord for cache tests
SEATTLE = (47.6062, -122.3321)

_db = MongoClient(MONGO_URL)[DB_NAME]


def _g(path: str, **kw) -> requests.Response:
    return requests.get(f"{BACKEND_URL}{path}", timeout=20, **kw)


def _p(path: str, **kw) -> requests.Response:
    return requests.post(f"{BACKEND_URL}{path}", timeout=20, **kw)


def _d(path: str, **kw) -> requests.Response:
    return requests.delete(f"{BACKEND_URL}{path}", timeout=20, **kw)


def _login() -> str:
    r = _p("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    r.raise_for_status()
    body = r.json()
    return body.get("access_token") or body.get("token") or body.get("session_token")


def _hdr(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _set_plan(email: str, plan: str) -> Optional[str]:
    doc = _db.users.find_one({"email": email}, {"plan": 1})
    prev = (doc or {}).get("plan", "free")
    _db.users.update_one({"email": email}, {"$set": {"plan": plan}})
    return prev


def _restore_plan(email: str, plan: Optional[str]) -> None:
    if plan is None:
        plan = "free"
    _db.users.update_one({"email": email}, {"$set": {"plan": plan}})


def _parse_iso(s: str) -> datetime:
    """Tolerant ISO parser supporting 'Z' suffix."""
    if not s:
        raise ValueError("empty")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


# ─────────────────────────────────────────────────────────────────────
# 1. Elite-only fields absent from non-elite payloads
# ─────────────────────────────────────────────────────────────────────
class T01EliteKeysAbsent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = _login()
        cls.prev = _set_plan(ADMIN_EMAIL, "free")

    @classmethod
    def tearDownClass(cls):
        _restore_plan(ADMIN_EMAIL, cls.prev)

    def test_anon_no_elite_keys(self):
        r = _g(f"/api/weather?lat={AUSTIN[0]}&lng={AUSTIN[1]}")
        self.assertEqual(r.status_code, 200, r.text[:200])
        d = r.json()
        self.assertNotIn("alerts", d)
        self.assertNotIn("minute_forecast", d)
        self.assertNotIn("best_times", d)

    def test_free_no_elite_keys(self):
        _set_plan(ADMIN_EMAIL, "free")
        r = _g(f"/api/weather?lat={AUSTIN[0]}&lng={AUSTIN[1]}", headers=_hdr(self.token))
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertNotIn("alerts", d)
        self.assertNotIn("minute_forecast", d)
        self.assertNotIn("best_times", d)
        self.assertEqual(d.get("plan"), "free")

    def test_pro_has_hourly_daily_but_no_elite(self):
        _set_plan(ADMIN_EMAIL, "pro")
        r = _g(f"/api/weather?lat={AUSTIN[0]}&lng={AUSTIN[1]}", headers=_hdr(self.token))
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertIn("hourly", d)
        self.assertIn("daily", d)
        self.assertNotIn("alerts", d)
        self.assertNotIn("minute_forecast", d)
        self.assertNotIn("best_times", d)

    def test_elite_has_golden_blue_and_best_times(self):
        _set_plan(ADMIN_EMAIL, "elite")
        r = _g(f"/api/weather?lat={NYC[0]}&lng={NYC[1]}&country=US",
               headers=_hdr(self.token))
        self.assertEqual(r.status_code, 200, r.text[:200])
        d = r.json()
        self.assertEqual(d.get("plan"), "elite")
        daily = d.get("daily") or []
        self.assertTrue(daily, "daily should be present for elite")
        for entry in daily:
            self.assertIn("golden_hour", entry)
            self.assertIn("blue_hour", entry)
        # best_times exists for elite even if empty list
        self.assertIn("best_times", d)
        self.assertLessEqual(len(d["best_times"]), 3)
        for bt in d["best_times"]:
            self.assertIn("start", bt)
            self.assertIn("end", bt)
            self.assertIn(bt["window_type"], ("golden", "blue"))
            self.assertIn("Hour", bt["label"])
            self.assertIn("hours", bt)
            self.assertIn("avg_cloud_cover_pct", bt)
            self.assertIn("score", bt)


# ─────────────────────────────────────────────────────────────────────
# 2. 10-day cap for Elite vs 7-day for everyone else
# ─────────────────────────────────────────────────────────────────────
class T02DailyCaps(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = _login()
        cls.prev = _set_plan(ADMIN_EMAIL, "free")

    @classmethod
    def tearDownClass(cls):
        _restore_plan(ADMIN_EMAIL, cls.prev)

    def test_pro_capped_at_seven(self):
        _set_plan(ADMIN_EMAIL, "pro")
        r = _g(f"/api/weather?lat={SEATTLE[0]}&lng={SEATTLE[1]}",
               headers=_hdr(self.token))
        self.assertEqual(r.status_code, 200)
        daily = r.json().get("daily") or []
        self.assertGreater(len(daily), 0)
        self.assertLessEqual(len(daily), 7,
                             f"pro daily must be ≤ 7, got {len(daily)}")

    def test_elite_capped_at_ten(self):
        _set_plan(ADMIN_EMAIL, "elite")
        r = _g(f"/api/weather?lat={SEATTLE[0]}&lng={SEATTLE[1]}&country=US",
               headers=_hdr(self.token))
        self.assertEqual(r.status_code, 200)
        daily = r.json().get("daily") or []
        self.assertGreaterEqual(len(daily), 7,
                                f"elite daily must be ≥ 7, got {len(daily)}")
        self.assertLessEqual(len(daily), 10,
                             f"elite daily must be ≤ 10, got {len(daily)}")


# ─────────────────────────────────────────────────────────────────────
# 3. golden_hour / blue_hour math correctness
# ─────────────────────────────────────────────────────────────────────
class T03GoldenBlueMath(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = _login()
        cls.prev = _set_plan(ADMIN_EMAIL, "elite")

    @classmethod
    def tearDownClass(cls):
        _restore_plan(ADMIN_EMAIL, cls.prev)

    def test_golden_blue_windows_match_offsets(self):
        r = _g(f"/api/weather?lat={NYC[0]}&lng={NYC[1]}&country=US",
               headers=_hdr(self.token))
        self.assertEqual(r.status_code, 200)
        daily = r.json().get("daily") or []
        self.assertTrue(daily)
        checked = 0
        for entry in daily:
            sunrise = entry.get("sunrise")
            sunset = entry.get("sunset")
            if not (sunrise and sunset):
                continue
            sr = _parse_iso(sunrise)
            ss = _parse_iso(sunset)
            gh = entry.get("golden_hour") or {}
            bh = entry.get("blue_hour") or {}

            # Golden AM: [sunrise, sunrise+30min]
            gh_am = gh.get("am")
            if gh_am:
                start = _parse_iso(gh_am["start"])
                end = _parse_iso(gh_am["end"])
                self.assertEqual(start, sr, f"golden.am.start should == sunrise; got {start} vs {sr}")
                delta = (end - start).total_seconds()
                self.assertAlmostEqual(delta, 30 * 60, delta=60,
                                       msg=f"golden.am window should be 30min, got {delta}s")

            # Golden PM: [sunset-30min, sunset]
            gh_pm = gh.get("pm")
            if gh_pm:
                start = _parse_iso(gh_pm["start"])
                end = _parse_iso(gh_pm["end"])
                self.assertEqual(end, ss, f"golden.pm.end should == sunset")
                delta = (end - start).total_seconds()
                self.assertAlmostEqual(delta, 30 * 60, delta=60,
                                       msg=f"golden.pm window should be 30min, got {delta}s")

            # Blue AM: [sunrise-20min, sunrise]
            bh_am = bh.get("am")
            if bh_am:
                start = _parse_iso(bh_am["start"])
                end = _parse_iso(bh_am["end"])
                self.assertEqual(end, sr, "blue.am.end should == sunrise")
                delta = (end - start).total_seconds()
                self.assertAlmostEqual(delta, 20 * 60, delta=60,
                                       msg=f"blue.am window should be 20min, got {delta}s")

            # Blue PM: [sunset, sunset+20min]
            bh_pm = bh.get("pm")
            if bh_pm:
                start = _parse_iso(bh_pm["start"])
                end = _parse_iso(bh_pm["end"])
                self.assertEqual(start, ss, "blue.pm.start should == sunset")
                delta = (end - start).total_seconds()
                self.assertAlmostEqual(delta, 20 * 60, delta=60,
                                       msg=f"blue.pm window should be 20min, got {delta}s")

            checked += 1
        self.assertGreater(checked, 0, "no daily entries had both sunrise+sunset to verify")


# ─────────────────────────────────────────────────────────────────────
# 4. POST /api/weather/alerts/subscribe
# ─────────────────────────────────────────────────────────────────────
class T04Subscribe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = _login()
        cls.prev = _set_plan(ADMIN_EMAIL, "elite")
        cls.device_token = "b" * 64

    @classmethod
    def tearDownClass(cls):
        _db.weather_alert_subscriptions.delete_many({})
        _restore_plan(ADMIN_EMAIL, cls.prev)

    def test_401_without_auth(self):
        r = _p("/api/weather/alerts/subscribe", json={
            "device_token": self.device_token,
            "lat": 30, "lng": -97, "preferences": {"severe": True},
        })
        self.assertEqual(r.status_code, 401)

    def test_402_when_free(self):
        _set_plan(ADMIN_EMAIL, "free")
        r = _p("/api/weather/alerts/subscribe", headers=_hdr(self.token), json={
            "device_token": self.device_token,
            "lat": 30, "lng": -97, "preferences": {"severe": True},
        })
        self.assertEqual(r.status_code, 402)
        _set_plan(ADMIN_EMAIL, "elite")

    def test_402_when_pro(self):
        _set_plan(ADMIN_EMAIL, "pro")
        r = _p("/api/weather/alerts/subscribe", headers=_hdr(self.token), json={
            "device_token": self.device_token,
            "lat": 30, "lng": -97, "preferences": {"severe": True},
        })
        self.assertEqual(r.status_code, 402)
        _set_plan(ADMIN_EMAIL, "elite")

    def test_400_short_token(self):
        r = _p("/api/weather/alerts/subscribe", headers=_hdr(self.token), json={
            "device_token": "a" * 31,
            "lat": 30, "lng": -97, "preferences": {"severe": True},
        })
        self.assertEqual(r.status_code, 400)

    def test_400_lat_out_of_range(self):
        r = _p("/api/weather/alerts/subscribe", headers=_hdr(self.token), json={
            "device_token": self.device_token,
            "lat": 99, "lng": -97, "preferences": {"severe": True},
        })
        self.assertEqual(r.status_code, 400)

    def test_400_lng_out_of_range(self):
        r = _p("/api/weather/alerts/subscribe", headers=_hdr(self.token), json={
            "device_token": self.device_token,
            "lat": 30, "lng": 200, "preferences": {"severe": True},
        })
        self.assertEqual(r.status_code, 400)

    def test_400_empty_prefs(self):
        r = _p("/api/weather/alerts/subscribe", headers=_hdr(self.token), json={
            "device_token": self.device_token,
            "lat": 30, "lng": -97, "preferences": {},
        })
        self.assertEqual(r.status_code, 400)

    def test_400_all_false_prefs(self):
        r = _p("/api/weather/alerts/subscribe", headers=_hdr(self.token), json={
            "device_token": self.device_token,
            "lat": 30, "lng": -97,
            "preferences": {"severe": False, "clear_sky": False, "golden_hour": False},
        })
        self.assertEqual(r.status_code, 400)

    def test_201_happy_path_and_upsert(self):
        # First sub
        r = _p("/api/weather/alerts/subscribe", headers=_hdr(self.token), json={
            "device_token": self.device_token,
            "lat": 30.27, "lng": -97.74, "spot_id": "spot_v2_test",
            "preferences": {"severe": True, "clear_sky": True, "golden_hour": False},
        })
        self.assertEqual(r.status_code, 201, r.text[:300])
        d = r.json()
        self.assertTrue(d["ok"])
        self.assertIn("subscription_id", d)
        self.assertEqual(d["preferences"]["severe"], True)
        self.assertEqual(d["preferences"]["clear_sky"], True)
        self.assertEqual(d["preferences"]["golden_hour"], False)
        self.assertAlmostEqual(d["lat"], 30.27, places=2)
        self.assertAlmostEqual(d["lng"], -97.74, places=2)
        self.assertEqual(d.get("spot_id"), "spot_v2_test")
        self.assertEqual(d.get("next_check_within_minutes"), 15)
        first_id = d["subscription_id"]

        # Re-subscribe at same coords with different prefs → upsert
        r2 = _p("/api/weather/alerts/subscribe", headers=_hdr(self.token), json={
            "device_token": self.device_token,
            "lat": 30.27, "lng": -97.74,
            "preferences": {"severe": False, "clear_sky": True, "golden_hour": True},
        })
        self.assertEqual(r2.status_code, 201)

        # List → exactly 1 record for that coord with LATEST prefs
        rl = _g("/api/weather/alerts/subscriptions", headers=_hdr(self.token))
        self.assertEqual(rl.status_code, 200)
        body = rl.json()
        matches = [s for s in body["subscriptions"]
                   if round(s["lat"], 2) == 30.27 and round(s["lng"], 2) == -97.74]
        self.assertEqual(len(matches), 1, f"upsert expected 1 doc, got {len(matches)}")
        self.assertEqual(matches[0]["preferences"]["severe"], False)
        self.assertEqual(matches[0]["preferences"]["golden_hour"], True)


# ─────────────────────────────────────────────────────────────────────
# 5. GET /api/weather/alerts/subscriptions
# ─────────────────────────────────────────────────────────────────────
class T05ListSubscriptions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = _login()
        cls.prev = _set_plan(ADMIN_EMAIL, "elite")
        # Ensure at least one sub exists
        _p("/api/weather/alerts/subscribe", headers=_hdr(cls.token), json={
            "device_token": "c" * 64,
            "lat": 25.0, "lng": -80.0,
            "preferences": {"severe": True},
        })

    @classmethod
    def tearDownClass(cls):
        _db.weather_alert_subscriptions.delete_many({})
        _restore_plan(ADMIN_EMAIL, cls.prev)

    def test_401_without_auth(self):
        r = _g("/api/weather/alerts/subscriptions")
        self.assertEqual(r.status_code, 401)

    def test_200_with_auth_no_device_token(self):
        r = _g("/api/weather/alerts/subscriptions", headers=_hdr(self.token))
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("subscriptions", body)
        for s in body["subscriptions"]:
            self.assertNotIn("device_token", s,
                             "device_token must NEVER appear in listing")


# ─────────────────────────────────────────────────────────────────────
# 6. DELETE /api/weather/alerts/subscribe
# ─────────────────────────────────────────────────────────────────────
class T06Unsubscribe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = _login()
        cls.prev = _set_plan(ADMIN_EMAIL, "elite")
        # Subscribe so we can delete
        _p("/api/weather/alerts/subscribe", headers=_hdr(cls.token), json={
            "device_token": "d" * 64,
            "lat": 45.5, "lng": -122.6,
            "preferences": {"severe": True},
        })

    @classmethod
    def tearDownClass(cls):
        _db.weather_alert_subscriptions.delete_many({})
        _restore_plan(ADMIN_EMAIL, cls.prev)

    def test_401_without_auth(self):
        r = _d("/api/weather/alerts/subscribe?lat=45.5&lng=-122.6")
        self.assertEqual(r.status_code, 401)

    def test_idempotent_delete(self):
        r1 = _d("/api/weather/alerts/subscribe?lat=45.5&lng=-122.6",
                headers=_hdr(self.token))
        self.assertEqual(r1.status_code, 200)
        d1 = r1.json()
        self.assertTrue(d1["ok"])
        self.assertEqual(d1.get("removed"), 1)

        r2 = _d("/api/weather/alerts/subscribe?lat=45.5&lng=-122.6",
                headers=_hdr(self.token))
        self.assertEqual(r2.status_code, 200)
        d2 = r2.json()
        self.assertTrue(d2["ok"])
        self.assertEqual(d2.get("removed"), 0)


# ─────────────────────────────────────────────────────────────────────
# 7. /api/weather/config Elite extensions
# ─────────────────────────────────────────────────────────────────────
class T07Config(unittest.TestCase):
    def test_elite_features_block(self):
        r = _g("/api/weather/config")
        self.assertEqual(r.status_code, 200)
        cfg = r.json()
        self.assertIn("elite_features", cfg)
        ef = cfg["elite_features"]
        for k in ("alerts", "minute_forecast", "moon_data",
                  "golden_blue_hour", "best_times", "ten_day_forecast",
                  "push_alerts"):
            self.assertIn(k, ef)
            self.assertIsInstance(ef[k], bool, f"elite_features.{k} must be bool, got {type(ef[k])}")

    def test_push_apns_configured_bool(self):
        cfg = _g("/api/weather/config").json()
        self.assertIn("push_apns_configured", cfg)
        self.assertIsInstance(cfg["push_apns_configured"], bool)

    def test_cache_ttl_block(self):
        cfg = _g("/api/weather/config").json()
        self.assertIn("cache_ttl_minutes", cfg)
        ttl = cfg["cache_ttl_minutes"]
        self.assertEqual(ttl.get("current"), 15)
        self.assertEqual(ttl.get("hourly"), 15)
        self.assertEqual(ttl.get("daily"), 60)
        self.assertEqual(ttl.get("alerts"), 5)
        self.assertEqual(ttl.get("minute"), 5)

    def test_no_secrets_leaked(self):
        raw = _g("/api/weather/config").text
        for bad in (".p8", "BEGIN PRIVATE KEY", "BSCF87SBA8", "73A3K9Z48T",
                    "23H3KJ9VVC", "c0ede999"):
            self.assertNotIn(bad, raw, f"config leaks: {bad}")


# ─────────────────────────────────────────────────────────────────────
# 8. Cache TTL routing
# ─────────────────────────────────────────────────────────────────────
class T08CacheRouting(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = _login()
        cls.prev = _set_plan(ADMIN_EMAIL, "elite")

    @classmethod
    def tearDownClass(cls):
        _restore_plan(ADMIN_EMAIL, cls.prev)

    def test_minute_dataset_cached_within_5min(self):
        path = (f"/api/weather?lat={LA_OCEAN[0]}&lng={LA_OCEAN[1]}"
                "&include=current,minute&country=US")
        r1 = _g(path, headers=_hdr(self.token))
        self.assertEqual(r1.status_code, 200)
        # 1st call may or may not be cached depending on prior runs
        r2 = _g(path, headers=_hdr(self.token))
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json().get("cached"),
                        "2nd minute-include request should be cached")

    def test_daily_dataset_cached_within_60min(self):
        # Use a fresh coord to avoid cross-contamination with other tests
        path = (f"/api/weather?lat=33.05&lng=-118.05"
                "&include=daily&country=US")
        r1 = _g(path, headers=_hdr(self.token))
        self.assertEqual(r1.status_code, 200)
        r2 = _g(path, headers=_hdr(self.token))
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json().get("cached"),
                        "2nd daily-only request should be cached")


# ─────────────────────────────────────────────────────────────────────
# 9. Background worker is alive
# ─────────────────────────────────────────────────────────────────────
class T09WorkerAlive(unittest.TestCase):
    def test_worker_logs_present(self):
        # The worker logs go to backend.err.log; check both .err and .out
        paths = [
            "/var/log/supervisor/backend.err.log",
            "/var/log/supervisor/backend.out.log",
        ]
        seen_started = False
        seen_tick = False
        for p in paths:
            if not os.path.exists(p):
                continue
            try:
                with open(p, "r", errors="replace") as f:
                    txt = f.read()
            except Exception:
                continue
            if "weather_alerts_worker started" in txt:
                seen_started = True
            if "weather_alerts tick run=" in txt:
                seen_tick = True
        self.assertTrue(seen_started, "expected 'weather_alerts_worker started' in logs")
        self.assertTrue(seen_tick, "expected at least one 'weather_alerts tick run=' line")


# ─────────────────────────────────────────────────────────────────────
# 10. Regression — base endpoints still 200
# ─────────────────────────────────────────────────────────────────────
class T10Regression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = _login()

    def test_health(self):
        r = _g("/api/health")
        self.assertEqual(r.status_code, 200)

    def test_feed_home(self):
        r = _g("/api/feed/home", headers=_hdr(self.token))
        self.assertEqual(r.status_code, 200)

    def test_auth_me(self):
        r = _g("/api/auth/me", headers=_hdr(self.token))
        self.assertEqual(r.status_code, 200)

    def test_weather_base(self):
        r = _g(f"/api/weather?lat={AUSTIN[0]}&lng={AUSTIN[1]}")
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for cls in (T01EliteKeysAbsent, T02DailyCaps, T03GoldenBlueMath,
                T04Subscribe, T05ListSubscriptions, T06Unsubscribe,
                T07Config, T08CacheRouting, T09WorkerAlive, T10Regression):
        suite.addTests(loader.loadTestsFromTestCase(cls))
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
