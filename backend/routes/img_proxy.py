"""
Image Resize Proxy — v2.0.24 (2026-05-02)
══════════════════════════════════════════

Why this exists
───────────────
LumaScout v2.0.22 shipped a FlowOriginLedger signal of ~379 MB downloaded
over cellular in a single session — for a photography-discovery app whose
thumbnails are 140×140 px. Target: <15 MB / 2-min exploration session.

The offenders:
  • Pexels / Unsplash URLs hit with `?w=1200&q=85` — full-desktop
    resolution served into 140×140 slots
  • `/api/uploads/*` raw (typically 3–8 MB iPhone originals) served
    for every preview card, every map tap, every list item

What this does
──────────────
  GET /api/img?u=<source>&w=<width>&q=<quality>

Resolves `source` (allowlisted host), resizes to `w` px wide while
preserving aspect ratio via PIL.Image.thumbnail, re-encodes as
progressive JPEG at quality `q`, and returns bytes directly to the
client with a 7-day `Cache-Control: public, max-age=604800, immutable`
header so the HTTP layer (iOS URLCache / Android OkHttp / CDN) keeps
hot cache for us.

Cache strategy
──────────────
Key = sha256(`source|w|q`). Stored at
    /app/backend/cache/img/<first-2-hex>/<full-hex>.jpg
with a 7-day file-mtime TTL. On hit we stream from disk (zero CPU).
On miss we fetch → resize → write → respond.

Cache key correctness:
  • Pexels / Unsplash URLs are immutable CDN (key on URL is fine).
  • `/api/uploads/<uuid>.jpg` are UUID-filename immutable writes
    (we NEVER overwrite uploads — we only create new UUIDs). So the
    URL itself IS the version key. No stale-thumbnail-after-edit
    concern. Confirmed in upload-image.ts + backend uploads.py.

HEIC handling
─────────────
pillow-heif is registered at import time so iPhone-originated HEIC
uploads decode cleanly through PIL.Image.open().

Security
────────
Strict allowlist of host patterns. No arbitrary URLs. This endpoint
CANNOT be used as an open proxy / SSRF vector.
"""
from __future__ import annotations

import asyncio
import email.utils
import hashlib
import io
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import aiofiles
import aiohttp
from fastapi import APIRouter, Header, HTTPException, Query, Response
from PIL import Image

# Register HEIF opener once, globally.
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except Exception:
    pass

log = logging.getLogger("img_proxy")

router = APIRouter()

# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────
CACHE_ROOT = Path(__file__).resolve().parent.parent / "cache" / "img"
CACHE_ROOT.mkdir(parents=True, exist_ok=True)

# 7 days in seconds. After this, a cached file is considered stale and
# we refetch from the source. Pexels/Unsplash URLs are immutable so
# this is purely disk-hygiene — the refetch will produce identical bytes.
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60

# Hard limits on thumbnail size — prevents the endpoint being abused
# as a general-purpose image-hosting service. Covers our actual needs:
#   MAP_THUMB (140 × DPR 2x ≈ 280)
#   LIST_CARD (280 × DPR 2x = 560)
#   HERO     (~720 × DPR 2x up to 1440 for iPad)
MAX_WIDTH = 1600
MIN_WIDTH = 32
MIN_QUALITY = 20
MAX_QUALITY = 95
DEFAULT_QUALITY = 70

# Timeouts for the source fetch. We keep these short because the
# client is already waiting — if the origin is slow, we'd rather
# return quickly than hold the connection for 30s.
SOURCE_FETCH_TIMEOUT = aiohttp.ClientTimeout(total=8, connect=3)

# Upstream response size ceiling — we never process >30 MB origins.
# Real iPhone JPEGs top out around 12 MB; HEIC around 4 MB. 30 MB is
# a generous ceiling that stops pathological abuse.
MAX_SOURCE_BYTES = 30 * 1024 * 1024

# Strict allowlist. Patterns are matched against `urlparse(url).hostname`
# (case-insensitive, exact match or suffix match with dot boundary).
ALLOWED_HOSTS = {
    "images.pexels.com",
    "images.unsplash.com",
    # Our own uploads origin — same host as the preview backend.
    "photo-finder-60.preview.emergentagent.com",
    # Production web origin. EAS production iOS/Android builds may
    # cache or rewrite image URLs to this canonical host (the AASA /
    # Universal Links domain) — accept it so the proxy stays
    # symmetric between dev preview and production. Subdomains
    # (api.lumascout.app, cdn.lumascout.app, etc.) are matched via
    # the suffix rule in `_is_allowed_host`.
    "lumascout.app",
}

