import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Image } from 'react-native';
import { router } from 'expo-router';
import { Users as UsersIcon, Crown, AlertTriangle, Map, TrendingUp, ChevronRight, Sparkles } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import VerifiedBadge from '../../src/components/VerifiedBadge';

export default function AdminOverview() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.get('/admin/overview')); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  }
  if (!data) return null;

  const kpis = [
    { k: 'total_users',   label: 'Total users',     value: data.users.total,        color: colors.primary },
    { k: 'new_today',     label: 'New today',       value: data.users.new_today,    color: colors.success },
    { k: 'active_7d',     label: 'Active 7d (proxy)', value: data.users.active_7d,  color: colors.info },
    { k: 'suspended',     label: 'Suspended',       value: data.users.suspended,    color: colors.secondary },
  ];

  const planRows = [
    { k: 'free',  label: 'Free',  value: data.users.by_plan.free },
    { k: 'pro',   label: 'Pro',   value: data.users.by_plan.pro },
    { k: 'elite', label: 'Elite', value: data.users.by_plan.elite },
  ];

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 80 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      <View style={styles.grid}>
        {kpis.map((k) => (
          <View key={k.k} style={[styles.kpi, { borderColor: k.color }]}>
            <Text style={styles.kpiLabel}>{k.label}</Text>
            <Text style={styles.kpiVal}>{k.value.toLocaleString()}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Crown size={16} color={colors.primary} />
          <Text style={styles.cardTitle}>Revenue snapshot</Text>
        </View>
        <Text style={styles.revenue}>${data.revenue.monthly_estimate_usd.toLocaleString()}<Text style={styles.revenueSub}>/mo est.</Text></Text>
        <Text style={styles.tiny}>{data.revenue.note}</Text>
        <View style={{ height: 12 }} />
        <View style={styles.planRowWrap}>
          {planRows.map((p) => (
            <View key={p.k} style={styles.planRow}>
              <Text style={styles.planLabel}>{p.label}</Text>
              <Text style={styles.planVal}>{p.value}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.grid2}>
        <TouchableOpacity style={styles.queueCard} onPress={() => router.push('/admin/spots')} testID="overview-go-spots">
          <AlertTriangle size={18} color={colors.warning} />
          <Text style={styles.queueVal}>{data.moderation.pending_spots}</Text>
          <Text style={styles.queueLabel}>Pending spot approvals</Text>
          <ChevronRight size={16} color={colors.textSecondary} style={{ position: 'absolute', top: 14, right: 14 }} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.queueCard} onPress={() => router.push('/admin/reports')} testID="overview-go-reports">
          <AlertTriangle size={18} color={colors.secondary} />
          <Text style={styles.queueVal}>{data.moderation.pending_reports}</Text>
          <Text style={styles.queueLabel}>Reports to review</Text>
          <ChevronRight size={16} color={colors.textSecondary} style={{ position: 'absolute', top: 14, right: 14 }} />
        </TouchableOpacity>
      </View>

      {/* PRD Scout AI Phase 3 — Admin controls shortcut */}
      <TouchableOpacity
        style={[styles.queueCard, { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.08)' }]}
        onPress={() => router.push('/admin/ai-controls' as any)}
        testID="overview-go-ai-controls"
      >
        <Sparkles size={18} color={colors.primary} />
        <Text style={[styles.queueLabel, { color: colors.primary, fontFamily: font.bodyBold, marginTop: 6 }]}>Scout AI controls</Text>
        <Text style={[styles.queueLabel, { marginTop: 2 }]}>Cadence, editorial posts, AI replies</Text>
        <ChevronRight size={16} color={colors.primary} style={{ position: 'absolute', top: 14, right: 14 }} />
      </TouchableOpacity>

      {data.top_contributors?.length > 0 && (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <UsersIcon size={16} color={colors.primary} />
            <Text style={styles.cardTitle}>Top contributors (30d)</Text>
          </View>
          <View style={{ gap: 10, marginTop: 4 }}>
            {data.top_contributors.map((u: any) => (
              <TouchableOpacity
                key={u.user_id}
                style={styles.userRow}
                onPress={() => router.push(`/admin/user/${u.user_id}` as any)}
                testID={`overview-user-${u.user_id}`}
              >
                {u.avatar_url
                  ? <Image source={{ uri: u.avatar_url }} style={styles.avatar} />
                  : <View style={[styles.avatar, { backgroundColor: colors.surface2 }]} />}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.userName}>{u.name}</Text>
                    <VerifiedBadge status={u.verification_status} variant="inline" size={13} />
                  </View>
                  <Text style={styles.userSub}>{u.spots_this_month} spot{u.spots_this_month === 1 ? '' : 's'} this month</Text>
                </View>
                <ChevronRight size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {data.top_cities?.length > 0 && (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Map size={16} color={colors.primary} />
            <Text style={styles.cardTitle}>Trending cities (30d)</Text>
          </View>
          <View style={{ gap: 8, marginTop: 4 }}>
            {data.top_cities.map((c: any, i: number) => (
              <View key={c.city} style={styles.cityRow}>
                <Text style={styles.cityRank}>#{i + 1}</Text>
                <Text style={styles.cityName}>{c.city}</Text>
                <Text style={styles.cityCount}>{c.count} spot{c.count === 1 ? '' : 's'}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.viewAll} onPress={() => router.push('/admin/analytics')} testID="overview-go-analytics">
        <TrendingUp size={16} color={colors.primary} />
        <Text style={styles.viewAllTxt}>See full analytics</Text>
        <ChevronRight size={16} color={colors.primary} />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  grid2: { flexDirection: 'row', gap: 10 },
  kpi: {
    flexBasis: '48%', flexGrow: 1,
    backgroundColor: colors.surface1, borderWidth: 1,
    padding: space.md, borderRadius: radii.md, gap: 2,
  },
  kpiLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' },
  kpiVal: { color: colors.text, fontFamily: font.display, fontSize: 30, letterSpacing: -0.5 },
  card: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    padding: space.lg, borderRadius: radii.lg, gap: 4,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  revenue: { color: colors.text, fontFamily: font.display, fontSize: 40, letterSpacing: -0.8 },
  revenueSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14 },
  tiny: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  planRowWrap: { gap: 6 },
  planRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  planLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
  planVal: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  queueCard: {
    flex: 1, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    padding: space.lg, borderRadius: radii.lg, gap: 4, position: 'relative',
  },
  queueVal: { color: colors.text, fontFamily: font.display, fontSize: 32, letterSpacing: -0.5, marginTop: 4 },
  queueLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  userName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  userSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  cityRank: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12, width: 24 },
  cityName: { flex: 1, color: colors.text, fontFamily: font.bodyMedium, fontSize: 13 },
  cityCount: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  viewAll: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: space.md, borderRadius: radii.md,
    backgroundColor: 'rgba(245,166,35,0.08)', borderColor: colors.primary, borderWidth: 1,
  },
  viewAllTxt: { flex: 1, color: colors.primary, fontFamily: font.bodySemibold, fontSize: 13 },
});
