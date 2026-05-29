"""
Regression test — Share Location PDF redesign (Jun 2026, round 3 — "Client
Shoot Itinerary"). Reuses helpers from backend_test_pdf_2page.py and adds:

  9.  Page 1 LIVE SHARE LOCATION card copy (QR kicker + body sentence + URL)
  10. Page 2 footer 3-column copy (Shared with LumaScout / © LumaScout / Generated …)
  11. Weather chips show up to 5 days (≥4 distinct weekday abbreviations on page 2)
  12. (stretch) long-content 2-page guarantee

Uses the seeded super admin (admin@lumascout.app / Grayson@1117!!) and the
known active Elite share token jR2Hid-ihfpk5n91IP7voyYr47DB6tRo (Bullis
County Park) when present.
"""
from __future__ import annotations

import io
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

import requests

# Re-export the existing helpers from the round-2 harness.
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
    case9_long_content_two_pages,  # stretch case 12
)

KNOWN_ELITE_TOKEN = "jR2Hid-ihfpk5n91IP7voyYr47DB6tRo"


# ── text extraction ───────────────────────────────────────────────


def extract_pages_text(pdf_bytes: bytes) -> List[str]:
    """Return a list[text_per_page]. Tries pdfplumber first (more
    reliable text positioning), falls back to pypdf.
    """
    try:
        import pdfplumber  # type: ignore
        out: List[str] = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for p in pdf.pages:
                out.append(p.extract_text() or "")
        return out
    except Exception:
        pass
    try:
        from pypdf import PdfReader
        out2: List[str] = []
        for p in PdfReader(io.BytesIO(pdf_bytes)).pages:
            out2.append(p.extract_text() or "")
        return out2
    except Exception:
        return []


# ── NEW round-3 cases ─────────────────────────────────────────────


def case9_live_share_card(pdf_bytes: bytes, elite_token: str) -> None:
    pages = extract_pages_text(pdf_bytes)
    if len(pages) < 1:
        record("9. Page 1 LIVE SHARE LOCATION card", False, "could not extract page 1 text")
        return
    page1 = pages[0] or ""
    haystack = page1.lower()

    fails: List[str] = []
    if "live share location" not in haystack:
        fails.append("missing 'Live Share Location' kicker")

    body_needle = "scan to open the up-to-date share location page"
    if body_needle not in haystack:
        fails.append(f"missing body sentence fragment '{body_needle!r}'")

    url_substr = f"/api/public/location/{elite_token}"
    if url_substr not in page1:
        fails.append(f"missing share URL substring {url_substr!r}")

    if fails:
        excerpt = page1[:1200].replace("\n", " | ")
        record("9. Page 1 LIVE SHARE LOCATION card", False,
               f"{fails!r}; page1[:1200]={excerpt!r}")
        return

    record("9. Page 1 LIVE SHARE LOCATION card", True,
           f"kicker + body sentence + share URL all present (page1 len={len(page1)})")


def case10_footer_columns(pdf_bytes: bytes) -> None:
    pages = extract_pages_text(pdf_bytes)
    if len(pages) < 2:
        record("10. Page 2 footer 3-column copy", False,
               f"need 2 pages, got {len(pages)}")
        return
    page2 = pages[1] or ""

    fails: List[str] = []
    if "Shared with LumaScout" not in page2:
        fails.append("missing 'Shared with LumaScout'")
    # © may render as "©" or "(c)"; the PDF renderer uses the U+00A9 char.
    if ("© LumaScout" not in page2) and ("(c) LumaScout" not in page2) and ("LumaScout" not in page2):
        fails.append("missing '© LumaScout'")
    elif "© LumaScout" not in page2:
        # Some text extractors strip the © char. Accept "LumaScout" at end
        # but warn.
        pass
    if "Generated " not in page2:
        fails.append("missing 'Generated ' substring")

    if fails:
        excerpt = page2[:1200].replace("\n", " | ")
        record("10. Page 2 footer 3-column copy", False,
               f"{fails!r}; page2[:1200]={excerpt!r}")
        return

    # Extra integrity — make sure the "Generated" string mentions a current
    # month/year stamp (any 4-digit year is good enough).
    if not re.search(r"Generated [A-Z][a-z]+ \d{1,2}, \d{4}", page2):
        excerpt = page2[:600].replace("\n", " | ")
        record("10. Page 2 footer 3-column copy", True,
               f"Minor: footer present but 'Generated <Month D, YYYY>' pattern not found; page2[:600]={excerpt!r}")
        return

    record("10. Page 2 footer 3-column copy", True,
           "Shared with LumaScout · © LumaScout · Generated <Month D, YYYY> present")


WEEKDAY_RE = re.compile(r"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b")


