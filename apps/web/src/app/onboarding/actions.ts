'use server';

import { redirect } from 'next/navigation';

import { completeOnboarding, filterAvailableNicknames } from '@socketspace/db';
import { nicknameSchema, suggestNicknames } from '@socketspace/shared/profile';

import { formText } from '@/lib/forms';
import { getDb } from '@/server/db';
import { parseAvatarField, parseNameChoices } from '@/server/profile-form';
import { getCurrentSession } from '@/server/session';

export interface OnboardingState {
  values?: {
    nickname: string;
    realName: string;
    realNameVisibility: 'nobody' | 'contacts' | 'everyone';
    nameDisplay: 'nickname' | 'real_name' | 'both';
  };
  errors?: { nickname?: string; realName?: string; avatar?: string; form?: string };
  suggestions?: string[];
}

/**
 * Saves the nickname, the real-name choices and the picture, then opens the app. A nickname and
 * a picture are required (D-023, D-024); the real name is optional and private by default.
 */
export async function completeOnboardingAction(
  _previous: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  const current = await getCurrentSession();
  if (!current || current.user.isAnonymous) redirect('/sign-in');

  const rawNickname = formText(form, 'nickname');
  const nickname = nicknameSchema.safeParse(rawNickname);
  const names = parseNameChoices(form);
  const avatar = parseAvatarField(form);
  const values: NonNullable<OnboardingState['values']> = {
    nickname: rawNickname,
    realName: formText(form, 'realName'),
    realNameVisibility: names.ok ? names.names.realNameVisibility : 'nobody',
    nameDisplay: names.ok ? names.names.nameDisplay : 'nickname',
  };

  const errors: NonNullable<OnboardingState['errors']> = {};
  if (!nickname.success) {
    errors.nickname = nickname.error.issues[0]?.message ?? 'Choose another nickname';
  }
  if (!names.ok) errors.realName = names.error;
  if (!avatar) errors.avatar = 'Choose a profile picture to continue';
  if (!nickname.success || !names.ok || !avatar) return { values, errors };

  const db = getDb();
  const result = await completeOnboarding(db, current.user.id, {
    nickname: nickname.data,
    avatarKind: avatar.kind,
    avatarConfig: avatar.config,
    names: names.names,
  });

  if (!result.ok && result.reason === 'nickname_taken') {
    const suggestions = (
      await filterAvailableNicknames(db, suggestNicknames(nickname.data, 6))
    ).slice(0, 3);
    return {
      values,
      errors: { nickname: 'That nickname is taken. Try one of the suggestions, or another.' },
      suggestions,
    };
  }
  if (!result.ok && result.reason === 'avatar_invalid') {
    return { values, errors: { avatar: 'That photo could not be used. Please upload it again.' } };
  }
  if (!result.ok) {
    return { values, errors: { form: 'Your account could not be found. Please sign in again.' } };
  }
  redirect('/app');
}
