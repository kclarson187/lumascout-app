"""
Idempotent seeder for the @scoutai bot user + admin Scout AI settings doc.

Run:
    python /app/backend/_seed_scout_ai.py

Safe to re-run — everything uses upserts on stable IDs.
"""
import asyncio
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "photoscout_database")

SCOUT_USER_ID = "user_scoutai"


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    now = datetime.now(timezone.utc).isoformat()
    scout_doc = {
        "user_id": SCOUT_USER_ID,
        "email": "scoutai@photoscout.app",
        "name": "Scout AI",
        "handle": "scoutai",
        "role": "user",
        "is_bot": True,
        "verification_status": "verified",
        "bio": "Official PhotoScout assistant. I help you find spots, plan shoots, explain scores, and answer PhotoScout questions.",
        "city": None,
        "state": None,
        "specialties": ["Location Scouting", "Planning"],
        "is_official": True,
        "plan": "elite",  # internal service identity; never billed
        "avatar_kind": "scout_ai",  # tells the client to render the SVG badge
        "updated_at": now,
    }
    existing = await db.users.find_one({"user_id": SCOUT_USER_ID})
    if existing:
        await db.users.update_one({"user_id": SCOUT_USER_ID}, {"$set": scout_doc})
        print(f"Updated existing Scout AI user: {SCOUT_USER_ID}")
    else:
        scout_doc["created_at"] = now
        # Scout AI has no password (login disabled for bot user).
        scout_doc["password_hash"] = "!disabled_bot"
        await db.users.insert_one(scout_doc)
        print(f"Created Scout AI user: {SCOUT_USER_ID}")

    # Default admin settings doc — cadence + toggles the /admin screen will edit.
    settings = {
        "_id": "scout_ai_settings",
        "enabled": True,
        "community_replies_enabled": False,   # default OFF until admin approves
        "editorial_posts_enabled": False,     # default OFF until admin approves
        "max_posts_per_day": 4,
        "unanswered_reply_delay_hours": 24,
        "updated_at": now,
    }
    await db.app_settings.update_one(
        {"_id": "scout_ai_settings"},
        {"$setOnInsert": settings},
        upsert=True,
    )
    print("Scout AI admin settings ensured.")


if __name__ == "__main__":
    asyncio.run(main())