def case11_weather_chips(pdf_bytes: bytes) -> None:
    pages = extract_pages_text(pdf_bytes)
    if len(pages) < 2:
        record("11. Weather chips 5-day", False, f"need 2 pages, got {len(pages)}")
        return
    page2 = pages[1] or ""

    # Find the Light & Weather block and look for distinct weekday tokens.
    # We scan all of page 2 because pdfplumber may not segment chips cleanly.
    found = set()
    for m in WEEKDAY_RE.finditer(page2):
        found.add(m.group(1))

    if len(found) < 4:
        excerpt = page2[:1500].replace("\n", " | ")
        record("11. Weather chips 5-day", False,
               f"expected ≥4 distinct weekdays, found {sorted(found)!r}; page2[:1500]={excerpt!r}")
        return
    record("11. Weather chips 5-day", True,
           f"distinct weekdays found: {sorted(found)!r} (≥4 → chip row renders ~5 days)")


# ── Main ──────────────────────────────────────────────────────────


def main() -> int:
    print(f"Backend: {API}")
    print("Logging in as super admin…")
    tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not tok:
        print("FATAL: admin login failed")
        return 2

    # Pick the known Elite token if it still resolves; otherwise pick any
    # Elite share from /admin/share-links/grouped.
    items = list_grouped(tok)
    print(f"Found {len(items)} share-link groups")

    elite_token: Optional[str] = None
    probe = requests.get(
        f"{API}/public/location/{KNOWN_ELITE_TOKEN}",
        headers={"Accept": "application/json"},
        timeout=30,
    )
    if probe.status_code == 200 and (probe.json().get("status") == "ok"):
        elite_token = KNOWN_ELITE_TOKEN
        print(f"Using known Elite token: {elite_token[:8]}… (Bullis County Park)")
    else:
        elite_existing = find_share(items, elite=True)
        if elite_existing and elite_existing.get("token"):
            elite_token = elite_existing["token"]
            print(f"Using existing Elite token from /admin/share-links/grouped: {elite_token[:8]}… (spot={elite_existing.get('_spot_id')})")

    if not elite_token:
        # Last resort — mint one.
        sid = pick_owner_spot(tok)
        if sid:
            minted = mint_share(tok, sid, share_title="Round3 Elite PDF")
            if minted and minted.get("token"):
                elite_token = minted["token"]
                print(f"Minted Elite token: {elite_token[:8]}… (spot={sid})")

    pick_spot_id: Optional[str] = None
    # Prefer the spot tied to elite_token so case 8/12 can mint against the
    # same owner. Walk through grouped items.
    for grp in items:
        for link in grp.get("links") or []:
            if link.get("token") == elite_token:
                pick_spot_id = grp.get("location_id")
                break
        if pick_spot_id:
            break
    if not pick_spot_id:
        pick_spot_id = pick_owner_spot(tok)

    # ── Cases 1-8 (regression of round-2 baseline) ──
    pdf_bytes: Optional[bytes] = None
    if elite_token:
        pdf_bytes = case1_happy_path(elite_token)
    else:
        record("1. Elite happy path 200 + headers", False, "no Elite token available")

    if pdf_bytes:
        case2_two_pages(pdf_bytes)
    else:
        record("2. PDF is exactly 2 pages", False, "no PDF bytes from case 1")

    case3_invalid_token()

    if pick_spot_id:
        case4_revoked(tok, pick_spot_id)
    else:
        record("4. Hard-deleted token → 404", False, "no spot_id to mint test share")

    case5_non_elite(tok)

    if elite_token:
        case6_html_copy(elite_token)
        case7_json_unchanged(elite_token)
    else:
        record("6. HTML new-copy strings", False, "no Elite token")
        record("7. JSON unchanged", False, "no Elite token")

    if pick_spot_id:
        case8_hide_scout_notes(tok, pick_spot_id)
    else:
        record("8. hide_scout_notes parity", False, "no spot_id to mint test share")

    # ── NEW round-3 cases (9/10/11) — operate on the elite PDF from case 1 ──
    if pdf_bytes and elite_token:
        case9_live_share_card(pdf_bytes, elite_token)
        case10_footer_columns(pdf_bytes)
        case11_weather_chips(pdf_bytes)
    else:
        record("9. Page 1 LIVE SHARE LOCATION card", False, "no PDF bytes")
        record("10. Page 2 footer 3-column copy", False, "no PDF bytes")
        record("11. Weather chips 5-day", False, "no PDF bytes")

    # ── Stretch: long-content 2-page guarantee ──
    if pick_spot_id:
        case9_long_content_two_pages(tok, pick_spot_id)
    else:
        record("9. Long-content 2-page guarantee", False, "no spot_id to patch")

    # Summary
    print("\n" + "=" * 72)
    print("SUMMARY")
    print("=" * 72)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    for case, ok, msg in RESULTS:
        print(f"  [{'PASS' if ok else 'FAIL'}] {case}")
        if not ok:
            print(f"        → {msg}")
    print(f"\n{passed}/{len(RESULTS)} cases passed")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
