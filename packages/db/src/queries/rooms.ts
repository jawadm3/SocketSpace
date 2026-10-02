/**
 * Rooms: reading, creating, joining and leaving, settings, roles, invites and room moderation
 * (ROOM-01 to ROOM-06).
 *
 * Every change runs in one transaction that first locks the room's row, then loads the acting
 * person, their membership and any room ban fresh from the database, and asks the shared
 * authorisation module (`decide`). The decision and the write see the same state, so a moderator
 * demoted a moment ago cannot still mute someone, and a person removed a moment ago cannot slip
 * back in. The same row lock orders membership changes with message sends (`sendMessage` locks it
 * too). Room moderation actions are written to the append-only audit log.
 */
import { createHash, randomBytes } from 'node:crypto';

import { and, asc, desc, eq, gt, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import {
  decide,
  decideGlobal,
  type Actor,
  type ConversationAction,
  type DenyReason,
  type Target,
} from '@socketspace/shared/authz';
import type { MemberRole } from '@socketspace/shared/domain';

import type { Database, Queryable } from '../client';
import { dbNow } from '../clock';
import { isUniqueViolation } from '../errors';
import { newId } from '../schema/_common';
import { user } from '../schema/auth';
import { conversation, conversationMember, invite, roomBan } from '../schema/conversations';
import { message } from '../schema/messages';
import { moderationAction } from '../schema/safety';
import type { MessageRow } from './messages';

// Shapes -------------------------------------------------------------------------------------------

export interface RoomSummary {
  id: string;
  slug: string;
  name: string;
  topic: string;
  visibility: 'public' | 'private';
  memberCount: number;
  lastEventSeq: number;
  lastMessageAt: Date | null;
}

export type InviteProblem = 'not_found' | 'expired' | 'revoked' | 'used_up';

/** Why a room action was refused. The web app turns these into plain-English messages. */
export type RoomRefusal =
  | { reason: 'not_found' }
  | { reason: 'denied'; deny: DenyReason }
  | { reason: 'room_banned'; until: Date | null }
  | { reason: 'slug_taken' }
  | { reason: 'last_owner' }
  | { reason: 'invite_invalid'; problem: InviteProblem };

export type RoomResult<T extends object = object> =
  ({ ok: true } & T) | ({ ok: false } & RoomRefusal);

type RoomRow = typeof conversation.$inferSelect;

const summaryColumns = {
  id: conversation.id,
  slug: conversation.slug,
  name: conversation.name,
  topic: conversation.topic,
  visibility: conversation.visibility,
  memberCount: conversation.memberCount,
  lastEventSeq: conversation.lastEventSeq,
  lastMessageAt: conversation.lastMessageAt,
};

function toSummary(row: Pick<RoomRow, keyof typeof summaryColumns>): RoomSummary {
  return {
    id: row.id,
    // Rooms always have a slug and a name (database check `conversation_room_fields`).
    slug: row.slug ?? '',
    name: row.name ?? '',
    topic: row.topic ?? '',
    visibility: row.visibility,
    memberCount: row.memberCount,
    lastEventSeq: row.lastEventSeq,
    lastMessageAt: row.lastMessageAt,
  };
}

const fail = <R extends RoomRefusal>(refusal: R) => ({ ok: false as const, ...refusal });
const denied = (deny: DenyReason) => fail({ reason: 'denied', deny });

/** `until` = now + `ms`, on the database clock (`fixed` replaces it in tests). */
function plusMs(ms: number, fixed?: Date): SQL {
  return sql`${dbNow(fixed)} + make_interval(secs => ${ms / 1000}::double precision)`;
}

// Loading state inside a transaction ----------------------------------------------------------------

async function loadActor(tx: Queryable, userId: string): Promise<Actor | null> {
  const [row] = await tx
    .select({
      id: user.id,
      role: user.role,
      status: user.status,
      isAnonymous: user.isAnonymous,
      emailVerified: user.emailVerified,
      onboardedAt: user.onboardedAt,
    })
    .from(user)
    .where(eq(user.id, userId));
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    isGuest: row.isAnonymous,
    emailVerified: row.emailVerified,
    onboarded: row.onboardedAt !== null,
  };
}

/** The room's row, locked until the transaction ends. Archived (deleted) rooms count as missing. */
async function lockRoom(tx: Queryable, conversationId: string): Promise<RoomRow | null> {
  const [row] = await tx
    .select()
    .from(conversation)
    .where(
      and(
        eq(conversation.id, conversationId),
        eq(conversation.kind, 'room'),
        isNull(conversation.archivedAt),
      ),
    )
    .for('update');
  return row ?? null;
}

