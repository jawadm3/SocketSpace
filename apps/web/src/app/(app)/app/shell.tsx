'use client';

/**
 * The app shell around every /app page: the sidebar (navigation, your rooms, you), the live
 * connection status and notices from moderators. Mobile gets a compact top bar with the same
 * links; Stage F refines the small-screen layout.
 */
import { Compass, Hash, Home, Lock, Plus, Settings, WifiOff, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { UserAvatar } from '@/components/user-avatar';
import { useChat } from '@/lib/chat/provider';
import type { ConnectionStatus as Status, SidebarRoom } from '@/lib/chat/state';

import { SignOutButton } from '../sign-out-button';

const STATUS_TEXT: Record<Status, string> = {
  connecting: 'Connecting to live chat…',
  connected: 'Connected to live chat',
  reconnecting: 'Reconnecting to live chat… (on our free hosting this can take up to a minute)',
  offline: 'You are offline.',
  unavailable: 'Live chat is unavailable right now.',
};

export function ConnectionStatus() {
  const { state } = useChat();
  const dot =
    state.status === 'connected'
      ? 'bg-emerald-500'
      : state.status === 'unavailable' || state.status === 'offline'
        ? 'bg-danger'
        : 'bg-stamp';
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-ink-2">
      <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
      {STATUS_TEXT[state.status]}
    </p>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-10 items-center gap-2.5 rounded-xl px-3 text-sm font-semibold ${
        active ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-2'
      }`}
    >
      <span aria-hidden="true" className="text-muted">
        {icon}
      </span>
      {children}
    </Link>
  );
}

function RoomLink({ room, unread }: { room: SidebarRoom; unread: number }) {
  const pathname = usePathname();
  const href = `/app/r/${room.slug}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm ${
          active
            ? 'bg-accent-soft font-semibold text-ink'
            : unread > 0
              ? 'font-bold text-ink hover:bg-surface-2'
              : 'text-ink-2 hover:bg-surface-2'
        }`}
      >
        {room.visibility === 'private' ? (
          <Lock aria-label="Private room" className="h-3.5 w-3.5 shrink-0 text-muted" />
        ) : (
          <Hash aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
        )}
        <span className="flex-1 truncate">{room.name}</span>
        {unread > 0 ? (
          <span
            data-testid="unread-badge"
            className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs leading-5 font-bold text-accent-ink"
          >
            <span aria-hidden="true">{unread > 99 ? '99+' : unread}</span>
            <span className="sr-only">, {unread} unread</span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function RoomList() {
  const { state } = useChat();
  if (state.rooms.length === 0) {
    return (
      <p className="px-3 text-sm text-muted">
        No rooms yet.{' '}
        <Link href="/app/explore" className="font-semibold text-accent underline">
          Explore
        </Link>{' '}
        or create one.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {state.rooms.map((room) => (
        <RoomLink key={room.id} room={room} unread={state.unread[room.id] ?? 0} />
      ))}
    </ul>
  );
}

export function Sidebar() {
  const { me } = useChat();
  return (
    <aside
      aria-label="Rooms and navigation"
      className="hidden w-72 shrink-0 flex-col border-r border-line bg-card md:flex"
    >
      <div className="airmail-stripe h-1.5 w-full" aria-hidden="true" />
      <div className="px-4 pt-4 pb-2">
        <Link href="/app" className="text-lg font-extrabold tracking-tight text-ink">
          SocketSpace
        </Link>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
        <NavLink href="/app" icon={<Home className="h-4 w-4" />}>
          Home
        </NavLink>
        <NavLink href="/app/explore" icon={<Compass className="h-4 w-4" />}>
          Explore rooms
        </NavLink>
        <NavLink href="/app/rooms/new" icon={<Plus className="h-4 w-4" />}>
          New room
        </NavLink>
      </nav>
      <section aria-labelledby="your-rooms" className="mt-4 flex min-h-0 flex-1 flex-col px-2">
        <h2
          id="your-rooms"
          className="px-3 pb-1 text-xs font-bold tracking-wider text-muted uppercase"
        >
          Your rooms
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <RoomList />
        </div>
      </section>
      <div className="flex flex-col gap-2 border-t border-line p-3">
        <div className="flex items-center gap-2">
          <UserAvatar user={me} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{me.nickname}</span>
          <Link
            href="/app/settings/profile"
            className="rounded-lg p-2 text-muted hover:bg-surface-2"
            aria-label="Settings"
          >
            <Settings aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
        <ConnectionStatus />
        <SignOutButton />
      </div>
    </aside>
  );
}

/** Small screens: the same destinations in a top bar, and rooms in a disclosure. */
export function MobileBar() {
  const { state } = useChat();
  const totalUnread = state.rooms.reduce((sum, r) => sum + (state.unread[r.id] ?? 0), 0);
  return (
    <div className="border-b border-line bg-card md:hidden">
      <div className="airmail-stripe h-1 w-full" aria-hidden="true" />
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <Link href="/app" className="font-extrabold tracking-tight">
          SocketSpace
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <Link
            href="/app/explore"
            className="rounded-lg p-2 hover:bg-surface-2"
            aria-label="Explore rooms"
          >
            <Compass aria-hidden="true" className="h-5 w-5" />
          </Link>
          <Link
            href="/app/rooms/new"
            className="rounded-lg p-2 hover:bg-surface-2"
            aria-label="New room"
          >
            <Plus aria-hidden="true" className="h-5 w-5" />
          </Link>
          <Link
            href="/app/settings/profile"
            className="rounded-lg p-2 hover:bg-surface-2"
            aria-label="Settings"
          >
            <Settings aria-hidden="true" className="h-5 w-5" />
          </Link>
        </nav>
      </div>
      <div className="px-4 pb-1">
        <ConnectionStatus />
      </div>
      <details className="px-4 pb-2">
        <summary className="cursor-pointer py-1 text-sm font-semibold text-ink-2">
          Your rooms ({state.rooms.length})
          {totalUnread > 0 ? ` · ${String(totalUnread)} unread` : ''}
        </summary>
        <div className="pt-1">
          <RoomList />
        </div>
      </details>
    </div>
  );
}

/** How long a reconnect may take before the banner appears (most take a second or two). */
const RECONNECT_GRACE_MS = 2000;

/**
 * A banner across the app while the live connection is down (RECON-01). Offline shows at once;
 * a reconnect only after a short grace period, so a quick blip does not flash a warning.
 * Messages written meanwhile wait in the outbox and go out by themselves.
 */
export function ConnectionBanner() {
  const { state } = useChat();
  const { status } = state;
  const [graceOver, setGraceOver] = useState(false);
  const [graceFor, setGraceFor] = useState(status);
  if (graceFor !== status) {
    setGraceFor(status);
    setGraceOver(false);
  }
  useEffect(() => {
    if (status !== 'reconnecting') return;
    const timer = setTimeout(() => {
      setGraceOver(true);
    }, RECONNECT_GRACE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  let text: string | null = null;
  if (status === 'offline') {
    text = 'You are offline. Messages you send will go out when the connection returns.';
  } else if (status === 'reconnecting' && graceOver) {
    text = 'Reconnecting… Messages you send will go out when the connection returns.';
  } else if (status === 'unavailable') {
    text = 'Live chat is unavailable right now. Try reloading the page.';
  }
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {text ? (
        <p
          data-testid="connection-banner"
          className="flex items-center gap-2 border-b border-line bg-stamp/20 px-4 py-2 text-sm font-semibold text-ink"
        >
          <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" />
          {text}
        </p>
      ) : null}
    </div>
  );
}

/** Notices from moderators (muted, removed, banned), until dismissed. */
export function Notices() {
  const { state, dismissNotice } = useChat();
  if (state.notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-4 pt-3">
      {state.notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
            notice.tone === 'error' ? 'border-danger bg-danger-soft' : 'border-line bg-accent-soft'
          }`}
        >
          <p className="flex-1">{notice.text}</p>
          <button
            type="button"
            onClick={() => {
              dismissNotice(notice.id);
            }}
            className="rounded-lg p-1 hover:bg-surface-2"
            aria-label="Dismiss"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
