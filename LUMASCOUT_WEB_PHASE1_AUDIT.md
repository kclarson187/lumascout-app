# LumaScout Web — Phase 1 Audit & Plan

**Scope:** Next.js 14 web client connected to the existing **FastAPI + MongoDB** backend (Path A, confirmed by user).  
**Decision date:** 2026-04-30  
**Delivering engineer:** Main agent  
**Builder-to-be:** Next.js implementation (separate Emergent job recommended — see §5)

---

## 1. Existing backend / auth / API audit

### 1.1 Backend stack
- **Framework:** FastAPI (Python 3.11) running on `0.0.0.0:8001`, reload-watched by `watchfiles`.
- **Database:** MongoDB (Motor async driver). Env: `MONGO_URL`, `DB_NAME`.
- **Auth:** Self-hosted JWT + bcrypt. Token in `Authorization: Bearer …`. No Supabase.
  - `POST /api/auth/login` → `{ token, user }`
  - `POST /api/auth/register`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
  - `POST /api/auth/google/session` (Google OAuth via session exchange — already wired)
  - `GET /api/auth/me`, `PATCH /api/auth/me`
  - `POST /api/auth/email-change/request`, `GET /api/auth/email-change/verify`
- **Role model:** `users.role` ∈ `{user, uploader, moderator, admin, super_admin}`. Access via `require_role("admin")` FastAPI dependency. Currently 5 tiers; the Next.js client will honor the same roles.
- **Subscription model:** Stripe-direct. Fields already live on `users`: `stripe_customer_id`, `stripe_subscription_id`, `plan` ∈ `{free, pro, elite}`, `billing_status`, `renewal_date`, `cancel_at_period_end`, `canceled_at`, `payment_failed_at`. Webhook at `POST /api/billing/webhook`.
- **File storage:** Local disk under `/app/backend/uploads/YYYY/MM/<hash>.jpg`, served via `GET /api/uploads/{year}/{month}/{filename}`. Upload endpoint: `POST /api/uploads/image` (multipart form).
- **Telemetry:** backend writes to `audit_logs` for every admin + sensitive action.

### 1.2 Auth flow for Next.js
- **Same JWT, same tokens as mobile.** A user who logs in on web and a user who logs in on mobile both produce/consume the same token type.
- Store in `httpOnly` cookie on the Next.js server side (for SSR + CSRF safety). Mirror to a non-httpOnly cookie if client-side calls need it OR use an Authorization proxy route in `/app/api/*` on Next.
- Session refresh: no refresh token in current backend; tokens are long-lived (the app never rotates until logout). Next.js should adopt the same semantic — no refresh endpoint to call.

---

## 2. Exact API endpoints the web app will use (Phase 1)

| Surface | Method + Path | Purpose |
|---|---|---|
| Auth | `POST /api/auth/login` | email+password → `{token, user}` |
| Auth | `POST /api/auth/register` | new user signup |
| Auth | `POST /api/auth/google/session` | Google OAuth code → session |
| Auth | `POST /api/auth/forgot-password`, `/reset-password` | password reset flow |
| Auth | `GET /api/auth/me`, `PATCH /api/auth/me` | profile load + update |
| Spots | `GET /api/spots?limit=&sort=&lat=&lng=&niche=…` | map list |
| Spots | `GET /api/spots/{spot_id}` | detail |
| Spots | `GET /api/spots/nearby/search?lat=&lng=&radius_km=` | radius query |
| Spots | `GET /api/spots/{spot_id}/uploads` | community uploads for a spot |
| Spots | `GET /api/spots/{spot_id}/astronomy?date=` | sunrise/blue-hour for planning (Phase 2) |
| Users | `GET /api/users/{user_id}` | public profile |
| Uploads | `GET /api/uploads/{year}/{month}/{filename}` | serve image file |
| Billing | `GET /api/me/billing` | current plan + renewal |
| Misc | `GET /api/geocode/reverse?lat=&lng=` | city/state for location chip |

**Total Phase 1 surface: ~15 endpoints.** All already exist; nothing new to build on backend.

---

## 3. User & spot data fields (what Next.js will render)

### `users` (41 fields — abridged to Phase-1-relevant):
```
user_id  email  username  name  role  plan  status  verification_status
avatar_image_url  avatar_url  banner_image_url
bio  city  state  primary_country  specialties[]
stripe_customer_id  stripe_subscription_id  billing_status
renewal_date  cancel_at_period_end
notification_preferences  scout_prefs  location_prefs
created_at  updated_at
```

### `spots` (90 docs, ~60 fields — Phase-1-relevant):
```
spot_id  title  description  city  state  country
latitude  longitude   (NOT PostGIS — plain numeric)
images[]        {image_id, image_url, caption, is_cover, sort_order}
hero_cover_image_url  admin_cover_override
landscape_types[]  shoot_types[]  best_time_of_day[]  seasonality[]
pet_friendly  accessibility_notes  parking_notes  crowd_level  permit_required
privacy_mode    ∈ {public, followers, private, premium}
moderation_status  ∈ {pending, approved, rejected, flagged}
owner_id   (relation to users.user_id)
ratings    nested: lighting / accessibility / safety / crowd / value
created_at  updated_at
```

