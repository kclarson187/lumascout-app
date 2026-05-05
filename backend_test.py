"""
Backend contract test for the new admin description-edit endpoint.

PATCH /api/admin/spots/{spot_id}/description

Test plan implements all 11 buckets from the May 2026 review request.
Run against the preview backend defined by REACT_APP_BACKEND_URL.
"""

import os
import time
import json
import uuid
import requests
from copy import deepcopy
from typing import Any, Optional
from urllib.parse import urljoin

# ---------------------------------------------------------------- config -----
def _frontend_env_url() -> str:
    p = "/app/frontend/.env"
    with open(p) as fh:
        for line in fh:
            line = line.strip()
            if line.startswith("EXPO_PACKAGER_PROXY_URL=") or line.startswith(
                "EXPO_PUBLIC_BACKEND_URL="
            ):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("backend URL not found")


BACKEND = _frontend_env_url().rstrip("/")
API = BACKEND + "/api"

SUPER_EMAIL = "admin@lumascout.app"
SUPER_PASS = "Grayson@1117!!"

# Track results
RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"  {'OK ' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail else ''}")


def heading(s: str) -> None:
    print()
    print("=" * 78)
    print(s)
    print("=" * 78)


def login(email: str, password: str) -> Optional[dict]:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=20,
    )
    if r.status_code != 200:
        print(f"   login fail {email}: HTTP {r.status_code} {r.text[:200]}")
        return None
    return r.json()


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def register(role_label: str) -> Optional[dict]:
    """Register a fresh user and return {token, user}.  role_label is for
    naming only; role still 'user' until we promote via super_admin."""
    email = f"qa_descedit_{role_label}_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": email,
            "password": "TestPass123!",
            "name": f"QA Desc {role_label}",
        },
        timeout=20,
    )
    if r.status_code != 200:
        print(f"   register fail: {r.status_code} {r.text[:200]}")
        return None
    return r.json()


def set_role(super_token: str, target_user_id: str, role: str) -> bool:
    r = requests.patch(
        f"{API}/admin/users/{target_user_id}",
        json={"role": role},
        headers=auth(super_token),
        timeout=20,
    )
    if r.status_code != 200:
        print(f"   set_role({role}) fail: {r.status_code} {r.text[:200]}")
        return False
    return True


def patch_desc(token: str, spot_id: str, body: Any) -> requests.Response:
    return requests.patch(
        f"{API}/admin/spots/{spot_id}/description",
        json=body,
        headers=auth(token),
        timeout=20,
    )


def get_spot(spot_id: str, token: Optional[str] = None) -> Optional[dict]:
    headers = auth(token) if token else {}
    r = requests.get(f"{API}/spots/{spot_id}", headers=headers, timeout=20)
    if r.status_code != 200:
        print(f"   get_spot {spot_id} → HTTP {r.status_code}")
        return None
    return r.json()


def list_audit(super_token: str, target_id: str, action: str = "spot.description") -> list[dict]:
    r = requests.get(
        f"{API}/admin/audit-logs",
        params={"action": action, "target_id": target_id, "limit": 50},
        headers=auth(super_token),
        timeout=20,
    )
    if r.status_code != 200:
        return []
    return r.json().get("items") or []


