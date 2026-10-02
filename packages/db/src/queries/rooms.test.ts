/**
 * Rooms, invites, roles and room moderation (ROOM-01 to ROOM-06) against a real database.
 */
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { invite } from '../schema/conversations';
import { contact } from '../schema/social';
import { moderationAction } from '../schema/safety';
import { user } from '../schema/auth';
import { createTestDatabase, createTestRoom, createTestUser, type TestDatabase } from '../testing';
import { sendMessage } from './messages';
import { DELETED_USER_NAME, getPublicUsers } from './people';
import {
  getRoomForViewer,
  hashInviteCode,
  inviteCreate,
  inviteList,
  invitePreview,
  inviteRedeem,
  inviteRevoke,
  listPublicRooms,
  listRecentMessages,
  listRoomBans,
  listRoomMembers,
  listUserRooms,
  roomBanUser,
  roomCreate,
  roomDelete,
  roomJoin,
  roomLeave,
  roomMute,
  roomRemove,
  roomSetRole,
  roomTransferOwnership,
  roomUnbanUser,
  roomUnmute,
  roomUpdate,
} from './rooms';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

let roomCounter = 0;
function freshSlug() {
  roomCounter += 1;
  return `room-test-${String(roomCounter)}-${uuidv4().slice(0, 6)}`;
}

async function memberCount(conversationId: string) {
  const members = await listRoomMembers(t.db, conversationId);
  return members.length;
}

async function auditFor(conversationId: string) {
  return t.db
    .select()
    .from(moderationAction)
    .where(eq(moderationAction.conversationId, conversationId));
}

/** A room with an owner, a moderator and a plain member. */
async function staffedRoom(visibility: 'public' | 'private' = 'public') {
  const owner = await createTestUser(t.db);
  const mod = await createTestUser(t.db);
  const member = await createTestUser(t.db);
  const created = await roomCreate(t.db, owner.id, {
    slug: freshSlug(),
    name: 'Staffed',
    topic: '',
    visibility,
  });
  if (!created.ok) throw new Error(created.reason);
  const room = created.room;
  for (const person of [mod, member]) {
    if (visibility === 'public') await roomJoin(t.db, person.id, room.id);
    else {
      const made = await inviteCreate(t.db, owner.id, room.id, {
        expiresInMs: null,
        maxUses: null,
      });
      if (!made.ok) throw new Error(made.reason);
      await inviteRedeem(t.db, person.id, made.code);
    }
  }
  await roomSetRole(t.db, owner.id, room.id, mod.id, 'moderator');
  return { owner, mod, member, room };
}

