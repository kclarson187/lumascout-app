"""One-shot idempotent migration — Feature 4, May 2026.

Rewrite any preview-host URLs stored in the spot_shares collection to the
permanent host so existing share links (and any audit fields) point at
photo-finder-60.emergent.host. Safe to re-run.

Why this is defensive: in the current code base spot_shares does NOT
store a full share_url on the document — URLs are composed at read time
from PUBLIC_SHARE_BASE_URL. But if any earlier revision (or a future
one) ever wrote a `share_url` / `canonical_url` / `og_image` style field
with the preview host embedded, this script normalizes it. Idempotent:
re-running after a fix is a no-op.
"""
import asyncio
import os
import re
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

OLD_HOSTS = [
    "https://photo-finder-60.preview.emergentagent.com",
    "http://photo-finder-60.preview.emergentagent.com",
    # add any other variants here defensively
]
NEW_HOST = os.environ.get(
    "PUBLIC_SHARE_BASE_URL", "https://photo-finder-60.emergent.host"
).rstrip("/")

# Fields that, if they exist on a spot_shares row, may carry a full URL.
URL_BEARING_FIELDS = (
    "share_url",
    "api_url",
    "canonical_url",
    "og_image",
    "public_url",
    "web_url",
)


def _swap(value: str) -> str:
    for old in OLD_HOSTS:
        if old and old in value:
            value = value.replace(old, NEW_HOST)
    return value


async def main():
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ.get("DB_NAME") or "photoscout_database"
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    total_scanned = 0
    rewritten_rows = 0
    rewritten_fields = 0
    # Build an OR query that matches any URL-bearing field containing any
    # of the OLD_HOSTS strings. Done with a regex on each field.
    or_clauses = []
    pattern = re.compile("|".join(re.escape(h) for h in OLD_HOSTS))
    for f in URL_BEARING_FIELDS:
        or_clauses.append({f: {"$regex": pattern.pattern}})

    cursor = db.spot_shares.find({"$or": or_clauses}, {"_id": 1, **{f: 1 for f in URL_BEARING_FIELDS}})
    async for row in cursor:
        total_scanned += 1
        update: dict = {}
        for f in URL_BEARING_FIELDS:
            v = row.get(f)
            if isinstance(v, str) and pattern.search(v):
                new_v = _swap(v)
                if new_v != v:
                    update[f] = new_v
                    rewritten_fields += 1
        if update:
            update["host_normalized_at"] = __import__("datetime").datetime.utcnow()
            await db.spot_shares.update_one({"_id": row["_id"]}, {"$set": update})
            rewritten_rows += 1

    # Sanity: count total share rows so the report is meaningful.
    total_rows = await db.spot_shares.count_documents({})
    print(f"PUBLIC_SHARE_BASE_URL (target): {NEW_HOST}")
    print(f"OLD_HOSTS searched           : {OLD_HOSTS}")
    print(f"spot_shares total rows       : {total_rows}")
    print(f"rows with preview-host URLs  : {total_scanned}")
    print(f"rows rewritten               : {rewritten_rows}")
    print(f"individual fields rewritten  : {rewritten_fields}")
    if rewritten_rows == 0:
        print("\n[OK] No preview-host URLs persisted on spot_shares rows. URLs are composed at read time, which is correct.")
    else:
        print(f"\n[OK] Normalized {rewritten_rows} row(s) to {NEW_HOST}.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
