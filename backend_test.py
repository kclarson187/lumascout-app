"""
PhotoScout — Phase 1 Community backend tests.
Covers:
  P0) POST /api/spots regression (normal create returns 200; draft flag honored)
  P0) Community posts CRUD (+ like/unlike, comments, admin delete audit log)
  P0) Messaging (idempotent conv, self/unknown target, send, inbox unread, read markers)
  P1) GET /api/photographers/nearby (default city, filter, no password_hash, excludes self)
  P1) PATCH /api/auth/me community fields round-trip
"""
import os
import sys
import json
import time
import uuid
import requests

BASE = os.environ.get("BACKEND_BASE_URL", "https://photo-finder-60.preview.emergentagent.com/api")
SOPHIE = {"email": "sophie@photoscout.app", "password": "demo123"}
MARCO = {"email": "marco@photoscout.app", "password": "demo123"}
ADMIN = {"email": "admin@photoscout.app", "password": "admin123"}

results = []  # list of (task, case, passed, detail)


def record(task, case, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] {task} :: {case} — {detail}")
    results.append((task, case, bool(passed), detail))


def login(creds):
    r = requests.post(f"{BASE}/auth/login", json=creds, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"login failed for {creds['email']}: {r.status_code} {r.text}")
    data = r.json()
    return data["token"], data["user"]


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------------------------------------------------------------------
# Setup: login all users
# ---------------------------------------------------------------------------
print(f"\n=== BACKEND BASE: {BASE} ===\n")

try:
    sophie_tok, sophie = login(SOPHIE)
    marco_tok, marco = login(MARCO)
    admin_tok, admin = login(ADMIN)
except Exception as e:
    print(f"FATAL login failure: {e}")
    sys.exit(2)

print(f"sophie user_id={sophie['user_id']} city={sophie.get('city')!r}")
print(f"marco  user_id={marco['user_id']}")
print(f"admin  user_id={admin['user_id']} role={admin.get('role')}\n")


# ===========================================================================
# TASK 1 — POST /api/spots regression
# ===========================================================================
T1 = "POST /api/spots regression"

created_spot_ids = []

try:
    # Tiny image as base64 — 1x1 png
    tiny_png = (
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC"
        "AAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="
    )
    body = {
        "title": f"Test Spot {uuid.uuid4().hex[:6]}",
        "description": "tiny description",
        "latitude": 30.2672,
        "longitude": -97.7431,
        "city": "Austin",
        "state": "TX",
        "privacy_mode": "private",  # avoid moderation queue
        "shoot_types": ["family"],
        "style_tags": ["urban"],
        "images": [{"image_url": tiny_png, "caption": "test"}],
    }
    r = requests.post(f"{BASE}/spots", json=body, headers=H(sophie_tok), timeout=25)
    ok = r.status_code == 200 and r.json().get("spot_id")
    if ok:
        created_spot_ids.append(r.json()["spot_id"])
    record(T1, "small-payload spot creates 200 with spot_id",
           ok, f"status={r.status_code} body={r.text[:160]}")
except Exception as e:
    record(T1, "small-payload spot creates 200 with spot_id", False, str(e))

try:
    body = {
        "title": f"Draft Spot {uuid.uuid4().hex[:6]}",
        "description": "draft",
        "latitude": 30.2672,
        "longitude": -97.7431,
        "city": "Austin",
        "state": "TX",
        "privacy_mode": "public",  # normally would be pending_review
        "save_as_draft": True,
        "images": [],
    }
    r = requests.post(f"{BASE}/spots", json=body, headers=H(sophie_tok), timeout=25)
    data = r.json() if r.status_code == 200 else {}
    ok = r.status_code == 200 and data.get("visibility_status") == "draft"
    if data.get("spot_id"):
        created_spot_ids.append(data["spot_id"])
    record(T1, "save_as_draft:true returns visibility_status=draft",
           ok, f"status={r.status_code} visibility_status={data.get('visibility_status')}")
except Exception as e:
    record(T1, "save_as_draft:true returns visibility_status=draft", False, str(e))


# ===========================================================================
# TASK 2 — Community posts CRUD
# ===========================================================================
T2 = "Community posts CRUD"

