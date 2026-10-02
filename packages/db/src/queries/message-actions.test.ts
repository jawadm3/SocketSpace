/**
 * Edit, delete, reactions, mentions and read state (MSG-02, MSG-03, MSG-05, MSG-06, RT-05).
 */
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mention } from '../schema/messages';
import { moderationAction } from '../schema/safety';
import { block } from '../schema/social';
import { createTestDatabase, createTestRoom, createTestUser, type TestDatabase } from '../testing';
import { toMessageWire } from '../wire';
import {
  deleteMessage,
  editMessage,
  listReactions,
  listRevisions,
  toggleReaction,
} from './message-actions';
import { listEventsSince, sendMessage } from './messages';
import { markRead, unreadCounts } from './read-state';
import { roomMute, roomSetRole } from './rooms';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

const HOUR = 60 * 60_000;

async function send(conversationId: string, authorId: string, body: string, now?: Date) {
  const result = await sendMessage(t.db, {
    conversationId,
    authorId,
    clientId: uuidv4(),
    body,
    ...(now && { now }),
  });
  if (!result.ok) throw new Error(result.reason);
  return result;
}

async function room() {
  const owner = await createTestUser(t.db);
  const mod = await createTestUser(t.db);
  const ava = await createTestUser(t.db);
  const sam = await createTestUser(t.db);
  const r = await createTestRoom(t.db, owner.id, [mod.id, ava.id, sam.id]);
  await roomSetRole(t.db, owner.id, r.id, mod.id, 'moderator');
  return { owner, mod, ava, sam, room: r };
}

describe('editMessage (MSG-02)', () => {
  it('lets the author edit within 24 hours, keeps the old text, and takes a new event number', async () => {
    const { ava, room: r } = await room();
    const t0 = new Date('2030-05-01T10:00:00.000Z');
    const sent = await send(r.id, ava.id, 'helo', t0);
    const edited = await editMessage(t.db, {
      messageId: sent.message.id,
      editorId: ava.id,
      body: 'hello',
      now: new Date(t0.getTime() + HOUR),
    });
    if (!edited.ok) throw new Error(edited.reason);
    expect(edited.message.body).toBe('hello');
    expect(edited.message.editedAt).toEqual(new Date(t0.getTime() + HOUR));
    expect(edited.message.versionSeq).toBe(sent.message.seq + 1);
    expect(edited.message.seq).toBe(sent.message.seq);
    expect((await listRevisions(t.db, sent.message.id)).map((r) => r.body)).toEqual(['helo']);
    // Resync after the message's own number carries the edit.
    const since = await listEventsSince(t.db, r.id, sent.message.seq, 10);
    expect(since.messages.map((m) => m.body)).toEqual(['hello']);
  });

  it('refuses other people, deleted messages, late edits and muted authors', async () => {
    const { mod, ava, sam, room: r } = await room();
    const t0 = new Date('2030-05-02T10:00:00.000Z');
    const sent = await send(r.id, ava.id, 'original', t0);
    expect(
      await editMessage(t.db, { messageId: sent.message.id, editorId: sam.id, body: 'x' }),
    ).toMatchObject({ ok: false, reason: 'not_author' });
    expect(
      await editMessage(t.db, {
        messageId: sent.message.id,
        editorId: ava.id,
        body: 'late',
        now: new Date(t0.getTime() + 25 * HOUR),
      }),
    ).toMatchObject({ ok: false, reason: 'too_late' });
    await roomMute(t.db, mod.id, r.id, ava.id, HOUR, 'cool down', new Date(t0.getTime() + HOUR));
    expect(
      await editMessage(t.db, {
        messageId: sent.message.id,
        editorId: ava.id,
        body: 'muted edit',
        now: new Date(t0.getTime() + 90 * 60_000),
      }),
    ).toMatchObject({ ok: false, reason: 'muted' });
    await deleteMessage(t.db, { messageId: sent.message.id, actorId: ava.id });
    expect(
      await editMessage(t.db, { messageId: sent.message.id, editorId: ava.id, body: 'gone' }),
    ).toMatchObject({ ok: false, reason: 'deleted' });
  });

  it('saving the same text changes nothing', async () => {
    const { ava, room: r } = await room();
    const sent = await send(r.id, ava.id, 'same');
    const result = await editMessage(t.db, {
      messageId: sent.message.id,
      editorId: ava.id,
      body: 'same',
    });
    expect(result).toMatchObject({ ok: true, changed: false });
  });
});

