/**
 * Random-match mode on live connections (RAND-01 to RAND-11; journey J7):
 *
 * - the 18+ gate and the kill switch decide who may join at all;
 * - people who share an interest are paired first, anyone else after the fallback wait;
 * - messages are relayed, never stored; links and contact details are refused; the strict filter
 *   masks, or blocks and ends the chat with a 1-hour pause;
 * - skip, end, report and block each end the chat the right way; a report carries the server's
 *   own record of the chat, and three reports pause the person for 24 hours;
 * - profiles and contacts are shared only when both people ask; guests chat with stricter limits.
 */
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  acceptRandomGate,
  applySanction,
  eq,
  getMetricTotal,
  schema,
  type Database,
} from '@socketspace/db';
import { createTestRoom, createTestUser, type TestUserOptions } from '@socketspace/db/testing';
import { MASK_CHAR } from '@socketspace/shared/moderation';
import { RANDOM_RULES_VERSION } from '@socketspace/shared/random';

import { eventBase, nextEvent, request, startHarness, type Harness } from './test/harness';

type Socket = Awaited<ReturnType<Harness['connectAs']>>;

interface Person {
  id: string;
  nickname: string | null;
  socket: Socket;
}

interface Matched {
  sessionId: string;
  partner: { alias: string; sharedInterests: string[] };
}
interface Relayed {
  sessionId: string;
  clientId: string;
  text: string;
  from: 'me' | 'them';
  at: string;
}
interface Ended {
  sessionId: string;
  reason: string;
}
interface Notice {
  kind: string;
  reason: string;
  until: string | null;
}

