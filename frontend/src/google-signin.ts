/**
 * google-signin.ts
 * ─────────────────────────────────────────────────────────────────
 * Shared Google sign-in helper for login + register screens.
 *
 * WHY THIS EXISTS (May 2026 TestFlight incident)
 * ───────────────────────────────────────────────
 * iOS production users reported "Request failed with status code 520"
 * when tapping "Continue with Google". 520 is a Cloudflare edge code
 * — the Emergent OAuth proxy (demobackend.emergentagent.com) was
 * intermittently returning 5xx during cold-starts, and login.tsx /
 * register.tsx were exposing the raw axios message verbatim.
 *
 * This helper centralises the Google flow, maps every failure mode to
 * human copy, silences user-cancel alerts, and returns a structured
 * result so each caller decides where to navigate.
 *
 * DO NOT hardcode URLs here — the auth proxy URL lives in the inline
 * comment below intentionally. The backend (/api/auth/google/session)
 * already has a "DO NOT HARDCODE" banner for the same reason.
 */
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { api } from './api';

export type GoogleSignInResult =
  | { kind: 'ok' }
  | { kind: 'cancelled' }
  | { kind: 'error'; title: string; message: string; cause?: unknown };

type Opts = {
  // Parent can use this to record which surface (login vs register)
  // triggered the flow — ends up in backend logs if we ever add
  // client-side breadcrumb reporting.
  surface?: 'login' | 'register' | 'onboarding';
  // Lets the auth provider swap in a mocked exchange for tests.
  exchange: (session_id: string) => Promise<unknown>;
};

/**
 * Execute the full Emergent-hosted Google OAuth flow.
 *
 * Returns a result discriminant so the caller can:
 *   - `ok`        → navigate forward
 *   - `cancelled` → do nothing (no scary alert)
 *   - `error`     → show the mapped title + message
 *
 * Callers should NOT try/catch around this — the helper never throws
 * for the "normal" failure modes. A throw would indicate a programmer
 * error or a bundler issue.
 */
export async function runGoogleSignIn({ exchange, surface = 'login' }: Opts): Promise<GoogleSignInResult> {
  // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR
  // REDIRECT URLS, THIS BREAKS THE AUTH.
  const redirectUrl = Linking.createURL('/auth-callback');
  const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
  } catch (e: any) {
    return {
      kind: 'error',
      title: 'Google sign-in failed',
      message: 'We couldn\'t open the Google sign-in window. Check your connection and try again.',
      cause: e,
    };
  }

  // User-cancel paths (swipe down on iOS sheet, tap back on Android,
  // close the tab on web). Must be silent — zero alerts.
  if (result.type === 'cancel' || result.type === 'dismiss' || (result as any).type === 'locked') {
    return { kind: 'cancelled' };
  }

  if (result.type !== 'success' || !result.url) {
    return {
      kind: 'error',
      title: 'Google sign-in failed',
      message: 'We couldn\'t complete Google sign-in. Please try email login or try again later.',
      cause: result,
    };
  }

  const hash = result.url.split('#')[1] || '';
  const params = new URLSearchParams(hash);
  const session_id = params.get('session_id');
  if (!session_id) {
    return {
      kind: 'error',
      title: 'Google sign-in is not configured correctly.',
      message: 'The sign-in response was missing a session. Please try again, or use email login.',
      cause: { url: result.url, surface },
    };
  }

  try {
    await exchange(session_id);
    return { kind: 'ok' };
  } catch (e: any) {
    return { kind: 'error', ...mapExchangeError(e) };
  }
}

/**
 * Translate an axios/api error from /auth/google/session into
 * human-friendly title + message.
 *
 * Kept exported so unit tests can exercise the mapping without
 * running the whole WebBrowser flow.
 */
export function mapExchangeError(err: any): { title: string; message: string; cause?: unknown } {
  const status = err?.response?.status;
  const serverMsg = (err?.response?.data?.detail as string) || '';

  // Network (no response, timeout, DNS, TLS)
  if (!status) {
    return {
      title: 'Google sign-in failed',
      message: 'Google sign-in is temporarily unavailable. Please check your connection, try email login, or try again later.',
      cause: err,
    };
  }
  // Upstream unavailable — Cloudflare 520/521/522/523/524 bubbles
  // through our backend as a 502 (see server.py google_session).
  // Also catch raw 5xx in case a proxy strips our structured body.
  if (status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 529) || (status >= 500 && status < 600)) {
    return {
      title: 'Google sign-in failed',
      message: serverMsg || 'Google sign-in is temporarily unavailable. Please try email login or try again later.',
      cause: err,
    };
  }
  // Session exchange rejected — user's Google-side session was
  // invalid or already consumed.
  if (status === 401) {
    return {
      title: 'Google sign-in failed',
      message: 'Google could not verify this account. Please try again.',
      cause: err,
    };
  }
  // Missing email / malformed payload from upstream.
  if (status === 400) {
    return {
      title: 'Google sign-in failed',
      message: serverMsg || 'Google sign-in didn\'t return a usable account. Please try a different account or email login.',
      cause: err,
    };
  }
  // Catch-all.
  return {
    title: 'Google sign-in failed',
    message: serverMsg || 'Something went wrong finishing sign-in. Please try again.',
    cause: err,
  };
}

// Re-export so callers never have to touch the api module just to
// feed the helper.
export { api };
