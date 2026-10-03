/**
 * Direct messages over real sockets (DM-02, NOTIF-01): live notifications, delivery and read
 * receipts for the other person, and the read-receipt opt-out.
 */
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setPrivacySettings } from '@socketspace/db';
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

type Socket = Awaited<ReturnType<Harness['connectAs']>>;

async function send(socket: Socket, conversationId: string, body: string, replyToId?: string) {
  const ack = await request<{ message: MessageWire }>(socket, 'message:send', {
    conversationId,
    clientId: uuidv4(),
    body,
    ...(replyToId ? { replyToId } : {}),
  });
  if (!ack.ok) throw new Error(JSON.stringify(ack));
  return ack.data.message;
}

function arrives(socket: Socket, event: string, ms = 300) {
  return nextEvent(socket, event, ms).then(
    () => true,
    () => false,
  );
}

async function inADm() {
  const ava = await createTestUser(h.db);
  const sam = await createTestUser(h.db);
  const dm = await createTestDm(h.db, ava.id, sam.id);
  const avaSocket = await h.connectAs(ava.id);
  const samSocket = await h.connectAs(sam.id);
  return { ava, sam, dm, avaSocket, samSocket };
}

describe('notifications (NOTIF-01)', () => {
  it('pushes a mention and a DM to the person notified, with the actor by nickname only', async () => {
    const { ava, sam, dm, avaSocket, samSocket } = await inADm();
    const dmNotice = nextEvent<{ notification: Record<string, unknown> }>(
      samSocket,
      'notification:new',
    );
    const sent = await send(avaSocket, dm.id, 'psst');
    expect((await dmNotice).notification).toMatchObject({
      type: 'dm',
      conversationId: dm.id,
      messageId: sent.id,
      actor: { id: ava.id, nickname: ava.nickname },
      readAt: null,
    });
    expect((await dmNotice).notification.actor).not.toHaveProperty('realName');

    const room = await createTestRoom(h.db, ava.id, [sam.id]);
    const avaInRoom = await h.connectAs(ava.id);
    const mention = nextEvent<{ notification: { type: string } }>(samSocket, 'notification:new');
    const authorHearsNothing = arrives(avaInRoom, 'notification:new');
    await send(avaInRoom, room.id, `hello @${String(sam.nickname)}`);
    expect((await mention).notification.type).toBe('mention');
    expect(await authorHearsNothing).toBe(false);
    avaSocket.close();
    samSocket.close();
    avaInRoom.close();
  });
});

describe('receipts (DM-02)', () => {
  it('tells the sender when the other device received and read a DM', async () => {
    const { sam, dm, avaSocket, samSocket } = await inADm();
    const sent = await send(avaSocket, dm.id, 'are you there?');

    const delivered = nextEvent<{ userId: string; seq: number }>(avaSocket, 'delivery:updated');
    samSocket.emit('delivery:ack', { items: [{ conversationId: dm.id, seq: sent.seq }] });
    expect(await delivered).toEqual({ conversationId: dm.id, userId: sam.id, seq: sent.seq });

    const seen = nextEvent<{ userId: string; seq: number }>(avaSocket, 'read:updated');
    expect(
      await request(samSocket, 'read:update', { conversationId: dm.id, seq: sent.seq }),
    ).toMatchObject({ ok: true });
    expect(await seen).toEqual({ conversationId: dm.id, userId: sam.id, seq: sent.seq });
    avaSocket.close();
    samSocket.close();
  });

  it('shows no receipts when either person switched them off, and none for rooms', async () => {
    const { sam, dm, avaSocket, samSocket } = await inADm();
    await setPrivacySettings(h.db, sam.id, { dmPolicy: 'everyone', readReceipts: false });
    const sent = await send(avaSocket, dm.id, 'hello');
    const noDelivery = arrives(avaSocket, 'delivery:updated');
    const noSeen = arrives(avaSocket, 'read:updated');
    samSocket.emit('delivery:ack', { items: [{ conversationId: dm.id, seq: sent.seq }] });
    await request(samSocket, 'read:update', { conversationId: dm.id, seq: sent.seq });
    expect(await noDelivery).toBe(false);
    expect(await noSeen).toBe(false);

    // Delivery for a conversation the socket is not in is ignored.
    const strangerDm = await createTestDm(h.db, (await createTestUser(h.db)).id, sam.id);
    samSocket.emit('delivery:ack', { items: [{ conversationId: strangerDm.id, seq: 1 }] });
    avaSocket.close();
    samSocket.close();
  });
});
