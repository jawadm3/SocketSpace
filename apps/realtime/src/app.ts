/**
 * The realtime server (system-overview.md): one HTTP server carrying
 *
 * - Socket.IO at /socket.io/ (authenticated connections, live events);
 * - GET /healthz (process is up, no database: used by the keep-awake pinger);
 * - GET /readyz (database reachable and signing keys loadable: used by deploy checks);
 * - GET /metrics (Prometheus text, requires METRICS_TOKEN);
 * - POST /internal/events (HMAC-signed events from the web app).
 *
 * `createRealtimeServer` takes its dependencies explicitly so tests can run it on a random port
 * with an in-memory database and local signing keys.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';

import {
  getActiveSanctions,
  getConnectionProfile,
  isSessionActive,
  listMemberships,
  pingDatabase,
  touchLastSeen,
  type Database,
} from '@socketspace/db';
import { PROTOCOL_VERSION } from '@socketspace/shared/events';
import {
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  internalEventSchema,
  verifyInternalRequest,
} from '@socketspace/shared/internal-events';
import { ABUSE, LIMITS } from '@socketspace/shared/limits';

import type { RealtimeEnv } from './env';
import { describeError, InFlight } from './handlers/define';
import { registerMessageHandlers } from './handlers/messages';
import { registerRandomHandlers } from './handlers/random';
import {
  announcePresence,
  conversationRoomsOf,
  registerPresenceHandlers,
  sendPresenceSnapshot,
} from './handlers/presence';
import { applyInternalEvent, OutboxDrainer, ReplayGuard } from './internal';
import { ConnectionTracker, TokenBuckets, ViolationCounter } from './limits';
import type { Logger } from './logger';
import { Metrics } from './metrics';
import { PresenceTracker } from './presence';
import { clientIp, isAllowedOrigin } from './network';
import { RandomManager, type RandomTimings } from './random/manager';
import { verifyConnectionToken, type KeySource } from './token';
import { rooms, type HandlerContext, type IoServer } from './types';

export interface RedisClients {
  pub: Parameters<typeof createAdapter>[0];
  sub: Parameters<typeof createAdapter>[1];
}

export interface RealtimeDeps {
  env: RealtimeEnv;
  db: Database;
  keys: KeySource;
  /** Readiness: can the signing keys be fetched right now? */
  checkKeys: () => Promise<boolean>;
  logger: Logger;
  closeDb?: () => Promise<void>;
  redis?: RedisClients;
  /** Shorter waits for tests (random mode's timers). */
  randomTimings?: Partial<RandomTimings>;
}

export interface RealtimeServer {
  io: IoServer;
  metrics: Metrics;
  outbox: OutboxDrainer;
  /** Starts listening; resolves with the actual port (useful with port 0 in tests). */
  listen: (port: number, host?: string) => Promise<number>;
  /** Graceful shutdown: tell clients to reconnect, finish in-flight work, close everything. */
  stop: () => Promise<void>;
}

