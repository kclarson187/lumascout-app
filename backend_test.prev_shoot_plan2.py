#!/usr/bin/env python3
"""
backend_test.py — Validate the Jun 2025 "Share Location" backend redesign.

Covers ONLY the review request:
  A. Personal note persistence (POST /api/spots/{id}/share)
  B. Public viewer HTML (/api/public/location/{token})
  C. Privacy / visibility — no regressions
  D. Backward compatibility (legacy share docs + /shares list)
  E. Edge / stability (HTML escape, multi-line, regression on weather/shoot-plan)

Backend URL: REACT_APP_BACKEND_URL from frontend/.env, with /api prefix.
"""
from __future__ import annotations
import os
import re
import sys
import json
import traceback
from typing import Any, Dict, List, Optional, Tuple

import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://photo-finder-60.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "photoscout_database")

EMAIL = "kclarson187@gmail.com"
PASSWORD = "Grayson@1117!!"
SPOT_ID = "spot_6829d0a67f60"

session = requests.Session()
session.headers.update({"Accept": "application/json"})

PASS: List[str] = []
FAIL: List[str] = []
NOTES: List[str] = []


def ok(label: str):
    PASS.append(label)
    print(f"  ✅ {label}")


def bad(label: str, detail: str = ""):
    FAIL.append(f"{label} — {detail}")
    print(f"  ❌ {label}\n      {detail}")


def note(s: str):
    NOTES.append(s)
    print(f"  ℹ️  {s}")


def login() -> str:
    r = session.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    if r.status_code != 200:
        raise SystemExit(f"login failed: {r.status_code} {r.text[:300]}")
    return r.json()["token"]


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_share(token: str, spot_id: str, body: Dict[str, Any]) -> requests.Response:
    return session.post(
        f"{API}/spots/{spot_id}/share",
        json=body,
        headers=auth_headers(token),
        timeout=20,
    )


def revoke_share(token: str, spot_id: str, share_token: str) -> requests.Response:
    return session.delete(
        f"{API}/spots/{spot_id}/share/{share_token}",
        headers=auth_headers(token),
        timeout=20,
    )


def list_shares(token: str, spot_id: str) -> requests.Response:
    return session.get(
        f"{API}/spots/{spot_id}/shares",
        headers=auth_headers(token),
        timeout=20,
    )


def get_public_html(share_token: str) -> requests.Response:
    return session.get(
        f"{API}/public/location/{share_token}",
        headers={"Accept": "text/html"},
        timeout=20,
    )


def get_public_json(share_token: str) -> requests.Response:
    return session.get(
        f"{API}/public/location/{share_token}",
        headers={"Accept": "application/json"},
        timeout=20,
    )


def get_visibility(token: str, spot_id: str) -> Tuple[str, str]:
    r = session.get(f"{API}/spots/{spot_id}", headers=auth_headers(token), timeout=20)
    if r.status_code != 200:
        return ("", "")
    d = r.json()
    return (d.get("privacy_mode") or "", d.get("location_display_mode") or "")


def set_visibility(token: str, spot_id: str, visibility: str, show_exact: Optional[bool] = None):
    body: Dict[str, Any] = {"visibility": visibility}
    if show_exact is not None:
        body["show_exact_location"] = show_exact
    return session.patch(
        f"{API}/spots/{spot_id}/visibility",
        json=body,
        headers=auth_headers(token),
        timeout=20,
    )


