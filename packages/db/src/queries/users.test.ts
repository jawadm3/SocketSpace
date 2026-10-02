import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../schema/_common';
import { user } from '../schema/auth';
import { userSanction } from '../schema/safety';
import { createTestDatabase, createTestRoom, createTestUser, type TestDatabase } from '../testing';
import { addMember, createRoom, listMemberships } from './conversations';
import {
  completeOnboarding,
  filterAvailableNicknames,
  getActiveSanctions,
  getConnectionProfile,
  getProfileSettings,
  isNicknameAvailable,
  updateProfile,
} from './users';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

describe('getConnectionProfile', () => {
  it('returns what the realtime server checks on connect', async () => {
    const u = await createTestUser(t.db, { emailVerified: false });
    expect(await getConnectionProfile(t.db, u.id)).toEqual({
      id: u.id,
      status: 'active',
      role: 'user',
      isAnonymous: false,
      emailVerified: false,
      onboarded: true,
      nickname: u.nickname,
      showPresence: true,
    });
    expect(await getConnectionProfile(t.db, newId())).toBeNull();
  });
});

describe('nicknames', () => {
  it('checks availability without regard to letter case', async () => {
    await createTestUser(t.db, { nickname: 'NightOwl' });
    expect(await isNicknameAvailable(t.db, 'nightowl')).toBe(false);
    expect(await isNicknameAvailable(t.db, 'NIGHTOWL')).toBe(false);
    expect(await isNicknameAvailable(t.db, 'night_owl')).toBe(true);
  });

  it('filters a list of suggestions down to the free ones, keeping order', async () => {
    await createTestUser(t.db, { nickname: 'river' });
    await createTestUser(t.db, { nickname: 'River2' });
    expect(await filterAvailableNicknames(t.db, ['River', 'river2', 'river3', 'river_4'])).toEqual([
      'river3',
      'river_4',
    ]);
    expect(await filterAvailableNicknames(t.db, [])).toEqual([]);
  });
});

