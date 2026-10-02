/**
 * Turning database rows into the shapes browsers receive (packages/shared events).
 */
import type { MessageRow } from '@socketspace/db';
import type { MessageWire } from '@socketspace/shared/events';

export function toMessageWire(row: MessageRow): MessageWire {
  const removed = row.moderationState === 'removed' || row.deletedAt !== null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    seq: row.seq,
    eventSeq: row.versionSeq,
    authorId: row.authorId,
    clientId: row.clientId,
    kind: row.kind,
    // Deleted and removed messages keep their place but never their text.
    body: removed ? '' : row.body,
    replyToId: row.replyToId,
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    deletedBy: row.deletedBy,
    moderationState: row.moderationState,
    createdAt: row.createdAt.toISOString(),
    // Reactions are loaded in Stage D.
    reactions: [],
  };
}
