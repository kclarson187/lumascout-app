"""
Phase 1B regression test — verify the 33 admin endpoints extracted into
/app/backend/routes/admin.py all still respond correctly. No 500s anywhere.

Also smoke-check non-admin + previously-migrated marketplace endpoints.

Run: python3 /app/backend_test.py
"""
from __future__ import annotations

import random
import string
import sys
import time
from typing import Any, Optional, Tuple

import requests

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

session = requests.Session()
session.headers.update({"Content-Type": "application/json"})

PASS = 0
FAIL = 0
FAIL_MSGS: list[str] = []
FIVE_HUNDREDS: list[str] = []


def log(msg: str) -> None:
    print(msg, flush=True)


def check(ok: bool, desc: str, extra: Any = "") -> bool:
    global PASS, FAIL
    if ok:
        PASS += 1
        log(f"  OK  {desc}")
        return True
    FAIL += 1
    msg = f"  FAIL {desc}  {extra}"
    log(msg)
    FAIL_MSGS.append(msg)
    return False


def req(method: str, path: str, token: Optional[str] = None,
        body: Any = None, params: Any = None) -> Tuple[int, Any]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"{BASE}{path}"
    try:
        r = session.request(method, url, headers=headers,
                            json=body if body is not None else None,
                            params=params, timeout=30)
    except Exception as e:
        log(f"  network error {method} {path}: {e}")
        return 0, {"error": str(e)}
    if r.status_code >= 500:
        FIVE_HUNDREDS.append(f"{method} {path} -> {r.status_code} body={r.text[:400]}")
    try:
        data = r.json()
    except Exception:
        data = {"_raw": r.text}
    return r.status_code, data


