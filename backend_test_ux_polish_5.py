"""
UX Polish #5 — backend contract validation for the Saved-tab rich cards.

Read-only validation; no backend source modifications.
"""

import json
import os
import sys
from typing import Any, Dict, List

import requests

BASE_URL = os.environ.get(
    "BACKEND_URL",
    "https://photo-finder-60.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

SOPHIE_EMAIL = "sophie@photoscout.app"
SOPHIE_PASS = "demo123"


results: List[Dict[str, Any]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append({"name": name, "ok": ok, "detail": detail})
    tag = "PASS" if ok else "FAIL"
    print(f"[{tag}] {name}" + (f" — {detail}" if detail else ""))


def login(email: str, password: str) -> str:
    # Actual login endpoint is /api/auth/login (review spec said /api/login - noting in summary)
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"login {email} → {r.status_code}: {r.text}")
    token = r.json().get("token")
    assert token, "missing token"
    return token


def H(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


# ---------------- 1. login sophie ----------------
try:
    tok = login(SOPHIE_EMAIL, SOPHIE_PASS)
    record("1. POST /api/login as sophie → 200, token captured", True)
except Exception as e:
    record("1. POST /api/login as sophie → 200, token captured", False, str(e))
    print("FATAL: cannot continue without sophie's token")
    sys.exit(1)


# ---------------- 2. GET /api/me/collections schema ----------------
r = requests.get(f"{API}/me/collections", headers=H(tok), timeout=30)
if r.status_code != 200:
    record("2. GET /api/me/collections as sophie → 200", False, f"status={r.status_code} body={r.text[:400]}")
    collections: List[Dict[str, Any]] = []
else:
    try:
        collections = r.json()
    except Exception as e:
        record("2. GET /api/me/collections as sophie → 200", False, f"non-JSON body: {e}")
        collections = []
    if not isinstance(collections, list):
        record("2. GET /api/me/collections response is JSON array", False, f"type={type(collections).__name__}")
        collections = []
    else:
        record(
            f"2. GET /api/me/collections as sophie → 200 JSON array ({len(collections)} items)",
            True,
        )

REQUIRED_KEYS = [
    "collection_id",
    "name",
    "privacy_mode",
    "previews",
    "cover_image_url",
    "count",
    "cities",
    "last_updated",
]


def check_collection_shape(c: Dict[str, Any], idx: int) -> List[str]:
    errs: List[str] = []
    for k in REQUIRED_KEYS:
        if k not in c:
            errs.append(f"missing key '{k}'")

    # collection_id str, prefix col_
    cid = c.get("collection_id")
    if not isinstance(cid, str) or not cid.startswith("col_"):
        errs.append(f"collection_id invalid: {cid!r}")

    # name str
    if not isinstance(c.get("name"), str):
        errs.append(f"name not string: {type(c.get('name')).__name__}")

    # privacy_mode str
    if not isinstance(c.get("privacy_mode"), str):
        errs.append(f"privacy_mode not string: {type(c.get('privacy_mode')).__name__}")

    # previews array <=4 of url strings
    prev = c.get("previews")
    if not isinstance(prev, list):
        errs.append(f"previews not list: {type(prev).__name__}")
    else:
        if len(prev) > 4:
            errs.append(f"previews length {len(prev)} > 4")
        for i, p in enumerate(prev):
            if not isinstance(p, str) or not p:
                errs.append(f"previews[{i}] not non-empty string: {p!r}")

    # cover_image_url: string | null; if previews non-empty, must equal previews[0], else null
    cov = c.get("cover_image_url")
    if cov is not None and not isinstance(cov, str):
        errs.append(f"cover_image_url not str|null: {type(cov).__name__}")
    if isinstance(prev, list):
        if len(prev) > 0:
            if cov != prev[0]:
                errs.append(f"cover_image_url != previews[0] ({cov!r} vs {prev[0]!r})")
        else:
            if cov is not None:
                errs.append(f"cover_image_url must be null when previews empty, got {cov!r}")

    # count: int >= 0; must equal len(spot_ids) if present
    cnt = c.get("count")
    if isinstance(cnt, bool) or not isinstance(cnt, int):
        errs.append(f"count not int: {type(cnt).__name__}={cnt!r}")
    elif cnt < 0:
        errs.append(f"count < 0: {cnt}")
    sids = c.get("spot_ids")
    if isinstance(sids, list) and isinstance(cnt, int) and not isinstance(cnt, bool):
        if cnt != len(sids):
            errs.append(f"count {cnt} != len(spot_ids) {len(sids)}")

    # cities array <=3 non-empty strings
    cities = c.get("cities")
    if not isinstance(cities, list):
        errs.append(f"cities not list: {type(cities).__name__}")
    else:
        if len(cities) > 3:
            errs.append(f"cities length {len(cities)} > 3")
        for i, ct in enumerate(cities):
            if not isinstance(ct, str) or not ct.strip():
                errs.append(f"cities[{i}] not non-empty string: {ct!r}")

    # last_updated: str | null
    lu = c.get("last_updated")
    if lu is not None and not isinstance(lu, str):
        # datetime may be serialised — accept str representation; otherwise flag
        errs.append(f"last_updated not str|null: {type(lu).__name__}={lu!r}")

    return errs


all_shape_errs: List[str] = []
for i, c in enumerate(collections):
    if not isinstance(c, dict):
        all_shape_errs.append(f"item[{i}] not object: {type(c).__name__}")
        continue
    e = check_collection_shape(c, i)
    if e:
        all_shape_errs.append(f"item[{i}] (name={c.get('name')!r}, id={c.get('collection_id')!r}): " + "; ".join(e))

if collections:
    if all_shape_errs:
        record("2a. Every collection has required rich-card keys + correct types", False, " | ".join(all_shape_errs[:8]))
    else:
        record(f"2a. Every collection has required rich-card keys + correct types ({len(collections)} items)", True)
else:
    record("2a. Every collection has required rich-card keys + correct types", False, "no collections returned to validate")


# ---------------- 3. no-auth → 401 ----------------
r2 = requests.get(f"{API}/me/collections", timeout=30)
if r2.status_code == 401:
    record("3. No-auth GET /api/me/collections → 401", True)
else:
    record("3. No-auth GET /api/me/collections → 401", False, f"got status={r2.status_code} body={r2.text[:200]}")


# ---------------- 4. at least one rich collection ----------------
rich = [
    c for c in collections
    if isinstance(c, dict)
    and isinstance(c.get("count"), int) and not isinstance(c.get("count"), bool) and c["count"] > 0
    and c.get("cover_image_url") is not None
    and isinstance(c.get("cities"), list) and len(c["cities"]) >= 1
]

if rich:
    first = rich[0]
    record(
        "4. At least one collection has count>0, cover_image_url!=null, cities>=1",
        True,
        f"example: name={first.get('name')!r} count={first.get('count')} cities={first.get('cities')}",
    )
else:
    summary = [
        {
            "name": c.get("name"),
            "collection_id": c.get("collection_id"),
            "count": c.get("count"),
            "cover_image_url": c.get("cover_image_url"),
            "cities": c.get("cities"),
        }
        for c in collections if isinstance(c, dict)
    ]
    record(
        "4. At least one collection has count>0, cover_image_url!=null, cities>=1",
        False,
        "no matching collection. summary=" + json.dumps(summary, default=str)[:1500],
    )

# ---------------- 4b. supplementary: prove enrichment works with a spot ----------------
# Sophie's collections are all empty TEST_ artifacts from prior test runs. To validate the
# enrichment LOGIC (separate from data-state), add a spot to one of her existing collections
# and re-fetch. If this passes, endpoint logic is fine — it's just that seed/DB state has
# no populated collections for sophie.
try:
    my_spots = requests.get(f"{API}/me/spots", headers=H(tok), timeout=30).json()
    sample_spot = None
    if isinstance(my_spots, list):
        for s in my_spots:
            if s.get("images"):
                sample_spot = s
                break
        if not sample_spot:
            sample_spot = my_spots[0] if my_spots else None

    if collections and sample_spot and sample_spot.get("spot_id"):
        target = collections[0]
        cid = target.get("collection_id")
        sid = sample_spot["spot_id"]
        add = requests.post(
            f"{API}/collections/{cid}/spots",
            headers={**H(tok), "Content-Type": "application/json"},
            json={"spot_id": sid},
            timeout=30,
        )
        if add.status_code == 200:
            refreshed = requests.get(f"{API}/me/collections", headers=H(tok), timeout=30).json()
            match = next((c for c in refreshed if c.get("collection_id") == cid), None)
            op_added = add.json().get("op") == "added"
            if match and op_added and match.get("count", 0) > 0:
                # prove enrichment: count matches len(spot_ids); cover_image_url == previews[0] when previews non-empty
                ok_shape = (
                    isinstance(match.get("previews"), list)
                    and (
                        (len(match["previews"]) == 0 and match.get("cover_image_url") is None)
                        or (len(match["previews"]) > 0 and match.get("cover_image_url") == match["previews"][0])
                    )
                    and match.get("count") == len(match.get("spot_ids") or [])
                )
                record(
                    "4b. Supplementary: enrichment logic works when a collection has a spot",
                    ok_shape,
                    f"cid={cid} count={match.get('count')} previews_len={len(match.get('previews') or [])} "
                    f"cover_is_first_preview={match.get('cover_image_url') == (match.get('previews') or [None])[0]} "
                    f"cities={match.get('cities')}",
                )
            else:
                record(
                    "4b. Supplementary: enrichment logic works when a collection has a spot",
                    False,
                    f"add op={add.json().get('op')} count-after={match.get('count') if match else 'n/a'}",
                )
            # cleanup: remove the spot to restore state (toggle again)
            requests.post(
                f"{API}/collections/{cid}/spots",
                headers={**H(tok), "Content-Type": "application/json"},
                json={"spot_id": sid},
                timeout=30,
            )
        else:
            record("4b. Supplementary: enrichment logic works when a collection has a spot", False, f"add failed status={add.status_code} body={add.text[:200]}")
    else:
        record("4b. Supplementary: enrichment logic works when a collection has a spot", False, "could not obtain a spot to add")
except Exception as e:
    record("4b. Supplementary: enrichment logic works when a collection has a spot", False, f"exception: {e}")


# ---------------- 5. GET /api/feed/home sections ----------------
r5 = requests.get(f"{API}/feed/home", headers=H(tok), timeout=45)
if r5.status_code != 200:
    record("5. GET /api/feed/home as sophie → 200", False, f"status={r5.status_code} body={r5.text[:300]}")
else:
    try:
        feed = r5.json()
    except Exception as e:
        feed = {}
        record("5. GET /api/feed/home as sophie → 200 JSON", False, f"non-JSON: {e}")
    record("5. GET /api/feed/home as sophie → 200", True)

    required_sections = ["for_you", "trending", "nearby", "from_your_network"]
    missing = [s for s in required_sections if s not in feed]
    non_array = [s for s in required_sections if s in feed and not isinstance(feed[s], list)]

    if missing:
        record(
            "5a. feed/home contains sections for_you/trending/nearby/from_your_network as arrays",
            False,
            f"missing keys: {missing}. present keys: {list(feed.keys())}",
        )
    elif non_array:
        record(
            "5a. feed/home contains sections for_you/trending/nearby/from_your_network as arrays",
            False,
            f"non-array sections: {non_array}",
        )
    else:
        sizes = {s: len(feed[s]) for s in required_sections}
        record(
            "5a. feed/home contains sections for_you/trending/nearby/from_your_network as arrays",
            True,
            f"sizes={sizes}",
        )


# ---------------- 6. POST /api/billing/checkout ----------------
r6 = requests.post(
    f"{API}/billing/checkout",
    headers={**H(tok), "Content-Type": "application/json"},
    json={"plan": "pro", "interval": "monthly"},
    timeout=45,
)
if r6.status_code != 200:
    record("6. POST /api/billing/checkout {plan:pro, interval:monthly} → 200", False, f"status={r6.status_code} body={r6.text[:400]}")
else:
    try:
        cj = r6.json()
    except Exception as e:
        cj = {}
        record("6a. checkout response JSON", False, str(e))
    # accept 'checkout_url' per review OR 'url' per legacy impl; review explicitly asks for 'checkout_url'
    url = cj.get("checkout_url")
    if url and isinstance(url, str) and url.startswith("https://checkout.stripe.com/"):
        record(
            "6. POST /api/billing/checkout → 200, checkout_url starts with https://checkout.stripe.com/",
            True,
            f"url={url[:80]}...",
        )
    else:
        # also provide diagnostic: does 'url' exist?
        legacy_url = cj.get("url")
        detail = f"checkout_url={url!r}; response keys={list(cj.keys())}"
        if legacy_url and isinstance(legacy_url, str) and legacy_url.startswith("https://checkout.stripe.com/"):
            detail += f" — NOTE: 'url' key present & matches stripe prefix ({legacy_url[:80]}...); response uses 'url' not 'checkout_url' per review spec"
        record(
            "6. POST /api/billing/checkout → 200, response contains checkout_url starting https://checkout.stripe.com/",
            False,
            detail,
        )


# -------------- final summary --------------
print("\n=== SUMMARY ===")
passed = sum(1 for r in results if r["ok"])
failed = sum(1 for r in results if not r["ok"])
for r in results:
    tag = "PASS" if r["ok"] else "FAIL"
    print(f"  [{tag}] {r['name']}")
    if not r["ok"] and r["detail"]:
        print(f"         {r['detail'][:400]}")
print(f"\nTotal: {passed} passed / {failed} failed / {len(results)} total")

sys.exit(0 if failed == 0 else 1)
