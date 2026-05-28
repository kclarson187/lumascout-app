import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  Share,
  Linking,
  Platform,
  Pressable,
  DeviceEventEmitter,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as ExpoLinking from 'expo-linking';
import Head from 'expo-router/head';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import {
  ChevronLeft, Bookmark, Share2, Flag, MapPin, Sun, Sunrise, Sunset, Cloud,
  Camera, Car, Accessibility, Users, Shield, DogIcon, BabyIcon, TicketIcon, ClockIcon, CheckCircle,
  FolderPlus, MessageSquarePlus, Navigation, Wand2, ChevronRight, Trash2, PenLine, X, Layers,
} from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { formatDistance } from '../../src/utils/distance';
import { resolveImageUrl, IMG_SIZES } from '../../src/utils/image-url';
import SafeImage from '../../src/components/SafeImage';
import CachedImage from '../../src/components/CachedImage';
import { useLightbox } from '../../src/components/ImageLightbox';
import ScoreRing from '../../src/components/ScoreRing';
import SpotCard from '../../src/components/SpotCard';
import { Button } from '../../src/components/Button';
import { DetailSkeleton } from '../../src/components/Skeleton';
import AddToCollectionSheet from '../../src/components/AddToCollectionSheet';
import CommunityUploadsSection from '../../src/components/CommunityUploadsSection';
import LatestConditionsSection from '../../src/components/LatestConditionsSection';
import SeasonalTimelineSection from '../../src/components/SeasonalTimelineSection';
import { ActivityBadge, timeAgo } from '../../src/components/FreshnessBits';
import VerifiedBadge from '../../src/components/VerifiedBadge';
import UserBadge from '../../src/components/UserBadge';
import FreshnessBadge from '../../src/components/FreshnessBadge';
import ReportSheet from '../../src/components/ReportSheet';
import ShotListSheet from '../../src/components/ShotListSheet';
import ScoutAICard from '../../src/components/ScoutAICard';
import ShootPlanSheet from '../../src/components/ShootPlanSheet';
import DeleteConfirmSheet, { SPOT_DELETE_PRESETS } from '../../src/components/DeleteConfirmSheet';
import { goldenHourLabel } from '../../src/utils/sun';
import { goldenHourBrief, blueHourBrief, goldenHourPlanning, blueHourPlanning } from '../../src/utils/sun-windows';
import { driveTimeEstimate } from '../../src/utils/drive-time';
import useGps from '../../src/hooks/useGps';
import * as Location from 'expo-location';
import {
  Sparkles, Coffee, ParkingCircle, Mountain, Heart as HeartIcon, Zap,
} from 'lucide-react-native';

// v2.0.25 refactor — data-fetching + ordering + retry logic lives in
// useSpotDetail; style sheet + shared atoms (InfoCard / LogisticsRow /
// Badge) live in the spot-detail bundle. The screen component below
// is now focused on orchestration + render only.
import { useSpotDetail } from '../../src/components/spot-detail/useSpotDetail';
import DescriptionEditorSheet from '../../src/components/spot-detail/DescriptionEditorSheet';
import { styles, sadStyles, W } from '../../src/components/spot-detail/styles';
import { InfoCard, LogisticsRow, Badge } from '../../src/components/spot-detail/atoms';

import ScreenErrorBoundary from '../../src/components/ScreenErrorBoundary';
import SectionErrorBoundary from '../../src/components/SectionErrorBoundary';
import ShareWithClientSheet from '../../src/components/ShareWithClientSheet';
import VisibilityToggleSheet from '../../src/components/VisibilityToggleSheet';
import { Link2, Globe, Lock, PencilLine } from 'lucide-react-native';

export default function SpotDetail() {
  return (
    <ScreenErrorBoundary label="Spot">
      <SpotDetailImpl />
    </ScreenErrorBoundary>
  );
}

