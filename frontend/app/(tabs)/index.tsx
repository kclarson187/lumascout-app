import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Image,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, TrendingUp, MessageCircle, Users, HandHeart, BookOpen, Bell, Share2, SlidersHorizontal, Sparkles, ChevronRight, Gem, MapPin, Sun, Cloud, Bookmark, Route } from 'lucide-react-native';
import { ContinuePlanningRail, BestNearYouRail, TrendingRail } from '../../src/components/PremiumHomeRails';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useGps } from '../../src/hooks/useGps';
import { colors, font, space, radii, QUICK_FILTERS } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import SpotCardCompact from '../../src/components/SpotCardCompact';
import FreshlyUpdatedRail from '../../src/components/FreshlyUpdatedRail';
import { SectionHeader, Chip, EmptyState } from '../../src/components/ui';
import { SectionSkeleton, SkeletonBox } from '../../src/components/Skeleton';
import UpgradeBanner from '../../src/components/UpgradeBanner';
import ScoutAICard from '../../src/components/ScoutAICard';
import ScoutAIIntroModal from '../../src/components/ScoutAIIntroModal';
import HomeInboxPreview from '../../src/components/HomeInboxPreview';
import { useUnreadMessages } from '../../src/hooks/useUnreadMessages';
import { readCache, writeCache } from '../../src/utils/swrCache';

type Feed = Record<string, any[]>;

// Sanitizer is pulled out so it can run once on cached payloads too,
// avoiding duplicate filtering work on every fetch vs. cache hydration.
function sanitizeFeed(data: any): any {
  const isRenderable = (s: any) => {
    if (!s || !s.title) return false;
    const imgs = Array.isArray(s.images) ? s.images : [];
    const cover = imgs.find((i: any) => i?.is_cover) || imgs[0];
    return !!cover?.image_url;
  };
  if (!data || typeof data !== 'object') return data;
  const appearances: Record<string, number> = {};
  for (const key of Object.keys(data)) {
    if (!Array.isArray(data[key])) continue;
    data[key] = data[key]
      .filter(isRenderable)
      .filter((s: any) => {
        const id = s.spot_id;
        if (!id) return false;
        const n = appearances[id] || 0;
        if (n >= 2) return false;
        appearances[id] = n + 1;
        return true;
      });
  }
  if (data.hero && !isRenderable(data.hero)) data.hero = null;
  return data;
}

