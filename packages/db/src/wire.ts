/**
 * Turning database rows into the shapes browsers receive (packages/shared events). Used by the
 * realtime server for live events and by the web app for history it renders on the server.
 */
import type { MessageWire } from '@socketspace/shared/events';

import type { ReactionSummary } from './queries/message-actions';
import type { MessageRow } from './queries/messages';

export function toMessageWire(row: MessageRow, reactions: ReactionSummary[] = []): MessageWire {
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
    // Reaction emoji come from the allow-list (checked before they are stored).
    reactions: removed ? [] : (reactions as MessageWire['reactions']),
  };
}
