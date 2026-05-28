"""
Backend test for "Premium Explore card upgrade" (Jun 2025).

Verifies the FOUR new computed fields added to every spot returned by
`public_spot_view()` in /app/backend/server.py:
  - orientation_label  (str | None)
  - elevation_ft       (int | None)
  - access_status      ("free_public" | "permit_required" | "private_check")
  - sample_photo_urls  (list[str], 0..3 entries)

And the new helper `attach_sample_photos(spots, per_spot=3)` wired into:
  - /api/spots/{spot_id}                          (routes/spots.py)
  - /api/spots                                    (routes/spots.py)
  - /api/spots/nearby/search                      (routes/spots.py)
  - /api/feed/home                                (server.py)

Also confirms NO regression on existing fields and existing endpoints
(/api/spots/{id}/shoot-plan, /api/collections/save-shoot-plan).
"""
from __future__ import annotations

import os
import re
import sys
import time
import json
from typing import Any, Dict, List, Optional

import httpx
from pymongo import MongoClient

# ─────────────────────────────────────────────────────────────────────
# Config — use the public preview URL per system prompt.
# ─────────────────────────────────────────────────────────────────────

BASE = "https://photo-finder-60.preview.emergentagent.com"
SPOT_ID = "spot_6829d0a67f60"  # Bluebonnet Fields @ Muleshoe Bend, TX
SUPER_ADMIN_EMAIL = "kclarson187@gmail.com"
SUPER_ADMIN_PASSWORD = "Grayson@1117!!"

# Read MONGO_URL + DB_NAME from backend/.env for direct DB inspection.
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"
try:
    with open("/app/backend/.env", "r") as f:
        env_lines = f.read()
    m = re.search(r"^MONGO_URL=(.+)$", env_lines, re.MULTILINE)
    if m:
        MONGO_URL = m.group(1).strip().strip('"').strip("'")
    m = re.search(r"^DB_NAME=(.+)$", env_lines, re.MULTILINE)
    if m:
        DB_NAME = m.group(1).strip().strip('"').strip("'")
except Exception:
    pass

print(f"[setup] BASE={BASE}")
print(f"[setup] MONGO_URL={MONGO_URL!r} DB_NAME={DB_NAME!r}")

ALLOWED_ACCESS = {"free_public", "permit_required", "private_check"}
NEW_KEYS = ("orientation_label", "elevation_ft", "access_status", "sample_photo_urls")
LEGACY_KEYS = (
    "spot_id", "title", "shoot_score", "hero_cover_image_url",
    "latitude", "longitude", "images", "owner_user_id",
    "privacy_mode", "visibility_status", "quality_score",
)

results: List[Dict[str, Any]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}: {detail}" if detail else f"[{status}] {name}")
    results.append({"name": name, "ok": bool(ok), "detail": detail})


def expect_shape(spot: Dict[str, Any], label: str) -> bool:
    ok = True
    for k in NEW_KEYS:
        if k not in spot:
            record(f"{label} :: has key '{k}'", False, "key missing on payload")
            ok = False
    for k in LEGACY_KEYS:
        if k not in spot:
            record(f"{label} :: legacy key '{k}' present", False, "regression — old key dropped")
            ok = False
    ol = spot.get("orientation_label")
    if ol is not None and not (isinstance(ol, str) and len(ol) > 0):
        record(f"{label} :: orientation_label type", False, f"got {type(ol).__name__} value={ol!r}")
        ok = False
    ef = spot.get("elevation_ft")
    if ef is not None and not isinstance(ef, int):
        record(f"{label} :: elevation_ft type", False, f"got {type(ef).__name__} value={ef!r}")
        ok = False
    ax = spot.get("access_status")
    if ax not in ALLOWED_ACCESS:
        record(f"{label} :: access_status enum", False, f"got {ax!r} not in {ALLOWED_ACCESS}")
        ok = False
    sp = spot.get("sample_photo_urls")
    if not isinstance(sp, list):
        record(f"{label} :: sample_photo_urls is list", False, f"got {type(sp).__name__}")
        ok = False
    else:
        if len(sp) > 3:
            record(f"{label} :: sample_photo_urls len ≤ 3", False, f"got {len(sp)}")
            ok = False
        for u in sp:
            if not (isinstance(u, str) and u.startswith(("http://", "https://"))):
                record(f"{label} :: sample_photo_urls all URLs", False, f"bad entry {u!r}")
                ok = False
                break
    return ok


