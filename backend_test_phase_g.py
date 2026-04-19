"""
Phase G backend validation — Support Hub + Local Groups.

Tests ONLY the two new endpoint groups:
  * /api/support/faqs (public)
  * /api/support/tickets (user)
  * /api/me/support/tickets (user)
  * /api/admin/support/tickets (staff)
  * /api/admin/support/tickets/{id}/reply, /resolve (staff)
  * /api/groups (CRUD list/create/get)
  * /api/groups/{id}/join (POST/DELETE)
  * /api/groups/{id}/members, /posts
  * /api/posts with group_id (membership gate)

Creds per /app/memory/test_credentials.md.
"""
import os
import sys
import time
import uuid
import json
import requests

BASE = "https://photo-finder-60.preview.emergentagent.com"
API = f"{BASE}/api"

CREDS = {
    "sophie": ("sophie@photoscout.app", "demo123"),
    "marco":  ("marco@photoscout.app",  "demo123"),
    "admin":  ("admin@photoscout.app",  "admin123"),
}

tokens = {}
user_ids = {}

passes = 0
fails = 0
failures = []


def record(name: str, ok: bool, detail: str = ""):
    global passes, fails
    if ok:
        passes += 1
        print(f"  ✅ {name}")
    else:
        fails += 1
        failures.append((name, detail))
        print(f"  ❌ {name} :: {detail}")


def hdr(t):
    if isinstance(t, str) and t in tokens:
        return {"Authorization": f"Bearer {tokens[t]}"}
    return {"Authorization": f"Bearer {t}"}


def login_all():
    global tokens, user_ids
    for key, (email, pw) in CREDS.items():
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
        assert r.status_code == 200, f"login failed for {key}: {r.status_code} {r.text[:200]}"
        data = r.json()
        tokens[key] = data["token"]
        user_ids[key] = data["user"]["user_id"]
        print(f"[auth] {key} = {user_ids[key]}")


