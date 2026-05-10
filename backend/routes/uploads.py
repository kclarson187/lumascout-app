"""
Image upload + static serving (Apr 2026).

Why this module exists
======================
The original MVP stored uploaded images as `data:image/...;base64,...`
strings directly inside MongoDB `spots.images[]` documents. That worked
for a handful of small photos, but with real cameras producing 3–6 MB
JPEGs the spot docs grew to tens of MB each. Consequences:

 • `GET /spots/{id}` payloads exceeded 16 MB — clients timed out
 • The cover-editor would load 20+ full-size base64 blobs at once and
   hang or crash the browser tab
 • MongoDB's 16 MB per-document cap was at risk
 • Every list response sent megabytes over the wire to show thumbnails

New flow
========
Client picks image → POST multipart to /api/uploads/image → Pillow
re-encodes + downscales to ≤2048px long edge (JPEG q=82, baseline)
→ saves to /app/backend/uploads/<YYYY/MM/uuid.jpg> → returns a short
public URL. The only data that ever hits Mongo is that URL string.

A one-time migration script (scripts/migrate_base64_images.py) sweeps
existing base64 blobs out of Mongo and into the same storage path so
the old spots also become fast and fixable in the cover editor.

Limits (enforced server-side, 402/413/415 responses when violated):
  • Max file size: 10 MB (configurable via MAX_UPLOAD_BYTES)
  • Long-edge cap:  2048 px (configurable via MAX_LONG_EDGE)
  • Allowed types:  image/jpeg, image/png, image/webp, image/heic,
                    image/heif
"""
from __future__ import annotations

import io
import os
import logging
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse, RedirectResponse
from PIL import Image, ImageOps

# CRITICAL (June 2025): register the HEIF/HEIC opener with Pillow at
# import time. Without this, Pillow's `Image.open()` cannot decode
# iPhone HEIC photos (the iOS default) and every iPhone upload fails
# with a generic 415. With pillow-heif registered, HEIC is treated
# transparently — the file decodes, we re-encode to JPEG, and the
# rest of the pipeline is identical to JPEG/PNG uploads.
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:
    # If pillow-heif fails to import (e.g. wrong arch in dev), HEIC
    # uploads will still fail explicitly via the `Image.open` path
    # below — at least the rest of the upload endpoint stays alive.
    pass

from server import get_current_user, check_rate_limit, db  # reuse existing hooks
from services import storage_r2  # R2 backend with local-disk fallback (May 2026)

# Structured upload logger — separate from the root logger so prod
# observability tooling can pin "uploads.image" to a specific
# dashboard / retention bucket.
_upload_log = logging.getLogger("lumascout.uploads")

# --- Configuration ------------------------------------------------------------

UPLOADS_ROOT = Path(os.environ.get("LUMASCOUT_UPLOADS_DIR") or "/app/backend/uploads")
UPLOADS_ROOT.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024        # 10 MB
MAX_LONG_EDGE = 2048                        # px
JPEG_QUALITY = 82

ALLOWED_MIME = {
    "image/jpeg", "image/jpg", "image/png",
    "image/webp", "image/heic", "image/heif",
}

router = APIRouter(prefix="/api", tags=["uploads"])


# --- Public upload endpoint ---------------------------------------------------

