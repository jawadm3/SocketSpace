/**
 * Sending messages and catching up after a reconnect.
 *
 * `message:send` (MSG-01, RT-02, RECON-03): every permission is checked by the database inside the
 * same transaction that numbers the message (packages/db sendMessage). A re-send with the same
 * client ID returns the original message and is not broadcast twice.
 *
 * `sync:request` (RECON-02): everything that changed after the client's last known event number,
 * only for conversations the person belongs to.
 */
import {
  filterMemberConversations,
  listEventsSince,
  sendMessage,
  toMessageWire,
  type SendRefusal,
} from '@socketspace/db';
import { ackError, ackOk, type Ack } from '@socketspace/shared/errors';
import { LIMITS } from '@socketspace/shared/limits';

import { rooms, type HandlerContext, type IoSocket } from '../types';
import { registerHandler, type InFlight } from './define';

/** Plain-English refusals; `until` becomes `retryAfterMs` so the browser can say when. */
export function refusalToAck(refusal: SendRefusal, nowMs: number): Ack<never> {
  const after = (until: Date | null) => (until ? Math.max(0, until.getTime() - nowMs) : undefined);
  switch (refusal.reason) {
    case 'conversation_not_found':
      return ackError('NOT_FOUND', 'This conversation does not exist.');
    case 'reply_not_found':
      return ackError('NOT_FOUND', 'The message you replied to is not in this conversation.');
    case 'client_id_conflict':
      return ackError('CONFLICT', 'This message ID was already used. Please send again.');
    case 'not_member':
      return ackError('FORBIDDEN', 'You are not a member of this conversation.');
    case 'email_unverified':
      return ackError('FORBIDDEN', 'Please confirm your email address before posting.');
    case 'not_onboarded':
      return ackError('FORBIDDEN', 'Please finish setting up your profile before posting.');
    case 'guest_account':
      return ackError('FORBIDDEN', 'Guest accounts can only use random chat.');
    case 'muted':
      return ackError('FORBIDDEN', 'You are muted in this room.', after(refusal.until));
    case 'room_banned':
      return ackError('FORBIDDEN', 'You are banned from this room.', after(refusal.until));
    case 'sanctioned':
      return ackError('FORBIDDEN', 'Your account cannot post right now.', after(refusal.until));
    case 'blocked':
      return ackError('FORBIDDEN', 'You cannot message this person.');
    case 'conversation_archived':
      return ackError('FORBIDDEN', 'This conversation is archived.');
    case 'account_inactive':
      return ackError('FORBIDDEN', 'This account is suspended or closed.');
  }
}

export function registerMessageHandlers(
  socket: IoSocket,
  ctx: HandlerContext,
  inFlight: InFlight,
): void {
  registerHandler(socket, ctx, inFlight, 'message:send', async (payload, sender) => {
    const result = await sendMessage(ctx.db, {
      conversationId: payload.conversationId,
      authorId: sender.data.userId,
      clientId: payload.clientId,
      body: payload.body,
      replyToId: payload.replyToId ?? null,
    });
    ctx.afterDatabaseWork();
    if (!result.ok) return refusalToAck(result, Date.now());

    const message = toMessageWire(result.message);
    if (!result.duplicate) {
      ctx.metrics.increment('ss_messages_total');
      // Everyone in the conversation, including the sender's other tabs, but not this socket
      // (it gets the acknowledgement instead).
      sender
        .to(rooms.conversation(message.conversationId))
        .emit('message:new', { message, eventSeq: message.eventSeq });
    }
    return ackOk({ message });
  });

  registerHandler(socket, ctx, inFlight, 'sync:request', async ({ cursors }, requester) => {
    const allowed = await filterMemberConversations(
      ctx.db,
      requester.data.userId,
      cursors.map((c) => c.conversationId),
    );
    const results = [];
    for (const cursor of cursors) {
      // Conversations the person does not belong to are left out silently (nothing leaks).
      if (!allowed.has(cursor.conversationId)) continue;
      // Self-healing: make sure the socket receives this conversation's live events from now on.
      await requester.join(rooms.conversation(cursor.conversationId));
      const since = await listEventsSince(
        ctx.db,
        cursor.conversationId,
        cursor.afterEventSeq,
        LIMITS.sync.eventsPerConversation,
      );
      results.push(
        since.reset
          ? { conversationId: cursor.conversationId, events: [], reset: true }
          : {
              conversationId: cursor.conversationId,
              events: since.messages.map((row) => ({
                type: 'message' as const,
                message: toMessageWire(row),
              })),
            },
      );
    }
    ctx.afterDatabaseWork();
    return ackOk({ results });
  });
}
