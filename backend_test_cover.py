"""
Diagnostic test for admin cover-photo workflow.

Tests:
  GET    /api/admin/spots/{spot_id}/cover-editor
  PATCH  /api/admin/spots/{spot_id}/cover
  DELETE /api/admin/spots/{spot_id}/cover
  GET    /api/spots/{spot_id}
  GET    /api/spots?limit=50  (Explore feed agreement check)
"""
import json
import os
import sys
import requests

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PWD = "admin123"

results = []
def step(name, ok, detail=""):
    tag = "PASS" if ok else "FAIL"
    line = f"[{tag}] {name}"
    if detail:
        line += f"\n        {detail}"
    print(line)
    results.append((name, ok, detail))
    return ok

def login():
    r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=20)
    r.raise_for_status()
    data = r.json()
    return data["token"]

def find_spot_with_min_images(headers, min_n=2):
    """Step 1: pick a spot with at least min_n images."""
    # Try grabbing more than 1 to find one with ≥2 images
    r = requests.get(f"{BASE}/spots", params={"limit": 50}, headers=headers, timeout=20)
    r.raise_for_status()
    items = r.json().get("items", []) if isinstance(r.json(), dict) else r.json()
    if isinstance(r.json(), list):
        items = r.json()
    for s in items:
        imgs = s.get("images") or []
        if len(imgs) >= min_n:
            return s
    return None

