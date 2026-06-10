"""
Phase 2 Add-Location Optimization regression tests.

Scope (backend-only):
- POST /api/spots with new optional fields:
    * data_quality_score (clamped 0..100)
    * data_quality_signals (dict)
  persists under `client_quality` map on the spot doc.
- Backwards-compat: legacy POST /api/spots payloads (public, draft,
  private) still succeed.
- Pre-existing validators still reject null-island and out-of-range
  lat/lng (HTTP 422).
- Pre-existing endpoints regression:
    * GET  /api/spots/check-duplicates           (200)
    * DELETE /api/spots/{id}                     (cleanup, 200)
    * GET  /api/me/park-session  (401 unauth, 200 authed)
    * POST /api/uploads/image                    (200 multipart)
"""
import io
import os
import pytest
import requests
from pathlib import Path

# Load backend/.env so MONGO_URL / DB_NAME are available for the
# direct-Mongo persistence checks below.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except Exception:
    pass

# Local server is canonical for backend regression — public ingress is
# only relevant for frontend e2e. Backend supervisor binds 8001.
BASE_URL = "http://127.0.0.1:8001"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"


# --- session / fixtures -------------------------------------------------------

@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok, "no token in login response"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def created_spot_ids():
    """Track spot IDs created during tests so we can clean them up."""
    return []


def _base_spot_payload(**overrides):
    body = {
        "title": "TEST_Phase2 Spot",
        "description": "TEST seed — phase 2",
        "latitude": 30.2672,
        "longitude": -97.7431,
        "city": "Austin",
        "state": "TX",
        "country": "USA",
        "privacy_mode": "public",
        "shoot_types": ["landscape"],
        "style_tags": ["golden_hour"],
    }
    body.update(overrides)
    return body


# --- A. POST /api/spots with NEW fields --------------------------------------

