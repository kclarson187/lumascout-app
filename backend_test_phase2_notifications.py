"""
Feature 9 Phase 2 backend validation.

Scope (per review request):
 1) GET /api/notifications  (auth, shape, ?unread_only, ?limit≤100)
 2) POST /api/notifications/mark-read (body {} = all, ?notification_id = one,
    no cross-user leakage)
 3) Notification emission side-effects:
       a) tester saves spot X
       b) admin uploads → tester gets saved_spot_fresh_photo
       c) condition_tags=[verified_today] → also saved_spot_verified
       d) condition_tags=[blooming] → also saved_spot_blooming
       e) tester hearts admin upload → admin gets upload_reaction
       f) admin approves tester's pending upload → tester gets upload_approve
       g) admin set_as_cover → tester gets upload_set_as_cover
       h) self-notification suppressed when actor == user
 4) /api/feed/home new rails present + correctness
 5) /api/spots/{id} new fields (hero_cover_image_url, hero_cover_source,
    seasonal_timeline, seasonal_timeline_total)
 6) Followers-only visibility filter on GET /api/spots/{id}/uploads
 7) Admin auto-approval: verified user path
Also cleans up created test entities at the end.
"""

import os
import sys
import uuid
import base64
import time
import json
from typing import Optional, List, Dict, Any

import requests

BASE_URL = os.environ.get("BASE_URL", "https://photo-finder-60.preview.emergentagent.com/api")
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

# Tiny 1×1 PNG (base64 data URI-ready)
PNG_1X1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/"
    "PchI7wAAAABJRU5ErkJggg=="
)


PASS = 0
FAIL = 0
FAILS: List[str] = []


def say(msg: str) -> None:
    print(msg, flush=True)


def check(name: str, ok: bool, detail: str = "") -> bool:
    global PASS, FAIL
    if ok:
        PASS += 1
        say(f"  ✅ {name}")
    else:
        FAIL += 1
        FAILS.append(f"{name} — {detail}")
        say(f"  ❌ {name}  {detail}")
    return ok


def login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"Login failed for {email}: {r.status_code} {r.text[:200]}")
    data = r.json()
    return data.get("token") or data.get("access_token")


