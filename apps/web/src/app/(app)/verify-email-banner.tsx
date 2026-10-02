'use client';

import { useState } from 'react';

import { Alert, Button } from '@/components/ui';
import { authClient, authErrorMessage } from '@/lib/auth-client';

/** Shown until the email address is confirmed: the account is read-only until then (journey J1). */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorText, setErrorText] = useState('');

  async function resend() {
    setState('sending');
    const result = await authClient.sendVerificationEmail({ email, callbackURL: '/app' });
    if (result.error) {
      setErrorText(authErrorMessage(result.error));
      setState('error');
    } else {
      setState('sent');
    }
  }

  return (
    <Alert tone="info">
      <p className="font-semibold">Please confirm your email address</p>
      <p className="mt-1">
        You can look around, but posting is switched on once you open the link we sent to {email}.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="secondary" disabled={state === 'sending'} onClick={() => void resend()}>
          {state === 'sending' ? 'Sending…' : 'Send the link again'}
        </Button>
        {state === 'sent' ? <span>Sent. Check your inbox.</span> : null}
        {state === 'error' ? <span>{errorText}</span> : null}
      </div>
    </Alert>
  );
}
