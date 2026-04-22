/**
 * Networking Analytics — Phase B.3 Elite dashboard.
 * Path: /analytics
 * Free tier → preview with blurred numbers + upgrade CTA
 * Pro  tier → headline stats (no trend/funnel)
 * Elite tier → full stats + 7-day trend + funnel
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import { ArrowLeft, BarChart3, TrendingUp, Crown, Users, Eye, Briefcase, MessageCircle, Lock } from 'lucide-react-native';
import { api } from '../src/api';
import { colors, font, space, radii } from '../src/theme';

type Analytics = {
  plan: 'free' | 'pro' | 'elite';
  period_days: number;
  profile_views_7d: number;
  profile_views_30d: number;
  follows_gained: number;
  applications_sent: number;
  applications_accepted: number;
  acceptance_rate_pct: number;
  needs_posted: number;
  applicants_received: number;
  active_threads: number;
  trend_7d?: Array<{ date: string; views: number }>;
  funnel?: { views_to_follow_pct: number; applications_to_acceptance_pct: number };
};

export default function AnalyticsScreen() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/me/analytics/networking', { since_days: 30 });
      setData(r);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isFree = data?.plan === 'free';
  const isElite = data?.plan === 'elite';
  const maxTrend = Math.max(1, ...(data?.trend_7d || []).map((t) => t.views));

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={10} testID="analytics-back">
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Analytics</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading || !data ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl, gap: space.lg }}>
          {/* Plan pill */}
          <View style={styles.planRow}>
            <BarChart3 size={16} color={colors.primary} />
            <Text style={styles.planLabel}>
              {data.plan === 'elite' ? 'Elite Analytics · Full dashboard'
                : data.plan === 'pro' ? 'Pro Analytics · Last 30 days'
                : 'Analytics Preview · Upgrade to unlock'}
            </Text>
          </View>

          {/* Stat grid */}
          <View style={styles.grid}>
            <StatCard icon={<Eye size={14} color={colors.primary} />} label="Profile views (7d)" value={data.profile_views_7d} blurred={isFree} />
            <StatCard icon={<Eye size={14} color={colors.primary} />} label="Profile views (30d)" value={data.profile_views_30d} blurred={isFree} />
            <StatCard icon={<Users size={14} color={colors.primary} />} label="New followers" value={data.follows_gained} blurred={isFree} />
            <StatCard icon={<MessageCircle size={14} color={colors.primary} />} label="Active threads" value={data.active_threads} blurred={isFree} />
            <StatCard icon={<Briefcase size={14} color={colors.primary} />} label="Needs posted" value={data.needs_posted} blurred={isFree} />
            <StatCard icon={<Briefcase size={14} color={colors.primary} />} label="Applicants received" value={data.applicants_received} blurred={isFree} />
            <StatCard icon={<Briefcase size={14} color={colors.primary} />} label="Apps sent" value={data.applications_sent} blurred={isFree} />
            <StatCard icon={<Briefcase size={14} color={colors.primary} />} label="Apps accepted" value={data.applications_accepted} blurred={isFree} />
          </View>

          {/* Acceptance rate card */}
          <View style={styles.rateCard}>
            <Text style={styles.rateTitle}>Referral Acceptance Rate</Text>
            <Text style={[styles.rateNumber, isFree && styles.blurred]}>
              {isFree ? '••' : `${data.acceptance_rate_pct}%`}
            </Text>
            <Text style={styles.rateHint}>
              {data.applications_sent === 0 && !isFree
                ? 'Apply to a referral to start tracking conversion.'
                : 'Acceptance rate across all referral applications sent this month.'}
            </Text>
          </View>

          {/* Elite-only sections */}
          {isElite && data.trend_7d ? (
            <View style={styles.trendCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <TrendingUp size={14} color={colors.primary} />
                <Text style={styles.trendTitle}>7-day view trend</Text>
              </View>
              <View style={styles.trendRow}>
                {data.trend_7d.map((d, i) => {
                  const h = Math.max(4, (d.views / maxTrend) * 44);
                  const label = new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1);
                  return (
                    <View key={i} style={styles.trendBarCol}>
                      <View style={[styles.trendBar, { height: h }]} />
                      <Text style={styles.trendBarLabel}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {isElite && data.funnel ? (
            <View style={styles.funnelCard}>
              <Text style={styles.funnelTitle}>Conversion funnel</Text>
              <FunnelRow label="Views → Follows" pct={data.funnel.views_to_follow_pct} />
              <FunnelRow label="Applications → Acceptance" pct={data.funnel.applications_to_acceptance_pct} />
            </View>
          ) : null}

          {/* Upgrade CTA for free/pro */}
          {!isElite ? (
            <TouchableOpacity style={styles.upgradeCard} onPress={() => router.push('/paywall?reason=analytics' as any)} testID="analytics-upgrade">
              <View style={styles.upgradeHead}>
                <Crown size={14} color={colors.primary} />
                <Text style={styles.upgradeTitle}>
                  {isFree ? 'Unlock your analytics' : 'Go Elite for deeper insights'}
                </Text>
              </View>
              <Text style={styles.upgradeBody}>
                {isFree
                  ? 'Go Pro to see your actual numbers. Go Elite for trend charts, conversion funnels, and featured placement.'
                  : 'Elite unlocks 7-day trend charts, conversion funnels, and featured discovery placement.'}
              </Text>
              <View style={styles.upgradeBtn}>
                <Text style={styles.upgradeBtnTxt}>{isFree ? 'Upgrade' : 'Go Elite'}</Text>
              </View>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatCard({ icon, label, value, blurred }: { icon: React.ReactNode; label: string; value: number; blurred: boolean }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHead}>
        {icon}
        {blurred ? <Lock size={10} color={colors.textTertiary} /> : null}
      </View>
      <Text style={[styles.statValue, blurred && styles.blurred]}>{blurred ? '••' : value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function FunnelRow({ label, pct }: { label: string; pct: number }) {
  return (
    <View style={styles.funnelRow}>
      <Text style={styles.funnelLabel}>{label}</Text>
      <View style={styles.funnelBar}>
        <View style={[styles.funnelFill, { width: `${Math.min(100, pct)}%` }]} />
      </View>
      <Text style={styles.funnelPct}>{pct}%</Text>
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

  planRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderRadius: radii.sm, alignSelf: 'flex-start',
  },
  planLabel: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.4 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  statCard: {
    width: '48%', flexGrow: 1,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, padding: space.md, gap: 4,
  },
  statHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statValue: { color: colors.text, fontFamily: font.display, fontSize: 26, letterSpacing: -0.5 },
  statLabel: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  blurred: { color: colors.textTertiary },

  rateCard: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(245,166,35,0.28)',
    borderRadius: radii.lg, padding: space.lg, alignItems: 'center', gap: 4,
  },
  rateTitle: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  rateNumber: { color: colors.primary, fontFamily: font.display, fontSize: 42, letterSpacing: -1 },
  rateHint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12, textAlign: 'center', marginTop: 4 },

  trendCard: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: space.md,
  },
  trendTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  trendRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 70, paddingHorizontal: 4 },
  trendBarCol: { alignItems: 'center', flex: 1, gap: 4 },
  trendBar: { width: 10, backgroundColor: colors.primary, borderRadius: 3, minHeight: 3 },
  trendBarLabel: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 10 },

  funnelCard: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: space.md, gap: 10,
  },
  funnelTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  funnelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  funnelLabel: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, width: 120 },
  funnelBar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surface2, overflow: 'hidden' },
  funnelFill: { height: '100%', backgroundColor: colors.primary },
  funnelPct: { color: colors.text, fontFamily: font.bodyBold, fontSize: 12, width: 48, textAlign: 'right' },

  upgradeCard: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
    borderRadius: radii.lg, padding: space.lg, gap: 8,
  },
  upgradeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  upgradeTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  upgradeBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  upgradeBtn: {
    alignSelf: 'flex-start', marginTop: 6,
    paddingVertical: 10, paddingHorizontal: 20,
    backgroundColor: colors.primary, borderRadius: radii.md,
  },
  upgradeBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13, letterSpacing: 0.3 },
});
