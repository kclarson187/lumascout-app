"""One-off: reset kclarson187@gmail.com super-admin password to a known
value so Scope B testing can use it. Mirrors update_admin_password.py.
"""
import asyncio, os, sys
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import bcrypt
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone

EMAIL = "kclarson187@gmail.com"
NEW_PASSWORD = "Grayson@1117!!"  # match the seed admin's password for simplicity


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db_name = os.environ.get("DB_NAME") or client.get_default_database().name
    db = client[db_name]
    user = await db.users.find_one({"email": EMAIL})
    if not user:
        print(f"ERR: no user with email={EMAIL}")
        sys.exit(1)
    new_hash = bcrypt.hashpw(NEW_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    res = await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "password_hash": new_hash,
            "password_updated_at": datetime.now(timezone.utc),
            "status": "active",
            "deleted": False,
        }},
    )
    print(f"matched={res.matched_count} modified={res.modified_count}")
    print(f"user_id={user['user_id']} email={user['email']} role={user.get('role')}")
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    ok = bcrypt.checkpw(NEW_PASSWORD.encode("utf-8"), fresh["password_hash"].encode("utf-8"))
    print(f"verify: {'PASS' if ok else 'FAIL'}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
