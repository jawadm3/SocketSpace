import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { Card } from '@/components/ui';
import { enabledSocialProviders } from '@/server/auth';
import { getWebEnv } from '@/server/env';
import { safeNextPath } from '@/server/session';

import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

/** Cookie written by Better Auth's last-login-method plugin (this device only). */
const LAST_USED_COOKIE = 'better-auth.last_used_login_method';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const lastUsed = (await cookies()).get(LAST_USED_COOKIE)?.value ?? null;

  return (
    <Card>
      <h1 className="text-2xl font-extrabold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">Sign in to your rooms and conversations.</p>
      <SignInForm
        providers={enabledSocialProviders(getWebEnv())}
        lastUsed={lastUsed}
        next={safeNextPath(first(params.next))}
        callbackError={first(params.error) ?? null}
      />
    </Card>
  );
}
