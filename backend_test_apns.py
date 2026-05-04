"""
APNs direct-dispatch wiring backend test (May 2026)

Covers the 12 scenarios in the review request:
  1. Login as super admin
  2. GET /api/admin/apns/status — verify config + endpoint + counts
  3. POST /api/admin/apns/test with all-zeros token → expect 403 from Apple
  4. POST /api/me/push-token (Expo)
  5. POST /api/me/push-token (APNs hex)
  6. POST /api/me/push-token auto-detect APNs
  7. POST /api/me/push-token auto-detect Expo
  8. POST /api/me/push-token invalid pair → 400
  9. POST /api/me/notifications/test-apns → 200 with per-transport list
 10. GET /api/admin/apns/status again — counts should have increased
 11. Non-admin negative tests on admin endpoints (403)
 12. DELETE /api/me/push-token cleanup
"""
import os
import json
import uuid
import requests

BACKEND_URL = "https://photo-finder-60.preview.emergentagent.com"
BASE = f"{BACKEND_URL}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

results = []

def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    results.append((status, name, detail))
    print(f"[{status}] {name}: {detail}")


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    data = r.json()
    token = data.get("access_token") or data.get("token")
    return token, data.get("user", {})


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def main():
    # ── 1. Super admin login ─────────────────────────────────────────────
    try:
        admin_token, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
        record("1. super admin login", True, f"user_id={admin_user.get('user_id')} role={admin_user.get('role')}")
    except Exception as e:
        record("1. super admin login", False, str(e))
        return

    # ── 2. GET /admin/apns/status (baseline) ─────────────────────────────
    try:
        r = requests.get(f"{BASE}/admin/apns/status", headers=auth(admin_token))
        ok = r.status_code == 200
        body = r.json() if ok else {}
        expect = {
            "configured": True,
            "key_id": "BSCF87SBA8",
            "team_id_present": True,
            "bundle_id": "app.emergent.photofinder60669d6fa1",
            "key_path": "/app/secrets/AuthKey_BSCF87SBA8.p8",
            "key_readable": True,
            "sandbox": False,
            "endpoint": "https://api.push.apple.com",
        }
        mismatches = [k for k, v in expect.items() if body.get(k) != v]
        has_counts = isinstance(body.get("registered_apns_tokens"), int) and isinstance(body.get("registered_expo_tokens"), int)
        passed = ok and not mismatches and has_counts
        record("2. GET /admin/apns/status baseline", passed,
               f"status={r.status_code} mismatches={mismatches} body={body}")
        baseline_apns = body.get("registered_apns_tokens", 0)
        baseline_expo = body.get("registered_expo_tokens", 0)
    except Exception as e:
        record("2. GET /admin/apns/status baseline", False, str(e))
        baseline_apns = baseline_expo = 0

    # ── 3. POST /admin/apns/test with all-zero token ────────────────────
    try:
        zero_tok = "0" * 64
        r = requests.post(
            f"{BASE}/admin/apns/test",
            headers=auth(admin_token),
            json={"device_token": zero_tok, "title": "t", "body": "b"},
        )
        ok = r.status_code == 200
        body = r.json() if ok else {}
        # Expected: ok:false, status:403, reason:"BadEnvironmentKeyInToken", apns_id non-empty
        checks = {
            "ok_false": body.get("ok") is False,
            "status_403": body.get("status") == 403,
            "reason_BadEnv": body.get("reason") == "BadEnvironmentKeyInToken",
            "apns_id_nonempty": bool(body.get("apns_id")),
        }
        passed = ok and all(checks.values())
        record("3. POST /admin/apns/test (zero token → 403)", passed,
               f"http={r.status_code} checks={checks} body={body}")
    except Exception as e:
        record("3. POST /admin/apns/test (zero token → 403)", False, str(e))

    # ── 4. Register an Expo token ───────────────────────────────────────
    expo_token = "ExponentPushToken[TEST_DEVICE_EXPO]"
    try:
        r = requests.post(
            f"{BASE}/me/push-token",
            headers=auth(admin_token),
            json={"token": expo_token, "platform": "ios"},
        )
        ok = r.status_code == 200
        body = r.json() if ok else {}
        passed = ok and body.get("ok") is True and body.get("token_type") == "expo"
        record("4. POST /me/push-token (Expo)", passed, f"status={r.status_code} body={body}")
    except Exception as e:
        record("4. POST /me/push-token (Expo)", False, str(e))

    # ── 5. Register a raw APNs hex token (explicit type) ────────────────
    apns_hex = "a1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718"
    try:
        r = requests.post(
            f"{BASE}/me/push-token",
            headers=auth(admin_token),
            json={"token": apns_hex, "token_type": "apns", "platform": "ios"},
        )
        ok = r.status_code == 200
        body = r.json() if ok else {}
        passed = ok and body.get("ok") is True and body.get("token_type") == "apns"
        record("5. POST /me/push-token (APNs hex explicit)", passed,
               f"status={r.status_code} body={body}")
    except Exception as e:
        record("5. POST /me/push-token (APNs hex explicit)", False, str(e))

    # ── 6. Auto-detect APNs from raw hex (no token_type) ────────────────
    # Use a different hex value so we can verify auto-detect as a fresh row
    apns_hex_auto = "deadbeef" * 8  # 64 chars hex
    try:
        # First delete if already exists (idempotency)
        requests.delete(f"{BASE}/me/push-token", headers=auth(admin_token), params={"token": apns_hex_auto})
        r = requests.post(
            f"{BASE}/me/push-token",
            headers=auth(admin_token),
            json={"token": apns_hex_auto, "platform": "ios"},  # no token_type
        )
        ok = r.status_code == 200
        body = r.json() if ok else {}
        passed = ok and body.get("ok") is True and body.get("token_type") == "apns"
        record("6. POST /me/push-token auto-detect APNs", passed,
               f"status={r.status_code} body={body}")
    except Exception as e:
        record("6. POST /me/push-token auto-detect APNs", False, str(e))

    # ── 7. Auto-detect Expo ─────────────────────────────────────────────
    expo_auto = "ExponentPushToken[AUTO_DETECT_EXPO]"
    try:
        requests.delete(f"{BASE}/me/push-token", headers=auth(admin_token), params={"token": expo_auto})
        r = requests.post(
            f"{BASE}/me/push-token",
            headers=auth(admin_token),
            json={"token": expo_auto, "platform": "ios"},
        )
        ok = r.status_code == 200
        body = r.json() if ok else {}
        passed = ok and body.get("ok") is True and body.get("token_type") == "expo"
        record("7. POST /me/push-token auto-detect Expo", passed,
               f"status={r.status_code} body={body}")
    except Exception as e:
        record("7. POST /me/push-token auto-detect Expo", False, str(e))

    # ── 8. Invalid pair (token_type=expo but body not a valid Expo token) ─
    try:
        r = requests.post(
            f"{BASE}/me/push-token",
            headers=auth(admin_token),
            json={"token": "not-an-expo-and-not-hex", "token_type": "expo"},
        )
        # Expect 400 with detail about Expo validity
        passed = r.status_code == 400 and "Expo" in r.text
        record("8. POST /me/push-token invalid Expo pair → 400", passed,
               f"status={r.status_code} body={r.text[:200]}")
    except Exception as e:
        record("8. POST /me/push-token invalid Expo pair → 400", False, str(e))

    # ── 9. POST /me/notifications/test-apns ─────────────────────────────
    try:
        r = requests.post(f"{BASE}/me/notifications/test-apns", headers=auth(admin_token))
        ok = r.status_code == 200
        body = r.json() if ok else {}
        tokens = body.get("tokens") or []
        types_seen = {t.get("type") for t in tokens}
        passed = ok and body.get("ok") is True and isinstance(body.get("tokens_targeted"), int) \
                 and "expo" in types_seen and "apns" in types_seen
        record("9. POST /me/notifications/test-apns", passed,
               f"status={r.status_code} tokens_targeted={body.get('tokens_targeted')} types={types_seen}")
    except Exception as e:
        record("9. POST /me/notifications/test-apns", False, str(e))

    # ── 10. Status after registration — counts should increase ──────────
    try:
        r = requests.get(f"{BASE}/admin/apns/status", headers=auth(admin_token))
        ok = r.status_code == 200
        body = r.json() if ok else {}
        new_apns = body.get("registered_apns_tokens", 0)
        new_expo = body.get("registered_expo_tokens", 0)
        # We registered 2 apns (steps 5,6) and 2 expo (steps 4,7)
        apns_ok = new_apns >= baseline_apns + 2
        expo_ok = new_expo >= baseline_expo + 2
        passed = ok and apns_ok and expo_ok
        record("10. GET /admin/apns/status counts increased", passed,
               f"baseline apns={baseline_apns}/expo={baseline_expo} -> "
               f"new apns={new_apns}/expo={new_expo}")
    except Exception as e:
        record("10. GET /admin/apns/status counts increased", False, str(e))

    # ── 11. Negative: non-admin on admin endpoints ──────────────────────
    # Register a fresh non-admin user
    try:
        email = f"qa_apns_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{BASE}/auth/register", json={
            "email": email, "password": "TestPass123!",
            "name": "APNs Tester", "username": f"apns{uuid.uuid4().hex[:6]}"
        })
        if r.status_code == 200:
            reg_data = r.json()
            non_admin_token = reg_data.get("access_token") or reg_data.get("token")
        else:
            # Try login in case account exists
            non_admin_token = login(email, "TestPass123!")[0]

        r1 = requests.get(f"{BASE}/admin/apns/status", headers=auth(non_admin_token))
        r2 = requests.post(f"{BASE}/admin/apns/test", headers=auth(non_admin_token),
                           json={"device_token": "0" * 64, "title": "t", "body": "b"})
        passed = r1.status_code == 403 and r2.status_code == 403
        record("11. non-admin on /admin/apns/* → 403", passed,
               f"status_get={r1.status_code} status_test={r2.status_code}")
    except Exception as e:
        record("11. non-admin on /admin/apns/* → 403", False, str(e))

    # ── 12. DELETE cleanup on tokens from steps 4-7 ─────────────────────
    try:
        deleted = []
        for tok in [expo_token, apns_hex, apns_hex_auto, expo_auto]:
            r = requests.delete(f"{BASE}/me/push-token", headers=auth(admin_token),
                                params={"token": tok})
            deleted.append((tok[:16] + "…", r.status_code))
        all_ok = all(s == 200 for _, s in deleted)

        # Verify counts return near baseline
        r = requests.get(f"{BASE}/admin/apns/status", headers=auth(admin_token))
        body = r.json() if r.status_code == 200 else {}
        final_apns = body.get("registered_apns_tokens", -1)
        final_expo = body.get("registered_expo_tokens", -1)
        counts_back = final_apns == baseline_apns and final_expo == baseline_expo
        passed = all_ok and counts_back
        record("12. DELETE /me/push-token cleanup", passed,
               f"deleted={deleted} final apns={final_apns} expo={final_expo} "
               f"(baseline {baseline_apns}/{baseline_expo})")
    except Exception as e:
        record("12. DELETE /me/push-token cleanup", False, str(e))

    # ── Summary ─────────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("APNs TEST SUMMARY")
    print("=" * 70)
    passes = sum(1 for r in results if r[0] == "PASS")
    fails = sum(1 for r in results if r[0] == "FAIL")
    for status, name, _ in results:
        print(f"  [{status}] {name}")
    print(f"\nTotal: {passes} PASS / {fails} FAIL")


if __name__ == "__main__":
    main()
