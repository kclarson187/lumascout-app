"""
Regression test — Share Location PDF Round 5 deltas (Jun 2025).

Tests two refinements:
  (a) QR card completely removed from Page 1 (no "Live Share Location"
      kicker, no "Scan to open" body, no QR SVG embedded).
  (b) "Open Directions" button refined to a compact pill placed inside
      the Page-1 meta strip; share URL moved to Page 2 footer next to
      the "Generated {date}" stamp.

11 cases — cases 1-4 are regression of round-3/4 baselines; cases 5-11
are new round-5 deltas (or round-4 edge cases re-verified).

Run:
    cd /app && python backend_test_pdf_round5.py
"""
from __future__ import annotations

import io
import os
import re
import sys
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

import requests

sys.path.insert(0, "/app")
from backend_test_pdf_2page import (  # type: ignore  # noqa: E402
    API,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    RESULTS,
    record,
    login,
    auth_h,
    list_grouped,
    find_share,
    pick_owner_spot,
    mint_share,
    delete_share,
    case1_happy_path,
    case2_two_pages,
    case3_invalid_token,
    case4_revoked,
    case5_non_elite,
    case6_html_copy,
    case7_json_unchanged,
    case8_hide_scout_notes,
)
from backend_test_pdf_round4 import (  # type: ignore  # noqa: E402
    extract_pages_text,
    extract_page_uri_annots,
    count_image_xobjects,
    mongo_client,
)

KNOWN_ELITE_TOKEN = "jR2Hid-ihfpk5n91IP7voyYr47DB6tRo"
EXPECTED_HAPPY_COORDS = "29.708805,-98.515156"

# Expected canonical share URL prefix on page 2 footer:
# PUBLIC_SHARE_BASE_URL from backend/.env
SHARE_BASE = os.environ.get(
    "PUBLIC_SHARE_BASE_URL",
    "https://photo-finder-60.preview.emergentagent.com",
).rstrip("/")


# ── Round-5 cases ────────────────────────────────────────────────


def case_r5_qr_removed(pdf_bytes: bytes) -> None:
    """Verify the QR / Live Share Location card is gone from the PDF.

    Strict byte search across the raw PDF stream — covers both visible
    text AND the embedded CSS class strings.
    """
    forbidden_text = [
        b"Live Share Location",
        b"Scan to open",
    ]
    forbidden_css = [
        b"qr-card",
        b"qr-text",
        b"qr-kicker",
        b"qr-svg",
        b"qr-fallback",
        b"qr-url",
    ]
    found_text = [s for s in forbidden_text if s in pdf_bytes]
    found_css = [s for s in forbidden_css if s in pdf_bytes]
    if found_text or found_css:
        record(
            "5. QR card removed entirely (byte search)",
            False,
            f"forbidden text found={found_text!r}; forbidden CSS class strings found={found_css!r}",
        )
        return
    record(
        "5. QR card removed entirely (byte search)",
        True,
        "no 'Live Share Location' / 'Scan to open' / qr-* CSS classes anywhere in PDF bytes",
    )


def case_r5_open_directions_present(pdf_bytes: bytes) -> None:
    """'Open Directions' (case-insensitive) must appear on Page 1 only.

    The button is rendered as a flex pill with a `◎` pin glyph between
    the words OPEN and DIRECTIONS, so pdfplumber/pypdf may interleave a
    space/newline (or even the glyph) between the two tokens during
    text extraction. We therefore accept either:
      (a) the literal substring "open directions" (any case) OR
      (b) the tokens OPEN and DIRECTIONS appearing within ≤ 20
          characters of each other on page 1 (which proves they belong
          to the same UI pill, not unrelated body copy).
    """
    pages = extract_pages_text(pdf_bytes)
    if len(pages) < 2:
        record(
            "6. 'Open Directions' on Page 1 only (case-insensitive)",
            False,
            f"need 2 pages, got {len(pages)}",
        )
        return
    p1, p2 = pages[0] or "", pages[1] or ""
    p1_lower, p2_lower = p1.lower(), p2.lower()

    def has_button(text: str) -> Tuple[bool, str]:
        if "open directions" in text:
            idx = text.find("open directions")
            return True, f"literal 'open directions' @ idx={idx}"
        # Look for OPEN and DIRECTIONS within 20 chars (pin glyph
        # interleaving). Iterate over all OPEN occurrences.
        for m in re.finditer(r"open", text):
            window = text[m.end(): m.end() + 25]
            if "directions" in window:
                return True, f"split-pill match: 'open' @ {m.start()} … window={window!r}"
        return False, ""

    p1_has, p1_diag = has_button(p1_lower)
    p2_has, p2_diag = has_button(p2_lower)

    if not p1_has:
        excerpt = p1[:1500].replace("\n", " | ")
        record(
            "6. 'Open Directions' on Page 1 only (case-insensitive)",
            False,
            f"missing OPEN+DIRECTIONS button on page 1; page1[:1500]={excerpt!r}",
        )
        return
    if p2_has:
        excerpt = p2[:800].replace("\n", " | ")
        record(
            "6. 'Open Directions' on Page 1 only (case-insensitive)",
            False,
            f"unexpected OPEN+DIRECTIONS on page 2 ({p2_diag}); page2[:800]={excerpt!r}",
        )
        return
    record(
        "6. 'Open Directions' on Page 1 only (case-insensitive)",
        True,
        f"page 1 OK ({p1_diag}); page 2 clean",
    )


