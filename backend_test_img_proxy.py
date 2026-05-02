"""
Backend tests for v2.0.24 image-resize proxy.

Targets the public-routed backend URL (EXPO_PUBLIC_BACKEND_URL) because the
review-request-supplied `localhost:8001` is only reachable from the backend
container; the ingress routes `/api/*` through the same public host that the
frontend uses, so tests run against that host for parity with real client
traffic.

Scope:
  1. GET /api/img happy paths (Pexels 280, Unsplash 560, user upload 280)
     including X-Img-Cache miss→hit transition and Cache-Control header.
  2. GET /api/img reject paths (bad host, missing u, w/q out of range).
  3. GET /api/img upstream-failure path (truncated Unsplash ID ⇒ 502).
  4. GET /api/img/stats schema.
  5. GET /api/spots/markers — every thumb_url rewritten to /api/img?u=…
"""
from __future__ import annotations

import os
import sys
import time
from urllib.parse import quote, urlparse, parse_qs

import requests

BACKEND_BASE = os.environ.get(
    "BACKEND_BASE_URL",
    "http://localhost:8001",
).rstrip("/")
API = f"{BACKEND_BASE}/api"

PEXELS_URL = "https://images.pexels.com/photos/1784580/pexels-photo-1784580.jpeg"
UNSPLASH_URL = "https://images.unsplash.com/photo-1506905925346-21bda4d32df4"
USER_UPLOAD_URL = (
    "https://photo-finder-60.preview.emergentagent.com"
    "/api/uploads/2026/05/0f8e967fbd6a4db29a42629d7299c215.jpg"
)
BAD_UNSPLASH_URL = "https://images.unsplash.com/photo-1600101720232-3b"

results: list[tuple[str, bool, str]] = []


def _record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    tag = "PASS" if ok else "FAIL"
    print(f"[{tag}] {name} :: {detail}")


def _req(path: str, params: dict | None = None, *, timeout: int = 20):
    url = f"{API}{path}"
    return requests.get(url, params=params, timeout=timeout)


def t_pexels_280_miss_then_hit():
    name = "GET /api/img Pexels w=280 q=70 → 200 + miss then hit"
    # Unique param to guarantee a fresh cache key.
    bust = f"&_t={int(time.time())}"
    src = PEXELS_URL + "?cb=" + str(int(time.time()))
    try:
        r1 = requests.get(
            f"{API}/img",
            params={"u": src, "w": 280, "q": 70},
            timeout=20,
        )
        ct = r1.headers.get("content-type", "")
        cache_hdr1 = r1.headers.get("X-Img-Cache")
        cc = r1.headers.get("Cache-Control", "")
        body_kb = len(r1.content) / 1024.0
        ok1 = (
            r1.status_code == 200
            and ct.startswith("image/jpeg")
            and cache_hdr1 == "miss"
            and cc == "public, max-age=604800, immutable"
            and 5 <= body_kb <= 30
        )
        detail1 = (
            f"status={r1.status_code} ct={ct} cache={cache_hdr1} "
            f"cc={cc!r} size_kb={body_kb:.1f}"
        )
        if not ok1:
            _record(name + " (first call)", False, detail1)
            return
        # Immediate second call should be a hit.
        r2 = requests.get(
            f"{API}/img",
            params={"u": src, "w": 280, "q": 70},
            timeout=20,
        )
        cache_hdr2 = r2.headers.get("X-Img-Cache")
        ok2 = r2.status_code == 200 and cache_hdr2 == "hit"
        detail = (
            f"first: {detail1} | "
            f"second: status={r2.status_code} cache={cache_hdr2}"
        )
        _record(name, ok1 and ok2, detail)
    except Exception as e:
        _record(name, False, f"exception={e}")


def t_unsplash_560():
    name = "GET /api/img Unsplash w=560 q=70 → 200 + body 10-60 KB"
    src = UNSPLASH_URL + "?cb=" + str(int(time.time()))
    try:
        r = requests.get(
            f"{API}/img",
            params={"u": src, "w": 560, "q": 70},
            timeout=20,
        )
        ct = r.headers.get("content-type", "")
        body_kb = len(r.content) / 1024.0
        cc = r.headers.get("Cache-Control", "")
        ok = (
            r.status_code == 200
            and ct.startswith("image/jpeg")
            and 10 <= body_kb <= 60
            and cc == "public, max-age=604800, immutable"
        )
        _record(
            name,
            ok,
            f"status={r.status_code} ct={ct} size_kb={body_kb:.1f} cc={cc!r}",
        )
    except Exception as e:
        _record(name, False, f"exception={e}")


def t_user_upload_280():
    name = "GET /api/img user-upload w=280 q=70 → 200 image/jpeg"
    try:
        r = requests.get(
            f"{API}/img",
            params={"u": USER_UPLOAD_URL, "w": 280, "q": 70},
            timeout=25,
        )
        ct = r.headers.get("content-type", "")
        cc = r.headers.get("Cache-Control", "")
        body_kb = len(r.content) / 1024.0
        ok = (
            r.status_code == 200
            and ct.startswith("image/jpeg")
            and cc == "public, max-age=604800, immutable"
            and body_kb > 0
        )
        _record(
            name,
            ok,
            f"status={r.status_code} ct={ct} size_kb={body_kb:.1f} cc={cc!r}",
        )
    except Exception as e:
        _record(name, False, f"exception={e}")


