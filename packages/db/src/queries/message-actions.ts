/**
 * Changing messages after they were sent: edit, delete and reactions (MSG-02, MSG-03, MSG-05).
 *
 * Each change runs in one transaction that locks the conversation's row first (the same order as
 * `sendMessage`, so two writers can never wait for each other in a circle), then the message, and
 * takes the conversation's next event number. Resync (`sync:request`) therefore carries edits,
 * deletions and reaction changes like new messages.
 *
 * Earlier text is kept for 30 days in `message_revision`, for edits and deletions alike, so a
 * moderator can still see what a reported message said (data-model.md, retention).
 */
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { decide, type DenyReason } from '@socketspace/shared/authz';
import { LIMITS } from '@socketspace/shared/limits';

import type { Database, Queryable } from '../client';
import { dbNow } from '../clock';
import { newId } from '../schema/_common';
import { user } from '../schema/auth';
import { conversation, conversationMember, roomBan } from '../schema/conversations';
import { mention, message, messageRevision, reaction } from '../schema/messages';
import { moderationAction } from '../schema/safety';
import { removeMessageAttachments } from './attachments';
import { checkCanPost, saveMentions, type MessageRow, type SendRefusal } from './messages';
import { notifyForMessage, type NotificationRow } from './notifications';

export type MessageActionRefusal =
  | SendRefusal
  | { reason: 'message_not_found' }
  | { reason: 'not_author' }
  | { reason: 'deleted' }
  | { reason: 'too_late' }
  | { reason: 'too_many_reactions' }
  | { reason: 'denied'; deny: DenyReason };

export type MessageActionResult<T extends object = object> =
  ({ ok: true; message: MessageRow } & T) | ({ ok: false } & MessageActionRefusal);

export interface ReactionSummary {
  emoji: string;
  userIds: string[];
}

const fail = <R extends MessageActionRefusal>(refusal: R) => ({ ok: false as const, ...refusal });

interface Locked {
  message: MessageRow;
  conversation: {
    id: string;
    kind: 'room' | 'dm';
    visibility: 'public' | 'private';
    lastEventSeq: number;
    archived: boolean;
  };
}

/** Locks the message's conversation, then the message. `null` when the message is missing. */
async function lockMessage(tx: Queryable, messageId: string): Promise<Locked | null> {
  const [where] = await tx
    .select({ conversationId: message.conversationId })
    .from(message)
    .where(eq(message.id, messageId));
  if (!where) return null;
  const [conv] = await tx
    .select({
      id: conversation.id,
      kind: conversation.kind,
      visibility: conversation.visibility,
      lastEventSeq: conversation.lastEventSeq,
      archivedAt: conversation.archivedAt,
    })
    .from(conversation)
    .where(eq(conversation.id, where.conversationId))
    .for('update');
  const [row] = await tx.select().from(message).where(eq(message.id, messageId)).for('update');
  if (!conv || !row) return null;
  return {
    message: row,
    conversation: {
      id: conv.id,
      kind: conv.kind,
      visibility: conv.visibility,
      lastEventSeq: conv.lastEventSeq,
      archived: conv.archivedAt !== null,
    },
  };
}

/** Moves the conversation's counter on by one and returns the new event number. */
async function nextEventSeq(tx: Queryable, locked: Locked): Promise<number> {
  const seq = locked.conversation.lastEventSeq + 1;
  await tx
    .update(conversation)
    .set({ lastEventSeq: seq })
    .where(eq(conversation.id, locked.conversation.id));
  return seq;
}

/** Keeps the current text as the next revision (kept 30 days for moderation). */
async function keepRevision(tx: Queryable, row: MessageRow, clock: SQL) {
  const [latest] = await tx
    .select({ revision: sql<number>`coalesce(max(${messageRevision.revision}), 0)::int` })
    .from(messageRevision)
    .where(eq(messageRevision.messageId, row.id));
  await tx.insert(messageRevision).values({
    messageId: row.id,
    revision: (latest?.revision ?? 0) + 1,
    body: row.body,
    createdAt: clock,
  });
}

const isGone = (row: MessageRow) => row.deletedAt !== null || row.moderationState === 'removed';

// Edit -------------------------------------------------------------------------------------------

export interface EditMessageInput {
  messageId: string;
  editorId: string;
  /** Already validated and normalised by the shared contract. */
  body: string;
  now?: Date;
}

/**
 * Edits a message (MSG-02): its author only, within 24 hours, while still allowed to post there.
 * Mentions are worked out again; `newMentions` lists people mentioned for the first time.
 */
export async function editMessage(
  db: Database,
  input: EditMessageInput,
): Promise<
  MessageActionResult<{ changed: boolean; newMentions: string[]; notifications: NotificationRow[] }>
