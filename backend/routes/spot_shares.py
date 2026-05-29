"""
routes/spot_shares.py — Feature 4: Public Client-Share, Owner Visibility,
Owner/Admin Spot Edits.

Goals
─────
1. Owners (and admins) can mint a revocable public share link for any of
   their spots so they can hand it to a paying client without the client
   needing to install LumaScout. The recipient sees a sanitized read-only
   view of the location.
2. Owners can toggle a spot between PUBLIC and PRIVATE. When private,
   the share-view rounds coordinates to 2 decimals UNLESS the owner has
   explicitly opted into "show exact location".
3. Owners can edit their own spot's display fields (title / notes /
   parking / safety / etc.) without admin help. Admin overrides still
   exist via routes/admin.py.
4. Every "unavailable" state (revoked / suspended owner / rejected spot
   / deleted spot / never-existed token) returns the SAME 404 shape
   so no information leaks about why a link no longer works.

Endpoints
─────────
  POST   /api/spots/{spot_id}/share
  DELETE /api/spots/{spot_id}/share/{token}
  GET    /api/spots/{spot_id}/shares
  PATCH  /api/spots/{spot_id}/visibility
  PATCH  /api/spots/{spot_id}/info
  GET    /api/spots/shared/{token}           — JSON, public, no auth
  GET    /api/public/location/{share_slug}   — HTML + JSON, public, no auth

NOTE on path prefix: the Kubernetes ingress only routes /api/* to the
backend, so the user-facing path /public/location/{slug} is mounted at
/api/public/location/{slug}. Externally the share URL the client copies
to their iMessage/WhatsApp/Slack will be e.g.:

  https://<host>/api/public/location/<token>

Share-token format
──────────────────
secrets.token_urlsafe(24) → 32 URL-safe characters. CSPRNG-backed.
NOT derived from spot_id, NOT a UUID, NOT slugified. Revocable, no
expiry in v1.
"""
from __future__ import annotations

import os
import secrets
import uuid
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator

from server import (
    db,
    get_current_user,
    utcnow,
    audit_log,
)

router = APIRouter(prefix="/api", tags=["spot-shares"])

# ─────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────

WEB_BASE = os.environ.get(
    # Feature 4 (May 2026) — share URLs MUST use the permanent host,
    # NOT request.base_url (which is whatever ephemeral preview the
    # caller connected to). This constant is intentionally read from
    # the .env at module-load time so the value is fixed regardless of
    # which preview rotated in. PUBLIC_SHARE_BASE_URL is the canonical
    # name; LUMASCOUT_WEB_BASE is kept as a legacy fallback so any
    # external tooling that already set it keeps working.
    "PUBLIC_SHARE_BASE_URL",
    os.environ.get(
        "LUMASCOUT_WEB_BASE",
        "https://photo-finder-60.emergent.host",
    ),
).rstrip("/")

# Generic OG card for PRIVATE spots — must NOT reveal location title or
# hero image, so iMessage / WhatsApp / Slack / Discord don't cache real
# private content in their link previews.
GENERIC_OG_TITLE = "Photo location · LumaScout"
GENERIC_OG_DESCRIPTION = (
    "A LumaScout photographer shared a private location with you."
)
GENERIC_OG_IMAGE = f"{WEB_BASE}/social-card.png"

# Identical payload returned for every "unavailable" state. Caller cannot
# distinguish revoked / suspended / rejected / deleted / never-existed.
UNAVAILABLE_BODY: Dict[str, Any] = {
    "status": "unavailable",
    "reason": "unavailable",
    "message": (
        "This share link is no longer available. Ask the photographer for "
        "a new one."
    ),
}
UNAVAILABLE_STATUS_CODE = 404

# Owner-editable fields. Anything not in this list is rejected on PATCH
# /info so owners can't escalate (e.g. flip visibility_status to bypass
# moderation).
OWNER_EDITABLE_FIELDS = {
    "title",
    "description",
    "best_time_of_day",
    "best_light_notes",
    "parking_notes",
    "restroom_notes",
    "walking_notes",
    "accessibility_notes",
    "safety_notes",
    "weather_notes",
    "lens_recommendations",
    "permit_notes",
    "fee_notes",
    "landmark_notes",
    "notes",
    "access_notes",
    "land_access",
    "shoot_types",
    "style_tags",
    "best_months",
    "dog_friendly",
    "kid_friendly",
    "accessible",
    "indoor",
    "permit_required",
    "fee_required",
}

# Display fields exposed on the SANITIZED public share view. Owner
# identity, internal IDs, email, phone, moderation state are NEVER
# exposed. Only display-safe fields land here.
PUBLIC_DISPLAY_FIELDS = (
    "title",
    "description",
    "best_time_of_day",
    "best_light_notes",
    "parking_notes",
    "restroom_notes",
    "walking_notes",
    "accessibility_notes",
    "safety_notes",
    "weather_notes",
    "lens_recommendations",
    "permit_notes",
    "fee_notes",
    "landmark_notes",
    "notes",
    "access_notes",
    "land_access",
    "shoot_types",
    "style_tags",
    "best_months",
    "dog_friendly",
    "kid_friendly",
    "accessible",
    "indoor",
    "permit_required",
    "fee_required",
    "sunrise_rating",
    "sunset_rating",
    "morning_golden_hour_rating",
    "evening_golden_hour_rating",
    "shade_rating",
    "variety_rating",
    "crowd_level",
    "safety_rating",
    "city",
    "state",
    "country",
)


