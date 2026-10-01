/**
 * Reading accounts for connection checks, and completing onboarding (nickname + avatar).
 */
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import type { Queryable } from '../client';
import { dbNow } from '../clock';
import { user } from '../schema/auth';
import { userSanction } from '../schema/safety';

export interface ConnectionProfile {
  id: string;
  status: 'active' | 'suspended' | 'banned' | 'deleted';
  role: 'user' | 'admin';
  isAnonymous: boolean;
  emailVerified: boolean;
  onboarded: boolean;
  nickname: string | null;
}

/** What the realtime server needs to know about a user when they connect. */
export async function getConnectionProfile(
  db: Queryable,
  userId: string,
): Promise<ConnectionProfile | null> {
  const [row] = await db
    .select({
      id: user.id,
      status: user.status,
      role: user.role,
      isAnonymous: user.isAnonymous,
      emailVerified: user.emailVerified,
      onboardedAt: user.onboardedAt,
      nickname: user.nickname,
    })
    .from(user)
    .where(eq(user.id, userId));
  if (!row) return null;
  const { onboardedAt, ...rest } = row;
  return { ...rest, onboarded: onboardedAt !== null };
}

export interface ActiveSanction {
  id: string;
  kind: 'warn' | 'mute' | 'suspend' | 'ban' | 'random_timeout';
  scope: 'global' | 'random';
  reason: string;
  expiresAt: Date | null;
}

/** Sanctions in force right now (started, not lifted, not expired), by the database clock. */
export async function getActiveSanctions(
  db: Queryable,
  userId: string,
  fixedNow?: Date,
): Promise<ActiveSanction[]> {
  const now = dbNow(fixedNow);
  return db
    .select({
      id: userSanction.id,
      kind: userSanction.kind,
      scope: userSanction.scope,
      reason: userSanction.reason,
      expiresAt: userSanction.expiresAt,
    })
    .from(userSanction)
    .where(
      and(
        eq(userSanction.userId, userId),
        isNull(userSanction.liftedAt),
        lte(userSanction.startsAt, now),
        or(isNull(userSanction.expiresAt), gt(userSanction.expiresAt, now)),
      ),
    );
}

/** True if no account uses this nickname in any letter case. */
export async function isNicknameAvailable(db: Queryable, nickname: string): Promise<boolean> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.nickname}) = lower(${nickname})`)
    .limit(1);
  return !row;
}

/** Of `candidates`, those that are free, in the same order (one query). */
export async function filterAvailableNicknames(
  db: Queryable,
  candidates: readonly string[],
): Promise<string[]> {
  if (candidates.length === 0) return [];
  const lowered = candidates.map((c) => c.toLowerCase());
  const taken = await db
    .select({ nickname: sql<string>`lower(${user.nickname})` })
    .from(user)
    .where(sql`lower(${user.nickname}) in ${lowered}`);
  const takenSet = new Set(taken.map((t) => t.nickname));
  return candidates.filter((c) => !takenSet.has(c.toLowerCase()));
}

export interface OnboardingInput {
  nickname: string;
  avatarKind: 'preset' | 'custom' | 'photo';
  avatarConfig: unknown;
  now?: Date;
}

export type OnboardingResult = { ok: true } | { ok: false; reason: 'nickname_taken' | 'not_found' };

/**
 * Saves the nickname and avatar and marks onboarding complete. The case-insensitive unique index
 * on the nickname decides races: if two people claim the same nickname at once, one gets
 * `nickname_taken`.
 */
export async function completeOnboarding(
  db: Queryable,
  userId: string,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  try {
    const updated = await db
      .update(user)
      .set({
        nickname: input.nickname,
        avatarKind: input.avatarKind,
        avatarConfig: input.avatarConfig,
        onboardedAt: input.now ?? sql`now()`,
      })
      .where(eq(user.id, userId))
      .returning({ id: user.id });
    return updated.length > 0 ? { ok: true } : { ok: false, reason: 'not_found' };
  } catch (error) {
    if (isNicknameConflict(error)) return { ok: false, reason: 'nickname_taken' };
    throw error;
  }
}

function isNicknameConflict(error: unknown): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    const candidate = current as { code?: unknown; message?: unknown; constraint?: unknown };
    if (
      candidate.code === '23505' &&
      (candidate.constraint === 'user_nickname_lower_uq' ||
        (typeof candidate.message === 'string' &&
          candidate.message.includes('user_nickname_lower_uq')))
    ) {
      return true;
    }
  }
  return false;
}
