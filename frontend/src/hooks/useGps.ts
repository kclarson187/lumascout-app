import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export type Coords = { latitude: number; longitude: number } | null;

/**
 * One-shot GPS hook. Asks the user for foreground location permission once,
 * returns coords or null. Silent on denial — the caller is expected to
 * gracefully fall back to the user's profile city or Austin default.
 */
export function useGps(): { coords: Coords; loading: boolean; error: string | null } {
  const [coords, setCoords] = useState<Coords>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (mounted) { setError('permission_denied'); setLoading(false); }
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (mounted) {
          setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          setLoading(false);
        }
      } catch (e: any) {
        if (mounted) { setError(e?.message || 'gps_failed'); setLoading(false); }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return { coords, loading, error };
}