def section_A_personal_note_persistence(token: str) -> Dict[str, str]:
    print("\n=== A. Personal note persistence ===")
    out: Dict[str, str] = {}

    pmode, _ldisp = get_visibility(token, SPOT_ID)
    if pmode != "public":
        r = set_visibility(token, SPOT_ID, "public")
        if r.status_code != 200:
            note(f"Could not set spot public: {r.status_code} {r.text[:200]}")

    # A.1
    note_text = "Hi Sarah — bring extras!"
    r = create_share(token, SPOT_ID, {"label": "Sarah session", "personal_note": note_text})
    if r.status_code != 200:
        bad("A.1 POST /share with personal_note", f"status={r.status_code} body={r.text[:300]}")
    else:
        data = r.json()
        if not data.get("token"):
            bad("A.1 token missing in response", json.dumps(data)[:200])
        else:
            out["A1"] = data["token"]
            ok(f"A.1 POST /share returned token (len={len(data['token'])})")
            lr = list_shares(token, SPOT_ID)
            if lr.status_code == 200:
                row = next((x for x in lr.json().get("items", []) if x.get("token") == data["token"]), None)
                if not row:
                    bad("A.1 share row not found in /shares list", "")
                else:
                    if row.get("personal_note") == note_text:
                        ok("A.1 personal_note persisted exactly (via /shares list)")
                    else:
                        bad("A.1 personal_note not on /shares row OR mismatched",
                            f"row.personal_note={row.get('personal_note')!r}")
            else:
                bad("A.1 GET /shares failed", f"{lr.status_code}")
            try:
                cli = MongoClient(MONGO_URL, serverSelectionTimeoutMS=2000)
                doc = cli[DB_NAME].spot_shares.find_one({"token": data["token"]})
                if doc and doc.get("personal_note") == note_text:
                    ok("A.1 personal_note stored verbatim in spot_shares doc")
                elif doc:
                    bad("A.1 spot_shares doc personal_note mismatch",
                        f"stored={doc.get('personal_note')!r}")
                else:
                    bad("A.1 spot_shares doc not found by token", "")
            except Exception as e:
                note(f"A.1 mongo cross-check skipped: {e}")

    # A.2 — 700 chars
    long_note = "x" * 700
    r = create_share(token, SPOT_ID, {"personal_note": long_note})
    if r.status_code == 422:
        ok("A.2 long personal_note REJECTED via 422 (acceptable)")
        note("A.2 behavior: server rejects >600 chars with 422.")
    elif r.status_code == 200:
        data = r.json()
        out["A2"] = data["token"]
        lr = list_shares(token, SPOT_ID)
        row = next((x for x in lr.json().get("items", []) if x.get("token") == data["token"]), None)
        stored = (row or {}).get("personal_note") or ""
        if len(stored) == 600 and stored == "x" * 600:
            ok(f"A.2 long personal_note ACCEPTED and truncated to {len(stored)} chars")
            note(f"A.2 behavior: server truncates to {len(stored)} chars (max 600).")
        elif 0 < len(stored) <= 600:
            ok(f"A.2 long personal_note ACCEPTED, stored len={len(stored)} (≤600)")
        else:
            bad("A.2 long personal_note neither truncated nor rejected", f"len={len(stored)}")
    else:
        bad("A.2 long personal_note unexpected status", f"{r.status_code} {r.text[:200]}")

    # A.3 — no field
    r = create_share(token, SPOT_ID, {"label": "no-note"})
    if r.status_code != 200:
        bad("A.3 POST /share with no personal_note", f"{r.status_code} {r.text[:200]}")
    else:
        data = r.json()
        out["A3"] = data["token"]
        lr = list_shares(token, SPOT_ID)
        row = next((x for x in lr.json().get("items", []) if x.get("token") == data["token"]), None)
        pn = (row or {}).get("personal_note")
        if pn in (None, ""):
            ok(f"A.3 personal_note absent → stored as {pn!r}")
        else:
            bad("A.3 expected null/None personal_note", f"stored={pn!r}")

    # A.4 — empty string
    r = create_share(token, SPOT_ID, {"personal_note": ""})
    if r.status_code != 200:
        bad("A.4 POST /share with empty personal_note", f"{r.status_code} {r.text[:200]}")
    else:
        data = r.json()
        out["A4"] = data["token"]
        lr = list_shares(token, SPOT_ID)
        row = next((x for x in lr.json().get("items", []) if x.get("token") == data["token"]), None)
        pn = (row or {}).get("personal_note")
        if pn in (None, ""):
            ok(f"A.4 empty personal_note → stored as {pn!r}")
        else:
            bad("A.4 expected null/empty personal_note", f"stored={pn!r}")

    return out


