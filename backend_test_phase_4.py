"""
backend_test_phase_4.py — Validate Scout AI Phase 4 planners + Forgot/Reset Password.

Run with: python3 /app/backend_test_phase_4.py
"""
import os
import sys
import time
import json
import uuid
import traceback
from typing import Any, Dict, Optional

import requests

BASE = os.environ.get("BACKEND_BASE_URL") or "https://photo-finder-60.preview.emergentagent.com"
API = BASE.rstrip("/") + "/api"

ADMIN_CREDS  = ("admin@photoscout.app", "admin123")
SOPHIE_CREDS = ("sophie@photoscout.app", "demo123")
MARCO_CREDS  = ("marco@photoscout.app",  "demo123")

# ---------- Helpers ----------------------------------------------------------
_pass = 0
_fail = 0
_failures: list = []


def _assert(cond: bool, label: str, detail: str = "") -> bool:
    global _pass, _fail
    if cond:
        _pass += 1
        print(f"  PASS  {label}")
        return True
    else:
        _fail += 1
        print(f"  FAIL  {label}  -- {detail}")
        _failures.append(f"{label} -- {detail}")
        return False


def _h(token: Optional[str] = None) -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _login(email: str, password: str) -> Optional[str]:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        print(f"  LOGIN FAIL {email}: {r.status_code} {r.text[:200]}")
        return None
    j = r.json()
    return j.get("token") or j.get("access_token")


def _llm_retry(callable_, *args, **kwargs):
    """Wrap a callable and retry once after 5s if we hit a 429."""
    r = callable_(*args, **kwargs)
    if r.status_code == 429:
        print(f"  [rate-limited] {r.text[:120]} — retrying once in 5s …")
        time.sleep(5)
        r = callable_(*args, **kwargs)
    return r


# ---------- Tests: login ----------------------------------------------------
def test_login_and_tokens():
    print("\n=== LOGIN (sanity, all 3 accounts) ===")
    admin  = _login(*ADMIN_CREDS)
    sophie = _login(*SOPHIE_CREDS)
    marco  = _login(*MARCO_CREDS)
    _assert(bool(admin),  "admin login")
    _assert(bool(sophie), "sophie login")
    _assert(bool(marco),  "marco login")
    return admin, sophie, marco


