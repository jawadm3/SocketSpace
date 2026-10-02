/**
 * The send outbox (RECON-04): order, surviving a reload, retries with back-off, waiting while
 * offline, and giving up cleanly.
 */
import { describe, expect, it } from 'vitest';

import type { MessageWire } from '@socketspace/shared/events';

import {
  clearAllOutboxes,
  Outbox,
  OUTBOX_MAX_ATTEMPTS,
  outboxStorageKey,
  retryDelayMs,
  type OutboxClock,
  type OutboxItem,
  type SendResult,
} from './outbox';

const USER = '0192f0c1-7a3b-7c4d-8e5f-0000000000bb';
const CONV = '0192f0c1-7a3b-7c4d-8e5f-000000000001';
const id = (n: number) => `0192f0c1-7a3b-4c4d-8e5f-${String(n).padStart(12, '0')}`;

/** An in-memory stand-in for localStorage. */
class MemoryStorage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

/** Timers the test runs by hand. */
function manualClock() {
  let timers: { run: () => void; ms: number; id: number }[] = [];
  let next = 1;
  const clock: OutboxClock = {
    setTimeout: (run, ms) => {
      const handle = next++;
      timers.push({ run, ms, id: handle });
      return handle;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((t) => t.id !== handle);
    },
  };
  return {
    clock,
    delays: () => timers.map((t) => t.ms),
    fire: () => {
      const due = timers;
      timers = [];
      for (const t of due) t.run();
    },
  };
}

const flush = () => new Promise((done) => setTimeout(done, 0));

function stored(item: OutboxItem): MessageWire {
  return {
    id: item.clientId,
    conversationId: item.conversationId,
    seq: 1,
    eventSeq: 1,
    authorId: USER,
    clientId: item.clientId,
    kind: 'text',
    body: item.body,
    replyToId: item.replyToId ?? null,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    moderationState: 'visible',
    createdAt: '2030-01-01T00:00:00.000Z',
    reactions: [],
  };
}

function setup(options: { connected?: boolean; storage?: MemoryStorage } = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const timers = manualClock();
  const state = { connected: options.connected ?? true };
  const sentBodies: string[] = [];
  const sentIds: string[] = [];
  const failed: { clientId: string; message: string }[] = [];
  const answers: ((item: OutboxItem) => SendResult)[] = [];
  const outbox = new Outbox({
    send: (item) => {
      sentBodies.push(item.body);
      const answer = answers.shift() ?? ((i: OutboxItem) => ({ ok: true, message: stored(i) }));
      return Promise.resolve(answer(item));
    },
    isConnected: () => state.connected,
    onSent: (clientId) => sentIds.push(clientId),
    onFailed: (clientId, error) => failed.push({ clientId, message: error.message }),
    storage,
    userId: USER,
    clock: timers.clock,
  });
  return { outbox, storage, timers, state, sentBodies, sentIds, failed, answers };
}

const unavailable = (): SendResult => ({
  ok: false,
  retryable: true,
  error: { code: 'UNAVAILABLE', message: 'No answer.' },
});

