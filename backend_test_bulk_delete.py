"""
Focused backend test for POST /api/admin/users/bulk-delete
Super-admin-only destructive endpoint.
"""
import os
import sys
import time
import uuid
import json
import requests

BACKEND_URL = "https://photo-finder-60.preview.emergentagent.com"
API = f"{BACKEND_URL}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

# Track results
PASSED = []
FAILED = []


def ok(msg):
    PASSED.append(msg)
    print(f"  PASS: {msg}")


def fail(msg):
    FAILED.append(msg)
    print(f"  FAIL: {msg}")


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"login failed for {email}: {r.status_code} {r.text}")
    j = r.json()
    return j["token"], j["user"]


def register(email, password, name):
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": name},
        timeout=20,
    )
    if r.status_code != 200:
        raise RuntimeError(f"register failed for {email}: {r.status_code} {r.text}")
    j = r.json()
    return j["token"], j["user"]


def H(token):
    return {"Authorization": f"Bearer {token}"}


def section(title):
    print(f"\n=== {title} ===")


def main():
    section("0. Login as super_admin")
    admin_token, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    print(f"  super_admin user_id={admin_user['user_id']} role={admin_user.get('role')}")
    if admin_user.get("role") != "super_admin":
        fail(f"admin user is not super_admin (role={admin_user.get('role')})")
        return
    ok("super_admin logged in")

    suffix = uuid.uuid4().hex[:6]

    # ============================================================================
    # 1. Auth guard — regular user and admin role must both get 403
    # ============================================================================
    section("1. Auth guard (regular user + admin role both → 403)")

    # Create a regular user
    reg_email = f"bulk_guard_user_{suffix}@lumascout-qa.com"
    reg_token, reg_user = register(reg_email, "TestPass123!", "Guard User")
    r = requests.post(
        f"{API}/admin/users/bulk-delete",
        json={"user_ids": ["user_fake_xyz"], "reason_code": "other", "reason_note": "test"},
        headers=H(reg_token),
        timeout=20,
    )
    if r.status_code == 403:
        ok(f"regular user → 403 ({r.json().get('detail','')})")
    else:
        fail(f"regular user expected 403, got {r.status_code}: {r.text[:200]}")

    # Create an admin-role user (need to elevate via direct DB? — we use the super_admin to elevate via /api/admin/users/{id}/role if available)
    # Create user then have super_admin set their role to 'admin'
    admin_role_email = f"bulk_guard_admin_{suffix}@lumascout-qa.com"
    admin_role_token, admin_role_user = register(admin_role_email, "TestPass123!", "Admin Role User")

    # Try to elevate via available endpoint
    elevated = False
    # Try common endpoints
    for path, method, payload in [
        (f"/admin/users/{admin_role_user['user_id']}/role", "patch", {"role": "admin"}),
        (f"/admin/users/{admin_role_user['user_id']}/role", "post", {"role": "admin"}),
        (f"/admin/users/{admin_role_user['user_id']}", "patch", {"role": "admin"}),
    ]:
        try:
            fn = getattr(requests, method)
            rr = fn(f"{API}{path}", json=payload, headers=H(admin_token), timeout=15)
            if rr.status_code == 200:
                elevated = True
                print(f"  elevated via {method.upper()} {path}")
                break
        except Exception:
            pass

    if not elevated:
        # Direct DB elevate via Mongo
        try:
            from pymongo import MongoClient
            mc = MongoClient("mongodb://localhost:27017")
            mc["photoscout_database"]["users"].update_one(
                {"user_id": admin_role_user["user_id"]},
                {"$set": {"role": "admin"}},
            )
            elevated = True
            print(f"  elevated user {admin_role_user['user_id']} to admin via direct mongo")
        except Exception as e:
            print(f"  could not elevate: {e}")

    if elevated:
        # Re-login to get a fresh token (in case role baked into JWT)... actually JWT just has user_id+email; role is checked from DB. Use existing token.
        r = requests.post(
            f"{API}/admin/users/bulk-delete",
            json={"user_ids": ["user_fake_xyz"], "reason_code": "other", "reason_note": "test"},
            headers=H(admin_role_token),
            timeout=20,
        )
        if r.status_code == 403:
            ok(f"admin role → 403 ({r.json().get('detail','')})")
        else:
            fail(f"admin role expected 403, got {r.status_code}: {r.text[:200]}")
    else:
        fail("could not elevate user to admin role to test admin-vs-super_admin guard")

    # ============================================================================
    # 2. Schema validation
    # ============================================================================
    section("2. Schema validation (422s)")

    # Empty user_ids
    r = requests.post(
        f"{API}/admin/users/bulk-delete",
        json={"user_ids": [], "reason_code": "other", "reason_note": "test"},
        headers=H(admin_token),
        timeout=20,
    )
    if r.status_code == 422:
        ok("empty user_ids → 422")
    else:
        fail(f"empty user_ids expected 422, got {r.status_code}: {r.text[:200]}")

    # > 200 ids
    r = requests.post(
        f"{API}/admin/users/bulk-delete",
        json={"user_ids": [f"u_{i}" for i in range(201)], "reason_code": "other"},
        headers=H(admin_token),
        timeout=20,
    )
    if r.status_code == 422:
        ok("201 user_ids → 422")
    else:
        fail(f"201 user_ids expected 422, got {r.status_code}: {r.text[:200]}")

    # Missing user_ids
    r = requests.post(
        f"{API}/admin/users/bulk-delete",
        json={"reason_code": "other", "reason_note": "test"},
        headers=H(admin_token),
        timeout=20,
    )
    if r.status_code == 422:
        ok("missing user_ids → 422")
    else:
        fail(f"missing user_ids expected 422, got {r.status_code}: {r.text[:200]}")

    # ============================================================================
    # Capture audit_log baseline count for action='user.bulk_delete_soft'
    # ============================================================================
    audit_baseline = None
    try:
        from pymongo import MongoClient
        mc = MongoClient("mongodb://localhost:27017")
        audit_baseline = mc["photoscout_database"]["audit_logs"].count_documents(
            {"action": "user.bulk_delete_soft"}
        )
        print(f"  audit_logs baseline (user.bulk_delete_soft) = {audit_baseline}")
    except Exception as e:
        print(f"  could not read audit baseline: {e}")

    # ============================================================================
    # 3. Happy path — 3 throwaway users
    # ============================================================================
    section("3. Happy path — bulk-delete 3 throwaway users")
    throwaway_ids = []
    throwaway_emails = []
    for i in range(1, 4):
        email = f"bulk_test_{i}_{suffix}@lumascout-qa.com"
        _, u = register(email, "TestPass123!", f"Bulk Test {i}")
        throwaway_ids.append(u["user_id"])
        throwaway_emails.append(email)
    print(f"  throwaway_ids = {throwaway_ids}")

    r = requests.post(
        f"{API}/admin/users/bulk-delete",
        json={
            "user_ids": throwaway_ids,
            "reason_code": "other",
            "reason_note": "qa bulk-delete happy path",
        },
        headers=H(admin_token),
        timeout=60,
    )
    if r.status_code != 200:
        fail(f"happy path expected 200, got {r.status_code}: {r.text[:300]}")
    else:
        body = r.json()
        if body.get("ok") is True:
            ok("happy path: ok=true")
        else:
            fail(f"happy path: ok != true ({body.get('ok')})")
        if body.get("requested") == 3:
            ok("happy path: requested=3")
        else:
            fail(f"happy path: requested expected 3, got {body.get('requested')}")
        if isinstance(body.get("succeeded"), list) and len(body["succeeded"]) == 3:
            ok("happy path: succeeded.length=3")
        else:
            fail(f"happy path: succeeded length expected 3, got {len(body.get('succeeded',[]))}")
        if isinstance(body.get("failed"), list) and len(body["failed"]) == 0:
            ok("happy path: failed.length=0")
        else:
            fail(f"happy path: failed expected empty, got {body.get('failed')}")
        # archive_id on each succeeded
        all_have_archive = all(s.get("archive_id") for s in body.get("succeeded", []))
        if all_have_archive:
            ok("happy path: every succeeded has archive_id")
        else:
            fail(f"happy path: some succeeded missing archive_id: {body.get('succeeded')}")

    # Verify users were anonymized in DB
    try:
        from pymongo import MongoClient
        mc = MongoClient("mongodb://localhost:27017")
        users_col = mc["photoscout_database"]["users"]
        archive_col = mc["photoscout_database"]["deleted_users"]
        for uid in throwaway_ids:
            d = users_col.find_one({"user_id": uid})
            if not d:
                fail(f"happy path: user {uid} no longer exists in users (should be anonymized, not removed)")
                continue
            email = d.get("email", "")
            uname = d.get("username", "")
            if email.startswith("deleted+") and email.endswith("@lumascout.app"):
                ok(f"{uid}: email anonymized → {email}")
            else:
                fail(f"{uid}: email NOT anonymized → {email}")
            if uname.startswith("deleted_user_"):
                ok(f"{uid}: username anonymized → {uname}")
            else:
                fail(f"{uid}: username NOT anonymized → {uname}")
        # archive entries
        archive_count = archive_col.count_documents({"original_user_id": {"$in": throwaway_ids}})
        if archive_count == 3:
            ok(f"deleted_users archive has 3 entries for the 3 deleted users")
        else:
            fail(f"deleted_users archive expected 3 entries, got {archive_count}")
    except Exception as e:
        fail(f"DB inspection failed: {e}")

    # ============================================================================
    # 4. Partial failure — 2 valid + 2 garbage
    # ============================================================================
    section("4. Partial failure — 2 valid + 2 garbage user_ids")
    partial_ids = []
    for i in range(4, 6):
        email = f"bulk_partial_{i}_{suffix}@lumascout-qa.com"
        _, u = register(email, "TestPass123!", f"Bulk Partial {i}")
        partial_ids.append(u["user_id"])
    garbage = [f"fake-user-id-{uuid.uuid4().hex[:6]}", f"fake-user-id-{uuid.uuid4().hex[:6]}"]
    mixed = partial_ids + garbage
    r = requests.post(
        f"{API}/admin/users/bulk-delete",
        json={"user_ids": mixed, "reason_code": "other", "reason_note": "qa partial"},
        headers=H(admin_token),
        timeout=60,
    )
    if r.status_code != 200:
        fail(f"partial-failure expected 200, got {r.status_code}: {r.text[:300]}")
    else:
        body = r.json()
        if len(body.get("succeeded", [])) == 2:
            ok("partial: succeeded.length=2")
        else:
            fail(f"partial: succeeded expected 2, got {len(body.get('succeeded',[]))}: {body.get('succeeded')}")
        if len(body.get("failed", [])) == 2:
            ok("partial: failed.length=2")
        else:
            fail(f"partial: failed expected 2, got {len(body.get('failed',[]))}: {body.get('failed')}")
        if all(f.get("error") for f in body.get("failed", [])):
            ok("partial: every failed entry has error field")
        else:
            fail(f"partial: some failed entries missing error: {body.get('failed')}")

    # ============================================================================
    # 5. Self-protect — admin includes own user_id
    # ============================================================================
    section("5. Self-protect — admin includes own user_id")
    sp_email = f"bulk_self_{suffix}@lumascout-qa.com"
    _, sp_user = register(sp_email, "TestPass123!", "Bulk Self User")
    sp_ids = [sp_user["user_id"], admin_user["user_id"]]
    r = requests.post(
        f"{API}/admin/users/bulk-delete",
        json={"user_ids": sp_ids, "reason_code": "other", "reason_note": "qa self-protect"},
        headers=H(admin_token),
        timeout=60,
    )
    if r.status_code != 200:
        fail(f"self-protect expected 200, got {r.status_code}: {r.text[:300]}")
    else:
        body = r.json()
        # admin should be in failed
        admin_failed = [f for f in body.get("failed", []) if f.get("user_id") == admin_user["user_id"]]
        if admin_failed:
            err = admin_failed[0].get("error", "")
            if "Cannot delete your own account" in err:
                ok(f"self-protect: admin in failed with correct error: {err}")
            else:
                fail(f"self-protect: admin in failed but error mismatch: {err}")
        else:
            fail(f"self-protect: admin not in failed list: {body.get('failed')}")

    # Verify admin still findable + still super_admin
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    if r.status_code == 200 and r.json()["user"].get("role") == "super_admin":
        ok("self-protect: admin still logs in and role=super_admin")
    else:
        fail(f"self-protect: admin login broke! {r.status_code} {r.text[:200]}")

    # ============================================================================
    # 6. Audit log — single entry for action='user.bulk_delete_soft'
    # ============================================================================
    section("6. Audit log entry for user.bulk_delete_soft")
    if audit_baseline is None:
        fail("could not check audit_logs (no DB access at baseline)")
    else:
        try:
            from pymongo import MongoClient
            mc = MongoClient("mongodb://localhost:27017")
            current = mc["photoscout_database"]["audit_logs"].count_documents(
                {"action": "user.bulk_delete_soft"}
            )
            delta = current - audit_baseline
            # We made 3 bulk-delete calls (happy path, partial, self-protect)
            if delta == 3:
                ok(f"audit_logs: +{delta} new 'user.bulk_delete_soft' entries (1 per bulk call)")
            else:
                fail(f"audit_logs: expected +3 entries (happy/partial/self-protect), got +{delta}")
            # Inspect the most recent entry to confirm shape
            recent = list(mc["photoscout_database"]["audit_logs"].find(
                {"action": "user.bulk_delete_soft"}
            ).sort("created_at", -1).limit(1))
            if recent:
                r0 = recent[0]
                print(f"  most recent audit: target_type={r0.get('target_type')} target_id={r0.get('target_id')} notes={r0.get('notes')}")
                if r0.get("target_type") == "user" and r0.get("target_id") == "bulk":
                    ok("audit_log entry has target_type='user', target_id='bulk'")
                else:
                    fail(f"audit_log target_type/id mismatch: {r0.get('target_type')}/{r0.get('target_id')}")
        except Exception as e:
            fail(f"audit log inspection failed: {e}")

    # ============================================================================
    # Summary
    # ============================================================================
    print("\n" + "=" * 70)
    print(f"PASSED: {len(PASSED)}")
    print(f"FAILED: {len(FAILED)}")
    if FAILED:
        print("\nFailed checks:")
        for f in FAILED:
            print(f"  - {f}")
        sys.exit(1)
    print("\nAll checks passed.")
    sys.exit(0)


if __name__ == "__main__":
    main()
