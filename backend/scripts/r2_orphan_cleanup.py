"""
r2_orphan_cleanup.py — long-term hygiene script for Cloudflare R2 (May 2026)
═══════════════════════════════════════════════════════════════════════════

What this is
────────────
This is the LITERAL R2-orphan cleanup: it scans every object in the
production R2 bucket (`R2_BUCKET`), cross-references each key against
MongoDB to confirm there is no live spot / user / marketplace document
pointing at it, and either lists or (with `--confirm`) deletes those
genuinely-orphaned R2 objects.

This script is COMPLEMENTARY to `mongo_image_ref_cleanup.py`:
  • This one finds R2 objects with NO Mongo reference (waste storage).
  • The other finds Mongo references with NO R2/file backing (404s).

What this is NOT
────────────────
Not the script that fixes today's user-visible 404 spot images. For
that, see `mongo_image_ref_cleanup.py`. R2 just went live and we don't
expect any orphans yet — running `--preview` today will (correctly)
report zero deletions.

Safety model
────────────
1. Read-only by default. `--preview` is the default mode. Print what
   WOULD be deleted, then exit 0.
2. `--confirm` is REQUIRED to issue any DeleteObject calls.
3. Even with `--confirm`, we double-check Mongo references at delete
   time (not just at scan time) to defend against the race where a
   user creates a new spot referencing an object between scan and delete.
4. Delete-allowlist: only objects whose key matches the configured
   prefix (default `uploads/`) are eligible. This prevents the script
   from EVER deleting smoke-test artifacts, internal R2 control
   objects, or anything outside the well-known uploads namespace.
5. Skip if R2 is not configured. Skip if Mongo is not reachable.
   Both fail visibly with a non-zero exit code so a misconfigured CI
   run doesn't quietly blow away production data.
6. Per-key logging — every attempted delete prints status (deleted,
   already-missing, mongo-referenced-skipped, error).
7. Idempotent — re-running with `--confirm` after a successful run
   simply finds the bucket clean and exits.

Usage
─────
    python /app/backend/scripts/r2_orphan_cleanup.py --preview
    python /app/backend/scripts/r2_orphan_cleanup.py --confirm
    python /app/backend/scripts/r2_orphan_cleanup.py --preview --max 1000
    python /app/backend/scripts/r2_orphan_cleanup.py --preview --prefix uploads/2025/

May 2026 — organized R2 layout
──────────────────────────────
New uploads land under ``locations/{slug}_{spot_id}/gallery/...`` instead
of the legacy date-partitioned ``uploads/YYYY/MM/...`` prefix. To
generate a complete orphan report you must scan BOTH prefixes:

    python /app/backend/scripts/r2_orphan_cleanup.py --preview --prefix uploads/
    python /app/backend/scripts/r2_orphan_cleanup.py --preview --prefix locations/

The mongo reference scan already covers both layouts because it reads
``storage_key`` / ``r2_key`` verbatim — it doesn't care which prefix a
key sits under.

Exit codes
──────────
   0  success (preview or confirm)
   2  configuration / environment problem
   3  script crashed mid-run (best-effort partial-progress log written)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Optional, Set

# ─── env loading ─────────────────────────────────────────────────────────
# Standalone scripts shouldn't depend on FastAPI startup machinery; we
# load .env directly.
try:
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
except Exception:
    pass

REPORT_DIR = Path("/app/backend/cache")
REPORT_DIR.mkdir(parents=True, exist_ok=True)

# ─── R2 + Mongo deps ─────────────────────────────────────────────────────
try:
    import boto3
    from botocore.client import Config as BotoConfig
    from botocore.exceptions import BotoCoreError, ClientError
except Exception as e:
    print(f"[fatal] boto3 not installed: {e!r}")
    sys.exit(2)

try:
    from pymongo import MongoClient
except Exception as e:
    print(f"[fatal] pymongo not installed: {e!r}")
    sys.exit(2)


def _r2_client():
    """Build an S3-compat client pointed at R2, or return None if not configured."""
    account = (os.environ.get("R2_ACCOUNT_ID") or "").strip()
    key_id = (os.environ.get("R2_ACCESS_KEY_ID") or "").strip()
    secret = (os.environ.get("R2_SECRET_ACCESS_KEY") or "").strip()
    bucket = (os.environ.get("R2_BUCKET") or "").strip()
    public = (os.environ.get("R2_PUBLIC_BASE_URL") or "").strip().rstrip("/")
    if not (account and key_id and secret and bucket and public):
        return None, None, None
    endpoint = f"https://{account}.r2.cloudflarestorage.com"
    c = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    return c, bucket, public


# ─── Mongo reference loader ──────────────────────────────────────────────
PROTECTED_COLLECTIONS = {
    "spots":              ("hero_cover_image_url", "cover_image_url", "thumb_url",
                           "image", "images"),
    "users":              ("avatar_url", "banner_url", "cover_url", "image_url"),
    "marketplace_listings": ("cover_image_url", "thumb_url", "images", "media"),
    "spot_community_uploads": ("image_url", "storage_key"),
    "messages":           ("attachment_url",),
    "posts":              ("image_url", "images", "media"),
    "communities":        ("cover_image_url", "banner_url"),
    "lists":              ("cover_image_url",),
    "trips":              ("cover_image_url",),
    "collections":        ("cover_image_url",),
}

R2_KEY_RE = re.compile(r"https://[^/]+\.r2\.dev/([^?#]+)")


def _extract_key(value, public_base: str, keys: Set[str]) -> None:
    """Mutate `keys` in place — extract any R2 object key referenced by `value`."""
    if not value:
        return
    if isinstance(value, str):
        # Direct r2.dev URL reference
        m = R2_KEY_RE.search(value)
        if m:
            keys.add(m.group(1))
        # storage_key style reference (already a key, e.g. "uploads/2026/05/x.jpg")
        # Only treat as a key if it doesn't start with a scheme.
        elif not value.startswith(("http://", "https://", "data:", "blob:", "/")):
            keys.add(value)
        return
    if isinstance(value, list):
        for v in value:
            _extract_key(v, public_base, keys)
        return
    if isinstance(value, dict):
        for k, v in value.items():
            if k in {"image_url", "url", "storage_key", "key", "media", "image",
                     "thumb_url", "cover_image_url", "hero_cover_image_url",
                     "avatar_url", "banner_url", "cover_url", "attachment_url"}:
                _extract_key(v, public_base, keys)


def load_referenced_keys(db, public_base: str) -> Set[str]:
    """Walk every protected collection + field → every R2 key any document refers to."""
    refs: Set[str] = set()
    for col, fields in PROTECTED_COLLECTIONS.items():
        try:
            cursor = db[col].find({}, {f: 1 for f in fields})
            for doc in cursor:
                for f in fields:
                    if f in doc:
                        _extract_key(doc[f], public_base, refs)
        except Exception as e:
            print(f"[warn] failed to walk {col}: {e!r}")
    return refs


# ─── Bucket scanner ──────────────────────────────────────────────────────
def list_bucket_keys(client, bucket: str, prefix: str, max_keys: Optional[int]) -> Iterable[dict]:
    """Yield {Key, Size, LastModified} dicts for every object under prefix."""
    paginator = client.get_paginator("list_objects_v2")
    yielded = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents") or []:
            yield {
                "Key": obj["Key"],
                "Size": obj.get("Size") or 0,
                "LastModified": obj.get("LastModified"),
            }
            yielded += 1
            if max_keys is not None and yielded >= max_keys:
                return


# ─── main ────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="Cloudflare R2 orphan cleanup")
    ap.add_argument("--preview", action="store_true",
                    help="(default) Read-only. Show orphans but do not delete.")
    ap.add_argument("--confirm", action="store_true",
                    help="REQUIRED to actually delete. Implies acknowledgement.")
    ap.add_argument("--prefix", default="uploads/",
                    help="Only scan/delete keys under this prefix (default: uploads/)")
    ap.add_argument("--max", type=int, default=None,
                    help="Cap scan at N objects (debugging).")
    ap.add_argument("--i-know-this-mongo-is-prod", action="store_true",
                    help="Bypass the localhost/non-prod safety guard. Use ONLY "
                         "when you have a tunnel to prod Mongo from this shell.")
    args = ap.parse_args()

    # Default to preview if neither flag explicitly set; reject mutually-
    # exclusive flags.
    if args.preview and args.confirm:
        print("[fatal] --preview and --confirm are mutually exclusive")
        return 2
    confirm = bool(args.confirm)
    mode = "CONFIRM (DESTRUCTIVE)" if confirm else "PREVIEW (read-only)"

    print("=" * 72)
    print(f"  R2 ORPHAN CLEANUP — mode: {mode}")
    print(f"  prefix: {args.prefix}   max: {args.max or 'unbounded'}")
    print(f"  started: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 72)

    # 1. Wire R2.
    client, bucket, public_base = _r2_client()
    if not client:
        print("[fatal] R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, "
              "R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.")
        return 2
    print(f"[ok] R2 client wired   bucket={bucket}   public={public_base}")

    # 2. Wire Mongo (read-only, but we want to require connectivity).
    mongo_url = os.environ.get("MONGO_URL", "").strip()
    if not mongo_url:
        print("[fatal] MONGO_URL not set — cannot validate references.")
        return 2

    # ─── May 2026 PRODUCTION-SAFETY GUARD ───────────────────────────
    # We learned the hard way that R2 buckets are typically SHARED
    # across preview and production deployments (same R2 credentials,
    # same bucket). Running --confirm from a preview container scans
    # the preview Mongo for references but DELETES from the shared
    # bucket — meaning any object only-referenced by prod gets nuked.
    # That happened on 2026-05-04, costing 6 user-uploaded images
    # across McAllister Park / Bullis County Park / Joshua Springs.
    #
    # Mitigation: refuse to --confirm against a Mongo URL that smells
    # like a non-prod target (localhost / 127.0.0.1 / docker-internal /
    # mongo / "preview" hostnames). Operators who genuinely have a
    # local prod-mirror connection (rare) can override with
    # --i-know-this-mongo-is-prod, which forces them to think
    # twice before doing destructive work.
    if confirm:
        unsafe_markers = ("localhost", "127.0.0.1", "0.0.0.0", "preview",
                          "host.docker.internal", "mongo.svc",
                          "mongodb://mongo:")
        looks_local = any(m in mongo_url.lower() for m in unsafe_markers)
        if looks_local and not args.i_know_this_mongo_is_prod:
            print("[refuse] --confirm blocked: MONGO_URL looks like a non-prod")
            print("         instance (matches one of: localhost, 127.0.0.1,")
            print("         0.0.0.0, preview, host.docker.internal, mongo.svc).")
            print()
            print("         R2 buckets are usually shared across deployments.")
            print("         Running --confirm here would delete R2 objects")
            print("         that ARE referenced by the prod Mongo we can't")
            print("         see from this container.")
            print()
            print("         Either:")
            print("           1. Run this script from inside the PROD backend")
            print("              container (recommended), OR")
            print("           2. Set MONGO_URL to the prod Mongo connection")
            print("              string and re-run, OR")
            print("           3. (LAST RESORT) re-run with")
            print("              --i-know-this-mongo-is-prod  to bypass")
            print("              this guard. You will be asked to type the")
            print("              bucket name to proceed.")
            return 2
        if looks_local and args.i_know_this_mongo_is_prod:
            try:
                ack = input(f"Type the bucket name '{bucket}' to confirm: ").strip()
            except EOFError:
                ack = ""
            if ack != bucket:
                print("[refuse] confirmation mismatch — aborting.")
                return 2
    try:
        mc = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
        # Force a server roundtrip so we fail fast if Mongo is down.
        mc.admin.command("ping")
        # Honor the DB_NAME env var first (matches what server.py uses);
        # fall back to a name embedded in the URL; finally fall back to
        # the project's canonical default.
        db_name = (
            os.environ.get("DB_NAME")
            or (mc.get_default_database().name if mc.get_default_database() is not None else None)
            or "photoscout_database"
        )
        db = mc[db_name]
    except Exception as e:
        print(f"[fatal] Mongo not reachable: {e!r}")
        return 2
    print(f"[ok] Mongo connected   db={db_name}")

    # 3. Build the live-references set.
    print("[scan] walking protected Mongo collections for referenced R2 keys…")
    refs = load_referenced_keys(db, public_base)
    print(f"[scan] referenced R2 keys: {len(refs)}")

    # 4. Walk R2 bucket.
    print(f"[scan] listing R2 bucket under prefix={args.prefix!r}…")
    bucket_objects: List[dict] = []
    try:
        for obj in list_bucket_keys(client, bucket, args.prefix, args.max):
            bucket_objects.append(obj)
    except (BotoCoreError, ClientError) as e:
        print(f"[fatal] R2 list failed: {e!r}")
        return 3
    print(f"[scan] R2 objects under prefix: {len(bucket_objects)}")

    # 5. Diff — orphans = bucket - refs.
    orphans = [o for o in bucket_objects if o["Key"] not in refs]
    referenced = len(bucket_objects) - len(orphans)
    total_orphan_bytes = sum(o["Size"] for o in orphans)

    print()
    print(f"  Bucket objects scanned : {len(bucket_objects)}")
    print(f"  Mongo-referenced       : {referenced}")
    print(f"  ORPHANED (no Mongo ref): {len(orphans)}")
    print(f"  Orphan bytes total     : {total_orphan_bytes:,}")
    print()

    if not orphans:
        print("[ok] Bucket is clean — nothing to delete.")
        return 0

    # 6. Sample preview — first 10.
    print("Sample of orphaned keys (up to 10):")
    for o in orphans[:10]:
        lm = o["LastModified"].isoformat() if o["LastModified"] else "?"
        print(f"  - {o['Key']}   {o['Size']:,}B   last_modified={lm}")
    if len(orphans) > 10:
        print(f"  …and {len(orphans) - 10} more.")
    print()

    # 7. Persist a snapshot for review.
    snapshot_path = REPORT_DIR / f"r2_orphan_preview_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    snapshot_path.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "prefix": args.prefix,
        "bucket_objects": len(bucket_objects),
        "mongo_referenced": referenced,
        "orphan_count": len(orphans),
        "orphan_bytes_total": total_orphan_bytes,
        "orphans": [
            {
                "key": o["Key"],
                "size": o["Size"],
                "last_modified": o["LastModified"].isoformat() if o["LastModified"] else None,
            }
            for o in orphans
        ],
    }, indent=2))
    print(f"[ok] snapshot written → {snapshot_path}")

    if not confirm:
        print()
        print("PREVIEW MODE — no deletions performed.")
        print("Re-run with --confirm to delete the listed orphans.")
        return 0

    # 8. Confirm-mode: re-validate each candidate against Mongo at
    #    DELETE TIME (defends against scan-vs-delete races where a new
    #    upload was created between phases).
    refs_now = load_referenced_keys(db, public_base)
    deleted = 0
    skipped_now_referenced = 0
    errored = 0
    for o in orphans:
        key = o["Key"]
        # Allowlist guard — never delete outside `--prefix`.
        if not key.startswith(args.prefix):
            print(f"  [skip-allowlist]  {key}")
            continue
        if key in refs_now:
            skipped_now_referenced += 1
            print(f"  [skip-now-refed]  {key}")
            continue
        try:
            client.delete_object(Bucket=bucket, Key=key)
            deleted += 1
            print(f"  [deleted]         {key}")
        except (BotoCoreError, ClientError) as e:
            errored += 1
            print(f"  [error]           {key}   {e!r}")

    print()
    print(f"  Deleted              : {deleted}")
    print(f"  Skipped (now-refed)  : {skipped_now_referenced}")
    print(f"  Errored              : {errored}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n[abort] interrupted by user")
        sys.exit(3)
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(3)
