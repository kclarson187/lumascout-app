"""
backend_test_super_admin.py

Comprehensive backend QA + super-admin destructive endpoint validation.

Covers (per review plan):
  1) DELETE /api/admin/spots/{spot_id}  — hard delete + archive + cascade
  2) DELETE /api/admin/users/{user_id}  — soft delete + anonymize
  3) GET    /api/admin/deleted-spots / deleted-users archives
  4) Auth gate — deleted users rejected
  5) Regression sweep
  6) Permission matrix admin vs super_admin
  7) Audit log readability
"""

import os
import sys
import time
import uuid
import json
import requests

BASE_URL = "https://photo-finder-60.preview.emergentagent.com"
API = BASE_URL + "/api"

ADMIN_EMAIL = "admin@photoscout.app"
ADMIN_PASSWORD = "admin123"
SOPHIE_EMAIL = "sophie@photoscout.app"
SOPHIE_PASSWORD = "demo123"
MARCO_EMAIL = "marco@photoscout.app"
MARCO_PASSWORD = "demo123"

PASS, FAIL = [], []


def _log_pass(msg):
    print(f"  ✅ PASS  {msg}")
    PASS.append(msg)


def _log_fail(msg, extra=""):
    print(f"  ❌ FAIL  {msg}  {extra}")
    FAIL.append(f"{msg}  {extra}")


def assert_eq(actual, expected, label):
    if actual == expected:
        _log_pass(f"{label}: got {actual!r}")
        return True
    _log_fail(label, f"expected={expected!r} got={actual!r}")
    return False


def assert_true(cond, label, extra=""):
    if cond:
        _log_pass(label)
        return True
    _log_fail(label, extra)
    return False


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
    if r.status_code != 200:
        print(f"!! login failed for {email}: {r.status_code} {r.text[:200]}")
        return None, None
    data = r.json()
    return data["token"], data["user"]


def register(email, pw, name):
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": pw, "name": name},
        timeout=15,
    )
    if r.status_code != 200:
        print(f"!! register failed for {email}: {r.status_code} {r.text[:200]}")
        return None, None
    data = r.json()
    return data["token"], data["user"]


def section(title):
    print()
    print("=" * 70)
    print(title)
    print("=" * 70)


# ============================================================
# Setup: log in the three seeded accounts
# ============================================================
section("0. AUTH — log in seeded accounts")

admin_tok, admin_u = login(ADMIN_EMAIL, ADMIN_PASSWORD)
assert_true(admin_tok is not None, "admin login succeeds")
if admin_tok:
    assert_eq(admin_u.get("role"), "super_admin", "admin is super_admin")

sophie_tok, sophie_u = login(SOPHIE_EMAIL, SOPHIE_PASSWORD)
assert_true(sophie_tok is not None, "sophie login succeeds")

marco_tok, marco_u = login(MARCO_EMAIL, MARCO_PASSWORD)
assert_true(marco_tok is not None, "marco login succeeds")

if not (admin_tok and sophie_tok):
    print("Fatal: seed accounts not usable, aborting.")
    sys.exit(1)


# ============================================================
# 1. SUPER-ADMIN SPOT DELETE
# ============================================================
section("1. DELETE /api/admin/spots/{spot_id} — super admin only")

# (a) sophie (user) gets 403 on a bogus id (gate must trigger before lookup)
r = requests.delete(
    f"{API}/admin/spots/fake_spot_xyz",
    headers=H(sophie_tok),
    json={"reason_code": "spam"},
    timeout=10,
)
assert_eq(r.status_code, 403, "1a sophie(user) DELETE /admin/spots → 403")

# (b) super_admin bogus id → 404
r = requests.delete(
    f"{API}/admin/spots/spt_DOES_NOT_EXIST",
    headers=H(admin_tok),
    json={"reason_code": "spam"},
    timeout=10,
)
assert_eq(r.status_code, 404, "1b super_admin bogus spot → 404")

