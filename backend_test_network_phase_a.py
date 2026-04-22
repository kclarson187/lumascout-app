#!/usr/bin/env python3
"""Network Phase A — DM, Requests, Safety, Network/Discover, Trust, Notifications.

Run from /app:  python3 backend_test_network_phase_a.py
"""
import os
import sys
import uuid
import time
import json
import traceback
from typing import Optional

import requests

BASE = os.environ.get("PS_BASE_URL", "http://localhost:8001/api")
S = requests.Session()
S.headers.update({"Content-Type": "application/json"})
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PWD = "admin123"

results: list = []
cleanup_user_ids: list = []
cleanup_thread_ids: list = []
admin_token: Optional[str] = None


def _ok(step, cond, msg=""):
    mark = "PASS" if cond else "FAIL"
    print(f"  [{mark}] {step}{(' — '+msg) if msg else ''}")
    results.append((step, bool(cond), msg))
    return bool(cond)


def _req(method: str, path: str, token: Optional[str] = None, **kwargs):
    headers = kwargs.pop("headers", {}) or {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = path if path.startswith("http") else f"{BASE}{path}"
    return S.request(method, url, headers=headers, timeout=30, **kwargs)


def login(email, password):
    r = _req("POST", "/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    d = r.json()
    return d["token"], d["user"]


def register(prefix="tester") -> dict:
    email = f"{prefix}.{uuid.uuid4().hex[:8]}@photoscout.app"
    r = _req("POST", "/auth/register",
             json={"email": email, "password": "demo123", "name": prefix.capitalize()})
    if r.status_code != 200:
        raise RuntimeError(f"Register failed: {r.status_code} {r.text}")
    d = r.json()
    cleanup_user_ids.append(d["user"]["user_id"])
    return {"email": email, "token": d["token"], **d["user"]}


def get_notifications(token: str, types: Optional[list] = None):
    r = _req("GET", "/me/notifications?limit=50", token=token)
    if r.status_code != 200:
        return []
    items = r.json().get("items", [])
    if types:
        items = [n for n in items if n.get("type") in types]
    return items


# ------------------------------------------------------------------
# SCENARIOS
# ------------------------------------------------------------------
def scenario_1_setup():
    print("\n=== Scenario 1 — Setup (register testerA/B/C + admin login) ===")
    global admin_token
    admin_token, _ = login(ADMIN_EMAIL, ADMIN_PWD)
    _ok("1.admin-login", bool(admin_token))
    A = register("qaA")
    B = register("qaB")
    C = register("qaC")
    _ok("1.registered-3-fresh", all(u.get("user_id") for u in [A, B, C]))
    return A, B, C


def scenario_2_start_request(A, B):
    print("\n=== Scenario 2 — testerA starts thread → testerB; request + notif ===")
    r = _req("POST", "/dm/threads/start",
             token=A["token"],
             json={"user_id": B["user_id"], "opening_body": "Hey — big fan of your work!"})
    ok = _ok("2.start-200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}")
    if not ok: return None
    d = r.json()
    _ok("2.is_request-true", d.get("is_request") is True, f"payload={d}")
    _ok("2.thread-id-present", bool(d.get("thread_id")))
    tid = d.get("thread_id")
    cleanup_thread_ids.append(tid)

    # B sees a new_message_request notification
    time.sleep(0.3)
    notifs = get_notifications(B["token"], types=["new_message_request"])
    _ok("2.B-has-request-notif", len(notifs) >= 1, f"notif count={len(notifs)}")

    # GET /dm/threads?tab=requests as B shows 1 pending
    r = _req("GET", "/dm/threads?tab=requests", token=B["token"])
    if _ok("2.B-requests-tab-200", r.status_code == 200):
        items = r.json().get("items", [])
        _ok("2.B-requests-includes", any(it.get("from_user_id") == A["user_id"] for it in items),
            f"items count={len(items)}")
        # sender hydrated
        found = next((it for it in items if it.get("from_user_id") == A["user_id"]), None)
        if found:
            _ok("2.request-sender-hydrated",
                bool(found.get("sender") and found["sender"].get("user_id") == A["user_id"]),
                f"sender keys={list((found.get('sender') or {}).keys())}")
    return tid


def scenario_3_accept_flow(A, B, tid):
    print("\n=== Scenario 3 — testerB accepts, A posts 2nd msg, B reads thread ===")
    # find the pending request_id
    r = _req("GET", "/dm/threads?tab=requests", token=B["token"])
    items = r.json().get("items", [])
    req = next((it for it in items if it.get("from_user_id") == A["user_id"]), None)
    if not req:
        _ok("3.request-found", False, "no request to accept")
        return
    rid = req["request_id"]
    r = _req("POST", f"/dm/requests/{rid}/accept", token=B["token"])
    _ok("3.accept-200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:100]}")

    # B now sees the thread in default list
    r = _req("GET", "/dm/threads", token=B["token"])
    if _ok("3.B-threads-list-200", r.status_code == 200):
        items = r.json().get("items", [])
        _ok("3.B-has-thread-after-accept",
            any(it.get("thread_id") == tid for it in items),
            f"thread_id={tid} items={len(items)}")

    # A posts another message
    r = _req("POST", f"/dm/threads/{tid}/messages",
             token=A["token"],
             json={"type": "text", "body": "Would love to collaborate on a shoot in Austin."})
    _ok("3.A-second-msg-200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}")

    # B GETs thread → 2 messages chronological, other hydrated
    r = _req("GET", f"/dm/threads/{tid}", token=B["token"])
    if _ok("3.B-get-thread-200", r.status_code == 200):
        d = r.json()
        msgs = d.get("messages", [])
        _ok("3.B-has-2-msgs", len(msgs) >= 2, f"got {len(msgs)}")
        # chronological (ascending)
        if len(msgs) >= 2:
            t1 = msgs[0].get("created_at")
            t2 = msgs[-1].get("created_at")
            _ok("3.chronological-order", t1 <= t2, f"{t1} vs {t2}")
        # other hydrated
        _ok("3.other-hydrated",
            bool(d.get("other") and d["other"].get("user_id") == A["user_id"]),
            f"other={d.get('other')}")


def scenario_4_quickstart_null_opening(A, C):
    print("\n=== Scenario 4 — start thread with null opening_body (quick-start refer) ===")
    r = _req("POST", "/dm/threads/start",
             token=A["token"],
             json={"user_id": C["user_id"], "kind": "refer", "opening_body": None})
    if not _ok("4.start-200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}"):
        return None
    d = r.json()
    tid = d.get("thread_id")
    cleanup_thread_ids.append(tid)
    _ok("4.opening_preview-null", d.get("opening_preview") is None,
        f"opening_preview={d.get('opening_preview')}")

    # Thread should have 0 messages since opening_body was null
    r = _req("GET", f"/dm/threads/{tid}", token=A["token"])
    if _ok("4.GET-thread-200", r.status_code == 200):
        msgs = r.json().get("messages", [])
        _ok("4.zero-messages-on-null-opening", len(msgs) == 0, f"msg count={len(msgs)}")
    return tid


def scenario_5_attachments(A, B, C, tid_AB):
    print("\n=== Scenario 5 — attachment + validation paths ===")
    # Get a real spot_id from db
    r = _req("GET", "/spots?limit=1")
    spots = r.json() if r.status_code == 200 else []
    if isinstance(spots, dict):
        spots = spots.get("items", [])
    real_spot_id = spots[0]["spot_id"] if spots else None
    _ok("5.have-real-spot_id", bool(real_spot_id), f"id={real_spot_id}")

    # a) image attachment with body=null
    r = _req("POST", f"/dm/threads/{tid_AB}/messages",
             token=B["token"],
             json={"type": "image",
                   "attachment_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQIW2NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC",
                   "body": None})
    _ok("5a.image-200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}")

    # b) spot_share
    if real_spot_id:
        r = _req("POST", f"/dm/threads/{tid_AB}/messages",
                 token=B["token"],
                 json={"type": "spot_share", "ref_spot_id": real_spot_id})
        _ok("5b.spot_share-200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}")
        # Hydration in GET
        r = _req("GET", f"/dm/threads/{tid_AB}", token=A["token"])
        msgs = r.json().get("messages", [])
        shared = next((m for m in msgs if m.get("type") == "spot_share"), None)
        if shared:
            sr = shared.get("spot_ref") or {}
            _ok("5b.spot_ref-hydrated",
                "title" in sr and "cover_image_url" in sr,
                f"spot_ref keys={list(sr.keys())}")

    # c) profile_share → testerC
    r = _req("POST", f"/dm/threads/{tid_AB}/messages",
             token=B["token"],
             json={"type": "profile_share", "ref_user_id": C["user_id"]})
    _ok("5c.profile_share-200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}")
    r = _req("GET", f"/dm/threads/{tid_AB}", token=A["token"])
    msgs = r.json().get("messages", [])
    pshare = next((m for m in msgs if m.get("type") == "profile_share"), None)
    if pshare:
        ur = pshare.get("user_ref") or {}
        _ok("5c.user_ref-hydrated",
            "name" in ur and ("avatar_url" in ur),
            f"user_ref keys={list(ur.keys())}")

    # d) empty body text → 422
    r = _req("POST", f"/dm/threads/{tid_AB}/messages",
             token=B["token"], json={"type": "text", "body": ""})
    _ok("5d.empty-text-422", r.status_code == 422, f"got {r.status_code} {r.text[:80]}")

    # e) too long → 422
    r = _req("POST", f"/dm/threads/{tid_AB}/messages",
             token=B["token"], json={"type": "text", "body": "a" * 2001})
    _ok("5e.2001-too-long-422", r.status_code == 422, f"got {r.status_code} {r.text[:80]}")

    # f) unknown type → 400
    r = _req("POST", f"/dm/threads/{tid_AB}/messages",
             token=B["token"], json={"type": "weird", "body": "hi"})
    _ok("5f.unknown-type-400", r.status_code == 400, f"got {r.status_code} {r.text[:80]}")


def scenario_6_rate_limits(A):
    print("\n=== Scenario 6 — rate limits ===")
    # 6a) 5 new pending requests OK; 6th → 429.
    # Use fresh target users.
    fresh_users = [register(f"qaRL{i}") for i in range(6)]
    statuses = []
    for i, u in enumerate(fresh_users):
        r = _req("POST", "/dm/threads/start",
                 token=A["token"],
                 json={"user_id": u["user_id"], "opening_body": f"rate-limit test {i}"})
        statuses.append(r.status_code)
        if r.status_code == 200:
            cleanup_thread_ids.append(r.json().get("thread_id"))
    _ok("6a.first-5-ok", all(s == 200 for s in statuses[:5]), f"statuses={statuses[:5]}")
    _ok("6a.sixth-429", statuses[5] == 429, f"6th status={statuses[5]} all={statuses}")

    # 6b) 30 msgs/min per sender per thread
    # Use an ACCEPTED thread to avoid request-rate-limit interference.
    # Build accepted thread A↔X quickly: create fresh user X, make A follow X and X follow A,
    # then start thread → should NOT be a request.
    X = register("qaMSG")
    # X follows A so threads from A aren't requests.
    r = _req("POST", f"/users/{A['user_id']}/follow", token=X["token"])
    _ok("6b.X-followed-A", r.status_code == 200)
    r = _req("POST", "/dm/threads/start",
             token=A["token"],
             json={"user_id": X["user_id"], "opening_body": "rate test"})
    if r.status_code != 200:
        _ok("6b.accepted-thread-start", False, f"HTTP {r.status_code} {r.text[:120]}")
        return
    data = r.json()
    tid = data["thread_id"]
    cleanup_thread_ids.append(tid)
    _ok("6b.not-a-request", data.get("is_request") is False, f"is_request={data.get('is_request')}")

    # Post messages 2..30 (count opening body as 1).  31st → 429.
    burst_statuses = []
    for i in range(1, 31):   # 30 more attempts; cumulative with opening = 31
        r = _req("POST", f"/dm/threads/{tid}/messages",
                 token=A["token"], json={"type": "text", "body": f"burst {i}"})
        burst_statuses.append(r.status_code)
    n_200 = sum(1 for s in burst_statuses if s == 200)
    n_429 = sum(1 for s in burst_statuses if s == 429)
    _ok("6b.eventually-429",
        n_429 >= 1,
        f"200s={n_200} 429s={n_429} (limit is 30/min per sender/thread)")


def scenario_7_markread_unread(A, B, tid_AB):
    print("\n=== Scenario 7 — mark-read and unread_count ===")
    # Make sure A has unread (B sent several msgs during scenario 5/attachments)
    r = _req("GET", "/dm/threads", token=A["token"])
    items = r.json().get("items", [])
    t = next((x for x in items if x.get("thread_id") == tid_AB), None)
    _ok("7.A-thread-row-present", bool(t))
    if t:
        _ok("7.unread-before-mark", (t.get("unread_count") or 0) >= 1,
            f"unread={t.get('unread_count')}")
    # mark read
    r = _req("POST", f"/dm/threads/{tid_AB}/mark-read", token=A["token"])
    _ok("7.mark-read-200", r.status_code == 200)
    # recheck
    r = _req("GET", "/dm/threads", token=A["token"])
    items = r.json().get("items", [])
    t = next((x for x in items if x.get("thread_id") == tid_AB), None)
    _ok("7.unread-zero-after-mark", (t or {}).get("unread_count") == 0,
        f"unread={t.get('unread_count') if t else 'missing'}")


def scenario_8_mute(A, tid_AB):
    print("\n=== Scenario 8 — mute toggle ===")
    r1 = _req("POST", f"/dm/threads/{tid_AB}/mute", token=A["token"])
    _ok("8.mute-first-200", r1.status_code == 200)
    v1 = r1.json().get("is_muted") if r1.status_code == 200 else None
    r2 = _req("POST", f"/dm/threads/{tid_AB}/mute", token=A["token"])
    _ok("8.mute-second-200", r2.status_code == 200)
    v2 = r2.json().get("is_muted") if r2.status_code == 200 else None
    _ok("8.mute-toggled", bool(v1) != bool(v2), f"first={v1} second={v2}")


def scenario_9_block_report(A, B, C):
    print("\n=== Scenario 9 — report + block flows ===")
    # 9a) C reports A
    r = _req("POST", f"/users/{A['user_id']}/report", token=C["token"],
             json={"reason": "spam", "notes": "sent unsolicited dm"})
    _ok("9a.report-200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}")

    # 9b) fresh pair: create new B2 that receives a request from A, then blocks it.
    A2 = register("qaBlkA")
    B2 = register("qaBlkB")
    r = _req("POST", "/dm/threads/start", token=A2["token"],
             json={"user_id": B2["user_id"], "opening_body": "hey B2"})
    if r.status_code != 200:
        _ok("9b.setup-start", False, f"HTTP {r.status_code} {r.text[:120]}")
        return
    tid = r.json().get("thread_id")
    cleanup_thread_ids.append(tid)

    # find the request_id on B2 side
    r = _req("GET", "/dm/threads?tab=requests", token=B2["token"])
    items = r.json().get("items", [])
    req = next((it for it in items if it.get("from_user_id") == A2["user_id"]), None)
    if not req:
        _ok("9b.request-present", False)
        return
    rid = req["request_id"]
    r = _req("POST", f"/dm/requests/{rid}/block", token=B2["token"])
    _ok("9b.block-200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}")

    # Now A2 tries to start a new thread to B2 → 403
    r = _req("POST", "/dm/threads/start", token=A2["token"],
             json={"user_id": B2["user_id"], "opening_body": "another try"})
    _ok("9b.start-after-block-403", r.status_code == 403,
        f"got {r.status_code} {r.text[:120]}")

    # And A2 sending a message into the existing thread → 403
    r = _req("POST", f"/dm/threads/{tid}/messages",
             token=A2["token"], json={"type": "text", "body": "hey"})
    _ok("9b.msg-after-block-403", r.status_code == 403,
        f"got {r.status_code} {r.text[:120]}")


def scenario_10_soft_delete(A, B):
    print("\n=== Scenario 10 — soft-delete + auto un-hide on inbound msg ===")
    # Build fresh accepted thread
    A3 = register("qaSDA")
    B3 = register("qaSDB")
    # Make them mutually following → accepted thread
    _req("POST", f"/users/{A3['user_id']}/follow", token=B3["token"])
    r = _req("POST", "/dm/threads/start", token=A3["token"],
             json={"user_id": B3["user_id"], "opening_body": "first msg"})
    if r.status_code != 200:
        _ok("10.setup", False)
        return
    tid = r.json()["thread_id"]
    cleanup_thread_ids.append(tid)

    # A3 deletes thread
    r = _req("DELETE", f"/dm/threads/{tid}", token=A3["token"])
    _ok("10.delete-200", r.status_code == 200)

    r = _req("GET", "/dm/threads", token=A3["token"])
    items = r.json().get("items", [])
    _ok("10.thread-hidden-for-A",
        not any(it.get("thread_id") == tid for it in items),
        f"items count={len(items)}")

    # B3 sends msg → thread un-hides for A3
    r = _req("POST", f"/dm/threads/{tid}/messages", token=B3["token"],
             json={"type": "text", "body": "ping"})
    _ok("10.B-msg-200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}")

    r = _req("GET", "/dm/threads", token=A3["token"])
    items = r.json().get("items", [])
    _ok("10.thread-unhidden-for-A",
        any(it.get("thread_id") == tid for it in items),
        f"items count={len(items)}")


def scenario_11_trust(A, B):
    print("\n=== Scenario 11 — trust metrics ===")
    r = _req("GET", f"/users/{A['user_id']}/trust")
    if not _ok("11.trust-200", r.status_code == 200, f"HTTP {r.status_code}"):
        return
    d = r.json()
    expected_keys = {"response_rate_pct", "average_reply_time_hours",
                     "community_rating", "completed_referrals",
                     "created_at", "city", "state",
                     "specialties", "verification_status"}
    missing = expected_keys - set(d.keys())
    _ok("11.trust-all-keys-present", not missing, f"missing={missing}, got={list(d.keys())}")


def scenario_12_discover(A):
    print("\n=== Scenario 12 — network/discover ===")
    r = _req("GET", "/network/discover", token=A["token"])
    if not _ok("12.discover-200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}"):
        return
    d = r.json()
    expected_rails = ["near_you", "popular_in_city", "pet", "wedding", "family",
                      "new_members", "top_contributors", "verified_pros",
                      "available_for_referrals", "available_for_second_shooter"]
    missing_rails = [r for r in expected_rails if r not in d]
    _ok("12.all-10-rails", not missing_rails, f"missing={missing_rails}")

    # Each rail a list
    rails_are_lists = all(isinstance(d.get(r), list) for r in expected_rails)
    _ok("12.rails-are-lists", rails_are_lists)

    # No email, password_hash, _id anywhere
    leak = {"email": False, "password_hash": False, "_id": False}
    for rail in expected_rails:
        for item in d.get(rail, []):
            for k in leak:
                if k in item:
                    leak[k] = True
    _ok("12.no-email-leak", not leak["email"])
    _ok("12.no-password-leak", not leak["password_hash"])
    _ok("12.no-_id-leak", not leak["_id"])

    # viewer not in own rails
    found_self = False
    for rail in expected_rails:
        for item in d.get(rail, []):
            if item.get("user_id") == A["user_id"]:
                found_self = True
                break
    _ok("12.viewer-not-in-own-rails", not found_self)


def scenario_13_search(A):
    print("\n=== Scenario 13 — network/search filters ===")
    # q
    r = _req("GET", "/network/search?q=photographer&limit=5", token=A["token"])
    _ok("13a.q-200", r.status_code == 200, f"HTTP {r.status_code}")
    if r.status_code == 200:
        items = r.json().get("items", [])
        _ok("13a.no-email", not any("email" in i for i in items))

    # city
    r = _req("GET", "/network/search?city=Austin&limit=5", token=A["token"])
    _ok("13b.city-200", r.status_code == 200, f"HTTP {r.status_code}")

    # verified_only
    r = _req("GET", "/network/search?verified_only=true&limit=5", token=A["token"])
    _ok("13c.verified-200", r.status_code == 200, f"HTTP {r.status_code}")

    # plan=pro
    r = _req("GET", "/network/search?plan=pro&limit=5", token=A["token"])
    _ok("13d.plan-pro-200", r.status_code == 200)

    # available_for_referrals
    r = _req("GET", "/network/search?available_for_referrals=true&limit=5", token=A["token"])
    _ok("13e.avail-refer-200", r.status_code == 200)


def scenario_14_regression(A):
    print("\n=== Scenario 14 — regression (/auth/me, /feed/home, /spots, /posts) ===")
    r = _req("GET", "/auth/me", token=A["token"])
    _ok("14.auth-me", r.status_code == 200, f"HTTP {r.status_code}")
    r = _req("GET", "/feed/home", token=A["token"])
    _ok("14.feed-home", r.status_code == 200, f"HTTP {r.status_code}")
    r = _req("GET", "/spots?limit=3")
    _ok("14.spots-list", r.status_code == 200, f"HTTP {r.status_code}")
    r = _req("GET", "/posts?limit=3", token=A["token"])
    _ok("14.posts-list", r.status_code == 200, f"HTTP {r.status_code}")


# ------------------------------------------------------------------
# Cleanup
# ------------------------------------------------------------------
def cleanup():
    print("\n=== Cleanup (admin DELETE /admin/users/*) ===")
    global admin_token
    if not admin_token:
        admin_token, _ = login(ADMIN_EMAIL, ADMIN_PWD)
    for uid in cleanup_user_ids:
        try:
            r = _req("DELETE", f"/admin/users/{uid}", token=admin_token,
                     json={"reason_code": "other", "reason_note": "QA network-phase-A cleanup"})
            print(f"  delete {uid}: {r.status_code}")
        except Exception as e:
            print(f"  delete {uid}: ERROR {e}")


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
def main():
    try:
        A, B, C = scenario_1_setup()
        tid_AB = scenario_2_start_request(A, B)
        if tid_AB:
            scenario_3_accept_flow(A, B, tid_AB)
        scenario_4_quickstart_null_opening(A, C)
        if tid_AB:
            scenario_5_attachments(A, B, C, tid_AB)
        scenario_6_rate_limits(A)
        if tid_AB:
            scenario_7_markread_unread(A, B, tid_AB)
            scenario_8_mute(A, tid_AB)
        scenario_9_block_report(A, B, C)
        scenario_10_soft_delete(A, B)
        scenario_11_trust(A, B)
        scenario_12_discover(A)
        scenario_13_search(A)
        scenario_14_regression(A)
    except Exception as e:
        print(f"\nFATAL: {e}")
        traceback.print_exc()
    finally:
        cleanup()

    # Summary
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{'='*60}\nRESULT: {passed}/{total} assertions PASS\n{'='*60}")
    fails = [(s, m) for s, ok, m in results if not ok]
    if fails:
        print("\nFAILURES:")
        for s, m in fails:
            print(f"  - {s}: {m}")
        sys.exit(1)


if __name__ == "__main__":
    main()