describe('deleteMessage (MSG-03)', () => {
  it('lets the author delete: a tombstone in the same place, text kept only as evidence', async () => {
    const { ava, sam, room: r } = await room();
    const first = await send(r.id, ava.id, 'secret plan');
    await send(r.id, sam.id, 'reply');
    await toggleReaction(t.db, { messageId: first.message.id, userId: sam.id, emoji: '👍' });
    const deleted = await deleteMessage(t.db, { messageId: first.message.id, actorId: ava.id });
    if (!deleted.ok) throw new Error(deleted.reason);
    expect(deleted.message).toMatchObject({
      body: '',
      deletedBy: 'author',
      seq: first.message.seq,
    });
    expect(toMessageWire(deleted.message).body).toBe('');
    expect((await listReactions(t.db, [first.message.id])).get(first.message.id)).toBeUndefined();
    expect((await listRevisions(t.db, first.message.id)).map((r) => r.body)).toEqual([
      'secret plan',
    ]);
    // Deleting again changes nothing.
    expect(
      await deleteMessage(t.db, { messageId: first.message.id, actorId: ava.id }),
    ).toMatchObject({ ok: true, changed: false });
  });

  it('lets a moderator delete a member’s message (audited), but not the owner’s, and members nothing', async () => {
    const { owner, mod, ava, sam, room: r } = await room();
    const avas = await send(r.id, ava.id, 'off topic');
    const owners = await send(r.id, owner.id, 'rules');
    expect(
      await deleteMessage(t.db, { messageId: avas.message.id, actorId: sam.id }),
    ).toMatchObject({
      ok: false,
      reason: 'denied',
      deny: 'role',
    });
    expect(
      await deleteMessage(t.db, { messageId: owners.message.id, actorId: mod.id }),
    ).toMatchObject({ ok: false, deny: 'target_rank' });
    const byMod = await deleteMessage(t.db, { messageId: avas.message.id, actorId: mod.id });
    expect(byMod).toMatchObject({
      ok: true,
      byModerator: true,
      message: { deletedBy: 'moderator' },
    });
    const [entry] = await t.db
      .select()
      .from(moderationAction)
      .where(eq(moderationAction.messageId, avas.message.id));
    expect(entry).toMatchObject({
      action: 'remove_message',
      actorId: mod.id,
      targetUserId: ava.id,
      conversationId: r.id,
    });
  });
});

describe('toggleReaction (MSG-05)', () => {
  it('adds and removes, groups people per emoji, and moves the event number', async () => {
    const { ava, sam, owner, room: r } = await room();
    const sent = await send(r.id, ava.id, 'party');
    const one = await toggleReaction(t.db, {
      messageId: sent.message.id,
      userId: sam.id,
      emoji: '🎉',
    });
    const two = await toggleReaction(t.db, {
      messageId: sent.message.id,
      userId: owner.id,
      emoji: '🎉',
    });
    expect(one).toMatchObject({ ok: true, added: true });
    if (!two.ok) throw new Error(two.reason);
    expect(two.reactions).toEqual([{ emoji: '🎉', userIds: [sam.id, owner.id] }]);
    expect(two.message.versionSeq).toBeGreaterThan(sent.message.versionSeq);
    const off = await toggleReaction(t.db, {
      messageId: sent.message.id,
      userId: sam.id,
      emoji: '🎉',
    });
    expect(off).toMatchObject({
      ok: true,
      added: false,
      reactions: [{ emoji: '🎉', userIds: [owner.id] }],
    });
  });

  it('allows at most 20 different emoji on one message', async () => {
    const { ava, sam, room: r } = await room();
    const sent = await send(r.id, ava.id, 'many');
    const emoji = [
      '👍',
      '👎',
      '❤️',
      '😂',
      '😮',
      '😢',
      '😡',
      '🎉',
      '🙏',
      '👏',
      '🔥',
      '💯',
      '✅',
      '👀',
      '🤔',
      '🚀',
      '✨',
      '😍',
      '🥳',
      '😅',
    ];
    for (const e of emoji) {
      const result = await toggleReaction(t.db, {
        messageId: sent.message.id,
        userId: sam.id,
        emoji: e,
      });
      expect(result.ok, e).toBe(true);
    }
    // A 21st different emoji (not in the allow-list here, but the limit is checked first).
    expect(
      await toggleReaction(t.db, { messageId: sent.message.id, userId: ava.id, emoji: '🦄' }),
    ).toMatchObject({ ok: false, reason: 'too_many_reactions' });
    // Adding one of the existing 20 is still fine.
    expect(
      await toggleReaction(t.db, { messageId: sent.message.id, userId: ava.id, emoji: '👍' }),
    ).toMatchObject({ ok: true, added: true });
  });

  it('refuses non-members', async () => {
    const { ava, room: r } = await room();
    const stranger = await createTestUser(t.db);
    const sent = await send(r.id, ava.id, 'hi');
    expect(
      await toggleReaction(t.db, { messageId: sent.message.id, userId: stranger.id, emoji: '👍' }),
    ).toMatchObject({ ok: false, reason: 'not_member' });
  });
});

