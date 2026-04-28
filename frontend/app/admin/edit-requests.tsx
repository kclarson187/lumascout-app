/**
 * Admin — Spot Edit Request Moderation.
 * Route: /admin/edit-requests
 *
 * Moderator+ can approve/reject uploader-submitted field changes. Diff
 * is rendered inline (before vs. after). Approvals apply atomically on
 * the backend and notify the owner. Rejections require a note so the
 * owner knows why.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Image,
  RefreshControl, Alert, ActivityIndicator, TextInput, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import { ChevronLeft, Check, X, ClipboardList } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import KeyboardSafe from '../../src/components/KeyboardSafe';

type EditReq = {
  request_id: string;
  spot_id: string;
  owner_user_id: string;
  status: 'pending' | 'approved' | 'rejected';
  changes: Record<string, any>;
  before: Record<string, any>;
  reason_note?: string | null;
  created_at: string;
  decision_note?: string | null;
  spot?: { title?: string; city?: string; state?: string; cover_image_url?: string | null };
  owner?: { name?: string; username?: string; avatar_url?: string };
};

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  shoot_types: 'Tags',
  best_light_notes: 'Best light notes',
  best_time_of_day: 'Best time',
  parking_notes: 'Parking',
  access_notes: 'Access',
  safety_notes: 'Safety',
  tips: 'Tips',
  photo_order: 'Photo order',
  featured_image_url: 'Featured photo',
};

export default function AdminEditRequests() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [items, setItems] = useState<EditReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [decideTarget, setDecideTarget] = useState<{ req: EditReq; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canMod = !!user && ['moderator', 'admin', 'super_admin'].includes(user.role || '');

  const load = useCallback(async () => {
    try {
      const r = await api.get('/admin/edit-requests', { status: tab, limit: 100 });
      setItems(r.items || []);
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const decide = async () => {
    if (!decideTarget || submitting) return;
    const { req, action } = decideTarget;
    if (action === 'reject' && !note.trim()) {
      Alert.alert('Note required', 'Tell the uploader why the request was rejected.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/admin/edit-requests/${req.request_id}/${action}`, {
        note: note.trim() || undefined,
      });
      // Optimistically drop it from the pending tab
      setItems((prev) => prev.filter((i) => i.request_id !== req.request_id));
      setDecideTarget(null); setNote('');
      // Refresh in background for counts
      load().catch(() => {});
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    } finally { setSubmitting(false); }
  };

  if (!canMod) {
    return (
      <SafeAreaView style={s.root}><Stack.Screen options={{ headerShown: false }}/>
        <View style={s.empty}><Text style={s.emptyTitle}>Admin access required</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }}/>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10}><ChevronLeft size={22} color={colors.text}/></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Edit Requests</Text>
          <Text style={s.headerSub}>{items.length} in {tab}</Text>
        </View>
      </View>

      <View style={s.tabRow}>
        {(['pending', 'all'] as const).map((t) => (
          <Pressable key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>{t.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }}/>
      ) : items.length === 0 ? (
        <View style={s.empty}>
          <ClipboardList size={32} color={colors.textTertiary}/>
          <Text style={s.emptyTitle}>No {tab} requests</Text>
          <Text style={s.emptySub}>{tab === 'pending' ? 'Queue cleared.' : 'Nothing yet.'}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary}/>}
        >
          {items.map((it) => (
            <View key={it.request_id} style={s.card}>
              <Pressable onPress={() => router.push(`/spot/${it.spot_id}` as any)} style={{ flexDirection: 'row', gap: 10 }}>
                {it.spot?.cover_image_url
                  ? <Image source={{ uri: it.spot.cover_image_url }} style={s.thumb}/>
                  : <View style={[s.thumb, { backgroundColor: colors.surface2 }]}/>}
                <View style={{ flex: 1 }}>
                  <Text style={s.pTitle} numberOfLines={1}>{it.spot?.title || '—'}</Text>
                  <Text style={s.pMeta} numberOfLines={1}>
                    {it.spot?.city ? `${it.spot.city}${it.spot?.state ? `, ${it.spot.state}` : ''}` : ''} · by {it.owner?.name || '—'}
                  </Text>
                  <View style={[s.badge, it.status === 'pending' ? s.badgePending : it.status === 'approved' ? s.badgeOk : s.badgeBad]}>
                    <Text style={[s.badgeTxt, it.status === 'pending' ? { color: colors.warning } : it.status === 'approved' ? { color: colors.success } : { color: colors.secondary }]}>{it.status.toUpperCase()}</Text>
                  </View>
                </View>
              </Pressable>

              {/* Diff */}
              <View style={s.diffWrap}>
                {Object.keys(it.changes).map((k) => (
                  <View key={k} style={s.diffRow}>
                    <Text style={s.diffField}>{FIELD_LABELS[k] || k}</Text>
                    <Text style={s.diffBefore} numberOfLines={2}>{fmtVal(it.before?.[k])}</Text>
                    <Text style={s.diffArrow}>→</Text>
                    <Text style={s.diffAfter} numberOfLines={2}>{fmtVal(it.changes[k])}</Text>
                  </View>
                ))}
              </View>

              {!!it.reason_note && <Text style={s.reasonNote}>"{it.reason_note}"</Text>}
              {it.status === 'rejected' && !!it.decision_note && (
                <Text style={s.rejectNote}>Reject reason: {it.decision_note}</Text>
              )}

              {it.status === 'pending' && (
                <View style={s.actRow}>
                  <Pressable style={[s.act, s.actApprove]} onPress={() => { setDecideTarget({ req: it, action: 'approve' }); setNote(''); }}>
                    <Check size={14} color="#000"/><Text style={s.actApproveTxt}>Approve</Text>
                  </Pressable>
                  <Pressable style={[s.act, s.actReject]} onPress={() => { setDecideTarget({ req: it, action: 'reject' }); setNote(''); }}>
                    <X size={14} color={colors.secondary}/><Text style={s.actRejectTxt}>Reject</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Decision modal */}
      <Modal visible={!!decideTarget} transparent animationType="slide" onRequestClose={() => setDecideTarget(null)}>
        <View style={s.modalBackdrop}>
          <KeyboardSafe bottomInset={30}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>{decideTarget?.action === 'approve' ? 'Approve changes' : 'Reject request'}</Text>
              <Text style={s.modalSub}>"{decideTarget?.req.spot?.title}"</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                multiline numberOfLines={4}
                placeholder={decideTarget?.action === 'reject' ? 'Required — why are you rejecting?' : 'Optional admin note'}
                placeholderTextColor={colors.textTertiary}
                style={s.modalInput}
              />
              <Pressable style={[s.modalBtn, decideTarget?.action === 'approve' ? s.actApprove : { backgroundColor: 'rgba(208,72,72,0.14)', borderWidth: 1, borderColor: colors.secondary }]} onPress={decide} disabled={submitting}>
                {submitting ? <ActivityIndicator color={decideTarget?.action === 'approve' ? '#000' : colors.secondary}/> : (
                  <Text style={[s.modalBtnTxt, decideTarget?.action === 'approve' ? { color: '#000' } : { color: colors.secondary }]}>
                    {decideTarget?.action === 'approve' ? 'Apply changes' : 'Send rejection'}
                  </Text>
                )}
              </Pressable>
              <Pressable onPress={() => setDecideTarget(null)} style={{ alignItems: 'center', padding: 10 }}>
                <Text style={{ color: colors.textTertiary, fontFamily: font.body, fontSize: 13 }}>Cancel</Text>
              </Pressable>
            </View>
          </KeyboardSafe>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function fmtVal(v: any): string {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  const str = String(v);
  return str.length > 80 ? str.slice(0, 77) + '…' : str;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.display, fontSize: 17 },
  headerSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  tabRow: { flexDirection: 'row', paddingHorizontal: space.md, gap: 6, marginTop: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  tabTxtActive: { color: '#000' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: 8 },
  emptyTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 12, gap: 10 },
  thumb: { width: 72, height: 72, borderRadius: radii.md },
  pTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  pMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 3 },
  badge: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm, borderWidth: 1 },
  badgePending: { backgroundColor: 'rgba(251,191,36,0.14)', borderColor: colors.warning },
  badgeOk: { backgroundColor: 'rgba(16,185,129,0.14)', borderColor: colors.success },
  badgeBad: { backgroundColor: 'rgba(208,72,72,0.14)', borderColor: colors.secondary },
  badgeTxt: { fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.6 },
  diffWrap: { backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: radii.sm, padding: 8, gap: 6 },
  diffRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  diffField: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 10, width: 74, letterSpacing: 0.5 },
  diffBefore: { flex: 1, color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  diffArrow: { color: colors.primary, fontSize: 11 },
  diffAfter: { flex: 1, color: colors.text, fontFamily: font.bodyBold, fontSize: 11 },
  reasonNote: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, fontStyle: 'italic' },
  rejectNote: { color: colors.secondary, fontFamily: font.body, fontSize: 12 },
  actRow: { flexDirection: 'row', gap: 8 },
  act: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: radii.md },
  actApprove: { backgroundColor: colors.success },
  actApproveTxt: { color: '#000', fontFamily: font.bodyBold, fontSize: 13 },
  actReject: { backgroundColor: 'rgba(208,72,72,0.14)', borderWidth: 1, borderColor: colors.secondary },
  actRejectTxt: { color: colors.secondary, fontFamily: font.bodyBold, fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: space.xl, gap: 10 },
  modalTitle: { color: colors.text, fontFamily: font.display, fontSize: 18 },
  modalSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  modalInput: { minHeight: 90, textAlignVertical: 'top', backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 12, color: colors.text, fontFamily: font.body, fontSize: 14 },
  modalBtn: { paddingVertical: 12, borderRadius: radii.md, alignItems: 'center', marginTop: 4 },
  modalBtnTxt: { fontFamily: font.bodyBold, fontSize: 14 },
});
