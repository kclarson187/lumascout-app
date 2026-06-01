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
import logging
import secrets
import uuid
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator

from server import (
    db,
    get_current_user,
    utcnow,
    audit_log,
    require_role,
    raise_paywall,
    plan_of,
    _effective_plan,
)

FREE_SHARE_LINKS_LIMIT = 1
FREE_SHARE_LINKS_UPGRADE_COPY = (
    "You've used your free Share Location link. Upgrade to Pro to "
    "create unlimited share links for clients, shoots, and saved locations."
)

# Jun 2025 Phase 2 — Elite-only premium fields on a Share Location link.
# Max expiry of 365 days bounds the audit window; a "never" expiry is
# expressed by omitting `expires_in_days` from the request.
SHARE_TITLE_MAX_LEN = 80
SHARE_EXPIRY_MAX_DAYS = 365


def _user_is_free(user: Dict[str, Any]) -> bool:
    """Free = no paid plan. Comp_* plans are treated as paid (mirrors
    the convention used elsewhere in `server.py`). The `plan` field is
    set on the user record at subscription-creation time. Missing /
    null / "free" all count as free.
    """
    plan = (user.get("plan") or "free").lower()
    return plan in ("", "free")


def _user_is_elite(user: Dict[str, Any]) -> bool:
    """Elite (paid or comped). Mirrors the `_effective_plan` helper
    so trial_elite / comp_elite / comped staff roles all count.
    Staff (admin / super_admin / moderator / support) are also treated
    as Elite for premium-field validation — they routinely test the
    feature on behalf of users and should never be gated by tier.
    """
    if (user.get("role") or "") in ("admin", "super_admin", "moderator", "support"):
        return True
    return _effective_plan(plan_of(user)) == "elite"

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

    # ── Jun 2025 Phase 2 — Elite-only premium fields ───────────────
    # All four are silently dropped (with a log line) for non-Elite
    # callers in `create_share_link`. The frontend hides the inputs
    # entirely so a polite-curl-user is the only way these reach the
    # server from a non-Elite account.
    share_title: Optional[str] = Field(default=None, max_length=SHARE_TITLE_MAX_LEN)
    hide_scout_notes: Optional[bool] = None
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=SHARE_EXPIRY_MAX_DAYS)
    # Phase 3 — photographer-authored seasonal blurb (Elite). Rendered
    # as a magazine pull-quote on the share page under "Best season"
    # and reproduced verbatim in the PDF itinerary.
    seasonal_notes: Optional[str] = Field(default=None, max_length=600)


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────


def _is_admin(user: Optional[dict]) -> bool:
    if not user:
        return False
    return user.get("role") in ("admin", "super_admin", "moderator")


def _can_manage_share_links(user: Optional[dict]) -> bool:
    """Roles permitted to view/delete ANY user's share links.

    Jun 2025 — separated from `_is_admin` because the share-link
    management surface is also exposed to the **support** role per
    product spec (helping a user who can't reach the in-app revoke
    UI). Other share-link logic still uses `_is_admin` for ownership
    checks where "support" should NOT be able to mint links on
    behalf of a spot owner — the privilege boundary differs.
    """
    if not user:
        return False
    return user.get("role") in ("admin", "super_admin", "moderator", "support")


def _is_super_admin(user: Optional[dict]) -> bool:
    return bool(user) and user.get("role") == "super_admin"


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

    # Jun 2025 Phase 2 — Elite-only expiring links. Treat any past
    # `expires_at` exactly the same way as a hard-deleted token: the
    # public endpoint must show the standard "no longer available"
    # screen and the JSON API must return 404. A background sweeper
    # is intentionally not added here — we don't want the link to keep
    # consuming Mongo storage forever, but the cleanup belongs in a
    # separate maintenance job rather than a hot-path delete.
    expires_at = share.get("expires_at")
    if expires_at:
        try:
            from datetime import timezone as _tz
            # Mongo round-trips datetimes as **naive UTC** but our
            # `utcnow()` helper returns a tz-aware datetime. Naive
            # vs tz-aware compare raises TypeError — normalise both
            # sides to tz-aware UTC before the comparison.
            if isinstance(expires_at, datetime):
                exp = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=_tz.utc)
                now_dt = utcnow() if callable(utcnow) else datetime.now(_tz.utc)
                if not now_dt.tzinfo:
                    now_dt = now_dt.replace(tzinfo=_tz.utc)
                if exp <= now_dt:
                    return None
        except Exception:
            # Defensive — never block render on a clock-comparison hiccup.
            pass

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

    # Jun 2025 Phase 2 — Elite "hide sensitive scout notes" toggle.
    # When the link's owner is on Elite and they ticked the hide-notes
    # switch at create time, strip the fields a working photographer
    # considers proprietary scout data so the client sees the location
    # without the photographer's competitive notes.
    share_row = ctx.get("share") or {}
    if share_row.get("hide_scout_notes"):
        for f in ("parking_notes", "creator_tips", "best_time_of_day"):
            display.pop(f, None)

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

    # Phase 1 gating — Free accounts get exactly ONE active share link
    # in total across their whole account. Pro / Elite / staff are
    # unlimited. Admins / mods / support creating a share on behalf of
    # another user (via `_owner_or_admin` admin branch) are NOT
    # rate-limited here. Once hard-delete shipped, every row in
    # spot_shares is by definition "active" so a simple count_documents
    # is enough; the legacy `revoked: True` filter is left in as a
    # belt-and-suspenders guard against stale data from before cutover.
    is_owner_creating = (user.get("user_id") == spot.get("owner_user_id"))
    if is_owner_creating and _user_is_free(user):
        active_count = await db.spot_shares.count_documents({
            "created_by_user_id": user.get("user_id"),
            "$or": [{"revoked": {"$exists": False}}, {"revoked": False}],
        })
        if active_count >= FREE_SHARE_LINKS_LIMIT:
            raise_paywall(
                "share_links",
                FREE_SHARE_LINKS_UPGRADE_COPY,
                target_plan="pro",
            )

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

    # ── Jun 2025 Phase 2 — Elite-only premium fields ─────────────
    # Custom title, hide-scout-notes toggle, and link expiry are all
    # Elite-tier features. Non-Elite callers that somehow include
    # them in the body (curl, sniffer, stale client) get their fields
    # silently dropped + a structured log entry. This is intentional
    # graceful degradation — we never 402 a paying Pro user mid-mint
    # because the UI is going to hide the inputs from them anyway.
    elite_share_title: Optional[str] = None
    elite_hide_scout_notes = False
    elite_expires_at: Optional[datetime] = None
    elite_seasonal_notes: Optional[str] = None
    # `created_by_was_elite` snapshots the minter's entitlement at
    # create-time so a future downgrade (Elite → Pro) doesn't strip
    # already-shared premium content from links the photographer
    # already sent to clients. The Phase 3 weather / sun / PDF render
    # path keys off THIS flag, not the user's live plan.
    created_by_was_elite = False
    if _user_is_elite(user):
        created_by_was_elite = True
        if body.share_title:
            elite_share_title = body.share_title.strip()[:SHARE_TITLE_MAX_LEN] or None
        elite_hide_scout_notes = bool(body.hide_scout_notes)
        if body.expires_in_days:
            try:
                from datetime import timedelta as _td
                elite_expires_at = (now if isinstance(now, datetime) else datetime.utcnow()) + _td(
                    days=int(body.expires_in_days)
                )
            except Exception:
                elite_expires_at = None
        if body.seasonal_notes:
            elite_seasonal_notes = body.seasonal_notes.strip()[:600] or None
    else:
        if body.share_title or body.hide_scout_notes is not None or body.expires_in_days or body.seasonal_notes:
            logging.getLogger("lumascout.shares").info(
                "elite_fields_dropped user_id=%s plan=%s role=%s share_title_set=%s hide_notes_set=%s expires_set=%s seasonal_set=%s",
                user.get("user_id"), plan_of(user), user.get("role"),
                bool(body.share_title), body.hide_scout_notes is not None, bool(body.expires_in_days),
                bool(body.seasonal_notes),
            )

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
        # Phase 2 Elite-only fields (None / False for non-Elite minters).
        "share_title": elite_share_title,
        "hide_scout_notes": elite_hide_scout_notes,
        "expires_at": elite_expires_at,
        # Phase 3 — seasonal blurb + Elite-at-mint snapshot. The flag
        # is what the public renderer + the PDF endpoint key off so
        # premium content survives a Pro downgrade.
        "seasonal_notes": elite_seasonal_notes,
        "created_by_was_elite": created_by_was_elite,
        # Jun 2026 — full sharer plan snapshot. `created_by_was_elite` is
        # kept above for backward compat with existing render paths. This
        # new field captures Pro vs Free vs Elite vs comp_* so the public
        # share page / PDF / weather block can render the correct
        # PHOTOGRAPHER'S tier (not the anonymous viewer's tier).
        "sharer_plan_at_create": (plan_of(user) or "free").lower(),
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


async def _write_share_link_audit(
    *,
    share: Dict[str, Any],
    spot: Optional[Dict[str, Any]],
    actor: Dict[str, Any],
    reason: Optional[str] = None,
) -> None:
    """Record a hard-delete event into `share_link_audit_logs`.

    This collection is SEPARATE from the general `audit_logs` collection
    so the share-link audit trail can be queried efficiently without
    paging through unrelated admin actions. The token itself is stored
    for traceability but is NEVER reusable — the active `spot_shares`
    record is gone by the time this entry lands. The audit row alone
    cannot resolve a public link (only `_resolve_share_or_unavailable`
    can, and it reads `spot_shares` exclusively).

    Schema (matches the spec in the feature request):
      • audit_id                — `sla_<12hex>` primary key
      • deleted_share_link_id   — original share_id
      • token                   — preserved for forensics
      • location_id / location_name
      • deleted_by_user_id / deleted_by_role
      • original_created_by_user_id
      • deleted_at              — ISO timestamp
      • reason                  — optional free-text
      • action_type             — fixed string "share_link_hard_deleted"
    """
    try:
        await db.share_link_audit_logs.insert_one({
            "audit_id": f"sla_{uuid.uuid4().hex[:12]}",
            "deleted_share_link_id": share.get("share_id"),
            "token": share.get("token"),
            "location_id": share.get("spot_id"),
            "location_name": (spot or {}).get("title"),
            "deleted_by_user_id": actor.get("user_id"),
            "deleted_by_role": actor.get("role"),
            "original_created_by_user_id": share.get("created_by_user_id"),
            "deleted_at": utcnow(),
            "reason": (reason or "").strip() or None,
            "action_type": "share_link_hard_deleted",
        })
    except Exception:
        # Audit logging is best-effort — never block a hard-delete if
        # the audit collection is briefly unavailable. The deletion
        # has the higher security priority.
        pass


