import { Hash, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { dmPartner, getPublicUsers, searchMessages, SEARCH_QUERY_MAX } from '@socketspace/db';
import { plainText } from '@socketspace/shared/markdown';

import { Button } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { highlight, searchTerms } from '@/lib/highlight';
import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';

import { LocalTime } from '../r/[slug]/message-item';

export const metadata: Metadata = { title: 'Search' };

/**
 * Search (HIST-03): messages in your rooms and DMs, newest first. Each result links to the message,
 * which the conversation page scrolls to.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { user } = await requireAppUser('/app/search');
  const raw = (await searchParams).q;
  const query = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, SEARCH_QUERY_MAX) ?? '';
  const db = getDb();
  const hits = query.trim() === '' ? [] : await searchMessages(db, user.id, query);
  const partners = new Map<string, string>();
  for (const hit of hits) {
    if (hit.conversationKind !== 'dm' || partners.has(hit.message.conversationId)) continue;
    const other = await dmPartner(db, hit.message.conversationId, user.id);
    if (other) partners.set(hit.message.conversationId, other);
  }
  const people = new Map(
    (
      await getPublicUsers(db, user.id, [
        ...new Set([...hits.map((h) => h.message.authorId), ...partners.values()]),
      ])
    ).map((p) => [p.id, p]),
  );
  const terms = searchTerms(query);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Search</h1>
      <form role="search" action="/app/search" className="flex gap-2">
        <label htmlFor="search-query" className="sr-only">
          Search messages
        </label>
        <input
          id="search-query"
          name="q"
          type="search"
          defaultValue={query}
          maxLength={SEARCH_QUERY_MAX}
          placeholder="Search your rooms and messages"
          className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-3 text-base text-ink"
        />
        <Button type="submit">
          <Search aria-hidden="true" className="h-4 w-4" />
          Search
        </Button>
      </form>
      <p className="text-sm text-ink-2">
        Whole words, in any letter case. Use quotes for a phrase, OR for either word, and a minus
        sign to leave a word out.
      </p>
      {query.trim() === '' ? null : hits.length === 0 ? (
        <p role="status">No messages found for “{query}”.</p>
      ) : (
        <>
          <p role="status" className="text-sm text-ink-2">
            {hits.length === 1 ? '1 message' : `${String(hits.length)} messages`} (newest first)
          </p>
          <ul className="flex flex-col gap-2" aria-label="Search results">
            {hits.map(({ message, conversationKind, roomSlug, roomName }) => {
              const author = people.get(message.authorId);
              const partner = people.get(partners.get(message.conversationId) ?? '');
              const href =
                conversationKind === 'room' && roomSlug
                  ? `/app/r/${roomSlug}?m=${message.id}`
                  : `/app/dm/${message.conversationId}?m=${message.id}`;
              const place =
                conversationKind === 'room' ? `#${roomName ?? ''}` : `@${partner?.nickname ?? ''}`;
              return (
                <li key={message.id}>
                  <Link
                    href={href}
                    className="flex gap-3 rounded-xl border border-line bg-card p-3 hover:bg-surface-2"
                  >
                    <UserAvatar user={author} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-bold text-ink">{author?.nickname ?? 'Someone'}</span>
                        <span className="flex items-center gap-0.5 text-ink-2">
                          {conversationKind === 'room' ? (
                            <Hash aria-hidden="true" className="h-3.5 w-3.5" />
                          ) : null}
                          {conversationKind === 'room' ? place.slice(1) : place}
                        </span>
                        <span className="text-xs text-muted">
                          <LocalTime iso={message.createdAt.toISOString()} withDate />
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-3 block text-[0.95rem] break-words text-ink">
                        {highlight(plainText(message.body), terms)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
