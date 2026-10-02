import type { Metadata } from 'next';
import Link from 'next/link';

import { listPublicRooms, listUserRooms } from '@socketspace/db';

import { buttonClasses } from '@/components/ui';
import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';

import { SignOutButton } from '../sign-out-button';
import { VerifyEmailBanner } from '../verify-email-banner';
import { RoomCard } from './room-card';

export const metadata: Metadata = { title: 'Your space' };

export default async function AppHome() {
  const { user } = await requireAppUser('/app');
  const db = getDb();
  const [mine, publicRooms] = await Promise.all([
    listUserRooms(db, user.id),
    listPublicRooms(db, user.id, { limit: 12 }),
  ]);
  const suggested = publicRooms.filter((room) => !room.isMember).slice(0, 6);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
      {!user.emailVerified ? <VerifyEmailBanner email={user.email} /> : null}
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Hello, {user.nickname}</h1>
        <p className="mt-1 text-sm text-ink-2">Signed in as {user.email}</p>
      </header>

      <section aria-labelledby="my-rooms" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="my-rooms" className="text-lg font-bold">
            Your rooms
          </h2>
          <Link href="/app/rooms/new" className={buttonClasses('secondary', 'min-h-9 px-3')}>
            New room
          </Link>
        </div>
        {mine.length === 0 ? (
          <div className="rounded-card border border-dashed border-line p-6 text-sm text-ink-2">
            <p>You have not joined any rooms yet.</p>
            <p className="mt-1">
              Pick one below,{' '}
              <Link href="/app/explore" className="font-semibold text-accent underline">
                explore all public rooms
              </Link>
              , or start your own.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {mine.map((room) => (
              <RoomCard key={room.id} room={room} isMember />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="suggested" className="flex flex-col gap-3">
        <h2 id="suggested" className="text-lg font-bold">
          Rooms you might like
        </h2>
        {suggested.length === 0 ? (
          <p className="text-sm text-ink-2">
            No other public rooms right now. Why not{' '}
            <Link href="/app/rooms/new" className="font-semibold text-accent underline">
              create the first one
            </Link>
            ?
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {suggested.map((room) => (
              <RoomCard key={room.id} room={room} isMember={false} />
            ))}
          </ul>
        )}
      </section>

      {/* On small screens the sidebar (which has its own button) is hidden. */}
      <div className="md:hidden">
        <SignOutButton />
      </div>
    </main>
  );
}
