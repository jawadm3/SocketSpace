/**
 * Which database a script works on.
 *
 * `--local` means the development server started by `pnpm db:start` (no password: it only listens
 * on 127.0.0.1). Otherwise the connection string comes from DATABASE_URL_DIRECT (preferred for
 * migrations: Neon's direct, non-pooled endpoint) or DATABASE_URL.
 */
import { z } from 'zod';

import { parseEnv } from '@socketspace/shared/env';

const LOCAL_PORT = process.env.LOCAL_PG_PORT ?? '54329';
const LOCAL_DATABASE = process.env.LOCAL_PG_DATABASE ?? 'socketspace';

export function resolveTarget(argv: readonly string[]): { url: string; label: string } {
  if (argv.includes('--local')) {
    const url = `postgres://socketspace@127.0.0.1:${LOCAL_PORT}/${LOCAL_DATABASE}`;
    return { url, label: url };
  }
  const env = parseEnv(
    z.object({
      DATABASE_URL_DIRECT: z.string().optional(),
      DATABASE_URL: z.string().optional(),
    }),
    process.env,
  );
  const url = env.DATABASE_URL_DIRECT ?? env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Set DATABASE_URL_DIRECT or DATABASE_URL, or pass --local for the development database.',
    );
  }
  // Print only where we are connecting, never the password.
  const parsed = new URL(url);
  return { url, label: `${parsed.hostname}${parsed.pathname}` };
}
