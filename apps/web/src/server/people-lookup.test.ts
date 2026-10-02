/**
 * GET /api/users (PROF-04, D-024): who may look people up, and which names they receive.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq, schema } from '@socketspace/db';
import { createTestUser } from '@socketspace/db/testing';

import { cookieHeader, createAuthHarness, type AuthHarness } from '../test/auth-harness';
import { lookUpPeople } from './people-lookup';

let h: AuthHarness;
let n = 0;

beforeAll(async () => {
  h = await createAuthHarness();
});

afterAll(async () => {
  await h.close();
});

/** A signed-up, onboarded viewer and their cookie. */
async function viewer(options: { onboarded?: boolean } = {}) {
  n += 1;
  const email = `people${String(n)}@example.test`;
  const result = await h.call('/sign-up/email', {
    body: { email, password: 'correct horse battery staple', name: '' },
  });
  const [row] = await h.db.select().from(schema.user).where(eq(schema.user.email, email));
  if (!row) throw new Error('no user');
  if (options.onboarded ?? true) {
    await h.db
      .update(schema.user)
      .set({ nickname: `viewer${String(n)}`, avatarKind: 'preset', onboardedAt: new Date() })
      .where(eq(schema.user.id, row.id));
  }
  return { id: row.id, cookie: cookieHeader(result.cookies) };
}

const lookUp = (cookie: string | null, ids: string) =>
  lookUpPeople(
    new Request(`http://localhost:3000/api/users?ids=${ids}`, {
      headers: cookie ? { cookie } : {},
    }),
    { auth: h.auth, db: h.db },
  );

describe('GET /api/users', () => {
  it('gives a real name only to a viewer allowed to see it', async () => {
    const me = await viewer();
    const ava = await createTestUser(h.db, { name: 'Ava Chen' });
    const lee = await createTestUser(h.db, { name: 'Lee Secret' });
    await h.db
      .update(schema.user)
      .set({ realNameVisibility: 'contacts', nameDisplay: 'both' })
      .where(eq(schema.user.id, ava.id));
    await h.db
      .update(schema.user)
      .set({ realNameVisibility: 'contacts', nameDisplay: 'both' })
      .where(eq(schema.user.id, lee.id));
    await h.db
      .insert(schema.contact)
      .values({ userId: me.id, contactId: ava.id, source: 'manual' });

    const response = await lookUp(me.cookie, `${ava.id},${lee.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = (await response.json()) as { users: Record<string, unknown>[] };
    expect(body.users).toEqual([
      { id: ava.id, nickname: ava.nickname, avatar: null, realName: 'Ava Chen' },
      { id: lee.id, nickname: lee.nickname, avatar: null },
    ]);
    expect(JSON.stringify(body)).not.toContain('Lee Secret');
  });

  it('refuses people who are signed out or not set up, and bad requests', async () => {
    const half = await viewer({ onboarded: false });
    const me = await viewer();
    const someone = await createTestUser(h.db);
    expect((await lookUp(null, someone.id)).status).toBe(401);
    expect((await lookUp(half.cookie, someone.id)).status).toBe(403);
    expect((await lookUp(me.cookie, '')).status).toBe(400);
    expect((await lookUp(me.cookie, 'not-a-uuid')).status).toBe(400);
    const tooMany = Array.from({ length: 101 }, () => someone.id).join(',');
    expect((await lookUp(me.cookie, tooMany)).status).toBe(400);
  });
});
