"""
Membership Tier Conversion Update — backend validation.

Tests the new Free tier caps and updated paywall copy:
  T1. GET /api/plans (no auth) — 3 plans, new feature lists, prices
  T2. GET /api/auth/me (super_admin) — usage exposes uploads + outbound_threads_30d
  T3. Free outbound DM thread cap (3/month, 4th=402, replies don't count)
  T4. Free max_uploads cap (5, 6th=402, drafts don't count)
  T5. Free save cap regression (4th save=402)
  T6. Pro/Elite users not capped

Run:  python /app/backend_test_membership.py
"""

import os
import sys
import time
import uuid
import json
import requests
from typing import Optional, List, Tuple, Dict, Any

# ---------- Config ----------
FRONTEND_BACKEND_URL = "https://photo-finder-60.preview.emergentagent.com"
BASE = f"{FRONTEND_BACKEND_URL}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"
ADMIN_USER_ID = "user_6daa7d0a3abc"

QA_TLD = "lumascout-qa.com"
PNG_DATA_URI = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


# ---------- helpers ----------
PASSED = []
FAILED = []


def assert_eq(name: str, expected, actual):
    if expected == actual:
        PASSED.append(name)
        print(f"  PASS  {name}: {actual!r}")
    else:
        FAILED.append((name, f"expected {expected!r}, got {actual!r}"))
        print(f"  FAIL  {name}: expected {expected!r}, got {actual!r}")


def assert_true(name: str, cond, info=""):
    if cond:
        PASSED.append(name)
        print(f"  PASS  {name}")
    else:
        FAILED.append((name, info))
        print(f"  FAIL  {name} -- {info}")


def H(token: Optional[str] = None) -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def login(email: str, password: str) -> Tuple[str, dict]:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return j["token"], j["user"]


def register_free(label: str) -> Tuple[str, str]:
    """Register a fresh free-tier user, return (user_id, token)."""
    sfx = uuid.uuid4().hex[:8]
    email = f"qa_{label}_{sfx}@{QA_TLD}"
    r = requests.post(
        f"{BASE}/auth/register",
        json={
            "email": email,
            "password": "TestPass123!",
            "name": f"QA {label.title()} {sfx[:4]}",
        },
        timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"register failed for {email}: {r.status_code} {r.text}")
    j = r.json()
    return j["user"]["user_id"], j["token"]


# ============================================================
# T1. GET /api/plans
# ============================================================
def test_t1_plans():
    print("\n=== T1. GET /api/plans (no auth) ===")
    r = requests.get(f"{BASE}/plans", timeout=15)
    assert_eq("T1.status_200", 200, r.status_code)
    j = r.json()
    plans = j.get("plans", [])
    assert_eq("T1.plans_len_3", 3, len(plans))

    by_key = {p["key"]: p for p in plans}
    assert_eq("T1.has_free", True, "free" in by_key)
    assert_eq("T1.has_pro", True, "pro" in by_key)
    assert_eq("T1.has_elite", True, "elite" in by_key)

    free = by_key.get("free", {})
    pro = by_key.get("pro", {})
    elite = by_key.get("elite", {})

    assert_eq("T1.free.monthly_price", "$0", free.get("monthly_price"))
    assert_eq("T1.pro.monthly_price", "$9.99", pro.get("monthly_price"))
    assert_eq("T1.elite.monthly_price", "$19.99", elite.get("monthly_price"))

    free_features = [str(f) for f in free.get("features", [])]
    free_features_lower = [f.lower() for f in free_features]
    has_3_spots = any("3 spot" in f for f in free_features_lower)
    has_5_spots = any("5 spot" in f for f in free_features_lower)
    assert_true(
        "T1.free.features.contains_3_spots",
        has_3_spots,
        info=f"none of {free_features} mention '3 spot'",
    )
    assert_true(
        "T1.free.features.contains_5_spots",
        has_5_spots,
        info=f"none of {free_features} mention '5 spot'",
    )

    free_limits = free.get("limits", {})
    assert_eq("T1.free.limits.saves", 3, free_limits.get("saves"))
    assert_eq("T1.free.limits.collections", 0, free_limits.get("collections"))
    assert_eq("T1.free.limits.monthly_outbound_dms", 3, free_limits.get("monthly_outbound_dms"))
    assert_eq("T1.free.limits.active_routes", 1, free_limits.get("active_routes"))
    assert_eq("T1.free.limits.max_uploads", 5, free_limits.get("max_uploads"))

    pro_features = [str(f) for f in pro.get("features", [])]
    has_unlimited = any("unlimited" in f.lower() for f in pro_features)
    has_pro_badge = any(("pro creator badge" in f.lower()) or ("pro badge" in f.lower())
                        for f in pro_features)
    assert_true(
        "T1.pro.features.contains_Unlimited",
        has_unlimited,
        info=f"pro features: {pro_features}",
    )
    assert_true(
        "T1.pro.features.contains_pro_badge",
        has_pro_badge,
        info=f"pro features: {pro_features}",
    )

    elite_features = [str(f) for f in elite.get("features", [])]
    elite_lower = [f.lower() for f in elite_features]
    has_everything = any("everything in pro" in f for f in elite_lower)
    has_elite_extra = any(
        ("animated elite badge" in f)
        or ("sell curated spot packs" in f)
        or ("priority support" in f)
        for f in elite_lower
    )
    assert_true(
        "T1.elite.features.contains_Everything_in_Pro",
        has_everything,
        info=f"elite features: {elite_features}",
    )
    assert_true(
        "T1.elite.features.contains_at_least_one_extra",
        has_elite_extra,
        info=f"elite features: {elite_features}",
    )


