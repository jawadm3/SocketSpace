'use client';

/**
 * A room: header, live messages, who is typing, the composer and the member list with presence
 * (ROOM-02, MSG-01 to MSG-07, RT-03 to RT-05).
 *
 * History arrives with the page; everything after that arrives live through the shared
 * connection (ChatProvider). Sending is optimistic: a message shows at once as "Sending",
 * becomes a normal message when the server confirms it, or shows the reason it was refused with
 * "Try again" and "Delete". While the room is on screen, it counts as read.
 */
import { Hash, Lock, Settings, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useCallback, useEffect, useRef, useState } from 'react';

import type { MessageWire } from '@socketspace/shared/events';
import { LIMITS } from '@socketspace/shared/limits';
import type { PublicUser } from '@socketspace/shared/profile';

import { Alert, Button, buttonClasses } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { useChat } from '@/lib/chat/provider';
import { describeTyping, typingUserIds, type PresenceStatus } from '@/lib/chat/state';

import { joinRoomAction, leaveRoomAction, type RoomActionState } from '../../room-actions';
import { Composer } from './composer';
import {
  displayName,
  isRemoved,
  LocalTime,
  useMinute,
  type MessagePermissions,
} from './message-item';
import { MessageList } from './message-list';

type Role = 'owner' | 'moderator' | 'member';
const RANK: Record<Role, number> = { member: 1, moderator: 2, owner: 3 };

export interface RoomInfo {
  id: string;
  slug: string;
  name: string;
  topic: string;
  visibility: 'public' | 'private';
  memberCount: number;
  lastEventSeq: number;
}

interface MemberEntry {
  userId: string;
  role: Role;
  joinedAt: string;
}

/** "Ava is typing…" under the messages; the line keeps its height so nothing jumps. */
function TypingLine({ conversationId }: { conversationId: string }) {
  const { state } = useChat();
  const names = typingUserIds(state, conversationId).map(
    (id) => state.users[id]?.nickname ?? 'Someone',
  );
  return (
    <p className="h-6 truncate px-4 text-xs leading-6 text-ink-2" data-testid="typing">
      {describeTyping(names)}
    </p>
  );
}

function CannotPost({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-line bg-card p-4 text-sm text-ink-2">{children}</div>;
}

const PRESENCE_TEXT: Record<PresenceStatus, string> = {
  online: 'online',
  away: 'away',
  dnd: 'do not disturb',
  offline: 'offline',
};
const PRESENCE_DOT: Record<PresenceStatus, string> = {
  online: 'bg-emerald-500 border-emerald-500',
  away: 'bg-amber-400 border-amber-400',
  dnd: 'bg-danger border-danger',
  offline: 'bg-card border-muted',
};

function lastSeenText(iso: string | null, minute: number): string {
  if (!iso || minute === 0) return '';
  const minutes = Math.max(0, minute - Math.floor(Date.parse(iso) / 60_000));
  if (minutes < 1) return 'last seen just now';
  if (minutes < 60) return `last seen ${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `last seen ${String(hours)} h ago`;
  return `last seen ${new Date(iso).toLocaleDateString()}`;
}

function PresenceDot({ status, lastSeen }: { status: PresenceStatus; lastSeen: string }) {
  const text = lastSeen ? `${PRESENCE_TEXT[status]}, ${lastSeen}` : PRESENCE_TEXT[status];
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      data-presence={status}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 ${PRESENCE_DOT[status]}`}
    />
  );
}

const ROLE_ORDER: Role[] = ['owner', 'moderator', 'member'];
const ROLE_TITLE: Record<Role, string> = {
  owner: 'Owner',
  moderator: 'Moderators',
  member: 'Members',
};

