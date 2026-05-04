"""
APNs direct-dispatch service — May 2026
════════════════════════════════════════

Why this exists
───────────────
LumaScout previously relied 100% on Expo's push service (exp.host/--/api/v2/push/send)
as the transport for all mobile push notifications. That works great for most
production apps, but has two downsides we hit enough times to justify this
module:

  1. Expo rate-limits aggressive senders (e.g. a marketplace sale ping blast
     that fans out to 500 followers).
  2. Expo tokens can only be issued from Expo's own token service — they
     don't work if a user side-installs a build or switches signing teams.

This service lets us dispatch pushes DIRECTLY to Apple's `api.push.apple.com`
HTTP/2 endpoint using a .p8 auth key. It's used as a SUPPLEMENT to the Expo
dispatcher, not a replacement:

  • Expo tokens (`ExponentPushToken[...]`) → still sent via Expo.
  • Raw APNs tokens (64-char hex strings)  → sent via this module.

Tokens of either type can coexist in the `push_tokens` collection, each
tagged with `token_type ∈ {"expo", "apns", "fcm"}`.

Security
────────
  • The .p8 private key is stored at a path configured in `APNS_KEY_PATH`.
    It is NEVER committed to the repo (see /app/secrets/.gitignore).
  • The signed JWT is cached for up to 55 min (Apple rotates every 60 min).
  • All HTTPS traffic is HTTP/2 via httpx[http2].

Env vars required (configured in /app/backend/.env)
  APNS_KEY_ID       — 10-char Apple key ID (derived from the .p8 filename)
  APNS_TEAM_ID      — 10-char Apple Team ID (from Apple Developer portal)
  APNS_BUNDLE_ID    — iOS bundle identifier (matches app.json)
  APNS_KEY_PATH     — Absolute path to the .p8 file on disk
  APNS_USE_SANDBOX  — "true" while still on TestFlight; "false" for App Store

If any are missing or the .p8 file isn't readable, `apns_configured()`
returns False and every dispatch call returns `{"ok": False, "reason": "not_configured"}`
WITHOUT raising — keeps this optional and safe.
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import jwt  # PyJWT

log = logging.getLogger("lumascout.apns")

# ──────────────────────────────────────────────────────────────────────────
# Config (read from env once at module load)
# ──────────────────────────────────────────────────────────────────────────
APNS_KEY_ID      = os.environ.get("APNS_KEY_ID", "").strip()
APNS_TEAM_ID     = os.environ.get("APNS_TEAM_ID", "").strip()
APNS_BUNDLE_ID   = os.environ.get("APNS_BUNDLE_ID", "").strip()
APNS_KEY_PATH    = os.environ.get("APNS_KEY_PATH", "").strip()
APNS_USE_SANDBOX = os.environ.get("APNS_USE_SANDBOX", "false").strip().lower() in ("1", "true", "yes")

# Apple's HTTP/2 endpoints
APNS_HOST_PROD    = "https://api.push.apple.com"
APNS_HOST_SANDBOX = "https://api.sandbox.push.apple.com"

# Apple tokens are valid up to 60 minutes. Re-sign at 55 min to be safe.
JWT_TTL_SECONDS = 55 * 60

# Cached JWT (module-level so it survives across requests)
_cached_jwt: Optional[str] = None
_cached_jwt_exp: float = 0.0
_cached_key_bytes: Optional[bytes] = None


def apns_configured() -> bool:
    """Return True iff all env vars are set AND the .p8 file is readable."""
    if not (APNS_KEY_ID and APNS_TEAM_ID and APNS_BUNDLE_ID and APNS_KEY_PATH):
        return False
    try:
        return Path(APNS_KEY_PATH).is_file()
    except Exception:
        return False


def _load_key_bytes() -> bytes:
    """Read the .p8 private key from disk once and cache it in memory."""
    global _cached_key_bytes
    if _cached_key_bytes is not None:
        return _cached_key_bytes
    p = Path(APNS_KEY_PATH)
    _cached_key_bytes = p.read_bytes()
    return _cached_key_bytes


def _current_jwt() -> str:
    """Return a valid ES256-signed JWT, creating a fresh one when expired."""
    global _cached_jwt, _cached_jwt_exp
    now = time.time()
    if _cached_jwt and now < _cached_jwt_exp:
        return _cached_jwt
    key = _load_key_bytes()
    claims = {"iss": APNS_TEAM_ID, "iat": int(now)}
    headers = {"alg": "ES256", "kid": APNS_KEY_ID}
    token = jwt.encode(claims, key, algorithm="ES256", headers=headers)
    _cached_jwt = token if isinstance(token, str) else token.decode()
    _cached_jwt_exp = now + JWT_TTL_SECONDS
    return _cached_jwt


def _endpoint() -> str:
    return APNS_HOST_SANDBOX if APNS_USE_SANDBOX else APNS_HOST_PROD


# Shared HTTP/2 client so we reuse the TLS connection across calls.
# Created lazily to avoid import-time network setup.
_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(http2=True, timeout=httpx.Timeout(10.0, connect=5.0))
    return _client


async def close_client() -> None:
    """Close the shared client (call during app shutdown)."""
    global _client
    if _client is not None and not _client.is_closed:
        try:
            await _client.aclose()
        except Exception:
            pass
        _client = None


async def send_apns(
    device_token: str,
    *,
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    sound: str = "default",
    badge: Optional[int] = None,
    priority: int = 10,
    push_type: str = "alert",
    thread_id: Optional[str] = None,
    collapse_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Send a single push to APNs for `device_token` (64-char hex).

    Returns a dict:
      { "ok": True,  "status": 200, "token": "...", "apns_id": "..." }  on success
      { "ok": False, "status": int|None, "reason": "error_code",
        "detail": "...", "token": "..." }                               on failure

    Never raises — on exception returns {"ok": False, "reason": "exception", ...}.
    """
    if not apns_configured():
        return {"ok": False, "reason": "not_configured", "token": device_token}

    # APNs tokens are 64 hex chars. Strip spaces and angle brackets that some
    # older iOS code paths added to NSData descriptions.
    token = (device_token or "").strip().replace("<", "").replace(">", "").replace(" ", "")
    if not token or len(token) < 32:
        return {"ok": False, "reason": "invalid_token", "token": device_token}

    url = f"{_endpoint()}/3/device/{token}"

    alert_payload = {"title": title[:120], "body": body[:240]}
    aps: Dict[str, Any] = {"alert": alert_payload, "sound": sound, "mutable-content": 1}
    if badge is not None:
        aps["badge"] = int(badge)
    if thread_id:
        aps["thread-id"] = thread_id

    payload: Dict[str, Any] = {"aps": aps}
    if data:
        # Custom keys go next to "aps" — APNs convention.
        for k, v in data.items():
            if k != "aps":
                payload[k] = v

    headers = {
        "authorization": f"bearer {_current_jwt()}",
        "apns-topic": APNS_BUNDLE_ID,
        "apns-push-type": push_type,
        "apns-priority": str(priority),
    }
    if collapse_id:
        headers["apns-collapse-id"] = collapse_id[:64]

    try:
        client = _get_client()
        resp = await client.post(url, content=json.dumps(payload).encode("utf-8"), headers=headers)
    except httpx.HTTPError as e:
        log.warning("apns http error token=%s err=%s", token[:8], e)
        return {"ok": False, "reason": "http_error", "detail": str(e), "token": token}
    except Exception as e:
        log.exception("apns unexpected token=%s", token[:8])
        return {"ok": False, "reason": "exception", "detail": str(e), "token": token}

    apns_id = resp.headers.get("apns-id")
    if resp.status_code == 200:
        return {"ok": True, "status": 200, "token": token, "apns_id": apns_id}

    # Non-200: parse Apple's reason from JSON body when present.
    reason = ""
    detail = resp.text[:200]
    try:
        rj = resp.json()
        reason = rj.get("reason", "") or ""
    except Exception:
        pass

    log.warning(
        "apns failure token=%s status=%s reason=%s detail=%s",
        token[:8], resp.status_code, reason, detail,
    )
    return {
        "ok": False,
        "status": resp.status_code,
        "reason": reason or f"http_{resp.status_code}",
        "detail": detail,
        "token": token,
        "apns_id": apns_id,
    }


