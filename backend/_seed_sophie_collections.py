"""
One-shot cleanup + seed for sophie's collections.

- Deletes any of sophie's collections whose name starts with 'TEST_' or 'Test Col'
  AND whose spot_ids is empty (orphan test residue).
- Ensures sophie has at least one richly-populated demo collection
  ("Austin Golden Hour Picks") drawn from her first public spots.

Run once:  python /app/backend/_seed_sophie_collections.py
"""

import asyncio
import os
import secrets
import time
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "photoscout_database")


def col_id() -> str:
    return "col_" + secrets.token_hex(6)


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    sophie = await db.users.find_one({"email": "sophie@lumascout.app"})
    if not sophie:
        print("sophie@lumascout.app not found; abort.")
        return

    uid = sophie["user_id"]

    # 1) Purge orphan TEST / Test Col collections (empty spot_ids only, don't
    # nuke anything real).
    orphan_filter = {
        "owner_user_id": uid,
        "$or": [
            {"name": {"$regex": "^TEST_", "$options": "i"}},
            {"name": {"$regex": "^Test Col", "$options": "i"}},
            {"name": {"$regex": "^My Test Collection", "$options": "i"}},
        ],
        "$and": [{"$or": [{"spot_ids": {"$exists": False}}, {"spot_ids": {"$size": 0}}]}],
    }
    purged = await db.collections.delete_many(orphan_filter)
    print(f"Purged {purged.deleted_count} orphan test collections.")

    # 2) Find sophie's spots (for a real populated demo collection).
    spots = (
        await db.spots.find(
            {"owner_user_id": uid, "privacy_mode": "public"},
            {"_id": 0, "spot_id": 1, "city": 1},
        )
        .limit(8)
        .to_list(8)
    )
    spot_ids = [s["spot_id"] for s in spots if s.get("spot_id")]
    print(f"Found {len(spot_ids)} public spots for sophie.")

    if not spot_ids:
        # Fallback: any public Austin spot.
        fallback = (
            await db.spots.find(
                {"city": "Austin", "privacy_mode": "public"},
                {"_id": 0, "spot_id": 1},
            )
            .limit(6)
            .to_list(6)
        )
        spot_ids = [s["spot_id"] for s in fallback if s.get("spot_id")]
        print(f"Fallback: using {len(spot_ids)} Austin public spots.")

    if not spot_ids:
        # Final fallback: any 6 public spots.
        any_pub = await db.spots.find({"privacy_mode": "public"}, {"_id": 0, "spot_id": 1}).limit(6).to_list(6)
        spot_ids = [s["spot_id"] for s in any_pub if s.get("spot_id")]
        print(f"Final fallback: {len(spot_ids)} generic public spots.")

    if not spot_ids:
        print("No usable spots found — skipping seed.")
        return

    demo_name = "Austin Golden Hour Picks"
    existing = await db.collections.find_one(
        {"owner_user_id": uid, "name": demo_name}
    )

    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "spot_ids": spot_ids[:6],
        "description": "Favorite rooftop + riverbank spots for warm-tone family sessions.",
        "privacy_mode": "public",
        "updated_at": now,
    }

    if existing:
        await db.collections.update_one(
            {"collection_id": existing["collection_id"]},
            {"$set": payload},
        )
        print(f"Updated existing demo collection: {existing['collection_id']}")
    else:
        doc = {
            "collection_id": col_id(),
            "owner_user_id": uid,
            "name": demo_name,
            "created_at": now,
            **payload,
        }
        await db.collections.insert_one(doc)
        print(f"Created demo collection: {doc['collection_id']}")

    # Print a final summary so the test agent can see the state.
    final = await db.collections.find({"owner_user_id": uid}, {"_id": 0}).to_list(50)
    print(f"\nSophie now has {len(final)} collections:")
    for c in final:
        print(
            f"  - {c.get('name')!r:40s}  spots={len(c.get('spot_ids') or []):>3d}  "
            f"privacy={c.get('privacy_mode')}"
        )


if __name__ == "__main__":
    asyncio.run(main())
