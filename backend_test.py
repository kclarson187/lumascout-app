"""
Backend test — DELETE /api/admin/spots/{spot_id}/images/{image_id}
Batch #4 item #2 (May 2026).

Covers:
  1. Authorization (401 no auth, 403 regular user, 200 super_admin)
  2. Happy path non-cover delete
  3. Cover-photo deletion with auto-promote
  4. Last-photo deletion
  5. Error cases (404 spot, 404 image)
  6. Audit-log shape

After test: restores any images deleted on the target spot by writing the
original images[] array directly to MongoDB, so production/seed data isn't
corrupted.
"""
import os
import sys
import asyncio
import uuid
from copy import deepcopy
from typing import Any, Dict, List, Tuple

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("LUMASCOUT_BASE_URL", "http://localhost:8001")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
INFO = "\033[94mINFO\033[0m"

results: List[Tuple[str, bool, str]] = []

def record(name: str, ok: bool, detail: str = ""):
    results.append((name, ok, detail))
    tag = PASS if ok else FAIL
    print(f"  [{tag}] {name}" + (f" — {detail}" if detail else ""))


def section(title: str):
    print(f"\n=== {title} ===")


async def main():
    async with httpx.AsyncClient(timeout=30) as http:
        section("Setup — admin login")
        r = await http.post(
            f"{API}/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        )
        if r.status_code != 200:
            print(f"  [{FAIL}] admin login returned {r.status_code}: {r.text}")
            return
        admin_payload = r.json()
        admin_token = admin_payload["token"]
        admin_user_id = admin_payload["user"]["user_id"]
        admin_role = admin_payload["user"]["role"]
        record("admin login", True, f"user_id={admin_user_id} role={admin_role}")
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        section("Setup — register throwaway free user")
        sfx = uuid.uuid4().hex[:8]
        user_email = f"photo_qa_{sfx}@lumascout-qa.com"
        r = await http.post(
            f"{API}/auth/register",
            json={
                "email": user_email,
                "password": "UserPass_1117!!",
                "name": "QA Photo Deleter",
                "specialties": [],
            },
        )
        if r.status_code != 200:
            record("register free user", False, f"{r.status_code} {r.text[:200]}")
            return
        user_token = r.json()["token"]
        user_id = r.json()["user"]["user_id"]
        record("register free user", True, f"user_id={user_id} role={r.json()['user']['role']}")
        user_headers = {"Authorization": f"Bearer {user_token}"}

        section("Setup — locate candidate spot with >=2 images")
        r = await http.get(f"{API}/spots?limit=50", headers=admin_headers)
        if r.status_code != 200:
            record("GET /spots", False, f"{r.status_code}")
            return
        raw = r.json()
        if isinstance(raw, dict):
            spots = raw.get("items") or raw.get("spots") or []
        else:
            spots = raw

        def img_count(s):
            return len([i for i in (s.get("images") or []) if isinstance(i, dict) and i.get("image_url")])

        candidates = [s for s in spots if img_count(s) >= 2]
        if not candidates:
            record("locate candidate", False, "no spots with >=2 images in first 50")
            return
        candidates.sort(key=img_count)
        target = candidates[0]
        spot_id = target["spot_id"]
        record("candidate spot chosen", True,
               f"spot_id={spot_id} title={target.get('title')!r} images={img_count(target)}")

        mongo_client = AsyncIOMotorClient(MONGO_URL)
        db = mongo_client[DB_NAME]
        original = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
        if not original:
            record("mongo snapshot", False, "spot not found in mongo")
            return
        original_images = deepcopy(original.get("images") or [])
        original_hero = original.get("hero_cover_image_url")
        original_override = deepcopy(original.get("admin_cover_override"))
        record("mongo snapshot", True,
               f"images={len(original_images)} hero={bool(original_hero)} override={bool(original_override)}")

        if len(original_images) < 2:
            record("image count sanity", False, f"only {len(original_images)} images in mongo doc")
            await mongo_client.close()
            return

        for i, im in enumerate(original_images):
            if isinstance(im, dict):
                print(f"  [{INFO}] image[{i}] id={im.get('image_id')!r} url={str(im.get('image_url'))[:70]!r} is_cover={im.get('is_cover')}")

        # ================================================================
        # 1. AUTHORIZATION
        # ================================================================
        section("1. Authorization")
        r = await http.delete(f"{API}/admin/spots/{spot_id}/images/nonexistent_image_guard")
        record("1a 401 without Authorization header", r.status_code in (401, 403),
               f"status={r.status_code}")

        r = await http.delete(
            f"{API}/admin/spots/{spot_id}/images/nonexistent_image_guard",
            headers=user_headers,
        )
        record("1b 403 with regular user token", r.status_code == 403,
               f"status={r.status_code} body={r.text[:120]}")

        # ================================================================
        # 2. HAPPY PATH — delete second image (non-cover)
        # ================================================================
        section("2. Happy path — delete non-cover photo (second image)")
        r = await http.get(f"{API}/spots/{spot_id}", headers=admin_headers)
        if r.status_code != 200:
            record("GET /spots/{id}", False, f"{r.status_code}")
            await mongo_client.close()
            return
        detail = r.json()
        images_before = detail.get("images") or []
        if len(images_before) < 2:
            record("image-count precondition", False,
                   f"/spots/{spot_id} returned {len(images_before)} images")
            await mongo_client.close()
            return

        target_img2 = images_before[1]
        image_id_to_delete = target_img2.get("image_id") or target_img2.get("image_url")
        expected_url = target_img2.get("image_url")
        print(f"  [{INFO}] deleting image_id={image_id_to_delete!r} (url={str(expected_url)[:70]})")

        r = await http.delete(
            f"{API}/admin/spots/{spot_id}/images/{image_id_to_delete}",
            headers=admin_headers,
        )
        ok = r.status_code == 200
        record("2a DELETE returns 200", ok, f"status={r.status_code} body={r.text[:250]}")
        if ok:
            body = r.json()
            record("2b body.ok == true", body.get("ok") is True)
            removed = body.get("removed") or {}
            record("2c body.removed.image_url matches deleted",
                   removed.get("image_url") == expected_url,
                   f"got {str(removed.get('image_url'))[:60]!r}")
            record("2d body.remaining_count == len-1",
                   body.get("remaining_count") == len(images_before) - 1,
                   f"got {body.get('remaining_count')} expected {len(images_before) - 1}")
            record("2e body.new_cover_image_url is None (non-cover delete)",
                   body.get("new_cover_image_url") is None,
                   f"got {body.get('new_cover_image_url')!r}")

            r2 = await http.get(f"{API}/spots/{spot_id}", headers=admin_headers)
            after = r2.json()
            images_after = after.get("images") or []
            record("2f /spots/{id} image count decreased",
                   len(images_after) == len(images_before) - 1,
                   f"before={len(images_before)} after={len(images_after)}")
            prev_cover = detail.get("hero_cover_image_url")
            new_cover = after.get("hero_cover_image_url")
            record("2g hero_cover_image_url unchanged", prev_cover == new_cover,
                   f"before={str(prev_cover)[:60]} after={str(new_cover)[:60]}")

        # ================================================================
        # 3. COVER deletion — auto-promote
        # ================================================================
        section("3. Cover-photo deletion — auto-promote next")
        r = await http.get(f"{API}/spots/{spot_id}", headers=admin_headers)
        detail3 = r.json()
        images3 = detail3.get("images") or []
        if len(images3) < 2:
            print(f"  [{INFO}] only {len(images3)} images, restoring to run scenario 3")
            await db.spots.update_one(
                {"spot_id": spot_id},
                {"$set": {
                    "images": deepcopy(original_images),
                    **({"hero_cover_image_url": original_hero} if original_hero else {}),
                    **({"admin_cover_override": original_override} if original_override else {}),
                }},
            )
            r = await http.get(f"{API}/spots/{spot_id}", headers=admin_headers)
            detail3 = r.json()
            images3 = detail3.get("images") or []

        if len(images3) < 2:
            record("3 precondition — 2+ images", False, f"have {len(images3)}")
        else:
            first = images3[0]
            second = images3[1]
            first_img_id = first.get("image_id") or first.get("image_url")
            expected_promoted_url = second.get("image_url")
            print(f"  [{INFO}] deleting cover image_id={first_img_id!r}")
            print(f"  [{INFO}] expecting new_cover={str(expected_promoted_url)[:70]}")

            r = await http.delete(
                f"{API}/admin/spots/{spot_id}/images/{first_img_id}",
                headers=admin_headers,
            )
            record("3a DELETE returns 200", r.status_code == 200,
                   f"status={r.status_code} body={r.text[:250]}")
            if r.status_code == 200:
                body = r.json()
                record("3b new_cover_image_url NOT null",
                       body.get("new_cover_image_url") is not None,
                       f"got {str(body.get('new_cover_image_url'))[:60]!r}")
                record("3c new_cover_image_url == previous second image url",
                       body.get("new_cover_image_url") == expected_promoted_url,
                       f"got {str(body.get('new_cover_image_url'))[:60]}")

                r2 = await http.get(f"{API}/spots/{spot_id}", headers=admin_headers)
                after3 = r2.json()
                record("3d GET hero_cover_image_url updated to promoted",
                       after3.get("hero_cover_image_url") == expected_promoted_url,
                       f"got {str(after3.get('hero_cover_image_url'))[:60]}")

        # ================================================================
        # 4. LAST-PHOTO deletion
        # ================================================================
        section("4. Last-photo deletion")
        # Drain to 1.
        while True:
            r = await http.get(f"{API}/spots/{spot_id}", headers=admin_headers)
            images_now = r.json().get("images") or []
            if len(images_now) <= 1:
                break
            img = images_now[0]
            imid = img.get("image_id") or img.get("image_url")
            rr = await http.delete(
                f"{API}/admin/spots/{spot_id}/images/{imid}",
                headers=admin_headers,
            )
            if rr.status_code != 200:
                record("4 intermediate delete", False,
                       f"status={rr.status_code} body={rr.text[:120]}")
                break

        r = await http.get(f"{API}/spots/{spot_id}", headers=admin_headers)
        images_last = r.json().get("images") or []
        if len(images_last) != 1:
            record("4 precondition exactly 1 image remains", False,
                   f"have {len(images_last)}")
        else:
            final = images_last[0]
            fid = final.get("image_id") or final.get("image_url")
            r = await http.delete(
                f"{API}/admin/spots/{spot_id}/images/{fid}",
                headers=admin_headers,
            )
            record("4a DELETE final returns 200", r.status_code == 200,
                   f"status={r.status_code}")
            if r.status_code == 200:
                body = r.json()
                record("4b body.ok==true and remaining_count==0",
                       body.get("ok") is True and body.get("remaining_count") == 0,
                       f"ok={body.get('ok')} remaining={body.get('remaining_count')}")
                record("4c body.new_cover_image_url is None",
                       body.get("new_cover_image_url") is None,
                       f"got {body.get('new_cover_image_url')!r}")

                r2 = await http.get(f"{API}/spots/{spot_id}", headers=admin_headers)
                after4 = r2.json()
                record("4d GET images is empty",
                       len(after4.get("images") or []) == 0,
                       f"got {len(after4.get('images') or [])} images")
                hero4 = after4.get("hero_cover_image_url")
                record("4e hero_cover_image_url null/empty", hero4 in (None, ""),
                       f"got {hero4!r}")

        # ================================================================
        # 5. ERROR CASES
        # ================================================================
        section("5. Error cases")
        r = await http.delete(
            f"{API}/admin/spots/spot_does_not_exist_xyz/images/anything",
            headers=admin_headers,
        )
        record("5a 404 for bogus spot_id", r.status_code == 404,
               f"status={r.status_code} body={r.text[:150]}")

        other = next((s for s in spots if s["spot_id"] != spot_id and img_count(s) >= 1), None)
        if other:
            r = await http.delete(
                f"{API}/admin/spots/{other['spot_id']}/images/nonexistent_image_999",
                headers=admin_headers,
            )
            record("5b 404 for real spot_id + bogus image_id", r.status_code == 404,
                   f"status={r.status_code} body={r.text[:150]}")
        else:
            record("5b 404 for real spot + bogus image_id", False, "no second spot available")

        # ================================================================
        # 6. AUDIT LOG
        # ================================================================
        section("6. Audit log")
        r = await http.get(
            f"{API}/admin/audit-logs?action=spot.photo.delete&limit=10",
            headers=admin_headers,
        )
        record("6a GET /admin/audit-logs 200", r.status_code == 200,
               f"status={r.status_code}")
        if r.status_code == 200:
            entries = r.json().get("items") or []
            record("6b audit entries returned", len(entries) > 0,
                   f"count={len(entries)}")
            if entries:
                latest = entries[0]
                print(f"  [{INFO}] latest audit keys: {list(latest.keys())}")
                print(f"  [{INFO}] latest before: {latest.get('before')}")
                print(f"  [{INFO}] latest after: {latest.get('after')}")
                record("6c action == spot.photo.delete",
                       latest.get("action") == "spot.photo.delete",
                       f"got {latest.get('action')!r}")
                record("6d admin_user_id matches",
                       latest.get("admin_user_id") == admin_user_id,
                       f"got {latest.get('admin_user_id')!r}")
                record("6e admin_email matches",
                       latest.get("admin_email") == ADMIN_EMAIL,
                       f"got {latest.get('admin_email')!r}")
                record("6f admin_role == super_admin",
                       latest.get("admin_role") == "super_admin",
                       f"got {latest.get('admin_role')!r}")
                before = latest.get("before") or {}
                after = latest.get("after") or {}
                record("6g before.image_url present",
                       bool(before.get("image_url")),
                       f"got {str(before.get('image_url'))[:60]!r}")
                record("6h before.was_cover is a bool",
                       isinstance(before.get("was_cover"), bool),
                       f"got {before.get('was_cover')!r}")
                record("6i after.remaining_count is int",
                       isinstance(after.get("remaining_count"), int),
                       f"got {after.get('remaining_count')!r}")
                record("6j after has new_cover_image_url key",
                       "new_cover_image_url" in after,
                       f"after keys={list(after.keys())}")

        # ================================================================
        # RESTORE
        # ================================================================
        section("Cleanup — restore original spot images via direct Mongo write")
        restore_doc: Dict[str, Any] = {"images": deepcopy(original_images)}
        unset_doc: Dict[str, Any] = {}
        if original_hero:
            restore_doc["hero_cover_image_url"] = original_hero
        else:
            unset_doc["hero_cover_image_url"] = ""
        if original_override:
            restore_doc["admin_cover_override"] = original_override
        else:
            unset_doc["admin_cover_override"] = ""
        ops: Dict[str, Any] = {"$set": restore_doc}
        if unset_doc:
            ops["$unset"] = unset_doc
        await db.spots.update_one({"spot_id": spot_id}, ops)

        r = await http.get(f"{API}/spots/{spot_id}", headers=admin_headers)
        final = r.json()
        record("RESTORE — image count back to original",
               len(final.get("images") or []) == len(original_images),
               f"got {len(final.get('images') or [])} expected {len(original_images)}")

        await mongo_client.close()

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n=== SUMMARY ===")
    print(f"{total - len(failed)} / {total} assertions passed")
    if failed:
        print("\nFAILURES:")
        for name, _, detail in failed:
            print(f"  - {name} :: {detail}")
        sys.exit(1)
    print("ALL GREEN")


if __name__ == "__main__":
    asyncio.run(main())
