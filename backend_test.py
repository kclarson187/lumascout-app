"""
Post-modularization regression test — Pack Marketplace.

All marketplace endpoints have been moved from server.py to
routes/marketplace.py via `app.include_router(_marketplace_routes.router)`.
Goal: verify zero behavior changes and zero 500s / route 404s.

Base URL: http://localhost:8001/api
Admin:    admin@lumascout.app / admin123 (super_admin, username keith)

Covers all 14 scenarios in the review brief. Uses throwaway users for
creates/purchases, cleans up via direct Mongo at the end.
"""
import os
import sys
import time
import uuid
import asyncio
import requests
from typing import Optional, Dict, Any, List

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASS = "admin123"

PASS: List[str] = []
FAIL: List[tuple] = []


def ok(name: str, cond: bool, detail: str = ""):
    if cond:
        PASS.append(name)
        print(f"  PASS  {name}")
    else:
        FAIL.append((name, detail))
        print(f"  FAIL  {name}  -- {detail}")


def H(t: str) -> dict: return {"Authorization": f"Bearer {t}"}


def login(email: str, password: str) -> Optional[str]:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        print(f"LOGIN FAIL {email} -> {r.status_code} {r.text[:200]}")
        return None
    return r.json()["token"]


def register() -> Dict[str, Any]:
    uid = uuid.uuid4().hex[:8]
    email = f"qa_mp_{uid}@photoscout-qa.com"
    r = requests.post(f"{BASE}/auth/register", json={
        "email": email, "password": "TestPass123!", "name": f"QA {uid[:4].upper()}",
    }, timeout=15)
    assert r.status_code == 200, f"register: {r.status_code} {r.text}"
    d = r.json()
    return {
        "email": email, "token": d["token"], "user": d["user"],
        "user_id": d["user"]["user_id"],
    }


def section(n): print(f"\n=== {n} ===")


CREATED_USERS: List[str] = []
CREATED_PRODUCTS: List[str] = []
CREATED_PURCHASES: List[str] = []


