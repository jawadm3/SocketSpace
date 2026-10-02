/**
 * Internal events, health and metrics endpoints, log correlation IDs, the outbox, graceful shutdown
 * and restarts (AUTH-06, OBS-01, OBS-02, OBS-04, REL-01, HIST-01).
 */
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq, newId, schema } from '@socketspace/db';
import { createTestRoom, createTestUser } from '@socketspace/db/testing';
import type { InternalEvent } from '@socketspace/shared/internal-events';

import { eventBase, nextEvent, request, startHarness, type Harness } from './test/harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

function postEvent(event: InternalEvent, options: { secret?: string; timestamp?: string } = {}) {
  return h.postEvent(event, options);
}

describe('internal events (AUTH-06)', () => {
  it('disconnects exactly the revoked session, with a reason', async () => {
    const user = await createTestUser(h.db);
    const laptopSession = await h.createSession(user.id);
    const phoneSession = await h.createSession(user.id);
    const laptop = await h.connect(await h.signToken({ sub: user.id, sid: laptopSession }));
    const phone = await h.connect(await h.signToken({ sub: user.id, sid: phoneSession }));

    const ended = nextEvent<{ reason: string }>(laptop, 'session:ended');
    const disconnected = nextEvent(laptop, 'disconnect');
    const response = await postEvent({
      ...eventBase(),
      type: 'session.revoked',
      userId: user.id,
      sessionIds: [laptopSession],
    });
    expect(response.status).toBe(204);
    expect(await ended).toEqual({ reason: 'revoked' });
    expect(await disconnected).toBe('io server disconnect');
    expect(phone.connected).toBe(true);
    phone.close();
  });

  it('disconnects every session of a user after a password reset', async () => {
    const user = await createTestUser(h.db);
    const a = await h.connectAs(user.id);
    const b = await h.connectAs(user.id);
    const both = Promise.all([nextEvent(a, 'disconnect'), nextEvent(b, 'disconnect')]);
    expect(
      (await postEvent({ ...eventBase(), type: 'user.sessions_revoked', userId: user.id })).status,
    ).toBe(204);
    await both;
  });

  it('refuses a bad signature, a stale timestamp and a replay', async () => {
    const event: InternalEvent = { ...eventBase(), type: 'user.deleted', userId: newId() };
    expect((await postEvent(event, { secret: 'x'.repeat(40) })).status).toBe(401);
    expect((await postEvent(event, { timestamp: String(Date.now() - 120_000) })).status).toBe(401);
    expect((await postEvent(event)).status).toBe(204);
    expect((await postEvent(event)).status).toBe(409);
  });

  it('adds a new member to the conversation room so they receive messages straight away', async () => {
    const owner = await createTestUser(h.db);
    const kim = await createTestUser(h.db);
    const room = await createTestRoom(h.db, owner.id);
    const ownerSocket = await h.connectAs(owner.id);
    const kimSocket = await h.connectAs(kim.id);
    await h.db
      .insert(schema.conversationMember)
      .values({ conversationId: room.id, userId: kim.id });
    await postEvent({
      ...eventBase(),
      type: 'member.added',
      conversationId: room.id,
      userId: kim.id,
      role: 'member',
    });

    const received = nextEvent(kimSocket, 'message:new');
    await request(ownerSocket, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'welcome',
    });
    await received;
    ownerSocket.close();
    kimSocket.close();
  });
});

describe('outbox', () => {
  it('applies undelivered events and marks them delivered', async () => {
    const user = await createTestUser(h.db);
    const socket = await h.connectAs(user.id);
    const event = { ...eventBase(), type: 'user.sessions_revoked' as const, userId: user.id };
    await h.db
      .insert(schema.realtimeOutbox)
      .values({ eventId: event.id, type: event.type, payload: event });
    const disconnected = nextEvent(socket, 'disconnect');
    expect(await h.server.outbox.drain()).toBe(1);
    await disconnected;
    const [row] = await h.db
      .select()
      .from(schema.realtimeOutbox)
      .where(eq(schema.realtimeOutbox.eventId, event.id));
    expect(row?.deliveredAt).toBeInstanceOf(Date);
    expect(await h.server.outbox.drain()).toBe(0);
  });
});

