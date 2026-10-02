/**
 * Conversations and memberships. Stage C covers what the realtime server needs on connect and
 * what tests and the demo seed need; Stage D adds DMs, invites, roles and moderation actions.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database, Queryable } from '../client';
import { newId } from '../schema/_common';
import { conversation, conversationMember } from '../schema/conversations';

export interface Membership {
  conversationId: string;
  role: 'owner' | 'moderator' | 'member';
}

/** Every conversation the user belongs to (the realtime server joins one room per entry). */
export async function listMemberships(db: Queryable, userId: string): Promise<Membership[]> {
  return db
    .select({ conversationId: conversationMember.conversationId, role: conversationMember.role })
    .from(conversationMember)
    .where(eq(conversationMember.userId, userId));
}

export interface CreateRoomInput {
  creatorId: string;
  slug: string;
  name: string;
  topic?: string | null;
  visibility: 'public' | 'private';
}

/** Creates a room with its creator as owner, in one transaction. */
export async function createRoom(db: Database, input: CreateRoomInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const id = newId();
    await tx.insert(conversation).values({
      id,
      kind: 'room',
      visibility: input.visibility,
      slug: input.slug,
      name: input.name,
      topic: input.topic ?? null,
      createdBy: input.creatorId,
      memberCount: 1,
    });
    await tx
      .insert(conversationMember)
      .values({ conversationId: id, userId: input.creatorId, role: 'owner' });
    return { id };
  });
}

/** Adds a member (no-op if already a member) and keeps `member_count` in step. */
export async function addMember(
  db: Database,
  conversationId: string,
  userId: string,
  role: Membership['role'] = 'member',
): Promise<{ added: boolean }> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(conversationMember)
      .values({ conversationId, userId, role })
      .onConflictDoNothing()
      .returning({ userId: conversationMember.userId });
    if (inserted.length === 0) return { added: false };
    await tx
      .update(conversation)
      .set({ memberCount: sql`${conversation.memberCount} + 1` })
      .where(eq(conversation.id, conversationId));
    return { added: true };
  });
}

/** Of `conversationIds`, the ones `userId` belongs to (one query; used to authorise resync). */
export async function filterMemberConversations(
  db: Queryable,
  userId: string,
  conversationIds: readonly string[],
): Promise<Set<string>> {
  if (conversationIds.length === 0) return new Set();
  const rows = await db
    .select({ conversationId: conversationMember.conversationId })
    .from(conversationMember)
    .where(
      and(
        eq(conversationMember.userId, userId),
        inArray(conversationMember.conversationId, [...conversationIds]),
      ),
    );
  return new Set(rows.map((r) => r.conversationId));
}

export interface ConversationBroadcast {
  id: string;
  kind: 'room' | 'dm';
  visibility: 'public' | 'private';
  slug: string | null;
  name: string | null;
  topic: string | null;
  lastEventSeq: number;
  memberCount: number;
}

/** A conversation in the shape broadcasts carry, or `null` if it is missing or was deleted. */
export async function getConversationForBroadcast(
  db: Queryable,
  conversationId: string,
): Promise<ConversationBroadcast | null> {
  const [row] = await db
    .select({
      id: conversation.id,
      kind: conversation.kind,
      visibility: conversation.visibility,
      slug: conversation.slug,
      name: conversation.name,
      topic: conversation.topic,
      lastEventSeq: conversation.lastEventSeq,
      memberCount: conversation.memberCount,
    })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), isNull(conversation.archivedAt)));
  return row ?? null;
}

/** One person's membership of a conversation, or `null`. */
export async function getMembership(
  db: Queryable,
  conversationId: string,
  userId: string,
): Promise<{ role: Membership['role']; joinedAt: Date } | null> {
  const [row] = await db
    .select({ role: conversationMember.role, joinedAt: conversationMember.joinedAt })
    .from(conversationMember)
    .where(
      and(
        eq(conversationMember.conversationId, conversationId),
        eq(conversationMember.userId, userId),
      ),
    );
  return row ?? null;
}
