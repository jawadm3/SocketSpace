'use client';

import Link from 'next/link';
import { useState, type SubmitEvent } from 'react';

import { Alert, Button, Card, TextField } from '@/components/ui';
import { formText } from '@/lib/forms';
import { authClient, authErrorMessage } from '@/lib/auth-client';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const email = formText(new FormData(event.currentTarget), 'email').trim();
    const result = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
    setPending(false);
    if (result.error) {
      setError(authErrorMessage(result.error));
      return;
    }
    setSent(true);
  }

  return (
    <Card>
      <h1 className="text-2xl font-extrabold tracking-tight">Reset your password</h1>
      {sent ? (
        <div className="mt-6 flex flex-col gap-4">
          {/* The same message whether or not the address has an account (no enumeration). */}
          <Alert tone="success">
            If an account uses that address, we have sent it a link. The link works once and expires
            in 30 minutes.
          </Alert>
          <Link
            href="/sign-in"
            className="text-sm font-semibold text-accent underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <p className="text-sm text-muted">
            Enter your email and we will send you a link to choose a new password.
          </p>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <TextField
            id="email"
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            required
          />
          <Button type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </Card>
  );
}
