/**
 * Safety on live connections (SAFE-02, ADMIN-03):
 *
 * - the word-list filter on `message:send` and `message:edit`: blocked, masked or left alone;
 * - sanctions applied through the same database functions the web app uses, then announced with
 *   the web app's internal events: the person is told the reason, a mute stops sends at once, a
 *   suspension or ban closes every connection.
 */
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applySanction, eq, liftSanction, schema } from '@socketspace/db';
import { createTestRoom, createTestUser } from '@socketspace/db/testing';
import type { MessageWire } from '@socketspace/shared/events';
import { MASK_CHAR } from '@socketspace/shared/moderation';

import { eventBase, nextEvent, request, startHarness, type Harness } from './test/harness';

let h: Harness;
let admin: { id: string };

beforeAll(async () => {
  h = await startHarness();
  admin = await createTestUser(h.db, { role: 'admin' });
});

afterAll(async () => {
  await h.close();
});

type Socket = Awaited<ReturnType<Harness['connectAs']>>;

/** Resolves true if `event` arrives within `ms`, false otherwise. */
function arrives(socket: Socket, event: string, ms = 300) {
  return nextEvent(socket, event, ms).then(
    () => true,
    () => false,
  );
}

const sendTo = (socket: Socket, conversationId: string, body: string) =>
  request<{ message: MessageWire }>(socket, 'message:send', {
    conversationId,
    clientId: uuidv4(),
    body,
  });

const storedIn = (conversationId: string) =>
  h.db.select().from(schema.message).where(eq(schema.message.conversationId, conversationId));

interface Notice {
  kind: string;
  reason: string;
  until: string | null;
}

/** What the web app does after a moderator's action: change the database, then tell us. */
async function sanction(
  targetUserId: string,
  kind: 'warn' | 'mute' | 'suspend' | 'ban' | 'random_timeout',
  reason: string,
  durationSeconds?: number,
) {
  const result = await applySanction(h.db, {
    actor: { type: 'admin', id: admin.id },
    targetUserId,
    kind,
    reason,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  });
  if (!result.ok) throw new Error(result.reason);
  const response = await h.postEvent({
    ...eventBase(),
    type: 'user.sanctioned',
    userId: targetUserId,
    kind,
    reason: result.sanction.reason,
    until: result.sanction.expiresAt?.toISOString() ?? null,
  });
  expect(response.status).toBe(204);
  return result.sanction;
}

