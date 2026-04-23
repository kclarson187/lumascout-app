import { NextRequest, NextResponse } from 'next/server';

// Routes that require authentication. Non-authed visits redirect to /login?next=...
const PROTECTED = [/^\/app(\/|$)/, /^\/dashboard(\/|$)/, /^\/inbox(\/|$)/, /^\/seller(\/|$)/, /^\/admin(\/|$)/];
const AUTH_COOKIE = process.env.AUTH_COOKIE_NAME || 'lumascout_session';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const protectedRoute = PROTECTED.some((p) => p.test(pathname));
  if (!protectedRoute) return NextResponse.next();

  const hasToken = req.cookies.get(AUTH_COOKIE)?.value;
  if (hasToken) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?)$).*)'],
};
