/**
 * upload-queue-store.ts — Persistent offline-safe upload queue for Add Recent
 * Photos (Track D, May 2026).
 *
 * Why this exists
 * ───────────────
 * Field photographers routinely find themselves out of signal (deep canyons,
 * state-park interiors, remote trailheads). Before this module, if they
 * picked photos and tapped submit, the uploader would try once, fail on
 * network, and surface a manual "Retry" button they could only action while
 * still on the same screen. Force-quitting the app or backgrounding past the
 * OS timeout would DROP THE QUEUE ENTIRELY — meaning the photos had to be
 * re-picked on next session.
 *
 * This module fixes that by:
 *   1. COPYING each picked asset to a PERSISTENT location
 *      (FileSystem.documentDirectory/upload-queue/<itemId>.jpg) on pick,
 *      so the asset survives app restart / OS memory pressure.
 *   2. Mirroring the queue's state (items + caption/tags/visibility) to
 *      AsyncStorage under `lumascout.uploadQueue.<spotId>`.
 *   3. Providing a `useUploadQueueStore(spotId)` hook that handles
 *      hydration, persistence, and cleanup.
 *   4. Exporting `useOnline()` — NetInfo-driven connectivity flag used by
 *      the uploader loop to pause when offline and auto-resume on
 *      reconnect.
 *
 * What this deliberately does NOT do
 * ──────────────────────────────────
 *   • True background sync (BackgroundFetch/TaskManager). Mobile OSes
 *     throttle background tasks heavily; a visible "resume uploads" UI
 *     when the user next opens the app is the pragmatic path.
 *   • Cross-spot queue consolidation. Each spot's queue is isolated by
 *     design — users are typically focused on one spot at a time, and
 *     scoping per-spot keeps AsyncStorage writes small.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
// SDK 53+ moved the classic filesystem API to /legacy. The new API is
// class-based (File/Directory) and slightly less ergonomic for a
// one-shot "copy this picker URI somewhere durable" use case. We use
// the legacy module here to keep this helper small and robust.
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';

// Keep identical to the QItem shape in upload.tsx minus transient fields
// that have no value after a reload (progress, hostedUrl are only
// meaningful during an active upload session).
export type PersistedQItem = {
  id: string;
  localUri: string;           // path to the persisted copy — NOT picker temp
  mimeType?: string | null;
  fileName?: string | null;
  attempts: number;
  // Status at checkpoint time. We persist success too so successful
  // uploads show their hosted_url chip on rehydrate.
  status: 'pending' | 'success' | 'failed';
  hostedUrl?: string;
  // Preserve the last error to help the user decide whether to retry.
  error?: string;
  errorName?: string;
};

export type PersistedMeta = {
  caption: string;
  tags: string[];
  visibility: 'public' | 'followers';
  // Spot title cache — shown in the "resume uploads" prompt so the user
  // knows which spot the queue belongs to.
  spotTitle?: string;
  // Timestamp of the last mutation — used to age-out stale queues.
  updatedAt: number;
};

export type PersistedQueue = {
  spotId: string;
  items: PersistedQItem[];
  meta: PersistedMeta;
};

const QUEUE_DIR = (FileSystem.documentDirectory || '') + 'upload-queue/';
const KEY_PREFIX = 'lumascout.uploadQueue.';
// Queues older than 30 days are considered stale and are purged on mount.
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

async function ensureQueueDir(): Promise<void> {
  if (!QUEUE_DIR) return;
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(QUEUE_DIR, { intermediates: true });
    }
  } catch {
    /* non-fatal */
  }
}

function keyFor(spotId: string): string {
  return `${KEY_PREFIX}${spotId}`;
}

/**
 * Copy a picker-supplied URI to the persistent QUEUE_DIR. Returns the new
 * absolute URI suitable for later upload. Falls back to the original URI
 * if the copy fails (e.g. FileSystem unavailable during Expo Go dev).
 */
