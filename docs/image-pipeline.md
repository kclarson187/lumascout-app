# LumaScout Image Pipeline — Developer Reference

**Last updated:** 2026-05-03 (Explore Tab comprehensive audit)

This document is the single reference for how LumaScout resolves, resizes,
serves, and caches spot cover images. If you're touching any image code
and you're not sure which URL variant to use or how the priority cascade
works, read this first.

---

## 1. The canonical cover cascade

When rendering a spot's cover image — whether on the Explore list, a map
pin preview, the Location Detail hero, or an admin panel — the priority
order is ALWAYS:

1. `spot.hero_cover_image_url`  → admin-pinned or rotation-selected
2. `spot.cover_image_url`       → legacy override / user-chosen
3. `spot.card_url`              → legacy variant (some older records)
4. `spot.image_url`             → legacy single-image spots
5. `spot.thumb_url`             → emitted by `/api/spots/markers`
6. `spot.images[is_cover=true]` → explicit cover in the images array
7. `spot.images[0]`             → first non-cover image
8. `spot.community_uploads[0]`  → first APPROVED community contribution
9. `null`                        → render `<SpotImageFallback />`

The backend's serializer (`backend/routes/spots.py` `_cover_for_spot`
helper) computes steps 1–7 and stores the final URL in
`cover_image_url` + `hero_cover_image_url`. The frontend re-runs the
same cascade through a single helper so that anywhere a raw marker /
list / detail payload lands, we always pick the same photo.

## 2. Shared resolver helper

**File:** `frontend/src/utils/spot-cover.ts`

- `resolveSpotCover(spot, width?)` — canonical cascade → absolute URL
  (routed through `/api/img?u=…&w=…&q=…`) or `null`.
- `resolveSpotCoverSource(spot, width?)` — `<Image>` source object variant.
- **Width preset wrappers** (prefer these — zero math at call sites):
  - `resolveSpotCoverForMapThumb(spot)` → **280 px** (pin previews,
    row thumbs)
  - `resolveSpotCoverForListCard(spot)` → **560 px** (Explore list,
    Saved, Groups)
  - `resolveSpotCoverForHero(spot)`     → **1080 px** (Location Detail)

Never call `spot.thumb_url` or `spot.images[0].image_url` directly in a
component — always go through the helper so the cascade stays
consistent if the server fallback order changes.

## 3. Image proxy / resize

**File:** `backend/routes/img_proxy.py`

Every image URL the frontend renders should pass through
`/api/img?u=<encoded original>&w=<target-px>&q=<quality>`:

- Validates the source host (Pexels, Unsplash, or our own
  `photo-finder-60.preview.emergentagent.com`) — other origins are
  rejected `400 host_not_allowed`.
- Fetches, runs `ImageOps.exif_transpose()` to bake orientation,
  downscales to `w` (Lanczos), encodes JPEG at `q`.
- Caches on disk 7 days (content-hashed `sha256(url + w + q)`).
- Adds `Cache-Control: public, max-age=604800`, `ETag`, `Last-Modified`.
- `_is_allowed_host` at line ~133; cache dir `/app/backend/_img_cache`.

For source URLs that already carry `?w=…&q=…` (Pexels/Unsplash),
`_rewrite_upstream_query` overwrites those params so the CDN delivers a
pre-scaled image and we do minimal work locally.

## 4. Upload pipeline

### Endpoint

`POST /api/uploads/image` (`backend/routes/uploads.py`):

1. Accept `multipart/form-data` with `file`.
2. Reject if MIME isn't JPEG/PNG/HEIC/WebP or size > 25 MB.
3. Open via Pillow, call `ImageOps.exif_transpose(img)` to bake in
   rotation before saving (required — `img_proxy` also does this, but
   storing pre-oriented means faster serve + fewer edge cases).
4. Downscale long edge to 2048 px (`LANCZOS`), convert to RGB JPEG
   at quality 85.
5. Write to `/app/backend/_uploads/YYYY/MM/<sha256-of-bytes>.jpg` and
   return `{ image_url: "/api/uploads/YYYY/MM/…jpg", width, height, bytes, mime }`.

### Client flow — `frontend/app/spot/[id]/upload.tsx`

1. **`pickPhotos`** — launches `expo-image-picker`.
2. **`normalizePickedImages`** — runs each asset through
   `expo-image-manipulator` with `{ compress: 0.92, format: JPEG }`
   to bake EXIF orientation + strip metadata, so local preview thumbs
   are never sideways. See `frontend/src/utils/normalize-image.ts`.
