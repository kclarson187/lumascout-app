"""
routes/revenuecat.py — RevenueCat webhook + iOS IAP config endpoint
══════════════════════════════════════════════════════════════════

Jun 2026: Apple App Store Guideline 3.1.1 requires that digital
subscriptions sold INSIDE the iOS app go through Apple's In-App
Purchase mechanism, NOT Stripe. We've migrated iOS subscription
purchases to RevenueCat (`react-native-purchases`), which manages
StoreKit transactions and gives us a single entitlements abstraction.

Stripe is preserved untouched for:
  • Web subscriptions
  • Android subscriptions (until we add Play Billing via RC)
  • Marketplace one-time purchases
  • Referral payouts
  • Super-admin / comp tooling

Endpoints in this module
────────────────────────

GET  /api/billing/iap-config
    Returns the public RevenueCat iOS SDK key + entitlement IDs to
    the client so iOS can boot the SDK without baking secrets into
    the bundle. Returns `{configured: false, ...}` when the
    placeholder is still in place, letting the client degrade
    gracefully. Public (no auth required) — these are publishable
    values.

POST /api/revenuecat/webhook
    Receives RC subscription lifecycle events. Verifies the
    Authorization header against REVENUECAT_WEBHOOK_AUTH (a long
    shared secret you set in the RC dashboard). Idempotent — replay
    of any event just rewrites the same plan/source on the user doc.

How user-plan is reconciled across Stripe + RevenueCat
──────────────────────────────────────────────────────
The user document now carries BOTH a `plan` (canonical, updated by
whichever source last wrote it) AND a `subscription_source` field
("stripe" | "revenuecat" | "comp" | "manual"). The existing
`plan_of(user)` helper still works as-is because it just reads
`user.plan`. Comp/admin overrides win over any subscription source.

Migration safety
────────────────
• Existing Stripe subscribers on iOS continue using Stripe (no
  double-billing). They keep their plan from the Stripe webhook.
• New iOS subscriptions go through RevenueCat → Apple IAP.
• RevenueCat webhook only updates users whose subscription_source
  is null OR already "revenuecat" — it will NEVER demote a Stripe
  customer to free. (See `_should_apply_rc_event()`.)
"""
from __future__ import annotations

import hmac
import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Header

from server import db, utcnow

log = logging.getLogger("lumascout.revenuecat")

router = APIRouter(prefix="/api", tags=["revenuecat"])


# ─── Constants ─────────────────────────────────────────────────────
WEBHOOK_AUTH_PLACEHOLDER = "__SET_REVENUECAT_WEBHOOK_AUTH__"
RC_IOS_KEY_PLACEHOLDER   = "__SET_IN_RC_DASHBOARD__"

# Entitlement identifiers configured in RevenueCat dashboard.
ENTITLEMENT_PRO   = "pro"
ENTITLEMENT_ELITE = "elite"

# Product IDs configured in App Store Connect → attached to entitlements
# in RevenueCat dashboard. Surfaced via /iap-config so the client knows
# what to expect and can match packages back to tiers if needed.
IOS_PRODUCT_IDS = {
    "pro_monthly":   "com.lumascout.pro.monthly",
    "pro_annual":    "com.lumascout.pro.annual",
    "elite_monthly": "com.lumascout.elite.monthly",
    "elite_annual":  "com.lumascout.elite.annual",
}

# Default offering identifier in RevenueCat. The client calls
# Purchases.getOfferings() and reads offerings.current OR
# offerings.all[OFFERING_ID].
OFFERING_ID = "default"


# ─── GET /api/billing/iap-config ───────────────────────────────────
@router.get("/billing/iap-config")
async def iap_config():
    """Public configuration the iOS client needs to boot the
    RevenueCat SDK. Returns `configured: false` if the placeholder is
    still in place so the client can render a polite "in-app
    purchases not yet available" state instead of crashing.

    Why this is an endpoint instead of just baking the values into
    the bundle:
      • Rotate the iOS public key without rebuilding the IPA.
      • Toggle iOS IAP on/off centrally (e.g. emergency rollback)
        without an app update.
      • Add per-build / per-user A/B offering routing in the future.
    """
    key = os.environ.get("EXPO_PUBLIC_RC_IOS_API_KEY", "")
    configured = bool(key) and key != RC_IOS_KEY_PLACEHOLDER
    return {
        "ios": {
            "configured":      configured,
            "api_key":         key if configured else None,
            "entitlements":    [ENTITLEMENT_PRO, ENTITLEMENT_ELITE],
            "offering_id":     OFFERING_ID,
            "product_ids":     IOS_PRODUCT_IDS,
        },
        # Web/Android continue to use Stripe — surface that here so the
        # client UI doesn't need separate platform detection.
        "stripe_platforms":   ["web", "android"],
        # If your team needs to disable iOS IAP without rebuilding:
        "ios_iap_enabled":    configured,
    }


