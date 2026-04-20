import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput, Alert, ActivityIndicator, RefreshControl, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Crown, UserX, Sparkles, MessageSquarePlus, X, AlertTriangle, History, Trash2 } from 'lucide-react-native';
import { api, formatApiError } from '../../../src/api';
import { useAuth } from '../../../src/auth';
import { colors, font, space, radii } from '../../../src/theme';
import VerifiedBadge from '../../../src/components/VerifiedBadge';
import DeleteConfirmSheet, { USER_DELETE_PRESETS } from '../../../src/components/DeleteConfirmSheet';

const PLAN_OPTIONS = ['free', 'pro', 'elite', 'comp_pro', 'comp_elite', 'trial_pro', 'trial_elite'];
const ROLE_OPTIONS = ['user', 'moderator', 'support', 'admin', 'super_admin'];

export default function AdminUserDetail() {
  const { user: me } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [u, setU] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteDraft, setNoteDraft] = useState('');
  const [roleModal, setRoleModal] = useState<null | string>(null);
  const [roleConfirm, setRoleConfirm] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try { setU(await api.get(`/admin/users/${id}`)); }
    catch (e) { Alert.alert('Load failed', formatApiError(e)); router.back(); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading || !u) {
    return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  }

  const isSuperAdmin = me?.role === 'super_admin';
  const isSelf = u.user_id === me?.user_id;

  const patch = async (body: any, confirmLabel?: string) => {
    try {
      await api.patch(`/admin/users/${u.user_id}`, body);
      await load();
      if (confirmLabel) Alert.alert('Done', confirmLabel);
    } catch (e) {
      Alert.alert('Could not save', formatApiError(e));
    }
  };

  const changePlan = (plan: string) => {
    Alert.alert(
      `Set plan to ${plan}?`,
      plan.startsWith('comp_') ? 'This grants complimentary paid access. You can set an expiration later.' : `This overrides the user's plan immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => patch({ plan, reason: `manual set to ${plan}` }, `Plan is now ${plan}.`) },
      ],
    );
  };

  const grantWithDuration = (plan: 'comp_pro' | 'comp_elite') => {
    Alert.alert(
      `Gift ${plan === 'comp_pro' ? 'complimentary Pro' : 'complimentary Elite'}`,
      'Choose how long this complimentary access should last.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '30 days',  onPress: () => doGrant(plan, 30) },
        { text: '90 days',  onPress: () => doGrant(plan, 90) },
        { text: '365 days', onPress: () => doGrant(plan, 365) },
        { text: 'Never expire', onPress: () => doGrant(plan, null) },
      ],
    );
  };

  const doGrant = async (plan: string, days: number | null) => {
    try {
      await api.post(`/admin/users/${u.user_id}/grant-plan`, {
        plan,
        duration_days: days,
        reason: `comp grant (${days ? days + 'd' : 'permanent'})`,
      });
      await load();
      Alert.alert('Plan granted', `User is now on ${plan}${days ? ` for ${days} days.` : ' (permanent).'}`);
    } catch (e) {
      Alert.alert('Could not grant plan', formatApiError(e));
    }
  };

  const toggleSuspend = () => {
    if (u.status === 'suspended') {
      patch({ status: 'active', suspension_reason: '', reason: 'reactivated' }, 'User reactivated.');
    } else {
      Alert.alert(
        'Suspend account?',
        'They will lose access immediately. This is reversible.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Suspend', style: 'destructive', onPress: () => patch({ status: 'suspended', reason: 'admin suspend' }, 'Account suspended.') },
        ],
      );
    }
  };

  const toggleVerify = () => {
    const next = u.verification_status === 'verified' ? 'none' : 'verified';
    patch({ verification_status: next, reason: `verification ${next}` }, `Verification is now ${next}.`);
  };

  const requestRoleChange = (newRole: string) => {
    if (!isSuperAdmin) {
      Alert.alert('Super admin required', 'Only super admins can change roles.');
      return;
    }
    if (isSelf) {
      Alert.alert('Not allowed', 'You cannot change your own role.');
      return;
    }
    setRoleConfirm('');
    setRoleModal(newRole);
  };

  const submitRoleChange = async () => {
    if (!roleModal) return;
    if (roleConfirm !== roleModal) {
      Alert.alert('Type confirmation did not match', `Please type "${roleModal}" exactly.`);
      return;
    }
    try {
      await api.patch(`/admin/users/${u.user_id}`, { role: roleModal, reason: `role change → ${roleModal}` });
      setRoleModal(null);
      await load();
      Alert.alert('Role updated', `${u.name} is now ${roleModal}.`);
    } catch (e) {
      Alert.alert('Could not change role', formatApiError(e));
    }
  };

  const addNote = async () => {
    const body = noteDraft.trim();
    if (!body) return;
    try {
      await api.post(`/admin/users/${u.user_id}/notes`, { body, pinned: false });
      setNoteDraft('');
      await load();
    } catch (e) {
      Alert.alert('Could not add note', formatApiError(e));
    }
  };

  const submitDelete = async (code: string | null, note: string) => {
    try {
      const res = await api.delete(`/admin/users/${u.user_id}`, {
        reason_code: code || undefined,
        reason_note: note || undefined,
      });
      Alert.alert(
        'User deleted',
        `@${u.username || u.user_id} has been soft-deleted. Stripe cancelled: ${res.stripe_cancelled ? 'yes' : 'no'}.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      throw new Error(formatApiError(e));
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl, paddingBottom: 80, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
      >
        {/* Identity card */}
        <View style={styles.identity}>
          {u.avatar_url
            ? <Image source={{ uri: u.avatar_url }} style={styles.avatar} />
            : <View style={[styles.avatar, { backgroundColor: colors.surface2 }]} />}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.name}>{u.name}</Text>
              <VerifiedBadge status={u.verification_status} variant="inline" size={14} />
            </View>
            <Text style={styles.sub}>{u.email}</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <Pill label={`plan: ${u.plan}`} color={colors.primary} />
              <Pill label={`role: ${u.role}`} color={colors.info} />
              <Pill label={`status: ${u.status}`} color={u.status === 'suspended' ? colors.secondary : colors.success} />
              {u.comp_expiration && <Pill label={`comp → ${new Date(u.comp_expiration).toLocaleDateString()}`} color={colors.warning} />}
            </View>
          </View>
        </View>

        <StatsGrid u={u} />

        {/* Plan controls */}
        <Section title="Subscription plan">
          <View style={styles.chipGrid}>
            {PLAN_OPTIONS.map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => changePlan(p)}
                style={[styles.optChip, u.plan === p && styles.optChipActive]}
                testID={`plan-${p}`}
              >
                <Text style={[styles.optChipTxt, u.plan === p && styles.optChipTxtActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: space.sm }}>
            <TouchableOpacity
              style={styles.giftBtn}
              onPress={() => grantWithDuration('comp_pro')}
              testID="gift-pro"
            >
              <Sparkles size={13} color={colors.textInverse} />
              <Text style={styles.giftBtnTxt}>Gift complimentary Pro…</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.giftBtn, { backgroundColor: colors.primary }]}
              onPress={() => grantWithDuration('comp_elite')}
              testID="gift-elite"
            >
              <Crown size={13} color={colors.textInverse} />
              <Text style={styles.giftBtnTxt}>Gift complimentary Elite…</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.helper}>
            Comp/trial plans override billing. Pick an expiry (30 / 90 / 365 days or never). Stripe is
            not wired — this sets the tier immediately.
          </Text>
        </Section>

        {/* Account actions */}
        <Section title="Account actions">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <ActionBtn
              icon={<Sparkles size={14} color={colors.textInverse} />}
              label={u.verification_status === 'verified' ? 'Remove verification' : 'Verify contributor'}
              onPress={toggleVerify}
              color={u.verification_status === 'verified' ? colors.secondary : colors.info}
              testID="action-verify"
            />
            <ActionBtn
              icon={<UserX size={14} color={colors.textInverse} />}
              label={u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
              onPress={toggleSuspend}
              color={u.status === 'suspended' ? colors.success : colors.secondary}
              testID="action-suspend"
            />
          </View>
        </Section>

        {/* Role controls — super admin only */}
        <Section
          title="Role"
          right={isSuperAdmin ? undefined : <Text style={styles.lockTxt}>super_admin only</Text>}
        >
          <View style={styles.chipGrid}>
            {ROLE_OPTIONS.map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => requestRoleChange(r)}
                style={[
                  styles.optChip,
                  u.role === r && styles.optChipActive,
                  (!isSuperAdmin || isSelf) && { opacity: 0.4 },
                ]}
                disabled={!isSuperAdmin || isSelf}
                testID={`role-${r}`}
              >
                <Text style={[styles.optChipTxt, u.role === r && styles.optChipTxtActive]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.warn}>
            <AlertTriangle size={13} color={colors.warning} />
            <Text style={styles.warnTxt}>
              Admins gain access to private moderation systems and audit logs. Promote carefully.
            </Text>
          </View>
        </Section>

        {/* Notes */}
        <Section title="Internal notes">
          <View style={styles.noteInputRow}>
            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Add a private note about this user…"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={styles.noteInput}
              testID="note-input"
            />
            <TouchableOpacity style={styles.noteBtn} onPress={addNote} testID="note-submit">
              <MessageSquarePlus size={14} color={colors.textInverse} />
              <Text style={styles.noteBtnTxt}>Add</Text>
            </TouchableOpacity>
          </View>
          <View style={{ gap: 8, marginTop: 6 }}>
            {(u.notes || []).length === 0 && <Text style={styles.empty}>No internal notes yet.</Text>}
            {(u.notes || []).map((n: any) => (
              <View key={n.note_id} style={styles.noteCard}>
                <Text style={styles.noteMeta}>
                  {n.author_email || 'staff'} · {new Date(n.created_at).toLocaleDateString()}
                </Text>
                <Text style={styles.noteBody}>{n.body}</Text>
              </View>
            ))}
          </View>
        </Section>

        {/* Audit trail */}
        <Section title="Admin activity" right={<History size={14} color={colors.textSecondary} />}>
          {(u.recent_audit || []).length === 0 && <Text style={styles.empty}>No admin activity logged for this user yet.</Text>}
          {(u.recent_audit || []).map((a: any) => (
            <View key={a.audit_id} style={styles.auditRow}>
              <Text style={styles.auditAction}>{a.action}</Text>
              <Text style={styles.auditMeta}>
                by {a.admin_email || a.admin_user_id} · {new Date(a.created_at).toLocaleString()}
              </Text>
              {a.notes && <Text style={styles.auditNotes}>“{a.notes}”</Text>}
            </View>
          ))}
        </Section>

        {/* Danger zone — super_admin only */}
        {isSuperAdmin && !isSelf && u.status !== 'deleted' && (
          <View style={styles.dangerZone}>
            <View style={styles.dangerHead}>
              <AlertTriangle size={14} color={colors.secondary} />
              <Text style={styles.dangerTitle}>Danger zone — super admin</Text>
            </View>
            <Text style={styles.dangerBody}>
              Permanently soft-deletes the account. Public content (spots, community posts, comments)
              will remain but be attributed to “Deleted user”. Login is blocked, PII is wiped, and the
              active Stripe subscription (if any) is cancelled. This action cannot be undone from the app.
            </Text>
            <TouchableOpacity
              style={styles.dangerBtn}
              onPress={() => setDeleteOpen(true)}
              testID="super-delete-user"
            >
              <Trash2 size={14} color="#fff" />
              <Text style={styles.dangerBtnTxt}>Delete user account</Text>
            </TouchableOpacity>
          </View>
        )}
        {u.status === 'deleted' && (
          <View style={styles.deletedBadge}>
            <Trash2 size={14} color={colors.textTertiary} />
            <Text style={styles.deletedTxt}>Account already deleted.</Text>
          </View>
        )}
      </ScrollView>

      {/* Role change confirmation modal */}
      <Modal visible={!!roleModal} transparent animationType="slide" onRequestClose={() => setRoleModal(null)}>
        <Pressable style={styles.modalBg} onPress={() => setRoleModal(null)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHead}>
            <ShieldCheck size={18} color={colors.primary} />
            <Text style={styles.modalTitle}>Confirm role change</Text>
            <TouchableOpacity onPress={() => setRoleModal(null)} hitSlop={12}>
              <X size={18} color={colors.text} />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalBody}>
            You are about to change <Text style={{ color: colors.text, fontFamily: font.bodySemibold }}>{u.name}</Text>'s role to{' '}
            <Text style={{ color: colors.primary, fontFamily: font.bodyBold }}>{roleModal}</Text>.
            {'\n\n'}Admins gain access to private moderation systems. Type the role below to confirm.
          </Text>
          <TextInput
            value={roleConfirm}
            onChangeText={setRoleConfirm}
            placeholder={roleModal || ''}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            style={styles.modalInput}
            testID="role-confirm-input"
          />
          <TouchableOpacity
            style={[styles.modalConfirm, roleConfirm !== roleModal && { opacity: 0.4 }]}
            disabled={roleConfirm !== roleModal}
            onPress={submitRoleChange}
            testID="role-confirm-submit"
          >
            <Crown size={16} color={colors.textInverse} />
            <Text style={styles.modalConfirmTxt}>Promote to {roleModal}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <DeleteConfirmSheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={submitDelete}
        title="Delete user account?"
        warning="This soft-deletes the account: PII is wiped, login is blocked, Stripe subscription is cancelled, and public content is re-attributed to 'Deleted user'. Cannot be undone in the app."
        targetLabel={`${u.name}  ·  @${u.username || u.user_id}  ·  ${u.email}`}
        confirmPhrase="delete"
        presets={USER_DELETE_PRESETS}
        destructiveCta="Delete this account"
      />
    </KeyboardAvoidingView>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function StatsGrid({ u }: { u: any }) {
  const stats = [
    { label: 'Spots',     value: u.spot_count },
    { label: 'Saves',     value: u.save_count },
    { label: 'Reports',   value: u.open_reports },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {stats.map((s) => (
        <View key={s.label} style={styles.stat}>
          <Text style={styles.statVal}>{s.value ?? 0}</Text>
          <Text style={styles.statLabel}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{
      backgroundColor: color + '22', borderColor: color, borderWidth: 1,
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill,
    }}>
      <Text style={{ color, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

function ActionBtn({ icon, label, onPress, color, testID }: { icon: React.ReactNode; label: string; onPress: () => void; color: string; testID?: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.actBtn, { backgroundColor: color }]} testID={testID}>
      {icon}
      <Text style={styles.actTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md, backgroundColor: colors.surface1, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  name: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  stat: { flex: 1, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, padding: space.md, borderRadius: radii.md, alignItems: 'center' },
  statVal: { color: colors.text, fontFamily: font.display, fontSize: 26, letterSpacing: -0.3 },
  statLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  section: { gap: space.sm, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, padding: space.md, borderRadius: radii.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  lockTxt: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 10 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  optChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  optChipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  optChipTxtActive: { color: colors.textInverse, fontFamily: font.bodySemibold },
  helper: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 4 },
  giftBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.info, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md,
  },
  giftBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: 'rgba(251,191,36,0.08)', padding: 8, borderRadius: radii.md, borderColor: colors.warning, borderWidth: 1, marginTop: 6 },
  warnTxt: { flex: 1, color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  actBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.md },
  actTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 13 },
  noteInputRow: { flexDirection: 'row', gap: 8 },
  noteInput: { flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 10, color: colors.text, fontFamily: font.body, fontSize: 13, minHeight: 60, textAlignVertical: 'top' },
  noteBtn: { backgroundColor: colors.primary, paddingHorizontal: 12, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', gap: 4, flexDirection: 'row', alignSelf: 'flex-start', paddingVertical: 10 },
  noteBtnTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 12 },
  noteCard: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, padding: 10, borderRadius: radii.md },
  noteMeta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10 },
  noteBody: { color: colors.text, fontFamily: font.body, fontSize: 13, marginTop: 4, lineHeight: 18 },
  empty: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12 },
  auditRow: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 2 },
  auditAction: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  auditMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  auditNotes: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, fontStyle: 'italic' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface1, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.xl, gap: 10 },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalTitle: { flex: 1, color: colors.text, fontFamily: font.display, fontSize: 20 },
  modalBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19 },
  modalInput: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 12, color: colors.text, fontFamily: font.bodyMedium, fontSize: 14 },
  modalConfirm: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radii.md, marginTop: 6, marginBottom: 20 },
  modalConfirmTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 14 },
});
