"""Backend validation for LumaScout P0 geocoding rewrite (Commit 7.7).

Covers review request tasks 1-6:
  1. /api/geocode/search for 5 canonical TX queries
  2. Cache hit behavior
  3. /api/geocode/reverse for Comfort, TX coords
  4. Error handling (empty / short / nonsense)
  5. Spot creation integrity (reject 0,0; accept valid coords; admin cleanup)
  6. Smoke check on auth/me, feed/home, spots list, recent-locations
"""
import json
import time
import uuid
import requests

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

PASSES: list = []
FAILS: list = []


def ok(name: str, msg: str = ""):
    PASSES.append(name)
    print(f"[PASS] {name}" + (f" — {msg}" if msg else ""))


def fail(name: str, msg: str = ""):
    FAILS.append((name, msg))
    print(f"[FAIL] {name} — {msg}")


def pp(obj):
    try:
        return json.dumps(obj, indent=2)[:800]
    except Exception:
        return str(obj)[:800]


# ----------------------------------------------------------------------------
# Auth setup
# ----------------------------------------------------------------------------
r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
ADMIN_TOKEN = r.json()["token"]
HEADERS = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
print(f"[OK] admin login token acquired, len={len(ADMIN_TOKEN)}")

# Sanity: who am I?
me = requests.get(f"{BASE}/auth/me", headers=HEADERS, timeout=10).json()
ADMIN_USER_ID = me.get("user_id")
print(f"[OK] /auth/me: username={me.get('username')} role={me.get('role')} user_id={ADMIN_USER_ID}")


def _validate_result_shape(name: str, item: dict, query: str) -> bool:
    """Check result has required keys + non-null-island coords."""
    required = ["latitude", "longitude", "name", "display_name", "source_provider"]
    missing = [k for k in required if k not in item]
    if missing:
        fail(name, f"missing keys {missing} in item for query '{query}': {pp(item)}")
        return False
    lat = item.get("latitude")
    lng = item.get("longitude")
    if lat is None or lng is None:
        fail(name, f"null lat/lng for '{query}': {pp(item)}")
        return False
    if abs(float(lat)) < 1e-3 and abs(float(lng)) < 1e-3:
        fail(name, f"null-island coords for '{query}': lat={lat} lng={lng}")
        return False
    return True


# ============================================================================
# TASK 1 — /api/geocode/search for 5 canonical TX queries
# ============================================================================
print("\n" + "=" * 72)
print("TASK 1 — /api/geocode/search canonical TX queries")
print("=" * 72)

CANONICAL_QUERIES = [
    # (query, expected_city_substr, expected_state_substr, label)
    ("Joshua Springs Preserve Comfort TX", "comfort", "tx", "Joshua Springs"),
    ("McAllister Park San Antonio",        "san antonio", "tx", "McAllister Park"),
    ("Pearl District San Antonio",         "san antonio", "tx", "Pearl District"),
    ("Muleshoe Bend Texas",                None,          "tx", "Muleshoe Bend"),  # POI near Spicewood
    ("Downtown Austin TX",                 "austin",      "tx", "Downtown Austin"),
]

top_results_for_spot_test: list = []

for q, exp_city, exp_state, label in CANONICAL_QUERIES:
    try:
        t0 = time.time()
        r = requests.get(f"{BASE}/geocode/search", params={"q": q, "limit": 8, "debug": 1}, timeout=30)
        elapsed = time.time() - t0
    except Exception as ex:
        fail(f"geocode.search[{label}]", f"request error: {ex}")
        continue
    if r.status_code != 200:
        fail(f"geocode.search[{label}]", f"HTTP {r.status_code}: {r.text[:400]}")
        continue
    body = r.json()
    # Response shape — query + results + provider + matched_query + variant_index
    for k in ("query", "results"):
        if k not in body:
            fail(f"geocode.search[{label}].shape", f"missing key '{k}': {pp(body)}")
    results = body.get("results") or []
    if not results:
        fail(f"geocode.search[{label}]", f"empty results for '{q}', body={pp(body)}")
        continue
    top = results[0]
    if not _validate_result_shape(f"geocode.search[{label}].shape", top, q):
        continue
    # Must have city/state/postcode keys (postcode may be empty string, that's OK)
    for k in ("city", "state", "postcode"):
        if k not in top:
            fail(f"geocode.search[{label}].shape", f"missing '{k}' key in top result: {pp(top)}")
    # Expected city/state sanity
    lat = float(top["latitude"]); lng = float(top["longitude"])
    top_city = (top.get("city") or "").lower()
    top_state = (top.get("state") or "").lower()
    top_display = (top.get("display_name") or "").lower()
    city_ok = exp_city is None or exp_city in top_city or exp_city in top_display
    state_ok = (exp_state in top_state) or (exp_state in top_display) or ("texas" in top_display)
    # Check provider / matched_query / variant_index fields at top-level
    provider = body.get("provider")
    matched_query = body.get("matched_query")
    variant_index = body.get("variant_index")
    provider_ok = provider in ("mapbox", "nominatim")
    msg = (f"lat={lat:.4f} lng={lng:.4f} name='{top.get('name')}' "
           f"city='{top.get('city')}' state='{top.get('state')}' pc='{top.get('postcode')}' "
           f"provider={provider} matched='{matched_query}' variant={variant_index} "
           f"elapsed={elapsed:.2f}s")
    if provider_ok and city_ok and state_ok:
        ok(f"geocode.search[{label}]", msg)
    else:
        fail(f"geocode.search[{label}]",
             f"sanity-fail (provider_ok={provider_ok} city_ok={city_ok} state_ok={state_ok}); {msg}; "
             f"attempted={pp(body.get('attempted'))}")
    # Stash top result from Downtown Austin for Task 5c
    if label == "Downtown Austin":
        top_results_for_spot_test.append((label, q, top))