describe('Outbox', () => {
  it('sends one at a time, in the order written, and forgets each once stored', async () => {
    const t = setup();
    t.outbox.add({ clientId: id(1), conversationId: CONV, body: 'one' });
    t.outbox.add({ clientId: id(2), conversationId: CONV, body: 'two' });
    t.outbox.add({ clientId: id(3), conversationId: CONV, body: 'three' });
    expect(t.sentBodies).toEqual(['one']); // the next waits for the answer
    await flush();
    await flush();
    await flush();
    expect(t.sentBodies).toEqual(['one', 'two', 'three']);
    expect(t.sentIds).toEqual([id(1), id(2), id(3)]);
    expect(t.outbox.size).toBe(0);
    expect(t.storage.getItem(outboxStorageKey(USER))).toBeNull();
  });

  it('waits while offline without counting attempts, then sends on reconnect', async () => {
    const t = setup({ connected: false });
    t.outbox.add({ clientId: id(1), conversationId: CONV, body: 'typed offline' });
    await flush();
    expect(t.sentBodies).toEqual([]);
    t.state.connected = true;
    t.outbox.connected();
    await flush();
    expect(t.sentIds).toEqual([id(1)]);
  });

  it('survives a reload: a new page restores and sends with the same client ID', async () => {
    const first = setup({ connected: false });
    first.outbox.add({
      clientId: id(7),
      conversationId: CONV,
      body: 'before reload',
      replyToId: id(3),
    });
    first.outbox.dispose();

    const second = setup({ storage: first.storage });
    expect(second.outbox.restore()).toEqual([
      { clientId: id(7), conversationId: CONV, body: 'before reload', replyToId: id(3) },
    ]);
    second.outbox.connected();
    await flush();
    expect(second.sentIds).toEqual([id(7)]);
  });

  it('retries a passing failure with growing waits, then gives up after 5 attempts', async () => {
    const t = setup();
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) t.answers.push(unavailable);
    t.outbox.add({ clientId: id(1), conversationId: CONV, body: 'flaky' });
    const waits: number[] = [];
    for (let i = 1; i < OUTBOX_MAX_ATTEMPTS; i++) {
      await flush();
      waits.push(...t.timers.delays());
      t.timers.fire();
    }
    await flush();
    expect(waits).toEqual([1000, 2000, 4000, 8000]);
    expect(t.sentBodies).toHaveLength(OUTBOX_MAX_ATTEMPTS);
    expect(t.failed).toEqual([{ clientId: id(1), message: 'Not sent after 5 tries. No answer.' }]);

    // "Try again" starts afresh, and the failure was saved for a reload meanwhile.
    expect(t.storage.getItem(outboxStorageKey(USER))).toContain('"failed"');
    t.outbox.retry(id(1));
    await flush();
    expect(t.sentIds).toEqual([id(1)]);
  });

  it('marks a refusal failed at once and carries on with the next message', async () => {
    const t = setup();
    t.answers.push(() => ({
      ok: false,
      retryable: false,
      error: { code: 'FORBIDDEN', message: 'You are muted in this room.' },
    }));
    t.outbox.add({ clientId: id(1), conversationId: CONV, body: 'refused' });
    t.outbox.add({ clientId: id(2), conversationId: CONV, body: 'next' });
    await flush();
    await flush();
    expect(t.failed).toEqual([{ clientId: id(1), message: 'You are muted in this room.' }]);
    expect(t.sentIds).toEqual([id(2)]);
  });

  it('uses the server hint for "too many requests"', () => {
    expect(retryDelayMs(1, 3500)).toBe(3500);
    expect(retryDelayMs(3)).toBe(4000);
    expect(retryDelayMs(10)).toBe(16_000);
  });

  it('a connection lost mid-send is not an attempt', async () => {
    const t = setup();
    t.answers.push(() => {
      t.state.connected = false;
      return unavailable();
    });
    t.outbox.add({ clientId: id(1), conversationId: CONV, body: 'dropped' });
    await flush();
    expect(t.timers.delays()).toEqual([]); // no back-off: it waits for the connection
    t.state.connected = true;
    t.outbox.connected();
    await flush();
    expect(t.sentIds).toEqual([id(1)]);
  });

  it('ignores damaged or tampered storage', () => {
    const storage = new MemoryStorage();
    const key = outboxStorageKey(USER);
    for (const raw of [
      'not json',
      '{"v":2,"items":[]}',
      JSON.stringify({ v: 1, items: [{ clientId: 'x', conversationId: CONV, body: 'hi' }] }),
      JSON.stringify({ v: 1, items: [{ clientId: id(1), conversationId: CONV, body: '' }] }),
    ]) {
      storage.setItem(key, raw);
      expect(setup({ storage }).outbox.restore()).toEqual([]);
    }
  });

  it('sign-out clears every saved outbox in the browser', () => {
    const storage = new MemoryStorage();
    storage.setItem(outboxStorageKey(USER), '{}');
    storage.setItem(outboxStorageKey('someone-else'), '{}');
    storage.setItem('theme', 'airmail');
    clearAllOutboxes(storage);
    expect([...storage.data.keys()]).toEqual(['theme']);
  });
});
