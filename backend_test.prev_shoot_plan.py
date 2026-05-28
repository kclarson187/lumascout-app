"""
Backend test for "Plan This Shoot" endpoints — Jun 2025 feature.

Endpoints under test (routes/shoot_plan.py):
  - GET  /api/spots/{spot_id}/shoot-plan
  - POST /api/collections/save-shoot-plan
  - GET  /api/me/shoot-plans

Test target: http://localhost:8001 (per review instructions).
"""
from __future__ import annotations

import os
import time
import re
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from pymongo import MongoClient

# ─────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────

BASE = "http://localhost:8001"
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

# ─────────────────────────────────────────────────────────────────────
# Reporting helpers
# ─────────────────────────────────────────────────────────────────────

RESULTS: List[Dict[str, Any]] = []
FAIL_DETAILS: List[str] = []


def record(name: str, ok: bool, detail: str = "") -> bool:
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}" + (f" — {detail}" if detail and not ok else ""))
    RESULTS.append({"name": name, "ok": ok, "detail": detail})
    if not ok:
        FAIL_DETAILS.append(f"❌ {name}: {detail}")
    return ok


# ─────────────────────────────────────────────────────────────────────
# Login
# ─────────────────────────────────────────────────────────────────────

def login() -> str:
    r = httpx.post(
        f"{BASE}/api/auth/login",
        json={"email": SUPER_ADMIN_EMAIL, "password": SUPER_ADMIN_PASSWORD},
        timeout=20.0,
    )
    if r.status_code != 200:
        raise SystemExit(f"super_admin login failed: {r.status_code} {r.text[:300]}")
    data = r.json()
    token = data["token"]
    user = data["user"]
    print(f"[setup] logged in as {user['email']} role={user.get('role')}")
    return token


TOKEN = login()
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# Mongo client for direct verification
mongo = MongoClient(MONGO_URL)
mdb = mongo[DB_NAME]


# ─────────────────────────────────────────────────────────────────────
# Test Section A — GET /api/spots/{spot_id}/shoot-plan
# ─────────────────────────────────────────────────────────────────────

print("\n══ Section A — GET /spots/{id}/shoot-plan ══")


def check_plan_shape(name: str, payload: Dict[str, Any]) -> None:
    required_keys = [
        "spot_id", "spot_name", "coordinates", "best_time_to_arrive",
        "light_quality_timeline", "sun_events", "five_day_weather",
        "weather_available", "composition_tips", "gear_suggestions",
        "nearby_backup_spots", "generated_at",
    ]
    missing = [k for k in required_keys if k not in payload]
    record(f"{name}: required top-level keys", not missing,
           detail=f"missing keys: {missing}" if missing else "")

    tl = payload.get("light_quality_timeline")
    record(f"{name}: light_quality_timeline length=24",
           isinstance(tl, list) and len(tl) == 24,
           detail=f"got len={len(tl) if isinstance(tl, list) else type(tl).__name__}")

    w = payload.get("five_day_weather")
    ok_w = (w is None) or (isinstance(w, list) and len(w) == 5)
    record(f"{name}: five_day_weather is null or len=5", ok_w,
           detail=f"got={'null' if w is None else f'len={len(w)}'}")

    se = payload.get("sun_events") or {}
    sr_local = se.get("sunrise_local") if isinstance(se, dict) else None
    ok_sr = bool(sr_local and re.match(r"^\d{1,2}:\d{2}\s?(AM|PM)$", sr_local))
    record(f"{name}: sun_events.sunrise_local format like '6:31 AM'", ok_sr,
           detail=f"got={sr_local!r}")

    ct = payload.get("composition_tips") or []
    record(f"{name}: composition_tips has at least 1 string",
           isinstance(ct, list) and len(ct) >= 1 and all(isinstance(x, str) for x in ct),
           detail=f"got={ct!r}")


# A.1 — Anonymous request on public spot
t0 = time.time()
r = httpx.get(f"{BASE}/api/spots/{SPOT_ID}/shoot-plan", timeout=20.0)
dt_anon = time.time() - t0
record("A.1: anonymous request returns 200", r.status_code == 200,
       detail=f"status={r.status_code}, body={r.text[:200]}")
plan_anon: Dict[str, Any] = {}
if r.status_code == 200:
    plan_anon = r.json()
    check_plan_shape("A.1", plan_anon)

