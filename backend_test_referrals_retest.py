"""
Referrals Retest (2026-04-24)
Tests the 9 scenarios from the review request after the missing-import fix.

Prereq: routes/referrals.py imports GIG_TYPES, REFERRAL_STATUSES,
REFERRAL_APPLY_CAP_FREE_MONTH from server.
"""
import os
import sys
import time
import uuid
import asyncio
import httpx
from datetime import datetime, timezone

BASE = os.environ.get("BACKEND_URL", "https://photo-finder-60.preview.emergentagent.com") + "/api"
MONGO_URL = None

# Load MONGO_URL from backend .env
with open("/app/backend/.env", "r") as f:
    for line in f:
        if line.startswith("MONGO_URL"):
            MONGO_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
            break

from motor.motor_asyncio import AsyncIOMotorClient
DB_NAME = os.environ.get("DB_NAME") or None

# Extract DB name from MONGO_URL if not set
if not DB_NAME:
    for line in open("/app/backend/.env"):
        if line.startswith("DB_NAME"):
            DB_NAME = line.split("=", 1)[1].strip().strip('"').strip("'")
            break

results = []
def passed(name, info=""):
    results.append(("PASS", name, info))
    print(f"✅ PASS  {name}  {info}")

def failed(name, info=""):
    results.append(("FAIL", name, info))
    print(f"❌ FAIL  {name}  {info}")


async def register(client, email, password, name, city=None):
    r = await client.post(f"{BASE}/auth/register", json={
        "email": email, "password": password, "name": name,
        "username": email.split("@")[0].replace(".", "_").replace("+", "_")[:30],
    })
    if r.status_code == 200:
        data = r.json()
        token = data["token"]
        uid = data["user"]["user_id"]
    else:
        # maybe already registered, try login
        r2 = await client.post(f"{BASE}/auth/login", json={"email": email, "password": password})
        r2.raise_for_status()
        data = r2.json()
        token = data["token"]
        uid = data["user"]["user_id"]
    return token, uid


async def login(client, email, password):
    r = await client.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    data = r.json()
    return data["token"], data["user"]["user_id"]


