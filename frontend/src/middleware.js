import { NextResponse } from 'next/server';
import { getCookieName, verifySessionToken } from '@/lib/auth';

const PUBLIC_UI = new Set(['/login']);
const PUBLIC_API = new Set(['/api/auth/login', '/api/auth/logout']);

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_UI.has(pathname) || PUBLIC_API.has(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(getCookieName())?.value;
  const session = await verifySessionToken(token);
  if (session) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { detail: 'Unauthorized', detail_key: 'errors.unauthorized' },
      { status: 401 }
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon|.*\\.(?:png|jpg|jpeg|svg|ico|webp|avif)$).*)'],
};
