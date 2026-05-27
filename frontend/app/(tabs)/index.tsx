/**
 * LumaScout Home — Cinematic Minimal Edition v2 (June 2025).
 *
 * Refined to match the approved design mockup:
 *   • Header: greeting + bold headline + sun-icon golden-hour line with
 *     gold-highlighted countdown. Three circular header buttons on the
 *     right (chat + bell + avatar).
 *   • Hero card: AI-PICK pill top-left (with sparkle icon, green border),
 *     weather pill top-right (cloud-sun icon + temp + condition),
 *     GREAT LIGHT label above big title, pin icon for location,
 *     four-stat row with circular icon backgrounds and colored values,
 *     two CTAs: dark Navigate (outline) + gold Save Spot (filled).
 *   • Quick actions section heading + 4 equal cards.
 *   • Insight card with green sparkle icon.
 *
 * Same /api/feed/home backend — no API changes. SWR cache + GPS handling
 * preserved from v1.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Animated,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import {
  MessageCircle,
  Bell,
  Map as MapIcon,
  Navigation,
  Bookmark,
  Plus,
  Sun,
  Moon,
  Users,
  CloudSun,
  MapPin,
  Mountain,
  Car,
  ChevronRight,
  Sparkles,
} from 'lucide-react-native';
import SafeImage from '../../src/components/SafeImage';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useGps } from '../../src/hooks/useGps';
import { useUnreadMessages } from '../../src/hooks/useUnreadMessages';
import { colors, font, space, radii } from '../../src/theme';
import { readCache, writeCache } from '../../src/utils/swrCache';
import { resolveSpotCoverForListCard } from '../../src/utils/spot-cover';
import { calculateDistanceMiles } from '../../src/utils/distance';
import { goldenHourLabel } from '../../src/utils/sun';
import { nextLightWindow, formatCountdownHHMM, headerForWindow, labelForWindow } from '../../src/utils/light-windows';
import { getCachedCoords, setCachedCoords } from '../../src/utils/cached-coords';

type Feed = Record<string, any[]>;

// ─── Helpers ────────────────────────────────────────────────────────────

function timeOfDayGreeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

/** Returns { text, gold } where `gold` is the countdown chunk to highlight,
 *  e.g. text="Golden hour starts in" gold="42 min". Phase-aware for the
 *  user's current location, expressed in TODAY'S local sun events.
 *
 *    • Pre-dawn / overnight              → "Sunrise in 5h 12m"
 *    • Morning blue hour (dawn→sunrise)  → "Sunrise in 18 min"
 *    • Morning golden hour               → "Golden hour ending in 24 min"
 *    • Daytime, before evening golden    → "Golden hour starts in 3h"
 *    • Evening golden hour (>15m sunset) → "Golden hour ending in 32 min"
 *    • Last 15 min before sunset         → "Sunset in 12 min"
 *    • Blue hour (sunset → civil dusk)   → "Blue hour ending in 18 min"
 *    • After dusk (full night)           → "Sunrise in 7h 4m"
 *
 *  All windows are computed in the SPOT'S local time via SunCalc;
 *  `goldenHour` = 6° above horizon, `goldenHourEnd` = morning end.
 *  `dusk` = civil dusk (when blue hour ends).
 *  Returns null when SunCalc cannot resolve the events for this lat/date
 *  (polar regions near solstice).
 */
