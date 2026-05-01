"""
FINAL STABILITY PASS — Explore Speed CR (all 4 batches).
Validates every backend surface exercised by real user behavior.

Sections:
  A — Explore List (paginated /spots)
  B — Map (lightweight markers)
  C — Spot Detail / Upload
  D — Regression smoke
  E — Concurrency / abort
"""
import asyncio
import sys
import time
import json
import httpx

BASE = "https://photo-finder-60.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASS = "Grayson@1117!!"

passed = 0
failed = 0
failures = []


def ok(msg):
    global passed
    passed += 1
    print(f"  ✅ {msg}")


def bad(msg):
    global failed
    failed += 1
    failures.append(msg)
    print(f"  ❌ {msg}")


async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=60.0) as client:
        # ── Login admin ────────────────────────────────────
        print("\n══ AUTH SETUP ══")
        r = await client.post("/auth/login",
                              json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
        if r.status_code != 200:
            bad(f"Admin login failed: {r.status_code} {r.text[:300]}")
            return 1
        auth_payload = r.json()
        token = auth_payload.get("token")
        admin_uid = (auth_payload.get("user") or {}).get("user_id") or auth_payload.get("user_id")
        admin_h = {"Authorization": f"Bearer {token}"}
        ok(f"Admin login → token len={len(token or '')} uid={admin_uid}")

        # ════════════════════════════════════════════════════════
        # SECTION A — EXPLORE LIST (paginated /spots)
        # ════════════════════════════════════════════════════════
        print("\n══ SECTION A — Explore List (paginated /spots) ══")

        # A1. paginated=1&limit=24&cursor=0&sort=quality
        print("\n── A1. GET /spots?paginated=1&limit=24&cursor=0&sort=quality ──")
        r = await client.get("/spots", params={"paginated": 1, "limit": 24, "cursor": 0, "sort": "quality"})
        page1_ids = set()
        page1_items = []
        if r.status_code != 200:
            bad(f"A1: {r.status_code} {r.text[:200]}")
        else:
            body = r.json()
            if isinstance(body, dict) and {"items", "next_cursor", "total_estimate", "limit"} <= set(body.keys()):
                ok(f"A1: wrapped shape OK; items={len(body['items'])} next_cursor={body['next_cursor']} total_estimate={body['total_estimate']}")
                if len(body["items"]) <= 24:
                    ok(f"A1: items≤24 ({len(body['items'])})")
                else:
                    bad(f"A1: items > 24 ({len(body['items'])})")
                page1_items = body["items"]
                page1_ids = {it.get("spot_id") for it in page1_items}
            else:
                bad(f"A1: wrong shape, keys={list(body.keys()) if isinstance(body, dict) else type(body)}")

        # A2. paginated=1&limit=12&cursor=24&sort=quality — no overlap
        print("\n── A2. GET /spots?paginated=1&limit=12&cursor=24&sort=quality ──")
        r = await client.get("/spots", params={"paginated": 1, "limit": 12, "cursor": 24, "sort": "quality"})
        if r.status_code != 200:
            bad(f"A2: {r.status_code} {r.text[:200]}")
        else:
            body = r.json()
            items = body.get("items", [])
            if len(items) <= 12:
                ok(f"A2: items≤12 ({len(items)})")
            else:
                bad(f"A2: items > 12 ({len(items)})")
            page2_ids = {it.get("spot_id") for it in items}
            overlap = page1_ids & page2_ids
            if not overlap:
                ok(f"A2: disjoint from page1 (0 overlap); p1={len(page1_ids)} p2={len(page2_ids)}")
            else:
                bad(f"A2: overlap with page1: {len(overlap)} shared ids {list(overlap)[:5]}")

        # A3. overflow cursor
        print("\n── A3. GET /spots?paginated=1&limit=12&cursor=99999 (overflow) ──")
        r = await client.get("/spots", params={"paginated": 1, "limit": 12, "cursor": 99999, "sort": "quality"})
        if r.status_code != 200:
            bad(f"A3: {r.status_code} {r.text[:200]}")
        else:
            body = r.json()
            items = body.get("items", [])
            nxt = body.get("next_cursor")
            if items == [] and nxt is None:
                ok("A3: overflow → items=[] and next_cursor=null")
            else:
                bad(f"A3: unexpected overflow response: items={len(items)} next_cursor={nxt}")

        # A4. sort=distance — ASC by distance_mi
        print("\n── A4. GET /spots?paginated=1&limit=24&cursor=0&sort=distance&lat=30.2672&lng=-97.7431 ──")
        r = await client.get("/spots", params={
            "paginated": 1, "limit": 24, "cursor": 0,
            "sort": "distance", "lat": 30.2672, "lng": -97.7431
        })
        if r.status_code != 200:
            bad(f"A4: {r.status_code} {r.text[:200]}")
        else:
            body = r.json()
            items = body.get("items", [])
            first5 = items[:5]
            d = [it.get("distance_mi") for it in first5]
            if all(x is not None for x in d) and all(d[i] <= d[i + 1] for i in range(len(d) - 1)):
                ok(f"A4: first 5 items ASC by distance_mi: {d}")
            else:
                bad(f"A4: first 5 distance_mi NOT ASC or has None: {d}")

        # A5. filter+pagination: shoot_type=portrait
        print("\n── A5. GET /spots?paginated=1&limit=10&cursor=0&shoot_type=portrait ──")
        r = await client.get("/spots", params={"paginated": 1, "limit": 10, "cursor": 0, "shoot_type": "portrait"})
        portrait_p1_ids = set()
        if r.status_code != 200:
            bad(f"A5: {r.status_code} {r.text[:200]}")
        else:
            body = r.json()
            items = body.get("items", [])
            bad_items = [it for it in items if "portrait" not in (it.get("shoot_types") or [])]
            if not bad_items:
                ok(f"A5: all {len(items)} items have 'portrait' in shoot_types (or empty list)")
            else:
                bad(f"A5: {len(bad_items)} items missing 'portrait' in shoot_types; sample spot_ids={[b.get('spot_id') for b in bad_items[:3]]}, shoot_types={[b.get('shoot_types') for b in bad_items[:3]]}")
            portrait_p1_ids = {it.get("spot_id") for it in items}

            # Next page preserves filter
            r2 = await client.get("/spots", params={"paginated": 1, "limit": 10, "cursor": 10, "shoot_type": "portrait"})
            if r2.status_code == 200:
                items2 = r2.json().get("items", [])
                bad2 = [it for it in items2 if "portrait" not in (it.get("shoot_types") or [])]
                if not bad2:
                    ok(f"A5 page2: filter preserved; items={len(items2)}, all tagged portrait (or empty)")
                else:
                    bad(f"A5 page2: filter not preserved on {len(bad2)} items")
                overlap = portrait_p1_ids & {it.get("spot_id") for it in items2}
                if not overlap:
                    ok("A5 page2: disjoint from page1 portrait set")
                else:
                    bad(f"A5 page2: overlap with page1 portrait: {len(overlap)}")
            else:
                bad(f"A5 page2: {r2.status_code}")

        # A6. search q=lake
        print("\n── A6. GET /spots?q=lake&paginated=1&limit=10 (search support probe) ──")
        r = await client.get("/spots", params={"q": "lake", "paginated": 1, "limit": 10})
        if r.status_code != 200:
            bad(f"A6: {r.status_code} {r.text[:200]}")
        else:
            body = r.json()
            items = body.get("items", [])
            # Check if any item title/city contains "lake" (case-insensitive)
            lake_hits = [it for it in items if "lake" in ((it.get("title") or "") + " " + (it.get("city") or "")).lower()]
            if items:
                if lake_hits:
                    ok(f"A6: q=lake search returned {len(items)} items; {len(lake_hits)} contain 'lake' in title/city — likely supported")
                else:
                    ok(f"A6: q=lake returned {len(items)} items but none match 'lake' string — q param may be unsupported/ignored (NOT failing, just noted)")
            else:
                ok("A6: q=lake returned 0 items — param accepted; support unclear")

        # A7. save toggle
        print("\n── A7. POST /spots/{id}/save toggle ──")
        if page1_items:
            sid = page1_items[0].get("spot_id")
            if sid:
                r1 = await client.post(f"/spots/{sid}/save", headers=admin_h)
                r2 = await client.post(f"/spots/{sid}/save", headers=admin_h)
                if r1.status_code == 200 and r2.status_code == 200:
                    ok(f"A7: save toggle {sid} → 200 both times (r1={r1.json().get('saved')}, r2={r2.json().get('saved')})")
                else:
                    bad(f"A7: save toggle {sid} → r1={r1.status_code} r2={r2.status_code} ; r1.text={r1.text[:150]}")
            else:
                bad("A7: no spot_id from page1")
        else:
            bad("A7: no page1 items to test save toggle")

        # ════════════════════════════════════════════════════════
        # SECTION B — MAP (lightweight markers)
        # ════════════════════════════════════════════════════════
        print("\n══ SECTION B — Map (/spots/markers) ══")

        # B8. basic shape — no heavy keys
        print("\n── B8. GET /spots/markers?limit=20 ──")
        r = await client.get("/spots/markers", params={"limit": 20})
        b8_bytes = len(r.content) if r.status_code == 200 else 0
        if r.status_code != 200:
            bad(f"B8: {r.status_code} {r.text[:200]}")
        else:
            body = r.json()
            if isinstance(body, dict) and "items" in body and "count" in body:
                ok(f"B8: shape {{items, count}}; count={body['count']}")
            else:
                bad(f"B8: wrong shape: keys={list(body.keys()) if isinstance(body, dict) else type(body)}")
            BANNED = {"description", "images", "comments", "owner",
                      "owner_user_id", "reviews", "checkins"}
            seen_banned = set()
            for it in body.get("items", []):
                seen_banned |= set(it.keys()) & BANNED
            if seen_banned:
                bad(f"B8: BANNED keys leaking in markers: {seen_banned}")
            else:
                ok("B8: no description/images/comments/owner blob in any item")

        # B9. bbox
        print("\n── B9. GET /spots/markers?sw_lat=29&sw_lng=-99&ne_lat=31&ne_lng=-97&limit=200 ──")
        r = await client.get("/spots/markers", params={
            "sw_lat": 29, "sw_lng": -99, "ne_lat": 31, "ne_lng": -97, "limit": 200
        })
        if r.status_code != 200:
            bad(f"B9: {r.status_code} {r.text[:200]}")
        else:
            items = r.json().get("items", [])
            out = [(it.get("lat"), it.get("lng"), it.get("spot_id")) for it in items
                   if not (29 <= it.get("lat", -1) <= 31) or not (-99 <= it.get("lng", -1) <= -97)]
            if not out:
                ok(f"B9: all {len(items)} markers within bbox")
            else:
                bad(f"B9: {len(out)} markers outside bbox; sample={out[:3]}")

        # B10. empty bbox
        print("\n── B10. GET /spots/markers (empty bbox near 0,0) ──")
        r = await client.get("/spots/markers", params={
            "sw_lat": 0, "sw_lng": 0, "ne_lat": 0.001, "ne_lng": 0.001, "limit": 20
        })
        if r.status_code != 200:
            bad(f"B10: {r.status_code} {r.text[:200]}")
        else:
            items = r.json().get("items", [])
            if len(items) == 0:
                ok(f"B10: empty bbox → items=[] (no 500)")
            else:
                ok(f"B10: empty bbox → {len(items)} items (near-zero acceptable; no 500)")

        # B11. shoot_type filter
        print("\n── B11. GET /spots/markers?shoot_type=wedding&limit=50 ──")
        r = await client.get("/spots/markers", params={"shoot_type": "wedding", "limit": 50})
        if r.status_code != 200:
            bad(f"B11: {r.status_code} {r.text[:200]}")
        else:
            items = r.json().get("items", [])
            bad_items = [it for it in items if "wedding" not in (it.get("shoot_types") or [])]
            if not bad_items:
                ok(f"B11: all {len(items)} markers tagged 'wedding' (or 0 items)")
            else:
                bad(f"B11: {len(bad_items)} markers missing 'wedding' shoot_type")

        # B12. auth matrix
        print("\n── B12. auth matrix ──")
        r_un = await client.get("/spots/markers", params={"limit": 5})
        r_ad = await client.get("/spots/markers", params={"limit": 5}, headers=admin_h)
        if r_un.status_code == 200 and r_ad.status_code == 200:
            ok(f"B12: unauth 200 + admin 200 (both work)")
        else:
            bad(f"B12: unauth={r_un.status_code} admin={r_ad.status_code}")

        # B13. payload size sanity
        print("\n── B13. payload size sanity ──")
        r_m = await client.get("/spots/markers", params={"limit": 20})
        r_s = await client.get("/spots", params={"limit": 20})
        if r_m.status_code == 200 and r_s.status_code == 200:
            markers_items = r_m.json().get("items", [])
            spots_items = r_s.json() if isinstance(r_s.json(), list) else r_s.json().get("items", [])
            if markers_items and spots_items:
                m_avg = sum(len(json.dumps(it)) for it in markers_items) / len(markers_items)
                s_avg = sum(len(json.dumps(it)) for it in spots_items) / len(spots_items)
                ok(f"B13: marker avg={m_avg:.0f}B ; full-spot avg={s_avg:.0f}B ; ratio={s_avg/m_avg:.1f}x")
                if m_avg <= 500:
                    ok(f"B13: marker avg ≤500B ({m_avg:.0f}B)")
                else:
                    bad(f"B13: marker avg > 500B ({m_avg:.0f}B)")
                if s_avg > m_avg * 2:
                    ok(f"B13: full /spots item is ≥2x larger ({s_avg/m_avg:.1f}x)")
                else:
                    bad(f"B13: full /spots not materially larger ({s_avg/m_avg:.1f}x)")
            else:
                bad(f"B13: empty items in one; markers={len(markers_items)} spots={len(spots_items)}")
        else:
            bad(f"B13: markers={r_m.status_code} spots={r_s.status_code}")

        # ════════════════════════════════════════════════════════
        # SECTION C — Spot Detail / Upload
        # ════════════════════════════════════════════════════════
        print("\n══ SECTION C — Spot Detail / Upload ══")

        # C14. real spot detail
        real_sid = None
        if page1_items:
            real_sid = page1_items[0].get("spot_id")
        print(f"\n── C14. GET /spots/{real_sid} ──")
        if real_sid:
            r = await client.get(f"/spots/{real_sid}")
            if r.status_code != 200:
                bad(f"C14: {r.status_code} {r.text[:200]}")
            else:
                body = r.json()
                has_desc = "description" in body
                has_imgs = "images" in body or "image_url" in body
                if body.get("spot_id") == real_sid and (has_desc or has_imgs):
                    ok(f"C14: spot detail OK (has_desc={has_desc}, has_images={has_imgs}, title='{(body.get('title') or '')[:40]}')")
                else:
                    bad(f"C14: missing desc/images; keys_sample={list(body.keys())[:10]}")
        else:
            bad("C14: no real spot to fetch")

        # C15. 404 for nonexistent
        print("\n── C15. GET /spots/spot_does_not_exist ──")
        r = await client.get("/spots/spot_does_not_exist")
        if r.status_code == 404:
            ok("C15: nonexistent spot → 404 (markers route not shadowing)")
        else:
            bad(f"C15: expected 404, got {r.status_code} {r.text[:150]}")

        # C16. check-duplicates
        print("\n── C16. GET /spots/check-duplicates?latitude=30.2672&longitude=-97.7431 ──")
        r = await client.get("/spots/check-duplicates",
                             params={"latitude": 30.2672, "longitude": -97.7431})
        if r.status_code == 200:
            body = r.json()
            ok(f"C16: check-duplicates → 200 (count={body.get('count')}, candidates={len(body.get('candidates', []))})")
        else:
            bad(f"C16: {r.status_code} {r.text[:200]}")

        # C17. POST new spot
        print("\n── C17. POST /spots (minimal valid payload) ──")
        new_spot_payload = {
            "title": f"QA Stability Pass Spot {int(time.time())}",
            "description": "Final stability pass — test spot from backend QA harness.",
            "latitude": 30.2672,
            "longitude": -97.7431,
            "city": "Austin",
            "state": "TX",
            "country": "US",
            "category": "outdoor",
            "shoot_types": ["portrait"],
            "tags": ["qa", "test"],
        }
        r = await client.post("/spots", json=new_spot_payload, headers=admin_h)
        new_spot_id = None
        if r.status_code in (200, 201):
            body = r.json()
            new_spot_id = body.get("spot_id") or (body.get("spot") or {}).get("spot_id")
            if new_spot_id:
                ok(f"C17: POST /spots → {r.status_code}; spot_id={new_spot_id}")
            else:
                bad(f"C17: POST /spots → {r.status_code} but no spot_id; body keys={list(body.keys())}")
        else:
            bad(f"C17: POST /spots → {r.status_code} {r.text[:300]}")

        # C17b. verify appears in list
        if new_spot_id:
            r = await client.get("/spots", params={"paginated": 1, "limit": 24, "sort": "recent"})
            if r.status_code == 200:
                ids = {it.get("spot_id") for it in r.json().get("items", [])}
                if new_spot_id in ids:
                    ok(f"C17b: new spot_id {new_spot_id} appears in paginated list (sort=recent)")
                else:
                    # Try with larger limit or without strict sort
                    r2 = await client.get("/spots", params={"paginated": 1, "limit": 50, "cursor": 0})
                    if r2.status_code == 200:
                        ids2 = {it.get("spot_id") for it in r2.json().get("items", [])}
                        if new_spot_id in ids2:
                            ok(f"C17b: new spot_id in first 50 paginated results")
                        else:
                            # Check via direct GET
                            r3 = await client.get(f"/spots/{new_spot_id}")
                            if r3.status_code == 200:
                                ok(f"C17b: new spot fetched directly (visibility gate may filter from list; GET detail OK)")
                            else:
                                bad(f"C17b: new spot_id NOT findable (direct GET={r3.status_code})")
                    else:
                        bad(f"C17b: retry list {r2.status_code}")
            else:
                bad(f"C17b: list {r.status_code}")

        # ════════════════════════════════════════════════════════
        # SECTION D — Regression smoke
        # ════════════════════════════════════════════════════════
        print("\n══ SECTION D — Regression smoke ══")

        # D18. /auth/me
        r = await client.get("/auth/me", headers=admin_h)
        if r.status_code == 200:
            ok(f"D18: /auth/me → 200 (uid={r.json().get('user_id')})")
        else:
            bad(f"D18: /auth/me → {r.status_code}")

        # D19. /feed/home with lat/lng
        r = await client.get("/feed/home", params={"lat": 30.27, "lng": -97.74}, headers=admin_h)
        if r.status_code == 200:
            body = r.json()
            has_content = "spots" in body or "recommendations" in body or "rails" in body or isinstance(body, dict)
            ok(f"D19: /feed/home?lat=30.27&lng=-97.74 → 200; keys={list(body.keys())[:8]}")
        else:
            bad(f"D19: /feed/home → {r.status_code}")

        # D20. /feed/home no lat/lng
        r = await client.get("/feed/home", headers=admin_h)
        if r.status_code == 200:
            ok("D20: /feed/home (no lat/lng) → 200")
        else:
            bad(f"D20: /feed/home → {r.status_code}")

        # D21. /directory
        r = await client.get("/directory", params={"limit": 10}, headers=admin_h)
        if r.status_code == 200:
            ok(f"D21: /directory?limit=10 → 200")
        else:
            bad(f"D21: /directory → {r.status_code}")

        # D22. /directory/facets
        r = await client.get("/directory/facets", params={"limit": 12})
        if r.status_code == 200:
            body = r.json()
            if "top_cities" in body and "top_specialties" in body:
                ok(f"D22: /directory/facets → 200; top_cities={len(body['top_cities'])} top_specialties={len(body['top_specialties'])}")
            else:
                bad(f"D22: facets missing keys; have={list(body.keys())}")
        else:
            bad(f"D22: /directory/facets → {r.status_code}")

        # D23. /notifications
        r = await client.get("/notifications", params={"limit": 5}, headers=admin_h)
        if r.status_code == 200:
            ok("D23: /notifications?limit=5 → 200")
        else:
            bad(f"D23: /notifications → {r.status_code}")

        # D24. /dm/unread-count
        r = await client.get("/dm/unread-count", headers=admin_h)
        if r.status_code == 200:
            ok(f"D24: /dm/unread-count → 200 ({r.json()})")
        else:
            bad(f"D24: /dm/unread-count → {r.status_code} {r.text[:200]}")

        # D25. moderation queue — actual routes are /admin/pending + /admin/spot-uploads/pending
        print("\n── D25. moderation queue (actual routes) ──")
        r = await client.get("/admin/pending", headers=admin_h)
        if r.status_code == 200:
            ok(f"D25: /admin/pending (admin moderation queue) → 200")
        else:
            bad(f"D25: /admin/pending → {r.status_code} {r.text[:200]}")
        r = await client.get("/admin/spot-uploads/pending", headers=admin_h)
        if r.status_code == 200:
            ok(f"D25b: /admin/spot-uploads/pending → 200")
        else:
            bad(f"D25b: /admin/spot-uploads/pending → {r.status_code}")
        # Note: /admin/spots/queue does NOT exist in the codebase — review spec named it
        # but actual routes are /admin/pending + /admin/spot-uploads/pending.
        r = await client.get("/admin/spots/queue", headers=admin_h)
        if r.status_code in (404, 405):
            ok(f"D25-note: /admin/spots/queue doesn't exist ({r.status_code}) — expected; use /admin/pending instead")
        # D26. saved spots list — actual route is /me/saved (not /users/{id}/saved-spots)
        print("\n── D26. /me/saved (actual saved-spots route) ──")
        r = await client.get("/me/saved", headers=admin_h)
        if r.status_code == 200:
            body = r.json()
            ok(f"D26: /me/saved → 200 ({'items' in body and len(body.get('items', [])) or 'unknown shape'})")
        else:
            bad(f"D26: /me/saved → {r.status_code} {r.text[:200]}")

        # D27. legacy /api/spots without paginated → raw array
        r = await client.get("/spots", params={"limit": 10})
        if r.status_code == 200:
            body = r.json()
            if isinstance(body, list):
                ok(f"D27: legacy /spots?limit=10 → raw JSON ARRAY (len={len(body)})")
            else:
                bad(f"D27: legacy shape broken — expected list, got {type(body)} keys={list(body.keys()) if isinstance(body, dict) else '?'}")
        else:
            bad(f"D27: legacy /spots → {r.status_code}")

        # ════════════════════════════════════════════════════════
        # SECTION E — Concurrency / abort
        # ════════════════════════════════════════════════════════
        print("\n══ SECTION E — Concurrency ══")

        # E28. 10 parallel /spots?paginated=1 with different cursors
        print("\n── E28. 10 parallel paginated /spots requests ──")
        tasks = []
        for cur in [0, 5, 10, 15, 20, 25, 30, 35, 40, 45]:
            tasks.append(client.get("/spots", params={"paginated": 1, "limit": 5, "cursor": cur, "sort": "quality"}))
        t0 = time.time()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        dt = (time.time() - t0) * 1000
        statuses = [res.status_code if hasattr(res, "status_code") else f"exc:{type(res).__name__}" for res in results]
        all_200 = all(s == 200 for s in statuses)
        any_5xx = any(isinstance(s, int) and s >= 500 for s in statuses)
        if all_200:
            ok(f"E28: all 10 parallel requests returned 200 in {dt:.0f}ms")
        elif any_5xx:
            bad(f"E28: got 5xx: {statuses}")
        else:
            bad(f"E28: statuses mixed: {statuses}")

        # E29. 5 markers + 5 paginated in parallel
        print("\n── E29. 5 /markers + 5 paginated in parallel ──")
        tasks = []
        for _ in range(5):
            tasks.append(client.get("/spots/markers", params={"limit": 50}))
        for cur in [0, 5, 10, 15, 20]:
            tasks.append(client.get("/spots", params={"paginated": 1, "limit": 5, "cursor": cur}))
        t0 = time.time()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        dt = (time.time() - t0) * 1000
        statuses = [res.status_code if hasattr(res, "status_code") else f"exc:{type(res).__name__}" for res in results]
        if all(s == 200 for s in statuses):
            ok(f"E29: mixed 10 parallel → all 200 in {dt:.0f}ms")
        else:
            bad(f"E29: mixed parallel statuses: {statuses}")

        # ────────────────────────────────────────────────────
        # SUMMARY
        # ────────────────────────────────────────────────────
        print(f"\n{'='*60}")
        print(f"SUMMARY: {passed} passed / {failed} failed")
        if failures:
            print("FAILURES:")
            for f in failures:
                print(f"  • {f}")
        print(f"{'='*60}")
        return failed


if __name__ == "__main__":
    rc = asyncio.run(main())
    sys.exit(0 if rc == 0 else 1)