# ---------- Tests: forgot password / reset password -------------------------
def test_forgot_reset_password():
    print("\n=== FORGOT / RESET PASSWORD ===")
    out: Dict[str, Any] = {}

    # 1) unknown email → 200 generic, NO reset_token
    r = requests.post(f"{API}/auth/forgot-password",
                      json={"email": f"nobody+{uuid.uuid4().hex[:8]}@example.com"}, timeout=30)
    _assert(r.status_code == 200, "forgot-password unknown email → 200", f"{r.status_code} {r.text[:200]}")
    j = r.json() if r.status_code == 200 else {}
    _assert(j.get("ok") is True, "forgot-password unknown: ok=true")
    _assert("reset_token" not in j, "forgot-password unknown: no reset_token leaked",
            f"got {list(j.keys())}")

    # 2) registered sophie → 200 with reset_token + reset_link + expires_at
    r = requests.post(f"{API}/auth/forgot-password",
                      json={"email": SOPHIE_CREDS[0]}, timeout=30)
    _assert(r.status_code == 200, "forgot-password sophie → 200", f"{r.status_code}")
    j = r.json() if r.status_code == 200 else {}
    _assert(j.get("dev_mode") is True, "forgot-password sophie: dev_mode=true")
    t1 = j.get("reset_token")
    _assert(isinstance(t1, str) and len(t1) >= 32, "forgot-password sophie: reset_token present",
            f"got {type(t1).__name__}={t1!r}")
    _assert(isinstance(j.get("reset_link"), str) and "token=" in j.get("reset_link", ""),
            "forgot-password sophie: reset_link present")
    _assert(isinstance(j.get("expires_at"), str), "forgot-password sophie: expires_at present")
    out["sophie_token_1"] = t1

    # 3) second request invalidates prior token
    r = requests.post(f"{API}/auth/forgot-password",
                      json={"email": SOPHIE_CREDS[0]}, timeout=30)
    _assert(r.status_code == 200, "forgot-password sophie #2 → 200")
    j2 = r.json() if r.status_code == 200 else {}
    t2 = j2.get("reset_token")
    _assert(isinstance(t2, str) and t2 != t1, "second forgot-password returns a new token",
            f"t1={t1[:8] if t1 else None} t2={t2[:8] if t2 else None}")
    out["sophie_token_2"] = t2

    # 4) reset-password with invalid token → 400
    r = requests.post(f"{API}/auth/reset-password",
                      json={"token": "deadbeef_notreal", "new_password": "NewPass12345!"},
                      timeout=30)
    _assert(r.status_code == 400, "reset-password invalid token → 400", f"{r.status_code} {r.text[:200]}")

    # 5) reset-password with password < 8 chars → 400
    r = requests.post(f"{API}/auth/reset-password",
                      json={"token": t2, "new_password": "abc"}, timeout=30)
    _assert(r.status_code == 400, "reset-password short password → 400", f"{r.status_code} {r.text[:200]}")

    # 6) reset-password: use the NOW-SUPERSEDED first token → 400 ("already used")
    r = requests.post(f"{API}/auth/reset-password",
                      json={"token": t1, "new_password": "TempPass12345!"}, timeout=30)
    _assert(r.status_code == 400, "reset-password superseded token → 400",
            f"{r.status_code} {r.text[:200]}")

    # 7) reset-password valid second token, set a TEMP password
    TEMP_PW = "TempPass12345!"
    r = requests.post(f"{API}/auth/reset-password",
                      json={"token": t2, "new_password": TEMP_PW}, timeout=30)
    _assert(r.status_code == 200, "reset-password valid → 200", f"{r.status_code} {r.text[:200]}")
    _assert(r.json().get("ok") is True if r.status_code == 200 else False, "reset-password returns ok=true")

    # 8) old demo123 no longer works
    r = requests.post(f"{API}/auth/login",
                      json={"email": SOPHIE_CREDS[0], "password": "demo123"}, timeout=30)
    _assert(r.status_code == 401, "old password rejected after reset → 401",
            f"{r.status_code} {r.text[:200]}")

    # 9) new password logs in
    r = requests.post(f"{API}/auth/login",
                      json={"email": SOPHIE_CREDS[0], "password": TEMP_PW}, timeout=30)
    _assert(r.status_code == 200, "new password works → 200", f"{r.status_code} {r.text[:200]}")

    # 10) reuse already-consumed token → 400 "already used"
    r = requests.post(f"{API}/auth/reset-password",
                      json={"token": t2, "new_password": "AnotherPw12345!"}, timeout=30)
    _assert(r.status_code == 400, "reset-password reuse consumed token → 400",
            f"{r.status_code} {r.text[:200]}")

    # 11) RESET sophie's password back to 'demo123' for downstream suites.
    #
    # NOTE: The reset-password endpoint enforces min 8 chars (server.py:607-608)
    # but 'demo123' is only 7 chars — so it CANNOT be restored via the
    # forgot+reset flow. We therefore restore it via a direct bcrypt hash write
    # to the users collection using the same hash_password() the backend uses
    # on register.  Flag this clearly for the main agent.
    try:
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        import bcrypt as _bcrypt
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name   = os.environ.get("DB_NAME",   "photoscout_database")

        async def _restore():
            cli = AsyncIOMotorClient(mongo_url)
            try:
                h = _bcrypt.hashpw(b"demo123", _bcrypt.gensalt()).decode()
                res = await cli[db_name].users.update_one(
                    {"email": SOPHIE_CREDS[0]},
                    {"$set": {"password_hash": h}},
                )
                return res.modified_count
            finally:
                cli.close()

        modified = asyncio.run(_restore())
        print(f"  [note] restored sophie's bcrypt hash via direct write (modified_count={modified})")
    except Exception as exc:
        print(f"  [WARN] direct password restore failed: {exc}")

    # Verify restore worked
    r = requests.post(f"{API}/auth/login",
                      json={"email": SOPHIE_CREDS[0], "password": "demo123"}, timeout=30)
    _assert(r.status_code == 200,
            "sophie can login with 'demo123' after restore",
            f"{r.status_code} {r.text[:200]}")

    return out


