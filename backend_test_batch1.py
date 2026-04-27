#!/usr/bin/env python3
"""
Batch 1 backend stability tests for LumaScout pre-release audit.

Tests:
  A. Coordinate validation on POST /api/spots
  B. Existing spot flows (list/detail/save/unsave)
  C. DM analytics (network.py duplicate-key fix)
"""
import os
import sys
import json
import requests
from typing import Any, Dict

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASS = "admin123"

results = []
created_spot_ids = []


def log(label: str, ok: bool, detail: str = ""):
    icon = "PASS" if ok else "FAIL"
    print(f"[{icon}] {label}")
    if detail:
        print(f"        {detail}")
    results.append({"label": label, "ok": ok, "detail": detail})


def get_admin_token() -> str:
    r = requests.post(f"{BASE}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
                      timeout=15)
    r.raise_for_status()
    j = r.json()
    return j["token"]


def main():
    print("=" * 78)
    print(f"Batch 1 stability tests against {BASE}")
    print("=" * 78)

    try:
        token = get_admin_token()
    except Exception as e:
        log("Login admin", False, f"login failed: {e}")
        return _summary()
    log("Login admin", True, f"got token len={len(token)}")
    H = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    base_spot = {
        "title": "Batch1 QA — Austin Capitol",
        "description": "QA test spot for coordinate validator audit",
        "city": "Austin",
        "state": "TX",
        "country": "USA",
        "privacy_mode": "private",  # keep out of feed/moderation
        "shoot_types": ["landscape"],
        "style_tags": [],
        "images": [],
    }

    # ---------- A1: Valid spot ----------
    payload = dict(base_spot, latitude=30.2672, longitude=-97.7431,
                   title="Batch1 QA — Austin Capitol Valid")
    r = requests.post(f"{BASE}/spots", headers=H, json=payload, timeout=20)
    a1_spot_id = None
    if r.status_code == 200:
        body = r.json()
        a1_spot_id = body.get("spot_id")
        if a1_spot_id:
            created_spot_ids.append(a1_spot_id)
        log("A1 valid spot (Austin TX)", True,
            f"200, spot_id={a1_spot_id}, lat={body.get('latitude')}, "
            f"lng={body.get('longitude')}")
    else:
        log("A1 valid spot (Austin TX)", False,
            f"{r.status_code} body={r.text[:300]}")

    # ---------- A2: Null Island ----------
    payload = dict(base_spot, latitude=0.0, longitude=0.0,
                   title="Batch1 QA — Null Island")
    r = requests.post(f"{BASE}/spots", headers=H, json=payload, timeout=20)
    if r.status_code == 422:
        # Check the friendly message presence
        try:
            errs = r.json().get("detail") or []
            msgs = " ".join(json.dumps(e) for e in errs) if isinstance(errs, list) else json.dumps(errs)
        except Exception:
            msgs = r.text
        has_friendly = "refresh GPS" in msgs or "pin the location" in msgs or "Invalid coordinates" in msgs
        log("A2 Null Island (0,0) → 422 with friendly msg", has_friendly,
            f"422; msg snippet={msgs[:300]}")
    else:
        log("A2 Null Island (0,0) → 422", False,
            f"got {r.status_code}, body={r.text[:300]}")

    # ---------- A3: Out-of-range latitude ----------
    payload = dict(base_spot, latitude=91.0, longitude=-97.0,
                   title="Batch1 QA — Lat OOR")
    r = requests.post(f"{BASE}/spots", headers=H, json=payload, timeout=20)
    if r.status_code == 422:
        try:
            errs = r.json().get("detail") or []
            msgs = " ".join(json.dumps(e) for e in errs) if isinstance(errs, list) else json.dumps(errs)
        except Exception:
            msgs = r.text
        ok = "between -90 and 90" in msgs
        log("A3 Latitude 91.0 → 422 mentions '-90 and 90'", ok,
            f"422; msg snippet={msgs[:300]}")
    else:
        log("A3 Latitude 91.0 → 422", False,
            f"got {r.status_code}, body={r.text[:300]}")

    # ---------- A4: Out-of-range longitude ----------
    payload = dict(base_spot, latitude=30.0, longitude=181.0,
                   title="Batch1 QA — Lng OOR")
    r = requests.post(f"{BASE}/spots", headers=H, json=payload, timeout=20)
    if r.status_code == 422:
        try:
            errs = r.json().get("detail") or []
            msgs = " ".join(json.dumps(e) for e in errs) if isinstance(errs, list) else json.dumps(errs)
        except Exception:
            msgs = r.text
        ok = "between -180 and 180" in msgs
        log("A4 Longitude 181.0 → 422 mentions '-180 and 180'", ok,
            f"422; msg snippet={msgs[:300]}")
    else:
        log("A4 Longitude 181.0 → 422", False,
            f"got {r.status_code}, body={r.text[:300]}")

    # ---------- A5: Tiny-but-nonzero coords ----------
    payload = dict(base_spot, latitude=0.00001, longitude=-0.00001,
                   title="Batch1 QA — tiny coords")
    r = requests.post(f"{BASE}/spots", headers=H, json=payload, timeout=20)
    # The validator at line 164 rejects abs(v) < 1e-6. 0.00001 = 1e-5 > 1e-6, so it
    # should PASS validation (the second validator at line 201 also rejects only
    # v == 0.0 exactly). Per the review request parenthetical, the "|v|<1e-6 only
    # rejects exactly-zero-ish" wording confirms that 0.00001 is expected to pass.
    # We capture whichever behaviour is observed and report it explicitly.
    if r.status_code == 200:
        body = r.json()
        sid = body.get("spot_id")
        if sid:
            created_spot_ids.append(sid)
        log("A5 Tiny coords (0.00001) — actual behaviour",
            True, f"200 (passed validator); spot_id={sid}. "
            f"Note: review request parenthetical predicted this; if rejection "
            f"is desired, raise the threshold above 1e-5.")
    elif r.status_code == 422:
        try:
            errs = r.json().get("detail") or []
            msgs = " ".join(json.dumps(e) for e in errs) if isinstance(errs, list) else json.dumps(errs)
        except Exception:
            msgs = r.text
        log("A5 Tiny coords (0.00001) — actual behaviour",
            True, f"422 rejected; msg={msgs[:300]}")
    else:
        log("A5 Tiny coords (0.00001) — unexpected status",
            False, f"{r.status_code} body={r.text[:300]}")

    # ---------- A6: Auth check (no token) ----------
    payload = dict(base_spot, latitude=30.2672, longitude=-97.7431,
                   title="Batch1 QA — no auth")
    r = requests.post(f"{BASE}/spots",
                      headers={"Content-Type": "application/json"},
                      json=payload, timeout=20)
    ok = r.status_code in (401, 403)
    log("A6 POST without bearer → 401/403 (not 500)", ok,
        f"got {r.status_code}; body={r.text[:200]}")

    # ===========================================================================
    # B. Existing spot flows
    # ===========================================================================
    # B7: list spots
    r = requests.get(f"{BASE}/spots?limit=5", timeout=15)
    log("B7 GET /spots?limit=5", r.status_code == 200,
        f"{r.status_code}; bytes={len(r.content)}")

    # B8/9/10 require the spot from A1
    if a1_spot_id:
        # B8 detail
        r = requests.get(f"{BASE}/spots/{a1_spot_id}", headers=H, timeout=15)
        log(f"B8 GET /spots/{a1_spot_id}", r.status_code == 200,
            f"{r.status_code}")

        # B9 save
        r = requests.post(f"{BASE}/spots/{a1_spot_id}/save",
                          headers=H, timeout=15)
        if r.status_code == 200 and r.json().get("saved") is True:
            log(f"B9 POST /spots/{a1_spot_id}/save", True, "saved=true")
        else:
            log(f"B9 POST /spots/{a1_spot_id}/save", False,
                f"{r.status_code} body={r.text[:200]}")

        # B10 unsave (toggle endpoint — call again)
        r = requests.post(f"{BASE}/spots/{a1_spot_id}/save",
                          headers=H, timeout=15)
        if r.status_code == 200 and r.json().get("saved") is False:
            log(f"B10 POST /spots/{a1_spot_id}/save (toggle off)", True,
                "saved=false")
        else:
            log(f"B10 POST /spots/{a1_spot_id}/save (toggle off)", False,
                f"{r.status_code} body={r.text[:200]}")
    else:
        log("B8/B9/B10 skipped — A1 did not produce a spot_id", False,
            "no spot_id from valid create")

    # ===========================================================================
    # C. DM analytics (network.py fix — duplicate last_message_at key)
    # ===========================================================================
    # The fix is in /api/me/analytics/networking — the threads_active query
    # used to have {"last_message_at": {"$ne": None}} overwritten by
    # {"last_message_at": {"$gte": cutoff}}. Now combined.
    r = requests.get(f"{BASE}/me/analytics/networking?since_days=30",
                     headers=H, timeout=20)
    if r.status_code == 200:
        try:
            j = r.json()
            ta = j.get("active_threads")
            if isinstance(ta, int):
                log("C11 GET /me/analytics/networking → active_threads int",
                    True, f"active_threads={ta}, plan={j.get('plan')}")
            else:
                log("C11 GET /me/analytics/networking → active_threads int",
                    False, f"active_threads is not int: {ta!r}")
        except Exception as e:
            log("C11 GET /me/analytics/networking", False,
                f"json parse failed: {e}; body={r.text[:300]}")
    else:
        log("C11 GET /me/analytics/networking", False,
            f"{r.status_code} body={r.text[:400]}")

    # C12: list threads
    r = requests.get(f"{BASE}/dm/threads?tab=all&limit=5",
                     headers=H, timeout=15)
    if r.status_code == 200:
        try:
            j = r.json()
            log("C12 GET /dm/threads?tab=all", True,
                f"items={len(j.get('items', []))}, tab={j.get('tab')}")
        except Exception as e:
            log("C12 GET /dm/threads?tab=all", False, f"parse error: {e}")
    else:
        log("C12 GET /dm/threads?tab=all", False,
            f"{r.status_code} body={r.text[:300]}")

    # ===========================================================================
    # Cleanup
    # ===========================================================================
    print()
    print("Cleanup — deleting created spots:", created_spot_ids)
    for sid in created_spot_ids:
        try:
            r = requests.delete(f"{BASE}/spots/{sid}", headers=H, timeout=15)
            print(f"  DELETE /spots/{sid} → {r.status_code}")
        except Exception as e:
            print(f"  DELETE /spots/{sid} → ERR {e}")

    return _summary()


def _summary():
    print()
    print("=" * 78)
    print("SUMMARY")
    print("=" * 78)
    passes = sum(1 for r in results if r["ok"])
    fails = sum(1 for r in results if not r["ok"])
    for r in results:
        icon = "PASS" if r["ok"] else "FAIL"
        print(f"  [{icon}] {r['label']}")
    print()
    print(f"Total: {passes} pass / {fails} fail / {len(results)} total")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
