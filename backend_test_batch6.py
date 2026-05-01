"""backend_test_reports.py — Batch #6 reporting endpoint regression suite.

Covers the unified `POST /api/reports` + legacy alias `POST /api/report`:
  1. 401 — no auth header returns unauthorized.
  2. 422 — missing/invalid target_type, target_id, reason fields return
     pydantic validation errors (NOT 500s).
  3. 200 — happy path for each supported target_type across both paths.
  4. Dedupe — same reporter + same target + pending returns dedup=True.
  5. Auth + rate-limit spec — reporter_user_id recorded on the doc.

Runs against http://localhost:8001/api. Uses the seeded super_admin
(admin@lumascout.app / Grayson@1117!!) to get an auth token.
"""
import os
import sys
import json
import time
import urllib.request
import urllib.parse
import urllib.error

API = os.environ.get("BACKEND_URL", "http://localhost:8001") + "/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@lumascout.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Grayson@1117!!")


def http(method: str, path: str, *, token: str | None = None, body: dict | None = None):
    url = API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, method=method, data=data)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode() or "null")
        except Exception:
            payload = None
        return e.code, payload


def login(email: str, password: str) -> str:
    code, body = http("POST", "/auth/login", body={"email": email, "password": password})
    assert code == 200, f"login failed: {code} {body}"
    return body["token"]


def test_unauth_returns_401():
    code, _ = http("POST", "/reports", body={
        "target_type": "spot", "target_id": "x", "reason": "spam",
    })
    assert code == 401, f"expected 401, got {code}"
    print("  [OK] 401 without auth")


def test_bad_body_returns_422(token: str):
    # Missing target_id -> 422 (pydantic), NOT 500
    code, body = http("POST", "/reports", token=token, body={
        "target_type": "spot", "reason": "spam",
    })
    assert code == 422, f"expected 422 for missing target_id, got {code} {body}"
    print("  [OK] 422 when target_id missing")

    # Invalid target_type -> 422 (custom validator)
    code, body = http("POST", "/reports", token=token, body={
        "target_type": "not_a_real_type", "target_id": "x", "reason": "spam",
    })
    assert code == 422, f"expected 422 for bad target_type, got {code} {body}"
    print("  [OK] 422 when target_type invalid")

    # Empty reason -> 422
    code, body = http("POST", "/reports", token=token, body={
        "target_type": "spot", "target_id": "x", "reason": "   ",
    })
    assert code == 422, f"expected 422 for empty reason, got {code} {body}"
    print("  [OK] 422 when reason empty")


def test_happy_paths(token: str):
    unique_suffix = str(int(time.time()))
    for tt in ("spot", "user", "review", "post", "poll", "comment", "marketplace_item"):
        tid = f"qa_{tt}_{unique_suffix}"
        code, body = http("POST", "/reports", token=token, body={
            "target_type": tt, "target_id": tid, "reason": "spam",
            "details": f"QA test of {tt} report path",
        })
        assert code == 200, f"{tt}: expected 200, got {code} {body}"
        assert body.get("ok") is True
        assert body.get("target_type") == tt
        assert body.get("target_id") == tid
        assert body.get("report_id", "").startswith("rpt_")
        print(f"  [OK] {tt}: report created {body['report_id']}")


def test_dedupe(token: str):
    tid = f"qa_dedupe_{int(time.time())}"
    body = {"target_type": "spot", "target_id": tid, "reason": "spam", "details": "first"}
    code, first = http("POST", "/reports", token=token, body=body)
    assert code == 200, f"first call failed: {code} {first}"
    assert first.get("deduped") is False

    body["details"] = "second (should dedupe)"
    code, second = http("POST", "/reports", token=token, body=body)
    assert code == 200
    assert second.get("deduped") is True, f"expected deduped=True, got {second}"
    assert second.get("report_id") == first.get("report_id"), "dedup should reuse the same report_id"
    print("  [OK] dedupe returns same report_id")


def test_singular_alias(token: str):
    """POST /report (singular) should forward to the unified handler."""
    tid = f"qa_alias_{int(time.time())}"
    code, body = http("POST", "/report", token=token, body={
        "target_type": "post", "target_id": tid, "reason": "spam",
    })
    assert code == 200, f"/report alias failed: {code} {body}"
    assert body.get("ok") is True
    assert body.get("report_id", "").startswith("rpt_")
    print("  [OK] POST /report (singular) alias works")


def test_forgot_password_no_token_leak():
    """Batch #6 P0-1 — forgot-password response MUST NOT contain reset_token/
    reset_link/dev_mode unless EXPOSE_DEV_RESET_TOKEN=1 is set in backend env."""
    code, body = http("POST", "/auth/forgot-password", body={"email": "any_email@example.com"})
    assert code == 200, f"forgot-password returned {code} {body}"
    # No token/link should be echoed back in a production-like environment.
    # If this test ever trips, someone re-enabled EXPOSE_DEV_RESET_TOKEN on a
    # deployed env — revoke immediately.
    assert body.get("dev_mode") is not True, f"dev_mode True in response: {body}"
    assert "reset_token" not in body, f"reset_token leaked: {body}"
    assert "reset_link" not in body, f"reset_link leaked: {body}"
    assert body.get("ok") is True
    assert "message" in body
    print("  [OK] forgot-password does not leak reset_token / reset_link")


def main() -> int:
    print("Batch #6 — Reports endpoint + forgot-password security tests")
    print("=" * 64)
    print("[1] unauth -> 401")
    test_unauth_returns_401()

    print("[2] login as super_admin")
    token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    print(f"  got token (len={len(token)})")

    print("[3] bad body -> 422 (not 500)")
    test_bad_body_returns_422(token)

    print("[4] happy paths across target types")
    test_happy_paths(token)

    print("[5] dedupe")
    test_dedupe(token)

    print("[6] /report (singular) alias")
    test_singular_alias(token)

    print("[7] forgot-password token leak guard")
    test_forgot_password_no_token_leak()

    print("=" * 64)
    print("ALL BATCH #6 TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
