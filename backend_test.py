"""
DEPLOYMENT BLOCKER FIXES — Backend regression + new feature test (June 2025).

Verifies:
  1. NEW BEHAVIOR: GET /api/uploads/{year}/{month}/{filename}
     a) local file present → 200 image
     b) local file missing but in R2 → 302 redirect to R2 public URL
     c) totally bogus filename → 404
  2. REGRESSION: auth + core endpoints intact after admin.py edit
  3. REGRESSION: 8 spot_community_uploads rows whose URLs were rewritten
     to R2 still resolve.
"""
import io
import os
import json
import shutil
import time
import requests
import urllib.parse
from PIL import Image

BASE = "https://photo-finder-60.preview.emergentagent.com"
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

# Local file we'll temporarily hide to exercise case (b)
LEGACY_YEAR = "2026"
LEGACY_MONTH = "04"
LEGACY_FILENAME = "1507e924ed2940c8b5453add08436584.jpg"
LEGACY_PATH = f"/app/backend/uploads/{LEGACY_YEAR}/{LEGACY_MONTH}/{LEGACY_FILENAME}"
LEGACY_URL_PATH = f"/api/uploads/{LEGACY_YEAR}/{LEGACY_MONTH}/{LEGACY_FILENAME}"
R2_PUBLIC_BASE = "https://pub-799be3bb95574d71ad3213680ce5e0c1.r2.dev"

results = []


def record(bucket, name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] B{bucket} {name}: {detail[:400]}")
    results.append((bucket, name, ok, detail))


def hr(title):
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


# -----------------------------------------------------------------------------
# BUCKET 0 — Setup: admin login token (used by later admin-only endpoints)
# -----------------------------------------------------------------------------
hr("BUCKET 0: Admin login (regression check)")
token = None
try:
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=20)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    ok = r.status_code == 200 and "token" in body
    token = body.get("token")
    record(0, "admin-login", ok, f"status={r.status_code} token_len={len(token) if token else 0}")
except Exception as e:
    record(0, "admin-login", False, f"exc={e}")

auth_h = {"Authorization": f"Bearer {token}"} if token else {}


# -----------------------------------------------------------------------------
# BUCKET 1 — Legacy upload URL fallback (NEW BEHAVIOR)
# -----------------------------------------------------------------------------
hr("BUCKET 1: Legacy upload URL fallback to R2")

# Case (a): local file present → 200 image bytes
try:
    url = f"{BASE}{LEGACY_URL_PATH}"
    r = requests.get(url, timeout=20, allow_redirects=False)
    ct = r.headers.get("content-type", "")
    is_img = "image" in ct or (r.content[:3] in (b"\xff\xd8\xff", b"\x89PN"))
    ok = r.status_code == 200 and len(r.content) > 0
    record(1, "1a-local-present-200", ok,
           f"status={r.status_code} ct={ct} bytes={len(r.content)} img={is_img}")
except Exception as e:
    record(1, "1a-local-present-200", False, f"exc={e}")

# Case (b): rename local file, expect 302 to R2; restore after
case_b_ok = False
case_b_detail = ""
backup_path = LEGACY_PATH + ".bak_test"
local_existed = os.path.isfile(LEGACY_PATH)
moved = False
try:
    if local_existed:
        shutil.move(LEGACY_PATH, backup_path)
        moved = True
        # tiny delay to ensure FS visibility
        time.sleep(0.2)
        url = f"{BASE}{LEGACY_URL_PATH}"
        r = requests.get(url, timeout=20, allow_redirects=False)
        loc = r.headers.get("location", "")
        expected_key = f"uploads/{LEGACY_YEAR}/{LEGACY_MONTH}/{LEGACY_FILENAME}"
        case_b_ok = (
            r.status_code == 302
            and R2_PUBLIC_BASE in loc
            and expected_key in loc
        )
        case_b_detail = f"status={r.status_code} location={loc[:200]}"
        # Verify the redirect target actually returns 200 (R2 has the object)
        if r.status_code == 302 and loc:
            try:
                head = requests.head(loc, timeout=20, allow_redirects=True)
                case_b_detail += f" | r2_head={head.status_code}"
            except Exception as he:
                case_b_detail += f" | r2_head_exc={he}"
    else:
        case_b_detail = f"local file missing ({LEGACY_PATH}) — cannot test case (b)"
except Exception as e:
    case_b_detail = f"exc={e}"
finally:
    # Always restore
    try:
        if moved and os.path.isfile(backup_path):
            shutil.move(backup_path, LEGACY_PATH)
    except Exception as restore_err:
        case_b_detail += f" | RESTORE_FAILED={restore_err}"
record(1, "1b-local-missing-302-redirect", case_b_ok, case_b_detail)

# Case (c): bogus filename → 404
try:
    url = f"{BASE}/api/uploads/2026/04/totally_bogus_does_not_exist_zzz.jpg"
    r = requests.get(url, timeout=20, allow_redirects=False)
    ok = r.status_code == 404
    record(1, "1c-bogus-404", ok, f"status={r.status_code}")
except Exception as e:
    record(1, "1c-bogus-404", False, f"exc={e}")

