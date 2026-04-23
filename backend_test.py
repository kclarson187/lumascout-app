"""
Phase 2 regression test — verify routes extracted from server.py into
/app/backend/routes/{network,referrals,push}.py still respond correctly.

Run: python3 /app/backend_test.py
"""
from __future__ import annotations

import random
import string
import sys
import time
from typing import Any, Optional

import requests

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

PASS = 0
FAIL = 0
FAIL_MSGS: list[str] = []
FIVE_HUNDREDS: list[str] = []


def _rand(n: int = 6) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def log_pass(label: str) -> None:
    global PASS
    PASS += 1
    print(f"  ✅ {label}")


def log_fail(label: str, detail: str = "") -> None:
    global FAIL
    FAIL += 1
    msg = f"{label}: {detail}" if detail else label
    FAIL_MSGS.append(msg)
    print(f"  ❌ {msg}")


def req(
    method: str, path: str, *, token: Optional[str] = None,
    json_body: Optional[dict] = None, params: Optional[dict] = None,
    expected_status: Optional[int] = None, label: str = "",
) -> tuple[int, Any]:
    url = f"{BASE}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        r = requests.request(method, url, headers=headers, json=json_body, params=params, timeout=30)
    except Exception as e:
        log_fail(label or f"{method} {path}", f"connection error: {e}")
        return 0, None
    body: Any
    try:
        body = r.json()
    except Exception:
        body = r.text
    if r.status_code >= 500:
        FIVE_HUNDREDS.append(f"{method} {path} → {r.status_code}: {str(body)[:200]}")
    if expected_status is not None:
        if r.status_code == expected_status:
            log_pass(f"{label or method + ' ' + path} → {r.status_code}")
        else:
            log_fail(label or f"{method} {path}", f"expected {expected_status}, got {r.status_code}: {str(body)[:200]}")
    return r.status_code, body


# --------------------------------------------------------------------------
# Auth helpers
# --------------------------------------------------------------------------
def login(email: str, password: str) -> Optional[str]:
    s, b = req("POST", "/auth/login", json_body={"email": email, "password": password})
    if s == 200 and isinstance(b, dict):
        return b.get("token") or b.get("access_token")
    print(f"  (login {email} failed: {s} {str(b)[:160]})")
    return None