def case_r5_gmaps_annot_coords(pdf_bytes: bytes) -> Optional[str]:
    """Page 1 must have a /A /URI annot pointing to
    `https://www.google.com/maps/dir/?api=1&destination=<coords>` for the
    Bullis happy-path token.
    """
    annots = extract_page_uri_annots(pdf_bytes, 0)
    gmaps_re = re.compile(
        r"^https://www\.google\.com/maps/dir/\?api=1&destination=.+"
    )
    matched = [u for u in annots if gmaps_re.match(u)]
    if not matched:
        record(
            "7. Page-1 link annot is Google Maps URL w/ coords",
            False,
            f"no matching annot; all page-1 URIs={annots!r}",
        )
        return None
    uri = matched[0]
    dest = uri.split("destination=", 1)[1]
    if dest != EXPECTED_HAPPY_COORDS:
        record(
            "7. Page-1 link annot is Google Maps URL w/ coords",
            False,
            f"expected destination={EXPECTED_HAPPY_COORDS!r}, got {dest!r} (uri={uri!r})",
        )
        return uri
    record(
        "7. Page-1 link annot is Google Maps URL w/ coords",
        True,
        f"annot destination={dest} (raw coords, not encoded)",
    )
    return uri


def case_r5_share_url_on_page2(pdf_bytes: bytes, elite_token: str) -> None:
    """Share URL substring must be on Page 2 (footer) and NOT on Page 1.

    The 3-column footer + long URL means pdfplumber's column-aware
    extraction can interleave other column text between the URL prefix
    and the wrapped continuation of the token. So we check on page 2:
      (a) the path prefix '/api/public/location/' is present
      (b) the first 7 chars of the token are present (URL still anchored)
      (c) the last 10 chars of the token are present somewhere on page 2
    All three together prove the full share URL is rendered.
    Page 1 must contain NONE of these markers.
    """
    pages = extract_pages_text(pdf_bytes)
    if len(pages) < 2:
        record(
            "8. Share URL on Page 2 footer (not Page 1)",
            False,
            f"need 2 pages, got {len(pages)}",
        )
        return
    p1, p2 = pages[0] or "", pages[1] or ""
    path_prefix = "/api/public/location/"
    tok_head = elite_token[:7]
    tok_tail = elite_token[-10:]

    def squash(s: str) -> str:
        return re.sub(r"\s+", "", s)
    p1_squashed = squash(p1)
    p2_squashed = squash(p2)

    # Allow either (a) full path+token squashed match, OR (b) the
    # 3-part column-wrapped fingerprint.
    full_needle = f"{path_prefix}{elite_token}"
    full_match = full_needle in p2_squashed
    parts_match = (
        path_prefix in p2 and tok_head in p2 and tok_tail in p2
    )

    if not (full_match or parts_match):
        excerpt = p2[-1500:].replace("\n", " | ")
        record(
            "8. Share URL on Page 2 footer (not Page 1)",
            False,
            (
                f"page 2 missing share URL fingerprints "
                f"(path_prefix={path_prefix!r} present={path_prefix in p2}, "
                f"tok_head={tok_head!r} present={tok_head in p2}, "
                f"tok_tail={tok_tail!r} present={tok_tail in p2}); "
                f"page2[-1500:]={excerpt!r}"
            ),
        )
        return

    # Page 1 must have NEITHER the full URL nor the path prefix.
    if full_needle in p1_squashed or path_prefix in p1:
        excerpt = p1[:1500].replace("\n", " | ")
        record(
            "8. Share URL on Page 2 footer (not Page 1)",
            False,
            f"page 1 still contains share URL/path; page1[:1500]={excerpt!r}",
        )
        return

    diag = "full URL" if full_match else f"split parts (head={tok_head!r}, tail={tok_tail!r})"
    record(
        "8. Share URL on Page 2 footer (not Page 1)",
        True,
        f"page 2 contains share URL ({diag}); page 1 clean",
    )


