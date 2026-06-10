"""
Phase A — Apple Sign In with Apple (SIWA) backend regression tests.

Covers (see review_request):
  A. Endpoint plumbing for POST /api/auth/apple
  B. APPLE_BUNDLE_ID env override default value
  C. Regression sweep on pre-existing auth flows
  D. Lookup logic with mocked Apple JWT verification (in-process async)
"""

import asyncio
import os
import sys
import time
import uuid

import pytest
import requests

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

BASE_URL = "http://127.0.0.1:8001"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@lumascout.app"
ADMIN_PASSWORD = "Grayson@1117!!"

# Test data uses TEST_ prefix + example.com (Pydantic email-validator rejects
# .test TLD as a reserved/special-use name).
TEST_EMAIL_PREFIX = "TEST_siwa_"
TEST_EMAIL_DOMAIN = "siwa-qa.example.com"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(session):
    r = session.post(f"{API}/auth/login",
                     json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                     timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


# ---------------------------------------------------------------------------
# A. Endpoint plumbing
# ---------------------------------------------------------------------------
class TestAppleEndpointPlumbing:

    def test_empty_body_returns_422(self, session):
        r = session.post(f"{API}/auth/apple", json={}, timeout=15)
        assert r.status_code == 422, f"expected 422 got {r.status_code}: {r.text[:200]}"

    def test_short_garbage_returns_4xx_not_500(self, session):
        # identityToken too short — Pydantic min_length=20 → 422 (still not 500)
        r = session.post(f"{API}/auth/apple",
                         json={"identityToken": "x", "rawNonce": "y"},
                         timeout=15)
        assert r.status_code in (401, 422), f"got {r.status_code}: {r.text[:200]}"
        assert "Traceback" not in r.text and "<html" not in r.text.lower()

    def test_long_garbage_jwt_returns_401(self, session):
        garbage = "a" * 30 + ".b." + "c" * 20
        r = session.post(f"{API}/auth/apple",
                         json={"identityToken": garbage,
                               "rawNonce": "noncexx123"},
                         timeout=20)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert "detail" in body and isinstance(body["detail"], str)
        assert "Traceback" not in r.text

    def test_malformed_base64_noise_returns_401(self, session):
        garbage = ("ZXlKMGVYQWlPaUpLVjFRaUxDSmhiR2NpT2lKU1V6STFOaUo9"
                   ".Y3JhcA.c2lnbmF0dXJl")
        r = session.post(f"{API}/auth/apple",
                         json={"identityToken": garbage,
                               "rawNonce": "rawnonce99"},
                         timeout=20)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:200]}"
        assert "Traceback" not in r.text


# ---------------------------------------------------------------------------
# B. Bundle ID env override default
# ---------------------------------------------------------------------------
class TestAppleBundleIdEnv:

    def test_default_bundle_id_constant(self):
        from routes import auth_apple as mod
        assert mod.APPLE_BUNDLE_ID == os.environ.get(
            "APPLE_BUNDLE_ID", "app.emergent.photofinder60669d6fa1"
        )
        if not os.environ.get("APPLE_BUNDLE_ID"):
            assert mod.APPLE_BUNDLE_ID == "app.emergent.photofinder60669d6fa1"

    def test_env_var_is_read_at_module_load(self):
        import inspect
        from routes import auth_apple as mod
        src = inspect.getsource(mod)
        assert 'os.environ.get(' in src and 'APPLE_BUNDLE_ID' in src

    def test_module_constants(self):
        from routes import auth_apple as mod
        assert mod.APPLE_ISSUER == "https://appleid.apple.com"
        assert mod.APPLE_JWKS_URL == "https://appleid.apple.com/auth/keys"
        assert mod.APPLE_ALGORITHMS == ["RS256"]


