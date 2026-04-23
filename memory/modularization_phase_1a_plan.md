# Modularization Phase 1A — Marketplace Extraction

**Goal:** Move all marketplace logic into `/app/backend/routes/marketplace.py` with
**zero client-visible changes**. Preserve Stripe Connect flows, admin moderation,
seller tools, and all green tests.

**Target:** `/app/backend/server.py` currently ~11,280 lines → reduce by ~1,000 lines.

---

## ✅ Green Baseline (2026-04-23)

Run these BEFORE touching anything to confirm the starting green:

| Test | File | Assertions | Status |
|---|---|---|---|
| Marketplace MVP | `/app/backend_test_marketplace.py` | 76/77 | Last run green (1 known non-bug: price sort featured-first intent) |
| Stripe Connect | `/app/backend_test.py` (Connect scenarios) | 30/30 | Green |
| Push Growth (just-shipped) | `/app/backend_test_push_retest.py` | 13/13 | Green |
| Admin cover editor | `/app/backend_test_cover_editor.py` | 44/45 | Green (1 minor idempotency non-blocker, already fixed) |

**Admin credentials:** `admin@lumascout.app` / `admin123` (super_admin, username `keith`).

---

## 📋 Marketplace Endpoints to Move (22 total)

### Seller (Stripe Connect) — 4 endpoints @ server.py:9205–9319
- `POST /me/seller/onboard`
- `GET  /me/seller/connect-status`
- `POST /me/seller/dashboard-link`
- `GET  /me/seller/payouts`

### Products CRUD — 5 endpoints @ server.py:9413–9547
- `POST   /marketplace/products`
- `GET    /marketplace/products` (with q, type, category, sort, seller_id, featured, limit, skip)
- `GET    /marketplace/storefront` (featured/trending/newest rails + by_type)
- `GET    /marketplace/products/{product_id}` (+ view_count inc)
- `PATCH  /marketplace/products/{product_id}` (price/contents_url change → status='pending')
- `DELETE /marketplace/products/{product_id}` (soft-delete → status='removed')

### Checkout + Purchase — 2 endpoints @ server.py:9550–9839
- `POST /marketplace/products/{product_id}/checkout` (Stripe Connect + MOCK fallback)
- `POST /marketplace/purchases/{purchase_id}/complete` (dev-env finalize)

> ⚠️ `product_checkout` has ~100 lines of dead/legacy code after the first `return` (lines 9695–9794). Move the WHOLE function verbatim — do NOT refactor during extraction. Clean-up is a separate commit.

### Reviews + Wishlist — 4 endpoints @ server.py:9841–9920
- `POST /marketplace/products/{product_id}/reviews` (buyer-only, upserts)
- `GET  /marketplace/products/{product_id}/reviews`
- `POST /marketplace/wishlist/{product_id}` (toggle)
- `GET  /me/wishlist`

