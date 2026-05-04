"""
orphan_image_scan.py — read-only audit of spots whose referenced image
files no longer exist on the server (May 2026).

Runs against the production backend over HTTPS — it does NOT touch
Mongo directly, so it's safe to execute from anywhere and produces a
deterministic, byte-for-byte reproducible report.

Scope — for every spot in the production DB:
  • hero_cover_image_url
  • cover_image_url
  • thumb_url
  • admin_cover_override.image_url (if present)
  • every entry of spots.images[].image_url
  • every community upload referenced inside the spot doc

For each URL we HEAD via GET (HEAD often 405s against the backend's
/api/uploads route) and record the HTTP status.

Output:
  • A printed summary with totals + top-10 affected spots + top-5 URLs.
  • A JSON artifact at /app/backend/cache/orphan_report.json for
    programmatic follow-ups (the cleanup job can read this file).

NOTE: This script is intentionally standalone — it does not import
anything from `server` / `routes` because we want it to run without
spinning up FastAPI, and because importing those modules on a fresh
container triggers Stripe / Mapbox startup calls we don't need.
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

PROD_BASE = "https://photo-finder-60.emergent.host"
REPORT_PATH = Path("/app/backend/cache/orphan_report.json")
REQUEST_TIMEOUT = 10
MAX_WORKERS = 16

# Only schemes we care about auditing — skip data:/blob: inline content.
HTTP_SCHEMES = {"http", "https"}


def _iter_spot_urls(spot: Dict[str, Any]) -> Iterable[Tuple[str, str]]:
    """
    Yield (source_field, url) tuples for every image URL referenced by
    this spot doc. `source_field` is a human-readable path used in the
    report, not a database key.
    """
    # Direct top-level URL fields
    for k in ("hero_cover_image_url", "cover_image_url", "thumb_url", "image"):
        v = spot.get(k)
        if isinstance(v, str) and v:
            yield (k, v)

    # admin_cover_override is an object with its own image_url/url
    override = spot.get("admin_cover_override")
    if isinstance(override, dict):
        for k in ("image_url", "url"):
            v = override.get(k)
            if isinstance(v, str) and v:
                yield (f"admin_cover_override.{k}", v)

    # images[] — list of {image_url, ...}
    imgs = spot.get("images") or []
    if isinstance(imgs, list):
        for i, item in enumerate(imgs):
            if isinstance(item, str):
                yield (f"images[{i}]", item)
            elif isinstance(item, dict):
                v = item.get("image_url") or item.get("url")
                if isinstance(v, str) and v:
                    yield (f"images[{i}].image_url", v)

    # Some older rows nested community uploads on the spot itself; keep
    # the scanner generous.
    cu = spot.get("community_uploads") or []
    if isinstance(cu, list):
        for i, item in enumerate(cu):
            if isinstance(item, dict):
                v = item.get("image_url") or item.get("url")
                if isinstance(v, str) and v:
                    yield (f"community_uploads[{i}].image_url", v)


def _is_inline(url: str) -> bool:
    """data:/blob: inline payloads are never orphans."""
    lower = url[:8].lower()
    return lower.startswith("data:") or lower.startswith("blob:")


def _http_get_status(url: str) -> Tuple[int, Optional[str]]:
    """
    GET the URL, returning (status_code, reason). We use GET instead of
    HEAD because many origins return 405 for HEAD (the LumaScout
    /api/uploads static handler being one of them). We set a tiny
    Range header so we only pull the first 512 bytes — enough for the
    origin to confirm or deny the object without streaming megabytes.
    """
    try:
        req = urllib.request.Request(url, method="GET")
        req.add_header("Range", "bytes=0-511")
        req.add_header("User-Agent", "lumascout-orphan-scanner/1.0")
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            return (resp.status, "ok")
    except urllib.error.HTTPError as e:
        return (e.code, e.reason or "http_error")
    except urllib.error.URLError as e:
        return (-1, f"transport:{e.reason}")
    except Exception as e:
        return (-1, f"exception:{type(e).__name__}:{e!s}")


def _fetch_prod_spots() -> List[Dict[str, Any]]:
    """
    Pull every spot from the production `/api/spots?limit=<large>`
    endpoint. We paginate via `offset` in case the collection grows
    beyond a single page.
    """
    all_spots: List[Dict[str, Any]] = []
    offset = 0
    page_size = 500
    while True:
        url = f"{PROD_BASE}/api/spots?limit={page_size}&offset={offset}"
        try:
            req = urllib.request.Request(url)
            req.add_header("User-Agent", "lumascout-orphan-scanner/1.0")
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"[fatal] Failed to fetch /api/spots offset={offset}: {e!r}")
            break
        page = payload if isinstance(payload, list) else payload.get("items") or []
        if not page:
            break
        all_spots.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
        # Safety net
        if offset > 5000:
            break
    return all_spots


def _hydrate_spot_details(spot_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    `/api/spots?limit=…` returns the list view which trims large
    fields. To audit every image we need the full `/api/spots/{id}`
    response. We parallelize with a worker pool.
    """
    out: Dict[str, Dict[str, Any]] = {}

    def _one(sid: str) -> Tuple[str, Optional[Dict[str, Any]]]:
        try:
            req = urllib.request.Request(f"{PROD_BASE}/api/spots/{sid}")
            req.add_header("User-Agent", "lumascout-orphan-scanner/1.0")
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                return (sid, json.loads(resp.read().decode("utf-8")))
        except Exception:
            return (sid, None)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = [ex.submit(_one, sid) for sid in spot_ids]
        for fut in as_completed(futs):
            sid, doc = fut.result()
            if doc is not None:
                out[sid] = doc
    return out


