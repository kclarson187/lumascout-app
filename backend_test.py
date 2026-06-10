"""
backend_test.py — Membership Tier System Regression (Jun 2026)
==============================================================
Verifies the updated Free/Pro/Elite tier specification:

  1. GET /api/plans — feature lists, taglines, popular flag
  2. GET /api/weather — daily forecast tier caps for anon / free / pro / elite
  3. GET /api/weather/_debug_tier — super_admin resolves to elite
  4. No-regression on adjacent endpoints (iap-config, revenuecat webhook,
     account/delete, spots/{id} owner placeholder)
  5. Plan normalization audit across plan/role combinations via
     /api/weather/_debug_tier
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import string
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests


# ─── Config ──────────────────────────────────────────────────────────
def _resolve_backend_url() -> str:
    env_path = Path("/app/frontend/.env")
    for line in env_path.read_text().splitlines():
        if "=" not in line or line.strip().startswith("#"):
            continue
        k, _, v = line.partition("=")
        v = v.strip().strip('"')
        if k.strip() in ("EXPO_PUBLIC_BACKEND_URL", "REACT_APP_BACKEND_URL"):
            return v
    raise RuntimeError("Could not resolve backend URL")


def _mongo_url_and_db() -> Tuple[str, str]:
    env_path = Path("/app/backend/.env")
    url = "mongodb://localhost:27017"
    name = "test_database"
    for line in env_path.read_text().splitlines():
        if line.startswith("MONGO_URL="):
            url = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("DB_NAME="):
            name = line.split("=", 1)[1].strip().strip('"')
    return url, name


BASE = _resolve_backend_url().rstrip("/")
API = f"{BASE}/api"
MONGO_URL, DB_NAME = _mongo_url_and_db()
LAT, LNG = 30.27, -97.74

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"


# ─── Reporting ───────────────────────────────────────────────────────
RESULTS: List[Tuple[str, str, str]] = []


def record(tid: str, status: str, msg: str) -> None:
    print(f"[{status:4}] {tid}: {msg}", flush=True)
    RESULTS.append((tid, status, msg))


def summarize() -> int:
    print("\n" + "=" * 72)
    n_pass = sum(1 for _, s, _ in RESULTS if s == "PASS")
    n_fail = sum(1 for _, s, _ in RESULTS if s == "FAIL")
    n_info = sum(1 for _, s, _ in RESULTS if s == "INFO")
    print(f"PASS={n_pass}  FAIL={n_fail}  INFO={n_info}")
    print("=" * 72)
    if n_fail:
        print("FAILURES:")
        for tid, s, m in RESULTS:
            if s == "FAIL":
                print(f"  - {tid}: {m}")
    return 1 if n_fail else 0


# ─── Helpers ─────────────────────────────────────────────────────────
def rand_suffix(n: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def register_user(email_prefix: str = "tier_test") -> Tuple[str, str, str]:
    """Returns (email, password, jwt). Raises on failure."""
    email = f"{email_prefix}_{rand_suffix()}@lumascout-qa.com"
    pw = "TestPass123!"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": pw, "name": f"Tier Test {rand_suffix(4)}"},
        timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"register failed {r.status_code}: {r.text[:200]}")
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if not token:
        raise RuntimeError(f"register returned no token: {data}")
    return email, pw, token


def login(email: str, password: str) -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"login failed {r.status_code}: {r.text[:200]}")
    data = r.json()
    return data.get("access_token") or data.get("token")


def auth_h(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def get_me_uid(token: str) -> str:
    r = requests.get(f"{API}/auth/me", headers=auth_h(token), timeout=10)
    r.raise_for_status()
    return r.json()["user_id"]


# ─── Mongo helpers (motor) ───────────────────────────────────────────
async def db_set_plan(user_id: str, plan: str, role: Optional[str] = None) -> None:
    from motor.motor_asyncio import AsyncIOMotorClient
    cli = AsyncIOMotorClient(MONGO_URL)
    try:
        db = cli[DB_NAME]
        update: Dict[str, Any] = {"plan": plan}
        if role is not None:
            update["role"] = role
        await db.users.update_one({"user_id": user_id}, {"$set": update})
    finally:
        cli.close()


async def db_delete_user(user_id: str) -> None:
    from motor.motor_asyncio import AsyncIOMotorClient
    cli = AsyncIOMotorClient(MONGO_URL)
    try:
        db = cli[DB_NAME]
        await db.users.delete_one({"user_id": user_id})
    finally:
        cli.close()


# ════════════════════════════════════════════════════════════════════
# 1. GET /api/plans
# ════════════════════════════════════════════════════════════════════
def test_plans_endpoint() -> None:
    print("\n=== 1. GET /api/plans ===")
    r = requests.get(f"{API}/plans", timeout=15)
    if r.status_code != 200:
        record("1.status", "FAIL", f"{r.status_code} {r.text[:200]}")
        return
    record("1.status", "PASS", "200 OK")
    data = r.json()
    plans = data.get("plans") or []
    if len(plans) != 3:
        record("1.count", "FAIL", f"expected 3 plans, got {len(plans)}")
        return
    record("1.count", "PASS", "3 plans returned")

    keys = [p["key"] for p in plans]
    if keys != ["free", "pro", "elite"]:
        record("1.order", "FAIL", f"wrong order: {keys}")
    else:
        record("1.order", "PASS", "free → pro → elite order correct")

    by_key = {p["key"]: p for p in plans}

    # Free
    free = by_key.get("free", {})
    expected_free_features = [
        "Save up to 3 spots",
        "Upload locations",
        "Join the community",
        "Basic map access",
        "Current weather only",
    ]
    if free.get("features") == expected_free_features:
        record("1.free.features", "PASS", "exact feature list match")
    else:
        record("1.free.features", "FAIL",
               f"got {free.get('features')!r}")
    if free.get("tagline") == "Start scouting":
        record("1.free.tagline", "PASS", "tagline correct")
    else:
        record("1.free.tagline", "FAIL", f"got {free.get('tagline')!r}")
    if not any("Up to 5 spots you can upload" in f for f in (free.get("features") or [])):
        record("1.free.old_copy_removed", "PASS", "old 'Up to 5 spots' copy absent")
    else:
        record("1.free.old_copy_removed", "FAIL", "old copy still present")

    # Pro
    pro = by_key.get("pro", {})
    expected_pro_features = [
        "Unlimited saves",
        "Collections",
        "Route planning",
        "Advanced filters",
        "Weather overlays",
        "5-day weather forecast",
        "Profile analytics",
        "Pro badge",
    ]
    if pro.get("features") == expected_pro_features:
        record("1.pro.features", "PASS", "exact feature list match")
    else:
        record("1.pro.features", "FAIL", f"got {pro.get('features')!r}")
    if pro.get("tagline") == "Plan around light, weather, and the right spot":
        record("1.pro.tagline", "PASS", "tagline correct")
    else:
        record("1.pro.tagline", "FAIL", f"got {pro.get('tagline')!r}")
    if pro.get("popular") is True:
        record("1.pro.popular", "PASS", "popular: true")
    else:
        record("1.pro.popular", "FAIL", f"popular not true: {pro.get('popular')!r}")

    # Elite
    elite = by_key.get("elite", {})
    expected_elite_features = [
        "Everything in Pro",
        "10-day weather forecast",
        "Exact sun path planning",
        "Sunrise / sunset precision planner",
        "Seasonal bloom / fall tracking",
        "Hidden gem early access",
        "Analytics dashboard",
        "Priority support",
        "Elite badge",
    ]
    if elite.get("features") == expected_elite_features:
        record("1.elite.features", "PASS", "exact feature list match")
    else:
        record("1.elite.features", "FAIL", f"got {elite.get('features')!r}")
    if elite.get("tagline") == "Advanced planning for serious creators":
        record("1.elite.tagline", "PASS", "tagline correct")
    else:
        record("1.elite.tagline", "FAIL", f"got {elite.get('tagline')!r}")

    # Forbidden old copy in Elite
    forbidden = [
        "Animated Elite badge",
        "Advanced spot analytics",
        "Sell curated spot packs",
        "Featured spotlight rotation",
    ]
    elite_feats = elite.get("features") or []
    leaked = [f for f in forbidden if f in elite_feats]
    if leaked:
        record("1.elite.old_copy_removed", "FAIL", f"leaked old copy: {leaked}")
    else:
        record("1.elite.old_copy_removed", "PASS",
               "all 4 old Elite phrases absent")


# ════════════════════════════════════════════════════════════════════
# 2. GET /api/weather — tier caps
# ════════════════════════════════════════════════════════════════════
def fetch_weather(token: Optional[str] = None) -> Dict[str, Any]:
    headers = auth_h(token) if token else {}
    r = requests.get(
        f"{API}/weather",
        params={"lat": LAT, "lng": LNG},
        headers=headers,
        timeout=20,
    )
    if r.status_code != 200:
        raise RuntimeError(f"/weather {r.status_code}: {r.text[:200]}")
    return r.json()


def check_weather_tier(label: str, body: Dict[str, Any],
                       expected_tier: str,
                       max_daily: int,
                       must_lock: List[str],
                       must_not_lock: Optional[List[str]] = None) -> None:
    tier = body.get("tier")
    if tier == expected_tier:
        record(f"2.{label}.tier", "PASS", f"tier={tier}")
    else:
        record(f"2.{label}.tier", "FAIL",
               f"expected tier={expected_tier!r}, got {tier!r}")
    daily = body.get("daily")
    daily_len = len(daily) if isinstance(daily, list) else 0
    if max_daily == 0:
        if daily is None or daily_len == 0:
            record(f"2.{label}.daily", "PASS",
                   f"daily absent/empty (len={daily_len})")
        else:
            record(f"2.{label}.daily", "FAIL",
                   f"daily should be 0/absent, got len={daily_len}")
    else:
        if daily_len <= max_daily:
            record(f"2.{label}.daily", "PASS",
                   f"daily len={daily_len} ≤ cap {max_daily}")
        else:
            record(f"2.{label}.daily", "FAIL",
                   f"daily len={daily_len} > cap {max_daily}")
    locked = set(body.get("locked_features") or [])
    missing = [k for k in must_lock if k not in locked]
    if missing:
        record(f"2.{label}.locked", "FAIL",
               f"missing locked features: {missing} (got {sorted(locked)})")
    else:
        record(f"2.{label}.locked", "PASS",
               f"contains {must_lock}")
    if must_not_lock is not None:
        leaked = [k for k in must_not_lock if k in locked]
        if leaked:
            record(f"2.{label}.locked_extra", "FAIL",
                   f"unexpected locked entries: {leaked}")
        else:
            record(f"2.{label}.locked_extra", "PASS",
                   f"no unexpected locked entries")


def test_weather_caps(admin_token: str) -> Dict[str, str]:
    """Returns dict of (label -> user_id) for cleanup."""
    print("\n=== 2. GET /api/weather (tier caps) ===")
    created_users: Dict[str, str] = {}

    # 2a — Anonymous
    try:
        body = fetch_weather(None)
        check_weather_tier("a_anon", body, "anon", 0,
                           must_lock=["daily", "hourly"])
    except Exception as e:
        record("2.a_anon", "FAIL", str(e))

    # 2b — Super admin (seeded admin)
    try:
        body = fetch_weather(admin_token)
        # super_admin role expected. Could also be 'admin'; check tier=elite
        check_weather_tier("b_admin", body, "elite", 10,
                           must_lock=[],
                           must_not_lock=["ten_day_forecast", "daily", "hourly"])
    except Exception as e:
        record("2.b_admin", "FAIL", str(e))

    # 2c — Fresh free user
    try:
        email, pw, token = register_user("tier_free")
        uid = get_me_uid(token)
        created_users["free"] = uid
        # Verify plan resolves to free via _debug_tier
        r = requests.get(f"{API}/weather/_debug_tier",
                         headers=auth_h(token), timeout=10)
        if r.status_code == 200:
            tier = r.json().get("effective_tier")
            if tier == "free":
                record("2.c_free.resolves", "PASS",
                       f"fresh user resolves to 'free'")
            else:
                record("2.c_free.resolves", "FAIL",
                       f"fresh user effective_tier={tier!r}")
        else:
            record("2.c_free.resolves", "FAIL",
                   f"_debug_tier {r.status_code}")
        body = fetch_weather(token)
        check_weather_tier("c_free", body, "free", 0,
                           must_lock=["daily", "hourly"])
    except Exception as e:
        record("2.c_free", "FAIL", str(e))

    # 2d — Pro user (forced via DB)
    try:
        email, pw, token = register_user("tier_pro")
        uid = get_me_uid(token)
        created_users["pro"] = uid
        asyncio.run(db_set_plan(uid, "pro"))
        body = fetch_weather(token)
        check_weather_tier("d_pro", body, "pro", 5,
                           must_lock=["ten_day_forecast"])
        # Explicit: assert daily <= 5 even if upstream returned 10
        daily = body.get("daily") or []
        if isinstance(daily, list) and len(daily) <= 5:
            record("2.d_pro.cap_strict", "PASS",
                   f"daily len={len(daily)} never exceeds 5")
        else:
            record("2.d_pro.cap_strict", "FAIL",
                   f"daily len={len(daily)} > 5")
    except Exception as e:
        record("2.d_pro", "FAIL", str(e))

    # 2e — Elite user (forced via DB)
    try:
        email, pw, token = register_user("tier_elite")
        uid = get_me_uid(token)
        created_users["elite"] = uid
        asyncio.run(db_set_plan(uid, "elite"))
        body = fetch_weather(token)
        check_weather_tier("e_elite", body, "elite", 10,
                           must_lock=[],
                           must_not_lock=None)
        locked = body.get("locked_features") or []
        if not locked:
            record("2.e_elite.locked_empty", "PASS", "locked_features is empty []")
        else:
            record("2.e_elite.locked_empty", "FAIL",
                   f"expected empty, got {locked}")
    except Exception as e:
        record("2.e_elite", "FAIL", str(e))

    return created_users


# ════════════════════════════════════════════════════════════════════
# 3. GET /api/weather/_debug_tier for super_admin
# ════════════════════════════════════════════════════════════════════
def test_debug_tier_admin(admin_token: str) -> None:
    print("\n=== 3. GET /api/weather/_debug_tier (super_admin) ===")
    r = requests.get(f"{API}/weather/_debug_tier",
                     headers=auth_h(admin_token), timeout=10)
    if r.status_code != 200:
        record("3.status", "FAIL", f"{r.status_code} {r.text[:200]}")
        return
    record("3.status", "PASS", "200 OK")
    data = r.json()
    if data.get("effective_tier") == "elite":
        record("3.elite", "PASS", "effective_tier=elite")
    else:
        record("3.elite", "FAIL",
               f"effective_tier={data.get('effective_tier')!r}")
    # The seeded admin has role 'admin' not 'super_admin', but the role
    # is_super_admin field should reflect role==super_admin.
    role = data.get("role")
    is_sa = data.get("is_super_admin")
    if role == "super_admin":
        if is_sa is True:
            record("3.is_super_admin", "PASS",
                   "role=super_admin, is_super_admin=true")
        else:
            record("3.is_super_admin", "FAIL",
                   f"role=super_admin but is_super_admin={is_sa}")
    else:
        record("3.is_super_admin", "INFO",
               f"seed admin role={role!r} (not super_admin) — "
               f"is_admin={data.get('is_admin')}, tier still elite ✓")


# ════════════════════════════════════════════════════════════════════
# 4. No-regression on other endpoints
# ════════════════════════════════════════════════════════════════════
def test_no_regression() -> None:
    print("\n=== 4. No-regression ===")

    # 4a — /billing/iap-config
    r = requests.get(f"{API}/billing/iap-config", timeout=10)
    if r.status_code == 200:
        body = r.json()
        ios = body.get("ios") or {}
        if ios.get("configured") is False:
            record("4a.iap_config", "PASS",
                   "ios.configured=false (placeholder mode)")
        else:
            record("4a.iap_config", "FAIL",
                   f"ios.configured={ios.get('configured')!r}")
    else:
        record("4a.iap_config", "FAIL", f"{r.status_code} {r.text[:120]}")

    # 4b — /revenuecat/webhook with no auth → 503 (placeholder secret)
    r = requests.post(f"{API}/revenuecat/webhook", json={"type": "TEST"}, timeout=10)
    if r.status_code == 503:
        record("4b.rc_webhook", "PASS",
               "503 (placeholder) for unauth POST")
    else:
        record("4b.rc_webhook", "FAIL",
               f"expected 503, got {r.status_code}: {r.text[:120]}")

    # 4c — DELETE /api/account/delete without auth → 401
    r = requests.delete(f"{API}/account/delete", timeout=10)
    if r.status_code in (401, 403):
        record("4c.acct_delete_auth", "PASS",
               f"{r.status_code} without Authorization header")
    else:
        record("4c.acct_delete_auth", "FAIL",
               f"expected 401, got {r.status_code}: {r.text[:120]}")

    # 4d — GET /api/spots/{id} returns owner placeholder for deleted users.
    # Hunt for an anonymized spot.
    async def find_anon_spot() -> Optional[str]:
        from motor.motor_asyncio import AsyncIOMotorClient
        cli = AsyncIOMotorClient(MONGO_URL)
        try:
            db = cli[DB_NAME]
            doc = await db.spots.find_one(
                {"creator_anonymized": True, "visibility_status": "approved",
                 "privacy_mode": "public"},
                {"spot_id": 1, "_id": 0},
            )
            return doc.get("spot_id") if doc else None
        finally:
            cli.close()

    spot_id = asyncio.run(find_anon_spot())
    if not spot_id:
        record("4d.spot_anon_owner", "INFO",
               "no creator_anonymized spot in DB — skipping owner placeholder check")
        return
    r = requests.get(f"{API}/spots/{spot_id}", timeout=15)
    if r.status_code != 200:
        record("4d.spot_anon_owner", "FAIL",
               f"GET /spots/{spot_id} {r.status_code}")
        return
    body = r.json()
    owner = body.get("owner") or {}
    if (owner.get("name") == "LumaScout user"
            and owner.get("deleted") is True
            and owner.get("user_id") in (None, "")
            and owner.get("avatar_url") in (None, "")):
        record("4d.spot_anon_owner", "PASS",
               f"owner placeholder intact on {spot_id}")
    else:
        record("4d.spot_anon_owner", "FAIL",
               f"placeholder mismatched: {owner}")


# ════════════════════════════════════════════════════════════════════
# 5. Plan normalization audit
# ════════════════════════════════════════════════════════════════════
PLAN_MATRIX = [
    # (plan, role, expected_effective_tier)
    ("free",        "user",        "free"),
    ("pro",         "user",        "pro"),
    ("elite",       "user",        "elite"),
    ("comp_pro",    "user",        "pro"),
    ("comp_elite",  "user",        "elite"),
    ("trial_pro",   "user",        "pro"),
    ("trial_elite", "user",        "elite"),
    ("free",        "super_admin", "elite"),
    ("free",        "admin",       "elite"),
]


def test_plan_normalization() -> Dict[str, List[str]]:
    print("\n=== 5. Plan normalization audit ===")
    # Register one user, then mutate plan/role per matrix entry to avoid
    # creating 9 separate accounts.
    try:
        email, pw, token = register_user("tier_matrix")
        uid = get_me_uid(token)
    except Exception as e:
        record("5.setup", "FAIL", f"could not create matrix user: {e}")
        return {"matrix_users": []}
    record("5.setup", "PASS", f"matrix user uid={uid}")

    matrix_uids: List[str] = [uid]
    for i, (plan, role, expected) in enumerate(PLAN_MATRIX):
        # Mutate the user doc
        try:
            asyncio.run(db_set_plan(uid, plan, role))
        except Exception as e:
            record(f"5.{i:02d}.{plan}.{role}.setup", "FAIL", str(e))
            continue
        # Hit _debug_tier
        try:
            r = requests.get(f"{API}/weather/_debug_tier",
                             headers=auth_h(token), timeout=10)
        except Exception as e:
            record(f"5.{i:02d}.{plan}.{role}", "FAIL", f"request error: {e}")
            continue
        if r.status_code != 200:
            record(f"5.{i:02d}.{plan}.{role}", "FAIL",
                   f"{r.status_code} {r.text[:200]}")
            continue
        eff = r.json().get("effective_tier")
        if eff == expected:
            record(f"5.{i:02d}.{plan}.{role}", "PASS",
                   f"resolved → {eff}")
        else:
            record(f"5.{i:02d}.{plan}.{role}", "FAIL",
                   f"expected {expected!r}, got {eff!r}")
    return {"matrix_users": matrix_uids}


# ════════════════════════════════════════════════════════════════════
# Cleanup
# ════════════════════════════════════════════════════════════════════
async def cleanup_users(uids: List[str]) -> None:
    if not uids:
        return
    from motor.motor_asyncio import AsyncIOMotorClient
    cli = AsyncIOMotorClient(MONGO_URL)
    try:
        db = cli[DB_NAME]
        for uid in uids:
            await db.users.delete_one({"user_id": uid})
    finally:
        cli.close()


# ════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════
def main() -> int:
    print(f"BASE={BASE}")
    print(f"DB={DB_NAME} via {MONGO_URL}")

    # Auth super_admin upfront
    try:
        admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
        record("0.admin_login", "PASS", f"logged in as {ADMIN_EMAIL}")
    except Exception as e:
        record("0.admin_login", "FAIL", str(e))
        return summarize()

    test_plans_endpoint()
    created_weather = test_weather_caps(admin_token)
    test_debug_tier_admin(admin_token)
    test_no_regression()
    matrix = test_plan_normalization()

    # Cleanup ephemeral users
    all_uids = list(created_weather.values()) + matrix.get("matrix_users", [])
    try:
        asyncio.run(cleanup_users(all_uids))
        record("99.cleanup", "PASS", f"deleted {len(all_uids)} ephemeral users")
    except Exception as e:
        record("99.cleanup", "INFO", f"cleanup error: {e}")

    return summarize()


if __name__ == "__main__":
    sys.exit(main())
