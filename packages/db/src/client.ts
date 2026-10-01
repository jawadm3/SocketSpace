/**
 * Database connections.
 *
 * Production and local development use node-postgres (`pg`) with a small connection pool.
 * Tests use PGlite (real PostgreSQL compiled to WebAssembly, see ./testing). Both produce a Drizzle
 * database with the same type, `Database`, so every query in this package is written once.
 *
 * Neon free-tier rule (decision D-011): no permanent connections. Idle pool connections close
 * after `idleTimeoutMillis`, so a quiet app lets the database go to sleep.
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema';

export type Schema = typeof schema;
export type Database = PgDatabase<PgQueryResultHKT, Schema>;
/** The object Drizzle passes to a `db.transaction(async (tx) => ...)` callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything a query can run on: the database itself or an open transaction. */
export type Queryable = Database | Transaction;

export interface PgConnectionOptions {
  connectionString: string;
  /** Maximum open connections. Keep small: Neon's free plan counts compute time. */
  max?: number;
  /** Close a connection after it has been idle this long. */
  idleTimeoutMillis?: number;
  /** Give up connecting after this long (Neon can take a moment to wake up). */
  connectionTimeoutMillis?: number;
  /** Shown in `pg_stat_activity`, handy when debugging. */
  applicationName?: string;
  /** Called when an idle connection fails (for example the server closed it). */
  onError?: (error: Error) => void;
}

export interface PgHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createPgDatabase(options: PgConnectionOptions): PgHandle {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 5,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 60_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 15_000,
    application_name: options.applicationName ?? 'socketspace',
    // Let the process exit when the pool is idle (important for scripts and graceful shutdown).
    allowExitOnIdle: true,
  });
  // Without a listener, an error on an idle connection would crash the process.
  pool.on('error', (error) => {
    options.onError?.(error);
  });

  const db = drizzle({ client: pool, schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

/** Runs `SELECT 1`: used by readiness checks. Throws if the database is unreachable. */
export async function pingDatabase(db: Queryable): Promise<void> {
  await db.execute('select 1');
}