# ============================================================
# T2. GET /api/auth/me as super_admin
# ============================================================
def test_t2_me(admin_token: str):
    print("\n=== T2. GET /api/auth/me as super_admin ===")
    r = requests.get(f"{BASE}/auth/me", headers=H(admin_token), timeout=15)
    assert_eq("T2.status_200", 200, r.status_code)
    j = r.json()
    assert_eq("T2.plan_elite", "elite", j.get("plan"))

    usage = j.get("usage", {})
    for key in ("saves", "private_spots", "collections", "uploads", "outbound_threads_30d"):
        assert_true(
            f"T2.usage.has.{key}",
            key in usage and isinstance(usage[key], (int, float)),
            info=f"usage={usage}",
        )

    limits = j.get("limits", {})
    assert_eq("T2.limits.monthly_outbound_dms", 10000, limits.get("monthly_outbound_dms"))
    assert_eq("T2.limits.max_uploads", 10000, limits.get("max_uploads"))
    assert_eq("T2.limits.active_routes", 10000, limits.get("active_routes"))


# ============================================================
# T3. Free-tier outbound DM thread cap
# ============================================================
def test_t3_outbound_threads():
    print("\n=== T3. Free-tier outbound DM thread cap (3/month) ===")
    # Create the protagonist free user
    u1_id, u1_token = register_free("dm_protag")
    print(f"  protagonist (free): {u1_id}")

    # Targets: super_admin (T1), then 3 fresh free users (T2, T3, T4)
    target_super = ADMIN_USER_ID
    u2_id, _ = register_free("dm_t2")
    u3_id, _ = register_free("dm_t3")
    u4_id, _ = register_free("dm_t4")

    # T3.1: thread #1 → super_admin
    r1 = requests.post(
        f"{BASE}/dm/threads/start",
        headers=H(u1_token),
        json={"user_id": target_super, "opening_body": "hello 1"},
        timeout=15,
    )
    assert_eq("T3.start_thread_1_to_super.status", 200, r1.status_code)
    j1 = r1.json() if r1.status_code == 200 else {}
    assert_true(
        "T3.start_thread_1.has_thread_id",
        bool(j1.get("thread_id")),
        info=f"body={j1}",
    )

    # T3.2: thread #2 → U2
    r2 = requests.post(
        f"{BASE}/dm/threads/start",
        headers=H(u1_token),
        json={"user_id": u2_id, "opening_body": "hello 2"},
        timeout=15,
    )
    assert_eq("T3.start_thread_2.status", 200, r2.status_code)

    # T3.3: thread #3 → U3
    r3 = requests.post(
        f"{BASE}/dm/threads/start",
        headers=H(u1_token),
        json={"user_id": u3_id, "opening_body": "hello 3"},
        timeout=15,
    )
    assert_eq("T3.start_thread_3.status", 200, r3.status_code)

    # T3.4: 4th (NEW target U4) → expect 402
    r4 = requests.post(
        f"{BASE}/dm/threads/start",
        headers=H(u1_token),
        json={"user_id": u4_id, "opening_body": "hello 4"},
        timeout=15,
    )
    assert_eq("T3.start_thread_4_blocked.status", 402, r4.status_code)
    detail = ""
    try:
        detail = (r4.json() or {}).get("detail", "")
    except Exception:
        detail = r4.text
    detail_lower = (detail or "").lower()
    assert_true(
        "T3.402_detail_contains_message_or_thread",
        ("message" in detail_lower) or ("thread" in detail_lower),
        info=f"detail={detail!r}",
    )

    # T3.5: re-open thread to super_admin — should be 200, doesn't count
    r5 = requests.post(
        f"{BASE}/dm/threads/start",
        headers=H(u1_token),
        json={"user_id": target_super, "opening_body": "follow-up"},
        timeout=15,
    )
    assert_eq("T3.reuse_thread_to_super.status", 200, r5.status_code)

    # T3.6: usage.outbound_threads_30d == 3
    rme = requests.get(f"{BASE}/auth/me", headers=H(u1_token), timeout=15)
    assert_eq("T3.me.status", 200, rme.status_code)
    me = rme.json() if rme.status_code == 200 else {}
    out_30d = (me.get("usage") or {}).get("outbound_threads_30d")
    assert_eq("T3.usage.outbound_threads_30d_eq_3", 3, out_30d)


