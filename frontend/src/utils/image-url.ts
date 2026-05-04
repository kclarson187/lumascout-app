/**
 * Image URL resolver (Apr 2026, upgraded v2.0.24 May 2026).
 *
 * React Native's <Image> cannot render relative URLs — on iOS / Android
 * the app has no "current origin" to resolve them against. The backend
 * returns `/api/uploads/2026/04/<uuid>.jpg` when a user uploads a photo;
 * unless we prefix it with the backend URL, the <Image> tag silently
 * fails and the slot stays blank.
 *
 * We centralise the resolve step here so every call-site (thumbnails,
 * hero carousel, SpotCard cover, saved list, edit-request picker, ...)
 * can wrap its URL in `resolveImageUrl(url, size)` and "just work"
 * whether the stored value is already absolute, app-relative, or
 * fully-qualified.
 *
 * v2.0.24 — Image resize pipeline (FlowOriginLedger showed 379 MB /
 * session on cellular). Now accepts an optional `width` hint (default
 * 560 = LIST_CARD) that routes through the resize rewriter:
 *   • Pexels / Unsplash — CDN-side `?w=…&q=70` query param replace
 *   • photo-finder-60 user uploads — `/api/img?u=…&w=…&q=70` proxy
 *   • everything else — pass through untouched
 * Target footprint per session: <15 MB.
 */
import { resolveBackendUrl } from '../constants/config';

// V3 (May 2026 — production fix 2): triple-layered fallback via the
// shared helper — env var → Constants.expoConfig.extra → hardcoded
// production URL. Survives both gitignored `.env` on the EAS build
// server AND iOS caching Constants.expoConfig.extra across upgrades
// (Expo SDK 50–54 known bug, expo/expo#33692).
function backendBaseUrl(): string {
  return resolveBackendUrl();
}

/**
 * Pixel-width presets for the resize rewriter. These already factor in
 * 2× DPR, so `MAP_THUMB = 280` renders crisply in a 140pt × 140pt slot.
 * Use `HERO` for full-bleed photos on spot detail, `LIST_CARD` for
 * 280pt-wide feed cards, `MAP_THUMB` for the small preview sheet.
 */
export const IMG_SIZES = {
  MAP_THUMB: 280,
  LIST_CARD: 560,
  HERO: 1080,
  AVATAR: 120,
} as const;

function _host(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)/i);
  return (m ? m[1] : '').toLowerCase();
}

/** Apply size rewrite to an already-absolute URL. */
function _rewriteSize(absUrl: string, width: number, quality: number): string {
  // Already routed through our proxy — leave it alone.
  if (absUrl.includes('/api/img?u=')) return absUrl;

  const host = _host(absUrl);

  // CDN-backed sources: overwrite their own `?w=` and `?q=`. Zero cost
  // to us — the CDN does the downscaling before we even fetch bytes.
  if (host.endsWith('pexels.com') || host.endsWith('unsplash.com')) {
    let out = absUrl;
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

  // Our own uploads — route through /api/img for resize + 7-day disk
  // cache. UUID filenames are immutable (confirmed in uploads pipeline)
  // so the source URL is a valid cache key on its own.
  if (host.includes('photo-finder-60') || host.includes('emergentagent.com')) {
    const base = backendBaseUrl();
    if (!base) return absUrl;
    return `${base}/api/img?u=${encodeURIComponent(absUrl)}&w=${width}&q=${quality}`;
  }

  // Unknown host — pass through. Don't risk breaking a legitimate URL.
  return absUrl;
}

/**
 * Resolve + optionally resize an image URL for <Image>.
 *
 * @param url    the stored image URL (may be relative, absolute, data:, or empty)
 * @param size   target pixel width (default LIST_CARD = 560). Pass 0 or
 *               `undefined` to skip resize (useful for avatars already
 *               delivered at the right size, or for full-res downloads).
 */
export function resolveImageUrl(
  url: string | null | undefined,
  size: number = IMG_SIZES.LIST_CARD,
  quality: number = 70,
): string | undefined {
  if (!url || typeof url !== 'string') return undefined;

  // data: URIs — can't resize, pass through.
  if (url.startsWith('data:')) return url;

  // Step 1: absolutize.
  let abs: string;
  if (/^https?:\/\//i.test(url)) {
    abs = url;
  } else if (url.startsWith('/')) {
    const base = backendBaseUrl();
    abs = base ? `${base}${url}` : url;
  } else {
    // Bare path or unexpected format — defend by returning as-is.
    return url;
  }

  // Step 2: resize (if size > 0). Callers can opt out by passing 0.
  if (!size || size <= 0) return abs;
  return _rewriteSize(abs, size, quality);
}

/** Same semantics, but returns a usable Image source object. */
export function resolveImageSource(
  url: string | null | undefined,
  size: number = IMG_SIZES.LIST_CARD,
  quality: number = 70,
) {
  const resolved = resolveImageUrl(url, size, quality);
  return resolved ? { uri: resolved } : undefined;
}
