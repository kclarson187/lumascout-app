"""
v2.0.25 CDN Cache-Control workaround backend hardening tests for /api/img
Tests the image proxy at localhost:8001/api/img per review request.
"""
import asyncio
import concurrent.futures
import re
import sys
from pathlib import Path

import requests

BASE = "http://localhost:8001/api"
CACHE_ROOT = Path("/app/backend/cache/img")

PEXELS_URL = "https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg"
PEXELS_URL_2 = "https://images.pexels.com/photos/624015/pexels-photo-624015.jpeg"
UNSPLASH_URL = "https://images.unsplash.com/photo-1506905925346-21bda4d32df4"

results = []  # (name, pass/fail, details)


def record(name: str, passed: bool, details: str = ""):
    results.append((name, passed, details))
    tag = "PASS" if passed else "FAIL"
    print(f"[{tag}] {name}  {details}")


def get_img(params=None, headers=None, allow_redirects=True):
    return requests.get(f"{BASE}/img", params=params, headers=headers, timeout=30, allow_redirects=allow_redirects)


# -----------------------------------------------------------------------------
# TEST 1 — Basic 200 response + header bundle validation
# -----------------------------------------------------------------------------
def test_1_basic_200():
    params = {"u": PEXELS_URL, "w": 280, "q": 70}
    r = get_img(params=params)
    details = []
    ok = True

    if r.status_code != 200:
        ok = False
        details.append(f"status={r.status_code}")

    ct = r.headers.get("Content-Type", "")
    if "image/jpeg" not in ct:
        ok = False
        details.append(f"ct={ct}")

    expected = {
        "Cache-Control": "public, max-age=604800, immutable",
        "CDN-Cache-Control": "public, max-age=604800, immutable",
        "Surrogate-Control": "max-age=604800",
        "X-Content-Cache-Control": "public, max-age=604800, immutable",
        "Vary": "Accept",
    }
    for k, v in expected.items():
        got = r.headers.get(k)
        if got != v:
            ok = False
            details.append(f"{k}={got!r} (want {v!r})")

    etag = r.headers.get("ETag", "")
    if not etag.startswith('"img-'):
        ok = False
        details.append(f"ETag bad prefix: {etag!r}")
    # "img-" + 16 hex + end quote, total chars inside quotes must be 20
    # review says: "is 22 chars total inside quotes" — ambiguous.
    # Structure: prefix '"img-' (5) + 16 hex + '"' (1) => etag len 22 incl quotes
    # Inside quotes: "img-" (4) + 16 hex = 20 chars
    # Total etag length 22 characters (incl both quotes).
    if len(etag) != 22:
        ok = False
        details.append(f"ETag len={len(etag)} want 22: {etag!r}")

    m = re.match(r'^"img-([0-9a-f]{16})"$', etag)
    if not m:
        ok = False
        details.append(f"ETag not format img-<16hex>: {etag!r}")

    xic = r.headers.get("X-Img-Cache", "")
    if xic not in ("hit", "miss"):
        ok = False
        details.append(f"X-Img-Cache={xic!r}")

    # On cache hit, must include valid RFC1123 Last-Modified
    if xic == "hit":
        lm = r.headers.get("Last-Modified")
        if not lm or "GMT" not in lm:
            ok = False
            details.append(f"Last-Modified bad: {lm!r}")

    record("1. Basic 200 + headers", ok, "; ".join(details) if details else f"etag={r.headers.get('ETag')} xic={xic}")
    return r.headers.get("ETag"), xic


# -----------------------------------------------------------------------------
# TEST 2 — ETag stability across multiple requests
# -----------------------------------------------------------------------------
def test_2_etag_stability():
    params = {"u": PEXELS_URL, "w": 280, "q": 70}
    r1 = get_img(params=params)
    r2 = get_img(params=params)
    r3 = get_img(params=params)
    e1 = r1.headers.get("ETag")
    e2 = r2.headers.get("ETag")
    e3 = r3.headers.get("ETag")
    ok = (e1 == e2 == e3 and e1 is not None)
    record("2. ETag stability", ok, f"{e1} == {e2} == {e3}")


