/**
 * The browser's chat state as plain data and pure functions, so the tricky rules can be tested
 * without a browser (realtime-protocol.md, "Reconnection and resync"):
 *
 * - Messages are kept per conversation in sequence order and de-duplicated by ID.
 * - An optimistic (not yet acknowledged) message is replaced by the stored one with the same
 *   client ID, so an echo and an acknowledgement never show twice.
 * - `lastEventSeq` only moves forward without gaps. An event that arrives "too early" is applied
 *   but remembered in `ahead`; if the missing numbers do not arrive shortly, the provider asks the
 *   server for everything after `lastEventSeq` (`sync:request`). Every room you belong to starts
 *   from the event number the server rendered, so gaps are noticed in rooms you are not looking
 *   at too (their unread badges depend on it).
 * - Edits, deletions (tombstones) and reaction changes are applied only if they are newer than
 *   the copy already held (by `eventSeq`), whatever order they arrive in.
 * - Unread counts start from the server and go up with each new message from someone else in a
 *   room you are not looking at; reading on any tab sets them back.
 * - "Is typing" entries carry an expiry time (6 seconds); presence is kept per person.
 *
 * Time never comes from inside the reducer: actions that need it carry `now`.
 */
import type { MessageWire, PRESENCE_STATUSES } from '@socketspace/shared/events';
import type { PublicUser } from '@socketspace/shared/profile';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/** How long a "typing" signal lasts without a fresh one (realtime-protocol.md). */
export const TYPING_TTL_MS = 6000;

export interface PendingMessage {
  clientId: string;
  conversationId: string;
  body: string;
  replyToId?: string;
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
  /** The room page's history is in `messages` (before that, only live messages are known). */
  loaded: boolean;
}

export interface SidebarRoom {
  id: string;
  slug: string;
  name: string;
  visibility: 'public' | 'private';
  /** The room's event number when the server rendered the list: where catching up starts. */
  lastEventSeq: number;
}

export interface Notice {
  id: string;
  tone: 'info' | 'error';
  text: string;
}

export interface Presence {
  status: PresenceStatus;
  lastSeenAt: string | null;
}

export interface ChatState {
  meId: string;
  status: ConnectionStatus;
  rooms: SidebarRoom[];
  conversations: Record<string, ConversationState>;
  users: Record<string, PublicUser>;
  notices: Notice[];
  /** Unread messages per conversation. */
  unread: Record<string, number>;
  /** Per conversation: who is typing, and until when (milliseconds since 1970). */
  typing: Record<string, Record<string, number>>;
  /** Other people's presence; anyone missing is offline. */
  presence: Record<string, Presence>;
  /** The conversation open on screen in a visible tab, if any. */
  viewing: string | null;
}

export type ChatAction =
  | { type: 'status'; status: ConnectionStatus }
  | {
      type: 'conversation-loaded';
      conversationId: string;
      messages: MessageWire[];
      lastEventSeq: number;
    }
  /** A message, new or changed. `live` marks a `message:new` event (it may count as unread). */
  | { type: 'message'; message: MessageWire; live?: boolean }
  | {
      type: 'synced';
      conversationId: string;
      messages: MessageWire[];
    }
  | {
      type: 'message-deleted';
      conversationId: string;
      messageId: string;
      eventSeq: number;
      deletedAt: string;
    }
  | {
      type: 'reactions';
      conversationId: string;
      messageId: string;
      reactions: MessageWire['reactions'];
      eventSeq: number;
    }
  | { type: 'pending-added'; pending: Omit<PendingMessage, 'status'> }
  | { type: 'pending-failed'; clientId: string; error: NonNullable<PendingMessage['error']> }
  | { type: 'pending-retried'; clientId: string }
  | { type: 'pending-dismissed'; clientId: string }
  | { type: 'rooms-set'; rooms: SidebarRoom[]; unread: Record<string, number> }
  | { type: 'room-joined'; room: SidebarRoom }
  | { type: 'room-left'; conversationId: string }
  | { type: 'room-updated'; room: SidebarRoom }
  | { type: 'users'; users: PublicUser[] }
  | { type: 'notice'; notice: Notice }
  | { type: 'notice-dismissed'; id: string }
  /** Read up to `seq` (here or on another tab); `unread` is the server's exact count when known. */
  | { type: 'read'; conversationId: string; seq: number; unread?: number }
  | { type: 'viewing'; conversationId: string | null }
  | { type: 'typing'; conversationId: string; userId: string; typing: boolean; now: number }
  | { type: 'typing-expired'; now: number }
  | { type: 'presence'; userId: string; status: PresenceStatus; lastSeenAt: string | null }
  /** The connection dropped: nobody's presence is known until the server tells us again. */
  | { type: 'presence-cleared' };