function SpotDetailImpl() {
  const params = useLocalSearchParams<{ id: string; initialCover?: string }>();
  // Cover Source-of-Truth CR (v2.0.24) — decode the map-preview cover
  // URL passed through the route param. When the user taps "View
  // Details" we can render THIS URL as the first hero slide IMMEDIATELY
  // while /spots/:id is still in-flight — eliminating the flash between
  // the map preview thumbnail and the fully-loaded detail hero. Once
  // the spot fetch completes, `orderedImages` takes over using the
  // canonical `cover_image_url` from the detail payload.
  const initialCoverUrl = useMemo(() => {
    try {
      const raw = params?.initialCover;
      if (!raw || typeof raw !== 'string') return null;
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }, [params?.initialCover]);
  // Batch #8 — hero carousel opens a pinch-zoom lightbox on tap.
  const { open: openLightbox, Lightbox } = useLightbox();
  // May 2026 stability fix — defensively read the id param. Expo Router
  // can return string | string[] | undefined depending on the route
  // definition. We coerce to a single string and trim. If empty, the
  // load() bail-out below shows the inline error state instead of
  // firing an undefined-id fetch.
  const rawId = (params as any)?.id;
  const id = String(Array.isArray(rawId) ? rawId[0] || '' : rawId || '').trim();
  const { user } = useAuth();
  const isAdminUser = user?.role === 'admin' || user?.role === 'super_admin';
  const insets = useSafeAreaInsets();
  // Hero carousel scroll ref — used by the left/right arrow buttons
  // (June 2025) to programmatically advance the paging ScrollView
  // without forcing the user to swipe. Swipe still works as before;
  // arrows are an additive affordance for users who don't realize
  // the hero is swipeable.
  const heroScrollRef = useRef<any>(null);

  // v2.0.25 refactor — all async state (spot / loading / community
  // uploads / error category / ordered images / galleryIdx clamping +
  // retry + focus-refresh) lives in the hook. The screen owns only
  // the lightweight UI state below (sheets open/closed, etc.) and the
  // handlers that call into the hook's setters for optimistic updates.
  const {
    spot,
    setSpot,
    loading,
    galleryIdx,
    setGalleryIdx,
    errorCategory,
    orderedImages,
    communityUploads,
    setCommunityUploads,
    reload: load,
  } = useSpotDetail(id, initialCoverUrl);

  const [atcOpen, setAtcOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Jun 2025 — "Plan This Shoot" modal. Lazy — we never fetch the
  // shoot plan until the user explicitly taps the CTA, so Spot Detail
  // pages still open instantly.
  const [shootPlanOpen, setShootPlanOpen] = useState(false);
  const [shotListOpen, setShotListOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Feature 4 (Scope B) — share / visibility sheets owned by this screen
  const [shareOpen, setShareOpen] = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  // May 2026 — admin / super_admin description editor.
  const [descEditOpen, setDescEditOpen] = useState(false);

  // June 2025 redesign — user GPS for drive-time estimate inside the
  // new combined "Light + Drive" card. Lazy; doesn't block render.
  const { coords: userCoords } = useGps();

  // Per-minute ticker for the golden / blue / drive countdown card
  // so it stays accurate while the user lingers on the screen.
  const [planningTick, setPlanningTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPlanningTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // June 2025 — inline "Enable" button for Location permission.
  // useGps auto-runs once on mount but doesn't re-prompt after a
  // denial. This local override coords + requesting flag lets the
  // Drive-time card surface a tiny "Enable" pill that asks for
  // permission on demand and falls back gracefully if the user
  // denied it permanently (we can't bypass system prefs from JS;
  // we surface a one-line hint when that happens).
  const [overrideCoords, setOverrideCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locRequesting, setLocRequesting] = useState(false);
  const [locDeniedHard, setLocDeniedHard] = useState(false);
  const requestLocation = useCallback(async () => {
    if (locRequesting) return;
    setLocRequesting(true);
    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        // Permanently denied → user must enable it from system settings.
        if (!canAskAgain) {
          setLocDeniedHard(true);
          Alert.alert(
            'Location turned off',
            'Open Settings to enable location for LumaScout so we can show drive time and personalised sun events.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings?.() },
            ],
          );
        }
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setOverrideCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setLocDeniedHard(false);
    } catch {
      // Best-effort; the next minute's tick or pull-to-refresh will retry.
    } finally {
      setLocRequesting(false);
    }
  }, [locRequesting]);

  // Effective coords used for drive-time. Live useGps coords win;
  // overrideCoords (returned from the inline Enable button) fill the
  // gap when useGps couldn't resolve on initial mount.
  const effectiveDriveCoords = userCoords ?? overrideCoords;

  // ─── Responsive Hero Sizing (May 2026) ───────────────────────────────
  // Pre-refactor the hero was a static `width: W, height: W` square
  // captured at module import. Three problems:
  //   • on a tablet (1024×1366) the hero ate the entire above-the-fold,
  //     pushing every other section below the scroll
  //   • on a small iPhone SE (375×667) the same square was fine but
  //     felt slightly heavy
  //   • web preview / split-screen / rotation never resized the hero
  //     because Dimensions.get is a one-shot snapshot
  //
  // Fix: useWindowDimensions() re-renders the screen on every resize.
  // Hero target = 0.72 × width (a comfortable photographic 4:3 to 5:4
  // crop), bounded:
  //   • lower bound 260pt — a small phone in portrait still gets a
  //     dignified hero, never a postage stamp
  //   • upper bound 0.48 × height — keeps the title + meta pills
  //     visible without a scroll on every screen
  // Wide screens (>= 720pt) cap the page content to 720pt and centre
  // it so a tablet/web preview doesn't render mobile UI stretched
  // across the entire viewport.
  const { width: winW, height: winH } = useWindowDimensions();
  const heroSize = useMemo(() => {
    const target = winW * 0.72;
    return Math.min(Math.max(target, 260), winH * 0.48);
  }, [winW, winH]);
  const isWide = winW >= 720;
  const contentMaxW = isWide ? 720 : winW;
  const heroDynamic = useMemo(
    () => ({ width: winW, height: heroSize }),
    [winW, heroSize],
  );
  const heroImgDynamic = useMemo(
    () => ({ width: contentMaxW, height: heroSize }),
    [contentMaxW, heroSize],
  );

  // ─── Map / Hero Image Refresh (May 2026) ─────────────────────────────
  // The spot's "map image" (cover) updates whenever a user posts new
  // community photos that get auto-promoted, OR an admin saves a new
  // cover override. Both flows now broadcast a DeviceEvent that this
  // screen listens for. We:
  //   1) Drop expo-image's in-memory bytes cache so the hero never
  //      serves stale pixels for a recycled URL.
  //   2) Force a fresh /spots/:id fetch immediately — `useFocusEffect`
  //      already re-fetches on focus, but a same-frame reload removes
  //      the perceptible "old → new" flash when the user comes back
  //      from upload / cover editor.
  // Disk cache is preserved (LRU keys still valid for unrelated
  // images), keeping the v2.0.24 bandwidth wins intact.
  useEffect(() => {
    const onPhotosPosted = (payload: any) => {
      try {
        if (!payload || (payload.spotId && String(payload.spotId) !== String(id))) return;
        // eslint-disable-next-line no-console
        console.log('[spot-detail] photos:posted — refreshing hero', { id, autoApproved: !!payload.autoApproved });
      } catch { /* noop */ }
      try { ExpoImage.clearMemoryCache(); } catch { /* noop */ }
      try { load(); } catch { /* noop */ }
    };
    const onCoverChanged = (payload: any) => {
      try {
        if (!payload || (payload.spotId && String(payload.spotId) !== String(id))) return;
        // eslint-disable-next-line no-console
        console.log('[spot-detail] cover:changed — refreshing hero', { id });
      } catch { /* noop */ }
      try { ExpoImage.clearMemoryCache(); } catch { /* noop */ }
      try { load(); } catch { /* noop */ }
    };
    const sub1 = DeviceEventEmitter.addListener('spot:photos:posted', onPhotosPosted);
    const sub2 = DeviceEventEmitter.addListener('spot:cover:changed', onCoverChanged);
    return () => {
      try { sub1.remove(); } catch { /* noop */ }
      try { sub2.remove(); } catch { /* noop */ }
    };
  }, [id, load]);

  const toggleSave = async () => {
    if (!user) return router.push('/(auth)/login');
    try {
      await api.post(`/spots/${id}/save`);
      load();
    } catch {}
  };

  // June 2025 — single source of truth for the "Get directions" flow.
  // Used by the new primary-actions row AND the simplified sticky bar.
  // Falls back through Apple Maps → universal Apple link → geo: → web.
  const openDirections = useCallback(() => {
    const lat = spot?.latitude;
    const lng = spot?.longitude;
    if (lat == null || lng == null) {
      Alert.alert('Directions unavailable', 'This spot has no precise pin yet.');
      return;
    }
    const cityPart = [spot?.city, spot?.state].filter(Boolean).join(', ');
    const labelRaw = cityPart ? `${spot.title} · ${cityPart}` : (spot?.title || 'Spot');
    const label = encodeURIComponent(labelRaw);
    const iosUrl = `maps://?q=${label}&ll=${lat},${lng}&daddr=${lat},${lng}&dirflg=d`;
    const iosFallback = `http://maps.apple.com/?q=${label}&ll=${lat},${lng}&daddr=${lat},${lng}&dirflg=d`;
    const androidUrl = `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    (async () => {
      try {
        if (Platform.OS === 'ios') {
          const canOpen = await Linking.canOpenURL(iosUrl).catch(() => false);
          return Linking.openURL(canOpen ? iosUrl : iosFallback);
        }
        if (Platform.OS === 'android') {
          const canOpen = await Linking.canOpenURL(androidUrl).catch(() => false);
          return Linking.openURL(canOpen ? androidUrl : webUrl);
        }
        return Linking.openURL(webUrl);
      } catch {
        Alert.alert('Could not open maps', 'Please try again.');
      }
    })();
  }, [spot?.latitude, spot?.longitude, spot?.city, spot?.state, spot?.title]);

  const toggleFollow = async () => {
    if (!user || !spot?.owner?.user_id) return;
    try {
      await api.post(`/users/${spot.owner.user_id}/follow`);
      load();
    } catch {}
  };

  // May 2026 batch #4 — canonical spot URL helper (single source of truth
  // for share links + OG meta). Priority order:
  //   1. EXPO_PUBLIC_WEB_BASE_URL (production web host, once the web
  //      bundle is deployed to its final domain — prefer this for
  //      iMessage/Slack/WhatsApp preview cards).
  //   2. EXPO_PUBLIC_BACKEND_URL (same-origin API + web bundle in
  //      preview/dev environments — works today in staging).
  //   3. Mobile Linking.createURL fallback (`lumascout://spot/:id`) for
  //      when neither host is configured and we're on-device — never
  //      trust this for OG/preview cards, but it lets QR-coded links
  //      open in-app for testers.
  const spotPublicUrl = useMemo(() => {
    // CR Item 7 (May 2026) — point at the smart-link share endpoint
    // which returns Open Graph metadata + UA-driven App Store / Play
    // Store / web routing. Replaces the previous web-base direct URL
    // that produced bare links with no preview card.
    // V4 (May 2026) — use shared resolver with triple-layered fallback.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveBackendUrl } = require('../../src/constants/config');
    const backendBase = resolveBackendUrl();
    if (backendBase) return `${backendBase}/api/share/spot/${id}`;
    try {
      return ExpoLinking.createURL(`/spot/${id}`);
    } catch {
      return `/spot/${id}`;
    }
  }, [id]);

  const onShare = async () => {
    // May 2026 batch #4 — native share sheet + web fallback.
    //   Native: React Native's Share.share() surfaces the platform
    //     share sheet (Messages, Mail, WhatsApp, Slack, AirDrop, etc.).
    //   Web: react-native-web's Share polyfill is limited — we prefer
    //     the Web Share API where available, falling back to copy-to-
    //     clipboard with a toast.
    try {
      const location = [spot.city, spot.state].filter(Boolean).join(', ');
      const summary = (spot.description || '').trim().slice(0, 160);
      const lines = [
        spot.title,
        location ? `📍 ${location}` : null,
        summary,
        spotPublicUrl,
      ].filter(Boolean);
      const message = lines.join('\n');

      if (Platform.OS === 'web') {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        // Prefer Web Share API — shows the real system share sheet on
        // iOS Safari, Android Chrome, Edge.
        if (nav?.share) {
          try {
            await nav.share({
              title: spot.title,
              text: location ? `${spot.title} — ${location}` : spot.title,
              url: spotPublicUrl,
            });
            return;
          } catch (e: any) {
            // User cancelled — silently no-op (navigator.share rejects
            // with AbortError on cancel). Only bail if it's a real
            // error.
            if (e?.name === 'AbortError') return;
          }
        }
        // Fallback: copy the link and show an Alert so the user has
        // something actionable. Alert on web renders as a simple modal.
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(spotPublicUrl);
          Alert.alert('Link copied', `Paste it anywhere to share:\n${spotPublicUrl}`);
          return;
        }
        // Final fallback: open mail + sms client selector
        Alert.alert(
          'Share this spot',
          `Copy the link below:\n\n${spotPublicUrl}`,
          [{ text: 'OK' }],
        );
        return;
      }

      // Native path — system share sheet.
      await Share.share({
        message,
        url: spotPublicUrl,           // iOS uses this dedicated field
        title: spot.title,
      });
    } catch (e: any) {
      // Swallow silent cancellations; surface real errors.
      if (e?.message && !/cancel/i.test(e.message)) {
        Alert.alert("Couldn't share", e.message);
      }
    }
  };

  // May 2026 batch #4 update #2.1 — true HARD delete.
  //
  // Unified flow for both real images and cover-override synthetics:
  //   · Always call DELETE /admin/spots/:id/images/:identifier
  //   · identifier = image_id OR image_url (backend accepts either)
  //   · Backend detects cover-override case and clears hero_cover_image_url
  //     + admin_cover_override AND hard-unlinks the file on disk (if local
  //     and not referenced elsewhere).
  //   · No ghost data: the photo is gone from DB, disk, and every UI path.
  const onDeletePhoto = useCallback(async (img: any) => {
    if (!isAdminUser || !img) return;
    const identifier = img.image_id || img.image_url;
    if (!identifier) {
      Alert.alert("Couldn't delete", 'This photo is missing an identifier.');
      return;
    }
    const confirm = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Delete this photo?',
        `This will permanently remove the photo from ${spot?.title || 'this spot'} — including the file on the server. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (!confirm) return;

    // Optimistic UI: hide locally, revert on failure.
    const prevSpot = spot;
    const prevIdx = galleryIdx;
    const isCoverOverride = img.source === 'cover_override';
    setSpot((s: any) => {
      if (!s) return s;
      if (isCoverOverride) {
        // Hide the synthetic cover row by clearing the fields that feed
        // the orderedImages memo.
        return { ...s, hero_cover_image_url: null, admin_cover_override: null };
      }
      const kept = (s.images || []).filter(
        (im: any) => (im.image_id || im.image_url) !== identifier,
      );
      return { ...s, images: kept };
    });
    setGalleryIdx(0);
    try {
      await api.delete(`/admin/spots/${id}/images/${encodeURIComponent(identifier)}`);
      // Refresh authoritative state (picks up auto-cover-promotion +
      // any file-cleanup metadata from the server).
      await load();
    } catch (e: any) {
      setSpot(prevSpot);
      setGalleryIdx(prevIdx);
      Alert.alert("Couldn't delete photo", formatApiError(e) || 'Please try again.');
    }
  }, [isAdminUser, id, spot, galleryIdx, load]);

  const onReport = () => {
    if (!user) return router.push('/(auth)/login');
    setReportOpen(true);
  };

  const submitSuperDelete = async (code: string | null, note: string) => {
    try {
      await api.delete(`/admin/spots/${id}`, {
        reason_code: code || undefined,
        reason_note: note || undefined,
      });
      Alert.alert('Spot deleted', 'The spot has been permanently removed.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      throw new Error(formatApiError(e));
    }
  };

  // June 2025 stability fix — inline retry state for recoverable errors
  // (timeout / network / server / client). The user STAYS on this screen
  // and can retry, instead of being kicked back to Explore on a slow
  // network. Auth-required errors render a similar gentle message — the
  // axios interceptor already triggers the global logout flow when
  // genuinely warranted (status===401), so no extra redirect needed here.
  //
  // May 2026 — Per user feedback on v2.0.30: a 404 from
  // /api/spots/{id} (deleted spot, stale deep link, wrong DB) used to
  // pop an OS Alert and navigate away, which read as "the app is
  // broken / your connection is bad". Now we surface `missing` to this
  // screen and render a distinct, no-retry view so the user understands
  // the spot is gone, not that something transient failed.
  if (!loading && !spot && errorCategory) {
    const isTimeout = errorCategory === 'timeout';
    const isNet = errorCategory === 'network';
    const isAuth = errorCategory === 'auth';
    const isServer = errorCategory === 'server';
    const isMissing = errorCategory === 'missing';
    // CR Item 5 (May 2026): All copy here was rewritten to read like a
    // premium product, not a casual side project. "Server hiccup",
    // "Tap retry — it usually works", and the like felt apologetic and
    // hobbyist. We've already retried with backoff before reaching
    // this UI, so the error state can speak with confidence about
    // *what* went wrong (connection vs server) and offer a single
    // clean Retry. No exclamation marks, no apologies.
    const headline = isAuth
      ? 'Sign in to continue'
      : isMissing
        ? 'This spot is no longer available'
        : isTimeout
          ? 'This is taking longer than expected'
          : isNet
            ? 'No connection'
            : isServer
              ? "Couldn't load this spot"
              : "Couldn't load this spot";
    const sub = isAuth
      ? 'Your session has ended. Sign in again to view this spot.'
      : isMissing
        ? 'It may have been removed by its owner, made private, or never existed at this link.'
        : isTimeout
          ? 'The server is responding slowly. Check your connection and try again.'
          : isNet
            ? 'Check your connection and try again.'
            : isServer
              ? 'Check your connection and try again.'
              : 'Check your connection and try again.';
    // 404 / 410 aren't recoverable by retrying — hide the Retry CTA and
    // promote "Back to Explore" to the primary action. For every other
    // category (network / timeout / server / unknown / auth) a retry
    // or re-auth can plausibly help, so we keep that button.
    const showRetry = !isMissing;
    const primaryCtaLabel = isAuth ? 'Sign in' : isMissing ? 'Back to Explore' : 'Retry';
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: 24, paddingTop: 80 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 24 }}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/explore');
            }}
            style={{
              width: 36, height: 36, borderRadius: 18,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: colors.surface1,
              borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
            }}
            testID="spot-detail-close"
          >
            <X size={18} color={colors.text} />
          </Pressable>
        </View>
        <Text style={{
          color: colors.text, fontFamily: font.serif, fontSize: 24,
          marginBottom: 10, lineHeight: 30,
        }}>
          {headline}
        </Text>
        <Text style={{
          color: colors.textSecondary, fontFamily: font.body, fontSize: 14,
          lineHeight: 21, marginBottom: 28,
        }}>
          {sub}
        </Text>
        <Pressable
          onPress={() => {
            if (isMissing) {
              // Primary action for "missing" is navigation out —
              // a retry would just re-produce the same 404.
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/explore');
              return;
            }
            load();
          }}
          style={{
            backgroundColor: colors.primary,
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: 'center',
            marginBottom: 12,
          }}
          testID={isMissing ? 'spot-detail-back-to-explore' : 'spot-detail-retry'}
        >
          <Text style={{ color: '#1a1300', fontFamily: font.bodyBold, fontSize: 14 }}>
            {primaryCtaLabel}
          </Text>
        </Pressable>
        {showRetry && (
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)/explore');
          }}
          style={{
            paddingVertical: 14,
            alignItems: 'center',
          }}
          testID="spot-detail-back-to-explore"
        >
          <Text style={{ color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 }}>
            Back to Explore
          </Text>
        </Pressable>
        )}
      </View>
    );
  }

  if (loading || !spot) {
    return <DetailSkeleton />;
  }

  const lightScore = Math.round(((spot.sunrise_rating + spot.sunset_rating + spot.morning_golden_hour_rating + spot.evening_golden_hour_rating) / 4) * 20);
  const accessScore = Math.round(((5 - (spot.permit_required ? 2 : 0) - (spot.fee_required ? 1 : 0) + (spot.accessible ? 1 : 0)) / 5) * 100);
  const safetyScore = (spot.safety_rating || 3) * 20;
  const varietyScore = (spot.variety_rating || 3) * 20;
  const crowdScore = (6 - (spot.crowd_level || 3)) * 20;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Batch #8 — full-screen lightbox (pinch + pan + double-tap zoom).
          Mounted once at the top of the tree; hero carousel taps call
          openLightbox(uri) to pop it open. Hidden by default. */}
      <Lightbox />
      {/* May 2026 batch #4(b) — per-spot OG / Twitter card meta tags.
          WEB ONLY. expo-router/head only produces useful output on the
          web bundle (react-helmet-async renders into <head> for SEO
          + social link previews). On native iOS/Android it requires
          a `plugins: [["expo-router", { origin: "<url>" }]]` config
          in app.json to set up Apple Handoff — without it, the SDK
          fires a dev-time Alert on every render. We don't need
          Handoff (that's a separate feature we'll wire in #4c), so
          we simply don't render Head on native. */}
      {Platform.OS === 'web' ? (
        <Head>
          <title>{`${spot.title} — LumaScout`}</title>
          <meta name="description" content={(spot.description || '').slice(0, 180)} />
          <meta property="og:type" content="website" />
          <meta property="og:title" content={spot.title} />
          <meta
            property="og:description"
            content={
              [spot.city, spot.state].filter(Boolean).join(', ')
                ? `${[spot.city, spot.state].filter(Boolean).join(', ')} — ${(spot.description || '').slice(0, 140)}`
                : (spot.description || '').slice(0, 180)
            }
          />
          <meta property="og:url" content={spotPublicUrl} />
          {orderedImages[0]?.image_url ? (
            <meta property="og:image" content={resolveImageUrl(orderedImages[0].image_url)} />
          ) : null}
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={spot.title} />
          {orderedImages[0]?.image_url ? (
            <meta name="twitter:image" content={resolveImageUrl(orderedImages[0].image_url)} />
          ) : null}
        </Head>
      ) : null}
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroWrap, heroDynamic]}>
          <ScrollView
            ref={heroScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            // May 2026 — paging math now reads the live window width
            // (winW from useWindowDimensions) rather than the
            // module-level `W` snapshot, so dot/counter sync survives
            // device rotation, web preview resize, and tablet
            // multi-tasking.
            onMomentumScrollEnd={(e) => setGalleryIdx(Math.round(e.nativeEvent.contentOffset.x / winW))}
          >
            {/* All image rendering driven by `orderedImages` memo — see
                the CRITICAL FIX comment near the load() hook. Single
                source of truth keeps the hero carousel, dot indicators,
                and galleryIdx swipe state perfectly in sync.
                
                Batch #8 — hero images are now tap-to-open in a
                full-screen lightbox (pinch-zoom, double-tap, swipe-down
                to dismiss) so photographers can actually inspect the
                scene. Swipe navigation between hero images still works
                because the TouchableOpacity is inside the paging
                ScrollView — RN routes pan gestures to the parent and
                taps to the child. */}
            {orderedImages.map((img: any, i: number) => (
              <TouchableOpacity
                key={img.image_url || i}
                activeOpacity={0.95}
                onPress={() => openLightbox(resolveImageUrl(img.image_url, IMG_SIZES.HERO))}
                testID={`spot-hero-image-${i}`}
              >
                <CachedImage
                  source={{ uri: resolveImageUrl(img.image_url, IMG_SIZES.HERO) }}
                  style={[styles.heroImg, heroDynamic]}
                  contentFit="cover"
                />
                {/* v2.0.25 — hero carousel now uses expo-image-backed
                    CachedImage. Cloudflare strips our Cache-Control
                    header to no-store at the edge, so the native RN
                    <Image> (URLCache / OkHttp) was re-downloading full
                    HERO-width JPEGs on every back-navigation. expo-image
                    maintains its own disk cache keyed by URL so this is
                    finally a one-shot load per spot per install. */}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <LinearGradient
            colors={['rgba(10,10,10,0.85)', 'transparent']}
            style={styles.heroGradTop}
          />
          <LinearGradient
            colors={['transparent', 'rgba(10,10,10,0.95)']}
            style={styles.heroGradBottom}
          />
          <SafeAreaView style={styles.heroHead} edges={['top']}>
            <TouchableOpacity onPress={() => router.back()} style={styles.headBtn} testID="spot-back">
              <ChevronLeft color={colors.text} size={22} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={onShare} style={styles.headBtn} testID="spot-share">
              <Share2 color={colors.text} size={18} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onReport} style={styles.headBtn} testID="spot-report">
              <Flag color={colors.text} size={18} />
            </TouchableOpacity>
            {/* Apr 2026 — featured-photo polish: spot owners (creators)
                can also access the cover editor to choose their featured
                photo. Backend now allows owner+admin (was admin-only). */}
            {(isAdminUser || (!!user && spot?.created_by === user?.user_id)) && (
              <TouchableOpacity
                onPress={() => router.push(`/admin/spots/${id}/cover`)}
                style={[styles.headBtn, styles.headBtnAdmin]}
                testID="spot-admin-edit-cover"
                accessibilityLabel={isAdminUser ? "Edit cover photo (admin)" : "Choose featured photo"}
              >
                <Wand2 color={colors.textInverse} size={16} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={toggleSave} style={[styles.headBtn, { backgroundColor: spot.is_saved ? colors.primary : 'rgba(0,0,0,0.5)' }]} testID="spot-save">
              <Bookmark color={spot.is_saved ? colors.textInverse : colors.text} size={18} fill={spot.is_saved ? colors.textInverse : 'transparent'} />
            </TouchableOpacity>
          </SafeAreaView>
          {/* CR #1 Item 2 (June 2025): minimal "2 / 6" counter replaces the
              pagination dot rail. Uses the same bottom overlay position
              so photographers can see which photo they're on without
              competing with the dots. Only surfaces when there are >1
              photos — a single-image spot shouldn't advertise its
              loneliness. */}
          {orderedImages.length > 1 ? (
            <View style={styles.heroCounter} pointerEvents="none">
              <Text style={styles.heroCounterTxt}>
                {Math.min(galleryIdx + 1, orderedImages.length)} / {orderedImages.length}
              </Text>
            </View>
          ) : null}
          {/* Hero arrow buttons (June 2025) — additive affordance for
              users who don't realize the hero is swipeable. Only render
              when there are 2+ images. The buttons sit vertically
              centered on the hero, semi-transparent so they don't
              fight the image, and disabled (faded) at the edges. They
              programmatically scrollTo() the inner ScrollView while
              the swipe gesture remains available everywhere else. */}
          {orderedImages.length > 1 ? (
            <>
              {galleryIdx > 0 ? (
                <TouchableOpacity
                  style={[styles.heroArrow, styles.heroArrowLeft]}
                  onPress={() => {
                    const next = Math.max(0, galleryIdx - 1);
                    heroScrollRef.current?.scrollTo({ x: next * winW, animated: true });
                    setGalleryIdx(next);
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                  accessibilityLabel="Previous photo"
                  testID="spot-hero-prev"
                >
                  <ChevronLeft size={22} color="#fff" />
                </TouchableOpacity>
              ) : null}
              {galleryIdx < orderedImages.length - 1 ? (
                <TouchableOpacity
                  style={[styles.heroArrow, styles.heroArrowRight]}
                  onPress={() => {
                    const next = Math.min(orderedImages.length - 1, galleryIdx + 1);
                    heroScrollRef.current?.scrollTo({ x: next * winW, animated: true });
                    setGalleryIdx(next);
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                  accessibilityLabel="Next photo"
                  testID="spot-hero-next"
                >
                  <ChevronRight size={22} color="#fff" />
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}
          {/* Hero Carousel CR (June 2025 v2.0.20) — when the active hero
              slide is a community upload, surface a subtle "Community"
              attribution pill in the bottom-left so photographers
              instantly understand they're viewing a user-contributed
              shot, not the owner's primary image. Tapping the pill
              jumps to the community uploads section below. */}
          {orderedImages[galleryIdx]?.source === 'community_upload' ? (
            <Pressable
              style={styles.heroCommunityPill}
              onPress={() => {
                // Attribution chip is non-actionable for now; tap is a
                // no-op that keeps the carousel mounted. Future
                // enhancement: scroll-into-view of the community
                // uploads section below.
              }}
              accessibilityLabel={
                orderedImages[galleryIdx]?.contributor?.name
                  ? `Community photo by ${orderedImages[galleryIdx].contributor.name}`
                  : 'Community-contributed photo'
              }
              testID="spot-hero-community-attribution"
            >
              <Camera size={11} color="#fff" />
              <Text style={styles.heroCommunityPillTxt} numberOfLines={1}>
                {orderedImages[galleryIdx]?.contributor?.name
                  ? `By ${orderedImages[galleryIdx].contributor.name}`
                  : 'Community'}
              </Text>
            </Pressable>
          ) : null}
          {/* May 2026 batch #4 item #2.1 — ADMIN photo delete pill.
              Positioned BOTTOM-LEFT so it never covers the share /
              bookmark / wand / report buttons in the header row.
              Single "DELETE" label — unified flow for real images AND
              cover overrides. Backend hard-deletes both the DB row and
              the underlying upload file on disk (when local +
              unreferenced by any other spot). Render-time gated on
              role — zero admin surface for non-admins. */}
          {isAdminUser && orderedImages[galleryIdx] && (orderedImages[galleryIdx].image_id || orderedImages[galleryIdx].image_url) ? (
            <>
              <TouchableOpacity
                onPress={() => onDeletePhoto(orderedImages[galleryIdx])}
                style={styles.photoDeletePill}
                testID="spot-admin-delete-photo"
                accessibilityLabel={`Delete photo ${galleryIdx + 1} of ${orderedImages.length} (admin — hard delete)`}
                hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
              >
                <Trash2 color="#fff" size={14} strokeWidth={2.25} />
                <Text style={styles.photoDeletePillTxt}>DELETE</Text>
              </TouchableOpacity>
              {/* ADMIN context tag — bottom-RIGHT so it mirrors the
                  DELETE pill cleanly, with the photo position counter.
                  Purely informational (non-tappable). */}
              <View style={styles.photoAdminTag} pointerEvents="none">
                <Shield color={colors.primary} size={11} />
                <Text style={styles.photoAdminTagTxt}>
                  ADMIN · {galleryIdx + 1} / {orderedImages.length}
                </Text>
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.content}>
          {spot.visibility_status === 'pending_review' && user?.user_id === spot.owner_user_id && (
            <View style={styles.pendingBanner}>
              <View style={styles.pendingDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingTitle}>Pending moderation review</Text>
                <Text style={styles.pendingBody}>
                  Only you can see this spot. Our team reviews new public submissions to keep quality high — usually within 24h.
                </Text>
              </View>
            </View>
          )}
          {spot.visibility_status === 'rejected' && user?.user_id === spot.owner_user_id && (
            <View style={[styles.pendingBanner, { borderColor: colors.secondary, backgroundColor: 'rgba(208,72,72,0.08)' }]}>
              <View style={[styles.pendingDot, { backgroundColor: colors.secondary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingTitle}>Submission rejected</Text>
                <Text style={styles.pendingBody}>
                  This spot didn't meet our public guidelines. It's private to you — edit and resubmit, or make it private/followers-only.
                </Text>
              </View>
            </View>
          )}

          {/* BATCH 2 (Apr 2026): owner-only "Request edits" entry point.
              Admins / super_admins don't see this — they use direct
              edit via the admin menu. Keeps the flow unambiguous. */}
          {user?.user_id === spot.owner_user_id && user?.role !== 'admin' && user?.role !== 'super_admin' && (
            <Pressable
              onPress={() => router.push(`/spot/${String(id)}/request-edit` as any)}
              style={styles.requestEditBtn}
              testID="spot-request-edit"
            >
              <Text style={styles.requestEditTxt}>Request edits to this spot</Text>
            </Pressable>
          )}

          {/* Feature 4 (Scope B, May 2026) — Owner / admin actions row.
              Three actions on a private-spot owner's view:
                • Share with client → ShareWithClientSheet
                • Visibility       → VisibilityToggleSheet
                • Edit spot        → /spot/edit/[id]
              For admins viewing someone else's spot, the same row
              shows. For non-owner non-admins, the entire row hides. */}
          {(() => {
            const isOwner = !!(user && user.user_id === spot.owner_user_id);
            const isAdmin = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'moderator';
            if (!isOwner && !isAdmin) return null;
            const isPublicSpot = spot.privacy_mode === 'public' || spot.privacy_mode === 'premium';
            return (
              <View style={ownerStyles.row} testID="spot-owner-actions">
                <Pressable
                  style={ownerStyles.btn}
                  onPress={() => setShareOpen(true)}
                  testID="spot-share-client"
                >
                  <Link2 size={16} color={colors.primary} />
                  <Text style={ownerStyles.btnText}>Share Location</Text>
                </Pressable>
                <Pressable
                  style={ownerStyles.btn}
                  onPress={() => setVisibilityOpen(true)}
                  testID="spot-visibility"
                >
                  {isPublicSpot
                    ? <Globe size={16} color={colors.primary} />
                    : <Lock size={16} color={colors.warning} />}
                  <Text style={ownerStyles.btnText}>{isPublicSpot ? 'Public' : 'Private'}</Text>
                </Pressable>
                <Pressable
                  style={ownerStyles.btn}
                  onPress={() => router.push(`/spot/edit/${String(id)}` as any)}
                  testID="spot-edit"
                >
                  <PencilLine size={16} color={colors.primary} />
                  <Text style={ownerStyles.btnText}>Edit spot</Text>
                </Pressable>
              </View>
            );
          })()}
          {spot.park_group_id && spot.park_name ? (
            <TouchableOpacity
              style={styles.parkBreadcrumb}
              onPress={() => router.push(`/park/${spot.park_group_id}` as any)}
              testID="spot-park-breadcrumb"
              activeOpacity={0.7}
            >
              <View style={styles.parkBreadcrumbIcon}>
                <Layers size={11} color={colors.primary} />
              </View>
              <Text style={styles.parkBreadcrumbLabel}>INSIDE</Text>
              <Text style={styles.parkBreadcrumbName} numberOfLines={1}>
                {spot.park_name}
              </Text>
              <ChevronRight size={13} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
          <Text style={styles.title}>{spot.title}</Text>
          <View style={styles.metaRow}>
            <MapPin size={14} color={colors.textSecondary} />
            <Text style={styles.meta}>{spot.city}, {spot.state}</Text>
            {(() => { const d = formatDistance(spot); return d ? <Text style={styles.meta}>  ·  {d}</Text> : null; })()}
          </View>

          {(spot.freshness && spot.freshness !== 'unknown') && (
            <View style={{ alignSelf: 'flex-start', marginTop: 6, flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <FreshnessBadge freshness={spot.freshness} label={spot.freshness_label} />
              <ActivityBadge lastActivityAt={spot.last_activity_at} recentUploadCount7d={spot.recent_upload_count_7d} />
            </View>
          )}
          {spot.on_site_verified || spot.capture_source === 'camera_capture' ? (
            <View style={styles.onSiteBadge} testID="spot-on-site-verified">
              <MapPin size={11} color={colors.textInverse} />
              <Text style={styles.onSiteBadgeTxt}>On-Site Verified</Text>
            </View>
          ) : null}
          {(!spot.freshness || spot.freshness === 'unknown') && spot.last_activity_at ? (
            <View style={{ alignSelf: 'flex-start', marginTop: 6 }}>
              <ActivityBadge lastActivityAt={spot.last_activity_at} recentUploadCount7d={spot.recent_upload_count_7d} />
            </View>
          ) : null}

          <View style={styles.tagRow}>
            {(spot.shoot_types || []).map((t: string) => (
              <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>
            ))}
            {(spot.style_tags || []).slice(0, 3).map((t: string) => (
              <View key={`s-${t}`} style={[styles.tag, { backgroundColor: 'transparent', borderColor: colors.border, borderWidth: 1 }]}>
                <Text style={[styles.tagText, { color: colors.textSecondary }]}>{t}</Text>
              </View>
            ))}
          </View>

          {/*
            ════════════════════════════════════════════════════════════
            JUNE 2025 LOCATION DETAIL REDESIGN — "Field Guide" layout
            ────────────────────────────────────────────────────────────
            Order:
              1. Title + city + categories (above this comment)
              2. Light + Drive info card (golden / blue / drive)
              3. Owner row + description (compact)
              4. Primary actions (Directions / Save / Check-in)
              5. Why photographers love this spot (chip rail)
              6. Best light rating module (compact stars)
              7. Land-access disclosure (compact)
              8. Know before you go (chip strip — replaces logistics)
              9. Recent photos (merged: uploads / seasonal / conditions)
             10. Similar nearby (compact horizontal cards w/ drive time)
             11. Secondary actions (Add photos / Add update / AI / Scout)
             12. Admin tools (manage photos / super-admin delete)
            All previous "Shoot Intelligence" rings, "Best time" score
            cards, dense logistics rows, and "No reviews yet" empty
            states are deliberately gone — they competed with the
            photograph and slowed scanning in the field. ════════════
          */}

          {/* ── 2. Light info card — Golden + Blue hour only ───────
                June 2025 update: drive time was REMOVED from this
                card per design CR. Drive time still surfaces on the
                Explore map preview where it's most useful (decision
                time before driving). On the detail page, the user is
                already committed — golden / blue hour timing is the
                only signal that matters here. */}
          {(() => {
            const lat = spot.latitude;
            const lng = spot.longitude;
            const hasCoords = typeof lat === 'number' && typeof lng === 'number';
            void planningTick;
            // eslint-disable-next-line react-hooks/exhaustive-deps
            const goldenP = hasCoords ? goldenHourPlanning(lat, lng) : null;
            // eslint-disable-next-line react-hooks/exhaustive-deps
            const blueP = hasCoords ? blueHourPlanning(lat, lng) : null;
            return (
              <View style={styles.lightDriveCard} testID="spot-light-drive-card">
                <View style={styles.lightDriveCol}>
                  <View style={styles.lightDriveLabelRow}>
                    <Sun size={12} color={colors.primary} />
                    <Text style={styles.lightDriveLabel}>Golden hour</Text>
                  </View>
                  <Text
                    style={styles.lightDriveValueGold}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    allowFontScaling
                  >
                    {goldenP ? goldenP.countdown : '—'}
                  </Text>
                  <Text style={styles.lightDriveSub} numberOfLines={1}>
                    {goldenP ? goldenP.windowLabel : 'unavailable'}
                  </Text>
                </View>
                <View style={styles.lightDriveDivider} />
                <View style={styles.lightDriveCol}>
                  <View style={styles.lightDriveLabelRow}>
                    <Sun size={12} color="#60A5FA" />
                    <Text style={styles.lightDriveLabel}>Blue hour</Text>
                  </View>
                  <Text
                    style={styles.lightDriveValueBlue}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    allowFontScaling
                  >
                    {blueP ? blueP.countdown : '—'}
                  </Text>
                  <Text style={styles.lightDriveSub} numberOfLines={1}>
                    {blueP ? blueP.windowLabel : 'unavailable'}
                  </Text>
                </View>
              </View>
            );
          })()}

          {/* ── 3a. Owner row (compact) ───────────────────────────── */}
          <SectionErrorBoundary label="owner-row">
          {spot.owner && (
            <View style={[styles.ownerRow, { marginTop: space.lg }]}>
              <TouchableOpacity onPress={() => router.push(`/user/${spot.owner.user_id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                {spot.owner.avatar_url ? (
                  <Image source={{ uri: spot.owner.avatar_url }} style={styles.ownerAvatar} />
                ) : (
                  <View style={[styles.ownerAvatar, { backgroundColor: colors.surface2 }]} />
                )}
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 }}>{spot.owner.name}</Text>
                    <VerifiedBadge status={spot.owner.verification_status} variant="inline" size={14} />
                    <UserBadge user={spot.owner} variant="inline" />
                  </View>
                  <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12 }}>
                    {spot.owner.verification_status === 'verified' ? 'Verified contributor' : 'Contributor'}
                  </Text>
                </View>
              </TouchableOpacity>
              {user && user.user_id !== spot.owner.user_id && (
                <Button title="Follow" variant="secondary" onPress={toggleFollow} testID="spot-follow" style={{ paddingVertical: 10, paddingHorizontal: 18 }} />
              )}
            </View>
          )}
          </SectionErrorBoundary>

          {/* ── 3b. Description ───────────────────────────────────── */}
          {(spot.description || isAdminUser) ? (
            <View style={styles.descBlock}>
              {isAdminUser ? (
                <View style={styles.descHeaderRow}>
                  <Text style={styles.descHeaderLabel}>DESCRIPTION</Text>
                  <TouchableOpacity onPress={() => setDescEditOpen(true)} style={styles.descEditBtn} hitSlop={8} testID="spot-desc-edit">
                    <PenLine color={colors.primary} size={13} />
                    <Text style={styles.descEditTxt}>{spot.description ? 'Edit' : 'Add description'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {spot.description ? (
                <Text style={styles.desc}>{spot.description}</Text>
              ) : isAdminUser ? (
                <Text style={styles.descPlaceholder}>No description yet — tap "Add description" to write one.</Text>
              ) : null}
            </View>
          ) : null}

          {/* ── 4. Primary actions row removed (June 2025 CR) ────
                Save / Directions / Check-in already live in the sticky
                bottom bar — duplicating them mid-page added clutter
                without adding utility. Sticky bar is the only entry
                point now. */}

          {spot.location_display_mode === 'approximate' && (
            <View style={[styles.privacyNote, { marginTop: space.md }]}>
              <MapPin size={14} color={colors.info} />
              <Text style={styles.privacyNoteTxt}>Approximate location shown — exact coordinates protected.</Text>
            </View>
          )}
          {spot.location_display_mode === 'hidden' && (
            <View style={[styles.privacyNote, { marginTop: space.md }]}>
              <MapPin size={14} color={colors.info} />
              <Text style={styles.privacyNoteTxt}>Map pin hidden by owner. Contact contributor for details.</Text>
            </View>
          )}

          {/* ── "Plan This Shoot" CTA (Jun 2025) ──────────────────────
              Opens a full-screen ShootPlanSheet modal that aggregates
              sun-based light timeline, 5-day Open-Meteo weather,
              composition tips, and up to 2 nearby backup spots within
              10 mi. The shoot plan is fetched ONLY when the modal is
              opened so Spot Detail keeps rendering instantly. */}
          <TouchableOpacity
            style={shootPlanCtaStyles.btn}
            activeOpacity={0.9}
            onPress={() => setShootPlanOpen(true)}
            testID="spot-plan-this-shoot"
          >
            <LinearGradient
              colors={['rgba(245,166,35,0.22)', 'rgba(245,166,35,0.05)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={shootPlanCtaStyles.gradient}
            >
              <View style={shootPlanCtaStyles.glyph}>
                <Sunrise size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={shootPlanCtaStyles.kicker}>Build a shoot plan</Text>
                <Text style={shootPlanCtaStyles.title}>Plan this shoot</Text>
                <Text style={shootPlanCtaStyles.sub} numberOfLines={2}>
                  Best light times, 5-day weather, composition tips, and backup spots — all in one place.
                </Text>
              </View>
              <ChevronRight size={18} color={colors.primary} />
            </LinearGradient>
          </TouchableOpacity>

          {/* ── 5. Why photographers love this spot (chips) ─────── */}
          {(() => {
            type Chip = { icon: any; label: string };
            const chips: Chip[] = [];
            const seen = new Set<string>();
            const add = (label: string, icon: any) => {
              if (!label) return;
              const k = label.toLowerCase();
              if (seen.has(k)) return;
              seen.add(k);
              chips.push({ icon, label });
            };
            // Sun-quality chips from the existing per-window ratings.
            if ((spot.sunset_rating || 0) >= 4) add('Stunning sunsets', <Sunset size={18} color={colors.primary} />);
            if ((spot.sunrise_rating || 0) >= 4) add('Magical sunrises', <Sunrise size={18} color={colors.primary} />);
            if ((spot.evening_golden_hour_rating || 0) >= 4) add('Dreamy golden hour', <Sun size={18} color={colors.primary} />);
            // Logistics chips.
            if (/free|easy|ample|lot/i.test(spot.parking_notes || '')) add('Easy parking', <ParkingCircle size={18} color={colors.primary} />);
            if (/quiet|empty|low|few/i.test(spot.crowd_notes || spot.access_notes || '')) add('Low crowds', <Sparkles size={18} color={colors.primary} />);
            if (spot.dog_friendly) add('Pet friendly', <HeartIcon size={18} color={colors.primary} />);
            if (spot.kid_friendly) add('Kid friendly', <HeartIcon size={18} color={colors.primary} />);
            if (spot.accessible) add('Easy access', <Zap size={18} color={colors.primary} />);
            if (spot.indoor) add('Weather-proof', <Coffee size={18} color={colors.primary} />);
            // Photography category chips.
            if (Array.isArray(spot.shoot_types) && spot.shoot_types.includes('portrait')) add('Great for portraits', <Camera size={18} color={colors.primary} />);
            if (Array.isArray(spot.shoot_types) && spot.shoot_types.includes('landscape')) add('Iconic landscapes', <Mountain size={18} color={colors.primary} />);
            if (chips.length === 0) return null;
            return (
              <View style={styles.whyLoveSection}>
                <Text style={styles.whyLoveTitle}>Why photographers love this spot</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.whyLoveRow}>
                  {chips.slice(0, 8).map((c, i) => (
                    <View key={`${c.label}-${i}`} style={styles.whyLoveChip}>
                      {c.icon}
                      <Text style={styles.whyLoveTxt}>{c.label}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            );
          })()}

          {/* ── 6. Best light (compact star module) ───────────────── */}
          {(() => {
            const stars = (n?: number) => {
              const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
              return '★'.repeat(v) + '☆'.repeat(5 - v);
            };
            const items: { label: string; value: string }[] = [];
            if (spot.evening_golden_hour_rating != null || spot.morning_golden_hour_rating != null) {
              const peak = Math.max(spot.evening_golden_hour_rating || 0, spot.morning_golden_hour_rating || 0);
              if (peak > 0) items.push({ label: 'Golden hour', value: stars(peak) });
            }
            if (spot.sunset_rating) items.push({ label: 'Sunset', value: stars(spot.sunset_rating) });
            if (spot.sunrise_rating) items.push({ label: 'Sunrise', value: stars(spot.sunrise_rating) });
            if (spot.best_season && spot.best_season !== 'any') {
              const lbl = String(spot.best_season).charAt(0).toUpperCase() + String(spot.best_season).slice(1);
              items.push({ label: lbl, value: '★★★★★' });
            }
            if (items.length === 0) return null;
            return (
              <View style={{ marginTop: space.xl }}>
                <Text style={styles.sectionHeaderTitle}>Best light</Text>
                <View style={{ marginTop: 10, gap: 6 }}>
                  {items.map((it) => (
                    <View key={it.label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 }}>{it.label}</Text>
                      <Text style={{ color: colors.text, fontFamily: font.bodyBold, fontSize: 13 }}>{it.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}

          {/* ── 7. Land access disclosure (compact) ──────────────── */}
          {(spot.land_access || spot.access_notes) ? (
            <View style={{
              marginTop: space.xl,
              padding: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: spot.land_access === 'private' ? 'rgba(157,89,255,0.45)' : 'rgba(34,197,94,0.35)',
              backgroundColor: spot.land_access === 'private' ? 'rgba(157,89,255,0.07)' : 'rgba(34,197,94,0.05)',
              gap: 4,
            }}>
              <Text style={{
                color: spot.land_access === 'private' ? '#c8a8ff' : '#22c55e',
                fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.6,
              }}>
                {spot.land_access === 'public' ? 'PUBLIC LAND'
                  : spot.land_access === 'private' ? 'PRIVATE LAND — PERMISSION REQUIRED'
                  : 'LAND ACCESS UNCONFIRMED'}
              </Text>
              {spot.access_notes ? (
                <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12.5, lineHeight: 17 }}>
                  {spot.access_notes}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* ── 8. Know before you go (chip strip — replaces dense logistics rows) ── */}
          {(() => {
            type KbygChip = { icon: any; label: string };
            const out: KbygChip[] = [];
            if (spot.land_access === 'public') out.push({ icon: <MapPin size={12} color={colors.primary} />, label: 'Public park' });
            if (spot.parking_notes) out.push({ icon: <Car size={12} color={colors.primary} />, label: 'Parking available' });
            if (spot.permit_required) out.push({ icon: <TicketIcon size={12} color={colors.warning} />, label: 'Permit required' });
            if (spot.fee_required) out.push({ icon: <TicketIcon size={12} color={colors.warning} />, label: 'Entry fee' });
            if (spot.kid_friendly) out.push({ icon: <HeartIcon size={12} color={colors.primary} />, label: 'Kid friendly' });
            if (spot.dog_friendly) out.push({ icon: <HeartIcon size={12} color={colors.primary} />, label: 'Dog friendly' });
            if (spot.accessible) out.push({ icon: <Zap size={12} color={colors.primary} />, label: 'Accessible' });
            if (spot.lens_recommendations) out.push({ icon: <Camera size={12} color={colors.primary} />, label: 'Bring a wide lens' });
            if (out.length === 0) return null;
            return (
              <View style={styles.kbygSection}>
                <Text style={styles.sectionHeaderTitle}>Know before you go</Text>
                <View style={styles.kbygChipRow}>
                  {out.slice(0, 8).map((c, i) => (
                    <View key={`${c.label}-${i}`} style={styles.kbygChip}>
                      {c.icon}
                      <Text style={styles.kbygChipTxt}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}

          {/* Walking / parking long-form notes (read-once details, not chips) */}
          {(spot.parking_notes || spot.walking_notes) ? (
            <View style={{ marginTop: space.lg, gap: 8 }}>
              {spot.parking_notes ? (
                <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12.5, lineHeight: 17 }}>
                  <Text style={{ color: colors.text, fontFamily: font.bodyBold }}>Parking · </Text>{spot.parking_notes}
                </Text>
              ) : null}
              {spot.walking_notes ? (
                <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12.5, lineHeight: 17 }}>
                  <Text style={{ color: colors.text, fontFamily: font.bodyBold }}>Walk · </Text>{spot.walking_notes}
                </Text>
              ) : null}
            </View>
          ) : null}

          {spot.last_verified_at && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md }}>
              <CheckCircle size={12} color={colors.success} />
              <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 11 }}>
                Last verified {new Date(spot.last_verified_at).toLocaleDateString()}
              </Text>
            </View>
          )}

          {/* ── 9. Recent photos (merged: uploads / seasonal / conditions) ── */}
          {!!spot.spot_id && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderTitle}>Recent photos</Text>
                {spot.last_activity_at ? (
                  <Text style={styles.sectionHsub}>Updated {timeAgo(spot.last_activity_at)}</Text>
                ) : null}
              </View>
              <View style={{ marginHorizontal: -space.xl }}>
                <SectionErrorBoundary label="community-uploads">
                  <CommunityUploadsSection
                    spotId={spot.spot_id}
                    initial={communityUploads.length > 0 ? communityUploads : undefined}
                    onAny={() => {
                      api.get(`/spots/${id}/uploads`, { limit: 24 })
                        .then((r: any) => {
                          if (Array.isArray(r?.items)) setCommunityUploads(r.items);
                        })
                        .catch(() => {});
                    }}
                  />
                </SectionErrorBoundary>
              </View>

              {/* Latest conditions text feed — only if there ARE updates.
                  Empty-state CTA replaces the old "No recent updates" dead zone. */}
              <View style={{ marginTop: space.lg }}>
                <SectionErrorBoundary label="latest-conditions">
                  <LatestConditionsSection spotId={spot.spot_id} />
                </SectionErrorBoundary>
              </View>

              {/* Seasonal timeline — only renders when uploads span multiple seasons */}
              {spot.seasonal_timeline_total > 0 ? (
                <View style={{ marginTop: space.xl, marginHorizontal: -space.xl }}>
                  <SectionErrorBoundary label="seasonal-timeline">
                    <SeasonalTimelineSection spotId={spot.spot_id} initial={spot.seasonal_timeline} />
                  </SectionErrorBoundary>
                </View>
              ) : null}
            </>
          )}

          {/* Reviews — ONLY rendered when at least one review exists.
              Empty state ("No reviews yet") deliberately removed in
              the June 2025 redesign to eliminate visual dead zones. */}
          {Array.isArray(spot.reviews) && spot.reviews.length > 0 && (
            <SectionErrorBoundary label="reviews">
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderTitle}>Field notes · {spot.review_count || 0}</Text>
                <TouchableOpacity onPress={() => router.push(`/review/${id}`)} testID="spot-new-review">
                  <Text style={styles.sectionHeaderLink}>Add check-in</Text>
                </TouchableOpacity>
              </View>
              <View style={{ gap: space.md }}>
                {(spot.reviews || []).slice(0, 3).map((r: any) => (
                  <View key={r.review_id} style={styles.reviewCard}>
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                      {r.user?.avatar_url ? (
                        <Image source={{ uri: r.user.avatar_url }} style={{ width: 28, height: 28, borderRadius: 14 }} />
                      ) : <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface2 }} />}
                      <Text style={{ color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 }}>{r.user?.name || 'Photographer'}</Text>
                      <Text style={{ color: colors.primary, fontFamily: font.bodyBold, fontSize: 13 }}>{r.overall_rating}★</Text>
                    </View>
                    {r.comment ? <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18 }}>{r.comment}</Text> : null}
                  </View>
                ))}
              </View>
            </SectionErrorBoundary>
          )}

          {/* ── 10. Similar nearby (compact horizontal cards) ────── */}
          <SectionErrorBoundary label="similar-spots">
          {spot.similar_spots && spot.similar_spots.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderTitle}>Similar nearby</Text>
              </View>
              <View style={{ gap: 4 }}>
                {spot.similar_spots.slice(0, 5).map((s: any) => {
                  const drive = driveTimeEstimate(
                    userCoords ? { latitude: userCoords.lat, longitude: userCoords.lng } : null,
                    typeof s.latitude === 'number' && typeof s.longitude === 'number'
                      ? { latitude: s.latitude, longitude: s.longitude } : null,
                  );
                  // eslint-disable-next-line react-hooks/exhaustive-deps
                  const goldBrief = (typeof s.latitude === 'number' && typeof s.longitude === 'number')
                    ? goldenHourBrief(s.latitude, s.longitude) : null;
                  void planningTick;
                  return (
                    <TouchableOpacity
                      key={s.spot_id || s.id || s._id}
                      style={styles.similarCard}
                      onPress={() => router.push(`/spot/${s.spot_id || s.id || s._id}`)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.similarThumb}>
                        {s.hero_cover_image_url ? (
                          <Image source={{ uri: s.hero_cover_image_url }} style={{ width: '100%', height: '100%' }} />
                        ) : null}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.similarTitle} numberOfLines={1}>{s.title}</Text>
                        <Text style={styles.similarMeta} numberOfLines={1}>
                          {s.city}{s.state ? `, ${s.state}` : ''}
                          {(() => { const d = formatDistance(s); return d ? ` · ${d}` : ''; })()}
                        </Text>
                        {goldBrief ? (
                          <Text style={[styles.similarMeta, { color: colors.primary, fontFamily: font.bodyMedium }]} numberOfLines={1}>
                            {goldBrief}
                          </Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        {drive ? (
                          <>
                            <Text style={styles.similarDrive}>{drive.label.replace(/^Approx\. /, '').replace(/ drive$/, '')}</Text>
                            <Text style={styles.similarDriveSub}>drive</Text>
                          </>
                        ) : (
                          <Text style={styles.similarDriveSub}>—</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
          </SectionErrorBoundary>

          {/* ── 11. Secondary actions (de-prioritised AI + community CTAs) ── */}
          {!!spot.spot_id && (
            <View style={styles.secondarySection}>
              <View style={styles.secondaryRow}>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => router.push(`/spot/${spot.spot_id}/upload` as any)}
                  testID="spot-add-photos"
                  activeOpacity={0.85}
                >
                  <Camera size={14} color={colors.primary} />
                  <Text style={styles.secondaryBtnTxt}>Add photos</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => router.push(`/spot/${spot.spot_id}/update` as any)}
                  testID="spot-add-update"
                  activeOpacity={0.85}
                >
                  <PenLine size={14} color={colors.primary} />
                  <Text style={styles.secondaryBtnTxt}>Add update</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.secondaryRow}>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => setShotListOpen(true)}
                  testID="spot-shot-list"
                  activeOpacity={0.85}
                >
                  <Wand2 size={14} color={colors.primary} />
                  <Text style={styles.secondaryBtnTxt}>AI shot list</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => setAtcOpen(true)}
                  testID="spot-add-collection"
                  activeOpacity={0.85}
                >
                  <FolderPlus size={14} color={colors.primary} />
                  <Text style={styles.secondaryBtnTxt}>Add to collection</Text>
                </TouchableOpacity>
              </View>
              {/* Scout AI helper kept at the very bottom of secondary
                  actions so it never competes with the field-guide
                  hierarchy above. Subtle, opt-in. */}
              <ScoutAICard
                placement="spot_detail"
                spotId={spot.spot_id}
                subtitle={`Ask about fit, best light, or compare nearby options.`}
              />
            </View>
          )}

          {/* ── 12a. Admin photo manager (admin / super-admin only) ── */}
          {isAdminUser && (
            <TouchableOpacity
              style={sadStyles.photoMgrCard}
              onPress={() => router.push(`/admin/spots/${id}/cover`)}
              testID="admin-manage-photos"
              activeOpacity={0.85}
            >
              <View style={sadStyles.photoMgrIcon}>
                <Wand2 size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={sadStyles.photoMgrTitle}>Manage photos</Text>
                <Text style={sadStyles.photoMgrSub} numberOfLines={2}>
                  Change the cover, reorder the gallery, remove weak photos. Updates Explore + map + saved instantly.
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}

          {/* ── 12b. Super-admin destructive controls — last on page ── */}
          {user?.role === 'super_admin' && (
            <View style={sadStyles.dangerZone}>
              <View style={sadStyles.dangerHead}>
                <Shield size={14} color={colors.secondary} />
                <Text style={sadStyles.dangerTitle}>Super admin tools</Text>
              </View>
              <Text style={sadStyles.dangerBody}>
                Permanently remove this spot and clean up saves, reviews, check-ins, reports,
                collection references, and community-post links. A snapshot is kept for audit.
              </Text>
              <TouchableOpacity
                style={sadStyles.dangerBtn}
                onPress={() => setDeleteOpen(true)}
                testID="super-delete-spot"
              >
                <Trash2 size={14} color="#fff" />
                <Text style={sadStyles.dangerBtnTxt}>Delete spot permanently</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {user && (
        <View
          style={[
            styles.stickyBar,
            {
              // Android system-nav inset + iOS home indicator inset.
              paddingBottom: Math.max(insets.bottom + 6, 14),
            },
          ]}
          testID="spot-sticky-bar"
        >
          <TouchableOpacity style={styles.stickyBtn} onPress={toggleSave} testID="spot-action-save">
            <Bookmark size={18} color={spot.is_saved ? colors.primary : colors.text} fill={spot.is_saved ? colors.primary : 'transparent'} />
            <Text style={[styles.stickyBtnTxt, spot.is_saved && { color: colors.primary }]}>{spot.is_saved ? 'Saved' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.stickyBtn, styles.stickyBtnGold]}
            onPress={openDirections}
            testID="spot-action-directions"
          >
            <Navigation size={18} color="#1a1300" />
            <Text style={styles.stickyBtnTxtGold}>Directions</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stickyBtn}
            onPress={() => router.push(`/review/${id}`)}
            testID="spot-action-review"
          >
            <MessageSquarePlus size={18} color={colors.text} />
            <Text style={styles.stickyBtnTxt}>Check-in</Text>
          </TouchableOpacity>
        </View>
      )}

      <AddToCollectionSheet visible={atcOpen} onClose={() => setAtcOpen(false)} spotId={id} />
      {/* Plan This Shoot modal — Jun 2025. Lazy fetched. Renders even
          when `spot` is fully loaded so we don't crash on visibility. */}
      <ShootPlanSheet
        visible={shootPlanOpen}
        onClose={() => setShootPlanOpen(false)}
        spotId={id as string}
        spotName={spot?.title}
      />
      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="spot"
        targetId={id}
        title={`Report "${spot.title}"`}
      />
      <ShotListSheet
        visible={shotListOpen}
        onClose={() => setShotListOpen(false)}
        spotId={id}
        spotTitle={spot.title}
      />

      <DeleteConfirmSheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={submitSuperDelete}
        title="Delete this spot?"
        warning="Hard delete — the spot is removed from feeds, search, and the map. Saves, reviews, check-ins, reports and collection references are cleaned up. A snapshot is archived. Cannot be undone in the app."
        targetLabel={`${spot.title}  ·  ${spot.city || ''}${spot.state ? ', ' + spot.state : ''}`}
        confirmPhrase="delete"
        presets={SPOT_DELETE_PRESETS}
        destructiveCta="Delete spot permanently"
      />

      {/* May 2026 — admin-only description editor. We render the
          modal unconditionally (cheap; native renders nothing while
          visible=false) and gate visibility on isAdminUser+state so a
          non-admin can never trip into it through devtools. */}
      {isAdminUser ? (
        <DescriptionEditorSheet
          visible={descEditOpen}
          spotId={id}
          spotTitle={spot.title}
          initialValue={spot.description || ''}
          onClose={() => setDescEditOpen(false)}
          onSaved={(next) => {
            // Optimistic merge — the spot detail listener also fires
            // a load() on focus return, but updating in-place removes
            // the perceptible flash between save and refetch.
            setSpot((s: any) => (s ? { ...s, description: next } : s));
          }}
        />
      ) : null}

      {/* Feature 4 (Scope B) — share + visibility sheets. Always
          rendered (cheap, transparent when visible=false) so the gating
          stays in props. */}
      <ShareWithClientSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        spotId={String(id)}
        spotTitle={spot.title}
        spotIsPublic={spot.privacy_mode === 'public' || spot.privacy_mode === 'premium'}
      />
      <VisibilityToggleSheet
        visible={visibilityOpen}
        onClose={() => setVisibilityOpen(false)}
        spotId={String(id)}
        spotTitle={spot.title}
        currentPrivacy={spot.privacy_mode || 'public'}
        currentDisplayMode={spot.location_display_mode || 'exact'}
        onSaved={(next) => {
          setSpot((s: any) => (s ? {
            ...s,
            privacy_mode: next.visibility === 'public' ? 'public' : 'private',
            location_display_mode: next.show_exact_location ? 'exact' : 'approximate',
          } : s));
        }}
      />
    </View>
  );
}

// Feature 4 — owner / admin actions row styles. Kept local so the
// surrounding spot-detail style file doesn't grow unbounded.
const ownerStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.md,
    marginBottom: space.sm,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface2,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44, // iOS touch target
  },
  btnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
});

// "Plan This Shoot" CTA card styles (Jun 2025). Kept local so the
// main spot-detail StyleSheet doesn't grow unbounded. Premium dark-mode
// look — subtle gold gradient, rounded corners, single-tap target.
const shootPlanCtaStyles = StyleSheet.create({
  btn: {
    marginTop: space.lg,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  glyph: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(245,166,35,0.18)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  kicker: { color: colors.kicker, fontFamily: font.bodySemibold, fontSize: 10, letterSpacing: 0.4 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 18, letterSpacing: -0.2, marginTop: 1 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 3, lineHeight: 16 },
});

