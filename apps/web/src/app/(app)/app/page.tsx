import type { Metadata } from 'next';
import Link from 'next/link';

import { avatarConfigSchema } from '@socketspace/shared/profile';

import { Card, buttonClasses } from '@/components/ui';
import { renderAvatar } from '@/server/avatar';
import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';
import { getOwnProfile } from '@socketspace/db';

import { LiveStatus } from '../live-status';
import { SignOutButton } from '../sign-out-button';
import { VerifyEmailBanner } from '../verify-email-banner';

export const metadata: Metadata = { title: 'Your space' };

export default async function AppHome() {
  const { user } = await requireAppUser('/app');
  const profile = await getOwnProfile(getDb(), user.id);
  const config = avatarConfigSchema.safeParse(profile?.avatarConfig);
  const avatar = config.success ? renderAvatar(config.data, 64) : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      {!user.emailVerified ? <VerifyEmailBanner email={user.email} /> : null}
      <Card>
        <div className="flex items-center gap-4">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- generated SVG data URI
            <img src={avatar} alt="" width={64} height={64} className="rounded-2xl bg-surface-2" />
          ) : null}
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Hello, {user.nickname}</h1>
            <p className="text-sm text-muted">Signed in as {user.email}</p>
          </div>
        </div>
        <div className="mt-6">
          <LiveStatus />
        </div>
        <p className="mt-4 text-sm text-ink-2">
          Rooms, direct messages and live chat arrive in the next stage of the build. Your account,
          profile and sign-in are ready.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/settings/sessions" className={buttonClasses('secondary')}>
            Devices and sessions
          </Link>
          <SignOutButton />
        </div>
      </Card>
    </main>
  );
}
