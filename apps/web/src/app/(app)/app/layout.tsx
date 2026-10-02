/**
 * The signed-in app shell: one live connection (ChatProvider) shared by every /app page, the
 * sidebar with your rooms and their unread counts, and moderator notices.
 */
import type { ReactNode } from 'react';

import { getPublicUsers, listUserRooms, unreadCounts } from '@socketspace/db';

import { ChatProvider } from '@/lib/chat/provider';
import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';

import { ConnectionBanner, MobileBar, Notices, Sidebar } from './shell';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireAppUser('/app');
  const db = getDb();
  const [rooms, [me], unread] = await Promise.all([
    listUserRooms(db, user.id),
    getPublicUsers(db, user.id, [user.id], 'profile'),
    unreadCounts(db, user.id),
  ]);
  const self = me ?? { id: user.id, nickname: user.nickname ?? 'you', avatar: null };

  return (
    <ChatProvider
      me={self}
      rooms={rooms.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        visibility: r.visibility,
        lastEventSeq: r.lastEventSeq,
      }))}
      unread={Object.fromEntries(unread)}
    >
      <div className="flex h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileBar />
          <ConnectionBanner />
          <Notices />
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    </ChatProvider>
  );
}
