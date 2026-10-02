/**
 * Internal events from the web app (realtime-protocol.md, "Internal events"): applying them to live
 * connections, refusing replays, and draining the outbox of events that could not be sent directly.
 */
import {
  getConversationForBroadcast,
  getMembership,
  getPersonRows,
  listMemberships,
  listPendingOutbox,
  markOutboxDelivered,
  markOutboxFailed,
  nicknameOnly,
  type Database,
  type Queryable,
} from '@socketspace/db';
import { internalEventSchema, type InternalEvent } from '@socketspace/shared/internal-events';

import { describeError } from './handlers/define';
import { sendPresenceSnapshot } from './handlers/presence';
import type { Logger } from './logger';
import type { Metrics } from './metrics';
import type { PresenceTracker } from './presence';
import { rooms, type IoServer } from './types';

export interface InternalEventDeps {
  io: IoServer;
  db: Queryable;
  /** When given, profile changes also update invisible mode (PROF-02). */
  presence?: PresenceTracker;
}

/** Disconnects every socket in a room after telling it why. Works across instances with Redis. */
async function endSockets(
  io: IoServer,
  room: string,
  reason: 'revoked' | 'banned' | 'suspended' | 'deleted',
): Promise<void> {
  io.in(room).emit('session:ended', { reason });
  // Give the notice a moment to leave before closing the connections.
  await new Promise((done) => setTimeout(done, 50));
  io.in(room).disconnectSockets(true);
}

/** A member as broadcasts show them: nickname only, because many people receive one copy. */
async function memberForBroadcast(db: Queryable, conversationId: string, userId: string) {
  const [membership, [person]] = await Promise.all([
    getMembership(db, conversationId, userId),
    getPersonRows(db, [userId]),
  ]);
  if (!membership || !person) return null;
  return {
    user: nicknameOnly(person),
    role: membership.role,
    joinedAt: membership.joinedAt.toISOString(),
  };
}

export async function applyInternalEvent(
  deps: InternalEventDeps,
  event: InternalEvent,
): Promise<void> {
  const { io, db } = deps;
  switch (event.type) {
    case 'session.revoked':
      await Promise.all(
        event.sessionIds.map((sid) => endSockets(io, rooms.session(sid), 'revoked')),
      );
      return;
    case 'user.sessions_revoked':
      await endSockets(io, rooms.user(event.userId), 'revoked');
      return;
    case 'user.deleted':
      await endSockets(io, rooms.user(event.userId), 'deleted');
      return;
    case 'user.sanctioned': {
      const until = event.until;
      const notice = { reason: event.reason, until };
      if (event.kind === 'suspend' || event.kind === 'ban') {
        io.in(rooms.user(event.userId)).emit('moderation:notice', {
          kind: event.kind === 'ban' ? 'banned' : 'suspended',
          ...notice,
        });
        await endSockets(
          io,
          rooms.user(event.userId),
          event.kind === 'ban' ? 'banned' : 'suspended',
        );
      } else {
        // Mutes are enforced on every send by the database; here the person is just told.
        io.in(rooms.user(event.userId)).emit('moderation:notice', {
          kind: event.kind === 'mute' ? 'muted' : 'warned',
          ...notice,
        });
      }
      return;
    }
    case 'user.updated': {
      const [person] = await getPersonRows(db, [event.userId]);
      if (!person) return;
      const memberships = await listMemberships(db, event.userId);
      const targets = [
        rooms.user(event.userId),
        ...memberships.map((m) => rooms.conversation(m.conversationId)),
      ];
      io.to(targets).emit('user:updated', { user: nicknameOnly(person) });
      // Invisible mode may have changed: others now see the person online, or offline.
      const change = deps.presence?.setVisible(event.userId, person.showPresence);
      if (change) {
        io.to(targets.slice(1)).emit('presence', {
          userId: change.userId,
          status: change.status,
          lastSeenAt: null,
        });
      }
      return;
    }
    case 'member.added': {
      const conversation = await getConversationForBroadcast(db, event.conversationId);
      if (!conversation) return;
      // Join first, so nothing sent from now on is missed by the new member's open tabs.
      io.in(rooms.user(event.userId)).socketsJoin(rooms.conversation(event.conversationId));
      io.to(rooms.user(event.userId)).emit('conversation:joined', { conversation });
      const member = await memberForBroadcast(db, event.conversationId, event.userId);
      if (member) {
        io.to(rooms.conversation(event.conversationId)).emit('member:joined', {
          conversationId: event.conversationId,
          member,
        });
      }
      if (deps.presence) {
        // Presence is normally exchanged on connect; a live join happens later, so the room
        // learns whether the newcomer is online, and the newcomer learns who is online there.
        const status = deps.presence.visibleStatus(event.userId);
        if (status !== 'offline') {
          io.to(rooms.conversation(event.conversationId))
            .except(rooms.user(event.userId))
            .emit('presence', {
              userId: event.userId,
              status,
              lastSeenAt: null,
            });
        }
        sendPresenceSnapshot(
          { io, presence: deps.presence },
          {
            userId: event.userId,
            emit: (online) => {
              io.to(rooms.user(event.userId)).emit('presence', { ...online, lastSeenAt: null });
            },
          },
          [rooms.conversation(event.conversationId)],
        );
      }
      return;
    }
    case 'member.removed': {
      const room = rooms.conversation(event.conversationId);
      const user = rooms.user(event.userId);
      // Leave first, so the removed person receives nothing more from the room.
      io.in(user).socketsLeave(room);
      io.to(room).emit('member:left', {
        conversationId: event.conversationId,
        userId: event.userId,
      });
      io.to(user).emit('conversation:left', { conversationId: event.conversationId });
      if (event.cause === 'removed' || event.cause === 'banned') {
        io.to(user).emit('room:notice', {
          conversationId: event.conversationId,
          kind: event.cause,
          reason: event.reason ?? null,
          until: event.until ?? null,
        });
      }
      return;
    }
    case 'member.role_changed': {
      const member = await memberForBroadcast(db, event.conversationId, event.userId);
      if (!member) return;
      io.to(rooms.conversation(event.conversationId)).emit('member:updated', {
        conversationId: event.conversationId,
        member,
      });
      return;
    }
    case 'member.muted':
      io.to(rooms.user(event.userId)).emit('room:notice', {
        conversationId: event.conversationId,
        kind: event.until ? 'muted' : 'unmuted',
        reason: event.until ? event.reason : null,
        until: event.until,
      });
      return;
    case 'conversation.updated': {
      const conversation = await getConversationForBroadcast(db, event.conversationId);
      if (!conversation) return;
      io.to(rooms.conversation(event.conversationId)).emit('conversation:updated', {
        conversation,
      });
      return;
    }
    case 'conversation.deleted': {
      const room = rooms.conversation(event.conversationId);
      io.to(room).emit('conversation:left', { conversationId: event.conversationId });
      io.in(room).socketsLeave(room);
      return;
    }
    // Handled from Stage E onwards (lifting sanctions, moderation broadcasts, random-mode blocks).
    case 'user.unsanctioned':
    case 'message.moderated':
    case 'block.created':
      return;
  }
}

