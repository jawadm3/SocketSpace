/**
 * Filing reports from the app (SAFE-01, SEC-01, SEC-02): the payload is checked, attempts are
 * limited per hour, and refusals are worded for the person without giving anything away.
 */
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq, schema, sendMessage } from '@socketspace/db';
import {
  createTestDatabase,
  createTestRoom,
  createTestUser,
  type TestDatabase,
} from '@socketspace/db/testing';
import { LIMITS } from '@socketspace/shared/limits';

import { fileReport } from './reports';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

async function scene() {
  const ava = await createTestUser(t.db);
  const sam = await createTestUser(t.db);
  const room = await createTestRoom(t.db, ava.id, [sam.id]);
  const sent = await sendMessage(t.db, {
    conversationId: room.id,
    authorId: sam.id,
    clientId: uuidv4(),
    body: 'buy my stuff',
  });
  if (!sent.ok) throw new Error(sent.reason);
  return { ava, sam, room, message: sent.message };
}

const reportsBy = (reporterId: string) =>
  t.db.select().from(schema.report).where(eq(schema.report.reporterId, reporterId));

describe('fileReport', () => {
  it('stores a report of a message, a person and a room', async () => {
    const { ava, sam, room, message } = await scene();
    const base = { reason: 'spam', details: '  Third time today  ' };
    expect(
      await fileReport(t.db, ava.id, { ...base, targetType: 'message', messageId: message.id }),
    ).toEqual({ ok: true, duplicate: false });
    expect(
      await fileReport(t.db, ava.id, {
        ...base,
        targetType: 'user',
        userId: sam.id,
        aspect: 'profile_picture',
        conversationId: room.id,
      }),
    ).toEqual({ ok: true, duplicate: false });
    expect(
      await fileReport(t.db, sam.id, { ...base, targetType: 'room', conversationId: room.id }),
    ).toEqual({ ok: true, duplicate: false });

    const stored = await reportsBy(ava.id);
    expect(stored.map((r) => r.targetType).sort()).toEqual(['message', 'user']);
    // Details are trimmed and normalised by the shared contract.
    expect(stored[0]?.details).toBe('Third time today');
  });

  it('says so when the same thing is reported twice', async () => {
    const { ava, message } = await scene();
    const input = { targetType: 'message', messageId: message.id, reason: 'spam', details: '' };
    expect(await fileReport(t.db, ava.id, input)).toEqual({ ok: true, duplicate: false });
    expect(await fileReport(t.db, ava.id, input)).toEqual({ ok: true, duplicate: true });
    expect(await reportsBy(ava.id)).toHaveLength(1);
  });

  it.each([
    ['an unknown reason', { reason: 'boring' }],
    ['no reason', { reason: undefined }],
    ['details that are too long', { details: 'x'.repeat(LIMITS.report.detailsMax + 1) }],
    ['a field that does not belong', { evidence: { message: { body: 'made up' } } }],
    ['a different target field', { messageId: undefined, userId: uuidv4() }],
    ['an ID that is not an ID', { messageId: 'abc' }],
  ])('refuses %s without storing or counting anything', async (_name, change) => {
    const { ava, message } = await scene();
    const result = await fileReport(t.db, ava.id, {
      targetType: 'message',
      messageId: message.id,
      reason: 'spam',
      details: '',
      ...change,
    });
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await reportsBy(ava.id)).toEqual([]);
    const counted = await t.db
      .select()
      .from(schema.httpRateLimit)
      .where(eq(schema.httpRateLimit.key, `report:${ava.id}`));
    expect(counted).toEqual([]);
  });

  it('answers the same for missing and private things, and refuses reporting yourself', async () => {
    const { ava, sam, message } = await scene();
    const outsider = await createTestUser(t.db);
    const secret = await createTestRoom(t.db, ava.id, [], { visibility: 'private' });
    const gone = { ok: false, code: 'NOT_FOUND', message: 'That is no longer there to report.' };
    const common = { reason: 'other', details: '' };
    expect(
      await fileReport(t.db, outsider.id, {
        ...common,
        targetType: 'room',
        conversationId: secret.id,
      }),
    ).toEqual(gone);
    expect(
      await fileReport(t.db, outsider.id, {
        ...common,
        targetType: 'room',
        conversationId: uuidv4(),
      }),
    ).toEqual(gone);
    expect(
      await fileReport(t.db, sam.id, { ...common, targetType: 'message', messageId: message.id }),
    ).toMatchObject({ ok: false, code: 'VALIDATION', message: 'You cannot report yourself.' });
  });

  it('allows 10 attempts an hour, counting the ones that find nothing', async () => {
    const { ava, message } = await scene();
    const probe = () =>
      fileReport(t.db, ava.id, {
        targetType: 'message',
        messageId: uuidv4(),
        reason: 'other',
        details: '',
      });
    for (let i = 0; i < LIMITS.report.perHour; i++) {
      expect(await probe()).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    }
    const refused = await fileReport(t.db, ava.id, {
      targetType: 'message',
      messageId: message.id,
      reason: 'spam',
      details: '',
    });
    expect(refused).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    if (!refused.ok) {
      expect(refused.retryAfterMs).toBeGreaterThan(0);
      expect(refused.retryAfterMs).toBeLessThanOrEqual(3600_000);
    }
    expect(await reportsBy(ava.id)).toEqual([]);
  });
});
