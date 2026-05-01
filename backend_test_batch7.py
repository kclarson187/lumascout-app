#!/usr/bin/env python3
"""Batch #7 focused verification — Production Config & Graceful Failure.
Tests the @graceful decorator wrappers + backwards-compat smoke.
"""
import json
import sys
import requests

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASS = "Grayson@1117!!"

results = []

def log(section, name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    results.append((section, name, ok, detail))
    print(f"[{status}] {section} :: {name}" + (f" — {detail}" if detail else ""))

def login():
    r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    if r.status_code != 200:
        print(f"LOGIN FAILED: {r.status_code} {r.text}")
        sys.exit(1)
    j = r.json()
    return j["token"], j["user"]

def main():
    token, user = login()
    H = {"Authorization": f"Bearer {token}"}
    print(f"Logged in as {user.get('email')} (user_id={user.get('user_id')}, role={user.get('role')})")
    print()

    # SECTION 1 — Graceful wrapper happy paths
    print("=== SECTION 1: Graceful wrapper success paths ===")

    # 1a admin/overview
    r = requests.get(f"{BASE}/admin/overview", headers=H, timeout=20)
    ok = r.status_code == 200
    log("S1", "GET /admin/overview status 200", ok, f"got {r.status_code}")
    if ok:
        body = r.json()
        keys_required = ["users", "moderation", "top_contributors", "top_cities", "revenue", "generated_at"]
        for k in keys_required:
            log("S1", f"/admin/overview has key '{k}'", k in body, f"keys={list(body.keys())[:10]}" if k not in body else "")
        log("S1", "/admin/overview NOT degraded", body.get("degraded") is not True, f"degraded={body.get('degraded')}")

    # 1b admin/analytics
    r = requests.get(f"{BASE}/admin/analytics?days=7", headers=H, timeout=20)
    ok = r.status_code == 200
    log("S1", "GET /admin/analytics?days=7 status 200", ok, f"got {r.status_code}")
    if ok:
        body = r.json()
        keys_required = ["days", "series", "totals", "most_saved", "top_cities", "top_contributors"]
        for k in keys_required:
            log("S1", f"/admin/analytics has key '{k}'", k in body, f"missing; keys={list(body.keys())[:10]}" if k not in body else "")
        log("S1", "/admin/analytics NOT degraded", body.get("degraded") is not True, f"degraded={body.get('degraded')}")

    # 1c feed/home
    r = requests.get(f"{BASE}/feed/home?lat=30.27&lng=-97.74", headers=H, timeout=20)
    ok = r.status_code == 200
    log("S1", "GET /feed/home?lat=&lng= status 200", ok, f"got {r.status_code}")
    if ok:
        body = r.json()
        for k in ["hero", "nearby", "golden", "seasonal"]:
            log("S1", f"/feed/home has key '{k}'", k in body, f"missing; keys={list(body.keys())[:15]}" if k not in body else "")
        log("S1", "/feed/home NOT degraded", body.get("degraded") is not True, f"degraded={body.get('degraded')}")

    # 1d directory/suggested
    r = requests.get(f"{BASE}/directory/suggested?limit=5", headers=H, timeout=20)
    ok = r.status_code == 200
    log("S1", "GET /directory/suggested?limit=5 status 200", ok, f"got {r.status_code}")
    if ok:
        body = r.json()
        log("S1", "/directory/suggested has 'items' array",
            "items" in body and isinstance(body["items"], list),
            f"keys={list(body.keys())}")

    # 1e geocode/search
    r = requests.get(f"{BASE}/geocode/search?q=austin+tx", headers=H, timeout=20)
    ok = r.status_code == 200
    log("S1", "GET /geocode/search?q=austin+tx status 200", ok, f"got {r.status_code}")
    if ok:
        body = r.json()
        log("S1", "/geocode/search has 'query'", "query" in body)
        log("S1", "/geocode/search has 'results' array",
            "results" in body and isinstance(body["results"], list))

    # 1f POST /referrals — valid minimal body
    body = {"title":"QA","description":"QA referral","city":"Austin","state":"TX"}
    r = requests.post(f"{BASE}/referrals", json=body, headers=H, timeout=20)
    log("S1", f"POST /referrals minimal body NOT 500", r.status_code != 500,
        f"got {r.status_code}; body={r.text[:300]}")
    log("S1", f"POST /referrals minimal body status detail", True,
        f"status={r.status_code} body={r.text[:300]}")

    # SECTION 2 — Validation 422
    print("\n=== SECTION 2: Pydantic validation still fires (422) ===")
    r = requests.post(f"{BASE}/referrals", json={"title":"a"}, headers=H, timeout=20)
    log("S2", "POST /referrals {title:'a'} → 422 (NOT 500)",
        r.status_code == 422, f"got {r.status_code}; body={r.text[:300]}")
    if r.status_code == 422:
        try:
            j = r.json()
            log("S2", "/referrals 422 body has pydantic 'detail' array",
                isinstance(j.get("detail"), list), f"detail type={type(j.get('detail'))}")
        except Exception as e:
            log("S2", "/referrals 422 JSON parse", False, str(e))

    # SECTION 3 — Geocode degraded
    print("\n=== SECTION 3: Geocode empty-q contract ===")
    r = requests.get(f"{BASE}/geocode/search?q=", headers=H, timeout=20)
    log("S3", "GET /geocode/search?q= status 200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code == 200:
        b = r.json()
        log("S3", "/geocode empty q -> query == ''", b.get("query") == "", f"query={b.get('query')!r}")
        log("S3", "/geocode empty q -> results == []",
            b.get("results") == [], f"results={b.get('results')!r}")

    # SECTION 4 — Backwards-compat smoke
    print("\n=== SECTION 4: Backwards-compat smoke ===")

    # 4a login already done — verify shape
    r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    if r.status_code == 200:
        j = r.json()
        log("S4", "POST /auth/login returns 'token'", "token" in j)
        log("S4", "POST /auth/login returns 'user'", "user" in j)
    else:
        log("S4", "POST /auth/login 200", False, f"got {r.status_code}")

    # 4b forgot-password admin — must NOT leak reset_token / link / dev_mode
    r = requests.post(f"{BASE}/auth/forgot-password",
                      json={"email": ADMIN_EMAIL}, timeout=15)
    ok = r.status_code == 200
    log("S4", "POST /auth/forgot-password status 200", ok, f"got {r.status_code}")
    if ok:
        b = r.json()
        for forbidden in ["reset_token", "reset_link", "dev_mode"]:
            log("S4", f"forgot-password body has NO '{forbidden}'",
                forbidden not in b, f"body keys={list(b.keys())}")

    # 4c POST /reports unified
    r = requests.post(f"{BASE}/reports",
                      json={"target_type":"marketplace_item",
                            "target_id":"qa_batch7",
                            "reason":"spam"},
                      headers=H, timeout=15)
    log("S4", "POST /reports unified 200", r.status_code == 200,
        f"got {r.status_code}; body={r.text[:300]}")

    # 4d POST /report singular
    r = requests.post(f"{BASE}/report",
                      json={"target_type":"marketplace_item",
                            "target_id":"qa_batch7_alias",
                            "reason":"spam"},
                      headers=H, timeout=15)
    log("S4", "POST /report singular alias 200", r.status_code == 200,
        f"got {r.status_code}; body={r.text[:300]}")

    # 4e seller connect-status
    r = requests.get(f"{BASE}/me/seller/connect-status", headers=H, timeout=15)
    ok = r.status_code == 200
    log("S4", "GET /me/seller/connect-status 200", ok, f"got {r.status_code}")
    if ok:
        b = r.json()
        log("S4", "connect-status seller_onboarding_enabled is False",
            b.get("seller_onboarding_enabled") is False,
            f"value={b.get('seller_onboarding_enabled')}")

    # SECTION 5 — Other regression smoke
    print("\n=== SECTION 5: Untouched routes (no regression) ===")
    r = requests.get(f"{BASE}/spots?limit=5", headers=H, timeout=20)
    log("S5", "GET /spots?limit=5 status 200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code == 200:
        b = r.json()
        is_list = isinstance(b, list) or (isinstance(b, dict) and isinstance(b.get("items"), list))
        log("S5", "/spots returns list-like", is_list, f"type={type(b).__name__}")

    r = requests.get(f"{BASE}/notifications?limit=1", headers=H, timeout=15)
    log("S5", "GET /notifications?limit=1 status 200", r.status_code == 200, f"got {r.status_code}")

    # ── FINAL SUMMARY ──
    print("\n" + "=" * 60)
    total = len(results)
    passed = sum(1 for _,_,ok,_ in results if ok)
    failed = total - passed
    print(f"RESULTS: {passed}/{total} passed ({failed} failed)")
    if failed:
        print("\nFAILED:")
        for s, n, ok, d in results:
            if not ok:
                print(f"  [{s}] {n} — {d}")
    return failed

if __name__ == "__main__":
    sys.exit(0 if main() == 0 else 1)
