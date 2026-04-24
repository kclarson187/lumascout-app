"""
Tier 2 Messaging Upgrade — backend validation harness.
Scope: Archive, Pin (cap=3), Mark-all-read, Archived tab, auto-unarchive
on new inbound message, plus regression smoke on Tier 1 endpoints.

Target: http://localhost:8001/api
Admin : admin@lumascout.app / admin123
Fresh secondary users registered under @lumascout-qa.com (.local rejected).
"""
import json
import random
import string
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

FAIL: List[str] = []
PASS: List[str] = []


def _suffix(n: int = 6) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def check(cond: bool, label: str, details: Any = ""):
    if cond:
        PASS.append(label)
        print(f"  ✅ {label}")
    else:
        FAIL.append(f"{label} :: {details}")
        print(f"  ❌ {label} :: {details}")


def api(method: str, path: str, token: Optional[str] = None,
        json_body: Optional[dict] = None, expect_status: Optional[int] = None,
        label: str = "") -> Tuple[int, Any]:
    url = f"{BASE}{path}"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = requests.request(method, url, headers=headers, json=json_body, timeout=30)
    try:
        body = r.json()
    except Exception:
        body = r.text
    if expect_status is not None:
        check(r.status_code == expect_status,
              f"{label} → {expect_status}",
              f"got {r.status_code} body={str(body)[:400]}")
    return r.status_code, body


def login(email: str, password: str) -> Tuple[str, dict]:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    d = r.json()
    return d["token"], d["user"]


def register_user(tag: str) -> Tuple[str, dict]:
    sfx = _suffix()
    email = f"qa_{tag}_{sfx}@lumascout-qa.com"
    username = f"qa{tag}{sfx}"[:20]
    name = f"QA {tag.capitalize()} {sfx}"
    r = requests.post(
        f"{BASE}/auth/register",
        json={"email": email, "password": "pass12345", "username": username, "name": name},
        timeout=30,
    )
    if r.status_code != 200:
        raise RuntimeError(f"register failed ({r.status_code}): {r.text[:400]}")
    d = r.json()
    return d["token"], d["user"]


def ensure_accepted_thread(admin_token: str, admin_id: str,
                           other_token: str, other_id: str) -> str:
    """
    Register secondary → make secondary follow admin → secondary starts a thread
    (auto-accepted since secondary follows admin). Returns thread_id.
    If request-flow happens instead, admin accepts it.
    """
    # secondary follows admin so thread auto-accepts
    r = requests.post(f"{BASE}/users/{admin_id}/follow",
                      headers={"Authorization": f"Bearer {other_token}"}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"follow failed: {r.status_code} {r.text}")

    # secondary starts thread with admin
    r = requests.post(f"{BASE}/dm/threads/start",
                      headers={"Authorization": f"Bearer {other_token}"},
                      json={"user_id": admin_id}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"start thread failed: {r.status_code} {r.text}")
    d = r.json()
    tid = d["thread_id"]
    # Send 1 message from the secondary to set last_message_at + activate participation
    r = requests.post(f"{BASE}/dm/threads/{tid}/messages",
                      headers={"Authorization": f"Bearer {other_token}"},
                      json={"type": "text", "body": f"hi admin {time.time()}"}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"first message failed: {r.status_code} {r.text}")

    # If it landed as a request, admin accepts it
    if d.get("is_request"):
        # Find the request
        rr = requests.get(f"{BASE}/dm/threads?tab=requests",
                          headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)
        for req in rr.json().get("items", []):
            if req.get("thread_id") == tid:
                rid = req["request_id"]
                requests.post(f"{BASE}/dm/requests/{rid}/accept",
                              headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)
                break
    return tid


