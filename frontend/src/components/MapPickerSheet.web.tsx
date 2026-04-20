import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { X } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

/**
 * Web stub for MapPickerSheet — react-native-maps has native-only deps that
 * cannot be bundled for the web target. This placeholder renders a friendly
 * message and lets the user close the sheet. The real map picker is the
 * sibling MapPickerSheet.tsx file, picked up automatically by Metro for
 * iOS/Android platforms.
 */
export default function MapPickerSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (pin: any) => void;
  initial?: { latitude: number; longitude: number } | null;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.bg}>
        <View style={styles.card}>
          <TouchableOpacity onPress={onClose} style={styles.close} testID="map-picker-close">
            <X size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Map picker unavailable on web</Text>
          <Text style={styles.body}>
            To drop a pin on the map, please use the LumaScout mobile app (iOS or Android).
            You can still search for a city, use GPS, or enter an address manually on web.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={onClose}>
            <Text style={styles.btnTxt}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: colors.surface1, borderRadius: radii.lg,
    padding: space.xl, borderWidth: 1, borderColor: colors.border, gap: space.md,
  },
  close: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
  body: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, lineHeight: 20 },
  btn: { marginTop: space.sm, backgroundColor: colors.primary, borderRadius: radii.md, paddingVertical: 12, alignItems: 'center' },
  btnTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 14 },
});