# ---------- Tests: Scout AI planners ----------------------------------------
def _get_any_spot(token: str) -> Optional[dict]:
    """Fetch at least one public spot for regression / planner tests."""
    r = requests.get(f"{API}/spots?limit=5", headers=_h(token), timeout=30)
    if r.status_code == 200:
        data = r.json()
        items = data if isinstance(data, list) else data.get("items") or []
        for s in items:
            if s.get("privacy_mode") in ("public", None) or "spot_id" in s:
                return s
    return None


def _first_austin_spot(token: str) -> Optional[dict]:
    r = requests.get(f"{API}/spots?city=Austin&limit=5", headers=_h(token), timeout=30)
    if r.status_code == 200:
        data = r.json()
        items = data if isinstance(data, list) else data.get("items") or []
        if items:
            return items[0]
    return None


def test_plan_collection(token: str):
    print("\n=== POST /api/ai/plan/collection ===")
    # blank theme + seed_from_preferences=False → 400
    r = _llm_retry(requests.post, f"{API}/ai/plan/collection",
                   headers=_h(token), json={"theme": "", "seed_from_preferences": False}, timeout=90)
    _assert(r.status_code == 400, "collection: blank theme → 400", f"{r.status_code} {r.text[:200]}")

    # unknown city with no matches → 404
    r = _llm_retry(requests.post, f"{API}/ai/plan/collection",
                   headers=_h(token), json={"theme": "misty forest", "city": "NoSuchCity_ZZ9"}, timeout=90)
    _assert(r.status_code == 404, "collection: unknown city → 404", f"{r.status_code} {r.text[:200]}")

    # valid request
    r = _llm_retry(requests.post, f"{API}/ai/plan/collection",
                   headers=_h(token),
                   json={"theme": "golden hour family portraits", "city": "Austin",
                         "min_count": 4, "max_count": 6},
                   timeout=180)
    if r.status_code == 429:
        print("  [still rate-limited after retry] skipping deep assertions on collection planner")
        return
    _assert(r.status_code == 200, "collection: valid request → 200", f"{r.status_code} {r.text[:300]}")
    if r.status_code != 200:
        return
    j = r.json()
    _assert(j.get("plan_type") == "collection", "collection: plan_type=='collection'")
    for k in ("name", "description", "theme", "spots", "count", "disclosure"):
        _assert(k in j, f"collection: key '{k}' present")
    _assert(isinstance(j.get("spots"), list), "collection: spots is list")
    cnt = j.get("count", 0)
    _assert(4 <= cnt <= 6, f"collection: count within [4..6] (got {cnt})")
    _assert(all(s.get("spot_id") for s in j.get("spots", [])), "collection: every spot has spot_id")
    # Each spot_id must actually exist (verify by fetching)
    if j.get("spots"):
        sid = j["spots"][0]["spot_id"]
        r2 = requests.get(f"{API}/spots/{sid}", headers=_h(token), timeout=30)
        _assert(r2.status_code == 200, f"collection: returned spot_id '{sid}' resolvable via GET /spots/{{id}}",
                f"{r2.status_code}")

    # no auth → 401
    r = requests.post(f"{API}/ai/plan/collection", json={"theme": "x"}, timeout=30)
    _assert(r.status_code in (401, 403), "collection: no auth → 401/403", f"{r.status_code}")


