import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { AlertTriangle, Trash2, X } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

export type DeletePreset = { code: string; label: string };

export const SPOT_DELETE_PRESETS: DeletePreset[] = [
  { code: 'policy_violation', label: 'Policy violation' },
  { code: 'duplicate',        label: 'Duplicate spot' },
  { code: 'spam',             label: 'Spam / promotional' },
  { code: 'low_quality',      label: 'Low quality / not a real spot' },
  { code: 'user_requested',   label: 'User requested removal' },
  { code: 'other',            label: 'Other (explain below)' },
];

export const USER_DELETE_PRESETS: DeletePreset[] = [
  { code: 'policy_violation', label: 'Policy violation' },
  { code: 'spam_network',     label: 'Spam / fake network' },
  { code: 'duplicate',        label: 'Duplicate account' },
  { code: 'inactive',         label: 'Inactive / stale' },
  { code: 'user_requested',   label: 'User requested deletion' },
  { code: 'other',            label: 'Other (explain below)' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (reasonCode: string | null, reasonNote: string) => Promise<void> | void;
  title: string;
  warning: string;
  targetLabel: string;              // e.g. "Spot: Balboa Park" or "User: @sophie"
  confirmPhrase: string;             // user must type this exactly (case-insensitive)
  presets: DeletePreset[];
  destructiveCta: string;            // e.g. "Delete spot permanently"
};

export default function DeleteConfirmSheet({
  visible, onClose, onConfirm, title, warning, targetLabel,
  confirmPhrase, presets, destructiveCta,
}: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return (confirm.trim().toLowerCase() === confirmPhrase.toLowerCase()) && !busy;
  }, [confirm, confirmPhrase, busy]);

  const reset = () => { setCode(null); setNote(''); setConfirm(''); setErr(null); setBusy(false); };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      await onConfirm(code, note.trim());
      reset();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Could not complete the delete. Please try again.');
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;  // prevent dismiss while the API call is in flight
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable style={styles.bg} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={styles.warnBubble}>
              <AlertTriangle size={18} color={colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.target} numberOfLines={2}>{targetLabel}</Text>
            </View>
            <TouchableOpacity onPress={close} hitSlop={12} disabled={busy}>
              <X size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingBottom: 12 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.warn}>{warning}</Text>

            <Text style={styles.label}>Reason (optional)</Text>
            <View style={styles.chips}>
              {presets.map((p) => (
                <TouchableOpacity
                  key={p.code}
                  style={[styles.chip, code === p.code && styles.chipActive]}
                  onPress={() => setCode((prev) => (prev === p.code ? null : p.code))}
                  disabled={busy}
                >
                  <Text style={[styles.chipTxt, code === p.code && styles.chipTxtActive]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.note}
              value={note}
              onChangeText={setNote}
              placeholder="Add context (optional) — visible in audit log."
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={500}
              editable={!busy}
            />

            <Text style={[styles.label, { marginTop: space.md }]}>
              Type <Text style={{ color: colors.secondary, fontFamily: font.bodyBold }}>{confirmPhrase}</Text> to confirm
            </Text>
            <TextInput
              style={styles.confirmInput}
              value={confirm}
              onChangeText={setConfirm}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={confirmPhrase}
              placeholderTextColor={colors.textTertiary}
              editable={!busy}
            />

            {err && (
              <View style={styles.errBox}>
                <Text style={styles.errTxt}>{err}</Text>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.cta, (!canSubmit) && { opacity: 0.4 }]}
            onPress={submit}
            disabled={!canSubmit}
            testID="delete-confirm-submit"
          >
            {busy ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <>
                <Trash2 size={16} color={colors.textInverse} />
                <Text style={styles.ctaTxt}>{destructiveCta}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: space.xl,
    maxHeight: '90%',
    borderTopWidth: 2, borderColor: 'rgba(255,64,90,0.35)',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: space.md },
  warnBubble: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,64,90,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,64,90,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: colors.text, fontFamily: font.display, fontSize: 19, letterSpacing: -0.3 },
  target: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12, marginTop: 2 },
  warn: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19,
    backgroundColor: 'rgba(255,64,90,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,64,90,0.25)',
    padding: 10, borderRadius: radii.md,
    marginBottom: space.md,
  },
  label: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  chipTxtActive: { color: '#fff', fontFamily: font.bodySemibold },
  note: {
    marginTop: 8,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
    paddingHorizontal: 12, paddingVertical: 10,
    color: colors.text, fontFamily: font.body, fontSize: 13,
    minHeight: 70, textAlignVertical: 'top',
  },
  confirmInput: {
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.secondary, borderRadius: radii.md,
    paddingHorizontal: 12, paddingVertical: 12,
    color: colors.text, fontFamily: font.bodySemibold, fontSize: 14,
  },
  errBox: {
    marginTop: 10, padding: 10, borderRadius: radii.md,
    backgroundColor: 'rgba(255,64,90,0.1)', borderWidth: 1, borderColor: colors.secondary,
  },
  errTxt: { color: colors.secondary, fontFamily: font.body, fontSize: 12 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.secondary, paddingVertical: 15, borderRadius: radii.md,
    marginTop: space.sm,
  },
  ctaTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
});
