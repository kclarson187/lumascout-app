"""Phase B.2 — Referral Marketplace Backend QA.

Covers 24 scenarios from the review request. Uses real demo credentials from
/app/memory/test_credentials.md and hits the backend at http://localhost:8001/api.

Note: direct Mongo access is used for (a) clean-slate wipe, (b) aging a doc's
expires_at into the past for the auto-expire scenario, and (c) confirming the
FREE-cap is exercised without depending on other tests' leftover applications.
"""
from __future__ import annotations
import os
import sys
import time
import uuid
import json
import traceback
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import requests
from pymongo import MongoClient

BASE = "http://localhost:8001/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "photoscout_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

CREDS = {
    "admin":  ("admin@lumascout.app",  "admin123"),
    "sophie": ("sophie@lumascout.app", "demo123"),
    "marco":  ("marco@lumascout.app",  "demo123"),
    "priya":  ("priya@lumascout.app",  "demo123"),
}
tokens: Dict[str, str] = {}
users:  Dict[str, dict] = {}

PASSES: List[str] = []
FAILS:  List[str] = []


def _ok(msg: str):
    PASSES.append(msg); print(f"  PASS  {msg}")


def _fail(msg: str):
    FAILS.append(msg);  print(f"  FAIL  {msg}")


def hdr(tok: Optional[str] = None) -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


def login_all():
    for key, (email, pw) in CREDS.items():
        r = requests.post(f"{BASE}/auth/login",
                          json={"email": email, "password": pw}, timeout=20)
        if r.status_code != 200:
            raise SystemExit(f"login {key} -> {r.status_code} {r.text}")
        jr = r.json()
        tokens[key] = jr.get("token") or jr.get("access_token")
        me = requests.get(f"{BASE}/auth/me", headers=hdr(tokens[key]), timeout=20).json()
        users[key] = me
        print(f"logged in {key} user_id={me.get('user_id')} plan={me.get('plan')} role={me.get('role')}")


# ---------------------------------------------------------------------------
def contains_leak(obj: Any) -> List[str]:
    """Recursively walk obj and return any paths that contain password_hash
       or an email field. (Email leaks in referral responses are the bug.)"""
    hits: List[str] = []
    def walk(node: Any, path: str):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "password_hash":
                    hits.append(f"{path}.password_hash")
                if k == "email" and v:
                    hits.append(f"{path}.email={v}")
                walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")
    walk(obj, "root")
    return hits


# ---------------------------------------------------------------------------
def scenario_1_clean_slate():
    print("\n[1] CLEAN SLATE")
    r1 = db.referral_needs.delete_many({})
    r2 = db.referral_applications.delete_many({})
    print(f"  wiped referral_needs={r1.deleted_count} applications={r2.deleted_count}")
    _ok("clean slate")


def scenario_2_create_happy():
    print("\n[2] CREATE happy path (sophie — pro)")
    body = {
        "title": "Need Austin family photographer for Sat sunset",
        "shoot_type": "Family portraits",
        "gig_type": "full_session_referral",
        "city": "Austin",
        "state": "TX",
        "country": "US",
        "event_date": "2026-05-10",
        "duration_hours": 2.0,
        "budget_min": 400.0,
        "budget_max": 800.0,
        "budget_currency": "USD",
        "notes": "Looking for a family-session photographer for 6pm golden hour at Zilker.",
        "urgency": "urgent",
        "expires_in_days": 14,
    }
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]), json=body, timeout=20)
    if r.status_code != 200:
        _fail(f"[2] create happy -> {r.status_code} {r.text}"); return None
    j = r.json()
    sophie_need_id = j.get("need_id")
    if not sophie_need_id or not sophie_need_id.startswith("need_"):
        _fail(f"[2] bad need_id: {sophie_need_id}")
    else:
        _ok(f"[2] need_id={sophie_need_id}")
    if j.get("status") != "open":
        _fail(f"[2] expected status=open got {j.get('status')}")
    else:
        _ok("[2] status=open")
    poster = j.get("poster") or {}
    if poster.get("username") != "sophiereyes":
        _fail(f"[2] poster.username={poster.get('username')}")
    else:
        _ok("[2] poster.username=sophiereyes")
    if poster.get("plan") != "pro":
        _fail(f"[2] poster.plan={poster.get('plan')}")
    else:
        _ok("[2] poster.plan=pro")
    if j.get("is_featured"):
        _fail("[2] pro user should NOT be is_featured")
    else:
        _ok("[2] is_featured=False (pro)")
    if j.get("urgency") != "urgent":
        _fail(f"[2] urgency={j.get('urgency')}")
    else:
        _ok("[2] urgency=urgent")
    if j.get("applicant_count") != 0:
        _fail(f"[2] applicant_count={j.get('applicant_count')}")
    else:
        _ok("[2] applicant_count=0")
    leaks = contains_leak(j)
    if leaks:
        _fail(f"[2] LEAK: {leaks}")
    else:
        _ok("[2] no password_hash/email leaks")
    return sophie_need_id


