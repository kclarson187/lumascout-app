"""
Focused retest for Scenario 2 (A) and Scenario 6 (B) of the
spot community-uploads moderation flow. Tests only the 3 previously
failing assertions after the admin-family role-gate fixes.
"""
import sys
import time
import uuid
import requests

BASE = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"

# 1x1 transparent PNG data URL
TINY_PNG = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlE"
    "QVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
COVER_PNG = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlE"
    "QVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="
)


def s(label, ok, detail=""):
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))
    return ok


def die(msg):
    print(f"!! FATAL: {msg}")
    sys.exit(1)


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        die(f"login({email}) -> {r.status_code} {r.text}")
    return r.json()["token"], r.json()["user"]


def register_tester():
    uniq = uuid.uuid4().hex[:10]
    email = f"qa.modtester.{uniq}@photoscout.app"
    pw = "Tester1234!"
    r = requests.post(
        f"{BASE}/auth/register",
        json={"email": email, "password": pw, "name": f"QA Mod Tester {uniq}"},
        timeout=30,
    )
    if r.status_code != 200:
        die(f"register -> {r.status_code} {r.text}")
    return r.json()["token"], r.json()["user"], email, pw


def H(token):
    return {"Authorization": f"Bearer {token}"}


def create_spot_as_admin(admin_token):
    # Geographic seed data that geocode is likely cached for
    body = {
        "title": f"QA Moderation Retest Spot {uuid.uuid4().hex[:6]}",
        "description": "Temporary spot for moderation flow retest.",
        "latitude": 30.2672,
        "longitude": -97.7431,
        "city": "Austin",
        "state": "TX",
        "country": "USA",
        "privacy_mode": "public",
        "shoot_types": ["family"],
        "style_tags": ["portrait"],
        "images": [
            {"image_url": COVER_PNG, "caption": "original cover", "is_cover": True}
        ],
    }
    r = requests.post(f"{BASE}/spots", json=body, headers=H(admin_token), timeout=30)
    if r.status_code != 200:
        die(f"create spot -> {r.status_code} {r.text}")
    return r.json()


def cleanup_spot(admin_token, spot_id):
    try:
        r = requests.delete(f"{BASE}/admin/spots/{spot_id}", headers=H(admin_token), timeout=30)
        print(f"  cleanup spot -> {r.status_code}")
    except Exception as e:
        print(f"  cleanup spot exception: {e}")


def cleanup_user(admin_token, user_id):
    try:
        r = requests.delete(
            f"{BASE}/admin/users/{user_id}",
            json={"reason_code": "qa_test"},
            headers=H(admin_token),
            timeout=30,
        )
        print(f"  cleanup user -> {r.status_code}")
    except Exception as e:
        print(f"  cleanup user exception: {e}")


