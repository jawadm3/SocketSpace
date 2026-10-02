/**
 * Runs the real Better Auth configuration against a fresh PGlite database, with a memory mail
 * driver and a recording realtime notifier. Requests go through `auth.handler`, exactly like HTTP
 * requests in production, so rate limits, origin checks, disabled paths and cookies all apply.
 */
import { createTestDatabase, type TestDatabase } from '@socketspace/db/testing';
import { parseEnv } from '@socketspace/shared/env';

import { createAuth, type Auth } from '../server/auth';
import { MemoryEmailSender } from '../server/email';
import { checkWebEnv, webEnvSchema, type WebEnv } from '../server/env';
import { createLogger } from '../server/log';
import { RecordingNotifier } from '../server/realtime-events';

/** Test-only configuration. The secrets are deliberately obvious placeholders. */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused-in-tests',
  BETTER_AUTH_SECRET: 'test'.repeat(10),
  BETTER_AUTH_URL: 'http://localhost:3000',
  REALTIME_PUBLIC_URL: 'http://localhost:4000',
  INTERNAL_EVENTS_SECRET: 'internal'.repeat(5),
  EMAIL_DRIVER: 'memory',
  HIBP_ENABLED: 'false',
  AUTH_RATE_LIMIT_ENABLED: 'true',
};

export interface CallOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  cookie?: string;
  /** Client IP, sent in the x-forwarded-for header. */
  ip?: string;
  /** Origin header; defaults to the app's own origin. `null` sends none. */
  origin?: string | null;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface CallResult {
  status: number;
  json: unknown;
  headers: Headers;
  /** `name=value` pairs from every Set-Cookie header (empty values mean "deleted"). */
  cookies: Map<string, string>;
  setCookieHeaders: string[];
}

export interface AuthHarness {
  db: TestDatabase['db'];
  env: WebEnv;
  auth: Auth;
  mail: MemoryEmailSender;
  notifier: RecordingNotifier;
  /** Waits for work deferred until "after the response" (emails, notifications). */
  flush: () => Promise<void>;
  call: (path: string, options?: CallOptions) => Promise<CallResult>;
  close: () => Promise<void>;
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

let ipCounter = 0;
/** A fresh documentation-range IP address, so tests do not share rate-limit buckets. */
export function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${String(ipCounter % 250)}`;
}

export async function createAuthHarness(
  overrides: Record<string, string> = {},
): Promise<AuthHarness> {
  const database = await createTestDatabase();
  const env = checkWebEnv(parseEnv(webEnvSchema, { ...TEST_ENV, ...overrides }));
  const mail = new MemoryEmailSender();
  const notifier = new RecordingNotifier();
  const pending: Promise<void>[] = [];
  const auth = createAuth({
    db: database.db,
    env,
    email: mail,
    notifier,
    logger: createLogger('silent'),
    defer: (task) => {
      pending.push(task());
    },
  });

  const call = async (path: string, options: CallOptions = {}): Promise<CallResult> => {
    const url = new URL(`/api/auth${path}`, env.BETTER_AUTH_URL);
    for (const [key, value] of Object.entries(options.query ?? {}))
      url.searchParams.set(key, value);
    const headers = new Headers({ 'x-forwarded-for': options.ip ?? nextIp() });
    const origin =
      options.origin === undefined ? new URL(env.BETTER_AUTH_URL).origin : options.origin;
    if (origin !== null) headers.set('origin', origin);
    if (options.cookie) headers.set('cookie', options.cookie);
    for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    const response = await auth.handler(
      new Request(url, {
        method,
        headers,
        ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
        redirect: 'manual',
      }),
    );
    const text = await response.text();
    const json = parseBody(text);
    const setCookieHeaders = response.headers.getSetCookie();
    const cookies = new Map<string, string>();
    for (const header of setCookieHeaders) {
      const [pair] = header.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (pair && index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return { status: response.status, json, headers: response.headers, cookies, setCookieHeaders };
  };

  return {
    db: database.db,
    env,
    auth,
    mail,
    notifier,
    flush: async () => {
      while (pending.length > 0) await Promise.all(pending.splice(0));
    },
    call,
    close: database.close,
  };
}

/** Builds a Cookie header from the cookies a response set (skipping deleted ones). */
export function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies.entries()]
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}
