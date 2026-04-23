"""
routes/marketplace.py — Pack Marketplace endpoints.

Phase 1A of the server.py modularization (extracted 2026-04-23).

Covers:
  • Stripe Connect (Express) seller onboarding + payouts (4 endpoints)
  • Pack products CRUD (6 endpoints)
  • Checkout + purchase completion (2 endpoints)
  • Reviews + wishlist (4 endpoints)
  • Seller sales dashboard + buyer library (2 endpoints)
  • Admin moderation + refund + purchase listing (4 endpoints)

PRESERVED SEMANTICS — no behaviour change, no path change. Every endpoint
was moved verbatim from server.py (same docstrings, same quirks, same
dead-code paths in legacy branches). Any refactor is a SEPARATE commit.

Shared infrastructure (db, auth deps, helpers, Stripe SDK, constants) is
imported from server.py via late-binding, mirroring the pattern already in
use in routes/scout_ai.py, routes/support.py, routes/super_admin.py,
routes/brand.py.

DO NOT MOVE:
  • The Stripe webhook handler @app.post("/api/webhook/stripe") — it handles
    BOTH marketplace purchase fulfillment AND subscription billing events.
    Stays in server.py where it can mutate marketplace_purchases directly.
  • _refresh_connect_status — called by the webhook on account.updated.
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator

from server import (
    db,
    get_current_user, get_optional_user, require_role,
    plan_of, utcnow, audit_log, _emit_notification,
    _stripe, _stripe_ready, _ensure_stripe_customer,
    _refresh_connect_status, _app_origin,
    CONNECT_COUNTRY,
    CONNECT_STATUS_DISCONNECTED,
    CONNECT_STATUS_ONBOARDING,
    CONNECT_STATUS_RESTRICTED,
    CONNECT_STATUS_ACTIVE,
    PLATFORM_FEE_PCT,
    MARKETPLACE_TYPES,
)

router = APIRouter(prefix="/api", tags=["marketplace"])


# --- seller_endpoints (server.py:9205-9319) ---
@router.post("/me/seller/onboard")
async def seller_onboard(request: Request, user: dict = Depends(get_current_user)):
    """Start (or resume) Stripe Express seller onboarding.

    Idempotent: if the user already has a connected account, we return a
    fresh Account Link pointing back to the existing account so onboarding
    can be resumed or completed. Returns {url, acct_id, status}.
    """
    if not _stripe_ready():
        raise HTTPException(status_code=503, detail="Billing is not configured")
    # Reuse existing account if present
    acct_id = user.get("stripe_connect_account_id")
    try:
        if not acct_id:
            acct = _stripe.Account.create(
                type="express",
                country=CONNECT_COUNTRY,
                email=user.get("email"),
                capabilities={
                    "card_payments": {"requested": True},
                    "transfers": {"requested": True},
                },
                business_profile={
                    "name": user.get("name") or user.get("username") or "LumaScout Creator",
                    "product_description": "Photography presets, guides, and digital packs sold via LumaScout Marketplace.",
                    "mcc": "7333",  # Commercial Photography, Art & Graphics
                },
                metadata={"user_id": user["user_id"], "source": "lumascout_marketplace"},
            )
            acct_id = acct.id
            await db.users.update_one(
                {"user_id": user["user_id"]},
                {"$set": {
                    "stripe_connect_account_id": acct_id,
                    "stripe_connect_status": CONNECT_STATUS_ONBOARDING,
                    "stripe_connect_created_at": utcnow(),
                    "updated_at": utcnow(),
                }},
            )
        origin = _app_origin(request)
        link = _stripe.AccountLink.create(
            account=acct_id,
            refresh_url=f"{origin}/me/seller?connect_refresh=1",
            return_url=f"{origin}/me/seller?connect_return=1",
            type="account_onboarding",
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Stripe error: {e}")
    return {"url": link.url, "acct_id": acct_id, "status": CONNECT_STATUS_ONBOARDING}


@router.get("/me/seller/connect-status")
async def seller_connect_status(user: dict = Depends(get_current_user)):
    """Returns live Stripe Connect status for the caller (cached + refreshed)."""
    if not _stripe_ready():
        return {"status": CONNECT_STATUS_DISCONNECTED, "stripe_ready": False}
    info = await _refresh_connect_status(user["user_id"])
    return {**info, "stripe_ready": True}


@router.post("/me/seller/dashboard-link")
async def seller_dashboard_link(user: dict = Depends(get_current_user)):
    """Create a Stripe Express login link — takes the seller to their
    Stripe-hosted dashboard to manage payouts, taxes, and bank account.
    """
    if not _stripe_ready():
        raise HTTPException(status_code=503, detail="Billing is not configured")
    acct_id = user.get("stripe_connect_account_id")
    if not acct_id:
        raise HTTPException(status_code=400, detail="Connect your account first")
    try:
        link = _stripe.Account.create_login_link(acct_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Stripe error: {e}")
    return {"url": link.url}


@router.get("/me/seller/payouts")
async def seller_payouts(limit: int = 20, user: dict = Depends(get_current_user)):
    """List seller's Stripe payouts (from the connected account)."""
    acct_id = user.get("stripe_connect_account_id")
    if not _stripe_ready() or not acct_id:
        return {"items": [], "total": 0, "connected": False}
    try:
        resp = _stripe.Payout.list(limit=min(max(limit, 1), 100), stripe_account=acct_id)
        items = [{
            "id": p.get("id"),
            "amount": p.get("amount"),
            "currency": (p.get("currency") or "usd").upper(),
            "status": p.get("status"),
            "arrival_date": p.get("arrival_date"),
            "method": p.get("method"),
            "created": p.get("created"),
        } for p in (resp.get("data") or [])]
    except Exception as e:  # noqa: BLE001
        print(f"[connect] payout list error: {e}")
        items = []
    # Also compute pending balance via Balance.retrieve (available + pending)
    pending_cents = 0
    available_cents = 0
    try:
        bal = _stripe.Balance.retrieve(stripe_account=acct_id)
        for p in (bal.get("pending") or []):
            if p.get("currency") == "usd": pending_cents += int(p.get("amount") or 0)
        for a in (bal.get("available") or []):
            if a.get("currency") == "usd": available_cents += int(a.get("amount") or 0)
    except Exception:
        pass
    return {
        "items": items,
        "count": len(items),
        "connected": True,
        "pending_cents": pending_cents,
        "available_cents": available_cents,
    }

