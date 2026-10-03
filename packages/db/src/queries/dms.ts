/**
 * Direct messages, blocks, privacy settings, delivery receipts and search (Stage D4: DM-01,
 * DM-02, SAFE-01, HIST-03).
 *
 * - One DM per pair of people: the conversation's `dm_key` is the two user IDs, sorted. Starting a
 *   DM again returns the same one, even when two people start it at the same moment.
 * - Starting a DM needs an active, verified, set-up account; the other person must be findable,
 *   neither may have blocked the other, and the other person's "who may message me" setting must
 *   allow it (everyone, contacts only, or nobody). An existing DM can be reopened whatever the
 *   setting says now, but a block always stops new messages (`sendMessage` checks it too).
 * - Delivery and read receipts are shown to the other person only if **both** allow read receipts.
 */
import { decideGlobal } from '@socketspace/shared/authz';
import type { DmPolicy } from '@socketspace/shared/domain';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import type { Database, Queryable } from '../client';
import { newId } from '../schema/_common';
import { user } from '../schema/auth';
import { conversation, conversationMember } from '../schema/conversations';
import { message } from '../schema/messages';
import { block, contact } from '../schema/social';
import type { MessageRow } from './messages';
import { getRoomForViewer, loadActor } from './rooms';

export const dmKeyFor = (a: string, b: string): string => [a, b].sort().join(':');

export type StartDmResult =
  | { ok: true; conversationId: string; created: boolean; otherUserId: string }
  | { ok: false; reason: 'not_allowed_to_start' | 'self' | 'not_found' | 'blocked' | 'policy' };

/** Is there a block between these two people, in either direction? */
export async function isBlockedEitherWay(db: Queryable, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ blockerId: block.blockerId })
    .from(block)
    .where(
      or(
        and(eq(block.blockerId, a), eq(block.blockedId, b)),
        and(eq(block.blockerId, b), eq(block.blockedId, a)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Opens the DM between two people, creating it if needed (DM-01). */
export async function startDm(
  db: Database,
  actorId: string,
  targetId: string,
): Promise<StartDmResult> {
  const actor = await loadActor(db, actorId);
  if (!actor || !decideGlobal(actor, 'dm.start').allowed) {
    return { ok: false, reason: 'not_allowed_to_start' };
  }
  if (actorId === targetId) return { ok: false, reason: 'self' };
  const [target] = await db
    .select({
      id: user.id,
      status: user.status,
      isAnonymous: user.isAnonymous,
      onboardedAt: user.onboardedAt,
      dmPolicy: user.dmPolicy,
    })
    .from(user)
    .where(eq(user.id, targetId));
  if (target?.status !== 'active' || target.isAnonymous || !target.onboardedAt) {
    return { ok: false, reason: 'not_found' };
  }
  if (await isBlockedEitherWay(db, actorId, targetId)) return { ok: false, reason: 'blocked' };

  const key = dmKeyFor(actorId, targetId);
  const existing = await findDm(db, key);
  if (existing)
    return { ok: true, conversationId: existing, created: false, otherUserId: targetId };

  if (target.dmPolicy === 'nobody') return { ok: false, reason: 'policy' };
  if (target.dmPolicy === 'contacts') {
    const [isContact] = await db
      .select({ userId: contact.userId })
      .from(contact)
      .where(and(eq(contact.userId, targetId), eq(contact.contactId, actorId)));
    if (!isContact) return { ok: false, reason: 'policy' };
  }

  const created = await db.transaction(async (tx) => {
    const id = newId();
    const inserted = await tx
      .insert(conversation)
      .values({
        id,
        kind: 'dm',
        visibility: 'private',
        dmKey: key,
        createdBy: actorId,
        memberCount: 2,
      })
      .onConflictDoNothing({ target: conversation.dmKey })
      .returning({ id: conversation.id });
    if (inserted.length === 0) return null; // someone else created it a moment ago
    await tx.insert(conversationMember).values([
      { conversationId: id, userId: actorId, role: 'member' },
      { conversationId: id, userId: targetId, role: 'member' },
    ]);
    return id;
  });
  if (created) return { ok: true, conversationId: created, created: true, otherUserId: targetId };
  const raced = await findDm(db, key);
  if (!raced) throw new Error('DM vanished after a conflicting insert');
  return { ok: true, conversationId: raced, created: false, otherUserId: targetId };
}

/** The DM between two people, if there is one. */
export async function findDmBetween(db: Queryable, a: string, b: string): Promise<string | null> {
  return findDm(db, dmKeyFor(a, b));
}

async function findDm(db: Queryable, key: string): Promise<string | null> {
  const [row] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.dmKey, key), isNull(conversation.archivedAt)));
  return row?.id ?? null;
}

