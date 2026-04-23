'use server';

// Server actions for the Web Admin Center.
// These run on the Next.js server, pull the HttpOnly session cookie, and proxy
// to the existing FastAPI admin endpoints as the authenticated admin user.
// Rationale: the k8s ingress routes /api/* directly to FastAPI, so browser-
// originated calls to /api/admin/* would bypass cookie-auth (HttpOnly cookie
// can't be read by JS). Server actions solve this cleanly.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

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

// ----- Spots -----
export async function approveSpot(spotId: string, notes?: string) {
  const r = await call(`/api/admin/spots/${encodeURIComponent(spotId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ notes: notes || '' }),
  });
  revalidatePath('/admin/spots');
  revalidatePath('/admin');
  return r;
}

export async function rejectSpot(spotId: string, reason: string) {
  const r = await call(`/api/admin/spots/${encodeURIComponent(spotId)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  revalidatePath('/admin/spots');
  revalidatePath('/admin');
  return r;
}

export async function spotAction(spotId: string, action: 'hide' | 'unhide' | 'feature' | 'unfeature' | 'delete', reason?: string) {
  const r = await call(`/api/admin/spots/${encodeURIComponent(spotId)}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason: reason || '' }),
  });
  revalidatePath('/admin/spots');
  revalidatePath('/admin');
  return r;
}

export async function approveSpotUpload(uploadId: string, approved: boolean, notes?: string) {
  const r = await call(`/api/admin/spot-uploads/${encodeURIComponent(uploadId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ approved, notes: notes || '' }),
  });
  revalidatePath('/admin/spots');
  revalidatePath('/admin');
  return r;
}

// ----- Community -----
export async function moderateCommunity(payload: { target_type: string; target_id: string; action: string; reason?: string }) {
  const r = await call('/api/admin/community/moderate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  revalidatePath('/admin/community');
  revalidatePath('/admin');
  return r;
}

export async function deletePost(postId: string, reason?: string) {
  const r = await call(`/api/admin/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE',
    headers: reason ? { 'X-Reason': reason } : undefined,
  });
  revalidatePath('/admin/community');
  return r;
}

export async function restorePost(postId: string) {
  const r = await call(`/api/admin/posts/${encodeURIComponent(postId)}/restore`, { method: 'POST' });
  revalidatePath('/admin/community');
  return r;
}

// ----- Marketplace -----
export async function moderateProduct(productId: string, decision: 'approve' | 'deny' | 'feature' | 'unfeature' | 'unpublish', reason?: string) {
  const r = await call(`/api/admin/marketplace/products/${encodeURIComponent(productId)}/moderate`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason: reason || '' }),
  });
  revalidatePath('/admin/marketplace');
  revalidatePath('/admin');
  return r;
}

export async function refundPurchase(purchaseId: string, reason?: string) {
  const r = await call(`/api/admin/marketplace/purchases/${encodeURIComponent(purchaseId)}/refund`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason || '' }),
  });
  revalidatePath('/admin/marketplace');
  return r;
}

// ----- Users -----
export async function updateUser(userId: string, patch: Record<string, any>) {
  const r = await call(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  revalidatePath('/admin/users');
  return r;
}

export async function grantPlan(userId: string, plan: 'free' | 'pro' | 'elite', durationDays?: number, note?: string) {
  const r = await call(`/api/admin/users/${encodeURIComponent(userId)}/grant-plan`, {
    method: 'POST',
    body: JSON.stringify({ plan, duration_days: durationDays, note: note || '' }),
  });
  revalidatePath('/admin/users');
  return r;
}

export async function sanctionUser(userId: string, payload: { action: string; reason: string; duration_hours?: number }) {
  const r = await call(`/api/admin/users/${encodeURIComponent(userId)}/sanction`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  revalidatePath('/admin/users');
  return r;
}

export async function unsanctionUser(userId: string) {
  const r = await call(`/api/admin/users/${encodeURIComponent(userId)}/unsanction`, { method: 'POST' });
  revalidatePath('/admin/users');
  return r;
}

// ----- Reports -----
export async function resolveReport(reportId: string, resolution: string, action_taken?: string) {
  const r = await call(`/api/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution, action_taken: action_taken || '' }),
  });
  revalidatePath('/admin/reports');
  revalidatePath('/admin');
  return r;
}