export function initialChatState(
  rooms: SidebarRoom[],
  users: PublicUser[],
  options: { meId?: string; unread?: Record<string, number> } = {},
): ChatState {
  const empty: ChatState = {
    meId: options.meId ?? '',
    status: 'connecting',
    rooms: [],
    conversations: {},
    users: Object.fromEntries(users.map((u) => [u.id, u])),
    notices: [],
    unread: {},
    typing: {},
    presence: {},
    viewing: null,
  };
  return chatReducer(empty, { type: 'rooms-set', rooms, unread: options.unread ?? {} });
}

function sortRooms(rooms: SidebarRoom[]): SidebarRoom[] {
  return [...rooms].sort((a, b) => a.name.localeCompare(b.name));
}

const emptyConversation = (lastEventSeq = 0): ConversationState => ({
  messages: [],
  lastEventSeq,
  ahead: [],
  pending: [],
  loaded: false,
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

/** Jumps the cursor to at least `seq` (everything up to it is known from the server). */
function jumpCursor(conversation: ConversationState, seq: number) {
  const cursor = Math.max(conversation.lastEventSeq, seq);
  return advanceCursor(
    cursor,
    conversation.ahead.filter((s) => s > cursor),
    [],
  );
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

/** Applies a change to one known message if it is newer than the copy held. */
function updateMessage(
  conversation: ConversationState,
  messageId: string,
  eventSeq: number,
  change: (message: MessageWire) => MessageWire,
): MessageWire[] {
  return conversation.messages.map((m) =>
    m.id === messageId && eventSeq >= m.eventSeq ? { ...change(m), eventSeq } : m,
  );
}

/** Counts as unread for this viewer: someone else's message that is still there. */
function countsAsUnread(state: ChatState, message: MessageWire): boolean {
  return (
    message.authorId !== state.meId &&
    message.deletedAt === null &&
    message.moderationState !== 'removed' &&
    state.viewing !== message.conversationId
  );
}

function addUnread(state: ChatState, conversationId: string, count: number): ChatState {
  if (count === 0) return state;
  return {
    ...state,
    unread: { ...state.unread, [conversationId]: (state.unread[conversationId] ?? 0) + count },
  };
}

function withoutTypist(state: ChatState, conversationId: string, userId: string): ChatState {
  const typists = state.typing[conversationId];
  if (typists?.[userId] === undefined) return state;
  const { [userId]: _gone, ...rest } = typists;
  return { ...state, typing: { ...state.typing, [conversationId]: rest } };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'status':
      return state.status === action.status ? state : { ...state, status: action.status };

    case 'conversation-loaded':
      // History rendered by the server: everything up to `lastEventSeq` is known.
      return withConversation(state, action.conversationId, (conversation) => ({
        ...conversation,
        messages: mergeMessages(conversation.messages, action.messages),
        loaded: true,
        ...jumpCursor(conversation, action.lastEventSeq),
      }));

    case 'message': {
      const { message } = action;
      const known = state.conversations[message.conversationId]?.messages.some(
        (m) => m.id === message.id,
      );
      let next = withConversation(state, message.conversationId, (conversation) => ({
        ...conversation,
        messages: mergeMessages(conversation.messages, [message]),
        pending: conversation.pending.filter((p) => p.clientId !== message.clientId),
        ...advanceCursor(conversation.lastEventSeq, conversation.ahead, [message.eventSeq]),
      }));
      if (action.live && !known) {
        // Someone who sends has stopped typing.
        next = withoutTypist(next, message.conversationId, message.authorId);
        if (countsAsUnread(state, message)) next = addUnread(next, message.conversationId, 1);
      }
      return next;
    }

    case 'synced': {
      // A sync answer holds every change after the cursor, so the gap is closed afterwards.
      const before = state.conversations[action.conversationId] ?? emptyConversation();
      const knownIds = new Set(before.messages.map((m) => m.id));
      // Messages created after the cursor are new to this tab (older ones were only changed).
      const missed = action.messages.filter(
        (m) => m.seq > before.lastEventSeq && !knownIds.has(m.id) && countsAsUnread(state, m),
      ).length;
      const next = withConversation(state, action.conversationId, (conversation) => {
        const highest = action.messages.reduce(
          (max, m) => Math.max(max, m.eventSeq),
          conversation.lastEventSeq,
        );
        const clientIds = new Set(action.messages.map((m) => m.clientId));
        return {
          ...conversation,
          messages: mergeMessages(conversation.messages, action.messages),
          pending: conversation.pending.filter((p) => !clientIds.has(p.clientId)),
          ...jumpCursor(conversation, highest),
        };
      });
      return addUnread(next, action.conversationId, missed);
    }

    case 'message-deleted':
      return withConversation(state, action.conversationId, (conversation) => ({
        ...conversation,
        // A tombstone keeps its place but loses its text and reactions.
        messages: updateMessage(conversation, action.messageId, action.eventSeq, (m) => ({
          ...m,
          body: '',
          reactions: [],
          deletedAt: m.deletedAt ?? action.deletedAt,
        })),
        ...advanceCursor(conversation.lastEventSeq, conversation.ahead, [action.eventSeq]),
      }));

    case 'reactions':
      return withConversation(state, action.conversationId, (conversation) => ({
        ...conversation,
        messages: updateMessage(conversation, action.messageId, action.eventSeq, (m) =>
          m.deletedAt === null ? { ...m, reactions: action.reactions } : m,
        ),
        ...advanceCursor(conversation.lastEventSeq, conversation.ahead, [action.eventSeq]),
      }));

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

    case 'rooms-set': {
      // The server's list and counts after a page load or action win over what live events
      // built up. Rooms whose history is not on screen catch up from the server's event number.
      const conversations = { ...state.conversations };
      for (const room of action.rooms) {
        const current = conversations[room.id];
        if (!current) conversations[room.id] = emptyConversation(room.lastEventSeq);
        else if (!current.loaded) {
          conversations[room.id] = { ...current, ...jumpCursor(current, room.lastEventSeq) };
        }
      }
      const unread = Object.fromEntries(action.rooms.map((r) => [r.id, action.unread[r.id] ?? 0]));
      if (state.viewing && state.viewing in unread) unread[state.viewing] = 0;
      return { ...state, rooms: sortRooms(action.rooms), conversations, unread };
    }

    case 'room-joined': {
      if (state.rooms.some((r) => r.id === action.room.id)) return state;
      const conversations = state.conversations[action.room.id]
        ? state.conversations
        : { ...state.conversations, [action.room.id]: emptyConversation(action.room.lastEventSeq) };
      return { ...state, rooms: sortRooms([...state.rooms, action.room]), conversations };
    }

    case 'room-left': {
      const { [action.conversationId]: _gone, ...unread } = state.unread;
      return {
        ...state,
        rooms: state.rooms.filter((r) => r.id !== action.conversationId),
        unread,
      };
    }

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

    case 'read': {
      let count: number;
      if (action.unread !== undefined) count = action.unread;
      else {
        const conversation = state.conversations[action.conversationId];
        if (!conversation || action.seq >= conversation.lastEventSeq) count = 0;
        else {
          // Read part of the way: what this tab knows is still unread after the marker.
          const after = conversation.messages.filter(
            (m) =>
              m.seq > action.seq &&
              m.authorId !== state.meId &&
              m.deletedAt === null &&
              m.moderationState !== 'removed',
          ).length;
          count = Math.min(state.unread[action.conversationId] ?? 0, after);
        }
      }
      if ((state.unread[action.conversationId] ?? 0) === count) return state;
      return { ...state, unread: { ...state.unread, [action.conversationId]: count } };
    }

    case 'viewing': {
      if (state.viewing === action.conversationId) return state;
      const next = { ...state, viewing: action.conversationId };
      // Looking at a room clears its badge at once; the read marker follows (provider).
      if (action.conversationId && (state.unread[action.conversationId] ?? 0) > 0) {
        next.unread = { ...state.unread, [action.conversationId]: 0 };
      }
      return next;
    }

    case 'typing': {
      if (action.userId === state.meId) return state;
      if (!action.typing) return withoutTypist(state, action.conversationId, action.userId);
      return {
        ...state,
        typing: {
          ...state.typing,
          [action.conversationId]: {
            ...state.typing[action.conversationId],
            [action.userId]: action.now + TYPING_TTL_MS,
          },
        },
      };
    }

    case 'typing-expired': {
      let changed = false;
      const typing: ChatState['typing'] = {};
      for (const [conversationId, typists] of Object.entries(state.typing)) {
        const still = Object.entries(typists).filter(([, until]) => until > action.now);
        if (still.length !== Object.keys(typists).length) changed = true;
        if (still.length > 0) typing[conversationId] = Object.fromEntries(still);
        else if (Object.keys(typists).length > 0) changed = true;
      }
      return changed ? { ...state, typing } : state;
    }

    case 'presence': {
      const current = state.presence[action.userId];
      const lastSeenAt = action.lastSeenAt ?? current?.lastSeenAt ?? null;
      if (current?.status === action.status && current.lastSeenAt === lastSeenAt) return state;
      return {
        ...state,
        presence: { ...state.presence, [action.userId]: { status: action.status, lastSeenAt } },
      };
    }

    case 'presence-cleared': {
      // Keep "last seen" times; everyone shows offline until the next snapshot.
      const presence: ChatState['presence'] = {};
      for (const [userId, p] of Object.entries(state.presence)) {
        presence[userId] = { status: 'offline', lastSeenAt: p.lastSeenAt };
      }
      return { ...state, presence, typing: {} };
    }
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

/** Who is typing in a conversation right now, in the order they started. */
export function typingUserIds(state: ChatState, conversationId: string): string[] {
  return Object.keys(state.typing[conversationId] ?? {});
}

/** "Ava is typing…", "Ava and Sam are typing…", "Several people are typing…" or ''. */
export function describeTyping(names: readonly string[]): string {
  const [first, second] = names;
  if (first === undefined) return '';
  if (second === undefined) return `${first} is typing…`;
  if (names.length === 2) return `${first} and ${second} are typing…`;
  return 'Several people are typing…';
}