# Need a real disposable spot owned by sophie. Create one first.
make_spot = {
    "title": f"QA Disposable Spot {uuid.uuid4().hex[:6]}",
    "description": "Temp spot for super-admin delete QA",
    "latitude": 30.2672,
    "longitude": -97.7431,
    "city": "Austin",
    "state": "TX",
    "country": "USA",
    "privacy_mode": "private",  # private so it never shows in main feed
    "tags": ["qa"],
    "access_difficulty": "easy",
    "parking_info": "street",
    "best_season": "spring",
    "best_time_of_day": "morning",
    "photo_tips": "qa",
    "images": [],
    "save_as_draft": False,
}
r = requests.post(f"{API}/spots", headers=H(sophie_tok), json=make_spot, timeout=15)
assert_eq(r.status_code, 200, "1c helper: sophie creates disposable spot")
disp_spot_id = r.json().get("spot_id") if r.status_code == 200 else None
if not disp_spot_id:
    print("Could not create disposable spot; dumping:", r.text[:400])

# Seed side-effects: sophie saves it, marco saves it, marco reviews it, sophie adds to a collection, make a community post referencing it.
if disp_spot_id:
    # sophie save
    requests.post(f"{API}/spots/{disp_spot_id}/save", headers=H(sophie_tok), timeout=10)
    # marco save
    requests.post(f"{API}/spots/{disp_spot_id}/save", headers=H(marco_tok), timeout=10)
    # marco review
    r_rev = requests.post(
        f"{API}/spots/{disp_spot_id}/reviews",
        headers=H(marco_tok),
        json={"overall_rating": 4, "review_body": "QA temp review"},
        timeout=10,
    )
    # create a collection owned by sophie + add the disposable spot
    r_col = requests.post(
        f"{API}/collections",
        headers=H(sophie_tok),
        json={"name": f"QA Delete Col {uuid.uuid4().hex[:4]}", "privacy_mode": "private"},
        timeout=10,
    )
    col_id = r_col.json().get("collection_id") if r_col.status_code == 200 else None
    if col_id:
        requests.post(
            f"{API}/collections/{col_id}/spots",
            headers=H(sophie_tok),
            json={"spot_id": disp_spot_id},
            timeout=10,
        )
    # community post that references the spot
    r_post = requests.post(
        f"{API}/posts",
        headers=H(sophie_tok),
        json={
            "category": "tip",
            "title": f"QA Linked Post {uuid.uuid4().hex[:4]}",
            "body": "Temp post referencing QA disposable spot",
            "spot_id": disp_spot_id,
        },
        timeout=10,
    )
    linked_post_id = r_post.json().get("post_id") if r_post.status_code == 200 else None

# Record archive count before
r = requests.get(f"{API}/admin/deleted-spots", headers=H(admin_tok), timeout=10)
deleted_spots_before = r.json().get("count", 0) if r.status_code == 200 else -1

