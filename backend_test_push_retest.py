"""
Focused RE-TEST for the Push Notification Growth System.
Items: (5) category block, (7) trending_spot fanout + 7d dedupe,
       (9) transactional bypass, (10) 10-min dedupe non-regression.

Run:  python3 /app/backend_test_push_retest.py
"""
import os
import sys
import time
import json
import uuid
from datetime import datetime, timezone, timedelta
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASS = "admin123"

mongo = MongoClient(os.environ["MONGO_URL"])
db = mongo[os.environ["DB_NAME"]]

session = requests.Session()
session.headers.update({"Content-Type": "application/json"})

results = []
created_user_ids = []
created_spot_ids = []


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def log_ok(num, name, msg=""):
    results.append((num, name, True, msg))
    print(f"OK   ({num}) {name}  {msg}")


def log_fail(num, name, msg=""):
    results.append((num, name, False, msg))
    print(f"FAIL ({num}) {name}  {msg}")


def register_throwaway(name_prefix="qa"):
    suffix = uuid.uuid4().hex[:8]
    email = f"{name_prefix}_{suffix}@qa.lumascout.app"
    payload = {"email": email, "password": "Qa!pass1234", "name": f"{name_prefix.title()} {suffix}"}
    r = session.post(f"{BASE}/auth/register", json=payload)
    if r.status_code != 200:
        raise RuntimeError(f"register failed: {r.status_code} {r.text}")
    data = r.json()
    uid = data["user"]["user_id"]
    created_user_ids.append(uid)
    return uid, data["token"], data["user"]["name"], data["user"]["username"]


def login(email, password):
    r = session.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"]


def reset_admin_prefs():
    defaults = {
        "categories": {
            "explore": True, "network": True, "messages": True,
            "referrals": True, "marketplace": True, "community": True,
            "promotions": False,
        },
        "quiet_hours": {"enabled": True, "start": "22:00", "end": "07:00"},
        "timezone": "UTC",
        "daily_cap": 10,
        "push_enabled": True,
    }
    r = session.patch(f"{BASE}/me/notification-preferences", json=defaults, headers=_hdr(ADMIN_TOKEN))
    return r.status_code == 200


def clear_push_log(user_id):
    db.push_log.delete_many({"user_id": user_id})


def clear_notifications(user_id):
    db.notifications.delete_many({"user_id": user_id})


# =============================================================================
print("\n=== SETUP ===")
ADMIN_TOKEN, ADMIN_USER = login(ADMIN_EMAIL, ADMIN_PASS)
ADMIN_ID = ADMIN_USER["user_id"]
ADMIN_USERNAME = ADMIN_USER.get("username", "keith")
print(f"admin user_id={ADMIN_ID} username={ADMIN_USERNAME} role={ADMIN_USER.get('role')}")

reset_admin_prefs()

# =============================================================================
# ITEM (5) — category block STOPS push (U2 disables network). Inbox still persists.
# =============================================================================
print("\n=== (5) category block stops PUSH (inbox still persists) ===")
u2_id, u2_tok, u2_name, u2_uname = register_throwaway("re5_U2")
u1_id, u1_tok, *_ = register_throwaway("re5_U1")
u1b_id, u1b_tok, *_ = register_throwaway("re5_U1b")  # used for re-follow test (since a user can't follow twice)

# U2: allow all, no quiet-hours
session.patch(f"{BASE}/me/notification-preferences",
              json={"quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
                    "daily_cap": 50,
                    "categories": {"network": True, "explore": True, "messages": True,
                                   "referrals": True, "marketplace": True,
                                   "community": True, "promotions": True}},
              headers=_hdr(u2_tok))

clear_push_log(u2_id); clear_notifications(u2_id)

baseline = db.push_log.count_documents({"user_id": u2_id, "kind": "new_follower"})

# U1 follows U2
r = session.post(f"{BASE}/users/{u2_id}/follow", headers=_hdr(u1_tok))
if r.status_code != 200:
    log_fail(5, "u1 follow u2", f"{r.status_code} {r.text[:200]}")
else:
    # Wait up to 3s for push_log row
    deadline = time.time() + 3.0
    pl_new = 0
    while time.time() < deadline:
        pl_new = db.push_log.count_documents({"user_id": u2_id, "kind": "new_follower"})
        if pl_new > baseline:
            break
        time.sleep(0.2)
    (log_ok if pl_new > baseline else log_fail)(5,
        "push_log row appears for U2 kind=new_follower within 3s",
        f"baseline={baseline} after={pl_new}")

    # /api/notifications also shows new_follower
    notifs = session.get(f"{BASE}/notifications", headers=_hdr(u2_tok)).json().get("items", [])
    nf_rows = [n for n in notifs if n.get("kind") == "new_follower" and n.get("deep_link") == f"/profile/{u1_id}"]
    (log_ok if nf_rows else log_fail)(5,
        "/api/notifications row for new_follower exists",
        f"count={len(nf_rows)}")

