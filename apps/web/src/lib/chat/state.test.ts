/**
 * The browser's chat state rules (RECON-02, RECON-03, MSG-01 to MSG-05, RT-03 to RT-05):
 * ordering, de-duplication, optimistic messages, gap detection, edits, tombstones, reactions,
 * unread counts, typing and presence.
 */
import { describe, expect, it } from 'vitest';

import type { MessageWire } from '@socketspace/shared/events';

import {
  advanceCursor,
  chatReducer,
  conversationsWithGaps,
  describeTyping,
  initialChatState,
  mergeMessages,
  typingUserIds,
  type ChatState,
} from './state';

const CONV = '0192f0c1-7a3b-7c4d-8e5f-000000000001';
const AUTHOR = '0192f0c1-7a3b-7c4d-8e5f-0000000000aa';

function msg(seq: number, overrides: Partial<MessageWire> = {}): MessageWire {
  return {
    id: `0192f0c1-7a3b-7c4d-8e5f-${String(seq).padStart(12, '0')}`,
    conversationId: CONV,
    seq,
    eventSeq: seq,
    authorId: AUTHOR,
    clientId: `0192f0c1-7a3b-4c4d-8e5f-${String(seq).padStart(12, '0')}`,
    kind: 'text',
    body: `message ${String(seq)}`,
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    moderationState: 'visible',
    createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, seq)).toISOString(),
    reactions: [],
    ...overrides,
  };
}

function loaded(lastEventSeq: number, messages: MessageWire[] = []): ChatState {
  return chatReducer(initialChatState([], []), {
    type: 'conversation-loaded',
    conversationId: CONV,
    messages,
    lastEventSeq,
    hasOlder: false,
  });
}

const conv = (state: ChatState) => state.conversations[CONV];

describe('mergeMessages', () => {
  it('orders by seq and replaces by id, never with an older copy', () => {
    const edited = msg(2, { body: 'edited', eventSeq: 5 });
    const merged = mergeMessages([msg(3), edited], [msg(1), msg(2)]);
    expect(merged.map((m) => [m.seq, m.body])).toEqual([
      [1, 'message 1'],
      [2, 'edited'],
      [3, 'message 3'],
    ]);
  });
});

describe('advanceCursor', () => {
  it('moves forward only without gaps and remembers what is ahead', () => {
    expect(advanceCursor(3, [], [4])).toEqual({ lastEventSeq: 4, ahead: [] });
    expect(advanceCursor(3, [], [6])).toEqual({ lastEventSeq: 3, ahead: [6] });
    expect(advanceCursor(3, [6], [5])).toEqual({ lastEventSeq: 3, ahead: [5, 6] });
    expect(advanceCursor(3, [5, 6], [4])).toEqual({ lastEventSeq: 6, ahead: [] });
    // Old events change nothing.
    expect(advanceCursor(3, [], [2])).toEqual({ lastEventSeq: 3, ahead: [] });
  });
});