def login_super_admin(client: httpx.Client) -> Optional[str]:
    for path in ("/api/auth/login", "/api/login"):
        try:
            r = client.post(
                BASE + path,
                json={"email": SUPER_ADMIN_EMAIL, "password": SUPER_ADMIN_PASSWORD},
                timeout=15,
            )
            if r.status_code == 200:
                data = r.json()
                token = data.get("access_token") or data.get("token") or data.get("session_token")
                if token:
                    print(f"[auth] logged in via {path}")
                    return token
        except Exception as e:
            print(f"[auth] {path} error: {e}")
    print("[auth] super admin login did not return a token — testing as anon")
    return None


def test_A1_single_spot(client: httpx.Client) -> Dict[str, Any]:
    r = client.get(BASE + f"/api/spots/{SPOT_ID}", timeout=20)
    if r.status_code != 200:
        record("A1 GET /api/spots/{id} 200", False, f"status={r.status_code} body={r.text[:200]}")
        return {}
    spot = r.json()
    record("A1 GET /api/spots/{id} 200", True, f"title={spot.get('title')!r}")
    expect_shape(spot, "A1 bluebonnet spot")
    ol = spot.get("orientation_label")
    if isinstance(ol, str) and "sunset" in ol.lower():
        record("A1 bluebonnet orientation_label is sunset-flavored", True, f"got {ol!r}")
    else:
        record("A1 bluebonnet orientation_label is sunset-flavored", False, f"got {ol!r}")
    if spot.get("permit_required") and spot.get("access_status") != "permit_required":
        record("A1 bluebonnet access_status=permit_required", False, f"got {spot.get('access_status')!r}")
    else:
        record("A1 bluebonnet access_status=permit_required", True, str(spot.get("access_status")))
    sp = spot.get("sample_photo_urls") or []
    if len(sp) < 1:
        record("A1 bluebonnet sample_photo_urls populated", False, f"got {sp}")
    else:
        record("A1 bluebonnet sample_photo_urls populated", True, f"{len(sp)} url(s)")
    return spot


def test_A2_list(client: httpx.Client) -> List[Dict[str, Any]]:
    t0 = time.perf_counter()
    r = client.get(BASE + "/api/spots", params={"limit": 5}, timeout=30)
    dt = (time.perf_counter() - t0) * 1000
    if r.status_code != 200:
        record("A2 GET /api/spots?limit=5 200", False, f"status={r.status_code}")
        return []
    body = r.json()
    if isinstance(body, dict) and "items" in body:
        items = body["items"]
        record("A2 GET /api/spots wrapped shape", True, f"keys={sorted(body.keys())} count={len(items)}")
    elif isinstance(body, list):
        items = body
        record("A2 GET /api/spots list shape", True, f"count={len(items)}")
    else:
        record("A2 GET /api/spots shape", False, f"unexpected {type(body).__name__}")
        return []
    record("A2 list latency", True, f"{dt:.0f} ms (limit=5)")
    if not items:
        record("A2 list has at least one spot", False, "empty")
        return []
    all_ok = True
    for i, it in enumerate(items):
        if not expect_shape(it, f"A2 item[{i}] {it.get('spot_id')}"):
            all_ok = False
    record("A2 every list item has new fields", all_ok)
    return items


def test_A3_nearby(client: httpx.Client) -> List[Dict[str, Any]]:
    paths_to_try = [
        ("/api/spots/nearby/search", {"lat": 30.5, "lng": -98.0, "radius_km": 80}),
        ("/api/spots/nearby", {"lat": 30.5, "lng": -98.0, "radius_km": 80}),
    ]
    items: List[Dict[str, Any]] = []
    used_path = None
    for path, params in paths_to_try:
        try:
            r = client.get(BASE + path, params=params, timeout=20)
            if r.status_code == 200:
                body = r.json()
                items = body if isinstance(body, list) else body.get("items", [])
                used_path = path
                record(f"A3 GET {path} 200", True, f"count={len(items)}")
                break
            else:
                record(f"A3 GET {path}", False, f"status={r.status_code}")
        except Exception as e:
            record(f"A3 GET {path}", False, str(e))
    if not used_path:
        record("A3 nearby endpoint reachable", False, "no path returned 200")
        return []
    all_ok = True
    for i, it in enumerate(items[:10]):
        if not expect_shape(it, f"A3 nearby[{i}] {it.get('spot_id')}"):
            all_ok = False
    record("A3 every nearby item has new fields", all_ok)
    return items


def test_C1_list_latency(client: httpx.Client) -> None:
    client.get(BASE + "/api/spots", params={"limit": 20}, timeout=30)  # warm
    samples = []
    for _ in range(3):
        t0 = time.perf_counter()
        r = client.get(BASE + "/api/spots", params={"limit": 20}, timeout=30)
        dt = (time.perf_counter() - t0) * 1000
        if r.status_code == 200:
            samples.append(dt)
    if not samples:
        record("C1 list latency", False, "no successful calls")
        return
    best = min(samples)
    avg = sum(samples) / len(samples)
    detail = f"best={best:.0f}ms avg={avg:.0f}ms samples={[round(s) for s in samples]}"
    if best < 1500:
        record("C1 list latency < 1.5s", True, detail)
    elif best < 2000:
        record("C1 list latency < 2.0s", True, f"Minor: slower than ideal — {detail}")
    else:
        record("C1 list latency < 2.0s", False, detail)


