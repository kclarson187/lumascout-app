"""
REGRESSION TEST — Auth + Upload flow after May 2026 storage hardening.
Backend untouched; this test verifies the backend contract still holds for
the frontend storage helpers (api.ts dual-write, upload-image.ts 401-handling).
"""
import io
import json
import urllib.parse
import requests
from PIL import Image

BASE = "https://photo-finder-60.preview.emergentagent.com"
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

results = []

def record(bucket, name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] B{bucket} {name}: {detail[:300]}")
    results.append((bucket, name, ok, detail))

def make_jpeg(size=(80, 60), color=(180, 90, 60)):
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=78)
    return buf.getvalue()


# -----------------------------------------------------------------------------
# BUCKET 1 — Email/password login → upload round-trip
# -----------------------------------------------------------------------------
print("\n=== BUCKET 1: Email/password login → upload round-trip ===")
token = None
try:
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=20)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    record(1, "1a-login", r.status_code == 200 and "token" in body,
           f"status={r.status_code} keys={list(body.keys())[:6]}")
    token = body.get("token")
except Exception as e:
    record(1, "1a-login", False, f"exc={e}")

auth_h = {"Authorization": f"Bearer {token}"} if token else {}

try:
    r = requests.get(f"{API}/auth/me", headers=auth_h, timeout=15)
    j = r.json()
    has_pc = "profile_complete" in j
    has_user_id = "user_id" in j or "email" in j
    record(1, "1a-me", r.status_code == 200 and has_pc and has_user_id,
           f"status={r.status_code} profile_complete={j.get('profile_complete')} email={j.get('email')}")
except Exception as e:
    record(1, "1a-me", False, f"exc={e}")

spot_id = None
try:
    r = requests.get(f"{API}/spots", params={"limit": 1}, headers=auth_h, timeout=15)
    rj = r.json()
    rows = rj if isinstance(rj, list) else rj.get("items", [])
    if isinstance(rows, list) and rows:
        spot_id = rows[0].get("spot_id") or rows[0].get("_id") or rows[0].get("id")
    record(1, "1b-list-spots", r.status_code == 200 and spot_id is not None,
           f"status={r.status_code} spot_id={spot_id}")
except Exception as e:
    record(1, "1b-list-spots", False, f"exc={e}")

image_url = None
storage_key = None
image_id = None
if spot_id and token:
    try:
        files = {"file": ("regression.jpg", make_jpeg(), "image/jpeg")}
        r = requests.post(f"{API}/uploads/image",
                          params={"spot_id": spot_id},
                          headers=auth_h, files=files, timeout=30)
        j = r.json()
        image_url = j.get("image_url")
        storage_key = j.get("storage_key") or j.get("r2_key")
        image_id = j.get("image_id")
        ok = (r.status_code == 200
              and j.get("image_url")
              and j.get("image_id")
              and j.get("r2_key")
              and j.get("storage") == "r2")
        record(1, "1c-upload", ok,
               f"status={r.status_code} storage={j.get('storage')} key={storage_key} image_id={image_id}")
    except Exception as e:
        record(1, "1c-upload", False, f"exc={e}")

if spot_id and image_url:
    try:
        body = {
            "images": [{
                "image_url": image_url,
                "storage_key": storage_key,
                "image_id": image_id,
                "content_type": "image/jpeg",
                "size_bytes": len(make_jpeg()),
                "width": 80,
                "height": 60,
            }],
            "caption": "regression smoke test",
        }
        r = requests.post(f"{API}/spots/{spot_id}/uploads",
                          headers={**auth_h, "Content-Type": "application/json"},
                          data=json.dumps(body), timeout=20)
        j = r.json()
        ok = (r.status_code == 200
              and j.get("ok") is True
              and j.get("count") == 1
              and j.get("auto_approved") is True)
        record(1, "1d-attach", ok,
               f"status={r.status_code} body={str(j)[:240]}")
    except Exception as e:
        record(1, "1d-attach", False, f"exc={e}")

if spot_id and image_url:
    try:
        enc = urllib.parse.quote(image_url, safe="")
        r = requests.delete(f"{API}/admin/spots/{spot_id}/images/{enc}",
                            headers=auth_h, timeout=20)
        j = r.json()
        fc = j.get("file_cleanup", {})
        ok = (r.status_code == 200 and fc.get("deleted") is True)
        record(1, "1e-cleanup", ok,
               f"status={r.status_code} file_cleanup={fc}")
    except Exception as e:
        record(1, "1e-cleanup", False, f"exc={e}")


