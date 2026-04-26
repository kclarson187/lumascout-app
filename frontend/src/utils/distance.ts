/**
 * distance.ts — central distance formatter for LumaScout.
 *
 * APRIL 2026 — locked-in display rules per product spec (URGENT distance
 * fix, Item #3). Backend always sends mileage via `distance_mi`; we
 * fall back to `distance_miles` (legacy) and finally km×0.621371. When
 * the backend returns null AND `distance_source === 'unavailable'`, we
 * surface "Distance unavailable" instead of silently dropping.
 *
 * Display rules:
 *   <  1 mi   → 1 decimal      (e.g. "0.8 mi")
 *   1–99 mi   → 1 decimal      (e.g. "78.4 mi", "12.3 mi")
 *   100–249   → whole number   (e.g. "131 mi")
 *   ≥ 250 mi  → state name when available (e.g. "TX") else "260 mi"
 */
export type SpotLike = {
  distance_mi?: number | null;
  distance_miles?: number | null;
  distance_km?: number | null;
  distance_source?: string | null;
  state?: string | null;
};

function pickMiles(spot: SpotLike): number | null {
  if (typeof spot.distance_mi === 'number' && isFinite(spot.distance_mi)) return spot.distance_mi;
  if (typeof spot.distance_miles === 'number' && isFinite(spot.distance_miles)) return spot.distance_miles;
  if (typeof spot.distance_km === 'number' && isFinite(spot.distance_km)) return spot.distance_km * 0.621371;
  return null;
}

/**
 * Numeric-only formatter (string or null). Use when the caller will
 * decide whether to fall back to "Distance unavailable" or hide the
 * chip entirely.
 */
export function formatDistance(spot: SpotLike): string | null {
  const mi = pickMiles(spot);
  if (mi == null) return null;
  if (mi < 1) return `${mi.toFixed(1)} mi`;
  if (mi < 100) return `${mi.toFixed(1)} mi`;
  if (mi < 250) return `${Math.round(mi)} mi`;
  // >= 250 — prefer the state code if we have one, else show whole-mile
  if (spot.state && typeof spot.state === 'string' && spot.state.trim()) {
    return spot.state.trim();
  }
  return `${Math.round(mi)} mi`;
}

/**
 * Full-trust label — always returns SOMETHING. Use when we want to
 * explicitly tell the user GPS is off rather than hide silently.
 */
export function distanceLabel(spot: SpotLike): string {
  const v = formatDistance(spot);
  if (v) return v;
  if (spot.distance_source === 'unavailable') return 'Distance unavailable';
  return '';
}

export function hasDistance(spot: SpotLike): boolean {
  return pickMiles(spot) !== null;
}
