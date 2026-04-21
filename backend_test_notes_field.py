"""
Surgical backend validation for SpotCreateIn.notes (Bucket A / Commit 3).
Tests POST /api/spots and GET /api/spots/{id} only.
"""
import os
import sys
import json
import requests

BASE = "http://localhost:8001/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} :: {detail[:300]}")


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j.get("token")


def make_spot_body(**overrides):
    body = {
        "title": "QA Notes Field Spot",
        "latitude": 30.2672,
        "longitude": -97.7431,
        "city": "Austin",
        "state": "TX",
        "images": [],
        "privacy_mode": "private",  # keeps out of public indexes and avoids moderation queue
        "save_as_draft": True,
    }
    body.update(overrides)
    return body


def create_spot(token, body):
    r = requests.post(
        f"{BASE}/spots",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    return r


def get_spot(token, spot_id):
    r = requests.get(
        f"{BASE}/spots/{spot_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    return r


def delete_spot(token, spot_id, reason_code="qa_cleanup", reason_note="Automated notes field test cleanup"):
    try:
        r = requests.request(
            "DELETE",
            f"{BASE}/admin/spots/{spot_id}",
            json={"reason_code": reason_code, "reason_note": reason_note},
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        return r.status_code
    except Exception as e:
        return f"err:{e}"


def main():
    print("Logging in as super_admin...")
    try:
        token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    except Exception as e:
        print(f"FATAL: login failed: {e}")
        sys.exit(1)
    print("Login OK.")

    created_ids = []

    # ---- Subtest 1: Whitespace stripped happy path ----
    try:
        body = make_spot_body(notes="  Parking fills up by 7am. Gate code 1234.  ")
        r = create_spot(token, body)
        if r.status_code != 200:
            record("1. POST notes with whitespace (200)", False, f"status={r.status_code} body={r.text[:200]}")
        else:
            sid = r.json().get("spot_id")
            created_ids.append(sid)
            # notes should already appear on POST response too
            post_notes = r.json().get("notes")
            # GET back
            g = get_spot(token, sid)
            if g.status_code != 200:
                record("1. GET back spot (200)", False, f"status={g.status_code}")
            else:
                got_notes = g.json().get("notes")
                expected = "Parking fills up by 7am. Gate code 1234."
                ok = got_notes == expected
                record("1. Whitespace stripped on GET", ok, f"POST.notes={post_notes!r} GET.notes={got_notes!r} expected={expected!r}")
    except Exception as e:
        record("1. whitespace stripped happy path", False, f"exc={e}")

    # ---- Subtest 2: empty string -> null ----
    try:
        body = make_spot_body(notes="")
        r = create_spot(token, body)
        if r.status_code != 200:
            record("2. POST notes='' (200)", False, f"status={r.status_code} body={r.text[:200]}")
        else:
            sid = r.json().get("spot_id")
            created_ids.append(sid)
            g = get_spot(token, sid)
            got_notes = g.json().get("notes", "__MISSING__")
            ok = got_notes is None or got_notes == "__MISSING__"
            record("2. Empty string -> null/absent", ok, f"GET.notes={got_notes!r}")
    except Exception as e:
        record("2. empty string", False, f"exc={e}")

    # ---- Subtest 3: whitespace-only -> null ----
    try:
        body = make_spot_body(notes="   \n\t  ")
        r = create_spot(token, body)
        if r.status_code != 200:
            record("3. POST notes whitespace-only (200)", False, f"status={r.status_code} body={r.text[:200]}")
        else:
            sid = r.json().get("spot_id")
            created_ids.append(sid)
            g = get_spot(token, sid)
            got_notes = g.json().get("notes", "__MISSING__")
            ok = got_notes is None or got_notes == "__MISSING__"
            record("3. Whitespace-only -> null/absent", ok, f"GET.notes={got_notes!r}")
    except Exception as e:
        record("3. whitespace-only", False, f"exc={e}")

    # ---- Subtest 4: field omitted entirely -> null ----
    try:
        body = make_spot_body()  # no notes key
        assert "notes" not in body
        r = create_spot(token, body)
        if r.status_code != 200:
            record("4. POST without notes key (200)", False, f"status={r.status_code} body={r.text[:200]}")
        else:
            sid = r.json().get("spot_id")
            created_ids.append(sid)
            g = get_spot(token, sid)
            got_notes = g.json().get("notes", "__MISSING__")
            ok = got_notes is None or got_notes == "__MISSING__"
            record("4. Omitted notes -> null/absent (backward compat)", ok, f"GET.notes={got_notes!r}")
    except Exception as e:
        record("4. omitted notes", False, f"exc={e}")

    # ---- Subtest 5a: 2001 chars -> 422 ----
    try:
        body = make_spot_body(notes="x" * 2001)
        r = create_spot(token, body)
        if r.status_code != 422:
            record("5a. 2001 chars -> 422", False, f"status={r.status_code} body={r.text[:300]}")
        else:
            txt = r.text
            ok_msg = "Notes must be 2000 characters or fewer." in txt
            record("5a. 2001 chars -> 422 with expected message", ok_msg, f"body={txt[:300]}")
    except Exception as e:
        record("5a. 2001 chars", False, f"exc={e}")

    # ---- Subtest 5b: exactly 2000 chars -> 200 ----
    try:
        body = make_spot_body(notes="x" * 2000)
        r = create_spot(token, body)
        if r.status_code != 200:
            record("5b. 2000 chars -> 200", False, f"status={r.status_code} body={r.text[:300]}")
        else:
            sid = r.json().get("spot_id")
            created_ids.append(sid)
            g = get_spot(token, sid)
            got_notes = g.json().get("notes", "")
            ok_len = isinstance(got_notes, str) and len(got_notes) == 2000
            record("5b. 2000 chars -> 200 and persisted exactly 2000", ok_len, f"len(GET.notes)={len(got_notes) if isinstance(got_notes,str) else None}")
    except Exception as e:
        record("5b. 2000 chars", False, f"exc={e}")

    # ---- Subtest 6: Surfacing on GET when populated ----
    try:
        body = make_spot_body(notes="Visible on GET — golden-hour checkpoint at the south overlook.")
        r = create_spot(token, body)
        if r.status_code != 200:
            record("6. Create populated notes spot", False, f"status={r.status_code}")
        else:
            sid = r.json().get("spot_id")
            created_ids.append(sid)
            g = get_spot(token, sid)
            got_notes = g.json().get("notes")
            ok = got_notes == "Visible on GET — golden-hour checkpoint at the south overlook."
            record("6. Notes surfaced in GET /api/spots/{id}", ok, f"GET.notes={got_notes!r}")
    except Exception as e:
        record("6. surfacing on GET", False, f"exc={e}")

    # ---- Cleanup: delete all created spots via super_admin DELETE ----
    print("\nCleanup — deleting created test spots...")
    for sid in created_ids:
        if sid:
            code = delete_spot(token, sid)
            print(f"  deleted {sid} -> {code}")

    # ---- Summary ----
    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print("\n" + "=" * 70)
    print(f"RESULT: {passed}/{total} subtests passed")
    print("=" * 70)
    for name, ok, detail in results:
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}")
    # Exit nonzero if any failed
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
