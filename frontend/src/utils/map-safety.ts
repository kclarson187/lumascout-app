/**
 * map-safety.ts — Single source of truth for map stability primitives.
 *
 * Born out of the Nov-2026 Explore tab stability hardening pass. ALL
 * marker producers in the app must validate coordinates through
 * `isValidCoordinate` BEFORE handing them to `<Marker>`. No coercion,
 * no fallbacks — bad rows are dropped on the floor and (in dev only)
 * counted once per fetch.
 *
 * Exports:
 *   - isValidCoordinate(lat, lng)  → strict typed boolean
 *   - FALLBACK_REGION              → San Antonio, TX (LumaScout HQ)
 *   - MAX_MARKERS                  → safety cap before rendering
 *   - pickNearest(items, center)   → distance-sort + slice for the cap
 *   - clampRegion(region)          → safe deltas (no zero/Inf/NaN)
 *   - logSkippedOnce(...)          → dev-only one-shot console.warn
 */

/**
 * Strict coordinate validator.
 *
 *   • Both inputs must be of type 'number' (no string coercion!)
 *   • Both must be Number.isFinite (rejects NaN, +Inf, -Inf)
 *   • Lat in [-90, 90]
 *   • Lng in [-180, 180]
 *
 * Returns a typed boolean so callers can narrow nullable values cleanly.
 */
export function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

/**
 * Last-resort default viewport — used when user location is denied,
 * undetermined, or the spot dataset is empty. San Antonio, TX
 * (LumaScout HQ) at a city-region zoom level.
 */
export const FALLBACK_REGION = Object.freeze({
  latitude: 29.4241,
  longitude: -98.4936,
  latitudeDelta: 0.35,
  longitudeDelta: 0.35,
});

/**
 * Hard cap on the number of native <Marker> instances mounted at once.
 *
 * 100 is a deliberately conservative number — react-native-maps
 * regressions have repeatedly involved hundreds of markers swamping
 * the bridge / Fabric mount queue. Combined parks + spots count against
 * this cap (not separate budgets).
 */
export const MAX_MARKERS = 100;

/**
 * In-dev one-shot warn for "we dropped N invalid spots this fetch".
 * Use a module-level WeakMap keyed by an arbitrary marker so the
 * message fires at most once per fetch cycle. Pass a `key` (e.g. the
 * fetch URL) to scope the dedupe.
 */
const _warned = new Set<string>();
export function logSkippedOnce(key: string, dropped: number, total: number) {
  if (!__DEV__) return;
  if (dropped <= 0) return;
  if (_warned.has(key)) return;
  _warned.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[map-safety] dropped ${dropped}/${total} markers with invalid coordinates ` +
    `(key=${key}). isValidCoordinate is strict — check API response shape.`,
  );
  // Tiny GC: don't let the dedupe set grow unbounded.
  if (_warned.size > 64) _warned.clear();
}

/**
 * Haversine distance in km between two coordinate pairs.
 * Inlined so map-safety stays import-graph-light.
 */
function haversineKm(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a1 = (lat1 * Math.PI) / 180;
  const a2 = (lat2 * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/**
 * Distance-sort + slice helper. Returns at most `cap` items, sorted
 * by proximity to `center`. Items missing valid coords are filtered
 * out — caller does NOT need to pre-validate.
 *
 * Usage:
 *   const visible = pickNearest(spots, center ?? FALLBACK_REGION, MAX_MARKERS);
 */
export function pickNearest<T extends { latitude: any; longitude: any }>(
  items: T[],
  center: { latitude: number; longitude: number },
  cap: number = MAX_MARKERS,
): T[] {
  const valid: Array<{ item: T; d: number }> = [];
  for (const it of items) {
    if (!isValidCoordinate(it.latitude, it.longitude)) continue;
    const d = haversineKm(center.latitude, center.longitude, it.latitude as number, it.longitude as number);
    valid.push({ item: it, d });
  }
  valid.sort((a, b) => a.d - b.d);
  return valid.slice(0, cap).map((v) => v.item);
}

/** Minimum acceptable region delta — prevents zero / negative which
 *  has historically crashed native map engines on iOS gesture interrupts. */
const MIN_DELTA = 0.0005;

export type SafeRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/** Clamp a region to known-safe ranges. Defensive — assumes the
 *  caller already verified it is shaped right. */
export function clampRegion(r: SafeRegion): SafeRegion {
  return {
    latitude: Math.max(-90, Math.min(90, r.latitude)),
    longitude: Math.max(-180, Math.min(180, r.longitude)),
    latitudeDelta: Math.max(MIN_DELTA, Math.min(180, r.latitudeDelta)),
    longitudeDelta: Math.max(MIN_DELTA, Math.min(360, r.longitudeDelta)),
  };
}

/** True if every field on `r` is a finite number in the legal range. */
export function isValidRegion(r: any): r is SafeRegion {
  if (!r) return false;
  for (const k of ['latitude', 'longitude', 'latitudeDelta', 'longitudeDelta']) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  if (r.latitude < -90 || r.latitude > 90) return false;
  if (r.longitude < -180 || r.longitude > 180) return false;
  if (r.latitudeDelta <= 0 || r.longitudeDelta <= 0) return false;
  return true;
}
