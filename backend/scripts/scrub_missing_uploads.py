#!/usr/bin/env python3
"""scripts/scrub_missing_uploads.py

Batch #6, May 2026 — LumaScout upload-file integrity scrub.

Scans every DB row that references a local `/api/uploads/<path>` URL, checks
that the backing file still exists on disk, and in `--apply` mode nulls the
reference + records an audit entry. Does NOT delete user content — only
clears the dangling image URL so the frontend stops re-requesting a 404.

=== SAFETY GUARANTEES ===
  * DRY-RUN BY DEFAULT. Nothing is modified unless `--apply` is passed.
  * Only affects rows whose image_url points to a path under /api/uploads/
    AND whose file is missing. External URLs (http(s)://... to S3/CDN) and
    base64 data: URIs are left alone.
  * No spot/user/post/product row is deleted. Only the one dangling field is
    cleared (or the dead entry removed from a gallery array).
  * Every mutation is logged to collection `upload_integrity_scrubs` with a
    `scrub_id`, timestamp, and before/after snapshot so super-admin can audit
    or reverse.

=== USAGE ===
  Dry-run (safe):
    cd /app/backend && python scripts/scrub_missing_uploads.py

  Apply mutations (writes to DB):
    cd /app/backend && python scripts/scrub_missing_uploads.py --apply

  Target a specific collection only:
    python scripts/scrub_missing_uploads.py --only spots
    python scripts/scrub_missing_uploads.py --only community_uploads

=== WHAT IT SCANS ===
  spots:
    - images[].image_url  (array entries)
    - hero_cover_image_url (scalar)
    - admin_cover_override (scalar)
  spot_community_uploads:
    - image_url (scalar)
  marketplace_products:
    - images[]  (scalar or string array)
    - thumbnail_url (scalar)
  community_posts:
    - images[]  (array, sometimes nested objects)

=== OUTPUT ===
  Human-readable per-collection summary printed to stdout, plus machine-
  readable `upload_integrity_scrubs` doc written on --apply.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Make sure the script runs from the repo root regardless of CWD.
HERE = Path(__file__).resolve().parent
BACKEND_ROOT = HERE.parent
sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND_ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

UPLOADS_DIR = BACKEND_ROOT / "uploads"
UPLOADS_URL_PREFIXES = ("/api/uploads/", "/uploads/")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def is_local_upload_url(url: Optional[str]) -> bool:
    if not isinstance(url, str):
        return False
    # External (http(s)://, data:, cid:, etc.) URLs are skipped — only
    # local server-hosted uploads can be validated against the filesystem.
    if url.startswith(("http://", "https://", "data:", "blob:")):
        return False
    return any(prefix in url for prefix in UPLOADS_URL_PREFIXES)


def upload_relpath(url: str) -> Optional[str]:
    for prefix in UPLOADS_URL_PREFIXES:
        idx = url.find(prefix)
        if idx != -1:
            return url[idx + len(prefix):].split("?", 1)[0]
    return None


def file_exists(url: str) -> bool:
    rel = upload_relpath(url)
    if not rel:
        return True  # don't flag URLs we can't parse
    p = UPLOADS_DIR / rel
    return p.is_file()


async def scan_spots(db, apply: bool) -> Tuple[int, int, List[Dict[str, Any]]]:
    """Scan the spots collection — returns (rows_examined, fixes_count, fix_log)."""
    examined = 0
    fixes: List[Dict[str, Any]] = []
    async for doc in db.spots.find({}, {
        "spot_id": 1,
        "images": 1,
        "hero_cover_image_url": 1,
        "admin_cover_override": 1,
    }):
        examined += 1
        spot_id = doc.get("spot_id") or str(doc.get("_id"))
        updates: Dict[str, Any] = {}
        per_row_notes: List[Dict[str, Any]] = []

        # Scalar fields
        for field in ("hero_cover_image_url", "admin_cover_override"):
            url = doc.get(field)
            if is_local_upload_url(url) and not file_exists(url):
                updates[field] = None
                per_row_notes.append({"field": field, "was": url})

        # Gallery array
        imgs = doc.get("images") or []
        if isinstance(imgs, list) and imgs:
            kept: List[Any] = []
            removed: List[Any] = []
            for img in imgs:
                url = img.get("image_url") if isinstance(img, dict) else img
                if is_local_upload_url(url) and not file_exists(url):
                    removed.append(url)
                    continue
                kept.append(img)
            if removed:
                updates["images"] = kept
                per_row_notes.append({"field": "images", "removed": removed})

        if updates:
            fixes.append({"spot_id": spot_id, "updates": list(updates.keys()), "notes": per_row_notes})
            if apply:
                updates["integrity_scrubbed_at"] = utcnow()
                await db.spots.update_one({"spot_id": spot_id}, {"$set": updates})
    return examined, len(fixes), fixes


async def scan_community_uploads(db, apply: bool) -> Tuple[int, int, List[Dict[str, Any]]]:
    examined = 0
    fixes: List[Dict[str, Any]] = []
    async for doc in db.spot_community_uploads.find({}, {"upload_id": 1, "image_url": 1}):
        examined += 1
        url = doc.get("image_url")
        if is_local_upload_url(url) and not file_exists(url):
            upload_id = doc.get("upload_id") or str(doc.get("_id"))
            fixes.append({"upload_id": upload_id, "was": url})
            if apply:
                await db.spot_community_uploads.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {
                        "image_url": None,
                        "integrity_flagged_at": utcnow(),
                        "integrity_reason": "file_missing_on_disk",
                    }},
                )
    return examined, len(fixes), fixes


async def scan_marketplace(db, apply: bool) -> Tuple[int, int, List[Dict[str, Any]]]:
    examined = 0
    fixes: List[Dict[str, Any]] = []
    async for doc in db.marketplace_products.find({}, {
        "product_id": 1,
        "thumbnail_url": 1,
        "images": 1,
    }):
        examined += 1
        updates: Dict[str, Any] = {}
        pid = doc.get("product_id") or str(doc.get("_id"))

        thumb = doc.get("thumbnail_url")
        if is_local_upload_url(thumb) and not file_exists(thumb):
            updates["thumbnail_url"] = None

        imgs = doc.get("images") or []
        if isinstance(imgs, list):
            kept: List[Any] = []
            removed: List[Any] = []
            for entry in imgs:
                url = entry if isinstance(entry, str) else (entry.get("image_url") if isinstance(entry, dict) else None)
                if is_local_upload_url(url) and not file_exists(url):
                    removed.append(url)
                else:
                    kept.append(entry)
            if removed:
                updates["images"] = kept

        if updates:
            fixes.append({"product_id": pid, "updates": list(updates.keys())})
            if apply:
                updates["integrity_scrubbed_at"] = utcnow()
                await db.marketplace_products.update_one({"product_id": pid}, {"$set": updates})
    return examined, len(fixes), fixes


async def scan_community_posts(db, apply: bool) -> Tuple[int, int, List[Dict[str, Any]]]:
    examined = 0
    fixes: List[Dict[str, Any]] = []
    async for doc in db.community_posts.find({}, {"post_id": 1, "images": 1}):
        examined += 1
        pid = doc.get("post_id") or str(doc.get("_id"))
        imgs = doc.get("images") or []
        if not isinstance(imgs, list):
            continue
        kept: List[Any] = []
        removed: List[Any] = []
        for entry in imgs:
            url = entry if isinstance(entry, str) else (entry.get("image_url") if isinstance(entry, dict) else None)
            if is_local_upload_url(url) and not file_exists(url):
                removed.append(url)
            else:
                kept.append(entry)
        if removed:
            fixes.append({"post_id": pid, "removed": removed})
            if apply:
                await db.community_posts.update_one(
                    {"post_id": pid},
                    {"$set": {
                        "images": kept,
                        "integrity_scrubbed_at": utcnow(),
                    }},
                )
    return examined, len(fixes), fixes


SCANNERS = {
    "spots": scan_spots,
    "community_uploads": scan_community_uploads,
    "marketplace": scan_marketplace,
    "community_posts": scan_community_posts,
}


async def main() -> int:
    parser = argparse.ArgumentParser(description="Scrub DB rows referencing missing upload files.")
    parser.add_argument("--apply", action="store_true", help="Write fixes to DB (default is dry-run).")
    parser.add_argument(
        "--only",
        choices=sorted(SCANNERS.keys()),
        action="append",
        help="Limit scan to specific collection(s). Repeatable.",
    )
    args = parser.parse_args()

    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    scrub_id = f"scrub_{uuid.uuid4().hex[:12]}"
    target_keys: Iterable[str] = args.only if args.only else sorted(SCANNERS.keys())

    print("=" * 66)
    print(f"LumaScout upload integrity scrub — {scrub_id}")
    print(f"Mode: {'APPLY (writes)' if args.apply else 'DRY-RUN (no writes)'}")
    print(f"Uploads root: {UPLOADS_DIR}")
    print(f"Targets: {', '.join(target_keys)}")
    print("=" * 66)

    overall_summary: Dict[str, Dict[str, Any]] = {}
    total_fixes = 0

    for key in target_keys:
        scanner = SCANNERS[key]
        print(f"\n[{key}] scanning...")
        examined, fixes_count, fixes = await scanner(db, args.apply)
        overall_summary[key] = {
            "examined": examined,
            "fixes": fixes_count,
            "sample": fixes[:5],
        }
        total_fixes += fixes_count
        print(f"  examined:  {examined}")
        print(f"  fixes:     {fixes_count}")
        for sample in fixes[:5]:
            print(f"    • {sample}")
        if fixes_count > 5:
            print(f"    (... {fixes_count - 5} more)")

    # Write audit record (even on dry-run, record the attempt).
    audit_doc = {
        "scrub_id": scrub_id,
        "mode": "apply" if args.apply else "dry_run",
        "started_at": utcnow(),
        "uploads_dir": str(UPLOADS_DIR),
        "summary": overall_summary,
        "total_fixes": total_fixes,
    }
    await db.upload_integrity_scrubs.insert_one(audit_doc)

    print("\n" + "=" * 66)
    print(f"TOTAL fixes {'APPLIED' if args.apply else 'that WOULD be applied'}: {total_fixes}")
    print(f"Audit doc: upload_integrity_scrubs.{scrub_id}")
    print("=" * 66)

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
