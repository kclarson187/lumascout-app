/**
 * DescriptionEditorSheet — admin-only inline description editor.
 * ─────────────────────────────────────────────────────────────────
 * May 2026 — surfaces a clean modal that lets admins / super_admins
 * rewrite a spot's description in-place. The component is
 * intentionally narrow:
 *   • single-field PATCH (`/api/admin/spots/<id>/description`)
 *   • optimistic update via the parent's `setSpot`
 *   • cancel / save controls follow the existing modal-sheet pattern
 *     used by the report and add-to-collection sheets so the visual
 *     language stays consistent.
 *
 * Why a sheet (not inline)?
 *   Inline edit on a tappable text block is a UX trap on mobile —
 *   accidental text-selection vs. tap-to-edit conflicts. A modal
 *   sheet gives us a real keyboard avoidance host, a multi-line
 *   text input that auto-grows, and an unambiguous Save / Cancel
 *   contract.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Save } from 'lucide-react-native';
import { api, formatApiError } from '../../api';
import { colors, font, space, radii } from '../../theme';

const MAX_LEN = 4000;

type Props = {
  visible: boolean;
  spotId: string;
  spotTitle?: string;
  initialValue: string;
  onClose: () => void;
  // Called with the cleaned, server-confirmed value so the parent can
  // optimistically merge into local state without a refetch.
  onSaved: (newDescription: string | null) => void;
};

export default function DescriptionEditorSheet({
  visible,
  spotId,
  spotTitle,
  initialValue,
  onClose,
  onSaved,
}: Props) {
  const [text, setText] = useState(initialValue || '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Reset draft every time the sheet re-opens — prevents stale text
  // from a prior session leaking into a different spot.
  useEffect(() => {
    if (visible) {
      setText(initialValue || '');
      setSaving(false);
      // Auto-focus after the modal animates in (~200ms on iOS).
      const t = setTimeout(() => inputRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
  }, [visible, initialValue]);

  const dirty = (text || '').trim() !== (initialValue || '').trim();
  const overLimit = text.length > MAX_LEN;
  const canSave = dirty && !overLimit && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      const res = await api.patch(`/admin/spots/${spotId}/description`, {
        description: text,
      });
      const next = (res?.data?.description ?? null) as string | null;
      onSaved(next);
      onClose();
    } catch (e: any) {
      Alert.alert('Couldn\'t save description', formatApiError(e) || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    if (dirty) {
      Alert.alert(
        'Discard changes?',
        'Your edits to this description haven\'t been saved.',
        [
          { text: 'Keep editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => { setText(initialValue || ''); onClose(); },
          },
        ],
      );
      return;
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.kav}
        >
          <SafeAreaView edges={['bottom']} style={s.sheet}>
            <View style={s.handle} />
            <View style={s.header}>
              <View style={{ flex: 1 }}>
                <Text style={s.kicker}>ADMIN · DESCRIPTION</Text>
                <Text style={s.title} numberOfLines={1}>
                  {spotTitle || 'Edit description'}
                </Text>
              </View>
              <TouchableOpacity onPress={handleClose} hitSlop={10} disabled={saving}>
                <X color={colors.textSecondary} size={22} />
              </TouchableOpacity>
            </View>

            <TextInput
              ref={inputRef}
              style={s.input}
              value={text}
              onChangeText={setText}
              multiline
              textAlignVertical="top"
              placeholder="What makes this spot special? Light, season, parking tips, anything photographers should know."
              placeholderTextColor={colors.textTertiary}
              maxLength={MAX_LEN + 200 /* soft pad so paste of 4001 still pastes; we hard-cap on save */}
              editable={!saving}
              testID="spot-desc-edit-input"
            />

            <View style={s.footerRow}>
              <Text
                style={[
                  s.counter,
                  overLimit && { color: colors.danger },
                ]}
              >
                {text.length} / {MAX_LEN}
              </Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={handleClose} style={s.cancelBtn} disabled={saving}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
                disabled={!canSave}
                testID="spot-desc-edit-save"
              >
                {saving ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <>
                    <Save color={colors.textInverse} size={16} />
                    <Text style={s.saveTxt}>Save</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  kav: { width: '100%' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    // Lift the sheet visually above the dimmed backdrop.
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -4 },
      },
      android: { elevation: 16 },
      default: {},
    }),
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  kicker: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 2,
  },
  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 18 },
  input: {
    minHeight: 200,
    maxHeight: 360,
    color: colors.text,
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 22,
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
  },
  counter: {
    color: colors.textTertiary,
    fontFamily: font.body,
    fontSize: 12,
  },
  cancelBtn: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  cancelTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 14 },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    minHeight: 40,
    minWidth: 88,
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
});
