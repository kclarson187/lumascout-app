# Modularization Phase 2 — Complete ✅

**Shipped 2026-04-23.** Three modules extracted sequentially: `network.py` → `referrals.py` → `push.py`. 82/82 regression assertions PASS. Zero path changes. Zero behavioural drift.

---

## 📊 Cumulative Refactor Scoreboard

| Metric | Pre-1A | Post-1A | Post-1B | **Post-2** | Total Δ |
|---|---|---|---|---|---|
| `server.py` LOC | 11,279 | 10,386 | 9,247 | **7,845** | **−3,434 (−30%)** |
| `routes/marketplace.py` | — | 972 | 972 | 972 | +972 |
| `routes/admin.py` | — | — | 1,294 | 1,294 | +1,294 |
| `routes/network.py` | — | — | — | **892** | +892 |
| `routes/referrals.py` | — | — | — | **542** | +542 |
| `routes/push.py` | — | — | — | **179** | +179 |
| API paths | 166 | 166 | 166 | **166** | **0** (perfect parity) |
| Regression tests | baseline | 102/102 | 66/66 | **82/82** | ✅ |

server.py is now under 8K lines (from 11.3K baseline). Five domain modules live.

---

## 📦 Phase 2 Modules

### `routes/network.py` (892 lines, 22 endpoints + 2 models)
- Who-Viewed-Your-Profile: `/me/viewers`, `/me/viewers/summary`, `/me/analytics/networking`
- Follow toggle: `POST /users/{id}/follow`
- DM threads: `/dm/threads/start`, `/dm/threads/{id}/messages`, `/dm/threads/{id}/mark-read`/`mute`/`delete`, `GET /dm/threads`, `GET /dm/threads/{id}`
- DM request queue: `/dm/requests/{id}/accept`, `/ignore`, `/block`
- Legacy 1:1: `/conversations` create, list, messages (CRUD)
- Discovery: `/network/discover`, `/network/search`, `/mentors`
- Trust: `GET /users/{id}/trust`

### `routes/referrals.py` (542 lines, 10 endpoints + 3 models + `_shape_need` shaper)
- CRUD: `POST/GET /referrals`, `/referrals/{id}` GET/PATCH/DELETE
- Discovery: `GET /referrals/rails`, `GET /me/referrals`, `GET /me/referral-applications`
- Applications: `POST /referrals/{id}/apply` → opens DM thread + notifies poster
- Acceptance: `POST /referrals/{id}/applications/{app_id}/accept` → emits `referral_application_accepted` push
- Rejection: `POST /referrals/{id}/applications/{app_id}/reject`
- Fire-and-forget `referral_nearby` fanout to same-city `available_for_referrals` users on POST create

### `routes/push.py` (179 lines, 7 endpoints + 2 models)
- `GET + PATCH /me/notification-preferences` (master, categories, quiet_hours, daily_cap)
- `POST /me/notifications/test-push` (delivered=bool)
- `GET /notifications` + `POST /notifications/mark-read`
- `POST + DELETE /me/push-token`

**Core push dispatch INFRASTRUCTURE stays in server.py** — `send_growth_push`, `_emit_notification`, `send_push`, `NOTIFICATION_CATEGORIES`, `BYPASS_CAP_KINDS`, `DEFAULT_NOTIFICATION_PREFERENCES`, `_is_in_quiet_hours`, `_BG_PUSH_TASKS`. These are called from every domain module and rightly belong to shared services.

---

## 🐛 Extraction Bugs Caught & Fixed

| # | Module | Bug | Fix |
|---|---|---|---|
| 1 | referrals.py | Missing imports: `GIG_TYPES`, `REFERRAL_STATUSES`, `REFERRAL_APPLY_CAP_FREE_MONTH` | Added to `from server import (...)` block |

Previous rounds caught 2 similar issues (missing `datetime/timedelta/timezone/uuid` in admin.py, missing `import asyncio` in server.py during push growth). **Pattern: always scan the extracted body for un-declared names before first run.** Could be auto-detected in the extraction script — enhancement for Phase 3.

---

## 🔜 Phase 3 Roadmap

### `routes/spots.py` (highest risk — touches every domain)
- Spot CRUD, uploads, saves, reviews, comments, gallery, discovery, near-me, trending, popular, storefront cover

### `routes/users.py`
- Profile, stats, onboarding, settings, avatar, specialties, availability, city/state patch

### `routes/auth.py`
- Login, register, password reset, session refresh, role guards, signup flows, magic link

**Risk level:** Phase 3 is the highest-care extraction because auth + users + spots form the substrate that every other module calls. Plan to extract one at a time with full regression after each, same as Phase 2.

### Final (Phase 4)
- `routes/geocode.py`, `routes/billing.py` (Stripe webhook + subscription flows), shared `services/` + `models/` reorg, split out constants into `config/` module.

---

## 📝 Next-session kickoff prompt

> Continue modularization. Phase 3 — extract `routes/spots.py` only this round (highest-risk, touches every other domain). Read `/app/memory/modularization_phase_1a_plan.md` for the proven pattern. AST-scope → verbatim copy with `@api→@router` rewrite → atomic delete+register → compile → smoke → full regression. Watch out for missing imports (3 bugs caught so far across phases — scan the extracted body for `NameError` candidates first).
