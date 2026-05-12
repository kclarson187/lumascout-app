/**
 * AppleSoonButton — "Continue with Apple — Coming soon" stub.
 *
 * Phase 1 onboarding ships without SIWA wired (no app.json capability
 * change, no Apple Portal config, no backend SIWA verification). The
 * button is rendered for visual completeness (especially on iOS where
 * users expect Apple Sign-In first) but is intentionally non-blocking:
 * tapping it shows a one-line toast and never crashes the app.
 */
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Platform, View, ToastAndroid, Alert } from 'react-native';
import { colors, font, space, radii } from '../theme';

function notifyComingSoon() {
  const msg = 'Apple Sign-In is coming soon. Use Google or Email for now.';
  if (Platform.OS === 'android') {
    ToastAndroid.show(msg, ToastAndroid.SHORT);
  } else {
    Alert.alert('Coming soon', msg);
  }
}

export function AppleSoonButton({ testID = 'apple-soon' }: { testID?: string }) {
  return (
    <TouchableOpacity
      onPress={notifyComingSoon}
      style={styles.btn}
      activeOpacity={0.7}
      testID={testID}
    >
      <View style={styles.row}>
        <Text style={styles.glyph}></Text>
        <Text style={styles.label}>Continue with Apple</Text>
      </View>
      <View style={styles.soonBadge}>
        <Text style={styles.soonTxt}>SOON</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, paddingHorizontal: space.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md,
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  glyph: { color: colors.text, fontSize: 18 },
  label: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 15 },
  soonBadge: {
    marginLeft: 6,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderColor: 'rgba(245,166,35,0.35)', borderWidth: 1,
  },
  soonTxt: {
    color: colors.primary, fontFamily: font.bodyBold, fontSize: 9,
    letterSpacing: 0.6,
  },
});
