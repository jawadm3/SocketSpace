/**
 * Edit, delete, reactions, read state, typing and presence over real sockets
 * (MSG-02, MSG-03, MSG-05, RT-03, RT-04, RT-05).
 */
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq, schema } from '@socketspace/db';
import { createTestRoom, createTestUser } from '@socketspace/db/testing';
import type { MessageWire } from '@socketspace/shared/events';

import { eventBase, nextEvent, request, startHarness, type Harness } from './test/harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

async function twoInARoom() {
  const ava = await createTestUser(h.db);
  const sam = await createTestUser(h.db);
  const room = await createTestRoom(h.db, ava.id, [sam.id]);
  const avaSocket = await h.connectAs(ava.id);
  const samSocket = await h.connectAs(sam.id);
  return { ava, sam, room, avaSocket, samSocket };
}

async function send(
  socket: Awaited<ReturnType<Harness['connectAs']>>,
  conversationId: string,
  body: string,
) {
  const ack = await request<{ message: MessageWire }>(socket, 'message:send', {
    conversationId,
    clientId: uuidv4(),
    body,
  });
  if (!ack.ok) throw new Error(ack.error.message);
  return ack.data.message;
}

/** Resolves true if `event` arrives within `ms`. */
function arrives(socket: Parameters<typeof nextEvent>[0], event: string, ms = 300) {
  return nextEvent(socket, event, ms).then(
    () => true,
    () => false,
  );
}