# ============================================================================
# SUPPORT HUB
# ============================================================================
def test_support():
    print("\n=== Support Hub ===")

    # 1) Public FAQs
    r = requests.get(f"{API}/support/faqs", timeout=10)
    ok = r.status_code == 200 and isinstance(r.json().get("items"), list) and len(r.json()["items"]) > 0
    record("GET /api/support/faqs public", ok, f"status={r.status_code} body={r.text[:200]}")
    if ok:
        items = r.json()["items"]
        shape_ok = all({"id", "q", "a"} <= set(it.keys()) for it in items)
        record("  FAQs shape has id/q/a", shape_ok)

    # 1b) No auth required (ensure same response as above)
    r2 = requests.get(f"{API}/support/faqs", timeout=10,
                      headers={"Authorization": "Bearer bogus"})
    record("FAQs still public (ignores bogus token)", r2.status_code == 200)

    # 2) Create ticket as sophie
    payload = {
        "subject": "Can't upgrade to Pro from iOS",
        "body": "I tap Go Pro in the paywall and the Stripe sheet opens blank. Using iPhone 14.",
        "category": "billing",
    }
    r = requests.post(f"{API}/support/tickets", json=payload, headers=hdr("sophie"), timeout=15)
    ok = r.status_code == 200
    ticket_id = None
    if ok:
        j = r.json()
        ticket_id = j.get("ticket_id")
        ok = (
            j.get("status") == "open"
            and j.get("category") == "billing"
            and j.get("user_id") == user_ids["sophie"]
            and j.get("subject", "").startswith("Can't upgrade")
            and j.get("replies") == []
            and ticket_id and ticket_id.startswith("sup_")
        )
    record("POST /api/support/tickets as sophie (billing)", ok, f"status={r.status_code} body={r.text[:250]}")

    # 3) Missing fields → 400
    r = requests.post(f"{API}/support/tickets", json={"subject": "", "body": ""},
                      headers=hdr("sophie"), timeout=10)
    record("Empty subject/body → 400", r.status_code == 400, f"got {r.status_code}")

    # 4) Invalid category falls back to 'general' (per impl, not 400)
    r = requests.post(f"{API}/support/tickets",
                      json={"subject": "Hi", "body": "random msg", "category": "bogus_cat"},
                      headers=hdr("sophie"), timeout=10)
    ok = r.status_code == 200 and r.json().get("category") == "general"
    record("Invalid category coerced to 'general'", ok, f"status={r.status_code} body={r.text[:150]}")

    # 5) No auth → 401
    r = requests.post(f"{API}/support/tickets", json=payload, timeout=10)
    record("POST /support/tickets no auth → 401", r.status_code == 401, f"got {r.status_code}")

    # 6) /me/support/tickets
    r = requests.get(f"{API}/me/support/tickets", headers=hdr("sophie"), timeout=10)
    ok = r.status_code == 200 and isinstance(r.json().get("items"), list) and r.json().get("count", 0) >= 1
    if ok:
        my_tids = [t.get("ticket_id") for t in r.json()["items"]]
        ok = ticket_id in my_tids
    record("GET /api/me/support/tickets as sophie includes new ticket", ok, f"status={r.status_code}")

    r = requests.get(f"{API}/me/support/tickets", timeout=10)
    record("GET /me/support/tickets no auth → 401", r.status_code == 401)

    # 7) Marco should NOT see sophie's ticket
    r = requests.get(f"{API}/me/support/tickets", headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200
    if ok:
        marco_tids = [t.get("ticket_id") for t in r.json().get("items", [])]
        ok = ticket_id not in marco_tids
    record("Marco /me/support/tickets does NOT leak sophie's", ok)

    # 8) Admin list
    r = requests.get(f"{API}/admin/support/tickets", headers=hdr("admin"), timeout=15)
    ok = r.status_code == 200 and isinstance(r.json().get("items"), list) and isinstance(r.json().get("counts"), dict)
    if ok:
        counts = r.json()["counts"]
        ok = all(k in counts for k in ("open", "pending", "resolved", "closed"))
    record("GET /api/admin/support/tickets as admin", ok, f"status={r.status_code}")

    # 9) Admin list filter by category
    r = requests.get(f"{API}/admin/support/tickets?category=billing", headers=hdr("admin"), timeout=15)
    ok = r.status_code == 200 and all(
        t.get("category") == "billing" for t in r.json().get("items", [])
    )
    record("Admin list ?category=billing filters", ok, f"status={r.status_code}")

    # 10) Non-staff → 403
    r = requests.get(f"{API}/admin/support/tickets", headers=hdr("sophie"), timeout=10)
    record("Sophie GET /admin/support/tickets → 403", r.status_code == 403, f"got {r.status_code}")

    r = requests.get(f"{API}/admin/support/tickets", timeout=10)
    record("No-auth GET /admin/support/tickets → 401", r.status_code == 401, f"got {r.status_code}")

    # 11) Admin reply
    if not ticket_id:
        record("reply — skipped (no ticket_id)", False, "ticket creation failed")
        return

    r = requests.post(f"{API}/admin/support/tickets/{ticket_id}/reply",
                      json={"body": "Hey Sophie, can you share the device OS version? Thanks."},
                      headers=hdr("admin"), timeout=15)
    ok = r.status_code == 200 and r.json().get("ok") is True and r.json().get("reply", {}).get("from") == "staff"
    record("POST /admin/support/tickets/{id}/reply", ok, f"status={r.status_code} body={r.text[:200]}")

    # Verify ticket status flipped to pending & reply appended
    r = requests.get(f"{API}/me/support/tickets", headers=hdr("sophie"), timeout=10)
    t = next((x for x in r.json().get("items", []) if x.get("ticket_id") == ticket_id), None)
    ok = t is not None and t.get("status") == "pending" and len(t.get("replies") or []) == 1
    record("Ticket flipped to status=pending with 1 reply", ok, f"state={t}")

    # 12) Reply by non-staff → 403
    r = requests.post(f"{API}/admin/support/tickets/{ticket_id}/reply",
                      json={"body": "hi from sophie"},
                      headers=hdr("sophie"), timeout=10)
    record("Sophie reply on admin route → 403", r.status_code == 403, f"got {r.status_code}")

    # 13) Reply with empty body → 400
    r = requests.post(f"{API}/admin/support/tickets/{ticket_id}/reply",
                      json={"body": "   "},
                      headers=hdr("admin"), timeout=10)
    record("Empty staff reply → 400", r.status_code == 400, f"got {r.status_code}")

    # 14) Reply on unknown ticket → 404
    r = requests.post(f"{API}/admin/support/tickets/sup_bogus_xxxxxxxx/reply",
                      json={"body": "hi"},
                      headers=hdr("admin"), timeout=10)
    record("Reply on bogus ticket → 404", r.status_code == 404, f"got {r.status_code}")

    # 15) Admin resolve
    r = requests.post(f"{API}/admin/support/tickets/{ticket_id}/resolve",
                      headers=hdr("admin"), timeout=10)
    record("POST /admin/support/tickets/{id}/resolve", r.status_code == 200 and r.json().get("ok") is True,
           f"status={r.status_code} body={r.text[:150]}")

    r = requests.get(f"{API}/me/support/tickets", headers=hdr("sophie"), timeout=10)
    t = next((x for x in r.json().get("items", []) if x.get("ticket_id") == ticket_id), None)
    record("Ticket status=resolved after resolve", t is not None and t.get("status") == "resolved",
           f"state={t}")

    # 16) Resolve non-existent ticket → 404
    r = requests.post(f"{API}/admin/support/tickets/sup_bogus_xxxxxxxx/resolve",
                      headers=hdr("admin"), timeout=10)
    record("Resolve bogus ticket → 404", r.status_code == 404, f"got {r.status_code}")

    r = requests.post(f"{API}/admin/support/tickets/{ticket_id}/resolve",
                      headers=hdr("sophie"), timeout=10)
    record("Non-staff resolve → 403", r.status_code == 403, f"got {r.status_code}")


# ============================================================================
# LOCAL GROUPS
# ============================================================================
def test_groups():
    print("\n=== Local Groups ===")

    # unique name to keep idempotent across runs
    uniq = uuid.uuid4().hex[:8]
    name = f"Austin Family Photographers QA {uniq}"
    payload = {
        "name": name,
        "tagline": "Monthly meetups for family/child photographers",
        "description": "We host portfolio shares, meetups, and collab shoots in ATX.",
        "city": "Austin",
        "state": "TX",
        "country": "US",
        "specialties": ["Family", "Children"],
        "visibility": "public",
    }

    # 1) sophie creates the group
    r = requests.post(f"{API}/groups", json=payload, headers=hdr("sophie"), timeout=15)
    ok = r.status_code == 200
    group_id = None
    if ok:
        j = r.json()
        group_id = j.get("group_id")
        ok = (
            group_id and group_id.startswith("grp_")
            and j.get("owner_user_id") == user_ids["sophie"]
            and j.get("name") == name
            and j.get("member_count") == 1
            and j.get("post_count") == 0
            and j.get("is_member") is True
            and j.get("my_role") == "owner"
        )
    record("POST /api/groups as sophie (auto-owner)", ok, f"status={r.status_code} body={r.text[:250]}")

    if not group_id:
        record("groups flow aborted — no group_id", False, "create failed")
        return

    # 2) Name < 3 chars → 400
    r = requests.post(f"{API}/groups", json={"name": "ab"}, headers=hdr("sophie"), timeout=10)
    record("Short group name → 400", r.status_code == 400, f"got {r.status_code}")

    # 3) Duplicate name+city → 409
    r = requests.post(f"{API}/groups", json=payload, headers=hdr("marco"), timeout=10)
    record("Duplicate name+city → 409", r.status_code == 409, f"got {r.status_code} body={r.text[:150]}")

    # 4) No auth → 401
    r = requests.post(f"{API}/groups", json=payload, timeout=10)
    record("Create without auth → 401", r.status_code == 401)

    # 5) GET /api/groups (list)
    r = requests.get(f"{API}/groups", headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200 and isinstance(r.json().get("items"), list) and r.json().get("count", 0) >= 1
    if ok:
        gids = [g.get("group_id") for g in r.json()["items"]]
        ok = group_id in gids
    record("GET /api/groups lists the new group", ok, f"status={r.status_code}")

    # 6) ?q filter
    r = requests.get(f"{API}/groups", params={"q": f"QA {uniq}"}, headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200 and any(g.get("group_id") == group_id for g in r.json().get("items", []))
    record("GET /api/groups?q= filters", ok)

    # 7) ?city=Austin
    r = requests.get(f"{API}/groups", params={"city": "Austin"}, headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200 and all(g.get("city") == "Austin" for g in r.json().get("items", []))
    record("GET /api/groups?city=Austin filters", ok)

    # 8) ?mine as marco (not a member yet) — should NOT include this group
    r = requests.get(f"{API}/groups", params={"mine": "true"}, headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200 and not any(g.get("group_id") == group_id for g in r.json().get("items", []))
    record("GET /api/groups?mine=true (marco) excludes non-member group", ok,
           f"status={r.status_code}")

    # 9) GET /api/groups/{id} as marco
    r = requests.get(f"{API}/groups/{group_id}", headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200 and r.json().get("group_id") == group_id and r.json().get("is_member") is False
    record("GET /api/groups/{id} as marco (non-member)", ok, f"status={r.status_code}")

    # 10) Bogus id → 404
    r = requests.get(f"{API}/groups/grp_bogus_xxxxxxx", headers=hdr("marco"), timeout=10)
    record("GET /groups/bogus → 404", r.status_code == 404)

    # 11) POST /groups/{id}/join as marco
    r = requests.post(f"{API}/groups/{group_id}/join", headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200 and r.json().get("is_member") is True and r.json().get("my_role") == "member"
    record("POST /groups/{id}/join (marco)", ok, f"status={r.status_code} body={r.text[:200]}")

    # 12) Idempotent join
    r = requests.post(f"{API}/groups/{group_id}/join", headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200 and r.json().get("member_count") == 2
    record("Repeat join (idempotent, member_count stays 2)", ok, f"status={r.status_code}")

    # 13) ?mine=true now includes it for marco
    r = requests.get(f"{API}/groups?mine=true", headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200 and any(g.get("group_id") == group_id for g in r.json().get("items", []))
    record("GET /groups?mine=true now includes group for marco", ok)

    # 14) Members endpoint
    r = requests.get(f"{API}/groups/{group_id}/members", headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200 and r.json().get("count") == 2
    if ok:
        roles = {m.get("user_id"): m.get("role") for m in r.json()["items"]}
        ok = (
            roles.get(user_ids["sophie"]) == "owner"
            and roles.get(user_ids["marco"]) == "member"
        )
        shape_ok = all(m.get("profile") and "username" in m["profile"] for m in r.json()["items"])
        ok = ok and shape_ok
    record("GET /api/groups/{id}/members has 2 with correct roles + hydrated profile", ok)

    # 15) POST /posts as marco (member) → success
    r = requests.post(
        f"{API}/posts",
        json={
            "category": "meetup",
            "title": "QA test post scoped to group",
            "body": "Hey team — practicing the group-scoped composer.",
            "group_id": group_id,
        },
        headers=hdr("marco"),
        timeout=15,
    )
    ok = r.status_code == 200 and r.json().get("group_id") == group_id
    group_post_id = r.json().get("post_id") if ok else None
    record("POST /api/posts with group_id (marco = member)", ok, f"status={r.status_code} body={r.text[:250]}")

    # 16) GET /groups/{id}/posts
    r = requests.get(f"{API}/groups/{group_id}/posts", headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200 and r.json().get("count") >= 1
    if ok and group_post_id:
        pids = [p.get("post_id") for p in r.json()["items"]]
        ok = group_post_id in pids
        # author hydration
        first = r.json()["items"][0]
        ok = ok and first.get("author") and first["author"].get("username")
    record("GET /api/groups/{id}/posts returns the new post with author hydrated", ok,
           f"status={r.status_code}")

    # 17) Non-member tries to post with group_id → 403
    #     Use admin (not a member)
    r = requests.post(
        f"{API}/posts",
        json={
            "category": "meetup",
            "title": "Admin trying to post to group",
            "body": "Should fail with 403.",
            "group_id": group_id,
        },
        headers=hdr("admin"),
        timeout=10,
    )
    record("POST /posts with group_id by non-member → 403", r.status_code == 403,
           f"got {r.status_code} body={r.text[:200]}")

    # 18) Post with bogus group_id → 404
    r = requests.post(
        f"{API}/posts",
        json={
            "category": "meetup",
            "title": "Bogus group post",
            "body": "x",
            "group_id": "grp_bogus_xxxxxxx",
        },
        headers=hdr("sophie"),
        timeout=10,
    )
    record("POST /posts with bogus group_id → 404", r.status_code == 404, f"got {r.status_code}")

    # 19) Owner cannot leave
    r = requests.delete(f"{API}/groups/{group_id}/join", headers=hdr("sophie"), timeout=10)
    record("Owner DELETE /join → 400 ('Owner cannot leave')", r.status_code == 400,
           f"got {r.status_code} body={r.text[:150]}")

    # 20) Marco leaves
    r = requests.delete(f"{API}/groups/{group_id}/join", headers=hdr("marco"), timeout=10)
    ok = r.status_code == 200 and r.json().get("is_member") is False and r.json().get("member_count") == 1
    record("Marco DELETE /join → 200, member_count=1", ok, f"status={r.status_code} body={r.text[:200]}")

    # 21) After leaving, attempting group-scoped post again → 403
    r = requests.post(
        f"{API}/posts",
        json={
            "category": "meetup",
            "title": "Marco post after leaving",
            "body": "should fail",
            "group_id": group_id,
        },
        headers=hdr("marco"),
        timeout=10,
    )
    record("Marco post-after-leave → 403", r.status_code == 403, f"got {r.status_code}")

    # 22) Leave non-existent group → 404
    r = requests.delete(f"{API}/groups/grp_bogus_xxxxxxx/join", headers=hdr("marco"), timeout=10)
    record("Leave bogus group → 404", r.status_code == 404)

    # 23) No auth on list
    r = requests.get(f"{API}/groups", timeout=10)
    record("GET /api/groups no auth → 401", r.status_code == 401, f"got {r.status_code}")


# ============================================================================
def main():
    print(f"Target: {API}")
    login_all()
    test_support()
    test_groups()
    print(f"\n=== SUMMARY === PASS={passes} FAIL={fails}")
    if failures:
        print("\nFailures:")
        for n, d in failures:
            print(f"  - {n}: {d}")
    sys.exit(0 if fails == 0 else 1)


if __name__ == "__main__":
    main()
