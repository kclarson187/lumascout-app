"""Backend test: Admin Explore Cover Photo Editor endpoints.

Scope:
  - GET    /api/admin/spots/{spot_id}/cover-editor
  - PATCH  /api/admin/spots/{spot_id}/cover
  - DELETE /api/admin/spots/{spot_id}/cover
  - PATCH  /api/admin/spots/{spot_id}/gallery
  - POST   /api/admin/spots/{spot_id}/action

Base URL comes from frontend/.env (EXPO_PUBLIC_BACKEND_URL).
"""
import os
import sys
import time
import uuid
import json
from typing import Any, Dict, List, Optional

import requests

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "admin123"


# ---------- util ----------
PASS = "PASS"
FAIL = "FAIL"
results: List[Dict[str, Any]] = []


def rec(name: str, ok: bool, detail: str = "") -> None:
    status = PASS if ok else FAIL
    results.append({"name": name, "status": status, "detail": detail})
    marker = "OK" if ok else "XX"
    print(f"[{marker}] {name} — {detail[:300]}")


def login(email: str, password: str) -> str:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


def register_user(name: str, email: str, password: str) -> Dict[str, Any]:
    r = requests.post(f"{BASE}/auth/register", json={"name": name, "email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()


def h(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


def main() -> int:
    # ---- 0. Auth ----
    try:
        admin_tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    except Exception as e:
        rec("0. admin login", False, f"{e}")
        return 1
    rec("0. admin login", True, "token acquired")

    # Create a non-staff user for 403 check (use unique email to avoid collisions)
    nonstaff_email = f"qa_cover_{uuid.uuid4().hex[:10]}@lumascoutqa.com"
    nonstaff_pw = "pw_" + uuid.uuid4().hex[:8]
    try:
        reg = register_user("QA Cover Editor User", nonstaff_email, nonstaff_pw)
        nonstaff_tok = reg["token"]
        nonstaff_user_id = reg["user"]["user_id"]
    except Exception as e:
        rec("0. non-staff register", False, f"{e}")
        return 1
    rec("0. non-staff register", True, nonstaff_email)

    # ---- 1. Pick an existing approved spot ----
    r = requests.get(f"{BASE}/spots", params={"limit": 10}, headers=h(admin_tok), timeout=30)
    rec("1a. GET /spots?limit=10", r.status_code == 200, f"status={r.status_code}")
    if r.status_code != 200:
        return 1
    spots_payload = r.json()
    spots_list = spots_payload.get("items") if isinstance(spots_payload, dict) else spots_payload
    if not spots_list:
        rec("1a. pick spot", False, "no spots returned")
        return 1

    # Prefer a spot with >=2 images so we can test gallery reorder meaningfully.
    target_spot_id: Optional[str] = None
    target_multi_img_spot_id: Optional[str] = None
    for s in spots_list:
        sid = s.get("spot_id")
        if not sid:
            continue
        # Fetch detail to inspect images
        d = requests.get(f"{BASE}/spots/{sid}", headers=h(admin_tok), timeout=30)
        if d.status_code != 200:
            continue
        dj = d.json()
        imgs = dj.get("images") or []
        if target_spot_id is None:
            target_spot_id = sid
        if len(imgs) >= 2:
            target_multi_img_spot_id = sid
            break
    if not target_spot_id:
        rec("1a. pick spot", False, "no spot detail retrievable")
        return 1
    rec("1a. pick target spot", True, f"spot_id={target_spot_id} multi_img_spot_id={target_multi_img_spot_id}")

    spot_id = target_spot_id

    # ---- 1. cover-editor bundle GET ----
    r = requests.get(f"{BASE}/admin/spots/{spot_id}/cover-editor", headers=h(admin_tok), timeout=30)
    ok = r.status_code == 200
    rec("1b. GET cover-editor (admin)", ok, f"status={r.status_code}")
    if not ok:
        print(r.text)
        return 1
    bundle = r.json()
    # Shape validation
    has_spot = isinstance(bundle.get("spot"), dict) and all(
        k in bundle["spot"] for k in ("spot_id", "title", "visibility_status", "featured", "hidden_from_explore")
    )
    rec("1c. cover-editor.spot shape", has_spot, f"keys={list((bundle.get('spot') or {}).keys())}")
    images = bundle.get("images")
    rec("1d. cover-editor.images is list", isinstance(images, list), f"type={type(images).__name__}")
    rec("1e. admin_cover_override key present", "admin_cover_override" in bundle, f"value={bundle.get('admin_cover_override')}")
    if images:
        first = images[0]
        required_img_keys = {"image_url", "caption", "is_cover", "source"}
        rec("1f. image item has required keys",
            required_img_keys.issubset(first.keys()),
            f"keys={list(first.keys())}")

    # Non-admin 403
    r = requests.get(f"{BASE}/admin/spots/{spot_id}/cover-editor", headers=h(nonstaff_tok), timeout=30)
    rec("1g. non-admin GET cover-editor → 403", r.status_code == 403, f"status={r.status_code}")

    # ---- 2. PATCH cover set override ----
    # Use first spot-source image if available, else first image of any kind
    spot_src_urls = [im["image_url"] for im in images if im.get("source") == "spot" and im.get("image_url")]
    candidate_url = spot_src_urls[0] if spot_src_urls else (images[0]["image_url"] if images else None)
    if not candidate_url:
        rec("2a. pick image_url for override", False, "no candidate url")
        return 1
    rec("2a. pick image_url for override", True, candidate_url[:80])

    payload = {"image_url": candidate_url, "focal_x": 0.3, "focal_y": 0.7, "scale": 1.6, "rotation": 0}
    r = requests.patch(f"{BASE}/admin/spots/{spot_id}/cover", json=payload, headers=h(admin_tok), timeout=30)
    rec("2b. PATCH cover set override 200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        rec("2c. PATCH cover response ok=true",
            body.get("ok") is True and isinstance(body.get("admin_cover_override"), dict),
            f"body_keys={list(body.keys())}")

    # Verify via public spot detail
    r = requests.get(f"{BASE}/spots/{spot_id}", timeout=30)  # unauth, public
    if r.status_code == 200:
        dj = r.json()
        src_ok = dj.get("hero_cover_source") == "admin_override"
        meta = dj.get("hero_cover_meta") or {}
        meta_ok = (
            abs(float(meta.get("focal_x", -1)) - 0.3) < 1e-6
            and abs(float(meta.get("focal_y", -1)) - 0.7) < 1e-6
            and abs(float(meta.get("scale", -1)) - 1.6) < 1e-6
            and int(meta.get("rotation", -1)) == 0
        )
        rec("2d. GET /spots/{id} hero_cover_source=admin_override", src_ok, f"hero_cover_source={dj.get('hero_cover_source')}")
        rec("2e. GET /spots/{id} hero_cover_meta matches", meta_ok, f"meta={meta}")
        rec("2f. hero_cover_image_url == override url",
            dj.get("hero_cover_image_url") == candidate_url,
            f"hero_cover_image_url={str(dj.get('hero_cover_image_url'))[:80]}")
    else:
        rec("2d. GET /spots/{id}", False, f"status={r.status_code}")

    # ---- 3. PATCH cover rejects bad input ----
    # 3a. image_url not part of spot
    r = requests.patch(
        f"{BASE}/admin/spots/{spot_id}/cover",
        json={"image_url": "https://evil.example.com/fake.jpg", "focal_x": 0.5, "focal_y": 0.5, "scale": 1.0, "rotation": 0},
        headers=h(admin_tok), timeout=30,
    )
    body_text = r.text.lower()
    rec("3a. bogus image_url → 400 with gallery phrase",
        r.status_code == 400 and "gallery" in body_text,
        f"status={r.status_code} body={r.text[:200]}")

    # 3b. focal_x/focal_y out-of-range → clamped (not 422)
    r = requests.patch(
        f"{BASE}/admin/spots/{spot_id}/cover",
        json={"image_url": candidate_url, "focal_x": 1.8, "focal_y": -0.4, "scale": 1.0, "rotation": 0},
        headers=h(admin_tok), timeout=30,
    )
    if r.status_code == 200:
        ov = r.json().get("admin_cover_override") or {}
        rec("3b. focal out-of-range clamped",
            0.0 <= float(ov.get("focal_x", -1)) <= 1.0 and 0.0 <= float(ov.get("focal_y", -1)) <= 1.0,
            f"focal_x={ov.get('focal_x')} focal_y={ov.get('focal_y')}")
    else:
        rec("3b. focal out-of-range clamped", False, f"status={r.status_code} body={r.text[:200]}")

    # 3c. scale=5.0 → clamped to 3.5
    r = requests.patch(
        f"{BASE}/admin/spots/{spot_id}/cover",
        json={"image_url": candidate_url, "focal_x": 0.5, "focal_y": 0.5, "scale": 5.0, "rotation": 0},
        headers=h(admin_tok), timeout=30,
    )
    if r.status_code == 200:
        ov = r.json().get("admin_cover_override") or {}
        rec("3c. scale=5.0 clamped to 3.5",
            abs(float(ov.get("scale", -1)) - 3.5) < 1e-6,
            f"scale={ov.get('scale')}")
    else:
        rec("3c. scale=5.0 clamped to 3.5", False, f"status={r.status_code}")

    # 3d. scale=0.2 → clamped to 1.0
    r = requests.patch(
        f"{BASE}/admin/spots/{spot_id}/cover",
        json={"image_url": candidate_url, "focal_x": 0.5, "focal_y": 0.5, "scale": 0.2, "rotation": 0},
        headers=h(admin_tok), timeout=30,
    )
    if r.status_code == 200:
        ov = r.json().get("admin_cover_override") or {}
        rec("3d. scale=0.2 clamped to 1.0",
            abs(float(ov.get("scale", -1)) - 1.0) < 1e-6,
            f"scale={ov.get('scale')}")
    else:
        rec("3d. scale=0.2 clamped to 1.0", False, f"status={r.status_code}")

    # 3e. rotation=45 → normalized to 0
    r = requests.patch(
        f"{BASE}/admin/spots/{spot_id}/cover",
        json={"image_url": candidate_url, "focal_x": 0.5, "focal_y": 0.5, "scale": 1.0, "rotation": 45},
        headers=h(admin_tok), timeout=30,
    )
    if r.status_code == 200:
        ov = r.json().get("admin_cover_override") or {}
        rec("3e. rotation=45 normalized to 0",
            int(ov.get("rotation", -1)) == 0,
            f"rotation={ov.get('rotation')}")
    else:
        rec("3e. rotation=45 normalized to 0", False, f"status={r.status_code}")

    # 3f. rotation=450 → normalized to 90
    r = requests.patch(
        f"{BASE}/admin/spots/{spot_id}/cover",
        json={"image_url": candidate_url, "focal_x": 0.5, "focal_y": 0.5, "scale": 1.0, "rotation": 450},
        headers=h(admin_tok), timeout=30,
    )
    if r.status_code == 200:
        ov = r.json().get("admin_cover_override") or {}
        rec("3f. rotation=450 normalized to 90",
            int(ov.get("rotation", -1)) == 90,
            f"rotation={ov.get('rotation')}")
    else:
        rec("3f. rotation=450 normalized to 90", False, f"status={r.status_code}")

    # ---- 4. DELETE cover ----
    r = requests.delete(f"{BASE}/admin/spots/{spot_id}/cover", headers=h(admin_tok), timeout=30)
    rec("4a. DELETE cover 200", r.status_code == 200, f"status={r.status_code} body={r.text[:120]}")
    # Verify public spot detail no longer reports admin_override
    r = requests.get(f"{BASE}/spots/{spot_id}", timeout=30)
    if r.status_code == 200:
        src = r.json().get("hero_cover_source")
        rec("4b. hero_cover_source reverts to non-admin_override",
            src in {"admin_featured", "recent_most_liked", "seasonal_spring", "seasonal_summer",
                    "seasonal_fall", "seasonal_winter", "original_cover", "first_image", None},
            f"hero_cover_source={src}")
    else:
        rec("4b. hero_cover_source reverts", False, f"status={r.status_code}")

    # ---- 5. Gallery reorder ----
    gallery_spot_id = target_multi_img_spot_id or spot_id
    r = requests.get(f"{BASE}/admin/spots/{gallery_spot_id}/cover-editor", headers=h(admin_tok), timeout=30)
    if r.status_code != 200:
        rec("5a. fetch cover-editor for gallery test", False, f"status={r.status_code}")
    else:
        g_images = [im for im in r.json().get("images") or [] if im.get("source") == "spot"]
        if len(g_images) < 2:
            rec("5a. gallery reorder — need >=2 spot images", False, f"count={len(g_images)}")
        else:
            first_url = g_images[0]["image_url"]
            second_url = g_images[1]["image_url"]
            other_urls = [im["image_url"] for im in g_images[2:]]

            # Include a bogus URL — should be silently ignored
            reorder = [second_url, first_url] + other_urls + ["https://example.com/ghost-image-not-on-spot.jpg"]
            r = requests.patch(
                f"{BASE}/admin/spots/{gallery_spot_id}/gallery",
                json={"image_urls": reorder},
                headers=h(admin_tok), timeout=30,
            )
            rec("5b. PATCH gallery reorder 200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")

            # Verify
            r = requests.get(f"{BASE}/admin/spots/{gallery_spot_id}/cover-editor", headers=h(admin_tok), timeout=30)
            if r.status_code == 200:
                new_images = [im for im in r.json().get("images") or [] if im.get("source") == "spot"]
                by_url = {im["image_url"]: im for im in new_images}
                rec("5c. second_url is_cover=true",
                    by_url.get(second_url, {}).get("is_cover") is True,
                    f"second.is_cover={by_url.get(second_url, {}).get('is_cover')}")
                rec("5d. first_url is_cover=false",
                    by_url.get(first_url, {}).get("is_cover") is False,
                    f"first.is_cover={by_url.get(first_url, {}).get('is_cover')}")
                # order: first item in new_images should be second_url
                if new_images:
                    rec("5e. first gallery item == second_url",
                        new_images[0]["image_url"] == second_url,
                        f"head={new_images[0]['image_url'][:60]}")

            # 5f. Missing URL scenario — send only subset, missing ones should be appended at tail with is_cover=false
            # use first_url only in list (missing others)
            r = requests.patch(
                f"{BASE}/admin/spots/{gallery_spot_id}/gallery",
                json={"image_urls": [first_url]},
                headers=h(admin_tok), timeout=30,
            )
            if r.status_code == 200:
                r2 = requests.get(f"{BASE}/admin/spots/{gallery_spot_id}/cover-editor", headers=h(admin_tok), timeout=30)
                if r2.status_code == 200:
                    ni = [im for im in r2.json().get("images") or [] if im.get("source") == "spot"]
                    head_ok = ni and ni[0]["image_url"] == first_url and ni[0].get("is_cover") is True
                    # Missing urls should not be absent — appended at tail
                    urls_now = {im["image_url"] for im in ni}
                    second_present_at_tail = second_url in urls_now and (
                        next((im for im in ni if im["image_url"] == second_url), {}).get("is_cover") is False
                    )
                    rec("5f. missing URLs appended at tail", bool(head_ok and second_present_at_tail),
                        f"head_ok={head_ok} tail_ok={second_present_at_tail} urls_now_count={len(urls_now)}")

            # Restore original order
            orig_order = [im["image_url"] for im in g_images]
            r = requests.patch(
                f"{BASE}/admin/spots/{gallery_spot_id}/gallery",
                json={"image_urls": orig_order},
                headers=h(admin_tok), timeout=30,
            )
            rec("5g. restore gallery order", r.status_code == 200, f"status={r.status_code}")

    # ---- 6. Composite actions (admin token — super_admin) ----
    # Use the primary spot_id; test feature/unfeature/hide/unhide/approve
    # Avoid 'delete' and 'reject' to not damage data.
    for act in ("feature", "unfeature", "hide", "unhide", "approve"):
        r = requests.post(f"{BASE}/admin/spots/{spot_id}/action",
                          json={"action": act, "reason": f"qa-{act}"},
                          headers=h(admin_tok), timeout=30)
        ok = r.status_code == 200 and r.json().get("ok") is True
        rec(f"6a. action={act} as super_admin 200", ok, f"status={r.status_code} body={r.text[:200]}")

    # Non-staff 403 for action
    r = requests.post(f"{BASE}/admin/spots/{spot_id}/action",
                      json={"action": "approve", "reason": "qa"},
                      headers=h(nonstaff_tok), timeout=30)
    rec("6b. action approve as non-staff → 403", r.status_code == 403, f"status={r.status_code}")

    r = requests.post(f"{BASE}/admin/spots/{spot_id}/action",
                      json={"action": "feature", "reason": "qa"},
                      headers=h(nonstaff_tok), timeout=30)
    rec("6c. action feature as non-staff → 403", r.status_code == 403, f"status={r.status_code}")

    # ---- 7. Audit log verification ----
    r = requests.get(f"{BASE}/admin/audit-logs",
                     params={"target_id": spot_id, "limit": 200},
                     headers=h(admin_tok), timeout=30)
    if r.status_code != 200:
        rec("7a. GET /admin/audit-logs", False, f"status={r.status_code} body={r.text[:120]}")
    else:
        audit_items = r.json().get("items") or []
        actions_seen = {a.get("action") for a in audit_items}
        want = {"spot.cover.override", "spot.cover.clear",
                "spot.feature", "spot.unfeature", "spot.hide", "spot.unhide", "spot.approve"}
        missing = want - actions_seen
        rec("7a. audit_logs contains cover.override", "spot.cover.override" in actions_seen, f"seen={sorted(actions_seen)[:10]}")
        rec("7b. audit_logs contains cover.clear", "spot.cover.clear" in actions_seen, "")
        rec("7c. audit_logs contains spot.<action>", not missing, f"missing={sorted(missing)}")

    r = requests.get(f"{BASE}/admin/audit-logs",
                     params={"target_id": gallery_spot_id, "action": "spot.gallery", "limit": 50},
                     headers=h(admin_tok), timeout=30)
    if r.status_code == 200:
        items = r.json().get("items") or []
        rec("7d. audit_logs contains gallery.reorder",
            any(a.get("action") == "spot.gallery.reorder" for a in items),
            f"count={len(items)}")

    # ---- 8. Regression check ----
    r = requests.get(f"{BASE}/spots", headers=h(nonstaff_tok), timeout=30)
    rec("8a. GET /spots as non-admin 200", r.status_code == 200, f"status={r.status_code}")
    r = requests.get(f"{BASE}/spots/{spot_id}", headers=h(nonstaff_tok), timeout=30)
    rec("8b. GET /spots/{id} as non-admin 200", r.status_code == 200, f"status={r.status_code}")
    r = requests.get(f"{BASE}/marketplace/storefront", timeout=30)
    rec("8c. GET /marketplace/storefront 200", r.status_code == 200, f"status={r.status_code}")

    # ---- Cleanup: ensure override is deleted ----
    r = requests.delete(f"{BASE}/admin/spots/{spot_id}/cover", headers=h(admin_tok), timeout=30)
    rec("9a. cleanup DELETE cover override", r.status_code == 200, f"status={r.status_code}")

    # Cleanup: soft-delete non-staff test user (super-admin DELETE requires reason_code)
    try:
        requests.delete(
            f"{BASE}/admin/users/{nonstaff_user_id}",
            json={"reason_code": "spam_network", "reason_note": "QA cover editor test cleanup"},
            headers=h(admin_tok), timeout=30,
        )
    except Exception:
        pass

    # Summary
    total = len(results)
    passed = sum(1 for r in results if r["status"] == PASS)
    failed = total - passed
    print("\n===== SUMMARY =====")
    print(f"PASS {passed}/{total}  FAIL {failed}")
    for r in results:
        if r["status"] == FAIL:
            print(f"  FAIL {r['name']} — {r['detail']}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
