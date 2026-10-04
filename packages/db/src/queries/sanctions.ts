/**
 * Sanctions on an account (ADMIN-03, RAND-05; security.md 4.4): warning, mute, suspension, ban
 * and random-mode timeout, and lifting them again.
 *
 * | Kind             | Scope  | Lasts                     | Effect                                    |
 * | ---------------- | ------ | ------------------------- | ----------------------------------------- |
 * | `warn`           | global | shown for 30 days         | none: the person is told the reason       |
 * | `mute`           | global | timed                     | cannot post, edit or react anywhere       |
 * | `suspend`        | global | timed                     | signed out everywhere; cannot sign in     |
 * | `ban`            | global | permanent (or timed)      | as a suspension, until lifted             |
 * | `random_timeout` | random | timed                     | cannot use random mode                    |
 *
 * Every change is one transaction that locks the person's row, writes the append-only audit log
 * (`moderation_action`, with the required reason), the `user_sanction` row that the fast checks
 * read, and a notification for the person. A suspension or ban also ends every session.
 *
 * All times use the database clock (D-027). `user.status` mirrors an active suspension or ban;
 * the sanction rows stay the source of truth, so a suspension that has run out is put right the
 * next time the person signs in (`resolveSignInStanding`).
 */
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { decideGlobal } from '@socketspace/shared/authz';
import type { LiftableSanctionKind, SanctionKind, SanctionScope } from '@socketspace/shared/domain';
import { LIMITS } from '@socketspace/shared/limits';
import { codePointLength } from '@socketspace/shared/text';

import type { Database, Queryable, Transaction } from '../client';
import { dbNow } from '../clock';
import { newId } from '../schema/_common';
import { session, user } from '../schema/auth';
import { moderationAction, userSanction } from '../schema/safety';
import { notification } from '../schema/social';
import { loadActor } from './rooms';

/**
 * The actor recorded in the audit log for automatic actions (for example a random-mode timeout
 * after a high-severity filter hit). The nil UUID is never a real account.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/** A warning stays on the person's account page for this long. */
export const WARNING_SHOWN_SECONDS = 30 * 24 * 60 * 60;

export type SanctionActor = { type: 'admin'; id: string } | { type: 'system' };

export interface ApplySanctionInput {
  /** A site administrator, or the system itself (random-mode timeouts only). */
  actor: SanctionActor;
  targetUserId: string;
  kind: SanctionKind;
  /** The statement of reasons shown to the person. Required. */
  reason: string;
  /** Required for mute, suspend and random_timeout; optional for ban; not allowed for warn. */
  durationSeconds?: number;
  /** The report this action answers, if any (kept in the audit log). */
  reportId?: string;
  /** A fixed clock for tests. */
  now?: Date;
}

export type SanctionRefusal =
  | 'not_admin'
  | 'system_not_allowed'
  | 'self'
  | 'target_not_found'
  | 'target_is_admin'
  | 'reason_required'
  | 'reason_too_long'
  | 'duration_required'
  | 'duration_not_allowed'
  | 'duration_invalid';

export interface AppliedSanction {
  id: string;
  userId: string;
  kind: SanctionKind;
  scope: SanctionScope;
  reason: string;
  /** Null: until lifted. */
  expiresAt: Date | null;
  actionId: string;
}

export type ApplySanctionResult =
  | { ok: true; sanction: AppliedSanction; sessionsRevoked: boolean }
  | { ok: false; reason: SanctionRefusal };

const SCOPE: Record<SanctionKind, SanctionScope> = {
  warn: 'global',
  mute: 'global',
  suspend: 'global',
  ban: 'global',
  random_timeout: 'random',
};

const TIMED: ReadonlySet<SanctionKind> = new Set(['mute', 'suspend', 'random_timeout']);

function checkReason(reason: string): 'reason_required' | 'reason_too_long' | null {
  if (reason.trim() === '') return 'reason_required';
  return codePointLength(reason) > LIMITS.sanction.reasonMax ? 'reason_too_long' : null;
}

function checkDuration(kind: SanctionKind, seconds: number | undefined): SanctionRefusal | null {
  if (seconds === undefined) return TIMED.has(kind) ? 'duration_required' : null;
  if (kind === 'warn') return 'duration_not_allowed';
  const { minSeconds, maxSeconds } = LIMITS.sanction;
  return Number.isInteger(seconds) && seconds >= minSeconds && seconds <= maxSeconds
    ? null
    : 'duration_invalid';
}

async function isAdmin(tx: Queryable, userId: string): Promise<boolean> {
  const actor = await loadActor(tx, userId);
  return actor !== null && decideGlobal(actor, 'admin.access').allowed;
}