@router.post("/uploads/image")
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    spot_id: Optional[str] = None,  # May 2026 — organized R2 layout
    user: dict = Depends(get_current_user),
):
    """Accept a single image and return its hosted URL.

    The frontend sends a multipart/form-data payload with field name
    `file`. We re-encode via Pillow to strip EXIF, normalise
    orientation (common iOS rotation quirk), auto-downscale to keep
    Mongo / CDN / battery costs sane, and return a stable JSON shape:

        { "image_url": "<public-url>",
          "image_id": "img_<hex>",
          "storage": "r2" | "local",
          "storage_key": "<r2-key>" | null,
          "r2_key":      "<r2-key>" | null,   # alias for storage_key
          "width": 2048, "height": 1365,
          "bytes": 412031, "mime": "image/jpeg",
          "size_bytes": 412031, "content_type": "image/jpeg" }

    May 2026 — organized R2 layout:
      • When ?spot_id=<id> is passed AND R2 is configured, the object
        key is written under
            locations/{location_slug}_{spot_id}/gallery/{uuid}.jpg
        using `services.storage_r2.build_location_key_prefix`. If the
        spot is unknown / soft-deleted we fall back to the legacy
        date-partitioned prefix so the upload never fails just because
        of a stale spot_id.
      • When spot_id is absent (legacy callers, dev/Expo Go without a
        spot context, or the local-disk fallback path) we keep the
        original `uploads/YYYY/MM/uuid.jpg` layout untouched.
    """
    t0 = time.monotonic()
    user_id = user.get("user_id")
    fname = (file.filename or "")[:120]
    ct_in = (file.content_type or "").lower()
    _upload_log.info(
        "upload_image.start user_id=%s filename=%r content_type=%r",
        user_id, fname, ct_in,
    )

    check_rate_limit("image_upload", user_id)

    # Defensive MIME check — UploadFile.content_type is set from the client
    # header, but some devices send octet-stream. We also sniff the bytes
    # with Pillow below, so this is just a fast-fail.
    if ct_in and ct_in not in ALLOWED_MIME:
        _upload_log.warning(
            "upload_image.reject_mime user_id=%s filename=%r content_type=%r",
            user_id, fname, ct_in,
        )
        raise HTTPException(
            status_code=415,
            detail=(
                f"This image format ({ct_in}) is not supported. "
                "Please choose a JPEG, PNG, WEBP, or HEIC photo."
            ),
        )

    blob = await file.read()
    size_in = len(blob)
    if not blob:
        _upload_log.warning("upload_image.empty user_id=%s filename=%r", user_id, fname)
        raise HTTPException(
            status_code=400,
            detail="Empty upload — the photo data didn't make it. Please try selecting it again.",
        )
    if size_in > MAX_UPLOAD_BYTES:
        mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        _upload_log.warning(
            "upload_image.too_large user_id=%s filename=%r bytes=%d limit=%d",
            user_id, fname, size_in, MAX_UPLOAD_BYTES,
        )
        raise HTTPException(
            status_code=413,
            detail=f"This photo is too large ({size_in // (1024*1024)} MB). Max {mb} MB — please choose a smaller image or compress it first.",
        )

    try:
        img = Image.open(io.BytesIO(blob))
        # HEIC/HEIF requires pillow-heif (registered at module import).
        # `img.load()` triggers full decode so we surface format errors
        # synchronously (Pillow is otherwise lazy).
        img.load()
    except Exception as e:
        _upload_log.error(
            "upload_image.decode_fail user_id=%s filename=%r content_type=%r bytes=%d err=%s",
            user_id, fname, ct_in, size_in, e,
        )
        # Map common decode errors to user-friendly messages.
        msg = str(e).lower()
        if "heif" in msg or "heic" in msg:
            user_msg = (
                "We couldn't open this HEIC photo. Try selecting it again, "
                "or change your iPhone Camera setting to 'Most Compatible' "
                "in Settings → Camera → Formats."
            )
        elif "cannot identify" in msg or "unknown image" in msg:
            user_msg = (
                "This file doesn't look like a supported image. "
                "Please pick a JPEG, PNG, WEBP, or HEIC photo."
            )
        else:
            user_msg = f"We couldn't read this photo ({e})."
        raise HTTPException(status_code=415, detail=user_msg)

    # Normalise orientation using EXIF so portrait photos don't land
    # rotated 90°. Pillow's ImageOps.exif_transpose handles every case.
    img = ImageOps.exif_transpose(img)
    save_format = "JPEG"
    ext = "jpg"
    if img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, (0, 0, 0))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    lw, lh = img.size
    long_edge = max(lw, lh)
    if long_edge > MAX_LONG_EDGE:
        scale = MAX_LONG_EDGE / float(long_edge)
        img = img.resize(
            (int(lw * scale), int(lh * scale)),
            Image.LANCZOS,
        )

    out = io.BytesIO()
    img.save(out, save_format, quality=JPEG_QUALITY, optimize=True, progressive=True)
    encoded = out.getvalue()

    now = datetime.now(timezone.utc)
    name = f"{uuid.uuid4().hex}.{ext}"
    # May 2026 — stable image identifier returned to the client and
    # stored on the spot_community_uploads row. The leading "img_"
    # prefix matches the convention used elsewhere (DEMO_SPOTS,
    # admin_spot_action, etc.) so per-image audit logs are uniform.
    image_id = f"img_{uuid.uuid4().hex[:10]}"

    # ─── May 2026: route to Cloudflare R2 when configured ──────────────
    # /app/backend/uploads lives on the container's ephemeral local
    # disk. Every pod restart on prod silently wipes user photos while
    # MongoDB keeps the rows. R2 (S3-compatible) gives us a durable
    # object store + CDN delivery in one. When R2 env vars are absent
    # (dev / Expo Go), we fall back to the legacy on-disk path below.
    if storage_r2.r2_configured():
        # Resolve the spot_id (if provided) to an organized key prefix.
        # If the spot is unknown / soft-deleted, fall back to the
        # legacy date-partitioned prefix so a stale spot_id in the
        # client never blocks a successful upload.
        key_prefix = f"uploads/{now.year:04d}/{now.month:02d}"
        location_prefix_used = False
        if spot_id:
            try:
                spot_doc = await db.spots.find_one(
                    {"spot_id": spot_id},
                    {"_id": 0, "spot_id": 1, "title": 1, "visibility_status": 1},
                )
                if spot_doc and spot_doc.get("visibility_status") != "deleted":
                    key_prefix = storage_r2.build_location_key_prefix(
                        spot_doc.get("spot_id") or spot_id,
                        spot_doc.get("title"),
                    )
                    location_prefix_used = True
                else:
                    _upload_log.info(
                        "upload_image.spot_id_unknown_or_deleted user_id=%s spot_id=%r — using legacy date prefix",
                        user_id, spot_id,
                    )
            except Exception as e:
                # Never block an upload on a spot-lookup failure — fall
                # back to the legacy prefix and log for ops.
                _upload_log.warning(
                    "upload_image.spot_lookup_failed user_id=%s spot_id=%r err=%r — using legacy date prefix",
                    user_id, spot_id, e,
                )
        try:
            r2_res = storage_r2.put_object(
                key_prefix=key_prefix,
                data=encoded,
                extension=ext,
                content_type="image/jpeg",
            )
        except Exception as e:
            _upload_log.error(
                "upload_image.r2_put_fail user_id=%s filename=%r err=%r",
                user_id, fname, e,
            )
            raise HTTPException(
                status_code=500,
                detail="Couldn't save the photo on our side. Please try again in a moment.",
            )

        rel_url = r2_res["public_url"]
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        _upload_log.info(
            "upload_image.r2_ok user_id=%s filename=%r in_bytes=%d in_mime=%r "
            "out_bytes=%d out_dim=%dx%d key=%s url=%s elapsed_ms=%d "
            "location_prefix=%s spot_id=%r",
            user_id, fname, size_in, ct_in, len(encoded),
            img.size[0], img.size[1], r2_res["key"], rel_url, elapsed_ms,
            location_prefix_used, spot_id,
        )
        return {
            "image_url": rel_url,
            "image_id": image_id,
            "storage": "r2",
            "storage_key": r2_res["key"],
            # `r2_key` is a friendlier alias for callers / DB rows. Both
            # fields carry the same value when storage == "r2".
            "r2_key": r2_res["key"],
            "spot_id": spot_id if location_prefix_used else None,
            "width": img.size[0],
            "height": img.size[1],
            "bytes": len(encoded),
            "size_bytes": len(encoded),
            "mime": "image/jpeg",
            "content_type": "image/jpeg",
        }

    # ─── Local-disk fallback (dev / Expo Go / R2 unconfigured) ─────────
    sub = UPLOADS_ROOT / f"{now.year:04d}" / f"{now.month:02d}"
    sub.mkdir(parents=True, exist_ok=True)
    path = sub / name
    try:
        path.write_bytes(encoded)
    except OSError as e:
        _upload_log.error(
            "upload_image.disk_write_fail user_id=%s filename=%r err=%s",
            user_id, fname, e,
        )
        raise HTTPException(
            status_code=500,
            detail="Couldn't save the photo on our side. Please try again in a moment.",
        )

    rel_url = f"/api/uploads/{now.year:04d}/{now.month:02d}/{name}"
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    _upload_log.info(
        "upload_image.ok user_id=%s filename=%r in_bytes=%d in_mime=%r out_bytes=%d "
        "out_dim=%dx%d url=%s elapsed_ms=%d",
        user_id, fname, size_in, ct_in, len(encoded),
        img.size[0], img.size[1], rel_url, elapsed_ms,
    )
    return {
        "image_url": rel_url,
        "image_id": image_id,
        "storage": "local",
        "storage_key": None,
        "r2_key": None,
        "spot_id": None,
        "width": img.size[0],
        "height": img.size[1],
        "bytes": len(encoded),
        "size_bytes": len(encoded),
        "mime": "image/jpeg",
        "content_type": "image/jpeg",
    }


