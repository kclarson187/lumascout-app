import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl, Keyboard, Alert, Modal, Platform } from 'react-native';
import SafeImage from '../../src/components/SafeImage';
import { router } from 'expo-router';
import { Search, ChevronRight, ShieldAlert, Flag, CheckCircle2, Circle, Trash2, X, AlertTriangle } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { isAdmin } from '../../src/utils/entitlements';
import { colors, font, space, radii } from '../../src/theme';
import VerifiedBadge from '../../src/components/VerifiedBadge';

const ROLE_FILTERS = ['all', 'user', 'founding_scout', 'moderator', 'support', 'admin', 'super_admin'];
const PLAN_FILTERS = ['all', 'free', 'pro', 'elite', 'comp_pro', 'comp_elite'];
const STATUS_FILTERS = ['all', 'active', 'suspended'];

const PLAN_COLOR: Record<string, string> = {
  free: colors.textSecondary,
  pro: colors.info,
  elite: colors.primary,
  comp_pro: colors.info,
  comp_elite: colors.primary,
  suspended: colors.secondary };

export default function AdminUsers() {
  const { user: me } = useAuth();
  const isSuper = me?.role === 'super_admin';

  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [plan, setPlan] = useState('all');
  const [status, setStatus] = useState('all');
  const [includeTest, setIncludeTest] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // Multi-select state — Apr 2026 priority sprint (Super Admin Panel #1)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggleSelect = useCallback((uid: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (q.trim()) params.q = q.trim();
      if (role !== 'all') params.role = role;
      if (plan !== 'all') params.plan = plan;
      if (status !== 'all') params.status = status;
      if (includeTest) params.include_test = true;
      setData(await api.get('/admin/users', params));
    } finally { setLoading(false); }
  }, [q, role, plan, status, includeTest, page]);

  useEffect(() => { load(); }, [load]);

  const performBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const res = await api.post('/admin/users/bulk-delete', {
        user_ids: ids,
        reason_code: 'other',
        reason_note: `Bulk delete via super-admin panel` });
      const ok = (res.succeeded || []).length;
      const failed = (res.failed || []).length;
      setConfirmOpen(false);
      exitSelectMode();
      await load();
      Alert.alert(
        'Bulk delete complete',
        failed === 0
          ? `Successfully deleted ${ok} ${ok === 1 ? 'user' : 'users'}.`
          : `Deleted ${ok}. Failed: ${failed}. Check audit log for details.`,
      );
    } catch (e) {
      Alert.alert('Bulk delete failed', formatApiError(e));
    } finally {
      setDeleting(false);
    }
  }, [selectedIds, exitSelectMode, load]);

  return (
    <View style={{ flex: 1 }}>
      {/* ---- Action bar (selection mode) ---- */}
      {selectMode ? (
        <View style={styles.actionBar} testID="admin-users-action-bar">
          <TouchableOpacity onPress={exitSelectMode} style={styles.actionBtn} hitSlop={8}>
            <X size={18} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.actionTitle}>
            {selectedIds.size} selected
          </Text>
          <TouchableOpacity
            onPress={() => setConfirmOpen(true)}
            disabled={selectedIds.size === 0}
            style={[styles.deleteBtn, selectedIds.size === 0 && styles.deleteBtnDisabled]}
            testID="admin-users-bulk-delete"
          >
            <Trash2 size={14} color={selectedIds.size === 0 ? colors.textTertiary : '#1a0a06'} />
            <Text style={[styles.deleteBtnTxt, selectedIds.size === 0 && { color: colors.textTertiary }]}>
              Delete
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.filterBar}>
        <View style={styles.searchWrap}>
          <Search size={14} color={colors.textSecondary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => { setPage(1); Keyboard.dismiss(); load(); }}
            placeholder="Search name, email, username…"
            placeholderTextColor={colors.textTertiary}
            style={styles.searchInput}
            returnKeyType="search"
            testID="admin-users-search"
          />
        </View>
        {isSuper && !selectMode ? (
          <TouchableOpacity
            onPress={() => setSelectMode(true)}
            style={styles.selectBtn}
            testID="admin-users-select-mode"
          >
            <CheckCircle2 size={14} color={colors.primary} />
            <Text style={styles.selectBtnTxt}>Select</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, maxHeight: 44 }} contentContainerStyle={styles.chipsStrip}>
        {ROLE_FILTERS.map((r) => <Chip key={`role-${r}`} label={`role: ${r}`} active={role === r} onPress={() => { setPage(1); setRole(r); }} />)}
        {PLAN_FILTERS.map((p) => <Chip key={`plan-${p}`} label={`plan: ${p}`} active={plan === p} onPress={() => { setPage(1); setPlan(p); }} />)}
        {STATUS_FILTERS.map((s) => <Chip key={`status-${s}`} label={`status: ${s}`} active={status === s} onPress={() => { setPage(1); setStatus(s); }} />)}
        <Chip key="include-test" label={includeTest ? 'Test accounts: shown' : 'Hide test accounts'} active={includeTest} onPress={() => { setPage(1); setIncludeTest(v => !v); }} />
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.xl, gap: 8, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        >
          <Text style={styles.totals}>
            {data?.total ?? 0} match{(data?.total ?? 0) === 1 ? '' : 'es'} · page {data?.page ?? 1}/{data?.pages ?? 1}
            {selectMode && selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ''}
          </Text>
          {(data?.items || []).map((u: any) => {
            const isSelected = selectedIds.has(u.user_id);
            const cantSelect = u.user_id === me?.user_id || u.role === 'super_admin';
            return (
              <TouchableOpacity
                key={u.user_id}
                style={[styles.row, isSelected && styles.rowSelected]}
                onPress={() => {
                  if (selectMode) {
                    if (cantSelect) return;
                    toggleSelect(u.user_id);
                  } else {
                    router.push(`/admin/user/${u.user_id}` as any);
                  }
                }}
                onLongPress={() => {
                  if (!isSuper || selectMode) return;
                  setSelectMode(true);
                  toggleSelect(u.user_id);
                }}
                testID={`admin-user-${u.user_id}`}
              >
                {selectMode ? (
                  <View style={styles.checkboxWrap}>
                    {cantSelect ? (
                      <View style={styles.checkboxLocked}>
                        <ShieldAlert size={12} color={colors.textTertiary} />
                      </View>
                    ) : isSelected ? (
                      <CheckCircle2 size={22} color={colors.primary} />
                    ) : (
                      <Circle size={22} color={colors.textTertiary} />
                    )}
                  </View>
                ) : null}
                {u.avatar_url
                  ? <SafeImage source={{ uri: u.avatar_url }} style={styles.avatar} />
                  : <View style={[styles.avatar, { backgroundColor: colors.surface2 }]} />}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.name} numberOfLines={1}>{u.name}</Text>
                    <VerifiedBadge status={u.verification_status} variant="inline" size={12} />
                  </View>
                  <Text style={styles.sub} numberOfLines={1}>{u.email}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <Pill label={u.plan} color={PLAN_COLOR[u.plan] || colors.textSecondary} />
                    {u.role !== 'user' && <Pill label={u.role} color={colors.primary} />}
                    {u.status === 'suspended' && <Pill label="suspended" color={colors.secondary} />}
                    {u.spot_count > 0 && <Text style={styles.tiny}>· {u.spot_count} spots</Text>}
                    {u.open_reports > 0 && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                        <Flag size={11} color={colors.secondary} />
                        <Text style={[styles.tiny, { color: colors.secondary }]}>{u.open_reports}</Text>
                      </View>
                    )}
                  </View>
                </View>
                {!selectMode ? <ChevronRight size={16} color={colors.textSecondary} /> : null}
              </TouchableOpacity>
            );
          })}

          {data && data.pages > 1 && (
            <View style={styles.pager}>
              <TouchableOpacity
                style={[styles.pagerBtn, page <= 1 && styles.pagerBtnDisabled]}
                disabled={page <= 1}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
                testID="admin-users-prev"
              >
                <Text style={styles.pagerTxt}>← Prev</Text>
              </TouchableOpacity>
              <Text style={styles.pagerPage}>{page} / {data.pages}</Text>
              <TouchableOpacity
                style={[styles.pagerBtn, page >= data.pages && styles.pagerBtnDisabled]}
                disabled={page >= data.pages}
                onPress={() => setPage((p) => p + 1)}
                testID="admin-users-next"
              >
                <Text style={styles.pagerTxt}>Next →</Text>
              </TouchableOpacity>
            </View>
          )}

          {(data?.items || []).length === 0 && (
            <View style={{ alignItems: 'center', marginTop: 40, gap: 8 }}>
              <ShieldAlert size={24} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, fontFamily: font.bodyMedium }}>No users match those filters.</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ---- Confirmation modal ---- */}
      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <AlertTriangle size={26} color={colors.secondary} />
            </View>
            <Text style={styles.modalTitle}>
              Delete {selectedIds.size} user{selectedIds.size === 1 ? '' : 's'} permanently?
            </Text>
            <Text style={styles.modalBody}>
              This soft-deletes the accounts: their email/username are anonymized, billing is canceled, and they can no longer sign in. This action is reversible only by restoring from the audit archive.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setConfirmOpen(false)}
                style={[styles.modalBtn, styles.modalBtnGhost]}
                disabled={deleting}
              >
                <Text style={styles.modalBtnGhostTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={performBulkDelete}
                style={[styles.modalBtn, styles.modalBtnDanger, deleting && { opacity: 0.6 }]}
                disabled={deleting}
                testID="admin-users-bulk-confirm"
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Trash2 size={14} color="#fff" />
                    <Text style={styles.modalBtnDangerTxt}>Delete {selectedIds.size}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{
      backgroundColor: color + '22', borderColor: color, borderWidth: 1,
      paddingHorizontal: 7, paddingVertical: 2, borderRadius: radii.pill }}>
      <Text style={{ color, fontFamily: font.bodyBold, fontSize: 9 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.xl, paddingVertical: 10,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderBottomColor: 'rgba(245,166,35,0.30)',
    borderBottomWidth: StyleSheet.hairlineWidth },
  actionBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface1 },
  actionTitle: {
    flex: 1,
    color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radii.md, backgroundColor: colors.primary },
  deleteBtnDisabled: { backgroundColor: colors.surface2 },
  deleteBtnTxt: { color: '#1a0a06', fontFamily: font.bodyBold, fontSize: 13 },

  selectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: radii.md, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1 },
  selectBtnTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 },

  filterBar: { paddingHorizontal: space.xl, paddingTop: space.sm, flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  searchWrap: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md, paddingHorizontal: space.md, paddingVertical: 10 },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14 },
  chipsStrip: { paddingHorizontal: space.xl, paddingVertical: space.sm, gap: 6, alignItems: 'center' },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  chipTxtActive: { color: colors.textInverse, fontFamily: font.bodySemibold },
  totals: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, marginBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: space.md, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  rowSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(245,166,35,0.06)' },
  checkboxWrap: { width: 28, alignItems: 'center', justifyContent: 'center' },
  checkboxLocked: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    borderColor: colors.textTertiary, borderWidth: 1, borderStyle: 'dashed' },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  name: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  tiny: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: space.lg },
  pagerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  pagerBtnDisabled: { opacity: 0.4 },
  pagerTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  pagerPage: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },

  // Modal
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: space.xl },
  modalCard: {
    width: '100%', maxWidth: 400,
    backgroundColor: colors.surface1,
    borderRadius: radii.xl,
    borderColor: colors.border, borderWidth: 1,
    padding: space.xl,
    alignItems: 'center' },
  modalIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(217,80,67,0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space.md },
  modalTitle: {
    color: colors.text, fontFamily: font.bodyBold, fontSize: 17,
    textAlign: 'center', marginBottom: 8, letterSpacing: -0.2 },
  modalBody: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 13,
    textAlign: 'center', lineHeight: 19, marginBottom: space.lg },
  modalActions: {
    flexDirection: 'row', gap: space.md, width: '100%' },
  modalBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12,
    borderRadius: radii.md },
  modalBtnGhost: {
    backgroundColor: colors.surface2,
    borderColor: colors.border, borderWidth: 1 },
  modalBtnGhostTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  modalBtnDanger: { backgroundColor: colors.secondary },
  modalBtnDangerTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 14 } });
