/**
 * Link previews (MSG-08): the cache of what the web app's safe fetcher found at an address, and
 * which message may ask for it.
 *
 * The cache is keyed by a hash of the normalised address. A good answer is kept for 7 days; a
 * refusal ("blocked", for example a private address) or a failure is kept for a shorter time, so
 * the same bad link is not fetched again by every reader.
 *
 * Many people may open a message with a new link at the same moment. So that our server fetches
 * the page once, not once per reader, a reader first "claims" the address (a short-lived
 * placeholder entry); everyone else sees the placeholder and asks again a moment later.
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm';

import type { Queryable } from '../client';
import { linkPreview, message, messageLink } from '../schema/messages';
import { canReadConversation } from './dms';

export type LinkPreviewRow = typeof linkPreview.$inferSelect & {
  /** A placeholder: someone is fetching this address right now. */
  pending: boolean;
};

/** How long a claim lasts. Longer than a fetch can take (3 seconds), short enough to retry soon. */
export const LINK_PREVIEW_CLAIM_SECONDS = 10;

/** Cached previews that have not expired yet (database clock), by address hash. */
export async function getFreshLinkPreviews(
  db: Queryable,
  urlHashes: readonly string[],
): Promise<Map<string, LinkPreviewRow>> {
  if (urlHashes.length === 0) return new Map();
  const rows = await db
    .select()
    .from(linkPreview)
    .where(
      and(inArray(linkPreview.urlHash, [...urlHashes]), gt(linkPreview.expiresAt, sql`now()`)),
    );
  return new Map(
    rows.map((row) => [
      row.urlHash,
      {
        ...row,
        // Only a claim lives this briefly (both times come from the database clock).
        pending:
          row.expiresAt.getTime() - row.fetchedAt.getTime() <= LINK_PREVIEW_CLAIM_SECONDS * 1000,
      },
    ]),
  );
}

/**
 * Claims the right to fetch an address that has no fresh cache entry. Exactly one caller gets
 * `true` (the insert or update happens once); the others get `false` and should ask again later.
 * If the winner never stores a result, the claim runs out by itself.
 */
export async function claimLinkPreviewFetch(
  db: Queryable,
  urlHash: string,
  url: string,
): Promise<boolean> {
  const expiresAt = sql`now() + make_interval(secs => ${LINK_PREVIEW_CLAIM_SECONDS})`;
  const claimed = await db
    .insert(linkPreview)
    .values({ urlHash, url, status: 'error', fetchedAt: sql`now()`, expiresAt })
    .onConflictDoUpdate({
      target: linkPreview.urlHash,
      set: {
        url,
        status: 'error',
        title: null,
        description: null,
        siteName: null,
        fetchedAt: sql`now()`,
        expiresAt,
      },
      setWhere: sql`${linkPreview.expiresAt} <= now()`,
    })
    .returning({ urlHash: linkPreview.urlHash });
  return claimed.length > 0;
}

export interface SaveLinkPreview {
  urlHash: string;
  url: string;
  status: 'ok' | 'blocked' | 'error';
  title: string | null;
  description: string | null;
  siteName: string | null;
  ttlSeconds: number;
}

/** Stores (or refreshes) what was found at an address. */
export async function saveLinkPreview(db: Queryable, input: SaveLinkPreview): Promise<void> {
  const { ttlSeconds, ...values } = input;
  const expiresAt = sql`now() + make_interval(secs => ${ttlSeconds})`;
  await db
    .insert(linkPreview)
    .values({ ...values, fetchedAt: sql`now()`, expiresAt })
    .onConflictDoUpdate({
      target: linkPreview.urlHash,
      set: {
        url: values.url,
        status: values.status,
        title: values.title,
        description: values.description,
        siteName: values.siteName,
        fetchedAt: sql`now()`,
        expiresAt,
      },
    });
}

/** Remembers which previews a message shows (removed with the message or the cache entry). */
export async function linkMessageToPreviews(
  db: Queryable,
  messageId: string,
  urlHashes: readonly string[],
): Promise<void> {
  if (urlHashes.length === 0) return;
  await db
    .insert(messageLink)
    .values(urlHashes.map((urlHash) => ({ messageId, urlHash })))
    .onConflictDoNothing();
}

/**
 * The text of a message, if this viewer may read it and it is still there; `null` otherwise
 * (missing, deleted and "not yours" look the same).
 */
export async function getReadableMessageBody(
  db: Queryable,
  viewerId: string,
  messageId: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      body: message.body,
      conversationId: message.conversationId,
      deletedAt: message.deletedAt,
      moderationState: message.moderationState,
    })
    .from(message)
    .where(eq(message.id, messageId));
  if (!row) return null;
  if (row.deletedAt !== null || row.moderationState === 'removed') return null;
  return (await canReadConversation(db, viewerId, row.conversationId)) ? row.body : null;
}