describe('chatReducer', () => {
  it('shows a live message once, even if it arrives twice', () => {
    let state = loaded(2, [msg(1), msg(2)]);
    state = chatReducer(state, { type: 'message', message: msg(3) });
    state = chatReducer(state, { type: 'message', message: msg(3) });
    expect(conv(state)?.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(conv(state)?.lastEventSeq).toBe(3);
  });

  it('replaces an optimistic message with the stored one (same client ID)', () => {
    let state = loaded(2);
    const stored = msg(3);
    state = chatReducer(state, {
      type: 'pending-added',
      pending: { clientId: stored.clientId, conversationId: CONV, body: 'message 3' },
    });
    expect(conv(state)?.pending).toHaveLength(1);
    state = chatReducer(state, { type: 'message', message: stored });
    expect(conv(state)?.pending).toEqual([]);
    expect(conv(state)?.messages).toEqual([stored]);
  });

  it('opens a gap when an event arrives early, and a sync closes it', () => {
    let state = loaded(2, [msg(1), msg(2)]);
    state = chatReducer(state, { type: 'message', message: msg(5) });
    expect(conv(state)?.lastEventSeq).toBe(2);
    expect(conversationsWithGaps(state)).toEqual([{ conversationId: CONV, afterEventSeq: 2 }]);

    state = chatReducer(state, {
      type: 'synced',
      conversationId: CONV,
      messages: [msg(3), msg(4), msg(5)],
    });
    expect(conv(state)?.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(conv(state)?.lastEventSeq).toBe(5);
    expect(conversationsWithGaps(state)).toEqual([]);
  });

  it('closes a gap on its own when the missing event arrives just after', () => {
    // Our own acknowledgement (4) can overtake someone else's message (3) on the way in.
    let state = loaded(2);
    state = chatReducer(state, { type: 'message', message: msg(4) });
    state = chatReducer(state, { type: 'message', message: msg(3) });
    expect(conv(state)?.lastEventSeq).toBe(4);
    expect(conversationsWithGaps(state)).toEqual([]);
  });

  it('marks a refused message as failed with the reason, and can retry or dismiss it', () => {
    let state = loaded(0);
    state = chatReducer(state, {
      type: 'pending-added',
      pending: { clientId: 'c1', conversationId: CONV, body: 'hi' },
    });
    state = chatReducer(state, {
      type: 'pending-failed',
      clientId: 'c1',
      error: { code: 'FORBIDDEN', message: 'You are muted', retryAfterMs: 60_000 },
    });
    expect(conv(state)?.pending[0]).toMatchObject({
      status: 'failed',
      error: { code: 'FORBIDDEN', retryAfterMs: 60_000 },
    });
    state = chatReducer(state, { type: 'pending-retried', clientId: 'c1' });
    expect(conv(state)?.pending[0]).toEqual({
      clientId: 'c1',
      conversationId: CONV,
      body: 'hi',
      status: 'sending',
    });
    state = chatReducer(state, { type: 'pending-dismissed', clientId: 'c1' });
    expect(conv(state)?.pending).toEqual([]);
  });

  it('keeps the sidebar sorted and free of duplicates', () => {
    let state = initialChatState(
      [{ id: 'b', slug: 'b', name: 'Beta', visibility: 'public', lastEventSeq: 0 }],
      [],
    );
    state = chatReducer(state, {
      type: 'room-joined',
      room: { id: 'a', slug: 'a', name: 'Alpha', visibility: 'public', lastEventSeq: 0 },
    });
    state = chatReducer(state, {
      type: 'room-joined',
      room: { id: 'a', slug: 'a', name: 'Alpha', visibility: 'public', lastEventSeq: 0 },
    });
    expect(state.rooms.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
    state = chatReducer(state, { type: 'room-left', conversationId: 'b' });
    expect(state.rooms.map((r) => r.id)).toEqual(['a']);
  });

  it('keeps a real name this viewer may see when a nickname-only broadcast arrives', () => {
    let state = initialChatState(
      [],
      [{ id: 'u1', nickname: 'ava', avatar: null, realName: 'Ava Chen' }],
    );
    state = chatReducer(state, {
      type: 'users',
      users: [{ id: 'u1', nickname: 'ava2', avatar: null }],
    });
    expect(state.users.u1).toEqual({
      id: 'u1',
      nickname: 'ava2',
      avatar: null,
      realName: 'Ava Chen',
    });
  });
});

const ME = '0192f0c1-7a3b-7c4d-8e5f-0000000000bb';
const OTHER_ROOM = '0192f0c1-7a3b-7c4d-8e5f-000000000002';
const room = (id: string, lastEventSeq: number) => ({
  id,
  slug: id,
  name: id,
  visibility: 'public' as const,
  lastEventSeq,
});

/** Two rooms, from the server's list: CONV at event 10 with 2 unread, OTHER_ROOM at 4. */
function signedIn(): ChatState {
  return initialChatState([room(CONV, 10), room(OTHER_ROOM, 4)], [], {
    meId: ME,
    unread: { [CONV]: 2 },
  });
}

describe('edits, deletions and reactions (MSG-02, MSG-03, MSG-05)', () => {
  it('turns a message into a tombstone in its place and ignores an older edit afterwards', () => {
    let state = loaded(3, [msg(1), msg(2), msg(3)]);
    state = chatReducer(state, {
      type: 'message-deleted',
      conversationId: CONV,
      messageId: msg(2).id,
      eventSeq: 5,
      deletedAt: '2030-01-01T00:00:10.000Z',
    });
    // The edit (event 4) arrives late: the tombstone (event 5) wins.
    state = chatReducer(state, { type: 'message', message: msg(2, { body: 'late', eventSeq: 4 }) });
    expect(conv(state)?.messages.map((m) => [m.seq, m.body, m.deletedAt !== null])).toEqual([
      [1, 'message 1', false],
      [2, '', true],
      [3, 'message 3', false],
    ]);
    expect(conv(state)?.lastEventSeq).toBe(5);
    expect(conv(state)?.ahead).toEqual([]);
  });

  it('applies reaction summaries by event number and never to a deleted message', () => {
    let state = loaded(1, [msg(1)]);
    const thumbs = [{ emoji: '👍' as const, userIds: [AUTHOR] }];
    state = chatReducer(state, {
      type: 'reactions',
      conversationId: CONV,
      messageId: msg(1).id,
      reactions: thumbs,
      eventSeq: 3,
    });
    // An older summary (event 2) after a newer one (event 3) changes nothing.
    state = chatReducer(state, {
      type: 'reactions',
      conversationId: CONV,
      messageId: msg(1).id,
      reactions: [],
      eventSeq: 2,
    });
    expect(conv(state)?.messages[0]?.reactions).toEqual(thumbs);
    expect(conv(state)?.lastEventSeq).toBe(3);

    state = chatReducer(state, {
      type: 'message-deleted',
      conversationId: CONV,
      messageId: msg(1).id,
      eventSeq: 4,
      deletedAt: '2030-01-01T00:00:10.000Z',
    });
    expect(conv(state)?.messages[0]?.reactions).toEqual([]);
  });
});

describe('room baselines (catching up in rooms that are not on screen)', () => {
  it('starts every room at the server-rendered event number, so a missed event opens a gap', () => {
    let state = signedIn();
    expect(conv(state)).toMatchObject({ lastEventSeq: 10, loaded: false, messages: [] });
    state = chatReducer(state, { type: 'message', message: msg(12), live: true });
    expect(conversationsWithGaps(state)).toEqual([{ conversationId: CONV, afterEventSeq: 10 }]);
  });

  it('a later server list moves an unloaded room forward but leaves a loaded one alone', () => {
    let state = chatReducer(signedIn(), {
      type: 'conversation-loaded',
      conversationId: OTHER_ROOM,
      messages: [],
      lastEventSeq: 4,
      hasOlder: false,
    });
    state = chatReducer(state, {
      type: 'rooms-set',
      rooms: [room(CONV, 15), room(OTHER_ROOM, 9)],
      unread: {},
    });
    expect(state.conversations[CONV]?.lastEventSeq).toBe(15);
    expect(state.conversations[OTHER_ROOM]?.lastEventSeq).toBe(4);
  });

  it('a room joined live starts at its own event number', () => {
    const state = chatReducer(signedIn(), { type: 'room-joined', room: room('r3', 42) });
    expect(state.conversations.r3?.lastEventSeq).toBe(42);
  });
});

describe('unread counts (RT-05)', () => {
  it('starts from the server and counts new messages from others, once each', () => {
    let state = signedIn();
    expect(state.unread[CONV]).toBe(2);
    state = chatReducer(state, { type: 'message', message: msg(11), live: true });
    // The same message again (for example after a resync) is not counted twice.
    state = chatReducer(state, { type: 'synced', conversationId: CONV, messages: [msg(11)] });
    expect(state.unread[CONV]).toBe(3);
  });

  it('never counts your own messages, deleted ones, or edits of older messages', () => {
    let state = signedIn();
    state = chatReducer(state, {
      type: 'message',
      message: msg(11, { authorId: ME }),
      live: true,
    });
    state = chatReducer(state, {
      type: 'synced',
      conversationId: CONV,
      messages: [
        msg(5, { eventSeq: 12, body: 'an edit of an old message' }),
        msg(13, { deletedAt: '2030-01-01T00:00:10.000Z', body: '' }),
        msg(14),
      ],
    });
    expect(state.unread[CONV]).toBe(3);
  });

  it('does not count messages in the room being viewed, and viewing clears the badge', () => {
    let state = chatReducer(signedIn(), { type: 'viewing', conversationId: CONV });
    expect(state.unread[CONV]).toBe(0);
    state = chatReducer(state, { type: 'message', message: msg(11), live: true });
    expect(state.unread[CONV]).toBe(0);
    // A later server list does not bring the badge back for the room on screen.
    state = chatReducer(state, {
      type: 'rooms-set',
      rooms: [room(CONV, 11), room(OTHER_ROOM, 4)],
      unread: { [CONV]: 1 },
    });
    expect(state.unread[CONV]).toBe(0);
  });

  it('reading on another tab clears the badge; a partial read keeps what is still unread', () => {
    let state = signedIn();
    state = chatReducer(state, { type: 'message', message: msg(11), live: true });
    state = chatReducer(state, { type: 'message', message: msg(12), live: true });
    expect(state.unread[CONV]).toBe(4);
    state = chatReducer(state, { type: 'read', conversationId: CONV, seq: 11 });
    expect(state.unread[CONV]).toBe(1);
    state = chatReducer(state, { type: 'read', conversationId: CONV, seq: 12 });
    expect(state.unread[CONV]).toBe(0);
    // The server's exact count wins when it is known.
    state = chatReducer(state, { type: 'read', conversationId: CONV, seq: 12, unread: 2 });
    expect(state.unread[CONV]).toBe(2);
  });

  it('forgets the count of a room you left', () => {
    const state = chatReducer(signedIn(), { type: 'room-left', conversationId: CONV });
    expect(state.unread[CONV]).toBeUndefined();
  });
});

describe('typing and presence (RT-03, RT-04)', () => {
  it('shows a typist until they stop, send, or 6 seconds pass', () => {
    let state = signedIn();
    state = chatReducer(state, {
      type: 'typing',
      conversationId: CONV,
      userId: AUTHOR,
      typing: true,
      now: 1000,
    });
    expect(typingUserIds(state, CONV)).toEqual([AUTHOR]);
    state = chatReducer(state, { type: 'typing-expired', now: 6999 });
    expect(typingUserIds(state, CONV)).toEqual([AUTHOR]);
    state = chatReducer(state, { type: 'typing-expired', now: 7000 });
    expect(typingUserIds(state, CONV)).toEqual([]);

    state = chatReducer(state, {
      type: 'typing',
      conversationId: CONV,
      userId: AUTHOR,
      typing: true,
      now: 8000,
    });
    state = chatReducer(state, { type: 'message', message: msg(11), live: true });
    expect(typingUserIds(state, CONV)).toEqual([]);
  });

  it('ignores your own typing (from your other tabs)', () => {
    const state = chatReducer(signedIn(), {
      type: 'typing',
      conversationId: CONV,
      userId: ME,
      typing: true,
      now: 0,
    });
    expect(typingUserIds(state, CONV)).toEqual([]);
  });

  it('describes typists in plain words', () => {
    expect(describeTyping([])).toBe('');
    expect(describeTyping(['ava'])).toBe('ava is typing…');
    expect(describeTyping(['ava', 'sam'])).toBe('ava and sam are typing…');
    expect(describeTyping(['ava', 'sam', 'kim'])).toBe('Several people are typing…');
  });

  it('keeps presence per person; after a disconnect everyone is offline, last seen kept', () => {
    let state = signedIn();
    state = chatReducer(state, {
      type: 'presence',
      userId: AUTHOR,
      status: 'offline',
      lastSeenAt: '2030-01-01T00:00:00.000Z',
    });
    state = chatReducer(state, {
      type: 'presence',
      userId: AUTHOR,
      status: 'online',
      lastSeenAt: null,
    });
    expect(state.presence[AUTHOR]).toEqual({
      status: 'online',
      lastSeenAt: '2030-01-01T00:00:00.000Z',
    });
    state = chatReducer(state, { type: 'presence-cleared' });
    expect(state.presence[AUTHOR]?.status).toBe('offline');
  });
});

describe('older pages (HIST-02)', () => {
  it('adds older messages in order without moving the cursor', () => {
    let state = chatReducer(initialChatState([], []), {
      type: 'conversation-loaded',
      conversationId: CONV,
      messages: [msg(51), msg(52)],
      lastEventSeq: 52,
      hasOlder: true,
    });
    state = chatReducer(state, {
      type: 'older-loaded',
      conversationId: CONV,
      messages: [msg(49), msg(50)],
      hasMore: false,
    });
    expect(conv(state)?.messages.map((m) => m.seq)).toEqual([49, 50, 51, 52]);
    expect(conv(state)).toMatchObject({ lastEventSeq: 52, hasOlder: false, ahead: [] });
  });

  it('a refreshed latest page keeps older pages already loaded, and what they said', () => {
    let state = chatReducer(initialChatState([], []), {
      type: 'conversation-loaded',
      conversationId: CONV,
      messages: [msg(51)],
      lastEventSeq: 51,
      hasOlder: true,
    });
    state = chatReducer(state, {
      type: 'older-loaded',
      conversationId: CONV,
      messages: [msg(1)],
      hasMore: false,
    });
    state = chatReducer(state, {
      type: 'conversation-loaded',
      conversationId: CONV,
      messages: [msg(51), msg(52)],
      lastEventSeq: 52,
      hasOlder: true,
    });
    expect(conv(state)?.messages.map((m) => m.seq)).toEqual([1, 51, 52]);
    expect(conv(state)?.hasOlder).toBe(false);
  });
});
