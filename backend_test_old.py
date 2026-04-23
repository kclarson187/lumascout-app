"""
Backend QA — LumaScout Explore ranking + discovery badges.
Review scope:
  1) GET /api/spots?sort=quality — validate new fields + ordering
  2) Compare sort=quality vs sort=score vs sort=recent (orderings differ)
  3) Freshness: admin cover override flips is_fresh=true on a spot
  4) Non-regression: /me/saved, /marketplace/storefront, /feed still 200
  5) Role safety: non-admin cannot POST /admin/spots/{id}/action (403)
  6) admin action='feature' → spot.featured=true
Cleanup cover override at the end.
"""
import os
import sys
import uuid
import time
import requests

BASE = os.environ.get("BACKEND_URL", "http://localhost:8001/api")
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

_passed = 0
_failed = []

def ok(name):
    global _passed
    _passed += 1
    print(f"  PASS  {name}")

def fail(name, msg):
    _failed.append((name, msg))
    print(f"  FAIL  {name} :: {msg}")

def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"]

def register(email, password, name):
    r = requests.post(f"{BASE}/auth/register",
                      json={"email": email, "password": password, "name": name},
                      timeout=20)
    assert r.status_code == 200, f"register failed {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"]


def test_sort_quality_fields(admin_tok):
    print("\n[TEST 1] GET /api/spots?sort=quality — fields + ordering")
    r = requests.get(f"{BASE}/spots?sort=quality&limit=20", headers=hdr(admin_tok), timeout=30)
    if r.status_code != 200:
        fail("sort=quality returns 200", f"got {r.status_code}: {r.text[:200]}")
        return None
    ok("sort=quality returns 200")
    items = r.json()
    if not isinstance(items, list) or not items:
        fail("sort=quality returns non-empty list", f"items={items}")
        return None
    ok(f"sort=quality returned {len(items)} items")

    REQ_INT = "quality_score"
    BOOLS = ["is_new", "is_fresh", "is_trending", "is_verified_discovery"]
    all_fields_ok = True
    for i, s in enumerate(items):
        qs = s.get(REQ_INT)
        if not isinstance(qs, int) or not (0 <= qs <= 100):
            fail(f"item[{i}] quality_score int in [0,100]", f"got {qs!r} on {s.get('spot_id')}")
            all_fields_ok = False
        for b in BOOLS:
            v = s.get(b)
            if not isinstance(v, bool):
                fail(f"item[{i}] {b} is bool", f"got {v!r} on {s.get('spot_id')}")
                all_fields_ok = False
    if all_fields_ok:
        ok("every item has quality_score(int 0-100) + 4 discovery bools")

    def eff(s):
        q = float(s.get("quality_score") or 0)
        if s.get("is_trending"): q += 8
        if s.get("is_fresh"): q += 4
        if s.get("is_new"): q += 3
        if s.get("is_verified_discovery"): q += 2
        return q

    effs = [eff(s) for s in items]
    monotonic = all(effs[i] >= effs[i+1] for i in range(len(effs)-1))
    if monotonic:
        ok(f"ordered by effective quality desc: {effs[:5]}...")
    else:
        bads = [(i, effs[i], effs[i+1]) for i in range(len(effs)-1) if effs[i] < effs[i+1]]
        fail("ordered by effective quality desc", f"violations: {bads[:3]} full effs={effs}")
    return items


def test_sort_comparison(admin_tok):
    print("\n[TEST 2] sort=quality vs sort=score vs sort=recent — distinct orderings")
    results = {}
    for mode in ("quality", "score", "recent"):
        r = requests.get(f"{BASE}/spots?sort={mode}&limit=20", headers=hdr(admin_tok), timeout=30)
        if r.status_code != 200:
            fail(f"sort={mode} returns 200", f"got {r.status_code}")
            return
        ids = [s.get("spot_id") for s in r.json()]
        results[mode] = ids
        ok(f"sort={mode} top-3 → {ids[:3]}")

    pairs_diff = []
    pairs = [("quality", "score"), ("quality", "recent"), ("score", "recent")]
    for a, b in pairs:
        diff = results[a][:3] != results[b][:3]
        pairs_diff.append((a, b, diff))
    if any(d for _, _, d in pairs_diff):
        diffs = [f"{a}!={b}" for a, b, d in pairs_diff if d]
        ok(f"at least one pair produces different first-3 ordering: {diffs}")
    else:
        fail("first-3 differ for at least one pair",
             f"all three sorts return same first-3: {results['quality'][:3]}")


