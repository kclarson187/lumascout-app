/**
 * FeaturedBadge — Phase B.3 Elite status badge
 * Only renders when user.plan === 'elite'. Designed to mirror
 * VerifiedBadge so it can drop in next to a user's name anywhere.
 *
 * variants:
 *   'chip'    → gradient pill with "Featured" label
 *   'inline'  → star icon only (small, next to names)
 *   'compact' → tight "FEATURED" label with star
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';
import { colors, font, radii } from '../theme';

export default function FeaturedBadge({
  plan,
  variant = 'chip',
  size = 12,
}: {
  plan?: string;
  variant?: 'chip' | 'inline' | 'compact';
  size?: number;
}) {
  if (plan !== 'elite') return null;

  if (variant === 'inline') {
    return <Star size={size} color={colors.primary} fill={colors.primary} strokeWidth={0} />;
  }

  if (variant === 'compact') {
    return (
      <View style={[styles.pill, styles.pillCompact]}>
        <Star size={size - 2} color={colors.textInverse} fill={colors.textInverse} strokeWidth={0} />
        <Text style={styles.compactTxt}>FEATURED</Text>
      </View>
    );
  }

  return (
    <View style={styles.pill}>
      <Star size={size} color={colors.textInverse} fill={colors.textInverse} strokeWidth={0} />
      <Text style={styles.txt}>Featured Creator</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
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
