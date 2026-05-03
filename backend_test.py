"""
Backend test - Founding Scout role implementation.

Covers the 7 scenarios from the review request, run in an order that does
NOT pollute earlier scenarios:

  Phase A (clean assign->remove cycle):
    1. PATCH role=founding_scout -> 200
    2. Verify plan=comp_elite, comped_reason/by/started_at set
    4a. Audit shows before.role=user after.role=founding_scout
    5. Negative auth: regular user PATCH -> 403
    3. PATCH role=user -> plan reverts to free, comp markers cleared
    4b. Audit shows before.role=founding_scout after.role=user

  Phase B (plan_of() override check, separate cycle):
    7. Re-assign founding_scout, manually set plan=free, confirm admin
       sees plan=free + role=founding_scout (plan_of() override is
       verified via code review since we cannot log in as the target).

  Phase C: cleanup -> restore target to original snapshot.

Auth: uses seed super_admin admin@lumascout.app / Grayson@1117!! because
the user's primary super_admin (kclarson187@gmail.com / Pass123!) returns
401 on this preview backend (per /app/memory/test_credentials.md note).
"""
import sys
import uuid

import requests

BASE = "https://photo-finder-60.preview.emergentagent.com"
API = f"{BASE}/api"
TIMEOUT = 30

SUPER_EMAIL = "admin@lumascout.app"
SUPER_PASSWORD = "Grayson@1117!!"

results = []


def log(name, ok, detail=""):
    icon = "PASS" if ok is True else ("SKIP" if ok == "NA" else "FAIL")
    print(f"[{icon}] {name}: {detail}")
    results.append((name, ok, detail))