def rand(n: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def login(email: str, password: str) -> Optional[str]:
    sc, data = req("POST", "/auth/login", body={"email": email, "password": password})
    if sc == 200 and data.get("token"):
        return data["token"]
    log(f"  login failed for {email}: {sc} {data}")
    return None


def register_throwaway(city: str = "Austin") -> Tuple[str, str, str]:
    email = f"qa_{rand(10)}@qamail.lumascout.app"
    password = "QAtest123!"
    name = f"QA {rand(4).upper()}"
    sc, data = req("POST", "/auth/register", body={
        "email": email, "password": password, "name": name,
        "city": city, "state": "TX", "country_code": "US",
    })
    if sc not in (200, 201):
        log(f"  register fail {sc} {data}")
        return "", "", email
    return data.get("token", ""), (data.get("user") or {}).get("user_id", ""), email


def create_spot(tok: str, title: str) -> Optional[str]:
    sc, body = req("POST", "/spots", token=tok, body={
        "title": title,
        "description": "QA regression spot",
        "latitude": 30.27 + random.uniform(-0.05, 0.05),
        "longitude": -97.74 + random.uniform(-0.05, 0.05),
        "city": "Austin",
        "state": "TX",
        "country": "USA",
        "shoot_types": ["portrait"],
        "privacy_mode": "public",
    })
    if sc not in (200, 201):
        log(f"    spot create failed {sc} {body}")
        return None
    return body.get("spot_id")


def run() -> None:
    log("\n===== Phase 1B ADMIN REGRESSION SUITE =====\n")

    admin_tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_tok:
        log("FATAL: cannot log in as admin. Aborting.")
        sys.exit(1)

    sc, me = req("GET", "/auth/me", token=admin_tok)
    check(sc == 200 and me.get("email") == ADMIN_EMAIL, "admin /auth/me -> 200")
    admin_user_id = me.get("user_id")

    non_admin_tok, non_admin_id, _ = register_throwaway()
    check(bool(non_admin_tok), "non-admin throwaway registered")

    # §1 Triage / dashboards
    log("\n-- §1 Triage / dashboards --")
    sc, body = req("GET", "/admin/overview", token=admin_tok)
    check(sc == 200 and "users" in body and "moderation" in body,
          "GET /admin/overview -> 200",
          f"sc={sc}")

    sc, body = req("GET", "/admin/pending", token=admin_tok)
    check(sc == 200 and isinstance(body, list),
          "GET /admin/pending -> 200 list", f"sc={sc}")

    sc, body = req("GET", "/admin/stats/recent-approvals", token=admin_tok)
    check(sc == 200 and "count" in body and "days" in body,
          "GET /admin/stats/recent-approvals -> 200", f"sc={sc} body={body}")

    sc, body = req("GET", "/admin/analytics", token=admin_tok, params={"days": 14})
    n14 = len(body.get("series", [])) if isinstance(body, dict) else 0
    check(sc == 200 and n14 == 14, "GET /admin/analytics?days=14 -> 14 buckets",
          f"sc={sc} n={n14}")

    sc, body = req("GET", "/admin/analytics", token=admin_tok, params={"days": 30})
    n30 = len(body.get("series", [])) if isinstance(body, dict) else 0
    check(sc == 200 and n30 == 30, "GET /admin/analytics?days=30 -> 30 buckets",
          f"sc={sc} n={n30}")

    sc, body = req("GET", "/admin/audit-logs", token=admin_tok, params={"limit": 5})
    items = body.get("items") if isinstance(body, dict) else None
    check(sc == 200 and isinstance(items, list),
          "GET /admin/audit-logs?limit=5 -> 200 items[]",
          f"sc={sc}")

    # §2 User management
    log("\n-- §2 User management --")
    sc, body = req("GET", "/admin/users", token=admin_tok, params={"limit": 5})
    check(sc == 200 and isinstance(body.get("items"), list),
          "GET /admin/users?limit=5 -> 200", f"sc={sc}")

    sc, body = req("GET", "/admin/users", token=admin_tok, params={"q": "admin"})
    check(sc == 200 and isinstance(body.get("items"), list),
          "GET /admin/users?q=admin -> 200", f"sc={sc}")

    sc, body = req("GET", f"/admin/users/{admin_user_id}", token=admin_tok)
    check(sc == 200 and body.get("user_id") == admin_user_id,
          "GET /admin/users/{admin_id} -> 200", f"sc={sc}")

    # AdminUserPatch schema: plan/role/status/verification_status/
    # suspension_reason/comp_expiration/reason. display_name/city are
    # NOT in the schema — skipped in favour of a real field.
    sc, body = req("PATCH", f"/admin/users/{non_admin_id}", token=admin_tok,
                   body={"verification_status": "verified", "reason": "qa test"})
    check(sc == 200, "PATCH /admin/users/{id} (verification_status) -> 200",
          f"sc={sc} body={body}")

    sc, body = req("POST", f"/admin/users/{non_admin_id}/notes", token=admin_tok,
                   body={"body": "qa note"})
    check(sc == 200 and body.get("note_id"),
          "POST /admin/users/{id}/notes -> 200", f"sc={sc}")

    # Grant plan schema: {plan, duration_days, reason}
    sc, body = req("POST", f"/admin/users/{non_admin_id}/grant-plan",
                   token=admin_tok,
                   body={"plan": "pro", "duration_days": 30, "reason": "qa"})
    check(sc == 200 and (body.get("user") or {}).get("plan") == "pro",
          "POST /admin/users/{id}/grant-plan {pro} -> 200", f"sc={sc}")

    sc, body = req("POST", f"/admin/users/{non_admin_id}/grant-plan",
                   token=admin_tok, body={"plan": "free", "reason": "qa revoke"})
    check(sc == 200 and (body.get("user") or {}).get("plan") == "free",
          "POST /admin/users/{id}/grant-plan {free} -> 200", f"sc={sc}")

    # §3 Sanctions
    log("\n-- §3 Sanctions --")
    sc, body = req("POST", f"/admin/users/{non_admin_id}/sanction",
                   token=admin_tok,
                   body={"type": "warn", "reason": "qa test warning"})
    sanction_id = body.get("sanction_id") if isinstance(body, dict) else None
    check(sc == 200 and sanction_id,
          "POST /admin/users/{id}/sanction {warn} -> 200",
          f"sc={sc} body={body}")

    sc, body = req("GET", f"/admin/users/{non_admin_id}/sanctions",
                   token=admin_tok)
    items = body.get("items") if isinstance(body, dict) else []
    found = any(s.get("sanction_id") == sanction_id for s in items)
    check(sc == 200 and found,
          "GET /admin/users/{id}/sanctions includes new sanction",
          f"sc={sc} found={found}")

    sc, body = req("POST", f"/admin/users/{non_admin_id}/unsanction",
                   token=admin_tok, body={})
    check(sc == 200 and body.get("revoked_sanction_id") == sanction_id,
          "POST /admin/users/{id}/unsanction -> 200", f"sc={sc} body={body}")

    sc, body = req("GET", "/admin/audit-logs", token=admin_tok,
                   params={"target_id": non_admin_id, "limit": 20})
    actions = {i.get("action") for i in (body.get("items") or [])}
    check(sc == 200 and "user.warn" in actions and "user.unsanction" in actions,
          "audit_logs contains user.warn + user.unsanction",
          f"actions={actions}")

    time.sleep(1.0)
    sc, notif_body = req("GET", "/notifications", token=non_admin_tok,
                         params={"limit": 20})
    n_items = notif_body.get("items", []) if isinstance(notif_body, dict) else []
    kinds = {n.get("kind") for n in n_items}
    check(sc == 200 and "user_sanction_warn" in kinds,
          "sanctioned user got 'user_sanction_warn' notification",
          f"kinds={kinds}")

    # §4 Spot moderation
    log("\n-- §4 Spot moderation --")
    sc, body = req("GET", "/admin/spot-uploads/pending", token=admin_tok)
    check(sc == 200 and isinstance(body.get("items"), list),
          "GET /admin/spot-uploads/pending -> 200", f"sc={sc}")

    spot_approve = create_spot(non_admin_tok, f"QA Approve {rand(4)}")
    spot_reject = create_spot(non_admin_tok, f"QA Reject {rand(4)}")
    spot_action = create_spot(non_admin_tok, f"QA Action {rand(4)}")
    check(all([spot_approve, spot_reject, spot_action]),
          f"3 throwaway spots created ({spot_approve},{spot_reject},{spot_action})")

    if spot_approve:
        sc, body = req("POST", f"/admin/spots/{spot_approve}/approve",
                       token=admin_tok, body={})
        check(sc == 200 and body.get("ok"),
              "POST /admin/spots/{id}/approve -> 200", f"sc={sc}")
        sc, body = req("GET", f"/spots/{spot_approve}")
        check(sc == 200 and body.get("spot_id") == spot_approve,
              "public GET /spots/{id} after approve -> 200", f"sc={sc}")

    if spot_reject:
        sc, body = req("POST", f"/admin/spots/{spot_reject}/reject",
                       token=admin_tok, body={})
        check(sc == 200 and body.get("ok"),
              "POST /admin/spots/{id}/reject -> 200", f"sc={sc}")

    if spot_action:
        sc, body = req("POST", f"/admin/spots/{spot_action}/action",
                       token=admin_tok, body={"action": "feature"})
        check(sc == 200 and body.get("ok"),
              "POST /admin/spots/{id}/action feature -> 200", f"sc={sc}")

    # Cover editor — find a spot with images
    cover_spot_id = None
    first_img = None
    sc, body = req("GET", "/spots", token=admin_tok, params={"limit": 20})
    for s in (body if isinstance(body, list) else []):
        imgs = s.get("images") or []
        if imgs:
            first = imgs[0]
            url = first.get("image_url") if isinstance(first, dict) else first
            if url:
                cover_spot_id = s.get("spot_id")
                first_img = url
                break
    if cover_spot_id and first_img:
        sc, body = req("GET", f"/admin/spots/{cover_spot_id}/cover-editor",
                       token=admin_tok)
        check(sc == 200 and isinstance(body.get("images"), list),
              "GET /admin/spots/{id}/cover-editor -> 200", f"sc={sc}")

        sc, body = req("PATCH", f"/admin/spots/{cover_spot_id}/cover",
                       token=admin_tok,
                       body={"image_url": first_img, "focal_x": 0.5,
                             "focal_y": 0.5, "scale": 1.2, "rotation": 0})
        check(sc == 200 and body.get("ok"),
              "PATCH /admin/spots/{id}/cover -> 200",
              f"sc={sc} body={str(body)[:200]}")

        sc, editor = req("GET", f"/admin/spots/{cover_spot_id}/cover-editor",
                         token=admin_tok)
        urls = [i["image_url"] for i in (editor.get("images") or [])
                if i.get("source") == "spot"]
        if urls:
            sc, body = req("PATCH", f"/admin/spots/{cover_spot_id}/gallery",
                           token=admin_tok, body={"image_urls": urls})
            check(sc == 200 and body.get("ok"),
                  "PATCH /admin/spots/{id}/gallery -> 200",
                  f"sc={sc} body={body}")

        sc, body = req("DELETE", f"/admin/spots/{cover_spot_id}/cover",
                       token=admin_tok)
        check(sc == 200 and body.get("ok"),
              "DELETE /admin/spots/{id}/cover -> 200", f"sc={sc}")
    else:
        log("  WARN: no spot with images found; cover-editor tests skipped")

    # §5 Community moderation
    log("\n-- §5 Community moderation --")
    sc, body = req("GET", "/admin/posts", token=admin_tok, params={"limit": 3})
    check(sc == 200 and isinstance(body.get("items"), list),
          "GET /admin/posts?limit=3 -> 200", f"sc={sc}")

    sc, body = req("POST", "/posts", token=non_admin_tok, body={
        "kind": "post",
        "title": f"QA Post {rand(4)}",
        "body": "qa regression content",
        "category": "tip",
    })
    post_id = body.get("post_id") if isinstance(body, dict) else None
    if post_id:
        sc, body = req("DELETE", f"/admin/posts/{post_id}", token=admin_tok,
                       params={"reason": "qa delete"})
        check(sc == 200 and body.get("status") == "removed",
              "DELETE /admin/posts/{id} -> 200", f"sc={sc}")

        sc, body = req("POST", f"/admin/posts/{post_id}/restore",
                       token=admin_tok, body={})
        check(sc == 200 and body.get("status") == "active",
              "POST /admin/posts/{id}/restore -> 200", f"sc={sc}")

        sc, body = req("POST", "/admin/community/moderate", token=admin_tok,
                       body={"type": "post", "id": post_id,
                             "action": "soft_delete", "reason": "qa"})
        check(sc == 200, "POST /admin/community/moderate soft_delete -> 200",
              f"sc={sc} body={body}")

        sc, body = req("POST", "/admin/community/bulk-moderate",
                       token=admin_tok,
                       body={"type": "post", "ids": [post_id],
                             "action": "restore", "reason": "qa bulk"})
    else:
        sc, body = req("POST", "/admin/community/bulk-moderate",
                       token=admin_tok,
                       body={"type": "post", "ids": ["nonexistent_xxx"],
                             "action": "remove", "reason": "qa bulk"})
    check(sc == 200 and "applied" in body,
          "POST /admin/community/bulk-moderate -> 200", f"sc={sc}")

    sc, body = req("GET", "/admin/community/content", token=admin_tok,
                   params={"type": "post", "limit": 5})
    check(sc == 200 and isinstance(body.get("items"), list),
          "GET /admin/community/content -> 200", f"sc={sc}")

    sc, body = req("GET", "/admin/community/summary", token=admin_tok)
    check(sc == 200 and "posts" in body and "reports" in body,
          "GET /admin/community/summary -> 200", f"sc={sc}")

    # §6 Reports
    log("\n-- §6 Reports --")
    sc, body = req("GET", "/admin/reports", token=admin_tok,
                   params={"status": "pending"})
    check(sc == 200 and isinstance(body, list),
          "GET /admin/reports?status=pending -> 200", f"sc={sc}")

    if spot_approve:
        sc, rbody = req("POST", "/reports", token=non_admin_tok, body={
            "target_type": "spot", "target_id": spot_approve,
            "reason": "other",
        })
        rep_id = rbody.get("report_id") if isinstance(rbody, dict) else None
        check(sc == 200 and rep_id,
              "POST /reports (throwaway report for resolve flow) -> 200",
              f"sc={sc} body={rbody}")
        if rep_id:
            # Actual schema: {action: dismissed|removed|warned}
            sc, body = req("POST", f"/admin/reports/{rep_id}/resolve",
                           token=admin_tok, body={"action": "dismissed"})
            check(sc == 200 and body.get("ok"),
                  "POST /admin/reports/{id}/resolve -> 200",
                  f"sc={sc} body={body}")

    # §7 Platform settings
    log("\n-- §7 Platform settings --")
    sc, before = req("GET", "/admin/settings", token=admin_tok)
    check(sc == 200 and isinstance(before, dict),
          "GET /admin/settings -> 200", f"sc={sc}")
    orig_app_name = before.get("app_name")

    # PlatformSettingsPatch supports: app_name, support_email, maintenance_mode,
    # public_registration, etc. Not maintenance_banner.
    new_name = f"QA-{rand(4)}"
    sc, body = req("PATCH", "/admin/settings", token=admin_tok,
                   body={"app_name": new_name})
    check(sc == 200, "PATCH /admin/settings {app_name} -> 200", f"sc={sc}")

    sc, confirm = req("GET", "/admin/settings", token=admin_tok)
    check(sc == 200 and confirm.get("app_name") == new_name,
          "re-GET settings shows new value",
          f"app_name={confirm.get('app_name')}")

    if orig_app_name is not None:
        sc, _ = req("PATCH", "/admin/settings", token=admin_tok,
                    body={"app_name": orig_app_name})
        check(sc == 200, "PATCH /admin/settings revert -> 200", f"sc={sc}")

    # §8 Permission guard
    log("\n-- §8 Permission guard --")
    sc, _ = req("GET", "/admin/overview")
    check(sc == 401, "no-token GET /admin/overview -> 401", f"sc={sc}")

    sc, _ = req("GET", "/admin/overview", token=non_admin_tok)
    check(sc == 403, "non-admin GET /admin/overview -> 403", f"sc={sc}")

    sc, _ = req("GET", "/admin/overview", token=admin_tok)
    check(sc == 200, "admin GET /admin/overview -> 200", f"sc={sc}")

    sc, _ = req("POST", f"/admin/users/{non_admin_id}/sanction",
                token=non_admin_tok,
                body={"type": "warn", "reason": "noop"})
    check(sc == 403, "non-admin sanction -> 403", f"sc={sc}")

    sc, _ = req("DELETE", "/admin/posts/fake_post_xxx", token=non_admin_tok,
                params={"reason": "noop"})
    check(sc == 403, "non-admin DELETE /admin/posts/{id} -> 403", f"sc={sc}")

    sc, _ = req("PATCH", "/admin/settings", token=non_admin_tok,
                body={"app_name": "nope"})
    check(sc == 403, "non-admin PATCH /admin/settings -> 403", f"sc={sc}")

    # §9 Non-regression
    log("\n-- §9 Non-regression --")
    for endpoint in ("/auth/me", "/feed/home", "/notifications",
                     "/me/seller/connect-status"):
        sc, _ = req("GET", endpoint, token=admin_tok,
                    params={"limit": 3} if endpoint == "/notifications" else None)
        check(sc == 200, f"GET {endpoint} -> 200", f"sc={sc}")

    sc, body = req("GET", "/spots", token=admin_tok, params={"limit": 3})
    check(sc == 200 and isinstance(body, list) and len(body) <= 3,
          "GET /spots?limit=3 -> 200", f"sc={sc}")

    sc, body = req("GET", "/marketplace/storefront", token=admin_tok)
    check(sc == 200 and "rails" in body,
          "GET /marketplace/storefront -> 200", f"sc={sc}")

    new_spot = create_spot(non_admin_tok, f"QA NonReg {rand(4)}")
    check(bool(new_spot), "non-admin POST /spots -> spot_id",
          f"spot_id={new_spot}")

    _, other_id, _ = register_throwaway()
    if other_id:
        # POST /users/{id}/follow toggles — call twice for follow+unfollow
        sc, b1 = req("POST", f"/users/{other_id}/follow",
                     token=non_admin_tok, body={})
        check(sc in (200, 201) and b1.get("following") is True,
              "POST /users/{id}/follow (toggle ON) -> 200", f"sc={sc} {b1}")
        sc, b2 = req("POST", f"/users/{other_id}/follow",
                     token=non_admin_tok, body={})
        check(sc == 200 and b2.get("following") is False,
              "POST /users/{id}/follow (toggle OFF) -> 200", f"sc={sc} {b2}")

    sc, body = req("PATCH", "/me/notification-preferences", token=admin_tok,
                   body={"daily_cap": 10})
    check(sc == 200, "PATCH /me/notification-preferences -> 200", f"sc={sc}")

    # Marketplace checkout MOCK end-to-end
    sc, body = req("POST", "/marketplace/products", token=admin_tok, body={
        "title": f"QA Pack {rand(4)}",
        "description": "qa regression content pack",
        "price_cents": 1000,
        "type": "preset",
        "thumbnail_url": "https://example.com/thumb.jpg",
        "contents_url": "https://example.com/qa.zip",
    })
    product_id = body.get("product_id") if isinstance(body, dict) else None
    if product_id:
        sc, _ = req("POST",
                    f"/admin/marketplace/products/{product_id}/moderate",
                    token=admin_tok, body={"action": "approve"})
        check(sc == 200, "admin moderate product approve -> 200", f"sc={sc}")

        sc, body = req("POST",
                       f"/marketplace/products/{product_id}/checkout",
                       token=non_admin_tok, body={})
        purchase_id = body.get("purchase_id") if isinstance(body, dict) else None
        mocked = body.get("mocked") if isinstance(body, dict) else None
        check(sc == 200 and purchase_id and mocked,
              "marketplace checkout MOCK -> 200 mocked=True",
              f"sc={sc} body={body}")
        if purchase_id:
            sc, body = req("POST",
                           f"/marketplace/purchases/{purchase_id}/complete",
                           token=non_admin_tok, body={})
            check(sc == 200 and body.get("ok"),
                  "marketplace complete -> 200", f"sc={sc}")

    # §10 Marketplace spot check
    log("\n-- §10 Marketplace spot check --")
    sc, _ = req("GET", "/marketplace/storefront")
    check(sc == 200, "GET /marketplace/storefront (unauth) -> 200", f"sc={sc}")

    sc, _ = req("GET", "/me/marketplace/sales", token=admin_tok)
    check(sc == 200, "GET /me/marketplace/sales -> 200", f"sc={sc}")

    sc, _ = req("GET", "/admin/marketplace/pending", token=admin_tok)
    check(sc == 200, "GET /admin/marketplace/pending -> 200", f"sc={sc}")

    # Summary
    log("\n===== SUMMARY =====")
    log(f"PASS: {PASS}")
    log(f"FAIL: {FAIL}")
    log(f"500s encountered: {len(FIVE_HUNDREDS)}")
    if FIVE_HUNDREDS:
        log("\n500 errors:")
        for m in FIVE_HUNDREDS:
            log(f"  {m}")
    if FAIL_MSGS:
        log("\nFailures:")
        for m in FAIL_MSGS:
            log(f"  {m}")
    sys.exit(0 if FAIL == 0 and not FIVE_HUNDREDS else 1)


if __name__ == "__main__":
    run()
