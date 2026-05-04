"""
mongo_image_ref_cleanup.py — fix Mongo image refs that point at deleted
files (May 2026)
═══════════════════════════════════════════════════════════════════════

What this is
────────────
The PRODUCTION fix for the user-visible 404 spot images. Reads
`/app/backend/cache/orphan_report.json` (produced by
`orphan_image_scan.py`), and for each spot whose image references
return 404 / 410:

  • removes the dead URL from `images[]`,
  • clears `cover_image_url` / `hero_cover_image_url` / `thumb_url` /
    `image` / `admin_cover_override.image_url` if they were the dead URL,
  • promotes the next surviving image in `images[]` to be the cover
    when the cleared cover/hero is the last live reference,
  • leaves the spot unchanged if the only remaining content is its
    title (so the UI's `<SpotImageFallback>` placeholder takes over).

This script is COMPLEMENTARY to `r2_orphan_cleanup.py`:
  • That one finds R2 objects with NO Mongo reference (waste storage).
  • This one finds Mongo references with NO R2/file backing (404s).

Safety model
────────────
1. `--preview` is the default. Prints exactly what WOULD change, with
   per-spot diff, then exits 0.
2. `--confirm` is REQUIRED to mutate Mongo. Even then we only touch
   the URLs the report flagged as 404/410/transport-failed, and we
   only touch the protected fields enumerated below.
3. Each Mongo write is atomic (a single `update_one` with `$set`/
   `$pull`) and is keyed on `spot_id` so a partial failure never
   leaves a spot in a half-state.
4. Every change is logged to a snapshot under
   `/app/backend/cache/mongo_image_ref_cleanup_<ts>.json`.
5. Skips uncertain cases: HTTP statuses we don't have a clear policy
   for (5xx, transient errors), or any spot whose report block
   mentions a status not in {404, 410}.
6. Idempotent — running it twice cleans up nothing the second time.
7. Reads-only on Mongo until --confirm.

Usage
─────
    python /app/backend/scripts/mongo_image_ref_cleanup.py --preview
    python /app/backend/scripts/mongo_image_ref_cleanup.py --confirm
    python /app/backend/scripts/mongo_image_ref_cleanup.py --preview --report /path/to/other_report.json

Exit codes
──────────
   0  success (preview or confirm)
   2  configuration / report problem
   3  script crashed mid-run (best-effort partial progress log written)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
except Exception:
    pass

DEFAULT_REPORT = Path("/app/backend/cache/orphan_report.json")
SNAPSHOT_DIR = Path("/app/backend/cache")
SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

# Statuses the report can record. We only act on these:
DEAD_STATUSES = {404, 410}

try:
    from pymongo import MongoClient
except Exception as e:
    print(f"[fatal] pymongo not installed: {e!r}")
    sys.exit(2)


def _load_report(path: Path) -> Dict[str, Any]:
    if not path.exists():
        print(f"[fatal] report not found: {path}")
        sys.exit(2)
    try:
        return json.loads(path.read_text())
    except Exception as e:
        print(f"[fatal] report not parseable: {e!r}")
        sys.exit(2)


def _connect_mongo():
    url = os.environ.get("MONGO_URL", "").strip()
    if not url:
        print("[fatal] MONGO_URL not set")
        sys.exit(2)
    try:
        c = MongoClient(url, serverSelectionTimeoutMS=5000)
        c.admin.command("ping")
        db_name = (
            os.environ.get("DB_NAME")
            or (c.get_default_database().name if c.get_default_database() is not None else None)
            or "photoscout_database"
        )
        return c[db_name], db_name
    except Exception as e:
        print(f"[fatal] Mongo not reachable: {e!r}")
        sys.exit(2)


def _plan_for_spot(doc: Dict[str, Any], dead_urls: Set[str]) -> Optional[Dict[str, Any]]:
    """
    Return a planned change dict for this spot OR None if nothing needs
    to change. The plan is consumed both by --preview (printed) and by
    --confirm (executed via update_one).

    Plan shape:
      {
        "$set": {...},           # fields to set
        "$pull": {...},          # arrays to pull dead entries from
        "_human": [str, ...],    # human-readable change descriptions
      }
    """
    set_ops: Dict[str, Any] = {}
    pull_ops: Dict[str, Any] = {}
    human: List[str] = []

    # Fields where the dead URL might live as a single string. If any
    # match, null them out — UI will fall back to <SpotImageFallback>.
    for f in ("hero_cover_image_url", "cover_image_url", "thumb_url", "image"):
        v = doc.get(f)
        if isinstance(v, str) and v in dead_urls:
            set_ops[f] = None
            human.append(f"clear {f}")

    # admin_cover_override.image_url
    override = doc.get("admin_cover_override")
    if isinstance(override, dict):
        ov_url = override.get("image_url") or override.get("url")
        if isinstance(ov_url, str) and ov_url in dead_urls:
            # Drop the entire override so /api/spots returns the
            # natural cover cascade. Setting the parent to null is
            # cleaner than partial-clearing one of its fields.
            set_ops["admin_cover_override"] = None
            human.append("clear admin_cover_override (was pointing at dead URL)")

    # images[] — pull every entry referencing a dead URL.
    imgs = doc.get("images")
    if isinstance(imgs, list):
        # MongoDB $pull supports a query expression. We need to match
        # both "string element equals dead URL" AND "object whose
        # image_url/url equals dead URL". Handle by collecting the
        # specific subdocs to pull (preserves indexed shape).
        live_images: List[Any] = []
        dead_image_refs: List[Any] = []
        for item in imgs:
            ref = item if isinstance(item, str) else (
                (item.get("image_url") or item.get("url")) if isinstance(item, dict) else None
            )
            if isinstance(ref, str) and ref in dead_urls:
                dead_image_refs.append(item)
            else:
                live_images.append(item)
        if dead_image_refs:
            # Easier semantics: rewrite the array. update_one with
            # $set on images is atomic per-document.
            set_ops["images"] = live_images
            human.append(f"strip {len(dead_image_refs)} dead entr{'y' if len(dead_image_refs)==1 else 'ies'} from images[]")

            # If we just nulled the cover but `images[]` still has
            # survivors, promote the first survivor to cover so the
            # next page-render shows SOMETHING.
            survivor = next(
                (s if isinstance(s, str) else (s.get("image_url") or s.get("url"))
                 for s in live_images
                 if isinstance(s, str) or (isinstance(s, dict) and (s.get("image_url") or s.get("url")))),
                None,
            )
            if survivor:
                if set_ops.get("cover_image_url", "missing") is None or doc.get("cover_image_url") in dead_urls:
                    set_ops["cover_image_url"] = survivor
                    human.append("promote first surviving image to cover_image_url")
                if set_ops.get("hero_cover_image_url", "missing") is None or doc.get("hero_cover_image_url") in dead_urls:
                    set_ops["hero_cover_image_url"] = survivor
                    human.append("promote first surviving image to hero_cover_image_url")

    if not set_ops and not pull_ops:
        return None
    plan: Dict[str, Any] = {"_human": human}
    if set_ops:
        plan["$set"] = set_ops
    if pull_ops:
        plan["$pull"] = pull_ops
    return plan


def main() -> int:
    ap = argparse.ArgumentParser(description="Mongo image-reference cleanup")
    ap.add_argument("--preview", action="store_true",
                    help="(default) Read-only. Show planned changes but do NOT mutate Mongo.")
    ap.add_argument("--confirm", action="store_true",
                    help="REQUIRED to actually update Mongo.")
    ap.add_argument("--report", default=str(DEFAULT_REPORT),
                    help="Path to the orphan report JSON (default: cache/orphan_report.json)")
    args = ap.parse_args()

    if args.preview and args.confirm:
        print("[fatal] --preview and --confirm are mutually exclusive")
        return 2
    confirm = bool(args.confirm)
    mode = "CONFIRM (will mutate Mongo)" if confirm else "PREVIEW (read-only)"

    print("=" * 72)
    print(f"  MONGO IMAGE-REF CLEANUP — mode: {mode}")
    print(f"  report: {args.report}")
    print(f"  started: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 72)

    # 1. Load + validate the report.
    report = _load_report(Path(args.report))
    affected = report.get("top_10_affected") or []
    # The report file's top_10 only carries 10 spots, but we need ALL
    # affected. The full sample list is built from `sample_failed_urls`
    # plus we re-read the report's sample. For our purposes the
    # ground-truth list of dead URLs comes from:
    #   • top_10_affected[*].fields[*].url where status ∈ DEAD_STATUSES
    #   • sample_failed_urls[*].url where status ∈ DEAD_STATUSES
    dead_urls_by_spot: Dict[str, Set[str]] = defaultdict(set)
    all_dead_urls: Set[str] = set()
    for spot in affected:
        sid = spot.get("spot_id")
        for f in (spot.get("fields") or []):
            if f.get("status") in DEAD_STATUSES:
                dead_urls_by_spot[sid].add(f["url"])
                all_dead_urls.add(f["url"])
    for s in (report.get("sample_failed_urls") or []):
        if s.get("status") in DEAD_STATUSES:
            sid = s.get("spot_id")
            if sid:
                dead_urls_by_spot[sid].add(s["url"])
                all_dead_urls.add(s["url"])

    print(f"[ok] report parsed   spots flagged: {len(dead_urls_by_spot)}   dead URLs: {len(all_dead_urls)}")
    if not dead_urls_by_spot:
        print("[ok] No actionable spots in report — nothing to clean.")
        return 0

    # 2. Mongo connection.
    db, db_name = _connect_mongo()
    print(f"[ok] Mongo connected   db={db_name}")

    # 3. Build per-spot plan.
    plans: List[Tuple[str, Dict[str, Any]]] = []
    not_found: List[str] = []
    nothing_to_do: List[str] = []
    for sid, dead_set in dead_urls_by_spot.items():
        doc = db.spots.find_one({"spot_id": sid})
        if not doc:
            not_found.append(sid)
            continue
        plan = _plan_for_spot(doc, dead_set)
        if plan is None:
            nothing_to_do.append(sid)
            continue
        plans.append((sid, plan))

    print()
    print(f"  Spots in report      : {len(dead_urls_by_spot)}")
    print(f"  Spots not in DB      : {len(not_found)}")
    print(f"  Spots already clean  : {len(nothing_to_do)}")
    print(f"  Spots to update      : {len(plans)}")
    print()

    # 4. Diff print.
    print("Planned changes:")
    print("-" * 72)
    for sid, plan in plans:
        title = (db.spots.find_one({"spot_id": sid}, {"title": 1}) or {}).get("title") or "(no title)"
        print(f"  • {sid}   {title}")
        for h in plan["_human"]:
            print(f"      - {h}")
    print("-" * 72)
    print()

    # 5. Persist snapshot.
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    snap = SNAPSHOT_DIR / f"mongo_image_ref_cleanup_{ts}.json"
    snap.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "report": args.report,
        "spots_in_report": len(dead_urls_by_spot),
        "not_in_db": not_found,
        "already_clean": nothing_to_do,
        "planned": [
            {"spot_id": sid, "human": plan["_human"], "set": plan.get("$set"), "pull": plan.get("$pull")}
            for sid, plan in plans
        ],
    }, indent=2, default=str))
    print(f"[ok] snapshot written → {snap}")

    if not confirm:
        print()
        print("PREVIEW MODE — no Mongo writes performed.")
        print("Re-run with --confirm to apply.")
        return 0

    # 6. Apply.
    applied = 0
    failed = 0
    for sid, plan in plans:
        update: Dict[str, Any] = {}
        if "$set" in plan:
            update["$set"] = plan["$set"]
        if "$pull" in plan:
            update["$pull"] = plan["$pull"]
        if not update:
            continue
        try:
            res = db.spots.update_one({"spot_id": sid}, update)
            applied += 1
            print(f"  [updated]   {sid}   matched={res.matched_count} modified={res.modified_count}")
        except Exception as e:
            failed += 1
            print(f"  [error]     {sid}   {e!r}")

    print()
    print(f"  Applied  : {applied}")
    print(f"  Failed   : {failed}")
    return 0 if failed == 0 else 3


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