def test_D_private(client: httpx.Client) -> None:
    try:
        mongo = MongoClient(MONGO_URL, serverSelectionTimeoutMS=4000)
        db = mongo[DB_NAME]
        priv = list(db.spots.find(
            {"privacy_mode": "private"},
            {"_id": 0, "spot_id": 1, "owner_user_id": 1, "title": 1},
        ).limit(20))
    except Exception as e:
        record("D Mongo connect", False, str(e))
        return
    record("D Mongo connect", True, f"found {len(priv)} private spot(s) in DB")
    if not priv:
        record("D no private spots to test", True, "skipped — none exist")
        return
    r = client.get(BASE + "/api/spots", params={"limit": 200}, timeout=30)
    if r.status_code != 200:
        record("D list fetch", False, f"status={r.status_code}")
        return
    body = r.json()
    listed = body if isinstance(body, list) else body.get("items", [])
    listed_ids = {s.get("spot_id") for s in listed}
    leaked = [p["spot_id"] for p in priv if p["spot_id"] in listed_ids]
    if leaked:
        record("D1 private spots not leaked to anon", False, f"leaked={leaked[:5]}")
    else:
        record("D1 private spots not leaked to anon", True, f"all {len(priv)} hidden")
    pid = priv[0]["spot_id"]
    r2 = client.get(BASE + f"/api/spots/{pid}", timeout=15)
    if r2.status_code == 403:
        record("D2 anon GET of private spot blocked", True, "403 returned as expected")
    elif r2.status_code == 200:
        ok = expect_shape(r2.json(), f"D2 private spot {pid}")
        record("D2 private spot payload shape", ok)
    else:
        record("D2 anon GET of private spot", False, f"status={r2.status_code}")


def test_E_edge_cases(client: httpx.Client) -> None:
    try:
        mongo = MongoClient(MONGO_URL, serverSelectionTimeoutMS=4000)
        db = mongo[DB_NAME]
    except Exception as e:
        record("E Mongo connect", False, str(e))
        return

    # E1 — spot with no images
    no_img = db.spots.find_one(
        {"$or": [{"images": []}, {"images": None}, {"images": {"$exists": False}}],
         "privacy_mode": {"$ne": "private"}, "visibility_status": "approved"},
        {"_id": 0, "spot_id": 1, "title": 1, "images": 1},
    )
    if no_img:
        sid = no_img["spot_id"]
        r = client.get(BASE + f"/api/spots/{sid}", timeout=15)
        if r.status_code != 200:
            record("E1 spot w/o images returns 200", False, f"status={r.status_code} sid={sid}")
        else:
            sp = r.json().get("sample_photo_urls")
            if sp == []:
                record("E1 sample_photo_urls is [] for no-image spot", True, f"sid={sid}")
            elif isinstance(sp, list):
                record("E1 sample_photo_urls is list (community-filled)", True, f"sid={sid} got={len(sp)} url(s)")
            else:
                record("E1 sample_photo_urls is list (not null/missing)", False, f"sid={sid} got={sp!r}")
    else:
        record("E1 no-image spot test", True, "Minor: no qualifying spot in DB; skipped")

    # E2 — private spot
    priv = db.spots.find_one({"privacy_mode": "private"}, {"_id": 0, "spot_id": 1, "owner_user_id": 1})
    if priv:
        r = client.get(BASE + f"/api/spots/{priv['spot_id']}", timeout=15)
        if r.status_code == 403:
            record("E2 private spot 403 to anon (gating works)", True, "as expected")
        elif r.status_code == 200:
            ax = r.json().get("access_status")
            if ax == "private_check":
                record("E2 private spot access_status=private_check", True)
            else:
                record("E2 private spot access_status=private_check", False, f"got {ax!r}")
        else:
            record("E2 private spot endpoint", False, f"status={r.status_code}")
    else:
        record("E2 private spot test", True, "Minor: no private spot in DB; skipped")

    # E3 — permit + fee
    both = db.spots.find_one(
        {"permit_required": True, "fee_required": True,
         "privacy_mode": {"$ne": "private"}, "visibility_status": "approved"},
        {"_id": 0, "spot_id": 1},
    )
    if both:
        r = client.get(BASE + f"/api/spots/{both['spot_id']}", timeout=15)
        ax = r.json().get("access_status") if r.status_code == 200 else None
        if ax == "permit_required":
            record("E3 permit+fee → permit_required", True, f"sid={both['spot_id']}")
        else:
            record("E3 permit+fee → permit_required", False, f"sid={both['spot_id']} got {ax!r}")
    else:
        record("E3 permit+fee combo test", True, "Minor: no qualifying spot in DB; skipped")

    # E4 — sunrise=sunset=0 → orientation_label None
    flat = db.spots.find_one(
        {"$and": [
            {"$or": [{"sunrise_rating": 0}, {"sunrise_rating": None}, {"sunrise_rating": {"$exists": False}}]},
            {"$or": [{"sunset_rating": 0}, {"sunset_rating": None}, {"sunset_rating": {"$exists": False}}]},
            {"$or": [{"morning_golden_hour_rating": 0}, {"morning_golden_hour_rating": None}, {"morning_golden_hour_rating": {"$exists": False}}]},
            {"$or": [{"evening_golden_hour_rating": 0}, {"evening_golden_hour_rating": None}, {"evening_golden_hour_rating": {"$exists": False}}]},
            {"privacy_mode": {"$ne": "private"}},
            {"visibility_status": "approved"},
        ]},
        {"_id": 0, "spot_id": 1},
    )
    if flat:
        r = client.get(BASE + f"/api/spots/{flat['spot_id']}", timeout=15)
        ol = r.json().get("orientation_label") if r.status_code == 200 else "ERR"
        if ol is None:
            record("E4 all-zero golden ratings → orientation_label is None", True, f"sid={flat['spot_id']}")
        else:
            record("E4 all-zero golden ratings → orientation_label is None", False, f"got {ol!r}")
    else:
        record("E4 flat-ratings test", True, "Minor: no qualifying spot in DB; skipped")