/** The error a refused connection receives (`connect_error` in the browser). */
function refusal(code: string, message: string, retryAfterMs?: number): Error {
  const error = new Error(code) as Error & { data?: unknown };
  error.data = retryAfterMs === undefined ? { code, message } : { code, message, retryAfterMs };
  return error;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limitBytes: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/** Compares secrets without revealing, through timing, how much of a guess was right. */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function createRealtimeServer(deps: RealtimeDeps): RealtimeServer {
  const { env, db, logger } = deps;
  const metrics = new Metrics();
  const buckets = new TokenBuckets();
  const tracker = new ConnectionTracker({
    perUser: env.MAX_CONNECTIONS_PER_USER,
    perIp: env.MAX_CONNECTIONS_PER_IP,
    newPerIpPerMinute: env.NEW_CONNECTIONS_PER_IP_PER_MINUTE,
  });
  const replay = new ReplayGuard(2 * 60_000);
  const inFlight = new InFlight();
  const presence = new PresenceTracker();
  let stopping = false;

  const httpServer = createServer((req, res) => {
    // A fresh ID for every request, returned to the caller and written on any log line about it,
    // so a reported problem can be matched to its log entry (OBS-01).
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    void handleHttp(req, res).catch((error: unknown) => {
      logger.error({ requestId, error: describeError(error) }, 'http handler failed');
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
    });
  });

  const io: IoServer = new Server(httpServer, {
    // CORS for the long-polling fallback. It does not protect WebSockets, hence allowRequest.
    cors: { origin: env.WEB_ORIGINS, methods: ['GET', 'POST'], credentials: false },
    allowRequest: (req, callback) => {
      callback(null, isAllowedOrigin(req.headers.origin, env.WEB_ORIGINS));
    },
    // Any single packet over 16 KB closes the connection (realtime-protocol.md).
    maxHttpBufferSize: LIMITS.packetBytes,
    // A transport that never completes the Socket.IO handshake is dropped after 10 seconds.
    connectTimeout: 10_000,
    serveClient: false,
    ...(deps.redis || !env.CONNECTION_RECOVERY
      ? {}
      : {
          connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: false },
        }),
  });
  if (deps.redis) io.adapter(createAdapter(deps.redis.pub, deps.redis.sub));

  // Random-match mode, unless the kill switch is off (RAND-11). Network addresses are hashed with
  // a key derived from a secret this server already has, so no raw address is ever stored.
  const random = env.RANDOM_MODE_ENABLED
    ? new RandomManager({
        io,
        db,
        logger,
        metrics,
        ipHashSecret: env.INTERNAL_EVENTS_SECRET,
        afterDatabaseWork: () => {
          outbox.maybeDrain();
        },
        ...(deps.randomTimings && { timings: deps.randomTimings }),
      })
    : null;
  const outbox = new OutboxDrainer({ db, io, logger, metrics, presence, random });
  const ctx: HandlerContext = {
    db,
    io,
    logger,
    metrics,
    buckets,
    presence,
    random,
    afterDatabaseWork: () => {
      outbox.maybeDrain();
    },
  };

  // Every connection is authenticated before it is accepted (RT-01, RT-08).
  io.use((socket, next) => {
    void (async () => {
      if (stopping) {
        next(refusal('UNAVAILABLE', 'The server is restarting. Please reconnect.'));
        return;
      }
      const ip = clientIp(socket.request, env.TRUST_PROXY_HOPS);
      if (tracker.noteAttempt(ip)) {
        metrics.increment('ss_connections_refused_total', { reason: 'too_fast' });
        next(
          refusal('RATE_LIMITED', 'Too many connection attempts. Please wait a minute.', 60_000),
        );
        return;
      }

      const auth = socket.handshake.auth as { token?: unknown } | undefined;
      const check = await verifyConnectionToken(auth?.token, deps.keys, {
        issuer: env.AUTH_ISSUER,
        audience: env.REALTIME_TOKEN_AUDIENCE,
      });
      if (!check.ok) {
        metrics.increment('ss_connections_refused_total', { reason: `token_${check.reason}` });
        next(
          check.reason === 'keys_unavailable'
            ? refusal('UNAVAILABLE', 'Sign-in keys are unavailable. Please try again shortly.')
            : refusal('UNAUTHENTICATED', 'Your connection token is missing, invalid or expired.'),
        );
        return;
      }
      const { sub: userId, sid: sessionId } = check.claims;

      const [profile, sessionLive, sanctions] = await Promise.all([
        getConnectionProfile(db, userId),
        isSessionActive(db, sessionId, userId),
        getActiveSanctions(db, userId),
      ]);
      if (!sessionLive) {
        metrics.increment('ss_connections_refused_total', { reason: 'session_ended' });
        next(refusal('UNAUTHENTICATED', 'This session has ended. Please sign in again.'));
        return;
      }
      const blocked = sanctions.some(
        (s) => s.scope === 'global' && (s.kind === 'suspend' || s.kind === 'ban'),
      );
      if (profile?.status !== 'active' || blocked) {
        metrics.increment('ss_connections_refused_total', { reason: 'account_inactive' });
        next(refusal('FORBIDDEN', 'This account is suspended or closed.'));
        return;
      }

      const capped = tracker.acquire(userId, ip);
      if (capped) {
        metrics.increment('ss_connections_refused_total', { reason: capped });
        next(
          refusal('RATE_LIMITED', 'Too many open connections. Close another tab and try again.'),
        );
        return;
      }

      const memberships = await listMemberships(db, userId).catch((error: unknown) => {
        tracker.release(userId, ip);
        throw error;
      });
      socket.data = {
        userId,
        sessionId,
        role: profile.role,
        guest: profile.isAnonymous,
        ip,
        violations: new ViolationCounter(ABUSE.violationWindowMs),
        showPresence: profile.showPresence,
      };
      await socket.join([
        rooms.user(userId),
        rooms.session(sessionId),
        ...memberships.map((m) => rooms.conversation(m.conversationId)),
      ]);
      next();
    })().catch((error: unknown) => {
      logger.warn({ socketId: socket.id, error: describeError(error) }, 'connection check failed');
      next(
        refusal('UNAVAILABLE', 'The chat server could not check your connection. Retrying soon.'),
      );
    });
  });

  io.on('connection', (socket) => {
    metrics.connections += 1;
    metrics.increment('ss_connections_accepted_total');
    socket.emit('server:hello', {
      protocolVersion: PROTOCOL_VERSION,
      serverTime: new Date().toISOString(),
      userId: socket.data.userId,
    });
    // Socket.IO's per-connection ID ties together every log line about one connection.
    logger.debug({ socketId: socket.id, userId: socket.data.userId }, 'connection accepted');
    registerMessageHandlers(socket, ctx, inFlight);
    registerPresenceHandlers(socket, ctx, inFlight);
    registerRandomHandlers(socket, ctx, inFlight);

    // Presence: tell people who share a conversation, and show this tab who is online.
    const conversationRooms = conversationRoomsOf(socket);
    const arrived = presence.connect(socket.data.userId, socket.id, socket.data.showPresence);
    if (arrived) announcePresence(io, conversationRooms, arrived);
    sendPresenceSnapshot(
      ctx,
      {
        userId: socket.data.userId,
        emit: ({ userId, status }) => {
          socket.emit('presence', { userId, status, lastSeenAt: null });
        },
      },
      conversationRooms,
    );
    socket.on('disconnecting', () => {
      // Rooms are still known here (they are gone by 'disconnect').
      random?.socketClosed(socket);
      const left = presence.disconnect(socket.data.userId, socket.id);
      if (!left) return;
      announcePresence(io, conversationRoomsOf(socket), left, new Date().toISOString());
      if (left.status === 'offline') {
        touchLastSeen(db, socket.data.userId).catch((error: unknown) => {
          logger.warn({ error: describeError(error) }, 'last seen not saved');
        });
      }
    });
    socket.on('disconnect', (reason) => {
      metrics.connections -= 1;
      tracker.release(socket.data.userId, socket.data.ip);
      logger.debug(
        { socketId: socket.id, userId: socket.data.userId, reason },
        'connection closed',
      );
    });
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (req.method === 'GET' && path === '/healthz') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'GET' && path === '/readyz') {
      const [database, keys] = await Promise.all([
        pingDatabase(db).then(
          () => true,
          () => false,
        ),
        deps.checkKeys().catch(() => false),
      ]);
      const ready = database && keys && !stopping;
      sendJson(res, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', database, keys });
      return;
    }

    if (req.method === 'GET' && path === '/metrics') {
      const header = req.headers.authorization ?? '';
      const given = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!given || !sameSecret(given, env.METRICS_TOKEN)) {
        sendJson(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(metrics.render());
      return;
    }

    if (req.method === 'POST' && path === '/internal/events') {
      const body = await readBody(req, 64 * 1024);
      if (body === null) {
        sendJson(res, 413, { error: 'too_large' });
        return;
      }
      const header = (name: string) => {
        const value = req.headers[name];
        return Array.isArray(value) ? value[0] : value;
      };
      const signature = await verifyInternalRequest({
        secret: env.INTERNAL_EVENTS_SECRET,
        timestamp: header(INTERNAL_TIMESTAMP_HEADER),
        signature: header(INTERNAL_SIGNATURE_HEADER),
        body,
        nowMs: Date.now(),
      });
      if (!signature.ok) {
        metrics.increment('ss_internal_events_total', { result: signature.reason });
        sendJson(res, 401, { error: 'invalid_signature' });
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        json = null;
      }
      const event = internalEventSchema.safeParse(json);
      if (!event.success) {
        sendJson(res, 400, { error: 'invalid_event' });
        return;
      }
      if (!replay.firstTime(event.data.id)) {
        metrics.increment('ss_internal_events_total', { result: 'replay' });
        sendJson(res, 409, { error: 'replayed' });
        return;
      }
      await applyInternalEvent({ io, db, presence, random }, event.data);
      metrics.increment('ss_internal_events_total', { result: 'applied', type: event.data.type });
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  }

  // Memory housekeeping only; it never touches the database.
  const sweeper = setInterval(() => {
    buckets.sweep();
    tracker.sweep();
    random?.sweep();
  }, 60_000);
  sweeper.unref();

  return {
    io,
    metrics,
    outbox,
    listen: (port, host) =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          resolve((httpServer.address() as AddressInfo).port);
        });
      }),
    stop: async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(sweeper);
      logger.info({ connections: metrics.connections }, 'shutting down');
      // 1. Tell every client to reconnect shortly (they will reach the next instance).
      io.emit('session:ended', { reason: 'server_shutdown', reconnectAfterMs: 2_000 });
      // 2. Let in-flight messages finish saving, so nothing acknowledged is lost.
      await inFlight.idle(Math.floor(env.SHUTDOWN_GRACE_MS / 2));
      // Random chats cannot outlive this server's memory: they are recorded as ended.
      await random?.stop();
      // 3. Close connections and the HTTP server.
      await new Promise<void>((done) => {
        void io.close(() => {
          done();
        });
      });
      metrics.close();
      await deps.closeDb?.();
    },
  };
}