# ---------------------------------------------------------------------------
# C. Regression sweep — pre-existing auth must still work
# ---------------------------------------------------------------------------
class TestAuthRegression:

    def test_admin_login_ok(self, session):
        r = session.post(f"{API}/auth/login",
                         json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                         timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        data = r.json()
        assert "token" in data and isinstance(data["token"], str)
        assert "user" in data and data["user"].get("email") == ADMIN_EMAIL
        assert "_id" not in data["user"]

    def test_register_fresh_user(self, session):
        email = f"{TEST_EMAIL_PREFIX}reg_{uuid.uuid4().hex[:8]}@{TEST_EMAIL_DOMAIN}"
        r = session.post(f"{API}/auth/register",
                         json={"email": email,
                               "password": "TestPass123!",
                               "name": "Test User"},
                         timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        data = r.json()
        assert "token" in data and "user" in data
        assert data["user"]["email"] == email.lower()
        assert data["user"].get("auth_provider") == "email"

    def test_google_session_bogus_id(self, session):
        r = session.post(f"{API}/auth/google/session",
                         json={"session_id": "TEST_bogus_session_xyz_999"},
                         timeout=20)
        assert r.status_code in (401, 400, 502), (
            f"google session regression — got {r.status_code}: {r.text[:200]}"
        )

    def test_auth_me_with_valid_token(self, session, admin_token):
        r = session.get(f"{API}/auth/me",
                        headers={"Authorization": f"Bearer {admin_token}"},
                        timeout=15)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        data = r.json()
        assert data.get("email") == ADMIN_EMAIL
        assert "_id" not in data


# ---------------------------------------------------------------------------
# D. Lookup logic with mocked JWT verification
#
# Strategy: import server in-process and use httpx.AsyncClient(ASGITransport)
# bound to a single event loop. Motor lazily creates its event loop bind on
# first await; reusing one loop across all D tests avoids
# "RuntimeError: Event loop is closed".
# ---------------------------------------------------------------------------
def _canned_payload(sub: str, email=None, is_private: bool = False):
    now = int(time.time())
    return {
        "sub": sub,
        "email": email,
        "is_private_email": is_private,
        "nonce": "00" * 16,
        "iat": now,
        "exp": now + 600,
        "aud": "app.emergent.photofinder60669d6fa1",
        "iss": "https://appleid.apple.com",
    }


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    # Best-effort close; pending motor tasks ok
    try:
        loop.close()
    except Exception:
        pass


@pytest.fixture(scope="module")
def async_app():
    """Import server module once and return (app, db_handle)."""
    import server as server_mod  # triggers router include
    return server_mod.app, server_mod.db


@pytest.fixture(scope="module")
def async_client(async_app, event_loop):
    """httpx.AsyncClient bound to the ASGI app, sharing a single loop."""
    from httpx import AsyncClient, ASGITransport
    app, _ = async_app
    transport = ASGITransport(app=app)
    client = AsyncClient(transport=transport, base_url="http://testserver")
    yield client
    event_loop.run_until_complete(client.aclose())


def _run(loop, coro):
    return loop.run_until_complete(coro)


@pytest.fixture(scope="module")
def mongo_db():
    """Sync pymongo handle for inspection + cleanup."""
    from pymongo import MongoClient
    from dotenv import dotenv_values
    cfg = dotenv_values(os.path.join(BACKEND_DIR, ".env"))
    mongo_url = os.environ.get("MONGO_URL") or cfg.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME") or cfg.get("DB_NAME")
    assert mongo_url and db_name, "MONGO_URL/DB_NAME must be set"
    client = MongoClient(mongo_url)
    yield client[db_name]
    client.close()


class TestAppleLookupLogic:
    """Patch the JWT verifier and exercise the four lookup branches."""

    def test_a_new_user_created_with_apple_sub(self, async_client, event_loop, mongo_db):
        from unittest.mock import patch
        sub = "apple.test.001"
        email = f"{TEST_EMAIL_PREFIX}sub001_{uuid.uuid4().hex[:6]}@{TEST_EMAIL_DOMAIN}"

        # pre-clean
        mongo_db.users.delete_many({"apple_sub": sub})

        canned = _canned_payload(sub, email=email)
        with patch("routes.auth_apple._verify_apple_identity_token",
                   return_value=canned):
            r = _run(event_loop, async_client.post("/api/auth/apple", json={
                "identityToken": "a" * 50,
                "rawNonce": "anyrawnoncexx",
                "email": email,
            }))
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        body = r.json()
        assert "token" in body and "user" in body
        assert body["user"]["email"] == email.lower()
        assert body["user"].get("apple_sub") == sub
        assert body["user"].get("auth_provider") == "apple"

        doc = mongo_db.users.find_one({"apple_sub": sub})
        assert doc is not None, "user not persisted in mongo"
        assert doc["auth_provider"] == "apple"
        assert doc["email"] == email.lower()

        # stash on class for next test
        TestAppleLookupLogic._sub_a_user_id = doc["user_id"]
        TestAppleLookupLogic._sub_a_email = email.lower()

    def test_b_second_call_reuses_same_user(self, async_client, event_loop, mongo_db):
        from unittest.mock import patch
        sub = "apple.test.001"
        before = list(mongo_db.users.find({"apple_sub": sub}))
        assert len(before) == 1, f"expected 1 user for sub {sub}, got {len(before)}"
        before_id = before[0]["user_id"]

        canned = _canned_payload(sub, email=getattr(TestAppleLookupLogic,
                                                    "_sub_a_email", None))
        with patch("routes.auth_apple._verify_apple_identity_token",
                   return_value=canned):
            r = _run(event_loop, async_client.post("/api/auth/apple", json={
                "identityToken": "a" * 50,
                "rawNonce": "anyrawnoncexx",
            }))
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        assert r.json()["user"]["user_id"] == before_id

        after = list(mongo_db.users.find({"apple_sub": sub}))
        assert len(after) == 1, f"duplicate users for sub={sub}: {len(after)}"

    def test_c_hide_my_email_path(self, async_client, event_loop, mongo_db):
        from unittest.mock import patch
        sub = "apple.test.003"
        # Use a syntactically valid email (Pydantic rejects .test). The
        # production private-relay is `@privaterelay.appleid.com` which IS
        # a real domain — use that for fidelity.
        relay_email = (f"{TEST_EMAIL_PREFIX}{uuid.uuid4().hex[:8]}"
                       "@privaterelay.appleid.com")
        mongo_db.users.delete_many({"apple_sub": sub})

        canned = _canned_payload(sub, email=relay_email, is_private=True)
        with patch("routes.auth_apple._verify_apple_identity_token",
                   return_value=canned):
            r = _run(event_loop, async_client.post("/api/auth/apple", json={
                "identityToken": "a" * 50,
                "rawNonce": "anyrawnoncexx",
            }))
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        body = r.json()
        assert body["user"].get("apple_is_private_email") is True
        assert body["user"].get("apple_sub") == sub

        doc = mongo_db.users.find_one({"apple_sub": sub})
        assert doc is not None
        assert doc.get("apple_is_private_email") is True
        assert doc.get("auth_provider") == "apple"

    def test_d_link_existing_email_account(self, async_client, event_loop,
                                            session, mongo_db):
        from unittest.mock import patch
        link_email = (f"{TEST_EMAIL_PREFIX}linkme_{uuid.uuid4().hex[:6]}"
                      f"@{TEST_EMAIL_DOMAIN}")

        # 1) Register email account via PUBLIC running server (works fine)
        reg = session.post(f"{API}/auth/register", json={
            "email": link_email,
            "password": "TestPass123!",
            "name": "Link Me",
        }, timeout=20)
        assert reg.status_code == 200, f"register failed: {reg.text[:200]}"
        reg_user_id = reg.json()["user"]["user_id"]

        # 2) Call /auth/apple with same email + new apple sub via in-proc client
        sub = "apple.test.002"
        mongo_db.users.delete_many({"apple_sub": sub})  # ensure clean

        canned = _canned_payload(sub, email=link_email)
        with patch("routes.auth_apple._verify_apple_identity_token",
                   return_value=canned):
            r = _run(event_loop, async_client.post("/api/auth/apple", json={
                "identityToken": "a" * 50,
                "rawNonce": "anyrawnoncexx",
            }))
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        body = r.json()

        # Re-read from mongo — registration happened in OTHER process (the
        # running supervisor backend on 8001), the link update happened in
        # THIS process. Since both use the same MONGO_URL/DB_NAME, the
        # final state in mongo should reflect a single user with apple_sub.
        matching = list(mongo_db.users.find({"email": link_email.lower()}))
        assert len(matching) == 1, (
            f"expected exactly 1 user on link path, found {len(matching)}: "
            f"{[m.get('user_id') for m in matching]}"
        )
        assert matching[0]["user_id"] == reg_user_id, (
            "link path created NEW user_id instead of updating existing"
        )
        assert matching[0].get("apple_sub") == sub
        assert body["user"]["user_id"] == reg_user_id
        assert body["user"].get("apple_sub") == sub

    def test_e_cleanup_test_users(self, mongo_db):
        """Delete all test users created during this run."""
        res = mongo_db.users.delete_many({
            "$or": [
                {"email": {"$regex": f"^{TEST_EMAIL_PREFIX}"}},
                {"email": {"$regex": rf"@{TEST_EMAIL_DOMAIN}$"}},
                {"apple_sub": {"$in": [
                    "apple.test.001", "apple.test.002", "apple.test.003"
                ]}},
            ]
        })
        assert res.acknowledged is True
        remaining = mongo_db.users.count_documents({
            "apple_sub": {"$in": [
                "apple.test.001", "apple.test.002", "apple.test.003"
            ]}
        })
        assert remaining == 0, f"{remaining} apple.test users still in db"
