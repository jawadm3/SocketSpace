'use client';

/**
 * The 18+ gate of random chat (RAND-02, security.md 4.3): the rules in plain language, two boxes
 * to tick, and an honest note that this is a self-declaration, not an age check. Shown before
 * first use and again whenever the rules change.
 *
 * For a visitor without an account, continuing first starts a guest session (D-025) and then
 * records the acceptance on it.
 */
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';

import { RANDOM_RULES, RANDOM_RULES_VERSION } from '@socketspace/shared/random';

import { acceptRandomRulesAction } from '@/app/random/actions';
import { Alert, Button } from '@/components/ui';
import { authClient, authErrorMessage } from '@/lib/auth-client';

export function GateForm({
  startGuestSession,
  rulesChanged,
}: {
  /** No session yet: continuing creates a guest one. */
  startGuestSession: boolean;
  /** The person accepted an earlier version of the rules. */
  rulesChanged: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('adult') !== 'on' || form.get('rules') !== 'on') {
      setError('Please tick both boxes to continue.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (startGuestSession) {
        const guest = await authClient.signIn.anonymous();
        if (guest.error) {
          setError(authErrorMessage(guest.error));
          return;
        }
      }
      const result = await acceptRandomRulesAction({}, form);
      if (result.error) setError(result.error);
      else router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-4"
      aria-labelledby="random-gate-title"
    >
      <h1 id="random-gate-title" className="text-2xl font-extrabold tracking-tight">
        Before you start: the rules of random chat
      </h1>
      {rulesChanged ? (
        <Alert>The rules have changed since you last accepted them. Please read them again.</Alert>
      ) : null}
      <ol className="list-decimal space-y-2 pl-5 text-ink-2">
        {RANDOM_RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ol>
      <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
        Ticking the box below is your own declaration, not an age check. SocketSpace is a portfolio
        project, not a public service with verified ages.
      </p>
      <input type="hidden" name="version" value={RANDOM_RULES_VERSION} />
      <label className="flex min-h-11 items-start gap-3 text-base">
        <input type="checkbox" name="adult" className="mt-1 h-5 w-5" />
        <span>I am 18 or older.</span>
      </label>
      <label className="flex min-h-11 items-start gap-3 text-base">
        <input type="checkbox" name="rules" className="mt-1 h-5 w-5" />
        <span>I have read the rules above and accept them.</span>
      </label>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <Button type="submit" disabled={busy}>
          {startGuestSession ? 'Continue as a guest' : 'Continue'}
        </Button>
      </div>
      <p className="text-sm text-muted">Rules version {RANDOM_RULES_VERSION}.</p>
    </form>
  );
}
