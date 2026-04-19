"""
Backend tests for PhotoScout Creator Economy wiring.
Focus: /api/me/billing, /api/me/trends, regressions on dashboard/spots/packs.
"""
import os
import sys
import json
import re
from datetime import datetime
from pathlib import Path

import requests

# Resolve backend URL from frontend env
FRONT_ENV = Path("/app/frontend/.env")
BASE_URL = None
for line in FRONT_ENV.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().strip('"')
        break

assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not found"
API = BASE_URL.rstrip("/") + "/api"
print(f"Testing API at: {API}")

SOPHIE = {"email": "sophie@photoscout.app", "password": "demo123"}
ADMIN = {"email": "admin@photoscout.app", "password": "admin123"}

results = []  # (name, ok, detail)


def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} :: {detail}")
    results.append((name, ok, detail))


def login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


# -------- Login --------
try:
    sophie_token = login(SOPHIE)
    record("login sophie", True, "200 OK")
except Exception as e:
    record("login sophie", False, str(e))
    sys.exit(1)


# -------- /api/me/billing --------
# 1. Auth required
r = requests.get(f"{API}/me/billing", timeout=15)
record("billing requires auth (no header → 401/403)", r.status_code in (401, 403),
       f"status={r.status_code}, body={r.text[:200]}")

# 2. Authenticated call
r = requests.get(f"{API}/me/billing", headers=auth(sophie_token), timeout=15)
ok = r.status_code == 200
detail = ""
if ok:
    body = r.json()
    checks = []
    checks.append(("plan==free", body.get("plan") == "free"))
    checks.append(("plan_status==free", body.get("plan_status") == "free"))
    checks.append(("invoices==[]", body.get("invoices") == []))
    checks.append(("renews_at==null", body.get("renews_at") is None))
    checks.append(("payment_method==null", body.get("payment_method") is None))
    limits = body.get("limits", {})
    checks.append(("limits.saves==20", limits.get("saves") == 20))
    checks.append(("limits.private_spots==3", limits.get("private_spots") == 3))
    checks.append(("limits.collections==3", limits.get("collections") == 3))
    checks.append(("limits.advanced_filters==False", limits.get("advanced_filters") is False))
    checks.append(("limits.sell_packs==False", limits.get("sell_packs") is False))
    usage = body.get("usage", {})
    checks.append(("usage.saves int", isinstance(usage.get("saves"), int)))
    checks.append(("usage.private_spots int", isinstance(usage.get("private_spots"), int)))
    checks.append(("usage.collections int", isinstance(usage.get("collections"), int)))
    failed = [name for name, c in checks if not c]
    ok = len(failed) == 0
    detail = "all field checks ok" if ok else f"failed: {failed} | body={json.dumps(body)[:400]}"
else:
    detail = f"status={r.status_code} body={r.text[:300]}"
record("/api/me/billing (sophie)", ok, detail)


# -------- /api/me/trends --------
# 1. Auth required
r = requests.get(f"{API}/me/trends", timeout=15)
record("trends requires auth (no header → 401/403)", r.status_code in (401, 403),
       f"status={r.status_code}")

# 2. Default 7 days
r = requests.get(f"{API}/me/trends?days=7", headers=auth(sophie_token), timeout=15)
if r.status_code != 200:
    record("/api/me/trends?days=7", False, f"status={r.status_code} body={r.text[:500]}")
else:
    body = r.json()
    series = body.get("series", [])
    checks = []
    checks.append(("days==7", body.get("days") == 7))
    checks.append(("series length==7", len(series) == 7))
    bucket_ok = True
    for b in series:
        if not isinstance(b.get("spots"), int) or not isinstance(b.get("saves"), int):
            bucket_ok = False; break
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", b.get("date", "")):
            bucket_ok = False; break
        if not isinstance(b.get("label"), str) or not b.get("label"):
            bucket_ok = False; break
    checks.append(("each bucket has date/label/spots/saves", bucket_ok))
    totals = body.get("totals", {})
    checks.append(("totals.spots == sum(series.spots)", totals.get("spots") == sum(b["spots"] for b in series)))
    checks.append(("totals.saves == sum(series.saves)", totals.get("saves") == sum(b["saves"] for b in series)))
    failed = [n for n, c in checks if not c]
    ok = len(failed) == 0
    detail = "shape ok" if ok else f"failed: {failed} | body={json.dumps(body)[:400]}"
    record("/api/me/trends?days=7", ok, detail)