/** Resolves true if `event` arrives within `ms`, false otherwise. */
function arrives(socket: Socket, event: string, ms = 300) {
  return nextEvent(socket, event, ms).then(
    () => true,
    () => false,
  );
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** These tests open many connections from one address; the caps have their own tests. */
const MANY_CONNECTIONS = {
  MAX_CONNECTIONS_PER_IP: '5000',
  NEW_CONNECTIONS_PER_IP_PER_MINUTE: '5000',
};

/** A connected person who has passed the 18+ gate. */
async function person(h: Harness, options: TestUserOptions = {}): Promise<Person> {
  const created = await createTestUser(h.db, options);
  await acceptRandomGate(h.db, created.id, RANDOM_RULES_VERSION);
  return { ...created, socket: await h.connectAs(created.id) };
}

const guestOptions: TestUserOptions = { isAnonymous: true, onboarded: false };

const join = (socket: Socket, interests: string[] = []) =>
  request<{ queued: true }>(socket, 'random:join', { interests });

const say = (socket: Socket, sessionId: string, text: string, clientId = uuidv4()) =>
  request<{ clientId: string }>(socket, 'random:message', { sessionId, clientId, text });

/** Two people in a chat with each other (a tag nobody else uses pairs them at once). */
async function pairUp(h: Harness, a: Person, b: Person) {
  const tag = `tag${uuidv4().slice(0, 8)}`;
  const matched = [a, b].map((p) => nextEvent<Matched>(p.socket, 'random:matched'));
  expect((await join(a.socket, [tag])).ok).toBe(true);
  expect((await join(b.socket, [tag])).ok).toBe(true);
  const [forA, forB] = await Promise.all(matched);
  if (!forA || forA.sessionId !== forB?.sessionId) throw new Error('not paired with each other');
  return { sessionId: forA.sessionId, tag };
}

/** Everything the database holds that could contain chat text, as one string. */
async function databaseText(db: Database): Promise<string> {
  const tables = [
    schema.message,
    schema.report,
    schema.contentFlag,
    schema.moderationAction,
    schema.randomSession,
    schema.userSanction,
    schema.notification,
    schema.metricDaily,
  ];
  const rows = await Promise.all(tables.map((table) => db.select().from(table)));
  return JSON.stringify(rows);
}

describe('random mode (main)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness(MANY_CONNECTIONS, {
      randomTimings: { fallbackAfterMs: 300, matchIntervalMs: 50, reconnectGraceMs: 400 },
    });
  });

  afterAll(async () => {
    await h.close();
  });

  describe('the 18+ gate (RAND-02)', () => {
    it('refuses to queue anyone who has not accepted the current rules', async () => {
      const user = await createTestUser(h.db);
      const socket = await h.connectAs(user.id);
      const refused = await join(socket);
      expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      if (!refused.ok) expect(refused.error.message).toContain('18 or older');

      await acceptRandomGate(h.db, user.id, 'an-older-version');
      expect(await join(socket)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

      await acceptRandomGate(h.db, user.id, RANDOM_RULES_VERSION);
      const waiting = nextEvent<{ since: string }>(socket, 'random:waiting');
      expect(await join(socket)).toEqual({ ok: true, data: { queued: true } });
      expect(Date.parse((await waiting).since)).toBeGreaterThan(Date.now() - 5000);
      expect(await request(socket, 'random:leave', {})).toEqual({ ok: true, data: {} });
    });

    it('refuses an account that has not finished onboarding, but lets a guest in', async () => {
      const half = await person(h, { onboarded: false });
      expect(await join(half.socket)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      const guest = await person(h, guestOptions);
      expect((await join(guest.socket, ['solo-guest'])).ok).toBe(true);
      await request(guest.socket, 'random:leave', {});
    });

    it('refuses invalid interests', async () => {
      const ava = await person(h);
      expect(await join(ava.socket, ['a'])).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    });
  });

  describe('matching (RAND-03)', () => {
    it('pairs shared interests first, and anyone else after the fallback wait', async () => {
      const early = await person(h);
      const ava = await person(h);
      const sam = await person(h);
      const earlyMatched = nextEvent<Matched>(early.socket, 'random:matched', 4000);
      await join(early.socket, ['m-music']);

      const matched = [ava, sam].map((p) => nextEvent<Matched>(p.socket, 'random:matched'));
      await join(ava.socket, ['M-Chess', 'm-films']);
      await join(sam.socket, ['m-chess']);
      const [forAva, forSam] = await Promise.all(matched);
      expect(forAva).toEqual({
        sessionId: forSam?.sessionId,
        partner: { alias: 'Stranger', sharedInterests: ['m-chess'] },
      });
      expect(forSam?.partner).toEqual({ alias: 'Stranger', sharedInterests: ['m-chess'] });

      // Only metadata reaches the database.
      const [row] = await h.db
        .select()
        .from(schema.randomSession)
        .where(eq(schema.randomSession.id, forAva?.sessionId ?? ''));
      expect(row).toMatchObject({ sharedInterestCount: 1, endedAt: null });
      expect([row?.participantA, row?.participantB].sort()).toEqual([ava.id, sam.id].sort());

      // The person who joined first has no shared interest and is still waiting ...
      const late = await person(h);
      const joinedAt = Date.now();
      await join(late.socket, ['m-gardening']);
      // ... until the newcomer has waited too; then they are paired with no shared interest.
      const forEarly = await earlyMatched;
      expect(forEarly.partner.sharedInterests).toEqual([]);
      expect(Date.now() - joinedAt).toBeGreaterThanOrEqual(250);
    });

    it('lets one account wait or chat in one tab only', async () => {
      const ava = await person(h);
      const otherTab = await h.connectAs(ava.id);
      await join(ava.socket, ['one-tab']);
      expect(await join(otherTab, ['one-tab'])).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT' },
      });
      const sam = await person(h);
      const matched = nextEvent<Matched>(ava.socket, 'random:matched');
      await join(sam.socket, ['one-tab']);
      const { sessionId } = await matched;
      expect(await join(otherTab)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      // The other tab cannot speak in the chat either.
      expect(await say(otherTab, sessionId, 'hello')).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    });
  });

  describe('the relay (RAND-01, RAND-07)', () => {
    it('delivers a message to both sides and stores it nowhere', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      const text = 'a very recognisable sentence about penguins';
      const forSam = nextEvent<Relayed>(sam.socket, 'random:message');
      const forAva = nextEvent<Relayed>(ava.socket, 'random:message');
      const clientId = uuidv4();
      expect(await say(ava.socket, sessionId, text, clientId)).toEqual({
        ok: true,
        data: { clientId },
      });
      expect(await forSam).toMatchObject({ sessionId, clientId, text, from: 'them' });
      expect(await forAva).toMatchObject({ sessionId, clientId, text, from: 'me' });

      // A re-send with the same client ID is acknowledged but not shown twice.
      const again = arrives(sam.socket, 'random:message');
      expect((await say(ava.socket, sessionId, text, clientId)).ok).toBe(true);
      expect(await again).toBe(false);

      expect(await databaseText(h.db)).not.toContain('penguins');
      expect(h.logs.join('\n')).not.toContain('penguins');
    });

    it('passes typing signals to the other person only', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      const seen = nextEvent<{ sessionId: string; typing: boolean }>(sam.socket, 'random:typing');
      ava.socket.emit('random:typing', { sessionId, typing: true });
      expect(await seen).toEqual({ sessionId, typing: true });
    });

    it.each([
      ['check out bit.ly/x', "Links aren't allowed in random chats."],
      ['example dot com', "Links aren't allowed in random chats."],
      ['call me on 07700 900123', 'Contact details'],
      ['add me on snap', 'Contact details'],
    ])('refuses %j and the chat goes on', async (text, reason) => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      const received = arrives(sam.socket, 'random:message');
      const refused = await say(ava.socket, sessionId, text);
      expect(refused).toMatchObject({ ok: false, error: { code: 'CONTENT_BLOCKED' } });
      if (!refused.ok) expect(refused.error.message).toContain(reason);
      expect(await received).toBe(false);
      expect((await say(ava.socket, sessionId, 'sorry, plain text then')).ok).toBe(true);
    });

    it('refuses messages for a chat the sender is not in', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const outsider = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      expect(await say(outsider.socket, sessionId, 'hello')).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    });
  });

  describe('the strict filter (RAND-06)', () => {
    it('masks low and medium severity for both people and flags medium without the text', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);

      const low = [sam, ava].map((p) => nextEvent<Relayed>(p.socket, 'random:message'));
      expect((await say(ava.socket, sessionId, 'what a shit day')).ok).toBe(true);
      for (const got of await Promise.all(low)) {
        expect(got.text).toBe(`what a ${MASK_CHAR.repeat(4)} day`);
      }

      const medium = nextEvent<Relayed>(sam.socket, 'random:message');
      expect((await say(ava.socket, sessionId, 'you slut')).ok).toBe(true);
      expect((await medium).text).toBe(`you ${MASK_CHAR.repeat(4)}`);
      await pause(100);
      const flags = await h.db
        .select()
        .from(schema.contentFlag)
        .where(eq(schema.contentFlag.userId, ava.id));
      expect(flags).toMatchObject([
        { severity: 'medium', excerpt: '', randomSessionId: sessionId, messageId: null },
      ]);
    });

    it('blocks high severity, ends the chat and pauses the sender for 1 hour', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      const received = arrives(sam.socket, 'random:message');
      const ended = [ava, sam].map((p) => nextEvent<Ended>(p.socket, 'random:ended'));
      const told = nextEvent<Notice>(ava.socket, 'moderation:notice');
      const leaked = arrives(sam.socket, 'moderation:notice');

      const refused = await say(ava.socket, sessionId, 'just kill yourself');
      expect(refused).toMatchObject({ ok: false, error: { code: 'CONTENT_BLOCKED' } });
      if (!refused.ok) expect(refused.error.message).not.toContain('kill');
      expect(await received).toBe(false);
      for (const end of await Promise.all(ended))
        expect(end).toEqual({ sessionId, reason: 'filter' });

      const notice = await told;
      expect(notice.kind).toBe('random_timeout');
      expect(notice.reason).toContain('1 hour');
      const left = Date.parse(notice.until ?? '') - Date.now();
      expect(left).toBeGreaterThan(3500_000);
      expect(left).toBeLessThanOrEqual(3600_000);
      expect(await leaked).toBe(false);

      // The pause is a sanction applied by the system, and joining is refused until it ends.
      const sanctions = await h.db
        .select()
        .from(schema.userSanction)
        .where(eq(schema.userSanction.userId, ava.id));
      expect(sanctions).toMatchObject([{ kind: 'random_timeout', scope: 'random' }]);
      const again = await join(ava.socket);
      expect(again).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      if (!again.ok) {
        expect(again.error.message).toContain('paused');
        expect(again.error.retryAfterMs).toBeGreaterThan(3500_000);
      }
      const [row] = await h.db
        .select()
        .from(schema.randomSession)
        .where(eq(schema.randomSession.id, sessionId));
      expect(row?.endReason).toBe('filter');

      // The moderators learn that it happened, not what was written (RAND-07).
      const flags = await h.db
        .select()
        .from(schema.contentFlag)
        .where(eq(schema.contentFlag.userId, ava.id));
      expect(flags).toMatchObject([{ severity: 'high', excerpt: '', randomSessionId: sessionId }]);
      expect(await databaseText(h.db)).not.toContain('kill yourself');
      expect(h.logs.join('\n')).not.toContain('kill yourself');
      // The other person can go on to a new chat.
      expect((await join(sam.socket, ['after-filter'])).ok).toBe(true);
      await request(sam.socket, 'random:leave', {});
    });
  });

  describe('skip, end and the way into the community (RAND-04, RAND-09)', () => {
    it('"Next" ends the chat for the other person and queues the skipper again', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId, tag } = await pairUp(h, ava, sam);
      const ended = nextEvent<Ended>(sam.socket, 'random:ended');
      const notForSkipper = arrives(ava.socket, 'random:ended');
      const waiting = nextEvent(ava.socket, 'random:waiting');
      expect(await request(ava.socket, 'random:next', { sessionId })).toEqual({
        ok: true,
        data: { queued: true },
      });
      expect(await ended).toEqual({ sessionId, reason: 'skip' });
      await waiting;
      expect(await notForSkipper).toBe(false);

      // The same two people are not paired again within 10 minutes, even after the fallback.
      const rematched = arrives(sam.socket, 'random:matched', 700);
      expect((await join(sam.socket, [tag])).ok).toBe(true);
      expect(await rematched).toBe(false);
      // Someone new is fine.
      const kim = await person(h);
      const matched = nextEvent<Matched>(kim.socket, 'random:matched');
      await join(kim.socket, [tag]);
      expect((await matched).partner.sharedInterests).toEqual([tag]);
      for (const p of [ava, sam, kim]) await request(p.socket, 'random:leave', {});
    });

    it('"End" ends it for both and suggests rooms about the shared interest', async () => {
      const owner = await createTestUser(h.db);
      const room = await createTestRoom(h.db, owner.id, [], { slug: 'end-gardening-club' });
      const ava = await person(h);
      const sam = await person(h);
      const matched = [ava, sam].map((p) => nextEvent<Matched>(p.socket, 'random:matched'));
      await join(ava.socket, ['end-gardening']);
      await join(sam.socket, ['end-gardening']);
      const [{ sessionId }] = (await Promise.all(matched)) as [Matched, Matched];

      const ended = [ava, sam].map((p) => nextEvent<Ended>(p.socket, 'random:ended'));
      const suggested = [ava, sam].map((p) =>
        nextEvent<{ rooms: { id: string; slug: string; name: string; memberCount: number }[] }>(
          p.socket,
          'random:suggestion',
        ),
      );
      expect(await request(ava.socket, 'random:end', { sessionId })).toEqual({
        ok: true,
        data: {},
      });
      for (const end of await Promise.all(ended)) expect(end).toEqual({ sessionId, reason: 'end' });
      for (const suggestion of await Promise.all(suggested)) {
        expect(suggestion.rooms[0]).toMatchObject({ id: room.id, slug: 'end-gardening-club' });
        expect(suggestion.rooms.length).toBeLessThanOrEqual(5);
      }
      // Ending twice is harmless; messages are no longer relayed.
      expect((await request(sam.socket, 'random:end', { sessionId })).ok).toBe(true);
      expect(await say(ava.socket, sessionId, 'still there?')).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    });

    it('pauses matching after three skips within seconds', async () => {
      const ava = await person(h);
      const tag = `skip${uuidv4().slice(0, 8)}`;
      let sessionId = '';
      for (let round = 0; round < 3; round++) {
        const partner = await person(h);
        const matched = nextEvent<Matched>(ava.socket, 'random:matched');
        if (round === 0) await join(ava.socket, [tag]);
        await join(partner.socket, [tag]);
        ({ sessionId } = await matched);
        if (round < 2) {
          expect((await request(ava.socket, 'random:next', { sessionId })).ok).toBe(true);
        }
      }
      const third = await request(ava.socket, 'random:next', { sessionId });
      expect(third).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
      if (!third.ok) {
        expect(third.error.retryAfterMs).toBeGreaterThan(100_000);
        expect(third.error.retryAfterMs).toBeLessThanOrEqual(120_000);
      }
      expect(await join(ava.socket)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    });
  });

  describe('reports (RAND-04, RAND-05, SAFE-01)', () => {
    it('ends the chat and stores the server-side record of it as evidence', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      await say(ava.socket, sessionId, 'hello from the reporter');
      await say(sam.socket, sessionId, 'an unkind thing about walruses');
      const ended = [ava, sam].map((p) => nextEvent<Ended>(p.socket, 'random:ended'));

      const ack = await request<{ reportId: string }>(ava.socket, 'random:report', {
        sessionId,
        reason: 'harassment',
        details: '  They were unkind.  ',
      });
      if (!ack.ok) throw new Error(ack.error.code);
      // The reporter sees why it ended; the reported person sees an ordinary ending.
      const [forAva, forSam] = await Promise.all(ended);
      expect(forAva).toEqual({ sessionId, reason: 'report' });
      expect(forSam).toEqual({ sessionId, reason: 'end' });

      const [row] = await h.db
        .select()
        .from(schema.report)
        .where(eq(schema.report.id, ack.data.reportId));
      expect(row).toMatchObject({
        reporterId: ava.id,
        targetType: 'random_session',
        targetUserId: sam.id,
        randomSessionId: sessionId,
        reason: 'harassment',
        details: 'They were unkind.',
      });
      expect(row?.evidence).toMatchObject({
        kind: 'random_session',
        session: { id: sessionId, endReason: 'report' },
        messages: [
          { from: 'reporter', text: 'hello from the reporter', delivered: true },
          { from: 'reported', text: 'an unkind thing about walruses', delivered: true },
        ],
      });

      // The database holds the chat's text in that report and nowhere else (J7).
      const { evidence: _evidence, ...rest } = row ?? { evidence: null };
      const everything = await databaseText(h.db);
      expect(everything.split('walruses')).toHaveLength(2);
      expect(JSON.stringify(rest)).not.toContain('walruses');
      expect(h.logs.join('\n')).not.toContain('walruses');

      // The other person may report the same chat afterwards; reporting twice changes nothing.
      const second = await request<{ reportId: string }>(sam.socket, 'random:report', {
        sessionId,
        reason: 'other',
      });
      expect(second.ok).toBe(true);
      const repeat = await request<{ reportId: string }>(ava.socket, 'random:report', {
        sessionId,
        reason: 'spam',
      });
      expect(repeat).toEqual({ ok: true, data: { reportId: ack.data.reportId } });
    });

    it('cannot report a chat one was not in', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const outsider = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      expect(
        await request(outsider.socket, 'random:report', { sessionId, reason: 'spam' }),
      ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(
        await h.db.select().from(schema.report).where(eq(schema.report.targetUserId, ava.id)),
      ).toEqual([]);
    });

    it('pauses someone for 24 hours when three different people report them', async () => {
      const target = await person(h);
      const told = nextEvent<Notice>(target.socket, 'moderation:notice', 15_000);
      for (let i = 0; i < 3; i++) {
        const reporter = await person(h);
        const { sessionId } = await pairUp(h, target, reporter);
        const done = nextEvent<Ended>(target.socket, 'random:ended');
        const ack = await request(reporter.socket, 'random:report', {
          sessionId,
          reason: 'harassment',
        });
        expect(ack.ok).toBe(true);
        await done;
        if (i < 2) {
          expect(
            await h.db
              .select()
              .from(schema.userSanction)
              .where(eq(schema.userSanction.userId, target.id)),
          ).toEqual([]);
        }
      }
      const notice = await told;
      expect(notice.kind).toBe('random_timeout');
      expect(notice.reason).toContain('24 hours');
      const left = Date.parse(notice.until ?? '') - Date.now();
      expect(left).toBeGreaterThan(23.9 * 3600_000);
      expect(left).toBeLessThanOrEqual(24 * 3600_000);
      const refused = await join(target.socket);
      expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      if (!refused.ok) expect(refused.error.retryAfterMs).toBeGreaterThan(23.9 * 3600_000);
    }, 20_000);
  });

  describe('sharing a profile and adding a contact (RAND-08)', () => {
    it('shares nothing until both people ask', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      const offered = nextEvent(sam.socket, 'random:offered');
      const early = [ava, sam].map((p) => arrives(p.socket, 'random:shared'));
      expect(
        await request(ava.socket, 'random:offer', { sessionId, offer: 'add_contact' }),
      ).toEqual({ ok: true, data: {} });
      expect(await offered).toEqual({ sessionId, offer: 'add_contact' });
      expect(await Promise.all(early)).toEqual([false, false]);
      expect(
        await h.db.select().from(schema.contact).where(eq(schema.contact.userId, ava.id)),
      ).toEqual([]);

      // Accepting something that was never offered does nothing.
      expect(
        await request(sam.socket, 'random:accept', { sessionId, offer: 'share_profile' }),
      ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

      const shared = [ava, sam].map((p) =>
        nextEvent<{ profile: { id: string; nickname: string } }>(p.socket, 'random:shared'),
      );
      const added = [ava, sam].map((p) => nextEvent(p.socket, 'random:contact-added'));
      const before = await getMetricTotal(h.db, 'random_mutual_contact_added');
      expect(
        (await request(sam.socket, 'random:accept', { sessionId, offer: 'add_contact' })).ok,
      ).toBe(true);
      const [forAva, forSam] = await Promise.all(shared);
      expect(forAva?.profile).toMatchObject({ id: sam.id, nickname: sam.nickname });
      expect(forSam?.profile).toMatchObject({ id: ava.id, nickname: ava.nickname });
      // Only the public profile travels: no real name, no email.
      expect(Object.keys(forAva?.profile ?? {}).sort()).toEqual(['avatar', 'id', 'nickname']);
      await Promise.all(added);

      for (const [me, other] of [
        [ava, sam],
        [sam, ava],
      ] as const) {
        expect(
          await h.db.select().from(schema.contact).where(eq(schema.contact.userId, me.id)),
        ).toMatchObject([{ contactId: other.id, source: 'random' }]);
      }
      expect(await getMetricTotal(h.db, 'random_mutual_contact_added')).toBe(before + 1);
    });

    it('treats "Share profile" pressed by both as agreement', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      const shared = [ava, sam].map((p) => nextEvent(p.socket, 'random:shared'));
      const contact = arrives(ava.socket, 'random:contact-added');
      await request(ava.socket, 'random:offer', { sessionId, offer: 'share_profile' });
      await request(sam.socket, 'random:offer', { sessionId, offer: 'share_profile' });
      await Promise.all(shared);
      expect(await contact).toBe(false);
      expect(
        await h.db.select().from(schema.contact).where(eq(schema.contact.userId, ava.id)),
      ).toEqual([]);
    });
  });

  describe('guests (RAND-10)', () => {
    it('chat like anyone else, at half the message rate, and cannot exchange contacts', async () => {
      const guest = await person(h, guestOptions);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, guest, sam);
      const got = nextEvent<Relayed>(sam.socket, 'random:message');
      expect((await say(guest.socket, sessionId, 'hello from a guest')).ok).toBe(true);
      expect((await got).text).toBe('hello from a guest');

      for (const who of [guest, sam]) {
        expect(
          await request(who.socket, 'random:offer', { sessionId, offer: 'add_contact' }),
        ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      }

      // Both may send 3 at once; after that the guest waits twice as long for the next one.
      await say(guest.socket, sessionId, 'two');
      await say(guest.socket, sessionId, 'three');
      const guestLimited = await say(guest.socket, sessionId, 'four');
      expect(guestLimited).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
      for (const text of ['one', 'two', 'three']) await say(sam.socket, sessionId, text);
      const userLimited = await say(sam.socket, sessionId, 'four');
      expect(userLimited).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
      if (!guestLimited.ok && !userLimited.ok) {
        expect(guestLimited.error.retryAfterMs).toBeGreaterThan(1000);
        expect(guestLimited.error.retryAfterMs).toBeLessThanOrEqual(2000);
        expect(userLimited.error.retryAfterMs).toBeLessThanOrEqual(1000);
      }
    });
  });

  describe('connections coming and going', () => {
    it('ends the chat when a person stays away longer than the grace period', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      const ended = nextEvent<Ended>(sam.socket, 'random:ended');
      const startedAt = Date.now();
      ava.socket.close();
      expect(await ended).toEqual({ sessionId, reason: 'disconnect' });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(350);
    });

    it('lets a tab that reconnects in time pick the chat up, with what it missed', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      await say(ava.socket, sessionId, 'before the drop');
      const ended = arrives(sam.socket, 'random:ended', 900);
      ava.socket.close();
      await pause(100);
      // Sent while Ava was away: nobody was there to receive it.
      await say(sam.socket, sessionId, 'are you still there?');

      const back = await h.connectAs(ava.id);
      const resumed = await request<{ sharedInterests: string[]; messages: Relayed[] }>(
        back,
        'random:resume',
        { sessionId },
      );
      if (!resumed.ok) throw new Error(resumed.error.code);
      expect(resumed.data.messages.map((m) => [m.from, m.text])).toEqual([
        ['me', 'before the drop'],
        ['them', 'are you still there?'],
      ]);
      const got = nextEvent<Relayed>(back, 'random:message');
      await say(sam.socket, sessionId, 'welcome back');
      expect((await got).text).toBe('welcome back');
      expect((await say(back, sessionId, 'thanks')).ok).toBe(true);
      expect(await ended).toBe(false);

      // Someone else cannot pick up the chat.
      const outsider = await person(h);
      expect(await request(outsider.socket, 'random:resume', { sessionId })).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    });

    it('takes a person who stops waiting out of the queue', async () => {
      const ava = await person(h);
      const tag = `gone${uuidv4().slice(0, 8)}`;
      await join(ava.socket, [tag]);
      ava.socket.close();
      await pause(100);
      const sam = await person(h);
      const matched = nextEvent<Matched>(sam.socket, 'random:matched', 700).catch(() => null);
      await join(sam.socket, [tag]);
      // Never with the person who left: only they shared this interest.
      expect((await matched)?.partner.sharedInterests ?? []).toEqual([]);
      await request(sam.socket, 'random:leave', {});
    });
  });

  describe('moderators and blocks reach random mode at once', () => {
    it('a random-mode timeout from a moderator ends the chat and takes the person out', async () => {
      const admin = await createTestUser(h.db, { role: 'admin' });
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      const ended = [ava, sam].map((p) => nextEvent<Ended>(p.socket, 'random:ended'));
      const result = await applySanction(h.db, {
        actor: { type: 'admin', id: admin.id },
        targetUserId: ava.id,
        kind: 'random_timeout',
        reason: 'Rude to strangers',
        durationSeconds: 3600,
      });
      if (!result.ok) throw new Error(result.reason);
      await h.postEvent({
        ...eventBase(),
        type: 'user.sanctioned',
        userId: ava.id,
        kind: 'random_timeout',
        reason: result.sanction.reason,
        until: result.sanction.expiresAt?.toISOString() ?? null,
      });
      for (const end of await Promise.all(ended)) expect(end).toEqual({ sessionId, reason: 'end' });
      const refused = await join(ava.socket);
      expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      if (!refused.ok) expect(refused.error.message).toContain('Rude to strangers');
    });

    it('a block made elsewhere in the app ends their chat', async () => {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      const ended = [ava, sam].map((p) => nextEvent<Ended>(p.socket, 'random:ended'));
      await h.postEvent({
        ...eventBase(),
        type: 'block.created',
        blockerId: sam.id,
        blockedId: ava.id,
      });
      for (const end of await Promise.all(ended)) expect(end).toEqual({ sessionId, reason: 'end' });
    });
  });

  it('counts random mode in the metrics, without content', async () => {
    const response = await fetch(`${h.url}/metrics`, {
      headers: { authorization: `Bearer ${h.env.METRICS_TOKEN}` },
    });
    const metrics = await response.text();
    expect(metrics).toContain('ss_random_queue_length');
    expect(metrics).toContain('ss_random_sessions_active');
    expect(metrics).toContain('ss_random_sessions_started_total');
    expect(metrics).toContain('ss_random_sessions_ended_total{reason="filter"}');
    expect(metrics).toContain('ss_random_refused_total{kind="link"}');
    expect(metrics).toContain('ss_random_wait_ms_total');
    expect(metrics).not.toContain('penguins');
    expect(await getMetricTotal(h.db, 'random_sessions_started')).toBeGreaterThan(5);
    expect(await getMetricTotal(h.db, 'random_reports')).toBeGreaterThan(3);
  });
});

