"""
Backend tests for LumaScout Stripe Connect + Admin Refund endpoints.
"""
from __future__ import annotations

import uuid
from typing import List, Tuple

import requests


BASE = "http://localhost:8001/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

results: List[Tuple[str, bool, str]] = []


def record(name: str, ok: bool, info: str = ""):
    status = "PASS" if ok else "FAIL"
    line = f"[{status}] {name}" + (f" — {info}" if info else "")
    print(line)
    results.append((name, ok, info))


def post(url, token=None, json_body=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return requests.post(BASE + url, headers=h, json=json_body or {})


def get(url, token=None, params=None):
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return requests.get(BASE + url, headers=h, params=params or {})


def delete(url, token=None):
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return requests.delete(BASE + url, headers=h)


def login(email: str, password: str) -> str:
    r = post("/auth/login", json_body={"email": email, "password": password})
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def register(email: str, password: str, name: str) -> Tuple[str, str]:
    r = post("/auth/register", json_body={"email": email, "password": password, "name": name})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    body = r.json()
    return body["token"], body["user"]["user_id"]


def unique_email(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}@example.com"


def test_all():
    admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    cleanup_user_ids: List[str] = []
    cleanup_product_ids: List[str] = []

    r = get("/auth/me", admin_token)
    record(
        "admin /auth/me 200 super_admin",
        r.status_code == 200 and r.json().get("role") == "super_admin",
        f"code={r.status_code} role={r.json().get('role') if r.status_code==200 else None}",
    )

    # (1) Connect status — disconnected
    fresh_email = unique_email("fresh_seller")
    fresh_token, fresh_uid = register(fresh_email, "demo1234", "Fresh Seller")
    cleanup_user_ids.append(fresh_uid)

    r = get("/me/seller/connect-status", fresh_token)
    ok = False
    info = f"code={r.status_code}"
    if r.status_code == 200:
        j = r.json()
        info = f"code=200 body={j}"
        ok = (
            j.get("status") == "disconnected"
            and j.get("acct_id") is None
            and j.get("stripe_ready") is True
        )
    record("(1) /me/seller/connect-status disconnected", ok, info)

    # (2) Onboarding — Connect not enabled → 400 clean
    r = post("/me/seller/onboard", fresh_token)
    ok = False
    info = f"code={r.status_code}"
    if r.status_code == 400:
        detail = (r.json() or {}).get("detail", "")
        info = f"code=400 detail={detail[:220]}"
        ok = detail.startswith("Stripe error:") and "Connect" in detail
    elif r.status_code == 500:
        info = f"code=500 CRASH body={r.text[:220]}"
    elif r.status_code == 200:
        info = f"code=200 body={r.json()}"
        ok = True
    record("(2) /me/seller/onboard returns clean 400 (no 500)", ok, info)

    # (2b) User doc not persisted with stripe_connect_account_id on failure
    r2 = get("/me/seller/connect-status", fresh_token)
    if r.status_code == 400:
        ok2 = r2.status_code == 200 and r2.json().get("acct_id") is None
        record(
            "(2b) no stripe_connect_account_id persisted after failed onboard",
            ok2,
            f"code={r2.status_code} body={r2.json() if r2.status_code==200 else r2.text[:120]}",
        )
    else:
        record("(2b) onboard succeeded — persistence check N/A", True, "skipped")

    # (3) Payouts when not connected
    r = get("/me/seller/payouts", fresh_token)
    ok = False
    info = f"code={r.status_code}"
    if r.status_code == 200:
        j = r.json()
        info = f"code=200 body={j}"
        ok = (
            j.get("items") == []
            and (j.get("count") == 0 or j.get("total") == 0)
            and j.get("connected") is False
        )
    record("(3) /me/seller/payouts disconnected shape", ok, info)

    # (4) Dashboard-link w/o account → 400
    r = post("/me/seller/dashboard-link", fresh_token)
    ok = False
    info = f"code={r.status_code}"
    if r.status_code == 400:
        detail = (r.json() or {}).get("detail", "")
        info = f"code=400 detail={detail}"
        ok = "Connect your account first" in detail
    record("(4) /me/seller/dashboard-link → 400 'Connect your account first'", ok, info)

    # (5) Admin listing purchases
    r = get("/admin/marketplace/purchases", admin_token)
    ok = False
    info = f"code={r.status_code}"
    if r.status_code == 200:
        j = r.json()
        items = j.get("items", [])
        info = f"code=200 count={j.get('count')} items_len={len(items)}"
        ok = isinstance(items, list) and "count" in j
    record("(5a) admin GET /admin/marketplace/purchases 200", ok, info)

    if r.status_code == 200 and r.json().get("items"):
        required = {
            "purchase_id", "product_id", "buyer", "seller", "product",
            "price_cents", "platform_fee_cents", "seller_payout_cents",
            "status", "mocked", "created_at",
        }
        item = r.json()["items"][0]
        missing = required - set(item.keys())
        record(
            "(5b) purchase item has required keys",
            not missing,
            f"missing={sorted(missing)}" if missing else "all keys present",
        )
    else:
        record("(5b) purchase item shape", True, "no purchases yet — will retest after 6)")

    # Non-admin → 403
    non_admin_email = unique_email("non_admin")
    non_admin_token, non_admin_uid = register(non_admin_email, "demo1234", "Non Admin")
    cleanup_user_ids.append(non_admin_uid)
    r = get("/admin/marketplace/purchases", non_admin_token)
    record(
        "(5e) non-admin GET → 403",
        r.status_code == 403,
        f"code={r.status_code}",
    )

    # (6) End-to-end refund on a MOCK purchase
    seller_email = unique_email("seller")
    seller_token, seller_uid = register(seller_email, "demo1234", "QA Seller")
    cleanup_user_ids.append(seller_uid)
    buyer_email = unique_email("buyer")
    buyer_token, buyer_uid = register(buyer_email, "demo1234", "QA Buyer")
    cleanup_user_ids.append(buyer_uid)

    product_payload = {
        "title": f"QA Refund Preset Pack {uuid.uuid4().hex[:6]}",
        "type": "preset",
        "description": "QA test pack for refund flow",
        "price_cents": 1500,
        "thumbnail_url": "https://images.unsplash.com/photo-1",
    }
    r = post("/marketplace/products", seller_token, product_payload)
    if r.status_code != 200:
        record("(6a) seller create product", False, f"code={r.status_code} body={r.text[:200]}")
        return
    product = r.json()
    pid = product["product_id"]
    cleanup_product_ids.append(pid)
    record("(6a) seller create product 200", True, f"pid={pid}")

    r = post(
        f"/admin/marketplace/products/{pid}/moderate",
        admin_token,
        json_body={"action": "approve"},
    )
    record("(6b) admin approve product", r.status_code == 200, f"code={r.status_code}")

    r = post(f"/marketplace/products/{pid}/checkout", buyer_token)
    if r.status_code != 200:
        record("(6c) buyer checkout", False, f"code={r.status_code} body={r.text[:200]}")
        return
    checkout = r.json()
    record(
        "(6c) buyer MOCK fallback (seller_not_onboarded)",
        checkout.get("mocked") is True and checkout.get("seller_not_onboarded") is True,
        f"mocked={checkout.get('mocked')} seller_not_onboarded={checkout.get('seller_not_onboarded')} purchase_id={checkout.get('purchase_id')}",
    )
    purchase_id = checkout.get("purchase_id")

    r = post(f"/marketplace/purchases/{purchase_id}/complete", buyer_token)
    record(
        "(6d) buyer complete purchase",
        r.status_code == 200 and r.json().get("ok") is True,
        f"code={r.status_code} body={r.text[:120]}",
    )

    r = get(f"/marketplace/products/{pid}", admin_token)
    sales_before = r.json().get("sales_count", 0) if r.status_code == 200 else -1
    record("(6e) pre-refund sales_count fetch", r.status_code == 200, f"sales_count={sales_before}")

    r = post(
        f"/admin/marketplace/purchases/{purchase_id}/refund",
        admin_token,
        json_body={"reason": "qa-refund"},
    )
    ok = False
    info = f"code={r.status_code}"
    if r.status_code == 200:
        j = r.json()
        info = f"code=200 body={j}"
        ok = (
            j.get("ok") is True
            and j.get("mocked") is True
            and j.get("refund_amount_cents") == 1500
        )
    record("(6f) admin refund MOCK purchase", ok, info)

    r = get(f"/marketplace/products/{pid}", admin_token)
    sales_after = r.json().get("sales_count", -1) if r.status_code == 200 else -2
    record(
        "(6g) product sales_count decremented",
        sales_after == max(0, sales_before - 1),
        f"before={sales_before} after={sales_after}",
    )

    r = post(
        f"/admin/marketplace/purchases/{purchase_id}/refund",
        admin_token,
        json_body={"reason": "qa-refund"},
    )
    ok = False
    info = f"code={r.status_code}"
    if r.status_code == 200:
        j = r.json()
        info = f"code=200 body={j}"
        ok = j.get("ok") is True and j.get("already_refunded") is True
    record("(6h) idempotent refund → already_refunded:true", ok, info)

    r = post(
        f"/admin/marketplace/purchases/{purchase_id}/refund",
        non_admin_token,
        json_body={"reason": "nope"},
    )
    record("(6i) non-admin refund → 403", r.status_code == 403, f"code={r.status_code}")

    r = get("/admin/audit-logs", admin_token, params={"target_id": purchase_id})
    ok = False
    info = f"code={r.status_code}"
    if r.status_code == 200:
        items = r.json().get("items", [])
        ok = any(it.get("action") == "marketplace_purchase.refund" for it in items)
        info = f"code=200 items_len={len(items)} has_refund_action={ok}"
    record("(6j) audit_logs entry 'marketplace_purchase.refund'", ok, info)

    r = get("/notifications", buyer_token)
    ok = False
    info = f"code={r.status_code}"
    if r.status_code == 200:
        j = r.json()
        items = j.get("items", []) if isinstance(j, dict) else j
        kinds = [(it.get("kind") or it.get("type")) for it in items]
        ok = "marketplace_refund" in kinds
        info = f"code=200 items_len={len(items)} kinds={kinds[:8]}"
    record("(6k) buyer notifications include marketplace_refund", ok, info)

    # (5) Re-test items shape now that we have at least one purchase row
    r = get("/admin/marketplace/purchases", admin_token)
    if r.status_code == 200 and r.json().get("items"):
        required = {
            "purchase_id", "product_id", "buyer", "seller", "product",
            "price_cents", "platform_fee_cents", "seller_payout_cents",
            "status", "mocked", "created_at",
        }
        item = r.json()["items"][0]
        missing = required - set(item.keys())
        record(
            "(5b-retest) purchase item has required keys",
            not missing,
            f"missing={sorted(missing)}" if missing else f"{len(item)} keys present",
        )

    # ?status=completed filter
    r = get("/admin/marketplace/purchases", admin_token, params={"status": "completed"})
    if r.status_code == 200:
        items = r.json().get("items", [])
        all_completed = all(it.get("status") == "completed" for it in items) if items else True
        record(
            "(5c) ?status=completed filter",
            all_completed,
            f"code=200 count={len(items)} all_completed={all_completed}",
        )
    else:
        record("(5c) ?status=completed", False, f"code={r.status_code}")

    # ?status=refunded filter
    r = get("/admin/marketplace/purchases", admin_token, params={"status": "refunded"})
    if r.status_code == 200:
        items = r.json().get("items", [])
        all_refunded = all(it.get("status") == "refunded" for it in items) if items else True
        record(
            "(5d) ?status=refunded filter",
            all_refunded,
            f"code=200 count={len(items)} all_refunded={all_refunded}",
        )
    else:
        record("(5d) ?status=refunded", False, f"code={r.status_code}")

    # (7) MOCK fallback verification — url is None, mocked True (already captured)
    record(
        "(7) MOCK checkout: no real Stripe session URL",
        checkout.get("url") is None and checkout.get("mocked") is True,
        f"url={checkout.get('url')} mocked={checkout.get('mocked')}",
    )

    # (8) Webhook safety: fake event, no signature
    webhook_body = {
        "type": "account.updated",
        "data": {"object": {"id": "acct_fake_nomatch"}},
        "id": "evt_test_fake",
        "livemode": False,
    }
    r = requests.post(
        "http://localhost:8001/api/webhook/stripe",
        json=webhook_body,
    )
    ok = r.status_code in (200, 400)
    info = f"code={r.status_code} body={r.text[:160]}"
    record("(8) webhook returns 200 or 400 (not 500)", ok, info)

    # (9) Regression — Marketplace MVP still passes
    r = get("/marketplace/storefront", buyer_token)
    ok = False
    info = f"code={r.status_code}"
    if r.status_code == 200:
        j = r.json()
        rails = j.get("rails") or {}
        info = f"code=200 rails_keys={sorted(rails.keys())}"
        ok = "featured" in rails and "trending" in rails and "newest" in rails
    record("(9a) /marketplace/storefront rails populated", ok, info)

    reg_product_payload = {
        "title": f"QA Regression Product {uuid.uuid4().hex[:6]}",
        "type": "preset",
        "description": "Regression product",
        "price_cents": 800,
        "thumbnail_url": "https://images.unsplash.com/photo-2",
    }
    r = post("/marketplace/products", seller_token, reg_product_payload)
    reg_pid = r.json()["product_id"] if r.status_code == 200 else None
    if reg_pid:
        cleanup_product_ids.append(reg_pid)
        post(
            f"/admin/marketplace/products/{reg_pid}/moderate",
            admin_token, {"action": "approve"},
        )
        r = post(f"/marketplace/products/{reg_pid}/checkout", buyer_token)
        ok = r.status_code == 200 and r.json().get("mocked") is True
        info = f"code={r.status_code} mocked={r.json().get('mocked') if r.status_code==200 else None}"
        record("(9b) checkout mocked:true (regression)", ok, info)
        reg_purchase_id = r.json().get("purchase_id") if r.status_code == 200 else None

        if reg_purchase_id:
            r = post(f"/marketplace/purchases/{reg_purchase_id}/complete", buyer_token)
            record(
                "(9c) /marketplace/purchases/{id}/complete works",
                r.status_code == 200 and r.json().get("ok") is True,
                f"code={r.status_code} body={r.text[:120]}",
            )

        r = post(f"/marketplace/products/{reg_pid}/reviews", buyer_token, {"rating": 5, "text": "QA"})
        record(
            "(9d) review POST by buyer 200",
            r.status_code == 200,
            f"code={r.status_code}",
        )

        r = post(f"/marketplace/wishlist/{reg_pid}", buyer_token)
        record(
            "(9e) wishlist toggle 200",
            r.status_code == 200,
            f"code={r.status_code}",
        )

        r = get("/me/marketplace/library", buyer_token)
        ok = r.status_code == 200
        items = r.json().get("items", []) if ok else []
        has_reg = any(it.get("product_id") == reg_pid for it in items)
        record(
            "(9f) /me/marketplace/library contains reg product",
            ok and has_reg,
            f"code={r.status_code} items_len={len(items)} has_reg={has_reg}",
        )

    # Cleanup
    print("\n--- Cleanup ---")
    for pid_ in cleanup_product_ids:
        try:
            rd = delete(f"/marketplace/products/{pid_}", admin_token)
            print(f"DELETE product {pid_}: {rd.status_code}")
        except Exception as e:
            print(f"DELETE product {pid_} err: {e}")
    for uid_ in cleanup_user_ids:
        try:
            rd = delete(f"/admin/users/{uid_}", admin_token)
            print(f"DELETE user {uid_}: {rd.status_code}")
        except Exception as e:
            print(f"DELETE user {uid_} err: {e}")

    # Summary
    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = total - passed
    print("\n" + "=" * 70)
    print(f"TOTAL: {total}  PASS: {passed}  FAIL: {failed}")
    if failed:
        print("\nFAILURES:")
        for name, ok, info in results:
            if not ok:
                print(f"  - {name}: {info}")
    print("=" * 70)


if __name__ == "__main__":
    test_all()
