import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import {
  getPublicUsers,
  getRoomForViewer,
  listRecentMessages,
  listRoomMembers,
  loadMessageWires,
} from '@socketspace/db';

import { uuid } from '@socketspace/shared/primitives';

import { Alert, buttonClasses, Card } from '@/components/ui';
import { getDb } from '@/server/db';
import { getAccountMute } from '@/server/moderation';
import { timeLeft } from '@/server/rooms';
import { requireAppUser } from '@/server/session';

import { RoomView } from './room-view';

/** Messages drawn with the page; older ones load as the reader scrolls up. */
const PAGE_SIZE = 50;

/** One database read per request, shared by the title and the page. */
const loadRoom = cache(async (slug: string) => {
  const { user } = await requireAppUser(`/app/r/${slug}`);
  return { user, view: await getRoomForViewer(getDb(), user.id, slug) };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { view } = await loadRoom((await params).slug);
  return { title: view ? view.room.name : 'Room not found' };
}

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ m?: string | string[]; from?: string | string[] }>;
}) {
  const { slug } = await params;
  // `?from=random`: opened from a room suggestion at the end of a random chat (RAND-09).
  const fromRandom = (await searchParams).from === 'random';
  // `?m=<message id>` (from search or a notification): the list jumps to that message.
  const focus = uuid.safeParse((await searchParams).m);
  const { user, view } = await loadRoom(slug);
  // Missing, deleted, and private-but-not-yours all look the same: nothing leaks (journey J5).
  if (!view) notFound();
  const { room, membership, ban } = view;

  if (ban && !membership) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <Card>
          <h1 className="text-2xl font-extrabold tracking-tight">{room.name}</h1>
          <div className="mt-4">
            <Alert tone="error">
              You are banned from this room.{' '}
              {ban.until ? `The ban ends ${timeLeft(ban.until)}.` : 'A moderator can lift it.'}
            </Alert>
          </div>
          <Link href="/app" className={buttonClasses('secondary', 'mt-6')}>
            Back to your rooms
          </Link>
        </Card>
      </main>
    );
  }

  const db = getDb();
  const [latest, members, accountMute] = await Promise.all([
    // One extra row tells whether older messages exist (loaded on scroll, HIST-02).
    listRecentMessages(db, room.id, { limit: PAGE_SIZE + 1 }),
    listRoomMembers(db, room.id, { limit: 200 }),
    getAccountMute(db, user.id),
  ]);
  const hasOlder = latest.length > PAGE_SIZE;
  const messages = hasOlder ? latest.slice(1) : latest;
  const initialMessages = await loadMessageWires(db, messages);
  const people = await getPublicUsers(db, user.id, [
    ...new Set([...members.map((m) => m.userId), ...messages.map((m) => m.authorId)]),
  ]);

  return (
    <RoomView
      room={{
        id: room.id,
        slug: room.slug,
        name: room.name,
        topic: room.topic,
        visibility: room.visibility,
        memberCount: room.memberCount,
        lastEventSeq: room.lastEventSeq,
      }}
      membership={
        membership
          ? {
              role: membership.role,
              mutedUntil: membership.muted ? (membership.mutedUntil?.toISOString() ?? null) : null,
            }
          : null
      }
      accountMute={accountMute}
      fromRandom={fromRandom}
      emailVerified={user.emailVerified}
      initialMessages={initialMessages}
      hasOlder={hasOlder}
      {...(focus.success ? { focusMessageId: focus.data } : {})}
      initialMembers={members.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      }))}
      people={people}
    />
  );
}
