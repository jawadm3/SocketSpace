/**
 * A room in a list (home, explore): name, topic, size, and "Open" for members or "Join" for
 * everyone else.
 */
import { Hash, Lock, Users } from 'lucide-react';
import Link from 'next/link';

import type { RoomSummary } from '@socketspace/db';

import { buttonClasses } from '@/components/ui';

import { joinRoomAction } from './room-actions';

export function RoomCard({ room, isMember }: { room: RoomSummary; isMember: boolean }) {
  const href = `/app/r/${room.slug}`;
  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-card p-4">
      <div className="flex items-start gap-2">
        {room.visibility === 'private' ? (
          <Lock aria-label="Private room" className="mt-1 h-4 w-4 shrink-0 text-muted" />
        ) : (
          <Hash aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold">
            <Link href={href} className="hover:underline">
              {room.name}
            </Link>
          </h3>
          <p className="line-clamp-2 text-sm text-ink-2">{room.topic || 'No topic yet.'}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Users aria-hidden="true" className="h-4 w-4" />
          {room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}
        </span>
        {isMember ? (
          <Link href={href} className={buttonClasses('secondary', 'min-h-9 px-3')}>
            Open<span className="sr-only"> {room.name}</span>
          </Link>
        ) : (
          <form action={joinRoomAction}>
            <input type="hidden" name="conversationId" value={room.id} />
            <button type="submit" className={buttonClasses('primary', 'min-h-9 px-3')}>
              Join<span className="sr-only"> {room.name}</span>
            </button>
          </form>
        )}
      </div>
    </li>
  );
}
