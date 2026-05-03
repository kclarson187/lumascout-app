/**
 * useSpotDetail — data-fetching + derivation hook for /spot/[id].
 * ─────────────────────────────────────────────────────────────
 *
 * Extracted from `app/spot/[id].tsx` on 2026-05-03 (v2.0.25 refactor).
 * The screen component is responsible for orchestration + render; this
 * hook owns EVERY piece of async state and memoized derivation:
 *
 *   • `spot`            — the canonical /spots/:id payload
 *   • `loading`         — initial load spinner flag
 *   • `communityUploads`— /spots/:id/uploads payload (hero carousel)
 *   • `orderedImages`   — cover-first, community-appended gallery array
 *   • `errorCategory`   — recoverable error (drives inline retry UI)
 *   • `galleryIdx`      — active hero pager slide (also self-clamped
 *                         when `orderedImages` shrinks)
 *
 * The hook exposes `setSpot` + `setGalleryIdx` so callers can still
 * do optimistic UI (e.g. admin photo-delete hides locally first).
 * `reload()` is a stable callback that can be wired to a pull-to-
 * refresh handler or a "try again" button.
 *
 * PRESERVED BEHAVIOURS (do NOT change without revisiting [id].tsx):
 *   1. In-flight dedup via `inflightRef` — multiple rapid taps on
 *      the same spot attach to a single Promise.
 *   2. Auto-retry with exponential back-off (0/1s/2s/4s) ONLY for
 *      categories that are actually recoverable.
 *   3. Community uploads fetch is fire-and-forget + non-fatal.
 *   4. `useFocusEffect` triggers a full reload whenever the screen
 *      regains focus (fixes stale cover after edit-in-modal flow).
 *   5. `galleryIdx` auto-clamps to 0 if `orderedImages` shrinks.
 *   6. `initialCoverUrl` is used as slide 0 during the <1s in-flight
 *      window so the hero never flashes through a blank state after
 *      the user taps "View Details" on the map preview.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api, categorizeApiError, type ApiErrorCategory } from '../../api';

export type SpotImage = {
  image_url: string;
  image_id?: string;
  source?: string;
  upload_id?: string;
  contributor?: any;
  [k: string]: any;
};

export type Spot = {
  spot_id?: string;
  title?: string;
  images?: SpotImage[];
  cover_image_url?: string | null;
  hero_cover_image_url?: string | null;
  admin_cover_override?: string | null;
  [k: string]: any;
};

const RETRYABLE: ApiErrorCategory[] = ['timeout', 'network', 'server', 'unknown'];
// 4 attempts total; first is immediate. Worst-case ≈ 7s of sleep
// plus 18s timeout × 4 = 79s before inline retry UI appears.
// Typical path: first attempt succeeds in < 1s.
const BACKOFFS_MS = [0, 1000, 2000, 4000];

export function useSpotDetail(id: string, initialCoverUrl: string | null) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(true);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [communityUploads, setCommunityUploads] = useState<any[]>([]);
  const [errorCategory, setErrorCategory] = useState<ApiErrorCategory | null>(null);

  // Tap-spam guard: concurrent loads attach to the same Promise.
  const inflightRef = useRef<Promise<any> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    // Dedup: if a load is already in-flight for this id, attach to it
    // instead of firing a duplicate request.
    if (inflightRef.current) {
      try { await inflightRef.current; } catch { /* swallow — handler below owns error UX */ }
      return;
    }
    setLoading(true);
    setErrorCategory(null);

    let lastError: any = null;
    let lastCat: ApiErrorCategory | null = null;
    for (let attempt = 0; attempt < BACKOFFS_MS.length; attempt++) {
      if (BACKOFFS_MS[attempt] > 0) {
        try {
          // eslint-disable-next-line no-console
          console.warn('[spot-detail] retrying', { id, attempt, delay: BACKOFFS_MS[attempt] });
        } catch { /* noop */ }
        await new Promise((r) => setTimeout(r, BACKOFFS_MS[attempt]));
      }
      const promise = api.get(`/spots/${id}`, undefined, { timeout: 18000 });
      inflightRef.current = promise;
      try {
        const data = await promise;
        setSpot(data);
        setErrorCategory(null);
        inflightRef.current = null;
        setLoading(false);
        // Fire-and-forget community uploads fetch. Non-fatal.
        api.get(`/spots/${id}/uploads`, { limit: 24 })
          .then((r: any) => {
            const items = Array.isArray(r?.items) ? r.items : [];
            setCommunityUploads(items);
          })
          .catch(() => { /* CommunityUploadsSection handles its own retry on mount */ });
        return;
      } catch (e: any) {
        lastError = e;
        lastCat = categorizeApiError(e);
        try {
          // eslint-disable-next-line no-console
          console.warn('[spot-detail]', lastCat, {
            id, attempt,
            status: e?.response?.status,
            code: e?.code,
            message: e?.message,
          });
        } catch { /* noop */ }
        if (!RETRYABLE.includes(lastCat)) break;
      } finally {
        inflightRef.current = null;
      }
    }

    // All retries exhausted (or we hit a non-retryable category).
    setLoading(false);
    if (lastCat === 'missing') {
      Alert.alert(
        'Spot no longer available',
        'This location has been removed or is no longer public.',
        [{
          text: 'OK',
          onPress: () => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)/explore');
          },
        }],
      );
      return;
    }
    if (lastCat === 'auth') { setErrorCategory('auth'); return; }
    if (lastCat === 'paywall') { setErrorCategory('paywall'); return; }
    setErrorCategory(lastCat);
    // `lastError` captured for diagnostics but we don't surface the
    // raw error to users — the category + headline copy in [id].tsx
    // is already tailored to each bucket.
    void lastError;
  }, [id]);

  // Initial mount + id-change reload.
  useEffect(() => { load(); }, [load]);

  // Re-fetch on focus — fixes stale cover after returning from an
  // edit-in-modal flow (e.g. cover-photo editor, admin approve edits).
  useFocusEffect(
    useCallback(() => {
      if (id) load();
      return undefined;
    }, [id, load]),
  );

  // CRITICAL: compute the *effective* ordered images EXACTLY ONCE and
  // use it for the hero carousel, dot indicators, and every per-image
  // code path. Avoids desync between dots and slides.
  const orderedImages = useMemo<SpotImage[]>(() => {
    // During the < 1s /spots/:id fetch, show the map-preview cover so
    // the hero never flashes blank after "View Details" tap.
    if (!spot && initialCoverUrl) {
      return [{ image_url: initialCoverUrl, source: 'initial_cover_from_map' }];
    }
    const all: SpotImage[] = Array.isArray(spot?.images) ? spot!.images! : [];
    // Single source of truth for the cover (matches /api/spots/markers
    // exactly — this is WHY the map preview and detail hero are the
    // same image post-v2.0.24).
    const coverUrl: string | null =
      spot?.cover_image_url || spot?.hero_cover_image_url || null;

    // Step 1 — order primary owner-uploaded images cover-first.
    let primary: SpotImage[] = all;
    if (coverUrl) {
      const match = all.find((im) => im?.image_url === coverUrl);
      if (match) {
        primary = [match, ...all.filter((im) => im?.image_url !== coverUrl)];
      } else if (all.length > 0) {
        // Cover lives outside images[] (community-upload promoted by
        // backend rotation). Prepend a synthetic entry so the hero
        // pager still starts on the map-preview photo.
        primary = [{ image_url: coverUrl, source: 'cover_override' }, ...all];
      } else {
        primary = [{ image_url: coverUrl, source: 'cover_override' }];
      }
    }

    // Step 2 — append community photos, deduped against primary URLs.
    const seen = new Set<string>(
      primary.map((im) => im?.image_url).filter((u): u is string => typeof u === 'string'),
    );
    const community = (Array.isArray(communityUploads) ? communityUploads : [])
      .filter((u: any) => u && typeof u.image_url === 'string' && !seen.has(u.image_url))
      .map((u: any) => ({
        image_url: u.image_url,
        source: 'community_upload',
        upload_id: u.upload_id,
        contributor: u.contributor,
      }));

    return [...primary, ...community];
  }, [spot, communityUploads, initialCoverUrl]);

  // Clamp galleryIdx whenever orderedImages shrinks (e.g. after a
  // delete). Never let the pager land on a phantom slide.
  useEffect(() => {
    if (galleryIdx >= orderedImages.length) {
      setGalleryIdx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedImages.length]);

  return {
    // `spot` is exposed as `any` to preserve the ergonomics of the
    // original `useState<any | null>` usage \u2014 the detail screen
    // reads dozens of optional + rarely-typed fields off this object
    // (tags, owner sub-fields, seasonal windows, permit flags, etc.)
    // and strict typing here would be a large unrelated change. The
    // internal hook type `Spot` still enforces discipline on the
    // fields we actively derive (images, cover_image_url, title).
    spot: spot as any,
    setSpot: setSpot as (updater: any) => void,
    loading,
    galleryIdx,
    setGalleryIdx,
    communityUploads,
    // Exposed for the CommunityUploadsSection `onUpdate` path where a
    // new upload is posted from inside the detail screen itself and
    // we want to splice it into the hero carousel without triggering
    // a full /spots/:id reload.
    setCommunityUploads,
    errorCategory,
    orderedImages,
    reload: load,
  };
}