post_id = None
try:
    body = {
        "category": "win",
        "title": "Booked 4 family sessions this month!",
        "body": "Austin referrals have been wild lately — so grateful.",
        "city": "Austin",
        "state": "TX",
    }
    r = requests.post(f"{BASE}/posts", json=body, headers=H(sophie_tok), timeout=20)
    data = r.json() if r.status_code == 200 else {}
    post_id = data.get("post_id")
    author = data.get("author") or {}
    ok = (
        r.status_code == 200
        and post_id
        and author.get("user_id") == sophie["user_id"]
        and data.get("like_count") == 0
        and data.get("liked_by_me") is False
    )
    record(T2, "create post (sophie) returns 200 with author hydrated",
           ok, f"status={r.status_code} post_id={post_id} author.name={author.get('name')}")
except Exception as e:
    record(T2, "create post (sophie) returns 200 with author hydrated", False, str(e))

try:
    r = requests.post(f"{BASE}/posts", json={"category": "banana", "title": "bad"},
                      headers=H(sophie_tok), timeout=20)
    ok = r.status_code == 400 and "Invalid category" in r.text
    record(T2, "invalid category → 400 with enum list", ok,
           f"status={r.status_code} body={r.text[:200]}")
except Exception as e:
    record(T2, "invalid category → 400 with enum list", False, str(e))

try:
    r = requests.get(f"{BASE}/posts", headers=H(sophie_tok), timeout=20)
    data = r.json() if r.status_code == 200 else {}
    items = data.get("items", [])
    found = any(p.get("post_id") == post_id for p in items) if post_id else False
    first_match = next((p for p in items if p.get("post_id") == post_id), None)
    ok = r.status_code == 200 and "total" in data and found and first_match and first_match.get("liked_by_me") is False
    record(T2, "GET /posts includes new post with liked_by_me=false", ok,
           f"status={r.status_code} total={data.get('total')} found={found}")
except Exception as e:
    record(T2, "GET /posts includes new post with liked_by_me=false", False, str(e))

try:
    r = requests.get(f"{BASE}/posts?category=win", headers=H(sophie_tok), timeout=20)
    data = r.json() if r.status_code == 200 else {}
    items = data.get("items", [])
    ok = r.status_code == 200 and all(p.get("category") == "win" for p in items) and len(items) > 0
    record(T2, "GET /posts?category=win filters", ok,
           f"status={r.status_code} n={len(items)} all_win={all(p.get('category')=='win' for p in items)}")
except Exception as e:
    record(T2, "GET /posts?category=win filters", False, str(e))

# Likes
try:
    r1 = requests.post(f"{BASE}/posts/{post_id}/like", headers=H(admin_tok), timeout=20)
    # Then GET as admin
    r2 = requests.get(f"{BASE}/posts/{post_id}", headers=H(admin_tok), timeout=20)
    data = r2.json() if r2.status_code == 200 else {}
    ok = r1.status_code == 200 and r2.status_code == 200 and data.get("like_count") == 1 and data.get("liked_by_me") is True
    record(T2, "POST /like then GET shows like_count=1, liked_by_me=true (admin)",
           ok, f"like_status={r1.status_code} like_count={data.get('like_count')} liked_by_me={data.get('liked_by_me')}")
except Exception as e:
    record(T2, "POST /like then GET shows like_count=1, liked_by_me=true (admin)", False, str(e))

try:
    # Second like by same user must be idempotent (no count increase)
    r = requests.post(f"{BASE}/posts/{post_id}/like", headers=H(admin_tok), timeout=20)
    r2 = requests.get(f"{BASE}/posts/{post_id}", headers=H(admin_tok), timeout=20)
    data = r2.json() if r2.status_code == 200 else {}
    ok = r.status_code == 200 and data.get("like_count") == 1
    record(T2, "second like from same user is idempotent", ok,
           f"status={r.status_code} like_count={data.get('like_count')}")
except Exception as e:
    record(T2, "second like from same user is idempotent", False, str(e))

try:
    r = requests.delete(f"{BASE}/posts/{post_id}/like", headers=H(admin_tok), timeout=20)
    r2 = requests.get(f"{BASE}/posts/{post_id}", headers=H(admin_tok), timeout=20)
    data = r2.json() if r2.status_code == 200 else {}
    ok = r.status_code == 200 and data.get("like_count") == 0 and data.get("liked_by_me") is False
    record(T2, "DELETE /like decrements to 0", ok,
           f"del_status={r.status_code} like_count={data.get('like_count')} liked_by_me={data.get('liked_by_me')}")
except Exception as e:
    record(T2, "DELETE /like decrements to 0", False, str(e))

# Comments
try:
    r = requests.get(f"{BASE}/posts/{post_id}/comments", headers=H(sophie_tok), timeout=20)
    ok = r.status_code == 200 and r.json() == []
    record(T2, "GET /comments initially empty []", ok, f"status={r.status_code} body={r.text[:120]}")
