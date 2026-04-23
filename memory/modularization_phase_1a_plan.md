# Modularization — Complete through Phase 3 ✅

**Shipped 2026-04-23.** Six domain modules live. server.py down 41%. Zero regressions across 3 phases.

---

## 📊 Cumulative Scoreboard

| Phase | Module | LOC | Endpoints | Tests | Bugs caught |
|---|---|---|---|---|---|
| 1A | marketplace.py | 972 | 22 | 102/102 | 0 |
| 1B | admin.py | 1,294 | 33 | 66/66 | 1 (missing datetime imports) |
| 2a | network.py | 892 | 22 | ~30/30 | 0 |
| 2b | referrals.py | 542 | 10 | 14/14 | 1 (missing GIG_TYPES imports) |
| 2c | push.py | 179 | 7 | ~15/15 | 0 |
| **3** | **spots.py** | **1,320** | **25** | **60/60** | **1 (attach_owners — caught by pre-flight)** |
| — | **TOTAL** | **5,199** | **119** | **267+/267+** | **3 (all import-drift)** |

| Metric | Pre-1A | **Current** | Δ |
|---|---|---|---|
| server.py LOC | 11,279 | **6,654** | **−4,625 (−41%)** |
| routes/ LOC | 0 | 5,199 | +5,199 |
| API paths | 166 | **166** | 0 (perfect parity) |

---

## 🎯 Phase 3 Highlights

### The hardest extraction — done in ~30 minutes
- **1,320 lines moved** covering spot CRUD, uploads, reactions, updates, saves (with trending fanout), reviews, checkins, collections, draft publish, astronomy, LLM shot-list generation.
- **Pre-flight import-drift scan worked** — caught `attach_owners` BEFORE runtime, plus correctly identified 3 false positives (`astronomy` = URL path, `_apply_moderation` + `plan_of` = docstring mentions). The scan is now standard protocol.
- **Zero cross-module breakage:**
  - ✅ Trending spot fanout (saves_after==4) still fires correctly to nearby users (push crosses module boundary: spots.py → server.py send_growth_push → push_log).
  - ✅ Admin cover editor still propagates `admin_cover_override` through `public_spot_view` (stayed in server.py) into the extracted list endpoint.
  - ✅ Marketplace pack contents still resolve spot_ids via shared `public_spot_view`.
  - ✅ Save → spot owner notification still works across the boundary.
  - ✅ Follow, DM, referral, sanction pushes all still emit correctly.

---

## 🔒 What stays in server.py (critical shared infra)

**Still monolithic — these are called by ≥2 modules and rightly belong to shared services:**
- `public_spot_view` — spot shaper, called by spots.py + admin.py + marketplace.py + feed logic
- `_apply_moderation` — moderation engine, called by admin.py + spots.py upload flow
- `_recompute_spot_freshness` — freshness engine, called by spots.py + admin.py upload-moderate
- `_can_auto_approve` — auto-approval rules
- `_hydrate_contributors`, `_hydrate_posts`, `_hydrate_poster` — shaping helpers
- `_compute_astronomy`, `_generate_shot_list` — LLM/astronomy services
- `send_growth_push`, `_emit_notification`, `send_push`, `_BG_PUSH_TASKS`, `NOTIFICATION_CATEGORIES`, `BYPASS_CAP_KINDS`, `DEFAULT_NOTIFICATION_PREFERENCES`, `_is_in_quiet_hours` — push dispatch infra
- `haversine_km`, `limits_for`, `plan_of`, `_effective_plan`, `check_rate_limit`, `utcnow`, `audit_log` — utilities
- `get_current_user`, `get_optional_user`, `require_role`, `attach_owners` — auth deps + helpers
- `db`, `api`, `app` — framework singletons
- `_stripe`, `_stripe_ready`, `_ensure_stripe_customer`, `_refresh_connect_status` — Stripe (used by marketplace + billing)
- `/api/webhook/stripe` — shared webhook for marketplace + subscription billing

**Still in server.py as route handlers** (will move in Phase 4+):
- Auth: /auth/register, /auth/login, /auth/password/*, /auth/me
- Users: /users/{id}, /me/ profile patch, /me/stats, /me/analytics/*, settings, avatars
- Feed: /feed/home, /feed/discover
- Community (some): /posts, /posts/{id}/comments, /polls
- Billing: /billing/*, /billing/checkout, /billing/portal
- Geocode: /geocode/*
- Webhook: /webhook/stripe
- Misc: /platform/*, /config/*

---

## 🛠 The Extraction Pattern (now 7× proven, pre-flight added)

1. **AST-scope** — walk `server.py` top-level for precise `end_lineno` per endpoint + model + helper
2. **Generate** the new module with:
   - `router = APIRouter(prefix="/api", tags=[...])`
   - Late-bound `from server import …`
   - Each block copied verbatim, only `@api.*` → `@router.*`
3. **🆕 Pre-flight import-drift scan** — parse the new module's AST, list all names referenced, cross-check against declared imports + locally-defined names + builtins; block on gaps
4. **Atomic delete + register** in server.py (descending line ranges + `app.include_router` alongside other modules)
5. **Compile check** both files
6. **Restart backend** → verify startup logs clean
7. **OpenAPI path count check** vs baseline
8. **Smoke** hot paths (5-10 endpoints)
9. **Full regression** via testing agent — only re-test the moved surface + cross-module integrations

Time-to-ship per module: ~10-30 min depending on size.

---

## 🔜 Remaining Roadmap

### Phase 4 — `routes/users.py` (next)
- /users/{id}, /me/* profile/settings/avatar, /me/stats, /me/analytics/*
- Dependencies: touches auth deps, plan_of, onboarding_status

### Phase 5 — `routes/auth.py`
- /auth/login, /register, /password/*, /me
- **Highest-sensitivity extraction** — touches JWT + every other module's auth guards
- Strongly recommend a pre-extraction audit of `get_current_user`/`require_role` call sites first

### Phase 6 — `routes/feed.py` + `routes/community.py`
- /feed/home, /feed/discover
- /posts, /comments, /polls (community posts not yet extracted)

### Phase 7 — `routes/billing.py`
- /billing/*, Stripe webhook (cautious — still shared with marketplace)

### Final — `services/` + `models/` reorg
- Extract `push_service.py`, `moderation_service.py`, `geocode_service.py`, `stripe_service.py`
- Split shared Pydantic models into `models/`
- Config consolidation

---

## 📝 Next-session kickoff prompt

> Continue modularization. Phase 4 — extract `routes/users.py` only. Read /app/memory/modularization_phase_1a_plan.md. Follow the proven 9-step pattern including the pre-flight import-drift scan. Preserve profile, settings, avatars, stats, analytics, zero regressions.