def main():
    print("=" * 70)
    print("Moderation retest — Scenario 2 (A) + Scenario 6 (B)")
    print("=" * 70)

    print("\n-- Setup --")
    admin_token, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    print(f"  admin: {admin_user.get('username')}  role={admin_user.get('role')}")

    tester_token, tester_user, tester_email, tester_pw = register_tester()
    print(f"  tester: {tester_user.get('username')}  role={tester_user.get('role')}  verif={tester_user.get('verification_status')}")

    spot = create_spot_as_admin(admin_token)
    spot_id = spot["spot_id"]
    print(f"  spot_id: {spot_id}  owner={spot.get('owner_user_id')}")

    results = {}

    try:
        # --------------------------------------------------------------
        # SCENARIO A: list_spot_uploads admin-pending visibility
        # --------------------------------------------------------------
        print("\n-- Scenario A: /api/spots/{id}/uploads pending visibility --")

        # Tester posts an upload -> should be pending (non-verified, non-owner)
        up_body = {"images": [{"image_url": TINY_PNG, "caption": "pending probe"}], "caption": "pending probe"}
        r = requests.post(f"{BASE}/spots/{spot_id}/uploads", json=up_body, headers=H(tester_token), timeout=30)
        if r.status_code != 200:
            die(f"tester upload -> {r.status_code} {r.text}")
        up = r.json()
        if up.get("moderation_status") != "pending":
            die(f"expected pending, got {up}")
        print(f"  tester upload submitted (pending). batch_id={up.get('batch_id')}")

        # A-unauth: unauth GET should NOT see the pending item
        r = requests.get(f"{BASE}/spots/{spot_id}/uploads", timeout=30)
        a_unauth_ok = r.status_code == 200 and all(i.get("moderation_status") == "approved" for i in r.json().get("items", []))
        n_unauth = len(r.json().get("items", []))
        results["A.unauth_hides_pending"] = s(
            "Unauth GET hides pending", a_unauth_ok,
            f"items={n_unauth} statuses={[i.get('moderation_status') for i in r.json().get('items', [])]}",
        )

        # A-tester: tester GET should also NOT see pending (tester is the author but the admin-role gate + owner gate exclude them. However, the code only grants include_pending to admins or the spot owner — not to the author of the pending upload. So tester should see only approved)
        r = requests.get(f"{BASE}/spots/{spot_id}/uploads", headers=H(tester_token), timeout=30)
        tester_items = r.json().get("items", [])
        a_tester_ok = r.status_code == 200 and all(i.get("moderation_status") == "approved" for i in tester_items)
        results["A.tester_hides_pending"] = s(
            "Tester (non-admin, non-owner) GET hides pending", a_tester_ok,
            f"items={len(tester_items)} statuses={[i.get('moderation_status') for i in tester_items]}",
        )

        # A-admin: admin GET should INCLUDE the pending item
        r = requests.get(f"{BASE}/spots/{spot_id}/uploads", headers=H(admin_token), timeout=30)
        admin_items = r.json().get("items", [])
        pending_present = any(i.get("moderation_status") == "pending" for i in admin_items)
        results["A.admin_includes_pending"] = s(
            "Admin GET includes pending from non-admin author",
            r.status_code == 200 and pending_present,
            f"status={r.status_code} items={len(admin_items)} statuses={[i.get('moderation_status') for i in admin_items]}",
        )

        # --------------------------------------------------------------
        # SCENARIO B: full admin moderation flow
        # --------------------------------------------------------------
        print("\n-- Scenario B: Full admin moderation flow --")

        # B.1 tester uploads -> pending (done above)
        results["B.1_upload_pending"] = s(
            "Tester upload produces pending item",
            up.get("moderation_status") == "pending" and up.get("count", 0) >= 1,
            f"moderation_status={up.get('moderation_status')} count={up.get('count')}",
        )

        # B.2 admin /pending returns it with hydrated spot + contributor
        r = requests.get(f"{BASE}/admin/spot-uploads/pending", headers=H(admin_token), timeout=30)
        pend = r.json() if r.status_code == 200 else {}
        items = pend.get("items", [])
        # find an item authored by tester on our spot
        mine = [i for i in items if i.get("spot_id") == spot_id and i.get("user_id") == tester_user["user_id"]]
        first = mine[0] if mine else None
        b2_ok = (
            r.status_code == 200
            and first is not None
            and isinstance(first.get("spot"), dict)
            and first["spot"].get("spot_id") == spot_id
            and first["spot"].get("title")
            and isinstance(first.get("contributor"), dict)
            and first["contributor"].get("user_id") == tester_user["user_id"]
        )
        upload_id = first.get("upload_id") if first else None
        results["B.2_pending_endpoint_hydrated"] = s(
            "Admin /pending returns item with hydrated spot+contributor",
            b2_ok,
            f"status={r.status_code} found_upload={upload_id} spot_keys={list((first or {}).get('spot',{}).keys())} contrib_keys={list((first or {}).get('contributor',{}).keys())}",
        )
        if not upload_id:
            die("cannot continue without upload_id")

        # B.3 admin PATCH approve
        r = requests.patch(
            f"{BASE}/admin/spot-uploads/{upload_id}",
            json={"action": "approve"},
            headers=H(admin_token),
            timeout=30,
        )
        approve_ok = r.status_code == 200 and r.json().get("ok") is True and r.json().get("action") == "approve"
        results["B.3_approve_200"] = s("Admin PATCH approve -> 200 ok", approve_ok, f"status={r.status_code} body={r.text[:200]}")

        # Verify moderation_status now 'approved' by fetching (as admin) or unauth (scenario: "Unauth GET now includes it")
        # B.4 unauth GET now includes it
        r = requests.get(f"{BASE}/spots/{spot_id}/uploads", timeout=30)
        items = r.json().get("items", [])
        found = [i for i in items if i.get("upload_id") == upload_id]
        b4_ok = r.status_code == 200 and len(found) == 1 and found[0].get("moderation_status") == "approved"
        results["B.4_unauth_sees_approved"] = s(
            "Unauth GET now includes approved upload", b4_ok,
            f"status={r.status_code} found={len(found)} ms={(found[0].get('moderation_status') if found else None)}",
        )

        # B.5 tester PATCH -> 403
        r = requests.patch(
            f"{BASE}/admin/spot-uploads/{upload_id}",
            json={"action": "approve"},
            headers=H(tester_token),
            timeout=30,
        )
        results["B.5_tester_patch_403"] = s(
            "Tester PATCH /admin/spot-uploads/{id} -> 403",
            r.status_code == 403,
            f"status={r.status_code} body={r.text[:150]}",
        )

        # B.6 admin PATCH set_as_cover -> upload image becomes spots[0].images[0] with is_cover=true
        r = requests.patch(
            f"{BASE}/admin/spot-uploads/{upload_id}",
            json={"action": "set_as_cover"},
            headers=H(admin_token),
            timeout=30,
        )
        set_cover_resp_ok = r.status_code == 200 and r.json().get("ok") is True
        # Fetch spot and verify
        r2 = requests.get(f"{BASE}/spots/{spot_id}", timeout=30)
        spot_doc = r2.json() if r2.status_code == 200 else {}
        images = spot_doc.get("images") or []
        img0 = images[0] if images else None
        # Should match TINY_PNG (tester's upload image) and be is_cover:true
        cover_set_ok = (
            set_cover_resp_ok
            and isinstance(img0, dict)
            and img0.get("is_cover") is True
            and img0.get("image_url") == TINY_PNG
        )
        results["B.6_set_as_cover"] = s(
            "Admin set_as_cover promotes upload to spots[0].images[0]", cover_set_ok,
            f"patch_status={r.status_code} img0_iscover={(img0 or {}).get('is_cover')} img0_url_match={(img0 or {}).get('image_url')==TINY_PNG}",
        )

        # B.7 admin PATCH feature -> featured:true persists
        r = requests.patch(
            f"{BASE}/admin/spot-uploads/{upload_id}",
            json={"action": "feature"},
            headers=H(admin_token),
            timeout=30,
        )
        feat_resp_ok = r.status_code == 200 and r.json().get("ok") is True
        # Fetch back via admin listing (or the /uploads list including pending/approved)
        r2 = requests.get(f"{BASE}/spots/{spot_id}/uploads", headers=H(admin_token), timeout=30)
        admin_items = r2.json().get("items", [])
        ours = next((i for i in admin_items if i.get("upload_id") == upload_id), None)
        feat_persisted = bool(ours and ours.get("featured") is True)
        results["B.7_feature_persists"] = s(
            "Admin feature -> upload.featured persists True",
            feat_resp_ok and feat_persisted,
            f"patch_status={r.status_code} featured_after={(ours or {}).get('featured')}",
        )

        # B.8 admin PATCH "garbage" -> 400
        r = requests.patch(
            f"{BASE}/admin/spot-uploads/{upload_id}",
            json={"action": "garbage"},
            headers=H(admin_token),
            timeout=30,
        )
        results["B.8_garbage_400"] = s(
            "Admin PATCH action=garbage -> 400",
            r.status_code == 400,
            f"status={r.status_code} body={r.text[:150]}",
        )

    finally:
        print("\n-- Cleanup --")
        cleanup_spot(admin_token, spot_id)
        cleanup_user(admin_token, tester_user["user_id"])

    # --------- Summary ---------
    print("\n" + "=" * 70)
    print("RESULTS")
    print("=" * 70)
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    for k, v in results.items():
        print(f"  {'PASS' if v else 'FAIL'} - {k}")
    print(f"\n  {passed}/{total} checks passed")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
