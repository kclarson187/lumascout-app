"""
Backend test for HEIC upload fix + community uploads regression.

Targeted scope (per review):
  1. Confirm pillow-heif is registered in this Python.
  2. JPEG upload via POST /api/uploads/image still works.
  3. HEIC upload via POST /api/uploads/image succeeds (the key fix).
  4. Error categorization (400 empty / 413 too large / 415 wrong format / 401 unauth).
  5. Structured logging from `lumascout.uploads` is emitted.
  6. POST /api/spots/{spot_id}/uploads (community photo bundle) ends up in
     db.spot_community_uploads.
  7. Regression smoke on /auth/me, /feed/home, /spots paginated, /spots/markers.

Auth uses super_admin from /app/memory/test_credentials.md.
"""
from __future__ import annotations

import io
import json
import os
import sys
import time
import subprocess
from typing import Any

import requests
from PIL import Image
import pillow_heif

BASE = os.environ.get("LS_TEST_BASE", "https://photo-finder-60.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

PASS_LOG: list[str] = []
FAIL_LOG: list[str] = []


def ok(msg: str):
    print(f"  PASS  {msg}")
    PASS_LOG.append(msg)


def fail(msg: str):
    print(f"  FAIL  {msg}")
    FAIL_LOG.append(msg)


def section(title: str):
    print(f"\n=== {title} ===")


# ---------------------------------------------------------------------------
# Section 0: pillow-heif registration sanity check (in-process)
# ---------------------------------------------------------------------------
def test_pillow_heif_registered():
    section("0. pillow-heif registered locally")
    pillow_heif.register_heif_opener()
    ext = Image.registered_extensions().get(".heic")
    if ext == "HEIF":
        ok(f"Image.registered_extensions()['.heic'] == 'HEIF' (pillow_heif {pillow_heif.__version__})")
    else:
        fail(f"Expected '.heic' -> 'HEIF', got {ext!r}")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def login_admin() -> str | None:
    section("Auth: login admin")
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    if r.status_code != 200:
        fail(f"/auth/login -> {r.status_code} body={r.text[:200]}")
        return None
    tok = r.json().get("token")
    if not tok:
        fail(f"/auth/login missing token: {r.json()}")
        return None
    ok(f"/auth/login -> 200, token len={len(tok)}")
    return tok


# ---------------------------------------------------------------------------
# Section 1: JPEG upload
# ---------------------------------------------------------------------------
def make_jpeg_bytes(size=(120, 120), color=(50, 100, 200)) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def make_heic_bytes(size=(100, 100), color=(200, 100, 50)) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    pillow_heif.from_pillow(img).save(buf, format="HEIF")
    return buf.getvalue()


def test_jpeg_upload(token: str) -> str | None:
    section("1. JPEG upload via /api/uploads/image")
    jpeg = make_jpeg_bytes()
    files = {"file": ("test.jpg", jpeg, "image/jpeg")}
    r = requests.post(
        f"{API}/uploads/image",
        files=files,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if r.status_code != 200:
        fail(f"JPEG upload -> {r.status_code} body={r.text[:300]}")
        return None
    j = r.json()
    expected_keys = {"image_url", "width", "height", "bytes", "mime"}
    missing = expected_keys - set(j.keys())
    if missing:
        fail(f"JPEG upload response missing keys: {missing}; got {set(j.keys())}")
        return None
    if j["mime"] != "image/jpeg":
        fail(f"JPEG upload mime expected image/jpeg got {j['mime']!r}")
    if not isinstance(j["width"], int) or not isinstance(j["height"], int):
        fail(f"JPEG upload width/height not int: {j['width']!r}, {j['height']!r}")
    if not str(j["image_url"]).startswith("/api/uploads/"):
        fail(f"JPEG upload image_url unexpected: {j['image_url']!r}")
    ok(f"JPEG -> 200 {j['width']}x{j['height']} bytes={j['bytes']} mime={j['mime']} url={j['image_url']}")
    return j["image_url"]


# ---------------------------------------------------------------------------
# Section 2: HEIC upload — the key fix
# ---------------------------------------------------------------------------
def test_heic_upload(token: str):
    section("2. HEIC upload via /api/uploads/image (KEY FIX)")
    try:
        heic = make_heic_bytes()
    except Exception as e:
        fail(f"Failed to synthesize HEIC bytes locally: {e}")
        return
    if len(heic) < 100:
        fail(f"Synthesized HEIC suspiciously small: {len(heic)} bytes")
        return
    files = {"file": ("test.heic", heic, "image/heic")}
    r = requests.post(
        f"{API}/uploads/image",
        files=files,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if r.status_code != 200:
        fail(f"HEIC upload -> {r.status_code} body={r.text[:400]}")
        return
    j = r.json()
    if j.get("mime") != "image/jpeg":
        fail(f"HEIC server output mime expected image/jpeg got {j.get('mime')!r}")
        return
    if not (j.get("width") and j.get("height")):
        fail(f"HEIC upload missing width/height: {j}")
        return
    ok(f"HEIC -> 200 transcoded to JPEG {j['width']}x{j['height']} bytes={j['bytes']} url={j['image_url']}")


# ---------------------------------------------------------------------------
# Section 3: Error categorization
# ---------------------------------------------------------------------------
def test_empty_body(token: str):
    section("3a. Empty body -> 400 friendly")
    files = {"file": ("empty.jpg", b"", "image/jpeg")}
    r = requests.post(
        f"{API}/uploads/image",
        files=files,
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    if r.status_code != 400:
        fail(f"Empty body expected 400 got {r.status_code} body={r.text[:200]}")
        return
    detail = ""
    try:
        detail = r.json().get("detail", "")
    except Exception:
        detail = r.text
    if "empty" in detail.lower() or "didn't make it" in detail.lower() or "didnt make it" in detail.lower():
        ok(f"Empty body -> 400 detail={detail!r}")
    else:
        fail(f"Empty body 400 but detail unfriendly: {detail!r}")


def test_too_large(token: str):
    section("3b. >10MB body -> 413 friendly")
    # 11 MB of pseudo-random bytes; doesn't need to be a valid image because
    # the size check fires before Pillow decode.
    blob = os.urandom(11 * 1024 * 1024)
    files = {"file": ("huge.jpg", blob, "image/jpeg")}
    r = requests.post(
        f"{API}/uploads/image",
        files=files,
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    if r.status_code != 413:
        fail(f"11MB body expected 413 got {r.status_code} body={r.text[:200]}")
        return
    detail = ""
    try:
        detail = r.json().get("detail", "")
    except Exception:
        detail = r.text
    low = detail.lower()
    if "too large" in low or "max" in low or "mb" in low or "size" in low:
        ok(f"11MB -> 413 detail={detail!r}")
    else:
        fail(f"11MB 413 but detail not size-related: {detail!r}")


def test_wrong_format(token: str):
    section("3c. Text file with image/png content_type -> 415 friendly")
    body = b"this is plain text, not an image\n" * 8
    files = {"file": ("notes.png", body, "image/png")}
    r = requests.post(
        f"{API}/uploads/image",
        files=files,
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    if r.status_code != 415:
        fail(f"Text-as-png expected 415 got {r.status_code} body={r.text[:200]}")
        return
    detail = ""
    try:
        detail = r.json().get("detail", "")
    except Exception:
        detail = r.text
    low = detail.lower()
    if any(s in low for s in ["jpeg", "png", "webp", "heic", "supported", "doesn't look"]):
        ok(f"Text-as-png -> 415 detail={detail!r}")
    else:
        fail(f"Text-as-png 415 but detail not format-related: {detail!r}")


def test_unauthenticated():
    section("3d. Unauthenticated -> 401")
    jpeg = make_jpeg_bytes()
    files = {"file": ("test.jpg", jpeg, "image/jpeg")}
    r = requests.post(f"{API}/uploads/image", files=files, timeout=20)
    if r.status_code in (401, 403):
        ok(f"Unauth -> {r.status_code}")
    else:
        fail(f"Unauth expected 401/403 got {r.status_code} body={r.text[:200]}")


# ---------------------------------------------------------------------------
# Section 4: Structured logging
# ---------------------------------------------------------------------------
def test_structured_logging(token: str):
    section("4. Structured logging on lumascout.uploads after a successful upload")
    # Trigger a fresh upload, then tail backend logs.
    jpeg = make_jpeg_bytes(size=(64, 64), color=(10, 200, 30))
    files = {"file": ("logprobe.jpg", jpeg, "image/jpeg")}
    r = requests.post(
        f"{API}/uploads/image",
        files=files,
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    if r.status_code != 200:
        fail(f"Could not seed log line: upload -> {r.status_code} {r.text[:200]}")
        return
    # Give the logger a moment to flush.
    time.sleep(0.8)
    log_text = ""
    for path in (
        "/var/log/supervisor/backend.out.log",
        "/var/log/supervisor/backend.err.log",
    ):
        try:
            res = subprocess.run(
                ["tail", "-n", "400", path],
                capture_output=True, text=True, timeout=10,
            )
            log_text += "\n" + (res.stdout or "")
        except Exception:
            pass
    if not log_text.strip():
        fail("No backend log content captured from supervisor logs")
        return
    has_start = "upload_image.start" in log_text
    has_ok = "upload_image.ok" in log_text
    if has_start and has_ok:
        # Pull the most recent .ok line for inspection.
        last_ok = ""
        for line in reversed(log_text.splitlines()):
            if "upload_image.ok" in line:
                last_ok = line
                break
        # Quick sanity that fields we care about appear.
        wanted = ["user_id=", "filename=", "in_bytes=", "in_mime=", "out_bytes=", "out_dim=", "url=", "elapsed_ms="]
        missing = [w for w in wanted if w not in last_ok]
        if missing:
            fail(f"upload_image.ok line missing fields {missing}; line={last_ok!r}")
        else:
            ok(f"Structured log .start + .ok present; .ok line includes all expected fields")
    else:
        fail(f"Expected upload_image.start and upload_image.ok in logs (start={has_start} ok={has_ok})")


# ---------------------------------------------------------------------------
# Section 5: Community photo upload to a real spot
# ---------------------------------------------------------------------------
def test_community_upload(token: str, image_url: str):
    section("5. POST /api/spots/{spot_id}/uploads")
    if not image_url:
        fail("Skipped: no image_url available from JPEG step")
        return
    # Find any real spot.
    r = requests.get(f"{API}/spots?limit=5", timeout=20)
    if r.status_code != 200:
        fail(f"/spots -> {r.status_code}")
        return
    arr = r.json()
    if not isinstance(arr, list) or not arr:
        fail(f"/spots returned empty/non-list: {type(arr).__name__}")
        return
    spot_id = arr[0].get("spot_id")
    if not spot_id:
        fail(f"First spot has no spot_id: {arr[0]}")
        return
    body = {
        "images": [{"image_url": image_url, "caption": None}],
        "caption": "Test upload",
        "condition_tags": ["verified_today"],
        "visibility": "public",
    }
    r = requests.post(
        f"{API}/spots/{spot_id}/uploads",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if r.status_code != 200:
        fail(f"community upload -> {r.status_code} body={r.text[:300]}")
        return
    j = r.json()
    expected = {"ok", "batch_id", "moderation_status", "auto_approved", "count", "message"}
    missing = expected - set(j.keys())
    if missing:
        fail(f"Community upload response missing keys: {missing}; got {j}")
        return
    if not j.get("ok") or j.get("count") != 1 or not j.get("batch_id"):
        fail(f"Community upload payload unexpected: {j}")
        return
    ok(
        f"community upload -> 200 ok=True batch_id={j['batch_id']} "
        f"status={j['moderation_status']} auto_approved={j['auto_approved']}"
    )

    # Verify row landed in db.spot_community_uploads via list endpoint.
    r2 = requests.get(
        f"{API}/spots/{spot_id}/uploads?limit=24",
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    if r2.status_code != 200:
        fail(f"/spots/{{id}}/uploads list -> {r2.status_code}")
        return
    listing = r2.json()
    items = listing.get("items") if isinstance(listing, dict) else listing
    if not isinstance(items, list):
        fail(f"uploads list shape unexpected: {type(listing).__name__}")
        return
    matching = [u for u in items if u.get("batch_id") == j["batch_id"]]
    if matching:
        ok(f"Row landed in spot_community_uploads — found {len(matching)} item(s) with batch_id")
    else:
        # If auto_approved was False and viewer is not owner/admin, list may not show pending.
        # Admin should see pending items.
        if not j.get("auto_approved"):
            # admin viewer should still see pending (since admin is staff)
            fail(f"Admin should see new pending upload but no rows match batch_id={j['batch_id']}")
        else:
            fail(f"Auto-approved upload not surfaced in list endpoint")


# ---------------------------------------------------------------------------
# Section 6: Regression smoke
# ---------------------------------------------------------------------------
def test_regression_smoke(token: str):
    section("6. Regression smoke")
    h = {"Authorization": f"Bearer {token}"}
    cases = [
        ("/auth/me", h),
        ("/feed/home", h),
        ("/spots?paginated=1&limit=10", None),
        ("/spots/markers?limit=20", None),
    ]
    for path, hh in cases:
        r = requests.get(f"{API}{path}", headers=hh or {}, timeout=20)
        if r.status_code == 200:
            ok(f"GET {path} -> 200")
        else:
            fail(f"GET {path} -> {r.status_code} body={r.text[:200]}")


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
def main():
    print(f"BASE: {API}")
    test_pillow_heif_registered()
    token = login_admin()
    if not token:
        print("\nABORT: admin login failed; cannot continue.")
        return 1
    image_url = test_jpeg_upload(token)
    test_heic_upload(token)
    test_empty_body(token)
    test_too_large(token)
    test_wrong_format(token)
    test_unauthenticated()
    test_structured_logging(token)
    test_community_upload(token, image_url or "")
    test_regression_smoke(token)

    print("\n" + "=" * 60)
    print(f"RESULTS: {len(PASS_LOG)} pass, {len(FAIL_LOG)} fail")
    if FAIL_LOG:
        print("\nFAILURES:")
        for f in FAIL_LOG:
            print(f"  - {f}")
    return 0 if not FAIL_LOG else 2


if __name__ == "__main__":
    sys.exit(main())
