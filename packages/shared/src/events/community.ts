/**
 * Community-mode events (realtime-protocol.md, "Events: community mode").
 * Every client payload is a strict object: unknown fields are refused, not ignored.
 */
import { z } from 'zod';

import {
  CONVERSATION_KINDS,
  CONVERSATION_VISIBILITIES,
  DELETED_BY,
  MEMBER_ROLES,
  MESSAGE_KINDS,
  MODERATION_STATES,
  NOTIFICATION_TYPES,
} from '../domain';
import { REACTION_EMOJI } from '../emoji';
import { LIMITS } from '../limits';
import { isoDateTime, messageBody, seqNumber, uuid } from '../primitives';
import { publicUserSchema } from '../profile';

// Shared payload pieces -------------------------------------------------------------------------

export const reactionSummarySchema = z.strictObject({
  emoji: z.enum(REACTION_EMOJI),
  userIds: z.array(uuid),
});

/** A message as browsers receive it. */
export const messageWireSchema = z.strictObject({
  id: uuid,
  conversationId: uuid,
  /** Position in the conversation, fixed when the message was created. */
  seq: seqNumber,
  /** Counter value of the latest change to this message (edit, delete, reaction). */
  eventSeq: seqNumber,
  authorId: uuid,
  clientId: uuid,
  kind: z.enum(MESSAGE_KINDS),
  /** Markdown-lite source text. Empty when deleted or removed by a moderator. */
  body: z.string(),
  replyToId: uuid.nullable(),
  editedAt: isoDateTime.nullable(),
  deletedAt: isoDateTime.nullable(),
  deletedBy: z.enum(DELETED_BY).nullable(),
  moderationState: z.enum(MODERATION_STATES),
  createdAt: isoDateTime,
  reactions: z.array(reactionSummarySchema),
});

export type MessageWire = z.infer<typeof messageWireSchema>;

export const conversationWireSchema = z.strictObject({
  id: uuid,
  kind: z.enum(CONVERSATION_KINDS),
  visibility: z.enum(CONVERSATION_VISIBILITIES),
  slug: z.string().nullable(),
  name: z.string().nullable(),
  topic: z.string().nullable(),
  lastEventSeq: seqNumber,
  memberCount: z.number().int().nonnegative(),
});

export const memberWireSchema = z.strictObject({
  user: publicUserSchema,
  role: z.enum(MEMBER_ROLES),
  joinedAt: isoDateTime,
});

export const notificationWireSchema = z.strictObject({
  id: uuid,
  type: z.enum(NOTIFICATION_TYPES),
  conversationId: uuid.nullable(),
  messageId: uuid.nullable(),
  actor: publicUserSchema.nullable(),
  createdAt: isoDateTime,
  readAt: isoDateTime.nullable(),
});

export const PRESENCE_STATUSES = ['online', 'away', 'dnd', 'offline'] as const;

// Client → server payloads ----------------------------------------------------------------------

export const messageSendSchema = z.strictObject({
  conversationId: uuid,
  clientId: uuid,
  body: messageBody,
  replyToId: uuid.optional(),
  attachmentIds: z.array(uuid).max(LIMITS.message.attachmentsMax).optional(),
});

export const messageEditSchema = z.strictObject({
  messageId: uuid,
  body: messageBody,
});

export const messageDeleteSchema = z.strictObject({ messageId: uuid });

export const reactionToggleSchema = z.strictObject({
  messageId: uuid,
  emoji: z.enum(REACTION_EMOJI),
});

export const typingSetSchema = z.strictObject({
  conversationId: uuid,
  typing: z.boolean(),
});

export const readUpdateSchema = z.strictObject({
  conversationId: uuid,
  seq: seqNumber,
});

export const deliveryAckSchema = z.strictObject({
  items: z
    .array(z.strictObject({ conversationId: uuid, seq: seqNumber }))
    .min(1)
    .max(LIMITS.sync.cursorsMax),
});

