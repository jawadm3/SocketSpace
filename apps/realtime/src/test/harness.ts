/**
 * Runs the real realtime server on a random port with an in-memory database (PGlite) and a local
 * Ed25519 key pair standing in for the web app's signing keys, and connects real Socket.IO clients.
 */
import { randomBytes } from 'node:crypto';

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

import { newId, schema } from '@socketspace/db';
import { createTestDatabase, type TestDatabase } from '@socketspace/db/testing';
import type { Ack } from '@socketspace/shared/errors';
import {
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  signInternalRequest,
  type InternalEvent,
} from '@socketspace/shared/internal-events';

import { createRealtimeServer, type RealtimeServer } from '../app';
import { loadRealtimeEnv, type RealtimeEnv } from '../env';
import { createLogger } from '../logger';

export const WEB_ORIGIN = 'http://localhost:3000';

/** Test-only configuration. The secrets are deliberately obvious placeholders. */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused-in-tests',
  WEB_ORIGINS: WEB_ORIGIN,
  AUTH_JWKS_URL: `${WEB_ORIGIN}/api/auth/jwks`,
  AUTH_ISSUER: WEB_ORIGIN,
  INTERNAL_EVENTS_SECRET: 'i'.repeat(40),
  METRICS_TOKEN: 'm'.repeat(32),
  LOG_LEVEL: 'debug',
};

export interface TokenClaims {
  sub: string;
  sid: string;
  role?: 'user' | 'admin';
  guest?: boolean;
  iss?: string;
  aud?: string;
  /** Seconds from now; negative for an already expired token. */
  expiresIn?: number;
}

export interface Harness {
  db: TestDatabase['db'];
  env: RealtimeEnv;
  server: RealtimeServer;
  url: string;
  /** Every log line the server wrote (for checking that nothing sensitive is logged). */
  logs: string[];
  signToken: (claims: TokenClaims, key?: CryptoKey) => Promise<string>;
  /** Inserts a live session for `userId` and returns its ID. */
  createSession: (userId: string) => Promise<string>;
  connect: (
    token: string | undefined,
    options?: {
      origin?: string | null;
      /** Runs before the server's hello, to catch events sent right after it. */
      onBeforeHello?: (socket: ClientSocket) => void;
    },
  ) => Promise<ClientSocket>;
  /** Signs in `userId` with a fresh session and token and connects. */
  connectAs: (userId: string) => Promise<ClientSocket>;
  /**
   * Stops the server gracefully and starts a new one (new port, empty memory) on the same database
   * and signing keys, like a deploy or a crash-and-restart. `server` and `url` then point at it.
   */
  restart: () => Promise<void>;
  /** Sends a signed internal event, as the web app does. */
  postEvent: (
    event: InternalEvent,
    options?: { secret?: string; timestamp?: string },
  ) => Promise<Response>;
  close: () => Promise<void>;
}

/** `id` and `at` for an internal event. */
export const eventBase = () => ({ id: newId(), at: new Date().toISOString() });

export interface Hello {
  protocolVersion: number;
  serverTime: string;
  userId: string;
}

const hellos = new WeakMap<ClientSocket, Hello>();

/** The `server:hello` a connected test socket received. */
export function helloOf(socket: ClientSocket): Hello | undefined {
  return hellos.get(socket);
}

/** Waits for the first `event` on `socket`, or fails after `ms`. */
export function nextEvent<T = unknown>(socket: ClientSocket, event: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`no "${event}" within ${String(ms)} ms`));
    }, ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Sends an acknowledged event and returns the acknowledgement. */
export function request<T = unknown>(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<Ack<T>> {
  return socket.timeout(5000).emitWithAck(event, payload) as Promise<Ack<T>>;
}

export async function startHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const database = await createTestDatabase();
  const env = loadRealtimeEnv({ ...TEST_ENV, ...overrides });
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  const jwk = { ...(await exportJWK(publicKey)), alg: 'EdDSA', kid: 'test-key' };
  const logs: string[] = [];
  const logger = createLogger('debug', {
    write: (line: string) => {
      logs.push(line);
    },
  });

  const start = async () => {
    const created = createRealtimeServer({
      env,
      db: database.db,
      keys: createLocalJWKSet({ keys: [jwk] }),
      checkKeys: () => Promise.resolve(true),
      logger,
    });
    const port = await created.listen(0, '127.0.0.1');
    return { created, url: `http://127.0.0.1:${String(port)}` };
  };
  let { created: server, url } = await start();
  const clients: ClientSocket[] = [];

  const signToken: Harness['signToken'] = async (claims, key = privateKey) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      sid: claims.sid,
      role: claims.role ?? 'user',
      guest: claims.guest ?? false,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
      .setSubject(claims.sub)
      .setIssuer(claims.iss ?? WEB_ORIGIN)
      .setAudience(claims.aud ?? env.REALTIME_TOKEN_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + (claims.expiresIn ?? 300))
      .sign(key);
  };

  const createSession: Harness['createSession'] = async (userId) => {
    const id = newId();
    await database.db.insert(schema.session).values({
      id,
      userId,
      token: randomBytes(16).toString('hex'),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return id;
  };

  const connect: Harness['connect'] = (token, options = {}) =>
    new Promise((resolve, reject) => {
      const origin = options.origin === undefined ? WEB_ORIGIN : options.origin;
      const socket = connectClient(url, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        auth: token === undefined ? {} : { token },
        ...(origin !== null && { extraHeaders: { origin } }),
      });
      clients.push(socket);
      options.onBeforeHello?.(socket);
      // Resolve once the server has also said hello, so tests never miss that first event.
      socket.once('server:hello', (hello: Hello) => {
        hellos.set(socket, hello);
        resolve(socket);
      });
      socket.once('connect_error', (error: Error & { data?: unknown }) => {
        socket.close();
        reject(error);
      });
    });

  const connectAs: Harness['connectAs'] = async (userId) => {
    const sid = await createSession(userId);
    return connect(await signToken({ sub: userId, sid }));
  };

  return {
    db: database.db,
    env,
    get server() {
      return server;
    },
    get url() {
      return url;
    },
    logs,
    signToken,
    createSession,
    connect,
    connectAs,
    postEvent: async (event, options = {}) => {
      const body = JSON.stringify(event);
      const timestamp = options.timestamp ?? String(Date.now());
      const signature = await signInternalRequest(
        options.secret ?? env.INTERNAL_EVENTS_SECRET,
        timestamp,
        body,
      );
      return fetch(`${url}/internal/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [INTERNAL_TIMESTAMP_HEADER]: timestamp,
          [INTERNAL_SIGNATURE_HEADER]: signature,
        },
        body,
      });
    },
    restart: async () => {
      await server.stop();
      ({ created: server, url } = await start());
    },
    close: async () => {
      for (const client of clients) client.close();
      await server.stop();
      await database.close();
    },
  };
}
