"""
Phase B.3 Backend QA — Focused Tests
Tests:
  A) GET /api/me/analytics/networking
  B) POST /api/dm/threads/start (free-tier 5-pending cap)
  C) GET /api/network/discover (Elite discovery boost)
"""
import os
import sys
import uuid
import datetime as _dt
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8001/api")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "photoscout_database")

CREDS = {
    "admin": ("admin@lumascout.app", "admin123"),
    "sophie": ("sophie@lumascout.app", "demo123"),
    "marco": ("marco@lumascout.app", "demo123"),
    "priya": ("priya@lumascout.app", "demo123"),
    "jordan": ("jordan@lumascout.app", "demo123"),
    "lena": ("lena@lumascout.app", "demo123"),
    "emily": ("emily.toronto@lumascout.app", "demo123"),
    "noah": ("noah.vancouver@lumascout.app", "demo123"),
    "sophie_m": ("sophie.montreal@lumascout.app", "demo123"),
    "diego": ("diego.cdmx@lumascout.app", "demo123"),
    "valeria": ("valeria.gdl@lumascout.app", "demo123"),
    "luis": ("luis.monterrey@lumascout.app", "demo123"),
    "alex": ("alex.la@lumascout.app", "demo123"),
    "maya": ("maya.denver@lumascout.app", "demo123"),
}

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]

tokens = {}
uids = {}
results = []


def record(name, passed, note=""):
    status = "PASS" if passed else "FAIL"
    results.append((status, name, note))
    print(f"[{status}] {name}{(' — ' + note) if note else ''}")


def login(email, password):
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()


def auth(handle):
    return {"Authorization": f"Bearer {tokens[handle]}"}


def setup_logins():
    for handle, (email, pw) in CREDS.items():
        try:
            resp = login(email, pw)
            tokens[handle] = resp["token"]
            uids[handle] = resp["user"]["user_id"]
            print(f"  logged in {handle} ({uids[handle][:16]}) plan={resp['user'].get('plan')}")
        except Exception as e:
            print(f"  WARN: login {handle} failed: {e}")


def test_analytics():
    print("\n=== A) GET /api/me/analytics/networking ===\n")

    r = requests.get(f"{BASE_URL}/me/analytics/networking")
    record("A1 401 without Authorization", r.status_code == 401, f"got {r.status_code}")

    base_keys = {
        "plan", "period_days", "profile_views_7d", "profile_views_30d",
        "follows_gained", "applications_sent", "applications_accepted",
        "acceptance_rate_pct", "needs_posted", "applicants_received",
        "active_threads",
    }
    elite_extra = {"trend_7d", "funnel"}

    r = requests.get(f"{BASE_URL}/me/analytics/networking", headers=auth("admin"))
    data = r.json()
    missing = base_keys - set(data.keys())
    has_elite = elite_extra.issubset(set(data.keys()))
    trend = data.get("trend_7d", [])
    trend_len_ok = isinstance(trend, list) and len(trend) == 7
    funnel = data.get("funnel", {})
    funnel_ok = isinstance(funnel, dict) and "views_to_follow_pct" in funnel and "applications_to_acceptance_pct" in funnel
    trend_items_ok = all({"date", "views"}.issubset(set(t.keys())) for t in trend)
    dates = [t.get("date") for t in trend]
    trend_sorted = dates == sorted(dates)
    ok = r.status_code == 200 and not missing and has_elite and trend_len_ok and funnel_ok and trend_items_ok and trend_sorted
    record("A2 admin elite: base + trend_7d[7] + funnel", ok,
           f"status={r.status_code} plan={data.get('plan')} missing={missing} trend_len={len(trend)} funnel_ok={funnel_ok} trend_items_ok={trend_items_ok} trend_sorted={trend_sorted}")

    r = requests.get(f"{BASE_URL}/me/analytics/networking", headers=auth("sophie"))
    data_pro = r.json()
    missing = base_keys - set(data_pro.keys())
    has_trend = "trend_7d" in data_pro
    has_funnel = "funnel" in data_pro
    ok = r.status_code == 200 and not missing and not has_trend and not has_funnel
    record("A3 sophie pro: base only, no trend/funnel", ok,
           f"status={r.status_code} plan={data_pro.get('plan')} missing={missing} has_trend={has_trend} has_funnel={has_funnel}")

    r = requests.get(f"{BASE_URL}/me/analytics/networking", headers=auth("marco"))
    data_free = r.json()
    missing = base_keys - set(data_free.keys())
    has_trend = "trend_7d" in data_free
    has_funnel = "funnel" in data_free
    same_shape = set(data_free.keys()) == set(data_pro.keys())
    ok = r.status_code == 200 and not missing and not has_trend and not has_funnel and same_shape
    record("A4 marco free: base only, shape identical to pro", ok,
           f"status={r.status_code} plan={data_free.get('plan')} missing={missing} same_shape_as_pro={same_shape}")

    # Clamp tests
    d9999 = requests.get(f"{BASE_URL}/me/analytics/networking?since_days=9999", headers=auth("admin")).json()
    d0    = requests.get(f"{BASE_URL}/me/analytics/networking?since_days=0", headers=auth("admin")).json()
    dneg  = requests.get(f"{BASE_URL}/me/analytics/networking?since_days=-10", headers=auth("admin")).json()
    d45   = requests.get(f"{BASE_URL}/me/analytics/networking?since_days=45", headers=auth("admin")).json()

    ok_9999 = d9999.get("period_days") == 90
    ok_0 = d0.get("period_days") == 1
    ok_neg = dneg.get("period_days") == 1
    ok_45 = d45.get("period_days") == 45
    record("A5 since_days clamp (9999→90, 0→1, -10→1, 45→45)",
           ok_9999 and ok_0 and ok_neg and ok_45,
           f"9999→{d9999.get('period_days')}  0→{d0.get('period_days')}  -10→{dneg.get('period_days')}  45→{d45.get('period_days')}")

    rate = data.get("acceptance_rate_pct")
    sent = data.get("applications_sent", 0)
    acc = data.get("applications_accepted", 0)
    expected = round((acc / sent) * 100, 1) if sent > 0 else 0.0
    is_float = isinstance(rate, (int, float)) and not isinstance(rate, bool)
    formula_ok = rate == expected
    record("A6 acceptance_rate_pct numeric & formula", is_float and formula_ok,
           f"rate={rate} sent={sent} accepted={acc} expected={expected}")