# ============================================================
# T4. Free-tier max_uploads cap
# ============================================================
def test_t4_max_uploads():
    print("\n=== T4. Free-tier max_uploads cap (5, 6th=402, drafts don't count) ===")
    uid, token = register_free("uploader")
    print(f"  uploader (free): {uid}")

    created_ids: List[str] = []
    base_lat, base_lng = 29.42, -98.49  # San Antonio

    def make_payload(title: str, draft: bool = False, jitter: float = 0.0):
        return {
            "title": title,
            "description": "QA test spot — membership conversion test",
            "latitude": base_lat + jitter,
            "longitude": base_lng + jitter,
            "city": "San Antonio",
            "state": "TX",
            "country": "USA",
            "privacy_mode": "public",
            "save_as_draft": draft,
            "images": [
                {"image_url": PNG_DATA_URI, "caption": "qa", "is_cover": True}
            ],
        }

    # 5 successful public uploads
    for i in range(1, 6):
        r = requests.post(
            f"{BASE}/spots",
            headers=H(token),
            json=make_payload(f"QA Upload Spot #{i}", draft=False, jitter=0.0001 * i),
            timeout=20,
        )
        assert_eq(f"T4.upload_{i}.status", 200, r.status_code)
        if r.status_code == 200:
            j = r.json()
            sid = j.get("spot_id") or (j.get("spot") or {}).get("spot_id")
            if sid:
                created_ids.append(sid)
        else:
            print(f"     DEBUG body: {r.text[:300]}")

    # 6th should be blocked
    r6 = requests.post(
        f"{BASE}/spots",
        headers=H(token),
        json=make_payload("QA Upload Spot #6 (should fail)", draft=False, jitter=0.0006),
        timeout=20,
    )
    assert_eq("T4.upload_6_blocked.status", 402, r6.status_code)
    detail6 = ""
    try:
        detail6 = (r6.json() or {}).get("detail", "")
    except Exception:
        detail6 = r6.text
    assert_true(
        "T4.402_detail_contains_upload",
        "upload" in (detail6 or "").lower(),
        info=f"detail={detail6!r}",
    )

    # 7th draft → 200
    r7 = requests.post(
        f"{BASE}/spots",
        headers=H(token),
        json=make_payload("QA Upload Draft", draft=True, jitter=0.0007),
        timeout=20,
    )
    assert_eq("T4.draft_after_cap.status", 200, r7.status_code)


# ============================================================
# T5. Free-tier save cap regression
# ============================================================
def test_t5_save_cap():
    print("\n=== T5. Free-tier save cap regression (4th=402) ===")
    uid, token = register_free("saver")
    print(f"  saver (free): {uid}")

    # Fetch existing public spots
    r = requests.get(f"{BASE}/spots?limit=10", headers=H(token), timeout=20)
    if r.status_code != 200:
        FAILED.append(("T5.list_spots", f"status {r.status_code} body {r.text[:200]}"))
        return
    items = r.json() if isinstance(r.json(), list) else (r.json().get("items") or [])
    spot_ids: List[str] = []
    for it in items:
        sid = it.get("spot_id")
        if sid and sid not in spot_ids:
            spot_ids.append(sid)
        if len(spot_ids) >= 5:
            break
    assert_true(
        "T5.found_>=4_public_spots",
        len(spot_ids) >= 4,
        info=f"only {len(spot_ids)} found",
    )
    if len(spot_ids) < 4:
        return

    # First 3 saves → 200 + saved=true
    for i, sid in enumerate(spot_ids[:3], start=1):
        r = requests.post(f"{BASE}/spots/{sid}/save", headers=H(token), timeout=15)
        assert_eq(f"T5.save_{i}.status", 200, r.status_code)
        if r.status_code == 200:
            assert_eq(f"T5.save_{i}.saved_true", True, r.json().get("saved"))

    # 4th save → 402
    sid4 = spot_ids[3]
    r4 = requests.post(f"{BASE}/spots/{sid4}/save", headers=H(token), timeout=15)
    assert_eq("T5.save_4_blocked.status", 402, r4.status_code)
    detail4 = ""
    try:
        detail4 = (r4.json() or {}).get("detail", "")
    except Exception:
        detail4 = r4.text
    assert_true(
        "T5.402_detail_contains_save",
        "save" in (detail4 or "").lower(),
        info=f"detail={detail4!r}",
    )


