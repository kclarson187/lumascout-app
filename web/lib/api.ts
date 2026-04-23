/**
 * Shared backend API client. On the server (RSC + Route Handlers) reads JWT
 * from the httpOnly cookie; on the client, relies on the /api proxy routes
 * so the JWT never hits the browser JS context.
 */
import { cookies } from 'next/headers';

export const API_BASE = process.env.API_BASE_URL || 'http://localhost:8001';
export const AUTH_COOKIE = process.env.AUTH_COOKIE_NAME || 'lumascout_session';

type FetchOpts = RequestInit & { auth?: boolean; revalidate?: number | false };

async function getToken(): Promise<string | null> {
  try {
    const c = await cookies();
    return c.get(AUTH_COOKIE)?.value || null;
  } catch {
    return null;
  }
}

export async function apiFetch<T = any>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers || {});
  headers.set('Accept', 'application/json');
  if (!headers.has('Content-Type') && opts.body && typeof opts.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (opts.auth !== false) {
    const token = await getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const init: RequestInit = {
    ...opts,
    headers,
    next: typeof opts.revalidate === 'undefined' ? { revalidate: 300 } : { revalidate: opts.revalidate as any },
  } as any;
  const res = await fetch(url, init);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${path}: ${errText.slice(0, 200)}`);
  }
  return res.json();
}

export async function apiTry<T = any>(path: string, fallback: T, opts: FetchOpts = {}): Promise<T> {
  try {
    return await apiFetch<T>(path, opts);
  } catch {
    return fallback;
  }
}
