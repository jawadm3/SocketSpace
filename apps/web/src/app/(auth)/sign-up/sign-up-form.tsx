'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';

import { LIMITS } from '@socketspace/shared/limits';

import { Alert, Button, TextField } from '@/components/ui';
import { formText } from '@/lib/forms';
import { authClient, authErrorMessage } from '@/lib/auth-client';

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPasswordError(undefined);
    const form = new FormData(event.currentTarget);
    const email = formText(form, 'email').trim();
    const password = formText(form, 'password');
    if (password.length < LIMITS.password.min) {
      setPasswordError(`Use at least ${String(LIMITS.password.min)} characters.`);
      return;
    }
    setPending(true);
    const result = await authClient.signUp.email({
      email,
      password,
      // The real name is optional and chosen later; Better Auth requires the field.
      name: '',
      callbackURL: '/onboarding',
    });
    if (result.error) {
      setPending(false);
      setError(authErrorMessage(result.error));
      return;
    }
    router.push('/onboarding');
    router.refresh();
  }

  return (
    <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <TextField id="email" name="email" type="email" label="Email" autoComplete="email" required />
      <TextField
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        minLength={LIMITS.password.min}
        maxLength={LIMITS.password.max}
        required
        hint={`At least ${String(LIMITS.password.min)} characters. A few unrelated words make a strong, memorable password.`}
        error={passwordError}
      />
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating your account…' : 'Create account'}
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{' '}
        <Link
          href="/sign-in"
          className="font-semibold text-accent underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