# ─────────────────────────────────────────────────────────────────────
# Request models
# ─────────────────────────────────────────────────────────────────────


class VisibilityToggleIn(BaseModel):
    """PATCH /api/spots/{id}/visibility body.

    `visibility` is the photographer-facing label: "public" | "private".
    Internally maps to spots.privacy_mode.

    `show_exact_location` only takes effect on private spots. When False
    (default for private), the public share view rounds coordinates to
    2 decimals.
    """

    visibility: str = Field(..., pattern="^(public|private)$")
    show_exact_location: Optional[bool] = None  # default decided by handler


class SpotInfoUpdateIn(BaseModel):
    """PATCH /api/spots/{id}/info body — owner-editable display fields.

    Open shape; we validate keys against OWNER_EDITABLE_FIELDS in the
    handler. Pydantic's `extra="allow"` lets clients send only the
    fields they want to change without listing every column.
    """

    model_config = {"extra": "allow"}


class ShareCreateIn(BaseModel):
    """POST /api/spots/{id}/share — optional client label (for owner UI)."""

    label: Optional[str] = Field(default=None, max_length=80)
    # Per-share show_exact_location override. IMMUTABLE after creation —
    # owner must revoke + re-mint to change it. This prevents an owner
    # from silently downgrading a recipient from exact to approximate
    # AFTER the link is already forwarded. None → defaults to "True if
    # spot currently public, else False" at create time.
    show_exact_location: Optional[bool] = None
    # Jun 2025 — "Share Location" CR. Optional photographer-authored
    # personal note rendered above the spot details in the public,
    # white-themed client page. Kept short (single screen, no scroll).
    personal_note: Optional[str] = Field(default=None, max_length=600)


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────


def _is_admin(user: Optional[dict]) -> bool:
    if not user:
        return False
    return user.get("role") in ("admin", "super_admin", "moderator")


def _owner_or_admin(user: dict, spot: dict) -> bool:
    if not user or not spot:
        return False
    if _is_admin(user):
        return True
    return user.get("user_id") == spot.get("owner_user_id")


def _generate_share_token() -> str:
    """CSPRNG-backed URL-safe token. Always 32 chars."""
    # token_urlsafe(24) returns 32 chars; we collision-check at insert.
    return secrets.token_urlsafe(24)


def _unavailable_response() -> JSONResponse:
    return JSONResponse(content=UNAVAILABLE_BODY, status_code=UNAVAILABLE_STATUS_CODE)


async def _resolve_share_or_unavailable(token: str) -> Optional[Dict[str, Any]]:
    """Return a context dict describing the spot to render, OR None if any
    "unavailable" condition is true.

    Returns {
      "share": <share row>,
      "spot": <spot doc>,
      "owner": <owner user doc, sanitized>,
      "is_public_spot": bool,
      "show_exact_location": bool,
    }
    """
    if not token or len(token) > 80:
        return None

    share = await db.spot_shares.find_one({"token": token}, {"_id": 0})
    if not share:
        return None
    if share.get("revoked"):
        return None

    spot = await db.spots.find_one({"spot_id": share["spot_id"]}, {"_id": 0})
    if not spot:
        return None

    vstat = spot.get("visibility_status")
    # Treat anything that's NOT explicitly approved or pending_review as
    # unavailable from a public share's POV. Drafts can still be shared
    # (so owners can preview with clients pre-publish), but rejected /
    # deleted hide.
    if vstat in ("rejected", "deleted"):
        return None

    owner_id = spot.get("owner_user_id")
    owner = None
    if owner_id:
        owner = await db.users.find_one(
            {"user_id": owner_id}, {"_id": 0, "password_hash": 0}
        )
        if owner and owner.get("status") == "suspended":
            return None
        if owner and owner.get("deleted"):
            return None

    privacy = spot.get("privacy_mode") or "public"
    is_public_spot = privacy in ("public", "premium")
    # IMPORTANT (Feature 4): The exact-location decision is PER-SHARE,
    # IMMUTABLE from the moment the link was minted. Read it off the
    # share row. Older share rows (created before this field was added)
    # fall back to the legacy spot-wide spots.location_display_mode so
    # nothing breaks on rows minted in Scope A.
    if "show_exact_location" in share:
        show_exact_location = bool(share.get("show_exact_location"))
    else:
        display = spot.get("location_display_mode") or "exact"
        show_exact_location = is_public_spot or (display == "exact")

    return {
        "share": share,
        "spot": spot,
        "owner": owner,
        "is_public_spot": is_public_spot,
        "show_exact_location": show_exact_location,
    }