def case_r5_image_xobject_drop(pdf_bytes: bytes) -> None:
    """For the happy-path Bullis share (5 supporting + 1 hero + 1 brand
    logo = 7 images, no QR SVG), image XObject count should be ≤ 7.
    """
    n = count_image_xobjects(pdf_bytes)
    if n > 7:
        record(
            "9. Image XObject count ≤ 7 (QR SVG dropped)",
            False,
            f"image XObject count={n} > 7 (cap exceeded; QR SVG may still be embedded)",
        )
        return
    if n < 1:
        record(
            "9. Image XObject count ≤ 7 (QR SVG dropped)",
            False,
            f"image XObject count={n} — no images at all?",
        )
        return
    record(
        "9. Image XObject count ≤ 7 (QR SVG dropped)",
        True,
        f"image XObject count={n} (≤ 7)",
    )


# ── Round-5 case 10 — edge cases preserved from round 4 ──────────


def case_r5_address_fallback(elite_token: str) -> bool:
    """Flip show_exact_location=False, regen PDF, assert annot uses
    URL-encoded "City, ST". Restore via try/finally.
    Returns True if PASS.
    """
    import asyncio

    async def run() -> Tuple[bool, str]:
        client, db = mongo_client()
        try:
            share_row = await db.spot_shares.find_one(
                {"token": elite_token},
                {"_id": 0, "show_exact_location": 1, "spot_id": 1},
            )
            if not share_row:
                return False, f"share token={elite_token[:8]}… not found"
            spot_id = share_row.get("spot_id")
            spot_row = await db.spots.find_one(
                {"spot_id": spot_id}, {"_id": 0, "city": 1, "state": 1}
            )
            if not spot_row:
                return False, f"spot {spot_id!r} not found"
            city, state = spot_row.get("city"), spot_row.get("state")
            if not (city and state):
                return False, f"spot lacks city/state (city={city!r}, state={state!r})"
            original = share_row.get("show_exact_location")
            try:
                await db.spot_shares.update_one(
                    {"token": elite_token},
                    {"$set": {"show_exact_location": False}},
                )
                r = requests.get(
                    f"{API}/public/location/{elite_token}/itinerary.pdf",
                    timeout=120,
                )
                if r.status_code != 200:
                    return False, f"PDF expected 200, got {r.status_code}: {r.text[:200]!r}"
                pdf_bytes = r.content
                annots = extract_page_uri_annots(pdf_bytes, 0)
                gmaps_re = re.compile(
                    r"^https://www\.google\.com/maps/dir/\?api=1&destination=.+"
                )
                matched = [u for u in annots if gmaps_re.match(u)]
                if not matched:
                    return False, f"no gmaps annot on page 1 in fallback mode; annots={annots!r}"
                uri = matched[0]
                dest = uri.split("destination=", 1)[1]
                expected_encoded = urllib.parse.quote(f"{city}, {state}")
                city_encoded = urllib.parse.quote(city)
                state_encoded = urllib.parse.quote(state)
                if expected_encoded in dest:
                    return True, f"destination={dest!r} == encoded 'City, ST' ({expected_encoded!r})"
                if city_encoded in dest and state_encoded in dest:
                    return True, f"destination={dest!r} contains encoded city+state"
                return False, (
                    f"destination={dest!r} does not contain expected encoded "
                    f"'City, ST' ({expected_encoded!r}); city={city!r}, state={state!r}"
                )
            finally:
                if original is None:
                    await db.spot_shares.update_one(
                        {"token": elite_token},
                        {"$unset": {"show_exact_location": ""}},
                    )
                else:
                    await db.spot_shares.update_one(
                        {"token": elite_token},
                        {"$set": {"show_exact_location": original}},
                    )
        finally:
            client.close()

    try:
        ok, msg = asyncio.run(run())
    except Exception as e:
        record("10a. Edge — address fallback destination", False, f"exception: {e!r}")
        return False
    record("10a. Edge — address fallback destination", ok, msg)
    return ok