def register(email: str, password: str, name: str) -> Dict[str, Any]:
    r = requests.post(
        f"{BASE_URL}/auth/register",
        json={"email": email, "password": password, "name": name},
        timeout=30,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Register failed for {email}: {r.status_code} {r.text[:300]}")
    return r.json()


def headers(token: Optional[str]) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


def me(token: str) -> Dict[str, Any]:
    r = requests.get(f"{BASE_URL}/auth/me", headers=headers(token), timeout=30)
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Helpers for the tests
# ---------------------------------------------------------------------------

def _img_data_uri() -> str:
    return f"data:image/png;base64,{PNG_1X1}"


def admin_create_spot(admin_token: str, title: str) -> Optional[str]:
    """Create a spot owned by admin and return its spot_id."""
    body = {
        "title": title,
        "description": f"QA Phase 2 {title}",
        "city": "Austin",
        "state": "TX",
        "country_code": "US",
        "latitude": 30.2672,
        "longitude": -97.7431,
        "shoot_types": ["Family"],
        "tags": ["qa_phase2"],
        "privacy_mode": "public",
        "cover_image_base64": _img_data_uri(),
        "images": [{"image_url": _img_data_uri(), "is_cover": True}],
    }
    r = requests.post(f"{BASE_URL}/spots", json=body, headers=headers(admin_token), timeout=60)
    if r.status_code != 200:
        say(f"    [debug] admin_create_spot error {r.status_code}: {r.text[:300]}")
        return None
    return r.json().get("spot_id")


def admin_hard_delete_spot(admin_token: str, spot_id: str) -> bool:
    r = requests.delete(
        f"{BASE_URL}/admin/spots/{spot_id}",
        json={"reason_code": "qa_test", "reason_note": "phase2 cleanup"},
        headers=headers(admin_token),
        timeout=60,
    )
    return r.status_code == 200


def admin_soft_delete_user(admin_token: str, user_id: str) -> bool:
    r = requests.delete(
        f"{BASE_URL}/admin/users/{user_id}",
        json={"reason_code": "qa_test", "reason_note": "phase2 cleanup"},
        headers=headers(admin_token),
        timeout=60,
    )
    return r.status_code == 200


def admin_patch_user(admin_token: str, user_id: str, patch: dict) -> bool:
    r = requests.patch(
        f"{BASE_URL}/admin/users/{user_id}",
        json=patch,
        headers=headers(admin_token),
        timeout=30,
    )
    return r.status_code == 200


def save_spot(token: str, spot_id: str) -> bool:
    # /api/saves doesn't exist — the implementation uses POST /spots/{id}/save
    r = requests.post(f"{BASE_URL}/spots/{spot_id}/save", headers=headers(token), timeout=30)
    return r.status_code == 200 and r.json().get("saved") is True


def list_notifications(token: str, unread_only: bool = False, limit: int = 50) -> dict:
    params: Dict[str, Any] = {"limit": limit}
    if unread_only:
        params["unread_only"] = "true"
    r = requests.get(f"{BASE_URL}/notifications", params=params, headers=headers(token), timeout=30)
    r.raise_for_status()
    return r.json()


def mark_read(token: str, notification_id: Optional[str] = None) -> dict:
    params = {"notification_id": notification_id} if notification_id else None
    r = requests.post(
        f"{BASE_URL}/notifications/mark-read",
        headers=headers(token),
        params=params,
        json={},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def main() -> int:
    say(f"🎯 Phase 2 backend test — base={BASE_URL}")
    say("")

    # ---- Auth ----
    say("Logging in…")
    admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    admin_me = me(admin_token)
    say(f"  admin user_id={admin_me['user_id']} role={admin_me.get('role')} verified={admin_me.get('verification_status')}")
    admin_uid = admin_me["user_id"]

    # Fresh tester
    ts = int(time.time())
    tester_email = f"qa.phase2.tester.{ts}.{uuid.uuid4().hex[:6]}@photoscout.app"
    tester_name = "QA Phase2 Tester"
    tester_register_resp = register(tester_email, "demo12345", tester_name)
    tester_token = tester_register_resp.get("token") or login(tester_email, "demo12345")
    tester_me = me(tester_token)
    tester_uid = tester_me["user_id"]
    say(f"  tester user_id={tester_uid} verified={tester_me.get('verification_status')}")

    # Secondary tester (for follower relationship tests)
    viewer_email = f"qa.phase2.viewer.{ts}.{uuid.uuid4().hex[:6]}@photoscout.app"
    viewer_register_resp = register(viewer_email, "demo12345", "QA Phase2 Viewer")
    viewer_token = viewer_register_resp.get("token") or login(viewer_email, "demo12345")
    viewer_me = me(viewer_token)
    viewer_uid = viewer_me["user_id"]

    # Track IDs for cleanup
    created_spot_ids: List[str] = []
    created_user_ids: List[str] = [tester_uid, viewer_uid]

    try:
        # ===================================================================
        # 1) GET /api/notifications — auth + shape + filters
        # ===================================================================
        say("\n[1] GET /api/notifications — shape + filters")
        # Unauth → 401
        r = requests.get(f"{BASE_URL}/notifications", timeout=20)
        check("notifications requires auth (401)", r.status_code == 401, f"got {r.status_code}")
        # Empty tester inbox
        inbox = list_notifications(tester_token)
        check("/notifications returns items+unread_count", "items" in inbox and "unread_count" in inbox,
              f"keys={list(inbox.keys())}")
        check("fresh tester starts empty (unread_count==0)", inbox["unread_count"] == 0 and inbox["items"] == [],
              f"got unread={inbox['unread_count']} items={len(inbox['items'])}")

        # limit capping (>100 should be clamped to 100)
        r = requests.get(f"{BASE_URL}/notifications?limit=500", headers=headers(tester_token), timeout=20)
        check("?limit=500 accepted (clamped server-side)", r.status_code == 200, f"got {r.status_code}")
        # unread_only filter roundtrip (empty now, both should work)
        u_only = list_notifications(tester_token, unread_only=True)
        check("?unread_only=true returns valid shape", isinstance(u_only.get("items"), list),
              f"items type={type(u_only.get('items'))}")

        # ===================================================================
        # 3a) TESTER saves spot X
        # 7)  Admin auto-approval (admin is super_admin, always auto-approved)
        # ===================================================================
        say("\n[3a/7] Create spot X owned by admin, tester saves it")
        spot_x_id = admin_create_spot(admin_token, f"QA Phase2 Spot X {ts}")
        check("admin created spot X", bool(spot_x_id), "spot_id is None")
        if not spot_x_id:
            raise SystemExit("cannot continue without spot X")
        created_spot_ids.append(spot_x_id)

        saved = save_spot(tester_token, spot_x_id)
        check("tester saved spot X", saved, "save returned false")

        # ===================================================================
        # 3b) admin uploads → tester gets saved_spot_fresh_photo notif
        # ===================================================================
        say("\n[3b] Admin posts upload → tester gets saved_spot_fresh_photo")
        body = {
            "images": [{"image_url": _img_data_uri(), "caption": "admin drop 1"}],
            "caption": "golden hour ending soon",
            "condition_tags": [],
        }
        r = requests.post(f"{BASE_URL}/spots/{spot_x_id}/uploads", json=body,
                          headers=headers(admin_token), timeout=60)
        ok = r.status_code == 200 and r.json().get("auto_approved") is True
        check("admin upload auto-approved", ok, f"{r.status_code} {r.text[:200]}")

        # tester inbox should now contain saved_spot_fresh_photo
        inbox = list_notifications(tester_token)
        fresh = [n for n in inbox["items"] if n["kind"] == "saved_spot_fresh_photo"]
        check("tester received saved_spot_fresh_photo", len(fresh) >= 1,
              f"items kinds={[n['kind'] for n in inbox['items']]}")
        if fresh:
            n = fresh[0]
            required_keys = ["notification_id", "user_id", "kind", "title", "body",
                             "actor_user_id", "spot_id", "upload_id", "image_url",
                             "deep_link", "read_at", "created_at", "actor"]
            missing = [k for k in required_keys if k not in n]
            check("notif carries all required keys", not missing, f"missing={missing}")
            check("notif.actor hydrated with name/avatar", isinstance(n.get("actor"), dict) and n["actor"].get("user_id") == admin_uid,
                  f"actor={n.get('actor')}")
            check("notif.spot_id == spot X", n.get("spot_id") == spot_x_id, f"got {n.get('spot_id')}")
            check("notif.deep_link points at spot", n.get("deep_link") == f"/spot/{spot_x_id}",
                  f"got {n.get('deep_link')}")
            check("notif.read_at is None (unread)", n.get("read_at") is None, f"read_at={n.get('read_at')}")
            check("notif.actor_user_id == admin", n.get("actor_user_id") == admin_uid,
                  f"got {n.get('actor_user_id')}")

        # ===================================================================
        # 3c) condition_tags=[verified_today] → saved_spot_verified
        # ===================================================================
        say("\n[3c] Upload with condition_tags=['verified_today'] → saved_spot_verified")
        body = {
            "images": [{"image_url": _img_data_uri()}],
            "caption": "verified today test",
            "condition_tags": ["verified_today"],
        }
        r = requests.post(f"{BASE_URL}/spots/{spot_x_id}/uploads", json=body,
                          headers=headers(admin_token), timeout=60)
        check("admin verified_today upload 200", r.status_code == 200,
              f"{r.status_code} {r.text[:200]}")
        inbox = list_notifications(tester_token)
        ver = [n for n in inbox["items"] if n["kind"] == "saved_spot_verified"]
        check("tester received saved_spot_verified", len(ver) >= 1,
              f"kinds={[n['kind'] for n in inbox['items']]}")

        # ===================================================================
        # 3d) condition_tags=[blooming] → saved_spot_blooming
        # ===================================================================
        say("\n[3d] Upload with condition_tags=['blooming'] → saved_spot_blooming")
        body = {
            "images": [{"image_url": _img_data_uri()}],
            "caption": "blooming test",
            "condition_tags": ["blooming"],
        }
        r = requests.post(f"{BASE_URL}/spots/{spot_x_id}/uploads", json=body,
                          headers=headers(admin_token), timeout=60)
        check("admin blooming upload 200", r.status_code == 200,
              f"{r.status_code} {r.text[:200]}")
        inbox = list_notifications(tester_token)
        blo = [n for n in inbox["items"] if n["kind"] == "saved_spot_blooming"]
        check("tester received saved_spot_blooming", len(blo) >= 1,
              f"kinds={[n['kind'] for n in inbox['items']]}")

        # ===================================================================
        # 3h) Self-notifications suppressed: admin saves own spot, then admin uploads
        # ===================================================================
        say("\n[3h] Self-notifications suppressed (admin saves + uploads own spot)")
        self_spot = admin_create_spot(admin_token, f"QA Phase2 SelfSpot {ts}")
        if self_spot:
            created_spot_ids.append(self_spot)
            # Admin saves their own spot
            save_spot(admin_token, self_spot)
            # Admin posts upload
            r = requests.post(f"{BASE_URL}/spots/{self_spot}/uploads",
                              json={"images": [{"image_url": _img_data_uri()}]},
                              headers=headers(admin_token), timeout=60)
            ok = r.status_code == 200
            admin_inbox = list_notifications(admin_token)
            self_notifs = [n for n in admin_inbox["items"]
                           if n.get("spot_id") == self_spot and n.get("actor_user_id") == admin_uid]
            check("admin does NOT receive self-notification for own upload", len(self_notifs) == 0,
                  f"found {len(self_notifs)} self-notifs: {[n['kind'] for n in self_notifs]}")

        # ===================================================================
        # 3e) TESTER hearts admin's upload → admin gets upload_reaction
        # ===================================================================
        say("\n[3e] Tester reacts 'like' on admin's upload → upload_reaction notif")
        up_list = requests.get(f"{BASE_URL}/spots/{spot_x_id}/uploads",
                               headers=headers(tester_token), timeout=30).json()
        admin_uploads = [u for u in up_list.get("items", []) if u.get("user_id") == admin_uid]
        check("tester sees approved admin uploads", len(admin_uploads) >= 1, f"count={len(admin_uploads)}")
        if admin_uploads:
            target_upload_id = admin_uploads[0]["upload_id"]
            r = requests.post(f"{BASE_URL}/spot-uploads/{target_upload_id}/react?kind=like",
                              headers=headers(tester_token), timeout=30)
            check("tester like reaction 200", r.status_code == 200,
                  f"{r.status_code} {r.text[:200]}")
            # Admin inbox should contain upload_reaction
            admin_inbox = list_notifications(admin_token)
            reacts = [n for n in admin_inbox["items"]
                      if n["kind"] == "upload_reaction" and n.get("actor_user_id") == tester_uid
                      and n.get("upload_id") == target_upload_id]
            check("admin received upload_reaction notif", len(reacts) >= 1,
                  f"admin inbox kinds={[n['kind'] for n in admin_inbox['items'][:10]]}")

        # ===================================================================
        # 3f) Admin approves tester's pending upload → tester gets upload_approve
        # ===================================================================
        say("\n[3f] Tester posts upload (pending) → admin approves → tester gets upload_approve")
        # Tester is unverified and NOT the owner → goes pending
        r = requests.post(f"{BASE_URL}/spots/{spot_x_id}/uploads",
                          json={"images": [{"image_url": _img_data_uri()}],
                                "caption": "hi i'm new"},
                          headers=headers(tester_token), timeout=60)
        tester_upload_resp = r.json() if r.status_code == 200 else {}
        check("tester upload accepted (pending)",
              r.status_code == 200 and tester_upload_resp.get("moderation_status") == "pending",
              f"{r.status_code} {r.text[:200]}")

        # Admin picks up the pending upload
        pending = requests.get(f"{BASE_URL}/admin/spot-uploads/pending",
                               headers=headers(admin_token), timeout=30).json()
        my_pending = [p for p in pending.get("items", []) if p.get("user_id") == tester_uid]
        check("admin sees tester's pending upload", len(my_pending) >= 1,
              f"pending count={len(pending.get('items', []))}")
        if my_pending:
            pending_upload_id = my_pending[0]["upload_id"]
            r = requests.patch(f"{BASE_URL}/admin/spot-uploads/{pending_upload_id}",
                               json={"action": "approve"},
                               headers=headers(admin_token), timeout=30)
            check("admin approve 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")

            # Tester should get upload_approve notif
            inbox = list_notifications(tester_token)
            ap = [n for n in inbox["items"] if n["kind"] == "upload_approve"
                  and n.get("upload_id") == pending_upload_id]
            check("tester received upload_approve notif", len(ap) >= 1,
                  f"kinds={[n['kind'] for n in inbox['items'][:10]]}")

            # ===================================================================
            # 3g) set_as_cover → upload_set_as_cover
            # ===================================================================
            say("\n[3g] Admin set_as_cover → tester gets upload_set_as_cover")
            r = requests.patch(f"{BASE_URL}/admin/spot-uploads/{pending_upload_id}",
                               json={"action": "set_as_cover"},
                               headers=headers(admin_token), timeout=30)
            check("admin set_as_cover 200", r.status_code == 200,
                  f"{r.status_code} {r.text[:200]}")
            inbox = list_notifications(tester_token)
            cov = [n for n in inbox["items"] if n["kind"] == "upload_set_as_cover"
                   and n.get("upload_id") == pending_upload_id]
            check("tester received upload_set_as_cover notif", len(cov) >= 1,
                  f"kinds={[n['kind'] for n in inbox['items'][:10]]}")

        # ===================================================================
        # 2) POST /api/notifications/mark-read — single id + all
        # ===================================================================
        say("\n[2] POST /api/notifications/mark-read")
        inbox = list_notifications(tester_token)
        initial_unread = inbox["unread_count"]
        check("tester has multiple unread notifs at this point",
              initial_unread >= 3, f"unread={initial_unread}")
        if inbox["items"]:
            one_id = inbox["items"][0]["notification_id"]
            # mark ONE
            r = requests.post(f"{BASE_URL}/notifications/mark-read",
                              params={"notification_id": one_id},
                              headers=headers(tester_token), json={}, timeout=20)
            check("mark-read single id 200", r.status_code == 200, f"{r.status_code}")
            inbox2 = list_notifications(tester_token)
            check("unread_count decreased by exactly 1",
                  inbox2["unread_count"] == initial_unread - 1,
                  f"before={initial_unread} after={inbox2['unread_count']}")
            # single target now has read_at set
            matched = [n for n in inbox2["items"] if n["notification_id"] == one_id]
            check("targeted notification has read_at", matched and matched[0]["read_at"] is not None,
                  f"read_at={matched and matched[0].get('read_at')}")

        # Now mark ALL
        r = requests.post(f"{BASE_URL}/notifications/mark-read",
                          headers=headers(tester_token), json={}, timeout=20)
        check("mark-read ALL 200", r.status_code == 200, f"{r.status_code}")
        inbox3 = list_notifications(tester_token)
        check("unread_count is 0 after mark-all", inbox3["unread_count"] == 0,
              f"unread={inbox3['unread_count']}")

        # ----- No cross-user leak check -----
        # Create an unread notif to tester via admin upload on spot X
        r = requests.post(f"{BASE_URL}/spots/{spot_x_id}/uploads",
                          json={"images": [{"image_url": _img_data_uri()}],
                                "caption": "ping-tester"},
                          headers=headers(admin_token), timeout=60)
        assert r.status_code == 200
        tester_inbox = list_notifications(tester_token)
        tester_unread_before = tester_inbox["unread_count"]
        check("tester has a new unread after fresh admin upload", tester_unread_before >= 1,
              f"unread={tester_unread_before}")
        # VIEWER (different user) calls mark-read ALL
        r = requests.post(f"{BASE_URL}/notifications/mark-read",
                          headers=headers(viewer_token), json={}, timeout=20)
        check("viewer mark-all 200", r.status_code == 200, f"{r.status_code}")
        tester_inbox2 = list_notifications(tester_token)
        check("viewer's mark-all did NOT affect tester's unread count",
              tester_inbox2["unread_count"] == tester_unread_before,
              f"before={tester_unread_before} after={tester_inbox2['unread_count']}")
        # And viewer cannot flip a tester notification by id either
        if tester_inbox2["items"]:
            target_id = next((n["notification_id"] for n in tester_inbox2["items"]
                              if n.get("read_at") is None), None)
            if target_id:
                r = requests.post(f"{BASE_URL}/notifications/mark-read",
                                  params={"notification_id": target_id},
                                  headers=headers(viewer_token), json={}, timeout=20)
                # Should be 200 (endpoint is idempotent / scope-filtered) — but the target
                # notification in tester's inbox should remain unread.
                inbox_final = list_notifications(tester_token)
                target_after = [n for n in inbox_final["items"] if n["notification_id"] == target_id]
                check("viewer cannot mark tester's notif by id (cross-user leak blocked)",
                      target_after and target_after[0]["read_at"] is None,
                      f"read_at={target_after and target_after[0].get('read_at')}")

        # ===================================================================
        # 4) GET /api/feed/home — new rails
        # ===================================================================
        say("\n[4] GET /api/feed/home — new rails")
        feed = requests.get(f"{BASE_URL}/feed/home", headers=headers(admin_token), timeout=30).json()
        for key in ("freshly_updated", "new_photos", "verified_this_week",
                    "blooming_now", "trending_again"):
            check(f"feed/home has key '{key}'", key in feed and isinstance(feed[key], list),
                  f"type={type(feed.get(key))}")

        # Correctness: blooming_now members actually have 'blooming' tag in last 14d
        if feed.get("blooming_now"):
            first = feed["blooming_now"][0]
            sid = first.get("spot_id")
            if sid:
                # Check the spot has at least one approved upload or update with blooming tag
                upls = requests.get(f"{BASE_URL}/spots/{sid}/uploads",
                                    headers=headers(admin_token), timeout=30).json()
                has_bloom = any(
                    "blooming" in (u.get("condition_tags") or [])
                    for u in upls.get("items", [])
                    if u.get("moderation_status") == "approved"
                )
                # we can't easily check 14-day cutoff client-side, but we can check the tag
                check("blooming_now[0] references spot with 'blooming' tag", has_bloom,
                      f"tags seen={[u.get('condition_tags') for u in upls.get('items', [])][:3]}")

        # Correctness: verified_this_week members actually have verified_today tag
        if feed.get("verified_this_week"):
            sid = feed["verified_this_week"][0].get("spot_id")
            if sid:
                upls = requests.get(f"{BASE_URL}/spots/{sid}/uploads",
                                    headers=headers(admin_token), timeout=30).json()
                has_verif = any(
                    "verified_today" in (u.get("condition_tags") or [])
                    for u in upls.get("items", [])
                    if u.get("moderation_status") == "approved"
                )
                check("verified_this_week[0] references spot with 'verified_today' tag",
                      has_verif, f"sid={sid}")

        # Correctness: new_photos items have latest_photo_at within last 7 days
        if feed.get("new_photos"):
            from datetime import datetime, timezone, timedelta
            now = datetime.now(timezone.utc)
            cutoff = now - timedelta(days=7)
            offenders = []
            for s in feed["new_photos"]:
                lp = s.get("latest_photo_at")
                if not lp:
                    offenders.append(s.get("spot_id"))
                    continue
                try:
                    dt = datetime.fromisoformat(str(lp).replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    if dt < cutoff:
                        offenders.append(s.get("spot_id"))
                except Exception:
                    offenders.append(s.get("spot_id"))
            check("new_photos items have latest_photo_at within 7d", not offenders,
                  f"offenders={offenders[:3]}")

        # ===================================================================
        # 5) GET /api/spots/{id} — new fields
        # ===================================================================
        say("\n[5] GET /api/spots/{spot_x_id} — hero cover + seasonal timeline")
        spot = requests.get(f"{BASE_URL}/spots/{spot_x_id}",
                            headers=headers(admin_token), timeout=30).json()
        check("spot has hero_cover_image_url key",
              "hero_cover_image_url" in spot,
              f"keys sample={list(spot.keys())[:30]}")
        check("spot has hero_cover_source key",
              "hero_cover_source" in spot, "missing")
        allowed_sources = {"admin_featured", "recent_most_liked",
                           "seasonal_spring", "seasonal_summer", "seasonal_fall", "seasonal_winter",
                           "original_cover", "first_image", None}
        check("hero_cover_source is in the allowed enum",
              spot.get("hero_cover_source") in allowed_sources,
              f"got {spot.get('hero_cover_source')}")
        # Since spot X has at least one approved community upload (admin uploaded earlier),
        # the hero cover should NOT be random — it should follow the priority stack and
        # therefore be non-null.
        check("hero_cover_image_url non-null (spot has approved uploads)",
              bool(spot.get("hero_cover_image_url")),
              f"source={spot.get('hero_cover_source')}")
        st = spot.get("seasonal_timeline")
        check("seasonal_timeline is a dict with 4 season keys",
              isinstance(st, dict) and set(st.keys()) == {"spring", "summer", "fall", "winter"},
              f"keys={list(st.keys()) if isinstance(st, dict) else type(st)}")
        check("seasonal_timeline values are lists",
              isinstance(st, dict) and all(isinstance(v, list) for v in st.values()),
              "type mismatch")
        stt = spot.get("seasonal_timeline_total")
        check("seasonal_timeline_total is int",
              isinstance(stt, int),
              f"got {type(stt)}")
        if isinstance(st, dict) and isinstance(stt, int):
            check("seasonal_timeline_total == sum(len(season))",
                  stt == sum(len(v) for v in st.values()),
                  f"reported={stt} computed={sum(len(v) for v in st.values())}")

        # ===================================================================
        # 6) Followers-only visibility filter
        # ===================================================================
        say("\n[6] Followers-only visibility filter on /spots/{id}/uploads")
        # Create a spot and have tester (author) post an upload with visibility=followers.
        # Tester is unverified → goes pending. To properly test visibility filter we need
        # an APPROVED followers-only upload. Simplest path: admin promotes tester
        # verification_status='verified' temporarily (auto-approve) then revert.
        promoted = admin_patch_user(admin_token, tester_uid, {"verification_status": "verified"})
        check("admin promoted tester to verified", promoted, "patch failed")
        if promoted:
            fo_body = {
                "images": [{"image_url": _img_data_uri(), "caption": "followers-only test"}],
                "caption": "only my followers",
                "condition_tags": [],
                "visibility": "followers",
            }
            r = requests.post(f"{BASE_URL}/spots/{spot_x_id}/uploads", json=fo_body,
                              headers=headers(tester_token), timeout=60)
            ok = r.status_code == 200 and r.json().get("auto_approved") is True
            check("verified tester upload auto-approved (visibility=followers)",
                  ok, f"{r.status_code} {r.text[:200]}")

            # Confirm visibility field is persisted as 'followers'
            listed = requests.get(f"{BASE_URL}/spots/{spot_x_id}/uploads",
                                  headers=headers(tester_token), timeout=30).json()
            mine = [u for u in listed.get("items", []) if u.get("user_id") == tester_uid
                    and u.get("visibility") == "followers"]
            check("followers-only upload persisted", len(mine) >= 1,
                  f"count={len(mine)}")

            # (a) Unauthenticated viewer — followers-only items MUST NOT leak
            r = requests.get(f"{BASE_URL}/spots/{spot_x_id}/uploads", timeout=30)
            items = r.json().get("items", [])
            leaked = [u for u in items if u.get("user_id") == tester_uid
                      and u.get("visibility") == "followers"]
            check("unauthenticated viewer hides followers-only uploads", not leaked,
                  f"leaked={[u['upload_id'] for u in leaked]}")

            # (b) Non-follower viewer — also hidden
            listed_viewer = requests.get(f"{BASE_URL}/spots/{spot_x_id}/uploads",
                                         headers=headers(viewer_token), timeout=30).json()
            leaked = [u for u in listed_viewer.get("items", []) if u.get("user_id") == tester_uid
                      and u.get("visibility") == "followers"]
            check("non-follower authenticated viewer hides followers-only uploads",
                  not leaked, f"leaked={[u['upload_id'] for u in leaked]}")

            # (c) Author themselves — visible
            self_view = [u for u in listed.get("items", []) if u.get("user_id") == tester_uid
                         and u.get("visibility") == "followers"]
            check("author sees their own followers-only upload", len(self_view) >= 1,
                  f"count={len(self_view)}")

            # (d) Admin viewer — visible (admin is gated via include_pending path
            # but let's double-check via /admin/spot-uploads — visibility filter
            # should not apply when include_pending=True)
            admin_view = requests.get(f"{BASE_URL}/spots/{spot_x_id}/uploads",
                                      headers=headers(admin_token), timeout=30).json()
            admin_sees = [u for u in admin_view.get("items", []) if u.get("user_id") == tester_uid
                          and u.get("visibility") == "followers"]
            check("admin/moderator sees followers-only upload", len(admin_sees) >= 1,
                  f"count={len(admin_sees)}")

            # Revert verification status
            admin_patch_user(admin_token, tester_uid, {"verification_status": "unverified"})

    finally:
        # ===================================================================
        # Cleanup
        # ===================================================================
        say("\n[cleanup] Removing test spots and users…")
        for sid in created_spot_ids:
            ok = admin_hard_delete_spot(admin_token, sid)
            say(f"  spot {sid}: {'✓ deleted' if ok else '× failed'}")
        for uid in created_user_ids:
            ok = admin_soft_delete_user(admin_token, uid)
            say(f"  user {uid}: {'✓ soft-deleted' if ok else '× failed'}")

    say("\n" + "=" * 70)
    say(f"PHASE 2 RESULT:   PASS={PASS}  FAIL={FAIL}")
    if FAILS:
        say("FAILURES:")
        for f in FAILS:
            say(f"  - {f}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