# ============================================================================
# TASK 2 — Cache hit behavior (second call returns cached:true)
# ============================================================================
print("\n" + "=" * 72)
print("TASK 2 — Cache hit behavior")
print("=" * 72)
cache_q = "Joshua Springs Preserve Comfort TX"
r = requests.get(f"{BASE}/geocode/search", params={"q": cache_q, "limit": 8}, timeout=30)
if r.status_code != 200:
    fail("geocode.cache_hit", f"HTTP {r.status_code}: {r.text[:300]}")
else:
    body = r.json()
    if body.get("cached") is True and (body.get("results") or []):
        ok("geocode.cache_hit", f"cached=True, provider={body.get('provider')}, results={len(body.get('results') or [])}")
    else:
        fail("geocode.cache_hit",
             f"expected cached=True on second identical call. got cached={body.get('cached')} results={len(body.get('results') or [])}")

# ============================================================================
# TASK 3 — /api/geocode/reverse for Comfort TX coords
# ============================================================================
print("\n" + "=" * 72)
print("TASK 3 — /api/geocode/reverse lat=29.88705 lng=-98.81158")
print("=" * 72)
r = requests.get(f"{BASE}/geocode/reverse", params={"lat": 29.88705, "lng": -98.81158}, timeout=20)
if r.status_code != 200:
    fail("geocode.reverse", f"HTTP {r.status_code}: {r.text[:300]}")
else:
    body = r.json()
    display = (body.get("display_name") or "").lower()
    city = (body.get("city") or "").lower()
    state = (body.get("state") or "").lower()
    provider = body.get("source_provider") or ""
    country = (body.get("country") or body.get("country_name") or "").lower()
    comfort_or_tx = ("comfort" in display) or ("comfort" in city) or ("texas" in display) or ("tx" == state) or ("united states" in country)
    if comfort_or_tx and body.get("latitude") and body.get("longitude"):
        ok("geocode.reverse",
           f"provider={provider} city='{body.get('city')}' state='{body.get('state')}' display='{body.get('display_name')}'")
    else:
        fail("geocode.reverse",
             f"expected Comfort/TX address, got: {pp(body)}")

# ============================================================================
# TASK 4 — Error handling (empty / short / nonsense)
# ============================================================================
print("\n" + "=" * 72)
print("TASK 4 — Error handling")
print("=" * 72)

# 4a: empty
r = requests.get(f"{BASE}/geocode/search", params={"q": ""}, timeout=10)
if r.status_code == 200 and r.json().get("results") == []:
    ok("geocode.err.empty", "200 + empty results")
else:
    fail("geocode.err.empty", f"HTTP {r.status_code}: {r.text[:200]}")

# 4b: short (1 char)
r = requests.get(f"{BASE}/geocode/search", params={"q": "a"}, timeout=10)
if r.status_code == 200 and r.json().get("results") == []:
    ok("geocode.err.short", "200 + empty results")
else:
    fail("geocode.err.short", f"HTTP {r.status_code}: {r.text[:200]}")

# 4c: nonsense — must not 5xx, must not return (0,0)
r = requests.get(f"{BASE}/geocode/search", params={"q": "zzzzzzzzzzzzzzzzzz"}, timeout=30)
if r.status_code >= 500:
    fail("geocode.err.nonsense", f"5xx: HTTP {r.status_code}: {r.text[:200]}")
elif r.status_code != 200:
    fail("geocode.err.nonsense", f"non-200/non-5xx HTTP {r.status_code}: {r.text[:200]}")
else:
    body = r.json()
    results = body.get("results") or []
    any_null_island = False
    for it in results:
        lat = it.get("latitude"); lng = it.get("longitude")
        if lat is not None and lng is not None:
            if abs(float(lat)) < 1e-3 and abs(float(lng)) < 1e-3:
                any_null_island = True
                break
    if any_null_island:
        fail("geocode.err.nonsense", f"null-island coord leaked: {pp(body)}")
    else:
        ok("geocode.err.nonsense", f"safe 200 response — results_count={len(results)}")

