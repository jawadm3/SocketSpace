/**
 * Reports (SAFE-01, ADMIN-01; security.md 4.1) and the automatic flags of the word-list filter
 * (SAFE-02, ADMIN-02).
 *
 * The evidence of a report is a snapshot **taken by the server** inside the same transaction that
 * stores the report: what the message said (with its edit history and the messages around it),
 * what the profile looked like, or what the room was called. The reporter supplies only a reason
 * and optional details, so evidence cannot be made up, and a later edit or deletion does not
 * change what the moderator sees.
 *
 * A reporter can only report what they can see: a message or room they may read, a person who
 * exists. Missing, private and "not yours" all give the same answer (`not_found`).
 */
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';

import { decideGlobal } from '@socketspace/shared/authz';
import type { ReportReason } from '@socketspace/shared/domain';
import { LIMITS } from '@socketspace/shared/limits';
import type { AvatarWire } from '@socketspace/shared/profile';
import type { ReportAspect } from '@socketspace/shared/reports';

import type { Database, Queryable } from '../client';
import { newId } from '../schema/_common';
import { user } from '../schema/auth';
import { conversation, conversationMember } from '../schema/conversations';
import { message } from '../schema/messages';
import { contentFlag, report } from '../schema/safety';
import { listAttachments, photoAttachmentId } from './attachments';
import { canReadConversation } from './dms';
import { listRevisions } from './message-actions';
import { getPublicUsers } from './people';
import { loadActor } from './rooms';

export type ReportTargetInput =
  | { type: 'message'; messageId: string }
  | { type: 'user'; userId: string; aspect: ReportAspect; conversationId?: string | undefined }
  | { type: 'room'; conversationId: string };

export interface CreateReportInput {
  reporterId: string;
  target: ReportTargetInput;
  reason: ReportReason;
  /** Already validated and normalised by the shared contract. */
  details: string;
}

export type ReportRefusal = 'reporter_inactive' | 'not_found' | 'self';

export type CreateReportResult =
  | { ok: true; reportId: string; /** The same open report already existed. */ duplicate: boolean }
  | { ok: false; reason: ReportRefusal };

/** A message as kept in evidence: the stored text, not the masked text other people saw. */
export interface EvidenceMessage {
  id: string;
  seq: number;
  authorId: string;
  authorNickname: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  attachmentIds: string[];
}

interface EvidenceBase {
  /** Version of this shape, so the moderation dashboard can read older reports. */
  v: 1;
  /** Stored pictures this report refers to. Their files are kept while the report is open. */
  attachmentIds: string[];
}

export type ReportEvidence = EvidenceBase &
  (
    | {
        kind: 'message';
        conversation: { id: string; kind: 'room' | 'dm'; slug: string | null; name: string | null };
        message: EvidenceMessage & { filterSeverity: number };
        /** Earlier texts of the message (kept 30 days), newest first. */
        revisions: { revision: number; body: string; createdAt: string }[];
        /** The messages just before and after, oldest first. */
        context: EvidenceMessage[];
      }
    | {
        kind: 'user';
        /** What the reporter pointed at. */
        aspect: ReportAspect;
        /** The profile as the reporter could see it. */
        profile: {
          id: string;
          nickname: string;
          realName: string | null;
          bio: string;
          avatar: AvatarWire | null;
        };
      }
    | {
        kind: 'room';
        room: {
          id: string;
          slug: string | null;
          name: string | null;
          topic: string | null;
          visibility: 'public' | 'private';
          memberCount: number;
        };
        owners: { id: string; nickname: string | null }[];
      }
  );

const OPEN_STATUSES = ['open', 'in_review'] as const;

async function evidenceMessages(
  tx: Queryable,
  rows: readonly (typeof message.$inferSelect)[],
): Promise<EvidenceMessage[]> {
  if (rows.length === 0) return [];
  const authors = await tx
    .select({ id: user.id, nickname: user.nickname })
    .from(user)
    .where(inArray(user.id, [...new Set(rows.map((r) => r.authorId))]));
  const nicknames = new Map(authors.map((a) => [a.id, a.nickname]));
  const pictures = await listAttachments(
    tx,
    rows.map((r) => r.id),
  );
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    authorId: row.authorId,
    authorNickname: nicknames.get(row.authorId) ?? null,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deleted: row.deletedAt !== null,
    attachmentIds: (pictures.get(row.id) ?? []).map((p) => p.id),
  }));
}

