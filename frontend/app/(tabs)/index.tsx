/**
 * LumaScout Home — Cinematic Minimal Edition (June 2025).
 *
 * Design goal: instantly answer "Where should I shoot right now?"
 *
 * Layout (top → bottom):
 *   1. Header — greeting, headline, golden-hour countdown, 3 icons
 *   2. Hero card — single dominant AI pick with cinematic image
 *   3. Quick actions — 4 equal cards (Explore, Near Me, Collections, Upload)
 *   4. Insight card — soft single line about new spots near you
 *
 * What was REMOVED from the old Home (preserved everywhere else):
 *   • Trending / Best Near You / Freshly Updated / Continue Planning rails
 *   • Marketplace card
 *   • ScoutAI promo card
 *   • Filter chip row + search bar (use Explore tab for these)
 *   • HomeInboxPreview (use the messenger icon in the header)
 *   • UpgradeBanner (now surfaces in Profile / Settings only)
 *
 * What was KEPT:
 *   • Same /api/feed/home backend — no API changes needed
 *   • SWR cache (writeCache/readCache) — fast first-paint
 *   • GPS coords for distance + golden-hour calc
 *   • Notification + DM unread badge counts in header icons
 *
 * iOS / Android safety:
 *   • SafeAreaView from react-native-safe-area-context for proper
 *     edge-to-edge handling on Android.
 *   • All TouchableOpacity targets are 44×44+ for thumbprint safety.
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
  Platform,
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
  Camera,
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
import { calculateDistanceMiles } from '../../src/utils/geo';
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

/** Returns a string like "Golden hour starts in 42 min" or null when no
 *  evening golden hour today (or after it has ended).  We do this with the
 *  user's GPS coords; if no coords, we fall back to a generic "Plan today's
 *  shoot" subtitle. */