describe('the word-list filter on live messages (SAFE-02)', () => {
  it('blocks high severity: the sender is told, nobody receives it, nothing is stored', async () => {
    const ava = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const room = await createTestRoom(h.db, ava.id, [sam.id]);
    const avaSocket = await h.connectAs(ava.id);
    const samSocket = await h.connectAs(sam.id);
    const received = arrives(samSocket, 'message:new');

    const body = 'just kill yourself';
    const ack = await sendTo(avaSocket, room.id, body);
    expect(ack).toMatchObject({ ok: false, error: { code: 'CONTENT_BLOCKED' } });
    if (!ack.ok) expect(ack.error.message).not.toContain('kill');
    expect(await received).toBe(false);
    expect(await storedIn(room.id)).toEqual([]);

    const flags = await h.db
      .select()
      .from(schema.contentFlag)
      .where(eq(schema.contentFlag.userId, ava.id));
    expect(flags).toMatchObject([{ severity: 'high', excerpt: body, messageId: null }]);
    // The text is in the moderators' queue, never in the logs (SEC-11).
    expect(h.logs.join('\n')).not.toContain('kill yourself');
  });

  it('masks medium severity for everyone, live and on resync; the stored text is as written', async () => {
    const ava = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const room = await createTestRoom(h.db, ava.id, [sam.id]);
    const avaSocket = await h.connectAs(ava.id);
    const samSocket = await h.connectAs(sam.id);
    const live = nextEvent<{ message: MessageWire }>(samSocket, 'message:new');

    const masked = `you ${MASK_CHAR.repeat(4)}`;
    const ack = await sendTo(avaSocket, room.id, 'you slut');
    if (!ack.ok) throw new Error(ack.error.code);
    expect(ack.data.message).toMatchObject({ body: masked, moderationState: 'flagged' });
    expect((await live).message.body).toBe(masked);

    const sync = await request<{ results: { events: { message: MessageWire }[] }[] }>(
      samSocket,
      'sync:request',
      { cursors: [{ conversationId: room.id, afterEventSeq: 0 }] },
    );
    if (!sync.ok) throw new Error(sync.error.code);
    expect(sync.data.results[0]?.events.map((e) => e.message.body)).toEqual([masked]);

    expect(await storedIn(room.id)).toMatchObject([{ body: 'you slut', filterSeverity: 2 }]);
  });

  it('leaves low severity alone in community rooms', async () => {
    const ava = await createTestUser(h.db);
    const room = await createTestRoom(h.db, ava.id);
    const socket = await h.connectAs(ava.id);
    const ack = await sendTo(socket, room.id, 'what a shit day');
    if (!ack.ok) throw new Error(ack.error.code);
    expect(ack.data.message).toMatchObject({ body: 'what a shit day', moderationState: 'visible' });
  });

  it('checks edits the same way', async () => {
    const ava = await createTestUser(h.db);
    const sam = await createTestUser(h.db);
    const room = await createTestRoom(h.db, ava.id, [sam.id]);
    const avaSocket = await h.connectAs(ava.id);
    const samSocket = await h.connectAs(sam.id);
    const sent = await sendTo(avaSocket, room.id, 'hello');
    if (!sent.ok) throw new Error(sent.error.code);
    const edit = (body: string) =>
      request<{ message: MessageWire }>(avaSocket, 'message:edit', {
        messageId: sent.data.message.id,
        body,
      });

    const updated = arrives(samSocket, 'message:updated');
    expect(await edit('k y s')).toMatchObject({ ok: false, error: { code: 'CONTENT_BLOCKED' } });
    expect(await updated).toBe(false);
    expect(await storedIn(room.id)).toMatchObject([{ body: 'hello', editedAt: null }]);

    const seen = nextEvent<{ message: MessageWire }>(samSocket, 'message:updated');
    const flagged = await edit('hello r3tard');
    if (!flagged.ok) throw new Error(flagged.error.code);
    expect(flagged.data.message.body).toBe(`hello ${MASK_CHAR.repeat(6)}`);
    expect((await seen).message.body).toBe(`hello ${MASK_CHAR.repeat(6)}`);
  });

  it('counts filter hits in the metrics, by severity only', () => {
    const metrics = h.server.metrics.render();
    expect(metrics).toContain('ss_filter_hits_total{severity="3"}');
    expect(metrics).toContain('ss_filter_hits_total{severity="2"}');
    expect(metrics).not.toContain('slut');
  });
});

