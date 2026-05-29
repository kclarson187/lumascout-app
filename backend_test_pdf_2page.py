"""
Regression test for the condensed 2-page Share Location PDF feature
(Jun 2025 round 2). Verifies:

  1. Elite happy path → 200 application/pdf, %PDF- magic, size > 1000,
     Content-Disposition `inline; filename="LumaScout-{Slug}-Client-Itinerary.pdf"`
  2. PDF is EXACTLY 2 pages
  3. Invalid token → 404 "Share unavailable"
  4. Hard-deleted token → 404
  5. Non-Elite (Pro/Free) share → 404 "Premium content not available"
  6. Public HTML contains new copy strings (Download Client PDF /
     Preparing PDF… / Couldn't generate this PDF. Please try again.)
     and the OLD literal `>Download PDF<` button text is gone
  7. JSON path unchanged (status=ok + spot/og/robots keys present)
  8. hide_scout_notes=True parity (parking_notes/creator_tips/
     best_time_of_day absent from JSON spot; PDF still 200)
  9. Stretch: long content still produces a 2-page PDF (truncation +
     pypdf cap)

Uses seeded admin (super_admin, elite plan).
"""
from __future__ import annotations

import io
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

import requests

BASE = os.environ.get(
    "BACKEND_BASE_URL",
    "https://photo-finder-60.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

RESULTS: List[Tuple[str, bool, str]] = []


def record(case: str, ok: bool, msg: str = "") -> None:
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
        print(f"  login failed {r.status_code}: {r.text[:300]}")
        return None
    return r.json().get("token")


def auth_h(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


def list_grouped(admin_tok: str) -> List[Dict[str, Any]]:
    r = requests.get(
        f"{API}/admin/share-links/grouped",
        headers=auth_h(admin_tok),
        timeout=30,
    )
    if r.status_code != 200:
        print(f"  /admin/share-links/grouped failed: {r.status_code} {r.text[:300]}")
        return []
    return r.json().get("items", []) or []


def find_share(items: List[Dict[str, Any]], elite: bool) -> Optional[Dict[str, Any]]:
    for grp in items:
        for link in grp.get("links") or []:
            if bool(link.get("created_by_was_elite")) == elite:
                link["_spot_id"] = grp.get("location_id")
                link["_location_name"] = grp.get("location_name")
                return link
    return None


def find_elite_share_with_hide_notes(items: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for grp in items:
        for link in grp.get("links") or []:
            if link.get("created_by_was_elite") and link.get("hide_scout_notes"):
                link["_spot_id"] = grp.get("location_id")
                return link
    return None


def pick_owner_spot(admin_tok: str) -> Optional[str]:
    """Return a spot_id owned by the admin so /spots/{id}/share succeeds."""
    # Fetch the admin's own user_id from /auth/me
    me = requests.get(f"{API}/auth/me", headers=auth_h(admin_tok), timeout=30)
    if me.status_code != 200:
        return None
    uid = me.json().get("user_id")
    # /spots list endpoint typically supports owner filter; fallback to scanning
    for params in (
        {"limit": 25, "owner_user_id": uid},
        {"limit": 50},
    ):
        r = requests.get(f"{API}/spots", headers=auth_h(admin_tok), params=params, timeout=30)
        if r.status_code != 200:
            continue
        j = r.json()
        items = j.get("items") if isinstance(j, dict) else j
        if not items:
            continue
        # Prefer one owned by admin first.
        for s in items:
            if s.get("owner_user_id") == uid:
                return s.get("spot_id")
        # Fall back to any spot the admin can share (admins can share any).
        for s in items:
            if s.get("spot_id"):
                return s.get("spot_id")
    return None


def mint_share(
    admin_tok: str,
    spot_id: str,
    *,
    hide_scout_notes: bool = False,
    share_title: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    body: Dict[str, Any] = {"label": "pdf-2page-regression"}
    if share_title:
        body["share_title"] = share_title
    if hide_scout_notes:
        body["hide_scout_notes"] = True
    r = requests.post(
        f"{API}/spots/{spot_id}/share",
        headers={**auth_h(admin_tok), "Content-Type": "application/json"},
        json=body,
        timeout=30,
    )
    if r.status_code != 200:
        print(f"  POST /spots/{spot_id}/share failed: {r.status_code} {r.text[:300]}")
        return None
    return r.json()


def delete_share(admin_tok: str, token: str) -> int:
    r = requests.delete(
        f"{API}/admin/share-links/{token}",
        headers=auth_h(admin_tok),
        timeout=30,
    )
    return r.status_code


# ─── Cases ─────────────────────────────────────────────────────────

def case1_happy_path(elite_token: str) -> Optional[bytes]:
    url = f"{API}/public/location/{elite_token}/itinerary.pdf"
    r = requests.get(url, timeout=120)
    if r.status_code != 200:
        record("1. Elite happy path 200 + headers", False,
               f"expected 200, got {r.status_code}; body[:300]={r.text[:300]!r}")
        return None
    ct = r.headers.get("content-type", "")
    if "application/pdf" not in ct:
        record("1. Elite happy path 200 + headers", False, f"wrong content-type {ct!r}")
        return None
    body = r.content
    if len(body) <= 1000:
        record("1. Elite happy path 200 + headers", False, f"body too small ({len(body)} bytes)")
        return None
    if not body.startswith(b"%PDF-"):
        record("1. Elite happy path 200 + headers", False, f"missing %PDF- magic; first16={body[:16]!r}")
        return None
    cd = r.headers.get("content-disposition", "")
    # required pattern: inline; filename="LumaScout-{Slug}-Client-Itinerary.pdf"
    import re
    m = re.match(r'inline;\s*filename="LumaScout-[A-Za-z0-9\-]+-Client-Itinerary\.pdf"\s*$', cd)
    if not m:
        record("1. Elite happy path 200 + headers", False,
               f"content-disposition does not match pattern; got {cd!r}")
        return None
    record(
        "1. Elite happy path 200 + headers", True,
        f"size={len(body)}B, ct={ct}, cd={cd}",
    )
    return body


def case2_two_pages(pdf_bytes: bytes) -> None:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        n = len(reader.pages)
    except Exception as e:
        record("2. PDF is exactly 2 pages", False, f"pypdf failed: {e!r}")
        return
    if n != 2:
        record("2. PDF is exactly 2 pages", False, f"got {n} pages")
        return
    record("2. PDF is exactly 2 pages", True, f"len(reader.pages)={n}")


def case3_invalid_token() -> None:
    url = f"{API}/public/location/THIS_TOKEN_DOES_NOT_EXIST_ABCDEF/itinerary.pdf"
    r = requests.get(url, timeout=30)
    if r.status_code != 404:
        record("3. Invalid token → 404", False, f"expected 404, got {r.status_code}; body={r.text[:200]!r}")
        return
    try:
        detail = r.json().get("detail")
    except Exception:
        detail = r.text
    if detail != "Share unavailable":
        record("3. Invalid token → 404", False, f"got 404 but detail={detail!r}")
        return
    record("3. Invalid token → 404", True, "404 + 'Share unavailable'")


def case4_revoked(admin_tok: str, spot_id: str) -> None:
    minted = mint_share(admin_tok, spot_id, share_title="Regression Revoke Title")
    if not minted or not minted.get("token"):
        record("4. Hard-deleted token → 404", False, "could not mint test share")
        return
    tok = minted["token"]
    dstatus = delete_share(admin_tok, tok)
    if dstatus != 200:
        record("4. Hard-deleted token → 404", False, f"DELETE returned {dstatus}")
        return
    r = requests.get(f"{API}/public/location/{tok}/itinerary.pdf", timeout=30)
    if r.status_code != 404:
        record("4. Hard-deleted token → 404", False,
               f"expected 404, got {r.status_code}; body={r.text[:200]!r}")
        return
    record("4. Hard-deleted token → 404", True, f"token={tok[:8]}… → 404")


def case5_non_elite(admin_tok: str) -> None:
    items = list_grouped(admin_tok)
    non_elite = find_share(items, elite=False)
    if not non_elite or not non_elite.get("token"):
        record("5. Non-Elite share → 404", False,
               "no existing non-Elite (created_by_was_elite=false) share found")
        return
    tok = non_elite["token"]
    r = requests.get(f"{API}/public/location/{tok}/itinerary.pdf", timeout=30)
    if r.status_code != 404:
        record("5. Non-Elite share → 404", False,
               f"expected 404, got {r.status_code}; body={r.text[:200]!r}")
        return
    try:
        detail = r.json().get("detail")
    except Exception:
        detail = r.text
    if detail != "Premium content not available":
        record("5. Non-Elite share → 404", False, f"got 404 but detail={detail!r}")
        return
    record("5. Non-Elite share → 404", True,
           f"token={tok[:8]}… → 404 + 'Premium content not available'")


def case6_html_copy(elite_token: str) -> None:
    url = f"{API}/public/location/{elite_token}"
    r = requests.get(url, headers={"Accept": "text/html"}, timeout=30)
    if r.status_code != 200:
        record("6. HTML new-copy strings", False,
               f"expected 200, got {r.status_code}; body[:300]={r.text[:300]!r}")
        return
    html = r.text
    required = [
        "Download Client PDF",
        "Preparing PDF\u2026",  # "Preparing PDF…"
        "Couldn\u2019t generate this PDF. Please try again.",  # Couldn't…
    ]
    missing = [s for s in required if s not in html]
    if missing:
        # also surface raw repr to debug curly-quote / ellipsis encoding
        snippet = ""
        for needle in ("Download Client PDF", "Preparing PDF", "generate this PDF"):
            idx = html.find(needle)
            if idx >= 0:
                snippet += f" ...near {needle!r}@{idx}: {html[idx:idx+120]!r}"
        record("6. HTML new-copy strings", False,
               f"missing strings: {missing!r}; debug:{snippet}")
        return
    # OLD literal button text >Download PDF< must be gone.
    if ">Download PDF<" in html:
        record("6. HTML new-copy strings", False,
               "legacy literal '>Download PDF<' button text still present")
        return
    record("6. HTML new-copy strings", True,
           "all three new strings present; legacy '>Download PDF<' absent")


def case7_json_unchanged(elite_token: str) -> None:
    url = f"{API}/public/location/{elite_token}"
    r = requests.get(url, headers={"Accept": "application/json"}, timeout=30)
    if r.status_code != 200:
        record("7. JSON unchanged", False,
               f"expected 200, got {r.status_code}; body[:300]={r.text[:300]!r}")
        return
    try:
        body = r.json()
    except Exception:
        record("7. JSON unchanged", False, f"non-JSON body: {r.text[:200]!r}")
        return
    if body.get("status") != "ok":
        record("7. JSON unchanged", False, f"status={body.get('status')!r}")
        return
    missing = [k for k in ("spot", "og", "robots") if k not in body]
    if missing:
        record("7. JSON unchanged", False,
               f"missing keys: {missing!r}; keys={list(body.keys())}")
        return
    record("7. JSON unchanged", True,
           f"status=ok, has spot/og/robots; robots={body.get('robots')!r}")


def case8_hide_scout_notes(admin_tok: str, spot_id: str) -> None:
    minted = mint_share(
        admin_tok, spot_id,
        hide_scout_notes=True,
        share_title="Hide Notes Regression",
    )
    if not minted or not minted.get("token"):
        record("8. hide_scout_notes parity", False, "could not mint Elite hide-notes share")
        return
    tok = minted["token"]

    try:
        # 8a — JSON must strip parking_notes/creator_tips/best_time_of_day
        rj = requests.get(
            f"{API}/public/location/{tok}",
            headers={"Accept": "application/json"},
            timeout=30,
        )
        if rj.status_code != 200:
            record("8. hide_scout_notes parity", False,
                   f"JSON expected 200, got {rj.status_code}: {rj.text[:200]!r}")
            return
        spot = (rj.json().get("spot") or {})
        leaked = [
            f for f in ("parking_notes", "creator_tips", "best_time_of_day")
            if f in spot and spot.get(f) not in (None, "", [], {})
        ]
        if leaked:
            record("8. hide_scout_notes parity", False,
                   f"hidden fields leaked into JSON: {leaked}; keys={list(spot.keys())[:25]}")
            return

        # 8b — PDF still works
        rp = requests.get(f"{API}/public/location/{tok}/itinerary.pdf", timeout=120)
        if rp.status_code != 200:
            record("8. hide_scout_notes parity", False,
                   f"PDF expected 200, got {rp.status_code}: {rp.text[:200]!r}")
            return
        if not rp.content.startswith(b"%PDF-"):
            record("8. hide_scout_notes parity", False,
                   f"PDF magic missing; first16={rp.content[:16]!r}")
            return

        record("8. hide_scout_notes parity", True,
               f"token={tok[:8]}… → JSON has no hidden fields; PDF 200 ({len(rp.content)}B)")
    finally:
        try:
            delete_share(admin_tok, tok)
        except Exception:
            pass


def case9_long_content_two_pages(admin_tok: str, spot_id: str) -> None:
    """Patch the spot with very long notes via Mongo, verify PDF stays
    at 2 pages, restore the spot.
    """
    try:
        from motor.motor_asyncio import AsyncIOMotorClient  # type: ignore
        import asyncio
    except Exception as e:
        record("9. Long-content 2-page guarantee", False, f"motor unavailable: {e!r}")
        return

    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "photoscout_database")
    long_text = ("This is a long photographer note. " * 80)[:3000]
    fields_to_patch = ("parking_notes", "creator_tips", "safety_notes", "permit_notes")

    async def patch_and_test() -> Tuple[bool, str]:
        client = AsyncIOMotorClient(mongo_url)
        try:
            db = client[db_name]
            before = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, **{f: 1 for f in fields_to_patch}})
            if not before:
                return False, f"spot_id={spot_id} not found"
            try:
                await db.spots.update_one(
                    {"spot_id": spot_id},
                    {"$set": {f: long_text for f in fields_to_patch}},
                )
                # Mint a fresh Elite share for the patched spot.
                minted = mint_share(admin_tok, spot_id, share_title="Long Content 2 Page")
                if not minted or not minted.get("token"):
                    return False, "could not mint Elite share for long-content test"
                tok = minted["token"]
                try:
                    r = requests.get(
                        f"{API}/public/location/{tok}/itinerary.pdf", timeout=180
                    )
                    if r.status_code != 200:
                        return False, f"PDF expected 200, got {r.status_code}: {r.text[:200]!r}"
                    if not r.content.startswith(b"%PDF-"):
                        return False, f"missing %PDF- magic; first16={r.content[:16]!r}"
                    from pypdf import PdfReader
                    reader = PdfReader(io.BytesIO(r.content))
                    n = len(reader.pages)
                    if n != 2:
                        return False, f"expected 2 pages with long content, got {n}"
                    return True, f"long-content PDF stayed at 2 pages ({len(r.content)}B)"
                finally:
                    try:
                        delete_share(admin_tok, tok)
                    except Exception:
                        pass
            finally:
                # Restore original values (unset patched fields if they weren't present).
                unset = {f: "" for f in fields_to_patch if f not in before}
                setops = {f: before[f] for f in fields_to_patch if f in before}
                update: Dict[str, Any] = {}
                if setops:
                    update["$set"] = setops
                if unset:
                    update["$unset"] = unset
                if update:
                    await db.spots.update_one({"spot_id": spot_id}, update)
        finally:
            client.close()

    try:
        ok, msg = asyncio.run(patch_and_test())
    except Exception as e:
        record("9. Long-content 2-page guarantee", False, f"exception: {e!r}")
        return
    record("9. Long-content 2-page guarantee", ok, msg)


# ─── Main ─────────────────────────────────────────────────────────

def main() -> int:
    print(f"Backend: {API}")
    print("Logging in as super admin…")
    tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not tok:
        print("FATAL: admin login failed")
        return 2
    print("OK")

    items = list_grouped(tok)
    print(f"Found {len(items)} share-link groups via /admin/share-links/grouped")

    # ── pick Elite token (existing or freshly minted) ──
    elite_existing = find_share(items, elite=True)
    elite_token: Optional[str] = None
    if elite_existing and elite_existing.get("token"):
        elite_token = elite_existing["token"]
        print(f"Using existing Elite token: {elite_token[:8]}… (spot={elite_existing.get('_spot_id')})")
    else:
        spot_id = pick_owner_spot(tok)
        if not spot_id:
            print("FATAL: cannot pick a spot to mint Elite share against.")
            return 2
        minted = mint_share(tok, spot_id, share_title="Regression Elite PDF")
        if minted and minted.get("token"):
            elite_token = minted["token"]
            print(f"Minted Elite token: {elite_token[:8]}… (spot={spot_id})")

    # Pick a spot we can re-use to mint fresh shares.
    pick_spot_id = (elite_existing or {}).get("_spot_id") or pick_owner_spot(tok)

    # ── Cases ──
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

    if pick_spot_id:
        case9_long_content_two_pages(tok, pick_spot_id)
    else:
        record("9. Long-content 2-page guarantee", False, "no spot_id to patch")

    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    for case, ok, msg in RESULTS:
        print(f"  [{'PASS' if ok else 'FAIL'}] {case}")
        if not ok:
            print(f"        → {msg}")
    print(f"\n{passed}/{len(RESULTS)} cases passed")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
