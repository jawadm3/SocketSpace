/**
 * Room membership and settings reaching live connections (ROOM-02, ROOM-05, ROOM-06, PROF-01):
 * the database changes through the same room queries the web app uses, then the web app's
 * internal event tells the realtime server, which moves sockets and broadcasts.
 */
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  roomBanUser,
  roomCreate,
  roomDelete,
  roomJoin,
  roomMute,
  roomSetRole,
  roomUpdate,
  schema,
  eq,
} from '@socketspace/db';
import { createTestUser } from '@socketspace/db/testing';
import type { MessageWire } from '@socketspace/shared/events';

import { eventBase, nextEvent, request, startHarness, type Harness } from './test/harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

let counter = 0;
async function newRoom(ownerId: string) {
  counter += 1;
  const created = await roomCreate(h.db, ownerId, {
    slug: `live-room-${String(counter)}-${uuidv4().slice(0, 6)}`,
    name: 'Live room',
    topic: '',
    visibility: 'public',
  });
  if (!created.ok) throw new Error(created.reason);
  return created.room;
}

/** Resolves true if `event` arrives within `ms`, false otherwise. */
function arrives(socket: Parameters<typeof nextEvent>[0], event: string, ms = 300) {
  return nextEvent(socket, event, ms).then(
    () => true,
    () => false,
  );
}

describe('joining (ROOM-02)', () => {
  it('tells the new member and the room, nickname only, and delivers new messages', async () => {
    const owner = await createTestUser(h.db, { name: 'Olive Owner' });
    const sam = await createTestUser(h.db, { name: 'Sam Real' });
    await h.db
      .update(schema.user)
      .set({ realNameVisibility: 'everyone', nameDisplay: 'both' })
      .where(eq(schema.user.id, sam.id));
    const room = await newRoom(owner.id);
    const ownerSocket = await h.connectAs(owner.id);
    const samSocket = await h.connectAs(sam.id);

    await roomJoin(h.db, sam.id, room.id);
    const joined = nextEvent<{ conversation: { id: string; memberCount: number } }>(
      samSocket,
      'conversation:joined',
    );
    const announced = nextEvent<{ member: { user: Record<string, unknown>; role: string } }>(
      ownerSocket,
      'member:joined',
    );
    // Presence (RT-03): each learns that the other is online, without reconnecting.
    const samOnline = nextEvent<{ userId: string; status: string }>(ownerSocket, 'presence');
    const ownerOnline = nextEvent<{ userId: string; status: string }>(samSocket, 'presence');
    await h.postEvent({
      ...eventBase(),
      type: 'member.added',
      conversationId: room.id,
      userId: sam.id,
      role: 'member',
    });
    expect((await joined).conversation).toMatchObject({ id: room.id, memberCount: 2 });
    const member = (await announced).member;
    expect(member).toMatchObject({ role: 'member', user: { id: sam.id, nickname: sam.nickname } });
    // One broadcast reaches many viewers, so it never carries a real name (D-024).
    expect(member.user).not.toHaveProperty('realName');
    expect(await samOnline).toMatchObject({ userId: sam.id, status: 'online' });
    expect(await ownerOnline).toMatchObject({ userId: owner.id, status: 'online' });

    const delivered = nextEvent<{ message: MessageWire }>(samSocket, 'message:new');
    await request(ownerSocket, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'welcome',
    });
    expect((await delivered).message.body).toBe('welcome');
    ownerSocket.close();
    samSocket.close();
  });
});