def test_freshness_override(admin_tok):
    print("\n[TEST 3] Freshness logic — admin_cover_override flips is_fresh=true")
    r = requests.get(f"{BASE}/spots?sort=recent&limit=50", headers=hdr(admin_tok), timeout=30)
    if r.status_code != 200 or not r.json():
        fail("fetch candidate list", f"got {r.status_code}")
        return None
    items = r.json()

    candidate = None
    for s in items:
        if not s.get("is_new") and len(s.get("images") or []) >= 1:
            candidate = s
            break
    if not candidate:
        for s in items:
            if len(s.get("images") or []) >= 1:
                candidate = s
                break
    if not candidate:
        fail("find candidate spot with images", "none found")
        return None
    spot_id = candidate["spot_id"]
    initial_fresh = bool(candidate.get("is_fresh"))
    initial_new = bool(candidate.get("is_new"))
    ok(f"using spot_id={spot_id} (is_new={initial_new}, is_fresh={initial_fresh})")

    det = requests.get(f"{BASE}/spots/{spot_id}", headers=hdr(admin_tok), timeout=20)
    if det.status_code != 200:
        fail("GET spot detail", f"got {det.status_code}")
        return None
    images = det.json().get("images") or []
    if not images:
        fail("spot has images", "no images")
        return None
    img_url = images[0]["image_url"]

    payload = {"image_url": img_url, "focal_x": 0.5, "focal_y": 0.5, "scale": 1.0, "rotation": 0}
    r = requests.patch(f"{BASE}/admin/spots/{spot_id}/cover",
                       headers=hdr(admin_tok), json=payload, timeout=20)
    if r.status_code != 200:
        fail("PATCH admin cover override", f"got {r.status_code}: {r.text[:200]}")
        return None
    ok("PATCH /admin/spots/{id}/cover → 200")

    time.sleep(0.5)
    r2 = requests.get(f"{BASE}/spots/{spot_id}", headers=hdr(admin_tok), timeout=20)
    if r2.status_code != 200:
        fail("re-GET spot", f"got {r2.status_code}")
        return spot_id
    spot_after = r2.json()
    is_fresh_after = bool(spot_after.get("is_fresh"))
    is_new_after = bool(spot_after.get("is_new"))
    if is_new_after:
        ok(f"spot is_new=true → is_fresh suppressed by design (is_fresh={is_fresh_after})")
    elif is_fresh_after:
        ok("is_fresh=true after admin_cover_override set")
    else:
        fail("is_fresh=true after override (when not new)",
             f"got is_fresh={is_fresh_after}, is_new={is_new_after}")

    r3 = requests.delete(f"{BASE}/admin/spots/{spot_id}/cover",
                         headers=hdr(admin_tok), timeout=20)
    if r3.status_code != 200:
        fail("DELETE admin cover override", f"got {r3.status_code}: {r3.text[:200]}")
    else:
        ok("DELETE /admin/spots/{id}/cover → 200")

    r4 = requests.get(f"{BASE}/spots/{spot_id}", headers=hdr(admin_tok), timeout=20)
    if r4.status_code == 200:
        body = r4.json()
        bads = []
        for b in ("is_new", "is_fresh", "is_trending", "is_verified_discovery"):
            v = body.get(b)
            if not isinstance(v, bool):
                bads.append((b, v))
        if bads:
            fail("after-delete is_* flags are bools", f"bad: {bads}")
        else:
            ok(f"after clear: is_new={body.get('is_new')} is_fresh={body.get('is_fresh')} "
               f"is_trending={body.get('is_trending')} is_verified_discovery={body.get('is_verified_discovery')}")
    else:
        fail("re-GET after DELETE", f"got {r4.status_code}")

    return spot_id


def test_non_regression(admin_tok):
    print("\n[TEST 4] Non-regression — /me/saved, /marketplace/storefront, /feed")
    for path in ("/me/saved", "/marketplace/storefront"):
        r = requests.get(f"{BASE}{path}", headers=hdr(admin_tok), timeout=20)
        if r.status_code == 200:
            ok(f"GET {path} → 200")
        else:
            fail(f"GET {path} → 200", f"got {r.status_code}: {r.text[:160]}")

    r = requests.get(f"{BASE}/feed", headers=hdr(admin_tok), timeout=20)
    if r.status_code == 200:
        ok("GET /feed → 200")
    else:
        r2 = requests.get(f"{BASE}/feed/home", headers=hdr(admin_tok), timeout=20)
        if r2.status_code == 200:
            ok(f"GET /feed/home → 200 (note: /feed direct returned {r.status_code})")
        else:
            fail("GET /feed or /feed/home → 200",
                 f"/feed={r.status_code}, /feed/home={r2.status_code}")


