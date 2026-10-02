import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { Button, Card } from '@/components/ui';
import { getAuth } from '@/server/auth-instance';
import { requireAppUser } from '@/server/session';

import { revokeOtherSessionsAction, revokeSessionAction } from './actions';

export const metadata: Metadata = { title: 'Devices and sessions' };

/** A short, readable browser and system name from a user-agent string. */
function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device';
  const browser = userAgent.includes('Edg/')
    ? 'Edge'
    : userAgent.includes('Firefox/')
      ? 'Firefox'
      : userAgent.includes('Chrome/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : 'A browser';
  const system = userAgent.includes('Windows')
    ? 'Windows'
    : userAgent.includes('Android')
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : userAgent.includes('Mac OS X')
          ? 'macOS'
          : userAgent.includes('Linux')
            ? 'Linux'
            : 'an unknown system';
  return `${browser} on ${system}`;
}

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export default async function SessionsPage() {
  const current = await requireAppUser('/settings/sessions');
  const sessions = await getAuth().api.listSessions({ headers: await headers() });
  sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Link
        href="/app"
        className="text-sm font-semibold text-accent underline-offset-4 hover:underline"
      >
        ← Back
      </Link>
      <Card>
        <h1 className="text-2xl font-extrabold tracking-tight">Devices and sessions</h1>
        <p className="mt-1 text-sm text-muted">
          Everywhere you are signed in. Signing a device out also disconnects it from live chat
          straight away.
        </p>
        <ul className="mt-6 divide-y divide-line">
          {sessions.map((session) => {
            const isCurrent = session.id === current.session.id;
            return (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div>
                  <p className="font-semibold">
                    {describeDevice(session.userAgent)}
                    {isCurrent ? (
                      <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs">
                        This device
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted">
                    Signed in {dateFormat.format(session.createdAt)} · last active{' '}
                    {dateFormat.format(session.updatedAt)}
                  </p>
                </div>
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <Button type="submit" variant="secondary">
                    {isCurrent ? 'Sign out' : 'Sign out this device'}
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
        {sessions.length > 1 ? (
          <form action={revokeOtherSessionsAction} className="mt-4">
            <Button type="submit" variant="danger">
              Sign out everywhere else
            </Button>
          </form>
        ) : null}
      </Card>
    </main>
  );
}
