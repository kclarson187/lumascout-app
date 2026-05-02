"""
One-shot cleanup: remove 1×1 placeholder JPEGs (legacy QA upload scripts) from
both the DB references and the disk.

Strategy
────────
1. Scan /app/backend/uploads/**/*.jpg for files < 2 KB (real photos are >10 KB).
2. Build a set of {filename, full_url} identifiers.
3. For each MongoDB collection that can hold image URLs:
      - spots.images[]                 (primary spot gallery)
      - spots.hero_cover_image_url     (admin override)
      - spots.cover_image_url / card_url / image_url (legacy)
      - spot_community_uploads.image_url
      - collections.cover_image_url / collections.items[*].image_url
   strip out any entry whose URL ends with a corrupted filename.
4. If stripping leaves a spot with zero images AND it was user-created
   (`created_by` not None), lower its `visibility_status` to `rejected`
   so it stops appearing on the map. Seeded spots we leave alone —
   they'll just show the branded gradient fallback.
5. Delete the corrupted files from disk.

Run:   python -m scripts.clean_corrupted_uploads        # dry-run (default)
       python -m scripts.clean_corrupted_uploads --apply # actually mutate DB + FS
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Set

# Ensure we can import the server module when run from scripts/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import db  # noqa: E402

UPLOADS_ROOT = Path(__file__).resolve().parent.parent / "uploads"
MIN_REAL_BYTES = 2000  # real JPEGs are >> 10 KB; <2 KB = placeholder


def find_corrupted_files() -> list[Path]:
    out: list[Path] = []
    if not UPLOADS_ROOT.exists():
        return out
    for f in UPLOADS_ROOT.rglob("*.jpg"):
        try:
            if f.stat().st_size < MIN_REAL_BYTES:
                out.append(f)
        except OSError:
            pass
    return sorted(out)


def url_matches(url: str | None, filenames: Set[str]) -> bool:
    if not url or not isinstance(url, str):
        return False
    # Strip query + hash
    clean = url.split("?", 1)[0].split("#", 1)[0]
    return any(clean.endswith(f"/{fn}") or clean.endswith(fn) for fn in filenames)


async def clean(apply: bool) -> None:
    corrupted = find_corrupted_files()
    filenames: Set[str] = {f.name for f in corrupted}
    print(f"Found {len(corrupted)} corrupted files on disk (< {MIN_REAL_BYTES} B)")
    for f in corrupted:
        print(f"   • {f.stat().st_size:>5} B  {f.relative_to(UPLOADS_ROOT)}")
    print()

    if not filenames:
        print("Nothing to clean.")
        return

    # ─────────────────────────────── spots.images[] ───────────────────────────────
    spots_touched = 0
    spots_now_empty_user: list[tuple[str, str]] = []  # (spot_id, title)
    async for s in db.spots.find(
        {"images.image_url": {"$regex": "|".join(fn for fn in filenames)}}
    ):
        imgs = s.get("images") or []
        kept = [im for im in imgs if isinstance(im, dict) and not url_matches(im.get("image_url"), filenames)]
        if len(kept) == len(imgs):
            continue
        spots_touched += 1
        creator = s.get("created_by")
        title = s.get("title") or "(untitled)"
        spot_id = s.get("spot_id")
        print(f"   SPOT {spot_id} [{title[:40]}] images: {len(imgs)} → {len(kept)}  creator={'user' if creator else 'SEED'}")
        if apply:
            update = {"$set": {"images": kept}}
            # Also scrub any top-level cover URLs that point at corrupted files
            for field in ("hero_cover_image_url", "cover_image_url", "card_url", "image_url"):
                if url_matches(s.get(field), filenames):
                    update.setdefault("$unset", {})[field] = ""
            await db.spots.update_one({"spot_id": spot_id}, update)
            if not kept and creator:
                # User-created spot with no remaining images → hide it.
                await db.spots.update_one(
                    {"spot_id": spot_id},
                    {"$set": {"visibility_status": "rejected", "rejection_reason": "corrupted_uploads_cleanup"}},
                )
                spots_now_empty_user.append((spot_id, title))

    # ─────────────────────── spots with corrupted TOP-LEVEL cover ──────────────────
    top_level_count = 0
    for field in ("hero_cover_image_url", "cover_image_url", "card_url", "image_url"):
        async for s in db.spots.find(
            {field: {"$regex": "|".join(fn for fn in filenames)}}
        ):
            if url_matches(s.get(field), filenames):
                top_level_count += 1
                if apply:
                    await db.spots.update_one(
                        {"spot_id": s.get("spot_id")},
                        {"$unset": {field: ""}},
                    )

    # ──────────────────────── spot_community_uploads.image_url ────────────────────
    cu_deleted = 0
    if "spot_community_uploads" in await db.list_collection_names():
        async for u in db.spot_community_uploads.find(
            {"image_url": {"$regex": "|".join(fn for fn in filenames)}}
        ):
            if url_matches(u.get("image_url"), filenames):
                cu_deleted += 1
                if apply:
                    await db.spot_community_uploads.delete_one({"upload_id": u.get("upload_id")})

    print()
    print(f"Summary:")
    print(f"  spots.images[] entries touched: {spots_touched}")
    print(f"  spots top-level cover URLs scrubbed: {top_level_count}")
    print(f"  community_uploads deleted: {cu_deleted}")
    print(f"  user-spots hidden (rejected, no remaining images): {len(spots_now_empty_user)}")
    for sid, t in spots_now_empty_user:
        print(f"     ! hidden: {sid}  {t[:60]}")
    print()

    if apply:
        deleted_files = 0
        for f in corrupted:
            try:
                f.unlink()
                deleted_files += 1
            except OSError as e:
                print(f"   ! could not delete {f}: {e}")
        print(f"  files deleted from disk: {deleted_files}/{len(corrupted)}")
    else:
        print(f"  (dry-run) {len(corrupted)} files WOULD be deleted. Re-run with --apply to commit.")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="Actually mutate DB + delete files")
    args = p.parse_args()
    asyncio.run(clean(apply=args.apply))


if __name__ == "__main__":
    main()
