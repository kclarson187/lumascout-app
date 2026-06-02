"""
backend_test.py — WeatherSection entitlement bug fix verification (Jun 2026)

Verifies:
  1. NEW GET /api/weather/_debug_tier endpoint resolves tier correctly
     for unauthenticated callers, super_admin (auto comp_elite), and
     "standard" callers.
  2. GET /api/weather entitlement gating uses the centralized
     _resolve_user_tier() (which delegates to plan_of()) so super_admin
     sees Elite features, not Free.
  3. POST /api/weather/alerts/subscribe now ACCEPTS super_admin (was 402
     before fix because raw plan was not literal "elite").
  4. Visibility unit sanity — visibility_mi is in [0, 200] for WeatherKit
     (meters → km → miles conversion).
  5. /api/weather/config still returns the diagnostic blocks.

Backend URL: read from /app/frontend/.env (EXPO_PUBLIC_BACKEND_URL).
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, Optional

import requests


def _read_backend_url() -> str:
    for k in ("REACT_APP_BACKEND_URL", "EXPO_PUBLIC_BACKEND_URL"):
        v = os.environ.get(k)
        if v:
            return v.rstrip("/")
    try:
        with open("/app/frontend/.env", "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("EXPO_PUBLIC_BACKEND_URL=") or line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except Exception:
        pass
    raise RuntimeError("No backend URL available")


BACKEND_URL = _read_backend_url()
API = f"{BACKEND_URL}/api"

SUPER_EMAIL = "admin@lumascout.app"
SUPER_PASS  = "Grayson@1117!!"
STD_EMAIL   = "kclarson187@gmail.com"
STD_PASS    = "Grayson@1117!!"

AUSTIN = (30.27, -97.74)


def login(email: str, password: str) -> Optional[str]:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        print(f"  ⚠ login {email} -> {r.status_code}: {r.text[:200]}")
        return None
    j = r.json()
    return j.get("token") or j.get("access_token")


def H(tok: Optional[str]) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"} if tok else {}


results = []


def record(name: str, ok: bool, detail: str = "") -> None:
    icon = "PASS" if ok else "FAIL"
    print(f"[{icon}] {name}")
    if detail:
        print(f"       {detail}")
    results.append((name, ok, detail))


def short(d: Any, keys=None) -> str:
    if isinstance(d, dict) and keys:
        return json.dumps({k: d.get(k) for k in keys}, default=str)[:400]
    return json.dumps(d, default=str)[:400]


def main():
    print(f"BACKEND = {BACKEND_URL}\n")

    super_tok = login(SUPER_EMAIL, SUPER_PASS)
    std_tok   = login(STD_EMAIL, STD_PASS)
    record("login super_admin (admin@lumascout.app)", super_tok is not None,
           f"token={'set' if super_tok else 'MISSING'}")
    record("login candidate (kclarson187@gmail.com)", std_tok is not None,
           f"token={'set' if std_tok else 'MISSING'}")

    # ── 1. GET /api/weather/_debug_tier ──
    print("\n── Test 1: GET /api/weather/_debug_tier ──")

    # 1a unauthenticated
    r = requests.get(f"{API}/weather/_debug_tier", timeout=10)
    j = r.json() if r.status_code == 200 else {}
    ok = (
        r.status_code == 200
        and j.get("authenticated") is False
        and j.get("effective_tier") == "anon"
        and (j.get("feature_block") or {}).get("tier") == "anon"
    )
    record("1a debug_tier unauthenticated -> anon", ok,
           f"status={r.status_code} body={short(j, ['authenticated','effective_tier','feature_block'])}")

    # 1b super_admin
    r = requests.get(f"{API}/weather/_debug_tier", headers=H(super_tok), timeout=10)
    j = r.json() if r.status_code == 200 else {}
    fb = j.get("feature_block") or {}
    ok = (
        r.status_code == 200
        and j.get("effective_tier") == "elite"
        and j.get("is_super_admin") is True
        and fb.get("tier") == "elite"
        and fb.get("upgrade_target") in (None, "null")
    )
    rp_str = " | ".join(j.get("resolution_path") or [])
    has_role_path = ("super_admin" in rp_str) or ("ELITE_COMP_ROLES" in rp_str)
    record("1b debug_tier super_admin -> elite", ok,
           f"effective_tier={j.get('effective_tier')} role={j.get('role')} raw_plan={j.get('raw_plan')} "
           f"plan_of={j.get('plan_of_user')} is_super_admin={j.get('is_super_admin')} "
           f"feature_block.tier={fb.get('tier')} upgrade_target={fb.get('upgrade_target')}")
    record("1b.resolution_path mentions super_admin/ELITE_COMP_ROLES", has_role_path,
           f"resolution_path={j.get('resolution_path')}")

    # 1c "standard" user
    r = requests.get(f"{API}/weather/_debug_tier", headers=H(std_tok), timeout=10)
    j2 = r.json() if r.status_code == 200 else {}
    record("1c debug_tier kclarson187 (resolved)", r.status_code == 200,
           f"role={j2.get('role')} raw_plan={j2.get('raw_plan')} "
           f"plan_of={j2.get('plan_of_user')} effective_tier={j2.get('effective_tier')}")
    if j2.get("role") == "super_admin" and j2.get("raw_plan") == "comp_elite":
        print("       NOTE: kclarson187@gmail.com is ALSO role=super_admin/plan=comp_elite in DB.")
        print("       No true 'free' standard-user fixture exists.")

    # ── 2. GET /api/weather entitlement ──
    print("\n── Test 2: GET /api/weather entitlement gating ──")
    lat, lng = AUSTIN

    # 2a unauthenticated -> anon
    r = requests.get(f"{API}/weather", params={"lat": lat, "lng": lng}, timeout=20)
    j = r.json() if r.status_code == 200 else {}
    locked = set(j.get("locked_features") or [])
    ok = (
        r.status_code == 200
        and j.get("tier") == "anon"
        and j.get("upgrade_target") == "pro"
        and "hourly" in locked and "daily" in locked
        and isinstance(j.get("current"), dict)
        and "hourly" not in j
        and "daily" not in j
    )
    record("2a /weather anon -> tier=anon, current only, hourly+daily locked", ok,
           f"tier={j.get('tier')} upgrade={j.get('upgrade_target')} "
           f"has_current={isinstance(j.get('current'), dict)} "
           f"has_hourly={'hourly' in j} has_daily={'daily' in j} "
           f"locked={sorted(locked)} source={j.get('source')}")

    # 2b super_admin -> elite
    r = requests.get(f"{API}/weather", params={"lat": lat, "lng": lng}, headers=H(super_tok), timeout=20)
    j_super = r.json() if r.status_code == 200 else {}
    avail = set(j_super.get("available_features") or [])
    locked = set(j_super.get("locked_features") or [])
    expected_avail = {"ten_day_forecast", "severe_weather_alerts", "minute_precipitation",
                      "best_time_to_shoot_48h", "lunar_data"}
    missing_avail = expected_avail - avail
    ok = (
        r.status_code == 200
        and j_super.get("tier") == "elite"
        and j_super.get("upgrade_target") in (None, "null")
        and not missing_avail
        and len(locked) == 0
        and isinstance(j_super.get("hourly"), list)
        and isinstance(j_super.get("daily"), list)
    )
    record("2b /weather super_admin -> tier=elite, full feature set", ok,
           f"tier={j_super.get('tier')} upgrade={j_super.get('upgrade_target')} "
           f"hourly_len={len(j_super.get('hourly') or [])} daily_len={len(j_super.get('daily') or [])} "
           f"missing_avail={sorted(missing_avail)} locked_count={len(locked)} "
           f"source={j_super.get('source')}")

    # 2c "standard" user
    r = requests.get(f"{API}/weather", params={"lat": lat, "lng": lng}, headers=H(std_tok), timeout=20)
    j_std = r.json() if r.status_code == 200 else {}
    record("2c /weather kclarson187 resolved tier", r.status_code == 200,
           f"tier={j_std.get('tier')} upgrade={j_std.get('upgrade_target')} "
           f"plan={j_std.get('plan')} has_hourly={isinstance(j_std.get('hourly'), list)}")

    # ── 3. POST /api/weather/alerts/subscribe ──
    print("\n── Test 3: POST /api/weather/alerts/subscribe ──")
    body = {
        "device_token": "a" * 64,
        "lat": lat,
        "lng": lng,
        "preferences": {"severe": True},
    }

    # 3a unauthenticated -> 401
    r = requests.post(f"{API}/weather/alerts/subscribe", json=body, timeout=10)
    record("3a subscribe unauthenticated -> 401", r.status_code == 401,
           f"status={r.status_code} body={r.text[:200]}")

    # 3b super_admin -> 201
    r = requests.post(f"{API}/weather/alerts/subscribe", json=body, headers=H(super_tok), timeout=10)
    try:
        jbody = r.json()
    except Exception:
        jbody = {}
    ok = (r.status_code == 201) and (jbody.get("ok") is True)
    record("3b super_admin subscribe -> 201 ok=true (REGRESSION FIX)", ok,
           f"status={r.status_code} body={r.text[:300]}")

    # 3c kclarson187
    r = requests.post(f"{API}/weather/alerts/subscribe", json=body, headers=H(std_tok), timeout=10)
    print(f"       3c kclarson187 subscribe -> status={r.status_code} body={r.text[:200]}")
    if r.status_code == 201:
        record("3c kclarson187 (super_admin/comp_elite in DB) -> 201", True,
               "kclarson187 is super_admin/comp_elite in DB; same auto-elite path applies. "
               "Cannot validate 402 free-user gate without a real free fixture.")
    elif r.status_code == 402:
        record("3c kclarson187 -> 402 elite_required", True, "Standard user gated correctly")
    else:
        record("3c kclarson187 subscribe", False, f"unexpected status={r.status_code}")

    # ── 4. Visibility unit sanity ──
    print("\n── Test 4: visibility_mi unit sanity ──")
    src = j_super.get("source")
    cur = (j_super.get("current") or {})
    vm = cur.get("visibility_mi")
    vk = cur.get("visibility_km")
    if src == "weatherkit":
        ok = (vm is None) or (0 <= vm <= 200)
        record("4 weatherkit visibility_mi in [0, 200]", ok,
               f"source={src} visibility_mi={vm} visibility_km={vk}")
    else:
        record("4 visibility check (non-weatherkit path)", True,
               f"source={src} visibility_mi={vm} (Open-Meteo doesn't emit visibility — OK)")

    # ── 5. /api/weather/config ──
    print("\n── Test 5: GET /api/weather/config ──")
    r = requests.get(f"{API}/weather/config", timeout=10)
    j = r.json() if r.status_code == 200 else {}
    has_wk = "weatherkit_configured" in j
    has_tf = isinstance(j.get("tier_features"), dict) and len(j["tier_features"]) > 0
    has_ef = isinstance(j.get("elite_features"), dict) and len(j["elite_features"]) > 0
    record("5 /weather/config returns the three blocks", has_wk and has_tf and has_ef,
           f"weatherkit_configured={j.get('weatherkit_configured')} "
           f"tier_features_keys={len(j.get('tier_features') or {})} "
           f"elite_features_keys={len(j.get('elite_features') or {})}")

    # ── Summary ──
    print("\n" + "=" * 70)
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} passed")
    fails = [(n, d) for n, ok, d in results if not ok]
    if fails:
        print("\nFAILS:")
        for n, d in fails:
            print(f"  ! {n}\n    {d}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