describe('mentions (MSG-06)', () => {
  it('records members mentioned outside code, never the author or someone who blocked them', async () => {
    const { owner, ava, sam, room: r } = await room();
    const outsider = await createTestUser(t.db);
    await t.db.insert(block).values({ blockerId: owner.id, blockedId: ava.id });
    const sent = await send(
      r.id,
      ava.id,
      `hi @${String(sam.nickname).toUpperCase()} and @${String(ava.nickname)} and @${String(outsider.nickname)} and @${String(owner.nickname)} \`@${String(sam.nickname)}\``,
    );
    expect(sent.mentions).toEqual([sam.id]);
    const rows = await t.db.select().from(mention).where(eq(mention.messageId, sent.message.id));
    expect(rows.map((m) => m.userId)).toEqual([sam.id]);
  });

  it('an edit that adds a mention reports only the new person', async () => {
    const { owner, ava, sam, room: r } = await room();
    const sent = await send(r.id, ava.id, `hi @${String(sam.nickname)}`);
    const edited = await editMessage(t.db, {
      messageId: sent.message.id,
      editorId: ava.id,
      body: `hi @${String(sam.nickname)} and @${String(owner.nickname)}`,
    });
    expect(edited).toMatchObject({ ok: true, newMentions: [owner.id] });
  });
});

describe('read state (RT-05)', () => {
  it('counts other people’s unread messages and only moves forward', async () => {
    const { ava, sam, room: r } = await room();
    await send(r.id, ava.id, 'one');
    const two = await send(r.id, ava.id, 'two');
    await send(r.id, sam.id, 'mine does not count');
    expect((await unreadCounts(t.db, sam.id)).get(r.id)).toBe(0); // Sam wrote after them.

    const three = await send(r.id, ava.id, 'three');
    expect((await unreadCounts(t.db, sam.id)).get(r.id)).toBe(1);
    expect(
      await markRead(t.db, { conversationId: r.id, userId: sam.id, seq: three.message.seq }),
    ).toMatchObject({
      ok: true,
      unread: 0,
      moved: true,
    });
    // Going back is ignored; the future is capped at the latest event.
    expect(
      await markRead(t.db, { conversationId: r.id, userId: sam.id, seq: two.message.seq }),
    ).toMatchObject({
      moved: false,
      lastReadSeq: three.message.seq,
    });
    const capped = await markRead(t.db, { conversationId: r.id, userId: sam.id, seq: 999_999 });
    expect(capped).toMatchObject({ ok: true, lastReadSeq: three.message.seq });
    const stranger = await createTestUser(t.db);
    expect(await markRead(t.db, { conversationId: r.id, userId: stranger.id, seq: 1 })).toEqual({
      ok: false,
      reason: 'not_member',
    });
  });

  it('does not count deleted messages', async () => {
    const { ava, sam, room: r } = await room();
    await markRead(t.db, { conversationId: r.id, userId: sam.id, seq: 999_999 });
    const gone = await send(r.id, ava.id, 'oops');
    expect((await unreadCounts(t.db, sam.id)).get(r.id)).toBe(1);
    await deleteMessage(t.db, { messageId: gone.message.id, actorId: ava.id });
    expect((await unreadCounts(t.db, sam.id)).get(r.id)).toBe(0);
  });
});
