import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView } from 'react-native';
import { X, Flag, Check } from 'lucide-react-native';
import { api, formatApiError } from '../api';
import { colors, font, radii, space } from '../theme';
import { Button } from './Button';

export type ReportTargetType = 'spot' | 'user' | 'review';

const FALLBACK_REASONS = [
  { key: 'not_a_location', label: 'Not a real location' },
  { key: 'unsafe', label: 'Unsafe or private property' },
  { key: 'inappropriate', label: 'Inappropriate content' },
  { key: 'spam', label: 'Spam or promotional' },
  { key: 'wrong_info', label: 'Incorrect information' },
  { key: 'other', label: 'Something else' },
];

export default function ReportSheet({
  visible,
  onClose,
  targetType,
  targetId,
  onSubmitted,
  title }: {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  onSubmitted?: () => void;
  title?: string;
}) {
  const [reasons, setReasons] = useState(FALLBACK_REASONS);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // Reset state each time the sheet opens.
    setSelected(null);
    setDetails('');
    // Pull latest labels from backend if available.
    (async () => {
      try {
        const r = await api.get('/reports/reasons');
        if (Array.isArray(r) && r.length > 0) setReasons(r);
      } catch {}
    })();
  }, [visible]);

  const submit = async () => {
    if (!selected) {
      Alert.alert('Pick a reason', 'Tell us why you are reporting this.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/reports', {
        target_type: targetType,
        target_id: targetId,
        reason: selected,
        details: details.trim().slice(0, 500) });
      onSubmitted?.();
      onClose();
      Alert.alert('Report submitted', 'Thanks — our moderators will review this shortly.');
    } catch (e) {
      Alert.alert('Could not submit', formatApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.bg} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <View style={styles.iconWrap}><Flag size={18} color={colors.secondary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title || 'Report this spot'}</Text>
              <Text style={styles.subtitle}>Reports are anonymous to the contributor.</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12} testID="report-close">
              <X size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: space.xl, paddingTop: 4, gap: space.md }}>
            <Text style={styles.sectionLabel}>Reason</Text>
            <View style={{ gap: 8 }}>
              {reasons.map((r) => {
                const active = selected === r.key;
                return (
                  <TouchableOpacity
                    key={r.key}
                    onPress={() => setSelected(r.key)}
                    style={[styles.row, active && styles.rowActive]}
                    testID={`report-reason-${r.key}`}
                  >
                    <Text style={[styles.rowTxt, active && { color: colors.text }]}>{r.label}</Text>
                    {active && <Check size={18} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Details (optional)</Text>
            <TextInput
              value={details}
              onChangeText={setDetails}
              placeholder="Anything else we should know? (max 500 chars)"
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={500}
              style={styles.textArea}
              testID="report-details"
            />
            <Text style={styles.charCount}>{details.length}/500</Text>

            <Button
              title="Submit report"
              onPress={submit}
              loading={submitting}
              disabled={!selected}
              testID="report-submit"
              style={{ marginTop: space.sm }}
            />
            {submitting && <ActivityIndicator color={colors.primary} />}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheetWrap: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: space.xl },
  handle: {
    width: 44, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: space.sm,
    marginBottom: space.sm },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: space.xl, paddingBottom: space.sm },
  iconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(208,72,72,0.12)',
    alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  sectionLabel: {
    color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.md, paddingVertical: 14,
    borderRadius: radii.md, backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border },
  rowActive: { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.08)' },
  rowTxt: { flex: 1, color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 14 },
  textArea: {
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: space.md, paddingVertical: 12, borderRadius: radii.md,
    color: colors.text, fontFamily: font.body, fontSize: 14, minHeight: 90, textAlignVertical: 'top' },
  charCount: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, textAlign: 'right' } });