# ============================================================
# T6. Pro/Elite users NOT capped
# ============================================================
def test_t6_elite_uncapped(admin_token: str) -> List[str]:
    """Returns list of spot_ids created by admin (for cleanup)."""
    print("\n=== T6. Elite (super_admin) NOT capped ===")
    created: List[str] = []
    extra_thread_targets: List[str] = []

    # 6a. Save 5+ spots — no 402.
    r = requests.get(f"{BASE}/spots?limit=15", headers=H(admin_token), timeout=20)
    items = r.json() if isinstance(r.json(), list) else (r.json().get("items") or [])
    spot_ids: List[str] = []
    for it in items:
        sid = it.get("spot_id")
        if sid:
            spot_ids.append(sid)
    spot_ids = spot_ids[:6]
    assert_true("T6.has_6_spots_to_save", len(spot_ids) >= 5, info=f"got {len(spot_ids)}")

    save_codes = []
    saved_ids_for_unsave: List[str] = []
    for sid in spot_ids[:6]:
        r = requests.post(f"{BASE}/spots/{sid}/save", headers=H(admin_token), timeout=15)
        save_codes.append(r.status_code)
        if r.status_code == 200 and r.json().get("saved") is True:
            saved_ids_for_unsave.append(sid)

    no_402 = all(c != 402 for c in save_codes)
    assert_true(
        "T6.elite.saves.no_402",
        no_402,
        info=f"codes={save_codes}",
    )

    # Cleanup saves we created (toggle off so admin's library isn't polluted)
    for sid in saved_ids_for_unsave:
        try:
            requests.post(f"{BASE}/spots/{sid}/save", headers=H(admin_token), timeout=10)
        except Exception:
            pass

    # 6b. Start DM threads to multiple new users — no 402.
    new_targets: List[str] = []
    for i in range(4):
        try:
            tid, _ = register_free(f"elite_dm_{i}")
            new_targets.append(tid)
        except Exception as e:
            print(f"     register failed: {e}")

    dm_codes = []
    for tid in new_targets:
        r = requests.post(
            f"{BASE}/dm/threads/start",
            headers=H(admin_token),
            json={"user_id": tid, "opening_body": f"elite test {tid[-4:]}"},
            timeout=15,
        )
        dm_codes.append(r.status_code)

    assert_true(
        "T6.elite.dm_threads.no_402",
        all(c != 402 for c in dm_codes),
        info=f"codes={dm_codes}",
    )

    # 6c. POST /spots multiple public — no 402.
    base_lat, base_lng = 30.27, -97.74  # Austin
    create_codes = []
    for i in range(6):
        body = {
            "title": f"QA Elite Test Spot {uuid.uuid4().hex[:6]}",
            "description": "QA elite test — should NOT hit cap",
            "latitude": base_lat + 0.001 * i,
            "longitude": base_lng + 0.001 * i,
            "city": "Austin",
            "state": "TX",
            "country": "USA",
            "privacy_mode": "public",
            "save_as_draft": False,
            "images": [{"image_url": PNG_DATA_URI, "is_cover": True}],
        }
        r = requests.post(f"{BASE}/spots", headers=H(admin_token), json=body, timeout=20)
        create_codes.append(r.status_code)
        if r.status_code == 200:
            j = r.json()
            sid = j.get("spot_id") or (j.get("spot") or {}).get("spot_id")
            if sid:
                created.append(sid)

    assert_true(
        "T6.elite.spot_creates.no_402",
        all(c != 402 for c in create_codes),
        info=f"codes={create_codes}",
    )
    return created


def cleanup_admin_spots(admin_token: str, ids: List[str]):
    print(f"\n=== Cleanup: deleting {len(ids)} admin-created QA spots ===")
    for sid in ids:
        try:
            r = requests.delete(f"{BASE}/spots/{sid}", headers=H(admin_token), timeout=15)
            print(f"  DELETE /spots/{sid} -> {r.status_code}")
        except Exception as e:
            print(f"  DELETE /spots/{sid} failed: {e}")


def main():
    print(f"BASE: {BASE}")
    print("Logging in as super_admin...")
    admin_token, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    print(f"  user_id={admin_user.get('user_id')} plan={admin_user.get('plan')}")

    test_t1_plans()
    test_t2_me(admin_token)
    test_t3_outbound_threads()
    test_t4_max_uploads()
    test_t5_save_cap()
    admin_spots = test_t6_elite_uncapped(admin_token)
    cleanup_admin_spots(admin_token, admin_spots)

    print("\n" + "=" * 60)
    print(f"PASSED: {len(PASSED)}")
    print(f"FAILED: {len(FAILED)}")
    if FAILED:
        print("\n--- FAILURES ---")
        for n, info in FAILED:
            print(f"  ✗ {n}  {info}")
        sys.exit(1)
    print("ALL GREEN")


if __name__ == "__main__":
    main()
