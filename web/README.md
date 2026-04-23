# LumaScout Web — Next.js 15 Desktop + Tablet Platform

Companion web platform for the LumaScout mobile app. Shares the FastAPI backend, MongoDB, auth (JWT via httpOnly cookie), Stripe, marketplace, and users.

## Stack
- Next.js 15 App Router + TypeScript
- Tailwind CSS (dark luxury theme)
- Radix primitives + custom UI components
- Mapbox GL JS (Phase 2)

## Local dev
```bash
cd /app/web
yarn install
yarn dev        # starts on http://localhost:3001
```

Backend must be running at `http://localhost:8001` (same instance used by the mobile app). The cookie-based auth proxy routes login/register through `/api/auth/*` and sets an httpOnly `lumascout_session` cookie.

## Architecture
- `app/` — App Router pages (public + authed + admin)
- `components/` — Nav, Footer, UI primitives
- `lib/api.ts` — Server-side backend client (reads JWT from cookie)
- `app/api/auth/*` — Auth proxy with httpOnly cookie
- `middleware.ts` — Protects `/app`, `/dashboard`, `/inbox`, `/seller`, `/admin`
- `app/sitemap.ts` — SEO base; city landing pages in `/spots/[city]`

## Shipped in Phase 1
- Foundation (routing, nav, footer, theme tokens, API client, middleware, SEO, sitemap, robots)
- Homepage (7 cinematic sections)
- Pricing page (monthly/annual toggle, comparison table, FAQ)
- Auth plumbing (login/logout/me routes with httpOnly cookie)

## Queued next
- `/login`, `/register` UI
- `/u/[username]` public creator profiles
- `/marketplace` public storefront
- `/spots/[city]` SEO city landing pages
- `/map` desktop map planner (Mapbox GL JS)
- `/dashboard`, `/inbox`, `/seller`, `/admin` logged-in experience