def get_accepted_items(token: str) -> List[dict]:
    r = requests.get(f"{BASE}/dm/threads?tab=accepted",
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    return r.json().get("items", [])


def get_archived_items(token: str) -> List[dict]:
    r = requests.get(f"{BASE}/dm/threads?tab=archived",
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    return r.json().get("items", [])


def get_inbox_preview(token: str) -> List[dict]:
    r = requests.get(f"{BASE}/dm/inbox/preview",
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    return r.json().get("items", [])


def get_unread(token: str) -> dict:
    r = requests.get(f"{BASE}/dm/unread-count",
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    return r.json()


# =====================================================================
def main():
    print("=" * 72)
    print("TIER 2 MESSAGING UPGRADE — backend validation")
    print("=" * 72)

    # --- Login admin ---
    print("\n[setup] login admin")
    admin_token, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    admin_id = admin_user["user_id"]
    print(f"  admin_id={admin_id} role={admin_user.get('role')}")

    # --- Register fresh secondary ---
    print("\n[setup] register fresh secondary @lumascout-qa.com")
    sec_token, sec_user = register_user("sec")
    sec_id = sec_user["user_id"]
    print(f"  sec_id={sec_id}")

    # Verify .local is rejected
    r = requests.post(f"{BASE}/auth/register",
                      json={"email": f"rej_{_suffix()}@test.local",
                            "password": "pass12345", "username": f"rej{_suffix()}",
                            "name": "Reject"}, timeout=30)
    check(r.status_code >= 400,
          ".local TLD rejected on register",
          f"status={r.status_code}")

    # --- setup thread A (admin<->secondary) ---
    print("\n[setup] start accepted thread admin<->secondary")
    tid = ensure_accepted_thread(admin_token, admin_id, sec_token, sec_id)
    print(f"  thread_id={tid}")

    # Admin sends a text (last_message_at set / admin is author of most recent)
    r = requests.post(f"{BASE}/dm/threads/{tid}/messages",
                      headers={"Authorization": f"Bearer {admin_token}"},
                      json={"type": "text", "body": "hello from admin (setup)"}, timeout=30)
    check(r.status_code == 200, "admin sends setup text → 200",
          f"status={r.status_code} body={r.text[:200]}")

    # =================================================================
    # (1) ARCHIVE FLOW
    # =================================================================
    print("\n(1) ARCHIVE FLOW")

    sc, body = api("POST", f"/dm/threads/{tid}/archive", admin_token,
                   expect_status=200, label="POST archive")
    check(isinstance(body, dict) and body.get("is_archived") is True,
          "POST archive returns {is_archived:true}", body)

    acc_items = get_accepted_items(admin_token)
    in_acc = any(t.get("thread_id") == tid for t in acc_items)
    check(not in_acc, "thread NOT in tab=accepted after archive",
          f"items_count={len(acc_items)} tid_present={in_acc}")

    arc_items = get_archived_items(admin_token)
    arc_row = next((t for t in arc_items if t.get("thread_id") == tid), None)
    check(arc_row is not None, "thread IS in tab=archived",
          f"items_count={len(arc_items)}")
    if arc_row:
        check(arc_row.get("is_archived") is True,
              "archived row has is_archived:true",
              arc_row.get("is_archived"))

    prev = get_inbox_preview(admin_token)
    in_prev = any(t.get("thread_id") == tid for t in prev)
    check(not in_prev, "thread NOT in /dm/inbox/preview after archive",
          f"preview_count={len(prev)} tid_present={in_prev}")

    # send a message from secondary BEFORE we check unread-count (so there IS
    # unread content in the archived thread) to prove archived threads are
    # excluded from the counter even when they have unread
    r = requests.post(f"{BASE}/dm/threads/{tid}/messages",
                      headers={"Authorization": f"Bearer {sec_token}"},
                      json={"type": "text", "body": "ghost unread for archived test"},
                      timeout=30)
    # NB: this call also triggers auto-unarchive (per spec). We need to
    # re-archive before the unread-count check.
    time.sleep(0.5)
    api("POST", f"/dm/threads/{tid}/archive", admin_token, expect_status=200,
        label="re-archive after secondary ghost message")

    # count unread BEFORE any accepted-tab ones
    uc = get_unread(admin_token)
    # We only assert the archived thread's unread does NOT inflate;
    # it's hard to know exact totals in a shared admin sandbox, but the
    # archived thread should contribute 0. We check by unarchiving and
    # comparing deltas below — here just confirm endpoint shape.
    check(all(k in uc for k in ("unread_messages", "unread_threads",
                                "pending_requests", "total")),
          "unread-count payload shape", uc)

    # Capture "archived excluded" behaviour: unarchive then re-count
    before_unread = uc.copy()
    sc, body = api("DELETE", f"/dm/threads/{tid}/archive", admin_token,
                   expect_status=200, label="DELETE archive")
    check(isinstance(body, dict) and body.get("is_archived") is False,
          "DELETE archive returns {is_archived:false}", body)

    after_unread = get_unread(admin_token)
    # The archived thread had unread messages for admin (ghost from secondary),
    # so after unarchive, unread_messages should go UP (or stay, if 0).
    delta_msgs = after_unread["unread_messages"] - before_unread["unread_messages"]
    delta_threads = after_unread["unread_threads"] - before_unread["unread_threads"]
    check(delta_msgs >= 1 and delta_threads >= 1,
          "archived thread unread was excluded from count (delta>=1 after unarchive)",
          f"before={before_unread} after={after_unread}")

    acc_items = get_accepted_items(admin_token)
    in_acc = any(t.get("thread_id") == tid for t in acc_items)
    check(in_acc, "after DELETE archive, thread returns to tab=accepted",
          f"items_count={len(acc_items)}")

    # =================================================================
    # (2) AUTO-UNARCHIVE ON NEW INBOUND MESSAGE
    # =================================================================
    print("\n(2) AUTO-UNARCHIVE ON NEW INBOUND")

    api("POST", f"/dm/threads/{tid}/archive", admin_token, expect_status=200,
        label="re-archive for auto-unarchive test")

    # secondary sends a message
    r = requests.post(f"{BASE}/dm/threads/{tid}/messages",
                      headers={"Authorization": f"Bearer {sec_token}"},
                      json={"type": "text", "body": "back online"}, timeout=30)
    check(r.status_code == 200, "secondary POST text message → 200",
          f"status={r.status_code} body={r.text[:200]}")

    time.sleep(0.3)

    acc_items = get_accepted_items(admin_token)
    acc_row = next((t for t in acc_items if t.get("thread_id") == tid), None)
    check(acc_row is not None,
          "thread BACK in admin tab=accepted after inbound",
          f"items_count={len(acc_items)}")
    if acc_row:
        check(acc_row.get("is_archived") is False,
              "re-appeared thread has is_archived:false",
              acc_row.get("is_archived"))

    # =================================================================
    # (3) PIN FLOW (cap=3)
    # =================================================================
    print("\n(3) PIN FLOW (cap=3)")

    # Need at least 4 distinct accepted threads for admin. We already have
    # tid (#1). Create 3 more with fresh secondary users.
    extra_sec: List[Tuple[str, str]] = []  # (token, user_id)
    extra_tids: List[str] = [tid]
    for i in range(3):
        t, u = register_user(f"p{i}")
        extra_sec.append((t, u["user_id"]))
        new_tid = ensure_accepted_thread(admin_token, admin_id, t, u["user_id"])
        extra_tids.append(new_tid)

    print(f"  admin thread ids (T1..T4): {extra_tids}")
    T1, T2, T3, T4 = extra_tids[0], extra_tids[1], extra_tids[2], extra_tids[3]

    # Defensive unpin in case of residue
    for t in extra_tids:
        requests.delete(f"{BASE}/dm/threads/{t}/pin",
                        headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)

    sc1, b1 = api("POST", f"/dm/threads/{T1}/pin", admin_token,
                  expect_status=200, label="pin T1")
    check(b1.get("is_pinned") is True and b1.get("cap") == 3,
          "pin T1 → {is_pinned:true, cap:3}", b1)

    sc2, b2 = api("POST", f"/dm/threads/{T2}/pin", admin_token,
                  expect_status=200, label="pin T2")
    sc3, b3 = api("POST", f"/dm/threads/{T3}/pin", admin_token,
                  expect_status=200, label="pin T3")
    check(b2.get("is_pinned") is True and b3.get("is_pinned") is True,
          "T2, T3 pinned ok", (b2, b3))

    sc4, b4 = api("POST", f"/dm/threads/{T4}/pin", admin_token,
                  expect_status=409, label="pin T4 → 409")
    det = (b4.get("detail") if isinstance(b4, dict) else "") or ""
    check("pin up to 3" in det.lower() or "pin up to" in det.lower(),
          "T4 pin detail contains 'pin up to 3'", det)

    # Order check
    acc_items = get_accepted_items(admin_token)
    acc_ids = [t.get("thread_id") for t in acc_items]
    pinned_positions = [acc_ids.index(x) for x in (T1, T2, T3) if x in acc_ids]
    first_non_pinned = next((i for i, t in enumerate(acc_items)
                             if not t.get("is_pinned")), None)
    all_pinned_before_rest = (
        all(t.get("thread_id") in (T1, T2, T3)
            for t in acc_items if t.get("is_pinned"))
        and (first_non_pinned is None or
             max(pinned_positions or [-1]) < first_non_pinned)
    )
    check(all_pinned_before_rest,
          "T1/T2/T3 appear BEFORE non-pinned in tab=accepted",
          {"first_non_pinned_idx": first_non_pinned,
           "pinned_positions": pinned_positions,
           "top5_ids": acc_ids[:5]})

    # Pinned ordered by pinned_at DESC (most recent first)
    pinned_rows = [t for t in acc_items if t.get("is_pinned")]
    pinned_ats = [t.get("pinned_at") for t in pinned_rows]
    # Should be monotonically non-increasing (None treated as smallest)
    mono = all(
        (pinned_ats[i] or "") >= (pinned_ats[i + 1] or "")
        for i in range(len(pinned_ats) - 1)
    )
    check(mono, "pinned bucket sorted by pinned_at DESC",
          pinned_ats)

    # Idempotent repeat pin
    sc, body = api("POST", f"/dm/threads/{T1}/pin", admin_token,
                   expect_status=200, label="repeat pin T1 idempotent")
    check(body.get("is_pinned") is True,
          "repeat pin T1 → 200 (not 409)", body)

    # Unpin T1
    sc, body = api("DELETE", f"/dm/threads/{T1}/pin", admin_token,
                   expect_status=200, label="unpin T1")
    check(body.get("is_pinned") is False,
          "unpin T1 returns {is_pinned:false}", body)

    # Now pin T4 succeeds
    sc, body = api("POST", f"/dm/threads/{T4}/pin", admin_token,
                   expect_status=200, label="pin T4 after unpin")
    check(body.get("is_pinned") is True,
          "4th pin succeeds after slot freed", body)

    # Verify is_pinned / pinned_at present on thread rows
    acc_items = get_accepted_items(admin_token)
    sample_rows = [t for t in acc_items if t.get("thread_id") in extra_tids]
    all_have_keys = all(("is_pinned" in r and "pinned_at" in r
                          and "is_archived" in r) for r in sample_rows)
    check(all_have_keys,
          "thread rows carry is_pinned / pinned_at / is_archived keys",
          [list(r.keys())[:10] for r in sample_rows[:1]])

    # Cleanup pins
    for t in (T2, T3, T4):
        requests.delete(f"{BASE}/dm/threads/{t}/pin",
                        headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)

    # =================================================================
    # (4) MARK-ALL-READ
    # =================================================================
    print("\n(4) MARK-ALL-READ")

    # Accumulate 2+ unread inbound messages for admin.
    # Use the 4 secondary accounts' threads — each secondary sends a fresh msg.
    for (stok, suid), tt in zip([(sec_token, sec_id)] + extra_sec, extra_tids):
        r = requests.post(f"{BASE}/dm/threads/{tt}/messages",
                          headers={"Authorization": f"Bearer {stok}"},
                          json={"type": "text", "body": f"unread probe {time.time()}"},
                          timeout=30)
    time.sleep(0.5)

    # Also archive ONE thread that has unread to prove it's excluded
    arc_for_mar = extra_tids[1]   # T2
    api("POST", f"/dm/threads/{arc_for_mar}/archive", admin_token,
        expect_status=200, label="archive T2 for mark-all-read exclusion")
    # add unread from secondary on the archived thread
    stok_t2 = extra_sec[0][0]
    requests.post(f"{BASE}/dm/threads/{arc_for_mar}/messages",
                  headers={"Authorization": f"Bearer {stok_t2}"},
                  json={"type": "text", "body": "unread while archived"}, timeout=30)
    # The above message auto-unarchives! We must re-archive AFTER sending.
    time.sleep(0.3)
    api("POST", f"/dm/threads/{arc_for_mar}/archive", admin_token,
        expect_status=200, label="re-archive T2 after ghost msg")

    uc = get_unread(admin_token)
    check(uc["total"] >= 2 and uc["unread_messages"] >= 2,
          "pre mark-all-read: total>=2 and unread_messages>=2", uc)

    # Count archived unread messages separately (should be excluded)
    # (We'll verify by ensuring messages_updated < total_unread_across_all_threads_including_archived)
    sc, body = api("POST", "/dm/threads/mark-all-read", admin_token,
                   expect_status=200, label="POST mark-all-read")
    check(isinstance(body, dict) and body.get("ok") is True,
          "mark-all-read ok:true", body)
    check(body.get("threads_updated", 0) >= 2,
          "mark-all-read threads_updated >= 2",
          body.get("threads_updated"))
    check(body.get("messages_updated", 0) >= 2,
          "mark-all-read messages_updated >= 2",
          body.get("messages_updated"))

    uc_after = get_unread(admin_token)
    check(uc_after["unread_messages"] == 0,
          "post mark-all-read: unread_messages == 0", uc_after)

    # Verify archived thread unread NOT counted in messages_updated:
    # unarchive it and check it still has unread
    api("DELETE", f"/dm/threads/{arc_for_mar}/archive", admin_token,
        expect_status=200, label="unarchive T2 to reveal residue unread")
    uc_after_unar = get_unread(admin_token)
    check(uc_after_unar["unread_messages"] >= 1,
          "archived thread unread was SKIPPED by mark-all-read "
          "(revealed as unread after unarchive)",
          uc_after_unar)

    # Clean up: mark read again
    api("POST", "/dm/threads/mark-all-read", admin_token,
        expect_status=200, label="cleanup mark-all-read")

    # =================================================================
    # (5) REGRESSION SMOKE
    # =================================================================
    print("\n(5) REGRESSION SMOKE")

    r = requests.get(f"{BASE}/dm/threads?tab=accepted",
                     headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)
    check(r.status_code == 200, "tab=accepted → 200", r.status_code)
    items = r.json().get("items", [])
    if items:
        keys_ok = all(("is_archived" in it and "is_pinned" in it and "pinned_at" in it)
                      for it in items)
        check(keys_ok,
              "accepted items carry is_archived / is_pinned / pinned_at",
              list(items[0].keys())[:12])

    r = requests.get(f"{BASE}/dm/threads?tab=requests",
                     headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)
    check(r.status_code == 200, "tab=requests → 200", r.status_code)

    # Mute toggle (twice = state restored)
    sc1, b1 = api("POST", f"/dm/threads/{tid}/mute", admin_token,
                  expect_status=200, label="mute toggle #1")
    sc2, b2 = api("POST", f"/dm/threads/{tid}/mute", admin_token,
                  expect_status=200, label="mute toggle #2")
    check(b1.get("is_muted") != b2.get("is_muted"),
          "mute toggle flipped", (b1, b2))

    # Soft-hide DELETE
    sc, body = api("DELETE", f"/dm/threads/{tid}", admin_token,
                   expect_status=200, label="DELETE /dm/threads/{tid} soft-hide")
    check(isinstance(body, dict) and body.get("ok") is True,
          "soft-hide returns ok:true", body)

    # mark-read on remaining thread (T3)
    sc, body = api("POST", f"/dm/threads/{T3}/mark-read", admin_token,
                   expect_status=200, label="POST mark-read")
    check(isinstance(body, dict) and body.get("ok") is True,
          "mark-read ok:true", body)

    # =================================================================
    print("\n" + "=" * 72)
    print(f"SUMMARY — PASS: {len(PASS)}  FAIL: {len(FAIL)}")
    print("=" * 72)
    if FAIL:
        print("\nFAILURES:")
        for f in FAIL:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("ALL GREEN")


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        print(f"HTTP error: {e} — body: {e.response.text if e.response else ''}")
        sys.exit(2)
