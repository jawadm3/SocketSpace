'use client';

/**
 * The live side of the app shell: one connection to the realtime server for every page under
 * /app, and the chat state every page reads (state.ts holds the rules; this file wires the socket
 * to them).
 *
 * - Sending is optimistic: the message shows at once as "Sending" and goes into the outbox
 *   (outbox.ts), which sends one message at a time, keeps unsent ones across reloads, retries
 *   with back-off and re-sends the same client ID, so it can never create a duplicate. It is
 *   replaced by the stored copy when the server acknowledges it, or marked "Failed" with the
 *   reason and a retry button.
 * - The browser's offline and online events pause and resume the connection at once; when the
 *   first connection cannot be made, it is tried again with growing waits.
 * - Edits, deletions and reactions apply when the server acknowledges them; a refusal becomes a
 *   notice with the server's reason.
 * - On every (re)connect, and whenever a gap in event numbers stays open, it asks the server for
 *   everything after the last number it applied (`sync:request`).
 * - The room on screen in a visible tab is "being viewed": its badge clears and its read marker
 *   follows the newest event (`read:update`), which clears the badge on the person's other tabs.
 * - Each tab tells the server whether it is in use (`presence:set`: online or away).
 * - People are fetched once each from `/api/users`, which returns real names only where allowed.
 * - DMs (D4): devices confirm what they received (`delivery:ack`, batched); the other person's
 *   "Delivered" and "Seen" arrive as `delivery:updated` and `read:updated`. New notifications
 *   raise the bell count and, if the person opted in and the tab is hidden, show a browser
 *   notification without message text.
 */
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';

import { RETRYABLE_CODES, type Ack } from '@socketspace/shared/errors';
import type {
  AckData,
  ConversationWire,
  MemberWire,
  MessageWire,
} from '@socketspace/shared/events';
import type { ReactionEmoji } from '@socketspace/shared/emoji';
import type { PublicUser } from '@socketspace/shared/profile';

import { connectRealtime, TokenRequestError, type RealtimeSocket } from '@/lib/realtime-client';

import { describeNotification, showBrowserNotification } from './notifications';
import {
  chatReducer,
  conversationsWithGaps,
  initialChatState,
  type ChatState,
  type Receipts,
  type SidebarDm,
  type SidebarRoom,
} from './state';
import { Outbox, type OutboxItem, type SendResult } from './outbox';
import { TypingThrottle } from './typing';

export type MemberEvent =
  { type: 'joined' | 'updated'; member: MemberWire } | { type: 'left'; userId: string };

interface ChatContextValue {
  state: ChatState;
  me: PublicUser;
  send: (conversationId: string, body: string, replyToId?: string) => void;
  retry: (clientId: string) => void;
  dismiss: (clientId: string) => void;
  /** Resolves `true` once the server stored the edit. */
  editMessage: (messageId: string, body: string) => Promise<boolean>;
  deleteMessage: (messageId: string) => Promise<boolean>;
  toggleReaction: (messageId: string, emoji: ReactionEmoji) => void;
  /** Call on each keystroke that leaves text in the composer. */
  typing: (conversationId: string) => void;
  /** Call when the text is sent or cleared. */
  stoppedTyping: (conversationId: string) => void;
  /** The room page on screen (or `null` when it closes). */
  setOpenConversation: (conversationId: string | null) => void;
  loadConversation: (
    conversationId: string,
    messages: MessageWire[],
    lastEventSeq: number,
    hasOlder: boolean,
  ) => void;
  /** A page of older history fetched by the room page (infinite scroll). */
  loadOlderMessages: (conversationId: string, messages: MessageWire[], hasMore: boolean) => void;
  rememberUsers: (users: PublicUser[]) => void;
  ensureUsers: (ids: readonly string[]) => void;
  dismissNotice: (id: string) => void;
  /** Shows a notice at the top of the app (for example "That message is too far back"). */
  notify: (text: string, tone?: 'info' | 'error') => void;
  /** A DM page brings the other person's receipts (or null when they are not shown). */
  setReceipts: (conversationId: string, receipts: Receipts | null) => void;
  /** The notifications page was opened: the bell count goes back to zero. */
  clearNotificationCount: () => void;
  onMemberEvent: (conversationId: string, handler: (event: MemberEvent) => void) => () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChat must be used inside <ChatProvider>');
  return value;
}