# ─── POST /api/revenuecat/webhook ──────────────────────────────────
def _verify_webhook_auth(authorization_header: Optional[str]) -> None:
    expected = os.environ.get("REVENUECAT_WEBHOOK_AUTH", "")
    if not expected or expected == WEBHOOK_AUTH_PLACEHOLDER:
        log.error("revenuecat_webhook_auth_not_configured")
        # Refuse to process events at all until the secret is set.
        # Better than silently accepting forged webhooks.
        raise HTTPException(status_code=503, detail="webhook_not_configured")
    if not authorization_header:
        raise HTTPException(status_code=401, detail="missing_authorization")
    # `hmac.compare_digest` to avoid timing side channels.
    if not hmac.compare_digest(authorization_header, expected):
        raise HTTPException(status_code=401, detail="invalid_authorization")


def _plan_from_entitlements(entitlements: Dict[str, Any]) -> Optional[str]:
    """Pick the highest-tier ACTIVE entitlement.
    Returns None if no entitlements are active (caller decides whether
    to demote to free or leave alone)."""
    if not isinstance(entitlements, dict):
        return None
    active_ids = [eid for eid, info in entitlements.items()
                  if isinstance(info, dict) and info.get("expires_date") is None or
                  # NOTE: expires_date None means lifetime; otherwise active
                  # means future timestamp. The webhook payload already
                  # filters out expired entitlements via the event type,
                  # so any present entitlement should be treated as active.
                  True]
    # Actually simpler & safer: treat every key in the dict as active —
    # RC only ships the currently-active set in event payloads.
    active_ids = list(entitlements.keys())
    if ENTITLEMENT_ELITE in active_ids:
        return "elite"
    if ENTITLEMENT_PRO in active_ids:
        return "pro"
    return None


def _should_apply_rc_event(user: Dict[str, Any]) -> bool:
    """Guard against RC events accidentally clobbering Stripe / comp
    accounts. Apply RC events ONLY when:
      • user has no subscription_source yet, OR
      • subscription_source is already "revenuecat", OR
      • subscription_source is "stripe" but the Stripe subscription
        is inactive (canceled/expired) — then RC takes over.
    Never touch comp/manual/admin overrides — those win by design."""
    src = (user.get("subscription_source") or "").lower()
    if src in ("comp", "manual", "admin"):
        return False
    if src == "stripe":
        # If Stripe sub is still active, let Stripe own this user.
        stripe_status = (user.get("subscription_status") or "").lower()
        if stripe_status in ("active", "trialing", "past_due"):
            return False
    return True


# Map RC event types → action.
#   "grant"   → set plan from entitlements, subscription_source=revenuecat
#   "revoke"  → demote to free
#   "ignore"  → no-op (e.g., PRODUCT_CHANGE which doesn't represent activation)
RC_EVENT_ACTION = {
    "INITIAL_PURCHASE":  "grant",
    "RENEWAL":           "grant",
    "UNCANCELLATION":    "grant",
    "PRODUCT_CHANGE":    "grant",   # tier upgrade/downgrade — re-read entitlements
    "NON_RENEWING_PURCHASE": "grant",
    "TRANSFER":          "grant",   # user merged or moved devices
    "EXPIRATION":        "revoke",
    "CANCELLATION":      "ignore",  # user canceled but still has access until expiration
    "BILLING_ISSUE":     "ignore",  # access not lost yet — wait for EXPIRATION
    "SUBSCRIPTION_PAUSED": "revoke",
    "SUBSCRIPTION_EXTENDED": "grant",
    "TEMPORARY_ENTITLEMENT_GRANT": "grant",
    "REFUND":            "revoke",
}


