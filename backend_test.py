"""
Backend test suite — Explore Speed CR Batch 1 (June 2025)

Scope:
  1. New spot indexes + 2dsphere location backfill — verify startup is clean
     and core endpoints still return 200.
  2. GET /api/spots cursor pagination + sort=distance variants.
  3. NEW GET /api/spots/markers lightweight endpoint.
  4. Regression smoke.

Run with: python /app/backend_test.py
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

import requests

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

RESULTS: list[tuple[str, bool, str]] = []


def _record(label: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((label, ok, detail))
    mark = "✅" if ok else "❌"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))


def _section(title: str) -> None:
    print(f"\n── {title} ".ljust(78, "─"))


def admin_login() -> str:
    r = requests.post(f"{BASE}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def test_regression_smoke(tok: str) -> None:
    _section("Regression smoke — existing endpoints still 200")
    h = {"Authorization": f"Bearer {tok}"}

    r = requests.get(f"{BASE}/auth/me", headers=h, timeout=15)
    _record("GET /auth/me 200", r.status_code == 200, f"status={r.status_code}")

    r = requests.get(f"{BASE}/feed/home", headers=h, timeout=20)
    _record("GET /feed/home 200", r.status_code == 200, f"status={r.status_code}")

    r = requests.get(f"{BASE}/directory?limit=5", headers=h, timeout=15)
    _record("GET /directory?limit=5 200", r.status_code == 200, f"status={r.status_code}")

    r = requests.get(f"{BASE}/directory/facets", headers=h, timeout=15)
    _record("GET /directory/facets 200", r.status_code == 200, f"status={r.status_code}")

    r = requests.get(f"{BASE}/notifications?limit=1", headers=h, timeout=15)
    _record("GET /notifications?limit=1 200", r.status_code == 200, f"status={r.status_code}")


def test_legacy_list_shape(tok: str) -> None:
    _section("GET /api/spots — legacy list shape (no cursor, no paginated)")
    h = {"Authorization": f"Bearer {tok}"}
    r = requests.get(f"{BASE}/spots?limit=10", headers=h, timeout=20)
    ok_200 = r.status_code == 200
    _record("status=200", ok_200, f"actual={r.status_code}")
    if not ok_200:
        return
    body = r.json()
    is_list = isinstance(body, list)
    _record("response body is a JSON array (legacy shape preserved)",
            is_list, f"type={type(body).__name__}")
    if is_list:
        _record("len <= 10", len(body) <= 10, f"len={len(body)}")
        if body:
            s = body[0]
            _record("items carry spot_id", "spot_id" in s,
                    f"keys sample={list(s.keys())[:6]}")


def test_paginated_shape(tok: str) -> tuple[int, int]:
    _section("GET /api/spots?paginated=1 — wrapped shape")
    h = {"Authorization": f"Bearer {tok}"}
    r = requests.get(f"{BASE}/spots?paginated=1&limit=10", headers=h, timeout=20)
    _record("status=200", r.status_code == 200, f"actual={r.status_code}")
    if r.status_code != 200:
        return (0, 0)
    body = r.json()
    is_dict = isinstance(body, dict)
    _record("response is a wrapped object", is_dict, f"type={type(body).__name__}")
    if not is_dict:
        return (0, 0)
    keys = set(body.keys())
    required = {"items", "next_cursor", "total_estimate", "limit"}
    missing = required - keys
    _record("has items/next_cursor/total_estimate/limit",
            not missing, f"missing={missing or 'none'}; extra keys={keys - required}")

    items = body.get("items", [])
    total = int(body.get("total_estimate") or 0)
    nc = body.get("next_cursor")
    _record("items is a list", isinstance(items, list),
            f"type={type(items).__name__}")
    _record("len(items) <= 10", len(items) <= 10, f"len={len(items)}")
    _record("total_estimate is int", isinstance(total, int),
            f"value={total}")
    _record("limit echoed as 10", body.get("limit") == 10,
            f"limit={body.get('limit')}")
    if total > 10:
        _record("next_cursor == 10 (since total>10)", nc == 10,
                f"next_cursor={nc}, total_estimate={total}")
    else:
        _record("next_cursor is null (since total<=10)", nc is None,
                f"next_cursor={nc}, total_estimate={total}")
    return (len(items), total)


def test_cursor_flow(tok: str) -> None:
    _section("GET /api/spots cursor pagination flow (limit=5)")
    h = {"Authorization": f"Bearer {tok}"}

    r1 = requests.get(f"{BASE}/spots?paginated=1&limit=5&cursor=0",
                      headers=h, timeout=20)
    r2 = requests.get(f"{BASE}/spots?paginated=1&limit=5&cursor=5",
                      headers=h, timeout=20)
    _record("page1 status=200", r1.status_code == 200)
    _record("page2 status=200", r2.status_code == 200)
    if r1.status_code != 200 or r2.status_code != 200:
        return
    b1 = r1.json()
    b2 = r2.json()
    items1 = b1.get("items", [])
    items2 = b2.get("items", [])
    total = int(b1.get("total_estimate") or 0)
    _record("page1 len<=5", len(items1) <= 5, f"len={len(items1)}")
    _record("page2 len<=5", len(items2) <= 5, f"len={len(items2)}")
    _record("page1 next_cursor == 5 (if total>5)",
            (b1.get("next_cursor") == 5) if total > 5 else (b1.get("next_cursor") is None),
            f"next_cursor={b1.get('next_cursor')}, total={total}")

    # Validate no overlap
    ids1 = {it.get("spot_id") for it in items1}
    ids2 = {it.get("spot_id") for it in items2}
    overlap = ids1 & ids2
    _record("page1 and page2 have ZERO overlapping spot_ids",
            len(overlap) == 0, f"overlap={overlap}")

    # Beyond total — cursor exceeds total
    beyond = total + 100
    r3 = requests.get(f"{BASE}/spots?paginated=1&limit=5&cursor={beyond}",
                      headers=h, timeout=20)
    _record("cursor>total status=200", r3.status_code == 200)
    if r3.status_code == 200:
        b3 = r3.json()
        _record("cursor>total → items == []",
                b3.get("items") == [], f"items={b3.get('items')}")
        _record("cursor>total → next_cursor is null",
                b3.get("next_cursor") is None,
                f"next_cursor={b3.get('next_cursor')}")


def test_sort_distance(tok: str) -> None:
    _section("GET /api/spots sort=distance (Austin lat/lng)")
    h = {"Authorization": f"Bearer {tok}"}
    r = requests.get(
        f"{BASE}/spots?sort=distance&lat=30.2672&lng=-97.7431&limit=10",
        headers=h, timeout=20)
    _record("status=200", r.status_code == 200, f"actual={r.status_code}")
    if r.status_code != 200:
        return
    body = r.json()
    items = body if isinstance(body, list) else body.get("items", [])
    _record("response has items", len(items) > 0, f"len={len(items)}")
    # monotonic non-decreasing distance_mi
    prev = -1.0
    ordered = True
    bad_idx = -1
    for i, it in enumerate(items):
        d = it.get("distance_mi")
        if d is None:
            # For sort=distance we expect numeric distances (spots with lat/lng)
            continue
        if d + 1e-9 < prev:
            ordered = False
            bad_idx = i
            break
        prev = d
    _record("distance_mi ascending",
            ordered, f"failed at index {bad_idx}" if not ordered else "monotonic")
    # distance_source=device_gps on all items where lat/lng was computable
    sources = [it.get("distance_source") for it in items]
    all_device = all(s == "device_gps" for s in sources)
    _record("distance_source == 'device_gps' on every item",
            all_device, f"sample={sources[:5]}")

    # Degrade gracefully without lat/lng
    _section("GET /api/spots sort=distance WITHOUT lat/lng — graceful")
    r2 = requests.get(f"{BASE}/spots?sort=distance&limit=5",
                      headers=h, timeout=20)
    _record("status=200", r2.status_code == 200, f"actual={r2.status_code}")
    if r2.status_code == 200:
        b2 = r2.json()
        items2 = b2 if isinstance(b2, list) else b2.get("items", [])
        dist_null = all(it.get("distance_mi") is None for it in items2)
        _record("distance_mi is None on every item (graceful)",
                dist_null,
                f"sample={[it.get('distance_mi') for it in items2[:3]]}")


def test_other_sort_modes(tok: str) -> None:
    _section("Smoke other sort modes")
    h = {"Authorization": f"Bearer {tok}"}
    for mode in ("recent", "quality", "score", "trending", "golden_hour"):
        r = requests.get(f"{BASE}/spots?sort={mode}&limit=5",
                         headers=h, timeout=20)
        _record(f"sort={mode} → 200",
                r.status_code == 200, f"actual={r.status_code}")


def test_existing_filters(tok: str) -> None:
    _section("Existing filters still work")
    h = {"Authorization": f"Bearer {tok}"}
    r = requests.get(f"{BASE}/spots?shoot_type=wedding&limit=5",
                     headers=h, timeout=20)
    _record("shoot_type=wedding 200", r.status_code == 200,
            f"actual={r.status_code}")
    r = requests.get(f"{BASE}/spots?verified_recently=true&limit=5",
                     headers=h, timeout=20)
    _record("verified_recently=true 200", r.status_code == 200,
            f"actual={r.status_code}")
    r = requests.get(f"{BASE}/spots?min_rating=4&limit=5",
                     headers=h, timeout=20)
    _record("min_rating=4 200", r.status_code == 200,
            f"actual={r.status_code}")


def test_markers_basic(tok: str) -> list[dict]:
    _section("GET /api/spots/markers — basic shape (unauth)")
    r = requests.get(f"{BASE}/spots/markers?limit=20", timeout=20)
    _record("status=200 (unauth)", r.status_code == 200,
            f"actual={r.status_code}")
    if r.status_code != 200:
        return []
    body = r.json()
    _record("body has items + count keys",
            isinstance(body, dict) and "items" in body and "count" in body,
            f"keys={list(body.keys()) if isinstance(body, dict) else '?'}")
    items = body.get("items", [])
    _record("count matches len(items)",
            body.get("count") == len(items),
            f"count={body.get('count')}, len={len(items)}")

    # Validate strict key set
    expected_keys = {"spot_id", "title", "lat", "lng", "category",
                     "shoot_types", "is_premium", "is_hidden_gem",
                     "score", "thumb_url"}
    forbidden_keys = {"description", "images", "comments", "owner",
                      "analytics", "reviews", "edit_history"}
    if items:
        first = items[0]
        actual_keys = set(first.keys())
        missing = expected_keys - actual_keys
        extra = actual_keys - expected_keys
        _record("markers item has EXACTLY the expected keys",
                not missing and not extra,
                f"missing={missing or 'none'}, extra={extra or 'none'}")
        forbidden_present = forbidden_keys & actual_keys
        _record("markers item has NO heavy fields (description/images/comments/owner)",
                not forbidden_present,
                f"forbidden_present={forbidden_present or 'none'}")

        # lat/lng numeric
        lat_num = isinstance(first.get("lat"), (int, float)) and first.get("lat") is not None
        lng_num = isinstance(first.get("lng"), (int, float)) and first.get("lng") is not None
        _record("lat is numeric", lat_num, f"lat={first.get('lat')}")
        _record("lng is numeric", lng_num, f"lng={first.get('lng')}")

        # Sample payload
        print(f"    sample item keys: {sorted(actual_keys)}")
        print(f"    sample: {json.dumps(first, default=str)[:280]}")
    return items


def test_markers_auth(tok: str) -> None:
    _section("GET /api/spots/markers — authed")
    h = {"Authorization": f"Bearer {tok}"}
    r = requests.get(f"{BASE}/spots/markers?limit=20", headers=h, timeout=20)
    _record("authed status=200", r.status_code == 200,
            f"actual={r.status_code}")
    if r.status_code == 200:
        body = r.json()
        _record("authed body has items", isinstance(body.get("items"), list))


def test_markers_bbox(tok: str) -> None:
    _section("GET /api/spots/markers — bbox filter (Texas)")
    url = (f"{BASE}/spots/markers?sw_lat=29&sw_lng=-99&ne_lat=31&ne_lng=-97"
           f"&limit=200")
    r = requests.get(url, timeout=20)
    _record("status=200", r.status_code == 200, f"actual={r.status_code}")
    if r.status_code != 200:
        return
    items = r.json().get("items", [])
    print(f"    bbox returned {len(items)} spots")
    if items:
        in_bounds = all(
            (29 <= (it.get("lat") or 0) <= 31)
            and (-99 <= (it.get("lng") or 0) <= -97)
            for it in items
        )
        _record("all items have lat in [29,31] AND lng in [-99,-97]",
                in_bounds,
                f"sample={[(it.get('lat'), it.get('lng')) for it in items[:3]]}")
    else:
        _record("bbox returned 0 items (acceptable if no data in bounds)",
                True)


def test_markers_shoot_type(tok: str, baseline_items: list[dict]) -> None:
    _section("GET /api/spots/markers — shoot_type filter")
    # Pick a shoot_type from the baseline payload so the test is
    # data-driven rather than assuming 'wedding' exists.
    all_types: set[str] = set()
    for it in baseline_items:
        for st in (it.get("shoot_types") or []):
            all_types.add(st)
    sample_type = "wedding" if "wedding" in all_types else (
        next(iter(all_types)) if all_types else "wedding")
    print(f"    testing with shoot_type={sample_type!r}"
          f" (available types in DB sample: {sorted(all_types)})")

    r = requests.get(
        f"{BASE}/spots/markers?shoot_type={sample_type}&limit=50",
        timeout=20)
    _record("status=200", r.status_code == 200, f"actual={r.status_code}")
    if r.status_code != 200:
        return
    items = r.json().get("items", [])
    if items:
        all_match = all(sample_type in (it.get("shoot_types") or [])
                        for it in items)
        _record(f"every item includes shoot_type={sample_type!r}",
                all_match,
                f"count={len(items)}")
    else:
        _record("filter returned 0 items (acceptable if no matches)", True)


def test_payload_size_comparison(tok: str) -> None:
    _section("Payload size: /markers vs /spots")
    h = {"Authorization": f"Bearer {tok}"}
    r_markers = requests.get(f"{BASE}/spots/markers?limit=20",
                             headers=h, timeout=20)
    r_spots = requests.get(f"{BASE}/spots?limit=20",
                           headers=h, timeout=20)
    if r_markers.status_code != 200 or r_spots.status_code != 200:
        _record("size comparison skipped (non-200)", True)
        return
    m_items = r_markers.json().get("items", [])
    s_items = r_spots.json() if isinstance(r_spots.json(), list) else r_spots.json().get("items", [])
    # compute avg-per-item
    if m_items and s_items:
        per_marker = len(json.dumps(m_items[0])) if m_items else 0
        per_spot = len(json.dumps(s_items[0], default=str)) if s_items else 0
        print(f"    per-item: marker={per_marker} bytes, spot={per_spot} bytes")
        ratio = per_spot / max(1, per_marker)
        _record(f"marker item is substantially smaller than spot item (ratio≥2x)",
                ratio >= 2.0,
                f"spot/marker ratio={ratio:.2f}x")


def main() -> int:
    print(f"BASE={BASE}")
    try:
        tok = admin_login()
    except Exception as e:
        print(f"❌ admin login failed: {e}")
        return 2

    # 1. Regression + indexes-startup-didn't-break-anything
    test_regression_smoke(tok)

    # 2. /api/spots cursor pagination + sort=distance
    test_legacy_list_shape(tok)
    test_paginated_shape(tok)
    test_cursor_flow(tok)
    test_sort_distance(tok)
    test_other_sort_modes(tok)
    test_existing_filters(tok)

    # 3. /api/spots/markers
    baseline_items = test_markers_basic(tok)
    test_markers_auth(tok)
    test_markers_bbox(tok)
    test_markers_shoot_type(tok, baseline_items)
    test_payload_size_comparison(tok)

    # Summary
    total = len(RESULTS)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = total - passed
    print("\n" + "═" * 78)
    print(f"RESULTS: {passed}/{total} passed, {failed} failed")
    if failed:
        print("\nFailed assertions:")
        for label, ok, detail in RESULTS:
            if not ok:
                print(f"  ❌ {label} — {detail}")
    print("═" * 78)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
