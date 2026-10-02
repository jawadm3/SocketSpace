/**
 * Integration tests that need network stubs: breached-password checks (AUTH-07), realtime token
 * signing (RT-01), secure cookies (AUTH-06) and safe account linking for social sign-in
 * (AUTH-10, AUTH-13, decision D-022): Facebook and Microsoft never link by email; GitHub does.
 */
import { createHash } from 'node:crypto';

import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { eq, schema } from '@socketspace/db';
import {
  realtimeTokenClaimsSchema,
  REALTIME_TOKEN_AUDIENCE,
} from '@socketspace/shared/realtime-token';

import { cookieHeader, createAuthHarness, type AuthHarness } from '../test/auth-harness';

const PASSWORD = 'correct horse battery staple';

afterEach(() => {
  vi.unstubAllGlobals();
});

type Route = (url: URL, init: RequestInit | undefined) => Response | undefined;

/** Replaces global fetch with a router; unknown URLs fail loudly. */
function stubFetch(route: Route) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push(`${url.origin}${url.pathname}`);
    const response = route(url, init);
    if (!response) return Promise.reject(new Error(`unexpected fetch ${url.href}`));
    return Promise.resolve(response);
  });
  return calls;
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('breached passwords (AUTH-07)', () => {
  it('refuses a password found in Have I Been Pwned, sending only a 5-character hash prefix', async () => {
    const h = await createAuthHarness({ HIBP_ENABLED: 'true' });
    try {
      const breached = 'password123456';
      const sha1 = createHash('sha1').update(breached).digest('hex').toUpperCase();
      const requested: string[] = [];
      stubFetch((url) => {
        if (url.hostname !== 'api.pwnedpasswords.com') return undefined;
        requested.push(url.pathname);
        return new Response(`${sha1.slice(5)}:52579\r\n0000000000000000000000000000000000A:1`, {
          status: 200,
        });
      });

      const refused = await h.call('/sign-up/email', {
        body: { email: 'breach@example.test', password: breached, name: '' },
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.json)).toContain('data breach');
      expect(requested).toEqual([`/range/${sha1.slice(0, 5)}`]);

      const accepted = await h.call('/sign-up/email', {
        body: { email: 'fine@example.test', password: PASSWORD, name: '' },
      });
      expect(accepted.status).toBe(200);
    } finally {
      await h.close();
    }
  });
});

