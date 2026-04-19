import axios, { AxiosInstance } from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || '') + '/api';
const TOKEN_KEY = 'photoscout_token';

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
        try {
          this.token = await SecureStore.getItemAsync(TOKEN_KEY);
        } catch {}
      }
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });
  }

  async setToken(token: string | null) {
    this.token = token;
    if (token) {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    } else {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
  }

  async getTokenFromStorage() {
    if (this.token) return this.token;
    try {
      this.token = await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {}
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
  delete(path: string) {
    return this.client.delete(path).then((r) => r.data);
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