except Exception as e:
    record(T2, "GET /comments initially empty []", False, str(e))

try:
    r = requests.post(f"{BASE}/posts/{post_id}/comments", json={"body": "Congrats Sophie!"},
                      headers=H(admin_tok), timeout=20)
    cok = r.status_code == 200 and r.json().get("comment_id")
    r2 = requests.get(f"{BASE}/posts/{post_id}/comments", headers=H(sophie_tok), timeout=20)
    lst = r2.json() if r2.status_code == 200 else []
    has_author = isinstance(lst, list) and len(lst) == 1 and lst[0].get("author", {}).get("user_id") == admin["user_id"]
    record(T2, "POST comment then GET shows 1 item with author info",
           cok and has_author, f"post={r.status_code} get={r2.status_code} n={len(lst)}")
except Exception as e:
    record(T2, "POST comment then GET shows 1 item with author info", False, str(e))

# Forbidden delete by non-owner
try:
    r = requests.delete(f"{BASE}/posts/{post_id}", headers=H(marco_tok), timeout=20)
    ok = r.status_code == 403
    record(T2, "DELETE post as non-owner non-admin → 403", ok, f"status={r.status_code} body={r.text[:120]}")
except Exception as e:
    record(T2, "DELETE post as non-owner non-admin → 403", False, str(e))

# Owner delete
try:
    r = requests.delete(f"{BASE}/posts/{post_id}", headers=H(sophie_tok), timeout=20)
    ok = r.status_code == 200
    record(T2, "DELETE post as owner → 200", ok, f"status={r.status_code} body={r.text[:120]}")
except Exception as e:
    record(T2, "DELETE post as owner → 200", False, str(e))

# Admin deletion + audit log: create a fresh post as marco, admin deletes, check audit
admin_del_post_id = None
try:
    r = requests.post(f"{BASE}/posts",
                      json={"category": "tip", "title": "Lens tip", "body": "Use a prime.",
                            "city": "Austin", "state": "TX"},
                      headers=H(marco_tok), timeout=20)
    if r.status_code == 200:
        admin_del_post_id = r.json().get("post_id")
    record(T2, "setup: marco creates post for admin-delete test",
           bool(admin_del_post_id), f"status={r.status_code} post_id={admin_del_post_id}")
except Exception as e:
    record(T2, "setup: marco creates post for admin-delete test", False, str(e))

if admin_del_post_id:
    try:
        r = requests.delete(f"{BASE}/posts/{admin_del_post_id}", headers=H(admin_tok), timeout=20)
        ok = r.status_code == 200
        record(T2, "admin deletes another user's post → 200", ok, f"status={r.status_code}")
    except Exception as e:
        record(T2, "admin deletes another user's post → 200", False, str(e))

    try:
        # Query audit logs filtered by target_id
        r = requests.get(f"{BASE}/admin/audit-logs",
                         params={"target_id": admin_del_post_id, "action": "post.remove"},
                         headers=H(admin_tok), timeout=20)
        data = r.json() if r.status_code == 200 else {}
        items = data.get("items", [])
        found = any(it.get("action") == "post.remove" and it.get("target_id") == admin_del_post_id
                    and it.get("admin_user_id") == admin["user_id"] for it in items)
        record(T2, "audit log entry 'post.remove' exists for admin deletion",
               found, f"status={r.status_code} n_items={len(items)}")
    except Exception as e:
        record(T2, "audit log entry 'post.remove' exists for admin deletion", False, str(e))


# ===========================================================================
# TASK 3 — Messaging
# ===========================================================================
T3 = "Messaging (conversations + messages)"

conv_id = None
try:
    r = requests.post(f"{BASE}/conversations",
                      json={"participant_user_id": admin["user_id"]},
                      headers=H(sophie_tok), timeout=20)
    data = r.json() if r.status_code == 200 else {}
    conv_id = data.get("conversation_id")
    ok = r.status_code == 200 and conv_id and data.get("participant_key") == "|".join(sorted([sophie["user_id"], admin["user_id"]]))
    record(T3, "POST /conversations creates 1:1 conversation", ok,
           f"status={r.status_code} conv_id={conv_id}")
except Exception as e:
    record(T3, "POST /conversations creates 1:1 conversation", False, str(e))

try:
    r = requests.post(f"{BASE}/conversations",
                      json={"participant_user_id": admin["user_id"]},
                      headers=H(sophie_tok), timeout=20)
    data = r.json() if r.status_code == 200 else {}
    same_id = data.get("conversation_id") == conv_id
    ok = r.status_code == 200 and same_id
    record(T3, "POST /conversations is idempotent (same id returned)", ok,
           f"status={r.status_code} returned_id={data.get('conversation_id')} expected={conv_id}")
