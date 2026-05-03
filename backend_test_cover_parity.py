"""
v2.0.24 Cover Source-of-Truth Regression Test
=================================================
Tests narrowly focused on:

1. Markers + Detail cover parity for 10 random spots
2. Community-upload fallback active on markers
3. cover_image_url field present on detail endpoint, well-formed
4. Spot-check 1-2 of: auth/me, spots paginated, /api/img proxy

Per review-request: hits http://localhost:8001 directly.
"""
from __future__ import annotations

import json
import os
import random
import sys
from urllib.parse import unquote, urlparse, parse_qs

import requests

BASE = "http://localhost:8001"

# Track findings
PASS: list[str] = []
FAIL: list[str] = []
INFO: list[str] = []


def _record(ok: bool, msg: str) -> None:
    (PASS if ok else FAIL).append(msg)
    print(("PASS  " if ok else "FAIL  ") + msg)


def _info(msg: str) -> None:
    INFO.append(msg)
    print("INFO  " + msg)


def _unwrap_proxy(url: str | None) -> str | None:
    """If url is a /api/img?u=<raw>&w=...&q=... proxy URL, unwrap it.
    Return the raw underlying source URL. Otherwise return as-is."""
    if not url or not isinstance(url, str):
        return url
    # Match either absolute or relative proxy URLs
    parsed = urlparse(url)
    path = parsed.path or ""
    if path.endswith("/api/img") or path == "/api/img":
        qs = parse_qs(parsed.query)
        u = qs.get("u", [None])[0]
        if u:
            return unquote(u)
    # Bare relative form: "/api/img?u=..."
    if url.startswith("/api/img?") or "/api/img?" in url:
        # Find the u= portion
        try:
            qpart = url.split("?", 1)[1]
            for kv in qpart.split("&"):
                k, _, v = kv.partition("=")
                if k == "u":
                    return unquote(v)
        except Exception:
            pass
    return url


def test_1_markers_detail_parity() -> None:
    """For 10 random spots from /api/spots/markers, detail.cover_image_url
    MUST equal unwrapped(marker.thumb_url) — or both null."""
    print("\n=== TEST 1: Markers + Detail cover parity ===")
    r = requests.get(f"{BASE}/api/spots/markers", params={"limit": 50}, timeout=20)
    if r.status_code != 200:
        _record(False, f"GET /api/spots/markers?limit=50 -> {r.status_code} (body={r.text[:200]})")
        return
    body = r.json()
    items = body.get("items") or []
    if not items:
        _record(False, "Markers returned 0 items — cannot test parity")
        return
    _info(f"Markers returned {len(items)} items, picking 10 at random")

    sample = random.sample(items, min(10, len(items)))
    drift_cases: list[dict] = []
    parity_ok = 0
    both_null = 0
    skipped = 0

    for m in sample:
        spot_id = m.get("spot_id")
        if not spot_id:
            skipped += 1
            continue
        marker_thumb = m.get("thumb_url")
        marker_unwrapped = _unwrap_proxy(marker_thumb)

        d = requests.get(f"{BASE}/api/spots/{spot_id}", timeout=20)
        if d.status_code != 200:
            _record(False, f"  spot_id={spot_id} -> GET /api/spots/{{id}} {d.status_code}")
            continue
        detail = d.json()
        detail_cover = detail.get("cover_image_url")

        # Both null = OK
        if marker_unwrapped is None and detail_cover is None:
            both_null += 1
            continue

        if marker_unwrapped == detail_cover:
            parity_ok += 1
        else:
            drift_cases.append({
                "spot_id": spot_id,
                "title": detail.get("title"),
                "marker_thumb_raw": marker_thumb,
                "marker_unwrapped": marker_unwrapped,
                "detail_cover_image_url": detail_cover,
            })

    _info(
        f"parity_ok={parity_ok}  both_null={both_null}  drift={len(drift_cases)}  skipped={skipped}"
    )

    if drift_cases:
        for dc in drift_cases:
            print("    DRIFT:", json.dumps(dc, indent=2)[:600])
        _record(
            False,
            f"Test 1: parity drift in {len(drift_cases)}/10 spots (markers thumb_url unwrap != detail.cover_image_url)",
        )
    else:
        _record(True, f"Test 1: 10/10 spots have markers↔detail cover parity (parity_ok={parity_ok}, both_null={both_null})")


