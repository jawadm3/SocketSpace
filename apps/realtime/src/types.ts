import type { Server, Socket } from 'socket.io';

import type { Database } from '@socketspace/db';
import type { ClientToServerEvents, ServerToClientEvents } from '@socketspace/shared/events';

import type { TokenBuckets, ViolationCounter } from './limits';
import type { Logger } from './logger';
import type { Metrics } from './metrics';

/** What the server knows about each authenticated connection. */
export interface SocketData {
  userId: string;
  sessionId: string;
  role: 'user' | 'admin';
  guest: boolean;
  ip: string;
  violations: ViolationCounter;
}

/** No events travel between instances except through the adapter. */
type InterServerEvents = Record<string, never>;

export type IoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
export type IoSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface HandlerContext {
  db: Database;
  io: IoServer;
  logger: Logger;
  metrics: Metrics;
  buckets: TokenBuckets;
  /** Called after database work, so the outbox is drained opportunistically (never on a timer). */
  afterDatabaseWork: () => void;
}

/** Socket.IO room names, in one place. */
export const rooms = {
  user: (userId: string) => `user:${userId}`,
  session: (sessionId: string) => `session:${sessionId}`,
  conversation: (conversationId: string) => `conv:${conversationId}`,
};