# A.2 — Authed request returns same shape (200)
t0 = time.time()
r = httpx.get(f"{BASE}/api/spots/{SPOT_ID}/shoot-plan", headers=HEADERS, timeout=20.0)
dt_auth = time.time() - t0
record("A.2: authed request returns 200", r.status_code == 200,
       detail=f"status={r.status_code}, body={r.text[:200]}")
if r.status_code == 200:
    plan_auth = r.json()
    check_plan_shape("A.2", plan_auth)

# A.3 — Non-existent spot id → 404
r = httpx.get(f"{BASE}/api/spots/spot_nope_xxxxxx/shoot-plan", timeout=10.0)
record("A.3: non-existent spot returns 404", r.status_code == 404,
       detail=f"status={r.status_code}")

# A.4 — Performance under ~6s
record(f"A.4: response time anon < 6s ({dt_anon:.2f}s)", dt_anon < 6.0,
       detail=f"{dt_anon:.2f}s")
record(f"A.4: response time auth < 6s ({dt_auth:.2f}s)", dt_auth < 6.0,
       detail=f"{dt_auth:.2f}s")

print(f"  [perf] anon={dt_anon:.2f}s, auth={dt_auth:.2f}s")

# ─────────────────────────────────────────────────────────────────────
# Test Section B — POST /api/collections/save-shoot-plan
# ─────────────────────────────────────────────────────────────────────

print("\n══ Section B — POST /collections/save-shoot-plan ══")

me = httpx.get(f"{BASE}/api/auth/me", headers=HEADERS, timeout=10.0).json()
my_user_id = me.get("user_id")
print(f"[setup] my user_id={my_user_id}")

# Clean up any previous test rows so dedupe assertions are accurate
mdb.shoot_plans.delete_many({"user_id": my_user_id, "spot_id": SPOT_ID})
mdb.collections.update_many(
    {"owner_user_id": my_user_id, "name": "Shoot Plans"},
    {"$pull": {"spot_ids": SPOT_ID}},
)

# B.1 — Without auth → 401/403
r = httpx.post(f"{BASE}/api/collections/save-shoot-plan",
               json={"spot_id": SPOT_ID}, timeout=10.0)
record("B.1: unauthenticated save returns 401/403", r.status_code in (401, 403),
       detail=f"status={r.status_code}, body={r.text[:200]}")

# B.2 — Authed minimal body
r = httpx.post(f"{BASE}/api/collections/save-shoot-plan",
               headers=HEADERS, json={"spot_id": SPOT_ID}, timeout=15.0)
record("B.2: authed minimal body returns 200", r.status_code == 200,
       detail=f"status={r.status_code}, body={r.text[:200]}")
b2_response: Dict[str, Any] = {}
if r.status_code == 200:
    b2_response = r.json()
    has_keys = all(k in b2_response for k in ("ok", "plan_id", "collection_id", "collection_name", "message"))
    record("B.2: response has required keys",
           has_keys, detail=f"got keys={list(b2_response.keys())}")
    record("B.2: collection_name == 'Shoot Plans'",
           b2_response.get("collection_name") == "Shoot Plans",
           detail=f"got={b2_response.get('collection_name')!r}")
    record("B.2: ok == True", b2_response.get("ok") is True,
           detail=f"got={b2_response.get('ok')!r}")

plan_id_minimal = b2_response.get("plan_id")
collection_id = b2_response.get("collection_id")

# B.3 — Authed with full plan payload
full_body = {
    "spot_id": SPOT_ID,
    "spot_name": "Bluebonnet Fields at Muleshoe Bend",
    "latitude": 30.5378,
    "longitude": -98.0242,
    "best_time_to_arrive": {"label": "Evening golden hour", "iso": "2025-06-15T19:53:00-05:00"},
    "light_quality_timeline": [{"hour": 19, "label": "7 PM", "quality": "excellent"}],
    "weather_snapshot": [{"date": "2025-06-15", "label": "Clear sky", "high_f": 95}],
    "composition_tips": ["Shoot low through foreground blooms.", "Use f/2.8."],
    "gear_suggestions": ["50–85mm prime", "Reflector"],
    "backup_spot_ids": ["spot_backup_1"],
    "notes": "Worth scouting parking the night before."
}
r = httpx.post(f"{BASE}/api/collections/save-shoot-plan",
               headers=HEADERS, json=full_body, timeout=15.0)
record("B.3: full payload returns 200", r.status_code == 200,
       detail=f"status={r.status_code}, body={r.text[:200]}")
plan_id_full = r.json().get("plan_id") if r.status_code == 200 else None