describe('random mode (blocks, evidence lifetime)', () => {
  let h: Harness;

  beforeAll(async () => {
    // No rematch wait here, so that only a block can keep two people apart.
    h = await startHarness(MANY_CONNECTIONS, {
      randomTimings: {
        fallbackAfterMs: 200,
        matchIntervalMs: 50,
        rematchAfterMs: 0,
        evidenceKeepMs: 600,
      },
    });
  });

  afterAll(async () => {
    await h.close();
  });

  it('two people who chatted can meet again once the rematch wait is over', async () => {
    const ava = await person(h);
    const sam = await person(h);
    const { sessionId, tag } = await pairUp(h, ava, sam);
    await request(ava.socket, 'random:end', { sessionId });
    const matched = [ava, sam].map((p) => nextEvent<Matched>(p.socket, 'random:matched'));
    await join(ava.socket, [tag]);
    await join(sam.socket, [tag]);
    await Promise.all(matched);
  });

  it('a block ends the chat, is stored, and keeps the two apart for good (RAND-04)', async () => {
    const ava = await person(h);
    const sam = await person(h);
    const { sessionId, tag } = await pairUp(h, ava, sam);
    const ended = [ava, sam].map((p) => nextEvent<Ended>(p.socket, 'random:ended'));
    expect(await request(ava.socket, 'random:block', { sessionId })).toEqual({
      ok: true,
      data: {},
    });
    // Nobody is told "you were blocked".
    for (const end of await Promise.all(ended)) expect(end).toEqual({ sessionId, reason: 'end' });
    expect(
      await h.db.select().from(schema.block).where(eq(schema.block.blockerId, ava.id)),
    ).toMatchObject([{ blockedId: sam.id }]);

    const rematched = [ava, sam].map((p) => arrives(p.socket, 'random:matched', 600));
    await join(ava.socket, [tag]);
    await join(sam.socket, [tag]);
    expect(await Promise.all(rematched)).toEqual([false, false]);
    for (const p of [ava, sam]) await request(p.socket, 'random:leave', {});
  });

  it("a guest's block lives in memory and still keeps the two apart", async () => {
    const guest = await person(h, guestOptions);
    const sam = await person(h);
    const { sessionId, tag } = await pairUp(h, guest, sam);
    expect((await request(guest.socket, 'random:block', { sessionId })).ok).toBe(true);
    expect(
      await h.db.select().from(schema.block).where(eq(schema.block.blockerId, guest.id)),
    ).toEqual([]);
    const rematched = [guest, sam].map((p) => arrives(p.socket, 'random:matched', 600));
    await join(guest.socket, [tag]);
    await join(sam.socket, [tag]);
    expect(await Promise.all(rematched)).toEqual([false, false]);
    for (const p of [guest, sam]) await request(p.socket, 'random:leave', {});
  });

  it('a chat can be reported after it ended, until its record is dropped', async () => {
    const ava = await person(h);
    const sam = await person(h);
    const { sessionId } = await pairUp(h, ava, sam);
    await say(sam.socket, sessionId, 'something about otters');
    await request(sam.socket, 'random:end', { sessionId });

    const ack = await request<{ reportId: string }>(ava.socket, 'random:report', {
      sessionId,
      reason: 'spam',
    });
    if (!ack.ok) throw new Error(ack.error.code);
    const [row] = await h.db
      .select()
      .from(schema.report)
      .where(eq(schema.report.id, ack.data.reportId));
    expect(row?.evidence).toMatchObject({
      session: { endReason: 'end' },
      messages: [{ from: 'reported', text: 'something about otters' }],
    });

    // After the keeping time (5 minutes in production) the record is gone and so is the option.
    const kim = await person(h);
    const late = await pairUp(h, ava, kim);
    await request(kim.socket, 'random:end', { sessionId: late.sessionId });
    await pause(750);
    const tooLate = await request(ava.socket, 'random:report', {
      sessionId: late.sessionId,
      reason: 'spam',
    });
    expect(tooLate).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    if (!tooLate.ok) expect(tooLate.error.message).toContain('5 minutes');
  });

  // Last in this file's harness: every test connection has the same network address.
  it('a paused guest cannot come back as a new guest from the same network (RAND-10)', async () => {
    const guest = await person(h, guestOptions);
    const sam = await person(h);
    const { sessionId } = await pairUp(h, guest, sam);
    const told = nextEvent<Notice>(guest.socket, 'moderation:notice');
    await say(guest.socket, sessionId, 'just kill yourself');
    expect((await told).kind).toBe('random_timeout');
    const bans = await h.db.select().from(schema.networkBan);
    expect(bans).toHaveLength(1);
    // A keyed hash, never the address itself.
    expect(bans[0]?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(bans)).not.toContain('127.0.0.1');

    const fresh = await person(h, guestOptions);
    const refused = await join(fresh.socket);
    expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    if (!refused.ok) {
      expect(refused.error.message).toContain('network');
      expect(refused.error.retryAfterMs).toBeGreaterThan(3500_000);
    }
    // People with an account on the same network are not affected.
    const member = await person(h);
    expect((await join(member.socket, ['same-network'])).ok).toBe(true);
  });
});

