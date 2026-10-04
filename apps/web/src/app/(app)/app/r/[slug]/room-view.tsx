'use client';

/**
 * A room or a direct message: header, live messages, who is typing, the composer and (rooms
 * only) the member list with presence (ROOM-02, MSG-01 to MSG-07, RT-03 to RT-05, DM-01, DM-02).
 * A DM shows the other person in the header with "Block" and "Report", ticks on your messages
 * ("Sent", "Delivered", "Seen" when both allow read receipts), and no composer after a block.
 * Messages, people and the room itself can be reported from here (SAFE-01).
 *
 * History arrives with the page; everything after that arrives live through the shared
 * connection (ChatProvider). Sending is optimistic: a message shows at once as "Sending",
 * becomes a normal message when the server confirms it, or shows the reason it was refused with
 * "Try again" and "Delete". While the room is on screen, it counts as read.
 */
import { Ban, Flag, Hash, Lock, MessageSquare, Settings, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useCallback, useEffect, useRef, useState } from 'react';

import type { MessageWire } from '@socketspace/shared/events';
import { LIMITS } from '@socketspace/shared/limits';
import type { PublicUser } from '@socketspace/shared/profile';

import { ReportDialog, type ReportTarget } from '@/components/report-dialog';
import { Alert, Button, buttonClasses } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { useChat } from '@/lib/chat/provider';
import {
  describeTyping,
  typingUserIds,
  type PresenceStatus,
  type Receipts,
} from '@/lib/chat/state';

