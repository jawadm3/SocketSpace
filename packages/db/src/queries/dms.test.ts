/**
 * Stage D4 in the database: direct messages (DM-01), blocks (SAFE-01), notifications (NOTIF-01,
 * MSG-06), delivery and read receipts (DM-02) and search (HIST-03).
 */
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conversationMember } from '../schema/conversations';
import { contact } from '../schema/social';
import { createTestDatabase, createTestRoom, createTestUser, type TestDatabase } from '../testing';
import {
  blockUser,
  canReadConversation,
  getDmForViewer,
  listBlocked,
  listUserDms,
  markDelivered,
  searchMessages,
  setPrivacySettings,
  startDm,
  unblockUser,
} from './dms';
import { deleteMessage, editMessage } from './message-actions';
import { sendMessage } from './messages';
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
} from './notifications';
import { markRead } from './read-state';
import { roomBanUser } from './rooms';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

async function send(conversationId: string, authorId: string, body: string, replyToId?: string) {
  const result = await sendMessage(t.db, {
    conversationId,
    authorId,
    clientId: uuidv4(),
    body,
    ...(replyToId ? { replyToId } : {}),
  });
  if (!result.ok) throw new Error(result.reason);
  return result;
}

async function dm(a: string, b: string) {
  const started = await startDm(t.db, a, b);
  if (!started.ok) throw new Error(started.reason);
  return started.conversationId;
}

describe('startDm (DM-01)', () => {
  it('creates one DM per pair and returns the same one every time, from either side', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const first = await startDm(t.db, ava.id, sam.id);
    expect(first).toMatchObject({ ok: true, created: true, otherUserId: sam.id });
    expect(await startDm(t.db, ava.id, sam.id)).toMatchObject({ ok: true, created: false });
    const back = await startDm(t.db, sam.id, ava.id);
    expect(back.ok && first.ok && back.conversationId === first.conversationId).toBe(true);
    // Two people starting it at the same moment still get one conversation.
    const lee = await createTestUser(t.db);
    const both = await Promise.all([startDm(t.db, ava.id, lee.id), startDm(t.db, lee.id, ava.id)]);
    const ids = new Set(both.map((r) => (r.ok ? r.conversationId : r.reason)));
    expect(ids.size).toBe(1);
    expect(await listUserDms(t.db, ava.id)).toHaveLength(2);
  });

  it('respects "who may message me" for new DMs, but an existing DM stays open', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const kim = await createTestUser(t.db);
    const existing = await dm(ava.id, sam.id);
    await setPrivacySettings(t.db, sam.id, { dmPolicy: 'nobody', readReceipts: true });
    expect(await startDm(t.db, kim.id, sam.id)).toEqual({ ok: false, reason: 'policy' });
    expect(await startDm(t.db, ava.id, sam.id)).toMatchObject({ conversationId: existing });

    await setPrivacySettings(t.db, sam.id, { dmPolicy: 'contacts', readReceipts: true });
    expect(await startDm(t.db, kim.id, sam.id)).toEqual({ ok: false, reason: 'policy' });
    await t.db.insert(contact).values({ userId: sam.id, contactId: kim.id, source: 'manual' });
    expect(await startDm(t.db, kim.id, sam.id)).toMatchObject({ ok: true, created: true });
  });

  it('refuses yourself, unknown or inactive people, guests, and unverified starters', async () => {
    const ava = await createTestUser(t.db);
    const gone = await createTestUser(t.db, { status: 'banned' });
    const guest = await createTestUser(t.db, { isAnonymous: true });
    const unverified = await createTestUser(t.db, { emailVerified: false });
    expect(await startDm(t.db, ava.id, ava.id)).toEqual({ ok: false, reason: 'self' });
    expect(await startDm(t.db, ava.id, uuidv4())).toEqual({ ok: false, reason: 'not_found' });
    expect(await startDm(t.db, ava.id, gone.id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await startDm(t.db, ava.id, guest.id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await startDm(t.db, unverified.id, ava.id)).toEqual({
      ok: false,
      reason: 'not_allowed_to_start',
    });
  });
});

