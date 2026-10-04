'use client';

/**
 * The message list (HIST-02, HIST-04, MSG-04): virtualised, so only the messages near the screen
 * exist in the page, however long the history. Rows are measured as they appear, because messages
 * have different heights.
 *
 * - It opens at the newest message and follows new ones while you are at the bottom; otherwise a
 *   "New messages" button appears. Your own new message always scrolls into view.
 * - Scrolling near the top loads the previous page (there is also a button, for keyboards); the
 *   message you were reading stays where it was.
 * - A reply quote jumps to its original, loading older pages until it is found.
 * - Screen readers hear new messages from others through a separate polite announcement, not by
 *   the list itself, which would also announce old messages appearing while scrolling up.
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { MessageWire } from '@socketspace/shared/events';
import type { PublicUser } from '@socketspace/shared/profile';

import { MessageBody } from '@/components/message-body';
import { MessageAttachments } from '@/components/message-media';
import { UserAvatar } from '@/components/user-avatar';
import { useChat } from '@/lib/chat/provider';
import type { PendingMessage } from '@/lib/chat/state';

import {
  isRemoved,
  MessageItem,
  messageSnippet,
  type MessagePermissions,
  type Receipt,
} from './message-item';

type Row =
  | { kind: 'message'; message: MessageWire; continued: boolean }
  | { kind: 'pending'; pending: PendingMessage };

const rowKey = (row: Row): string =>
  row.kind === 'message' ? row.message.id : `pending:${row.pending.clientId}`;

/** Rough heights before measuring; close guesses keep the scrollbar steady. */
const estimate = (row: Row | undefined): number =>
  row?.kind === 'message' && row.continued ? 28 : 72;

/**
 * The "start of the room" line above the messages. It sits outside the measured rows, at a fixed
 * height: if it were the first row, keeping the reader's place would anchor to it, and it never
 * moves when older messages arrive beneath it.
 */
const TOP_HEIGHT = 44;
/** Older messages load when the reader is this close to the top. */
const LOAD_OLDER_WITHIN_PX = 600;

/** How many pages a reply quote may load while looking for its original. */
const JUMP_PAGE_LIMIT = 20;

