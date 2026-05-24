/**
 * PostSaveSpotSheet — Phase 2 of the Park-Based Multi-Spot Workflow.
 *
 * Shown after a successful spot submission. Replaces the single OK
 * alert with a quick-action card so a photographer in the field can
 * keep adding spots inside the same park, or save & close without
 * losing the session.
 *
 * Actions:
 *   • Standalone spot: Done · View spot
 *   • Park child:      Add another in this park · View park · Save & close · End session
 */
import React from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, Pressable, Platform,
} from 'react-native';
import { MapPin, Plus, Check, Eye, X } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

type Props = {
  visible: boolean;
  parkName?: string | null;
  parkId?: string | null;
  newSpotId?: string | null;
  onAddAnother: () => void;
  onViewPark: () => void;
  onViewSpot: () => void;
  onSaveAndClose: () => void;
  onEndSession: () => void;
  onClose: () => void;
};

export default function PostSaveSpotSheet({
  visible, parkName, parkId, newSpotId,
  onAddAnother, onViewPark, onViewSpot, onSaveAndClose, onEndSession, onClose,
}: Props) {
  const isParkChild = !!parkId && !!parkName;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.checkIcon}>
            <Check size={20} color={colors.textInverse} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Spot saved</Text>
            {isParkChild ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                Added to {parkName}
              </Text>
            ) : (
              <Text style={styles.subtitle}>Your standalone spot is in.</Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} testID="postsave-close">
            <X size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {isParkChild ? (
          <View style={{ gap: 8, marginTop: space.md }}>
            <TouchableOpacity style={styles.primaryBtn} onPress={onAddAnother} testID="postsave-add-another">
              <Plus size={18} color={colors.textInverse} />
              <Text style={styles.primaryBtnTxt}>
                Add another spot in {parkName}
              </Text>
            </TouchableOpacity>

            <View style={styles.rowBtns}>
              <TouchableOpacity style={styles.ghostBtn} onPress={onViewPark} testID="postsave-view-park">
                <MapPin size={15} color={colors.text} />
                <Text style={styles.ghostBtnTxt}>View park</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostBtn} onPress={onSaveAndClose} testID="postsave-save-close">
                <Check size={15} color={colors.text} />
                <Text style={styles.ghostBtnTxt}>Save & close</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.endBtn} onPress={onEndSession} testID="postsave-end-session">
              <Text style={styles.endBtnTxt}>End park session</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: 8, marginTop: space.md }}>
            {newSpotId && (
              <TouchableOpacity style={styles.primaryBtn} onPress={onViewSpot} testID="postsave-view-spot">
                <Eye size={18} color={colors.textInverse} />
                <Text style={styles.primaryBtnTxt}>View spot</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.ghostBtnWide} onPress={onSaveAndClose} testID="postsave-done">
              <Text style={styles.ghostBtnTxt}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: space.xl, paddingBottom: Platform.OS === 'ios' ? 32 : space.xl,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  handle: {
    alignSelf: 'center',
    width: 38, height: 4, borderRadius: 2,
    backgroundColor: colors.border, marginBottom: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: colors.text, fontFamily: font.display, fontSize: 18 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  primaryBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },

  rowBtns: { flexDirection: 'row', gap: 8 },
  ghostBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  ghostBtnWide: {
    paddingVertical: 12, borderRadius: radii.md, alignItems: 'center',
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  ghostBtnTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },

  endBtn: { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  endBtnTxt: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 12 },
});