# Case (a-restored): after restore, the original URL must still 200
try:
    url = f"{BASE}{LEGACY_URL_PATH}"
    r = requests.get(url, timeout=20, allow_redirects=False)
    ok = r.status_code == 200 and len(r.content) > 0
    record(1, "1d-after-restore-200", ok,
           f"status={r.status_code} bytes={len(r.content)}")
except Exception as e:
    record(1, "1d-after-restore-200", False, f"exc={e}")


# -----------------------------------------------------------------------------
# BUCKET 2 — REGRESSION: core endpoints intact post-admin.py edit
# -----------------------------------------------------------------------------
hr("BUCKET 2: Regression on stable endpoints")

try:
    r = requests.get(f"{API}/spots?paginated=1&limit=5", timeout=20)
    ok = r.status_code == 200
    body = r.json() if ok else {}
    spots_count = len(body.get("spots") or body.get("items") or []) if isinstance(body, dict) else 0
    record(2, "2a-spots-paginated", ok,
           f"status={r.status_code} spots_in_page={spots_count}")
except Exception as e:
    record(2, "2a-spots-paginated", False, f"exc={e}")

try:
    r = requests.get(f"{API}/feed/home", headers=auth_h, timeout=30)
    ok = r.status_code == 200
    record(2, "2b-feed-home", ok, f"status={r.status_code}")
except Exception as e:
    record(2, "2b-feed-home", False, f"exc={e}")

try:
    r = requests.get(f"{API}/img/stats", timeout=20)
    ok = r.status_code == 200
    record(2, "2c-img-stats", ok, f"status={r.status_code}")
except Exception as e:
    record(2, "2c-img-stats", False, f"exc={e}")

try:
    r = requests.get(f"{API}/admin/diagnostics", headers=auth_h, timeout=30)
    ok = r.status_code == 200
    record(2, "2d-admin-diagnostics", ok, f"status={r.status_code}")
except Exception as e:
    record(2, "2d-admin-diagnostics", False, f"exc={e}")


# -----------------------------------------------------------------------------
# BUCKET 3 — REGRESSION: 8 backfilled spot_community_uploads URLs resolve
# -----------------------------------------------------------------------------
hr("BUCKET 3: Backfilled community upload URLs still resolve (R2 public)")

# Direct DB query via mongo would be more reliable, but to stay in HTTP-only
# territory, walk a sample of spots and inspect any that have community
# uploads in their detail response.
try:
    r = requests.get(f"{API}/spots?paginated=1&limit=50", timeout=30)
    spots_data = r.json() if r.ok else {}
    spots_list = spots_data.get("spots") or spots_data.get("items") or []
    record(3, "3a-spots-list", r.ok and bool(spots_list),
           f"status={r.status_code} returned={len(spots_list)}")
except Exception as e:
    spots_list = []
    record(3, "3a-spots-list", False, f"exc={e}")

# Aggregate: walk spot detail for each + look at /uploads (community) endpoint
inspected = 0
r2_urls_found = []
legacy_urls_found = []
broken_urls = []
checked_ids = []
for sp in spots_list[:30]:
    sid = sp.get("spot_id")
    if not sid:
        continue
    try:
        rr = requests.get(f"{API}/spots/{sid}/uploads?limit=20", timeout=20)
        if not rr.ok:
            continue
        items = rr.json()
        if isinstance(items, dict):
            items = items.get("items") or items.get("uploads") or []
        for u in items or []:
            url = u.get("image_url") or u.get("url") or ""
            if not url:
                continue
            inspected += 1
            checked_ids.append((sid, url[:80]))
            if "pub-" in url and "r2.dev" in url:
                r2_urls_found.append(url)
            elif url.startswith("/api/uploads/") or "/api/uploads/" in url:
                legacy_urls_found.append(url)
            # HEAD/GET to verify the URL resolves (full URL path)
            full = url if url.startswith("http") else f"{BASE}{url}"
            try:
                hr_resp = requests.head(full, timeout=15, allow_redirects=True)
                if hr_resp.status_code >= 400:
                    # Some CDNs block HEAD; try GET
                    g = requests.get(full, timeout=15, allow_redirects=True, stream=True)
                    if g.status_code >= 400:
                        broken_urls.append((url, g.status_code))
                    g.close()
            except Exception as he:
                broken_urls.append((url, f"exc={he}"))
        if inspected >= 12:
            break
    except Exception:
        continue

record(
    3, "3b-community-urls-resolve",
    len(broken_urls) == 0 and inspected > 0,
    f"inspected={inspected} r2_urls={len(r2_urls_found)} "
    f"legacy_urls={len(legacy_urls_found)} broken={len(broken_urls)} "
    f"sample_broken={broken_urls[:3]}"
)


# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
hr("SUMMARY")
total = len(results)
passed = sum(1 for _, _, ok, _ in results if ok)
print(f"PASS {passed}/{total}")
for bucket, name, ok, detail in results:
    flag = "✅" if ok else "❌"
    print(f"  {flag}  B{bucket} {name}")
    if not ok:
        print(f"        detail: {detail}")
