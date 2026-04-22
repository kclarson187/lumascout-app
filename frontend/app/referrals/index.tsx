/**
 * Referral Marketplace — browse feed.
 * Entry point: /referrals
 *   - 6 horizontal rails (Urgent / Nearby / Wedding / Pet / 2nd Shooter / New Today)
 *   - Browse-all list below rails
 *   - FAB "Post a Need" → /referrals/new
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import { ArrowLeft, Plus, Briefcase, ClipboardList } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import ReferralCard, { ReferralNeed } from '../../src/components/ReferralCard';

type Rails = Record<string, ReferralNeed[]>;

const RAIL_ORDER: Array<{ key: string; label: string; emoji: string }> = [
  { key: 'urgent', label: 'Urgent Needs', emoji: '⚡' },
  { key: 'nearby', label: 'Nearby Opportunities', emoji: '📍' },
  { key: 'new_today', label: 'New Today', emoji: '🆕' },
  { key: 'wedding', label: 'Wedding Jobs', emoji: '💍' },
  { key: 'pet', label: 'Pet Photography', emoji: '🐾' },
  { key: 'second_shooter', label: '2nd Shooter Requests', emoji: '📸' },
];

export default function ReferralsIndex() {
  const [rails, setRails] = useState<Rails>({});
  const [allList, setAllList] = useState<ReferralNeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [railsRes, listRes] = await Promise.all([
        api.get('/referrals/rails'),
        api.get('/referrals', { limit: 30 }),
      ]);
      setRails(railsRes || {});
      setAllList(listRes?.items || []);
    } catch (e) {
      console.warn('load referrals failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  const totalRails = useMemo(
    () => RAIL_ORDER.reduce((s, r) => s + ((rails[r.key] || []).length), 0),
    [rails]
  );

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={10} testID="referrals-back">
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Referral Marketplace</Text>
        <TouchableOpacity
          onPress={() => router.push('/me-referrals' as any)}
          style={styles.myBtn}
          testID="referrals-my"
        >
          <ClipboardList size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {loading && allList.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {/* Top intro */}
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <Briefcase size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.introTitle}>Find your next gig</Text>
              <Text style={styles.introSub}>
                Apply to photographer referrals or post a need of your own.
              </Text>
            </View>
          </View>

          {/* Rails */}
          {totalRails > 0 ? (
            RAIL_ORDER.map((rail) => {
              const items = rails[rail.key] || [];
              if (items.length === 0) return null;
              return (
                <View key={rail.key} style={{ marginTop: space.lg }}>
                  <View style={styles.railHead}>
                    <Text style={styles.railTitle}>
                      {rail.emoji}  {rail.label}
                    </Text>
                    <Text style={styles.railCount}>{items.length}</Text>
                  </View>
                  <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={items}
                    keyExtractor={(i) => i.need_id}
                    contentContainerStyle={{ paddingHorizontal: space.xl }}
                    renderItem={({ item }) => (
                      <ReferralCard
                        need={item}
                        compact
                        onPress={() => router.push(`/referrals/${item.need_id}` as any)}
                      />
                    )}
                  />
                </View>
              );
            })
          ) : null}

          {/* Browse all */}
          <View style={{ marginTop: space.xxl, paddingHorizontal: space.xl }}>
            <Text style={styles.sectionHead}>All open needs</Text>
            {allList.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyHead}>No open referrals right now</Text>
                <Text style={styles.emptySub}>
                  Be the first to post. Referrals are where photographers get work.
                </Text>
              </View>
            ) : (
              allList.map((n) => (
                <ReferralCard
                  key={n.need_id}
                  need={n}
                  onPress={() => router.push(`/referrals/${n.need_id}` as any)}
                />
              ))
            )}
          </View>
        </ScrollView>
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/referrals/new' as any)}
        testID="referrals-post-fab"
      >
        <Plus size={20} color={colors.textInverse} />
        <Text style={styles.fabTxt}>Post a Need</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  myBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16, letterSpacing: 0.3 },

  intro: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: space.xl,
    padding: space.md,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.22)',
    borderRadius: radii.lg,
  },
  introIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  introTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  introSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },

  railHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xl, marginBottom: space.sm,
  },
  railTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, letterSpacing: 0.3 },
  railCount: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11 },

  sectionHead: {
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: space.md,
  },

  emptyCard: {
    alignItems: 'center', padding: space.xl, gap: 4,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md,
  },
  emptyHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, textAlign: 'center', lineHeight: 18 },

  fab: {
    position: 'absolute', bottom: 24, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 20,
    backgroundColor: colors.primary, borderRadius: 28,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14, letterSpacing: 0.3 },
});
