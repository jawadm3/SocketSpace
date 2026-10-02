/**
 * `POST /api/realtime/token`: gives a signed-in browser a 5-minute token for the realtime server
 * (realtime-protocol.md, "Connecting"; security.md 3.6).
 *
 * The browser sends its session cookie; this handler checks the request really comes from our own
 * pages, that the session and account are in good standing, and that the person is not asking too
 * often, then signs a token containing only: user ID, session ID, role and whether it is a guest.
 */
import 'server-only';

import { getConnectionProfile, hitRateLimit, type Database } from '@socketspace/db';
import { LIMITS } from '@socketspace/shared/limits';

import { SESSION_ABSOLUTE_MS, type Auth } from './auth';
import type { WebEnv } from './env';

/** Tokens per person per minute. Normal use is about one per reconnect. */
export const TOKEN_REQUESTS_PER_MINUTE = 30;

export interface TokenResponseBody {
  token: string;
  /** Where to connect. Given here so the browser bundle contains no server address. */
  url: string;
  expiresAt: string;
}

interface ErrorBody {
  error: { code: string; message: string; retryAfterMs?: number };
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, string> = {},
  retryAfterMs?: number,
) {
  const body: ErrorBody = {
    error: retryAfterMs === undefined ? { code, message } : { code, message, retryAfterMs },
  };
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
}

export async function issueRealtimeToken(
  request: Request,
  deps: { auth: Auth; db: Database; env: WebEnv },
): Promise<Response> {
  const { auth, db, env } = deps;

  // Only our own pages may ask (CSRF defence; browsers always send Origin on POST).
  const ownOrigin = new URL(env.BETTER_AUTH_URL).origin;
  const site = request.headers.get('sec-fetch-site');
  if (request.headers.get('origin') !== ownOrigin || (site !== null && site !== 'same-origin')) {
    return errorResponse(403, 'FORBIDDEN', 'This request must come from SocketSpace itself.');
  }

  const current = await auth.api.getSession({ headers: request.headers });
  if (!current || Date.now() - current.session.createdAt.getTime() > SESSION_ABSOLUTE_MS) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Please sign in again.');
  }

  const profile = await getConnectionProfile(db, current.user.id);
  if (profile?.status !== 'active') {
    return errorResponse(403, 'FORBIDDEN', 'This account is suspended or closed.');
  }

  const limit = await hitRateLimit(
    db,
    `rt-token:${current.user.id}`,
    TOKEN_REQUESTS_PER_MINUTE,
    60,
  );
  if (!limit.allowed) {
    return errorResponse(
      429,
      'RATE_LIMITED',
      'Too many connection attempts. Please wait a moment.',
      { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) },
      limit.retryAfterMs,
    );
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const { token } = await auth.api.signJWT({
    body: {
      payload: {
        sub: current.user.id,
        sid: current.session.id,
        role: profile.role,
        guest: profile.isAnonymous,
        iat: issuedAt,
      },
    },
  });

  const body: TokenResponseBody = {
    token,
    url: env.REALTIME_PUBLIC_URL,
    expiresAt: new Date((issuedAt + LIMITS.realtimeToken.ttlSeconds) * 1000).toISOString(),
  };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
