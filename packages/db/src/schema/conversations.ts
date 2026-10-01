/**
 * Conversations (rooms and DMs), their members, bans and invites.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  conversationKindEnum,
  conversationVisibilityEnum,
  createdAtColumn,
  idColumn,
  memberRoleEnum,
  notifyLevelEnum,
  tstz,
  updatedAtColumn,
} from './_common';
import { user } from './auth';

export const conversation = pgTable(
  'conversation',
  {
    id: idColumn(),
    kind: conversationKindEnum('kind').notNull(),
    /** DMs are always private. */
    visibility: conversationVisibilityEnum('visibility').notNull(),
    /** Rooms only: used in URLs. Unique regardless of letter case. */
    slug: text('slug'),
    name: text('name'),
    topic: text('topic'),
    /** DMs only: the two user IDs sorted and joined with ':'. Guarantees one DM per pair. */
    dmKey: text('dm_key').unique(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    /**
     * The per-conversation counter. Every change (new message, edit, delete, reaction) takes the
     * next number, so "what did I miss?" is "everything after number N".
     */
    lastEventSeq: bigint('last_event_seq', { mode: 'number' }).notNull().default(0),
    lastMessageAt: tstz('last_message_at'),
    memberCount: integer('member_count').notNull().default(0),
    archivedAt: tstz('archived_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('conversation_slug_lower_uq').on(sql`lower(${t.slug})`),
    index('conversation_last_message_at_idx').on(t.lastMessageAt),
    check(
      'conversation_room_fields',
      sql`(${t.kind} = 'room' AND ${t.slug} IS NOT NULL AND ${t.name} IS NOT NULL AND ${t.dmKey} IS NULL)
        OR (${t.kind} = 'dm' AND ${t.slug} IS NULL AND ${t.dmKey} IS NOT NULL AND ${t.visibility} = 'private')`,
    ),
    check(
      'conversation_slug_format',
      sql`${t.slug} IS NULL OR ${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'`,
    ),
    check('conversation_name_length', sql`${t.name} IS NULL OR char_length(${t.name}) <= 50`),
    check('conversation_topic_length', sql`${t.topic} IS NULL OR char_length(${t.topic}) <= 200`),
    check('conversation_seq_nonnegative', sql`${t.lastEventSeq} >= 0`),
  ],
);

export const conversationMember = pgTable(
  'conversation_member',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('member'),
    /** Highest message `seq` this member has read: drives unread counts and "Seen". */
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    /** DMs only: highest `seq` a device of this member has received: drives "Delivered". */
    lastDeliveredSeq: bigint('last_delivered_seq', { mode: 'number' }).notNull().default(0),
    notifyLevel: notifyLevelEnum('notify_level').notNull().default('all'),
    /** Set by room moderators: cannot post until then. */
    mutedUntil: tstz('muted_until'),
    joinedAt: tstz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index('conversation_member_user_id_idx').on(t.userId),
  ],
);

/** Room-level bans by room owners or moderators. */
export const roomBan = pgTable(
  'room_ban',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    bannedBy: uuid('banned_by').references(() => user.id, { onDelete: 'set null' }),
    reason: text('reason').notNull().default(''),
    /** Null means permanent. */
    expiresAt: tstz('expires_at'),
    createdAt: createdAtColumn(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
);

export const invite = pgTable(
  'invite',
  {
    id: idColumn(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    /** SHA-256 (hex) of a random 128-bit code. The code itself is never stored. */
    codeHash: text('code_hash').notNull().unique(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    expiresAt: tstz('expires_at'),
    maxUses: integer('max_uses'),
    useCount: integer('use_count').notNull().default(0),
    revokedAt: tstz('revoked_at'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('invite_conversation_id_idx').on(t.conversationId),
    check(
      'invite_uses',
      sql`${t.maxUses} IS NULL OR (${t.maxUses} > 0 AND ${t.useCount} <= ${t.maxUses})`,
    ),
  ],
);
