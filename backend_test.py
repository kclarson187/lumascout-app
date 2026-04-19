"""PhotoScout Admin Dashboard Phase 1 backend validation.

Scope: /api/admin/* endpoints under the test_plan.current_focus list in
/app/test_result.md.
"""
import sys
import requests
from typing import Any, Optional

BASE = "https://photo-finder-60.preview.emergentagent.com/api"

SUPER_ADMIN = {"email": "admin@photoscout.app", "password": "admin123"}
SOPHIE = {"email": "sophie@photoscout.app", "password": "demo123"}


class TestRun:
    def __init__(self):
        self.passed: list[str] = []
        self.failed: list[tuple[str, str]] = []

    def check(self, name: str, cond: bool, detail: str = ""):
        if cond:
            self.passed.append(name)
            print(f"  PASS  {name}")
        else:
            self.failed.append((name, detail))
            print(f"  FAIL  {name}  — {detail}")

    def summary(self):
        print("\n" + "=" * 70)
        print(f"PASSED: {len(self.passed)}   FAILED: {len(self.failed)}")
        if self.failed:
            print("\nFAILURES:")
            for name, detail in self.failed:
                print(f"  - {name}")
                if detail:
                    print(f"      {detail}")
        print("=" * 70)


def login(creds: dict) -> dict:
    r = requests.post(f"{BASE}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["token"], "user": data["user"]}


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def trim(s: Any, n: int = 200) -> str:
    s = str(s)
    return s if len(s) <= n else s[:n] + "…"


def main():
    t = TestRun()

    print("\n=== LOGIN ===")
    admin = login(SUPER_ADMIN)
    sophie = login(SOPHIE)
    admin_id = admin["user"]["user_id"]
    sophie_id = sophie["user"]["user_id"]
    admin_role = admin["user"].get("role")
    print(f"admin user_id={admin_id}  role={admin_role}")
    print(f"sophie user_id={sophie_id}  role={sophie['user'].get('role')}  plan={sophie['user'].get('plan')}")

    t.check(
        "admin@ auto-promoted to super_admin on startup",
        admin_role == "super_admin",
        f"expected super_admin, got {admin_role!r}",
    )

    hAdmin = auth_headers(admin["token"])
    hSophie = auth_headers(sophie["token"])

    # ------------------------------------------------------------------
    # 1) AUTH GUARDS
    # ------------------------------------------------------------------
    print("\n=== 1) AUTH GUARDS (non-admin → 403) ===")
    guard_cases = [
        ("GET /admin/overview", "GET", "/admin/overview", None),
        ("GET /admin/users", "GET", "/admin/users", None),
        (f"GET /admin/users/{sophie_id}", "GET", f"/admin/users/{sophie_id}", None),
        (f"PATCH /admin/users/{sophie_id}", "PATCH", f"/admin/users/{sophie_id}", {"plan": "pro"}),
        (f"POST /admin/users/{sophie_id}/notes", "POST", f"/admin/users/{sophie_id}/notes", {"body": "x"}),
        ("GET /admin/audit-logs", "GET", "/admin/audit-logs", None),
        ("GET /admin/analytics", "GET", "/admin/analytics", None),
        ("GET /admin/settings", "GET", "/admin/settings", None),
        ("PATCH /admin/settings", "PATCH", "/admin/settings", {"maintenance_mode": True}),
    ]
    for label, method, path, body in guard_cases:
        url = f"{BASE}{path}"
        if method == "GET":
            r = requests.get(url, headers=hSophie, timeout=30)
        elif method == "PATCH":
            r = requests.patch(url, headers=hSophie, json=body, timeout=30)
        elif method == "POST":
            r = requests.post(url, headers=hSophie, json=body, timeout=30)
        t.check(
            f"[guard] {label} → 403",
            r.status_code == 403,
            f"got {r.status_code} body={trim(r.text)}",
        )

    # ------------------------------------------------------------------
    # 2) SUPER_ADMIN endpoints
    # ------------------------------------------------------------------
    print("\n=== 2) SUPER ADMIN ENDPOINTS ===")

    r = requests.get(f"{BASE}/admin/overview", headers=hAdmin, timeout=30)
    t.check("GET /admin/overview → 200", r.status_code == 200, f"{r.status_code} {trim(r.text)}")
    if r.status_code == 200:
        j = r.json()
        users_shape = j.get("users") or {}
        by_plan = users_shape.get("by_plan") or {}
        moderation = j.get("moderation") or {}
        revenue = j.get("revenue") or {}
        t.check(
            "overview.users.{total,new_today,active_7d,suspended}",
            all(k in users_shape for k in ("total", "new_today", "active_7d", "suspended")),
            f"got keys {list(users_shape.keys())}",
        )
        t.check(
            "overview.users.by_plan.{free,pro,elite}",
            all(k in by_plan for k in ("free", "pro", "elite")),
            f"got {by_plan}",
        )
        t.check(
            "overview.moderation.{pending_spots,pending_reports,pending_photos}",
            all(k in moderation for k in ("pending_spots", "pending_reports", "pending_photos")),
            f"got {moderation}",
        )
        t.check("overview.top_contributors is array", isinstance(j.get("top_contributors"), list))
        t.check("overview.top_cities is array", isinstance(j.get("top_cities"), list))
        t.check(
            "overview.revenue.monthly_estimate_usd is number",
            isinstance(revenue.get("monthly_estimate_usd"), (int, float)),
            f"got {revenue}",
        )

    r = requests.get(f"{BASE}/admin/users", headers=hAdmin, params={"q": "sophie"}, timeout=30)
    t.check("GET /admin/users?q=sophie → 200", r.status_code == 200, trim(r.text))
    if r.status_code == 200:
        j = r.json()
        t.check("users?q=sophie total >= 1", j.get("total", 0) >= 1, f"total={j.get('total')}")
        items = j.get("items", [])
        if items:
            first = items[0]
            t.check(
                "items[0].email contains 'sophie'",
                "sophie" in (first.get("email") or "").lower(),
                f"email={first.get('email')}",
            )
            t.check(
                "items[0] has NO password_hash",
                "password_hash" not in first,
                f"keys={list(first.keys())}",
            )
            required_enrich = ("plan", "role", "status", "spot_count", "open_reports")
            t.check(
                "items[0] has plan/role/status/spot_count/open_reports",
                all(k in first for k in required_enrich),
                f"missing: {[k for k in required_enrich if k not in first]}",
            )
        else:
            t.check("items non-empty for q=sophie", False, "empty items")

    r = requests.get(
        f"{BASE}/admin/users",
        headers=hAdmin,
        params={"role": "user", "plan": "free", "page": 1, "limit": 2},
        timeout=30,
    )
    t.check("GET /admin/users (role=user&plan=free&page=1&limit=2) → 200", r.status_code == 200, trim(r.text))
    if r.status_code == 200:
        j = r.json()
        items = j.get("items", [])
        t.check("items.length <= 2", len(items) <= 2, f"len={len(items)}")
        t.check("page == 1", j.get("page") == 1, f"page={j.get('page')}")
        t.check("limit == 2", j.get("limit") == 2, f"limit={j.get('limit')}")
        total = j.get("total", 0)
        expected_pages = (total + 2 - 1) // 2 if total > 0 else 0
        t.check(
            "pages computed correctly",
            j.get("pages") == expected_pages,
            f"pages={j.get('pages')} total={total} expected={expected_pages}",
        )

    r = requests.get(f"{BASE}/admin/users/{sophie_id}", headers=hAdmin, timeout=30)
    t.check(f"GET /admin/users/{sophie_id} → 200", r.status_code == 200, trim(r.text))
    if r.status_code == 200:
        u = r.json()
        t.check("notes is array", isinstance(u.get("notes"), list))
        t.check("recent_audit is array", isinstance(u.get("recent_audit"), list))
        t.check("recent_spots is array", isinstance(u.get("recent_spots"), list))
        for k in ("plan", "role", "status", "spot_count", "save_count", "open_reports"):
            t.check(f"user detail has {k}", k in u, f"keys={list(u.keys())}")

    r = requests.patch(
        f"{BASE}/admin/users/{sophie_id}",
        headers=hAdmin,
        json={"plan": "pro", "reason": "test plan"},
        timeout=30,
    )
    t.check("PATCH sophie {plan:pro,reason:...} → 200", r.status_code == 200, trim(r.text))

    r2 = requests.get(
        f"{BASE}/admin/audit-logs",
        headers=hAdmin,
        params={"action": "user.update"},
        timeout=30,
    )
    t.check("GET /admin/audit-logs?action=user.update → 200", r2.status_code == 200, trim(r2.text))
    if r2.status_code == 200:
        items = r2.json().get("items", [])
        if items:
            top = items[0]
            before = top.get("before") or {}
            after = top.get("after") or {}
            t.check(
                "top audit action starts with user.update",
                (top.get("action") or "").startswith("user.update"),
                f"action={top.get('action')}",
            )
            t.check(
                "top audit has admin_user_id set",
                bool(top.get("admin_user_id")),
                f"admin_user_id={top.get('admin_user_id')}",
            )
            t.check(
                "top audit has before.plan/after.plan",
                "plan" in before and "plan" in after,
                f"before={before} after={after}",
            )
        else:
            t.check("audit-logs has entries for user.update", False, "empty")

    r = requests.patch(
        f"{BASE}/admin/users/{sophie_id}",
        headers=hAdmin,
        json={"plan": "bogus"},
        timeout=30,
    )
    t.check("PATCH sophie {plan:bogus} → 400", r.status_code == 400, f"got {r.status_code} {trim(r.text)}")

    r = requests.patch(
        f"{BASE}/admin/users/{admin_id}",
        headers=hAdmin,
        json={"role": "admin"},
        timeout=30,
    )
    t.check(
        "PATCH self role=admin (super_admin) → 400",
        r.status_code == 400,
        f"got {r.status_code} {trim(r.text)}",
    )

    r = requests.post(
        f"{BASE}/admin/users/{sophie_id}/notes",
        headers=hAdmin,
        json={"body": "chargeback risk"},
        timeout=30,
    )
    t.check(
        "POST /admin/users/{id}/notes {body:'chargeback risk'} → 200",
        r.status_code == 200,
        trim(r.text),
    )
    r = requests.get(f"{BASE}/admin/users/{sophie_id}", headers=hAdmin, timeout=30)
    if r.status_code == 200:
        notes = r.json().get("notes") or []
        t.check(
            "notes[] contains 'chargeback risk'",
            any("chargeback risk" in (n.get("body") or "") for n in notes),
            f"notes={[n.get('body') for n in notes[:3]]}",
        )

    r = requests.get(f"{BASE}/admin/analytics", headers=hAdmin, params={"days": 30}, timeout=30)
    t.check("GET /admin/analytics?days=30 → 200", r.status_code == 200, trim(r.text))
    if r.status_code == 200:
        j = r.json()
        series = j.get("series") or []
        totals = j.get("totals") or {}
        t.check("series.length == 30", len(series) == 30, f"len={len(series)}")
        sum_signups = sum(s.get("signups", 0) for s in series)
        t.check(
            "totals.signups == sum(series.signups)",
            totals.get("signups") == sum_signups,
            f"totals.signups={totals.get('signups')} sum={sum_signups}",
        )
        t.check("most_saved is array", isinstance(j.get("most_saved"), list))

    r = requests.get(f"{BASE}/admin/settings", headers=hAdmin, timeout=30)
    t.check("GET /admin/settings → 200", r.status_code == 200, trim(r.text))
    if r.status_code == 200:
        s = r.json()
        for k in ("app_name", "maintenance_mode", "public_registration"):
            t.check(f"settings has {k}", k in s, f"keys={list(s.keys())}")

    r = requests.patch(
        f"{BASE}/admin/settings",
        headers=hAdmin,
        json={"support_email": "test@photoscout.app"},
        timeout=30,
    )
    t.check("PATCH /admin/settings → 200", r.status_code == 200, trim(r.text))
    if r.status_code == 200:
        j = r.json()
        t.check("PATCH /admin/settings → ok=true", j.get("ok") is True, f"body={trim(j)}")
        t.check(
            "PATCH returns settings with new support_email",
            (j.get("settings") or {}).get("support_email") == "test@photoscout.app",
            f"settings={trim(j.get('settings'))}",
        )
    r = requests.get(f"{BASE}/admin/settings", headers=hAdmin, timeout=30)
    if r.status_code == 200:
        t.check(
            "subsequent GET /admin/settings has new support_email",
            r.json().get("support_email") == "test@photoscout.app",
            f"support_email={r.json().get('support_email')}",
        )

    # ------------------------------------------------------------------
    # 3) REGRESSION
    # ------------------------------------------------------------------
    print("\n=== 3) REGRESSION (approve + resolve + audit) ===")

    r = requests.get(f"{BASE}/admin/pending", headers=hAdmin, timeout=30)
    t.check("GET /admin/pending → 200", r.status_code == 200, trim(r.text))
    pending = r.json() if r.status_code == 200 else []
    t.check("GET /admin/pending returns array", isinstance(pending, list), f"type={type(pending)}")

    approved_spot_id: Optional[str] = None
    if pending:
        approved_spot_id = pending[0].get("spot_id")
        r = requests.post(
            f"{BASE}/admin/spots/{approved_spot_id}/approve",
            headers=hAdmin,
            timeout=30,
        )
        t.check(
            f"POST /admin/spots/{approved_spot_id}/approve → 200",
            r.status_code == 200,
            trim(r.text),
        )
        r2 = requests.get(
            f"{BASE}/admin/audit-logs",
            headers=hAdmin,
            params={"action": "spot.approve"},
            timeout=30,
        )
        if r2.status_code == 200:
            items = r2.json().get("items", [])
            matches = [it for it in items if it.get("target_id") == approved_spot_id]
            t.check(
                "audit entry exists for spot.approve with matching target_id",
                len(matches) > 0,
                f"no match; sample={[it.get('target_id') for it in items[:3]]}",
            )
    else:
        print("  (no pending spots; seeding one)")
        spot_body = {
            "title": "Regression Test Pending Spot",
            "description": "Seeded for admin regression test",
            "latitude": 30.27,
            "longitude": -97.74,
            "city": "Austin",
            "state": "TX",
            "privacy_mode": "public",
        }
        rc = requests.post(f"{BASE}/spots", headers=hSophie, json=spot_body, timeout=30)
        if rc.status_code == 200:
            approved_spot_id = rc.json().get("spot_id")
            ra = requests.post(
                f"{BASE}/admin/spots/{approved_spot_id}/approve",
                headers=hAdmin,
                timeout=30,
            )
            t.check(
                f"POST /admin/spots/{approved_spot_id}/approve → 200 (seeded)",
                ra.status_code == 200,
                trim(ra.text),
            )
            r2 = requests.get(
                f"{BASE}/admin/audit-logs",
                headers=hAdmin,
                params={"action": "spot.approve", "target_id": approved_spot_id},
                timeout=30,
            )
            if r2.status_code == 200:
                items = r2.json().get("items", [])
                t.check(
                    "seeded audit entry for spot.approve matches target_id",
                    any(it.get("target_id") == approved_spot_id for it in items),
                    f"items={items[:2]}",
                )
            requests.delete(f"{BASE}/spots/{approved_spot_id}", headers=hAdmin, timeout=30)
        else:
            t.check("seed pending spot", False, f"{rc.status_code} {trim(rc.text)}")

    r = requests.get(f"{BASE}/admin/reports", headers=hAdmin, params={"status": "pending"}, timeout=30)
    report_id: Optional[str] = None
    if r.status_code == 200 and isinstance(r.json(), list) and r.json():
        report_id = r.json()[0].get("report_id")
    else:
        rs = requests.get(f"{BASE}/spots", timeout=30)
        if rs.status_code == 200 and rs.json():
            target_spot = rs.json()[0]
            rep = requests.post(
                f"{BASE}/reports",
                headers=hSophie,
                json={
                    "target_type": "spot",
                    "target_id": target_spot["spot_id"],
                    "reason": "wrong_info",
                    "details": "Backend regression seed",
                },
                timeout=30,
            )
            if rep.status_code == 200:
                report_id = rep.json().get("report_id")

    if report_id:
        r = requests.post(
            f"{BASE}/admin/reports/{report_id}/resolve",
            headers=hAdmin,
            json={"action": "dismissed"},
            timeout=30,
        )
        t.check(
            f"POST /admin/reports/{report_id}/resolve {{action:'dismissed'}} → 200",
            r.status_code == 200,
            trim(r.text),
        )
        r2 = requests.get(
            f"{BASE}/admin/audit-logs",
            headers=hAdmin,
            params={"action": "report.resolve.dismissed"},
            timeout=30,
        )
        if r2.status_code == 200:
            items = r2.json().get("items", [])
            t.check(
                "audit entry action='report.resolve.dismissed' exists",
                any((it.get("action") == "report.resolve.dismissed") for it in items),
                f"sample={items[:1]}",
            )
    else:
        t.check("could find/seed a pending report", False, "no pending reports available")

    print("\n=== CLEANUP ===")
    rc = requests.patch(
        f"{BASE}/admin/users/{sophie_id}",
        headers=hAdmin,
        json={"plan": "pro"},
        timeout=30,
    )
    t.check("cleanup: set sophie.plan=pro → 200", rc.status_code == 200, trim(rc.text))

    t.summary()
    return 0 if not t.failed else 1


if __name__ == "__main__":
    sys.exit(main())
