import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import SafeImage from '../../src/components/SafeImage';
import { router } from 'expo-router';
import { Check, X, AlertTriangle, ShieldCheck, Clock } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

// Humanized relative timestamp so admins can see at a glance how stale a report is.
function timeAgo(iso?: string): string {
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

export default function AdminReports() {
  const [reports, setReports] = useState<any[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'resolved'>('pending');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/reports', { status: filter });
      setReports(r);
      // Keep the counts chip in sync using whichever bucket is visible; quickly
      // fetch the other count so the tab badges stay accurate.
      if (filter === 'pending') {
        setPendingCount(r.length);
        try {
          const other = await api.get('/admin/reports', { status: 'resolved' });
          setResolvedCount(other.length);
        } catch { /* non-fatal */ }
      } else {
        setResolvedCount(r.length);
        try {
          const other = await api.get('/admin/reports', { status: 'pending' });
          setPendingCount(other.length);
        } catch { /* non-fatal */ }
      }
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (id: string, action: 'dismissed' | 'removed' | 'warned') => {
    try {
      await api.post(`/admin/reports/${id}/resolve`, { action });
      load();
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    }
  };

  const counts = useMemo(() => ({ pending: pendingCount, resolved: resolvedCount }), [pendingCount, resolvedCount]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.filterRow}>
        {(['pending', 'resolved'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            testID={`admin-reports-filter-${f}`}
          >
            <Text style={[styles.filterTxt, filter === f && styles.filterTxtActive]}>{f}</Text>
            <View style={[styles.countBadge, filter === f && styles.countBadgeActive]}>
              <Text style={[styles.countBadgeTxt, filter === f && styles.countBadgeTxtActive]}>{counts[f]}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : reports.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={[styles.emptyIcon, { backgroundColor: filter === 'pending' ? 'rgba(46,204,113,0.15)' : 'rgba(245,166,35,0.12)' }]}>
            <ShieldCheck size={40} color={filter === 'pending' ? colors.success : colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>
            {filter === 'pending' ? 'All clear' : 'No past decisions yet'}
          </Text>
          <Text style={styles.emptyBody}>
            {filter === 'pending'
              ? `You're caught up — ${counts.resolved} ${counts.resolved === 1 ? 'report has' : 'reports have'} been resolved so far. Great work.`
              : 'Once you dismiss, warn, or remove content from a report, the decision log shows up here.'}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 100 }}>
          {reports.map((r) => (
            <View key={r.report_id} style={styles.card}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <View style={styles.warningIcon}>
                  <AlertTriangle size={18} color={colors.warning} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reason}>{r.reason}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                    <Text style={styles.meta}>
                      {r.target_type} · by {r.reporter?.name || 'user'}
                    </Text>
                    {!!r.created_at && (
                      <View style={styles.timeChip}>
                        <Clock size={9} color={colors.textTertiary} />
                        <Text style={styles.timeTxt}>{timeAgo(r.created_at)}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
              {r.details ? <Text style={styles.details}>{r.details}</Text> : null}
              {r.target && r.target_type === 'spot' && (
                <TouchableOpacity
                  style={styles.targetCard}
                  onPress={() => router.push(`/spot/${r.target.spot_id}`)}
                  testID={`report-target-${r.target.spot_id}`}
                >
                  {r.target.images?.[0]?.image_url && (
                    <SafeImage source={{ uri: r.target.images[0].image_url }} style={styles.targetImg} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.targetTitle}>{r.target.title}</Text>
                    <Text style={styles.targetCity}>{r.target.city}, {r.target.state}</Text>
                  </View>
                </TouchableOpacity>
              )}
              {r.status === 'resolved' ? (
                <View style={styles.resolvedRow}>
                  <Check size={14} color={colors.success} />
                  <Text style={styles.resolvedTxt}>Resolved · {r.resolution}</Text>
                </View>
              ) : (
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.actBtn, { backgroundColor: colors.surface2 }]} onPress={() => resolve(r.report_id, 'dismissed')} testID={`report-dismiss-${r.report_id}`}>
                    <Text style={styles.actTxt}>Dismiss</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actBtn, { backgroundColor: colors.warning }]} onPress={() => resolve(r.report_id, 'warned')} testID={`report-warn-${r.report_id}`}>
                    <Text style={[styles.actTxt, { color: colors.textInverse }]}>Warn</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actBtn, { backgroundColor: colors.secondary }]} onPress={() => resolve(r.report_id, 'removed')} testID={`report-remove-${r.report_id}`}>
                    <X size={14} color="#fff" />
                    <Text style={[styles.actTxt, { color: '#fff' }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: space.xl, paddingVertical: space.sm },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12, textTransform: 'capitalize' },
  filterTxtActive: { color: colors.textInverse, fontFamily: font.bodySemibold },
  countBadge: { minWidth: 20, paddingHorizontal: 6, height: 18, borderRadius: 9, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  countBadgeActive: { backgroundColor: 'rgba(0,0,0,0.22)' },
  countBadgeTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 10 },
  countBadgeTxtActive: { color: colors.textInverse },
  card: {
    padding: space.lg, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, gap: space.md,
  },
  warningIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(251,191,36,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  reason: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14, textTransform: 'capitalize' },
  meta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.surface2 },
  timeTxt: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 10 },
  details: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 16 },
  targetCard: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    padding: space.md, backgroundColor: colors.surface2,
    borderRadius: radii.md,
  },
  targetImg: { width: 48, height: 48, borderRadius: radii.sm },
  targetTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  targetCity: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  actBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: radii.md,
  },
  actTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },
  resolvedRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  resolvedTxt: { color: colors.success, fontFamily: font.bodyMedium, fontSize: 12 },
  emptyWrap: { alignItems: 'center', paddingHorizontal: space.xl, marginTop: 48, gap: 10 },
  emptyIcon: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3, marginTop: 4 },
  emptyBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
});
