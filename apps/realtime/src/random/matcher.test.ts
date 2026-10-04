/**
 * The matching rules of random mode (RAND-03, RAND-04): shared interests first, anyone after 10
 * seconds, and the pairs that must never be made.
 */
import { describe, expect, it } from 'vitest';

import { MatchQueue, type QueueEntry } from './matcher';

const OPTIONS = { fallbackAfterMs: 10_000, rematchAfterMs: 600_000 };

function entry(userId: string, interests: string[], joinedAtMs = 0, avoid: string[] = []) {
  return {
    userId,
    socketId: `socket-${userId}`,
    guest: false,
    ip: '127.0.0.1',
    interests,
    joinedAtMs,
    avoid: new Set(avoid),
  } satisfies QueueEntry;
}

const names = (pairs: { a: QueueEntry; b: QueueEntry }[]) =>
  pairs.map((p) => [p.a.userId, p.b.userId].sort().join('+')).sort();

describe('shared interests come first', () => {
  it('pairs two people with a shared interest at once, before anyone without one', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('early', ['music'], 0));
    queue.add(entry('ava', ['chess', 'films'], 1000));
    queue.add(entry('sam', ['chess'], 2000));
    const pairs = queue.match(2000);
    expect(names(pairs)).toEqual(['ava+sam']);
    expect(pairs[0]?.sharedInterests).toEqual(['chess']);
    // The person who joined first, without a shared interest, keeps waiting.
    expect(queue.size).toBe(1);
    expect(queue.get('early')).toBeDefined();
  });

  it('prefers the pair with the most shared interests', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('ava', ['chess', 'films', 'tea'], 0));
    queue.add(entry('one', ['chess'], 1));
    queue.add(entry('three', ['chess', 'films', 'tea'], 2));
    const pairs = queue.match(10);
    expect(names(pairs)).toEqual(['ava+three']);
    expect(pairs[0]?.sharedInterests.sort()).toEqual(['chess', 'films', 'tea']);
  });

  it('with equal shared interests, the pair that waited longest goes first', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('late', ['chess'], 300));
    queue.add(entry('first', ['chess'], 100));
    queue.add(entry('second', ['chess'], 200));
    expect(names(queue.match(400))).toEqual(['first+second']);
    expect(queue.get('late')).toBeDefined();
  });

  it('makes several pairs in one run', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('a1', ['chess'], 0));
    queue.add(entry('a2', ['chess'], 1));
    queue.add(entry('b1', ['music'], 2));
    queue.add(entry('b2', ['music'], 3));
    expect(names(queue.match(5))).toEqual(['a1+a2', 'b1+b2']);
    expect(queue.size).toBe(0);
  });
});

describe('the random fallback', () => {
  it('pairs people without a shared interest only after 10 seconds', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('ava', ['chess'], 0));
    queue.add(entry('sam', ['music'], 0));
    expect(queue.match(9_999)).toEqual([]);
    const pairs = queue.match(10_000);
    expect(names(pairs)).toEqual(['ava+sam']);
    expect(pairs[0]?.sharedInterests).toEqual([]);
  });

  it('lets a newcomer wait their own 10 seconds for a shared interest', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('ava', ['chess'], 0));
    queue.add(entry('sam', ['music'], 8_000));
    // Ava has waited long enough, Sam has not: Sam may still meet someone who likes music.
    expect(queue.match(12_000)).toEqual([]);
    queue.add(entry('kim', ['music'], 12_500));
    expect(names(queue.match(12_500))).toEqual(['kim+sam']);
    expect(queue.get('ava')).toBeDefined();
  });

  it('pairs people who named no interests at once', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('ava', [], 0));
    queue.add(entry('sam', [], 5));
    expect(names(queue.match(5))).toEqual(['ava+sam']);
  });

  it('pairs someone without interests with someone who has waited 10 seconds', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('ava', ['chess'], 0));
    queue.add(entry('sam', [], 9_000));
    expect(queue.match(9_500)).toEqual([]);
    expect(names(queue.match(10_000))).toEqual(['ava+sam']);
  });

  it('gives the longest-waiting person the first partner', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('third', [], 30));
    queue.add(entry('first', [], 10));
    queue.add(entry('second', [], 20));
    expect(names(queue.match(40))).toEqual(['first+second']);
    expect(queue.get('third')).toBeDefined();
  });
});

describe('pairs that are never made', () => {
  it('never pairs two people when either blocked the other', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('ava', ['chess'], 0, ['sam']));
    queue.add(entry('sam', ['chess'], 0));
    expect(queue.match(60_000)).toEqual([]);
    // Someone else is fine for both.
    queue.add(entry('kim', ['chess'], 60_000));
    expect(names(queue.match(60_000))).toEqual(['ava+kim']);
  });

  it('respects a block made while both were waiting', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('ava', [], 0));
    queue.add(entry('sam', [], 0));
    queue.avoidEachOther('sam', 'ava');
    expect(queue.match(60_000)).toEqual([]);
  });

  it('does not pair the same two people again within 10 minutes', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.notePair('ava', 'sam', 0);
    queue.add(entry('ava', ['chess'], 1000));
    queue.add(entry('sam', ['chess'], 1000));
    expect(queue.match(599_999)).toEqual([]);
    expect(names(queue.match(600_000))).toEqual(['ava+sam']);
  });

  it('holds one entry per account, so nobody is paired with themselves', () => {
    const queue = new MatchQueue(OPTIONS);
    queue.add(entry('ava', [], 0));
    queue.add({ ...entry('ava', [], 5), socketId: 'another-tab' });
    expect(queue.size).toBe(1);
    expect(queue.match(60_000)).toEqual([]);
  });
});

describe('housekeeping', () => {
  it('reports the longest wait and forgets old pairs', () => {
    const queue = new MatchQueue(OPTIONS);
    expect(queue.longestWaitMs(500)).toBe(0);
    queue.add(entry('ava', ['chess'], 100));
    queue.add(entry('sam', ['music'], 300));
    expect(queue.longestWaitMs(500)).toBe(400);
    expect(queue.remove('ava')?.userId).toBe('ava');
    expect(queue.remove('ava')).toBeUndefined();
    queue.notePair('x', 'y', 0);
    queue.sweep(600_000);
    queue.add(entry('x', [], 600_000));
    queue.add(entry('y', [], 600_000));
    expect(queue.match(600_000)).toHaveLength(1);
  });

  it('stays quick with a full queue', () => {
    const queue = new MatchQueue(OPTIONS);
    for (let i = 0; i < 500; i++) queue.add(entry(`u${String(i)}`, [`topic${String(i)}`], i));
    const started = performance.now();
    expect(queue.match(1000)).toEqual([]);
    expect(queue.match(20_000)).toHaveLength(250);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
