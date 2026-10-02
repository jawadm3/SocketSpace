'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { uuid } from '@socketspace/shared/primitives';

import { getAuth } from '@/server/auth-instance';
import { getNotifier } from '@/server/notifier';
import { getCurrentSession } from '@/server/session';

/**
 * Signs out one session (AUTH-06). The browser sends only the session ID; the token is looked up
 * here, from this person's own sessions, so session tokens never reach the page.
 * Live sockets of that session are disconnected through an internal event.
 */
export async function revokeSessionAction(form: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect('/sign-in');
  const id = uuid.safeParse(form.get('sessionId'));
  if (!id.success) return;

  const requestHeaders = await headers();
  const auth = getAuth();
  const sessions = await auth.api.listSessions({ headers: requestHeaders });
  const target = sessions.find((s) => s.id === id.data);
  if (!target) return;

  await auth.api.revokeSession({ headers: requestHeaders, body: { token: target.token } });
  await getNotifier().notify({
    type: 'session.revoked',
    userId: current.user.id,
    sessionIds: [target.id],
  });

  if (target.id === current.session.id) redirect('/sign-in');
  revalidatePath('/settings/sessions');
}

/** Signs out every other session, keeping this one. */
export async function revokeOtherSessionsAction(): Promise<void> {
  const current = await getCurrentSession();
  if (!current) redirect('/sign-in');
  const requestHeaders = await headers();
  const auth = getAuth();
  const others = (await auth.api.listSessions({ headers: requestHeaders })).filter(
    (s) => s.id !== current.session.id,
  );
  if (others.length === 0) return;
  await auth.api.revokeOtherSessions({ headers: requestHeaders });
  await getNotifier().notify({
    type: 'session.revoked',
    userId: current.user.id,
    sessionIds: others.slice(0, 100).map((s) => s.id),
  });
  revalidatePath('/settings/sessions');
}
