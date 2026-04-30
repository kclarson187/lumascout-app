"""One-off: update the super_admin password.

Usage:
    python /app/backend/scripts/update_admin_password.py
"""
import asyncio
import os
import sys
from pathlib import Path

# Load .env the same way server.py does.
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import bcrypt
from motor.motor_asyncio import AsyncIOMotorClient

ADMIN_EMAIL = "admin@lumascout.app"
NEW_PASSWORD = "Grayson@1117!!"


async def main():
    mongo_url = os.environ["MONGO_URL"]
    client = AsyncIOMotorClient(mongo_url)
    # Pick DB exactly the way server.py does it — first the DB_NAME env,
    # then fall back to the DB pinned to the URL (default_database).
    db_name = os.environ.get("DB_NAME") or client.get_default_database().name
    db = client[db_name]

    user = await db.users.find_one({"email": ADMIN_EMAIL})
    if not user:
        print(f"ERR: no user with email={ADMIN_EMAIL}")
        sys.exit(1)

    new_hash = bcrypt.hashpw(NEW_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    from datetime import datetime, timezone
    result = await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "password_hash": new_hash,
            "password_updated_at": datetime.now(timezone.utc),
        }},
    )
    print(f"OK: matched={result.matched_count} modified={result.modified_count}")
    print(f"    user_id={user['user_id']} email={user['email']} role={user.get('role')}")
    print(f"    new password: {NEW_PASSWORD}")

    # Sanity-check: verify the new hash validates against the password.
    refreshed = await db.users.find_one({"user_id": user["user_id"]})
    ok = bcrypt.checkpw(NEW_PASSWORD.encode("utf-8"), refreshed["password_hash"].encode("utf-8"))
    print(f"    verify: {'PASS' if ok else 'FAIL'}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