except Exception as e:
    record(T3, "POST /conversations is idempotent", False, str(e))

try:
    r = requests.post(f"{BASE}/conversations",
                      json={"participant_user_id": sophie["user_id"]},
                      headers=H(sophie_tok), timeout=20)
    ok = r.status_code == 400
    record(T3, "self-DM → 400", ok, f"status={r.status_code} body={r.text[:120]}")
except Exception as e:
    record(T3, "self-DM → 400", False, str(e))

try:
    r = requests.post(f"{BASE}/conversations",
                      json={"participant_user_id": "user_doesnotexist_xxx"},
                      headers=H(sophie_tok), timeout=20)
    ok = r.status_code == 404
    record(T3, "unknown recipient → 404", ok, f"status={r.status_code} body={r.text[:120]}")
except Exception as e:
    record(T3, "unknown recipient → 404", False, str(e))

# Send a message
msg_id = None
if conv_id:
    try:
        r = requests.post(f"{BASE}/conversations/{conv_id}/messages",
                          json={"body": "hey!"}, headers=H(sophie_tok), timeout=20)
        data = r.json() if r.status_code == 200 else {}
        msg_id = data.get("message_id")
        ok = r.status_code == 200 and msg_id and data.get("body") == "hey!"
        record(T3, "POST message as sender → 200 with message_id", ok,
               f"status={r.status_code} message_id={msg_id}")
    except Exception as e:
        record(T3, "POST message as sender → 200 with message_id", False, str(e))

    try:
        r = requests.post(f"{BASE}/conversations/{conv_id}/messages",
                          json={"body": "   "}, headers=H(sophie_tok), timeout=20)
        ok = r.status_code == 400
        record(T3, "empty message body → 400", ok, f"status={r.status_code} body={r.text[:120]}")
    except Exception as e:
        record(T3, "empty message body → 400", False, str(e))

    # Sophie's inbox: unread for her should be 0 (she sent it), last_message set
    try:
        r = requests.get(f"{BASE}/me/conversations", headers=H(sophie_tok), timeout=20)
        data = r.json() if r.status_code == 200 else []
        row = next((c for c in data if c.get("conversation_id") == conv_id), None)
        ok = r.status_code == 200 and row and row.get("unread") == 0 and row.get("last_message") == "hey!"
        record(T3, "sophie inbox has unread=0, last_message='hey!'",
               ok, f"status={r.status_code} row={json.dumps(row)[:200] if row else None}")
    except Exception as e:
        record(T3, "sophie inbox unread/last_message", False, str(e))

    # Admin inbox: unread should be 1
    try:
        r = requests.get(f"{BASE}/me/conversations", headers=H(admin_tok), timeout=20)
        data = r.json() if r.status_code == 200 else []
        row = next((c for c in data if c.get("conversation_id") == conv_id), None)
        ok = r.status_code == 200 and row and row.get("unread") == 1
        record(T3, "admin inbox shows unread=1 before reading",
               ok, f"status={r.status_code} unread={row.get('unread') if row else None}")
    except Exception as e:
        record(T3, "admin inbox unread=1", False, str(e))

    # Admin GETs messages → marks read
    try:
        r = requests.get(f"{BASE}/conversations/{conv_id}/messages", headers=H(admin_tok), timeout=20)
        msgs = r.json() if r.status_code == 200 else []
        ok_get = r.status_code == 200 and isinstance(msgs, list) and any(m.get("body") == "hey!" for m in msgs)
        # re-check inbox
        r2 = requests.get(f"{BASE}/me/conversations", headers=H(admin_tok), timeout=20)
        data = r2.json() if r2.status_code == 200 else []
        row = next((c for c in data if c.get("conversation_id") == conv_id), None)
        ok_read = row and row.get("unread") == 0
        record(T3, "admin GET /messages then inbox unread=0 (marked read)",
               ok_get and ok_read, f"get_status={r.status_code} n={len(msgs)} unread_after={row.get('unread') if row else None}")
    except Exception as e:
        record(T3, "admin GET /messages marks read", False, str(e))

    # Third-party viewer (marco) → 404
    try:
        r = requests.get(f"{BASE}/conversations/{conv_id}/messages", headers=H(marco_tok), timeout=20)
        ok = r.status_code == 404
        record(T3, "third-party viewer (marco) → 404", ok, f"status={r.status_code}")
    except Exception as e:
        record(T3, "third-party viewer → 404", False, str(e))