describe('realtime tokens (RT-01)', () => {
  it('signs a 5-minute EdDSA token with only the claims the realtime server needs', async () => {
    const h = await createAuthHarness();
    try {
      const signUp = await h.call('/sign-up/email', {
        body: { email: 'token@example.test', password: PASSWORD, name: 'Token Person' },
      });
      const session = await h.auth.api.getSession({
        headers: new Headers({ cookie: cookieHeader(signUp.cookies) }),
      });
      if (!session) throw new Error('no session');

      const { token } = await h.auth.api.signJWT({
        body: {
          payload: {
            sub: session.user.id,
            sid: session.session.id,
            role: 'user',
            guest: false,
            iat: Math.floor(Date.now() / 1000),
          },
        },
      });

      const jwks = (await h.call('/jwks')).json as JSONWebKeySet;
      expect(jwks.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA' });
      expect(JSON.stringify(jwks)).not.toContain('"d"'); // no private key material

      const { payload, protectedHeader } = await jwtVerify(token, createLocalJWKSet(jwks), {
        issuer: 'http://localhost:3000',
        audience: REALTIME_TOKEN_AUDIENCE,
      });
      expect(protectedHeader.alg).toBe('EdDSA');
      const claims = realtimeTokenClaimsSchema.parse(payload);
      expect(claims).toMatchObject({ sub: session.user.id, sid: session.session.id, guest: false });
      expect(claims.exp - claims.iat).toBe(300);
      expect(JSON.stringify(payload)).not.toContain('token@example.test');
    } finally {
      await h.close();
    }
  });
});

describe('cookies over HTTPS (AUTH-06)', () => {
  it('uses the __Secure- prefix and the Secure flag', async () => {
    const h = await createAuthHarness({ BETTER_AUTH_URL: 'https://socketspace.example' });
    try {
      const result = await h.call('/sign-up/email', {
        body: { email: 'secure@example.test', password: PASSWORD, name: '' },
      });
      const header = result.setCookieHeaders.find((c) =>
        c.startsWith('__Secure-ss.session_token='),
      );
      expect(header).toBeDefined();
      expect(header).toMatch(/; Secure/i);
      expect(header).toMatch(/HttpOnly/i);
    } finally {
      await h.close();
    }
  });
});

// Social sign-in --------------------------------------------------------------------------------

const PROVIDER_ENV = {
  FACEBOOK_CLIENT_ID: 'fb-test-app',
  FACEBOOK_CLIENT_SECRET: 'fb-test-secret-placeholder',
  GITHUB_CLIENT_ID: 'gh-test-app',
  GITHUB_CLIENT_SECRET: 'gh-test-secret-placeholder',
  MICROSOFT_CLIENT_ID: 'ms-test-app',
  MICROSOFT_CLIENT_SECRET: 'ms-test-secret-placeholder',
};

/** An existing, verified email-and-password account. */
async function existingVerifiedAccount(h: AuthHarness, email: string) {
  await h.call('/sign-up/email', { body: { email, password: PASSWORD, name: '' } });
  await h.db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email));
  const [row] = await h.db.select().from(schema.user).where(eq(schema.user.email, email));
  if (!row) throw new Error('user missing');
  return row;
}

/** Starts a social sign-in and returns the state value and cookies for the callback. */
async function startSocial(h: AuthHarness, provider: string) {
  const start = await h.call('/sign-in/social', {
    body: { provider, callbackURL: '/app', errorCallbackURL: '/sign-in' },
  });
  expect(start.status).toBe(200);
  const url = new URL((start.json as { url: string }).url);
  return { state: url.searchParams.get('state') ?? '', cookie: cookieHeader(start.cookies) };
}

function facebookRoutes(profile: Record<string, unknown>): Route {
  return (url) => {
    if (url.href.startsWith('https://graph.facebook.com/v24.0/oauth/access_token')) {
      return json({ access_token: 'fb-access', token_type: 'bearer', expires_in: 3600 });
    }
    if (url.pathname === '/debug_token') {
      return json({ data: { is_valid: true, app_id: 'fb-test-app', user_id: profile.id } });
    }
    if (url.pathname === '/me') return json(profile);
    return undefined;
  };
}

/**
 * Microsoft's token endpoint returns an ID token; in the sign-in callback Better Auth only decodes
 * it (the code exchange itself is the proof), so an unsigned token is enough for the stub.
 */
