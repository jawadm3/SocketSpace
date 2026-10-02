/**
 * Reading the signed-in person in pages, layouts, server actions and route handlers.
 */
import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { SESSION_ABSOLUTE_MS } from './auth';
import { getAuth } from './auth-instance';

export type CurrentSession = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
>;

/**
 * The current session, or `null`. Sessions older than 30 days are ended here even if they were
 * used recently (Better Auth's own expiry is the 7-day idle timeout).
 * Cached per request, so several components can call it for one database read.
 */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const auth = getAuth();
  const requestHeaders = await headers();
  const current = await auth.api.getSession({ headers: requestHeaders });
  if (!current) return null;
  if (Date.now() - current.session.createdAt.getTime() > SESSION_ABSOLUTE_MS) {
    await auth.api.revokeSession({
      headers: requestHeaders,
      body: { token: current.session.token },
    });
    return null;
  }
  return current;
});

/** Paths a signed-in person may be sent back to after signing in (no open redirects). */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return '/app';
  return value;
}

/**
 * For pages inside the app: a full (non-guest) account that has finished onboarding.
 * Everyone else is redirected: to sign in, or to onboarding (D-023: no skipping).
 */
export async function requireAppUser(currentPath: string): Promise<CurrentSession> {
  const current = await getCurrentSession();
  if (!current) redirect(`/sign-in?next=${encodeURIComponent(currentPath)}`);
  if (current.user.isAnonymous) redirect('/sign-in?guest=1');
  if (!current.user.onboardedAt) redirect('/onboarding');
  return current;
}

/** For onboarding itself: signed in, not a guest, not yet onboarded. */
export async function requireOnboardingUser(): Promise<CurrentSession> {
  const current = await getCurrentSession();
  if (!current) redirect('/sign-in?next=%2Fonboarding');
  if (current.user.isAnonymous) redirect('/sign-in?guest=1');
  if (current.user.onboardedAt) redirect('/app');
  return current;
}
