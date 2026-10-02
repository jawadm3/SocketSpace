/**
 * GET /api/rooms/[slug]/messages (HIST-02): pages by message number, the room page's read rules,
 * and nothing about private rooms for outsiders.
 */
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq, roomBanUser, roomCreate, schema, sendMessage } from '@socketspace/db';
import { createTestUser } from '@socketspace/db/testing';
import type { MessageWire } from '@socketspace/shared/events';

import { cookieHeader, createAuthHarness, type AuthHarness } from '../test/auth-harness';
import { loadRoomHistory, type HistoryPage } from './room-history';

let h: AuthHarness;
let n = 0;

beforeAll(async () => {
  h = await createAuthHarness();
});

afterAll(async () => {
  await h.close();
});

/** A signed-up, onboarded viewer and their cookie. */
async function viewer() {
  n += 1;
  const email = `history${String(n)}@example.test`;
  const result = await h.call('/sign-up/email', {
    body: { email, password: 'correct horse battery staple', name: '' },
  });
  const [row] = await h.db.select().from(schema.user).where(eq(schema.user.email, email));
  if (!row) throw new Error('no user');
  await h.db
    .update(schema.user)
    .set({ nickname: `reader${String(n)}`, avatarKind: 'preset', onboardedAt: new Date() })
    .where(eq(schema.user.id, row.id));
  return { id: row.id, cookie: cookieHeader(result.cookies) };
}

async function roomWithMessages(visibility: 'public' | 'private', count: number) {
  const owner = await createTestUser(h.db);
  n += 1;
  const created = await roomCreate(h.db, owner.id, {
    slug: `history-${String(n)}-${uuidv4().slice(0, 6)}`,
    name: 'History',
    topic: '',
    visibility,
  });
  if (!created.ok) throw new Error(created.reason);
  for (let i = 1; i <= count; i++) {
    const sent = await sendMessage(h.db, {
      conversationId: created.room.id,
      authorId: owner.id,
      clientId: uuidv4(),
      body: `message ${String(i)}`,
    });
    if (!sent.ok) throw new Error(sent.reason);
  }
  return { owner, room: created.room };
}

const history = (cookie: string | null, slug: string, query: string) =>
  loadRoomHistory(
    new Request(`http://localhost:3000/api/rooms/${slug}/messages?${query}`, {
      headers: cookie ? { cookie } : {},
    }),
    slug,
    { auth: h.auth, db: h.db },
  );

const bodies = (messages: MessageWire[]) => messages.map((m) => m.body);

describe('GET /api/rooms/[slug]/messages', () => {
  it('pages backwards by message number and says when the start is reached', async () => {
    const me = await viewer();
    const { owner, room } = await roomWithMessages('public', 7);

    const first = await history(me.cookie, room.slug, 'before=8&limit=3');
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    const page1 = (await first.json()) as HistoryPage;
    expect(bodies(page1.messages)).toEqual(['message 5', 'message 6', 'message 7']);
    expect(page1.hasMore).toBe(true);
    expect(page1.users.map((u) => u.id)).toEqual([owner.id]);

    // New messages arriving meanwhile do not shift the next page.
    await sendMessage(h.db, {
      conversationId: room.id,
      authorId: owner.id,
      clientId: uuidv4(),
      body: 'late arrival',
    });
    const oldest = page1.messages[0]?.seq ?? 0;
    const page2 = (await (
      await history(me.cookie, room.slug, `before=${String(oldest)}&limit=3`)
    ).json()) as HistoryPage;
    expect(bodies(page2.messages)).toEqual(['message 2', 'message 3', 'message 4']);
    expect(page2.hasMore).toBe(true);

    const last = (await (
      await history(me.cookie, room.slug, `before=${String(page2.messages[0]?.seq ?? 0)}`)
    ).json()) as HistoryPage;
    expect(bodies(last.messages)).toEqual(['message 1']);
    expect(last.hasMore).toBe(false);
  });

  it('shows nothing of private rooms to outsiders, and nothing to someone banned', async () => {
    const outsider = await viewer();
    const { room } = await roomWithMessages('private', 2);
    const hidden = await history(outsider.cookie, room.slug, 'before=100');
    const missing = await history(outsider.cookie, 'no-such-room', 'before=100');
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual(await missing.json());

    const banned = await viewer();
    const open = await roomWithMessages('public', 2);
    const ban = await roomBanUser(h.db, open.owner.id, open.room.id, banned.id, null, 'spam');
    if (!ban.ok) throw new Error(ban.reason);
    expect((await history(banned.cookie, open.room.slug, 'before=100')).status).toBe(404);
  });

  it('refuses people who are signed out, and malformed requests', async () => {
    const me = await viewer();
    const { room } = await roomWithMessages('public', 1);
    expect((await history(null, room.slug, 'before=10')).status).toBe(401);
    for (const query of ['', 'before=0', 'before=-1', 'before=abc', 'before=5&limit=151']) {
      expect((await history(me.cookie, room.slug, query)).status).toBe(400);
    }
  });
});
