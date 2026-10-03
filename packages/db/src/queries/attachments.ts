/**
 * Stored pictures (MSG-09, PROF-08): what was uploaded, who may see it, and what can be thrown
 * away. The files themselves live in a storage driver in the web app; this table is the only
 * place that knows which file belongs to which message or profile.
 *
 * A picture is in one of three states:
 * - `pending`: uploaded, not used yet. Only its uploader may see it. Deleted after 24 hours.
 * - `attached`: part of a message (`message_id` set), or someone's profile photo (`message_id`
 *   empty).
 * - `removed`: its message was deleted, or the profile photo was replaced. Nobody may see it, and
 *   the clean-up job deletes the file.
 */
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { LIMITS } from '@socketspace/shared/limits';
import type { AttachmentWire } from '@socketspace/shared/media';
import { photoAvatarSchema } from '@socketspace/shared/profile';

import type { Queryable } from '../client';
import { newId } from '../schema/_common';
import { user } from '../schema/auth';
import { attachment, message } from '../schema/messages';
import { report } from '../schema/safety';
import { canReadConversation } from './dms';

export type AttachmentRow = typeof attachment.$inferSelect;

/** Unused uploads are thrown away after this long (data-model.md, "Retention"). */
export const PENDING_UPLOAD_HOURS = 24;