describe('completeOnboarding', () => {
  it('saves nickname and avatar and marks the account onboarded', async () => {
    const u = await createTestUser(t.db, { onboarded: false });
    const result = await completeOnboarding(t.db, u.id, {
      nickname: 'Maple',
      avatarKind: 'preset',
      avatarConfig: { style: 'notionists', seed: 'maple' },
    });
    expect(result).toEqual({ ok: true });
    const [row] = await t.db.select().from(user).where(eq(user.id, u.id));
    expect(row?.nickname).toBe('Maple');
    expect(row?.onboardedAt).toBeInstanceOf(Date);
    expect(row?.avatarConfig).toEqual({ style: 'notionists', seed: 'maple' });
  });

  it('reports a taken nickname (any letter case) instead of throwing', async () => {
    await createTestUser(t.db, { nickname: 'Pebble' });
    const u = await createTestUser(t.db, { onboarded: false });
    const result = await completeOnboarding(t.db, u.id, {
      nickname: 'PEBBLE',
      avatarKind: 'custom',
      avatarConfig: {},
    });
    expect(result).toEqual({ ok: false, reason: 'nickname_taken' });
    const [row] = await t.db.select().from(user).where(eq(user.id, u.id));
    expect(row?.onboardedAt).toBeNull();
  });

  it('reports an unknown user', async () => {
    expect(
      await completeOnboarding(t.db, newId(), {
        nickname: 'Ghost1',
        avatarKind: 'preset',
        avatarConfig: {},
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('getActiveSanctions', () => {
  it('returns only started, unlifted, unexpired sanctions', async () => {
    const u = await createTestUser(t.db);
    const hour = 3_600_000;
    const now = Date.now();
    await t.db.insert(userSanction).values([
      { userId: u.id, kind: 'mute', scope: 'global', reason: 'active' },
      { userId: u.id, kind: 'ban', scope: 'global', reason: 'lifted', liftedAt: new Date(now) },
      {
        userId: u.id,
        kind: 'suspend',
        scope: 'global',
        reason: 'expired',
        expiresAt: new Date(now - hour),
      },
      {
        userId: u.id,
        kind: 'random_timeout',
        scope: 'random',
        reason: 'future',
        startsAt: new Date(now + hour),
      },
    ]);
    const active = await getActiveSanctions(t.db, u.id);
    expect(active.map((s) => s.reason)).toEqual(['active']);

    // With a clock two hours ahead, the future sanction has started too.
    const later = await getActiveSanctions(t.db, u.id, new Date(now + 2 * hour));
    expect(later.map((s) => s.reason).sort()).toEqual(['active', 'future']);
  });
});

describe('memberships', () => {
  it('createRoom makes the creator the owner; addMember is idempotent and counts members', async () => {
    const owner = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createRoom(t.db, {
      creatorId: owner.id,
      slug: 'garden-club',
      name: 'Garden club',
      visibility: 'public',
    });
    expect(await listMemberships(t.db, owner.id)).toContainEqual({
      conversationId: room.id,
      role: 'owner',
    });

    expect(await addMember(t.db, room.id, sam.id)).toEqual({ added: true });
    expect(await addMember(t.db, room.id, sam.id)).toEqual({ added: false });
    expect(await listMemberships(t.db, sam.id)).toEqual([
      { conversationId: room.id, role: 'member' },
    ]);
  });

  it('lists every conversation a user belongs to', async () => {
    const owner = await createTestUser(t.db);
    const kim = await createTestUser(t.db);
    const a = await createTestRoom(t.db, owner.id, [kim.id]);
    const b = await createTestRoom(t.db, owner.id, [kim.id]);
    await createTestRoom(t.db, owner.id);
    const ids = (await listMemberships(t.db, kim.id)).map((m) => m.conversationId).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });
});

describe('profile settings (PROF-01, PROF-04)', () => {
  it('onboarding saves the real-name choices when given', async () => {
    const u = await createTestUser(t.db, { onboarded: false, name: 'From Google' });
    const result = await completeOnboarding(t.db, u.id, {
      nickname: `named${u.id.slice(-6)}`,
      avatarKind: 'custom',
      avatarConfig: { style: 'lorelei', seed: 'x', options: { hairVariant: 'variant03' } },
      names: { realName: 'Ava Chen', realNameVisibility: 'contacts', nameDisplay: 'both' },
    });
    expect(result).toEqual({ ok: true });
    expect(await getProfileSettings(t.db, u.id)).toMatchObject({
      realName: 'Ava Chen',
      realNameVisibility: 'contacts',
      nameDisplay: 'both',
      avatarKind: 'custom',
    });
  });

  it('saves edits and says when what everyone sees changed', async () => {
    const u = await createTestUser(t.db);
    const current = await getProfileSettings(t.db, u.id);
    if (!current?.nickname) throw new Error('no profile');
    const base = {
      nickname: current.nickname,
      realName: '',
      realNameVisibility: 'nobody' as const,
      nameDisplay: 'nickname' as const,
      bio: 'Likes chess.',
    };
    expect(await updateProfile(t.db, u.id, base)).toEqual({ ok: true, publicChanged: false });
    expect(await updateProfile(t.db, u.id, { ...base, nickname: `${current.nickname}x` })).toEqual({
      ok: true,
      publicChanged: true,
    });
    expect(
      await updateProfile(t.db, u.id, {
        ...base,
        nickname: `${current.nickname}x`,
        avatar: { kind: 'preset', config: { style: 'thumbs', seed: 'new' } },
      }),
    ).toEqual({ ok: true, publicChanged: true });
    expect((await getProfileSettings(t.db, u.id))?.bio).toBe('Likes chess.');
  });

  it('refuses a nickname someone else has, in any letter case', async () => {
    const a = await createTestUser(t.db);
    const b = await createTestUser(t.db);
    const result = await updateProfile(t.db, b.id, {
      nickname: (a.nickname ?? '').toUpperCase(),
      realName: '',
      realNameVisibility: 'nobody',
      nameDisplay: 'nickname',
      bio: '',
    });
    expect(result).toEqual({ ok: false, reason: 'nickname_taken' });
  });
});
