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
import { Check, X, ShieldCheck, Crop, Search, Star, EyeOff, ImagePlus } from 'lucide-react-native';
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
      setPending(p);
      if (recent && typeof recent.count === 'number') setRecentlyReviewed(recent.count);
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const params: any = { limit: 200, sort: 'quality' };
      if (query.trim()) params.q = query.trim();
      const r = await api.get('/spots', params);
      setAllSpots(Array.isArray(r) ? r : []);
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
      await api.post(`/admin/spots/${id}/${approve ? 'approve' : 'reject'}`);
      await loadPending();
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
          <View style={{ paddingHorizontal: space.xl, gap: space.md }}>
            {pending.map((s: any) => (
              <View key={s.spot_id} style={styles.card}>
                <SpotCard spot={s} onPress={() => {}} />
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>Submitted {timeAgo(s.created_at)}</Text>
                </View>
                <View style={styles.btnRow}>
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
            <Text style={styles.hint}>Tap any row to open the cover editor.</Text>
            {allSpots.map((s: any) => {
              const cover = s.hero_cover_image_url
                || (s.images && (s.images.find((i: any) => i.is_cover) || s.images[0]))?.image_url;
              return (
                <TouchableOpacity
                  key={s.spot_id}
                  style={styles.row}
                  activeOpacity={0.75}
                  onPress={() => router.push(`/admin/spots/${s.spot_id}/cover` as any)}
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
                  <View style={styles.editChip}>
                    <Crop size={12} color={colors.primary} />
                    <Text style={styles.editChipTxt}>EDIT</Text>
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
  btnRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 12, borderRadius: radii.md },
  actTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },

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
  editChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(245,166,35,0.12)', borderWidth: 1, borderColor: colors.primary,
  },
  editChipTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5 },
});