def _sanitize_image(img: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(img, dict):
        return None
    url = img.get("image_url") or img.get("card_url") or img.get("thumb_url")
    if not isinstance(url, str) or not url:
        return None
    return {
        "image_url": url,
        "caption": img.get("caption"),
        "is_cover": bool(img.get("is_cover")),
    }


def _build_public_view(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Produce the sanitized public payload from a resolved share ctx."""
    spot = ctx["spot"]
    is_public_spot = ctx["is_public_spot"]
    show_exact = ctx["show_exact_location"]

    # Coordinates
    lat = spot.get("latitude")
    lng = spot.get("longitude")
    if not show_exact:
        # Private + show_exact_location=False → round to 2 decimals
        # (~1.1 km granularity) so the recipient gets a general area
        # but not the exact street address.
        if isinstance(lat, (int, float)):
            lat = round(float(lat), 2)
        if isinstance(lng, (int, float)):
            lng = round(float(lng), 2)
    coord_precision = "exact" if show_exact else "approximate"

    # Images — pull display-safe subset only. Strip per-image image_id
    # / sort_order / internal flags.
    images = []
    for im in (spot.get("images") or []):
        clean = _sanitize_image(im)
        if clean:
            images.append(clean)
    # Hero
    hero = None
    for im in images:
        if im.get("is_cover"):
            hero = im.get("image_url")
            break
    if not hero and images:
        hero = images[0].get("image_url")
    # Admin override on top
    ov = spot.get("admin_cover_override") or {}
    if isinstance(ov, dict) and ov.get("image_url"):
        hero = ov["image_url"]

    # Display fields only — no IDs, no email, no phone, no moderation.
    display: Dict[str, Any] = {}
    for f in PUBLIC_DISPLAY_FIELDS:
        if spot.get(f) is not None:
            display[f] = spot.get(f)

    return {
        "status": "ok",
        "visibility": "public" if is_public_spot else "private",
        "show_exact_location": bool(show_exact),
        "coord_precision": coord_precision,
        "robots": "index,follow" if is_public_spot else "noindex",
        "spot": {
            **display,
            "latitude": lat,
            "longitude": lng,
            "images": images,
            "hero_image_url": hero,
        },
        # Owner identity is intentionally hidden. We only surface a
        # generic "Shared by a LumaScout photographer" attribution.
        "shared_by": {
            "display_name": "A LumaScout photographer",
        },
        "og": {
            "title": (
                (spot.get("title") or "Photo location · LumaScout")
                if is_public_spot
                else GENERIC_OG_TITLE
            ),
            "description": (
                (
                    spot.get("description")
                    or f"{spot.get('city') or ''}{', ' + spot.get('state') if spot.get('state') else ''}"
                ).strip()
                if is_public_spot
                else GENERIC_OG_DESCRIPTION
            ),
            "image": (
                hero if (is_public_spot and hero) else GENERIC_OG_IMAGE
            ),
        },
    }


# ─────────────────────────────────────────────────────────────────────
# Owner / admin endpoints
# ─────────────────────────────────────────────────────────────────────


@router.post("/spots/{spot_id}/share")
async def create_share_link(
    spot_id: str,
    body: ShareCreateIn,
    user: dict = Depends(get_current_user),
):
    """Mint a revocable public share link for this spot.

    Allowed for the spot owner and for any admin / super_admin /
    moderator. Returns the token + the full external share URL.
    """
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    if not _owner_or_admin(user, spot):
        raise HTTPException(status_code=403, detail="Forbidden")

    # Generate a token with a collision-safety retry (cheap, almost
    # never triggers — 32 url-safe chars = 192 bits of entropy).
    token = None
    for _ in range(5):
        candidate = _generate_share_token()
        existing = await db.spot_shares.find_one({"token": candidate}, {"_id": 0, "token": 1})
        if not existing:
            token = candidate
            break
    if not token:
        raise HTTPException(status_code=500, detail="Could not allocate share token")

    now = utcnow()
    # Resolve show_exact_location: explicit body value takes precedence;
    # otherwise default = True if the spot is currently public/premium,
    # False if private. The value is then IMMUTABLE on this share row —
    # owner must revoke and mint a new one to change it.
    spot_is_public = (spot.get("privacy_mode") or "public") in ("public", "premium")
    if body.show_exact_location is None:
        show_exact = bool(spot_is_public)
    else:
        show_exact = bool(body.show_exact_location)

    share_doc = {
        "share_id": f"shr_{uuid.uuid4().hex[:12]}",
        "token": token,
        "spot_id": spot_id,
        "owner_user_id": spot.get("owner_user_id"),
        "created_by_user_id": user.get("user_id"),
        "created_by_role": user.get("role") or "owner",
        "label": (body.label or "").strip() or None,
        # Jun 2025 — "Share Location" personal note (white-themed public
        # page). Sanitized to a max of 600 chars; rendered as-is HTML-
        # escaped in the public template.
        "personal_note": (body.personal_note or "").strip()[:600] or None,
        # IMMUTABLE: copy the visibility shape into the share row at
        # create-time so subsequent owner toggles don't silently change
        # what a forwarded link reveals.
        "spot_visibility_at_create": "public" if spot_is_public else "private",
        "show_exact_location": show_exact,
        "revoked": False,
        "revoked_at": None,
        "revoked_by_user_id": None,
        "created_at": now,
        "last_accessed_at": None,
        "access_count": 0,
    }
    await db.spot_shares.insert_one(dict(share_doc))

    if _is_admin(user) and user.get("user_id") != spot.get("owner_user_id"):
        try:
            await audit_log(
                user,
                "spot_share_created",
                target_type="spot",
                target_id=spot_id,
                after={"token": token},
            )
        except Exception:
            pass

    share_url = f"{WEB_BASE}/api/public/location/{token}"
    api_url = f"{WEB_BASE}/api/spots/shared/{token}"
    return {
        "ok": True,
        "share_id": share_doc["share_id"],
        "token": token,
        "share_url": share_url,
        "api_url": api_url,
        "created_at": now.isoformat() if isinstance(now, datetime) else now,
        "label": share_doc["label"],
        "revoked": False,
        "show_exact_location": show_exact,
        "spot_visibility_at_create": share_doc["spot_visibility_at_create"],
    }


@router.delete("/spots/{spot_id}/share/{token}")
async def revoke_share_link(
    spot_id: str,
    token: str,
    user: dict = Depends(get_current_user),
):
    """Revoke a share link. Idempotent — re-revoking a revoked token
    returns ok=True without error.
    """
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "owner_user_id": 1})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    if not _owner_or_admin(user, spot):
        raise HTTPException(status_code=403, detail="Forbidden")

    share = await db.spot_shares.find_one({"token": token, "spot_id": spot_id}, {"_id": 0})
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    if not share.get("revoked"):
        await db.spot_shares.update_one(
            {"token": token},
            {"$set": {
                "revoked": True,
                "revoked_at": utcnow(),
                "revoked_by_user_id": user.get("user_id"),
            }},
        )
        if _is_admin(user) and user.get("user_id") != spot.get("owner_user_id"):
            try:
                await audit_log(
                    user,
                    "spot_share_revoked",
                    target_type="spot",
                    target_id=spot_id,
                    after={"token": token},
                )
            except Exception:
                pass

    return {"ok": True, "token": token, "revoked": True}


@router.get("/spots/{spot_id}/shares")
async def list_share_links(
    spot_id: str,
    user: dict = Depends(get_current_user),
):
    """List share links for this spot. Owner / admin only.

    Returns active links first, revoked links last. Excludes any
    internal Mongo fields.
    """
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "owner_user_id": 1})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    if not _owner_or_admin(user, spot):
        raise HTTPException(status_code=403, detail="Forbidden")

    rows = await db.spot_shares.find(
        {"spot_id": spot_id}, {"_id": 0}
    ).sort([("revoked", 1), ("created_at", -1)]).to_list(100)

    items = []
    for r in rows:
        token = r.get("token")
        items.append({
            "share_id": r.get("share_id"),
            "token": token,
            "share_url": f"{WEB_BASE}/api/public/location/{token}" if token else None,
            "label": r.get("label"),
            "revoked": bool(r.get("revoked")),
            "revoked_at": r.get("revoked_at"),
            "created_at": r.get("created_at"),
            "created_by_user_id": r.get("created_by_user_id"),
            "created_by_role": r.get("created_by_role"),
            "last_accessed_at": r.get("last_accessed_at"),
            "access_count": int(r.get("access_count") or 0),
            "show_exact_location": bool(r.get("show_exact_location", False)),
            # Jun 2025 — surface the personal note on the owner list
            # so the "Share Location" sheet can show "what message did
            # I send" for each active link.
            "personal_note": r.get("personal_note"),
            "spot_visibility_at_create": r.get("spot_visibility_at_create"),
        })
    return {"items": items, "count": len(items)}


@router.patch("/spots/{spot_id}/visibility")
async def update_spot_visibility(
    spot_id: str,
    body: VisibilityToggleIn,
    user: dict = Depends(get_current_user),
):
    """Toggle spot visibility (public ↔ private) and the show-exact-
    location preference for private spots.

    Maps:
      visibility=public  → privacy_mode='public', location_display_mode='exact'
      visibility=private → privacy_mode='private',
                           location_display_mode='exact' if show_exact_location
                                                   else 'approximate'

    NOTE: We don't touch 'premium' (Elite-sellable) spots — flipping
    a premium spot through this endpoint would silently demonetize it.
    Owners must use the dedicated marketplace flow for premium toggles.
    """
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    if not _owner_or_admin(user, spot):
        raise HTTPException(status_code=403, detail="Forbidden")

    current_mode = spot.get("privacy_mode") or "public"
    if current_mode == "premium":
        raise HTTPException(
            status_code=400,
            detail=(
                "Premium (sellable) spots can't be toggled here. Use the "
                "marketplace listing controls instead."
            ),
        )

    if body.visibility == "public":
        new_privacy = "public"
        new_display = "exact"
    else:
        new_privacy = "private"
        # Default for private = approximate (hide exact coords) unless
        # the caller explicitly opts into exact.
        if body.show_exact_location is True:
            new_display = "exact"
        else:
            new_display = "approximate"

    before = {
        "privacy_mode": current_mode,
        "location_display_mode": spot.get("location_display_mode"),
    }
    after = {
        "privacy_mode": new_privacy,
        "location_display_mode": new_display,
        "updated_at": utcnow(),
    }
    await db.spots.update_one({"spot_id": spot_id}, {"$set": after})

    if _is_admin(user) and user.get("user_id") != spot.get("owner_user_id"):
        try:
            await audit_log(
                user,
                "spot_visibility_update",
                target_type="spot",
                target_id=spot_id,
                before=before,
                after=after,
            )
        except Exception:
            pass

    return {
        "ok": True,
        "spot_id": spot_id,
        "visibility": "public" if new_privacy == "public" else "private",
        "show_exact_location": (new_display == "exact"),
        "privacy_mode": new_privacy,
        "location_display_mode": new_display,
    }


@router.patch("/spots/{spot_id}/info")
async def update_spot_info(
    spot_id: str,
    body: SpotInfoUpdateIn,
    user: dict = Depends(get_current_user),
):
    """Owner / admin edits owner-allowed display fields on a spot.

    Only fields in OWNER_EDITABLE_FIELDS are accepted. Coordinates,
    visibility_status, owner_user_id, moderation flags, premium status
    etc. CANNOT be changed via this endpoint. Admins with broader
    edit needs still use the routes/admin.py overrides.
    """
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    if not _owner_or_admin(user, spot):
        raise HTTPException(status_code=403, detail="Forbidden")

    raw = body.model_dump(exclude_unset=True, exclude_none=False)
    update: Dict[str, Any] = {}
    rejected_keys: List[str] = []
    for k, v in raw.items():
        if k in OWNER_EDITABLE_FIELDS:
            # Normalize strings — strip + empty→None.
            if isinstance(v, str):
                v2 = v.strip()
                update[k] = v2 if v2 else None
            else:
                update[k] = v
        else:
            rejected_keys.append(k)

    if rejected_keys:
        raise HTTPException(
            status_code=400,
            detail=f"Fields not editable here: {', '.join(sorted(rejected_keys))}",
        )

    if not update:
        return {"ok": True, "spot_id": spot_id, "no_changes": True}

    # Bounds for safety on a few common free-text fields
    for f in ("title", "description"):
        v = update.get(f)
        if isinstance(v, str) and len(v) > 2000:
            update[f] = v[:2000]

    update["updated_at"] = utcnow()
    await db.spots.update_one({"spot_id": spot_id}, {"$set": update})

    if _is_admin(user) and user.get("user_id") != spot.get("owner_user_id"):
        try:
            before_snapshot = {k: spot.get(k) for k in update.keys() if k != "updated_at"}
            await audit_log(
                user,
                "spot_info_update",
                target_type="spot",
                target_id=spot_id,
                before=before_snapshot,
                after={k: v for k, v in update.items() if k != "updated_at"},
            )
        except Exception:
            pass

    return {"ok": True, "spot_id": spot_id, "updated_fields": sorted(update.keys())}


# ─────────────────────────────────────────────────────────────────────
# Public (unauthenticated) endpoints
# ─────────────────────────────────────────────────────────────────────


async def _bump_access_counter(token: str) -> None:
    """Best-effort access counter update. Failures are silent so the
    public view never blocks on telemetry.
    """
    try:
        await db.spot_shares.update_one(
            {"token": token},
            {"$set": {"last_accessed_at": utcnow()}, "$inc": {"access_count": 1}},
        )
    except Exception:
        pass


@router.get("/spots/shared/{token}")
async def get_shared_spot_json(token: str):
    """Public JSON read of a shared spot. No auth.

    Returns the sanitized payload OR the generic "unavailable" 404
    body. ANY of (revoked / suspended owner / rejected spot / deleted
    spot / never-existed token) produces an IDENTICAL response so no
    information leaks.
    """
    ctx = await _resolve_share_or_unavailable(token)
    if not ctx:
        return _unavailable_response()
    payload = _build_public_view(ctx)
    await _bump_access_counter(token)
    return payload


@router.get("/public/location/{share_slug}")
async def public_location_view(share_slug: str, request: Request):
    """Public web view of a shared location.

    Honours `Accept: application/json` (returns the sanitized JSON
    payload, same as GET /api/spots/shared/{token}) or returns a
    minimal HTML page with the right OG metadata. The unavailable
    parity is identical in both response shapes.
    """
    ctx = await _resolve_share_or_unavailable(share_slug)
    accept = (request.headers.get("accept") or "").lower()
    wants_json = "application/json" in accept and "text/html" not in accept

    # Canonical URL — emit exactly the path we were served from so a
    # future move to `/share/location/{slug}` is a clean 301 + canonical
    # update without breaking iMessage / WhatsApp / Slack cached previews.
    canonical_url = f"{WEB_BASE}/api/public/location/{share_slug}"

    if not ctx:
        if wants_json:
            return _unavailable_response()
        html = _render_unavailable_html(canonical_url=canonical_url)
        return HTMLResponse(content=html, status_code=UNAVAILABLE_STATUS_CODE)

    await _bump_access_counter(share_slug)
    if wants_json:
        return _build_public_view(ctx)

    # Jun 2025 — public share page must include the same images a
    # logged-in user sees on the in-app Location Detail page hero
    # carousel. The in-app hero carousel = cover + spot.images[] +
    # approved community uploads (from `spot_community_uploads`).
    # We already have the first two via the sanitized payload; fetch
    # the third here and attach to ctx so the renderer can merge them
    # into one clean grid. Followers-only items are dropped because
    # the share viewer is an anonymous client, not a follower.
    try:
        spot_id_for_uploads = (ctx.get("spot") or {}).get("spot_id")
        if spot_id_for_uploads:
            cu_rows = await db.spot_community_uploads.find(
                {
                    "spot_id": spot_id_for_uploads,
                    "moderation_status": "approved",
                },
                {"_id": 0, "image_url": 1, "visibility": 1},
            ).sort("created_at", -1).limit(60).to_list(60)
            ctx["community_image_urls"] = [
                (r or {}).get("image_url")
                for r in cu_rows
                if r
                and isinstance(r.get("image_url"), str)
                and r.get("image_url").strip()
                and (r.get("visibility") or "public") != "followers"
            ]
        else:
            ctx["community_image_urls"] = []
    except Exception:
        # Community uploads are a non-critical enrichment. Never block
        # the share page render if the lookup fails for any reason.
        ctx["community_image_urls"] = []

    return HTMLResponse(content=_render_public_html(ctx, canonical_url=canonical_url))


# ─────────────────────────────────────────────────────────────────────
# HTML rendering helpers
# ─────────────────────────────────────────────────────────────────────


def _esc(s: Any) -> str:
    if s is None:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _render_unavailable_html(canonical_url: Optional[str] = None) -> str:
    canonical_tag = f'<link rel="canonical" href="{_esc(canonical_url)}" />' if canonical_url else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Link unavailable · LumaScout</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
{canonical_tag}
<meta property="og:title" content="{_esc(GENERIC_OG_TITLE)}" />
<meta property="og:description" content="{_esc(UNAVAILABLE_BODY['message'])}" />
<meta property="og:image" content="{_esc(GENERIC_OG_IMAGE)}" />
<meta name="twitter:card" content="summary_large_image" />
<style>
body {{ margin:0; background:#0a0a0a; color:#fff; font-family:-apple-system,system-ui,sans-serif;
       min-height:100vh; display:flex; align-items:center; justify-content:center; padding:40px; text-align:center; }}
.wrap {{ max-width: 420px; }}
h1 {{ font-family:Georgia,"Times New Roman",serif; font-size:28px; margin:0 0 12px; font-weight:600; }}
p {{ opacity:.7; line-height:1.5; }}
</style>
</head>
<body>
<div class="wrap">
<h1>Link unavailable</h1>
<p>{_esc(UNAVAILABLE_BODY['message'])}</p>
</div>
</body>
</html>"""


def _render_public_html(ctx: Dict[str, Any], canonical_url: Optional[str] = None) -> str:
    """Render the public, client-facing share page.

    Jun 2025 — "Share Location" redesign:
      • Bright WHITE editorial layout (not the dark app theme) because
        recipients are CLIENTS, not photographers using the app.
      • Logo + LumaScout wordmark in a sticky top bar AND footer.
      • Photographer's personal note rendered as a hero-quote block
        directly under the cover image.
      • Sample community photos in a clean gallery grid.
      • Open-in-maps CTA, but only when we're allowed to share exact
        coords for this share row.
    """
    payload = _build_public_view(ctx)
    is_public = ctx["is_public_spot"]
    show_exact = ctx["show_exact_location"]
    share = ctx.get("share") or {}
    spot = payload["spot"]
    owner = ctx.get("owner") or {}
    og = payload["og"]
    robots = payload["robots"]
    canonical_tag = f'<link rel="canonical" href="{_esc(canonical_url)}" />' if canonical_url else ""

    title = spot.get("title") or GENERIC_OG_TITLE
    desc = (spot.get("description") or "").strip()
    hero = spot.get("hero_image_url") or GENERIC_OG_IMAGE
    lat = spot.get("latitude")
    lng = spot.get("longitude")
    open_in_maps = ""
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and show_exact:
        open_in_maps = f"https://maps.apple.com/?q={lat},{lng}"

    personal_note = (share.get("personal_note") or "").strip()

    # Friendly photographer attribution line: "Shared by Keith Larson"
    owner_name = (
        owner.get("display_name") or owner.get("name") or owner.get("username") or ""
    ).strip()
    by_line = f"Shared by {_esc(owner_name)}" if owner_name else "Shared by a LumaScout photographer"

    badges = []
    if not is_public:
        badges.append("Private location")
    if not show_exact:
        badges.append("Approximate area only")

    # ── Best time to shoot — clean single value, not the kitchen-sink ──
    best_time = (spot.get("best_time_of_day") or "").replace("_", " ").strip()
    best_light = (spot.get("best_light_notes") or "").strip()
    best_block = ""
    if best_time or best_light:
        best_value = (best_time.capitalize() if best_time else "Golden hour")
        best_block = f"""
<div class="card">
  <div class="card-kicker">Best time to shoot</div>
  <div class="best-time">{_esc(best_value)}</div>
  {f'<div class="best-sub">{_esc(best_light)}</div>' if best_light else ''}
</div>
"""

    # ── All location photos for the grid ──────────────────────────
    # Jun 2025 — the public share page must show every image visible
    # on the in-app Location Detail Page. In-app, that's the
    # `orderedImages` memo = cover + spot.images[] + approved
    # community uploads (see useSpotDetail.ts). We mirror that here
    # using:
    #   1. the resolved hero/cover URL (`hero`)
    #   2. the sanitized owner gallery (`payload.spot.images`)
    #   3. approved, public community uploads (`ctx.community_image_urls`,
    #      populated by the public_location_view route handler).
    # Each URL is deduped (preserving order) and any falsy / non-string
    # value is filtered out so the grid never shows a broken tile.
    all_image_urls: list[str] = []
    seen_urls: set[str] = set()

    def _push(u: Any) -> None:
        if not isinstance(u, str):
            return
        s = u.strip()
        if not s or s in seen_urls:
            return
        # Filter the generic OG fallback so we never put a stock
        # placeholder into the per-spot grid.
        if s == GENERIC_OG_IMAGE:
            return
        seen_urls.add(s)
        all_image_urls.append(s)

    # 1. Hero / cover (first slide of the in-app carousel).
    _push(hero)
    # 2. Owner-uploaded gallery (sanitized).
    for im in (payload.get("spot", {}).get("images") or []):
        if isinstance(im, dict):
            _push(im.get("image_url"))
    # 3. Approved community uploads (same pool the in-app /uploads
    #    endpoint surfaces for anonymous viewers).
    for u in (ctx.get("community_image_urls") or []):
        _push(u)

    gallery_html = ""
    if all_image_urls:
        # `loading="lazy"` + `decoding="async"` let browsers defer
        # offscreen loads. `onerror` hides any broken tile so the
        # grid never shows a jagged failed-image gap.
        tiles = "".join(
            f'<div class="gphoto"><img loading="lazy" decoding="async" '
            f'src="{_esc(u)}" alt="" '
            f'onerror="this.parentNode.style.display=\'none\'" /></div>'
            for u in all_image_urls
        )
        gallery_html = tiles

    # ── Notes block (kept light — only show signals clients care about) ──
    notes_pairs = [
        ("Parking", spot.get("parking_notes")),
        ("Walking", spot.get("walking_notes")),
        ("Safety",  spot.get("safety_notes")),
        ("Permit",  spot.get("permit_notes")),
        ("Fee",     spot.get("fee_notes")),
        ("Access",  spot.get("access_notes")),
    ]
    notes_html = "".join(
        f'<div class="row"><div class="k">{_esc(k)}</div><div class="v">{_esc(v)}</div></div>'
        for k, v in notes_pairs if v
    )

    # Logo — the uploaded LumaScout brand image (gold compass mark).
    # Hosted on the public customer-assets CDN so it works in any
    # email client / browser. Wrapped in a small rounded container
    # so it looks polished and never overpowers the page.
    LOGO_URL = "https://customer-assets.emergentagent.com/job_photo-finder-60/artifacts/nzwx34gx_app-logo.jpg"
    logo_svg = (
        f'<img src="{LOGO_URL}" alt="LumaScout" width="22" height="22" '
        f'style="display:block;width:22px;height:22px;border-radius:6px;'
        f'object-fit:cover;background:#0E0E10;" />'
    )

    coord_label = "Exact location" if show_exact else "Approximate area"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{_esc(title)} · LumaScout</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="{_esc(robots)}" />
{canonical_tag}
<meta name="description" content="{_esc(desc[:200])}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="{_esc(og.get('title') or title)}" />
<meta property="og:description" content="{_esc(og.get('description') or desc[:200])}" />
<meta property="og:image" content="{_esc(og.get('image') or hero)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{_esc(og.get('title') or title)}" />
<meta name="twitter:description" content="{_esc(og.get('description') or desc[:200])}" />
<meta name="twitter:image" content="{_esc(og.get('image') or hero)}" />
<style>
*,*::before,*::after {{ box-sizing: border-box; }}
html,body {{ margin:0; padding:0; }}
body {{
  background:#FAFAF7;
  color:#1A1A1A;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  padding:0 0 80px;
}}
.topbar {{
  position:sticky; top:0; z-index:10;
  display:flex; align-items:center; gap:10px;
  padding:14px 20px;
  background:rgba(250,250,247,0.92);
  backdrop-filter: saturate(140%) blur(10px);
  -webkit-backdrop-filter: saturate(140%) blur(10px);
  border-bottom:1px solid #ECECE6;
}}
.brand {{ display:flex; align-items:center; gap:8px; font-weight:700; color:#1A1A1A;
         text-decoration:none; letter-spacing:0.2px; }}
.brand .name {{ font-size:15px; }}
.brand .name b {{ color:#1A1A1A; }}
.brand .name .gold {{ color:#C98B1B; }}

.hero {{
  width:100%; aspect-ratio: 16/9;
  background:#E8E6DF center/cover no-repeat;
  border-bottom:1px solid #ECECE6;
}}
.wrap {{ max-width: 760px; margin: 0 auto; padding: 28px 22px 0; }}
.kicker {{
  color:#6B6B66; font-size:11px; font-weight:600; letter-spacing:0.6px;
  text-transform:uppercase; margin:0 0 6px;
}}
h1 {{
  font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
  font-size:34px; line-height:1.12; margin:0 0 6px; font-weight:600; letter-spacing:-0.3px;
  color:#1A1A1A;
}}
.byline {{ color:#6B6B66; font-size:14px; margin:0 0 16px; }}
.badges {{ display:flex; gap:8px; flex-wrap:wrap; margin:0 0 22px; }}
.badge {{
  background:#FFF8E7; color:#9C6E0E; padding:4px 12px;
  border-radius:999px; font-size:11.5px; font-weight:600; letter-spacing:0.2px;
  border:1px solid #F1DDA1;
}}

/* Personal note — magazine-style pull quote */
.pnote {{
  margin: 6px 0 24px;
  padding: 18px 22px;
  background: #FFFFFF;
  border-left: 4px solid #C98B1B;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
  font-size: 17px; line-height:1.55; color:#2C2C2A;
  white-space: pre-wrap;
}}
.pnote-kicker {{
  display:block; text-transform:uppercase; letter-spacing:0.8px;
  color:#C98B1B; font-family:-apple-system, "Inter", sans-serif;
  font-weight:700; font-size:10.5px; margin-bottom:6px;
}}

.desc {{ color:#3A3A36; line-height:1.65; margin:0 0 24px; font-size:15.5px; white-space:pre-wrap; }}

/* Generic card */
.card {{
  background:#FFFFFF; border:1px solid #ECECE6; border-radius: 14px;
  padding: 20px; margin: 0 0 14px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}}
.card-kicker {{
  color:#6B6B66; font-size:11px; font-weight:600; letter-spacing:0.5px;
  text-transform:uppercase; margin:0 0 6px;
}}
.best-time {{ font-size:22px; color:#1A1A1A; font-weight:600; letter-spacing:-0.2px;
              font-family: Georgia, "Iowan Old Style", "Times New Roman", serif; }}
.best-sub {{ color:#4A4A45; font-size:14px; line-height:1.5; margin-top:4px; }}

.row {{ display:flex; padding:10px 0; border-bottom:1px solid #F0EFE9; gap:16px; }}
.row:last-child {{ border-bottom:none; }}
.k {{ width:96px; flex:none; color:#6B6B66; font-size:13px; font-weight:600; }}
.v {{ flex:1; line-height:1.55; white-space:pre-wrap; color:#1A1A1A; font-size:14.5px; }}
.coords {{ font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size:13.5px; color:#3A3A36; }}

/* Gallery — all uploaded photos for this location.
   Jun 2025: switched from background-image divs to <img> tiles so
   we get lazy loading + graceful failure (onerror hides the tile),
   and made the grid responsive across phone/tablet/desktop. */
.gallery {{ display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin:0 0 20px; }}
.gphoto {{
  width:100%; aspect-ratio: 1/1; border-radius:10px;
  overflow:hidden;
  background-color:#E8E6DF;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.03);
}}
.gphoto img {{
  width:100%; height:100%; object-fit:cover; display:block;
}}
@media (max-width: 540px) {{
  .gallery {{ grid-template-columns: repeat(2, 1fr); }}
  h1 {{ font-size: 26px; }}
  .pnote {{ font-size: 15.5px; padding: 16px 18px; }}
  .wrap {{ padding-top: 22px; }}
}}
@media (min-width: 900px) {{
  .gallery {{ grid-template-columns: repeat(4, 1fr); }}
}}

.cta {{
  display:inline-flex; align-items:center; gap:8px;
  background:#1A1A1A; color:#FFFFFF; padding:13px 22px;
  border-radius:999px; font-weight:600; text-decoration:none;
  font-size:14px; letter-spacing:0.2px; margin:8px 0 6px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
}}
.cta:hover {{ background:#2A2A2A; }}

.footer {{
  margin-top:38px; padding:18px 22px 0;
  border-top:1px solid #ECECE6;
  display:flex; align-items:center; gap:10px;
  color:#6B6B66; font-size:12px;
}}
.footer .brand .name {{ font-size:13px; }}
</style>
</head>
<body>
  <header class="topbar">
    <a class="brand" href="https://lumascout.app" target="_blank" rel="noopener">
      {logo_svg}
      <span class="name"><b>Luma</b><span class="gold">Scout</span></span>
    </a>
  </header>

  <div class="hero" style="background-image:url('{_esc(hero)}')"></div>

  <div class="wrap">
    <p class="kicker">A LumaScout location</p>
    <h1>{_esc(title)}</h1>
    <p class="byline">{by_line}</p>

    {('<div class="badges">' + ''.join(f'<span class="badge">{_esc(b)}</span>' for b in badges) + '</div>') if badges else ''}

    {f'<div class="pnote"><span class="pnote-kicker">Photographer&rsquo;s note</span>{_esc(personal_note)}</div>' if personal_note else ''}

    {f'<p class="desc">{_esc(desc)}</p>' if desc else ''}

    {best_block}

    {f'<div class="card"><div class="card-kicker">Photos from this spot</div><div class="gallery">{gallery_html}</div></div>' if gallery_html else ''}

    <div class="card">
      <div class="card-kicker">Location</div>
      <div class="row">
        <div class="k">{_esc(coord_label)}</div>
        <div class="v coords">{_esc(lat)}, {_esc(lng)}</div>
      </div>
      {notes_html}
      {f'<a class="cta" href="{_esc(open_in_maps)}" target="_blank" rel="noopener">Open in Maps</a>' if open_in_maps else ''}
    </div>

    <footer class="footer">
      <a class="brand" href="https://lumascout.app" target="_blank" rel="noopener">
        {logo_svg}
        <span class="name"><b>Luma</b><span class="gold">Scout</span></span>
      </a>
      <span>·</span>
      <span>Premium photo locations for photographers</span>
    </footer>
  </div>
</body>
</html>"""
