/**
 * Entry point: `node dist/server.mjs` (production) or `pnpm dev` (development).
 * Reads and validates the environment, connects to the database (and Redis if configured), starts
 * listening, applies any pending outbox events, and shuts down cleanly on SIGTERM / SIGINT.
 */
import { createClient } from 'redis';

import { closeOpenRandomSessions, createPgDatabase } from '@socketspace/db';
import { EnvError } from '@socketspace/shared/env';

import { createRealtimeServer, type RedisClients } from './app';
import { loadRealtimeEnv, type RealtimeEnv } from './env';
import { describeError } from './handlers/define';
import { createLogger } from './logger';
import { remoteKeySource } from './token';

async function connectRedis(
  url: string,
  logger: ReturnType<typeof createLogger>,
): Promise<{ clients: RedisClients; quit: () => Promise<void> }> {
  const pub = createClient({ url });
  const sub = pub.duplicate();
  for (const client of [pub, sub]) {
    client.on('error', (error: unknown) => {
      logger.warn({ error: describeError(error) }, 'redis error');
    });
  }
  await Promise.all([pub.connect(), sub.connect()]);
  return {
    clients: { pub, sub },
    quit: async () => {
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}

async function main(): Promise<void> {
  let env: RealtimeEnv;
  try {
    env = loadRealtimeEnv();
  } catch (error) {
    // The message names the problem variables, never their values.
    console.error(error instanceof EnvError ? error.message : error);
    process.exit(1);
  }

  const logger = createLogger(env.LOG_LEVEL);
  const database = createPgDatabase({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    applicationName: 'socketspace-realtime',
    onError: (error) => {
      logger.warn({ error: describeError(error) }, 'idle database connection failed');
    },
  });
  const redis = env.REDIS_URL ? await connectRedis(env.REDIS_URL, logger) : undefined;

  const server = createRealtimeServer({
    env,
    db: database.db,
    closeDb: database.close,
    keys: remoteKeySource(env.AUTH_JWKS_URL),
    checkKeys: async () => {
      const response = await fetch(env.AUTH_JWKS_URL, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return false;
      const body = (await response.json()) as { keys?: unknown[] };
      return Array.isArray(body.keys) && body.keys.length > 0;
    },
    logger,
    ...(redis && { redis: redis.clients }),
  });

  const port = await server.listen(env.PORT, env.HOST);
  logger.info(
    { port, origins: env.WEB_ORIGINS, multiInstance: Boolean(redis) },
    'realtime server listening',
  );
  void server.outbox.drain();
  // Random chats live in memory, so chats a crashed server left open can never continue. With one
  // instance (no Redis) every open chat is such a leftover and is recorded as ended.
  if (!redis && env.RANDOM_MODE_ENABLED) {
    closeOpenRandomSessions(database.db).catch((error: unknown) => {
      logger.warn({ error: describeError(error) }, 'open random chats not closed');
    });
  }

  let exiting = false;
  const shutdown = (signal: string) => {
    if (exiting) return;
    exiting = true;
    logger.info({ signal }, 'received shutdown signal');
    // If something hangs, exit anyway within the grace period.
    setTimeout(() => {
      logger.warn('shutdown took too long; exiting');
      process.exit(1);
    }, env.SHUTDOWN_GRACE_MS).unref();
    void server
      .stop()
      .then(async () => {
        await redis?.quit();
        logger.info('shutdown complete');
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ error: describeError(error) }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

await main();