interface MemberState {
  role: MemberRole;
  mutedUntil: Date | null;
  muted: boolean;
}

async function memberState(
  tx: Queryable,
  conversationId: string,
  userId: string,
  clock: SQL,
): Promise<MemberState | null> {
  const [row] = await tx
    .select({
      role: conversationMember.role,
      mutedUntil: conversationMember.mutedUntil,
      muted: sql<boolean>`coalesce(${conversationMember.mutedUntil} > ${clock}, false)`,
    })
    .from(conversationMember)
    .where(
      and(
        eq(conversationMember.conversationId, conversationId),
        eq(conversationMember.userId, userId),
      ),
    );
  return row ?? null;
}

async function activeBan(
  tx: Queryable,
  conversationId: string,
  userId: string,
  clock: SQL,
): Promise<{ until: Date | null } | null> {
  const [row] = await tx
    .select({ until: roomBan.expiresAt })
    .from(roomBan)
    .where(
      and(
        eq(roomBan.conversationId, conversationId),
        eq(roomBan.userId, userId),
        or(isNull(roomBan.expiresAt), gt(roomBan.expiresAt, clock)),
      ),
    );
  return row ?? null;
}

interface Loaded {
  room: RoomRow;
  actor: Actor;
  membership: MemberState | null;
  ban: { until: Date | null } | null;
}

/** Locks the room and loads the actor's view of it. `null` if the room or the actor is missing. */
async function load(
  tx: Queryable,
  conversationId: string,
  actorId: string,
  clock: SQL,
): Promise<Loaded | null> {
  const room = await lockRoom(tx, conversationId);
  if (!room) return null;
  const actor = await loadActor(tx, actorId);
  if (!actor) return null;
  const [membership, ban] = await Promise.all([
    memberState(tx, conversationId, actorId, clock),
    activeBan(tx, conversationId, actorId, clock),
  ]);
  return { room, actor, membership, ban };
}

function check(loaded: Loaded, action: ConversationAction, target?: Target) {
  return decide(
    loaded.actor,
    {
      kind: 'room',
      visibility: loaded.room.visibility,
      membership: loaded.membership
        ? { role: loaded.membership.role, muted: loaded.membership.muted }
        : null,
      bannedHere: loaded.ban !== null,
    },
    action,
    target,
  );
}

async function loadTarget(
  tx: Queryable,
  conversationId: string,
  targetId: string,
  clock: SQL,
): Promise<{ target: Target; membership: MemberState | null } | null> {
  const [person] = await tx.select({ role: user.role }).from(user).where(eq(user.id, targetId));
  if (!person) return null;
  const membership = await memberState(tx, conversationId, targetId, clock);
  return {
    target: { userId: targetId, role: membership?.role ?? null, isAdmin: person.role === 'admin' },
    membership,
  };
}

async function changeMemberCount(tx: Queryable, conversationId: string, by: 1 | -1) {
  await tx
    .update(conversation)
    .set({
      memberCount: sql`greatest(${conversation.memberCount} + ${by}, 0)`,
      updatedAt: sql`now()`,
    })
    .where(eq(conversation.id, conversationId));
}

type AuditAction = (typeof moderationAction.$inferInsert)['action'];