export interface MyDm {
  id: string;
  otherUserId: string;
  lastEventSeq: number;
  lastMessageAt: Date | null;
}

/** The DMs a person is in, most recent first (the sidebar). */
export async function listUserDms(db: Queryable, userId: string): Promise<MyDm[]> {
  const rows = await db
    .select({
      id: conversation.id,
      lastEventSeq: conversation.lastEventSeq,
      lastMessageAt: conversation.lastMessageAt,
      otherUserId: sql<string>`(select ${conversationMember.userId} from ${conversationMember}
        where ${conversationMember.conversationId} = ${conversation.id}
          and ${conversationMember.userId} <> ${userId} limit 1)`,
    })
    .from(conversationMember)
    .innerJoin(conversation, eq(conversation.id, conversationMember.conversationId))
    .where(
      and(
        eq(conversationMember.userId, userId),
        eq(conversation.kind, 'dm'),
        isNull(conversation.archivedAt),
      ),
    )
    .orderBy(sql`${conversation.lastMessageAt} desc nulls last`, desc(conversation.createdAt));
  return rows.filter((r): r is MyDm => typeof r.otherUserId === 'string');
}

export interface DmView {
  id: string;
  otherUserId: string;
  lastEventSeq: number;
  /** Either person blocked the other: the DM can be read but not written to. */
  blocked: boolean;
  /** The other person's delivered and read marks, if both allow read receipts; else null. */
  receipts: { delivered: number; read: number } | null;
}

/** A DM as one of its two members sees it, or null (not a member, or no such DM). */
export async function getDmForViewer(
  db: Queryable,
  viewerId: string,
  conversationId: string,
): Promise<DmView | null> {
  const [row] = await db
    .select({ id: conversation.id, lastEventSeq: conversation.lastEventSeq })
    .from(conversation)
    .innerJoin(
      conversationMember,
      and(
        eq(conversationMember.conversationId, conversation.id),
        eq(conversationMember.userId, viewerId),
      ),
    )
    .where(
      and(
        eq(conversation.id, conversationId),
        eq(conversation.kind, 'dm'),
        isNull(conversation.archivedAt),
      ),
    );
  if (!row) return null;
  const [other] = await db
    .select({
      userId: conversationMember.userId,
      delivered: conversationMember.lastDeliveredSeq,
      read: conversationMember.lastReadSeq,
    })
    .from(conversationMember)
    .where(
      and(eq(conversationMember.conversationId, row.id), ne(conversationMember.userId, viewerId)),
    );
  if (!other) return null;
  const receipts = (await receiptsAllowed(db, viewerId, other.userId))
    ? { delivered: Math.max(other.delivered, other.read), read: other.read }
    : null;
  return {
    id: row.id,
    otherUserId: other.userId,
    lastEventSeq: row.lastEventSeq,
    blocked: await isBlockedEitherWay(db, viewerId, other.userId),
    receipts,
  };
}

/** Both people allow read receipts (DM-02: switching them off hides them both ways). */
export async function receiptsAllowed(db: Queryable, a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ readReceipts: user.readReceipts })
    .from(user)
    .where(inArray(user.id, [a, b]));
  return rows.length === 2 && rows.every((r) => r.readReceipts);
}

/** The other member of a DM, or null for rooms. */
export async function dmPartner(
  db: Queryable,
  conversationId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ userId: conversationMember.userId })
    .from(conversationMember)
    .innerJoin(conversation, eq(conversation.id, conversationMember.conversationId))
    .where(
      and(
        eq(conversationMember.conversationId, conversationId),
        eq(conversation.kind, 'dm'),
        ne(conversationMember.userId, userId),
      ),
    );
  return row?.userId ?? null;
}

/**
 * Records that a person's device received a DM up to `seq` (DM-02). Moves forward only, never
 * past the conversation's latest event; rooms are ignored.
 */
