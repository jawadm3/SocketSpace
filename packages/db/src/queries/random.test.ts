/**
 * Random-match mode in the database (RAND-02 to RAND-10): the 18+ gate record, chat metadata
 * without text, reports with the server's evidence, automatic timeouts, contacts, room
 * suggestions and the aggregate counters.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RANDOM_RULES_VERSION, isRandomGateAccepted } from '@socketspace/shared/random';

import { user } from '../schema/auth';
import { metricDaily } from '../schema/ops';
import {
  contentFlag,
  moderationAction,
  networkBan,
  randomSession,
  report,
  userSanction,
} from '../schema/safety';
import { contact, notification } from '../schema/social';
import {
  createTestDatabase,
  createTestRoom,
  createTestUser,
  rowsOf,
  type TestDatabase,
} from '../testing';
import { blockUser } from './dms';
import {
  acceptRandomGate,
  addRandomContact,
  applyAutomaticRandomTimeout,
  AUTOMATIC_TIMEOUT_REASON,
  bumpMetric,
  closeOpenRandomSessions,
  createRandomReport,
  deleteOldRandomSessions,
  endRandomSession,
  getMetricTotal,
  getRandomEntry,
  getRandomGate,
  getRandomPause,
  startRandomSession,
  suggestRoomsForInterests,
} from './random';
import { recordWordListFlag } from './reports';
import { applySanction, SYSTEM_ACTOR_ID } from './sanctions';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

const pair = async () => {
  const a = await createTestUser(t.db);
  const b = await createTestUser(t.db);
  const session = await startRandomSession(t.db, {
    participantA: a.id,
    participantB: b.id,
    sharedInterestCount: 1,
  });
  return { a, b, session };
};

describe('the 18+ gate (RAND-02)', () => {
  it('is not accepted until the person confirms, and records the version', async () => {
    const ava = await createTestUser(t.db);
    const before = await getRandomGate(t.db, ava.id);
    expect(before).toEqual({ adultConfirmedAt: null, termsVersion: null, termsAcceptedAt: null });
    expect(isRandomGateAccepted(before)).toBe(false);

    expect(await acceptRandomGate(t.db, ava.id, RANDOM_RULES_VERSION)).toBe(true);
    const after = await getRandomGate(t.db, ava.id);
    expect(after?.adultConfirmedAt).toBeInstanceOf(Date);
    expect(after?.termsVersion).toBe(RANDOM_RULES_VERSION);
    expect(isRandomGateAccepted(after)).toBe(true);
  });

  it('asks again when the rules change, and keeps the first confirmation date', async () => {
    const ava = await createTestUser(t.db);
    await acceptRandomGate(t.db, ava.id, 'an-older-version');
    const old = await getRandomGate(t.db, ava.id);
    expect(isRandomGateAccepted(old)).toBe(false);

    await acceptRandomGate(t.db, ava.id, RANDOM_RULES_VERSION);
    const current = await getRandomGate(t.db, ava.id);
    expect(isRandomGateAccepted(current)).toBe(true);
    expect(current?.adultConfirmedAt).toEqual(old?.adultConfirmedAt);
  });

  it('cannot be accepted for a suspended account', async () => {
    const gone = await createTestUser(t.db, { status: 'suspended' });
    expect(await acceptRandomGate(t.db, gone.id, RANDOM_RULES_VERSION)).toBe(false);
  });
});

describe('what random:join checks (getRandomEntry)', () => {
  it('lists blocks in both directions, so neither person meets the other', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const kim = await createTestUser(t.db);
    await blockUser(t.db, ava.id, sam.id);
    await blockUser(t.db, kim.id, ava.id);
    const entry = await getRandomEntry(t.db, ava.id);
    expect(entry.avoid.sort()).toEqual([sam.id, kim.id].sort());
    expect(entry.actor).toMatchObject({ id: ava.id, isGuest: false });
    expect(entry.pause).toBeNull();
    expect(entry.networkBanUntil).toBeNull();
  });

  it('reports the pause that ends last: a random-mode timeout or a site-wide mute', async () => {
    const admin = await createTestUser(t.db, { role: 'admin' });
    const ava = await createTestUser(t.db);
    expect(await getRandomPause(t.db, ava.id)).toBeNull();
    await applySanction(t.db, {
      actor: { type: 'admin', id: admin.id },
      targetUserId: ava.id,
      kind: 'mute',
      reason: 'Flooding',
      durationSeconds: 600,
    });
    expect(await getRandomPause(t.db, ava.id)).toMatchObject({ kind: 'mute', reason: 'Flooding' });
    await applySanction(t.db, {
      actor: { type: 'admin', id: admin.id },
      targetUserId: ava.id,
      kind: 'random_timeout',
      reason: 'Rude to strangers',
      durationSeconds: 7200,
    });
    expect(await getRandomPause(t.db, ava.id)).toMatchObject({
      kind: 'random_timeout',
      reason: 'Rude to strangers',
    });
    // A warning or an expired timeout pauses nothing.
    const sam = await createTestUser(t.db);
    await applySanction(t.db, {
      actor: { type: 'admin', id: admin.id },
      targetUserId: sam.id,
      kind: 'warn',
      reason: 'Be kind',
    });
    expect(await getRandomPause(t.db, sam.id)).toBeNull();
    expect(await getRandomPause(t.db, ava.id, new Date(Date.now() + 3 * 3600 * 1000))).toBeNull();
  });
});

describe('chat metadata (RAND-07)', () => {
  it('stores who, when and how many shared interests, and nothing else', async () => {
    const { a, b, session } = await pair();
    const [row] = await t.db.select().from(randomSession).where(eq(randomSession.id, session.id));
    expect(row).toMatchObject({
      participantA: a.id,
      participantB: b.id,
      sharedInterestCount: 1,
      endedAt: null,
      endReason: null,
    });
    // The table has no column that could hold message text.
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        'endReason',
        'endedAt',
        'id',
        'participantA',
        'participantB',
        'sharedInterestCount',
        'startedAt',
      ].sort(),
    );
  });

  it('ends once, with the reason', async () => {
    const { session } = await pair();
    expect(await endRandomSession(t.db, session.id, 'skip')).toBe(true);
    expect(await endRandomSession(t.db, session.id, 'end')).toBe(false);
    const [row] = await t.db.select().from(randomSession).where(eq(randomSession.id, session.id));
    expect(row?.endReason).toBe('skip');
    expect(row?.endedAt).toBeInstanceOf(Date);
  });

  it('closes chats a stopped server left open', async () => {
    const { session } = await pair();
    expect(await closeOpenRandomSessions(t.db)).toBeGreaterThanOrEqual(1);
    const [row] = await t.db.select().from(randomSession).where(eq(randomSession.id, session.id));
    expect(row?.endReason).toBe('disconnect');
    expect(await closeOpenRandomSessions(t.db)).toBe(0);
  });

  it('deletes metadata after 30 days', async () => {
    const { session: old } = await pair();
    const { session: fresh } = await pair();
    await t.db
      .update(randomSession)
      .set({ startedAt: sql`now() - interval '31 days'` })
      .where(eq(randomSession.id, old.id));
    expect(await deleteOldRandomSessions(t.db)).toBe(1);
    const left = await t.db.select({ id: randomSession.id }).from(randomSession);
    expect(left.map((r) => r.id)).toContain(fresh.id);
    expect(left.map((r) => r.id)).not.toContain(old.id);
  });
});

describe('reports of a random chat (RAND-04, SAFE-01)', () => {
  const messagesOf = (a: string, b: string) => [
    { senderId: a, text: 'hello there', at: new Date('2026-10-04T10:00:00Z'), delivered: true },
    { senderId: b, text: 'you are awful', at: new Date('2026-10-04T10:00:05Z'), delivered: true },
    { senderId: b, text: 'blocked words', at: new Date('2026-10-04T10:00:09Z'), delivered: false },
  ];

  it('stores the server-side record of the chat as evidence, from the reporter view', async () => {
    const { a, b, session } = await pair();
    await endRandomSession(t.db, session.id, 'report');
    const result = await createRandomReport(t.db, {
      reporterId: a.id,
      sessionId: session.id,
      reason: 'harassment',
      details: 'They were rude.',
      messages: messagesOf(a.id, b.id),
    });
    expect(result).toMatchObject({
      ok: true,
      duplicate: false,
      targetUserId: b.id,
      distinctReporters: 1,
    });
    if (!result.ok) return;
    const [row] = await t.db.select().from(report).where(eq(report.id, result.reportId));
    expect(row).toMatchObject({
      reporterId: a.id,
      targetType: 'random_session',
      targetUserId: b.id,
      randomSessionId: session.id,
      messageId: null,
      reason: 'harassment',
      details: 'They were rude.',
      status: 'open',
    });
    expect(row?.evidence).toMatchObject({
      v: 1,
      kind: 'random_session',
      session: { id: session.id, endReason: 'report', sharedInterestCount: 1 },
      messages: [
        { from: 'reporter', text: 'hello there', delivered: true },
        { from: 'reported', text: 'you are awful', delivered: true },
        { from: 'reported', text: 'blocked words', delivered: false },
      ],
      attachmentIds: [],
    });
  });

  it('keeps at most the last 20 messages', async () => {
    const { a, b, session } = await pair();
    const many = Array.from({ length: 30 }, (_, index) => ({
      senderId: index % 2 === 0 ? a.id : b.id,
      text: `message ${String(index)}`,
      at: new Date(Date.UTC(2026, 9, 4, 10, 0, index)),
      delivered: true,
    }));
    const result = await createRandomReport(t.db, {
      reporterId: b.id,
      sessionId: session.id,
      reason: 'spam',
      details: '',
      messages: many,
    });
    if (!result.ok) throw new Error(result.reason);
    const [row] = await t.db.select().from(report).where(eq(report.id, result.reportId));
    const evidence = row?.evidence as { messages: { text: string }[] };
    expect(evidence.messages).toHaveLength(20);
    expect(evidence.messages[0]?.text).toBe('message 10');
    expect(evidence.messages[19]?.text).toBe('message 29');
  });

  it('only someone who was in the chat can report it, and only once', async () => {
    const { a, b, session } = await pair();
    const outsider = await createTestUser(t.db);
    const base = { sessionId: session.id, reason: 'other', details: '', messages: [] } as const;
    expect(await createRandomReport(t.db, { ...base, reporterId: outsider.id })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(
      await createRandomReport(t.db, {
        ...base,
        reporterId: a.id,
        sessionId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });

    const first = await createRandomReport(t.db, { ...base, reporterId: a.id });
    const second = await createRandomReport(t.db, { ...base, reporterId: a.id });
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    if (first.ok && second.ok) expect(second.reportId).toBe(first.reportId);
    expect(await t.db.select().from(report).where(eq(report.targetUserId, b.id))).toHaveLength(1);
  });

  it('a guest may report; a suspended person may not', async () => {
    const guest = await createTestUser(t.db, { isAnonymous: true, onboarded: false });
    const sam = await createTestUser(t.db);
    const session = await startRandomSession(t.db, {
      participantA: guest.id,
      participantB: sam.id,
      sharedInterestCount: 0,
    });
    const base = { sessionId: session.id, reason: 'hate', details: '', messages: [] } as const;
    expect(await createRandomReport(t.db, { ...base, reporterId: guest.id })).toMatchObject({
      ok: true,
      targetUserId: sam.id,
    });
    await t.db.update(user).set({ status: 'suspended' }).where(eq(user.id, sam.id));
    expect(await createRandomReport(t.db, { ...base, reporterId: sam.id })).toEqual({
      ok: false,
      reason: 'reporter_inactive',
    });
  });

  it('counts different reporters of the same person within 24 hours', async () => {
    const target = await createTestUser(t.db);
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const reporter = await createTestUser(t.db);
      const session = await startRandomSession(t.db, {
        participantA: target.id,
        participantB: reporter.id,
        sharedInterestCount: 0,
      });
      const result = await createRandomReport(t.db, {
        reporterId: reporter.id,
        sessionId: session.id,
        reason: 'harassment',
        details: '',
        messages: [],
      });
      if (!result.ok) throw new Error(result.reason);
      counts.push(result.distinctReporters);
      // The same person reporting a second chat does not count twice.
      const again = await startRandomSession(t.db, {
        participantA: reporter.id,
        participantB: target.id,
        sharedInterestCount: 0,
      });
      const repeat = await createRandomReport(t.db, {
        reporterId: reporter.id,
        sessionId: again.id,
        reason: 'harassment',
        details: '',
        messages: [],
      });
      if (repeat.ok) expect(repeat.distinctReporters).toBe(i + 1);
    }
    expect(counts).toEqual([1, 2, 3]);

    // Reports older than 24 hours no longer count.
    await t.db
      .update(report)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(report.targetUserId, target.id));
    const late = await createTestUser(t.db);
    const session = await startRandomSession(t.db, {
      participantA: target.id,
      participantB: late.id,
      sharedInterestCount: 0,
    });
    const result = await createRandomReport(t.db, {
      reporterId: late.id,
      sessionId: session.id,
      reason: 'spam',
      details: '',
      messages: [],
    });
    expect(result).toMatchObject({ ok: true, distinctReporters: 1 });
  });
});

describe('automatic random-mode timeouts (RAND-05)', () => {
  it('pauses random mode for 1 hour after a blocked message, by the system, with a reason', async () => {
    const ava = await createTestUser(t.db);
    const now = new Date('2026-10-04T12:00:00.000Z');
    const result = await applyAutomaticRandomTimeout(t.db, {
      targetUserId: ava.id,
      cause: 'filter',
      now,
    });
    if (!result.applied) throw new Error(result.reason);
    expect(result.sanction).toMatchObject({
      userId: ava.id,
      kind: 'random_timeout',
      scope: 'random',
      reason: AUTOMATIC_TIMEOUT_REASON.filter,
      expiresAt: new Date('2026-10-04T13:00:00.000Z'),
    });
    const [audit] = await t.db
      .select()
      .from(moderationAction)
      .where(eq(moderationAction.id, result.sanction.actionId));
    expect(audit).toMatchObject({
      actorId: SYSTEM_ACTOR_ID,
      action: 'random_timeout',
      targetUserId: ava.id,
      metadata: { scope: 'random', automatic: true },
    });
    // The person is told (a notification), and the pause is what random:join will find.
    expect(
      await t.db.select().from(notification).where(eq(notification.userId, ava.id)),
    ).toMatchObject([{ type: 'moderation' }]);
    expect(await getRandomPause(t.db, ava.id, now)).toMatchObject({ kind: 'random_timeout' });
    // The account itself is untouched.
    const [account] = await t.db.select().from(user).where(eq(user.id, ava.id));
    expect(account?.status).toBe('active');
  });

  it('pauses for 24 hours after three reports, and records the report', async () => {
    const { a, b, session } = await pair();
    const filed = await createRandomReport(t.db, {
      reporterId: a.id,
      sessionId: session.id,
      reason: 'harassment',
      details: '',
      messages: [],
    });
    if (!filed.ok) throw new Error(filed.reason);
    const now = new Date('2026-10-04T12:00:00.000Z');
    const result = await applyAutomaticRandomTimeout(t.db, {
      targetUserId: b.id,
      cause: 'reports',
      reportId: filed.reportId,
      now,
    });
    if (!result.applied) throw new Error(result.reason);
    expect(result.sanction.expiresAt).toEqual(new Date('2026-10-05T12:00:00.000Z'));
    expect(result.sanction.reason).toBe(AUTOMATIC_TIMEOUT_REASON.reports);
    const [audit] = await t.db
      .select()
      .from(moderationAction)
      .where(eq(moderationAction.id, result.sanction.actionId));
    expect(audit?.reportId).toBe(filed.reportId);
  });

  it('adds nothing when a pause at least as long is already in force', async () => {
    const ava = await createTestUser(t.db);
    const now = new Date('2026-10-04T12:00:00.000Z');
    expect(
      (await applyAutomaticRandomTimeout(t.db, { targetUserId: ava.id, cause: 'reports', now }))
        .applied,
    ).toBe(true);
    expect(
      await applyAutomaticRandomTimeout(t.db, { targetUserId: ava.id, cause: 'filter', now }),
    ).toEqual({ applied: false, reason: 'already_paused' });
    expect(
      await applyAutomaticRandomTimeout(t.db, { targetUserId: ava.id, cause: 'reports', now }),
    ).toEqual({ applied: false, reason: 'already_paused' });
    expect(
      await t.db.select().from(userSanction).where(eq(userSanction.userId, ava.id)),
    ).toHaveLength(1);

    // A 1-hour pause does not stand in the way of the longer one.
    const sam = await createTestUser(t.db);
    await applyAutomaticRandomTimeout(t.db, { targetUserId: sam.id, cause: 'filter', now });
    expect(
      (await applyAutomaticRandomTimeout(t.db, { targetUserId: sam.id, cause: 'reports', now }))
        .applied,
    ).toBe(true);
  });

  it('never pauses an administrator or a missing account', async () => {
    const admin = await createTestUser(t.db, { role: 'admin' });
    expect(
      await applyAutomaticRandomTimeout(t.db, { targetUserId: admin.id, cause: 'filter' }),
    ).toEqual({ applied: false, reason: 'target_is_admin' });
    expect(
      await applyAutomaticRandomTimeout(t.db, {
        targetUserId: '00000000-0000-4000-8000-000000000000',
        cause: 'filter',
      }),
    ).toEqual({ applied: false, reason: 'target_not_found' });
  });

  it('keeps a guest out by hashed network address too (RAND-10)', async () => {
    const guest = await createTestUser(t.db, { isAnonymous: true, onboarded: false });
    const ipHash = 'a'.repeat(64);
    const result = await applyAutomaticRandomTimeout(t.db, {
      targetUserId: guest.id,
      cause: 'filter',
      ipHash,
    });
    expect(result.applied).toBe(true);
    const bans = await t.db.select().from(networkBan).where(eq(networkBan.ipHash, ipHash));
    expect(bans).toHaveLength(1);
    expect(bans[0]?.reason).toBe('random_timeout:filter');

    // A fresh guest account from the same address is still kept out; another address is not.
    const next = await createTestUser(t.db, { isAnonymous: true, onboarded: false });
    const same = await getRandomEntry(t.db, next.id, { ipHash });
    expect(same.pause).toBeNull();
    expect(same.networkBanUntil).toBeInstanceOf(Date);
    const other = await getRandomEntry(t.db, next.id, { ipHash: 'b'.repeat(64) });
    expect(other.networkBanUntil).toBeNull();
    // An expired ban no longer counts.
    await t.db
      .update(networkBan)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(networkBan.ipHash, ipHash));
    expect((await getRandomEntry(t.db, next.id, { ipHash })).networkBanUntil).toBeNull();
  });
});

describe('contacts from a random chat (RAND-08)', () => {
  it('makes two people each other contact, once', async () => {
    const ava = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const before = await getMetricTotal(t.db, 'random_mutual_contact_added');
    expect(await addRandomContact(t.db, ava.id, sam.id)).toEqual({ ok: true, created: true });
    expect(await addRandomContact(t.db, sam.id, ava.id)).toEqual({ ok: true, created: false });
    const rows = await t.db.select().from(contact).where(eq(contact.userId, ava.id));
    expect(rows).toMatchObject([{ contactId: sam.id, source: 'random' }]);
    expect(await t.db.select().from(contact).where(eq(contact.userId, sam.id))).toMatchObject([
      { contactId: ava.id, source: 'random' },
    ]);
    expect(await getMetricTotal(t.db, 'random_mutual_contact_added')).toBe(before + 1);
  });

  it('refuses guests, blocked pairs and yourself', async () => {
    const ava = await createTestUser(t.db);
    const guest = await createTestUser(t.db, { isAnonymous: true, onboarded: false });
    const sam = await createTestUser(t.db);
    expect(await addRandomContact(t.db, ava.id, guest.id)).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(await addRandomContact(t.db, ava.id, ava.id)).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    await blockUser(t.db, sam.id, ava.id);
    expect(await addRandomContact(t.db, ava.id, sam.id)).toEqual({ ok: false, reason: 'blocked' });
    expect(await t.db.select().from(contact).where(eq(contact.userId, ava.id))).toEqual([]);
  });
});

describe('room suggestions (RAND-09)', () => {
  it('puts rooms that match the interests first, then the busiest public rooms', async () => {
    const owner = await createTestUser(t.db);
    const viewer = await createTestUser(t.db);
    const members = await Promise.all([createTestUser(t.db), createTestUser(t.db)]);
    const busy = await createTestRoom(
      t.db,
      owner.id,
      members.map((m) => m.id),
      { slug: 'suggest-lounge' },
    );
    const chess = await createTestRoom(t.db, owner.id, [], { slug: 'suggest-chess-club' });
    const secret = await createTestRoom(t.db, owner.id, [], {
      slug: 'suggest-chess-private',
      visibility: 'private',
    });
    const joined = await createTestRoom(t.db, owner.id, [viewer.id], {
      slug: 'suggest-chess-joined',
    });

    const rooms = await suggestRoomsForInterests(t.db, {
      interests: ['chess'],
      viewerId: viewer.id,
    });
    const ids = rooms.map((r) => r.id);
    expect(ids[0]).toBe(chess.id);
    expect(ids).toContain(busy.id);
    expect(ids).not.toContain(secret.id);
    expect(ids).not.toContain(joined.id);
    expect(rooms.length).toBeLessThanOrEqual(5);
    expect(rooms[0]).toEqual({
      id: chess.id,
      slug: 'suggest-chess-club',
      name: expect.any(String) as string,
      memberCount: 1,
    });

    // No shared interest: the busiest public rooms. Wildcard characters are taken literally.
    const general = await suggestRoomsForInterests(t.db, { interests: [], viewerId: viewer.id });
    expect(general.map((r) => r.id)).toContain(busy.id);
    const literal = await suggestRoomsForInterests(t.db, {
      interests: ['%'],
      viewerId: viewer.id,
      limit: 1,
    });
    expect(literal).toHaveLength(1);
  });
});

describe('aggregate counters (RAND-09)', () => {
  it('count per day and name, with no column for a person', async () => {
    const before = await getMetricTotal(t.db, 'random_room_cta_clicked');
    await bumpMetric(t.db, 'random_room_cta_clicked');
    await bumpMetric(t.db, 'random_room_cta_clicked', 2);
    expect(await getMetricTotal(t.db, 'random_room_cta_clicked')).toBe(before + 3);
    const rows = await t.db
      .select()
      .from(metricDaily)
      .where(eq(metricDaily.name, 'random_room_cta_clicked'));
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['day', 'name', 'value']);
    const today = rowsOf<{ day: string }>(
      await t.db.execute(sql`select (now() at time zone 'utc')::date::text as day`),
    )[0]?.day;
    expect(rows[0]?.day).toBe(today);
  });

  it('counts started chats and reports', async () => {
    const started = await getMetricTotal(t.db, 'random_sessions_started');
    const reports = await getMetricTotal(t.db, 'random_reports');
    const { a, session } = await pair();
    await createRandomReport(t.db, {
      reporterId: a.id,
      sessionId: session.id,
      reason: 'spam',
      details: '',
      messages: [],
    });
    expect(await getMetricTotal(t.db, 'random_sessions_started')).toBe(started + 1);
    expect(await getMetricTotal(t.db, 'random_reports')).toBe(reports + 1);
  });
});

describe('filter flags from random mode (RAND-07)', () => {
  it('name the chat and the categories, never the text', async () => {
    const { a, session } = await pair();
    expect(
      await recordWordListFlag(t.db, {
        userId: a.id,
        severity: 'high',
        categories: ['threat'],
        text: '',
        randomSessionId: session.id,
      }),
    ).toBe(true);
    const flags = await t.db.select().from(contentFlag).where(eq(contentFlag.userId, a.id));
    expect(flags).toMatchObject([
      {
        source: 'wordlist',
        severity: 'high',
        categories: ['threat'],
        randomSessionId: session.id,
        messageId: null,
        excerpt: '',
      },
    ]);
  });
});
