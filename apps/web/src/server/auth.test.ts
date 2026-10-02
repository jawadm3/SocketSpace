/**
 * Integration tests of the real sign-in configuration (requirements AUTH-01 to AUTH-03,
 * AUTH-06 to AUTH-09, SEC-03), run through Better Auth's HTTP handler on PGlite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq, schema } from '@socketspace/db';

import { cookieHeader, createAuthHarness, nextIp, type AuthHarness } from '../test/auth-harness';

let h: AuthHarness;
let counter = 0;

beforeAll(async () => {
  h = await createAuthHarness();
});

afterAll(async () => {
  await h.close();
});

const PASSWORD = 'correct horse battery staple';

function freshEmail(): string {
  counter += 1;
  return `Person${String(counter)}@Example.test`;
}

async function signUp(email = freshEmail(), password = PASSWORD) {
  const result = await h.call('/sign-up/email', { body: { email, password, name: '' } });
  await h.flush();
  return { email, result };
}

async function userRow(email: string) {
  const [row] = await h.db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email.toLowerCase()));
  return row;
}

describe('sign-up (AUTH-01)', () => {
  it('creates an unverified account with a UUID v7 ID, a lower-cased email and no real name', async () => {
    const { email, result } = await signUp();
    expect(result.status).toBe(200);
    const row = await userRow(email);
    expect(row?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(row?.email).toBe(email.toLowerCase());
    expect(row?.emailVerified).toBe(false);
    expect(row?.name).toBe('');
    expect(row?.nickname).toBeNull();
    expect(row?.onboardedAt).toBeNull();
    expect(row?.realNameVisibility).toBe('nobody');
    expect(row?.theme).toBe('airmail');
  });

  it('signs the new user in with a secure session cookie', async () => {
    const { result } = await signUp();
    const header = result.setCookieHeaders.find((c) => c.startsWith('ss.session_token='));
    expect(header).toBeDefined();
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
  });

  it('refuses passwords shorter than 10 or longer than 128 characters', async () => {
    expect((await signUp(freshEmail(), 'short1234')).result.status).toBe(400);
    expect((await signUp(freshEmail(), 'x'.repeat(129))).result.status).toBe(400);
    expect((await signUp(freshEmail(), 'x'.repeat(128))).result.status).toBe(200);
  });

  it('stores only a password hash, never the password', async () => {
    const { email } = await signUp();
    const row = await userRow(email);
    const [account] = await h.db
      .select()
      .from(schema.account)
      .where(eq(schema.account.userId, row?.id ?? ''));
    expect(account?.providerId).toBe('credential');
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain(PASSWORD);
  });
});

describe('email verification (AUTH-02)', () => {
  it('sends a verification link that verifies the account', async () => {
    const { email } = await signUp();
    const message = h.mail.latestTo(email.toLowerCase());
    expect(message?.kind).toBe('verify-email');
    expect(message?.html).not.toContain('<script');
    const link = /https?:\/\/\S+verify-email\S+/.exec(message?.text ?? '')?.[0];
    expect(link).toBeDefined();

    const url = new URL(link ?? '');
    const token = url.searchParams.get('token') ?? '';
    const result = await h.call('/verify-email', { query: { token } });
    expect([200, 302]).toContain(result.status);
    expect((await userRow(email))?.emailVerified).toBe(true);
  });

  it('refuses a tampered token', async () => {
    const result = await h.call('/verify-email', { query: { token: 'not-a-real-token' } });
    expect(result.status).toBeGreaterThanOrEqual(300);
    expect(result.status).not.toBe(200);
  });
});

describe('no account enumeration (AUTH-09)', () => {
  it('answers a reset request the same way for known and unknown emails', async () => {
    const { email } = await signUp();
    const known = await h.call('/request-password-reset', {
      body: { email, redirectTo: '/reset-password' },
    });
    const unknown = await h.call('/request-password-reset', {
      body: { email: 'nobody-here@example.test', redirectTo: '/reset-password' },
    });
    expect(known.status).toBe(unknown.status);
    expect(known.json).toEqual(unknown.json);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { email } = await signUp();
    const wrong = await h.call('/sign-in/email', { body: { email, password: 'wrong password!!' } });
    const unknown = await h.call('/sign-in/email', {
      body: { email: 'ghost@example.test', password: 'wrong password!!' },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json).toEqual(unknown.json);
  });
});

describe('password reset (AUTH-03)', () => {
  it('uses a single-use link, valid for 30 minutes, and signs out every session', async () => {
    const { email, result: signUpResult } = await signUp();
    const oldCookie = cookieHeader(signUpResult.cookies);
    expect((await h.call('/get-session', { cookie: oldCookie })).json).not.toBeNull();

    await h.call('/request-password-reset', { body: { email, redirectTo: '/reset-password' } });
    await h.flush();
    const message = h.mail.latestTo(email.toLowerCase());
    expect(message?.kind).toBe('reset-password');
    const token = /reset-password\/([^?\s]+)/.exec(message?.text ?? '')?.[1] ?? '';
    expect(token).not.toBe('');

    const [stored] = await h.db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, `reset-password:${token}`));
    const minutes = ((stored?.expiresAt.getTime() ?? 0) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);

    const newPassword = 'a brand new passphrase';
    const reset = await h.call('/reset-password', { body: { token, newPassword } });
    expect(reset.status).toBe(200);
    await h.flush();

    // Old session gone, new password works, link cannot be used twice.
    expect((await h.call('/get-session', { cookie: oldCookie })).json).toBeNull();
    const signIn = await h.call('/sign-in/email', { body: { email, password: newPassword } });
    expect(signIn.status).toBe(200);
    const again = await h.call('/reset-password', {
      body: { token, newPassword: 'yet another passphrase' },
    });
    expect(again.status).toBe(400);

    const userId = (await userRow(email))?.id;
    expect(h.notifier.events).toContainEqual({ type: 'user.sessions_revoked', userId });
  });
});

describe('sign-in limits (AUTH-08)', () => {
  it('refuses the 4th sign-in attempt from one IP within 10 seconds, with a retry time', async () => {
    const { email } = await signUp();
    const ip = nextIp();
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const r = await h.call('/sign-in/email', {
        ip,
        body: { email, password: 'wrong password!!' },
      });
      statuses.push(r.status);
      if (r.status === 429) expect(Number(r.headers.get('x-retry-after'))).toBeGreaterThan(0);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('locks an account after 10 failures, even from different IPs and with the right password', async () => {
    const { email } = await signUp();
    for (let i = 0; i < 10; i++) {
      const r = await h.call('/sign-in/email', { body: { email, password: 'wrong password!!' } });
      expect(r.status).toBe(401);
    }
    const locked = await h.call('/sign-in/email', { body: { email, password: PASSWORD } });
    expect(locked.status).toBe(429);
    expect(JSON.stringify(locked.json)).toContain('Try again in 1 minute');
  });

  it('locks unknown emails the same way (the lock reveals nothing)', async () => {
    const email = 'nobody-at-all@example.test';
    for (let i = 0; i < 10; i++) {
      await h.call('/sign-in/email', { body: { email, password: 'wrong password!!' } });
    }
    const locked = await h.call('/sign-in/email', {
      body: { email, password: 'wrong password!!' },
    });
    expect(locked.status).toBe(429);
  });

  it('clears the failure count after a successful sign-in', async () => {
    const { email } = await signUp();
    for (let i = 0; i < 9; i++) {
      await h.call('/sign-in/email', { body: { email, password: 'wrong password!!' } });
    }
    expect((await h.call('/sign-in/email', { body: { email, password: PASSWORD } })).status).toBe(
      200,
    );
    // Nine more failures would lock a stale count; after clearing they do not.
    for (let i = 0; i < 9; i++) {
      await h.call('/sign-in/email', { body: { email, password: 'wrong password!!' } });
    }
    expect((await h.call('/sign-in/email', { body: { email, password: PASSWORD } })).status).toBe(
      200,
    );
  });
});

describe('account status', () => {
  it('refuses to start a session for a suspended account', async () => {
    const { email } = await signUp();
    await h.db
      .update(schema.user)
      .set({ status: 'suspended' })
      .where(eq(schema.user.email, email.toLowerCase()));
    const result = await h.call('/sign-in/email', { body: { email, password: PASSWORD } });
    expect(result.status).toBe(403);
    expect(JSON.stringify(result.json)).toContain('ACCOUNT_INACTIVE');
  });
});

describe('CSRF and exposed endpoints (SEC-03)', () => {
  it('refuses state-changing requests from another origin', async () => {
    const result = await h.call('/sign-up/email', {
      origin: 'https://evil.example',
      body: { email: freshEmail(), password: PASSWORD, name: '' },
    });
    expect(result.status).toBe(403);
  });

  it('refuses cross-site browser requests even with a forged Origin', async () => {
    const result = await h.call('/sign-in/email', {
      headers: { 'sec-fetch-site': 'cross-site' },
      body: { email: freshEmail(), password: PASSWORD },
    });
    expect(result.status).toBe(403);
  });

  it('accepts requests without an Origin (non-browser clients cannot carry CSRF)', async () => {
    const result = await h.call('/sign-up/email', {
      origin: null,
      body: { email: freshEmail(), password: PASSWORD, name: '' },
    });
    expect(result.status).toBe(200);
  });

  it.each([
    '/update-user',
    '/update-session',
    '/change-email',
    '/delete-user',
    '/revoke-session',
    '/revoke-sessions',
    '/revoke-other-sessions',
    '/get-access-token',
    '/refresh-token',
    '/account-info',
    '/token',
  ])('does not offer %s over HTTP', async (path) => {
    const { result } = await signUp();
    const cookie = cookieHeader(result.cookies);
    const response = await h.call(path, { cookie, body: {} });
    expect(response.status).toBe(404);
  });

  it('sends no realtime token header on get-session', async () => {
    const { result } = await signUp();
    const response = await h.call('/get-session', { cookie: cookieHeader(result.cookies) });
    expect(response.headers.get('set-auth-jwt')).toBeNull();
  });
});

describe('guests (D-025)', () => {
  it('creates an anonymous account with a placeholder address and sends it no email', async () => {
    const before = h.mail.sent.length;
    const result = await h.call('/sign-in/anonymous', { body: {} });
    await h.flush();
    expect(result.status).toBe(200);
    const user = (result.json as { user: { email: string; isAnonymous: boolean; name: string } })
      .user;
    expect(user.isAnonymous).toBe(true);
    expect(user.email).toMatch(/@guest\.socketspace\.invalid$/);
    expect(user.name).toBe('');
    expect(h.mail.sent.length).toBe(before);
  });
});

describe('signing in again after a session ended elsewhere (regression)', () => {
  it('sets a fresh session cookie even when the browser still holds the dead one', async () => {
    const { email, result } = await signUp();
    const deadCookie = cookieHeader(result.cookies);
    const userId = (await userRow(email))?.id ?? '';
    // The session ends somewhere else (for example a password reset on another device).
    await h.db.delete(schema.session).where(eq(schema.session.userId, userId));

    const signIn = await h.call('/sign-in/email', {
      cookie: deadCookie,
      body: { email, password: PASSWORD },
    });
    expect(signIn.status).toBe(200);
    const fresh = signIn.cookies.get('ss.session_token');
    expect(fresh).toBeTruthy();
    const session = await h.call('/get-session', { cookie: `ss.session_token=${fresh ?? ''}` });
    expect((session.json as { user: { id: string } } | null)?.user.id).toBe(userId);
  });

  it('still upgrades a live guest session into the new account (guest removed)', async () => {
    const guest = await h.call('/sign-in/anonymous', { body: {} });
    const guestId = (guest.json as { user: { id: string } }).user.id;
    const email = freshEmail();
    const upgrade = await h.call('/sign-up/email', {
      cookie: cookieHeader(guest.cookies),
      body: { email, password: PASSWORD, name: '' },
    });
    expect(upgrade.status).toBe(200);
    const [stillThere] = await h.db.select().from(schema.user).where(eq(schema.user.id, guestId));
    expect(stillThere).toBeUndefined();
  });
});
