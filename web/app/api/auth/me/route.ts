import { NextResponse } from 'next/server';
import { apiTry } from '@/lib/api';

export async function GET() {
  const me = await apiTry<any>('/api/auth/me', null, { revalidate: 0 });
  if (!me) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({ user: me });
}
