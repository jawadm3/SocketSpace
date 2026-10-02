'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type SubmitEvent } from 'react';

import { LIMITS } from '@socketspace/shared/limits';

import { Alert, Button, Card, TextField } from '@/components/ui';
import { formText } from '@/lib/forms';
import { authClient, authErrorMessage } from '@/lib/auth-client';

function ResetForm() {
  const params = useSearchParams();
  const token = params.get('token');
  const linkError = params.get('error');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token || linkError) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <Alert tone="error">
          This reset link is invalid or has expired. Links work once, for 30 minutes.
        </Alert>
        <Link
          href="/forgot-password"
          className="text-sm font-semibold text-accent underline-offset-4 hover:underline"
        >
          Ask for a new link
        </Link>
      </div>
    );
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const newPassword = formText(new FormData(event.currentTarget), 'password');
    if (newPassword.length < LIMITS.password.min) {
      setError(`Use at least ${String(LIMITS.password.min)} characters.`);
      return;
    }
    setPending(true);
    const result = await authClient.resetPassword({ newPassword, token: token ?? '' });
    setPending(false);
    if (result.error) {
      setError(authErrorMessage(result.error));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <Alert tone="success">
          Your password has been changed and every device has been signed out.
        </Alert>
        <Link
          href="/sign-in"
          className="text-sm font-semibold text-accent underline-offset-4 hover:underline"
        >
          Sign in with your new password
        </Link>
      </div>
    );
  }

  return (
    <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <TextField
        id="password"
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        minLength={LIMITS.password.min}
        maxLength={LIMITS.password.max}
        hint={`At least ${String(LIMITS.password.min)} characters.`}
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Card>
      <h1 className="text-2xl font-extrabold tracking-tight">Choose a new password</h1>
      <Suspense fallback={<p className="mt-6 text-sm text-muted">Loading…</p>}>
        <ResetForm />
      </Suspense>
    </Card>
  );
}
