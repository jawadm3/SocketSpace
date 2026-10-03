/**
 * Reading accounts for connection checks, and completing onboarding (nickname + avatar).
 */
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import type { Database, Queryable } from '../client';
import { dbNow } from '../clock';
import { isUniqueViolation } from '../errors';
import { session, user } from '../schema/auth';
import { userSanction } from '../schema/safety';
import { claimAvatarPhoto, photoAttachmentId, releaseAvatarPhoto } from './attachments';

export interface ConnectionProfile {
  id: string;
  status: 'active' | 'suspended' | 'banned' | 'deleted';
  role: 'user' | 'admin';
  isAnonymous: boolean;
  emailVerified: boolean;
  onboarded: boolean;
  nickname: string | null;
  /** False in invisible mode: others always see this person as offline (PROF-02). */
  showPresence: boolean;
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
      showPresence: user.showPresence,
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
  startsAt: Date;
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
      startsAt: userSanction.startsAt,
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

export interface NameChoices {
  /** Optional real name; '' means none (D-028). */
  realName: string;
  realNameVisibility: 'nobody' | 'contacts' | 'everyone';
  nameDisplay: 'nickname' | 'real_name' | 'both';
}

export interface OnboardingInput {
  nickname: string;
  avatarKind: 'preset' | 'custom' | 'photo';
  avatarConfig: unknown;
  /** Left unchanged when omitted (for example a real name already taken from Google). */
  names?: NameChoices;
  now?: Date;
}

export type OnboardingResult =
  { ok: true } | { ok: false; reason: 'nickname_taken' | 'not_found' | 'avatar_invalid' };

/**
 * Saves the nickname and avatar and marks onboarding complete. The case-insensitive unique index
 * on the nickname decides races: if two people claim the same nickname at once, one gets
 * `nickname_taken`. A photo avatar must be the person's own unused upload (`avatar_invalid`
 * otherwise).
 */
export async function completeOnboarding(
  db: Database,
  userId: string,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ avatarConfig: user.avatarConfig })
        .from(user)
        .where(eq(user.id, userId))
        .for('update');
      if (!before) return { ok: false, reason: 'not_found' } as const;
      if (input.avatarKind === 'photo') {
        const photo = photoAttachmentId(input.avatarConfig);
        if (!photo || !(await claimAvatarPhoto(tx, userId, photo, before.avatarConfig))) {
          return { ok: false, reason: 'avatar_invalid' } as const;
        }
      }
      await tx
        .update(user)
        .set({
          nickname: input.nickname,
          avatarKind: input.avatarKind,
          avatarConfig: input.avatarConfig,
          ...(input.names && {
            name: input.names.realName,
            realNameVisibility: input.names.realNameVisibility,
            nameDisplay: input.names.nameDisplay,
          }),
          onboardedAt: input.now ?? sql`now()`,
        })
        .where(eq(user.id, userId));
      return { ok: true } as const;
    });
  } catch (error) {
    if (isNicknameConflict(error)) return { ok: false, reason: 'nickname_taken' };
    throw error;
  }
}

function isNicknameConflict(error: unknown): boolean {
  return isUniqueViolation(error, 'user_nickname_lower_uq');
}

export interface ProfileInput extends NameChoices {
  nickname: string;
  bio: string;
  /** Omitted: keep the current picture. */
  avatar?: { kind: 'preset' | 'custom' | 'photo'; config: unknown };
}

export type ProfileResult =
  | { ok: true; publicChanged: boolean }
  | { ok: false; reason: 'nickname_taken' | 'not_found' | 'not_onboarded' | 'avatar_invalid' };

/**
 * Saves profile settings (PROF-01). `publicChanged` says whether what everyone sees (nickname or
 * picture) changed, so the caller can tell people who share a conversation at once.
 */