function MemberList({ room, members }: { room: RoomInfo; members: MemberEntry[] }) {
  const { state, me } = useChat();
  const minute = useMinute();
  const statusOf = (userId: string): PresenceStatus => {
    // Your own dot follows your connection (the server does not echo you to yourself).
    if (userId === me.id) return state.status === 'connected' ? 'online' : 'offline';
    return state.presence[userId]?.status ?? 'offline';
  };
  return (
    <div className="flex flex-col gap-4">
      {ROLE_ORDER.map((role) => {
        const group = members.filter((m) => m.role === role);
        if (group.length === 0) return null;
        return (
          <section key={role} aria-label={`${ROLE_TITLE[role]} of ${room.name}`}>
            <h3 className="px-1 pb-1 text-xs font-bold tracking-wider text-muted uppercase">
              {ROLE_TITLE[role]} ({group.length})
            </h3>
            <ul className="flex flex-col gap-1">
              {group.map((member) => {
                const person = state.users[member.userId];
                const status = statusOf(member.userId);
                const lastSeen =
                  status === 'offline' && member.userId !== me.id
                    ? lastSeenText(state.presence[member.userId]?.lastSeenAt ?? null, minute)
                    : '';
                return (
                  <li
                    key={member.userId}
                    className={`flex items-center gap-2 px-1 py-0.5 ${
                      status === 'offline' ? 'opacity-70' : ''
                    }`}
                  >
                    <span className="relative">
                      <UserAvatar user={person} size="sm" />
                      <span className="absolute -right-0.5 -bottom-0.5 flex rounded-full bg-card p-px">
                        <PresenceDot status={status} lastSeen={lastSeen} />
                      </span>
                    </span>
                    <span className="truncate text-sm">{displayName(person)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function LeaveButton({ room }: { room: RoomInfo }) {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(leaveRoomAction, {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="conversationId" value={room.id} />
      <button
        type="submit"
        disabled={pending}
        className={buttonClasses('ghost', 'min-h-9 px-3 text-ink-2')}
      >
        {pending ? 'Leaving…' : 'Leave'}
      </button>
      {state.error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function RoomView({
  room,
  membership,
  emailVerified,
  initialMessages,
  initialMembers,
  people,
  hasOlder: initialHasOlder,
}: {
  room: RoomInfo;
  membership: { role: Role; mutedUntil: string | null } | null;
  emailVerified: boolean;
  initialMessages: MessageWire[];
  initialMembers: MemberEntry[];
  people: PublicUser[];
  /** Older messages exist than the page brought. */
  hasOlder: boolean;
}) {
  const {
    state,
    me,
    loadConversation,
    loadOlderMessages,
    rememberUsers,
    onMemberEvent,
    setOpenConversation,
  } = useChat();
  const router = useRouter();
  // Live member events adjust the list; a fresh server render replaces it.
  const [members, setMembers] = useState(initialMembers);
  const [membersSource, setMembersSource] = useState(initialMembers);
  if (membersSource !== initialMembers) {
    setMembersSource(initialMembers);
    setMembers(initialMembers);
  }
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const sidebarRoom = state.rooms.find((r) => r.id === room.id);
  const name = sidebarRoom?.name ?? room.name;
  const conversation = state.conversations[room.id];
  const messages = conversation?.loaded ? conversation.messages : initialMessages;
  const pending = conversation?.pending ?? [];
  const hasOlder = conversation?.loaded ? conversation.hasOlder : initialHasOlder;

  // The page's history and people go into the shared state (again after a refresh).
  useEffect(() => {
    rememberUsers(people);
    loadConversation(room.id, initialMessages, room.lastEventSeq, initialHasOlder);
  }, [
    room.id,
    room.lastEventSeq,
    initialMessages,
    initialHasOlder,
    people,
    loadConversation,
    rememberUsers,
  ]);

  // Older pages (HIST-02), one request at a time, starting before the oldest message held.
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const oldestSeq = messages[0]?.seq;
  const loadOlder = useCallback(() => {
    if (loadingRef.current || oldestSeq === undefined) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    setOlderError(null);
    const url = `/api/rooms/${encodeURIComponent(room.slug)}/messages?before=${String(oldestSeq)}`;
    fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const page = (await response.json()) as {
          messages: MessageWire[];
          users: PublicUser[];
          hasMore: boolean;
        };
        rememberUsers(page.users);
        loadOlderMessages(room.id, page.messages, page.hasMore);
      })
      .catch(() => {
        setOlderError('Earlier messages could not be loaded.');
      })
      .finally(() => {
        loadingRef.current = false;
        setLoadingOlder(false);
      });
  }, [oldestSeq, room.id, room.slug, rememberUsers, loadOlderMessages]);

  // While a member has this room on screen, it counts as read (badges clear on every tab).
  const isMember = membership !== null;
  useEffect(() => {
    if (!isMember) return;
    setOpenConversation(room.id);
    return () => {
      setOpenConversation(null);
    };
  }, [isMember, room.id, setOpenConversation]);

  useEffect(
    () =>
      onMemberEvent(room.id, (event) => {
        setMembers((current) => {
          if (event.type === 'left') return current.filter((m) => m.userId !== event.userId);
          const entry: MemberEntry = {
            userId: event.member.user.id,
            role: event.member.role,
            joinedAt: event.member.joinedAt,
          };
          return [...current.filter((m) => m.userId !== entry.userId), entry];
        });
      }),
    [room.id, onMemberEvent],
  );

  // When a mute ends, show the composer again without a manual reload.
  const mutedUntil = membership?.mutedUntil ?? null;
  useEffect(() => {
    if (!mutedUntil) return;
    const timer = setTimeout(
      () => {
        router.refresh();
      },
      Math.max(0, Date.parse(mutedUntil) - Date.now()) + 1000,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [mutedUntil, router]);

  const canModerate = membership?.role === 'owner' || membership?.role === 'moderator';
  const canTakePart = membership !== null && emailVerified && !membership.mutedUntil;
  const roles = new Map(members.map((m) => [m.userId, m.role]));
  const myRank = membership ? RANK[membership.role] : 0;
  const permissionsFor = (message: MessageWire): MessagePermissions => {
    const authorRole = roles.get(message.authorId);
    const mine = message.authorId === me.id;
    return {
      canTakePart,
      // Your own messages (even while muted); otherwise you must outrank the author here.
      canDelete:
        membership !== null &&
        (mine || (myRank >= RANK.moderator && myRank > (authorRole ? RANK[authorRole] : 0))),
    };
  };
  const replyTo = replyToId ? (messages.find((m) => m.id === replyToId) ?? null) : null;

  /** Up arrow in an empty composer: edit your newest message that can still be edited. */
  const editLast = (): boolean => {
    const cutoff = Date.now() - LIMITS.message.editWindowMs + 60_000;
    const last = [...messages]
      .reverse()
      .find((m) => m.authorId === me.id && !isRemoved(m) && Date.parse(m.createdAt) > cutoff);
    if (!last) return false;
    setEditingId(last.id);
    return true;
  };

  let footer: React.ReactNode;
  if (!membership) {
    footer = (
      <CannotPost>
        <form action={joinRoomAction} className="flex flex-wrap items-center justify-between gap-3">
          <span>You are looking at this room. Join it to chat.</span>
          <input type="hidden" name="conversationId" value={room.id} />
          <Button type="submit">Join #{name}</Button>
        </form>
      </CannotPost>
    );
  } else if (!emailVerified) {
    footer = (
      <CannotPost>
        Confirm your email address to post: we sent you a link. You can read everything meanwhile.
      </CannotPost>
    );
  } else if (membership.mutedUntil) {
    footer = (
      <CannotPost>
        A moderator muted you in this room until <LocalTime iso={membership.mutedUntil} withDate />.
        You can still read.
      </CannotPost>
    );
  } else {
    footer = (
      <Composer
        room={{ id: room.id, name }}
        memberIds={members.map((m) => m.userId)}
        replyTo={replyTo}
        onCancelReply={() => {
          setReplyToId(null);
        }}
        onEditLast={editLast}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <section aria-labelledby="room-title" className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-line bg-card px-4 py-3">
          <div className="min-w-0">
            <h1 id="room-title" className="flex items-center gap-1.5 text-lg font-extrabold">
              {room.visibility === 'private' ? (
                <Lock aria-label="Private room" className="h-4 w-4 text-muted" />
              ) : (
                <Hash aria-hidden="true" className="h-4 w-4 text-muted" />
              )}
              <span className="truncate">{name}</span>
            </h1>
            <p className="truncate text-sm text-ink-2">
              {room.topic || 'No topic'} · {members.length}{' '}
              {members.length === 1 ? 'member' : 'members'}
            </p>
          </div>
          <div className="flex shrink-0 items-start gap-1">
            {canModerate ? (
              <Link
                href={`/app/r/${room.slug}/settings`}
                className={buttonClasses('ghost', 'min-h-9 px-3')}
              >
                <Settings aria-hidden="true" className="h-4 w-4" />
                {/* Icon only on small screens, so the room name keeps its space. */}
                <span className="sr-only sm:not-sr-only">Room settings</span>
              </Link>
            ) : null}
            {membership ? <LeaveButton room={room} /> : null}
          </div>
        </header>
        {!emailVerified && membership ? (
          <div className="px-4 pt-3">
            <Alert tone="info">Confirm your email address to start posting.</Alert>
          </div>
        ) : null}
        <MessageList
          key={room.id}
          room={{ id: room.id, name }}
          messages={messages}
          pending={pending}
          older={{ hasOlder, loading: loadingOlder, error: olderError, load: loadOlder }}
          permissionsFor={permissionsFor}
          editingId={editingId}
          setEditingId={setEditingId}
          onReply={setReplyToId}
        />
        <TypingLine conversationId={room.id} />
        {footer}
      </section>
      <aside
        aria-label="Members"
        className="hidden w-64 shrink-0 overflow-y-auto border-l border-line bg-card p-3 lg:block"
      >
        <h2 className="mb-3 flex items-center gap-1.5 px-1 font-bold">
          <Users aria-hidden="true" className="h-4 w-4 text-muted" />
          Members
        </h2>
        <MemberList room={room} members={members} />
      </aside>
    </div>
  );
}
