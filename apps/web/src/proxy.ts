/**
 * Runs before every page request (Next.js 16 "proxy", formerly middleware): creates a fresh nonce
 * and sends the Content Security Policy that requires it. Next.js reads the policy from the
 * request headers and adds the nonce to its own scripts.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { buildCsp, createNonce } from './server/csp';
import { getWebEnv } from './server/env';

export function proxy(request: NextRequest) {
  const env = getWebEnv();
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    realtimeUrl: env.REALTIME_PUBLIC_URL,
    isDev: env.NODE_ENV === 'development',
    https: env.BETTER_AUTH_URL.startsWith('https://'),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not API routes, build assets or the favicon, and not link prefetches.
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
