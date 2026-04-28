"""
One-time migration: sweep base64 data URLs out of Mongo and into the
on-disk uploads store. Rewrites:

  • spots.images[].image_url
  • spots.hero_cover_image_url
  • spots.admin_cover_override.image_url
  • spot_community_uploads.image_url
  • users.avatar_url
  • dm_messages.image_url / .spot_ref.cover_image_url

Idempotent: only touches `data:image/...` strings. If you run it twice
the second pass is a no-op. Prints a summary at the end.

Usage (from /app):
    python backend/scripts/migrate_base64_images.py

Environment: relies on MONGO_URL + DB_NAME from backend/.env.
"""
from __future__ import annotations

import asyncio
import base64
import io
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Allow `import server` when run from any cwd.
HERE = Path(__file__).resolve().parent
BACKEND_ROOT = HERE.parent
sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND_ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")
UPLOADS_ROOT = Path(os.environ.get("LUMASCOUT_UPLOADS_DIR") or "/app/backend/uploads")
UPLOADS_ROOT.mkdir(parents=True, exist_ok=True)

MAX_LONG_EDGE = 2048
JPEG_QUALITY = 82

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


def _persist_base64(data_url: str) -> str | None:
    """Decode a `data:image/...;base64,...` string, re-encode as JPEG,
    write to the on-disk store, and return its public URL. Returns None
    on any decode/render failure so the caller leaves the doc untouched.
    """
    try:
        if not isinstance(data_url, str) or not data_url.startswith("data:"):
            return None
        header, _, b64 = data_url.partition(",")
        if not b64:
            return None
        raw = base64.b64decode(b64, validate=False)
        img = Image.open(io.BytesIO(raw))
        img.load()
        img = ImageOps.exif_transpose(img)
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
            img = img.resize((int(lw * scale), int(lh * scale)), Image.LANCZOS)
        now = datetime.now(timezone.utc)
        sub = UPLOADS_ROOT / f"{now.year:04d}" / f"{now.month:02d}"
        sub.mkdir(parents=True, exist_ok=True)
        name = f"{uuid.uuid4().hex}.jpg"
        (sub / name).write_bytes(
            _encode_jpeg(img)
        )
        return f"/api/uploads/{now.year:04d}/{now.month:02d}/{name}"
    except Exception as e:
        print(f"  !! decode failed: {type(e).__name__}: {e}")
        return None


def _encode_jpeg(img) -> bytes:
    out = io.BytesIO()
    img.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    return out.getvalue()


async def migrate_spots() -> dict:
    counts = {"spots_scanned": 0, "images_migrated": 0, "hero_migrated": 0, "override_migrated": 0}
    async for spot in db.spots.find({}, {
        "_id": 1, "spot_id": 1, "images": 1,
        "hero_cover_image_url": 1, "admin_cover_override": 1,
    }):
        counts["spots_scanned"] += 1
        updates: dict = {}

        imgs = spot.get("images") or []
        new_imgs = []
        changed = False
        for im in imgs:
            if isinstance(im, dict) and isinstance(im.get("image_url"), str) and im["image_url"].startswith("data:"):
                new_url = _persist_base64(im["image_url"])
                if new_url:
                    new_imgs.append({**im, "image_url": new_url})
                    counts["images_migrated"] += 1
                    changed = True
                    continue
            new_imgs.append(im)
        if changed:
            updates["images"] = new_imgs

        hero = spot.get("hero_cover_image_url")
        if isinstance(hero, str) and hero.startswith("data:"):
            new_hero = _persist_base64(hero)
            if new_hero:
                updates["hero_cover_image_url"] = new_hero
                counts["hero_migrated"] += 1

        aco = spot.get("admin_cover_override")
        if isinstance(aco, dict) and isinstance(aco.get("image_url"), str) and aco["image_url"].startswith("data:"):
            new_aco_url = _persist_base64(aco["image_url"])
            if new_aco_url:
                updates["admin_cover_override"] = {**aco, "image_url": new_aco_url}
                counts["override_migrated"] += 1

        if updates:
            await db.spots.update_one({"_id": spot["_id"]}, {"$set": updates})
            print(f"  spot {spot.get('spot_id')}: migrated {len(updates)} fields")
    return counts


async def migrate_collection_simple(coll_name: str, field: str) -> int:
    n = 0
    async for doc in db[coll_name].find({field: {"$regex": "^data:"}}, {"_id": 1, field: 1}):
        new_url = _persist_base64(doc.get(field))
        if new_url:
            await db[coll_name].update_one({"_id": doc["_id"]}, {"$set": {field: new_url}})
            n += 1
    return n


async def main():
    print(f"Migrating base64 images -> {UPLOADS_ROOT}")
    print(f"DB: {DB_NAME}")
    spots_counts = await migrate_spots()
    print(f"spots: {spots_counts}")
    uploads_n = await migrate_collection_simple("spot_community_uploads", "image_url")
    print(f"spot_community_uploads.image_url migrated: {uploads_n}")
    users_n = await migrate_collection_simple("users", "avatar_url")
    print(f"users.avatar_url migrated: {users_n}")
    dm_n = await migrate_collection_simple("dm_messages", "image_url")
    print(f"dm_messages.image_url migrated: {dm_n}")
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
