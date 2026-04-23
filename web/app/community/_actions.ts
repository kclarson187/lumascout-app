'use server';

// Server actions for community interactions (like, comment, vote).
// Web-only. Uses existing backend endpoints. Zero mobile / backend changes.
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8001';
const AUTH_COOKIE = process.env.AUTH_COOKIE_NAME || 'lumascout_session';

async function authHeader(): Promise<Record<string, string>> {
  const c = await cookies();
  const token = c.get(AUTH_COOKIE)?.value;
  if (!token) throw new Error('Sign in to continue.');
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
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
  return data as T;
}

export async function togglePostLike(postId: string, currentlyLiked: boolean) {
  const path = `/api/posts/${encodeURIComponent(postId)}/like`;
  await call(path, { method: currentlyLiked ? 'DELETE' : 'POST' });
  revalidatePath('/community');
  revalidatePath('/dashboard/feed');
  revalidatePath(`/post/${postId}`);
  return { liked: !currentlyLiked };
}

export async function commentOnPost(postId: string, text: string) {
  const body = (text || '').trim();
  if (!body) throw new Error('Comment is empty');
  const r = await call(`/api/posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text: body }),
  });
  revalidatePath(`/post/${postId}`);
  return r;
}

export async function voteOnPoll(postId: string, optionIndex: number) {
  await call(`/api/posts/${encodeURIComponent(postId)}/vote`, {
    method: 'POST',
    body: JSON.stringify({ option_index: optionIndex }),
  });
  revalidatePath('/community');
  revalidatePath('/dashboard/feed');
  revalidatePath(`/post/${postId}`);
}

export async function reportPost(postId: string, reason: string) {
  const r = await call(`/api/reports`, {
    method: 'POST',
    body: JSON.stringify({ target_type: 'post', target_id: postId, reason }),
  });
  return r;
}
