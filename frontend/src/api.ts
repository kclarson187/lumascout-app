import axios, { AxiosInstance } from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || '') + '/api';
const TOKEN_KEY = 'photoscout_token';

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

// Web-safe token storage: SecureStore on native, localStorage on web
async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; }
  }
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}
async function storageSet(key: string, value: string) {
  if (Platform.OS === 'web') {
    try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); } catch {}
    return;
  }
  try { await SecureStore.setItemAsync(key, value); } catch {}
}
async function storageDelete(key: string) {
  if (Platform.OS === 'web') {
    try { if (typeof window !== 'undefined') window.localStorage.removeItem(key); } catch {}
    return;
  }
  try { await SecureStore.deleteItemAsync(key); } catch {}
}

class Api {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 15000,
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
      (err) => {
        const status = err?.response?.status;
        // 402 — paywall trigger (existing UX). 401 — expired/invalid
        // session: clear local token + notify auth provider so the app
        // bounces to the login screen instead of looping silently. We
        // skip auto-logout for the auth endpoints themselves so failed
        // login attempts still surface their own error.
        if (status === 402 && paywallHandler) {
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
        } else if (status === 401) {
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

  get(path: string, params?: any) {
    return this.client.get(path, { params }).then((r) => r.data);
  }
  post(path: string, body?: any) {
    return this.client.post(path, body).then((r) => r.data);
  }
  patch(path: string, body?: any) {
    return this.client.patch(path, body).then((r) => r.data);
  }
  delete(path: string, body?: any) {
    return this.client.delete(path, body !== undefined ? { data: body } : undefined).then((r) => r.data);
  }
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
