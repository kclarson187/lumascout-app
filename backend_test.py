"""
Backend test for the May 2026 production-520 hardening of
POST /api/auth/google/session on LumaScout.

Verifies error taxonomy:
  • Missing session_id → 400 (or 422 from Pydantic) — body is JSON
  • Empty-string session_id → 400 with detail "Missing session id"
  • Invalid session_id → 401 with detail "Invalid session"
  • All responses are valid JSON with string `detail`, no HTML leakage
  • Email/password login + /auth/me regression smoke
  • /api/spots and /api/spots/markers regression smoke
  • Backend log captures structured `auth.google` log lines
"""
import json
import re
import subprocess
import time

import requests

BASE = "https://photo-finder-60.preview.emergentagent.com"
API = f"{BASE}/api"

SUPER_ADMIN_EMAIL = "admin@lumascout.app"
SUPER_ADMIN_PW = "Grayson@1117!!"

results = []


def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}" + (f" :: {detail}" if detail else ""))
    results.append((name, ok, detail))


def is_json_response(resp):
    ct = (resp.headers.get("content-type") or "").lower()
    if "application/json" not in ct:
        return False, f"content-type was {ct!r}"
    try:
        body = resp.json()
    except Exception as e:
        return False, f"json() raised {e!r}"
    if not isinstance(body, dict):
        return False, f"body is not a dict: {type(body).__name__}"
    return True, body


def assert_no_html(resp):
    txt = (resp.text or "")[:200].lstrip().lower()
    return not (txt.startswith("<!doctype") or txt.startswith("<html") or "<body" in txt)


# ─────────────────────────────────────────────────────────────────────────────
# 1) Missing session_id → 400 or 422 (no 500)
# ─────────────────────────────────────────────────────────────────────────────
def test_missing_session_id():
    r = requests.post(f"{API}/auth/google/session", json={}, timeout=30)
    if r.status_code == 500:
        record("1) Missing session_id → not 500", False,
               f"got 500 with body={r.text[:200]!r}")
        return
    if r.status_code not in (400, 422):
        record("1) Missing session_id → 400 or 422", False,
               f"got {r.status_code} body={r.text[:200]!r}")
        return
    ok_json, body_or_err = is_json_response(r)
    if not ok_json:
        record("1) Missing session_id → JSON body", False, body_or_err)
        return
    if not assert_no_html(r):
        record("1) Missing session_id → no HTML leakage", False,
               f"body looked HTML-ish: {r.text[:120]!r}")
        return
    detail = body_or_err.get("detail")
    # FastAPI 422 returns detail as a list of errors, 400 returns a string
    detail_ok = (
        (r.status_code == 400 and isinstance(detail, str) and ("Missing" in detail or "missing" in detail.lower()))
        or (r.status_code == 422 and (isinstance(detail, list) or isinstance(detail, str)))
    )
    record(
        f"1) Missing session_id → {r.status_code} with JSON detail",
        detail_ok,
        f"detail={detail!r}",
    )


# ─────────────────────────────────────────────────────────────────────────────
# 2) Empty-string session_id → 400 with detail "Missing session id"
# ─────────────────────────────────────────────────────────────────────────────
def test_empty_session_id():
    r = requests.post(f"{API}/auth/google/session", json={"session_id": ""}, timeout=30)
    if r.status_code != 400:
        record("2) Empty session_id → 400", False,
               f"got {r.status_code} body={r.text[:200]!r}")
        return
    ok_json, body_or_err = is_json_response(r)
    if not ok_json:
        record("2) Empty session_id → JSON body", False, body_or_err)
        return
    if not assert_no_html(r):
        record("2) Empty session_id → no HTML", False, r.text[:120])
        return
    detail = body_or_err.get("detail", "")
    ok = isinstance(detail, str) and "Missing session id" in detail
    record("2) Empty session_id → 400 'Missing session id'", ok,
           f"detail={detail!r}")


# ─────────────────────────────────────────────────────────────────────────────
# 3) Invalid session_id → 401 with detail "Invalid session"
# ─────────────────────────────────────────────────────────────────────────────
def test_invalid_session_id():
    r = requests.post(
        f"{API}/auth/google/session",
        json={"session_id": "NOT_A_REAL_SESSION_12345"},
        timeout=45,
    )
    # Per review: upstream may return 5xx/transport error; we accept 401 (invalid)
    # or 502 (upstream unavailable) but NOT 500 / unhandled.
    if r.status_code == 500:
        record("3) Invalid session_id → not 500", False,
               f"got 500 with body={r.text[:200]!r}")
        return
    if r.status_code not in (401, 502):
        record("3) Invalid session_id → 401 or 502", False,
               f"got {r.status_code} body={r.text[:200]!r}")
        return
    ok_json, body_or_err = is_json_response(r)
    if not ok_json:
        record("3) Invalid session_id → JSON body", False, body_or_err)
        return
    if not assert_no_html(r):
        record("3) Invalid session_id → no HTML leakage", False, r.text[:120])
        return
    detail = body_or_err.get("detail", "")
    if r.status_code == 401:
        ok = isinstance(detail, str) and detail == "Invalid session"
        record("3) Invalid session_id → 401 'Invalid session'", ok,
               f"status=401 detail={detail!r}")
    else:
        # 502 path is also acceptable per error taxonomy
        ok = isinstance(detail, str) and len(detail) > 0
        record("3) Invalid session_id → 502 (upstream unavailable, accepted)",
               ok, f"status=502 detail={detail!r}")
    return r.status_code


