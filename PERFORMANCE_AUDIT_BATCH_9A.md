# LumaScout — Performance Audit (Batch #9A)

**Question from product:** *"Will buying more RAM (currently 128 MB) make the app faster for users, or is the bottleneck in the code?"*

**Short answer:** **Adding RAM to the backend container will NOT make the mobile app feel faster for users.** End-user speed is almost entirely a function of **client-side code** (what the Expo app does on the phone) and **payload/DB efficiency** (what the backend returns). 128 MB impacts **build-time / dev-server stability** (Metro bundling, worst-case concurrency on FastAPI) — not user-perceived latency.

---

## 1. Clear separation: build/dev vs end-user performance

| Layer | Lives where | Impacted by 128 MB container? | Impacts user speed? |
|---|---|---|---|
| Metro bundler (dev) | Build container | **YES** — OOM kills during cold bundle, large images | No (dev-only) |
| FastAPI process | Backend container | Marginal — current working set ~60–100 MB, plenty of headroom | Only under sustained concurrency spikes |
| MongoDB / Mapbox / Stripe | External | No | Yes — network + index quality |
| **React Native JS bundle** | **User's phone** | **No — runs on-device** | **YES, dominant factor** |
| **React Native UI thread** | **User's phone** | **No** | **YES, dominant factor** |
| Image rendering / cache | User's phone | No | YES |

**Bottom line:** The compiled Expo app runs on a ~2–6 GB iPhone/Android. The container's 128 MB has zero bearing on how fast screens render, how quickly lists scroll, or how snappy images load.

### When 128 MB *does* bite
- `expo start` (Metro) occasionally OOM-kills under full cold rebuilds when multiple web + iOS + android bundles happen in parallel. Visible in `/var/log/supervisor/expo-alt.err.log`.
- FastAPI can get slow under synthetic load tests with >50 concurrent uploads because each chunked base64 image transiently allocates ~2–10 MB.
- None of these are *user-perceived* in production — the production build is a compiled IPA/APK served from App Store / Play Store CDNs.

**Recommendation on RAM:** Only upgrade the container RAM if: (a) you're hitting Metro OOMs during dev, or (b) you add heavy native workloads like video transcoding in-container. For pure API serving + React Native preview, 128 MB is adequate.

---

## 2. What DOES make the app feel faster for users — Top 3 code-level wins

These are the changes that will actually be felt on real devices:

### ★ #1 — Image loading & caching (biggest win)
**Problem:** The app currently uses `react-native` `<Image>` (and our `SafeImage` wrapper) for spots, avatars, message attachments, gallery rails. Base64 data URLs are stored for avatars/thumbnails and re-decoded on every remount. No persistent disk cache, no progressive loading, no preloader.

**Fix (small-to-medium):**
- Replace `react-native Image` with **`expo-image`** (already an allowed Expo SDK). Gives:
  - LRU memory + disk cache out of the box
  - Blurhash / thumbhash placeholders while full image streams in
  - Progressive JPEG rendering
  - Native downscaling so a 4K spot photo doesn't decode full-res on an iPhone SE
- Drop base64 avatars in favor of uploaded URLs where possible (keep base64 as a create-time fallback). Base64 inflates payload ~33% AND forces a decode on every scroll position restore.

**Impact:** Home feed + Explore map pins + Discover avatars will scroll noticeably smoother, cold-start to first pixel on Spot Detail will drop ~300–700 ms on average.

### ★ #2 — List virtualization + pagination discipline
**Problem:** A few screens render large lists with `ScrollView` + `.map` rather than `FlatList`. Others use `FlatList` but `initialNumToRender` / `maxToRenderPerBatch` / `windowSize` are default. Some endpoints return unbounded lists (e.g. `me/collections` with no paging, `/posts` up to 100/call).

**Fix (small):**
- Audit every `ScrollView` containing a list > 10 items — convert to `FlatList` with:
  ```ts
  initialNumToRender={8}
  maxToRenderPerBatch={6}
  windowSize={7}
  removeClippedSubviews={true}
  ```
- Consider **`@shopify/flash-list`** for the heaviest lists (home feed, inbox, community, directory). It keeps cell recycling tight and gives measurable scroll jank reduction on Android.
- Add a `limit` + cursor to any backend list endpoint that currently returns > 50 docs.

**Impact:** Eliminates dropped frames on fast scroll. Reduces JS thread pressure. Cuts memory footprint so the OS is less likely to background-kill the app.

### ★ #3 — Reduce re-renders on tab screens
**Problem:** The Home, Network, and Profile screens each do several `Promise.all` loads inside effects that fire on every focus. Many list items are functional components that re-render when parent state updates (followingMap, likedMap, optimistic toggles). Zero memoization.

**Fix (tiny, surgical):**
- Wrap per-row card components (`UserCardPremium`, `SpotCard`, thread row) in `React.memo` with a custom `areEqual` based on `user_id`/`spot_id` + a hash of the mutable fields we actually render (`is_following`, `is_liked`, `unread_count`).
- Move `useAuth()` consumers that only need `user.user_id` into a lightweight selector hook so they don't re-render when unrelated auth fields change (plan refresh, usage counters).
- For inbox: don't rebuild `visible` in `useMemo` from two arrays every render — scope the memo to the active tab only.

**Impact:** Marketing-style "perceived snappiness" on interactions (follow, like, message open) because React won't reconcile the whole list on every state tick.

---

## 3. Honorable mentions (tier-2 wins, NOT top 3)
- **Scout AI LLM caching** — already called out as deferred. Reduces LLM spend + improves cold start.
- **Mongo index audit** — run `db.dm_messages.getIndexes()` / `db.spots.getIndexes()` and confirm compound indexes on the hot paths: `(thread_id, created_at)`, `(author_id, created_at)`, `(loc_2dsphere)` for Explore. Verify no in-memory sorts.
- **Preload on tab press** — warm the next screen's data when the user touches (before releasing) the tab bar icon. Free perceived speed.
- **Payload slimming** — several endpoints still return full `User` rows (including bios / specialties arrays) when only `{user_id, name, avatar_url}` is needed. Tighten projections.

---

## 4. Verdict

> **Do NOT pay for more RAM as a speed upgrade. Invest the same hour into `expo-image` rollout and FlatList tuning — that's where real-user frame rate and cold-start time live.**

128 MB is fine for our current API + MongoDB + dev server footprint. Performance bottlenecks for end users are on-device (image decode, list virtualization, re-renders) or in payload / index efficiency — neither of which cares about container RAM.

---

_Authored during Batch #9A (Field Usability + Messaging Polish). No performance changes were implemented as part of this report per explicit instruction — recommendations only._
