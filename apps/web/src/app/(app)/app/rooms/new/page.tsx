import type { Metadata } from 'next';

import { Card } from '@/components/ui';
import { requireAppUser } from '@/server/session';

import { VerifyEmailBanner } from '../../../verify-email-banner';
import { CreateRoomForm } from './create-room-form';

export const metadata: Metadata = { title: 'New room' };

export default async function NewRoomPage() {
  const { user } = await requireAppUser('/app/rooms/new');
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8">
      {!user.emailVerified ? <VerifyEmailBanner email={user.email} /> : null}
      <Card>
        <h1 className="text-2xl font-extrabold tracking-tight">Create a room</h1>
        <p className="mt-1 mb-6 text-sm text-ink-2">
          You will be its owner: you can rename it, invite people and choose moderators.
        </p>
        <CreateRoomForm />
      </Card>
    </main>
  );
}