# (c) Real DELETE as super_admin with reason
if disp_spot_id:
    r = requests.delete(
        f"{API}/admin/spots/{disp_spot_id}",
        headers=H(admin_tok),
        json={"reason_code": "spam", "reason_note": "QA super-admin delete"},
        timeout=15,
    )
    ok = assert_eq(r.status_code, 200, "1c DELETE spot as super_admin → 200")
    if ok:
        data = r.json()
        assert_eq(data.get("ok"), True, "1c response.ok")
        assert_eq(data.get("spot_id"), disp_spot_id, "1c response.spot_id matches")
        assert_true(
            str(data.get("archive_id", "")).startswith("delspot_"),
            "1c archive_id starts delspot_",
            f"got={data.get('archive_id')!r}",
        )
        assert_eq(data.get("strategy"), "hard_delete_with_archive", "1c strategy")
        cascade = data.get("cascade") or {}
        for key in (
            "spot_saves",
            "spot_reviews",
            "spot_checkins",
            "reports",
            "collections_updated",
            "posts_unlinked",
            "packs_updated",
        ):
            assert_true(key in cascade, f"1c cascade has `{key}`")
        assert_true(
            cascade.get("spot_saves", 0) >= 2,
            "1c cascade.spot_saves >=2 (sophie + marco)",
            f"got={cascade.get('spot_saves')}",
        )
        assert_true(
            cascade.get("spot_reviews", 0) >= 1,
            "1c cascade.spot_reviews >=1 (marco)",
            f"got={cascade.get('spot_reviews')}",
        )
        assert_true(
            cascade.get("collections_updated", 0) >= 1,
            "1c cascade.collections_updated >=1",
        )
        # Note: POST /posts handler does NOT persist a spot_id field from the input
        # body (server.py create_post only saves image_url/city/state/etc., not spot_id).
        # So exercising posts_unlinked via the public API isn't possible today. We just
        # verify the cascade key is reported as an int >= 0.
        assert_true(
            isinstance(cascade.get("posts_unlinked"), int) and cascade.get("posts_unlinked", -1) >= 0,
            "1c cascade.posts_unlinked is int >= 0",
            f"got={cascade.get('posts_unlinked')!r}",
        )

        # After: spot is gone, archive exists, post unlinked
        r2 = requests.get(f"{API}/spots/{disp_spot_id}", headers=H(sophie_tok), timeout=10)
        assert_eq(r2.status_code, 404, "1c after: GET deleted spot → 404")

        r3 = requests.get(f"{API}/admin/deleted-spots", headers=H(admin_tok), timeout=10)
        if r3.status_code == 200:
            new_count = r3.json().get("count", 0)
            assert_true(
                new_count == deleted_spots_before + 1,
                "1c deleted_spots archive grew by 1",
                f"before={deleted_spots_before} after={new_count}",
            )
            archive_ids = [it.get("archive_id") for it in r3.json().get("items", [])]
            assert_true(
                data.get("archive_id") in archive_ids,
                "1c new archive_id present in /deleted-spots",
            )

        # Verify community post.spot_id was nulled
        if linked_post_id:
            r4 = requests.get(f"{API}/posts/{linked_post_id}", headers=H(sophie_tok), timeout=10)
            if r4.status_code == 200:
                assert_true(
                    r4.json().get("spot_id") in (None, ""),
                    "1c linked community post.spot_id nulled",
                    f"got={r4.json().get('spot_id')!r}",
                )

        # Audit log
        r5 = requests.get(
            f"{API}/admin/audit-logs",
            headers=H(admin_tok),
            params={"action": "spot.delete_hard", "target_id": disp_spot_id},
            timeout=10,
        )
        if r5.status_code == 200:
            items = r5.json().get("items", [])
            assert_true(len(items) >= 1, "1c audit log entry exists for spot.delete_hard")
            if items:
                e = items[0]
                assert_eq(e.get("action"), "spot.delete_hard", "1c audit.action")
                assert_eq(e.get("target_type"), "spot", "1c audit.target_type")
                assert_eq(e.get("target_id"), disp_spot_id, "1c audit.target_id")
                notes = e.get("notes") or ""
                assert_true(
                    notes.startswith("[SUPER ADMIN] Hard-deleted spot"),
                    "1c audit.notes starts with [SUPER ADMIN] Hard-deleted spot",
                    f"notes={notes!r}",
                )
                assert_eq(e.get("admin_role"), "super_admin", "1c audit.admin_role")
                assert_true(bool(e.get("admin_email")), "1c audit.admin_email populated")
                assert_true(bool(e.get("before")), "1c audit.before populated")
                assert_true(
                    bool(e.get("after") and e["after"].get("archive_id")),
                    "1c audit.after has archive_id",
                )

# (d) Invalid reason_code coerces to 'other'
r_p = requests.post(f"{API}/spots", headers=H(sophie_tok), json={**make_spot, "title": f"QA Invalid Reason {uuid.uuid4().hex[:4]}"}, timeout=15)
if r_p.status_code == 200:
    sp2 = r_p.json()["spot_id"]
    r = requests.delete(
        f"{API}/admin/spots/{sp2}",
        headers=H(admin_tok),
        json={"reason_code": "totally_bogus_reason", "reason_note": "QA invalid code"},
        timeout=10,
    )
    ok = assert_eq(r.status_code, 200, "1d invalid reason_code → 200 (coerced)")
    if ok:
        assert_eq(r.json().get("reason_code"), "other", "1d reason_code coerced to 'other'")

