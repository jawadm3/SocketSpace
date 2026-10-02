/**
 * GET /api/avatar?c=<settings>: renders a generated avatar to SVG on our own server (D-023).
 *
 * The settings are public (they are what everyone's browser shows), so no sign-in is needed, and
 * the answer depends only on the URL, so it is cached for a year. The SVG is served with a policy
 * that allows no scripts, in case someone opens it directly instead of through an <img>.
 */
import type { NextRequest } from 'next/server';

import { avatarConfigSchema } from '@socketspace/shared/profile';

import { renderAvatarSvg } from '@/server/avatar';

function decode(raw: string): unknown {
  if (raw.length === 0 || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function GET(request: NextRequest): Response {
  const config = avatarConfigSchema.safeParse(decode(request.nextUrl.searchParams.get('c') ?? ''));
  const svg = config.success ? renderAvatarSvg(config.data, 128) : null;
  if (!svg) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
