"""
Backend test — Explore Speed CR Batch 1 RETEST after route-order fix.

Validates:
  1. /api/spots/markers basic shape + bbox filter + shoot_type + auth
  2. Regression: /api/spots paginated + sort=distance + check-duplicates
  3. /api/spots/{id} still works (not eaten by /markers)
  4. /api/auth/me, /api/feed/home still 200
"""
import asyncio
import sys
import httpx

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASS = "Grayson@1117!!"

passed = 0
failed = 0


def ok(msg):
    global passed
    passed += 1
    print(f"  ✅ {msg}")


def bad(msg):
    global failed
    failed += 1
    print(f"  ❌ {msg}")


async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=60.0) as client:
        # ── Login admin ────────────────────────────────────
        print("\n── Auth setup ──")
        r = await client.post("/auth/login",
                              json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
        if r.status_code != 200:
            bad(f"Admin login failed: {r.status_code} {r.text[:200]}")
            return
        token = r.json().get("token")
        admin_h = {"Authorization": f"Bearer {token}"}
        ok(f"Admin login → token len={len(token or '')}")

        # ──────────────────────────────────────────────────
        # SECTION 1: /api/spots/markers basic shape
        # ──────────────────────────────────────────────────
        print("\n── SECTION 1: /api/spots/markers basic shape ──")
        r = await client.get("/spots/markers", params={"limit": 20})
        if r.status_code != 200:
            bad(f"GET /spots/markers?limit=20 → {r.status_code} {r.text[:300]}")
        else:
            ok("GET /spots/markers?limit=20 → 200")
            body = r.json()
            if isinstance(body, dict) and "items" in body and "count" in body:
                ok(f"Response shape: {{items: list, count: int}}, count={body['count']}")
            else:
                bad(f"Response shape wrong: keys={list(body.keys()) if isinstance(body, dict) else type(body)}")

            ALLOWED = {"spot_id", "title", "lat", "lng", "category",
                       "shoot_types", "is_premium", "is_hidden_gem",
                       "score", "thumb_url"}
            BANNED = {"description", "images", "comments", "owner",
                      "owner_user_id", "reviews", "checkins"}
            items = body.get("items") or []
            if not items:
                bad("items is empty — cannot validate field shape")
            else:
                # Check first item's keys
                sample = items[0]
                actual = set(sample.keys())
                extras = actual - ALLOWED
                missing = ALLOWED - actual
                if extras:
                    bad(f"Markers item has UNEXPECTED keys: {extras}")
                else:
                    ok(f"Marker item keys ⊂ allowed set ({len(actual)} keys)")
                if missing:
                    bad(f"Markers item missing required keys: {missing}")
                else:
                    ok("All required marker keys present")
                # Banned keys check across all items
                banned_seen = set()
                for it in items:
                    banned_seen |= (set(it.keys()) & BANNED)
                if banned_seen:
                    bad(f"Banned keys found in markers: {banned_seen}")
                else:
                    ok("No banned keys (description/images/comments/owner) in markers")
                # lat/lng numeric
                non_numeric = [i for i in items
                               if not isinstance(i.get("lat"), (int, float))
                               or not isinstance(i.get("lng"), (int, float))]
                if non_numeric:
                    bad(f"{len(non_numeric)} item(s) with non-numeric lat/lng")
                else:
                    ok(f"All {len(items)} items have numeric lat/lng")

        # ──────────────────────────────────────────────────
        # SECTION 2: bbox filter
        # ──────────────────────────────────────────────────
        print("\n── SECTION 2: /api/spots/markers bbox filter ──")
        bbox_params = {
            "sw_lat": 29, "sw_lng": -99,
            "ne_lat": 31, "ne_lng": -97,
            "limit": 200,
        }
        r = await client.get("/spots/markers", params=bbox_params)
        if r.status_code != 200:
            bad(f"GET /spots/markers (bbox) → {r.status_code}")
        else:
            ok(f"GET /spots/markers (bbox 29..31, -99..-97) → 200")
            body = r.json()
            items = body.get("items", [])
            ok(f"  bbox returned {len(items)} markers (count={body.get('count')})")
            out_of_range = []
            for it in items:
                lat = it.get("lat")
                lng = it.get("lng")
                if lat is None or lng is None:
                    out_of_range.append(("missing", it.get("spot_id")))
                    continue
                if not (29 <= lat <= 31) or not (-99 <= lng <= -97):
                    out_of_range.append((lat, lng, it.get("spot_id")))
            if out_of_range:
                bad(f"{len(out_of_range)} markers outside bbox: sample={out_of_range[:3]}")
            else:
                ok(f"All {len(items)} markers within bbox lat∈[29,31], lng∈[-99,-97]")

        # ──────────────────────────────────────────────────
        # SECTION 3: shoot_type filter
        # ──────────────────────────────────────────────────
        print("\n── SECTION 3: /api/spots/markers shoot_type=wedding ──")
        r = await client.get("/spots/markers",
                             params={"shoot_type": "wedding", "limit": 50})
        if r.status_code != 200:
            bad(f"GET /spots/markers?shoot_type=wedding → {r.status_code}")
        else:
            ok("GET /spots/markers?shoot_type=wedding → 200")
            body = r.json()
            items = body.get("items", [])
            ok(f"  shoot_type=wedding returned {len(items)} markers")
            mismatched = [it for it in items
                          if "wedding" not in (it.get("shoot_types") or [])]
            if mismatched:
                bad(f"{len(mismatched)} markers don't have 'wedding' in shoot_types: "
                    f"sample={[(m.get('spot_id'), m.get('shoot_types')) for m in mismatched[:3]]}")
            else:
                ok(f"All {len(items)} markers tagged with 'wedding'")

        # ──────────────────────────────────────────────────
        # SECTION 4: auth — markers works for both unauth and admin
        # ──────────────────────────────────────────────────
        print("\n── SECTION 4: /api/spots/markers auth matrix ──")
        r = await client.get("/spots/markers", params={"limit": 5})
        if r.status_code == 200:
            ok(f"Unauth GET /spots/markers → 200 (count={r.json().get('count')})")
        else:
            bad(f"Unauth GET /spots/markers → {r.status_code}")
        r = await client.get("/spots/markers", params={"limit": 5}, headers=admin_h)
        if r.status_code == 200:
            ok(f"Admin GET /spots/markers → 200 (count={r.json().get('count')})")
        else:
            bad(f"Admin GET /spots/markers → {r.status_code}")

        # ──────────────────────────────────────────────────
        # SECTION 5: regression — /api/spots paginated
        # ──────────────────────────────────────────────────
        print("\n── SECTION 5: regression /api/spots paginated ──")
        r = await client.get("/spots", params={"paginated": 1, "limit": 5, "cursor": 0})
        if r.status_code != 200:
            bad(f"GET /spots?paginated=1&limit=5&cursor=0 → {r.status_code}")
        else:
            body = r.json()
            if isinstance(body, dict):
                expected = {"items", "next_cursor", "total_estimate", "limit"}
                if expected.issubset(set(body.keys())):
                    ok(f"Wrapped pagination shape OK: items={len(body.get('items', []))}, "
                       f"next_cursor={body.get('next_cursor')}, "
                       f"total_estimate={body.get('total_estimate')}, limit={body.get('limit')}")
                else:
                    bad(f"Pagination shape missing keys: have={set(body.keys())}")
            else:
                bad(f"Expected dict, got {type(body)}")

        # ──────────────────────────────────────────────────
        # SECTION 6: regression — sort=distance with lat/lng
        # ──────────────────────────────────────────────────
        print("\n── SECTION 6: regression /api/spots?sort=distance ──")
        r = await client.get("/spots", params={
            "sort": "distance", "lat": 30.2672, "lng": -97.7431, "limit": 10
        })
        if r.status_code != 200:
            bad(f"GET /spots?sort=distance → {r.status_code}")
        else:
            ok("GET /spots?sort=distance&lat=30.2672&lng=-97.7431 → 200")
            data = r.json()
            items = data if isinstance(data, list) else data.get("items", [])
            distances = [s.get("distance_mi") for s in items if s.get("distance_mi") is not None]
            if not distances:
                bad("No distance_mi values present")
            else:
                ok(f"  {len(distances)} items with distance_mi, sample={distances[:5]}")
                if all(distances[i] <= distances[i+1] for i in range(len(distances)-1)):
                    ok("distance_mi monotonically non-decreasing (ascending sort)")
                else:
                    bad(f"distance_mi not sorted ascending: {distances}")

        # ──────────────────────────────────────────────────
        # SECTION 7: regression — /api/spots/check-duplicates
        # ──────────────────────────────────────────────────
        print("\n── SECTION 7: regression /api/spots/check-duplicates ──")
        r = await client.get("/spots/check-duplicates",
                             params={"latitude": 30.2672, "longitude": -97.7431})
        if r.status_code != 200:
            bad(f"GET /spots/check-duplicates → {r.status_code} {r.text[:200]}")
        else:
            body = r.json()
            ok(f"GET /spots/check-duplicates → 200 (count={body.get('count')}, "
               f"candidates_returned={len(body.get('candidates', []))})")

        # ──────────────────────────────────────────────────
        # SECTION 8: regression — /api/spots/{spot_id} for real spot
        # ──────────────────────────────────────────────────
        print("\n── SECTION 8: regression /api/spots/{spot_id} ──")
        # Get a real spot_id from the markers endpoint
        r0 = await client.get("/spots/markers", params={"limit": 1})
        real_id = None
        if r0.status_code == 200:
            items = r0.json().get("items", [])
            if items:
                real_id = items[0].get("spot_id")
        if real_id:
            r = await client.get(f"/spots/{real_id}")
            if r.status_code == 200:
                body = r.json()
                ok(f"GET /spots/{real_id} → 200, title='{(body.get('title') or '')[:40]}'")
                if body.get("spot_id") == real_id:
                    ok("  spot_id matches (route NOT eaten by /markers)")
                else:
                    bad(f"  spot_id mismatch in response: {body.get('spot_id')}")
            else:
                bad(f"GET /spots/{real_id} → {r.status_code}")
        else:
            bad("Could not pick a real spot_id from markers")

        # Also confirm a clearly invalid spot_id still returns 404
        r = await client.get("/spots/spot_definitely_not_real_xyz")
        if r.status_code == 404:
            ok("GET /spots/{nonexistent} → 404 (correct)")
        else:
            bad(f"GET /spots/{{nonexistent}} → {r.status_code} (expected 404)")

        # ──────────────────────────────────────────────────
        # SECTION 9: regression /api/auth/me + /api/feed/home
        # ──────────────────────────────────────────────────
        print("\n── SECTION 9: regression /auth/me + /feed/home ──")
        r = await client.get("/auth/me", headers=admin_h)
        if r.status_code == 200:
            ok(f"GET /auth/me → 200, user_id={r.json().get('user_id')}")
        else:
            bad(f"GET /auth/me → {r.status_code}")
        r = await client.get("/feed/home", headers=admin_h)
        if r.status_code == 200:
            ok(f"GET /feed/home → 200")
        else:
            bad(f"GET /feed/home → {r.status_code} {r.text[:200]}")

        # ──────────────────────────────────────────────────
        # Summary
        # ──────────────────────────────────────────────────
        print(f"\n{'='*60}")
        print(f"SUMMARY: {passed} passed / {failed} failed")
        print(f"{'='*60}")
        return failed


if __name__ == "__main__":
    rc = asyncio.run(main())
    sys.exit(0 if rc == 0 else 1)