interface Snapshot {
  targetUserId: string | null;
  messageId: string | null;
  conversationId: string | null;
  evidence: ReportEvidence;
}

async function snapshotMessage(
  tx: Queryable,
  reporterId: string,
  messageId: string,
): Promise<Snapshot | ReportRefusal> {
  const [row] = await tx.select().from(message).where(eq(message.id, messageId));
  if (!row || !(await canReadConversation(tx, reporterId, row.conversationId))) return 'not_found';
  if (row.authorId === reporterId) return 'self';
  const [conv] = await tx
    .select({
      id: conversation.id,
      kind: conversation.kind,
      slug: conversation.slug,
      name: conversation.name,
    })
    .from(conversation)
    .where(eq(conversation.id, row.conversationId));
  if (!conv) return 'not_found';

  const around = LIMITS.report.contextMessages;
  const inConversation = eq(message.conversationId, row.conversationId);
  const before = await tx
    .select()
    .from(message)
    .where(and(inConversation, lt(message.seq, row.seq)))
    .orderBy(desc(message.seq))
    .limit(around);
  const after = await tx
    .select()
    .from(message)
    .where(and(inConversation, gt(message.seq, row.seq)))
    .orderBy(asc(message.seq))
    .limit(around);
  const [reported] = await evidenceMessages(tx, [row]);
  if (!reported) return 'not_found';
  const revisions = await listRevisions(tx, row.id);
  return {
    targetUserId: row.authorId,
    messageId: row.id,
    conversationId: row.conversationId,
    evidence: {
      v: 1,
      kind: 'message',
      conversation: conv,
      message: { ...reported, filterSeverity: row.filterSeverity },
      revisions: revisions.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      context: await evidenceMessages(tx, [...before.reverse(), ...after]),
      attachmentIds: reported.attachmentIds,
    },
  };
}

async function snapshotUser(
  tx: Queryable,
  reporterId: string,
  target: Extract<ReportTargetInput, { type: 'user' }>,
): Promise<Snapshot | ReportRefusal> {
  if (target.userId === reporterId) return 'self';
  const [row] = await tx
    .select({
      id: user.id,
      status: user.status,
      bio: user.bio,
      avatarKind: user.avatarKind,
      avatarConfig: user.avatarConfig,
    })
    .from(user)
    .where(eq(user.id, target.userId));
  if (!row || row.status === 'deleted') return 'not_found';
  // The profile exactly as this reporter may see it (a hidden real name stays hidden).
  const [seen] = await getPublicUsers(tx, reporterId, [row.id], 'profile');
  if (!seen) return 'not_found';
  const photo = row.avatarKind === 'photo' ? photoAttachmentId(row.avatarConfig) : null;
  const where =
    target.conversationId && (await canReadConversation(tx, reporterId, target.conversationId))
      ? target.conversationId
      : null;
  return {
    targetUserId: row.id,
    messageId: null,
    conversationId: where,
    evidence: {
      v: 1,
      kind: 'user',
      aspect: target.aspect,
      profile: {
        id: row.id,
        nickname: seen.nickname,
        realName: seen.realName ?? null,
        bio: row.bio,
        avatar: seen.avatar,
      },
      attachmentIds: photo ? [photo] : [],
    },
  };
}