async function audit(
  tx: Queryable,
  entry: {
    actorId: string;
    action: AuditAction;
    conversationId: string;
    targetUserId?: string;
    reason: string;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(moderationAction).values({
    id: newId(),
    actorId: entry.actorId,
    action: entry.action,
    conversationId: entry.conversationId,
    targetUserId: entry.targetUserId ?? null,
    reason: entry.reason,
    expiresAt: entry.expiresAt ?? null,
    metadata: entry.metadata ?? null,
  });
}

// Reading ------------------------------------------------------------------------------------------

export interface RoomView {
  room: RoomSummary;
  membership: { role: MemberRole; mutedUntil: Date | null; muted: boolean } | null;
  ban: { until: Date | null } | null;
}

/**
 * A room as `viewerId` may see it, or `null` when it does not exist, was deleted, or is private
 * and the viewer is not a member. "Private and not yours" and "missing" look identical, so nothing
 * about a private room leaks (journey J5).
 */
export async function getRoomForViewer(
  db: Queryable,
  viewerId: string,
  slug: string,
  fixedNow?: Date,
): Promise<RoomView | null> {
  const clock = dbNow(fixedNow);
  const [row] = await db
    .select(summaryColumns)
    .from(conversation)
    .where(
      and(
        eq(conversation.kind, 'room'),
        sql`lower(${conversation.slug}) = lower(${slug})`,
        isNull(conversation.archivedAt),
      ),
    );
  if (!row) return null;
  const actor = await loadActor(db, viewerId);
  if (!actor) return null;
  const [membership, ban] = await Promise.all([
    memberState(db, row.id, viewerId, clock),
    activeBan(db, row.id, viewerId, clock),
  ]);
  const read = decide(
    actor,
    {
      kind: 'room',
      visibility: row.visibility,
      membership: membership ? { role: membership.role, muted: membership.muted } : null,
      bannedHere: ban !== null,
    },
    'conversation.read',
  );
  // A banned person sees the room's name and the ban (so they know why), but no content.
  if (!read.allowed && read.reason !== 'room_banned') return null;
  if (!read.allowed && row.visibility === 'private') return null;
  return { room: toSummary(row), membership, ban };
}

export interface MyRoom extends RoomSummary {
  role: MemberRole;
}

/** The rooms a person belongs to, most recently active first (the sidebar). */
export async function listUserRooms(db: Queryable, userId: string): Promise<MyRoom[]> {
  const rows = await db
    .select({ ...summaryColumns, role: conversationMember.role })
    .from(conversationMember)
    .innerJoin(conversation, eq(conversation.id, conversationMember.conversationId))
    .where(
      and(
        eq(conversationMember.userId, userId),
        eq(conversation.kind, 'room'),
        isNull(conversation.archivedAt),
      ),
    )
    .orderBy(sql`${conversation.lastMessageAt} desc nulls last`, asc(conversation.name));
  return rows.map((row) => ({ ...toSummary(row), role: row.role }));
}

export interface PublicRoom extends RoomSummary {
  isMember: boolean;
}

/** `%` and `_` are wildcards in LIKE patterns; searching for them literally needs escaping. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The public room directory (explore), busiest first, optionally filtered by a search. */
export async function listPublicRooms(
  db: Queryable,
  viewerId: string,
  options: { query?: string; limit?: number } = {},
): Promise<PublicRoom[]> {
  const query = options.query?.trim() ?? '';
  const pattern = likePattern(query);
  const rows = await db
    .select({
      ...summaryColumns,
      isMember: sql<boolean>`exists (select 1 from ${conversationMember}
        where ${conversationMember.conversationId} = ${conversation.id}
        and ${conversationMember.userId} = ${viewerId})`,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.kind, 'room'),
        eq(conversation.visibility, 'public'),
        isNull(conversation.archivedAt),
        query === ''
          ? undefined
          : or(
              ilike(conversation.name, pattern),
              ilike(conversation.slug, pattern),
              ilike(conversation.topic, pattern),
            ),
      ),
    )
    .orderBy(
      desc(conversation.memberCount),
      sql`${conversation.lastMessageAt} desc nulls last`,
      asc(conversation.name),
    )
    .limit(Math.min(options.limit ?? 50, 100));
  return rows.map((row) => ({ ...toSummary(row), isMember: row.isMember }));
}

export interface RoomMemberRow {
  userId: string;
  role: MemberRole;
  joinedAt: Date;
  mutedUntil: Date | null;
  muted: boolean;
}

/** Members, owners first, then moderators, then by joining time. */
export async function listRoomMembers(
  db: Queryable,
  conversationId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<RoomMemberRow[]> {
  const clock = dbNow(options.now);
  return db
    .select({
      userId: conversationMember.userId,
      role: conversationMember.role,
      joinedAt: conversationMember.joinedAt,
      mutedUntil: conversationMember.mutedUntil,
      muted: sql<boolean>`coalesce(${conversationMember.mutedUntil} > ${clock}, false)`,
    })
    .from(conversationMember)
    .where(eq(conversationMember.conversationId, conversationId))
    .orderBy(
      sql`case ${conversationMember.role} when 'owner' then 0 when 'moderator' then 1 else 2 end`,
      asc(conversationMember.joinedAt),
    )
    .limit(Math.min(options.limit ?? 200, 500));
}

export interface RoomBanRow {
  userId: string;
  reason: string;
  expiresAt: Date | null;
  createdAt: Date;
}

/** Bans still in force, newest first (room settings). */
export async function listRoomBans(
  db: Queryable,
  conversationId: string,
  fixedNow?: Date,
): Promise<RoomBanRow[]> {
  const clock = dbNow(fixedNow);
  return db
    .select({
      userId: roomBan.userId,
      reason: roomBan.reason,
      expiresAt: roomBan.expiresAt,
      createdAt: roomBan.createdAt,
    })
    .from(roomBan)
    .where(
      and(
        eq(roomBan.conversationId, conversationId),
        or(isNull(roomBan.expiresAt), gt(roomBan.expiresAt, clock)),
      ),
    )
    .orderBy(desc(roomBan.createdAt));
}

/** The latest messages of a conversation, oldest first; `beforeSeq` pages further back. */
export async function listRecentMessages(
  db: Queryable,
  conversationId: string,
  options: { limit?: number; beforeSeq?: number } = {},
): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        options.beforeSeq === undefined ? undefined : lt(message.seq, options.beforeSeq),
      ),
    )
    .orderBy(desc(message.seq))
    .limit(Math.min(options.limit ?? 50, 200));
  return rows.reverse();
}

