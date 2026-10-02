import { Search } from 'lucide-react';
import type { Metadata } from 'next';

import { listPublicRooms } from '@socketspace/db';

import { Alert, buttonClasses } from '@/components/ui';
import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';

import { RoomCard } from '../room-card';

export const metadata: Metadata = { title: 'Explore rooms' };

/** The public room directory, busiest first, with a search box (ROOM-02). */
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; error?: string | string[] }>;
}) {
  const { user } = await requireAppUser('/app/explore');
  const params = await searchParams;
  const query = (typeof params.q === 'string' ? params.q : '').slice(0, 100);
  const error = typeof params.error === 'string' ? params.error.slice(0, 300) : '';
  const rooms = await listPublicRooms(getDb(), user.id, { query, limit: 60 });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Explore rooms</h1>
        <p className="mt-1 text-sm text-ink-2">Public rooms anyone can join, busiest first.</p>
      </header>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form role="search" className="flex gap-2" action="/app/explore">
        <label htmlFor="q" className="sr-only">
          Search rooms
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          maxLength={100}
          placeholder="Search by name or topic"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-base"
        />
        <button type="submit" className={buttonClasses('secondary')}>
          <Search aria-hidden="true" className="h-4 w-4" />
          Search
        </button>
      </form>
      {rooms.length === 0 ? (
        <p className="text-sm text-ink-2">
          {query
            ? `No rooms match "${query}". Try another word, or create the room yourself.`
            : 'There are no public rooms yet. Create the first one!'}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} isMember={room.isMember} />
          ))}
        </ul>
      )}
    </main>
  );
}
