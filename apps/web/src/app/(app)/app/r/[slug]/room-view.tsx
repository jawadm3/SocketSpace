'use client';

/**
 * A room: header, live messages, the composer and the member list (ROOM-02, MSG-01).
 *
 * History arrives with the page; everything after that arrives live through the shared
 * connection (ChatProvider). Sending is optimistic: a message shows at once as "Sending",
 * becomes a normal message when the server confirms it, or shows the reason it was refused with
 * "Try again" and "Delete".
 */
import { Hash, Lock, Settings, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useActionState,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';

import type { MessageWire } from '@socketspace/shared/events';
import { LIMITS } from '@socketspace/shared/limits';
import type { PublicUser } from '@socketspace/shared/profile';
import { codePointLength } from '@socketspace/shared/text';

import { Alert, Button, buttonClasses } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { useChat } from '@/lib/chat/provider';
import type { PendingMessage } from '@/lib/chat/state';

import { joinRoomAction, leaveRoomAction, type RoomActionState } from '../../room-actions';

type Role = 'owner' | 'moderator' | 'member';

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

/** Times are written in the reader's own time zone, so they are filled in after the page loads. */
const subscribeNever = () => () => undefined;
function LocalTime({ iso, withDate = false }: { iso: string; withDate?: boolean }) {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const date = new Date(iso);
  const text = withDate
    ? date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <time dateTime={iso} title={hydrated ? date.toLocaleString() : undefined}>
      {hydrated ? text : ''}
    </time>
  );
}

function displayName(person: PublicUser | undefined): string {
  if (!person) return 'Someone';
  return person.realName ? `${person.nickname} · ${person.realName}` : person.nickname;
}

function MessageItem({
  message,
  author,
  continued,
}: {
  message: MessageWire;
  author: PublicUser | undefined;
  continued: boolean;
}) {
  const removed = message.deletedAt !== null || message.moderationState === 'removed';
  return (
    <li className={`flex gap-3 px-4 ${continued ? 'pt-0.5' : 'pt-3'}`}>
      <div className="w-10 shrink-0">{continued ? null : <UserAvatar user={author} />}</div>
      <div className="min-w-0 flex-1">
        {continued ? null : (
          <p className="flex items-baseline gap-2">
            <span className="font-bold text-ink">{displayName(author)}</span>
            <span className="text-xs text-muted">
              <LocalTime iso={message.createdAt} />
            </span>
          </p>
        )}
        {removed ? (
          <p className="text-sm text-muted italic">Message deleted</p>
        ) : (
          <p className="text-[0.95rem] break-words whitespace-pre-wrap text-ink">{message.body}</p>
        )}
      </div>
    </li>
  );
}

function PendingItem({ pending, me }: { pending: PendingMessage; me: PublicUser }) {
  const { retry, dismiss } = useChat();
  const failed = pending.status === 'failed';
  return (
    <li className="flex gap-3 px-4 pt-3">
      <div className="w-10 shrink-0">
        <UserAvatar user={me} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="font-bold text-ink">{me.nickname}</span>
          <span className={`text-xs ${failed ? 'font-semibold text-danger' : 'text-muted'}`}>
            {failed ? 'Not sent' : 'Sending…'}
          </span>
        </p>
        <p
          className={`text-[0.95rem] break-words whitespace-pre-wrap ${failed ? 'text-ink' : 'text-ink-2 opacity-70'}`}
        >
          {pending.body}
        </p>
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
  initialMessages,
}: {
  room: RoomInfo;
  initialMessages: MessageWire[];
}) {
  const { state, me } = useChat();
  const conversation = state.conversations[room.id];
  const messages = conversation?.messages ?? initialMessages;
  const pending = conversation?.pending ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const count = messages.length + pending.length;

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
        className="h-full overflow-y-auto pb-4"
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
                  Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60_000;
                return (
                  <MessageItem
                    key={message.id}
                    message={message}
                    author={state.users[message.authorId]}
                    continued={continued}
                  />
                );
              })}
              {pending.map((p) => (
                <PendingItem key={p.clientId} pending={p} me={me} />
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

function Composer({ room }: { room: RoomInfo }) {
  const { send } = useChat();
  const [text, setText] = useState('');
  const length = codePointLength(text);
  const tooLong = length > LIMITS.message.bodyMaxChars;

  function submit() {
    if (text.trim() === '' || tooLong) return;
    send(room.id, text);
    setText('');
  }

  return (
    <form
      className="border-t border-line bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor="composer" className="sr-only">
        Message #{room.name}
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="composer"
          rows={1}
          value={text}
          placeholder={`Message #${room.name}`}
          aria-describedby={tooLong ? 'composer-length' : undefined}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            // Enter sends; Shift+Enter starts a new line.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="max-h-48 min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink [field-sizing:content]"
        />
        <Button type="submit" disabled={text.trim() === '' || tooLong}>
          Send
        </Button>
      </div>
      {length > LIMITS.message.bodyMaxChars - 200 ? (
        <p
          id="composer-length"
          className={`mt-1 text-right text-xs ${tooLong ? 'font-semibold text-danger' : 'text-muted'}`}
        >
          {length} / {LIMITS.message.bodyMaxChars}
        </p>
      ) : null}
    </form>
  );
}

function CannotPost({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-line bg-card p-4 text-sm text-ink-2">{children}</div>;
}

const ROLE_ORDER: Role[] = ['owner', 'moderator', 'member'];
const ROLE_TITLE: Record<Role, string> = {
  owner: 'Owner',
  moderator: 'Moderators',
  member: 'Members',
};

function MemberList({ room, members }: { room: RoomInfo; members: MemberEntry[] }) {
  const { state } = useChat();
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
                return (
                  <li key={member.userId} className="flex items-center gap-2 px-1 py-0.5">
                    <UserAvatar user={person} size="sm" />
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
  const { state, loadConversation, rememberUsers, onMemberEvent } = useChat();
  const router = useRouter();
  // Live member events adjust the list; a fresh server render replaces it.
  const [members, setMembers] = useState(initialMembers);
  const [membersSource, setMembersSource] = useState(initialMembers);
  if (membersSource !== initialMembers) {
    setMembersSource(initialMembers);
    setMembers(initialMembers);
  }
  const sidebarRoom = state.rooms.find((r) => r.id === room.id);
  const name = sidebarRoom?.name ?? room.name;

  // The page's history and people go into the shared state (again after a refresh).
  useEffect(() => {
    rememberUsers(people);
    loadConversation(room.id, initialMessages, room.lastEventSeq);
  }, [room.id, room.lastEventSeq, initialMessages, people, loadConversation, rememberUsers]);

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
    footer = <Composer room={room} />;
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
        <MessageList room={room} initialMessages={initialMessages} />
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