/** `suspended`, `banned` or `active`, from the sanctions in force right now. */
async function statusFromSanctions(
  tx: Queryable,
  userId: string,
  fixedNow?: Date,
): Promise<'active' | 'suspended' | 'banned'> {
  const now = dbNow(fixedNow);
  const rows = await tx
    .select({ kind: userSanction.kind })
    .from(userSanction)
    .where(
      and(
        eq(userSanction.userId, userId),
        inArray(userSanction.kind, ['suspend', 'ban']),
        isNull(userSanction.liftedAt),
        lte(userSanction.startsAt, now),
        or(isNull(userSanction.expiresAt), gt(userSanction.expiresAt, now)),
      ),
    );
  if (rows.some((r) => r.kind === 'ban')) return 'banned';
  return rows.length > 0 ? 'suspended' : 'active';
}

/**
 * Applies a sanction. Only site administrators may (never to themselves or to another
 * administrator); the system may set random-mode timeouts.
 */
export async function applySanction(
  db: Database,
  input: ApplySanctionInput,
): Promise<ApplySanctionResult> {
  return db.transaction((tx) => applySanctionIn(tx, input));
}

/** `applySanction` inside a transaction the caller already opened (automatic timeouts). */
export async function applySanctionIn(
  tx: Transaction,
  input: ApplySanctionInput,
): Promise<ApplySanctionResult> {
  const refuse = (reason: SanctionRefusal) => ({ ok: false, reason }) as const;
  const reason = input.reason.trim();
  const invalid = checkReason(reason) ?? checkDuration(input.kind, input.durationSeconds);
  if (invalid) return refuse(invalid);
  const clock = dbNow(input.now);
  const seconds = input.kind === 'warn' ? WARNING_SHOWN_SECONDS : input.durationSeconds;

  if (input.actor.type === 'system') {
    if (input.kind !== 'random_timeout') return refuse('system_not_allowed');
  } else {
    if (!(await isAdmin(tx, input.actor.id))) return refuse('not_admin');
    if (input.actor.id === input.targetUserId) return refuse('self');
  }
  const [target] = await tx
    .select({ id: user.id, role: user.role, status: user.status })
    .from(user)
    .where(eq(user.id, input.targetUserId))
    .for('update');
  if (!target || target.status === 'deleted') return refuse('target_not_found');
  if (target.role === 'admin') return refuse('target_is_admin');

  const scope = SCOPE[input.kind];
  const actionId = newId();
  const [action] = await tx
    .insert(moderationAction)
    .values({
      id: actionId,
      actorId: input.actor.type === 'system' ? SYSTEM_ACTOR_ID : input.actor.id,
      action: input.kind,
      targetUserId: target.id,
      reportId: input.reportId ?? null,
      reason,
      expiresAt:
        seconds === undefined || input.kind === 'warn'
          ? null
          : sql`${clock} + make_interval(secs => ${seconds})`,
      metadata: { scope, automatic: input.actor.type === 'system' },
      ...(input.now && { createdAt: input.now }),
    })
    .returning({ id: moderationAction.id });
  if (!action) throw new Error('INSERT ... RETURNING returned no row');

  const [row] = await tx
    .insert(userSanction)
    .values({
      id: newId(),
      userId: target.id,
      kind: input.kind,
      scope,
      reason,
      actionId,
      startsAt: clock,
      expiresAt: seconds === undefined ? null : sql`${clock} + make_interval(secs => ${seconds})`,
    })
    .returning();
  if (!row) throw new Error('INSERT ... RETURNING returned no row');

  let sessionsRevoked = false;
  if (input.kind === 'suspend' || input.kind === 'ban') {
    // A ban outranks a suspension; neither touches a deleted account (refused above).
    const status = input.kind === 'ban' || target.status === 'banned' ? 'banned' : 'suspended';
    await tx.update(user).set({ status }).where(eq(user.id, target.id));
    await tx.delete(session).where(eq(session.userId, target.id));
    sessionsRevoked = true;
  }
  // The person finds the reason on their account page, also if they were offline (ADMIN-03).
  await tx.insert(notification).values({ id: newId(), userId: target.id, type: 'moderation' });

  return {
    ok: true,
    sanction: {
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      scope: row.scope,
      reason: row.reason,
      // A warning has nothing that ends: its date only says how long it is shown.
      expiresAt: input.kind === 'warn' ? null : row.expiresAt,
      actionId,
    },
    sessionsRevoked,
  } as const;
}

export interface LiftSanctionInput {
  /** A site administrator. */
  actorId: string;
  targetUserId: string;
  kind: LiftableSanctionKind;
  /** Why it is lifted (audit log). Required. */
  reason: string;
  now?: Date;
}

export type LiftRefusal =
  'not_admin' | 'target_not_found' | 'reason_required' | 'reason_too_long' | 'nothing_to_lift';

export type LiftSanctionResult =
  | { ok: true; lifted: number; status: 'active' | 'suspended' | 'banned' }
  | { ok: false; reason: LiftRefusal };

const LIFT_ACTION = {
  mute: 'unmute',
  suspend: 'unsuspend',
  ban: 'unban',
  random_timeout: 'random_timeout_lifted',
} as const satisfies Record<LiftableSanctionKind, string>;

