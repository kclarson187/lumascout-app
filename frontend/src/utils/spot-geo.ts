/**
 * Spot geometry & tier helpers (Apr 2026 — Explore-tab hardening pass).
 *
 * Why this module exists
 * ----------------------
 * The Explore-tab map crashed intermittently. Investigation showed:
 *
 *  (1) `spots.map(s => s.latitude != null && s.longitude != null && <Marker />)`
 *      returned `false` for invalid items. `react-native-map-clustering`
 *      iterates children expecting valid React elements and runs
 *      Supercluster on their props — a `false` child blows up
 *      Supercluster's coordinate parser on iOS with a native crash.
 *
 *  (2) `latitude != null && longitude != null` accepts NaN, strings,
 *      `0/0` (which is in the Atlantic, also a backend default), and
 *      out-of-range values. Any of those crash MapKit.
 *
 *  (3) `pinTierOf(spot)` reads four nested fields with optional
 *      chaining — safe by itself, but if one day a spot ships with an
 *      unexpected shape (e.g., `owner` is a string, `images` is null)
 *      the comparison still throws.
 *
 *  (4) ~500+ markers on a single map blew device memory on iOS — we now
 *      cap the renderable set at 300 (the rest are still fetchable via
 *      "Search this area" pan + reload, just not all at once).
 *
 * These helpers centralise the validation so every caller agrees on
 * what "renderable" means, and a single bad payload never bubbles to a
 * native crash.
 */
import { pinTierOf, type PinTier } from '../components/PremiumMapPin';

/** Hard cap on simultaneously-rendered markers. Anything beyond is dropped
 *  (with a console.warn) to prevent the iOS OOM scenario. */
export const MAX_RENDERABLE_MARKERS = 300;

/** True iff `lat`/`lng` are real, finite, in valid bounds, and not 0,0. */
export function isValidCoord(lat: unknown, lng: unknown): lat is number {
  // Reject anything that's not exactly a number — a string "30.27" passes
  // `lat != null` but explodes inside MapKit's coordinate validator.
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  // Reject the dreaded null-island (0,0) — used by some backends as a
  // sentinel for "no location set". Rendering a pin at (0,0) is never
  // useful and makes the cluster engine think the world average is the
  // Atlantic Ocean.
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}

/**
 * Coerce a value that *might* be a stringly-typed coordinate (e.g.,
 * "30.27") into a real number, returning NaN on any failure so the
 * caller's `isValidCoord` check catches it.
 */
export function coerceCoord(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/**
 * Wrap pinTierOf in a hard try/catch so a malformed spot can never
 * crash the marker tree. Returns 'default' on any failure — visually
 * identical to the gold base pin.
 */
export function safeTier(spot: any): PinTier {
  try {
    const t = pinTierOf(spot);
    return t || 'default';
  } catch {
    return 'default';
  }
}

/**
 * Structured telemetry breadcrumb for the Explore surface.
 *
 * Falls back to console.warn (level=warn) / console.debug (level=debug)
 * with a stable `[explore]` prefix so engineering can grep production
 * logs even before the Sentry SDK is wired. All payloads are JSON
 * stringified to avoid accidentally serialising React component instances.
 *
 * No-op safe in production: every call is wrapped so a missing console
 * (some bundlers strip it) can never crash the app.
 */
export function exploreLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  payload?: Record<string, any>,
) {
  try {
    // eslint-disable-next-line no-console
    const c: any = console;
    const fn = c?.[level] || c?.log;
    if (!fn) return;
    fn.call(c, `[explore] ${event}`, payload || {});
    // Forward to Sentry if present (no-op when not wired)
    const w = globalThis as any;
    if (level === 'warn' || level === 'error') {
      if (w?.Sentry?.addBreadcrumb) {
        w.Sentry.addBreadcrumb({
          category: 'explore',
          message: event,
          level: level === 'error' ? 'error' : 'warning',
          data: payload || {},
        });
      }
    }
  } catch {
    /* no-op */
  }
}

type DropReason =
  | 'missing_lat'
  | 'missing_lng'
  | 'nan_coord'
  | 'out_of_range'
  | 'zero_zero'
  | 'duplicate_id'
  | 'missing_id'
  | 'not_object'
  | 'over_cap';

/**
 * Filter, de-dupe, sort, and cap a spots array down to the set that's
 * safe to render on the map. Returns the dropped count (with reasons
 * for telemetry) so the Explore screen can log how many spots were
 * discarded and why.
 *
 *   const { renderable, droppedInvalid, droppedDuplicate, droppedOverCap }
 *     = normalizeSpotsForMap(spots);
 *
 * Each renderable spot is guaranteed to have:
 *   · a unique `spot_id`
 *   · numeric `latitude`/`longitude` that pass `isValidCoord`
 *
 * The output is **stably sorted by `spot_id`** so React doesn't reshuffle
 * marker keys across renders (which on Android would trigger a full
 * re-layout of every pin).
 */
