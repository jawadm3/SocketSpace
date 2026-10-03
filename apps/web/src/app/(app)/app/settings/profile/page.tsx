import type { Metadata } from 'next';
import Link from 'next/link';

import {
  getPrivacySettings,
  getProfileSettings,
  getPublicUsers,
  listBlocked,
} from '@socketspace/db';
import { avatarConfigSchema, photoAvatarSchema } from '@socketspace/shared/profile';

import { Card } from '@/components/ui';
import { avatarBuilder, presetGallery } from '@/server/avatar';
import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';

import { PresenceForm } from './presence-form';
import { BlockedList, PrivacyForm } from './privacy-form';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = { title: 'Profile settings' };

/**
 * Settings > Profile (PROF-01, PROF-02, DM-01, DM-02, SAFE-01): nickname, real name and who sees
 * it, bio, picture, whether others see when you are online, who may message you, read receipts,
 * and the people you blocked.
 */
export default async function ProfileSettingsPage() {
  const { user } = await requireAppUser('/app/settings/profile');
  const db = getDb();
  const [profile, privacy, blockedIds] = await Promise.all([
    getProfileSettings(db, user.id),
    getPrivacySettings(db, user.id),
    listBlocked(db, user.id),
  ]);
  const blocked = await getPublicUsers(db, user.id, blockedIds);
  const config = avatarConfigSchema.safeParse(profile?.avatarConfig);
  const photo = photoAvatarSchema.safeParse(profile?.avatarConfig);
  const avatar =
    profile?.avatarKind === 'photo' && photo.success
      ? { kind: 'photo' as const, attachmentId: photo.data.attachmentId }
      : config.success && (profile?.avatarKind === 'preset' || profile?.avatarKind === 'custom')
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
          ,{' '}
          <Link href="/app/settings/standing" className="font-semibold text-accent underline">
            account standing
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
          canUpload={user.emailVerified}
          presets={presetGallery(4).map((p) => ({ config: p.config, src: p.dataUri }))}
          builder={avatarBuilder()}
        />
      </Card>
      <Card>
        <PresenceForm showPresence={profile?.showPresence ?? true} />
      </Card>
      <Card>
        <PrivacyForm
          dmPolicy={privacy?.dmPolicy ?? 'everyone'}
          readReceipts={privacy?.readReceipts ?? true}
        />
      </Card>
      <Card>
        <BlockedList people={blocked} />
      </Card>
    </main>
  );
}
