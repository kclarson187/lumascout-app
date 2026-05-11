/**
 * Admin Overview — Jun 2025 simplified "command center" layout.
 *
 * Sections (top → bottom):
 *  1. Needs your attention — 4 compact tappable cards
 *     (Reports · Pending Spots · Edit Requests · Flagged Posts)
 *  2. System Overview — horizontal compact stats row
 *  3. Quick Actions — 4 icon tiles (System Health · Diagnostics · Activity Log · Settings)
 *  4. Revenue Snapshot — compact card
 *  5. Growth Highlights — Top cities + Top contributors merged
 *  6. Recent Activity — link to full audit log
 *
 * Compared to the legacy dashboard:
 *  • Removed oversized KPI cards (4x 30pt numbers stacked)
 *  • Removed redundant "Scout AI controls" hero — now under More
 *  • Removed standalone Diagnostics hero — now in Quick Actions
 *  • Added Flagged Posts + Edit Requests live counts at the top
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Image,
} from 'react-native';
import { router } from 'expo-router';
import {
  AlertTriangle, Map, Edit3, Flag, Users as UsersIcon, Activity, Settings,
  Wrench, FileText, TrendingUp, ChevronRight, Crown, Sparkles,
} from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import VerifiedBadge from '../../src/components/VerifiedBadge';
import UserBadge from '../../src/components/UserBadge';
import ScreenErrorBoundary from '../../src/components/ScreenErrorBoundary';

export default function AdminOverview() {
  return (
    <ScreenErrorBoundary label="Admin">
      <AdminOverviewImpl />
    </ScreenErrorBoundary>
  );
}

type Overview = {
  users: { total: number; new_today: number; active_7d: number; suspended: number;
           by_plan: { free: number; pro: number; elite: number } };
  moderation: { pending_spots: number; pending_reports: number; pending_photos: number };
  revenue: { monthly_estimate_usd: number; note: string };
  top_contributors?: any[];
  top_cities?: any[];
};

function AdminOverviewImpl() {
  const [data, setData] = useState<Overview | null>(null);
  const [flaggedCount, setFlaggedCount] = useState<number | null>(null);
  const [editReqCount, setEditReqCount] = useState<number | null>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [overview, flagged, edits, activity] = await Promise.all([
        api.get('/admin/overview'),
        api.get('/admin/posts', { status: 'flagged', limit: 1 }).catch(() => null),
        api.get('/admin/edit-requests', { status: 'pending', limit: 1 }).catch(() => null),
        api.get('/admin/audit-logs', { limit: 5 }).catch(() => null),
      ]);
      setData(overview);
      // Flagged posts endpoint returns { items, total? }; fall back to items length.
      if (flagged) {
        setFlaggedCount(
          typeof flagged.total === 'number' ? flagged.total : (flagged.items || []).length,
        );
      }
      if (edits) {
        setEditReqCount(
          typeof edits.total === 'number' ? edits.total : (edits.items || []).length,
        );
      }
      if (activity) {
        setRecentActivity((activity.items || []).slice(0, 4));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  }
  if (!data) return null;

  const attention: { key: string; label: string; count: number | null;
                     tint: string; icon: any; route: string; testID: string }[] = [
    { key: 'reports',  label: 'Reports',        count: data.moderation.pending_reports,
      tint: colors.secondary, icon: Flag,         route: '/admin/queue?filter=reports', testID: 'attn-reports' },
    { key: 'spots',    label: 'Pending Spots',  count: data.moderation.pending_spots,
      tint: colors.warning,   icon: Map,          route: '/admin/queue?filter=spots',   testID: 'attn-spots' },
    { key: 'edits',    label: 'Edit Requests',  count: editReqCount,
      tint: colors.info,      icon: Edit3,        route: '/admin/queue?filter=edits',   testID: 'attn-edits' },
    { key: 'flagged',  label: 'Flagged Posts',  count: flaggedCount,
      tint: colors.primary,   icon: AlertTriangle, route: '/admin/queue?filter=flagged', testID: 'attn-flagged' },
  ];

  const stats = [
    { k: 'total',     label: 'Total Users',  value: data.users.total,      color: colors.text },
    { k: 'active',    label: 'Active 7D',    value: data.users.active_7d,  color: colors.info },
    { k: 'suspended', label: 'Suspended',    value: data.users.suspended,  color: colors.secondary },
    { k: 'new',       label: 'New Today',    value: data.users.new_today,  color: colors.success },
  ];

  const quickActions = [
    { key: 'health',  label: 'System Health', icon: Activity, route: '/admin/analytics' },
    { key: 'diag',    label: 'Diagnostics',   icon: Wrench,   route: '/admin/diagnostics' },
    { key: 'audit',   label: 'Activity Log',  icon: FileText, route: '/admin/audit' },
    { key: 'set',     label: 'Settings',      icon: Settings, route: '/admin/settings' },
  ];

  const planRev = data.users.by_plan;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 100 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.primary}
        />
      }
    >
      {/* ───────── Needs your attention ───────── */}
      <View>
        <Text style={styles.sectionLabel}>Needs your attention</Text>
        <View style={styles.attnGrid}>
          {attention.map((a) => {
            const Icon = a.icon;
            const count = a.count;
            const hasItems = (count ?? 0) > 0;
            return (
              <TouchableOpacity
                key={a.key}
                style={[styles.attnCard, hasItems && { borderColor: a.tint }]}
                onPress={() => router.push(a.route as any)}
                testID={a.testID}
                activeOpacity={0.75}
              >
                <View style={[styles.attnIcon, { backgroundColor: a.tint + '1f' }]}>
                  <Icon size={14} color={a.tint} />
                </View>
                <Text style={styles.attnCount}>
                  {count === null ? '–' : count}
                </Text>
                <Text style={styles.attnLabel} numberOfLines={1}>{a.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ───────── System Overview ───────── */}
      <View>
        <Text style={styles.sectionLabel}>System Overview</Text>
        <View style={styles.statsRow}>
          {stats.map((s, i) => (
            <View
              key={s.k}
              style={[styles.statCell, i < stats.length - 1 && styles.statCellDivider]}
            >
              <Text style={[styles.statValue, { color: s.color }]}>
                {s.value.toLocaleString()}
              </Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ───────── Quick Actions ───────── */}
      <View>
        <Text style={styles.sectionLabel}>Quick Actions</Text>
        <View style={styles.qaRow}>
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <TouchableOpacity
                key={a.key}
                style={styles.qaTile}
                onPress={() => router.push(a.route as any)}
                testID={`qa-${a.key}`}
                activeOpacity={0.75}
              >
                <View style={styles.qaIconBox}>
                  <Icon size={16} color={colors.primary} />
                </View>
                <Text style={styles.qaLabel} numberOfLines={2}>{a.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ───────── Revenue Snapshot ───────── */}
      <View style={styles.revCard}>
        <View style={styles.revHead}>
          <Crown size={14} color={colors.primary} />
          <Text style={styles.revHeadTxt}>Revenue Snapshot</Text>
        </View>
        <View style={styles.revRow}>
          <Text style={styles.revAmount}>
            ${data.revenue.monthly_estimate_usd.toLocaleString()}
            <Text style={styles.revUnit}>/mo</Text>
          </Text>
          <View style={styles.revPlanRow}>
            <PlanTick label="Free"  val={planRev.free}  color={colors.textSecondary} />
            <PlanTick label="Pro"   val={planRev.pro}   color={colors.info} />
            <PlanTick label="Elite" val={planRev.elite} color={colors.primary} />
          </View>
        </View>
      </View>

      {/* ───────── Growth Highlights ───────── */}
      {(data.top_contributors?.length || data.top_cities?.length) ? (
        <View>
          <View style={styles.sectionLabelRow}>
            <Text style={styles.sectionLabel}>Growth Highlights</Text>
            <TouchableOpacity
              onPress={() => router.push('/admin/analytics')}
              testID="growth-see-all"
              hitSlop={8}
            >
              <Text style={styles.linkTxt}>Analytics ›</Text>
            </TouchableOpacity>
          </View>

          {!!data.top_contributors?.length && (
            <View style={styles.ghCard}>
              <View style={styles.ghHead}>
                <UsersIcon size={12} color={colors.textSecondary} />
                <Text style={styles.ghHeadTxt}>Top contributors · 30d</Text>
              </View>
              {data.top_contributors.slice(0, 3).map((u: any, idx: number) => (
                <TouchableOpacity
                  key={u.user_id}
                  style={[styles.userRow, idx > 0 && styles.userRowDiv]}
                  onPress={() => router.push(`/admin/user/${u.user_id}` as any)}
                  testID={`overview-user-${u.user_id}`}
                >
                  {u.avatar_url
                    ? <Image source={{ uri: u.avatar_url }} style={styles.avatar} />
                    : <View style={[styles.avatar, { backgroundColor: colors.surface2 }]} />}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={styles.userName} numberOfLines={1}>{u.name}</Text>
                      <VerifiedBadge status={u.verification_status} variant="inline" size={11} />
                      <UserBadge user={u} variant="inline" />
                    </View>
                    <Text style={styles.userSub}>
                      {u.spots_this_month} spot{u.spots_this_month === 1 ? '' : 's'} this month
                    </Text>
                  </View>
                  <ChevronRight size={14} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {!!data.top_cities?.length && (
            <View style={[styles.ghCard, { marginTop: 8 }]}>
              <View style={styles.ghHead}>
                <Map size={12} color={colors.textSecondary} />
                <Text style={styles.ghHeadTxt}>Trending cities · 30d</Text>
              </View>
              {data.top_cities.slice(0, 3).map((c: any, i: number) => (
                <View key={c.city} style={[styles.cityRow, i > 0 && styles.userRowDiv]}>
                  <Text style={styles.cityRank}>#{i + 1}</Text>
                  <Text style={styles.cityName} numberOfLines={1}>{c.city}</Text>
                  <Text style={styles.cityCount}>{c.count}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {/* ───────── Recent Activity ───────── */}
      <View>
        <View style={styles.sectionLabelRow}>
          <Text style={styles.sectionLabel}>Recent Activity</Text>
          <TouchableOpacity
            onPress={() => router.push('/admin/audit')}
            testID="recent-see-all"
            hitSlop={8}
          >
            <Text style={styles.linkTxt}>View log ›</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.activityCard}>
          {recentActivity.length === 0 ? (
            <View style={styles.activityEmpty}>
              <Sparkles size={14} color={colors.textTertiary} />
              <Text style={styles.activityEmptyTxt}>No recent admin actions.</Text>
            </View>
          ) : (
            recentActivity.map((a: any, idx: number) => (
              <View
                key={a.id || a.audit_id || idx}
                style={[styles.activityRow, idx > 0 && styles.userRowDiv]}
              >
                <View style={styles.activityDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityTitle} numberOfLines={1}>
                    {a.action || a.event || 'Action'}
                    {a.target_type ? ` · ${a.target_type}` : ''}
                  </Text>
                  <Text style={styles.activitySub} numberOfLines={1}>
                    {a.actor_name || a.actor || 'staff'} · {fmtAgo(a.created_at || a.timestamp)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function PlanTick({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <View style={styles.planTick}>
      <View style={[styles.planDot, { backgroundColor: color }]} />
      <Text style={styles.planTickLabel}>{label}</Text>
      <Text style={styles.planTickVal}>{val}</Text>
    </View>
  );
}

function fmtAgo(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return 'just now';
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11,
    letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8,
  },
  sectionLabelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  linkTxt: {
    color: colors.primary, fontFamily: font.bodySemibold, fontSize: 11,
    letterSpacing: 0.3, textTransform: 'uppercase',
  },

  // Attention grid (2x2)
  attnGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  attnCard: {
    flexBasis: '48%', flexGrow: 1,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: space.md, paddingVertical: 10, gap: 2,
  },
  attnIcon: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  attnCount: {
    color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.4,
  },
  attnLabel: {
    color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11,
  },

  // System overview horizontal stats
  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 10,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statCellDivider: {
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border,
  },
  statValue: { fontFamily: font.display, fontSize: 18, letterSpacing: -0.3 },
  statLabel: {
    color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 10,
    letterSpacing: 0.4, textTransform: 'uppercase',
  },

  // Quick actions
  qaRow: { flexDirection: 'row', gap: 6 },
  qaTile: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 10, paddingHorizontal: 8,
    alignItems: 'center', gap: 6,
  },
  qaIconBox: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  qaLabel: {
    color: colors.text, fontFamily: font.bodySemibold, fontSize: 10,
    textAlign: 'center',
  },

  // Revenue
  revCard: {
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(245,166,35,0.25)',
    borderRadius: radii.md,
    paddingHorizontal: space.lg, paddingVertical: 12,
  },
  revHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  revHeadTxt: {
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  revRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', gap: 8,
  },
  revAmount: {
    color: colors.text, fontFamily: font.display, fontSize: 26, letterSpacing: -0.5,
  },
  revUnit: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  revPlanRow: { flexDirection: 'row', gap: 10 },
  planTick: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  planDot: { width: 6, height: 6, borderRadius: 3 },
  planTickLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  planTickVal: { color: colors.text, fontFamily: font.bodyBold, fontSize: 11 },

  // Growth highlights
  ghCard: {
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderRadius: radii.md, paddingHorizontal: space.md, paddingVertical: 8,
  },
  ghHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  ghHeadTxt: {
    color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11,
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  userRowDiv: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  userName: { flex: 1, color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  userSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 1 },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  cityRank: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, width: 24 },
  cityName: { flex: 1, color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  cityCount: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11 },

  // Activity
  activityCard: {
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderRadius: radii.md, paddingHorizontal: space.md,
  },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  activityDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary,
  },
  activityTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },
  activitySub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 1 },
  activityEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14 },
  activityEmptyTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12 },
});
