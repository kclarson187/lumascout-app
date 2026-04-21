"""
One-shot migration: backfill is_test_data / is_test_account flags on existing
QA records so public feeds exclude them by default.

Seeded demo content (Scout AI bot, sophie's collections, marco's uploads,
north-america demo users) is explicitly preserved as real content.

Idempotent — safe to re-run. Prints counts at the end.

Run:  cd /app/backend && python3 _mark_test_data.py
"""
import asyncio
import os
import re
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

# Demo / seeded usernames that MUST NEVER be marked as test.
PRESERVE_USERNAMES = {
    "scoutai",     # Scout AI assistant bot
    "keith",       # super admin (FIX Commit 7b: renamed from 'admin')
    "sophie", "marco", "priya", "jordan", "lena",
    "emily.toronto", "noah.vancouver", "aiden.seattle",
    "ben.chicago", "sara.sf", "david.miami", "lucas.cdmx",
    "maria.toronto", "luis.monterrey",
}
PRESERVE_EMAIL_DOMAINS = {"@lumascout.app"}   # all seeded accounts live here


def is_seeded_user(u: dict) -> bool:
    em = (u.get("email") or "").lower()
    un = (u.get("username") or "").lower()
    if un in PRESERVE_USERNAMES:
        return True
    for d in PRESERVE_EMAIL_DOMAINS:
        if em.endswith(d):
            return True
    return False


# Tight regex for QA user accounts (match actual seeded test creators).
QA_USER_EMAIL = re.compile(
    r"(^test_|^qa_|^stripe_|^regression_|^automation_|@test\.com$|@example\.com$)",
    re.I,
)
QA_USER_USERNAME = re.compile(
    r"^(test_|qa_|stripe_|regression_|fresh_test|automation_)",
    re.I,
)

# Tight regex for QA posts (title-only, to avoid false-positives on editorial).
QA_POST_TITLE = re.compile(
    r"^("
    r"phase [a-z]|phase-[0-9]"         # phase c / phase f / phase-4
    r"|qa[ -]"                         # qa test, qa linked, qa reg, qa phase-4
    r"|rate.?limit"                    # rate limit probe
    r"|regression"                     # regression run
    r"|stripe qa"                      # stripe qa
    r"|fresh test"
    r"|probe "                         # probe 18, probe 22
    r")",
    re.I,
)

# Tight regex for QA spot titles.
QA_SPOT_TITLE = re.compile(
    r"^(regression test|qa |phase [a-z]|ultimate_location|test spot|automation)",
    re.I,
)


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client.photoscout_database

    counts = {"users": 0, "posts": 0, "spots": 0, "reports": 0, "skipped_editorial": 0}

    # ---- Users ----------------------------------------------------------
    user_ids_test: set[str] = set()
    async for u in db.users.find({}, {"user_id": 1, "email": 1, "username": 1, "role": 1}):
        if is_seeded_user(u):
            continue
        em = u.get("email") or ""
        un = u.get("username") or ""
        is_qa = bool(QA_USER_EMAIL.search(em) or QA_USER_USERNAME.search(un))
        if is_qa:
            await db.users.update_one(
                {"user_id": u["user_id"]},
                {"$set": {"is_test_account": True}},
            )
            user_ids_test.add(u["user_id"])
            counts["users"] += 1

    # ---- Posts ----------------------------------------------------------
    async for p in db.community_posts.find({}, {"post_id": 1, "title": 1, "body": 1, "author_user_id": 1}):
        title = p.get("title") or ""
        owner_is_test = p.get("author_user_id") in user_ids_test
        title_matches = bool(QA_POST_TITLE.search(title))
        if owner_is_test or title_matches:
            await db.community_posts.update_one(
                {"post_id": p["post_id"]},
                {"$set": {"is_test_data": True}},
            )
            counts["posts"] += 1

    # ---- Spots ----------------------------------------------------------
    spot_ids_test: set[str] = set()
    async for s in db.spots.find({}, {"spot_id": 1, "title": 1, "owner_user_id": 1}):
        title = s.get("title") or ""
        owner_is_test = s.get("owner_user_id") in user_ids_test
        title_matches = bool(QA_SPOT_TITLE.search(title))
        if owner_is_test or title_matches:
            await db.spots.update_one(
                {"spot_id": s["spot_id"]},
                {"$set": {"is_test_data": True}},
            )
            spot_ids_test.add(s["spot_id"])
            counts["spots"] += 1

    # ---- Reports -------------------------------------------------------
    async for r in db.reports.find({}, {"report_id": 1, "target_type": 1, "target_id": 1, "reporter_user_id": 1}):
        flag = False
        if r.get("reporter_user_id") in user_ids_test:
            flag = True
        elif r.get("target_type") == "user" and r.get("target_id") in user_ids_test:
            flag = True
        elif r.get("target_type") == "spot" and r.get("target_id") in spot_ids_test:
            flag = True
        elif r.get("target_type") == "post":
            # best-effort — look up the target post to see if it's test data
            tgt = await db.community_posts.find_one({"post_id": r.get("target_id")}, {"is_test_data": 1})
            if tgt and tgt.get("is_test_data"):
                flag = True
        if flag:
            await db.reports.update_one(
                {"report_id": r["report_id"]},
                {"$set": {"is_test_data": True}},
            )
            counts["reports"] += 1

    print("== Test data hygiene migration complete ==")
    for k, v in counts.items():
        print(f"  {k:>20}: {v}")


if __name__ == "__main__":
    asyncio.run(main())
