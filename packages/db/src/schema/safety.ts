/**
 * Random-mode metadata, reports, automatic flags, the moderation audit log, sanctions and network
 * bans.
 *
 * Random-mode message text is never stored (D-017): `random_session` holds metadata only, and the
 * only place random-mode text can appear is a report's server-captured `evidence`.
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';

import {
  createdAtColumn,
  flagSeverityEnum,
  flagSourceEnum,
  idColumn,
  moderationActionKindEnum,
  randomEndReasonEnum,
  reportReasonEnum,
  reportStatusEnum,
  reportTargetEnum,
  sanctionKindEnum,
  sanctionScopeEnum,
  tstz,
} from './_common';
import { user } from './auth';
import { conversation } from './conversations';
import { message } from './messages';

export const randomSession = pgTable(
  'random_session',
  {
    id: idColumn(),
    startedAt: tstz('started_at').notNull().defaultNow(),
    endedAt: tstz('ended_at'),
    endReason: randomEndReasonEnum('end_reason'),
    participantA: uuid('participant_a').references(() => user.id, { onDelete: 'set null' }),
    participantB: uuid('participant_b').references(() => user.id, { onDelete: 'set null' }),
    sharedInterestCount: smallint('shared_interest_count').notNull().default(0),
  },
  (t) => [
    index('random_session_started_at_idx').on(t.startedAt),
    index('random_session_participant_a_idx').on(t.participantA),
    index('random_session_participant_b_idx').on(t.participantB),
  ],
);

export const report = pgTable(
  'report',
  {
    id: idColumn(),
    reporterId: uuid('reporter_id').references(() => user.id, { onDelete: 'set null' }),
    targetType: reportTargetEnum('target_type').notNull(),
    targetUserId: uuid('target_user_id').references(() => user.id, { onDelete: 'set null' }),
    messageId: uuid('message_id').references(() => message.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversation.id, {
      onDelete: 'set null',
    }),
    randomSessionId: uuid('random_session_id').references(() => randomSession.id, {
      onDelete: 'set null',
    }),
    reason: reportReasonEnum('reason').notNull(),
    details: text('details').notNull().default(''),
    /** Snapshot taken by the server, never supplied by the reporter. */
    evidence: jsonb('evidence'),
    status: reportStatusEnum('status').notNull().default('open'),
    assignedTo: uuid('assigned_to').references(() => user.id, { onDelete: 'set null' }),
    resolutionNote: text('resolution_note'),
    createdAt: createdAtColumn(),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [
    index('report_status_created_idx').on(t.status, t.createdAt),
    index('report_target_user_idx').on(t.targetUserId, t.createdAt),
    check('report_details_length', sql`char_length(${t.details}) <= 1000`),
  ],
);

/** Automatic flags from the word list or AI moderation. */
export const contentFlag = pgTable(
  'content_flag',
  {
    id: idColumn(),
    source: flagSourceEnum('source').notNull(),
    severity: flagSeverityEnum('severity').notNull(),
    categories: text('categories')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    messageId: uuid('message_id').references(() => message.id, { onDelete: 'cascade' }),
    randomSessionId: uuid('random_session_id').references(() => randomSession.id, {
      onDelete: 'set null',
    }),
    /** The flagged message only. */
    excerpt: text('excerpt').notNull().default(''),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    reviewedBy: uuid('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: tstz('reviewed_at'),
    outcome: text('outcome'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('content_flag_unreviewed_idx')
      .on(t.createdAt)
      .where(sql`${t.reviewedAt} IS NULL`),
  ],
);

/**
 * The moderation audit log. **Append-only:** a database trigger (migration 0001) rejects every
 * UPDATE, and rejects DELETE for rows younger than the one-year retention period.
 * The ID columns deliberately have no foreign keys: a log entry must survive the deletion of the
 * thing it describes, and a foreign-key action would need an UPDATE, which the trigger forbids.
 */
export const moderationAction = pgTable(
  'moderation_action',
  {
    id: idColumn(),
    actorId: uuid('actor_id').notNull(),
    action: moderationActionKindEnum('action').notNull(),
    targetUserId: uuid('target_user_id'),
    messageId: uuid('message_id'),
    reportId: uuid('report_id'),
    conversationId: uuid('conversation_id'),
    /** Required: every action carries a statement of reasons. */
    reason: text('reason').notNull(),
    expiresAt: tstz('expires_at'),
    metadata: jsonb('metadata'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('moderation_action_created_idx').on(t.createdAt),
    index('moderation_action_target_idx').on(t.targetUserId, t.createdAt),
    check('moderation_action_reason_present', sql`char_length(btrim(${t.reason})) > 0`),
  ],
);

/** Active penalties, for fast checks on connect and on every write. */
export const userSanction = pgTable(
  'user_sanction',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: sanctionKindEnum('kind').notNull(),
    scope: sanctionScopeEnum('scope').notNull(),
    reason: text('reason').notNull(),
    actionId: uuid('action_id').references(() => moderationAction.id, { onDelete: 'set null' }),
    startsAt: tstz('starts_at').notNull().defaultNow(),
    /** Null means permanent. */
    expiresAt: tstz('expires_at'),
    liftedAt: tstz('lifted_at'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('user_sanction_active_idx')
      .on(t.userId)
      .where(sql`${t.liftedAt} IS NULL`),
  ],
);

/** Bans by hashed IP address (HMAC with a secret key; raw IPs are never stored). */
export const networkBan = pgTable(
  'network_ban',
  {
    id: idColumn(),
    ipHash: text('ip_hash').notNull(),
    reason: text('reason').notNull(),
    /** At most 90 days after creation. */
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [index('network_ban_ip_hash_idx').on(t.ipHash)],
);
