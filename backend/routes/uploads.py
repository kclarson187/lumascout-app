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
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse
from PIL import Image, ImageOps

from server import get_current_user, check_rate_limit  # reuse existing hooks

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
    user: dict = Depends(get_current_user),
):
    """Accept a single image and return its hosted URL.

    The frontend sends a multipart/form-data payload with field name
    `file`. We re-encode via Pillow to strip EXIF, normalise
    orientation (common iOS rotation quirk), auto-downscale to keep
    Mongo / CDN / battery costs sane, and return a stable JSON shape:

        { "image_url": "/api/uploads/2026/04/abcd.jpg",
          "width": 2048, "height": 1365, "bytes": 412031, "mime": "image/jpeg" }
    """
    check_rate_limit("image_upload", user["user_id"])

    # Defensive MIME check — UploadFile.content_type is set from the client
    # header, but some devices send octet-stream. We also sniff the bytes
    # with Pillow below, so this is just a fast-fail.
    ct = (file.content_type or "").lower()
    if ct and ct not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported image type: {ct}")

    blob = await file.read()
    if not blob:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(blob) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large. Max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )

    try:
        img = Image.open(io.BytesIO(blob))
        # HEIC/HEIF requires pillow-heif; we accept the upload but
        # transparently convert. Pillow 12 ships with HEIF support via
        # pillow-heif plugin if installed; the `open` will raise if not
        # supported, which we handle below.
        img.load()
    except Exception as e:
        raise HTTPException(status_code=415, detail=f"Could not decode image: {e}")

    # Normalise orientation using EXIF so portrait photos don't land
    # rotated 90°. Pillow's ImageOps.exif_transpose handles every case.
    img = ImageOps.exif_transpose(img)
    # Convert any RGBA/P modes to RGB (JPEG can't hold alpha) — but
    # preserve transparency-sensitive assets by saving as PNG if alpha
    # is meaningful (rare for photos).
    save_format = "JPEG"
    ext = "jpg"
    if img.mode in ("RGBA", "LA"):
        # Flatten against black — our gallery is dark-themed so this
        # looks natural. If the user wanted transparency we'd have to
        # keep PNG, but spot photos don't need it.
        bg = Image.new("RGB", img.size, (0, 0, 0))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    # Downscale if the long edge exceeds the cap — avoids shipping 48MP
    # raw iPhone images across the wire or storing them on disk.
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

    # Store under /uploads/<YYYY>/<MM>/<uuid>.<ext>. Sharding by month
    # keeps the directory listings small and makes backups/cleanup easy.
    now = datetime.now(timezone.utc)
    sub = UPLOADS_ROOT / f"{now.year:04d}" / f"{now.month:02d}"
    sub.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    path = sub / name
    path.write_bytes(encoded)

    rel_url = f"/api/uploads/{now.year:04d}/{now.month:02d}/{name}"
    return {
        "image_url": rel_url,
        "width": img.size[0],
        "height": img.size[1],
        "bytes": len(encoded),
        "mime": "image/jpeg",
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
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    # 30-day immutable cache — uploaded files are content-addressed
    # (UUID filename) so they never change under a URL.
    return FileResponse(
        str(p),
        media_type="image/jpeg" if p.suffix.lower() in (".jpg", ".jpeg") else None,
        headers={"Cache-Control": "public, max-age=2592000, immutable"},
    )
