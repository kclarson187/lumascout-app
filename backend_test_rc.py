"""
Backend test harness for the Apple IAP / RevenueCat migration.

Drives the production REACT/EXPO_PUBLIC_BACKEND_URL and validates DB
state directly via motor. Designed to be re-runnable: it creates
fresh users with random suffixes for each run and cleans them up at
the end (best-effort).
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import string
import subprocess
import sys
import time
import uuid
from typing import Any, Dict, Optional, Tuple

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

# ─── Constants ──────────────────────────────────────────────────────
BASE = "https://photo-finder-60.preview.emergentagent.com/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "photoscout_database"

BACKEND_ENV_PATH = "/app/backend/.env"
WEBHOOK_AUTH_PLACEHOLDER = "__SET_REVENUECAT_WEBHOOK_AUTH__"
TEST_SECRET = "Bearer test-secret-12345"

RESULTS: list[tuple[str, str, str]] = []  # (id, status, detail)

def record(test_id: str, ok: bool, detail: str) -> None:
    status = "PASS" if ok else "FAIL"
    RESULTS.append((test_id, status, detail))
    marker = "✅" if ok else "❌"
    print(f"{marker} [{test_id}] {status} — {detail[:300]}")


def rand_email() -> Tuple[str, str]:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    email = f"rc_test_{suffix}@lumascout-qa.com"
    return email, "TestPass123!"


def patch_env_var(key: str, new_value: str) -> None:
    """Rewrite a single VAR= line in /app/backend/.env, preserving order."""
    with open(BACKEND_ENV_PATH, "r") as f:
        lines = f.readlines()
    out, found = [], False
    for ln in lines:
        if ln.strip().startswith(f"{key}="):
            out.append(f"{key}={new_value}\n")
            found = True
        else:
            out.append(ln)
    if not found:
        out.append(f"{key}={new_value}\n")
    with open(BACKEND_ENV_PATH, "w") as f:
        f.writelines(out)


def restart_backend() -> None:
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=False, capture_output=True)
    # wait for boot
    for _ in range(30):
        try:
            r = httpx.get(f"{BASE}/billing/iap-config", timeout=3)
            if r.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(1)


async def main():
    # ─── Test 1 — GET /api/billing/iap-config (placeholder mode) ────
    print("\n=== Test 1: /api/billing/iap-config (placeholder mode) ===")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{BASE}/billing/iap-config")
        if r.status_code != 200:
            record("1a", False, f"HTTP {r.status_code}: {r.text}")
        else:
            body = r.json()
            expected_product_ids = {
                "pro_monthly":   "com.lumascout.pro.monthly",
                "pro_annual":    "com.lumascout.pro.annual",
                "elite_monthly": "com.lumascout.elite.monthly",
                "elite_annual":  "com.lumascout.elite.annual",
            }
            ok = (
                body.get("ios", {}).get("configured") is False
                and body["ios"]["api_key"] is None
                and body["ios"]["entitlements"] == ["pro", "elite"]
                and body["ios"]["offering_id"] == "default"
                and body["ios"]["product_ids"] == expected_product_ids
                and body.get("stripe_platforms") == ["web", "android"]
                and body.get("ios_iap_enabled") is False
            )
            record("1a", ok, f"shape correct, api_key=None, configured=false: {json.dumps(body)[:200]}")
            # 1b: public, no auth header
            record("1b", r.status_code == 200, "Accessible without Authorization header")
            # 1c: placeholder string not leaked
            leaked = "__SET_IN_RC_DASHBOARD__" in r.text
            record("1c", not leaked, "Placeholder string not in response" if not leaked else "LEAK: __SET_IN_RC_DASHBOARD__ in response")

        # ─── Test 2a/2b — webhook in placeholder mode ───────────────
        print("\n=== Test 2a/2b: webhook in placeholder mode ===")
        sample_payload = {
            "event": {
                "type": "INITIAL_PURCHASE",
                "app_user_id": "user_nonexistent",
                "product_id": "com.lumascout.pro.monthly",
                "entitlements": {"pro": {}},
                "entitlement_ids": ["pro"],
                "store": "APP_STORE",
                "expiration_at_ms": 1727712000000,
            }
        }
        r = await client.post(f"{BASE}/revenuecat/webhook", json=sample_payload)
        record("2a", r.status_code == 503,
               f"placeholder, no Auth header → status {r.status_code} body={r.text[:200]}")
        r = await client.post(f"{BASE}/revenuecat/webhook",
                              json=sample_payload,
                              headers={"Authorization": "Bearer wrong-secret"})
        record("2b", r.status_code == 503,
               f"placeholder, wrong Auth → status {r.status_code} body={r.text[:200]}")

    # ─── Reconfigure webhook secret and restart backend ────────────
    print("\n=== Configuring REVENUECAT_WEBHOOK_AUTH to test secret ===")
    patch_env_var("REVENUECAT_WEBHOOK_AUTH", TEST_SECRET)
    restart_backend()

    async with httpx.AsyncClient(timeout=15) as client:
        # 2c
        print("\n=== Test 2c: webhook in configured mode ===")
        sample_payload = {
            "event": {
                "type": "INITIAL_PURCHASE",
                "app_user_id": "user_nonexistent_xyz",
                "product_id": "com.lumascout.pro.monthly",
                "entitlements": {"pro": {}},
                "entitlement_ids": ["pro"],
                "store": "APP_STORE",
                "expiration_at_ms": 1727712000000,
            }
        }
        r = await client.post(f"{BASE}/revenuecat/webhook", json=sample_payload)
        record("2c-missing-auth", r.status_code == 401,
               f"configured, no Auth → status {r.status_code} body={r.text[:200]}")
        r = await client.post(f"{BASE}/revenuecat/webhook", json=sample_payload,
                              headers={"Authorization": "Bearer wrong"})
        record("2c-wrong-auth", r.status_code == 401,
               f"configured, wrong Auth → status {r.status_code} body={r.text[:200]}")
        r = await client.post(f"{BASE}/revenuecat/webhook", json=sample_payload,
                              headers={"Authorization": TEST_SECRET})
        ok = r.status_code == 200 and r.json().get("applied") is False and r.json().get("reason") == "user_not_found"
        record("2c-unknown-user", ok,
               f"configured, valid Auth, unknown app_user_id → status {r.status_code} body={r.text[:200]}")

        # ─── Test 2d/5/6 — register a real user and walk events ────
        print("\n=== Test 2d: register real user + INITIAL_PURCHASE ===")
        email, password = rand_email()
        rr = await client.post(f"{BASE}/auth/register",
                               json={"email": email, "password": password, "name": "RC Test User"})
        if rr.status_code != 200:
            record("2d-register", False, f"register failed: {rr.status_code} {rr.text[:300]}")
            return
        user_id = rr.json()["user"]["user_id"]
        record("2d-register", True, f"registered user_id={user_id}")

        def event_payload(event_type: str, entitlements: Optional[Dict[str, Any]] = None,
                          app_user_id: Optional[str] = None,
                          product_id: str = "com.lumascout.pro.monthly") -> Dict[str, Any]:
            ev: Dict[str, Any] = {
                "type": event_type,
                "app_user_id": app_user_id or user_id,
                "product_id": product_id,
                "store": "APP_STORE",
                "expiration_at_ms": 1727712000000,
            }
            if entitlements is not None:
                ev["entitlements"] = entitlements
            return {"event": ev}

        # DB connection for state verification
        m = AsyncIOMotorClient(MONGO_URL)
        db = m[DB_NAME]

        # INITIAL_PURCHASE → pro
        r = await client.post(f"{BASE}/revenuecat/webhook",
                              json=event_payload("INITIAL_PURCHASE", {"pro": {}}),
                              headers={"Authorization": TEST_SECRET})
        body = r.json() if r.status_code == 200 else {}
        ok = (r.status_code == 200 and body.get("applied") is True
              and body.get("action") == "grant" and body.get("plan") == "pro")
        record("2d-initial-purchase-resp", ok, f"status={r.status_code} body={r.text[:200]}")
        u = await db.users.find_one({"user_id": user_id})
        ok = (u and u.get("plan") == "pro" and u.get("subscription_source") == "revenuecat"
              and u.get("subscription_status") == "active"
              and u.get("revenuecat_app_user_id") == user_id
              and u.get("revenuecat_last_event") == "INITIAL_PURCHASE"
              and u.get("revenuecat_product_id") == "com.lumascout.pro.monthly"
              and u.get("revenuecat_store") == "APP_STORE")
        record("2d-initial-purchase-db", bool(ok),
               f"plan={u.get('plan')} source={u.get('subscription_source')} "
               f"status={u.get('subscription_status')} rc_user={u.get('revenuecat_app_user_id')} "
               f"last_event={u.get('revenuecat_last_event')} product={u.get('revenuecat_product_id')} "
               f"store={u.get('revenuecat_store')}")

        # 2d RENEWAL → elite
        r = await client.post(f"{BASE}/revenuecat/webhook",
                              json=event_payload("RENEWAL", {"elite": {}},
                                                 product_id="com.lumascout.elite.monthly"),
                              headers={"Authorization": TEST_SECRET})
        u = await db.users.find_one({"user_id": user_id})
        ok = r.status_code == 200 and u.get("plan") == "elite"
        record("2d-renewal-elite", ok, f"status={r.status_code} plan={u.get('plan')} body={r.text[:200]}")

        # 2d EXPIRATION → free, expired
        r = await client.post(f"{BASE}/revenuecat/webhook",
                              json=event_payload("EXPIRATION"),
                              headers={"Authorization": TEST_SECRET})
        u = await db.users.find_one({"user_id": user_id})
        ok = (r.status_code == 200 and u.get("plan") == "free"
              and u.get("subscription_status") == "expired"
              and u.get("subscription_source") == "revenuecat")
        record("2d-expiration", ok,
               f"status={r.status_code} plan={u.get('plan')} sub_status={u.get('subscription_status')} "
               f"source={u.get('subscription_source')}")

        # ─── Test 3: Stripe-source protection ────────────────────────
        print("\n=== Test 3: Stripe-source protection ===")
        email2, password2 = rand_email()
        rr = await client.post(f"{BASE}/auth/register",
                               json={"email": email2, "password": password2, "name": "Stripe Protected"})
        user2_id = rr.json()["user"]["user_id"]
        await db.users.update_one(
            {"user_id": user2_id},
            {"$set": {"subscription_source": "stripe", "subscription_status": "active", "plan": "elite"}},
        )
        r = await client.post(f"{BASE}/revenuecat/webhook",
                              json={"event": {"type": "EXPIRATION", "app_user_id": user2_id,
                                              "store": "APP_STORE", "product_id": "com.lumascout.pro.monthly"}},
                              headers={"Authorization": TEST_SECRET})
        body = r.json() if r.status_code == 200 else {}
        ok_resp = (r.status_code == 200 and body.get("applied") is False
                   and body.get("reason") == "other_source_active")
        u = await db.users.find_one({"user_id": user2_id})
        ok_db = (u.get("plan") == "elite" and u.get("subscription_source") == "stripe")
        record("3-stripe-protected", ok_resp and ok_db,
               f"resp={r.text[:200]} db: plan={u.get('plan')} source={u.get('subscription_source')}")

        # ─── Test 4: Comp protection ────────────────────────────────
        print("\n=== Test 4: Comp protection ===")
        email3, password3 = rand_email()
        rr = await client.post(f"{BASE}/auth/register",
                               json={"email": email3, "password": password3, "name": "Comp Protected"})
        user3_id = rr.json()["user"]["user_id"]
        await db.users.update_one(
            {"user_id": user3_id},
            {"$set": {"subscription_source": "comp", "plan": "elite"}},
        )
        r = await client.post(f"{BASE}/revenuecat/webhook",
                              json={"event": {"type": "INITIAL_PURCHASE", "app_user_id": user3_id,
                                              "store": "APP_STORE",
                                              "product_id": "com.lumascout.pro.monthly",
                                              "entitlements": {"pro": {}}}},
                              headers={"Authorization": TEST_SECRET})
        body = r.json() if r.status_code == 200 else {}
        ok_resp = (r.status_code == 200 and body.get("applied") is False
                   and body.get("reason") == "other_source_active")
        u = await db.users.find_one({"user_id": user3_id})
        ok_db = (u.get("plan") == "elite" and u.get("subscription_source") == "comp")
        record("4-comp-protected", ok_resp and ok_db,
               f"resp={r.text[:200]} db: plan={u.get('plan')} source={u.get('subscription_source')}")

        # ─── Test 5: Idempotency ─────────────────────────────────────
        print("\n=== Test 5: Idempotency ===")
        email5, password5 = rand_email()
        rr = await client.post(f"{BASE}/auth/register",
                               json={"email": email5, "password": password5, "name": "Idempotent"})
        user5_id = rr.json()["user"]["user_id"]
        payload5 = {"event": {"type": "INITIAL_PURCHASE", "app_user_id": user5_id,
                              "product_id": "com.lumascout.pro.monthly",
                              "entitlements": {"pro": {}}, "store": "APP_STORE"}}
        r1 = await client.post(f"{BASE}/revenuecat/webhook", json=payload5,
                               headers={"Authorization": TEST_SECRET})
        r2 = await client.post(f"{BASE}/revenuecat/webhook", json=payload5,
                               headers={"Authorization": TEST_SECRET})
        b1, b2 = r1.json(), r2.json()
        ok = (r1.status_code == 200 and r2.status_code == 200
              and b1.get("applied") is True and b2.get("applied") is True
              and b1.get("action") == "grant" and b2.get("action") == "grant"
              and b1.get("plan") == "pro" and b2.get("plan") == "pro")
        record("5-idempotency", ok, f"first={r1.text[:120]} second={r2.text[:120]}")

        # ─── Test 6: Event types walkthrough ────────────────────────
        print("\n=== Test 6: Event types walkthrough ===")
        email6, password6 = rand_email()
        rr = await client.post(f"{BASE}/auth/register",
                               json={"email": email6, "password": password6, "name": "Walker"})
        user6_id = rr.json()["user"]["user_id"]

        async def send_ev(et: str, ent: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
            r = await client.post(f"{BASE}/revenuecat/webhook",
                                  json=event_payload(et, ent, app_user_id=user6_id),
                                  headers={"Authorization": TEST_SECRET})
            return r.json() if r.status_code == 200 else {"_status": r.status_code, "_text": r.text}

        await send_ev("INITIAL_PURCHASE", {"pro": {}})
        u = await db.users.find_one({"user_id": user6_id})
        record("6a-INITIAL_PURCHASE", u.get("plan") == "pro", f"plan={u.get('plan')}")

        await send_ev("RENEWAL", {"pro": {}})
        u = await db.users.find_one({"user_id": user6_id})
        record("6b-RENEWAL", u.get("plan") == "pro", f"plan={u.get('plan')}")

        await send_ev("PRODUCT_CHANGE", {"elite": {}})
        u = await db.users.find_one({"user_id": user6_id})
        record("6c-PRODUCT_CHANGE", u.get("plan") == "elite", f"plan={u.get('plan')}")

        resp = await send_ev("CANCELLATION")
        u = await db.users.find_one({"user_id": user6_id})
        record("6d-CANCELLATION", u.get("plan") == "elite" and resp.get("applied") is False,
               f"plan={u.get('plan')} resp_applied={resp.get('applied')} reason={resp.get('reason')}")

        await send_ev("EXPIRATION")
        u = await db.users.find_one({"user_id": user6_id})
        record("6e-EXPIRATION", u.get("plan") == "free" and u.get("subscription_status") == "expired",
               f"plan={u.get('plan')} status={u.get('subscription_status')}")

        await send_ev("UNCANCELLATION", {"elite": {}})
        u = await db.users.find_one({"user_id": user6_id})
        record("6f-UNCANCELLATION",
               u.get("plan") == "elite" and u.get("subscription_status") == "active",
               f"plan={u.get('plan')} status={u.get('subscription_status')}")

        await send_ev("REFUND")
        u = await db.users.find_one({"user_id": user6_id})
        record("6g-REFUND", u.get("plan") == "free", f"plan={u.get('plan')}")

        # ─── Test 7: Regression on existing endpoints ───────────────
        print("\n=== Test 7: Regression tests ===")
        r = await client.get(f"{BASE}/plans")
        if r.status_code == 200:
            keys = [p.get("key") for p in r.json().get("plans", [])]
            ok = set(keys) >= {"free", "pro", "elite"}
            record("7a-plans", ok, f"keys={keys}")
        else:
            record("7a-plans", False, f"status={r.status_code}")

        # Login as walker user to get token for billing/checkout
        lr = await client.post(f"{BASE}/auth/login", json={"email": email6, "password": password6})
        if lr.status_code == 200:
            token = lr.json()["token"]
            # First demote user6 off revenuecat so checkout isn't blocked
            r = await client.post(f"{BASE}/billing/checkout",
                                  json={"plan": "pro"},
                                  headers={"Authorization": f"Bearer {token}"})
            # We expect either 200 with a URL or 503 if Stripe isn't ready; report what we got
            if r.status_code == 200 and r.json().get("url", "").startswith(("https://checkout.stripe", "https://billing.stripe", "https://")):
                record("7b-billing-checkout", True, f"url returned: {r.json().get('url')[:60]}...")
            elif r.status_code == 503:
                record("7b-billing-checkout", False, f"503 — Stripe not configured: {r.text[:200]}")
            else:
                record("7b-billing-checkout", False, f"status={r.status_code} body={r.text[:200]}")
        else:
            record("7b-billing-checkout", False, f"could not login: {lr.status_code}")

        # Stripe webhook should reject invalid signature
        r = await client.post(f"{BASE}/stripe/webhook",
                              content=b'{"id":"evt_test","type":"customer.subscription.updated"}',
                              headers={"Stripe-Signature": "bad_sig", "Content-Type": "application/json"})
        record("7c-stripe-webhook-sig", r.status_code in (400, 401, 403),
               f"status={r.status_code} body={r.text[:200]}")

        # Weather endpoint (public-ish, location params)
        r = await client.get(f"{BASE}/weather?lat=30.27&lon=-97.74")
        record("7d-weather", r.status_code in (200, 401),
               f"status={r.status_code} (200 if anon allowed, 401 if auth required)")

        # GET spot — just hit any spot route and confirm 200/404 (no crash)
        r = await client.get(f"{BASE}/spots/spot_does_not_exist")
        record("7e-spot-detail", r.status_code in (200, 404),
               f"status={r.status_code} (no 5xx)")

        # DELETE /api/account/delete still requires auth → 401 without token
        r = await client.delete(f"{BASE}/account/delete")
        record("7f-account-delete-auth", r.status_code == 401,
               f"status={r.status_code} (expected 401)")

        # ─── Cleanup test users ──────────────────────────────────────
        print("\n=== Cleanup test users ===")
        for uid in (user_id, user2_id, user3_id, user5_id, user6_id):
            await db.users.delete_one({"user_id": uid})
        m.close()

    # ─── Test 8: Restore placeholder state ─────────────────────────
    print("\n=== Test 8: Restore placeholder state ===")
    patch_env_var("REVENUECAT_WEBHOOK_AUTH", WEBHOOK_AUTH_PLACEHOLDER)
    restart_backend()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{BASE}/revenuecat/webhook",
                              json={"event": {"type": "INITIAL_PURCHASE", "app_user_id": "x"}},
                              headers={"Authorization": TEST_SECRET})
        record("8-restored-placeholder", r.status_code == 503,
               f"status={r.status_code} body={r.text[:200]}")

    # ─── Summary ────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    passed = sum(1 for _, s, _ in RESULTS if s == "PASS")
    failed = sum(1 for _, s, _ in RESULTS if s == "FAIL")
    for tid, status, det in RESULTS:
        marker = "✅" if status == "PASS" else "❌"
        print(f"{marker} {tid}: {status}")
    print(f"\nTotal: {passed} PASS, {failed} FAIL out of {len(RESULTS)}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())