describe('room moderation reaching live connections (ROOM-05, journey J5)', () => {
  it('a banned member is told why, leaves the room at once and receives nothing more', async () => {
    const owner = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const lee = await createTestUser(h.db);
    const room = await newRoom(owner.id);
    await roomJoin(h.db, sam.id, room.id);
    await roomJoin(h.db, lee.id, room.id);
    const ownerSocket = await h.connectAs(owner.id);
    const samSocket = await h.connectAs(sam.id);
    const leeSocket = await h.connectAs(lee.id);

    const banned = await roomBanUser(h.db, owner.id, room.id, sam.id, null, 'harassment');
    if (!banned.ok) throw new Error(banned.reason);
    const left = nextEvent(samSocket, 'conversation:left');
    const notice = nextEvent(samSocket, 'room:notice');
    const memberLeft = nextEvent(leeSocket, 'member:left');
    await h.postEvent({
      ...eventBase(),
      type: 'member.removed',
      conversationId: room.id,
      userId: sam.id,
      cause: 'banned',
      reason: 'harassment',
      until: null,
    });
    expect(await left).toEqual({ conversationId: room.id });
    expect(await notice).toEqual({
      conversationId: room.id,
      kind: 'banned',
      reason: 'harassment',
      until: null,
    });
    expect(await memberLeft).toEqual({ conversationId: room.id, userId: sam.id });

    const samGetsNothing = arrives(samSocket, 'message:new');
    const leeGets = nextEvent(leeSocket, 'message:new');
    await request(ownerSocket, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'after the ban',
    });
    await leeGets;
    expect(await samGetsNothing).toBe(false);

    // And sam's own sends are refused by the database, even on the old connection.
    const refused = await request(samSocket, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'let me back',
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    for (const s of [ownerSocket, samSocket, leeSocket]) s.close();
  });

  it('a muted member is told until when; sends are refused with the time left', async () => {
    const owner = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const room = await newRoom(owner.id);
    await roomJoin(h.db, sam.id, room.id);
    const samSocket = await h.connectAs(sam.id);

    const muted = await roomMute(h.db, owner.id, room.id, sam.id, 10 * 60_000, 'flooding');
    if (!muted.ok) throw new Error(muted.reason);
    const notice = nextEvent(samSocket, 'room:notice');
    await h.postEvent({
      ...eventBase(),
      type: 'member.muted',
      conversationId: room.id,
      userId: sam.id,
      until: muted.until.toISOString(),
      reason: 'flooding',
    });
    expect(await notice).toEqual({
      conversationId: room.id,
      kind: 'muted',
      reason: 'flooding',
      until: muted.until.toISOString(),
    });
    const refused = await request(samSocket, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'hello?',
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.error.retryAfterMs).toBeGreaterThan(9 * 60_000);
    samSocket.close();
  });

  it('a role change is announced to the room', async () => {
    const owner = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const room = await newRoom(owner.id);
    await roomJoin(h.db, sam.id, room.id);
    const ownerSocket = await h.connectAs(owner.id);
    await roomSetRole(h.db, owner.id, room.id, sam.id, 'moderator');
    const updated = nextEvent<{ member: { role: string; user: { id: string } } }>(
      ownerSocket,
      'member:updated',
    );
    await h.postEvent({
      ...eventBase(),
      type: 'member.role_changed',
      conversationId: room.id,
      userId: sam.id,
      role: 'moderator',
    });
    expect((await updated).member).toMatchObject({ role: 'moderator', user: { id: sam.id } });
    ownerSocket.close();
  });
});

describe('room settings (ROOM-06)', () => {
  it('broadcasts a rename, and a deletion takes everyone out of the room', async () => {
    const owner = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const room = await newRoom(owner.id);
    await roomJoin(h.db, sam.id, room.id);
    const samSocket = await h.connectAs(sam.id);

    await roomUpdate(h.db, owner.id, room.id, { name: 'Renamed', topic: 'New topic' });
    const updated = nextEvent<{ conversation: { name: string; topic: string } }>(
      samSocket,
      'conversation:updated',
    );
    await h.postEvent({ ...eventBase(), type: 'conversation.updated', conversationId: room.id });
    expect((await updated).conversation).toMatchObject({ name: 'Renamed', topic: 'New topic' });

    await roomDelete(h.db, owner.id, room.id);
    const left = nextEvent(samSocket, 'conversation:left');
    await h.postEvent({ ...eventBase(), type: 'conversation.deleted', conversationId: room.id });
    expect(await left).toEqual({ conversationId: room.id });
    samSocket.close();
  });
});

describe('profile changes (PROF-01)', () => {
  it('a new nickname reaches everyone who shares a room, at once', async () => {
    const owner = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const room = await newRoom(owner.id);
    await roomJoin(h.db, sam.id, room.id);
    const ownerSocket = await h.connectAs(owner.id);

    const nickname = `renamed${String(counter)}${uuidv4().slice(0, 4)}`;
    await h.db.update(schema.user).set({ nickname }).where(eq(schema.user.id, sam.id));
    const updated = nextEvent<{ user: { id: string; nickname: string } }>(
      ownerSocket,
      'user:updated',
    );
    await h.postEvent({ ...eventBase(), type: 'user.updated', userId: sam.id });
    expect((await updated).user).toMatchObject({ id: sam.id, nickname });
    ownerSocket.close();
  });
});
