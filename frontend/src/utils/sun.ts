import SunCalc from 'suncalc';
import tzlookup from 'tz-lookup';

/**
 * Returns a compact "Golden 6:47 PM–7:14 PM" label for a spot's lat/lng for
 * today in the SPOT'S local timezone (not the viewer's). This is the
 * map-product-correct behaviour: a photographer in NYC planning a shoot
 * at Enchanted Rock, TX should see Central Time golden hour, not Eastern.
 *
 * Implementation:
 *   1. Look up IANA timezone from lat/lng via `tz-lookup` (offline, ~45KB).
 *   2. Compute SunCalc times (returns UTC Date objects).
 *   3. Format via Intl.DateTimeFormat({ timeZone }) so SSR/Expo-Web
 *      (which runs in UTC) still produces correct local times.
 *
 * Returns null if the spot has no coords, or if the sun never rises/sets at
 * this latitude on this date (polar regions).
 *
 * FIX(Commit 8a / 2026-04): previously used toLocaleTimeString(undefined,…)
 * which renders in the runtime TZ. Container TZ=UTC leaked as "12:35 AM"
 * for Enchanted Rock's evening golden hour when viewed via Expo Web.
 */
export function goldenHourLabel(lat?: number, lng?: number, now: Date = new Date()): string | null {
  if (lat == null || lng == null) return null;
  try {
    // Resolve IANA zone (e.g. "America/Chicago") for the spot. Falls back to
    // UTC if the lookup throws (e.g. lat/lng out of bounds).
    let zone: string | undefined;
    try {
      zone = tzlookup(lat, lng);
    } catch {
      zone = undefined;
    }

    const fmt = (d: Date) => {
      try {
        return new Intl.DateTimeFormat(undefined, {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: zone,
        }).format(d);
      } catch {
        // Super defensive: fall back to device-local formatting.
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      }
    };

    const t = SunCalc.getTimes(now, lat, lng);
    // `goldenHour` in suncalc is the moment evening golden hour starts
    // (sun at +6°). `goldenHourEnd` is the morning golden hour end.
    const eveningStart = t.goldenHour;
    const eveningEnd = t.sunsetStart || t.sunset;
    const morningStart = t.sunriseEnd || t.sunrise;
    const morningEnd = t.goldenHourEnd;

    // If evening window is still in the future today, prefer it.
    if (eveningStart && eveningEnd && now < eveningEnd) {
      return `Golden ${fmt(eveningStart)}–${fmt(eveningEnd)}`;
    }
    // Otherwise, if morning window still in future today (rare after noon),
    // show it; else show tomorrow's evening.
    if (morningStart && morningEnd && now < morningEnd) {
      return `Golden ${fmt(morningStart)}–${fmt(morningEnd)}`;
    }
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const t2 = SunCalc.getTimes(tomorrow, lat, lng);
    if (t2.goldenHour && t2.sunset) {
      return `Tomorrow ${fmt(t2.goldenHour)}–${fmt(t2.sunset)}`;
    }
    return null;
  } catch {
    return null;
  }
}
