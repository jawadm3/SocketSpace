'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { filterAvailableNicknames, setShowPresence, updateProfile } from '@socketspace/db';
import { nicknameSchema, suggestNicknames } from '@socketspace/shared/profile';

import { formText } from '@/lib/forms';
import { getDb } from '@/server/db';
import { getNotifier } from '@/server/notifier';
import { parseAvatarField, parseBio, parseNameChoices } from '@/server/profile-form';
import { getCurrentSession } from '@/server/session';

export interface ProfileState {
  message?: string;
  errors?: { nickname?: string; realName?: string; bio?: string; avatar?: string; form?: string };
  suggestions?: string[];
}

/** Saves profile settings (PROF-01); a new nickname or picture reaches other people at once. */
export async function updateProfileAction(
  _previous: ProfileState,
  form: FormData,
): Promise<ProfileState> {
  const current = await getCurrentSession();
  if (!current || current.user.isAnonymous) redirect('/sign-in');
  if (!current.user.onboardedAt) redirect('/onboarding');

  const nickname = nicknameSchema.safeParse(formText(form, 'nickname'));
  const names = parseNameChoices(form);
  const bio = parseBio(form);
  const avatar = parseAvatarField(form);
  const errors: NonNullable<ProfileState['errors']> = {};
  if (!nickname.success)
    errors.nickname = nickname.error.issues[0]?.message ?? 'Check your nickname';
  if (!names.ok) errors.realName = names.error;
  if (!bio.ok) errors.bio = bio.error;
  if (!avatar) errors.avatar = 'That picture could not be saved. Choose another.';
  if (!nickname.success || !names.ok || !bio.ok || !avatar) return { errors };

  const db = getDb();
  const result = await updateProfile(db, current.user.id, {
    nickname: nickname.data,
    ...names.names,
    bio: bio.bio,
    avatar: { kind: avatar.kind, config: avatar.config },
  });
  if (!result.ok) {
    if (result.reason === 'nickname_taken') {
      const suggestions = (
        await filterAvailableNicknames(db, suggestNicknames(nickname.data, 6))
      ).slice(0, 3);
      return {
        errors: { nickname: 'That nickname is taken. Try one of the suggestions, or another.' },
        suggestions,
      };
    }
    return { errors: { form: 'Your profile could not be saved. Please sign in again.' } };
  }
  if (result.publicChanged) {
    await getNotifier().notify({ type: 'user.updated', userId: current.user.id });
  }
  revalidatePath('/app', 'layout');
  return { message: 'Saved.' };
}

export interface PresenceVisibilityState {
  message?: string;
  error?: string;
}

/**
 * Invisible mode (PROF-02): with "Show when I'm online" off, everyone sees this person as offline.
 * The realtime server learns it at once through `user.updated` and tells their contacts.
 */
export async function setPresenceVisibilityAction(
  _previous: PresenceVisibilityState,
  form: FormData,
): Promise<PresenceVisibilityState> {
  const current = await getCurrentSession();
  if (!current || current.user.isAnonymous) redirect('/sign-in');
  if (!current.user.onboardedAt) redirect('/onboarding');

  const show = form.get('showPresence') === 'on';
  try {
    await setShowPresence(getDb(), current.user.id, show);
  } catch {
    return { error: 'That could not be saved. Please try again.' };
  }
  await getNotifier().notify({ type: 'user.updated', userId: current.user.id });
  revalidatePath('/app/settings/profile');
  return { message: show ? 'People can see when you are online.' : 'You now appear offline.' };
}
