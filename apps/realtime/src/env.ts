/**
 * The realtime server's configuration, from environment variables, validated at start-up.
 * Every variable is described in apps/realtime/.env.example.
 */
import { z } from 'zod';

import {
  envBoolean,
  envHttpUrl,
  envInt,
  envLogLevel,
  envOriginList,
  envSecret,
  parseEnv,
  type EnvSource,
} from '@socketspace/shared/env';
import { LIMITS } from '@socketspace/shared/limits';

const positive = (max: number) => envInt.pipe(z.number().int().min(1).max(max));

export const realtimeEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Render (and most hosts) set PORT. */
  PORT: envInt.pipe(z.number().int().min(1).max(65535)).default(4000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: positive(50).default(5),
  /** Close idle database connections after this long, so a quiet server lets Neon sleep. */
  DB_IDLE_TIMEOUT_MS: positive(3_600_000).default(60_000),

  /** Browser origins allowed to connect, comma-separated (for example the web app's address). */
  WEB_ORIGINS: envOriginList,
  /** The web app's public keys for verifying connection tokens. */
  AUTH_JWKS_URL: envHttpUrl,
  /** The `iss` claim tokens must carry: the web app's origin. */
  AUTH_ISSUER: envHttpUrl,
  REALTIME_TOKEN_AUDIENCE: z.string().default(LIMITS.realtimeToken.audience),

  INTERNAL_EVENTS_SECRET: envSecret(32),
  /** Bearer token protecting /metrics. */
  METRICS_TOKEN: envSecret(24),

  /** Optional: switches on fan-out across several instances (decision D-010). */
  REDIS_URL: z.string().optional(),
  /** Socket.IO's short-drop recovery (in-memory adapter only; resync is the real guarantee). */
  CONNECTION_RECOVERY: envBoolean.default(true),

  /** How many reverse proxies sit in front of the server (Render: 1). Used to find client IPs. */
  TRUST_PROXY_HOPS: envInt.pipe(z.number().int().min(0).max(5)).default(0),
  MAX_CONNECTIONS_PER_USER: positive(1000).default(LIMITS.connections.perUser),
  MAX_CONNECTIONS_PER_IP: positive(10_000).default(LIMITS.connections.perIp),
  NEW_CONNECTIONS_PER_IP_PER_MINUTE: positive(10_000).default(LIMITS.connections.newPerIpPerMinute),

  /** The kill switch for random-match mode (RAND-11): `false` refuses every random event. */
  RANDOM_MODE_ENABLED: envBoolean.default(true),

  /** Time allowed for a clean shutdown before the process exits anyway. */
  SHUTDOWN_GRACE_MS: positive(60_000).default(10_000),
  LOG_LEVEL: envLogLevel.default('info'),
});

export type RealtimeEnv = z.infer<typeof realtimeEnvSchema>;

export function loadRealtimeEnv(source: EnvSource = process.env): RealtimeEnv {
  return parseEnv(realtimeEnvSchema, source);
}