# Toggle U2 network=false
r = session.patch(f"{BASE}/me/notification-preferences",
                  json={"categories": {"network": False}},
                  headers=_hdr(u2_tok))
cats_now = r.json().get("categories", {}) if r.status_code == 200 else {}
assert cats_now.get("network") is False, f"network toggle not applied: {cats_now}"

pl_before_block = db.push_log.count_documents({"user_id": u2_id, "kind": "new_follower"})
inbox_before_block = db.notifications.count_documents({"user_id": u2_id, "kind": "new_follower"})

# A FRESH follower U1b follows U2 (avoids toggling off an existing follow).
r_ref = session.post(f"{BASE}/users/{u2_id}/follow", headers=_hdr(u1b_tok))
if r_ref.status_code != 200:
    print(f"  U1b follow U2 failed: {r_ref.status_code} {r_ref.text[:120]}")
# Wait 3s
time.sleep(3.0)

pl_after_block = db.push_log.count_documents({"user_id": u2_id, "kind": "new_follower"})
inbox_after_block = db.notifications.count_documents({"user_id": u2_id, "kind": "new_follower"})

(log_ok if pl_after_block == pl_before_block else log_fail)(5,
    "category-blocked: push_log does NOT increase after re-follow",
    f"before={pl_before_block} after={pl_after_block}")
(log_ok if inbox_after_block > inbox_before_block else log_fail)(5,
    "inbox row still persisted (independent of push gate)",
    f"before={inbox_before_block} after={inbox_after_block}")

# Revert U2 network=true
session.patch(f"{BASE}/me/notification-preferences",
              json={"categories": {"network": True}}, headers=_hdr(u2_tok))

# =============================================================================
# ITEM (7) — trending_spot fanout AND 7-day per-spot dedupe
# =============================================================================
print("\n=== (7) trending_spot fanout + 7d dedupe ===")
tiny_img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwAB/epv2gAAAABJRU5ErkJggg=="
spot_payload = {
    "title": "QA Trending Retest Spot",
    "description": "trending signal retest",
    "latitude": 30.2672, "longitude": -97.7431,
    "city": "Austin", "state": "TX", "country": "USA",
    "privacy_mode": "public",
    "images": [{"image_url": tiny_img, "caption": None, "is_cover": True}],
}
r = session.post(f"{BASE}/spots", json=spot_payload, headers=_hdr(ADMIN_TOKEN))
SPOT_ID = r.json().get("spot_id") if r.status_code == 200 else None
if SPOT_ID:
    created_spot_ids.append(SPOT_ID)
    # Ensure created_at is fresh tz-aware (Motor returns naive; server normalises)
    db.spots.update_one({"spot_id": SPOT_ID}, {"$set": {"created_at": datetime.now(timezone.utc)}})
    log_ok(7, "admin created spot", SPOT_ID)
else:
    log_fail(7, "admin create spot", f"{r.status_code} {r.text[:200]}")