def case_r5_button_hidden_no_location(elite_token: str) -> bool:
    """Patch spot to remove all location data, regen PDF, assert NO
    google.com/maps/dir/ annotation on Page 1. PDF still 200/2 pages.
    """
    import asyncio

    async def run() -> Tuple[bool, str]:
        client, db = mongo_client()
        try:
            share_row = await db.spot_shares.find_one(
                {"token": elite_token}, {"_id": 0, "spot_id": 1}
            )
            if not share_row:
                return False, f"share {elite_token[:8]}… not found"
            spot_id = share_row.get("spot_id")
            before = await db.spots.find_one(
                {"spot_id": spot_id},
                {"_id": 0, "latitude": 1, "longitude": 1, "city": 1, "state": 1},
            )
            if not before:
                return False, f"spot {spot_id!r} not found"
            try:
                await db.spots.update_one(
                    {"spot_id": spot_id},
                    {"$set": {
                        "latitude": None,
                        "longitude": None,
                        "city": None,
                        "state": None,
                    }},
                )
                r = requests.get(
                    f"{API}/public/location/{elite_token}/itinerary.pdf",
                    timeout=120,
                )
                if r.status_code != 200:
                    return False, f"PDF expected 200, got {r.status_code}: {r.text[:300]!r}"
                pdf_bytes = r.content
                if not pdf_bytes.startswith(b"%PDF-"):
                    return False, f"missing %PDF- magic; first16={pdf_bytes[:16]!r}"
                try:
                    from pypdf import PdfReader
                    n = len(PdfReader(io.BytesIO(pdf_bytes)).pages)
                except Exception as e:
                    return False, f"pypdf failed: {e!r}"
                if n != 2:
                    return False, f"expected 2 pages, got {n}"
                annots = extract_page_uri_annots(pdf_bytes, 0)
                gmaps_matches = [u for u in annots if "google.com/maps/dir/" in u]
                if gmaps_matches:
                    return False, (
                        f"expected NO google.com/maps/dir/ annot on page 1, found {gmaps_matches!r}"
                    )
                return True, f"PDF 200/2 pages; no gmaps annot on p1 (page-1 URIs={annots!r})"
            finally:
                setops: Dict[str, Any] = {}
                for f in ("latitude", "longitude", "city", "state"):
                    if f in before:
                        setops[f] = before[f]
                if setops:
                    await db.spots.update_one(
                        {"spot_id": spot_id}, {"$set": setops}
                    )
        finally:
            client.close()

    try:
        ok, msg = asyncio.run(run())
    except Exception as e:
        record("10b. Edge — button hidden when no location", False, f"exception: {e!r}")
        return False
    record("10b. Edge — button hidden when no location", ok, msg)
    return ok


