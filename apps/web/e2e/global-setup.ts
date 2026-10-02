/**
 * Before the end-to-end run: a brand-new, fully migrated database and an empty mail folder.
 */
import { rm } from 'node:fs/promises';

import pg from 'pg';

import { migratePostgres } from '@socketspace/db/migrate';

import { E2E } from '../playwright.config';

export default async function globalSetup(): Promise<void> {
  const name = new URL(E2E.databaseUrl).pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes('e2e')) {
    throw new Error(`Refusing to reset "${name}": the E2E database name must contain "e2e".`);
  }
  const admin = new pg.Client({ connectionString: E2E.adminDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  await migratePostgres(E2E.databaseUrl);
  await rm(E2E.mailDir, { recursive: true, force: true });
}
