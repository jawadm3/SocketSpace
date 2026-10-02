/**
 * Sending and resync over real sockets (MSG-01, MSG-10, RT-02, RECON-02, RECON-03, SEC-02, SEC-11).
 */
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq, schema } from '@socketspace/db';
import { createTestDm, createTestRoom, createTestUser } from '@socketspace/db/testing';
import type { MessageWire } from '@socketspace/shared/events';

import { nextEvent, request, startHarness, type Harness } from './test/harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

interface MessageAck {
  message: MessageWire;
}

describe('message:send', () => {
  it('saves, acknowledges with the stored message, and delivers it to the other members', async () => {
    const ava = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const room = await createTestRoom(h.db, ava.id, [sam.id]);
    const avaSocket = await h.connectAs(ava.id);
    const samSocket = await h.connectAs(sam.id);

    const delivered = nextEvent<{ message: MessageWire; eventSeq: number }>(
      samSocket,
      'message:new',
    );
    const clientId = uuidv4();
    const ack = await request<MessageAck>(avaSocket, 'message:send', {
      conversationId: room.id,
      clientId,
      body: '  Hello **Sam**  ',
    });
    if (!ack.ok) throw new Error(ack.error.message);
    expect(ack.data.message).toMatchObject({
      conversationId: room.id,
      authorId: ava.id,
      clientId,
      body: 'Hello **Sam**',
      seq: 1,
      eventSeq: 1,
      kind: 'text',
    });
    const received = await delivered;
    expect(received.message.id).toBe(ack.data.message.id);
    expect(received.eventSeq).toBe(1);
    avaSocket.close();
    samSocket.close();
  });

  it("delivers to the sender's other tabs but not back to the sending socket", async () => {
    const ava = await createTestUser(h.db);
    const room = await createTestRoom(h.db, ava.id);
    const tab1 = await h.connectAs(ava.id);
    const tab2 = await h.connectAs(ava.id);
    let echoedToSender = false;
    tab1.on('message:new', () => {
      echoedToSender = true;
    });
    const toOtherTab = nextEvent(tab2, 'message:new');
    await request(tab1, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'hi',
    });
    await toOtherTab;
    await new Promise((done) => setTimeout(done, 100));
    expect(echoedToSender).toBe(false);
    tab1.close();
    tab2.close();
  });

  it('refuses non-members even with a valid connection, and tells no one (RT-02)', async () => {
    const owner = await createTestUser(h.db);
    const outsider = await createTestUser(h.db);
    const room = await createTestRoom(h.db, owner.id, [], { visibility: 'private' });
    const ownerSocket = await h.connectAs(owner.id);
    const outsiderSocket = await h.connectAs(outsider.id);
    let leaked = false;
    ownerSocket.on('message:new', () => {
      leaked = true;
    });

    const ack = await request(outsiderSocket, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'let me in',
    });
    expect(ack).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'You are not a member of this conversation.' },
    });
    await new Promise((done) => setTimeout(done, 100));
    expect(leaked).toBe(false);
    const rows = await h.db
      .select()
      .from(schema.message)
      .where(eq(schema.message.conversationId, room.id));
    expect(rows).toHaveLength(0);
    ownerSocket.close();
    outsiderSocket.close();
  });

  it('refuses unverified accounts with a clear reason (journey J1)', async () => {
    const user = await createTestUser(h.db, { emailVerified: false });
    const room = await createTestRoom(h.db, user.id);
    const socket = await h.connectAs(user.id);
    const ack = await request(socket, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'x',
    });
    expect(ack).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Please confirm your email address before posting.' },
    });
    socket.close();
  });

  it('tells a muted member when they can post again', async () => {
    const owner = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const room = await createTestRoom(h.db, owner.id, [sam.id]);
    await h.db
      .update(schema.conversationMember)
      .set({ mutedUntil: new Date(Date.now() + 10 * 60_000) })
      .where(eq(schema.conversationMember.userId, sam.id));
    const socket = await h.connectAs(sam.id);
    const ack = await request(socket, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'x',
    });
    if (ack.ok) throw new Error('expected a refusal');
    expect(ack.error.code).toBe('FORBIDDEN');
    expect(ack.error.retryAfterMs).toBeGreaterThan(9 * 60_000);
    socket.close();
  });

  it('returns the original message for a re-send with the same client ID, without a second broadcast (RECON-03)', async () => {
    const ava = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const room = await createTestRoom(h.db, ava.id, [sam.id]);
    const avaSocket = await h.connectAs(ava.id);
    const samSocket = await h.connectAs(sam.id);
    let deliveries = 0;
    samSocket.on('message:new', () => {
      deliveries += 1;
    });
    const payload = { conversationId: room.id, clientId: uuidv4(), body: 'only once' };
    const first = await request<MessageAck>(avaSocket, 'message:send', payload);
    const again = await request<MessageAck>(avaSocket, 'message:send', payload);
    if (!first.ok || !again.ok) throw new Error('expected both to succeed');
    expect(again.data.message.id).toBe(first.data.message.id);
    await new Promise((done) => setTimeout(done, 150));
    expect(deliveries).toBe(1);
    avaSocket.close();
    samSocket.close();
  });

  it('refuses DMs to someone who blocked you', async () => {
    const ava = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const dm = await createTestDm(h.db, ava.id, sam.id);
    await h.db.insert(schema.block).values({ blockerId: sam.id, blockedId: ava.id });
    const socket = await h.connectAs(ava.id);
    const ack = await request(socket, 'message:send', {
      conversationId: dm.id,
      clientId: uuidv4(),
      body: 'hey',
    });
    expect(ack).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    socket.close();
  });
});