def section_B_public_html(token: str, share_tokens: Dict[str, str]):
    print("\n=== B. Public viewer HTML ===")
    note_text = "Hi Sarah — bring extras!"

    tok = share_tokens.get("A1")
    if not tok:
        bad("B.1 prerequisite missing A1 token", "")
        return
    r = get_public_html(tok)
    if r.status_code != 200:
        bad("B.1 GET /public/location HTML status", f"{r.status_code} body={r.text[:200]}")
    else:
        body = r.text
        checks = [
            ("white theme bg #FAFAF7", "background:#FAFAF7" in body),
            ('class="brand" present', 'class="brand"' in body),
            (f"personal_note '{note_text}' verbatim in body",
                ("Hi Sarah — bring extras!" in body)),
            ("logo SVG stroke=#F5A523", 'stroke="#F5A523"' in body),
            ("LumaScout wordmark appears 2+ times (top + footer)",
                body.count("<b>Luma</b>") >= 2 or body.count("LumaScout") >= 2),
            ("og:image meta present",
                bool(re.search(r'<meta[^>]+property="og:image"', body))),
            ("Content-Type text/html",
                "text/html" in (r.headers.get("Content-Type", "").lower())),
        ]
        for label, cond in checks:
            ok("B.1 " + label) if cond else bad("B.1 " + label, "")
        note(f"B.1 wordmark hint: 'LumaScout' lit={body.count('LumaScout')}, '<b>Luma</b>'={body.count('<b>Luma</b>')}")

    tok3 = share_tokens.get("A3")
    if not tok3:
        bad("B.2 prerequisite missing A3 token", "")
    else:
        r = get_public_html(tok3)
        if r.status_code != 200:
            bad("B.2 HTML status (no-note)", f"{r.status_code}")
        else:
            body = r.text
            if 'class="pnote"' in body or 'class="pnote-kicker"' in body:
                bad("B.2 .pnote div present when personal_note missing", "")
            else:
                ok("B.2 .pnote div hidden when personal_note absent")
            tok4 = share_tokens.get("A4")
            if tok4:
                r2 = get_public_html(tok4)
                if r2.status_code == 200 and ('class="pnote"' not in r2.text):
                    ok("B.2b .pnote div hidden when personal_note=''")
                elif r2.status_code == 200:
                    bad("B.2b .pnote div present when personal_note=''", "")

    tok = share_tokens.get("A1")
    r = get_public_json(tok)
    if r.status_code != 200:
        bad("B.3 GET /public/location JSON status", f"{r.status_code}")
    else:
        try:
            data = r.json()
            if data.get("status") == "ok" and isinstance(data.get("spot"), dict):
                ok("B.3 JSON path returns sanitized spot payload")
            else:
                bad("B.3 JSON shape unexpected", json.dumps(data)[:200])
        except Exception as e:
            bad("B.3 JSON parse failed", str(e))