> {
  const clock = dbNow(input.now);
  return db.transaction(async (tx) => {
    const locked = await lockMessage(tx, input.messageId);
    if (!locked) return fail({ reason: 'message_not_found' });
    const { message: row } = locked;
    if (row.authorId !== input.editorId) return fail({ reason: 'not_author' });
    if (isGone(row)) return fail({ reason: 'deleted' });
    // The 24-hour window is measured on the database clock (D-027).
    const [age] = await tx
      .select({
        tooLate: sql<boolean>`${message.createdAt} + make_interval(secs => ${LIMITS.message.editWindowMs / 1000}) <= ${clock}`,
      })
      .from(message)
      .where(eq(message.id, row.id));
    if (age?.tooLate) return fail({ reason: 'too_late' });
    const refusal = await checkCanPost(tx, {
      conversationId: locked.conversation.id,
      conversationKind: locked.conversation.kind,
      archived: locked.conversation.archived,
      authorId: input.editorId,
      replyToId: null,
      clock,
    });
    if (refusal) return fail(refusal);
    if (row.body === input.body)
      return {
        ok: true as const,
        message: row,
        changed: false,
        newMentions: [],
        notifications: [],
      };

    await keepRevision(tx, row, clock);
    const versionSeq = await nextEventSeq(tx, locked);
    const [updated] = await tx
      .update(message)
      .set({ body: input.body, editedAt: input.now ?? clock, versionSeq })
      .where(eq(message.id, row.id))
      .returning();
    if (!updated) throw new Error('UPDATE ... RETURNING returned no row');

    const before = new Set(
      (
        await tx
          .select({ userId: mention.userId })
          .from(mention)
          .where(eq(mention.messageId, row.id))
      ).map((m) => m.userId),
    );
    await tx.delete(mention).where(eq(mention.messageId, row.id));
    const now = await saveMentions(tx, updated);
    const newMentions = now.filter((id) => !before.has(id));
    // Only people mentioned for the first time hear about an edit.
    const notifications = await notifyForMessage(tx, updated, newMentions, {
      conversationKind: 'room',
      includeReplyAndDm: false,
    });
    return { ok: true as const, message: updated, changed: true, newMentions, notifications };
  });
}

// Delete -----------------------------------------------------------------------------------------

export interface DeleteMessageInput {
  messageId: string;
  actorId: string;
  now?: Date;
}

/**
 * Deletes a message (MSG-03): by its author, or by a room moderator or owner who outranks the
 * author, or by a site admin. The row stays as a tombstone ("Message deleted") so order and
 * replies stay intact; its text, reactions, mentions and pictures go. A moderator's deletion is recorded in
 * the audit log.
 */
export async function deleteMessage(
  db: Database,
  input: DeleteMessageInput,
): Promise<MessageActionResult<{ changed: boolean; byModerator: boolean }>> {
  const clock = dbNow(input.now);
  return db.transaction(async (tx) => {
    const locked = await lockMessage(tx, input.messageId);
    if (!locked) return fail({ reason: 'message_not_found' });
    const { message: row, conversation: conv } = locked;
    if (row.deletedAt !== null)
      return { ok: true as const, message: row, changed: false, byModerator: false };

    const own = row.authorId === input.actorId;
    const [actor] = await tx
      .select({
        id: user.id,
        role: user.role,
        status: user.status,
        isAnonymous: user.isAnonymous,
        emailVerified: user.emailVerified,
        onboardedAt: user.onboardedAt,
      })
      .from(user)
      .where(eq(user.id, input.actorId));
    if (!actor) return fail({ reason: 'message_not_found' });
    const roles = await tx
      .select({
        userId: conversationMember.userId,
        role: conversationMember.role,
        muted: sql<boolean>`coalesce(${conversationMember.mutedUntil} > ${clock}, false)`,
      })
      .from(conversationMember)
      .where(
        and(
          eq(conversationMember.conversationId, conv.id),
          inArray(conversationMember.userId, [input.actorId, row.authorId]),
        ),
      );
    const actorMembership = roles.find((r) => r.userId === input.actorId);
    const authorMembership = roles.find((r) => r.userId === row.authorId);
    const [ban] = await tx
      .select({ one: sql<number>`1` })
      .from(roomBan)
      .where(
        and(
          eq(roomBan.conversationId, conv.id),
          eq(roomBan.userId, input.actorId),
          sql`(${roomBan.expiresAt} is null or ${roomBan.expiresAt} > ${clock})`,
        ),
      );
    const [author] = await tx
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, row.authorId));
    const decision = decide(
      {
        id: actor.id,
        role: actor.role,
        status: actor.status,
        isGuest: actor.isAnonymous,
        emailVerified: actor.emailVerified,
        onboarded: actor.onboardedAt !== null,
      },
      {
        kind: conv.kind,
        visibility: conv.visibility,
        membership: actorMembership
          ? { role: actorMembership.role, muted: actorMembership.muted }
          : null,
        bannedHere: ban !== undefined,
      },
      own ? 'message.delete_own' : 'message.delete_any',
      {
        userId: row.authorId,
        role: authorMembership?.role ?? null,
        isAdmin: author?.role === 'admin',
      },
    );
    if (!decision.allowed) return fail({ reason: 'denied', deny: decision.reason });

    if (row.body !== '') await keepRevision(tx, row, clock);
    const versionSeq = await nextEventSeq(tx, locked);
    const [updated] = await tx
      .update(message)
      .set({
        body: '',
        deletedAt: input.now ?? clock,
        deletedBy: own ? 'author' : 'moderator',
        versionSeq,
      })
      .where(eq(message.id, row.id))
      .returning();
    if (!updated) throw new Error('UPDATE ... RETURNING returned no row');
    await tx.delete(reaction).where(eq(reaction.messageId, row.id));
    await tx.delete(mention).where(eq(mention.messageId, row.id));
    await removeMessageAttachments(tx, row.id);
    if (!own) {
      await tx.insert(moderationAction).values({
        id: newId(),
        actorId: input.actorId,
        action: 'remove_message',
        conversationId: conv.id,
        messageId: row.id,
        targetUserId: row.authorId,
        reason:
          actor.role === 'admin'
            ? 'Deleted by a site administrator'
            : 'Deleted by a room moderator',
        metadata: { tombstone: true },
      });
    }
    return { ok: true as const, message: updated, changed: true, byModerator: !own };
  });
}

