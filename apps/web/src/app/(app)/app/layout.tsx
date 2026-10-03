/**
 * The signed-in app shell: one live connection (ChatProvider) shared by every /app page, the
 * sidebar with your rooms and their unread counts, and moderator notices.
 */
import type { ReactNode } from 'react';

import {
  countUnreadNotifications,
  getPublicUsers,
  listBlocked,
  listUserDms,
  listUserRooms,
  unreadCounts,
} from '@socketspace/db';

import { ChatProvider } from '@/lib/chat/provider';
import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';

import { ConnectionBanner, MobileBar, Notices, Sidebar } from './shell';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireAppUser('/app');
  const db = getDb();
  const [rooms, dms, [me], unread, blocked, notificationsUnread] = await Promise.all([
    listUserRooms(db, user.id),
    listUserDms(db, user.id),
    getPublicUsers(db, user.id, [user.id], 'profile'),
    unreadCounts(db, user.id),
    listBlocked(db, user.id),
    countUnreadNotifications(db, user.id),
  ]);
  const self = me ?? { id: user.id, nickname: user.nickname ?? 'you', avatar: null };
  // DM partners, as this viewer may see them, so the sidebar shows names at once.
  const partners = await getPublicUsers(db, user.id, [...new Set(dms.map((d) => d.otherUserId))]);

  return (
    <ChatProvider
      me={self}
      people={partners}
      rooms={rooms.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        visibility: r.visibility,
        lastEventSeq: r.lastEventSeq,
      }))}
      dms={dms.map((d) => ({
        id: d.id,
        otherUserId: d.otherUserId,
        lastEventSeq: d.lastEventSeq,
      }))}
      unread={Object.fromEntries(unread)}
      blocked={blocked}
      notificationsUnread={notificationsUnread}
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