// Creating, joining, leaving ---------------------------------------------------------------------------

export interface CreateRoomRequest {
  slug: string;
  name: string;
  topic: string;
  visibility: 'public' | 'private';
}

/** Creates a room with the creator as its owner (ROOM-01). Input is already validated. */
export async function roomCreate(
  db: Database,
  actorId: string,
  input: CreateRoomRequest,
): Promise<RoomResult<{ room: RoomSummary }>> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await loadActor(tx, actorId);
      if (!actor) return fail({ reason: 'not_found' });
      const decision = decideGlobal(actor, 'room.create');
      if (!decision.allowed) return denied(decision.reason);

      const [row] = await tx
        .insert(conversation)
        .values({
          id: newId(),
          kind: 'room',
          visibility: input.visibility,
          slug: input.slug,
          name: input.name,
          topic: input.topic === '' ? null : input.topic,
          createdBy: actorId,
          memberCount: 1,
        })
        .returning(summaryColumns);
      if (!row) throw new Error('INSERT ... RETURNING returned no row');
      await tx
        .insert(conversationMember)
        .values({ conversationId: row.id, userId: actorId, role: 'owner' });
      return { ok: true as const, room: toSummary(row) };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'conversation_slug_lower_uq'))
      return fail({ reason: 'slug_taken' });
    throw error;
  }
}

/** Joins a public room (ROOM-02). Joining a room you are already in is a harmless no-op. */
export async function roomJoin(
  db: Database,
  actorId: string,
  conversationId: string,
  fixedNow?: Date,
): Promise<RoomResult<{ added: boolean; room: RoomSummary }>> {
  const clock = dbNow(fixedNow);
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    if (loaded.ban && loaded.actor.role !== 'admin') {
      return fail({ reason: 'room_banned', until: loaded.ban.until });
    }
    const decision = check(loaded, 'room.join');
    if (!decision.allowed) {
      if (decision.reason === 'already_member') {
        return { ok: true as const, added: false, room: toSummary(loaded.room) };
      }
      // A private room you are not in looks the same as a missing one.
      return decision.reason === 'private'
        ? fail({ reason: 'not_found' })
        : denied(decision.reason);
    }
    await tx.insert(conversationMember).values({ conversationId, userId: actorId, role: 'member' });
    await changeMemberCount(tx, conversationId, 1);
    return {
      ok: true as const,
      added: true,
      room: toSummary({ ...loaded.room, memberCount: loaded.room.memberCount + 1 }),
    };
  });
}

/**
 * Leaves a room. The last owner cannot leave (ownership would be lost): they transfer it or delete
 * the room first.
 */
export async function roomLeave(
  db: Database,
  actorId: string,
  conversationId: string,
): Promise<RoomResult<{ removed: boolean }>> {
  return db.transaction(async (tx) => {
    const room = await lockRoom(tx, conversationId);
    if (!room) return fail({ reason: 'not_found' });
    const [membership] = await tx
      .select({ role: conversationMember.role })
      .from(conversationMember)
      .where(
        and(
          eq(conversationMember.conversationId, conversationId),
          eq(conversationMember.userId, actorId),
        ),
      );
    if (!membership) return { ok: true as const, removed: false };
    if (membership.role === 'owner') {
      const [owners] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationMember)
        .where(
          and(
            eq(conversationMember.conversationId, conversationId),
            eq(conversationMember.role, 'owner'),
          ),
        );
      if ((owners?.count ?? 0) <= 1) return fail({ reason: 'last_owner' });
    }
    await tx
      .delete(conversationMember)
      .where(
        and(
          eq(conversationMember.conversationId, conversationId),
          eq(conversationMember.userId, actorId),
        ),
      );
    await changeMemberCount(tx, conversationId, -1);
    return { ok: true as const, removed: true };
  });
}

