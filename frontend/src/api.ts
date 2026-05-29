import axios, { AxiosInstance } from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveBackendUrl } from './constants/config';

// Backend base URL resolution (V3, May 2026 — production fix 2).
//
// Full RCA: see `src/constants/config.ts` header. Triple-layered
// fallback: process.env → Constants.expoConfig.extra → hardcoded
// production URL. This survives:
//   • `.env` missing on EAS build server
//   • iOS caching Constants.expoConfig.extra across upgrades
//     (Expo SDK 50-54 known bug, expo/expo#33692)
//   • Any future build-config drift
const BASE_URL = resolveBackendUrl() + '/api';
const TOKEN_KEY = 'photoscout_token';
// May 2026 — TestFlight incident: some devices reported Google sign-in
// prompting repeatedly AND uploads failing with 401. Root cause: on
// TestFlight provisioning profiles without a keychain access group, or
// when the device has been restored from backup without unlocking,
// `SecureStore.setItemAsync` silently fails. The old implementation
// swallowed that failure inside a try/catch and returned — the token
// was never persisted, the next launch had no token, and authenticated
// requests (including uploads) went out without an Authorization
// header. The fix: dual-write to SecureStore AND AsyncStorage. Read
// from SecureStore first (keychain is the durable store on iOS) and
// fall through to AsyncStorage when SecureStore returns null — this
// catches the silent-write-failed case on re-open.
const _tokenLog = (msg: string, data?: any) => {
  try {
    // eslint-disable-next-line no-console
    console.log(`[auth.storage] ${msg}`, data ?? '');
  } catch {}
};

// Global listeners for paywall triggers (402 responses)
//
// Batch #8 (May 2026) — the backend now returns a STRUCTURED detail for
// 402s: { reason_code, message, target_plan }. The handler receives the
// full payload so UpgradeGateModal can switch on reason_code directly
// (no more fragile substring matching on the message). Legacy backends
// that still return a plain string are still supported — the handler
// gets `{ reason_code: null, message }` in that case.
export type PaywallDetail = {
  reason_code?: string | null;
  message: string;
  target_plan?: 'pro' | 'elite' | null;
};
type PaywallHandler = (detail: PaywallDetail) => void;
let paywallHandler: PaywallHandler | null = null;
export function onPaywallNeeded(fn: PaywallHandler) { paywallHandler = fn; }

// Global handler for expired-token (401 responses) — wired by AuthProvider
// at boot so the app can clear local state and redirect to login instead of
// silently failing requests indefinitely. Critical for App-Store-quality
// session UX.
type UnauthHandler = () => void;
let unauthHandler: UnauthHandler | null = null;
export function onUnauthorized(fn: UnauthHandler) { unauthHandler = fn; }

// Web-safe token storage: SecureStore + AsyncStorage dual-write on
// native, localStorage on web.
//
// DUAL-WRITE RATIONALE (May 2026 TestFlight fix)
// ──────────────────────────────────────────────
// Keychain access on iOS can silently fail in rare provisioning /
// device-restore scenarios (error is swallowed by the SecureStore
// SDK). When it does, the old single-store implementation returned
// silently and the user was prompted to re-authenticate on next
// launch. By ALSO writing to AsyncStorage we guarantee at least one
// side sees the token, and by reading SecureStore first we keep the
// keychain as the durable source of truth when it works. Both sides
// are kept in sync on every set / delete.
async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; }
  }
  // 1) SecureStore (iOS Keychain / Android Keystore) — preferred.
  let secure: string | null = null;
  try {
    secure = await SecureStore.getItemAsync(key);
  } catch (e) {
    _tokenLog('SecureStore.get failed', (e as any)?.message);
  }
  if (secure) return secure;
  // 2) AsyncStorage fallback — resilient to keychain access failures.
  try {
    const fallback = await AsyncStorage.getItem(key);
    if (fallback) {
      // Heal the keychain silently for next call — a one-time best
      // effort so we don't hit the AsyncStorage branch every request.
      try { await SecureStore.setItemAsync(key, fallback); } catch {}
    }
    return fallback;
  } catch (e) {
    _tokenLog('AsyncStorage.get failed', (e as any)?.message);
    return null;
  }
}
async function storageSet(key: string, value: string) {
  if (Platform.OS === 'web') {
    try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); } catch {}
    return;
  }
  // Dual-write: both stores, parallel. Failures on either side are
  // logged but non-fatal — as long as ONE side writes, the next
  // launch can recover the token. We verify by reading SecureStore
  // back after the write so a silent-failure surfaces in logs.
  let secureOk = false;
  try {
    await SecureStore.setItemAsync(key, value);
    const verify = await SecureStore.getItemAsync(key);
    secureOk = verify === value;
    if (!secureOk) {
      _tokenLog('SecureStore.set readback mismatch — keychain write silently failed');
    }
  } catch (e) {
    _tokenLog('SecureStore.set failed', (e as any)?.message);
  }
  try {
    await AsyncStorage.setItem(key, value);
  } catch (e) {
    _tokenLog('AsyncStorage.set failed', (e as any)?.message);
  }
}
async function storageDelete(key: string) {
  if (Platform.OS === 'web') {
    try { if (typeof window !== 'undefined') window.localStorage.removeItem(key); } catch {}
    return;
  }
  try { await SecureStore.deleteItemAsync(key); } catch (e) { _tokenLog('SecureStore.delete failed', (e as any)?.message); }
  try { await AsyncStorage.removeItem(key); } catch (e) { _tokenLog('AsyncStorage.delete failed', (e as any)?.message); }
}

