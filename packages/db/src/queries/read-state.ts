/**
 * Read state and unread counts (RT-05). Each membership keeps `last_read_seq`, the highest
 * message number that person has read; unread messages are other people's messages after it
 * (deleted ones do not count).
 */
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';

import type { Database, Queryable } from '../client';
import { conversation, conversationMember } from '../schema/conversations';
import { message } from '../schema/messages';

async function unreadAfter(
  db: Queryable,
  conversationId: string,
  userId: string,
  lastReadSeq: number,
): Promise<number> {
  const [row] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        gt(message.seq, lastReadSeq),
        ne(message.authorId, userId),
        isNull(message.deletedAt),
      ),
    );
  return row?.unread ?? 0;
}

export type MarkReadResult =
  | { ok: true; lastReadSeq: number; unread: number; moved: boolean }
  | { ok: false; reason: 'not_member' };

/**
 * Marks a conversation read up to `seq`. The marker only moves forward, and never past the
 * conversation's latest event, so a client cannot claim to have read the future.
 */
export async function markRead(
  db: Database,
  input: { conversationId: string; userId: string; seq: number },
): Promise<MarkReadResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ lastReadSeq: conversationMember.lastReadSeq })
      .from(conversationMember)
      .where(
        and(
          eq(conversationMember.conversationId, input.conversationId),
          eq(conversationMember.userId, input.userId),
        ),
      )
      .for('update');
    if (!before) return { ok: false as const, reason: 'not_member' as const };
    const [updated] = await tx
      .update(conversationMember)
      .set({
        lastReadSeq: sql`greatest(${conversationMember.lastReadSeq}, least(${input.seq}, (select ${conversation.lastEventSeq} from ${conversation} where ${conversation.id} = ${input.conversationId})))`,
      })
      .where(
        and(
          eq(conversationMember.conversationId, input.conversationId),
          eq(conversationMember.userId, input.userId),
        ),
      )
      .returning({ lastReadSeq: conversationMember.lastReadSeq });
    const lastReadSeq = updated?.lastReadSeq ?? before.lastReadSeq;
    return {
      ok: true as const,
      lastReadSeq,
      unread: await unreadAfter(tx, input.conversationId, input.userId, lastReadSeq),
      moved: lastReadSeq !== before.lastReadSeq,
    };
  });
}

/** Unread counts for every conversation a person belongs to (the sidebar). */
export async function unreadCounts(db: Queryable, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      conversationId: conversationMember.conversationId,
      unread: sql<number>`count(${message.id})::int`,
    })
    .from(conversationMember)
    .leftJoin(
      message,
      and(
        eq(message.conversationId, conversationMember.conversationId),
        gt(message.seq, conversationMember.lastReadSeq),
        ne(message.authorId, userId),
        isNull(message.deletedAt),
      ),
    )
    .where(eq(conversationMember.userId, userId))
    .groupBy(conversationMember.conversationId);
  return new Map(rows.map((r) => [r.conversationId, r.unread]));
}