# (e) Promote fresh user to role='admin', then retry delete → 403
section("1e. Promoted role='admin' must NOT delete spots (super only)")
fresh_email = f"qa.admin.promote.{int(time.time())}.{uuid.uuid4().hex[:4]}@example.com"
t_fresh, u_fresh = register(fresh_email, "DemoPass!234", "QA AdminPromote")
assert_true(t_fresh is not None, "1e register fresh user")
if t_fresh:
    # Super-admin promotes to role='admin'
    r = requests.patch(
        f"{API}/admin/users/{u_fresh['user_id']}",
        headers=H(admin_tok),
        json={"role": "admin", "reason": "QA promotion for permission test"},
        timeout=10,
    )
    assert_eq(r.status_code, 200, "1e super_admin promotes fresh→admin")
    # Re-login to get a fresh JWT (role is typically baked; but current role is read from DB
    # on each request via get_current_user, so existing token should still work).
    # We'll keep t_fresh and just call the delete endpoint.
    r_p2 = requests.post(f"{API}/spots", headers=H(sophie_tok), json={**make_spot, "title": f"QA Shield {uuid.uuid4().hex[:4]}"}, timeout=15)
    if r_p2.status_code == 200:
        shield_spot = r_p2.json()["spot_id"]
        r = requests.delete(
            f"{API}/admin/spots/{shield_spot}",
            headers=H(t_fresh),
            json={"reason_code": "spam"},
            timeout=10,
        )
        assert_eq(r.status_code, 403, "1e role=admin DELETE spot → 403 (super only)")
        # Cleanup via super_admin
        requests.delete(f"{API}/admin/spots/{shield_spot}", headers=H(admin_tok), json={"reason_code": "other"}, timeout=10)


# ============================================================
# 2. SUPER-ADMIN USER DELETE
# ============================================================
section("2. DELETE /api/admin/users/{user_id} — super admin only")

# (a) sophie → 403
r = requests.delete(
    f"{API}/admin/users/{marco_u['user_id']}",
    headers=H(sophie_tok),
    json={"reason_code": "spam"},
    timeout=10,
)
assert_eq(r.status_code, 403, "2a sophie(user) DELETE /admin/users → 403")

# (b) super_admin bogus user id → 404
r = requests.delete(
    f"{API}/admin/users/user_DOES_NOT_EXIST",
    headers=H(admin_tok),
    json={"reason_code": "spam"},
    timeout=10,
)
assert_eq(r.status_code, 404, "2b bogus user id → 404")

# (c) super_admin deleting self → 400
r = requests.delete(
    f"{API}/admin/users/{admin_u['user_id']}",
    headers=H(admin_tok),
    json={"reason_code": "spam"},
    timeout=10,
)
assert_eq(r.status_code, 400, "2c self-delete → 400")

# (d) super_admin cannot delete another super_admin
# Create a fresh user, promote to super_admin via PATCH, try delete, expect 400, then demote.
second_super_email = f"qa.second.super.{int(time.time())}.{uuid.uuid4().hex[:4]}@example.com"
t_s, u_s = register(second_super_email, "DemoPass!234", "QA SecondSuper")
if t_s:
    r = requests.patch(
        f"{API}/admin/users/{u_s['user_id']}",
        headers=H(admin_tok),
        json={"role": "super_admin", "reason": "QA second super"},
        timeout=10,
    )
    promoted_super = r.status_code == 200
    assert_true(promoted_super, "2d promote fresh user → super_admin")
    if promoted_super:
        r = requests.delete(
            f"{API}/admin/users/{u_s['user_id']}",
            headers=H(admin_tok),
            json={"reason_code": "spam"},
            timeout=10,
        )
        assert_eq(r.status_code, 400, "2d delete another super_admin → 400")
        # Demote back to user
        requests.patch(
            f"{API}/admin/users/{u_s['user_id']}",
            headers=H(admin_tok),
            json={"role": "user", "reason": "QA demote"},
            timeout=10,
        )

