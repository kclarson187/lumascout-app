import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8001';
const AUTH_COOKIE = process.env.AUTH_COOKIE_NAME || 'lumascout_session';

export async function GET() {
  const c = await cookies();
  const token = c.get(AUTH_COOKIE)?.value;
  if (!token) return NextResponse.json({ user: null }, { status: 200 });

  try {
    const upstream = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!upstream.ok) return NextResponse.json({ user: null }, { status: 200 });
    const user = await upstream.json();
    return NextResponse.json({ user }, { status: 200 });
  } catch {
    return NextResponse.json({ user: null }, { status: 200 });
  }
}
