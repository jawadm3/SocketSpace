'use server';

/**
 * Server actions for direct messages, blocks, privacy settings and notifications (Stage D4:
 * DM-01, DM-02, SAFE-01, NOTIF-01). The database decides; on success the realtime server is told,
 * so the other person's open tabs update at once.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  blockUser,
  markAllNotificationsRead,
  setPrivacySettings,
  startDm,
  unblockUser,
} from '@socketspace/db';
import { DM_POLICIES, type DmPolicy } from '@socketspace/shared/domain';
import { uuid } from '@socketspace/shared/primitives';

import { formText } from '@/lib/forms';
import { getDb } from '@/server/db';
import { getNotifier } from '@/server/notifier';
import { getCurrentSession } from '@/server/session';

export interface SocialActionState {
  message?: string;
  error?: string;
}

async function actorId(): Promise<string> {
  const current = await getCurrentSession();
  if (!current) redirect('/sign-in');
  if (current.user.isAnonymous) redirect('/sign-in?guest=1');
  if (!current.user.onboardedAt) redirect('/onboarding');
  return current.user.id;
}

function personId(form: FormData): string | null {
  const parsed = uuid.safeParse(formText(form, 'userId'));
  return parsed.success ? parsed.data : null;
}

const START_REFUSED: Record<string, string> = {
  not_allowed_to_start: 'Confirm your email address to send direct messages.',
  self: 'That is you.',
  not_found: 'That person cannot be found.',
  // The same words for a block in either direction, so a block is never revealed.
  blocked: 'You cannot message this person.',
  policy: 'This person is not accepting new direct messages.',
};

/** Opens the DM with someone, creating it if needed (DM-01). */
export async function startDmAction(
  _previous: SocialActionState,
  form: FormData,
): Promise<SocialActionState> {
  const me = await actorId();
  const other = personId(form);
  if (!other) return { error: 'That person cannot be found.' };
  const result = await startDm(getDb(), me, other);
  if (!result.ok) return { error: START_REFUSED[result.reason] ?? 'That did not work.' };
  if (result.created) {
    // Both people's open tabs join the conversation and list it.
    for (const userId of [me, other]) {
      await getNotifier().notify({
        type: 'member.added',
        conversationId: result.conversationId,
        userId,
        role: 'member',
      });
    }
    revalidatePath('/app', 'layout');
  }
  redirect(`/app/dm/${result.conversationId}`);
}

/** Blocks someone (SAFE-01): no DMs either way, no notifications from them, messages folded. */
export async function blockUserAction(
  _previous: SocialActionState,
  form: FormData,
): Promise<SocialActionState> {
  const me = await actorId();
  const other = personId(form);
  if (!other) return { error: 'That person cannot be found.' };
  const result = await blockUser(getDb(), me, other);
  if (!result.ok) return { error: 'That person cannot be blocked.' };
  await getNotifier().notify({ type: 'block.created', blockerId: me, blockedId: other });
  revalidatePath('/app', 'layout');
  return { message: 'Blocked.' };
}

export async function unblockUserAction(
  _previous: SocialActionState,
  form: FormData,
): Promise<SocialActionState> {
  const me = await actorId();
  const other = personId(form);
  if (!other) return { error: 'That person cannot be found.' };
  await unblockUser(getDb(), me, other);
  revalidatePath('/app', 'layout');
  return { message: 'Unblocked.' };
}

/** Who may start a DM with me, and whether I share read receipts (DM-02). */
export async function savePrivacyAction(
  _previous: SocialActionState,
  form: FormData,
): Promise<SocialActionState> {
  const me = await actorId();
  const policy = formText(form, 'dmPolicy');
  if (!(DM_POLICIES as readonly string[]).includes(policy)) {
    return { error: 'Choose who may message you.' };
  }
  await setPrivacySettings(getDb(), me, {
    dmPolicy: policy as DmPolicy,
    readReceipts: form.get('readReceipts') === 'on',
  });
  revalidatePath('/app', 'layout');
  return { message: 'Saved.' };
}

/** The notifications page was opened: everything there counts as seen. */
export async function markNotificationsReadAction(): Promise<void> {
  const me = await actorId();
  await markAllNotificationsRead(getDb(), me);
  revalidatePath('/app', 'layout');
}
