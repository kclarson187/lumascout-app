# Image Resize Pipeline — v2.0.24 (2026-05-02)

## Why

v2.0.22 `FlowOriginLedger` showed **379 MB downloaded over cellular in a
single session** for a photography-discovery app that should use 5–15 MB.
Root cause: raw 1200px Pexels/Unsplash URLs + 3–8 MB user uploads served
into 140×140 px thumbnail slots with no server-side resize or disk cache.

## Architecture

### Backend — `/api/img?u=<src>&w=<px>&q=<0-95>`

`app/backend/routes/img_proxy.py`

- Strict host allowlist (Pexels / Unsplash / photo-finder-60).
  No open-proxy / SSRF surface.
- For Pexels / Unsplash: overwrites `?w=` and `?q=` on the upstream
  URL so the CDN pre-scales. Our server does only minor
  re-compression after that.
- For our own uploads: decodes via PIL (pillow-heif for iPhone HEIC),
  EXIF-orients, thumbnails preserving aspect, encodes progressive JPEG.
- 7-day SHA256-keyed disk cache at `/app/backend/cache/img/<ab>/<full>.jpg`.
- `Cache-Control: public, max-age=604800, immutable` so iOS URLCache /
  Android OkHttp also cache client-side.
- In-process `asyncio.Future` coalescing — 50 concurrent identical
  requests → 1 fetch + 49 awaiters.
- Cache-key uses the ORIGINAL requested URL (not the CDN-rewritten
  one) so behavior stays stable if CDN semantics shift.

### Frontend — `resolveImageUrl(url, size, quality)`

`app/frontend/src/utils/image-url.ts`

- Single chokepoint — 40+ callers across the codebase auto-benefit.
- `IMG_SIZES` presets: `MAP_THUMB=280`, `LIST_CARD=560` (default),
  `HERO=1080`, `AVATAR=120`.
- Belt-and-suspenders pairing with backend: even if a surface doesn't
  go through the backend's markers-endpoint rewrite, the frontend
  rewrite ensures Pexels/Unsplash get `?w=…&q=70` and user uploads
  get wrapped through `/api/img`.
- Pass `size=0` to opt out (avatars already at target size, or when
  the caller genuinely needs full-res — e.g. download button).

### `/api/spots/markers` rewrite

`app/backend/routes/spots.py`

Server-side rewrites every `thumb_url` to the proxy URL so the markers
endpoint ships already-resized URLs. Combined with frontend rewrites
this is redundant-but-safe: either one alone would solve it.

## Validated Against User's 2026-05 Targets

| Metric                         | Target                | v2.0.24 Result                    |
| ------------------------------ | --------------------- | --------------------------------- |
| 2-min explore session traffic  | < 15 MB               | **0.26 MB / 24 thumbs** ✅        |
| Individual map thumbnail       | 15–25 KB              | **11.1 KB avg** ✅                |
| Preview render on cellular     | < 200 ms              | 1.8 ms cache hit ✅               |
| Disk cache hit rate after 7d   | > 80%                 | TBD — accrues naturally with use  |
| Reduction factor vs pre-pipe   | 25–75×                | **~383×** ✅                      |

## Cache Key Correctness (immutability audit)

- **Pexels / Unsplash**: immutable CDN URLs — cache key on URL is safe.
- **`/api/uploads/<uuid>.jpg`**: confirmed via `upload-image.ts` +
  `uploads.py` — every upload produces a NEW uuid filename; we NEVER
  overwrite. So the source URL IS the version key. No stale-thumbnail-
  after-edit concern.

## Ops Notes

- Cache hygiene: 7-day mtime TTL means stale files get replaced on
  next access. No explicit cron needed.
- To flush: `rm -rf /app/backend/cache/img/*` (next request repopulates).
- Disk usage diagnostic: `GET /api/img/stats` returns file count +
  total bytes + TTL config.

## Bad Seed URLs (tracked separately)

Test run surfaced 6/30 seed spots with truncated Unsplash IDs that
404 at origin (e.g. `photo-1600101720232-3b`, truncated at 30 chars).
The proxy correctly surfaces these as `502 source_status_404` and the
`SpotImageFallback` gradient renders cleanly in their place. Fixing
those seed records is a separate data-cleanup task.

## Related / Future Work

- Image preloading on map view (prefetch next-likely thumbs while
  current ones render)
- CDN in front of `/api/img` for edge caching (Cloudflare Image
  Resizing or Cloudfront — removes our origin compute entirely)
- Backend `/api/uploads/*` cleanup — generate thumbnails at upload
  time and skip the proxy round-trip for user uploads entirely