async function snapshotRoom(
  tx: Queryable,
  reporterId: string,
  conversationId: string,
): Promise<Snapshot | ReportRefusal> {
  const [room] = await tx
    .select({
      id: conversation.id,
      kind: conversation.kind,
      slug: conversation.slug,
      name: conversation.name,
      topic: conversation.topic,
      visibility: conversation.visibility,
      memberCount: conversation.memberCount,
    })
    .from(conversation)
    .where(eq(conversation.id, conversationId));
  if (room?.kind !== 'room' || !(await canReadConversation(tx, reporterId, conversationId))) {
    return 'not_found';
  }
  const owners = await tx
    .select({ id: user.id, nickname: user.nickname })
    .from(conversationMember)
    .innerJoin(user, eq(user.id, conversationMember.userId))
    .where(
      and(
        eq(conversationMember.conversationId, conversationId),
        eq(conversationMember.role, 'owner'),
      ),
    );
  const { kind: _kind, ...shown } = room;
  return {
    targetUserId: null,
    messageId: null,
    conversationId,
    evidence: { v: 1, kind: 'room', room: shown, owners, attachmentIds: [] },
  };
}

/**
 * Files a report with a server-side snapshot of what is reported. Reporting the same thing again
 * while the first report is still open returns that report instead of storing a second one.
 */
export async function createReport(
  db: Database,
  input: CreateReportInput,
): Promise<CreateReportResult> {
  const { reporterId, target } = input;
  return db.transaction(async (tx) => {
    const reporter = await loadActor(tx, reporterId);
    if (!reporter || !decideGlobal(reporter, 'report.create').allowed) {
      return { ok: false, reason: 'reporter_inactive' } as const;
    }
    const snapshot =
      target.type === 'message'
        ? await snapshotMessage(tx, reporterId, target.messageId)
        : target.type === 'user'
          ? await snapshotUser(tx, reporterId, target)
          : await snapshotRoom(tx, reporterId, target.conversationId);
    if (typeof snapshot === 'string') return { ok: false, reason: snapshot } as const;

    const same =
      target.type === 'message'
        ? eq(report.messageId, target.messageId)
        : target.type === 'user'
          ? and(
              eq(report.targetUserId, target.userId),
              sql`${report.evidence} ->> 'aspect' = ${target.aspect}`,
            )
          : eq(report.conversationId, target.conversationId);
    const [existing] = await tx
      .select({ id: report.id })
      .from(report)
      .where(
        and(
          eq(report.reporterId, reporterId),
          eq(report.targetType, target.type),
          inArray(report.status, [...OPEN_STATUSES]),
          same,
        ),
      )
      .limit(1);
    if (existing) return { ok: true, reportId: existing.id, duplicate: true } as const;

    const reportId = newId();
    await tx.insert(report).values({
      id: reportId,
      reporterId,
      targetType: target.type,
      targetUserId: snapshot.targetUserId,
      messageId: snapshot.messageId,
      conversationId: snapshot.conversationId,
      reason: input.reason,
      details: input.details,
      evidence: snapshot.evidence,
    });
    return { ok: true, reportId, duplicate: false } as const;
  });
}

// Automatic flags ----------------------------------------------------------------------------------

export interface WordListFlagInput {
  userId: string;
  /** `medium`: the message was stored and masked. `high`: it was blocked and never stored. */
  severity: 'medium' | 'high';
  categories: readonly string[];
  /** The flagged message's own text. */
  text: string;
  messageId?: string | null;
}

/**
 * Puts a word-list hit in front of the moderators (`content_flag`). At most 20 unreviewed flags
 * an hour are kept per person, so someone who keeps hitting the filter cannot fill the database;
 * returns `false` when this one was not stored for that reason.
 */
export async function recordWordListFlag(
  tx: Queryable,
  input: WordListFlagInput,
): Promise<boolean> {
  const [recent] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(contentFlag)
    .where(
      and(
        eq(contentFlag.userId, input.userId),
        eq(contentFlag.source, 'wordlist'),
        isNull(contentFlag.reviewedAt),
        gte(contentFlag.createdAt, sql`now() - interval '1 hour'`),
      ),
    );
  if ((recent?.count ?? 0) >= LIMITS.flag.perUserPerHour) return false;
  await tx.insert(contentFlag).values({
    id: newId(),
    source: 'wordlist',
    severity: input.severity,
    categories: [...input.categories],
    messageId: input.messageId ?? null,
    excerpt: Array.from(input.text).slice(0, LIMITS.flag.excerptMax).join(''),
    userId: input.userId,
  });
  return true;
}
