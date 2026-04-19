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
import { Search } from 'lucide-react-native';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii, QUICK_FILTERS } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import { SectionHeader, Chip, EmptyState } from '../../src/components/ui';

type Feed = Record<string, any[]>;

export default function Home() {
  const { user } = useAuth();
  const [feed, setFeed] = useState<Feed>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterResults, setFilterResults] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/feed/home');
      setFeed(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
  ].filter((s) => !['best_for_you', 'following'].includes(s.key) || (feed[s.key] && feed[s.key].length > 0));

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingBottom: space.xxxl }}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.hello}>Hello{user ? `, ${user.name.split(' ')[0]}` : ''}</Text>
            <Text style={styles.brand}>PhotoScout</Text>
          </View>
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

        <TouchableOpacity
          style={styles.searchBar}
          onPress={() => router.push('/search')}
          testID="home-search"
          activeOpacity={0.85}
        >
          <Search size={18} color={colors.textSecondary} />
          <Text style={styles.searchPlaceholder}>Search cities, spots, or tags…</Text>
        </TouchableOpacity>

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
          sections.map((sec) => {
            const items = feed[sec.key] || [];
            if (items.length === 0) return null;
            return (
              <View key={sec.key}>
                <SectionHeader title={sec.title} />
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={items}
                  keyExtractor={(it) => it.spot_id}
                  contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.md }}
                  renderItem={({ item }) => (
                    <SpotCard spot={item} testID={`spot-${item.spot_id}`} onToggleSave={load} />
                  )}
                />
              </View>
            );
          })
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
  },
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
});
