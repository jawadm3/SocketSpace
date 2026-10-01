/**
 * Blocks, contacts, contact requests and notifications.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import {
  contactRequestStatusEnum,
  contactSourceEnum,
  createdAtColumn,
  idColumn,
  notificationTypeEnum,
  tstz,
} from './_common';
import { user } from './auth';
import { conversation } from './conversations';
import { message } from './messages';

/** Checked when starting or sending DMs, matching in random mode, and mentioning. */
export const block = pgTable(
  'block',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index('block_blocked_id_idx').on(t.blockedId),
    check('block_not_self', sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

/** Stored in both directions. */
export const contact = pgTable(
  'contact',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    source: contactSourceEnum('source').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.contactId] }),
    check('contact_not_self', sql`${t.userId} <> ${t.contactId}`),
  ],
);

export const contactRequest = pgTable(
  'contact_request',
  {
    id: idColumn(),
    fromId: uuid('from_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: contactRequestStatusEnum('status').notNull().default('pending'),
    source: contactSourceEnum('source').notNull(),
    createdAt: createdAtColumn(),
    respondedAt: tstz('responded_at'),
  },
  (t) => [
    // At most one pending request per direction.
    uniqueIndex('contact_request_pending_uq')
      .on(t.fromId, t.toId)
      .where(sql`${t.status} = 'pending'`),
    index('contact_request_to_id_idx').on(t.toId),
    check('contact_request_not_self', sql`${t.fromId} <> ${t.toId}`),
  ],
);

export const notification = pgTable(
  'notification',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    conversationId: uuid('conversation_id').references(() => conversation.id, {
      onDelete: 'cascade',
    }),
    messageId: uuid('message_id').references(() => message.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    readAt: tstz('read_at'),
  },
  (t) => [
    index('notification_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('notification_user_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} IS NULL`),
  ],
);
