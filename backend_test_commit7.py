"""
Commit 7 focused regression test.

Scope (strictly per review):
  1. Handle rename — admin@lumascout.app now @keith (not @admin)
  2. Query fix for posts_count + spots_created on /auth/me and public /users/{id}
  3. Reserved username blocking at registration (suffixed, not returned as-is)
  4. Cleanup — delete the 5 test accounts (super_admin)
  5. Non-regression smoke — /admin/users, /feed/home, /spots
"""
from __future__ import annotations
import json
import os
import sys
import uuid
import requests

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PW = "admin123"

results: list[tuple[str, bool, str]] = []
created_user_ids: list[str] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    tag = "PASS" if ok else "FAIL"
    print(f"[{tag}] {name}: {detail}")


def login(email: str, pw: str) -> dict:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, timeout=15)
    return {"status": r.status_code, "body": r.json() if r.headers.get("content-type","").startswith("application/json") else r.text}


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def snip(obj, n: int = 240) -> str:
    try:
        s = json.dumps(obj, default=str)
    except Exception:
        s = str(obj)
    return s if len(s) <= n else s[:n] + "..."


# ---------------------------------------------------------------------------
# 1. Admin login + handle rename
# ---------------------------------------------------------------------------
print("\n=== (1) Admin login + /auth/me handle rename ===")
r_login = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)
login_ok = r_login.status_code == 200 and "token" in r_login.json()
record("1a. POST /auth/login admin@lumascout.app → 200 with token",
       login_ok, f"status={r_login.status_code}, body={snip(r_login.text)}")
if not login_ok:
    print("FATAL: admin login failed — aborting test suite")
    sys.exit(1)
admin_token = r_login.json()["token"]

r_me = requests.get(f"{BASE}/auth/me", headers=auth_headers(admin_token), timeout=15)
me_ok = r_me.status_code == 200
me_body = r_me.json() if me_ok else {}
record("1b. GET /auth/me → 200", me_ok, f"status={r_me.status_code}")

uname = me_body.get("username")
record("1c. /auth/me.username == 'keith'",
       uname == "keith", f"got username={uname!r}")

name = me_body.get("name")
record("1d. /auth/me.name == 'Keith Larson'",
       name == "Keith Larson", f"got name={name!r}")

role = me_body.get("role")
record("1e. /auth/me.role == 'super_admin'",
       role == "super_admin", f"got role={role!r}")

admin_user_id = me_body.get("user_id")

# ---------------------------------------------------------------------------
# 2. Query-fix for posts_count & spots_created/spots_count
# ---------------------------------------------------------------------------
print("\n=== (2) stats.posts_count / stats.spots_created fix ===")
stats = me_body.get("stats") or {}
pc_me = stats.get("posts_count")
sc_me = stats.get("spots_created")
record("2a. /auth/me stats.posts_count >= 1",
       isinstance(pc_me, int) and pc_me >= 1,
       f"got posts_count={pc_me!r} (full stats={snip(stats)})")
record("2b. /auth/me stats.spots_created >= 5",
       isinstance(sc_me, int) and sc_me >= 5,
       f"got spots_created={sc_me!r}")

# Public profile
r_pub = requests.get(f"{BASE}/users/{admin_user_id}", headers=auth_headers(admin_token), timeout=15)
pub_ok = r_pub.status_code == 200
pub_body = r_pub.json() if pub_ok else {}
pub_stats = pub_body.get("stats") or {}
record("2c. GET /users/{admin_user_id} → 200", pub_ok, f"status={r_pub.status_code}")

pc_pub = pub_stats.get("posts_count")
# public profile has `spots` and/or `spots_count`; accept either
sc_pub = pub_stats.get("spots_count") if "spots_count" in pub_stats else pub_stats.get("spots")
sc_pub_alt_created = pub_stats.get("spots_created")
record("2d. public profile stats.posts_count >= 1",
       isinstance(pc_pub, int) and pc_pub >= 1,
       f"got posts_count={pc_pub!r} (public stats keys={list(pub_stats.keys())})")
# Accept either spots_count or spots>=5
sc_public_val = None
if isinstance(sc_pub, int):
    sc_public_val = sc_pub
elif isinstance(sc_pub_alt_created, int):
    sc_public_val = sc_pub_alt_created
record("2e. public profile spots_count (or spots/spots_created) >= 5",
       isinstance(sc_public_val, int) and sc_public_val >= 5,
       f"got spots_count_alias={sc_public_val!r}, full keys={list(pub_stats.keys())}, stats={snip(pub_stats)}")

# ---------------------------------------------------------------------------
# 3. Reserved username blocking at registration
# ---------------------------------------------------------------------------
print("\n=== (3) Reserved username blocking ===")
# Use a shared tag so we can clean up in (4)
tag = uuid.uuid4().hex[:6]

