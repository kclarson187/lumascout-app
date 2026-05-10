"""
backfill_disk_to_r2.py — One-shot migration: ephemeral on-disk uploads → R2
═══════════════════════════════════════════════════════════════════════════

Why this exists
───────────────
Container disk at /app/backend/uploads is ephemeral. Every pod restart wipes
it while MongoDB keeps the rows that point at /api/uploads/<y>/<m>/<file>.
Result: cover images 404 after every redeploy.

This script:
  1) Walks /app/backend/uploads recursively for .jpg/.jpeg/.png/.webp.
  2) For each file, uploads bytes to R2 at the SAME key shape:
       uploads/<YYYY>/<MM>/<filename>
     (The serve_upload route already redirects to R2 at this exact
     key when the local file is missing — no DB rewrite required.)
  3) Skips files that already exist in R2 (head_object check).
  4) Optionally — when --rewrite-db is passed — also rewrites stored
     URLs in spots/spot_community_uploads/posts so clients hit R2
     directly without going through the redirect.

Usage
─────
DRY-RUN (default — no R2 writes, no DB writes; just lists what would happen):
    cd /app/backend && python -m scripts.backfill_disk_to_r2

UPLOAD only (push files to R2, leave DB URLs unchanged — redirects cover it):
    cd /app/backend && python -m scripts.backfill_disk_to_r2 --apply

UPLOAD + rewrite DB URLs to R2 public URL (cuts out the redirect hop):
    cd /app/backend && python -m scripts.backfill_disk_to_r2 --apply --rewrite-db

Safe to re-run. Idempotent: head_object skips already-uploaded keys, and
the DB rewrite step uses an exact-match update so it never touches a row
that's already been migrated.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import re
import sys
from pathlib import Path

# Make `services` importable when running as a module from /app/backend.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from services import storage_r2  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("backfill")

UPLOADS_ROOT = Path(os.environ.get("LUMASCOUT_UPLOADS_DIR") or "/app/backend/uploads")
LEGACY_RE = re.compile(r"/api/uploads/(\d{4})/(\d{2})/([^/?#]+)")

CONTENT_TYPE_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def iter_local_files():
    """Yield (relative-key, absolute-path) for every supported image
    found under UPLOADS_ROOT."""
    if not UPLOADS_ROOT.is_dir():
        return
    for path in UPLOADS_ROOT.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in CONTENT_TYPE_BY_EXT:
            continue
        rel = path.relative_to(UPLOADS_ROOT)
        # Force the key to mirror legacy URL shape: uploads/<y>/<m>/<file>
        key = f"uploads/{rel.as_posix()}"
        yield key, path


def upload_file(key: str, abs_path: Path, *, apply: bool) -> str:
    """Returns a status string: 'skip-exists' | 'uploaded' | 'dry-run'."""
    if storage_r2.head_object(key) is not None:
        return "skip-exists"
    if not apply:
        return "dry-run"
    data = abs_path.read_bytes()
    ct = CONTENT_TYPE_BY_EXT.get(abs_path.suffix.lower(), "application/octet-stream")
    # Use the low-level boto3 client directly to write at the EXACT key
    # — storage_r2.put_object generates a UUID, which we don't want here
    # because we need to preserve the legacy filename.
    client = storage_r2._get_client()  # noqa: SLF001 — module-internal helper
    client.put_object(
        Bucket=storage_r2.R2_BUCKET,
        Key=key,
        Body=data,
        ContentType=ct,
        CacheControl="public, max-age=31536000, immutable",
    )
    return "uploaded"


async def rewrite_db_urls(*, apply: bool) -> dict:
    """Rewrite legacy /api/uploads/... URLs in DB rows to direct R2 public URLs.

    Touches:
      • spots[].images[].url
      • spots[].cover_image_url
      • spot_community_uploads[].image_url
      • posts[].images[]
    """
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    counts = {"spots_images": 0, "spots_cover": 0, "community": 0, "posts": 0}

    # 1) spots[].images[].url
    cursor = db.spots.find(
        {"images.url": {"$regex": "/api/uploads/"}},
        {"_id": 1, "spot_id": 1, "images": 1, "cover_image_url": 1},
    )
    async for doc in cursor:
        changed = False
        new_images = []
        for img in doc.get("images") or []:
            url = (img or {}).get("url") or ""
            m = LEGACY_RE.search(url)
            if m:
                key = f"uploads/{m.group(1)}/{m.group(2)}/{m.group(3)}"
                new_url = storage_r2.public_url_for(key)
                img = {**img, "url": new_url, "r2_key": key}
                changed = True
            new_images.append(img)
        cover = doc.get("cover_image_url") or ""
        m2 = LEGACY_RE.search(cover)
        new_cover = cover
        if m2:
            key2 = f"uploads/{m2.group(1)}/{m2.group(2)}/{m2.group(3)}"
            new_cover = storage_r2.public_url_for(key2)
        if changed and apply:
            await db.spots.update_one(
                {"_id": doc["_id"]},
                {"$set": {"images": new_images}},
            )
            counts["spots_images"] += 1
        if m2 and apply:
            await db.spots.update_one(
                {"_id": doc["_id"]},
                {"$set": {"cover_image_url": new_cover}},
            )
            counts["spots_cover"] += 1
        if (changed or m2) and not apply:
            counts["spots_images"] += 1 if changed else 0
            counts["spots_cover"] += 1 if m2 else 0

    # 2) spot_community_uploads
    cursor = db.spot_community_uploads.find(
        {"image_url": {"$regex": "/api/uploads/"}},
        {"_id": 1, "image_url": 1},
    )
    async for doc in cursor:
        m = LEGACY_RE.search(doc.get("image_url") or "")
        if not m:
            continue
        key = f"uploads/{m.group(1)}/{m.group(2)}/{m.group(3)}"
        new_url = storage_r2.public_url_for(key)
        if apply:
            await db.spot_community_uploads.update_one(
                {"_id": doc["_id"]},
                {"$set": {"image_url": new_url, "r2_key": key}},
            )
        counts["community"] += 1

    # 3) posts[].images[]
    cursor = db.posts.find(
        {"images": {"$regex": "/api/uploads/"}},
        {"_id": 1, "images": 1},
    )
    async for doc in cursor:
        imgs = doc.get("images") or []
        new_imgs = []
        changed = False
        for img in imgs:
            if isinstance(img, str):
                m = LEGACY_RE.search(img)
                if m:
                    key = f"uploads/{m.group(1)}/{m.group(2)}/{m.group(3)}"
                    new_imgs.append(storage_r2.public_url_for(key))
                    changed = True
                    continue
            new_imgs.append(img)
        if changed and apply:
            await db.posts.update_one(
                {"_id": doc["_id"]},
                {"$set": {"images": new_imgs}},
            )
        if changed:
            counts["posts"] += 1

    client.close()
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually write to R2 (default: dry run)")
    parser.add_argument(
        "--rewrite-db", action="store_true",
        help="Also rewrite legacy /api/uploads/... URLs in MongoDB to R2 public URLs.",
    )
    args = parser.parse_args()

    if not storage_r2.r2_configured():
        log.error("R2 is not configured. Set R2_* env vars and re-run.")
        return 2

    log.info("R2 configured: bucket=%s public_base=%s", storage_r2.R2_BUCKET, storage_r2.R2_PUBLIC_BASE_URL)
    log.info("Mode: %s%s", "APPLY" if args.apply else "DRY-RUN",
             " + DB-REWRITE" if args.rewrite_db else "")

    counts = {"uploaded": 0, "skip-exists": 0, "dry-run": 0, "errors": 0}
    for key, abs_path in iter_local_files():
        try:
            status = upload_file(key, abs_path, apply=args.apply)
            counts[status] = counts.get(status, 0) + 1
            if status == "uploaded":
                log.info("UP  %s  (%d bytes)", key, abs_path.stat().st_size)
            elif status == "skip-exists":
                log.debug("SK  %s  (already in R2)", key)
            else:
                log.info("DR  %s  (%d bytes)", key, abs_path.stat().st_size)
        except Exception as e:
            counts["errors"] += 1
            log.exception("FAIL %s — %r", key, e)

    log.info("File pass complete: %s", counts)

    if args.rewrite_db:
        log.info("Starting MongoDB URL rewrite pass…")
        db_counts = asyncio.run(rewrite_db_urls(apply=args.apply))
        log.info("DB rewrite complete: %s", db_counts)

    return 0


if __name__ == "__main__":
    sys.exit(main())
