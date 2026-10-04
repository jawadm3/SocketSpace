/**
 * Sanctions from the web app (ADMIN-03): the database is changed first, then the realtime server
 * is told exactly what the person must hear; a refused action tells nobody anything. Also what a
 * person reads when a moderator acts, and when they may not sign in.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, createTestUser, type TestDatabase } from '@socketspace/db/testing';

import { describeModerationNotice } from '../lib/chat/notifications';
import { inactiveAccountMessage } from './auth';
import { getAccountMute, liftUserSanction, sanctionUser } from './moderation';
import { RecordingNotifier } from './realtime-events';

let t: TestDatabase;
let admin: { id: string };

beforeAll(async () => {
  t = await createTestDatabase();
  admin = await createTestUser(t.db, { role: 'admin' });
});

afterAll(async () => {
  await t.close();
});

const deps = () => ({ db: t.db, notifier: new RecordingNotifier() });

describe('sanctionUser', () => {
  it('tells the realtime server the kind, the reason and the end', async () => {
    const target = await createTestUser(t.db);
    const d = deps();
    const result = await sanctionUser(d, {
      actor: { type: 'admin', id: admin.id },
      targetUserId: target.id,
      kind: 'mute',
      reason: 'Flooding',
      durationSeconds: 3600,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(d.notifier.events).toEqual([
      {
        type: 'user.sanctioned',
        userId: target.id,
        kind: 'mute',
        reason: 'Flooding',
        until: result.sanction.expiresAt?.toISOString(),
      },
    ]);
    expect(await getAccountMute(t.db, target.id)).toEqual({
      until: result.sanction.expiresAt?.toISOString(),
      reason: 'Flooding',
    });
  });

  it('sends a permanent ban with no end', async () => {
    const target = await createTestUser(t.db);
    const d = deps();
    await sanctionUser(d, {
      actor: { type: 'admin', id: admin.id },
      targetUserId: target.id,
      kind: 'ban',
      reason: 'Threats',
    });
    expect(d.notifier.events).toMatchObject([
      { type: 'user.sanctioned', kind: 'ban', until: null },
    ]);
  });

  it('tells nobody when the action is refused', async () => {
    const target = await createTestUser(t.db);
    const notAdmin = await createTestUser(t.db);
    const d = deps();
    const result = await sanctionUser(d, {
      actor: { type: 'admin', id: notAdmin.id },
      targetUserId: target.id,
      kind: 'ban',
      reason: 'x',
    });
    expect(result).toEqual({ ok: false, reason: 'not_admin' });
    expect(d.notifier.events).toEqual([]);
  });
});

describe('liftUserSanction', () => {
  it('tells the realtime server which kind was lifted, and only when something was', async () => {
    const target = await createTestUser(t.db);
    const d = deps();
    const lift = () =>
      liftUserSanction(d, {
        actorId: admin.id,
        targetUserId: target.id,
        kind: 'mute',
        reason: 'Appeal accepted',
      });
    expect(await lift()).toEqual({ ok: false, reason: 'nothing_to_lift' });
    expect(d.notifier.events).toEqual([]);

    await sanctionUser(deps(), {
      actor: { type: 'admin', id: admin.id },
      targetUserId: target.id,
      kind: 'mute',
      reason: 'x',
      durationSeconds: 3600,
    });
    expect(await lift()).toMatchObject({ ok: true, lifted: 1 });
    expect(d.notifier.events).toEqual([
      { type: 'user.unsanctioned', userId: target.id, kind: 'mute' },
    ]);
    expect(await getAccountMute(t.db, target.id)).toBeNull();
  });
});

describe('what the person reads', () => {
  it('a live notice says what happened, until when and why', () => {
    expect(describeModerationNotice('warned', 'Be kind.', null)).toBe(
      'A moderator sent you a warning. Reason: Be kind.',
    );
    expect(describeModerationNotice('muted', 'Flooding', 'tomorrow 10:00')).toBe(
      'A moderator muted your account until tomorrow 10:00. You can still read. Reason: Flooding',
    );
    expect(describeModerationNotice('banned', 'Threats', null)).toBe(
      'Your account was banned. Reason: Threats',
    );
    expect(describeModerationNotice('random_timeout', 'Reports', 'tomorrow 10:00')).toBe(
      'You cannot use random chat until tomorrow 10:00. Reason: Reports',
    );
    expect(describeModerationNotice('unmuted', '', null)).toBe('You can post again.');
  });

  it('a refused sign-in names the reason and the end, in UTC', () => {
    expect(
      inactiveAccountMessage({
        status: 'suspended',
        until: new Date('2026-10-04T14:30:00Z'),
        reason: 'Harassment',
      }),
    ).toBe('This account is suspended until 2026-10-04 14:30 UTC. Reason: Harassment');
    expect(inactiveAccountMessage({ status: 'banned', until: null, reason: 'Threats' })).toBe(
      'This account is banned. Reason: Threats',
    );
    // A closed account, or a status without a recorded reason, gets the general sentence.
    for (const status of ['deleted', 'suspended'] as const) {
      expect(inactiveAccountMessage({ status, until: null, reason: null })).toBe(
        'This account is suspended or closed.',
      );
    }
  });
});
