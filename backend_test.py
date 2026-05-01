"""
Batch #6 "Trust Foundation" — focused backend verification.

Tests (per review request):
  1. POST /api/auth/forgot-password — security hardening (P0-1)
  2. POST /api/reports — consolidated reporting (P0-3)
  3. Marketplace seller feature flag (P0-5)
  4. Backwards-compatibility smoke

Target: http://localhost:8001/api
Admin:  admin@lumascout.app / Grayson@1117!!
"""
from __future__ import annotations

import json
import sys
import time
import uuid
from typing import Any, Dict, List, Tuple

import requests

API = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

# Simple pass/fail tracker
RESULTS: List[Tuple[str, str, bool, str]] = []  # (section, name, ok, detail)


def record(section: str, name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((section, name, ok, detail))
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {section} :: {name}  {('| ' + detail) if detail else ''}")


def login(email: str, password: str) -> Tuple[str, Dict[str, Any]]:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    data = r.json()
    return data["token"], data["user"]


def register_user() -> Tuple[str, str]:
    """Create a fresh free user and return (token, user_id)."""
    sfx = uuid.uuid4().hex[:8]
    email = f"b6qa_{sfx}@lumascout-qa.com"
    password = "QaPass!1234"
    payload = {
        "email": email,
        "password": password,
        "name": f"B6 QA {sfx}",
        "username": f"b6qa_{sfx}",
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
    if r.status_code >= 400:
        raise RuntimeError(f"register failed: {r.status_code} {r.text}")
    data = r.json()
    return data["token"], data["user"]["user_id"]


# ============================================================================
# SECTION 1 — POST /api/auth/forgot-password security hardening
# ============================================================================
def test_forgot_password() -> None:
    section = "1.forgot-password"
    forbidden_fields = ("dev_mode", "reset_token", "reset_link", "expires_at")

    def _check_shape(label: str, resp: requests.Response) -> Dict[str, Any] | None:
        record(section, f"{label}:status==200", resp.status_code == 200,
               f"got {resp.status_code}, body={resp.text[:200]}")
        try:
            body = resp.json()
        except Exception as e:
            record(section, f"{label}:json_parseable", False, f"err={e}")
            return None
        record(section, f"{label}:ok==true", body.get("ok") is True,
               f"ok={body.get('ok')}")
        record(section, f"{label}:has_message", isinstance(body.get("message"), str) and len(body["message"]) > 0,
               f"message={body.get('message')!r}")
        leaks = [k for k in forbidden_fields if k in body]
        record(section, f"{label}:no_leaked_fields", len(leaks) == 0,
               f"leaked={leaks}; body_keys={list(body.keys())}")
        return body

    # 1a. Valid registered email (admin)
    r = requests.post(f"{API}/auth/forgot-password",
                      json={"email": ADMIN_EMAIL}, timeout=15)
    body_valid = _check_shape("valid_email", r)

    # 1b. Unknown email
    r = requests.post(f"{API}/auth/forgot-password",
                      json={"email": f"nobody_{uuid.uuid4().hex[:8]}@lumascout-qa.com"},
                      timeout=15)
    body_unknown = _check_shape("unknown_email", r)

    # 1c. Malformed email
    r = requests.post(f"{API}/auth/forgot-password",
                      json={"email": "not-an-email"}, timeout=15)
    body_malformed = _check_shape("malformed_email", r)

    # 1d. Missing email body
    r = requests.post(f"{API}/auth/forgot-password", json={}, timeout=15)
    body_missing = _check_shape("missing_email", r)

    # Identical-shape check: same keys for all 4 responses
    if all(b is not None for b in (body_valid, body_unknown, body_malformed, body_missing)):
        keys_sets = [sorted(list(b.keys())) for b in (body_valid, body_unknown, body_malformed, body_missing)]
        all_same = all(ks == keys_sets[0] for ks in keys_sets)
        record(section, "identical_shape_all_4",
               all_same, f"key sets = {keys_sets}")


# ============================================================================
# SECTION 2 — POST /api/reports consolidated reporting
# ============================================================================
def test_reports(admin_token: str, user_token: str, user_id: str) -> None:
    section = "2.reports"
    auth_user = {"Authorization": f"Bearer {user_token}"}
    auth_admin = {"Authorization": f"Bearer {admin_token}"}

    # 2a. Unauth → 401
    r = requests.post(f"{API}/reports", json={
        "target_type": "spot", "target_id": "spot_test", "reason": "spam"
    }, timeout=15)
    record(section, "unauth:401", r.status_code == 401,
           f"got {r.status_code} body={r.text[:150]}")

    # 2b. Missing target_id → 422
    r = requests.post(f"{API}/reports", json={
        "target_type": "spot", "reason": "spam"
    }, headers=auth_user, timeout=15)
    record(section, "missing_target_id:422", r.status_code == 422,
           f"got {r.status_code} body={r.text[:200]}")

    # 2c. target_type="not_real" → 422
    r = requests.post(f"{API}/reports", json={
        "target_type": "not_real", "target_id": "xyz", "reason": "spam"
    }, headers=auth_user, timeout=15)
    record(section, "bad_target_type:422", r.status_code == 422,
           f"got {r.status_code} body={r.text[:200]}")

    # 2d. Empty whitespace reason → 422
    r = requests.post(f"{API}/reports", json={
        "target_type": "spot", "target_id": "spot_x", "reason": "   "
    }, headers=auth_user, timeout=15)
    record(section, "empty_reason:422", r.status_code == 422,
           f"got {r.status_code} body={r.text[:200]}")

    # 2e. Happy path — every target_type returns 200
    target_types = ["spot", "user", "review", "post", "poll", "comment", "marketplace_item"]
    report_ids_by_type: Dict[str, str] = {}
    for tt in target_types:
        tid = f"{tt}_qa_{uuid.uuid4().hex[:10]}"
        r = requests.post(f"{API}/reports", json={
            "target_type": tt,
            "target_id": tid,
            "reason": "spam",
            "detail": f"batch6 qa probe for {tt}",
        }, headers=auth_user, timeout=15)
        ok = r.status_code == 200
        detail = f"got {r.status_code} body={r.text[:200]}"
        record(section, f"happy:{tt}:200", ok, detail)
        if not ok:
            continue
        body = r.json()
        record(section, f"happy:{tt}:ok", body.get("ok") is True, f"ok={body.get('ok')}")
        record(section, f"happy:{tt}:deduped_false", body.get("deduped") is False,
               f"deduped={body.get('deduped')}")
        rid = body.get("report_id", "")
        record(section, f"happy:{tt}:report_id_fmt",
               isinstance(rid, str) and rid.startswith("rpt_"),
               f"report_id={rid}")
        record(section, f"happy:{tt}:target_type_echo", body.get("target_type") == tt,
               f"got={body.get('target_type')}")
        record(section, f"happy:{tt}:target_id_echo", body.get("target_id") == tid,
               f"got={body.get('target_id')}")
        record(section, f"happy:{tt}:status_pending", body.get("status") == "pending",
               f"status={body.get('status')}")
        report_ids_by_type[tt] = rid

    # 2f. Dedupe — same reporter + same target → deduped:true with SAME report_id
    if "spot" in report_ids_by_type:
        # Find the most recently created spot report_id by repeating the same body
        dedupe_tid = f"dedupe_spot_{uuid.uuid4().hex[:10]}"
        # First call
        r1 = requests.post(f"{API}/reports", json={
            "target_type": "spot", "target_id": dedupe_tid,
            "reason": "spam", "detail": "first"
        }, headers=auth_user, timeout=15)
        rid1 = r1.json().get("report_id") if r1.status_code == 200 else None
        # Second call identical
        r2 = requests.post(f"{API}/reports", json={
            "target_type": "spot", "target_id": dedupe_tid,
            "reason": "spam", "detail": "second"
        }, headers=auth_user, timeout=15)
        body2 = r2.json() if r2.status_code == 200 else {}
        record(section, "dedupe:second_200", r2.status_code == 200,
               f"got {r2.status_code}")
        record(section, "dedupe:deduped_true", body2.get("deduped") is True,
               f"deduped={body2.get('deduped')}")
        record(section, "dedupe:same_report_id",
               rid1 is not None and body2.get("report_id") == rid1,
               f"rid1={rid1} rid2={body2.get('report_id')}")

    # 2g. Legacy alias POST /api/report (singular)
    tid = f"legacy_alias_{uuid.uuid4().hex[:10]}"
    r = requests.post(f"{API}/report", json={
        "target_type": "post", "target_id": tid,
        "reason": "spam", "detail": "via /report singular"
    }, headers=auth_user, timeout=15)
    record(section, "legacy_alias:200", r.status_code == 200,
           f"got {r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        record(section, "legacy_alias:ok_true", body.get("ok") is True,
               f"body={body}")
        record(section, "legacy_alias:report_id_fmt",
               str(body.get("report_id", "")).startswith("rpt_"),
               f"report_id={body.get('report_id')}")

    # 2h. Both detail + details set → no 500, detail wins
    tid = f"both_fields_{uuid.uuid4().hex[:10]}"
    r = requests.post(f"{API}/reports", json={
        "target_type": "review", "target_id": tid,
        "reason": "spam",
        "detail": "PREFERRED_DETAIL",
        "details": "LEGACY_DETAILS",
    }, headers=auth_user, timeout=15)
    record(section, "both_detail_fields:no_500", r.status_code != 500,
           f"got {r.status_code} body={r.text[:200]}")
    record(section, "both_detail_fields:200", r.status_code == 200,
           f"got {r.status_code}")

    # 2i. GET /api/reports/reasons → 200 list of keys
    r = requests.get(f"{API}/reports/reasons", timeout=15)
    record(section, "reasons:200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code == 200:
        body = r.json()
        is_list = isinstance(body, list) and len(body) > 0
        record(section, "reasons:is_nonempty_list", is_list,
               f"type={type(body).__name__} len={len(body) if is_list else 'n/a'}")
        if is_list:
            keys_present = all(isinstance(item, dict) and "key" in item for item in body)
            record(section, "reasons:all_have_key", keys_present,
                   f"sample={body[0]}")


# ============================================================================
# SECTION 3 — Marketplace seller feature flag
# ============================================================================
def test_seller_feature_flag(user_token: str) -> None:
    section = "3.seller-flag"
    auth = {"Authorization": f"Bearer {user_token}"}

    # 3a. GET /me/seller/connect-status (default env → disabled)
    r = requests.get(f"{API}/me/seller/connect-status", headers=auth, timeout=15)
    record(section, "connect_status:200", r.status_code == 200,
           f"got {r.status_code} body={r.text[:300]}")
    if r.status_code == 200:
        body = r.json()
        record(section, "connect_status:seller_onboarding_enabled==false",
               body.get("seller_onboarding_enabled") is False,
               f"got={body.get('seller_onboarding_enabled')}")
        record(section, "connect_status:has_disabled_reason",
               isinstance(body.get("seller_onboarding_disabled_reason"), str) and
               len(body["seller_onboarding_disabled_reason"]) > 0,
               f"reason={body.get('seller_onboarding_disabled_reason')!r}")
        record(section, "connect_status:stripe_ready==false",
               body.get("stripe_ready") is False,
               f"stripe_ready={body.get('stripe_ready')}")

    # 3b. POST /me/seller/onboard (default env → 503)
    r = requests.post(f"{API}/me/seller/onboard", headers=auth, timeout=15)
    record(section, "onboard:503", r.status_code == 503,
           f"got {r.status_code} body={r.text[:300]}")
    if r.status_code == 503:
        try:
            body = r.json()
            det = body.get("detail")
            ok_shape = isinstance(det, dict) and det.get("seller_onboarding_disabled") is True
            record(section, "onboard:detail.seller_onboarding_disabled==true",
                   ok_shape, f"detail={det}")
        except Exception as e:
            record(section, "onboard:json_parseable", False, f"err={e}")

    # 3c. Buyer-facing marketplace browse unchanged
    r = requests.get(f"{API}/marketplace/products", params={"limit": 5}, timeout=15)
    record(section, "browse_products:status!=500",
           r.status_code != 500,
           f"got {r.status_code} body={r.text[:200]}")
    # Accept 200 or 404 (route naming may differ); but we want 200 per review
    record(section, "browse_products:200",
           r.status_code == 200,
           f"got {r.status_code}")
    if r.status_code == 200:
        try:
            body = r.json()
            # Accept list OR {products: [...]} OR {items: [...]}
            is_ok = (
                isinstance(body, list)
                or (isinstance(body, dict) and isinstance(body.get("products"), list))
                or (isinstance(body, dict) and isinstance(body.get("items"), list))
            )
            record(section, "browse_products:list_like", is_ok,
                   f"type={type(body).__name__} keys={list(body.keys()) if isinstance(body, dict) else 'list'}")
        except Exception as e:
            record(section, "browse_products:json_parseable", False, f"err={e}")


# ============================================================================
# SECTION 4 — Backwards-compat smoke
# ============================================================================
def test_backcompat(admin_token: str) -> None:
    section = "4.backcompat"
    auth_admin = {"Authorization": f"Bearer {admin_token}"}

    # 4a. login returns {token, user}
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    record(section, "login:200", r.status_code == 200, f"got {r.status_code}")
    if r.status_code == 200:
        body = r.json()
        record(section, "login:has_token", isinstance(body.get("token"), str) and len(body["token"]) > 20,
               f"token_len={len(body.get('token') or '')}")
        record(section, "login:has_user", isinstance(body.get("user"), dict),
               f"user_keys={list((body.get('user') or {}).keys())[:6]}")

    # 4b. GET /api/spots?limit=5
    r = requests.get(f"{API}/spots", params={"limit": 5}, timeout=15)
    record(section, "spots_list:200", r.status_code == 200,
           f"got {r.status_code} body={r.text[:150]}")

    # 4c. GET /api/feed/home (with admin token) — 200 or structured, NOT 500
    r = requests.get(f"{API}/feed/home", headers=auth_admin, timeout=15)
    record(section, "feed_home:not_500", r.status_code != 500,
           f"got {r.status_code} body={r.text[:200]}")

    # 4d. GET /api/admin/overview with admin token
    r = requests.get(f"{API}/admin/overview", headers=auth_admin, timeout=15)
    record(section, "admin_overview:200", r.status_code == 200,
           f"got {r.status_code} body={r.text[:200]}")


# ============================================================================
# Main
# ============================================================================
def main() -> int:
    print(f"=== Batch #6 Trust Foundation — backend verification ===")
    print(f"API: {API}")

    # SECTION 1 — no auth required
    test_forgot_password()

    # Get tokens for the rest
    try:
        admin_token, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
        print(f"admin login OK: user_id={admin_user.get('user_id')} role={admin_user.get('role')}")
    except Exception as e:
        print(f"FATAL: admin login failed: {e}")
        return 1

    try:
        user_token, user_id = register_user()
        print(f"fresh free user registered: user_id={user_id}")
    except Exception as e:
        print(f"FATAL: free user register failed: {e}")
        return 1

    test_reports(admin_token, user_token, user_id)
    test_seller_feature_flag(user_token)
    test_backcompat(admin_token)

    # Summary
    total = len(RESULTS)
    fails = [r for r in RESULTS if not r[2]]
    print("\n=== SUMMARY ===")
    print(f"total assertions: {total}")
    print(f"passed: {total - len(fails)}")
    print(f"failed: {len(fails)}")
    if fails:
        print("\n--- FAILURES ---")
        for section, name, ok, detail in fails:
            print(f"  [{section}] {name}: {detail}")

    return 0 if not fails else 2


if __name__ == "__main__":
    sys.exit(main())