if SPOT_ID:
    # Register savers A, B, C (first 3)
    savers = []
    for tag in ("A", "B", "C"):
        sid, stok, _, _ = register_throwaway(f"re7trend{tag}")
        # Ensure fresh user's city is NOT Austin (so they aren't fanout targets)
        session.patch(f"{BASE}/auth/me", json={"city": "Dallas", "state": "TX"}, headers=_hdr(stok))
        savers.append((sid, stok))

    # Register E with city='Austin' BEFORE the 4th save
    e_id, e_tok, _, _ = register_throwaway("re7trendE")
    session.patch(f"{BASE}/auth/me", json={"city": "Austin", "state": "TX"}, headers=_hdr(e_tok))
    session.patch(f"{BASE}/me/notification-preferences",
                  json={"quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
                        "daily_cap": 50,
                        "categories": {"explore": True}},
                  headers=_hdr(e_tok))
    clear_push_log(e_id); clear_notifications(e_id)

    # Register D as the 4th saver
    d_id, d_tok, _, _ = register_throwaway("re7trendD")
    session.patch(f"{BASE}/auth/me", json={"city": "Dallas", "state": "TX"}, headers=_hdr(d_tok))
    savers.append((d_id, d_tok))

    # Fire the first 3 saves (no fanout yet)
    for i, (sid, stok) in enumerate(savers[:3], start=1):
        rr = session.post(f"{BASE}/spots/{SPOT_ID}/save", headers=_hdr(stok))
        if rr.status_code != 200:
            print(f"  save#{i} failed: {rr.status_code} {rr.text[:120]}")

    # Baseline E's push_log BEFORE the 4th save
    e_pl_before = db.push_log.count_documents({
        "user_id": e_id, "kind": "trending_spot", "deep_link": f"/spot/{SPOT_ID}",
    })

    # 4th save
    rr = session.post(f"{BASE}/spots/{SPOT_ID}/save", headers=_hdr(savers[3][1]))
    if rr.status_code != 200:
        print(f"  save#4 failed: {rr.status_code} {rr.text[:200]}")

    # Wait up to 3s for fanout
    deadline = time.time() + 3.0
    e_got_trending = False
    e_pl_after = e_pl_before
    while time.time() < deadline:
        e_pl_after = db.push_log.count_documents({
            "user_id": e_id, "kind": "trending_spot", "deep_link": f"/spot/{SPOT_ID}",
        })
        if e_pl_after > e_pl_before:
            e_got_trending = True
            break
        time.sleep(0.25)

    # Also check notifications row
    notifs = session.get(f"{BASE}/notifications", headers=_hdr(e_tok)).json().get("items", [])
    ts_notifs = [n for n in notifs if n.get("kind") == "trending_spot" and n.get("deep_link") == f"/spot/{SPOT_ID}"]

    (log_ok if ts_notifs else log_fail)(7,
        "E /api/notifications has trending_spot with deep_link /spot/{SPOT_ID}",
        f"count={len(ts_notifs)}")
    (log_ok if e_got_trending else log_fail)(7,
        "db.push_log has row for E kind=trending_spot (within 3s of 4th save)",
        f"before={e_pl_before} after={e_pl_after}")

    # Register F with city='Austin' AFTER all saves → F's 5th save should NOT fanout
    f_id, f_tok, _, _ = register_throwaway("re7trendF")
    session.patch(f"{BASE}/auth/me", json={"city": "Austin", "state": "TX"}, headers=_hdr(f_tok))

    e_pl_pre5 = db.push_log.count_documents({
        "user_id": e_id, "kind": "trending_spot", "deep_link": f"/spot/{SPOT_ID}",
    })
    rr = session.post(f"{BASE}/spots/{SPOT_ID}/save", headers=_hdr(f_tok))
    time.sleep(2.0)
    e_pl_post5 = db.push_log.count_documents({
        "user_id": e_id, "kind": "trending_spot", "deep_link": f"/spot/{SPOT_ID}",
    })
    (log_ok if e_pl_post5 == e_pl_pre5 else log_fail)(7,
        "saves_after==5 does NOT trigger fanout again (E no new row)",
        f"pre5={e_pl_pre5} post5={e_pl_post5}")

# =============================================================================
# ITEM (9) — transactional bypass of quiet hours + daily cap
# =============================================================================
print("\n=== (9) transactional bypass ===")
# Set admin all-day quiet hours, daily_cap=1, all categories on, promotions on
session.patch(f"{BASE}/me/notification-preferences", json={
    "push_enabled": True,
    "daily_cap": 1,
    "quiet_hours": {"enabled": True, "start": "00:00", "end": "23:59"},
    "timezone": "UTC",
    "categories": {"explore": True, "network": True, "messages": True,
                   "referrals": True, "marketplace": True,
                   "community": True, "promotions": True},
}, headers=_hdr(ADMIN_TOKEN))

clear_push_log(ADMIN_ID); clear_notifications(ADMIN_ID)

# 9a. Non-transactional test-push should be blocked
r = session.post(f"{BASE}/me/notifications/test-push", headers=_hdr(ADMIN_TOKEN))
delivered = r.json().get("delivered") if r.status_code == 200 else None
time.sleep(0.4)
pl_after_test = db.push_log.count_documents({"user_id": ADMIN_ID})
(log_ok if delivered is False else log_fail)(9,
    "test-push (upgrade_nudge) blocked by quiet hours (delivered=false)",
    f"delivered={delivered}")
(log_ok if pl_after_test == 0 else log_fail)(9,
    "push_log NOT increased by blocked test-push",
    f"push_log count={pl_after_test}")

# 9b. U1 DMs admin → bypass should fire new_message/new_message_request
dm_u1_id, dm_u1_tok, *_ = register_throwaway("re9dm")
pl_before_dm = db.push_log.count_documents({
    "user_id": ADMIN_ID, "kind": {"$in": ["new_message", "new_message_request", "dm_message", "dm_request"]},
})
r = session.post(f"{BASE}/dm/threads/start",
                 json={"user_id": ADMIN_ID, "opening_body": "retest bypass hi"},
                 headers=_hdr(dm_u1_tok))
if r.status_code != 200:
    log_fail(9, "U1→admin DM start", f"{r.status_code} {r.text[:200]}")
