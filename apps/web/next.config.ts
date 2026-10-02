import { resolve } from 'node:path';

import type { NextConfig } from 'next';

/**
 * Headers that do not depend on the request. The Content Security Policy needs a fresh nonce per
 * request, so it is set in src/proxy.ts instead (security.md 3.5).
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
];

const config: NextConfig = {
  // The Docker image (apps/web/Dockerfile) sets NEXT_OUTPUT=standalone to get a self-contained
  // server. Vercel builds leave it unset. The tracing root is the repository, so the shared
  // workspace packages are included.
  ...(process.env.NEXT_OUTPUT === 'standalone' && {
    output: 'standalone' as const,
    outputFileTracingRoot: resolve(import.meta.dirname, '..', '..'),
  }),
  // Workspace packages export TypeScript source; Next.js compiles them with the app.
  transpilePackages: ['@socketspace/db', '@socketspace/shared'],
  poweredByHeader: false,
  reactStrictMode: true,
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default config;