function goldenCountdownParts(
  coords?: { latitude: number; longitude: number } | null,
  now: Date = new Date(),
): { text: string; gold: string } | null {
  if (!coords) return null;
  try {
    const SunCalc = require('suncalc');
    const t = SunCalc.getTimes(now, coords.latitude, coords.longitude);
    const dawn: Date | undefined = t.dawn;
    const sunrise: Date | undefined = t.sunriseEnd || t.sunrise;
    const morningGoldenEnd: Date | undefined = t.goldenHourEnd;
    const eveningGoldenStart: Date | undefined = t.goldenHour;     // sun at +6°
    const sunset: Date | undefined = t.sunsetStart || t.sunset;
    const dusk: Date | undefined = t.dusk;

    // Helper — return true if every Date in the list is a real Date (not NaN).
    const valid = (...ds: (Date | undefined)[]) =>
      ds.every((d) => d && !Number.isNaN(d.getTime()));

    const fmtMins = (ms: number): string => {
      const mins = Math.max(1, Math.round(ms / 60000));
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m === 0 ? `${h}h` : `${h}h ${m}m`;
    };

    // ── PHASE A — overnight, pre-dawn. ────────────────────────────────
    // Show countdown to today's sunrise so a 4am photographer can plan.
    if (valid(sunrise) && now < (sunrise as Date)) {
      // Inside morning blue hour (dawn → sunrise)? Same copy is fine —
      // "Sunrise in 18 min" already conveys urgency.
      return { text: 'Sunrise in', gold: fmtMins((sunrise as Date).getTime() - now.getTime()) };
    }

    // ── PHASE B — morning golden hour (sunrise → goldenHourEnd). ──────
    if (valid(sunrise, morningGoldenEnd) && now >= (sunrise as Date) && now < (morningGoldenEnd as Date)) {
      return {
        text: 'Golden hour ending in',
        gold: fmtMins((morningGoldenEnd as Date).getTime() - now.getTime()),
      };
    }

    // ── PHASE C — daytime, before evening golden hour starts. ─────────
    if (valid(eveningGoldenStart) && now < (eveningGoldenStart as Date)) {
      return {
        text: 'Golden hour starts in',
        gold: fmtMins((eveningGoldenStart as Date).getTime() - now.getTime()),
      };
    }

    // ── PHASE D — evening golden hour active (until sunset start). ────
    if (valid(eveningGoldenStart, sunset) && now >= (eveningGoldenStart as Date) && now < (sunset as Date)) {
      const msToSunset = (sunset as Date).getTime() - now.getTime();
      // Last 15 minutes — switch to a dramatic "Sunset in X" cue.
      if (msToSunset <= 15 * 60_000) {
        return { text: 'Sunset in', gold: fmtMins(msToSunset) };
      }
      return { text: 'Golden hour ending in', gold: fmtMins(msToSunset) };
    }

    // ── PHASE E — blue hour (sunset → civil dusk). ────────────────────
    if (valid(sunset, dusk) && now >= (sunset as Date) && now < (dusk as Date)) {
      return {
        text: 'Blue hour ending in',
        gold: fmtMins((dusk as Date).getTime() - now.getTime()),
      };
    }

    // ── PHASE F — after dusk, full night. Show NEXT day's sunrise. ────
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const tn = SunCalc.getTimes(tomorrow, coords.latitude, coords.longitude);
    const nextSunrise: Date | undefined = tn.sunriseEnd || tn.sunrise;
    if (valid(nextSunrise) && now < (nextSunrise as Date)) {
      return { text: 'Sunrise in', gold: fmtMins((nextSunrise as Date).getTime() - now.getTime()) };
    }

    return null;
  } catch {
    return null;
  }
}

function pickHeroSpot(feed: Feed): any | null {
  const order = ['trending', 'nearby', 'near_you', 'recent', 'freshly_updated'];
  for (const key of order) {
    const arr = feed[key];
    if (Array.isArray(arr) && arr.length) {
      const hit = arr.find((s: any) => s?.title && (s?.images?.length || s?.cover_image_url));
      if (hit) return hit;
    }
  }
  return null;
}

function newSpotsCountNearby(feed: Feed): number {
  const arr = feed.freshly_updated || feed.recent || feed.nearby || [];
  return Math.min(Array.isArray(arr) ? arr.length : 0, 12);
}

function inferGreatFor(spot: any): string {
  const t = (spot?.specialties || spot?.categories || spot?.tags || []) as string[];
  const flat = Array.isArray(t) ? t.map((x) => String(x).toLowerCase()).join(' ') : '';
  if (flat.includes('landscape')) return 'Landscape';
  if (flat.includes('astro')) return 'Astro';
  if (flat.includes('seascape') || flat.includes('coast') || flat.includes('beach')) return 'Seascape';
  if (flat.includes('city') || flat.includes('urban')) return 'Cityscape';
  if (flat.includes('wildlife')) return 'Wildlife';
  if (flat.includes('portrait')) return 'Portrait';
  return 'Landscape';
}