@router.post("/revenuecat/webhook")
async def revenuecat_webhook(
    request: Request,
    authorization: Optional[str] = Header(None),
):
    """Receive RevenueCat subscription lifecycle events.

    Auth: shared-secret bearer-style Authorization header set in the
    RC dashboard. Verified before any DB access.

    Idempotent: re-delivering the same event just rewrites the same
    plan + audit fields. We don't dedupe by event_id because the
    end state is the same regardless.

    Payload shape (excerpt — full schema:
    https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields):
        {
          "event": {
            "type": "INITIAL_PURCHASE" | "RENEWAL" | ...,
            "app_user_id": "<our user_id>",
            "original_app_user_id": "...",
            "product_id": "com.lumascout.pro.monthly",
            "entitlement_ids": ["pro"],
            "entitlements": {"pro": {...}},
            "expiration_at_ms": 1727712000000,
            "store": "APP_STORE" | "PLAY_STORE" | "MAC_APP_STORE" | ...,
            ...
          }
        }
    """
    _verify_webhook_auth(authorization)

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_json")

    event = payload.get("event") or payload  # tolerant to shape
    event_type = (event.get("type") or "").upper()
    app_user_id = event.get("app_user_id") or event.get("original_app_user_id")

    log.info(
        "revenuecat_webhook_received type=%s app_user_id=%s product_id=%s store=%s",
        event_type, app_user_id, event.get("product_id"), event.get("store"),
    )

    if not app_user_id:
        # RC sometimes sends test pings without an app_user_id — ack quietly.
        log.info("revenuecat_webhook_no_user_id type=%s — acked", event_type)
        return {"ok": True, "applied": False, "reason": "no_app_user_id"}

    action = RC_EVENT_ACTION.get(event_type, "ignore")
    if action == "ignore":
        return {"ok": True, "applied": False, "reason": f"ignored_{event_type.lower()}"}

    # Resolve which Mongo user this belongs to. We try, in order:
    #   1. revenuecat_app_user_id field (set on first successful login)
    #   2. user_id field (since we use Purchases.logIn(user.user_id))
    user = await db.users.find_one(
        {"$or": [
            {"revenuecat_app_user_id": app_user_id},
            {"user_id": app_user_id},
        ]}
    )
    if not user:
        log.warning("revenuecat_webhook_unknown_user app_user_id=%s type=%s", app_user_id, event_type)
        # Acknowledge so RC doesn't retry forever, but flag for ops.
        return {"ok": True, "applied": False, "reason": "user_not_found"}

    if not _should_apply_rc_event(user):
        log.info(
            "revenuecat_webhook_skipped_for_other_source user_id=%s source=%s status=%s",
            user.get("user_id"), user.get("subscription_source"), user.get("subscription_status"),
        )
        return {"ok": True, "applied": False, "reason": "other_source_active"}

    # ─── Apply the event ────────────────────────────────────────────
    update: Dict[str, Any] = {
        "revenuecat_app_user_id":   app_user_id,
        "revenuecat_last_event":    event_type,
        "revenuecat_last_event_at": utcnow(),
        "revenuecat_product_id":    event.get("product_id"),
        "revenuecat_store":         event.get("store"),
        "revenuecat_expires_at_ms": event.get("expiration_at_ms"),
    }

    if action == "grant":
        entitlements = event.get("entitlements") or {}
        # Some event types ship entitlement_ids as an array instead of dict.
        if not entitlements and isinstance(event.get("entitlement_ids"), list):
            entitlements = {eid: {} for eid in event["entitlement_ids"]}
        new_plan = _plan_from_entitlements(entitlements)
        if not new_plan:
            # Defensive: grant event without entitlements — bail.
            log.warning("revenuecat_grant_without_entitlements user_id=%s type=%s",
                        user.get("user_id"), event_type)
            return {"ok": True, "applied": False, "reason": "no_entitlements_in_event"}
        update["plan"] = new_plan
        update["subscription_source"] = "revenuecat"
        update["subscription_status"] = "active"
    elif action == "revoke":
        update["plan"] = "free"
        # Keep subscription_source so we know they were once on RC.
        update["subscription_source"] = "revenuecat"
        update["subscription_status"] = "expired"

    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    log.info(
        "revenuecat_webhook_applied user_id=%s type=%s action=%s new_plan=%s",
        user.get("user_id"), event_type, action, update.get("plan"),
    )
    return {"ok": True, "applied": True, "action": action, "plan": update.get("plan")}
