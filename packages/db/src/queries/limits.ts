/**
 * Database-backed limits for the web app, which runs as many short-lived serverless instances
 * (so in-memory counters would not be shared):
 *
 * - `hitRateLimit`: fixed-window request counters (`http_rate_limit`).
 * - Sign-in lockout per account (`auth_lockout`, security.md 3.1): after 10 failed sign-ins the
 *   account is locked for 1 minute, then 2, 4, 8 ... up to 60 minutes per further failure.
 *   A success clears the record; a quiet day starts the count again.
 *
 * All times come from the database clock (decision D-027).
 */
import { eq, sql } from 'drizzle-orm';

import type { Queryable } from '../client';
import { authLockout } from '../schema/auth';
import { httpRateLimit } from '../schema/ops';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  /** Milliseconds until the current window ends. */
  retryAfterMs: number;
}

/** Counts one request for `key` in the current window and says whether it is within `limit`. */
export async function hitRateLimit(
  db: Queryable,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowStart = sql`to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds})`;
  const [row] = await db
    .insert(httpRateLimit)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [httpRateLimit.key, httpRateLimit.windowStart],
      set: { count: sql`${httpRateLimit.count} + 1` },
    })
    .returning({
      count: httpRateLimit.count,
      retryAfterMs: sql<string>`ceil(extract(epoch from (${httpRateLimit.windowStart} + make_interval(secs => ${windowSeconds}) - now())) * 1000)`,
    });
  if (!row) throw new Error('rate limit upsert returned no row');
  return {
    allowed: row.count <= limit,
    count: row.count,
    retryAfterMs: Math.max(0, Number(row.retryAfterMs)),
  };
}

export const LOCKOUT_POLICY = {
  /** Failed sign-ins allowed before the first lock. */
  freeFailures: 10,
  firstLockSeconds: 60,
  maxLockSeconds: 60 * 60,
  /** After this long without a failure, counting starts again. */
  resetAfterSeconds: 24 * 60 * 60,
} as const;

/** How long the lock lasts after `failures` failed attempts (0 = not locked). */
export function lockSecondsFor(failures: number): number {
  const over = failures - LOCKOUT_POLICY.freeFailures;
  if (over < 0) return 0;
  return Math.min(LOCKOUT_POLICY.firstLockSeconds * 2 ** over, LOCKOUT_POLICY.maxLockSeconds);
}

/** Milliseconds until the account may try again, or 0 if it is not locked. */
export async function getLockoutRemainingMs(db: Queryable, keyHash: string): Promise<number> {
  const [row] = await db
    .select({
      remaining: sql<
        string | null
      >`ceil(extract(epoch from (${authLockout.lockedUntil} - now())) * 1000)`,
    })
    .from(authLockout)
    .where(eq(authLockout.keyHash, keyHash));
  const remaining = row?.remaining == null ? 0 : Number(row.remaining);
  return remaining > 0 ? remaining : 0;
}

/** Records a failed sign-in and returns the failure count and any lock now in force. */
export async function recordFailedSignIn(
  db: Queryable,
  keyHash: string,
): Promise<{ failures: number; lockedForMs: number }> {
  const stale = sql`${authLockout.firstFailureAt} < now() - make_interval(secs => ${LOCKOUT_POLICY.resetAfterSeconds})`;
  const [row] = await db
    .insert(authLockout)
    .values({ keyHash, failures: 1 })
    .onConflictDoUpdate({
      target: authLockout.keyHash,
      set: {
        failures: sql`case when ${stale} then 1 else ${authLockout.failures} + 1 end`,
        firstFailureAt: sql`case when ${stale} then now() else ${authLockout.firstFailureAt} end`,
        lockedUntil: sql`case when ${stale} then null else ${authLockout.lockedUntil} end`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ failures: authLockout.failures });
  const failures = row?.failures ?? 1;
  const lockSeconds = lockSecondsFor(failures);
  if (lockSeconds > 0) {
    await db
      .update(authLockout)
      .set({ lockedUntil: sql`now() + make_interval(secs => ${lockSeconds})` })
      .where(eq(authLockout.keyHash, keyHash));
  }
  return { failures, lockedForMs: lockSeconds * 1000 };
}

/** A successful sign-in clears the failure record. */
export async function clearFailedSignIns(db: Queryable, keyHash: string): Promise<void> {
  await db.delete(authLockout).where(eq(authLockout.keyHash, keyHash));
}
