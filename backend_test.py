"""
Phase 4 regression — routes/users.py extraction.

Validates 9 moved endpoints + ReportIn cross-domain restoration +
non-regression of other domain modules.
"""
from __future__ import annotations

import os
import sys
import time
import json
import uuid
import requests

BASE = os.environ.get(
    "BACKEND_BASE",
    "https://photo-finder-60.preview.emergentagent.com/api",
)

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"


def _p(title: str):
    print(f"\n─── {title} ───")


FAILS: list[str] = []
PASSES: list[str] = []


def _chk(ok: bool, msg: str):
    if ok:
        PASSES.append(msg)
        print(f"  ✅ {msg}")
    else:
        FAILS.append(msg)
        print(f"  ❌ {msg}")


def _login(email: str, password: str) -> str | None:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        print(f"  login {email} -> {r.status_code} {r.text[:200]}")
        return None
    return r.json().get("token")


def _register(email: str, password: str, name: str, username: str) -> str | None:
    r = requests.post(
        f"{BASE}/auth/register",
        json={"email": email, "password": password, "name": name, "username": username},
        timeout=20,
    )
    if r.status_code != 200:
        print(f"  register {email} -> {r.status_code} {r.text[:200]}")
        return None
    return r.json().get("token")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def main() -> int:
    # ── BOOT: login admin ───────────────────────────────────────────
    _p("BOOT")
    admin_tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_tok:
        print("FATAL: admin login failed — cannot run suite")
        return 2
    r = requests.get(f"{BASE}/auth/me", headers=_auth(admin_tok), timeout=10)
    admin_uid = r.json().get("user_id")
    print(f"  admin user_id = {admin_uid}")

    # Register second user for report / follower flows
    rid = uuid.uuid4().hex[:8]
    u2_email = f"qa_users_reg_{rid}@lumascout.app"
    u2_pwd = "Test#1234"
    u2_tok = _register(u2_email, u2_pwd, "Phase4 QA", f"qa_p4_{rid}")
    if not u2_tok:
        print("FATAL: throwaway registration failed")
        return 2
    r = requests.get(f"{BASE}/auth/me", headers=_auth(u2_tok), timeout=10)
    u2_uid = r.json().get("user_id")
    print(f"  throwaway user_id = {u2_uid}")

    # ── 1) PUBLIC PROFILE ───────────────────────────────────────────
    _p("1) GET /users/{id} (public profile)")
    r = requests.get(f"{BASE}/users/{admin_uid}", headers=_auth(u2_tok), timeout=15)
    _chk(r.status_code == 200, f"GET /users/{{admin_uid}} authed -> 200 (got {r.status_code})")
    body = r.json() if r.status_code == 200 else {}
    _chk("name" in body, "profile payload has name")
    _chk("plan" in body, "profile payload has plan")
    _chk("role" in body, "profile payload has role")
    _chk("stats" in body, "profile has stats block")
    stats = body.get("stats") or {}
    _chk("followers" in stats and "following" in stats, "stats has followers+following")
    _chk("spots" in stats or "spots_count" in stats, "stats has spot_count alias")

    # recent_spots / hydrated spots through public_spot_view
    # server uses field name 'recent_spots' or embed under body
    rec = body.get("recent_spots") or body.get("spots")
    # Not a hard fail if absent — original get_user didn't return them.
    # 404
    r = requests.get(f"{BASE}/users/user_does_not_exist_{rid}", headers=_auth(u2_tok), timeout=10)
    _chk(r.status_code == 404, f"GET /users/nonexistent -> 404 (got {r.status_code})")

    # Unauthenticated public profile
    r = requests.get(f"{BASE}/users/{admin_uid}", timeout=10)
    _chk(r.status_code in (200, 401), f"GET /users/{{admin_uid}} unauth -> 200 or 401 (got {r.status_code})")
    unauth_code = r.status_code

    # ── 2) USER REPORT ──────────────────────────────────────────────
    _p("2) POST /users/{id}/report (DMReportIn)")
    # Report admin as another user
    r = requests.post(
        f"{BASE}/users/{admin_uid}/report",
        json={"reason": "spam", "notes": "phase4 regression"},
        headers=_auth(u2_tok),
        timeout=10,
    )
    _chk(r.status_code == 200, f"POST /users/{{admin}}/report valid -> 200 (got {r.status_code}) {r.text[:120]}")
    # Self-report (should 400)
    r = requests.post(
        f"{BASE}/users/{u2_uid}/report",
        json={"reason": "spam"},
        headers=_auth(u2_tok),
        timeout=10,
    )
    _chk(r.status_code == 400, f"self-report -> 400 (got {r.status_code}) {r.text[:120]}")
    # Unauth -> 401/403
    r = requests.post(
        f"{BASE}/users/{admin_uid}/report",
        json={"reason": "spam"},
        timeout=10,
    )
    _chk(r.status_code in (401, 403), f"report unauth -> 401 (got {r.status_code})")

    # ── 3) /me/* DASHBOARDS ────────────────────────────────────────
    _p("3) /me/* dashboards (as admin)")
    h = _auth(admin_tok)

    r = requests.get(f"{BASE}/me/recent-locations", headers=h, timeout=10)
    _chk(r.status_code == 200, f"/me/recent-locations -> 200 (got {r.status_code})")
    if r.status_code == 200:
        j = r.json()
        _chk(isinstance(j, dict) and "items" in j and "count" in j, "/me/recent-locations has items+count")

    r = requests.get(f"{BASE}/me/drafts", headers=h, timeout=10)
    _chk(r.status_code == 200, f"/me/drafts -> 200 (got {r.status_code})")
    _chk(isinstance(r.json(), list), "/me/drafts returns a list")

    r = requests.get(f"{BASE}/me/trends?days=7", headers=h, timeout=10)
    _chk(r.status_code == 200, f"/me/trends?days=7 -> 200 (got {r.status_code})")
    if r.status_code == 200:
        j = r.json()
        _chk("series" in j and "totals" in j and j.get("days") == 7, "/me/trends shape ok (days+series+totals)")

    r = requests.get(f"{BASE}/me/dashboard", headers=h, timeout=15)
    _chk(r.status_code == 200, f"/me/dashboard -> 200 (got {r.status_code})")
    if r.status_code == 200:
        j = r.json()
        _chk(all(k in j for k in ("total_spots", "saves_received", "followers", "top_spots")), "/me/dashboard KPIs present")

    r = requests.get(f"{BASE}/me/packs", headers=h, timeout=10)
    _chk(r.status_code == 200, f"/me/packs -> 200 (got {r.status_code})")
    _chk(isinstance(r.json(), list), "/me/packs is a list")

    r = requests.get(f"{BASE}/me/reviews-received", headers=h, timeout=10)
    _chk(r.status_code == 200, f"/me/reviews-received -> 200 (got {r.status_code})")
    if r.status_code == 200:
        j = r.json()
        _chk("items" in j and "count" in j, "/me/reviews-received has items+count")

    # ── 4) /me/upgrade ──────────────────────────────────────────────
    _p("4) POST /me/upgrade")
    # Valid plan
    r = requests.post(
        f"{BASE}/me/upgrade",
        json={"plan": "pro", "cycle": "monthly"},
        headers=_auth(u2_tok),
        timeout=10,
    )
    _chk(r.status_code in (200, 400, 402), f"/me/upgrade {{plan:pro}} -> 200/400/402, NOT 500 (got {r.status_code})")
    _chk(r.status_code != 500, f"/me/upgrade {{plan:pro}} did NOT 500 (got {r.status_code})")

    # Invalid plan
    r = requests.post(
        f"{BASE}/me/upgrade",
        json={"plan": "invalid_plan_xyz"},
        headers=_auth(u2_tok),
        timeout=10,
    )
    _chk(r.status_code in (400, 422), f"/me/upgrade invalid plan -> 400/422 (got {r.status_code})")

    # Unauth
    r = requests.post(f"{BASE}/me/upgrade", json={"plan": "pro"}, timeout=10)
    _chk(r.status_code in (401, 403), f"/me/upgrade unauth -> 401 (got {r.status_code})")

    # Revert u2 back to free so later tests behave predictably
    requests.post(
        f"{BASE}/me/upgrade",
        json={"plan": "free"},
        headers=_auth(u2_tok),
        timeout=10,
    )

    # ── 5) CROSS-DOMAIN REPORTIN RESTORATION ─────────────────────────
    _p("5) POST /reports (ReportIn still in server.py)")
    # Grab a real spot_id
    r = requests.get(f"{BASE}/spots?limit=1", timeout=10)
    spot_id = None
    if r.status_code == 200:
        js = r.json()
        items = js if isinstance(js, list) else js.get("items") or []
        if items:
            spot_id = items[0].get("spot_id")
    _chk(bool(spot_id), f"fetched a real spot_id for /reports cross-check (got {spot_id})")
    if spot_id:
        r = requests.post(
            f"{BASE}/reports",
            json={"target_type": "spot", "target_id": spot_id, "reason": "misinfo"},
            headers=_auth(u2_tok),
            timeout=10,
        )
        # 200 OK or 400 if body shape differs; MUST NOT 500
        _chk(r.status_code != 500, f"/reports with ReportIn did NOT 500 (got {r.status_code}) body={r.text[:200]}")
        _chk(r.status_code in (200, 400), f"/reports -> 200 or 400 (got {r.status_code})")

    # ── 6) NON-REGRESSION SMOKE ────────────────────────────────────
    _p("6) NON-REGRESSION smoke (prior phases must still work)")
    ah = _auth(admin_tok)

    probes = [
        ("/auth/me", True),
        ("/feed/home", True),
        ("/spots?limit=5", False),
        ("/marketplace/storefront", False),
        ("/admin/overview", True),
        ("/referrals", False),
        ("/referrals/rails", False),
        ("/dm/threads", True),
        ("/me/notification-preferences", True),
        ("/notifications?limit=3", True),
        ("/me/viewers?limit=3", True),
        ("/me/spots", True),
        ("/me/saved", True),
        ("/me/collections", True),
    ]
    for path, need_auth in probes:
        hdr = ah if need_auth else {}
        try:
            r = requests.get(f"{BASE}{path}", headers=hdr, timeout=15)
            ok = r.status_code == 200
            _chk(ok, f"GET {path} -> 200 (got {r.status_code})")
            if not ok:
                print(f"    body: {r.text[:180]}")
        except Exception as e:
            _chk(False, f"GET {path} raised {type(e).__name__}: {e}")

    # ── 7) PERMISSION SANITY ────────────────────────────────────────
    _p("7) Permission sanity (/me/* unauth, report unauth)")
    unauth_probes = [
        "/me/recent-locations",
        "/me/drafts",
        "/me/trends?days=7",
        "/me/dashboard",
        "/me/packs",
        "/me/reviews-received",
        "/me/upgrade",  # POST
    ]
    for p in unauth_probes:
        if p == "/me/upgrade":
            r = requests.post(f"{BASE}{p}", json={"plan": "pro"}, timeout=10)
        else:
            r = requests.get(f"{BASE}{p}", timeout=10)
        _chk(r.status_code in (401, 403), f"unauth {p} -> 401/403 (got {r.status_code})")

    # ── REPORT ──────────────────────────────────────────────────────
    print("\n══════════════ SUMMARY ══════════════")
    print(f"  PASS: {len(PASSES)}")
    print(f"  FAIL: {len(FAILS)}")
    if FAILS:
        print("\nFAILURES:")
        for f in FAILS:
            print(f"  - {f}")
    return 0 if not FAILS else 1


if __name__ == "__main__":
    sys.exit(main())
