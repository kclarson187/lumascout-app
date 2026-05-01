"""Batch #9A — Backend DM read-receipts tier gating regression test.

Tests the dm_get_thread (GET /api/dm/threads/{thread_id}) endpoint to verify
that read-receipt information is gated by the viewer's subscription tier.

Run:  python /app/backend_test.py
"""
from __future__ import annotations

import os
import sys
import time
import uuid
import json
import asyncio
from typing import Any, Dict, List, Optional, Tuple

import requests
from motor.motor_asyncio import AsyncIOMotorClient

# ---- Config ----
BACKEND_URL = os.environ.get(
    "BACKEND_URL",
    "https://photo-finder-60.preview.emergentagent.com",
).rstrip("/")
API = f"{BACKEND_URL}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "photoscout_database")

# ---- helpers ----
PASSED: List[str] = []
FAILED: List[str] = []


def check(cond: bool, label: str, detail: str = "") -> bool:
    if cond:
        PASSED.append(label)
        print(f"  ✅ {label}")
    else:
        FAILED.append(f"{label} :: {detail}")
        print(f"  ❌ {label}  {detail}")
    return cond


def section(title: str) -> None:
    print(f"\n{'='*72}\n{title}\n{'='*72}")


def login(email: str, password: str) -> Tuple[str, dict]:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    r.raise_for_status()
    body = r.json()
    return body["token"], body["user"]


