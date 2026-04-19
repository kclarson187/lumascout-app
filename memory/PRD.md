# PhotoScout — Product Requirements (MVP)

## Vision
PhotoScout is a premium, mobile-first location intelligence and sharing platform **built specifically for photographers**. Save shoot locations, organize them, evaluate them, and share publicly, privately, or with groups.

Tagline: *Find better photo locations. Shoot smarter.*

## MVP Scope (Delivered)

### Authentication
- Email + password JWT auth (register / login / me / update profile)
- Emergent-managed Google Social Login (mobile WebBrowser flow, session_id exchange on backend)
- Mobile uses Authorization Bearer + expo-secure-store

### Core screens (Expo Router file-based)
1. **Onboarding** — 4 hero slides + specialty picker (Family, Pet, Wedding, Portrait, Seniors, Branding, Nature, Urban)
2. **Auth** — login, register, auth-callback
3. **Tabs**:
   - **Home** — curated sections: Nearby, Trending, Golden Hour, Best for you, Seasonal, Following, Recently added. Search bar + quick filter chips.
   - **Explore** — react-native-maps with pins (native), list fallback on web, bottom sheet filter drawer (shoot type, best time, dog/kid friendly, accessible, indoor, permits, fees, min shoot score)
   - **Add Spot** — 6-step wizard (Location → Photos → Details → Notes → Privacy → Review) with base64 image upload
   - **Saved** — Favorites, Collections (create, browse), Private spots tabs
   - **Profile** — avatar, bio, specialties, edit mode, logout
4. **Spot Detail** — hero carousel, score rings (Overall/Light/Access/Variety/Crowd/Safety), shoot intelligence, logistics cards, badges, reviews, similar spots, share, follow contributor
5. **Review / Check-in** — overall rating, comment, quick field updates (access issue, crowd level)
6. **Search** — debounced, popular tags + TX cities
7. **Creator Dashboard** — stat tiles (spots, public, saves received, followers, reviews), top spots, monetization teaser
8. **Paywall** — Free / Pro / Elite tiers (UI only — Stripe deferred)
9. **User Profile** — public contributor view + follow
10. **Admin** — moderation queue, approve/reject
11. **Collection** — collection detail page

### Backend (FastAPI + MongoDB + Motor)
- Models: users, spots, spot_saves, collections, spot_reviews, spot_checkins, follows, reports
- Shoot Score algorithm (weighted combination of light ratings, variety, safety, shade, crowd, image completeness)
- Privacy enforcement: private spots hidden, approximate/hidden coordinate display modes for public spots
- Visibility states: draft / pending_review / approved / rejected (auto-approved for verified contributors)
- Admin role for moderation
- Distance calc (Haversine) + nearby search + similar spots
- Home feed recommendation sections

### Seed data
- 1 admin + 5 demo photographers
- 21 Texas photography spots across Austin, San Antonio, Dallas, Houston, Fredericksburg, Hill Country, Marfa, Big Bend, Galveston, Waco and more

### Design
- Dark cinematic theme (Playfair Display headings + Manrope body)
- Golden Hour Amber accent (#F5A623)
- Score rings, premium badges, map pin color system (public / premium / saved / verified)
- Playfair + Manrope Google Fonts loaded via expo-google-fonts

## Phase 2 (architected, not built)
- Stripe subscriptions
- Creator monetization / premium spot packs marketplace
- Collaborative invite-only groups
- Route planner, golden-hour solar calculations
- Weather overlays
- Offline mode
- Push notifications (in-app notification scaffolding exists; push TBD)

## Data model highlights
- `users.user_id` (UUID), email unique, role (user/admin), verification_status
- `spots` with privacy_mode (private/followers/invite_only/public/premium), location_display_mode (exact/approximate/hidden), visibility_status
- All MongoDB queries use `{"_id": 0}` projection

## Success criteria
- ✅ Photographer can sign up (email or Google)
- ✅ Save & favorite public spots
- ✅ Create private spots with photos
- ✅ Add public spots that enter moderation queue
- ✅ Create and browse collections
- ✅ Follow a contributor
- ✅ Read full spot detail with shoot intelligence
- ✅ Leave a review / check-in
- ✅ Control visibility / privacy modes
- ✅ Discover curated Texas seed content