def test_role_safety(admin_tok):
    print("\n[TEST 5] Role safety — non-admin cannot POST /admin/spots/{id}/action")
    tag = uuid.uuid4().hex[:8]
    email = f"qa_ranking_{tag}@testmail.app"
    tok, _ = register(email, "S!trongPassword123", f"QA Ranking {tag}")

    r = requests.get(f"{BASE}/spots?sort=recent&limit=1", headers=hdr(admin_tok), timeout=20)
    if r.status_code != 200 or not r.json():
        fail("fetch spot for role safety test", f"got {r.status_code}")
        return None, None
    spot_id = r.json()[0]["spot_id"]

    r2 = requests.post(f"{BASE}/admin/spots/{spot_id}/action",
                       headers=hdr(tok),
                       json={"action": "feature"},
                       timeout=20)
    if r2.status_code == 403:
        ok("non-admin → 403 on /admin/spots/{id}/action")
    else:
        fail("non-admin → 403", f"got {r2.status_code}: {r2.text[:160]}")
    return email, tok


def test_admin_feature(admin_tok):
    print("\n[TEST 6] Admin POST /admin/spots/{id}/action {action:'feature'} → featured=true in view")
    r = requests.get(f"{BASE}/spots?sort=recent&limit=20", headers=hdr(admin_tok), timeout=20)
    if r.status_code != 200 or not r.json():
        fail("fetch spots", f"got {r.status_code}")
        return None
    spot = None
    for s in r.json():
        if not s.get("featured"):
            spot = s
            break
    if not spot:
        spot = r.json()[0]
    spot_id = spot["spot_id"]
    initial_featured = bool(spot.get("featured"))
    ok(f"using spot_id={spot_id} (featured_before={initial_featured})")

    r2 = requests.post(f"{BASE}/admin/spots/{spot_id}/action",
                       headers=hdr(admin_tok),
                       json={"action": "feature"},
                       timeout=20)
    if r2.status_code != 200:
        fail("admin feature action 200", f"got {r2.status_code}: {r2.text[:160]}")
        return spot_id
    ok("admin action=feature → 200")

    r3 = requests.get(f"{BASE}/spots/{spot_id}", headers=hdr(admin_tok), timeout=20)
    if r3.status_code != 200:
        fail("re-GET after feature", f"got {r3.status_code}")
        return spot_id
    featured_after = bool(r3.json().get("featured"))
    if featured_after:
        ok("spot.featured=true in public view after admin feature")
    else:
        fail("spot.featured=true after action", f"featured={featured_after}")

    ru = requests.post(f"{BASE}/admin/spots/{spot_id}/action",
                       headers=hdr(admin_tok),
                       json={"action": "unfeature"},
                       timeout=20)
    if ru.status_code == 200:
        ok("cleanup unfeature → 200")
    else:
        print(f"    [cleanup] unfeature got {ru.status_code}")
    return spot_id


def main():
    print(f"Testing backend @ {BASE}")
    admin_tok, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    print(f"Admin: {admin_user.get('username')} role={admin_user.get('role')}")

    test_sort_quality_fields(admin_tok)
    test_sort_comparison(admin_tok)
    freshness_spot_id = test_freshness_override(admin_tok)
    test_non_regression(admin_tok)
    test_role_safety(admin_tok)
    test_admin_feature(admin_tok)

    if freshness_spot_id:
        try:
            rc = requests.delete(f"{BASE}/admin/spots/{freshness_spot_id}/cover",
                                 headers=hdr(admin_tok), timeout=15)
            print(f"\n[cleanup] DELETE cover on {freshness_spot_id} → {rc.status_code}")
        except Exception as e:
            print(f"[cleanup] failed: {e}")

    print("\n" + "="*70)
    print(f"RESULT: {_passed} passed, {len(_failed)} failed")
    if _failed:
        print("\nFailures:")
        for n, m in _failed:
            print(f"  - {n}: {m}")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