### Related collections (Phase-2+):
`spot_community_uploads`, `spot_saves`, `spot_reviews`, `spot_checkins`, `spot_updates`, `community_posts`, `post_likes`, `post_comments`, `dm_threads`, `dm_messages`, `marketplace_products`, `marketplace_purchases`, `notifications`, `audit_logs`, `reports`, `follows`.

**No migration required for Phase 1** — all fields already exist.

---

## 4. Files that will be created or changed

### NEW (Next.js project — whether in `/app/web/` or a separate repo):
```
web/
  package.json              Next 14.2, React 18, TS, Tailwind, lucide-react,
                            react-hook-form, zod, @tanstack/react-query, zustand,
                            framer-motion, mapbox-gl
  tsconfig.json  next.config.js  tailwind.config.ts  postcss.config.js
  app/
    layout.tsx              root layout, theme provider, query client
    page.tsx                marketing landing
    login/page.tsx          login form (email + Google)
    signup/page.tsx  forgot-password/page.tsx  reset-password/page.tsx
    onboarding/[step]/page.tsx
    explore/page.tsx        map + filter drawer
    spot/[id]/page.tsx      spot detail
    u/[handle]/page.tsx     public profile (stub in Phase 1)
    settings/page.tsx       account + plan (read-only in Phase 1)
    api/
      auth/[...]/route.ts   auth proxy → FastAPI
  components/ui/            Button, Card, Input, Pill, Modal, Sheet, Toast, etc.
  components/map/           MapCanvas, PinLayer, ClusterLayer, FilterDrawer
  components/spot/          SpotCard, SpotHero, SpotGallery, RatingBars
  lib/
    api.ts                  typed fetch wrapper with cookie/Bearer injection
    schemas/                Zod schemas (login, signup, spot filters)
    auth.ts                 server-side token helpers
    query-client.ts         TanStack Query config
    constants.ts            API base URL, feature flags
  styles/globals.css        tokens: --bg-base, --accent, etc.
  middleware.ts             protect /settings, /u/me, future private routes
  public/                   logo, favicon, OG images
  .env.example              NEXT_PUBLIC_API_URL, NEXT_PUBLIC_MAPBOX_TOKEN
  README.md
```

### CHANGED (existing):
- `/app/backend/*` — **NO changes.** Next.js consumes existing FastAPI unchanged.
- `/app/frontend/*` (Expo mobile) — **NO changes.** Mobile stays untouched.
- **Caveat:** if Next.js is installed inside `/app/web/`, we may need to bump the top-level `/app/package.json` or adjust the supervisor config to run Next.js dev server. This is the **one place where the mobile app could be affected** — see §5.

---

## 5. Risks to the current mobile app

| Risk | Severity | Mitigation |
|---|---|---|
| **Port 3000 collision.** Next.js dev server wants port 3000. Expo web bundle is already on port 3000 via tunnel. Kubernetes ingress routes `/` → 3000 → Expo. | 🔴 **High** | **Option A (recommended):** new Emergent job for Next.js. Clean env, no collision.<br>**Option B:** put Next.js on port 3002; lose web preview of the mobile app (mobile tunnel via QR still works); change supervisor config carefully. |
| **Supervisor config drift** if I add a Next.js service to `/etc/supervisor/conf.d/`. | 🟡 Medium | Keep Expo supervisor untouched. Add a SEPARATE `web-next` supervisor entry. Revertible by removing the single file. |
| **Shared `node_modules`** if `/app/web/` is nested — package hoisting could clobber Expo's React versions. | 🟡 Medium | Next.js in a sibling folder with its own `package.json` + lockfile. Never share deps with Expo. |
| **CORS.** FastAPI currently has permissive CORS; Next.js server-side fetches from FastAPI won't hit CORS at all (same origin via ingress). Client-side fetches to `/api/*` are same-origin (already works for Expo web). | 🟢 Low | No change required. |
| **Image URLs.** Mobile uses `EXPO_PUBLIC_BACKEND_URL` for absolute URLs. Next.js will use `NEXT_PUBLIC_API_URL` — same value. The `resolveImageUrl()` utility pattern will port 1:1. | 🟢 Low | Copy the utility to `web/lib/image-url.ts`. |
| **Auth token storage.** Mobile uses AsyncStorage. Next.js will use httpOnly cookie. Both sign the same JWT format — no backend change. | 🟢 Low | Clear separation. |
| **Stripe webhook handler** is already at `POST /api/billing/webhook`. Adding Next.js does not duplicate it. | 🟢 Low | No change. |

