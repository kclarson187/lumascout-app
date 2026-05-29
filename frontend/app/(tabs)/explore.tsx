import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform,
  ActivityIndicator, ScrollView, Modal, Switch, Image, Pressable,
  Share, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, List, Map as MapIcon, SlidersHorizontal, Locate, X, Shield, Gem, Sun, Users as UsersIcon, MapPin, Navigation, RefreshCw, ArrowUpRight, Layers, Bookmark, Flame, Camera, Plane, Cloud, Heart, Share2 as ShareIcon, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { calculateDistanceMiles, formatDistance, resolveMiles } from '../../src/utils/distance';
import { goldenHourBrief, blueHourBrief } from '../../src/utils/sun-windows';
import { driveTimeEstimate } from '../../src/utils/drive-time';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import { SkeletonSpotList } from '../../src/components/SkeletonSpotCard';
import { Chip, EmptyState } from '../../src/components/ui';
import { Button } from '../../src/components/Button';
import ScoutAICard from '../../src/components/ScoutAICard';
import {
  SmartAlertChip,
  NearbyRightNowList,
  TrendingNearbyList,
  GoldenHourRail,
} from '../../src/components/PremiumExploreRails';
import ParksRail from '../../src/components/ParksRail';
import ParkMapPin from '../../src/components/ParkMapPin';
import { PremiumMapPin } from '../../src/components/PremiumMapPin';
import ExploreErrorBoundary from '../../src/components/ExploreErrorBoundary';
import SectionErrorBoundary from '../../src/components/SectionErrorBoundary';
import SpotImageFallback from '../../src/components/SpotImageFallback';
import CachedImage from '../../src/components/CachedImage';
import { resolveSpotCover } from '../../src/utils/spot-cover';
import { BrandedRefreshControl, useBrandedRefresh } from '../../src/theme/refresh';
import {
  safeTier,
  normalizeSpotsForMap,
  exploreLog,
} from '../../src/utils/spot-geo';
import MAP_STYLE_DARK from '../../src/components/mapStyleDark';

// Native-only map wrapper with web stub (Metro / codegenNativeCommands safety).
import { MapView, ClusteredMapView, Marker, PROVIDER_GOOGLE } from '../../src/components/maps-module';
import SafeMapView from '../../src/components/SafeMapView';
import MapErrorBoundary from '../../src/components/MapErrorBoundary';
import {
  isValidCoordinate, FALLBACK_REGION, MAX_MARKERS,
  pickNearest, logSkippedOnce,
} from '../../src/utils/map-safety';
import SafeClusteredMapView from '../../src/components/SafeClusteredMapView';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { readCache, writeCache } from '../../src/utils/swrCache';
import { useAuth } from '../../src/auth';
import { IMG_SIZES } from '../../src/utils/image-url';

// June 2025 stability fix — Expo Go runtime detection.
// In Expo Go the react-native-maps + react-native-map-clustering bridge
// is fragile under rapid pan/zoom. We pause aggressive marker refetches
// and drop the lazy /spots/markers cadence to once-every-2.5s in Expo
// Go to avoid hammering the bridge while the user is moving the map.
// Production EAS builds use the full cadence (no extra rate-limit).
const IS_EXPO_GO =
  (Constants as any)?.appOwnership === 'expo'
  || (Constants as any)?.executionEnvironment === 'storeClient';
const MARKER_REFETCH_MIN_MS = IS_EXPO_GO ? 2500 : 800;

// FIX(pre-launch UX cleanup #1): Map default region fallback chain.
// Priority: live GPS → cached coords → user.city geo → US fallback default.
// Never shows random unrelated regions.
const DEFAULT_FALLBACK = { lat: 29.4241, lng: -98.4936 }; // San Antonio, TX
// Texas-wide fallback used when GPS permission is explicitly denied or
// errors out — better UX than zooming to a single city the user may not
// be in. Roughly centered on Brady, TX (geographic center of Texas).
const TEXAS_WIDE_REGION = {
  latitude: 31.0,
  longitude: -99.0,
  latitudeDelta: 10,
  longitudeDelta: 10,
};
const LAST_KNOWN_KEY = 'lumascout:last_known_coords:v1';
// Lightweight US-city geo dictionary so users with a saved city in their
// profile but no GPS still land near home. Extend as we onboard more markets.
const CITY_GEO: Record<string, { lat: number; lng: number }> = {
  'san antonio': { lat: 29.4241, lng: -98.4936 },
  'austin': { lat: 30.2672, lng: -97.7431 },
  'houston': { lat: 29.7604, lng: -95.3698 },
  'dallas': { lat: 32.7767, lng: -96.7970 },
  'new york': { lat: 40.7128, lng: -74.0060 },
  'los angeles': { lat: 34.0522, lng: -118.2437 },
  'san francisco': { lat: 37.7749, lng: -122.4194 },
  'chicago': { lat: 41.8781, lng: -87.6298 },
  'miami': { lat: 25.7617, lng: -80.1918 },
  'seattle': { lat: 47.6062, lng: -122.3321 },
  'denver': { lat: 39.7392, lng: -104.9903 },
  'portland': { lat: 45.5152, lng: -122.6784 },
  'boston': { lat: 42.3601, lng: -71.0589 },
  'atlanta': { lat: 33.7490, lng: -84.3880 },
  'phoenix': { lat: 33.4484, lng: -112.0740 },
  'nashville': { lat: 36.1627, lng: -86.7816 },
  'las vegas': { lat: 36.1699, lng: -115.1398 },
  'san diego': { lat: 32.7157, lng: -117.1611 },
};

type Filters = {
  shoot_type?: string;
  best_time_of_day?: string;
  best_season?: string;
  dog_friendly?: boolean;
  kid_friendly?: boolean;
  accessible?: boolean;
  indoor?: boolean;
  permit_required?: boolean;
  fee_required?: boolean;
  verified_recently?: boolean;
  hidden_gem?: boolean;
  proven_spot?: boolean;
  min_rating?: number;
  min_parking_ease?: number;
  max_walking_distance?: number;
  max_crowd_level?: number;
  min_sunrise_strength?: number;
  min_sunset_strength?: number;
  min_morning_golden?: number;
  min_evening_golden?: number;
  min_variety?: number;
};

const SHOOT_TYPES = ['Family', 'Pet', 'Wedding', 'Portrait', 'Seniors', 'Branding', 'Nature', 'Urban', 'Travel', 'Lifestyle'];
const SEASONS: string[] = []; // Apr 2026 cleanup: month/season filter removed; constant retained as no-op for backwards compat with any downstream import.