### My Marketplace — 2 endpoints @ server.py:9921–9990
- `GET /me/marketplace/sales` (per-product KPIs + gross/net/fee split)
- `GET /me/marketplace/library` (buyer's completed purchases with contents_url unlocked)

### Admin Moderation — 5 endpoints @ server.py:9992–10160
- `POST /admin/marketplace/products/{product_id}/moderate` (approve|deny|feature|unfeature|suspend|unsuspend)
- `GET  /admin/marketplace/pending`
- `POST /admin/marketplace/purchases/{purchase_id}/refund` (reverse_transfer + app fee)
- `GET  /admin/marketplace/purchases` (?status= filter)

**DO NOT MOVE:** the Stripe webhook `@app.post("/api/webhook/stripe")` at server.py:8403 — it handles BOTH marketplace purchase fulfillment AND subscription billing events. Leave in server.py for now; it imports what it needs from module scope.

---

## 🔧 Marketplace-Specific Models + Helpers (MOVE with endpoints)

| Symbol | Line | Notes |
|---|---|---|
| `MarketplaceProductIn` | 9322 | BaseModel + 3 field_validators |
| `MarketplaceProductPatchIn` | 9353 | BaseModel |
| `MarketplaceReviewIn` | 9830 | BaseModel + rating validator |
| `_hydrate_seller(user_id)` | 9364 | Shapes seller dict for product responses |
| `_shape_product(p, viewer)` | 9385 | Core shaper — computes in_wishlist, has_purchased, strips contents_url |
| `PLATFORM_FEE_PCT = 15` | 9126 | Marketplace-only constant |
| `MARKETPLACE_TYPES = {...}` | (search) | Product types whitelist used by validators + storefront rails |

---

## 🔒 Shared Helpers to PRESERVE in server.py (do NOT move)

These are used by marketplace code but ALSO by other modules (billing, webhooks, auth, admin). They MUST stay in server.py for Phase 1A and be imported by `routes/marketplace.py`:

| Symbol | Owner | Used by marketplace? | Used elsewhere? |
|---|---|---|---|
| `db` (Motor AsyncIOMotorDatabase) | server.py | Yes | Everything |
| `api` (APIRouter prefix=/api) | server.py | Yes | Everything |
| `app` (FastAPI) | server.py | No | Stripe webhook, startup |
| `get_current_user` | server.py | Yes | All auth'd routes |
| `get_optional_user` | server.py | Yes | Public-with-viewer routes |
| `require_role(role)` | server.py | Yes | Admin routes |
| `plan_of(user)` | server.py | Yes | Billing, limits |
| `utcnow()` | server.py | Yes | Everything |
| `audit_log(user, action, target_type, target_id, after={})` | server.py | Yes | Admin + destructive |
| `_emit_notification(user_id, kind, title, body, ...)` | server.py (~2811) | Yes (marketplace_sale/refund) | Push, follows, DMs, referrals |
| `send_push(user_ids, title, body, data)` | server.py (~7298) | Indirectly via _emit_notification | Everything |
| `_stripe` (module-level `stripe` import) | server.py (~8125) | Yes | Billing, webhook |
| `_stripe_ready()` | server.py:8140 | Yes | Billing, webhook |
| `_ensure_stripe_customer(user)` | server.py:8188 | Yes (checkout path) | Billing checkout |
| `_refresh_connect_status(user_id, acct_id?)` | server.py:9152 | Yes | Stripe webhook (account.updated) — **critical**: moving this would break the webhook |
| `_app_origin(request)` | server.py:9142 | Yes | Elsewhere for return URLs |
| `CONNECT_COUNTRY`, `CONNECT_STATUS_*` | server.py:9135–9139 | Yes | Stripe webhook |

**Connect status constants are a judgment call** — they COULD move to marketplace.py but the webhook handler uses them too. Safest: leave in server.py, import in marketplace.py.

---

## 🧪 Extraction Pattern — Late-Binding Decorator

Use this pattern (zero handler-signature changes, no circular imports):

```python
# /app/backend/routes/marketplace.py
from __future__ import annotations
import uuid
from typing import Optional, List, Any
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, field_validator

# Late-bound imports from server (resolves at module-load time, AFTER
# server.py has finished initializing `api`, `db`, and all helpers).
from server import (
    api, db,
    get_current_user, get_optional_user,
    plan_of, utcnow, audit_log, _emit_notification,
    _stripe, _stripe_ready, _ensure_stripe_customer,
    _refresh_connect_status, _app_origin,
    CONNECT_COUNTRY, CONNECT_STATUS_DISCONNECTED, CONNECT_STATUS_ONBOARDING,
    CONNECT_STATUS_RESTRICTED, CONNECT_STATUS_ACTIVE,
    PLATFORM_FEE_PCT, MARKETPLACE_TYPES,
)

# --- Marketplace-specific models ---
class MarketplaceProductIn(BaseModel):
    ...  # moved verbatim

# --- Marketplace-specific helpers ---
async def _hydrate_seller(user_id: str) -> dict:
    ...  # moved verbatim

async def _shape_product(p: dict, viewer: Optional[dict] = None) -> dict:
    ...  # moved verbatim

# --- Route handlers (copy verbatim, preserve @api.method decorators) ---
@api.post("/me/seller/onboard")
async def seller_onboard(request: Request, user: dict = Depends(get_current_user)):
    ...  # body verbatim

# ... all 22 endpoints, unchanged
```

Then at the **bottom of `/app/backend/server.py`** (after ALL existing code,
just before or right after `seed_marketplace_demo()` runs):

```python
# Side-effect import — registers all marketplace endpoints on `api`.
from routes import marketplace  # noqa: F401
```

**Why this works:**
- Python caches `server` module once on first load.
- When server.py reaches the bottom, it's fully initialized — `api`, `db`, all helpers exist.
- `from routes import marketplace` loads marketplace.py.
- marketplace.py's `from server import ...` succeeds (cached server module).
- marketplace.py's `@api.post(...)` decorators attach new routes to the **same `api` instance** that server.py mounted.
- Zero path changes. Zero circular import errors. Zero handler signature changes.

---

## 🧹 Extraction Steps (for next session)

1. **Baseline run** — confirm 4 test suites above are green against current server.py.
2. **Create `/app/backend/routes/__init__.py`** (empty).
3. **Create `/app/backend/routes/marketplace.py`** with:
   - Imports block (from server import ...)
   - 3 Pydantic models (MarketplaceProductIn, MarketplaceProductPatchIn, MarketplaceReviewIn)
   - 2 helpers (_hydrate_seller, _shape_product)
   - All 22 endpoints VERBATIM (preserve docstrings, dead code, quirks — this is a move, not a refactor)
4. **Add bottom-of-file import** to server.py: `from routes import marketplace`
5. **Delete the 22 endpoints + 3 models + 2 helpers from server.py** (lines 9205–9319, 9322–9410, 9413–10160 inclusive — verify exact line numbers before deleting since prior edits may have shifted them).
6. **Compile check:** `cd /app/backend && python -m py_compile server.py && python -m py_compile routes/marketplace.py`
7. **Restart backend** — supervisorctl restart backend.
8. **Route inventory check:** `curl -s http://localhost:8001/openapi.json | jq '.paths | keys[]' | grep -E "marketplace|seller|wishlist"` — every path from the list above MUST still be present.
9. **Run `/app/backend_test_marketplace.py`** — expect 76/77 assertions green (same non-bug as baseline).
10. **Run stripe scenarios from `/app/backend_test.py`** — expect 30/30.
11. **Smoke** `/api/feed/home`, `/api/spots?limit=3`, `/api/auth/me` to prove non-regression.

---

## ⚠️ Known Traps

1. **`product_checkout` has dead code** after first `return` (lines 9695–9794). Copy verbatim; don't attempt to clean during extraction.
2. **`seed_marketplace_demo`** is called during startup. If you move the seed function to marketplace.py, server.py must still call it during startup. Safest: leave the seed in server.py for Phase 1A.
3. **`MARKETPLACE_TYPES`** — grep for this constant before moving. If it's used outside marketplace (unlikely but check), leave in server.py.
4. **Stripe webhook at server.py:8403** explicitly handles `metadata.kind == "marketplace_purchase"` — stays in server.py and references `db.marketplace_purchases` directly. DO NOT move.
5. **`_refresh_connect_status`** is called by the webhook (line 8521) for `account.updated` events. If you move it, the webhook breaks. Keep in server.py.
6. **order-of-decorators matters** — `from routes import marketplace` MUST be below `app = FastAPI()`, `api = APIRouter(prefix="/api")`, and all helper definitions. Put it right before the `app.include_router(api)` call.
7. **Startup seed ordering** — `seed_marketplace_demo` and `startup_event` must still run. Verify they still fire by checking backend.err.log for `[stripe] price map ready` + any seed log lines.

---

## 📐 Success Criteria (mirror the user's return format)

After Phase 1A:

1. routes/marketplace.py live → **yes/no**
2. server.py LOC reduced (expect: 11,280 → ~10,180, delta ~1,100 lines) → **yes/no**
3. All routes unchanged (openapi.json diff) → **yes/no**
4. Stripe flows green (30/30) → **yes/no**
5. Tests passed (76/77 marketplace + 30/30 stripe + non-regression) → **yes/no**
6. Ready for admin.py (Phase 1B) → **yes/no**

---

## 🔜 After Phase 1A

**Phase 1B — `routes/admin.py`** (est. 2,000+ LOC): spots admin, users admin, reports, audit, cover editor, sanctions, destructive DELETE endpoints.

**Phase 2 — `routes/network.py`, `routes/referrals.py`, `routes/push.py`**: network discovery, DM threads, trust, viewers, referrals, notifications + prefs + push dispatcher.

**Phase 3 — `routes/spots.py`, `routes/users.py`, `routes/auth.py`**: the core domain + auth (highest care — touches everything).

**Final — `routes/geocode.py`, `routes/billing.py`, shared `services/` + `models/` reorg**.

---

## 📝 Next-session kickoff prompt (save this for the user)

> Continue modularization. Extract marketplace.py only. Read `/app/memory/modularization_phase_1a_plan.md` for the full plan. Preserve all routes, tests, Stripe flows, seller tools, admin moderation, and zero regressions. Run the 4 baseline tests first, then extract, then re-run tests.