# -----------------------------------------------------------------------------
# TEST 3 — ETag varies by params
# -----------------------------------------------------------------------------
def test_3_etag_varies():
    r_w280 = get_img({"u": PEXELS_URL, "w": 280, "q": 70})
    r_w560 = get_img({"u": PEXELS_URL, "w": 560, "q": 70})
    r_q70 = get_img({"u": PEXELS_URL, "w": 280, "q": 70})
    r_q50 = get_img({"u": PEXELS_URL, "w": 280, "q": 50})
    r_u1 = get_img({"u": PEXELS_URL, "w": 280, "q": 70})
    r_u2 = get_img({"u": PEXELS_URL_2, "w": 280, "q": 70})

    e_w280 = r_w280.headers.get("ETag")
    e_w560 = r_w560.headers.get("ETag")
    e_q70 = r_q70.headers.get("ETag")
    e_q50 = r_q50.headers.get("ETag")
    e_u1 = r_u1.headers.get("ETag")
    e_u2 = r_u2.headers.get("ETag")

    parts = []
    ok = True
    if e_w280 == e_w560:
        ok = False
        parts.append("w280==w560!")
    if e_q70 == e_q50:
        ok = False
        parts.append("q70==q50!")
    if e_u1 == e_u2:
        ok = False
        parts.append("u1==u2!")
    record(
        "3. ETag varies by w/q/u",
        ok,
        f"w: {e_w280}!={e_w560}, q: {e_q70}!={e_q50}, u: {e_u1}!={e_u2}  {parts}",
    )


# -----------------------------------------------------------------------------
# TEST 4 — Conditional GET If-None-Match -> 304
# -----------------------------------------------------------------------------
def test_4_conditional_304():
    r1 = get_img({"u": PEXELS_URL, "w": 280, "q": 70})
    etag = r1.headers.get("ETag")
    r2 = get_img({"u": PEXELS_URL, "w": 280, "q": 70}, headers={"If-None-Match": etag})

    details = []
    ok = True
    if r2.status_code != 304:
        ok = False
        details.append(f"status={r2.status_code}")

    # Body should be empty
    body_len = len(r2.content or b"")
    if body_len != 0:
        ok = False
        details.append(f"body_len={body_len}")

    # Full header bundle
    required = {
        "Cache-Control": "public, max-age=604800, immutable",
        "CDN-Cache-Control": "public, max-age=604800, immutable",
        "Surrogate-Control": "max-age=604800",
        "X-Content-Cache-Control": "public, max-age=604800, immutable",
        "Vary": "Accept",
        "ETag": etag,
    }
    for k, v in required.items():
        if r2.headers.get(k) != v:
            ok = False
            details.append(f"{k}={r2.headers.get(k)!r} want {v!r}")

    xic = r2.headers.get("X-Img-Cache")
    if xic != "revalidated":
        ok = False
        details.append(f"X-Img-Cache={xic!r}")

    record("4. Conditional GET → 304", ok, "; ".join(details) if details else f"etag={etag}")


# -----------------------------------------------------------------------------
# TEST 5 — Mismatched If-None-Match still returns 200 with full image
# -----------------------------------------------------------------------------
def test_5_mismatched_inm():
    r = get_img(
        {"u": PEXELS_URL, "w": 280, "q": 70},
        headers={"If-None-Match": '"img-deadbeefdeadbeef"'},
    )
    details = []
    ok = True
    if r.status_code != 200:
        ok = False
        details.append(f"status={r.status_code}")
    if "image/jpeg" not in r.headers.get("Content-Type", ""):
        ok = False
        details.append(f"ct={r.headers.get('Content-Type')}")
    body_len = len(r.content or b"")
    if body_len < 100:
        ok = False
        details.append(f"body too small ({body_len})")
    record("5. Mismatched If-None-Match → 200", ok, "; ".join(details) if details else f"body={body_len}B")