export default function Explore() {
  const [spots, setSpots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // CR Item 2 (May 2026): Explore defaults to **List view** on every cold
  // launch. Within a session the user's last toggle (List ↔ Map) is
  // remembered in memory only, but on app relaunch we always reset to
  // List for faster first paint and lower bootstrap cost. Map tiles
  // are pre-warmed in the background once the screen mounts so
  // switching to Map is near-instant the first time.
  const [view, setView] = useState<'list' | 'map'>('list');
  const [viewHydrated, setViewHydrated] = useState(true); // no async hydration anymore — always ready
  const [mapEverMounted, setMapEverMounted] = useState(false);
  // ─── May 2026 (post-Catalyst-crash): two-phase map mount ──────────
  // The bare `mapEverMounted` flag controls when MapView itself enters
  // the JSX tree. But on Mac Catalyst / "Designed for iPad on Mac",
  // Fabric's interop shim (`RCTLegacyViewManagerInteropComponentView`)
  // can reach `finalizeUpdates → __NSArrayM insertObject:atIndex:`
  // BEFORE MapView has fully realized its child-container view, if we
  // hand it a fully populated Markers array on the same render.
  //
  // To eliminate that race we now gate Markers (and clustering's
  // `renderCluster` outputs, which are also Markers) on a SECOND flag,
  // `mapNativeReady`, that flips to true only after MapView fires
  // `onMapReady`. Net behavior on iPhone/iPad/Mac Catalyst:
  //   1. MapView mounts first (empty), with valid frame + child container.
  //   2. Native side fires onMapReady (~50–200ms after layout settles).
  //   3. We then render the Markers, so insertObject:atIndex: receives
  //      an already-realized parent and a clean fresh-insert (no
  //      mid-transaction child mutation).
  // Visual impact: zero — MapView shows the basemap during the brief
  // pre-ready window, and pins fade in within ~150ms of that window.
  const [mapNativeReady, setMapNativeReady] = useState(false);

  // Reset mapNativeReady the moment we navigate AWAY from map view OR
  // unmount the map by any other path. Without this, switching to list
  // and back leaves `mapNativeReady=true` from the previous session,
  // and the new MapView instance gets Markers thrown at it on first
  // render — exactly the race we just fixed. The cheap re-mount of
  // markers ~150ms after onMapReady fires the second time is a
  // worthwhile trade for crash-proofing.
  useEffect(() => {
    if (view !== 'map') setMapNativeReady(false);
  }, [view]);

  // Background tile warm-up: once the user lands on Explore (List view
  // by default), kick off a low-priority mount of the map machinery so
  // the first tap of "Map" feels instant. The map is removed from the
  // tree if the user actively switches back; this preload only
  // reserves the JS module + the markers-bbox query.
  //
  // ANDROID STABILIZATION (June 2025): the prewarm is DISABLED on
  // Android. react-native-maps under New Architecture / Fabric on
  // Android is fragile when mounted off-screen (occasional native
  // crashes during initial GoogleMap surface allocation while the
  // JS thread is still busy hydrating other tabs). On Android the
  // map mounts only when the user explicitly taps the Map toggle,
  // which gives the JS thread a clean slate. iOS keeps the prewarm
  // for instant-feel tab switching.
  useEffect(() => {
    if (mapEverMounted) return;
    if (Platform.OS === 'android') return; // lazy on tap only
    const t = setTimeout(() => setMapEverMounted(true), 1200);
    return () => clearTimeout(t);
  }, [mapEverMounted]);

  // ─── May 2026 Phase E — map performance timeline ──────────────────
  // Stamps `performance.now()` the moment the user flips into Map view.
  // Used by the markers diagnostic logs to compute "ms_since_map_open"
  // for every step (HTTP start, HTTP done, first marker render). Helps
  // attribute the user-reported 5-second pin-appear delay to the right
  // step (warm-up timer? GPS gate? API latency? RN bridge commit?).
  const mapOpenAt = useRef<number | null>(null);

  const switchView = useCallback((next: 'list' | 'map') => {
    Haptics.selectionAsync().catch(() => {});
    setView(next);
    if (next === 'map') {
      // ANDROID STABILIZATION: defer the map mount slightly so the
      // segmented toggle paint and the SafeAreaView reflow finish
      // BEFORE the GoogleMap surface is allocated. Without this, on
      // Android Fabric the JS thread is still mid-transaction when
      // the native map tries to attach, which can crash the activity.
      // iOS keeps the synchronous mount (no observed Fabric race).
      if (Platform.OS === 'android') {
        setTimeout(() => setMapEverMounted(true), 350);
      } else {
        setMapEverMounted(true);
      }
      mapOpenAt.current = performance.now();
      // Use console.log directly here — exploreLog requires the
      // surrounding hooks to have initialized which isn't guaranteed
      // in this very early callback.
      try {
        // eslint-disable-next-line no-console
        console.log('[explore] view → map', new Date().toISOString());
      } catch {}
    }
    // NOTE: intentionally NOT persisted — session memory only.
  }, []);
  const [filters, setFilters] = useState<Filters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedSpot, setSelectedSpot] = useState<any | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; ts: number } | null>(null);
  const { user } = useAuth();

  // FIX(pre-launch UX cleanup #1): Hydrate last-known coords from
  // AsyncStorage on mount so the map can center near home immediately on
  // cold start, even before the live GPS handle resolves. Coords older
  // than 7 days are treated as stale.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LAST_KNOWN_KEY);
        if (!raw) return;
        const cached = JSON.parse(raw);
        if (cached?.lat && cached?.lng && cached?.ts && (Date.now() - cached.ts < 7 * 24 * 60 * 60 * 1000)) {
          setUserCoords((cur) => cur || cached);
        }
      } catch {}
    })();
  }, []);

  // Initial region for the map — priority chain:
  //   1. Live / cached GPS
  //   2. user.city geo-lookup
  //   3. San Antonio, TX (premium default market)
  // This computation runs every render but is cheap (constant-time table
  // lookup) and gives us the latest fallback as state populates.
  // Stability hardening (Nov 2026): the resolved seed MUST always pass
  // isValidCoordinate before we promote it to `initialRegion` — bad
  // seed coords have historically crashed react-native-maps on mount.
  // Worst case, falls back to FALLBACK_REGION (San Antonio).
  const initialRegion = useMemo(() => {
    if (userCoords?.lat != null && userCoords?.lng != null
        && isValidCoordinate(userCoords.lat, userCoords.lng)) {
      return { latitude: userCoords.lat, longitude: userCoords.lng, latitudeDelta: 0.45, longitudeDelta: 0.45 };
    }
    const cityKey = (user?.city || '').toLowerCase().trim();
    const cityCoords = cityKey ? CITY_GEO[cityKey] : null;
    if (cityCoords && isValidCoordinate(cityCoords.lat, cityCoords.lng)) {
      return { latitude: cityCoords.lat, longitude: cityCoords.lng, latitudeDelta: 0.45, longitudeDelta: 0.45 };
    }
    if (DEFAULT_FALLBACK && isValidCoordinate(DEFAULT_FALLBACK.lat, DEFAULT_FALLBACK.lng)) {
      return { latitude: DEFAULT_FALLBACK.lat, longitude: DEFAULT_FALLBACK.lng, latitudeDelta: 0.45, longitudeDelta: 0.45 };
    }
    return FALLBACK_REGION;
  }, [userCoords, user?.city]);
  // FIX(2026-04 Item #3 round 3): GPS state machine for the trust strip.
  // 'idle' | 'requesting' | 'granted' | 'denied' | 'error'
  const [gpsState, setGpsState] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'error'>('idle');
  // "Search this area" CTA — surfaces when the user pans the map far enough
  // from the current load center. Tracked here to avoid prop-drilling.
  const [showSearchArea, setShowSearchArea] = useState(false);
  // Map type cycler — Standard → Hybrid → Standard. Apple-style "Layers".
  const [mapType, setMapType] = useState<'standard' | 'hybrid'>('standard');
  // Niche selector embedded in the compact location chip row (replaces
  // the 8-chip ScrollView in map mode for a tighter Apple-quality header).
  const [nicheOpen, setNicheOpen] = useState(false);
  // Local optimistic save state — keyed by spot_id. Lets the bottom sheet
  // Save button feel instant without re-fetching the spots list.
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  // FIX(P1-5 pre-release audit): explicit error state so a transient API
  // failure doesn't leave the screen stuck on a spinner. We surface a
  // small "Couldn't load — Tap to retry" banner without losing the map.
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastLoadCenter = useRef<{ lat: number; lng: number } | null>(null);
  const currentRegion = useRef<any>(null);
  const mapRef = useRef<any>(null);
  // (Apr 2026 hardening) Track in-flight /spots fetch so we can cancel
  // it when filters change rapidly (or the screen unmounts during a
  // tab-switch). Prevents stale state landing AFTER the next request.
  const inflightAbort = useRef<AbortController | null>(null);
  // (Apr 2026 hardening) Region-change debounce timer ref. Wiped on
  // unmount so a pending timeout can never call setState on a dead
  // component.
  const regionDebounce = useRef<any>(null);

  // ────────────────────────────────────────────────────────────────
  // June 2025 CR — "Explore list sorted closest-first by real GPS".
  // We derive `nearbySortedSpots` once per render from the raw /spots
  // payload. When the user has granted GPS, we sort ascending by a
  // resolved mileage (backend distance_mi preferred, Haversine fallback
  // from user↔spot lat/lng). When GPS is denied / unavailable we keep
  // the backend order (quality-ranked), so we never present a
  // misleading "nearby" list tied to a random default coord. Map pins
  // read the same `spots` array, so list + map stay synced.
  // ────────────────────────────────────────────────────────────────
  const nearbySortedSpots = useMemo(() => {
    if (!Array.isArray(spots) || spots.length === 0) return spots;
    if (gpsState !== 'granted' || !userCoords) return spots;
    const withMi = spots.map((sp) => ({
      sp,
      mi: resolveMiles(sp as any, userCoords.lat, userCoords.lng),
    }));
    withMi.sort((a, b) => {
      // null miles sorts to the bottom (preserves their relative order
      // from the server rather than scrambling them to the top).
      if (a.mi == null && b.mi == null) return 0;
      if (a.mi == null) return 1;
      if (b.mi == null) return -1;
      return a.mi - b.mi;
    });
    return withMi.map((x) => x.sp);
  }, [spots, gpsState, userCoords]);

  // ────────────────────────────────────────────────────────────────
  // Explore Speed CR — Batch 2 (June 2025): paginated infinite-scroll
  // list state.
  //
  //   • Initial page : limit=24
  //   • Subsequent   : limit=12 / page
  //   • Cursor       : server-emitted next_cursor (offset).
  //   • Sort         : 'distance' when GPS granted, else 'quality'
  //   • SWR          : initial page hydrated synchronously from the
  //                    AsyncStorage cache so a cold tab-switch never
  //                    flashes a blank screen. Background refresh
  //                    runs immediately after.
  //
  // We keep the legacy `spots` array around because the map view
  // (and the Nearby/Trending/Golden Hour rails) still consume it.
  // Batch 3 will swap the map to /api/spots/markers; until then the
  // two paths coexist without breaking each other.
  // ────────────────────────────────────────────────────────────────
  const PAGE_SIZE_FIRST = 24;
  const PAGE_SIZE_NEXT = 12;
  const [listSpots, setListSpots] = useState<any[]>([]);
  const [listCursor, setListCursor] = useState<number>(0);
  const [listHasMore, setListHasMore] = useState<boolean>(true);
  const [listLoadingInitial, setListLoadingInitial] = useState<boolean>(true);
  const [listLoadingMore, setListLoadingMore] = useState<boolean>(false);
  const listInflight = useRef<AbortController | null>(null);
  const listOnEndReachedFiring = useRef<boolean>(false);

  // Cache key encodes filters + GPS bucket. We round coords to ~1 mile
  // (0.02°) so users moving through a city don't blow the cache.
  const listCacheKey = useMemo(() => {
    const parts: string[] = ['explore.list:v1'];
    Object.entries(filters).forEach(([k, v]) => {
      if (v == null || v === '' || v === false) return;
      parts.push(`${k}=${v}`);
    });
    if (gpsState === 'granted' && userCoords) {
      const lat = (Math.round(userCoords.lat * 50) / 50).toFixed(2);
      const lng = (Math.round(userCoords.lng * 50) / 50).toFixed(2);
      parts.push(`g=${lat},${lng}`);
    } else {
      parts.push('g=none');
    }
    return parts.join('|');
  }, [filters, gpsState, userCoords]);

  // Jun 2025 — cold-start cache for the main `spots` pool that feeds
  // the markers count, the trust strip, and every downstream selector.
  // The list-mode cache above already covers `listSpots`; this is the
  // mirror for the /spots load() at line 487. Key swaps the prefix so
  // the two payloads never collide on AsyncStorage but reuse the same
  // filter+GPS bucket so they invalidate together.
  const spotsPoolCacheKey = useMemo(
    () => listCacheKey.replace('explore.list:v1', 'explore.pool:v1'),
    [listCacheKey],
  );
  // Soft TTL — we still show cached data if older, but log it so we
  // know how often this code path is hit. 24h is generous; the live
  // request always supersedes cache within seconds on a healthy net.
  const SPOTS_POOL_TTL_MS = 24 * 60 * 60 * 1000;

  const buildListParams = useCallback((cursor: number, pageSize: number) => {
    const params: any = {
      paginated: 1,
      limit: pageSize,
      cursor,
      sort: gpsState === 'granted' && userCoords ? 'distance' : 'quality',
    };
    Object.entries(filters).forEach(([k, v]) => {
      if (v != null && v !== '' && v !== false) params[k] = v;
    });
    if (gpsState === 'granted' && userCoords) {
      params.lat = userCoords.lat;
      params.lng = userCoords.lng;
    }
    return params;
  }, [filters, gpsState, userCoords]);

  // SWR hydrate — show last cached payload instantly when filters/GPS
  // bucket match. Runs once per cache-key change.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cached = await readCache<{ items: any[]; cursor: number; hasMore: boolean }>(listCacheKey);
        if (alive && cached?.items?.length) {
          setListSpots(cached.items);
          setListCursor(cached.cursor || cached.items.length);
          setListHasMore(cached.hasMore !== false);
          setListLoadingInitial(false);
        }
      } catch {}
    })();
    return () => { alive = false; };
  }, [listCacheKey]);

  // Jun 2025 — cold-start hydrate for the main /spots pool. Mirrors
  // the listSpots hydrate above so the trust strip, header count,
  // and any downstream consumers see PREVIOUSLY-CACHED spots while
  // the live request is still in flight. Critical for cold-start
  // UX during transient backend outages (Cloudflare 520 hiccups,
  // failed deploys, slow TestFlight networks) — the screen no longer
  // appears empty for the first 5-10s. The live `load()` always
  // supersedes this cache within seconds. Cache write happens after
  // each successful load() in the try-block below.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cached = await readCache<{ items: any[]; ts: number }>(spotsPoolCacheKey);
        if (!alive || !cached?.items?.length) return;
        // Only hydrate if we have NOTHING yet — never overwrite a
        // live response that came in faster than the AsyncStorage read.
        // The age check is soft: even if stale, showing yesterday's
        // spots is far better than an empty "Couldn't load" banner.
        const ageMs = Date.now() - (cached.ts || 0);
        if (spots.length === 0) {
          setSpots(cached.items);
          exploreLog('info', 'spots_pool_hydrated_from_cache', {
            count: cached.items.length,
            ageMs,
            stale: ageMs > SPOTS_POOL_TTL_MS,
          });
          // Flip loading off so the skeleton doesn't keep spinning.
          // The live request still resolves in the background and
          // overwrites this when it lands.
          setLoading(false);
        }
      } catch { /* best-effort cache read */ }
    })();
    return () => { alive = false; };
    // We intentionally don't depend on `spots` here — this effect
    // must run only when the cache KEY changes (filters / GPS) so we
    // hydrate exactly once per filter combo, not every state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotsPoolCacheKey]);

  // Initial fetch — called when filters or GPS bucket changes.
  const loadListInitial = useCallback(async () => {
    if (listInflight.current) {
      try { listInflight.current.abort(); } catch {}
    }
    const ac = new AbortController();
    listInflight.current = ac;
    // Don't flip loading to true if we already have cached data — keep
    // the cards on screen and let the background refresh swap them in.
    setListSpots((prev) => (prev.length ? prev : prev));
    if (listSpots.length === 0) setListLoadingInitial(true);
    try {
      const params = buildListParams(0, PAGE_SIZE_FIRST);
      const resp = await api.get('/spots', params);
      if (ac.signal.aborted) return;
      // Wrapped shape from backend (paginated=1).
      const items: any[] = Array.isArray(resp?.items) ? resp.items : (Array.isArray(resp) ? resp : []);
      const next: number | null = (resp && typeof resp.next_cursor === 'number') ? resp.next_cursor : null;
      setListSpots(items);
      setListCursor(next ?? items.length);
      setListHasMore(next !== null);
      writeCache(listCacheKey, { items, cursor: next ?? items.length, hasMore: next !== null }).catch(() => {});
    } catch (e: any) {
      if (!ac.signal.aborted) exploreLog('warn', 'list_initial_error', { message: e?.message });
    } finally {
      if (listInflight.current === ac) listInflight.current = null;
      setListLoadingInitial(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildListParams, listCacheKey]);

  // Pagination — pull next page of 12.
  const loadListNextPage = useCallback(async () => {
    if (!listHasMore || listLoadingMore) return;
    if (listOnEndReachedFiring.current) return;
    listOnEndReachedFiring.current = true;
    setListLoadingMore(true);
    try {
      const params = buildListParams(listCursor, PAGE_SIZE_NEXT);
      const resp = await api.get('/spots', params);
      const newItems: any[] = Array.isArray(resp?.items) ? resp.items : [];
      const next: number | null = (resp && typeof resp.next_cursor === 'number') ? resp.next_cursor : null;
      setListSpots((prev) => {
        const merged = [...prev, ...newItems];
        // Persist updated cache so a tab return shows the full scrolled list.
        writeCache(listCacheKey, { items: merged, cursor: next ?? merged.length, hasMore: next !== null }).catch(() => {});
        return merged;
      });
      setListCursor(next ?? listCursor + newItems.length);
      setListHasMore(next !== null);
    } catch (e: any) {
      exploreLog('warn', 'list_next_error', { message: e?.message });
    } finally {
      setListLoadingMore(false);
      listOnEndReachedFiring.current = false;
    }
  }, [buildListParams, listCursor, listHasMore, listLoadingMore, listCacheKey]);

  // Re-run initial fetch when filters / GPS bucket change.
  useEffect(() => {
    if (view !== 'list') return; // don't fetch list when on map
    loadListInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listCacheKey, view]);

  const load = useCallback(async () => {
    // Cancel any prior /spots request so the most-recent filter wins.
    if (inflightAbort.current) {
      try { inflightAbort.current.abort(); } catch {}
    }
    const controller = new AbortController();
    inflightAbort.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const params: any = { limit: 200, sort: 'quality' };
      Object.entries(filters).forEach(([k, v]) => {
        if (v != null && v !== '' && v !== false) params[k] = v;
      });
      // FIX(2026-04 Item #3 round 3): always pass user GPS to /spots
      // when we have it. Without coords, backend returns null distance
      // (distance_source='unavailable') and the UI shows the trust
      // strip "Enable location for accurate nearby spots".
      const fresh = userCoords && (Date.now() - userCoords.ts < 30 * 60 * 1000);
      if (fresh) {
        params.lat = userCoords!.lat;
        params.lng = userCoords!.lng;
      }
      // FIX(2026-05) — bump timeout for /spots specifically. The
      // markers endpoint is a slim payload; /spots with limit=200
      // and full metadata can take 5-10s in production, breaching
      // the default 15s axios timeout when the network is slow on
      // TestFlight. Production users were seeing the red "Couldn't
      // load spots" banner even though map markers loaded fine.
      const data = await api.get('/spots', params, { timeout: 25000 });
      // If a newer request was started, drop this stale response.
      if (controller.signal.aborted) {
        exploreLog('debug', 'load_aborted_pre_set');
        return;
      }
      setSpots(data);
      // Cold-start cache write — persist the successful pool so the
      // next launch hydrates instantly via the effect above. We cap
      // the cached array at 200 (matches the live `limit=200` query)
      // so AsyncStorage never balloons. Best-effort; failures ignored.
      if (Array.isArray(data) && data.length > 0) {
        writeCache(spotsPoolCacheKey, {
          items: data.slice(0, 200),
          ts: Date.now(),
        }).catch(() => {});
      }
      exploreLog('info', 'load_ok', {
        count: Array.isArray(data) ? data.length : 0,
        filterKeys: Object.keys(params).filter((k) => k !== 'limit' && k !== 'sort'),
      });
    } catch (e: any) {
      if (controller.signal.aborted) {
        exploreLog('debug', 'load_aborted_in_flight');
        return;
      }
      // Do NOT clear `spots` — keep last-known good data visible while
      // showing a retry pill. Only reset on success.
      // Jun 2025 — if we genuinely have nothing on screen (cold-start
      // failure with no prior in-memory state) try one last AsyncStorage
      // read so the user sees CACHED spots from a previous session
      // instead of an empty error banner. The hydrate-on-mount effect
      // usually wins this race, but on very fast network failures it
      // can lose, so this is the belt-and-suspenders backup.
      if (spots.length === 0) {
        try {
          const cached = await readCache<{ items: any[]; ts: number }>(spotsPoolCacheKey);
          if (cached?.items?.length) {
            setSpots(cached.items);
            exploreLog('info', 'spots_pool_error_fallback_to_cache', {
              count: cached.items.length,
              ageMs: Date.now() - (cached.ts || 0),
            });
          }
        } catch { /* best-effort */ }
      }
      setLoadError(e?.message || 'Couldn\'t load spots. Check your connection.');
      exploreLog('warn', 'load_error', { message: e?.message });
    } finally {
      // Only flip loading off if this controller is still the latest
      // (otherwise a new request will manage the spinner).
      if (inflightAbort.current === controller) {
        inflightAbort.current = null;
        setLoading(false);
      }
    }
  }, [filters, userCoords]);

  useEffect(() => { load(); }, [load]);

  // CR Item 11 (May 2026) — branded pull-to-refresh on Explore List view.
  // Refresh path: re-runs full /api/spots load + the markers fetch. The
  // `isChanged` predicate compares spot-id sets so the toast only fires
  // when the result actually differs (avoids "Updated just now" noise on
  // every pull when nothing changed).
  const listPullRefresh = useBrandedRefresh<string>({
    load: async () => {
      await load();
      // Cheap snapshot key: sorted spot_id concatenation (good enough
      // for change detection without storing big objects in the ref).
      return (spots || []).map((s) => s?.spot_id || '').sort().join(',');
    },
    isChanged: (prev, next) => prev !== null && prev !== next,
  });

  // ────────────────────────────────────────────────────────────────
  // Explore Speed CR — Batch 3 (June 2025): lightweight map markers.
  //
  // The map view consumes /api/spots/markers (≈6 KB / 200 markers)
  // instead of /api/spots (≈80 KB / 200 spots). The marker payload
  // ships ONLY the fields the marker needs: spot_id, lat, lng, title,
  // category, shoot_types, is_premium, is_hidden_gem, score, thumb_url.
  //
  // We keep the legacy `spots` state untouched — it still feeds the
  // list-view rails (NearbyRightNowList / TrendingNearbyList /
  // GoldenHourRail) which need full descriptions + image arrays.
  // The map rendering switches to `mapMarkers` (coerced to lat/lng →
  // latitude/longitude so the existing normalizeSpotsForMap helper
  // works without refactor).
  // ────────────────────────────────────────────────────────────────
  const [mapMarkers, setMapMarkers] = useState<any[]>([]);
  const markersInflight = useRef<AbortController | null>(null);
  // Rate-limit + drag-pause guards (June 2025 Expo Go stability fix).
  const lastMarkerFetchAt = useRef<number>(0);
  const isMapInteractingRef = useRef<boolean>(false);
  // Track whether component is still mounted so a debounced fetch can't
  // setState() after unmount.
  const mapMountedRef = useRef<boolean>(true);
  useEffect(() => {
    mapMountedRef.current = true;
    return () => {
      mapMountedRef.current = false;
      try { markersInflight.current?.abort(); } catch {}
      if (regionDebounce.current) clearTimeout(regionDebounce.current);
    };
  }, []);

  const loadMapMarkers = useCallback(async (region?: any) => {
    // Bail entirely when we're not on the map view — the user toggled
    // back to list and any in-flight markers fetch is wasted bandwidth
    // (and risks a setState after the map unmounts).
    if (view !== 'map') return;

    // ─── May 2026 — markers timing diagnostics (Phase E) ──────────
    // Measures every step of the map-load timeline so we can identify
    // the actual bottleneck behind the user-reported 5-second delay
    // before pins appear. All times are in ms relative to the
    // `mapOpenAt` ref, which was stamped the moment view flipped to
    // 'map'. Intentionally cheap: 4 console statements per fetch via
    // the existing exploreLog wrapper, with a single timeline object
    // so the analyst can see the full sequence in one log line.
    const _markerPerfStart = performance.now();
    const _msSinceMapOpen = mapOpenAt.current
      ? Math.round(performance.now() - mapOpenAt.current)
      : null;
    exploreLog('info', 'markers_fetch_start', {
      ms_since_map_open: _msSinceMapOpen,
      has_region: !!region,
      view, mapEverMounted, mapNativeReady,
    });

    // Rate-limit: skip if we just fetched. In Expo Go the bridge gets
    // overwhelmed by rapid setMapMarkers; we throttle to 2.5s between
    // calls. Production builds (EAS) use 800ms.
    const now = Date.now();
    if (now - lastMarkerFetchAt.current < MARKER_REFETCH_MIN_MS) {
      exploreLog('info', 'markers_fetch_throttled', {
        ms_since_last_fetch: now - lastMarkerFetchAt.current,
        ms_since_map_open: _msSinceMapOpen,
      });
      return;
    }
    // Pause refetches while the user is actively touching the map.
    // Region-change-COMPLETE does fire after the gesture ends, but a
    // rapid pinch can fire mid-gesture from native side; this guard
    // is belt-and-suspenders.
    if (isMapInteractingRef.current) return;

    if (markersInflight.current) {
      try { markersInflight.current.abort(); } catch {}
    }
    const ac = new AbortController();
    markersInflight.current = ac;
    lastMarkerFetchAt.current = now;
    try {
      const params: any = { limit: IS_EXPO_GO ? 200 : 500 };
      // Bbox filter from current region (2.5x viewport pad — small pans
      // don't refetch). Strict NaN/range guards so a transient junk
      // region from the native side never lands at the API.
      if (
        region &&
        Number.isFinite(region.latitude) &&
        Number.isFinite(region.longitude) &&
        Number.isFinite(region.latitudeDelta) &&
        Number.isFinite(region.longitudeDelta) &&
        Math.abs(region.latitude) <= 90 &&
        Math.abs(region.longitude) <= 180 &&
        region.latitudeDelta > 0 &&
        region.longitudeDelta > 0
      ) {
        const padLat = Math.max(0.1, region.latitudeDelta * 2.5);
        const padLng = Math.max(0.1, region.longitudeDelta * 2.5);
        params.sw_lat = Math.max(-89.9, region.latitude - padLat);
        params.sw_lng = Math.max(-179.9, region.longitude - padLng);
        params.ne_lat = Math.min(89.9, region.latitude + padLat);
        params.ne_lng = Math.min(179.9, region.longitude + padLng);
      }
      // Forward shoot_type filter (server side accepts it directly).
      if (filters.shoot_type) params.shoot_type = filters.shoot_type;
      if (filters.niche) params.shoot_type = filters.niche;
      const resp = await api.get('/spots/markers', params);
      // ─── markers diagnostic — HTTP latency ─────────────────────
      const _httpMs = Math.round(performance.now() - _markerPerfStart);
      const _itemCount = Array.isArray(resp?.items) ? resp.items.length : 0;
      exploreLog('info', 'markers_http_done', {
        http_ms: _httpMs,
        item_count: _itemCount,
        ms_since_map_open: mapOpenAt.current
          ? Math.round(performance.now() - mapOpenAt.current)
          : null,
      });
      if (ac.signal.aborted || !mapMountedRef.current) return;
      const items: any[] = Array.isArray(resp?.items) ? resp.items : [];
      // Hard-filter: drop any marker without a finite, in-range coord.
      // This is the LAST line of defense before we hand markers to
      // react-native-maps — one undefined lat there crashes Expo Go.
      const coerced = items
        .map((m) => {
          const lat = typeof m.lat === 'number' ? m.lat : m.latitude;
          const lng = typeof m.lng === 'number' ? m.lng : m.longitude;
          return { ...m, latitude: lat, longitude: lng };
        })
        .filter((m) =>
          Number.isFinite(m.latitude) &&
          Number.isFinite(m.longitude) &&
          Math.abs(m.latitude) <= 90 &&
          Math.abs(m.longitude) <= 180 &&
          // Spot ID must exist or we can't key the Marker stably.
          !!m.spot_id,
        );
      setMapMarkers(coerced);
      // ─── markers diagnostic — state committed ────────────────
      // setMapMarkers triggers a re-render; the next paint should
      // include the actual native Marker views. The gap between
      // this log and on-screen pins is the Fabric mounting transaction
      // cost (typically <100 ms even for ~200 markers).
      exploreLog('info', 'markers_state_committed', {
        marker_count: coerced.length,
        ms_since_map_open: mapOpenAt.current
          ? Math.round(performance.now() - mapOpenAt.current)
          : null,
      });
      exploreLog('info', 'markers_loaded', { count: coerced.length, hasBbox: !!region, expoGo: IS_EXPO_GO });
    } catch (e: any) {
      if (!ac.signal.aborted) exploreLog('warn', 'markers_load_error', { message: e?.message });
    } finally {
      if (markersInflight.current === ac) markersInflight.current = null;
    }
  }, [filters, view]);

  // Clear any open PinPreview when the user swaps view (list↔map),
  // changes filters, or the marker feed reloads. Holding a stale
  // marker reference across these transitions was suspected as one of
  // the Map View crash triggers (June 2025 report): the preview card
  // could try to render against a spot that's no longer in the marker
  // array, using fields that no longer exist on the swapped payload.
  useEffect(() => {
    setSelectedSpot(null);
  }, [view, filters.shoot_type, filters.niche, filters.is_premium, filters.is_hidden_gem]);

  // Initial markers fetch — fires once when user opens Map view, then
  // anytime the filters change. Lazy: only when view==='map' AND the
  // map has actually been mounted at least once.
  useEffect(() => {
    if (view !== 'map' || !mapEverMounted) {
      // Switching back to list — clear any pending region debounce so a
      // post-unmount fetch never fires.
      if (regionDebounce.current) {
        clearTimeout(regionDebounce.current);
        regionDebounce.current = null;
      }
      return;
    }
    loadMapMarkers(currentRegion.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, mapEverMounted, filters.shoot_type, filters.niche]);

  // Refresh when the Explore tab regains focus (e.g., after returning from
  // the Admin Cover Editor or Admin Spot Menu actions).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Request location on mount so the map opens tight and local, not a continent-wide view.
  // FIX(2026-04 Item #3 round 3): explicit GPS state machine so the
  // trust strip can show "Using current location" / "Location off /
  // Enable" + retry. Cached fresh coord (<5 min) skip re-prompt.
  const requestGPS = useCallback(async () => {
    setGpsState('requesting');
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (perm.status !== 'granted') {
        setGpsState('denied');
        exploreLog('warn', 'gps_denied', { status: perm.status });
        return;
      }
      // (Apr 2026 hardening) 5s timeout (down from 8s) so a hung GPS
      // handle never freezes the screen. Fall back to last-balanced
      // accuracy attempt if the high-accuracy race times out.
      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('gps_timeout')), 5000)),
      ]).catch(async () => {
        try {
          return await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
        } catch (e: any) {
          // Re-throw to outer catch so we land in the 'error' state.
          throw e;
        }
      });
      const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude, ts: Date.now() };
      if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
        // Defend against the OS handing back a NaN — extremely rare but
        // observed on jail-broken iOS where mock-location apps inject
        // junk. We refuse to apply junk coords, surfacing 'error' so the
        // Texas-wide fallback engages.
        throw new Error('gps_nan');
      }
      setUserCoords(coords);
      // Persist last-known coords so cold-start has a near-instant fallback
      // before the OS GPS handle resolves on the next session.
      try { AsyncStorage.setItem(LAST_KNOWN_KEY, JSON.stringify(coords)); } catch {}
      setGpsState('granted');
      exploreLog('info', 'gps_granted', { lat: coords.lat, lng: coords.lng });
      if (mapRef.current) {
        try {
          mapRef.current.animateToRegion({
            latitude: coords.lat, longitude: coords.lng,
            latitudeDelta: 0.45, longitudeDelta: 0.45,
          }, 300);
        } catch (e: any) {
          exploreLog('warn', 'animateToRegion_failed', { message: e?.message });
        }
      }
    } catch (e: any) {
      setGpsState('error');
      exploreLog('warn', 'gps_error', { message: e?.message });
    }
  }, []);

  useEffect(() => { requestGPS(); }, [requestGPS]);

  // (Apr 2026 hardening) When GPS is explicitly denied / errored, snap
  // the visible region to a Texas-wide view rather than leaving the
  // user stranded on the city-tight initialRegion. The map ref check
  // is required because animateToRegion fires before the native view
  // is mounted on cold-start.
  useEffect(() => {
    if ((gpsState === 'denied' || gpsState === 'error') && mapRef.current) {
      try {
        mapRef.current.animateToRegion(TEXAS_WIDE_REGION, 600);
      } catch (e: any) {
        exploreLog('warn', 'tx_fallback_animate_failed', { message: e?.message });
      }
    }
  }, [gpsState]);

  const goToCurrent = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        exploreLog('warn', 'goToCurrent_denied', { status });
        return;
      }
      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('gps_timeout')), 5000)),
      ]);
      if (!loc || !Number.isFinite(loc.coords?.latitude) || !Number.isFinite(loc.coords?.longitude)) {
        exploreLog('warn', 'goToCurrent_invalid_coords');
        return;
      }
      if (mapRef.current) {
        try {
          mapRef.current.animateToRegion({
            latitude: loc.coords.latitude, longitude: loc.coords.longitude,
            latitudeDelta: 0.3, longitudeDelta: 0.3,
          }, 400);
        } catch (e: any) {
          exploreLog('warn', 'goToCurrent_animate_failed', { message: e?.message });
        }
      }
    } catch (e: any) {
      exploreLog('warn', 'goToCurrent_error', { message: e?.message });
    }
  }, []);

  // Cleanup on unmount — abort in-flight fetch + clear debounce timer.
  useEffect(() => {
    return () => {
      if (inflightAbort.current) {
        try { inflightAbort.current.abort(); } catch {}
        inflightAbort.current = null;
      }
      if (regionDebounce.current) {
        clearTimeout(regionDebounce.current);
        regionDebounce.current = null;
      }
    };
  }, []);

  // Pin color tiering — communicate scouting value at a glance.
  const pinColor = (s: any): string => {
    const verified = s.owner?.verification_status === 'verified';
    const premium = s.privacy_mode === 'premium';
    const proven = (s.shoot_score || 0) >= 80 && (s.images?.length || 0) >= 3;
    if (premium) return '#9D59FF';          // Elite purple
    if (verified && proven) return '#10B981'; // Top-tier green
    if (verified) return colors.primary;     // Verified gold
    if (proven) return '#38BDF8';            // Proven blue
    if ((s.shoot_score || 0) < 60) return '#6B7280'; // Low score gray
    return '#F5A623';                         // Default gold
  };

  const activeCount = Object.values(filters).filter((v) => v != null && v !== false && v !== '').length;

  // Apr 2026 cleanup — simplified filter set per latest product
  // direction. Removed Golden Hour, Hidden Gems, season/time-of-day,
  // light-quality, and other micro-filters. Kept the 9 useful chips.
  const QUICK_CHIPS: Array<{ key: string; label: string; apply: () => void }> = [
    { key: 'all', label: 'All', apply: () => setFilters({}) },
    { key: 'nearby', label: 'Nearby', apply: () => setFilters((f) => ({ ...f, sort: 'distance' })) },
    { key: 'verified', label: 'Verified', apply: () => setFilters((f) => ({ ...f, verified: true })) },
    { key: 'new', label: 'New', apply: () => setFilters((f) => ({ ...f, new_only: true })) },
    { key: 'urban', label: 'Urban', apply: () => setFilters((f) => ({ ...f, niche: 'Urban' })) },
    { key: 'nature', label: 'Nature', apply: () => setFilters((f) => ({ ...f, niche: 'Nature' })) },
    { key: 'portrait', label: 'Portrait', apply: () => setFilters((f) => ({ ...f, niche: 'Portrait' })) },
    { key: 'wedding', label: 'Wedding', apply: () => setFilters((f) => ({ ...f, niche: 'Wedding' })) },
    { key: 'pet', label: 'Pet', apply: () => setFilters((f) => ({ ...f, niche: 'Pet' })) },
  ];
  const activeChip =
    filters.verified ? 'verified' :
    filters.new_only ? 'new' :
    filters.sort === 'distance' && !filters.niche ? 'nearby' :
    !filters.niche ? 'all' :
    String(filters.niche).toLowerCase();

  // (Apr 2026 hardening) Compute the renderable marker set ONCE per
  // `mapMarkers` change. The normalizer drops invalid coords / duplicates /
  // over-cap entries and emits debug breadcrumbs. Memoised so the marker
  // tree only re-renders when the data actually changes — not on every
  // map gesture (saved-id flips re-key from inside the marker render
  // path, not here).
  //
  // Explore Speed CR — Batch 3 (June 2025): source switched from the
  // legacy full /spots payload to the lightweight /spots/markers feed
  // (mapMarkers). When mapMarkers is empty (e.g. cold start before the
  // first /markers response lands), we fall back to the legacy `spots`
  // array so the user never sees an empty map during the swap.
  const mapMarkerData = useMemo(() => {
    const source = mapMarkers.length > 0 ? mapMarkers : spots;
    const result = normalizeSpotsForMap(source);

    // Coord dedupe (Phase 2 follow-up): if multiple spots round to the
    // same 5-decimal lat/lng (~1.1 m precision) we keep the first and
    // drop the rest. This stops the "three pins stacked on one pixel"
    // problem at e.g. Shavano Park. The dropped duplicates are still
    // discoverable via the list view + spot detail; they are NOT on
    // the map, and they are NOT clustered.
    const seen = new Set<string>();
    const deduped: typeof result.renderable = [];
    let stackedDropped = 0;
    for (const s of result.renderable) {
      if (!isValidCoordinate(s.latitude, s.longitude)) continue;
      const key = `${(s.latitude as number).toFixed(5)}_${(s.longitude as number).toFixed(5)}`;
      if (seen.has(key)) {
        stackedDropped += 1;
        continue;
      }
      seen.add(key);
      deduped.push(s);
    }

    // Stability hardening (Nov 2026 Phase 2): strict re-validation +
    // MAX_MARKERS cap on top of the existing normalizer + dedupe.
    const totalBeforeCap = deduped.length;
    const strictlyValid = deduped; // already strict-validated in the dedupe loop
    const strictDropped = (result.renderable.length - deduped.length) - stackedDropped;

    // Sort-by-nearest then slice. Center = current region if known,
    // else initialRegion seed.
    const center = currentRegion.current
      ? { latitude: currentRegion.current.latitude, longitude: currentRegion.current.longitude }
      : { latitude: initialRegion.latitude, longitude: initialRegion.longitude };
    const capped = pickNearest(strictlyValid, center, MAX_MARKERS);

    const trimmed = strictlyValid.length > capped.length;
    if (
      result.droppedInvalid > 0 ||
      result.droppedDuplicate > 0 ||
      result.droppedOverCap > 0 ||
      strictDropped > 0
    ) {
      exploreLog('warn', 'spots_normalised', {
        total: Array.isArray(source) ? source.length : 0,
        renderable: capped.length,
        droppedInvalid: result.droppedInvalid + strictDropped,
        droppedDuplicate: result.droppedDuplicate,
        droppedOverCap: result.droppedOverCap + (totalBeforeCap - capped.length),
        reasons: result.reasons,
        mapMarkerSource: mapMarkers.length > 0 ? 'lightweight' : 'legacy',
      });
      if (strictDropped > 0) {
        logSkippedOnce(
          `explore-strict:${mapMarkers.length || spots.length}`,
          strictDropped,
          totalBeforeCap,
        );
      }
    }
    return { ...result, renderable: capped, trimmedByCap: trimmed, totalCandidates: strictlyValid.length };
  }, [mapMarkers, spots, initialRegion]);

  // v2.0.21 — Pinch-zoom crash hardening (issue #2 from user report).
  //
  // Build a STABLE identity key from the marker set so we can memoize
  // the entire <Marker> JSX array. Without this, every onRegionChange
  // forces React to walk the array and reconcile each Marker — even
  // though the underlying spot data hasn't changed. During rapid
  // pinch-zoom, that reconcile churn accumulates marker mount/unmount
  // events into the native bridge faster than iOS can drain them →
  // common cause of `mutex lock failed` / `NSInvalidArgumentException`
  // crashes in react-native-maps on iOS.
  //
  // Identity is a simple concatenation of spot_ids (stable across
  // viewport pans because mapMarkerData.renderable only changes when
  // the underlying /spots/markers fetch returns new IDs).
  const markersIdentity = useMemo(
    () =>
      mapMarkerData.renderable
        .map((s) => s.spot_id || `${s.latitude}_${s.longitude}`)
        .join('|'),
    [mapMarkerData.renderable],
  );

  // Mirror userCoords into a ref so the memoized marker onPress
  // closures can read fresh GPS without invalidating the memo on
  // every coord update.
  const userCoordsRef = useRef(userCoords);
  useEffect(() => {
    userCoordsRef.current = userCoords;
  }, [userCoords]);

  // Build the memoized <Marker> children. Re-renders ONLY when:
  //   1. the marker identity set changes (new fetch),
  //   2. saved-state map changes (a star toggle),
  //   3. GPS first lands or drifts significantly.
  // Pan/zoom alone produces zero re-renders here — exactly what
  // we need for iOS pinch-zoom stability.
  // ANDROID MARKER VISIBILITY FIX (June 2025) — react-native-maps on
  // Android Google Maps captures the Marker's child view tree as a
  // bitmap ONCE at mount when `tracksViewChanges={false}`. The catch:
  // on Android the capture sometimes happens BEFORE the React Native
  // view tree has finished laying out the children, producing
  // invisible 0×0 markers (this is why iOS shows 38 pins but Android
  // shows none — same backend response, different native capture
  // semantics). The fix: start with tracksViewChanges=true on Android
  // so the bitmap re-captures on every layout pass, then flip to
  // false after the layout settles. iOS keeps the synchronous-once
  // path since it's been working there.
  const [androidMarkersTracking, setAndroidMarkersTracking] = useState(
    Platform.OS === 'android',
  );
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!mapNativeReady) return;
    // Re-enter tracking briefly when the marker set changes so each
    // new batch gets a fresh layout-then-bitmap pass, then freeze.
    setAndroidMarkersTracking(true);
    const t = setTimeout(() => setAndroidMarkersTracking(false), 800);
    return () => clearTimeout(t);
  }, [markersIdentity, mapNativeReady]);

  const renderedMarkers = useMemo(
    () =>
      mapMarkerData.renderable.map((s, idx) => (
        <Marker
          key={String(s.spot_id || `m-${idx}-${s.latitude}-${s.longitude}`)}
          coordinate={{ latitude: s.latitude, longitude: s.longitude }}
          // STABILITY HARDENING (Nov 2026 Phase 2 follow-up):
          //   • NO child JSX inside <Marker> — uses stock native pin.
          //   • `pinColor` is the ONLY visual customization allowed.
          //   • Custom views, nested touchables, animated children, and
          //     gradient circles are forbidden until the iOS/Android
          //     stability pass is proven across the full test matrix.
          //   • tracksViewChanges intentionally NOT set — stock pins
          //     don't need bitmap snapshotting.
          pinColor={savedIds[s.spot_id] ? '#d04848' : '#f5a623'}
          onPress={() => {
            try {
              if (!s || !s.spot_id ||
                  !Number.isFinite(s.latitude) ||
                  !Number.isFinite(s.longitude)) {
                exploreLog('warn', 'marker_tap_rejected', {
                  spot_id: s?.spot_id, lat: s?.latitude, lng: s?.longitude,
                });
                return;
              }
              Haptics.selectionAsync().catch(() => {});
              const uc = userCoordsRef.current;
              const enriched = (() => {
                if (!uc?.lat || !uc?.lng) return s;
                const mi = calculateDistanceMiles(uc.lat, uc.lng, s.latitude, s.longitude);
                return mi == null ? s : { ...s, distance_mi: mi };
              })();
              setSelectedSpot(enriched);
            } catch (e) {
              if (__DEV__) {
                // eslint-disable-next-line no-console
                console.warn('[explore] marker onPress threw:', e);
              }
            }
          }}
          testID={`marker-${s.spot_id || idx}`}
        />
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markersIdentity, savedIds],
  );

  // ─── Park-Based Multi-Spot Workflow · Phase 4 ─────────────────────
  // Parent-park markers at low zoom. When the viewport is regional
  // scale (latitudeDelta > PARK_LAYER_THRESHOLD), we hide individual
  // child-spot markers and show one marker per parent park instead.
  // This is NOT clustering — these are first-class data records from
  // /api/parks/search. Child spots remain individually tappable as
  // soon as the user zooms in past the threshold.
  const PARK_LAYER_THRESHOLD = 0.5;       // ≈ 55 km lat span; metro-region zoom
  const PARK_LAYER_FETCH_MS = 2500;       // mirror the spot-markers throttle
  const [parkMarkers, setParkMarkers] = useState<any[]>([]);
  const [parksLayerVisible, setParksLayerVisible] = useState(false);
  const lastParkFetchAt = useRef<number>(0);
  const parkFetchInflight = useRef<AbortController | null>(null);

  const loadParkMarkers = useCallback(async (region?: any) => {
    if (view !== 'map') return;
    const now = Date.now();
    if (now - lastParkFetchAt.current < PARK_LAYER_FETCH_MS) return;
    if (
      !region ||
      !Number.isFinite(region.latitude) ||
      !Number.isFinite(region.longitude) ||
      !Number.isFinite(region.latitudeDelta) ||
      region.latitudeDelta <= 0
    ) return;
    if (parkFetchInflight.current) {
      try { parkFetchInflight.current.abort(); } catch {}
    }
    const ac = new AbortController();
    parkFetchInflight.current = ac;
    lastParkFetchAt.current = now;
    try {
      // Use search's near_lat/near_lng + a radius proportional to the
      // current viewport so we only fetch parks that could plausibly
      // show on screen. Capped at 200 km to keep payloads small.
      const radiusKm = Math.min(200, Math.max(20, region.latitudeDelta * 111 * 1.2));
      const r = await api.get('/parks/search', {
        near_lat: region.latitude,
        near_lng: region.longitude,
        radius_km: radiusKm,
        limit: 50,
      });
      if (ac.signal.aborted || !mapMountedRef.current) return;
      const items = (Array.isArray(r) ? r : []).filter((p: any) =>
        // Strict validator — rejects string coords / NaN / out-of-range
        // and keeps the combined budget under MAX_MARKERS (parks and
        // spots are mutually exclusive on screen, never both).
        isValidCoordinate(p?.latitude, p?.longitude) &&
        !!p?.park_id,
      ).slice(0, MAX_MARKERS);
      setParkMarkers(items);
    } catch {}
  }, [view]);

  // Render park markers, memoized on the park identity set so pan/zoom
  // alone doesn't churn the JSX tree.
  const parkMarkersIdentity = useMemo(
    () => parkMarkers.map((p) => p.park_id).join('|'),
    [parkMarkers],
  );
  const renderedParkMarkers = useMemo(
    () =>
      parkMarkers.map((p, idx) => (
        <Marker
          key={`park-${p.park_id || idx}`}
          coordinate={{ latitude: p.latitude, longitude: p.longitude }}
          // STABILITY HARDENING (Nov 2026 Phase 2 follow-up):
          //   • Stock pin only. No <ParkMapPin> child — that was reading
          //     as a cluster bubble in the field.
          //   • This layer is currently DISABLED at the JSX render site
          //     (see comment block where renderedMarkers is rendered).
          //   • No special tap handler: routes straight to the park
          //     detail page.
          pinColor={'#f5a623'}
          onPress={() => {
            try {
              Haptics.selectionAsync().catch(() => {});
              router.push(`/park/${p.park_id}` as any);
            } catch (e) {
              if (__DEV__) {
                // eslint-disable-next-line no-console
                console.warn('[explore] park marker onPress threw:', e);
              }
            }
          }}
          testID={`park-marker-${p.park_id}`}
        />
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parkMarkersIdentity],
  );

  // v2.0.21 — Build environment diagnostic.
  // Logged once at mount so we can confirm in Xcode / Console.app
  // that the TestFlight build was bundled against the expected
  // backend URL. The most common iOS image-load failure is the
  // build was bundled with EXPO_PUBLIC_BACKEND_URL=undefined (.env
  // not picked up by EAS). When that happens, every uploaded photo
  // URL becomes "/api/uploads/..." (relative) which iOS silently
  // refuses to load — looking like "photos not populating" even
  // though the backend is healthy.
  useEffect(() => {
    try {
      const envBackend = (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) || '(empty)';
      // V3 (May 2026) — also log the `extra` fallback so we can confirm
      // the app.config.js mirror is active. After the production-build
      // image regression, the bundled config carries the canonical URL
      // even when .env wasn't read by the EAS server.
      const extraBackend = (Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL as string | undefined) || '(empty)';
      const owner = (Constants as any)?.appOwnership || '(none)';
      const exec = (Constants as any)?.executionEnvironment || '(none)';
      // eslint-disable-next-line no-console
      console.log('[explore] build_diagnostics', {
        backend_env: envBackend,
        backend_extra: extraBackend,
        backend_resolved: envBackend !== '(empty)' ? envBackend : extraBackend,
        appOwnership: owner,
        executionEnvironment: exec,
        isExpoGo: IS_EXPO_GO,
        platform: Platform.OS,
      });
    } catch {}
  }, []);

  // (Apr 2026 hardening) Debounced region-change handler. Without this,
  // every micro-pan fires a setState which forces a re-render of the
  // marker tree on Android. 300ms hits the sweet spot — fast enough that
  // the "Search this area" CTA feels responsive, slow enough that flick-
  // panning doesn't burn frames.
  const handleRegionChangeComplete = useCallback((region: any) => {
    // Stash latest region synchronously so taps on the "Search this area"
    // CTA always read the freshest center, even if the debounce hasn't
    // fired yet.
    if (
      region &&
      Number.isFinite(region.latitude) &&
      Number.isFinite(region.longitude)
    ) {
      currentRegion.current = region;
    } else {
      // The native module very rarely yields a malformed region during
      // map-mount. Ignore — never set state on garbage.
      exploreLog('debug', 'region_invalid_ignored', { region });
      return;
    }
    if (regionDebounce.current) clearTimeout(regionDebounce.current);
    regionDebounce.current = setTimeout(() => {
      // Explore Speed CR — Batch 3 (June 2025): refetch lightweight
      // markers when the user pans/zooms far enough from the last
      // anchor. Threshold is 30% of the current viewport delta — i.e.
      // a noticeable scroll, not a hairline twitch. Bbox params on
      // /spots/markers ensure we only ever ship pins for the current
      // viewport (huge perf win on dense areas like NYC / SF).
      if (!lastLoadCenter.current) {
        lastLoadCenter.current = { lat: region.latitude, lng: region.longitude };
        // First emit — if mapMarkers hasn't been hydrated yet, kick
        // off a bbox-aware fetch now that we know the region.
        if (mapMarkers.length === 0 && view === 'map') {
          loadMapMarkers(region);
        }
        // Phase 4: also drive the park-layer visibility + fetch on the
        // very first region emit so a fresh-mount low-zoom view shows
        // parks immediately.
        const initialParksVisible = region.latitudeDelta > PARK_LAYER_THRESHOLD;
        setParksLayerVisible(initialParksVisible);
        if (initialParksVisible && view === 'map') loadParkMarkers(region);
        return;
      }
      // Phase 4 — update park-layer visibility based on current zoom.
      // We only refetch the parks dataset when the layer becomes visible
      // OR the user pans meaningfully within the layer's zoom band; the
      // spot-marker code path below handles the "search this area"
      // motion separately.
      const parksVisibleNow = region.latitudeDelta > PARK_LAYER_THRESHOLD;
      setParksLayerVisible(parksVisibleNow);
      if (parksVisibleNow && view === 'map') {
        loadParkMarkers(region);
      }
      const dLat = Math.abs(region.latitude - lastLoadCenter.current.lat);
      const dLng = Math.abs(region.longitude - lastLoadCenter.current.lng);
      const threshold = Math.max(region.latitudeDelta, region.longitudeDelta) * 0.3;
      if (dLat > threshold || dLng > threshold) {
        setShowSearchArea(true);
        // Also opportunistically prefetch the lightweight markers for
        // the new viewport so that when the user taps "Search this area"
        // the pins are already there. Only does this when we're on the
        // map view; the list view doesn't care about marker churn.
        if (view === 'map') {
          lastLoadCenter.current = { lat: region.latitude, lng: region.longitude };
          loadMapMarkers(region);
        }
      }
    }, 350);
  }, [view, mapMarkers.length, loadMapMarkers, loadParkMarkers]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ExploreErrorBoundary
        spotsCount={Array.isArray(spots) ? spots.length : 0}
        activeFilters={filters as any}
        onReset={() => {
          // On reset, refetch /spots so a stale-data crash doesn't loop.
          load();
        }}
      >
      {/* Premium header — matches Apr 2026 Explore PRD */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>EXPLORE</Text>
          <Text style={styles.headerTitle}>Find great places near you</Text>
        </View>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.push('/search')} testID="explore-search-icon">
          <Search size={18} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerBtn} onPress={() => setFilterOpen(true)} testID="explore-filters">
          <SlidersHorizontal size={18} color={colors.text} />
          {activeCount > 0 ? <View style={styles.badgeDot}><Text style={styles.badgeDotTxt}>{activeCount}</Text></View> : null}
        </TouchableOpacity>
      </View>

      {/* CR #1 Item 1 (June 2025): List | Map segmented toggle.
          Defaults to List for faster first paint. Map is lazy-mounted only
          on first toggle (mapEverMounted) so cold-start never pays the
          native-map bootstrap cost. */}
      <View style={styles.segWrap}>
        <View style={styles.seg}>
          <TouchableOpacity
            style={[styles.segBtn, view === 'list' && styles.segBtnActive]}
            onPress={() => switchView('list')}
            testID="explore-view-list"
            activeOpacity={0.85}
          >
            <List size={14} color={view === 'list' ? colors.primary : colors.textSecondary} />
            <Text style={[styles.segTxt, view === 'list' && styles.segTxtActive]}>List</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segBtn, view === 'map' && styles.segBtnActive]}
            onPress={() => switchView('map')}
            testID="explore-view-map"
            activeOpacity={0.85}
          >
            <MapIcon size={14} color={view === 'map' ? colors.primary : colors.textSecondary} />
            <Text style={[styles.segTxt, view === 'map' && styles.segTxtActive]}>Map</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* (Apr 2026) Map/List segmented toggle removed — Explore is map-only.
          Keeping the location chip row immediately below the search header
          gives the map ~44px more vertical room and a cleaner, premium feel. */}

      {/* (Apr 2026) Compact location row — Apr 2026 cleanup pass:
          removed redundant "25 mi" chip that was misleading (looked like
          a radius selector but actually just opened the filters modal).
          Radius now lives inside the filters modal. Order: Location | Category. */}
      <View style={styles.locRow}>
        <View style={styles.locChip}>
          <MapPin size={12} color={colors.primary} />
          <Text style={styles.locChipTxt}>San Antonio, TX</Text>
        </View>
        <TouchableOpacity
          style={[styles.locChip, filters.niche ? styles.locChipActive : null]}
          onPress={() => setNicheOpen((v) => !v)}
          testID="explore-niche"
        >
          <Text style={[styles.locChipTxt, filters.niche ? { color: colors.primary } : null]}>
            {filters.niche
              ? (filters.niche === 'golden' ? 'Golden' : String(filters.niche))
              : 'All'}
          </Text>
          <Text style={styles.locChipChev}>▾</Text>
        </TouchableOpacity>
      </View>

      {/* Niche dropdown — only mounts when toggled. In LIST mode we
          continue showing the full chip rail below; in MAP mode this
          dropdown is the sole filter surface, saving ~44px of vertical
          space (≈35% of the previous header height). */}
      {(view === 'list' || nicheOpen) ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, maxHeight: 44 }}
          contentContainerStyle={styles.chipRow}
        >
          {QUICK_CHIPS.map((c) => {
            const active = activeChip === c.key.toLowerCase();
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => { c.apply(); if (view === 'map') setNicheOpen(false); }}
                style={[styles.chip, active && styles.chipActive]}
                testID={`explore-chip-${c.key}`}
              >
                <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      {/* (FIX 2026-05) Persistent error pill — appears when a /spots
          fetch fails. PRD requirement: "If a secondary request fails,
          show a smaller non-blocking warning only where appropriate."
          On the MAP view the markers are served by a separate slim
          endpoint (/spots/markers) — when those have loaded the pins
          are already visible and useful, so a /spots failure here is
          purely a metadata-layer miss and should NOT block the user
          with a big red banner. We hide the banner on map view when
          markers are present; we still show it on list view (where
          /spots IS the primary data) and on map when markers also
          haven't loaded yet (true offline / hard failure). */}
      {loadError && !(view === 'map' && mapMarkers.length > 0) ? (
        <TouchableOpacity
          onPress={load}
          activeOpacity={0.8}
          testID="explore-retry"
          style={styles.errorPill}
        >
          <Text style={styles.errorPillTxt} numberOfLines={1}>
            Couldn't load spots — Tap to retry
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* (FIX P1-3 pre-release audit) Web is currently in list-fallback
          mode because the web map provider hasn't shipped yet. Surface a
          small contextual hint so desktop visitors understand why the
          map isn't interactive. Mobile users never see this. */}
      {Platform.OS === 'web' ? (
        <View style={styles.webHint} testID="explore-web-hint">
          <Text style={styles.webHintTxt}>
            Map view is mobile-only for now — showing list. Open LumaScout on iOS / Android for the full map.
          </Text>
        </View>
      ) : null}

      {/* (Apr 2026 hardening) Inline location-off hint — appears above
          the map when GPS permission is denied or errored out. Tappable
          to retry; non-blocking (the map still renders the Texas-wide
          fallback region behind it). Mobile-only — web doesn't show
          the map at all. */}
      {Platform.OS !== 'web' && (gpsState === 'denied' || gpsState === 'error') ? (
        <Pressable
          onPress={requestGPS}
          style={styles.locOffHint}
          testID="explore-loc-off-hint"
          accessibilityLabel="Enable location for nearby spots"
        >
          <MapPin size={12} color={colors.primary} />
          <Text style={styles.locOffHintTxt} numberOfLines={1}>
            Enable location for nearby spots
          </Text>
          <Text style={styles.locOffHintCta}>Enable</Text>
        </Pressable>
      ) : null}

      {view === 'map' && Platform.OS !== 'web' && !mapEverMounted ? (
        // Android stabilization: show a clean loading state during the
        // 350ms post-toggle defer window so the user sees immediate
        // feedback instead of a momentarily blank surface.
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 12, marginTop: 10 }}>
            Loading map…
          </Text>
        </View>
      ) : null}

      {view === 'map' && mapEverMounted && Platform.OS !== 'web' && (ClusteredMapView || MapView) ? (
        <MapErrorBoundary onViewList={() => setView('list')}>
          <View style={{ flex: 1 }}>
            {mapMarkerData.trimmedByCap && (
              <View style={styles.trimBanner} testID="map-trim-banner">
                <Text style={styles.trimBannerTxt}>
                  Showing nearest {MAX_MARKERS} spots. Zoom or search to narrow results.
                </Text>
              </View>
            )}
            {React.createElement(
              SafeMapView,
              {
                ref: mapRef,
                style: { flex: 1 },
                initialRegion: initialRegion,
              // ANDROID STABILIZATION (June 2025): explicitly use the
              // Google Maps provider on Android. The default provider
              // is a legacy native module that's incompatible with
              // Fabric / New Architecture and crashes the activity on
              // physical Android devices despite working in emulators.
              // iOS is left undefined so react-native-maps falls back
              // to the native Apple Maps provider (default behavior).
              provider: Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined,
              // ANDROID STABILIZATION (June 2025): three native props
              // were strongly suspected as the Android crash trigger:
              //
              //   1. `userInterfaceStyle: 'dark'` — this is iOS-only on
              //      react-native-maps. On Android the prop is ignored
              //      by docs but in 1.20.1 has been observed to crash
              //      when combined with custom marker children under
              //      Fabric. We now omit it on Android.
              //
              //   2. `customMapStyle: MAP_STYLE_DARK` — Google Maps SDK
              //      on Android parses the JSON style array natively.
              //      A malformed entry (or one referencing a feature
              //      type not supported on the device's Play Services
              //      version) can crash the GoogleMap surface. We omit
              //      on Android until we can validate the style on
              //      multiple Android Play Services builds.
              //
              //   3. `showsUserLocation: true` mounted BEFORE the
              //      ACCESS_FINE_LOCATION runtime permission grant.
              //      On Android this can crash the FusedLocationProvider
              //      attachment on the GoogleMap surface — gating it
              //      on `gpsState === 'granted'` ensures the prop is
              //      only set after the user explicitly accepts.
              //
              // iOS keeps all three props (still wanted there for the
              // premium dark theme and one-tap re-center button).
              userInterfaceStyle: Platform.OS === 'ios' ? 'dark' : undefined,
              showsUserLocation: Platform.OS === 'ios' ? true : (gpsState === 'granted'),
              showsMyLocationButton: false,
              // Premium dark theme — only applies on Standard map type;
              // Apple/Google ignore custom styles in hybrid/satellite modes.
              // Android: omitted entirely until we can rule it out as a
              // crash trigger and re-enable in a controlled rollout.
              customMapStyle: (Platform.OS === 'ios' && mapType === 'standard') ? MAP_STYLE_DARK : undefined,
              mapType: mapType,
              // STABILITY (Nov 2026): clustering removed. All cluster-shaped
              // props that used to live here (clusterColor, clusterTextColor,
              // clusterFontFamily, radius, spiderLineColor, animationEnabled,
              // renderCluster) were silently dropped by SafeClusteredMapView
              // and would never run again — they've been deleted to make
              // the no-clustering contract obvious in the source.
              // Expo Go stability (June 2025): pause aggressive marker
              // refetches while the user is actively touching the map.
              // The onRegionChangeComplete will resume once they release.
              onTouchStart: () => { isMapInteractingRef.current = true; },
              onTouchEnd: () => { isMapInteractingRef.current = false; },
              onTouchCancel: () => { isMapInteractingRef.current = false; },
              // May 2026 (Mac Catalyst crash fix): MapView fires
              // onMapReady once its native child container is fully
              // realized. Until that callback runs, mounting Markers
              // races Fabric's `RCTLegacyViewManagerInteropComponentView
              // ::finalizeUpdates → __NSArrayM insertObject:atIndex:`
              // and crashes the app on Mac Catalyst (and intermittently
              // on iOS). Flipping `mapNativeReady` here defers Marker
              // mount to a clean transaction.
              onMapReady: () => {
                if (!mapNativeReady) {
                  setMapNativeReady(true);
                  exploreLog('info', 'map_native_ready', {
                    // Phase E diagnostic: time from user-tap to native
                    // map-ready. If this is >800 ms on prod we know
                    // MapView itself is the slow bit (Catalyst-arch
                    // initial-tile render usually 50-200 ms).
                    ms_since_map_open: mapOpenAt.current
                      ? Math.round(performance.now() - mapOpenAt.current)
                      : null,
                  });
                }
              },
              onRegionChangeComplete: handleRegionChangeComplete,
            },
            // v2.0.21 — Use the memoized markers array instead of mapping
            // mapMarkerData.renderable inline. This is the single biggest
            // win for iOS pinch-zoom stability: marker JSX is reconciled
            // ONLY when the underlying spot identity set or saved-state
            // changes, never on viewport pan/zoom.
            //
            // May 2026: gate on `mapNativeReady` so we only push the
            // Markers array into the JSX tree AFTER MapView has fired
            // onMapReady (i.e. the native child container is realized).
            // This eliminates the Mac-Catalyst crash where Fabric's
            // interop shim called insertObject:atIndex: on a
            // not-yet-fully-mounted parent's child array.
            //
            // STABILITY HARDENING (Nov 2026 Phase 2 follow-up):
            //   • Parent-park markers (Phase 4) are DISABLED while we
            //     prove iOS + Android stability with stock pins only.
            //   • Even though the data is correct (1 marker per park
            //     row, not a cluster), the visual was reading as a
            //     cluster bubble in the field and could be confused
            //     with the old clustering behavior.
            //   • To re-enable: replace `renderedMarkers` below with
            //     `(parksLayerVisible ? renderedParkMarkers : renderedMarkers)`
            //     and audit ParkMapPin to ensure it's still child-free.
            mapNativeReady ? renderedMarkers : null
          )}

          {/* Apr 2026 cleanup — trending floating chip removed per
              latest product direction (cleaner Apple-Maps feel,
              fewer noisy banners on the map surface). */}

          {/* Floating "Search this area" CTA — surfaces after the user pans */}
          {showSearchArea ? (
            <TouchableOpacity
              style={styles.searchAreaCta}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                if (currentRegion.current) {
                  lastLoadCenter.current = {
                    lat: currentRegion.current.latitude,
                    lng: currentRegion.current.longitude,
                  };
                }
                setShowSearchArea(false);
                load();
              }}
              testID="explore-search-area"
              activeOpacity={0.85}
            >
              <RefreshCw size={14} color="#1a1300" />
              <Text style={styles.searchAreaTxt}>Search this area</Text>
            </TouchableOpacity>
          ) : null}

          {/* Glassmorphism FAB stack — Recenter / Layers / Toggle list */}
          <View style={styles.floatControls}>
            <TouchableOpacity
              style={styles.fabGlass}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                goToCurrent();
              }}
              testID="explore-locate"
            >
              <Locate size={18} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fabGlass}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setMapType((t) => (t === 'standard' ? 'hybrid' : 'standard'));
              }}
              testID="explore-layers"
            >
              <Layers size={18} color={mapType === 'hybrid' ? colors.primary : colors.text} />
            </TouchableOpacity>
            {/* (Apr 2026) Removed list-toggle FAB — Explore is map-only now. */}
          </View>

          {selectedSpot && !!selectedSpot.spot_id && (
            // Section-scoped crash boundary — June 2025 Map View CR.
            // If PinPreview throws during render (malformed marker,
            // missing field, image error propagation), we swallow the
            // error, log it, and keep the map itself mounted. The user
            // can still pan/zoom; they just lose the preview card for
            // that one spot. Previously a single bad render could take
            // down the entire Explore tab with a red screen.
            <SectionErrorBoundary
              label="map-pin-preview"
              fallback={null}
            >
              <PinPreview
                spot={selectedSpot}
                userCoords={userCoords ? { latitude: userCoords.lat, longitude: userCoords.lng } : null}
                onClose={() => setSelectedSpot(null)}
                isSaved={!!savedIds[selectedSpot.spot_id]}
                onToggleSave={() => {
                  const id = selectedSpot.spot_id;
                  if (!id) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setSavedIds((prev) => ({ ...prev, [id]: !prev[id] }));
                  api.post(`/spots/${id}/save`).catch(() => {
                    // Roll back optimistic state on error
                    setSavedIds((prev) => ({ ...prev, [id]: !prev[id] }));
                  });
                }}
              />
            </SectionErrorBoundary>
          )}
        </View>
        </MapErrorBoundary>
      ) : (
        <View style={{ flex: 1 }}>
          {/* Explore Speed CR — Batch 2 (June 2025): skeleton card stack
              for initial load + infinite scroll for pagination. The
              `loading` flag is the legacy /spots fetch (still feeds the
              map view); for the LIST we look at `listLoadingInitial &&
              listSpots.length === 0` so cached-from-AsyncStorage
              hydration shows immediately and avoids a flash. */}
          {(loading && spots.length === 0 && listSpots.length === 0) || (listLoadingInitial && listSpots.length === 0) ? (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
              showsVerticalScrollIndicator={false}
            >
              <SkeletonSpotList count={6} />
            </ScrollView>
          ) : (listSpots.length === 0 && spots.length === 0) ? (
            <EmptyState title="No spots match" subtitle="Loosen your filters to see more." />
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 120 }}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <BrandedRefreshControl
                  refreshing={listPullRefresh.refreshing}
                  onRefresh={listPullRefresh.onRefresh}
                />
              }
              onScroll={(e) => {
                const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                const distanceFromBottom =
                  contentSize.height - contentOffset.y - layoutMeasurement.height;
                if (distanceFromBottom < 600 && listHasMore && !listLoadingMore) {
                  loadListNextPage();
                }
              }}
              scrollEventThrottle={150}
            >
              {/* Smart alert chip — surfaces newly-added spots */}
              <SmartAlertChip
                count={Math.min(2, spots.filter((s) => s.is_new).length || 2)}
                onPress={() => router.push('/search' as any)}
              />

              {/* GPS trust strip — Apr 2026 Item #3 round 3.
                  Tells the user whether 'Nearby Right Now' values are
                  computed from real device GPS or unavailable. Includes
                  a retry CTA when denied/error. */}
              <View style={styles.gpsTrust}>
                <MapPin
                  size={11}
                  color={gpsState === 'granted' ? '#22c55e' : gpsState === 'requesting' ? colors.primary : colors.textTertiary}
                />
                <Text style={[
                  styles.gpsTrustTxt,
                  gpsState === 'granted' && { color: '#22c55e' },
                  gpsState === 'requesting' && { color: colors.primary },
                ]}>
                  {gpsState === 'granted'
                    ? 'Using your current location'
                    : gpsState === 'requesting'
                      ? 'Locating you…'
                      : gpsState === 'denied'
                        ? 'Location access off · enable for accurate nearby spots'
                        : 'Distance unavailable'}
                </Text>
                {gpsState !== 'granted' && gpsState !== 'requesting' ? (
                  <Pressable onPress={requestGPS} hitSlop={8}>
                    <Text style={styles.gpsRetry}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>

              {/* Section 1 — Nearby Right Now (3 stacked premium cards).
                  Fed from `nearbySortedSpots` (GPS closest-first) so the
                  top 3 are literally the 3 nearest when location is on. */}
              <NearbyRightNowList items={nearbySortedSpots} />

              {/* Section 2 — Trending Nearby (#1 / #2 / #3 medals) */}
              <TrendingNearbyList
                items={[...spots]
                  .sort((a, b) => (b.shoot_score || 0) - (a.shoot_score || 0))
                  .slice(0, 3)}
              />

              {/* Section 3 — Golden Hour Tonight (horizontal sunset rail) */}
              <GoldenHourRail
                items={[...spots]
                  .filter((sp) => (sp.evening_golden_hour_rating || 0) >= 3 || (sp.sunset_rating || 0) >= 3)
                  .sort(
                    (a, b) =>
                      (b.evening_golden_hour_rating || 0) -
                      (a.evening_golden_hour_rating || 0),
                  )
                  .slice(0, 8)}
              />

              {/* Section 4 — Photo Parks rail (parks with 2+ child spots).
                  Park-Based Multi-Spot Workflow · Phase 3. Self-renders
                  null if there are no parks worth surfacing. */}
              <ParksRail
                nearLat={userCoords?.lat ?? null}
                nearLng={userCoords?.lng ?? null}
              />

              {/* Tail — full editorial cards for the long-tail browse */}
              <View
                style={{
                  paddingHorizontal: space.xl,
                  marginTop: 22,
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontFamily: font.bodyMedium,
                    fontSize: 11,
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                  }}
                >
                  All Nearby Spots
                </Text>
              </View>
              <View style={{ paddingHorizontal: 12, gap: space.md }}>
                {/* Explore Speed CR — Batch 2 (June 2025): paginated list
                    sourced from `listSpots`. Backend already sorts by
                    distance when GPS granted (sort=distance + lat/lng),
                    else by quality. We DON'T re-sort client-side here
                    so the paged appends slot in cleanly behind the
                    existing items.

                    Fallback: if listSpots is empty (e.g. legacy code path
                    populated `spots` first), we fall back to
                    `nearbySortedSpots.slice(0, 24)` so cards still show. */}
                {(listSpots.length > 0 ? listSpots : nearbySortedSpots.slice(0, 24)).map((item, idx) => (
                  <SpotCard
                    key={
                      item?.spot_id ||
                      `fallback-${idx}-${(item && item.title) || 'untitled'}`
                    }
                    spot={item}
                    compact
                    testID={`list-spot-${item?.spot_id || `fallback-${idx}`}`}
                  />
                ))}
                {/* Pagination footer — small skeleton stack while loading
                    next page so the user sees "more is coming" without
                    a jarring spinner takeover. */}
                {listLoadingMore ? (
                  <SkeletonSpotList count={2} />
                ) : null}
                {!listHasMore && listSpots.length > 8 ? (
                  <View style={{ alignItems: 'center', paddingVertical: 18 }}>
                    <Text style={{ color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                      That's everything for now
                    </Text>
                  </View>
                ) : null}
              </View>
            </ScrollView>
          )}
          {/* CR Item 11 (May 2026) — "Updated just now" toast for the
              List view branded refresh. Rendered at the screen-level
              wrapper so it floats above ScrollView contents. */}
          <listPullRefresh.Toast />
          {/* (Apr 2026) Map-toggle FAB removed — Explore is dedicated map. */}
        </View>
      )}

      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onApply={(f) => { setFilters(f); setFilterOpen(false); }}
      />
      </ExploreErrorBoundary>
    </SafeAreaView>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color: colors.textInverse, fontFamily: font.bodyMedium, fontSize: 9 }}>{label}</Text>
    </View>
  );
}