else:
    deadline = time.time() + 3.0
    pl_after_dm = pl_before_dm
    while time.time() < deadline:
        pl_after_dm = db.push_log.count_documents({
            "user_id": ADMIN_ID,
            "kind": {"$in": ["new_message", "new_message_request", "dm_message", "dm_request"]},
        })
        if pl_after_dm > pl_before_dm:
            break
        time.sleep(0.25)
    (log_ok if pl_after_dm > pl_before_dm else log_fail)(9,
        "DM triggers BYPASS push (push_log row added within 3s)",
        f"before={pl_before_dm} after={pl_after_dm}")

# 9c. U1 saves admin-owned spot → upload_featured → NOT bypass → still blocked
# First create an admin-owned spot in Houston
spot_houston = dict(spot_payload)
spot_houston["title"] = "QA Bypass Retest Houston Spot"
spot_houston["city"] = "Houston"
spot_houston["latitude"] = 29.7604
spot_houston["longitude"] = -95.3698
spot_houston["images"] = [{"image_url": tiny_img, "caption": None, "is_cover": True}]
r = session.post(f"{BASE}/spots", json=spot_houston, headers=_hdr(ADMIN_TOKEN))
admin_spot_id = r.json().get("spot_id") if r.status_code == 200 else None
if admin_spot_id:
    created_spot_ids.append(admin_spot_id)

if admin_spot_id:
    pl_before_save = db.push_log.count_documents({"user_id": ADMIN_ID, "kind": "upload_featured"})
    rr = session.post(f"{BASE}/spots/{admin_spot_id}/save", headers=_hdr(dm_u1_tok))
    if rr.status_code != 200:
        print(f"  save on admin spot failed: {rr.status_code} {rr.text[:200]}")
    time.sleep(3.0)
    pl_after_save = db.push_log.count_documents({"user_id": ADMIN_ID, "kind": "upload_featured"})
    (log_ok if pl_after_save == pl_before_save else log_fail)(9,
        "upload_featured (non-bypass) STILL blocked by quiet hours",
        f"before={pl_before_save} after={pl_after_save}")
else:
    log_fail(9, "admin create Houston spot", "no spot_id")

# Reset admin prefs
reset_admin_prefs()

# =============================================================================
# ITEM (10) — 10-min dedupe non-regression
# =============================================================================
print("\n=== (10) 10-min dedupe (non-regression) ===")
session.patch(f"{BASE}/me/notification-preferences", json={
    "quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
    "daily_cap": 50,
    "categories": {"promotions": True},
}, headers=_hdr(ADMIN_TOKEN))
clear_push_log(ADMIN_ID)

r1 = session.post(f"{BASE}/me/notifications/test-push", headers=_hdr(ADMIN_TOKEN))
r2 = session.post(f"{BASE}/me/notifications/test-push", headers=_hdr(ADMIN_TOKEN))
time.sleep(0.5)
d1 = r1.json().get("delivered") if r1.status_code == 200 else None
d2 = r2.json().get("delivered") if r2.status_code == 200 else None
pl_ct = db.push_log.count_documents({"user_id": ADMIN_ID, "kind": "upgrade_nudge"})
ok10 = (d1 is True) and (d2 is False) and (pl_ct == 1)
(log_ok if ok10 else log_fail)(10,
    "2 identical test-pushes → 1 push_log row only",
    f"d1={d1} d2={d2} push_log rows={pl_ct}")

# =============================================================================
# CLEANUP
# =============================================================================
print("\n=== CLEANUP ===")
reset_admin_prefs()

for uid in created_user_ids:
    try:
        db.users.delete_one({"user_id": uid})
        db.notifications.delete_many({"user_id": uid})
        db.push_log.delete_many({"user_id": uid})
        db.follows.delete_many({"$or": [{"follower_user_id": uid}, {"followed_user_id": uid}]})
        db.spot_saves.delete_many({"user_id": uid})
        db.dm_threads.delete_many({"participant_user_ids": uid})
        db.dm_participants.delete_many({"user_id": uid})
        db.dm_requests.delete_many({"$or": [{"from_user_id": uid}, {"to_user_id": uid}]})
    except Exception as e:
        print(f"cleanup err user={uid}: {e}")
for sid in created_spot_ids:
    try:
        db.spots.delete_one({"spot_id": sid})
        db.spot_saves.delete_many({"spot_id": sid})
        db.push_log.delete_many({"deep_link": f"/spot/{sid}"})
    except Exception as e:
        print(f"cleanup err spot={sid}: {e}")

# =============================================================================
# SUMMARY
# =============================================================================
print("\n\n========== SUMMARY ==========")
passes = [r for r in results if r[2]]
fails = [r for r in results if not r[2]]
print(f"Total: {len(results)}  passed={len(passes)}  failed={len(fails)}")
if fails:
    print("\nFailures:")
    for (num, name, _, msg) in fails:
        print(f"  FAIL ({num}) {name}  — {msg}")
print()
sys.exit(0 if not fails else 1)
