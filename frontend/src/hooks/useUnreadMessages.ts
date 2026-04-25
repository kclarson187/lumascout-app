/**
 * useUnreadMessages — polls GET /api/dm/unread-count every 30s so multiple
 * UI surfaces (tab bar red dot, home avatar red dot, home bell badge)
 * share one store.
 *
 * Kept intentionally tiny — a React state + interval. No context, no
 * zustand, no extra dep. The poll is cheap on the backend (two
 * count_documents queries) and the delta is exposed to consumers as
 * plain numbers.
 *
 * Tier 1 Messaging Upgrade (2026-04).
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '../api';
import { useAuth } from '../auth';

export type UnreadCount = {
  unread_messages: number;
  unread_threads: number;
  pending_requests: number;
  total: number;
};

const EMPTY: UnreadCount = { unread_messages: 0, unread_threads: 0, pending_requests: 0, total: 0 };

export function useUnreadMessages(pollMs: number = 60000) {
  const { user } = useAuth();
  const [count, setCount] = useState<UnreadCount>(EMPTY);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api.get('/dm/unread-count');
      setCount({
        unread_messages: r.unread_messages || 0,
        unread_threads: r.unread_threads || 0,
        pending_requests: r.pending_requests || 0,
        total: r.total || 0,
      });
    } catch {
      // silent — badge just stays stale. Not worth toasting.
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setCount(EMPTY);
      return;
    }
    // Defer first poll 800ms so the home shell paints without waiting on this.
    const kickoff = setTimeout(refresh, 800);
    const iv = setInterval(refresh, pollMs);
    // Also refresh when app comes back to foreground (user read DMs elsewhere).
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(kickoff);
      clearInterval(iv);
      sub.remove();
    };
  }, [user, pollMs, refresh]);

  return { ...count, refresh };
}
