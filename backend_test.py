"""
Phase 3 Mobile PRD backend tests.

Covers:
  1) POST /api/posts/{post_id}/react (typed win/tip reactions, toggle, hydration)
  2) POST /api/users/{user_id}/block + DELETE /block (idempotent, severs follow,
     mirrors into dm_blocks, surfaces is_blocked on GET /api/users/{id})
  3) Regression smoke for /auth/me, /spots, /feed/home, /users/{id}/follow,
     /posts, /posts/{id}/like.

Harness uses admin@lumascout.app/admin123 + a freshly-registered secondary
user. Direct Mongo inspection is used to verify collection-level side
effects (post_reactions, user_blocks, dm_blocks, follows).
"""

import asyncio
import os
import sys
import uuid

import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "photoscout_database")

PASS = []
FAIL = []


def _p(name, ok, detail=""):
    if ok:
        PASS.append(name)
        print(f"PASS  {name}  {detail}")
    else:
        FAIL.append(f"{name} — {detail}")
        print(f"FAIL  {name}  {detail}")


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        raise RuntimeError(f"login failed {r.status_code} {r.text}")
    return r.json()


def register(email, password, username, name):
    r = requests.post(
        f"{BASE}/auth/register",
        json={"email": email, "password": password, "username": username, "name": name},
        timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"register failed {r.status_code} {r.text}")
    return r.json()


def auth(token):
    return {"Authorization": f"Bearer {token}"}


async def cleanup_secondary(user_id):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    try:
        await db.users.delete_one({"user_id": user_id})
        await db.follows.delete_many({"$or": [
            {"follower_user_id": user_id}, {"followed_user_id": user_id},
        ]})
        await db.user_blocks.delete_many({"$or": [
            {"blocker_user_id": user_id}, {"blocked_user_id": user_id},
        ]})
        await db.dm_blocks.delete_many({"$or": [
            {"blocker_user_id": user_id}, {"blocked_user_id": user_id},
        ]})
    finally:
        client.close()


async def cleanup_post(post_id):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    try:
        await db.community_posts.delete_one({"post_id": post_id})
        await db.post_reactions.delete_many({"post_id": post_id})
        await db.post_likes.delete_many({"post_id": post_id})
        await db.post_comments.delete_many({"post_id": post_id})
    finally:
        client.close()


async def db_counts(admin_id, target_id, post_id=None):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    try:
        out = {}
        out["follows_admin->target"] = await db.follows.count_documents({
            "follower_user_id": admin_id, "followed_user_id": target_id
        })
        out["follows_target->admin"] = await db.follows.count_documents({
            "follower_user_id": target_id, "followed_user_id": admin_id
        })
        out["user_blocks_admin->target"] = await db.user_blocks.count_documents({
            "blocker_user_id": admin_id, "blocked_user_id": target_id
        })
        out["dm_blocks_admin->target"] = await db.dm_blocks.count_documents({
            "blocker_user_id": admin_id, "blocked_user_id": target_id
        })
        if post_id:
            out["reactions_win"] = await db.post_reactions.count_documents({
                "post_id": post_id, "reaction_type": "win"
            })
            out["reactions_tip"] = await db.post_reactions.count_documents({
                "post_id": post_id, "reaction_type": "tip"
            })
        return out
    finally:
        client.close()


