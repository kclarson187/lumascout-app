/**
 * cached-coords.ts — last-known-good GPS persistence (June 2025).
 *
 * Why: the Home tab's golden-hour line should feel alive even on a
 * cold start before `expo-location` has resolved a fresh fix, and
 * also when the user is fully offline. We persist the most recent
 * confirmed coords (with a timestamp) so the home screen can render
 * a meaningful countdown immediately on launch and keep working in
 * airplane mode.
 *
 * Stale coords > 14 days old are NOT returned — at that age the
 * sunrise/sunset times may be off by minutes due to seasonal sun
 * arc shifts, and the user has likely traveled far enough that
 * "where you were last fortnight" isn't a useful astronomy hint.
 *
 * Public API:
 *   getCachedCoords(): Promise<CachedCoords | null>
 *   setCachedCoords({ latitude, longitude }): Promise<void>
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@lumascout/last_known_coords';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;  // 14 days

export type CachedCoords = {
  latitude: number;
  longitude: number;
  /** epoch ms */
  capturedAt: number;
};

export async function getCachedCoords(): Promise<CachedCoords | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCoords;
    if (
      !parsed ||
      typeof parsed.latitude !== 'number' ||
      typeof parsed.longitude !== 'number' ||
      typeof parsed.capturedAt !== 'number'
    ) {
      return null;
    }
    if (Math.abs(parsed.latitude) > 90 || Math.abs(parsed.longitude) > 180) return null;
    if (Date.now() - parsed.capturedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedCoords(c: { latitude: number; longitude: number }): Promise<void> {
  try {
    if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
    if (Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180) return;
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        latitude: c.latitude,
        longitude: c.longitude,
        capturedAt: Date.now(),
      }),
    );
  } catch {
    // Non-fatal — the cache is purely a UX nicety.
  }
}
