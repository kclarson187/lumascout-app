# Deploy LumaScout Web to Vercel

This is the 10-minute guide to launching the Next.js web app at `lumascout.app`.

> **Why Vercel?** Emergent currently only deploys mobile (Expo) apps. Vercel is built by the Next.js team and is the lowest-friction way to host a Next.js 15 App Router site with server actions, SSR, and custom domains.

---

## ✅ Prerequisites (all already satisfied)
- FastAPI backend live at `https://photo-finder-60.preview.emergentagent.com` (your mobile apps are already hitting it)
- MongoDB live on Emergent
- Stripe configured on backend
- Your Next.js code is in `/app/web/`
- `vercel.json` ⭐ and `.env.production.template` ⭐ already created for you

---

## 🚀 Option 1: Vercel CLI (fastest — 5 minutes)

Run these commands from your local machine (not the Emergent container):

```bash
# 1. Install Vercel CLI globally
npm i -g vercel

# 2. Login (opens browser, sign up / sign in with GitHub)
vercel login

# 3. Clone your project locally (or push to GitHub first)
# If you haven't: in Emergent, click "Save to GitHub" to create a repo.
git clone <your-github-repo-url> lumascout-web
cd lumascout-web/app/web

# 4. Deploy preview first (optional, to verify)
vercel

# 5. Deploy to production
vercel --prod
```

Vercel will prompt you for:
- **Set up and deploy?** → Y
- **Which scope?** → your personal account
- **Link to existing project?** → N
- **Project name?** → `lumascout-web`
- **Directory?** → `./` (since you cd-ed into app/web)
- **Override settings?** → N

You'll get a URL like `https://lumascout-web-abc123.vercel.app`.

---

## 🚀 Option 2: Vercel Dashboard (zero-CLI)

1. In Emergent, click **"Save to GitHub"** (or use the "Export" option) → creates `github.com/<you>/photo-finder-60`
2. Go to [vercel.com/new](https://vercel.com/new)
3. **Import** your GitHub repo
4. **Root Directory** → set to `app/web` (very important — the repo has multiple projects)
5. **Framework Preset** → Next.js (auto-detected)
6. **Build Command** → leave default (`next build`)
7. **Environment Variables** → paste the 4 keys from `.env.production.template` (see below)
8. Click **Deploy**

---

## 🔑 Environment variables to paste into Vercel

In Vercel dashboard → your project → **Settings → Environment Variables** → Production, add:

| Key | Value |
|---|---|
| `API_BASE_URL` | `https://photo-finder-60.preview.emergentagent.com` |
| `NEXT_PUBLIC_API_BASE_URL` | `https://photo-finder-60.preview.emergentagent.com` |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `pk.eyJ1IjoibHVtYXNjb3V0IiwiYSI6ImNtbzlidmI4bTA3eTAycW9pZnU3OW84YXkifQ.30u56QEZ_V59oQmRSZG-nw` |
| `AUTH_COOKIE_NAME` | `lumascout_session` |

> **Do not** set `NODE_ENV` — Vercel handles that automatically.

After saving, **redeploy** (Vercel → Deployments → ⋯ → Redeploy).

---

## 🌐 Custom domain setup — `lumascout.app`

Once the Vercel URL loads correctly (e.g., `https://lumascout-web-abc123.vercel.app`):

1. In Vercel → **Settings → Domains**
2. Click **Add** → enter `lumascout.app` → Add
3. Also add `www.lumascout.app`
4. Vercel shows you DNS records. Example:

   | Type  | Name | Value |
   |-------|------|-------|
   | `A`   | `@`  | `76.76.21.21` |
   | `CNAME` | `www` | `cname.vercel-dns.com` |

5. Go to your domain registrar (Namecheap / Cloudflare / GoDaddy / Porkbun):
   - **Delete ALL existing A records** on `@`
   - Add the 2 records Vercel gave you
   - Save
6. Wait 5–15 minutes for DNS to propagate
7. Vercel auto-issues a TLS cert when DNS resolves
8. Visit `https://lumascout.app` — ✨ it's live!

---

## 🧪 After launch — smoke tests

After the domain is live, verify:

1. `https://lumascout.app/` → homepage loads
2. `https://lumascout.app/pricing` → pricing page
3. `https://lumascout.app/marketplace` → live products from the shared DB
4. `https://lumascout.app/u/keith` → live profile data
5. Sign in with `admin@lumascout.app / admin123` → HttpOnly cookie sets
6. Visit `/dashboard`, `/seller`, `/admin` → all gated correctly
7. Mobile app still works on iOS + Android (they still hit the Emergent backend URL — unchanged)

---

## 🚨 Non-negotiable rule that is honored

✅ Mobile app code untouched. The mobile app continues to hit `photo-finder-60.preview.emergentagent.com/api/*` — the same backend the Vercel web app will hit. **One backend, one database, three client surfaces.**

---

## 📞 Troubleshooting

| Problem | Fix |
|---|---|
| Vercel build fails on "Module not found" | Confirm **Root Directory** is `app/web`, not repo root |
| Site loads but /api/* calls fail | Confirm `NEXT_PUBLIC_API_BASE_URL` env var is set correctly in Vercel |
| Login fails on prod (cookie not set) | Ensure Vercel is HTTPS (it always is) — `sameSite=lax` + `secure=true` will work |
| DNS doesn't resolve after 1 hour | Double-check you removed the OLD A records at the registrar |
| Mapbox map is blank | Check `NEXT_PUBLIC_MAPBOX_TOKEN` env var in Vercel |

---

## 💡 After launch — next wins

- `api.lumascout.app` — give your backend a branded URL too (requires pointing a CNAME at the Emergent host + updating mobile EXPO_PUBLIC_BACKEND_URL in the next app store release)
- Realtime layer (SSE/WebSocket) — instant messages + notifications across web/iOS/Android
- Backend Modularization Phase 5 — routes/auth.py extraction
