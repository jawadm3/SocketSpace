/**
 * Random chat for signed-in people (RAND-02 to RAND-11): the 18+ gate first, then the lobby, the
 * search, the chat and the end screen, on the app shell's live connection.
 */
import type { Metadata } from 'next';

import { Card } from '@/components/ui';
import { GateForm } from '@/components/random/gate-form';
import { MemberRandom } from '@/components/random/connections';
import { getDb } from '@/server/db';
import { getWebEnv } from '@/server/env';
import { getRandomPageState } from '@/server/random';
import { requireAppUser } from '@/server/session';

export const metadata: Metadata = { title: 'Random chat' };

export default async function RandomPage() {
  const { user } = await requireAppUser('/app/random');
  if (!getWebEnv().RANDOM_MODE_ENABLED) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <Card>
          <h1 className="text-2xl font-extrabold tracking-tight">Random chat is switched off</h1>
          <p className="mt-2 text-ink-2">
            It is not available at the moment. Rooms and direct messages work as usual.
          </p>
        </Card>
      </main>
    );
  }
  const state = await getRandomPageState(getDb(), user.id);
  if (!state.accepted) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <Card>
          <GateForm startGuestSession={false} rulesChanged={state.rulesChanged} />
        </Card>
      </main>
    );
  }
  return (
    <main className="h-full">
      <MemberRandom pause={state.pause} />
    </main>
  );
}
