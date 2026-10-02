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
import { useActionState, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { MessageWire } from '@socketspace/shared/events';
import { LIMITS } from '@socketspace/shared/limits';
import type { PublicUser } from '@socketspace/shared/profile';

import { MessageBody } from '@/components/message-body';
import { Alert, Button, buttonClasses } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { useChat } from '@/lib/chat/provider';
import {
  describeTyping,
  typingUserIds,
  type PendingMessage,
  type PresenceStatus,
} from '@/lib/chat/state';

import { joinRoomAction, leaveRoomAction, type RoomActionState } from '../../room-actions';
import { Composer } from './composer';
import {
  displayName,
  isRemoved,
  LocalTime,
  MessageItem,
  snippet,
  useMinute,
  type MessagePermissions,
} from './message-item';

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

function PendingItem({
  pending,
  me,
  original,
}: {
  pending: PendingMessage;
  me: PublicUser;
  original: MessageWire | undefined;
}) {
  const { retry, dismiss } = useChat();
  const failed = pending.status === 'failed';
  return (
    <li className="flex gap-3 px-4 pt-3">
      <div className="w-10 shrink-0">
        <UserAvatar user={me} />
      </div>
      <div className="min-w-0 flex-1">
        {pending.replyToId && original && !isRemoved(original) ? (
          <p className="mb-0.5 truncate text-xs text-ink-2">↪ {snippet(original.body)}</p>
        ) : null}
        <p className="flex items-baseline gap-2">
          <span className="font-bold text-ink">{me.nickname}</span>
          <span className={`text-xs ${failed ? 'font-semibold text-danger' : 'text-muted'}`}>
            {failed ? 'Not sent' : 'Sending…'}
          </span>
        </p>
        <MessageBody
          body={pending.body}
          myNickname={me.nickname}
          className={`text-[0.95rem] ${failed ? 'text-ink' : 'text-ink-2 opacity-70'}`}
        />
        {failed ? (
          <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-danger">{pending.error?.message}</span>
            <button
              type="button"
              className="font-semibold text-accent underline"
              onClick={() => {
                retry(pending.clientId);
              }}
            >
              Try again
            </button>
            <button
              type="button"
              className="font-semibold text-ink-2 underline"
              onClick={() => {
                dismiss(pending.clientId);
              }}
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function MessageList({
  room,
  messages,
  pending,
  permissionsFor,
  editingId,
  setEditingId,
  onReply,
}: {
  room: RoomInfo;
  messages: MessageWire[];
  pending: PendingMessage[];
  permissionsFor: (message: MessageWire) => MessagePermissions;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onReply: (id: string) => void;
}) {
  const { state, me } = useChat();
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const count = messages.length + pending.length;
  const byId = new Map(messages.map((m) => [m.id, m]));

  // Follow new messages only if the reader is already at the bottom (no forced scrolling).
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (atBottom.current) element.scrollTop = element.scrollHeight;
    else setUnseen(true);
  }, [count]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        className="h-full overflow-y-auto pb-2"
        onScroll={(event) => {
          const element = event.currentTarget;
          atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          if (atBottom.current) setUnseen(false);
        }}
      >
        {messages.length === 0 && pending.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-ink-2">
            <p>No messages yet. Be the first to say hello in #{room.name}.</p>
          </div>
        ) : (
          <div role="log" aria-label={`Messages in ${room.name}`}>
            <ol className="flex flex-col">
              {messages.map((message, index) => {
                const previous = messages[index - 1];
                const continued =
                  previous?.authorId === message.authorId &&
                  !isRemoved(previous) &&
                  Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60_000;
                const original = message.replyToId ? byId.get(message.replyToId) : undefined;
                return (
                  <MessageItem
                    key={message.id}
                    message={message}
                    author={state.users[message.authorId]}
                    original={original}
                    originalAuthor={original ? state.users[original.authorId]?.nickname : undefined}
                    continued={continued}
                    permissions={permissionsFor(message)}
                    editing={editingId === message.id}
                    onEdit={setEditingId}
                    onEditDone={() => {
                      setEditingId(null);
                      document.getElementById('composer')?.focus();
                    }}
                    onReply={onReply}
                  />
                );
              })}
              {pending.map((p) => (
                <PendingItem
                  key={p.clientId}
                  pending={p}
                  me={me}
                  original={p.replyToId ? byId.get(p.replyToId) : undefined}
                />
              ))}
            </ol>
          </div>
        )}
      </div>
      {unseen ? (
        <button
          type="button"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink shadow"
          onClick={() => {
            const element = scroller.current;
            if (element) element.scrollTop = element.scrollHeight;
            setUnseen(false);
          }}
        >
          New messages ↓
        </button>
      ) : null}
    </div>
  );
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
}: {
  room: RoomInfo;
  membership: { role: Role; mutedUntil: string | null } | null;
  emailVerified: boolean;
  initialMessages: MessageWire[];
  initialMembers: MemberEntry[];
  people: PublicUser[];
}) {
  const { state, me, loadConversation, rememberUsers, onMemberEvent, setOpenConversation } =
    useChat();
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

  // The page's history and people go into the shared state (again after a refresh).
  useEffect(() => {
    rememberUsers(people);
    loadConversation(room.id, initialMessages, room.lastEventSeq);
  }, [room.id, room.lastEventSeq, initialMessages, people, loadConversation, rememberUsers]);

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
          room={room}
          messages={messages}
          pending={pending}
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
