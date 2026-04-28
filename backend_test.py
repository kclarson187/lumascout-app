"""
Validation harness for the NEW Uploader Edit Request workflow.

Endpoints under test (all /api prefixed):
  POST /spots/{spot_id}/edit-request                     - owner submit
  GET  /spots/{spot_id}/edit-requests/mine               - owner list mine
  GET  /admin/edit-requests?status=pending|approved|...  - admin queue
  POST /admin/edit-requests/{request_id}/approve         - admin approve
  POST /admin/edit-requests/{request_id}/reject          - admin reject (note required)

Source: /app/backend/routes/edit_requests.py (registered in server.py L6863).
"""
from __future__ import annotations

import os
import sys
import uuid
from typing import Optional

import requests

BASE_URL = os.environ.get(
    "BACKEND_URL",
    "https://photo-finder-60.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASS = "admin123"

PASS = 0
FAIL = 0
FAILURES: list[str] = []


def _record(ok: bool, name: str, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        FAILURES.append(f"{name} :: {detail}")
        print(f"  FAIL  {name}  -- {detail}")


def assert_eq(actual, expected, name: str) -> bool:
    ok = actual == expected
    _record(ok, name, f"expected={expected!r} got={actual!r}")
    return ok


def assert_true(cond: bool, name: str, detail: str = "") -> bool:
    _record(bool(cond), name, detail)
    return bool(cond)


def _hdr(token: Optional[str]) -> dict:
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def post(path: str, body: dict, token: Optional[str] = None) -> requests.Response:
    return requests.post(f"{API}{path}", headers=_hdr(token), json=body, timeout=30)


def get(path: str, token: Optional[str] = None) -> requests.Response:
    return requests.get(f"{API}{path}", headers=_hdr(token), timeout=30)


def delete(path: str, body: Optional[dict] = None, token: Optional[str] = None) -> requests.Response:
    return requests.delete(f"{API}{path}", headers=_hdr(token), json=body or {}, timeout=30)


def login(email: str, password: str) -> str:
    r = post("/auth/login", {"email": email, "password": password})
    if r.status_code != 200:
        raise RuntimeError(f"login failed for {email}: {r.status_code} {r.text}")
    return r.json()["token"]


def register_free_user(prefix: str = "owner") -> tuple[str, dict]:
    sfx = uuid.uuid4().hex[:8]
    email = f"{prefix}_{sfx}@lumascout-qa.com"
    password = "QaPass!2026"
    r = post("/auth/register", {
        "email": email,
        "password": password,
        "name": f"QA {prefix.title()} {sfx[:4]}",
    })
    if r.status_code != 200:
        raise RuntimeError(f"register failed: {r.status_code} {r.text}")
    user = r.json().get("user") or {}
    token = login(email, password)
    user["__token"] = token
    user["__email"] = email
    user["__password"] = password
    return token, user


def main() -> int:
    print(f"[edit_requests] target API: {API}\n")

    print("[setup] login admin")
    admin_token = login(ADMIN_EMAIL, ADMIN_PASS)
    _record(True, "Admin login", "")

    # Resolve admin user_id for later asserts
    r = get("/auth/me", admin_token)
    admin_user_id = (r.json() or {}).get("user_id") if r.status_code == 200 else None
    print(f"  admin user_id={admin_user_id}")

    print("[setup] register free user U1 (owner)")
    u1_token, u1 = register_free_user("u1")
    print(f"  -> U1 user_id={u1.get('user_id')} email={u1['__email']}")

    # T1
    print("\n[T1] Owner creates public spot 'Test Spot QA' w/ 2 images")
    img_a = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII="
        "#qa-img-a-" + uuid.uuid4().hex[:6]
    )
    img_b = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII="
        "#qa-img-b-" + uuid.uuid4().hex[:6]
    )
    spot_body = {
        "title": "Test Spot QA",
        "description": "Original description",
        "latitude": 29.4241,
        "longitude": -98.4936,
        "city": "San Antonio",
        "state": "TX",
        "country": "USA",
        "privacy_mode": "public",
        "save_as_draft": False,
        "shoot_types": ["Portrait"],
        "images": [
            {"image_url": img_a, "caption": "first", "is_cover": True},
            {"image_url": img_b, "caption": "second", "is_cover": False},
        ],
        "tips": "Great at sunset",
        "best_time_of_day": "Sunset",
        "parking_notes": "Street parking",
        "access_notes": "Walk-in",
        "safety_notes": "Watch traffic",
        "best_light_notes": "PM golden",
    }
    r = post("/spots", spot_body, u1_token)
    assert_eq(r.status_code, 200, "T1 POST /spots returns 200")
    if r.status_code != 200:
        print("BODY:", r.text[:500])
        return _emit_summary()
    spot = r.json()
    SPOT_A = spot["spot_id"]
    print(f"  -> SPOT_A={SPOT_A}")
    server_images = spot.get("images") or []
    assert_true(len(server_images) >= 2, "T1 spot has >=2 images", f"got {len(server_images)}")
    first_url = server_images[0]["image_url"]
    second_url = server_images[1]["image_url"]
    assert_true(first_url != second_url, "T1 image URLs are distinct", "")

    # T2
    print("\n[T2] Owner submits edit request {title, description}")
    r = post(
        f"/spots/{SPOT_A}/edit-request",
        {
            "changes": {"title": "Test Spot QA (new)", "description": "updated"},
            "reason_note": "typo fix",
        },
        u1_token,
    )
    assert_eq(r.status_code, 200, "T2 owner submit returns 200")
    body = r.json() if r.status_code == 200 else {}
    REQ_A = body.get("request_id")
    assert_true(bool(REQ_A) and REQ_A.startswith("edr_"), "T2 request_id present (edr_*)", str(body)[:200])
    assert_eq(body.get("status"), "pending", "T2 status==pending")
    changes = body.get("changes") or {}
    assert_eq(changes.get("title"), "Test Spot QA (new)", "T2 changes.title echoed")
    assert_eq(changes.get("description"), "updated", "T2 changes.description echoed")
    before = body.get("before") or {}
    assert_eq(before.get("title"), "Test Spot QA", "T2 before.title=='Test Spot QA'")
    assert_true("description" in before, "T2 before contains description key", str(before)[:160])

    # T3
    print("\n[T3] Duplicate open request -> 409")
    r = post(f"/spots/{SPOT_A}/edit-request", {"changes": {"tips": "x"}}, u1_token)
    assert_eq(r.status_code, 409, "T3 duplicate returns 409")
    detail = ""
    try:
        detail = (r.json() or {}).get("detail", "")
    except Exception:
        detail = r.text
    assert_true(
        "pending" in (detail or "").lower() and "edit request" in (detail or "").lower(),
        "T3 detail mentions 'pending edit request'",
        detail[:160],
    )

    # T4
    print("\n[T4] Non-owner U2 submits -> 403")
    u2_token, u2 = register_free_user("u2")
    r = post(f"/spots/{SPOT_A}/edit-request", {"changes": {"title": "hack"}}, u2_token)
    assert_eq(r.status_code, 403, "T4 non-owner returns 403")
    try:
        detail = (r.json() or {}).get("detail", "")
    except Exception:
        detail = r.text
    assert_true("uploader" in (detail or "").lower(), "T4 detail mentions 'uploader'", detail[:160])

    # T5
    print("\n[T5] Admin lists pending edit requests")
    r = get("/admin/edit-requests?status=pending", admin_token)
    assert_eq(r.status_code, 200, "T5 admin GET pending returns 200")
    payload = r.json() if r.status_code == 200 else {}
    items = payload.get("items") or []
    count = payload.get("count")
    assert_true(isinstance(items, list), "T5 items is a list", "")
    assert_true(isinstance(count, int) and count >= 1, "T5 count >= 1", f"count={count}")
    matching = [it for it in items if it.get("request_id") == REQ_A]
    assert_true(len(matching) == 1, "T5 REQ_A present in pending list", f"matching={len(matching)}")
    if matching:
        m = matching[0]
        sp = m.get("spot") or {}
        assert_true(
            sp.get("title") in ("Test Spot QA", "Test Spot QA (new)"),
            "T5 spot.title hydrated",
            f"spot.title={sp.get('title')}",
        )
        assert_eq(sp.get("city"), "San Antonio", "T5 spot.city hydrated")
        assert_eq(sp.get("state"), "TX", "T5 spot.state hydrated")
        assert_true("cover_image_url" in sp, "T5 spot.cover_image_url key present", str(sp)[:200])
        ow = m.get("owner") or {}
        assert_eq(ow.get("user_id"), u1.get("user_id"), "T5 owner.user_id matches U1")
        assert_true(
            "name" in ow and "username" in ow and "role" in ow and "plan" in ow,
            "T5 owner has name/username/role/plan",
            str(ow)[:200],
        )

    # T6
    print("\n[T6] Admin approves REQ_A {note:'lgtm'}")
    r = post(f"/admin/edit-requests/{REQ_A}/approve", {"note": "lgtm"}, admin_token)
    assert_eq(r.status_code, 200, "T6 approve returns 200")
    body6 = r.json() if r.status_code == 200 else {}
    assert_eq(body6.get("ok"), True, "T6 ok==true")
    applied = body6.get("applied") or []
    assert_true(
        set(applied) == {"title", "description"},
        "T6 applied == ['title','description']",
        f"applied={applied}",
    )

    r = get(f"/spots/{SPOT_A}", u1_token)
    assert_eq(r.status_code, 200, "T6 GET /spots/{SPOT_A} returns 200")
    spot6 = r.json() if r.status_code == 200 else {}
    assert_eq(spot6.get("title"), "Test Spot QA (new)", "T6 spot.title updated")
    assert_eq(spot6.get("description"), "updated", "T6 spot.description updated")

    # Owner notification check
    r = get("/notifications?limit=10", u1_token)
    assert_eq(r.status_code, 200, "T6 GET /notifications returns 200")
    notifs = (r.json() or {}).get("items") or []
    has_approved = any(n.get("kind") == "spot_edit_approved" for n in notifs)
    assert_true(has_approved, "T6 notification kind=spot_edit_approved emitted",
                f"kinds={[n.get('kind') for n in notifs[:6]]}")

    # Confirm request transition
    r = get(f"/spots/{SPOT_A}/edit-requests/mine", u1_token)
    if r.status_code == 200:
        mine = (r.json() or {}).get("items") or []
        ra = next((it for it in mine if it.get("request_id") == REQ_A), None)
        if ra:
            assert_eq(ra.get("status"), "approved", "T6 REQ_A status=='approved'")
            if admin_user_id:
                assert_eq(ra.get("decided_by_user_id"), admin_user_id,
                          "T6 decided_by_user_id == admin user_id")
            assert_eq(ra.get("decision_note"), "lgtm", "T6 decision_note=='lgtm'")
        else:
            _record(False, "T6 REQ_A retrievable in /mine", "not found")

    # T7
    print("\n[T7] Owner submits second edit (REQ_B), admin rejects with EMPTY body -> 400")
    r = post(f"/spots/{SPOT_A}/edit-request", {"changes": {"safety_notes": "watch for goats"}}, u1_token)
    assert_eq(r.status_code, 200, "T7 owner submit REQ_B returns 200")
    REQ_B = (r.json() or {}).get("request_id")
    assert_true(bool(REQ_B) and REQ_B.startswith("edr_"), "T7 REQ_B id present", str(REQ_B))

    r = post(f"/admin/edit-requests/{REQ_B}/reject", {}, admin_token)
    assert_eq(r.status_code, 400, "T7 reject without note -> 400")
    try:
        detail = (r.json() or {}).get("detail", "")
    except Exception:
        detail = r.text
    assert_true(
        "rejection note" in (detail or "").lower() and "required" in (detail or "").lower(),
        "T7 detail mentions 'rejection note is required'",
        detail[:160],
    )

    # T8
    print("\n[T8] Admin rejects REQ_B with note -> 200")
    r = post(f"/admin/edit-requests/{REQ_B}/reject", {"note": "not a known hazard"}, admin_token)
    assert_eq(r.status_code, 200, "T8 reject with note returns 200")
    assert_eq((r.json() or {}).get("ok"), True, "T8 ok==true")

    r = get(f"/spots/{SPOT_A}/edit-requests/mine", u1_token)
    if r.status_code == 200:
        mine = (r.json() or {}).get("items") or []
        rb = next((it for it in mine if it.get("request_id") == REQ_B), None)
        if rb:
            assert_eq(rb.get("status"), "rejected", "T8 REQ_B status=='rejected'")
            assert_eq(rb.get("decision_note"), "not a known hazard", "T8 decision_note set")
        else:
            _record(False, "T8 REQ_B retrievable in /mine", "not found")

    r = get("/notifications?limit=20", u1_token)
    assert_eq(r.status_code, 200, "T8 GET /notifications returns 200")
    notifs = (r.json() or {}).get("items") or []
    rejected = next((n for n in notifs if n.get("kind") == "spot_edit_rejected"), None)
    assert_true(rejected is not None, "T8 spot_edit_rejected notification present",
                f"kinds={[n.get('kind') for n in notifs[:6]]}")
    if rejected:
        body_text = (rejected.get("body") or "")
        assert_true(
            "not a known hazard" in body_text,
            "T8 notification body contains rejection note",
            f"body={body_text!r}",
        )

    # T9
    print("\n[T9] Featured-photo edit -> admin_cover_override written")
    r = post(f"/spots/{SPOT_A}/edit-request", {"changes": {"featured_image_url": second_url}}, u1_token)
    assert_eq(r.status_code, 200, "T9 owner submit REQ_C returns 200")
    REQ_C = (r.json() or {}).get("request_id")
    assert_true(bool(REQ_C) and REQ_C.startswith("edr_"), "T9 REQ_C id present", str(REQ_C))

    r = post(f"/admin/edit-requests/{REQ_C}/approve", {}, admin_token)
    assert_eq(r.status_code, 200, "T9 approve REQ_C returns 200")

    r = get(f"/spots/{SPOT_A}", u1_token)
    assert_eq(r.status_code, 200, "T9 GET /spots/{SPOT_A} returns 200")
    spot9 = r.json() if r.status_code == 200 else {}
    over = spot9.get("admin_cover_override") or {}
    assert_true(isinstance(over, dict) and bool(over), "T9 admin_cover_override exists", f"got={over}")
    assert_eq(over.get("image_url"), second_url, "T9 admin_cover_override.image_url == second_url")
    assert_eq(spot9.get("hero_cover_image_url"), second_url, "T9 hero_cover_image_url == second_url")

    # T10
    print("\n[T10] photo_order edit -> images reordered")
    r = get(f"/spots/{SPOT_A}", u1_token)
    spot_pre = r.json() if r.status_code == 200 else {}
    imgs_pre = spot_pre.get("images") or []
    if len(imgs_pre) < 2:
        _record(False, "T10 prereq: spot has 2+ images", f"got {len(imgs_pre)}")
    else:
        new_order = [second_url, first_url]
        r = post(f"/spots/{SPOT_A}/edit-request", {"changes": {"photo_order": new_order}}, u1_token)
        assert_eq(r.status_code, 200, "T10 owner submit REQ_D returns 200")
        REQ_D = (r.json() or {}).get("request_id")

        r = post(f"/admin/edit-requests/{REQ_D}/approve", {}, admin_token)
        assert_eq(r.status_code, 200, "T10 approve REQ_D returns 200")

        r = get(f"/spots/{SPOT_A}", u1_token)
        spot10 = r.json() if r.status_code == 200 else {}
        imgs10 = spot10.get("images") or []
        assert_true(len(imgs10) >= 2, "T10 spot still has 2+ images", f"got {len(imgs10)}")
        if len(imgs10) >= 1:
            assert_eq(imgs10[0]["image_url"], second_url,
                      "T10 spot.images[0].image_url == second_url (reordered)")
        if len(imgs10) >= 2:
            assert_eq(imgs10[1]["image_url"], first_url,
                      "T10 spot.images[1].image_url == first_url")

    # T11
    print("\n[T11] Re-approve already-decided REQ_A -> 409")
    r = post(f"/admin/edit-requests/{REQ_A}/approve", {}, admin_token)
    assert_eq(r.status_code, 409, "T11 re-approve returns 409")
    try:
        detail = (r.json() or {}).get("detail", "")
    except Exception:
        detail = r.text
    assert_true("approved" in (detail or "").lower(),
                "T11 detail contains 'approved'", detail[:160])

    # T12
    print("\n[T12] Owner GET /spots/{SPOT_A}/edit-requests/mine")
    r = get(f"/spots/{SPOT_A}/edit-requests/mine", u1_token)
    assert_eq(r.status_code, 200, "T12 owner /mine returns 200")
    mine = (r.json() or {}).get("items") or []
    assert_true(len(mine) >= 4, f"T12 items length >= 4 (got {len(mine)})", "")
    if len(mine) >= 2:
        ts0 = mine[0].get("created_at")
        ts1 = mine[1].get("created_at")
        assert_true(
            (ts0 or "") >= (ts1 or ""),
            "T12 sorted newest-first",
            f"ts0={ts0} ts1={ts1}",
        )

    # cleanup
    print("\n[cleanup] DELETE /admin/spots/{SPOT_A}")
    r = delete(f"/admin/spots/{SPOT_A}",
               {"reason_code": "other", "reason_note": "QA - edit_requests test cleanup"},
               admin_token)
    print(f"  cleanup status={r.status_code} body={r.text[:160]}")

    return _emit_summary()


def _emit_summary() -> int:
    print("\n" + "=" * 60)
    print(f"RESULTS  pass={PASS}  fail={FAIL}")
    if FAILURES:
        print("\nFailures:")
        for f in FAILURES:
            print(f"  - {f}")
    print("=" * 60)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"FATAL: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(2)