import { joinRoomAction, leaveRoomAction, type RoomActionState } from '../../room-actions';
import {
  blockUserAction,
  startDmAction,
  unblockUserAction,
  type SocialActionState,
} from '../../social-actions';
import { Composer } from './composer';
import {
  displayName,
  isRemoved,
  LocalTime,
  useMinute,
  type MessagePermissions,
  type Receipt,
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

function MemberList({
  room,
  members,
  onReport,
}: {
  room: RoomInfo;
  members: MemberEntry[];
  onReport: (target: ReportTarget) => void;
}) {
  const { state, me } = useChat();
  const blocked = new Set(state.blocked);
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
                    <span className="min-w-0 flex-1 truncate text-sm">{displayName(person)}</span>
                    {member.userId === me.id ? null : (
                      <span className="flex items-center">
                        <MessageButton
                          userId={member.userId}
                          name={person?.nickname ?? 'this person'}
                        />
                        <BlockButton
                          compact
                          userId={member.userId}
                          name={person?.nickname ?? 'this person'}
                          blocked={blocked.has(member.userId)}
                        />
                        <button
                          type="button"
                          aria-label={`Report ${person?.nickname ?? 'this person'}`}
                          title={`Report ${person?.nickname ?? 'this person'}`}
                          onClick={() => {
                            onReport({
                              type: 'user',
                              userId: member.userId,
                              name: person?.nickname ?? 'this person',
                              conversationId: room.id,
                            });
                          }}
                          className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"
                        >
                          <Flag aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </span>
                    )}
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

/** Opens (or starts) a DM with someone (DM-01). */
function MessageButton({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState<SocialActionState, FormData>(startDmAction, {});
  return (
    <form action={action} className="relative">
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Message ${name}`}
        title={`Message ${name}`}
        className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"
      >
        <MessageSquare aria-hidden="true" className="h-4 w-4" />
      </button>
      {state.error ? (
        <p
          role="alert"
          className="absolute right-0 z-10 w-48 rounded-lg bg-card p-2 text-xs text-danger shadow"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** Block or unblock someone (SAFE-01); `compact` is the icon-only form of the member list. */
function BlockButton({
  userId,
  name,
  blocked,
  compact = false,
}: {
  userId: string;
  name: string;
  blocked: boolean;
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState<SocialActionState, FormData>(
    blocked ? unblockUserAction : blockUserAction,
    {},
  );
  if (compact) {
    const label = blocked ? `Unblock ${name}` : `Block ${name}`;
    return (
      <form action={action} className="relative">
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={pending}
          aria-label={label}
          title={label}
          aria-pressed={blocked}
          className={`rounded-md p-1 hover:bg-surface-2 hover:text-ink ${
            blocked ? 'text-danger' : 'text-muted'
          }`}
        >
          <Ban aria-hidden="true" className="h-4 w-4" />
        </button>
        {state.error ? (
          <p
            role="alert"
            className="absolute right-0 z-10 w-48 rounded-lg bg-card p-2 text-xs text-danger shadow"
          >
            {state.error}
          </p>
        ) : null}
      </form>
    );
  }
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        disabled={pending}
        className={buttonClasses('ghost', 'min-h-9 px-3 text-ink-2')}
        aria-label={blocked ? `Unblock ${name}` : `Block ${name}`}
      >
        <Ban aria-hidden="true" className="h-4 w-4" />
        {blocked ? 'Unblock' : 'Block'}
      </button>
      {state.error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
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
  accountMute = null,
  fromRandom = false,
  emailVerified,
  initialMessages,
  initialMembers,
  people,
  hasOlder: initialHasOlder,
  dm,
  focusMessageId,
}: {
  room: RoomInfo;
  membership: { role: Role; mutedUntil: string | null } | null;
  /** A site moderator muted the whole account (ADMIN-03): until when, and why. */
  accountMute?: { until: string; reason: string } | null;
  /** The room was opened from a suggestion after a random chat; joining it is counted (RAND-09). */
  fromRandom?: boolean;
  emailVerified: boolean;
  initialMessages: MessageWire[];
  initialMembers: MemberEntry[];
  people: PublicUser[];
  /** Older messages exist than the page brought. */
  hasOlder: boolean;
  /** Set for a direct message (DM-01, DM-02). */
  dm?: { otherUserId: string; blocked: boolean; receipts: Receipts | null };
  /** Jump to this message when the page opens (search, notifications). */
  focusMessageId?: string;
}) {
  const {
    state,
    me,
    loadConversation,
    loadOlderMessages,
    rememberUsers,
    onMemberEvent,
    setOpenConversation,
    setReceipts,
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
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const sidebarRoom = state.rooms.find((r) => r.id === room.id);
  const name = sidebarRoom?.name ?? room.name;
  const conversation = state.conversations[room.id];
  const messages = conversation?.loaded ? conversation.messages : initialMessages;
  const pending = conversation?.pending ?? [];
  const hasOlder = conversation?.loaded ? conversation.hasOlder : initialHasOlder;
  const other = dm ? state.users[dm.otherUserId] : undefined;
  const otherName = other?.nickname ?? 'someone';
  // How this conversation is named in labels: "#design" or "@ava".
  const label = dm ? `@${otherName}` : `#${name}`;

  // A DM brings the other person's receipts (if both allow them); live updates move them on.
  const dmReceipts = dm ? JSON.stringify(dm.receipts) : null;
  useEffect(() => {
    if (dmReceipts === null) return;
    setReceipts(room.id, JSON.parse(dmReceipts) as Receipts | null);
  }, [dmReceipts, room.id, setReceipts]);
  const receipts = state.receipts[room.id];
  const receiptFor = (message: MessageWire): Receipt | undefined => {
    if (!dm || message.authorId !== me.id) return undefined;
    if (!receipts) return 'sent';
    if (receipts.read >= message.seq) return 'seen';
    return receipts.delivered >= message.seq ? 'delivered' : 'sent';
  };
  const blockedPeople = new Set(state.blocked);

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
    const url = `/api/conversations/${room.id}/messages?before=${String(oldestSeq)}`;
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
  }, [oldestSeq, room.id, rememberUsers, loadOlderMessages]);

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

  // When a mute ends, show the composer again without a manual reload. If both a room mute and
  // an account mute are in force, the page is refreshed when the first one ends.
  const mutedUntil =
    [membership?.mutedUntil, accountMute?.until].filter((until) => until != null).sort()[0] ?? null;
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
  const canTakePart =
    membership !== null && emailVerified && !membership.mutedUntil && !accountMute;
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
  if (dm?.blocked) {
    footer = (
      <CannotPost>
        You cannot send messages in this conversation.{' '}
        {blockedPeople.has(dm.otherUserId) ? 'Unblock them to write again.' : ''}
      </CannotPost>
    );
  } else if (!membership) {
    footer = (
      <CannotPost>
        <form action={joinRoomAction} className="flex flex-wrap items-center justify-between gap-3">
          <span>You are looking at this room. Join it to chat.</span>
          <input type="hidden" name="conversationId" value={room.id} />
          {fromRandom ? <input type="hidden" name="from" value="random" /> : null}
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
  } else if (accountMute) {
    footer = (
      <CannotPost>
        A moderator muted your account until <LocalTime iso={accountMute.until} withDate />. You can
        still read. Reason: {accountMute.reason}
      </CannotPost>
    );
  } else {
    footer = (
      <Composer
        room={{ id: room.id, name: label }}
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
        {dm ? (
          <header className="flex items-center justify-between gap-3 border-b border-line bg-card px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <UserAvatar user={other} />
              <div className="min-w-0">
                <h1 id="room-title" className="truncate text-lg font-extrabold">
                  {displayName(other)}
                </h1>
                <p className="text-sm text-ink-2">Direct message</p>
              </div>
            </div>
            <div className="flex shrink-0 items-start gap-1">
              <button
                type="button"
                className={buttonClasses('ghost', 'min-h-9 px-3 text-ink-2')}
                aria-label={`Report ${otherName}`}
                onClick={() => {
                  setReporting({
                    type: 'user',
                    userId: dm.otherUserId,
                    name: otherName,
                    conversationId: room.id,
                  });
                }}
              >
                <Flag aria-hidden="true" className="h-4 w-4" />
                Report
              </button>
              <BlockButton
                userId={dm.otherUserId}
                name={otherName}
                blocked={blockedPeople.has(dm.otherUserId)}
              />
            </div>
          </header>
        ) : (
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
              {canModerate ? null : (
                <button
                  type="button"
                  className={buttonClasses('ghost', 'min-h-9 px-3 text-ink-2')}
                  aria-label={`Report the room ${name}`}
                  title="Report this room"
                  onClick={() => {
                    setReporting({ type: 'room', conversationId: room.id, name: `#${name}` });
                  }}
                >
                  <Flag aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only sm:not-sr-only">Report</span>
                </button>
              )}
              {membership ? <LeaveButton room={room} /> : null}
            </div>
          </header>
        )}
        {!emailVerified && membership ? (
          <div className="px-4 pt-3">
            <Alert tone="info">Confirm your email address to start posting.</Alert>
          </div>
        ) : null}
        <MessageList
          key={room.id}
          room={{ id: room.id, name: label }}
          messages={messages}
          pending={pending}
          older={{ hasOlder, loading: loadingOlder, error: olderError, load: loadOlder }}
          permissionsFor={permissionsFor}
          editingId={editingId}
          setEditingId={setEditingId}
          onReply={setReplyToId}
          onReport={(messageId) => {
            const reported = messages.find((m) => m.id === messageId);
            if (!reported) return;
            setReporting({
              type: 'message',
              messageId,
              authorName: state.users[reported.authorId]?.nickname ?? 'someone',
            });
          }}
          receiptFor={receiptFor}
          blocked={blockedPeople}
          {...(focusMessageId ? { initialJump: focusMessageId } : {})}
        />
        <TypingLine conversationId={room.id} />
        {footer}
      </section>
      {dm ? null : (
        <aside
          aria-label="Members"
          className="hidden w-64 shrink-0 overflow-y-auto border-l border-line bg-card p-3 lg:block"
        >
          <h2 className="mb-3 flex items-center gap-1.5 px-1 font-bold">
            <Users aria-hidden="true" className="h-4 w-4 text-muted" />
            Members
          </h2>
          <MemberList room={room} members={members} onReport={setReporting} />
        </aside>
      )}
      {reporting ? (
        <ReportDialog
          // A fresh dialog (and a fresh form) for each thing reported.
          key={JSON.stringify(reporting)}
          target={reporting}
          onClose={() => {
            setReporting(null);
          }}
        />
      ) : null}
    </div>
  );
}