describe('blocks (SAFE-01, journey J6)', () => {
  it('a block either way stops new DMs and messages in an existing one; unblock restores them', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const id = await dm(ava.id, sam.id);
    await blockUser(t.db, sam.id, ava.id);
    expect(await listBlocked(t.db, sam.id)).toEqual([ava.id]);
    expect(await startDm(t.db, ava.id, sam.id)).toEqual({ ok: false, reason: 'blocked' });
    expect(await startDm(t.db, sam.id, ava.id)).toEqual({ ok: false, reason: 'blocked' });
    const refused = await sendMessage(t.db, {
      conversationId: id,
      authorId: ava.id,
      clientId: uuidv4(),
      body: 'hello?',
    });
    expect(refused).toMatchObject({ ok: false, reason: 'blocked' });
    expect((await getDmForViewer(t.db, ava.id, id))?.blocked).toBe(true);

    await unblockUser(t.db, sam.id, ava.id);
    expect((await send(id, ava.id, 'back again')).ok).toBe(true);
    expect(await blockUser(t.db, ava.id, ava.id)).toEqual({ ok: false });
  });
});

describe('notifications (NOTIF-01, MSG-06)', () => {
  it('notifies a mention, a reply and a DM, once per person per message', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const lee = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id, lee.id]);
    const original = await send(room.id, sam.id, 'Lunch?');
    // A reply that also mentions Sam notifies Sam once (as a mention); Lee is mentioned too.
    const reply = await send(
      room.id,
      ava.id,
      `@${String(sam.nickname)} @${String(lee.nickname)} yes`,
      original.message.id,
    );
    expect(reply.notifications.map((n) => [n.userId, n.type]).sort()).toEqual(
      [
        [lee.id, 'mention'],
        [sam.id, 'mention'],
      ].sort(),
    );
    const plainReply = await send(room.id, lee.id, 'me too', original.message.id);
    expect(plainReply.notifications.map((n) => [n.userId, n.type])).toEqual([[sam.id, 'reply']]);

    const id = await dm(ava.id, sam.id);
    const first = await send(id, ava.id, 'psst');
    expect(first.notifications.map((n) => [n.userId, n.type])).toEqual([[sam.id, 'dm']]);
    // While that one is unread, more DMs in the same conversation add nothing.
    expect((await send(id, ava.id, 'still there?')).notifications).toEqual([]);
    expect(await countUnreadNotifications(t.db, sam.id)).toBe(3);

    const list = await listNotifications(t.db, sam.id);
    expect(list.map((n) => n.type)).toEqual(['dm', 'reply', 'mention']);
    expect(list[1]).toMatchObject({ roomSlug: room.slug, messageBody: 'me too', actorId: lee.id });
    expect(await markAllNotificationsRead(t.db, sam.id)).toBe(3);
    expect(await countUnreadNotifications(t.db, sam.id)).toBe(0);
    // Read: the next DM notifies again.
    expect((await send(id, ava.id, 'ok')).notifications).toHaveLength(1);
  });

  it('never notifies someone who blocked the author, a non-member, or a muted conversation', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const lee = await createTestUser(t.db);
    const outsider = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id, lee.id]);
    await blockUser(t.db, sam.id, ava.id);
    await t.db
      .update(conversationMember)
      .set({ notifyLevel: 'none' })
      .where(
        and(eq(conversationMember.conversationId, room.id), eq(conversationMember.userId, lee.id)),
      );
    const sent = await send(
      room.id,
      ava.id,
      `@${String(sam.nickname)} @${String(lee.nickname)} @${String(outsider.nickname)} hi`,
    );
    expect(sent.notifications).toEqual([]);
  });

  it('an edit notifies only people mentioned for the first time; a deleted message hides its text', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const lee = await createTestUser(t.db);
    const room = await createTestRoom(t.db, ava.id, [sam.id, lee.id]);
    const sent = await send(room.id, ava.id, `hi @${String(sam.nickname)}`);
    const edited = await editMessage(t.db, {
      messageId: sent.message.id,
      editorId: ava.id,
      body: `hi @${String(sam.nickname)} and @${String(lee.nickname)}`,
    });
    expect(edited.ok && edited.notifications.map((n) => [n.userId, n.type])).toEqual([
      [lee.id, 'mention'],
    ]);
    await deleteMessage(t.db, { messageId: sent.message.id, actorId: ava.id });
    const [item] = await listNotifications(t.db, lee.id);
    expect(item).toMatchObject({ type: 'mention', messageBody: null });
  });
});

