import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from './schema/_common';
import { user } from './schema/auth';
import { conversation } from './schema/conversations';
import { moderationAction } from './schema/safety';
import { createTestDatabase, createTestUser, rowsOf, type TestDatabase } from './testing';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

/** Runs `fn` and returns the database error message it threw (fails the test if it did not). */
async function dbError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    const messages: string[] = [];
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
      messages.push(String((e as { message?: unknown }).message));
    }
    return messages.join(' | ');
  }
  throw new Error('expected a database error, but the statement succeeded');
}

describe('migrations', () => {
  it('create every table in the data model', async () => {
    const result = await t.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const names = rowsOf<{ table_name: string }>(result).map((r) => r.table_name);
    expect(names).toEqual([
      'account',
      'attachment',
      'auth_lockout',
      'block',
      'contact',
      'contact_request',
      'content_flag',
      'conversation',
      'conversation_member',
      'http_rate_limit',
      'invite',
      'jwks',
      'link_preview',
      'mention',
      'message',
      'message_link',
      'message_revision',
      'metric_daily',
      'moderation_action',
      'network_ban',
      'notification',
      'passkey',
      'random_session',
      'rate_limit',
      'reaction',
      'realtime_outbox',
      'report',
      'room_ban',
      'session',
      'user',
      'user_sanction',
      'verification',
    ]);
  });
});

describe('user constraints', () => {
  it('treats nicknames as unique regardless of letter case', async () => {
    await createTestUser(t.db, { nickname: 'Ava' });
    const message = await dbError(() => createTestUser(t.db, { nickname: 'ava' }));
    expect(message).toContain('user_nickname_lower_uq');
  });

  it.each(['ab', 'a'.repeat(25), '_ava', 'ava.', 'a b', 'ava!', 'аva' /* Cyrillic а */])(
    'rejects the malformed nickname %j',
    async (nickname) => {
      const message = await dbError(() => createTestUser(t.db, { nickname }));
      expect(message).toContain('user_nickname_format');
    },
  );

  it('accepts nicknames with dots, dashes and underscores inside', async () => {
    await expect(createTestUser(t.db, { nickname: 'sam_o.k-1' })).resolves.toBeDefined();
  });

  it('refuses to mark onboarding complete without a nickname and avatar', async () => {
    const u = await createTestUser(t.db, { onboarded: false });
    const message = await dbError(() =>
      t.db.update(user).set({ onboardedAt: new Date() }).where(eq(user.id, u.id)),
    );
    expect(message).toContain('user_onboarded_complete');
  });
});

describe('conversation constraints', () => {
  it('requires rooms to have a slug and name, and DMs to be private with a dm_key', async () => {
    const owner = await createTestUser(t.db);
    expect(
      await dbError(() =>
        t.db
          .insert(conversation)
          .values({ kind: 'room', visibility: 'public', createdBy: owner.id }),
      ),
    ).toContain('conversation_room_fields');
    expect(
      await dbError(() =>
        t.db.insert(conversation).values({ kind: 'dm', visibility: 'public', dmKey: 'a:b' }),
      ),
    ).toContain('conversation_room_fields');
  });

  it('treats room slugs as unique regardless of letter case', async () => {
    const base = { kind: 'room' as const, visibility: 'public' as const, name: 'Design' };
    await t.db.insert(conversation).values({ ...base, slug: 'design-talk' });
    // Upper case fails the format check before it can collide, which is also fine:
    expect(
      await dbError(() => t.db.insert(conversation).values({ ...base, slug: 'Design-Talk' })),
    ).toMatch(/conversation_slug_format|conversation_slug_lower_uq/);
  });
});

describe('moderation_action (append-only audit log)', () => {
  async function insertAction(createdAt?: Date): Promise<string> {
    const id = newId();
    await t.db.insert(moderationAction).values({
      id,
      actorId: newId(),
      action: 'warn',
      reason: 'Spam in #general',
      ...(createdAt ? { createdAt } : {}),
    });
    return id;
  }

  it('accepts new rows', async () => {
    const id = await insertAction();
    const rows = await t.db.select().from(moderationAction).where(eq(moderationAction.id, id));
    expect(rows).toHaveLength(1);
  });

  it('refuses every UPDATE', async () => {
    const id = await insertAction();
    const message = await dbError(() =>
      t.db.update(moderationAction).set({ reason: 'edited' }).where(eq(moderationAction.id, id)),
    );
    expect(message).toContain('append-only');
  });

  it('refuses DELETE of rows younger than one year', async () => {
    const id = await insertAction();
    const message = await dbError(() =>
      t.db.delete(moderationAction).where(eq(moderationAction.id, id)),
    );
    expect(message).toContain('append-only');
  });

  it('allows the retention job to DELETE rows older than one year', async () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const id = await insertAction(old);
    await t.db.delete(moderationAction).where(eq(moderationAction.id, id));
    const rows = await t.db.select().from(moderationAction).where(eq(moderationAction.id, id));
    expect(rows).toHaveLength(0);
  });

  it('refuses TRUNCATE, even with CASCADE', async () => {
    // Plain TRUNCATE is already stopped by the foreign key from user_sanction; CASCADE gets past
    // that, so this proves the trigger itself holds.
    const message = await dbError(() => t.db.execute(sql`truncate moderation_action cascade`));
    expect(message).toContain('append-only');
  });

  it('requires a non-blank reason', async () => {
    const message = await dbError(() =>
      t.db.insert(moderationAction).values({ actorId: newId(), action: 'ban', reason: '   ' }),
    );
    expect(message).toContain('moderation_action_reason_present');
  });
});