// Settings ---------------------------------------------------------------------------------------------

/** Renames a room or changes its topic (owners and site admins, ROOM-06). */
export async function roomUpdate(
  db: Database,
  actorId: string,
  conversationId: string,
  input: { name: string; topic: string },
): Promise<RoomResult<{ room: RoomSummary }>> {
  const clock = dbNow();
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    const decision = check(loaded, 'room.update');
    if (!decision.allowed) return denied(decision.reason);
    const [row] = await tx
      .update(conversation)
      .set({ name: input.name, topic: input.topic === '' ? null : input.topic, updatedAt: clock })
      .where(eq(conversation.id, conversationId))
      .returning(summaryColumns);
    if (!row) return fail({ reason: 'not_found' });
    return { ok: true as const, room: toSummary(row) };
  });
}

/**
 * Deletes a room (owners and site admins, ROOM-06). The room is archived rather than erased:
 * it disappears everywhere, nobody can post, and reports about its messages keep their evidence.
 * Its address stays taken, so nobody can reopen it under the same name to impersonate it.
 */
export async function roomDelete(
  db: Database,
  actorId: string,
  conversationId: string,
  reason = 'Room deleted by its owner',
): Promise<RoomResult> {
  const clock = dbNow();
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    const decision = check(loaded, 'room.delete');
    if (!decision.allowed) return denied(decision.reason);
    await tx
      .update(conversation)
      .set({ archivedAt: clock, updatedAt: clock })
      .where(eq(conversation.id, conversationId));
    await audit(tx, { actorId, action: 'room_delete', conversationId, reason });
    return { ok: true as const };
  });
}

// Roles -------------------------------------------------------------------------------------------------

/** Makes a member a moderator, or a moderator a member again (owners and site admins, ROOM-04). */
export async function roomSetRole(
  db: Database,
  actorId: string,
  conversationId: string,
  targetId: string,
  role: 'moderator' | 'member',
): Promise<RoomResult<{ changed: boolean }>> {
  const clock = dbNow();
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    const target = await loadTarget(tx, conversationId, targetId, clock);
    if (!target?.membership) return fail({ reason: 'not_found' });
    const decision = check(loaded, 'member.set_role', target.target);
    if (!decision.allowed) return denied(decision.reason);
    if (target.membership.role === role) return { ok: true as const, changed: false };
    await setRole(tx, conversationId, targetId, role);
    await audit(tx, {
      actorId,
      action: 'role_change',
      conversationId,
      targetUserId: targetId,
      reason: role === 'moderator' ? 'Made a moderator' : 'Moderator role removed',
      metadata: { from: target.membership.role, to: role },
    });
    return { ok: true as const, changed: true };
  });
}

async function setRole(tx: Queryable, conversationId: string, userId: string, role: MemberRole) {
  await tx
    .update(conversationMember)
    .set({ role })
    .where(
      and(
        eq(conversationMember.conversationId, conversationId),
        eq(conversationMember.userId, userId),
      ),
    );
}

/** Hands ownership to another member; the previous owner becomes a moderator. Owners only. */
export async function roomTransferOwnership(
  db: Database,
  actorId: string,
  conversationId: string,
  targetId: string,
): Promise<RoomResult> {
  const clock = dbNow();
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    if (loaded.membership?.role !== 'owner') {
      return denied(loaded.membership ? 'role' : 'not_member');
    }
    if (loaded.actor.status !== 'active' || !loaded.actor.emailVerified) {
      return denied(loaded.actor.status !== 'active' ? 'inactive' : 'unverified');
    }
    if (targetId === actorId) return denied('self');
    const target = await loadTarget(tx, conversationId, targetId, clock);
    if (!target?.membership) return fail({ reason: 'not_found' });
    await setRole(tx, conversationId, targetId, 'owner');
    await setRole(tx, conversationId, actorId, 'moderator');
    await audit(tx, {
      actorId,
      action: 'role_change',
      conversationId,
      targetUserId: targetId,
      reason: 'Ownership transferred',
      metadata: { from: target.membership.role, to: 'owner', previousOwner: actorId },
    });
    return { ok: true as const };
  });
}

