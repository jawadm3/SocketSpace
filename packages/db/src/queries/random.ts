/**
 * Random-match mode in the database (RAND-02 to RAND-10; security.md 4.3).
 *
 * The queue, the pairing and the messages live only in the realtime server's memory. The database
 * holds what must outlast a chat:
 *
 * - the 18+ gate record on the account (`acceptRandomGate`, `getRandomEntry`);
 * - one `random_session` row per chat with metadata only, never text (`startRandomSession`,
 *   `endRandomSession`), deleted after 30 days (`deleteOldRandomSessions`);
 * - a report of a chat, with the messages the realtime server kept as evidence
 *   (`createRandomReport`): the only place random-mode text is ever stored;
 * - automatic random-mode timeouts through the same sanction model moderators use
 *   (`applyAutomaticRandomTimeout`), for guests also by hashed network address (`network_ban`);
 * - contacts two people agreed to add (`addRandomContact`);
 * - aggregate daily counters without user IDs (`bumpMetric`).
 *
 * All time checks use the database clock (D-027).
 */
import { and, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { decideGlobal, type Actor } from '@socketspace/shared/authz';
import type { ReportReason } from '@socketspace/shared/domain';
import { LIMITS } from '@socketspace/shared/limits';
import type { RandomMetric } from '@socketspace/shared/random';

import type { Database, Queryable } from '../client';
import { dbNow } from '../clock';
import { newId } from '../schema/_common';
import { user } from '../schema/auth';
import { conversation, conversationMember } from '../schema/conversations';
import { metricDaily } from '../schema/ops';
import { networkBan, randomSession, report, userSanction } from '../schema/safety';
import { block, contact } from '../schema/social';
import type { RandomEvidenceMessage, ReportEvidence } from './reports';
import { likePattern, loadActor } from './rooms';
import { applySanctionIn, type AppliedSanction, type SanctionRefusal } from './sanctions';

// The 18+ gate -------------------------------------------------------------------------------------

export interface RandomGate {
  adultConfirmedAt: Date | null;
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
}

export async function getRandomGate(db: Queryable, userId: string): Promise<RandomGate | null> {
  const [row] = await db
    .select({
      adultConfirmedAt: user.adultConfirmedAt,
      termsVersion: user.randomTermsVersion,
      termsAcceptedAt: user.randomTermsAcceptedAt,
    })
    .from(user)
    .where(eq(user.id, userId));
  return row ?? null;
}

/**
 * Records that the person confirmed they are 18 or older and accepted this version of the
 * random-mode rules (RAND-02). The first confirmation date is kept when a new version is accepted.
 */
export async function acceptRandomGate(
  db: Queryable,
  userId: string,
  version: string,
): Promise<boolean> {
  const updated = await db
    .update(user)
    .set({
      adultConfirmedAt: sql`coalesce(${user.adultConfirmedAt}, now())`,
      randomTermsVersion: version,
      randomTermsAcceptedAt: sql`now()`,
    })
    .where(and(eq(user.id, userId), eq(user.status, 'active')))
    .returning({ id: user.id });
  return updated.length > 0;
}

export interface RandomPause {
  kind: 'random_timeout' | 'mute';
  reason: string;
  /** Null: until a moderator lifts it. */
  until: Date | null;
}

/** The random-mode timeout or site-wide mute in force that ends last, if any. */
export async function getRandomPause(
  db: Queryable,
  userId: string,
  fixedNow?: Date,
): Promise<RandomPause | null> {
  const now = dbNow(fixedNow);
  const rows = await db
    .select({
      kind: userSanction.kind,
      reason: userSanction.reason,
      expiresAt: userSanction.expiresAt,
    })
    .from(userSanction)
    .where(
      and(
        eq(userSanction.userId, userId),
        inArray(userSanction.kind, ['random_timeout', 'mute']),
        isNull(userSanction.liftedAt),
        sql`${userSanction.startsAt} <= ${now}`,
        or(isNull(userSanction.expiresAt), gt(userSanction.expiresAt, now)),
      ),
    );
  let last: (typeof rows)[number] | null = null;
  for (const row of rows) {
    if (
      !last ||
      (last.expiresAt !== null && (row.expiresAt === null || row.expiresAt > last.expiresAt))
    ) {
      last = row;
    }
  }
  if (!last) return null;
  return {
    kind: last.kind === 'mute' ? 'mute' : 'random_timeout',
    reason: last.reason,
    until: last.expiresAt,
  };
}

export interface RandomEntry {
  /** The account as the authorisation rules see it, or `null` if it does not exist. */
  actor: Actor | null;
  gate: RandomGate;
  pause: RandomPause | null;
  /** For guests: when the ban on their network address ends, if one is in force. */
  networkBanUntil: Date | null;
  /** People this person blocked, or who blocked them: never matched with each other. */
  avoid: string[];
}

/** Everything `random:join` checks, read together. */
export async function getRandomEntry(
  db: Queryable,
  userId: string,
  options: { ipHash?: string | null } = {},
): Promise<RandomEntry> {
  const [actor, gate, pause, blocks, bans] = await Promise.all([
    loadActor(db, userId),
    getRandomGate(db, userId),
    getRandomPause(db, userId),
    db
      .select({ blockerId: block.blockerId, blockedId: block.blockedId })
      .from(block)
      .where(or(eq(block.blockerId, userId), eq(block.blockedId, userId))),
    options.ipHash
      ? db
          .select({ expiresAt: networkBan.expiresAt })
          .from(networkBan)
          .where(and(eq(networkBan.ipHash, options.ipHash), gt(networkBan.expiresAt, sql`now()`)))
          .orderBy(desc(networkBan.expiresAt))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return {
    actor,
    gate: gate ?? { adultConfirmedAt: null, termsVersion: null, termsAcceptedAt: null },
    pause,
    networkBanUntil: bans[0]?.expiresAt ?? null,
    avoid: blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)),
  };
}

// Aggregate counters ---------------------------------------------------------------------------------

/** Adds to today's count of `name` (UTC day). Counts only: no user ID is ever stored (RAND-09). */
export async function bumpMetric(db: Queryable, name: RandomMetric, by = 1): Promise<void> {
  await db
    .insert(metricDaily)
    .values({ day: sql`(now() at time zone 'utc')::date`, name, value: by })
    .onConflictDoUpdate({
      target: [metricDaily.day, metricDaily.name],
      set: { value: sql`${metricDaily.value} + ${by}` },
    });
}

/** The total of one counter over all days (for the admin statistics and tests). */
export async function getMetricTotal(db: Queryable, name: RandomMetric): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${metricDaily.value}), 0)` })
    .from(metricDaily)
    .where(eq(metricDaily.name, name));
  return Number(row?.total ?? 0);
}

// Sessions (metadata only) ---------------------------------------------------------------------------

export type RandomEndReason = NonNullable<typeof randomSession.$inferSelect.endReason>;

/** Records that two people were paired. Metadata only: who, when, how many shared interests. */
export async function startRandomSession(
  db: Database,
  input: { participantA: string; participantB: string; sharedInterestCount: number },
): Promise<{ id: string; startedAt: Date }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(randomSession)
      .values({
        id: newId(),
        participantA: input.participantA,
        participantB: input.participantB,
        sharedInterestCount: input.sharedInterestCount,
      })
      .returning({ id: randomSession.id, startedAt: randomSession.startedAt });
    if (!row) throw new Error('INSERT ... RETURNING returned no row');
    await bumpMetric(tx, 'random_sessions_started');
    return row;
  });
}

/** Marks a chat as ended. Returns false if it had already ended (or never existed). */
export async function endRandomSession(
  db: Queryable,
  sessionId: string,
  reason: RandomEndReason,
): Promise<boolean> {
  const updated = await db
    .update(randomSession)
    .set({ endedAt: sql`now()`, endReason: reason })
    .where(and(eq(randomSession.id, sessionId), isNull(randomSession.endedAt)))
    .returning({ id: randomSession.id });
  return updated.length > 0;
}

/**
 * Closes chats left open by a realtime server that stopped without ending them (their memory is
 * gone, so they cannot continue). Returns how many were closed.
 */
export async function closeOpenRandomSessions(db: Queryable): Promise<number> {
  const updated = await db
    .update(randomSession)
    .set({ endedAt: sql`now()`, endReason: 'disconnect' })
    .where(isNull(randomSession.endedAt))
    .returning({ id: randomSession.id });
  return updated.length;
}

/** Deletes chat metadata older than the retention period (30 days). For the daily clean-up job. */
export async function deleteOldRandomSessions(
  db: Queryable,
  days: number = LIMITS.random.sessionRetentionDays,
  fixedNow?: Date,
): Promise<number> {
  const deleted = await db
    .delete(randomSession)
    .where(lt(randomSession.startedAt, sql`${dbNow(fixedNow)} - make_interval(days => ${days})`))
    .returning({ id: randomSession.id });
  return deleted.length;
}

// Reports --------------------------------------------------------------------------------------------

export interface BufferedRandomMessage {
  senderId: string;
  /** As written. */
  text: string;
  at: Date;
  /** False: stopped by the filter, never shown to the other person. */
  delivered: boolean;
}

export interface CreateRandomReportInput {
  reporterId: string;
  sessionId: string;
  reason: ReportReason;
  /** Already validated and normalised by the shared contract. */
  details: string;
  /** The realtime server's memory of the chat (its last messages), oldest first. */
  messages: readonly BufferedRandomMessage[];
}

export type CreateRandomReportResult =
  | {
      ok: true;
      reportId: string;
      /** The same person had already reported this chat. */
      duplicate: boolean;
      /** The other person in the chat; null if their account is gone. */
      targetUserId: string | null;
      /** Different people who reported the target's random chats in the last 24 hours. */
      distinctReporters: number;
    }
  | { ok: false; reason: 'reporter_inactive' | 'not_found' };

/**
 * Files a report of a random chat (RAND-04). The evidence is the realtime server's own record of
 * the chat's last messages, never anything the reporter typed; the reporter must have been one of
 * the two people in that chat. One report per person and chat.
 */
export async function createRandomReport(
  db: Database,
  input: CreateRandomReportInput,
): Promise<CreateRandomReportResult> {
  return db.transaction(async (tx) => {
    const reporter = await loadActor(tx, input.reporterId);
    if (!reporter || !decideGlobal(reporter, 'report.create').allowed) {
      return { ok: false, reason: 'reporter_inactive' } as const;
    }
    const [session] = await tx
      .select()
      .from(randomSession)
      .where(eq(randomSession.id, input.sessionId));
    if (!session) return { ok: false, reason: 'not_found' } as const;
    const { participantA, participantB } = session;
    if (participantA !== input.reporterId && participantB !== input.reporterId) {
      return { ok: false, reason: 'not_found' } as const;
    }
    const targetUserId = participantA === input.reporterId ? participantB : participantA;

    const countReporters = async () => {
      if (!targetUserId) return 0;
      const [row] = await tx
        .select({ count: sql<number>`count(distinct ${report.reporterId})::int` })
        .from(report)
        .where(
          and(
            eq(report.targetUserId, targetUserId),
            eq(report.targetType, 'random_session'),
            gt(
              report.createdAt,
              sql`now() - make_interval(secs => ${LIMITS.random.reportWindowSeconds})`,
            ),
          ),
        );
      return row?.count ?? 0;
    };

    const [existing] = await tx
      .select({ id: report.id })
      .from(report)
      .where(
        and(
          eq(report.reporterId, input.reporterId),
          eq(report.targetType, 'random_session'),
          eq(report.randomSessionId, session.id),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        ok: true,
        reportId: existing.id,
        duplicate: true,
        targetUserId,
        distinctReporters: await countReporters(),
      } as const;
    }

    const messages: RandomEvidenceMessage[] = input.messages
      .slice(-LIMITS.random.evidenceMessages)
      .map((m) => ({
        from: m.senderId === input.reporterId ? 'reporter' : 'reported',
        text: m.text,
        at: m.at.toISOString(),
        delivered: m.delivered,
      }));
    const evidence: ReportEvidence = {
      v: 1,
      kind: 'random_session',
      session: {
        id: session.id,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
        endReason: session.endReason,
        sharedInterestCount: session.sharedInterestCount,
      },
      messages,
      attachmentIds: [],
    };
    const reportId = newId();
    await tx.insert(report).values({
      id: reportId,
      reporterId: input.reporterId,
      targetType: 'random_session',
      targetUserId,
      randomSessionId: session.id,
      reason: input.reason,
      details: input.details,
      evidence,
    });
    await bumpMetric(tx, 'random_reports');
    return {
      ok: true,
      reportId,
      duplicate: false,
      targetUserId,
      distinctReporters: await countReporters(),
    } as const;
  });
}

// Automatic timeouts ---------------------------------------------------------------------------------

export type AutomaticTimeoutCause = 'filter' | 'reports';

/** What the person is told (the "statement of reasons" of an automatic decision). */
export const AUTOMATIC_TIMEOUT_REASON: Record<AutomaticTimeoutCause, string> = {
  filter:
    'A message you sent in random chat contained words that are not allowed. Random chat is paused for you for 1 hour.',
  reports:
    'Three different people reported your random chats within 24 hours. Random chat is paused for you for 24 hours while a moderator looks at the reports.',
};

const AUTOMATIC_TIMEOUT_SECONDS: Record<AutomaticTimeoutCause, number> = {
  filter: LIMITS.random.filterTimeoutSeconds,
  reports: LIMITS.random.reportTimeoutSeconds,
};

export interface AutomaticTimeoutInput {
  targetUserId: string;
  cause: AutomaticTimeoutCause;
  /** The report that brought the count to three, if any (kept in the audit log). */
  reportId?: string;
  /** For guests: the keyed hash of their network address, kept out for the same time (RAND-10). */
  ipHash?: string | null;
  now?: Date;
}

export type AutomaticTimeoutResult =
  | { applied: true; sanction: AppliedSanction }
  | { applied: false; reason: 'already_paused' | SanctionRefusal };

/**
 * Pauses random mode for someone automatically (RAND-05): 1 hour after a blocked message, 24
 * hours after reports from three different people. It goes through the same sanction model as a
 * moderator's decision (audit-log entry by the system, reason shown to the person, notification).
 * Nothing is added when a pause that lasts at least as long is already in force.
 */
export async function applyAutomaticRandomTimeout(
  db: Database,
  input: AutomaticTimeoutInput,
): Promise<AutomaticTimeoutResult> {
  const seconds = AUTOMATIC_TIMEOUT_SECONDS[input.cause];
  const clock = dbNow(input.now);
  return db.transaction(async (tx) => {
    // The person's row is locked, so two causes at the same moment cannot both add a timeout.
    const [target] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.targetUserId))
      .for('update');
    if (!target) return { applied: false, reason: 'target_not_found' } as const;
    const [covered] = await tx
      .select({ id: userSanction.id })
      .from(userSanction)
      .where(
        and(
          eq(userSanction.userId, target.id),
          eq(userSanction.kind, 'random_timeout'),
          isNull(userSanction.liftedAt),
          or(
            isNull(userSanction.expiresAt),
            sql`${userSanction.expiresAt} >= ${clock} + make_interval(secs => ${seconds})`,
          ),
        ),
      )
      .limit(1);
    if (covered) return { applied: false, reason: 'already_paused' } as const;

    const result = await applySanctionIn(tx, {
      actor: { type: 'system' },
      targetUserId: target.id,
      kind: 'random_timeout',
      reason: AUTOMATIC_TIMEOUT_REASON[input.cause],
      durationSeconds: seconds,
      ...(input.reportId && { reportId: input.reportId }),
      ...(input.now && { now: input.now }),
    });
    if (!result.ok) return { applied: false, reason: result.reason } as const;
    if (input.ipHash) {
      await tx.insert(networkBan).values({
        id: newId(),
        ipHash: input.ipHash,
        reason: `random_timeout:${input.cause}`,
        expiresAt: sql`${clock} + make_interval(secs => ${seconds})`,
      });
    }
    return { applied: true, sanction: result.sanction } as const;
  });
}

// Contacts and profiles ------------------------------------------------------------------------------

export type AddContactResult =
  | { ok: true; /** False: they were contacts already. */ created: boolean }
  | { ok: false; reason: 'not_allowed' | 'blocked' };

/**
 * Makes two people each other's contact after both agreed in a random chat (RAND-08). Both must
 * be active, signed-in (not guests) and through onboarding, with no block between them.
 */
export async function addRandomContact(
  db: Database,
  a: string,
  b: string,
): Promise<AddContactResult> {
  if (a === b) return { ok: false, reason: 'not_allowed' };
  return db.transaction(async (tx) => {
    const people = await Promise.all([loadActor(tx, a), loadActor(tx, b)]);
    if (!people.every((p) => p?.status === 'active' && !p.isGuest && p.onboarded)) {
      return { ok: false, reason: 'not_allowed' } as const;
    }
    const [blocked] = await tx
      .select({ blockerId: block.blockerId })
      .from(block)
      .where(
        or(
          and(eq(block.blockerId, a), eq(block.blockedId, b)),
          and(eq(block.blockerId, b), eq(block.blockedId, a)),
        ),
      )
      .limit(1);
    if (blocked) return { ok: false, reason: 'blocked' } as const;
    const inserted = await tx
      .insert(contact)
      .values([
        { userId: a, contactId: b, source: 'random' },
        { userId: b, contactId: a, source: 'random' },
      ])
      .onConflictDoNothing()
      .returning({ userId: contact.userId });
    if (inserted.length > 0) await bumpMetric(tx, 'random_mutual_contact_added');
    return { ok: true, created: inserted.length > 0 } as const;
  });
}

// Room suggestions -----------------------------------------------------------------------------------

export interface SuggestedRoom {
  id: string;
  slug: string;
  name: string;
  memberCount: number;
}

/**
 * Public rooms to suggest when a random chat ends (RAND-09): first those whose name, address or
 * topic mentions one of the interests, busiest first, then the busiest public rooms to fill the
 * list. Rooms the person is already in are left out.
 */
export async function suggestRoomsForInterests(
  db: Queryable,
  input: { interests: readonly string[]; viewerId: string; limit?: number },
): Promise<SuggestedRoom[]> {
  const limit = Math.min(input.limit ?? LIMITS.random.suggestedRooms, LIMITS.random.suggestedRooms);
  const open = and(
    eq(conversation.kind, 'room'),
    eq(conversation.visibility, 'public'),
    isNull(conversation.archivedAt),
    sql`not exists (select 1 from ${conversationMember}
      where ${conversationMember.conversationId} = ${conversation.id}
      and ${conversationMember.userId} = ${input.viewerId})`,
  );
  const columns = {
    id: conversation.id,
    slug: conversation.slug,
    name: conversation.name,
    memberCount: conversation.memberCount,
  };
  const patterns = input.interests.slice(0, LIMITS.random.interestsMax).map(likePattern);
  const matching =
    patterns.length === 0
      ? []
      : await db
          .select(columns)
          .from(conversation)
          .where(
            and(
              open,
              or(
                ...patterns.flatMap((pattern) => [
                  ilike(conversation.name, pattern),
                  ilike(conversation.slug, pattern),
                  ilike(conversation.topic, pattern),
                ]),
              ),
            ),
          )
          .orderBy(desc(conversation.memberCount), conversation.name)
          .limit(limit);
  const rest =
    matching.length >= limit
      ? []
      : await db
          .select(columns)
          .from(conversation)
          .where(and(open, ...matching.map((room) => ne(conversation.id, room.id))))
          .orderBy(desc(conversation.memberCount), conversation.name)
          .limit(limit - matching.length);
  return [...matching, ...rest].map((room) => ({
    id: room.id,
    // Rooms always have a slug and a name (database check `conversation_room_fields`).
    slug: room.slug ?? '',
    name: room.name ?? '',
    memberCount: room.memberCount,
  }));
}
