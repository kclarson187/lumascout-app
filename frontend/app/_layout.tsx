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
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../src/auth';
import { ONBOARDING_V2_ENABLED } from '../src/constants/flags';
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

// v2.0.21 — Global crash-log capture path (requested by user for the
// pinch-zoom map crash repro).
//
// Wires up:
//   1. A global JS error handler (ErrorUtils on RN) that logs every
//      uncaught exception with a `[CRASH]` prefix so they surface
//      cleanly in Xcode + macOS Console.app filtered logs.
//   2. An unhandled promise rejection handler — many "silent" iOS
//      crashes are actually unhandled rejections that escape to the
//      bridge and corrupt state.
//
// Xcode: Window → Devices and Simulators → select device → "Open
// Console". Filter by "lumascout" or "[CRASH]" to capture repros.
// macOS Console.app: Devices tab → iPhone → filter "[CRASH]".
try {
  const ErrorUtils = (global as any).ErrorUtils;
  if (ErrorUtils && typeof ErrorUtils.setGlobalHandler === 'function') {
    const previous = ErrorUtils.getGlobalHandler?.() || (() => {});
    ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      try {
        // eslint-disable-next-line no-console
        console.error('[CRASH] uncaught_js_error', {
          fatal: !!isFatal,
          name: error?.name,
          message: error?.message,
          stack: (error?.stack || '').split('\n').slice(0, 8).join('\n'),
        });
      } catch {}
      try { previous(error, isFatal); } catch {}
    });
  }
  // Unhandled promise rejection (RN polyfills via `promise` lib, exposes
  // a `tracking` channel that we can subscribe to via the global event
  // emitter).
  const HermesInternal = (global as any).HermesInternal;
  if (HermesInternal && typeof HermesInternal.enablePromiseRejectionTracker === 'function') {
    HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (id: any, rejection: any) => {
        try {
          // eslint-disable-next-line no-console
          console.warn('[CRASH] unhandled_promise_rejection', {
            id,
            message: rejection?.message,
            stack: (rejection?.stack || '').split('\n').slice(0, 6).join('\n'),
          });
        } catch {}
      },
    });
  }
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
    const seg1 = segments[1] as string | undefined;
    const inAuth = seg0 === '(auth)';
    const inOnboarding = seg0 === 'onboarding';
    const inAuthCb = seg0 === 'auth-callback';
    // May 2026 — profile-setup route lives at /onboarding/profile-setup
    const onProfileSetup = inOnboarding && seg1 === 'profile-setup';
    // Jun 2025 — onboarding v2 basics route. Blocking step shown to new
    // signups before /(tabs). Existing users are grandfathered server-
    // side via `basics_complete: true` and therefore never see this.
    const onBasics = inOnboarding && seg1 === 'basics';

    if (!user && !inAuth && !inOnboarding && !inAuthCb) {
      router.replace('/onboarding');
      return;
    }

    if (user) {
      // ─── Onboarding v2 basics gate (Phase 1, Jun 2025) ───────────
      // Blocks new email-path signups on /onboarding/basics until they
      // fill in first_name + display_name + username + home_area.
      // Existing users are grandfathered (server returns true).
      // Strict `=== false` check so undefined boots don't redirect.
      if (
        ONBOARDING_V2_ENABLED
        && user.basics_complete === false
        && !onBasics
        && !inAuthCb
      ) {
        router.replace('/onboarding/basics' as any);
        return;
      }

      // ─── Profile-completion gate (PRD May 2026) ───────────────────
      // Redirect logged-in users whose required photographer fields
      // are missing to the profile-setup screen — UNLESS they're
      // already there (avoids a redirect loop). Auth-callback is
      // also exempt so the post-Google-OAuth handoff never bounces.
      // The flag is computed server-side; if /auth/me hasn't been
      // re-fetched yet it'll be undefined — we treat undefined as
      // "no opinion yet, don't redirect" so the user isn't yanked
      // around during boot.
      //
      // Jun 2025: when v2 onboarding is enabled, the photographer
      // profile is OPTIONAL (per the new spec — required only for
      // directory visibility). We suppress this hard gate entirely
      // and rely on a soft nudge in the Profile tab (Phase 2). Flip
      // ONBOARDING_V2_ENABLED back to false to restore the prior
      // mandatory gate.
      const needsSetup = !ONBOARDING_V2_ENABLED && user.profile_complete === false;
      if (needsSetup && !onProfileSetup && !inAuthCb) {
        router.replace('/onboarding/profile-setup' as any);
        return;
      }
      // Already-complete users sitting on the auth/welcome carousel
      // bounce to the app. Profile-setup is intentionally excluded
      // from this rule so an admin / debugging visit to the screen
      // doesn't slingshot back instantly.
      if (
        (inAuth || (inOnboarding && !onProfileSetup && !onBasics) || !seg0)
        && !needsSetup
        && user.basics_complete !== false
      ) {
        router.replace('/(tabs)');
      }
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
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
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
    // Batch #8 — now receives a structured PaywallDetail. Prefer the
    // backend-emitted `reason_code` (canonical); fall back to the legacy
    // substring regex on `message` for any old/alternate backend that
    // still returns a plain string.
    onPaywallNeeded((detail) => {
      const preferred = (detail.reason_code || '').toLowerCase() as GateReason;
      const valid: GateReason[] = [
        'saves','collections','filters','private','ai_planner','messaging',
        'analytics','uploads','routes','viewers','spot_packs','referrals','generic',
      ];
      const next: GateReason = valid.includes(preferred)
        ? preferred
        : detailToReason(detail.message || '');
      setReason(next);
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
