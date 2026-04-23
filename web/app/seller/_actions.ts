'use server';

// Server actions for the Seller Center. Runs on the Next.js server with
// HttpOnly session cookie, proxies to existing FastAPI /api/* endpoints.
// Zero backend changes required.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8001';
const AUTH_COOKIE = process.env.AUTH_COOKIE_NAME || 'lumascout_session';

async function authHeader(): Promise<Record<string, string>> {
  const c = await cookies();
  const token = c.get(AUTH_COOKIE)?.value;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}` };
}

async function call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(await authHeader()),
    ...(init.headers as any),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
  return data as T;
}

// ----- Products -----
export async function createProduct(payload: {
  title: string; type: string; description: string; price_cents: number;
  thumbnail_url: string; preview_urls?: string[]; contents_url?: string;
  tags?: string[]; category?: string;
}) {
  const r = await call('/api/marketplace/products', { method: 'POST', body: JSON.stringify(payload) });
  revalidatePath('/seller/products');
  revalidatePath('/seller');
  return r;
}

export async function updateProduct(productId: string, patch: Record<string, any>) {
  const r = await call(`/api/marketplace/products/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  revalidatePath('/seller/products');
  revalidatePath(`/seller/products/${productId}`);
  revalidatePath('/seller');
  return r;
}

export async function deleteProduct(productId: string) {
  const r = await call(`/api/marketplace/products/${encodeURIComponent(productId)}`, { method: 'DELETE' });
  revalidatePath('/seller/products');
  revalidatePath('/seller');
  return r;
}

// ----- Stripe Connect -----
export async function startStripeOnboarding(): Promise<{ url: string }> {
  // Caller can redirect(returned.url) client-side.
  const r = await call<{ url: string; acct_id: string; status: string }>('/api/me/seller/onboard', { method: 'POST' });
  return { url: r.url };
}

export async function openStripeDashboard(): Promise<{ url: string }> {
  const r = await call<{ url: string }>('/api/me/seller/dashboard-link', { method: 'POST' });
  return { url: r.url };
}

// Convenience: do the redirect on the server (called from a form action).
export async function gotoStripeOnboarding() {
  const { url } = await startStripeOnboarding();
  redirect(url);
}

export async function gotoStripeDashboard() {
  const { url } = await openStripeDashboard();
  redirect(url);
}
