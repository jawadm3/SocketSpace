/**
 * Sanctions (ADMIN-03, RAND-05): who may apply and lift them, what each one stops, what is written
 * to the audit log, and how a suspension ends.
 */
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { session, user } from '../schema/auth';
import { moderationAction, userSanction } from '../schema/safety';
import { notification } from '../schema/social';
import { createTestDatabase, createTestRoom, createTestUser, type TestDatabase } from '../testing';
import { toggleReaction } from './message-actions';
import { sendMessage } from './messages';
import {
  applySanction,
  liftSanction,
  resolveSignInStanding,
  SYSTEM_ACTOR_ID,
  WARNING_SHOWN_SECONDS,
} from './sanctions';
import { getActiveSanctions } from './users';

let t: TestDatabase;
let admin: { id: string };

beforeAll(async () => {
  t = await createTestDatabase();
  admin = await createTestUser(t.db, { role: 'admin' });
});

afterAll(async () => {
  await t.close();
});

const HOUR = 3600;
const by = () => ({ type: 'admin', id: admin.id }) as const;

async function addSession(userId: string): Promise<string> {
  const id = uuidv4();
  await t.db.insert(session).values({
    id,
    userId,
    token: uuidv4(),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return id;
}

const statusOf = async (userId: string) =>
  (await t.db.select({ status: user.status }).from(user).where(eq(user.id, userId)))[0]?.status;
const sessionsOf = async (userId: string) =>
  (await t.db.select({ id: session.id }).from(session).where(eq(session.userId, userId))).length;
const auditOf = (userId: string) =>
  t.db.select().from(moderationAction).where(eq(moderationAction.targetUserId, userId));

function send(authorId: string, conversationId: string) {
  return sendMessage(t.db, { conversationId, authorId, clientId: uuidv4(), body: 'hello' });
}

describe('who may sanction', () => {
  it('only site administrators', async () => {
    const mod = await createTestUser(t.db);
    const target = await createTestUser(t.db);
    const result = await applySanction(t.db, {
      actor: { type: 'admin', id: mod.id },
      targetUserId: target.id,
      kind: 'warn',
      reason: 'Be kind',
    });
    expect(result).toEqual({ ok: false, reason: 'not_admin' });
    expect(await auditOf(target.id)).toHaveLength(0);
  });

  it('not a suspended administrator', async () => {
    const former = await createTestUser(t.db, { role: 'admin', status: 'suspended' });
    const target = await createTestUser(t.db);
    expect(
      await applySanction(t.db, {
        actor: { type: 'admin', id: former.id },
        targetUserId: target.id,
        kind: 'warn',
        reason: 'x',
      }),
    ).toEqual({ ok: false, reason: 'not_admin' });
  });

  it('never themselves, another administrator, or an account that is gone', async () => {
    const other = await createTestUser(t.db, { role: 'admin' });
    const deleted = await createTestUser(t.db, { status: 'deleted' });
    const attempt = (targetUserId: string) =>
      applySanction(t.db, { actor: by(), targetUserId, kind: 'ban', reason: 'x' });
    expect(await attempt(admin.id)).toEqual({ ok: false, reason: 'self' });
    expect(await attempt(other.id)).toEqual({ ok: false, reason: 'target_is_admin' });
    expect(await attempt(deleted.id)).toEqual({ ok: false, reason: 'target_not_found' });
    expect(await attempt(uuidv4())).toEqual({ ok: false, reason: 'target_not_found' });
    expect(await statusOf(other.id)).toBe('active');
  });

  it('the system may only set random-mode timeouts', async () => {
    const target = await createTestUser(t.db);
    expect(
      await applySanction(t.db, {
        actor: { type: 'system' },
        targetUserId: target.id,
        kind: 'ban',
        reason: 'x',
      }),
    ).toEqual({ ok: false, reason: 'system_not_allowed' });
    const timeout = await applySanction(t.db, {
      actor: { type: 'system' },
      targetUserId: target.id,
      kind: 'random_timeout',
      reason: 'Blocked content in a random chat',
      durationSeconds: HOUR,
    });
    expect(timeout.ok).toBe(true);
    const [entry] = await auditOf(target.id);
    expect(entry).toMatchObject({
      actorId: SYSTEM_ACTOR_ID,
      action: 'random_timeout',
      metadata: { scope: 'random', automatic: true },
    });
  });
});

describe('what a sanction needs', () => {
  it('a reason, always', async () => {
    const target = await createTestUser(t.db);
    const attempt = (reason: string) =>
      applySanction(t.db, { actor: by(), targetUserId: target.id, kind: 'warn', reason });
    expect(await attempt('   ')).toEqual({ ok: false, reason: 'reason_required' });
    expect(await attempt('x'.repeat(501))).toEqual({ ok: false, reason: 'reason_too_long' });
    expect(await auditOf(target.id)).toHaveLength(0);
  });

  it('a sensible duration where one applies', async () => {
    const target = await createTestUser(t.db);
    const attempt = (kind: 'warn' | 'mute' | 'suspend' | 'ban', durationSeconds?: number) =>
      applySanction(t.db, {
        actor: by(),
        targetUserId: target.id,
        kind,
        reason: 'x',
        ...(durationSeconds === undefined ? {} : { durationSeconds }),
      });
    expect(await attempt('mute')).toEqual({ ok: false, reason: 'duration_required' });
    expect(await attempt('suspend')).toEqual({ ok: false, reason: 'duration_required' });
    expect(await attempt('warn', HOUR)).toEqual({ ok: false, reason: 'duration_not_allowed' });
    expect(await attempt('mute', 59)).toEqual({ ok: false, reason: 'duration_invalid' });
    expect(await attempt('mute', 1.5 * HOUR + 0.5)).toEqual({
      ok: false,
      reason: 'duration_invalid',
    });
    expect(await attempt('ban', 366 * 24 * HOUR)).toEqual({
      ok: false,
      reason: 'duration_invalid',
    });
    expect(await auditOf(target.id)).toHaveLength(0);
  });
});

describe('a warning', () => {
  it('restricts nothing, is logged, and is shown to the person for 30 days', async () => {
    const target = await createTestUser(t.db);
    const room = await createTestRoom(t.db, admin.id, [target.id]);
    const now = new Date('2026-10-03T12:00:00Z');
    const result = await applySanction(t.db, {
      actor: by(),
      targetUserId: target.id,
      kind: 'warn',
      reason: '  Please stop posting adverts.  ',
      now,
    });
    expect(result).toMatchObject({
      ok: true,
      sessionsRevoked: false,
      sanction: {
        kind: 'warn',
        scope: 'global',
        reason: 'Please stop posting adverts.',
        expiresAt: null,
      },
    });
    expect((await send(target.id, room.id)).ok).toBe(true);
    expect(await statusOf(target.id)).toBe('active');
    expect(await auditOf(target.id)).toMatchObject([
      { actorId: admin.id, action: 'warn', reason: 'Please stop posting adverts.' },
    ]);

    const shown = (at: Date) => getActiveSanctions(t.db, target.id, at);
    expect(await shown(new Date(now.getTime() + 1000))).toMatchObject([{ kind: 'warn' }]);
    expect(await shown(new Date(now.getTime() + (WARNING_SHOWN_SECONDS + 1) * 1000))).toEqual([]);
    // The person is told, also if they were offline.
    const notes = await t.db
      .select()
      .from(notification)
      .where(and(eq(notification.userId, target.id), eq(notification.type, 'moderation')));
    expect(notes).toHaveLength(1);
  });
});

describe('a mute', () => {
  it('stops posting and reacting everywhere until it ends, and is logged with its end', async () => {
    const target = await createTestUser(t.db);
    const room = await createTestRoom(t.db, admin.id, [target.id]);
    const first = await send(admin.id, room.id);
    if (!first.ok) throw new Error('setup');
    const sid = await addSession(target.id);

    const muted = await applySanction(t.db, {
      actor: by(),
      targetUserId: target.id,
      kind: 'mute',
      reason: 'Flooding the room',
      durationSeconds: 2 * HOUR,
    });
    if (!muted.ok) throw new Error(muted.reason);
    expect(muted.sessionsRevoked).toBe(false);
    const until = muted.sanction.expiresAt;
    expect(until).toBeInstanceOf(Date);
    expect(Math.abs((until?.getTime() ?? 0) - Date.now() - 2 * HOUR * 1000)).toBeLessThan(60_000);

    expect(await send(target.id, room.id)).toMatchObject({ ok: false, reason: 'sanctioned' });
    expect(
      await toggleReaction(t.db, { messageId: first.message.id, userId: target.id, emoji: '👍' }),
    ).toMatchObject({ ok: false, reason: 'sanctioned' });
    // A mute does not sign the person out or change the account's status.
    expect(await statusOf(target.id)).toBe('active');
    expect(await sessionsOf(target.id)).toBe(1);
    expect(sid).toBeTruthy();
    const [entry] = await auditOf(target.id);
    expect(entry).toMatchObject({ action: 'mute', reason: 'Flooding the room' });
    expect(entry?.expiresAt?.getTime()).toBe(until?.getTime());
  });

  it('ends by itself, by the database clock', async () => {
    const target = await createTestUser(t.db);
    const room = await createTestRoom(t.db, admin.id, [target.id]);
    const now = new Date('2026-10-03T12:00:00Z');
    await applySanction(t.db, {
      actor: by(),
      targetUserId: target.id,
      kind: 'mute',
      reason: 'x',
      durationSeconds: HOUR,
      now,
    });
    const at = (ms: number) =>
      sendMessage(t.db, {
        conversationId: room.id,
        authorId: target.id,
        clientId: uuidv4(),
        body: 'hello',
        now: new Date(now.getTime() + ms),
      });
    expect(await at(HOUR * 1000 - 1000)).toMatchObject({ ok: false, reason: 'sanctioned' });
    expect((await at(HOUR * 1000 + 1000)).ok).toBe(true);
  });

  it('can be lifted early, with a reason, and that is logged', async () => {
    const target = await createTestUser(t.db);
    const room = await createTestRoom(t.db, admin.id, [target.id]);
    await applySanction(t.db, {
      actor: by(),
      targetUserId: target.id,
      kind: 'mute',
      reason: 'x',
      durationSeconds: HOUR,
    });
    const lift = (reason: string, actorId = admin.id) =>
      liftSanction(t.db, { actorId, targetUserId: target.id, kind: 'mute', reason });
    expect(await lift('')).toEqual({ ok: false, reason: 'reason_required' });
    expect(await lift('Appeal accepted', target.id)).toEqual({ ok: false, reason: 'not_admin' });
    expect(await send(target.id, room.id)).toMatchObject({ ok: false });

    expect(await lift('Appeal accepted')).toEqual({ ok: true, lifted: 1, status: 'active' });
    expect((await send(target.id, room.id)).ok).toBe(true);
    expect((await auditOf(target.id)).map((a) => a.action).sort()).toEqual(['mute', 'unmute']);
    expect(await lift('Again')).toEqual({ ok: false, reason: 'nothing_to_lift' });
  });
});

describe('a suspension', () => {
  it('signs the person out everywhere and refuses new sessions until it ends', async () => {
    const target = await createTestUser(t.db);
    const room = await createTestRoom(t.db, admin.id, [target.id]);
    await addSession(target.id);
    await addSession(target.id);
    const now = new Date('2026-10-03T12:00:00Z');

    const result = await applySanction(t.db, {
      actor: by(),
      targetUserId: target.id,
      kind: 'suspend',
      reason: 'Harassing another member',
      durationSeconds: 24 * HOUR,
      now,
    });
    expect(result).toMatchObject({ ok: true, sessionsRevoked: true });
    expect(await statusOf(target.id)).toBe('suspended');
    expect(await sessionsOf(target.id)).toBe(0);
    expect(await send(target.id, room.id)).toMatchObject({ ok: false, reason: 'account_inactive' });

    const during = await resolveSignInStanding(t.db, target.id, new Date(now.getTime() + 1000));
    expect(during).toEqual({
      allowed: false,
      status: 'suspended',
      until: new Date(now.getTime() + 24 * HOUR * 1000),
      reason: 'Harassing another member',
    });
    expect(await statusOf(target.id)).toBe('suspended');

    // After it has run out, signing in works again and puts the account back to normal.
    const after = new Date(now.getTime() + 24 * HOUR * 1000 + 1000);
    expect(await resolveSignInStanding(t.db, target.id, after)).toEqual({ allowed: true });
    expect(await statusOf(target.id)).toBe('active');
  });

  it('lifting it makes the account usable at once', async () => {
    const target = await createTestUser(t.db);
    await applySanction(t.db, {
      actor: by(),
      targetUserId: target.id,
      kind: 'suspend',
      reason: 'x',
      durationSeconds: 24 * HOUR,
    });
    expect((await resolveSignInStanding(t.db, target.id)).allowed).toBe(false);
    expect(
      await liftSanction(t.db, {
        actorId: admin.id,
        targetUserId: target.id,
        kind: 'suspend',
        reason: 'Mistaken identity',
      }),
    ).toEqual({ ok: true, lifted: 1, status: 'active' });
    expect(await statusOf(target.id)).toBe('active');
    expect(await resolveSignInStanding(t.db, target.id)).toEqual({ allowed: true });
    expect((await auditOf(target.id)).map((a) => a.action).sort()).toEqual([
      'suspend',
      'unsuspend',
    ]);
  });
});

describe('a ban', () => {
  it('lasts until a moderator lifts it', async () => {
    const target = await createTestUser(t.db);
    await addSession(target.id);
    const result = await applySanction(t.db, {
      actor: by(),
      targetUserId: target.id,
      kind: 'ban',
      reason: 'Threats',
    });
    expect(result).toMatchObject({
      ok: true,
      sessionsRevoked: true,
      sanction: { expiresAt: null },
    });
    expect(await statusOf(target.id)).toBe('banned');
    expect(await sessionsOf(target.id)).toBe(0);
    const far = new Date(Date.now() + 10 * 365 * 24 * HOUR * 1000);
    expect(await resolveSignInStanding(t.db, target.id, far)).toEqual({
      allowed: false,
      status: 'banned',
      until: null,
      reason: 'Threats',
    });
  });

  it('outranks a suspension: lifting the suspension leaves the ban in force', async () => {
    const target = await createTestUser(t.db);
    const sanction = (kind: 'suspend' | 'ban') =>
      applySanction(t.db, {
        actor: by(),
        targetUserId: target.id,
        kind,
        reason: kind,
        ...(kind === 'suspend' ? { durationSeconds: HOUR } : {}),
      });
    await sanction('ban');
    await sanction('suspend');
    expect(await statusOf(target.id)).toBe('banned');
    const lift = (kind: 'suspend' | 'ban') =>
      liftSanction(t.db, { actorId: admin.id, targetUserId: target.id, kind, reason: 'x' });
    expect(await lift('suspend')).toEqual({ ok: true, lifted: 1, status: 'banned' });
    expect(await statusOf(target.id)).toBe('banned');
    expect(await lift('ban')).toEqual({ ok: true, lifted: 1, status: 'active' });
    expect(await statusOf(target.id)).toBe('active');
  });
});

describe('a random-mode timeout', () => {
  it('has the random scope and leaves community posting alone', async () => {
    const target = await createTestUser(t.db);
    const room = await createTestRoom(t.db, admin.id, [target.id]);
    const result = await applySanction(t.db, {
      actor: by(),
      targetUserId: target.id,
      kind: 'random_timeout',
      reason: 'Reported by three people',
      durationSeconds: 24 * HOUR,
    });
    expect(result).toMatchObject({
      ok: true,
      sanction: { scope: 'random' },
      sessionsRevoked: false,
    });
    expect((await send(target.id, room.id)).ok).toBe(true);
    expect(await getActiveSanctions(t.db, target.id)).toMatchObject([
      { kind: 'random_timeout', scope: 'random' },
    ]);
    expect(
      await liftSanction(t.db, {
        actorId: admin.id,
        targetUserId: target.id,
        kind: 'random_timeout',
        reason: 'x',
      }),
    ).toMatchObject({ ok: true, lifted: 1 });
    expect(await getActiveSanctions(t.db, target.id)).toEqual([]);
    expect((await auditOf(target.id)).map((a) => a.action).sort()).toEqual([
      'random_timeout',
      'random_timeout_lifted',
    ]);
  });
});

describe('signing in (resolveSignInStanding)', () => {
  it('allows an ordinary account and an account that does not exist yet', async () => {
    const person = await createTestUser(t.db);
    expect(await resolveSignInStanding(t.db, person.id)).toEqual({ allowed: true });
    expect(await resolveSignInStanding(t.db, uuidv4())).toEqual({ allowed: true });
  });

  it('refuses a deleted account, and a status that was set without a sanction', async () => {
    const deleted = await createTestUser(t.db, { status: 'deleted' });
    const byHand = await createTestUser(t.db, { status: 'suspended' });
    expect(await resolveSignInStanding(t.db, deleted.id)).toMatchObject({
      allowed: false,
      status: 'deleted',
    });
    expect(await resolveSignInStanding(t.db, byHand.id)).toEqual({
      allowed: false,
      status: 'suspended',
      until: null,
      reason: null,
    });
    expect(await statusOf(byHand.id)).toBe('suspended');
  });

  it('refuses while a sanction is in force even if the status says active', async () => {
    const target = await createTestUser(t.db);
    await applySanction(t.db, {
      actor: by(),
      targetUserId: target.id,
      kind: 'suspend',
      reason: 'x',
      durationSeconds: HOUR,
    });
    await t.db.update(user).set({ status: 'active' }).where(eq(user.id, target.id));
    expect(await resolveSignInStanding(t.db, target.id)).toMatchObject({
      allowed: false,
      status: 'suspended',
    });
  });

  it('the sanction rows of one person never affect another', async () => {
    const target = await createTestUser(t.db);
    const bystander = await createTestUser(t.db);
    await applySanction(t.db, { actor: by(), targetUserId: target.id, kind: 'ban', reason: 'x' });
    expect(await resolveSignInStanding(t.db, bystander.id)).toEqual({ allowed: true });
    const rows = await t.db
      .select()
      .from(userSanction)
      .where(eq(userSanction.userId, bystander.id));
    expect(rows).toEqual([]);
  });
});
