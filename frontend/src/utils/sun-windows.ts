/**
 * sun-windows.ts — short, photographer-friendly countdown labels for
 * golden / blue / sunrise / sunset, computed at the spot's coordinates.
 *
 * Why this exists
 * ───────────────
 * The Home tab uses a longer, screen-real-estate-friendly FSM. Cards
 * and map previews need a SHORTER label that fits in one ~30 char line.
 * Examples:
 *   • "Golden hour in 42 min"
 *   • "Golden hour ending in 18 min"
 *   • "Golden hour now"
 *   • "Sunset in 1h 12m"
 *   • "Blue hour in 1h 8m"
 *   • "Blue hour now"
 *   • "Blue hour ended"
 *
 * Performance
 * ───────────
 * SunCalc.getTimes() costs ~30µs per call but Explore lists render 25+
 * cards. We memoise per (lat, lng, minute-bucket) so a full list of 25
 * cards on the same minute = 25 cache hits, not 25 SunCalc passes.
 * The cache resets every minute (when the bucket key changes) which is
 * the natural cadence of the countdown anyway.
 */

const minuteBucket = (now: Date) => Math.floor(now.getTime() / 60_000);

type SunTimes = {
  dawn?: Date; sunrise?: Date; sunriseEnd?: Date;
  goldenHour?: Date; goldenHourEnd?: Date;
  sunset?: Date; sunsetStart?: Date; dusk?: Date;
};

const tCache = new Map<string, SunTimes>();
const tCacheKey = (lat: number, lng: number, bucket: number, dayOffset = 0) =>
  `${lat.toFixed(3)}|${lng.toFixed(3)}|${bucket}|${dayOffset}`;