def register(localpart: str, label: str) -> tuple[int, dict]:
    # Localpart must be preserved exactly as-is so the server's
    # email.split("@")[0] gives the reserved name under test. We vary
    # the DOMAIN per run to keep emails unique across test runs.
    email = f"{localpart}@qa{tag}.example.com"
    r = requests.post(
        f"{BASE}/auth/register",
        json={"email": email, "password": "validpassword123", "name": f"QA Imposter {label}"},
        timeout=15,
    )
    try:
        body = r.json()
    except Exception:
        body = {"raw": r.text}
    return r.status_code, body

# 3a. Non-reserved baseline "tryadmin"
status, body = register("tryadmin", "tryadmin")
ok = status in (200, 201)
reg_username = (body.get("user") or {}).get("username") or body.get("username")
record("3a. register 'tryadmin' → 200/201 (non-reserved)",
       ok, f"status={status}, username={reg_username!r}, body={snip(body)}")
# Typical behaviour: returned as-is. Allow a _hex suffix too in case email-local collides.
if reg_username:
    is_plain = reg_username == "tryadmin"
    is_suffixed = reg_username.startswith("tryadmin_") and len(reg_username) <= len("tryadmin_") + 6
    record("3a'. 'tryadmin' username equals 'tryadmin' (or allowed collision-suffix)",
           is_plain or is_suffixed,
           f"got username={reg_username!r}")
    uid = (body.get("user") or {}).get("user_id") or body.get("user_id")
    if uid:
        created_user_ids.append(uid)

# 3b-3f. Reserved list: admin, support, root, scout, lumascout
reserved_cases = ["admin", "support", "root", "scout", "lumascout"]
for lp in reserved_cases:
    status, body = register(lp, lp)
    user_obj = body.get("user") or {}
    uname_out = user_obj.get("username") or body.get("username")
    uid = user_obj.get("user_id") or body.get("user_id")
    if uid:
        created_user_ids.append(uid)

    # Should succeed (not error) but username must NOT equal the reserved literal
    succeeded = status in (200, 201)
    not_equal = uname_out != lp and uname_out is not None
    starts_with = uname_out.startswith(f"{lp}_") if uname_out else False
    # suffix should be 4-char hex per spec
    suffix = uname_out[len(lp) + 1:] if (uname_out and starts_with) else ""
    hex_ok = len(suffix) == 4 and all(c in "0123456789abcdef" for c in suffix)
    overall = succeeded and not_equal and starts_with and hex_ok
    record(
        f"3. reserved '{lp}' → succeeds AND username != '{lp}' AND starts_with '{lp}_' AND 4-char hex suffix",
        overall,
        f"status={status}, username={uname_out!r}, suffix={suffix!r} hex_ok={hex_ok}",
    )

# ---------------------------------------------------------------------------
# 5. Non-regression smoke (before cleanup so we don't conflate causes)
# ---------------------------------------------------------------------------
print("\n=== (5) Non-regression smoke ===")
r = requests.get(f"{BASE}/admin/users?page=1&limit=10", headers=auth_headers(admin_token), timeout=15)
record("5a. GET /admin/users?page=1&limit=10 → 200", r.status_code == 200,
       f"status={r.status_code}, body={snip(r.text)}")

r = requests.get(f"{BASE}/feed/home", headers=auth_headers(admin_token), timeout=20)
record("5b. GET /feed/home → 200", r.status_code == 200, f"status={r.status_code}")

r = requests.get(f"{BASE}/spots?limit=5", headers=auth_headers(admin_token), timeout=15)
spots_ok = r.status_code == 200
record("5c. GET /spots?limit=5 → 200", spots_ok,
       f"status={r.status_code}, count={len(r.json()) if spots_ok and isinstance(r.json(), list) else 'n/a'}")

# ---------------------------------------------------------------------------
# 4. Cleanup — soft-delete the test accounts we created via admin API
# ---------------------------------------------------------------------------
print("\n=== (4) Cleanup — delete test accounts ===")
for uid in created_user_ids:
    r = requests.delete(
        f"{BASE}/admin/users/{uid}",
        headers=auth_headers(admin_token),
        json={"reason_code": "qa_cleanup", "reason_note": "Commit 7 regression cleanup"},
        timeout=15,
    )
    ok = r.status_code == 200
    record(f"4. DELETE /admin/users/{uid}", ok, f"status={r.status_code}, body={snip(r.text, 160)}")

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print("\n===================== SUMMARY =====================")
passed = sum(1 for _, ok, _ in results if ok)
total = len(results)
print(f"{passed}/{total} subtests PASSED")
for name, ok, detail in results:
    if not ok:
        print(f"  FAIL — {name}\n         {detail}")
print("===================================================")
sys.exit(0 if passed == total else 1)