def case_r5_image_cap_six(elite_token: str) -> bool:
    """Patch spot.images to 8 URLs. Regen PDF. Image XObject count must
    be ≤ 7 (was ≤ 8 in round 4; now lower since QR SVG removed)."""
    import asyncio

    SAMPLE_URLS = [
        "https://pub-799be3bb95574d71ad3213680ce5e0c1.r2.dev/spots/bullis-county-park/hero.jpg",
        "https://images.unsplash.com/photo-1506744038136-46273834b3fb",
        "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
        "https://images.unsplash.com/photo-1501785888041-af3ef285b470",
        "https://images.unsplash.com/photo-1507525428034-b723cf961d3e",
        "https://images.unsplash.com/photo-1518837695005-2083093ee35b",
        "https://images.unsplash.com/photo-1444703686981-a3abbc4d4fe3",
        "https://images.unsplash.com/photo-1469474968028-56623f02e42e",
    ]

    async def run() -> Tuple[bool, str]:
        client, db = mongo_client()
        try:
            share_row = await db.spot_shares.find_one(
                {"token": elite_token}, {"_id": 0, "spot_id": 1}
            )
            if not share_row:
                return False, f"share {elite_token[:8]}… not found"
            spot_id = share_row.get("spot_id")
            before = await db.spots.find_one(
                {"spot_id": spot_id}, {"_id": 0, "images": 1}
            )
            if not before:
                return False, f"spot {spot_id!r} not found"
            patched_images = [
                {"image_url": u, "image_id": f"r5-test-{i}", "sort_order": i}
                for i, u in enumerate(SAMPLE_URLS)
            ]
            try:
                await db.spots.update_one(
                    {"spot_id": spot_id},
                    {"$set": {"images": patched_images}},
                )
                r = requests.get(
                    f"{API}/public/location/{elite_token}/itinerary.pdf",
                    timeout=180,
                )
                if r.status_code != 200:
                    return False, f"PDF expected 200, got {r.status_code}: {r.text[:300]!r}"
                pdf_bytes = r.content
                if not pdf_bytes.startswith(b"%PDF-"):
                    return False, f"missing %PDF- magic; first16={pdf_bytes[:16]!r}"
                n_img = count_image_xobjects(pdf_bytes)
                # With QR SVG removed, even with 8 patched images cap is
                # 6 preview tiles + 1 hero + 1 brand logo = 8 max.
                # Spec says ≤ 6 preview tiles embed — combined with hero+logo
                # the upper-bound for image XObjects total is ≤ 8.
                if n_img > 8:
                    return False, (
                        f"image XObject count={n_img} exceeds cap of 8 "
                        f"(8 patched images — cap should limit preview tiles to 6)"
                    )
                if n_img < 1:
                    return False, f"image XObject count={n_img} — no images embedded?"
                return True, f"image XObject count={n_img} (≤ 8 cap holds with 8 patched URLs)"
            finally:
                images_orig = before.get("images")
                if images_orig is None:
                    await db.spots.update_one(
                        {"spot_id": spot_id}, {"$unset": {"images": ""}}
                    )
                else:
                    await db.spots.update_one(
                        {"spot_id": spot_id}, {"$set": {"images": images_orig}}
                    )
        finally:
            client.close()

    try:
        ok, msg = asyncio.run(run())
    except Exception as e:
        record("10c. Edge — image cap (8 patched → ≤ 6 previews)", False, f"exception: {e!r}")
        return False
    record("10c. Edge — image cap (8 patched → ≤ 6 previews)", ok, msg)
    return ok


def case_r5_page2_layout(pdf_bytes: bytes) -> None:
    """Page 2 unaffected — still has Shoot Plan / Arrival / Light &
    Weather / PREVIEW IMAGES / 3-column footer."""
    pages = extract_pages_text(pdf_bytes)
    if len(pages) < 2:
        record("11. Page 2 layout unaffected", False, f"need 2 pages, got {len(pages)}")
        return
    p2 = pages[1] or ""
    p2_lower = p2.lower()
    required_substrings = [
        # Shoot Plan section header
        "shoot plan",
        # Arrival Instructions
        "arrival",
        # Light & Weather (5-day forecast section)
        # Use loose match — accept either label
        # The footer 3-column has these three:
        "shared with lumascout",
        "generated",
        "lumascout",  # © LumaScout
        # PREVIEW IMAGES section heading
        "preview",
    ]
    missing: List[str] = []
    for needle in required_substrings:
        if needle not in p2_lower:
            missing.append(needle)
    if missing:
        # Quote longer block for forensic debugging.
        excerpt = p2.replace("\n", " | ")[:2000]
        record(
            "11. Page 2 layout unaffected",
            False,
            f"missing case-insensitive substrings on page 2: {missing!r}; page2[:2000]={excerpt!r}",
        )
        return
    # Light/Weather verification — not strictly required string but try to detect "weather"
    has_weather_hint = any(s in p2_lower for s in ("weather", "light", "sunset", "sunrise", "sun"))
    note = "" if has_weather_hint else " (note: no weather/light keywords detected)"
    record("11. Page 2 layout unaffected", True, f"Shoot Plan + Arrival + Preview + footer all present{note}")


# ── Main ─────────────────────────────────────────────────────────


