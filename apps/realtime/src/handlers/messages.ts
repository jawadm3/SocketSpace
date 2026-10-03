/**
 * Sending and changing messages, reactions, read state, and catching up after a reconnect.
 *
 * `message:edit`, `message:delete`, `reaction:toggle` (MSG-02, MSG-03, MSG-05) take a new event
 * number in the database and are broadcast to the conversation, so open tabs update at once and
 * resync carries them. `read:update` (RT-05) moves the reader's marker and tells their other tabs
 * and, in a DM where both allow read receipts, the other person ("Seen"). `delivery:ack` (DM-02)
 * records what a device received in DMs and tells the other person ("Delivered").
 *
 * New messages and edits that notify someone (mentions, replies, DMs; NOTIF-01) push
 * `notification:new` to that person's tabs; the database wrote the notification in the same
 * transaction as the message.
 *
 * `message:send` (MSG-01, RT-02, RECON-03): every permission is checked by the database inside the
 * same transaction that numbers the message (packages/db sendMessage). A re-send with the same
 * client ID returns the original message and is not broadcast twice. Pictures (MSG-09) are
 * uploaded to the web app beforehand; the message names them by ID, and the same transaction
 * checks that each one is the sender's own unused upload.
 *
 * `sync:request` (RECON-02): everything that changed after the client's last known event number,
 * only for conversations the person belongs to.
 */
import {
  deleteMessage,
  dmPartner,
  editMessage,
  filterMemberConversations,
  getPersonRows,
  listEventsSince,
  loadMessageWires,
  markDelivered,
  markRead,
  nicknameOnly,
  receiptsAllowed,
  sendMessage,
  toggleReaction,
  toMessageWire,
  type MessageActionRefusal,
  type NotificationRow,
  type SendRefusal,
} from '@socketspace/db';
import type { DenyReason } from '@socketspace/shared/authz';
import { ackError, ackOk, type Ack } from '@socketspace/shared/errors';
import { LIMITS } from '@socketspace/shared/limits';

import { rooms, type HandlerContext, type IoSocket } from '../types';
import { registerHandler, registerSignal, type InFlight } from './define';

/** Tells each notified person's tabs (nickname only for the actor: one broadcast, many viewers). */
async function pushNotifications(
  ctx: HandlerContext,
  notifications: readonly NotificationRow[],
): Promise<void> {
  if (notifications.length === 0) return;
  const actorIds = [...new Set(notifications.flatMap((n) => (n.actorId ? [n.actorId] : [])))];
  const people = new Map((await getPersonRows(ctx.db, actorIds)).map((p) => [p.id, p]));
  for (const n of notifications) {
    const actor = n.actorId ? people.get(n.actorId) : undefined;
    ctx.io.to(rooms.user(n.userId)).emit('notification:new', {
      notification: {
        id: n.id,
        type: n.type,
        conversationId: n.conversationId,
        messageId: n.messageId,
        actor: actor ? nicknameOnly(actor) : null,
        createdAt: n.createdAt.toISOString(),
        readAt: null,
      },
    });
  }
}

/** In a DM where both people allow read receipts, the other person; otherwise null. */
async function receiptPartner(
  ctx: HandlerContext,
  conversationId: string,
  userId: string,
): Promise<string | null> {
  const partner = await dmPartner(ctx.db, conversationId, userId);
  if (!partner) return null;
  return (await receiptsAllowed(ctx.db, userId, partner)) ? partner : null;
}

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
    case 'attachment_invalid':
      return ackError(
        'VALIDATION',
        'A picture in this message is no longer available. Remove it and attach it again.',
      );
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
      attachmentIds: payload.attachmentIds ?? [],
    });
    ctx.afterDatabaseWork();
    if (!result.ok) return refusalToAck(result, Date.now());

    // A new message has no reactions yet; a re-send returns the stored one as it is now.
    const message = result.duplicate
      ? ((await loadMessageWires(ctx.db, [result.message]))[0] ?? toMessageWire(result.message))
      : toMessageWire(result.message, [], result.attachments);
    if (!result.duplicate) {
      ctx.metrics.increment('ss_messages_total');
      // Everyone in the conversation, including the sender's other tabs, but not this socket
      // (it gets the acknowledgement instead).
      sender
        .to(rooms.conversation(message.conversationId))
        .emit('message:new', { message, eventSeq: message.eventSeq });
      await pushNotifications(ctx, result.notifications);
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
      const messages = await loadMessageWires(ctx.db, since.messages);
      results.push(
        since.reset
          ? { conversationId: cursor.conversationId, events: [], reset: true }
          : {
              conversationId: cursor.conversationId,
              events: messages.map((message) => ({ type: 'message' as const, message })),
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
    const message =
      (await loadMessageWires(ctx.db, [result.message]))[0] ?? toMessageWire(result.message);
    if (result.changed) {
      editor
        .to(rooms.conversation(message.conversationId))
        .emit('message:updated', { message, eventSeq: message.eventSeq });
      await pushNotifications(ctx, result.notifications);
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
      return ackOk({ messageId, reactions, eventSeq: result.message.versionSeq });
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
      const update = { conversationId, userId: reader.data.userId, seq: result.lastReadSeq };
      reader.to(rooms.user(reader.data.userId)).emit('read:updated', update);
      const partner = await receiptPartner(ctx, conversationId, reader.data.userId);
      if (partner) ctx.io.to(rooms.user(partner)).emit('read:updated', update);
    }
    return ackOk({ unread: result.unread });
  });

  registerSignal(socket, ctx, 'delivery:ack', async ({ items }, device) => {
    for (const { conversationId, seq } of items) {
      // Only conversations this socket is in (checked without a query), DMs only (database).
      if (!device.rooms.has(rooms.conversation(conversationId))) continue;
      const moved = await markDelivered(ctx.db, {
        conversationId,
        userId: device.data.userId,
        seq,
      });
      if (!moved) continue;
      const partner = await receiptPartner(ctx, conversationId, device.data.userId);
      if (partner) {
        ctx.io.to(rooms.user(partner)).emit('delivery:updated', {
          conversationId,
          userId: device.data.userId,
          seq: moved.lastDeliveredSeq,
        });
      }
    }
    ctx.afterDatabaseWork();
  });
}
