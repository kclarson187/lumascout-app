"""
Pack Marketplace MVP — focused backend validation.
Backend: http://localhost:8001/api
Admin: admin@lumascout.app / admin123 (super_admin)
"""
import os
import sys
import uuid
import time
import json
import requests
from typing import Optional, Dict, Any

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASS = "admin123"

# Track results
PASS = []
FAIL = []


def _result(name: str, ok: bool, detail: str = ""):
    if ok:
        PASS.append(name)
        print(f"  ✅ {name}")
    else:
        FAIL.append((name, detail))
        print(f"  ❌ {name} — {detail}")


def _login(email: str, password: str) -> Optional[str]:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        return None
    return r.json()["token"]


def _register() -> Dict[str, Any]:
    uid_hex = uuid.uuid4().hex[:10]
    email = f"qa_mp_{uid_hex}@photoscout-qa.com"
    password = "TestPass123!"
    name = f"QA {uid_hex[:4].upper()}"
    r = requests.post(f"{BASE}/auth/register", json={
        "email": email, "password": password, "name": name,
    })
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "email": email, "password": password, "name": name,
        "token": data["token"], "user": data["user"],
        "user_id": data["user"]["user_id"],
    }


def H(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def section(title: str):
    print(f"\n=== {title} ===")


# Cleanup buckets
CREATED_USER_IDS = []
CREATED_PRODUCT_IDS = []
ADMIN_TOKEN = None


def main():
    global ADMIN_TOKEN
    section("Setup: admin login")
    ADMIN_TOKEN = _login(ADMIN_EMAIL, ADMIN_PASS)
    _result("admin login", ADMIN_TOKEN is not None)
    if not ADMIN_TOKEN:
        print("Cannot proceed without admin token")
        return

    # -------------------------------------------------------------------
    section("1. Storefront")
    r = requests.get(f"{BASE}/marketplace/storefront")
    _result("GET /marketplace/storefront 200", r.status_code == 200, r.text[:200])
    if r.status_code == 200:
        body = r.json()
        rails = body.get("rails") or {}
        by_type = body.get("by_type") or {}
        _result("storefront has rails.featured/trending/newest",
                all(k in rails for k in ("featured", "trending", "newest")),
                f"got rails keys={list(rails.keys())}")
        _result("storefront has by_type dict",
                isinstance(by_type, dict), f"by_type type={type(by_type).__name__}")
        non_empty = any(len(rails.get(k) or []) > 0 for k in ("featured", "trending", "newest"))
        _result("at least one rail non-empty", non_empty,
                f"counts featured={len(rails.get('featured') or [])} trending={len(rails.get('trending') or [])} newest={len(rails.get('newest') or [])}")
        # Check item fields
        sample = None
        for key in ("trending", "newest", "featured"):
            if rails.get(key):
                sample = rails[key][0]
                break
        if not sample and by_type:
            for k, v in by_type.items():
                if v:
                    sample = v[0]
                    break
        required = {"product_id", "title", "type", "price_cents", "currency", "thumbnail_url",
                    "seller", "rating_avg", "sales_count", "in_wishlist", "has_purchased"}
        missing = required - set((sample or {}).keys())
        _result("storefront item carries required keys", not missing,
                f"missing={missing} sample_keys={list((sample or {}).keys())}")
        if sample:
            s = sample.get("seller") or {}
            _result("seller has name+username",
                    "name" in s and "username" in s,
                    f"seller keys={list(s.keys())}")

    # -------------------------------------------------------------------
    section("2. List / search")
    # q=preset
    r = requests.get(f"{BASE}/marketplace/products", params={"q": "preset", "limit": 10})
    _result("GET /marketplace/products?q=preset 200", r.status_code == 200, r.text[:200])
    if r.status_code == 200:
        body = r.json()
        items = body.get("items") or []
        total = body.get("total") or 0
        _result("q=preset returns total>=1", total >= 1, f"total={total}")
        # ensure each matches (type==preset OR 'preset' in title/description/tags)
        if items:
            ok = True
            for it in items:
                t = (it.get("title") or "").lower()
                d = (it.get("description") or "").lower()
                tags = [x.lower() for x in (it.get("tags") or [])]
                if not (it.get("type") == "preset" or "preset" in t or "preset" in d or "preset" in tags):
                    ok = False
                    break
            _result("q=preset items match filter", ok)

    # type=mentorship
    r = requests.get(f"{BASE}/marketplace/products", params={"type": "mentorship"})
    if r.status_code == 200:
        items = r.json().get("items") or []
        all_mentor = all(it.get("type") == "mentorship" for it in items)
        _result("type=mentorship returns only mentorship", all_mentor,
                f"got types={[it.get('type') for it in items]}")
    else:
        _result("type=mentorship 200", False, f"{r.status_code}")

    # sort=price_low ascending
    r = requests.get(f"{BASE}/marketplace/products", params={"sort": "price_low", "limit": 30})
    if r.status_code == 200:
        prices = [it.get("price_cents") for it in r.json().get("items") or []]
        is_asc = all(prices[i] <= prices[i + 1] for i in range(len(prices) - 1))
        _result("sort=price_low ascending", is_asc, f"prices={prices[:10]}")
    else:
        _result("sort=price_low 200", False, f"{r.status_code}")

    # -------------------------------------------------------------------
    section("3. Product detail (view count + privacy)")
    # Grab a demo product id via storefront
    r = requests.get(f"{BASE}/marketplace/products", params={"limit": 1})
    demo_pid = None
    if r.status_code == 200 and r.json().get("items"):
        demo_pid = r.json()["items"][0]["product_id"]
    _result("found a demo product to inspect", demo_pid is not None)
    if demo_pid:
        r1 = requests.get(f"{BASE}/marketplace/products/{demo_pid}")
        r2 = requests.get(f"{BASE}/marketplace/products/{demo_pid}")
        v1 = r1.json().get("view_count", 0) if r1.status_code == 200 else -1
        v2 = r2.json().get("view_count", 0) if r2.status_code == 200 else -1
        _result("GET product detail 200", r1.status_code == 200 and r2.status_code == 200)
        _result("view_count increments between GETs", v2 > v1, f"v1={v1} v2={v2}")
        _result("unauth GET does NOT include contents_url",
                "contents_url" not in r1.json(),
                f"r1 keys included contents_url={('contents_url' in r1.json())}")

    # bogus id
    r = requests.get(f"{BASE}/marketplace/products/prod_doesnotexist123")
    _result("bogus product id → 404", r.status_code == 404, f"{r.status_code}")

    # -------------------------------------------------------------------
    section("4. Create / patch / delete")
    u1 = _register(); CREATED_USER_IDS.append(u1["user_id"])
    u2 = _register(); CREATED_USER_IDS.append(u2["user_id"])

    # POST create product
    payload = {
        "title": f"QA Preset Pack {uuid.uuid4().hex[:6]}",
        "type": "preset",
        "description": "Warm film-inspired presets for outdoor portraits.",
        "price_cents": 1500,
        "thumbnail_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    }
    r = requests.post(f"{BASE}/marketplace/products", headers=H(u1["token"]), json=payload)
    _result("u1 POST create product 200", r.status_code == 200,
            f"status={r.status_code} body={r.text[:200]}")
    pid = None
    if r.status_code == 200:
        pid = r.json()["product_id"]
        CREATED_PRODUCT_IDS.append(pid)
        _result("new product status == pending", r.json().get("status") == "pending",
                f"status={r.json().get('status')}")

    # u2 PATCH non-owner → 403
    if pid:
        r = requests.patch(f"{BASE}/marketplace/products/{pid}", headers=H(u2["token"]),
                           json={"title": "Hijack attempt"})
        _result("u2 PATCH non-owner → 403", r.status_code == 403,
                f"got {r.status_code}: {r.text[:150]}")
        r = requests.delete(f"{BASE}/marketplace/products/{pid}", headers=H(u2["token"]))
        _result("u2 DELETE non-owner → 403", r.status_code == 403,
                f"got {r.status_code}: {r.text[:150]}")

        # Owner PATCH title → still pending (it was pending, title isn't price/content)
        r = requests.patch(f"{BASE}/marketplace/products/{pid}", headers=H(u1["token"]),
                           json={"title": payload["title"] + " v2"})
        _result("owner PATCH title 200", r.status_code == 200, f"{r.status_code}: {r.text[:200]}")
        if r.status_code == 200:
            _result("status stays 'pending' after title PATCH",
                    r.json().get("status") == "pending",
                    f"status={r.json().get('status')}")

        # Admin approve
        r = requests.post(f"{BASE}/admin/marketplace/products/{pid}/moderate",
                          headers=H(ADMIN_TOKEN), json={"action": "approve"})
        _result("admin approve → 200", r.status_code == 200,
                f"{r.status_code}: {r.text[:200]}")

        # Owner PATCH price_cents → status should revert to pending
        r = requests.patch(f"{BASE}/marketplace/products/{pid}", headers=H(u1["token"]),
                           json={"price_cents": 1800})
        _result("owner PATCH price 200", r.status_code == 200)
        if r.status_code == 200:
            _result("status reverts to 'pending' after price change",
                    r.json().get("status") == "pending",
                    f"status={r.json().get('status')}")

        # Admin re-approve
        r = requests.post(f"{BASE}/admin/marketplace/products/{pid}/moderate",
                          headers=H(ADMIN_TOKEN), json={"action": "approve"})
        _result("admin re-approve → 200", r.status_code == 200)

        # Owner DELETE → status='removed'
        r = requests.delete(f"{BASE}/marketplace/products/{pid}", headers=H(u1["token"]))
        _result("owner DELETE 200", r.status_code == 200)
        # Verify status='removed'
        r2 = requests.get(f"{BASE}/marketplace/products/{pid}")
        if r2.status_code == 200:
            _result("after DELETE, product.status='removed'",
                    r2.json().get("status") == "removed",
                    f"status={r2.json().get('status')}")

    # -------------------------------------------------------------------
    section("5. Checkout (MOCK)")
    # Create fresh approved product by u1, price 500 cents
    payload = {
        "title": f"QA Preset Paid {uuid.uuid4().hex[:6]}",
        "type": "preset",
        "description": "Paid preset for checkout test.",
        "price_cents": 500,
        "thumbnail_url": "data:image/png;base64,AAAA",
        "contents_url": "https://example.com/dl/abc.zip",
    }
    r = requests.post(f"{BASE}/marketplace/products", headers=H(u1["token"]), json=payload)
    paid_pid = None
    if r.status_code == 200:
        paid_pid = r.json()["product_id"]
        CREATED_PRODUCT_IDS.append(paid_pid)
        # approve
        r2 = requests.post(f"{BASE}/admin/marketplace/products/{paid_pid}/moderate",
                           headers=H(ADMIN_TOKEN), json={"action": "approve"})
        _result("approved paid product", r2.status_code == 200)

    if paid_pid:
        # u2 checkout
        r = requests.post(f"{BASE}/marketplace/products/{paid_pid}/checkout",
                          headers=H(u2["token"]))
        _result("u2 checkout 200", r.status_code == 200,
                f"{r.status_code}: {r.text[:200]}")
        if r.status_code == 200:
            cb = r.json()
            _result("checkout mocked=true", cb.get("mocked") is True, f"body={cb}")
            _result("checkout purchase_id present", bool(cb.get("purchase_id")))
            _result("platform_fee_cents == 75", cb.get("platform_fee_cents") == 75,
                    f"got {cb.get('platform_fee_cents')}")
            _result("seller_payout_cents == 425", cb.get("seller_payout_cents") == 425,
                    f"got {cb.get('seller_payout_cents')}")
            first_pid = cb.get("purchase_id")

            # Seller buying own product
            r2 = requests.post(f"{BASE}/marketplace/products/{paid_pid}/checkout",
                               headers=H(u1["token"]))
            _result("seller buys own product → 400", r2.status_code == 400,
                    f"{r2.status_code}: {r2.text[:200]}")

            # Duplicate checkout before completing → 200 with another purchase_id (pending rows allowed)
            r3 = requests.post(f"{BASE}/marketplace/products/{paid_pid}/checkout",
                               headers=H(u2["token"]))
            _result("duplicate checkout before complete 200", r3.status_code == 200,
                    f"{r3.status_code}: {r3.text[:200]}")
            if r3.status_code == 200:
                cb3 = r3.json()
                _result("second pending purchase has different purchase_id",
                        cb3.get("purchase_id") and cb3.get("purchase_id") != first_pid,
                        f"first={first_pid} second={cb3.get('purchase_id')}")

            # Bogus complete
            rb = requests.post(f"{BASE}/marketplace/purchases/mp_bogus_999/complete",
                               headers=H(u2["token"]))
            _result("bogus purchase complete → 404", rb.status_code == 404, f"{rb.status_code}")

            # Non-buyer trying to complete
            u3 = _register(); CREATED_USER_IDS.append(u3["user_id"])
            rnb = requests.post(f"{BASE}/marketplace/purchases/{first_pid}/complete",
                                headers=H(u3["token"]))
            _result("non-buyer complete → 403", rnb.status_code == 403,
                    f"{rnb.status_code}: {rnb.text[:200]}")

            # Complete first
            rc = requests.post(f"{BASE}/marketplace/purchases/{first_pid}/complete",
                               headers=H(u2["token"]))
            _result("complete first purchase 200", rc.status_code == 200,
                    f"{rc.status_code}: {rc.text[:200]}")

            # Third checkout after completion → already_owned
            r4 = requests.post(f"{BASE}/marketplace/products/{paid_pid}/checkout",
                               headers=H(u2["token"]))
            if r4.status_code == 200:
                cb4 = r4.json()
                _result("after completion, next checkout returns already_owned=true",
                        cb4.get("already_owned") is True,
                        f"body={cb4}")
            else:
                _result("after completion, next checkout 200", False, f"{r4.status_code}")

            # sales_count incremented
            pg = requests.get(f"{BASE}/marketplace/products/{paid_pid}")
            if pg.status_code == 200:
                _result("product.sales_count >= 1 after complete",
                        (pg.json().get("sales_count") or 0) >= 1,
                        f"sales_count={pg.json().get('sales_count')}")

            # u2 GET product now includes contents_url
            pg2 = requests.get(f"{BASE}/marketplace/products/{paid_pid}",
                               headers=H(u2["token"]))
            if pg2.status_code == 200:
                _result("buyer GET product includes contents_url",
                        "contents_url" in pg2.json() and pg2.json().get("contents_url"),
                        f"contents_url={pg2.json().get('contents_url')}")

    # Free product path
    fpayload = {
        "title": f"QA Free Pack {uuid.uuid4().hex[:6]}",
        "type": "preset",
        "description": "Free preset.",
        "price_cents": 0,
        "thumbnail_url": "data:image/png;base64,AAAA",
        "contents_url": "https://example.com/dl/free.zip",
    }
    r = requests.post(f"{BASE}/marketplace/products", headers=H(u1["token"]), json=fpayload)
    free_pid = None
    if r.status_code == 200:
        free_pid = r.json()["product_id"]
        CREATED_PRODUCT_IDS.append(free_pid)
        requests.post(f"{BASE}/admin/marketplace/products/{free_pid}/moderate",
                      headers=H(ADMIN_TOKEN), json={"action": "approve"})
        rc = requests.post(f"{BASE}/marketplace/products/{free_pid}/checkout",
                           headers=H(u2["token"]))
        if rc.status_code == 200:
            _result("free checkout auto_completed=true",
                    rc.json().get("auto_completed") is True,
                    f"body={rc.json()}")
        else:
            _result("free checkout 200", False, f"{rc.status_code}: {rc.text[:150]}")

        # Library contains it
        rl = requests.get(f"{BASE}/me/marketplace/library", headers=H(u2["token"]))
        if rl.status_code == 200:
            ids = [it.get("product", {}).get("product_id") for it in rl.json().get("items") or []]
            _result("free product in buyer library", free_pid in ids,
                    f"library ids={ids}")

    # -------------------------------------------------------------------
    section("6. Reviews")
    if paid_pid:
        # u2 is the buyer of completed paid product
        r = requests.post(f"{BASE}/marketplace/products/{paid_pid}/reviews",
                          headers=H(u2["token"]),
                          json={"rating": 4, "text": "Nice"})
        _result("buyer POST review 200", r.status_code == 200,
                f"{r.status_code}: {r.text[:200]}")

        pg = requests.get(f"{BASE}/marketplace/products/{paid_pid}")
        if pg.status_code == 200:
            _result("product.rating_count >= 1 after review",
                    (pg.json().get("rating_count") or 0) >= 1,
                    f"rating_count={pg.json().get('rating_count')} avg={pg.json().get('rating_avg')}")
            _result("product.rating_avg > 0",
                    (pg.json().get("rating_avg") or 0) > 0,
                    f"rating_avg={pg.json().get('rating_avg')}")

        # Re-submit same buyer (update, not dup)
        r2 = requests.post(f"{BASE}/marketplace/products/{paid_pid}/reviews",
                           headers=H(u2["token"]),
                           json={"rating": 5, "text": "Even better"})
        _result("re-submit review 200", r2.status_code == 200)
        pg2 = requests.get(f"{BASE}/marketplace/products/{paid_pid}")
        if pg2.status_code == 200:
            _result("rating_count stays 1 on re-submit (no duplicate)",
                    pg2.json().get("rating_count") == 1,
                    f"rating_count={pg2.json().get('rating_count')}")

        # Out of range 0 or 6 → 422
        r_low = requests.post(f"{BASE}/marketplace/products/{paid_pid}/reviews",
                              headers=H(u2["token"]), json={"rating": 0})
        _result("rating=0 → 422", r_low.status_code == 422, f"{r_low.status_code}")
        r_high = requests.post(f"{BASE}/marketplace/products/{paid_pid}/reviews",
                               headers=H(u2["token"]), json={"rating": 6})
        _result("rating=6 → 422", r_high.status_code == 422, f"{r_high.status_code}")

        # Non-buyer u3 → 403
        # (u3 was registered above)
        # need to re-find u3 token
        u3b = _register(); CREATED_USER_IDS.append(u3b["user_id"])
        r_nb = requests.post(f"{BASE}/marketplace/products/{paid_pid}/reviews",
                             headers=H(u3b["token"]), json={"rating": 5, "text": "drive-by"})
        _result("non-buyer review → 403", r_nb.status_code == 403,
                f"{r_nb.status_code}: {r_nb.text[:200]}")

        # GET reviews returns hydrated reviewer
        rl = requests.get(f"{BASE}/marketplace/products/{paid_pid}/reviews")
        if rl.status_code == 200:
            items = rl.json().get("items") or []
            _result("GET reviews returns hydrated reviewer",
                    bool(items) and "reviewer" in items[0] and all(
                        k in items[0]["reviewer"] for k in ("name", "username")
                    ),
                    f"first={items[0] if items else None}")

    # -------------------------------------------------------------------
    section("7. Wishlist")
    if paid_pid:
        r1 = requests.post(f"{BASE}/marketplace/wishlist/{paid_pid}",
                           headers=H(u2["token"]))
        _result("wishlist toggle (add) in_wishlist=true",
                r1.status_code == 200 and r1.json().get("in_wishlist") is True,
                f"{r1.status_code}: {r1.text[:200]}")
        r2 = requests.post(f"{BASE}/marketplace/wishlist/{paid_pid}",
                           headers=H(u2["token"]))
        _result("wishlist toggle (remove) in_wishlist=false",
                r2.status_code == 200 and r2.json().get("in_wishlist") is False,
                f"{r2.status_code}: {r2.text[:200]}")

        # Add again, then fetch list
        requests.post(f"{BASE}/marketplace/wishlist/{paid_pid}", headers=H(u2["token"]))
        rl = requests.get(f"{BASE}/me/wishlist", headers=H(u2["token"]))
        if rl.status_code == 200:
            items = rl.json().get("items") or []
            all_active = all((it.get("status") == "active") for it in items)
            has_paid = any(it.get("product_id") == paid_pid for it in items)
            _result("GET /me/wishlist returns active products only", all_active,
                    f"statuses={[it.get('status') for it in items]}")
            _result("wishlist contains paid_pid", has_paid)

    # -------------------------------------------------------------------
    section("8. Library + Sales")
    rl = requests.get(f"{BASE}/me/marketplace/library", headers=H(u2["token"]))
    if rl.status_code == 200:
        items = rl.json().get("items") or []
        if items:
            # contents_url present
            has_contents = any(it.get("product", {}).get("contents_url") for it in items)
            _result("buyer library product includes contents_url", has_contents,
                    f"first product keys={list(items[0].get('product', {}).keys())}")

    rs = requests.get(f"{BASE}/me/marketplace/sales", headers=H(u1["token"]))
    if rs.status_code == 200:
        sb = rs.json()
        _result("seller sales total_sales>=1", (sb.get("total_sales") or 0) >= 1,
                f"total_sales={sb.get('total_sales')}")
        _result("seller sales gross_cents>=500", (sb.get("gross_cents") or 0) >= 500,
                f"gross_cents={sb.get('gross_cents')}")
        _result("platform_fee_pct == 15", sb.get("platform_fee_pct") == 15,
                f"pct={sb.get('platform_fee_pct')}")
        _result("net_cents == gross - fee",
                sb.get("net_cents") == (sb.get("gross_cents", 0) - sb.get("platform_fee_cents", 0)),
                f"gross={sb.get('gross_cents')} fee={sb.get('platform_fee_cents')} net={sb.get('net_cents')}")
        _result("sales.products has items with sales/revenue/view_count",
                isinstance(sb.get("products"), list) and len(sb["products"]) > 0 and
                all(k in sb["products"][0] for k in ("sales", "revenue_cents", "view_count")),
                f"first product stat={sb.get('products', [{}])[0] if sb.get('products') else None}")
    else:
        _result("GET /me/marketplace/sales 200", False, f"{rs.status_code}")

    # -------------------------------------------------------------------
    section("9. Admin moderation")
    # Non-staff user → 403
    r = requests.get(f"{BASE}/admin/marketplace/pending", headers=H(u1["token"]))
    _result("non-staff /admin/marketplace/pending → 403", r.status_code == 403,
            f"{r.status_code}")

    # Admin
    r = requests.get(f"{BASE}/admin/marketplace/pending", headers=H(ADMIN_TOKEN))
    _result("admin /admin/marketplace/pending 200", r.status_code == 200,
            f"{r.status_code}")
    if r.status_code == 200:
        items = r.json().get("items") or []
        for it in items:
            _result("pending items have status='pending'",
                    it.get("status") == "pending",
                    f"status={it.get('status')}")
            break  # one assertion

    # Create a product to deny
    deny_payload = {
        "title": f"QA Deny Pack {uuid.uuid4().hex[:6]}",
        "type": "preset",
        "description": "To be denied",
        "price_cents": 999,
        "thumbnail_url": "data:image/png;base64,AAAA",
    }
    r = requests.post(f"{BASE}/marketplace/products", headers=H(u1["token"]), json=deny_payload)
    deny_pid = None
    if r.status_code == 200:
        deny_pid = r.json()["product_id"]
        CREATED_PRODUCT_IDS.append(deny_pid)
        rd = requests.post(f"{BASE}/admin/marketplace/products/{deny_pid}/moderate",
                           headers=H(ADMIN_TOKEN),
                           json={"action": "deny", "reason": "low quality screenshots"})
        _result("admin deny 200", rd.status_code == 200, f"{rd.status_code}: {rd.text[:200]}")
        # verify
        rg = requests.get(f"{BASE}/marketplace/products/{deny_pid}", headers=H(ADMIN_TOKEN))
        if rg.status_code == 200:
            _result("denied product status='denied'", rg.json().get("status") == "denied",
                    f"status={rg.json().get('status')}")
            _result("denied product deny_reason saved",
                    rg.json().get("deny_reason") == "low quality screenshots",
                    f"deny_reason={rg.json().get('deny_reason')}")

    # Feature / unfeature on an active product
    if paid_pid:
        rf = requests.post(f"{BASE}/admin/marketplace/products/{paid_pid}/moderate",
                           headers=H(ADMIN_TOKEN), json={"action": "feature"})
        _result("admin feature 200", rf.status_code == 200)
        rg = requests.get(f"{BASE}/marketplace/products/{paid_pid}")
        if rg.status_code == 200:
            _result("featured=true after feature", rg.json().get("featured") is True,
                    f"featured={rg.json().get('featured')}")
        ruf = requests.post(f"{BASE}/admin/marketplace/products/{paid_pid}/moderate",
                            headers=H(ADMIN_TOKEN), json={"action": "unfeature"})
        _result("admin unfeature 200", ruf.status_code == 200)
        rg2 = requests.get(f"{BASE}/marketplace/products/{paid_pid}")
        if rg2.status_code == 200:
            _result("featured=false after unfeature", rg2.json().get("featured") is False,
                    f"featured={rg2.json().get('featured')}")

    # Audit log check
    rau = requests.get(f"{BASE}/admin/audit-logs", headers=H(ADMIN_TOKEN),
                       params={"target_id": paid_pid or deny_pid, "limit": 20})
    if rau.status_code == 200:
        items = rau.json().get("items") or []
        # look for marketplace_product.* actions
        has_mp_action = any("marketplace_product" in (it.get("action") or "") for it in items)
        _result("audit log has marketplace_product.* entry",
                has_mp_action, f"actions={[it.get('action') for it in items[:10]]}")
    else:
        _result("GET /admin/audit-logs 200", False, f"{rau.status_code}: {rau.text[:200]}")

    # -------------------------------------------------------------------
    section("10. Seed idempotency")
    # We can't actually restart backend from a test, but we can verify count
    # via querying products with title matching Golden Hour Austin.
    r = requests.get(f"{BASE}/marketplace/products",
                     params={"q": "Golden Hour Austin", "limit": 30})
    if r.status_code == 200:
        items = r.json().get("items") or []
        matches = [it for it in items if "Golden Hour Austin" in (it.get("title") or "")]
        _result("'Golden Hour Austin' seed count == 1 (idempotent)",
                len(matches) == 1, f"got {len(matches)} titles={[m.get('title') for m in matches]}")

    # Now trigger a backend restart and re-check
    print("  ... restarting backend to re-verify seed idempotency ...")
    os.system("sudo supervisorctl restart backend >/dev/null 2>&1")
    # wait for backend to come back
    for i in range(30):
        time.sleep(1)
        try:
            rr = requests.get(f"{BASE}/", timeout=2)
            if rr.status_code == 200:
                break
        except Exception:
            continue
    # Wait for seed to complete
    time.sleep(3)
    r2 = requests.get(f"{BASE}/marketplace/products",
                      params={"q": "Golden Hour Austin", "limit": 30})
    if r2.status_code == 200:
        items = r2.json().get("items") or []
        matches = [it for it in items if "Golden Hour Austin" in (it.get("title") or "")]
        _result("after restart, 'Golden Hour Austin' count still == 1",
                len(matches) == 1, f"got {len(matches)}")

    # -------------------------------------------------------------------
    section("CLEANUP")
    # Re-login admin after restart to be safe
    ADMIN_TOKEN2 = _login(ADMIN_EMAIL, ADMIN_PASS)
    admin_tok = ADMIN_TOKEN2 or ADMIN_TOKEN
    # Delete throwaway products
    for pid in CREATED_PRODUCT_IDS:
        try:
            rd = requests.delete(f"{BASE}/marketplace/products/{pid}",
                                 headers=H(admin_tok))
            print(f"  cleanup product {pid} → {rd.status_code}")
        except Exception as e:
            print(f"  cleanup product {pid} failed: {e}")
    # Delete throwaway users via admin
    for uid in CREATED_USER_IDS:
        try:
            rd = requests.delete(f"{BASE}/admin/users/{uid}",
                                 headers=H(admin_tok),
                                 json={"reason_code": "qa_testing", "reason_note": "marketplace test cleanup"})
            print(f"  cleanup user {uid} → {rd.status_code}")
        except Exception as e:
            print(f"  cleanup user {uid} failed: {e}")

    # -------------------------------------------------------------------
    print("\n=== SUMMARY ===")
    print(f"PASS: {len(PASS)}")
    print(f"FAIL: {len(FAIL)}")
    if FAIL:
        print("\nFailures:")
        for name, detail in FAIL:
            print(f"  - {name}: {detail}")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
