/**
 * The web app's database connection: one small pool per server instance, created on first use.
 * Idle connections close after 10 seconds, so a quiet app lets Neon's free compute go to sleep
 * (decision D-011).
 */
import 'server-only';

import { createPgDatabase, type Database } from '@socketspace/db';

import { getWebEnv } from './env';
import { getLogger } from './logger-instance';

let database: Database | undefined;

export function getDb(): Database {
  if (!database) {
    const env = getWebEnv();
    database = createPgDatabase({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      idleTimeoutMillis: 10_000,
      applicationName: 'socketspace-web',
      onError: (error) => {
        getLogger().warn('idle database connection failed', { error });
      },
    }).db;
  }
  return database;
}
