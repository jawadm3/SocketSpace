/**
 * Horizontal scaling (RT-07, decision D-010): two realtime instances sharing one database and a
 * Redis server. A message sent through instance A must reach a member connected to instance B,
 * and a revocation sent to A must disconnect a socket on B.
 *
 * Needs a Redis server: runs when REDIS_TEST_URL is set (CI starts one as a service container).
 */
import { randomBytes } from 'node:crypto';

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createClient } from 'redis';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId, schema } from '@socketspace/db';
import {
  createTestDatabase,
  createTestRoom,
  createTestUser,
  type TestDatabase,
} from '@socketspace/db/testing';
import {
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  signInternalRequest,
} from '@socketspace/shared/internal-events';

import { createRealtimeServer, type RealtimeServer } from './app';
import { loadRealtimeEnv } from './env';
import { createLogger } from './logger';
import { nextEvent, request, TEST_ENV, WEB_ORIGIN } from './test/harness';

const redisUrl = process.env.REDIS_TEST_URL;

describe.skipIf(!redisUrl)('two instances with Redis (RT-07)', () => {
  let database: TestDatabase;
  const servers: { server: RealtimeServer; url: string }[] = [];
  const redisClients: ReturnType<typeof createClient>[] = [];
  const sockets: ClientSocket[] = [];
  let sign: (userId: string, sessionId: string) => Promise<string>;
  const env = loadRealtimeEnv({ ...TEST_ENV, REDIS_URL: redisUrl ?? '' });

  beforeAll(async () => {
    database = await createTestDatabase();
    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const jwk = { ...(await exportJWK(publicKey)), alg: 'EdDSA', kid: 'k' };
    sign = (userId, sessionId) =>
      new SignJWT({ sid: sessionId, role: 'user', guest: false })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'k' })
        .setSubject(userId)
        .setIssuer(WEB_ORIGIN)
        .setAudience(env.REALTIME_TOKEN_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);

    for (let i = 0; i < 2; i++) {
      const pub = createClient({ url: redisUrl });
      const sub = pub.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      redisClients.push(pub, sub);
      const server = createRealtimeServer({
        env,
        db: database.db,
        keys: createLocalJWKSet({ keys: [jwk] }),
        checkKeys: () => Promise.resolve(true),
        logger: createLogger('silent'),
        redis: { pub, sub },
      });
      const port = await server.listen(0, '127.0.0.1');
      servers.push({ server, url: `http://127.0.0.1:${String(port)}` });
    }
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    for (const { server } of servers) await server.stop();
    await Promise.allSettled(redisClients.map((c) => c.quit()));
    await database.close();
  });

  async function connectTo(
    index: number,
    userId: string,
  ): Promise<{ socket: ClientSocket; sessionId: string }> {
    const sessionId = newId();
    await database.db.insert(schema.session).values({
      id: sessionId,
      userId,
      token: randomBytes(16).toString('hex'),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const token = await sign(userId, sessionId);
    const target = servers[index];
    if (!target) throw new Error('no server');
    const socket = connectClient(target.url, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      auth: { token },
      extraHeaders: { origin: WEB_ORIGIN },
    });
    sockets.push(socket);
    await nextEvent(socket, 'server:hello');
    return { socket, sessionId };
  }

  it('delivers a message sent through instance A to a member on instance B', async () => {
    const ava = await createTestUser(database.db);
    const sam = await createTestUser(database.db);
    const room = await createTestRoom(database.db, ava.id, [sam.id]);
    const { socket: onA } = await connectTo(0, ava.id);
    const { socket: onB } = await connectTo(1, sam.id);

    const received = nextEvent<{ message: { body: string } }>(onB, 'message:new');
    const ack = await request(onA, 'message:send', {
      conversationId: room.id,
      clientId: uuidv4(),
      body: 'across',
    });
    expect(ack.ok).toBe(true);
    expect((await received).message.body).toBe('across');
  });

  it('disconnects a socket on instance B when instance A receives the revocation', async () => {
    const kim = await createTestUser(database.db);
    const { socket: onB, sessionId } = await connectTo(1, kim.id);
    const disconnected = nextEvent(onB, 'disconnect');

    const body = JSON.stringify({
      id: newId(),
      at: new Date().toISOString(),
      type: 'session.revoked',
      userId: kim.id,
      sessionIds: [sessionId],
    });
    const timestamp = String(Date.now());
    const response = await fetch(`${servers[0]?.url ?? ''}/internal/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [INTERNAL_TIMESTAMP_HEADER]: timestamp,
        [INTERNAL_SIGNATURE_HEADER]: await signInternalRequest(
          env.INTERNAL_EVENTS_SECRET,
          timestamp,
          body,
        ),
      },
      body,
    });
    expect(response.status).toBe(204);
    expect(await disconnected).toBe('io server disconnect');
  });
});