3. **Queue** — normalized items pushed into state as
   `{ id, localUri, status: 'pending', progress: 0, attempts: 0 }`.
4. **Sequential uploader** — effect picks up any `pending` item, calls
   `uploadImageAssetWithProgress` (XHR with `onprogress` +
   `AbortSignal`), flips status to `uploading`, writes progress on
   ≥1% deltas.
5. **Auto-retry** — one retry on transient categories
   (`NetworkError`, `TimeoutError`, `ServerError`, `RateLimitError`);
   permanent categories (`AuthError`, `PayloadTooLargeError`,
   `UnsupportedMediaError`) surface a manual Retry button.
6. **Submit** — `POST /api/spots/{id}/uploads` with the successful
   `image_url`s; invalidates `explore.list:v1`, `saved:v1`,
   `groups:v1`, `spot:${id}` caches on success.

**Max: 5 photos per submission.** This was 12 previously — tighter cap
→ better finish rate, fewer client timeouts.

## 5. Cache invalidation

**File:** `frontend/src/utils/swrCache.ts`

Key prefixes that hold rendered cover photos:

| Prefix           | Who writes it                                         |
|------------------|-------------------------------------------------------|
| `explore.list:v1`| `app/(tabs)/explore.tsx` SWR cache                    |
| `saved:v1`       | `app/(tabs)/saved.tsx`                                |
| `groups:v1`      | Groups tab                                            |
| `spot:{id}`      | Spot detail page prefetch                             |

Whenever you POST/PATCH something that changes a spot's cover, call
`invalidateCachePrefix(…)` for every relevant prefix. Current call sites
that do this correctly:

- `app/(tabs)/add.tsx` — spot creation
- `app/spot/[id]/upload.tsx` — community uploads
- `app/admin/spots/[id]/cover.tsx` — admin cover override + gallery reorder

Map markers (`/api/spots/markers`) are NOT cached client-side — they
refetch on every map-view entry, so new covers appear instantly.

## 6. Rendering — what every list/tile component does

1. Call the correct `resolveSpotCoverFor…(spot)` for your surface.
2. Render `<CachedImage source={{ uri }} …>` or `<SafeImage>` when
   not null, else `<SpotImageFallback />`.
3. Own `imgLoaded` + `imgError` state and **RESET BOTH ON COVER CHANGE**
   via a `useEffect(() => { setImgLoaded(false); setImgError(false); },
   [cover])`. Without this, recycled FlashList cells briefly show the
   previous cell's image (the "sizing flash" bug fixed May 2026).
4. Render a shimmer placeholder of the same aspect ratio while
   `!imgLoaded` — this reserves layout and avoids list jump on load.

## 7. Legacy image corrections

Old images that were uploaded BEFORE `ImageOps.exif_transpose` was
added (`uploads.py` rev pre-v2.0) can still be sideways on disk. That
problem is auto-corrected AT SERVE TIME by `img_proxy.py` which runs
`exif_transpose` on every proxied image, so as long as the image
flows through `/api/img?u=…` it displays upright. Never fetch an
upload URL directly — always go through the proxy (the shared
resolver does this automatically).

## 8. Gotchas / things we've been burned by

- **Don't set `cachePolicy="none"` on `expo-image`** — CloudFlare's
  preview tier strips `Cache-Control` headers, so memory-disk caching
  only works if the client insists. Use `<CachedImage>` wrapper.
- **Don't skip `recyclingKey`** on FlashList cells — without a key
  tied to `cover`, expo-image holds the previous source while the new
  one decodes.
- **Don't hardcode widths** in call-sites — always use an `IMG_PRESETS`
  value or the width-preset wrapper. The server negotiates `?w=` with
  the resize rewriter — hardcoded values drift.
- **Don't bypass the resolver** — if you find code reading
  `spot.images[0]` directly, replace it with the shared helper. The
  cascade has 8 steps for a reason.

## 9. Quick contributor checklist

When you add a new surface that shows a spot cover:

- [ ] Import `resolveSpotCoverFor{MapThumb|ListCard|Hero}` from
      `src/utils/spot-cover`.
- [ ] Pass the returned URL to `<CachedImage>` / `<SafeImage>` /
      `<expo-image>`.
- [ ] Maintain `imgLoaded` + `imgError` state and reset both via
      `useEffect([cover], …)`.
- [ ] If the surface lives in a recycled list, set `recyclingKey={cover}`.
- [ ] If you POST something that mutates the cover, call
      `invalidateCachePrefix` for every relevant prefix in §5.