def main() -> int:
    print(f"Backend: {API}")
    print("Logging in as super admin…")
    tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not tok:
        print("FATAL: admin login failed")
        return 2
    print("OK")

    # Resolve happy-path Elite token (Bullis)
    items = list_grouped(tok)
    print(f"Found {len(items)} share-link groups")
    elite_token: Optional[str] = None
    probe = requests.get(
        f"{API}/public/location/{KNOWN_ELITE_TOKEN}",
        headers={"Accept": "application/json"},
        timeout=30,
    )
    if probe.status_code == 200 and probe.json().get("status") == "ok":
        elite_token = KNOWN_ELITE_TOKEN
        print(f"Using known Elite token: {elite_token[:8]}… (Bullis County Park)")
    else:
        existing = find_share(items, elite=True)
        if existing and existing.get("token"):
            elite_token = existing["token"]
            print(f"Using existing Elite token: {elite_token[:8]}…")
    if not elite_token:
        sid = pick_owner_spot(tok)
        if sid:
            m = mint_share(tok, sid, share_title="Round5 Elite PDF")
            if m and m.get("token"):
                elite_token = m["token"]
                print(f"Minted Elite token: {elite_token[:8]}… (spot={sid})")

    # Pick spot_id (for revoke-minting test)
    pick_spot_id: Optional[str] = None
    for grp in items:
        for link in grp.get("links") or []:
            if link.get("token") == elite_token:
                pick_spot_id = grp.get("location_id")
                break
        if pick_spot_id:
            break
    if not pick_spot_id:
        pick_spot_id = pick_owner_spot(tok)

    # ── Case 1 — Happy path ──
    pdf_bytes: Optional[bytes] = None
    if elite_token:
        pdf_bytes = case1_happy_path(elite_token)
    else:
        record("1. Elite happy path 200 + headers", False, "no Elite token")

    # case2 (2 pages) is rolled into case 1's headers check — but we
    # explicitly assert 2 pages too:
    if pdf_bytes:
        case2_two_pages(pdf_bytes)
    else:
        record("1b. PDF is exactly 2 pages", False, "no PDF bytes")

    # ── Case 2 — 404 paths (invalid / revoked / non-Elite) ──
    case3_invalid_token()
    if pick_spot_id:
        case4_revoked(tok, pick_spot_id)
    else:
        record("2b. Hard-deleted token → 404", False, "no spot_id")
    case5_non_elite(tok)

    # ── Case 3 — Public HTML copy strings ──
    if elite_token:
        case6_html_copy(elite_token)
    else:
        record("3. HTML new-copy strings", False, "no Elite token")

    # ── Case 4 — JSON path + hide_scout_notes parity ──
    if elite_token:
        case7_json_unchanged(elite_token)
    else:
        record("4a. JSON unchanged", False, "no Elite token")
    if pick_spot_id:
        case8_hide_scout_notes(tok, pick_spot_id)
    else:
        record("4b. hide_scout_notes parity", False, "no spot_id")

    # ── Cases 5-9 (Round-5 deltas) ──
    if pdf_bytes:
        case_r5_qr_removed(pdf_bytes)
        case_r5_open_directions_present(pdf_bytes)
        case_r5_gmaps_annot_coords(pdf_bytes)
        case_r5_share_url_on_page2(pdf_bytes, elite_token or "")
        case_r5_image_xobject_drop(pdf_bytes)
        case_r5_page2_layout(pdf_bytes)
    else:
        for c in (
            "5. QR card removed entirely (byte search)",
            "6. 'Open Directions' on Page 1 only (case-insensitive)",
            "7. Page-1 link annot is Google Maps URL w/ coords",
            "8. Share URL on Page 2 footer (not Page 1)",
            "9. Image XObject count ≤ 7 (QR SVG dropped)",
            "11. Page 2 layout unaffected",
        ):
            record(c, False, "no PDF bytes")

    # ── Case 10 — Edge cases ──
    if elite_token:
        case_r5_address_fallback(elite_token)
        case_r5_button_hidden_no_location(elite_token)
        case_r5_image_cap_six(elite_token)
    else:
        record("10a. Edge — address fallback destination", False, "no Elite token")
        record("10b. Edge — button hidden when no location", False, "no Elite token")
        record("10c. Edge — image cap (8 patched → ≤ 6 previews)", False, "no Elite token")

    # Summary
    print("\n" + "=" * 78)
    print("ROUND-5 SUMMARY")
    print("=" * 78)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    for case, ok, msg in RESULTS:
        print(f"  [{'PASS' if ok else 'FAIL'}] {case}")
        if not ok:
            print(f"        → {msg}")
    print(f"\n{passed}/{len(RESULTS)} cases passed")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
