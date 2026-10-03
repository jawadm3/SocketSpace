import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import {
  getDmForViewer,
  getPublicUsers,
  listRecentMessages,
  loadMessageWires,
} from '@socketspace/db';
import { uuid } from '@socketspace/shared/primitives';

import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';

import { RoomView } from '../../r/[slug]/room-view';

/** Messages drawn with the page; older ones load as the reader scrolls up. */
const PAGE_SIZE = 50;

/** One database read per request, shared by the title and the page. */
const loadDm = cache(async (id: string) => {
  const { user } = await requireAppUser(`/app/dm/${id}`);
  if (!uuid.safeParse(id).success) return { user, view: null, other: undefined };
  const db = getDb();
  const view = await getDmForViewer(db, user.id, id);
  const [other] = view ? await getPublicUsers(db, user.id, [view.otherUserId]) : [];
  return { user, view, other };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { other } = await loadDm((await params).id);
  return { title: other ? `@${other.nickname}` : 'Conversation not found' };
}

/** A direct message (DM-01, DM-02): the room view without room tools, plus receipts. */
export default async function DmPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m?: string | string[] }>;
}) {
  const { id } = await params;
  const focus = uuid.safeParse((await searchParams).m);
  const { user, view, other } = await loadDm(id);
  // Someone else's DM looks exactly like one that does not exist.
  if (!view || !other) notFound();

  const db = getDb();
  const latest = await listRecentMessages(db, view.id, { limit: PAGE_SIZE + 1 });
  const hasOlder = latest.length > PAGE_SIZE;
  const messages = hasOlder ? latest.slice(1) : latest;
  const initialMessages = await loadMessageWires(db, messages);
  const people = await getPublicUsers(db, user.id, [
    ...new Set([user.id, view.otherUserId, ...messages.map((m) => m.authorId)]),
  ]);

  return (
    <RoomView
      room={{
        id: view.id,
        slug: '',
        name: other.nickname,
        topic: '',
        visibility: 'private',
        memberCount: 2,
        lastEventSeq: view.lastEventSeq,
      }}
      membership={{ role: 'member', mutedUntil: null }}
      emailVerified={user.emailVerified}
      initialMessages={initialMessages}
      initialMembers={[user.id, view.otherUserId].map((userId) => ({
        userId,
        role: 'member' as const,
        joinedAt: new Date(0).toISOString(),
      }))}
      people={people}
      hasOlder={hasOlder}
      dm={{ otherUserId: view.otherUserId, blocked: view.blocked, receipts: view.receipts }}
      {...(focus.success ? { focusMessageId: focus.data } : {})}
    />
  );
}
