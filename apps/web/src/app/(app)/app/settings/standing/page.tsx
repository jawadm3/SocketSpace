import type { Metadata } from 'next';
import Link from 'next/link';

import { getActiveSanctions, type ActiveSanction } from '@socketspace/db';

import { Alert, Card } from '@/components/ui';
import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';

import { LocalTime } from '../../r/[slug]/message-item';

export const metadata: Metadata = { title: 'Account standing' };

const TITLE: Record<ActiveSanction['kind'], string> = {
  warn: 'Warning',
  mute: 'Muted',
  suspend: 'Suspended',
  ban: 'Banned',
  random_timeout: 'No random chat',
};

const MEANING: Record<ActiveSanction['kind'], string> = {
  warn: 'Nothing is restricted. Please take the reason to heart.',
  mute: 'You can read everything, but you cannot post, edit or react.',
  suspend: 'You cannot use SocketSpace.',
  ban: 'You cannot use SocketSpace.',
  random_timeout: 'You cannot use random chat. Rooms and direct messages are not affected.',
};

/**
 * Settings > Account standing (ADMIN-03): what the site's moderators have decided about this
 * account that is in force right now, each with its reason and its end. This is where a
 * "message from the moderators" notification leads, so a person who was offline when a moderator
 * acted still reads why.
 */
export default async function StandingPage() {
  const { user } = await requireAppUser('/app/settings/standing');
  const sanctions = await getActiveSanctions(getDb(), user.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Account standing</h1>
        <p className="mt-1 text-sm text-ink-2">
          What the moderators have decided about your account. Also in settings:{' '}
          <Link href="/app/settings/profile" className="font-semibold text-accent underline">
            profile
          </Link>
          .
        </p>
      </header>
      {sanctions.length === 0 ? (
        <Alert tone="success">Your account is in good standing. Nothing is restricted.</Alert>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Decisions in force">
          {sanctions.map((sanction) => (
            <li key={sanction.id}>
              <Card>
                <h2 className="text-lg font-extrabold">{TITLE[sanction.kind]}</h2>
                <p className="mt-1 text-sm text-ink-2">{MEANING[sanction.kind]}</p>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="font-semibold">Reason</dt>
                  <dd>{sanction.reason}</dd>
                  <dt className="font-semibold">Since</dt>
                  <dd>
                    <LocalTime iso={sanction.startsAt.toISOString()} withDate />
                  </dd>
                  {sanction.kind === 'warn' ? null : (
                    <>
                      <dt className="font-semibold">Until</dt>
                      <dd>
                        {sanction.expiresAt ? (
                          <LocalTime iso={sanction.expiresAt.toISOString()} withDate />
                        ) : (
                          'A moderator lifts it'
                        )}
                      </dd>
                    </>
                  )}
                </dl>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