function getTimesCached(lat: number, lng: number, now: Date, dayOffset = 0): SunTimes | null {
  try {
    const bucket = minuteBucket(now);
    const key = tCacheKey(lat, lng, bucket, dayOffset);
    const hit = tCache.get(key);
    if (hit) return hit;
    // Bound cache; clear half when it gets large enough to matter.
    if (tCache.size > 256) {
      let i = 0;
      for (const k of tCache.keys()) {
        if (i++ > 128) break;
        tCache.delete(k);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SunCalc = require('suncalc');
    const ref = dayOffset
      ? new Date(now.getTime() + dayOffset * 24 * 3600 * 1000)
      : now;
    const t = SunCalc.getTimes(ref, lat, lng) as SunTimes;
    tCache.set(key, t);
    return t;
  } catch {
    return null;
  }
}

const valid = (...ds: (Date | undefined)[]) =>
  ds.every((d) => d && !Number.isNaN(d.getTime()));

const fmtMins = (ms: number): string => {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

/**
 * Brief card-style label for the next golden/sunrise/sunset moment
 * for the given lat/lng. Returns null when SunCalc cannot resolve
 * events (e.g. polar regions near solstice) — caller should fall
 * back to a "Golden hour unavailable" string.
 */
export function goldenHourBrief(
  lat: number,
  lng: number,
  now: Date = new Date(),
): string | null {
  const t = getTimesCached(lat, lng, now);
  if (!t) return null;

  const sunrise = t.sunriseEnd || t.sunrise;
  const morningEnd = t.goldenHourEnd;
  const eveningStart = t.goldenHour;
  const sunset = t.sunsetStart || t.sunset;

  // Pre-dawn — surface the upcoming sunrise.
  if (valid(sunrise) && now < (sunrise as Date)) {
    return `Sunrise in ${fmtMins((sunrise as Date).getTime() - now.getTime())}`;
  }
  // Morning golden hour active.
  if (valid(sunrise, morningEnd) && now >= (sunrise as Date) && now < (morningEnd as Date)) {
    return `Golden hour now`;
  }
  // Daytime, before evening golden.
  if (valid(eveningStart) && now < (eveningStart as Date)) {
    return `Golden hour in ${fmtMins((eveningStart as Date).getTime() - now.getTime())}`;
  }
  // Evening golden active.
  if (valid(eveningStart, sunset) && now >= (eveningStart as Date) && now < (sunset as Date)) {
    const ms = (sunset as Date).getTime() - now.getTime();
    if (ms <= 15 * 60_000) return `Sunset in ${fmtMins(ms)}`;
    return `Golden hour ending in ${fmtMins(ms)}`;
  }
  // Past sunset — fall through to NEXT day's sunrise.
  const tn = getTimesCached(lat, lng, now, 1);
  const nextSr = tn?.sunriseEnd || tn?.sunrise;
  if (valid(nextSr) && now < (nextSr as Date)) {
    return `Sunrise in ${fmtMins((nextSr as Date).getTime() - now.getTime())}`;
  }
  return null;
}

/**
 * Brief card-style label for the spot's blue hour relative to NOW.
 * Blue hour is the period between civil dusk/dawn and sunrise/sunset
 * — bracketing the golden hour with the cooler-light moments.
 *
 * For UI purposes:
 *   • Evening blue hour = sunset → civil dusk
 *   • Morning blue hour = civil dawn → sunrise
 *
 * Examples:
 *   • "Blue hour in 1h 8m"   (later today)
 *   • "Blue hour now"
 *   • "Blue hour ended"      (within the last 30 min)
 *   • "Blue hour in 7h"      (next morning)
 */
export function blueHourBrief(
  lat: number,
  lng: number,
  now: Date = new Date(),
): string | null {
  const t = getTimesCached(lat, lng, now);
  if (!t) return null;

  const dawn = t.dawn;
  const sunrise = t.sunriseEnd || t.sunrise;
  const sunset = t.sunsetStart || t.sunset;
  const dusk = t.dusk;

  // 1. Currently in MORNING blue hour (dawn → sunrise)?
  if (valid(dawn, sunrise) && now >= (dawn as Date) && now < (sunrise as Date)) {
    return `Blue hour now`;
  }
  // 2. Currently in EVENING blue hour (sunset → civil dusk)?
  if (valid(sunset, dusk) && now >= (sunset as Date) && now < (dusk as Date)) {
    return `Blue hour now`;
  }
  // 3. Just ended (within 30 min after dusk)?
  if (valid(dusk) && now >= (dusk as Date) &&
      now.getTime() - (dusk as Date).getTime() <= 30 * 60_000) {
    return `Blue hour ended`;
  }
  // 4. Coming up later today — evening blue hour (sunset).
  if (valid(sunset) && now < (sunset as Date)) {
    return `Blue hour in ${fmtMins((sunset as Date).getTime() - now.getTime())}`;
  }
  // 5. Past tonight's blue hour — surface tomorrow's morning blue hour.
  const tn = getTimesCached(lat, lng, now, 1);
  const nextDawn = tn?.dawn;
  if (valid(nextDawn) && now < (nextDawn as Date)) {
    return `Blue hour in ${fmtMins((nextDawn as Date).getTime() - now.getTime())}`;
  }
  return null;
}

/** Test seam — clears the memo cache. Not used by app code; exposed
 *  for unit tests so they can mock the clock without stale entries. */
export function _resetSunCache() { tCache.clear(); }

// ============================================================================
// Structured planning helpers — June 2025 Location Detail card fix.
// ────────────────────────────────────────────────────────────────────────────
// goldenHourBrief / blueHourBrief above return a single human string. The
// new field-guide card on the Spot Detail page needs TWO things rendered
// on separate lines:
//
//   • countdown   — always "in Xh Ym" (never "Sunrise…", never "Sunset…",
//                   never localised copy that truncates on small phones)
//   • windowLabel — the actual time window of the upcoming event,
//                   e.g. "7:44 PM – 8:17 PM"
//
// goldenHourPlanning + blueHourPlanning surface that as a structured tuple
// so the card never has to parse strings or guess which sub-event we're
// counting down to. Returns null when SunCalc cannot resolve events
// (polar regions near solstice, or coords missing).
// ============================================================================

export type SunPlanning = {
  /** Always "in Xh Ym" / "in Xm". */
  countdown: string;
  /** "7:44 PM – 8:17 PM" — the upcoming event window. */
  windowLabel: string;
  /** True when the user is currently INSIDE the named event window. */
  active: boolean;
};

const fmtClock = (d: Date) =>
  d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const fmtCountdown = (ms: number): string => {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins === 0) return 'now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
};

/**
 * Returns the NEXT relevant golden-hour window for the given lat/lng:
 *  • if we're before evening golden hour today → evening golden window
 *  • if we're inside it → same window, active=true, countdown to its end
 *  • if it's already past tonight's evening golden → tomorrow's morning
 *    golden window (sunrise → goldenHourEnd)
 *  • inside morning golden → active=true, countdown to its end
 *
 * The returned window is always the FULL event window (not just remaining),
 * so the UI can render "7:44 PM – 8:17 PM" consistently.
 */
export function goldenHourPlanning(
  lat: number,
  lng: number,
  now: Date = new Date(),
): SunPlanning | null {
  const today = getTimesCached(lat, lng, now);
  if (!today) return null;
  const tomorrow = getTimesCached(lat, lng, now, 1);

  type Win = { start: Date; end: Date; label: 'evening' | 'morning' };
  const wins: Win[] = [];
  if (today.goldenHour && (today.sunsetStart || today.sunset)) {
    wins.push({ start: today.goldenHour, end: today.sunsetStart || today.sunset!, label: 'evening' });
  }
  if (today.sunrise && today.goldenHourEnd) {
    wins.push({ start: today.sunriseEnd || today.sunrise, end: today.goldenHourEnd, label: 'morning' });
  }
  if (tomorrow?.sunrise && tomorrow.goldenHourEnd) {
    wins.push({ start: tomorrow.sunriseEnd || tomorrow.sunrise, end: tomorrow.goldenHourEnd, label: 'morning' });
  }
  if (tomorrow?.goldenHour && (tomorrow.sunsetStart || tomorrow.sunset)) {
    wins.push({ start: tomorrow.goldenHour, end: tomorrow.sunsetStart || tomorrow.sunset!, label: 'evening' });
  }

  // Filter out anything where SunCalc returned NaN dates (polar regions).
  const usable = wins.filter((w) => !Number.isNaN(w.start.getTime()) && !Number.isNaN(w.end.getTime()));
  if (usable.length === 0) return null;

  // 1) Are we currently INSIDE one of the windows?
  const inside = usable.find((w) => now >= w.start && now < w.end);
  if (inside) {
    return {
      countdown: fmtCountdown(inside.end.getTime() - now.getTime()),
      windowLabel: `${fmtClock(inside.start)} – ${fmtClock(inside.end)}`,
      active: true,
    };
  }
  // 2) Otherwise pick the soonest upcoming window.
  const upcoming = usable
    .filter((w) => w.start.getTime() > now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  if (!upcoming) return null;
  return {
    countdown: fmtCountdown(upcoming.start.getTime() - now.getTime()),
    windowLabel: `${fmtClock(upcoming.start)} – ${fmtClock(upcoming.end)}`,
    active: false,
  };
}

/**
 * Same shape, for blue-hour windows (evening sunset→dusk, morning dawn→sunrise).
 */
export function blueHourPlanning(
  lat: number,
  lng: number,
  now: Date = new Date(),
): SunPlanning | null {
  const today = getTimesCached(lat, lng, now);
  if (!today) return null;
  const tomorrow = getTimesCached(lat, lng, now, 1);

  type Win = { start: Date; end: Date; label: 'evening' | 'morning' };
  const wins: Win[] = [];
  if (today.sunset && today.dusk) {
    wins.push({ start: today.sunsetStart || today.sunset, end: today.dusk, label: 'evening' });
  }
  if (today.dawn && today.sunrise) {
    wins.push({ start: today.dawn, end: today.sunriseEnd || today.sunrise, label: 'morning' });
  }
  if (tomorrow?.dawn && tomorrow.sunrise) {
    wins.push({ start: tomorrow.dawn, end: tomorrow.sunriseEnd || tomorrow.sunrise, label: 'morning' });
  }
  if (tomorrow?.sunset && tomorrow.dusk) {
    wins.push({ start: tomorrow.sunsetStart || tomorrow.sunset, end: tomorrow.dusk, label: 'evening' });
  }

  const usable = wins.filter((w) => !Number.isNaN(w.start.getTime()) && !Number.isNaN(w.end.getTime()));
  if (usable.length === 0) return null;

  const inside = usable.find((w) => now >= w.start && now < w.end);
  if (inside) {
    return {
      countdown: fmtCountdown(inside.end.getTime() - now.getTime()),
      windowLabel: `${fmtClock(inside.start)} – ${fmtClock(inside.end)}`,
      active: true,
    };
  }
  const upcoming = usable
    .filter((w) => w.start.getTime() > now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  if (!upcoming) return null;
  return {
    countdown: fmtCountdown(upcoming.start.getTime() - now.getTime()),
    windowLabel: `${fmtClock(upcoming.start)} – ${fmtClock(upcoming.end)}`,
    active: false,
  };
}
