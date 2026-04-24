import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
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

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
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
  if (m.includes('save')) return 'saves';
  if (m.includes('collection')) return 'collections';
  if (m.includes('private')) return 'private';
  if (m.includes('filter')) return 'filters';
  if (m.includes('scout ai') || m.includes('planner') || m.includes('ai plan')) return 'ai_planner';
  if (m.includes('analytics') || m.includes('viewer')) return 'analytics';
  if (m.includes('message') || m.includes('dm')) return 'messaging';
  return 'generic';
}