describe('roomCreate (ROOM-01)', () => {
  it('makes the creator the owner and the only member', async () => {
    const ava = await createTestUser(t.db);
    const result = await roomCreate(t.db, ava.id, {
      slug: freshSlug(),
      name: 'Design talk',
      topic: 'Pixels',
      visibility: 'public',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.room).toMatchObject({ name: 'Design talk', topic: 'Pixels', memberCount: 1 });
    expect(await listRoomMembers(t.db, result.room.id)).toMatchObject([
      { userId: ava.id, role: 'owner' },
    ]);
  });

  it('refuses an address that is already taken', async () => {
    // Addresses are lower-cased by the shared schema before they get here, and the database only
    // accepts lower-case ones, so "taken in another letter case" cannot reach this point.
    const ava = await createTestUser(t.db);
    const slug = freshSlug();
    await roomCreate(t.db, ava.id, { slug, name: 'One', topic: '', visibility: 'public' });
    const again = await roomCreate(t.db, ava.id, {
      slug,
      name: 'Two',
      topic: '',
      visibility: 'public',
    });
    expect(again).toEqual({ ok: false, reason: 'slug_taken' });
  });

  it('refuses unverified and guest accounts', async () => {
    const unverified = await createTestUser(t.db, { emailVerified: false });
    const guest = await createTestUser(t.db, { isAnonymous: true });
    const input = { slug: freshSlug(), name: 'X', topic: '', visibility: 'public' as const };
    expect(await roomCreate(t.db, unverified.id, input)).toEqual({
      ok: false,
      reason: 'denied',
      deny: 'unverified',
    });
    expect(await roomCreate(t.db, guest.id, input)).toEqual({
      ok: false,
      reason: 'denied',
      deny: 'guest',
    });
  });
});

describe('roomJoin and roomLeave (ROOM-02)', () => {
  it('joins a public room once and keeps the member count right', async () => {
    const owner = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, owner.id);
    const first = await roomJoin(t.db, sam.id, room.id);
    const second = await roomJoin(t.db, sam.id, room.id);
    expect(first).toMatchObject({ ok: true, added: true, room: { memberCount: 2 } });
    expect(second).toMatchObject({ ok: true, added: false });
    expect(await memberCount(room.id)).toBe(2);
  });

  it('treats a private room as missing for people who are not in it', async () => {
    const owner = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, owner.id, [], { visibility: 'private' });
    expect(await roomJoin(t.db, sam.id, room.id)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('lets members leave, but not the last owner', async () => {
    const owner = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const room = await createTestRoom(t.db, owner.id, [sam.id]);
    expect(await roomLeave(t.db, sam.id, room.id)).toEqual({ ok: true, removed: true });
    expect(await roomLeave(t.db, sam.id, room.id)).toEqual({ ok: true, removed: false });
    expect(await roomLeave(t.db, owner.id, room.id)).toEqual({ ok: false, reason: 'last_owner' });
    expect(await memberCount(room.id)).toBe(1);
  });

  it('refuses an unverified account (read-only until verified, journey J1)', async () => {
    const owner = await createTestUser(t.db);
    const unverified = await createTestUser(t.db, { emailVerified: false });
    const room = await createTestRoom(t.db, owner.id);
    expect(await roomJoin(t.db, unverified.id, room.id)).toEqual({
      ok: false,
      reason: 'denied',
      deny: 'unverified',
    });
  });
});

describe('reading rooms', () => {
  it('shows public rooms to anyone and private rooms only to members, by any letter case', async () => {
    const owner = await createTestUser(t.db);
    const stranger = await createTestUser(t.db);
    const open = await createTestRoom(t.db, owner.id, [], { slug: freshSlug() });
    const closed = await createTestRoom(t.db, owner.id, [], {
      slug: freshSlug(),
      visibility: 'private',
    });
    expect(await getRoomForViewer(t.db, stranger.id, open.slug.toUpperCase())).toMatchObject({
      room: { id: open.id },
      membership: null,
      ban: null,
    });
    expect(await getRoomForViewer(t.db, stranger.id, closed.slug)).toBeNull();
    expect(await getRoomForViewer(t.db, owner.id, closed.slug)).toMatchObject({
      membership: { role: 'owner' },
    });
  });

  it('lists public rooms busiest first, with search and a membership flag', async () => {
    const owner = await createTestUser(t.db);
    const viewer = await createTestUser(t.db);
    const marker = `zq${uuidv4().slice(0, 8)}`;
    const quiet = await roomCreate(t.db, owner.id, {
      slug: freshSlug(),
      name: `${marker} quiet`,
      topic: '',
      visibility: 'public',
    });
    const busy = await roomCreate(t.db, owner.id, {
      slug: freshSlug(),
      name: 'Busy room',
      topic: `about ${marker} and more`,
      visibility: 'public',
    });
    await roomCreate(t.db, owner.id, {
      slug: freshSlug(),
      name: `${marker} hidden`,
      topic: '',
      visibility: 'private',
    });
    if (!quiet.ok || !busy.ok) throw new Error('create failed');
    await roomJoin(t.db, viewer.id, busy.room.id);

    const found = await listPublicRooms(t.db, viewer.id, { query: marker });
    expect(found.map((r) => [r.id, r.isMember])).toEqual([
      [busy.room.id, true],
      [quiet.room.id, false],
    ]);
    // LIKE wildcards in a search are taken literally.
    expect(await listPublicRooms(t.db, viewer.id, { query: `${marker}%` })).toEqual([]);
  });

  it('lists the rooms a person belongs to', async () => {
    const owner = await createTestUser(t.db);
    const sam = await createTestUser(t.db);
    const a = await createTestRoom(t.db, owner.id, [sam.id]);
    await createTestRoom(t.db, owner.id);
    const mine = await listUserRooms(t.db, sam.id);
    expect(mine.map((r) => [r.id, r.role])).toEqual([[a.id, 'member']]);
  });

  it('pages through recent messages oldest first', async () => {
    const owner = await createTestUser(t.db);
    const room = await createTestRoom(t.db, owner.id);
    for (const body of ['one', 'two', 'three', 'four']) {
      await sendMessage(t.db, {
        conversationId: room.id,
        authorId: owner.id,
        clientId: uuidv4(),
        body,
      });
    }
    const latest = await listRecentMessages(t.db, room.id, { limit: 2 });
    expect(latest.map((m) => m.body)).toEqual(['three', 'four']);
    const before = await listRecentMessages(t.db, room.id, { limit: 2, beforeSeq: 3 });
    expect(before.map((m) => m.body)).toEqual(['one', 'two']);
  });
});

describe('settings (ROOM-06)', () => {
  it('lets only the owner rename the room', async () => {
    const { owner, mod, member, room } = await staffedRoom();
    expect(
      await roomUpdate(t.db, member.id, room.id, { name: 'Mine now', topic: '' }),
    ).toMatchObject({ ok: false, deny: 'role' });
    expect(await roomUpdate(t.db, mod.id, room.id, { name: 'Mine now', topic: '' })).toMatchObject({
      ok: false,
      deny: 'role',
    });
    expect(
      await roomUpdate(t.db, owner.id, room.id, { name: 'Renamed', topic: 'New' }),
    ).toMatchObject({ ok: true, room: { name: 'Renamed', topic: 'New' } });
  });

  it('deletes by archiving: the room disappears and nobody can post', async () => {
    const { owner, member, room } = await staffedRoom();
    expect(await roomDelete(t.db, member.id, room.id)).toMatchObject({ ok: false, deny: 'role' });
    expect(await roomDelete(t.db, owner.id, room.id)).toEqual({ ok: true });
    expect(await getRoomForViewer(t.db, owner.id, room.slug)).toBeNull();
    expect(await listUserRooms(t.db, member.id)).toEqual([]);
    const send = await sendMessage(t.db, {
      conversationId: room.id,
      authorId: member.id,
      clientId: uuidv4(),
      body: 'hello?',
    });
    expect(send).toMatchObject({ ok: false, reason: 'conversation_archived' });
    expect((await auditFor(room.id)).map((a) => a.action)).toContain('room_delete');
  });
});

describe('roles (ROOM-04)', () => {
  it('lets the owner promote and demote, records it, and refuses everyone else', async () => {
    const { owner, mod, member, room } = await staffedRoom();
    expect(await roomSetRole(t.db, mod.id, room.id, member.id, 'moderator')).toMatchObject({
      ok: false,
      deny: 'role',
    });
    expect(await roomSetRole(t.db, owner.id, room.id, owner.id, 'member')).toMatchObject({
      ok: false,
      deny: 'self',
    });
    expect(await roomSetRole(t.db, owner.id, room.id, mod.id, 'member')).toEqual({
      ok: true,
      changed: true,
    });
    const roles = await listRoomMembers(t.db, room.id);
    expect(roles.find((m) => m.userId === mod.id)?.role).toBe('member');
    const log = await auditFor(room.id);
    expect(log.filter((a) => a.action === 'role_change')).toHaveLength(2);
  });

  it('transfers ownership; the previous owner becomes a moderator', async () => {
    const { owner, mod, member, room } = await staffedRoom();
    expect(await roomTransferOwnership(t.db, mod.id, room.id, member.id)).toMatchObject({
      ok: false,
      deny: 'role',
    });
    expect(await roomTransferOwnership(t.db, owner.id, room.id, member.id)).toEqual({ ok: true });
    const roles = new Map((await listRoomMembers(t.db, room.id)).map((m) => [m.userId, m.role]));
    expect(roles.get(member.id)).toBe('owner');
    expect(roles.get(owner.id)).toBe('moderator');
    // Now the old owner may leave.
    expect(await roomLeave(t.db, owner.id, room.id)).toEqual({ ok: true, removed: true });
  });
});

describe('room moderation (ROOM-05)', () => {
  it('mutes a member until a time; sends are refused until then, with the time', async () => {
    const { mod, member, room } = await staffedRoom();
    const t0 = new Date('2030-01-01T12:00:00.000Z');
    const muted = await roomMute(t.db, mod.id, room.id, member.id, 10 * MINUTE, 'flooding', t0);
    expect(muted).toEqual({ ok: true, until: at(t0, 10 * MINUTE) });

    const during = await sendMessage(t.db, {
      conversationId: room.id,
      authorId: member.id,
      clientId: uuidv4(),
      body: 'let me talk',
      now: at(t0, MINUTE),
    });
    expect(during).toEqual({ ok: false, reason: 'muted', until: at(t0, 10 * MINUTE) });
    const after = await sendMessage(t.db, {
      conversationId: room.id,
      authorId: member.id,
      clientId: uuidv4(),
      body: 'thanks',
      now: at(t0, 11 * MINUTE),
    });
    expect(after.ok).toBe(true);

    const log = await auditFor(room.id);
    expect(log.find((a) => a.action === 'mute')).toMatchObject({
      actorId: mod.id,
      targetUserId: member.id,
      reason: 'flooding',
    });
  });

  it('never lets a moderator act on the owner or another moderator, or anyone on themselves', async () => {
    const { owner, mod, member, room } = await staffedRoom();
    expect(await roomMute(t.db, mod.id, room.id, owner.id, MINUTE, 'nope')).toMatchObject({
      ok: false,
      deny: 'target_rank',
    });
    await roomSetRole(t.db, owner.id, room.id, member.id, 'moderator');
    expect(await roomRemove(t.db, mod.id, room.id, member.id, 'nope')).toMatchObject({
      ok: false,
      deny: 'target_rank',
    });
    expect(await roomBanUser(t.db, mod.id, room.id, mod.id, null, 'nope')).toMatchObject({
      ok: false,
      deny: 'self',
    });
  });

  it('refuses plain members', async () => {
    const owner = await createTestUser(t.db);
    const a = await createTestUser(t.db);
    const b = await createTestUser(t.db);
    const room = await createTestRoom(t.db, owner.id, [a.id, b.id]);
    expect(await roomMute(t.db, a.id, room.id, b.id, MINUTE, 'nope')).toMatchObject({
      ok: false,
      deny: 'role',
    });
  });

  it('lifts a mute early', async () => {
    const { mod, member, room } = await staffedRoom();
    await roomMute(t.db, mod.id, room.id, member.id, DAY, 'cool down');
    expect(await roomUnmute(t.db, mod.id, room.id, member.id)).toEqual({ ok: true, changed: true });
    const send = await sendMessage(t.db, {
      conversationId: room.id,
      authorId: member.id,
      clientId: uuidv4(),
      body: 'back',
    });
    expect(send.ok).toBe(true);
  });

  it('removes a member, who stops being able to post but may join again', async () => {
    const { mod, member, room } = await staffedRoom();
    expect(await roomRemove(t.db, mod.id, room.id, member.id, 'off topic')).toEqual({ ok: true });
    const send = await sendMessage(t.db, {
      conversationId: room.id,
      authorId: member.id,
      clientId: uuidv4(),
      body: 'still here?',
    });
    expect(send).toMatchObject({ ok: false, reason: 'not_member' });
    expect(await roomJoin(t.db, member.id, room.id)).toMatchObject({ ok: true, added: true });
  });

  it('bans: removes at once, keeps out until it ends, and can be lifted', async () => {
    const { mod, member, room } = await staffedRoom();
    const t0 = new Date('2030-02-01T00:00:00.000Z');
    expect(await roomBanUser(t.db, mod.id, room.id, member.id, DAY, 'abuse', t0)).toEqual({
      ok: true,
      until: at(t0, DAY),
      wasMember: true,
    });
    expect(await roomJoin(t.db, member.id, room.id, at(t0, MINUTE))).toEqual({
      ok: false,
      reason: 'room_banned',
      until: at(t0, DAY),
    });
    // After it ends they may join again.
    expect(await roomJoin(t.db, member.id, room.id, at(t0, 2 * DAY))).toMatchObject({
      ok: true,
      added: true,
    });
  });

  it('can ban someone who already left, lists bans, and lifts them', async () => {
    const { mod, member, room } = await staffedRoom();
    await roomLeave(t.db, member.id, room.id);
    expect(await roomBanUser(t.db, mod.id, room.id, member.id, null, 'spam')).toMatchObject({
      ok: true,
      until: null,
      wasMember: false,
    });
    expect((await listRoomBans(t.db, room.id)).map((b) => b.userId)).toEqual([member.id]);
    expect(await roomJoin(t.db, member.id, room.id)).toMatchObject({ reason: 'room_banned' });
    expect(await roomUnbanUser(t.db, mod.id, room.id, member.id)).toEqual({
      ok: true,
      changed: true,
    });
    expect(await roomJoin(t.db, member.id, room.id)).toMatchObject({ ok: true, added: true });
    const actions = (await auditFor(room.id)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['room_ban', 'room_unban']));
  });
});

describe('invites (ROOM-03)', () => {
  it('stores only a hash of the code, and admits people to a private room', async () => {
    const { owner, room } = await staffedRoom('private');
    const made = await inviteCreate(t.db, owner.id, room.id, { expiresInMs: DAY, maxUses: null });
    if (!made.ok) throw new Error(made.reason);
    expect(made.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const stored = await t.db.select().from(invite).where(eq(invite.id, made.invite.id));
    expect(stored[0]?.codeHash).toBe(hashInviteCode(made.code));
    expect(JSON.stringify(stored)).not.toContain(made.code);

    expect(await invitePreview(t.db, made.code)).toMatchObject({
      ok: true,
      room: { id: room.id, visibility: 'private' },
    });
    const sam = await createTestUser(t.db);
    expect(await inviteRedeem(t.db, sam.id, made.code)).toMatchObject({ ok: true, added: true });
    expect(await getRoomForViewer(t.db, sam.id, room.slug)).toMatchObject({
      membership: { role: 'member' },
    });
  });

  it('a one-use invite admits the first person; the second sees "used up" (journey J5)', async () => {
    const { owner, room } = await staffedRoom('private');
    const made = await inviteCreate(t.db, owner.id, room.id, { expiresInMs: null, maxUses: 1 });
    if (!made.ok) throw new Error(made.reason);
    const first = await createTestUser(t.db);
    const second = await createTestUser(t.db);
    expect(await inviteRedeem(t.db, first.id, made.code)).toMatchObject({ ok: true, added: true });
    // Someone already inside does not use it up again.
    expect(await inviteRedeem(t.db, first.id, made.code)).toMatchObject({ ok: true, added: false });
    expect(await inviteRedeem(t.db, second.id, made.code)).toEqual({
      ok: false,
      reason: 'invite_invalid',
      problem: 'used_up',
    });
  });

  it('refuses expired, revoked and unknown codes, and banned people', async () => {
    const { owner, mod, member, room } = await staffedRoom('private');
    const t0 = new Date('2030-03-01T00:00:00.000Z');
    const shortLived = await inviteCreate(
      t.db,
      owner.id,
      room.id,
      { expiresInMs: 30 * MINUTE, maxUses: null },
      t0,
    );
    const revoked = await inviteCreate(t.db, owner.id, room.id, {
      expiresInMs: null,
      maxUses: null,
    });
    if (!shortLived.ok || !revoked.ok) throw new Error('create failed');
    expect(await inviteRevoke(t.db, mod.id, revoked.invite.id)).toMatchObject({ ok: true });

    const sam = await createTestUser(t.db);
    expect(await inviteRedeem(t.db, sam.id, shortLived.code, at(t0, 31 * MINUTE))).toMatchObject({
      problem: 'expired',
    });
    expect(await inviteRedeem(t.db, sam.id, revoked.code)).toMatchObject({ problem: 'revoked' });
    expect(await inviteRedeem(t.db, sam.id, 'A'.repeat(22))).toMatchObject({
      problem: 'not_found',
    });

    await roomBanUser(t.db, mod.id, room.id, member.id, null, 'banned');
    const fresh = await inviteCreate(t.db, owner.id, room.id, { expiresInMs: null, maxUses: null });
    if (!fresh.ok) throw new Error(fresh.reason);
    expect(await inviteRedeem(t.db, member.id, fresh.code)).toMatchObject({
      reason: 'room_banned',
    });
  });

  it('in private rooms only moderators and owners invite; members see only their own invites', async () => {
    const { mod, member, room } = await staffedRoom('private');
    expect(
      await inviteCreate(t.db, member.id, room.id, { expiresInMs: null, maxUses: null }),
    ).toMatchObject({ ok: false, deny: 'role' });
    await inviteCreate(t.db, mod.id, room.id, { expiresInMs: null, maxUses: null });

    const open = await staffedRoom('public');
    await inviteCreate(t.db, open.member.id, open.room.id, { expiresInMs: null, maxUses: 5 });
    await inviteCreate(t.db, open.owner.id, open.room.id, { expiresInMs: null, maxUses: 5 });
    const own = await inviteList(t.db, open.member.id, open.room.id);
    const all = await inviteList(t.db, open.owner.id, open.room.id);
    if (!own.ok || !all.ok) throw new Error('list failed');
    expect(own.invites.map((i) => i.createdBy)).toEqual([open.member.id]);
    expect(all.invites).toHaveLength(2);
    // A member cannot revoke someone else's invite.
    const ownersInvite = all.invites.find((i) => i.createdBy === open.owner.id);
    expect(await inviteRevoke(t.db, open.member.id, ownersInvite?.id ?? '')).toMatchObject({
      ok: false,
      deny: 'role',
    });
  });
});

describe('getPublicUsers (D-024)', () => {
  it('shows a real name only to viewers allowed to see it, and only if chosen for chats', async () => {
    const ava = await createTestUser(t.db, { name: 'Ava Chen' });
    const friend = await createTestUser(t.db);
    const stranger = await createTestUser(t.db);
    await t.db
      .update(user)
      .set({ realNameVisibility: 'contacts', nameDisplay: 'both' })
      .where(eq(user.id, ava.id));
    await t.db.insert(contact).values({ userId: friend.id, contactId: ava.id, source: 'manual' });

    const [forFriend] = await getPublicUsers(t.db, friend.id, [ava.id]);
    const [forStranger] = await getPublicUsers(t.db, stranger.id, [ava.id]);
    const [forSelf] = await getPublicUsers(t.db, ava.id, [ava.id]);
    expect(forFriend?.realName).toBe('Ava Chen');
    expect(forStranger).toEqual({ id: ava.id, nickname: ava.nickname, avatar: null });
    expect(forSelf?.realName).toBe('Ava Chen');

    // Chats show only the nickname when the person chose that, even to contacts.
    await t.db.update(user).set({ nameDisplay: 'nickname' }).where(eq(user.id, ava.id));
    const [chatView] = await getPublicUsers(t.db, friend.id, [ava.id], 'chat');
    const [profileView] = await getPublicUsers(t.db, friend.id, [ava.id], 'profile');
    expect(chatView?.realName).toBeUndefined();
    expect(profileView?.realName).toBe('Ava Chen');
  });

  it('shows deleted accounts as "Deleted user", keeps order and skips unknown IDs', async () => {
    const a = await createTestUser(t.db);
    const gone = await createTestUser(t.db, { status: 'deleted', name: 'Secret Name' });
    const people = await getPublicUsers(t.db, a.id, [gone.id, uuidv4(), a.id, gone.id]);
    expect(people.map((p) => p.id)).toEqual([gone.id, a.id]);
    expect(people[0]).toEqual({ id: gone.id, nickname: DELETED_USER_NAME, avatar: null });
  });
});

describe('membership checks stay consistent with sending', () => {
  it('a member removed between two sends cannot post the second one', async () => {
    const { mod, member, room } = await staffedRoom();
    const before = await sendMessage(t.db, {
      conversationId: room.id,
      authorId: member.id,
      clientId: uuidv4(),
      body: 'first',
    });
    expect(before.ok).toBe(true);
    await roomRemove(t.db, mod.id, room.id, member.id, 'spam');
    const after = await sendMessage(t.db, {
      conversationId: room.id,
      authorId: member.id,
      clientId: uuidv4(),
      body: 'second',
    });
    expect(after).toMatchObject({ ok: false, reason: 'not_member' });
    const rows = await listRecentMessages(t.db, room.id);
    expect(rows.map((m) => m.body)).toEqual(['first']);
  });
});