# If a source URL already has `?w=...&q=...` params of its own (like
# Pexels / Unsplash), we *overwrite* them with our requested w/q so
# the origin does as much downscaling as possible before we touch it.
# This is how we chain CDN resize + our resize: CDN gives us a 400-wide
# image, we thumbnail down to 280 from there, resulting in minimal
# compute on our side.
_QUERY_W_RE = re.compile(r"([?&])w=[^&]*", re.IGNORECASE)
_QUERY_Q_RE = re.compile(r"([?&])q=[^&]*", re.IGNORECASE)


def _is_allowed_host(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
        if not host:
            return False
        for allowed in ALLOWED_HOSTS:
            if host == allowed or host.endswith("." + allowed):
                return True
        return False
    except Exception:
        return False


def _rewrite_upstream_query(url: str, width: int, quality: int) -> str:
    """For Pexels/Unsplash, overwrite their `?w=` so the CDN pre-scales."""
    host = (urlparse(url).hostname or "").lower()
    if not (host.endswith("pexels.com") or host.endswith("unsplash.com")):
        return url
    # Replace or append w= and q=
    new_url = url
    if "?" not in new_url:
        # No existing query — append both
        return f"{new_url}?w={width}&q={quality}"
    # Replace w=
    if _QUERY_W_RE.search(new_url):
        new_url = _QUERY_W_RE.sub(rf"\1w={width}", new_url)
    else:
        new_url = f"{new_url}&w={width}"
    # Replace q=
    if _QUERY_Q_RE.search(new_url):
        new_url = _QUERY_Q_RE.sub(rf"\1q={quality}", new_url)
    else:
        new_url = f"{new_url}&q={quality}"
    return new_url


def _cache_path(url: str, w: int, q: int) -> Path:
    key = hashlib.sha256(f"{url}|{w}|{q}".encode("utf-8")).hexdigest()
    shard = key[:2]
    return CACHE_ROOT / shard / f"{key}.jpg"


async def _fetch_source(url: str) -> bytes:
    """Fetch source image bytes with strict size + timeout limits."""
    async with aiohttp.ClientSession(timeout=SOURCE_FETCH_TIMEOUT) as session:
        async with session.get(url) as r:
            if r.status != 200:
                raise HTTPException(status_code=502, detail=f"source_status_{r.status}")
            # Stream-read with cap
            buf = bytearray()
            async for chunk in r.content.iter_chunked(64 * 1024):
                buf.extend(chunk)
                if len(buf) > MAX_SOURCE_BYTES:
                    raise HTTPException(status_code=413, detail="source_too_large")
            return bytes(buf)


def _resize_to_jpeg(source_bytes: bytes, width: int, quality: int) -> bytes:
    """Decode source, thumbnail to target width (preserving AR), re-encode JPEG."""
    with Image.open(io.BytesIO(source_bytes)) as im:
        # Orient via EXIF — iPhone photos carry orientation metadata.
        try:
            from PIL import ImageOps
            im = ImageOps.exif_transpose(im)
        except Exception:
            pass
        # Convert to RGB (strip alpha) for progressive JPEG output.
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        # Only downscale — never upscale.
        if im.width > width:
            new_h = int(im.height * (width / im.width))
            im = im.resize((width, new_h), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        im.save(
            out,
            format="JPEG",
            quality=quality,
            optimize=True,
            progressive=True,
        )
        return out.getvalue()


async def _load_from_cache(path: Path) -> Optional[bytes]:
    try:
        if not path.exists():
            return None
        age = time.time() - path.stat().st_mtime
        if age > CACHE_TTL_SECONDS:
            return None  # stale
        async with aiofiles.open(path, "rb") as f:
            return await f.read()
    except Exception:
        return None


async def _save_to_cache(path: Path, data: bytes) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        async with aiofiles.open(tmp, "wb") as f:
            await f.write(data)
        tmp.replace(path)
    except Exception as e:
        log.warning("cache_write_failed path=%s err=%s", path, e)


# In-process lock map to prevent the "thundering herd" problem — if
# 50 clients request the same uncached URL+w+q at once, we do ONE
# fetch+resize and everyone else waits on the same future.
_inflight: dict[str, asyncio.Future] = {}
_inflight_lock = asyncio.Lock()


# ──────────────────────────────────────────────────────────────────────────
# Response header helpers — v2.0.25 CDN hardening
# ──────────────────────────────────────────────────────────────────────────
# WHY THIS SECTION EXISTS:
#
# v2.0.24 shipped with `Cache-Control: public, max-age=604800, immutable`
# which is a perfectly correct RFC7234 header. But during TestFlight
# validation we confirmed (via `curl -D` against the public host) that
# Cloudflare sits in front of the preview ingress and REWRITES our
# header to `no-store, no-cache, must-revalidate` at the edge — observable
# as `cf-cache-status: DYNAMIC` on every response. iOS URLCache / Android
# OkHttp honor `no-store` strictly, meaning a perfectly-implemented server
# cache was buying us zero client-side reuse.
#
# We attack this on three fronts:
#
#   1. `ETag` + `Last-Modified`  → allow conditional GETs (304 Not
#      Modified). Even when `Cache-Control: no-store` is in effect,
#      some intermediaries respect ETag-based conditional requests,
#      and if Cloudflare is ever reconfigured to let our headers
#      pass, the existing client cache will revalidate for free.
#
#   2. `CDN-Cache-Control` + `Surrogate-Control`  → Cloudflare's
#      published documentation says `Cache-Control` is regularly
#      rewritten by their edge, but `CDN-Cache-Control` is a
#      Cloudflare-specific header that takes precedence at the edge
#      and is NOT stripped. Setting both widens the chance that
#      *some* cache layer (theirs, ours, a future shared proxy)
#      honors the intent.
#
#   3. `X-Content-Cache-Control`  → purely informational mirror of
#      the intended policy, useful for on-device diagnostics so we
#      can detect header strip in logs.
#
# The *primary* fix is client-side: the RN app now renders these
# URLs via <CachedImage> (expo-image) which keeps its own disk
# cache keyed on URL, independent of HTTP cache headers. This block
# is belt-and-suspenders for the CDN / browser layer.

def _etag_for(url: str, w: int, q: int) -> str:
    """Strong ETag built from the cache key. Same bytes → same ETag."""
    h = hashlib.sha256(f"{url}|{w}|{q}".encode("utf-8")).hexdigest()[:16]
    return f'"img-{h}"'


def _http_date(ts: float) -> str:
    return email.utils.formatdate(timeval=ts, usegmt=True)


def _cache_headers(
    *,
    etag: str,
    last_modified_ts: Optional[float] = None,
    x_img_cache: str,
) -> dict[str, str]:
    """Build the full cache-header bundle for a 200 response."""
    h = {
        "Cache-Control": "public, max-age=604800, immutable",
        # Cloudflare-specific — survives Cache-Control rewrites at edge.
        "CDN-Cache-Control": "public, max-age=604800, immutable",
        # Reverse-proxy / Varnish dialect — same intent, different header.
        "Surrogate-Control": "max-age=604800",
        # Mirror for diagnostics — readable from the client to detect
        # the rewrite-at-edge case in device logs.
        "X-Content-Cache-Control": "public, max-age=604800, immutable",
        "ETag": etag,
        "Vary": "Accept",
        "X-Img-Cache": x_img_cache,
    }
    if last_modified_ts:
        h["Last-Modified"] = _http_date(last_modified_ts)
    return h


@router.get("/img")
async def img_proxy(
    u: str = Query(..., description="Source image URL (allowlisted hosts only)"),
    w: int = Query(280, ge=MIN_WIDTH, le=MAX_WIDTH, description="Target width in px"),
    q: int = Query(DEFAULT_QUALITY, ge=MIN_QUALITY, le=MAX_QUALITY, description="JPEG quality 20-95"),
    if_none_match: Optional[str] = Header(default=None, alias="If-None-Match"),
):
    """
    Resize an allowlisted source image to w px wide, quality q JPEG, with
    7-day immutable cache. Returns the JPEG bytes directly.

    Supports conditional GET: a request with `If-None-Match: <etag>`
    matching the current ETag returns `304 Not Modified` with empty body.
    """
    # 1. Allowlist check.
    if not _is_allowed_host(u):
        raise HTTPException(status_code=400, detail="host_not_allowed")

    # 2. Compute the deterministic ETag for this (u, w, q) — the cache key
    #    itself is the version identifier because all sources are immutable
    #    (CDN URLs for Pexels/Unsplash; UUID-filenames for uploads).
    etag = _etag_for(u, w, q)

    # 3. Conditional GET short-circuit — even if Cloudflare strips our
    #    Cache-Control header downstream, the client (or any upstream
    #    cache that stored a copy) can still revalidate for free.
    if if_none_match and etag in if_none_match:
        return Response(
            status_code=304,
            headers=_cache_headers(etag=etag, x_img_cache="revalidated"),
        )

    # 4. For Pexels / Unsplash, push our target w + q upstream so the
    #    CDN pre-scales before we even touch the bytes.
    effective_url = _rewrite_upstream_query(u, w, q)

    # 5. Disk cache lookup (keyed on the ORIGINAL user-requested url
    #    + w + q so our logic remains stable even if CDN semantics shift).
    cache_p = _cache_path(u, w, q)
    cached = await _load_from_cache(cache_p)
    if cached is not None:
        mtime = None
        try:
            mtime = cache_p.stat().st_mtime
        except OSError:
            pass
        return Response(
            content=cached,
            media_type="image/jpeg",
            headers=_cache_headers(
                etag=etag,
                last_modified_ts=mtime,
                x_img_cache="hit",
            ),
        )

    # 6. Coalesce concurrent misses for the same key.
    key = f"{u}|{w}|{q}"
    async with _inflight_lock:
        existing = _inflight.get(key)
        if existing is None:
            fut: asyncio.Future = asyncio.get_event_loop().create_future()
            _inflight[key] = fut
            owner = True
        else:
            fut = existing
            owner = False

    if not owner:
        try:
            data = await fut
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"coalesced_fetch_failed: {e}")
        return Response(
            content=data,
            media_type="image/jpeg",
            headers=_cache_headers(
                etag=etag,
                last_modified_ts=time.time(),
                x_img_cache="coalesced",
            ),
        )

    # 7. We own the miss — fetch + resize + cache.
    try:
        source_bytes = await _fetch_source(effective_url)
        # PIL work on thread pool to not block event loop.
        loop = asyncio.get_event_loop()
        resized = await loop.run_in_executor(None, _resize_to_jpeg, source_bytes, w, q)
        await _save_to_cache(cache_p, resized)
        fut.set_result(resized)
        mtime = None
        try:
            mtime = cache_p.stat().st_mtime
        except OSError:
            pass
        return Response(
            content=resized,
            media_type="image/jpeg",
            headers=_cache_headers(
                etag=etag,
                last_modified_ts=mtime,
                x_img_cache="miss",
            ),
        )
    except HTTPException as e:
        fut.set_exception(e)
        # Consume the future's exception so asyncio doesn't warn
        # "Future exception was never retrieved" when we own the miss
        # and no coalesced awaiter is present.
        try: fut.exception()
        except Exception: pass
        raise
    except Exception as e:
        log.exception("img_proxy_failed url=%s w=%s q=%s", u, w, q)
        fut.set_exception(e)
        try: fut.exception()
        except Exception: pass
        raise HTTPException(status_code=502, detail=f"img_proxy_failed: {e}")
    finally:
        async with _inflight_lock:
            _inflight.pop(key, None)


@router.get("/img/stats")
async def img_stats():
    """Lightweight diagnostic — # of cached files + total bytes."""
    total_files = 0
    total_bytes = 0
    if CACHE_ROOT.exists():
        for p in CACHE_ROOT.rglob("*.jpg"):
            try:
                total_files += 1
                total_bytes += p.stat().st_size
            except OSError:
                pass
    return {
        "cache_dir": str(CACHE_ROOT),
        "files": total_files,
        "bytes": total_bytes,
        "mb": round(total_bytes / 1024 / 1024, 2),
        "allowed_hosts": sorted(ALLOWED_HOSTS),
        "ttl_days": CACHE_TTL_SECONDS // 86400,
    }
