import type { Metadata } from 'next';
import Link from 'next/link';

import { getProfileSettings } from '@socketspace/db';
import { avatarConfigSchema } from '@socketspace/shared/profile';

import { Card } from '@/components/ui';
import { avatarBuilder, presetGallery } from '@/server/avatar';
import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';

import { PresenceForm } from './presence-form';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = { title: 'Profile settings' };

/**
 * Settings > Profile (PROF-01, PROF-02): nickname, real name and who sees it, bio, picture, and
 * whether others see when you are online.
 */
export default async function ProfileSettingsPage() {
  const { user } = await requireAppUser('/app/settings/profile');
  const profile = await getProfileSettings(getDb(), user.id);
  const config = avatarConfigSchema.safeParse(profile?.avatarConfig);
  const avatar =
    config.success && (profile?.avatarKind === 'preset' || profile?.avatarKind === 'custom')
      ? { kind: profile.avatarKind, config: config.data }
      : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Profile settings</h1>
        <p className="mt-1 text-sm text-ink-2">
          Also in settings:{' '}
          <Link href="/settings/sessions" className="font-semibold text-accent underline">
            devices and sessions
          </Link>
          .
        </p>
      </header>
      <Card>
        <ProfileForm
          nickname={profile?.nickname ?? ''}
          names={{
            realName: profile?.realName ?? '',
            realNameVisibility: profile?.realNameVisibility ?? 'nobody',
            nameDisplay: profile?.nameDisplay ?? 'nickname',
          }}
          bio={profile?.bio ?? ''}
          avatar={avatar}
          presets={presetGallery(4).map((p) => ({ config: p.config, src: p.dataUri }))}
          builder={avatarBuilder()}
        />
      </Card>
      <Card>
        <PresenceForm showPresence={profile?.showPresence ?? true} />
      </Card>
    </main>
  );
}