describe('payload checks (MSG-10, SEC-01)', () => {
  it.each([
    ['an unknown field', { injected: true }],
    ['a malformed conversation ID', { conversationId: 'room-1' }],
    ['an empty body', { body: '   ' }],
    ['a body over 4,000 characters', { body: 'x'.repeat(4001) }],
  ])('refuses %s with VALIDATION', async (_label, change) => {
    const user = await createTestUser(h.db);
    const room = await createTestRoom(h.db, user.id);
    const socket = await h.connectAs(user.id);
    const ack = await request(socket, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'ok',
      ...change,
    });
    expect(ack).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    socket.close();
  });

  it('closes a connection that sends a packet over 16 KB (the 100,000-character v1 message)', async () => {
    const user = await createTestUser(h.db);
    const room = await createTestRoom(h.db, user.id);
    const socket = await h.connectAs(user.id);
    const closed = nextEvent(socket, 'disconnect');
    socket.emit(
      'message:send',
      { conversationId: room.id, clientId: uuidv4(), body: 'x'.repeat(100_000) },
      () => {
        throw new Error('should never be acknowledged');
      },
    );
    expect(await closed).toBe('transport close');
  });
});

describe('rate limits (SEC-02)', () => {
  it('allows a burst of 10 sends, then refuses with a retry time', async () => {
    const user = await createTestUser(h.db);
    const room = await createTestRoom(h.db, user.id);
    const socket = await h.connectAs(user.id);
    const acks = [];
    for (let i = 0; i < 11; i++) {
      acks.push(
        await request(socket, 'message:send', {
          conversationId: room.id,
          clientId: uuidv4(),
          body: `m${String(i)}`,
        }),
      );
    }
    expect(acks.slice(0, 10).every((a) => a.ok)).toBe(true);
    const limited = acks[10];
    if (!limited || limited.ok) throw new Error('expected the 11th send to be limited');
    expect(limited.error.code).toBe('RATE_LIMITED');
    expect(limited.error.retryAfterMs).toBeGreaterThan(0);
    expect(limited.error.retryAfterMs).toBeLessThanOrEqual(1000);
    socket.close();
  });
});

describe('sync:request (RECON-02)', () => {
  it('returns everything missed after the cursor, and nothing from conversations you are not in', async () => {
    const ava = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const room = await createTestRoom(h.db, ava.id, [sam.id]);
    const secret = await createTestRoom(h.db, ava.id, [], { visibility: 'private' });
    const avaSocket = await h.connectAs(ava.id);
    for (const body of ['one', 'two', 'three']) {
      await request(avaSocket, 'message:send', {
        conversationId: room.id,
        clientId: uuidv4(),
        body,
      });
    }
    await request(avaSocket, 'message:send', {
      conversationId: secret.id,
      clientId: uuidv4(),
      body: 'private',
    });

    const samSocket = await h.connectAs(sam.id);
    const ack = await request<{
      results: { conversationId: string; events: { message: MessageWire }[] }[];
    }>(samSocket, 'sync:request', {
      cursors: [
        { conversationId: room.id, afterEventSeq: 1 },
        { conversationId: secret.id, afterEventSeq: 0 },
      ],
    });
    if (!ack.ok) throw new Error(ack.error.message);
    expect(ack.data.results).toHaveLength(1);
    expect(ack.data.results[0]?.events.map((e) => e.message.body)).toEqual(['two', 'three']);
    avaSocket.close();
    samSocket.close();
  });
});

describe('privacy of logs (SEC-11)', () => {
  it('never writes message text or tokens to the log', async () => {
    const user = await createTestUser(h.db);
    const room = await createTestRoom(h.db, user.id);
    const socket = await h.connectAs(user.id);
    const marker = `secret-text-${uuidv4()}`;
    await request(socket, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: marker,
    });
    socket.close();
    await new Promise((done) => setTimeout(done, 50));
    const all = h.logs.join('\n');
    expect(all).not.toContain(marker);
    expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // no JWTs
  });
});