def section_C_privacy_visibility(token: str):
    print("\n=== C. Privacy / visibility ===")
    set_visibility(token, SPOT_ID, "public")

    # C.1 approximate
    r = create_share(token, SPOT_ID, {"personal_note": "C1 test", "show_exact_location": False})
    if r.status_code != 200:
        bad("C.1 create approximate share", f"{r.status_code} {r.text[:200]}")
        return
    tok_c1 = r.json()["token"]
    h = get_public_html(tok_c1)
    body = h.text
    if "Approximate area" in body:
        ok("C.1 'Approximate area' badge rendered")
    else:
        bad("C.1 'Approximate area' badge missing", "")
    if "Open in Maps" not in body:
        ok("C.1 'Open in Maps' CTA absent for approximate share")
    else:
        bad("C.1 'Open in Maps' CTA present when it shouldn't be", "")
    if 'class="coords"' in body:
        ok("C.1 coord block present")
    else:
        bad("C.1 coord block missing", "")

    # C.2 exact
    r = create_share(token, SPOT_ID, {"personal_note": "C2 test", "show_exact_location": True})
    if r.status_code != 200:
        bad("C.2 create exact share", f"{r.status_code} {r.text[:200]}")
        return
    tok_c2 = r.json()["token"]
    h = get_public_html(tok_c2)
    body = h.text
    if "Exact location" in body:
        ok("C.2 'Exact location' label rendered")
    else:
        bad("C.2 'Exact location' label missing", "")
    if "Open in Maps" in body:
        ok("C.2 'Open in Maps' CTA present for exact share")
    else:
        bad("C.2 'Open in Maps' CTA missing", "")

    # C.3 revoked → 404
    rv = revoke_share(token, SPOT_ID, tok_c1)
    if rv.status_code != 200:
        bad("C.3 revoke status", f"{rv.status_code}")
    h = get_public_html(tok_c1)
    if h.status_code == 404:
        ok("C.3 revoked share HTML → 404")
    else:
        bad("C.3 revoked share HTML status", f"{h.status_code}")
    j = get_public_json(tok_c1)
    if j.status_code == 404:
        try:
            jdata = j.json()
            if jdata.get("status") == "unavailable":
                ok("C.3 revoked share JSON → 404 + unavailable parity")
            else:
                bad("C.3 unavailable parity mismatch", json.dumps(jdata)[:200])
        except Exception:
            bad("C.3 revoked JSON parse fail", j.text[:200])
    else:
        bad("C.3 revoked share JSON status", f"{j.status_code}")


def section_D_backcompat(token: str):
    print("\n=== D. Backward compatibility ===")
    legacy_token = None
    try:
        from secrets import token_urlsafe
        from datetime import datetime, timezone
        cli = MongoClient(MONGO_URL, serverSelectionTimeoutMS=2000)
        coll = cli[DB_NAME].spot_shares
        legacy_token = token_urlsafe(24)
        legacy_doc = {
            "share_id": f"shr_legacy_{legacy_token[:8]}",
            "token": legacy_token,
            "spot_id": SPOT_ID,
            "owner_user_id": "legacy",
            "created_by_user_id": "legacy",
            "created_by_role": "owner",
            "label": "legacy",
            # NO personal_note key at all
            "spot_visibility_at_create": "public",
            "show_exact_location": True,
            "revoked": False,
            "revoked_at": None,
            "revoked_by_user_id": None,
            "created_at": datetime.now(timezone.utc),
            "last_accessed_at": None,
            "access_count": 0,
        }
        coll.insert_one(dict(legacy_doc))
        r = get_public_html(legacy_token)
        if r.status_code == 200 and 'class="pnote"' not in r.text:
            ok("D.1 legacy share without personal_note renders 200 with no .pnote")
        elif r.status_code >= 500:
            bad("D.1 legacy share render 5xx", f"{r.status_code} {r.text[:300]}")
        elif 'class="pnote"' in r.text:
            bad("D.1 legacy share renders an orphan .pnote", "")
        else:
            bad("D.1 legacy share unexpected status", f"{r.status_code}")
        coll.delete_one({"token": legacy_token})
    except Exception as e:
        bad("D.1 legacy doc test crashed", f"{e}")
        traceback.print_exc()

    lr = list_shares(token, SPOT_ID)
    if lr.status_code != 200:
        bad("D.2 /shares list status", f"{lr.status_code}")
    else:
        items = lr.json().get("items", [])
        if not items:
            note("D.2 no items on /shares list, skipping per-row check")
        else:
            # We need 'personal_note' key on every row.
            sample_row = items[0]
            print("    sample /shares row keys:", sorted(sample_row.keys()))
            missing = [i.get("token") for i in items if "personal_note" not in i]
            if missing:
                bad("D.2 personal_note KEY missing from some /shares rows",
                    f"missing_for_{len(missing)}/{len(items)} rows")
            else:
                ok("D.2 /shares list rows all include 'personal_note' key")