def main() -> int:
    started_at = datetime.now(timezone.utc).isoformat()

    # 1. Pull list view.
    list_rows = _fetch_prod_spots()
    spot_ids = [s.get("spot_id") or s.get("id") for s in list_rows if s.get("spot_id") or s.get("id")]
    spot_ids = [sid for sid in spot_ids if sid]

    # 2. Hydrate full docs (list view omits images[]).
    full = _hydrate_spot_details(spot_ids)

    # 3. For each hydrated doc, collect every URL to check.
    checks: List[Tuple[str, str, str, str]] = []
    # shape: (spot_id, title, source_field, url)
    for sid in spot_ids:
        doc = full.get(sid) or {}
        title = doc.get("title") or "(no title)"
        for field, u in _iter_spot_urls(doc):
            if _is_inline(u):
                continue
            parsed = urllib.parse.urlparse(u)
            if parsed.scheme not in HTTP_SCHEMES:
                continue
            checks.append((sid, title, field, u))

    # 4. Uniquify URLs so duplicate references only hit the network once.
    url_to_check: Dict[str, Tuple[int, Optional[str]]] = {}
    unique_urls = list({c[3] for c in checks})

    def _run_check(u: str) -> Tuple[str, Tuple[int, Optional[str]]]:
        return (u, _http_get_status(u))

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = [ex.submit(_run_check, u) for u in unique_urls]
        for fut in as_completed(futs):
            u, res = fut.result()
            url_to_check[u] = res

    # 5. Tabulate.
    affected_spots: Dict[str, Dict[str, Any]] = {}
    total_missing = 0
    status_counter: Counter = Counter()
    failed_samples: List[Dict[str, Any]] = []

    for sid, title, field, u in checks:
        status, reason = url_to_check.get(u, (-1, "unchecked"))
        status_counter[status] += 1
        is_missing = status in (404, 410) or status == -1
        if is_missing:
            total_missing += 1
            if sid not in affected_spots:
                affected_spots[sid] = {
                    "spot_id": sid,
                    "title": title,
                    "missing_count": 0,
                    "fields": [],
                }
            affected_spots[sid]["missing_count"] += 1
            affected_spots[sid]["fields"].append({
                "field": field, "url": u, "status": status, "reason": reason,
            })
            if len(failed_samples) < 5:
                failed_samples.append({
                    "spot_id": sid, "title": title, "field": field,
                    "url": u, "status": status, "reason": reason,
                })

    # 6. Render summary.
    affected_list = sorted(
        affected_spots.values(),
        key=lambda x: (-x["missing_count"], x["title"] or ""),
    )
    report = {
        "generated_at": started_at,
        "prod_base": PROD_BASE,
        "totals": {
            "spots_scanned": len(spot_ids),
            "spots_hydrated": len(full),
            "url_references_checked": len(checks),
            "unique_urls_checked": len(unique_urls),
            "url_references_missing": total_missing,
            "spots_with_at_least_one_missing_image": len(affected_spots),
        },
        "status_histogram": dict(status_counter),
        "sample_failed_urls": failed_samples,
        "top_10_affected": affected_list[:10],
    }

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, default=str))

    # Terse human summary to stdout
    t = report["totals"]
    print("=" * 72)
    print(f"ORPHAN IMAGE REPORT — {PROD_BASE}")
    print("=" * 72)
    print(f"  Spots scanned (list view)     : {t['spots_scanned']}")
    print(f"  Spots hydrated (detail view)  : {t['spots_hydrated']}")
    print(f"  URL references checked        : {t['url_references_checked']}")
    print(f"  Unique URLs checked           : {t['unique_urls_checked']}")
    print(f"  URL references missing        : {t['url_references_missing']}")
    print(f"  Spots w/ ≥1 missing image     : {t['spots_with_at_least_one_missing_image']}")
    print()
    print("HTTP-status histogram")
    for code, count in sorted(status_counter.items(), key=lambda kv: -kv[1]):
        print(f"  {code!s:>5}  {count}")
    print()
    print("Top 10 affected spots (most missing first):")
    for s in affected_list[:10]:
        print(f"  {s['missing_count']:>3}  {s['spot_id']}  {s['title']}")
    print()
    print(f"Full JSON written to: {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
