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
 * These helpers centralise the validation so every caller agrees on
 * what "renderable" means, and a single bad payload never bubbles to a
 * native crash.
 */
import { pinTierOf, type PinTier } from '../components/PremiumMapPin';

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
 * Filter and de-dupe a spots array down to the set that's safe to
 * render on the map. Returns the dropped count for telemetry so the
 * Explore screen can log how many spots were discarded.
 *
 *   const { renderable, droppedInvalid, droppedDuplicate } =
 *     normalizeSpotsForMap(spots);
 *
 * Each renderable spot is guaranteed to have:
 *   · a unique `spot_id`
 *   · numeric `latitude`/`longitude` that pass `isValidCoord`
 */
export function normalizeSpotsForMap(spots: unknown[]): {
  renderable: any[];
  droppedInvalid: number;
  droppedDuplicate: number;
} {
  if (!Array.isArray(spots)) {
    return { renderable: [], droppedInvalid: 0, droppedDuplicate: 0 };
  }
  const seen = new Set<string>();
  const out: any[] = [];
  let droppedInvalid = 0;
  let droppedDuplicate = 0;
  for (const s of spots) {
    if (!s || typeof s !== 'object') {
      droppedInvalid++;
      continue;
    }
    const sp = s as any;
    const lat = coerceCoord(sp.latitude);
    const lng = coerceCoord(sp.longitude);
    if (!isValidCoord(lat, lng)) {
      droppedInvalid++;
      continue;
    }
    const id = String(sp.spot_id || sp.id || '').trim();
    if (!id) {
      droppedInvalid++;
      continue;
    }
    if (seen.has(id)) {
      droppedDuplicate++;
      continue;
    }
    seen.add(id);
    // Persist the coerced numeric coords back onto the object so
    // downstream `coordinate={{ latitude, longitude }}` reads a real
    // number even if the API ever ships strings.
    out.push({ ...sp, latitude: lat, longitude: lng });
  }
  return { renderable: out, droppedInvalid, droppedDuplicate };
}