class Api {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      // Bumped from 15s to 20s (June 2025) — slow-cellular real-world
      // requests were tripping the 15s budget on Spot Detail (~22 KB
      // payload incl. images array on dense spots). Per-call overrides
      // (e.g. spot/[id].tsx passes 18000) still win where appropriate.
      timeout: 20000,
    });
    this.client.interceptors.request.use(async (config) => {
      if (!this.token) {
        this.token = await storageGet(TOKEN_KEY);
      }
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });
    this.client.interceptors.response.use(
      (r) => r,
      async (err) => {
        const status = err?.response?.status;
        const cfg: any = err?.config || {};
        const method = String(cfg.method || 'get').toLowerCase();
        // ─── Jun 2025 stability fix: one silent retry on transient
        // 5xx / network failures for idempotent GETs. Production
        // origin briefly flapped behind Cloudflare (520/521/522/524)
        // during a redeploy; this interceptor recovers automatically
        // without surfacing "Couldn't load…" banners for the typical
        // <1s blip. We:
        //   • retry GET only (POST/PATCH/DELETE may have side-effects)
        //   • retry on no-response network errors OR 5xx (incl. CF 5xx)
        //   • retry exactly once per request (guarded by __retried flag)
        //   • use a small fixed backoff (700ms)
        //   • skip 401/402/404/410 (handled below or non-retryable)
        const noResponse = !err?.response;
        const isCloudflare5xx = typeof status === 'number' && status >= 520 && status <= 529;
        const isServer5xx = typeof status === 'number' && status >= 500 && status < 600;
        const retryable = method === 'get'
          && !cfg.__retried
          && (noResponse || isServer5xx || isCloudflare5xx);
        if (retryable) {
          cfg.__retried = true;
          try {
            // eslint-disable-next-line no-console
            console.warn('[api.retry] one-shot retry', {
              url: cfg.url, status: status ?? null, code: err?.code,
            });
          } catch { /* noop */ }
          await new Promise((r) => setTimeout(r, 700));
          try {
            return await this.client.request(cfg);
          } catch (retryErr) {
            // Fall through to existing error handling below with the
            // RETRY error (so paywall / 401 logic still triggers if
            // the retried response surfaces those statuses).
            err = retryErr;
          }
        }

        const status2 = err?.response?.status;
        // 402 — paywall trigger (existing UX). 401 — expired/invalid
        // session: clear local token + notify auth provider so the app
        // bounces to the login screen instead of looping silently. We
        // skip auto-logout for the auth endpoints themselves so failed
        // login attempts still surface their own error.
        if (status2 === 402 && paywallHandler) {
          // Batch #8 — support BOTH old (string) and new (structured)
          // detail shapes. New backend returns
          // { reason_code, message, target_plan }; old backend returns
          // a plain string. Normalise to a PaywallDetail before dispatching.
          const raw = err.response.data?.detail;
          let normalised: PaywallDetail;
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            normalised = {
              reason_code: (raw as any).reason_code ?? null,
              message: (raw as any).message || 'Upgrade to continue.',
              target_plan: (raw as any).target_plan ?? null,
            };
          } else {
            normalised = {
              reason_code: null,
              message: typeof raw === 'string' && raw ? raw : 'Upgrade to continue.',
              target_plan: null,
            };
          }
          paywallHandler(normalised);
        } else if (status2 === 401) {
          const url: string = err?.config?.url || '';
          const isAuthEndpoint = /^\/?auth\/(login|register|google|forgot|reset)/.test(url);
          if (!isAuthEndpoint) {
            // Fire-and-forget — clear token then notify
            storageDelete(TOKEN_KEY).catch(() => {});
            this.token = null;
            if (unauthHandler) {
              try { unauthHandler(); } catch {}
            }
          }
        }
        return Promise.reject(err);
      }
    );
  }

  async setToken(token: string | null) {
    this.token = token;
    if (token) {
      await storageSet(TOKEN_KEY, token);
    } else {
      await storageDelete(TOKEN_KEY);
    }
  }

  async getTokenFromStorage() {
    if (this.token) return this.token;
    this.token = await storageGet(TOKEN_KEY);
    return this.token;
  }

  get(path: string, params?: any, opts?: { timeout?: number }) {
    return this.client.get(path, {
      params,
      ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    }).then((r) => r.data);
  }
  post(path: string, body?: any, opts?: { timeout?: number }) {
    return this.client.post(path, body, {
      ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    }).then((r) => r.data);
  }
  patch(path: string, body?: any, opts?: { timeout?: number }) {
    return this.client.patch(path, body, {
      ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    }).then((r) => r.data);
  }
  delete(path: string, body?: any, opts?: { timeout?: number }) {
    return this.client.delete(path, {
      ...(body !== undefined ? { data: body } : {}),
      ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    }).then((r) => r.data);
  }
}