def main():
    admin = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    admin_token = admin["token"]
    admin_id = admin["user"]["user_id"]
    print(f"admin_id={admin_id}")

    suffix = uuid.uuid4().hex[:6]
    u2_email = f"u2_{suffix}@lumascout-qa.com"
    u2_username = f"testuser2_{suffix}"
    u2 = register(u2_email, "pass12345", u2_username, "Test User Two")
    u2_token = u2["token"]  # noqa: F841
    u2_id = u2["user"]["user_id"]
    print(f"u2_id={u2_id} email={u2_email}")

    created_post_id = None
    try:
        # ========== 1) Typed reactions ==========
        r = requests.post(
            f"{BASE}/posts",
            headers=auth(admin_token),
            json={"category": "tip", "title": "Phase3 Reactions QA", "body": "Testing win/tip toggles."},
            timeout=15,
        )
        _p("POST /api/posts (admin creates tip post)", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
        assert r.status_code == 200, r.text
        post = r.json()
        created_post_id = post.get("post_id")
        assert created_post_id, f"no post_id in {post}"

        r = requests.post(f"{BASE}/posts/{created_post_id}/react", headers=auth(admin_token),
                          json={"type": "win"}, timeout=15)
        ok = r.status_code == 200 and r.json() == {"reacted": True, "type": "win", "count": 1}
        _p("POST react win (first) → reacted:true count:1", ok, f"status={r.status_code} body={r.text[:200]}")

        r = requests.post(f"{BASE}/posts/{created_post_id}/react", headers=auth(admin_token),
                          json={"type": "win"}, timeout=15)
        ok = r.status_code == 200 and r.json() == {"reacted": False, "type": "win", "count": 0}
        _p("POST react win (second) → reacted:false count:0", ok, f"status={r.status_code} body={r.text[:200]}")

        r1 = requests.post(f"{BASE}/posts/{created_post_id}/react", headers=auth(admin_token),
                           json={"type": "tip"}, timeout=15)
        r2 = requests.post(f"{BASE}/posts/{created_post_id}/react", headers=auth(admin_token),
                           json={"type": "win"}, timeout=15)
        ok = (r1.status_code == 200 and r1.json().get("count") == 1 and r1.json().get("type") == "tip"
              and r2.status_code == 200 and r2.json().get("count") == 1 and r2.json().get("type") == "win")
        _p("React tip + win coexist (both count=1)", ok,
           f"tip={r1.text[:120]} win={r2.text[:120]}")

        counts = asyncio.run(db_counts(admin_id, u2_id, created_post_id))
        ok_db = counts["reactions_win"] == 1 and counts["reactions_tip"] == 1
        _p("DB: post_reactions has 1 win + 1 tip row", ok_db, str(counts))

        r = requests.post(f"{BASE}/posts/{created_post_id}/react", headers=auth(admin_token),
                          json={"type": "heart"}, timeout=15)
        _p("React invalid type=heart → 400", r.status_code == 400,
           f"status={r.status_code} body={r.text[:200]}")

        r = requests.post(f"{BASE}/posts/post_doesnotexist_{suffix}/react",
                          headers=auth(admin_token), json={"type": "win"}, timeout=15)
        _p("React on non-existent post → 404", r.status_code == 404,
           f"status={r.status_code} body={r.text[:200]}")

        r = requests.post(f"{BASE}/posts/{created_post_id}/react",
                          json={"type": "win"}, timeout=15)
        _p("React without auth → 401/403", r.status_code in (401, 403),
           f"status={r.status_code} body={r.text[:200]}")

        r = requests.get(f"{BASE}/posts", headers=auth(admin_token), timeout=15)
        body = r.json() if r.status_code == 200 else None
        items = body if isinstance(body, list) else (body.get("items") if isinstance(body, dict) else None)
        ok_hydrate = False
        found = None
        if items:
            for it in items:
                if it.get("post_id") == created_post_id:
                    found = it
                    break
        if found is not None:
            rc = found.get("reaction_counts") or {}
            mr = found.get("my_reactions")
            ok_hydrate = (
                isinstance(rc, dict) and "win" in rc and "tip" in rc
                and rc.get("win") == 1 and rc.get("tip") == 1
                and isinstance(mr, list) and set(mr) == {"win", "tip"}
            )
        _p("GET /api/posts hydrates reaction_counts + my_reactions", ok_hydrate,
           f"status={r.status_code} found={bool(found)} sample={str(found)[:300] if found else 'none'}")

        # ========== 2) Block endpoints ==========
        r = requests.post(f"{BASE}/users/{u2_id}/follow", headers=auth(admin_token), timeout=15)
        _p("admin POST /users/{u2}/follow → {following:true}",
           r.status_code == 200 and r.json().get("following") is True,
           f"status={r.status_code} body={r.text[:200]}")

        r = requests.get(f"{BASE}/users/{u2_id}", headers=auth(admin_token), timeout=15)
        ok = r.status_code == 200 and r.json().get("is_following") is True and r.json().get("is_blocked") is False
        _p("GET /api/users/{u2} → is_following:true, is_blocked:false",
           ok, f"status={r.status_code} is_following={r.json().get('is_following')} is_blocked={r.json().get('is_blocked')}")

        r = requests.post(f"{BASE}/users/{u2_id}/block", headers=auth(admin_token), timeout=15)
        _p("admin POST /users/{u2}/block → {blocked:true}",
           r.status_code == 200 and r.json().get("blocked") is True,
           f"status={r.status_code} body={r.text[:200]}")

        r = requests.get(f"{BASE}/users/{u2_id}", headers=auth(admin_token), timeout=15)
        body = r.json() if r.status_code == 200 else {}
        ok = r.status_code == 200 and body.get("is_blocked") is True and body.get("is_following") is False
        _p("After block: GET user returns is_blocked:true, is_following:false",
           ok, f"status={r.status_code} is_following={body.get('is_following')} is_blocked={body.get('is_blocked')}")

        counts = asyncio.run(db_counts(admin_id, u2_id))
        ok_db = (counts["follows_admin->target"] == 0
                 and counts["follows_target->admin"] == 0
                 and counts["user_blocks_admin->target"] == 1
                 and counts["dm_blocks_admin->target"] == 1)
        _p("DB: follows=0 both ways, user_blocks=1, dm_blocks=1 (cascade)", ok_db, str(counts))

        r = requests.post(f"{BASE}/users/{u2_id}/follow", headers=auth(admin_token), timeout=15)
        ok = r.status_code == 403 and "blocked" in (r.json().get("detail") or "").lower()
        _p("admin POST follow on blocked user → 403 'Cannot follow a blocked user'",
           ok, f"status={r.status_code} body={r.text[:200]}")

        r = requests.post(f"{BASE}/users/{u2_id}/block", headers=auth(admin_token), timeout=15)
        _p("Second POST /block → still {blocked:true}",
           r.status_code == 200 and r.json().get("blocked") is True,
           f"status={r.status_code} body={r.text[:200]}")
        counts = asyncio.run(db_counts(admin_id, u2_id))
        _p("Idempotency: user_blocks row count still exactly 1",
           counts["user_blocks_admin->target"] == 1, str(counts))

        r = requests.delete(f"{BASE}/users/{u2_id}/block", headers=auth(admin_token), timeout=15)
        _p("DELETE /users/{u2}/block → {blocked:false}",
           r.status_code == 200 and r.json().get("blocked") is False,
           f"status={r.status_code} body={r.text[:200]}")

        counts = asyncio.run(db_counts(admin_id, u2_id))
        ok_db = counts["user_blocks_admin->target"] == 0 and counts["dm_blocks_admin->target"] == 0
        _p("DB: user_blocks + dm_blocks rows removed after unblock", ok_db, str(counts))

        r = requests.post(f"{BASE}/users/{admin_id}/block", headers=auth(admin_token), timeout=15)
        _p("Self-block → 400", r.status_code == 400, f"status={r.status_code} body={r.text[:200]}")

        r = requests.post(f"{BASE}/users/user_doesnotexist_{suffix}/block",
                          headers=auth(admin_token), timeout=15)
        _p("Block non-existent user → 404", r.status_code == 404,
           f"status={r.status_code} body={r.text[:200]}")

        # ========== 3) Regression ==========
        r = requests.get(f"{BASE}/auth/me", headers=auth(admin_token), timeout=15)
        _p("REG: GET /auth/me → 200", r.status_code == 200, f"status={r.status_code}")

        r = requests.get(f"{BASE}/spots", headers=auth(admin_token), timeout=15)
        _p("REG: GET /spots → 200", r.status_code == 200, f"status={r.status_code}")

        r = requests.get(f"{BASE}/feed/home", headers=auth(admin_token), timeout=15)
        _p("REG: GET /feed/home → 200", r.status_code == 200, f"status={r.status_code}")

        r = requests.post(f"{BASE}/users/{u2_id}/follow", headers=auth(admin_token), timeout=15)
        _p("REG: POST follow (unblocked) works", r.status_code == 200 and r.json().get("following") is True,
           f"status={r.status_code} body={r.text[:200]}")

        r = requests.get(f"{BASE}/posts", headers=auth(admin_token), timeout=15)
        body = r.json() if r.status_code == 200 else None
        items = body if isinstance(body, list) else (body.get("items") if isinstance(body, dict) else None)
        _p("REG: GET /posts → 200 with items", r.status_code == 200 and bool(items),
           f"status={r.status_code} n={len(items) if items else 0}")

        r = requests.post(f"{BASE}/posts/{created_post_id}/like", headers=auth(admin_token), timeout=15)
        _p("REG: POST /posts/{id}/like → 200", r.status_code == 200,
           f"status={r.status_code} body={r.text[:200]}")

    finally:
        try:
            if created_post_id:
                asyncio.run(cleanup_post(created_post_id))
        except Exception as e:
            print(f"post cleanup err: {e}")
        try:
            asyncio.run(cleanup_secondary(u2_id))
        except Exception as e:
            print(f"user cleanup err: {e}")

    print("\n================ RESULTS ================")
    print(f"PASS: {len(PASS)}  |  FAIL: {len(FAIL)}")
    if FAIL:
        print("\nFailures:")
        for f in FAIL:
            print(f"  - {f}")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