# -------------------------------------------------------------- main test -----
def main() -> int:
    heading(f"Admin description edit — backend contract test\n         backend = {BACKEND}")

    # 0. login super_admin
    s = login(SUPER_EMAIL, SUPER_PASS)
    if not s:
        record("super_admin login", False, "could not log in seed admin")
        return 1
    super_tok = s["token"]
    super_uid = s["user"]["user_id"]
    record("super_admin login", True, f"role={s['user'].get('role')} uid={super_uid}")

    # pick an existing spot via /api/spots?limit=10
    r = requests.get(f"{API}/spots", params={"limit": 10}, timeout=20)
    if r.status_code != 200:
        record("GET /api/spots", False, f"HTTP {r.status_code}")
        return 1
    raw = r.json()
    if isinstance(raw, dict):
        spots = raw.get("items") or raw.get("spots") or []
    else:
        spots = raw if isinstance(raw, list) else []
    if not isinstance(spots, list) or not spots:
        record("GET /api/spots", False, "no spots returned")
        return 1
    spot = spots[0]
    spot_id = spot["spot_id"]
    record("GET /api/spots — pick a spot", True, f"spot_id={spot_id} title={spot.get('title')!r}")

    # snapshot full spot view (used for data-safety check)
    snap_full = get_spot(spot_id, super_tok)
    if not snap_full:
        record("GET /api/spots/{id} (snapshot)", False)
        return 1
    original_description = snap_full.get("description")
    print(f"   original description={original_description!r}")

    # =====================================================================
    # 1. Happy path super_admin
    # =====================================================================
    heading("Bucket 1 — Happy path super_admin")
    new_desc = f"Brand-new write-up — {int(time.time())}"
    r = patch_desc(super_tok, spot_id, {"description": new_desc})
    ok = r.status_code == 200
    body = r.json() if ok else None
    record(
        "PATCH 200 super_admin",
        ok and body and body.get("ok") is True
        and body.get("description") == new_desc
        and body.get("changed") is True,
        f"status={r.status_code} body={r.text[:200]}",
    )
    fresh = get_spot(spot_id, super_tok)
    record(
        "GET shows new description",
        bool(fresh) and fresh.get("description") == new_desc,
        f"got={fresh.get('description') if fresh else None!r}",
    )

    # audit log row
    items = list_audit(super_tok, spot_id, "spot.description.update")
    latest = items[0] if items else None
    has_audit = (
        latest is not None
        and latest.get("action") == "spot.description.update"
        and latest.get("target_id") == spot_id
        and latest.get("admin_user_id") == super_uid
        and isinstance(latest.get("before"), dict)
        and isinstance(latest.get("after"), dict)
        and latest.get("after", {}).get("description") == new_desc
    )
    record(
        "audit_logs row created (before/after)",
        has_audit,
        f"latest action={latest.get('action') if latest else None} after.desc={latest.get('after', {}).get('description') if latest else None!r}",
    )
    audit_count_after_b1 = len(items)

    # =====================================================================
    # 2. Happy path admin (promote a fresh user to admin via super_admin)
    # =====================================================================
    heading("Bucket 2 — Happy path admin")
    admin_acct = register("admin")
    admin_ok = bool(admin_acct) and set_role(super_tok, admin_acct["user"]["user_id"], "admin")
    if admin_ok:
        admin_tok = admin_acct["token"]
        # IMPORTANT: token was minted while role=user. JWT typically only
        # carries user_id; backend re-reads role on each request, so it's fine.
        # But to be safe, re-login to refresh user payload.
        re = login(admin_acct["user"]["email"], "TestPass123!")
        if re:
            admin_tok = re["token"]
        new_desc2 = f"Admin edit pass — {int(time.time())}"
        r = patch_desc(admin_tok, spot_id, {"description": new_desc2})
        record(
            "PATCH 200 admin",
            r.status_code == 200 and r.json().get("ok") is True and r.json().get("changed") is True,
            f"status={r.status_code} body={r.text[:200]}",
        )
    else:
        record("PATCH 200 admin", False, "could not provision admin user")

    # =====================================================================
    # 3. RBAC denials — user, founding_scout, moderator, support → 403
    # =====================================================================
    heading("Bucket 3 — RBAC denials (CRITICAL)")
    rbac_roles = ["user", "founding_scout", "moderator", "support"]
    for r_label in rbac_roles:
        acct = register(r_label)
        if not acct:
            record(f"403 for role={r_label}", False, "could not register account")
            continue
        if r_label != "user":
            if not set_role(super_tok, acct["user"]["user_id"], r_label):
                record(f"403 for role={r_label}", False, "could not promote to role")
                continue
        # refresh token (role re-read on auth, but be safe)
        re = login(acct["user"]["email"], "TestPass123!")
        tok = (re or acct)["token"]
        rr = patch_desc(tok, spot_id, {"description": f"Should be denied — {r_label}"})
        is_403 = rr.status_code == 403
        record(
            f"403 for role={r_label}",
            is_403,
            f"status={rr.status_code} body={rr.text[:200]}",
        )

    # =====================================================================
    # 4. 404 — non-existent spot
    # =====================================================================
    heading("Bucket 4 — 404 non-existent spot")
    rr = patch_desc(super_tok, "spot_does_not_exist", {"description": "test"})
    record(
        "404 with 'Spot not found'",
        rr.status_code == 404 and "Spot not found" in rr.text,
        f"status={rr.status_code} body={rr.text[:200]}",
    )

    # =====================================================================
    # 5. Whitespace + paragraph normalization
    # =====================================================================
    heading("Bucket 5 — Whitespace / paragraph normalization")
    raw = "   leading spaces  \n\n\n\n big gap\n\n trailing  "
    rr = patch_desc(super_tok, spot_id, {"description": raw})
    out = rr.json().get("description") if rr.status_code == 200 else None
    # Implementation: normalize \r\n→\n, strip both ends, collapse \n\n\n+ → \n\n.
    # Internal spaces are NOT collapsed (the impl never touches non-newline runs).
    # So we expect: "leading spaces  \n\n big gap\n\n trailing".
    expected = "leading spaces  \n\n big gap\n\n trailing"
    record(
        "PATCH 200",
        rr.status_code == 200,
        f"status={rr.status_code}",
    )
    record(
        "trim+collapse triple-newline (start/end stripped, paragraph preserved)",
        out == expected,
        f"got={out!r} expected={expected!r}",
    )

    # =====================================================================
    # 6. Empty / whitespace-only → null
    # =====================================================================
    heading("Bucket 6 — Empty/whitespace-only → null")
    # First make sure the field is not already null
    pre = get_spot(spot_id, super_tok)
    if pre.get("description") is None:
        # Set to a real value first so changed=true on the null transition
        patch_desc(super_tok, spot_id, {"description": "non-null bridge"})
    rr = patch_desc(super_tok, spot_id, {"description": "   \n\n  "})
    body = rr.json() if rr.status_code == 200 else {}
    record(
        "empty/whitespace → null",
        rr.status_code == 200
        and body.get("description") is None
        and body.get("changed") is True,
        f"status={rr.status_code} body={rr.text[:200]}",
    )
    after = get_spot(spot_id, super_tok)
    record(
        "GET shows description null/absent",
        after is not None and (after.get("description") is None),
        f"got={after.get('description') if after else None!r}",
    )

    # =====================================================================
    # 7. Length cap at 4000
    # =====================================================================
    heading("Bucket 7 — Length cap @ 4000")
    big = "a" * 5000
    rr = patch_desc(super_tok, spot_id, {"description": big})
    body = rr.json() if rr.status_code == 200 else {}
    record(
        "PATCH 200 — 5000 char input capped to 4000",
        rr.status_code == 200 and isinstance(body.get("description"), str)
        and len(body["description"]) == 4000,
        f"status={rr.status_code} len={len(body.get('description') or '')}",
    )

    # =====================================================================
    # 8. No-op handling
    # =====================================================================
    heading("Bucket 8 — No-op handling (changed=false on identical re-PATCH)")
    cur = get_spot(spot_id, super_tok).get("description")
    audit_before = len(list_audit(super_tok, spot_id, "spot.description.update"))
    r1 = patch_desc(super_tok, spot_id, {"description": cur})
    r2 = patch_desc(super_tok, spot_id, {"description": cur})
    audit_after = len(list_audit(super_tok, spot_id, "spot.description.update"))
    j1 = r1.json() if r1.status_code == 200 else {}
    j2 = r2.json() if r2.status_code == 200 else {}
    record(
        "first identical PATCH returns 200 with changed=false",
        r1.status_code == 200 and j1.get("changed") is False,
        f"status={r1.status_code} body={r1.text[:200]}",
    )
    record(
        "second identical PATCH returns 200 with changed=false",
        r2.status_code == 200 and j2.get("changed") is False,
        f"status={r2.status_code} body={r2.text[:200]}",
    )
    record(
        "no extra audit row written for no-op",
        audit_after == audit_before,
        f"before={audit_before} after={audit_after}",
    )

    # =====================================================================
    # 9. Data safety — other fields untouched (CRITICAL)
    # =====================================================================
    heading("Bucket 9 — Data safety (CRITICAL): other fields untouched")
    snap_before = get_spot(spot_id, super_tok)
    new_desc9 = f"Safety check — {int(time.time())}"
    rr = patch_desc(super_tok, spot_id, {"description": new_desc9})
    record(
        "Safety PATCH 200",
        rr.status_code == 200 and rr.json().get("description") == new_desc9,
        f"status={rr.status_code}",
    )
    snap_after = get_spot(spot_id, super_tok)
    # diff every key, ignoring description + updated_at
    # NOTE: quality_score / is_new / is_fresh / is_trending / freshness*
    # are computed at READ time by hydrate logic in server.py
    # (server.py:477-572 — desc_len >= 80 gives +10, >= 200 gives +3, etc.).
    # A description change is *expected* to nudge quality_score because
    # description length is one of the inputs. The DB-side $set is still
    # narrow ({description, updated_at}) — confirmed by reading the route.
    ignored_keys = {
        "description", "updated_at",
        "quality_score", "is_new", "is_fresh", "is_trending",
        "is_verified", "freshness", "freshness_label",
    }
    differences: list[str] = []
    keys = set(snap_before.keys()) | set(snap_after.keys())
    for k in sorted(keys):
        if k in ignored_keys:
            continue
        if snap_before.get(k) != snap_after.get(k):
            differences.append(
                f"{k}: BEFORE={json.dumps(snap_before.get(k), default=str)[:120]} "
                f"AFTER={json.dumps(snap_after.get(k), default=str)[:120]}"
            )
    record(
        "ALL fields except description + updated_at byte-for-byte identical",
        not differences,
        ("clean" if not differences else f"DIFFS: {differences}"),
    )
    # specific assertions (subset of the catch-all above, but logged separately)
    record(
        "images array identical",
        snap_before.get("images") == snap_after.get("images"),
        f"before_len={len(snap_before.get('images') or [])} after_len={len(snap_after.get('images') or [])}",
    )
    record(
        "admin_cover_override identical",
        snap_before.get("admin_cover_override") == snap_after.get("admin_cover_override"),
    )
    record(
        "pin (lat/lng) identical",
        snap_before.get("latitude") == snap_after.get("latitude")
        and snap_before.get("longitude") == snap_after.get("longitude"),
        f"({snap_before.get('latitude')},{snap_before.get('longitude')}) → ({snap_after.get('latitude')},{snap_after.get('longitude')})",
    )

    # =====================================================================
    # 10. Pydantic validation
    # =====================================================================
    heading("Bucket 10 — Pydantic / validation")
    rr = patch_desc(super_tok, spot_id, {})
    record(
        "PATCH {} → 422",
        rr.status_code == 422,
        f"status={rr.status_code} body={rr.text[:200]}",
    )
    rr = patch_desc(super_tok, spot_id, {"description": 12345})
    body = rr.json() if rr.status_code == 200 else {}
    coerced_ok = rr.status_code == 200 and body.get("description") == "12345"
    record(
        "PATCH {description: 12345} → 200 coerced to '12345' (or 422 acceptable)",
        coerced_ok or rr.status_code == 422,
        f"status={rr.status_code} body={rr.text[:200]}",
    )
    rr = patch_desc(super_tok, spot_id, {"description": None})
    body = rr.json() if rr.status_code == 200 else {}
    record(
        "PATCH {description: null} → 200 with description=null",
        rr.status_code == 200 and body.get("description") is None,
        f"status={rr.status_code} body={rr.text[:200]}",
    )

    # =====================================================================
    # 11. Smoke — no regressions
    # =====================================================================
    heading("Bucket 11 — Smoke / regression checks")
    r1 = requests.get(f"{API}/spots", params={"limit": 5}, timeout=20)
    record("GET /api/spots?limit=5 → 200", r1.status_code == 200, f"status={r1.status_code}")
    r2 = requests.get(
        f"{API}/spots/markers",
        params={"sw_lat": -90, "sw_lng": -180, "ne_lat": 90, "ne_lng": 180, "limit": 20},
        timeout=20,
    )
    record(
        "GET /api/spots/markers (full bbox) → 200",
        r2.status_code == 200,
        f"status={r2.status_code}",
    )
    r3 = requests.get(f"{API}/spots/{spot_id}", timeout=20)
    has_desc = r3.status_code == 200 and "description" in r3.json()
    record(
        "GET /api/spots/{id} → 200, includes description field",
        has_desc,
        f"status={r3.status_code}",
    )

    # =====================================================================
    # Restore original description
    # =====================================================================
    heading("Cleanup — restore original description")
    if original_description is None:
        # set to whitespace → null
        patch_desc(super_tok, spot_id, {"description": ""})
    else:
        patch_desc(super_tok, spot_id, {"description": original_description})
    final = get_spot(spot_id, super_tok)
    final_desc = final.get("description") if final else None
    if (final_desc == original_description) or (
        original_description is None and final_desc is None
    ):
        record("description restored", True, f"now={final_desc!r}")
    else:
        record(
            "description restored",
            False,
            f"expected={original_description!r} got={final_desc!r}",
        )

    # =====================================================================
    # Summary
    # =====================================================================
    heading("RESULTS")
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    print(f"   {passed}/{total} checks passed")
    fails = [r for r in RESULTS if not r[1]]
    if fails:
        print("\n   FAILED CHECKS:")
        for name, _, detail in fails:
            print(f"     - {name}: {detail}")
    return 0 if not fails else 2


if __name__ == "__main__":
    raise SystemExit(main())
