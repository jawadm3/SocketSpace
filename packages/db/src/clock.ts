import { sql, type SQL } from 'drizzle-orm';

/**
 * "Now" for time checks inside queries (mute expiry, sanction start and end, bans).
 *
 * Normally this is the database's own clock (`now()`), so a comparison never mixes two clocks:
 * the app server's and the database server's can differ, and JavaScript dates only have
 * millisecond precision while PostgreSQL stores microseconds. Tests pass a fixed instant instead.
 */
export function dbNow(fixed?: Date): SQL {
  return fixed ? sql`${fixed.toISOString()}::timestamptz` : sql`now()`;
}
