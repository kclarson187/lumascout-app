/**
 * Apple Sign In with Apple (SIWA) — Native iOS only.
 *
 * Phase A (App Store blocker, Jun 2026).
 *
 * Replaces the AppleSoonButton placeholder. Implements the full
 * client-side dance:
 *
 *   1. Generate a 32-byte random nonce, encode as hex (raw).
 *   2. SHA-256 hash of the raw nonce → hashedNonce (passed to Apple).
 *   3. Invoke AppleAuthentication.signInAsync({ nonce: hashedNonce }).
 *   4. POST identityToken + raw nonce + (one-time) full name/email to
 *      /api/auth/apple. Backend verifies against Apple's public JWKS
 *      and returns the same { token, user } shape as /api/auth/login.
 *
 * Notes:
 *   • iOS only. On Android/Web the helper resolves to { unsupported: true }.
 *   • Available only in dev-client / production builds — Expo Go cannot
 *     extend its native code to include the Apple Sign In capability.
 *   • Apple returns email + fullName ONLY on first authorization. We
 *     pass them through to the backend so it can populate the new
 *     user doc; subsequent logins just rely on the Apple `sub`.
 */

import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { api } from './api';

export type AppleSignInResult =
  | { ok: true; token: string; user: any }
  | {
      ok: false;
      reason: 'unsupported' | 'canceled' | 'error';
      message?: string;
      /** Apple's ASAuthorizationError code when available. */
      code?: string;
    };

/**
 * Phase A.1 (Jun 2026) — apple SIWA TestFlight bug. The native Apple
 * error "The authorization attempt failed for an unknown reason"
 * maps to ASAuthorizationError.unknown (code 1000 / "ERR_REQUEST_UNKNOWN").
 * It almost always means the IPA is missing the
 * `com.apple.developer.applesignin` entitlement OR the provisioning
 * profile pre-dates the SIWA capability being enabled on the App ID.
 * Map it to a user-actionable copy.
 */
const APPLE_ERROR_COPY: Record<string, string> = {
  ERR_REQUEST_CANCELED: 'Sign-in was cancelled.',
  ERR_REQUEST_FAILED: "Apple couldn't complete the sign-in. Check your network and try again.",
  ERR_REQUEST_INVALID_RESPONSE: "Apple returned an unexpected response. Please try again.",
  ERR_REQUEST_NOT_HANDLED: "Apple Sign-In isn't available on this device right now.",
  ERR_REQUEST_NOT_INTERACTIVE: "Apple Sign-In can't run in the background.",
  ERR_REQUEST_UNKNOWN:
    "Apple Sign-In couldn't be completed. Please try again, or continue with Google.",
};

/** Generate a hex-encoded random nonce + its SHA-256 hash. */
async function generateNoncePair(): Promise<{ raw: string; hashed: string }> {
  // 32 random bytes → 64 hex chars. Plenty for a one-shot nonce.
  const rand = await Crypto.getRandomBytesAsync(32);
  const raw = Array.from(rand)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const hashed = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    raw,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
  return { raw, hashed };
}

/** Returns true when this device can present the Apple Sign-In UI. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const ok = await AppleAuthentication.isAvailableAsync();
    if (!ok) {
      // eslint-disable-next-line no-console
      console.log('[apple-signin] isAvailableAsync=false on iOS', {
        platform: Platform.OS,
        version: Platform.Version,
      });
    }
    return ok;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[apple-signin] isAvailableAsync threw', e);
    return false;
  }
}

/** Build a small object of build / runtime context for diagnostics logs. */
function buildContext() {
  return {
    platform: Platform.OS,
    osVersion: Platform.Version,
    appOwnership: (Constants as any).appOwnership,
    expoGoEnv: !!(Constants as any).executionEnvironment
      ? (Constants as any).executionEnvironment
      : undefined,
    nativeAppVersion: (Constants as any).nativeAppVersion
      || (Constants as any).expoConfig?.version,
    nativeBuildVersion: (Constants as any).nativeBuildVersion
      || (Constants as any).expoConfig?.ios?.buildNumber,
  };
}

