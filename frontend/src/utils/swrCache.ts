/**
 * Tiny stale-while-revalidate cache layer backed by AsyncStorage.
 *
 * Why: the Home feed was blocking first paint for ~8s behind a cold network
 * fetch. With SWR caching we can render instantly from the previous session's
 * cached payload and *then* silently refresh in the background — the user
 * never stares at a skeleton again after the first visit.
 *
 *   const { data, refresh } = useSWRAsync('feed:home', () => api.get('/feed/home'));
 *
 * Contract:
 *   • First render: returns the last cached value synchronously-ish (via
 *     a fast AsyncStorage read in a microtask) if available.
 *   • A network refresh always runs in the background.
 *   • When network resolves, data updates and cache is written.
 *   • Errors during refresh never wipe the cache — stale data stays on
 *     screen so the app keeps working offline / on slow networks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'swr::';

export async function readCache<T = any>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeCache<T = any>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore quota / corruption errors — cache is best-effort.
  }
}

export function useSWRAsync<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts?: { enabled?: boolean; keyDeps?: ReadonlyArray<any> },
): {
  data: T | undefined;
  loading: boolean;       // true only when NO cached data AND network in flight
  refreshing: boolean;    // true whenever network is in flight
  refresh: () => Promise<void>;
  error: unknown;
} {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const enabled = opts?.enabled !== false;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setRefreshing(true);
    try {
      const fresh = await fetcher();
      if (!mounted.current) return;
      setData(fresh);
      writeCache(key, fresh).catch(() => {});
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      if (mounted.current) {
        setRefreshing(false);
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, ...(opts?.keyDeps || [])]);

  // Hydrate from cache then kick off background refresh.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readCache<T>(key);
      if (alive && cached !== null) {
        setData(cached);
        setLoading(false);
      }
      refresh();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...(opts?.keyDeps || [])]);

  return { data, loading, refreshing, refresh, error };
}