async def main():
    mc = AsyncIOMotorClient(MONGO_URL)
    db = mc[DB_NAME]

    async with httpx.AsyncClient(timeout=30.0) as client:
        stamp = uuid.uuid4().hex[:8]
        # Register poster U1 (Austin)
        u1_email = f"qa_poster_{stamp}@qatest.photoscout.app"
        u1_tok, u1_id = await register(client, u1_email, "demo1234", "QA Poster", city="Austin")
        # Register applicant U2 (Austin)
        u2_email = f"qa_applicant_{stamp}@qatest.photoscout.app"
        u2_tok, u2_id = await register(client, u2_email, "demo1234", "QA Applicant", city="Austin")
        # Register target U3 (Austin, available_for_referrals=true) for the fanout test
        u3_email = f"qa_target_{stamp}@qatest.photoscout.app"
        u3_tok, u3_id = await register(client, u3_email, "demo1234", "QA Target", city="Austin")

        # Set city + available_for_referrals=true on U2 and U3 directly in Mongo
        await db.users.update_one({"user_id": u1_id}, {"$set": {"city": "Austin", "state": "TX"}})
        await db.users.update_one({"user_id": u2_id}, {"$set": {
            "city": "Austin", "state": "TX", "available_for_referrals": True,
        }})
        await db.users.update_one({"user_id": u3_id}, {"$set": {
            "city": "Austin", "state": "TX", "available_for_referrals": True,
            "push_enabled": True,
        }})
        # Ensure notification_preferences allow referrals for U3
        await db.notification_preferences.update_one(
            {"user_id": u3_id},
            {"$set": {
                "user_id": u3_id,
                "push_enabled": True,
                "categories": {"referrals": True, "explore": True, "network": True,
                               "messages": True, "marketplace": True, "community": True,
                               "promotions": True},
                "quiet_hours": {"enabled": False, "start": "22:00", "end": "07:00"},
                "daily_cap": 50,
            }},
            upsert=True,
        )

        u1_h = {"Authorization": f"Bearer {u1_tok}"}
        u2_h = {"Authorization": f"Bearer {u2_tok}"}
        u3_h = {"Authorization": f"Bearer {u3_tok}"}

        # =====================================================================
        # 1) POST /referrals valid shape
        # =====================================================================
        need_id = None
        try:
            # Snapshot U3 push_log count BEFORE posting
            pre_fanout_count = await db.push_log.count_documents({"user_id": u3_id, "kind": "referral_nearby"})
            r = await client.post(f"{BASE}/referrals", headers=u1_h, json={
                "title": "QA — Austin portrait referral retest",
                "shoot_type": "portrait",
                "gig_type": "event_coverage",
                "city": "Austin",
                "state": "TX",
                "budget_cents": 20000,  # extra field, should be ignored
            })
            if r.status_code == 200 and r.json().get("need_id"):
                need_id = r.json()["need_id"]
                passed("1. POST /referrals valid shape", f"need_id={need_id}")
            else:
                failed("1. POST /referrals valid shape", f"status={r.status_code} body={r.text[:200]}")
        except Exception as e:
            failed("1. POST /referrals valid shape", f"exception: {e}")

        if not need_id:
            print("⛔ Cannot continue — POST /referrals failed. Stopping.")
            return

        # =====================================================================
        # 9) Cross-module regression — referral_nearby push_log for U3
        # (Check soon after the POST — wait up to 5s for fire-and-forget task)
        # =====================================================================
        got = False
        for _ in range(10):
            await asyncio.sleep(0.5)
            post_fanout_count = await db.push_log.count_documents({"user_id": u3_id, "kind": "referral_nearby"})
            if post_fanout_count > pre_fanout_count:
                got = True
                break
        # Fallback: check notifications row
        notif_row = await db.notifications.find_one({"user_id": u3_id, "kind": "referral_nearby"}, sort=[("created_at", -1)])
        if got:
            passed("9. referral_nearby push_log emitted to Austin target (U3)",
                   f"push_log before={pre_fanout_count} after={post_fanout_count}")
        elif notif_row and str(notif_row.get("deep_link", "")).endswith(need_id):
            passed("9. referral_nearby notification emitted (push_log may be blocked by dedupe/QH)",
                   f"notif deep_link={notif_row.get('deep_link')}")
        else:
            failed("9. referral_nearby push_log/notification to Austin target",
                   f"push_log before={pre_fanout_count} after={post_fanout_count}, notif_row={bool(notif_row)}")

        # =====================================================================
        # 2) POST /referrals/{need_id}/apply (U2 applies)
        # =====================================================================
        app_id = None
        thread_id = None
        poster_notif_before = await db.notifications.count_documents({
            "user_id": u1_id, "kind": "new_referral_applicant",
        })
        try:
            r = await client.post(f"{BASE}/referrals/{need_id}/apply", headers=u2_h, json={
                "cover_letter": "hi",  # review's field name (backend expects 'pitch'; extra ignored)
            })
            if r.status_code == 200:
                body = r.json()
                app_id = body.get("app_id")
                thread_id = body.get("thread_id")
                passed("2. POST /apply (U2)", f"app_id={app_id} thread_id={thread_id}")
            else:
                failed("2. POST /apply (U2)", f"status={r.status_code} body={r.text[:200]}")
        except Exception as e:
            failed("2. POST /apply (U2)", f"exception: {e}")

        # Check DM thread opened + poster notified
        if thread_id:
            thr = await db.dm_threads.find_one({"thread_id": thread_id})
            if thr:
                passed("2a. Apply opened DM thread", f"thread_id={thread_id}")
            else:
                failed("2a. Apply opened DM thread", "thread not found in Mongo")
        await asyncio.sleep(1.0)
        poster_notif_after = await db.notifications.count_documents({
            "user_id": u1_id, "kind": "new_referral_applicant",
        })
        if poster_notif_after > poster_notif_before:
            passed("2b. Poster notified new_referral_applicant",
                   f"before={poster_notif_before} after={poster_notif_after}")
        else:
            failed("2b. Poster notified new_referral_applicant",
                   f"before={poster_notif_before} after={poster_notif_after}")

        # =====================================================================
        # 3) POST /applications/{app_id}/accept
        # =====================================================================
        applicant_accept_before = await db.notifications.count_documents({
            "user_id": u2_id, "kind": "referral_application_accepted",
        })
        if app_id:
            try:
                r = await client.post(
                    f"{BASE}/referrals/{need_id}/applications/{app_id}/accept",
                    headers=u1_h,
                )
                if r.status_code == 200 and r.json().get("ok") is True:
                    passed("3. POST /accept by poster", f"body={r.json()}")
                else:
                    failed("3. POST /accept by poster", f"status={r.status_code} body={r.text[:200]}")
            except Exception as e:
                failed("3. POST /accept by poster", f"exception: {e}")
            await asyncio.sleep(1.0)
            applicant_accept_after = await db.notifications.count_documents({
                "user_id": u2_id, "kind": "referral_application_accepted",
            })
            if applicant_accept_after > applicant_accept_before:
                passed("3a. Applicant notified referral_application_accepted",
                       f"before={applicant_accept_before} after={applicant_accept_after}")
            else:
                failed("3a. Applicant notified referral_application_accepted",
                       f"before={applicant_accept_before} after={applicant_accept_after}")

        # =====================================================================
        # 4) POST /applications/{app_id}/reject — need fresh need+app since
        #    accept has flipped this need to 'filled' and auto-rejected others.
        # =====================================================================
        # Create a fresh need for the reject test
        r = await client.post(f"{BASE}/referrals", headers=u1_h, json={
            "title": "QA — reject test", "shoot_type": "portrait",
            "gig_type": "event_coverage", "city": "Austin", "state": "TX",
        })
        if r.status_code != 200:
            failed("4-prep. Create fresh need for reject test", f"status={r.status_code}")
            reject_need_id = None
        else:
            reject_need_id = r.json()["need_id"]
            # Apply with a different user — register a fresh one (U2 already applied to first need)
            u4_email = f"qa_applicant2_{stamp}@qatest.photoscout.app"
            u4_tok, u4_id = await register(client, u4_email, "demo1234", "QA Applicant2")
            u4_h = {"Authorization": f"Bearer {u4_tok}"}
            r = await client.post(f"{BASE}/referrals/{reject_need_id}/apply", headers=u4_h, json={"pitch": "testing reject"})
            if r.status_code == 200:
                reject_app_id = r.json().get("app_id")
                r = await client.post(
                    f"{BASE}/referrals/{reject_need_id}/applications/{reject_app_id}/reject",
                    headers=u1_h,
                )
                if r.status_code == 200 and r.json().get("ok") is True:
                    passed("4. POST /reject by poster", f"body={r.json()}")
                else:
                    failed("4. POST /reject by poster", f"status={r.status_code} body={r.text[:200]}")
            else:
                failed("4-prep. Apply to reject-need", f"status={r.status_code} body={r.text[:200]}")
                reject_app_id = None

        # =====================================================================
        # 5) PATCH /referrals/{need_id} with {status:"filled"}
        # =====================================================================
        if reject_need_id:
            try:
                r = await client.patch(f"{BASE}/referrals/{reject_need_id}", headers=u1_h,
                                       json={"status": "filled"})
                if r.status_code == 200 and r.json().get("status") == "filled":
                    passed("5. PATCH status=filled by poster (tests REFERRAL_STATUSES validator)",
                           f"status={r.json().get('status')}")
                else:
                    failed("5. PATCH status=filled by poster", f"status={r.status_code} body={r.text[:300]}")
            except Exception as e:
                failed("5. PATCH status=filled", f"exception: {e}")

            # Extra: test invalid status returns 422
            try:
                r = await client.patch(f"{BASE}/referrals/{reject_need_id}", headers=u1_h,
                                       json={"status": "BOGUS_INVALID"})
                if r.status_code == 422:
                    passed("5a. PATCH invalid status → 422 (not 500)", f"status={r.status_code}")
                else:
                    failed("5a. PATCH invalid status → 422", f"status={r.status_code} body={r.text[:200]}")
            except Exception as e:
                failed("5a. PATCH invalid status", f"exception: {e}")

        # =====================================================================
        # 7) Non-poster PATCH / DELETE → 403
        # =====================================================================
        if reject_need_id:
            try:
                r = await client.patch(f"{BASE}/referrals/{reject_need_id}", headers=u2_h,
                                       json={"notes": "hacking"})
                if r.status_code == 403:
                    passed("7a. Non-poster PATCH → 403", f"body={r.text[:100]}")
                else:
                    failed("7a. Non-poster PATCH → 403", f"status={r.status_code}")
            except Exception as e:
                failed("7a. Non-poster PATCH", f"exception: {e}")
            try:
                r = await client.delete(f"{BASE}/referrals/{reject_need_id}", headers=u2_h)
                if r.status_code == 403:
                    passed("7b. Non-poster DELETE → 403", f"body={r.text[:100]}")
                else:
                    failed("7b. Non-poster DELETE → 403", f"status={r.status_code}")
            except Exception as e:
                failed("7b. Non-poster DELETE", f"exception: {e}")

        # =====================================================================
        # 6) DELETE /referrals/{need_id} by poster
        # =====================================================================
        if reject_need_id:
            try:
                r = await client.delete(f"{BASE}/referrals/{reject_need_id}", headers=u1_h)
                if r.status_code == 200 and r.json().get("ok") is True:
                    passed("6. DELETE by poster", f"body={r.json()}")
                else:
                    failed("6. DELETE by poster", f"status={r.status_code} body={r.text[:200]}")
            except Exception as e:
                failed("6. DELETE by poster", f"exception: {e}")

        # Also delete the original (first) need as part of cleanup + test
        try:
            r = await client.delete(f"{BASE}/referrals/{need_id}", headers=u1_h)
            # status 200 expected
        except Exception:
            pass

        # =====================================================================
        # 8) Apply cap — U2 posts 5 referrals as U1, U2 applies to 5 of them,
        #    6th → 400/402 'Application cap reached'-style
        # =====================================================================
        # U2 is free-tier. Need to clear any existing apps from this month first.
        await db.referral_applications.delete_many({"applicant_user_id": u2_id})

        cap_need_ids = []
        for i in range(6):
            r = await client.post(f"{BASE}/referrals", headers=u1_h, json={
                "title": f"QA cap-test need {i} {stamp}",
                "shoot_type": "portrait",
                "gig_type": "event_coverage",
                "city": "Dallas",  # Different city so U3 doesn't get blasted again
                "state": "TX",
            })
            if r.status_code == 200:
                cap_need_ids.append(r.json()["need_id"])
            else:
                print(f"  WARN: failed to create cap-test need {i}: {r.status_code}")

        cap_responses = []
        for i, nid in enumerate(cap_need_ids):
            r = await client.post(f"{BASE}/referrals/{nid}/apply", headers=u2_h, json={"pitch": f"app {i}"})
            cap_responses.append((nid, r.status_code, r.text[:150] if r.status_code >= 400 else ""))

        # First 5 should be 200, 6th should be 400 or 402 (cap reached)
        pass_count = sum(1 for (_, s, _) in cap_responses[:5] if s == 200)
        last_status = cap_responses[5][1] if len(cap_responses) >= 6 else None
        last_body = cap_responses[5][2] if len(cap_responses) >= 6 else ""
        if pass_count == 5 and last_status in (400, 402) and (
            "cap" in last_body.lower() or "limit" in last_body.lower() or "upgrade" in last_body.lower()
        ):
            passed("8. Apply cap — 5 pass, 6th → 400/402 with cap message",
                   f"first 5 status codes=[{','.join(str(s) for (_,s,_) in cap_responses[:5])}] 6th={last_status} body={last_body[:100]}")
        else:
            failed("8. Apply cap",
                   f"first 5 status codes=[{','.join(str(s) for (_,s,_) in cap_responses[:5])}] 6th={last_status} body={last_body[:200]}")

        # CLEANUP — soft delete (DELETE) all test referrals
        print("\n[cleanup] Deleting test referrals + throwaway data...")
        for nid in cap_need_ids:
            try:
                await client.delete(f"{BASE}/referrals/{nid}", headers=u1_h)
            except Exception:
                pass
        # Wipe all test data from Mongo
        await db.referral_needs.delete_many({"poster_user_id": u1_id})
        await db.referral_applications.delete_many({"applicant_user_id": {"$in": [u2_id]}})
        # Delete test users' dm threads / push_log / notifications / users
        for uid in [u1_id, u2_id, u3_id]:
            await db.users.delete_one({"user_id": uid})
            await db.notifications.delete_many({"user_id": uid})
            await db.push_log.delete_many({"user_id": uid})
            await db.dm_participants.delete_many({"user_id": uid})
            await db.dm_requests.delete_many({"from_user_id": uid})
            await db.dm_requests.delete_many({"to_user_id": uid})
        if thread_id:
            await db.dm_threads.delete_one({"thread_id": thread_id})
            await db.dm_messages.delete_many({"thread_id": thread_id})
        # ------------------------------
        total = len(results)
        n_pass = sum(1 for r in results if r[0] == "PASS")
        n_fail = total - n_pass
        print("\n" + "=" * 70)
        print(f"TOTAL: {total} checks. {n_pass} PASS / {n_fail} FAIL.")
        print("=" * 70)
        if n_fail:
            for (s, name, info) in results:
                if s == "FAIL":
                    print(f"❌ {name}: {info}")
        sys.exit(0 if n_fail == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())
