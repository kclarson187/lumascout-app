/**
 * AppleSignInButton — Real Sign In with Apple (SIWA).
 *
 * Phase A (App Store blocker, Jun 2026).
 *
 * Replaces the previous "coming soon" placeholder with a real native
 * Apple Sign-In button. We keep the export name `AppleSoonButton` so
 * the import sites in (auth)/login.tsx and (auth)/register.tsx don't
 * need to change.
 *
 * Behaviour:
 *   • iOS only — renders the native AppleAuthenticationButton.
 *   • Non-iOS (web/Android) — renders nothing.
 *   • In Expo Go / web preview, the underlying capability check fails
 *     and we render nothing too. Apple sign-in only works in a dev
 *     client or production iOS build.
 *   • Tapping → runs the full nonce → identityToken → backend dance.
 *     On success the caller's `onSuccess` callback receives the
 *     {token, user} payload (or we wire it directly via auth context).
 *
 * Used by app/(auth)/login.tsx and app/(auth)/register.tsx, placed
 * ABOVE Google per Apple HIG when both options are offered.
 */
import React, { useEffect, useState } from 'react';
import {
  Platform,
  StyleSheet,
  ActivityIndicator,
  View,
  Alert,
  TouchableOpacity,
  Text,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useAuth } from '../auth';
import { runAppleSignIn, isAppleSignInAvailable } from '../apple-signin';
import { colors, font, radii } from '../theme';

type Props = {
  testID?: string;
  /** Where to navigate after a successful sign-in. Defaults to tabs root. */
  onSuccessRoute?: string;
};

export function AppleSoonButton({ testID = 'apple-signin', onSuccessRoute }: Props) {
  const { appleExchange, refresh } = useAuth();
  const [available, setAvailable] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== 'ios') return;
    isAppleSignInAvailable()
      .then((ok) => { if (!cancelled) setAvailable(ok); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  // Hide on web, Android, and on iOS devices where the capability isn't
  // available (e.g. running in Expo Go without the dev-client build).
  if (Platform.OS !== 'ios' || !available) {
    return null;
  }

  const handlePress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await runAppleSignIn();
      if (r.ok) {
        await appleExchange(r.token);
        try { await refresh(); } catch {}
        // Caller may have already wrapped this with navigation; if a
        // route override was passed in we honour it, otherwise default
        // to the tabs root.
        router.replace((onSuccessRoute || '/(tabs)') as any);
        return;
      }
      if (r.reason === 'canceled' || r.reason === 'unsupported') return;
      // Phase A.1 (Jun 2026) — friendly, non-technical user-facing copy.
      // `runAppleSignIn` already mapped Apple's raw error code to a
      // helpful message; we just surface it here. Detailed diagnostics
      // are console-logged in apple-signin.ts so we can debug from
      // TestFlight device logs without exposing it to the user.
      Alert.alert(
        "Couldn't sign in with Apple",
        r.message
          || "Apple Sign-In couldn't be completed. Please try again, or continue with Google.",
      );
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn('[apple-button] unexpected error', {
        code: e?.code,
        message: e?.message,
        name: e?.name,
      });
      Alert.alert(
        "Couldn't sign in with Apple",
        "Apple Sign-In couldn't be completed. Please try again, or continue with Google.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (busy) {
    return (
      <View style={styles.busyBtn} testID={`${testID}-busy`}>
        <ActivityIndicator size="small" color={colors.textInverse} />
        <Text style={styles.busyTxt}>Signing in…</Text>
      </View>
    );
  }

  return (
    <View style={{ width: '100%' }}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
        cornerRadius={radii.md}
        style={styles.btn}
        onPress={handlePress}
        testID={testID}
      />
    </View>
  );
}

/**
 * Fallback non-native button used in any caller that wants a custom
 * appearance (e.g., if Apple's native button ever fails to render in
 * a future SDK). Kept for completeness but not currently used.
 */
export function AppleSignInTextButton({ onPress, testID = 'apple-signin-text' }: { onPress?: () => void; testID?: string }) {
  return (
    <TouchableOpacity style={styles.fallback} onPress={onPress} testID={testID}>
      <Text style={styles.fallbackTxt}>Continue with Apple</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { width: '100%', height: 48 },
  busyBtn: {
    width: '100%', height: 48, borderRadius: radii.md,
    backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 10,
  },
  busyTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
  fallback: {
    width: '100%', height: 48, borderRadius: radii.md,
    backgroundColor: '#000', alignItems: 'center', justifyContent: 'center',
  },
  fallbackTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 15 },
});