function microsoftRoutes(claims: Record<string, unknown>): Route {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const idToken = `${part({ alg: 'none', typ: 'JWT' })}.${part(claims)}.stub`;
  return (url) => {
    if (url.href === 'https://login.microsoftonline.com/common/oauth2/v2.0/token') {
      return json({
        access_token: 'ms-access',
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    // No profile photo.
    if (url.hostname === 'graph.microsoft.com') return new Response(null, { status: 404 });
    return undefined;
  };
}

describe('account linking (AUTH-13, D-022)', () => {
  it('never lets a Facebook sign-in take over an existing account with the same email', async () => {
    const h = await createAuthHarness(PROVIDER_ENV);
    try {
      const ava = await existingVerifiedAccount(h, 'ava@example.test');
      const { state, cookie } = await startSocial(h, 'facebook');
      // Facebook even claims the email is verified: it must still not link.
      stubFetch(
        facebookRoutes({
          id: 'fb-123',
          name: 'Ava Chen',
          email: 'ava@example.test',
          email_verified: true,
          picture: { data: { url: 'https://example.test/ava.jpg' } },
        }),
      );
      const callback = await h.call('/callback/facebook', {
        query: { code: 'test-code', state },
        cookie,
      });
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toContain('error=');
      expect([...callback.cookies.keys()].some((name) => name.endsWith('session_token'))).toBe(
        false,
      );

      const accounts = await h.db
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, ava.id));
      expect(accounts.map((a) => a.providerId)).toEqual(['credential']);
    } finally {
      await h.close();
    }
  });

  it('never lets a Microsoft sign-in take over an existing account with the same email', async () => {
    const h = await createAuthHarness(PROVIDER_ENV);
    try {
      const lee = await existingVerifiedAccount(h, 'lee@example.test');
      const { state, cookie } = await startSocial(h, 'microsoft');
      // Microsoft also claims the email is verified: it must still not link.
      stubFetch(
        microsoftRoutes({
          oid: '00000000-0000-0000-0000-00000000c0de',
          tid: '9188040d-6c67-4c5b-b112-36a304b66dad',
          name: 'Lee Example',
          email: 'lee@example.test',
          email_verified: true,
        }),
      );
      const callback = await h.call('/callback/microsoft', {
        query: { code: 'test-code', state },
        cookie,
      });
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toContain('error=');
      expect([...callback.cookies.keys()].some((name) => name.endsWith('session_token'))).toBe(
        false,
      );

      const accounts = await h.db
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, lee.id));
      expect(accounts.map((a) => a.providerId)).toEqual(['credential']);
    } finally {
      await h.close();
    }
  });

  it('creates a separate, unverified account for a new Facebook user, without the photo', async () => {
    const h = await createAuthHarness(PROVIDER_ENV);
    try {
      const { state, cookie } = await startSocial(h, 'facebook');
      stubFetch(
        facebookRoutes({
          id: 'fb-456',
          name: '  Sam   Rivera ',
          email: 'sam@example.test',
          email_verified: true,
          picture: { data: { url: 'https://example.test/sam.jpg' } },
        }),
      );
      const callback = await h.call('/callback/facebook', { query: { code: 'c', state }, cookie });
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toBe('/app');

      const [sam] = await h.db
        .select()
        .from(schema.user)
        .where(eq(schema.user.email, 'sam@example.test'));
      expect(sam?.emailVerified).toBe(false);
      expect(sam?.name).toBe('Sam Rivera');
      expect(sam?.realNameVisibility).toBe('nobody');
      expect(sam?.image).toBeNull();
    } finally {
      await h.close();
    }
  });

  it('links a GitHub sign-in to the existing account (GitHub emails are trusted)', async () => {
    const h = await createAuthHarness(PROVIDER_ENV);
    try {
      const kim = await existingVerifiedAccount(h, 'kim@example.test');
      const { state, cookie } = await startSocial(h, 'github');
      stubFetch((url) => {
        if (url.href === 'https://github.com/login/oauth/access_token') {
          return json({
            access_token: 'gh-access',
            token_type: 'bearer',
            scope: 'read:user,user:email',
          });
        }
        if (url.href === 'https://api.github.com/user') {
          return json({
            id: 4242,
            login: 'kim',
            name: 'Kim Park',
            email: 'kim@example.test',
            avatar_url: '',
          });
        }
        if (url.href === 'https://api.github.com/user/emails') {
          return json([{ email: 'kim@example.test', primary: true, verified: true }]);
        }
        return undefined;
      });
      const callback = await h.call('/callback/github', { query: { code: 'c', state }, cookie });
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toBe('/app');

      const accounts = await h.db
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, kim.id));
      expect(accounts.map((a) => a.providerId).sort()).toEqual(['credential', 'github']);
      // Provider tokens are stored encrypted, never in plain text.
      const github = accounts.find((a) => a.providerId === 'github');
      expect(github?.accessToken).not.toBe('gh-access');
    } finally {
      await h.close();
    }
  });
});
