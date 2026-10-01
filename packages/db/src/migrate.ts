/**
 * Applies the SQL migrations in packages/db/migrations, in order, exactly once each.
 * Drizzle records applied migrations in the `drizzle.__drizzle_migrations` table.
 *
 * Migrations run as a deploy step (`pnpm db:migrate`), never automatically when an app starts
 * (docs/architecture/stack.md, "Migrations").
 */
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

export async function migratePostgres(connectionString: string): Promise<void> {
  // One dedicated connection: migrations must not share a pool with anything else.
  const client = new pg.Client({ connectionString, application_name: 'socketspace-migrate' });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end();
  }
}
