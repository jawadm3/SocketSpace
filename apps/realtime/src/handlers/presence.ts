/**
 * Typing indicators and presence (RT-03, RT-04, PROF-02).
 *
 * `typing:set` is fire-and-forget: members only (the socket must be in the conversation's room),
 * throttled, with extra events dropped silently; browsers expire an indicator after 6 seconds.
 * Presence goes to everyone who shares a conversation with the person, never for people in
 * invisible mode (they always look offline).
 */
import { ackOk } from '@socketspace/shared/errors';

import type { PresenceChange } from '../presence';
import { rooms, type HandlerContext, type IoServer, type IoSocket } from '../types';
import { registerHandler, registerSignal, type InFlight } from './define';

/** At most this many people are reported to a newly connected tab. */
const SNAPSHOT_LIMIT = 500;

/** The conversation rooms a socket is in (every tab of a person is in the same ones). */
export function conversationRoomsOf(socket: IoSocket): string[] {
  return [...socket.rooms].filter((room) => room.startsWith('conv:'));
}

/** Tells everyone who shares a conversation with the person about a change. */
export function announcePresence(
  io: IoServer,
  conversationRooms: string[],
  change: PresenceChange,
  lastSeenAt: string | null = null,
): void {
  if (conversationRooms.length === 0) return;
  io.to(conversationRooms).emit('presence', {
    userId: change.userId,
    status: change.status,
    lastSeenAt,
  });
}

/** Sends `target` the presence of everyone online in the given conversation rooms. */
export function sendPresenceSnapshot(
  ctx: Pick<HandlerContext, 'io' | 'presence'>,
  target: {
    userId: string;
    emit: (status: { userId: string; status: 'online' | 'away' | 'dnd' }) => void;
  },
  conversationRooms: string[],
): void {
  const seen = new Set<string>([target.userId]);
  for (const room of conversationRooms) {
    for (const socketId of ctx.io.sockets.adapter.rooms.get(room) ?? []) {
      const userId = ctx.io.sockets.sockets.get(socketId)?.data.userId;
      if (!userId || seen.has(userId)) continue;
      seen.add(userId);
      const status = ctx.presence.visibleStatus(userId);
      if (status !== 'offline') target.emit({ userId, status });
      if (seen.size > SNAPSHOT_LIMIT) return;
    }
  }
}

export function registerPresenceHandlers(
  socket: IoSocket,
  ctx: HandlerContext,
  inFlight: InFlight,
): void {
  registerSignal(socket, ctx, 'typing:set', ({ conversationId, typing }, typist) => {
    const room = rooms.conversation(conversationId);
    if (!typist.rooms.has(room)) return; // members only
    typist.to(room).emit('typing', { conversationId, userId: typist.data.userId, typing });
  });

  registerHandler(socket, ctx, inFlight, 'presence:set', ({ status }, tab) => {
    const change = ctx.presence.set(tab.data.userId, tab.id, status);
    if (change) announcePresence(ctx.io, conversationRoomsOf(tab), change);
    return Promise.resolve(ackOk({}));
  });
}