async def send_apns_many(
    tokens: List[str],
    *,
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    sound: str = "default",
    thread_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Dispatch the same push to many tokens. Returns a summary dict.

    On APNs HTTP/2 the recommended pattern is sequential sends over the
    same multiplexed connection — httpx's h2 client handles the
    multiplexing for us, so we just gather() the individual calls.

    Returned shape:
      { "total": N, "delivered": int, "failed": int,
        "invalid_tokens": [token, ...],  # tokens Apple rejected as BadDeviceToken/Unregistered
        "results": [ ... ] }              # per-token detail
    """
    import asyncio

    total = len(tokens)
    if total == 0:
        return {"total": 0, "delivered": 0, "failed": 0, "invalid_tokens": [], "results": []}

    if not apns_configured():
        return {
            "total": total, "delivered": 0, "failed": total,
            "invalid_tokens": [], "results": [],
            "reason": "not_configured",
        }

    coros = [
        send_apns(
            t,
            title=title, body=body, data=data,
            sound=sound, thread_id=thread_id,
        )
        for t in tokens
    ]
    results = await asyncio.gather(*coros, return_exceptions=False)
    delivered = sum(1 for r in results if r.get("ok"))
    # Apple uses these reason codes to signal an uninstall / migrated device.
    dead_reasons = {"BadDeviceToken", "Unregistered"}
    invalid = [
        r.get("token") for r in results
        if (not r.get("ok")) and r.get("reason") in dead_reasons and r.get("token")
    ]
    return {
        "total": total,
        "delivered": delivered,
        "failed": total - delivered,
        "invalid_tokens": invalid,
        "results": results,
    }


def debug_status() -> Dict[str, Any]:
    """Report whether the service is ready — safe to call from any admin UI."""
    return {
        "configured": apns_configured(),
        "key_id": APNS_KEY_ID or None,
        "team_id_present": bool(APNS_TEAM_ID),
        "bundle_id": APNS_BUNDLE_ID or None,
        "key_path": APNS_KEY_PATH or None,
        "key_readable": bool(apns_configured()),
        "sandbox": APNS_USE_SANDBOX,
        "endpoint": _endpoint(),
    }
