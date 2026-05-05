"""
Backend test for the Organized R2 storage layout (May 2026).

Verifies:
  1) Slug helpers (read-only)
  2) NEW LAYOUT — POST /api/uploads/image WITH ?spot_id=...
  3) LEGACY LAYOUT — POST /api/uploads/image WITHOUT spot_id
  4) STALE / UNKNOWN spot_id falls back gracefully
  5) FULL ROUND-TRIP — record + admin delete (R2 object deleted)
  6) BACKWARDS COMPAT — legacy storage_key delete still works
  7) BACKWARDS COMPAT — null storage_key still safe
  8) NO REGRESSIONS — smoke tests on existing endpoints

Run from /app:  python3 backend_test.py
"""
import io
import json
import sys
import time
import urllib.parse
from typing import Optional, Tuple

import requests
from PIL import Image

# ── Config ───────────────────────────────────────────────────────────────
BACKEND = "https://photo-finder-60.preview.emergentagent.com"
API = f"{BACKEND}/api"

PRIMARY_SUPER_ADMIN = ("kclarson187@gmail.com", "Pass123!")
SEED_ADMIN = ("admin@lumascout.app", "Grayson@1117!!")

RESULTS = []
CREATED_UPLOADS = []  # list of dicts we may need to clean up


def log(name: str, ok: bool, detail: str = ""):
    mark = "PASS" if ok else "FAIL"
    line = f"[{mark}] {name}" + ((" — " + detail) if detail else "")
    print(line, flush=True)
    RESULTS.append((name, ok, detail))


def auth_login() -> Tuple[str, dict]:
    for email, pw in (PRIMARY_SUPER_ADMIN, SEED_ADMIN):
        r = requests.post(
            f"{API}/auth/login",
            json={"email": email, "password": pw},
            timeout=15,
        )
        if r.status_code == 200:
            data = r.json()
            token = data.get("token") or data.get("access_token")
            user = data.get("user") or {}
            print(f"[auth] logged in as {email} (role={user.get('role')}, id={user.get('user_id')})")
            return token, user
        print(f"[auth] {email} → HTTP {r.status_code}: {r.text[:200]}")
    raise RuntimeError("Could not authenticate as super_admin or seed admin")


def make_jpeg(width: int = 320, height: int = 240, color=(220, 60, 60)) -> bytes:
    img = Image.new("RGB", (width, height), color)
    px = img.load()
    px[0, 0] = (int(time.time() * 1000) % 255, 0, 0)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def head(url: str) -> int:
    try:
        r = requests.head(url, timeout=15, allow_redirects=True)
        return r.status_code
    except requests.RequestException as e:
        print(f"[head] {url} → exception {e!r}")
        return 0


# ── Tests ────────────────────────────────────────────────────────────────


def test_1_slug_helpers():
    print("\n=== 1) Slug helpers ===")
    sys.path.insert(0, "/app/backend")
    try:
        from services.storage_r2 import slugify, build_location_key_prefix
    except Exception as e:
        log("1.import", False, f"import failure: {e!r}")
        return
    cases = [
        (slugify("Charro Ranch Park"), "charro-ranch-park"),
        (slugify("São Paulo"), "sao-paulo"),
        (slugify(""), "spot"),
        (slugify(None), "spot"),
        (slugify("McAllister Park (TX)"), "mcallister-park-tx"),
        (
            build_location_key_prefix("spot_abc", "McAllister Park (TX)"),
            "locations/mcallister-park-tx_spot_abc/gallery",
        ),
    ]
    all_ok = True
    for got, want in cases:
        ok = got == want
        all_ok &= ok
        print(f"   {'ok' if ok else 'FAIL'}: got={got!r} want={want!r}")
    log("1.slug_helpers", all_ok)