def test_plan_weekend(token: str):
    print("\n=== POST /api/ai/plan/weekend ===")
    # blank city → 400
    r = _llm_retry(requests.post, f"{API}/ai/plan/weekend",
                   headers=_h(token), json={"city": ""}, timeout=90)
    _assert(r.status_code == 400, "weekend: blank city → 400", f"{r.status_code} {r.text[:200]}")

    # unknown city → 404
    r = _llm_retry(requests.post, f"{API}/ai/plan/weekend",
                   headers=_h(token), json={"city": "NoSuchCity_ZZ9"}, timeout=90)
    _assert(r.status_code == 404, "weekend: unknown city → 404", f"{r.status_code}")

    # days=1 → 2 slots
    r = _llm_retry(requests.post, f"{API}/ai/plan/weekend",
                   headers=_h(token),
                   json={"city": "Austin", "days": 1, "focus": "golden hour", "party": "solo"},
                   timeout=180)
    if r.status_code == 200:
        j = r.json()
        _assert(j.get("plan_type") == "weekend", "weekend-1day: plan_type=='weekend'")
        _assert(j.get("days") == 1, f"weekend-1day: days=1 (got {j.get('days')})")
        _assert(len(j.get("slots") or []) == 2,
                f"weekend-1day: exactly 2 slots (got {len(j.get('slots') or [])})")
        for k in ("title", "summary", "city", "slots", "count", "disclosure"):
            _assert(k in j, f"weekend-1day: key '{k}' present")
    elif r.status_code == 429:
        print("  [skipping weekend-1day deep asserts — rate-limited]")
    else:
        _assert(False, "weekend-1day: 200", f"{r.status_code} {r.text[:200]}")

    # days=2 → 4 slots, no duplicate spot across slots
    r = _llm_retry(requests.post, f"{API}/ai/plan/weekend",
                   headers=_h(token),
                   json={"city": "Austin", "days": 2, "focus": "varied"}, timeout=180)
    if r.status_code == 200:
        j = r.json()
        slots = j.get("slots") or []
        _assert(len(slots) == 4, f"weekend-2day: 4 slots (got {len(slots)})")
        sids = [s.get("spot", {}).get("spot_id") for s in slots if s.get("spot")]
        _assert(len(sids) == len(set(sids)), f"weekend-2day: no duplicate spots (got {sids})")
    elif r.status_code == 429:
        print("  [skipping weekend-2day deep asserts — rate-limited]")
    else:
        _assert(False, "weekend-2day: 200", f"{r.status_code} {r.text[:200]}")

    # no auth
    r = requests.post(f"{API}/ai/plan/weekend", json={"city": "Austin"}, timeout=30)
    _assert(r.status_code in (401, 403), "weekend: no auth → 401/403", f"{r.status_code}")


def test_plan_route(token: str):
    print("\n=== POST /api/ai/plan/route ===")
    # missing base_lat/base_lng — since pydantic requires them, it will be a 422
    r = requests.post(f"{API}/ai/plan/route", headers=_h(token), json={}, timeout=30)
    _assert(r.status_code in (400, 422), "route: missing base_lat/lng → 400/422",
            f"{r.status_code} {r.text[:200]}")

    # zero nearby public spots → 404 (remote lat/lng in the middle of the ocean)
    r = _llm_retry(requests.post, f"{API}/ai/plan/route",
                   headers=_h(token),
                   json={"base_lat": 0.0, "base_lng": -40.0, "radius_km": 10}, timeout=90)
    _assert(r.status_code == 404, "route: middle-of-ocean → 404", f"{r.status_code} {r.text[:200]}")

    # valid call: Austin, TX  (30.2672, -97.7431)
    r = _llm_retry(requests.post, f"{API}/ai/plan/route",
                   headers=_h(token),
                   json={"base_lat": 30.2672, "base_lng": -97.7431, "city": "Austin",
                         "max_stops": 5, "radius_km": 100, "focus": "varied"},
                   timeout=180)
    if r.status_code == 429:
        print("  [skipping route deep asserts — rate-limited]")
        return
    _assert(r.status_code == 200, "route: valid → 200", f"{r.status_code} {r.text[:300]}")
    if r.status_code != 200:
        return
    j = r.json()
    _assert(j.get("plan_type") == "route", "route: plan_type=='route'")
    for k in ("title", "summary", "base", "stops", "total_distance_km", "total_eta_min", "disclosure"):
        _assert(k in j, f"route: key '{k}' present")
    stops = j.get("stops") or []
    _assert(len(stops) >= 2, f"route: at least 2 stops (got {len(stops)})")
    # Order contiguous 1..N
    orders = [s.get("order") for s in stops]
    _assert(orders == list(range(1, len(orders) + 1)),
            f"route: order is 1..N contiguous (got {orders})")
    # Each leg distance > 0
    legs = [s.get("distance_from_prev_km") for s in stops]
    _assert(all(isinstance(x, (int, float)) and x > 0 for x in legs),
            f"route: every leg distance > 0 (got {legs})")
    # total ≈ sum of legs
    total_km = j.get("total_distance_km") or 0
    sum_legs = round(sum(legs), 1)
    _assert(abs(total_km - sum_legs) <= 0.2,
            f"route: total_distance_km == sum(legs) (total={total_km} vs sum={sum_legs})")