# 3. Clamp days=0 -> >=1 bucket
r = requests.get(f"{API}/me/trends?days=0", headers=auth(sophie_token), timeout=15)
if r.status_code != 200:
    record("trends days=0 clamps", False, f"status={r.status_code} body={r.text[:300]}")
else:
    body = r.json()
    ok = len(body.get("series", [])) >= 1
    record("trends days=0 clamps to >=1 bucket", ok, f"series_len={len(body.get('series', []))}")

# 4. Clamp days=100 -> 30 buckets
r = requests.get(f"{API}/me/trends?days=100", headers=auth(sophie_token), timeout=15)
if r.status_code != 200:
    record("trends days=100 clamps", False, f"status={r.status_code} body={r.text[:300]}")
else:
    body = r.json()
    ok = len(body.get("series", [])) == 30
    record("trends days=100 clamps to 30 buckets", ok, f"series_len={len(body.get('series', []))}")


# -------- Regression: /api/me/dashboard --------
r = requests.get(f"{API}/me/dashboard", headers=auth(sophie_token), timeout=15)
if r.status_code != 200:
    record("/api/me/dashboard", False, f"status={r.status_code} body={r.text[:300]}")
else:
    body = r.json()
    needed = ["total_spots", "public_spots", "private_spots", "saves_received", "reviews_received", "followers", "top_spots"]
    missing = [k for k in needed if k not in body]
    ok = len(missing) == 0 and isinstance(body.get("top_spots"), list)
    record("/api/me/dashboard", ok, "ok" if ok else f"missing={missing}")

# -------- Regression: /api/me/spots --------
r = requests.get(f"{API}/me/spots", headers=auth(sophie_token), timeout=15)
ok = r.status_code == 200 and isinstance(r.json(), list)
record("/api/me/spots (auth)", ok, f"status={r.status_code} type={type(r.json()).__name__ if r.ok else 'n/a'}")

# -------- Regression: /api/packs?published=true --------
r = requests.get(f"{API}/packs?published=true", timeout=15)
ok = r.status_code == 200 and isinstance(r.json(), list)
packs = r.json() if ok else []
record("/api/packs?published=true (public)", ok, f"status={r.status_code} count={len(packs)}")

# -------- Regression: /api/me/packs --------
r = requests.get(f"{API}/me/packs", headers=auth(sophie_token), timeout=15)
ok = r.status_code == 200 and isinstance(r.json(), list)
record("/api/me/packs (auth)", ok, f"status={r.status_code} count={len(r.json()) if r.ok else 'n/a'}")


# -------- Regression: /api/packs/{id}/purchase --------
target_pack_id = None
if packs:
    target_pack_id = packs[0]["pack_id"]
else:
    # Try elite user route — upgrade sophie temporarily, create a pack, purchase, downgrade
    # Use upgrade endpoint to set elite
    r = requests.post(f"{API}/me/upgrade", json={"plan": "elite"}, headers=auth(sophie_token), timeout=15)
    if r.status_code == 200:
        new_pack = {
            "name": "Hill Country Golden Hour Pack",
            "description": "Test pack",
            "cover_image_url": None,
            "price_cents": 999,
            "spot_ids": [],
            "published": True,
        }
        rc = requests.post(f"{API}/packs", json=new_pack, headers=auth(sophie_token), timeout=15)
        if rc.status_code == 200:
            target_pack_id = rc.json().get("pack_id")
        # downgrade back to free
        requests.post(f"{API}/me/upgrade", json={"plan": "free"}, headers=auth(sophie_token), timeout=15)

if target_pack_id:
    r = requests.post(f"{API}/packs/{target_pack_id}/purchase", headers=auth(sophie_token), timeout=15)
    if r.status_code == 200:
        b = r.json()
        ok = b.get("status") == "waitlist" and "message" in b
        record(f"/api/packs/{{id}}/purchase (waitlist)", ok, f"body={b}")
    else:
        record("/api/packs/{id}/purchase", False, f"status={r.status_code} body={r.text[:300]}")
else:
    record("/api/packs/{id}/purchase", False, "could not obtain a pack id to test")

# 404 handling
r = requests.post(f"{API}/packs/pack_doesnotexist/purchase", headers=auth(sophie_token), timeout=15)
record("/api/packs/{bogus}/purchase → 404", r.status_code == 404, f"status={r.status_code}")


# Summary
print("\n========= SUMMARY =========")
passed = sum(1 for _, ok, _ in results if ok)
failed = [(n, d) for n, ok, d in results if not ok]
print(f"Passed: {passed}/{len(results)}")
if failed:
    print("Failed:")
    for n, d in failed:
        print(f"  - {n}: {d}")
sys.exit(0 if not failed else 1)