@router.delete("/spots/{spot_id}/share/{token}")
async def revoke_share_link(
    spot_id: str,
    token: str,
    user: dict = Depends(get_current_user),
):
    """Revoke a share link.

    Jun 2025 — semantics changed from soft-revoke to **hard delete**:
      1. Write a `share_link_audit_logs` entry capturing who/what/when.
      2. Remove the row from `spot_shares` outright.

    After this returns, the public token is immediately resolveable
    only as "unavailable" (see `_resolve_share_or_unavailable`, which
    returns None when the row is missing). The deletion is idempotent
    — calling it twice returns ok=True without error.

    The response still carries `revoked: True` for backward compat
    with the existing iOS / Android clients that key off that field
    to remove the row from the list. New clients should read `deleted`
    instead — both are set to true.
    """
    spot = await db.spots.find_one({"spot_id": spot_id}, {"_id": 0, "owner_user_id": 1, "title": 1})
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")

    share = await db.spot_shares.find_one({"token": token, "spot_id": spot_id}, {"_id": 0})
    # Idempotent — if the row is already gone, return ok so the client
    # UI can prune the entry without showing an error.
    if not share:
        return {"ok": True, "token": token, "revoked": True, "deleted": True, "already_deleted": True}

    # Permission: owner, OR support/moderator/admin/super_admin.
    # `_owner_or_admin` uses `_is_admin` which already covers
    # moderator/admin/super_admin. Support is added via the broader
    # `_can_manage_share_links` check below.
    if not (_owner_or_admin(user, spot) or _can_manage_share_links(user)):
        raise HTTPException(status_code=403, detail="Forbidden")

    # 1. Audit FIRST so we have provenance even if the delete races
    #    against, say, a TTL collection cleanup. Spec says writes are
    #    best-effort so a failed audit cannot orphan the share row
    #    on the active list.
    await _write_share_link_audit(share=share, spot=spot, actor=user)

    # 2. Hard delete from the active collection.
    await db.spot_shares.delete_one({"token": token, "spot_id": spot_id})

    # 3. Mirror the deletion into the general admin audit log when an
    #    admin / mod / support actor deletes someone else's link, so
    #    the existing dashboards continue to surface it without us
    #    having to teach them about the new collection too.
    if _can_manage_share_links(user) and user.get("user_id") != spot.get("owner_user_id"):
        try:
            await audit_log(
                user,
                "spot_share_hard_deleted",
                target_type="spot",
                target_id=spot_id,
                before={"token": token, "share_id": share.get("share_id")},
                after=None,
            )
        except Exception:
            pass

    return {"ok": True, "token": token, "revoked": True, "deleted": True}


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
        # Jun 2025 — new revokes hard-delete, but legacy rows from
        # before the cutover may still carry `revoked: True`. Filter
        # them out defensively so the active list is clean.
        {"spot_id": spot_id, "$or": [{"revoked": {"$exists": False}}, {"revoked": False}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)

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
            # Jun 2025 Phase 2 — Elite-only fields. None / False for
            # links minted by non-Elite owners. Surfaced unconditionally
            # so the owner UI can render the right badges/copy.
            "share_title": r.get("share_title"),
            "hide_scout_notes": bool(r.get("hide_scout_notes")),
            "expires_at": r.get("expires_at"),
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


async def _enrich_ctx_for_full_render(ctx: Dict[str, Any]) -> None:
    """Populate the share `ctx` with the extra fields the full
    public-share renderer needs:
      • `community_image_urls` — approved public community uploads
      • `forecast_5day`        — Open-Meteo 5-day daily forecast
      • `light_days_5`         — 5-day sun + golden hour table

    Shared between the public HTML route and the PDF export so both
    surfaces use the SAME data adapter (per Jun 2025 PDF-replica spec).
    Each enrichment is independently best-effort — a flaky upstream
    must never block the render.
    """
    # ── Community uploads ────────────────────────────────────────
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
        ctx["community_image_urls"] = []

    # ── Elite-only 5-day weather + sun ──────────────────────────
    share_row = ctx.get("share") or {}
    spot_doc = ctx.get("spot") or {}
    if share_row.get("created_by_was_elite") and spot_doc.get("latitude") and spot_doc.get("longitude"):
        try:
            from routes.shoot_plan import _fetch_weather as _sp_fetch_weather
            ctx["forecast_5day"] = await _sp_fetch_weather(
                float(spot_doc["latitude"]), float(spot_doc["longitude"])
            )
        except Exception:
            ctx["forecast_5day"] = None
        try:
            from routes.shoot_plan import _compute_light_plan as _sp_light_plan
            from datetime import date as _date_e, timedelta as _td_e
            today = _date_e.today()
            light_days = []
            for i in range(5):
                try:
                    light_days.append(
                        _sp_light_plan(
                            float(spot_doc["latitude"]),
                            float(spot_doc["longitude"]),
                            when=today + _td_e(days=i),
                        )
                    )
                except Exception:
                    light_days.append(None)
            ctx["light_days_5"] = light_days
        except Exception:
            ctx["light_days_5"] = None
    else:
        ctx["forecast_5day"] = None
        ctx["light_days_5"] = None


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

    # Enrich ctx with community uploads + 5-day weather/sun. Shared
    # adapter so the PDF endpoint produces an identical payload.
    await _enrich_ctx_for_full_render(ctx)

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


def _render_public_html(ctx: Dict[str, Any], canonical_url: Optional[str] = None, for_pdf: bool = False) -> str:
    """Render the public, client-facing share page.

    When `for_pdf=True`, emits a print-friendly variant used by the
    PDF endpoint: drops the sticky top bar, removes the "Download PDF"
    CTA (the PDF shouldn't reference itself), adds @page rules and
    `break-inside: avoid` hints so cards don't split mid-page. The
    content is otherwise identical to what clients see at
    `/api/public/location/{token}` — same data adapter, same order.
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

    # Jun 2025 Phase 2 — Elite "Custom share title" overrides the
    # rendered H1. We deliberately do NOT change `og.title` (Open
    # Graph) — that one stays based on the underlying spot so search
    # engine and rich-link previews still reflect the location's real
    # name. The override is purely the on-page H1 the client sees.
    title = spot.get("title") or GENERIC_OG_TITLE
    custom_title = (share.get("share_title") or "").strip()
    if custom_title:
        title = custom_title
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

    # ── Jun 2025 Phase 3 — Elite premium planning block ──────────
    # Renders only when the share was Elite-minted (snapshot at create
    # time). Contains: 5-day weather grid, 5-day sun/golden-hour table,
    # seasonal blurb, and the PDF itinerary download link. Each card
    # short-circuits if its data source isn't available so a Pro
    # downgrade or an Open-Meteo blip never breaks the whole page.
    elite_planning_html = ""
    if share.get("created_by_was_elite"):
        elite_planning_html = _render_elite_planning_block(ctx, include_pdf_cta=not for_pdf)

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
{('@page { size: Letter; margin: 0.45in; }'
  '.topbar { position: static !important; background:#FFFFFF !important; backdrop-filter:none !important; -webkit-backdrop-filter:none !important; border-bottom:1px solid #ECECE6; }'
  '.hero { aspect-ratio: 16/9; height: 3.2in; background-size: cover; background-position: center; }'
  '.wrap { max-width: 100%; padding: 22px 0 0; }'
  'body { padding: 0; }'
  '.card { break-inside: avoid; page-break-inside: avoid; }'
  '.gallery { display:grid !important; grid-template-columns: repeat(3, 1fr) !important; gap:6px; }'
  '.gphoto { aspect-ratio: 1/1; break-inside: avoid; page-break-inside: avoid; }'
  '.gphoto img { width:100%; height:100%; object-fit: cover; }'
  '.wgrid { display:grid !important; grid-template-columns: repeat(5, 1fr) !important; break-inside: avoid; }'
  '.wchip { break-inside: avoid; }'
  '.suntable { break-inside: avoid; }'
  '.pnote { break-inside: avoid; }'
  'h1 { break-after: avoid; page-break-after: avoid; }'
  '.cta { box-shadow:none !important; }'
  '.footer { margin-top: 26px; }') if for_pdf else ''}
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

    {elite_planning_html}

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


# ─────────────────────────────────────────────────────────────────────
# Admin / support / moderator — share-link management surface
# ─────────────────────────────────────────────────────────────────────
# Three endpoints scoped to the broader staff role set:
#
#   GET    /api/admin/share-links              — paginated active list
#   DELETE /api/admin/share-links/{token}      — hard delete any token
#   GET    /api/admin/share-links/audit        — super_admin audit feed
#
# Hard-delete intentionally calls the same `_write_share_link_audit`
# helper used by the owner-facing revoke endpoint above so the audit
# trail has a single, deterministic shape regardless of who triggered
# the deletion.


@router.get("/admin/share-links")
async def admin_list_share_links(
    limit: int = 50,
    cursor: int = 0,
    q: Optional[str] = None,
    user: dict = Depends(require_role("support")),
):
    """List active share links across the platform.

    Available to: support, moderator, admin, super_admin (via
    `require_role("support")` which permits anything support-or-higher).

    Excludes any record with `revoked=True` (legacy soft-revoked rows
    from before the cutover). Hard-deleted rows are gone from the
    collection entirely so they need no filter.

    Query:
      • limit  — page size, 1-100, default 50
      • cursor — offset for pagination (Mongo skip), default 0
      • q      — optional fuzzy match on spot title (case-insensitive).
                 Resolves spot_ids first, then queries shares — keeps
                 the index plan on `spot_shares` simple.
    """
    page_size = max(1, min(int(limit or 50), 100))
    skip = max(0, int(cursor or 0))

    mongo_filter: Dict[str, Any] = {
        "$or": [{"revoked": {"$exists": False}}, {"revoked": False}],
    }
    matched_spot_titles: Dict[str, str] = {}

    if q:
        # Spot-title text search → spot_ids → shares filter.
        spot_q = {"title": {"$regex": q.strip()[:80], "$options": "i"}}
        spot_rows = await db.spots.find(
            spot_q, {"_id": 0, "spot_id": 1, "title": 1}
        ).limit(200).to_list(200)
        if not spot_rows:
            return {"items": [], "count": 0, "next_cursor": None}
        spot_ids = [r["spot_id"] for r in spot_rows]
        for r in spot_rows:
            matched_spot_titles[r["spot_id"]] = r.get("title") or ""
        mongo_filter["spot_id"] = {"$in": spot_ids}

    cursor_q = (
        db.spot_shares.find(mongo_filter, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(page_size + 1)  # +1 to peek at next page
    )
    rows = await cursor_q.to_list(page_size + 1)
    has_more = len(rows) > page_size
    rows = rows[:page_size]

    # Resolve spot titles for any rows whose title we didn't already
    # match via the text-search path. One batched query.
    missing_spot_ids = [
        r["spot_id"] for r in rows
        if r.get("spot_id") and r["spot_id"] not in matched_spot_titles
    ]
    if missing_spot_ids:
        for sp in await db.spots.find(
            {"spot_id": {"$in": missing_spot_ids}},
            {"_id": 0, "spot_id": 1, "title": 1},
        ).to_list(len(missing_spot_ids)):
            matched_spot_titles[sp["spot_id"]] = sp.get("title") or ""

    items = []
    for r in rows:
        token = r.get("token")
        spot_id = r.get("spot_id")
        items.append({
            "share_id": r.get("share_id"),
            "token": token,
            "share_url": f"{WEB_BASE}/api/public/location/{token}" if token else None,
            "spot_id": spot_id,
            "spot_title": matched_spot_titles.get(spot_id) if spot_id else None,
            "created_at": r.get("created_at"),
            "created_by_user_id": r.get("created_by_user_id"),
            "created_by_role": r.get("created_by_role"),
            "last_accessed_at": r.get("last_accessed_at"),
            "access_count": int(r.get("access_count") or 0),
            "show_exact_location": bool(r.get("show_exact_location", False)),
            "personal_note": r.get("personal_note"),
            "label": r.get("label"),
        })
    return {
        "items": items,
        "count": len(items),
        "next_cursor": (skip + page_size) if has_more else None,
    }


class AdminHardDeleteIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


@router.delete("/admin/share-links/{token}")
async def admin_hard_delete_share_link(
    token: str,
    body: Optional[AdminHardDeleteIn] = None,
    user: dict = Depends(require_role("support")),
):
    """Hard-delete a share link by token, regardless of ownership.

    Available to: support, moderator, admin, super_admin. Writes both
    a `share_link_audit_logs` row (forensic schema) and a general
    `audit_logs` row (`action="share_link_hard_deleted"`) so existing
    admin dashboards continue to see staff actions. Idempotent.
    """
    share = await db.spot_shares.find_one({"token": token}, {"_id": 0})
    if not share:
        # Already gone — still log the no-op via the audit table so
        # the action is traceable.
        return {"ok": True, "token": token, "deleted": True, "already_deleted": True}

    spot = await db.spots.find_one(
        {"spot_id": share.get("spot_id")},
        {"_id": 0, "spot_id": 1, "title": 1, "owner_user_id": 1},
    )
    reason = (body.reason if body else None) or None

    await _write_share_link_audit(share=share, spot=spot, actor=user, reason=reason)
    await db.spot_shares.delete_one({"token": token})

    try:
        await audit_log(
            user,
            "share_link_hard_deleted",
            target_type="spot_share",
            target_id=share.get("share_id"),
            before={"token": token, "spot_id": share.get("spot_id")},
            after=None,
            notes=reason,
        )
    except Exception:
        pass

    return {"ok": True, "token": token, "deleted": True}


@router.get("/admin/share-links/grouped")
async def admin_grouped_share_links(
    multiple_only: bool = False,
    q: Optional[str] = None,
    sort: str = "newest",
    user: dict = Depends(require_role("admin")),
):
    """Grouped Active Share Links dashboard payload — admin/super_admin only.

    Returns:
      • items     — list of LocationGroup, one per spot with at least
                    one active link, sorted by `sort` parameter
                    (`newest` · `most_viewed` · `duplicate_count`).
      • summary   — {total_links, total_locations, multi_locations,
                     total_views}.

    Filters:
      • multiple_only=true — restrict to locations whose
        `active_link_count > 1` (the "Multiple Links Only" tab).
      • q=… — case-insensitive substring match against location name
        OR share-link creator's display_name.

    Each link inside a group is enriched with the creator's
    `display_name` and `creator_membership_tier` (effective plan)
    from a single batched users lookup. Revoked or expired tokens
    are excluded by the same logic as the per-spot list endpoint.

    Audit-feed access (separate endpoint) is also admin-only — this
    page is intentionally a peer of `/admin/audit`, not of the
    moderator-grade content tools.
    """
    # 1. Fetch every active share row in one shot. The active set
    #    grows linearly with paid users, so a single find() with a
    #    sensible ceiling is more than enough until traffic 10×s.
    rows = await db.spot_shares.find(
        {"$or": [{"revoked": {"$exists": False}}, {"revoked": False}]},
        {"_id": 0},
    ).sort("created_at", -1).limit(2000).to_list(2000)

    # Defensive expiry filter — `expires_at` on Elite-minted links is
    # checked in `_resolve_share_or_unavailable` for the public path
    # but a raw collection scan still surfaces them. Drop expired here
    # so admin counts don't double-count effectively-dead links.
    now_dt = utcnow()
    if now_dt.tzinfo is None:
        now_dt = now_dt.replace(tzinfo=timezone.utc)
    def _is_live(r: Dict[str, Any]) -> bool:
        exp = r.get("expires_at")
        if not isinstance(exp, datetime):
            return True
        exp_tz = exp if exp.tzinfo else exp.replace(tzinfo=timezone.utc)
        return exp_tz > now_dt
    rows = [r for r in rows if _is_live(r)]

    if not rows:
        return {
            "items": [],
            "summary": {
                "total_links": 0,
                "total_locations": 0,
                "multi_locations": 0,
                "total_views": 0,
            },
        }

    # 2. Batched user + spot lookups so we don't N+1 the DB.
    spot_ids = list({r.get("spot_id") for r in rows if r.get("spot_id")})
    user_ids = list({
        r.get("created_by_user_id") for r in rows
        if r.get("created_by_user_id")
    })
    # Also pull owner ids for the location-owner column.
    owner_user_ids: list[str] = []

    spots_by_id: Dict[str, Dict[str, Any]] = {}
    async for sp in db.spots.find(
        {"spot_id": {"$in": spot_ids}},
        {"_id": 0, "spot_id": 1, "title": 1, "owner_user_id": 1},
    ):
        spots_by_id[sp["spot_id"]] = sp
        if sp.get("owner_user_id"):
            owner_user_ids.append(sp["owner_user_id"])

    users_by_id: Dict[str, Dict[str, Any]] = {}
    all_user_ids = list(set(user_ids + owner_user_ids))
    if all_user_ids:
        async for u in db.users.find(
            {"user_id": {"$in": all_user_ids}},
            {"_id": 0, "user_id": 1, "display_name": 1, "email": 1, "plan": 1, "role": 1},
        ):
            users_by_id[u["user_id"]] = u

    def _user_label(uid: Optional[str]) -> Optional[str]:
        u = users_by_id.get(uid or "") if uid else None
        if not u:
            return None
        return u.get("display_name") or (u.get("email") or "").split("@", 1)[0] or None

    def _user_tier(uid: Optional[str]) -> Optional[str]:
        u = users_by_id.get(uid or "") if uid else None
        if not u:
            return None
        try:
            return _effective_plan(plan_of(u))
        except Exception:
            return u.get("plan") or "free"

    # 3. Group rows by spot_id.
    groups: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        sid = r.get("spot_id") or "unknown"
        spot_doc = spots_by_id.get(sid, {})
        if sid not in groups:
            owner_id = spot_doc.get("owner_user_id")
            groups[sid] = {
                "location_id": sid,
                "location_name": spot_doc.get("title") or "Unknown location",
                "location_owner_id": owner_id,
                "location_owner_name": _user_label(owner_id),
                "links": [],
            }
        token = r.get("token")
        groups[sid]["links"].append({
            "share_link_id": r.get("share_id"),
            "token": token,
            "share_token_short": (token or "")[:8] + "…" if token else None,
            "share_url": f"{WEB_BASE}/api/public/location/{token}" if token else None,
            "share_link_creator_id": r.get("created_by_user_id"),
            "share_link_creator_name": _user_label(r.get("created_by_user_id")),
            "creator_membership_tier": _user_tier(r.get("created_by_user_id")),
            "created_at": r.get("created_at"),
            "view_count": int(r.get("access_count") or 0),
            "last_viewed_at": r.get("last_accessed_at"),
            "status": "active",
            "label": r.get("label"),
            "personal_note": r.get("personal_note"),
            "show_exact_location": bool(r.get("show_exact_location")),
            # Phase 2/3 surface — useful at-a-glance for admins.
            "share_title": r.get("share_title"),
            "hide_scout_notes": bool(r.get("hide_scout_notes")),
            "expires_at": r.get("expires_at"),
            "created_by_was_elite": bool(r.get("created_by_was_elite")),
        })

    # 4. Per-group derived stats.
    for g in groups.values():
        g["active_link_count"] = len(g["links"])
        g["is_multiple"] = g["active_link_count"] > 1
        g["total_views"] = sum(int(l["view_count"]) for l in g["links"])
        # Newest first within the group so the most recent client
        # share is always at the top of the card.
        g["links"].sort(
            key=lambda l: (l.get("created_at") or datetime.min),
            reverse=True,
        )
        # Pick the most recent created_at across the group's links
        # so the outer sort can compare apples-to-apples.
        g["most_recent_link_at"] = g["links"][0].get("created_at") if g["links"] else None

    items = list(groups.values())

    # 5. Filters (server-side, before the outer sort so the result is
    #    deterministic regardless of the in-memory pipeline).
    if multiple_only:
        items = [g for g in items if g["is_multiple"]]
    if q:
        needle = q.strip().lower()
        if needle:
            def _match(g: Dict[str, Any]) -> bool:
                if needle in (g.get("location_name") or "").lower():
                    return True
                if needle in (g.get("location_owner_name") or "").lower():
                    return True
                for l in g["links"]:
                    if needle in (l.get("share_link_creator_name") or "").lower():
                        return True
                return False
            items = [g for g in items if _match(g)]

    # 6. Outer sort.
    if sort == "most_viewed":
        items.sort(key=lambda g: g["total_views"], reverse=True)
    elif sort == "duplicate_count":
        items.sort(key=lambda g: g["active_link_count"], reverse=True)
    else:  # newest (default)
        items.sort(
            key=lambda g: (g.get("most_recent_link_at") or datetime.min),
            reverse=True,
        )

    # 7. Summary cards for the dashboard header.
    summary = {
        "total_links": sum(g["active_link_count"] for g in groups.values()),
        "total_locations": len(groups),
        "multi_locations": sum(1 for g in groups.values() if g["is_multiple"]),
        "total_views": sum(g["total_views"] for g in groups.values()),
    }

    return {"items": items, "summary": summary}


@router.get("/admin/share-links/audit")
async def admin_share_link_audit(
    limit: int = 50,
    cursor: int = 0,
    user: dict = Depends(require_role("admin")),
):
    """Read the share-link hard-delete audit feed.

    Available to: admin + super_admin (NOT moderator, NOT support —
    they can see/delete but the historical audit feed stays narrower
    to keep the surface tight). `require_role("admin")` already permits
    super_admin to fall through.
    """
    page_size = max(1, min(int(limit or 50), 100))
    skip = max(0, int(cursor or 0))

    cursor_q = (
        db.share_link_audit_logs.find({}, {"_id": 0})
        .sort("deleted_at", -1)
        .skip(skip)
        .limit(page_size + 1)
    )
    rows = await cursor_q.to_list(page_size + 1)
    has_more = len(rows) > page_size
    rows = rows[:page_size]

    return {
        "items": rows,
        "count": len(rows),
        "next_cursor": (skip + page_size) if has_more else None,
    }


# ─────────────────────────────────────────────────────────────────────
# Jun 2025 Phase 3 — Elite premium content
# ─────────────────────────────────────────────────────────────────────


def _fmt_time(dt_val: Any) -> str:
    """Render a datetime as `H:MM AM/PM` in its own tzinfo, or '—' if
    the value isn't a usable datetime. Used by both the HTML render
    and the PDF builder so the wall-clock format is identical.
    """
    if not isinstance(dt_val, datetime):
        return "—"
    try:
        s = dt_val.strftime("%-I:%M %p")
    except ValueError:
        # Windows / non-glibc fallback
        s = dt_val.strftime("%I:%M %p").lstrip("0")
    return s


def _render_elite_planning_block(ctx: Dict[str, Any], include_pdf_cta: bool = True) -> str:
    """Phase 3 — premium planning card stack for Elite-minted shares.

    Three cards stacked top-down:
      1. 5-day weather (Open-Meteo daily forecast — chip per day).
      2. Sun & golden hour — sunrise / sunset / golden hour AM&PM for
         the next 5 days in the spot's local timezone.
      3. Photographer's seasonal notes (optional pull-quote).

    Each card short-circuits independently if its data isn't
    available so a flaky upstream never blanks the whole section.
    A PDF download CTA always renders because the PDF endpoint can
    build itself from the share row even if both Open-Meteo and the
    sun library are down.
    """
    spot = ctx.get("spot") or {}  # noqa: F841 — kept for future use (e.g. seasonal heuristic based on lat)
    share = ctx.get("share") or {}
    forecast = ctx.get("forecast_5day") or []
    light_days = ctx.get("light_days_5") or []
    seasonal = (share.get("seasonal_notes") or "").strip()
    token = share.get("token")

    parts: list[str] = []

    # ── Weather ────────────────────────────────────────────────
    if forecast:
        chips = []
        for f in forecast[:5]:
            label = _esc((f or {}).get("label") or "—")
            wd = _esc((f or {}).get("weekday") or "")
            hi = (f or {}).get("high_f")
            lo = (f or {}).get("low_f")
            rain = (f or {}).get("rain_chance_pct")
            chips.append(
                f'<div class="wchip">'
                f'<div class="wchip-day">{wd}</div>'
                f'<div class="wchip-temp">{hi if hi is not None else "—"}° / {lo if lo is not None else "—"}°</div>'
                f'<div class="wchip-label">{label}</div>'
                f'<div class="wchip-rain">{int(rain)}% rain</div>'
                f'</div>'
                if rain is not None
                else f'<div class="wchip">'
                f'<div class="wchip-day">{wd}</div>'
                f'<div class="wchip-temp">{hi if hi is not None else "—"}° / {lo if lo is not None else "—"}°</div>'
                f'<div class="wchip-label">{label}</div>'
                f'</div>'
            )
        parts.append(
            '<div class="card"><div class="card-kicker">5-day forecast</div>'
            f'<div class="wgrid">{"".join(chips)}</div>'
            '</div>'
        )

    # ── Sun / golden hour ──────────────────────────────────────
    if light_days:
        rows = []
        from datetime import date as _date, timedelta as _td
        today = _date.today()
        for i, day in enumerate(light_days[:5]):
            if not day:
                continue
            events = (day.get("sun_events") or {})
            # `_compute_light_plan` returns formatted local strings for
            # sunrise/sunset and ISO pairs for golden_morning /
            # golden_evening. Parse the ISO pairs back to datetimes
            # for `_fmt_time` so the wall-clock format matches the
            # rest of the page exactly.
            def _from_iso(s: Any) -> Any:
                if not isinstance(s, str):
                    return None
                try:
                    return datetime.fromisoformat(s)
                except Exception:
                    return None
            sr_local = events.get("sunrise_local") or "—"
            ss_local = events.get("sunset_local") or "—"
            gm = events.get("golden_morning") or []
            ge = events.get("golden_evening") or []
            gm_s = _from_iso(gm[0]) if len(gm) >= 1 else None
            gm_e = _from_iso(gm[1]) if len(gm) >= 2 else None
            ge_s = _from_iso(ge[0]) if len(ge) >= 1 else None
            ge_e = _from_iso(ge[1]) if len(ge) >= 2 else None
            d_label = (today + _td(days=i)).strftime("%a")
            rows.append(
                '<tr>'
                f'<td class="sun-day">{_esc(d_label)}</td>'
                f'<td>{_esc(sr_local)}</td>'
                f'<td>{_esc(ss_local)}</td>'
                f'<td>{_fmt_time(gm_s)} – {_fmt_time(gm_e)}</td>'
                f'<td>{_fmt_time(ge_s)} – {_fmt_time(ge_e)}</td>'
                '</tr>'
            )
        if rows:
            parts.append(
                '<div class="card"><div class="card-kicker">Sun & golden hour</div>'
                '<table class="suntable"><thead><tr>'
                '<th></th><th>Sunrise</th><th>Sunset</th><th>Golden AM</th><th>Golden PM</th>'
                '</tr></thead><tbody>'
                + "".join(rows)
                + '</tbody></table>'
                + '<div class="suntable-hint">Times are in the spot\'s local time zone.</div>'
                + '</div>'
            )

    # ── Seasonal notes ─────────────────────────────────────────
    if seasonal:
        parts.append(
            '<div class="card"><div class="card-kicker">Photographer\u2019s seasonal notes</div>'
            f'<div class="pnote" style="margin:0">{_esc(seasonal)}</div>'
            '</div>'
        )

    # ── PDF download CTA ───────────────────────────────────────
    # Jun 2025 condensed-PDF spec — copy is now "Download Client PDF"
    # with a "Preparing PDF…" loading state and a graceful failure
    # toast. We use a tiny inline IIFE so this works without any
    # client-side framework on the static HTML share page.
    if token and include_pdf_cta:
        # Filename guessed from the share row's title (the server
        # picks the canonical name when the PDF is actually served).
        pdf_url = f"/api/public/location/{_esc(token)}/itinerary.pdf"
        parts.append(
            '<div class="card"><div class="card-kicker">Client itinerary</div>'
            '<div class="cipdf-row" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">'
            '<div style="font-size:13.5px;color:#3D3833;flex:1 1 auto;min-width:200px;">'
            'A polished 2-page client itinerary with the location card, '
            'shoot-planning notes, weather, and supporting photos.'
            '</div>'
            '<button id="lscoutDlPdf" type="button" '
            f'data-pdf-url="{pdf_url}" '
            'style="background:#1A1A1A;color:#FAFAF7;padding:10px 18px;border-radius:8px;'
            'font-weight:600;font-size:13px;border:none;cursor:pointer;letter-spacing:0.2px;'
            'min-height:40px;">'
            'Download Client PDF'
            '</button>'
            '</div>'
            '<div id="lscoutDlPdfToast" role="status" '
            'style="display:none;margin-top:10px;padding:8px 12px;border-radius:8px;'
            'font-size:12.5px;background:#FFF0F0;color:#7A2222;border:1px solid #F2C2C2;"></div>'
            '</div>'
            '<script>(function(){'
            'var btn=document.getElementById("lscoutDlPdf");'
            'if(!btn||btn._wired)return;btn._wired=true;'
            'var toast=document.getElementById("lscoutDlPdfToast");'
            'function showErr(m){if(!toast)return;toast.textContent=m;toast.style.display="block";}'
            'function clearErr(){if(toast)toast.style.display="none";}'
            'btn.addEventListener("click",function(){'
            'clearErr();'
            'var url=btn.getAttribute("data-pdf-url");'
            'var label=btn.textContent;btn.textContent="Preparing PDF\u2026";'
            'btn.disabled=true;btn.style.opacity="0.7";btn.style.cursor="wait";'
            'fetch(url,{credentials:"omit"}).then(function(r){'
            'if(!r.ok)throw new Error("HTTP "+r.status);'
            'var cd=r.headers.get("content-disposition")||"";'
            'var m=cd.match(/filename="?([^";]+)"?/i);'
            'var fn=(m&&m[1])||"LumaScout-Client-Itinerary.pdf";'
            'return r.blob().then(function(b){return{b:b,fn:fn};});'
            '}).then(function(o){'
            'var u=URL.createObjectURL(o.b);'
            'var a=document.createElement("a");a.href=u;a.download=o.fn;'
            'document.body.appendChild(a);a.click();a.remove();'
            'setTimeout(function(){URL.revokeObjectURL(u);},2000);'
            '}).catch(function(){'
            'showErr("Couldn\u2019t generate this PDF. Please try again.");'
            '}).then(function(){'
            'btn.textContent=label;btn.disabled=false;'
            'btn.style.opacity="";btn.style.cursor="pointer";'
            '});'
            '});'
            '})();</script>'
        )

    if not parts:
        return ""

    # Inline styles for the new blocks so we don't have to touch the
    # global stylesheet block above (which lives inside the big f-string
    # template).
    style_block = (
        '<style>'
        '.wgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}'
        '.wchip{background:#F4F1EA;border-radius:10px;padding:10px;text-align:center;font-size:11.5px;color:#3D3833}'
        '.wchip-day{font-weight:600;color:#1A1A1A;font-size:12px}'
        '.wchip-temp{font-size:14px;color:#1A1A1A;margin-top:2px}'
        '.wchip-label{margin-top:2px}'
        '.wchip-rain{margin-top:2px;color:#5A6A7A}'
        '.suntable{width:100%;border-collapse:collapse;font-size:12.5px;color:#1A1A1A;margin:0}'
        '.suntable th,.suntable td{padding:7px 6px;text-align:left;border-bottom:1px solid #E8E6DF}'
        '.suntable th{font-size:10.5px;text-transform:uppercase;letter-spacing:0.5px;color:#7A6B5C}'
        '.sun-day{font-weight:600}'
        '.suntable-hint{font-size:11px;color:#7A6B5C;margin-top:8px;font-style:italic}'
        '@media (max-width:540px){.wgrid{grid-template-columns:repeat(2,1fr)}}'
        '</style>'
    )
    return style_block + "".join(parts)


# ─────────────────────────────────────────────────────────────────────
# Jun 2025 — Condensed 2-page PDF itinerary
# ─────────────────────────────────────────────────────────────────────
# Rewrite of the previous "render the whole public page to PDF"
# approach. The downloaded PDF is now an opinionated, premium 2-page
# client itinerary — purpose-built for shoot planning, not a literal
# screenshot of the share page. Hard-capped at 2 pages via pypdf
# slicing after WeasyPrint render (belt + suspenders against an
# overflowing forecast / image grid).

import re as _re

_SENTENCE_SPLIT_RE = _re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")


def _slugify_for_filename(s: str) -> str:
    """Convert a location name to a clean filename slug.

    `Eisenhower Park Overlook` → `Eisenhower-Park-Overlook`
    """
    s = (s or "").strip()
    # Replace non-alphanumeric runs with single hyphens.
    s = _re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")
    return s[:60] or "Location"


def _truncate_sentences(text: Any, max_sentences: int = 3, max_chars: int = 360) -> str:
    """Limit `text` to at most `max_sentences` complete sentences AND
    `max_chars` characters total. Appends an ellipsis only if we
    actually truncated. Empty / non-string input → empty string.
    """
    if not isinstance(text, str):
        return ""
    s = text.strip()
    if not s:
        return ""
    parts = _SENTENCE_SPLIT_RE.split(s)
    keep = " ".join(parts[:max_sentences]).strip()
    truncated = len(parts) > max_sentences
    if len(keep) > max_chars:
        keep = keep[: max_chars - 1].rstrip()
        # Try not to cut mid-word.
        if " " in keep:
            keep = keep.rsplit(" ", 1)[0]
        truncated = True
    if truncated and not keep.endswith(("…", ".", "!", "?")):
        keep = keep + "…"
    elif truncated:
        keep = keep + "…"
    return keep


def _bullets_from_text(text: Any, max_bullets: int = 3, max_chars_per: int = 110) -> List[str]:
    """Convert a free-form notes block into up to N short bullets.

    Splits on newlines first (photographers often paste lists), then
    falls back to sentence splits when there's no line structure.
    Empty / non-string input → empty list.
    """
    if not isinstance(text, str):
        return []
    s = text.strip()
    if not s:
        return []
    # Prefer explicit line breaks if the user wrote a list.
    lines = [ln.strip(" \t-•*").strip() for ln in s.splitlines()]
    lines = [ln for ln in lines if ln]
    if len(lines) <= 1:
        # Treat as prose and split on sentence boundaries.
        lines = [p.strip() for p in _SENTENCE_SPLIT_RE.split(s) if p.strip()]
    out: List[str] = []
    for ln in lines[:max_bullets]:
        if len(ln) > max_chars_per:
            ln = ln[: max_chars_per - 1].rstrip()
            if " " in ln:
                ln = ln.rsplit(" ", 1)[0]
            ln = ln + "…"
        out.append(ln)
    return out


def _compute_pdf_badges(spot: Dict[str, Any]) -> List[Dict[str, str]]:
    """Derive at-a-glance badges for the client itinerary header.

    Returns a small list of {label, tone} dicts so the renderer can
    style them. Tones: `neutral` (sand), `warn` (gold) — kept minimal
    so the document stays calm.
    """
    badges: List[Dict[str, str]] = []
    # Access badge — derived from land_access OR permit/fee booleans.
    la = (spot.get("land_access") or "").strip().lower()
    permit_required = bool(spot.get("permit_required"))
    fee_required = bool(spot.get("fee_required"))
    if la == "public" and not (permit_required or fee_required):
        badges.append({"label": "Free Public", "tone": "neutral"})
    elif permit_required:
        badges.append({"label": "Permit Required", "tone": "warn"})
    elif la in ("private", "private_paid", "private_event"):
        badges.append({"label": "Private — Check Access", "tone": "warn"})
    elif fee_required:
        badges.append({"label": "Fee Required", "tone": "warn"})
    elif la:
        badges.append({"label": la.replace("_", " ").title(), "tone": "neutral"})

    # Parking — surface the heuristic we have: notes present == "info available".
    if (spot.get("parking_notes") or "").strip():
        badges.append({"label": "Parking notes", "tone": "neutral"})
    # Walking / accessibility cues.
    if spot.get("accessible") is True:
        badges.append({"label": "Wheelchair friendly", "tone": "neutral"})
    elif (spot.get("walking_notes") or "").strip() or (spot.get("accessibility_notes") or "").strip():
        badges.append({"label": "Walking notes", "tone": "neutral"})
    # Friendliness flags — only show when explicitly True.
    if spot.get("dog_friendly") is True:
        badges.append({"label": "Dog friendly", "tone": "neutral"})
    if spot.get("kid_friendly") is True:
        badges.append({"label": "Kid friendly", "tone": "neutral"})
    if spot.get("indoor") is True:
        badges.append({"label": "Indoor", "tone": "neutral"})

    return badges[:6]  # never let the badge row wrap beyond two lines


def _select_pdf_images(payload_spot: Dict[str, Any], community_urls: List[str]) -> Tuple[str, List[str]]:
    """Pick the hero image + up to 6 supporting images for the PDF.

    Returns (hero_url, [supporting_url, ...]). Dedupes across the
    sanitized owner gallery, the cover override, and the approved
    community uploads. Owner gallery wins ordering.

    Jun 2025 spec — cap is 6 supporting photos so the page-2 preview
    grid can render a clean 3×2 (or smart fewer-image variant)
    without ever spilling onto a third page.
    """
    hero = payload_spot.get("hero_image_url") or ""
    seen: set[str] = set()
    if hero:
        seen.add(hero)
    supporting: List[str] = []
    # 1. Owner-uploaded gallery first (excluding hero).
    for im in (payload_spot.get("images") or []):
        if not isinstance(im, dict):
            continue
        u = im.get("image_url")
        if not isinstance(u, str) or not u.strip() or u in seen:
            continue
        seen.add(u)
        supporting.append(u)
        if len(supporting) >= 6:
            break
    # 2. Community uploads to fill remaining slots.
    if len(supporting) < 6:
        for u in (community_urls or []):
            if not isinstance(u, str) or not u.strip() or u in seen:
                continue
            seen.add(u)
            supporting.append(u)
            if len(supporting) >= 6:
                break
    return hero, supporting


def _format_today_sunline(light_days: List[Any]) -> str:
    """Compact single-line sunrise / sunset / golden hour summary for
    today (page 1). Falls back to an empty string when light data
    isn't available.
    """
    if not light_days:
        return ""
    today = light_days[0] if light_days else None
    if not today:
        return ""
    events = (today.get("sun_events") or {}) if isinstance(today, dict) else {}
    sr = events.get("sunrise_local") or "—"
    ss = events.get("sunset_local") or "—"
    gm = events.get("golden_morning") or []
    ge = events.get("golden_evening") or []

    def _from_iso(s: Any) -> Any:
        if not isinstance(s, str):
            return None
        try:
            return datetime.fromisoformat(s)
        except Exception:
            return None
    gm_s = _from_iso(gm[0]) if len(gm) >= 1 else None
    gm_e = _from_iso(gm[1]) if len(gm) >= 2 else None
    ge_s = _from_iso(ge[0]) if len(ge) >= 1 else None
    ge_e = _from_iso(ge[1]) if len(ge) >= 2 else None
    parts = [
        f"Sunrise {sr}",
        f"Sunset {ss}",
    ]
    if gm_s and gm_e:
        parts.append(f"Golden AM {_fmt_time(gm_s)}–{_fmt_time(gm_e)}")
    if ge_s and ge_e:
        parts.append(f"Golden PM {_fmt_time(ge_s)}–{_fmt_time(ge_e)}")
    return " · ".join(parts)


def _format_weather_snapshot(forecast: List[Any]) -> List[Dict[str, Any]]:
    """Return the compact 5-day forecast for the Client Shoot Itinerary
    page-2 light & weather card. Returns at most 5 dict entries —
    truncated harmlessly if upstream Open-Meteo returned fewer days.
    """
    if not forecast:
        return []
    return [f for f in forecast[:5] if isinstance(f, dict)]


def _generate_share_qr_svg(url: str) -> str:
    """Render a compact SVG QR code for the public share URL.

    Used at the bottom of page 1 so the client can pull up the live
    Share Location page on their phone. Returns an `<svg>` string
    (no XML prolog so WeasyPrint can inline it directly). Falls back
    to empty string if `qrcode` isn't installed or fails.
    """
    if not isinstance(url, str) or not url.strip():
        return ""
    try:
        import qrcode  # type: ignore
        import qrcode.image.svg  # type: ignore
        from io import BytesIO
        img = qrcode.make(
            url,
            image_factory=qrcode.image.svg.SvgPathImage,
            box_size=4,
            border=1,
        )
        buf = BytesIO()
        img.save(buf)
        svg = buf.getvalue().decode("utf-8", errors="replace")
        # Strip the XML prolog so the SVG can be embedded inline in
        # the HTML body. WeasyPrint accepts both, but inline is cleaner.
        if svg.startswith("<?xml"):
            svg = svg.split("?>", 1)[1].lstrip()
        # Force a fixed CSS box so the QR doesn't blow out the column.
        svg = svg.replace(
            "<svg ",
            '<svg style="width:1in;height:1in;display:block;" ',
            1,
        )
        return svg
    except Exception:
        return ""


def _arrival_instructions_bullets(spot: Dict[str, Any], share: Dict[str, Any]) -> List[str]:
    """Synthesize 1–3 actionable arrival instructions for the client.

    Priority sources (in order):
      1. Owner-authored arrival/walking/accessibility notes — these
         are the most specific so they get the first slot.
      2. Parking notes (just the first sentence — full parking gets
         its own block).
      3. A best-time-of-day fallback — "Arrive 20 min before {window}"
         when no other notes are present, so the section is never
         empty for an Elite share.

    Bullets are short (≤110 chars each) and capped at 3 total. We
    DO NOT use share.personal_note here — that gets its own
    "Photographer Note" block on page 2.
    """
    bullets: List[str] = []

    # 1. Walking / accessibility notes (most specific arrival info).
    walking = (spot.get("walking_notes") or "").strip()
    if walking:
        bullets.extend(_bullets_from_text(walking, max_bullets=2, max_chars_per=110))

    # 2. Access notes (e.g. "Park at lot B, walk south-east trail 5 min").
    access = (spot.get("access_notes") or "").strip()
    if access and len(bullets) < 3:
        bullets.extend(_bullets_from_text(access, max_bullets=2, max_chars_per=110))

    # 3. Parking lead sentence as the final arrival hint.
    parking = (spot.get("parking_notes") or "").strip()
    if parking and len(bullets) < 3:
        first = _truncate_sentences(parking, max_sentences=1, max_chars=110)
        if first:
            bullets.append(first)

    # 4. Last-resort fallback so the section is never empty for Elite.
    if not bullets:
        bt = (spot.get("best_time_of_day") or "").strip().replace("_", " ")
        if bt:
            bullets.append(f"Arrive 20 minutes before {bt.lower()} to settle in and scout angles.")
        else:
            bullets.append("Arrive 20 minutes early to settle in and scout angles before the shoot.")

    # Dedupe (some spots double up walking + access content).
    seen: set[str] = set()
    out: List[str] = []
    for b in bullets:
        key = b.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(b)
        if len(out) >= 3:
            break
    return out


def _render_pdf_itinerary_html(ctx: Dict[str, Any]) -> str:
    """Build the dedicated 2-page "Client Shoot Itinerary" HTML.

    Jun 2025 premium spec — a polished client deliverable, NOT a copy
    of the Share Location page.

    ── Page 1 — Premium Location Cover ────────────────────────────
      • LumaScout brandbar (logo + wordmark)
      • "Client Shoot Itinerary" label (large)
      • Large hero image (cinematic, 3.1in tall)
      • Location name (H1) + one-sentence summary
      • Address / general location
      • "Best time to shoot" line
      • 3-5 compact badges (access type, parking, walking)
      • Generated date + QR code + live share URL at the bottom

    ── Page 2 — Client Shoot Plan ─────────────────────────────────
      • "Shoot Plan" header
      • Arrival Instructions (≤3 bullets)
      • Photographer Note (≤300 chars / 3 bullets)
      • Access & Safety (merged permit + safety, ≤2 bullets each)
      • Light & Weather (compact 5-day forecast)
      • Preview Images (≤4)
      • Footer: "Shared with LumaScout · Generated {date} · © LumaScout"

    Hide-sensitive-scout-notes is honored upstream via
    `_build_public_view` (parking_notes / creator_tips /
    best_time_of_day get stripped before we ever see them).

    pypdf clamps to 2 pages in the route as a belt-and-suspenders
    safety net.
    """
    payload = _build_public_view(ctx)
    share = ctx.get("share") or {}
    spot = payload["spot"]
    show_exact = ctx["show_exact_location"]

    # ── Title (Elite custom share_title wins) ──
    title = (share.get("share_title") or spot.get("title") or "Photo location").strip()

    # ── One-sentence cover summary (NOT a long description) ──
    # Elite seasonal_notes lead (most context-rich), then description,
    # then a generic fallback so the cover never feels empty.
    cover_summary = ""
    for candidate in (share.get("seasonal_notes"), spot.get("description"), spot.get("best_light_notes")):
        if isinstance(candidate, str) and candidate.strip():
            cover_summary = _truncate_sentences(candidate, max_sentences=1, max_chars=160)
            if cover_summary:
                break

    # ── Address line (City, ST) ──
    locline = ", ".join([x for x in [spot.get("city"), spot.get("state")] if x]) or ""

    # ── Best-time-to-shoot single line ──
    best_time_raw = (spot.get("best_time_of_day") or "").strip().replace("_", " ")
    best_light = (spot.get("best_light_notes") or "").strip()
    best_time_line = ""
    if best_time_raw:
        best_time_line = best_time_raw.capitalize()
        if best_light:
            # Keep it short — one-liner only.
            light_short = _truncate_sentences(best_light, max_sentences=1, max_chars=90)
            if light_short:
                best_time_line = f"{best_time_line} · {light_short}"
    elif best_light:
        best_time_line = _truncate_sentences(best_light, max_sentences=1, max_chars=120)

    # ── Hero + supporting images ──
    hero, supporting = _select_pdf_images(spot, ctx.get("community_image_urls") or [])

    # ── Coords + map URL (only when share allows exact coords) ──
    lat = spot.get("latitude")
    lng = spot.get("longitude")
    map_url = ""
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and show_exact:
        map_url = f"https://maps.apple.com/?q={lat},{lng}"
    coord_label = "Exact location" if show_exact else "Approximate area"
    coords_str = f"{lat}, {lng}" if (lat is not None and lng is not None) else ""

    # ── Open Directions URL (Google Maps) ──
    # Coords first when the share allows exact location; otherwise
    # fall back to a formatted City, ST address. If neither is
    # available the button is hidden (no broken / disabled state).
    directions_url = ""
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and show_exact:
        directions_url = (
            f"https://www.google.com/maps/dir/?api=1&destination={lat},{lng}"
        )
    elif locline:
        # Address fallback. urlencode the full "City, ST" line so the
        # spaces / commas survive a paste into Maps.
        from urllib.parse import quote as _urlquote
        directions_url = (
            f"https://www.google.com/maps/dir/?api=1&destination={_urlquote(locline)}"
        )

    # ── Badges (3-5 compact only) ──
    badges = _compute_pdf_badges(spot)[:5]

    # ── Page-2 content ──
    personal_note = _truncate_sentences(share.get("personal_note"), max_sentences=4, max_chars=300)
    arrival_bullets = _arrival_instructions_bullets(spot, share)
    safety_bullets = _bullets_from_text(spot.get("safety_notes") or "", max_bullets=2, max_chars_per=110)
    permit_bullets = _bullets_from_text(spot.get("permit_notes") or "", max_bullets=2, max_chars_per=110)

    # ── 5-day weather snapshot ──
    weather_5day = _format_weather_snapshot(ctx.get("forecast_5day") or [])

    LOGO_URL = "https://customer-assets.emergentagent.com/job_photo-finder-60/artifacts/nzwx34gx_app-logo.jpg"
    gen_stamp = datetime.utcnow().strftime("%B %d, %Y")
    token = share.get("token") or ""
    share_url = f"{WEB_BASE}/api/public/location/{token}" if token else ""
    # Note: QR code intentionally removed (Jun 2025 final spec). The
    # live share URL is now rendered subtly in the page-2 footer
    # next to the generated date instead of a dedicated card.
    qr_svg = ""  # noqa: F841 (kept symbol so other branches stay tidy)

    # ── Inline assembly helpers ──
    def _ul(items: List[str]) -> str:
        if not items:
            return ""
        lis = "".join(f"<li>{_esc(x)}</li>" for x in items)
        return f'<ul class="ul">{lis}</ul>'

    def _img(url: str, klass: str = "") -> str:
        return (
            f'<img class="{klass}" src="{_esc(url)}" alt="" '
            f'onerror="this.style.display=\'none\'" />'
        )

    badges_html = ""
    if badges:
        chips = "".join(
            f'<span class="badge badge-{b.get("tone","neutral")}">{_esc(b.get("label",""))}</span>'
            for b in badges
        )
        badges_html = f'<div class="badges">{chips}</div>'

    # ── Page-1 meta strip (best time + address) ──
    # Open Directions button is appended as the final meta row when
    # we have usable destination data, keeping it close to the
    # coords / address it acts on instead of a separate bulky card.
    meta_rows = []
    if best_time_line:
        meta_rows.append(f'<div class="meta-row"><div class="meta-k">Best time to shoot</div><div class="meta-v">{_esc(best_time_line)}</div></div>')
    if coords_str:
        v = _esc(coords_str)
        if map_url:
            v = f'{v} <span class="meta-link">· {_esc(map_url)}</span>'
        meta_rows.append(f'<div class="meta-row"><div class="meta-k">{_esc(coord_label)}</div><div class="meta-v coords">{v}</div></div>')
    if locline:
        meta_rows.append(f'<div class="meta-row"><div class="meta-k">Region</div><div class="meta-v">{_esc(locline)}</div></div>')
    if directions_url:
        # Compact pill placed inside the meta strip — premium dark
        # background with a small gold pin glyph and tight padding.
        # Clickable link annotation in the rendered PDF.
        meta_rows.append(
            '<div class="meta-row meta-row-cta">'
            '<div class="meta-k">Directions</div>'
            '<div class="meta-v">'
            f'<a class="dir-btn" href="{_esc(directions_url)}" '
            'target="_blank" rel="noopener">'
            '<span class="dir-pin">&#9678;</span> Open Directions'
            '</a>'
            '</div>'
            '</div>'
        )
    meta_html = ('<div class="meta">' + "".join(meta_rows) + '</div>') if meta_rows else ''

    # No more QR card / dedicated CTA card — Page 1 ends cleanly with
    # the meta strip + (later) the badge row + breathing room.
    qr_html = ""

    # ── Page-2 blocks ──
    arrival_html = (
        f'<div class="block"><div class="block-kicker">Arrival Instructions</div>{_ul(arrival_bullets)}</div>'
        if arrival_bullets else ""
    )
    pnote_html = (
        '<div class="pnote">'
        '<div class="pnote-kicker">Photographer Note</div>'
        f'<div class="pnote-body">{_esc(personal_note)}</div>'
        '</div>'
        if personal_note else ""
    )

    # Merge safety + permit into a single "Access & Safety" block.
    access_safety_html = ""
    if safety_bullets or permit_bullets:
        sub_parts = []
        if safety_bullets:
            sub_parts.append(f'<div class="sub-kicker">Safety</div>{_ul(safety_bullets)}')
        if permit_bullets:
            sub_parts.append(f'<div class="sub-kicker">Permits &amp; access</div>{_ul(permit_bullets)}')
        access_safety_html = (
            '<div class="block">'
            '<div class="block-kicker">Access &amp; Safety</div>'
            + "".join(sub_parts)
            + '</div>'
        )

    # Light & weather — 5-day compact row (only if data available).
    weather_html = ""
    if weather_5day:
        cells = []
        for f in weather_5day:
            wd = _esc(f.get("weekday") or "")
            label = _esc(f.get("label") or "—")
            hi = f.get("high_f")
            lo = f.get("low_f")
            rain = f.get("rain_chance_pct")
            cells.append(
                '<div class="wcell">'
                f'<div class="wcell-day">{wd}</div>'
                f'<div class="wcell-temp">{hi if hi is not None else "—"}° / {lo if lo is not None else "—"}°</div>'
                f'<div class="wcell-label">{label}</div>'
                + (f'<div class="wcell-rain">{int(rain)}% rain</div>' if rain is not None else '')
                + '</div>'
            )
        # Add today's sunline as a one-liner above the chips.
        sun_line = _format_today_sunline(ctx.get("light_days_5") or [])
        sun_block = f'<div class="sunline">{_esc(sun_line)}</div>' if sun_line else ""
        weather_html = (
            '<div class="block">'
            '<div class="block-kicker">Light &amp; Weather</div>'
            f'{sun_block}'
            f'<div class="wrow">{"".join(cells)}</div>'
            '</div>'
        )

    # Preview images — square 1:1 tiles, smart column count, ≤6.
    grid_html = ""
    if supporting:
        tiles_to_show = supporting[:6]
        n = len(tiles_to_show)
        # Choose a column count that produces clean, premium rows
        # matching the spec:
        #   6 → 3×2,  5 → 3×2 (last cell omitted),
        #   4 → 2×2,  3 → 3×1,  2 → 2×1,  1 → 1×1.
        cols_for_count = {6: 3, 5: 3, 4: 2, 3: 3, 2: 2, 1: 1}
        cols = cols_for_count.get(n, 3)
        tiles = "".join(f'<div class="ptile">{_img(u, "ptile-img")}</div>' for u in tiles_to_show)
        grid_html = (
            '<div class="block">'
            '<div class="block-kicker">Preview Images</div>'
            f'<div class="pgrid pgrid-cols-{cols} pgrid-count-{n}">{tiles}</div>'
            '</div>'
        )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Client Shoot Itinerary · {_esc(title)} · LumaScout</title>
<style>
@page {{
  size: Letter;
  margin: 0.45in 0.5in 0.4in;
}}
* {{ box-sizing: border-box; }}
html, body {{
  margin: 0; padding: 0;
  color: #1A1A1A;
  background: #FFFFFF;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}}

/* ── Brand bar (top of page 1) ── */
.brandbar {{
  display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 8px;
  margin-bottom: 10px;
  border-bottom: 1px solid #ECECE6;
}}
.brandbar .left {{ display: flex; align-items: center; gap: 8px; }}
.brandbar img {{ width: 22px; height: 22px; border-radius: 5px;
                  background: #0E0E10; object-fit: cover; }}
.brandbar .wm {{ font-weight: 700; font-size: 13px; letter-spacing: 0.2px; }}
.brandbar .wm .gold {{ color: #C98B1B; }}
.brandbar .right {{
  font-size: 10px; letter-spacing: 0.7px; text-transform: uppercase;
  color: #7A6B5C; font-weight: 700;
}}

/* ── Cover label ── */
.coverlabel {{
  text-transform: uppercase; letter-spacing: 1.6px;
  color: #C98B1B; font-size: 10.5px; font-weight: 700;
  margin: 6px 0 8px;
}}

/* ── Hero ── */
.hero {{
  width: 100%; height: 3.1in;
  background: #E8E6DF center/cover no-repeat;
  border-radius: 10px;
  margin: 0 0 14px;
}}

/* ── Cover title block ── */
h1 {{
  font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
  font-size: 28px; line-height: 1.1;
  margin: 0 0 6px; font-weight: 600; letter-spacing: -0.4px;
}}
.cover-summary {{
  color: #2C2C2A; font-size: 13px; line-height: 1.55;
  margin: 0 0 12px;
}}

/* ── Badges ── */
.badges {{ display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; }}
.badge {{
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.2px;
  padding: 3px 10px; border-radius: 999px;
  border: 1px solid #ECECE6; background: #FAFAF7; color: #1A1A1A;
}}
.badge-warn {{ background: #FFF8E7; border-color: #F1DDA1; color: #9C6E0E; }}

/* ── Meta rows (best-time / coords / region) ── */
.meta {{
  border: 1px solid #ECECE6;
  border-radius: 10px;
  padding: 6px 0;
  margin: 0 0 12px;
}}
.meta-row {{
  display: flex; gap: 14px;
  padding: 7px 14px;
  border-bottom: 1px solid #F2F0EA;
  font-size: 12px; color: #1A1A1A;
}}
.meta-row:last-child {{ border-bottom: none; }}
.meta-k {{ width: 1.4in; color: #7A6B5C; font-weight: 600;
           text-transform: uppercase; font-size: 10.5px; letter-spacing: 0.5px; }}
.meta-v {{ flex: 1 1 0; min-width: 0; line-height: 1.45; }}
.meta-v.coords {{
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11.5px;
}}
.meta-link {{ color: #6B6B66; word-break: break-all; }}

/* ── QR / share-link card on page 1 ── */
.qr-card {{
  display: flex; gap: 14px;
  border: 1px solid #ECECE6;
  border-radius: 10px;
  padding: 12px 14px;
  margin: 0 0 0;
  align-items: center;
  background: #FCFBF7;
}}
.qr-card .qr-text {{ flex: 1 1 0; min-width: 0; }}
.qr-card .qr-svg {{ flex: 0 0 1in; }}
.qr-kicker {{
  text-transform: uppercase; letter-spacing: 0.5px;
  color: #C98B1B; font-size: 10px; font-weight: 700; margin: 0 0 4px;
}}
.qr-body {{ font-size: 11.5px; line-height: 1.5; color: #3A3A36; margin: 0 0 4px; }}
.qr-url {{ font-size: 10.5px; color: #6B6B66; word-break: break-all; }}
.qr-fallback {{
  font-size: 10px; color: #6B6B66; word-break: break-all;
  border: 1px dashed #ECECE6; padding: 6px 8px; border-radius: 6px;
  background: #FFFFFF;
}}

/* ── Open Directions CTA (compact pill inside the meta strip) ── */
/* Placed in the final `.meta-row` so it sits flush with the address /
   coordinates rows above. Refined sizing per Jun 2025 final spec:
   medium width, ~36px tall, premium dark/gold, not a full-width
   banner. */
.dir-btn {{
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 14px;
  background: #1A1A1A;
  color: #FAFAF7 !important;
  border-radius: 999px;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.3px;
  text-transform: uppercase;
  text-decoration: none;
  border: 1px solid #1A1A1A;
  line-height: 1;
}}
.dir-btn .dir-pin {{
  color: #C98B1B;
  font-size: 11px;
  font-weight: 700;
}}
.meta-row-cta {{
  padding-top: 8px;
  padding-bottom: 8px;
}}
.meta-row-cta .meta-v {{
  display: flex; align-items: center;
}}

/* ── Page break ── */
.pagebreak {{ page-break-before: always; break-before: page; }}

/* ── Page-2 header ── */
.page2-header {{
  border-bottom: 1px solid #ECECE6;
  padding-bottom: 8px;
  margin-bottom: 12px;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 10px;
}}
.page2-title {{
  font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
  font-size: 22px; font-weight: 600; margin: 0 0 2px; letter-spacing: -0.2px;
}}
.page2-sub {{ color: #6B6B66; font-size: 11.5px; margin: 0; }}
.page2-stamp {{
  color: #7A6B5C; font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.6px;
}}

/* ── Photographer Note (pull-quote) ── */
.pnote {{
  background: #FFFFFF;
  border-left: 3px solid #C98B1B;
  border-radius: 6px;
  padding: 10px 12px;
  margin: 0 0 10px;
}}
.pnote-kicker {{
  text-transform: uppercase; letter-spacing: 0.6px;
  color: #C98B1B; font-size: 10px; font-weight: 700; margin-bottom: 4px;
}}
.pnote-body {{
  font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
  font-size: 12.5px; line-height: 1.55; color: #2C2C2A;
  white-space: pre-wrap;
}}

/* ── Page-2 blocks ── */
.block {{
  border: 1px solid #ECECE6;
  border-radius: 8px;
  padding: 10px 12px;
  margin: 0 0 10px;
}}
.block-kicker {{
  text-transform: uppercase; letter-spacing: 0.5px;
  color: #7A6B5C; font-size: 10px; font-weight: 600; margin-bottom: 6px;
}}
.sub-kicker {{
  text-transform: uppercase; letter-spacing: 0.4px;
  color: #1A1A1A; font-size: 10.5px; font-weight: 700;
  margin: 6px 0 4px;
}}
.ul {{ margin: 0; padding-left: 16px; font-size: 12px; line-height: 1.5; color: #1A1A1A; }}
.ul li {{ margin-bottom: 3px; }}
.ul li:last-child {{ margin-bottom: 0; }}

/* ── Sunline above the 5-day chips ── */
.sunline {{
  font-size: 11px; color: #3A3A36;
  background: #FAF7EE;
  border: 1px solid #F0E7CE;
  border-radius: 6px;
  padding: 6px 10px;
  margin: 0 0 8px;
}}

/* ── 5-day weather row ── */
.wrow {{ display: flex; gap: 6px; }}
.wcell {{
  flex: 1 1 0;
  background: #F4F1EA;
  border-radius: 7px;
  padding: 7px 5px;
  text-align: center;
  font-size: 10.5px; color: #3D3833;
}}
.wcell-day {{ font-weight: 600; color: #1A1A1A; font-size: 11px; }}
.wcell-temp {{ font-size: 12px; color: #1A1A1A; margin-top: 2px; }}
.wcell-label {{ margin-top: 1px; font-size: 10px; }}
.wcell-rain {{ margin-top: 1px; color: #5A6A7A; font-size: 10px; }}

/* ── Preview-image grid — square 1:1 tiles, smart column count ── */
/* Using fixed in-units instead of 1fr so each tile is a true square
   (WeasyPrint ignores `aspect-ratio`). The grid is left-aligned and
   will not stretch the tiles to fill the full block width — keeping
   the photos consistently 1:1 regardless of image count. */
.pgrid {{
  display: grid;
  gap: 8px;
  justify-content: start;
}}
.pgrid-cols-1 {{ grid-template-columns: 2.6in; }}
.pgrid-cols-1 .ptile {{ height: 2.6in; width: 2.6in; }}
.pgrid-cols-2 {{ grid-template-columns: repeat(2, 2.4in); }}
.pgrid-cols-2 .ptile {{ height: 2.4in; width: 2.4in; }}
.pgrid-cols-3 {{ grid-template-columns: repeat(3, 1.85in); }}
.pgrid-cols-3 .ptile {{ height: 1.85in; width: 1.85in; }}
.ptile {{
  border-radius: 6px;
  overflow: hidden;
  background: #E8E6DF;
}}
.ptile-img {{
  width: 100%; height: 100%;
  object-fit: cover; object-position: center;
}}

/* ── Footer ── */
.footer {{
  margin-top: 14px;
  padding-top: 8px;
  border-top: 1px solid #ECECE6;
  display: flex; align-items: center; justify-content: space-between;
  font-size: 9.5px; color: #7A6B5C; gap: 12px;
}}
.footer .center {{ flex: 1; text-align: center; }}
.footer .right {{ text-align: right; }}
</style>
</head>
<body>

<!-- ───────── PAGE 1 — PREMIUM LOCATION COVER ───────── -->
<header class="brandbar">
  <div class="left">
    <img src="{_esc(LOGO_URL)}" alt="LumaScout" />
    <div class="wm">Luma<span class="gold">Scout</span></div>
  </div>
  <div class="right">Generated {gen_stamp}</div>
</header>

<div class="coverlabel">Client Shoot Itinerary</div>

<div class="hero" style="background-image:url('{_esc(hero)}');"></div>

<h1>{_esc(title)}</h1>
{f'<p class="cover-summary">{_esc(cover_summary)}</p>' if cover_summary else ''}

{badges_html}

{meta_html}

{qr_html}

<!-- ───────── PAGE 2 — CLIENT SHOOT PLAN ───────── -->
<div class="pagebreak"></div>

<div class="page2-header">
  <div>
    <div class="page2-title">Shoot Plan</div>
    <div class="page2-sub">{_esc(title)}{(' · ' + _esc(locline)) if locline else ''}</div>
  </div>
  <div class="page2-stamp">{gen_stamp}</div>
</div>

{arrival_html}
{pnote_html}
{access_safety_html}
{weather_html}
{grid_html}

<div class="footer">
  <div>Shared with LumaScout</div>
  <div class="center">Generated {gen_stamp}{(' &middot; ' + _esc(share_url)) if share_url else ''}</div>
  <div class="right">&copy; LumaScout</div>
</div>

</body>
</html>"""


# ─────────────────────────────────────────────────────────────────────
# PDF itinerary — public, served from a stable URL on the share page
# ─────────────────────────────────────────────────────────────────────
@router.get("/public/location/{token}/itinerary.pdf")
async def public_itinerary_pdf(token: str):
    """Render the public Share Location into a polished 2-page client
    itinerary PDF.

    Jun 2025 spec — the PDF is now an opinionated, premium 2-page
    document (NOT a literal screenshot of the public share page). It
    is purpose-built for shoot planning:
      • Page 1 — Location card (hero, title, byline, address, short
        description, quick-look badges, today's sunrise/sunset/golden
        hour, exact coordinates + Open in Maps).
      • Page 2 — Shoot planning (personal note, photographer's tips ≤3,
        safety ≤2, permits ≤2, parking, 2-day weather snapshot,
        supporting photo grid ≤6, footer with generated date).

    Server-side truncation keeps content from overflowing, and the
    rendered PDF is then HARD-CAPPED to 2 pages with pypdf as a
    belt-and-suspenders guarantee.

    Access rules are identical to the public link:
      • revoked / expired / hard-deleted → 404 "Share unavailable"
      • Pro / Free (created_by_was_elite=False) → 404 "Premium content"
      • hide_scout_notes=True → parking_notes / creator_tips /
        best_time_of_day already stripped by _build_public_view
    """
    ctx = await _resolve_share_or_unavailable(token)
    if not ctx:
        raise HTTPException(status_code=404, detail="Share unavailable")
    share = ctx.get("share") or {}
    if not share.get("created_by_was_elite"):
        # Pro/Free downgrade — premium artifact stays gated.
        raise HTTPException(status_code=404, detail="Premium content not available")

    # Same data adapter as the public HTML page — community uploads,
    # 5-day weather, sun/golden hour. The 2-page renderer aggressively
    # trims this down (today+tomorrow weather only, ≤6 images).
    await _enrich_ctx_for_full_render(ctx)

    canonical_url = f"{WEB_BASE}/api/public/location/{token}"
    html_str = _render_pdf_itinerary_html(ctx)

    # WeasyPrint is heavy on import (cairo + pango). Lazy import + run
    # the actual render off the event loop so weather/image fetches
    # don't block FastAPI workers.
    import asyncio
    from io import BytesIO
    from weasyprint import HTML  # type: ignore

    def _render_pdf_bytes() -> bytes:
        buf = BytesIO()
        HTML(string=html_str, base_url=canonical_url).write_pdf(buf)
        return buf.getvalue()

    try:
        pdf_bytes = await asyncio.to_thread(_render_pdf_bytes)
    except Exception as e:
        # Never expose a 500 to anonymous clients.
        logging.getLogger("lumascout.shares").exception(
            "PDF render failed for token=%s: %s", token, e
        )
        raise HTTPException(status_code=503, detail="PDF temporarily unavailable")

    # Hard-cap to first 2 pages. The HTML template already targets a
    # 2-page layout via aggressive truncation, but a long city / state
    # name + a wide badge row could theoretically push the page-2
    # weather card onto a third page. pypdf slice guarantees the
    # download is at most 2 pages — clipping in the renderer would
    # be too aggressive (might cut a section in half visually); this
    # is purely a safety net.
    try:
        from pypdf import PdfReader, PdfWriter
        reader = PdfReader(BytesIO(pdf_bytes))
        if len(reader.pages) > 2:
            writer = PdfWriter()
            for p in reader.pages[:2]:
                writer.add_page(p)
            out = BytesIO()
            writer.write(out)
            pdf_bytes = out.getvalue()
    except Exception as e:  # noqa: BLE001 — best-effort safety net
        logging.getLogger("lumascout.shares").warning(
            "pypdf 2-page cap skipped for token=%s: %s", token, e
        )

    # Polite filename for the Save-As dialog.
    # Format: LumaScout-{Slugified-Location-Name}-Client-Itinerary.pdf
    spot = ctx.get("spot") or {}
    title_for_file = (share.get("share_title") or spot.get("title") or "Location").strip()
    slug = _slugify_for_filename(title_for_file)
    filename = f"LumaScout-{slug}-Client-Itinerary.pdf"
    headers = {
        "Content-Disposition": f'inline; filename="{filename}"',
        "Cache-Control": "private, max-age=0, must-revalidate",
    }
    from fastapi.responses import Response as _R
    return _R(content=pdf_bytes, media_type="application/pdf", headers=headers)
