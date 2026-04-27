/**
 * UserBadge — global identity badge displayed next to a user's name everywhere.
 *
 * Priority (highest first):
 *   1. role === 'super_admin'                → Founder.png (LumaScout founder)
 *   2. role === 'admin' || 'moderator'       → Moderator.png
 *   3. plan elite (incl. comp_elite/trial)   → Animated gold "ELITE" pill (pulse)
 *   4. plan pro (incl. comp_pro/trial_pro)   → Subtle "PRO" pill
 *   5. otherwise                              → null (no badge)
 *
 * Variants:
 *   - 'inline'   : tightest size, inline next to a username (default 14)
 *   - 'compact'  : ~16, used on followers/inbox rows
 *   - 'header'   : ~20, used on profile headers
 *
 * The Founder & Moderator graphics are transparent PNGs; we render them
 * with `resizeMode="contain"` and no background fill so transparency holds.
 */
import React, { useEffect } from 'react';
import { View, Text, Image, StyleSheet, Platform, Pressable } from 'react-native';
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

const SIZE_MAP: Record<Variant, number> = {
  inline: 14,
  compact: 16,
  header: 22,
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
        style={{ width: size + 4, height: size + 4 }}
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
        style={{ width: size + 4, height: size + 4 }}
        resizeMode="contain"
      />
    );
  }

  // Priority 3: Elite (pulsing gold)
  if (isElitePlan(plan)) {
    return <ElitePulseBadge variant={variant} testID={testID || 'badge-elite'} />;
  }

  // Priority 4: Pro
  if (isProPlan(plan)) {
    return (
      <View
        testID={testID || 'badge-pro'}
        style={[styles.proPill, variant === 'header' && styles.proPillHeader]}
      >
        <Text style={[styles.proTxt, variant === 'header' && styles.proTxtHeader]}>PRO</Text>
      </View>
    );
  }

  return null;
}

/* ---------- Elite animated pill ---------- */
function ElitePulseBadge({ variant, testID }: { variant: Variant; testID?: string }) {
  const scale = useSharedValue(1);
  const glow = useSharedValue(0.25);

  useEffect(() => {
    // Subtle, premium pulse — 1800ms loop.
    scale.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    glow.value = withRepeat(
      withSequence(
        withTiming(0.55, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.25, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [scale, glow]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    shadowOpacity: glow.value,
    // Web-only soft glow (RN reanimated allows arbitrary fields; native ignores)
    ...(Platform.OS === 'web'
      ? { boxShadow: `0 0 ${8 + glow.value * 6}px rgba(245,166,35,${glow.value})` as any }
      : {}),
  }));

  const isHeader = variant === 'header';

  return (
    <Animated.View
      testID={testID}
      style={[
        styles.elitePill,
        isHeader && styles.elitePillHeader,
        styles.eliteGlow,
        animStyle,
      ]}
    >
      <Text style={[styles.eliteTxt, isHeader && styles.eliteTxtHeader]}>ELITE</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Elite pill (animated)
  elitePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(245,166,35,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245,166,35,0.6)',
  },
  elitePillHeader: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  eliteGlow: {
    shadowColor: '#f5a623',
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  eliteTxt: {
    color: '#f5a623',
    fontFamily: font.bodyBold,
    fontSize: 8,
    letterSpacing: 0.9,
  },
  eliteTxtHeader: {
    fontSize: 10,
    letterSpacing: 1.1,
  },
  // Pro pill (static)
  proPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  proPillHeader: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  proTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodyBold,
    fontSize: 8,
    letterSpacing: 0.9,
  },
  proTxtHeader: {
    fontSize: 10,
    letterSpacing: 1.1,
  },
});