# (e) Happy path: throwaway signup, delete, verify everything
throwaway_email = f"qa_delete_{int(time.time())}_{uuid.uuid4().hex[:4]}@example.com"
throwaway_pw = "DemoPass!234"
t_tw, u_tw = register(throwaway_email, throwaway_pw, "QA DeleteMe")
assert_true(t_tw is not None, "2e register throwaway user")
if t_tw:
    # Capture deleted-users archive count before
    r_prev = requests.get(f"{API}/admin/deleted-users", headers=H(admin_tok), timeout=10)
    dusers_before = r_prev.json().get("count", 0) if r_prev.status_code == 200 else -1

    r = requests.delete(
        f"{API}/admin/users/{u_tw['user_id']}",
        headers=H(admin_tok),
        json={"reason_code": "spam_network", "reason_note": "QA soft-delete test"},
        timeout=15,
    )
    ok = assert_eq(r.status_code, 200, "2e delete throwaway → 200")
    if ok:
        data = r.json()
        assert_eq(data.get("ok"), True, "2e response.ok")
        assert_eq(data.get("user_id"), u_tw["user_id"], "2e response.user_id")
        assert_eq(data.get("strategy"), "soft_delete_anonymize", "2e strategy")
        assert_true(
            str(data.get("archive_id", "")).startswith("deluser_"),
            "2e archive_id starts deluser_",
            f"got={data.get('archive_id')!r}",
        )
        assert_true("stripe_cancelled" in data, "2e response has stripe_cancelled flag")
        assert_true(isinstance(data.get("cascade"), dict), "2e response.cascade is dict")

        # GET /api/users/{id} shows anonymized fields
        r2 = requests.get(f"{API}/users/{u_tw['user_id']}", headers=H(admin_tok), timeout=10)
        if r2.status_code == 200:
            ud = r2.json()
            assert_eq(ud.get("deleted"), True, "2e user.deleted=true")
            assert_eq(ud.get("status"), "deleted", "2e user.status=deleted")
            assert_true(
                str(ud.get("email", "")).startswith("deleted+"),
                "2e user.email anonymized",
                f"got={ud.get('email')!r}",
            )
            assert_true(
                str(ud.get("username", "")).startswith("deleted_user_"),
                "2e user.username anonymized",
                f"got={ud.get('username')!r}",
            )
            assert_eq(ud.get("name"), "Deleted user", "2e user.name='Deleted user'")
            assert_true(ud.get("avatar_url") in (None, ""), "2e avatar_url cleared")
            assert_true("password_hash" not in ud or ud.get("password_hash") in (None, ""), "2e password_hash wiped")

        # Login with original credentials → 401
        r3 = requests.post(f"{API}/auth/login", json={"email": throwaway_email, "password": throwaway_pw}, timeout=10)
        assert_eq(r3.status_code, 401, "2e original credentials → 401 (deleted)")

        # Old JWT should also be rejected (deleted user gate in get_current_user)
        r4 = requests.get(f"{API}/auth/me", headers=H(t_tw), timeout=10)
        assert_eq(r4.status_code, 401, "2e old JWT on /auth/me → 401 (deleted gate)")

        # deleted-users archive listing
        r5 = requests.get(f"{API}/admin/deleted-users", headers=H(admin_tok), timeout=10)
        if r5.status_code == 200:
            d5 = r5.json()
            new_count = d5.get("count", 0)
            assert_true(
                new_count == dusers_before + 1,
                "2e deleted_users archive grew by 1",
                f"before={dusers_before} after={new_count}",
            )
            found = False
            for it in d5.get("items", []):
                if it.get("archive_id") == data.get("archive_id"):
                    found = True
                    assert_eq(it.get("original_email"), throwaway_email, "2e archive.original_email")
                    assert_true(bool(it.get("original_username")), "2e archive has original_username")
                    break
            assert_true(found, "2e archive_id present in /deleted-users")

        # Audit log: user.delete_soft
        r6 = requests.get(
            f"{API}/admin/audit-logs",
            headers=H(admin_tok),
            params={"action": "user.delete_soft", "target_id": u_tw["user_id"]},
            timeout=10,
        )
        if r6.status_code == 200:
            items = r6.json().get("items", [])
            assert_true(len(items) >= 1, "2e audit log entry exists for user.delete_soft")
            if items:
                e = items[0]
                assert_eq(e.get("admin_role"), "super_admin", "2e audit.admin_role")
                assert_true(bool(e.get("admin_email")), "2e audit.admin_email populated")
                assert_eq(e.get("target_type"), "user", "2e audit.target_type")
                assert_eq(e.get("target_id"), u_tw["user_id"], "2e audit.target_id")
                notes = e.get("notes") or ""
                assert_true(
                    notes.startswith("[SUPER ADMIN] Soft-deleted user @"),
                    "2e audit.notes starts with [SUPER ADMIN] Soft-deleted user @",
                    f"notes={notes!r}",
                )
                assert_true(bool(e.get("before")), "2e audit.before populated")
                assert_true(
                    bool(e.get("after") and e["after"].get("archive_id")),
                    "2e audit.after has archive_id",
                )

        # (f) Re-delete → 400
        r7 = requests.delete(
            f"{API}/admin/users/{u_tw['user_id']}",
            headers=H(admin_tok),
            json={"reason_code": "spam"},
            timeout=10,
        )
        assert_eq(r7.status_code, 400, "2f re-delete already-deleted user → 400")

# (g) role='admin' token from step 1e cannot delete users
if t_fresh:
    r = requests.delete(
        f"{API}/admin/users/{marco_u['user_id']}",
        headers=H(t_fresh),
        json={"reason_code": "spam"},
        timeout=10,
    )
    assert_eq(r.status_code, 403, "2g role=admin DELETE user → 403 (super only)")


