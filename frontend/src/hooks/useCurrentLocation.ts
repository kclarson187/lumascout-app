/**
 * useCurrentLocation — centralized GPS hook for LumaScout.
 *
 * June 2025 change-request: "Nearby" across Explore / Home / Network
 * must come from live GPS, not cached / default / hard-coded coords.
 * All screens now consume this hook so there is ONE source of truth
 * for the user's latitude & longitude, ONE permission prompt flow,
 * and ONE retry path when the user denies or the OS times out.
 *
 * Shape returned:
 *   coords          — {latitude, longitude} | null
 *   status          — 'idle' | 'requesting' | 'granted' | 'denied' | 'error'
 *   permissionDenied — convenience boolean (status === 'denied')
 *   loading         — true while the first fix is in flight
 *   error           — null | 'permission_denied' | 'timeout' | 'nan' | ...
 *   retry()         — re-runs the permission + single-fix pipeline
 *   lastUpdatedAt   — epoch ms of last successful fix
 *
 * Implementation notes:
 *   · Respects battery: uses Accuracy.Balanced (≈100m city-block level),
 *     with a 5s Promise.race timeout so a hung GPS handle never wedges
 *     the UI. If the high-accuracy race times out we fall through to a
 *     second Balanced attempt.
 *   · Watches for movement via Location.watchPositionAsync with sensible
 *     throttling (timeInterval 30s, distanceInterval 250m) so distance
 *     chips refresh when the user actually moves, without draining the
 *     battery while stationary.
 *   · Cleans up the subscription on unmount.
 *   · NEVER silently returns stale coords — if the user denies, coords
 *     stay null and the caller can render the denial state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

export type LatLng = { latitude: number; longitude: number };
export type LocationStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'error';

export type UseCurrentLocationResult = {
  coords: LatLng | null;
  status: LocationStatus;
  permissionDenied: boolean;
  loading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  retry: () => Promise<void>;
};

type Options = {
  /** Enable live movement tracking via watchPositionAsync. Default true. */
  watch?: boolean;
  /** watchPositionAsync cadence (ms). Default 30000. */
  timeInterval?: number;
  /** watchPositionAsync distance threshold (m). Default 250. */
  distanceInterval?: number;
};

export function useCurrentLocation(
  opts: Options = {},
): UseCurrentLocationResult {
  const { watch = true, timeInterval = 30000, distanceInterval = 250 } = opts;

  const [coords, setCoords] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  const applyFix = useCallback((pos: Location.LocationObject) => {
    const lat = pos?.coords?.latitude;
    const lng = pos?.coords?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    // Reject clearly bogus fixes (some jail-broken iOS devices inject
    // NaN via mock-location tooling).
    if (Math.abs(lat as number) > 90 || Math.abs(lng as number) > 180) return;
    if (!mountedRef.current) return;
    setCoords({ latitude: lat as number, longitude: lng as number });
    setLastUpdatedAt(Date.now());
  }, []);

  const startWatch = useCallback(async () => {
    if (!watch) return;
    // Clean up any previous subscription before starting a new one.
    try { watchRef.current?.remove(); } catch {}
    watchRef.current = null;
    try {
      // web: expo-location's watchPositionAsync works but polyfills via
      // `navigator.geolocation.watchPosition`, which on some browsers
      // only fires on explicit movement. That's the behaviour we want.
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval,
          distanceInterval,
        },
        (pos) => applyFix(pos),
      );
      if (!mountedRef.current) {
        try { sub.remove(); } catch {}
        return;
      }
      watchRef.current = sub;
    } catch {
      // Non-fatal — we still have the one-shot coords from getCurrentPosition.
    }
  }, [watch, timeInterval, distanceInterval, applyFix]);

  const retry = useCallback(async () => {
    if (!mountedRef.current) return;
    setStatus('requesting');
    setLoading(true);
    setError(null);
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (perm.status !== 'granted') {
        if (mountedRef.current) {
          setStatus('denied');
          setError('permission_denied');
          setLoading(false);
        }
        return;
      }

      // 5s race on a high-accuracy fix, with balanced-accuracy fallback
      // if the high-accuracy handle hangs.
      const fix = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Platform.OS === 'web' ? Location.Accuracy.Balanced : Location.Accuracy.High,
        }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('timeout')), 5000),
        ),
      ]).catch(async () => {
        return await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      });

      if (!mountedRef.current) return;
      const lat = fix?.coords?.latitude;
      const lng = fix?.coords?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('nan');
      }
      applyFix(fix);
      setStatus('granted');
      setLoading(false);

      // Kick off the live watcher after the first successful fix.
      startWatch();
    } catch (e: any) {
      if (mountedRef.current) {
        setStatus('error');
        setError(e?.message || 'gps_failed');
        setLoading(false);
      }
    }
  }, [applyFix, startWatch]);

  useEffect(() => {
    mountedRef.current = true;
    retry();
    return () => {
      mountedRef.current = false;
      try { watchRef.current?.remove(); } catch {}
      watchRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    coords,
    status,
    permissionDenied: status === 'denied',
    loading,
    error,
    lastUpdatedAt,
    retry,
  };
}

export default useCurrentLocation;
