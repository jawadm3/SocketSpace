'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, type SubmitEvent } from 'react';

import { Alert, Button, TextField, buttonClasses } from '@/components/ui';
import { formText } from '@/lib/forms';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import type { SocialProviderId } from '@/server/auth';

const LABELS: Record<SocialProviderId, string> = {
  google: 'Google',
  facebook: 'Facebook',
  github: 'GitHub',
  discord: 'Discord',
  microsoft: 'Microsoft',
  linkedin: 'LinkedIn',
};

const TOP_ROW: SocialProviderId[] = ['facebook', 'github'];
const MORE: SocialProviderId[] = ['discord', 'microsoft', 'linkedin'];

/** Messages for errors Better Auth reports on the social sign-in callback (?error=...). */
function callbackMessage(code: string): string {
  if (code.includes('account_not_linked') || code.includes('unable_to_link')) {
    return 'An account with this email already exists. Sign in the way you first signed up; you can link this provider from Settings afterwards.';
  }
  return 'That sign-in did not complete. Please try again.';
}

function LastUsed() {
  return (
    <span className="rounded-full bg-stamp px-2 py-0.5 text-xs font-bold text-[#172033]">
      Last used
    </span>
  );
}

export function SignInForm({
  providers,
  lastUsed,
  next,
  callbackError,
}: {
  providers: SocialProviderId[];
  lastUsed: string | null;
  next: string;
  callbackError: string | null;
}) {
  const router = useRouter();
  const moreId = useId();
  const [error, setError] = useState<string | null>(
    callbackError ? callbackMessage(callbackError) : null,
  );
  const [pending, setPending] = useState(false);
  // Show the extra options straight away if the person last used one of them.
  const [showMore, setShowMore] = useState(
    lastUsed === 'passkey' || MORE.some((p) => p === lastUsed),
  );

  const enabled = new Set(providers);
  const topRow = TOP_ROW.filter((p) => enabled.has(p));
  const more = MORE.filter((p) => enabled.has(p));

  async function social(provider: SocialProviderId) {
    setError(null);
    setPending(true);
    const result = await authClient.signIn.social({
      provider,
      callbackURL: next,
      errorCallbackURL: '/sign-in',
    });
    if (result.error) {
      setError(authErrorMessage(result.error));
      setPending(false);
    }
  }

  async function withPasskey() {
    setError(null);
    setPending(true);
    const result = await authClient.signIn.passkey();
    setPending(false);
    if (result.error) {
      setError(authErrorMessage(result.error));
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function withEmail(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: formText(form, 'email'),
      password: formText(form, 'password'),
    });
    if (result.error) {
      setPending(false);
      setError(authErrorMessage(result.error));
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {enabled.has('google') ? (
        <Button
          variant="secondary"
          className="w-full text-base"
          disabled={pending}
          onClick={() => void social('google')}
        >
          Continue with Google {lastUsed === 'google' ? <LastUsed /> : null}
        </Button>
      ) : null}

      {topRow.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {topRow.map((provider) => (
            <Button
              key={provider}
              variant="secondary"
              disabled={pending}
              onClick={() => void social(provider)}
            >
              {LABELS[provider]} {lastUsed === provider ? <LastUsed /> : null}
            </Button>
          ))}
        </div>
      ) : null}

      <div>
        <button
          type="button"
          className="text-sm font-semibold text-accent underline-offset-4 hover:underline"
          aria-expanded={showMore}
          aria-controls={moreId}
          onClick={() => {
            setShowMore((value) => !value);
          }}
        >
          {showMore ? 'Fewer ways to sign in' : 'More ways to sign in'}
        </button>
        <div id={moreId} hidden={!showMore} className="mt-3 grid gap-3 sm:grid-cols-2">
          {more.map((provider) => (
            <Button
              key={provider}
              variant="secondary"
              disabled={pending}
              onClick={() => void social(provider)}
            >
              {LABELS[provider]} {lastUsed === provider ? <LastUsed /> : null}
            </Button>
          ))}
          <Button variant="secondary" disabled={pending} onClick={() => void withPasskey()}>
            Passkey {lastUsed === 'passkey' ? <LastUsed /> : null}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-muted">
        <span className="h-px flex-1 bg-line" /> or with email{' '}
        <span className="h-px flex-1 bg-line" />
      </div>

      <form className="flex flex-col gap-4" onSubmit={(event) => void withEmail(event)} noValidate>
        <TextField
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email webauthn"
          required
        />
        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
        />
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/forgot-password"
            className="text-sm text-accent underline-offset-4 hover:underline"
          >
            Forgot your password?
          </Link>
          {lastUsed === 'email' ? <LastUsed /> : null}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        New here?{' '}
        <Link
          href="/sign-up"
          className="font-semibold text-accent underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
      <p className="text-center text-sm">
        <Link href="/" className={buttonClasses('ghost', 'text-muted')}>
          Back to the home page
        </Link>
      </p>
    </div>
  );
}
