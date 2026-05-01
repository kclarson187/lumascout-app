/**
 * SkeletonSpotCard — premium dark-mode skeleton placeholder.
 *
 * Used by the Explore list initial-load state in place of a blank
 * screen / centered spinner. Animates a subtle gold shimmer across
 * a card-shaped surface so the user immediately understands "spots
 * are coming" without staring at a void.
 *
 * Added: Explore Speed CR — Batch 2 (June 2025).
 *
 * Dimensions match SpotCard's outer footprint (≈ 220px image area +
 * 80px metadata strip) so the layout doesn't reflow when real cards
 * stream in. We intentionally keep the markup lightweight — no
 * gradients, no nested LinearGradients, no cascading opacity layers
 * — because rendering 6+ skeleton cards has to be CHEAPER than the
 * spinner it's replacing or we've defeated the purpose.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, font, radii, space } from '../theme';

export default function SkeletonSpotCard() {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);
  const opacity = shimmer.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.35, 0.9, 0.35],
  });

  return (
    <View style={s.card} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[s.image, { opacity }]} />
      <View style={s.meta}>
        <Animated.View style={[s.line, s.lineTitle, { opacity }]} />
        <Animated.View style={[s.line, s.lineSub, { opacity }]} />
        <View style={s.chipRow}>
          <Animated.View style={[s.chip, { opacity }]} />
          <Animated.View style={[s.chip, { opacity }]} />
        </View>
      </View>
    </View>
  );
}

/**
 * SkeletonSpotList — convenience wrapper that renders N skeleton
 * cards stacked. Default 6 ≈ one phone screen of cards.
 */
export function SkeletonSpotList({ count = 6 }: { count?: number }) {
  return (
    <View style={{ paddingHorizontal: 12, gap: space.md }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonSpotCard key={`sk-${i}`} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    // Layout-jump fix (May 2026): match SpotCard's 4:5 aspect EXACTLY so
    // the skeleton → real-card swap is dimension-stable. Previously the
    // skeleton used 16:10 which was wider/shorter, causing visible
    // "oversized image" flash when the first real 4:5 SpotCard streamed
    // in and pushed the layout taller.
    aspectRatio: 4 / 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  meta: {
    paddingVertical: 12,
    paddingHorizontal: space.md,
    gap: 8,
  },
  line: {
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  lineTitle: { width: '70%' },
  lineSub: { width: '45%', height: 10 },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    width: 60,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
