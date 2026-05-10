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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  MessageCircle,
  Bell,
  Map as MapIcon,
  Navigation,
  Bookmark,
  Plus,
  Sun,
  Users,
  Sparkles,
  CloudSun,
  MapPin,
  Mountain,
  Car,
  ChevronRight,
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
 *  e.g. text="Golden hour starts in" gold="42 min". Supports:
 *    • "Golden hour starts in 42 min"  (pre-evening-golden)
 *    • "Golden hour ends in 18 min"    (during evening golden hour)
 *    • "Blue hour happening now"       (sunset → civil dusk)
 *    • "Sunrise in 1h 12m"             (overnight, before morning golden)
 *    • "Plan today's shoot"            (fallback when nothing else fits)
 *
 *  All windows are computed in the SPOT'S local time via SunCalc;
 *  `goldenHour` = 6° above horizon, `goldenHourEnd` = morning end.
 *  `dusk` = civil dusk (when blue hour ends).
 */
function goldenCountdownParts(
  coords?: { latitude: number; longitude: number } | null,
  now: Date = new Date(),
): { text: string; gold: string } | null {
  if (!coords) return null;
  try {
    const SunCalc = require('suncalc');
    const t = SunCalc.getTimes(now, coords.latitude, coords.longitude);
    const eveningStart: Date | undefined = t.goldenHour;     // sun at +6° (evening)
    const eveningEnd: Date | undefined = t.sunsetStart || t.sunset;
    const blueEnd: Date | undefined = t.dusk;                // civil dusk
    const morningStart: Date | undefined = t.sunriseEnd || t.sunrise;
    const morningEnd: Date | undefined = t.goldenHourEnd;

    const fmtMins = (ms: number): string => {
      const mins = Math.max(1, Math.round(ms / 60000));
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m === 0 ? `${h}h` : `${h}h ${m}m`;
    };

    // Morning golden hour (rare for "starts in" branch — usually after sunrise).
    if (morningStart && morningEnd && now >= morningStart && now < morningEnd) {
      return { text: 'Golden hour ends in', gold: fmtMins(morningEnd.getTime() - now.getTime()) };
    }
    // Evening golden hour active right now.
    if (eveningStart && eveningEnd && now >= eveningStart && now < eveningEnd) {
      return { text: 'Golden hour ends in', gold: fmtMins(eveningEnd.getTime() - now.getTime()) };
    }
    // Blue hour active (sunset → civil dusk).
    if (eveningEnd && blueEnd && now >= eveningEnd && now < blueEnd) {
      return { text: 'Blue hour', gold: 'happening now' };
    }
    // Pre-evening-golden — most common label during the day.
    if (eveningStart && now < eveningStart) {
      return { text: 'Golden hour starts in', gold: fmtMins(eveningStart.getTime() - now.getTime()) };
    }
    // Overnight — show countdown to sunrise so users planning early shoots
    // can see how long they have.
    if (morningStart && now < morningStart) {
      return { text: 'Sunrise in', gold: fmtMins(morningStart.getTime() - now.getTime()) };
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
 *  the two read consistently. Returns "42 min", "1h 12m", or "—". */
function heroGoldenMinutes(coords?: { latitude: number; longitude: number } | null, now: Date = new Date()): string {
  const parts = goldenCountdownParts(coords, now);
  return parts ? parts.gold : '—';
}

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
  const loadingRef = useRef(false);
  const hydratedOnceRef = useRef(false);

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
    if (!hero || !coords || heroLat == null || heroLng == null) return null;
    return calculateDistanceMiles(coords.latitude, coords.longitude, heroLat, heroLng);
  }, [hero, coords, heroLat, heroLng]);
  const heroGolden = useMemo(() => {
    if (heroLat == null || heroLng == null) return '—';
    return heroGoldenMinutes({ latitude: heroLat, longitude: heroLng } as any);
  }, [heroLat, heroLng]);
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
            <GoldenHourLine coords={coords as any} />
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

        {/* ─── Hero Card ────────────────────────────────────────────── */}
        {loading && !hero ? (
          <View style={[s.hero, s.heroSkeleton]}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : hero ? (
          <View style={s.hero}>
            <TouchableOpacity
              activeOpacity={0.95}
              onPress={() => router.push(`/spot/${hero.spot_id}` as any)}
              style={s.heroImageWrap}
            >
              {heroCover ? (
                <SafeImage source={{ uri: heroCover }} style={s.heroImg} />
              ) : (
                <View style={[s.heroImg, { backgroundColor: colors.surface2 }]} />
              )}
              <LinearGradient
                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']}
                locations={[0.45, 1]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />

              {/* Top-left AI pick pill */}
              <View style={s.aiPill} pointerEvents="none">
                <Sparkles size={12} color="#5dd96f" />
                <Text style={s.aiPillTxt}>AI PICK FOR YOU</Text>
              </View>

              {/* Top-right weather pill */}
              {weather ? (
                <View style={s.weatherPill} pointerEvents="none">
                  <CloudSun size={14} color="#cfd6e0" />
                  <View>
                    <Text style={s.weatherTemp}>{weather.temp_f}°F</Text>
                    <Text style={s.weatherLabel} numberOfLines={1}>{weather.label}</Text>
                  </View>
                </View>
              ) : null}

              {/* Bottom-left content */}
              <View style={s.heroContent} pointerEvents="none">
                <Text style={s.greatLightLabel}>GREAT LIGHT</Text>
                <Text style={s.heroTitle} numberOfLines={1}>{hero.title}</Text>
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
            </TouchableOpacity>

            {/* Stats row inside the card body (below image) */}
            <View style={s.statsRow}>
              <Stat
                icon={<Sun size={14} color={colors.primary} />}
                bg="rgba(255,184,76,0.14)"
                label="Golden hour"
                value={heroGolden}
                valueColor={colors.primary}
              />
              <View style={s.statDivider} />
              <Stat
                icon={<Users size={14} color="#5dd96f" />}
                bg="rgba(46,160,67,0.14)"
                label="Crowd"
                value="Low"
                valueColor="#5dd96f"
              />
              <View style={s.statDivider} />
              <Stat
                icon={<Mountain size={14} color="#5dd96f" />}
                bg="rgba(46,160,67,0.14)"
                label="Great for"
                value={inferGreatFor(hero)}
                valueColor="#5dd96f"
              />
              <View style={s.statDivider} />
              <Stat
                icon={<Car size={14} color={colors.text} />}
                bg="rgba(255,255,255,0.10)"
                label="Drive time"
                value={driveTimeFromMi(heroDistanceMi)}
                valueColor={colors.text}
              />
            </View>

            {/* CTA row */}
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
 *  if `coords` change (user GPS resolves later). */
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
      ) : (
        <Text style={s.subText}>Plan today\u2019s shoot</Text>
      )}
    </View>
  );
}

function Stat({ icon, bg, label, value, valueColor }: {
  icon: React.ReactNode; bg: string; label: string; value: string; valueColor: string;
}) {
  return (
    <View style={s.stat}>
      <View style={[s.statIconBg, { backgroundColor: bg }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
        <Text style={[s.statValue, { color: valueColor }]} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

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
  subTextGold: { color: colors.primary, fontFamily: font.bodySemibold },

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
});
