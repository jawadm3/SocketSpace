import type { Metadata } from 'next';

import { Card } from '@/components/ui';
import { presetGallery } from '@/server/avatar';
import { requireOnboardingUser } from '@/server/session';

import { OnboardingForm } from './onboarding-form';

export const metadata: Metadata = { title: 'Set up your profile' };

export default async function OnboardingPage() {
  const current = await requireOnboardingUser();
  const presets = presetGallery(4);

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="airmail-stripe h-2 w-full" aria-hidden="true" />
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <Card>
          <h1 className="text-2xl font-extrabold tracking-tight">Set up your profile</h1>
          <p className="mt-1 text-sm text-muted">
            Pick the nickname people will see in chats and use to @mention you, and a profile
            picture. You can change both later.
          </p>
          {!current.user.emailVerified ? (
            <p className="mt-3 text-sm text-muted">
              We have also emailed you a link to confirm your address; you can post once it is
              confirmed.
            </p>
          ) : null}
          <OnboardingForm presets={presets} />
        </Card>
      </main>
    </div>
  );
}
