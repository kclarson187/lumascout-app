/**
 * POST /api/auth/login
 * Proxies the login against the real FastAPI backend, then sets the JWT as
 * an httpOnly cookie so it is never exposed to client JS. Returns minimal
 * user shape to the caller.
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_BASE, AUTH_COOKIE } from '@/lib/api';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const r = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: body.email, password: body.password }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(data || { detail: 'login failed' }, { status: r.status });
    }
    const token: string | undefined = data.token || data.access_token;
    if (!token) {
      return NextResponse.json({ detail: 'No token issued' }, { status: 500 });
    }
    const res = NextResponse.json({ user: data.user || data.profile || null });
    res.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ detail: e?.message || 'login error' }, { status: 500 });
  }
}
