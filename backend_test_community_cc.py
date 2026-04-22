"""
Community Control Center — backend QA
Tests /app/backend/server.py lines 4565–4986 (plus POST /api/report).
Backend URL: http://localhost:8001/api (per review request).
"""
import os
import sys
import uuid
import time
import asyncio
import requests
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

BASE = "http://localhost:8001/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "photoscout_database"

CREDS = {
    "admin":  ("admin@lumascout.app", "admin123"),
    "sophie": ("sophie@lumascout.app", "demo123"),
    "marco":  ("marco@lumascout.app", "demo123"),
    "priya":  ("priya@lumascout.app", "demo123"),
}

results = []  # (name, ok, note)


def record(name, ok, note=""):
    results.append((name, ok, note))
    marker = "PASS" if ok else "FAIL"
    print(f"[{marker}] {name}  {note}")


def login(key):
    email, pw = CREDS[key]
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, timeout=10)
    assert r.status_code == 200, f"login {key} failed: {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"]["user_id"]


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


async def db():
    cli = AsyncIOMotorClient(MONGO_URL)
    return cli[DB_NAME], cli


async def set_role(email, role):
    d, _ = await db()
    await d.users.update_one({"email": email}, {"$set": {"role": role}})


async def get_user_role(email):
    d, _ = await db()
    u = await d.users.find_one({"email": email}, {"role": 1})
    return u.get("role") if u else None


async def get_post(post_id):
    d, _ = await db()
    return await d.community_posts.find_one({"post_id": post_id}, {"_id": 0})


async def count_audit(admin_user_id, actions):
    d, _ = await db()
    return await d.audit_logs.count_documents({
        "admin_user_id": admin_user_id,
        "action": {"$in": list(actions)},
    })


async def get_user(user_id):
    d, _ = await db()
    return await d.users.find_one({"user_id": user_id}, {"_id": 0})


async def clear_sanctions(user_ids):
    d, _ = await db()
    await d.user_sanctions.delete_many({"user_id": {"$in": user_ids}})
    await d.users.update_many(
        {"user_id": {"$in": user_ids}},
        {"$set": {"status": "active"},
         "$unset": {"suspended_until": "", "banned_at": ""}},
    )


async def hard_delete_posts(post_ids):
    d, _ = await db()
    await d.community_posts.delete_many({"post_id": {"$in": post_ids}})


def create_post(tok, title_suffix="", category="tip"):
    body = {
        "category": category,
        "title": f"QA test post {title_suffix} {uuid.uuid4().hex[:6]}",
        "body": "Control center testing content body.",
        "city": "Austin",
        "state": "TX",
    }
    r = requests.post(f"{BASE}/posts", json=body, headers=auth(tok), timeout=10)
    assert r.status_code == 200, f"create post failed: {r.status_code} {r.text}"
    return r.json()["post_id"]


def moderate(tok, typ, pid, action, reason="qa test", expect=200):
    r = requests.post(
        f"{BASE}/admin/community/moderate",
        json={"type": typ, "id": pid, "action": action, "reason": reason},
        headers=auth(tok), timeout=10,
    )
    return r


