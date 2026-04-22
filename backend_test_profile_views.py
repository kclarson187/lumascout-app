"""Phase B.1 — Who Viewed Your Profile Backend QA

Tests:
  - Side-effect view tracking on GET /api/users/{user_id}
  - GET /api/me/viewers (free/pro/elite tier gating, analytics)
  - GET /api/me/viewers/summary

Uses REAL Mongo + REAL backend at http://localhost:8001/api.
Auth via credentials from /app/memory/test_credentials.md:
  - admin@lumascout.app / admin123   (super_admin, plan=elite)
  - sophie@lumascout.app / demo123   (plan=pro, verified)
  - marco@lumascout.app  / demo123   (plan=free, verified)
  - priya@lumascout.app  / demo123   (plan=free)
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

BASE = "http://localhost:8001/api"

PASS: list[str] = []
FAIL: list[str] = []


def ok(label: str, cond: bool, detail: str = "") -> bool:
    if cond:
        PASS.append(label)
        print(f"  PASS  {label}")
    else:
        FAIL.append(f"{label} — {detail}")
        print(f"  FAIL  {label}  ::  {detail}")
    return cond


def login(email: str, password: str) -> dict:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    r.raise_for_status()
    j = r.json()
    return {"token": j["token"], "user_id": j["user"]["user_id"], "user": j["user"]}


def h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def mongo():
    from motor.motor_asyncio import AsyncIOMotorClient
    cli = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    return cli, cli[os.environ.get("DB_NAME", "photoscout_database")]


async def main():
    print("\n=== Phase B.1 — Profile Views QA ===\n")

    # --- Logins
    print("[setup] Logging in admin/sophie/marco/priya ...")
    admin = login("admin@lumascout.app", "admin123")
    sophie = login("sophie@lumascout.app", "demo123")
    marco = login("marco@lumascout.app", "demo123")
    priya = login("priya@lumascout.app", "demo123")
    ok("setup: all 4 logins succeeded", all(u["token"] for u in [admin, sophie, marco, priya]))

    cli, db = await mongo()

    # Wipe any prior profile_views rows involving these 4 users so the test is deterministic.
    uids = [admin["user_id"], sophie["user_id"], marco["user_id"], priya["user_id"]]
    await db.profile_views.delete_many({
        "$or": [
            {"viewer_user_id": {"$in": uids}},
            {"viewed_user_id": {"$in": uids}},
        ]
    })
    baseline = await db.profile_views.count_documents({"viewed_user_id": admin["user_id"]})
    ok("setup: baseline profile_views for admin == 0", baseline == 0, f"baseline={baseline}")

    # ----------------------------------------------------------------
    # 2) Self-view ignored
    # ----------------------------------------------------------------
    print("\n[2] Self-view ignored")
    r = requests.get(f"{BASE}/users/{admin['user_id']}", headers=h(admin["token"]), timeout=15)
    ok("2a: admin GET /users/{admin_id} returns 200", r.status_code == 200, f"status={r.status_code}")
    count = await db.profile_views.count_documents({
        "viewer_user_id": admin["user_id"], "viewed_user_id": admin["user_id"]
    })
    ok("2b: NO profile_views row for (admin, admin) self-view", count == 0, f"count={count}")

    # ----------------------------------------------------------------
    # 3) Unauth view ignored
    # ----------------------------------------------------------------
    print("\n[3] Unauth view ignored")
    r = requests.get(f"{BASE}/users/{admin['user_id']}", timeout=15)  # no header
    ok("3a: anon GET /users/{admin_id} returns 200", r.status_code == 200, f"status={r.status_code}")
    count = await db.profile_views.count_documents({"viewed_user_id": admin["user_id"]})
    ok("3b: NO profile_views row created for anon view", count == 0, f"count={count}")

    # ----------------------------------------------------------------
    # 4) Basic record — sophie views admin
    # ----------------------------------------------------------------
    print("\n[4] Basic record: sophie views admin")
    r = requests.get(f"{BASE}/users/{admin['user_id']}", headers=h(sophie["token"]), timeout=15)
    ok("4a: sophie GET /users/{admin_id} returns 200", r.status_code == 200, f"status={r.status_code}")
    await asyncio.sleep(0.3)
    row = await db.profile_views.find_one({
        "viewer_user_id": sophie["user_id"], "viewed_user_id": admin["user_id"]
    })
    ok("4b: 1 row created (sophie→admin)", row is not None, "row missing")
    if row:
        ok("4c: count == 1", int(row.get("count", 0)) == 1, f"count={row.get('count')}")
        ok("4d: viewer_plan == 'pro'", row.get("viewer_plan") == "pro", f"plan={row.get('viewer_plan')}")
        ok("4e: viewer_city == 'Austin'", row.get("viewer_city") == "Austin", f"city={row.get('viewer_city')}")
        for k in ("view_id", "viewer_user_id", "viewed_user_id", "viewer_city", "viewer_state",
                  "viewer_country", "viewer_plan", "viewer_specialties",
                  "first_viewed_at", "last_viewed_at", "count"):
            ok(f"4f: row has key '{k}'", k in row)

    # ----------------------------------------------------------------
    # 5) 1h dedupe — second sophie view within window → same row, count=2
    # ----------------------------------------------------------------
    print("\n[5] 1h dedupe: second sophie view within window")
    prev = await db.profile_views.find_one({
        "viewer_user_id": sophie["user_id"], "viewed_user_id": admin["user_id"]
    })
    prev_last = prev.get("last_viewed_at") if prev else None
    rows_before = await db.profile_views.count_documents({
        "viewer_user_id": sophie["user_id"], "viewed_user_id": admin["user_id"]
    })
    await asyncio.sleep(1.1)  # ensure last_viewed_at changes
    r = requests.get(f"{BASE}/users/{admin['user_id']}", headers=h(sophie["token"]), timeout=15)
    ok("5a: sophie 2nd GET /users/{admin_id} returns 200", r.status_code == 200)
    await asyncio.sleep(0.3)
    rows_after = await db.profile_views.count_documents({
        "viewer_user_id": sophie["user_id"], "viewed_user_id": admin["user_id"]
    })
    ok("5b: no new row (still 1 row for sophie→admin)", rows_after == rows_before == 1,
       f"before={rows_before} after={rows_after}")
    after = await db.profile_views.find_one({
        "viewer_user_id": sophie["user_id"], "viewed_user_id": admin["user_id"]
    })
    ok("5c: count incremented to 2", int(after.get("count", 0)) == 2, f"count={after.get('count')}")
    # last_viewed_at bumped
    if prev_last and after.get("last_viewed_at"):
        bumped = after["last_viewed_at"] > prev_last
        ok("5d: last_viewed_at bumped", bumped,
           f"prev={prev_last} after={after['last_viewed_at']}")

    # ----------------------------------------------------------------
    # 6) Multi-viewer — marco views admin → 2nd distinct row
    # ----------------------------------------------------------------
    print("\n[6] Multi-viewer: marco views admin")
    r = requests.get(f"{BASE}/users/{admin['user_id']}", headers=h(marco["token"]), timeout=15)
    ok("6a: marco GET /users/{admin_id} returns 200", r.status_code == 200)
    await asyncio.sleep(0.3)
    total = await db.profile_views.count_documents({"viewed_user_id": admin["user_id"]})
    ok("6b: admin now has 2 distinct profile_views rows", total == 2, f"total={total}")
    marco_row = await db.profile_views.find_one({
        "viewer_user_id": marco["user_id"], "viewed_user_id": admin["user_id"]
    })
    ok("6c: marco's row exists with viewer_plan='free'",
       marco_row is not None and marco_row.get("viewer_plan") == "free",
       f"row={bool(marco_row)} plan={(marco_row or {}).get('viewer_plan')}")

    # Also: priya views sophie so sophie (pro tier) has something in her list
    requests.get(f"{BASE}/users/{sophie['user_id']}", headers=h(priya["token"]), timeout=15)
    requests.get(f"{BASE}/users/{sophie['user_id']}", headers=h(marco["token"]), timeout=15)
    # marco viewed admin from scenario 6, plus sophie & priya viewing admin
    # Let priya also view admin to round things out
    requests.get(f"{BASE}/users/{admin['user_id']}", headers=h(priya["token"]), timeout=15)
    await asyncio.sleep(0.3)

    # ----------------------------------------------------------------
    # 7) Free-tier teaser shape — marco /me/viewers
    # ----------------------------------------------------------------
    print("\n[7] Free-tier (marco) /me/viewers teaser shape")
    # First, ensure marco has some viewers himself. Let sophie view marco
    requests.get(f"{BASE}/users/{marco['user_id']}", headers=h(sophie["token"]), timeout=15)
    requests.get(f"{BASE}/users/{marco['user_id']}", headers=h(priya["token"]), timeout=15)
    await asyncio.sleep(0.3)
    r = requests.get(f"{BASE}/me/viewers", headers=h(marco["token"]), timeout=15)
    ok("7a: marco /me/viewers returns 200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
    body = r.json()
    ok("7b: plan == 'free'", body.get("plan") == "free", f"plan={body.get('plan')}")
    ok("7c: viewers is []", body.get("viewers") == [], f"viewers={body.get('viewers')}")
    ok("7d: total_views present and int", isinstance(body.get("total_views"), int))
    ok("7e: total_impressions present and int", isinstance(body.get("total_impressions"), int))
    ok("7f: period_days == 30 (default)", body.get("period_days") == 30, f"period_days={body.get('period_days')}")
    t = body.get("teaser")
    ok("7g: teaser present (dict)", isinstance(t, dict), f"teaser={t}")
    if isinstance(t, dict):
        ok("7h: teaser.blurred_avatars is list", isinstance(t.get("blurred_avatars"), list))
        ok("7i: teaser.blurred_initials is list", isinstance(t.get("blurred_initials"), list))
        ok("7j: teaser.message is str", isinstance(t.get("message"), str))
    ok("7k: no 'analytics' key on free response", "analytics" not in body)

    # ----------------------------------------------------------------
    # 8) Pro-tier full shape — sophie /me/viewers
    # ----------------------------------------------------------------
    print("\n[8] Pro-tier (sophie) /me/viewers full shape")
    r = requests.get(f"{BASE}/me/viewers", headers=h(sophie["token"]), timeout=15)
    ok("8a: sophie /me/viewers returns 200", r.status_code == 200, f"status={r.status_code}")
    body = r.json()
    ok("8b: plan == 'pro'", body.get("plan") == "pro", f"plan={body.get('plan')}")
    viewers = body.get("viewers")
    ok("8c: viewers is non-empty list", isinstance(viewers, list) and len(viewers) > 0,
       f"viewers len={len(viewers) if isinstance(viewers, list) else 'NA'}")
    ok("8d: no 'teaser' key on pro response", "teaser" not in body)
    ok("8e: no 'analytics' key on pro response", "analytics" not in body)
    required_keys = ["user_id", "name", "username", "avatar_url", "city", "state", "specialties",
                     "verification_status", "plan", "last_viewed_at", "view_count", "is_following"]
    if isinstance(viewers, list) and viewers:
        for k in required_keys:
            ok(f"8f: first viewer has key '{k}'", k in viewers[0], f"keys={list(viewers[0].keys())}")
        # NO password_hash/email leak
        flat_str = str(viewers)
        ok("8g: no 'password_hash' leak in viewers", "password_hash" not in flat_str)
        ok("8h: no 'email' leak in viewers",
           all("email" not in v for v in viewers),
           "one viewer has 'email' key")

    # ----------------------------------------------------------------
    # 9) Elite-tier analytics — admin /me/viewers
    # ----------------------------------------------------------------
    print("\n[9] Elite-tier (admin) /me/viewers analytics")
    r = requests.get(f"{BASE}/me/viewers", headers=h(admin["token"]), timeout=15)
    ok("9a: admin /me/viewers returns 200", r.status_code == 200, f"status={r.status_code}")
    body = r.json()
    ok("9b: plan == 'elite'", body.get("plan") == "elite", f"plan={body.get('plan')}")
    viewers = body.get("viewers")
    ok("9c: viewers is non-empty list", isinstance(viewers, list) and len(viewers) > 0,
       f"len={len(viewers) if isinstance(viewers, list) else 'NA'}")
    ok("9d: no 'teaser' on elite response", "teaser" not in body)
    analytics = body.get("analytics")
    ok("9e: analytics is dict", isinstance(analytics, dict))
    if isinstance(analytics, dict):
        ok("9f: analytics has 'top_cities' list", isinstance(analytics.get("top_cities"), list))
        ok("9g: top_cities length <= 5", len(analytics.get("top_cities", [])) <= 5,
           f"len={len(analytics.get('top_cities', []))}")
        tc = analytics.get("top_cities") or []
        if tc:
            ok("9h: top_cities items have {city, views}",
               all("city" in x and "views" in x for x in tc),
               f"first={tc[0]}")
        ok("9i: analytics has 'top_specialties' list",
           isinstance(analytics.get("top_specialties"), list))
        ok("9j: top_specialties length <= 5", len(analytics.get("top_specialties", [])) <= 5)
        ts = analytics.get("top_specialties") or []
        if ts:
            ok("9k: top_specialties items have {specialty, viewers}",
               all("specialty" in x and "viewers" in x for x in ts),
               f"first={ts[0]}")
        ok("9l: analytics.repeat_viewers is int",
           isinstance(analytics.get("repeat_viewers"), int),
           f"val={analytics.get('repeat_viewers')}")
        trend = analytics.get("trend_7d")
        ok("9m: trend_7d is list", isinstance(trend, list))
        ok("9n: trend_7d has exactly 7 items",
           isinstance(trend, list) and len(trend) == 7,
           f"len={len(trend) if isinstance(trend, list) else 'NA'}")
        if isinstance(trend, list) and len(trend) == 7:
            # Each item has {date, views}
            ok("9o: every trend item has 'date' and 'views'",
               all("date" in x and "views" in x for x in trend),
               f"first={trend[0]}")
            # Ascending order (oldest first)
            dates = [x["date"] for x in trend]
            ok("9p: dates ascending (oldest first)",
               dates == sorted(dates),
               f"dates={dates}")
            # Last date == today (UTC)
            today_iso = datetime.now(timezone.utc).date().isoformat()
            ok("9q: last trend date == today (UTC)",
               dates[-1] == today_iso,
               f"last={dates[-1]} expected={today_iso}")

    # ----------------------------------------------------------------
    # 10) Summary endpoint
    # ----------------------------------------------------------------
    print("\n[10] /me/viewers/summary for admin/sophie/marco")
    r = requests.get(f"{BASE}/me/viewers/summary", headers=h(admin["token"]), timeout=15)
    ok("10a: admin summary returns 200", r.status_code == 200)
    s = r.json()
    ok("10b: admin summary has total_7d, total_30d, plan",
       all(k in s for k in ("total_7d", "total_30d", "plan")),
       f"keys={list(s.keys())}")
    ok("10c: admin summary plan == 'elite'", s.get("plan") == "elite", f"plan={s.get('plan')}")
    ok("10d: admin summary total_7d is int", isinstance(s.get("total_7d"), int))
    ok("10e: admin summary total_30d is int", isinstance(s.get("total_30d"), int))

    r = requests.get(f"{BASE}/me/viewers/summary", headers=h(sophie["token"]), timeout=15)
    ok("10f: sophie summary returns 200", r.status_code == 200)
    ok("10g: sophie summary plan == 'pro'", r.json().get("plan") == "pro")

    r = requests.get(f"{BASE}/me/viewers/summary", headers=h(marco["token"]), timeout=15)
    ok("10h: marco summary returns 200", r.status_code == 200)
    ok("10i: marco summary plan == 'free'", r.json().get("plan") == "free")

    # ----------------------------------------------------------------
    # 11) Auth gates — both endpoints without Authorization → 401
    # ----------------------------------------------------------------
    print("\n[11] Auth gates")
    r = requests.get(f"{BASE}/me/viewers", timeout=15)
    ok("11a: /me/viewers no auth → 401", r.status_code == 401, f"status={r.status_code}")
    r = requests.get(f"{BASE}/me/viewers/summary", timeout=15)
    ok("11b: /me/viewers/summary no auth → 401", r.status_code == 401, f"status={r.status_code}")

    # ----------------------------------------------------------------
    # 12) Param clamping
    # ----------------------------------------------------------------
    print("\n[12] Param clamping")
    r = requests.get(f"{BASE}/me/viewers?since_days=9999", headers=h(admin["token"]), timeout=15)
    ok("12a: since_days=9999 returns 200 (clamped to 90)", r.status_code == 200,
       f"status={r.status_code}")
    r = requests.get(f"{BASE}/me/viewers?limit=-5", headers=h(admin["token"]), timeout=15)
    ok("12b: limit=-5 returns 200 (clamped to 1)", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        ok("12c: limit=-5 yields <= 1 viewer", len(r.json().get("viewers", [])) <= 1)
    r = requests.get(f"{BASE}/me/viewers?limit=0", headers=h(admin["token"]), timeout=15)
    ok("12d: limit=0 returns 200 (clamped to 1)", r.status_code == 200, f"status={r.status_code}")

    # ----------------------------------------------------------------
    # 13) Cross-user leak — admin /me/viewers should only contain admin's viewers
    # ----------------------------------------------------------------
    print("\n[13] Cross-user leak check")
    r = requests.get(f"{BASE}/me/viewers", headers=h(admin["token"]), timeout=15)
    body = r.json()
    viewer_ids = {v.get("user_id") for v in body.get("viewers", [])}
    admin_actual_viewer_ids = set()
    async for row in db.profile_views.find({"viewed_user_id": admin["user_id"]}):
        admin_actual_viewer_ids.add(row["viewer_user_id"])
    ok("13a: admin /me/viewers contains only admin's own viewers",
       viewer_ids == admin_actual_viewer_ids,
       f"response={viewer_ids} db={admin_actual_viewer_ids}")

    # Additionally — admin should NOT see viewers from sophie's audience
    sophie_viewer_ids = set()
    async for row in db.profile_views.find({"viewed_user_id": sophie["user_id"]}):
        sophie_viewer_ids.add(row["viewer_user_id"])
    leak = viewer_ids & (sophie_viewer_ids - admin_actual_viewer_ids)
    ok("13b: no leak of sophie's unique viewers into admin's list", not leak,
       f"leak={leak}")

    # ----------------------------------------------------------------
    # Never-500 invariant: profile_views write fail must not break /users/{id}
    # (Indirectly validated — all /users/{id} calls above returned 200)
    # ----------------------------------------------------------------
    print("\n[14] /users/{id} never 500s even if profile_views write fails")
    r = requests.get(f"{BASE}/users/{admin['user_id']}", headers=h(sophie["token"]), timeout=15)
    ok("14a: /users/{id} returns 200 (not 5xx) under normal view-tracking", r.status_code == 200,
       f"status={r.status_code}")

    # ----------------------------------------------------------------
    # Summary
    # ----------------------------------------------------------------
    print("\n=== RESULTS ===")
    print(f"PASS: {len(PASS)}")
    print(f"FAIL: {len(FAIL)}")
    if FAIL:
        print("\nFailed assertions:")
        for f in FAIL:
            print(f"  - {f}")
    cli.close()
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
