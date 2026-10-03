/**
 * In-app notifications (NOTIF-01, MSG-06): created in the same transaction as the message that
 * causes them, so a message and its notifications are stored together or not at all.
 *
 * - **mention**: someone @mentioned you (mentions already exclude non-members, the author, and
 *   anyone who blocked the author).
 * - **reply**: someone replied to your message.
 * - **dm**: a new direct message. At most one unread "dm" notification per conversation, so a
 *   burst of messages does not flood the list.
 *
 * Nobody is notified twice for one message (a mention that is also a reply counts once), nobody
 * who blocked the author is notified, and a conversation set to "none" notifies nothing ("mentions"
 * keeps mentions and replies only).
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database, Queryable } from '../client';
import { newId } from '../schema/_common';
import { conversation, conversationMember } from '../schema/conversations';
import { message } from '../schema/messages';
import { block, notification } from '../schema/social';
import { visibleBody } from '../masking';
import type { MessageRow } from './messages';

export type NotificationRow = typeof notification.$inferSelect;
type Kind = 'mention' | 'reply' | 'dm';

/**
 * Works out and stores the notifications a message causes. `mentioned` are the people its
 * mentions reached; `includeReplyAndDm` is false for an edit (which only notifies new mentions).
 */
export async function notifyForMessage(
  tx: Queryable,
  saved: Pick<MessageRow, 'id' | 'conversationId' | 'authorId' | 'replyToId'>,
  mentioned: readonly string[],
  options: { conversationKind: 'room' | 'dm'; includeReplyAndDm: boolean },
): Promise<NotificationRow[]> {
  const wanted = new Map<string, Kind>();
  for (const id of mentioned) wanted.set(id, 'mention');

  if (options.includeReplyAndDm && saved.replyToId) {
    const [original] = await tx
      .select({ authorId: message.authorId })
      .from(message)
      .where(and(eq(message.id, saved.replyToId), isNull(message.deletedAt)));
    if (original && original.authorId !== saved.authorId && !wanted.has(original.authorId)) {
      wanted.set(original.authorId, 'reply');
    }
  }
  if (options.includeReplyAndDm && options.conversationKind === 'dm') {
    const others = await tx
      .select({ userId: conversationMember.userId })
      .from(conversationMember)
      .where(
        and(
          eq(conversationMember.conversationId, saved.conversationId),
          sql`${conversationMember.userId} <> ${saved.authorId}`,
        ),
      );
    for (const { userId } of others) if (!wanted.has(userId)) wanted.set(userId, 'dm');
  }
  if (wanted.size === 0) return [];

  // Only current members, not blocking the author, whose setting for this conversation allows it.
  const allowed = await tx
    .select({ userId: conversationMember.userId, level: conversationMember.notifyLevel })
    .from(conversationMember)
    .where(
      and(
        eq(conversationMember.conversationId, saved.conversationId),
        inArray(conversationMember.userId, [...wanted.keys()]),
        sql`not exists (select 1 from ${block}
          where ${block.blockerId} = ${conversationMember.userId}
            and ${block.blockedId} = ${saved.authorId})`,
      ),
    );
  const rows: (typeof notification.$inferInsert)[] = [];
  for (const { userId, level } of allowed) {
    const type = wanted.get(userId);
    if (!type || level === 'none' || (level === 'mentions' && type === 'dm')) continue;
    if (type === 'dm') {
      const [unread] = await tx
        .select({ id: notification.id })
        .from(notification)
        .where(
          and(
            eq(notification.userId, userId),
            eq(notification.type, 'dm'),
            eq(notification.conversationId, saved.conversationId),
            isNull(notification.readAt),
          ),
        )
        .limit(1);
      if (unread) continue;
    }
    rows.push({
      id: newId(),
      userId,
      type,
      conversationId: saved.conversationId,
      messageId: saved.id,
      actorId: saved.authorId,
    });
  }
  if (rows.length === 0) return [];
  return tx.insert(notification).values(rows).returning();
}

export interface NotificationListItem {
  id: string;
  type: NotificationRow['type'];
  createdAt: Date;
  readAt: Date | null;
  actorId: string | null;
  conversationId: string | null;
  conversationKind: 'room' | 'dm' | null;
  /** Rooms only. */
  roomSlug: string | null;
  roomName: string | null;
  messageId: string | null;
  /** The message text, or null if it was deleted since. */
  messageBody: string | null;
}

/** The newest notifications of a person, with what is needed to show and link them. */
export async function listNotifications(
  db: Queryable,
  userId: string,
  limit = 50,
): Promise<NotificationListItem[]> {
  const rows = await db
    .select({
      id: notification.id,
      type: notification.type,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
      actorId: notification.actorId,
      conversationId: notification.conversationId,
      conversationKind: conversation.kind,
      roomSlug: conversation.slug,
      roomName: conversation.name,
      messageId: notification.messageId,
      messageBody: message.body,
      messageFilterSeverity: message.filterSeverity,
      messageDeletedAt: message.deletedAt,
    })
    .from(notification)
    .leftJoin(conversation, eq(conversation.id, notification.conversationId))
    .leftJoin(message, eq(message.id, notification.messageId))
    .where(eq(notification.userId, userId))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(Math.min(limit, 100));
  return rows.map(({ messageDeletedAt, messageBody, messageFilterSeverity, ...row }) => ({
    ...row,
    messageBody:
      messageDeletedAt || messageBody === null
        ? null
        : visibleBody({ body: messageBody, filterSeverity: messageFilterSeverity ?? 0 }),
  }));
}

export async function countUnreadNotifications(db: Queryable, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
  return row?.count ?? 0;
}

/** Marks every unread notification of a person read; returns how many changed. */
export async function markAllNotificationsRead(db: Database, userId: string): Promise<number> {
  const changed = await db
    .update(notification)
    .set({ readAt: sql`now()` })
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
    .returning({ id: notification.id });
  return changed.length;
}

/** The nickname of each notification's actor is looked up by the caller (viewer-aware). */
export function actorIds(items: readonly { actorId: string | null }[]): string[] {
  return [...new Set(items.flatMap((i) => (i.actorId ? [i.actorId] : [])))];
}