# B.4 — Verify Mongo state
plans_for_spot = list(mdb.shoot_plans.find({"user_id": my_user_id, "spot_id": SPOT_ID}))
plan_ids = {p.get("plan_id") for p in plans_for_spot}
record("B.4a: NEW shoot_plans doc inserted for minimal save",
       plan_id_minimal in plan_ids,
       detail=f"plan_id_minimal={plan_id_minimal}, found_ids={plan_ids}")
record("B.4a: NEW shoot_plans doc inserted for full payload save",
       plan_id_full in plan_ids,
       detail=f"plan_id_full={plan_id_full}, found_ids={plan_ids}")
record(f"B.4a: 2+ distinct shoot_plans docs (no overwrite) — found {len(plan_ids)}",
       len(plan_ids) >= 2,
       detail=f"plan_ids={plan_ids}")

col_doc = mdb.collections.find_one({"collection_id": collection_id}) if collection_id else None
record("B.4b: 'Shoot Plans' collection exists in Mongo",
       col_doc is not None,
       detail=f"collection_id={collection_id}")
if col_doc:
    record("B.4b: collection.name == 'Shoot Plans'",
           col_doc.get("name") == "Shoot Plans",
           detail=f"got={col_doc.get('name')!r}")
    record("B.4b: collection.is_shoot_plans == True",
           col_doc.get("is_shoot_plans") is True,
           detail=f"got={col_doc.get('is_shoot_plans')!r}")
    record("B.4b: collection.spot_ids includes SPOT_ID",
           SPOT_ID in (col_doc.get("spot_ids") or []),
           detail=f"spot_ids={col_doc.get('spot_ids')}")
    record("B.4b: collection.owner_user_id == viewer",
           col_doc.get("owner_user_id") == my_user_id,
           detail=f"got={col_doc.get('owner_user_id')!r}")

full_doc = next((p for p in plans_for_spot if p.get("plan_id") == plan_id_full), None)
if full_doc:
    record("B.4c: full doc persisted composition_tips",
           full_doc.get("composition_tips") == full_body["composition_tips"],
           detail=f"got={full_doc.get('composition_tips')!r}")
    record("B.4c: full doc persisted weather_snapshot",
           full_doc.get("weather_snapshot") == full_body["weather_snapshot"],
           detail=f"got={full_doc.get('weather_snapshot')!r}")
    record("B.4c: full doc persisted backup_spot_ids",
           full_doc.get("backup_spot_ids") == full_body["backup_spot_ids"],
           detail=f"got={full_doc.get('backup_spot_ids')!r}")
    record("B.4c: full doc persisted coordinates.latitude",
           (full_doc.get("coordinates") or {}).get("latitude") == 30.5378,
           detail=f"got={full_doc.get('coordinates')!r}")

# B.5 — Save with non-existent spot_id → 404
r = httpx.post(f"{BASE}/api/collections/save-shoot-plan",
               headers=HEADERS, json={"spot_id": "spot_nope_xxxxxx"},
               timeout=10.0)
record("B.5: save with non-existent spot returns 404", r.status_code == 404,
       detail=f"status={r.status_code}, body={r.text[:200]}")

# ─────────────────────────────────────────────────────────────────────
# Test Section C — GET /api/me/shoot-plans
# ─────────────────────────────────────────────────────────────────────

print("\n══ Section C — GET /me/shoot-plans ══")

# C.1 — Without auth → 401/403
r = httpx.get(f"{BASE}/api/me/shoot-plans", timeout=10.0)
record("C.1: unauthenticated list returns 401/403", r.status_code in (401, 403),
       detail=f"status={r.status_code}, body={r.text[:200]}")

# C.2 — Authed returns {items, count}, newest-first
r = httpx.get(f"{BASE}/api/me/shoot-plans", headers=HEADERS, timeout=10.0)
record("C.2: authed list returns 200", r.status_code == 200,
       detail=f"status={r.status_code}")