// Reactions ---------------------------------------------------------------------------------------

/** Reactions per message, each emoji in the order it was first used. */
export async function listReactions(
  db: Queryable,
  messageIds: readonly string[],
): Promise<Map<string, ReactionSummary[]>> {
  const result = new Map<string, ReactionSummary[]>();
  if (messageIds.length === 0) return result;
  const rows = await db
    .select({ messageId: reaction.messageId, emoji: reaction.emoji, userId: reaction.userId })
    .from(reaction)
    .where(inArray(reaction.messageId, [...new Set(messageIds)]))
    .orderBy(asc(reaction.createdAt), asc(reaction.userId));
  for (const row of rows) {
    const list = result.get(row.messageId) ?? [];
    const entry = list.find((r) => r.emoji === row.emoji);
    if (entry) entry.userIds.push(row.userId);
    else list.push({ emoji: row.emoji, userIds: [row.userId] });
    result.set(row.messageId, list);
  }
  return result;
}

export interface ToggleReactionInput {
  messageId: string;
  userId: string;
  /** Already checked against the shared allow-list. */
  emoji: string;
  now?: Date;
}

/**
 * Adds a reaction, or takes it away if it is already there (MSG-05). Members who may post may
 * react; a message can carry at most 20 different emoji.
 */
export async function toggleReaction(
  db: Database,
  input: ToggleReactionInput,
): Promise<MessageActionResult<{ added: boolean; reactions: ReactionSummary[] }>> {
  const clock = dbNow(input.now);
  return db.transaction(async (tx) => {
    const locked = await lockMessage(tx, input.messageId);
    if (!locked) return fail({ reason: 'message_not_found' });
    if (isGone(locked.message)) return fail({ reason: 'deleted' });
    const refusal = await checkCanPost(tx, {
      conversationId: locked.conversation.id,
      conversationKind: locked.conversation.kind,
      archived: locked.conversation.archived,
      authorId: input.userId,
      replyToId: null,
      clock,
    });
    if (refusal) return fail(refusal);

    const mine = and(
      eq(reaction.messageId, input.messageId),
      eq(reaction.userId, input.userId),
      eq(reaction.emoji, input.emoji),
    );
    const removed = await tx.delete(reaction).where(mine).returning({ emoji: reaction.emoji });
    const added = removed.length === 0;
    if (added) {
      const [distinct] = await tx
        .select({
          total: sql<number>`count(distinct ${reaction.emoji})::int`,
          has: sql<boolean>`bool_or(${reaction.emoji} = ${input.emoji})`,
        })
        .from(reaction)
        .where(eq(reaction.messageId, input.messageId));
      if (!distinct?.has && (distinct?.total ?? 0) >= LIMITS.message.distinctReactionsMax) {
        return fail({ reason: 'too_many_reactions' });
      }
      await tx.insert(reaction).values({
        messageId: input.messageId,
        userId: input.userId,
        emoji: input.emoji,
        createdAt: clock,
      });
    }
    const versionSeq = await nextEventSeq(tx, locked);
    const [updated] = await tx
      .update(message)
      .set({ versionSeq })
      .where(eq(message.id, input.messageId))
      .returning();
    if (!updated) throw new Error('UPDATE ... RETURNING returned no row');
    const reactions = (await listReactions(tx, [input.messageId])).get(input.messageId) ?? [];
    return { ok: true as const, message: updated, added, reactions };
  });
}

/** Edit history of a message, newest first (for moderators reviewing a report). */
export async function listRevisions(
  db: Queryable,
  messageId: string,
): Promise<{ revision: number; body: string; createdAt: Date }[]> {
  return db
    .select({
      revision: messageRevision.revision,
      body: messageRevision.body,
      createdAt: messageRevision.createdAt,
    })
    .from(messageRevision)
    .where(eq(messageRevision.messageId, messageId))
    .orderBy(sql`${messageRevision.revision} desc`);
}
