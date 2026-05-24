/**
 * Admin — Spots tab.
 *
 * Two tabs:
 *   1. PENDING — incoming submissions awaiting approval (was the original screen)
 *   2. ALL SPOTS — searchable list of every approved spot so admins can open
 *      the Cover Editor for any existing location (fixes "can't edit covers
 *      of already-live spots" bug).
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, RefreshControl, TextInput, Image,
} from 'react-native';
import { router } from 'expo-router';
import { Check, X, ShieldCheck, Crop, Search, Star, EyeOff, ImagePlus, Pencil } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

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
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [pending, setPending] = useState<any[]>([]);
  const [allSpots, setAllSpots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [recentlyReviewed, setRecentlyReviewed] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadPending = useCallback(async () => {
    try {
      const [p, recent] = await Promise.all([
        api.get('/admin/pending'),
        api.get('/admin/stats/recent-approvals', { days: 7 }).catch(() => null),
      ]);
      // FIX(Batch-1 approve crash): defend against unexpected payload
      // shapes so a flaky network response or backend change can't crash
      // the admin panel when the list refreshes after approval.
      setPending(Array.isArray(p) ? p.filter(Boolean) : []);
      if (recent && typeof recent.count === 'number') setRecentlyReviewed(recent.count);
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const params: any = { limit: 200, sort: 'quality' };
      if (query.trim()) params.q = query.trim();
      const r = await api.get('/spots', params);
      setAllSpots(Array.isArray(r) ? r.filter(Boolean) : []);
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
  }, [query]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'pending') await loadPending();
      else await loadAll();
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [tab, loadPending, loadAll]);

  useEffect(() => { reload(); }, [reload]);

  const decide = async (id: string, approve: boolean) => {
    try {
      // FIX(Batch-1 approve crash): optimistically remove the spot from
      // the pending list BEFORE we re-fetch, so there's no flicker where
      // the approved spot lingers with stale state while the list is
      // refreshing. Restores the spot on error.
      const snapshot = pending;
      setPending((prev) => prev.filter((s) => s?.spot_id !== id));
      try {
        await api.post(`/admin/spots/${id}/${approve ? 'approve' : 'reject'}`);
      } catch (err) {
        // restore on failure so the admin can retry
        setPending(snapshot);
        throw err;
      }
      // Refresh in background; if it fails we keep the optimistic state.
      loadPending().catch(() => {});
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
  };

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 80 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload(); }} tintColor={colors.primary} />}
    >
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, tab === 'pending' && styles.tabActive]} onPress={() => setTab('pending')}>
          <Text style={[styles.tabTxt, tab === 'pending' && styles.tabTxtActive]}>PENDING{pending.length ? ` (${pending.length})` : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'all' && styles.tabActive]} onPress={() => setTab('all')}>
          <Text style={[styles.tabTxt, tab === 'all' && styles.tabTxtActive]}>ALL SPOTS</Text>
        </TouchableOpacity>
      </View>

      {tab === 'all' && (
        <View style={styles.searchWrap}>
          <Search size={14} color={colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={loadAll}
            placeholder="Search by title, city, or country…"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            style={styles.searchInput}
          />
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : tab === 'pending' ? (
        pending.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}>
              <ShieldCheck size={40} color={colors.success} />
            </View>
            <Text style={styles.emptyTitle}>Queue cleared</Text>
            <Text style={styles.emptyBody}>
              No pending spot submissions. Switch to "All spots" to edit covers or moderate live locations.
            </Text>
            {typeof recentlyReviewed === 'number' && recentlyReviewed > 0 && (
              <View style={styles.statsChip}>
                <Text style={styles.statsTxt}>{recentlyReviewed} approved in the last 7 days</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={{ paddingHorizontal: space.lg, gap: 8 }}>
            <Text style={styles.hint}>Approve, reject, or open the cover editor.</Text>
            {pending.map((s: any) => {
              const cover = s.hero_cover_image_url
                || (s.images && (s.images.find((i: any) => i.is_cover) || s.images[0]))?.image_url;
              return (
                <View key={s.spot_id} style={styles.pendCard}>
                  <View style={styles.pendTopRow}>
                    {cover
                      ? <Image source={{ uri: cover }} style={styles.pendImg} />
                      : <View style={[styles.pendImg, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
                          <ImagePlus size={14} color={colors.textTertiary} />
                        </View>}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pendTitle} numberOfLines={1}>{s.title}</Text>
                      <Text style={styles.pendCity} numberOfLines={1}>
                        {s.city || ''}{s.state ? `, ${s.state}` : ''}
                        {s.country_code ? ` · ${s.country_code}` : ''}
                      </Text>
                      <Text style={styles.pendMeta}>
                        {(s.images || []).length} photo{(s.images || []).length === 1 ? '' : 's'} · Submitted {timeAgo(s.created_at)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.btnRow}>
                    <TouchableOpacity
                      style={[styles.actBtn, styles.actGhost]}
                      onPress={() => router.push(`/admin/spots/${s.spot_id}/edit` as any)}
                      testID={`admin-edit-${s.spot_id}`}
                    >
                      <Pencil size={12} color={colors.primary} />
                      <Text style={[styles.actTxt, { color: colors.primary }]}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actBtn, styles.actGhost]}
                      onPress={() => router.push(`/admin/spots/${s.spot_id}/cover` as any)}
                      testID={`admin-cover-${s.spot_id}`}
                    >
                      <Crop size={12} color={colors.primary} />
                      <Text style={[styles.actTxt, { color: colors.primary }]}>Cover</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actBtn, { backgroundColor: colors.secondary }]}
                      onPress={() => decide(s.spot_id, false)}
                      testID={`admin-reject-${s.spot_id}`}
                    >
                      <X size={12} color="#fff" />
                      <Text style={[styles.actTxt, { color: '#fff' }]}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actBtn, { backgroundColor: colors.success }]}
                      onPress={() => decide(s.spot_id, true)}
                      testID={`admin-approve-${s.spot_id}`}
                    >
                      <Check size={12} color={colors.textInverse} />
                      <Text style={[styles.actTxt, { color: colors.textInverse }]}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )
      ) : (
        allSpots.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No spots match</Text>
            <Text style={styles.emptyBody}>Try a different search.</Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: space.lg, gap: 8 }}>
            <Text style={styles.hint}>Tap a row to edit details · use the Cover pill for hero crops.</Text>
            {allSpots.map((s: any) => {
              const cover = s.hero_cover_image_url
                || (s.images && (s.images.find((i: any) => i.is_cover) || s.images[0]))?.image_url;
              return (
                <TouchableOpacity
                  key={s.spot_id}
                  style={styles.row}
                  activeOpacity={0.75}
                  onPress={() => router.push(`/admin/spots/${s.spot_id}/edit` as any)}
                  testID={`admin-row-${s.spot_id}`}
                >
                  {cover ? (
                    <Image source={{ uri: cover }} style={styles.rowImg} />
                  ) : (
                    <View style={[styles.rowImg, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
                      <ImagePlus size={14} color={colors.textTertiary} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{s.title}</Text>
                      {s.featured ? <Star size={10} color={colors.primary} fill={colors.primary} /> : null}
                      {s.hidden_from_explore ? <EyeOff size={10} color={colors.secondary} /> : null}
                    </View>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {s.city || ''}{s.state ? `, ${s.state}` : ''}{s.country_code ? ` · ${s.country_code}` : ''}
                    </Text>
                    <Text style={styles.rowMeta2}>
                      Q{s.quality_score ?? '—'} · {(s.images || []).length} photo{(s.images || []).length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={styles.rowChips}>
                    <TouchableOpacity
                      style={styles.coverChip}
                      onPress={() => router.push(`/admin/spots/${s.spot_id}/cover` as any)}
                      testID={`admin-row-cover-${s.spot_id}`}
                      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                    >
                      <Crop size={11} color={colors.textSecondary} />
                      <Text style={styles.coverChipTxt}>COVER</Text>
                    </TouchableOpacity>
                    <View style={styles.editChip}>
                      <Pencil size={11} color={colors.primary} />
                      <Text style={styles.editChipTxt}>EDIT</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabRow: { flexDirection: 'row', gap: 6, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: 8 },
  tab: {
    paddingHorizontal: 14, height: 34, alignItems: 'center', justifyContent: 'center',
    borderRadius: 17, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.7 },
  tabTxtActive: { color: colors.textInverse },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: space.lg, marginTop: 4, marginBottom: 6,
    padding: 10, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 13 },
  hint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, paddingHorizontal: space.sm, paddingBottom: 4 },

  emptyWrap: { alignItems: 'center', gap: 10, padding: space.xxl },
  emptyIcon: { width: 78, height: 78, borderRadius: 39, backgroundColor: 'rgba(16,185,129,0.12)', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 20 },
  emptyBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  statsChip: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, marginTop: 4 },
  statsTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11 },

  card: { backgroundColor: colors.surface1, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: 10, gap: 10 },
  metaRow: { flexDirection: 'row' },
  meta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  btnRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  actBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 8, paddingHorizontal: 8, borderRadius: radii.sm,
  },
  actGhost: {
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.primary,
  },
  actTxt: { fontFamily: font.bodyBold, fontSize: 12 },

  // Compact pending card (Jun 2025)
  pendCard: {
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderRadius: radii.md,
    padding: space.md, gap: 8,
  },
  pendTopRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  pendImg: { width: 52, height: 52, borderRadius: radii.sm },
  pendTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  pendCity: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 1 },
  pendMeta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, marginTop: 2 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md,
  },
  rowImg: { width: 56, height: 56, borderRadius: radii.sm, backgroundColor: colors.surface2 },
  rowTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, flex: 1 },
  rowMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  rowMeta2: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, marginTop: 2 },
  rowChips: { gap: 5, alignItems: 'flex-end' },
  coverChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  coverChipTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5 },
  editChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(245,166,35,0.12)', borderWidth: 1, borderColor: colors.primary,
  },
  editChipTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5 },
});