/**
 * PinPreviewPlanning — golden hour, blue hour, and drive-time
 * countdown band shown inside the map preview card.
 *
 * Ticks every 60 s while mounted (i.e. while a pin is selected).
 * Computations are O(1) (suncalc + haversine) and memoised by the
 * sun-windows minute-bucket cache, so a snappy preview opens in <1ms.
 */
function PinPreviewPlanning({
  spotLat, spotLng, userCoords,
}: {
  spotLat?: number | null;
  spotLng?: number | null;
  userCoords?: { latitude: number; longitude: number } | null;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const hasSpot = typeof spotLat === 'number' && typeof spotLng === 'number';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const golden = useMemo(
    () => (hasSpot ? goldenHourBrief(spotLat as number, spotLng as number) : null),
    [spotLat, spotLng, tick],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const blue = useMemo(
    () => (hasSpot ? blueHourBrief(spotLat as number, spotLng as number) : null),
    [spotLat, spotLng, tick],
  );
  const drive = useMemo(
    () => driveTimeEstimate(
      userCoords,
      hasSpot ? { latitude: spotLat as number, longitude: spotLng as number } : null,
    ),
    [userCoords, spotLat, spotLng, hasSpot],
  );

  return (
    <View style={styles.planningBand}>
      <View style={styles.planningRowLine}>
        <Sun size={11} color={colors.primary} />
        <Text style={styles.planningGold} numberOfLines={1}>
          {golden ?? 'Golden hour unavailable'}
        </Text>
      </View>
      <View style={styles.planningRowLine}>
        <Sun size={11} color="#60A5FA" />
        <Text style={styles.planningBlue} numberOfLines={1}>
          {blue ?? 'Blue hour unavailable'}
        </Text>
      </View>
      <View style={styles.planningRowLine}>
        <Navigation size={11} color={colors.textSecondary} />
        <Text style={styles.planningDrive} numberOfLines={1}>
          {drive ? drive.label : 'Drive time unavailable'}
        </Text>
      </View>
    </View>
  );
}

function PinPreview({
  spot,
  onClose,
  isSaved,
  onToggleSave,
  userCoords,
}: {
  spot: any;
  onClose: () => void;
  isSaved?: boolean;
  onToggleSave?: () => void;
  /** User's GPS, when available — drives the "Approx. X min drive"
   *  estimate. When null/undefined we render "Drive time unavailable". */
  userCoords?: { latitude: number; longitude: number } | null;
}) {
  const verified = spot.owner?.verification_status === 'verified';
  const premium = spot.privacy_mode === 'premium';
  // Unified cover resolver (Map View CR — June 2025). Handles both
  // lightweight markers (top-level `thumb_url` from /api/spots/markers)
  // and full spots (`hero_cover_image_url`, `images[]`). Absolutizes
  // app-relative paths so React Native's <Image> can render them.
  const cover = resolveSpotCover(spot);
  // FIX (June 2025 v2.0.20 — Map preview missing photos, recurrence #2):
  // Track image load failure per-preview so a 404/CDN-timeout/ATS-rejection
  // unmounts the <Image> and reveals the gradient fallback layered
  // beneath. Reset whenever the cover URL or selected spot changes so
  // a previous failure doesn't poison the next preview.
  const [imgFailed, setImgFailed] = React.useState(false);
  React.useEffect(() => {
    setImgFailed(false);
  }, [cover, spot?.spot_id]);
  // FIX (Apr 2026): no more fake "100 Score / Best at Sunset" on every
  // preview. Both are now gated on real backend data — if the field is
  // missing we hide the module entirely rather than fabricating. Score
  // only renders when the backend actually returned a shoot_score AND
  // it's not the defaulted 100 ceiling. Best-at chips only render when
  // the specific golden-hour rating is explicitly set AND >= 4.
  const hasRealScore =
    typeof spot.shoot_score === 'number' && spot.shoot_score > 0 && spot.shoot_score < 100;
  const score = hasRealScore ? Math.round(spot.shoot_score) : 0;
  const scoreColor =
    score >= 90 ? '#22c55e' : score >= 75 ? colors.primary : '#60A5FA';

  const openDirections = () => {
    if (spot.latitude == null || spot.longitude == null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const label = encodeURIComponent(spot.title || 'Spot');
    const url = Platform.select({
      ios: `maps://?daddr=${spot.latitude},${spot.longitude}&q=${label}`,
      android: `geo:${spot.latitude},${spot.longitude}?q=${spot.latitude},${spot.longitude}(${label})`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${spot.latitude},${spot.longitude}`,
    }) as string;
    Linking.openURL(url).catch(() => {});
  };

  const onShare = async () => {
    // May 2026 batch #4 extension — native share sheet on Explore map
    // preview card. Same pattern as app/spot/[id].tsx: platform-native
    // share sheet on iOS/Android (Messages, Mail, WhatsApp, AirDrop,
    // Slack, etc.), Web Share API → clipboard fallback on web.
    //
    // Previously this function only opened a mailto: link which
    // triggered the recipient's mail client and skipped every other
    // sharing surface (iMessage, AirDrop, Slack). That was the root
    // cause of the "share only does email" complaint.
    Haptics.selectionAsync().catch(() => {});
    try {
      // Canonical URL resolution — same priority order as spot detail:
      // WEB_BASE_URL > BACKEND_URL > scheme-based deep link.
      // V4 (May 2026) — use shared resolvers for triple-layered fallback.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveBackendUrl, resolveWebBaseUrl } = require('../../src/constants/config');
      const webBase = resolveWebBaseUrl();
      const backendBase = resolveBackendUrl();
      const base = webBase || backendBase;
      const spotUrl = base
        ? `${base}/spot/${spot.spot_id}`
        : `lumascout://spot/${spot.spot_id}`;

      const location = [spot.city, spot.state].filter(Boolean).join(', ');
      const summary = (spot.description || '').trim().slice(0, 160);
      const message = [
        spot.title || 'LumaScout spot',
        location ? `📍 ${location}` : null,
        summary,
        spotUrl,
      ].filter(Boolean).join('\n');

      if (Platform.OS === 'web') {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        if (nav?.share) {
          try {
            await nav.share({
              title: spot.title || 'LumaScout spot',
              text: location ? `${spot.title} — ${location}` : spot.title,
              url: spotUrl,
            });
            return;
          } catch (e: any) {
            if (e?.name === 'AbortError') return;
          }
        }
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(spotUrl);
          Alert.alert('Link copied', `Paste it anywhere to share:\n${spotUrl}`);
          return;
        }
        Alert.alert('Share this spot', `Copy the link below:\n\n${spotUrl}`, [{ text: 'OK' }]);
        return;
      }

      // Native: system share sheet — surfaces Messages, Mail, AirDrop,
      // WhatsApp, Slack, copy-to-clipboard, and every other installed
      // share target in a single modal.
      await Share.share({
        message,
        url: spotUrl,
        title: spot.title || 'LumaScout spot',
      });
    } catch (e: any) {
      if (e?.message && !/cancel/i.test(e.message)) {
        Alert.alert("Couldn't share", e.message);
      }
    }
  };

  // Real-data priority chips shown when Best-at isn't available
  // (mirrors the Explore-card priority cascade).
  const savesCount = Number(spot.save_count || 0);
  const newPostsCount = Number(spot.recent_upload_count_7d || 0);
  // CR #1 Item 5 (June 2025): removed the generic "Best at Sunset/Sunrise"
  // chip from the map bottom-sheet preview surface. The underlying
  // evening/morning_golden_hour_rating data is retained and still drives
  // the Golden Hour Rail + Spot Detail page; we just no longer surface
  // a generic label on card/preview surfaces.
  const greenChip =
    (spot.crowd_level || 3) <= 2
      ? { key: 'crowd', label: 'Low Crowds', icon: UsersIcon }
      : spot.is_trending
        ? { key: 'trending', label: 'Trending now', icon: UsersIcon }
        : newPostsCount > 0
          ? { key: 'newposts', label: `${newPostsCount} new post${newPostsCount === 1 ? '' : 's'}`, icon: UsersIcon }
          : savesCount >= 3
            ? { key: 'saves', label: `${savesCount >= 100 ? '99+' : savesCount} saves`, icon: UsersIcon }
            : spot.is_new
              ? { key: 'new', label: 'New', icon: UsersIcon }
              : null;

  // 3 subtle tag chips (Urban / Easy Access / Great for Portraits)
  const niches: string[] = Array.isArray(spot.niches)
    ? spot.niches
    : (spot.niche ? [spot.niche] : []);
  const subtleTags: string[] = [];
  if (niches.length) subtleTags.push(...niches.slice(0, 1).map(String));
  else if (spot.type) subtleTags.push(String(spot.type));
  else subtleTags.push('Urban');
  if (spot.accessible !== false) subtleTags.push('Easy Access');
  if ((spot.score_portrait || 0) >= 4 || niches.includes('Portrait')) subtleTags.push('Great for Portraits');
  else if ((spot.evening_golden_hour_rating || 0) >= 4) subtleTags.push('Golden Hour');
  else subtleTags.push('Photogenic');

  // CR Item 4 (May 2026) — never show "— mi" anywhere in the preview.
  // Strategy:
  //   1. If the marker payload already carries server-attached distance
  //      (distance_mi / distance_miles / distance_km) → use it.
  //   2. Else, if we have user GPS, compute Haversine client-side.
  //   3. Else, leave null and HIDE the bullet+distance fragment entirely
  //      (the city line still renders without a stranded en-dash).
  // This is read upstream from Explore via the `userCoords` ref the
  // host already keeps; props let the preview stay pure.
  const distMi = formatDistance(spot);

  return (
    <View style={styles.previewSheet}>
      {/* Drag indicator */}
      <View style={styles.previewHandle} />

      <View style={styles.sheetBody}>
        {/* Hero image — LEFT, 132x132 square per mockup.
            FIX (June 2025 v2.0.20): the gradient fallback is now ALWAYS
            rendered as the base layer (StyleSheet.absoluteFillObject).
            When `cover` resolves we layer the <Image> ON TOP. If the
            URL fails to load on iOS (rejected by ATS, 404, slow CDN),
            our `onError` flips `imgFailed` and the Image is unmounted —
            revealing the gradient beneath instead of the previous
            "dead dark square" the user reported in v2.0.19. */}
        <View style={styles.sheetHeroWrap}>
          <View style={StyleSheet.absoluteFillObject}>
            <SpotImageFallback
              title={spot.title}
              seed={spot.spot_id || spot.title}
              shootType={Array.isArray(spot.shoot_types) ? spot.shoot_types[0] : undefined}
              compact
            />
          </View>
          {cover && !imgFailed ? (
            // v2.0.25 — swapped RN <Image> for <CachedImage> (expo-image
            // under the hood). Rationale: Cloudflare rewrites our
            // `Cache-Control: public, max-age=604800, immutable` to
            // `no-store, no-cache` at the edge (cf-cache-status: DYNAMIC).
            // Native iOS URLCache honors no-store strictly, so every
            // pan-zoom re-rendered pins would re-download thumbnails.
            // expo-image maintains its own memory+disk cache keyed by
            // URL, independent of HTTP cache semantics — finally lets
            // the /api/img proxy investment pay off on cellular.
            <CachedImage
              source={{ uri: cover }}
              style={styles.sheetHero}
              contentFit="cover"
              onError={(e: any) => {
                try {
                  // eslint-disable-next-line no-console
                  console.warn('[map-preview] image_load_failed', {
                    spot_id: spot?.spot_id,
                    title: spot?.title,
                    url: cover,
                    error: e?.error || e?.nativeEvent,
                  });
                } catch {}
                setImgFailed(true);
              }}
              onLoad={() => {
                try {
                  // eslint-disable-next-line no-console
                  console.log('[map-preview] image_loaded', { url: cover });
                } catch {}
              }}
            />
          ) : null}
          {/* Visible debug chip when image fails — flags to the user
              exactly which spots have broken/missing photos instead of
              silently blending into the gradient. Keeps the premium
              gradient but adds a subtle eyebrow so they can report. */}
          {imgFailed && cover ? (
            <View style={styles.sheetImgFailedChip} pointerEvents="none">
              <Text style={styles.sheetImgFailedTxt}>Photo unavailable</Text>
            </View>
          ) : null}
          {/* VERIFIED pill overlay bottom-left */}
          {verified ? (
            <View style={styles.sheetVerifiedPill}>
              <Shield size={9} color="#10B981" />
              <Text style={styles.sheetVerifiedTxt}>VERIFIED</Text>
            </View>
          ) : null}
        </View>

        {/* RIGHT side — title, meta, score + chips */}
        <View style={styles.sheetRight}>
          <View style={styles.sheetTitleRow}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{spot.title}</Text>
            {verified ? (
              // Twitter-style blue verified mark
              <View style={styles.blueCheck}>
                <Text style={styles.blueCheckTxt}>✓</Text>
              </View>
            ) : null}
            <Pressable
              hitSlop={8}
              onPress={onToggleSave}
              style={styles.sheetIconBtn}
              testID="pin-preview-heart"
            >
              <Heart
                size={16}
                color={isSaved ? '#ef4444' : colors.text}
                fill={isSaved ? '#ef4444' : 'transparent'}
              />
            </Pressable>
          </View>

          <View style={styles.sheetSubRow}>
            <Text style={styles.sheetCity} numberOfLines={1}>
              {spot.city}{spot.state ? `, ${spot.state}` : ''}{distMi ? ` • ${distMi}` : ''}
            </Text>
            <Pressable
              hitSlop={8}
              onPress={onShare}
              style={[styles.sheetIconBtn, { marginLeft: 'auto' }]}
              testID="pin-preview-share"
            >
              <ShareIcon size={15} color={colors.text} />
            </Pressable>
          </View>

          {/* Score + supporting chips — hidden entirely when we don't
              actually have real data. CR #1 Item 5 (June 2025) removed
              the generic "Best at Sunset" gold chip from this preview. */}
          {(hasRealScore || greenChip || premium) && (
            <View style={styles.sheetScoreRow}>
              {hasRealScore && (
                <View style={styles.sheetScoreCol}>
                  <View style={[styles.sheetScoreRing, { borderColor: scoreColor }]}>
                    <Text style={[styles.sheetScoreTxt, { color: scoreColor }]}>{score}</Text>
                  </View>
                  <Text style={styles.sheetScoreLabel}>Score</Text>
                </View>
              )}
              <View style={{ flex: 1, gap: 6 }}>
                {greenChip ? (
                  <View style={[styles.bigChip, styles.bigChipGreen]}>
                    <UsersIcon size={11} color="#22c55e" />
                    <Text style={[styles.bigChipTxt, { color: '#22c55e' }]}>{greenChip.label}</Text>
                  </View>
                ) : null}
                {premium ? (
                  <View style={[styles.bigChip, styles.bigChipElite]}>
                    <Gem size={11} color="#9D59FF" />
                    <Text style={[styles.bigChipTxt, { color: '#9D59FF' }]}>Elite</Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}
        </View>
      </View>

      {/* June 2025 Map View CR — photographer planning row.
          Three lines packed into the preview footer:
            • Golden hour countdown for THIS spot's coords
            • Blue hour countdown for THIS spot's coords
            • Approx. drive time from user → spot
          Each updates every 60s while the preview is open;
          missing data renders a dashed-out fallback so users always
          see all three "slots" (no jumpy layout shifts). */}
      <PinPreviewPlanning
        spotLat={spot.latitude}
        spotLng={spot.longitude}
        userCoords={userCoords ?? null}
      />

      {/* Subtle outline tag row */}
      <View style={styles.subtleTagRow}>
        {subtleTags.slice(0, 3).map((t) => (
          <View key={t} style={styles.subtleTag}>
            <Text style={styles.subtleTagTxt}>{t}</Text>
          </View>
        ))}
      </View>

      {/* Triple-button — Save (left) | Directions GOLD (middle) | Details (right) */}
      <View style={styles.previewActions}>
        <TouchableOpacity
          style={[styles.previewBtn, styles.previewBtnSecondary, isSaved && styles.previewBtnSaved, { flex: 1 }]}
          onPress={onToggleSave}
          activeOpacity={0.85}
          testID="pin-preview-save"
        >
          <Bookmark
            size={14}
            color={isSaved ? colors.primary : colors.text}
            fill={isSaved ? colors.primary : 'transparent'}
          />
          <Text style={[styles.previewBtnSecondaryTxt, isSaved && { color: colors.primary }]}>
            {isSaved ? 'Saved' : 'Save'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.previewBtn, styles.previewBtnPrimary, { flex: 1.3 }]}
          onPress={openDirections}
          activeOpacity={0.85}
          testID="pin-preview-directions"
        >
          <Navigation size={14} color="#1a1300" />
          <Text style={styles.previewBtnPrimaryTxt}>Directions</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.previewBtn, styles.previewBtnSecondary, { flex: 1 }]}
          onPress={() => {
            // Cover Source-of-Truth CR (v2.0.24) — visual continuity
            // between map preview and detail hero.
            //
            // 1. Preload the HERO-sized variant of the same cover image
            //    via Image.prefetch so iOS URLCache has it warm by the
            //    time the detail page mounts. No flash from thumbnail
            //    to hero, no spinner on the first carousel slide.
            //
            // 2. Pass `initialCover` as a route param so the detail
            //    page can render that exact URL as the first slide
            //    IMMEDIATELY while the /spots/:id fetch is in-flight,
            //    eliminating the perceptual gap entirely.
            try {
              if (cover) {
                // `cover` here is the map-preview 280w URL. Derive the
                // HERO (1080w) variant by rewriting the w= param on
                // the /api/img proxy URL so the preload hits the same
                // cache key the detail page will.
                let heroUrl = cover;
                try {
                  heroUrl = cover.replace(/([?&])w=\d+/, `$1w=${IMG_SIZES.HERO}`);
                } catch {}
                Image.prefetch(heroUrl).catch(() => {});
              }
            } catch {}
            router.push({
              pathname: `/spot/${spot.spot_id}` as any,
              params: cover
                ? { initialCover: encodeURIComponent(cover) }
                : undefined,
            });
          }}
          activeOpacity={0.85}
          testID="pin-preview-details"
        >
          <Text style={styles.previewBtnSecondaryTxt}>View Details</Text>
        </TouchableOpacity>
      </View>

      {/* Floating close — keeps muscle memory; not in main visual hierarchy */}
      <TouchableOpacity style={styles.previewCloseV2} onPress={onClose} hitSlop={8}>
        <X size={14} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
}

function FilterSheet({
  visible, onClose, filters, onApply,
}: { visible: boolean; onClose: () => void; filters: Filters; onApply: (f: Filters) => void }) {
  const [local, setLocal] = useState<Filters>(filters);
  useEffect(() => setLocal(filters), [filters]);

  const setNumber = (k: keyof Filters, v: number) => {
    setLocal((f) => ({ ...f, [k]: f[k] === v ? undefined : v }));
  };
  const toggle = (k: keyof Filters) => setLocal((f) => ({ ...f, [k]: f[k] ? undefined : true }));

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <TouchableOpacity onPress={onClose}><X size={22} color={colors.text} /></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }} showsVerticalScrollIndicator={false}>
            <Section label="Shoot type">
              {SHOOT_TYPES.map((t) => (
                <Chip key={t} label={t} active={local.shoot_type === t}
                  onPress={() => setLocal({ ...local, shoot_type: local.shoot_type === t ? undefined : t })}
                  testID={`filter-shoot-${t}`} />
              ))}
            </Section>

            {/* Apr 2026 cleanup — removed Best time of day, Best season,
                Light quality, Hidden gem, AND Access & logistics filters
                per latest product direction. The actual access/logistics
                data still lives on the spot detail page; we just no longer
                expose it as an Explore filter. Kept the actionable
                shoot-type / accessibility / trust filters. */}

            <Section label="Trust & freshness">
              <SwitchRow label="Verified in last 60 days" value={!!local.verified_recently} onChange={() => toggle('verified_recently')} />
              <SwitchRow label="Proven spot (80+ & 3+ photos)" value={!!local.proven_spot} onChange={() => toggle('proven_spot')} />
            </Section>

            <Section label="Accessibility & rules">
              <SwitchRow label="Dog friendly" value={!!local.dog_friendly} onChange={() => toggle('dog_friendly')} />
              <SwitchRow label="Kid friendly" value={!!local.kid_friendly} onChange={() => toggle('kid_friendly')} />
              <SwitchRow label="Wheelchair accessible" value={!!local.accessible} onChange={() => toggle('accessible')} />
              <SwitchRow label="Indoor option" value={!!local.indoor} onChange={() => toggle('indoor')} />
              <SwitchRow label="Permit required" value={!!local.permit_required} onChange={() => toggle('permit_required')} />
              <SwitchRow label="Fee required" value={!!local.fee_required} onChange={() => toggle('fee_required')} />
            </Section>

            <Section label="Min Shoot Score">
              {[60, 70, 80, 90].map((v) => (
                <Chip key={v} label={`${v}+`} active={local.min_rating === v}
                  onPress={() => setLocal({ ...local, min_rating: local.min_rating === v ? undefined : v })}
                  testID={`filter-min-${v}`} />
              ))}
            </Section>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: space.md, padding: space.xl, paddingTop: 0 }}>
            <Button title="Reset" variant="secondary" onPress={() => setLocal({})} testID="filter-reset" style={{ flex: 1 }} />
            <Button title="Apply filters" onPress={() => onApply(local)} testID="filter-apply" style={{ flex: 2 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Section({ label, children }: { label: string; children: any }) {
  return (
    <View>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

function ScaleChips({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <View style={{ width: '100%', gap: 6, marginTop: 4 }}>
      <Text style={styles.subLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((v) => (
          <TouchableOpacity
            key={v}
            onPress={() => onChange(v)}
            style={[styles.scaleBtn, value === v && styles.scaleBtnActive]}
          >
            <Text style={[styles.scaleTxt, value === v && { color: colors.textInverse }]}>{v}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingVertical: 4 }}>
      <Text style={{ color: colors.text, fontFamily: font.bodyMedium, fontSize: 14, flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.surface3 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // FIX(P1-5 pre-release audit) Inline error retry pill
  errorPill: {
    marginHorizontal: space.xl,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: 'rgba(220,90,90,0.14)',
    borderColor: 'rgba(220,90,90,0.4)',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorPillTxt: {
    color: '#ff8c8c',
    fontFamily: font.bodySemibold,
    fontSize: 12.5,
    letterSpacing: 0.2,
  },
  // FIX(P1-3 pre-release audit) Web-only "list-fallback" hint chip
  webHint: {
    marginHorizontal: space.xl,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  webHintTxt: {
    color: colors.textTertiary,
    fontFamily: font.body,
    fontSize: 11.5,
    lineHeight: 16,
  },
  // (Apr 2026 hardening) Inline GPS-off hint banner shown above the map
  // when location permission is denied / errored. Tappable to retry.
  locOffHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: space.xl,
    marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.35)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  locOffHintTxt: {
    flex: 1,
    color: colors.text,
    fontFamily: font.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.1,
  },
  locOffHintCta: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 11.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  // GPS trust strip — Apr 2026 Item #3 round 3
  gpsTrust: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.xl, paddingTop: 8, paddingBottom: 6,
  },
  gpsTrustTxt: {
    flex: 1, color: colors.textTertiary,
    fontFamily: font.bodyMedium, fontSize: 11.5, letterSpacing: 0.2,
  },
  gpsRetry: {
    color: colors.primary, fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 0.3,
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md,
  },
  // Apr 2026 Explore premium upgrade styles ----------------------------
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.xl, paddingTop: 4, paddingBottom: 6,
  },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  headerTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.2, marginTop: 1 },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  segWrap: { paddingHorizontal: space.xl, paddingTop: 6, paddingBottom: 6 },
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 22, padding: 3,
  },
  segBtn: {
    flex: 1, height: 36, borderRadius: 19,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  segBtnActive: { backgroundColor: 'rgba(245,166,35,0.18)', borderWidth: 1, borderColor: colors.primary },
  segTxt: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 13 },
  segTxtActive: { color: colors.primary, fontFamily: font.bodyBold },
  locRow: { flexDirection: 'row', gap: 6, paddingHorizontal: space.xl, paddingTop: 6, paddingBottom: 4 },
  locChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 30, paddingHorizontal: 12, borderRadius: 15,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  locChipTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 11 },
  locChipChev: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10 },
  chipRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.xl, paddingTop: 8, paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 32, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: 'rgba(245,166,35,0.14)', borderColor: colors.primary },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  chipTxtActive: { color: colors.primary, fontFamily: font.bodySemibold },
  // Inline ELITE sub-pill on the Hidden Gems chip — matches mockup spec.
  chipEliteSub: {
    paddingHorizontal: 6, paddingVertical: 1.5,
    borderRadius: 6,
    backgroundColor: 'rgba(245,166,35,0.18)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(245,166,35,0.55)',
    marginLeft: 2,
  },
  chipEliteSubTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 8, letterSpacing: 0.5 },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    paddingHorizontal: space.lg, paddingVertical: 12, borderRadius: radii.md,
  },
  searchText: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14 },
  iconBtn: {
    width: 44, height: 44, borderRadius: radii.md, position: 'relative',
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary,
    paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
  },
  badgeDotTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10 },
  floatControls: { position: 'absolute', right: space.xl, bottom: space.xl, gap: 10 },
  fab: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(20,20,22,0.85)',
    borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  // Apr 2026 Premium Map — glassmorphism FAB. Used by the Recenter /
  // Layers / Toggle-list stack. Backdrop is heavily darkened with a
  // hairline gold-tinged border for the Apple-quality "glass" feel.
  fabGlass: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(15,15,18,0.7)',
    borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  // 🔥 Trending chip — floating retention nudge on map mount.
  trendingChip: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15,15,18,0.92)',
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.45)',
    shadowColor: '#F97316',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  trendingChipTxt: {
    color: colors.text, fontFamily: font.bodyMedium, fontSize: 12,
  },
  // Avatar stack on the trending chip — Mockup spec: 3 overlapped circular
  // owner avatars + "+N" count next to a chevron.
  trendAvatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
    paddingLeft: 6,
  },
  trendAvatar: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: '#0c0c10',
    backgroundColor: colors.surface2,
  },
  trendOverflow: {
    color: colors.textSecondary,
    fontFamily: font.bodySemibold,
    fontSize: 11,
    marginLeft: 4,
  },
  // Active state for the inline niche chip (when a niche is selected)
  locChipActive: {
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderColor: 'rgba(245,166,35,0.6)',
  },
  // Photographer-context chip row inside the bottom sheet
  photogRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingTop: 10,
    paddingHorizontal: 2,
  },
  photogChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  photogChipTxt: {
    fontFamily: font.bodySemibold, fontSize: 10.5, letterSpacing: 0.1,
  },
  // Bookmark "Saved" state for the secondary button
  previewBtnSaved: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderColor: 'rgba(245,166,35,0.5)',
  },

  // ────────────────────────────────────────────────────────────────────
  // Apr 2026 — Apple-quality bottom sheet redesign (mockup-pixel match)
  // ────────────────────────────────────────────────────────────────────
  sheetBody: {
    flexDirection: 'row',
    paddingTop: 4,
    gap: 14,
  },
  sheetHeroWrap: {
    width: 132,
    height: 132,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  sheetHero: { width: '100%', height: '100%' },
  sheetVerifiedPill: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(8,20,12,0.85)',
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.55)',
  },
  sheetVerifiedTxt: {
    color: '#10B981',
    fontFamily: font.bodyBold,
    fontSize: 9,
    letterSpacing: 0.6,
  },
  // v2.0.20 diagnostic — surfaces a compact "Photo unavailable" chip on
  // top of the gradient fallback when an Image load actually FAILED
  // (not just "no cover URL at all"). Positioned top-right so it
  // never overlaps the bottom-left verified pill.
  sheetImgFailedChip: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(10,10,10,0.7)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  sheetImgFailedTxt: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: font.bodyMedium,
    fontSize: 9,
    letterSpacing: 0.3,
  },
  sheetRight: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sheetTitle: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 17,
    letterSpacing: -0.2,
  },
  blueCheck: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#3B82F6',
    alignItems: 'center', justifyContent: 'center',
  },
  blueCheckTxt: {
    color: '#fff',
    fontFamily: font.bodyBold,
    fontSize: 9,
    lineHeight: 11,
  },
  sheetSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  sheetCity: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 12,
    flexShrink: 1,
  },
  sheetIconBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sheetScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  sheetScoreCol: {
    alignItems: 'center',
    gap: 2,
  },
  sheetScoreRing: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2.5,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  sheetScoreTxt: {
    fontFamily: font.bodyBold,
    fontSize: 14,
  },
  sheetScoreLabel: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 9.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  // The two prominent chips (gold/green) inside the bottom sheet
  bigChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  bigChipGold: {
    backgroundColor: 'rgba(245,166,35,0.13)',
    borderColor: 'rgba(245,166,35,0.55)',
  },
  bigChipGreen: {
    backgroundColor: 'rgba(34,197,94,0.13)',
    borderColor: 'rgba(34,197,94,0.55)',
  },
  bigChipElite: {
    backgroundColor: 'rgba(157,89,255,0.13)',
    borderColor: 'rgba(157,89,255,0.55)',
  },
  bigChipTxt: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 0.1,
  },
  // June 2025 — Map preview planning band: golden hour, blue hour,
  // drive time. Three condensed lines so the user can plan without
  // ever leaving the map. Tight padding keeps the preview compact.
  planningBand: {
    paddingTop: 10,
    gap: 4,
  },
  planningRowLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  planningGold: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 12,
    letterSpacing: 0.1,
    flexShrink: 1,
  },
  planningBlue: {
    color: '#60A5FA',
    fontFamily: font.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.1,
    flexShrink: 1,
  },
  planningDrive: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.1,
    flexShrink: 1,
  },
  // Subtle outline tag chip row (Urban / Easy Access / Great for Portraits)
  subtleTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 12,
  },
  subtleTag: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  subtleTagTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 11.5,
  },
  legendBar: {
    position: 'absolute', top: 10, left: space.xl, right: space.xl,
    flexDirection: 'row', gap: 12, flexWrap: 'wrap',
    padding: 8, borderRadius: radii.pill, backgroundColor: 'rgba(15,15,18,0.88)',
    justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  previewWrap: { position: 'absolute', left: space.xl, right: space.xl, bottom: space.xxl },
  previewClose: {
    position: 'absolute', right: space.md, top: space.md, zIndex: 2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  previewChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill },
  previewChipTxt: { fontFamily: font.bodyBold, fontSize: 10 },

  // Apr 2026 — Premium Map Pin Preview bottom sheet (dual-button)
  previewSheet: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.xxl,
    backgroundColor: 'rgba(15,15,18,0.95)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  previewHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
    marginBottom: 10,
  },
  previewCloseV2: {
    position: 'absolute', right: 10, top: 10, zIndex: 2,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewHero: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  previewThumbWrap: {
    width: 64, height: 64, borderRadius: 16, overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  previewThumb: { width: '100%', height: '100%' },
  previewTitle: {
    color: colors.text, fontFamily: font.bodyBold, fontSize: 15, letterSpacing: -0.1,
  },
  previewCity: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 1,
  },
  previewMetaRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5,
  },
  previewScore: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewScoreTxt: { fontFamily: font.bodyBold, fontSize: 13 },
  previewActions: {
    flexDirection: 'row', gap: 8, marginTop: 12,
  },
  previewBtn: {
    flex: 1, height: 44, borderRadius: 22,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  previewBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  previewBtnSecondaryTxt: {
    color: colors.text, fontFamily: font.bodySemibold, fontSize: 13,
  },
  previewBtnPrimary: {
    backgroundColor: colors.primary,
  },
  previewBtnPrimaryTxt: {
    color: '#1a1300', fontFamily: font.bodyBold, fontSize: 13,
  },

  // "Search this area" floating CTA
  searchAreaCta: {
    position: 'absolute',
    top: 70,
    alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
    shadowColor: '#000', shadowOpacity: 0.45,
    shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  searchAreaTxt: {
    color: '#1a1300', fontFamily: font.bodyBold, fontSize: 12.5, letterSpacing: 0.1,
  },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.surface3, alignSelf: 'center', marginTop: 10 },
  sheetHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.sm,
  },
  sheetTitle: { color: colors.text, fontFamily: font.display, fontSize: 26 },
  sectionLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  subLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scaleBtn: { flex: 1, paddingVertical: 8, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2, alignItems: 'center' },
  scaleBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  scaleTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  // Phase 2 stability: shown when MAX_MARKERS cap is enforced
  trimBanner: {
    position: 'absolute', top: 8, left: 12, right: 12, zIndex: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  trimBannerTxt: {
    color: '#fff', fontFamily: font.bodyMedium, fontSize: 11, textAlign: 'center',
  },
});
