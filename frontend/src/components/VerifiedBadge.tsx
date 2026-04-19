import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BadgeCheck } from 'lucide-react-native';
import { colors, font, radii } from '../theme';

/**
 * Small reusable pill showing a user's verification status.
 * Only renders something when status === 'verified'.
 *
 * variants:
 *  - 'chip'    (default) — pill with icon + 'Verified' text
 *  - 'inline'  — just the check icon (for use next to a name)
 *  - 'compact' — icon + short 'VERIFIED' label (tight)
 */
export default function VerifiedBadge({
  status,
  variant = 'chip',
  size = 12,
}: {
  status?: string;
  variant?: 'chip' | 'inline' | 'compact';
  size?: number;
}) {
  if (status !== 'verified') return null;

  if (variant === 'inline') {
    return <BadgeCheck size={size} color={colors.info} fill={colors.info} strokeWidth={0} />;
  }

  if (variant === 'compact') {
    return (
      <View style={[styles.pill, styles.pillCompact]}>
        <BadgeCheck size={size} color={colors.textInverse} strokeWidth={2.5} />
        <Text style={styles.compactTxt}>VERIFIED</Text>
      </View>
    );
  }

  return (
    <View style={styles.pill}>
      <BadgeCheck size={size + 2} color={colors.textInverse} strokeWidth={2.5} />
      <Text style={styles.txt}>Verified</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.info,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  pillCompact: { paddingHorizontal: 6, paddingVertical: 2 },
  txt: {
    color: colors.textInverse,
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 0.4,
  },
  compactTxt: {
    color: colors.textInverse,
    fontFamily: font.bodyBold,
    fontSize: 9,
    letterSpacing: 0.5,
  },
});