/**
 * Ends every sanction of one kind that is in force for a person (ADMIN-03). Lifting a suspension
 * or ban makes the account usable again at once, unless another one is still in force.
 */
export async function liftSanction(
  db: Database,
  input: LiftSanctionInput,
): Promise<LiftSanctionResult> {
  const refuse = (reason: LiftRefusal) => ({ ok: false, reason }) as const;
  const reason = input.reason.trim();
  const invalid = checkReason(reason);
  if (invalid) return refuse(invalid);
  const clock = dbNow(input.now);

  return db.transaction(async (tx) => {
    if (!(await isAdmin(tx, input.actorId))) return refuse('not_admin');
    const [target] = await tx
      .select({ id: user.id, status: user.status })
      .from(user)
      .where(eq(user.id, input.targetUserId))
      .for('update');
    if (!target || target.status === 'deleted') return refuse('target_not_found');

    const lifted = await tx
      .update(userSanction)
      .set({ liftedAt: clock })
      .where(
        and(
          eq(userSanction.userId, target.id),
          eq(userSanction.kind, input.kind),
          isNull(userSanction.liftedAt),
          or(isNull(userSanction.expiresAt), gt(userSanction.expiresAt, clock)),
        ),
      )
      .returning({ id: userSanction.id });
    if (lifted.length === 0) return refuse('nothing_to_lift');

    await tx.insert(moderationAction).values({
      id: newId(),
      actorId: input.actorId,
      action: LIFT_ACTION[input.kind],
      targetUserId: target.id,
      reason,
      metadata: { lifted: lifted.map((l) => l.id) },
      ...(input.now && { createdAt: input.now }),
    });

    const status = await statusFromSanctions(tx, target.id, input.now);
    if (status !== target.status) {
      await tx.update(user).set({ status }).where(eq(user.id, target.id));
    }
    return { ok: true, lifted: lifted.length, status } as const;
  });
}

export type SignInStanding =
  | { allowed: true }
  | {
      allowed: false;
      status: 'suspended' | 'banned' | 'deleted';
      /** When signing in will work again; null when only a moderator can change that. */
      until: Date | null;
      /** The moderator's reason, when there is one. */
      reason: string | null;
    };

/**
 * Whether a new session may start for this account (checked whenever someone signs in).
 *
 * A suspension or ban ends every session, so signing in again is the one way back. If the
 * sanction has run out by then, the account's status is put back to `active` here.
 *
 * No transaction and no row lock: this runs inside the sign-in library's own work on the same
 * account, and must never wait for it. The one write is guarded in SQL instead (it does nothing
 * if a new sanction arrived in the meantime).
 */
export async function resolveSignInStanding(
  db: Queryable,
  userId: string,
  fixedNow?: Date,
): Promise<SignInStanding> {
  const now = dbNow(fixedNow);
  const [account] = await db.select({ status: user.status }).from(user).where(eq(user.id, userId));
  // An account that is being created has no row yet.
  if (!account) return { allowed: true };
  if (account.status === 'deleted') {
    return { allowed: false, status: 'deleted', until: null, reason: null };
  }

  const inForce = sql`${userSanction.startsAt} <= ${now}
    and (${userSanction.expiresAt} is null or ${userSanction.expiresAt} > ${now})`;
  const rows = await db
    .select({
      kind: userSanction.kind,
      reason: userSanction.reason,
      expiresAt: userSanction.expiresAt,
      active: sql<boolean>`${inForce}`,
    })
    .from(userSanction)
    .where(
      and(
        eq(userSanction.userId, userId),
        inArray(userSanction.kind, ['suspend', 'ban']),
        isNull(userSanction.liftedAt),
      ),
    )
    .orderBy(desc(userSanction.createdAt));
  const active = rows.filter((r) => r.active);
  if (active.length > 0) {
    // The one that keeps the person out longest decides what they are told.
    const longest = active.reduce((a, b) => {
      if (a.expiresAt === null) return a;
      if (b.expiresAt === null) return b;
      return b.expiresAt > a.expiresAt ? b : a;
    });
    return {
      allowed: false,
      status: active.some((r) => r.kind === 'ban') ? 'banned' : 'suspended',
      until: longest.expiresAt,
      reason: longest.reason,
    };
  }
  if (account.status === 'active') return { allowed: true };
  // Suspended or banned by a sanction that has since run out: the account is usable again.
  if (rows.length > 0) {
    await db
      .update(user)
      .set({ status: 'active' })
      .where(
        and(
          eq(user.id, userId),
          inArray(user.status, ['suspended', 'banned']),
          sql`not exists (
            select 1 from ${userSanction}
            where ${userSanction.userId} = ${userId}
              and ${userSanction.kind} in ('suspend', 'ban')
              and ${userSanction.liftedAt} is null
              and ${inForce}
          )`,
        ),
      );
    return { allowed: true };
  }
  // The status was set without a sanction (by hand): only a moderator can change it back.
  return { allowed: false, status: account.status, until: null, reason: null };
}