/**
 * Run the full Apple Sign-In flow end-to-end. Resolves with one of:
 *   • ok=true            — backend gave us a JWT and user; caller persists.
 *   • ok=false, canceled — user dismissed the Apple sheet. Caller should
 *                          do nothing (no error toast).
 *   • ok=false, error    — anything else. Caller shows a generic error.
 *   • ok=false, unsupported — non-iOS / unavailable. Caller hides button.
 */
export async function runAppleSignIn(): Promise<AppleSignInResult> {
  const ctx = buildContext();
  // eslint-disable-next-line no-console
  console.log('[apple-signin] start', ctx);

  if (!(await isAppleSignInAvailable())) {
    return { ok: false, reason: 'unsupported' };
  }

  // Generate the nonce pair BEFORE prompting so we can pass the hash
  // to Apple and keep the raw value to send to the backend.
  const { raw, hashed } = await generateNoncePair();

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        // FULL_NAME first matters: some older Apple SDKs only return the
        // name when this is the first item in the scopes array.
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
    // eslint-disable-next-line no-console
    console.log('[apple-signin] credential received', {
      hasIdentityToken: !!credential.identityToken,
      hasAuthorizationCode: !!credential.authorizationCode,
      hasEmail: !!credential.email,
      hasFullName: !!credential.fullName,
      userSubLen: typeof credential.user === 'string' ? credential.user.length : 0,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[apple-signin] signInAsync threw', {
      code: e?.code,
      message: e?.message,
      name: e?.name,
      stack: typeof e?.stack === 'string' ? e.stack.slice(0, 400) : undefined,
      ctx,
    });
    const code: string = String(e?.code || e?.message || '');
    // User-cancelled the native sheet — graceful no-op.
    if (/ERR_REQUEST_CANCELED/i.test(code) || /cancel/i.test(code)) {
      return { ok: false, reason: 'canceled', code: 'ERR_REQUEST_CANCELED' };
    }
    // Map the known Apple error codes to friendlier copy; fall back to
    // the unknown-error copy.
    const friendly = APPLE_ERROR_COPY[code]
      || APPLE_ERROR_COPY.ERR_REQUEST_UNKNOWN;
    return { ok: false, reason: 'error', message: friendly, code };
  }

  if (!credential.identityToken) {
    // eslint-disable-next-line no-console
    console.warn('[apple-signin] missing identity token on credential');
    return {
      ok: false,
      reason: 'error',
      message: APPLE_ERROR_COPY.ERR_REQUEST_INVALID_RESPONSE,
      code: 'ERR_REQUEST_INVALID_RESPONSE',
    };
  }

  // Apple only sends email + fullName the very first time. Pass them
  // through; the backend stores them on account creation and ignores
  // them on subsequent calls.
  const payload: Record<string, any> = {
    identityToken: credential.identityToken,
    rawNonce: raw,
  };
  if (credential.email) payload.email = credential.email;
  if (credential.fullName) {
    payload.fullName = {
      givenName: credential.fullName.givenName ?? null,
      familyName: credential.fullName.familyName ?? null,
    };
  }

  try {
    const res = await api.post('/auth/apple', payload);
    if (res && res.token && res.user) {
      // eslint-disable-next-line no-console
      console.log('[apple-signin] backend exchange ok', {
        userId: res.user?.user_id,
        hasToken: !!res.token,
      });
      return { ok: true, token: res.token, user: res.user };
    }
    // eslint-disable-next-line no-console
    console.warn('[apple-signin] unexpected backend response', { res });
    return {
      ok: false,
      reason: 'error',
      message: APPLE_ERROR_COPY.ERR_REQUEST_INVALID_RESPONSE,
      code: 'BACKEND_BAD_RESPONSE',
    };
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[apple-signin] backend exchange failed', {
      status: e?.status,
      message: e?.message,
    });
    return {
      ok: false,
      reason: 'error',
      message:
        e?.status === 401
          ? 'Apple sign-in could not be verified. Please try again.'
          : "Couldn't reach LumaScout to complete Apple Sign-In. Please try again.",
      code: 'BACKEND_EXCHANGE_FAILED',
    };
  }
}
