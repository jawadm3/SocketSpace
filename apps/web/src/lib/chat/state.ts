/**
 * The browser's chat state as plain data and pure functions, so the tricky rules can be tested
 * without a browser (realtime-protocol.md, "Reconnection and resync"):
 *
 * - Messages are kept per conversation in sequence order and de-duplicated by ID.
 * - An optimistic (not yet acknowledged) message is replaced by the stored one with the same
 *   client ID, so an echo and an acknowledgement never show twice.
 * - `lastEventSeq` only moves forward without gaps. An event that arrives "too early" is applied
 *   but remembered in `ahead`; if the missing numbers do not arrive shortly, the provider asks the
 *   server for everything after `lastEventSeq` (`sync:request`).
 */
import type { MessageWire } from '@socketspace/shared/events';
import type { PublicUser } from '@socketspace/shared/profile';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

export interface PendingMessage {
  clientId: string;
  conversationId: string;
  body: string;
  status: 'sending' | 'failed';
  error?: { code: string; message: string; retryAfterMs?: number };
}

export interface ConversationState {
  /** Stored messages, ordered by `seq`. */
  messages: MessageWire[];
  /** Highest event number applied with no gap before it. */
  lastEventSeq: number;
  /** Event numbers applied beyond `lastEventSeq` (a gap is open while this is not empty). */
  ahead: number[];
  pending: PendingMessage[];
}

export interface SidebarRoom {
  id: string;
  slug: string;
  name: string;
  visibility: 'public' | 'private';
}

export interface Notice {
  id: string;
  tone: 'info' | 'error';
  text: string;
}

export interface ChatState {
  status: ConnectionStatus;
  rooms: SidebarRoom[];
  conversations: Record<string, ConversationState>;
  users: Record<string, PublicUser>;
  notices: Notice[];
}

export type ChatAction =
  | { type: 'status'; status: ConnectionStatus }
  | {
      type: 'conversation-loaded';
      conversationId: string;
      messages: MessageWire[];
      lastEventSeq: number;
    }
  | { type: 'message'; message: MessageWire }
  | {
      type: 'synced';
      conversationId: string;
      messages: MessageWire[];
    }
  | { type: 'pending-added'; pending: Omit<PendingMessage, 'status'> }
  | { type: 'pending-failed'; clientId: string; error: NonNullable<PendingMessage['error']> }
  | { type: 'pending-retried'; clientId: string }
  | { type: 'pending-dismissed'; clientId: string }
  | { type: 'rooms-set'; rooms: SidebarRoom[] }
  | { type: 'room-joined'; room: SidebarRoom }
  | { type: 'room-left'; conversationId: string }
  | { type: 'room-updated'; room: SidebarRoom }
  | { type: 'users'; users: PublicUser[] }
  | { type: 'notice'; notice: Notice }
  | { type: 'notice-dismissed'; id: string };

export function initialChatState(rooms: SidebarRoom[], users: PublicUser[]): ChatState {
  return {
    status: 'connecting',
    rooms: sortRooms(rooms),
    conversations: {},
    users: Object.fromEntries(users.map((u) => [u.id, u])),
    notices: [],
  };
}

function sortRooms(rooms: SidebarRoom[]): SidebarRoom[] {
  return [...rooms].sort((a, b) => a.name.localeCompare(b.name));
}

const emptyConversation = (): ConversationState => ({
  messages: [],
  lastEventSeq: 0,
  ahead: [],
  pending: [],
});