describe('random mode (silence)', () => {
  it('ends a chat in which nobody writes for the silence time', async () => {
    const h = await startHarness({}, { randomTimings: { silenceMs: 500, matchIntervalMs: 50 } });
    try {
      const ava = await person(h);
      const sam = await person(h);
      const { sessionId } = await pairUp(h, ava, sam);
      await pause(300);
      // A message starts the wait again.
      await say(ava.socket, sessionId, 'anyone there?');
      const ended = [ava, sam].map((p) => nextEvent<Ended>(p.socket, 'random:ended'));
      const sentAt = Date.now();
      for (const end of await Promise.all(ended)) {
        expect(end).toEqual({ sessionId, reason: 'timeout' });
      }
      expect(Date.now() - sentAt).toBeGreaterThanOrEqual(450);
    } finally {
      await h.close();
    }
  });

  it('records chats as ended when the server shuts down', async () => {
    const h = await startHarness({}, { randomTimings: { matchIntervalMs: 50 } });
    const ava = await person(h);
    const sam = await person(h);
    const { sessionId } = await pairUp(h, ava, sam);
    await h.server.stop();
    const [row] = await h.db
      .select()
      .from(schema.randomSession)
      .where(eq(schema.randomSession.id, sessionId));
    expect(row?.endReason).toBe('disconnect');
    expect(row?.endedAt).toBeInstanceOf(Date);
    await h.close();
  });
});