# ============================================================
# 3. ARCHIVES
# ============================================================
section("3. Archives — GET /deleted-spots, /deleted-users")

r = requests.get(f"{API}/admin/deleted-spots", headers=H(admin_tok), timeout=10)
assert_eq(r.status_code, 200, "3 GET /deleted-spots as super_admin → 200")
if r.status_code == 200:
    assert_true(isinstance(r.json().get("items"), list), "3 deleted-spots items is list")
r = requests.get(f"{API}/admin/deleted-spots", headers=H(sophie_tok), timeout=10)
assert_eq(r.status_code, 403, "3 GET /deleted-spots as sophie → 403")

r = requests.get(f"{API}/admin/deleted-users", headers=H(admin_tok), timeout=10)
assert_eq(r.status_code, 200, "3 GET /deleted-users as super_admin → 200")
r = requests.get(f"{API}/admin/deleted-users", headers=H(sophie_tok), timeout=10)
assert_eq(r.status_code, 403, "3 GET /deleted-users as sophie → 403")

# Also confirm role='admin' cannot access archives
if t_fresh:
    r = requests.get(f"{API}/admin/deleted-spots", headers=H(t_fresh), timeout=10)
    assert_eq(r.status_code, 403, "3 role=admin GET /deleted-spots → 403")
    r = requests.get(f"{API}/admin/deleted-users", headers=H(t_fresh), timeout=10)
    assert_eq(r.status_code, 403, "3 role=admin GET /deleted-users → 403")


# ============================================================
# 4. AUTH GATES REGRESSION
# ============================================================
section("4. Regular login + /auth/me still work for all three roles")

for email, pw, label in [
    (ADMIN_EMAIL, ADMIN_PASSWORD, "admin (super)"),
    (SOPHIE_EMAIL, SOPHIE_PASSWORD, "sophie (pro user)"),
    (MARCO_EMAIL, MARCO_PASSWORD, "marco (free user)"),
]:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=10)
    assert_eq(r.status_code, 200, f"4 login {label}")
    if r.status_code == 200:
        tok = r.json()["token"]
        r2 = requests.get(f"{API}/auth/me", headers=H(tok), timeout=10)
        assert_eq(r2.status_code, 200, f"4 /auth/me {label}")


# ============================================================
# 5. REGRESSION SWEEP
# ============================================================
section("5. Regression sweep — core surfaces still healthy")

# (a) signup a fresh random user — note endpoint is /auth/register, not /auth/signup
fresh_email = f"qa.regression.{int(time.time())}.{uuid.uuid4().hex[:4]}@example.com"
r = requests.post(
    f"{API}/auth/register",
    json={"email": fresh_email, "password": "DemoPass!234", "name": "QA Regression"},
    timeout=10,
)
assert_eq(r.status_code, 200, "5 POST /auth/register → 200")
tok_new = r.json().get("token") if r.status_code == 200 else None

# (b) login sophie
r = requests.post(f"{API}/auth/login", json={"email": SOPHIE_EMAIL, "password": SOPHIE_PASSWORD}, timeout=10)
assert_eq(r.status_code, 200, "5 POST /auth/login (sophie) → 200")
sophie_tok = r.json()["token"]

# (c) spots list
r = requests.get(f"{API}/spots", headers=H(sophie_tok), params={"limit": 10}, timeout=10)
assert_eq(r.status_code, 200, "5 GET /spots?limit=10 → 200")
items = (r.json() or {}).get("items", []) if isinstance(r.json(), dict) else r.json()
sample_spot_id = None
if items:
    # r.json() can be a list or dict with items; handle both
    if isinstance(r.json(), list):
        items = r.json()
    for it in items:
        if it.get("spot_id") and it.get("visibility_status") == "active":
            sample_spot_id = it["spot_id"]
            break
    if not sample_spot_id and items:
        sample_spot_id = items[0].get("spot_id")

