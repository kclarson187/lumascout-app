"""Backend tests for Community Uploads + Updates retention feature (2026-04).

See /app/test_result.md test plan. Runs fully idempotent scenarios and
cleans up test data at the end.
"""
from __future__ import annotations

import json
import sys
import uuid
from typing import Any, Dict, List, Optional, Tuple

import requests

# ---------------------------------------------------------------------------
FRONTEND_ENV = "/app/frontend/.env"
BACKEND_URL = None
with open(FRONTEND_ENV) as f:
    for line in f:
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BACKEND_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
            break
if not BACKEND_URL:
    BACKEND_URL = "https://photo-finder-60.preview.emergentagent.com"
API = f"{BACKEND_URL}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASS = "admin123"

PNG_B64 = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgA"
    "AIAAAUAAarVyFEAAAAASUVORK5CYII="
)

results: List[Tuple[str, bool, str]] = []


def rec(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    icon = "PASS" if ok else "FAIL"
    print(f"[{icon}] {name}{'  — ' + detail if detail and not ok else ''}")
    return ok


def req(method: str, path: str, token: Optional[str] = None, **kwargs):
    url = f"{API}{path}"
    headers = kwargs.pop("headers", {}) or {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return requests.request(method, url, headers=headers, timeout=45, **kwargs)


def login(email: str, password: str) -> Optional[Dict[str, Any]]:
    r = req("POST", "/auth/login", json={"email": email, "password": password})
    return r.json() if r.status_code == 200 else None


def register_tester() -> Optional[Dict[str, Any]]:
    email = f"community_tester_{uuid.uuid4().hex[:8]}@test.app"
    r = req("POST", "/auth/register", json={
        "email": email, "password": "testpass123", "name": "Community Tester"
    })
    if r.status_code != 200:
        print("tester register failed:", r.status_code, r.text[:300])
        return None
    b = r.json()
    b["email"] = email
    return b


def pick_spot(token: str) -> Optional[str]:
    r = req("GET", "/feed/home", token=token)
    if r.status_code != 200:
        return None
    j = r.json()
    for k in ("recent", "nearby", "trending", "best_for_you"):
        lst = j.get(k) or []
        if lst:
            return lst[0].get("spot_id")
    return None


def main():
    print(f"Backend URL: {API}\n")

    # --- Setup ---
    admin = login(ADMIN_EMAIL, ADMIN_PASS)
    if not admin or not admin.get("token"):
        rec("setup.admin_login", False, "cannot login admin")
        return 1
    ADMIN_TOKEN = admin["token"]
    ADMIN_USER = admin["user"]
    admin_role = ADMIN_USER.get("role")
    rec("setup.admin_login", True,
        f"role={admin_role} user_id={ADMIN_USER.get('user_id')} verified={ADMIN_USER.get('verification_status')}")

    tester = register_tester()
    if not tester or not tester.get("token"):
        rec("setup.tester_register", False, "register failed")
        return 1
    TESTER_TOKEN = tester["token"]
    TESTER_USER = tester["user"]
    rec("setup.tester_register",
        TESTER_USER.get("verification_status") != "verified",
        f"tester_id={TESTER_USER.get('user_id')} verified={TESTER_USER.get('verification_status')}")

    SPOT_ID = pick_spot(ADMIN_TOKEN)
    rec("setup.pick_spot", bool(SPOT_ID), f"spot_id={SPOT_ID}")
    if not SPOT_ID:
        return 1

    r = req("GET", f"/spots/{SPOT_ID}")
    rec("setup.spot_exists", r.status_code == 200, f"HTTP {r.status_code}")
    spot_owner = r.json().get("owner_user_id") if r.status_code == 200 else None
    admin_owns = spot_owner == ADMIN_USER.get("user_id")
    print(f"  (spot owner={spot_owner}, admin_owns={admin_owns})")

    pending_upload_id: Optional[str] = None

    # === Scenario 1: Auto-approve paths (admin) ===
    print("\n--- 1. Auto-approve (admin) ---")
    r = req("POST", f"/spots/{SPOT_ID}/uploads", token=ADMIN_TOKEN, json={
        "images": [
            {"image_url": PNG_B64, "caption": "admin img 1"},
            {"image_url": PNG_B64, "caption": "admin img 2"},
        ],
        "caption": "Test upload",
        "condition_tags": ["blooming", "verified_today"],
    })
    j = r.json() if r.status_code == 200 else {}
    rec("1.admin_uploads_auto_approved",
        r.status_code == 200 and j.get("ok") and j.get("auto_approved") is True
        and j.get("moderation_status") == "approved" and j.get("count") == 2,
        f"HTTP {r.status_code} body={json.dumps(j)[:250]}")

    r = req("POST", f"/spots/{SPOT_ID}/updates", token=ADMIN_TOKEN, json={
        "text": "All good today, quiet morning", "condition_tags": ["quiet"],
    })
    j = r.json() if r.status_code == 200 else {}
    rec("1.admin_updates_auto_approved",
        r.status_code == 200 and j.get("auto_approved") is True
        and j.get("moderation_status") == "approved",
        f"HTTP {r.status_code} body={json.dumps(j)[:250]}")

    # === Scenario 2: Pending path (non-verified, non-owner) ===
    print("\n--- 2. Pending (tester) ---")
    r = req("POST", f"/spots/{SPOT_ID}/uploads", token=TESTER_TOKEN, json={
        "images": [{"image_url": PNG_B64, "caption": "tester img"}],
        "caption": "Tester upload", "condition_tags": ["crowded"],
    })
    j = r.json() if r.status_code == 200 else {}
    rec("2.tester_upload_pending",
        r.status_code == 200 and j.get("auto_approved") is False
        and j.get("moderation_status") == "pending",
        f"HTTP {r.status_code} body={json.dumps(j)[:250]}")

    # Unauth GET should hide pending
    r = req("GET", f"/spots/{SPOT_ID}/uploads")
    if r.status_code == 200:
        items = r.json().get("items", [])
        has_pending = any(i.get("moderation_status") == "pending" for i in items)
        has_tester = any(i.get("user_id") == TESTER_USER["user_id"] for i in items)
        rec("2.unauth_list_hides_pending", not has_pending and not has_tester,
            f"pending_seen={has_pending} tester_seen={has_tester}")
    else:
        rec("2.unauth_list_hides_pending", False, f"HTTP {r.status_code}")

    r = req("GET", f"/spots/{SPOT_ID}/uploads", token=TESTER_TOKEN)
    if r.status_code == 200:
        items = r.json().get("items", [])
        has_pending = any(i.get("moderation_status") == "pending" for i in items)
        rec("2.tester_list_hides_pending", not has_pending, f"pending_seen={has_pending}")
    else:
        rec("2.tester_list_hides_pending", False, f"HTTP {r.status_code}")

    r = req("GET", f"/spots/{SPOT_ID}/uploads", token=ADMIN_TOKEN)
    if r.status_code == 200:
        items = r.json().get("items", [])
        has_pending = any(i.get("moderation_status") == "pending" for i in items)
        rec("2.admin_list_includes_pending", has_pending,
            f"HTTP {r.status_code} pending_seen={has_pending} admin_role={admin_role} (NOTE: gate checks role=='admin' exactly)")
    else:
        rec("2.admin_list_includes_pending", False, f"HTTP {r.status_code}")

    # === Scenario 3: Tag normalisation ===
    print("\n--- 3. Condition tag normalisation ---")

    def submit_and_get(caption: str, tags: List[str]) -> Optional[List[str]]:
        r = req("POST", f"/spots/{SPOT_ID}/uploads", token=ADMIN_TOKEN, json={
            "images": [{"image_url": PNG_B64}], "caption": caption, "condition_tags": tags,
        })
        if r.status_code != 200:
            return None
        r = req("GET", f"/spots/{SPOT_ID}/uploads", token=ADMIN_TOKEN)
        items = r.json().get("items", [])
        for it in items:
            if it.get("caption") == caption:
                return it.get("condition_tags")
        return None

    canonical = {"verified_today","blooming","great_sunset","crowded","quiet","muddy",
                 "dog_friendly","family_friendly","closed_gate","construction",
                 "good_parking","fall_colors"}

    tags = submit_and_get("tag test A",
                          ["blooming", "not_a_real_tag", "crowded", "Uppercase_Tag"])
    rec("3.tag_drops_noncanonical",
        tags is not None and set(tags) <= canonical and "blooming" in tags
        and "crowded" in tags and "not_a_real_tag" not in tags and "uppercase_tag" not in tags,
        f"stored={tags}")

    tags = submit_and_get("tag test B", ["BLOOMING", "great sunset"])
    rec("3.tag_uppercase_and_space_normalise",
        tags is not None and "blooming" in tags and "great_sunset" in tags,
        f"stored={tags}")

    tags = submit_and_get("tag test C",
                          ["blooming","crowded","quiet","muddy","dog_friendly",
                           "family_friendly","good_parking","fall_colors"])
    rec("3.tag_cap_6", tags is not None and len(tags) == 6,
        f"len={len(tags) if tags else 'None'} tags={tags}")

    tags = submit_and_get("tag test D", ["great sunset"])
    rec("3.tag_space_to_underscore", tags == ["great_sunset"], f"stored={tags}")

    # === Scenario 4: Validation ===
    print("\n--- 4. Validation ---")
    r = req("POST", f"/spots/{SPOT_ID}/uploads", token=ADMIN_TOKEN, json={"images": []})
    rec("4.uploads_empty_images_422", r.status_code == 422, f"HTTP {r.status_code}")

    r = req("POST", f"/spots/{SPOT_ID}/uploads", token=ADMIN_TOKEN, json={
        "images": [{"image_url": PNG_B64} for _ in range(13)]})
    rec("4.uploads_13_images_422", r.status_code == 422, f"HTTP {r.status_code}")

    r = req("POST", f"/spots/{SPOT_ID}/updates", token=ADMIN_TOKEN, json={"text": "ab"})
    rec("4.updates_text_too_short_422", r.status_code == 422, f"HTTP {r.status_code}")

    r = req("POST", f"/spots/{SPOT_ID}/updates", token=ADMIN_TOKEN, json={"text": "x" * 600})
    rec("4.updates_text_too_long_422", r.status_code == 422, f"HTTP {r.status_code}")

    # === Scenario 5: Reactions ===
    print("\n--- 5. Reactions ---")
    r = req("GET", f"/spots/{SPOT_ID}/uploads", token=ADMIN_TOKEN)
    approved = [i for i in r.json().get("items", []) if i.get("moderation_status") == "approved"]
    target = approved[0] if approved else None
    if not target:
        rec("5.find_approved_upload", False, "none found")
    else:
        UP_ID = target["upload_id"]
        prev_like = int(target.get("like_count") or 0)
        prev_help = int(target.get("helpful_count") or 0)

        r = req("POST", f"/spot-uploads/{UP_ID}/react?kind=like", token=TESTER_TOKEN)
        j = r.json() if r.status_code == 200 else {}
        rec("5.react_like_increments",
            r.status_code == 200 and j.get("acted") is True
            and int(j.get("like_count") or 0) == prev_like + 1,
            f"HTTP {r.status_code} body={json.dumps(j)[:200]}")

        r = req("POST", f"/spot-uploads/{UP_ID}/react?kind=like", token=TESTER_TOKEN)
        j = r.json() if r.status_code == 200 else {}
        rec("5.react_like_toggle_off",
            r.status_code == 200 and j.get("acted") is False
            and int(j.get("like_count") or 0) == prev_like,
            f"HTTP {r.status_code} body={json.dumps(j)[:200]}")

        r = req("POST", f"/spot-uploads/{UP_ID}/react?kind=helpful", token=TESTER_TOKEN)
        j = r.json() if r.status_code == 200 else {}
        rec("5.react_helpful_independent",
            r.status_code == 200 and j.get("acted") is True
            and int(j.get("helpful_count") or 0) == prev_help + 1,
            f"HTTP {r.status_code} body={json.dumps(j)[:200]}")
        # reset helpful
        req("POST", f"/spot-uploads/{UP_ID}/react?kind=helpful", token=TESTER_TOKEN)

        r = req("POST", f"/spot-uploads/{UP_ID}/react?kind=wow", token=TESTER_TOKEN)
        rec("5.react_invalid_kind_400", r.status_code == 400, f"HTTP {r.status_code}")

    # === Scenario 6: Admin moderation ===
    print("\n--- 6. Admin moderation ---")
    r = req("GET", "/admin/spot-uploads/pending", token=ADMIN_TOKEN)
    if r.status_code == 200:
        j = r.json()
        items = j.get("items", [])
        tester_pending = [i for i in items if i.get("user_id") == TESTER_USER["user_id"]]
        has_spot_hydr = (len(tester_pending) > 0
                         and all(isinstance(i.get("spot"), dict) and i["spot"].get("spot_id")
                                 and "title" in i["spot"] and "city" in i["spot"] and "state" in i["spot"]
                                 for i in tester_pending))
        has_contrib = (len(tester_pending) > 0
                       and all(isinstance(i.get("contributor"), dict) for i in tester_pending))
        rec("6.admin_pending_list",
            len(tester_pending) >= 1 and has_spot_hydr and has_contrib,
            f"items={len(items)} tester_pending={len(tester_pending)} spot_hydr={has_spot_hydr} contrib_hydr={has_contrib}")
        if tester_pending:
            pending_upload_id = tester_pending[0]["upload_id"]
    else:
        rec("6.admin_pending_list", False,
            f"HTTP {r.status_code} body={r.text[:300]} (admin_role={admin_role}; endpoint requires role=='admin' exact match)")

    if pending_upload_id:
        r = req("PATCH", f"/admin/spot-uploads/{pending_upload_id}",
                token=TESTER_TOKEN, json={"action": "approve"})
        rec("6.patch_as_tester_403", r.status_code == 403, f"HTTP {r.status_code}")

        r = req("PATCH", f"/admin/spot-uploads/{pending_upload_id}",
                token=ADMIN_TOKEN, json={"action": "approve"})
        approve_ok = r.status_code == 200
        rec("6.patch_approve", approve_ok, f"HTTP {r.status_code} body={r.text[:200]}")

        if approve_ok:
            r = req("GET", f"/spots/{SPOT_ID}/uploads")
            found = False
            if r.status_code == 200:
                items = r.json().get("items", [])
                found = any(i.get("upload_id") == pending_upload_id for i in items)
            rec("6.approved_now_public_visible", found, f"found={found}")

        r = req("PATCH", f"/admin/spot-uploads/{pending_upload_id}",
                token=ADMIN_TOKEN, json={"action": "flamethrower"})
        rec("6.patch_unknown_action_400", r.status_code == 400, f"HTTP {r.status_code}")

        # set_as_cover
        r = req("PATCH", f"/admin/spot-uploads/{pending_upload_id}",
                token=ADMIN_TOKEN, json={"action": "set_as_cover"})
        if r.status_code == 200:
            s = req("GET", f"/spots/{SPOT_ID}").json()
            imgs = s.get("images") or []
            first = imgs[0] if imgs else {}
            is_cover_ok = isinstance(first, dict) and first.get("is_cover") is True
            others_ok = all(
                (not isinstance(im, dict)) or im.get("is_cover") is False
                for im in imgs[1:]
            )
            rec("6.set_as_cover",
                is_cover_ok and others_ok,
                f"first_is_cover={is_cover_ok} others_not_cover={others_ok} first_url_match={first.get('image_url','')[:40] if isinstance(first,dict) else '-'}")
        else:
            rec("6.set_as_cover", False, f"HTTP {r.status_code}")

        # feature
        r = req("PATCH", f"/admin/spot-uploads/{pending_upload_id}",
                token=ADMIN_TOKEN, json={"action": "feature"})
        if r.status_code == 200:
            up = req("GET", f"/spots/{SPOT_ID}/uploads", token=ADMIN_TOKEN).json().get("items", [])
            latest = next((i for i in up if i.get("upload_id") == pending_upload_id), None)
            rec("6.feature_persists", bool(latest and latest.get("featured") is True),
                f"featured={(latest or {}).get('featured')}")
        else:
            rec("6.feature_persists", False, f"HTTP {r.status_code}")
    else:
        rec("6.find_pending_for_moderation", False,
            "No pending upload id available — see 6.admin_pending_list failure")

    # === Scenario 7: Freshness on spot ===
    print("\n--- 7. Freshness propagation ---")
    r = req("GET", f"/spots/{SPOT_ID}")
    if r.status_code == 200:
        s = r.json()
        la, lp = s.get("last_activity_at"), s.get("latest_photo_at")
        fs, ru = s.get("freshness_score"), s.get("recent_upload_count_7d")
        rec("7.freshness_populated",
            bool(la) and bool(lp) and (fs or 0) > 0 and (ru or 0) > 0,
            f"last_activity_at={la} latest_photo_at={lp} freshness_score={fs} recent_upload_count_7d={ru}")
    else:
        rec("7.freshness_populated", False, f"HTTP {r.status_code}")

    # === Scenario 8: freshly_updated rail ===
    print("\n--- 8. freshly_updated rail ---")
    r = req("GET", "/feed/home", token=ADMIN_TOKEN)
    if r.status_code == 200:
        j = r.json()
        fu = j.get("freshly_updated")
        rec("8.freshly_updated_key_is_list",
            "freshly_updated" in j and isinstance(fu, list),
            f"type={type(fu).__name__}")
        rec("8.freshly_updated_contains_spot",
            any((s.get("spot_id") == SPOT_ID) for s in (fu or [])),
            f"len={len(fu or [])} ids={[s.get('spot_id') for s in (fu or [])][:5]}")
    else:
        rec("8.freshly_updated_rail", False, f"HTTP {r.status_code}")

    # === Scenario 9: Delete cascade ===
    print("\n--- 9. Delete cascade ---")
    sp_body = {
        "title": f"QA Throwaway {uuid.uuid4().hex[:6]}",
        "description": "cascade test",
        "latitude": 30.2672, "longitude": -97.7431,
        "city": "Austin", "state": "TX", "country_code": "US",
        "shoot_types": ["Family"],
        "privacy_mode": "public",
        "images": [{"image_url": PNG_B64}],
    }
    r = req("POST", "/spots", token=ADMIN_TOKEN, json=sp_body)
    if r.status_code == 200:
        throw_id = r.json().get("spot_id")
        u = req("POST", f"/spots/{throw_id}/uploads", token=ADMIN_TOKEN,
                json={"images": [{"image_url": PNG_B64}], "caption": "cascade"})
        up_ok = u.status_code == 200
        t = req("POST", f"/spots/{throw_id}/updates", token=ADMIN_TOKEN,
                json={"text": "cascade update"})
        up_t_ok = t.status_code == 200
        d = req("DELETE", f"/spots/{throw_id}", token=ADMIN_TOKEN)
        del_ok = d.status_code == 200
        ua = req("GET", f"/spots/{throw_id}/uploads", token=ADMIN_TOKEN)
        ta = req("GET", f"/spots/{throw_id}/updates", token=ADMIN_TOKEN)
        u_cnt = ua.json().get("total") if ua.status_code == 200 else None
        t_cnt = ta.json().get("total") if ta.status_code == 200 else None
        rec("9.delete_cascade",
            up_ok and up_t_ok and del_ok and u_cnt == 0 and t_cnt == 0,
            f"uploads_after={u_cnt} updates_after={t_cnt}")
    else:
        rec("9.delete_cascade", False,
            f"throwaway create HTTP {r.status_code} body={r.text[:200]}")

    # === Scenario 10: Regressions ===
    print("\n--- 10. Regressions ---")
    r = req("GET", "/auth/me", token=ADMIN_TOKEN)
    rec("10.auth_me", r.status_code == 200, f"HTTP {r.status_code}")

    r = req("GET", "/feed/home", token=ADMIN_TOKEN)
    if r.status_code == 200:
        j = r.json()
        expected = {"nearby","trending","golden_hour","recent","best_for_you",
                    "following","seasonal","freshly_updated"}
        missing = expected - set(j.keys())
        rec("10.feed_home_all_rails", len(missing) == 0, f"missing={list(missing)}")
    else:
        rec("10.feed_home_all_rails", False, f"HTTP {r.status_code}")

    r = req("GET", "/spots?limit=5", token=ADMIN_TOKEN)
    rec("10.spots_list", r.status_code == 200, f"HTTP {r.status_code}")

    r = req("GET", "/me/spots", token=ADMIN_TOKEN)
    rec("10.me_spots", r.status_code == 200, f"HTTP {r.status_code}")

    # === Cleanup ===
    print("\n--- Cleanup ---")
    try:
        # Remove any remaining tester-created community uploads
        r = req("GET", "/admin/spot-uploads/pending", token=ADMIN_TOKEN)
        if r.status_code == 200:
            for it in r.json().get("items", []):
                if it.get("user_id") == TESTER_USER["user_id"]:
                    req("PATCH", f"/admin/spot-uploads/{it['upload_id']}",
                        token=ADMIN_TOKEN, json={"action": "remove"})
    except Exception as e:
        print(" cleanup uploads exc:", e)

    try:
        uid = TESTER_USER.get("user_id")
        if uid:
            req("DELETE", f"/admin/users/{uid}", token=ADMIN_TOKEN,
                json={"reason_code": "other", "reason_note": "QA cleanup"})
    except Exception as e:
        print(" cleanup tester exc:", e)

    # Summary
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{'='*72}\nRESULT: {passed}/{total} passed")
    failed = [(n, d) for n, ok, d in results if not ok]
    if failed:
        print("\nFAILURES:")
        for n, d in failed:
            print(f"  - {n}: {d}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
