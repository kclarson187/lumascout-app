import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { Check, X, ShieldCheck, Clock, Crop } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return 'just submitted';
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function AdminSpots() {
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [recentlyReviewed, setRecentlyReviewed] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, recent] = await Promise.all([
        api.get('/admin/pending'),
        // Best-effort count of recently-reviewed approvals for celebratory empty state.
        api.get('/admin/stats/recent-approvals', { days: 7 }).catch(() => null),
      ]);
      setPending(p);
      if (recent && typeof recent.count === 'number') setRecentlyReviewed(recent.count);
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    try {
      await api.post(`/admin/spots/${id}/${approve ? 'approve' : 'reject'}`);
      await load();
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
  };

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  }
  if (pending.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={{ flex: 1, justifyContent: 'center' }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
      >
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <ShieldCheck size={40} color={colors.success} />
          </View>
          <Text style={styles.emptyTitle}>Queue cleared</Text>
          <Text style={styles.emptyBody}>
            No pending spot submissions. All contributions have been reviewed — new ones will show up here as photographers submit them.
          </Text>
          {typeof recentlyReviewed === 'number' && recentlyReviewed > 0 && (
            <View style={styles.statsChip}>
              <Text style={styles.statsTxt}>{recentlyReviewed} approved in the last 7 days</Text>
            </View>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 80 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
    >
      <Text style={styles.totals}>{pending.length} pending submission{pending.length === 1 ? '' : 's'}</Text>
      {pending.map((s) => (
        <View key={s.spot_id} style={styles.card}>
          <SpotCard spot={s} width={undefined as any} />
          {/* Submission freshness chip so admins can prioritise fresh-first. */}
          {!!s.created_at && (
            <View style={styles.timeRow}>
              <Clock size={11} color={colors.textTertiary} />
              <Text style={styles.timeTxt}>Submitted {timeAgo(s.created_at)}</Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <TouchableOpacity style={[styles.actBtn, { backgroundColor: colors.success }]} onPress={() => decide(s.spot_id, true)} testID={`admin-approve-${s.spot_id}`}>
              <Check size={16} color={colors.textInverse} />
              <Text style={styles.actTxt}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actBtn, { backgroundColor: colors.secondary }]} onPress={() => decide(s.spot_id, false)} testID={`admin-reject-${s.spot_id}`}>
              <X size={16} color="#fff" />
              <Text style={[styles.actTxt, { color: '#fff' }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actBtn, { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.primary }]}
              onPress={() => router.push(`/admin/spots/${s.spot_id}/cover` as any)}
              testID={`admin-cover-${s.spot_id}`}
            >
              <Crop size={16} color={colors.primary} />
              <Text style={[styles.actTxt, { color: colors.primary }]}>Edit cover</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  totals: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.3 },
  card: { gap: space.md },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  timeTxt: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11 },
  actBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: radii.md },
  actTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 14 },
  emptyWrap: { alignItems: 'center', paddingHorizontal: space.xl, gap: 10 },
  emptyIcon: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(46,204,113,0.15)' },
  emptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 24, letterSpacing: -0.3, marginTop: 4 },
  emptyBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  statsChip: { marginTop: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: 'rgba(46,204,113,0.12)', borderWidth: 1, borderColor: colors.success },
  statsTxt: { color: colors.success, fontFamily: font.bodySemibold, fontSize: 12 },
});