def test_assist_upload(token: str):
    print("\n=== POST /api/ai/assist/upload ===")
    VALID_BEST = {"sunrise", "morning", "golden_hour", "night", "any"}

    # completely empty body → 200 (best-effort)
    r = _llm_retry(requests.post, f"{API}/ai/assist/upload", headers=_h(token), json={}, timeout=180)
    if r.status_code == 429:
        print("  [skipping assist/upload empty-body asserts — rate-limited]")
    else:
        _assert(r.status_code == 200, "assist/upload: empty body → 200", f"{r.status_code} {r.text[:200]}")
        if r.status_code == 200:
            j = r.json()
            for k in ("title", "summary", "best_time_of_day", "tips", "disclosure"):
                _assert(k in j, f"assist/upload (empty): key '{k}' present")
            _assert(j.get("best_time_of_day") in VALID_BEST,
                    f"assist/upload (empty): best_time_of_day in allowed set (got {j.get('best_time_of_day')})")
            _assert(isinstance(j.get("tips"), list), "assist/upload (empty): tips is list")

    # typical populated body
    r = _llm_retry(requests.post, f"{API}/ai/assist/upload",
                   headers=_h(token),
                   json={"rough_title": "quiet riverbend at sunrise",
                         "city": "Austin", "state": "TX",
                         "lat": 30.2672, "lng": -97.7431,
                         "shoot_types": ["Family", "Portraits"],
                         "notes": "Off-trail pull-off near lady bird lake, flat rocks"},
                   timeout=180)
    if r.status_code == 429:
        print("  [skipping assist/upload populated deep asserts — rate-limited]")
        return
    _assert(r.status_code == 200, "assist/upload: populated body → 200", f"{r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        j = r.json()
        for k in ("title", "summary", "best_time_of_day", "tips", "disclosure"):
            _assert(k in j, f"assist/upload: key '{k}' present")
        _assert(j.get("best_time_of_day") in VALID_BEST,
                f"assist/upload: best_time_of_day in allowed set (got {j.get('best_time_of_day')})")
        tips = j.get("tips") or []
        _assert(isinstance(tips, list) and len(tips) >= 1,
                f"assist/upload: tips non-empty list (got {len(tips)})")
        _assert(isinstance(j.get("summary"), str) and len(j.get("summary")) > 0,
                f"assist/upload: summary non-empty (got len={len(j.get('summary') or '')})")

    # no auth
    r = requests.post(f"{API}/ai/assist/upload", json={}, timeout=30)
    _assert(r.status_code in (401, 403), "assist/upload: no auth → 401/403", f"{r.status_code}")


# ---------- Tests: sanity regressions ---------------------------------------
def test_scout_ai_chat(token: str):
    print("\n=== POST /api/ai/chat (existing; regression) ===")
    r = _llm_retry(requests.post, f"{API}/ai/chat",
                   headers=_h(token),
                   json={"messages": [{"role": "user",
                                       "content": "In one short sentence: what light suits family portraits?"}]},
                   timeout=120)
    if r.status_code == 429:
        print("  [rate-limited] skipping /ai/chat deep asserts")
        return
    _assert(r.status_code == 200, "ai/chat: valid → 200", f"{r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        j = r.json()
        _assert(isinstance(j.get("reply"), str) and j.get("reply", "").strip() != "",
                f"ai/chat: reply non-empty (got {(j.get('reply') or '')[:80]!r})")
        _assert(isinstance(j.get("follow_ups"), list), "ai/chat: follow_ups is list")


def test_post_with_spot_id(sophie_token: str):
    print("\n=== POST /api/posts with spot_id (new-field regression) ===")
    # Find an Austin spot to reference
    s = _first_austin_spot(sophie_token) or _get_any_spot(sophie_token)
    if not s or not s.get("spot_id"):
        _assert(False, "posts+spot_id: couldn't find a spot to reference", "no spots")
        return
    sid = s["spot_id"]
    payload = {
        "category": "win",
        "title": f"QA phase-4 spot-link test {uuid.uuid4().hex[:6]}",
        "body":  "Attaching this to a known spot for the Phase-4 regression sweep.",
        "spot_id": sid,
    }
    r = requests.post(f"{API}/posts", headers=_h(sophie_token), json=payload, timeout=30)
    _assert(r.status_code == 200, "posts+spot_id: create → 200", f"{r.status_code} {r.text[:200]}")
    if r.status_code != 200:
        return
    post = r.json()
    post_id = post.get("post_id")
    _assert(isinstance(post_id, str) and post_id.startswith("pst_"),
            f"posts+spot_id: post_id returned and prefixed pst_ (got {post_id})")
    # Fetch back and confirm spot_id persisted
    r = requests.get(f"{API}/posts/{post_id}", headers=_h(sophie_token), timeout=30)
    _assert(r.status_code == 200, "posts+spot_id: GET post → 200", f"{r.status_code}")
    if r.status_code == 200:
        got = r.json()
        _assert(got.get("spot_id") == sid,
                f"posts+spot_id: GET returns spot_id='{sid}' (got {got.get('spot_id')!r})")

    # Bogus spot_id → 404
    payload["spot_id"] = "spot_doesnotexist_zzz"
    payload["title"] += "_bogus"
    r = requests.post(f"{API}/posts", headers=_h(sophie_token), json=payload, timeout=30)
    _assert(r.status_code == 404, "posts+spot_id: bogus spot_id → 404",
            f"{r.status_code} {r.text[:200]}")


def test_super_admin_smoke(admin_token: str, sophie_token: str):
    print("\n=== SUPER-ADMIN DELETE smoke (regression) ===")
    # 403 for regular user
    r = requests.request("DELETE", f"{API}/admin/spots/spot_doesnotexist_zzz",
                         headers=_h(sophie_token),
                         json={"reason_code": "other", "reason_note": "qa"}, timeout=30)
    _assert(r.status_code == 403, "super-admin spot delete as sophie → 403",
            f"{r.status_code} {r.text[:200]}")
    # 404 for admin with bogus id
    r = requests.request("DELETE", f"{API}/admin/spots/spot_doesnotexist_zzz",
                         headers=_h(admin_token),
                         json={"reason_code": "other", "reason_note": "qa"}, timeout=30)
    _assert(r.status_code == 404, "super-admin spot delete bogus id → 404",
            f"{r.status_code} {r.text[:200]}")
    # 403 for regular user on user delete
    r = requests.request("DELETE", f"{API}/admin/users/user_doesnotexist_zzz",
                         headers=_h(sophie_token),
                         json={"reason_code": "other", "reason_note": "qa"}, timeout=30)
    _assert(r.status_code == 403, "super-admin user delete as sophie → 403",
            f"{r.status_code} {r.text[:200]}")
    # 404 for admin with bogus id
    r = requests.request("DELETE", f"{API}/admin/users/user_doesnotexist_zzz",
                         headers=_h(admin_token),
                         json={"reason_code": "other", "reason_note": "qa"}, timeout=30)
    _assert(r.status_code == 404, "super-admin user delete bogus id → 404",
            f"{r.status_code} {r.text[:200]}")


# ---------- Main -------------------------------------------------------------
def main():
    print(f"Backend: {API}\n")

    # Phase 1 — login smoke
    admin, sophie, marco = test_login_and_tokens()

    # Phase 2 — forgot/reset password
    try:
        test_forgot_reset_password()
    except Exception:
        traceback.print_exc()

    # Re-login sophie (password now restored to demo123)
    sophie = _login(*SOPHIE_CREDS)

    # Phase 3 — Scout AI planners
    if sophie:
        try:
            test_plan_collection(sophie)
        except Exception:
            traceback.print_exc()
        try:
            test_plan_weekend(sophie)
        except Exception:
            traceback.print_exc()
        try:
            test_plan_route(sophie)
        except Exception:
            traceback.print_exc()
        try:
            test_assist_upload(sophie)
        except Exception:
            traceback.print_exc()
        try:
            test_scout_ai_chat(sophie)
        except Exception:
            traceback.print_exc()

    # Phase 4 — regression
    if sophie:
        try:
            test_post_with_spot_id(sophie)
        except Exception:
            traceback.print_exc()
    if admin and sophie:
        try:
            test_super_admin_smoke(admin, sophie)
        except Exception:
            traceback.print_exc()

    print("\n=== SUMMARY ===")
    print(f"  PASS: {_pass}")
    print(f"  FAIL: {_fail}")
    if _failures:
        print("\n  Failures:")
        for f in _failures:
            print(f"    - {f}")
    sys.exit(0 if _fail == 0 else 1)


if __name__ == "__main__":
    main()