function PendingItem({
  pending,
  me,
  original,
  measureRef,
  index,
}: {
  pending: PendingMessage;
  me: PublicUser;
  original: MessageWire | undefined;
  measureRef: (element: HTMLLIElement | null) => void;
  index: number;
}) {
  const { retry, dismiss } = useChat();
  const failed = pending.status === 'failed';
  return (
    <li ref={measureRef} data-index={index} className="flex gap-3 px-4 pt-3 pb-0.5">
      <div className="w-10 shrink-0">
        <UserAvatar user={me} />
      </div>
      <div className="min-w-0 flex-1">
        {pending.replyToId && original && !isRemoved(original) ? (
          <p className="mb-0.5 truncate text-xs text-ink-2">↪ {messageSnippet(original)}</p>
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
        <MessageAttachments
          attachments={pending.attachments ?? []}
          authorName={me.nickname}
          dimmed={!failed}
        />
        {failed ? (
          <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-danger">{pending.error?.message}</span>
            {/* The word filter gives the same answer every time: sending again cannot help. */}
            {pending.error?.code === 'CONTENT_BLOCKED' ? null : (
              <button
                type="button"
                className="font-semibold text-accent underline"
                onClick={() => {
                  retry(pending.clientId);
                }}
              >
                Try again
              </button>
            )}
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

export interface OlderHistory {
  hasOlder: boolean;
  loading: boolean;
  error: string | null;
  load: () => void;
}

export function MessageList({
  room,
  messages,
  pending,
  older,
  permissionsFor,
  editingId,
  setEditingId,
  onReply,
  onReport,
  receiptFor,
  blocked,
  initialJump,
}: {
  /** `name` as shown: "#design" or "@ava". */
  room: { id: string; name: string };
  messages: MessageWire[];
  pending: PendingMessage[];
  older: OlderHistory;
  permissionsFor: (message: MessageWire) => MessagePermissions;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onReply: (id: string) => void;
  onReport: (id: string) => void;
  /** DMs: how far the other person received and read your message. */
  receiptFor?: (message: MessageWire) => Receipt | undefined;
  /** People this person blocked: their messages are folded away. */
  blocked: ReadonlySet<string>;
  /** A message to jump to when the list opens (search results, notifications). */
  initialJump?: string;
}) {
  const { state, me, notify } = useChat();
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const rows: Row[] = [];
  const byId = new Map<string, MessageWire>();
  messages.forEach((message, index) => {
    byId.set(message.id, message);
    const previous = messages[index - 1];
    const continued =
      previous?.authorId === message.authorId &&
      !isRemoved(previous) &&
      message.replyToId === null &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60_000;
    rows.push({ kind: 'message', message, continued });
  });
  for (const p of pending) rows.push({ kind: 'pending', pending: p });

  // The React Compiler cannot memoise TanStack Virtual's functions; the app does not use the
  // compiler, and this component re-renders on every scroll by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => estimate(rows[index]),
    getItemKey: (index) => {
      const row = rows[index];
      return row ? rowKey(row) : index;
    },
    overscan: 8,
    scrollMargin: TOP_HEIGHT,
    // Chat: keep the reading position when older pages arrive at the top, and follow new
    // messages at the bottom only while the reader is already there.
    anchorTo: 'end',
    followOnAppend: true,
    // Server render and first paint: assume a typical viewport, positioned at the end.
    initialRect: { width: 800, height: 600 },
    initialOffset: () => rows.reduce((total, row) => total + estimate(row), TOP_HEIGHT),
  });
  const items = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items[items.length - 1];
  // Item positions count from the top of the scrolling area; the list starts below the top line.
  const padTop = first ? first.start - TOP_HEIGHT : 0;
  const padBottom = last ? Math.max(0, virtualizer.getTotalSize() - (last.end - TOP_HEIGHT)) : 0;

  // Open at the newest message.
  useLayoutEffect(() => {
    virtualizer.scrollToEnd();
    // Only when the list first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Something new at the bottom: your own message scrolls into view; someone else's shows the
  // "New messages" button if you are reading further up, and is announced to screen readers.
  const lastRow = rows[rows.length - 1];
  const lastKey = lastRow ? rowKey(lastRow) : null;
  const previousLastKey = useRef(lastKey);
  useLayoutEffect(() => {
    if (lastKey === previousLastKey.current) return;
    previousLastKey.current = lastKey;
    if (lastRow?.kind === 'pending') {
      virtualizer.scrollToEnd();
      return;
    }
    if (lastRow?.kind === 'message' && lastRow.message.authorId !== me.id) {
      const author = state.users[lastRow.message.authorId]?.nickname ?? 'Someone';
      setAnnouncement(
        isRemoved(lastRow.message) ? '' : `${author}: ${messageSnippet(lastRow.message, 200)}`,
      );
      if (!atBottom.current) setUnseen(true);
    }
  }, [lastKey, lastRow, me.id, state.users, virtualizer]);

  // An announcement is read once; clearing it keeps old text (for example before an edit) from
  // lingering in the page.
  useEffect(() => {
    if (announcement === '') return;
    const timer = setTimeout(() => {
      setAnnouncement('');
    }, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [announcement]);

  // Near the top: load the previous page.
  const topInView = (virtualizer.scrollOffset ?? Number.POSITIVE_INFINITY) < LOAD_OLDER_WITHIN_PX;
  const { hasOlder, loading, error, load } = older;
  useEffect(() => {
    if (topInView && hasOlder && !loading && error === null) load();
  }, [topInView, hasOlder, loading, error, load]);

  // Reply quotes: scroll to the original (loading older pages if needed), then focus it.
  const jumpTarget = useRef<{ id: string; pagesLeft: number } | null>(null);
  const [jumpRequest, setJumpRequest] = useState(0);
  const jumpTo = useCallback((messageId: string) => {
    jumpTarget.current = { id: messageId, pagesLeft: JUMP_PAGE_LIMIT };
    setJumpRequest((n) => n + 1);
  }, []);
  const targetIndex = jumpTarget.current
    ? rows.findIndex((r) => r.kind === 'message' && r.message.id === jumpTarget.current?.id)
    : -1;
  useEffect(() => {
    const target = jumpTarget.current;
    if (!target) return;
    if (targetIndex >= 0) {
      jumpTarget.current = null;
      virtualizer.scrollToIndex(targetIndex, { align: 'center' });
      let frames = 0;
      const focusWhenDrawn = () => {
        const element = document.getElementById(`message-${target.id}`);
        if (element) {
          element.focus({ preventScroll: true });
          element.dataset.highlight = 'true';
          setTimeout(() => {
            delete element.dataset.highlight;
          }, 2000);
        } else if (frames++ < 60) requestAnimationFrame(focusWhenDrawn);
      };
      requestAnimationFrame(focusWhenDrawn);
      return;
    }
    if (hasOlder && !loading && error === null && target.pagesLeft > 0) {
      target.pagesLeft -= 1;
      load();
    } else if (!loading && (!hasOlder || target.pagesLeft === 0 || error !== null)) {
      jumpTarget.current = null;
      notify(
        hasOlder && error === null
          ? 'That message is too far back to show here. Scroll up to find it.'
          : 'That message could not be shown.',
      );
    }
  }, [jumpRequest, targetIndex, hasOlder, loading, error, load, virtualizer, notify]);

  // Opened from a search result or a notification: go to that message once.
  const jumpedTo = useRef<string | null>(null);
  useEffect(() => {
    if (!initialJump || jumpedTo.current === initialJump) return;
    jumpedTo.current = initialJump;
    jumpTo(initialJump);
  }, [initialJump, jumpTo]);

  if (messages.length === 0 && pending.length === 0 && !hasOlder) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-ink-2">
        <p>No messages yet. Be the first to say hello in {room.name}.</p>
      </div>
    );
  }

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
        {/* New messages are announced below; the list itself stays quiet while scrolling. */}
        <div role="log" aria-live="off" aria-label={`Messages in ${room.name}`}>
          <p
            className="flex items-center justify-center px-4 text-center text-sm text-muted"
            style={{ height: TOP_HEIGHT }}
          >
            {!hasOlder ? (
              `This is the start of ${room.name}.`
            ) : loading ? (
              'Loading earlier messages…'
            ) : (
              <>
                {error ? <span className="mr-2 text-danger">{error}</span> : null}
                <button
                  type="button"
                  onClick={load}
                  className="font-semibold text-accent underline"
                >
                  {error ? 'Try again' : 'Load earlier messages'}
                </button>
              </>
            )}
          </p>
          <ol className="flex flex-col" style={{ paddingTop: padTop, paddingBottom: padBottom }}>
            {items.map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              if (row.kind === 'pending') {
                return (
                  <PendingItem
                    key={item.key}
                    measureRef={virtualizer.measureElement}
                    index={item.index}
                    pending={row.pending}
                    me={me}
                    original={row.pending.replyToId ? byId.get(row.pending.replyToId) : undefined}
                  />
                );
              }
              const { message } = row;
              const original = message.replyToId ? byId.get(message.replyToId) : undefined;
              return (
                <MessageItem
                  key={item.key}
                  measureRef={virtualizer.measureElement}
                  index={item.index}
                  message={message}
                  author={state.users[message.authorId]}
                  original={original}
                  originalAuthor={original ? state.users[original.authorId]?.nickname : undefined}
                  continued={row.continued}
                  permissions={permissionsFor(message)}
                  editing={editingId === message.id}
                  onEdit={setEditingId}
                  onEditDone={() => {
                    setEditingId(null);
                    document.getElementById('composer')?.focus();
                  }}
                  onReply={onReply}
                  onReport={onReport}
                  onJump={jumpTo}
                  receipt={receiptFor?.(message)}
                  blockedAuthor={blocked.has(message.authorId)}
                />
              );
            })}
          </ol>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {unseen ? (
        <button
          type="button"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink shadow"
          onClick={() => {
            virtualizer.scrollToEnd();
            setUnseen(false);
          }}
        >
          New messages ↓
        </button>
      ) : null}
    </div>
  );
}
