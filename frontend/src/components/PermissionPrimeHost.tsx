/**
 * src/components/PermissionPrimeHost.tsx — Root-mounted bottom sheet
 * that renders the priming UI for camera / location / photo library
 * permission requests.
 *
 * One instance lives at the top of <RootLayout /> (app/_layout.tsx).
 * It registers itself with `src/lib/permissions.ts` so any call to
 *   primeAndRequestLocation()
 *   primeAndRequestMediaLibrary()
 *   primeAndRequestCamera()
 * can imperatively show the sheet and await the user's choice via a
 * single Promise.
 *
 * Why a host instead of inline modals?
 * ────────────────────────────────────
 * The permission helpers in `src/lib/permissions.ts` are pure async
 * functions that can be called from any screen, hook, or service.
 * Mounting one host at the root keeps a single source of truth for
 * the visual treatment and means callers don't have to wire up modal
 * state at every call site (Add tab, Profile tab, onboarding, etc.).
 *
 * Visual contract:
 *   • Sliding-up bottom sheet with rounded top corners.
 *   • Big icon badge, headline, subtitle, 3-4 benefit bullets.
 *   • Two CTAs: primary ("Allow X" or "Open Settings") + secondary
 *     ("Not now") so we never dead-end the user.
 *   • Dismissable via backdrop tap or hardware back (Android).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera as CameraIcon,
  Check,
  Image as PhotoIcon,
  MapPin,
} from 'lucide-react-native';

import {
  _registerPrimeHandler,
  type PermissionPrimePayload,
} from '../lib/permissions';

// ─── Theme tokens (kept local to avoid an extra import dependency) ───
const COLORS = {
  background: '#FFFFFF',
  backdrop: 'rgba(15, 23, 42, 0.55)',
  text: '#0F172A',
  textMuted: '#64748B',
  primary: '#0F766E', // LumaScout teal-700
  primaryFg: '#FFFFFF',
  secondaryFg: '#475569',
  iconBg: '#ECFDF5',
  iconFg: '#0F766E',
  divider: '#E2E8F0',
  bulletFg: '#0F172A',
};

const SPACING = { xs: 4, s: 8, m: 16, l: 24, xl: 32 };

type PendingResolver = (granted: boolean) => void;

function pickIcon(kind: PermissionPrimePayload['kind']) {
  if (kind === 'location') return MapPin;
  if (kind === 'camera') return CameraIcon;
  return PhotoIcon;
}

export default function PermissionPrimeHost(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState<PermissionPrimePayload | null>(null);
  const resolverRef = useRef<PendingResolver | null>(null);

  // Slide-up animation.
  const translateY = useRef(new Animated.Value(windowHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const close = useCallback(
    (granted: boolean) => {
      // Run the slide-out, then resolve the pending promise so the
      // caller gets the answer AFTER the user actually sees the sheet
      // leave. Resolving sooner can race with the native permission
      // dialog appearing under a still-visible sheet.
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: windowHeight,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        const resolver = resolverRef.current;
        resolverRef.current = null;
        setVisible(false);
        setPayload(null);
        if (resolver) resolver(granted);
      });
    },
    [backdropOpacity, translateY, windowHeight],
  );

  useEffect(() => {
    const handler = (next: PermissionPrimePayload) =>
      new Promise<boolean>((resolve) => {
        // If a previous prompt is still on-screen for some weird race,
        // resolve it as "skipped" before showing the new one.
        if (resolverRef.current) resolverRef.current(false);
        resolverRef.current = resolve;
        setPayload(next);
        setVisible(true);
        // Reset animated values so the slide-up plays fresh every time.
        translateY.setValue(windowHeight);
        backdropOpacity.setValue(0);
      });
    _registerPrimeHandler(handler);
    return () => {
      _registerPrimeHandler(null);
      // If we unmount mid-prompt, resolve as skipped so callers don't
      // hang forever (mostly an HMR / unit-test edge case).
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
    };
  }, [backdropOpacity, translateY, windowHeight]);

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, translateY, backdropOpacity]);

  if (!payload) {
    return <Modal visible={false} transparent />;
  }

  const Icon = pickIcon(payload.kind);
  const primaryLabel =
    payload.variant === 'blocked'
      ? 'Open Settings'
      : payload.kind === 'location'
        ? 'Allow Location'
        : payload.kind === 'camera'
          ? 'Allow Camera'
          : 'Allow Photos';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => close(false)}
      statusBarTranslucent
    >
      <View style={styles.fill} pointerEvents="box-none">
        <Animated.View
          pointerEvents={visible ? 'auto' : 'none'}
          style={[styles.backdrop, { opacity: backdropOpacity }]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => close(false)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss permission explanation"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, SPACING.m) + SPACING.m,
              transform: [{ translateY }],
            },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />

          <View style={styles.iconBadge}>
            <Icon size={28} color={COLORS.iconFg} />
          </View>

          <Text style={styles.title}>{payload.title}</Text>
          <Text style={styles.subtitle}>{payload.subtitle}</Text>

          <View style={styles.bullets}>
            {payload.bullets.slice(0, 4).map((line) => (
              <View key={line} style={styles.bulletRow}>
                <View style={styles.bulletDot}>
                  <Check size={14} color={COLORS.iconFg} />
                </View>
                <Text style={styles.bulletText}>{line}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.primaryButton}
            onPress={() => close(true)}
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
          >
            <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.secondaryButton}
            onPress={() => close(false)}
            accessibilityRole="button"
            accessibilityLabel="Not now"
          >
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.backdrop,
  },
  sheet: {
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.l,
    paddingTop: SPACING.s,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: -4 },
      },
      android: {
        elevation: 16,
      },
    }),
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.divider,
    marginBottom: SPACING.m,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.iconBg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginBottom: SPACING.m,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.textMuted,
    marginBottom: SPACING.l,
  },
  bullets: {
    marginBottom: SPACING.l,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.m - 4,
  },
  bulletDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.iconBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.s + 4,
    marginTop: 1,
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.bulletFg,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginBottom: SPACING.s,
  },
  primaryButtonText: {
    color: COLORS.primaryFg,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  secondaryButtonText: {
    color: COLORS.secondaryFg,
    fontSize: 15,
    fontWeight: '500',
  },
});
