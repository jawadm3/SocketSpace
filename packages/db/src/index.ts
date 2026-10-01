/**
 * @socketspace/db: the database schema, connections, migrations and typed queries shared by the
 * web app and the realtime server.
 */
export * as schema from './schema';
export { newId } from './schema/_common';
export {
  createPgDatabase,
  pingDatabase,
  type Database,
  type PgConnectionOptions,
  type PgHandle,
  type Queryable,
  type Schema,
  type Transaction,
} from './client';
export { migratePostgres, migrationsFolder } from './migrate';
export * from './queries/messages';
export * from './queries/users';
export * from './queries/conversations';
