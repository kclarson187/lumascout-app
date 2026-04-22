/**
 * Super Admin — Community Control Center
 * Path: /admin/community
 *
 * Dashboard with 4 tabs (V1):
 *   Posts / Reports / Spam Queue / Deleted Content
 * Polls / Comments / Users / Appeals deferred to V1.1.
 *
 * Role gating:
 *   - moderator: read-only + hide/restore/lock/unlock/pin/feature/mark_spam/clear_spam/soft_delete
 *   - admin: everything above + bulk actions + user warn/suspend
 *   - super_admin: everything above + hard_delete + user ban
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  Image,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, Shield, Trash2, EyeOff, Pin, Star, Lock, Flag, AlertTriangle,
  RotateCcw, ChevronDown, MoreHorizontal, CheckSquare, Square, Search,
  ShieldAlert, Ban, UserX, X, Info, Archive,
} from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';

type TabKey = 'posts' | 'reports' | 'spam' | 'deleted';
type Status = 'active' | 'removed' | 'hidden' | 'spam' | 'pinned' | 'featured';

type CommunityItem = {
  post_id?: string;
  poll_id?: string;
  comment_id?: string;
  title?: string;
  body?: string;
  status?: string;
  hidden?: boolean;
  pinned?: boolean;
  featured?: boolean;
  locked?: boolean;
  spam?: boolean;
  author_user_id?: string;
  created_at?: string;
  _author?: { user_id: string; name: string; username?: string; avatar_url?: string };
  _report_count?: number;
};

type Report = {
  report_id: string;
  reporter_user_id: string;
  reporter_email?: string;
  target_type: string;
  target_id: string;
  reason: string;
  detail?: string;
  status: string;
  created_at: string;
};

type Summary = {
  posts: { active: number; removed: number; hidden: number; spam: number; pinned: number; featured: number };
  reports: { pending: number; resolved: number; total: number };
  sanctions: { active_warnings: number; active_suspensions: number; active_bans: number };
};

const TAB_META: Record<TabKey, { label: string; icon: any }> = {
  posts:    { label: 'Posts',    icon: Archive },
  reports:  { label: 'Reports',  icon: Flag },
  spam:     { label: 'Spam',     icon: ShieldAlert },
  deleted:  { label: 'Deleted',  icon: Trash2 },
};

// ---------------------------------------------------------------------------
export default function AdminCommunity() {
  const { user } = useAuth();
  const role = user?.role || 'user';
  const isSuperAdmin = role === 'super_admin';
  const isAdmin = role === 'admin' || isSuperAdmin;
  const hasMod = isAdmin || role === 'moderator';

  const [tab, setTab] = useState<TabKey>('posts');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<CommunityItem[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<{ id: string; kind: 'post' | 'poll' | 'comment' } | null>(null);
  const [pendingAction, setPendingAction] = useState(false);

  const idOf = (item: CommunityItem) => item.post_id || item.poll_id || item.comment_id || '';

  const load = useCallback(async () => {
    if (!hasMod) return;
    try {
      const [sum, posts, reps] = await Promise.all([
        api.get('/admin/community/summary'),
        api.get('/admin/community/content', {
          type: 'post',
          status: tab === 'spam' ? 'spam' : tab === 'deleted' ? 'removed' : undefined,
          limit: 50,
        }),
        tab === 'reports' ? api.get('/admin/reports', { status: 'pending' }) : Promise.resolve(null),
      ]);
      setSummary(sum);
      setItems(posts?.items || []);
      if (reps) setReports(reps.items || []);
    } catch (e) {
      console.warn('admin community load', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, hasMod]);

  useFocusEffect(useCallback(() => {
    setSelected(new Set());
    load();
  }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  const doAction = async (
    id: string,
    kind: 'post' | 'poll' | 'comment',
    actionKey: string,
    reason?: string,
  ) => {
    setPendingAction(true);
    try {
      await api.post('/admin/community/moderate', { type: kind, id, action: actionKey, reason });
      await load();
    } catch (e) {
      Alert.alert('Action failed', formatApiError(e));
    } finally {
      setPendingAction(false);
      setAction(null);
    }
  };

  const doBulk = async (actionKey: string) => {
    if (selected.size === 0) return;
    const reason = 'bulk admin action';
    setPendingAction(true);
    try {
      const r = await api.post('/admin/community/bulk-moderate', {
        type: 'post',
        ids: Array.from(selected),
        action: actionKey,
        reason,
      });
      Alert.alert('Bulk action complete', `Applied to ${r.applied} item(s). ${r.failed ? `${r.failed} failed.` : ''}`);
      setSelected(new Set());
      await load();
    } catch (e) {
      Alert.alert('Bulk failed', formatApiError(e));
    } finally {
      setPendingAction(false);
    }
  };

  if (!hasMod) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.notAllowed}>
          <Shield size={40} color={colors.textTertiary} />
          <Text style={styles.notAllowedHead}>Moderator access required</Text>
          <Text style={styles.notAllowedSub}>
            Your account doesn't have the permissions to see this screen.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={10} testID="admin-community-back">
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Community Control</Text>
          <Text style={styles.headerSub}>
            {role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Admin' : 'Moderator'} powers
          </Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/admin/audit' as any)} hitSlop={10} style={styles.backBtn}>
          <Info size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Summary strip */}
      {summary ? (
        <View style={styles.summaryRow}>
          <SummaryChip label="Active" value={summary.posts.active} />
          <SummaryChip label="Pending reports" value={summary.reports.pending} highlight={summary.reports.pending > 0} />
          <SummaryChip label="Spam" value={summary.posts.spam} />
          <SummaryChip label="Removed" value={summary.posts.removed} />
        </View>
      ) : null}

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
        {(Object.keys(TAB_META) as TabKey[]).map((k) => {
          const Icon = TAB_META[k].icon;
          const active = tab === k;
          const badge =
            k === 'reports' ? summary?.reports.pending :
            k === 'spam' ? summary?.posts.spam :
            k === 'deleted' ? summary?.posts.removed :
            summary?.posts.active;
          return (
            <TouchableOpacity
              key={k}
              style={[styles.tabChip, active && styles.tabChipActive]}
              onPress={() => setTab(k)}
              testID={`admin-tab-${k}`}
            >
              <Icon size={13} color={active ? colors.textInverse : colors.textSecondary} />
              <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>
                {TAB_META[k].label}
              </Text>
              {badge != null ? (
                <View style={[styles.tabBadge, active && { backgroundColor: 'rgba(255,255,255,0.24)' }]}>
                  <Text style={[styles.tabBadgeTxt, active && { color: colors.textInverse }]}>{badge}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Bulk actions bar */}
      {selected.size > 0 && tab !== 'reports' ? (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkSelected}>{selected.size} selected</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={styles.bulkBtn} onPress={() => doBulk('hide')} disabled={pendingAction}>
              <EyeOff size={12} color={colors.textInverse} />
              <Text style={styles.bulkBtnTxt}>Hide</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.bulkBtn, { backgroundColor: '#ef4444' }]} onPress={() => doBulk('mark_spam')} disabled={pendingAction}>
              <ShieldAlert size={12} color={colors.textInverse} />
              <Text style={styles.bulkBtnTxt}>Mark Spam</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bulkBtn} onPress={() => setSelected(new Set())}>
              <X size={12} color={colors.textInverse} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {tab === 'reports' ? (
            reports.length === 0 ? <EmptyRow head="No pending reports" sub="The queue is clear." /> :
            reports.map((r) => (
              <ReportCard key={r.report_id} report={r} onResolve={load} />
            ))
          ) : (
            items.length === 0 ? <EmptyRow head={`No ${tab} posts`} sub="Pull down to refresh." /> :
            items.map((it) => (
              <PostRow
                key={idOf(it)}
                item={it}
                selected={selected.has(idOf(it))}
                onToggleSelect={() => {
                  setSelected((s) => {
                    const n = new Set(s);
                    if (n.has(idOf(it))) n.delete(idOf(it)); else n.add(idOf(it));
                    return n;
                  });
                }}
                onOpen={() => router.push(`/community/post/${idOf(it)}` as any)}
                onAction={() => setAction({ id: idOf(it), kind: 'post' })}
              />
            ))
          )}
        </ScrollView>
      )}

      {/* Action sheet */}
      {action ? (
        <ActionSheet
          visible={!!action}
          onClose={() => setAction(null)}
          onApply={(k, r) => doAction(action.id, action.kind, k, r)}
          busy={pendingAction}
          isSuperAdmin={isSuperAdmin}
          isAdmin={isAdmin}
        />
      ) : null}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
function SummaryChip({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={[styles.sumChip, highlight && styles.sumChipHighlight]}>
      <Text style={[styles.sumVal, highlight && { color: colors.primary }]}>{value}</Text>
      <Text style={styles.sumLbl}>{label}</Text>
    </View>
  );
}

function EmptyRow({ head, sub }: { head: string; sub: string }) {
  return (
    <View style={styles.empty}>
      <Shield size={28} color={colors.textTertiary} />
      <Text style={styles.emptyHead}>{head}</Text>
      <Text style={styles.emptySub}>{sub}</Text>
    </View>
  );
}

function PostRow({
  item, selected, onToggleSelect, onOpen, onAction,
}: {
  item: CommunityItem; selected: boolean;
  onToggleSelect: () => void; onOpen: () => void; onAction: () => void;
}) {
  const status = item.spam ? 'spam' : item.hidden ? 'hidden' : item.status === 'removed' ? 'removed' : item.pinned ? 'pinned' : item.featured ? 'featured' : 'active';
  const statusColor = {
    active: colors.success, pinned: colors.primary, featured: colors.primary,
    hidden: colors.textSecondary, removed: '#ef4444', spam: '#ef4444',
  }[status] || colors.textSecondary;
  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={onToggleSelect} style={styles.checkBtn} hitSlop={8}>
        {selected ? <CheckSquare size={18} color={colors.primary} /> : <Square size={18} color={colors.textTertiary} />}
      </TouchableOpacity>
      <TouchableOpacity style={{ flex: 1, flexDirection: 'row', gap: 10 }} onPress={onOpen}>
        {item._author?.avatar_url ? (
          <Image source={{ uri: item._author.avatar_url }} style={styles.rowAvatar} />
        ) : (
          <View style={[styles.rowAvatar, { backgroundColor: colors.surface2 }]} />
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={styles.rowName}>{item._author?.name || 'Unknown'}</Text>
            <View style={[styles.rowStatus, { backgroundColor: statusColor + '22', borderColor: statusColor + '66' }]}>
              <Text style={[styles.rowStatusTxt, { color: statusColor }]}>{status.toUpperCase()}</Text>
            </View>
            {(item._report_count || 0) > 0 ? (
              <View style={styles.flagBadge}>
                <Flag size={9} color={colors.textInverse} />
                <Text style={styles.flagBadgeTxt}>{item._report_count}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.rowBody} numberOfLines={2}>
            {item.title || item.body || '(no text)'}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity onPress={onAction} style={styles.moreBtn} hitSlop={8} testID={`admin-row-more-${item.post_id}`}>
        <MoreHorizontal size={20} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
}

function ReportCard({ report, onResolve }: { report: Report; onResolve: () => void }) {
  const [busy, setBusy] = useState(false);
  const resolve = async (note?: string) => {
    setBusy(true);
    try {
      await api.post(`/admin/reports/${report.report_id}/resolve`, { note: note || 'reviewed' });
      onResolve();
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    } finally { setBusy(false); }
  };
  const openTarget = () => {
    if (report.target_type === 'post') router.push(`/community/post/${report.target_id}` as any);
    else if (report.target_type === 'user') router.push(`/user/${report.target_id}` as any);
  };
  return (
    <View style={styles.reportCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={styles.reportBadge}>
          <Flag size={11} color={colors.textInverse} />
          <Text style={styles.reportBadgeTxt}>{report.reason.toUpperCase()}</Text>
        </View>
        <Text style={styles.reportTarget}>{report.target_type} · {report.target_id.slice(0, 10)}…</Text>
      </View>
      {report.detail ? <Text style={styles.reportDetail}>{report.detail}</Text> : null}
      <Text style={styles.reportMeta}>Reported by {report.reporter_email || report.reporter_user_id}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <TouchableOpacity style={[styles.smallBtn, styles.smallBtnGhost]} onPress={openTarget}>
          <Text style={styles.smallBtnTxtGhost}>Open target</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary]} onPress={() => resolve('reviewed')} disabled={busy}>
          {busy ? <ActivityIndicator size="small" color={colors.textInverse} /> : <Text style={styles.smallBtnTxtPrimary}>Mark resolved</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
function ActionSheet({
  visible, onClose, onApply, busy, isSuperAdmin, isAdmin,
}: {
  visible: boolean; onClose: () => void;
  onApply: (action: string, reason?: string) => void;
  busy: boolean; isSuperAdmin: boolean; isAdmin: boolean;
}) {
  const [reason, setReason] = useState('');
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  const actions: Array<{ key: string; label: string; color: string; icon: any; destructive?: boolean; superOnly?: boolean; adminOnly?: boolean }> = [
    { key: 'pin',          label: 'Pin post',        color: colors.primary, icon: Pin },
    { key: 'feature',      label: 'Feature post',    color: colors.primary, icon: Star },
    { key: 'unpin',        label: 'Unpin',           color: colors.textSecondary, icon: Pin },
    { key: 'unfeature',    label: 'Unfeature',       color: colors.textSecondary, icon: Star },
    { key: 'lock',         label: 'Lock comments',   color: colors.textSecondary, icon: Lock },
    { key: 'unlock',       label: 'Unlock comments', color: colors.textSecondary, icon: Lock },
    { key: 'hide',         label: 'Hide from feed',  color: '#f59e0b', icon: EyeOff },
    { key: 'mark_spam',    label: 'Mark as spam',    color: '#f59e0b', icon: ShieldAlert },
    { key: 'restore',      label: 'Restore',         color: colors.success, icon: RotateCcw },
    { key: 'clear_spam',   label: 'Clear spam',      color: colors.success, icon: RotateCcw },
    { key: 'soft_delete',  label: 'Soft delete',     color: '#ef4444', icon: Trash2, destructive: true, adminOnly: true },
    { key: 'hard_delete',  label: 'Hard delete',     color: '#991b1b', icon: Ban, destructive: true, superOnly: true },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Moderate post</Text>
          <Text style={styles.sheetSub}>Pick an action. A reason helps with appeals.</Text>

          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (optional)…"
            placeholderTextColor={colors.textTertiary}
            style={styles.reasonInput}
          />

          <View style={styles.actionGrid}>
            {actions
              .filter((a) => (!a.superOnly || isSuperAdmin) && (!a.adminOnly || isAdmin))
              .map((a) => {
                const Icon = a.icon;
                const showConfirm = confirmAction === a.key;
                return (
                  <TouchableOpacity
                    key={a.key}
                    style={[styles.actionBtn, a.destructive && styles.actionBtnDestructive, showConfirm && { backgroundColor: a.color }]}
                    disabled={busy}
                    onPress={() => {
                      if (a.destructive && !showConfirm) {
                        setConfirmAction(a.key);
                        return;
                      }
                      setConfirmAction(null);
                      onApply(a.key, reason || undefined);
                    }}
                  >
                    <Icon size={14} color={showConfirm ? colors.textInverse : a.color} />
                    <Text style={[styles.actionTxt, { color: showConfirm ? colors.textInverse : a.color }]}>
                      {showConfirm ? 'Tap again to confirm' : a.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
          </View>

          <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notAllowed: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: 10 },
  notAllowedHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  notAllowedSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  headerSub: { color: colors.primary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.4 },

  summaryRow: {
    flexDirection: 'row', gap: 8, padding: space.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sumChip: {
    flex: 1,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, paddingVertical: 8, alignItems: 'center',
  },
  sumChipHighlight: { borderColor: 'rgba(245,166,35,0.5)', backgroundColor: 'rgba(245,166,35,0.08)' },
  sumVal: { color: colors.text, fontFamily: font.display, fontSize: 20 },
  sumLbl: { color: colors.textSecondary, fontFamily: font.body, fontSize: 10, marginTop: 2 },

  tabsRow: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: 8 },
  tabChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  tabChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 12 },
  tabTxtActive: { color: colors.textInverse },
  tabBadge: {
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: radii.sm,
    backgroundColor: colors.surface2,
  },
  tabBadgeTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 10 },

  bulkBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, paddingVertical: 8,
    backgroundColor: colors.primary + '18',
    borderBottomWidth: 1, borderBottomColor: 'rgba(245,166,35,0.4)',
  },
  bulkSelected: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 13 },
  bulkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.sm,
    backgroundColor: colors.primary,
  },
  bulkBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 11 },

  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, padding: space.md,
  },
  checkBtn: { paddingTop: 3 },
  rowAvatar: { width: 34, height: 34, borderRadius: 17 },
  rowName: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  rowStatus: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm, borderWidth: 1 },
  rowStatusTxt: { fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4 },
  rowBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17, marginTop: 3 },
  flagBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 5, paddingVertical: 2, borderRadius: radii.sm, backgroundColor: '#ef4444' },
  flagBadgeTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9 },
  moreBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  reportCard: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, padding: space.md, gap: 6,
  },
  reportBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.sm, backgroundColor: '#ef4444', alignSelf: 'flex-start' },
  reportBadgeTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4 },
  reportTarget: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11 },
  reportDetail: { color: colors.text, fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  reportMeta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },

  empty: { alignItems: 'center', padding: space.xxl, gap: 6 },
  emptyHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },

  modalBackdrop: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: space.xl, gap: space.md,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center' },
  sheetTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  sheetSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  reasonInput: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, padding: space.md, color: colors.text,
    fontFamily: font.body, fontSize: 13,
  },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md,
  },
  actionBtnDestructive: { borderColor: '#ef4444' + '66' },
  actionTxt: { fontFamily: font.bodyBold, fontSize: 12 },
  cancelBtn: { padding: 12, alignItems: 'center' },
  cancelTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 13 },

  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.sm },
  smallBtnPrimary: { backgroundColor: colors.primary },
  smallBtnGhost: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  smallBtnTxtPrimary: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 11 },
  smallBtnTxtGhost: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11 },
});
