"""
Focused re-test for POST /api/reports after cross-domain ReportIn restoration fix.
Only re-verifies the previously-failing item from Phase 4 regression.

Tests:
1. POST /api/reports valid shape -> 200
2. POST /api/reports invalid reason -> 400 "Invalid reason"
3. POST /api/reports missing reason field -> 422 pydantic validation
4. GET /api/reports/reasons -> 200 with 6 reason keys
5. GET /api/admin/reports -> 200 (admin reports queue)
6. POST /api/users/{id}/report -> 200 (DMReportIn path in routes/users.py — cross-check)
"""

import os
import sys
import time
import uuid
import requests

BASE_URL = "https://photo-finder-60.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

results = []


def log(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} :: {detail}")
    results.append((name, ok, detail))


def login(email, password):
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        print(f"[FATAL] login failed for {email}: {r.status_code} {r.text[:200]}")
        sys.exit(1)
    data = r.json()
    return data.get("access_token") or data.get("token")


def register_throwaway():
    stamp = uuid.uuid4().hex[:8]
    email = f"qa_report_retest_{stamp}@lumascout.app"
    username = f"qareport_{stamp}"
    payload = {
        "email": email,
        "password": "Passw0rd!12",
        "name": "QA Report Retest",
        "username": username,
    }
    r = requests.post(f"{BASE_URL}/auth/register", json=payload, timeout=15)
    if r.status_code != 200:
        print(f"[FATAL] register failed: {r.status_code} {r.text[:200]}")
        sys.exit(1)
    data = r.json()
    token = data.get("access_token") or data.get("token")
    me = requests.get(f"{BASE_URL}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=15).json()
    return token, me.get("user_id")


def hdr(token):
    return {"Authorization": f"Bearer {token}"}


def main():
    print("=" * 70)
    print("REPORTS FIX RE-TEST")
    print(f"Base: {BASE_URL}")
    print("=" * 70)

    admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    # get admin user_id
    me = requests.get(f"{BASE_URL}/auth/me", headers=hdr(admin_token), timeout=15).json()
    admin_uid = me.get("user_id")

    # Create throwaway user for testing (so self-report isn't triggered when reporting admin)
    user_token, user_uid = register_throwaway()

    # Need a target spot to report. Use any existing spot from list.
    r = requests.get(f"{BASE_URL}/spots?limit=5", headers=hdr(user_token), timeout=15)
    if r.status_code != 200:
        log("precondition: list /spots for a report target", False, f"HTTP {r.status_code}")
        return
    data_json = r.json()
    items = data_json.get("items", []) if isinstance(data_json, dict) else data_json
    if not items:
        log("precondition: at least one spot exists", False, "no spots returned")
        return
    target_spot_id = items[0].get("spot_id") or items[0].get("id")
    log("precondition: obtained target spot", True, f"spot_id={target_spot_id}")

    # ----- TEST 4: GET /api/reports/reasons -> 6 keys -----
    r = requests.get(f"{BASE_URL}/reports/reasons", headers=hdr(user_token), timeout=15)
    if r.status_code != 200:
        log("4. GET /reports/reasons -> 200", False, f"HTTP {r.status_code}: {r.text[:200]}")
    else:
        data = r.json()
        keys = [item.get("key") for item in data] if isinstance(data, list) else []
        expected = {"not_a_location", "unsafe", "inappropriate", "spam", "wrong_info", "other"}
        ok = len(keys) == 6 and set(keys) == expected
        log("4. GET /reports/reasons -> 200 with 6 reason keys", ok, f"keys={keys}")

    # ----- TEST 1: POST /api/reports valid shape -> 200 -----
    payload_ok = {
        "target_type": "spot",
        "target_id": target_spot_id,
        "reason": "spam",
        "details": "re-test after ReportIn fix",
    }
    r = requests.post(f"{BASE_URL}/reports", json=payload_ok, headers=hdr(user_token), timeout=15)
    if r.status_code != 200:
        log("1. POST /reports valid shape -> 200", False, f"HTTP {r.status_code}: {r.text[:300]}")
    else:
        data = r.json()
        rid = data.get("report_id", "")
        status_v = data.get("status")
        ok = status_v == "pending" and rid.startswith("rep_")
        log("1. POST /reports valid shape -> 200", ok, f"report_id={rid} status={status_v}")

    # ----- TEST 2: invalid reason -> 400 -----
    payload_bad_reason = {
        "target_type": "spot",
        "target_id": target_spot_id,
        "reason": "invalid_reason",
        "details": "x",
    }
    # Use a different reporter to avoid dedupe short-circuit
    user2_token, user2_uid = register_throwaway()
    r = requests.post(f"{BASE_URL}/reports", json=payload_bad_reason, headers=hdr(user2_token), timeout=15)
    ok = r.status_code == 400 and "Invalid reason" in r.text
    log("2. POST /reports invalid reason -> 400 'Invalid reason'", ok, f"HTTP {r.status_code}: {r.text[:200]}")

    # ----- TEST 3: missing reason field -> 422 pydantic -----
    payload_missing = {
        "target_type": "spot",
        "target_id": target_spot_id,
        "details": "no reason field",
    }
    r = requests.post(f"{BASE_URL}/reports", json=payload_missing, headers=hdr(user2_token), timeout=15)
    ok = r.status_code == 422
    log("3. POST /reports missing reason -> 422", ok, f"HTTP {r.status_code}: {r.text[:200]}")

    # ----- TEST 5: GET /api/admin/reports -> 200 -----
    r = requests.get(f"{BASE_URL}/admin/reports", headers=hdr(admin_token), timeout=15)
    if r.status_code != 200:
        log("5. GET /admin/reports -> 200", False, f"HTTP {r.status_code}: {r.text[:300]}")
    else:
        data = r.json()
        # Should include our freshly-created report
        items = data.get("items", data) if isinstance(data, dict) else data
        count = len(items) if isinstance(items, list) else -1
        log("5. GET /admin/reports -> 200", True, f"count={count}")

    # ----- TEST 6: POST /api/users/{id}/report (DMReportIn in routes/users.py) -----
    # User reports admin (cannot self-report)
    payload_user_report = {"reason": "spam", "notes": "re-test post-fix"}
    r = requests.post(f"{BASE_URL}/users/{admin_uid}/report", json=payload_user_report,
                      headers=hdr(user_token), timeout=15)
    ok = r.status_code == 200
    log("6. POST /users/{id}/report -> 200 (DMReportIn path)", ok, f"HTTP {r.status_code}: {r.text[:200]}")

    # Summary
    print()
    print("=" * 70)
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"RESULT: {passed}/{total} PASS")
    for name, ok, detail in results:
        if not ok:
            print(f"  FAIL: {name} :: {detail}")
    print("=" * 70)
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
