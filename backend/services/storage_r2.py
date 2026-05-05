"""
storage_r2.py — Cloudflare R2 backend for user uploads (May 2026)
═══════════════════════════════════════════════════════════════

Context
───────
User uploads previously wrote to the container's local `/app/backend/uploads`
directory. That path is on ephemeral local disk (not a persistent volume),
so every pod restart / redeploy quietly deleted every uploaded photo while
MongoDB (on a separate mount) retained the rows pointing at them.
End result on prod: 404-ing cover images for every user-uploaded spot.

This module fixes that permanently by streaming uploads to Cloudflare R2
(S3-compatible) and returning a CDN-hosted public URL. R2 is:

  • S3-API-compatible — we use boto3 with a custom endpoint_url.
  • Zero egress fees to our users' devices (CF handles CDN).
  • Durable by design — no container disk involved.

Shape of use
────────────
>>> from services import storage_r2
>>> if storage_r2.r2_configured():
...     res = storage_r2.put_object(
...             key_prefix="uploads/2026/05",
...             data=jpeg_bytes,
...             extension="jpg",
...             content_type="image/jpeg",
...         )
...     # res = {"key": "uploads/2026/05/<uuid>.jpg",
...     #        "public_url": "https://cdn.lumascout.app/uploads/2026/05/<uuid>.jpg"}
... else:
...     # local-disk fallback path stays active for dev/Expo Go.
...     ...

Env vars consumed (configure in Emergent Secrets)
──────────────────────────────────────────────────
  R2_ACCOUNT_ID          — 32-char Cloudflare account ID
  R2_ACCESS_KEY_ID       — R2 API token access key (generated in CF dashboard)
  R2_SECRET_ACCESS_KEY   — matching secret
  R2_BUCKET              — bucket name, e.g. "lumascout-uploads"
  R2_PUBLIC_BASE_URL     — public host prefix WITHOUT trailing slash,
                           e.g. "https://cdn.lumascout.app" (custom domain)
                           or "https://pub-<hash>.r2.dev" (default bucket URL).
                           Content is served from here; we never return
                           the private r2.cloudflarestorage.com URL to clients.

Design decisions
────────────────
  • Client is a MODULE-LEVEL singleton, instantiated lazily on first use.
    boto3's S3 client is thread-safe under GIL and reuses the underlying
    urllib3 connection pool, so there's no reason to build a new one
    per request.
  • Uploads are `put_object` with explicit ContentType + a 1-year
    immutable Cache-Control so the CF CDN caches aggressively. Keys
    are UUID-based and thus content-addressed for all practical
    purposes — the same bytes re-uploaded will get a new key (by
    design: callers dedupe at a higher layer if they want).
  • The function never raises on "not configured" — it returns None
    via `r2_configured()` so callers can pick their fallback path
    cleanly. Actual I/O errors are raised (500 up the stack).
  • `debug_status()` exposes redacted config for /admin/diagnostics
    without leaking the secret key.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import unicodedata
import uuid
from typing import Any, Dict, Optional

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

log = logging.getLogger("lumascout.storage.r2")

# ─── env (read once on import) ───────────────────────────────────────────
R2_ACCOUNT_ID        = os.environ.get("R2_ACCOUNT_ID", "").strip()
R2_ACCESS_KEY_ID     = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
R2_BUCKET            = os.environ.get("R2_BUCKET", "").strip()
R2_PUBLIC_BASE_URL   = os.environ.get("R2_PUBLIC_BASE_URL", "").strip().rstrip("/")

# R2's S3-compatible endpoint pattern — documented by Cloudflare.
# Note that the endpoint does NOT include the bucket; boto3 handles that.
def _endpoint_url() -> str:
    return f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"


# ─── lazy singleton client ───────────────────────────────────────────────
_client_lock = threading.Lock()
_client = None  # type: Optional[Any]


def r2_configured() -> bool:
    """
    All five env vars present? Only then can we talk to R2.
    Called by save-upload paths to decide: R2 or local-disk fallback.
    """
    return bool(
        R2_ACCOUNT_ID
        and R2_ACCESS_KEY_ID
        and R2_SECRET_ACCESS_KEY
        and R2_BUCKET
        and R2_PUBLIC_BASE_URL
    )


def _get_client():
    """Lazy-build a boto3 S3 client pointed at R2."""
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is None:
            _client = boto3.client(
                "s3",
                endpoint_url=_endpoint_url(),
                aws_access_key_id=R2_ACCESS_KEY_ID,
                aws_secret_access_key=R2_SECRET_ACCESS_KEY,
                # R2 is in the generic "auto" region. boto3 still requires
                # *something* here; the docs canonically use "auto".
                region_name="auto",
                # Virtual-hosted style addressing works against R2, but
                # path-style is the most forgiving for custom domains
                # and S3-like tooling. Keep it path-style for safety.
                config=BotoConfig(
                    signature_version="s3v4",
                    s3={"addressing_style": "path"},
                    retries={"max_attempts": 3, "mode": "standard"},
                ),
            )
    return _client


# ─── public API ──────────────────────────────────────────────────────────
# Slug rules (May 2026, R2 organized layout):
#   • lowercase ASCII-only
#   • non-alphanumeric collapsed to a single hyphen
#   • leading / trailing hyphens stripped
#   • capped to 60 chars so combined with spot_id we stay well below R2's
#     1024-char key limit (`locations/{slug}_{spot_id}/gallery/{uuid}.jpg`
#     ≈ 60 + 1 + 24 + 9 + 36 = 130 chars, plenty of headroom).
_SLUG_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_SLUG_TRIM = re.compile(r"^-+|-+$")


def slugify(text: Optional[str], *, max_len: int = 60) -> str:
    """Turn a free-form location name into a URL/key-safe slug.

    "Charro Ranch Park"     → "charro-ranch-park"
    "McAllister Park (TX)"  → "mcallister-park-tx"
    "Joshua Springs"        → "joshua-springs"
    ""  / None              → "spot"  (defensive — keys must be non-empty)
    """
    if not text:
        return "spot"
    # NFKD strips diacritics ("São Paulo" → "Sao Paulo") so URLs stay ASCII.
    norm = unicodedata.normalize("NFKD", str(text))
    norm = norm.encode("ascii", "ignore").decode("ascii").lower()
    norm = _SLUG_NON_ALNUM.sub("-", norm)
    norm = _SLUG_TRIM.sub("", norm)
    if not norm:
        return "spot"
    return norm[:max_len].rstrip("-") or "spot"


def build_location_key_prefix(spot_id: str, name: Optional[str]) -> str:
    """Compose the R2 key prefix for a location's gallery uploads.

    Returns: ``locations/{slug}_{spot_id}/gallery``

    The combined ``{slug}_{spot_id}`` segment is what guarantees
    uniqueness even when two parks share the exact same name — the
    spot_id suffix is always present and unique. The ``gallery``
    sub-segment leaves room for future per-location prefixes (e.g.
    ``cover``, ``derived``, ``audit``) without breaking object naming.
    """
    safe_id = (spot_id or "").strip() or "unknown"
    slug = slugify(name)
    return f"locations/{slug}_{safe_id}/gallery"


def build_key(prefix: str, extension: str) -> str:
    """
    Build a content-addressed, path-safe object key.

    `prefix` is expected to already encode any date partitioning
    ("uploads/2026/05") OR a location-scoped prefix produced by
    `build_location_key_prefix(...)`. We append a UUID filename +
    extension. Extension is normalized to lowercase, dotless, at most
    8 chars.
    """
    ext = (extension or "jpg").lstrip(".").lower()[:8] or "jpg"
    pfx = prefix.strip("/")
    return f"{pfx}/{uuid.uuid4().hex}.{ext}"


def public_url_for(key: str) -> str:
    """Translate an R2 object key into the public URL clients hit."""
    return f"{R2_PUBLIC_BASE_URL}/{key.lstrip('/')}"


def put_object(
    *,
    key_prefix: str,
    data: bytes,
    extension: str = "jpg",
    content_type: str = "image/jpeg",
    cache_control: str = "public, max-age=31536000, immutable",
) -> Dict[str, str]:
    """
    Upload bytes to R2. Returns `{key, public_url}` on success. Raises
    on transport / auth failure so the caller can surface a clean 500.

    The default cache policy is 1-year immutable: keys are UUID-based
    so they never collide, so the CDN can cache aggressively.
    """
    if not r2_configured():
        raise RuntimeError(
            "storage_r2.put_object called but R2 env vars are not set"
        )

    key = build_key(key_prefix, extension)
    client = _get_client()
    try:
        client.put_object(
            Bucket=R2_BUCKET,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl=cache_control,
        )
    except (BotoCoreError, ClientError) as e:
        log.exception("r2.put_object failed bucket=%s key=%s err=%r", R2_BUCKET, key, e)
        raise

    return {"key": key, "public_url": public_url_for(key)}


def head_object(key: str) -> Optional[Dict[str, Any]]:
    """
    HEAD an object. Returns metadata dict on success, None on 404 / auth
    error. Used by the orphan-report scanner to check file existence
    without trusting external HTTPS paths.
    """
    if not r2_configured():
        return None
    try:
        client = _get_client()
        resp = client.head_object(Bucket=R2_BUCKET, Key=key)
        return {
            "content_length": resp.get("ContentLength"),
            "content_type": resp.get("ContentType"),
            "etag": resp.get("ETag"),
        }
    except ClientError as e:
        code = (e.response.get("Error") or {}).get("Code") if e.response else None
        if code in ("404", "NoSuchKey", "NotFound"):
            return None
        log.warning("r2.head_object unexpected error key=%s err=%r", key, e)
        return None
    except BotoCoreError as e:
        log.warning("r2.head_object transport error key=%s err=%r", key, e)
        return None


def delete_object(key: str) -> Dict[str, Any]:
    """Delete a single object by its exact key.

    Returns ``{"ok": bool, "key": str, "reason": Optional[str]}``.

    Caller MUST pass the object key as it was stored in MongoDB
    (``storage_key`` / ``r2_key``) — we never reconstruct the key from
    a URL because the new layout uses location-scoped prefixes that
    a URL parser can't reverse-engineer reliably.

    Treats S3 "key not found" as a non-fatal success (idempotent
    delete) so retries don't error.
    """
    if not r2_configured():
        return {"ok": False, "key": key, "reason": "r2_not_configured"}
    if not key or not isinstance(key, str):
        return {"ok": False, "key": key, "reason": "empty_key"}
    try:
        client = _get_client()
        client.delete_object(Bucket=R2_BUCKET, Key=key)
        return {"ok": True, "key": key, "reason": None}
    except ClientError as e:
        code = (e.response.get("Error") or {}).get("Code") if e.response else None
        if code in ("404", "NoSuchKey", "NotFound"):
            # Idempotent: deleting an already-gone object is a success.
            return {"ok": True, "key": key, "reason": "not_found"}
        log.warning("r2.delete_object unexpected error key=%s err=%r", key, e)
        return {"ok": False, "key": key, "reason": f"client_error:{code or 'unknown'}"}
    except BotoCoreError as e:
        log.warning("r2.delete_object transport error key=%s err=%r", key, e)
        return {"ok": False, "key": key, "reason": "transport_error"}


def debug_status() -> Dict[str, Any]:
    """
    Redacted snapshot for /admin/diagnostics — confirms whether R2 is
    wired in without leaking the secret access key.
    """
    return {
        "configured": r2_configured(),
        "account_id_present": bool(R2_ACCOUNT_ID),
        "access_key_present": bool(R2_ACCESS_KEY_ID),
        "secret_key_present": bool(R2_SECRET_ACCESS_KEY),
        "bucket": R2_BUCKET or None,
        "public_base_url": R2_PUBLIC_BASE_URL or None,
        "endpoint": _endpoint_url() if R2_ACCOUNT_ID else None,
    }


# ─── startup banner ──────────────────────────────────────────────────────
# Emit a single INFO-level log line the moment this module is imported so
# supervisord logs clearly show whether R2 is enabled on boot. In dev /
# Expo Go where the keys are absent, we WANT a visible warning so the
# engineer remembers the local-disk fallback is active.
if r2_configured():
    log.info(
        "storage_r2 enabled — bucket=%s public_base=%s endpoint=%s",
        R2_BUCKET, R2_PUBLIC_BASE_URL, _endpoint_url(),
    )
else:
    log.warning(
        "storage_r2 NOT configured — uploads will fall back to local disk "
        "(/app/backend/uploads). This is fine for dev / Expo Go but WILL "
        "lose data on pod restart in production. Set R2_ACCOUNT_ID, "
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, "
        "R2_PUBLIC_BASE_URL to enable."
    )
