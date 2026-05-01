/**
 * useGps — LEGACY thin wrapper over `useCurrentLocation` (June 2025).
 *
 * Retained so older call sites (Home tab, etc) keep working without a
 * sweeping refactor. Internally we now delegate to the richer
 * `useCurrentLocation` hook which handles:
 *   · single permission prompt flow
 *   · 5s race + balanced-accuracy fallback
 *   · live `watchPositionAsync` subscription so distances update when
 *     the user actually moves (throttled: 30s / 250m)
 *   · retry() path for the denied state
 *
 * Signature preserved: `{ coords, loading, error }` where
 * `coords = { latitude, longitude } | null`. New call sites should
 * prefer `useCurrentLocation` directly to get the full state machine +
 * retry(). NEW CALLERS: import from `./useCurrentLocation`.
 */
import { useCurrentLocation } from './useCurrentLocation';

export type Coords = { latitude: number; longitude: number } | null;

export function useGps(): { coords: Coords; loading: boolean; error: string | null } {
  const { coords, loading, error } = useCurrentLocation();
  return { coords, loading, error };
}

export default useGps;