### Recommendation
**Create the Next.js build as a SEPARATE EMERGENT JOB.** Reasons:
1. Port 3000 collision is unavoidable in this job — Expo owns the web preview slot.
2. A separate job gets its own clean container, its own supervisor config, its own preview URL.
3. The two jobs point at the same FastAPI+Mongo backend (via `NEXT_PUBLIC_API_URL` → the public preview URL of this current job). Account continuity is preserved by design.
4. Mobile app in this job keeps working unchanged while web is built in a second environment.

If you'd prefer to keep both in one repo, I can attempt Option B (Next.js on port 3002) — but that loses your mobile web preview AND is harder to revert if anything goes wrong.

---

## 6. Phase 1 implementation checklist

- [ ] **Foundation** — `create-next-app` scaffold, TS strict, Tailwind, path aliases
- [ ] **Design system tokens** — Tailwind config with `--bg-base`, `--accent`, fonts (Fraunces + Inter), radii, shadows
- [ ] **Component kit (Phase-1 subset)** — Button, IconButton, Input, Card, Pill, Badge, Modal, Sheet, Toast, Avatar, Tooltip, Skeleton, EmptyState
- [ ] **API client** — typed fetch wrapper with cookie/Bearer injection, error normalizer, retry
- [ ] **Auth flow** — `/login`, `/signup`, `/forgot-password`, `/reset-password`; httpOnly cookie; server middleware to protect gated routes
- [ ] **Profile load** — `GET /api/auth/me` on server; hydrate provider; avatar + tier badge in app bar
- [ ] **Marketing landing `/`** — hero (serif headline, full-bleed photo), 3 feature sections, pricing teaser, CTA to signup
- [ ] **App shell** — sticky top bar (logo + search + notifications stub + avatar menu), left rail (desktop) / bottom tabs (mobile)
- [ ] **Explore `/explore`** — Mapbox GL JS canvas, amber pins, cluster layer, filter drawer, right-side list (desktop) / bottom sheet (mobile). Pulls `GET /api/spots?…`
- [ ] **Spot detail `/spot/[id]`** — hero gallery (lightbox), owner card, ratings, info grid, action row (save/share/directions), "similar nearby" carousel (Phase-2)
- [ ] **Profile stub `/u/[handle]`** — banner + avatar + bio + specialties + tabs (spots only in Phase 1)
- [ ] **Settings stub `/settings`** — account info, plan badge (read-only), logout
- [ ] **Dark + light theme toggle**
- [ ] **Mobile browser responsive pass** — 390, 768, 1024, 1440 breakpoints
- [ ] **Staging deploy** — Emergent preview URL, `.env.example` documented
- [ ] **README** — env setup, dev commands, API endpoint list, deployment notes

Not in Phase 1 (per your reply):
- Marketplace, portals, messaging, AI planner, analytics, admin, Stripe checkout changes, OpenWeather, Resend, Sentry, PostHog

---

## 7. Rollback plan

Because Next.js will live in a **separate job** (recommended) or in `/app/web/` as an isolated folder:

**Scenario: Next.js build misbehaves / you want to roll back completely**

- **If separate job:** simply stop using that job's preview URL. The mobile app in THIS job is untouched — no rollback needed.
- **If in `/app/web/`:**
  ```bash
  rm -rf /app/web/                     # Remove the entire Next.js folder
  rm -f /etc/supervisor/conf.d/next.conf   # Remove Next.js supervisor entry
  sudo supervisorctl reread && sudo supervisorctl update
  ```
  Mobile Expo and FastAPI are unaffected because neither imported from `/app/web/`.
- **Database state:** Next.js Phase 1 is read-only against user/spot data + auth writes only. No schema changes. No destructive operations. Worst-case rollback = nothing in DB to revert.

---

## Summary for you

- ✅ Backend fully audited: 222 routes, 50+ collections, auth & subscription flows already in place.
- ✅ Phase 1 surface is ~15 existing endpoints — **zero backend work required**.
- ✅ No destructive or schema-changing operations planned.
- ⚠️ Port 3000 is the one real conflict. Recommend doing the Next.js build in a **new Emergent job** for clean isolation.
- ⚠️ Third-party keys deferred to later phases per your instruction: **only Mapbox** is needed in Phase 1 for the map surface. Everything else (Resend, Sentry, PostHog, OpenWeather, Anthropic, Sightengine) can wait.

### Two decisions I need from you before I start coding Phase 1

1. **Where does Next.js live?**
   - **(a)** Separate Emergent job (my strong recommendation) — I deliver this audit as the handoff doc to a new job.
   - **(b)** Here in `/app/web/` alongside mobile — I accept the port juggling, you accept the risk of breaking the mobile web preview.

2. **Mapbox token** — will you provide one for Phase 1, or should I build the Explore screen with the map canvas stubbed behind a "Map loading…" placeholder and wire Mapbox later when you hand me the token?