def main():
    print(f"BASE: {BASE}")
    token = login()
    headers = {"Authorization": f"Bearer {token}"}
    print(f"Logged in as {ADMIN_EMAIL}")

    # Step 1: pick a spot with >=2 images
    spot = find_spot_with_min_images(headers, 2)
    if not spot:
        # fall back: search through more spots
        r = requests.get(f"{BASE}/spots", params={"limit": 200}, headers=headers, timeout=30)
        r.raise_for_status()
        items_resp = r.json()
        items = items_resp.get("items", items_resp) if isinstance(items_resp, dict) else items_resp
        for s in items:
            if len(s.get("images") or []) >= 2:
                spot = s
                break
    if not spot:
        step("Step 1: find a spot with >=2 images", False, "No spots have >=2 images")
        return _summary()
    spot_id = spot["spot_id"]
    images = spot.get("images") or []
    step("Step 1: find a spot with >=2 images", True,
         f"spot_id={spot_id}, title={spot.get('title')!r}, images={len(images)}")

    # Step 2: GET cover-editor
    r = requests.get(f"{BASE}/admin/spots/{spot_id}/cover-editor", headers=headers, timeout=20)
    ok2 = r.status_code == 200
    body2 = {}
    if ok2:
        body2 = r.json()
        has_images = isinstance(body2.get("images"), list) and len(body2["images"]) >= 1
        sample = body2["images"][0] if has_images else None
        sample_keys = list(sample.keys()) if isinstance(sample, dict) else None
        has_image_url = bool(sample and "image_url" in sample and "source" in sample)
        has_override_field = "admin_cover_override" in body2
        ok2 = has_images and has_image_url and has_override_field
        step("Step 2: GET /admin/spots/{id}/cover-editor 200 + payload shape", ok2,
             f"images={len(body2.get('images') or [])}, sample_keys={sample_keys}, "
             f"admin_cover_override_present={has_override_field}, "
             f"current override={body2.get('admin_cover_override')}")
    else:
        step("Step 2: GET /admin/spots/{id}/cover-editor", False, f"HTTP {r.status_code}: {r.text[:300]}")
        return _summary()

    editor_images = body2.get("images") or []
    if len(editor_images) < 2:
        step("Step 2b: editor returns >=2 images", False, f"only {len(editor_images)} editor images")
        return _summary()

    # Step 3: pick IMG_B = second image (not current cover).
    current_override = body2.get("admin_cover_override") or {}
    current_cover_url = current_override.get("image_url")
    img_b = None
    for im in editor_images:
        u = im.get("image_url")
        if u and u != current_cover_url:
            img_b = u
            break
    if not img_b:
        # last resort: pick second item
        img_b = editor_images[1].get("image_url")
    step("Step 3: pick IMG_B (not current cover)", bool(img_b),
         f"IMG_B={(img_b or '')[:120]}{'...' if img_b and len(img_b)>120 else ''}")

    # Step 4: PATCH cover with IMG_B
    payload = {"image_url": img_b, "focal_x": 0.5, "focal_y": 0.5, "scale": 1.0, "rotation": 0}
    r = requests.patch(f"{BASE}/admin/spots/{spot_id}/cover", json=payload, headers=headers, timeout=20)
    ok4 = r.status_code == 200
    body4 = r.json() if ok4 else {}
    step("Step 4: PATCH /admin/spots/{id}/cover with IMG_B", ok4,
         f"HTTP {r.status_code}; body keys={list(body4.keys()) if ok4 else r.text[:300]}")
    print("        admin_cover_override after step 4:")
    print("        " + json.dumps(body4.get("admin_cover_override"), indent=2, default=str).replace("\n", "\n        "))

    # Step 5: GET /api/spots/{id}
    r = requests.get(f"{BASE}/spots/{spot_id}", headers=headers, timeout=20)
    ok5_status = r.status_code == 200
    if not ok5_status:
        step("Step 5: GET /spots/{id}", False, f"HTTP {r.status_code}: {r.text[:300]}")
        return _summary()
    spot_after = r.json()
    aco = spot_after.get("admin_cover_override")
    print("        admin_cover_override on /spots/{id} after step 5:")
    print("        " + json.dumps(aco, indent=2, default=str).replace("\n", "\n        "))

    s5a = bool(aco) and aco.get("image_url") == img_b
    step("Step 5a: admin_cover_override.image_url == IMG_B", s5a,
         f"got {aco.get('image_url') if aco else None!r}")

    hero = spot_after.get("hero_cover_image_url")
    s5b = hero == img_b
    step("Step 5b: hero_cover_image_url == IMG_B", s5b,
         f"got {hero!r}")

    imgs_after = spot_after.get("images") or []
    s5c = any(im.get("image_url") == img_b for im in imgs_after if isinstance(im, dict))
    step("Step 5c: images[] still contains IMG_B (gallery intact)", s5c,
         f"images count={len(imgs_after)}")

    # Step 6: GET /api/spots?limit=50, find this spot, check hero_cover_image_url
    r = requests.get(f"{BASE}/spots", params={"limit": 50}, headers=headers, timeout=20)
    ok6 = r.status_code == 200
    if ok6:
        body6 = r.json()
        items = body6.get("items", body6) if isinstance(body6, dict) else body6
        match = next((s for s in items if s.get("spot_id") == spot_id), None)
        if match is None:
            # widen search
            r2 = requests.get(f"{BASE}/spots", params={"limit": 200}, headers=headers, timeout=20)
            if r2.status_code == 200:
                body6b = r2.json()
                items2 = body6b.get("items", body6b) if isinstance(body6b, dict) else body6b
                match = next((s for s in items2 if s.get("spot_id") == spot_id), None)
        if match is None:
            step("Step 6: spot present in /api/spots feed", False, "spot_id not in feed")
        else:
            list_hero = match.get("hero_cover_image_url")
            s6 = list_hero == img_b
            step("Step 6: list endpoint hero_cover_image_url == IMG_B", s6,
                 f"list got {list_hero!r}; detail got {hero!r}")
    else:
        step("Step 6: GET /spots?limit=50", False, f"HTTP {r.status_code}: {r.text[:300]}")

    # Step 7: PATCH again with a DIFFERENT image url
    img_c = None
    for im in editor_images:
        u = im.get("image_url")
        if u and u != img_b:
            img_c = u
            break
    if not img_c:
        step("Step 7: pick IMG_C (different than IMG_B)", False, "no other image candidate")
    else:
        r = requests.patch(f"{BASE}/admin/spots/{spot_id}/cover",
                           json={"image_url": img_c, "focal_x": 0.5, "focal_y": 0.5, "scale": 1.0, "rotation": 0},
                           headers=headers, timeout=20)
        ok7a = r.status_code == 200
        if ok7a:
            r2 = requests.get(f"{BASE}/spots/{spot_id}", headers=headers, timeout=20)
            sp = r2.json()
            aco2 = sp.get("admin_cover_override") or {}
            hero2 = sp.get("hero_cover_image_url")
            ok7 = aco2.get("image_url") == img_c and hero2 == img_c
            step("Step 7: PATCH with IMG_C updates both override & hero_cover_image_url", ok7,
                 f"override={aco2.get('image_url')!r} hero={hero2!r}")
        else:
            step("Step 7: PATCH with IMG_C", False, f"HTTP {r.status_code}: {r.text[:300]}")

    # Step 8: DELETE override
    r = requests.delete(f"{BASE}/admin/spots/{spot_id}/cover", headers=headers, timeout=20)
    ok8a = r.status_code == 200
    if ok8a:
        r2 = requests.get(f"{BASE}/spots/{spot_id}", headers=headers, timeout=20)
        sp = r2.json()
        aco3 = sp.get("admin_cover_override")
        hero3 = sp.get("hero_cover_image_url")
        # admin_cover_override should be None/missing; hero should still exist (fallback)
        ok8 = (aco3 is None) and bool(hero3) and hero3 != img_c  # fallback != last admin pick (hopefully)
        # relaxed: just confirm override gone & hero present
        step("Step 8: DELETE cover override clears it & hero falls back",
             (aco3 is None) and bool(hero3),
             f"override now={aco3!r}, hero fallback={hero3!r}")
    else:
        step("Step 8: DELETE /admin/spots/{id}/cover", False, f"HTTP {r.status_code}: {r.text[:300]}")

    # Step 9: PATCH with cropped image: focal_x=0.3, focal_y=0.7, scale=1.5, rotation=90
    crop = {"image_url": img_b, "focal_x": 0.3, "focal_y": 0.7, "scale": 1.5, "rotation": 90}
    r = requests.patch(f"{BASE}/admin/spots/{spot_id}/cover", json=crop, headers=headers, timeout=20)
    if r.status_code == 200:
        r2 = requests.get(f"{BASE}/spots/{spot_id}", headers=headers, timeout=20)
        sp = r2.json()
        aco4 = sp.get("admin_cover_override") or {}
        ok9 = (
            aco4.get("image_url") == img_b
            and abs(float(aco4.get("focal_x", 0)) - 0.3) < 1e-6
            and abs(float(aco4.get("focal_y", 0)) - 0.7) < 1e-6
            and abs(float(aco4.get("scale", 0)) - 1.5) < 1e-6
            and int(aco4.get("rotation", -1)) == 90
        )
        step("Step 9: PATCH cropped (fx=0.3, fy=0.7, scale=1.5, rot=90) persists exactly", ok9,
             f"got override={json.dumps({k: aco4.get(k) for k in ('image_url','focal_x','focal_y','scale','rotation')}, default=str)}")
    else:
        step("Step 9: PATCH with crop", False, f"HTTP {r.status_code}: {r.text[:300]}")

    return _summary()

def _summary():
    print("\n=== SUMMARY ===")
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"{passed}/{len(results)} steps passed")
    for name, ok, _ in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    return all(ok for _, ok, _ in results)

if __name__ == "__main__":
    sys.exit(0 if main() else 1)