# ===========================================================================
# TASK 4 — Photographers nearby
# ===========================================================================
T4 = "GET /api/photographers/nearby"

try:
    r = requests.get(f"{BASE}/photographers/nearby", headers=H(sophie_tok), timeout=20)
    data = r.json() if r.status_code == 200 else {}
    items = data.get("items", [])
    ok_status = r.status_code == 200
    ok_city = (data.get("city") or "").lower() == "austin"
    ok_no_self = all(u.get("user_id") != sophie["user_id"] for u in items)
    ok_no_pw = all("password_hash" not in u for u in items)
    record(T4, "default city → Austin, excludes self, no password_hash",
           ok_status and ok_city and ok_no_self and ok_no_pw,
           f"status={r.status_code} city={data.get('city')} count={data.get('count')} "
           f"no_self={ok_no_self} no_pw={ok_no_pw}")
except Exception as e:
    record(T4, "default nearby query", False, str(e))

try:
    r = requests.get(f"{BASE}/photographers/nearby?city=Austin", headers=H(sophie_tok), timeout=20)
    data = r.json() if r.status_code == 200 else {}
    items = data.get("items", [])
    ok = r.status_code == 200 and (data.get("city") or "").lower() == "austin" and all("password_hash" not in u for u in items)
    record(T4, "?city=Austin returns city-filtered results", ok,
           f"status={r.status_code} count={data.get('count')}")
except Exception as e:
    record(T4, "?city=Austin", False, str(e))

try:
    r = requests.get(f"{BASE}/photographers/nearby?specialty=Family", headers=H(sophie_tok), timeout=20)
    data = r.json() if r.status_code == 200 else {}
    items = data.get("items", [])
    # Either 0 or all items have Family in specialties[]
    valid = all(("Family" in (u.get("specialties") or [])) for u in items)
    ok = r.status_code == 200 and valid
    record(T4, "?specialty=Family filters correctly (may be 0)", ok,
           f"status={r.status_code} count={len(items)} valid_specialty_filter={valid}")
except Exception as e:
    record(T4, "?specialty=Family", False, str(e))


# ===========================================================================
# TASK 5 — Profile community fields PATCH/GET round-trip
# ===========================================================================
T5 = "Profile community fields"

profile_payload = {
    "specialties": ["Family", "Pets"],
    "service_area": "Austin & San Antonio",
    "years_shooting": 5,
    "website": "https://petographytx.com",
    "instagram": "@petographytx",
    "available_for_second_shooter": True,
    "mentorship_available": True,
    "community_onboarded": True,
}

try:
    r = requests.patch(f"{BASE}/auth/me", json=profile_payload, headers=H(sophie_tok), timeout=20)
    patch_ok = r.status_code == 200
    record(T5, "PATCH /auth/me returns 200", patch_ok, f"status={r.status_code} body={r.text[:160]}")

    r2 = requests.get(f"{BASE}/auth/me", headers=H(sophie_tok), timeout=20)
    me = r2.json() if r2.status_code == 200 else {}
    mismatches = []
    for k, v in profile_payload.items():
        if me.get(k) != v:
            mismatches.append(f"{k}: got={me.get(k)!r} expected={v!r}")
    ok_persist = len(mismatches) == 0
    record(T5, "GET /auth/me shows all fields persisted exactly",
           ok_persist, "; ".join(mismatches) if mismatches else "all fields match")
except Exception as e:
    record(T5, "PATCH/GET round-trip", False, str(e))


# ===========================================================================
# Cleanup — try to delete spots we made
# ===========================================================================
for sid in created_spot_ids:
    try:
        requests.delete(f"{BASE}/spots/{sid}", headers=H(sophie_tok), timeout=15)
    except Exception:
        pass


# ===========================================================================
# Summary
# ===========================================================================
print("\n" + "=" * 78)
print("SUMMARY")
print("=" * 78)

by_task = {}
for task, case, passed, detail in results:
    by_task.setdefault(task, []).append((case, passed, detail))

total_fail = 0
for task, cases in by_task.items():
    passed_n = sum(1 for _, p, _ in cases if p)
    total_n = len(cases)
    symbol = "✅" if passed_n == total_n else "❌"
    print(f"{symbol} {task}: {passed_n}/{total_n}")
    for case, p, detail in cases:
        if not p:
            total_fail += 1
            print(f"   ✗ {case} — {detail}")

print(f"\nTotal failed: {total_fail}/{len(results)}")
sys.exit(0 if total_fail == 0 else 1)