class TestPhase2NewFields:
    """Tests for the 2 new optional fields on SpotCreateIn."""

    def test_create_with_new_fields_success(self, admin_session, created_spot_ids):
        body = _base_spot_payload(
            title="TEST_Phase2 with quality",
            latitude=30.2700,
            longitude=-97.7400,
            data_quality_score=72,
            data_quality_signals={
                "has_photos": True,
                "has_notes": True,
                "address_geocoded": True,
                "source": "camera_capture",
            },
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 200, f"unexpected status: {r.status_code} {r.text}"
        data = r.json()
        assert "spot_id" in data, "response missing spot_id"
        assert data["title"] == body["title"]
        # response shape MUST remain compatible — no client_quality leak required,
        # but we DO want it not to break the contract:
        assert "latitude" in data and "longitude" in data
        created_spot_ids.append(data["spot_id"])

    def test_clamp_high(self, admin_session, created_spot_ids):
        body = _base_spot_payload(
            title="TEST_Phase2 clamp high",
            latitude=30.2701,
            longitude=-97.7401,
            data_quality_score=150,
            data_quality_signals={"clamp_case": "high"},
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 200, r.text
        sid = r.json()["spot_id"]
        created_spot_ids.append(sid)
        # re-fetch — GET doesn't need to expose client_quality but must NOT 500
        g = admin_session.get(f"{BASE_URL}/api/spots/{sid}", timeout=15)
        assert g.status_code == 200, f"GET 500'd: {g.status_code} {g.text}"

    def test_clamp_low(self, admin_session, created_spot_ids):
        body = _base_spot_payload(
            title="TEST_Phase2 clamp low",
            latitude=30.2702,
            longitude=-97.7402,
            data_quality_score=-5,
            data_quality_signals={"clamp_case": "low"},
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 200, r.text
        sid = r.json()["spot_id"]
        created_spot_ids.append(sid)
        g = admin_session.get(f"{BASE_URL}/api/spots/{sid}", timeout=15)
        assert g.status_code == 200

    def test_persistence_via_mongo(self, admin_session, created_spot_ids):
        """Verify client_quality.score & signals actually persist via direct Mongo read."""
        body = _base_spot_payload(
            title="TEST_Phase2 persistence",
            latitude=30.2703,
            longitude=-97.7403,
            data_quality_score=88,
            data_quality_signals={
                "has_photos": True,
                "gps_accuracy_m": 8.5,
                "checks": ["a", "b", "c"],
            },
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 200, r.text
        sid = r.json()["spot_id"]
        created_spot_ids.append(sid)

        # Verify in Mongo directly — GET endpoint doesn't expose client_quality.
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        assert mongo_url and db_name, "MONGO_URL / DB_NAME must be set"

        async def _read():
            cli = AsyncIOMotorClient(mongo_url)
            try:
                doc = await cli[db_name].spots.find_one({"spot_id": sid})
                return doc
            finally:
                cli.close()

        doc = asyncio.get_event_loop().run_until_complete(_read())
        assert doc is not None, "spot not found in mongo"
        cq = doc.get("client_quality")
        assert cq is not None, "client_quality sub-doc not persisted"
        assert cq.get("score") == 88, f"score not persisted: {cq.get('score')}"
        sigs = cq.get("signals") or {}
        assert sigs.get("has_photos") is True
        assert sigs.get("gps_accuracy_m") == 8.5
        assert sigs.get("checks") == ["a", "b", "c"]
        assert cq.get("captured_at") is not None
        # And confirm we did NOT leak top-level data_quality_* fields
        assert "data_quality_score" not in doc, "data_quality_score leaked to top-level"
        assert "data_quality_signals" not in doc, "data_quality_signals leaked to top-level"

    def test_clamp_persisted_to_mongo(self, admin_session, created_spot_ids):
        """Clamp must reflect in the stored doc, not just the response."""
        body = _base_spot_payload(
            title="TEST_Phase2 clamp persisted",
            latitude=30.2704,
            longitude=-97.7404,
            data_quality_score=999,
            data_quality_signals={"src": "clamp_persisted"},
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 200, r.text
        sid = r.json()["spot_id"]
        created_spot_ids.append(sid)

        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        async def _read():
            cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
            try:
                return await cli[os.environ["DB_NAME"]].spots.find_one({"spot_id": sid})
            finally:
                cli.close()
        doc = asyncio.get_event_loop().run_until_complete(_read())
        assert doc and doc.get("client_quality", {}).get("score") == 100, \
            f"clamp not persisted: {doc.get('client_quality')}"


# --- B. Legacy POST /api/spots still works -----------------------------------

class TestLegacyCreateStillWorks:
    """Backwards-compat: existing payloads without the new fields still pass."""

    def test_public_spot_no_new_fields(self, admin_session, created_spot_ids):
        body = _base_spot_payload(
            title="TEST_Phase2 legacy public",
            latitude=30.2710,
            longitude=-97.7410,
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 200, r.text
        created_spot_ids.append(r.json()["spot_id"])

    def test_draft_spot_no_new_fields(self, admin_session, created_spot_ids):
        body = _base_spot_payload(
            title="TEST_Phase2 legacy draft",
            latitude=30.2711,
            longitude=-97.7411,
            save_as_draft=True,
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 200, r.text
        created_spot_ids.append(r.json()["spot_id"])

    def test_private_spot_no_new_fields(self, admin_session, created_spot_ids):
        body = _base_spot_payload(
            title="TEST_Phase2 legacy private",
            latitude=30.2712,
            longitude=-97.7412,
            privacy_mode="private",
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        # Admin shouldn't trip the free-plan private-spot cap.
        assert r.status_code == 200, r.text
        created_spot_ids.append(r.json()["spot_id"])


# --- C. Validators still reject ---------------------------------------------

class TestValidatorsStillReject:
    def test_null_island_rejected(self, admin_session):
        body = _base_spot_payload(
            title="TEST_Phase2 null island",
            latitude=0.0,
            longitude=0.0,
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"

    def test_lat_over_90_rejected(self, admin_session):
        body = _base_spot_payload(
            title="TEST_Phase2 lat>90",
            latitude=91.5,
            longitude=-97.7,
        )
        r = admin_session.post(f"{BASE_URL}/api/spots", json=body, timeout=15)
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"


# --- D. Pre-existing endpoints regression ------------------------------------

class TestPreExistingEndpoints:
    def test_check_duplicates(self, admin_session):
        r = admin_session.get(
            f"{BASE_URL}/api/spots/check-duplicates",
            params={"latitude": 30.2700, "longitude": -97.7400, "title": "TEST_Phase2"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "count" in data and "candidates" in data

    def test_park_session_unauth_401(self):
        r = requests.get(f"{BASE_URL}/api/me/park-session", timeout=15)
        # No bearer token; must be 401 (or 403, but spec says 401).
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"

    def test_park_session_authed_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/me/park-session", timeout=15)
        assert r.status_code == 200, r.text

    def test_uploads_image_multipart(self, admin_session):
        # Build a 1x1 PNG in memory — no fixture file needed.
        png_bytes = bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4"
            "890000000D49444154789C636060606000000005000150A9F8730000000049454E44AE426082"
        )
        files = {"file": ("test.png", io.BytesIO(png_bytes), "image/png")}
        # requests session has Content-Type=application/json; we need to clear it
        # for multipart so the boundary header is built correctly.
        sess = requests.Session()
        sess.headers.update({"Authorization": admin_session.headers["Authorization"]})
        r = sess.post(f"{BASE_URL}/api/uploads/image", files=files, timeout=30)
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        assert "image_url" in body
        assert body.get("image_id", "").startswith("img_")


# --- E. Cleanup (runs last) --------------------------------------------------

class TestZCleanup:
    """Delete all TEST_ spots created during this run."""

    def test_cleanup_spots(self, admin_session, created_spot_ids):
        deleted = 0
        for sid in created_spot_ids:
            r = admin_session.delete(f"{BASE_URL}/api/spots/{sid}", timeout=15)
            if r.status_code == 200:
                deleted += 1
        assert deleted == len(created_spot_ids), (
            f"only {deleted}/{len(created_spot_ids)} cleaned up"
        )
