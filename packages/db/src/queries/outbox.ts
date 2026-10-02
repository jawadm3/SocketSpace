/**
 * The realtime outbox: internal events the web app could not deliver straight away
 * (docs/architecture/data-model.md, "Operations").
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { Queryable } from '../client';
import { realtimeOutbox } from '../schema/ops';

export interface OutboxEntry {
  id: string;
  eventId: string;
  type: string;
  payload: unknown;
}

/** The oldest undelivered events, at most `limit`. */
export async function listPendingOutbox(db: Queryable, limit = 100): Promise<OutboxEntry[]> {
  return db
    .select({
      id: realtimeOutbox.id,
      eventId: realtimeOutbox.eventId,
      type: realtimeOutbox.type,
      payload: realtimeOutbox.payload,
    })
    .from(realtimeOutbox)
    .where(isNull(realtimeOutbox.deliveredAt))
    .orderBy(asc(realtimeOutbox.createdAt))
    .limit(limit);
}

export async function markOutboxDelivered(db: Queryable, id: string): Promise<void> {
  await db
    .update(realtimeOutbox)
    .set({ deliveredAt: new Date() })
    .where(and(eq(realtimeOutbox.id, id), isNull(realtimeOutbox.deliveredAt)));
}

export async function markOutboxFailed(db: Queryable, id: string, error: string): Promise<void> {
  await db
    .update(realtimeOutbox)
    .set({ attempts: sql`${realtimeOutbox.attempts} + 1`, lastError: error.slice(0, 500) })
    .where(eq(realtimeOutbox.id, id));
}
