'use client';

/**
 * The live side of the app shell: one connection to the realtime server for every page under
 * /app, and the chat state every page reads (state.ts holds the rules; this file wires the socket
 * to them).
 *
 * - Sending is optimistic: the message shows at once as "Sending", is replaced by the stored copy
 *   when the server acknowledges it, or is marked "Failed" with the reason and a retry button.
 *   A retry re-sends the same client ID, so it can never create a duplicate.
 * - After a reconnect, and whenever a gap in event numbers stays open, it asks the server for
 *   everything after the last number it applied (`sync:request`).
 * - People are fetched once each from `/api/users`, which returns real names only where allowed.
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

import type { Ack } from '@socketspace/shared/errors';
import type {
  AckData,
  ConversationWire,
  MemberWire,
  MessageWire,
} from '@socketspace/shared/events';
import type { PublicUser } from '@socketspace/shared/profile';

import { connectRealtime, type RealtimeSocket } from '@/lib/realtime-client';

import {
  chatReducer,
  conversationsWithGaps,
  initialChatState,
  type ChatState,
  type SidebarRoom,
} from './state';

export type MemberEvent =
  { type: 'joined' | 'updated'; member: MemberWire } | { type: 'left'; userId: string };

interface ChatContextValue {
  state: ChatState;
  me: PublicUser;
  send: (conversationId: string, body: string) => void;
  retry: (clientId: string) => void;
  dismiss: (clientId: string) => void;
  loadConversation: (conversationId: string, messages: MessageWire[], lastEventSeq: number) => void;
  rememberUsers: (users: PublicUser[]) => void;
  ensureUsers: (ids: readonly string[]) => void;
  dismissNotice: (id: string) => void;
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

function toSidebarRoom(conversation: ConversationWire): SidebarRoom | null {
  if (conversation.kind !== 'room' || !conversation.slug || !conversation.name) return null;
  return {
    id: conversation.id,
    slug: conversation.slug,
    name: conversation.name,
    visibility: conversation.visibility,
  };
}

let noticeCounter = 0;
const noticeId = () => {
  noticeCounter += 1;
  return `n${String(noticeCounter)}`;
};

export function ChatProvider({
  me,
  rooms,
  children,
}: {
  me: PublicUser;
  rooms: SidebarRoom[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(chatReducer, undefined, () => initialChatState(rooms, [me]));
  // Socket handlers run outside React's render, so they read the latest state from here.
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  const socketRef = useRef<RealtimeSocket | null>(null);
  const memberListeners = useRef(new Map<string, Set<(event: MemberEvent) => void>>());

  // A server render (after an action, or a refresh) brings the authoritative room list.
  const roomsKey = JSON.stringify(rooms);
  const lastRoomsKey = useRef(roomsKey);
  useEffect(() => {
    if (roomsKey === lastRoomsKey.current) return;
    lastRoomsKey.current = roomsKey;
    dispatch({ type: 'rooms-set', rooms: JSON.parse(roomsKey) as SidebarRoom[] });
  }, [roomsKey]);

  // People: fetch each unknown person once, in batches.
  const requested = useRef(new Set<string>([me.id]));
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
                  // Too much was missed: reload the page's history from the server.
                  router.refresh();
                  continue;
                }
                const messages = result.events.map((e) => e.message);
                dispatch({ type: 'synced', conversationId: result.conversationId, messages });
                ensureUsers(messages.map((m) => m.authorId));
              }
            },
            () => {
              // Not answered in time: the next reconnect or gap check tries again.
            },
          );
      }
    },
    [ensureUsers, router],
  );

  // The connection.
  useEffect(() => {
    let socket: RealtimeSocket | null = null;
    let cancelled = false;
    let helloCount = 0;

    connectRealtime().then(
      (connected) => {
        if (cancelled) {
          connected.close();
          return;
        }
        socket = connected;
        socketRef.current = connected;

        connected.on('server:hello', () => {
          helloCount += 1;
          dispatch({ type: 'status', status: 'connected' });
          // After a reconnect, catch up on everything that happened while away.
          if (helloCount > 1) {
            resync(
              Object.entries(stateRef.current.conversations).map(([conversationId, c]) => ({
                conversationId,
                afterEventSeq: c.lastEventSeq,
              })),
            );
          }
        });
        connected.on('disconnect', () => {
          dispatch({ type: 'status', status: 'reconnecting' });
        });
        connected.on('connect_error', () => {
          dispatch({ type: 'status', status: 'reconnecting' });
        });
        connected.on('session:ended', ({ reason }) => {
          if (reason === 'server_shutdown') return; // Socket.IO reconnects on its own.
          connected.close();
          router.push('/sign-in');
          router.refresh();
        });

        connected.on('message:new', ({ message }) => {
          dispatch({ type: 'message', message });
          ensureUsers([message.authorId]);
        });
        connected.on('message:updated', ({ message }) => {
          dispatch({ type: 'message', message });
        });

        connected.on('conversation:joined', ({ conversation }) => {
          const room = toSidebarRoom(conversation);
          if (room) dispatch({ type: 'room-joined', room });
        });
        connected.on('conversation:updated', ({ conversation }) => {
          const room = toSidebarRoom(conversation);
          if (room) dispatch({ type: 'room-updated', room });
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
          dispatch({
            type: 'notice',
            notice: {
              id: noticeId(),
              tone: 'error',
              text: `Your account was ${kind}${when}: ${reason}`,
            },
          });
        });
      },
      () => {
        if (!cancelled) dispatch({ type: 'status', status: 'unavailable' });
      },
    );

    return () => {
      cancelled = true;
      socketRef.current = null;
      socket?.close();
    };
  }, [ensureUsers, resync, router]);

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

  const emitSend = useCallback((conversationId: string, clientId: string, body: string) => {
    const socket = socketRef.current;
    if (!socket) {
      dispatch({
        type: 'pending-failed',
        clientId,
        error: { code: 'UNAVAILABLE', message: 'Not sent: no connection. Try again.' },
      });
      return;
    }
    socket
      .timeout(SEND_TIMEOUT_MS)
      .emitWithAck('message:send', { conversationId, clientId, body })
      .then(
        (ack: Ack<AckData<'message:send'>>) => {
          if (ack.ok) dispatch({ type: 'message', message: ack.data.message });
          else dispatch({ type: 'pending-failed', clientId, error: ack.error });
        },
        () => {
          dispatch({
            type: 'pending-failed',
            clientId,
            error: { code: 'UNAVAILABLE', message: 'Not sent yet: no answer from the server.' },
          });
        },
      );
  }, []);

  const send = useCallback(
    (conversationId: string, body: string) => {
      const clientId = crypto.randomUUID();
      dispatch({ type: 'pending-added', pending: { clientId, conversationId, body } });
      emitSend(conversationId, clientId, body);
    },
    [emitSend],
  );

  const retry = useCallback(
    (clientId: string) => {
      for (const conversation of Object.values(stateRef.current.conversations)) {
        const pending = conversation.pending.find((p) => p.clientId === clientId);
        if (!pending) continue;
        dispatch({ type: 'pending-retried', clientId });
        emitSend(pending.conversationId, clientId, pending.body);
        return;
      }
    },
    [emitSend],
  );

  const dismiss = useCallback((clientId: string) => {
    dispatch({ type: 'pending-dismissed', clientId });
  }, []);
  const loadConversation = useCallback(
    (conversationId: string, messages: MessageWire[], lastEventSeq: number) => {
      dispatch({ type: 'conversation-loaded', conversationId, messages, lastEventSeq });
    },
    [],
  );
  const dismissNotice = useCallback((id: string) => {
    dispatch({ type: 'notice-dismissed', id });
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
      loadConversation,
      rememberUsers,
      ensureUsers,
      dismissNotice,
      onMemberEvent,
    }),
    [
      state,
      me,
      send,
      retry,
      dismiss,
      loadConversation,
      rememberUsers,
      ensureUsers,
      dismissNotice,
      onMemberEvent,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