def register(name: str, email: str, password: str, city: str = "Austin", state: str = "TX") -> Optional[dict]:
    s, b = req("POST", "/auth/register", json_body={
        "name": name, "email": email, "password": password,
        "city": city, "state": state,
    })
    if s == 200 and isinstance(b, dict):
        return b
    print(f"  (register {email} failed: {s} {str(b)[:160]})")
    return None


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main() -> int:
    print("=" * 70)
    print("Phase 2 regression — network / referrals / push route extraction")
    print("=" * 70)

    # Bootstrap admin token
    admin_tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_tok:
        print("ABORT — cannot login admin")
        return 1
    s, me = req("GET", "/auth/me", token=admin_tok, expected_status=200, label="admin /auth/me")
    admin_id = me.get("user_id") if isinstance(me, dict) else None
    print(f"  (admin_id={admin_id})")

    # Create two throwaway users u1, u2 in same city for cross tests
    stamp = _rand(5)
    u1_email = f"qa_u1_{stamp}@qatest.photoscout.app"
    u2_email = f"qa_u2_{stamp}@qatest.photoscout.app"
    u1_reg = register("QA One", u1_email, "Passw0rd!", city="Austin", state="TX")
    u2_reg = register("QA Two", u2_email, "Passw0rd!", city="Austin", state="TX")
    if not (u1_reg and u2_reg):
        print("ABORT — cannot create throwaway users")
        return 1
    u1_tok = u1_reg.get("token") or u1_reg.get("access_token") or login(u1_email, "Passw0rd!")
    u2_tok = u2_reg.get("token") or u2_reg.get("access_token") or login(u2_email, "Passw0rd!")
    s, u1_me = req("GET", "/auth/me", token=u1_tok)
    s, u2_me = req("GET", "/auth/me", token=u2_tok)
    u1_id = u1_me["user_id"]; u2_id = u2_me["user_id"]
    print(f"  (u1_id={u1_id}  u2_id={u2_id})")

    # ======================================================================
    # PUSH module
    # ======================================================================
    print("\n--- PUSH module ---")
    s, prefs = req("GET", "/me/notification-preferences", token=admin_tok,
                   expected_status=200, label="GET /me/notification-preferences")
    if isinstance(prefs, dict):
        have = {"push_enabled", "daily_cap", "quiet_hours", "categories"}.issubset(prefs.keys())
        if have:
            log_pass("prefs has push_enabled/daily_cap/quiet_hours/categories")
            if {"enabled", "start", "end"}.issubset(prefs.get("quiet_hours", {}).keys()):
                log_pass("quiet_hours has enabled/start/end")
            else:
                log_fail("prefs quiet_hours shape", str(prefs.get("quiet_hours")))
        else:
            log_fail("prefs keys", str(list(prefs.keys()) if isinstance(prefs, dict) else prefs))

    # PATCH categories.promotions=true
    s, p2 = req("PATCH", "/me/notification-preferences", token=admin_tok,
                json_body={"categories": {"promotions": True}}, expected_status=200,
                label="PATCH prefs categories.promotions=true")
    if isinstance(p2, dict) and p2.get("categories", {}).get("promotions") is True:
        log_pass("categories.promotions persisted true")
    else:
        log_fail("categories.promotions persisted", str(p2.get("categories") if isinstance(p2, dict) else p2))

    # Re-GET returns same
    s, p2g = req("GET", "/me/notification-preferences", token=admin_tok)
    if isinstance(p2g, dict) and p2g.get("categories", {}).get("promotions") is True:
        log_pass("re-GET shows promotions=true")
    else:
        log_fail("re-GET promotions", "not persisted")

    # Clamping daily_cap → 50
    s, p3 = req("PATCH", "/me/notification-preferences", token=admin_tok,
                json_body={"daily_cap": 99}, expected_status=200,
                label="PATCH daily_cap=99")
    if isinstance(p3, dict) and p3.get("daily_cap") == 50:
        log_pass("daily_cap clamped 99→50")
    else:
        log_fail("daily_cap clamp 99→50", str(p3.get("daily_cap") if isinstance(p3, dict) else p3))

    # Clamping daily_cap → 1
    s, p4 = req("PATCH", "/me/notification-preferences", token=admin_tok,
                json_body={"daily_cap": 0}, expected_status=200,
                label="PATCH daily_cap=0")
    if isinstance(p4, dict) and p4.get("daily_cap") == 1:
        log_pass("daily_cap clamped 0→1")
    else:
        log_fail("daily_cap clamp 0→1", str(p4.get("daily_cap") if isinstance(p4, dict) else p4))

    # quiet_hours set
    s, p5 = req("PATCH", "/me/notification-preferences", token=admin_tok,
                json_body={"quiet_hours": {"enabled": True, "start": "23:00", "end": "08:00"}},
                expected_status=200, label="PATCH quiet_hours")
    if isinstance(p5, dict) and p5.get("quiet_hours", {}).get("start") == "23:00" \
            and p5.get("quiet_hours", {}).get("end") == "08:00" \
            and p5.get("quiet_hours", {}).get("enabled") is True:
        log_pass("quiet_hours persisted 23:00-08:00 enabled")
    else:
        log_fail("quiet_hours persisted", str(p5.get("quiet_hours") if isinstance(p5, dict) else p5))

    # Ensure promotions=true + daily_cap reasonable + quiet_hours off for test-push
    req("PATCH", "/me/notification-preferences", token=admin_tok,
        json_body={"categories": {"promotions": True}, "daily_cap": 50,
                   "quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"}})

    # test-push with promotions=true → delivered:true (but subject to 10-min dedupe)
    s, tp1 = req("POST", "/me/notifications/test-push", token=admin_tok,
                 expected_status=200, label="POST /me/notifications/test-push (promotions on)")
    if isinstance(tp1, dict) and "delivered" in tp1:
        log_pass(f"test-push returns delivered={tp1.get('delivered')}")
    else:
        log_fail("test-push shape", str(tp1))

    # test-push with promotions=false
    req("PATCH", "/me/notification-preferences", token=admin_tok,
        json_body={"categories": {"promotions": False}})
    s, tp2 = req("POST", "/me/notifications/test-push", token=admin_tok,
                 expected_status=200)
    if isinstance(tp2, dict) and tp2.get("delivered") is False:
        log_pass("test-push promotions=false → delivered=false")
    else:
        log_fail("test-push promotions=false", str(tp2))
    # Restore
    req("PATCH", "/me/notification-preferences", token=admin_tok,
        json_body={"categories": {"promotions": True}, "daily_cap": 10,
                   "quiet_hours": {"enabled": True, "start": "22:00", "end": "07:00"}})

    # GET /notifications
    s, nlist = req("GET", "/notifications", token=admin_tok, params={"limit": 5},
                   expected_status=200, label="GET /notifications?limit=5")
    if isinstance(nlist, dict) and "items" in nlist:
        log_pass(f"/notifications items={len(nlist['items'])}")
    else:
        log_fail("/notifications shape", str(nlist)[:200])

    # mark-read without body
    s, mr = req("POST", "/notifications/mark-read", token=admin_tok, json_body={},
                expected_status=200, label="POST /notifications/mark-read {}")
    if isinstance(mr, dict) and mr.get("ok") is True:
        log_pass("mark-read ok")

    # push-token register
    fake_token = f"ExponentPushToken[QA{stamp}]"
    s, pt = req("POST", "/me/push-token", token=admin_tok,
                json_body={"token": fake_token, "device_type": "ios", "platform": "ios"},
                expected_status=200, label="POST /me/push-token")
    # push-token delete (endpoint requires token query param)
    s, ptd = req("DELETE", "/me/push-token", token=admin_tok,
                 params={"token": fake_token}, expected_status=200,
                 label="DELETE /me/push-token")

    # ======================================================================
    # NETWORK module
    # ======================================================================
    print("\n--- NETWORK module ---")
    # /me/viewers
    s, v = req("GET", "/me/viewers", token=admin_tok, params={"limit": 10},
               expected_status=200, label="GET /me/viewers?limit=10")
    if isinstance(v, dict) and "plan" in v and "viewers" in v:
        log_pass(f"/me/viewers plan={v.get('plan')} viewers_count={len(v.get('viewers', []))}")
    else:
        log_fail("/me/viewers shape", str(v)[:200])

    # /me/viewers/summary
    s, vs = req("GET", "/me/viewers/summary", token=admin_tok, expected_status=200,
                label="GET /me/viewers/summary")
    if isinstance(vs, dict) and ("total_7d" in vs or "count_7d" in vs):
        log_pass(f"viewers/summary total_7d={vs.get('total_7d') or vs.get('count_7d')}")
    else:
        log_fail("viewers/summary shape", str(vs)[:200])

    # /me/analytics/networking
    s, an = req("GET", "/me/analytics/networking", token=admin_tok, expected_status=200,
                label="GET /me/analytics/networking")
    if isinstance(an, dict) and "profile_views_30d" in an:
        log_pass(f"analytics/networking profile_views_30d={an.get('profile_views_30d')}")
    else:
        log_fail("analytics/networking shape", str(an)[:200])

    # Follow toggle: u1 → u2
    s, f1 = req("POST", f"/users/{u2_id}/follow", token=u1_tok, expected_status=200,
                label="POST /users/{u2}/follow (u1)")
    if isinstance(f1, dict) and f1.get("following") is True:
        log_pass("follow → {following:true}")
    else:
        log_fail("follow response", str(f1))
    s, f2 = req("POST", f"/users/{u2_id}/follow", token=u1_tok, expected_status=200,
                label="POST /users/{u2}/follow (toggle)")
    if isinstance(f2, dict) and f2.get("following") is False:
        log_pass("re-follow → {following:false}")
    else:
        log_fail("unfollow response", str(f2))
    # Re-follow so we get a follower row for u2
    req("POST", f"/users/{u2_id}/follow", token=u1_tok)

    # DM /dm/threads/start u1 → u2
    s, dmstart = req("POST", "/dm/threads/start", token=u1_tok,
                     json_body={"user_id": u2_id, "opening_body": "hi from u1"},
                     expected_status=200, label="POST /dm/threads/start")
    thread_id = (dmstart or {}).get("thread_id") if isinstance(dmstart, dict) else None
    if thread_id:
        log_pass(f"thread_id={thread_id}")
    else:
        log_fail("dm start thread_id missing", str(dmstart))

    # Send message on thread
    if thread_id:
        s, msg = req("POST", f"/dm/threads/{thread_id}/messages", token=u1_tok,
                     json_body={"type": "text", "body": "second hi"},
                     expected_status=200, label="POST /dm/threads/{id}/messages")
        if isinstance(msg, dict) and msg.get("body"):
            log_pass("dm message sent")

    # GET /dm/threads
    s, tlist = req("GET", "/dm/threads", token=u1_tok, expected_status=200,
                   label="GET /dm/threads")
    if isinstance(tlist, dict) and "items" in tlist:
        log_pass(f"dm threads items={len(tlist['items'])}")

    # DM requests: u2 can accept, ignore, block. Fetch pending requests for u2
    s, req_list = req("GET", "/dm/threads", token=u2_tok, params={"tab": "requests"})
    req_items = (req_list or {}).get("items", []) if isinstance(req_list, dict) else []
    req_id = req_items[0]["request_id"] if req_items else None
    if req_id:
        s, acc = req("POST", f"/dm/requests/{req_id}/accept", token=u2_tok,
                     expected_status=200, label="POST /dm/requests/{id}/accept")

    # /network/discover
    s, disc = req("GET", "/network/discover", token=admin_tok, params={"limit_per_rail": 5},
                  expected_status=200, label="GET /network/discover")
    if isinstance(disc, dict) and any(k in disc for k in ("near_you", "verified_pros", "new_members")):
        log_pass(f"discover rails keys={list(disc.keys())[:5]}")

    # /network/search
    s, sr = req("GET", "/network/search", token=admin_tok, params={"q": "admin"},
                expected_status=200, label="GET /network/search?q=admin")
    if isinstance(sr, dict) and "items" in sr:
        log_pass(f"search items={len(sr['items'])}")

    # /mentors
    s, mn = req("GET", "/mentors", token=admin_tok, params={"limit": 3},
                expected_status=200, label="GET /mentors?limit=3")

    # /users/{admin_id}/trust
    s, tr = req("GET", f"/users/{admin_id}/trust", expected_status=200,
                label="GET /users/{admin_id}/trust")

    # /conversations legacy
    s, cv = req("POST", "/conversations", token=u1_tok,
                json_body={"participant_user_id": u2_id}, expected_status=200,
                label="POST /conversations")
    conv_id = (cv or {}).get("conversation_id") if isinstance(cv, dict) else None
    # idempotent re-POST
    s, cv2 = req("POST", "/conversations", token=u1_tok,
                 json_body={"participant_user_id": u2_id}, expected_status=200,
                 label="POST /conversations (idempotent)")
    if conv_id and isinstance(cv2, dict) and cv2.get("conversation_id") == conv_id:
        log_pass("conversations idempotent")

    s, myconv = req("GET", "/me/conversations", token=u1_tok, expected_status=200,
                    label="GET /me/conversations")

    if conv_id:
        s, cmsg = req("POST", f"/conversations/{conv_id}/messages", token=u1_tok,
                      json_body={"body": "hi legacy"}, expected_status=200,
                      label="POST /conversations/{id}/messages")

    # ======================================================================
    # REFERRALS module
    # ======================================================================
    print("\n--- REFERRALS module ---")
    # NOTE: Review spec used gig_type='paid' but valid values are in GIG_TYPES
    # constant (full_session_referral, second_shooter, etc). Use valid one.
    ref_body = {
        "title": "Need second shooter Austin QA",
        "shoot_type": "portrait",
        "gig_type": "full_session_referral",
        "city": "Austin",
        "state": "TX",
    }
    s, rn = req("POST", "/referrals", token=u1_tok, json_body=ref_body,
                expected_status=200, label="POST /referrals")
    need_id = (rn or {}).get("need_id") if isinstance(rn, dict) else None
    if need_id:
        log_pass(f"need_id={need_id}")

    s, rlist = req("GET", "/referrals", params={"city": "Austin"}, expected_status=200,
                   label="GET /referrals?city=Austin")
    s, rails = req("GET", "/referrals/rails", expected_status=200,
                   label="GET /referrals/rails")
    s, mine = req("GET", "/me/referrals", token=u1_tok, expected_status=200,
                  label="GET /me/referrals")

    if need_id:
        s, gr = req("GET", f"/referrals/{need_id}", token=u1_tok, expected_status=200,
                    label="GET /referrals/{id}")
        # PATCH as poster → 200 (note: ReferralUpdateIn only allows status/notes/urgency;
        # 'title' will be ignored silently, but request should succeed)
        s, pr = req("PATCH", f"/referrals/{need_id}", token=u1_tok,
                    json_body={"notes": "updated notes"}, expected_status=200,
                    label="PATCH /referrals/{id} (poster)")
        # PATCH as non-poster → 403
        s, pr2 = req("PATCH", f"/referrals/{need_id}", token=u2_tok,
                     json_body={"notes": "hack"}, expected_status=403,
                     label="PATCH /referrals/{id} (non-poster)")
        # u2 applies to u1's need
        s, ap = req("POST", f"/referrals/{need_id}/apply", token=u2_tok,
                    json_body={"pitch": "I'd love to"}, expected_status=200,
                    label="POST /referrals/{id}/apply")
        app_id = (ap or {}).get("app_id") if isinstance(ap, dict) else None
        if app_id:
            log_pass(f"app_id={app_id}")
            # u1 accepts
            s, acc = req("POST", f"/referrals/{need_id}/applications/{app_id}/accept",
                         token=u1_tok, expected_status=200,
                         label="POST accept application")
        # Apply a second need for reject test
        ref_body2 = {**ref_body, "title": "Second gig for reject test"}
        s2, rn2 = req("POST", "/referrals", token=u1_tok, json_body=ref_body2)
        need2 = (rn2 or {}).get("need_id") if isinstance(rn2, dict) else None
        if need2:
            s, ap2 = req("POST", f"/referrals/{need2}/apply", token=u2_tok,
                         json_body={"pitch": "reject me"})
            app2 = (ap2 or {}).get("app_id") if isinstance(ap2, dict) else None
            if app2:
                req("POST", f"/referrals/{need2}/applications/{app2}/reject",
                    token=u1_tok, expected_status=200, label="POST reject application")
            # Non-poster DELETE → 403
            req("DELETE", f"/referrals/{need2}", token=u2_tok,
                expected_status=403, label="DELETE non-poster → 403")
            # Poster DELETE → 200
            req("DELETE", f"/referrals/{need2}", token=u1_tok,
                expected_status=200, label="DELETE poster → 200")

        # Cleanup — delete first need
        if need_id:
            req("DELETE", f"/referrals/{need_id}", token=u1_tok)

    # ======================================================================
    # CROSS-MODULE integration (send_growth_push + notifications)
    # ======================================================================
    print("\n--- CROSS-MODULE integration ---")
    # Follow u1→admin so admin gets new_follower notification
    s, _ = req("POST", f"/users/{admin_id}/follow", token=u1_tok, expected_status=200,
               label="u1 follows admin")
    time.sleep(1.5)
    s, nf = req("GET", "/notifications", token=admin_tok, params={"limit": 10})
    kinds = [n.get("kind") for n in (nf or {}).get("items", [])] if isinstance(nf, dict) else []
    if "new_follower" in kinds:
        log_pass("admin received new_follower notification")
    else:
        log_fail("new_follower cross-module", f"kinds recent: {kinds[:8]}")
    # unfollow
    req("POST", f"/users/{admin_id}/follow", token=u1_tok)

    # ======================================================================
    # NON-REGRESSION
    # ======================================================================
    print("\n--- NON-REGRESSION ---")
    req("GET", "/auth/me", token=admin_tok, expected_status=200, label="GET /auth/me")
    req("GET", "/feed/home", token=admin_tok, expected_status=200, label="GET /feed/home")
    req("GET", "/spots", params={"limit": 3}, expected_status=200, label="GET /spots?limit=3")
    req("GET", "/marketplace/storefront", expected_status=200, label="GET /marketplace/storefront")
    req("GET", "/me/marketplace/sales", token=admin_tok, expected_status=200, label="GET /me/marketplace/sales")
    req("GET", "/admin/overview", token=admin_tok, expected_status=200, label="GET /admin/overview")
    req("GET", "/admin/users", token=admin_tok, params={"limit": 3}, expected_status=200, label="GET /admin/users")
    req("GET", "/admin/audit-logs", token=admin_tok, params={"limit": 3}, expected_status=200, label="GET /admin/audit-logs")

    # ======================================================================
    # PERMISSION sanity
    # ======================================================================
    print("\n--- PERMISSION sanity ---")
    # Non-admin hitting admin endpoint → 403
    req("GET", "/admin/overview", token=u1_tok, expected_status=403, label="non-admin /admin/overview → 403")
    # Unauth /me/* → 401
    req("GET", "/me/notification-preferences", expected_status=401, label="unauth /me/notification-preferences → 401")
    req("POST", "/me/push-token", json_body={"token": "x"}, expected_status=401,
        label="unauth /me/push-token → 401")

    # ======================================================================
    # Summary
    # ======================================================================
    print("\n" + "=" * 70)
    print(f"RESULTS: {PASS} passed, {FAIL} failed")
    if FIVE_HUNDREDS:
        print(f"\n🔴 5xx errors ({len(FIVE_HUNDREDS)}):")
        for e in FIVE_HUNDREDS:
            print(f"  - {e}")
    if FAIL_MSGS:
        print(f"\n❌ Failures:")
        for m in FAIL_MSGS:
            print(f"  - {m}")
    print("=" * 70)
    return 0 if FAIL == 0 and not FIVE_HUNDREDS else 1


if __name__ == "__main__":
    sys.exit(main())