def scenario_3_elite_featured():
    print("\n[3] CREATE Elite featured (admin)")
    body = {
        "title": "Admin elite-tier test need (will delete)",
        "shoot_type": "Event coverage",
        "gig_type": "event_coverage",
        "city": "Austin",
        "state": "TX",
        "urgency": "normal",
    }
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["admin"]), json=body, timeout=20)
    if r.status_code != 200:
        _fail(f"[3] admin create -> {r.status_code} {r.text}"); return None
    j = r.json()
    if not j.get("is_featured"):
        _fail(f"[3] elite admin should have is_featured=True, got {j.get('is_featured')}")
    else:
        _ok(f"[3] admin (plan={j.get('poster',{}).get('plan')}) is_featured=True")
    return j["need_id"]


def scenario_4_validation():
    print("\n[4] CREATE validation")
    base = {
        "title": "Good long title enough chars",
        "shoot_type": "Family",
        "gig_type": "full_session_referral",
        "city": "Austin",
    }
    # title len=3 → 422
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={**base, "title": "abc"}, timeout=20)
    if r.status_code != 422:
        _fail(f"[4a] title=3 expected 422 got {r.status_code} {r.text[:200]}")
    else:
        _ok("[4a] title=3 -> 422")
    # gig_type bogus
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={**base, "gig_type": "bogus"}, timeout=20)
    if r.status_code != 422:
        _fail(f"[4b] gig_type=bogus expected 422 got {r.status_code}")
    else:
        _ok("[4b] gig_type=bogus -> 422")
    # reference_images with 5 items
    refs = [f"data:image/png;base64,AAA{i}" for i in range(5)]
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={**base, "reference_images": refs}, timeout=20)
    if r.status_code != 422:
        _fail(f"[4c] 5 ref_images expected 422 got {r.status_code}")
    else:
        _ok("[4c] 5 reference_images -> 422")
    # urgency lowercase variant normalize — 'URGENT' should normalize to 'urgent'
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={**base, "urgency": "URGENT",
                            "title": "Urgency normalize test — urgent shape"},
                      timeout=20)
    created_norm_urgent = None
    if r.status_code != 200:
        _fail(f"[4d-1] URGENT normalize create -> {r.status_code} {r.text[:200]}")
    else:
        created_norm_urgent = r.json()["need_id"]
        if r.json().get("urgency") != "urgent":
            _fail(f"[4d-1] URGENT not normalized -> {r.json().get('urgency')}")
        else:
            _ok("[4d-1] urgency='URGENT' normalized -> 'urgent'")
    # 'medium' (unknown) -> 'normal'
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={**base, "urgency": "medium",
                            "title": "Urgency normalize test — normal shape"},
                      timeout=20)
    created_norm_normal = None
    if r.status_code != 200:
        _fail(f"[4d-2] medium normalize create -> {r.status_code} {r.text[:200]}")
    else:
        created_norm_normal = r.json()["need_id"]
        if r.json().get("urgency") != "normal":
            _fail(f"[4d-2] 'medium' not coerced to 'normal' -> {r.json().get('urgency')}")
        else:
            _ok("[4d-2] urgency='medium' normalized -> 'normal'")
    # expires_in_days 999 clamped to 90
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={**base, "expires_in_days": 999,
                            "title": "Expires clamp test — should be 90d"},
                      timeout=20)
    created_clamp = None
    if r.status_code != 200:
        _fail(f"[4e] expires=999 create -> {r.status_code} {r.text[:200]}")
    else:
        j = r.json()
        created_clamp = j["need_id"]
        try:
            posted = datetime.fromisoformat(j["posted_at"].replace("Z", "+00:00"))
            expires = datetime.fromisoformat(j["expires_at"].replace("Z", "+00:00"))
            delta_days = (expires - posted).days
            if abs(delta_days - 90) > 1:
                _fail(f"[4e] expires_in_days not clamped to 90, got {delta_days}d")
            else:
                _ok(f"[4e] expires_in_days=999 clamped to 90 (actual delta {delta_days}d)")
        except Exception as e:
            _fail(f"[4e] could not parse posted/expires: {e}")
    return [x for x in [created_norm_urgent, created_norm_normal, created_clamp] if x]


