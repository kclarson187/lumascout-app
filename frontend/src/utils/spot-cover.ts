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
import Constants from 'expo-constants';

/** Returns the backend origin (no trailing slash). Empty string if unset. */
function backendBaseUrl(): string {
  const raw =
    (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
    (Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
    '';
  return raw.replace(/\/+$/, '');
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
 */
export function resolveSpotCover(spot: any): string | null {
  if (!spot || typeof spot !== 'object') return null;

  // 1. Admin-pinned / rotation cover
  // 2. Legacy top-level overrides
  // 3. Markers endpoint top-level thumb
  const topLevel =
    (typeof spot.hero_cover_image_url === 'string' && spot.hero_cover_image_url) ||
    (typeof spot.cover_image_url === 'string' && spot.cover_image_url) ||
    (typeof spot.card_url === 'string' && spot.card_url) ||
    (typeof spot.image_url === 'string' && spot.image_url) ||
    (typeof spot.thumb_url === 'string' && spot.thumb_url) ||
    null;
  if (topLevel) return absolutizeImageUrl(topLevel);

  // 4. Explicit cover in images[]
  const images = Array.isArray(spot.images) ? spot.images : null;
  if (images && images.length) {
    const cover = images.find(
      (i: any) => i && typeof i === 'object' && i.is_cover === true,
    );
    const fromCover = pickVariant(cover);
    if (fromCover) return absolutizeImageUrl(fromCover);

    // 5. First image fallback
    const fromFirst = pickVariant(images[0]);
    if (fromFirst) return absolutizeImageUrl(fromFirst);
  }

  return null;
}

/** Drop-in <Image> source helper for call-sites that prefer objects. */
export function resolveSpotCoverSource(spot: any) {
  const u = resolveSpotCover(spot);
  return u ? { uri: u } : undefined;
}