describe('receipts (DM-02)', () => {
  it('delivery moves forward only, in DMs only, and receipts need both people to allow them', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const id = await dm(ava.id, sam.id);
    const a = await send(id, ava.id, 'one');
    const b = await send(id, ava.id, 'two');
    expect(
      await markDelivered(t.db, { conversationId: id, userId: sam.id, seq: b.message.seq }),
    ).toEqual({
      moved: true,
      lastDeliveredSeq: b.message.seq,
    });
    expect(
      await markDelivered(t.db, { conversationId: id, userId: sam.id, seq: a.message.seq }),
    ).toBeNull();
    // Never past the conversation's newest event.
    expect(await markDelivered(t.db, { conversationId: id, userId: sam.id, seq: 999 })).toEqual({
      moved: true,
      lastDeliveredSeq: b.message.seq,
    });
    await markRead(t.db, { conversationId: id, userId: sam.id, seq: a.message.seq });
    expect((await getDmForViewer(t.db, ava.id, id))?.receipts).toEqual({
      delivered: b.message.seq,
      read: a.message.seq,
    });

    await setPrivacySettings(t.db, sam.id, { dmPolicy: 'everyone', readReceipts: false });
    expect((await getDmForViewer(t.db, ava.id, id))?.receipts).toBeNull();
    expect((await getDmForViewer(t.db, sam.id, id))?.receipts).toBeNull();

    const room = await createTestRoom(t.db, ava.id, [sam.id]);
    const inRoom = await send(room.id, ava.id, 'room');
    expect(
      await markDelivered(t.db, {
        conversationId: room.id,
        userId: sam.id,
        seq: inRoom.message.seq,
      }),
    ).toBeNull();
  });
});

describe('search (HIST-03)', () => {
  it('finds whole words only in conversations you belong to, never deleted messages', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const outsider = await createTestUser(t.db);
    const word = `zebra${uuidv4().slice(0, 6)}`;
    const room = await createTestRoom(t.db, ava.id, [sam.id]);
    const otherRoom = await createTestRoom(t.db, outsider.id);
    await send(room.id, ava.id, `The ${word} crossing`);
    const gone = await send(room.id, sam.id, `${word.toUpperCase()} again`);
    await send(otherRoom.id, outsider.id, `secret ${word}`);
    const id = await dm(ava.id, sam.id);
    await send(id, sam.id, `a private ${word}`);
    await deleteMessage(t.db, { messageId: gone.message.id, actorId: sam.id });

    const hits = await searchMessages(t.db, ava.id, word);
    expect(hits.map((h) => h.message.body)).toEqual([`a private ${word}`, `The ${word} crossing`]);
    expect(hits.map((h) => h.conversationKind)).toEqual(['dm', 'room']);
    expect(await searchMessages(t.db, outsider.id, word)).toHaveLength(1);
    expect(await searchMessages(t.db, ava.id, word.slice(0, 4))).toEqual([]); // whole words
    expect(await searchMessages(t.db, ava.id, '   ')).toEqual([]);
    // Odd input is just text to search for, never an error.
    expect(await searchMessages(t.db, ava.id, `"${word}" -nothing OR ) ( & | !`)).toBeTruthy();
  });
});

describe('canReadConversation (history pages)', () => {
  it('follows the room rules for rooms and membership for DMs', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const lee = await createTestUser(t.db);
    const open = await createTestRoom(t.db, ava.id);
    const closed = await createTestRoom(t.db, ava.id, [], { visibility: 'private' });
    const id = await dm(ava.id, sam.id);
    expect(await canReadConversation(t.db, lee.id, open.id)).toBe(true);
    expect(await canReadConversation(t.db, lee.id, closed.id)).toBe(false);
    expect(await canReadConversation(t.db, sam.id, id)).toBe(true);
    expect(await canReadConversation(t.db, lee.id, id)).toBe(false);
    expect(await canReadConversation(t.db, lee.id, uuidv4())).toBe(false);
    const ban = await roomBanUser(t.db, ava.id, open.id, lee.id, null, 'spam');
    expect(ban.ok).toBe(true);
    expect(await canReadConversation(t.db, lee.id, open.id)).toBe(false);
  });
});