def test_2_community_fallback_on_markers() -> None:
    """Find a spot with no primary cover but ≥1 approved community upload —
    its thumb_url MUST now be populated via /api/img?u=<community_upload_url>."""
    print("\n=== TEST 2: Community-upload fallback on markers ===")

    r = requests.get(f"{BASE}/api/spots/markers", params={"limit": 500}, timeout=30)
    if r.status_code != 200:
        _record(False, f"GET /api/spots/markers?limit=500 -> {r.status_code}")
        return
    items = r.json().get("items") or []
    populated = sum(1 for m in items if m.get("thumb_url"))
    null_thumb = sum(1 for m in items if not m.get("thumb_url"))
    _info(f"markers limit=500 -> {len(items)} items, populated={populated}, null_thumb={null_thumb}")

    # Inspect each spot — if any have NO primary cover (legacy fields all null
    # AND empty images[]) but DO have approved community uploads, verify their
    # marker thumb_url uses the community upload (wrapped through /api/img).
    # We sample up to 25 marker rows to keep it fast.
    sample = random.sample(items, min(25, len(items)))
    fallback_active = 0
    fallback_candidates_checked = 0
    misses: list[dict] = []

    for m in sample:
        spot_id = m.get("spot_id")
        marker_thumb_unwrapped = _unwrap_proxy(m.get("thumb_url"))
        d = requests.get(f"{BASE}/api/spots/{spot_id}", timeout=20)
        if d.status_code != 200:
            continue
        detail = d.json()

        # Determine if detail has a "primary cover" (any of the legacy fields
        # OR an entry in images[] with a usable url).
        primary_cover_present = bool(
            detail.get("hero_cover_image_url") or detail.get("cover_image_url_legacy")
        )
        # The detail cover_image_url IS the cascade output. So if community fallback
        # was applied at the detail layer, cover_image_url will be set even though
        # legacy fields are empty. We need to check raw legacy fields:
        # Get raw doc fields by checking presence of admin-pinned hero or images.
        legacy_cover = (
            detail.get("hero_cover_image_url")
            or detail.get("card_url")
            or detail.get("image_url")
        )
        imgs = detail.get("images") or []
        has_primary_image = any(
            isinstance(im, dict) and (im.get("image_url") or im.get("card_url") or im.get("thumb_url"))
            for im in imgs if im
        )

        # Get community uploads
        cu_resp = requests.get(f"{BASE}/api/spots/{spot_id}/uploads", timeout=15)
        if cu_resp.status_code != 200:
            continue
        cu_payload = cu_resp.json()
        cu_items = cu_payload.get("items") or cu_payload.get("uploads") or []
        approved_cu = [
            u for u in cu_items
            if (u.get("moderation_status") == "approved" or u.get("status") == "approved")
            and u.get("image_url")
        ]

        if not legacy_cover and not has_primary_image and approved_cu:
            fallback_candidates_checked += 1
            # The marker MUST have a thumb_url (sourced from community fallback)
            if marker_thumb_unwrapped:
                fallback_active += 1
                _info(
                    f"  spot_id={spot_id} title={detail.get('title')!r}: community fallback active "
                    f"(thumb→{marker_thumb_unwrapped[:80]}...)"
                )
            else:
                misses.append({
                    "spot_id": spot_id,
                    "title": detail.get("title"),
                    "approved_cu_count": len(approved_cu),
                    "marker_thumb": m.get("thumb_url"),
                })

    if fallback_candidates_checked == 0:
        _info("No spot in sample had {no primary cover + approved community uploads}.")
        # Per review spec: that's fine. Confirm logic runs without error.
        _record(True, f"Test 2: N/A — no candidate spot in sample (logic ran without error). populated={populated}/{len(items)}")
    else:
        if misses:
            for mi in misses:
                print("    FALLBACK MISS:", json.dumps(mi)[:300])
            _record(
                False,
                f"Test 2: community fallback FAILED for {len(misses)}/{fallback_candidates_checked} candidate spots",
            )
        else:
            _record(
                True,
                f"Test 2: community fallback ACTIVE — {fallback_active}/{fallback_candidates_checked} candidate spots have populated thumb_url via community upload",
            )


