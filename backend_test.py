"""
PhotoScout Trust & Moderation backend tests.

Runs against the external preview URL. Validates:
  1) GET /api/spots/check-duplicates (positive, negative, route-precedence)
  2) POST /api/reports (valid, dedupe, bad reason, bad target_type)
  3) GET /api/reports/reasons (public)
  4) POST /api/reports rate limit 20/day
  5) public_spot_view freshness + freshness_label
  6) attach_owners on /api/spots and /api/feed/home
  7) Admin moderation regression (/admin/pending, /admin/reports, /admin/reports/{id}/resolve)
"""
import json
import sys
import time
import uuid
from typing import Any, Dict, List, Optional

import requests

BASE = "https://photo-finder-60.preview.emergentagent.com/api"

SOPHIE = {"email": "sophie@photoscout.app", "password": "demo123"}
ADMIN = {"email": "admin@photoscout.app", "password": "admin123"}

results: List[Dict[str, Any]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    tag = "PASS" if ok else "FAIL"
    print(f"[{tag}] {name}  {detail}")
    results.append({"name": name, "ok": ok, "detail": detail})


def login(creds: Dict[str, str]) -> Optional[str]:
    r = requests.post(f"{BASE}/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        print(f"login failed {creds['email']}: {r.status_code} {r.text}")
        return None
    return r.json()["token"]


def auth(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


# ---------------------------------------------------------------------------
# Bootstrap: login sophie + admin, grab a reference spot from the feed
# ---------------------------------------------------------------------------
print("\n=== Bootstrap ===")
sophie_tok = login(SOPHIE)
admin_tok = login(ADMIN)
if not sophie_tok or not admin_tok:
    print("Could not obtain required tokens.")
    sys.exit(1)
record("login/sophie", bool(sophie_tok))
record("login/admin", bool(admin_tok))

feed_r = requests.get(f"{BASE}/feed/home", headers=auth(sophie_tok), timeout=30)
if feed_r.status_code != 200:
    print("feed/home failed", feed_r.status_code, feed_r.text)
    sys.exit(1)
feed = feed_r.json()
# /api/feed/home returns sections as TOP-LEVEL keys (nearby/trending/recent/...),
# not wrapped inside a `sections` object. Handle both in case implementation changes.
sections = feed.get("sections") if isinstance(feed.get("sections"), dict) else feed
trending = sections.get("trending", []) or []
recent_section = sections.get("recent", []) or []
assert trending, "No trending spots in feed/home"
ref_spot = trending[0]
REF_LAT = ref_spot["latitude"]
REF_LNG = ref_spot["longitude"]
REF_TITLE = ref_spot.get("title", "")
REF_SPOT_ID = ref_spot["spot_id"]
print(f"Reference spot: {REF_SPOT_ID}  '{REF_TITLE}'  ({REF_LAT},{REF_LNG})")

# ---------------------------------------------------------------------------
# 1) GET /api/spots/check-duplicates
# ---------------------------------------------------------------------------
print("\n=== Task 1: /spots/check-duplicates ===")

# Positive
sim_title = (REF_TITLE[: max(4, len(REF_TITLE) // 2)] or "Spot") + " Overlook"
r = requests.get(
    f"{BASE}/spots/check-duplicates",
    params={"latitude": REF_LAT, "longitude": REF_LNG, "title": sim_title, "radius_m": 200},
    timeout=30,
)
ok = r.status_code == 200
detail = ""
if ok:
    body = r.json()
    count = body.get("count", 0)
    cands = body.get("candidates", [])
    if count < 1 or not cands:
        ok = False
        detail = f"count={count} candidates={len(cands)} — expected >=1"
    else:
        c0 = cands[0]
        d = c0.get("distance_m")
        sim = c0.get("title_similarity")
        if not isinstance(d, int):
            ok = False; detail = f"distance_m type={type(d).__name__} (expected int)"
        elif not isinstance(sim, (int, float)) or sim < 0 or sim > 1:
            ok = False; detail = f"title_similarity={sim} not in [0,1]"
        else:
            keys = [(c["distance_m"], -c["title_similarity"]) for c in cands]
            sorted_keys = sorted(keys)
            if keys != sorted_keys:
                ok = False; detail = f"ordering violated keys={keys}"
            else:
                detail = f"count={count}, top distance={d}m, sim={sim}"
else:
    detail = f"{r.status_code} {r.text[:200]}"
record("duplicates/positive", ok, detail)

# Negative — middle of nowhere
r = requests.get(
    f"{BASE}/spots/check-duplicates",
    params={"latitude": 89, "longitude": 170, "radius_m": 200},
    timeout=30,
)
ok = r.status_code == 200 and r.json().get("count", 1) == 0
record("duplicates/negative", ok, f"{r.status_code} count={r.json().get('count') if r.status_code == 200 else 'n/a'}")

# Route precedence — missing lat/lng must be 422 validation, NOT 404 spot-not-found
r = requests.get(f"{BASE}/spots/check-duplicates", timeout=30)
code = r.status_code
try:
    body = r.json()
except Exception:
    body = {}
is_validation = code == 422
is_spot_404 = code == 404 and ("spot not found" in str(body).lower())
ok = is_validation and not is_spot_404
record("duplicates/route_precedence", ok, f"status={code} body={str(body)[:160]}")

# ---------------------------------------------------------------------------
# 2) POST /api/reports
# ---------------------------------------------------------------------------
print("\n=== Task 2: POST /api/reports ===")

payload_valid = {
    "target_type": "spot",
    "target_id": REF_SPOT_ID,
    "reason": "spam",
    "details": "test automated trust-layer QA",
}
r = requests.post(f"{BASE}/reports", json=payload_valid, headers=auth(sophie_tok), timeout=30)
ok = r.status_code == 200
first_report_id = None
if ok:
    body = r.json()
    first_report_id = body.get("report_id")
    if not first_report_id or body.get("status") != "pending":
        ok = False
    record("reports/valid_submit", ok, f"report_id={first_report_id} status={body.get('status')}")
else:
    record("reports/valid_submit", False, f"{r.status_code} {r.text[:200]}")

# Dedupe
r2 = requests.post(f"{BASE}/reports", json=payload_valid, headers=auth(sophie_tok), timeout=30)
ok = r2.status_code == 200 and r2.json().get("report_id") == first_report_id
record(
    "reports/dedupe",
    ok,
    f"status={r2.status_code} same_id={r2.json().get('report_id') == first_report_id if r2.status_code==200 else 'n/a'}",
)

# Bad reason
bad_reason = {**payload_valid, "reason": "nonsense"}
r = requests.post(f"{BASE}/reports", json=bad_reason, headers=auth(sophie_tok), timeout=30)
ok = r.status_code == 400
detail = ""
if ok:
    msg = str(r.json().get("detail", "")).lower()
    expected_keys = ["not_a_location", "spam", "unsafe", "inappropriate", "wrong_info", "other"]
    missing = [k for k in expected_keys if k not in msg]
    if missing:
        ok = False
        detail = f"detail missing enum keys: {missing}"
    else:
        detail = "enum list present"
else:
    detail = f"{r.status_code} {r.text[:200]}"
record("reports/bad_reason", ok, detail)

# Bad target_type
bad_type = {**payload_valid, "target_type": "invoice", "reason": "spam"}
r = requests.post(f"{BASE}/reports", json=bad_type, headers=auth(sophie_tok), timeout=30)
ok = r.status_code == 400
record("reports/bad_target_type", ok, f"status={r.status_code} {r.text[:160]}")

# ---------------------------------------------------------------------------
# 3) GET /api/reports/reasons
# ---------------------------------------------------------------------------
print("\n=== Task 3: GET /api/reports/reasons ===")
r = requests.get(f"{BASE}/reports/reasons", timeout=30)
ok = r.status_code == 200
detail = ""
if ok:
    arr = r.json()
    keys_wanted = {"not_a_location", "unsafe", "inappropriate", "spam", "wrong_info", "other"}
    got_keys = {item.get("key") for item in arr}
    if got_keys != keys_wanted:
        ok = False
        detail = f"keys mismatch got={got_keys} want={keys_wanted}"
    else:
        empty = [item for item in arr if not item.get("label")]
        if empty:
            ok = False
            detail = f"empty labels: {empty}"
        else:
            detail = f"{len(arr)} reasons ok"
else:
    detail = f"{r.status_code} {r.text[:200]}"
record("reports/reasons", ok, detail)

# ---------------------------------------------------------------------------
# 5) Freshness
# ---------------------------------------------------------------------------
print("\n=== Task 5: freshness fields ===")
allowed = {"fresh", "recent", "stale", "unknown"}
bad = []
values = []
for s in trending[:20]:
    f = s.get("freshness")
    values.append(f)
    if f not in allowed:
        bad.append((s.get("spot_id"), f))
    if f != "unknown" and not s.get("freshness_label"):
        bad.append((s.get("spot_id"), f"missing freshness_label for {f}"))
ok = not bad
variety_note = ""
if ok:
    unique = set(values)
    if len(unique) <= 1:
        variety_note = f" (concern: only one freshness value across trending: {unique})"
record(
    "freshness/fields",
    ok,
    f"values={set(values)}{variety_note}" if ok else f"violations={bad[:5]}",
)

# ---------------------------------------------------------------------------
# 6) attach_owners
# ---------------------------------------------------------------------------
print("\n=== Task 6: attach_owners ===")
r = requests.get(f"{BASE}/spots", params={"limit": 5}, headers=auth(sophie_tok), timeout=30)
ok = r.status_code == 200
detail = ""
if ok:
    items = r.json()
    missing_owner = []
    has_verified = False
    for s in items:
        o = s.get("owner")
        if not o or not all(k in o for k in ("user_id", "name", "verification_status")):
            missing_owner.append(s.get("spot_id"))
            continue
        if o.get("verification_status") == "verified":
            has_verified = True
    if missing_owner:
        ok = False
        detail = f"items without owner: {missing_owner}"
    elif not has_verified:
        ok = False
        detail = f"no verified owner in {len(items)} items"
    else:
        detail = f"{len(items)} items, all have owner, at least one verified"
else:
    detail = f"{r.status_code} {r.text[:200]}"
record("attach_owners/spots", ok, detail)

missing = []
for section_name in ("trending", "recent"):
    section = sections.get(section_name, []) or []
    if not section:
        missing.append(f"{section_name}=empty")
        continue
    o = section[0].get("owner")
    if not o or not all(k in o for k in ("user_id", "name", "verification_status")):
        missing.append(f"{section_name}[0] owner={o}")
ok = not missing
record(
    "attach_owners/feed_home",
    ok,
    f"missing={missing}" if missing else "trending[0] + recent[0] have owner obj",
)

# ---------------------------------------------------------------------------
# 7) Admin regression
# ---------------------------------------------------------------------------
print("\n=== Task 7: admin moderation regression ===")
r = requests.get(f"{BASE}/admin/pending", headers=auth(admin_tok), timeout=30)
ok = r.status_code == 200 and isinstance(r.json(), list)
record("admin/pending", ok, f"{r.status_code} len={len(r.json()) if r.status_code==200 else 'n/a'}")

r = requests.get(f"{BASE}/admin/reports", headers=auth(admin_tok), timeout=30)
ok_base = r.status_code == 200 and isinstance(r.json(), list)
admin_reports = r.json() if ok_base else []
if ok_base and first_report_id:
    found = any(x.get("report_id") == first_report_id for x in admin_reports)
    if not found:
        record("admin/reports", False, f"first_report_id={first_report_id} not in {len(admin_reports)} reports")
    else:
        record("admin/reports", True, f"{len(admin_reports)} reports returned, contains {first_report_id}")
else:
    record("admin/reports", ok_base, f"status={r.status_code}")

resolve_id = first_report_id
if resolve_id:
    r = requests.post(
        f"{BASE}/admin/reports/{resolve_id}/resolve",
        json={"action": "dismiss"},
        headers=auth(admin_tok),
        timeout=30,
    )
    literal_ok = r.status_code == 200
    if literal_ok:
        record("admin/resolve[action=dismiss]", True, "literal 'dismiss' accepted (review_request value)")
    else:
        r2 = requests.post(
            f"{BASE}/admin/reports/{resolve_id}/resolve",
            json={"action": "dismissed"},
            headers=auth(admin_tok),
            timeout=30,
        )
        ok2 = r2.status_code == 200
        record(
            "admin/resolve[action=dismiss]",
            False,
            f"literal 'dismiss' => {r.status_code} {r.text[:160]}; fallback 'dismissed' => {r2.status_code}",
        )
        # Separate line so we can see the functional fallback works
        record(
            "admin/resolve[fallback=dismissed]",
            ok2,
            f"'dismissed' => {r2.status_code}",
        )
else:
    record("admin/resolve", False, "no report_id to resolve")

# ---------------------------------------------------------------------------
# 4) Rate-limit smoke (runs last because it burns sophie's daily quota)
# ---------------------------------------------------------------------------
print("\n=== Task 4: /reports rate-limit 20/day ===")
hit_429_at = None
retry_msg = None
last_status = None
for i in range(1, 26):
    body = {
        "target_type": "spot",
        "target_id": f"spot_ratelimit_{uuid.uuid4().hex[:10]}",
        "reason": "spam",
        "details": f"rate limit probe {i}",
    }
    rr = requests.post(f"{BASE}/reports", json=body, headers=auth(sophie_tok), timeout=30)
    last_status = rr.status_code
    if rr.status_code == 429:
        hit_429_at = i
        try:
            retry_msg = rr.json().get("detail")
        except Exception:
            retry_msg = rr.text[:200]
        break
    if rr.status_code != 200:
        print(f"  req {i}: unexpected status {rr.status_code} {rr.text[:120]}")

ok = hit_429_at is not None and hit_429_at <= 21
record(
    "reports/rate_limit_20_per_day",
    ok,
    f"429 at req #{hit_429_at} (limit 20); retry_msg={retry_msg!r}; last_status={last_status}",
)

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print("\n=== SUMMARY ===")
passed = sum(1 for r in results if r["ok"])
failed = [r for r in results if not r["ok"]]
print(f"{passed}/{len(results)} passed")
for r in failed:
    print(f"  FAIL: {r['name']}  {r['detail']}")

sys.exit(0 if not failed else 1)