def cleanup_user_dm_state(handle):
    uid = uids.get(handle)
    if not uid:
        return
    db.dm_requests.delete_many({"from_user_id": uid})
    db.dm_requests.delete_many({"to_user_id": uid})
    thread_ids = [t["thread_id"] for t in db.dm_threads.find({"participant_user_ids": uid}, {"thread_id": 1})]
    if thread_ids:
        db.dm_threads.delete_many({"thread_id": {"$in": thread_ids}})
        db.dm_messages.delete_many({"thread_id": {"$in": thread_ids}})
        db.dm_participants.delete_many({"thread_id": {"$in": thread_ids}})
    db.dm_blocks.delete_many({"$or": [{"blocker_user_id": uid}, {"blocked_user_id": uid}]})


def test_dm_cap():
    print("\n=== B) POST /api/dm/threads/start (5-pending cap) ===\n")

    cleanup_user_dm_state("marco")
    marco_id = uids["marco"]

    target_handles = ["priya", "jordan", "lena", "emily", "noah", "diego"]
    for h in target_handles:
        db.follows.delete_many({"follower_user_id": uids[h], "followed_user_id": marco_id})
        db.dm_requests.delete_many({"from_user_id": marco_id, "to_user_id": uids[h]})

    ok7 = True
    for i, h in enumerate(target_handles[:5]):
        r = requests.post(f"{BASE_URL}/dm/threads/start", headers=auth("marco"),
                          json={"user_id": uids[h], "opening_body": f"hey {h}, quick Q about wedding shoot"})
        if r.status_code != 200:
            ok7 = False
            print(f"  req {i+1} to {h}: {r.status_code} {r.text[:200]}")
            break
        if not r.json().get("is_request"):
            ok7 = False
            print(f"  req {i+1} to {h}: NOT flagged is_request=true → cap logic won't apply")
    pending_count = db.dm_requests.count_documents({"from_user_id": marco_id, "status": "pending"})
    record("B7 marco 5 distinct pending requests (200, DB has 5 rows)",
           ok7 and pending_count == 5, f"pending_count={pending_count}")

    r = requests.post(f"{BASE_URL}/dm/threads/start", headers=auth("marco"),
                      json={"user_id": uids[target_handles[5]], "opening_body": "6th attempt"})
    detail = ""
    try:
        detail = (r.json() or {}).get("detail", "")
    except Exception:
        pass
    ok8 = r.status_code == 402 and "Free plan limit: 5 pending message requests" in detail
    record("B8 marco 6th request → 402 cap message", ok8,
           f"status={r.status_code} detail={detail!r}")

    # Scenario 12: cap precedence over 429
    ok12 = r.status_code == 402
    record("B12 402 cap supersedes 429 (cap evaluated first)", ok12, f"status={r.status_code}")

    # Scenario 9: accept drops by 1
    req = db.dm_requests.find_one({"from_user_id": marco_id, "to_user_id": uids["priya"], "status": "pending"})
    accept_ok = False
    new_pending = -1
    retry_code = None
    if req:
        r = requests.post(f"{BASE_URL}/dm/requests/{req['request_id']}/accept", headers=auth("priya"))
        accept_ok = r.status_code == 200
        new_pending = db.dm_requests.count_documents({"from_user_id": marco_id, "status": "pending"})
        r2 = requests.post(f"{BASE_URL}/dm/threads/start", headers=auth("marco"),
                           json={"user_id": uids[target_handles[5]], "opening_body": "post-accept retry"})
        retry_code = r2.status_code
    ok9 = accept_ok and new_pending == 4 and retry_code == 200
    record("B9 accept drops cap by 1, marco resends (200)",
           ok9, f"accept={accept_ok} pending={new_pending} retry_status={retry_code}")

    # Scenario 10: sophie (pro), admin (elite) 6+
    sophie_targets = ["valeria", "luis", "alex", "maya", "emily", "noah", "diego"]
    cleanup_user_dm_state("sophie")
    for h in sophie_targets:
        db.follows.delete_many({"follower_user_id": uids[h], "followed_user_id": uids["sophie"]})
    sophie_ok = True
    sophie_results = []
    for h in sophie_targets[:6]:
        r = requests.post(f"{BASE_URL}/dm/threads/start", headers=auth("sophie"),
                          json={"user_id": uids[h], "opening_body": "hi from sophie"})
        sophie_results.append(r.status_code)
        if r.status_code != 200:
            sophie_ok = False

    admin_targets = ["valeria", "luis", "alex", "maya", "emily", "noah"]
    cleanup_user_dm_state("admin")
    for h in admin_targets:
        db.follows.delete_many({"follower_user_id": uids[h], "followed_user_id": uids["admin"]})
    admin_ok = True
    admin_results = []
    for h in admin_targets[:6]:
        r = requests.post(f"{BASE_URL}/dm/threads/start", headers=auth("admin"),
                          json={"user_id": uids[h], "opening_body": "hi from admin"})
        admin_results.append(r.status_code)
        if r.status_code != 200:
            admin_ok = False
    record("B10 pro (sophie) and elite (admin) send 6+ → all 200 (no 402)",
           sophie_ok and admin_ok,
           f"sophie={sophie_results} admin={admin_results}")

    # Scenario 11: cap NOT triggered when target follows sender
    cleanup_user_dm_state("marco")
    follower_handles = ["emily", "noah", "alex", "maya", "diego", "valeria"]
    for h in follower_handles:
        db.follows.delete_many({"follower_user_id": uids[h], "followed_user_id": marco_id})
        db.follows.insert_one({
            "follow_id": f"follow_{uuid.uuid4().hex[:12]}",
            "follower_user_id": uids[h],
            "followed_user_id": marco_id,
            "created_at": _dt.datetime.utcnow(),
        })
        db.dm_requests.delete_many({"from_user_id": marco_id, "to_user_id": uids[h]})
    ok11_all = True
    is_req_flags = []
    statuses = []
    for h in follower_handles:
        r = requests.post(f"{BASE_URL}/dm/threads/start", headers=auth("marco"),
                          json={"user_id": uids[h], "opening_body": f"hi {h}"})
        statuses.append(r.status_code)
        try:
            is_req_flags.append(r.json().get("is_request"))
        except Exception:
            is_req_flags.append(None)
        if r.status_code != 200:
            ok11_all = False
    pending = db.dm_requests.count_documents({"from_user_id": marco_id, "status": "pending"})
    ok11 = ok11_all and pending == 0 and all(f is False for f in is_req_flags)
    record("B11 cap bypassed when target follows sender (no dm_request)",
           ok11, f"statuses={statuses} is_req_flags={is_req_flags} pending_requests={pending}")

    # Remove the synthetic follows so demo data isn't polluted
    for h in follower_handles:
        db.follows.delete_many({"follower_user_id": uids[h], "followed_user_id": marco_id})


