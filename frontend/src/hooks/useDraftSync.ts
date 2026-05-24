/**
 * useDraftSync — Phase 6 sync engine for offline child-spot drafts.
 *
 * Responsibilities:
 *   • On mount, on app foreground, and on NetInfo reachability flip
 *     to "online", drain queued drafts via POST /api/spots.
 *   • Reports live counts via setCount callback so screens can show
 *     a "N pending" pill.
 *   • Manual `syncNow()` is exposed for "Retry" buttons.
 *   • Skips drafts that have already failed N times (default 6) so a
 *     permanently-bad payload (e.g. invalid coords) doesn't burn CPU
 *     forever — those stay queued for the user to clear/edit manually.
 *   • Bumps the active park session on each successful park-child
 *     upload (keeps "Continue adding spots to <park>?" working when
 *     the user catches up offline).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { api, formatApiError } from '../api';
import {
  listDrafts, deleteDraft, markAttemptFailed, countDrafts,
} from '../utils/park-drafts';

const MAX_ATTEMPTS = 6;

export type DraftSyncResult = {
  uploaded: number;
  failed: number;
  remaining: number;
};

export function useDraftSync() {
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const inFlight = useRef(false);

  const refreshCount = useCallback(async () => {
    setCount(await countDrafts());
  }, []);

  const syncNow = useCallback(async (): Promise<DraftSyncResult> => {
    if (inFlight.current) {
      return { uploaded: 0, failed: 0, remaining: await countDrafts() };
    }
    inFlight.current = true;
    setSyncing(true);
    let uploaded = 0, failed = 0;
    try {
      const drafts = await listDrafts();
      for (const d of drafts) {
        if ((d.attempts || 0) >= MAX_ATTEMPTS) {
          failed += 1;
          continue;
        }
        try {
          const created = await api.post('/spots', d.payload);
          await deleteDraft(d.local_id);
          uploaded += 1;
          // If this was a park child, refresh the 24h session so the
          // "Continue adding spots to X?" banner stays valid on the
          // next Add Spot mount.
          if (d.park_group_id) {
            try {
              await api.post('/me/park-session', {
                park_id: d.park_group_id,
                last_added_spot_id: created?.spot_id || null,
              });
            } catch {}
          }
        } catch (e: any) {
          await markAttemptFailed(d.local_id, formatApiError(e) || 'sync failed');
          failed += 1;
        }
      }
    } finally {
      inFlight.current = false;
      setSyncing(false);
      await refreshCount();
    }
    return { uploaded, failed, remaining: await countDrafts() };
  }, [refreshCount]);

  // Refresh count on mount
  useEffect(() => { refreshCount(); }, [refreshCount]);

  // Auto-sync on app foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        // Best-effort: don't block the UI.
        syncNow().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [syncNow]);

  // Auto-sync when connectivity flips back to reachable.
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        syncNow().catch(() => {});
      }
    });
    return () => unsub();
  }, [syncNow]);

  return { count, syncing, syncNow, refreshCount };
}