/** How long a gap may stay open before asking the server (an overtaking ack usually closes it). */
const GAP_GRACE_MS = 1500;
const SEND_TIMEOUT_MS = 15_000;
/** Read markers wait this long, so a burst of messages becomes one `read:update`. */
const READ_DELAY_MS = 400;
/** The server accepts one `presence:set` per person every 5 seconds. */
const PRESENCE_MIN_GAP_MS = 5100;
/** DM delivery confirmations are collected and sent together (the server accepts 1 a second). */
const DELIVERY_BATCH_MS = 1500;

function toSidebarRoom(conversation: ConversationWire): SidebarRoom | null {
  if (conversation.kind !== 'room' || !conversation.slug || !conversation.name) return null;
  return {
    id: conversation.id,
    slug: conversation.slug,
    name: conversation.name,
    visibility: conversation.visibility,
    lastEventSeq: conversation.lastEventSeq,
  };
}

let noticeCounter = 0;
const noticeId = () => {
  noticeCounter += 1;
  return `n${String(noticeCounter)}`;
};

const tabStatus = (): 'online' | 'away' =>
  document.visibilityState === 'visible' ? 'online' : 'away';

export function ChatProvider({
  me,
  people = [],
  rooms,
  dms,
  unread,
  blocked,
  notificationsUnread,
  children,
}: {
  me: PublicUser;
  /** People the server already knows the page needs (DM partners), so names show at once. */
  people?: PublicUser[];
  rooms: SidebarRoom[];
  dms: SidebarDm[];
  unread: Record<string, number>;
  blocked: string[];
  notificationsUnread: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(chatReducer, undefined, () =>
    initialChatState(rooms, [me, ...people], {
      meId: me.id,
      unread,
      dms,
      blocked,
      notificationsUnread,
    }),
  );
  // Socket handlers run outside React's render, so they read the latest state from here.
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  const socketRef = useRef<RealtimeSocket | null>(null);
  const memberListeners = useRef(new Map<string, Set<(event: MemberEvent) => void>>());

  // A server render (after an action, or a refresh) brings the authoritative rooms and counts.
  const roomsKey = JSON.stringify([rooms, dms, unread, blocked, notificationsUnread]);
  const lastRoomsKey = useRef(roomsKey);
  useEffect(() => {
    if (roomsKey === lastRoomsKey.current) return;
    lastRoomsKey.current = roomsKey;
    const [nextRooms, nextDms, nextUnread, nextBlocked, nextNotifications] = JSON.parse(
      roomsKey,
    ) as [SidebarRoom[], SidebarDm[], Record<string, number>, string[], number];
    dispatch({
      type: 'rooms-set',
      rooms: nextRooms,
      dms: nextDms,
      unread: nextUnread,
      blocked: nextBlocked,
      notificationsUnread: nextNotifications,
    });
  }, [roomsKey]);

  const notifyError = useCallback((text: string) => {
    dispatch({ type: 'notice', notice: { id: noticeId(), tone: 'error', text } });
  }, []);

  // People: fetch each unknown person once, in batches.
  const requested = useRef(new Set<string>([me.id, ...people.map((p) => p.id)]));
  const queue = useRef(new Set<string>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPeople = useCallback(() => {
    flushTimer.current = null;
    const ids = [...queue.current];
    queue.current.clear();
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      fetch(`/api/users?ids=${batch.join(',')}`, { credentials: 'same-origin', cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { users: PublicUser[] } | null) => {
          if (body) dispatch({ type: 'users', users: body.users });
        })
        .catch(() => {
          // Try again the next time someone needs them.
          for (const id of batch) requested.current.delete(id);
        });
    }
  }, []);

  const ensureUsers = useCallback(
    (ids: readonly string[]) => {
      let added = false;
      for (const id of ids) {
        if (requested.current.has(id)) continue;
        requested.current.add(id);
        queue.current.add(id);
        added = true;
      }
      if (added && !flushTimer.current) flushTimer.current = setTimeout(flushPeople, 30);
    },
    [flushPeople],
  );

  const rememberUsers = useCallback((users: PublicUser[]) => {
    for (const person of users) requested.current.add(person.id);
    dispatch({ type: 'users', users });
  }, []);

  // DM delivery confirmations (DM-02): the highest message number received per DM, sent in batches.
  const deliveryQueue = useRef(new Map<string, number>());
  const deliveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmDelivery = useCallback(
    (messages: readonly MessageWire[]) => {
      const dmIds = new Set(stateRef.current.dms.map((d) => d.id));
      for (const m of messages) {
        if (m.authorId === me.id || !dmIds.has(m.conversationId)) continue;
        const queued = deliveryQueue.current.get(m.conversationId) ?? 0;
        if (m.seq > queued) deliveryQueue.current.set(m.conversationId, m.seq);
      }
      if (deliveryQueue.current.size === 0 || deliveryTimer.current) return;
      deliveryTimer.current = setTimeout(() => {
        deliveryTimer.current = null;
        const socket = socketRef.current;
        if (!socket?.connected) return; // the next message or reconnect sends it
        const items = [...deliveryQueue.current].map(([conversationId, seq]) => ({
          conversationId,
          seq,
        }));
        deliveryQueue.current.clear();
        for (let i = 0; i < items.length; i += 50) {
          socket.emit('delivery:ack', { items: items.slice(i, i + 50) });
        }
      }, DELIVERY_BATCH_MS);
    },
    [me.id],
  );

  // Resync: everything after the last applied event number, for the given conversations.
  const resync = useCallback(
    (cursors: { conversationId: string; afterEventSeq: number }[]) => {
      const socket = socketRef.current;
      if (!socket?.connected || cursors.length === 0) return;
      for (let i = 0; i < cursors.length; i += 50) {
        socket
          .timeout(SEND_TIMEOUT_MS)
          .emitWithAck('sync:request', { cursors: cursors.slice(i, i + 50) })
          .then(
            (ack: Ack<AckData<'sync:request'>>) => {
              if (!ack.ok) return;
              for (const result of ack.data.results) {
                if (result.reset) {
                  // Too much was missed: reload the page's history and counts from the server.
                  router.refresh();
                  continue;
                }
                const messages = result.events.map((e) => e.message);
                dispatch({ type: 'synced', conversationId: result.conversationId, messages });
                ensureUsers(messages.map((m) => m.authorId));
                confirmDelivery(messages);
              }
            },
            () => {
              // Not answered in time: the next reconnect or gap check tries again.
            },
          );
      }
    },
    [confirmDelivery, ensureUsers, router],
  );

  // Presence: this tab is "online" while visible and "away" while hidden, sent no more often
  // than the server accepts (only the latest state matters).
  const presenceRef = useRef<{
    sent: 'online' | 'away';
    sentAt: number;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ sent: 'online', sentAt: 0, timer: null });
  const reportPresence = useCallback(() => {
    const tracker = presenceRef.current;
    if (tracker.timer) return; // already scheduled; it sends whatever is current then
    const run = () => {
      tracker.timer = null;
      const socket = socketRef.current;
      const wanted = tabStatus();
      if (!socket?.connected || wanted === tracker.sent) return;
      tracker.sent = wanted;
      tracker.sentAt = Date.now();
      socket.emit('presence:set', { status: wanted }, () => undefined);
    };
    const wait = tracker.sentAt + PRESENCE_MIN_GAP_MS - Date.now();
    if (wait <= 0) run();
    else tracker.timer = setTimeout(run, wait);
  }, []);

  // The outbox: unsent messages, kept in this browser until the server has them.
  const outboxRef = useRef<Outbox | null>(null);
  useEffect(() => {
    const sendViaSocket = (item: OutboxItem): Promise<SendResult> =>
      new Promise((resolve) => {
        const retryable = (message: string): SendResult => ({
          ok: false,
          retryable: true,
          error: { code: 'UNAVAILABLE', message },
        });
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve(retryable('No connection.'));
          return;
        }
        // A dropped connection never answers; do not wait for the timeout to find out.
        const onDrop = () => {
          resolve(retryable('The connection dropped.'));
        };
        socket.once('disconnect', onDrop);
        socket
          .timeout(SEND_TIMEOUT_MS)
          .emitWithAck('message:send', {
            conversationId: item.conversationId,
            clientId: item.clientId,
            body: item.body,
            ...(item.replyToId ? { replyToId: item.replyToId } : {}),
          })
          .then(
            (ack: Ack<AckData<'message:send'>>) => {
              resolve(
                ack.ok
                  ? { ok: true, message: ack.data.message }
                  : { ok: false, error: ack.error, retryable: RETRYABLE_CODES.has(ack.error.code) },
              );
            },
            () => {
              resolve(retryable('No answer from the server.'));
            },
          )
          .finally(() => {
            socket.off('disconnect', onDrop);
          });
      });

    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      // Blocked: the outbox still works, in memory only.
    }
    const outbox = new Outbox({
      userId: me.id,
      storage,
      send: sendViaSocket,
      isConnected: () => socketRef.current?.connected === true,
      onSent: (_clientId, message) => {
        dispatch({ type: 'message', message });
      },
      onFailed: (clientId, error) => {
        dispatch({ type: 'pending-failed', clientId, error });
      },
    });
    outboxRef.current = outbox;
    // Messages an earlier page could not send show again, and go out once connected.
    for (const item of outbox.restore()) {
      dispatch({
        type: 'pending-added',
        pending: {
          clientId: item.clientId,
          conversationId: item.conversationId,
          body: item.body,
          ...(item.replyToId ? { replyToId: item.replyToId } : {}),
        },
      });
      if (item.failed)
        dispatch({ type: 'pending-failed', clientId: item.clientId, error: item.failed });
    }
    outbox.connected();
    return () => {
      outbox.dispose();
      outboxRef.current = null;
    };
  }, [me.id]);

  // The connection.
  useEffect(() => {
    let socket: RealtimeSocket | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const lostStatus = () => (navigator.onLine ? 'reconnecting' : 'offline');

    const start = () => {
      retryTimer = null;
      connectRealtime().then(onConnected, (error: unknown) => {
        if (cancelled) return;
        // Signed out, or not allowed to chat: trying again would not help.
        if (
          error instanceof TokenRequestError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429
        ) {
          dispatch({ type: 'status', status: 'unavailable' });
          return;
        }
        dispatch({ type: 'status', status: lostStatus() });
        failures += 1;
        retryTimer = setTimeout(start, Math.min(30_000, 2000 * 2 ** (failures - 1)));
      });
    };

    const onConnected = (connected: RealtimeSocket) => {
      failures = 0;
      if (cancelled) {
        connected.close();
        return;
      }
      socket = connected;
      socketRef.current = connected;

      connected.on('server:hello', () => {
        dispatch({ type: 'status', status: 'connected' });
        // A new connection starts "online"; say so if this tab is hidden.
        presenceRef.current.sent = 'online';
        reportPresence();
        // Catch up on everything since the page was rendered or the connection dropped.
        resync(
          Object.entries(stateRef.current.conversations).map(([conversationId, c]) => ({
            conversationId,
            afterEventSeq: c.lastEventSeq,
          })),
        );
        // Then send what was written meanwhile, in order.
        outboxRef.current?.connected();
      });
      connected.on('disconnect', () => {
        dispatch({ type: 'status', status: lostStatus() });
        dispatch({ type: 'presence-cleared' });
      });
      connected.on('connect_error', () => {
        dispatch({ type: 'status', status: lostStatus() });
      });
      connected.on('session:ended', ({ reason }) => {
        if (reason === 'server_shutdown') return; // Socket.IO reconnects on its own.
        // Unsent text must not stay behind for whoever uses this browser next.
        outboxRef.current?.clear();
        connected.close();
        router.push('/sign-in');
        router.refresh();
      });

      connected.on('message:new', ({ message }) => {
        dispatch({ type: 'message', message, live: true });
        ensureUsers([message.authorId]);
        confirmDelivery([message]);
      });
      connected.on('message:updated', ({ message }) => {
        dispatch({ type: 'message', message });
      });
      connected.on('message:deleted', ({ conversationId, messageId, eventSeq }) => {
        dispatch({
          type: 'message-deleted',
          conversationId,
          messageId,
          eventSeq,
          deletedAt: new Date().toISOString(),
        });
      });
      connected.on('reaction:updated', ({ conversationId, messageId, reactions, eventSeq }) => {
        dispatch({ type: 'reactions', conversationId, messageId, reactions, eventSeq });
        ensureUsers(reactions.flatMap((r) => r.userIds));
      });
      connected.on('read:updated', ({ conversationId, userId, seq }) => {
        if (userId === me.id) dispatch({ type: 'read', conversationId, seq });
        // The other person in a DM read it ("Seen").
        else dispatch({ type: 'receipt', conversationId, kind: 'read', seq });
      });
      connected.on('delivery:updated', ({ conversationId, seq }) => {
        dispatch({ type: 'receipt', conversationId, kind: 'delivered', seq });
      });
      connected.on('notification:new', ({ notification }) => {
        dispatch({ type: 'notification' });
        const room = stateRef.current.rooms.find((r) => r.id === notification.conversationId);
        showBrowserNotification(
          notification.id,
          describeNotification(
            notification.type,
            notification.actor?.nickname ?? null,
            room ? `#${room.name}` : null,
          ),
        );
      });
      connected.on('typing', ({ conversationId, userId, typing }) => {
        dispatch({ type: 'typing', conversationId, userId, typing, now: Date.now() });
        if (typing) ensureUsers([userId]);
      });
      connected.on('presence', ({ userId, status, lastSeenAt }) => {
        dispatch({ type: 'presence', userId, status, lastSeenAt });
      });

      connected.on('conversation:joined', ({ conversation }) => {
        const room = toSidebarRoom(conversation);
        if (room) dispatch({ type: 'room-joined', room });
        // A new DM: the server's list brings the other person and the counts.
        else router.refresh();
      });
      connected.on('conversation:updated', ({ conversation }) => {
        const room = toSidebarRoom(conversation);
        if (room) dispatch({ type: 'room-updated', room });
        // A DM changed (for example a block): its page re-reads what is allowed.
        else router.refresh();
      });
      connected.on('conversation:left', ({ conversationId }) => {
        dispatch({ type: 'room-left', conversationId });
        // The page showing that room re-checks what this person may now see.
        router.refresh();
      });

      const emitMember = (conversationId: string, event: MemberEvent) => {
        for (const handler of memberListeners.current.get(conversationId) ?? []) handler(event);
      };
      connected.on('member:joined', ({ conversationId, member }) => {
        dispatch({ type: 'users', users: [member.user] });
        emitMember(conversationId, { type: 'joined', member });
      });
      connected.on('member:updated', ({ conversationId, member }) => {
        emitMember(conversationId, { type: 'updated', member });
      });
      connected.on('member:left', ({ conversationId, userId }) => {
        emitMember(conversationId, { type: 'left', userId });
      });
      connected.on('user:updated', ({ user }) => {
        dispatch({ type: 'users', users: [user] });
      });

      connected.on('room:notice', ({ conversationId, kind, reason, until }) => {
        const room = stateRef.current.rooms.find((r) => r.id === conversationId);
        const where = room ? `#${room.name}` : 'a room';
        const when = until ? ` until ${new Date(until).toLocaleString()}` : '';
        const why = reason ? `: ${reason}` : '';
        const text = {
          muted: `You were muted in ${where}${when}${why}`,
          unmuted: `You can post in ${where} again.`,
          removed: `You were removed from ${where}${why}`,
          banned: `You were banned from ${where}${when}${why}`,
        }[kind];
        dispatch({
          type: 'notice',
          notice: { id: noticeId(), tone: kind === 'unmuted' ? 'info' : 'error', text },
        });
        // The room page re-reads what this person may do now (for example the mute banner).
        router.refresh();
      });
      connected.on('moderation:notice', ({ kind, reason, until }) => {
        const when = until ? ` until ${new Date(until).toLocaleString()}` : '';
        notifyError(`Your account was ${kind}${when}: ${reason}`);
      });
    };
    start();

    // The browser knows first when the network goes: pause the connection, and resume it at
    // once when the network returns (instead of waiting out Socket.IO's back-off).
    const onOffline = () => {
      socket?.disconnect();
      dispatch({ type: 'status', status: 'offline' });
    };
    const onOnline = () => {
      if (socket) {
        if (!socket.connected) {
          dispatch({ type: 'status', status: 'reconnecting' });
          socket.connect();
        }
      } else if (retryTimer) {
        clearTimeout(retryTimer);
        failures = 0;
        start();
      }
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      if (retryTimer) clearTimeout(retryTimer);
      socketRef.current = null;
      socket?.close();
    };
  }, [confirmDelivery, ensureUsers, me.id, notifyError, reportPresence, resync, router]);

  // Gaps: give an overtaking event a moment to arrive, then ask the server.
  const gaps = conversationsWithGaps(state);
  const gapKey = gaps.map((g) => `${g.conversationId}:${String(g.afterEventSeq)}`).join(',');
  useEffect(() => {
    if (gapKey === '') return;
    const timer = setTimeout(() => {
      resync(conversationsWithGaps(stateRef.current));
    }, GAP_GRACE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [gapKey, resync]);

  // Which room is being viewed: open on screen, in a tab the person can see.
  const openRef = useRef<string | null>(null);
  const updateViewing = useCallback(() => {
    dispatch({
      type: 'viewing',
      conversationId: document.visibilityState === 'visible' ? openRef.current : null,
    });
  }, []);
  const setOpenConversation = useCallback(
    (conversationId: string | null) => {
      openRef.current = conversationId;
      updateViewing();
    },
    [updateViewing],
  );
  useEffect(() => {
    const onVisibility = () => {
      updateViewing();
      reportPresence();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reportPresence, updateViewing]);

  // Read markers: the viewed room is read up to its newest event.
  const readSent = useRef(new Map<string, number>());
  const viewing = state.viewing;
  const viewedSeq = viewing ? (state.conversations[viewing]?.lastEventSeq ?? 0) : 0;
  const connected = state.status === 'connected';
  useEffect(() => {
    if (!viewing || !connected || viewedSeq === 0) return;
    if ((readSent.current.get(viewing) ?? 0) >= viewedSeq) return;
    const timer = setTimeout(() => {
      const socket = socketRef.current;
      if (!socket?.connected) return;
      readSent.current.set(viewing, viewedSeq);
      socket
        .timeout(SEND_TIMEOUT_MS)
        .emitWithAck('read:update', { conversationId: viewing, seq: viewedSeq })
        .then(
          (ack: Ack<AckData<'read:update'>>) => {
            if (!ack.ok) return;
            // Messages that arrived while the room was on screen are read too.
            const stillViewing = stateRef.current.viewing === viewing;
            dispatch({
              type: 'read',
              conversationId: viewing,
              seq: viewedSeq,
              unread: stillViewing ? 0 : ack.data.unread,
            });
          },
          () => {
            readSent.current.delete(viewing); // try again on the next change
          },
        );
    }, READ_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [viewing, viewedSeq, connected]);

  // Typing: expire other people's indicators, and throttle our own signals.
  const hasTypists = Object.values(state.typing).some((t) => Object.keys(t).length > 0);
  useEffect(() => {
    if (!hasTypists) return;
    const timer = setInterval(() => {
      dispatch({ type: 'typing-expired', now: Date.now() });
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [hasTypists]);
  const typingThrottle = useRef<TypingThrottle | null>(null);
  useEffect(() => {
    const throttle = new TypingThrottle((conversationId, typing) => {
      socketRef.current?.emit('typing:set', { conversationId, typing });
    });
    typingThrottle.current = throttle;
    return () => {
      throttle.dispose();
      typingThrottle.current = null;
    };
  }, []);
  const typing = useCallback((conversationId: string) => {
    // Only while connected: a signal dropped now would hold back the next one for 3 seconds.
    if (socketRef.current?.connected) typingThrottle.current?.typing(conversationId);
  }, []);
  const stoppedTyping = useCallback((conversationId: string) => {
    typingThrottle.current?.stopped(conversationId);
  }, []);

  const send = useCallback((conversationId: string, body: string, replyToId?: string) => {
    const clientId = crypto.randomUUID();
    const pending = { clientId, conversationId, body, ...(replyToId ? { replyToId } : {}) };
    dispatch({ type: 'pending-added', pending });
    typingThrottle.current?.stopped(conversationId);
    outboxRef.current?.add(pending);
  }, []);

  const retry = useCallback((clientId: string) => {
    dispatch({ type: 'pending-retried', clientId });
    outboxRef.current?.retry(clientId);
  }, []);

  const dismiss = useCallback((clientId: string) => {
    outboxRef.current?.remove(clientId);
    dispatch({ type: 'pending-dismissed', clientId });
  }, []);

  /** Sends an acknowledged event; a refusal or timeout becomes a notice and resolves `null`. */
  const request = useCallback(
    async <T,>(run: (socket: RealtimeSocket) => Promise<Ack<T>>): Promise<T | null> => {
      const socket = socketRef.current;
      if (!socket?.connected) {
        notifyError('Not connected to live chat. Try again in a moment.');
        return null;
      }
      try {
        const ack = await run(socket);
        if (ack.ok) return ack.data;
        notifyError(ack.error.message);
      } catch {
        notifyError('No answer from the server. Try again.');
      }
      return null;
    },
    [notifyError],
  );

  const editMessage = useCallback(
    async (messageId: string, body: string) => {
      const data = await request<AckData<'message:edit'>>((socket) =>
        socket.timeout(SEND_TIMEOUT_MS).emitWithAck('message:edit', { messageId, body }),
      );
      if (data) dispatch({ type: 'message', message: data.message });
      return data !== null;
    },
    [request],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      const conversationId = Object.values(stateRef.current.conversations)
        .flatMap((c) => c.messages)
        .find((m) => m.id === messageId)?.conversationId;
      const data = await request<AckData<'message:delete'>>((socket) =>
        socket.timeout(SEND_TIMEOUT_MS).emitWithAck('message:delete', { messageId }),
      );
      if (data && conversationId) {
        dispatch({
          type: 'message-deleted',
          conversationId,
          messageId,
          eventSeq: data.eventSeq,
          deletedAt: new Date().toISOString(),
        });
      }
      return data !== null;
    },
    [request],
  );

  const toggleReaction = useCallback(
    (messageId: string, emoji: ReactionEmoji) => {
      const conversationId = Object.values(stateRef.current.conversations)
        .flatMap((c) => c.messages)
        .find((m) => m.id === messageId)?.conversationId;
      void request<AckData<'reaction:toggle'>>((socket) =>
        socket.timeout(SEND_TIMEOUT_MS).emitWithAck('reaction:toggle', { messageId, emoji }),
      ).then((data) => {
        if (data && conversationId) {
          dispatch({
            type: 'reactions',
            conversationId,
            messageId,
            reactions: data.reactions,
            eventSeq: data.eventSeq,
          });
        }
      });
    },
    [request],
  );

  const loadConversation = useCallback(
    (conversationId: string, messages: MessageWire[], lastEventSeq: number, hasOlder: boolean) => {
      dispatch({ type: 'conversation-loaded', conversationId, messages, lastEventSeq, hasOlder });
    },
    [],
  );
  const loadOlderMessages = useCallback(
    (conversationId: string, messages: MessageWire[], hasMore: boolean) => {
      dispatch({ type: 'older-loaded', conversationId, messages, hasMore });
    },
    [],
  );
  const dismissNotice = useCallback((id: string) => {
    dispatch({ type: 'notice-dismissed', id });
  }, []);
  const notify = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    dispatch({ type: 'notice', notice: { id: noticeId(), tone, text } });
  }, []);
  const setReceipts = useCallback((conversationId: string, receipts: Receipts | null) => {
    dispatch({ type: 'receipts-set', conversationId, receipts });
  }, []);
  const clearNotificationCount = useCallback(() => {
    dispatch({ type: 'notifications-read' });
  }, []);
  const onMemberEvent = useCallback(
    (conversationId: string, handler: (event: MemberEvent) => void) => {
      const handlers = memberListeners.current.get(conversationId) ?? new Set();
      handlers.add(handler);
      memberListeners.current.set(conversationId, handlers);
      return () => {
        handlers.delete(handler);
      };
    },
    [],
  );

  // Every function above keeps its identity, so pages can list them as effect dependencies.
  const value = useMemo<ChatContextValue>(
    () => ({
      state,
      me,
      send,
      retry,
      dismiss,
      editMessage,
      deleteMessage,
      toggleReaction,
      typing,
      stoppedTyping,
      setOpenConversation,
      loadConversation,
      loadOlderMessages,
      rememberUsers,
      ensureUsers,
      dismissNotice,
      notify,
      setReceipts,
      clearNotificationCount,
      onMemberEvent,
    }),
    [
      state,
      me,
      send,
      retry,
      dismiss,
      editMessage,
      deleteMessage,
      toggleReaction,
      typing,
      stoppedTyping,
      setOpenConversation,
      loadConversation,
      loadOlderMessages,
      rememberUsers,
      ensureUsers,
      dismissNotice,
      notify,
      setReceipts,
      clearNotificationCount,
      onMemberEvent,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