def get_existing_spot(token: str) -> Optional[dict]:
    r = requests.get(
        f"{API}/spots",
        params={"limit": 1},
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    if r.status_code != 200:
        log("0.fetch_spot", False, f"HTTP {r.status_code}: {r.text[:200]}")
        return None
    j = r.json()
    items = j.get("items") if isinstance(j, dict) else j
    if not items:
        log("0.fetch_spot", False, "no spots returned")
        return None
    spot = items[0]
    print(f"[spot] using spot_id={spot.get('spot_id')} title={spot.get('title')!r}")
    return spot


def test_2_new_layout(token: str, spot: dict):
    print("\n=== 2) NEW LAYOUT — POST /api/uploads/image with ?spot_id ===")
    sys.path.insert(0, "/app/backend")
    from services.storage_r2 import slugify

    spot_id = spot["spot_id"]
    title = spot.get("title") or ""
    expected_slug = slugify(title)

    blob = make_jpeg(640, 480)
    files = {"file": ("test_new_layout.jpg", blob, "image/jpeg")}
    r = requests.post(
        f"{API}/uploads/image",
        params={"spot_id": spot_id},
        files=files,
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    if r.status_code != 200:
        log("2.upload", False, f"HTTP {r.status_code}: {r.text[:300]}")
        return None
    body = r.json()
    print(f"[upload] keys: {sorted(body.keys())}")
    print(f"[upload] storage_key={body.get('storage_key')}")
    print(f"[upload] image_url={body.get('image_url')}")

    required = {"image_url", "image_id", "storage", "storage_key", "r2_key",
                "width", "height", "bytes", "size_bytes", "mime", "content_type"}
    missing = required - set(body.keys())
    log("2.response_shape", len(missing) == 0, f"missing={missing}" if missing else "")

    log("2.image_id_prefix", isinstance(body.get("image_id"), str) and body["image_id"].startswith("img_"),
        f"image_id={body.get('image_id')}")
    log("2.storage_r2", body.get("storage") == "r2", f"storage={body.get('storage')}")

    sk = body.get("storage_key") or ""
    expected_prefix = f"locations/{expected_slug}_{spot_id}/gallery/"
    log("2.storage_key_prefix",
        sk.startswith(expected_prefix) and sk.endswith(".jpg"),
        f"sk={sk!r} expected_prefix={expected_prefix!r}")

    log("2.r2_key_equals_storage_key", body.get("r2_key") == body.get("storage_key"))

    iurl = body.get("image_url") or ""
    log("2.image_url_pub_prefix", iurl.startswith("https://pub-") and sk in iurl,
        f"image_url={iurl}")

    code = head(iurl)
    log("2.head_image_url_200", code == 200, f"HEAD={code}")

    body["_spot_id"] = spot_id
    CREATED_UPLOADS.append(body)
    return body


def test_3_legacy_layout(token: str):
    print("\n=== 3) LEGACY LAYOUT — POST /api/uploads/image without spot_id ===")
    blob = make_jpeg(320, 240, color=(60, 180, 60))
    files = {"file": ("test_legacy.jpg", blob, "image/jpeg")}
    r = requests.post(
        f"{API}/uploads/image",
        files=files,
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    if r.status_code != 200:
        log("3.upload", False, f"HTTP {r.status_code}: {r.text[:300]}")
        return None
    body = r.json()
    print(f"[legacy] storage_key={body.get('storage_key')}")
    print(f"[legacy] image_url={body.get('image_url')}")

    sk = body.get("storage_key") or ""
    log("3.storage_key_uploads_prefix",
        sk.startswith("uploads/") and sk.endswith(".jpg"),
        f"sk={sk!r}")
    parts = sk.split("/")
    yyyy_mm_ok = (
        len(parts) >= 4
        and parts[0] == "uploads"
        and parts[1].isdigit() and len(parts[1]) == 4
        and parts[2].isdigit() and len(parts[2]) == 2
    )
    log("3.storage_key_yyyy_mm", yyyy_mm_ok, f"parts={parts[:4]}")

    iurl = body.get("image_url") or ""
    log("3.image_url_full_r2", iurl.startswith("https://pub-") and sk in iurl, f"image_url={iurl}")

    log("3.spot_id_null", body.get("spot_id") in (None, ""), f"spot_id={body.get('spot_id')}")
    log("3.r2_key_equals_storage_key", body.get("r2_key") == sk)
    log("3.has_image_id", isinstance(body.get("image_id"), str) and body["image_id"].startswith("img_"))
    log("3.has_size_bytes", isinstance(body.get("size_bytes"), int) and body["size_bytes"] > 0)
    log("3.has_content_type", body.get("content_type") == "image/jpeg")

    code = head(iurl)
    log("3.head_image_url_200", code == 200, f"HEAD={code}")

    body["_spot_id"] = None
    CREATED_UPLOADS.append(body)
    return body


def test_4_unknown_spot_id(token: str):
    print("\n=== 4) UNKNOWN spot_id — graceful fallback ===")
    blob = make_jpeg(200, 200, color=(60, 60, 200))
    files = {"file": ("test_unknown_spot.jpg", blob, "image/jpeg")}
    r = requests.post(
        f"{API}/uploads/image",
        params={"spot_id": "spot_doesnotexist123"},
        files=files,
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    if r.status_code != 200:
        log("4.upload", False, f"HTTP {r.status_code}: {r.text[:300]}")
        return None
    body = r.json()
    sk = body.get("storage_key") or ""
    print(f"[unknown] storage_key={sk}")
    log("4.no_4xx", True, "HTTP 200")
    log("4.fallback_to_uploads_prefix",
        sk.startswith("uploads/") and not sk.startswith("locations/"),
        f"sk={sk!r}")
    log("4.spot_id_null", body.get("spot_id") in (None, ""), f"spot_id={body.get('spot_id')}")

    body["_spot_id"] = None
    CREATED_UPLOADS.append(body)
    return body


def test_5_round_trip(token: str, spot: dict, upload: Optional[dict]):
    print("\n=== 5) ROUND-TRIP — record + admin delete (R2 deleted) ===")
    if upload is None:
        log("5.precondition", False, "no upload from test 2")
        return None

    spot_id = spot["spot_id"]
    image_url = upload["image_url"]
    storage_key = upload["storage_key"]

    body = {
        "images": [{
            "image_url": image_url,
            "storage_key": storage_key,
            "image_id": upload["image_id"],
            "content_type": "image/jpeg",
            "size_bytes": upload["bytes"],
            "width": upload["width"],
            "height": upload["height"],
        }],
        "caption": "r2 organized layout test",
        "condition_tags": [],
        "visibility": "public",
    }
    r = requests.post(
        f"{API}/spots/{spot_id}/uploads",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if r.status_code != 200:
        log("5.post_upload", False, f"HTTP {r.status_code}: {r.text[:300]}")
        return None
    cu = r.json()
    print(f"[round-trip] post: {cu}")
    log("5.post.ok", cu.get("ok") is True)
    log("5.post.count", cu.get("count") == 1, f"count={cu.get('count')}")
    log("5.post.auto_approved", cu.get("auto_approved") is True, f"auto_approved={cu.get('auto_approved')}")

    r = requests.get(
        f"{API}/spots/{spot_id}/uploads",
        params={"limit": 25},
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    found = False
    if r.status_code == 200:
        items = r.json().get("items", [])
        for it in items:
            if it.get("image_url") == image_url:
                found = True
                break
    log("5.uploads_listing_has_row", found, f"GET /uploads HTTP {r.status_code}")

    enc = urllib.parse.quote(image_url, safe="")
    r = requests.delete(
        f"{API}/admin/spots/{spot_id}/images/{enc}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if r.status_code != 200:
        log("5.delete", False, f"HTTP {r.status_code}: {r.text[:400]}")
        return None
    delr = r.json()
    print(f"[round-trip] delete: {json.dumps(delr, indent=2)[:1000]}")
    log("5.delete.ok", delr.get("ok") is True)

    fc = delr.get("file_cleanup") or {}
    log("5.file_cleanup.storage_r2", fc.get("storage") == "r2", f"storage={fc.get('storage')}")
    log("5.file_cleanup.deleted", fc.get("deleted") is True, f"file_cleanup={fc}")
    log("5.file_cleanup.path_eq_storage_key", fc.get("path") == storage_key,
        f"path={fc.get('path')!r} sk={storage_key!r}")

    cc = delr.get("community_cleanup") or {}
    log("5.community_cleanup.deleted_ge_1", (cc.get("deleted") or 0) >= 1, f"community_cleanup={cc}")

    code = head(image_url)
    log("5.head_after_delete_404", code in (403, 404), f"HEAD after delete={code}")

    upload["_cleaned"] = True
    return delr


def test_6_legacy_delete(token: str, spot: dict, legacy_upload: Optional[dict]):
    print("\n=== 6) BACKWARDS COMPAT — legacy storage_key delete ===")
    if legacy_upload is None:
        log("6.precondition", False, "no legacy upload from test 3")
        return None
    spot_id = spot["spot_id"]
    image_url = legacy_upload["image_url"]
    storage_key = legacy_upload["storage_key"]

    body = {
        "images": [{
            "image_url": image_url,
            "storage_key": storage_key,
            "image_id": legacy_upload["image_id"],
            "content_type": "image/jpeg",
            "size_bytes": legacy_upload["bytes"],
            "width": legacy_upload["width"],
            "height": legacy_upload["height"],
        }],
        "caption": "r2 legacy layout backwards-compat test",
        "condition_tags": [],
        "visibility": "public",
    }
    r = requests.post(
        f"{API}/spots/{spot_id}/uploads", json=body,
        headers={"Authorization": f"Bearer {token}"}, timeout=30,
    )
    log("6.post", r.status_code == 200, f"HTTP {r.status_code}")

    enc = urllib.parse.quote(image_url, safe="")
    r = requests.delete(
        f"{API}/admin/spots/{spot_id}/images/{enc}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if r.status_code != 200:
        log("6.delete", False, f"HTTP {r.status_code}: {r.text[:400]}")
        return None
    delr = r.json()
    print(f"[legacy delete] {json.dumps(delr, indent=2)[:800]}")
    log("6.delete.ok", delr.get("ok") is True)
    fc = delr.get("file_cleanup") or {}
    log("6.file_cleanup.storage_r2", fc.get("storage") == "r2", f"file_cleanup={fc}")
    log("6.file_cleanup.deleted", fc.get("deleted") is True)
    log("6.file_cleanup.path_eq_legacy_key", fc.get("path") == storage_key,
        f"path={fc.get('path')!r} sk={storage_key!r}")

    code = head(image_url)
    log("6.head_after_delete_404", code in (403, 404), f"HEAD={code}")

    legacy_upload["_cleaned"] = True
    return delr


def test_7_null_storage_key(token: str, spot: dict):
    print("\n=== 7) BACKWARDS COMPAT — null storage_key external URL ===")
    spot_id = spot["spot_id"]
    external = f"https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=800&q=80&t={int(time.time())}"
    body = {
        "images": [{
            "image_url": external,
            "storage_key": None,
        }],
        "caption": "external url null storage_key test",
        "condition_tags": [],
        "visibility": "public",
    }
    r = requests.post(
        f"{API}/spots/{spot_id}/uploads", json=body,
        headers={"Authorization": f"Bearer {token}"}, timeout=30,
    )
    if r.status_code != 200:
        log("7.post", False, f"HTTP {r.status_code}: {r.text[:300]}")
        return None
    log("7.post.ok", r.json().get("ok") is True)

    enc = urllib.parse.quote(external, safe="")
    r = requests.delete(
        f"{API}/admin/spots/{spot_id}/images/{enc}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if r.status_code != 200:
        log("7.delete", False, f"HTTP {r.status_code}: {r.text[:400]}")
        return None
    delr = r.json()
    print(f"[null sk delete] {json.dumps(delr, indent=2)[:600]}")
    log("7.delete.ok", delr.get("ok") is True)
    fc = delr.get("file_cleanup") or {}
    log("7.file_cleanup.external_url_not_local",
        fc.get("reason") == "external_url_not_local",
        f"file_cleanup={fc}")
    return delr


def test_8_smoke(token: str, spot_id: str):
    print("\n=== 8) NO REGRESSIONS — smoke tests ===")
    headers = {"Authorization": f"Bearer {token}"}

    r = requests.get(f"{API}/spots", params={"limit": 5}, headers=headers, timeout=15)
    log("8a.spots_list", r.status_code == 200, f"HTTP {r.status_code}")

    r = requests.get(
        f"{API}/spots/markers",
        params={"sw_lat": -90, "sw_lng": -180, "ne_lat": 90, "ne_lng": 180, "limit": 20},
        headers=headers, timeout=15,
    )
    log("8b.spots_markers", r.status_code == 200, f"HTTP {r.status_code}")

    r = requests.get(f"{API}/spots/{spot_id}", headers=headers, timeout=15)
    log("8c.spots_detail", r.status_code == 200, f"HTTP {r.status_code}")

    r = requests.get(
        f"{API}/spots/{spot_id}/uploads",
        params={"limit": 10}, headers=headers, timeout=15,
    )
    log("8d.spots_uploads", r.status_code == 200, f"HTTP {r.status_code}")


def cleanup_uploads(token: str):
    headers = {"Authorization": f"Bearer {token}"}
    for u in CREATED_UPLOADS:
        if u.get("_cleaned"):
            continue
        spot_id = u.get("_spot_id")
        url = u.get("image_url")
        if not spot_id or not url:
            print(f"[cleanup] orphan (no spot_id, won't try admin delete): {url}")
            continue
        enc = urllib.parse.quote(url, safe="")
        try:
            r = requests.delete(
                f"{API}/admin/spots/{spot_id}/images/{enc}",
                headers=headers, timeout=20,
            )
            print(f"[cleanup] DELETE {url[:80]} → {r.status_code}")
        except Exception as e:
            print(f"[cleanup] DELETE {url[:80]} → exception {e!r}")


def main():
    print(f"Backend: {BACKEND}")

    test_1_slug_helpers()

    token, _user = auth_login()

    spot = get_existing_spot(token)
    if not spot:
        print("Cannot proceed without an existing spot.")
        sys.exit(1)
    spot_id = spot["spot_id"]

    new_upload = test_2_new_layout(token, spot)
    legacy_upload = test_3_legacy_layout(token)
    test_4_unknown_spot_id(token)
    test_5_round_trip(token, spot, new_upload)
    test_6_legacy_delete(token, spot, legacy_upload)
    test_7_null_storage_key(token, spot)
    test_8_smoke(token, spot_id)

    cleanup_uploads(token)

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    fails = [(n, d) for n, ok, d in RESULTS if not ok]
    passes = [(n, d) for n, ok, d in RESULTS if ok]
    for name, ok, d in RESULTS:
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {name}{(' — ' + d) if d and not ok else ''}")
    print(f"\nTotal: {len(passes)} passed, {len(fails)} failed (of {len(RESULTS)})")
    sys.exit(0 if not fails else 1)


if __name__ == "__main__":
    main()
