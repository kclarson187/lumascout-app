import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8001';
const AUTH_COOKIE = process.env.AUTH_COOKIE_NAME || 'lumascout_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const { email, password, name, specialties } = body;
  if (!email || !password || !name) {
    return NextResponse.json({ error: 'Name, email and password are required.' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password, name, specialties: specialties || [] }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'Auth server unreachable.' }, { status: 502 });
  }

  const text = await upstream.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: data?.detail || 'Could not create account.' },
      { status: upstream.status || 400 },
    );
  }

  const token: string | undefined = data?.token;
  if (!token) {
    return NextResponse.json({ error: 'Malformed auth response.' }, { status: 502 });
  }

  const res = NextResponse.json({ user: data.user || null, ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