export async function updateProfile(
  db: Database,
  userId: string,
  input: ProfileInput,
): Promise<ProfileResult> {
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select({
          nickname: user.nickname,
          avatarKind: user.avatarKind,
          avatarConfig: user.avatarConfig,
          onboardedAt: user.onboardedAt,
        })
        .from(user)
        .where(eq(user.id, userId))
        .for('update');
      if (!before) return { ok: false, reason: 'not_found' } as const;
      if (!before.onboardedAt) return { ok: false, reason: 'not_onboarded' } as const;
      if (input.avatar?.kind === 'photo') {
        const photo = photoAttachmentId(input.avatar.config);
        if (!photo || !(await claimAvatarPhoto(tx, userId, photo, before.avatarConfig))) {
          return { ok: false, reason: 'avatar_invalid' } as const;
        }
      } else if (input.avatar && before.avatarKind === 'photo') {
        // A generated picture replaces the photo: the stored photo is no longer needed.
        await releaseAvatarPhoto(tx, userId, before.avatarConfig);
      }
      await tx
        .update(user)
        .set({
          nickname: input.nickname,
          name: input.realName,
          realNameVisibility: input.realNameVisibility,
          nameDisplay: input.nameDisplay,
          bio: input.bio,
          ...(input.avatar && { avatarKind: input.avatar.kind, avatarConfig: input.avatar.config }),
          updatedAt: sql`now()`,
        })
        .where(eq(user.id, userId));
      const avatarChanged =
        input.avatar !== undefined &&
        (input.avatar.kind !== before.avatarKind ||
          JSON.stringify(input.avatar.config) !== JSON.stringify(before.avatarConfig));
      return {
        ok: true,
        publicChanged: avatarChanged || input.nickname !== before.nickname,
      } as const;
    });
  } catch (error) {
    if (isNicknameConflict(error)) return { ok: false, reason: 'nickname_taken' };
    throw error;
  }
}

export interface ProfileSettings extends NameChoices {
  nickname: string | null;
  bio: string;
  avatarKind: 'preset' | 'custom' | 'photo' | null;
  avatarConfig: unknown;
  /** False in invisible mode (PROF-02). */
  showPresence: boolean;
}

/** Everything the profile settings form shows. */
export async function getProfileSettings(
  db: Queryable,
  userId: string,
): Promise<ProfileSettings | null> {
  const [row] = await db
    .select({
      nickname: user.nickname,
      realName: user.name,
      realNameVisibility: user.realNameVisibility,
      nameDisplay: user.nameDisplay,
      bio: user.bio,
      avatarKind: user.avatarKind,
      avatarConfig: user.avatarConfig,
      showPresence: user.showPresence,
    })
    .from(user)
    .where(eq(user.id, userId));
  return row ?? null;
}

export interface OwnProfile {
  nickname: string | null;
  name: string;
  bio: string;
  avatarKind: 'preset' | 'custom' | 'photo' | null;
  avatarConfig: unknown;
  image: string | null;
}

/** The signed-in person's own profile fields (everything they may see about themselves). */
export async function getOwnProfile(db: Queryable, userId: string): Promise<OwnProfile | null> {
  const [row] = await db
    .select({
      nickname: user.nickname,
      name: user.name,
      bio: user.bio,
      avatarKind: user.avatarKind,
      avatarConfig: user.avatarConfig,
      image: user.image,
    })
    .from(user)
    .where(eq(user.id, userId));
  return row ?? null;
}

/**
 * True if the session exists, belongs to the user and has not expired (database clock).
 * The realtime server checks this on connect, so a token issued just before a sign-out cannot
 * open a new connection in the remaining minutes of its life.
 */
export async function isSessionActive(
  db: Queryable,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: session.id })
    .from(session)
    .where(
      and(eq(session.id, sessionId), eq(session.userId, userId), gt(session.expiresAt, sql`now()`)),
    );
  return row !== undefined;
}

/** Records when someone was last online, to the minute (shown as "last seen"). */
export async function touchLastSeen(db: Queryable, userId: string): Promise<void> {
  await db
    .update(user)
    .set({ lastSeenAt: sql`date_trunc('minute', now())` })
    .where(eq(user.id, userId));
}

/** Switches invisible mode (PROF-02): `false` hides when this person is online. */
export async function setShowPresence(db: Queryable, userId: string, show: boolean): Promise<void> {
  await db.update(user).set({ showPresence: show }).where(eq(user.id, userId));
}