describe('sanctions on live connections (ADMIN-03)', () => {
  it('a warning reaches only the person warned, with the reason', async () => {
    const target = await createTestUser(h.db);
    const bystander = await createTestUser(h.db);
    const room = await createTestRoom(h.db, target.id, [bystander.id]);
    const targetSocket = await h.connectAs(target.id);
    const otherTab = await h.connectAs(target.id);
    const bystanderSocket = await h.connectAs(bystander.id);
    const notices = [
      nextEvent<Notice>(targetSocket, 'moderation:notice'),
      nextEvent<Notice>(otherTab, 'moderation:notice'),
    ];
    const leaked = arrives(bystanderSocket, 'moderation:notice');

    await sanction(target.id, 'warn', 'Please stop posting adverts.');
    for (const notice of await Promise.all(notices)) {
      expect(notice).toEqual({
        kind: 'warned',
        reason: 'Please stop posting adverts.',
        until: null,
      });
    }
    expect(await leaked).toBe(false);
    // A warning restricts nothing.
    expect((await sendTo(targetSocket, room.id, 'understood')).ok).toBe(true);
  });

  it('a mute stops sends at once and says until when; lifting it lets them post again', async () => {
    const target = await createTestUser(h.db);
    const room = await createTestRoom(h.db, admin.id, [target.id]);
    const socket = await h.connectAs(target.id);
    expect((await sendTo(socket, room.id, 'before')).ok).toBe(true);

    const told = nextEvent<Notice>(socket, 'moderation:notice');
    const applied = await sanction(target.id, 'mute', 'Flooding', 3600);
    expect(await told).toEqual({
      kind: 'muted',
      reason: 'Flooding',
      until: applied.expiresAt?.toISOString(),
    });

    const refused = await sendTo(socket, room.id, 'during');
    expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    if (!refused.ok) {
      expect(refused.error.retryAfterMs).toBeGreaterThan(3500_000);
      expect(refused.error.retryAfterMs).toBeLessThanOrEqual(3600_000);
    }
    // The connection stays open: a muted person can still read.
    expect(socket.connected).toBe(true);

    const lifted = nextEvent<Notice>(socket, 'moderation:notice');
    const result = await liftSanction(h.db, {
      actorId: admin.id,
      targetUserId: target.id,
      kind: 'mute',
      reason: 'Appeal accepted',
    });
    expect(result.ok).toBe(true);
    await h.postEvent({
      ...eventBase(),
      type: 'user.unsanctioned',
      userId: target.id,
      kind: 'mute',
    });
    expect(await lifted).toEqual({ kind: 'unmuted', reason: '', until: null });
    expect((await sendTo(socket, room.id, 'after')).ok).toBe(true);
  });

  it.each([
    ['suspend', 'suspended', 3600],
    ['ban', 'banned', undefined],
  ] as const)(
    'a %s tells the person why, closes every connection and refuses new ones',
    async (kind, word, duration) => {
      const target = await createTestUser(h.db);
      const first = await h.connectAs(target.id);
      const second = await h.connectAs(target.id);
      const told = nextEvent<Notice>(first, 'moderation:notice');
      const ended = [first, second].map((s) => nextEvent<{ reason: string }>(s, 'session:ended'));
      const closed = [first, second].map((s) => nextEvent(s, 'disconnect'));

      await sanction(target.id, kind, 'Threatening another member', duration);
      expect(await told).toMatchObject({ kind: word, reason: 'Threatening another member' });
      for (const end of await Promise.all(ended)) expect(end).toEqual({ reason: word });
      await Promise.all(closed);
      expect(first.connected).toBe(false);
      expect(second.connected).toBe(false);

      // Their old sessions are gone, and a session that somehow still existed would not help.
      await expect(h.connectAs(target.id)).rejects.toMatchObject({
        data: { code: 'FORBIDDEN', message: 'This account is suspended or closed.' },
      });
    },
  );

  it('a suspended person can connect again after it is lifted', async () => {
    const target = await createTestUser(h.db);
    await sanction(target.id, 'suspend', 'Mistake', 3600);
    await expect(h.connectAs(target.id)).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    const result = await liftSanction(h.db, {
      actorId: admin.id,
      targetUserId: target.id,
      kind: 'suspend',
      reason: 'Wrong account',
    });
    expect(result).toMatchObject({ ok: true, status: 'active' });
    const response = await h.postEvent({
      ...eventBase(),
      type: 'user.unsanctioned',
      userId: target.id,
      kind: 'suspend',
    });
    expect(response.status).toBe(204);
    const socket = await h.connectAs(target.id);
    expect(socket.connected).toBe(true);
  });

  it('a random-mode timeout is announced and leaves community chat alone', async () => {
    const target = await createTestUser(h.db);
    const room = await createTestRoom(h.db, admin.id, [target.id]);
    const socket = await h.connectAs(target.id);
    const told = nextEvent<Notice>(socket, 'moderation:notice');
    const applied = await sanction(target.id, 'random_timeout', 'Reported by three people', 3600);
    expect(await told).toEqual({
      kind: 'random_timeout',
      reason: 'Reported by three people',
      until: applied.expiresAt?.toISOString(),
    });
    expect(socket.connected).toBe(true);
    expect((await sendTo(socket, room.id, 'still here')).ok).toBe(true);

    const lifted = nextEvent<Notice>(socket, 'moderation:notice');
    await h.postEvent({
      ...eventBase(),
      type: 'user.unsanctioned',
      userId: target.id,
      kind: 'random_timeout',
    });
    expect(await lifted).toMatchObject({ kind: 'random_timeout_lifted' });
  });
});
