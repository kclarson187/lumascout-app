"""
Phase E — Stripe billing backend validation.

Covers the 4 new endpoints introduced in /app/backend/server.py:
  - POST /api/billing/checkout
  - POST /api/billing/portal
  - GET  /api/billing/status
  - POST /api/webhook/stripe   (mounted directly on app, no /api router)

Historical endpoints are NOT retested.

Creds (from /app/memory/test_credentials.md):
  - sophie@photoscout.app / demo123
  - admin@photoscout.app / admin123

STRIPE_WEBHOOK_SECRET is intentionally NOT set, so the webhook endpoint
accepts raw JSON for test-mode convenience.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

import requests
from pymongo import MongoClient


BACKEND_URL = "https://photo-finder-60.preview.emergentagent.com"
API = f"{BACKEND_URL}/api"
WEBHOOK_URL = f"{BACKEND_URL}/api/webhook/stripe"

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "photoscout_database"

PRO_PRICE_ID = "price_1TO2RiAxyoRaRJ7bM7HSUvXq"
ELITE_PRICE_ID = "price_1TO2RjAxyoRaRJ7b48OzdcoK"


# ---------------------------- test runner scaffolding ----------------------------

_results: List[Tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> bool:
    status = "PASS" if ok else "FAIL"
    print(f"  [{status}] {name}" + (f"  — {detail}" if detail else ""))
    _results.append((name, ok, detail))
    return ok


def summary() -> int:
    passed = sum(1 for _, ok, _ in _results if ok)
    failed = [r for r in _results if not r[1]]
    total = len(_results)
    print("\n" + "=" * 80)
    print(f"RESULTS: {passed}/{total} PASS   ({len(failed)} fail)")
    if failed:
        print("\nFailures:")
        for name, _, detail in failed:
            print(f"  - {name}: {detail}")
    print("=" * 80)
    return 0 if not failed else 1


# ---------------------------- helpers ------------------------------------------

def login(email: str, password: str) -> Tuple[str, Dict[str, Any]]:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    return data["token"], data["user"]


def register_fresh_user() -> Tuple[str, Dict[str, Any]]:
    """Create a brand-new user that has never touched Stripe."""
    suffix = uuid.uuid4().hex[:10]
    email = f"qa.stripe.fresh.{suffix}@photoscout.app"
    password = "StripeQA!2026"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": "Stripe QA Fresh"},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    return data["token"], data["user"]


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def get_user_doc(user_id: str) -> Dict[str, Any]:
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    try:
        user = client[DB_NAME].users.find_one({"user_id": user_id})
        return user or {}
    finally:
        client.close()


def count_payment_txns(session_id: Optional[str] = None, user_id: Optional[str] = None) -> int:
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    try:
        q: Dict[str, Any] = {}
        if session_id:
            q["session_id"] = session_id
        if user_id:
            q["user_id"] = user_id
        return client[DB_NAME].payment_transactions.count_documents(q)
    finally:
        client.close()


# ---------------------------- tests --------------------------------------------

def test_billing_checkout(sophie_token: str, sophie_user_id: str) -> Dict[str, Any]:
    print("\n[1/4] POST /api/billing/checkout")
    ctx: Dict[str, Any] = {}

    # --- 1a: plan=pro
    r = requests.post(
        f"{API}/billing/checkout",
        json={"plan": "pro"},
        headers=auth_headers(sophie_token),
        timeout=30,
    )
    ok = r.status_code == 200
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    url = body.get("url", "")
    sid = body.get("session_id", "")
    detail = f"status={r.status_code} url={url[:60]} session_id={sid[:30]}"
    ok = ok and url.startswith("https://checkout.stripe.com") and sid.startswith("cs_test_")
    record("checkout plan=pro → 200 + stripe URL + cs_test_ session_id", ok, detail)
    ctx["pro_session_id"] = sid

    # --- 1b: plan=elite
    r = requests.post(
        f"{API}/billing/checkout",
        json={"plan": "elite"},
        headers=auth_headers(sophie_token),
        timeout=30,
    )
    body2 = r.json() if r.status_code == 200 else {}
    sid2 = body2.get("session_id", "")
    url2 = body2.get("url", "")
    different = bool(sid2) and sid2 != ctx.get("pro_session_id")
    ok2 = r.status_code == 200 and url2.startswith("https://checkout.stripe.com") and sid2.startswith("cs_test_") and different
    record(
        "checkout plan=elite → 200 + different session than pro",
        ok2,
        f"status={r.status_code} session_id={sid2[:30]} different={different}",
    )
    ctx["elite_session_id"] = sid2

    # --- 1c: plan=gold → 400
    r = requests.post(
        f"{API}/billing/checkout",
        json={"plan": "gold"},
        headers=auth_headers(sophie_token),
        timeout=15,
    )
    record(
        "checkout plan=gold → 400",
        r.status_code == 400,
        f"status={r.status_code} body={r.text[:120]}",
    )

    # --- 1d: no auth → 401
    r = requests.post(f"{API}/billing/checkout", json={"plan": "pro"}, timeout=15)
    record(
        "checkout no auth → 401",
        r.status_code in (401, 403),
        f"status={r.status_code}",
    )

    # --- 1e: user doc now has stripe_customer_id (cus_*)
    user_doc = get_user_doc(sophie_user_id)
    cid = user_doc.get("stripe_customer_id") or ""
    record(
        "sophie user doc has stripe_customer_id starting cus_",
        isinstance(cid, str) and cid.startswith("cus_"),
        f"stripe_customer_id={cid[:30]}",
    )
    ctx["sophie_customer_id"] = cid

    # --- 1f: payment_transactions row exists for the pro session with status=initiated
    if ctx.get("pro_session_id"):
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        try:
            doc = client[DB_NAME].payment_transactions.find_one({"session_id": ctx["pro_session_id"]})
        finally:
            client.close()
        ok = bool(doc) and doc.get("status") == "initiated" and doc.get("user_id") == sophie_user_id
        record(
            "payment_transactions row created (status=initiated)",
            ok,
            f"found={bool(doc)} status={doc.get('status') if doc else None}",
        )
    else:
        record("payment_transactions row created (status=initiated)", False, "no session_id captured")

    return ctx


def test_billing_portal(sophie_token: str, fresh_token: str, fresh_user_id: str) -> None:
    print("\n[2/4] POST /api/billing/portal")

    # --- 2a: auth'd sophie → 200 + billing.stripe.com url
    r = requests.post(f"{API}/billing/portal", json={}, headers=auth_headers(sophie_token), timeout=30)
    body = r.json() if r.status_code == 200 else {}
    url = body.get("url", "")
    ok = r.status_code == 200 and url.startswith("https://billing.stripe.com")
    record("portal (auth'd) → 200 + billing.stripe.com URL", ok, f"status={r.status_code} url={url[:60]}")

    # --- 2b: no auth → 401
    r = requests.post(f"{API}/billing/portal", json={}, timeout=10)
    record("portal no auth → 401", r.status_code in (401, 403), f"status={r.status_code}")

    # --- 2c: brand-new user with no prior stripe activity → still 200 (lazy create)
    r = requests.post(f"{API}/billing/portal", json={}, headers=auth_headers(fresh_token), timeout=30)
    body = r.json() if r.status_code == 200 else {}
    url = body.get("url", "")
    ok = r.status_code == 200 and url.startswith("https://billing.stripe.com")
    record(
        "portal for first-time user → 200 (customer lazily created)",
        ok,
        f"status={r.status_code} url={url[:60]}",
    )

    # confirm fresh user now has stripe_customer_id
    fresh_doc = get_user_doc(fresh_user_id)
    fresh_cid = fresh_doc.get("stripe_customer_id") or ""
    record(
        "first-time user now has stripe_customer_id cus_*",
        isinstance(fresh_cid, str) and fresh_cid.startswith("cus_"),
        f"stripe_customer_id={fresh_cid[:30]}",
    )


def test_billing_status(sophie_token: str) -> None:
    print("\n[3/4] GET /api/billing/status")

    required_keys = {
        "plan",
        "billing_status",
        "stripe_customer_id",
        "stripe_subscription_id",
        "renewal_date",
        "canceled_at",
        "cancel_at_period_end",
        "payment_failed_at",
        "payment_method",
        "invoices",
    }

    # --- 3a: auth'd sophie
    r = requests.get(f"{API}/billing/status", headers=auth_headers(sophie_token), timeout=30)
    ok = r.status_code == 200
    body = r.json() if ok else {}
    missing = required_keys - set(body.keys()) if isinstance(body, dict) else required_keys
    record(
        "status (auth'd sophie) → 200 with all documented keys",
        ok and not missing and isinstance(body.get("invoices"), list),
        f"status={r.status_code} missing_keys={sorted(missing)} invoices_type={type(body.get('invoices')).__name__}",
    )

    # --- 3b: brand-new user, never any stripe interaction → 200, payment_method=null, invoices=[], no 500
    fresh_token, fresh_user = register_fresh_user()
    r = requests.get(f"{API}/billing/status", headers=auth_headers(fresh_token), timeout=30)
    ok = r.status_code == 200
    body = r.json() if ok else {}
    pm_null = body.get("payment_method") is None
    inv_empty = body.get("invoices") == []
    no_stripe = body.get("stripe_customer_id") in (None, "")
    record(
        "status for brand-new user (no stripe) → 200, pm=null, invoices=[], no 500",
        ok and pm_null and inv_empty and no_stripe,
        f"status={r.status_code} pm={body.get('payment_method')} invoices_len={len(body.get('invoices', []))} cid={body.get('stripe_customer_id')}",
    )

    # --- 3c: no auth → 401
    r = requests.get(f"{API}/billing/status", timeout=10)
    record("status no auth → 401", r.status_code in (401, 403), f"status={r.status_code}")


def test_webhook(sophie_user_id: str, sophie_customer_id: str) -> None:
    print("\n[4/4] POST /api/webhook/stripe (raw, no signature — test mode)")

    headers = {"Content-Type": "application/json"}

    if not sophie_customer_id.startswith("cus_"):
        record(
            "webhook customer.subscription.updated sets plan=pro/billing=active/renewal_date",
            False,
            "no sophie_customer_id to run webhook tests against",
        )
        return

    # --- 4a: customer.subscription.updated (active, pro price) → plan=pro, billing_status=active
    evt = {
        "id": f"evt_test_{uuid.uuid4().hex[:8]}",
        "type": "customer.subscription.updated",
        "livemode": False,
        "data": {
            "object": {
                "id": "sub_test_qa_1",
                "object": "subscription",
                "customer": sophie_customer_id,
                "status": "active",
                "current_period_end": 4102444800,  # year 2100
                "cancel_at_period_end": False,
                "items": {
                    "data": [
                        {"price": {"id": PRO_PRICE_ID, "product": "prod_pro"}}
                    ]
                },
                "metadata": {"user_id": sophie_user_id},
            }
        },
    }
    r = requests.post(WEBHOOK_URL, data=json.dumps(evt), headers=headers, timeout=15)
    ok_code = r.status_code == 200
    body = r.json() if ok_code else {}
    record(
        "webhook subscription.updated → 200",
        ok_code and body.get("received") is True and body.get("type") == "customer.subscription.updated",
        f"status={r.status_code} body={r.text[:160]}",
    )

    # Give the handler a moment (synchronous but just in case)
    time.sleep(0.4)
    user = get_user_doc(sophie_user_id)
    plan_now = user.get("plan")
    billing_status = user.get("billing_status")
    renewal = user.get("renewal_date")
    record(
        "after subscription.updated: sophie plan=pro, billing_status=active, renewal_date set",
        plan_now == "pro" and billing_status == "active" and renewal is not None,
        f"plan={plan_now} billing_status={billing_status} renewal_date={renewal}",
    )

    # --- 4b: invoice.payment_failed → payment_failed_at set, billing_status=past_due
    evt = {
        "id": f"evt_test_{uuid.uuid4().hex[:8]}",
        "type": "invoice.payment_failed",
        "livemode": False,
        "data": {
            "object": {
                "id": "in_test_qa_1",
                "object": "invoice",
                "customer": sophie_customer_id,
            }
        },
    }
    r = requests.post(WEBHOOK_URL, data=json.dumps(evt), headers=headers, timeout=15)
    record(
        "webhook invoice.payment_failed → 200",
        r.status_code == 200,
        f"status={r.status_code} body={r.text[:120]}",
    )
    time.sleep(0.4)
    user = get_user_doc(sophie_user_id)
    record(
        "after invoice.payment_failed: payment_failed_at set, billing_status=past_due",
        user.get("payment_failed_at") is not None and user.get("billing_status") == "past_due",
        f"payment_failed_at={user.get('payment_failed_at')} billing_status={user.get('billing_status')}",
    )

    # --- 4c: customer.subscription.deleted → plan reverts to free
    evt = {
        "id": f"evt_test_{uuid.uuid4().hex[:8]}",
        "type": "customer.subscription.deleted",
        "livemode": False,
        "data": {
            "object": {
                "id": "sub_test_qa_1",
                "object": "subscription",
                "customer": sophie_customer_id,
                "status": "canceled",
                "cancel_at_period_end": False,
                "items": {"data": [{"price": {"id": PRO_PRICE_ID}}]},
                "metadata": {"user_id": sophie_user_id},
            }
        },
    }
    r = requests.post(WEBHOOK_URL, data=json.dumps(evt), headers=headers, timeout=15)
    record(
        "webhook subscription.deleted → 200",
        r.status_code == 200,
        f"status={r.status_code} body={r.text[:120]}",
    )
    time.sleep(0.4)
    user = get_user_doc(sophie_user_id)
    record(
        "after subscription.deleted: sophie plan=free",
        user.get("plan") == "free",
        f"plan={user.get('plan')} billing_status={user.get('billing_status')}",
    )

    # --- 4d: malformed body → 400
    r = requests.post(
        WEBHOOK_URL,
        data="this is not json {{{",
        headers={"Content-Type": "application/json"},
        timeout=10,
    )
    record(
        "webhook malformed body → 400",
        r.status_code == 400,
        f"status={r.status_code} body={r.text[:160]}",
    )


# ---------------------------- main ---------------------------------------------

def main() -> int:
    print(f"API base: {API}")

    # Auth
    sophie_token, sophie_user = login("sophie@photoscout.app", "demo123")
    sophie_user_id = sophie_user["user_id"]
    print(f"sophie user_id={sophie_user_id}")

    fresh_token, fresh_user = register_fresh_user()
    fresh_user_id = fresh_user["user_id"]
    print(f"fresh user_id={fresh_user_id} email={fresh_user['email']}")

    ctx = test_billing_checkout(sophie_token, sophie_user_id)
    test_billing_portal(sophie_token, fresh_token, fresh_user_id)
    test_billing_status(sophie_token)
    test_webhook(sophie_user_id, ctx.get("sophie_customer_id", ""))

    return summary()


if __name__ == "__main__":
    raise SystemExit(main())