# -----------------------------------------------------------------------------
# TEST 6 — Multiple ETags in If-None-Match (comma-separated)
# -----------------------------------------------------------------------------
def test_6_multi_etag_inm():
    r1 = get_img({"u": PEXELS_URL, "w": 280, "q": 70})
    real = r1.headers.get("ETag")
    header_val = f'"img-xxxxxxxxxxxxxxxx", {real}'
    r = get_img({"u": PEXELS_URL, "w": 280, "q": 70}, headers={"If-None-Match": header_val})

    details = []
    ok = r.status_code == 304
    if not ok:
        details.append(f"status={r.status_code}")
    xic = r.headers.get("X-Img-Cache")
    if xic != "revalidated":
        ok = False
        details.append(f"X-Img-Cache={xic!r}")
    record("6. Multi-ETag If-None-Match → 304", ok, "; ".join(details) if details else f"etag={real}")


# -----------------------------------------------------------------------------
# TEST 7 — Allowlist enforced
# -----------------------------------------------------------------------------
def test_7_allowlist():
    r = get_img({"u": "https://evil.com/pic.jpg", "w": 280})
    details = []
    ok = r.status_code == 400
    if not ok:
        details.append(f"status={r.status_code}")
    try:
        body = r.json()
        detail = body.get("detail", "")
        if detail != "host_not_allowed":
            ok = False
            details.append(f"detail={detail!r}")
    except Exception as e:
        ok = False
        details.append(f"json err {e}")
    record("7. Allowlist (evil.com → 400)", ok, "; ".join(details) if details else "host_not_allowed")


# -----------------------------------------------------------------------------
# TEST 8 — Parameter bounds
# -----------------------------------------------------------------------------
def test_8_bounds():
    cases = [
        ("w=10 (below MIN)", {"u": PEXELS_URL, "w": 10}),
        ("w=5000 (above MAX)", {"u": PEXELS_URL, "w": 5000}),
        ("q=5 (below MIN)", {"u": PEXELS_URL, "w": 280, "q": 5}),
        ("q=100 (above MAX)", {"u": PEXELS_URL, "w": 280, "q": 100}),
    ]
    ok_all = True
    details = []
    for label, params in cases:
        r = get_img(params=params)
        if r.status_code not in (400, 422):
            ok_all = False
            details.append(f"{label}: status={r.status_code}")
        else:
            details.append(f"{label}: {r.status_code}")
    record("8. Parameter bounds", ok_all, "; ".join(details))


# -----------------------------------------------------------------------------
# TEST 9 — /api/img/stats
# -----------------------------------------------------------------------------
def test_9_stats():
    r = requests.get(f"{BASE}/img/stats", timeout=15)
    details = []
    ok = r.status_code == 200
    if not ok:
        details.append(f"status={r.status_code}")
        record("9. /api/img/stats", ok, "; ".join(details))
        return
    body = r.json()
    for field in ("files", "bytes", "mb", "allowed_hosts", "ttl_days"):
        if field not in body:
            ok = False
            details.append(f"missing field {field}")
    record(
        "9. /api/img/stats",
        ok,
        "; ".join(details) if details else f"files={body.get('files')} mb={body.get('mb')} ttl={body.get('ttl_days')}d",
    )


# -----------------------------------------------------------------------------
# TEST 10 — Unsplash source works
# -----------------------------------------------------------------------------
def test_10_unsplash():
    r = get_img({"u": UNSPLASH_URL, "w": 280, "q": 70})
    details = []
    ok = r.status_code == 200
    if not ok:
        details.append(f"status={r.status_code}")
    if "image/jpeg" not in r.headers.get("Content-Type", ""):
        ok = False
        details.append(f"ct={r.headers.get('Content-Type')}")
    body_len = len(r.content or b"")
    if body_len < 100:
        ok = False
        details.append(f"body={body_len}")
    record("10. Unsplash source", ok, "; ".join(details) if details else f"body={body_len}B etag={r.headers.get('ETag')}")


