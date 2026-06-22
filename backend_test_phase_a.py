"""Phase A backend tests for PhotoScout.

Covers:
 - GET /api/plans (public)
 - POST /api/me/upgrade with billing_cycle
 - POST /api/admin/users/{id}/grant-plan
 - PATCH /api/auth/me new profile fields
 - North America seed + country_code on spots + geocode language_hint
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone, timedelta

import requests

BASE = "https://photo-finder-60.preview.emergentagent.com/api"

SOPHIE = ("sophie@photoscout.app", "demo123")
ADMIN = ("admin@photoscout.app", "admin123")
MARCO = ("marco@photoscout.app", "demo123")

results = []  # list of (name, ok, detail)


def rec(name, ok, detail=""):
    results.append((name, ok, detail))
    marker = "PASS" if ok else "FAIL"
    print(f"[{marker}] {name} — {detail}")


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    data = r.json()
    return data["token"], data["user"]


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ============================================================================
# 1) GET /api/plans
# ============================================================================
def test_plans():
    r = requests.get(f"{BASE}/plans", timeout=15)
    rec("plans_status_200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code != 200:
        return
    data = r.json()
    plans = data.get("plans") or []
    by_key = {p["key"]: p for p in plans}
    rec("plans_exactly_3", len(plans) == 3 and set(by_key) == {"free", "pro", "elite"}, f"keys={list(by_key)}")

    pro = by_key.get("pro", {})
    rec("pro_monthly_price", pro.get("monthly_price") == "$9.99", f"got={pro.get('monthly_price')}")
    rec("pro_annual_price", pro.get("annual_price") == "$99.99", f"got={pro.get('annual_price')}")
    rec("pro_monthly_cents", pro.get("monthly_cents") == 999, f"got={pro.get('monthly_cents')}")
    rec("pro_annual_cents", pro.get("annual_cents") == 9999, f"got={pro.get('annual_cents')}")
    rec("pro_popular", pro.get("popular") is True, f"popular={pro.get('popular')}")

    elite = by_key.get("elite", {})
    rec("elite_monthly_price", elite.get("monthly_price") == "$19.99", f"got={elite.get('monthly_price')}")
    rec("elite_annual_price", elite.get("annual_price") == "$200.00", f"got={elite.get('annual_price')}")
    rec("elite_monthly_cents", elite.get("monthly_cents") == 1999, f"got={elite.get('monthly_cents')}")
    rec("elite_annual_cents", elite.get("annual_cents") == 20000, f"got={elite.get('annual_cents')}")

    free = by_key.get("free", {})
    rec("free_saves_5", (free.get("limits") or {}).get("saves") == 5, f"saves={(free.get('limits') or {}).get('saves')}")

    # Public — no auth required (already called without auth above)
    rec("plans_no_auth_required", r.status_code == 200, "fetched unauthenticated")


# ============================================================================
# 2) POST /api/me/upgrade w/ billing_cycle
# ============================================================================
def test_upgrade():
    tok, _ = login(*SOPHIE)
    h = auth(tok)

    # pro annual
    r = requests.post(f"{BASE}/me/upgrade", json={"plan": "pro", "cycle": "annual"}, headers=h, timeout=15)
    if r.status_code != 200:
        rec("upgrade_pro_annual_200", False, f"status={r.status_code} body={r.text[:200]}")
    else:
        d = r.json()
        ok = (
            d.get("ok") is True
            and d.get("plan") == "pro"
            and d.get("cycle") == "annual"
            and (d.get("limits") or {}).get("saves") == 10000
            and (d.get("pricing") or {}).get("monthly_cents") == 999
            and (d.get("pricing") or {}).get("annual_cents") == 9999
        )
        rec("upgrade_pro_annual_200", ok, f"resp={json.dumps(d)[:200]}")

    # GET /auth/me
    me = requests.get(f"{BASE}/auth/me", headers=h, timeout=15).json()
    rec("me_reflects_pro_annual",
        me.get("plan") == "pro" and me.get("billing_cycle") == "annual",
        f"plan={me.get('plan')} cycle={me.get('billing_cycle')}")

    # downgrade to free
    r = requests.post(f"{BASE}/me/upgrade", json={"plan": "free"}, headers=h, timeout=15)
    rec("upgrade_free_200", r.status_code == 200, f"status={r.status_code}")
    me = requests.get(f"{BASE}/auth/me", headers=h, timeout=15).json()
    rec("me_free_billing_cycle_null", me.get("plan") == "free" and me.get("billing_cycle") is None,
        f"plan={me.get('plan')} cycle={me.get('billing_cycle')}")

    # invalid cycle
    r = requests.post(f"{BASE}/me/upgrade", json={"plan": "pro", "cycle": "weekly"}, headers=h, timeout=15)
    detail = ""
    try:
        detail = (r.json() or {}).get("detail", "")
    except Exception:
        pass
    rec("upgrade_invalid_cycle_400",
        r.status_code == 400 and ("monthly" in detail.lower() or "annual" in detail.lower()),
        f"status={r.status_code} detail={detail[:120]}")

    # invalid plan
    r = requests.post(f"{BASE}/me/upgrade", json={"plan": "gold"}, headers=h, timeout=15)
    rec("upgrade_invalid_plan_400", r.status_code == 400, f"status={r.status_code}")


# ============================================================================
# 3) POST /api/admin/users/{id}/grant-plan
# ============================================================================
def test_grant_plan():
    admin_tok, _ = login(*ADMIN)
    ah = auth(admin_tok)

    sophie_tok, _ = login(*SOPHIE)
    sh = auth(sophie_tok)

    # Find marco id via admin user listing
    marco_tok, marco_user = login(*MARCO)
    marco_id = marco_user["user_id"]
    rec("marco_id_found", bool(marco_id), f"id={marco_id}")

    # grant comp_pro 30d
    r = requests.post(f"{BASE}/admin/users/{marco_id}/grant-plan",
                      json={"plan": "comp_pro", "duration_days": 30, "reason": "phase a test"},
                      headers=ah, timeout=15)
    rec("grant_comp_pro_200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        u = (r.json() or {}).get("user") or {}
        plan_ok = u.get("plan") == "comp_pro"
        exp = u.get("comp_expiration")
        # Parse expiration and ensure ~30 days from now (within 60s tolerance = roughly <=61s off)
        exp_ok = False
        if exp:
            try:
                exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                expected = datetime.now(timezone.utc) + timedelta(days=30)
                diff = abs((exp_dt - expected).total_seconds())
                exp_ok = diff <= 60
            except Exception as e:
                exp_ok = False
        rec("grant_comp_pro_fields", plan_ok and exp_ok, f"plan={u.get('plan')} exp={exp}")

    # grant comp_elite permanent
    r = requests.post(f"{BASE}/admin/users/{marco_id}/grant-plan",
                      json={"plan": "comp_elite", "duration_days": None},
                      headers=ah, timeout=15)
    rec("grant_comp_elite_200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        u = (r.json() or {}).get("user") or {}
        rec("grant_comp_elite_permanent",
            u.get("plan") == "comp_elite" and u.get("comp_expiration") is None,
            f"plan={u.get('plan')} exp={u.get('comp_expiration')}")

    # revert to free
    r = requests.post(f"{BASE}/admin/users/{marco_id}/grant-plan",
                      json={"plan": "free"}, headers=ah, timeout=15)
    rec("grant_free_200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        u = (r.json() or {}).get("user") or {}
        rec("grant_free_clears",
            u.get("plan") == "free" and u.get("comp_expiration") is None and u.get("billing_cycle") is None,
            f"plan={u.get('plan')} exp={u.get('comp_expiration')} cycle={u.get('billing_cycle')}")

    # invalid plan
    r = requests.post(f"{BASE}/admin/users/{marco_id}/grant-plan",
                      json={"plan": "bogus"}, headers=ah, timeout=15)
    rec("grant_bogus_400", r.status_code == 400, f"status={r.status_code}")

    # non-admin forbidden
    r = requests.post(f"{BASE}/admin/users/{marco_id}/grant-plan",
                      json={"plan": "comp_pro"}, headers=sh, timeout=15)
    rec("grant_nonadmin_403", r.status_code == 403, f"status={r.status_code}")

    # audit logs: at least 3 user.grant_plan entries for marco
    r = requests.get(f"{BASE}/admin/audit-logs",
                     params={"action": "user.grant_plan", "target_id": marco_id, "limit": 50},
                     headers=ah, timeout=15)
    if r.status_code != 200:
        rec("grant_audit_logs", False, f"status={r.status_code}")
    else:
        items = (r.json() or {}).get("items") or []
        grant_items = [x for x in items if x.get("action") == "user.grant_plan" and x.get("target_id") == marco_id]
        rec("grant_audit_logs", len(grant_items) >= 3, f"found={len(grant_items)} entries")


# ============================================================================
# 4) PATCH /api/auth/me — extended profile fields
# ============================================================================
def test_patch_me_profile():
    tok, _ = login(*SOPHIE)
    h = auth(tok)

    payload = {
        "banner_image_url": "data:image/jpeg;base64,AAA",
        "avatar_image_url": "data:image/jpeg;base64,BBB",
        "facebook_url": "https://facebook.com/s",
        "tiktok_url": "https://tiktok.com/@s",
        "years_experience": 7,
        "service_radius_miles": 50,
        "booking_available": True,
        "primary_country": "US",
        "primary_region": "Texas",
        "timezone": "America/Chicago",
        "language_hint": "en",
    }
    r = requests.patch(f"{BASE}/auth/me", json=payload, headers=h, timeout=15)
    rec("patch_me_200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")

    me = requests.get(f"{BASE}/auth/me", headers=h, timeout=15).json()
    missing = [k for k, v in payload.items() if me.get(k) != v]
    rec("patch_me_all_fields_persist", not missing, f"mismatched={missing}")


# ============================================================================
# 5) NA seed + country fields + geocode language_hint
# ============================================================================
def test_na_seed_and_geocode():
    tok, _ = login(*SOPHIE)
    h = auth(tok)

    r = requests.get(f"{BASE}/spots", params={"limit": 300}, headers=h, timeout=30)
    rec("spots_list_200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        items = r.json() or []
        by_cc = {}
        missing_cc = 0
        for s in items:
            cc = s.get("country_code")
            if not cc:
                missing_cc += 1
                continue
            by_cc[cc] = by_cc.get(cc, 0) + 1
        non_us = by_cc.get("CA", 0) + by_cc.get("MX", 0)
        rec("spots_na_non_us_count", non_us >= 6, f"CA={by_cc.get('CA', 0)} MX={by_cc.get('MX', 0)} total_non_us={non_us}")
        rec("spots_no_missing_country_code", missing_cc == 0, f"missing={missing_cc} (counts={by_cc})")

    # geocode: Toronto → CA / en
    try:
        r = requests.get(f"{BASE}/geocode/search", params={"q": "Toronto"}, timeout=20)
        if r.status_code != 200:
            rec("geocode_toronto_200", False, f"status={r.status_code}")
        else:
            d = r.json()
            results_ = d.get("results") or []
            if not results_:
                rec("geocode_toronto_has_results", False, f"resp={json.dumps(d)[:200]}")
            else:
                first = results_[0]
                rec("geocode_toronto_ca_en",
                    first.get("country_code") == "CA" and first.get("language_hint") == "en",
                    f"cc={first.get('country_code')} lang={first.get('language_hint')}")
    except Exception as e:
        rec("geocode_toronto_200", False, f"exception={e}")

    # Ciudad de Mexico → MX / es
    try:
        r = requests.get(f"{BASE}/geocode/search", params={"q": "Ciudad de Mexico"}, timeout=20)
        if r.status_code != 200:
            rec("geocode_cdmx_200", False, f"status={r.status_code}")
        else:
            d = r.json()
            results_ = d.get("results") or []
            mx_items = [x for x in results_ if x.get("country_code") == "MX"]
            has_es = any(x.get("language_hint") == "es" for x in mx_items)
            rec("geocode_cdmx_mx_es", bool(mx_items) and has_es,
                f"mx_count={len(mx_items)} has_es={has_es}")
    except Exception as e:
        rec("geocode_cdmx_200", False, f"exception={e}")


def main():
    print(f"Testing against: {BASE}")
    try:
        test_plans()
    except Exception as e:
        rec("plans_exception", False, str(e))
    try:
        test_upgrade()
    except Exception as e:
        rec("upgrade_exception", False, str(e))
    try:
        test_grant_plan()
    except Exception as e:
        rec("grant_plan_exception", False, str(e))
    try:
        test_patch_me_profile()
    except Exception as e:
        rec("patch_me_exception", False, str(e))
    try:
        test_na_seed_and_geocode()
    except Exception as e:
        rec("na_geocode_exception", False, str(e))

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{'=' * 60}\nTotal: {passed}/{total} passed")
    failed = [(n, d) for n, ok, d in results if not ok]
    if failed:
        print("\nFAILURES:")
        for n, d in failed:
            print(f"  - {n}: {d}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
