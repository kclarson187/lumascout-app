"""
Tier 1 Messaging Upgrade — backend validation harness.

Tests:
  (1) Read-receipt pipeline (delivered_at / seen_at)
  (2) GET /api/dm/unread-count
  (3) GET /api/dm/inbox/preview
  (4) Hide-for-me regression (DELETE /api/dm/threads/{tid})
  (5) Regression smoke (threads list, mute, block, report)

Target: http://localhost:8001/api
Admin: admin@lumascout.app / admin123
"""

import sys
import uuid
import json
import asyncio
from datetime import datetime

import httpx

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

RESULTS: list[tuple[str, bool, str]] = []


def rec(name: str, ok: bool, detail: str = ""):
    RESULTS.append((name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}{('  — ' + detail) if detail else ''}")


async def login(client: httpx.AsyncClient, email: str, password: str):
    r = await client.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    data = r.json()
    return data["token"], data["user"]


async def register(client: httpx.AsyncClient):
    suffix = uuid.uuid4().hex[:8]
    email = f"qa_{suffix}@lumascout-qa.com"
    password = "pass12345"
    username = f"qa_{suffix}"
    name = f"QA Tester {suffix[:4].upper()}"
    r = await client.post(
        f"{BASE}/auth/register",
        json={"email": email, "password": password, "username": username, "name": name},
    )
    if r.status_code != 200:
        raise RuntimeError(f"register failed {r.status_code} {r.text}")
    data = r.json()
    data["user"]["_email"] = email
    data["user"]["_password"] = password
    return data["token"], data["user"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def main():
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            admin_token, admin_user = await login(client, ADMIN_EMAIL, ADMIN_PASSWORD)
        except Exception as e:
            rec("admin login", False, f"{e}")
            return 1
        rec("admin login", True, f"user_id={admin_user.get('user_id')}")

        try:
            sec_token, sec_user = await register(client)
        except Exception as e:
            rec("secondary user register", False, f"{e}")
            return 1
        rec("secondary user register", True,
            f"user_id={sec_user.get('user_id')} email={sec_user.get('_email')}")

        admin_id = admin_user["user_id"]
        sec_id = sec_user["user_id"]

        # Secondary follows admin so admin->sec thread auto-accepts
        r = await client.post(f"{BASE}/users/{admin_id}/follow", headers=auth(sec_token))
        rec("secondary follows admin (for auto-accept)",
            r.status_code == 200, f"status={r.status_code}")

        # Admin starts thread
        r = await client.post(f"{BASE}/dm/threads/start",
                              headers=auth(admin_token),
                              json={"user_id": sec_id})
        if r.status_code != 200:
            rec("POST /dm/threads/start", False, f"status={r.status_code} body={r.text[:300]}")
            return 1
        data = r.json()
        tid = data["thread_id"]
        is_request = data.get("is_request")
        rec("POST /dm/threads/start (admin → secondary)", True,
            f"thread_id={tid} is_request={is_request}")

        if is_request:
            rq = await client.get(f"{BASE}/dm/threads?tab=requests", headers=auth(sec_token))
            if rq.status_code == 200:
                for it in rq.json().get("items", []):
                    if it.get("thread_id") == tid and it.get("request_id"):
                        await client.post(
                            f"{BASE}/dm/requests/{it['request_id']}/accept",
                            headers=auth(sec_token),
                        )
                        break

        # ============== (1) Read-receipt pipeline ==============
        r = await client.post(f"{BASE}/dm/threads/{tid}/messages",
                              headers=auth(admin_token),
                              json={"type": "text", "body": "tier1 receipt test"})
        ok = r.status_code == 200
        sent = r.json() if ok else {}
        rec("(1a) admin POST /dm/threads/{tid}/messages", ok,
            f"status={r.status_code} msg_id={sent.get('message_id') or sent.get('id')}")

        r = await client.get(f"{BASE}/dm/threads/{tid}", headers=auth(admin_token))
        msgs = r.json().get("messages", []) if r.status_code == 200 else []
        target = None
        for m in msgs:
            if m.get("body") == "tier1 receipt test":
                target = m
        delivered = target.get("delivered_at") if target else None
        seen_pre = target.get("seen_at") if target else "MISSING"
        rec("(1b) admin GET thread → delivered_at != null AND seen_at == null",
            target is not None and delivered is not None and seen_pre is None,
            f"delivered_at={delivered} seen_at={seen_pre}")

        r = await client.get(f"{BASE}/dm/threads/{tid}", headers=auth(sec_token))
        sec_sees = any(m.get("body") == "tier1 receipt test"
                       for m in (r.json().get("messages", []) if r.status_code == 200 else []))
        rec("(1c) secondary GET thread sees admin message",
            sec_sees, f"status={r.status_code}")

        r = await client.post(f"{BASE}/dm/threads/{tid}/mark-read", headers=auth(sec_token))
        ok_mark = r.status_code == 200 and r.json().get("ok") is True
        rec("(1d) secondary POST /mark-read → 200 {ok:true}", ok_mark,
            f"status={r.status_code} body={r.text[:120]}")

        r = await client.get(f"{BASE}/dm/threads/{tid}", headers=auth(admin_token))
        seen_post = None
        if r.status_code == 200:
            for m in r.json().get("messages", []):
                if m.get("body") == "tier1 receipt test":
                    seen_post = m.get("seen_at")
        rec("(1e) admin GET thread → seen_at set after mark-read",
            seen_post is not None, f"seen_at={seen_post}")

        # ============== (2) /dm/unread-count ==============
        r = await client.post(f"{BASE}/dm/threads/{tid}/messages",
                              headers=auth(admin_token),
                              json={"type": "text", "body": "tier1 second message"})
        rec("(2a) admin sends second message", r.status_code == 200, f"status={r.status_code}")

        r = await client.get(f"{BASE}/dm/unread-count", headers=auth(sec_token))
        uc = r.json() if r.status_code == 200 else {}
        cond = (r.status_code == 200
                and uc.get("total", 0) >= 1
                and uc.get("unread_messages", 0) >= 1
                and uc.get("unread_threads", 0) >= 1)
        rec("(2b) secondary unread-count (pre mark-read) has unread>=1", cond, json.dumps(uc))

        r = await client.post(f"{BASE}/dm/threads/{tid}/mark-read", headers=auth(sec_token))
        rec("(2c) secondary mark-read before recount", r.status_code == 200, f"status={r.status_code}")

        r = await client.get(f"{BASE}/dm/unread-count", headers=auth(sec_token))
        uc2 = r.json() if r.status_code == 200 else {}
        rec("(2d) secondary unread-count (post mark-read) unread_messages == 0",
            r.status_code == 200 and uc2.get("unread_messages", -1) == 0, json.dumps(uc2))

        r = await client.get(f"{BASE}/dm/unread-count", headers=auth(admin_token))
        admin_uc = r.json() if r.status_code == 200 else {}
        rec("(2e) admin unread-count returns 200", r.status_code == 200,
            f"unread_messages={admin_uc.get('unread_messages')} (>=0 ok)")

        # ============== (3) /dm/inbox/preview ==============
        r = await client.get(f"{BASE}/dm/inbox/preview?limit=3", headers=auth(admin_token))
        body = r.json() if r.status_code == 200 else {}
        items = body.get("items", []) if isinstance(body, dict) else []
        rec("(3a) admin /dm/inbox/preview?limit=3 returns {items:[..<=3]}",
            r.status_code == 200 and isinstance(items, list) and len(items) <= 3,
            f"count={len(items)}")

        required_item = {"thread_id", "other", "last_message_preview",
                         "last_message_at", "unread_count"}
        required_other = {"user_id", "name", "username", "avatar_url",
                          "plan", "verification_status"}
        per_item_ok = True
        missing = []
        for it in items:
            miss_i = required_item - set(it.keys())
            if miss_i:
                per_item_ok = False
                missing.append(("item", miss_i))
                break
            other = it.get("other")
            if not isinstance(other, dict):
                per_item_ok = False
                missing.append(("other_not_dict", it.get("thread_id")))
                break
            miss_o = required_other - set(other.keys())
            if miss_o:
                per_item_ok = False
                missing.append(("other", miss_o))
                break
        rec("(3b) each item has required keys incl. full `other` profile",
            per_item_ok,
            f"sample_keys={list(items[0].keys()) if items else []} missing={missing}")

        def _pdt(s):
            if not s:
                return None
            try:
                return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
            except Exception:
                return None

        sort_ok = True
        prev = None
        for it in items:
            dt = _pdt(it.get("last_message_at"))
            if prev is not None and dt is not None and dt > prev:
                sort_ok = False
                break
            if dt is not None:
                prev = dt
        rec("(3c) items sorted by last_message_at DESC", sort_ok, "")

        heavy_keys = {"messages", "body", "content_base64", "image_base64",
                      "images", "attachments"}
        heavy_found = []
        for it in items:
            for k, v in it.items():
                if k in heavy_keys:
                    heavy_found.append(k)
                if isinstance(v, str) and (v.startswith("data:") or len(v) > 4000):
                    heavy_found.append(f"{k}(oversized)")
        rec("(3d) payload is lightweight (no message arrays / no base64 bulk)",
            len(heavy_found) == 0, f"heavy_fields={heavy_found}")

        rec("(3e) admin preview contains the test thread",
            any(it.get("thread_id") == tid for it in items), f"tid={tid}")

        # ============== (4) Hide-for-me ==============
        r = await client.delete(f"{BASE}/dm/threads/{tid}", headers=auth(admin_token))
        rec("(4a) admin DELETE /dm/threads/{tid}",
            r.status_code == 200, f"status={r.status_code}")

        r = await client.get(f"{BASE}/dm/unread-count", headers=auth(admin_token))
        admin_uc_after = r.json() if r.status_code == 200 else {}
        rec("(4b) admin /dm/unread-count after hide → 200",
            r.status_code == 200, json.dumps(admin_uc_after))

        r = await client.get(f"{BASE}/dm/inbox/preview?limit=10", headers=auth(admin_token))
        items_after = (r.json().get("items", []) if r.status_code == 200 else [])
        still = any(it.get("thread_id") == tid for it in items_after)
        rec("(4c) admin inbox/preview EXCLUDES hidden thread",
            r.status_code == 200 and not still, f"still_present={still}")

        r = await client.get(f"{BASE}/dm/threads?tab=accepted", headers=auth(sec_token))
        sec_items = r.json().get("items", []) if r.status_code == 200 else []
        sec_has = any(it.get("thread_id") == tid for it in sec_items)
        rec("(4d) secondary /dm/threads?tab=accepted still has thread",
            r.status_code == 200 and sec_has,
            f"count={len(sec_items)} has_tid={sec_has}")

        r = await client.get(f"{BASE}/dm/inbox/preview?limit=10", headers=auth(sec_token))
        sec_pv = r.json().get("items", []) if r.status_code == 200 else []
        rec("(4e) secondary /dm/inbox/preview still has thread",
            r.status_code == 200 and any(it.get("thread_id") == tid for it in sec_pv),
            f"preview_count={len(sec_pv)}")

        # ============== (5) Regression smoke ==============
        r = await client.get(f"{BASE}/dm/threads?tab=accepted", headers=auth(admin_token))
        rec("(5a) GET /dm/threads?tab=accepted → 200",
            r.status_code == 200, f"status={r.status_code}")

        r = await client.get(f"{BASE}/dm/threads?tab=requests", headers=auth(admin_token))
        rec("(5b) GET /dm/threads?tab=requests → 200",
            r.status_code == 200, f"status={r.status_code}")

        r = await client.post(f"{BASE}/dm/threads/{tid}/mute", headers=auth(admin_token))
        ok1 = r.status_code == 200
        s1 = r.json().get("is_muted") if ok1 else None
        r = await client.post(f"{BASE}/dm/threads/{tid}/mute", headers=auth(admin_token))
        ok2 = r.status_code == 200
        s2 = r.json().get("is_muted") if ok2 else None
        rec("(5c) POST /dm/threads/{tid}/mute toggles is_muted",
            ok1 and ok2 and s1 != s2, f"first={s1} second={s2}")

        r = await client.post(f"{BASE}/users/{sec_id}/block", headers=auth(admin_token))
        ok_b = r.status_code == 200 and r.json().get("blocked") is True
        rec("(5d) POST /users/{uid}/block",
            ok_b, f"status={r.status_code} body={r.text[:120]}")

        r = await client.delete(f"{BASE}/users/{sec_id}/block", headers=auth(admin_token))
        ok_u = r.status_code == 200 and r.json().get("blocked") is False
        rec("(5e) DELETE /users/{uid}/block",
            ok_u, f"status={r.status_code} body={r.text[:120]}")

        r = await client.post(
            f"{BASE}/reports",
            headers=auth(admin_token),
            json={"target_type": "user", "target_id": sec_id, "reason": "inappropriate"},
        )
        ok_rep = False
        rep_detail = ""
        if r.status_code == 200:
            b = r.json()
            rep_detail = f"keys={list(b.keys())}"
            ok_rep = bool(b.get("report_id")) or b.get("status") == "pending"
        else:
            rep_detail = f"status={r.status_code} body={r.text[:150]}"
        rec("(5f) POST /reports {user, inappropriate} → 200 with report_id",
            ok_rep, rep_detail)

    print("\n" + "=" * 72)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"TOTAL: {len(RESULTS)}  PASS: {passed}  FAIL: {len(failed)}")
    if failed:
        print("FAILED:")
        for n in failed:
            print(f"  - {n}")
    print("=" * 72)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
