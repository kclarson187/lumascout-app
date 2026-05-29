"""
Regression test for the Share Location PDF endpoint redesign (Jun 2025).

Tests:
  1. Happy path Elite share → PDF 200, content-type, magic bytes, filename
  2. Non-existent token → 404
  3. Revoked / hard-deleted share → 404
  4. Non-Elite share → 404 "Premium content not available"
  5. Public HTML still works (regression — sticky topbar etc.)
  6. Public JSON still works (regression)
  7. hide_scout_notes parity (regression)

Uses the seeded Super Admin (kclarson187@gmail.com).
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Dict, Optional, Tuple

import requests

BASE = os.environ.get(
    "BACKEND_BASE_URL",
    "https://photo-finder-60.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE}/api"

SUPER_ADMIN_EMAIL = "admin@lumascout.app"
SUPER_ADMIN_PASSWORD = "Grayson@1117!!"
# Note: test_credentials.md lists kclarson187@gmail.com as super_admin but the
# live DB shows role=user/plan=pro for that account. The seed admin
# (admin@lumascout.app) is super_admin + plan=elite, so we use that for tests
# that require admin endpoints AND for minting Elite-tier shares.

RESULTS: list[Tuple[str, bool, str]] = []


def _record(case: str, ok: bool, msg: str = "") -> None:
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {case}: {msg}")
    RESULTS.append((case, ok, msg))


def login(email: str, password: str) -> Optional[str]:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    if r.status_code != 200:
        return None
    return r.json().get("token")


def auth_h(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


def get_elite_share(token: str) -> Optional[Dict[str, Any]]:
    """Find an active Elite-minted share via grouped admin endpoint."""
    r = requests.get(
        f"{API}/admin/share-links/grouped",
        headers=auth_h(token),
        timeout=30,
    )
    if r.status_code != 200:
        print(f"  grouped fetch failed: {r.status_code} {r.text[:300]}")
        return None
    data = r.json()
    for grp in data.get("items", []):
        for link in grp.get("links", []) or []:
            if link.get("created_by_was_elite"):
                # attach spot_id
                link["_spot_id"] = grp.get("location_id") or grp.get("spot_id")
                return link
    return None


def get_non_elite_share(token: str) -> Optional[Dict[str, Any]]:
    r = requests.get(
        f"{API}/admin/share-links/grouped",
        headers=auth_h(token),
        timeout=30,
    )
    if r.status_code != 200:
        return None
    data = r.json()
    for grp in data.get("items", []):
        for link in grp.get("links", []) or []:
            if not link.get("created_by_was_elite"):
                link["_spot_id"] = grp.get("location_id") or grp.get("spot_id")
                return link
    return None


def create_share_for_test(
    admin_tok: str,
    *,
    elite_fields: bool,
    hide_scout_notes: bool = False,
) -> Optional[Dict[str, Any]]:
    """Pick any spot the admin can share to and mint a fresh share link."""
    # Find a spot — use admin spots endpoint or just /spots
    r = requests.get(f"{API}/spots?limit=5", headers=auth_h(admin_tok), timeout=30)
    if r.status_code != 200:
        print(f"  /spots fetch failed: {r.status_code} {r.text[:200]}")
        return None
    items = r.json().get("items") if isinstance(r.json(), dict) else r.json()
    if not items:
        return None
    spot_id = (items[0] or {}).get("spot_id")
    if not spot_id:
        return None

    body: Dict[str, Any] = {"label": "regression-test"}
    if elite_fields:
        body["share_title"] = "Regression Test Title"
        body["hide_scout_notes"] = hide_scout_notes
    r = requests.post(
        f"{API}/spots/{spot_id}/share",
        headers={**auth_h(admin_tok), "Content-Type": "application/json"},
        json=body,
        timeout=30,
    )
    if r.status_code != 200:
        print(f"  create share failed: {r.status_code} {r.text[:200]}")
        return None
    data = r.json()
    data["_spot_id"] = spot_id
    return data


def case1_pdf_happy_path(elite_token: str) -> None:
    """Case 1: Elite share → valid PDF."""
    url = f"{API}/public/location/{elite_token}/itinerary.pdf"
    r = requests.get(url, timeout=120, allow_redirects=False)
    if r.status_code != 200:
        _record(
            "1. Elite PDF happy path",
            False,
            f"expected 200, got {r.status_code}; body[:500]={r.text[:500]!r}",
        )
        return
    ct = r.headers.get("content-type", "")
    if "application/pdf" not in ct:
        _record("1. Elite PDF happy path", False, f"wrong content-type: {ct!r}")
        return
    body = r.content
    if len(body) <= 1000:
        _record(
            "1. Elite PDF happy path",
            False,
            f"PDF too small: {len(body)} bytes; first200={body[:200]!r}",
        )
        return
    if not body.startswith(b"%PDF-"):
        _record(
            "1. Elite PDF happy path",
            False,
            f"missing %PDF- magic; first16={body[:16]!r}",
        )
        return
    cd = r.headers.get("content-disposition", "")
    if 'filename="LumaScout-' not in cd or not cd.endswith('.pdf"'):
        _record(
            "1. Elite PDF happy path",
            False,
            f"bad content-disposition: {cd!r}",
        )
        return
    _record(
        "1. Elite PDF happy path",
        True,
        f"size={len(body)} bytes, ct={ct}, cd={cd}",
    )


def case2_non_existent_token() -> None:
    url = f"{API}/public/location/THIS_TOKEN_DOES_NOT_EXIST_ABCDEF/itinerary.pdf"
    r = requests.get(url, timeout=30)
    if r.status_code != 404:
        _record(
            "2. Non-existent token → 404",
            False,
            f"expected 404, got {r.status_code}; body={r.text[:300]!r}",
        )
        return
    try:
        body = r.json()
    except Exception:
        _record(
            "2. Non-existent token → 404",
            False,
            f"non-json body: {r.text[:200]!r}",
        )
        return
    detail = body.get("detail")
    if detail != "Share unavailable":
        _record(
            "2. Non-existent token → 404",
            False,
            f"unexpected detail: {detail!r}",
        )
        return
    _record("2. Non-existent token → 404", True, "404 + Share unavailable")


def case3_revoked_share(admin_tok: str) -> None:
    """Mint a fresh share, hard-delete it via admin endpoint, then expect 404."""
    new_share = create_share_for_test(admin_tok, elite_fields=True)
    if not new_share:
        _record("3. Revoked share → 404", False, "could not mint share for test")
        return
    tok = new_share["token"]

    # Hard-delete via admin endpoint
    r = requests.delete(
        f"{API}/admin/share-links/{tok}",
        headers=auth_h(admin_tok),
        timeout=30,
    )
    if r.status_code != 200:
        _record(
            "3. Revoked share → 404",
            False,
            f"DELETE failed: {r.status_code} {r.text[:200]}",
        )
        return

    r = requests.get(
        f"{API}/public/location/{tok}/itinerary.pdf",
        timeout=30,
    )
    if r.status_code != 404:
        _record(
            "3. Revoked share → 404",
            False,
            f"expected 404, got {r.status_code}; body={r.text[:300]!r}",
        )
        return
    _record("3. Revoked share → 404", True, f"DELETE then PDF → 404 (token={tok[:8]}..)")


def case4_non_elite_share(admin_tok: str) -> None:
    """Find or create a Free/Pro-minted share, expect PDF endpoint to 404."""
    non_elite = get_non_elite_share(admin_tok)
    if not non_elite:
        # Try creating one as a non-elite user — would need a second account.
        # Fallback: directly insert via Mongo isn't possible here; instead,
        # we skip if no such share exists naturally.
        _record(
            "4. Non-Elite share → 404",
            False,
            "could not find an existing non-Elite share (created_by_was_elite=false); please mint one from a Free/Pro account",
        )
        return
    tok = non_elite.get("token")
    if not tok:
        _record("4. Non-Elite share → 404", False, "non-Elite share row had no token")
        return
    r = requests.get(
        f"{API}/public/location/{tok}/itinerary.pdf",
        timeout=30,
    )
    if r.status_code != 404:
        _record(
            "4. Non-Elite share → 404",
            False,
            f"expected 404, got {r.status_code}; body={r.text[:300]!r}",
        )
        return
    try:
        detail = r.json().get("detail")
    except Exception:
        detail = r.text
    if detail != "Premium content not available":
        _record(
            "4. Non-Elite share → 404",
            False,
            f"got 404 but wrong detail: {detail!r}",
        )
        return
    _record(
        "4. Non-Elite share → 404",
        True,
        f"404 + Premium content not available (token={tok[:8]}..)",
    )


def case5_public_html_regression(elite_token: str) -> None:
    url = f"{API}/public/location/{elite_token}"
    r = requests.get(url, headers={"Accept": "text/html"}, timeout=30)
    if r.status_code != 200:
        _record(
            "5. Public HTML regression",
            False,
            f"expected 200, got {r.status_code}; body[:300]={r.text[:300]!r}",
        )
        return
    html = r.text
    pdf_anchor = f'href="/api/public/location/{elite_token}/itinerary.pdf"'
    required_substrings = [
        'class="topbar"',
        "position:sticky",
        "· LumaScout</title>",
        "A LumaScout location",
        "Shared by",
        "5-day forecast",
        "Sun &amp; golden hour",  # & is escaped in inner HTML
        "Download PDF",
        pdf_anchor,
    ]
    missing = [s for s in required_substrings if s not in html]
    if missing:
        # Try unescaped Sun & golden hour fallback
        alt_html = html
        if "Sun &amp; golden hour" not in alt_html and "Sun & golden hour" in alt_html:
            missing = [m for m in missing if m != "Sun &amp; golden hour"]
    if missing:
        _record(
            "5. Public HTML regression",
            False,
            f"missing substrings: {missing}; html[:500]={html[:500]!r}",
        )
        return
    # And PDF-only artifacts must NOT be present
    bad = []
    if "@page" in html:
        bad.append("@page")
    if "position: static !important" in html:
        bad.append("position: static !important")
    if bad:
        _record(
            "5. Public HTML regression",
            False,
            f"PDF-only artifacts leaked to HTML: {bad}",
        )
        return
    _record(
        "5. Public HTML regression",
        True,
        "all required substrings present; no PDF-only leakage",
    )


def case6_public_json_regression(elite_token: str) -> None:
    url = f"{API}/public/location/{elite_token}"
    r = requests.get(url, headers={"Accept": "application/json"}, timeout=30)
    if r.status_code != 200:
        _record(
            "6. Public JSON regression",
            False,
            f"expected 200, got {r.status_code}; body[:300]={r.text[:300]!r}",
        )
        return
    try:
        body = r.json()
    except Exception:
        _record("6. Public JSON regression", False, f"non-json: {r.text[:300]!r}")
        return
    if body.get("status") != "ok":
        _record(
            "6. Public JSON regression",
            False,
            f"status != ok: {body.get('status')!r}",
        )
        return
    if "spot" not in body or "og" not in body:
        _record(
            "6. Public JSON regression",
            False,
            f"missing keys: keys={list(body.keys())}",
        )
        return
    _record(
        "6. Public JSON regression",
        True,
        f"status=ok, has spot/og, robots={body.get('robots')!r}",
    )


def case7_hide_scout_notes_parity(admin_tok: str) -> None:
    """Mint an Elite share with hide_scout_notes=true and check filter."""
    new_share = create_share_for_test(
        admin_tok, elite_fields=True, hide_scout_notes=True
    )
    if not new_share:
        _record(
            "7. hide_scout_notes parity",
            False,
            "could not mint Elite share with hide_scout_notes=true",
        )
        return
    tok = new_share["token"]
    url = f"{API}/public/location/{tok}"
    r = requests.get(url, headers={"Accept": "application/json"}, timeout=30)
    if r.status_code != 200:
        _record(
            "7. hide_scout_notes parity",
            False,
            f"expected 200, got {r.status_code}; body={r.text[:300]!r}",
        )
        return
    body = r.json()
    spot = body.get("spot") or {}
    leaked = [
        f for f in ("parking_notes", "creator_tips", "best_time_of_day")
        if f in spot and spot.get(f)
    ]
    if leaked:
        _record(
            "7. hide_scout_notes parity",
            False,
            f"hidden fields leaked into JSON: {leaked}; spot_keys={list(spot.keys())}",
        )
        return
    _record(
        "7. hide_scout_notes parity",
        True,
        f"parking_notes/creator_tips/best_time_of_day correctly absent (token={tok[:8]}..)",
    )

    # Cleanup
    try:
        requests.delete(
            f"{API}/admin/share-links/{tok}",
            headers=auth_h(admin_tok),
            timeout=15,
        )
    except Exception:
        pass


def main() -> int:
    print(f"Backend: {API}")
    print("Logging in as super admin...")
    tok = login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
    if not tok:
        print("FATAL: super admin login failed")
        return 2
    print("Login OK")

    # Find an Elite-minted active share to use across cases 1, 5, 6
    elite_share = get_elite_share(tok)
    elite_token: Optional[str] = None
    if elite_share and elite_share.get("token"):
        elite_token = elite_share["token"]
        print(f"Found existing Elite share token: {elite_token[:8]}.. (spot_id={elite_share.get('_spot_id')})")
    else:
        # Mint a fresh one
        print("No existing Elite share; minting a fresh one for tests 1/5/6.")
        fresh = create_share_for_test(tok, elite_fields=True)
        if fresh:
            elite_token = fresh["token"]
            print(f"Minted Elite share token: {elite_token[:8]}..")

    if elite_token:
        case1_pdf_happy_path(elite_token)
    else:
        _record("1. Elite PDF happy path", False, "no Elite-minted share available")

    case2_non_existent_token()
    case3_revoked_share(tok)
    case4_non_elite_share(tok)

    if elite_token:
        case5_public_html_regression(elite_token)
        case6_public_json_regression(elite_token)
    else:
        _record("5. Public HTML regression", False, "no Elite-minted share available")
        _record("6. Public JSON regression", False, "no Elite-minted share available")

    case7_hide_scout_notes_parity(tok)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    for case, ok, msg in RESULTS:
        print(f"  [{'PASS' if ok else 'FAIL'}] {case}")
    print(f"\n{passed}/{len(RESULTS)} cases passed")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
