import { NextResponse } from 'next/server';

const AUTH_COOKIE = process.env.AUTH_COOKIE_NAME || 'lumascout_session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}

export async function GET() {
  return POST();
}