def main():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    print("\n=== Logging in ===")
    admin_tok, admin_uid = login("admin")
    sophie_tok, sophie_uid = login("sophie")
    marco_tok, marco_uid = login("marco")
    priya_tok, priya_uid = login("priya")
    print(f"admin={admin_uid} sophie={sophie_uid} marco={marco_uid} priya={priya_uid}")

    created_posts = []

    try:
        # ----- AUTH GATES -----
        print("\n=== AUTH GATES ===")
        r = requests.post(f"{BASE}/admin/community/moderate",
                          json={"type": "post", "id": "x", "action": "pin"}, timeout=10)
        record("1. /admin/community/moderate no auth → 401",
               r.status_code == 401, f"got {r.status_code}")

        r = requests.post(f"{BASE}/admin/community/moderate",
                          json={"type": "post", "id": "x", "action": "pin"},
                          headers=auth(marco_tok), timeout=10)
        record("2. marco (user) → 403", r.status_code == 403, f"got {r.status_code}")

        r = requests.post(f"{BASE}/report",
                          json={"target_type": "post", "target_id": "x", "reason": "spam"},
                          timeout=10)
        record("3. POST /report no auth → 401", r.status_code == 401, f"got {r.status_code}")

        # ----- MODERATE ACTIONS — happy paths (admin as super_admin) -----
        print("\n=== MODERATE happy path ===")
        post_id = create_post(admin_tok, "mod-happy")
        created_posts.append(post_id)

        # 5. pin
        r = moderate(admin_tok, "post", post_id, "pin")
        doc = loop.run_until_complete(get_post(post_id))
        ok = r.status_code == 200 and bool(doc and doc.get("pinned")) and r.json().get("action") == "pin"
        record("5. pin → pinned=true", ok, f"status={r.status_code} pinned={doc and doc.get('pinned')}")
        # audit check
        audit_pin = loop.run_until_complete(count_audit(admin_uid, ["post.pin"]))
        record("5b. audit_log post.pin exists", audit_pin >= 1, f"count={audit_pin}")

        # 6. unpin
        r = moderate(admin_tok, "post", post_id, "unpin")
        doc = loop.run_until_complete(get_post(post_id))
        record("6. unpin → pinned=false",
               r.status_code == 200 and not doc.get("pinned"),
               f"pinned={doc.get('pinned')}")

        # 7. feature/unfeature
        moderate(admin_tok, "post", post_id, "feature")
        doc = loop.run_until_complete(get_post(post_id))
        record("7a. feature → featured=true", bool(doc.get("featured")))
        moderate(admin_tok, "post", post_id, "unfeature")
        doc = loop.run_until_complete(get_post(post_id))
        record("7b. unfeature → featured=false", not doc.get("featured"))

        # 8. hide (status unchanged)
        moderate(admin_tok, "post", post_id, "hide")
        doc = loop.run_until_complete(get_post(post_id))
        record("8. hide → hidden=true, status unchanged",
               bool(doc.get("hidden")) and doc.get("status", "active") == "active",
               f"hidden={doc.get('hidden')} status={doc.get('status')}")

        # 9. restore
        moderate(admin_tok, "post", post_id, "restore")
        doc = loop.run_until_complete(get_post(post_id))
        record("9. restore → hidden=false, status=active",
               not doc.get("hidden") and doc.get("status") == "active",
               f"hidden={doc.get('hidden')} status={doc.get('status')}")

        # 10. mark_spam → spam=true, status='removed', removed_by=admin
        moderate(admin_tok, "post", post_id, "mark_spam", reason="looks like spam")
        doc = loop.run_until_complete(get_post(post_id))
        record("10. mark_spam → spam=true status=removed removed_by=admin",
               bool(doc.get("spam")) and doc.get("status") == "removed"
               and doc.get("removed_by") == admin_uid,
               f"spam={doc.get('spam')} status={doc.get('status')} removed_by={doc.get('removed_by')}")

        # 11. clear_spam
        moderate(admin_tok, "post", post_id, "clear_spam")
        doc = loop.run_until_complete(get_post(post_id))
        record("11. clear_spam → spam=false status=active",
               not doc.get("spam") and doc.get("status") == "active",
               f"spam={doc.get('spam')} status={doc.get('status')}")

        # 12. lock/unlock
        moderate(admin_tok, "post", post_id, "lock")
        doc = loop.run_until_complete(get_post(post_id))
        record("12a. lock → locked=true", bool(doc.get("locked")))
        moderate(admin_tok, "post", post_id, "unlock")
        doc = loop.run_until_complete(get_post(post_id))
        record("12b. unlock → locked=false", not doc.get("locked"))

        # 13. soft_delete — auto-resolve pending reports for this post
        # First have sophie file a report
        r = requests.post(f"{BASE}/report",
                          json={"target_type": "post", "target_id": post_id, "reason": "spam"},
                          headers=auth(sophie_tok), timeout=10)
        assert r.status_code == 200
        moderate(admin_tok, "post", post_id, "soft_delete", reason="qa soft delete")
        doc = loop.run_until_complete(get_post(post_id))
        async def _pending_reports():
            d, _ = await db()
            return await d.reports.count_documents(
                {"target_type": "post", "target_id": post_id, "status": "pending"})
        pending = loop.run_until_complete(_pending_reports())
        record("13. soft_delete → status=removed, removed_by, removed_at, removal_reason; pending reports auto-resolved",
               doc.get("status") == "removed" and doc.get("removed_by") == admin_uid
               and doc.get("removed_at") and doc.get("removal_reason") == "qa soft delete"
               and pending == 0,
               f"status={doc.get('status')} pending_now={pending}")

        # 14. hard_delete as super_admin
        hd_post = create_post(admin_tok, "hard-del")
        moderate(admin_tok, "post", hd_post, "hard_delete", reason="qa hard delete")
        doc = loop.run_until_complete(get_post(hd_post))
        record("14. hard_delete (super_admin) → physical deletion", doc is None,
               f"find_one={doc}")

        # 15. hard_delete as admin (non-super) → 403
        loop.run_until_complete(set_role("priya@lumascout.app", "admin"))
        priya_tok2, _ = login("priya")
        hd_post2 = create_post(admin_tok, "hard-del-gate")
        created_posts.append(hd_post2)
        r = moderate(priya_tok2, "post", hd_post2, "hard_delete")
        record("15. hard_delete as admin (non-super) → 403", r.status_code == 403,
               f"got {r.status_code}")
        loop.run_until_complete(set_role("priya@lumascout.app", "user"))

        # ----- UNKNOWN ACTIONS / TYPES -----
        print("\n=== UNKNOWN action/type ===")
        r = moderate(admin_tok, "post", post_id, "bogus")
        record("16. action=bogus → 400", r.status_code == 400, f"got {r.status_code}")
        r = requests.post(f"{BASE}/admin/community/moderate",
                          json={"type": "spot", "id": post_id, "action": "pin"},
                          headers=auth(admin_tok), timeout=10)
        record("17. type=spot → 400", r.status_code == 400, f"got {r.status_code}")

        # ----- BULK MODERATE -----
        print("\n=== BULK MODERATE ===")
        b1 = create_post(admin_tok, "bulk1")
        b2 = create_post(admin_tok, "bulk2")
        b3 = create_post(admin_tok, "bulk3")
        created_posts += [b1, b2, b3]
        r = requests.post(f"{BASE}/admin/community/bulk-moderate",
                          json={"type": "post", "ids": [b1, b2, b3], "action": "hide"},
                          headers=auth(admin_tok), timeout=10)
        body = r.json() if r.status_code == 200 else {}
        record("18. bulk hide 3 posts → applied=3 failed=0",
               r.status_code == 200 and body.get("applied") == 3 and body.get("failed") == 0,
               f"status={r.status_code} body={body}")

        r = requests.post(f"{BASE}/admin/community/bulk-moderate",
                          json={"type": "post", "ids": [b1, "pst_bogusxxxxxx"], "action": "restore"},
                          headers=auth(admin_tok), timeout=10)
        body = r.json() if r.status_code == 200 else {}
        items = body.get("items", [])
        not_ok_items = [i for i in items if not i.get("ok")]
        record("19. bulk 1 valid + 1 invalid → applied=1 failed=1",
               r.status_code == 200 and body.get("applied") == 1
               and body.get("failed") == 1 and len(not_ok_items) == 1,
               f"body={body}")

        r = requests.post(f"{BASE}/admin/community/bulk-moderate",
                          json={"type": "post", "ids": [f"pst_{i:012x}" for i in range(201)],
                                "action": "hide"},
                          headers=auth(admin_tok), timeout=10)
        record("20. bulk 201 ids → 400 'Max 200'",
               r.status_code == 400 and "200" in r.text, f"got {r.status_code} {r.text[:80]}")

        # 21. bulk hard_delete as admin (non-super) → 403
        loop.run_until_complete(set_role("priya@lumascout.app", "admin"))
        priya_tok2, _ = login("priya")
        r = requests.post(f"{BASE}/admin/community/bulk-moderate",
                          json={"type": "post", "ids": [b1, b2], "action": "hard_delete"},
                          headers=auth(priya_tok2), timeout=10)
        record("21. bulk hard_delete as admin non-super → 403",
               r.status_code == 403, f"got {r.status_code}")
        loop.run_until_complete(set_role("priya@lumascout.app", "user"))

        # ----- LIST -----
        print("\n=== LIST /admin/community/content ===")
        # Ensure a pinned item exists
        pin_post = create_post(admin_tok, "listpin")
        created_posts.append(pin_post)
        moderate(admin_tok, "post", pin_post, "pin")

        r = requests.get(f"{BASE}/admin/community/content?type=post&status=pinned&limit=50",
                         headers=auth(admin_tok), timeout=10)
        j = r.json() if r.status_code == 200 else {}
        items = j.get("items", [])
        all_pinned = all(i.get("pinned") for i in items) if items else False
        record("22. ?status=pinned → only pinned items",
               r.status_code == 200 and all_pinned and any(i.get("post_id") == pin_post for i in items),
               f"items={len(items)} all_pinned={all_pinned}")

        # 23. ?reported=true — need a reported post
        rep_post = create_post(admin_tok, "list-reported")
        created_posts.append(rep_post)
        requests.post(f"{BASE}/report",
                      json={"target_type": "post", "target_id": rep_post, "reason": "abuse"},
                      headers=auth(sophie_tok), timeout=10)
        r = requests.get(f"{BASE}/admin/community/content?type=post&reported=true&limit=50",
                         headers=auth(admin_tok), timeout=10)
        j = r.json() if r.status_code == 200 else {}
        items = j.get("items", [])
        has_our = any(i.get("post_id") == rep_post for i in items)
        all_rc_pos = all((i.get("_report_count") or 0) > 0 for i in items) if items else False
        record("23. ?reported=true → only items with pending reports (_report_count>0)",
               r.status_code == 200 and has_our and all_rc_pos,
               f"count={len(items)} has_our={has_our} all_rc_pos={all_rc_pos}")

        # 24. each item has hydrated _author
        if items:
            a = items[0].get("_author")
            record("24. items include hydrated _author (name, avatar_url)",
                   bool(a and "name" in a and "avatar_url" in a), f"_author={a}")
        else:
            record("24. items include hydrated _author", False, "no items returned")

        # ----- SUMMARY -----
        print("\n=== SUMMARY ===")
        r = requests.get(f"{BASE}/admin/community/summary",
                         headers=auth(admin_tok), timeout=10)
        j = r.json() if r.status_code == 200 else {}
        keys_ok = all(k in j for k in ("posts", "polls", "comments", "reports", "sanctions"))
        posts_sub = j.get("posts", {})
        sub_ok = all(k in posts_sub for k in ("active", "removed", "hidden", "spam", "pinned", "featured"))
        nonneg = all(v >= 0 for v in posts_sub.values())
        record("25. /admin/community/summary → 5 top-level keys, post sub-keys correct, non-negative",
               r.status_code == 200 and keys_ok and sub_ok and nonneg,
               f"keys={list(j.keys())}")

        # ----- PUBLIC REPORTS -----
        print("\n=== PUBLIC REPORTS ===")
        rep_post2 = create_post(admin_tok, "report-target")
        created_posts.append(rep_post2)

        r = requests.post(f"{BASE}/report",
                          json={"target_type": "post", "target_id": rep_post2, "reason": "spam"},
                          headers=auth(sophie_tok), timeout=10)
        first_rid = (r.json() or {}).get("report_id")
        record("26. sophie report post → 200, report doc created",
               r.status_code == 200 and bool(first_rid), f"rid={first_rid}")

        r = requests.post(f"{BASE}/report",
                          json={"target_type": "post", "target_id": rep_post2, "reason": "spam"},
                          headers=auth(sophie_tok), timeout=10)
        j = r.json()
        record("27. same sophie same target → same rid, deduped=true",
               r.status_code == 200 and j.get("report_id") == first_rid
               and j.get("deduped") is True,
               f"j={j}")

        long_reason = "x" * 41
        r = requests.post(f"{BASE}/report",
                          json={"target_type": "post", "target_id": rep_post2, "reason": long_reason},
                          headers=auth(sophie_tok), timeout=10)
        record("28. reason > 40 chars → 400", r.status_code == 400, f"got {r.status_code}")

        r = requests.post(f"{BASE}/report",
                          json={"target_type": "xyz", "target_id": "abc", "reason": "spam"},
                          headers=auth(sophie_tok), timeout=10)
        record("29. target_type=xyz → 400", r.status_code == 400, f"got {r.status_code}")

        # ----- SANCTIONS -----
        print("\n=== SANCTIONS ===")
        # Make sure marco is clean
        loop.run_until_complete(clear_sanctions([marco_uid, priya_uid]))

        # 30. warn marco
        r = requests.post(f"{BASE}/admin/users/{marco_uid}/sanction",
                          json={"type": "warn", "reason": "testing warning"},
                          headers=auth(admin_tok), timeout=10)
        marco_doc = loop.run_until_complete(get_user(marco_uid))
        async def _has_active_sanction(uid, typ):
            d, _ = await db()
            return await d.user_sanctions.count_documents(
                {"user_id": uid, "type": typ, "active": True})
        has_warn = loop.run_until_complete(_has_active_sanction(marco_uid, "warn"))
        record("30. warn marco → 200, sanction active=true, user.status unchanged",
               r.status_code == 200 and has_warn >= 1
               and (marco_doc.get("status") in (None, "active")),
               f"status={r.status_code} user.status={marco_doc.get('status')} active_warn={has_warn}")

        # 31. suspend marco 7d
        r = requests.post(f"{BASE}/admin/users/{marco_uid}/sanction",
                          json={"type": "suspend", "reason": "testing", "duration_days": 7},
                          headers=auth(admin_tok), timeout=10)
        marco_doc = loop.run_until_complete(get_user(marco_uid))
        su = marco_doc.get("suspended_until")
        ok = marco_doc.get("status") == "suspended" and su is not None
        if su:
            if su.tzinfo is None:
                su = su.replace(tzinfo=timezone.utc)
            delta_days = (su - datetime.now(timezone.utc)).total_seconds() / 86400
            near_7 = 6.5 <= delta_days <= 7.5
        else:
            near_7 = False
        record("31. suspend marco 7d → status=suspended, suspended_until ≈ now+7d",
               r.status_code == 200 and ok and near_7,
               f"status={marco_doc.get('status')} su_delta={delta_days if su else None}")

        # 32. suspend with duration 9999 → clamp to 365
        loop.run_until_complete(clear_sanctions([marco_uid]))
        r = requests.post(f"{BASE}/admin/users/{marco_uid}/sanction",
                          json={"type": "suspend", "reason": "clamp test", "duration_days": 9999},
                          headers=auth(admin_tok), timeout=10)
        marco_doc = loop.run_until_complete(get_user(marco_uid))
        su = marco_doc.get("suspended_until")
        if su and su.tzinfo is None:
            su = su.replace(tzinfo=timezone.utc)
        near_365 = False
        if su:
            delta_days = (su - datetime.now(timezone.utc)).total_seconds() / 86400
            near_365 = 364 <= delta_days <= 366
        record("32. suspend 9999d → clamped to 365d",
               r.status_code == 200 and near_365,
               f"su_delta={delta_days if su else None}")

        # 33. admin (non-super) ban → 403
        loop.run_until_complete(set_role("priya@lumascout.app", "admin"))
        priya_tok3, _ = login("priya")
        r = requests.post(f"{BASE}/admin/users/{marco_uid}/sanction",
                          json={"type": "ban", "reason": "should be blocked"},
                          headers=auth(priya_tok3), timeout=10)
        record("33. admin(non-super) ban → 403", r.status_code == 403, f"got {r.status_code}")
        loop.run_until_complete(set_role("priya@lumascout.app", "user"))

        # 34. super_admin bans priya
        r = requests.post(f"{BASE}/admin/users/{priya_uid}/sanction",
                          json={"type": "ban", "reason": "qa ban"},
                          headers=auth(admin_tok), timeout=10)
        priya_doc = loop.run_until_complete(get_user(priya_uid))
        record("34. super_admin ban priya → status=banned, banned_at set",
               r.status_code == 200 and priya_doc.get("status") == "banned"
               and priya_doc.get("banned_at") is not None,
               f"status={priya_doc.get('status')} banned_at={priya_doc.get('banned_at')}")

        # 35. unsanction marco
        r = requests.post(f"{BASE}/admin/users/{marco_uid}/unsanction",
                          headers=auth(admin_tok), timeout=10)
        marco_doc = loop.run_until_complete(get_user(marco_uid))
        async def _all_inactive(uid):
            d, _ = await db()
            return await d.user_sanctions.count_documents({"user_id": uid, "active": True})
        active_n = loop.run_until_complete(_all_inactive(marco_uid))
        record("35. unsanction marco → sanction.active=false, status=active, suspended_until cleared",
               r.status_code == 200 and marco_doc.get("status") == "active"
               and "suspended_until" not in marco_doc and active_n == 0,
               f"status={marco_doc.get('status')} active_sanctions_remaining={active_n}")

        # 36. sanction history
        r = requests.get(f"{BASE}/admin/users/{marco_uid}/sanctions",
                         headers=auth(admin_tok), timeout=10)
        j = r.json() if r.status_code == 200 else {}
        record("36. /admin/users/{id}/sanctions → history list",
               r.status_code == 200 and isinstance(j.get("items"), list) and j.get("count", 0) >= 1,
               f"count={j.get('count')}")

        # 37. audit log entries >= 10
        expected_actions = {
            "post.pin", "post.unpin", "post.feature", "post.unfeature",
            "post.hide", "post.restore", "post.mark_spam", "post.clear_spam",
            "post.lock", "post.unlock", "post.soft_delete", "post.hard_delete",
            "user.warn", "user.suspend", "user.ban", "user.unsanction",
        }
        n_audit = loop.run_until_complete(count_audit(admin_uid, expected_actions))
        record(
            "37. ≥10 audit rows for admin with expected action names "
            "(post.pin, post.soft_delete, user.warn, etc.)",
            n_audit >= 10, f"count={n_audit}"
        )

    finally:
        # ---------- CLEANUP ----------
        print("\n=== CLEANUP ===")
        loop.run_until_complete(hard_delete_posts(created_posts))
        loop.run_until_complete(clear_sanctions([marco_uid, priya_uid]))
        # Revert priya role (defensive)
        loop.run_until_complete(set_role("priya@lumascout.app", "user"))
        print(f"Deleted {len(created_posts)} test posts, cleared sanctions.")

    # ---------- SUMMARY ----------
    print("\n" + "=" * 70)
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"TOTAL: {passed}/{total} passed")
    fails = [(n, note) for n, ok, note in results if not ok]
    if fails:
        print("\nFAILURES:")
        for n, note in fails:
            print(f"  - {n} :: {note}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