# ============================================================================
# TASK 5 — Spot creation integrity
# ============================================================================
print("\n" + "=" * 72)
print("TASK 5 — Spot creation integrity (null-island rejection)")
print("=" * 72)

# 5a: login already done — admin token available
ok("spot_integrity.login", f"admin token acquired, role={me.get('role')}")

# 5b: POST /api/spots with lat=0, lng=0 → MUST reject with 400/422
null_island_payload = {
    "title": f"QA Null Island {uuid.uuid4().hex[:6]}",
    "city": "Nowhere",
    "state": "TX",
    "latitude": 0.0,
    "longitude": 0.0,
    "shoot_types": ["landscape"],
    "privacy_mode": "private",
    "source_type": "manual_entry",
}
r = requests.post(f"{BASE}/spots", json=null_island_payload, headers=HEADERS, timeout=15)
if r.status_code in (400, 422):
    detail_text = r.text
    ok("spot_integrity.reject_0_0", f"HTTP {r.status_code} rejected. detail preview: {detail_text[:250]}")
else:
    fail("spot_integrity.reject_0_0",
         f"expected 400/422, got HTTP {r.status_code}: {r.text[:300]}")

# 5c: valid POST using coords from Downtown Austin TX geocode
created_spot_id = None
if top_results_for_spot_test:
    label, q, top = top_results_for_spot_test[0]
    lat = float(top["latitude"])
    lng = float(top["longitude"])
    valid_payload = {
        "title": f"QA Geocode Test {uuid.uuid4().hex[:6]}",
        "city": top.get("city") or "Austin",
        "state": top.get("state") or "TX",
        "latitude": lat,
        "longitude": lng,
        "shoot_types": ["landscape"],
        "privacy_mode": "private",
        "source_type": "searched_place",
        "original_search_query": q,
        "original_address_input": q,
        "geocode_status": "success",
        "geocode_confidence": float(top.get("confidence") or 0.9),
    }
    r = requests.post(f"{BASE}/spots", json=valid_payload, headers=HEADERS, timeout=15)
    if r.status_code == 200:
        body = r.json()
        spot_id = body.get("spot_id")
        got_lat = body.get("latitude")
        got_lng = body.get("longitude")
        if spot_id and got_lat is not None and got_lng is not None and \
           abs(float(got_lat) - lat) < 0.001 and abs(float(got_lng) - lng) < 0.001:
            ok("spot_integrity.valid_post",
               f"spot_id={spot_id} lat={got_lat} lng={got_lng} (matches geocode input within 0.001)")
            created_spot_id = spot_id
        else:
            fail("spot_integrity.valid_post",
                 f"coords roundtrip mismatch: sent ({lat},{lng}) got ({got_lat},{got_lng}). body={pp(body)}")
    else:
        fail("spot_integrity.valid_post", f"HTTP {r.status_code}: {r.text[:400]}")
else:
    fail("spot_integrity.valid_post", "no Downtown Austin geocode result available to exercise this path")

# 5d: delete created spot as super-admin (test hygiene)
if created_spot_id:
    r = requests.delete(
        f"{BASE}/admin/spots/{created_spot_id}",
        json={"reason_code": "other", "reason_note": "QA cleanup geocode test"},
        headers=HEADERS,
        timeout=15,
    )
    if r.status_code == 200 and r.json().get("ok"):
        ok("spot_integrity.cleanup_delete", f"deleted spot {created_spot_id}")
    else:
        fail("spot_integrity.cleanup_delete", f"HTTP {r.status_code}: {r.text[:300]}")

# ============================================================================
# TASK 6 — Regression smoke: /auth/me, /feed/home, /spots, /me/recent-locations
# ============================================================================
print("\n" + "=" * 72)
print("TASK 6 — Regression smoke on unrelated endpoints")
print("=" * 72)

for path, label in [
    ("/auth/me", "smoke.auth_me"),
    ("/feed/home", "smoke.feed_home"),
    ("/spots?limit=10", "smoke.spots_list"),
    ("/me/recent-locations", "smoke.recent_locations"),
]:
    r = requests.get(f"{BASE}{path}", headers=HEADERS, timeout=15)
    if r.status_code == 200:
        snippet = pp(r.json())[:180]
        ok(label, f"200 — {snippet}")
    else:
        fail(label, f"HTTP {r.status_code}: {r.text[:300]}")

# ============================================================================
# SUMMARY
# ============================================================================
print("\n" + "#" * 72)
print(f"## SUMMARY: {len(PASSES)} pass, {len(FAILS)} fail")
print("#" * 72)
if FAILS:
    print("\nFAILED:")
    for name, msg in FAILS:
        print(f"  ✗ {name}: {msg[:300]}")

import sys
sys.exit(0 if not FAILS else 1)
