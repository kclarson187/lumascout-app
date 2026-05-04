/**
 * Unified spot cover resolver (June 2025 — Map View CR).
 *
 * Why this exists
 * ────────────────
 * Before this util, each surface had its own cascade:
 *   - SpotCard list     → `hero_cover_image_url` → `images[0].{thumb,card,image}_url`
 *   - SpotCardCompact   → `images[].is_cover.image_url` → `images[0].image_url`
 *   - PinPreview (map)  → `hero_cover_image_url` → `images[].is_cover.image_url`
 *   - Spot Detail hero  → same as SpotCard
 *
 * The /api/spots/markers endpoint (lightweight) ships a top-level
 * `thumb_url` — and ONLY that — to keep marker payloads under 6 KB.
 * None of the surface cascades looked at top-level `thumb_url`, so
 * when a marker was tapped, PinPreview showed a blank dark square
 * even though the marker payload had a perfectly good cover URL.
 *
 * This utility centralises the full cascade and absolutizes the
 * resulting URL so every surface renders the correct photo no matter
 * which API feed the spot object came from (markers, full /spots,
 * saved list, spot detail).
 *
 * Cascade priority (first non-empty wins)
 * ───────────────────────────────────────
 *   1.  spot.hero_cover_image_url         (admin-pinned / rotation cover)
 *   2.  spot.cover_image_url              (legacy override)
 *   3.  spot.card_url                     (legacy variant)
 *   4.  spot.image_url                    (legacy single-image spots)
 *   5.  spot.thumb_url                    (/api/spots/markers payload)
 *   6.  images[].is_cover=true → thumb/card/image_url
 *   7.  images[0] → thumb/card/image_url  (or raw string if primitive)
 *   8.  null if no image at all           → caller uses SpotImageFallback
 *
 * The cascade stays on the CLIENT so we don't have to refactor any
 * backend endpoint payloads. Backend already surfaces enough data;
 * we just need to read it from all the right places.
 */
import { resolveBackendUrl } from '../constants/config';

/**
 * Returns the backend origin (no trailing slash).
 *
 * V4 (May 2026 — production fix round 4, user-flagged): this helper
 * PREVIOUSLY had its own local cascade reading `process.env` +
 * `Constants.expoConfig.extra` — BOTH of which are empty in EAS
 * production builds (the `.env` isn't on the build server and
 * Constants.expoConfig.extra is cached natively on iOS upgrades).
 *
 * That made `spot-cover.ts` the HIDDEN BLOCKER for the Explore tab
 * image regression: every Explore / Map / Location Detail surface
 * routes through this file, and it was silently returning empty
 * strings in production → relative `/api/img?u=...` URLs → blank
 * thumbnails.
 *
 * Now it delegates to the shared `resolveBackendUrl()` which has the
 * triple-layered fallback (env → expoConfig.extra → hardcoded
 * PRODUCTION_BACKEND_URL). The hardcoded constant is literally a
 * string in the source so it CANNOT return empty.
 */
function backendBaseUrl(): string {
  return resolveBackendUrl();
}

/** Turn app-relative `/api/uploads/...` into an absolute URL. */
export function absolutizeImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^(https?:|data:|file:|content:|asset:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    const base = backendBaseUrl();
    return base ? `${base}${trimmed}` : trimmed;
  }
  // Bare path — defend by returning as-is so <Image> can still try.
  return trimmed;
}

/**
 * v2.0.24 — Image-resize URL rewriter.
 * ───────────────────────────────────
 * Belt-and-suspenders pair to the backend /api/img proxy. Even though
 * /api/spots/markers already ships thumb_urls that point at /api/img,
 * many call-sites resolve covers from FULL /spots/{id} payloads where
 * `hero_cover_image_url` is the raw Pexels/Unsplash/user-upload URL —
 * NOT pre-wrapped. This helper ensures EVERY <Image> URL renders at a
 * sane size regardless of how it entered the app.
 *
 * The 379 MB cellular session in v2.0.22 was caused by raw 1200px
 * Pexels URLs + 3–8 MB user uploads being served straight into 140×140
 * thumbnail slots. With this rewrite:
 *   • Pexels / Unsplash — append/replace `?w=<width>&q=70` so the CDN
 *     pre-scales BEFORE we download bytes. CDN compute is free to us.
 *   • photo-finder-60.preview.emergentagent.com — wrap through our
 *     /api/img proxy for server-side resize + 7-day disk cache.
 *   • Anything else — pass through unchanged (fallback safety).
 *
 * Width presets (2x DPR already factored in — these are pixel widths,
 * not point widths):
 *   MAP_THUMB = 280   (140pt × 2x for Retina)
 *   LIST_CARD = 560   (280pt × 2x)
 *   HERO      = 1080  (spot-detail hero carousel; looks great at 2x on
 *                      iPhone-sized screens up through 6.7")
 */
