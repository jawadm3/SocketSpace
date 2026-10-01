/**
 * Test helpers: a fresh, fully migrated database per test file, plus small fixture builders.
 *
 * By default the database is PGlite: real PostgreSQL compiled to WebAssembly, running inside the
 * test process, so tests need no installed database and no Docker.
 *
 * When TEST_DATABASE_URL points at a real PostgreSQL server (CI does this with a Postgres service
 * container), each call creates a throwaway database on that server instead, so the same tests
 * also run against real PostgreSQL with real concurrency. The URL must allow CREATE DATABASE.
 */
import { randomBytes } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';

import { createPgDatabase, type Database } from '../client';
import { migratePostgres, migrationsFolder } from '../migrate';
import * as schema from '../schema';
import { newId } from '../schema/_common';
import { user } from '../schema/auth';
import { conversation, conversationMember } from '../schema/conversations';

export interface TestDatabase {
  db: Database;
  /** `pglite` or `postgres`, so tests can skip checks that need real concurrency. */
  engine: 'pglite' | 'postgres';
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  return serverUrl ? createServerDatabase(serverUrl) : createPgliteDatabase();
}

async function createPgliteDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder });
  return {
    db,
    engine: 'pglite',
    close: () => client.close(),
  };
}

async function createServerDatabase(serverUrl: string): Promise<TestDatabase> {
  const name = `ss_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  await migratePostgres(url.toString());
  const handle = createPgDatabase({ connectionString: url.toString(), max: 10 });

  return {
    db: handle.db,
    engine: 'postgres',
    close: async () => {
      await handle.close();
      const cleanup = new pg.Client({ connectionString: serverUrl });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

/**
 * Rows from `db.execute(sql...)`. node-postgres and PGlite both return an object with a `rows`
 * array, but the shared `Database` type cannot know which driver is in use.
 */
export function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

let counter = 0;

export interface TestUserOptions {
  nickname?: string | null;
  email?: string;
  emailVerified?: boolean;
  onboarded?: boolean;
  isAnonymous?: boolean;
  status?: 'active' | 'suspended' | 'banned' | 'deleted';
  role?: 'user' | 'admin';
  name?: string;
}

/** Inserts a user. By default: verified, onboarded, active, with a unique nickname. */
export async function createTestUser(
  db: Database,
  options: TestUserOptions = {},
): Promise<{ id: string; nickname: string | null; email: string }> {
  counter += 1;
  const id = newId();
  const onboarded = options.onboarded ?? true;
  const nickname =
    options.nickname === undefined
      ? onboarded
        ? `user${String(counter)}`
        : null
      : options.nickname;
  const email = options.email ?? `user${String(counter)}-${id.slice(-6)}@example.test`;
  await db.insert(user).values({
    id,
    email,
    name: options.name ?? '',
    emailVerified: options.emailVerified ?? true,
    isAnonymous: options.isAnonymous ?? false,
    status: options.status ?? 'active',
    role: options.role ?? 'user',
    nickname,
    avatarKind: onboarded ? 'preset' : null,
    avatarConfig: onboarded ? { style: 'test', seed: nickname } : null,
    onboardedAt: onboarded ? new Date() : null,
  });
  return { id, nickname, email };
}

/** Inserts a room owned by `ownerId` and adds `memberIds` as members. */
export async function createTestRoom(
  db: Database,
  ownerId: string,
  memberIds: readonly string[] = [],
  options: { visibility?: 'public' | 'private'; slug?: string } = {},
): Promise<{ id: string; slug: string }> {
  counter += 1;
  const id = newId();
  const slug = options.slug ?? `room-${String(counter)}`;
  await db.insert(conversation).values({
    id,
    kind: 'room',
    visibility: options.visibility ?? 'public',
    slug,
    name: `Room ${String(counter)}`,
    createdBy: ownerId,
    memberCount: 1 + memberIds.length,
  });
  await db
    .insert(conversationMember)
    .values([
      { conversationId: id, userId: ownerId, role: 'owner' },
      ...memberIds.map((userId) => ({ conversationId: id, userId, role: 'member' as const })),
    ]);
  return { id, slug };
}

/** Inserts a DM between two users (both become members). */
export async function createTestDm(db: Database, a: string, b: string): Promise<{ id: string }> {
  const id = newId();
  await db.insert(conversation).values({
    id,
    kind: 'dm',
    visibility: 'private',
    dmKey: [a, b].sort().join(':'),
    createdBy: a,
    memberCount: 2,
  });
  await db.insert(conversationMember).values([
    { conversationId: id, userId: a },
    { conversationId: id, userId: b },
  ]);
  return { id };
}
