"""
Apple Sign In with Apple (SIWA) — Backend verification.

Phase A — App Store blocker (Jun 2026).

Flow:
  1. iOS client invokes native Apple Sign In via `expo-apple-authentication`.
  2. Client generates a 32-byte raw nonce, SHA-256 hashes it, passes the
     HASH to Apple, keeps the RAW. Apple returns an identity_token (JWT)
     that contains the hashed nonce as the `nonce` claim.
  3. Client POSTs `{identity_token, raw_nonce, full_name?, email?}` to
     `/api/auth/apple`.
  4. This endpoint:
       a. Fetches Apple's JWKS (cached) and resolves the signing key by
          the JWT header `kid`.
       b. Verifies the identity_token: RS256 only, aud == our bundle id,
          iss == https://appleid.apple.com, exp/iat valid.
       c. Recomputes sha256(raw_nonce) and confirms it matches the
          `nonce` claim — protects against replay.
       d. Looks up the user by Apple `sub` first, then by email; links
          on email match; creates a fresh account otherwise.
       e. Returns the SAME shape as `POST /api/auth/login` so the client
          auth context handles Apple identically to email/Google.

We do NOT need Apple's .p8 server-to-server key for this path. That's
only required if we exchange authorization codes (web SIWA) or perform
server-side token revocation — neither of which we do here.

Email behaviour:
  • Apple only returns `email` on the FIRST sign-in. Subsequent logins
    return only `sub`. We persist on first sign-in and rely on `sub`
    afterwards.
  • Apple's "Hide my email" relay (@privaterelay.appleid.com) is treated
    as a normal email — it's unique and stable per (user, app).
"""

import hashlib
import logging
import os
import time
import uuid
from typing import Any, Dict, Optional

import jwt
from jwt import PyJWKClient
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["auth"])
log = logging.getLogger("auth.apple")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"
# App ID / Bundle ID we trust as the `aud` claim. Pulled from env so the
# preview/staging build can override without code change.
APPLE_BUNDLE_ID = os.environ.get(
    "APPLE_BUNDLE_ID", "app.emergent.photofinder60669d6fa1"
)
APPLE_ALGORITHMS = ["RS256"]

# Single PyJWKClient instance — it has built-in JWKS caching so we don't
# hammer Apple on every login.
_jwks_client = PyJWKClient(APPLE_JWKS_URL, cache_keys=True, lifespan=3600)


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------
class AppleFullName(BaseModel):
    given_name: Optional[str] = Field(default=None, alias="givenName")
    family_name: Optional[str] = Field(default=None, alias="familyName")

    model_config = {"populate_by_name": True, "extra": "ignore"}


