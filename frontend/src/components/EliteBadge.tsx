/**
 * EliteBadge — compact inline gold pill for Elite photographers.
 *
 * Two variants per the PRD:
 *   - `compact`  : tiny inline pill used beside names in inbox rows.
 *   - `soft`     : slightly larger, used in home inbox preview cards.
 *
 * Intentionally NOT the huge profile-page badge; that is a separate
 * component (VerifiedBadge.tsx / existing profile UI). This is prestige
 * without clutter.
 *
 * Tier 1 Messaging Upgrade (2026-04).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { font } from '../theme';

export default function EliteBadge({
  variant = 'compact',
  testID,
}: {
  variant?: 'compact' | 'soft';
  testID?: string;
}) {
  const isCompact = variant === 'compact';
  return (
    <View
      testID={testID || 'elite-badge'}
      style={[
        styles.base,
        isCompact ? styles.compact : styles.soft,
      ]}
    >
      <Text
        style={[
          styles.txt,
          isCompact ? styles.txtCompact : styles.txtSoft,
        ]}
      >
        ELITE
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245,166,35,0.55)',
    // Subtle gold glow — boxShadow is hint-only; native renders via shadow*
    shadowColor: '#f5a623',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  compact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  soft: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  txt: {
    color: '#f5a623',
    fontFamily: font.bodyBold,
    letterSpacing: 0.9,
  },
  txtCompact: { fontSize: 8 },
  txtSoft: { fontSize: 9 },
});