export function normalizeSpotsForMap(spots: unknown[]): {
  renderable: any[];
  droppedInvalid: number;
  droppedDuplicate: number;
  droppedOverCap: number;
  reasons: Record<DropReason, number>;
} {
  const reasons: Record<DropReason, number> = {
    missing_lat: 0,
    missing_lng: 0,
    nan_coord: 0,
    out_of_range: 0,
    zero_zero: 0,
    duplicate_id: 0,
    missing_id: 0,
    not_object: 0,
    over_cap: 0,
  };
  if (!Array.isArray(spots)) {
    return {
      renderable: [],
      droppedInvalid: 0,
      droppedDuplicate: 0,
      droppedOverCap: 0,
      reasons,
    };
  }
  const seen = new Set<string>();
  const out: any[] = [];
  let droppedInvalid = 0;
  let droppedDuplicate = 0;
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    if (!s || typeof s !== 'object') {
      reasons.not_object++;
      droppedInvalid++;
      exploreLog('debug', 'drop_spot', { idx: i, reason: 'not_object' });
      continue;
    }
    const sp = s as any;
    const rawLat = sp.latitude;
    const rawLng = sp.longitude;
    if (rawLat == null) {
      reasons.missing_lat++;
      droppedInvalid++;
      exploreLog('debug', 'drop_spot', {
        spot_id: sp.spot_id ?? sp.id ?? null,
        idx: i,
        reason: 'missing_lat',
      });
      continue;
    }
    if (rawLng == null) {
      reasons.missing_lng++;
      droppedInvalid++;
      exploreLog('debug', 'drop_spot', {
        spot_id: sp.spot_id ?? sp.id ?? null,
        idx: i,
        reason: 'missing_lng',
      });
      continue;
    }
    const lat = coerceCoord(rawLat);
    const lng = coerceCoord(rawLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      reasons.nan_coord++;
      droppedInvalid++;
      exploreLog('debug', 'drop_spot', {
        spot_id: sp.spot_id ?? sp.id ?? null,
        idx: i,
        reason: 'nan_coord',
      });
      continue;
    }
    if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) {
      reasons.zero_zero++;
      droppedInvalid++;
      exploreLog('debug', 'drop_spot', {
        spot_id: sp.spot_id ?? sp.id ?? null,
        idx: i,
        reason: 'zero_zero',
      });
      continue;
    }
    if (!isValidCoord(lat, lng)) {
      reasons.out_of_range++;
      droppedInvalid++;
      exploreLog('debug', 'drop_spot', {
        spot_id: sp.spot_id ?? sp.id ?? null,
        idx: i,
        reason: 'out_of_range',
        lat,
        lng,
      });
      continue;
    }
    const id = String(sp.spot_id || sp.id || '').trim();
    if (!id) {
      reasons.missing_id++;
      droppedInvalid++;
      exploreLog('debug', 'drop_spot', { idx: i, reason: 'missing_id' });
      continue;
    }
    if (seen.has(id)) {
      reasons.duplicate_id++;
      droppedDuplicate++;
      exploreLog('debug', 'drop_spot', { spot_id: id, idx: i, reason: 'duplicate_id' });
      continue;
    }
    seen.add(id);
    // Persist the coerced numeric coords back onto the object so
    // downstream `coordinate={{ latitude, longitude }}` reads a real
    // number even if the API ever ships strings.
    out.push({ ...sp, latitude: lat, longitude: lng });
  }

  // Stable sort by spot_id so React keys don't reshuffle across renders.
  out.sort((a, b) => {
    const ai = String(a.spot_id || a.id || '');
    const bi = String(b.spot_id || b.id || '');
    if (ai < bi) return -1;
    if (ai > bi) return 1;
    return 0;
  });

  // Cap at MAX_RENDERABLE_MARKERS to avoid iOS OOM with huge result sets.
  let droppedOverCap = 0;
  let renderable = out;
  if (out.length > MAX_RENDERABLE_MARKERS) {
    droppedOverCap = out.length - MAX_RENDERABLE_MARKERS;
    reasons.over_cap = droppedOverCap;
    renderable = out.slice(0, MAX_RENDERABLE_MARKERS);
    exploreLog('warn', 'over_cap', {
      total: out.length,
      cap: MAX_RENDERABLE_MARKERS,
      dropped: droppedOverCap,
    });
  }

  return { renderable, droppedInvalid, droppedDuplicate, droppedOverCap, reasons };
}
