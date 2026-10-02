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
export * from './queries/messages';
export * from './queries/users';
export * from './queries/conversations';
export * from './queries/limits';
export * from './queries/outbox';
export * from './queries/people';
export * from './queries/rooms';
export { toMessageWire } from './wire';
export { isUniqueViolation } from './errors';
// The query-building operators, re-exported so apps use this package's Drizzle instance.
export { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