describe('the kill switch (RAND-11)', () => {
  it('refuses every random event when RANDOM_MODE_ENABLED=false', async () => {
    const h = await startHarness({ RANDOM_MODE_ENABLED: 'false' });
    try {
      const ava = await person(h);
      const sessionId = uuidv4();
      const attempts: [string, unknown][] = [
        ['random:join', { interests: [] }],
        ['random:leave', {}],
        ['random:message', { sessionId, clientId: uuidv4(), text: 'hello' }],
        ['random:next', { sessionId }],
        ['random:end', { sessionId }],
        ['random:report', { sessionId, reason: 'spam' }],
        ['random:block', { sessionId }],
        ['random:offer', { sessionId, offer: 'add_contact' }],
        ['random:accept', { sessionId, offer: 'add_contact' }],
        ['random:resume', { sessionId }],
      ];
      for (const [event, payload] of attempts) {
        expect(await request(ava.socket, event, payload), event).toEqual({
          ok: false,
          error: { code: 'FORBIDDEN', message: 'Random chat is switched off.' },
        });
      }
      // Community chat is untouched.
      const room = await createTestRoom(h.db, ava.id);
      expect(
        (
          await request(ava.socket, 'message:send', {
            conversationId: room.id,
            clientId: uuidv4(),
            body: 'still works',
          })
        ).ok,
      ).toBe(true);
      const metrics = await fetch(`${h.url}/metrics`, {
        headers: { authorization: `Bearer ${h.env.METRICS_TOKEN}` },
      });
      expect(await metrics.text()).not.toContain('ss_random_queue_length');
    } finally {
      await h.close();
    }
  });
});
