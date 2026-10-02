/**
 * The web app's configuration, read from environment variables and validated once.
 * Every variable is described in apps/web/.env.example. A missing or malformed variable stops the
 * app with a message naming it (never its value).
 *
 * Read lazily (on first use, not at import time), because `next build` imports server modules
 * without the runtime environment.
 */
import 'server-only';

import { z } from 'zod';

import {
  envBoolean,
  envHttpUrl,
  envInt,
  envLogLevel,
  envSecret,
  parseEnv,
  type EnvSource,
} from '@socketspace/shared/env';

const optional = z.string().optional();

export const webEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Set by Vercel: `production`, `preview` or `development`. */
  VERCEL_ENV: z.string().optional(),

  // Database
  DATABASE_URL: z.string().min(1),
  /** Connections per server instance. Keep small on serverless hosting. */
  DB_POOL_MAX: envInt.pipe(z.number().int().min(1).max(20)).default(3),

  // Auth
  BETTER_AUTH_SECRET: envSecret(32),
  /** Public address of this web app, for example https://socketspace.vercel.app */
  BETTER_AUTH_URL: envHttpUrl,
  /** Breached-password check against Have I Been Pwned (only a 5-character hash prefix is sent). */
  HIBP_ENABLED: envBoolean.default(true),
  AUTH_RATE_LIMIT_ENABLED: envBoolean.default(true),
  /** The request header that carries the visitor's IP address (set by the hosting platform). */
  CLIENT_IP_HEADER: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default('x-forwarded-for'),

  // Social sign-in (each provider appears only when both its ID and secret are set; D-022)
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  FACEBOOK_CLIENT_ID: optional,
  FACEBOOK_CLIENT_SECRET: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  DISCORD_CLIENT_ID: optional,
  DISCORD_CLIENT_SECRET: optional,
  MICROSOFT_CLIENT_ID: optional,
  MICROSOFT_CLIENT_SECRET: optional,
  MICROSOFT_TENANT_ID: z.string().default('common'),
  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,

  // Passkeys (WebAuthn): the "relying party" is this site.
  PASSKEY_RP_ID: optional,
  PASSKEY_RP_NAME: z.string().default('SocketSpace'),

  // Email
  EMAIL_DRIVER: z.enum(['resend', 'file', 'memory']).default('file'),
  EMAIL_FROM: z.string().default('SocketSpace <no-reply@localhost>'),
  RESEND_API_KEY: optional,
  /** Where the `file` driver writes emails (the local "mail catcher"). */
  DEV_MAIL_DIR: optional,

  // Realtime server
  /** Where browsers connect for live updates, for example https://socketspace-rt.onrender.com */
  REALTIME_PUBLIC_URL: envHttpUrl,
  /** Where this app sends internal events. Defaults to REALTIME_PUBLIC_URL. */
  REALTIME_INTERNAL_URL: envHttpUrl.optional(),
  INTERNAL_EVENTS_SECRET: envSecret(32),

  LOG_LEVEL: envLogLevel.default('info'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

/** Extra rules that involve more than one variable. */
export function checkWebEnv(env: WebEnv): WebEnv {
  const problems: string[] = [];
  if (env.EMAIL_DRIVER === 'resend' && !env.RESEND_API_KEY) {
    problems.push('RESEND_API_KEY: required when EMAIL_DRIVER=resend');
  }
  if (env.VERCEL_ENV === 'production' && env.EMAIL_DRIVER !== 'resend') {
    problems.push('EMAIL_DRIVER: must be "resend" in production');
  }
  if (env.NODE_ENV === 'production' && !env.BETTER_AUTH_URL.startsWith('https://')) {
    // Plain http is only acceptable on this computer (local production builds and E2E tests).
    const host = new URL(env.BETTER_AUTH_URL).hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      problems.push('BETTER_AUTH_URL: must use https in production');
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
  return env;
}

let cached: WebEnv | undefined;

export function getWebEnv(source: EnvSource = process.env): WebEnv {
  cached ??= checkWebEnv(parseEnv(webEnvSchema, source));
  return cached;
}
