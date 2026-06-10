"""
Phase 3 Add-Location Optimization regression tests.

Scope (backend-only):
  A. `client_quality` sub-doc is stripped from `public_spot_view` for
     non-admin viewers. Admins (admin, super_admin, moderator) keep it.
       - GET /api/spots/{id}      (non-admin → stripped, admin → present)
       - GET /api/feed/home       (non-admin → stripped)
  B. GET /api/admin/pending now honours `?sort=quality|newest|oldest`,
     unknown values fall back to `quality`.
  C. Regression sweep — none of the following broke:
       - POST /api/spots without new fields
       - POST /api/spots with `data_quality_signals=null`
       - GET /api/spots/{id} on a regular public spot
       - POST /api/spots/{id}/save respects free-tier saves cap (402)
       - POST /api/collections respects free-tier collections cap (402)

All TEST_ data is cleaned up at the end.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path

import pytest
import requests

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except Exception:
    pass

from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = "http://127.0.0.1:8001"
ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"


# ---------- helpers ----------------------------------------------------------

def _new_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session: requests.Session, email: str, password: str) -> str:
    r = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok, f"no token in login response for {email}"
    session.headers.update({"Authorization": f"Bearer {tok}"})
    return tok


def _register(session: requests.Session, email: str, password: str, name: str) -> str:
    r = session.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": password, "name": name},
        timeout=15,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok, "no token in register response"
    session.headers.update({"Authorization": f"Bearer {tok}"})
    return tok


def _base_spot_payload(**overrides) -> dict:
    body = {
        "title": "TEST_Phase3 Spot",
        "description": "TEST seed — phase 3",
        "latitude": 30.27,
        "longitude": -97.74,
        "city": "Austin",
        "state": "TX",
        "country": "USA",
        "privacy_mode": "public",
        "shoot_types": ["landscape"],
        "style_tags": ["golden_hour"],
    }
    body.update(overrides)
    return body


# ---------- module-scoped fixtures -------------------------------------------

@pytest.fixture(scope="module")
def admin_session() -> requests.Session:
    s = _new_session()
    _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)
    return s


@pytest.fixture(scope="module")
def normal_session() -> requests.Session:
    """Register a fresh free-tier non-admin user for this run."""
    s = _new_session()
    email = f"test_phase3_{uuid.uuid4().hex[:8]}@lumascouttest.com"
    _register(s, email, "TestPass1!aB", "Phase3 Normal User")
    s._test_email = email  # type: ignore[attr-defined]
    return s


@pytest.fixture(scope="module")
def free_user_session() -> requests.Session:
    """Separate free-tier user dedicated to free-cap regression checks."""
    s = _new_session()
    email = f"test_phase3_cap_{uuid.uuid4().hex[:8]}@lumascouttest.com"
    _register(s, email, "TestPass1!aB", "Phase3 Free Cap")
    s._test_email = email  # type: ignore[attr-defined]
    return s


@pytest.fixture(scope="module")
def state() -> dict:
    """Cross-test scratchpad — created spot ids, user ids for cleanup."""
    return {
        "spot_ids": [],
        "pending_spot_ids": [],
        "collection_ids": [],
        "user_emails": [],
    }


@pytest.fixture(scope="module")
def mongo_db():
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    yield db
    cli.close()


def _run(coro):
    """Sync helper to run a single coroutine inside the module."""
    return asyncio.get_event_loop().run_until_complete(coro)


# ============================================================================
# A. client_quality strip for non-admin viewers
# ============================================================================

class TestAClientQualityStrip:
    """Non-admins must never see `client_quality`; admins must."""

    def test_create_public_spot_with_quality(self, admin_session, state):
        body = _base_spot_payload(
            title="TEST_Phase3 strip-target",
            latitude=30.2701,
            longitude=-97.7401,
            data_quality_score=80,
            data_quality_signals={"has_pin": True, "has_photo": True},
            save_as_draft=False,
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        sid = data["spot_id"]
        state["spot_ids"].append(sid)
        state["strip_target_spot_id"] = sid
        # Admin's create response: NOT a public_spot_view, so client_quality
        # may or may not be in the payload — we don't assert that. The
        # canonical check is the GET below.

    def test_mongo_has_client_quality(self, mongo_db, state):
        sid = state["strip_target_spot_id"]
        doc = _run(mongo_db.spots.find_one({"spot_id": sid}))
        assert doc, "spot not in mongo"
        cq = doc.get("client_quality")
        assert cq is not None, "client_quality not persisted"
        assert cq.get("score") == 80, f"score wrong: {cq.get('score')}"
        assert cq.get("signals", {}).get("has_pin") is True
        assert cq.get("signals", {}).get("has_photo") is True

    def test_admin_get_sees_client_quality(self, admin_session, state):
        sid = state["strip_target_spot_id"]
        r = admin_session.get(f"{BASE_URL}/api/spots/{sid}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        cq = body.get("client_quality")
        assert cq is not None, (
            "Admin GET /api/spots/{id} did NOT include client_quality — "
            "expected admins to see the moderation sub-doc"
        )
        assert cq.get("score") == 80, f"admin score wrong: {cq}"
        assert isinstance(cq.get("signals"), dict), f"signals not dict: {cq}"
        assert cq["signals"].get("has_pin") is True
        assert cq["signals"].get("has_photo") is True

    def test_normal_get_strips_client_quality(self, normal_session, state):
        sid = state["strip_target_spot_id"]
        r = normal_session.get(f"{BASE_URL}/api/spots/{sid}", timeout=15)
        assert r.status_code == 200, f"normal GET failed: {r.status_code} {r.text}"
        body = r.json()
        assert "client_quality" not in body, (
            f"client_quality LEAKED to non-admin GET: {body.get('client_quality')!r}"
        )

    def test_feed_home_strips_for_non_admin(self, normal_session, state):
        """Even in /api/feed/home the moderation sub-doc must not appear."""
        sid = state["strip_target_spot_id"]
        r = normal_session.get(
            f"{BASE_URL}/api/feed/home",
            params={"lat": 30.27, "lng": -97.74},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        feed = r.json()
        found = False
        for section in feed.values():
            if not isinstance(section, list):
                continue
            for item in section:
                if not isinstance(item, dict):
                    continue
                if item.get("spot_id") == sid:
                    found = True
                assert "client_quality" not in item, (
                    f"client_quality leaked in feed/home for spot "
                    f"{item.get('spot_id')}: {item.get('client_quality')!r}"
                )
        # Best-effort — feed personalisation may not surface our spot,
        # but the assertion above (any item) is the real guarantee.
        _ = found  # presence not required; we only care about leak guarantee


# ============================================================================
# B. /api/admin/pending sort parameter
# ============================================================================

class TestBAdminPendingSort:
    """Verify quality / newest / oldest / unknown sort behaviour."""

    def test_seed_pending_spots(self, admin_session, mongo_db, state):
        """Create 3 spots and force them into pending_review with distinct
        quality scores 30, 70, 95 and distinct created_at timestamps.
        """
        seeds: list[tuple[str, int]] = []  # (spot_id, score)
        for i, score in enumerate([30, 70, 95]):
            body = _base_spot_payload(
                title=f"TEST_Phase3 pending q{score}",
                latitude=30.2800 + i * 0.0001,
                longitude=-97.7500 - i * 0.0001,
                data_quality_score=score,
                data_quality_signals={"seed_index": i, "score": score},
                save_as_draft=True,  # avoid hitting the public feed
            )
            r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
            assert r.status_code == 200, r.text
            sid = r.json()["spot_id"]
            seeds.append((sid, score))
            state["spot_ids"].append(sid)
            state["pending_spot_ids"].append(sid)

        # Force visibility_status=pending_review and DISTINCT, ordered
        # created_at strings so newest/oldest sorts are deterministic.
        # Spot index 0 (score 30) is OLDEST, index 2 (score 95) is NEWEST.
        async def _force_pending():
            base = "2026-06-01T00:00:00"
            for i, (sid, score) in enumerate(seeds):
                ts = f"2026-06-0{i + 1}T12:00:00+00:00"
                await mongo_db.spots.update_one(
                    {"spot_id": sid},
                    {"$set": {
                        "visibility_status": "pending_review",
                        "created_at": ts,
                        "quality_score": score,
                    }},
                )
            _ = base
        _run(_force_pending())

        # Stash for assertions below
        state["seed_q30"] = seeds[0][0]
        state["seed_q70"] = seeds[1][0]
        state["seed_q95"] = seeds[2][0]

    def _filter_seeded(self, items, state):
        """Pick only the spots we just seeded so other pending items
        in the DB don't perturb the ordering check.
        """
        ids = {state["seed_q30"], state["seed_q70"], state["seed_q95"]}
        return [i for i in items if i.get("spot_id") in ids]

    def test_default_sort_is_quality_desc(self, admin_session, state):
        r = admin_session.get(f"{BASE_URL}/api/admin/pending", timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        mine = self._filter_seeded(items, state)
        assert len(mine) == 3, f"expected 3 seeded items, got {len(mine)}: {[m.get('spot_id') for m in mine]}"
        # Top-of-our-three must be score 95
        assert mine[0]["spot_id"] == state["seed_q95"], (
            f"default sort: expected q95 first, got {[m.get('spot_id') for m in mine]}"
        )
        assert mine[1]["spot_id"] == state["seed_q70"]
        assert mine[2]["spot_id"] == state["seed_q30"]

    def test_explicit_sort_quality(self, admin_session, state):
        r = admin_session.get(f"{BASE_URL}/api/admin/pending?sort=quality", timeout=15)
        assert r.status_code == 200, r.text
        mine = self._filter_seeded(r.json(), state)
        assert [m["spot_id"] for m in mine] == [
            state["seed_q95"], state["seed_q70"], state["seed_q30"],
        ]

    def test_sort_newest(self, admin_session, state):
        r = admin_session.get(f"{BASE_URL}/api/admin/pending?sort=newest", timeout=15)
        assert r.status_code == 200, r.text
        mine = self._filter_seeded(r.json(), state)
        # newest seeded = q95 (created 2026-06-03), then q70 (06-02), then q30 (06-01)
        assert [m["spot_id"] for m in mine] == [
            state["seed_q95"], state["seed_q70"], state["seed_q30"],
        ], f"newest order wrong: {[m.get('spot_id') for m in mine]}"

    def test_sort_oldest(self, admin_session, state):
        r = admin_session.get(f"{BASE_URL}/api/admin/pending?sort=oldest", timeout=15)
        assert r.status_code == 200, r.text
        mine = self._filter_seeded(r.json(), state)
        assert [m["spot_id"] for m in mine] == [
            state["seed_q30"], state["seed_q70"], state["seed_q95"],
        ], f"oldest order wrong: {[m.get('spot_id') for m in mine]}"

    def test_sort_unknown_falls_back_to_quality(self, admin_session, state):
        r = admin_session.get(f"{BASE_URL}/api/admin/pending?sort=garbage", timeout=15)
        assert r.status_code == 200, f"unknown sort should NOT 4xx: {r.status_code} {r.text}"
        mine = self._filter_seeded(r.json(), state)
        assert [m["spot_id"] for m in mine] == [
            state["seed_q95"], state["seed_q70"], state["seed_q30"],
        ], f"garbage→quality fallback failed: {[m.get('spot_id') for m in mine]}"


# ============================================================================
# C. Regression sweep
# ============================================================================

class TestCRegression:
    def test_create_without_new_fields(self, admin_session, state):
        body = _base_spot_payload(
            title="TEST_Phase3 legacy no quality",
            latitude=30.2720,
            longitude=-97.7420,
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 200, r.text
        state["spot_ids"].append(r.json()["spot_id"])

    def test_create_with_null_signals(self, admin_session, state):
        body = _base_spot_payload(
            title="TEST_Phase3 null signals",
            latitude=30.2721,
            longitude=-97.7421,
            data_quality_score=55,
            data_quality_signals=None,
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 200, r.text
        state["spot_ids"].append(r.json()["spot_id"])

    def test_get_public_spot_200(self, admin_session, normal_session, state):
        # Reuse the strip-target which is a public, admin-auto-approved spot.
        sid = state["strip_target_spot_id"]
        r = normal_session.get(f"{BASE_URL}/api/spots/{sid}", timeout=15)
        assert r.status_code == 200, f"GET as normal user failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("spot_id") == sid

    def test_free_tier_saves_cap_402(self, admin_session, free_user_session, state):
        """Free plan saves cap = 3. The 4th save MUST return 402."""
        # Need at least 4 public approved spots to save. Create them as admin.
        save_target_ids: list[str] = []
        for i in range(4):
            body = _base_spot_payload(
                title=f"TEST_Phase3 save-target {i}",
                latitude=30.2900 + i * 0.0001,
                longitude=-97.7600 - i * 0.0001,
            )
            r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
            assert r.status_code == 200, r.text
            sid = r.json()["spot_id"]
            save_target_ids.append(sid)
            state["spot_ids"].append(sid)

        # Save 3 → all OK
        for sid in save_target_ids[:3]:
            r = free_user_session.post(f"{BASE_URL}/api/spots/{sid}/save", timeout=15)
            assert r.status_code == 200, f"save {sid} failed: {r.status_code} {r.text}"
            assert r.json().get("saved") is True, r.text

        # 4th save → must be 402
        r = free_user_session.post(
            f"{BASE_URL}/api/spots/{save_target_ids[3]}/save", timeout=15,
        )
        assert r.status_code == 402, (
            f"expected 402 at saves cap, got {r.status_code}: {r.text}"
        )

    def test_free_tier_collections_cap_402(self, free_user_session):
        """Free plan collections cap = 0. Even the first POST must 402."""
        r = free_user_session.post(
            f"{BASE_URL}/api/collections",
            json={
                "name": "TEST_Phase3 first collection",
                "description": "should be blocked at cap=0",
                "privacy_mode": "public",
            },
            timeout=15,
        )
        assert r.status_code == 402, (
            f"expected 402 at collections cap=0, got {r.status_code}: {r.text}"
        )


# ============================================================================
# Z. Cleanup (alphabetically last so pytest runs it after the above)
# ============================================================================

class TestZCleanup:
    def test_cleanup_spots(self, admin_session, state, mongo_db):
        deleted = 0
        for sid in state["spot_ids"]:
            r = admin_session.delete(f"{BASE_URL}/api/spots/{sid}", timeout=15)
            if r.status_code == 200:
                deleted += 1
        # Direct-mongo fallback to nuke anything the DELETE endpoint refused
        # (e.g. pending_review spots may need force).
        async def _purge():
            await mongo_db.spots.delete_many({"spot_id": {"$in": state["spot_ids"]}})
        _run(_purge())
        # Not asserting exact deleted count — best-effort cleanup.

    def test_cleanup_test_users(self, normal_session, free_user_session, mongo_db):
        emails = []
        for s in (normal_session, free_user_session):
            e = getattr(s, "_test_email", None)
            if e:
                emails.append(e)
        if not emails:
            return

        async def _purge_users():
            users = await mongo_db.users.find(
                {"email": {"$in": emails}}, {"_id": 0, "user_id": 1}
            ).to_list(10)
            uids = [u["user_id"] for u in users]
            if uids:
                await mongo_db.spot_saves.delete_many({"user_id": {"$in": uids}})
                await mongo_db.collections.delete_many({"owner_user_id": {"$in": uids}})
            await mongo_db.users.delete_many({"email": {"$in": emails}})
        _run(_purge_users())
