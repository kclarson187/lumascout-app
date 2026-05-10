/**
 * drive-time.ts — distance-based drive-time estimator.
 *
 * Why
 * ───
 * LumaScout doesn't yet integrate a routing API (Mapbox Directions /
 * Google Directions / OSRM). For the Explore preview we still want
 * to give the user an INSTANT, photographer-useful estimate so they
 * can decide "is it worth going now?" without leaving the app.
 *
 * Approach
 * ────────
 * Take great-circle (Haversine) distance between user and spot, then
 * apply a road-curvature factor (1.3×) to approximate real driving
 * miles, divided by an average mixed-road speed of 35 mph. Output is
 * deliberately labelled "Approx." so users know it isn't a routed
 * estimate. A real routing call should slot in when we add Directions
 * API support — keep the same return shape so callers don't change.
 *
 * Returns
 * ───────
 *   • "Approx. 24 min drive"      ← normal case
 *   • "Approx. 1h 12m drive"      ← long drives
 *   • "< 1 min"                   ← user is at the spot
 *   • null                        ← coords missing/invalid →
 *                                   caller should show
 *                                   "Drive time unavailable"
 */

const ROAD_FACTOR = 1.3;       // straight-line → driving miles
const AVG_SPEED_MPH = 35;       // mixed urban + highway average

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // earth radius, miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export type DriveTimeEstimate = {
  /** Display string ready to render, e.g. "Approx. 24 min drive". */
  label: string;
  /** Estimated minutes — useful if a caller wants to cap by threshold. */
  minutes: number;
  /** Always true here — flag so future routing-API integrations can
   *  set this `false` when they have a real routed value. */
  approximate: boolean;
};

/** Returns a drive-time estimate or `null` when coords are missing. */
export function driveTimeEstimate(
  user: { latitude?: number | null; longitude?: number | null } | null | undefined,
  spot: { latitude?: number | null; longitude?: number | null } | null | undefined,
): DriveTimeEstimate | null {
  const ulat = user?.latitude;
  const ulng = user?.longitude;
  const slat = spot?.latitude;
  const slng = spot?.longitude;

  if (
    ulat == null || ulng == null || slat == null || slng == null ||
    !Number.isFinite(ulat) || !Number.isFinite(ulng) ||
    !Number.isFinite(slat) || !Number.isFinite(slng)
  ) {
    return null;
  }
  if (Math.abs(ulat as number) > 90 || Math.abs(slat as number) > 90) return null;
  if (Math.abs(ulng as number) > 180 || Math.abs(slng as number) > 180) return null;

  const miles = haversineMiles(ulat as number, ulng as number, slat as number, slng as number);
  const drivingMiles = miles * ROAD_FACTOR;
  const minutesRaw = (drivingMiles / AVG_SPEED_MPH) * 60;
  const minutes = Math.max(0, Math.round(minutesRaw));

  let label: string;
  if (minutes < 1) {
    label = '< 1 min away';
  } else if (minutes < 60) {
    label = `Approx. ${minutes} min drive`;
  } else {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    label = `Approx. ${m === 0 ? `${h}h` : `${h}h ${m}m`} drive`;
  }
  return { label, minutes, approximate: true };
}
