/**
 * <FoundingScoutBadge /> — premium honorary-role badge.
 *
 * Wraps the uploaded `assets/badges/founding_scout.png` artwork as a
 * fixed-aspect-ratio image component. The source art is the canonical
 * visual for the `founding_scout` role and shows up on:
 *   • Profile header
 *   • User cards
 *   • Post / comment author row
 *   • Admin user detail screen
 *   • Super Admin role hierarchy / role detail view
 *   • Role selector chip in admin UI
 *
 * Size presets keep the badge crisp on dark backgrounds across surfaces
 * (transparent PNG, preserve aspect) — never stretch or distort it.
 *
 *   sm  → 20px  (inline next to a username / comment author)
 *   md  → 28px  (chips, list rows, role selectors)
 *   lg  → 56px  (profile header, role hierarchy cards)
 *   xl  → 96px  (role detail view, onboarding splash)
 */
import React from 'react';
import { Image, View, StyleSheet, ImageProps } from 'react-native';

export type FoundingScoutBadgeSize = 'sm' | 'md' | 'lg' | 'xl' | number;

const SIZE_MAP: Record<Exclude<FoundingScoutBadgeSize, number>, number> = {
  sm: 20,
  md: 28,
  lg: 56,
  xl: 96,
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BADGE_ART = require('../../assets/badges/founding_scout.png');

export default function FoundingScoutBadge({
  size = 'md',
  style,
  accessible = true,
  testID,
  ...rest
}: {
  size?: FoundingScoutBadgeSize;
  style?: ImageProps['style'];
  accessible?: boolean;
  testID?: string;
} & Omit<ImageProps, 'source' | 'style'>) {
  const px = typeof size === 'number' ? size : SIZE_MAP[size];
  return (
    <View
      style={[styles.wrap, { width: px, height: px }]}
      accessibilityRole={accessible ? 'image' : 'none'}
      accessibilityLabel={accessible ? 'Founding Scout badge' : undefined}
      testID={testID || 'founding-scout-badge'}
    >
      <Image
        source={BADGE_ART}
        // The artwork is ~1:1 but has a drop-shadow baked in — we
        // render into a square container at natural aspect via
        // resizeMode=contain so the shadow doesn't clip on any surface.
        resizeMode="contain"
        style={[{ width: '100%', height: '100%' }, style]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    // Transparent background so the badge drops cleanly on dark, black,
    // and navy surfaces alike.
    backgroundColor: 'transparent',
  },
});
