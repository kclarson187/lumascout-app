import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_600SemiBold_Italic,
} from '@expo-google-fonts/playfair-display';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../src/auth';
import { colors } from '../src/theme';
import { onPaywallNeeded } from '../src/api';
import UpgradeGateModal, { GateReason } from '../src/components/UpgradeGateModal';
import RootErrorBoundary from '../src/components/RootErrorBoundary';

// Apr 2026 — Full-bleed splash. Hold the native splash until fonts +
// auth bootstrap finish, then dissolve over 700ms for a cinematic feel.
// `setOptions` is a no-op on web / unsupported environments and wrapped
// in try/catch so it never blocks startup.
SplashScreen.preventAutoHideAsync().catch(() => {});
try {
  // @ts-ignore — `setOptions` is available on expo-splash-screen ≥0.27
  SplashScreen.setOptions?.({ duration: 700, fade: true });
} catch {}

/**
 * Mount once at app root: wire push-notification tap handler so notifications
 * with `data.deep_link` route into the app. Silent no-op on web.
 */
function PushDeepLinkMount() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const { installPushDeepLinkHandler } = await import('../src/push');
        cleanup = installPushDeepLinkHandler();
      } catch {}
    })();
    return () => { try { cleanup?.(); } catch {} };
  }, []);
  return null;
}
function Gate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const seg0 = segments[0] as string | undefined;
    const inAuth = seg0 === '(auth)';
    const inOnboarding = seg0 === 'onboarding';
    const inAuthCb = seg0 === 'auth-callback';

    if (!user && !inAuth && !inOnboarding && !inAuthCb) {
      router.replace('/onboarding');
    } else if (user && (inAuth || inOnboarding || !seg0)) {
      router.replace('/(tabs)');
    }
  }, [user, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_700Bold,
    PlayfairDisplay_600SemiBold_Italic,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  // Apr 2026 — hide native splash the instant fonts have loaded. Done
  // in an effect so the call lands AFTER the first paint (otherwise on
  // iOS the dissolve has nothing underneath to fade into and you flash
  // a dark frame). The 700 ms fade configured by setOptions above runs
  // on the native side; React just needs to release the gate.
  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    // Render nothing while the native splash is still showing — the
    // splash IS the loading state. Returning a black <View> with a
    // spinner here would race the splash and produce a visible flicker.
    return null;
  }

  return (
    <RootErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AuthProvider>
          <StatusBar style="light" />
          <PushDeepLinkMount />
          <Gate />
          <GlobalUpgradeGate />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: 'fade',
            }}
          />
        </AuthProvider>
      </GestureHandlerRootView>
    </RootErrorBoundary>
  );
}

/**
 * GlobalUpgradeGate — Option A wiring (PRD #5)
 *
 * Replaces the legacy PaywallOverlay with the polished UpgradeGateModal.
 *
 * Infrastructure already in place:
 *   • `api.ts` intercepts every 402 Payment Required response and fires
 *     `onPaywallNeeded(detail_message)`.
 *   • Backend raises 402 with a descriptive detail string for every plan
 *     limit hit: saves, collections, private spots, advanced filters,
 *     messaging, AI planner.
 *
 * This component listens once at root, maps the server detail string to a
 * canonical GateReason, and renders the targeted modal. That single wiring
 * instantly covers *all* gated call sites app-wide — no per-screen changes
 * needed.
 */
function GlobalUpgradeGate() {
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState<GateReason>('generic');

  useEffect(() => {
    onPaywallNeeded((msg: string) => {
      setReason(detailToReason(msg));
      setVisible(true);
    });
  }, []);

  return <UpgradeGateModal visible={visible} onClose={() => setVisible(false)} reason={reason} />;
}

/**
 * Map backend 402 detail strings to UpgradeGateModal reason keys.
 * Keep in sync with backend error copy. Unknown strings fall back to
 * 'generic' which is safe (generic Pro pitch).
 */
function detailToReason(detail: string): GateReason {
  const m = (detail || '').toLowerCase();
  if (m.includes('upload')) return 'uploads';
  if (m.includes('route')) return 'routes';
  if (m.includes('save')) return 'saves';
  if (m.includes('collection')) return 'collections';
  if (m.includes('private')) return 'private';
  if (m.includes('filter')) return 'filters';
  if (m.includes('scout ai') || m.includes('planner') || m.includes('ai plan')) return 'ai_planner';
  if (m.includes('viewer')) return 'viewers';
  if (m.includes('analytics')) return 'analytics';
  if (m.includes('message') || m.includes(' dm') || m.includes('thread')) return 'messaging';
  return 'generic';
}
