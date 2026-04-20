import React, { useCallback, useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, TrendingUp, MessageCircle, Users, HandHeart, BookOpen } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useGps } from '../../src/hooks/useGps';
import { colors, font, space, radii, QUICK_FILTERS } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import SpotCardCompact from '../../src/components/SpotCardCompact';
import { SectionHeader, Chip, EmptyState } from '../../src/components/ui';
import { SectionSkeleton, SkeletonBox } from '../../src/components/Skeleton';
import UpgradeBanner from '../../src/components/UpgradeBanner';

type Feed = Record<string, any[]>;

export default function Home() {
  const { user } = useAuth();
  const [feed, setFeed] = useState<Feed>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterResults, setFilterResults] = useState<any[] | null>(null);
  const { coords } = useGps();

  const load = useCallback(async () => {
    try {
      const params: any = {};
      if (coords) {
        params.lat = coords.latitude;
        params.lng = coords.longitude;
      }
      const data = await api.get('/feed/home', Object.keys(params).length ? params : undefined);

      // Sanitize feed — drop spots that would render as blank/incomplete cards
      // (no title, no images), and limit same-spot repetition to max 2 sections
      // to avoid feeling seeded. This preserves hero since hero is a single pick.
      const isRenderable = (s: any) => {
        if (!s) return false;
        if (!s.title) return false;
        const imgs = Array.isArray(s.images) ? s.images : [];
        const cover = imgs.find((i: any) => i?.is_cover) || imgs[0];
        return !!cover?.image_url;
      };
      const appearances: Record<string, number> = {};
      if (data && typeof data === 'object') {
        for (const key of Object.keys(data)) {
          if (!Array.isArray(data[key])) continue;
          data[key] = data[key]
            .filter(isRenderable)
            .filter((s: any) => {
              const id = s.spot_id;
              if (!id) return false;
              const n = appearances[id] || 0;
              if (n >= 2) return false;  // cap repetition across sections
              appearances[id] = n + 1;
              return true;
            });
        }
        // Hero: only keep if renderable
        if (data.hero && !isRenderable(data.hero)) data.hero = null;
      }
      setFeed(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [coords]);

  useEffect(() => { load(); }, [load]);

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
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingBottom: space.xxxl }}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Hello{user ? `, ${user.name.split(' ')[0]}` : ''}</Text>
            <Text style={styles.brand}>PhotoScout</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/messages')}
            style={styles.topIconBtn}
            testID="home-messages"
          >
            <MessageCircle size={20} color={colors.text} />
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

        {/* Community tab strip — single source of social navigation */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, maxHeight: 48 }} contentContainerStyle={styles.communityStrip}>
          <View style={[styles.cTab, styles.cTabActive]}>
            <Text style={[styles.cTabTxt, { color: colors.textInverse }]}>For You</Text>
          </View>
          <TouchableOpacity style={styles.cTab} onPress={() => router.push('/community')} testID="home-tab-community">
            <Users size={12} color={colors.text} />
            <Text style={styles.cTabTxt}>Community</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cTab} onPress={() => router.push({ pathname: '/community', params: { cat: 'all' } })} testID="home-tab-local">
            <Text style={styles.cTabTxt}>Local</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cTab} onPress={() => router.push({ pathname: '/community', params: { cat: 'referral' } })} testID="home-tab-opps">
            <HandHeart size={12} color={colors.text} />
            <Text style={styles.cTabTxt}>Opportunities</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cTab} onPress={() => router.push({ pathname: '/community', params: { cat: 'tip' } })} testID="home-tab-learn">
            <BookOpen size={12} color={colors.text} />
            <Text style={styles.cTabTxt}>Learn</Text>
          </TouchableOpacity>
        </ScrollView>

        <TouchableOpacity
          style={styles.searchBar}
          onPress={() => router.push('/search')}
          testID="home-search"
          activeOpacity={0.85}
        >
          <Search size={18} color={colors.textSecondary} />
          <Text style={styles.searchPlaceholder}>Search cities, spots, or tags…</Text>
        </TouchableOpacity>

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
  communityStrip: { paddingHorizontal: space.xl, paddingBottom: space.sm, gap: 6, alignItems: 'center' },
  cTab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1 },
  cTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  cTabTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
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
    paddingVertical: 14,
    borderRadius: radii.md,
  },
  searchPlaceholder: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14 },
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
