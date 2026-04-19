"""
PhotoScout — Flexible Location Entry backend tests.
Validates:
  1) POST /api/spots save_as_draft behavior
  2) GET /api/geocode/search
  3) GET /api/geocode/reverse
  4) GET /api/me/recent-locations (with dedup)
  5) GET /api/me/drafts (owner-scoped)
  6) POST /api/spots/{id}/publish-draft (owner only, idempotency)
"""
import os
import sys
import time
import json
import requests

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
SOPHIE = {"email": "sophie@photoscout.app", "password": "demo123"}
ADMIN = {"email": "admin@photoscout.app", "password": "admin123"}

results = []  # list of (task_name, case, passed, detail)


def record(task, case, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] {task} :: {case} — {detail}")
    results.append((task, case, passed, detail))


def login(creds):
    r = requests.post(f"{BASE}/auth/login", json=creds, timeout=15)
    r.raise_for_status()
    data = r.json()
    return data["token"], data["user"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def create_spot(token, body):
    r = requests.post(f"{BASE}/spots", json=body, headers=auth_headers(token), timeout=20)
    return r


def delete_spot(token, spot_id):
    try:
        requests.delete(f"{BASE}/spots/{spot_id}", headers=auth_headers(token), timeout=15)
    except Exception:
        pass


# ---------------------------------------------------------------------------
def main():
    print(f"Testing against {BASE}\n")

    # Login
    try:
        sophie_tok, sophie_user = login(SOPHIE)
        admin_tok, admin_user = login(ADMIN)
        print(f"Sophie verification_status={sophie_user.get('verification_status')} plan={sophie_user.get('plan')}")
    except Exception as e:
        record("auth", "login sophie/admin", False, f"login failed: {e}")
        return False

    created_spot_ids = []  # (token, spot_id)

    # ======================================================================
    # Task: POST /api/spots save_as_draft
    # ======================================================================
    TASK1 = "POST /api/spots save_as_draft"
    base_body = {
        "title": "Draft Test Public",
        "latitude": 30.27,
        "longitude": -97.74,
        "city": "Austin",
        "state": "TX",
        "privacy_mode": "public",
        "save_as_draft": True,
        "source_type": "manual_entry",
        "original_search_query": "McAllister",
        "images": [],
    }

    # 1A — public + draft
    draft_id_1a = None
    r = create_spot(sophie_tok, base_body)
    if r.status_code != 200:
        record(TASK1, "1A status 200", False, f"got {r.status_code}: {r.text[:200]}")
    else:
        body = r.json()
        draft_id_1a = body.get("spot_id")
        created_spot_ids.append((sophie_tok, draft_id_1a))
        ok = body.get("visibility_status") == "draft"
        record(TASK1, "1A visibility_status=='draft'", ok, f"got {body.get('visibility_status')}")
        record(TASK1, "1A source_type preserved", body.get("source_type") == "manual_entry",
               f"got {body.get('source_type')}")
        record(TASK1, "1A original_search_query preserved",
               body.get("original_search_query") == "McAllister", f"got {body.get('original_search_query')}")
        record(TASK1, "1A response has NO save_as_draft field",
               "save_as_draft" not in body, f"save_as_draft present? {('save_as_draft' in body)}")

    # 1B — private + draft
    body_1b = dict(base_body)
    body_1b["title"] = "Draft Test Private"
    body_1b["privacy_mode"] = "private"
    r = create_spot(sophie_tok, body_1b)
    if r.status_code != 200:
        record(TASK1, "1B status 200", False, f"got {r.status_code}: {r.text[:200]}")
    else:
        b = r.json()
        created_spot_ids.append((sophie_tok, b.get("spot_id")))
        record(TASK1, "1B visibility_status=='draft' for private draft",
               b.get("visibility_status") == "draft", f"got {b.get('visibility_status')}")

    # 1C — public + NOT draft
    body_1c = dict(base_body)
    body_1c["title"] = "Published Test Public"
    body_1c["save_as_draft"] = False
    r = create_spot(sophie_tok, body_1c)
    if r.status_code != 200:
        record(TASK1, "1C status 200", False, f"got {r.status_code}: {r.text[:200]}")
    else:
        b = r.json()
        created_spot_ids.append((sophie_tok, b.get("spot_id")))
        vs = b.get("visibility_status")
        record(TASK1, "1C visibility_status in {pending_review, approved}",
               vs in ("pending_review", "approved"), f"got {vs}")

    # ======================================================================
    # Task: GET /api/geocode/search
    # ======================================================================
    TASK2 = "GET /api/geocode/search"

    # 2A — empty
    r = requests.get(f"{BASE}/geocode/search", params={"q": ""}, timeout=12)
    if r.status_code != 200:
        record(TASK2, "2A q='' returns 200 empty", False, f"got {r.status_code}")
    else:
        record(TASK2, "2A q='' returns results:[]", r.json().get("results") == [],
               f"got {r.json().get('results')}")

    # 2B — 1 char
    r = requests.get(f"{BASE}/geocode/search", params={"q": "a"}, timeout=12)
    if r.status_code != 200:
        record(TASK2, "2B q='a' returns 200 empty", False, f"got {r.status_code}")
    else:
        record(TASK2, "2B q='a' returns results:[]", r.json().get("results") == [],
               f"got {r.json().get('results')}")

    # 2C — McAllister Park
    r = requests.get(f"{BASE}/geocode/search", params={"q": "McAllister Park"}, timeout=12)
    if r.status_code != 200:
        record(TASK2, "2C q='McAllister Park' status 200", False, f"got {r.status_code}")
    else:
        j = r.json()
        results_list = j.get("results", [])
        if j.get("error"):
            record(TASK2, "2C graceful degradation on Nominatim error", True,
                   f"error={j.get('error')}")
        elif not results_list:
            record(TASK2, "2C results.length >= 1", False, "empty and no error field")
        else:
            first = results_list[0]
            checks = [
                ("latitude float non-null",
                 isinstance(first.get("latitude"), (int, float)) and first.get("latitude") is not None),
                ("longitude float non-null",
                 isinstance(first.get("longitude"), (int, float)) and first.get("longitude") is not None),
                ("city non-empty string",
                 isinstance(first.get("city"), str) and len(first.get("city")) > 0),
                ("state non-empty string",
                 isinstance(first.get("state"), str) and len(first.get("state")) > 0),
                ("confidence number 0..1",
                 isinstance(first.get("confidence"), (int, float)) and 0 <= first.get("confidence") <= 1),
                ("place_id non-empty",
                 isinstance(first.get("place_id"), str) and len(first.get("place_id")) > 0),
                ("display_name non-empty",
                 isinstance(first.get("display_name"), str) and len(first.get("display_name")) > 0),
            ]
            for name, ok in checks:
                record(TASK2, f"2C first result {name}", bool(ok), f"first={json.dumps(first)[:250]}")

    time.sleep(1.2)  # be polite to Nominatim

    # 2D — limit clamped
    r = requests.get(f"{BASE}/geocode/search", params={"q": "Austin", "limit": 20}, timeout=12)
    if r.status_code != 200:
        record(TASK2, "2D limit=20 status 200", False, f"got {r.status_code}")
    else:
        j = r.json()
        items = j.get("results", [])
        record(TASK2, "2D results length <= 15 (clamped)", len(items) <= 15,
               f"got len={len(items)} error={j.get('error')}")

    time.sleep(1.2)

    # ======================================================================
    # Task: GET /api/geocode/reverse
    # ======================================================================
    TASK3 = "GET /api/geocode/reverse"
    r = requests.get(f"{BASE}/geocode/reverse", params={"lat": 30.2672, "lng": -97.7431}, timeout=12)
    if r.status_code != 200:
        record(TASK3, "reverse lat/lng status 200", False, f"got {r.status_code}")
    else:
        j = r.json()
        if j.get("error"):
            record(TASK3, "reverse graceful degradation", True, f"error={j.get('error')}")
        else:
            city = (j.get("city") or "")
            display = (j.get("display_name") or "")
            state = (j.get("state") or "")
            ok_loc = (
                "austin" in city.lower()
                or "austin" in display.lower()
                or "texas" in display.lower()
            )
            record(TASK3, "reverse Austin/Texas detected",
                   ok_loc, f"city={city} state={state} display={display[:120]}")
            record(TASK3, "reverse state non-empty", len(state) > 0, f"state={state}")

    # ======================================================================
    # Task: GET /api/me/recent-locations
    # ======================================================================
    TASK4 = "GET /api/me/recent-locations"
    r = requests.get(f"{BASE}/me/recent-locations", headers=auth_headers(sophie_tok), timeout=15)
    if r.status_code != 200:
        record(TASK4, "4A default status 200", False, f"got {r.status_code}: {r.text[:200]}")
    else:
        j = r.json()
        record(TASK4, "4A has count+items keys",
               "count" in j and "items" in j, f"keys={list(j.keys())}")
        items = j.get("items", [])
        if items:
            first = items[0]
            needed = {"title", "city", "state", "latitude", "longitude"}
            missing = [k for k in needed if k not in first]
            record(TASK4, "4A item has title/city/state/latitude/longitude",
                   not missing, f"missing={missing} first={json.dumps(first, default=str)[:200]}")
        else:
            record(TASK4, "4A items non-empty (sophie should have spots)", False, "items=[]")

    # 4B — limit clamp to 30
    r = requests.get(f"{BASE}/me/recent-locations", params={"limit": 50},
                     headers=auth_headers(sophie_tok), timeout=15)
    if r.status_code != 200:
        record(TASK4, "4B limit=50 status 200", False, f"got {r.status_code}")
    else:
        j = r.json()
        record(TASK4, "4B items length <= 30",
               len(j.get("items", [])) <= 30, f"len={len(j.get('items', []))}")

    # 4C — dedup
    dedup_body = dict(base_body)
    dedup_body["title"] = "Dedup Sibling"
    dedup_body["save_as_draft"] = False
    r = create_spot(sophie_tok, dedup_body)
    dedup_spot_id = None
    if r.status_code == 200:
        dedup_spot_id = r.json().get("spot_id")
        created_spot_ids.append((sophie_tok, dedup_spot_id))
    else:
        record(TASK4, "4C create dedup sibling", False, f"got {r.status_code}: {r.text[:200]}")

    r = requests.get(f"{BASE}/me/recent-locations", headers=auth_headers(sophie_tok), timeout=15)
    if r.status_code == 200:
        j = r.json()
        items = j.get("items", [])
        match = [
            it for it in items
            if round(it.get("latitude", 0), 3) == round(30.27, 3)
            and round(it.get("longitude", 0), 3) == round(-97.74, 3)
            and (it.get("city") or "").lower() == "austin"
        ]
        record(TASK4, "4C dedup — same lat/lng/city appears only once",
               len(match) == 1, f"matched={len(match)}")

    # ======================================================================
    # Task: GET /api/me/drafts
    # ======================================================================
    TASK5 = "GET /api/me/drafts"
    r = requests.get(f"{BASE}/me/drafts", headers=auth_headers(sophie_tok), timeout=15)
    if r.status_code != 200:
        record(TASK5, "sophie drafts status 200", False, f"got {r.status_code}: {r.text[:200]}")
    else:
        drafts = r.json()
        ids = [d.get("spot_id") for d in drafts]
        record(TASK5, "sophie draft includes 1A spot_id",
               draft_id_1a in ids, f"looking_for={draft_id_1a} got_ids={ids[:5]}")
        all_draft = all(d.get("visibility_status") == "draft" for d in drafts)
        record(TASK5, "sophie drafts all visibility_status=='draft'", all_draft,
               f"statuses={[d.get('visibility_status') for d in drafts][:5]}")

    # admin drafts — should not include sophie's draft
    r = requests.get(f"{BASE}/me/drafts", headers=auth_headers(admin_tok), timeout=15)
    if r.status_code != 200:
        record(TASK5, "admin drafts status 200", False, f"got {r.status_code}")
    else:
        admin_drafts = r.json()
        ids = [d.get("spot_id") for d in admin_drafts]
        record(TASK5, "admin /me/drafts does NOT include sophie's 1A draft",
               draft_id_1a not in ids, f"admin_ids={ids[:5]}")

    # ======================================================================
    # Task: POST /api/spots/{id}/publish-draft
    # ======================================================================
    TASK6 = "POST /api/spots/{id}/publish-draft"
    if draft_id_1a:
        r = requests.post(f"{BASE}/spots/{draft_id_1a}/publish-draft",
                          headers=auth_headers(sophie_tok), timeout=15)
        if r.status_code != 200:
            record(TASK6, "6A owner publish 200", False, f"got {r.status_code}: {r.text[:200]}")
        else:
            j = r.json()
            record(TASK6, "6A response ok:true + visibility_status in {pending_review,approved}",
                   j.get("ok") is True and j.get("visibility_status") in ("pending_review", "approved"),
                   f"got {j}")

        r = requests.post(f"{BASE}/spots/{draft_id_1a}/publish-draft",
                          headers=auth_headers(sophie_tok), timeout=15)
        record(TASK6, "6B re-publish returns 400 'Not a draft'",
               r.status_code == 400, f"got {r.status_code}: {r.text[:150]}")

    # 6C — admin tries to publish sophie's NEW draft
    sophie_new_draft_id = None
    body_6c = dict(base_body)
    body_6c["title"] = "Draft For 6C"
    r = create_spot(sophie_tok, body_6c)
    if r.status_code == 200:
        sophie_new_draft_id = r.json().get("spot_id")
        created_spot_ids.append((sophie_tok, sophie_new_draft_id))
        r2 = requests.post(f"{BASE}/spots/{sophie_new_draft_id}/publish-draft",
                           headers=auth_headers(admin_tok), timeout=15)
        record(TASK6, "6C admin publishing sophie's draft → 403",
               r2.status_code == 403, f"got {r2.status_code}: {r2.text[:150]}")
    else:
        record(TASK6, "6C setup: create sophie draft", False, f"{r.status_code}: {r.text[:200]}")

    # 6D — non-existent id
    r = requests.post(f"{BASE}/spots/nonexistent_id/publish-draft",
                      headers=auth_headers(sophie_tok), timeout=15)
    record(TASK6, "6D publish nonexistent_id → 404",
           r.status_code == 404, f"got {r.status_code}: {r.text[:150]}")

    # Cleanup
    print("\n--- Cleanup ---")
    for tok, sid in created_spot_ids:
        if sid:
            delete_spot(tok, sid)
            print(f"deleted {sid}")

    # Summary
    print("\n\n========= SUMMARY =========")
    by_task = {}
    for task, case, ok, detail in results:
        by_task.setdefault(task, []).append((case, ok, detail))
    total_pass = sum(1 for _, _, ok, _ in results if ok)
    total = len(results)
    for task, cases in by_task.items():
        p = sum(1 for _, ok, _ in cases if ok)
        print(f"\n{task}: {p}/{len(cases)}")
        for case, ok, detail in cases:
            if not ok:
                print(f"   FAIL: {case} — {detail}")
    print(f"\nTOTAL: {total_pass}/{total} checks passed")
    return total_pass == total


if __name__ == "__main__":
    try:
        ok = main()
        sys.exit(0 if ok else 1)
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(2)
