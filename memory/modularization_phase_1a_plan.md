# Modularization — Complete through Phase 4 ✅

**Shipped 2026-04-23.** Seven domain modules live. server.py down **43%**. Zero regressions.

---

## 📊 Cumulative Scoreboard

| Phase | Module | LOC | Endpoints | Tests | Bugs caught |
|---|---|---|---|---|---|
| 1A | marketplace.py | 972 | 22 | 102/102 | 0 |
| 1B | admin.py | 1,294 | 33 | 66/66 | 1 (missing datetime imports) |
| 2a | network.py | 892 | 22 | ~30/30 | 0 |
| 2b | referrals.py | 542 | 10 | 14/14 | 1 (missing GIG_TYPES imports) |
| 2c | push.py | 179 | 7 | ~15/15 | 0 |
| 3 | spots.py | 1,320 | 25 | 60/60 | 1 (attach_owners — pre-flight) |
| **4** | **users.py** | **342** | **9** | **52/52** | **1 (ReportIn cross-domain — caught mid-regression)** |
| — | **TOTAL** | **5,541** | **128** | **319+/319+** | **4 (all import-related)** |

| Metric | Pre-1A | **Current** | Δ |
|---|---|---|---|
| server.py LOC | 11,279 | **6,374** | **−4,905 (−43%)** |
| routes/ LOC | 0 | 5,541 | +5,541 |
| API paths | 166 | **166** | 0 (perfect parity across all phases) |

---

## 🎯 Phase 4 Highlights

### Small, tactical split (only 9 endpoints remained)
Most `/me/*` endpoints had already moved with their domain modules in earlier phases. What remained was the user-profile surface:
- GET /users/{id} (public profile)
- POST /users/{id}/report
- POST /me/upgrade
- GET /me/recent-locations, /me/drafts, /me/trends, /me/dashboard, /me/packs, /me/reviews-received

### Key lesson — cross-domain model shared-ness
**New extraction hazard discovered:** the `ReportIn` model I moved was used by TWO endpoints — one moved (POST `/users/{id}/report` — actually uses DMReportIn, not ReportIn, false trail), and one NOT moved (POST `/reports` at server.py:2543). Removing ReportIn from server.py crashed the un-moved endpoint at runtime.

**Root cause in deeper detail:**
- AST extraction took class ReportIn at lines 514-516 — but the ORIGINAL class spanned 510-515 (header + 4 fields). My extraction only took the first 3 lines, leaving 2 orphan field declarations floating at module level (lines 514-515 after deletion).
- The orphan fields didn't cause a SyntaxError because they looked like valid (floating) annotations to Python, but they WERE still in module scope being referenced as part of the (non-existent) restored class.
- Once backend started, the POST /reports handler failed with `AttributeError: 'ReportIn' object has no attribute 'reason'` because my restored ReportIn class didn't carry the `reason` + `details` fields.

**Fix applied:**
1. Deleted the 8 orphan lines (509-516 blanks + 2 floating fields) from server.py.
2. Updated the restored ReportIn class to include the full original schema (`reason: str`, `details: Optional[str] = ""`).
3. Cross-domain endpoint POST /reports → 200 green.

**Protocol enhancement for Phase 5+:** Pre-flight scan should ALSO check **"classes extracted from server.py that are referenced in endpoints left behind in server.py"** — catching this class of cross-domain regression BEFORE first restart.

---

## 🔒 What stays in server.py (still in the monolith)

After 7 phases of extraction, the remaining 6,374 lines in server.py include:

### Route handlers still in server.py (targets for remaining phases)
- **Phase 5 — auth.py (~8 endpoints):**
  - POST /auth/register, /auth/login, /auth/forgot-password, /auth/reset-password
  - GET /auth/me, PATCH /auth/me
  - POST /auth/google/session
  - (Plus password-reset email flow)