def register_free_user(email: str, password: str, name: str) -> Tuple[str, dict]:
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": name},
        timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"register failed: {r.status_code} {r.text}")
    body = r.json()
    return body["token"], body["user"]


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---- main test ----
def main() -> int:
    print(f"Backend: {API}")

    # ============================================================
    # SECTION 1: Setup the two accounts
    # ============================================================
    section("SECTION 1 — Setup admin (Elite) + fresh free user")
    admin_token, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    check(admin_user.get("plan") == "elite", "admin is on elite plan",
          f"plan={admin_user.get('plan')}")
    admin_uid = admin_user["user_id"]

    sfx = uuid.uuid4().hex[:8]
    free_email = f"batch9a_sender_{sfx}@lumascout-qa.com"
    free_password = "Test@FreeUser2026!"
    free_token, free_user = register_free_user(
        free_email, free_password, f"Batch 9A Sender {sfx}"
    )
    free_uid = free_user["user_id"]
    check(free_user.get("plan") == "free", "free user is on free plan",
          f"plan={free_user.get('plan')}")
    print(f"  admin_uid={admin_uid}  free_uid={free_uid}")

    # ============================================================
    # SECTION 2: Free user opens a DM thread to admin
    # ============================================================
    section("SECTION 2 — Free user starts DM thread to admin")
    r = requests.post(
        f"{API}/dm/threads/start",
        json={"user_id": admin_uid, "opening_body": "Hello from batch 9A tests"},
        headers=auth_headers(free_token),
        timeout=15,
    )
    check(r.status_code == 200, "POST /dm/threads/start (free → admin) → 200",
          f"status={r.status_code} body={r.text[:200]}")
    body = r.json() if r.status_code == 200 else {}
    thread_id = body.get("thread_id")
    check(bool(thread_id), "thread_id returned",
          f"body keys={list(body.keys())}")
    print(f"  thread_id={thread_id}  is_request={body.get('is_request')}")

    # ============================================================
    # SECTION 3: Send 2 more messages from the free user
    # ============================================================
    section("SECTION 3 — Free user sends 2 more messages")
    sent_ids: List[str] = []
    for i in range(2):
        r = requests.post(
            f"{API}/dm/threads/{thread_id}/messages",
            json={"type": "text", "body": f"Message {i+2} from free user"},
            headers=auth_headers(free_token),
            timeout=15,
        )
        ok = r.status_code == 200
        check(ok, f"POST /dm/threads/{{tid}}/messages [#{i+2}] → 200",
              f"status={r.status_code} body={r.text[:200]}")
        if ok:
            sent_ids.append(r.json().get("message_id", ""))

    # ============================================================
    # SECTION 4: Admin opens thread + mark-read
    # ============================================================
    section("SECTION 4 — Admin (Elite) opens thread + mark-read")

    # If is_request, admin must also be able to GET the thread.
    # The endpoint allows participant access regardless of accepted state.
    r = requests.get(
        f"{API}/dm/threads/{thread_id}",
        headers=auth_headers(admin_token),
        timeout=15,
    )
    check(r.status_code == 200, "GET /dm/threads/{id} as admin → 200",
          f"status={r.status_code} body={r.text[:200]}")
    a_thread = r.json() if r.status_code == 200 else {}
    msgs = a_thread.get("messages", [])
    check(len(msgs) >= 3,
          f"admin sees ≥3 messages (got {len(msgs)})",
          f"messages_len={len(msgs)}")
    # Response keys present
    for k in ("thread", "other", "other_last_read_at", "messages"):
        check(k in a_thread, f"response has key '{k}'",
              f"keys={list(a_thread.keys())}")

    # Admin marks read → should stamp seen_at on free user's 3 messages
    r = requests.post(
        f"{API}/dm/threads/{thread_id}/mark-read",
        headers=auth_headers(admin_token),
        timeout=15,
    )
    check(r.status_code == 200, "POST /dm/threads/{id}/mark-read (admin) → 200",
          f"status={r.status_code} body={r.text[:200]}")
    check((r.json() if r.status_code == 200 else {}).get("ok") is True,
          "mark-read returns {ok:true}",
          f"body={r.text[:200]}")

    # Accept the request so the thread appears in admin's "accepted" tab
    # (needed for SECTION 8 smoke test).
    r = requests.get(
        f"{API}/dm/threads?tab=requests",
        headers=auth_headers(admin_token),
        timeout=15,
    )
    if r.status_code == 200:
        items = r.json().get("items", [])
        # Find the request_id matching this thread
        req_id = None
        for it in items:
            if it.get("thread_id") == thread_id and it.get("request_id"):
                req_id = it.get("request_id")
                break
        if not req_id:
            # Fallback: look up dm_requests via Mongo later. Use admin reply
            # to implicitly accept? No — we have to call accept endpoint.
            pass
        if req_id:
            r2 = requests.post(
                f"{API}/dm/requests/{req_id}/accept",
                headers=auth_headers(admin_token),
                timeout=15,
            )
            print(f"  accepted request {req_id}: {r2.status_code}")

    # ============================================================
    # SECTION 5: Elite viewer fetch — confirm receipt fields populated
    # ============================================================
    section("SECTION 5 — Elite viewer (admin) sees receipts")

    # Admin replies with 1 message → admin now has an outbound msg
    r = requests.post(
        f"{API}/dm/threads/{thread_id}/messages",
        json={"type": "text", "body": "Reply from admin (Elite)"},
        headers=auth_headers(admin_token),
        timeout=15,
    )
    check(r.status_code == 200, "admin sends 1 outbound reply → 200",
          f"status={r.status_code} body={r.text[:200]}")
    admin_msg_id = r.json().get("message_id") if r.status_code == 200 else None

    # Free user opens thread + mark-read → stamps seen_at on admin's reply
    r = requests.get(
        f"{API}/dm/threads/{thread_id}",
        headers=auth_headers(free_token),
        timeout=15,
    )
    check(r.status_code == 200, "free user GET thread → 200",
          f"status={r.status_code} body={r.text[:200]}")
    r = requests.post(
        f"{API}/dm/threads/{thread_id}/mark-read",
        headers=auth_headers(free_token),
        timeout=15,
    )
    check(r.status_code == 200, "free user mark-read → 200",
          f"status={r.status_code} body={r.text[:200]}")

    # Admin re-fetches → admin's outbound message should have seen_at
    r = requests.get(
        f"{API}/dm/threads/{thread_id}",
        headers=auth_headers(admin_token),
        timeout=15,
    )
    check(r.status_code == 200, "admin GET thread (post-free-read) → 200")
    a_body = r.json() if r.status_code == 200 else {}
    a_msgs = a_body.get("messages", [])
    # Find admin's outbound reply
    admin_outbound = [m for m in a_msgs if m.get("sender_user_id") == admin_uid]
    check(len(admin_outbound) >= 1, "admin has ≥1 outbound message",
          f"count={len(admin_outbound)}")
    if admin_outbound:
        # Elite viewer: seen_at should be populated (ISO string) on at
        # least the latest outbound message
        latest_outbound = admin_outbound[-1]
        seen_at = latest_outbound.get("seen_at")
        check(seen_at is not None,
              "Elite viewer: seen_at on own outbound msg is NOT null",
              f"seen_at={seen_at!r}")
        check(isinstance(seen_at, str) and len(seen_at) > 5,
              "Elite viewer: seen_at is a non-empty string (ISO-like)",
              f"seen_at={seen_at!r}")

    # Verify other_last_read_at field is present (and not None now that
    # free user has marked-read).
    olra = a_body.get("other_last_read_at")
    check("other_last_read_at" in a_body,
          "Elite viewer response includes 'other_last_read_at' key")
    check(olra is not None,
          "Elite viewer: other_last_read_at populated after free user mark-read",
          f"value={olra!r}")

    # ============================================================
    # SECTION 6: Free viewer fetch — gating must redact
    # ============================================================
    section("SECTION 6 — Free viewer: outbound seen_at and other_last_read_at redacted")

    r = requests.get(
        f"{API}/dm/threads/{thread_id}",
        headers=auth_headers(free_token),
        timeout=15,
    )
    check(r.status_code == 200, "free user GET thread → 200")
    f_body = r.json() if r.status_code == 200 else {}
    f_msgs = f_body.get("messages", [])

    # Response keys
    for k in ("thread", "other", "other_last_read_at", "messages"):
        check(k in f_body, f"free-viewer response has key '{k}'",
              f"keys={list(f_body.keys())}")

    # other_last_read_at must be NULL for free viewer
    check(f_body.get("other_last_read_at") is None,
          "Free viewer: other_last_read_at is null",
          f"value={f_body.get('other_last_read_at')!r}")

    # Every outbound msg by the free viewer must have seen_at == null
    free_outbound = [m for m in f_msgs if m.get("sender_user_id") == free_uid]
    check(len(free_outbound) >= 3,
          f"free viewer has ≥3 outbound messages in response (got {len(free_outbound)})")
    all_null = all(m.get("seen_at") is None for m in free_outbound)
    check(all_null,
          "Free viewer: ALL own outbound messages have seen_at == null",
          f"non-null count={sum(1 for m in free_outbound if m.get('seen_at') is not None)}")

    # Inbound msgs (from admin) — seen_at should be left as stored.
    # We can't directly verify the stored value via API as free, but we
    # can verify the field is preserved as-is (not forced to null by the
    # gate). Cross-check via DB later.
    free_inbound = [m for m in f_msgs if m.get("sender_user_id") == admin_uid]
    print(f"  free viewer inbound msg count: {len(free_inbound)}")
    print(f"  free viewer inbound seen_at values: "
          f"{[m.get('seen_at') for m in free_inbound]}")

    # ============================================================
    # SECTION 7: Verify mark-read still stamps seen_at at DB level
    # ============================================================
    section("SECTION 7 — DB-level: mark-read still authoritative regardless of viewer plan")

    async def _check_db() -> Dict[str, Any]:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        # All messages in this thread
        msgs_db = await db.dm_messages.find(
            {"thread_id": thread_id, "is_deleted": {"$ne": True}},
            {"_id": 0, "message_id": 1, "sender_user_id": 1, "seen_at": 1, "body": 1, "created_at": 1},
        ).sort("created_at", 1).to_list(200)
        # Free user's participant row (admin's authoritative last_read_at
        # for the OTHER side, but more importantly: admin's participant
        # row should have last_read_at populated.)
        admin_part = await db.dm_participants.find_one(
            {"thread_id": thread_id, "user_id": admin_uid}, {"_id": 0}
        )
        free_part = await db.dm_participants.find_one(
            {"thread_id": thread_id, "user_id": free_uid}, {"_id": 0}
        )
        client.close()
        return {
            "msgs": msgs_db,
            "admin_part": admin_part,
            "free_part": free_part,
        }

    db_state = asyncio.get_event_loop().run_until_complete(_check_db())
    # Free user's outbound messages (sender_user_id == free_uid) — at the
    # DB level these should have seen_at stamped (because admin opened
    # and called mark-read).
    db_free_outbound = [m for m in db_state["msgs"] if m.get("sender_user_id") == free_uid]
    db_free_outbound_seen = [m for m in db_free_outbound if m.get("seen_at") is not None]
    check(len(db_free_outbound) >= 3,
          f"DB has ≥3 free-user outbound messages (got {len(db_free_outbound)})")
    check(len(db_free_outbound_seen) == len(db_free_outbound),
          "DB: ALL free-user outbound messages have seen_at stamped (recipient-side authoritative)",
          f"stamped {len(db_free_outbound_seen)}/{len(db_free_outbound)}")

    # Admin's outbound (the reply) should also be stamped (because free
    # user opened + marked-read).
    db_admin_outbound = [m for m in db_state["msgs"] if m.get("sender_user_id") == admin_uid]
    db_admin_outbound_seen = [m for m in db_admin_outbound if m.get("seen_at") is not None]
    check(len(db_admin_outbound) >= 1, "DB has ≥1 admin outbound msg")
    check(len(db_admin_outbound_seen) == len(db_admin_outbound),
          "DB: admin outbound also stamped seen_at (free user's mark-read still works)",
          f"stamped {len(db_admin_outbound_seen)}/{len(db_admin_outbound)}")

    # Sanity: admin's own participant row has last_read_at stamped
    check((db_state["admin_part"] or {}).get("last_read_at") is not None,
          "DB: admin's dm_participants.last_read_at is set")
    check((db_state["free_part"] or {}).get("last_read_at") is not None,
          "DB: free user's dm_participants.last_read_at is set")

    # ============================================================
    # SECTION 8: Regression smoke on unrelated DM endpoints
    # ============================================================
    section("SECTION 8 — Regression smoke: list / unread-count / mark-read")

    r = requests.get(
        f"{API}/dm/threads?tab=accepted",
        headers=auth_headers(admin_token),
        timeout=15,
    )
    check(r.status_code == 200, "GET /dm/threads?tab=accepted (admin) → 200",
          f"status={r.status_code} body={r.text[:200]}")
    items = r.json().get("items", []) if r.status_code == 200 else []
    found = any(it.get("thread_id") == thread_id for it in items)
    check(found, "test thread appears in admin's accepted tab",
          f"thread_id={thread_id}; items_count={len(items)}; "
          f"first_3_ids={[it.get('thread_id') for it in items[:3]]}")

    r = requests.get(
        f"{API}/dm/unread-count",
        headers=auth_headers(admin_token),
        timeout=15,
    )
    check(r.status_code == 200, "GET /dm/unread-count → 200",
          f"status={r.status_code} body={r.text[:200]}")

    r = requests.post(
        f"{API}/dm/threads/{thread_id}/mark-read",
        headers=auth_headers(admin_token),
        timeout=15,
    )
    check(r.status_code == 200, "POST /dm/threads/{id}/mark-read (admin) → 200")
    check((r.json() if r.status_code == 200 else {}).get("ok") is True,
          "mark-read returns {ok:true}",
          f"body={r.text[:200]}")

    # ---- Final summary ----
    section("SUMMARY")
    total = len(PASSED) + len(FAILED)
    print(f"\nPASSED: {len(PASSED)} / {total}")
    print(f"FAILED: {len(FAILED)} / {total}")
    if FAILED:
        print("\nFailures:")
        for f in FAILED:
            print(f"  • {f}")
        return 1
    print("\nAll Batch #9A backend assertions green.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
