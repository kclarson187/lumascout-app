/**
 * Admin Queue — unified moderation feed (Jun 2025 overhaul).
 *
 * Combines four review streams into one fast, compact workflow:
 *   • Reports        (/admin/reports?status=pending)
 *   • Flagged Posts  (/admin/posts?status=flagged)
 *   • Edit Requests  (/admin/edit-requests?status=pending)
 *   • Pending Spots  (/admin/pending)
 *
 * Chips at top switch the visible stream; counts stay live. Per-row
 * actions match each type:
 *   • Reports        → Dismiss · Warn · Remove
 *   • Flagged Posts  → View    · Remove
 *   • Edit Requests  → Review  (opens diff page)
 *   • Pending Spots  → Approve · Reject · Review
 *
 * Client-side merge only — no new backend endpoints introduced.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Flag, Map, Edit3, AlertTriangle, Check, X, ChevronRight, ShieldCheck, Pencil,
} from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

type QueueKey = 'reports' | 'flagged' | 'edits' | 'spots';

const FILTERS: { key: QueueKey; label: string }[] = [
  { key: 'reports', label: 'Reports' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'edits',   label: 'Edits' },
  { key: 'spots',   label: 'Pending' },
];

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
  return `${d}d ago`;
}

export default function AdminQueue() {
  const params = useLocalSearchParams<{ filter?: string }>();
  const initialFilter = (FILTERS.find((f) => f.key === params.filter)?.key) || 'reports';

  const [filter, setFilter] = useState<QueueKey>(initialFilter);
  const [counts, setCounts] = useState<Record<QueueKey, number | null>>({
    reports: null, flagged: null, edits: null, spots: null,
  });
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Whenever the route param changes (e.g. user taps an Overview card while
  // already on /admin/queue), follow it.
  useEffect(() => {
    if (params.filter && FILTERS.some((f) => f.key === params.filter)) {
      setFilter(params.filter as QueueKey);
    }
  }, [params.filter]);

  const refreshCounts = useCallback(async () => {
    const safe = async <T,>(p: Promise<T>): Promise<T | null> => {
      try { return await p; } catch { return null; }
    };
    const [reports, flagged, edits, overview] = await Promise.all([
      safe(api.get('/admin/reports', { status: 'pending' })),
      safe(api.get('/admin/posts',   { status: 'flagged', limit: 1 })),
      safe(api.get('/admin/edit-requests', { status: 'pending', limit: 1 })),
      safe(api.get('/admin/overview')),
    ]);
    setCounts({
      reports: Array.isArray(reports) ? reports.length : 0,
      flagged: flagged
        ? (typeof flagged.total === 'number' ? flagged.total : (flagged.items || []).length)
        : 0,
      edits: edits
        ? (typeof edits.total === 'number' ? edits.total : (edits.items || []).length)
        : 0,
      spots: overview?.moderation?.pending_spots ?? 0,
    });
  }, []);

  const loadList = useCallback(async (k: QueueKey) => {
    setLoading(true);
    try {
      if (k === 'reports') {
        const r = await api.get('/admin/reports', { status: 'pending' });
        setItems(Array.isArray(r) ? r : []);
      } else if (k === 'flagged') {
        const r = await api.get('/admin/posts', { status: 'flagged', limit: 100 });
        setItems(r?.items || []);
      } else if (k === 'edits') {
        const r = await api.get('/admin/edit-requests', { status: 'pending', limit: 100 });
        setItems(r?.items || []);
      } else {
        const r = await api.get('/admin/pending');
        setItems(Array.isArray(r) ? r.filter(Boolean) : []);
      }
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadList(filter);
    refreshCounts();
  }, [filter, loadList, refreshCounts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadList(filter);
    refreshCounts();
  }, [filter, loadList, refreshCounts]);

  // ───── Action handlers ─────────────────────────────────────────────
  const resolveReport = async (id: string, action: 'dismissed' | 'warned' | 'removed') => {
    try {
      await api.post(`/admin/reports/${id}/resolve`, { action });
      setItems((prev) => prev.filter((r) => r.report_id !== id));
      refreshCounts();
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
  };

  const removePost = (p: any) => {
    Alert.alert(
      'Remove this post?',
      `"${(p.title || '').slice(0, 60)}${(p.title || '').length > 60 ? '…' : ''}"`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/admin/posts/${p.post_id}?reason=moderator%20removal`);
              setItems((prev) => prev.filter((x) => x.post_id !== p.post_id));
              refreshCounts();
            } catch (e) { Alert.alert('Error', formatApiError(e)); }
          },
        },
      ],
    );
  };

  const decideSpot = async (id: string, approve: boolean) => {
    const snapshot = items;
    setItems((prev) => prev.filter((s) => s.spot_id !== id));
    try {
      await api.post(`/admin/spots/${id}/${approve ? 'approve' : 'reject'}`);
      refreshCounts();
    } catch (e) {
      setItems(snapshot);
      Alert.alert('Error', formatApiError(e));
    }
  };

  // ───── Render helpers ──────────────────────────────────────────────
  const isEmpty = items.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Compact filter chip strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipStrip}
        style={{ flexGrow: 0, maxHeight: 48 }}
      >
        {FILTERS.map((f) => {
          const on = filter === f.key;
          const n = counts[f.key];
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, on && styles.chipActive]}
              onPress={() => setFilter(f.key)}
              testID={`queue-chip-${f.key}`}
            >
              <Text style={[styles.chipTxt, on && styles.chipTxtActive]}>{f.label}</Text>
              {n != null ? (
                <View style={[styles.chipBadge, on && styles.chipBadgeActive]}>
                  <Text style={[styles.chipBadgeTxt, on && styles.chipBadgeTxtActive]}>{n}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.divider} />

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.lg, paddingBottom: 100, gap: 8 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          {isEmpty ? (
            <EmptyState which={filter} />
          ) : filter === 'reports' ? (
            items.map((r) => (
              <ReportRow key={r.report_id} r={r} onResolve={resolveReport} />
            ))
          ) : filter === 'flagged' ? (
            items.map((p) => (
              <FlaggedRow key={p.post_id} p={p} onRemove={removePost} />
            ))
          ) : filter === 'edits' ? (
            items.map((r) => (
              <EditRow key={r.request_id} r={r} />
            ))
          ) : (
            items.map((s) => (
              <PendingSpotRow key={s.spot_id} s={s} onDecide={decideSpot} />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ───── Empty state ────────────────────────────────────────────────────
function EmptyState({ which }: { which: QueueKey }) {
  const labels: Record<QueueKey, { title: string; body: string }> = {
    reports: { title: 'No reports to review', body: 'Reports filed by users land here. You\'re all caught up.' },
    flagged: { title: 'No flagged posts',     body: 'Community posts flagged by users will show up here.' },
    edits:   { title: 'No edit requests',     body: 'Uploader-proposed spot changes appear here for review.' },
    spots:   { title: 'No pending spots',     body: 'New spot submissions waiting for approval show up here.' },
  };
  const l = labels[which];
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIcon}>
        <ShieldCheck size={28} color={colors.success} />
      </View>
      <Text style={styles.emptyTitle}>{l.title}</Text>
      <Text style={styles.emptyBody}>{l.body}</Text>
    </View>
  );
}

// ───── Report row ─────────────────────────────────────────────────────
function ReportRow({ r, onResolve }: { r: any; onResolve: (id: string, a: any) => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <View style={[styles.typeChip, { borderColor: colors.secondary, backgroundColor: 'rgba(208,72,72,0.12)' }]}>
          <Flag size={10} color={colors.secondary} />
          <Text style={[styles.typeChipTxt, { color: colors.secondary }]}>REPORT</Text>
        </View>
        <Text style={styles.metaSm}>{fmtAgo(r.created_at)}</Text>
      </View>
      <Text style={styles.rowTitle} numberOfLines={2}>{r.reason}</Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {r.target_type} · by {r.reporter?.name || 'user'}
      </Text>
      {r.details ? <Text style={styles.rowDetail} numberOfLines={2}>{r.details}</Text> : null}
      {r.target && r.target_type === 'spot' && (
        <TouchableOpacity
          style={styles.targetMini}
          onPress={() => router.push(`/spot/${r.target.spot_id}`)}
        >
          {r.target.images?.[0]?.image_url
            ? <Image source={{ uri: r.target.images[0].image_url }} style={styles.targetThumb} />
            : <View style={[styles.targetThumb, { backgroundColor: colors.surface2 }]} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.targetTitle} numberOfLines={1}>{r.target.title}</Text>
            <Text style={styles.targetSub} numberOfLines={1}>{r.target.city}{r.target.state ? `, ${r.target.state}` : ''}</Text>
          </View>
          <ChevronRight size={14} color={colors.textTertiary} />
        </TouchableOpacity>
      )}
      <View style={styles.actRow}>
        <TouchableOpacity
          style={[styles.actBtn, styles.actGhost]}
          onPress={() => onResolve(r.report_id, 'dismissed')}
          testID={`report-dismiss-${r.report_id}`}
        >
          <Text style={[styles.actTxt, { color: colors.text }]}>Dismiss</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actBtn, { backgroundColor: 'rgba(251,191,36,0.18)', borderColor: colors.warning, borderWidth: StyleSheet.hairlineWidth }]}
          onPress={() => onResolve(r.report_id, 'warned')}
          testID={`report-warn-${r.report_id}`}
        >
          <Text style={[styles.actTxt, { color: colors.warning }]}>Warn</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actBtn, { backgroundColor: colors.secondary }]}
          onPress={() => onResolve(r.report_id, 'removed')}
          testID={`report-remove-${r.report_id}`}
        >
          <X size={12} color="#fff" />
          <Text style={[styles.actTxt, { color: '#fff' }]}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ───── Flagged post row ───────────────────────────────────────────────
function FlaggedRow({ p, onRemove }: { p: any; onRemove: (p: any) => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <View style={[styles.typeChip, { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.12)' }]}>
          <AlertTriangle size={10} color={colors.primary} />
          <Text style={[styles.typeChipTxt, { color: colors.primary }]}>FLAGGED</Text>
        </View>
        <Text style={styles.metaSm}>{fmtAgo(p.created_at)}</Text>
      </View>
      <Text style={styles.rowTitle} numberOfLines={2}>{p.title || '(no title)'}</Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        by {p.author?.name || 'Unknown'} · {(p.open_reports || 0)} report{p.open_reports === 1 ? '' : 's'}
      </Text>
      {!!p.body && <Text style={styles.rowDetail} numberOfLines={2}>{p.body}</Text>}
      <View style={styles.actRow}>
        <TouchableOpacity
          style={[styles.actBtn, styles.actGhost]}
          onPress={() => router.push(`/community/post/${p.post_id}`)}
          testID={`flagged-view-${p.post_id}`}
        >
          <Text style={[styles.actTxt, { color: colors.text }]}>View</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actBtn, { backgroundColor: colors.secondary }]}
          onPress={() => onRemove(p)}
          testID={`flagged-remove-${p.post_id}`}
        >
          <X size={12} color="#fff" />
          <Text style={[styles.actTxt, { color: '#fff' }]}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ───── Edit request row ───────────────────────────────────────────────
function EditRow({ r }: { r: any }) {
  const fieldsChanged = Object.keys(r.changes || {}).length;
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push('/admin/edit-requests' as any)}
      testID={`edit-row-${r.request_id}`}
      activeOpacity={0.75}
    >
      <View style={styles.cardTopRow}>
        <View style={[styles.typeChip, { borderColor: colors.info, backgroundColor: 'rgba(96,165,250,0.12)' }]}>
          <Edit3 size={10} color={colors.info} />
          <Text style={[styles.typeChipTxt, { color: colors.info }]}>EDIT</Text>
        </View>
        <Text style={styles.metaSm}>{fmtAgo(r.created_at)}</Text>
      </View>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {r.spot?.title || 'Spot edit'}
      </Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        by {r.owner?.name || 'uploader'} · {fieldsChanged} field{fieldsChanged === 1 ? '' : 's'} changed
      </Text>
      <View style={styles.actRow}>
        <View style={[styles.actBtn, styles.actPrimary]}>
          <Text style={[styles.actTxt, { color: colors.textInverse }]}>Review changes</Text>
          <ChevronRight size={12} color={colors.textInverse} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ───── Pending spot row ───────────────────────────────────────────────
function PendingSpotRow({ s, onDecide }: { s: any; onDecide: (id: string, approve: boolean) => void }) {
  const cover = s.hero_cover_image_url
    || (s.images && (s.images.find((i: any) => i.is_cover) || s.images[0]))?.image_url;
  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <View style={[styles.typeChip, { borderColor: colors.warning, backgroundColor: 'rgba(251,191,36,0.12)' }]}>
          <Map size={10} color={colors.warning} />
          <Text style={[styles.typeChipTxt, { color: colors.warning }]}>SPOT</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            style={styles.editPill}
            onPress={() => router.push(`/admin/spots/${s.spot_id}/edit` as any)}
            testID={`spot-edit-${s.spot_id}`}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Pencil size={10} color={colors.primary} />
            <Text style={styles.editPillTxt}>Edit details</Text>
          </TouchableOpacity>
          <Text style={styles.metaSm}>{fmtAgo(s.created_at)}</Text>
        </View>
      </View>
      <View style={styles.spotPreview}>
        {cover
          ? <Image source={{ uri: cover }} style={styles.spotImg} />
          : <View style={[styles.spotImg, { backgroundColor: colors.surface2 }]} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{s.title}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {s.city || ''}{s.state ? `, ${s.state}` : ''}
            {s.country_code ? ` · ${s.country_code}` : ''}
          </Text>
          <Text style={styles.rowSubSm}>
            {(s.images || []).length} photo{(s.images || []).length === 1 ? '' : 's'} · Q{s.quality_score ?? '—'}
          </Text>
        </View>
      </View>
      <View style={styles.actRow}>
        <TouchableOpacity
          style={[styles.actBtn, styles.actGhost]}
          onPress={() => router.push(`/admin/spots/${s.spot_id}/cover` as any)}
          testID={`spot-review-${s.spot_id}`}
        >
          <Text style={[styles.actTxt, { color: colors.text }]}>Review</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actBtn, { backgroundColor: colors.secondary }]}
          onPress={() => onDecide(s.spot_id, false)}
          testID={`spot-reject-${s.spot_id}`}
        >
          <X size={12} color="#fff" />
          <Text style={[styles.actTxt, { color: '#fff' }]}>Reject</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actBtn, { backgroundColor: colors.success }]}
          onPress={() => onDecide(s.spot_id, true)}
          testID={`spot-approve-${s.spot_id}`}
        >
          <Check size={12} color="#fff" />
          <Text style={[styles.actTxt, { color: '#fff' }]}>Approve</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chipStrip: {
    paddingHorizontal: space.lg, paddingVertical: 10, gap: 6, alignItems: 'center',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.4 },
  chipTxtActive: { color: colors.textInverse },
  chipBadge: {
    minWidth: 18, paddingHorizontal: 5, height: 16, borderRadius: 8,
    backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center',
  },
  chipBadgeActive: { backgroundColor: 'rgba(0,0,0,0.22)' },
  chipBadgeTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 9 },
  chipBadgeTxtActive: { color: colors.textInverse },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

  card: {
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderRadius: radii.md, padding: space.md, gap: 6,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeChipTxt: { fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.5 },
  editPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.primary,
  },
  editPillTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.3 },
  metaSm: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 10 },
  rowTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14, marginTop: 2 },
  rowMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  rowDetail: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12, lineHeight: 16, marginTop: 2 },
  rowSubSm: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, marginTop: 1 },

  spotPreview: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 4 },
  spotImg: { width: 48, height: 48, borderRadius: radii.sm },

  targetMini: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    padding: 8, backgroundColor: colors.surface2, borderRadius: radii.sm, marginTop: 4,
  },
  targetThumb: { width: 36, height: 36, borderRadius: radii.sm },
  targetTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },
  targetSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 10, marginTop: 1 },

  actRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  actBtn: {
    flex: 1, flexDirection: 'row', gap: 4,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: radii.sm,
  },
  actGhost: {
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  actPrimary: { backgroundColor: colors.primary },
  actTxt: { fontFamily: font.bodyBold, fontSize: 12 },

  emptyWrap: { alignItems: 'center', gap: 10, paddingVertical: 60, paddingHorizontal: space.xl },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(16,185,129,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 18 },
  emptyBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, textAlign: 'center', maxWidth: 280 },
});