/**
 * categorizeApiError — June 2025 stability fix.
 *
 * Translates an axios error into a stable category string so screens
 * can choose the right UX without sniffing axios internals everywhere.
 *
 * Categories:
 *   - 'missing'    → 404 / 410. Resource doesn't exist (or no longer).
 *   - 'auth'       → 401 / 403. Token expired or insufficient permission.
 *                    The axios interceptor already handles 401 logout;
 *                    this category is for the caller to ALSO render a
 *                    helpful message if it cares.
 *   - 'paywall'    → 402. Upgrade gate already opens via paywallHandler.
 *   - 'timeout'    → Request exceeded the configured timeout.
 *                    THIS MUST NOT be treated as a logout. Show retry.
 *   - 'network'    → No HTTP response at all (offline, DNS, TLS, etc).
 *                    Show retry.
 *   - 'server'     → 5xx. Backend hiccup. Show retry.
 *   - 'client'     → Other 4xx. Show error message.
 *   - 'unknown'    → Anything else.
 */
export type ApiErrorCategory =
  | 'missing' | 'auth' | 'paywall' | 'timeout' | 'network'
  | 'server' | 'client' | 'unknown';

export function categorizeApiError(err: any): ApiErrorCategory {
  if (!err) return 'unknown';
  // axios marks timeouts with code === 'ECONNABORTED' (or 'ETIMEDOUT')
  // and a message that includes 'timeout of'.
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT'
      || /timeout/i.test(err?.message || '')) {
    return 'timeout';
  }
  const status = Number(err?.response?.status || err?.status || 0);
  if (status === 0 && !err?.response) return 'network';
  if (status === 404 || status === 410) return 'missing';
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'paywall';
  if (status >= 500 && status < 600) return 'server';
  if (status >= 400 && status < 500) return 'client';
  return 'unknown';
}

export const api = new Api();

export function formatApiError(err: any): string {
  const detail = err?.response?.data?.detail;
  if (detail == null) return err?.message || 'Something went wrong.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((e: any) => (e?.msg ? e.msg : JSON.stringify(e))).join(' ');
  }
  return String(detail);
}