describe('HTTP endpoints (OBS-02, OBS-04)', () => {
  it('/healthz answers without touching the database', async () => {
    const response = await fetch(`${h.url}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('/readyz reports the database and keys', async () => {
    const response = await fetch(`${h.url}/readyz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready', database: true, keys: true });
  });

  it('/metrics needs the token and then reports counts in Prometheus format', async () => {
    expect((await fetch(`${h.url}/metrics`)).status).toBe(401);
    expect(
      (await fetch(`${h.url}/metrics`, { headers: { authorization: 'Bearer wrong' } })).status,
    ).toBe(401);
    const response = await fetch(`${h.url}/metrics`, {
      headers: { authorization: `Bearer ${h.env.METRICS_TOKEN}` },
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('# TYPE ss_connections gauge');
    expect(text).toMatch(/ss_events_total\{event="message:send",result="OK"\} \d+/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-7/); // no user IDs
  });

  it('answers 404 for anything else', async () => {
    expect((await fetch(`${h.url}/admin`)).status).toBe(404);
  });
});

describe('log correlation IDs (OBS-01)', () => {
  it('gives every HTTP response its own request ID', async () => {
    const first = await fetch(`${h.url}/healthz`);
    const second = await fetch(`${h.url}/nowhere`);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(first.headers.get('x-request-id')).toMatch(uuid);
    expect(second.headers.get('x-request-id')).toMatch(uuid);
    expect(first.headers.get('x-request-id')).not.toBe(second.headers.get('x-request-id'));
  });

  it('writes the socket ID on every log line about a connection', async () => {
    const user = await createTestUser(h.db);
    const socket = await h.connectAs(user.id);
    const socketId = socket.id;
    socket.close();
    await new Promise((done) => setTimeout(done, 50));
    const lines = h.logs
      .map((line) => JSON.parse(line) as { msg?: string; socketId?: string; userId?: string })
      .filter((entry) => entry.socketId === socketId);
    expect(lines.map((entry) => entry.msg)).toEqual(['connection accepted', 'connection closed']);
    expect(lines.every((entry) => entry.userId === user.id)).toBe(true);
  });
});

describe('restarts (HIST-01)', () => {
  it('keeps acknowledged messages: a new server on the same database resyncs them', async () => {
    const own = await startHarness();
    const ava = await createTestUser(own.db);
    const sam = await createTestUser(own.db);
    const room = await createTestRoom(own.db, ava.id, [sam.id]);
    const before = await own.connectAs(ava.id);
    for (const body of ['first', 'second']) {
      const ack = await request(before, 'message:send', {
        conversationId: room.id,
        clientId: uuidv4(),
        body,
      });
      expect(ack.ok).toBe(true);
    }
    const oldUrl = own.url;

    await own.restart();
    expect(own.url).not.toBe(oldUrl);

    const samSocket = await own.connectAs(sam.id);
    const sync = await request<{
      results: { events: { message: { body: string | null } }[] }[];
    }>(samSocket, 'sync:request', { cursors: [{ conversationId: room.id, afterEventSeq: 0 }] });
    if (!sync.ok) throw new Error(sync.error.message);
    expect(sync.data.results[0]?.events.map((e) => e.message.body)).toEqual(['first', 'second']);

    // Numbering continues where it stopped: no gap and no reuse after the restart.
    const after = await own.connectAs(ava.id);
    const third = await request<{ message: { seq: number } }>(after, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'third',
    });
    if (!third.ok) throw new Error(third.error.message);
    expect(third.data.message.seq).toBe(3);
    await own.close();
  });
});

describe('graceful shutdown (REL-01)', () => {
  it('tells clients to reconnect, finishes, and refuses new connections', async () => {
    const own = await startHarness();
    const user = await createTestUser(own.db);
    const room = await createTestRoom(own.db, user.id);
    const socket = await own.connectAs(user.id);
    await request(socket, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'before',
    });

    const notice = nextEvent<{ reason: string; reconnectAfterMs?: number }>(
      socket,
      'session:ended',
    );
    const stopping = own.server.stop();
    expect(await notice).toEqual({ reason: 'server_shutdown', reconnectAfterMs: 2000 });
    await stopping;
    const rows = await own.db
      .select()
      .from(schema.message)
      .where(eq(schema.message.conversationId, room.id));
    expect(rows.map((r) => r.body)).toEqual(['before']);
    await expect(fetch(`${own.url}/healthz`)).rejects.toThrow();
    await own.close();
  });
});