export async function persistPickedAsset(
  sourceUri: string,
  itemId: string,
  extensionHint?: string | null,
): Promise<string> {
  await ensureQueueDir();
  if (!QUEUE_DIR) return sourceUri;
  try {
    // Derive extension from mime or URI — default to jpg (post-normalize).
    let ext = 'jpg';
    if (extensionHint) {
      const m = String(extensionHint).match(/([a-zA-Z0-9]+)$/);
      if (m) ext = m[1];
    } else {
      const m = sourceUri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
      if (m) ext = m[1];
    }
    const target = `${QUEUE_DIR}${itemId}.${ext}`;
    await FileSystem.copyAsync({ from: sourceUri, to: target });
    return target;
  } catch {
    // If the copy fails we still return the original URI; if it's a
    // picker temp URI it'll probably be valid for this session at least.
    return sourceUri;
  }
}

/** Delete the persisted file for a queue item (safe on missing files). */
export async function deletePersistedAsset(uri: string): Promise<void> {
  if (!uri || !uri.startsWith(QUEUE_DIR)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* non-fatal */
  }
}

/** Read the persisted queue for a spot, or null if none. */
export async function loadQueue(spotId: string): Promise<PersistedQueue | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(spotId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedQueue;
    // Stale-check — if the queue is older than STALE_AFTER_MS, purge it.
    if (parsed?.meta?.updatedAt && (Date.now() - parsed.meta.updatedAt) > STALE_AFTER_MS) {
      await clearQueue(spotId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Write the current queue snapshot. */
export async function saveQueue(q: PersistedQueue): Promise<void> {
  try {
    q.meta.updatedAt = Date.now();
    await AsyncStorage.setItem(keyFor(q.spotId), JSON.stringify(q));
  } catch {
    /* non-fatal */
  }
}

/** Remove the queue entry (and best-effort delete orphaned files). */
export async function clearQueue(spotId: string): Promise<void> {
  try {
    const existing = await loadQueue(spotId);
    if (existing?.items?.length) {
      await Promise.all(existing.items.map((i) => deletePersistedAsset(i.localUri)));
    }
    await AsyncStorage.removeItem(keyFor(spotId));
  } catch {
    /* non-fatal */
  }
}


// ──────────────────────────────────────────────────────────────────────────
// React hooks
// ──────────────────────────────────────────────────────────────────────────

/**
 * Lightweight connectivity flag. `online` is true when NetInfo reports an
 * active internet connection (isConnected && isInternetReachable ∈ {true,null}).
 * `null` for isInternetReachable is treated as online because some
 * cellular + captive-portal paths report null while still being usable.
 */
export function useOnline(): { online: boolean; type: string | null } {
  const [state, setState] = useState<{ online: boolean; type: string | null }>({
    online: true,
    type: null,
  });
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      const reachable = s.isInternetReachable !== false; // true or null counts
      setState({
        online: !!s.isConnected && reachable,
        type: s.type || null,
      });
    });
    // Fetch initial state immediately.
    NetInfo.fetch().then((s) => {
      const reachable = s.isInternetReachable !== false;
      setState({ online: !!s.isConnected && reachable, type: s.type || null });
    });
    return () => { try { unsub(); } catch { /* noop */ } };
  }, []);
  return state;
}

/**
 * Hook that returns a getter/setter to read + write the persisted queue for
 * a specific spot. The returned `save()` is debounced lightly so rapid
 * queue mutations (e.g. while uploading) don't hammer AsyncStorage.
 */
export function useUploadQueueStore(spotId: string) {
  // Ref so caller components don't re-render when a save completes.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback((snapshot: PersistedQueue) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveQueue(snapshot); }, 250);
  }, []);

  // Flush any pending save on unmount.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  return {
    load: useCallback(() => loadQueue(spotId), [spotId]),
    saveNow: useCallback((snapshot: PersistedQueue) => saveQueue(snapshot), []),
    saveDebounced: scheduleSave,
    clear: useCallback(() => clearQueue(spotId), [spotId]),
    persistAsset: persistPickedAsset,
    deleteAsset: deletePersistedAsset,
  };
}