def t_reject_disallowed_host():
    name = "GET /api/img disallowed host → 400 host_not_allowed"
    try:
        r = requests.get(
            f"{API}/img",
            params={"u": "https://evil.example.com/x.jpg", "w": 280, "q": 70},
            timeout=10,
        )
        try:
            js = r.json()
        except Exception:
            js = {}
        ok = r.status_code == 400 and js.get("detail") == "host_not_allowed"
        _record(name, ok, f"status={r.status_code} body={js}")
    except Exception as e:
        _record(name, False, f"exception={e}")


def t_reject_missing_u():
    name = "GET /api/img missing u → 422"
    try:
        r = requests.get(f"{API}/img", params={"w": 280, "q": 70}, timeout=10)
        ok = r.status_code == 422
        _record(name, ok, f"status={r.status_code}")
    except Exception as e:
        _record(name, False, f"exception={e}")


def t_reject_w_out_of_range():
    name_low = "GET /api/img w=10 out-of-range → 422"
    name_high = "GET /api/img w=5000 out-of-range → 422"
    for w, nm in [(10, name_low), (5000, name_high)]:
        try:
            r = requests.get(
                f"{API}/img",
                params={"u": PEXELS_URL, "w": w, "q": 70},
                timeout=10,
            )
            ok = r.status_code == 422
            _record(nm, ok, f"status={r.status_code}")
        except Exception as e:
            _record(nm, False, f"exception={e}")


def t_reject_q_out_of_range():
    for q, nm in [
        (0, "GET /api/img q=0 out-of-range → 422"),
        (200, "GET /api/img q=200 out-of-range → 422"),
    ]:
        try:
            r = requests.get(
                f"{API}/img",
                params={"u": PEXELS_URL, "w": 280, "q": q},
                timeout=10,
            )
            ok = r.status_code == 422
            _record(nm, ok, f"status={r.status_code}")
        except Exception as e:
            _record(nm, False, f"exception={e}")


def t_upstream_failure():
    name = "GET /api/img bad Unsplash ID → 502 source_status_404"
    try:
        r = requests.get(
            f"{API}/img",
            params={"u": BAD_UNSPLASH_URL, "w": 280, "q": 70},
            timeout=20,
        )
        try:
            js = r.json()
        except Exception:
            js = {}
        detail = str(js.get("detail", ""))
        ok = r.status_code == 502 and detail.startswith("source_status_404")
        _record(name, ok, f"status={r.status_code} detail={detail!r}")
    except Exception as e:
        _record(name, False, f"exception={e}")


def t_stats():
    name = "GET /api/img/stats → 200 + correct schema"
    try:
        r = requests.get(f"{API}/img/stats", timeout=10)
        if r.status_code != 200:
            _record(name, False, f"status={r.status_code}")
            return
        js = r.json()
        required = {"cache_dir", "files", "bytes", "mb", "allowed_hosts", "ttl_days"}
        missing = required - set(js.keys())
        allowed = js.get("allowed_hosts", [])
        required_hosts = {
            "images.pexels.com",
            "images.unsplash.com",
            "photo-finder-60.preview.emergentagent.com",
        }
        host_missing = required_hosts - set(allowed or [])
        ok = (
            not missing
            and isinstance(js.get("files"), int)
            and isinstance(js.get("bytes"), int)
            and isinstance(js.get("mb"), (float, int))
            and isinstance(allowed, list)
            and not host_missing
            and js.get("ttl_days") == 7
        )
        _record(
            name,
            ok,
            f"keys_missing={missing} hosts_missing={host_missing} ttl_days={js.get('ttl_days')} sample={js}",
        )
    except Exception as e:
        _record(name, False, f"exception={e}")


def t_markers_thumb_rewrite():
    name = "GET /api/spots/markers → every non-null thumb_url starts with /api/img?u="
    try:
        r = requests.get(f"{API}/spots/markers", timeout=25)
        if r.status_code != 200:
            _record(name, False, f"status={r.status_code} body={r.text[:200]}")
            return
        js = r.json()
        items = js if isinstance(js, list) else js.get("items", [])
        total = 0
        with_thumb = 0
        bad: list[str] = []
        for it in items:
            total += 1
            t = (it or {}).get("thumb_url")
            if not t:
                continue
            with_thumb += 1
            if not str(t).startswith("/api/img?u="):
                bad.append(f"{(it or {}).get('spot_id')}: {str(t)[:120]}")
        ok = not bad and total > 0
        _record(
            name,
            ok,
            f"total={total} with_thumb={with_thumb} non_proxy_count={len(bad)} "
            f"sample_bad={bad[:3]}",
        )
    except Exception as e:
        _record(name, False, f"exception={e}")


def main():
    print(f"Target backend: {API}")
    t_pexels_280_miss_then_hit()
    t_unsplash_560()
    t_user_upload_280()
    t_reject_disallowed_host()
    t_reject_missing_u()
    t_reject_w_out_of_range()
    t_reject_q_out_of_range()
    t_upstream_failure()
    t_stats()
    t_markers_thumb_rewrite()
    print("\n===== SUMMARY =====")
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"{passed}/{total} passed")
    for n, ok, d in results:
        tag = "PASS" if ok else "FAIL"
        print(f"  [{tag}] {n}")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
