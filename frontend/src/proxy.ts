import { NextResponse, type NextRequest } from 'next/server';
import { safeReturnPath } from './lib/return-path';

const protectedPrefixes = [
  '/workspace',
  '/settings',
  '/organizations',
  '/platform',
  '/onboarding',
];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const present = [
    'better-auth.session_token',
    '__Secure-better-auth.session_token',
  ].some((name) => request.cookies.has(name));
  const isProtectedRoute = protectedPrefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (isProtectedRoute && !present) {
    const url = new URL('/sign-in', request.url);
    url.searchParams.set(
      'returnTo',
      safeReturnPath(path + request.nextUrl.search),
    );
    return NextResponse.redirect(url);
  }
  if (['/sign-in', '/sign-up'].includes(path) && present)
    return NextResponse.redirect(new URL('/workspace', request.url));
  return NextResponse.next();
}
export const config = {
  matcher: [
    '/workspace/:path*',
    '/settings/:path*',
    '/organizations/:path*',
    '/platform/:path*',
    '/onboarding/:path*',
    '/sign-in',
    '/sign-up',
  ],
};