export interface NewAttachment {
  uploaderId: string;
  storageKey: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

/** Records a picture that was just stored. It stays `pending` until a message or profile uses it. */
export async function createAttachment(
  db: Queryable,
  input: NewAttachment,
): Promise<AttachmentRow> {
  const [row] = await db
    .insert(attachment)
    .values({ id: newId(), ...input })
    .returning();
  if (!row) throw new Error('INSERT ... RETURNING returned no row');
  return row;
}

export function toAttachmentWire(
  row: Pick<AttachmentRow, 'id' | 'width' | 'height'>,
): AttachmentWire {
  return { id: row.id, width: row.width, height: row.height };
}

/** Pictures per message, in the order they were uploaded. */
export async function listAttachments(
  db: Queryable,
  messageIds: readonly string[],
): Promise<Map<string, AttachmentWire[]>> {
  const byMessage = new Map<string, AttachmentWire[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = await db
    .select({
      id: attachment.id,
      messageId: attachment.messageId,
      width: attachment.width,
      height: attachment.height,
    })
    .from(attachment)
    .where(and(inArray(attachment.messageId, [...messageIds]), eq(attachment.status, 'attached')))
    // IDs are time-ordered (UUID v7), so this is upload order.
    .orderBy(asc(attachment.id));
  for (const row of rows) {
    if (!row.messageId) continue;
    const list = byMessage.get(row.messageId) ?? [];
    list.push(toAttachmentWire(row));
    byMessage.set(row.messageId, list);
  }
  return byMessage;
}

/**
 * Locks the pictures a new message wants to carry and checks each one: uploaded by the author,
 * not used yet. Returns `false` if any fails (the message is then refused and nothing changes).
 */
export async function lockPendingAttachments(
  tx: Queryable,
  uploaderId: string,
  ids: readonly string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  const unique = [...new Set(ids)];
  const rows = await tx
    .select({ id: attachment.id })
    .from(attachment)
    .where(
      and(
        inArray(attachment.id, unique),
        eq(attachment.uploaderId, uploaderId),
        eq(attachment.status, 'pending'),
        isNull(attachment.messageId),
      ),
    )
    .for('update');
  return rows.length === unique.length;
}

/** Ties locked pictures to their message. Call after `lockPendingAttachments` in the same transaction. */
export async function attachToMessage(
  tx: Queryable,
  messageId: string,
  ids: readonly string[],
): Promise<AttachmentWire[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .update(attachment)
    .set({ messageId, status: 'attached' })
    .where(inArray(attachment.id, [...new Set(ids)]))
    .returning({ id: attachment.id, width: attachment.width, height: attachment.height });
  return rows.sort((a, b) => a.id.localeCompare(b.id)).map(toAttachmentWire);
}

/** A deleted message's pictures can no longer be seen; the clean-up job deletes the files. */
export async function removeMessageAttachments(tx: Queryable, messageId: string): Promise<void> {
  await tx
    .update(attachment)
    .set({ status: 'removed' })
    .where(and(eq(attachment.messageId, messageId), eq(attachment.status, 'attached')));
}

/** The stored picture's ID from a photo avatar's settings, or `null`. */
export function photoAttachmentId(avatarConfig: unknown): string | null {
  const parsed = photoAvatarSchema.safeParse(avatarConfig);
  return parsed.success ? parsed.data.attachmentId : null;
}

/**
 * Makes an uploaded picture someone's profile photo (PROF-08). It must be their own unused upload
 * in avatar shape (a square no larger than the avatar size), or the photo they already have.
 * The photo it replaces is marked `removed`. Returns `false` when the picture is not acceptable.
 */
export async function claimAvatarPhoto(
  tx: Queryable,
  userId: string,
  attachmentId: string,
  currentAvatarConfig: unknown,
): Promise<boolean> {
  const previous = photoAttachmentId(currentAvatarConfig);
  if (previous === attachmentId) return true;
  const claimed = await tx
    .update(attachment)
    .set({ status: 'attached' })
    .where(
      and(
        eq(attachment.id, attachmentId),
        eq(attachment.uploaderId, userId),
        eq(attachment.status, 'pending'),
        isNull(attachment.messageId),
        sql`${attachment.width} = ${attachment.height}`,
        sql`${attachment.width} <= ${LIMITS.upload.avatarEdge}`,
      ),
    )
    .returning({ id: attachment.id });
  if (claimed.length === 0) return false;
  if (previous) await releaseAvatarPhoto(tx, userId, currentAvatarConfig);
  return true;
}

/** The profile photo is no longer used (replaced by another picture): mark it `removed`. */
export async function releaseAvatarPhoto(
  tx: Queryable,
  userId: string,
  avatarConfig: unknown,
): Promise<void> {
  const previous = photoAttachmentId(avatarConfig);
  if (!previous) return;
  await tx
    .update(attachment)
    .set({ status: 'removed' })
    .where(
      and(
        eq(attachment.id, previous),
        eq(attachment.uploaderId, userId),
        isNull(attachment.messageId),
      ),
    );
}

export interface ViewableAttachment {
  storageKey: string;
  mime: string;
  bytes: number;
  sha256: string;
}

/**
 * The stored picture, if this viewer may see it; `null` otherwise (missing, removed and "not
 * yours" all look the same, so nothing leaks).
 *
 * - Not used yet: only the person who uploaded it.
 * - A profile photo: anyone signed in (profile pictures are shown wherever the person appears),
 *   while it is still that person's photo.
 * - In a message: whoever may read that conversation, while the message is still there.
 */
export async function getAttachmentForViewer(
  db: Queryable,
  viewerId: string,
  attachmentId: string,
): Promise<ViewableAttachment | null> {
  const [row] = await db
    .select({
      storageKey: attachment.storageKey,
      mime: attachment.mime,
      bytes: attachment.bytes,
      sha256: attachment.sha256,
      status: attachment.status,
      uploaderId: attachment.uploaderId,
      messageId: attachment.messageId,
    })
    .from(attachment)
    .where(eq(attachment.id, attachmentId));
  if (!row || row.status === 'removed') return null;
  const found: ViewableAttachment = {
    storageKey: row.storageKey,
    mime: row.mime,
    bytes: row.bytes,
    sha256: row.sha256,
  };
  if (row.status === 'pending') return row.uploaderId === viewerId ? found : null;
  if (row.messageId === null) {
    const [owner] = await db
      .select({ avatarKind: user.avatarKind, avatarConfig: user.avatarConfig, status: user.status })
      .from(user)
      .where(eq(user.id, row.uploaderId));
    const current =
      owner?.avatarKind === 'photo' &&
      owner.status !== 'deleted' &&
      photoAttachmentId(owner.avatarConfig) === attachmentId;
    return current ? found : null;
  }
  const [parent] = await db
    .select({
      conversationId: message.conversationId,
      deletedAt: message.deletedAt,
      moderationState: message.moderationState,
    })
    .from(message)
    .where(eq(message.id, row.messageId));
  if (!parent) return null;
  if (parent.deletedAt !== null || parent.moderationState === 'removed') return null;
  return (await canReadConversation(db, viewerId, parent.conversationId)) ? found : null;
}

export interface AttachmentGarbage {
  id: string;
  storageKey: string;
}

/**
 * Pictures whose files can be deleted: removed ones, and uploads never used within 24 hours
 * (database clock). The caller deletes the files first, then the rows (`deleteAttachmentRows`).
 *
 * A picture named in the evidence of a report that is still open is kept until the report is
 * closed, so the moderator can see what was reported even if it was replaced or deleted since.
 */
export async function listAttachmentGarbage(
  db: Queryable,
  limit = 200,
): Promise<AttachmentGarbage[]> {
  return db
    .select({ id: attachment.id, storageKey: attachment.storageKey })
    .from(attachment)
    .where(
      and(
        or(
          eq(attachment.status, 'removed'),
          and(
            eq(attachment.status, 'pending'),
            lt(attachment.createdAt, sql`now() - make_interval(hours => ${PENDING_UPLOAD_HOURS})`),
          ),
        ),
        sql`not exists (
          select 1 from ${report}
          where ${report.status} in ('open', 'in_review')
            and jsonb_exists(${report.evidence} -> 'attachmentIds', ${attachment.id}::text)
        )`,
      ),
    )
    .orderBy(asc(attachment.id))
    .limit(limit);
}

export async function deleteAttachmentRows(db: Queryable, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(attachment).where(inArray(attachment.id, [...ids]));
}
