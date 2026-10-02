import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq, schema, sql } from '@socketspace/db';
import { rowsOf } from '@socketspace/db/testing';
import {
  REALTIME_TOKEN_AUDIENCE,
  realtimeTokenClaimsSchema,
} from '@socketspace/shared/realtime-token';

import { cookieHeader, createAuthHarness, type AuthHarness } from '../test/auth-harness';
import {
  issueRealtimeToken,
  TOKEN_REQUESTS_PER_MINUTE,
  type TokenResponseBody,
} from './realtime-token';

let h: AuthHarness;
let n = 0;

beforeAll(async () => {
  h = await createAuthHarness();
});

afterAll(async () => {
  await h.close();
});

async function signedInCookie(): Promise<{ cookie: string; email: string }> {
  n += 1;
  const email = `rt${String(n)}@example.test`;
  const result = await h.call('/sign-up/email', {
    body: { email, password: 'correct horse battery staple', name: '' },
  });
  return { cookie: cookieHeader(result.cookies), email };
}

function tokenRequest(cookie: string | null, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/realtime/token', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'sec-fetch-site': 'same-origin',
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
  });
}

const issue = (request: Request) =>
  issueRealtimeToken(request, { auth: h.auth, db: h.db, env: h.env });

describe('POST /api/realtime/token', () => {
  it('returns a verifiable token, the realtime URL and the expiry, never cached', async () => {
    const { cookie } = await signedInCookie();
    const response = await issue(tokenRequest(cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as TokenResponseBody;
    expect(body.url).toBe('http://localhost:4000');
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeGreaterThan(290_000);

    const jwks = (await h.call('/jwks')).json as JSONWebKeySet;
    const { payload } = await jwtVerify(body.token, createLocalJWKSet(jwks), {
      issuer: 'http://localhost:3000',
      audience: REALTIME_TOKEN_AUDIENCE,
    });
    const claims = realtimeTokenClaimsSchema.parse(payload);
    expect(claims.role).toBe('user');
    expect(claims.guest).toBe(false);
  });

  it('marks guest tokens as guests', async () => {
    const guest = await h.call('/sign-in/anonymous', { body: {} });
    const response = await issue(tokenRequest(cookieHeader(guest.cookies)));
    const { token } = (await response.json()) as TokenResponseBody;
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
      guest: boolean;
    };
    expect(payload.guest).toBe(true);
  });

  it('refuses requests without a session', async () => {
    expect((await issue(tokenRequest(null))).status).toBe(401);
  });

  it('refuses requests from other sites (CSRF)', async () => {
    const { cookie } = await signedInCookie();
    expect((await issue(tokenRequest(cookie, { origin: 'https://evil.example' }))).status).toBe(
      403,
    );
    expect((await issue(tokenRequest(cookie, { 'sec-fetch-site': 'cross-site' }))).status).toBe(
      403,
    );
    const noOrigin = new Request('http://localhost:3000/api/realtime/token', {
      method: 'POST',
      headers: { cookie },
    });
    expect((await issue(noOrigin)).status).toBe(403);
  });

  it('refuses suspended accounts even with a live session', async () => {
    const { cookie, email } = await signedInCookie();
    await h.db.update(schema.user).set({ status: 'suspended' }).where(eq(schema.user.email, email));
    expect((await issue(tokenRequest(cookie))).status).toBe(403);
  });

  it(`allows ${String(TOKEN_REQUESTS_PER_MINUTE)} tokens a minute, then asks the browser to wait`, async () => {
    const { cookie } = await signedInCookie();
    // The limit counts per clock minute on the database clock. Start well inside a minute, so the
    // requests never straddle a boundary (that reset the count and made this test flaky in CI).
    const [clock] = rowsOf<{ t: string }>(
      await h.db.execute(sql`select extract(epoch from now())::text as t`),
    );
    const secondsIn = Number(clock?.t ?? 0) % 60;
    if (secondsIn > 40) await new Promise((done) => setTimeout(done, (61 - secondsIn) * 1000));
    for (let i = 0; i < TOKEN_REQUESTS_PER_MINUTE; i++) {
      expect((await issue(tokenRequest(cookie))).status).toBe(200);
    }
    const limited = await issue(tokenRequest(cookie));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