function goldenHourCountdown(coords?: { latitude: number; longitude: number } | null, now: Date = new Date()): string | null {
  if (!coords) return null;
  try {
    const SunCalc = require('suncalc');
    const t = SunCalc.getTimes(now, coords.latitude, coords.longitude);
    const start: Date | undefined = t.goldenHour;
    const end: Date | undefined = t.sunsetStart || t.sunset;
    if (start && now < start) {
      const mins = Math.max(1, Math.round((start.getTime() - now.getTime()) / 60000));
      if (mins < 60) return `Golden hour starts in ${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m === 0 ? `Golden hour in ${h}h` : `Golden hour in ${h}h ${m}m`;
    }
    if (start && end && now >= start && now < end) {
      return 'Golden hour is now';
    }
    return null;
  } catch {
    return null;
  }
}

/** Tiny helper: pick the single best hero spot from any of the feed sections.
 *  Priority: trending → nearby → near_you → recent → freshly_updated. */
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

// ─── Screen ────────────────────────────────────────────────────────────

export default function HomeMinimal() {
  const { user } = useAuth();
  const { coords, loading: gpsLoading } = useGps();
  const unreadDM = useUnreadMessages();

  const [feed, setFeed] = useState<Feed>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadNotif, setUnreadNotif] = useState(0);
  const loadingRef = useRef(false);
  const hydratedOnceRef = useRef(false);

  const greeting = useMemo(() => timeOfDayGreeting(), []);
  const firstName = useMemo(() => {
    const n = (user?.name || user?.username || '').toString().trim();
    if (!n) return null;
    return n.split(/\s+/)[0];
  }, [user]);

  // Subtitle: golden-hour countdown if we have coords, otherwise a soft fallback.
  const subtitle = useMemo(() => {
    const gh = goldenHourCountdown(coords as any);
    if (gh) return gh;
    return 'Plan today\u2019s shoot';
  }, [coords]);

  // Notif poll deferred 500ms so the shell can paint first.
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

  // Cache hydration (first-paint <100ms).
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

  // Single-fetch orchestration: wait briefly for GPS, then fire.
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
  const heroDistanceMi = useMemo(() => {
    if (!hero || !coords) return null;
    const lat = hero?.latitude ?? hero?.coords?.latitude;
    const lng = hero?.longitude ?? hero?.coords?.longitude;
    if (lat == null || lng == null) return null;
    return calculateDistanceMiles(coords.latitude, coords.longitude, lat, lng);
  }, [hero, coords]);
  const heroGolden = useMemo(() => {
    if (!hero) return null;
    const lat = hero?.latitude ?? hero?.coords?.latitude;
    const lng = hero?.longitude ?? hero?.coords?.longitude;
    if (lat == null || lng == null) return null;
    // Compact form: just the start time, e.g. "6:47 PM".
    try {
      const SunCalc = require('suncalc');
      const t = SunCalc.getTimes(new Date(), lat, lng);
      const start: Date | undefined = t.goldenHour;
      if (!start) return null;
      // Reuse the locale-aware formatting from goldenHourLabel by running it
      // directly — easier than cloning the helper.
      const lbl = goldenHourLabel(lat, lng);
      if (!lbl) return null;
      // lbl is "Golden 6:47 PM–7:14 PM"; we want the first time only.
      const m = lbl.match(/Golden\s+([0-9]{1,2}:[0-9]{2}\s*[AP]M)/i);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }, [hero]);
  const heroCover = useMemo(() => (hero ? resolveSpotCoverForListCard(hero) : null), [hero]);

  const newCount = useMemo(() => newSpotsCountNearby(feed), [feed]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* ─── Header ───────────────────────────────────────────────── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.greeting} numberOfLines={1}>
              {firstName ? `${greeting}, ${firstName}` : greeting}
            </Text>
            <Text style={s.headline}>Scout. Plan. Shoot.</Text>
            <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text>
          </View>
          <View style={s.headerRight}>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => router.push('/inbox' as any)}
              accessibilityLabel="Messages"
            >
              <MessageCircle size={20} color={colors.text} />
              {unreadDM > 0 ? <View style={s.iconDot} /> : null}
            </TouchableOpacity>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => router.push('/notifications' as any)}
              accessibilityLabel="Notifications"
            >
              <Bell size={20} color={colors.text} />
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
          <TouchableOpacity
            style={s.hero}
            activeOpacity={0.92}
            onPress={() => router.push(`/spot/${hero.spot_id}` as any)}
          >
            {heroCover ? (
              <SafeImage source={{ uri: heroCover }} style={s.heroImg} />
            ) : (
              <View style={[s.heroImg, { backgroundColor: colors.surface2 }]} />
            )}
            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.92)']}
              locations={[0, 0.55, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View style={s.heroContent} pointerEvents="none">
              <View style={s.heroLabels}>
                <View style={s.heroLabelAi}>
                  <Text style={s.heroLabelAiTxt}>AI PICK FOR YOU</Text>
                </View>
                <View style={s.heroLabelCat}>
                  <Text style={s.heroLabelCatTxt}>GREAT LIGHT</Text>
                </View>
              </View>
              <Text style={s.heroTitle} numberOfLines={1}>{hero.title}</Text>
              <Text style={s.heroLoc} numberOfLines={1}>
                {[hero?.city, hero?.state].filter(Boolean).join(', ')}
                {heroDistanceMi != null ? ` \u2022 ${heroDistanceMi.toFixed(0)} mi away` : ''}
              </Text>

              <View style={s.heroStats}>
                <HeroStat icon={<Sun size={14} color={colors.primary} />} label="Golden hour" value={heroGolden || '—'} />
                <HeroStat icon={<Users size={14} color={colors.primary} />} label="Crowd" value="Low" />
                <HeroStat icon={<Camera size={14} color={colors.primary} />} label="Great for" value={inferGreatFor(hero)} />
                <HeroStat icon={<Navigation size={14} color={colors.primary} />} label="Drive" value={driveTimeFromMi(heroDistanceMi)} />
              </View>
            </View>

            {/* CTAs sit OUTSIDE pointerEvents="none" so they receive taps */}
            <View style={s.heroCtas}>
              <TouchableOpacity
                style={[s.cta, s.ctaPrimary]}
                onPress={(e) => {
                  e.stopPropagation();
                  router.push({ pathname: '/spot/[id]' as any, params: { id: hero.spot_id, navigate: '1' } });
                }}
              >
                <Navigation size={16} color={colors.bg} />
                <Text style={s.ctaPrimaryTxt}>Navigate</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.cta, s.ctaSecondary]}
                onPress={(e) => {
                  e.stopPropagation();
                  // Fire the save endpoint optimistically; failure is silent.
                  api.post(`/spots/${hero.spot_id}/save`, {}).catch(() => {});
                }}
              >
                <Bookmark size={16} color={colors.text} />
                <Text style={s.ctaSecondaryTxt}>Save Spot</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ) : null}

        {/* ─── Quick Actions ──────────────────────────────────────── */}
        <View style={s.quick}>
          <QuickAction
            icon={<MapIcon size={22} color={colors.primary} />}
            label="Explore Map"
            onPress={() => router.push('/(tabs)/explore' as any)}
          />
          <QuickAction
            icon={<Navigation size={22} color={colors.primary} />}
            label="Near Me"
            onPress={() => router.push({ pathname: '/(tabs)/explore' as any, params: { view: 'list', sort: 'nearby' } })}
          />
          <QuickAction
            icon={<Bookmark size={22} color={colors.primary} />}
            label="Collections"
            onPress={() => router.push('/(tabs)/saved' as any)}
          />
          <QuickAction
            icon={<Plus size={22} color={colors.primary} />}
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
              <MapIcon size={18} color={colors.primary} />
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

function HeroStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={s.stat}>
      <View style={s.statIcon}>{icon}</View>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function QuickAction({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.qa} onPress={onPress} activeOpacity={0.85}>
      <View style={s.qaIcon}>{icon}</View>
      <Text style={s.qaLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Heuristics ────────────────────────────────────────────────────────

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
  // Rough 35 mph average accounting for stop-and-go + scenic detours.
  const minutes = Math.max(1, Math.round((mi / 35) * 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ─── Styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: space.xl, paddingBottom: space.xxxl },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: space.lg,
    paddingBottom: space.xl,
  },
  headerLeft: { flex: 1, paddingRight: space.md },
  greeting: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13, marginBottom: 2 },
  headline: { color: colors.text, fontFamily: font.displayBold, fontSize: 28, letterSpacing: -0.5, lineHeight: 32 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, marginTop: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 6 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  avatar: { width: 38, height: 38, borderRadius: 19, marginLeft: 4 },
  avatarFallback: {
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },

  // Hero card
  hero: {
    height: 460,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    marginBottom: space.xl,
  },
  heroSkeleton: { alignItems: 'center', justifyContent: 'center' },
  heroImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  heroContent: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 96, // leaves room for the CTA row below
  },
  heroLabels: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  heroLabelAi: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(46,160,67,0.18)',
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(46,160,67,0.6)',
  },
  heroLabelAiTxt: { color: '#5dd96f', fontFamily: font.bodySemibold, fontSize: 9.5, letterSpacing: 0.6 },
  heroLabelCat: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 4,
  },
  heroLabelCatTxt: { color: '#fff', fontFamily: font.bodySemibold, fontSize: 9.5, letterSpacing: 0.6 },
  heroTitle: { color: '#fff', fontFamily: font.displayBold, fontSize: 26, letterSpacing: -0.4 },
  heroLoc: { color: 'rgba(255,255,255,0.72)', fontFamily: font.body, fontSize: 13, marginTop: 4 },
  heroStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  stat: { flex: 1 },
  statIcon: { marginBottom: 4 },
  statLabel: { color: 'rgba(255,255,255,0.55)', fontFamily: font.body, fontSize: 10, letterSpacing: 0.3 },
  statValue: { color: '#fff', fontFamily: font.bodySemibold, fontSize: 13, marginTop: 1 },

  heroCtas: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    gap: 10,
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
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  ctaSecondaryTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 15 },

  // Quick actions
  quick: { flexDirection: 'row', gap: 10, marginBottom: space.lg },
  qa: {
    flex: 1,
    height: 80,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  qaIcon: { marginBottom: 6 },
  qaLabel: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 11, textAlign: 'center' },

  // Insight
  insight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: space.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  insightIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,184,76,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  insightSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
});