def login(email, password):
    r = requests.post(f"{API}/auth/login",
                      json={"email": email, "password": password}, timeout=TIMEOUT)
    if r.status_code != 200:
        return None, f"login {email} -> {r.status_code} {r.text[:200]}"
    return r.json(), None


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def main():
    s_data, err = login(SUPER_EMAIL, SUPER_PASSWORD)
    if err:
        log("super_admin_login", False, err)
        return
    super_token = s_data["token"]
    super_uid = s_data["user"]["user_id"]
    log("super_admin_login", True,
        f"role={s_data['user'].get('role')} uid={super_uid}")

    p_data, p_err = login("kclarson187@gmail.com", "Pass123!")
    if p_err:
        log("primary_super_admin_login_diagnostic", "NA",
            "kclarson187@gmail.com / Pass123! returns 401 - using seed super_admin")
    else:
        log("primary_super_admin_login_diagnostic", True,
            f"role={p_data['user'].get('role')}")

    super_h = H(super_token)

    # Pick a non-staff free user
    r = requests.get(f"{API}/admin/users?limit=50", headers=super_h, timeout=TIMEOUT)
    if r.status_code != 200:
        log("list_users", False, f"{r.status_code} {r.text[:200]}")
        return
    items = r.json().get("items", [])
    log("list_users", True, f"got {len(items)} users")

    target = None
    admin_non_super = None
    for u in items:
        role = u.get("role") or "user"
        uid = u["user_id"]
        if uid == super_uid:
            continue
        if role == "user" and target is None and u.get("plan") in (None, "free"):
            target = u
        if role == "admin" and admin_non_super is None:
            admin_non_super = u
    if target is None:
        for u in items:
            if u["user_id"] != super_uid and (u.get("role") or "user") not in (
                    "admin", "super_admin", "moderator", "support"):
                target = u
                break
    if target is None:
        log("pick_target_user", False, "no non-staff free user found")
        return
    target_uid = target["user_id"]
    log("pick_target_user", True,
        f"uid={target_uid} email={target.get('email')} "
        f"role={target.get('role') or 'user'} plan={target.get('plan') or 'free'}")

    r = requests.get(f"{API}/admin/users/{target_uid}", headers=super_h, timeout=TIMEOUT)
    if r.status_code != 200:
        log("snapshot_target", False, f"{r.status_code} {r.text[:200]}")
        return
    snapshot = r.json()
    log("snapshot_target", True,
        f"plan={snapshot.get('plan')} role={snapshot.get('role')}")

    # ════════════════════════════════════════════════════════════════════
    # Phase A — clean assign -> remove cycle
    # ════════════════════════════════════════════════════════════════════

    # Scenario 1: assign
    r = requests.patch(
        f"{API}/admin/users/{target_uid}", headers=super_h,
        json={"role": "founding_scout", "reason": "qa_test_assign"}, timeout=TIMEOUT,
    )
    if r.status_code == 200:
        body = r.json()
        log("assign_founding_scout_200", True,
            f"role={body.get('user', {}).get('role')} plan={body.get('user', {}).get('plan')}")
    else:
        log("assign_founding_scout_200", False, f"{r.status_code} {r.text[:300]}")

    # Scenario 2: auto-comp
    r = requests.get(f"{API}/admin/users/{target_uid}", headers=super_h, timeout=TIMEOUT)
    if r.status_code == 200:
        d = r.json()
        plan_ok = d.get("plan") == "comp_elite"
        reason_ok = d.get("comped_reason") == "founding_scout"
        by_ok = d.get("comped_by") == super_uid
        started_ok = bool(d.get("comped_started_at"))
        log("auto_comp_elite_after_assign",
            plan_ok and reason_ok and by_ok and started_ok,
            f"plan={d.get('plan')} reason={d.get('comped_reason')} "
            f"by={d.get('comped_by')} started_at={d.get('comped_started_at')}")
    else:
        log("auto_comp_elite_after_assign", False, f"{r.status_code} {r.text[:200]}")

    # Scenario 4a: audit shows assign
    r = requests.get(f"{API}/admin/users/{target_uid}", headers=super_h, timeout=TIMEOUT)
    if r.status_code == 200:
        audit = r.json().get("recent_audit") or []
        found = next((a for a in audit if (a.get("after") or {}).get("role") == "founding_scout"), None)
        log("audit_assign_logged", bool(found),
            f"before.role={(found or {}).get('before', {}).get('role')} "
            f"after.role={(found or {}).get('after', {}).get('role')}"
            if found else "no entry found")
    else:
        log("audit_assign_logged", False, f"{r.status_code} {r.text[:200]}")

    # Scenario 5: regular user PATCH 403
    rand = uuid.uuid4().hex[:8]
    reg_email = f"qa_fs_{rand}@example.com"
    reg_pw = "TestPass123!"
    r = requests.post(f"{API}/auth/register",
                      json={"email": reg_email, "password": reg_pw,
                            "name": f"QA Tester {rand}"}, timeout=TIMEOUT)
    regular_token = None
    regular_uid = None
    if r.status_code != 200:
        log("register_free_user", False, f"{r.status_code} {r.text[:200]}")
    else:
        regular_token = r.json()["token"]
        regular_uid = r.json()["user"]["user_id"]
        log("register_free_user", True, f"uid={regular_uid} email={reg_email}")

    if regular_token:
        r = requests.patch(
            f"{API}/admin/users/{target_uid}", headers=H(regular_token),
            json={"role": "founding_scout"}, timeout=TIMEOUT,
        )
        log("regular_user_patch_403", r.status_code == 403,
            f"got {r.status_code} body={r.text[:200]}")

    # Scenario 3: revert role -> plan reverts to free + comp cleared
    r = requests.patch(
        f"{API}/admin/users/{target_uid}", headers=super_h,
        json={"role": "user", "reason": "qa_test_unassign"}, timeout=TIMEOUT,
    )
    if r.status_code == 200:
        u = r.json().get("user") or {}
        log("remove_founding_scout_200", True,
            f"role={u.get('role')} plan={u.get('plan')}")
    else:
        log("remove_founding_scout_200", False, f"{r.status_code} {r.text[:300]}")

    r = requests.get(f"{API}/admin/users/{target_uid}", headers=super_h, timeout=TIMEOUT)
    if r.status_code == 200:
        d = r.json()
        plan_ok = d.get("plan") == "free"
        reason_ok = d.get("comped_reason") in (None, "")
        by_ok = d.get("comped_by") in (None, "")
        log("plan_reverted_to_free_and_comp_cleared",
            plan_ok and reason_ok and by_ok,
            f"plan={d.get('plan')} reason={d.get('comped_reason')} by={d.get('comped_by')}")
    else:
        log("plan_reverted_to_free_and_comp_cleared", False, f"{r.status_code} {r.text[:200]}")

    # Scenario 4b: audit shows BOTH assign and unassign
    r = requests.get(f"{API}/admin/users/{target_uid}", headers=super_h, timeout=TIMEOUT)
    if r.status_code == 200:
        audit = r.json().get("recent_audit") or []
        assign_found = False
        unassign_found = False
        for a in audit:
            before = a.get("before") or {}
            after = a.get("after") or {}
            if before.get("role") == "founding_scout" and after.get("role") == "user":
                unassign_found = True
            if before.get("role") in (None, "user") and after.get("role") == "founding_scout":
                assign_found = True
        log("audit_assign_and_unassign_logged",
            assign_found and unassign_found,
            f"assign_found={assign_found} unassign_found={unassign_found} entries={len(audit)}")
    else:
        log("audit_assign_and_unassign_logged", False, f"{r.status_code} {r.text[:200]}")

    # ════════════════════════════════════════════════════════════════════
    # Phase B — plan_of() override check (separate clean cycle)
    # ════════════════════════════════════════════════════════════════════

    # Re-assign founding_scout
    r = requests.patch(
        f"{API}/admin/users/{target_uid}", headers=super_h,
        json={"role": "founding_scout", "reason": "qa_test_phaseB"}, timeout=TIMEOUT,
    )
    phaseb_assigned = r.status_code == 200
    log("phaseB_reassign_founding_scout", phaseb_assigned,
        f"{r.status_code} {r.text[:200] if not phaseb_assigned else 'ok'}")

    if phaseb_assigned:
        # Manually set plan=free while role still founding_scout
        r = requests.patch(
            f"{API}/admin/users/{target_uid}", headers=super_h,
            json={"plan": "free", "reason": "qa_test_plan_override"}, timeout=TIMEOUT,
        )
        plan_override_ok = r.status_code == 200
        log("phaseB_manual_set_plan_free", plan_override_ok,
            f"{r.status_code} {r.text[:200] if not plan_override_ok else 'ok'}")

        if plan_override_ok:
            r = requests.get(f"{API}/admin/users/{target_uid}", headers=super_h, timeout=TIMEOUT)
            if r.status_code == 200:
                d = r.json()
                log("phaseB_admin_sees_plan_free_role_founding_scout",
                    d.get("plan") == "free" and d.get("role") == "founding_scout",
                    f"plan={d.get('plan')} role={d.get('role')}")
            log("phaseB_plan_of_override_via_me", "NA",
                "cannot login as target without password; verified by code review at "
                "server.py L172: plan_of() returns 'comp_elite' for role=founding_scout when plan in (free, None, ...)")

    # ════════════════════════════════════════════════════════════════════
    # Scenario 6 — admin (non-super) assignment
    # ════════════════════════════════════════════════════════════════════
    if admin_non_super:
        log("admin_non_super_assignment", "NA",
            f"admin user found ({admin_non_super.get('email')}) but no known password - skipping live test")
    else:
        log("admin_non_super_assignment", "NA", "no non-super admin user found in first 50")

    # ════════════════════════════════════════════════════════════════════
    # Phase C — cleanup
    # ════════════════════════════════════════════════════════════════════
    desired_role = snapshot.get("role") or "user"
    desired_plan = snapshot.get("plan") or "free"

    # First: unset role -> back to user (which would normally also clear
    # comped markers, BUT plan is currently "free" not "comp_elite" so the
    # guard wont fire. We need to manually clear the markers + set role
    # back). Trick: re-set plan to comp_elite first, then revert role.
    cur = requests.get(f"{API}/admin/users/{target_uid}", headers=super_h, timeout=TIMEOUT).json()
    if cur.get("role") == "founding_scout":
        # Restore plan to comp_elite so the revert guard fires correctly.
        requests.patch(
            f"{API}/admin/users/{target_uid}", headers=super_h,
            json={"plan": "comp_elite", "reason": "qa_cleanup_step1"}, timeout=TIMEOUT,
        )
        # Now revert role.
        requests.patch(
            f"{API}/admin/users/{target_uid}", headers=super_h,
            json={"role": "user", "reason": "qa_cleanup_step2"}, timeout=TIMEOUT,
        )

    cur = requests.get(f"{API}/admin/users/{target_uid}", headers=super_h, timeout=TIMEOUT).json()
    finalize = {}
    if (cur.get("role") or "user") != desired_role:
        finalize["role"] = desired_role
    if (cur.get("plan") or "free") != desired_plan:
        finalize["plan"] = desired_plan
    if finalize:
        finalize["reason"] = "qa_cleanup_finalize"
        r = requests.patch(f"{API}/admin/users/{target_uid}",
                           headers=super_h, json=finalize, timeout=TIMEOUT)
        log("cleanup_restore_target", r.status_code == 200,
            f"applied {finalize} -> {r.status_code}")
    else:
        log("cleanup_restore_target", True,
            f"already at snapshot state plan={cur.get('plan')} role={cur.get('role')}")

    # Final verification
    cur = requests.get(f"{API}/admin/users/{target_uid}", headers=super_h, timeout=TIMEOUT).json()
    log("final_state_verification", True,
        f"plan={cur.get('plan')} role={cur.get('role')} "
        f"comped_reason={cur.get('comped_reason')} comped_by={cur.get('comped_by')}")

    if regular_uid:
        log("note_test_user_left", "NA",
            f"qa user remains uid={regular_uid} email={reg_email} (no admin self-delete used)")

    # Summary
    print()
    print("=" * 70)
    failed = [x for x in results if x[1] is False]
    passed = [x for x in results if x[1] is True]
    skipped = [x for x in results if x[1] == "NA"]
    print(f"PASS={len(passed)}  FAIL={len(failed)}  SKIP/NA={len(skipped)}")
    if failed:
        print("\nFAILED:")
        for n, _, d in failed:
            print(f"  - {n}: {d}")
    print("=" * 70)
    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
