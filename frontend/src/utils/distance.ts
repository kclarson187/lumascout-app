/**
 * distance.ts — single source of truth for rendering spot distance.
 *
 * FIX(2026-04 / Item #3): Backend now returns `distance_source` and may
 * return `distance_km`/`distance_mi` as null when the user has no GPS
 * permission. UI must NEVER fabricate a value — show 'Distance
 * unavailable' instead. This helper centralises the formatting so we
 * don't have inconsistent renderings across Home / Explore / Map cards.
 */
export type SpotLike = {
  distance_mi?: number | null;
  distance_miles?: number | null;
  distance_km?: number | null;
  distance_source?: string | null;
};

export function formatDistance(spot: SpotLike, opts?: { compact?: boolean }): string | null {
  const mi =
    typeof spot.distance_mi === 'number' ? spot.distance_mi
      : typeof spot.distance_miles === 'number' ? spot.distance_miles
        : typeof spot.distance_km === 'number' ? spot.distance_km * 0.621371
          : null;
  if (mi == null || !isFinite(mi)) return null;
  if (opts?.compact) {
    if (mi < 0.1) return '<0.1 mi';
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
  }
  return `${mi.toFixed(1)} mi`;
}

export function distanceLabel(spot: SpotLike): string {
  const v = formatDistance(spot, { compact: true });
  if (v) return v;
  // Backend says GPS was unavailable
  if (spot.distance_source === 'unavailable') return 'Distance unavailable';
  return '';
}

export function hasDistance(spot: SpotLike): boolean {
  return formatDistance(spot) !== null;
}