// Room moderation --------------------------------------------------------------------------------------------

/** Mutes a member for `durationMs` (ROOM-05). Their sends are refused with the time left. */
export async function roomMute(
  db: Database,
  actorId: string,
  conversationId: string,
  targetId: string,
  durationMs: number,
  reason: string,
  fixedNow?: Date,
): Promise<RoomResult<{ until: Date }>> {
  const clock = dbNow(fixedNow);
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    const target = await loadTarget(tx, conversationId, targetId, clock);
    if (!target?.membership) return fail({ reason: 'not_found' });
    const decision = check(loaded, 'member.mute', target.target);
    if (!decision.allowed) return denied(decision.reason);
    const [row] = await tx
      .update(conversationMember)
      .set({ mutedUntil: plusMs(durationMs, fixedNow) })
      .where(
        and(
          eq(conversationMember.conversationId, conversationId),
          eq(conversationMember.userId, targetId),
        ),
      )
      .returning({ until: conversationMember.mutedUntil });
    const until = row?.until;
    if (!until) throw new Error('mute was not saved');
    await audit(tx, {
      actorId,
      action: 'mute',
      conversationId,
      targetUserId: targetId,
      reason,
      expiresAt: until,
    });
    return { ok: true as const, until };
  });
}

/** Lifts a member's room mute early. */
export async function roomUnmute(
  db: Database,
  actorId: string,
  conversationId: string,
  targetId: string,
): Promise<RoomResult<{ changed: boolean }>> {
  const clock = dbNow();
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    const target = await loadTarget(tx, conversationId, targetId, clock);
    if (!target?.membership) return fail({ reason: 'not_found' });
    const decision = check(loaded, 'member.mute', target.target);
    if (!decision.allowed) return denied(decision.reason);
    if (!target.membership.muted) return { ok: true as const, changed: false };
    await tx
      .update(conversationMember)
      .set({ mutedUntil: null })
      .where(
        and(
          eq(conversationMember.conversationId, conversationId),
          eq(conversationMember.userId, targetId),
        ),
      );
    await audit(tx, {
      actorId,
      action: 'unmute',
      conversationId,
      targetUserId: targetId,
      reason: 'Mute lifted',
    });
    return { ok: true as const, changed: true };
  });
}

/** Removes a member from the room (they can join again unless banned). */
export async function roomRemove(
  db: Database,
  actorId: string,
  conversationId: string,
  targetId: string,
  reason: string,
): Promise<RoomResult> {
  const clock = dbNow();
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    const target = await loadTarget(tx, conversationId, targetId, clock);
    if (!target?.membership) return fail({ reason: 'not_found' });
    const decision = check(loaded, 'member.remove', target.target);
    if (!decision.allowed) return denied(decision.reason);
    await removeMembership(tx, conversationId, targetId);
    await audit(tx, {
      actorId,
      action: 'room_remove',
      conversationId,
      targetUserId: targetId,
      reason,
    });
    return { ok: true as const };
  });
}

async function removeMembership(tx: Queryable, conversationId: string, userId: string) {
  const removed = await tx
    .delete(conversationMember)
    .where(
      and(
        eq(conversationMember.conversationId, conversationId),
        eq(conversationMember.userId, userId),
      ),
    )
    .returning({ userId: conversationMember.userId });
  if (removed.length > 0) await changeMemberCount(tx, conversationId, -1);
  return removed.length > 0;
}

/**
 * Bans someone from the room for `durationMs` (`null`: until lifted). A member is removed at once;
 * a non-member is kept out, so a moderator can act on someone who just left.
 */
export async function roomBanUser(
  db: Database,
  actorId: string,
  conversationId: string,
  targetId: string,
  durationMs: number | null,
  reason: string,
  fixedNow?: Date,
): Promise<RoomResult<{ until: Date | null; wasMember: boolean }>> {
  const clock = dbNow(fixedNow);
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    const target = await loadTarget(tx, conversationId, targetId, clock);
    if (!target) return fail({ reason: 'not_found' });
    const decision = check(loaded, 'member.ban', target.target);
    if (!decision.allowed) return denied(decision.reason);
    const expiresAt = durationMs === null ? null : plusMs(durationMs, fixedNow);
    const [ban] = await tx
      .insert(roomBan)
      .values({ conversationId, userId: targetId, bannedBy: actorId, reason, expiresAt })
      .onConflictDoUpdate({
        target: [roomBan.conversationId, roomBan.userId],
        set: { bannedBy: actorId, reason, expiresAt, createdAt: clock },
      })
      .returning({ until: roomBan.expiresAt });
    const wasMember = await removeMembership(tx, conversationId, targetId);
    const until = ban?.until ?? null;
    await audit(tx, {
      actorId,
      action: 'room_ban',
      conversationId,
      targetUserId: targetId,
      reason,
      expiresAt: until,
    });
    return { ok: true as const, until, wasMember };
  });
}

