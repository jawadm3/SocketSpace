import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../schema/_common';
import { user } from '../schema/auth';
import { conversation, conversationMember, roomBan } from '../schema/conversations';
import { block } from '../schema/social';
import { userSanction } from '../schema/safety';
import {
  createTestDatabase,
  createTestDm,
  createTestRoom,
  createTestUser,
  type TestDatabase,
} from '../testing';
import { listEventsSince, sendMessage, type SendMessageResult } from './messages';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

function send(conversationId: string, authorId: string, body = 'hello', extra = {}) {
  return sendMessage(t.db, { conversationId, authorId, clientId: uuidv4(), body, ...extra });
}

function expectOk(result: SendMessageResult) {
  if (!result.ok) throw new Error(`expected ok, got refusal "${result.reason}"`);
  return result;
}

async function counter(conversationId: string): Promise<number> {
  const [row] = await t.db
    .select({ seq: conversation.lastEventSeq })
    .from(conversation)
    .where(eq(conversation.id, conversationId));
  return row?.seq ?? -1;
}

describe('sendMessage', () => {
  it('numbers messages 1, 2, 3 in each conversation and moves the counter', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const other = await createTestRoom(t.db, ava.id);

    const seqs = [];
    for (const body of ['one', 'two', 'three']) {
      const result = expectOk(await send(room.id, ava.id, body));
      seqs.push(result.message.seq);
      expect(result.message.versionSeq).toBe(result.message.seq);
      expect(result.duplicate).toBe(false);
    }
    expect(seqs).toEqual([1, 2, 3]);
    expect(await counter(room.id)).toBe(3);

    // Another conversation has its own counter.
    expect(expectOk(await send(other.id, ava.id)).message.seq).toBe(1);
  });

  it('returns the original message when the same client ID is re-sent (no duplicate, no gap)', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const clientId = uuidv4();

    const first = expectOk(
      await sendMessage(t.db, { conversationId: room.id, authorId: ava.id, clientId, body: 'hi' }),
    );
    const again = expectOk(
      await sendMessage(t.db, { conversationId: room.id, authorId: ava.id, clientId, body: 'hi' }),
    );
    expect(again.duplicate).toBe(true);
    expect(again.message.id).toBe(first.message.id);
    expect(await counter(room.id)).toBe(1);

    // The next real message continues without a gap.
    expect(expectOk(await send(room.id, ava.id)).message.seq).toBe(2);
  });

  it('refuses a client ID that the author already used in another conversation', async () => {
    const ava = await createTestUser(t.db);
    const a = await createTestRoom(t.db, ava.id);
    const b = await createTestRoom(t.db, ava.id);
    const clientId = uuidv4();
    expectOk(
      await sendMessage(t.db, { conversationId: a.id, authorId: ava.id, clientId, body: 'x' }),
    );
    const result = await sendMessage(t.db, {
      conversationId: b.id,
      authorId: ava.id,
      clientId,
      body: 'x',
    });
    expect(result).toEqual({ ok: false, reason: 'client_id_conflict' });
  });

  it('lets two authors use the same client ID independently', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id]);
    const clientId = uuidv4();
    const one = await sendMessage(t.db, {
      conversationId: room.id,
      authorId: ava.id,
      clientId,
      body: 'a',
    });
    const two = await sendMessage(t.db, {
      conversationId: room.id,
      authorId: sam.id,
      clientId,
      body: 'b',
    });
    expect(expectOk(one).message.seq).toBe(1);
    expect(expectOk(two).message.seq).toBe(2);
  });

  it('refuses a conversation that does not exist', async () => {
    const ava = await createTestUser(t.db);
    expect(await send(newId(), ava.id)).toEqual({ ok: false, reason: 'conversation_not_found' });
  });

  it('refuses non-members and writes nothing', async () => {
    const owner = await createTestUser(t.db);
    const outsider = await createTestUser(t.db);
    const room = await createTestRoom(t.db, owner.id);
    expect(await send(room.id, outsider.id)).toEqual({ ok: false, reason: 'not_member' });
    expect(await counter(room.id)).toBe(0);
  });

  it('refuses accounts that are not active, verified, onboarded members', async () => {
    const owner = await createTestUser(t.db);
    const suspended = await createTestUser(t.db, { status: 'suspended' });
    const unverified = await createTestUser(t.db, { emailVerified: false });
    const notOnboarded = await createTestUser(t.db, { onboarded: false });
    const guest = await createTestUser(t.db, { isAnonymous: true, onboarded: false });
    const room = await createTestRoom(t.db, owner.id, [
      suspended.id,
      unverified.id,
      notOnboarded.id,
      guest.id,
    ]);

    expect(await send(room.id, suspended.id)).toMatchObject({ reason: 'account_inactive' });
    expect(await send(room.id, unverified.id)).toMatchObject({ reason: 'email_unverified' });
    expect(await send(room.id, notOnboarded.id)).toMatchObject({ reason: 'not_onboarded' });
    expect(await send(room.id, guest.id)).toMatchObject({ reason: 'guest_account' });
    expect(await send(room.id, newId())).toMatchObject({ reason: 'account_inactive' });
    expect(await counter(room.id)).toBe(0);
  });

  it('refuses members muted in the room until the mute ends', async () => {
    const owner = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, owner.id, [sam.id]);
    const until = new Date(Date.now() + 10 * 60_000);
    await t.db
      .update(conversationMember)
      .set({ mutedUntil: until })
      .where(eq(conversationMember.userId, sam.id));

    expect(await send(room.id, sam.id)).toEqual({ ok: false, reason: 'muted', until });
    // After the mute expires (simulated clock), sending works again.
    const later = new Date(until.getTime() + 1000);
    expectOk(await send(room.id, sam.id, 'back', { now: later }));
  });

  it('refuses room-banned members, but not after the ban expires', async () => {
    const owner = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, owner.id, [sam.id]);
    const expiresAt = new Date(Date.now() + 60_000);
    await t.db.insert(roomBan).values({ conversationId: room.id, userId: sam.id, expiresAt });

    expect(await send(room.id, sam.id)).toEqual({
      ok: false,
      reason: 'room_banned',
      until: expiresAt,
    });
    expectOk(await send(room.id, sam.id, 'ok', { now: new Date(expiresAt.getTime() + 1) }));
  });

  it('refuses users with an active global mute, suspension or ban', async () => {
    const owner = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, owner.id, [sam.id]);
    const expiresAt = new Date(Date.now() + 3_600_000);
    await t.db
      .insert(userSanction)
      .values({ userId: sam.id, kind: 'mute', scope: 'global', reason: 'spam', expiresAt });

    expect(await send(room.id, sam.id)).toEqual({
      ok: false,
      reason: 'sanctioned',
      until: expiresAt,
    });

    // A random-mode-only timeout does not affect community rooms.
    const kim = await createTestUser(t.db);
    const room2 = await createTestRoom(t.db, owner.id, [kim.id]);
    await t.db
      .insert(userSanction)
      .values({ userId: kim.id, kind: 'random_timeout', scope: 'random', reason: 'reports' });
    expectOk(await send(room2.id, kim.id));
  });

  it('refuses DM messages when either person has blocked the other', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const dm = await createTestDm(t.db, ava.id, sam.id);
    expectOk(await send(dm.id, ava.id));

    await t.db.insert(block).values({ blockerId: sam.id, blockedId: ava.id });
    expect(await send(dm.id, ava.id)).toEqual({ ok: false, reason: 'blocked' });
    expect(await send(dm.id, sam.id)).toEqual({ ok: false, reason: 'blocked' });
  });

  it('accepts replies only to messages in the same conversation', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const elsewhere = await createTestRoom(t.db, ava.id);
    const original = expectOk(await send(room.id, ava.id, 'question?')).message;
    const foreign = expectOk(await send(elsewhere.id, ava.id, 'other')).message;

    const reply = expectOk(await send(room.id, ava.id, 'answer', { replyToId: original.id }));
    expect(reply.message.replyToId).toBe(original.id);
    expect(await send(room.id, ava.id, 'x', { replyToId: foreign.id })).toEqual({
      ok: false,
      reason: 'reply_not_found',
    });
  });

  it('refuses archived conversations', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    await t.db
      .update(conversation)
      .set({ archivedAt: new Date() })
      .where(eq(conversation.id, room.id));
    expect(await send(room.id, ava.id)).toEqual({ ok: false, reason: 'conversation_archived' });
  });

  it('gives concurrent senders unique, gap-free numbers', async () => {
    const owner = await createTestUser(t.db);
    const members = await Promise.all(Array.from({ length: 8 }, () => createTestUser(t.db)));
    const room = await createTestRoom(
      t.db,
      owner.id,
      members.map((m) => m.id),
    );
    const results = await Promise.all(
      members.flatMap((m) => [send(room.id, m.id, 'a'), send(room.id, m.id, 'b')]),
    );
    const seqs = results.map((r) => expectOk(r).message.seq).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(await counter(room.id)).toBe(16);
  });

  it('survives a racing re-send of the same client ID', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const clientId = uuidv4();
    const input = { conversationId: room.id, authorId: ava.id, clientId, body: 'once' };
    const results = await Promise.all([sendMessage(t.db, input), sendMessage(t.db, input)]);
    const ids = new Set(results.map((r) => expectOk(r).message.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.ok && r.duplicate)).toHaveLength(1);
    expect(await counter(room.id)).toBe(1);
  });

  it('refuses one client ID racing into two conversations (unique-key fallback)', async () => {
    // Different conversations take different row locks, so on real PostgreSQL both sends get past
    // the duplicate check and the unique key on (author_id, client_id) decides.
    const ava = await createTestUser(t.db);
    const a = await createTestRoom(t.db, ava.id);
    const b = await createTestRoom(t.db, ava.id);
    const clientId = uuidv4();
    const results = await Promise.all([
      sendMessage(t.db, { conversationId: a.id, authorId: ava.id, clientId, body: 'x' }),
      sendMessage(t.db, { conversationId: b.id, authorId: ava.id, clientId, body: 'x' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'client_id_conflict' }]);
    expect((await counter(a.id)) + (await counter(b.id))).toBe(1);
  });

  it('keeps the user row untouched (sending is not a profile write)', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    const [before] = await t.db.select().from(user).where(eq(user.id, ava.id));
    expectOk(await send(room.id, ava.id));
    const [after] = await t.db.select().from(user).where(eq(user.id, ava.id));
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });
});

describe('listEventsSince', () => {
  it('returns changes after the cursor in order, and asks for a reset beyond the limit', async () => {
    const ava = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id);
    for (let i = 1; i <= 5; i++) expectOk(await send(room.id, ava.id, `m${String(i)}`));

    const since2 = await listEventsSince(t.db, room.id, 2, 10);
    expect(since2.reset).toBe(false);
    expect(since2.messages.map((m) => m.body)).toEqual(['m3', 'm4', 'm5']);

    expect(await listEventsSince(t.db, room.id, 5, 10)).toEqual({ messages: [], reset: false });
    expect(await listEventsSince(t.db, room.id, 0, 4)).toEqual({ messages: [], reset: true });
    expect((await listEventsSince(t.db, room.id, 0, 5)).messages).toHaveLength(5);
  });
});
