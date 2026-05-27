/**
 * Light-window helpers — picks the next photographic light window
 * (golden hour OR blue hour) and returns the countdown to it.
 *
 * Blue hour windows we recognise (suncalc nomenclature):
 *   • morning blue : nauticalDawn  →  sunrise         (sun -12° → 0°)
 *   • evening blue : sunset        →  nauticalDusk    (sun  0°  → -12°)
 *
 * Golden hour windows:
 *   • morning gold : sunrise       →  goldenHourEnd   (sun 0° → +6°)
 *   • evening gold : goldenHour    →  sunset          (sun +6° → 0°)
 *
 * The "next" window is whichever upcoming start is soonest. If a
 * window is currently active, we report it with `isActive: true` and
 * `minsUntil = 0` so callers can render "Now" / "Active" instead of a
 * countdown.
 *
 * Designed to be cheap to call per second (the home screen ticks the
 * countdown every second). No allocation in the hot path beyond what
 * suncalc itself does.
 */
import SunCalc from 'suncalc';

export type LightWindow = 'golden' | 'blue';

export interface NextLightWindow {
  type: LightWindow;
  // When the window starts. If `isActive` is true, this is the
  // window's start (already past).
  startsAt: Date;
  // When the window ends — useful so the UI can switch to "ending in".
  endsAt: Date;
  // Whole minutes until startsAt. 0 when active.
  minsUntil: number;
  isActive: boolean;
}

interface Coords {
  latitude: number;
  longitude: number;
}

/** Compute the next light window for the given coords + reference time.
 * Returns null when suncalc can't produce times (polar latitudes etc).
 */
export function nextLightWindow(
  coords: Coords | null | undefined,
  now: Date = new Date(),
): NextLightWindow | null {
  if (!coords || !isFiniteNum(coords.latitude) || !isFiniteNum(coords.longitude)) {
    return null;
  }
  const t = safeTimes(coords, now);
  const tomorrow = safeTimes(coords, new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (!t || !tomorrow) return null;

  // Build all candidate windows for today + tomorrow morning. We use
  // tomorrow's morning windows so the late-evening UX still shows the
  // countdown to morning blue/golden rather than a dead state.
  const windows: NextLightWindow[] = compact([
    win('blue',   t.nauticalDawn,    t.sunrise),         // today morning blue
    win('golden', t.sunrise,         t.goldenHourEnd),   // today morning golden
    win('golden', t.goldenHour,      t.sunset),          // today evening golden
    win('blue',   t.sunset,          t.nauticalDusk),    // today evening blue
    win('blue',   tomorrow.nauticalDawn, tomorrow.sunrise),
    win('golden', tomorrow.sunrise,  tomorrow.goldenHourEnd),
  ]);

  // First, an active window — those win.
  for (const w of windows) {
    if (now >= w.startsAt && now < w.endsAt) {
      return { ...w, minsUntil: 0, isActive: true };
    }
  }

  // Otherwise, the soonest upcoming start.
  const upcoming = windows
    .filter(w => w.startsAt > now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  if (!upcoming.length) return null;

  const w = upcoming[0];
  const minsUntil = Math.max(0, Math.floor((w.startsAt.getTime() - now.getTime()) / 60000));
  return { ...w, minsUntil, isActive: false };
}

/** "01:42" / "00:58". For >24h returns "—" so the UI can fall back to
 * its "Best light soon" copy.
 */
export function formatCountdownHHMM(minsUntil: number | null | undefined): string {
  if (minsUntil == null || !Number.isFinite(minsUntil) || minsUntil < 0) return '—';
  if (minsUntil > 24 * 60) return '—';
  const h = Math.floor(minsUntil / 60);
  const m = minsUntil % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** "Golden hour" / "Blue hour" label for a window type. */
export function labelForWindow(type: LightWindow): string {
  return type === 'golden' ? 'Golden hour' : 'Blue hour';
}

/** Header copy for the hero countdown. Examples:
 *   "Golden hour in"  /  "Blue hour in"
 *   "Golden hour now" when active
 */
export function headerForWindow(w: NextLightWindow | null): string {
  if (!w) return 'Best light soon';
  if (w.isActive) return `${labelForWindow(w.type)} now`;
  return `${labelForWindow(w.type)} in`;
}

// ───────────────────────────── internals ─────────────────────────────

function win(type: LightWindow, startsAt?: Date, endsAt?: Date): NextLightWindow | null {
  if (!startsAt || !endsAt) return null;
  if (!(startsAt instanceof Date) || !(endsAt instanceof Date)) return null;
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  if (endsAt <= startsAt) return null;
  return { type, startsAt, endsAt, minsUntil: 0, isActive: false };
}

function safeTimes(coords: Coords, when: Date): ReturnType<typeof SunCalc.getTimes> | null {
  try {
    return SunCalc.getTimes(when, coords.latitude, coords.longitude);
  } catch {
    return null;
  }
}

function compact<T>(arr: (T | null | undefined)[]): T[] {
  return arr.filter((x): x is T => !!x);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}