/** Lifts a room ban. The person can then join again (or be invited). */
export async function roomUnbanUser(
  db: Database,
  actorId: string,
  conversationId: string,
  targetId: string,
): Promise<RoomResult<{ changed: boolean }>> {
  const clock = dbNow();
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    const target = await loadTarget(tx, conversationId, targetId, clock);
    if (!target) return fail({ reason: 'not_found' });
    const decision = check(loaded, 'member.ban', target.target);
    if (!decision.allowed) return denied(decision.reason);
    const removed = await tx
      .delete(roomBan)
      .where(and(eq(roomBan.conversationId, conversationId), eq(roomBan.userId, targetId)))
      .returning({ userId: roomBan.userId });
    if (removed.length === 0) return { ok: true as const, changed: false };
    await audit(tx, {
      actorId,
      action: 'room_unban',
      conversationId,
      targetUserId: targetId,
      reason: 'Room ban lifted',
    });
    return { ok: true as const, changed: true };
  });
}

// Invites ----------------------------------------------------------------------------------------------------------

/** SHA-256 of an invite code: what the database stores instead of the code (data-model.md). */
export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export interface InviteSummary {
  id: string;
  createdBy: string | null;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: Date | null;
  createdAt: Date;
}

const inviteColumns = {
  id: invite.id,
  createdBy: invite.createdBy,
  expiresAt: invite.expiresAt,
  maxUses: invite.maxUses,
  useCount: invite.useCount,
  revokedAt: invite.revokedAt,
  createdAt: invite.createdAt,
};

/**
 * Creates an invite link (ROOM-03). The code is returned once and never stored: only its hash is,
 * so a database leak does not leak working invite links.
 */
export async function inviteCreate(
  db: Database,
  actorId: string,
  conversationId: string,
  options: { expiresInMs: number | null; maxUses: number | null },
  fixedNow?: Date,
): Promise<RoomResult<{ code: string; invite: InviteSummary }>> {
  const clock = dbNow(fixedNow);
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    const decision = check(loaded, 'room.invite');
    if (!decision.allowed) return denied(decision.reason);
    const code = randomBytes(16).toString('base64url');
    const [row] = await tx
      .insert(invite)
      .values({
        id: newId(),
        conversationId,
        codeHash: hashInviteCode(code),
        createdBy: actorId,
        expiresAt: options.expiresInMs === null ? null : plusMs(options.expiresInMs, fixedNow),
        maxUses: options.maxUses,
        createdAt: clock,
      })
      .returning(inviteColumns);
    if (!row) throw new Error('INSERT ... RETURNING returned no row');
    return { ok: true as const, code, invite: row };
  });
}

export interface InviteListItem extends InviteSummary {
  /** Past its expiry time, by the database clock. */
  expired: boolean;
}

/** Invites of a room: moderators and owners see all, members see their own. */
export async function inviteList(
  db: Database,
  actorId: string,
  conversationId: string,
): Promise<RoomResult<{ invites: InviteListItem[] }>> {
  const clock = dbNow();
  return db.transaction(async (tx) => {
    const loaded = await load(tx, conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    const decision = check(loaded, 'room.invite');
    if (!decision.allowed) return denied(decision.reason);
    const seesAll =
      loaded.actor.role === 'admin' ||
      loaded.membership?.role === 'owner' ||
      loaded.membership?.role === 'moderator';
    const invites = await tx
      .select({
        ...inviteColumns,
        expired: sql<boolean>`coalesce(${invite.expiresAt} <= ${clock}, false)`,
      })
      .from(invite)
      .where(
        and(
          eq(invite.conversationId, conversationId),
          seesAll ? undefined : eq(invite.createdBy, actorId),
        ),
      )
      .orderBy(desc(invite.createdAt))
      .limit(100);
    return { ok: true as const, invites };
  });
}

/** Revokes an invite: its creator, or a moderator, owner or site admin of the room. */
export async function inviteRevoke(
  db: Database,
  actorId: string,
  inviteId: string,
): Promise<RoomResult<{ conversationId: string }>> {
  const clock = dbNow();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ conversationId: invite.conversationId, createdBy: invite.createdBy })
      .from(invite)
      .where(eq(invite.id, inviteId));
    if (!row) return fail({ reason: 'not_found' });
    const loaded = await load(tx, row.conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'not_found' });
    const decision = check(loaded, 'room.invite');
    if (!decision.allowed) return denied(decision.reason);
    const moderates =
      loaded.actor.role === 'admin' ||
      loaded.membership?.role === 'owner' ||
      loaded.membership?.role === 'moderator';
    if (!moderates && row.createdBy !== actorId) return denied('role');
    await tx
      .update(invite)
      .set({ revokedAt: clock })
      .where(and(eq(invite.id, inviteId), isNull(invite.revokedAt)));
    return { ok: true as const, conversationId: row.conversationId };
  });
}