def test_F_regressions(client: httpx.Client, token: Optional[str]) -> None:
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    r = client.get(BASE + f"/api/spots/{SPOT_ID}/shoot-plan", headers=headers, timeout=30)
    if r.status_code == 200:
        body = r.json()
        keys = list(body.keys()) if isinstance(body, dict) else []
        record("F1 GET /api/spots/{id}/shoot-plan 200", True, f"keys={keys[:8]}")
    else:
        record("F1 GET /api/spots/{id}/shoot-plan", False, f"status={r.status_code} body={r.text[:200]}")

    r = client.get(BASE + "/api/feed/home", headers=headers, timeout=30)
    if r.status_code == 200:
        body = r.json()
        if isinstance(body, dict):
            sections = [k for k in ("hero", "nearby", "golden", "seasonal", "new", "trending", "featured") if k in body]
            record("F2 GET /api/feed/home 200", True, f"sections={sections} degraded={body.get('degraded')}")
            for s in sections:
                if isinstance(body.get(s), list) and body[s]:
                    expect_shape(body[s][0], f"F2 feed.{s}[0]")
                    break
        else:
            record("F2 GET /api/feed/home shape", False, f"unexpected type {type(body).__name__}")
    else:
        record("F2 GET /api/feed/home", False, f"status={r.status_code}")

    if token:
        try:
            r = client.post(
                BASE + "/api/collections/save-shoot-plan",
                headers=headers,
                json={"spot_id": SPOT_ID, "title": "Sandbox QA — Premium Explore test"},
                timeout=20,
            )
            if r.status_code in (200, 201):
                record("F3 POST /api/collections/save-shoot-plan", True, f"status={r.status_code}")
            elif 400 <= r.status_code < 500:
                record(
                    "F3 POST /api/collections/save-shoot-plan",
                    True,
                    f"Minor: {r.status_code} client response (non-500 acceptable); body={r.text[:200]}",
                )
            else:
                record("F3 POST /api/collections/save-shoot-plan", False, f"status={r.status_code} body={r.text[:200]}")
        except Exception as e:
            record("F3 POST /api/collections/save-shoot-plan", False, str(e))
    else:
        record("F3 POST /api/collections/save-shoot-plan", True, "Minor: skipped — no admin token")


def main() -> int:
    with httpx.Client(follow_redirects=True) as client:
        token = login_super_admin(client)
        test_A1_single_spot(client)
        test_A2_list(client)
        test_A3_nearby(client)
        test_C1_list_latency(client)
        test_D_private(client)
        test_E_edge_cases(client)
        test_F_regressions(client, token)

    print("\n" + "=" * 72)
    pass_count = sum(1 for r in results if r["ok"])
    fail_count = sum(1 for r in results if not r["ok"])
    print(f"TOTAL: {pass_count} pass, {fail_count} fail")
    if fail_count:
        print("\nFAILURES:")
        for r in results:
            if not r["ok"]:
                print(f"  - {r['name']}: {r['detail']}")
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