export const syncRequestSchema = z.strictObject({
  cursors: z
    .array(z.strictObject({ conversationId: uuid, afterEventSeq: seqNumber }))
    .min(1)
    .max(LIMITS.sync.cursorsMax)
    .refine(
      (cursors) => new Set(cursors.map((c) => c.conversationId)).size === cursors.length,
      'Each conversation may appear only once',
    ),
});

export const presenceSetSchema = z.strictObject({
  status: z.enum(['online', 'away', 'dnd']),
});

// Acknowledgement data --------------------------------------------------------------------------

export const messageAckSchema = z.strictObject({ message: messageWireSchema });
export const messageDeleteAckSchema = z.strictObject({ messageId: uuid, eventSeq: seqNumber });
export const reactionAckSchema = z.strictObject({
  messageId: uuid,
  reactions: z.array(reactionSummarySchema),
});
export const readAckSchema = z.strictObject({ unread: z.number().int().nonnegative() });

export const syncEventSchema = z.strictObject({
  type: z.literal('message'),
  message: messageWireSchema,
});

export const syncAckSchema = z.strictObject({
  results: z.array(
    z.strictObject({
      conversationId: uuid,
      events: z.array(syncEventSchema),
      /** Too much was missed: reload the latest page over HTTP instead. */
      reset: z.boolean().optional(),
    }),
  ),
});

export const emptyAckSchema = z.strictObject({});

// Server → client payloads ----------------------------------------------------------------------

export const PROTOCOL_VERSION = 1;

export const serverHelloSchema = z.strictObject({
  protocolVersion: z.number().int().positive(),
  serverTime: isoDateTime,
  userId: uuid,
});

export const messageNewSchema = z.strictObject({ message: messageWireSchema, eventSeq: seqNumber });
export const messageUpdatedSchema = messageNewSchema;
export const messageDeletedSchema = z.strictObject({
  conversationId: uuid,
  messageId: uuid,
  eventSeq: seqNumber,
});
export const reactionUpdatedSchema = z.strictObject({
  conversationId: uuid,
  messageId: uuid,
  reactions: z.array(reactionSummarySchema),
  eventSeq: seqNumber,
});
export const typingEventSchema = z.strictObject({
  conversationId: uuid,
  userId: uuid,
  typing: z.boolean(),
});
export const readUpdatedSchema = z.strictObject({
  conversationId: uuid,
  userId: uuid,
  seq: seqNumber,
});
export const deliveryUpdatedSchema = readUpdatedSchema;
export const presenceEventSchema = z.strictObject({
  userId: uuid,
  status: z.enum(PRESENCE_STATUSES),
  lastSeenAt: isoDateTime.nullable(),
});
export const conversationJoinedSchema = z.strictObject({ conversation: conversationWireSchema });
export const conversationLeftSchema = z.strictObject({ conversationId: uuid });
export const conversationUpdatedSchema = conversationJoinedSchema;
export const memberEventSchema = z.strictObject({ conversationId: uuid, member: memberWireSchema });
export const memberLeftSchema = z.strictObject({ conversationId: uuid, userId: uuid });
export const notificationNewSchema = z.strictObject({ notification: notificationWireSchema });
/** Told only to the person concerned: a room moderator muted, unmuted, removed or banned them. */
export const roomNoticeSchema = z.strictObject({
  conversationId: uuid,
  kind: z.enum(['muted', 'unmuted', 'removed', 'banned']),
  reason: z.string().nullable(),
  until: isoDateTime.nullable(),
});
/** Someone's nickname or avatar changed. Nickname only: it goes to many viewers at once. */
export const userUpdatedSchema = z.strictObject({ user: publicUserSchema });
export const moderationNoticeSchema = z.strictObject({
  kind: z.enum(['warned', 'muted', 'suspended', 'banned']),
  reason: z.string(),
  until: isoDateTime.nullable(),
});
/** Sent before the server disconnects a socket on purpose, so the client knows why. */
export const sessionEndedSchema = z.strictObject({
  reason: z.enum(['revoked', 'banned', 'suspended', 'deleted', 'server_shutdown', 'abuse']),
  /** For server_shutdown: reconnecting after this delay is expected to work. */
  reconnectAfterMs: z.number().int().nonnegative().optional(),
});
