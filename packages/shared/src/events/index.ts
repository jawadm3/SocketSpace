/**
 * Every real-time event, defined once.
 *
 * `CLIENT_EVENTS` lists what browsers may send, with the schema of the payload and of the
 * acknowledgement data (or `null` for fire-and-forget events). `SERVER_EVENTS` lists what the
 * server may push. Socket.IO's TypeScript event maps are derived from these tables, so the browser
 * and the server cannot disagree about a payload's shape, and the realtime server validates every
 * incoming payload against the same schema at run time.
 */
import type { z } from 'zod';

import type { Ack } from '../errors';
import * as c from './community';
import * as r from './random';

export const CLIENT_EVENTS = {
  'message:send': { payload: c.messageSendSchema, ack: c.messageAckSchema },
  'message:edit': { payload: c.messageEditSchema, ack: c.messageAckSchema },
  'message:delete': { payload: c.messageDeleteSchema, ack: c.messageDeleteAckSchema },
  'reaction:toggle': { payload: c.reactionToggleSchema, ack: c.reactionAckSchema },
  'typing:set': { payload: c.typingSetSchema, ack: null },
  'read:update': { payload: c.readUpdateSchema, ack: c.readAckSchema },
  'delivery:ack': { payload: c.deliveryAckSchema, ack: null },
  'sync:request': { payload: c.syncRequestSchema, ack: c.syncAckSchema },
  'presence:set': { payload: c.presenceSetSchema, ack: c.emptyAckSchema },

  'random:join': { payload: r.randomJoinSchema, ack: r.randomQueuedAckSchema },
  'random:leave': { payload: r.randomLeaveSchema, ack: c.emptyAckSchema },
  'random:message': { payload: r.randomMessageSchema, ack: r.randomMessageAckSchema },
  'random:typing': { payload: r.randomTypingSchema, ack: null },
  'random:next': { payload: r.randomSessionSchema, ack: r.randomQueuedAckSchema },
  'random:end': { payload: r.randomSessionSchema, ack: c.emptyAckSchema },
  'random:report': { payload: r.randomReportSchema, ack: r.randomReportAckSchema },
  'random:block': { payload: r.randomSessionSchema, ack: c.emptyAckSchema },
  'random:offer': { payload: r.randomOfferSchema, ack: c.emptyAckSchema },
  'random:accept': { payload: r.randomOfferSchema, ack: c.emptyAckSchema },
} as const satisfies Record<string, { payload: z.ZodType; ack: z.ZodType | null }>;

export const SERVER_EVENTS = {
  'server:hello': c.serverHelloSchema,
  'session:ended': c.sessionEndedSchema,
  'message:new': c.messageNewSchema,
  'message:updated': c.messageUpdatedSchema,
  'message:deleted': c.messageDeletedSchema,
  'reaction:updated': c.reactionUpdatedSchema,
  typing: c.typingEventSchema,
  'read:updated': c.readUpdatedSchema,
  'delivery:updated': c.deliveryUpdatedSchema,
  presence: c.presenceEventSchema,
  'conversation:joined': c.conversationJoinedSchema,
  'conversation:left': c.conversationLeftSchema,
  'conversation:updated': c.conversationUpdatedSchema,
  'member:joined': c.memberEventSchema,
  'member:left': c.memberLeftSchema,
  'member:updated': c.memberEventSchema,
  'notification:new': c.notificationNewSchema,
  'moderation:notice': c.moderationNoticeSchema,
  'room:notice': c.roomNoticeSchema,
  'user:updated': c.userUpdatedSchema,

  'random:waiting': r.randomWaitingSchema,
  'random:matched': r.randomMatchedSchema,
  'random:message': r.randomMessageEventSchema,
  'random:typing': r.randomTypingEventSchema,
  'random:offered': r.randomOfferedSchema,
  'random:shared': r.randomSharedSchema,
  'random:contact-added': r.randomContactAddedSchema,
  'random:ended': r.randomEndedSchema,
  'random:suggestion': r.randomSuggestionSchema,
} as const satisfies Record<string, z.ZodType>;

export type ClientEventName = keyof typeof CLIENT_EVENTS;
export type ServerEventName = keyof typeof SERVER_EVENTS;

/** Events that expect an acknowledgement callback. */
export type AckedClientEventName = {
  [E in ClientEventName]: (typeof CLIENT_EVENTS)[E]['ack'] extends z.ZodType ? E : never;
}[ClientEventName];

/** The payload a browser sends (before validation, so before transforms such as trimming). */
export type ClientPayloadInput<E extends ClientEventName> = z.input<
  (typeof CLIENT_EVENTS)[E]['payload']
>;
/** The payload after validation, as handlers on the server receive it. */
export type ClientPayload<E extends ClientEventName> = z.output<
  (typeof CLIENT_EVENTS)[E]['payload']
>;
/** The `data` part of a successful acknowledgement. */
export type AckData<E extends AckedClientEventName> =
  (typeof CLIENT_EVENTS)[E]['ack'] extends z.ZodType
    ? z.output<(typeof CLIENT_EVENTS)[E]['ack']>
    : never;
export type ServerPayload<E extends ServerEventName> = z.output<(typeof SERVER_EVENTS)[E]>;

/** For `new Server<ClientToServerEvents, ServerToClientEvents>()` and `io<...>()` on the client. */
export type ClientToServerEvents = {
  [E in ClientEventName]: E extends AckedClientEventName
    ? (payload: ClientPayloadInput<E>, ack: (response: Ack<AckData<E>>) => void) => void
    : (payload: ClientPayloadInput<E>) => void;
};

export type ServerToClientEvents = {
  [E in ServerEventName]: (payload: ServerPayload<E>) => void;
};

export * from './community';
export * from './random';
