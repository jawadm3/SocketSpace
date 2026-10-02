/**
 * The browser's chat state rules (RECON-02, RECON-03, MSG-01): ordering, de-duplication,
 * optimistic messages and gap detection.
 */
import { describe, expect, it } from 'vitest';

import type { MessageWire } from '@socketspace/shared/events';

import {
  advanceCursor,
  chatReducer,
  conversationsWithGaps,
  initialChatState,
  mergeMessages,
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
    let state = initialChatState([{ id: 'b', slug: 'b', name: 'Beta', visibility: 'public' }], []);
    state = chatReducer(state, {
      type: 'room-joined',
      room: { id: 'a', slug: 'a', name: 'Alpha', visibility: 'public' },
    });
    state = chatReducer(state, {
      type: 'room-joined',
      room: { id: 'a', slug: 'a', name: 'Alpha', visibility: 'public' },
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