interface InviteState {
  id: string;
  conversationId: string;
  revoked: boolean;
  expired: boolean;
  usedUp: boolean;
}

async function findInvite(
  tx: Queryable,
  code: string,
  clock: SQL,
  lock: boolean,
): Promise<InviteState | null> {
  const query = tx
    .select({
      id: invite.id,
      conversationId: invite.conversationId,
      revoked: sql<boolean>`${invite.revokedAt} is not null`,
      expired: sql<boolean>`coalesce(${invite.expiresAt} <= ${clock}, false)`,
      usedUp: sql<boolean>`coalesce(${invite.useCount} >= ${invite.maxUses}, false)`,
    })
    .from(invite)
    .where(eq(invite.codeHash, hashInviteCode(code)));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

function inviteProblem(state: InviteState): InviteProblem | null {
  if (state.revoked) return 'revoked';
  if (state.expired) return 'expired';
  if (state.usedUp) return 'used_up';
  return null;
}

/** What an invite link opens, for the "Join" page. Works for private rooms: that is its purpose. */
export async function invitePreview(
  db: Queryable,
  code: string,
  fixedNow?: Date,
): Promise<RoomResult<{ room: RoomSummary }>> {
  const clock = dbNow(fixedNow);
  const state = await findInvite(db, code, clock, false);
  if (!state) return fail({ reason: 'invite_invalid', problem: 'not_found' });
  const problem = inviteProblem(state);
  if (problem) return fail({ reason: 'invite_invalid', problem });
  const [row] = await db
    .select(summaryColumns)
    .from(conversation)
    .where(and(eq(conversation.id, state.conversationId), isNull(conversation.archivedAt)));
  if (!row) return fail({ reason: 'invite_invalid', problem: 'not_found' });
  return { ok: true as const, room: toSummary(row) };
}

/**
 * Joins a room with an invite (ROOM-03). Expired, revoked and used-up invites are refused, and so
 * are people banned from the room. Someone already in the room does not use up the invite.
 */
export async function inviteRedeem(
  db: Database,
  actorId: string,
  code: string,
  fixedNow?: Date,
): Promise<RoomResult<{ added: boolean; room: RoomSummary }>> {
  const clock = dbNow(fixedNow);
  return db.transaction(async (tx) => {
    const state = await findInvite(tx, code, clock, true);
    if (!state) return fail({ reason: 'invite_invalid', problem: 'not_found' });
    const loaded = await load(tx, state.conversationId, actorId, clock);
    if (!loaded) return fail({ reason: 'invite_invalid', problem: 'not_found' });
    if (loaded.membership) {
      return { ok: true as const, added: false, room: toSummary(loaded.room) };
    }
    const problem = inviteProblem(state);
    if (problem) return fail({ reason: 'invite_invalid', problem });
    if (loaded.ban && loaded.actor.role !== 'admin') {
      return fail({ reason: 'room_banned', until: loaded.ban.until });
    }
    const decision = check(loaded, 'room.join_with_invite');
    if (!decision.allowed) return denied(decision.reason);
    await tx
      .insert(conversationMember)
      .values({ conversationId: state.conversationId, userId: actorId, role: 'member' });
    await changeMemberCount(tx, state.conversationId, 1);
    await tx
      .update(invite)
      .set({ useCount: sql`${invite.useCount} + 1` })
      .where(eq(invite.id, state.id));
    return {
      ok: true as const,
      added: true,
      room: toSummary({ ...loaded.room, memberCount: loaded.room.memberCount + 1 }),
    };
  });
}