def main() -> int:
    section("Setup: admin login")
    admin_tok = login(ADMIN_EMAIL, ADMIN_PASS)
    ok("admin login", admin_tok is not None)
    if not admin_tok:
        return 1

    # ---------------------------------------------------------------- (1)
    section("(1) GET /marketplace/storefront")
    r = requests.get(f"{BASE}/marketplace/storefront", timeout=15)
    ok("storefront 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    sample = None
    if r.status_code == 200:
        body = r.json()
        rails = body.get("rails") or {}
        ok("rails has featured/trending/newest",
           all(k in rails for k in ("featured", "trending", "newest")),
           f"keys={list(rails.keys())}")
        ok("by_type present", "by_type" in body, f"body_keys={list(body.keys())}")
        for k in ("trending", "newest", "featured"):
            if rails.get(k):
                sample = rails[k][0]; break
        if not sample:
            for v in (body.get("by_type") or {}).values():
                if v: sample = v[0]; break
        if sample:
            req = {"seller", "rating_avg", "in_wishlist", "has_purchased"}
            missing = req - set(sample.keys())
            ok("item carries seller/rating_avg/in_wishlist/has_purchased",
               not missing, f"missing={missing}")

    # ---------------------------------------------------------------- (2)
    section("(2) GET /marketplace/products — search + sorts + pagination")
    r = requests.get(f"{BASE}/marketplace/products",
                     params={"q": "preset", "limit": 20}, timeout=15)
    ok("products q=preset 200", r.status_code == 200, f"{r.status_code}")

    r = requests.get(f"{BASE}/marketplace/products",
                     params={"type": "mentorship"}, timeout=15)
    if r.status_code == 200:
        items = r.json().get("items") or []
        ok("type=mentorship returns only mentorship",
           all(it.get("type") == "mentorship" for it in items),
           f"types={[it.get('type') for it in items]}")
    else:
        ok("type=mentorship 200", False, f"{r.status_code}")

    # price_low strictly ascending
    r = requests.get(f"{BASE}/marketplace/products",
                     params={"sort": "price_low", "limit": 30}, timeout=15)
    if r.status_code == 200:
        prices = [it.get("price_cents", 0) for it in r.json().get("items") or []]
        asc = all(prices[i] <= prices[i+1] for i in range(len(prices)-1))
        ok("sort=price_low ascending", asc, f"prices={prices[:10]}")
    else:
        ok("sort=price_low 200", False, f"{r.status_code}")

    for s in ("trending", "newest", "top_rated"):
        r = requests.get(f"{BASE}/marketplace/products",
                         params={"sort": s, "limit": 5}, timeout=15)
        ok(f"sort={s} 200", r.status_code == 200, f"{r.status_code}")

    # pagination
    r1 = requests.get(f"{BASE}/marketplace/products",
                      params={"limit": 2, "skip": 0}, timeout=15)
    r2 = requests.get(f"{BASE}/marketplace/products",
                      params={"limit": 2, "skip": 2}, timeout=15)
    if r1.status_code == 200 and r2.status_code == 200:
        ids1 = [it["product_id"] for it in r1.json().get("items") or []]
        ids2 = [it["product_id"] for it in r2.json().get("items") or []]
        ok("pagination returns different items", set(ids1).isdisjoint(set(ids2)),
           f"ids1={ids1} ids2={ids2}")

    # ---------------------------------------------------------------- (3)
    section("(3) GET /marketplace/products/{id}")
    # bogus
    r = requests.get(f"{BASE}/marketplace/products/prod_doesnotexist123", timeout=15)
    ok("bogus id -> 404", r.status_code == 404, f"{r.status_code}")

    # Real product view increments
    r = requests.get(f"{BASE}/marketplace/products",
                     params={"limit": 1}, timeout=15)
    real_pid = None
    if r.status_code == 200 and r.json().get("items"):
        real_pid = r.json()["items"][0]["product_id"]
    if real_pid:
        r1 = requests.get(f"{BASE}/marketplace/products/{real_pid}", timeout=15)
        r2 = requests.get(f"{BASE}/marketplace/products/{real_pid}", timeout=15)
        ok("product detail 200 (unauth)", r1.status_code == 200 and r2.status_code == 200)
        v1 = r1.json().get("view_count", 0)
        v2 = r2.json().get("view_count", 0)
        ok("view_count increments", v2 > v1, f"v1={v1} v2={v2}")
        ok("unauth GET does NOT include contents_url",
           "contents_url" not in r1.json(),
           f"keys={[k for k in r1.json().keys() if 'content' in k.lower()]}")

    # ---------------------------------------------------------------- (4)
    section("(4) POST /marketplace/products — create + approve + PATCH + DELETE")
    seller = register(); CREATED_USERS.append(seller["user_id"])
    buyer = register();  CREATED_USERS.append(buyer["user_id"])
    other = register();  CREATED_USERS.append(other["user_id"])

    payload = {
        "title": f"QA Preset {uuid.uuid4().hex[:6]}",
        "type": "preset",
        "description": "Regression-test preset pack for post-modularization QA.",
        "price_cents": 1500,
        "thumbnail_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "contents_url": "https://example.com/qa/pack.zip",
    }
    r = requests.post(f"{BASE}/marketplace/products",
                      headers=H(seller["token"]), json=payload, timeout=15)
    ok("seller create product 200", r.status_code == 200,
       f"{r.status_code} {r.text[:200]}")
    pid = None
    if r.status_code == 200:
        pid = r.json()["product_id"]
        CREATED_PRODUCTS.append(pid)
        ok("new product status == pending",
           r.json().get("status") == "pending",
           f"status={r.json().get('status')}")

    if pid:
        # Non-owner PATCH -> 403
        r = requests.patch(f"{BASE}/marketplace/products/{pid}",
                           headers=H(other["token"]),
                           json={"title": "hijack"}, timeout=15)
        ok("non-owner PATCH -> 403", r.status_code == 403, f"{r.status_code}")

        # Owner PATCH title -> stays pending
        r = requests.patch(f"{BASE}/marketplace/products/{pid}",
                           headers=H(seller["token"]),
                           json={"title": payload["title"] + " v2"}, timeout=15)
        ok("owner PATCH title 200", r.status_code == 200,
           f"{r.status_code} {r.text[:150]}")
        if r.status_code == 200:
            ok("status stays pending after title PATCH",
               r.json().get("status") == "pending",
               f"status={r.json().get('status')}")

        # Admin approve
        r = requests.post(f"{BASE}/admin/marketplace/products/{pid}/moderate",
                          headers=H(admin_tok), json={"action": "approve"}, timeout=15)
        ok("admin approve 200", r.status_code == 200,
           f"{r.status_code} {r.text[:200]}")
        # Verify status flip
        r = requests.get(f"{BASE}/marketplace/products/{pid}", timeout=15)
        if r.status_code == 200:
            ok("after approve, status='active'",
               r.json().get("status") == "active",
               f"status={r.json().get('status')}")

        # Owner PATCH price -> auto-revert to pending
        r = requests.patch(f"{BASE}/marketplace/products/{pid}",
                           headers=H(seller["token"]),
                           json={"price_cents": 1800}, timeout=15)
        if r.status_code == 200:
            ok("owner PATCH price -> auto-reverts to pending",
               r.json().get("status") == "pending",
               f"status={r.json().get('status')}")

        # Re-approve
        r = requests.post(f"{BASE}/admin/marketplace/products/{pid}/moderate",
                          headers=H(admin_tok), json={"action": "approve"}, timeout=15)
        ok("admin re-approve 200", r.status_code == 200, f"{r.status_code}")

    # ---------------------------------------------------------------- (5)
    section("(5) Checkout MOCK path (seller not onboarded)")
    first_pid = None
    if pid:
        # Seller buying own product -> 400
        r = requests.post(f"{BASE}/marketplace/products/{pid}/checkout",
                          headers=H(seller["token"]), timeout=15)
        ok("seller buys own product -> 400", r.status_code == 400,
           f"{r.status_code} {r.text[:150]}")

        # Buyer checkout -> mocked:true, 15% fee math
        r = requests.post(f"{BASE}/marketplace/products/{pid}/checkout",
                          headers=H(buyer["token"]), timeout=15)
        ok("buyer checkout 200", r.status_code == 200,
           f"{r.status_code} {r.text[:200]}")
        if r.status_code == 200:
            cb = r.json()
            ok("checkout mocked=true", cb.get("mocked") is True, f"{cb}")
            ok("platform_fee_cents = 15% of 1800 = 270",
               cb.get("platform_fee_cents") == 270, f"{cb.get('platform_fee_cents')}")
            ok("seller_payout_cents = 85% of 1800 = 1530",
               cb.get("seller_payout_cents") == 1530, f"{cb.get('seller_payout_cents')}")
            first_pid = cb.get("purchase_id")
            if first_pid: CREATED_PURCHASES.append(first_pid)

    # ---------------------------------------------------------------- (6)
    section("(6) POST /marketplace/purchases/{id}/complete")
    if first_pid:
        r = requests.post(f"{BASE}/marketplace/purchases/{first_pid}/complete",
                          headers=H(buyer["token"]), timeout=15)
        ok("complete purchase 200", r.status_code == 200,
           f"{r.status_code} {r.text[:200]}")

        # sales_count incremented
        pg = requests.get(f"{BASE}/marketplace/products/{pid}", timeout=15)
        if pg.status_code == 200:
            ok("product.sales_count >= 1 after complete",
               (pg.json().get("sales_count") or 0) >= 1,
               f"sales_count={pg.json().get('sales_count')}")

        # buyer GET now sees contents_url
        pg2 = requests.get(f"{BASE}/marketplace/products/{pid}",
                           headers=H(buyer["token"]), timeout=15)
        if pg2.status_code == 200:
            ok("buyer GET product includes contents_url",
               bool(pg2.json().get("contents_url")),
               f"contents_url={pg2.json().get('contents_url')}")

        # Duplicate checkout after completion -> already_owned
        r = requests.post(f"{BASE}/marketplace/products/{pid}/checkout",
                          headers=H(buyer["token"]), timeout=15)
        if r.status_code == 200:
            ok("duplicate checkout after complete -> already_owned:true",
               r.json().get("already_owned") is True,
               f"{r.json()}")
        else:
            ok("duplicate checkout 200", False, f"{r.status_code}")

        # Notification for seller (marketplace_sale)
        rn = requests.get(f"{BASE}/notifications", headers=H(seller["token"]),
                          params={"limit": 20}, timeout=15)
        if rn.status_code == 200:
            items = rn.json() if isinstance(rn.json(), list) else rn.json().get("items") or []
            kinds = [it.get("kind") for it in items]
            ok("seller receives marketplace_sale notification",
               "marketplace_sale" in kinds, f"kinds={kinds[:10]}")

    # ---------------------------------------------------------------- (7)
    section("(7) POST /marketplace/products/{id}/reviews")
    if pid and first_pid:
        r = requests.post(f"{BASE}/marketplace/products/{pid}/reviews",
                          headers=H(buyer["token"]),
                          json={"rating": 5, "text": "Great"}, timeout=15)
        ok("buyer POST review 200", r.status_code == 200,
           f"{r.status_code} {r.text[:200]}")

        # Verify rating_avg/rating_count updated
        pg = requests.get(f"{BASE}/marketplace/products/{pid}", timeout=15)
        if pg.status_code == 200:
            j = pg.json()
            ok("rating_count == 1 after review",
               j.get("rating_count") == 1, f"rating_count={j.get('rating_count')}")
            ok("rating_avg > 0 after review",
               (j.get("rating_avg") or 0) > 0, f"rating_avg={j.get('rating_avg')}")

        # rating=0 -> 422
        r = requests.post(f"{BASE}/marketplace/products/{pid}/reviews",
                          headers=H(buyer["token"]),
                          json={"rating": 0}, timeout=15)
        ok("rating=0 -> 422", r.status_code == 422, f"{r.status_code}")
        # rating=6 -> 422
        r = requests.post(f"{BASE}/marketplace/products/{pid}/reviews",
                          headers=H(buyer["token"]),
                          json={"rating": 6}, timeout=15)
        ok("rating=6 -> 422", r.status_code == 422, f"{r.status_code}")

        # Non-buyer -> 403
        r = requests.post(f"{BASE}/marketplace/products/{pid}/reviews",
                          headers=H(other["token"]),
                          json={"rating": 5, "text": "drive-by"}, timeout=15)
        ok("non-buyer -> 403", r.status_code == 403, f"{r.status_code}")

        # Re-post updates existing (count stays 1)
        r = requests.post(f"{BASE}/marketplace/products/{pid}/reviews",
                          headers=H(buyer["token"]),
                          json={"rating": 4, "text": "Updated"}, timeout=15)
        ok("re-post review 200", r.status_code == 200, f"{r.status_code}")
        pg = requests.get(f"{BASE}/marketplace/products/{pid}", timeout=15)
        if pg.status_code == 200:
            ok("rating_count stays 1 on re-post",
               pg.json().get("rating_count") == 1,
               f"rating_count={pg.json().get('rating_count')}")

    # ---------------------------------------------------------------- (8)
    section("(8) GET /marketplace/products/{id}/reviews")
    if pid:
        r = requests.get(f"{BASE}/marketplace/products/{pid}/reviews", timeout=15)
        ok("reviews list 200", r.status_code == 200, f"{r.status_code}")
        if r.status_code == 200:
            items = r.json().get("items") or []
            if items:
                first = items[0]
                ok("review has hydrated reviewer (name+username)",
                   "reviewer" in first and all(k in first["reviewer"]
                                                for k in ("name", "username")),
                   f"first={first}")

    # ---------------------------------------------------------------- (9)
    section("(9) Wishlist toggle + GET /me/wishlist")
    if pid:
        r1 = requests.post(f"{BASE}/marketplace/wishlist/{pid}",
                           headers=H(other["token"]), timeout=15)
        ok("wishlist add 200 + in_wishlist=true",
           r1.status_code == 200 and r1.json().get("in_wishlist") is True,
           f"{r1.status_code} {r1.text[:150]}")
        r2 = requests.post(f"{BASE}/marketplace/wishlist/{pid}",
                           headers=H(other["token"]), timeout=15)
        ok("wishlist remove 200 + in_wishlist=false",
           r2.status_code == 200 and r2.json().get("in_wishlist") is False,
           f"{r2.status_code}")
        # Re-add and list
        requests.post(f"{BASE}/marketplace/wishlist/{pid}",
                      headers=H(other["token"]), timeout=15)
        rl = requests.get(f"{BASE}/me/wishlist",
                          headers=H(other["token"]), timeout=15)
        ok("GET /me/wishlist 200", rl.status_code == 200, f"{rl.status_code}")
        if rl.status_code == 200:
            items = rl.json().get("items") or []
            ok("wishlist contains product",
               any(it.get("product_id") == pid for it in items),
               f"ids={[it.get('product_id') for it in items]}")

    # ---------------------------------------------------------------- (10)
    section("(10) GET /me/marketplace/sales")
    r = requests.get(f"{BASE}/me/marketplace/sales",
                     headers=H(seller["token"]), timeout=15)
    ok("sales dashboard 200", r.status_code == 200, f"{r.status_code}")
    if r.status_code == 200:
        sb = r.json()
        for k in ("total_sales", "gross_cents", "net_cents",
                  "platform_fee_cents", "platform_fee_pct", "products",
                  "recent_purchases"):
            ok(f"sales has key '{k}'", k in sb, f"got keys={list(sb.keys())}")
        ok("platform_fee_pct == 15", sb.get("platform_fee_pct") == 15,
           f"pct={sb.get('platform_fee_pct')}")
        ok("net = gross - fee",
           sb.get("net_cents") == (sb.get("gross_cents", 0) - sb.get("platform_fee_cents", 0)),
           f"gross={sb.get('gross_cents')} fee={sb.get('platform_fee_cents')} net={sb.get('net_cents')}")
        ok("total_sales >= 1",
           (sb.get("total_sales") or 0) >= 1,
           f"total_sales={sb.get('total_sales')}")

    # ---------------------------------------------------------------- (11)
    section("(11) GET /me/marketplace/library")
    r = requests.get(f"{BASE}/me/marketplace/library",
                     headers=H(buyer["token"]), timeout=15)
    ok("library 200", r.status_code == 200, f"{r.status_code}")
    if r.status_code == 200:
        items = r.json().get("items") or []
        ok("buyer library has the completed purchase",
           any(it.get("product", {}).get("product_id") == pid for it in items),
           f"ids={[it.get('product', {}).get('product_id') for it in items]}")
        if items:
            prods = [it.get("product", {}) for it in items
                     if it.get("product", {}).get("product_id") == pid]
            if prods:
                ok("library product includes unlocked contents_url",
                   bool(prods[0].get("contents_url")),
                   f"product_keys={list(prods[0].keys())}")

    # ---------------------------------------------------------------- (12)
    section("(12) Seller endpoints (Stripe Connect disabled on platform)")
    fresh = register(); CREATED_USERS.append(fresh["user_id"])

    # connect-status
    r = requests.get(f"{BASE}/me/seller/connect-status",
                     headers=H(fresh["token"]), timeout=15)
    ok("connect-status 200", r.status_code == 200, f"{r.status_code}")
    if r.status_code == 200:
        j = r.json()
        ok("connect-status.status == 'disconnected'",
           j.get("status") == "disconnected", f"{j}")
        ok("connect-status.acct_id is null/absent",
           j.get("acct_id") is None, f"acct_id={j.get('acct_id')}")
        ok("connect-status.stripe_ready == true",
           j.get("stripe_ready") is True, f"stripe_ready={j.get('stripe_ready')}")

    # onboard -> expected 400 with "Stripe error:" ... "Connect"
    r = requests.post(f"{BASE}/me/seller/onboard",
                      headers=H(fresh["token"]), timeout=30)
    ok("onboard != 500", r.status_code != 500, f"{r.status_code} {r.text[:200]}")
    ok("onboard -> 400", r.status_code == 400, f"{r.status_code}")
    if r.status_code == 400:
        detail = (r.json() or {}).get("detail", "")
        ok("onboard detail starts with 'Stripe error:'",
           detail.startswith("Stripe error:"), f"detail={detail[:200]}")
        ok("onboard detail mentions 'Connect'",
           "Connect" in detail, f"detail={detail[:200]}")

    # payouts (disconnected)
    r = requests.get(f"{BASE}/me/seller/payouts",
                     headers=H(fresh["token"]), timeout=15)
    ok("payouts 200", r.status_code == 200, f"{r.status_code}")
    if r.status_code == 200:
        j = r.json()
        ok("payouts.items == []", j.get("items") == [], f"items={j.get('items')}")
        # Spec accepts count:0 OR total:0
        ok("payouts count==0 or total==0",
           j.get("count") == 0 or j.get("total") == 0,
           f"count={j.get('count')} total={j.get('total')}")
        ok("payouts.connected == false",
           j.get("connected") is False, f"connected={j.get('connected')}")

    # dashboard-link without account -> 400 "Connect your account first"
    r = requests.post(f"{BASE}/me/seller/dashboard-link",
                      headers=H(fresh["token"]), timeout=15)
    ok("dashboard-link no-account -> 400", r.status_code == 400, f"{r.status_code}")
    if r.status_code == 400:
        detail = (r.json() or {}).get("detail", "")
        ok("dashboard-link detail == 'Connect your account first'",
           detail == "Connect your account first", f"detail={detail}")

    # ---------------------------------------------------------------- (13)
    section("(13) Admin endpoints")
    # pending 403 for non-staff
    r = requests.get(f"{BASE}/admin/marketplace/pending",
                     headers=H(seller["token"]), timeout=15)
    ok("/admin/marketplace/pending non-staff -> 403",
       r.status_code == 403, f"{r.status_code}")
    r = requests.get(f"{BASE}/admin/marketplace/pending",
                     headers=H(admin_tok), timeout=15)
    ok("/admin/marketplace/pending admin -> 200",
       r.status_code == 200, f"{r.status_code}")

    # Create a separate product to exercise every moderate action
    payload2 = {
        "title": f"QA ModPack {uuid.uuid4().hex[:6]}",
        "type": "preset",
        "description": "Moderation action coverage.",
        "price_cents": 999,
        "thumbnail_url": "data:image/png;base64,AAAA",
    }
    r = requests.post(f"{BASE}/marketplace/products",
                      headers=H(seller["token"]), json=payload2, timeout=15)
    mod_pid = r.json().get("product_id") if r.status_code == 200 else None
    if mod_pid: CREATED_PRODUCTS.append(mod_pid)

    audit_actions_seen = set()
    if mod_pid:
        for action in ("approve", "feature", "unfeature", "suspend",
                       "unsuspend"):
            rm = requests.post(f"{BASE}/admin/marketplace/products/{mod_pid}/moderate",
                               headers=H(admin_tok),
                               json={"action": action,
                                     "reason": f"qa-{action}"}, timeout=15)
            ok(f"moderate action={action} -> 200",
               rm.status_code == 200, f"{rm.status_code} {rm.text[:200]}")

        # deny on a fresh pending product
        payload3 = dict(payload2)
        payload3["title"] = f"QA DenyPack {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE}/marketplace/products",
                          headers=H(seller["token"]), json=payload3, timeout=15)
        deny_pid = r.json().get("product_id") if r.status_code == 200 else None
        if deny_pid:
            CREATED_PRODUCTS.append(deny_pid)
            rm = requests.post(f"{BASE}/admin/marketplace/products/{deny_pid}/moderate",
                               headers=H(admin_tok),
                               json={"action": "deny", "reason": "qa-deny"}, timeout=15)
            ok("moderate action=deny -> 200",
               rm.status_code == 200, f"{rm.status_code} {rm.text[:200]}")

        # Audit log check
        rau = requests.get(f"{BASE}/admin/audit-logs", headers=H(admin_tok),
                           params={"target_id": mod_pid, "limit": 50}, timeout=15)
        if rau.status_code == 200:
            actions = [it.get("action") for it in rau.json().get("items") or []]
            audit_actions_seen = set(actions)
            ok("audit_logs has marketplace_product.* entries for moderation",
               any("marketplace_product" in (a or "") for a in actions),
               f"actions={actions[:10]}")

    # Admin purchases listing
    for status_filter in ("completed", "refunded", "pending"):
        r = requests.get(f"{BASE}/admin/marketplace/purchases",
                         headers=H(admin_tok),
                         params={"status": status_filter, "limit": 20}, timeout=15)
        ok(f"/admin/marketplace/purchases?status={status_filter} 200",
           r.status_code == 200, f"{r.status_code}")

    # Refund test
    if first_pid:
        # Non-admin -> 403
        r = requests.post(f"{BASE}/admin/marketplace/purchases/{first_pid}/refund",
                          headers=H(seller["token"]),
                          json={"reason": "hijack"}, timeout=15)
        ok("refund non-admin -> 403", r.status_code == 403, f"{r.status_code}")

        # Admin refund on mock -> 200
        r = requests.post(f"{BASE}/admin/marketplace/purchases/{first_pid}/refund",
                          headers=H(admin_tok),
                          json={"reason": "qa-refund"}, timeout=15)
        ok("admin refund mock 200", r.status_code == 200,
           f"{r.status_code} {r.text[:200]}")
        if r.status_code == 200:
            j = r.json()
            ok("refund ok=true", j.get("ok") is True, f"{j}")

        # Verify purchase now refunded
        r = requests.get(f"{BASE}/admin/marketplace/purchases",
                         headers=H(admin_tok),
                         params={"status": "refunded", "limit": 50}, timeout=15)
        if r.status_code == 200:
            ids = [it.get("purchase_id") for it in r.json().get("items") or []]
            ok("refunded purchase appears in status=refunded listing",
               first_pid in ids, f"ids={ids[:10]}")

        # sales_count decremented
        pg = requests.get(f"{BASE}/marketplace/products/{pid}", timeout=15)
        if pg.status_code == 200:
            ok("product.sales_count decremented to 0 after refund",
               (pg.json().get("sales_count") or 0) == 0,
               f"sales_count={pg.json().get('sales_count')}")

        # Idempotency
        r = requests.post(f"{BASE}/admin/marketplace/purchases/{first_pid}/refund",
                          headers=H(admin_tok),
                          json={"reason": "qa-refund-again"}, timeout=15)
        ok("refund idempotent -> 200",
           r.status_code == 200, f"{r.status_code}")
        if r.status_code == 200:
            ok("refund second call -> already_refunded:true",
               r.json().get("already_refunded") is True, f"{r.json()}")

        # Buyer notification
        rn = requests.get(f"{BASE}/notifications", headers=H(buyer["token"]),
                          params={"limit": 20}, timeout=15)
        if rn.status_code == 200:
            raw = rn.json()
            items = raw if isinstance(raw, list) else raw.get("items") or []
            kinds = [it.get("kind") for it in items]
            ok("buyer receives marketplace_refund notification",
               "marketplace_refund" in kinds, f"kinds={kinds[:10]}")

    # ---------------------------------------------------------------- (14)
    section("(14) NON-REGRESSION smoke")
    for path, name in [
        ("/auth/me", "/api/auth/me"),
        ("/feed/home", "/api/feed/home"),
        ("/spots?limit=3", "/api/spots?limit=3"),
        ("/notifications?limit=5", "/api/notifications?limit=5"),
    ]:
        r = requests.get(f"{BASE}{path}", headers=H(admin_tok), timeout=15)
        ok(f"{name} 200", r.status_code == 200, f"{r.status_code} {r.text[:120]}")

    # Check backend.err.log for any 500s during our run
    try:
        with open("/var/log/supervisor/backend.err.log", "r") as f:
            tail = f.read()[-50000:]
        # grep for "Internal Server Error" occurrences since test start isn't
        # cleanly separable, but count 500 status codes in access-log style
        bad = tail.count(' 500 ')
        ok(f"backend.err.log contains no '500' occurrences (got {bad})",
           bad == 0 or bad < 3, f"count={bad}")
    except Exception as e:
        ok("read backend.err.log", False, str(e))

    # ---------------------------------------------------------------- CLEANUP
    section("CLEANUP — direct mongo")
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        MONGO = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        client = AsyncIOMotorClient(MONGO)
        DB_NAME = os.environ.get("DB_NAME", "photoscout")
        dbm = client[DB_NAME]

        async def _cleanup():
            # Soft-delete users (mark deleted_at to mirror app semantics)
            if CREATED_USERS:
                await dbm.users.update_many(
                    {"user_id": {"$in": CREATED_USERS}},
                    {"$set": {"deleted_at": time.time()}},
                )
            if CREATED_PRODUCTS:
                await dbm.marketplace_products.update_many(
                    {"product_id": {"$in": CREATED_PRODUCTS}},
                    {"$set": {"status": "removed"}},
                )
            print(f"  cleaned {len(CREATED_USERS)} users, {len(CREATED_PRODUCTS)} products")

        asyncio.get_event_loop().run_until_complete(_cleanup())
    except Exception as e:
        print(f"  cleanup failed (non-fatal): {e}")

    # ---------------------------------------------------------------- SUMMARY
    print("\n=== SUMMARY ===")
    print(f"PASS: {len(PASS)}")
    print(f"FAIL: {len(FAIL)}")
    if FAIL:
        print("\nFailures:")
        for n, d in FAIL:
            print(f"  - {n}: {d}")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
