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
import { Search, TrendingUp, MessageCircle, Users, HandHeart, BookOpen, Bell, Share2 } from 'lucide-react-native';
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

  const sections = [
    { key: 'nearby', title: 'Nearby spots' },
    { key: 'trending', title: 'Trending this week' },
    { key: 'golden_hour', title: 'Golden hour favorites' },
    { key: 'best_for_you', title: 'Best for your shoots' },
    { key: 'seasonal', title: 'Seasonal highlights' },
    { key: 'following', title: 'From photographers you follow' },
    { key: 'recent', title: 'Recently added' },
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

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScoutAIIntroModal />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingBottom: space.xxxl }}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Hello{user ? `, ${user.name.split(' ')[0]}` : ''}</Text>
            <Text style={styles.brand}>LumaScout</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/inbox')}
            style={styles.topIconBtn}
            testID="home-messages"
          >
            <MessageCircle size={20} color={colors.text} />
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
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} testID="home-avatar">
              <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} style={styles.avatarPh} testID="home-avatar">
              <Text style={{ color: colors.text, fontFamily: font.bodyBold }}>
                {user?.name?.[0]?.toUpperCase() || '?'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Community tab strip — nav-pill style. No amber active state:
            "For You" IS the home screen, so the strip is purely a
            quick-jump bar to sibling views. Subtle font-weight emphasis
            tells the user where they are without the loud primary fill. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, maxHeight: 48 }} contentContainerStyle={styles.communityStrip}>
          <View style={[styles.cTab, styles.cTabHere]} testID="home-tab-foryou">
            <Text style={[styles.cTabTxt, styles.cTabTxtHere]}>For You</Text>
          </View>
          <TouchableOpacity style={styles.cTab} onPress={() => router.push('/community')} testID="home-tab-community">
            <Users size={12} color={colors.textSecondary} />
            <Text style={styles.cTabTxt}>Community</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cTab} onPress={() => router.push({ pathname: '/community', params: { cat: 'all' } })} testID="home-tab-local">
            <Text style={styles.cTabTxt}>Local</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cTab} onPress={() => router.push({ pathname: '/community', params: { cat: 'referral' } })} testID="home-tab-opps">
            <HandHeart size={12} color={colors.textSecondary} />
            <Text style={styles.cTabTxt}>Opportunities</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cTab} onPress={() => router.push({ pathname: '/community', params: { cat: 'tip' } })} testID="home-tab-learn">
            <BookOpen size={12} color={colors.textSecondary} />
            <Text style={styles.cTabTxt}>Learn</Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: space.xl, marginTop: space.sm }}>
          <TouchableOpacity
            // FIX: null out the marginTop/marginHorizontal baked into the
            // shared searchBar style — those margins were pushing the bar
            // down inside this flex row and causing the notif bell to look
            // offset. With them zeroed, the parent's alignItems:'center'
            // lines both children up perfectly.
            style={[styles.searchBar, { flex: 1, marginHorizontal: 0, marginTop: 0 }]}
            onPress={() => router.push('/search')}
            testID="home-search"
            activeOpacity={0.85}
          >
            <Search size={18} color={colors.textSecondary} />
            <Text style={styles.searchPlaceholder}>Search cities, spots, or tags…</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/notifications' as any)}
            style={styles.notifBtn}
            testID="home-notifications"
            activeOpacity={0.85}
          >
            <Bell size={18} color={colors.text} />
            {unreadNotif > 0 ? (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeTxt}>{unreadNotif > 9 ? '9+' : unreadNotif}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* PRD #9 — Contextual monetisation: dismissible Pro upsell shown only
            to free users at the top of their For-You feed. */}
        <View style={{ paddingHorizontal: space.xl, marginTop: space.md }}>
          <UpgradeBanner
            placement="home-feed"
            title="Unlock the full photographer network"
            subtitle="Pro members save unlimited spots, get AI shot lists, and message anyone."
            cta="Go Pro"
            targetPlan="pro"
          />
        </View>

        {/* Scout AI — official in-app assistant entry point (PRD Scout AI Phase 1). */}
        <View style={{ paddingHorizontal: space.xl, marginTop: space.md }}>
          <ScoutAICard placement="home" />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.xl, gap: 8 }}
          style={{ marginTop: space.md }}
        >
          <Chip
            label="All"
            active={!activeFilter}
            onPress={() => applyFilter(null)}
            testID="filter-all"
          />
          {QUICK_FILTERS.map((f) => (
            <Chip
              key={f}
              label={f}
              active={activeFilter === f}
              onPress={() => applyFilter(f)}
              testID={`filter-${f}`}
            />
          ))}
        </ScrollView>

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
            {hero && (
              <TouchableOpacity
                style={styles.heroCard}
                onPress={() => router.push(`/spot/${hero.spot_id}`)}
                testID="home-hero"
                activeOpacity={0.9}
              >
                <Image source={{ uri: (hero.images?.find((i: any) => i.is_cover) || hero.images?.[0])?.image_url }} style={styles.heroImg} />
                <LinearGradient colors={['transparent', 'rgba(10,10,10,0.9)']} style={styles.heroGrad} />
                <View style={styles.heroTop}>
                  <View style={styles.heroTag}>
                    <TrendingUp size={12} color={colors.textInverse} />
                    <Text style={styles.heroTagTxt}>EDITOR'S PICK</Text>
                  </View>
                </View>
                <View style={styles.heroBottom}>
                  <Text style={styles.heroTitle} numberOfLines={2}>{hero.title}</Text>
                  <Text style={styles.heroMeta}>{hero.city}, {hero.state} · Shoot Score {hero.shoot_score}</Text>
                </View>
              </TouchableOpacity>
            )}
            {/* Freshly Updated Near You (Feature 9) — the retention rail. */}
            {Array.isArray(feed.freshly_updated) && feed.freshly_updated.length > 0 && (
              <View>
                <SectionHeader title="Freshly updated near you" />
                <FreshlyUpdatedRail spots={feed.freshly_updated} />
              </View>
            )}
            {/* New Photos Added (Phase 2) */}
            {Array.isArray(feed.new_photos) && feed.new_photos.length > 0 && (
              <View>
                <SectionHeader title="New photos added" />
                <FreshlyUpdatedRail spots={feed.new_photos} />
              </View>
            )}
            {/* Verified This Week (Phase 2) */}
            {Array.isArray(feed.verified_this_week) && feed.verified_this_week.length > 0 && (
              <View>
                <SectionHeader title="Verified this week" />
                <FreshlyUpdatedRail spots={feed.verified_this_week} />
              </View>
            )}
            {/* Blooming Now (Phase 2) */}
            {Array.isArray(feed.blooming_now) && feed.blooming_now.length > 0 && (
              <View>
                <SectionHeader title="Blooming now" />
                <FreshlyUpdatedRail spots={feed.blooming_now} />
              </View>
            )}
            {/* Trending Again (Phase 2 bonus) */}
            {Array.isArray(feed.trending_again) && feed.trending_again.length > 0 && (
              <View>
                <SectionHeader title="Trending again" />
                <FreshlyUpdatedRail spots={feed.trending_again} />
              </View>
            )}
            {sections.map((sec) => {
              const items = feed[sec.key] || [];
              if (items.length === 0) return null;
              // Section-specific visual treatment:
              //  - Carousel style for inspirational sections (hero-like cards)
              //  - Compact vertical list for skimmable utility sections
              // Also drive per-section metadata emphasis inside the cards.
              const useCompact = sec.key === 'recent' || sec.key === 'seasonal';
              const emphasis: any =
                sec.key === 'nearby' ? 'distance' :
                sec.key === 'golden_hour' ? 'golden' :
                sec.key === 'trending' ? 'score' :
                sec.key === 'seasonal' ? 'seasonal' :
                sec.key === 'recent' ? 'fresh' :
                sec.key === 'best_for_you' ? 'score' :
                'fresh';
              return (
                <View key={sec.key}>
                  <SectionHeader title={sec.title} />
                  {useCompact ? (
                    <View style={{ paddingHorizontal: space.xl, gap: 8 }}>
                      {items.slice(0, 6).map((item: any) => (
                        <SpotCardCompact
                          key={item.spot_id}
                          spot={item}
                          emphasis={emphasis}
                          testID={`spot-${item.spot_id}`}
                        />
                      ))}
                    </View>
                  ) : (
                    <FlatList
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      data={items}
                      keyExtractor={(it) => it.spot_id}
                      contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.md }}
                      renderItem={({ item }) => (
                        <SpotCard spot={item} width={260} testID={`spot-${item.spot_id}`} onToggleSave={load} />
                      )}
                    />
                  )}
                </View>
              );
            })}
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
  topIconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
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