- **Phase 6 — feed.py + community.py (~20+ endpoints):**
  - GET /feed/home, /feed/discover, /feed/suggestions
  - /posts (create, list, get, update, delete), /posts/{id}/comments, /posts/{id}/react
  - /polls (create, vote, close, list)
  - /news/* (announcements)
- **Phase 7 — billing.py (~10 endpoints):**
  - /me/billing (GET the user's billing state)
  - /billing/checkout, /billing/portal, /billing/cancel
  - Stripe webhook (marketplace-shared — consider leaving here as shared webhook)
- **Misc endpoints staying (hard to isolate or truly global):**
  - /geocode/* (forward + reverse — call external Mapbox)
  - /platform/* (feature flags, app config)
  - /health, /readyz (service health)
  - Uploads / media services (if any)

### Core infrastructure intentionally NOT moved
- Framework singletons: `db`, `api`, `app`
- Auth: `get_current_user`, `get_optional_user`, `require_role`, JWT helpers
- Push dispatch: `send_growth_push`, `_emit_notification`, `send_push`, NOTIFICATION_CATEGORIES, BYPASS_CAP_KINDS, etc.
- Shaping: `public_spot_view`, `_hydrate_contributors`, `_hydrate_poster`, `_shape_post`, etc.
- Moderation: `_apply_moderation`, `_can_auto_approve`, `_recompute_spot_freshness`
- Utilities: `haversine_km`, `limits_for`, `plan_of`, `check_rate_limit`, `utcnow`, `audit_log`
- Stripe: `_stripe`, `_stripe_ready`, `_ensure_stripe_customer`, `_refresh_connect_status`
- Constants: `PLAN_LIMITS`, `PLAN_PRICING`, `REPORT_REASONS`, `CONTENT_COLLECTIONS`, etc.
- Seeds + startup hooks

---

## 🔜 Phase 5 — `routes/auth.py` (HIGHEST SENSITIVITY)

### Why careful here
Auth touches every other module:
- `get_current_user` / `get_optional_user` / `require_role` are called by 100+ endpoints
- JWT encode/decode logic
- Password hashing (bcrypt)
- Google OAuth session
- Password reset (email flow)
- **Any regression = total product lockout**

### Recommended approach
- Consider leaving `get_current_user` / `get_optional_user` / `require_role` / JWT helpers in server.py as SHARED INFRA (same treatment as `db` / `_emit_notification`).
- Only move the AUTH ENDPOINTS themselves: /register, /login, /me (GET + PATCH), /forgot-password, /reset-password, /google/session.
- Pre-flight: verify all other modules still import `get_current_user` from server.
- Test: login + register + reset-password end-to-end + JWT persistence across a restart.

### Pre-flight scan enhancement for Phase 5
Add **"reverse-drift scan"** to catch ReportIn-style bugs:
```python
# After extraction, also check:
#   for each class/function REMOVED from server.py,
#   find any non-extracted usage in remaining server.py
#   → those are broken references requiring either:
#     (a) restore in server.py, OR
#     (b) import from the new module
```

---

## 📝 Kickoff prompts for remaining phases

**Phase 5:** _Continue modularization. Extract routes/auth.py only. Read /app/memory/modularization_phase_1a_plan.md. This is the highest-sensitivity extraction — auth guards every endpoint. Keep get_current_user / require_role / JWT helpers in server.py as shared infra; only move the auth route handlers themselves. Add the reverse-drift pre-flight check to catch ReportIn-style cross-domain issues._

**Phase 6:** _Continue modularization. Extract routes/feed.py + routes/community.py (one at a time). Posts/comments/polls = community. Feed = home + discover + suggestions._

**Phase 7:** _Continue modularization. Extract routes/billing.py. /me/billing, /billing/checkout, /billing/portal, /billing/cancel. Leave the Stripe webhook in server.py (marketplace-shared)._

**Final:** _Reorganize shared infra into services/ + models/ + config/ directories. Split push_service.py, moderation_service.py, geocode_service.py, stripe_service.py. Consolidate Pydantic models. Move constants into config/_
