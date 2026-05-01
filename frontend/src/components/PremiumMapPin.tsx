/**
 * PremiumMapPin & PremiumMapCluster — branded Apple-quality marker
 * visuals for the Explore tab map.
 *
 *   · PremiumMapPin   — gold ring + matte black center + white camera
 *                        glyph. Accepts `tier` to switch to elite purple,
 *                        trending orange-pulse, or saved blue-fill.
 *   · PremiumMapCluster — glowing gold disc with the cluster count in
 *                          the center. Has a soft pulsing outer ring.
 *
 * Both rendered inside react-native-maps' <Marker> children so the visual
 * is a real React Native View tree (free interactions, no PNG export).
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Camera, Bookmark, Gem, Flame } from 'lucide-react-native';
import { colors, font } from '../theme';

export type PinTier = 'default' | 'elite' | 'trending' | 'saved' | 'verified-proven' | 'low';

export function pinTierOf(spot: any): PinTier {
  const verified = spot?.owner?.verification_status === 'verified';
  const premium = spot?.privacy_mode === 'premium';
  const proven =
    (spot?.shoot_score || 0) >= 80 && (spot?.images?.length || 0) >= 3;
  const trending = !!spot?.is_trending;
  const saved = !!spot?.is_saved;
  if (saved) return 'saved';
  if (premium) return 'elite';
  if (trending) return 'trending';
  if (verified && proven) return 'verified-proven';
  if ((spot?.shoot_score || 0) < 60) return 'low';
  return 'default';
}

// ============================================================================
// Premium single-spot pin
// ============================================================================
function PremiumMapPinInner({ tier = 'default' }: { tier?: PinTier }) {
  // Soft pulse animation for trending / elite tiers
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (tier !== 'trending' && tier !== 'elite') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [tier, pulse]);

  const ringColor =
    tier === 'elite' ? '#9D59FF' :
    tier === 'trending' ? '#F97316' :
    tier === 'saved' ? '#60A5FA' :
    tier === 'verified-proven' ? '#22c55e' :
    tier === 'low' ? '#6B7280' :
    colors.primary;

  const showPulse = tier === 'trending' || tier === 'elite';
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  // Center glyph swap by tier
  const Glyph = tier === 'saved' ? Bookmark : tier === 'elite' ? Gem : tier === 'trending' ? Flame : Camera;
  const glyphColor =
    tier === 'saved' ? '#fff' :
    tier === 'elite' ? '#fff' :
    tier === 'trending' ? '#fff' :
    '#fff';

  return (
    <View style={styles.pinWrap}>
      {showPulse ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pulseRing,
            {
              borderColor: ringColor,
              transform: [{ scale: pulseScale }],
              opacity: pulseOpacity,
            },
          ]}
        />
      ) : null}
      <View style={[styles.pinRing, { borderColor: ringColor, shadowColor: ringColor }]}>
        <View
          style={[
            styles.pinCenter,
            tier === 'saved' && { backgroundColor: '#1E40AF' },
            tier === 'elite' && { backgroundColor: '#3a1f5e' },
            tier === 'trending' && { backgroundColor: '#7c2d12' },
          ]}
        >
          <Glyph size={11} color={glyphColor} strokeWidth={2.4} />
        </View>
      </View>
      {/* Stem — subtle drop shadow under the pin */}
      <View style={styles.pinStem} />
    </View>
  );
}

// ============================================================================
// Premium cluster pin (gold glow + count)
// ============================================================================
// ============================================================================
// Premium cluster pin (count badge)
// ============================================================================
function PremiumMapClusterInner({ count }: { count: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Batch #9 — tighter size curve so a cluster of 10 doesn't read as big
  // as one of 500, and a micro outdoor readability bump via textShadow.
  // Range stays 28-52px; range of counts 2..500+ is mapped smoothly.
  const size = Math.min(52, 26 + Math.log2(Math.max(2, count)) * 4.5);
  // 99+ overflow so 3-digit counts stay legible inside the disc.
  const label = count > 99 ? '99+' : String(count);
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <View style={[styles.clusterWrap, { width: size + 16, height: size + 16 }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.clusterPulse,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            transform: [{ scale: pulseScale }],
            opacity: pulseOpacity,
          },
        ]}
      />
      <View
        style={[
          styles.clusterDisc,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
      >
        <Text
          style={[
            styles.clusterTxt,
            // Shrink font just slightly when displaying "99+" so the glyphs
            // don't crowd the disc edge.
            { fontSize: label.length > 2 ? 11 : size > 40 ? 14 : 12 },
          ]}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================
const styles = StyleSheet.create({
  pinWrap: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pulseRing: {
    position: 'absolute',
    top: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
  },
  pinRing: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2.5,
    backgroundColor: '#0c0c10',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.55,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  pinCenter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1c1c22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinStem: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
    marginTop: -2,
  },
  // Cluster
  clusterWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterPulse: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(245,166,35,0.8)',
    backgroundColor: 'rgba(245,166,35,0.18)',
  },
  clusterDisc: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#1a1300',
    shadowColor: colors.primary,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  clusterTxt: {
    color: '#1a1300',
    fontFamily: font.bodyBold,
    letterSpacing: 0.2,
    // Batch #9 — subtle highlight stroke for outdoor sunlight readability.
    // Gold-on-dark is already high-contrast; the warm cream highlight adds
    // just enough glow to the digits so they stay crisp on bright sun.
    textShadowColor: 'rgba(255,235,200,0.55)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 1,
  },
});

// ============================================================================
// Memoized exports — Explore Speed CR — Batch 3 (June 2025)
// ----------------------------------------------------------------------------
// PremiumMapPin and PremiumMapCluster get re-mounted on every map gesture
// because react-native-map-clustering re-creates the Marker children list
// per region change. Wrapping the inner components in React.memo with a
// shallow prop comparator keeps the visual tree stable across pan/zoom —
// the JS bridge has to ferry far fewer prop diffs to the native side,
// which is the single biggest frame-budget win on Android maps.
// ============================================================================
export const PremiumMapPin = React.memo(
  PremiumMapPinInner,
  (prev, next) => prev.tier === next.tier,
);
export const PremiumMapCluster = React.memo(
  PremiumMapClusterInner,
  (prev, next) => prev.count === next.count,
);

