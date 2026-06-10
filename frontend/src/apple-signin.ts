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
import { api } from './api';

export type AppleSignInResult =
  | { ok: true; token: string; user: any }
  | { ok: false; reason: 'unsupported' | 'canceled' | 'error'; message?: string };

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
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
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
  } catch (e: any) {
    // Apple's SDK throws with code ERR_REQUEST_CANCELED when the user
    // closes the sheet — we treat that as a graceful no-op.
    const code = e?.code || e?.message || '';
    if (typeof code === 'string' && /cancel|ERR_REQUEST_CANCELED/i.test(code)) {
      return { ok: false, reason: 'canceled' };
    }
    return { ok: false, reason: 'error', message: String(e?.message || e) };
  }

  if (!credential.identityToken) {
    return { ok: false, reason: 'error', message: 'No identity token from Apple.' };
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
      return { ok: true, token: res.token, user: res.user };
    }
    return { ok: false, reason: 'error', message: 'Unexpected response from server.' };
  } catch (e: any) {
    return { ok: false, reason: 'error', message: String(e?.message || e) };
  }
}