export default function Home() {
  const { user } = useAuth();
  const unread = useUnreadMessages();
  const [feed, setFeed] = useState<Feed>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [unreadNotif, setUnreadNotif] = useState(0);
  const [filterResults, setFilterResults] = useState<any[] | null>(null);
  const { coords } = useGps();

  // PERF #1: unread-notification poll is deferred 500ms so the Home shell
  // can paint first. First page render no longer blocks on this call.
  useEffect(() => {
    let alive = true;
    const fire = async () => {
      try {
        const r = await api.get('/notifications', { limit: 1 });
        if (alive) setUnreadNotif(r.unread_count || 0);
      } catch {}
    };
    const kickoff = setTimeout(fire, 500);
    const iv = setInterval(fire, 45000);
    return () => { alive = false; clearTimeout(kickoff); clearInterval(iv); };
  }, []);

  // PERF #2: stale-while-revalidate. Hydrate from cached payload instantly
  // (under 100ms), then kick off a network refresh in the background. User
  // never stares at a skeleton after the first successful visit.
  // PERF #3: double-fetch bug fixed — previously the feed re-fetched the
  // moment coords resolved. We now debounce: if coords are pending, wait
  // up to 1.2s before falling back to a no-coords request; if coords
  // arrive first we fire immediately. Net result: exactly one network
  // fetch per home mount.
  const loadingRef = useRef(false);
  const hydratedOnceRef = useRef(false);

  const doFetch = useCallback(async (withCoords: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const params: any = {};
      if (withCoords && coords) {
        params.lat = coords.latitude;
        params.lng = coords.longitude;
      }
      const data = await api.get('/feed/home', Object.keys(params).length ? params : undefined);
      const clean = sanitizeFeed(data);
      setFeed(clean);
      writeCache('feed:home', clean).catch(() => {});
    } finally {
      setLoading(false);
      setRefreshing(false);
      loadingRef.current = false;
    }
  }, [coords]);

  // Instant cache hydration — runs ONCE on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readCache<Feed>('feed:home');
      if (alive && cached && !hydratedOnceRef.current) {
        setFeed(cached);
        setLoading(false);
        hydratedOnceRef.current = true;
      }
    })();
    return () => { alive = false; };
  }, []);

  // Single-fetch orchestration — waits briefly for GPS, then fires once.
  useEffect(() => {
    if (coords) {
      doFetch(true);
      return;
    }
    // GPS not ready yet — don't fire immediately. Give GPS up to 1.2s to
    // resolve; otherwise fire without coords so we don't deadlock users
    // who denied location permission.
    const t = setTimeout(() => doFetch(false), 1200);
    return () => clearTimeout(t);
  }, [coords, doFetch]);

  // Back-compat entry point for pull-to-refresh / manual reload buttons.
  const load = useCallback(async () => {
    return doFetch(!!coords);
  }, [doFetch, coords]);

  const applyFilter = async (label: string | null) => {
    setActiveFilter(label);
    if (!label) {
      setFilterResults(null);
      return;
    }
    let params: any = { sort: 'score', limit: 30 };
    if (['Family', 'Pet', 'Wedding', 'Urban', 'Nature'].includes(label)) {
      params.shoot_type = label;
    } else if (label === 'Sunset') {
      params.best_time_of_day = 'sunset';
    } else if (label === 'Indoor') {
      params.indoor = true;
    } else if (label === 'Dog Friendly') {
      params.dog_friendly = true;
    }
    const r = await api.get('/spots', params);
    setFilterResults(r);
  };

  // Premium home rail order (June 2026 Home Premium Upgrade PRD):
  //   1. Continue Planning      (saved spots — proxy until /routes/in-progress lands)
  //   2. Best Near You Right Now (= existing 'nearby')
  //   3. Trending This Week     (= existing 'trending')
  //   4. Freshly Updated Near You (rendered separately above, see freshly_updated key)
  //   5. Golden Hour Tonight    (= existing 'golden_hour')
  //   6. Creators You Follow    (= existing 'following')
  //   7. Hidden Gems            (Elite upsell card, rendered separately)
  // The order list below intentionally drops 'recent' / 'seasonal' / 'best_for_you'
  // from the visible Home — they're still computed by the backend and reachable via
  // the Explore tab; keeping the Home crisp and on-brand wins over showing every rail.
  const sections = [
    { key: 'nearby', title: 'Best Near You Right Now' },
    { key: 'trending', title: 'Trending This Week' },
    { key: 'golden_hour', title: 'Golden Hour Tonight' },
    { key: 'following', title: 'Creators You Follow' },
  ].filter((s) => Array.isArray(feed[s.key]) && feed[s.key].length > 0);
  // ^ hide every empty section globally — prevents blank headers in production UI

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <View style={{ gap: 6 }}>
            <SkeletonBox style={{ height: 12, width: 100 }} />
            <SkeletonBox style={{ height: 32, width: 180 }} />
          </View>
          <SkeletonBox style={{ width: 44, height: 44, borderRadius: 22 }} />
        </View>
        <SkeletonBox style={{ marginHorizontal: space.xl, marginTop: space.md, height: 48, borderRadius: radii.md }} />
        <SectionSkeleton />
        <SectionSkeleton />
      </SafeAreaView>
    );
  }

  const hero = (feed.trending || [])[0];

  // Premium numbered rail header (June 2026 Home Premium Upgrade).
  // Renders a circled gold number, serif title, and a "View all"
  // chevron link aligned right. Used inline below to override the
  // generic SectionHeader for the new home rail order.
  const NumberedRailHeader = ({
    n, title, onViewAll, fresh,
  }: { n: number; title: string; onViewAll?: () => void; fresh?: boolean }) => (
    <View style={styles.railHead}>
      <View style={styles.railHeadLeft}>
        <View style={styles.railNum}><Text style={styles.railNumTxt}>{n}</Text></View>
        <Text style={styles.railTitle}>{title}</Text>
        {fresh ? (
          <View style={styles.railFreshDot} />
        ) : null}
      </View>
      {onViewAll ? (
        <TouchableOpacity onPress={onViewAll} hitSlop={8} testID={`rail-view-all-${n}`}>
          <Text style={styles.railViewAll}>View all</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  // Map section keys → numbered rail position (1=Continue Planning,
  // 2=Best Near You, 3=Trending, 4=Freshly Updated, 5=Golden Hour,
  // 6=Creators You Follow, 7=Hidden Gems).
  const SECTION_NUM: Record<string, number> = {
    nearby: 2,
    trending: 3,
    golden_hour: 5,
    following: 6,
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScoutAIIntroModal />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingBottom: space.lg }}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Hello{user ? `, ${user.name.split(' ')[0]}` : ''}</Text>
            <Text style={styles.brand}>LumaScout</Text>
            <Text style={styles.brandSub}>Find epic places. Plan the perfect shot.</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/inbox')}
            style={styles.topIconBtn}
            testID="home-messages"
          >
            <MessageCircle size={20} color={colors.text} />
            {unread.unread_messages > 0 ? (
              <View style={styles.topIconBadge}>
                <Text style={styles.topIconBadgeTxt}>
                  {unread.unread_messages > 9 ? '9+' : unread.unread_messages}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
          {/* PRD: Share LumaScout — quick access between messages and avatar.
              Native Share sheet; referral-code appended when present.
              FIX: gold-tinted pill so it's clearly visible as a CTA next to
              the standard surface-colored Messages pill (same 40x40 shell). */}
          <TouchableOpacity
            onPress={async () => {
              try {
                const ref = (user as any)?.referral_code;
                const urlBase = 'https://lumascout.app';
                const url = ref ? `${urlBase}?ref=${encodeURIComponent(ref)}` : urlBase;
                await Share.share({
                  message: `I'm using LumaScout to find amazing photo spots — come join me 📸\n\n${url}`,
                  url,
                  title: 'LumaScout',
                });
              } catch {}
            }}
            style={styles.topShareBtn}
            testID="home-share"
          >
            <Share2 size={19} color={colors.primary} />
          </TouchableOpacity>
          {user?.avatar_url ? (
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} testID="home-avatar" style={styles.avatarWrap}>
              <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
              {unread.total > 0 ? <View style={styles.avatarRedDot} /> : null}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} style={[styles.avatarPh, styles.avatarWrap]} testID="home-avatar">
              <Text style={{ color: colors.text, fontFamily: font.bodyBold }}>
                {user?.name?.[0]?.toUpperCase() || '?'}
              </Text>
              {unread.total > 0 ? <View style={styles.avatarRedDot} /> : null}
            </TouchableOpacity>
          )}
        </View>

        {/* Premium Quick Action Pills (2026-04 Home PRD) — Near You /
            Golden Hour / Weather / Collections / Routes. Replaces the
            earlier Community tab strip which duplicated bottom nav
            affordances. Each pill renders an icon + bold label + contextual
            subtitle and deep-links into existing features. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0, maxHeight: 70 }}
          contentContainerStyle={styles.qaRow}
        >
          <TouchableOpacity
            onPress={() => router.push('/explore' as any)}
            style={[styles.qaPill, styles.qaPillActive]}
            testID="home-qa-nearyou"
          >
            <View style={styles.qaIcon}>
              <MapPin size={13} color={colors.primary} />
            </View>
            <View>
              <Text style={[styles.qaLabel, styles.qaLabelActive]}>Near You</Text>
              <Text style={[styles.qaSub, styles.qaSubActive]}>50 mi</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/explore' as any)}
            style={styles.qaPill}
            testID="home-qa-golden"
          >
            <View style={styles.qaIcon}>
              <Sun size={13} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.qaLabel}>Golden Hour</Text>
              <Text style={styles.qaSub}>2h 18m</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/explore' as any)}
            style={styles.qaPill}
            testID="home-qa-weather"
          >
            <View style={styles.qaIcon}>
              <Cloud size={13} color={colors.textSecondary} />
            </View>
            <View>
              <Text style={styles.qaLabel}>Weather</Text>
              <Text style={styles.qaSub}>72°F</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/saved' as any)}
            style={styles.qaPill}
            testID="home-qa-collections"
          >
            <View style={styles.qaIcon}>
              <Bookmark size={13} color={colors.textSecondary} />
            </View>
            <View>
              <Text style={styles.qaLabel}>Collections</Text>
              <Text style={styles.qaSub}>{(user as any)?.collections_count ?? 0} saved</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/routes' as any)}
            style={styles.qaPill}
            testID="home-qa-routes"
          >
            <View style={styles.qaIcon}>
              <Route size={13} color={colors.textSecondary} />
            </View>
            <View>
              <Text style={styles.qaLabel}>Routes</Text>
              <Text style={styles.qaSub}>{(user as any)?.routes_count ?? 0} planned</Text>
            </View>
          </TouchableOpacity>
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: space.xl, marginTop: space.sm }}>
          <TouchableOpacity
            style={[styles.searchBar, { flex: 1, marginHorizontal: 0, marginTop: 0 }]}
            onPress={() => router.push('/search')}
            testID="home-search"
            activeOpacity={0.85}
          >
            <Search size={18} color={colors.textSecondary} />
            <Text style={styles.searchPlaceholder}>Search spots, cities, creators…</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/notifications' as any)}
            style={styles.notifBtn}
            testID="home-notifications"
            activeOpacity={0.85}
          >
            <SlidersHorizontal size={18} color={colors.text} />
            {unreadNotif > 0 ? (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeTxt}>{unreadNotif > 9 ? '9+' : unreadNotif}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* Clutter removed per mockup: UpgradeBanner / Scout AI card /
            Inbox preview / niche chip row / EDITOR'S PICK hero were all
            pulled off the Home. Scout AI and notifications remain
            reachable via the header icons. Hero content is now surfaced
            through the much more editorial "Best Near You Right Now"
            rail below. */}

        {/* Rail #1 — Continue Planning */}
        <ContinuePlanningRail items={feed.saved_plans || feed.recent || feed.near_you || feed.nearby || []} />

        {/* Rail #2 — Best Near You Right Now */}
        <BestNearYouRail items={feed.nearby || feed.near_you || feed.trending || []} />

        {/* Rail #3 — Trending This Week */}
        <TrendingRail items={feed.trending || feed.trending_again || feed.nearby || []} />

        {filterResults ? (
          <>
            <SectionHeader title={`${activeFilter} spots`} />
            {filterResults.length === 0 ? (
              <EmptyState title="No spots found" subtitle="Try another filter or explore the map." />
            ) : (
              <View style={{ paddingHorizontal: space.xl, gap: space.md }}>
                {filterResults.map((s) => (
                  <SpotCard
                    key={s.spot_id}
                    spot={s}
                    width={undefined as any}
                    testID={`spot-${s.spot_id}`}
                  />
                ))}
              </View>
            )}
          </>
        ) : (
          <>
            {/* Hero block removed per Apr 2026 mockup — its inspirational
                role is now played by the much more editorial
                "Best Near You Right Now" rail rendered above. */}
            {/* Freshly Updated Near You — rail #4 (the retention rail). */}
            {Array.isArray(feed.freshly_updated) && feed.freshly_updated.length > 0 && (
              <View>
                <NumberedRailHeader n={4} title="Freshly Updated Near You" fresh onViewAll={() => router.push('/explore' as any)} />
                <FreshlyUpdatedRail spots={feed.freshly_updated} />
              </View>
            )}
            {/* Phase-2 helper rails (new_photos/verified_this_week/
                blooming_now/trending_again) and the generic numbered
                sections.map loop were removed per the Apr 2026 mockup —
                they duplicated the content of the three premium rails
                above. Only Freshly Updated stays as rail #4. */}

            {/* Rails #5 (Golden Hour) and #6 (Creators You Follow) — keep
                their traditional presentation so the home feels full even
                when data is light. Numbered headers match rail hierarchy. */}
            {sections.filter((sec) => sec.key === 'golden_hour' || sec.key === 'following').map((sec) => {
              const items = feed[sec.key] || [];
              if (items.length === 0) return null;
              const num = SECTION_NUM[sec.key];
              return (
                <View key={sec.key}>
                  {num ? (
                    <NumberedRailHeader
                      n={num}
                      title={sec.title}
                      onViewAll={() => router.push('/explore' as any)}
                    />
                  ) : (
                    <SectionHeader title={sec.title} />
                  )}
                  <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={items}
                    keyExtractor={(it) => it.spot_id || it.user_id}
                    contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.md }}
                    renderItem={({ item }) => (
                      <SpotCard spot={item} width={260} testID={`spot-${item.spot_id}`} onToggleSave={load} />
                    )}
                  />
                </View>
              );
            })}
            {/* Rail #7 — Hidden Gems Elite upsell card. Only renders for
                non-Elite plans; Elite users see the actual hidden-gems
                feed in /explore?bucket=hidden (shipped separately). */}
            {(user as any)?.plan !== 'elite' && (user as any)?.plan !== 'comp_elite' && (user as any)?.plan !== 'trial_elite' ? (
              <TouchableOpacity
                onPress={() => router.push('/upgrade' as any)}
                style={styles.gemsCard}
                activeOpacity={0.9}
                testID="home-hidden-gems"
              >
                <View style={styles.gemsIcon}>
                  <Gem size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gemsTitle}>Unlock Hidden Gems</Text>
                  <Text style={styles.gemsSub}>Discover 200+ handpicked spots only Elite members can see.</Text>
                </View>
                <View style={styles.gemsCta}>
                  <Text style={styles.gemsCtaTxt}>Explore Elite</Text>
                  <ChevronRight size={14} color={colors.textInverse} />
                </View>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.sm,
    gap: 10,
  },
  topIconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  // Numeric unread badge for the Messages pill (Tier 1 messaging upgrade).
  topIconBadge: {
    position: 'absolute', top: -3, right: -3,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#ef4444', paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
  topIconBadgeTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 9 },
  // Avatar red-dot overlay — small surface that reads "you have activity".
  avatarWrap: { position: 'relative' },
  avatarRedDot: {
    position: 'absolute', top: -1, right: -1,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#ef4444',
    borderWidth: 2, borderColor: colors.bg,
  },
  // Gold-tinted pill variant so the Share CTA reads as a distinct action
  // between the Messages pill and the avatar. Same 40x40 shell for vertical
  // alignment parity with the other two top-bar items.
  topShareBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  communityStrip: { paddingHorizontal: space.xl, paddingBottom: space.sm, gap: 6, alignItems: 'center' },
  cTab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1 },
  // Subtle "you are here" — no primary fill. Just a darker surface and
  // slightly bolder typography so the current tab is distinguishable
  // without shouting. (Commit 8b / 2026-04)
  cTabHere: { backgroundColor: colors.surface2, borderColor: colors.borderStrong || colors.border },
  cTabTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  cTabTxtHere: { color: colors.text, fontFamily: font.bodySemibold },
  hello: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  brand: { color: colors.text, fontFamily: font.display, fontSize: 30, letterSpacing: -0.5 },
  brandSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },
  // Quick Action Pills (2026-04 Home Premium) — Near You / Golden Hour /
  // Weather / Collections / Routes. Each pill is a compact gold-accent
  // card with icon + bold label + subtle status subtitle.
  qaRow: {
    paddingHorizontal: space.xl,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
    alignItems: 'center',
  },
  qaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 52,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qaPillActive: {
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderColor: 'rgba(245,166,35,0.6)',
  },
  qaIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245,166,35,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  qaLabel: { color: colors.text, fontFamily: font.bodyBold, fontSize: 12 },
  qaLabelActive: { color: colors.primary },
  qaSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, marginTop: 1 },
  qaSubActive: { color: colors.primary, opacity: 0.85 },
  // Premium numbered rail header (2026-04 Home Premium Upgrade).
  railHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xl, marginTop: space.md, marginBottom: 8,
  },
  railHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  railNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  railNumTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11 },
  railTitle: { color: colors.text, fontFamily: font.display, fontSize: 18, flexShrink: 1 },
  railFreshDot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: '#22c55e',
    marginLeft: 2,
  },
  railViewAll: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 12 },
  // Hidden Gems Elite upsell card — rail #7.
  gemsCard: {
    marginHorizontal: space.xl, marginTop: space.lg, marginBottom: space.sm,
    padding: 16, borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)',
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  gemsIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(245,166,35,0.14)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.45)',
  },
  gemsTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  gemsSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 3, lineHeight: 16 },
  gemsCta: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
    backgroundColor: colors.primary,
  },
  gemsCtaTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 11 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPh: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  searchBar: {
    marginHorizontal: space.xl,
    marginTop: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    // FIX: explicit height so the search bar lines up perfectly with the
    // notif bell (both 48px) regardless of platform font padding.
    height: 48,
    borderRadius: radii.md,
  },
  searchPlaceholder: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14 },
  // Notifications bell — matches search bar height for a clean inline row.
  notifBtn: { width: 48, height: 48, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  notifBadge: { position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.secondary || '#ef4444', paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  notifBadgeTxt: { color: colors.textInverse || '#fff', fontFamily: font.bodyBold, fontSize: 9 },
  heroCard: {
    marginHorizontal: space.xl, marginTop: space.xl,
    borderRadius: radii.lg, overflow: 'hidden',
    backgroundColor: colors.surface2,
    aspectRatio: 4 / 3,
    borderWidth: 1, borderColor: colors.border,
  },
  heroImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  heroGrad: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%' },
  heroTop: { position: 'absolute', top: space.md, left: space.md, flexDirection: 'row', gap: 6 },
  heroTag: {
    flexDirection: 'row', gap: 4, alignItems: 'center',
    backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill,
  },
  heroTagTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.6 },
  heroBottom: { position: 'absolute', bottom: space.lg, left: space.lg, right: space.lg },
  heroTitle: { color: colors.text, fontFamily: font.display, fontSize: 26, letterSpacing: -0.3, lineHeight: 30 },
  heroMeta: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12, marginTop: 4 },
});