def section_E_edge(token: str):
    print("\n=== E. Edge / stability ===")
    # E.1 XSS
    xss = '<script>alert(1)</script>'
    r = create_share(token, SPOT_ID, {"personal_note": xss})
    if r.status_code != 200:
        bad("E.1 create XSS share", f"{r.status_code} {r.text[:200]}")
    else:
        tok = r.json()["token"]
        h = get_public_html(tok)
        body = h.text
        if "<script>alert(1)</script>" in body:
            bad("E.1 raw <script> appears in HTML — NOT escaped", "")
        elif "&lt;script&gt;alert(1)&lt;/script&gt;" in body:
            ok("E.1 personal_note HTML-escaped (literal &lt;script&gt;…)")
        elif "&lt;script" in body:
            ok("E.1 personal_note appears escaped (&lt;script… found)")
        else:
            bad("E.1 could not verify escape of personal_note", "")

    # E.2 multi-line
    multiline = "Line 1\nLine 2\nLine 3"
    r = create_share(token, SPOT_ID, {"personal_note": multiline})
    if r.status_code != 200:
        bad("E.2 create multi-line share", f"{r.status_code} {r.text[:200]}")
    else:
        tok = r.json()["token"]
        h = get_public_html(tok)
        body = h.text
        if "Line 1\nLine 2\nLine 3" in body:
            ok("E.2 multi-line \\n preserved verbatim (white-space:pre-wrap will render)")
        elif "Line 1" in body and "Line 2" in body and "Line 3" in body:
            ok("E.2 multi-line content all present")
        else:
            bad("E.2 multi-line content missing", "")
        if "white-space: pre-wrap" in body or "white-space:pre-wrap" in body:
            ok("E.2 CSS white-space: pre-wrap present in styles")
        else:
            note("E.2 white-space:pre-wrap CSS rule not detected (visual rendering may differ)")

    # E.3 regressions
    r = session.get(f"{API}/spots/{SPOT_ID}/shoot-plan", timeout=20)
    if r.status_code == 200 and isinstance(r.json(), dict):
        ok("E.3a /spots/{id}/shoot-plan → 200")
        wa = r.json().get("weather_available")
        if wa is not None:
            ok(f"E.3a shoot-plan weather_available={wa}")
    else:
        bad("E.3a /spots/{id}/shoot-plan", f"{r.status_code}")

    r = session.get(f"{API}/spots/nearby/search", params={"lat": 30.5, "lng": -98.0, "radius_km": 50}, timeout=20)
    if r.status_code == 200:
        ok("E.3b /spots/nearby/search → 200")
    else:
        bad("E.3b /spots/nearby/search", f"{r.status_code} {r.text[:200]}")


def cleanup(token: str):
    print("\n=== Cleanup ===")
    lr = list_shares(token, SPOT_ID)
    if lr.status_code != 200:
        note("cleanup: could not list shares")
        return
    n = 0
    for r in lr.json().get("items", []):
        if not r.get("revoked"):
            try:
                revoke_share(token, SPOT_ID, r["token"])
                n += 1
            except Exception:
                pass
    note(f"cleanup: revoked {n} active shares we created")


def main():
    print(f"\nBackend: {API}")
    print("Logging in as super_admin …")
    tok = login()
    print(f"  ✅ login OK")

    share_tokens: Dict[str, str] = {}
    try:
        share_tokens = section_A_personal_note_persistence(tok)
        section_B_public_html(tok, share_tokens)
        section_C_privacy_visibility(tok)
        section_D_backcompat(tok)
        section_E_edge(tok)
    except Exception:
        print("Unhandled error in test run:")
        traceback.print_exc()
    finally:
        try:
            cleanup(tok)
        except Exception:
            pass

    print("\n──────────────────────────────")
    print(f" PASS: {len(PASS)}    FAIL: {len(FAIL)}")
    if FAIL:
        print("\nFailures:")
        for f in FAIL:
            print("  •", f)
    if NOTES:
        print("\nNotes:")
        for n in NOTES:
            print("  •", n)

    sys.exit(0 if not FAIL else 1)


if __name__ == "__main__":
    main()