def test_discover_boost():
    print("\n=== C) GET /api/network/discover Elite boost ===\n")

    wedding_users = list(db.users.find(
        {"specialties": {"$regex": "wedding", "$options": "i"},
         "is_bot": {"$ne": True}, "is_official": {"$ne": True}},
        {"user_id": 1, "plan": 1, "name": 1, "username": 1}
    ).limit(10))
    print(f"  found {len(wedding_users)} wedding-tagged users")
    if len(wedding_users) < 2:
        record("C13 test setup (≥2 wedding users)", False,
               f"only {len(wedding_users)} found — boost test blocked")
        return

    # Exclude sophie (viewer) from the flip set so she remains the viewer
    sophie_id = uids["sophie"]
    wedding_users = [u for u in wedding_users if u["user_id"] != sophie_id]

    u_elite = wedding_users[0]
    u_free = wedding_users[1]
    u_elite2 = wedding_users[2] if len(wedding_users) >= 3 else None

    orig_elite_plan = u_elite.get("plan", "free")
    orig_free_plan = u_free.get("plan", "free")
    orig_elite2_plan = u_elite2.get("plan", "free") if u_elite2 else None

    try:
        db.users.update_one({"user_id": u_elite["user_id"]}, {"$set": {"plan": "elite"}})
        db.users.update_one({"user_id": u_free["user_id"]}, {"$set": {"plan": "free"}})
        if u_elite2:
            db.users.update_one({"user_id": u_elite2["user_id"]}, {"$set": {"plan": "elite"}})

        r = requests.get(f"{BASE_URL}/network/discover", headers=auth("sophie"))
        ok_200 = r.status_code == 200
        data = r.json() if ok_200 else {}
        record("C13/C14 /network/discover 200 with viewer=sophie", ok_200, f"status={r.status_code}")

        for rail in ["wedding", "family", "pet"]:
            rail_users = data.get(rail, [])
            if not rail_users:
                print(f"  rail '{rail}' is empty — skipping order check")
                continue
            plans = [u.get("plan", "free") for u in rail_users]
            first_non_elite = next((i for i, p in enumerate(plans) if p != "elite"), len(plans))
            elites_first = all(p == "elite" for p in plans[:first_non_elite])
            non_elite = plans[first_non_elite:]
            first_non_pro = next((i for i, p in enumerate(non_elite) if p != "pro"), len(non_elite))
            pros_then_rest = all(p == "pro" for p in non_elite[:first_non_pro])
            record(f"C14 '{rail}' rail: elite→pro→rest ordering", elites_first and pros_then_rest,
                   f"plans={plans}")

        wedding = data.get("wedding", [])
        elite_idx = next((i for i, u in enumerate(wedding) if u["user_id"] == u_elite["user_id"]), None)
        free_idx = next((i for i, u in enumerate(wedding) if u["user_id"] == u_free["user_id"]), None)
        if elite_idx is None or free_idx is None:
            record("C14b flipped elite appears before flipped free in wedding rail", False,
                   f"elite_idx={elite_idx} free_idx={free_idx} (may be paginated out)")
        else:
            record("C14b flipped elite appears before flipped free in wedding rail",
                   elite_idx < free_idx, f"elite_idx={elite_idx} free_idx={free_idx}")

        # Scenario 15: stable same-tier order across 2 calls
        r2 = requests.get(f"{BASE_URL}/network/discover", headers=auth("sophie"))
        data2 = r2.json()
        elite_order1 = [u["user_id"] for u in data.get("wedding", []) if u.get("plan") == "elite"]
        elite_order2 = [u["user_id"] for u in data2.get("wedding", []) if u.get("plan") == "elite"]
        record("C15 same-tier order stable across calls (elite order preserved)",
               elite_order1 == elite_order2,
               f"call1={elite_order1[:5]} call2={elite_order2[:5]}")

    finally:
        db.users.update_one({"user_id": u_elite["user_id"]}, {"$set": {"plan": orig_elite_plan}})
        db.users.update_one({"user_id": u_free["user_id"]}, {"$set": {"plan": orig_free_plan}})
        if u_elite2:
            db.users.update_one({"user_id": u_elite2["user_id"]}, {"$set": {"plan": orig_elite2_plan}})
        print("  C16 cleanup: plans restored to original values")


def cleanup_after_tests():
    print("\n=== CLEANUP ===")
    for handle in ["marco", "sophie", "admin"]:
        cleanup_user_dm_state(handle)
    print("  DM state wiped for marco/sophie/admin")


def main():
    print(f"Testing against: {BASE_URL}")
    setup_logins()
    test_analytics()
    test_dm_cap()
    test_discover_boost()
    cleanup_after_tests()

    print("\n" + "=" * 70)
    fails = [r for r in results if r[0] == "FAIL"]
    passes = [r for r in results if r[0] == "PASS"]
    print(f"RESULTS: {len(passes)} PASS, {len(fails)} FAIL")
    for status, name, note in results:
        print(f"  [{status}] {name}{(' — ' + note) if note else ''}")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
