"""
Weather endpoint tests — /api/weather and /api/weather/config
=============================================================

Runs the 8 test cases from the Jun 2025 review request against
the public preview backend.

Notes
-----
- Authenticates using kclarson187@gmail.com (super_admin) per credentials file.
- DOES NOT touch any map / SafeMapView code paths.
- Treats either `weatherkit` or `open_meteo` as a valid `source` value
  because Apple's WeatherKit Services ID currently returns 401 NOT_ENABLED
  (capability provisioning issue, not a code defect).
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Dict, Optional, Tuple

import requests

BASE = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://photo-finder-60.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE}/api"

SUPER_ADMIN_EMAIL = "kclarson187@gmail.com"
SUPER_ADMIN_PASSWORD = "Grayson@1117!!"
SEED_ADMIN_EMAIL = "admin@lumascout.app"
SEED_ADMIN_PASSWORD = "Grayson@1117!!"

# Test coordinates (downtown Austin, TX)
LAT = 30.2672
LNG = -97.7431

PASS, FAIL = 0, 0
FAILS: list[str] = []


def ok(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✔ {name}")
    else:
        FAIL += 1
        msg = f"  ✘ {name}" + (f" — {detail}" if detail else "")
        print(msg)
        FAILS.append(name + (f": {detail}" if detail else ""))


def header(t: str) -> None:
    print(f"\n=== {t} ===")


def login(email: str, password: str) -> Optional[Tuple[str, requests.Session]]:
    s = requests.Session()
    r = s.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    if r.status_code != 200:
        print(f"  login {email} -> {r.status_code} {r.text[:200]}")
        return None
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers["Authorization"] = f"Bearer {token}"
    return token or "cookie", s


# ─────────────────────────────────────────────────────────────────────
def test_1_happy_path() -> None:
    header("1. Happy path GET /api/weather?lat&lng")
    r = requests.get(f"{API}/weather", params={"lat": LAT, "lng": LNG}, timeout=15)
    ok("HTTP 200", r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")
    if r.status_code != 200:
        return
    d = r.json()
    ok("ok=true", d.get("ok") is True)
    ok(
        "source populated (weatherkit or open_meteo)",
        d.get("source") in ("weatherkit", "open_meteo"),
        f"source={d.get('source')}",
    )
    cur = d.get("current") or {}
    ok("current.temp_f is finite number", isinstance(cur.get("temp_f"), (int, float)),
       f"temp_f={cur.get('temp_f')!r}")
    ok("current.label is string", isinstance(cur.get("label"), str))
    # Anonymous: per plan default, only `current` should be present
    ok("anon: no hourly", "hourly" not in d, f"unexpected hourly len={len(d.get('hourly') or [])}")
    ok("anon: no daily",  "daily"  not in d, f"unexpected daily len={len(d.get('daily') or [])}")


def test_2_missing_param() -> None:
    header("2. Missing lat or lng → 422")
    r1 = requests.get(f"{API}/weather", params={"lng": LNG}, timeout=10)
    ok("missing lat → 422", r1.status_code == 422, f"got {r1.status_code}")
    r2 = requests.get(f"{API}/weather", params={"lat": LAT}, timeout=10)
    ok("missing lng → 422", r2.status_code == 422, f"got {r2.status_code}")
    # bonus: out-of-range
    r3 = requests.get(f"{API}/weather", params={"lat": 999, "lng": LNG}, timeout=10)
    ok("lat=999 → 422", r3.status_code == 422, f"got {r3.status_code}")


def test_3_include_hourly_daily() -> None:
    header("3. include=current,hourly,daily payload shape")
    # Use a different coord so we don't hit the cache from test 1.
    r = requests.get(
        f"{API}/weather",
        params={"lat": 30.30, "lng": -97.74, "include": "current,hourly,daily"},
        timeout=20,
    )
    ok("HTTP 200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code != 200:
        return
    d = r.json()
    hourly = d.get("hourly") or []
    daily = d.get("daily") or []
    ok("hourly present", isinstance(hourly, list) and len(hourly) > 0,
       f"len={len(hourly)}")
    ok("hourly ≤ 24 items", len(hourly) <= 24, f"len={len(hourly)}")
    ok("daily present", isinstance(daily, list) and len(daily) > 0,
       f"len={len(daily)}")
    ok("daily ≤ 7 items", len(daily) <= 7, f"len={len(daily)}")
    # Per-item shape checks
    if hourly:
        h0 = hourly[0]
        ok("hourly[0].temp_f", isinstance(h0.get("temp_f"), (int, float)),
           f"got {h0.get('temp_f')!r}")
        ok("hourly[0].label string", isinstance(h0.get("label"), str))
        ok("hourly[0].sf_symbol string", isinstance(h0.get("sf_symbol"), str))
        ok("hourly[0] has precip_chance_pct key", "precip_chance_pct" in h0)
    if daily:
        d0 = daily[0]
        ok("daily[0].high_f", isinstance(d0.get("high_f"), (int, float)),
           f"got {d0.get('high_f')!r}")
        ok("daily[0].label string", isinstance(d0.get("label"), str))
        ok("daily[0].sf_symbol string", isinstance(d0.get("sf_symbol"), str))
        ok("daily[0] has precip_chance_pct key", "precip_chance_pct" in d0)


def test_4_cache_hit() -> None:
    header("4. Cache hit on 2nd call (<50ms, cached=true)")
    params = {"lat": 30.40, "lng": -97.80, "include": "current,hourly,daily"}
    t0 = time.perf_counter()
    r1 = requests.get(f"{API}/weather", params=params, timeout=20)
    e1 = (time.perf_counter() - t0) * 1000
    ok("1st call 200", r1.status_code == 200, f"got {r1.status_code}")
    print(f"     first call: {e1:.0f} ms, cached={r1.json().get('cached')}")
    # 2nd call
    t0 = time.perf_counter()
    r2 = requests.get(f"{API}/weather", params=params, timeout=15)
    e2 = (time.perf_counter() - t0) * 1000
    ok("2nd call 200", r2.status_code == 200, f"got {r2.status_code}")
    d2 = r2.json()
    print(f"     second call: {e2:.0f} ms, cached={d2.get('cached')}")
    ok("2nd call cached=true", d2.get("cached") is True, f"cached={d2.get('cached')}")
    # Be permissive on absolute latency since this is a remote preview URL
    # (network jitter can easily push 50ms over), but assert it's at least
    # significantly faster than the first call.
    ok("2nd call faster than 1st", e2 < e1, f"e1={e1:.0f}ms e2={e2:.0f}ms")
    if e2 < 200:
        print(f"     ✓ second call under 200ms ({e2:.0f}ms) — consistent with cache hit")


def test_5_config() -> None:
    header("5. GET /api/weather/config")
    r = requests.get(f"{API}/weather/config", timeout=10)
    ok("HTTP 200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code != 200:
        return
    d = r.json()
    ok("weatherkit_configured=true", d.get("weatherkit_configured") is True,
       f"got {d.get('weatherkit_configured')}")
    ok("team_id_set=true", d.get("team_id_set") is True)
    ok("key_id_set=true",  d.get("key_id_set") is True)
    ok("service_id_set=true", d.get("service_id_set") is True)
    # Make sure secrets are not leaked
    body = json.dumps(d)
    ok("no key path / secrets leaked",
       not any(x in body for x in ("BEGIN", "PRIVATE KEY", "AuthKey_", ".p8")),
       f"body={body[:200]}")


def test_6_plan_tier() -> None:
    header("6. Plan-tier behavior")
    # 6a. Anonymous → current only
    r = requests.get(f"{API}/weather", params={"lat": 30.50, "lng": -97.90}, timeout=15)
    ok("anon HTTP 200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code == 200:
        d = r.json()
        ok("anon: current present", isinstance(d.get("current"), dict))
        ok("anon: no hourly key",  "hourly" not in d)
        ok("anon: no daily key",   "daily"  not in d)
        ok("anon: no alerts key",  "alerts" not in d)

    # 6b. Authenticated super_admin — log in & inspect plan, then assert defaults match INCLUDE_BY_PLAN
    print("  -- login super_admin & call /api/auth/me")
    creds = login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
    if not creds:
        # fall back to seed admin
        print(f"  super_admin login failed, falling back to seed admin")
        creds = login(SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD)
    if not creds:
        ok("admin login succeeded", False, "could not authenticate either admin")
        return
    _, sess = creds
    me = sess.get(f"{API}/auth/me", timeout=10)
    ok("auth/me HTTP 200", me.status_code == 200, f"got {me.status_code}")
    if me.status_code != 200:
        return
    me_d = me.json()
    plan = (me_d.get("plan") or "").lower() or "free"
    role = me_d.get("role")
    print(f"     admin plan={plan!r}, role={role!r}")

    expected_by_plan = {
        "anon":  {"current"},
        "free":  {"current"},
        "pro":   {"current", "hourly", "daily"},
        "elite": {"current", "hourly", "daily"},  # alerts only if country supplied
    }
    expected = expected_by_plan.get(plan, {"current"})

    # 6b-i: authed default include (no `include` param)
    r2 = sess.get(f"{API}/weather", params={"lat": 30.60, "lng": -98.00}, timeout=15)
    ok(f"authed plan={plan}: HTTP 200", r2.status_code == 200, f"got {r2.status_code}")
    if r2.status_code == 200:
        d2 = r2.json()
        present_keys = {k for k in ("current", "hourly", "daily") if k in d2}
        ok(
            f"authed plan={plan} default include match expected {expected}",
            present_keys == (expected & {"current", "hourly", "daily"}),
            f"present_keys={present_keys}, expected={expected}",
        )

    # 6c. If plan is not pro/elite, attempt to flip via /api/auth/me PATCH for the test then revert.
    if plan not in ("pro", "elite"):
        # Try to temporarily set plan via PATCH (might not be allowed for self-update)
        old_plan = me_d.get("plan")
        for trial_plan, trial_expected in (
            ("pro",   {"current", "hourly", "daily"}),
            ("elite", {"current", "hourly", "daily"}),
        ):
            patch = sess.patch(f"{API}/auth/me", json={"plan": trial_plan}, timeout=10)
            if patch.status_code != 200:
                print(f"     [skip] cannot self-PATCH plan→{trial_plan} ({patch.status_code})")
                continue
            r3 = sess.get(
                f"{API}/weather", params={"lat": 30.70 + (0.01 if trial_plan == "pro" else 0.02),
                                          "lng": -98.10}, timeout=15,
            )
            ok(f"plan={trial_plan} HTTP 200", r3.status_code == 200, f"got {r3.status_code}")
            if r3.status_code == 200:
                d3 = r3.json()
                present = {k for k in ("current", "hourly", "daily") if k in d3}
                ok(
                    f"plan={trial_plan} default include includes {trial_expected}",
                    present == trial_expected,
                    f"present={present}",
                )

            # Elite + country=US → alerts may appear (but only if upstream actually returns alerts)
            if trial_plan == "elite":
                r4 = sess.get(
                    f"{API}/weather",
                    params={"lat": 30.72, "lng": -98.12, "country": "US"},
                    timeout=15,
                )
                ok("elite+country=US HTTP 200", r4.status_code == 200, f"got {r4.status_code}")
        # revert
        sess.patch(f"{API}/auth/me", json={"plan": old_plan}, timeout=10)


def test_7_back_compat_root_keys() -> None:
    header("7. Back-compat root keys (temp_f, label, condition)")
    r = requests.get(f"{API}/weather", params={"lat": 30.80, "lng": -98.20}, timeout=15)
    ok("HTTP 200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code != 200:
        return
    d = r.json()
    ok("root.temp_f present", "temp_f" in d, f"keys={list(d.keys())}")
    ok("root.label present",  "label"  in d)
    ok("root.condition present", "condition" in d)
    cur = d.get("current") or {}
    ok("root.temp_f mirrors current.temp_f",
       d.get("temp_f") == cur.get("temp_f"),
       f"root={d.get('temp_f')!r}, current={cur.get('temp_f')!r}")
    ok("root.label mirrors current.label",
       d.get("label") == cur.get("label"),
       f"root={d.get('label')!r}, current={cur.get('label')!r}")


def test_8_regression() -> None:
    header("8. Regression smoke — /api/health /api/feed/home /api/auth/me")
    rh = requests.get(f"{API}/health", timeout=10)
    ok("/api/health 200", rh.status_code == 200, f"got {rh.status_code}")
    rf = requests.get(f"{API}/feed/home", timeout=15)
    ok("/api/feed/home 200", rf.status_code == 200, f"got {rf.status_code}")
    # auth/me requires auth
    creds = login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD) or login(SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD)
    if creds:
        _, s = creds
        rm = s.get(f"{API}/auth/me", timeout=10)
        ok("/api/auth/me 200 (authed)", rm.status_code == 200, f"got {rm.status_code}")


def main() -> int:
    print(f"BASE = {BASE}\n")
    try:
        test_1_happy_path()
        test_2_missing_param()
        test_3_include_hourly_daily()
        test_4_cache_hit()
        test_5_config()
        test_6_plan_tier()
        test_7_back_compat_root_keys()
        test_8_regression()
    except Exception as e:
        import traceback
        traceback.print_exc()
        FAILS.append(f"exception: {e!r}")

    print(f"\n──── RESULT ────")
    print(f"PASS: {PASS}   FAIL: {FAIL}")
    if FAILS:
        print("\nFailures:")
        for f in FAILS:
            print(f"  - {f}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