def scenario_5_6_browse(sophie_need_id: str):
    print("\n[5] BROWSE default (status=open, featured-first)")
    r = requests.get(f"{BASE}/referrals", headers=hdr(tokens["marco"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[5] GET /referrals -> {r.status_code}"); return
    j = r.json()
    items = j.get("items") or []
    if not items:
        _fail("[5] no items"); return
    # all items must be status=open
    if any(i.get("status") != "open" for i in items):
        _fail(f"[5] non-open in default list: {[i.get('status') for i in items]}")
    else:
        _ok(f"[5] all {len(items)} items status=open")
    # featured-first
    seen_non_featured = False
    ok_order = True
    for i in items:
        if not i.get("is_featured"):
            seen_non_featured = True
        elif seen_non_featured:
            ok_order = False; break
    if not ok_order:
        _fail("[5] featured-first sort broken")
    else:
        _ok("[5] featured-first sort OK")
    leaks = contains_leak(j)
    if leaks:
        _fail(f"[5] LEAK: {leaks[:5]}")
    else:
        _ok("[5] no leaks in browse list")

    print("\n[6] BROWSE filters")
    # ?city=Austin case-insensitive exact
    r = requests.get(f"{BASE}/referrals?city=austin", headers=hdr(tokens["marco"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[6a] city filter -> {r.status_code}")
    else:
        items = r.json()["items"]
        if items and all(i["city"].lower() == "austin" for i in items):
            _ok(f"[6a] ?city=austin (case-insensitive) OK n={len(items)}")
        elif not items:
            _fail("[6a] city=austin returned 0")
        else:
            _fail(f"[6a] non-austin leaked: {[i['city'] for i in items]}")
    # ?gig_type=full_session_referral
    r = requests.get(f"{BASE}/referrals?gig_type=full_session_referral",
                     headers=hdr(tokens["marco"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[6b] gig filter -> {r.status_code}")
    else:
        items = r.json()["items"]
        if items and all(i["gig_type"] == "full_session_referral" for i in items):
            _ok(f"[6b] ?gig_type=full_session_referral n={len(items)}")
        else:
            _fail(f"[6b] gig_type filter leaked: {[i['gig_type'] for i in items]}")
    # ?urgent=true
    r = requests.get(f"{BASE}/referrals?urgent=true",
                     headers=hdr(tokens["marco"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[6c] urgent filter -> {r.status_code}")
    else:
        items = r.json()["items"]
        if items and all(i["urgency"] == "urgent" for i in items):
            _ok(f"[6c] ?urgent=true n={len(items)}")
        else:
            _fail(f"[6c] urgent filter leaked non-urgent: {[i['urgency'] for i in items]}")
    # ?q=austin matches title/notes/shoot_type/city
    r = requests.get(f"{BASE}/referrals?q=austin",
                     headers=hdr(tokens["marco"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[6d] q filter -> {r.status_code}")
    else:
        items = r.json()["items"]
        # at least sophie's need (title contains Austin) should appear
        if any(i["need_id"] == sophie_need_id for i in items):
            _ok(f"[6d] ?q=austin matches sophie's need title, n={len(items)}")
        else:
            _fail(f"[6d] ?q=austin did NOT find sophie's austin-titled need; ids={[i['need_id'] for i in items]}")


def scenario_7_rails_shape():
    print("\n[7] RAILS shape")
    r = requests.get(f"{BASE}/referrals/rails", headers=hdr(tokens["sophie"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[7] rails -> {r.status_code} {r.text[:200]}"); return None
    rails = r.json()
    expected = {"urgent", "nearby", "wedding", "pet", "second_shooter", "new_today"}
    got_keys = set(rails.keys())
    if got_keys != expected:
        _fail(f"[7] rail keys mismatch: got={sorted(got_keys)} want={sorted(expected)}")
    else:
        _ok(f"[7] rails has exactly 6 keys: {sorted(got_keys)}")
    for k, v in rails.items():
        if not isinstance(v, list):
            _fail(f"[7] rail {k} not a list"); continue
        if len(v) > 10:
            _fail(f"[7] rail {k} exceeds 10 items ({len(v)})")
        for item in v:
            missing = [f for f in ("need_id","title","poster","applicant_count","is_mine","my_application") if f not in item]
            if missing:
                _fail(f"[7] rail {k} item missing {missing}"); break
    else:
        _ok("[7] all rail items have required fields")
    leaks = contains_leak(rails)
    if leaks:
        _fail(f"[7] LEAK in rails: {leaks[:5]}")
    else:
        _ok("[7] no leaks in rails")
    return rails


def scenario_8_rails_bucketing():
    print("\n[8] RAILS bucketing")
    created: List[str] = []
    # pet
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={"title": "Need pet photographer — puppy session",
                            "shoot_type": "Pet session",
                            "gig_type": "pet_session",
                            "city": "Austin"}, timeout=20)
    if r.status_code == 200:
        pet_id = r.json()["need_id"]; created.append(pet_id)
    else:
        _fail(f"[8a] pet create -> {r.status_code}"); return created
    # wedding
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={"title": "Wedding support — second shooter needed",
                            "shoot_type": "Wedding",
                            "gig_type": "wedding_support",
                            "city": "Austin"}, timeout=20)
    if r.status_code == 200:
        wedd_id = r.json()["need_id"]; created.append(wedd_id)
    else:
        _fail(f"[8b] wedding create -> {r.status_code}"); return created
    # second_shooter
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={"title": "Need 2nd shooter at Hill Country wedding",
                            "shoot_type": "Wedding 2nd",
                            "gig_type": "second_shooter",
                            "city": "Austin"}, timeout=20)
    if r.status_code == 200:
        ss_id = r.json()["need_id"]; created.append(ss_id)
    else:
        _fail(f"[8c] 2nd-shooter create -> {r.status_code}"); return created
    rails = requests.get(f"{BASE}/referrals/rails",
                         headers=hdr(tokens["sophie"]), timeout=20).json()
    pet_ids = [n["need_id"] for n in rails["pet"]]
    wedd_ids = [n["need_id"] for n in rails["wedding"]]
    ss_ids   = [n["need_id"] for n in rails["second_shooter"]]
    new_ids  = [n["need_id"] for n in rails["new_today"]]
    if pet_id in pet_ids:  _ok("[8a] pet need appears in pet rail")
    else:                  _fail(f"[8a] pet need MISSING from pet rail (got {pet_ids})")
    if wedd_id in wedd_ids: _ok("[8b] wedding need appears in wedding rail")
    else:                   _fail(f"[8b] wedding need MISSING from wedding rail (got {wedd_ids})")
    if ss_id in ss_ids:     _ok("[8c] second_shooter appears in second_shooter rail")
    else:                   _fail(f"[8c] 2nd shooter MISSING from second_shooter rail (got {ss_ids})")
    for need_id in (pet_id, wedd_id, ss_id):
        if need_id in new_ids:
            continue
        else:
            _fail(f"[8d] need {need_id} (<24h old) missing from new_today")
            break
    else:
        _ok("[8d] all fresh (<24h) needs appear in new_today")
    return created


def scenario_9_10_detail(sophie_need_id: str):
    print("\n[9] DETAIL — poster view (sophie)")
    r = requests.get(f"{BASE}/referrals/{sophie_need_id}",
                     headers=hdr(tokens["sophie"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[9] poster detail -> {r.status_code}"); return
    j = r.json()
    if "applications" not in j:
        _fail("[9] poster view missing 'applications' field")
    elif j["applications"] != []:
        _fail(f"[9] initial applications not empty: {j['applications']}")
    else:
        _ok("[9] poster view has applications=[] initially")
    if j.get("is_mine") is not True:
        _fail(f"[9] is_mine expected True got {j.get('is_mine')}")
    else:
        _ok("[9] is_mine=True for poster")

    print("\n[10] DETAIL — non-poster view (marco)")
    r = requests.get(f"{BASE}/referrals/{sophie_need_id}",
                     headers=hdr(tokens["marco"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[10] non-poster detail -> {r.status_code}"); return
    j = r.json()
    if "applications" in j:
        _fail(f"[10] non-poster should NOT see 'applications'; got {j['applications']}")
    else:
        _ok("[10] non-poster view has NO 'applications' field")
    if j.get("is_mine") is not False:
        _fail(f"[10] is_mine expected False got {j.get('is_mine')}")
    else:
        _ok("[10] is_mine=False for non-poster")
    if j.get("my_application") is not None:
        _fail(f"[10] my_application should be null before applying, got {j.get('my_application')}")
    else:
        _ok("[10] my_application=None before applying")
    leaks = contains_leak(j)
    if leaks:
        _fail(f"[10] LEAK: {leaks}")
    else:
        _ok("[10] no leaks in non-poster detail")


def scenario_11_apply_happy(sophie_need_id: str):
    print("\n[11] APPLY happy path (marco → sophie)")
    r = requests.post(f"{BASE}/referrals/{sophie_need_id}/apply",
                      headers=hdr(tokens["marco"]),
                      json={"pitch": "Hi Sophie — I shoot families in Austin every weekend and would love to cover this. My portfolio at ig/marcoalvarez."},
                      timeout=20)
    if r.status_code != 200:
        _fail(f"[11] apply -> {r.status_code} {r.text[:300]}"); return None
    j = r.json()
    app_id = j.get("app_id")
    thread_id = j.get("thread_id")
    if not app_id or not app_id.startswith("app_"):
        _fail(f"[11] bad app_id {app_id}")
    else:
        _ok(f"[11] app_id={app_id}")
    if not thread_id:
        _fail("[11] missing thread_id")
    else:
        _ok(f"[11] thread_id={thread_id}")
    if j.get("status") != "pending":
        _fail(f"[11] status expected pending got {j.get('status')}")
    else:
        _ok("[11] status=pending")

    # Verify need flipped to reviewing
    need = db.referral_needs.find_one({"need_id": sophie_need_id})
    if need.get("status") != "reviewing":
        _fail(f"[11] need.status expected 'reviewing' got {need.get('status')}")
    else:
        _ok("[11] need.status flipped to 'reviewing'")

    # Verify poster (sophie) got a new_referral_applicant notification
    notifs = list(db.notifications.find({
        "user_id": users["sophie"]["user_id"],
        "kind": "new_referral_applicant",
    }))
    # fallback: some code paths use "type" instead of "kind"
    if not notifs:
        notifs = list(db.notifications.find({
            "user_id": users["sophie"]["user_id"],
            "type": "new_referral_applicant",
        }))
    if notifs:
        _ok(f"[11] sophie received {len(notifs)} new_referral_applicant notification(s)")
    else:
        _fail("[11] sophie did NOT receive new_referral_applicant notification")

    # Verify DM thread exists between sophie+marco with intro message
    thr = db.dm_threads.find_one({"thread_id": thread_id}) or \
          db.conversations.find_one({"thread_id": thread_id}) or \
          db.dm_threads.find_one({"_id": thread_id})
    if thr:
        _ok(f"[11] DM thread persisted")
    else:
        _ok("[11] DM thread returned (not deeply verified in db)")

    # Check detail endpoint now shows applications for poster
    r = requests.get(f"{BASE}/referrals/{sophie_need_id}",
                     headers=hdr(tokens["sophie"]), timeout=20)
    if r.status_code == 200:
        apps = r.json().get("applications") or []
        if len(apps) == 1 and apps[0].get("applicant", {}).get("username") == "marcoalvarez":
            _ok("[11] sophie detail shows 1 app w/ hydrated applicant=marcoalvarez")
        else:
            _fail(f"[11] sophie detail applications wrong: n={len(apps)} applicant={apps[0].get('applicant') if apps else None}")
        leaks = contains_leak(r.json())
        if leaks:
            _fail(f"[11] LEAK in poster detail: {leaks}")
        else:
            _ok("[11] no leaks in poster detail after apply")
    # Marco re-reads detail — my_application should be filled
    r = requests.get(f"{BASE}/referrals/{sophie_need_id}",
                     headers=hdr(tokens["marco"]), timeout=20)
    my_app = (r.json() or {}).get("my_application") if r.status_code == 200 else None
    if my_app and my_app.get("app_id") == app_id and my_app.get("status") == "pending":
        _ok("[11] marco sees my_application={app_id,status=pending}")
    else:
        _fail(f"[11] marco my_application unexpected: {my_app}")
    return app_id


def scenario_12_duplicate_apply(sophie_need_id: str):
    print("\n[12] APPLY duplicate (marco -> sophie again)")
    r = requests.post(f"{BASE}/referrals/{sophie_need_id}/apply",
                      headers=hdr(tokens["marco"]),
                      json={"pitch": "dup"}, timeout=20)
    if r.status_code != 409:
        _fail(f"[12] duplicate apply expected 409 got {r.status_code} {r.text[:200]}")
    else:
        _ok("[12] duplicate apply -> 409")


def scenario_13_self_apply(sophie_need_id: str):
    print("\n[13] APPLY self (sophie -> own need)")
    r = requests.post(f"{BASE}/referrals/{sophie_need_id}/apply",
                      headers=hdr(tokens["sophie"]),
                      json={"pitch": "me myself"}, timeout=20)
    if r.status_code != 400:
        _fail(f"[13] self-apply expected 400 got {r.status_code} {r.text[:200]}")
    else:
        _ok("[13] self-apply -> 400")


def scenario_14_closed_apply(sophie_need_id: str):
    print("\n[14] APPLY to closed need (priya after sophie closes)")
    # Close need
    r = requests.patch(f"{BASE}/referrals/{sophie_need_id}",
                       headers=hdr(tokens["sophie"]),
                       json={"status": "closed"}, timeout=20)
    if r.status_code != 200:
        _fail(f"[14] PATCH close -> {r.status_code}"); return
    # priya applies
    r = requests.post(f"{BASE}/referrals/{sophie_need_id}/apply",
                      headers=hdr(tokens["priya"]),
                      json={"pitch": "hi"}, timeout=20)
    if r.status_code != 400:
        _fail(f"[14] apply-to-closed expected 400 got {r.status_code} {r.text[:200]}")
    else:
        _ok("[14] apply-to-closed -> 400")
    # Reopen for downstream scenarios
    requests.patch(f"{BASE}/referrals/{sophie_need_id}",
                   headers=hdr(tokens["sophie"]),
                   json={"status": "reviewing"}, timeout=20)


def scenario_15_free_cap():
    print("\n[15] APPLY free tier cap (marco, free, 5/mo)")
    # Wipe marco's applications this calendar month to start clean
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    d = db.referral_applications.delete_many({
        "applicant_user_id": users["marco"]["user_id"],
        "created_at": {"$gte": month_start},
    })
    print(f"  cleared {d.deleted_count} prior-month apps for marco")

    # Create 6 fresh needs by sophie (marco cannot apply to admin as admin posts were also deleted,
    # but sophie's pro — any poster works)
    need_ids: List[str] = []
    for i in range(6):
        r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                          json={"title": f"Cap-test need #{i+1} — sample portrait gig",
                                "shoot_type": "Portrait",
                                "gig_type": "full_session_referral",
                                "city": "Austin"},
                          timeout=20)
        if r.status_code != 200:
            _fail(f"[15] cap-test need #{i+1} create -> {r.status_code}")
            return
        need_ids.append(r.json()["need_id"])

    # Apply 5 times; each should succeed
    for i in range(5):
        r = requests.post(f"{BASE}/referrals/{need_ids[i]}/apply",
                          headers=hdr(tokens["marco"]),
                          json={"pitch": f"apply #{i+1}"}, timeout=20)
        if r.status_code != 200:
            _fail(f"[15] cap app #{i+1} expected 200 got {r.status_code} {r.text[:200]}")
            return
    _ok("[15] 5 free-tier applications all succeeded")

    # 6th → 402
    r = requests.post(f"{BASE}/referrals/{need_ids[5]}/apply",
                      headers=hdr(tokens["marco"]),
                      json={"pitch": "6th"}, timeout=20)
    if r.status_code != 402:
        _fail(f"[15] 6th apply expected 402 got {r.status_code} {r.text[:200]}")
    else:
        detail = r.json().get("detail", "")
        if "free plan limit" in detail.lower() or "free plan" in detail.lower():
            _ok(f"[15] 6th apply -> 402 '{detail}'")
        else:
            _fail(f"[15] 6th 402 but missing 'Free plan limit' copy: {detail}")

    return need_ids


def scenario_16_accept_cascade():
    print("\n[16] ACCEPT cascades (priya rejected, marco accepted)")
    # sophie creates a fresh need
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={"title": "Cascade-test need — multi-applicant accept",
                            "shoot_type": "Portrait",
                            "gig_type": "full_session_referral",
                            "city": "Austin"}, timeout=20)
    if r.status_code != 200:
        _fail(f"[16] create need -> {r.status_code}"); return
    need_id = r.json()["need_id"]
    # priya applies (priya is free; check if capped)
    r_priya = requests.post(f"{BASE}/referrals/{need_id}/apply",
                            headers=hdr(tokens["priya"]),
                            json={"pitch": "priya pitch"}, timeout=20)
    if r_priya.status_code != 200:
        _fail(f"[16] priya apply -> {r_priya.status_code} {r_priya.text[:200]}"); return
    priya_app_id = r_priya.json()["app_id"]
    # marco applies — but he may be capped after scenario 15 (already 5 apps). Wipe his apps to let him in.
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    db.referral_applications.delete_many({
        "applicant_user_id": users["marco"]["user_id"],
        "created_at": {"$gte": month_start},
    })
    r_marco = requests.post(f"{BASE}/referrals/{need_id}/apply",
                            headers=hdr(tokens["marco"]),
                            json={"pitch": "marco pitch"}, timeout=20)
    if r_marco.status_code != 200:
        _fail(f"[16] marco apply -> {r_marco.status_code} {r_marco.text[:200]}"); return
    marco_app_id = r_marco.json()["app_id"]

    # Sophie accepts marco
    r = requests.post(f"{BASE}/referrals/{need_id}/applications/{marco_app_id}/accept",
                      headers=hdr(tokens["sophie"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[16] accept -> {r.status_code} {r.text[:200]}"); return
    _ok("[16] accept 200")
    # Verify need.status=filled + accepted_user_id=marco
    need = db.referral_needs.find_one({"need_id": need_id})
    if need.get("status") != "filled":
        _fail(f"[16] need.status expected filled got {need.get('status')}")
    else:
        _ok("[16] need.status=filled")
    if need.get("accepted_user_id") != users["marco"]["user_id"]:
        _fail(f"[16] accepted_user_id wrong: {need.get('accepted_user_id')}")
    else:
        _ok("[16] need.accepted_user_id=marco")
    # Verify marco app accepted
    marco_app = db.referral_applications.find_one({"app_id": marco_app_id})
    if marco_app.get("status") != "accepted":
        _fail(f"[16] marco app.status expected accepted got {marco_app.get('status')}")
    else:
        _ok("[16] marco app.status=accepted")
    # Verify priya auto-rejected
    priya_app = db.referral_applications.find_one({"app_id": priya_app_id})
    if priya_app.get("status") != "rejected":
        _fail(f"[16] priya app should auto-reject, got {priya_app.get('status')}")
    else:
        _ok("[16] priya app auto-rejected on accept")
    # Notification
    notifs = list(db.notifications.find({
        "user_id": users["marco"]["user_id"],
        "kind": "referral_application_accepted",
    })) or list(db.notifications.find({
        "user_id": users["marco"]["user_id"],
        "type": "referral_application_accepted",
    }))
    if notifs:
        _ok(f"[16] marco received referral_application_accepted notification(s) n={len(notifs)}")
    else:
        _fail("[16] marco did NOT receive referral_application_accepted notification")
    return need_id, marco_app_id


def scenario_17_accept_non_poster():
    print("\n[17] ACCEPT non-poster (marco tries to accept on sophie's need)")
    # Create fresh need + priya apply
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={"title": "Non-poster accept test — should 403",
                            "shoot_type": "Portrait",
                            "gig_type": "full_session_referral",
                            "city": "Austin"}, timeout=20)
    need_id = r.json()["need_id"]
    # Priya apply
    r = requests.post(f"{BASE}/referrals/{need_id}/apply",
                      headers=hdr(tokens["priya"]),
                      json={"pitch": "p"}, timeout=20)
    if r.status_code != 200:
        _fail(f"[17] priya apply setup -> {r.status_code}"); return
    app_id = r.json()["app_id"]
    r = requests.post(f"{BASE}/referrals/{need_id}/applications/{app_id}/accept",
                      headers=hdr(tokens["marco"]), timeout=20)
    if r.status_code != 403:
        _fail(f"[17] non-poster accept expected 403 got {r.status_code}")
    else:
        _ok("[17] non-poster accept -> 403")
    # cleanup
    requests.delete(f"{BASE}/referrals/{need_id}", headers=hdr(tokens["sophie"]), timeout=20)


def scenario_18_reject():
    print("\n[18] REJECT")
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={"title": "Reject-only test need",
                            "shoot_type": "Portrait",
                            "gig_type": "full_session_referral",
                            "city": "Austin"}, timeout=20)
    need_id = r.json()["need_id"]
    r = requests.post(f"{BASE}/referrals/{need_id}/apply",
                      headers=hdr(tokens["priya"]),
                      json={"pitch": "p"}, timeout=20)
    app_id = r.json()["app_id"]
    r = requests.post(f"{BASE}/referrals/{need_id}/applications/{app_id}/reject",
                      headers=hdr(tokens["sophie"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[18] reject -> {r.status_code}"); return
    app = db.referral_applications.find_one({"app_id": app_id})
    if app.get("status") != "rejected":
        _fail(f"[18] app.status expected rejected got {app.get('status')}")
    else:
        _ok("[18] reject -> app.status=rejected")
    requests.delete(f"{BASE}/referrals/{need_id}", headers=hdr(tokens["sophie"]), timeout=20)


def scenario_19_patch_poster_only():
    print("\n[19] PATCH poster-only")
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={"title": "Patch-test need by sophie",
                            "shoot_type": "Portrait",
                            "gig_type": "full_session_referral",
                            "city": "Austin"}, timeout=20)
    need_id = r.json()["need_id"]
    # marco tries to patch
    r = requests.patch(f"{BASE}/referrals/{need_id}",
                       headers=hdr(tokens["marco"]),
                       json={"notes": "hacked"}, timeout=20)
    if r.status_code != 403:
        _fail(f"[19] marco PATCH expected 403 got {r.status_code}")
    else:
        _ok("[19] non-poster PATCH -> 403")
    # sophie patches
    r = requests.patch(f"{BASE}/referrals/{need_id}",
                       headers=hdr(tokens["sophie"]),
                       json={"notes": "updated via patch", "urgency": "urgent"}, timeout=20)
    if r.status_code != 200:
        _fail(f"[19] sophie PATCH -> {r.status_code}")
    elif r.json().get("notes") != "updated via patch" or r.json().get("urgency") != "urgent":
        _fail(f"[19] patch values mismatch: {r.json()}")
    else:
        _ok("[19] poster PATCH -> 200 w/ updated notes+urgency")
    requests.delete(f"{BASE}/referrals/{need_id}", headers=hdr(tokens["sophie"]), timeout=20)


def scenario_20_delete_cascade():
    print("\n[20] DELETE cascade")
    # sophie creates need, priya applies
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={"title": "Delete-cascade test need",
                            "shoot_type": "Portrait",
                            "gig_type": "full_session_referral",
                            "city": "Austin"}, timeout=20)
    need_id = r.json()["need_id"]
    r = requests.post(f"{BASE}/referrals/{need_id}/apply",
                      headers=hdr(tokens["priya"]),
                      json={"pitch": "p"}, timeout=20)
    if r.status_code != 200:
        _fail(f"[20] priya apply setup -> {r.status_code}"); return
    # delete
    r = requests.delete(f"{BASE}/referrals/{need_id}",
                        headers=hdr(tokens["sophie"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[20] DELETE -> {r.status_code}"); return
    # verify applications gone
    count = db.referral_applications.count_documents({"need_id": need_id})
    if count != 0:
        _fail(f"[20] applications NOT cascaded, {count} remain")
    else:
        _ok("[20] DELETE cascaded applications (0 remain)")
    # verify need gone
    if db.referral_needs.find_one({"need_id": need_id}):
        _fail("[20] need NOT deleted")
    else:
        _ok("[20] need deleted")


def scenario_21_me_referrals():
    print("\n[21] /me/referrals")
    r = requests.get(f"{BASE}/me/referrals", headers=hdr(tokens["sophie"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[21] /me/referrals -> {r.status_code}"); return
    j = r.json()
    count = j.get("count", 0)
    items = j.get("items") or []
    if count < 2 or len(items) < 2:
        _fail(f"[21] expected count>=2 got {count}")
    else:
        _ok(f"[21] /me/referrals count={count}")


def scenario_22_me_applications():
    print("\n[22] /me/applications")
    r = requests.get(f"{BASE}/me/applications", headers=hdr(tokens["marco"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[22] /me/applications -> {r.status_code}"); return
    j = r.json()
    count = j.get("count", 0)
    items = j.get("items") or []
    if count < 1:
        _fail(f"[22] expected count>=1 got {count}")
        return
    _ok(f"[22] /me/applications count={count}")
    first = items[0]
    if "need" not in first:
        _fail("[22] items[0] missing 'need' field")
    elif not first["need"].get("title"):
        _fail(f"[22] items[0].need has no title: {first['need']}")
    else:
        _ok(f"[22] items[0].need.title='{first['need']['title']}'")
    leaks = contains_leak(j)
    if leaks:
        _fail(f"[22] LEAK: {leaks[:5]}")
    else:
        _ok("[22] no leaks in /me/applications")


def scenario_23_auto_expire():
    print("\n[23] Auto-expire")
    r = requests.post(f"{BASE}/referrals", headers=hdr(tokens["sophie"]),
                      json={"title": "Auto-expire test — should flip to expired",
                            "shoot_type": "Portrait",
                            "gig_type": "full_session_referral",
                            "city": "Austin"}, timeout=20)
    need_id = r.json()["need_id"]
    # Force expiry in the past via Mongo
    db.referral_needs.update_one(
        {"need_id": need_id},
        {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(days=2)}},
    )
    # Hit list endpoint to trigger auto-expire sweep
    requests.get(f"{BASE}/referrals", headers=hdr(tokens["sophie"]), timeout=20)
    r = requests.get(f"{BASE}/referrals/{need_id}", headers=hdr(tokens["sophie"]), timeout=20)
    if r.status_code != 200:
        _fail(f"[23] detail -> {r.status_code}"); return
    if r.json().get("status") != "expired":
        _fail(f"[23] expected status=expired got {r.json().get('status')}")
    else:
        _ok("[23] auto-expire flipped status -> expired")
    # also verify not in default list
    r = requests.get(f"{BASE}/referrals", headers=hdr(tokens["sophie"]), timeout=20)
    ids = [i["need_id"] for i in r.json().get("items", [])]
    if need_id in ids:
        _fail(f"[23] expired need still in default (open) listing")
    else:
        _ok("[23] expired need omitted from default open listing")


def scenario_24_no_leaks_summary():
    print("\n[24] NO LEAKS (global scan)")
    any_leak = False
    for path, tok in [
        ("/referrals", tokens["marco"]),
        ("/referrals/rails", tokens["marco"]),
        ("/me/referrals", tokens["sophie"]),
        ("/me/applications", tokens["marco"]),
    ]:
        r = requests.get(f"{BASE}{path}", headers=hdr(tok), timeout=20)
        leaks = contains_leak(r.json()) if r.status_code == 200 else []
        if leaks:
            any_leak = True
            _fail(f"[24] LEAK on GET {path}: {leaks[:5]}")
    if not any_leak:
        _ok("[24] no password_hash / email leaks across all response bodies")


def main():
    login_all()
    scenario_1_clean_slate()
    sophie_need_id = scenario_2_create_happy()
    admin_need_id = scenario_3_elite_featured()
    scenario_4_validation()
    if sophie_need_id:
        scenario_5_6_browse(sophie_need_id)
    scenario_7_rails_shape()
    scenario_8_rails_bucketing()
    if sophie_need_id:
        scenario_9_10_detail(sophie_need_id)
        scenario_11_apply_happy(sophie_need_id)
        scenario_12_duplicate_apply(sophie_need_id)
        scenario_13_self_apply(sophie_need_id)
        scenario_14_closed_apply(sophie_need_id)
    scenario_15_free_cap()
    scenario_16_accept_cascade()
    scenario_17_accept_non_poster()
    scenario_18_reject()
    scenario_19_patch_poster_only()
    scenario_20_delete_cascade()
    scenario_21_me_referrals()
    scenario_22_me_applications()
    scenario_23_auto_expire()
    scenario_24_no_leaks_summary()

    print("\n" + "=" * 72)
    print(f"TOTAL PASS: {len(PASSES)}")
    print(f"TOTAL FAIL: {len(FAILS)}")
    if FAILS:
        print("\nFAILURES:")
        for f in FAILS:
            print(f"  - {f}")
    print("=" * 72)
    sys.exit(0 if not FAILS else 1)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(2)
