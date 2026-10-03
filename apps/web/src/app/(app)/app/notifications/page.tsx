import { AtSign, CornerUpLeft, MessageSquare } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { actorIds, getPublicUsers, listNotifications } from '@socketspace/db';
import { plainText } from '@socketspace/shared/markdown';

import { UserAvatar } from '@/components/user-avatar';
import { describeNotification } from '@/lib/chat/notifications';
import { getDb } from '@/server/db';
import { requireAppUser } from '@/server/session';

import { LocalTime } from '../r/[slug]/message-item';
import { BrowserNotificationsToggle, MarkSeen } from './client';

export const metadata: Metadata = { title: 'Notifications' };

const ICONS = {
  mention: AtSign,
  reply: CornerUpLeft,
  dm: MessageSquare,
} as const;

/** Mentions, replies and direct messages (NOTIF-01), newest first; opening the page marks them seen. */
export default async function NotificationsPage() {
  const { user } = await requireAppUser('/app/notifications');
  const db = getDb();
  const items = await listNotifications(db, user.id, 50);
  const people = new Map(
    (await getPublicUsers(db, user.id, actorIds(items))).map((p) => [p.id, p]),
  );
  const unread = items.filter((i) => i.readAt === null).length;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Notifications</h1>
      <BrowserNotificationsToggle />
      <MarkSeen unread={unread} />
      {items.length === 0 ? (
        <p className="text-ink-2">
          Nothing yet. Mentions, replies and direct messages show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Notifications">
          {items.map((item) => {
            const actor = item.actorId ? people.get(item.actorId) : undefined;
            const place =
              item.conversationKind === 'room' && item.roomName ? `#${item.roomName}` : null;
            const base =
              item.conversationKind === 'room' && item.roomSlug
                ? `/app/r/${item.roomSlug}`
                : item.conversationId
                  ? `/app/dm/${item.conversationId}`
                  : '/app';
            const href = item.messageId ? `${base}?m=${item.messageId}` : base;
            const Icon = item.type in ICONS ? ICONS[item.type as keyof typeof ICONS] : AtSign;
            const text = item.messageBody === null ? null : plainText(item.messageBody);
            return (
              <li key={item.id}>
                <Link
                  href={href}
                  className={`flex gap-3 rounded-xl border p-3 hover:bg-surface-2 ${
                    item.readAt === null ? 'border-accent bg-accent-soft' : 'border-line bg-card'
                  }`}
                >
                  <UserAvatar user={actor} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-semibold text-ink">
                      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                      {describeNotification(item.type, actor?.nickname ?? null, place)}
                      {item.readAt === null ? <span className="sr-only">(new)</span> : null}
                    </span>
                    <span className="block truncate text-sm text-ink-2">
                      {text === null ? 'This message was deleted.' : text.slice(0, 160)}
                    </span>
                    <span className="text-xs text-muted">
                      <LocalTime iso={item.createdAt.toISOString()} withDate />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