# -----------------------------------------------------------------------------
# TEST 11 — Different w/q cache independently
# -----------------------------------------------------------------------------
def test_11_cache_independence():
    r1 = get_img({"u": PEXELS_URL, "w": 280, "q": 70})
    r2 = get_img({"u": PEXELS_URL, "w": 560, "q": 70})
    details = []
    ok = True
    if r1.status_code != 200 or r2.status_code != 200:
        ok = False
        details.append(f"statuses {r1.status_code}/{r2.status_code}")
    xic2 = r2.headers.get("X-Img-Cache")
    if xic2 == "revalidated":
        ok = False
        details.append(f"r2 xic={xic2} should not be revalidated")
    e1 = r1.headers.get("ETag")
    e2 = r2.headers.get("ETag")
    if e1 == e2:
        ok = False
        details.append(f"etags equal {e1} {e2}")
    record(
        "11. Different w/q cache independently",
        ok,
        "; ".join(details) if details else f"e1={e1} e2={e2} xic2={xic2}",
    )


# -----------------------------------------------------------------------------
# TEST 12 — Thundering-herd coalescing (10 concurrent on same key)
# -----------------------------------------------------------------------------
def test_12_coalescing():
    # Use a unique-but-allowlisted URL combo to force a fresh miss.
    # Use a Pexels URL we haven't used yet with unique w/q combo.
    unique_u = "https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg"
    width = 287  # unique
    qual = 63  # unique
    params = {"u": unique_u, "w": width, "q": qual}

    # Delete any existing cache file for this (u, w, q) to force a miss.
    import hashlib

    key = hashlib.sha256(f"{unique_u}|{width}|{qual}".encode()).hexdigest()
    cache_file = CACHE_ROOT / key[:2] / f"{key}.jpg"
    try:
        if cache_file.exists():
            cache_file.unlink()
    except Exception as e:
        print(f"  (warn: couldn't delete cache file: {e})")

    def fire():
        try:
            r = requests.get(f"{BASE}/img", params=params, timeout=30)
            return (r.status_code, len(r.content), r.headers.get("X-Img-Cache"), r.headers.get("ETag"))
        except Exception as e:
            return (0, 0, f"err:{e}", None)

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futs = [ex.submit(fire) for _ in range(10)]
        outs = [f.result() for f in concurrent.futures.as_completed(futs)]

    ok = all(o[0] == 200 for o in outs) and all(o[1] > 100 for o in outs)
    etag_set = {o[3] for o in outs}
    xic_counts = {}
    for o in outs:
        xic_counts[o[2]] = xic_counts.get(o[2], 0) + 1
    details = f"statuses={[o[0] for o in outs]} etags_unique={len(etag_set)} xic={xic_counts}"
    record("12. Thundering-herd coalescing", ok, details)


def main():
    tests = [
        test_1_basic_200,
        test_2_etag_stability,
        test_3_etag_varies,
        test_4_conditional_304,
        test_5_mismatched_inm,
        test_6_multi_etag_inm,
        test_7_allowlist,
        test_8_bounds,
        test_9_stats,
        test_10_unsplash,
        test_11_cache_independence,
        test_12_coalescing,
    ]
    for t in tests:
        try:
            t()
        except Exception as e:
            record(t.__name__, False, f"EXCEPTION: {e}")

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    passed = sum(1 for _, p, _ in results if p)
    failed = len(results) - passed
    print(f"PASSED: {passed}/{len(results)}")
    for name, p, d in results:
        tag = "PASS" if p else "FAIL"
        print(f"  [{tag}] {name}: {d}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