export async function markDelivered(
  db: Queryable,
  input: { conversationId: string; userId: string; seq: number },
): Promise<{ moved: boolean; lastDeliveredSeq: number } | null> {
  const [updated] = await db
    .update(conversationMember)
    .set({
      lastDeliveredSeq: sql`least(${input.seq}, (select ${conversation.lastEventSeq}
        from ${conversation} where ${conversation.id} = ${input.conversationId}))`,
    })
    .where(
      and(
        eq(conversationMember.conversationId, input.conversationId),
        eq(conversationMember.userId, input.userId),
        sql`${conversationMember.lastDeliveredSeq} < ${input.seq}`,
        sql`exists (select 1 from ${conversation} where ${conversation.id} = ${input.conversationId}
          and ${conversation.kind} = 'dm')`,
      ),
    )
    .returning({ lastDeliveredSeq: conversationMember.lastDeliveredSeq });
  if (updated) return { moved: true, lastDeliveredSeq: updated.lastDeliveredSeq };
  return null;
}

// Blocks -----------------------------------------------------------------------------------------

/** Blocks someone (SAFE-01). Blocking yourself or someone who does not exist does nothing. */
export async function blockUser(db: Queryable, blockerId: string, blockedId: string) {
  if (blockerId === blockedId) return { ok: false as const };
  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, blockedId));
  if (!target) return { ok: false as const };
  await db.insert(block).values({ blockerId, blockedId }).onConflictDoNothing();
  return { ok: true as const };
}

export async function unblockUser(db: Queryable, blockerId: string, blockedId: string) {
  await db.delete(block).where(and(eq(block.blockerId, blockerId), eq(block.blockedId, blockedId)));
}

/** The people someone blocked, newest first. */
export async function listBlocked(db: Queryable, blockerId: string): Promise<string[]> {
  const rows = await db
    .select({ id: block.blockedId })
    .from(block)
    .where(eq(block.blockerId, blockerId))
    .orderBy(desc(block.createdAt));
  return rows.map((r) => r.id);
}

// Privacy settings -------------------------------------------------------------------------------

export interface PrivacySettings {
  dmPolicy: DmPolicy;
  readReceipts: boolean;
}

export async function getPrivacySettings(
  db: Queryable,
  userId: string,
): Promise<PrivacySettings | null> {
  const [row] = await db
    .select({ dmPolicy: user.dmPolicy, readReceipts: user.readReceipts })
    .from(user)
    .where(eq(user.id, userId));
  return row ?? null;
}

export async function setPrivacySettings(
  db: Queryable,
  userId: string,
  settings: PrivacySettings,
): Promise<void> {
  await db
    .update(user)
    .set({ dmPolicy: settings.dmPolicy, readReceipts: settings.readReceipts })
    .where(eq(user.id, userId));
}

// Search -----------------------------------------------------------------------------------------

export interface SearchHit {
  message: MessageRow;
  conversationKind: 'room' | 'dm';
  roomSlug: string | null;
  roomName: string | null;
}

export const SEARCH_QUERY_MAX = 200;

/**
 * Full-text search (HIST-03) over the messages of conversations the person belongs to, newest
 * first. Words are matched as whole words in any letter case ("simple" configuration, so it works
 * the same for every language); quotes, OR and a leading minus work as on web search engines.
 * Deleted and removed messages are never found.
 */
export async function searchMessages(
  db: Queryable,
  userId: string,
  query: string,
  limit = 30,
): Promise<SearchHit[]> {
  const q = query.trim().slice(0, SEARCH_QUERY_MAX);
  if (q === '') return [];
  const tsquery = sql`websearch_to_tsquery('simple'::regconfig, ${q})`;
  const rows = await db
    .select({
      message,
      conversationKind: conversation.kind,
      roomSlug: conversation.slug,
      roomName: conversation.name,
    })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .innerJoin(
      conversationMember,
      and(
        eq(conversationMember.conversationId, message.conversationId),
        eq(conversationMember.userId, userId),
      ),
    )
    .where(
      and(
        sql`${message.bodyTsv} @@ ${tsquery}`,
        isNull(message.deletedAt),
        eq(message.moderationState, 'visible'),
        isNull(conversation.archivedAt),
      ),
    )
    .orderBy(desc(message.createdAt), desc(message.seq))
    .limit(Math.min(limit, 100));
  return rows;
}

// Reading any conversation (history pages) -------------------------------------------------------

/**
 * Who may read a conversation's history, by ID: for rooms the room page's rules (members, anyone
 * for public rooms, never someone banned); for DMs only its two members.
 */
export async function canReadConversation(
  db: Queryable,
  viewerId: string,
  conversationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ kind: conversation.kind, slug: conversation.slug })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), isNull(conversation.archivedAt)));
  if (!row) return false;
  if (row.kind === 'dm') return (await getDmForViewer(db, viewerId, conversationId)) !== null;
  if (!row.slug) return false;
  const view = await getRoomForViewer(db, viewerId, row.slug);
  return view !== null && !(view.ban && !view.membership);
}
