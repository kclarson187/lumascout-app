import axios, { AxiosInstance } from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || '') + '/api';
const TOKEN_KEY = 'photoscout_token';

// Global listeners for paywall triggers (402 responses)
type PaywallHandler = (message: string) => void;
let paywallHandler: PaywallHandler | null = null;
export function onPaywallNeeded(fn: PaywallHandler) { paywallHandler = fn; }

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
      (err) => {
        if (err?.response?.status === 402 && paywallHandler) {
          const detail = err.response.data?.detail || 'Upgrade to continue.';
          paywallHandler(typeof detail === 'string' ? detail : 'Upgrade to continue.');
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
