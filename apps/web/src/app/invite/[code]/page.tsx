import { Hash, Lock, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { getRoomForViewer, invitePreview } from '@socketspace/db';
import { inviteCodeSchema } from '@socketspace/shared/rooms';

import { Alert, buttonClasses, Card } from '@/components/ui';
import { getDb } from '@/server/db';
import { roomRefusalText } from '@/server/rooms';
import { getCurrentSession } from '@/server/session';

import { JoinWithInvite } from './join-with-invite';

export const metadata: Metadata = { title: 'Invitation' };

/** What an invite link opens: the room's name and a "Join" button (ROOM-03, journey J5). */
export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parsed = inviteCodeSchema.safeParse(code);
  const db = getDb();
  const preview = parsed.success
    ? await invitePreview(db, parsed.data)
    : ({ ok: false, reason: 'invite_invalid', problem: 'not_found' } as const);
  const current = await getCurrentSession();
  const here = `/invite/${encodeURIComponent(code)}`;

  let body;
  if (!preview.ok) {
    body = (
      <>
        <h1 className="text-2xl font-extrabold tracking-tight">This invite does not work</h1>
        <div className="mt-4">
          <Alert tone="error">{roomRefusalText(preview)}</Alert>
        </div>
        <Link href={current ? '/app' : '/'} className={buttonClasses('secondary', 'mt-6')}>
          {current ? 'Back to your rooms' : 'Go to SocketSpace'}
        </Link>
      </>
    );
  } else {
    const { room } = preview;
    const already =
      current && !current.user.isAnonymous && current.user.onboardedAt
        ? (await getRoomForViewer(db, current.user.id, room.slug))?.membership
        : null;
    body = (
      <>
        <p className="text-sm font-semibold text-muted">You are invited to</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          {room.visibility === 'private' ? (
            <Lock aria-label="Private room" className="h-5 w-5 text-muted" />
          ) : (
            <Hash aria-hidden="true" className="h-5 w-5 text-muted" />
          )}
          {room.name}
        </h1>
        {room.topic ? <p className="mt-2 text-ink-2">{room.topic}</p> : null}
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted">
          <Users aria-hidden="true" className="h-4 w-4" />
          {room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}
        </p>
        <div className="mt-6">
          {!current || current.user.isAnonymous ? (
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/sign-in?next=${encodeURIComponent(here)}`}
                className={buttonClasses('primary')}
              >
                Sign in to join
              </Link>
              <Link href="/sign-up" className={buttonClasses('secondary')}>
                Create an account
              </Link>
            </div>
          ) : !current.user.onboardedAt ? (
            <Link href="/onboarding" className={buttonClasses('primary')}>
              Finish setting up your profile first
            </Link>
          ) : already ? (
            <Link href={`/app/r/${room.slug}`} className={buttonClasses('primary')}>
              You are already in: open #{room.name}
            </Link>
          ) : (
            <JoinWithInvite code={code} name={room.name} />
          )}
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="airmail-stripe h-2 w-full" aria-hidden="true" />
      <main className="mx-auto w-full max-w-lg px-4 py-12">
        <Card>{body}</Card>
      </main>
    </div>
  );
}