export const IMG_PRESETS = {
  MAP_THUMB: 280,
  LIST_CARD: 560,
  HERO: 1080,
} as const;

function _hostOf(url: string): string {
  try {
    // Cheap host extract without URL constructor (RN URL can be flaky).
    const m = url.match(/^https?:\/\/([^/?#]+)/i);
    return (m ? m[1] : '').toLowerCase();
  } catch {
    return '';
  }
}

export function resizeImageUrl(
  url: string | null | undefined,
  width: number = IMG_PRESETS.MAP_THUMB,
  quality: number = 70,
): string | null {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  if (!u) return null;

  // Data URIs, local assets, absolute-path `/api/img?u=...` (already
  // proxied), or relative paths we can't absolutize — pass through.
  if (/^(data:|file:|content:|asset:)/i.test(u)) return u;
  if (u.startsWith('/api/img?')) return absolutizeImageUrl(u);
  if (u.startsWith('/') && !u.startsWith('/api/uploads/')) return absolutizeImageUrl(u);

  const host = _hostOf(u);

  // Pexels / Unsplash — CDN handles resize. Overwrite w= and q=.
  if (host.endsWith('pexels.com') || host.endsWith('unsplash.com')) {
    let out = u;
    if (/[?&]w=/.test(out)) {
      out = out.replace(/([?&])w=[^&]*/i, `$1w=${width}`);
    } else {
      out += (out.includes('?') ? '&' : '?') + `w=${width}`;
    }
    if (/[?&]q=/.test(out)) {
      out = out.replace(/([?&])q=[^&]*/i, `$1q=${quality}`);
    } else {
      out += `&q=${quality}`;
    }
    return out;
  }

  // User uploads on our backend — route through the proxy for resize
  // + 7-day disk cache. absolutizeImageUrl first so relative paths
  // become full URLs our proxy can ingest.
  const abs = absolutizeImageUrl(u);
  if (!abs) return u;
  const absHost = _hostOf(abs);
  if (absHost.includes('photo-finder-60') || absHost.includes('emergentagent.com')) {
    const base = backendBaseUrl();
    if (!base) return abs; // no backend known — can't proxy
    const proxied = `${base}/api/img?u=${encodeURIComponent(abs)}&w=${width}&q=${quality}`;
    return proxied;
  }

  // Unknown host — pass through. React Native <Image> will load it as-is.
  return abs;
}

/** Pull the smallest usable variant from a single image object. */
function pickVariant(img: any): string | null {
  if (!img) return null;
  // Support primitive string items (some legacy endpoints ship a bare
  // URL array rather than full image objects).
  if (typeof img === 'string') return img;
  if (typeof img !== 'object') return null;
  return (
    (typeof img.thumb_url === 'string' && img.thumb_url) ||
    (typeof img.card_url === 'string' && img.card_url) ||
    (typeof img.image_url === 'string' && img.image_url) ||
    (typeof img.url === 'string' && img.url) ||
    null
  );
}

/**
 * Resolve the best available cover image for a spot object from ANY feed.
 * Returns an ABSOLUTE URL or `null` when the spot has no usable image.
 *
 * Safe for any shape: lightweight markers, full spots, partial saved list
 * entries, or freshly-submitted drafts with only an `images[0]` string.
 *
 * v2.0.24 — now accepts an optional `width` hint (default MAP_THUMB=280)
 * so the resize rewriter can produce the right-sized thumbnail per
 * surface. Callers pass `IMG_PRESETS.LIST_CARD` (560) or
 * `IMG_PRESETS.HERO` (1080) when they need larger variants.
 *
 * v2.1.0 (May 2026) — the cascade now mirrors the backend's
 * `cover_image_url` computation in spots.py exactly, so the map
 * preview thumbnail, Explore list, and detail hero can NEVER disagree.
 * The final fallback is the first approved community upload, which
 * lets brand-new spots without owner uploads still show a real photo
 * instead of the generic gradient placeholder.
 *
 * Cascade (first non-null wins):
 *   1. spot.hero_cover_image_url         (admin-pinned / rotation)
 *   2. spot.cover_image_url              (legacy override)
 *   3. spot.card_url                     (legacy variant)
 *   4. spot.image_url                    (legacy single-image spots)
 *   5. spot.thumb_url                    (/api/spots/markers payload)
 *   6. images[is_cover=true]             (explicit cover in images[])
 *   7. images[0]                         (first non-cover image)
 *   8. community_uploads[0]              (oldest approved community photo)
 *   9. null                              (caller renders SpotImageFallback)
 */
export function resolveSpotCover(spot: any, width: number = IMG_PRESETS.MAP_THUMB): string | null {
  if (!spot || typeof spot !== 'object') return null;

  // 1-5. Admin-pinned / rotation / legacy top-level / markers thumb
  const topLevel =
    (typeof spot.hero_cover_image_url === 'string' && spot.hero_cover_image_url) ||
    (typeof spot.cover_image_url === 'string' && spot.cover_image_url) ||
    (typeof spot.card_url === 'string' && spot.card_url) ||
    (typeof spot.image_url === 'string' && spot.image_url) ||
    (typeof spot.thumb_url === 'string' && spot.thumb_url) ||
    null;
  if (topLevel) return resizeImageUrl(absolutizeImageUrl(topLevel), width);

  // 6. Explicit cover in images[]
  const images = Array.isArray(spot.images) ? spot.images : null;
  if (images && images.length) {
    const cover = images.find(
      (i: any) => i && typeof i === 'object' && i.is_cover === true,
    );
    const fromCover = pickVariant(cover);
    if (fromCover) return resizeImageUrl(absolutizeImageUrl(fromCover), width);

    // 7. First image fallback
    const fromFirst = pickVariant(images[0]);
    if (fromFirst) return resizeImageUrl(absolutizeImageUrl(fromFirst), width);
  }

  // 8. First approved community upload — parity with backend cascade
  //    so brand-new spots without owner images still show a real photo.
  //    Accepts EITHER `spot.community_uploads` (spot-detail payload) OR
  //    `spot.community_upload_previews` (list-endpoint denormalization)
  //    OR bare top-level arrays that some admin feeds include.
  const community: any[] =
    (Array.isArray(spot.community_uploads) && spot.community_uploads) ||
    (Array.isArray(spot.community_upload_previews) && spot.community_upload_previews) ||
    [];
  for (const u of community) {
    const url = pickVariant(u);
    if (url) return resizeImageUrl(absolutizeImageUrl(url), width);
  }

  return null;
}

/** Drop-in <Image> source helper for call-sites that prefer objects. */
export function resolveSpotCoverSource(spot: any, width: number = IMG_PRESETS.MAP_THUMB) {
  const u = resolveSpotCover(spot, width);
  return u ? { uri: u } : undefined;
}

/**
 * Width-preset convenience variants. Pass the spot in, get a correctly-
 * sized URL out — zero callsite arithmetic. Prefer these over calling
 * `resolveSpotCover(spot, 280)` so the presets stay the single source
 * of truth if we ever tune them.
 *
 *   resolveSpotCoverForMapThumb  → 280 px  (marker preview / pin thumb)
 *   resolveSpotCoverForListCard  → 560 px  (Explore list / saved / groups)
 *   resolveSpotCoverForHero      → 1080 px (Location Detail hero carousel)
 */
export function resolveSpotCoverForMapThumb(spot: any): string | null {
  return resolveSpotCover(spot, IMG_PRESETS.MAP_THUMB);
}
export function resolveSpotCoverForListCard(spot: any): string | null {
  return resolveSpotCover(spot, IMG_PRESETS.LIST_CARD);
}
export function resolveSpotCoverForHero(spot: any): string | null {
  return resolveSpotCover(spot, IMG_PRESETS.HERO);
}