function driveTimeFromMi(mi: number | null | undefined): string {
  if (mi == null || !Number.isFinite(mi)) return '—';
  const minutes = Math.max(1, Math.round((mi / 35) * 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Format the hero golden-hour countdown the same way as the header line so
 *  the two read consistently. Returns "42 min", "1h 12m", or "—".
 *
 *  NOTE (Jun 2025 cleanup): retained as a low-level utility but the
 *  Home Hero no longer uses it directly — the cinematic hero now
 *  shows a `LightCountdownBadge` driven by `nextLightWindow`. Kept
 *  in this file because the header line still references the same
 *  underlying `goldenCountdownParts` helper through the hour-line
 *  component below. */
// Removed in Jun 2025 cleanup — replaced by the LightCountdownBadge /
// `formatCountdownHHMM` path. Kept as a tombstone so the next reader
// doesn't reintroduce it.
// function heroGoldenMinutes(...) { ... }

// ─── Screen ────────────────────────────────────────────────────────────

export default function HomeMinimal() {
  const { user } = useAuth();
  const { coords, loading: gpsLoading } = useGps();
  const unreadDM = useUnreadMessages();

  const [feed, setFeed] = useState<Feed>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadNotif, setUnreadNotif] = useState(0);
  const [weather, setWeather] = useState<{ temp_f: number; label: string } | null>(null);
  // June 2025 — last-known coords, hydrated from AsyncStorage on mount.
  // Used as a fallback for the golden-hour line when live GPS hasn't
  // resolved yet (cold start, airplane mode, permission still pending).
  // Live `coords` from useGps takes precedence as soon as it arrives.
  const [cachedCoords, setCachedCoordsState] = useState<{ latitude: number; longitude: number } | null>(null);
  const loadingRef = useRef(false);
  const hydratedOnceRef = useRef(false);

  // Effective coords used for sun-events: live GPS preferred, cached as fallback.
  const effectiveCoords = useMemo<{ latitude: number; longitude: number } | null>(() => {
    if (coords) return coords;
    return cachedCoords;
  }, [coords, cachedCoords]);

  // Hydrate cached coords once on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      const c = await getCachedCoords();
      if (alive && c) setCachedCoordsState({ latitude: c.latitude, longitude: c.longitude });
    })();
    return () => { alive = false; };
  }, []);

  // Persist GPS coords to AsyncStorage whenever they change — keeps the
  // last-known cache fresh for cold starts and offline use.
  useEffect(() => {
    if (coords) {
      setCachedCoords(coords);
    }
  }, [coords]);

  const greeting = useMemo(() => timeOfDayGreeting(), []);
  const firstName = useMemo(() => {
    const n = (user?.name || user?.username || '').toString().trim();
    if (!n) return null;
    return n.split(/\s+/)[0];
  }, [user]);

  // Notif poll deferred 500ms.
  useEffect(() => {
    let alive = true;
    const fire = async () => {
      try {
        const r = await api.get('/notifications', { limit: 1 });
        if (alive) setUnreadNotif(r?.unread_count || 0);
      } catch {}
    };
    const kickoff = setTimeout(fire, 500);
    const iv = setInterval(fire, 45000);
    return () => { alive = false; clearTimeout(kickoff); clearInterval(iv); };
  }, []);

  // Cache hydration.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readCache<Feed>('feed:home:v3-min');
      if (alive && cached && !hydratedOnceRef.current) {
        setFeed(cached);
        setLoading(false);
        hydratedOnceRef.current = true;
      }
    })();
    return () => { alive = false; };
  }, []);

  const doFetch = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const params: any = {};
      if (coords) {
        params.lat = coords.latitude;
        params.lng = coords.longitude;
      }
      const data = await api.get('/feed/home', Object.keys(params).length ? params : undefined);
      setFeed(data || {});
      writeCache('feed:home:v3-min', data || {}).catch(() => {});
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
      loadingRef.current = false;
    }
  }, [coords]);

  // Single-fetch orchestration.
  const firedNoCoordsRef = useRef(false);
  useEffect(() => {
    if (coords) {
      doFetch();
      firedNoCoordsRef.current = false;
      return;
    }
    if (gpsLoading) {
      const t = setTimeout(() => {
        if (!firedNoCoordsRef.current) {
          firedNoCoordsRef.current = true;
          doFetch();
        }
      }, 5000);
      return () => clearTimeout(t);
    }
    if (!firedNoCoordsRef.current) {
      firedNoCoordsRef.current = true;
      doFetch();
    }
  }, [coords, gpsLoading, doFetch]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    doFetch();
  }, [doFetch]);

  const hero = useMemo(() => pickHeroSpot(feed), [feed]);
  const heroLat = hero?.latitude ?? hero?.coords?.latitude;
  const heroLng = hero?.longitude ?? hero?.coords?.longitude;
  const heroDistanceMi = useMemo(() => {
    if (!hero || !effectiveCoords || heroLat == null || heroLng == null) return null;
    return calculateDistanceMiles(effectiveCoords.latitude, effectiveCoords.longitude, heroLat, heroLng);
  }, [hero, effectiveCoords, heroLat, heroLng]);

  // Re-evaluate the light-window countdown every second. The hook is
  // independent of the hero memo so a slow scroll doesn't re-run pick.
  const [lightTick, setLightTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLightTick(t => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);
  const lightWindow = useMemo(() => {
    if (heroLat == null || heroLng == null) return null;
    return nextLightWindow({ latitude: heroLat, longitude: heroLng });
    // lightTick is intentional — it forces re-eval without coords change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroLat, heroLng, lightTick]);

  // "Best Locations Right Now Near You" companion row — 3 spots from
  // the existing feed, excluding the hero. Use the same priority order
  // as pickHeroSpot.
  const nearbySpots = useMemo(() => {
    const heroId = hero?.spot_id;
    const pool: any[] = [];
    for (const k of ['nearby', 'near_you', 'trending', 'recent', 'freshly_updated']) {
      const arr = (feed as any)?.[k];
      if (Array.isArray(arr)) pool.push(...arr);
    }
    const seen = new Set<string>();
    const out: any[] = [];
    for (const s of pool) {
      const id = s?.spot_id;
      if (!id || id === heroId || seen.has(id)) continue;
      seen.add(id);
      out.push(s);
      if (out.length >= 3) break;
    }
    return out;
  }, [feed, hero]);

  // Web-only subtle parallax — Animated drives transform on the hero
  // image. On native (iOS / Android) we leave the image static — the
  // user's stability/performance ask explicitly says "disable on lower-
  // powered devices or if it causes jank". RN-web is a pure CSS path
  // so the cost is one transform per frame, well within budget.
  const scrollY = useRef(new Animated.Value(0)).current;
  const onHomeScroll = Platform.OS === 'web'
    ? Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })
    : undefined;
  const parallaxTranslate = Platform.OS === 'web'
    ? scrollY.interpolate({ inputRange: [0, 400], outputRange: [0, -40], extrapolate: 'clamp' })
    : 0;

  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= 768;
  // Narrow phones (≤ 440 px ≈ iPhone SE through iPhone 16 Pro Max,
  // plus most Android phones) get a 2×2 pill grid instead of a
  // 4-column row so labels like "Golden hour" / "Landscape" never
  // truncate. Tablets and desktop web (≥ 441) keep the single-row
  // pill which reads more cinematic on wide screens.
  const isNarrowPillBar = windowWidth <= 440;
  // Mobile: 380. Web/desktop: at least 420 per spec. Cap so it doesn't
  // dominate large screens.
  const heroHeight = Platform.OS === 'web'
    ? Math.max(420, Math.min(560, Math.round(windowWidth * 0.42)))
    : 380;
  const heroCover = useMemo(() => (hero ? resolveSpotCoverForListCard(hero) : null), [hero]);

  // Weather fetch for the hero. Best-effort — endpoint may not exist on all
  // backend versions; failure is silent and the pill simply doesn't render.
  useEffect(() => {
    if (heroLat == null || heroLng == null) { setWeather(null); return; }
    let alive = true;
    (async () => {
      try {
        const w = await api.get('/weather', { lat: heroLat, lng: heroLng });
        if (alive && w && typeof w.temp_f === 'number') {
          setWeather({ temp_f: Math.round(w.temp_f), label: w.label || w.condition || 'Clear' });
        }
      } catch {
        // Silent fallback — derive a sensible label from suncalc daylight state.
        if (alive) setWeather(null);
      }
    })();
    return () => { alive = false; };
  }, [heroLat, heroLng]);

  const newCount = useMemo(() => newSpotsCountNearby(feed), [feed]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        // Parallax: web only — Animated.event on contentOffset.y drives
        // the hero image translate. Native gets a noop so it never
        // triggers the JS thread per scroll frame.
        onScroll={onHomeScroll as any}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* ─── Header ───────────────────────────────────────────────── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.greeting} numberOfLines={1}>
              {firstName ? `${greeting}, ${firstName}` : greeting}
            </Text>
            <Text style={s.headline}>Scout. Plan. Shoot.</Text>
            <GoldenHourLine coords={effectiveCoords as any} />
          </View>
          <View style={s.headerRight}>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => router.push('/inbox' as any)}
              accessibilityLabel="Messages"
            >
              <MessageCircle size={18} color={colors.text} />
              {unreadDM > 0 ? <View style={s.iconDot} /> : null}
            </TouchableOpacity>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => router.push('/notifications' as any)}
              accessibilityLabel="Notifications"
            >
              <Bell size={18} color={colors.text} />
              {unreadNotif > 0 ? <View style={s.iconDot} /> : null}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/profile' as any)}
              accessibilityLabel="Profile"
            >
              {user?.avatar_url ? (
                <SafeImage source={{ uri: user.avatar_url }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <Text style={s.avatarTxt}>{(firstName?.[0] || '?').toUpperCase()}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ─── Featured Spot Hero ─────────────────────────────────────
            Premium hero (May 2026 redesign):
              • Full-bleed image with subtle dark gradient
              • Top-right glowing countdown to the next light window
                (golden or blue) — color-coded
              • Bottom: frosted-glass pill bar with golden/blue, crowd,
                great-for, drive-time
              • AI-PICK badge removed → italic recommendation caption
                under the spot name
              • Web-only parallax via Animated.transform on scrollY
        */}
        {loading && !hero ? (
          <View style={[s.hero, { height: heroHeight }]}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : hero ? (
          <View style={[s.hero, { height: heroHeight }]}>
            <TouchableOpacity
              activeOpacity={0.95}
              onPress={() => router.push(`/spot/${hero.spot_id}` as any)}
              style={[s.heroImageWrap, { height: heroHeight }]}
            >
              {heroCover ? (
                <Animated.View
                  style={[
                    StyleSheet.absoluteFill,
                    Platform.OS === 'web'
                      ? { transform: [{ translateY: parallaxTranslate as any }] }
                      : null,
                  ]}
                >
                  <SafeImage source={{ uri: heroCover }} style={s.heroImg} />
                </Animated.View>
              ) : (
                <View style={[s.heroImg, { backgroundColor: colors.surface2 }]} />
              )}
              {/* Two-stop gradient: subtle top dim for countdown legibility,
                  stronger bottom for pill-bar + title contrast. */}
              <LinearGradient
                colors={['rgba(0,0,0,0.40)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']}
                locations={[0, 0.32, 1]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />

              {/* Top-right glowing countdown */}
              <LightCountdownBadge window={lightWindow} />

              {/* Bottom-left content — name + italic recommendation
                  caption. NO badge. */}
              <View style={[s.heroContent, { bottom: isNarrowPillBar ? 130 : 84 }]} pointerEvents="none">
                <Text style={s.heroTitle} numberOfLines={2}>{hero.title}</Text>
                <Text style={s.heroCaption} numberOfLines={1}>
                  Recommended based on your location.
                </Text>
                <View style={s.heroLocRow}>
                  <View style={s.heroLocPin}>
                    <MapPin size={11} color={colors.text} />
                  </View>
                  <Text style={s.heroLoc} numberOfLines={1}>
                    {[hero?.city, hero?.state].filter(Boolean).join(', ')}
                    {heroDistanceMi != null ? ` \u2022 ${heroDistanceMi.toFixed(0)} mi away` : ''}
                  </Text>
                </View>
              </View>

              {/* Frosted-glass pill bar at bottom of image — replaces
                  the old below-image stats row. BlurView falls back to
                  a translucent surface on platforms that don't blur.
                  On narrow phones (≤ 440 px ≈ most phones) the bar
                  becomes two explicit rows of 2 stats each so labels
                  like "Golden hour" / "Landscape" never truncate. */}
              <View style={s.heroPillBarWrap} pointerEvents="box-none">
                <BlurView
                  intensity={Platform.OS === 'ios' ? 40 : 30}
                  tint="dark"
                  style={[s.heroPillBar, isNarrowPillBar && s.heroPillBarGrid]}
                >
                  {isNarrowPillBar ? (
                    <>
                      <View style={s.pillRow}>
                        <PillStat
                          grid
                          icon={lightWindow?.type === 'blue'
                            ? <Moon size={13} color="#7DD3FC" />
                            : <Sun size={13} color={colors.primary} />}
                          label={lightWindow?.type === 'blue' ? 'Blue hour' : 'Golden hour'}
                          value={lightWindow
                            ? (lightWindow.isActive ? 'Now' : formatCountdownHHMM(lightWindow.minsUntil))
                            : 'Soon'}
                        />
                        <View style={s.pillDivider} />
                        <PillStat grid icon={<Users size={13} color={colors.textSecondary} />} label="Crowd" value="Low" />
                      </View>
                      <View style={s.pillRow}>
                        <PillStat grid icon={<Mountain size={13} color={colors.textSecondary} />} label="Great for" value={inferGreatFor(hero)} />
                        <View style={s.pillDivider} />
                        <PillStat grid icon={<Car size={13} color={colors.textSecondary} />} label="Drive" value={driveTimeFromMi(heroDistanceMi)} />
                      </View>
                    </>
                  ) : (
                    <>
                      <PillStat
                        icon={lightWindow?.type === 'blue'
                          ? <Moon size={13} color="#7DD3FC" />
                          : <Sun size={13} color={colors.primary} />}
                        label={lightWindow?.type === 'blue' ? 'Blue hour' : 'Golden hour'}
                        value={lightWindow
                          ? (lightWindow.isActive ? 'Now' : formatCountdownHHMM(lightWindow.minsUntil))
                          : 'Soon'}
                      />
                      <View style={s.pillDivider} />
                      <PillStat icon={<Users size={13} color={colors.textSecondary} />} label="Crowd" value="Low" />
                      <View style={s.pillDivider} />
                      <PillStat icon={<Mountain size={13} color={colors.textSecondary} />} label="Great for" value={inferGreatFor(hero)} />
                      <View style={s.pillDivider} />
                      <PillStat icon={<Car size={13} color={colors.textSecondary} />} label="Drive" value={driveTimeFromMi(heroDistanceMi)} />
                    </>
                  )}
                </BlurView>
              </View>
            </TouchableOpacity>

            {/* CTA row stays below the image */}
            <View style={s.ctaRow}>
              <TouchableOpacity
                style={[s.cta, s.ctaSecondary]}
                onPress={() =>
                  router.push({ pathname: '/spot/[id]' as any, params: { id: hero.spot_id, navigate: '1' } })
                }
              >
                <Navigation size={16} color={colors.text} />
                <Text style={s.ctaSecondaryTxt}>Navigate</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.cta, s.ctaPrimary]}
                onPress={() => api.post(`/spots/${hero.spot_id}/save`, {}).catch(() => {})}
              >
                <Bookmark size={16} color={colors.bg} />
                <Text style={s.ctaPrimaryTxt}>Save Spot</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* ─── Best Locations Right Now Near You ──────────────────── */}
        {nearbySpots.length > 0 ? (
          <View style={s.nearbyWrap}>
            <Text style={s.nearbyHeading}>Best locations right now near you</Text>
            {isWide ? (
              <View style={s.nearbyRowGrid}>
                {nearbySpots.map(sp => (
                  <NearbyCard
                    key={sp.spot_id}
                    spot={sp}
                    viewerCoords={effectiveCoords}
                    style={s.nearbyCardWide}
                  />
                ))}
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.nearbyRowScroll}
              >
                {nearbySpots.map(sp => (
                  <NearbyCard key={sp.spot_id} spot={sp} viewerCoords={effectiveCoords} />
                ))}
              </ScrollView>
            )}
          </View>
        ) : null}

        {/* ─── Quick Actions ──────────────────────────────────────── */}
        <Text style={s.sectionTitle}>Quick actions</Text>
        <View style={s.quick}>
          <QuickAction
            icon={<MapIcon size={26} color={colors.text} />}
            label="Explore Map"
            onPress={() => router.push('/(tabs)/explore' as any)}
          />
          <QuickAction
            icon={<MapPin size={26} color={colors.primary} fill={colors.primary as any} />}
            label="Near Me"
            highlighted
            onPress={() => router.push({ pathname: '/(tabs)/explore' as any, params: { view: 'list', sort: 'nearby' } })}
          />
          <QuickAction
            icon={<Bookmark size={26} color={colors.text} />}
            label="Collections"
            onPress={() => router.push('/(tabs)/saved' as any)}
          />
          <QuickAction
            icon={<Plus size={26} color={colors.text} />}
            label="Upload Spot"
            onPress={() => router.push('/(tabs)/add' as any)}
          />
        </View>

        {/* ─── Insight Card ──────────────────────────────────────── */}
        {newCount > 0 ? (
          <TouchableOpacity
            style={s.insight}
            activeOpacity={0.85}
            onPress={() => router.push('/(tabs)/explore' as any)}
          >
            <View style={s.insightIcon}>
              <Sparkles size={18} color="#5dd96f" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.insightTitle}>{newCount} new spots added near you</Text>
              <Text style={s.insightSub}>Check them out on the map</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

/** Self-updating golden-hour line. Re-evaluates `goldenCountdownParts`
 *  every 60 seconds so the countdown ticks down without forcing a
 *  re-render of the whole Home tab. The interval is also refreshed
 *  if `coords` change (user GPS resolves later).
 *
 *  Fallback copy:
 *   • coords missing entirely     → "Waiting for location…"  (one-time hint)
 *   • coords present, parts null  → "Golden hour information unavailable"
 *                                   (e.g. polar regions near solstice)
 */
function GoldenHourLine({ coords }: { coords?: { latitude: number; longitude: number } | null }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // Only need a ticker when we actually have coords.
    if (!coords) return;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [coords]);
  // The `tick` dependency is intentional — it forces re-computation on
  // every minute without altering coords.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parts = useMemo(() => goldenCountdownParts(coords as any), [coords, tick]);
  return (
    <View style={s.subRow}>
      <Sun size={13} color={colors.primary} />
      {parts ? (
        <Text style={s.subText}>
          {parts.text} <Text style={s.subTextGold}>{parts.gold}</Text>
        </Text>
      ) : coords ? (
        <Text style={s.subText}>Golden hour information unavailable</Text>
      ) : (
        <Text style={s.subText}>Locating you for sun times…</Text>
      )}
    </View>
  );
}

// Removed in Jun 2025 cleanup — the old `Stat()` cell rendered the
// below-image stat row that the cinematic hero replaced with a
// frosted-glass pill bar (`PillStat`). Tombstoned to prevent revival.
// function Stat(...) { ... }

function QuickAction({ icon, label, onPress, highlighted }: {
  icon: React.ReactNode; label: string; onPress: () => void; highlighted?: boolean;
}) {
  return (
    <TouchableOpacity style={[s.qa, highlighted && s.qaHighlighted]} onPress={onPress} activeOpacity={0.85}>
      <View style={s.qaIcon}>{icon}</View>
      <Text style={[s.qaLabel, highlighted && { color: colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Featured Hero pieces (May 2026 redesign) ──────────────────────────

/** Top-right glowing countdown to the next light window.
 *  Falls back to "Best light soon" copy if no window can be computed.
 *  Color theme: amber for golden, cyan for blue. */
function LightCountdownBadge({ window }: { window: any /* NextLightWindow|null */ }) {
  const isBlue = window?.type === 'blue';
  const glow = isBlue ? '#7DD3FC' : colors.primary;
  const bg   = isBlue ? 'rgba(14, 116, 144, 0.18)' : 'rgba(245,166,35,0.12)';
  const border = isBlue ? 'rgba(125,211,252,0.45)' : 'rgba(245,166,35,0.45)';
  const Icon = isBlue ? Moon : Sun;
  const header = headerForWindow(window);
  const value = window
    ? (window.isActive ? 'Now' : formatCountdownHHMM(window.minsUntil))
    : '—';
  const hasValue = value !== '—';

  return (
    <View
      style={[s.countdown, { backgroundColor: bg, borderColor: border }]}
      pointerEvents="none"
    >
      <View style={s.countdownHeader}>
        <Icon size={12} color={glow} />
        <Text style={[s.countdownLabel, { color: glow }]}>{header}</Text>
      </View>
      <Text
        style={[
          s.countdownValue,
          {
            color: glow,
            // RN-web textShadow is the documented glow path; on native
            // it falls back to the plain color (no jank).
            textShadowColor: glow,
            textShadowRadius: 12,
            textShadowOffset: { width: 0, height: 0 },
          },
        ]}
      >
        {hasValue ? value : 'Soon'}
      </Text>
    </View>
  );
}

/** Single pill stat used inside the frosted-glass overlay. When
 *  `grid` is true (narrow-phone layout) the cell takes 50% width
 *  with a bit more vertical padding so it reads as a 2×2 grid. */
function PillStat({ icon, label, value, grid }: {
  icon: React.ReactNode; label: string; value: string; grid?: boolean;
}) {
  return (
    <View style={[s.pillStat, grid && s.pillStatGrid]}>
      <View style={s.pillIcon}>{icon}</View>
      <View style={s.pillText}>
        <Text style={s.pillLabel} numberOfLines={1}>{label}</Text>
        <Text style={s.pillValue} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

/** Small horizontal-row card for "Best locations right now near you". */
function NearbyCard({ spot, viewerCoords, style }: {
  spot: any;
  viewerCoords: { latitude: number; longitude: number } | null;
  style?: any;
}) {
  const cover = resolveSpotCoverForListCard(spot);
  const lat = spot?.latitude ?? spot?.coords?.latitude;
  const lng = spot?.longitude ?? spot?.coords?.longitude;
  const miles = viewerCoords && lat != null && lng != null
    ? calculateDistanceMiles(viewerCoords.latitude, viewerCoords.longitude, lat, lng)
    : null;
  const driveLabel = driveTimeFromMi(miles);

  // Per-spot current light window — same logic as hero, scoped to
  // this card's coords. Memoised per render; the home tab's lightTick
  // is at the parent and re-runs the render anyway.
  const lw = useMemo(() => {
    if (lat == null || lng == null) return null;
    return nextLightWindow({ latitude: lat, longitude: lng });
  }, [lat, lng]);
  const isBlue = lw?.type === 'blue';
  const glow = isBlue ? '#7DD3FC' : colors.primary;

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={[s.nearbyCard, style]}
      onPress={() => router.push(`/spot/${spot.spot_id}` as any)}
    >
      {cover ? (
        <SafeImage source={{ uri: cover }} style={s.nearbyImg} />
      ) : (
        <View style={[s.nearbyImg, { backgroundColor: colors.surface2 }]} />
      )}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']}
        locations={[0.4, 1]}
        style={s.nearbyImgOverlay}
        pointerEvents="none"
      />
      <View style={s.nearbyTextWrap} pointerEvents="none">
        <Text style={s.nearbyTitle} numberOfLines={2}>{spot.title}</Text>
        <View style={s.nearbyMetaRow}>
          <Text style={s.nearbyMeta} numberOfLines={1}>
            {miles != null ? `${miles.toFixed(0)} mi` : '—'}
            {driveLabel ? ` · ${driveLabel}` : ''}
          </Text>
          <View style={s.nearbyDot} />
          <Text style={[s.nearbyMeta, { color: glow }]} numberOfLines={1}>
            {lw
              ? `${labelForWindow(lw.type)} ${lw.isActive ? 'now' : `in ${formatCountdownHHMM(lw.minsUntil)}`}`
              : 'Best light soon'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: space.lg, paddingBottom: space.xxxl },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  headerLeft: { flex: 1, paddingRight: space.md },
  greeting: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, marginBottom: 2 },
  headline: { color: colors.text, fontFamily: font.displayBold, fontSize: 26, letterSpacing: -0.5, lineHeight: 30 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  subText: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  // Was gold (#F5A623) in v1; demoted to white-on-weight per May 2026
  // design refresh — gold is reserved for primary CTAs, Pro/Elite
  // tier badges, and premium map pins only. The countdown still gets
  // visual weight via fontSemibold.
  subTextGold: { color: colors.text, fontFamily: font.bodySemibold },

  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  iconDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  avatar: { width: 38, height: 38, borderRadius: 19, marginLeft: 2 },
  avatarFallback: { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },

  // Hero card (composite — image + stats + CTAs grouped under one card surface)
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    overflow: 'hidden',
    marginBottom: space.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  heroImageWrap: { height: 380, position: 'relative' },
  heroSkeleton: { height: 380, alignItems: 'center', justifyContent: 'center' },
  heroImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },

  aiPill: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(20,28,22,0.78)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(93,217,111,0.45)',
  },
  aiPillTxt: { color: '#5dd96f', fontFamily: font.bodySemibold, fontSize: 10.5, letterSpacing: 0.6 },

  weatherPill: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(20,20,22,0.85)',
    borderRadius: 14,
  },
  weatherTemp: { color: '#fff', fontFamily: font.bodyBold, fontSize: 14, lineHeight: 16 },
  weatherLabel: { color: 'rgba(255,255,255,0.78)', fontFamily: font.body, fontSize: 11, marginTop: 1 },

  heroContent: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
  },
  greatLightLabel: {
    color: '#5dd96f',
    fontFamily: font.bodySemibold,
    fontSize: 10.5,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  heroTitle: { color: '#fff', fontFamily: font.displayBold, fontSize: 30, letterSpacing: -0.4, lineHeight: 34 },
  heroLocRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  heroLocPin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLoc: { color: 'rgba(255,255,255,0.85)', fontFamily: font.body, fontSize: 13 },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
    gap: 8,
  },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statIconBg: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabel: { color: colors.textSecondary, fontFamily: font.body, fontSize: 10.5 },
  statValue: { fontFamily: font.bodySemibold, fontSize: 12.5, marginTop: 1 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.border },

  ctaRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  cta: {
    flex: 1,
    height: 50,
    borderRadius: radii.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaPrimary: { backgroundColor: colors.primary },
  ctaPrimaryTxt: { color: colors.bg, fontFamily: font.bodyBold, fontSize: 15 },
  ctaSecondary: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  ctaSecondaryTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },

  // Quick actions
  sectionTitle: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 18,
    marginBottom: 12,
  },
  quick: { flexDirection: 'row', gap: 10, marginBottom: space.lg },
  qa: {
    flex: 1,
    height: 100,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 4,
  },
  qaHighlighted: { borderColor: 'rgba(255,184,76,0.4)' },
  qaIcon: { marginBottom: 8 },
  qaLabel: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 11, textAlign: 'center' },

  // Insight
  insight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: space.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  insightIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(46,160,67,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(93,217,111,0.3)',
  },
  insightTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  insightSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12, marginTop: 2 },

  // ─── Hero redesign (May 2026) ──────────────────────────────────────
  heroCaption: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontStyle: 'italic',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 8,
  },
  countdown: {
    position: 'absolute',
    top: 14,
    right: 14,
    borderRadius: radii.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    alignItems: 'flex-end',
    minWidth: 110,
    // Soft glow halo on web; ignored on native — the textShadow on the
    // value provides the cinematic glow without GPU cost.
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(6px)' as any } : {}),
  },
  countdownHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  countdownLabel: { fontFamily: font.bodySemibold, fontSize: 10 },
  countdownValue: {
    fontFamily: font.displayBold,
    fontSize: 26,
    letterSpacing: 0.5,
    marginTop: 2,
    lineHeight: 28,
  },

  heroPillBarWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  heroPillBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(10,10,10,0.45)',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  // Narrow-phone variant — column container holding two `pillRow`s.
  // Softer corner radius (the bar is no longer a single horizontal
  // pill), more breathing room between rows.
  heroPillBarGrid: {
    flexDirection: 'column',
    alignItems: 'stretch',
    borderRadius: radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  // Inner row inside the narrow-phone grid: 2 cells + 1 divider, all
  // flex-row aligned center.
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginHorizontal: 4,
  },
  pillStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  // Grid-mode cell — also flex:1 (50% of its row after subtracting the
  // divider), since each pillRow contains exactly 2 PillStats. We keep
  // flex:1 here so the dividers stay centered and the cells expand to
  // their parent width.
  pillStatGrid: {
    flex: 1,
    minWidth: 0,
  },
  pillIcon: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  pillText: { flex: 1, minWidth: 0 },
  pillLabel: { color: colors.textTertiary, fontFamily: font.body, fontSize: 9.5 },
  pillValue: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 11.5, marginTop: 1 },

  // Best locations row
  nearbyWrap: {
    marginTop: space.xxl,
    marginBottom: space.lg,
  },
  nearbyHeading: {
    color: colors.text,
    fontFamily: font.displayBold,
    fontSize: 22,
    marginBottom: space.md,
  },
  nearbyRowScroll: {
    gap: space.md,
    paddingRight: space.lg,
  },
  nearbyRowGrid: {
    flexDirection: 'row',
    gap: space.md,
  },
  nearbyCard: {
    width: 220,
    height: 180,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  nearbyCardWide: { flex: 1, width: undefined },
  nearbyImg: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    width: '100%', height: '100%',
  },
  nearbyImgOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  nearbyTextWrap: {
    position: 'absolute',
    left: 12, right: 12, bottom: 10,
  },
  nearbyTitle: {
    color: colors.text,
    fontFamily: font.displayBold,
    fontSize: 16,
    lineHeight: 20,
    marginBottom: 4,
  },
  nearbyMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  nearbyMeta: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 11,
  },
  nearbyDot: {
    width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: colors.textTertiary,
  },
});