class AppleAuthIn(BaseModel):
    """Inbound payload from the Expo client.

    - `identity_token` is the JWT we verify against Apple's JWKS.
    - `raw_nonce` is the un-hashed 32-byte hex string the client kept
      after computing sha256(raw_nonce) for Apple.
    - `full_name` + `email` are echoed only on first sign-in.
    """
    identity_token: str = Field(min_length=20, alias="identityToken")
    raw_nonce: str = Field(min_length=8, alias="rawNonce")
    email: Optional[str] = None
    full_name: Optional[AppleFullName] = Field(default=None, alias="fullName")

    model_config = {"populate_by_name": True, "extra": "ignore"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _compute_nonce_hash(raw_nonce: str) -> str:
    """Match the client's hashing exactly: sha256(utf8(raw_nonce)) → hex."""
    return hashlib.sha256(raw_nonce.encode("utf-8")).hexdigest()


def _verify_apple_identity_token(identity_token: str, raw_nonce: str) -> Dict[str, Any]:
    """Verify an Apple identity_token end-to-end.

    Raises HTTPException(401) on any verification failure. Returns the
    decoded payload on success.
    """
    # 1. Resolve the signing key by `kid` from Apple's JWKS.
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(identity_token)
    except Exception as exc:
        log.warning("apple.jwks_lookup_failed err=%r", exc)
        raise HTTPException(
            status_code=401,
            detail="Could not verify Apple sign-in. Please try again.",
        )

    # 2. PyJWT does signature, aud, iss, exp validation.
    try:
        payload = jwt.decode(
            identity_token,
            signing_key.key,
            algorithms=APPLE_ALGORITHMS,
            audience=APPLE_BUNDLE_ID,
            issuer=APPLE_ISSUER,
            options={
                "require": ["sub", "exp", "iat"],
                "verify_aud": True,
                "verify_iss": True,
                "verify_signature": True,
                "verify_exp": True,
            },
        )
    except jwt.ExpiredSignatureError:
        log.info("apple.token_expired")
        raise HTTPException(status_code=401, detail="Apple sign-in expired. Please try again.")
    except jwt.InvalidAudienceError:
        log.warning("apple.bad_audience expected=%s", APPLE_BUNDLE_ID)
        raise HTTPException(status_code=401, detail="Invalid Apple sign-in audience.")
    except jwt.InvalidIssuerError:
        log.warning("apple.bad_issuer")
        raise HTTPException(status_code=401, detail="Invalid Apple sign-in issuer.")
    except jwt.InvalidTokenError as exc:
        log.warning("apple.invalid_token err=%r", exc)
        raise HTTPException(status_code=401, detail="Invalid Apple identity token.")

    # 3. Nonce binding — defend against replay across sessions/devices.
    expected = _compute_nonce_hash(raw_nonce)
    actual = payload.get("nonce")
    if not actual or actual != expected:
        log.warning("apple.nonce_mismatch")
        raise HTTPException(status_code=401, detail="Apple nonce mismatch.")

    # 4. Sanity check `iat` is not absurdly in the future (clock skew).
    iat = payload.get("iat")
    if isinstance(iat, int) and iat > int(time.time()) + 300:
        log.warning("apple.iat_future iat=%s now=%s", iat, int(time.time()))
        raise HTTPException(status_code=401, detail="Apple token issued in the future.")

    return payload


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@router.post("/auth/apple")
async def apple_sign_in(body: AppleAuthIn):
    """Exchange a verified Apple identity_token for our app JWT.

    Wires to server.py's `db.users` collection, `create_access_token`,
    and `clean_doc` helpers via late imports to avoid circular-import
    headaches at module load time.
    """
    # Late imports — `server.py` builds the FastAPI app and includes
    # this router during startup, so its symbols are available by the
    # time a request lands here.
    from server import db, create_access_token, clean_doc, utcnow

    payload = _verify_apple_identity_token(body.identity_token, body.raw_nonce)

    apple_sub: str = str(payload["sub"])
    email_from_token: Optional[str] = payload.get("email")
    is_private_email = bool(payload.get("is_private_email"))

    # Prefer token-attested email over client-claimed email.
    email_raw = email_from_token or body.email
    email = (email_raw or "").lower().strip() or None

    # ── 1. Existing user by Apple sub ──────────────────────────────────
    user = await db.users.find_one({"apple_sub": apple_sub})
    if user:
        if user.get("deleted") or user.get("status") == "deleted":
            raise HTTPException(status_code=401, detail="Account has been deleted")
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"updated_at": utcnow(), "last_login_at": utcnow()}},
        )
        token = create_access_token(user["user_id"], user.get("email") or "")
        log.info("apple.login user_id=%s via=sub", user.get("user_id"))
        return {"token": token, "user": clean_doc(user)}

    # ── 2. Link to existing email-based account ────────────────────────
    if email:
        user = await db.users.find_one({"email": email})
        if user:
            if user.get("deleted") or user.get("status") == "deleted":
                raise HTTPException(status_code=401, detail="Account has been deleted")
            await db.users.update_one(
                {"user_id": user["user_id"]},
                {
                    "$set": {
                        "apple_sub": apple_sub,
                        "apple_is_private_email": is_private_email,
                        "auth_provider": user.get("auth_provider") or "apple",
                        "updated_at": utcnow(),
                        "last_login_at": utcnow(),
                    }
                },
            )
            user = await db.users.find_one({"user_id": user["user_id"]})
            token = create_access_token(user["user_id"], user.get("email") or email)
            log.info("apple.login user_id=%s via=email_link", user.get("user_id"))
            return {"token": token, "user": clean_doc(user)}

    # ── 3. Brand-new account ───────────────────────────────────────────
    # Apple gives us email only on the first sign-in. If we got nothing,
    # we still allow account creation — just synthesise a placeholder
    # `name` from the family/given name fields when present.
    if not email:
        # We MUST have something we can write into the email field to
        # survive other parts of the app that assume `email` exists.
        # Build a stable placeholder derived from the Apple sub.
        email = f"apple_{apple_sub[:16]}@privaterelay.appleid.com"

    given = body.full_name.given_name if body.full_name else None
    family = body.full_name.family_name if body.full_name else None
    display_name = " ".join(p for p in [given, family] if p) or email.split("@")[0]

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    username = email.split("@")[0]
    user = {
        "user_id": user_id,
        "email": email,
        "name": display_name,
        "username": username,
        "avatar_url": None,
        "avatar_image_url": None,
        "banner_image_url": None,
        "bio": "",
        "city": "",
        "state": "",
        "specialties": [],
        "website": "",
        "instagram": "",
        "facebook_url": "",
        "tiktok_url": "",
        "role": "user",
        "verification_status": "unverified",
        "auth_provider": "apple",
        "apple_sub": apple_sub,
        "apple_is_private_email": is_private_email,
        "plan": "free",
        "billing_cycle": None,
        "primary_country": "US",
        "primary_region": None,
        "timezone": None,
        "language_hint": "en",
        "created_at": utcnow(),
        "updated_at": utcnow(),
        "last_login_at": utcnow(),
    }
    await db.users.insert_one(user)
    token = create_access_token(user_id, email)
    log.info("apple.signup user_id=%s private_email=%s", user_id, is_private_email)
    return {"token": token, "user": clean_doc(user)}