/** Inserts or replaces messages by ID, keeping `seq` order. */
export function mergeMessages(existing: MessageWire[], incoming: MessageWire[]): MessageWire[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const message of incoming) {
    const current = byId.get(message.id);
    // Never let an older copy (lower eventSeq) overwrite a newer one.
    if (!current || message.eventSeq >= current.eventSeq) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Moves the gap-free cursor forward over `eventSeqs`; returns the new cursor and what is still ahead. */
export function advanceCursor(
  lastEventSeq: number,
  ahead: readonly number[],
  eventSeqs: readonly number[],
): { lastEventSeq: number; ahead: number[] } {
  const pendingAhead = new Set(ahead);
  for (const seq of eventSeqs) if (seq > lastEventSeq) pendingAhead.add(seq);
  let cursor = lastEventSeq;
  while (pendingAhead.has(cursor + 1)) {
    cursor += 1;
    pendingAhead.delete(cursor);
  }
  return { lastEventSeq: cursor, ahead: [...pendingAhead].sort((a, b) => a - b) };
}

function withConversation(
  state: ChatState,
  conversationId: string,
  update: (conversation: ConversationState) => ConversationState,
): ChatState {
  const current = state.conversations[conversationId] ?? emptyConversation();
  return {
    ...state,
    conversations: { ...state.conversations, [conversationId]: update(current) },
  };
}

function updatePending(
  state: ChatState,
  clientId: string,
  update: (pending: PendingMessage) => PendingMessage | null,
): ChatState {
  let changed = false;
  const conversations: Record<string, ConversationState> = {};
  for (const [id, conversation] of Object.entries(state.conversations)) {
    if (!conversation.pending.some((p) => p.clientId === clientId)) {
      conversations[id] = conversation;
      continue;
    }
    changed = true;
    conversations[id] = {
      ...conversation,
      pending: conversation.pending.flatMap((p) => {
        if (p.clientId !== clientId) return [p];
        const updated = update(p);
        return updated ? [updated] : [];
      }),
    };
  }
  return changed ? { ...state, conversations } : state;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'status':
      return state.status === action.status ? state : { ...state, status: action.status };

    case 'conversation-loaded':
      // History rendered by the server: everything up to `lastEventSeq` is known.
      return withConversation(state, action.conversationId, (conversation) => {
        const cursor = Math.max(conversation.lastEventSeq, action.lastEventSeq);
        return {
          ...conversation,
          messages: mergeMessages(conversation.messages, action.messages),
          ...advanceCursor(
            cursor,
            conversation.ahead.filter((seq) => seq > cursor),
            [],
          ),
        };
      });

    case 'message':
      return withConversation(state, action.message.conversationId, (conversation) => ({
        ...conversation,
        messages: mergeMessages(conversation.messages, [action.message]),
        pending: conversation.pending.filter((p) => p.clientId !== action.message.clientId),
        ...advanceCursor(conversation.lastEventSeq, conversation.ahead, [action.message.eventSeq]),
      }));

    case 'synced':
      // A sync answer holds every change after the cursor, so the gap is closed afterwards.
      return withConversation(state, action.conversationId, (conversation) => {
        const highest = action.messages.reduce(
          (max, m) => Math.max(max, m.eventSeq),
          conversation.lastEventSeq,
        );
        const clientIds = new Set(action.messages.map((m) => m.clientId));
        return {
          ...conversation,
          messages: mergeMessages(conversation.messages, action.messages),
          pending: conversation.pending.filter((p) => !clientIds.has(p.clientId)),
          ...advanceCursor(
            highest,
            conversation.ahead.filter((seq) => seq > highest),
            [],
          ),
        };
      });

    case 'pending-added':
      return withConversation(state, action.pending.conversationId, (conversation) => ({
        ...conversation,
        pending: [...conversation.pending, { ...action.pending, status: 'sending' }],
      }));

    case 'pending-failed':
      return updatePending(state, action.clientId, (p) => ({
        ...p,
        status: 'failed',
        error: action.error,
      }));

    case 'pending-retried':
      return updatePending(state, action.clientId, (p) => {
        const { error: _error, ...rest } = p;
        return { ...rest, status: 'sending' };
      });

    case 'pending-dismissed':
      return updatePending(state, action.clientId, () => null);

    case 'rooms-set':
      // The server's list after a page load or action wins over what live events built up.
      return { ...state, rooms: sortRooms(action.rooms) };

    case 'room-joined':
      return state.rooms.some((r) => r.id === action.room.id)
        ? state
        : { ...state, rooms: sortRooms([...state.rooms, action.room]) };

    case 'room-left':
      return { ...state, rooms: state.rooms.filter((r) => r.id !== action.conversationId) };

    case 'room-updated':
      return {
        ...state,
        rooms: sortRooms(state.rooms.map((r) => (r.id === action.room.id ? action.room : r))),
      };

    case 'users': {
      if (action.users.length === 0) return state;
      const users = { ...state.users };
      for (const person of action.users) {
        // A broadcast carries the nickname only; keep a real name this viewer was allowed to see.
        const known = users[person.id];
        users[person.id] =
          known?.realName !== undefined && person.realName === undefined
            ? { ...person, realName: known.realName }
            : person;
      }
      return { ...state, users };
    }

    case 'notice':
      return { ...state, notices: [...state.notices.slice(-4), action.notice] };

    case 'notice-dismissed':
      return { ...state, notices: state.notices.filter((n) => n.id !== action.id) };
  }
}

/** Conversations with an open gap: the provider asks the server to fill them. */
export function conversationsWithGaps(
  state: ChatState,
): { conversationId: string; afterEventSeq: number }[] {
  return Object.entries(state.conversations)
    .filter(([, c]) => c.ahead.length > 0)
    .map(([conversationId, c]) => ({ conversationId, afterEventSeq: c.lastEventSeq }));
}
