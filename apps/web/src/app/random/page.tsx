/**
 * Random chat for guests (RAND-10, D-025): no account needed. The 18+ gate comes first; accepting
 * it starts a guest session, which can do nothing but random chat, with stricter limits (half the
 * message rate, no sharing of profiles or contacts). People with an account are sent to the
 * same chat inside the app.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card } from '@/components/ui';
import { GateForm } from '@/components/random/gate-form';
import { GuestRandom } from '@/components/random/connections';
import { getDb } from '@/server/db';
import { getWebEnv } from '@/server/env';
import { getRandomPageState } from '@/server/random';
import { getCurrentSession } from '@/server/session';

export const metadata: Metadata = { title: 'Random chat' };

function Frame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex h-dvh flex-col">
      <div className="airmail-stripe h-1.5 w-full" aria-hidden="true" />
      <header className="flex items-center justify-between gap-3 border-b border-line bg-card px-4 py-3">
        <Link href="/" className="text-lg font-extrabold tracking-tight">
          SocketSpace
        </Link>
        <nav aria-label="Account" className="flex items-center gap-4 text-sm font-semibold">
          <Link href="/sign-in" className="text-ink-2 underline">
            Sign in
          </Link>
          <Link href="/sign-up" className="text-accent underline">
            Create an account
          </Link>
        </nav>
      </header>
      <main className={`min-h-0 flex-1 overflow-y-auto ${wide ? '' : 'px-4 py-8'}`}>
        {children}
      </main>
    </div>
  );
}

export default async function GuestRandomPage() {
  if (!getWebEnv().RANDOM_MODE_ENABLED) {
    return (
      <Frame>
        <div className="mx-auto w-full max-w-xl">
          <Card>
            <h1 className="text-2xl font-extrabold tracking-tight">Random chat is switched off</h1>
            <p className="mt-2 text-ink-2">It is not available at the moment.</p>
          </Card>
        </div>
      </Frame>
    );
  }
  const current = await getCurrentSession();
  if (current && !current.user.isAnonymous) redirect('/app/random');

  const state = current ? await getRandomPageState(getDb(), current.user.id) : null;
  if (!state?.accepted) {
    return (
      <Frame>
        <div className="mx-auto w-full max-w-2xl">
          <Card>
            <GateForm startGuestSession={!current} rulesChanged={state?.rulesChanged ?? false} />
          </Card>
        </div>
      </Frame>
    );
  }
  return (
    <Frame wide>
      <GuestRandom pause={state.pause} />
    </Frame>
  );
}