describe('edit and delete', () => {
  it('broadcasts an edit with a new event number; others cannot edit', async () => {
    const { room, avaSocket, samSocket } = await twoInARoom();
    const sent = await send(avaSocket, room.id, 'helo');
    const updated = nextEvent<{ message: MessageWire; eventSeq: number }>(
      samSocket,
      'message:updated',
    );
    const ack = await request<{ message: MessageWire }>(avaSocket, 'message:edit', {
      messageId: sent.id,
      body: 'hello',
    });
    expect(ack.ok).toBe(true);
    const event = await updated;
    expect(event.message).toMatchObject({ id: sent.id, body: 'hello', seq: sent.seq });
    expect(event.message.editedAt).not.toBeNull();
    expect(event.eventSeq).toBe(sent.eventSeq + 1);
    expect(
      await request(samSocket, 'message:edit', { messageId: sent.id, body: 'mine now' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    avaSocket.close();
    samSocket.close();
  });

  it('broadcasts a deletion as a tombstone and refuses deleting other people’s messages', async () => {
    const { room, avaSocket, samSocket } = await twoInARoom();
    const sams = await send(samSocket, room.id, 'oops');
    // Ava owns the room, so she may delete Sam's message; Sam may not delete Ava's.
    const avas = await send(avaSocket, room.id, 'rules');
    expect(await request(samSocket, 'message:delete', { messageId: avas.id })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    const deleted = nextEvent<{ messageId: string; eventSeq: number }>(
      samSocket,
      'message:deleted',
    );
    const ack = await request<{ eventSeq: number }>(avaSocket, 'message:delete', {
      messageId: sams.id,
    });
    expect(ack.ok).toBe(true);
    expect(await deleted).toMatchObject({ messageId: sams.id, conversationId: room.id });
    // Resync shows it as a tombstone without text.
    const sync = await request<{ results: { events: { message: MessageWire }[] }[] }>(
      samSocket,
      'sync:request',
      { cursors: [{ conversationId: room.id, afterEventSeq: 0 }] },
    );
    if (!sync.ok) throw new Error(sync.error.message);
    const tomb = sync.data.results[0]?.events.find((e) => e.message.id === sams.id)?.message;
    expect(tomb).toMatchObject({ body: '', deletedBy: 'moderator' });
    avaSocket.close();
    samSocket.close();
  });
});

describe('reactions', () => {
  it('toggles, broadcasts the summary, and refuses emoji outside the list', async () => {
    const { sam, room, avaSocket, samSocket } = await twoInARoom();
    const sent = await send(avaSocket, room.id, 'ship it');
    const updated = nextEvent<{ reactions: { emoji: string; userIds: string[] }[] }>(
      avaSocket,
      'reaction:updated',
    );
    const ack = await request(samSocket, 'reaction:toggle', { messageId: sent.id, emoji: '🚀' });
    expect(ack).toMatchObject({
      ok: true,
      data: { reactions: [{ emoji: '🚀', userIds: [sam.id] }] },
    });
    expect((await updated).reactions).toEqual([{ emoji: '🚀', userIds: [sam.id] }]);
    const off = await request(samSocket, 'reaction:toggle', { messageId: sent.id, emoji: '🚀' });
    expect(off).toMatchObject({ ok: true, data: { reactions: [] } });
    expect(
      await request(samSocket, 'reaction:toggle', { messageId: sent.id, emoji: '🦄' }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    avaSocket.close();
    samSocket.close();
  });
});

describe('read state (RT-05)', () => {
  it('returns the unread count and clears the badge in the reader’s other tabs', async () => {
    const { sam, room, avaSocket, samSocket } = await twoInARoom();
    const samPhone = await h.connectAs(sam.id);
    await send(avaSocket, room.id, 'one');
    const last = await send(avaSocket, room.id, 'two');
    const otherTab = nextEvent<{ seq: number }>(samPhone, 'read:updated');
    const ack = await request<{ unread: number }>(samSocket, 'read:update', {
      conversationId: room.id,
      seq: last.seq,
    });
    expect(ack).toEqual({ ok: true, data: { unread: 0 } });
    expect(await otherTab).toEqual({ conversationId: room.id, userId: sam.id, seq: last.seq });
    for (const s of [avaSocket, samSocket, samPhone]) s.close();
  });
});

describe('typing (RT-04)', () => {
  it('reaches other members only, and is throttled', async () => {
    const { ava, room, avaSocket, samSocket } = await twoInARoom();
    const stranger = await createTestUser(h.db);
    const strangerSocket = await h.connectAs(stranger.id);
    const typing = nextEvent<{ userId: string; typing: boolean }>(samSocket, 'typing');
    avaSocket.emit('typing:set', { conversationId: room.id, typing: true });
    expect(await typing).toEqual({ conversationId: room.id, userId: ava.id, typing: true });
    // A second event within two seconds is dropped silently.
    const again = arrives(samSocket, 'typing');
    avaSocket.emit('typing:set', { conversationId: room.id, typing: true });
    expect(await again).toBe(false);
    // Someone outside the room cannot make anyone see them typing.
    const fake = arrives(samSocket, 'typing');
    strangerSocket.emit('typing:set', { conversationId: room.id, typing: true });
    expect(await fake).toBe(false);
    for (const s of [avaSocket, samSocket, strangerSocket]) s.close();
  });
});

describe('presence (RT-03, PROF-02)', () => {
  it('announces arrivals and departures to people who share a room, with last seen', async () => {
    const ava = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    await createTestRoom(h.db, ava.id, [sam.id]);
    const avaSocket = await h.connectAs(ava.id);
    const online = nextEvent<{ userId: string; status: string }>(avaSocket, 'presence');
    const samSocket = await h.connectAs(sam.id);
    expect(await online).toMatchObject({ userId: sam.id, status: 'online' });

    const away = nextEvent<{ status: string }>(avaSocket, 'presence');
    expect(await request(samSocket, 'presence:set', { status: 'away' })).toEqual({
      ok: true,
      data: {},
    });
    expect(await away).toMatchObject({ userId: sam.id, status: 'away' });

    const offline = nextEvent<{ status: string; lastSeenAt: string | null }>(avaSocket, 'presence');
    samSocket.close();
    const gone = await offline;
    expect(gone).toMatchObject({ userId: sam.id, status: 'offline' });
    expect(gone.lastSeenAt).not.toBeNull();
    avaSocket.close();
  });

  it('a new tab is told who is already online', async () => {
    const ava = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    await createTestRoom(h.db, ava.id, [sam.id]);
    const samSocket = await h.connectAs(sam.id);
    // The snapshot is sent right after the hello, so listen before connecting.
    const sessionId = await h.createSession(ava.id);
    const token = await h.signToken({ sub: ava.id, sid: sessionId });
    const seen: { userId: string; status: string }[] = [];
    const avaSocket = await h.connect(token, {
      onBeforeHello: (socket) => {
        socket.on('presence', (p: { userId: string; status: string }) => seen.push(p));
      },
    });
    await new Promise((done) => setTimeout(done, 100));
    expect(seen).toContainEqual(expect.objectContaining({ userId: sam.id, status: 'online' }));
    avaSocket.close();
    samSocket.close();
  });

  it('never shows invisible people online, and reveals them when they switch it off', async () => {
    const ava = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    await createTestRoom(h.db, ava.id, [sam.id]);
    await h.db.update(schema.user).set({ showPresence: false }).where(eq(schema.user.id, sam.id));
    const avaSocket = await h.connectAs(ava.id);
    const hidden = arrives(avaSocket, 'presence');
    const samSocket = await h.connectAs(sam.id);
    expect(await hidden).toBe(false);

    await h.db.update(schema.user).set({ showPresence: true }).where(eq(schema.user.id, sam.id));
    const shown = nextEvent<{ userId: string; status: string }>(avaSocket, 'presence');
    await h.postEvent({ ...eventBase(), type: 'user.updated', userId: sam.id });
    expect(await shown).toMatchObject({ userId: sam.id, status: 'online' });
    avaSocket.close();
    samSocket.close();
  });
});