# (d) spot detail
if sample_spot_id:
    r = requests.get(f"{API}/spots/{sample_spot_id}", headers=H(sophie_tok), timeout=10)
    assert_eq(r.status_code, 200, f"5 GET /spots/{sample_spot_id} → 200")

    # (e) save toggle
    r = requests.post(f"{API}/spots/{sample_spot_id}/save", headers=H(sophie_tok), timeout=10)
    assert_eq(r.status_code, 200, "5 POST /spots/{id}/save (toggle on) → 200")
    r = requests.post(f"{API}/spots/{sample_spot_id}/save", headers=H(sophie_tok), timeout=10)
    assert_eq(r.status_code, 200, "5 POST /spots/{id}/save (toggle off) → 200")

# (f) collections
r = requests.get(f"{API}/me/collections", headers=H(sophie_tok), timeout=10)
assert_eq(r.status_code, 200, "5 GET /me/collections → 200")

# (g) feed/home
r = requests.get(f"{API}/feed/home", headers=H(sophie_tok), timeout=10)
assert_eq(r.status_code, 200, "5 GET /feed/home → 200")

# (h) community posts (endpoint is /api/posts, NOT /api/community/posts)
r = requests.get(f"{API}/posts", headers=H(sophie_tok), timeout=10)
assert_eq(r.status_code, 200, "5 GET /posts → 200 (community feed)")

# (i) create a short community post
r = requests.post(
    f"{API}/posts",
    headers=H(sophie_tok),
    json={"category": "tip", "title": "QA Reg Post", "body": "Short body for regression sweep."},
    timeout=10,
)
assert_eq(r.status_code, 200, "5 POST /posts → 200")
reg_post_id = r.json().get("post_id") if r.status_code == 200 else None
if reg_post_id:
    # cleanup
    requests.delete(f"{API}/posts/{reg_post_id}", headers=H(sophie_tok), timeout=10)

# (j) support faqs (public)
r = requests.get(f"{API}/support/faqs", timeout=10)
assert_eq(r.status_code, 200, "5 GET /support/faqs (public) → 200")

# (k) support ticket
r = requests.post(
    f"{API}/support/tickets",
    headers=H(sophie_tok),
    json={"subject": "QA Regression Ticket", "body": "Testing after super-admin refactor", "category": "general"},
    timeout=10,
)
assert_eq(r.status_code, 200, "5 POST /support/tickets → 200")

# (l-p) admin endpoints
for path in ["/admin/overview", "/admin/pending", "/admin/reports", "/admin/audit-logs", "/admin/users"]:
    r = requests.get(f"{API}{path}", headers=H(admin_tok), timeout=10)
    assert_eq(r.status_code, 200, f"5 GET {path} as super_admin → 200")

# (q) ai/chat
r = requests.post(
    f"{API}/ai/chat",
    headers=H(sophie_tok),
    json={"messages": [{"role": "user", "content": "Hi Scout, give me 1 tip for golden hour."}]},
    timeout=60,
)
assert_eq(r.status_code, 200, "5 POST /ai/chat as sophie → 200")

# (r) billing checkout
r = requests.post(
    f"{API}/billing/checkout",
    headers=H(sophie_tok),
    json={"plan": "pro", "interval": "monthly"},
    timeout=30,
)
if assert_eq(r.status_code, 200, "5 POST /billing/checkout {plan:pro} → 200"):
    url = r.json().get("url") or r.json().get("checkout_url")
    assert_true(
        isinstance(url, str) and url.startswith("https://checkout.stripe.com/"),
        "5 checkout url is a real stripe URL",
        f"got={url!r}",
    )

# (s) billing status
r = requests.get(f"{API}/billing/status", headers=H(sophie_tok), timeout=30)
assert_eq(r.status_code, 200, "5 GET /billing/status → 200")


# ============================================================
# 6. PERMISSION MATRIX
# ============================================================
section("6. Permission matrix — admin vs super_admin")

# We need a real spot_id and user_id for the matrix checks. Use sophie's profile
# and the first active spot from the feed.
r = requests.get(f"{API}/spots", headers=H(sophie_tok), params={"limit": 1}, timeout=10)
first_spot = None
if r.status_code == 200:
    data = r.json()
    items = data.get("items", []) if isinstance(data, dict) else data
    if items:
        first_spot = items[0].get("spot_id")

# sophie (user) → POST /admin/spots/{id}/approve → 403
if first_spot:
    r = requests.post(f"{API}/admin/spots/{first_spot}/approve", headers=H(sophie_tok), timeout=10)
    assert_eq(r.status_code, 403, "6 sophie POST /admin/spots/{id}/approve → 403")

