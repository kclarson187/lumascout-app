#!/usr/bin/env python3
"""
Phase 3 regression — /app/backend/routes/spots.py extraction.
Covers 13 sections from the review request. Hits the PUBLIC base URL.
"""
import os
import sys
import time
import uuid
import json
import random
import string
import requests
from pathlib import Path

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

RESULTS = []  # list of (section, label, ok, details)


def _log(section, label, ok, details=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {section} :: {label}" + (f"  -- {details}" if details else ""))
    RESULTS.append((section, label, ok, details))


def _req(method, path, token=None, **kwargs):
    url = BASE + path
    headers = kwargs.pop("headers", {}) or {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        r = requests.request(method, url, headers=headers, timeout=30, **kwargs)
        return r
    except Exception as e:
        print(f"EXC {method} {path} → {e}")
        class _F:
            status_code = 0
            text = str(e)
            def json(self):
                return {}
        return _F()


def register_user(email_prefix, name=None, city="Austin", state="TX", country="US"):
    email = f"{email_prefix}_{uuid.uuid4().hex[:8]}@qatest.photoscout.app"
    pw = "TestPass!234"
    r = _req("POST", "/auth/register", json={"email": email, "password": pw, "name": name or email_prefix.title()})
    if r.status_code != 200:
        print(f"register FAIL {email} → {r.status_code} {r.text[:200]}")
        return None
    tok = r.json()["token"]
    uid = r.json()["user"]["user_id"]
    # patch city
    _req("PATCH", "/auth/me", token=tok, json={"city": city, "state": state, "primary_country": country})
    return {"email": email, "token": tok, "user_id": uid, "name": name or email_prefix.title()}


def login(email, pw):
    r = _req("POST", "/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        print(f"LOGIN FAIL {email} {r.status_code} {r.text[:300]}")
        return None
    return r.json()["token"]


# ------------------------------------------------------------------------
# Section 1 — Spot CRUD
# ------------------------------------------------------------------------
def test_spot_crud(admin_tok):
    sec = "S1 CRUD"

    # list default
    r = _req("GET", "/spots?limit=5")
    _log(sec, "GET /spots?limit=5", r.status_code == 200 and isinstance(r.json(), list), f"code={r.status_code} n={len(r.json()) if r.status_code==200 and isinstance(r.json(), list) else 'n/a'}")
    baseline = r.json() if r.status_code == 200 else []

    # sort=quality
    r = _req("GET", "/spots?sort=quality&limit=5")
    ok_q = r.status_code == 200 and isinstance(r.json(), list) and all("quality_score" in s for s in r.json())
    _log(sec, "GET /spots?sort=quality", ok_q, f"code={r.status_code}")

    # sort=newest (recent)
    r = _req("GET", "/spots?sort=newest&limit=5")
    _log(sec, "GET /spots?sort=newest", r.status_code == 200, f"code={r.status_code}")

    # sort=trending
    r = _req("GET", "/spots?sort=trending&limit=5")
    _log(sec, "GET /spots?sort=trending", r.status_code == 200, f"code={r.status_code}")

    # city filter
    r = _req("GET", "/spots?city=Austin&limit=10")
    ok_c = r.status_code == 200 and all((s.get("city") or "").lower() == "austin" for s in r.json()) if r.status_code == 200 else False
    _log(sec, "GET /spots?city=Austin", r.status_code == 200, f"code={r.status_code} all_austin={ok_c}")

    # detail on existing
    spot_id = baseline[0]["spot_id"] if baseline else None
    if spot_id:
        r = _req("GET", f"/spots/{spot_id}", token=admin_tok)
        j = r.json() if r.status_code == 200 else {}
        ok = (
            r.status_code == 200
            and j.get("spot_id") == spot_id
            and "owner" in j
            and "images" in j
            and "is_saved" in j
        )
        _log(sec, "GET /spots/{id} hydrated", ok, f"code={r.status_code} has_owner={bool(j.get('owner'))} is_saved_key={'is_saved' in j}")

    # Create spot as admin — auto-approves (admin role)
    body = {
        "title": f"QA Phase3 Lookout {uuid.uuid4().hex[:6]}",
        "description": "Regression test spot — Phase3 extraction",
        "latitude": 30.2672, "longitude": -97.7431,
        "city": "Austin", "state": "TX", "country": "USA",
        "shoot_types": ["urban", "portrait"],
        "images": [{"image_url": "https://images.unsplash.com/photo-1519125323398-675f0ddb6308"}],
    }
    r = _req("POST", "/spots", token=admin_tok, json=body)
    ok = r.status_code == 200 and r.json().get("spot_id", "").startswith("spot_")
    admin_spot_id = r.json().get("spot_id") if ok else None
    _log(sec, "POST /spots (admin)", ok, f"code={r.status_code} id={admin_spot_id}")

    # check-duplicates
    r = _req("GET", f"/spots/check-duplicates?latitude=30.2672&longitude=-97.7431")
    ok = r.status_code == 200 and "candidates" in r.json()
    _log(sec, "GET /spots/check-duplicates", ok, f"code={r.status_code}")

    # nearby
    r = _req("GET", "/spots/nearby/search?lat=30.2672&lng=-97.7431&radius_km=50")
    ok = r.status_code == 200 and isinstance(r.json(), list)
    _log(sec, "GET /spots/nearby/search", ok, f"code={r.status_code} n={len(r.json()) if ok else 0}")

    # Delete an admin spot
    if admin_spot_id:
        r = _req("DELETE", f"/spots/{admin_spot_id}", token=admin_tok)
        _log(sec, "DELETE /spots/{id} (owner admin)", r.status_code == 200, f"code={r.status_code}")

    return admin_spot_id


# ------------------------------------------------------------------------
# Section 2 — Uploads
# ------------------------------------------------------------------------
def test_uploads(admin_tok):
    sec = "S2 UPLOADS"
    # Create a spot as admin
    body = {
        "title": f"QA Phase3 Uploads Spot {uuid.uuid4().hex[:6]}",
        "description": "Upload flow target",
        "latitude": 30.2672, "longitude": -97.7431,
        "city": "Austin", "state": "TX", "country": "USA",
        "shoot_types": ["urban"],
        "images": [{"image_url": "https://images.unsplash.com/photo-1519501025264-65ba15a82390"}],
    }
    r = _req("POST", "/spots", token=admin_tok, json=body)
    if r.status_code != 200:
        _log(sec, "seed spot", False, f"code={r.status_code}")
        return None, None
    spot_id = r.json()["spot_id"]
    _log(sec, "seed spot", True, f"id={spot_id}")

    # Register a second user to post a pending upload
    u = register_user("qa_uploader", name="QA Uploader", city="Austin")
    if not u:
        return spot_id, None

    # Have this user save the spot (so we can verify saved_spot_fresh_photo later)
    _req("POST", f"/spots/{spot_id}/save", token=u["token"])

    # Submit upload as non-admin → should be pending (non-verified, non-admin, non-owner)
    upload_body = {
        "images": [{"image_url": "https://images.unsplash.com/photo-1493246507139-91e8fad9978e"}],
        "caption": "Community photo QA",
    }
    r = _req("POST", f"/spots/{spot_id}/uploads", token=u["token"], json=upload_body)
    j = r.json() if r.status_code == 200 else {}
    ok = r.status_code == 200 and j.get("moderation_status") == "pending"
    _log(sec, "POST /spots/{id}/uploads (non-admin pending)", ok, f"code={r.status_code} status={j.get('moderation_status')}")

    # List uploads — we need the upload_id. Fetch admin-side (includes pending)
    r = _req("GET", f"/spots/{spot_id}/uploads?limit=10", token=admin_tok)
    items = r.json().get("items", []) if r.status_code == 200 else []
    pending = [i for i in items if i.get("moderation_status") == "pending"]
    upload_id = pending[0]["upload_id"] if pending else None
    _log(sec, "GET /spots/{id}/uploads admin sees pending", bool(upload_id), f"code={r.status_code} n_pending={len(pending)}")

    if not upload_id:
        return spot_id, None

    # Admin approves via PATCH /api/admin/spot-uploads/{upload_id}
    r = _req("PATCH", f"/admin/spot-uploads/{upload_id}", token=admin_tok, json={"action": "approve"})
    _log(sec, "PATCH /admin/spot-uploads (approve)", r.status_code == 200, f"code={r.status_code}")

    # Verify upload now approved
    time.sleep(1.5)
    r = _req("GET", f"/spots/{spot_id}/uploads?limit=10")
    items = r.json().get("items", []) if r.status_code == 200 else []
    app = [i for i in items if i.get("upload_id") == upload_id]
    ok = bool(app) and app[0].get("moderation_status") == "approved"
    _log(sec, "upload.status=approved post-moderation", ok, f"found={bool(app)} status={(app[0].get('moderation_status') if app else None)}")

    # Public listing shows approved
    r = _req("GET", f"/spots/{spot_id}/uploads?limit=10")
    approved_cnt = len([i for i in r.json().get("items", []) if i.get("moderation_status") == "approved"]) if r.status_code == 200 else 0
    _log(sec, "GET /spots/{id}/uploads (public) returns approved", approved_cnt >= 1, f"code={r.status_code} approved={approved_cnt}")

    # Reaction test — another user reacts "like" (the only allowed kinds are like|helpful per code)
    u2 = register_user("qa_reactor", city="Austin")
    r = _req("POST", f"/spot-uploads/{upload_id}/react?kind=like", token=u2["token"])
    ok = r.status_code == 200 and r.json().get("ok") is True and r.json().get("like_count", 0) >= 1
    _log(sec, "POST /spot-uploads/{id}/react kind=like", ok, f"code={r.status_code} body={str(r.json())[:120]}")

    return spot_id, upload_id


# ------------------------------------------------------------------------
# Section 3 — Spot updates (news)
# ------------------------------------------------------------------------
def test_spot_updates(admin_tok, spot_id):
    sec = "S3 UPDATES"
    # Admin-owned spot → auto-approve
    r = _req("POST", f"/spots/{spot_id}/updates", token=admin_tok,
             json={"text": "Blooming now at this spot — wildflowers everywhere"})
    _log(sec, "POST /spots/{id}/updates", r.status_code == 200, f"code={r.status_code}")

    r = _req("GET", f"/spots/{spot_id}/updates")
    ok = r.status_code == 200 and "items" in r.json()
    _log(sec, "GET /spots/{id}/updates", ok, f"code={r.status_code} n={len(r.json().get('items', [])) if ok else 0}")


# ------------------------------------------------------------------------
# Section 4 — Saves + trending fanout
# ------------------------------------------------------------------------
def test_saves_and_trending(admin_tok):
    sec = "S4 SAVES+TRENDING"

    # Get an existing spot to toggle save
    r = _req("GET", "/spots?limit=3")
    if r.status_code != 200 or not r.json():
        _log(sec, "seed list", False, f"code={r.status_code}")
        return

    # Register user for toggle save test
    u = register_user("qa_saver", city="Austin")
    spot_id_any = r.json()[0]["spot_id"]

    r1 = _req("POST", f"/spots/{spot_id_any}/save", token=u["token"])
    ok1 = r1.status_code == 200 and r1.json().get("saved") is True
    r2 = _req("POST", f"/spots/{spot_id_any}/save", token=u["token"])
    ok2 = r2.status_code == 200 and r2.json().get("saved") is False
    _log(sec, "toggle save on/off", ok1 and ok2, f"on={r1.json()} off={r2.json()}")

    # Save again so /me/saved shows something
    _req("POST", f"/spots/{spot_id_any}/save", token=u["token"])
    r = _req("GET", "/me/saved", token=u["token"])
    _log(sec, "GET /me/saved", r.status_code == 200 and isinstance(r.json(), list) and len(r.json()) >= 1, f"code={r.status_code}")

    # ------- Trending fanout --------------------------------------------
    # Admin creates a fresh Austin spot (auto-approved).
    body = {
        "title": f"QA Trending Austin {uuid.uuid4().hex[:6]}",
        "description": "Trending fanout QA",
        "latitude": 30.27, "longitude": -97.74,
        "city": "Austin", "state": "TX", "country": "USA",
        "shoot_types": ["urban"],
        "images": [{"image_url": "https://images.unsplash.com/photo-1493246507139-91e8fad9978e"}],
    }
    r = _req("POST", "/spots", token=admin_tok, json=body)
    if r.status_code != 200:
        _log(sec, "seed trending spot", False, f"code={r.status_code}")
        return
    tr_spot = r.json()["spot_id"]
    _log(sec, "seed trending spot", True, f"id={tr_spot}")

    # Register user E BEFORE the 4th save (same city=Austin)
    userE = register_user("qa_trending_E", city="Austin", name="QA TrendingE")
    if not userE:
        _log(sec, "register userE", False)
        return

    # 4 throwaway Austin savers
    savers = []
    for i in range(4):
        u = register_user(f"qa_tr_saver_{i}", city="Austin", name=f"Saver{i}")
        if not u:
            _log(sec, f"register saver{i}", False)
            return
        savers.append(u)

    # Have savers save the spot in sequence
    for i, s in enumerate(savers):
        r = _req("POST", f"/spots/{tr_spot}/save", token=s["token"])
        if r.status_code != 200:
            _log(sec, f"saver{i} save", False, f"code={r.status_code} body={r.text[:200]}")
            return
    time.sleep(2.0)  # give fanout tasks time

    # Verify E received a trending_spot notification with correct deep_link
    r = _req("GET", "/notifications?limit=40", token=userE["token"])
    items = r.json().get("items", []) if r.status_code == 200 else (r.json() if isinstance(r.json(), list) else [])
    # Handle both shapes
    if isinstance(r.json(), list):
        items = r.json()
    trend_rows = [n for n in items if n.get("kind") == "trending_spot" and n.get("deep_link") == f"/spot/{tr_spot}"]
    ok = len(trend_rows) >= 1
    _log(sec, "trending_spot notification for E (Austin)", ok,
         f"code={r.status_code} trend_rows={len(trend_rows)} total={len(items)}")

    # 5th save (user F) — must NOT double-fire
    userF = register_user("qa_tr_saver_F", city="Austin", name="SaverF")
    # Snapshot existing E trending_spot count before 5th save
    pre = len(trend_rows)
    r = _req("POST", f"/spots/{tr_spot}/save", token=userF["token"])
    time.sleep(2.0)

    r = _req("GET", "/notifications?limit=40", token=userE["token"])
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    post = len([n for n in items if n.get("kind") == "trending_spot" and n.get("deep_link") == f"/spot/{tr_spot}"])
    _log(sec, "5th save no double-fire (guard saves_after==4)", post == pre, f"pre={pre} post={post}")


# ------------------------------------------------------------------------
# Section 5 — Reviews + checkins
# ------------------------------------------------------------------------
def test_reviews_checkins(admin_tok, spot_id):
    sec = "S5 REV+CHK"
    r = _req("POST", f"/spots/{spot_id}/reviews", token=admin_tok,
             json={"overall_rating": 5, "comment": "great for QA"})
    _log(sec, "POST /spots/{id}/reviews", r.status_code == 200, f"code={r.status_code}")

    r = _req("POST", f"/spots/{spot_id}/checkins", token=admin_tok,
             json={"status_summary": "Visited today — all good", "crowd_level": 2})
    _log(sec, "POST /spots/{id}/checkins", r.status_code == 200, f"code={r.status_code}")


# ------------------------------------------------------------------------
# Section 6 — Collections
# ------------------------------------------------------------------------
def test_collections(admin_tok):
    sec = "S6 COLLECTIONS"
    r = _req("POST", "/collections", token=admin_tok, json={"name": "QA Phase3 Trips"})
    ok = r.status_code == 200 and r.json().get("collection_id", "").startswith("col_")
    col_id = r.json().get("collection_id") if ok else None
    _log(sec, "POST /collections", ok, f"code={r.status_code} id={col_id}")

    r = _req("GET", "/me/collections", token=admin_tok)
    ok = r.status_code == 200 and isinstance(r.json(), list) and any(c.get("collection_id") == col_id for c in r.json())
    _log(sec, "GET /me/collections", ok, f"code={r.status_code} n={len(r.json()) if r.status_code==200 else 0}")

    # Need a spot to add
    r = _req("GET", "/spots?limit=3")
    sid = r.json()[0]["spot_id"] if r.status_code == 200 and r.json() else None
    if col_id and sid:
        r = _req("POST", f"/collections/{col_id}/spots", token=admin_tok, json={"spot_id": sid})
        ok = r.status_code == 200 and r.json().get("ok") is True
        _log(sec, "POST /collections/{id}/spots", ok, f"code={r.status_code} body={r.json()}")

        r = _req("GET", f"/collections/{col_id}", token=admin_tok)
        ok = r.status_code == 200 and isinstance(r.json().get("spots"), list)
        _log(sec, "GET /collections/{id} hydrated", ok, f"code={r.status_code} n_spots={len(r.json().get('spots', []))}")

    return col_id


# ------------------------------------------------------------------------
# Section 7 — Draft publish + ownership
# ------------------------------------------------------------------------
def test_draft_publish():
    sec = "S7 DRAFT"
    u = register_user("qa_drafter", city="Austin")
    body = {
        "title": f"QA Draft {uuid.uuid4().hex[:6]}",
        "description": "private draft",
        "latitude": 30.21, "longitude": -97.73,
        "city": "Austin", "state": "TX", "country": "USA",
        "shoot_types": ["urban"],
        "images": [{"image_url": "https://images.unsplash.com/photo-1519125323398-675f0ddb6308"}],
        "save_as_draft": True,
        "privacy_mode": "public",
    }
    r = _req("POST", "/spots", token=u["token"], json=body)
    ok = r.status_code == 200 and r.json().get("visibility_status") == "draft"
    spot_id = r.json().get("spot_id") if r.status_code == 200 else None
    _log(sec, "POST /spots draft", ok, f"code={r.status_code} vis={r.json().get('visibility_status') if r.status_code==200 else None}")

    if spot_id:
        r = _req("POST", f"/spots/{spot_id}/publish-draft", token=u["token"])
        ok = r.status_code == 200 and r.json().get("visibility_status") in ("pending_review", "approved")
        _log(sec, "POST /spots/{id}/publish-draft", ok, f"code={r.status_code} vis={r.json().get('visibility_status') if r.status_code==200 else None}")

    r = _req("GET", "/me/spots", token=u["token"])
    ok = r.status_code == 200 and isinstance(r.json(), list) and len(r.json()) >= 1
    _log(sec, "GET /me/spots", ok, f"code={r.status_code} n={len(r.json()) if r.status_code==200 else 0}")


# ------------------------------------------------------------------------
# Section 8 — Astronomy + shot list
# ------------------------------------------------------------------------
def test_astronomy_shotlist(admin_tok, spot_id):
    sec = "S8 ASTRO+SHOT"
    r = _req("GET", f"/spots/{spot_id}/astronomy")
    ok = r.status_code == 200 and ("sunrise" in r.json() or "sunrise_at" in r.json() or "golden" in str(r.json()).lower())
    _log(sec, "GET /spots/{id}/astronomy", ok, f"code={r.status_code} keys={list(r.json().keys())[:8] if r.status_code==200 else 'n/a'}")

    r = _req("POST", f"/spots/{spot_id}/shot-list", token=admin_tok)
    # Shot-list uses LLM; might fail in test env — tolerate 200 OR 5xx with clean handling
    if r.status_code == 200:
        j = r.json()
        ok = "items" in j
        _log(sec, "POST /spots/{id}/shot-list", ok, f"code=200 n_items={len(j.get('items', []))}")
    else:
        _log(sec, "POST /spots/{id}/shot-list", False, f"code={r.status_code} body={r.text[:200]}")


# ------------------------------------------------------------------------
# Section 9 — Admin cover editor
# ------------------------------------------------------------------------
def test_cover_editor(admin_tok, spot_id):
    sec = "S9 COVER EDITOR"
    r = _req("GET", f"/admin/spots/{spot_id}/cover-editor", token=admin_tok)
    ok = r.status_code == 200 and "images" in r.json() and isinstance(r.json()["images"], list)
    img_url = None
    if ok and r.json()["images"]:
        img_url = r.json()["images"][0]["image_url"]
    _log(sec, "GET /admin/spots/{id}/cover-editor", ok, f"code={r.status_code} n_imgs={len(r.json().get('images', [])) if ok else 0}")
    if not img_url:
        _log(sec, "no image available to PATCH cover", False)
        return

    payload = {"image_url": img_url, "focal_x": 0.4, "focal_y": 0.6, "scale": 1.3, "rotation": 0}
    r = _req("PATCH", f"/admin/spots/{spot_id}/cover", token=admin_tok, json=payload)
    ok = r.status_code == 200 and r.json().get("ok") is True
    _log(sec, "PATCH /admin/spots/{id}/cover", ok, f"code={r.status_code}")

    # Subsequent GET /api/spots returns spot with new cover applied (hero_cover_source=admin_override)
    r = _req("GET", f"/spots/{spot_id}")
    ok = r.status_code == 200 and r.json().get("hero_cover_source") == "admin_override" and r.json().get("hero_cover_image_url") == img_url
    _log(sec, "GET /spots/{id} reflects override", ok, f"code={r.status_code} source={r.json().get('hero_cover_source')}")

    # GET /api/spots list with this spot in it — should also carry admin_override for this spot
    r = _req("GET", f"/spots?city=Austin&limit=50")
    match = [s for s in r.json() if s.get("spot_id") == spot_id] if r.status_code == 200 else []
    ok = bool(match) and match[0].get("hero_cover_source") == "admin_override"
    _log(sec, "GET /spots list propagates override", ok, f"found={bool(match)} source={(match[0].get('hero_cover_source') if match else None)}")

    # DELETE override
    r = _req("DELETE", f"/admin/spots/{spot_id}/cover", token=admin_tok)
    _log(sec, "DELETE /admin/spots/{id}/cover", r.status_code == 200, f"code={r.status_code}")


# ------------------------------------------------------------------------
# Section 10 — Marketplace pack contents
# ------------------------------------------------------------------------
def test_marketplace():
    sec = "S10 MARKETPLACE"
    r = _req("GET", "/marketplace/storefront")
    ok = r.status_code == 200 and "rails" in r.json()
    _log(sec, "GET /marketplace/storefront", ok, f"code={r.status_code} keys={list(r.json().keys())[:6] if ok else 'n/a'}")
    # Check pack spot_ids resolve
    if ok:
        rails = r.json().get("rails", {})
        featured = rails.get("featured", []) or []
        pack = next((p for p in featured if p.get("type") == "spot_pack"), None) or (featured[0] if featured else None)
        if pack:
            pid = pack.get("product_id")
            r = _req("GET", f"/marketplace/products/{pid}")
            _log(sec, "GET /marketplace/products/{pack_id}", r.status_code == 200, f"code={r.status_code}")


# ------------------------------------------------------------------------
# Section 11 — Non-regression
# ------------------------------------------------------------------------
def test_non_regression(admin_tok):
    sec = "S11 NON-REG"
    endpoints = [
        ("GET", "/auth/me", True),
        ("GET", "/feed/home", False),
        ("GET", "/notifications?limit=5", True),
        ("GET", "/dm/threads", True),
        ("GET", "/network/discover?limit_per_rail=3", True),
        ("GET", "/me/viewers", True),
        ("GET", "/referrals", True),
        ("GET", "/referrals/rails", True),
        ("GET", "/admin/overview", True),
        ("GET", "/admin/users?limit=3", True),
    ]
    for method, path, needs_auth in endpoints:
        r = _req(method, path, token=admin_tok if needs_auth else None)
        _log(sec, f"{method} {path}", r.status_code == 200, f"code={r.status_code}")


# ------------------------------------------------------------------------
# Section 12 — Cross-module push integrations
# ------------------------------------------------------------------------
def test_cross_module_push(admin_tok):
    sec = "S12 CROSS-MODULE PUSH"

    # A follows B → B gets new_follower push/notification
    A = register_user("qa_followerA", city="Austin")
    B = register_user("qa_followedB", city="Austin")
    r = _req("POST", f"/users/{B['user_id']}/follow", token=A["token"])
    time.sleep(1.5)
    r = _req("GET", "/notifications?limit=20", token=B["token"])
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    ok = any(n.get("kind") == "new_follower" for n in items)
    _log(sec, "follow → new_follower", ok, f"n_items={len(items)} found_new_follower={ok}")

    # A DMs B — bypass push
    r = _req("POST", "/dm/threads/start", token=A["token"], json={"user_id": B["user_id"], "opening_body": "hi from A"})
    time.sleep(1.5)
    r2 = _req("GET", "/notifications?limit=20", token=B["token"])
    items = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
    ok = any(n.get("kind") in ("new_message", "new_message_request", "dm_request", "dm_message") for n in items)
    _log(sec, "DM → new_message/request notif for B", ok, f"n_items={len(items)}")

    # Save owner's spot → spot owner gets "saved" notification (upload_featured kind)
    # Need an owner spot
    ownerU = register_user("qa_owner", city="Austin")
    body = {
        "title": f"QA Owner Spot {uuid.uuid4().hex[:6]}",
        "description": "owner save notification",
        "latitude": 30.3, "longitude": -97.73,
        "city": "Austin", "state": "TX", "country": "USA",
        "shoot_types": ["urban"],
        "images": [{"image_url": "https://images.unsplash.com/photo-1493246507139-91e8fad9978e"}],
        "privacy_mode": "public",
    }
    r = _req("POST", "/spots", token=ownerU["token"], json=body)
    if r.status_code == 200:
        own_sid = r.json()["spot_id"]
        # Admin must approve if pending — just force visibility by creating via admin instead; but let's check it's created
        # Non-verified owner → spot pending_review; saving pending spot still fires owner notif per code (no vis check)
        saverU = register_user("qa_saveowner", city="Austin")
        r = _req("POST", f"/spots/{own_sid}/save", token=saverU["token"])
        time.sleep(1.5)
        r = _req("GET", "/notifications?limit=20", token=ownerU["token"])
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        # owner notif uses kind=upload_featured per code
        ok = any("saved your spot" in (n.get("title") or "").lower() for n in items) or any(n.get("spot_id") == own_sid for n in items)
        _log(sec, "save spot → owner gets 'saved your spot' notif", ok, f"n_items={len(items)}")

    # Admin sanctions a user → user gets user_sanction_warning push
    targetU = register_user("qa_sanction_target", city="Austin")
    r = _req("POST", f"/admin/users/{targetU['user_id']}/sanction", token=admin_tok,
             json={"type": "warn", "reason": "QA regression test — safe to ignore"})
    time.sleep(1.5)
    r2 = _req("GET", "/notifications?limit=20", token=targetU["token"])
    items = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
    ok = any(n.get("kind") == "user_sanction_warn" or n.get("kind") == "user_sanction_warning" for n in items)
    _log(sec, "admin sanction → user_sanction_warn notif", ok, f"sanction_status={r.status_code} n_items={len(items)}")


# ------------------------------------------------------------------------
# Section 13 — Permissions
# ------------------------------------------------------------------------
def test_permissions(admin_tok):
    sec = "S13 PERMS"

    # /me/* unauth → 401
    r = _req("GET", "/me/saved")
    _log(sec, "GET /me/saved unauth → 401", r.status_code == 401, f"code={r.status_code}")

    r = _req("GET", "/me/spots")
    _log(sec, "GET /me/spots unauth → 401", r.status_code == 401, f"code={r.status_code}")

    # POST /spots/{id}/uploads unauth → 401
    r = _req("GET", "/spots?limit=1")
    spot_id = r.json()[0]["spot_id"] if r.status_code == 200 and r.json() else None
    if spot_id:
        r = _req("POST", f"/spots/{spot_id}/uploads", json={"images": [{"image_url": "x"}]})
        _log(sec, "POST /spots/{id}/uploads unauth → 401", r.status_code == 401, f"code={r.status_code}")

    # DELETE /spots/{id} by non-owner → 403
    # Seed a spot as admin, then have another user attempt delete
    body = {
        "title": f"QA Perm Spot {uuid.uuid4().hex[:6]}",
        "description": "perm check", "latitude": 30.3, "longitude": -97.7,
        "city": "Austin", "state": "TX", "country": "USA",
        "images": [{"image_url": "https://images.unsplash.com/photo-1519125323398-675f0ddb6308"}],
    }
    r = _req("POST", "/spots", token=admin_tok, json=body)
    if r.status_code == 200:
        sid = r.json()["spot_id"]
        u = register_user("qa_nonowner", city="Austin")
        r = _req("DELETE", f"/spots/{sid}", token=u["token"])
        _log(sec, "DELETE /spots/{id} non-owner → 403", r.status_code == 403, f"code={r.status_code}")
        # Cleanup
        _req("DELETE", f"/spots/{sid}", token=admin_tok)


# ------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------
def main():
    print(f"Testing against: {BASE}")
    admin_tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_tok:
        print("FATAL — cannot login as admin")
        sys.exit(1)
    print(f"Admin login OK (token len={len(admin_tok)})")

    # Run sections
    test_spot_crud(admin_tok)
    spot_id_u, upload_id = test_uploads(admin_tok)
    if spot_id_u:
        test_spot_updates(admin_tok, spot_id_u)
    test_saves_and_trending(admin_tok)
    if spot_id_u:
        test_reviews_checkins(admin_tok, spot_id_u)
    test_collections(admin_tok)
    test_draft_publish()
    if spot_id_u:
        test_astronomy_shotlist(admin_tok, spot_id_u)
        test_cover_editor(admin_tok, spot_id_u)
    test_marketplace()
    test_non_regression(admin_tok)
    test_cross_module_push(admin_tok)
    test_permissions(admin_tok)

    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    by_sec = {}
    for section, label, ok, _d in RESULTS:
        by_sec.setdefault(section, {"pass": 0, "fail": 0, "items": []})
        by_sec[section]["pass" if ok else "fail"] += 1
        by_sec[section]["items"].append((ok, label))
    total_pass = sum(s["pass"] for s in by_sec.values())
    total_fail = sum(s["fail"] for s in by_sec.values())
    for sec, d in by_sec.items():
        print(f"{sec:30s}  PASS={d['pass']}  FAIL={d['fail']}")
        for ok, lbl in d["items"]:
            if not ok:
                print(f"   ❌ {lbl}")
    print(f"\nTOTAL: {total_pass} PASS / {total_fail} FAIL")
    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