if r.status_code == 200:
    data = r.json()
    record("C.2: response has 'items' and 'count' keys",
           "items" in data and "count" in data,
           detail=f"keys={list(data.keys())}")
    items = data.get("items") or []
    record("C.2: count matches items length",
           data.get("count") == len(items),
           detail=f"count={data.get('count')}, items={len(items)}")
    if len(items) >= 2:
        def _ts(p):
            v = p.get("created_at")
            if isinstance(v, str):
                try:
                    return datetime.fromisoformat(v.replace("Z", "+00:00"))
                except Exception:
                    return datetime.min
            return v or datetime.min
        ts_list = [_ts(p) for p in items]
        is_desc = all(ts_list[i] >= ts_list[i + 1] for i in range(len(ts_list) - 1))
        record("C.2: items sorted newest-first", is_desc,
               detail=f"timestamps={[str(t) for t in ts_list[:5]]}")
    ids = {p.get("plan_id") for p in items}
    record("C.2: includes both plan_ids from section B",
           plan_id_minimal in ids and plan_id_full in ids,
           detail=f"ids subset check: minimal in ids={plan_id_minimal in ids}, full in ids={plan_id_full in ids}")

# C.3 — Filter by spot_id
r = httpx.get(f"{BASE}/api/me/shoot-plans",
              params={"spot_id": SPOT_ID}, headers=HEADERS, timeout=10.0)
record("C.3: spot_id filter returns 200", r.status_code == 200,
       detail=f"status={r.status_code}")
if r.status_code == 200:
    items = r.json().get("items") or []
    all_match = all(p.get("spot_id") == SPOT_ID for p in items)
    record(f"C.3: every item.spot_id == {SPOT_ID} (got {len(items)} items)",
           all_match,
           detail=f"distinct={set(p.get('spot_id') for p in items)}")

# ─────────────────────────────────────────────────────────────────────
# Test Section D — Edge cases
# ─────────────────────────────────────────────────────────────────────

print("\n══ Section D — Edge cases ══")

# D.1 — Insert a spot with no lat/lng and test the endpoint
TEMP_SPOT_ID = f"spot_test_nolatlng_{int(time.time())}"
mdb.spots.insert_one({
    "spot_id": TEMP_SPOT_ID,
    "title": "Temporary No-Coords Spot (testing)",
    "category": "park",
    "shoot_types": [],
    "privacy_mode": "public",
    "visibility_status": "approved",
    "is_test_data": True,
    "owner_user_id": my_user_id,
    "created_at": datetime.utcnow(),
})
try:
    r = httpx.get(f"{BASE}/api/spots/{TEMP_SPOT_ID}/shoot-plan", timeout=10.0)
    record("D.1: spot with no lat/lng returns 200 (NOT 500)",
           r.status_code == 200,
           detail=f"status={r.status_code}, body={r.text[:300]}")
    if r.status_code == 200:
        body = r.json()
        record("D.1: coordinates == null",
               body.get("coordinates") is None,
               detail=f"got={body.get('coordinates')!r}")
        record("D.1: light_quality_timeline == []",
               body.get("light_quality_timeline") == [],
               detail=f"got len={len(body.get('light_quality_timeline') or [])}")
        record("D.1: five_day_weather == null",
               body.get("five_day_weather") is None,
               detail=f"got={body.get('five_day_weather')!r}")
        record("D.1: weather_available == False",
               body.get("weather_available") is False,
               detail=f"got={body.get('weather_available')!r}")
        record("D.1: composition_tips still present",
               isinstance(body.get("composition_tips"), list) and len(body["composition_tips"]) >= 1,
               detail=f"got={body.get('composition_tips')!r}")
finally:
    mdb.spots.delete_one({"spot_id": TEMP_SPOT_ID})

# D.2 — Open-Meteo path verification
if plan_anon:
    if plan_anon.get("weather_available") is True:
        record("D.2: weather success path — five_day_weather is non-empty list",
               isinstance(plan_anon.get("five_day_weather"), list) and len(plan_anon["five_day_weather"]) > 0,
               detail="weather call succeeded; success-path shape validated")
    else:
        record("D.2: weather failure path — graceful fallback",
               plan_anon.get("five_day_weather") is None
               and isinstance(plan_anon.get("composition_tips"), list)
               and isinstance(plan_anon.get("sun_events"), dict),
               detail="weather upstream failed during this test run; rest of plan still renders")

# ─────────────────────────────────────────────────────────────────────
# Final summary
# ─────────────────────────────────────────────────────────────────────

print("\n══ Summary ══")
passed = sum(1 for r in RESULTS if r["ok"])
failed = sum(1 for r in RESULTS if not r["ok"])
print(f"PASS: {passed}    FAIL: {failed}    TOTAL: {len(RESULTS)}")
if FAIL_DETAILS:
    print("\nFAILURES:")
    for f in FAIL_DETAILS:
        print("  ", f)

sys.exit(0 if failed == 0 else 1)
