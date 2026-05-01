# LumaScout Web — Phase 1 Kickoff Prompt (paste into NEW Emergent chat)

> Copy everything between the two `=====` bars below into a brand-new Emergent chat.
> The audit document referenced lives at `/app/LUMASCOUT_WEB_PHASE1_AUDIT.md` in your current mobile job.
> Paste **both** the audit doc content AND the kickoff prompt so the new agent has the full context.

=====

# LumaScout Web — Phase 1 Build Brief

## Context

You are picking up from a completed audit phase of a production-grade $25K web build. The existing iOS and Android apps ("LumaScout") run on FastAPI + MongoDB. This is the **web companion client** — NOT a new backend, NOT Supabase, NOT a migration. Treat it as adding a third client to an existing system.

Path A (confirmed): **Next.js 14 App Router on the existing FastAPI + MongoDB backend.** Account continuity via the same JWT the mobile app uses.

## Backend to consume (DO NOT modify)

- **Base URL:** `https://photo-finder-60.preview.emergentagent.com/api`
- **Env:** `NEXT_PUBLIC_API_URL=https://photo-finder-60.preview.emergentagent.com/api`
- **Auth:** JWT in `Authorization: Bearer <token>` — token returned from `POST /auth/login`
- **Test credentials (super_admin):**
  - email: `admin@lumascout.app`
  - password: `Grayson@1117!!`
  - (these are real credentials on the live backend — use for auth smoke tests)

The existing mobile app remains untouched in its own Emergent job. This web job must not attempt to run FastAPI, Mongo, or Expo — it consumes the backend via HTTPS only.

## Phase 1 scope (ship this, nothing more)

**Build:**
- Premium responsive marketing landing page `/`
- Auth flow: `/login`, `/signup`, `/forgot-password`, `/reset-password` using existing FastAPI endpoints
- `GET /api/auth/me` loads profile after login — existing mobile users sign in with same credentials
- `/explore` — **list-first**, real spots from `GET /api/spots`. Search, filter bar, distance metadata, save/open actions, spot cards with hero image + rating + city/state. Show a polished "Map view coming soon" empty state where the map canvas will later sit. Do NOT fake pin data.
- `/spot/[id]` — real spot detail from `GET /api/spots/{spot_id}`. Hero gallery, owner card, ratings breakdown, info grid (parking, crowd, permits, seasonality), action row (save/share/directions).
- `/u/[handle]` — profile stub with banner + avatar + tier badge + specialties + spots tab only.
- `/settings` — **read-only** account view + logout. Tier badge. Email. Plan renewal date. No Stripe changes.
- Dark LumaScout theme: amber accent (`#F59E0B`), dark cards, Fraunces serif for headings + Inter body, lucide-react icons 1.5px stroke, `rounded-2xl` cards, subtle shadows.
- Mobile-responsive across 390 / 768 / 1024 / 1440 breakpoints.
- `.env.example` + README with setup commands.

**DO NOT build:**
- Marketplace, messaging, client portals, AI planner, advanced analytics, full admin dashboard, Stripe checkout flow changes, Supabase, database migration, mobile app changes.

## Before writing code

Confirm the following in your first response:
1. The full list of FastAPI endpoints you'll consume for Phase 1 (should be ~15; cross-reference the audit doc).
2. Files you will create (all new; nothing existing is modified).
3. Any dependencies on third-party keys (you should conclude: none for Phase 1 except optional Mapbox, which is deferred).
4. Plan for auth token storage (recommendation: httpOnly cookie server-side, with a thin `/api/auth/*` proxy in Next.js App Router).

Then begin Phase 1 only. Do not advance to Phase 2 without explicit user approval.

## Non-negotiables

- No fake placeholder data. If backend returns empty, show a premium empty state.
- No destructive or schema-changing DB operations of any kind.
- No changes to the iOS/Android apps or their backend behavior.
- Every form: React Hook Form + Zod client-side + trust nothing from the server until validated.
- Every fetch: typed, with error normalization and loading skeletons.
- Dark mode is primary; light mode is a Phase 2+ toggle if time permits.
- Linear / Cron / Notion-level polish. No generic SaaS template feel.

## Deliverables at end of Phase 1

- Deployed Next.js app on an Emergent preview URL (no custom domain DNS required yet — that's Phase 2).
- Clean `README.md` with env vars + dev commands + API endpoint list.
- Loom/video walkthrough optional — visual screenshots are sufficient for review.
- Written summary of what's ready, what's not, what Phase 2 should tackle next.

=====

---

## Pre-flight checklist (before you paste)

- [ ] You have the audit doc content ready: open `/app/LUMASCOUT_WEB_PHASE1_AUDIT.md` and copy its full content.
- [ ] You've opened a new Emergent chat (not continuing this one).
- [ ] First message in the new chat = audit content + the kickoff brief above, in that order.
- [ ] The new agent will spin up a fresh container — don't expect it to see this repo.

## What stays in THIS job (the mobile job)

- Everything is unchanged. Mobile app, FastAPI backend, MongoDB data — all untouched.
- If the new web job needs a backend-side change during Phase 1 (it shouldn't), surface it back to this mobile job as a separate ticket.

## What to watch for in the new job

- If the new agent tries to spin up FastAPI / Mongo / Expo locally — stop it. The new job should ONLY run Next.js and consume the remote backend URL.
- If the new agent suggests Supabase or a schema change — stop it. Path A is confirmed.
- If the new agent wants to add Mapbox before Phase 2 — stop it. List-first is the deliverable.
