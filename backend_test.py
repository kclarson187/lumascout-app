"""
Backend test for Push Notification Growth System.
Run:  python3 /app/backend_test.py
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
    print(f"OK  ({num}) {name}  {msg}")


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

clear_push_log(ADMIN_ID)
clear_notifications(ADMIN_ID)

# --- (1) GET prefs merged defaults ---
print("\n=== (1) GET /me/notification-preferences defaults ===")
reset_admin_prefs()
r = session.get(f"{BASE}/me/notification-preferences", headers=_hdr(ADMIN_TOKEN))
if r.status_code != 200:
    log_fail(1, "get prefs", f"status {r.status_code} body={r.text[:200]}")
else:
    prefs = r.json()
    ok = True; details = []
    qh = prefs.get("quiet_hours", {})
    if not (qh.get("enabled") is True and qh.get("start") == "22:00" and qh.get("end") == "07:00"):
        ok = False; details.append(f"quiet_hours={qh}")
    if prefs.get("daily_cap") != 10:
        ok = False; details.append(f"daily_cap={prefs.get('daily_cap')}")
    if prefs.get("push_enabled") is not True:
        ok = False; details.append(f"push_enabled={prefs.get('push_enabled')}")
    cats = prefs.get("categories", {})
    expected_cats = {"explore": True, "network": True, "messages": True,
                     "referrals": True, "marketplace": True, "community": True,
                     "promotions": False}
    for k, v in expected_cats.items():
        if cats.get(k) != v:
            ok = False; details.append(f"cats.{k}={cats.get(k)} expected {v}")
    (log_ok if ok else log_fail)(1, "GET merged defaults", "; ".join(details) or "all defaults correct")

# --- (2) PATCH categories.explore=false (others intact) ---
print("\n=== (2) PATCH categories.explore=false ===")
r = session.patch(f"{BASE}/me/notification-preferences",
                  json={"categories": {"explore": False}},
                  headers=_hdr(ADMIN_TOKEN))
if r.status_code != 200:
    log_fail(2, "patch explore=false", f"status {r.status_code} {r.text[:200]}")
else:
    cats = r.json().get("categories", {})
    ok = cats.get("explore") is False and cats.get("network") is True and \
         cats.get("messages") is True and cats.get("community") is True
    (log_ok if ok else log_fail)(2, "explore=false,others intact", json.dumps(cats))

reset_admin_prefs()

# --- (3) PATCH quiet_hours trimmed + daily_cap clamp ---
print("\n=== (3) PATCH quiet_hours + daily_cap clamp ===")
r = session.patch(f"{BASE}/me/notification-preferences",
                  json={"quiet_hours": {"enabled": True, "start": "23:00:12", "end": "08:00:45"}},
                  headers=_hdr(ADMIN_TOKEN))
qh_ok = False
if r.status_code == 200:
    qh = r.json().get("quiet_hours", {})
    qh_ok = qh.get("start") == "23:00" and qh.get("end") == "08:00" and qh.get("enabled") is True
(log_ok if qh_ok else log_fail)(3, "quiet_hours trimmed to HH:MM",
    json.dumps(r.json().get("quiet_hours", {}) if r.status_code == 200 else r.text))

r = session.patch(f"{BASE}/me/notification-preferences", json={"daily_cap": 99}, headers=_hdr(ADMIN_TOKEN))
cap_hi = r.status_code == 200 and r.json().get("daily_cap") == 50
(log_ok if cap_hi else log_fail)(3, "daily_cap=99 → 50", f"got {r.json().get('daily_cap') if r.status_code==200 else r.text[:100]}")

r = session.patch(f"{BASE}/me/notification-preferences", json={"daily_cap": 0}, headers=_hdr(ADMIN_TOKEN))
cap_lo = r.status_code == 200 and r.json().get("daily_cap") == 1
(log_ok if cap_lo else log_fail)(3, "daily_cap=0 → 1", f"got {r.json().get('daily_cap') if r.status_code==200 else r.text[:100]}")

reset_admin_prefs()

# --- (4) test-push ---
print("\n=== (4) test-push ===")
session.patch(f"{BASE}/me/notification-preferences",
              json={"quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
                    "daily_cap": 50,
                    "categories": {"promotions": False}},
              headers=_hdr(ADMIN_TOKEN))
clear_push_log(ADMIN_ID)
r = session.post(f"{BASE}/me/notifications/test-push", headers=_hdr(ADMIN_TOKEN))
if r.status_code != 200:
    log_fail(4, "test-push promotions=off", f"status {r.status_code} {r.text[:200]}")
else:
    delivered = r.json().get("delivered")
    (log_ok if delivered is False else log_fail)(4,
        "delivered=false when promotions off",
        f"got delivered={delivered}")

session.patch(f"{BASE}/me/notification-preferences",
              json={"categories": {"promotions": True}},
              headers=_hdr(ADMIN_TOKEN))
clear_push_log(ADMIN_ID)
r = session.post(f"{BASE}/me/notifications/test-push", headers=_hdr(ADMIN_TOKEN))
if r.status_code != 200:
    log_fail(4, "test-push promotions=on", f"status {r.status_code}")
else:
    delivered = r.json().get("delivered")
    (log_ok if delivered is True else log_fail)(4,
        "delivered=true when promotions on",
        f"got delivered={delivered}")

time.sleep(0.3)
cnt = db.push_log.count_documents({"user_id": ADMIN_ID, "kind": "upgrade_nudge"})
(log_ok if cnt >= 1 else log_fail)(4, "push_log row inserted on delivered=true", f"count={cnt}")

reset_admin_prefs()

# --- (5) Follower ---
print("\n=== (5) new_follower + category gating ===")
u1_id, u1_tok, u1_name, u1_uname = register_throwaway("foll1")
u2_id, u2_tok, u2_name, u2_uname = register_throwaway("foll2")
u3_id, u3_tok, u3_name, u3_uname = register_throwaway("foll3")
clear_push_log(u2_id); clear_notifications(u2_id)

session.patch(f"{BASE}/me/notification-preferences",
              json={"quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
                    "daily_cap": 50, "categories": {"network": True}},
              headers=_hdr(u2_tok))

r = session.post(f"{BASE}/users/{u2_id}/follow", headers=_hdr(u1_tok))
if r.status_code != 200:
    log_fail(5, "u1 follow u2", f"{r.status_code} {r.text[:100]}")
else:
    time.sleep(0.5)
    notifs = session.get(f"{BASE}/notifications", headers=_hdr(u2_tok)).json().get("items", [])
    nf = [n for n in notifs if n.get("kind") == "new_follower"]
    found = any(n.get("deep_link") == f"/profile/{u1_id}" for n in nf)
    (log_ok if found else log_fail)(5,
        "new_follower with deep_link /profile/{U1}",
        f"kind=new_follower count={len(nf)}; first dl={nf[0].get('deep_link') if nf else None}")

pl_count_before = db.push_log.count_documents({"user_id": u2_id, "kind": "new_follower"})

session.patch(f"{BASE}/me/notification-preferences",
              json={"categories": {"network": False}},
              headers=_hdr(u2_tok))

r = session.post(f"{BASE}/users/{u2_id}/follow", headers=_hdr(u3_tok))
time.sleep(0.5)
pl_count_after = db.push_log.count_documents({"user_id": u2_id, "kind": "new_follower"})
notifs = session.get(f"{BASE}/notifications", headers=_hdr(u2_tok)).json().get("items", [])
inbox_persisted = sum(1 for n in notifs if n.get("kind") == "new_follower") >= 2

(log_ok if pl_count_after == pl_count_before else log_fail)(5,
    "network=off blocks push for 2nd follower",
    f"push_log before={pl_count_before}, after={pl_count_after}")
(log_ok if inbox_persisted else log_fail)(5,
    "in-app inbox row still persisted after category-block",
    f"seen new_follower in /notifications={sum(1 for n in notifs if n.get('kind')=='new_follower')}")

# --- (6) referral_nearby ---
print("\n=== (6) referral_nearby ===")
poster_id, poster_tok, _, _ = register_throwaway("refpost")
target_id, target_tok, _, _ = register_throwaway("reftarget")

session.patch(f"{BASE}/auth/me", json={"city": "Austin", "state": "TX"}, headers=_hdr(poster_tok))
session.patch(f"{BASE}/auth/me", json={"city": "Austin", "state": "TX"}, headers=_hdr(target_tok))
db.users.update_one({"user_id": target_id}, {"$set": {"available_for_referrals": True}})
session.patch(f"{BASE}/me/notification-preferences",
              json={"quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
                    "daily_cap": 50, "categories": {"referrals": True}},
              headers=_hdr(target_tok))
clear_push_log(target_id); clear_notifications(target_id)

r = session.post(f"{BASE}/referrals", json={
    "title": "Maternity shoot needed",
    "shoot_type": "portrait",
    "gig_type": "full_session_referral",
    "city": "Austin",
    "state": "TX",
}, headers=_hdr(poster_tok))
if r.status_code != 200:
    log_fail(6, "POST /referrals", f"{r.status_code} {r.text[:200]}")
else:
    need_id = r.json().get("need_id")
    time.sleep(1.0)
    notifs = session.get(f"{BASE}/notifications", headers=_hdr(target_tok)).json().get("items", [])
    rn = [n for n in notifs if n.get("kind") == "referral_nearby"]
    found = any(n.get("deep_link") == f"/referrals/{need_id}" for n in rn)
    (log_ok if found else log_fail)(6,
        "target received referral_nearby with deep_link",
        f"count={len(rn)} dl={rn[0].get('deep_link') if rn else None} need_id={need_id}")

# --- (7) trending_spot ---
print("\n=== (7) trending_spot ===")
tiny_img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwAB/epv2gAAAABJRU5ErkJggg=="
spot_payload = {
    "title": "QA Trending Test Spot",
    "description": "test spot for trending signal",
    "latitude": 30.2672, "longitude": -97.7431,
    "city": "Austin", "state": "TX", "country": "USA",
    "privacy_mode": "public",
    "images": [{"image_url": tiny_img, "caption": None, "is_cover": True}],
}
r = session.post(f"{BASE}/spots", json=spot_payload, headers=_hdr(ADMIN_TOKEN))
SPOT_ID = None
if r.status_code == 200:
    SPOT_ID = r.json().get("spot_id")
    created_spot_ids.append(SPOT_ID)
    log_ok(7, "admin created spot", SPOT_ID)
else:
    log_fail(7, "admin create spot", f"{r.status_code} {r.text[:200]}")

if SPOT_ID:
    savers = []
    for tag in ("A", "B", "C", "D"):
        sid, stok, _, _ = register_throwaway(f"trend{tag}")
        savers.append((sid, stok))

    e_id, e_tok, _, _ = register_throwaway("trendE")
    session.patch(f"{BASE}/auth/me", json={"city": "Austin", "state": "TX"}, headers=_hdr(e_tok))
    session.patch(f"{BASE}/me/notification-preferences",
                  json={"quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
                        "daily_cap": 50, "categories": {"explore": True}},
                  headers=_hdr(e_tok))
    clear_push_log(e_id); clear_notifications(e_id)

    for i, (sid, stok) in enumerate(savers, start=1):
        rr = session.post(f"{BASE}/spots/{SPOT_ID}/save", headers=_hdr(stok))
        if rr.status_code != 200:
            print(f"  save#{i} failed: {rr.status_code} {rr.text[:120]}")

    time.sleep(1.2)
    notifs = session.get(f"{BASE}/notifications", headers=_hdr(e_tok)).json().get("items", [])
    ts = [n for n in notifs if n.get("kind") == "trending_spot"]
    found_e = any(n.get("deep_link") == f"/spot/{SPOT_ID}" for n in ts)
    (log_ok if found_e else log_fail)(7,
        "E receives trending_spot after 4th save",
        f"trending_spot count for E={len(ts)}")

    # 5th saver F
    f_id, f_tok, _, _ = register_throwaway("trendF")
    session.post(f"{BASE}/spots/{SPOT_ID}/save", headers=_hdr(f_tok))
    time.sleep(0.8)
    ts_rows = db.push_log.count_documents({
        "user_id": e_id, "kind": "trending_spot", "deep_link": f"/spot/{SPOT_ID}",
    })
    (log_ok if ts_rows == 1 else log_fail)(7,
        "7d per-spot dedupe: E has exactly 1 trending_spot push_log row after 5th save",
        f"rows={ts_rows}")

# --- (8) comment_reply + @mention ---
print("\n=== (8) comment_reply + @mention ===")
r = session.post(f"{BASE}/posts", json={
    "category": "tip",
    "title": "QA Post for Comment Test",
    "body": "testing comments",
}, headers=_hdr(ADMIN_TOKEN))
post_id = None
if r.status_code == 200:
    post_id = r.json().get("post_id")
    log_ok(8, "admin created post", post_id)
else:
    log_fail(8, "admin create post", f"{r.status_code} {r.text[:200]}")

if post_id:
    u1_id, u1_tok, u1_name, u1_uname = register_throwaway("cmt1")
    clear_push_log(ADMIN_ID); clear_notifications(ADMIN_ID)
    session.patch(f"{BASE}/me/notification-preferences",
                  json={"quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
                        "daily_cap": 50, "categories": {"community": True}},
                  headers=_hdr(ADMIN_TOKEN))
    r = session.post(f"{BASE}/posts/{post_id}/comments",
                     json={"body": f"Nice shot @{ADMIN_USERNAME} keep it up"},
                     headers=_hdr(u1_tok))
    if r.status_code != 200:
        log_fail(8, "u1 comment on admin post", f"{r.status_code} {r.text[:200]}")
    else:
        time.sleep(0.7)
        notifs = session.get(f"{BASE}/notifications", headers=_hdr(ADMIN_TOKEN)).json().get("items", [])
        kinds = [n.get("kind") for n in notifs]
        has_reply = any(n.get("kind") == "comment_reply" and n.get("deep_link") == f"/community/post/{post_id}"
                        for n in notifs)
        has_mention = any(n.get("kind") == "comment_mention" and n.get("deep_link") == f"/community/post/{post_id}"
                          for n in notifs)
        if has_reply and not has_mention:
            log_ok(8, "admin got comment_reply (mention skipped as post-author)", f"kinds={kinds}")
        elif has_reply and has_mention:
            log_ok(8, "admin got comment_reply AND comment_mention",
                   f"kinds={kinds}")
        else:
            log_fail(8, "admin did not receive comment_reply",
                     f"kinds={kinds}")

    # Mention flow: U2 post, admin comments mentioning U3
    u2_id, u2_tok, _, u2_uname = register_throwaway("cmt2")
    u3_id, u3_tok, _, u3_uname = register_throwaway("cmt3")
    r = session.post(f"{BASE}/posts", json={
        "category": "tip", "title": "U2 Post for Mention Test",
    }, headers=_hdr(u2_tok))
    u2_post = r.json().get("post_id") if r.status_code == 200 else None
    if not u2_post:
        log_fail(8, "u2 create post", f"{r.status_code} {r.text[:200]}")
    else:
        session.patch(f"{BASE}/me/notification-preferences",
                      json={"quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
                            "daily_cap": 50, "categories": {"community": True}},
                      headers=_hdr(u3_tok))
        clear_push_log(u3_id); clear_notifications(u3_id)
        r = session.post(f"{BASE}/posts/{u2_post}/comments",
                         json={"body": f"Hey @{u3_uname} great shot"},
                         headers=_hdr(ADMIN_TOKEN))
        if r.status_code != 200:
            log_fail(8, "admin comment mentioning u3", f"{r.status_code} {r.text[:200]}")
        else:
            time.sleep(0.6)
            notifs = session.get(f"{BASE}/notifications", headers=_hdr(u3_tok)).json().get("items", [])
            cm = [n for n in notifs if n.get("kind") == "comment_mention"]
            (log_ok if cm else log_fail)(8,
                "u3 received comment_mention from admin",
                f"comment_mention count={len(cm)}")

        # Self-mention
        clear_push_log(u2_id); clear_notifications(u2_id)
        r = session.post(f"{BASE}/posts/{u2_post}/comments",
                         json={"body": f"note to self @{u2_uname} remember"},
                         headers=_hdr(u2_tok))
        if r.status_code != 200:
            log_fail(8, "u2 self-comment", f"{r.status_code} {r.text[:200]}")
        else:
            time.sleep(0.5)
            notifs = session.get(f"{BASE}/notifications", headers=_hdr(u2_tok)).json().get("items", [])
            self_notifs = [n for n in notifs if n.get("kind") in ("comment_reply", "comment_mention")]
            (log_ok if not self_notifs else log_fail)(8,
                "u2 self-mention produces no self-notification",
                f"self notifs={[n.get('kind') for n in self_notifs]}")

# --- (9) Transactional bypass ---
print("\n=== (9) transactional bypass ===")
now_utc = datetime.now(timezone.utc)
start_hhmm = now_utc.strftime("%H:%M")
end_hhmm = (now_utc + timedelta(minutes=30)).strftime("%H:%M")
session.patch(f"{BASE}/me/notification-preferences", json={
    "quiet_hours": {"enabled": True, "start": start_hhmm, "end": end_hhmm},
    "daily_cap": 1,
    "timezone": "UTC",
    "categories": {"community": True, "messages": True, "network": True},
}, headers=_hdr(ADMIN_TOKEN))

clear_push_log(ADMIN_ID); clear_notifications(ADMIN_ID)

spot_payload2 = dict(spot_payload)
spot_payload2["title"] = "QA Bypass Test Spot"
spot_payload2["city"] = "Houston"
spot_payload2["images"] = [{"image_url": tiny_img, "caption": None, "is_cover": True}]
r = session.post(f"{BASE}/spots", json=spot_payload2, headers=_hdr(ADMIN_TOKEN))
admin_spot_id = r.json().get("spot_id") if r.status_code == 200 else None
if admin_spot_id:
    created_spot_ids.append(admin_spot_id)

u1_id, u1_tok, _, _ = register_throwaway("bypass1")

if admin_spot_id:
    session.post(f"{BASE}/spots/{admin_spot_id}/save", headers=_hdr(u1_tok))
    time.sleep(0.5)
    pl_upload = db.push_log.count_documents({"user_id": ADMIN_ID, "kind": "upload_featured"})
    (log_ok if pl_upload == 0 else log_fail)(9,
        "upload_featured blocked by quiet hours (non-bypass)",
        f"push_log upload_featured rows={pl_upload}")

r = session.post(f"{BASE}/dm/threads/start",
                 json={"user_id": ADMIN_ID, "opening_body": "Bypass test hello"},
                 headers=_hdr(u1_tok))
if r.status_code != 200:
    log_fail(9, "u1→admin dm thread start", f"{r.status_code} {r.text[:200]}")
else:
    time.sleep(1.0)
    pl_msg = db.push_log.count_documents({
        "user_id": ADMIN_ID,
        "kind": {"$in": ["new_message", "new_message_request"]},
    })
    (log_ok if pl_msg >= 1 else log_fail)(9,
        "new_message bypasses quiet hours + cap",
        f"push_log new_message/new_message_request rows={pl_msg}")

reset_admin_prefs()

# --- (10) dedupe ---
print("\n=== (10) 10-minute dedupe ===")
session.patch(f"{BASE}/me/notification-preferences", json={
    "quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
    "daily_cap": 50,
    "categories": {"promotions": True},
}, headers=_hdr(ADMIN_TOKEN))
clear_push_log(ADMIN_ID)

r1 = session.post(f"{BASE}/me/notifications/test-push", headers=_hdr(ADMIN_TOKEN))
r2 = session.post(f"{BASE}/me/notifications/test-push", headers=_hdr(ADMIN_TOKEN))
time.sleep(0.3)
d1 = r1.json().get("delivered") if r1.status_code == 200 else None
d2 = r2.json().get("delivered") if r2.status_code == 200 else None
pl_ct = db.push_log.count_documents({"user_id": ADMIN_ID, "kind": "upgrade_nudge"})
ok10 = (d1 is True) and (d2 is False) and (pl_ct == 1)
(log_ok if ok10 else log_fail)(10,
    "2 identical test-pushes → 1 push_log row only",
    f"d1={d1} d2={d2} push_log rows={pl_ct}")

# --- NON-REGRESSION ---
print("\n=== NON-REGRESSION ===")
for path in ["/auth/me", "/feed/home", "/spots?limit=3", "/marketplace/storefront"]:
    r = session.get(f"{BASE}{path}", headers=_hdr(ADMIN_TOKEN))
    (log_ok if r.status_code == 200 else log_fail)(0,
        f"GET {path}", f"status={r.status_code}")

# --- CLEANUP ---
print("\n=== CLEANUP ===")
reset_admin_prefs()

# DELETE /api/admin/users/{id} and DELETE /api/admin/spots/{id} are NOT implemented.
# Fall back to Mongo cleanup.
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
        db.post_comments.delete_many({"author_user_id": uid})
        db.community_posts.delete_many({"author_user_id": uid})
        db.referral_needs.delete_many({"poster_user_id": uid})
    except Exception as e:
        print(f"cleanup err user={uid}: {e}")
for sid in created_spot_ids:
    try:
        db.spots.delete_one({"spot_id": sid})
        db.spot_saves.delete_many({"spot_id": sid})
        db.push_log.delete_many({"deep_link": f"/spot/{sid}"})
    except Exception as e:
        print(f"cleanup err spot={sid}: {e}")

# Delete admin's QA post + U2 post
db.community_posts.delete_many({"title": {"$in": ["QA Post for Comment Test", "U2 Post for Mention Test"]}})

# --- SUMMARY ---
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
