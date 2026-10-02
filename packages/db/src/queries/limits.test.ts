import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authLockout } from '../schema/auth';
import { createTestDatabase, type TestDatabase } from '../testing';
import {
  LOCKOUT_POLICY,
  clearFailedSignIns,
  getLockoutRemainingMs,
  hitRateLimit,
  lockSecondsFor,
  recordFailedSignIn,
} from './limits';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

describe('hitRateLimit', () => {
  it('allows up to the limit in a window, then refuses with a retry time', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hitRateLimit(t.db, 'token:user-1', 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4]);
    const last = results[3];
    expect(last?.retryAfterMs).toBeGreaterThan(0);
    expect(last?.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('counts keys separately', async () => {
    await hitRateLimit(t.db, 'token:a', 1, 60);
    expect((await hitRateLimit(t.db, 'token:b', 1, 60)).allowed).toBe(true);
    expect((await hitRateLimit(t.db, 'token:a', 1, 60)).allowed).toBe(false);
  });
});

describe('sign-in lockout', () => {
  it('locks after 10 failures with growing delays capped at an hour', () => {
    expect(lockSecondsFor(9)).toBe(0);
    expect(lockSecondsFor(10)).toBe(60);
    expect(lockSecondsFor(11)).toBe(120);
    expect(lockSecondsFor(12)).toBe(240);
    expect(lockSecondsFor(30)).toBe(LOCKOUT_POLICY.maxLockSeconds);
  });

  it('records failures and reports the lock', async () => {
    const key = 'hash-ava';
    for (let i = 1; i <= 9; i++) {
      expect(await recordFailedSignIn(t.db, key)).toEqual({ failures: i, lockedForMs: 0 });
    }
    expect(await getLockoutRemainingMs(t.db, key)).toBe(0);
    expect(await recordFailedSignIn(t.db, key)).toEqual({ failures: 10, lockedForMs: 60_000 });
    const remaining = await getLockoutRemainingMs(t.db, key);
    expect(remaining).toBeGreaterThan(55_000);
    expect(remaining).toBeLessThanOrEqual(60_000);
  });

  it('clears the record after a successful sign-in', async () => {
    const key = 'hash-sam';
    for (let i = 0; i < 10; i++) await recordFailedSignIn(t.db, key);
    await clearFailedSignIns(t.db, key);
    expect(await getLockoutRemainingMs(t.db, key)).toBe(0);
    expect((await recordFailedSignIn(t.db, key)).failures).toBe(1);
  });

  it('starts counting again after a quiet day', async () => {
    const key = 'hash-kim';
    for (let i = 0; i < 5; i++) await recordFailedSignIn(t.db, key);
    await t.db
      .update(authLockout)
      .set({ firstFailureAt: sql`now() - interval '25 hours'` })
      .where(eq(authLockout.keyHash, key));
    expect((await recordFailedSignIn(t.db, key)).failures).toBe(1);
  });

  it('reports 0 for unknown keys', async () => {
    expect(await getLockoutRemainingMs(t.db, 'never-seen')).toBe(0);
  });
});
