'use server';

/**
 * Server actions for random chat (RAND-02, RAND-09, RAND-11).
 *
 * - The 18+ gate: records on the account that the person confirmed they are an adult and accepted
 *   the current rules. The realtime server reads that record on every `random:join`.
 * - A suggested room was opened from the end screen: one aggregate counter goes up (no user ID is
 *   stored), then the room opens.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { acceptRandomGate, bumpMetric } from '@socketspace/db';
import { RANDOM_RULES_VERSION } from '@socketspace/shared/random';

import { formText } from '@/lib/forms';
import { getDb } from '@/server/db';
import { getWebEnv } from '@/server/env';
import { getCurrentSession } from '@/server/session';

export interface GateState {
  error?: string;
  accepted?: boolean;
}

export async function acceptRandomRulesAction(
  _previous: GateState,
  form: FormData,
): Promise<GateState> {
  if (!getWebEnv().RANDOM_MODE_ENABLED) return { error: 'Random chat is switched off.' };
  const current = await getCurrentSession();
  // Guests have a session too (an anonymous one), started just before this is called.
  if (!current) return { error: 'Your session has ended. Please reload the page and try again.' };
  if (form.get('adult') !== 'on' || form.get('rules') !== 'on') {
    return { error: 'Please tick both boxes to continue.' };
  }
  // The page shows the rules of one version; accepting an older page must not count.
  if (formText(form, 'version') !== RANDOM_RULES_VERSION) {
    return { error: 'The rules have changed. Please reload the page and read them again.' };
  }
  const accepted = await acceptRandomGate(getDb(), current.user.id, RANDOM_RULES_VERSION);
  if (!accepted) return { error: 'This account cannot use random chat.' };
  revalidatePath('/random');
  revalidatePath('/app/random');
  return { accepted: true };
}

/** A room suggested at the end of a random chat was opened (the way into the community). */
export async function openSuggestedRoomAction(form: FormData): Promise<void> {
  const current = await getCurrentSession();
  if (!current || current.user.isAnonymous) redirect('/sign-up');
  const slug = formText(form, 'slug');
  if (!/^[a-z0-9-]{3,32}$/.test(slug)) redirect('/app/explore');
  await bumpMetric(getDb(), 'random_room_cta_clicked');
  redirect(`/app/r/${slug}?from=random`);
}
