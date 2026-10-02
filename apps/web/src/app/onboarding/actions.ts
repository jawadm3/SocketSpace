'use server';

import { redirect } from 'next/navigation';

import { completeOnboarding, filterAvailableNicknames } from '@socketspace/db';
import { avatarConfigSchema, nicknameSchema, suggestNicknames } from '@socketspace/shared/profile';

import { formText } from '@/lib/forms';
import { isGalleryStyle } from '@/server/avatar';
import { getDb } from '@/server/db';
import { getCurrentSession } from '@/server/session';

export interface OnboardingState {
  nickname?: string;
  errors?: { nickname?: string; avatar?: string; form?: string };
  suggestions?: string[];
}

function parseAvatar(raw: FormDataEntryValue | null) {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try {
    const parsed = avatarConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success && isGalleryStyle(parsed.data.style) ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Saves the nickname and avatar (both required, D-023 and D-024), then opens the app. */
export async function completeOnboardingAction(
  _previous: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  const current = await getCurrentSession();
  if (!current || current.user.isAnonymous) redirect('/sign-in');

  const rawNickname = formText(form, 'nickname');
  const nickname = nicknameSchema.safeParse(rawNickname);
  const avatar = parseAvatar(form.get('avatar'));

  const errors: OnboardingState['errors'] = {};
  if (!nickname.success)
    errors.nickname = nickname.error.issues[0]?.message ?? 'Choose another nickname';
  if (!avatar) errors.avatar = 'Choose a profile picture to continue';
  if (!nickname.success || !avatar) return { nickname: rawNickname, errors };

  const db = getDb();
  const result = await completeOnboarding(db, current.user.id, {
    nickname: nickname.data,
    avatarKind: 'preset',
    avatarConfig: avatar,
  });

  if (!result.ok && result.reason === 'nickname_taken') {
    const suggestions = (
      await filterAvailableNicknames(db, suggestNicknames(nickname.data, 6))
    ).slice(0, 3);
    return {
      nickname: rawNickname,
      errors: { nickname: 'That nickname is taken. Try one of the suggestions, or another.' },
      suggestions,
    };
  }
  if (!result.ok)
    return {
      nickname: rawNickname,
      errors: { form: 'Your account could not be found. Please sign in again.' },
    };

  redirect('/app');
}
