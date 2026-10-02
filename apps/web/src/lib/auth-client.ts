/**
 * Better Auth's browser client. It talks to /api/auth on the same site, so no server address is
 * compiled into the browser bundle.
 */
import { passkeyClient } from '@better-auth/passkey/client';
import { anonymousClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  plugins: [passkeyClient(), anonymousClient()],
});

/** Turns a Better Auth error into a sentence for the page. */
export function authErrorMessage(
  error: { message?: string; status?: number } | null | undefined,
): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.status === 429 && !error.message?.includes('Try again')) {
    return 'Too many attempts. Please wait a few seconds and try again.';
  }
  return error.message ?? 'Something went wrong. Please try again.';
}
