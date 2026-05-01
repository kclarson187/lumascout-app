"""
Backend test — LumaScout CR #1 (June 2025) changes.

Focus:
  1) GET  /api/directory/facets       — new aggregation endpoint
  2) GET  /api/spots?limit=...        — server-side hard-cap (200)
  3) POST /api/errors                 — telemetry endpoint

General sanity: /api/auth/me, /api/spots?limit=10, /api/directory?limit=5.
"""
from __future__ import annotations
import sys
import requests

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

results: list[tuple[str, bool, str]] = []
ADMIN_TOKEN: str | None = None


def check(label: str, cond: bool, detail: str = "") -> bool:
    results.append((label, cond, detail))
    mark = "PASS" if cond else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))
    return cond


def login_admin() -> str | None:
    try:
        r = requests.post(
            f"{BASE}/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=20,
        )
        if r.status_code != 200:
            print(f"  admin login failed: {r.status_code} {r.text[:200]}")
            return None
        tok = r.json().get("token")
        print(f"  admin login ok (token len={len(tok or '')})")
        return tok
    except Exception as e:
        print(f"  admin login exception: {e}")
        return None


def test_directory_facets_unauth():
    print("\n== Section 1a: GET /api/directory/facets (unauthenticated, default limit) ==")
    r = requests.get(f"{BASE}/directory/facets", timeout=20)
    check("1a.1 status=200 (unauthenticated)", r.status_code == 200, f"status={r.status_code}")
    if r.status_code != 200:
        print("    body:", r.text[:300])
        return
    body = r.json()
    check("1a.2 response is a dict", isinstance(body, dict))
    check("1a.3 has top_cities key", "top_cities" in body)
    check("1a.4 has top_specialties key", "top_specialties" in body)
    tc = body.get("top_cities") or []
    ts = body.get("top_specialties") or []
    check("1a.5 top_cities is a list", isinstance(tc, list))
    check("1a.6 top_specialties is a list", isinstance(ts, list))

    if tc:
        first = tc[0]
        check("1a.7 top_cities[0] has {city,count}",
              isinstance(first, dict) and "city" in first and "count" in first,
              f"item={first}")
        check("1a.8 top_cities[0].city is str", isinstance(first.get("city"), str))
        check("1a.9 top_cities[0].count is int", isinstance(first.get("count"), int))
        counts = [int(x.get("count", 0)) for x in tc]
        sorted_desc = all(counts[i] >= counts[i + 1] for i in range(len(counts) - 1))
        check("1a.10 top_cities sorted by count desc", sorted_desc,
              f"counts={counts}")
    else:
        print("    NOTE: top_cities is empty — no directory-eligible users with city field")

    if ts:
        first = ts[0]
        check("1a.11 top_specialties[0] has {specialty,count}",
              isinstance(first, dict) and "specialty" in first and "count" in first,
              f"item={first}")
        check("1a.12 top_specialties[0].specialty is str",
              isinstance(first.get("specialty"), str))
        check("1a.13 top_specialties[0].count is int",
              isinstance(first.get("count"), int))
        counts = [int(x.get("count", 0)) for x in ts]
        sorted_desc = all(counts[i] >= counts[i + 1] for i in range(len(counts) - 1))
        check("1a.14 top_specialties sorted by count desc", sorted_desc,
              f"counts={counts}")
    else:
        print("    NOTE: top_specialties is empty")

    check("1a.15 top_cities length <= 12 (default)", len(tc) <= 12,
          f"len={len(tc)}")
    check("1a.16 top_specialties length <= 12 (default)", len(ts) <= 12,
          f"len={len(ts)}")


def test_directory_facets_limit_clamp():
    print("\n== Section 1b: limit clamping [3..30] ==")
    r = requests.get(f"{BASE}/directory/facets?limit=1", timeout=20)
    check("1b.1 limit=1 still returns 200", r.status_code == 200)
    if r.status_code == 200:
        b = r.json()
        check("1b.2 limit=1 clamped to >=3 (top_cities len <= 3)",
              len(b.get("top_cities") or []) <= 3,
              f"len={len(b.get('top_cities') or [])}")
        check("1b.3 limit=1 clamped to >=3 (top_specialties len <= 3)",
              len(b.get("top_specialties") or []) <= 3)

    r = requests.get(f"{BASE}/directory/facets?limit=9999", timeout=20)
    check("1b.4 limit=9999 still returns 200", r.status_code == 200)
    if r.status_code == 200:
        b = r.json()
        check("1b.5 limit=9999 clamped to <=30 (top_cities len <= 30)",
              len(b.get("top_cities") or []) <= 30,
              f"len={len(b.get('top_cities') or [])}")
        check("1b.6 limit=9999 clamped to <=30 (top_specialties len <= 30)",
              len(b.get("top_specialties") or []) <= 30)

    r = requests.get(f"{BASE}/directory/facets?limit=5", timeout=20)
    check("1b.7 limit=5 returns 200", r.status_code == 200)
    if r.status_code == 200:
        b = r.json()
        check("1b.8 limit=5 top_cities len <= 5",
              len(b.get("top_cities") or []) <= 5)
        check("1b.9 limit=5 top_specialties len <= 5",
              len(b.get("top_specialties") or []) <= 5)