/** Remembers event IDs for twice the signature window, so a captured request cannot be replayed. */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True the first time an ID is seen; false for a replay. */
  firstTime(id: string): boolean {
    const now = this.now();
    for (const [key, expires] of this.seen) if (expires <= now) this.seen.delete(key);
    if (this.seen.has(id)) return false;
    this.seen.set(id, now + this.ttlMs);
    return true;
  }
}

/**
 * Applies pending outbox events. Runs when the server starts and, at most every `minIntervalMs`,
 * after it has done other database work anyway, never on an idle timer, so idle connections do
 * not keep the free database awake (data-model.md, `realtime_outbox`).
 */
export class OutboxDrainer {
  private lastRunMs = 0;
  private running = false;

  constructor(
    private readonly deps: {
      db: Database;
      io: IoServer;
      logger: Logger;
      metrics: Metrics;
      presence?: PresenceTracker;
    },
    private readonly minIntervalMs = 10_000,
  ) {}

  /** Drains now (start-up). */
  async drain(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    this.lastRunMs = Date.now();
    let applied = 0;
    try {
      for (const entry of await listPendingOutbox(this.deps.db)) {
        const parsed = internalEventSchema.safeParse(entry.payload);
        if (!parsed.success) {
          await markOutboxFailed(this.deps.db, entry.id, 'payload does not match the schema');
          continue;
        }
        try {
          await applyInternalEvent(this.deps, parsed.data);
          await markOutboxDelivered(this.deps.db, entry.id);
          applied += 1;
        } catch (error) {
          await markOutboxFailed(this.deps.db, entry.id, describeError(error).name);
        }
      }
      if (applied > 0) {
        this.deps.metrics.increment('ss_outbox_applied_total', {}, applied);
        this.deps.logger.info({ applied }, 'applied events from the outbox');
      }
    } catch (error) {
      this.deps.logger.warn({ error: describeError(error) }, 'outbox drain failed');
    } finally {
      this.running = false;
    }
    return applied;
  }

  /** Drains in the background if the last run was long enough ago. */
  maybeDrain(): void {
    if (Date.now() - this.lastRunMs < this.minIntervalMs) return;
    void this.drain();
  }
}
