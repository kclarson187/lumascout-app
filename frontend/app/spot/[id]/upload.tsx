/**
 * Add Recent Photos — queue-based upload flow (Track B rebuild, May 2026).
 *
 * Why this was rebuilt (PRD):
 *   • Users were seeing "server snag" errors that were actually client-side
 *     network drops during parallel (concurrency=3) fetch uploads. Backend
 *     stress test (27/27) proved /api/uploads/image is rock-solid.
 *   • The old UX collapsed all selected photos into a single "Uploading…"
 *     tile with no per-photo progress, no individual retry, and no way to
 *     reorder or remove once the picker closed.
 *
 * New UX:
 *   • Max 5 photos per submission (tighter cap → better finish rate).
 *   • Sequential upload — one at a time — with a real progress bar via
 *     XMLHttpRequest upload events.
 *   • Per-photo states: queued → uploading → success | failed.
 *   • Auto-retry once on transient failure (Network/Timeout/Server/RateLimit)
 *     before surfacing a manual Retry button.
 *   • Remove or reorder photos while they're still queued (pending).
 *   • Cancel an in-flight upload (AbortController wired into XHR).
 *   • Global progress line: "Uploading photo 2 of 5…".
 *
 * Design principles:
 *   • Queue cards use LumaScout's surface1/border tokens, 72×72 thumbs,
 *     status chip on the right, retry button inline on failure.
 *   • All interactive elements respect the 44×44 minimum touch target.
 *   • Reanimated Layout + FadeIn/FadeOut for subtle status transitions
 *     (entering queue, success chip fade, removal).
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput, Alert, ActivityIndicator, Pressable, Platform, DeviceEventEmitter } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ImagePlus, X, Camera, RotateCw, Check, AlertCircle, ChevronUp, ChevronDown, Clock, WifiOff } from 'lucide-react-native';
import Animated, { FadeIn, FadeOut, Layout } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../../src/api';
import { uploadImageAssetWithProgress, UploadedImage } from '../../../src/utils/upload-image';
import { normalizePickedImages } from '../../../src/utils/normalize-image';
import {
  useOnline,
  useUploadQueueStore,
  persistPickedAsset,
  deletePersistedAsset,
  PersistedQueue,
} from '../../../src/utils/upload-queue-store';
import { colors, font, space, radii } from '../../../src/theme';
import { CONDITION_TAGS } from '../../../src/components/FreshnessBits';
import KeyboardSafe from '../../../src/components/KeyboardSafe';

const MAX_PHOTOS = 5;
// Auto-retry once before showing manual retry — covers transient network
// blips on cellular / flakey wifi without making the user tap anything.
const AUTO_RETRY_LIMIT = 1;
// Only categorize these as "transient" and auto-retry them. Payload / format
// / auth errors are permanent and need user intervention.
const TRANSIENT_ERRORS = new Set(['NetworkError', 'TimeoutError', 'ServerError', 'RateLimitError']);

type QStatus = 'pending' | 'uploading' | 'success' | 'failed';
type QItem = {
  id: string;
  localUri: string;
  mimeType?: string | null;
  fileName?: string | null;
  status: QStatus;
  progress: number; // 0..1 — only meaningful while uploading
  hostedUrl?: string;
  // May 2026: R2 storage key echoed back alongside hostedUrl so we
  // can persist it with the spot_community_uploads row.
  storageKey?: string | null;
  error?: string;
  errorName?: string;
  attempts: number; // how many upload attempts we've made so far
};

function newId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function UploadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const spotId = String(id || '');

  const [queue, setQueue] = useState<QItem[]>([]);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'public' | 'followers'>('public');
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rehydrating, setRehydrating] = useState(true);

  // --- Persistence + connectivity (Track D, May 2026) -----------------------
  // Persist queue state so force-quit / background doesn't lose photos.
  // Pause uploader while offline; auto-resume the instant we reconnect.
  const store = useUploadQueueStore(spotId);
  const { online } = useOnline();
  const onlineRef = useRef(online);
  useEffect(() => { onlineRef.current = online; }, [online]);

  // --- Queue ref + uploader coordination -----------------------------------
  // Keep a ref in sync with queue so the async uploader loop can read the
  // latest state without re-capturing stale closures.
  const queueRef = useRef<QItem[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // The AbortController that governs the CURRENT in-flight upload. We
  // nullify it between items. Kept in a ref because setting state from
  // inside the uploader loop would fight our sequential guarantee.
  const activeAbortRef = useRef<AbortController | null>(null);
  // Prevents two uploader loops running at once.
  const uploaderRunningRef = useRef(false);
  // Set when the screen unmounts so in-flight continuations bail out.
  const unmountedRef = useRef(false);

  const updateItem = useCallback((id: string, patch: Partial<QItem>) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }, []);

  // --- Sequential uploader loop --------------------------------------------
  const runUploader = useCallback(async () => {
    if (uploaderRunningRef.current) return;
    uploaderRunningRef.current = true;
    try {
       
      while (true) {
        if (unmountedRef.current) break;
        // Track D: Pause the uploader loop while offline. The loop will
        // be re-kicked by the effect below the moment `online` flips
        // back to true.
        if (!onlineRef.current) break;
        const current = queueRef.current.find((q) => q.status === 'pending');
        if (!current) break;

        // Mark as uploading and reset progress.
        updateItem(current.id, { status: 'uploading', progress: 0, error: undefined, errorName: undefined });
        const controller = new AbortController();
        activeAbortRef.current = controller;
        const attemptNumber = current.attempts + 1;

        try {
          const result: UploadedImage = await uploadImageAssetWithProgress(
            { uri: current.localUri, mimeType: current.mimeType, fileName: current.fileName },
            {
              signal: controller.signal,
              onProgress: (p) => {
                if (unmountedRef.current) return;
                // Progress ticks can fire very fast — only write when the
                // value actually changes by a meaningful delta to reduce
                // re-renders on long uploads.
                setQueue((prev) => prev.map((q) =>
                  q.id === current.id && Math.abs((q.progress || 0) - p) >= 0.01
                    ? { ...q, progress: p }
                    : q,
                ));
              },
            },
          );
          if (unmountedRef.current) break;
          updateItem(current.id, {
            status: 'success',
            progress: 1,
            hostedUrl: result.image_url,
            storageKey: (result as any).storage_key || null,
            attempts: attemptNumber,
            error: undefined,
            errorName: undefined,
          });
        } catch (e: any) {
          if (unmountedRef.current) break;
          const errName = e?.name || 'UnknownError';
          if (errName === 'AbortError') {
            // User canceled (remove / unmount). Leave status as-is; if the
            // item still exists and wasn't removed, put it back to pending
            // so the user can retry from the tap.
            const stillThere = queueRef.current.find((q) => q.id === current.id);
            if (stillThere) {
              updateItem(current.id, { status: 'pending', progress: 0, attempts: attemptNumber });
            }
          } else if (TRANSIENT_ERRORS.has(errName) && attemptNumber <= AUTO_RETRY_LIMIT) {
            // Auto-retry: bump attempts, leave status as pending so the
            // while-loop picks this same item up next iteration.
            updateItem(current.id, {
              status: 'pending',
              progress: 0,
              attempts: attemptNumber,
              error: undefined,
              errorName: undefined,
            });
            // Small delay before the retry kicks in — feels intentional,
            // not jittery.
            await new Promise((r) => setTimeout(r, 650));
          } else {
            updateItem(current.id, {
              status: 'failed',
              progress: 0,
              attempts: attemptNumber,
              error: e?.message || "We couldn't upload this photo.",
              errorName: errName,
            });
          }
        } finally {
          activeAbortRef.current = null;
        }
      }
    } finally {
      uploaderRunningRef.current = false;
    }
  }, [updateItem]);

  // Kick off uploader whenever a pending item appears OR we reconnect
  // after being offline.
  useEffect(() => {
    const hasPending = queue.some((q) => q.status === 'pending');
    if (hasPending && online && !uploaderRunningRef.current) {
      runUploader();
    }
  }, [queue, online, runUploader]);

  // --- Persistence: rehydrate from AsyncStorage on mount -------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const persisted = await store.load();
        if (cancelled) return;
        if (!persisted || !persisted.items?.length) {
          return;
        }
        // Offer to resume only if there are any uploadable items. Items
        // that already successfully uploaded are kept so the user can
        // see their prior post before submitting.
        const resumable = persisted.items.some(
          (i) => i.status === 'pending' || i.status === 'failed',
        );
        const prompt = resumable
          ? `Resume your previous upload? ${persisted.items.length} photo${persisted.items.length === 1 ? '' : 's'} queued from your last visit to this spot.`
          : `You have ${persisted.items.length} already-uploaded photo${persisted.items.length === 1 ? '' : 's'} from a previous session — keep or discard?`;
        Alert.alert(
          'Previous upload found',
          prompt,
          [
            {
              text: 'Discard',
              style: 'destructive',
              onPress: async () => {
                await store.clear();
              },
            },
            {
              text: resumable ? 'Resume' : 'Keep',
              onPress: () => {
                if (cancelled) return;
                setCaption(persisted.meta?.caption || '');
                setTags(Array.isArray(persisted.meta?.tags) ? persisted.meta.tags : []);
                setVisibility(persisted.meta?.visibility || 'public');
                // Cast persisted items back into QItem shape — all
                // previously in-flight items reset to pending so the
                // uploader retries them now that we're presumably online.
                setQueue(persisted.items.map((i) => ({
                  id: i.id,
                  localUri: i.localUri,
                  mimeType: i.mimeType,
                  fileName: i.fileName,
                  status: i.status === 'success' ? 'success' : 'pending',
                  progress: i.status === 'success' ? 1 : 0,
                  hostedUrl: i.hostedUrl,
                  error: undefined,
                  errorName: undefined,
                  attempts: 0,
                })));
              },
            },
          ],
          { cancelable: false },
        );
      } finally {
        if (!cancelled) setRehydrating(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotId]);

  // --- Persistence: write queue+meta to AsyncStorage whenever they change --
  useEffect(() => {
    if (rehydrating) return; // don't overwrite stored data during hydrate
    // Skip writes when the queue is completely empty AND there's no text
    // state — nothing worth persisting.
    if (queue.length === 0 && !caption && tags.length === 0) {
      // Also proactively clean up any stale key.
      store.clear();
      return;
    }
    const snapshot: PersistedQueue = {
      spotId,
      items: queue.map((q) => ({
        id: q.id,
        localUri: q.localUri,
        mimeType: q.mimeType,
        fileName: q.fileName,
        attempts: q.attempts,
        // Never persist the transient `uploading` status — on rehydrate
        // it would be out of date anyway. Coerce back to pending.
        status: q.status === 'uploading' ? 'pending' : q.status,
        hostedUrl: q.hostedUrl,
        error: q.error,
        errorName: q.errorName,
      })),
      meta: { caption, tags, visibility, updatedAt: Date.now() },
    };
    store.saveDebounced(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, caption, tags, visibility, rehydrating]);

  // Cleanup on unmount — abort in-flight XHR so we don't set state on a
  // gone component.
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      try { activeAbortRef.current?.abort(); } catch {}
    };
  }, []);

  // --- Pickers -------------------------------------------------------------
  const remainingSlots = Math.max(0, MAX_PHOTOS - queue.length);

  const pickPhotos = async () => {
    if (remainingSlots === 0) return;
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo library access to share photos of this spot.');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: remainingSlots > 1,
        base64: false,
        quality: 0.85,
        selectionLimit: remainingSlots,
      });
      if (r.canceled || !r.assets?.length) return;
      // Track C (May 2026): normalize EXIF orientation client-side so
      // the local preview thumbnail matches what the server will save.
      // Backend still runs its own ImageOps.exif_transpose as a belt-
      // and-suspenders safety net — this step just makes sure the UI
      // never shows a sideways preview on Android / web / HEIC paths.
      const normalized = await normalizePickedImages(
        r.assets.slice(0, remainingSlots).map((a) => ({
          uri: a.uri,
          mimeType: a.mimeType,
          fileName: a.fileName,
          width: a.width,
          height: a.height,
        })),
      );
      const now = Date.now();
      // Track D: copy each picked asset to the persistent queue dir so
      // the file survives force-quit / OS memory pressure. The original
      // picker URI may be a temp ImagePicker cache file — not safe to
      // rely on past the current session.
      const toAdd: QItem[] = await Promise.all(
        normalized.map(async (a, idx) => {
          const itemId = `${newId()}_${idx}`;
          const persistedUri = await persistPickedAsset(a.uri, itemId, a.mimeType || 'jpg');
          return {
            id: itemId,
            localUri: persistedUri,
            mimeType: a.mimeType,
            fileName: a.fileName,
            status: 'pending' as QStatus,
            progress: 0,
            attempts: 0,
          };
        }),
      );
      setQueue((prev) => [...prev, ...toAdd].slice(0, MAX_PHOTOS));
      // Analytics-ish client log for ops grep.
      try {
         
        console.log('[spot-upload] queue_add', { count: toAdd.length, totalNow: queue.length + toAdd.length, ts: now });
      } catch {}
    } finally {
      setPicking(false);
    }
  };

  // --- Queue actions -------------------------------------------------------
  const removeItem = useCallback((id: string) => {
    // Capture localUri before removal so we can free the persisted file.
    const item = queueRef.current.find((q) => q.id === id);
    setQueue((prev) => prev.filter((q) => q.id !== id));
    // If the removed item is the one currently uploading, abort it so the
    // uploader loop can move on.
    if (item?.status === 'uploading') {
      try { activeAbortRef.current?.abort(); } catch {}
    }
    // Free the on-disk persisted copy so it doesn't leak across sessions.
    if (item?.localUri) {
      deletePersistedAsset(item.localUri).catch(() => {});
    }
  }, []);

  const retryItem = useCallback((id: string) => {
    setQueue((prev) => prev.map((q) =>
      q.id === id
        ? { ...q, status: 'pending', progress: 0, error: undefined, errorName: undefined, attempts: 0 }
        : q,
    ));
  }, []);

  const moveItem = useCallback((id: string, direction: -1 | 1) => {
    setQueue((prev) => {
      const idx = prev.findIndex((q) => q.id === id);
      if (idx < 0) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      // Only allow reordering when BOTH items are pending — avoid yanking
      // the in-flight uploader's cursor.
      if (prev[idx].status !== 'pending' || prev[target].status !== 'pending') return prev;
      const copy = prev.slice();
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  }, []);

  // --- Derived / guards ----------------------------------------------------
  const stats = useMemo(() => {
    const total = queue.length;
    const succeeded = queue.filter((q) => q.status === 'success').length;
    const failed = queue.filter((q) => q.status === 'failed').length;
    const inFlight = queue.filter((q) => q.status === 'uploading').length;
    const pending = queue.filter((q) => q.status === 'pending').length;
    // 1-based "photo N of M" where N counts all non-queued items.
    const processing = total > 0 ? total - pending : 0;
    return { total, succeeded, failed, inFlight, pending, processing };
  }, [queue]);

  const isQueueSettled = stats.inFlight === 0 && stats.pending === 0;
  const canSubmit = stats.succeeded > 0 && isQueueSettled && !submitting;

  const submitInflightRef = useRef<Promise<any> | null>(null);

  const submit = async () => {
    if (!canSubmit) return;
    if (submitInflightRef.current) {
      try { await submitInflightRef.current; } catch {}
      return;
    }
    const successful = queue.filter((q) => q.status === 'success' && q.hostedUrl);
    if (successful.length === 0) return;

    // If any failures remain, double-check with the user.
    if (stats.failed > 0) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          `Post ${successful.length} of ${queue.length}?`,
          `${stats.failed} photo${stats.failed === 1 ? '' : 's'} couldn't upload. You can post the successful ones now or retry the failed ones first.`,
          [
            { text: 'Retry failed', style: 'cancel', onPress: () => resolve(false) },
            { text: `Post ${successful.length}`, onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!confirmed) return;
    }

    setSubmitting(true);
    const promise = api.post(`/spots/${spotId}/uploads`, {
      images: successful.map((q) => ({
        image_url: q.hostedUrl!,
        // Forward R2 object key alongside the public URL so the
        // spot_community_uploads row can re-sign / rewrite later.
        storage_key: q.storageKey || null,
        caption: null,
      })),
      caption: caption.trim() || null,
      condition_tags: tags,
      visibility,
    }, { timeout: 25000 });
    submitInflightRef.current = promise;
    try {
      const res = await promise;
      try {
        // Invalidate ALL caches that could hold a stale version of this
        // spot's photos — so the Explore list, Saved list, Groups feeds,
        // and anywhere else that reads the `explore.list:v1` prefix
        // re-fetches with the fresh photo after the user returns.
        // Map markers are uncached (fetched on every map view load), so
        // the new thumb/cover appears the moment the user opens Map.
        const { invalidateCachePrefix } = await import('../../../src/utils/swrCache');
        await Promise.all([
          invalidateCachePrefix('explore.list:v1'),
          invalidateCachePrefix('saved:v1'),
          invalidateCachePrefix('groups:v1'),
          invalidateCachePrefix(`spot:${spotId}`),
        ]);
      } catch {}
      // ─── May 2026 — belt-and-suspenders refresh signal ──────────────
      // The SWR cache invalidation above handles the data layer, but
      // the spot-detail screen's hero image is rendered through
      // `expo-image`, which keeps its OWN url-keyed memory + disk
      // cache independent of SWR. If the backend rotated the cover
      // such that the URL changed but the new URL was previously
      // served (e.g. a re-promoted older photo), expo-image's cache
      // would return stale bytes and the user would see "no change"
      // until the app is force-quit. Emitting this event lets the
      // spot-detail screen drop its in-memory image cache AND force
      // a fresh `/api/spots/:id` fetch the moment the user returns,
      // without relying on useFocusEffect's microtask timing.
      try {
        DeviceEventEmitter.emit('spot:photos:posted', {
          spotId,
          autoApproved: !!res?.auto_approved,
        });
      } catch {
        /* fire-and-forget */
      }
      Alert.alert(
        res?.auto_approved ? 'Posted!' : 'Submitted for review',
        res?.message || 'Thanks for contributing — your photos help keep this spot alive.',
        [{ text: 'OK', onPress: async () => {
          // Track D: clear the persisted queue + delete disk copies now
          // that the post has succeeded. Fire-and-forget — the router
          // navigation is what the user cares about.
          store.clear().catch(() => {});
          router.back();
        } }]
      );
    } catch (e: any) {
      const status = Number(e?.response?.status || e?.status || 0);
      const isTimeout = e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '');
      let title = "Couldn't post photos";
      let body = e?.response?.data?.detail || e?.message || 'Please try again.';
      if (isTimeout) { title = 'Taking longer than usual'; body = 'Photo post timed out. Please try again.'; }
      else if (status === 401 || status === 403) { title = 'Session expired'; body = 'Please log in again to post photos.'; }
      else if (status === 404) { title = 'Spot no longer available'; body = "This location has been removed and can't accept new photos."; }
      else if (status === 410) { title = 'Spot deleted'; body = 'This location no longer exists.'; }
      else if (status === 413) { title = 'Too many or too large'; body = 'Try fewer photos or smaller images.'; }
      else if (status >= 500) { title = "Couldn't post photos"; body = 'Check your connection and try again.'; }
      try {
         
        console.warn('[spot-upload]', { status, name: e?.name, message: e?.message });
      } catch {}
      Alert.alert(title, body);
    } finally {
      submitInflightRef.current = null;
      setSubmitting(false);
    }
  };

  const toggleTag = (k: string) => {
    setTags((prev) => {
      if (prev.includes(k)) return prev.filter((t) => t !== k);
      if (prev.length >= 6) return prev;
      return [...prev, k];
    });
  };

  // Warn if user tries to leave while uploads are in-flight.
  // (Kept lightweight — Alert.alert on back press)
  const onBack = () => {
    if (stats.inFlight > 0 || stats.pending > 0) {
      Alert.alert(
        'Uploads in progress',
        'Photos are still uploading. If you leave now, unfinished uploads will be canceled.',
        [
          { text: 'Stay', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: () => {
            try { activeAbortRef.current?.abort(); } catch {}
            router.back();
          } },
        ],
      );
      return;
    }
    router.back();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} testID="upload-back" hitSlop={8}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Add Recent Photos</Text>
          <Text style={styles.title}>Keep this spot alive</Text>
        </View>
      </View>
      <KeyboardSafe style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xxxl + 80, paddingHorizontal: space.xl, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Queue header with global progress status */}
          <View style={{ gap: space.sm }}>
            <View style={styles.queueHeaderRow}>
              <Text style={styles.sectionTitle}>
                Photos <Text style={styles.req}>· up to {MAX_PHOTOS}</Text>
              </Text>
              <Text style={styles.countChip}>
                {queue.length}/{MAX_PHOTOS}
              </Text>
            </View>

            {!online ? (
              <Animated.View entering={FadeIn.duration(180)} style={styles.offlineBanner}>
                <WifiOff size={14} color={colors.secondary || '#ff9f40'} />
                <Text style={styles.offlineBannerText}>
                  You&apos;re offline — photos are safely queued and will upload the moment you reconnect.
                </Text>
              </Animated.View>
            ) : null}

            {stats.inFlight > 0 ? (
              <Animated.View entering={FadeIn.duration(180)} style={styles.globalStatus}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.globalStatusText}>
                  Uploading photo {Math.min(stats.processing, stats.total)} of {stats.total}…
                </Text>
              </Animated.View>
            ) : stats.pending > 0 ? (
              <Animated.View entering={FadeIn.duration(180)} style={styles.globalStatus}>
                <Clock size={14} color={colors.textSecondary} />
                <Text style={styles.globalStatusText}>
                  {stats.pending} photo{stats.pending === 1 ? '' : 's'} queued…
                </Text>
              </Animated.View>
            ) : null}

            {/* Queue cards */}
            {queue.map((item, idx) => (
              <QueueCard
                key={item.id}
                item={item}
                index={idx}
                total={queue.length}
                onRemove={() => removeItem(item.id)}
                onRetry={() => retryItem(item.id)}
                onMoveUp={() => moveItem(item.id, -1)}
                onMoveDown={() => moveItem(item.id, +1)}
              />
            ))}

            {queue.length < MAX_PHOTOS ? (
              <TouchableOpacity
                onPress={pickPhotos}
                disabled={picking}
                style={[styles.addBtn, picking && { opacity: 0.6 }]}
                testID="pick-photos"
                accessibilityLabel="Select photos"
              >
                {picking ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <>
                    <ImagePlus size={18} color={colors.primary} />
                    <Text style={styles.addBtnTxt}>
                      {queue.length === 0
                        ? 'Select photos'
                        : `Add photos (${remainingSlots} remaining)`}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.maxNotice}>
                <Text style={styles.maxNoticeText}>Maximum {MAX_PHOTOS} photos per post. Remove one to add another.</Text>
              </View>
            )}
          </View>

          {/* Caption */}
          <View style={{ gap: space.sm }}>
            <Text style={styles.sectionTitle}>Caption <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Bluebonnets still blooming today, light was soft at 7pm…"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={styles.captionInput}
              maxLength={500}
              testID="upload-caption"
            />
          </View>

          {/* Condition tags */}
          <View style={{ gap: space.sm }}>
            <Text style={styles.sectionTitle}>Conditions <Text style={styles.optional}>(tap up to 6)</Text></Text>
            <View style={styles.tagsGrid}>
              {CONDITION_TAGS.map((t) => {
                const selected = tags.includes(t.key);
                const Icon = t.Icon;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => toggleTag(t.key)}
                    style={[
                      styles.tagChip,
                      selected && { backgroundColor: t.color + '22', borderColor: t.color },
                    ]}
                    testID={`tag-${t.key}`}
                  >
                    <Icon size={13} color={selected ? t.color : colors.textSecondary} />
                    <Text style={[styles.tagChipTxt, selected && { color: t.color, fontFamily: font.bodySemibold }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Visibility */}
          <View style={{ gap: space.sm }}>
            <Text style={styles.sectionTitle}>Who can see this?</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => setVisibility('public')}
                style={[styles.visOpt, visibility === 'public' && styles.visOptActive]}
                testID="vis-public"
              >
                <Text style={[styles.visTitle, visibility === 'public' && { color: colors.primary }]}>🌎 Public</Text>
                <Text style={styles.visSub}>Shows on the spot for everyone.</Text>
              </Pressable>
              <Pressable
                onPress={() => setVisibility('followers')}
                style={[styles.visOpt, visibility === 'followers' && styles.visOptActive]}
                testID="vis-followers"
              >
                <Text style={[styles.visTitle, visibility === 'followers' && { color: colors.primary }]}>👥 Followers</Text>
                <Text style={styles.visSub}>Only people who follow you can see this.</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>

        <View style={styles.submitBar}>
          <TouchableOpacity
            disabled={!canSubmit}
            onPress={submit}
            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
            testID="upload-submit"
            accessibilityLabel="Post photos"
          >
            {submitting ? <ActivityIndicator color={colors.textInverse} /> : (
              <>
                <Camera size={16} color={colors.textInverse} />
                <Text style={styles.submitBtnTxt}>
                  {stats.succeeded > 0
                    ? `Post ${stats.succeeded} photo${stats.succeeded > 1 ? 's' : ''}`
                    : stats.inFlight > 0 || stats.pending > 0
                    ? 'Uploading…'
                    : 'Post photos'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardSafe>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------------
// <QueueCard /> — one row per queued / uploading / success / failed photo.
// ----------------------------------------------------------------------------
function QueueCard({
  item,
  index,
  total,
  onRemove,
  onRetry,
  onMoveUp,
  onMoveDown,
}: {
  item: QItem;
  index: number;
  total: number;
  onRemove: () => void;
  onRetry: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { status, progress, error } = item;
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const isPending = status === 'pending';
  const isUploading = status === 'uploading';
  const isSuccess = status === 'success';
  const isFailed = status === 'failed';
  const canMoveUp = isPending && index > 0;
  const canMoveDown = isPending && index < total - 1;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(160)}
      layout={Layout.springify().damping(18)}
      style={[
        styles.card,
        isSuccess && styles.cardSuccess,
        isFailed && styles.cardFailed,
      ]}
    >
      <Image source={{ uri: item.localUri }} style={styles.cardThumb} />
      <View style={styles.cardBody}>
        <View style={styles.cardRow}>
          <StatusChip status={status} />
          <View style={{ flex: 1 }} />
          {canMoveUp ? (
            <TouchableOpacity
              onPress={onMoveUp}
              style={styles.iconBtn}
              hitSlop={6}
              accessibilityLabel="Move up"
              testID={`queue-moveup-${index}`}
            >
              <ChevronUp size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
          {canMoveDown ? (
            <TouchableOpacity
              onPress={onMoveDown}
              style={styles.iconBtn}
              hitSlop={6}
              accessibilityLabel="Move down"
              testID={`queue-movedown-${index}`}
            >
              <ChevronDown size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
          {isFailed ? (
            <TouchableOpacity
              onPress={onRetry}
              style={styles.retryBtn}
              hitSlop={4}
              accessibilityLabel="Retry upload"
              testID={`queue-retry-${index}`}
            >
              <RotateCw size={14} color={colors.primary} />
              <Text style={styles.retryBtnTxt}>Retry</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onRemove}
            style={styles.iconBtn}
            hitSlop={6}
            accessibilityLabel="Remove photo"
            testID={`queue-remove-${index}`}
          >
            <X size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {isUploading ? (
          <View style={styles.progressOuter}>
            <View style={[styles.progressInner, { width: `${Math.max(4, pct)}%` }]} />
          </View>
        ) : null}
        {isFailed && error ? (
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
        ) : null}
        {isSuccess ? (
          <Animated.Text entering={FadeIn.duration(260)} style={styles.doneText}>
            Ready to post
          </Animated.Text>
        ) : null}
        {isPending ? (
          <Text style={styles.pendingText}>
            {item.attempts > 0 ? `Retrying (attempt ${item.attempts + 1})…` : 'Waiting…'}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

function StatusChip({ status }: { status: QStatus }) {
  if (status === 'pending') {
    return (
      <View style={[styles.chip, styles.chipPending]}>
        <Clock size={11} color={colors.textSecondary} />
        <Text style={styles.chipTxt}>Queued</Text>
      </View>
    );
  }
  if (status === 'uploading') {
    return (
      <View style={[styles.chip, styles.chipUploading]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.chipTxt, { color: colors.primary }]}>Uploading</Text>
      </View>
    );
  }
  if (status === 'success') {
    return (
      <View style={[styles.chip, styles.chipSuccess]}>
        <Check size={12} color={colors.success} />
        <Text style={[styles.chipTxt, { color: colors.success }]}>Uploaded</Text>
      </View>
    );
  }
  // failed
  return (
    <View style={[styles.chip, styles.chipFailed]}>
      <AlertCircle size={12} color={colors.secondary} />
      <Text style={[styles.chipTxt, { color: colors.secondary }]}>Failed</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 20 },
  sectionTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  req: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  optional: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },

  // Queue header row
  queueHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  countChip: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  globalStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
  },
  globalStatusText: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 13 },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,159,64,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.secondary || '#ff9f40',
  },
  offlineBannerText: {
    flex: 1,
    color: colors.text,
    fontFamily: font.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
  },

  // Queue card
  card: {
    flexDirection: 'row',
    gap: 12,
    padding: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cardSuccess: { borderColor: colors.success + '66' },
  cardFailed: { borderColor: colors.secondary + '66' },
  cardThumb: {
    width: 64,
    height: 64,
    borderRadius: radii.sm,
    backgroundColor: colors.surface2,
  },
  cardBody: { flex: 1, gap: 6 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
  },
  retryBtnTxt: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 11 },

  // Status chips
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipPending: { backgroundColor: colors.surface2, borderColor: colors.border },
  chipUploading: { backgroundColor: 'rgba(245,166,35,0.10)', borderColor: colors.primary + '66' },
  chipSuccess: { backgroundColor: colors.success + '1A', borderColor: colors.success + '66' },
  chipFailed: { backgroundColor: colors.secondary + '1A', borderColor: colors.secondary + '66' },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 10, letterSpacing: 0.3 },

  // Progress bar
  progressOuter: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  progressInner: { height: '100%', backgroundColor: colors.primary, borderRadius: 2 },

  errorText: { color: colors.secondary, fontFamily: font.body, fontSize: 11 },
  doneText: { color: colors.success, fontFamily: font.bodyMedium, fontSize: 11 },
  pendingText: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },

  // Add photos CTA
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: 'rgba(245,166,35,0.06)',
  },
  addBtnTxt: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 13 },

  maxNotice: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  maxNoticeText: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },

  // Caption + tags + visibility
  captionInput: { minHeight: 80, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, color: colors.text, fontFamily: font.body, fontSize: 14, textAlignVertical: 'top' },
  tagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  tagChipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  visOpt: { flex: 1, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, gap: 4 },
  visOptActive: { backgroundColor: 'rgba(245,166,35,0.10)', borderColor: colors.primary },
  visTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  visSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },

  // Submit bar
  submitBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, paddingBottom: Platform.OS === 'ios' ? space.xl : space.lg, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: radii.md, backgroundColor: colors.primary, minHeight: 48 },
  submitBtnDisabled: { backgroundColor: colors.surface2 },
  submitBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
});
