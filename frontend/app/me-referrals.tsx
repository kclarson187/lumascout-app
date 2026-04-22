/**
 * My Referrals — poster view + applicant view.
 * Path: /me-referrals
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import { ArrowLeft, Plus, Briefcase } from 'lucide-react-native';
import { api } from '../src/api';
import { colors, font, space, radii } from '../src/theme';
import ReferralCard, { ReferralNeed } from '../src/components/ReferralCard';

type Application = {
  app_id: string;
  status: string;
  pitch?: string | null;
  created_at: string;
  thread_id?: string;
  need: ReferralNeed;
};

export default function MyReferrals() {
  const [tab, setTab] = useState<'posted' | 'applied'>('posted');
  const [posted, setPosted] = useState<ReferralNeed[]>([]);
  const [applied, setApplied] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        api.get('/me/referrals'),
        api.get('/me/applications'),
      ]);
      setPosted(p?.items || []);
      setApplied(a?.items || []);
    } catch (e) {
      console.warn('me-referrals load', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Referrals</Text>
        <TouchableOpacity onPress={() => router.push('/referrals/new' as any)} style={styles.backBtn} hitSlop={10}>
          <Plus size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Tab switch */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'posted' && styles.tabActive]}
          onPress={() => setTab('posted')}
          testID="me-ref-tab-posted"
        >
          <Text style={[styles.tabTxt, tab === 'posted' && styles.tabTxtActive]}>
            Posted ({posted.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'applied' && styles.tabActive]}
          onPress={() => setTab('applied')}
          testID="me-ref-tab-applied"
        >
          <Text style={[styles.tabTxt, tab === 'applied' && styles.tabTxtActive]}>
            Applied ({applied.length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {tab === 'posted' ? (
            posted.length === 0 ? (
              <EmptyState
                title="No posts yet"
                sub="Post a need to find photographers for your overflow work."
                cta="Post your first need"
                onPress={() => router.push('/referrals/new' as any)}
              />
            ) : (
              posted.map((n) => (
                <ReferralCard key={n.need_id} need={n} onPress={() => router.push(`/referrals/${n.need_id}` as any)} />
              ))
            )
          ) : (
            applied.length === 0 ? (
              <EmptyState
                title="No applications yet"
                sub="Browse open referrals and apply to the ones that fit."
                cta="Browse referrals"
                onPress={() => router.push('/referrals' as any)}
              />
            ) : (
              applied.map((a) => (
                <View key={a.app_id}>
                  <ReferralCard
                    need={a.need}
                    onPress={() => router.push(`/referrals/${a.need.need_id}` as any)}
                  />
                </View>
              ))
            )
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function EmptyState({ title, sub, cta, onPress }: { title: string; sub: string; cta: string; onPress: () => void }) {
  return (
    <View style={styles.emptyCard}>
      <Briefcase size={32} color={colors.textTertiary} />
      <Text style={styles.emptyHead}>{title}</Text>
      <Text style={styles.emptySub}>{sub}</Text>
      <TouchableOpacity style={styles.emptyCta} onPress={onPress}>
        <Text style={styles.emptyCtaTxt}>{cta}</Text>
      </TouchableOpacity>
    </View>
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
  headerTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: space.md, paddingVertical: space.sm, gap: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radii.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.4)' },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 0.4 },
  tabTxtActive: { color: colors.primary },
  emptyCard: {
    alignItems: 'center', padding: space.xxl, gap: 8,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg,
  },
  emptyHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15, marginTop: space.sm },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  emptyCta: {
    marginTop: space.md, backgroundColor: colors.primary,
    paddingVertical: 11, paddingHorizontal: 20, borderRadius: radii.md,
  },
  emptyCtaTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },
});
