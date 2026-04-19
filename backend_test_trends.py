#!/usr/bin/env python3
"""Live tests for GET /api/me/trends"""
import re
import sys
import requests

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
EMAIL = "sophie@photoscout.app"
PASSWORD = "demo123"

results = []

def record(name, passed, detail=""):
    results.append((name, passed, detail))
    marker = "PASS" if passed else "FAIL"
    print(f"[{marker}] {name} :: {detail}")

# 1) No-token check
try:
    r = requests.get(f"{BASE}/me/trends", timeout=20)
    record("trends_no_token_401_or_403", r.status_code in (401, 403),
           f"status={r.status_code} body={r.text[:200]}")
except Exception as e:
    record("trends_no_token_401_or_403", False, f"exception: {e}")

# 2) Login
token = None
try:
    r = requests.post(f"{BASE}/auth/login",
                      json={"email": EMAIL, "password": PASSWORD},
                      timeout=20)
    if r.status_code == 200:
        body = r.json()
        token = body.get("token") or body.get("access_token") or body.get("jwt")
        record("login_sophie", bool(token),
               f"status=200 keys={list(body.keys())} token_len={len(token) if token else 0}")
    else:
        record("login_sophie", False, f"status={r.status_code} body={r.text[:300]}")
except Exception as e:
    record("login_sophie", False, f"exception: {e}")

if not token:
    print("\nABORT: no token; cannot continue auth'd tests.")
    sys.exit(1)

H = {"Authorization": f"Bearer {token}"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# 3) days=7
try:
    r = requests.get(f"{BASE}/me/trends", params={"days": 7}, headers=H, timeout=20)
    if r.status_code != 200:
        record("trends_days_7_status", False, f"status={r.status_code} body={r.text[:300]}")
    else:
        body = r.json()
        series = body.get("series", [])
        totals = body.get("totals", {})
        ok_len = len(series) == 7
        record("trends_days_7_series_len_7", ok_len, f"len={len(series)}")

        all_buckets_ok = True
        per_bucket_errors = []
        for idx, b in enumerate(series):
            d = b.get("date")
            label = b.get("label")
            sp = b.get("spots")
            sv = b.get("saves")
            if not (isinstance(d, str) and DATE_RE.match(d)):
                all_buckets_ok = False; per_bucket_errors.append(f"[{idx}] bad date={d!r}")
            if not (isinstance(label, str) and 0 < len(label) <= 8):
                all_buckets_ok = False; per_bucket_errors.append(f"[{idx}] bad label={label!r}")
            if not isinstance(sp, int) or isinstance(sp, bool):
                all_buckets_ok = False; per_bucket_errors.append(f"[{idx}] spots not int: {sp!r}")
            if not isinstance(sv, int) or isinstance(sv, bool):
                all_buckets_ok = False; per_bucket_errors.append(f"[{idx}] saves not int: {sv!r}")
        record("trends_days_7_bucket_shape", all_buckets_ok,
               "ok" if all_buckets_ok else "; ".join(per_bucket_errors[:5]))

        sum_spots = sum(b.get("spots", 0) for b in series)
        sum_saves = sum(b.get("saves", 0) for b in series)
        ts = totals.get("spots")
        tsv = totals.get("saves")
        record("trends_days_7_totals_spots_match", ts == sum_spots,
               f"totals.spots={ts} sum={sum_spots}")
        record("trends_days_7_totals_saves_match", tsv == sum_saves,
               f"totals.saves={tsv} sum={sum_saves}")

        # show a sample for clarity
        print(f"   sample series[0]={series[0] if series else None}")
        print(f"   totals={totals}")
except Exception as e:
    record("trends_days_7", False, f"exception: {e}")

# 4) days=0 → clamp to 1
try:
    r = requests.get(f"{BASE}/me/trends", params={"days": 0}, headers=H, timeout=20)
    if r.status_code != 200:
        record("trends_days_0_status", False, f"status={r.status_code} body={r.text[:300]}")
    else:
        body = r.json()
        series = body.get("series", [])
        record("trends_days_0_clamps_to_1", len(series) == 1, f"len={len(series)}")
except Exception as e:
    record("trends_days_0", False, f"exception: {e}")

# 5) days=100 → clamp to 30
try:
    r = requests.get(f"{BASE}/me/trends", params={"days": 100}, headers=H, timeout=20)
    if r.status_code != 200:
        record("trends_days_100_status", False, f"status={r.status_code} body={r.text[:300]}")
    else:
        body = r.json()
        series = body.get("series", [])
        record("trends_days_100_clamps_to_30", len(series) == 30, f"len={len(series)}")
except Exception as e:
    record("trends_days_100", False, f"exception: {e}")

# Summary
total = len(results)
passed = sum(1 for _, p, _ in results if p)
print(f"\n=== SUMMARY: {passed}/{total} passed ===")
for name, p, detail in results:
    print(f"  {'PASS' if p else 'FAIL'} {name}")
sys.exit(0 if passed == total else 1)
