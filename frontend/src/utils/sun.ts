import SunCalc from 'suncalc';

/**
 * Returns a compact "Golden hour 6:47 PM" label for a spot's lat/lng for
 * today in the device's local timezone. Null if the spot has no coords or the
 * sun never rises/sets at this latitude on this date (polar regions).
 *
 * Uses the `suncalc` package — pure math, no network. The label prefers the
 * evening golden hour (most photographer work); falls back to morning if the
 * day's evening window is already past.
 */
export function goldenHourLabel(lat?: number, lng?: number, now: Date = new Date()): string | null {
  if (lat == null || lng == null) return null;
  try {
    const t = SunCalc.getTimes(now, lat, lng);
    // `goldenHour` in suncalc is the moment evening golden hour starts
    // (sun at +6°). `goldenHourEnd` is the morning golden hour end.
    const eveningStart = t.goldenHour;
    const eveningEnd = t.sunsetStart || t.sunset;
    const morningStart = t.sunriseEnd || t.sunrise;
    const morningEnd = t.goldenHourEnd;

    const fmt = (d: Date) =>
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    // If evening window is still in the future today, prefer it.
    if (eveningStart && now < eveningEnd) {
      return `Golden ${fmt(eveningStart)}–${fmt(eveningEnd)}`;
    }
    // Otherwise, if morning window still in future today (rare after noon),
    // show it; else show tomorrow's evening.
    if (morningStart && now < morningEnd) {
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
