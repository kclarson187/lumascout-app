"""
backend_test.py — Self-service Account Deletion verification
=============================================================
Verifies the App Store 5.1.1(v)–compliant flow:
  DELETE /api/account/delete
plus the GET /api/spots/{id} owner-substitution behavior for
anonymized (creator_anonymized=true) spots.

Per the review brief in /app/test_result.md, this script:
  1. Auth gate checks
  2. Creates a fresh user, uploads an approved-public spot + a draft spot,
     saves a spot, creates a private collection, attempts a weather sub.
  3. Optionally writes a fake stripe_subscription_id into the user doc
     so we can verify the Stripe swallow path.
  4. Calls DELETE /api/account/delete with that JWT — expects 200.
  5. Post-delete: /auth/me 401, /auth/login 401, GET approved spot returns
     owner placeholder, draft spot 404.
  6. Direct MongoDB integrity check (users / deleted_users / spots /
     spot_saves / collections).
  7. Idempotency: second DELETE with same token returns 401 (auth layer
     rejects deleted users) — NOT a 5xx.
  8. Tails /var/log/supervisor/backend.err.log for the expected log lines
     and confirms no PII leaked.

The script prints PASS/FAIL per step, returns nonzero exit if any
critical assertion failed.
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import re
import string
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import requests

# ─── Config ──────────────────────────────────────────────────────────
# Resolve REACT_APP_BACKEND_URL equivalent from frontend env.
def _resolve_backend_url() -> str:
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if "=" not in line or line.strip().startswith("#"):
                continue
            k, _, v = line.partition("=")
            v = v.strip().strip('"')
            if k.strip() in ("EXPO_PUBLIC_BACKEND_URL", "REACT_APP_BACKEND_URL"):
                return v
    raise RuntimeError("Could not find backend URL in /app/frontend/.env")


BASE = _resolve_backend_url().rstrip("/")
API = f"{BASE}/api"


def _mongo_url_and_db() -> tuple[str, str]:
    env_path = Path("/app/backend/.env")
    url = "mongodb://localhost:27017"
    name = "test_database"
    for line in env_path.read_text().splitlines():
        if line.startswith("MONGO_URL="):
            url = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("DB_NAME="):
            name = line.split("=", 1)[1].strip().strip('"')
    return url, name


MONGO_URL, DB_NAME = _mongo_url_and_db()


# ─── Test report machinery ───────────────────────────────────────────
RESULTS: list[tuple[str, str, str]] = []  # (id, PASS/FAIL/INFO, msg)


def record(test_id: str, status: str, msg: str) -> None:
    line = f"[{status:4}] {test_id}: {msg}"
    print(line, flush=True)
    RESULTS.append((test_id, status, msg))


def fatal(msg: str) -> None:
    record("FATAL", "FAIL", msg)
    print_summary()
    sys.exit(1)


def print_summary() -> None:
    print()
    print("═" * 70)
    print("SUMMARY")
    print("═" * 70)
    passes = sum(1 for r in RESULTS if r[1] == "PASS")
    fails = sum(1 for r in RESULTS if r[1] == "FAIL")
    infos = sum(1 for r in RESULTS if r[1] == "INFO")
    for tid, status, msg in RESULTS:
        if status == "FAIL":
            print(f"  ✗ {tid}: {msg}")
    print()
    print(f"PASS: {passes}   FAIL: {fails}   INFO: {infos}")
    print("═" * 70)


def short(payload: Any, limit: int = 400) -> str:
    try:
        s = json.dumps(payload, default=str)
    except Exception:
        s = str(payload)
    return s if len(s) <= limit else s[:limit] + "…"


# ─── Helpers ─────────────────────────────────────────────────────────
def rand_suffix(n: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def register_user() -> tuple[str, str, str, str]:
    """Create a fresh test user. Returns (email, password, user_id, token)."""
    suf = rand_suffix(8)
    email = f"acctdel_test_{suf}@lumascout-qa.com"
    password = "TestPass123!"
    name = "Account Delete Test"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": name},
        timeout=20,
    )
    if r.status_code != 200:
        fatal(f"register failed {r.status_code}: {r.text[:300]}")
    data = r.json()
    return email, password, data["user"]["user_id"], data["token"]


def auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ─── 1. Auth gate ────────────────────────────────────────────────────
def test_auth_gate() -> None:
    r = requests.delete(f"{API}/account/delete", timeout=15)
    if r.status_code in (401, 403):
        record("1a-no-auth", "PASS", f"DELETE /api/account/delete with no auth → {r.status_code}")
    else:
        record("1a-no-auth", "FAIL", f"Expected 401/403, got {r.status_code}: {r.text[:200]}")

    # Wrong-method probe — endpoint should exist (405) rather than 404
    r2 = requests.get(f"{API}/account/delete", timeout=15)
    if r2.status_code == 405:
        record("1b-wrong-method", "PASS", "GET /api/account/delete → 405 (route exists)")
    elif r2.status_code in (401, 403):
        # FastAPI may run auth dep first; still proves route registered.
        record(
            "1b-wrong-method",
            "PASS",
            f"GET /api/account/delete → {r2.status_code} (route mounted; auth dep ran)",
        )
    else:
        record("1b-wrong-method", "FAIL", f"Expected 405, got {r2.status_code}: {r2.text[:200]}")


# ─── 2. Create-and-delete fresh user ─────────────────────────────────
async def test_create_and_setup() -> Dict[str, Any]:
    email, password, user_id, token = register_user()
    record("2a-register", "PASS", f"Registered fresh user {email} user_id={user_id}")

    # 2b — approved public spot
    pub_spot_body = {
        "title": f"Lady Bird Lake Boardwalk {rand_suffix(4)}",
        "description": "Wooden boardwalk over the lake — best at golden hour.",
        "latitude": 30.2629,
        "longitude": -97.7402,
        "city": "Austin",
        "state": "TX",
        "country": "USA",
        "privacy_mode": "public",
        "shoot_types": ["landscape", "cityscape"],
        "best_light_notes": "Soft warm light 1hr before sunset",
        "sunrise_rating": 4,
        "sunset_rating": 5,
        "land_access": "public",
        "images": [],
    }
    r = requests.post(f"{API}/spots", headers=auth(token), json=pub_spot_body, timeout=30)
    if r.status_code != 200:
        fatal(f"Failed to create public spot: {r.status_code} {r.text[:300]}")
    pub_spot = r.json()
    pub_spot_id = pub_spot["spot_id"]
    pub_vis = pub_spot.get("visibility_status")
    record(
        "2b-create-public",
        "PASS" if pub_spot_id else "FAIL",
        f"Created public spot {pub_spot_id} visibility_status={pub_vis} privacy_mode={pub_spot.get('privacy_mode')}",
    )
    if pub_vis != "approved":
        record(
            "2b-public-needs-approve",
            "INFO",
            f"New spot is '{pub_vis}'; promoting to approved directly in DB for the anonymization test.",
        )

    # 2c — private/draft spot
    draft_body = dict(pub_spot_body)
    draft_body["title"] = f"My Secret Spot {rand_suffix(4)}"
    draft_body["privacy_mode"] = "private"
    draft_body["latitude"] = 30.300
    draft_body["longitude"] = -97.700
    r = requests.post(f"{API}/spots", headers=auth(token), json=draft_body, timeout=30)
    if r.status_code != 200:
        record("2c-create-private", "FAIL", f"{r.status_code} {r.text[:200]}")
        draft_spot_id = None
    else:
        draft = r.json()
        draft_spot_id = draft["spot_id"]
        record(
            "2c-create-private",
            "PASS",
            f"Created private spot {draft_spot_id} visibility_status={draft.get('visibility_status')} "
            f"privacy_mode={draft.get('privacy_mode')}",
        )

    # 2d — save someone else's spot. We'll just save our own to exercise the save coll.
    r = requests.post(f"{API}/spots/{pub_spot_id}/save", headers=auth(token), timeout=15)
    if r.status_code == 200:
        record("2d-save", "PASS", f"POST /spots/{pub_spot_id}/save → {r.json()}")
    else:
        record("2d-save", "FAIL", f"{r.status_code} {r.text[:200]}")

    # 2e — private collection
    r = requests.post(
        f"{API}/collections",
        headers=auth(token),
        json={"name": "My Secret Collection", "description": "trip ideas", "privacy_mode": "private"},
        timeout=15,
    )
    if r.status_code == 200:
        coll = r.json()
        record("2e-private-collection", "PASS", f"Created collection_id={coll.get('collection_id')} privacy={coll.get('privacy_mode')}")
        coll_id = coll.get("collection_id")
    elif r.status_code == 402:
        # Free-plan paywall blocks collection creation via the API; insert
        # one directly so the deletion cascade has a target to clean up.
        record(
            "2e-private-collection",
            "INFO",
            "free plan paywall blocks /collections POST (402) — will inject one via DB for cascade verification",
        )
        coll_id = "col_inj_" + rand_suffix(8)
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            await client[DB_NAME].collections.insert_one({
                "collection_id": coll_id,
                "owner_user_id": user_id,
                "name": "Trip planning ideas",
                "description": "",
                "privacy_mode": "private",
                "spot_ids": [],
                "created_at": "2026-06-01T00:00:00Z",
                "updated_at": "2026-06-01T00:00:00Z",
            })
            record("2e-inject-private-collection", "PASS", f"Injected private collection {coll_id}")
        finally:
            client.close()
    else:
        record("2e-private-collection", "FAIL", f"{r.status_code} {r.text[:200]}")
        coll_id = None

    # 2f — weather alert sub (expected 402 for fresh free user — that's OK)
    r = requests.post(
        f"{API}/weather/alerts/subscribe",
        headers=auth(token),
        json={
            "device_token": "a" * 64,
            "lat": 30.27,
            "lng": -97.74,
            "preferences": {"severe": True},
        },
        timeout=15,
    )
    if r.status_code == 201:
        record("2f-weather-sub", "PASS", "Weather alert sub created (201)")
    elif r.status_code == 402:
        record("2f-weather-sub", "INFO", "402 elite_required — expected for fresh free user")
    else:
        record("2f-weather-sub", "INFO", f"{r.status_code} {r.text[:200]}")

    return {
        "email": email,
        "password": password,
        "user_id": user_id,
        "token": token,
        "public_spot_id": pub_spot_id,
        "public_spot_visibility": pub_vis,
        "draft_spot_id": draft_spot_id,
        "collection_id": coll_id,
    }


# ─── 3. Force-approve the public spot + stash fake stripe sub ───────
async def _db_setup_for_delete(user_id: str, public_spot_id: str) -> None:
    """Force the test user's public spot to visibility_status=approved
    (the create endpoint marks new public spots as pending_review for
    unverified users). Also drop a fake stripe_subscription_id onto the
    user doc to verify the Stripe swallow path."""
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    try:
        # Force approved + public
        r = await db.spots.update_one(
            {"spot_id": public_spot_id},
            {"$set": {"visibility_status": "approved", "privacy_mode": "public"}},
        )
        record("3a-force-approve", "PASS" if r.matched_count else "FAIL",
               f"forced approved on {public_spot_id} matched={r.matched_count}")
        # Inject fake stripe sub
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"stripe_subscription_id": "sub_fake_no_such_thing"}},
        )
        record("3b-fake-stripe", "PASS", "Wrote fake stripe_subscription_id onto user doc")
    finally:
        client.close()


# ─── 4. Actual delete ────────────────────────────────────────────────
def test_delete(token: str) -> Dict[str, Any]:
    log_offset = _backend_log_size()
    r = requests.delete(f"{API}/account/delete", headers=auth(token), timeout=30)
    if r.status_code != 200:
        record("4-delete", "FAIL", f"{r.status_code} {r.text[:300]}")
        return {"ok": False, "log_offset": log_offset}
    body = r.json()
    ok = body.get("success") is True and body.get("message") == "Account deletion completed"
    record(
        "4-delete",
        "PASS" if ok else "FAIL",
        f"DELETE response: {short(body)}",
    )
    return {"ok": ok, "log_offset": log_offset, "body": body}


# ─── 5. Post-delete checks ───────────────────────────────────────────
def test_post_delete(ctx: Dict[str, Any]) -> None:
    token = ctx["token"]
    email = ctx["email"]
    password = ctx["password"]

    # 5a — /auth/me
    r = requests.get(f"{API}/auth/me", headers=auth(token), timeout=15)
    if r.status_code == 401:
        record("5a-me-401", "PASS", "GET /auth/me with deleted JWT → 401")
    else:
        record("5a-me-401", "FAIL", f"Expected 401, got {r.status_code} {r.text[:200]}")

    # 5b — login
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code == 401:
        record("5b-login-401", "PASS", "POST /auth/login with deleted credentials → 401")
    else:
        record("5b-login-401", "FAIL", f"Expected 401, got {r.status_code} {r.text[:200]}")

    # 5c — approved spot still visible w/ placeholder owner
    psid = ctx.get("public_spot_id")
    if psid:
        r = requests.get(f"{API}/spots/{psid}", timeout=20)
        if r.status_code != 200:
            record("5c-public-spot", "FAIL", f"GET /spots/{psid} → {r.status_code} {r.text[:200]}")
        else:
            data = r.json()
            owner = data.get("owner") or {}
            checks = {
                "name=='LumaScout user'": owner.get("name") == "LumaScout user",
                "user_id is None":         owner.get("user_id") is None,
                "deleted is True":         owner.get("deleted") is True,
                "avatar_url is None":      owner.get("avatar_url") is None,
            }
            failed = [k for k, v in checks.items() if not v]
            if not failed:
                record("5c-public-spot", "PASS", f"owner placeholder correct: {short(owner)}")
            else:
                record(
                    "5c-public-spot",
                    "FAIL",
                    f"placeholder mismatch on [{', '.join(failed)}]; owner={short(owner)}",
                )

    # 5d — draft/private spot should be 404
    dsid = ctx.get("draft_spot_id")
    if dsid:
        r = requests.get(f"{API}/spots/{dsid}", timeout=15)
        if r.status_code == 404:
            record("5d-draft-404", "PASS", f"GET /spots/{dsid} → 404 (purged)")
        else:
            record("5d-draft-404", "FAIL", f"Expected 404, got {r.status_code} {r.text[:200]}")


# ─── 6. Direct MongoDB integrity check ───────────────────────────────
async def db_integrity_check(ctx: Dict[str, Any]) -> None:
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    try:
        uid = ctx["user_id"]
        u = await db.users.find_one({"user_id": uid})
        if u is None:
            record("6a-user-deleted", "PASS", "db.users for deleted user_id → None")
        else:
            record("6a-user-deleted", "FAIL", f"db.users still has user_id={uid}: {short(u, 200)}")

        archive = await db.deleted_users.find_one({"original_user_id": uid})
        if archive:
            checks = {
                "reason_code=='user_requested'": archive.get("reason_code") == "user_requested",
                "strategy=='self_service'":      archive.get("strategy") == "self_service",
            }
            failed = [k for k, v in checks.items() if not v]
            if not failed:
                record(
                    "6b-archive",
                    "PASS",
                    f"deleted_users archive present archive_id={archive.get('archive_id')} reason_code/strategy OK",
                )
            else:
                record("6b-archive", "FAIL", f"archive fields wrong [{', '.join(failed)}]: {short(archive,260)}")
        else:
            record("6b-archive", "FAIL", "deleted_users archive row missing")

        saves = await db.spot_saves.count_documents({"user_id": uid})
        record("6c-saves" + (" PASS" if False else ""), "PASS" if saves == 0 else "FAIL", f"spot_saves count={saves}")

        pcols = await db.collections.count_documents({"owner_user_id": uid, "privacy_mode": "private"})
        record(
            "6d-private-collections",
            "PASS" if pcols == 0 else "FAIL",
            f"private collections count={pcols}",
        )

        anon_pub_spots = await db.spots.count_documents({
            "owner_user_id": uid,
            "visibility_status": "approved",
            "privacy_mode": "public",
        })
        anon_with_flag = await db.spots.count_documents({
            "owner_user_id": uid,
            "visibility_status": "approved",
            "privacy_mode": "public",
            "creator_anonymized": True,
        })
        if anon_pub_spots > 0 and anon_with_flag == anon_pub_spots:
            record(
                "6e-anon-spots",
                "PASS",
                f"preserved approved/public spots={anon_pub_spots}, all have creator_anonymized=True",
            )
        else:
            record(
                "6e-anon-spots",
                "FAIL",
                f"approved/public spots={anon_pub_spots}, with-flag={anon_with_flag}",
            )

        # Sample the surviving spot doc & list its anonymization fields
        sample = await db.spots.find_one(
            {"owner_user_id": uid, "creator_anonymized": True},
            {
                "_id": 0, "spot_id": 1, "title": 1, "creator_anonymized": 1,
                "creator_deleted": 1, "creator_display_name": 1,
                "creator_avatar_url": 1, "creator_username": 1,
            },
        )
        record("6e-sample", "INFO", f"sample anonymized spot doc: {short(sample, 300)}")

        # Should be no other spots owned by uid
        leftover = await db.spots.count_documents({
            "owner_user_id": uid,
            "$or": [
                {"visibility_status": {"$ne": "approved"}},
                {"privacy_mode": {"$ne": "public"}},
            ],
        })
        record(
            "6f-purged-spots",
            "PASS" if leftover == 0 else "FAIL",
            f"non-approved-public spots remaining for uid={leftover}",
        )

        # Other cascading collections — sanity
        for coll in ("push_tokens", "weather_alert_subscriptions", "notifications", "follows", "shoot_plans"):
            n = await db[coll].count_documents({"user_id": uid}) if coll != "follows" \
                else await db[coll].count_documents({"$or": [{"follower_user_id": uid}, {"followed_user_id": uid}]})
            record(f"6g-{coll}", "PASS" if n == 0 else "FAIL", f"{coll} count={n}")

    finally:
        client.close()


# ─── 7. Idempotency ──────────────────────────────────────────────────
def test_idempotency(token: str) -> None:
    r = requests.delete(f"{API}/account/delete", headers=auth(token), timeout=15)
    # Acceptable: 401 (deleted user blocked at auth dep) OR 200 (handler guard fires)
    if r.status_code in (200, 401):
        record(
            "7-idempotent",
            "PASS",
            f"second DELETE with deleted-JWT → {r.status_code} (no 5xx) body={short(r.text, 200)}",
        )
    else:
        record(
            "7-idempotent",
            "FAIL",
            f"second DELETE returned {r.status_code} (should be 200 or 401): {r.text[:300]}",
        )


def test_idempotency_forged() -> None:
    """Hand-forge a JWT for a non-existent user_id; expect 401."""
    try:
        import jwt as pyjwt
    except Exception:
        record("7b-forged", "INFO", "PyJWT not available — skip forged-token bonus")
        return
    secret_path = Path("/app/backend/.env")
    secret = None
    for line in secret_path.read_text().splitlines():
        if line.startswith("JWT_SECRET="):
            secret = line.split("=", 1)[1].strip().strip('"')
    if not secret:
        record("7b-forged", "INFO", "JWT_SECRET not found — skipping")
        return
    payload = {
        "sub": f"user_ghost_{rand_suffix(8)}",
        "email": "ghost@example.test",
        "exp": int(time.time()) + 600,
    }
    tok = pyjwt.encode(payload, secret, algorithm="HS256")
    r = requests.delete(f"{API}/account/delete", headers=auth(tok), timeout=15)
    if r.status_code == 401:
        record("7b-forged", "PASS", "DELETE with forged-ghost JWT → 401 (auth layer rejects unknown user)")
    elif r.status_code == 200:
        # The handler's idempotency guard fired (live is None). Also fine per the brief.
        record("7b-forged", "PASS", f"DELETE with forged-ghost JWT → 200 (handler idempotency guard) body={short(r.text,200)}")
    else:
        record("7b-forged", "FAIL", f"Expected 401 or 200, got {r.status_code}: {r.text[:200]}")


# ─── 8. Log tail ─────────────────────────────────────────────────────
LOG_PATH = "/var/log/supervisor/backend.err.log"


def _backend_log_size() -> int:
    try:
        return os.path.getsize(LOG_PATH)
    except OSError:
        return 0


def test_log_tail(user_id: str, offset: int) -> None:
    if not os.path.exists(LOG_PATH):
        record("8-logs", "INFO", f"{LOG_PATH} missing — skip log tail check")
        return
    try:
        with open(LOG_PATH, "rb") as fh:
            fh.seek(max(0, offset - 4096))
            blob = fh.read().decode("utf-8", errors="replace")
    except Exception as e:
        record("8-logs", "INFO", f"could not read log: {e!r}")
        return

    saw_start = bool(re.search(rf"account_delete_start.*user_id={re.escape(user_id)}", blob))
    saw_complete = bool(re.search(rf"account_delete_complete.*user_id={re.escape(user_id)}", blob))
    saw_archive = "archive_id=" in blob
    saw_stripe_fail = bool(re.search(rf"account_delete_stripe_cancel_failed.*user_id={re.escape(user_id)}", blob))

    record("8a-start-log", "PASS" if saw_start else "FAIL", "found account_delete_start" if saw_start else "missing account_delete_start log line")
    record(
        "8b-complete-log",
        "PASS" if (saw_complete and saw_archive) else "FAIL",
        ("found account_delete_complete with archive_id=" if (saw_complete and saw_archive)
         else f"complete_seen={saw_complete} archive_id_in_log={saw_archive}"),
    )
    record(
        "8c-stripe-swallow-log",
        "PASS" if saw_stripe_fail else "FAIL",
        "found account_delete_stripe_cancel_failed" if saw_stripe_fail
        else "Expected stripe-swallow log line missing (fake sub should have failed)",
    )

    # PII leak scan — must NOT contain the test email/name in the relevant block
    # The user_id slice is short — broaden to whole tail.
    leaks: list[str] = []
    if "acctdel_test_" in blob and "@lumascout.test" in blob:
        leaks.append("email")
    if "Account Delete Test" in blob:
        leaks.append("name")
    # Look for any obvious Stripe secret leak in the log
    if re.search(r"sk_(live|test)_[A-Za-z0-9]{8,}", blob):
        leaks.append("stripe_secret")
    record(
        "8d-pii-scan",
        "PASS" if not leaks else "FAIL",
        "no PII fragments found in tail" if not leaks else f"PII leak suspects: {leaks}",
    )


# ─── Driver ──────────────────────────────────────────────────────────
async def main() -> int:
    print(f"BASE = {BASE}")
    print(f"MONGO_URL = {MONGO_URL}  DB_NAME = {DB_NAME}")

    test_auth_gate()
    ctx = await test_create_and_setup()

    if ctx.get("public_spot_id"):
        await _db_setup_for_delete(ctx["user_id"], ctx["public_spot_id"])

    delete_result = test_delete(ctx["token"])
    ctx["log_offset"] = delete_result.get("log_offset", 0)

    test_post_delete(ctx)
    await db_integrity_check(ctx)
    test_idempotency(ctx["token"])
    test_idempotency_forged()

    # Give supervisor a moment to flush
    time.sleep(0.5)
    test_log_tail(ctx["user_id"], ctx["log_offset"])

    print_summary()
    return 1 if any(r[1] == "FAIL" for r in RESULTS) else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