# --- product_models (server.py:9322-9362) ---
class MarketplaceProductIn(BaseModel):
    title: str
    type: str
    description: str
    price_cents: int
    thumbnail_url: str
    preview_urls: Optional[List[str]] = None
    contents_url: Optional[str] = None   # delivery URL (zip/pdf/etc)
    tags: Optional[List[str]] = None
    category: Optional[str] = None

    @field_validator("title")
    @classmethod
    def _t(cls, v):
        v = (v or "").strip()
        if len(v) < 4 or len(v) > 140: raise ValueError("Title 4..140")
        return v

    @field_validator("type")
    @classmethod
    def _ty(cls, v):
        if v not in MARKETPLACE_TYPES: raise ValueError("Invalid type")
        return v

    @field_validator("price_cents")
    @classmethod
    def _p(cls, v):
        if v < 0 or v > 100_000_00: raise ValueError("Price must be 0..100000 USD")
        return v


class MarketplaceProductPatchIn(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    price_cents: Optional[int] = None
    thumbnail_url: Optional[str] = None
    preview_urls: Optional[List[str]] = None
    contents_url: Optional[str] = None
    tags: Optional[List[str]] = None
    category: Optional[str] = None


# --- shapers (server.py:9364-9410) ---
async def _hydrate_seller(user_id: str) -> dict:
    u = await db.users.find_one({"user_id": user_id}, {
        "_id": 0, "user_id": 1, "name": 1, "username": 1, "avatar_url": 1,
        "plan": 1, "verification_status": 1, "city": 1, "deleted_at": 1,
    })
    if not u:
        # User doc not found — show a neutral fallback instead of empty state.
        return {"user_id": user_id, "name": "Marketplace Creator", "username": "creator"}
    # Soft-deleted users should not appear by their old name on storefront.
    if u.get("deleted_at"):
        return {
            "user_id": u.get("user_id"),
            "name": "Marketplace Creator",
            "username": "creator",
            "avatar_url": None,
            "plan": "free",
        }
    u.pop("deleted_at", None)
    return u


async def _shape_product(p: dict, viewer: Optional[dict] = None) -> dict:
    p = dict(p); p.pop("_id", None)
    p["seller"] = await _hydrate_seller(p.get("seller_user_id"))
    p["in_wishlist"] = False
    p["has_purchased"] = False
    if viewer:
        if await db.marketplace_wishlist.count_documents({
            "user_id": viewer["user_id"], "product_id": p["product_id"],
        }) > 0:
            p["in_wishlist"] = True
        if await db.marketplace_purchases.count_documents({
            "buyer_user_id": viewer["user_id"], "product_id": p["product_id"],
            "status": "completed",
        }) > 0:
            p["has_purchased"] = True
    # Strip contents_url from public response unless viewer has purchased it
    # or is the seller / admin.
    if viewer and (
        p.get("has_purchased")
        or viewer.get("user_id") == p.get("seller_user_id")
        or viewer.get("role") in ("admin", "super_admin", "moderator")
    ):
        pass  # keep contents_url
    else:
        p.pop("contents_url", None)
    return p

# --- products_crud (server.py:9413-9547) ---
@router.post("/marketplace/products")
async def create_product(body: MarketplaceProductIn, user: dict = Depends(get_current_user)):
    now = utcnow()
    doc = {
        "product_id": f"prod_{uuid.uuid4().hex[:12]}",
        "seller_user_id": user["user_id"],
        "seller_plan": plan_of(user),
        "title": body.title,
        "type": body.type,
        "description": (body.description or "").strip(),
        "price_cents": int(body.price_cents),
        "currency": "USD",
        "thumbnail_url": body.thumbnail_url,
        "preview_urls": body.preview_urls or [],
        "contents_url": body.contents_url,
        "tags": body.tags or [],
        "category": body.category,
        "status": "pending",           # admin must approve before active
        "featured": False,
        "view_count": 0,
        "sales_count": 0,
        "rating_avg": 0.0,
        "rating_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    await db.marketplace_products.insert_one(doc)
    return await _shape_product(doc, user)


@router.get("/marketplace/products")
async def list_products(
    q: Optional[str] = None,
    type: Optional[str] = None,
    category: Optional[str] = None,
    sort: Optional[str] = "trending",  # trending | newest | top_rated | price_low | price_high
    seller_id: Optional[str] = None,
    featured: Optional[bool] = None,
    limit: int = 30,
    skip: int = 0,
    viewer: Optional[dict] = Depends(get_optional_user),
):
    filt: dict = {"status": "active"}
    if type: filt["type"] = type
    if category: filt["category"] = category
    if seller_id: filt["seller_user_id"] = seller_id
    if featured: filt["featured"] = True
    if q:
        filt["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
            {"tags": {"$in": [q]}},
        ]
    sort_spec: list = []
    # For explicit price sorts we DON'T prepend featured -- the user asked
    # for cheapest/most expensive first, honor that strictly. For all other
    # sorts, feature-first is the desired product rule.
    if sort == "newest": sort_spec = [("featured", -1), ("created_at", -1)]
    elif sort == "top_rated": sort_spec = [("featured", -1), ("rating_avg", -1), ("rating_count", -1)]
    elif sort == "price_low": sort_spec = [("price_cents", 1), ("created_at", -1)]
    elif sort == "price_high": sort_spec = [("price_cents", -1), ("created_at", -1)]
    else:  # trending: featured, then sales_count + views + recency
        sort_spec = [("featured", -1), ("sales_count", -1), ("view_count", -1), ("created_at", -1)]
    limit = max(1, min(limit, 60))
    skip = max(0, skip)
    total = await db.marketplace_products.count_documents(filt)
    cur = db.marketplace_products.find(filt, {"_id": 0}).sort(sort_spec).skip(skip).limit(limit)
    rows = await cur.to_list(limit)
    items = [await _shape_product(r, viewer) for r in rows]
    return {"items": items, "total": total}


@router.get("/marketplace/storefront")
async def storefront(viewer: Optional[dict] = Depends(get_optional_user)):
    """Returns a curated storefront: Featured (max 6), Trending (6), Newest (6),
    + category rails for each of the 7 product types."""
    async def _rail(filt: dict, sort_spec: list, n: int = 6) -> list:
        cur = db.marketplace_products.find({**filt, "status": "active"}, {"_id": 0}).sort(sort_spec).limit(n)
        rows = await cur.to_list(n)
        return [await _shape_product(r, viewer) for r in rows]
    rails = {
        "featured": await _rail({"featured": True}, [("created_at", -1)]),
        "trending": await _rail({}, [("sales_count", -1), ("view_count", -1)]),
        "newest":   await _rail({}, [("created_at", -1)]),
    }
    by_type: dict = {}
    for t in MARKETPLACE_TYPES.keys():
        rail = await _rail({"type": t}, [("sales_count", -1)])
        if rail:
            by_type[t] = rail
    return {"rails": rails, "by_type": by_type}


@router.get("/marketplace/products/{product_id}")
async def get_product(product_id: str, viewer: Optional[dict] = Depends(get_optional_user)):
    p = await db.marketplace_products.find_one({"product_id": product_id})
    if not p: raise HTTPException(status_code=404, detail="Product not found")
    # Track view (fire & forget)
    try:
        await db.marketplace_products.update_one({"product_id": product_id}, {"$inc": {"view_count": 1}})
    except Exception: pass
    return await _shape_product(p, viewer)


@router.patch("/marketplace/products/{product_id}")
async def patch_product(product_id: str, body: MarketplaceProductPatchIn, user: dict = Depends(get_current_user)):
    p = await db.marketplace_products.find_one({"product_id": product_id})
    if not p: raise HTTPException(status_code=404, detail="Product not found")
    is_owner = p["seller_user_id"] == user["user_id"]
    is_admin = user.get("role") in ("admin", "super_admin")
    if not (is_owner or is_admin):
        raise HTTPException(status_code=403, detail="Not authorized")
    patch: dict = {"updated_at": utcnow()}
    for k, v in body.dict(exclude_unset=True).items():
        if v is None: continue
        patch[k] = v
    # If seller changed price/content, kick back to 'pending' for re-approval
    if is_owner and not is_admin and ("price_cents" in patch or "contents_url" in patch):
        patch["status"] = "pending"
    await db.marketplace_products.update_one({"product_id": product_id}, {"$set": patch})
    p = await db.marketplace_products.find_one({"product_id": product_id})
    return await _shape_product(p, user)


@router.delete("/marketplace/products/{product_id}")
async def delete_product(product_id: str, user: dict = Depends(get_current_user)):
    p = await db.marketplace_products.find_one({"product_id": product_id})
    if not p: raise HTTPException(status_code=404, detail="Not found")
    if p["seller_user_id"] != user["user_id"] and user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Not authorized")
    await db.marketplace_products.update_one(
        {"product_id": product_id},
        {"$set": {"status": "removed", "updated_at": utcnow()}},
    )
    return {"ok": True}

# --- checkout (server.py:9550-9794) ---
@router.post("/marketplace/products/{product_id}/checkout")
async def product_checkout(product_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Real Stripe Connect checkout for a marketplace product.

    Creates a hosted Checkout Session in payment mode with a direct charge
    on the seller's connected Express account, collecting a 15% platform
    fee via `payment_intent_data.application_fee_amount`. 85% is net to
    the seller's balance on their connected account.

    If the seller hasn't completed Stripe Express onboarding (charges_enabled
    = False) we return 400 with a user-friendly error.

    Backwards-compat: when the platform has no STRIPE_API_KEY or the seller
    hasn't onboarded yet, we fall back to MOCK mode so local/test envs can
    still demo the full funnel. The `mocked` flag in the response tells
    the client which path ran.
    """
    p = await db.marketplace_products.find_one({"product_id": product_id})
    if not p: raise HTTPException(status_code=404, detail="Product not found")
    if p["status"] != "active":
        raise HTTPException(status_code=400, detail="Product is not available")
    if p["seller_user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="You can't buy your own product")
    existing_owned = await db.marketplace_purchases.find_one({
        "buyer_user_id": user["user_id"],
        "product_id": product_id,
        "status": "completed",
    })
    if existing_owned:
        return {
            "already_owned": True,
            "purchase_id": existing_owned["purchase_id"],
            "url": None, "mocked": existing_owned.get("mocked", False),
        }

    free = (p["price_cents"] or 0) == 0
    fee_cents = int(p["price_cents"] * PLATFORM_FEE_PCT / 100)
    payout_cents = p["price_cents"] - fee_cents
    purchase_id = f"mp_{uuid.uuid4().hex[:12]}"
    now = utcnow()

    # --- Try real Stripe Connect path ---
    seller = await db.users.find_one({"user_id": p["seller_user_id"]},
        {"_id": 0, "stripe_connect_account_id": 1, "stripe_connect_charges_enabled": 1})
    seller_acct = (seller or {}).get("stripe_connect_account_id")
    seller_ready = bool(seller_acct) and bool((seller or {}).get("stripe_connect_charges_enabled"))
    use_real_stripe = _stripe_ready() and seller_ready and not free

    if use_real_stripe:
        origin = _app_origin(request)
        success_url = f"{origin}/marketplace/purchase-success?purchase_id={purchase_id}&session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = f"{origin}/marketplace/{product_id}?status=cancelled"
        customer_id = await _ensure_stripe_customer(user)
        try:
            session = _stripe.checkout.Session.create(
                mode="payment",
                customer=customer_id,
                line_items=[{
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": p["price_cents"],
                        "product_data": {
                            "name": p["title"],
                            "description": (p.get("description") or "")[:180],
                            "images": [p["thumbnail_url"]] if p.get("thumbnail_url", "").startswith("http") else [],
                        },
                    },
                    "quantity": 1,
                }],
                payment_intent_data={
                    "application_fee_amount": fee_cents,
                    "transfer_data": {"destination": seller_acct},
                    "metadata": {
                        "kind": "marketplace_purchase",
                        "product_id": product_id,
                        "buyer_user_id": user["user_id"],
                        "seller_user_id": p["seller_user_id"],
                        "purchase_id": purchase_id,
                    },
                },
                success_url=success_url,
                cancel_url=cancel_url,
                metadata={
                    "kind": "marketplace_purchase",
                    "product_id": product_id,
                    "buyer_user_id": user["user_id"],
                    "seller_user_id": p["seller_user_id"],
                    "purchase_id": purchase_id,
                },
            )
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"Stripe error: {e}")

        await db.marketplace_purchases.insert_one({
            "purchase_id": purchase_id,
            "product_id": product_id,
            "buyer_user_id": user["user_id"],
            "seller_user_id": p["seller_user_id"],
            "seller_connect_acct_id": seller_acct,
            "price_cents": p["price_cents"],
            "platform_fee_cents": fee_cents,
            "seller_payout_cents": payout_cents,
            "stripe_session_id": session.id,
            "status": "pending",
            "mocked": False,
            "created_at": now,
        })
        return {
            "url": session.url,
            "session_id": session.id,
            "purchase_id": purchase_id,
            "mocked": False,
        }

    # --- Fallback: MOCK mode (free products, or seller not yet onboarded) ---
    await db.marketplace_purchases.insert_one({
        "purchase_id": purchase_id,
        "product_id": product_id,
        "buyer_user_id": user["user_id"],
        "seller_user_id": p["seller_user_id"],
        "seller_connect_acct_id": seller_acct,
        "price_cents": p["price_cents"],
        "platform_fee_cents": fee_cents,
        "seller_payout_cents": payout_cents,
        "stripe_session_id": None,
        "status": "completed" if free else "pending",
        "mocked": True,
        "mock_reason": "free_product" if free else ("seller_not_onboarded" if not seller_ready else "stripe_not_configured"),
        "created_at": now,
        "completed_at": now if free else None,
    })
    if free:
        await db.marketplace_products.update_one(
            {"product_id": product_id}, {"$inc": {"sales_count": 1}},
        )
    return {
        "mocked": True,
        "url": None,
        "purchase_id": purchase_id,
        "price_cents": p["price_cents"],
        "platform_fee_cents": fee_cents,
        "seller_payout_cents": payout_cents,
        "auto_completed": free,
        "seller_not_onboarded": not seller_ready and not free,
    }
    p = await db.marketplace_products.find_one({"product_id": product_id})
    if not p: raise HTTPException(status_code=404, detail="Product not found")
    if p["status"] != "active":
        raise HTTPException(status_code=400, detail="Product is not available")
    if p["seller_user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="You can't buy your own product")
    # Duplicate-purchase guard: if the buyer already owns this product, short-circuit.
    existing_owned = await db.marketplace_purchases.find_one({
        "buyer_user_id": user["user_id"],
        "product_id": product_id,
        "status": "completed",
    })
    if existing_owned:
        return {
            "already_owned": True,
            "purchase_id": existing_owned["purchase_id"],
            "url": None, "mocked": False,
        }

    fee_cents = int(p["price_cents"] * PLATFORM_FEE_PCT / 100)
    payout_cents = p["price_cents"] - fee_cents
    purchase_id = f"mp_{uuid.uuid4().hex[:12]}"

    # MOCK path — no Stripe key configured
    if not _stripe_ready():
        await db.marketplace_purchases.insert_one({
            "purchase_id": purchase_id,
            "product_id": product_id,
            "buyer_user_id": user["user_id"],
            "seller_user_id": p["seller_user_id"],
            "price_cents": p["price_cents"],
            "platform_fee_cents": fee_cents,
            "seller_payout_cents": payout_cents,
            "stripe_session_id": None,
            "status": "pending",
            "mocked": True,
            "created_at": utcnow(),
        })
        return {
            "mocked": True,
            "url": None,
            "purchase_id": purchase_id,
            "price_cents": p["price_cents"],
            "platform_fee_cents": fee_cents,
            "seller_payout_cents": payout_cents,
        }

    # Real Stripe path
    origin = str(request.base_url).rstrip("/")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if fwd_host and "localhost" not in fwd_host:
        origin = f"https://{fwd_host}"
    success_url = f"{origin}/marketplace/{product_id}?status=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/marketplace/{product_id}?status=cancelled"

    customer_id = await _ensure_stripe_customer(user)
    try:
        session = _stripe.checkout.Session.create(
            mode="payment",
            customer=customer_id,
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": p["price_cents"],
                    "product_data": {
                        "name": p["title"],
                        "description": (p.get("description") or "")[:180],
                    },
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "kind": "marketplace_purchase",
                "product_id": product_id,
                "buyer_user_id": user["user_id"],
                "seller_user_id": p["seller_user_id"],
                "platform_fee_cents": str(fee_cents),
                "seller_payout_cents": str(payout_cents),
                "purchase_id": purchase_id,
            },
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Stripe error: {e}")

    await db.marketplace_purchases.insert_one({
        "purchase_id": purchase_id,
        "product_id": product_id,
        "buyer_user_id": user["user_id"],
        "seller_user_id": p["seller_user_id"],
        "price_cents": p["price_cents"],
        "platform_fee_cents": fee_cents,
        "seller_payout_cents": payout_cents,
        "stripe_session_id": session.id,
        "status": "pending",
        "mocked": False,
        "created_at": utcnow(),
    })
    return {"url": session.url, "session_id": session.id, "purchase_id": purchase_id, "mocked": False}

# --- complete_purchase (server.py:9800-9827) ---
@router.post("/marketplace/purchases/{purchase_id}/complete")
async def complete_purchase(purchase_id: str, user: dict = Depends(get_current_user)):
    purchase = await db.marketplace_purchases.find_one({"purchase_id": purchase_id})
    if not purchase: raise HTTPException(status_code=404, detail="Purchase not found")
    if purchase["buyer_user_id"] != user["user_id"] and user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Not authorized")
    if purchase["status"] == "completed":
        return {"ok": True, "already_completed": True}
    await db.marketplace_purchases.update_one(
        {"purchase_id": purchase_id},
        {"$set": {"status": "completed", "completed_at": utcnow()}},
    )
    await db.marketplace_products.update_one(
        {"product_id": purchase["product_id"]},
        {"$inc": {"sales_count": 1}},
    )
    # Notify seller
    try:
        await _emit_notification(
            purchase["seller_user_id"],
            "marketplace_sale",
            "You made a sale! 🎉",
            f"+${purchase['seller_payout_cents'] / 100:.2f}",
            actor_user_id=purchase["buyer_user_id"],
            deep_link=f"/marketplace/{purchase['product_id']}",
        )
    except Exception: pass
    return {"ok": True}

# --- review_model (server.py:9830-9838) ---
class MarketplaceReviewIn(BaseModel):
    rating: int
    text: Optional[str] = None

    @field_validator("rating")
    @classmethod
    def _r(cls, v):
        if v < 1 or v > 5: raise ValueError("rating 1..5")
        return v

# --- review_endpoints (server.py:9841-9889) ---
@router.post("/marketplace/products/{product_id}/reviews")
async def create_review(product_id: str, body: MarketplaceReviewIn, user: dict = Depends(get_current_user)):
    # Must have purchased to review
    has_purchase = await db.marketplace_purchases.count_documents({
        "buyer_user_id": user["user_id"], "product_id": product_id,
        "status": "completed",
    }) > 0
    if not has_purchase:
        raise HTTPException(status_code=403, detail="Only buyers can review")
    existing = await db.marketplace_reviews.find_one({
        "product_id": product_id, "buyer_user_id": user["user_id"],
    })
    now = utcnow()
    if existing:
        await db.marketplace_reviews.update_one(
            {"review_id": existing["review_id"]},
            {"$set": {"rating": body.rating, "text": body.text, "updated_at": now}},
        )
        rid = existing["review_id"]
    else:
        rid = f"rev_{uuid.uuid4().hex[:12]}"
        await db.marketplace_reviews.insert_one({
            "review_id": rid,
            "product_id": product_id,
            "buyer_user_id": user["user_id"],
            "rating": body.rating,
            "text": (body.text or "").strip() or None,
            "created_at": now,
        })
    # Recompute aggregate
    agg = await db.marketplace_reviews.aggregate([
        {"$match": {"product_id": product_id}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    if agg:
        await db.marketplace_products.update_one(
            {"product_id": product_id},
            {"$set": {"rating_avg": round(agg[0]["avg"], 2), "rating_count": agg[0]["count"]}},
        )
    return {"ok": True, "review_id": rid}


@router.get("/marketplace/products/{product_id}/reviews")
async def list_reviews(product_id: str, limit: int = 20):
    cur = db.marketplace_reviews.find({"product_id": product_id}, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 100)))
    rows = await cur.to_list(100)
    for r in rows:
        r["reviewer"] = await _hydrate_seller(r["buyer_user_id"])
    return {"items": rows, "count": len(rows)}

# --- wishlist (server.py:9892-9918) ---
@router.post("/marketplace/wishlist/{product_id}")
async def toggle_wishlist(product_id: str, user: dict = Depends(get_current_user)):
    existing = await db.marketplace_wishlist.find_one({
        "user_id": user["user_id"], "product_id": product_id,
    })
    if existing:
        await db.marketplace_wishlist.delete_one({"wishlist_id": existing["wishlist_id"]})
        return {"in_wishlist": False}
    await db.marketplace_wishlist.insert_one({
        "wishlist_id": f"wl_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "product_id": product_id,
        "added_at": utcnow(),
    })
    return {"in_wishlist": True}


@router.get("/me/wishlist")
async def my_wishlist(user: dict = Depends(get_current_user)):
    cur = db.marketplace_wishlist.find({"user_id": user["user_id"]}, {"_id": 0}).sort("added_at", -1)
    rows = await cur.to_list(200)
    items: list = []
    for w in rows:
        p = await db.marketplace_products.find_one({"product_id": w["product_id"]})
        if p and p.get("status") == "active":
            items.append(await _shape_product(p, user))
    return {"items": items, "count": len(items)}

# --- my_marketplace (server.py:9921-9983) ---
@router.get("/me/marketplace/sales")
async def my_sales(since_days: int = 90, user: dict = Depends(get_current_user)):
    since = utcnow() - timedelta(days=max(1, min(since_days, 365)))
    cur = db.marketplace_purchases.find(
        {"seller_user_id": user["user_id"], "created_at": {"$gte": since}},
        {"_id": 0},
    ).sort("created_at", -1).limit(500)
    purchases = await cur.to_list(500)

    total_sales = sum(1 for p in purchases if p["status"] == "completed")
    gross_cents = sum(p["price_cents"] for p in purchases if p["status"] == "completed")
    net_cents = sum(p["seller_payout_cents"] for p in purchases if p["status"] == "completed")
    fee_cents = sum(p["platform_fee_cents"] for p in purchases if p["status"] == "completed")

    # Product stats
    product_ids = list({p["product_id"] for p in purchases})
    products_cur = db.marketplace_products.find({"seller_user_id": user["user_id"]}, {"_id": 0})
    products = await products_cur.to_list(300)
    product_stats = []
    for p in products:
        pid = p["product_id"]
        sales = [x for x in purchases if x["product_id"] == pid and x["status"] == "completed"]
        product_stats.append({
            "product_id": pid,
            "title": p["title"],
            "thumbnail_url": p.get("thumbnail_url"),
            "view_count": p.get("view_count", 0),
            "sales": len(sales),
            "revenue_cents": sum(s["seller_payout_cents"] for s in sales),
            "status": p.get("status"),
            "rating_avg": p.get("rating_avg", 0),
        })
    product_stats.sort(key=lambda x: -x["revenue_cents"])

    return {
        "since_days": since_days,
        "total_sales": total_sales,
        "gross_cents": gross_cents,
        "net_cents": net_cents,
        "platform_fee_cents": fee_cents,
        "platform_fee_pct": PLATFORM_FEE_PCT,
        "products": product_stats,
        "recent_purchases": purchases[:20],
    }


@router.get("/me/marketplace/library")
async def my_library(user: dict = Depends(get_current_user)):
    cur = db.marketplace_purchases.find(
        {"buyer_user_id": user["user_id"], "status": "completed"},
        {"_id": 0},
    ).sort("completed_at", -1).limit(500)
    purchases = await cur.to_list(500)
    items = []
    for p in purchases:
        prod = await db.marketplace_products.find_one({"product_id": p["product_id"]})
        if prod:
            items.append({
                "purchase_id": p["purchase_id"],
                "purchased_at": p.get("completed_at"),
                "product": await _shape_product(prod, user),
            })
    return {"items": items, "count": len(items)}

# --- admin_models_actions (server.py:9986-10121) ---
# ---- Admin marketplace moderation ----
class AdminProductModerateIn(BaseModel):
    action: str        # approve | deny | feature | unfeature | suspend | unsuspend
    reason: Optional[str] = None


@router.post("/admin/marketplace/products/{product_id}/moderate")
async def admin_moderate_product(
    product_id: str, body: AdminProductModerateIn,
    me: dict = Depends(require_role("admin")),
):
    p = await db.marketplace_products.find_one({"product_id": product_id})
    if not p: raise HTTPException(status_code=404, detail="Product not found")
    before = {"status": p.get("status"), "featured": p.get("featured")}
    patch: dict = {"updated_at": utcnow(), "moderated_by": me["user_id"]}
    a = body.action
    if a == "approve":
        patch["status"] = "active"
    elif a == "deny":
        patch["status"] = "denied"
        patch["deny_reason"] = body.reason
    elif a == "feature":
        patch["featured"] = True
    elif a == "unfeature":
        patch["featured"] = False
    elif a == "suspend":
        patch["status"] = "suspended"
        patch["suspend_reason"] = body.reason
    elif a == "unsuspend":
        patch["status"] = "active"
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    await db.marketplace_products.update_one({"product_id": product_id}, {"$set": patch})
    await audit_log(me, f"marketplace_product.{a}", "marketplace_product", product_id,
                    before=before, after=patch, notes=body.reason)
    return {"ok": True, "action": a}


@router.get("/admin/marketplace/pending")
async def admin_pending_products(me: dict = Depends(require_role("moderator"))):
    cur = db.marketplace_products.find({"status": "pending"}, {"_id": 0}).sort("created_at", 1).limit(100)
    rows = await cur.to_list(100)
    for r in rows:
        r["seller"] = await _hydrate_seller(r.get("seller_user_id"))
    return {"items": rows, "count": len(rows)}


class AdminRefundIn(BaseModel):
    reason: Optional[str] = None
    amount_cents: Optional[int] = None   # partial; defaults to full


@router.post("/admin/marketplace/purchases/{purchase_id}/refund")
async def admin_refund_purchase(
    purchase_id: str, body: AdminRefundIn,
    me: dict = Depends(require_role("admin")),
):
    """Admin refund a marketplace purchase. Full refund by default; pass
    amount_cents for partial. Refunds application_fee + seller transfer so
    the platform and seller both lose the money (matches Stripe Connect
    refund semantics)."""
    purchase = await db.marketplace_purchases.find_one({"purchase_id": purchase_id})
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if purchase.get("status") == "refunded":
        return {"ok": True, "already_refunded": True}
    pi = purchase.get("stripe_payment_intent")
    refund_amount = body.amount_cents or purchase["price_cents"]
    refund_obj = None
    if _stripe_ready() and pi and not purchase.get("mocked"):
        try:
            refund_obj = _stripe.Refund.create(
                payment_intent=pi,
                amount=refund_amount,
                reverse_transfer=True,     # Pull money back from seller's Connect balance
                refund_application_fee=True,  # Refund the 15% platform fee too
                metadata={
                    "purchase_id": purchase_id,
                    "admin_user_id": me["user_id"],
                    "reason": (body.reason or "")[:200],
                },
            )
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"Stripe error: {e}")
    # Update local records (webhook charge.refunded will also run, but we
    # flip status immediately for responsive UX)
    await db.marketplace_purchases.update_one(
        {"purchase_id": purchase_id},
        {"$set": {
            "status": "refunded",
            "refunded_at": utcnow(),
            "refund_reason": body.reason,
            "refund_amount_cents": refund_amount,
            "refund_actor_user_id": me["user_id"],
            "stripe_refund_id": (refund_obj or {}).get("id") if refund_obj else None,
        }},
    )
    await db.marketplace_products.update_one(
        {"product_id": purchase["product_id"], "sales_count": {"$gt": 0}},
        {"$inc": {"sales_count": -1}},
    )
    await audit_log(
        me, "marketplace_purchase.refund", "marketplace_purchase", purchase_id,
        before={"status": purchase.get("status")},
        after={"status": "refunded", "amount_cents": refund_amount},
        notes=body.reason,
    )
    try:
        await _emit_notification(
            purchase["buyer_user_id"],
            "marketplace_refund",
            "Refund processed",
            f"${refund_amount / 100:.2f} refunded — {body.reason or 'Admin decision'}",
            deep_link=f"/marketplace/{purchase['product_id']}",
        )
    except Exception: pass
    return {"ok": True, "refund_amount_cents": refund_amount, "mocked": bool(purchase.get("mocked"))}


@router.get("/admin/marketplace/purchases")
async def admin_list_purchases(
    status: Optional[str] = None, limit: int = 50,
    me: dict = Depends(require_role("admin")),
):
    """Admin view of recent purchases. Filter by status (pending, completed,
    refunded). Hydrates buyer + seller + product summaries for the UI."""
    filt: dict = {}
    if status: filt["status"] = status
    cur = db.marketplace_purchases.find(filt, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 200)))
    rows = await cur.to_list(200)
    for r in rows:
        r["buyer"] = await _hydrate_seller(r.get("buyer_user_id"))
        r["seller"] = await _hydrate_seller(r.get("seller_user_id"))
        prod = await db.marketplace_products.find_one({"product_id": r.get("product_id")}, {"_id": 0, "title": 1, "thumbnail_url": 1})
        r["product"] = prod or {}
    return {"items": rows, "count": len(rows)}

