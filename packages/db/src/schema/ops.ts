/**
 * Operational tables: HTTP rate limits, the realtime outbox and privacy-respecting daily metrics.
 */
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAtColumn, idColumn, tstz } from './_common';

/** Fixed-window counters for HTTP routes on Vercel (many short-lived instances share them). */
export const httpRateLimit = pgTable(
  'http_rate_limit',
  {
    key: text('key').notNull(),
    windowStart: tstz('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/**
 * Internal events (for example "user banned") that could not be delivered to the realtime server
 * immediately. Drained when the realtime server starts and opportunistically while it is busy,
 * never on an idle timer (so idle connections do not keep the database awake).
 */
export const realtimeOutbox = pgTable(
  'realtime_outbox',
  {
    id: idColumn(),
    eventId: uuid('event_id').notNull().unique(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAtColumn(),
    deliveredAt: tstz('delivered_at'),
  },
  (t) => [index('realtime_outbox_pending_idx').on(t.createdAt)],
);

/** Aggregate counts only (for example `random_sessions_started`). No user IDs, ever. */
export const metricDaily = pgTable(
  'metric_daily',
  {
    day: date('day', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.name] })],
);
