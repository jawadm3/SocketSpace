/**
 * Messages and everything attached to them: revisions, reactions, mentions, attachments and link
 * previews.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import {
  attachmentStatusEnum,
  createdAtColumn,
  deletedByEnum,
  idColumn,
  linkPreviewStatusEnum,
  messageKindEnum,
  moderationStateEnum,
  tstz,
  tsvector,
} from './_common';
import { user } from './auth';
import { conversation } from './conversations';

export const message = pgTable(
  'message',
  {
    id: idColumn(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    /** Taken from the conversation counter when the message is created. */
    seq: bigint('seq', { mode: 'number' }).notNull(),
    /** Counter value of the latest change to this message (edit, delete, reaction). */
    versionSeq: bigint('version_seq', { mode: 'number' }).notNull(),
    /** Accounts are tombstoned ("Deleted user"), never hard-deleted while they have messages. */
    authorId: uuid('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    /** Generated in the browser. Unique per author, so a re-send returns the original message. */
    clientId: uuid('client_id').notNull(),
    kind: messageKindEnum('kind').notNull().default('text'),
    /** Markdown-lite source text, never HTML. Cleared when the message is deleted. */
    body: text('body').notNull().default(''),
    /** Full-text search document ('simple' configuration: language-neutral). */
    bodyTsv: tsvector('body_tsv').generatedAlwaysAs(sql`to_tsvector('simple'::regconfig, body)`),
    replyToId: uuid('reply_to_id').references((): AnyPgColumn => message.id, {
      onDelete: 'set null',
    }),
    editedAt: tstz('edited_at'),
    deletedAt: tstz('deleted_at'),
    deletedBy: deletedByEnum('deleted_by'),
    moderationState: moderationStateEnum('moderation_state').notNull().default('visible'),
    /** Highest word-list severity found (0 to 3). */
    filterSeverity: smallint('filter_severity').notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique('message_conversation_seq_uq').on(t.conversationId, t.seq),
    unique('message_author_client_uq').on(t.authorId, t.clientId),
    index('message_conversation_version_idx').on(t.conversationId, t.versionSeq),
    index('message_body_tsv_idx').using('gin', t.bodyTsv),
    check('message_body_length', sql`char_length(${t.body}) <= 4000`),
    check('message_seq_positive', sql`${t.seq} > 0 AND ${t.versionSeq} >= ${t.seq}`),
    check('message_filter_severity', sql`${t.filterSeverity} BETWEEN 0 AND 3`),
    check('message_deleted_consistent', sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL)`),
  ],
);

/** Previous bodies after edits, kept 30 days for moderation. */
export const messageRevision = pgTable(
  'message_revision',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    body: text('body').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.revision] })],
);

export const reaction = pgTable(
  'reaction',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Must be in the shared allow-list (checked by the contract before it reaches here). */
    emoji: text('emoji').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
    check('reaction_emoji_length', sql`char_length(${t.emoji}) BETWEEN 1 AND 16`),
  ],
);

/** Parsed on the server from `@nickname` tokens. */
export const mention = pgTable(
  'mention',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index('mention_user_id_idx').on(t.userId),
  ],
);

export const attachment = pgTable(
  'attachment',
  {
    id: idColumn(),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Null until the message is sent. Pending uploads older than 24 hours are deleted. */
    messageId: uuid('message_id').references(() => message.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    thumbKey: text('thumb_key'),
    /** Always image/webp after re-encoding. */
    mime: text('mime').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    status: attachmentStatusEnum('status').notNull().default('pending'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('attachment_message_id_idx').on(t.messageId),
    index('attachment_uploader_status_idx').on(t.uploaderId, t.status),
  ],
);

/** Cache of text-only link previews, keyed by a hash of the normalised URL. */
export const linkPreview = pgTable('link_preview', {
  urlHash: text('url_hash').primaryKey(),
  url: text('url').notNull(),
  title: text('title'),
  description: text('description'),
  siteName: text('site_name'),
  status: linkPreviewStatusEnum('status').notNull(),
  fetchedAt: tstz('fetched_at').notNull().defaultNow(),
  expiresAt: tstz('expires_at').notNull(),
});

export const messageLink = pgTable(
  'message_link',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    urlHash: text('url_hash')
      .notNull()
      .references(() => linkPreview.urlHash, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.urlHash] })],
);
