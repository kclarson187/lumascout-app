/**
 * UserBadge — global identity badge displayed next to a user's name everywhere.
 *
 * Priority (highest first):
 *   1. role === 'super_admin'                → Founder.png (LumaScout founder)
 *   2. role === 'admin' || 'moderator'       → Moderator.png
 *   3. role === 'founding_scout'             → Founding Scout PNG (honorary)
 *   4. plan elite (incl. comp_elite/trial)   → Elite gold compass PNG (animated pulse)
 *   5. plan pro (incl. comp_pro/trial_pro)   → Pro silver compass PNG (static)
 *   6. otherwise                              → null (no badge)
 *
 * Variants:
 *   - 'inline'   : tightest size, inline next to a username (default 14)
 *   - 'compact'  : ~16, used on followers/inbox rows
 *   - 'header'   : ~22, used on profile headers
 *
 * All membership badges are rendered as transparent PNGs at the same
 * dimensions for visual rhythm, with `resizeMode="contain"` and no
 * background fill so transparency holds on any surface.
 *
 * Elite badge gets a subtle scale + glow pulse via reanimated; Pro stays
 * crisp & static for a "premium but earned" feel.
 */
import React, { useEffect } from 'react';
import { View, Text, Image, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { colors, font } from '../theme';

type BadgeUser = {
  role?: string | null;
  plan?: string | null;
} | null | undefined;

type Variant = 'inline' | 'compact' | 'header';

const FOUNDER_SRC = require('../../assets/brand/founder.png');
const MOD_SRC = require('../../assets/brand/moderator.png');
const FS_SRC = require('../../assets/badges/founding_scout.png');
const ELITE_SRC = require('../../assets/badges/elite-badge.png');
const PRO_SRC = require('../../assets/badges/pro-badge.png');

const SIZE_MAP: Record<Variant, number> = {
  inline: 18,
  compact: 20,
  header: 26,
};

function isElitePlan(plan?: string | null): boolean {
  if (!plan) return false;
  return plan === 'elite' || plan === 'comp_elite' || plan === 'trial_elite';
}

function isProPlan(plan?: string | null): boolean {
  if (!plan) return false;
  return plan === 'pro' || plan === 'comp_pro' || plan === 'trial_pro';
}

export default function UserBadge({
  user,
  variant = 'inline',
  testID,
}: {
  user: BadgeUser;
  variant?: Variant;
  testID?: string;
}) {
  if (!user) return null;
  const size = SIZE_MAP[variant];
  const role = user.role || '';
  const plan = user.plan || '';

  // Priority 1: Super Admin → Founder
  if (role === 'super_admin') {
    return (
      <Image
        accessible
        accessibilityLabel="LumaScout Founder"
        testID={testID || 'badge-founder'}
        source={FOUNDER_SRC}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  }

  // Priority 2: Admin/Moderator
  if (role === 'admin' || role === 'moderator') {
    return (
      <Image
        accessible
        accessibilityLabel="LumaScout Moderator"
        testID={testID || 'badge-moderator'}
        source={MOD_SRC}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  }

  // Priority 3: Founding Scout — honorary early-member badge.
  // Rendered with `resizeMode="contain"` at the variant size so the
  // drop-shadow baked into the artwork doesn't clip on tight surfaces
  // (comment author rows, follower list chips, etc.).
  if (role === 'founding_scout') {
    return (
      <Image
        accessible
        accessibilityLabel="Founding Scout"
        testID={testID || 'badge-founding-scout'}
        source={FS_SRC}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  }

  // Priority 3: Elite (animated gold compass PNG)
  if (isElitePlan(plan)) {
    return <ElitePulseBadge size={size} testID={testID || 'badge-elite'} />;
  }

  // Priority 4: Pro (static silver compass PNG)
  if (isProPlan(plan)) {
    return (
      <Image
        accessible
        accessibilityLabel="LumaScout Pro"
        testID={testID || 'badge-pro'}
        source={PRO_SRC}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  }

  return null;
}

/* ---------- Elite animated badge ----------
 * Subtle scale + golden glow halo. Uses reanimated for native perf;
 * web additionally gets a softly pulsing CSS box-shadow for a glow.
 */
function ElitePulseBadge({ size, testID }: { size: number; testID?: string }) {
  const scale = useSharedValue(1);
  const glow = useSharedValue(0.25);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.07, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    glow.value = withRepeat(
      withSequence(
        withTiming(0.65, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.25, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [scale, glow]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    shadowOpacity: glow.value,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: `0 0 ${8 + glow.value * 8}px rgba(245,166,35,${glow.value})` } as any)
      : {}),
  }));

  return (
    <Animated.View
      testID={testID}
      style={[
        styles.eliteWrap,
        { width: size, height: size, borderRadius: size / 2 },
        animStyle,
      ]}
    >
      <Image
        source={ELITE_SRC}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessible
        accessibilityLabel="LumaScout Elite"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  eliteWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    // Native shadow (iOS) for the gold glow
    shadowColor: '#f5a623',
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    // Android glow approximation via elevation
    ...Platform.select({ android: { elevation: 0 } }),
  },
});

// Re-export Text/font/colors so callers don't get tree-shaken regressions
// during refactor (no-op at runtime).
export const _badgeMeta = { font, colors, Text };