# -----------------------------------------------------------------------------
# BUCKET 2 — Upload without auth header → 401
# -----------------------------------------------------------------------------
print("\n=== BUCKET 2: Upload without auth header ===")
try:
    files = {"file": ("noauth.jpg", make_jpeg(), "image/jpeg")}
    r = requests.post(f"{API}/uploads/image", files=files, timeout=20)
    is_json = "application/json" in (r.headers.get("content-type", "") or "")
    body = r.json() if is_json else {}
    has_detail = isinstance(body.get("detail"), (str, list, dict))
    ok = r.status_code in (401, 403) and is_json and has_detail
    record(2, "noauth-upload", ok,
           f"status={r.status_code} json={is_json} detail={str(body.get('detail'))[:120]}")
except Exception as e:
    record(2, "noauth-upload", False, f"exc={e}")


# -----------------------------------------------------------------------------
# BUCKET 3 — Upload with bad bearer → 401
# -----------------------------------------------------------------------------
print("\n=== BUCKET 3: Upload with bad bearer ===")
try:
    files = {"file": ("badtok.jpg", make_jpeg(), "image/jpeg")}
    r = requests.post(f"{API}/uploads/image", files=files,
                      headers={"Authorization": "Bearer not_a_real_jwt"},
                      timeout=20)
    is_json = "application/json" in (r.headers.get("content-type", "") or "")
    body = r.json() if is_json else {}
    has_detail = isinstance(body.get("detail"), (str, list, dict))
    ok = r.status_code == 401 and is_json and has_detail
    record(3, "bad-bearer-upload", ok,
           f"status={r.status_code} json={is_json} detail={str(body.get('detail'))[:120]}")
except Exception as e:
    record(3, "bad-bearer-upload", False, f"exc={e}")


# -----------------------------------------------------------------------------
# BUCKET 4 — /auth/me bad token → 401
# -----------------------------------------------------------------------------
print("\n=== BUCKET 4: /auth/me bad token ===")
try:
    r = requests.get(f"{API}/auth/me",
                     headers={"Authorization": "Bearer not_a_real_jwt"},
                     timeout=15)
    is_json = "application/json" in (r.headers.get("content-type", "") or "")
    body = r.json() if is_json else {}
    ok = r.status_code == 401 and is_json
    record(4, "bad-bearer-me", ok,
           f"status={r.status_code} json={is_json} detail={str(body.get('detail'))[:120]}")
except Exception as e:
    record(4, "bad-bearer-me", False, f"exc={e}")


# -----------------------------------------------------------------------------
# BUCKET 5 — Google session — invalid id
# -----------------------------------------------------------------------------
print("\n=== BUCKET 5: Google session invalid id ===")
try:
    r = requests.post(f"{API}/auth/google/session",
                      json={"session_id": "INVALID_SESSION_ABCDEF"},
                      timeout=20)
    is_json = "application/json" in (r.headers.get("content-type", "") or "")
    body = r.json() if is_json else {}
    detail = body.get("detail") if isinstance(body, dict) else None
    ok = (r.status_code == 401
          and is_json
          and detail == "Invalid session")
    record(5, "google-invalid", ok,
           f"status={r.status_code} json={is_json} detail={detail!r}")
except Exception as e:
    record(5, "google-invalid", False, f"exc={e}")

print("\n--- log scan for google_session.invalid_session ---")
try:
    with open("/var/log/supervisor/backend.err.log", "r", errors="ignore") as f:
        tail = f.read()[-50000:]
    matched = "google_session.invalid_session" in tail
    record(5, "google-log", matched,
           f"google_session.invalid_session in tail={matched}")
except Exception as e:
    record(5, "google-log", False, f"exc={e}")


# -----------------------------------------------------------------------------
# BUCKET 6 — Smoke
# -----------------------------------------------------------------------------
print("\n=== BUCKET 6: Smoke — unrelated endpoints ===")
try:
    r = requests.get(f"{API}/spots", params={"limit": 5}, timeout=15)
    record(6, "spots-list", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    record(6, "spots-list", False, f"exc={e}")

try:
    r = requests.get(f"{API}/spots/markers",
                     params={"sw_lat": -90, "sw_lng": -180,
                             "ne_lat": 90, "ne_lng": 180, "limit": 50},
                     timeout=15)
    record(6, "markers", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    record(6, "markers", False, f"exc={e}")

try:
    r = requests.get(f"{API}/feed/home", headers=auth_h, timeout=20)
    record(6, "feed-home", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    record(6, "feed-home", False, f"exc={e}")


# -----------------------------------------------------------------------------
# SUMMARY
# -----------------------------------------------------------------------------
print("\n\n========== SUMMARY ==========")
total = len(results)
passed = sum(1 for _, _, ok, _ in results if ok)
print(f"Total: {total}  Passed: {passed}  Failed: {total - passed}")
for b, n, ok, d in results:
    print(f"  [{'PASS' if ok else 'FAIL'}] B{b} {n} :: {d[:200]}")