# ─────────────────────────────────────────────────────────────────────────────
# 4) JSON body shape for 1, 2, 3 — already exercised inline above. Add a
#    consolidated check that none of the 3 leaked HTML.
# ─────────────────────────────────────────────────────────────────────────────
def test_json_consistency():
    cases = [
        ("missing", {}),
        ("empty",   {"session_id": ""}),
        ("invalid", {"session_id": "NOT_A_REAL_SESSION_67890"}),
    ]
    all_ok = True
    issues = []
    for label, body in cases:
        r = requests.post(f"{API}/auth/google/session", json=body, timeout=45)
        ok_json, body_or_err = is_json_response(r)
        no_html = assert_no_html(r)
        detail_ok = False
        if ok_json:
            d = body_or_err.get("detail")
            # 422 may have list detail; accept str OR list
            detail_ok = isinstance(d, (str, list)) and d is not None
        case_ok = ok_json and no_html and detail_ok
        if not case_ok:
            all_ok = False
            issues.append(
                f"{label}: status={r.status_code} ok_json={ok_json} no_html={no_html} "
                f"detail_ok={detail_ok} body={r.text[:120]!r}"
            )
    record("4) JSON body shape consistency across 1/2/3", all_ok,
           "; ".join(issues) if issues else "all 3 buckets returned valid JSON with `detail`")


# ─────────────────────────────────────────────────────────────────────────────
# 5) Email/password login regression
# ─────────────────────────────────────────────────────────────────────────────
def test_login_regression():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": SUPER_ADMIN_EMAIL, "password": SUPER_ADMIN_PW},
        timeout=30,
    )
    if r.status_code != 200:
        record("5a) /auth/login super_admin", False,
               f"status={r.status_code} body={r.text[:200]!r}")
        return None
    body = r.json()
    token = body.get("token")
    user = body.get("user")
    ok = bool(token) and isinstance(user, dict) and user.get("email") == SUPER_ADMIN_EMAIL
    record("5a) /auth/login super_admin → 200 with token+user", ok,
           f"token_len={len(token) if token else 0} user_email={user.get('email') if user else None}")
    if not ok:
        return None

    r2 = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    record(
        "5b) GET /auth/me with super_admin token → 200",
        r2.status_code == 200,
        f"status={r2.status_code}",
    )
    return token


# ─────────────────────────────────────────────────────────────────────────────
# 6) /auth/me structure unchanged
# ─────────────────────────────────────────────────────────────────────────────
def test_auth_me_structure(token):
    if not token:
        record("6) /auth/me structure", False, "no token from login step")
        return
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if r.status_code != 200:
        record("6) /auth/me structure", False, f"status={r.status_code}")
        return
    body = r.json()
    expected = [
        "user_id", "email", "name", "plan", "limits",
        "profile_complete", "profile_completed_at", "usage", "stats",
    ]
    missing = [k for k in expected if k not in body]
    record(
        "6) /auth/me has all expected keys",
        len(missing) == 0,
        f"missing={missing!r} got_keys={sorted(body.keys())[:20]}",
    )


# ─────────────────────────────────────────────────────────────────────────────
# 7) Backend smoke — unrelated endpoints
# ─────────────────────────────────────────────────────────────────────────────
def test_backend_smoke():
    r1 = requests.get(f"{API}/spots?limit=5", timeout=30)
    record("7a) GET /api/spots?limit=5 → 200", r1.status_code == 200,
           f"status={r1.status_code}")
    r2 = requests.get(
        f"{API}/spots/markers",
        params={"sw_lat": -90, "sw_lng": -180, "ne_lat": 90, "ne_lng": 180, "limit": 20},
        timeout=30,
    )
    record("7b) GET /api/spots/markers → 200", r2.status_code == 200,
           f"status={r2.status_code}")


# ─────────────────────────────────────────────────────────────────────────────
# 8) Log capture — backend log must contain `auth.google` line for the
#    invalid_session attempt (or upstream_5xx / upstream_unavailable).
# ─────────────────────────────────────────────────────────────────────────────
def test_log_capture():
    # Fire a fresh invalid-session request to make sure a log line was just written
    requests.post(
        f"{API}/auth/google/session",
        json={"session_id": "LOG_CAPTURE_PROBE_42424242"},
        timeout=45,
    )
    time.sleep(1.0)

    log_paths = [
        "/var/log/supervisor/backend.out.log",
        "/var/log/supervisor/backend.err.log",
    ]
    pattern = re.compile(
        r"google_session\.(invalid_session|upstream_5xx|upstream_unavailable|upstream_transport_error|upstream_json_decode_failed)"
    )
    found = []
    for p in log_paths:
        try:
            out = subprocess.check_output(["tail", "-n", "500", p], timeout=10).decode(errors="replace")
        except Exception as e:
            print(f"  [log] could not read {p}: {e!r}")
            continue
        for line in out.splitlines():
            if pattern.search(line):
                found.append((p, line.strip()))
    if found:
        sample = found[-1]
        record(
            "8) Backend log contains structured `google_session.*` line",
            True,
            f"found {len(found)} matching lines, last in {sample[0]} :: {sample[1][:200]}",
        )
    else:
        record(
            "8) Backend log contains structured `google_session.*` line",
            False,
            "no matching log lines found in last 500 lines of backend.out.log / backend.err.log",
        )


# ─────────────────────────────────────────────────────────────────────────────
def main():
    print(f"\n=== POST /api/auth/google/session hardening regression — {BASE} ===\n")
    test_missing_session_id()
    test_empty_session_id()
    invalid_status = test_invalid_session_id()
    test_json_consistency()
    token = test_login_regression()
    test_auth_me_structure(token)
    test_backend_smoke()
    test_log_capture()

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n=== {passed}/{total} PASS ===")
    if passed != total:
        print("\nFAILURES:")
        for name, ok, detail in results:
            if not ok:
                print(f"  - {name} :: {detail}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