# sophie → DELETE /admin/spots/{id} → 403
if first_spot:
    r = requests.delete(
        f"{API}/admin/spots/{first_spot}",
        headers=H(sophie_tok),
        json={"reason_code": "spam"},
        timeout=10,
    )
    assert_eq(r.status_code, 403, "6 sophie DELETE /admin/spots/{id} → 403")

# sophie → DELETE /admin/users/{id} → 403
r = requests.delete(
    f"{API}/admin/users/{marco_u['user_id']}",
    headers=H(sophie_tok),
    json={"reason_code": "spam"},
    timeout=10,
)
assert_eq(r.status_code, 403, "6 sophie DELETE /admin/users/{id} → 403")

# sophie → PATCH /admin/users/{id} → 403
r = requests.patch(
    f"{API}/admin/users/{marco_u['user_id']}",
    headers=H(sophie_tok),
    json={"plan": "pro"},
    timeout=10,
)
assert_eq(r.status_code, 403, "6 sophie PATCH /admin/users/{id} → 403")

# role='admin' (t_fresh) cannot use super-admin-only endpoints
if t_fresh:
    # DELETE spot → 403 (already covered in 1e for a new shield, do a quick repeat
    # without actually deleting anything by using bogus id — gate fires first).
    r = requests.delete(
        f"{API}/admin/spots/fake_spot_abc",
        headers=H(t_fresh),
        json={"reason_code": "spam"},
        timeout=10,
    )
    assert_eq(r.status_code, 403, "6 role=admin DELETE /admin/spots → 403")
    r = requests.delete(
        f"{API}/admin/users/user_fake_abc",
        headers=H(t_fresh),
        json={"reason_code": "spam"},
        timeout=10,
    )
    assert_eq(r.status_code, 403, "6 role=admin DELETE /admin/users → 403")

    # role='admin' CAN still access shared admin endpoints
    for path in ["/admin/overview", "/admin/pending", "/admin/reports", "/admin/audit-logs", "/admin/users"]:
        r = requests.get(f"{API}{path}", headers=H(t_fresh), timeout=10)
        assert_eq(r.status_code, 200, f"6 role=admin GET {path} → 200 (shared)")


# ============================================================
# 7. AUDIT LOG READABILITY
# ============================================================
section("7. Audit log readability — spot.delete_hard + user.delete_soft")

for action in ("spot.delete_hard", "user.delete_soft"):
    r = requests.get(
        f"{API}/admin/audit-logs",
        headers=H(admin_tok),
        params={"action": action, "limit": 5},
        timeout=10,
    )
    if assert_eq(r.status_code, 200, f"7 GET /admin/audit-logs?action={action} → 200"):
        items = r.json().get("items", [])
        assert_true(len(items) >= 1, f"7 at least one entry for action={action}")
        if items:
            e = items[0]
            # admin_email populated
            assert_true(bool(e.get("admin_email")), f"7 {action} admin_email populated")
            # admin_role == super_admin
            assert_eq(e.get("admin_role"), "super_admin", f"7 {action} admin_role=super_admin")
            # target populated
            assert_true(bool(e.get("target_type")) and bool(e.get("target_id")), f"7 {action} target populated")
            # notes starts with right prefix
            notes = e.get("notes") or ""
            if action == "spot.delete_hard":
                assert_true(
                    notes.startswith("[SUPER ADMIN] Hard-deleted spot"),
                    f"7 {action} notes readable prefix",
                    f"notes={notes!r}",
                )
            else:
                assert_true(
                    notes.startswith("[SUPER ADMIN] Soft-deleted user @"),
                    f"7 {action} notes readable prefix",
                    f"notes={notes!r}",
                )
            # before has identifying info
            before = e.get("before") or {}
            if action == "spot.delete_hard":
                assert_true("title" in before, "7 spot.delete_hard before has title")
            else:
                assert_true("username" in before, "7 user.delete_soft before has username")
            after = e.get("after") or {}
            assert_true(
                bool(after.get("archive_id")),
                f"7 {action} after has archive_id",
                f"after={after}",
            )


# ============================================================
# Summary
# ============================================================
print()
print("=" * 70)
print(f"RESULTS: PASS={len(PASS)}  FAIL={len(FAIL)}")
print("=" * 70)
if FAIL:
    print("FAILED ASSERTIONS:")
    for f in FAIL:
        print(f"  - {f}")
    sys.exit(1)
else:
    print("All super-admin + regression assertions passed.")
    sys.exit(0)
