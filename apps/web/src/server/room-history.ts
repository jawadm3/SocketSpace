/**
 * `GET /api/conversations/[id]/messages?before=<seq>&limit=<n>`: older messages for infinite
 * scroll (HIST-02), for rooms and DMs. Pages are cut by message number (`seq`), never by position,
 * so a page stays the same while new messages arrive.
 *
 * Rooms follow the room page's rules (members, anyone for a public room, nobody who is banned);
 * DMs only their two members. Everything else is "not found" (nothing leaks).
 */
import 'server-only';

import {
  canReadConversation,
  getPublicUsers,
  hitRateLimit,
  listReactions,
  listRecentMessages,
  toMessageWire,
  type Database,
} from '@socketspace/db';
import type { MessageWire } from '@socketspace/shared/events';
import { uuid } from '@socketspace/shared/primitives';
import type { PublicUser } from '@socketspace/shared/profile';

import { SESSION_ABSOLUTE_MS, type Auth } from './auth';

export const HISTORY_PAGE_DEFAULT = 100;
export const HISTORY_PAGE_MAX = 150;
export const HISTORY_PAGES_PER_MINUTE = 120;

export interface HistoryPage {
  messages: MessageWire[];
  users: PublicUser[];
  /** True when messages older than this page exist. */
  hasMore: boolean;
}

function error(status: number, code: string, message: string, retryAfterMs?: number) {
  return Response.json(
    { error: retryAfterMs === undefined ? { code, message } : { code, message, retryAfterMs } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** A whole number from 1 to `max`, or `null`. */
function positiveInt(raw: string | null, max: number): number | null {
  if (raw === null || !/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= max ? value : null;
}

export async function loadRoomHistory(
  request: Request,
  conversationId: string,
  deps: { auth: Auth; db: Database },
): Promise<Response> {
  const current = await deps.auth.api.getSession({ headers: request.headers });
  if (!current || Date.now() - current.session.createdAt.getTime() > SESSION_ABSOLUTE_MS) {
    return error(401, 'UNAUTHENTICATED', 'Please sign in again.');
  }
  if (current.user.isAnonymous || !current.user.onboardedAt) {
    return error(403, 'FORBIDDEN', 'Finish setting up your account first.');
  }

  const params = new URL(request.url).searchParams;
  const before = positiveInt(params.get('before'), Number.MAX_SAFE_INTEGER);
  const limit = params.has('limit')
    ? positiveInt(params.get('limit'), HISTORY_PAGE_MAX)
    : HISTORY_PAGE_DEFAULT;
  if (before === null || limit === null) {
    return error(
      400,
      'VALIDATION',
      `Give "before" as a message number and "limit" from 1 to ${String(HISTORY_PAGE_MAX)}.`,
    );
  }

  const rate = await hitRateLimit(
    deps.db,
    `history:${current.user.id}`,
    HISTORY_PAGES_PER_MINUTE,
    60,
  );
  if (!rate.allowed) {
    return error(
      429,
      'RATE_LIMITED',
      'Too many requests. Please wait a moment.',
      rate.retryAfterMs,
    );
  }

  // Missing, private-and-not-yours, someone else's DM and banned all look the same.
  if (
    !uuid.safeParse(conversationId).success ||
    !(await canReadConversation(deps.db, current.user.id, conversationId))
  ) {
    return error(404, 'NOT_FOUND', 'Conversation not found.');
  }

  // One extra row tells whether anything older exists.
  const rows = await listRecentMessages(deps.db, conversationId, {
    beforeSeq: before,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(1) : rows;
  const reactions = await listReactions(
    deps.db,
    page.map((m) => m.id),
  );
  const users = await getPublicUsers(deps.db, current.user.id, [
    ...new Set(page.map((m) => m.authorId)),
  ]);
  const body: HistoryPage = {
    messages: page.map((m) => toMessageWire(m, reactions.get(m.id) ?? [])),
    users,
    hasMore,
  };
  return Response.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
}