def test_directory_facets_auth(token: str | None):
    print("\n== Section 1c: GET /api/directory/facets (authenticated as admin) ==")
    if not token:
        check("1c.1 admin token available", False, "SKIPPED — no admin token")
        return
    r = requests.get(
        f"{BASE}/directory/facets?limit=12",
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    check("1c.1 status=200 (admin auth)", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        b = r.json()
        check("1c.2 has top_cities + top_specialties",
              "top_cities" in b and "top_specialties" in b)


def test_directory_facets_excludes_ghosts():
    print("\n== Section 1d: excluded-user filter (ghost accounts excluded) ==")
    rf = requests.get(f"{BASE}/directory/facets?limit=30", timeout=20)
    if rf.status_code != 200:
        check("1d.1 facets 200", False, f"facets={rf.status_code}")
        return
    fb = rf.json()
    suspicious_tokens = {"test", "deleted", "bot", "official"}
    has_suspicious_city = any(
        any(tok in (c.get("city") or "").lower() for tok in suspicious_tokens)
        for c in (fb.get("top_cities") or [])
    )
    check("1d.1 no suspicious tokens in top_cities",
          not has_suspicious_city,
          f"cities={[c.get('city') for c in (fb.get('top_cities') or [])[:10]]}")
    has_suspicious_spec = any(
        any(tok in (c.get("specialty") or "").lower() for tok in suspicious_tokens)
        for c in (fb.get("top_specialties") or [])
    )
    check("1d.2 no suspicious tokens in top_specialties",
          not has_suspicious_spec)

    print(f"    Sample top_cities: {[(c.get('city'), c.get('count')) for c in (fb.get('top_cities') or [])[:5]]}")
    print(f"    Sample top_specialties: {[(c.get('specialty'), c.get('count')) for c in (fb.get('top_specialties') or [])[:5]]}")


def test_spots_hard_cap():
    print("\n== Section 2: GET /api/spots hard-cap on limit ==")
    r = requests.get(f"{BASE}/spots?limit=9999", timeout=60)
    check("2a.1 limit=9999 returns 200", r.status_code == 200,
          f"status={r.status_code}")
    if r.status_code == 200:
        body = r.json()
        check("2a.2 response is a list", isinstance(body, list),
              f"type={type(body).__name__}")
        if isinstance(body, list):
            check("2a.3 length <= 200 (server-side hard cap)",
                  len(body) <= 200, f"len={len(body)}")
            print(f"    actual length: {len(body)}")

    r = requests.get(f"{BASE}/spots?limit=50", timeout=30)
    check("2b.1 limit=50 returns 200", r.status_code == 200)
    if r.status_code == 200 and isinstance(r.json(), list):
        body = r.json()
        check("2b.2 limit=50 returns <=50", len(body) <= 50,
              f"len={len(body)}")

    r = requests.get(f"{BASE}/spots?limit=0", timeout=30)
    check("2c.1 limit=0 returns 200 (clamped to 1)", r.status_code == 200,
          f"status={r.status_code}")
    if r.status_code == 200 and isinstance(r.json(), list):
        body = r.json()
        check("2c.2 limit=0 returns <=1 (clamped to min 1)",
              len(body) <= 1, f"len={len(body)}")

    r = requests.get(f"{BASE}/spots?limit=20&verified_recently=true", timeout=30)
    check("2d.1 verified_recently filter returns 200",
          r.status_code == 200, f"status={r.status_code}")

    for sort in ("recent", "trending", "quality", "golden_hour", "score"):
        r = requests.get(f"{BASE}/spots?limit=5&sort={sort}", timeout=30)
        check(f"2e.sort={sort} returns 200",
              r.status_code == 200, f"status={r.status_code}")

    r = requests.get(
        f"{BASE}/spots?limit=10&lat=30.2672&lng=-97.7431",
        timeout=30,
    )
    check("2f.1 lat/lng request returns 200",
          r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200 and isinstance(r.json(), list):
        body = r.json()
        if body:
            has_ds = all("distance_source" in s for s in body)
            check("2f.2 all items carry distance_source", has_ds)
            dg = [s for s in body if s.get("distance_source") == "device_gps"]
            check("2f.3 at least one item has distance_source='device_gps'",
                  len(dg) > 0, f"device_gps count={len(dg)}/{len(body)}")
            if dg:
                s = dg[0]
                check("2f.4 distance_km is numeric when device_gps",
                      isinstance(s.get("distance_km"), (int, float)),
                      f"distance_km={s.get('distance_km')}")

    r = requests.get(f"{BASE}/spots?limit=5", timeout=30)
    if r.status_code == 200 and isinstance(r.json(), list):
        body = r.json()
        if body:
            all_unavail = all(
                s.get("distance_source") == "unavailable"
                and s.get("distance_km") is None
                for s in body
            )
            check("2g.1 without lat/lng, distance_source='unavailable' + distance_km=None",
                  all_unavail,
                  f"sample={body[0].get('distance_source')}/{body[0].get('distance_km')}")

    r = requests.get(f"{BASE}/spots?limit=5&min_rating=4", timeout=30)
    check("2h.1 min_rating=4 returns 200", r.status_code == 200)


def test_errors_endpoint():
    print("\n== Section 3: POST /api/errors ==")
    payload = {
        "surface": "explore",
        "message": "Test crash from backend_test.py",
        "stack": "at line 1\nat line 2",
        "component_stack": "<ExploreScreen>",
        "context": {"spotsCount": 42, "activeFilterKeys": ["shoot_type"]},
        "route": "/explore",
        "platform": "web",
    }
    r = requests.post(f"{BASE}/errors", json=payload, timeout=20)
    check("3a.1 POST /errors unauthenticated returns 200",
          r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        check("3a.2 response body has ok=true",
              body.get("ok") is True, f"body={body}")

    r = requests.post(f"{BASE}/errors", json={"message": "Minimal test"}, timeout=20)
    check("3b.1 minimal payload returns 200", r.status_code == 200,
          f"status={r.status_code}")
    if r.status_code == 200:
        check("3b.2 response ok=true", r.json().get("ok") is True)

    if ADMIN_TOKEN:
        r = requests.post(
            f"{BASE}/errors",
            json={"surface": "spot_detail", "message": "auth test",
                  "context": {"a": 1}},
            headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},
            timeout=20,
        )
        check("3c.1 authenticated POST /errors returns 200",
              r.status_code == 200, f"status={r.status_code}")

    r = requests.post(
        f"{BASE}/errors",
        json={"context": {"foo": "bar"}, "message": "shape probe",
              "stack": "x\ny"},
        timeout=20,
    )
    check("3d.1 {context,message,stack} payload returns 200",
          r.status_code == 200,
          f"status={r.status_code} body={r.text[:200]}")


def test_regression_smoke(token: str | None):
    print("\n== Section 4: regression smoke (auth/me, /spots, /directory) ==")
    if token:
        r = requests.get(f"{BASE}/auth/me",
                         headers={"Authorization": f"Bearer {token}"},
                         timeout=15)
        check("4a.1 /auth/me returns 200", r.status_code == 200,
              f"status={r.status_code}")
        if r.status_code == 200:
            b = r.json()
            check("4a.2 /auth/me body has user_id + plan",
                  "user_id" in b and "plan" in b)

    r = requests.get(f"{BASE}/spots?limit=10", timeout=30)
    check("4b.1 /spots?limit=10 returns 200", r.status_code == 200,
          f"status={r.status_code}")

    r = requests.get(f"{BASE}/directory?limit=5", timeout=30)
    check("4c.1 /directory?limit=5 returns 200", r.status_code == 200,
          f"status={r.status_code}")
    if r.status_code == 200:
        b = r.json()
        items = b.get("items") if isinstance(b, dict) else b
        check("4c.2 /directory items is a list",
              isinstance(items, list), f"type={type(items).__name__}")


if __name__ == "__main__":
    print(f"Target: {BASE}")
    ADMIN_TOKEN = login_admin()
    test_directory_facets_unauth()
    test_directory_facets_limit_clamp()
    test_directory_facets_auth(ADMIN_TOKEN)
    test_directory_facets_excludes_ghosts()
    test_spots_hard_cap()
    test_errors_endpoint()
    test_regression_smoke(ADMIN_TOKEN)

    passed = sum(1 for _, ok, _ in results if ok)
    failed = [(lbl, det) for lbl, ok, det in results if not ok]
    print("\n" + "=" * 70)
    print(f"TOTAL: {passed}/{len(results)} passed")
    if failed:
        print("\nFAILED:")
        for lbl, det in failed:
            print(f"  - {lbl}: {det}")
    sys.exit(0 if not failed else 1)