# --- Static file serve --------------------------------------------------------
# FastAPI's StaticFiles mount could be used here too, but a first-class
# route keeps us consistent with the /api prefix that the frontend proxy
# rewrites from /api/* → backend:8001 on Kubernetes. We also get to set
# cache headers explicitly so CDN / Expo Image caching works well.

@router.get("/uploads/{year}/{month}/{filename}")
async def serve_upload(year: str, month: str, filename: str):
    # Only allow numeric dirs + safe filenames to prevent path traversal.
    if not (year.isdigit() and month.isdigit()):
        raise HTTPException(status_code=404, detail="Not found")
    safe_name = os.path.basename(filename)
    if safe_name != filename:
        raise HTTPException(status_code=404, detail="Not found")
    p = UPLOADS_ROOT / year / month / safe_name
    if p.is_file():
        # 30-day immutable cache — uploaded files are content-addressed
        # (UUID filename) so they never change under a URL.
        return FileResponse(
            str(p),
            media_type="image/jpeg" if p.suffix.lower() in (".jpg", ".jpeg") else None,
            headers={"Cache-Control": "public, max-age=2592000, immutable"},
        )

    # June 2025 — Legacy URL fallback to R2.
    # Container disk is ephemeral (every pod restart wipes it), so old
    # /api/uploads/<y>/<m>/<file> URLs still embedded in DB rows or
    # social-share previews would 404 after a redeploy. If R2 is
    # configured AND the same key exists in R2 (the backfill script
    # puts them at the same key), 302-redirect to the R2 public URL.
    # The 302 lets clients & caches keep using the legacy URL while
    # we transparently serve from R2. Browsers/CDNs treat 302s as
    # cacheable per Cache-Control here.
    if storage_r2.r2_configured():
        candidate_key = f"uploads/{year}/{month}/{safe_name}"
        meta = storage_r2.head_object(candidate_key)
        if meta is not None:
            target = storage_r2.public_url_for(candidate_key)
            return RedirectResponse(
                url=target,
                status_code=302,
                headers={"Cache-Control": "public, max-age=86400"},
            )
    raise HTTPException(status_code=404, detail="Not found")
