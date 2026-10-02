/**
 * Sending and changing messages, reactions, read state, and catching up after a reconnect.
 *
 * `message:edit`, `message:delete`, `reaction:toggle` (MSG-02, MSG-03, MSG-05) take a new event
 * number in the database and are broadcast to the conversation, so open tabs update at once and
 * resync carries them. `read:update` (RT-05) moves the reader's marker and tells their other tabs.
 *
 * `message:send` (MSG-01, RT-02, RECON-03): every permission is checked by the database inside the
 * same transaction that numbers the message (packages/db sendMessage). A re-send with the same
 * client ID returns the original message and is not broadcast twice.
 *
 * `sync:request` (RECON-02): everything that changed after the client's last known event number,
 * only for conversations the person belongs to.
 */
import {
  deleteMessage,
  editMessage,
  filterMemberConversations,
  listEventsSince,
  listReactions,
  markRead,
  sendMessage,
  toggleReaction,
  toMessageWire,
  type MessageActionRefusal,
  type SendRefusal,
} from '@socketspace/db';
import type { DenyReason } from '@socketspace/shared/authz';
import { ackError, ackOk, type Ack } from '@socketspace/shared/errors';
import { LIMITS } from '@socketspace/shared/limits';

import { rooms, type HandlerContext, type IoSocket } from '../types';
import { registerHandler, type InFlight } from './define';

const DENIED: Partial<Record<DenyReason, string>> = {
  role: 'Only the author, a room moderator or an admin can delete this message.',
  target_rank: 'You cannot delete messages from someone with the same or a higher role.',
  dm: 'In a direct message you can only delete your own messages.',
  not_member: 'You are not a member of this conversation.',
  room_banned: 'You are banned from this room.',
  unverified: 'Please confirm your email address first.',
};

/** Plain-English refusals; `until` becomes `retryAfterMs` so the browser can say when. */
export function refusalToAck(
  refusal: SendRefusal | MessageActionRefusal,
  nowMs: number,
): Ack<never> {
  const after = (until: Date | null) => (until ? Math.max(0, until.getTime() - nowMs) : undefined);
  switch (refusal.reason) {
    case 'message_not_found':
      return ackError('NOT_FOUND', 'This message no longer exists.');
    case 'not_author':
      return ackError('FORBIDDEN', 'You can only edit your own messages.');
    case 'deleted':
      return ackError('CONFLICT', 'This message was deleted.');
    case 'too_late':
      return ackError('FORBIDDEN', 'Messages can only be edited for 24 hours.');
    case 'too_many_reactions':
      return ackError('CONFLICT', 'This message already has 20 different reactions.');
    case 'denied':
      return ackError('FORBIDDEN', DENIED[refusal.deny] ?? 'You are not allowed to do that here.');
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

    const message = toMessageWire(
      result.message,
      result.duplicate
        ? ((await listReactions(ctx.db, [result.message.id])).get(result.message.id) ?? [])
        : [],
    );
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
      const reactions = await listReactions(
        ctx.db,
        since.messages.map((m) => m.id),
      );
      results.push(
        since.reset
          ? { conversationId: cursor.conversationId, events: [], reset: true }
          : {
              conversationId: cursor.conversationId,
              events: since.messages.map((row) => ({
                type: 'message' as const,
                message: toMessageWire(row, reactions.get(row.id) ?? []),
              })),
            },
      );
    }
    ctx.afterDatabaseWork();
    return ackOk({ results });
  });

  registerHandler(socket, ctx, inFlight, 'message:edit', async ({ messageId, body }, editor) => {
    const result = await editMessage(ctx.db, {
      messageId,
      editorId: editor.data.userId,
      body,
    });
    ctx.afterDatabaseWork();
    if (!result.ok) return refusalToAck(result, Date.now());
    const reactions = (await listReactions(ctx.db, [messageId])).get(messageId) ?? [];
    const message = toMessageWire(result.message, reactions);
    if (result.changed) {
      editor
        .to(rooms.conversation(message.conversationId))
        .emit('message:updated', { message, eventSeq: message.eventSeq });
    }
    return ackOk({ message });
  });

  registerHandler(socket, ctx, inFlight, 'message:delete', async ({ messageId }, actor) => {
    const result = await deleteMessage(ctx.db, { messageId, actorId: actor.data.userId });
    ctx.afterDatabaseWork();
    if (!result.ok) return refusalToAck(result, Date.now());
    const { conversationId, versionSeq } = result.message;
    if (result.changed) {
      actor
        .to(rooms.conversation(conversationId))
        .emit('message:deleted', { conversationId, messageId, eventSeq: versionSeq });
    }
    return ackOk({ messageId, eventSeq: versionSeq });
  });

  registerHandler(
    socket,
    ctx,
    inFlight,
    'reaction:toggle',
    async ({ messageId, emoji }, reactor) => {
      const result = await toggleReaction(ctx.db, {
        messageId,
        userId: reactor.data.userId,
        emoji,
      });
      ctx.afterDatabaseWork();
      if (!result.ok) return refusalToAck(result, Date.now());
      const reactions = toMessageWire(result.message, result.reactions).reactions;
      reactor.to(rooms.conversation(result.message.conversationId)).emit('reaction:updated', {
        conversationId: result.message.conversationId,
        messageId,
        reactions,
        eventSeq: result.message.versionSeq,
      });
      return ackOk({ messageId, reactions });
    },
  );

  registerHandler(socket, ctx, inFlight, 'read:update', async ({ conversationId, seq }, reader) => {
    const result = await markRead(ctx.db, {
      conversationId,
      userId: reader.data.userId,
      seq,
    });
    ctx.afterDatabaseWork();
    if (!result.ok) return ackError('FORBIDDEN', 'You are not a member of this conversation.');
    if (result.moved) {
      // The person's other tabs clear their unread badge too.
      reader.to(rooms.user(reader.data.userId)).emit('read:updated', {
        conversationId,
        userId: reader.data.userId,
        seq: result.lastReadSeq,
      });
    }
    return ackOk({ unread: result.unread });
  });
}