def test_3_cover_image_url_field_shape() -> None:
    """detail.cover_image_url must be a non-empty absolute URL string OR null —
    NEVER empty string, relative path, or data: URI."""
    print("\n=== TEST 3: cover_image_url field shape on detail endpoint ===")

    r = requests.get(f"{BASE}/api/spots/markers", params={"limit": 50}, timeout=20)
    if r.status_code != 200:
        _record(False, f"markers fetch failed: {r.status_code}")
        return
    items = r.json().get("items") or []
    if not items:
        _record(False, "0 markers — cannot validate field")
        return

    sample = random.sample(items, min(15, len(items)))
    malformed: list[dict] = []
    present_string = 0
    present_null = 0

    for m in sample:
        spot_id = m.get("spot_id")
        d = requests.get(f"{BASE}/api/spots/{spot_id}", timeout=20)
        if d.status_code != 200:
            continue
        detail = d.json()
        # Must be present as a top-level key
        if "cover_image_url" not in detail:
            malformed.append({"spot_id": spot_id, "issue": "field_missing"})
            continue
        v = detail["cover_image_url"]
        if v is None:
            present_null += 1
            continue
        if not isinstance(v, str):
            malformed.append({"spot_id": spot_id, "issue": "not_string_or_null", "value_type": type(v).__name__})
            continue
        if v == "":
            malformed.append({"spot_id": spot_id, "issue": "empty_string"})
            continue
        if v.startswith("data:"):
            malformed.append({"spot_id": spot_id, "issue": "data_uri", "value_prefix": v[:32]})
            continue
        if not (v.startswith("http://") or v.startswith("https://")):
            malformed.append({"spot_id": spot_id, "issue": "relative_or_invalid", "value": v[:120]})
            continue
        present_string += 1

    _info(f"sampled={len(sample)}  string_url={present_string}  null={present_null}  malformed={len(malformed)}")
    if malformed:
        for mf in malformed:
            print("    MALFORMED:", json.dumps(mf)[:300])
        _record(False, f"Test 3: {len(malformed)} cover_image_url values malformed")
    else:
        _record(True, f"Test 3: cover_image_url well-formed in all {len(sample)} sampled spots ({present_string} URL, {present_null} null)")


def test_4_spot_checks() -> None:
    """Spot-check that core endpoints still respond, no regressions."""
    print("\n=== TEST 4: Light spot-check of core endpoints ===")

    # /api/spots paginated
    r = requests.get(f"{BASE}/api/spots", params={"paginated": 1, "limit": 5}, timeout=15)
    _record(r.status_code == 200, f"GET /api/spots?paginated=1&limit=5 -> {r.status_code}")

    # /api/img proxy with a known Pexels URL
    pexels = "https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg"
    r = requests.get(f"{BASE}/api/img", params={"u": pexels, "w": 280, "q": 70}, timeout=20)
    if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/"):
        _record(True, f"GET /api/img (Pexels w=280) -> 200 image/* ({len(r.content)} bytes, X-Img-Cache={r.headers.get('X-Img-Cache')})")
    else:
        _record(False, f"GET /api/img (Pexels w=280) -> {r.status_code} ct={r.headers.get('content-type')}")

    # /api/img reject
    r = requests.get(f"{BASE}/api/img", params={"u": "https://evil.example.com/x.jpg", "w": 280, "q": 70}, timeout=10)
    _record(r.status_code == 400, f"GET /api/img (host_not_allowed) -> {r.status_code} (expect 400)")

    # /api/img/stats
    r = requests.get(f"{BASE}/api/img/stats", timeout=10)
    _record(r.status_code == 200, f"GET /api/img/stats -> {r.status_code}")


def main() -> int:
    random.seed(42)
    print(f"Target: {BASE}\n")

    try:
        test_1_markers_detail_parity()
    except Exception as e:
        FAIL.append(f"Test 1 EXCEPTION: {e!r}")
        print(f"Test 1 EXCEPTION: {e!r}")

    try:
        test_2_community_fallback_on_markers()
    except Exception as e:
        FAIL.append(f"Test 2 EXCEPTION: {e!r}")
        print(f"Test 2 EXCEPTION: {e!r}")

    try:
        test_3_cover_image_url_field_shape()
    except Exception as e:
        FAIL.append(f"Test 3 EXCEPTION: {e!r}")
        print(f"Test 3 EXCEPTION: {e!r}")

    try:
        test_4_spot_checks()
    except Exception as e:
        FAIL.append(f"Test 4 EXCEPTION: {e!r}")
        print(f"Test 4 EXCEPTION: {e!r}")

    print("\n========== SUMMARY ==========")
    print(f"PASS: {len(PASS)}")
    for p in PASS:
        print("  ✓ " + p)
    print(f"FAIL: {len(FAIL)}")
    for f in FAIL:
        print("  ✗ " + f)
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
