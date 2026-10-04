/**
 * The random-mode queue and matcher (RAND-03; realtime-protocol.md, "Matching rules").
 * Pure logic with no clock, socket or database of its own, so every rule can be tested exactly.
 *
 * Who is paired:
 * 1. People who share interests come first: the pair with the most shared interests, then the
 *    pair that has waited longest.
 * 2. Without a shared interest, two people are paired once both are "open to anyone": they named
 *    no interests at all, or they have waited `fallbackAfterMs` (10 seconds) for a better match.
 *
 * Who is never paired: an account with itself, two people where either blocked (or wants to
 * avoid) the other, and two people who were paired with each other in the last 10 minutes.
 */

export interface QueueEntry {
  userId: string;
  /** The browser tab (connection) that is waiting. */
  socketId: string;
  guest: boolean;
  ip: string;
  interests: string[];
  joinedAtMs: number;
  /** People this person must not meet: blocks in either direction, and a guest's own avoid list. */
  avoid: Set<string>;
}

export interface MatchedPair {
  a: QueueEntry;
  b: QueueEntry;
  sharedInterests: string[];
}

export interface MatchOptions {
  fallbackAfterMs: number;
  rematchAfterMs: number;
  /** At most this many of the longest-waiting people are compared per run (bounds the work). */
  maxScan?: number;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function sharedInterestsOf(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b);
  return a.filter((interest) => other.has(interest));
}

export class MatchQueue {
  private readonly entries = new Map<string, QueueEntry>();
  /** Pairs made recently, with the time until which they are not made again. */
  private readonly recent = new Map<string, number>();

  constructor(private readonly options: MatchOptions) {}

  get size(): number {
    return this.entries.size;
  }

  get(userId: string): QueueEntry | undefined {
    return this.entries.get(userId);
  }

  /** Adds a person (or replaces their entry: one account waits at most once). */
  add(entry: QueueEntry): void {
    this.entries.set(entry.userId, entry);
  }

  remove(userId: string): QueueEntry | undefined {
    const entry = this.entries.get(userId);
    if (entry) this.entries.delete(userId);
    return entry;
  }

  /** Remembers that two people met, so they are not paired again for a while. */
  notePair(a: string, b: string, nowMs: number): void {
    this.recent.set(pairKey(a, b), nowMs + this.options.rematchAfterMs);
  }

  /** A block appeared while people were waiting: the two must not be paired. */
  avoidEachOther(a: string, b: string): void {
    this.entries.get(a)?.avoid.add(b);
    this.entries.get(b)?.avoid.add(a);
  }

  /** How long the longest-waiting person has waited (0 when nobody waits). */
  longestWaitMs(nowMs: number): number {
    let oldest = nowMs;
    for (const entry of this.entries.values()) oldest = Math.min(oldest, entry.joinedAtMs);
    return nowMs - oldest;
  }

  /** Forgets recent pairs whose time is up, so memory does not grow without limit. */
  sweep(nowMs: number): void {
    for (const [key, until] of this.recent) if (until <= nowMs) this.recent.delete(key);
  }

  private compatible(a: QueueEntry, b: QueueEntry, nowMs: number): boolean {
    if (a.userId === b.userId) return false;
    if (a.avoid.has(b.userId) || b.avoid.has(a.userId)) return false;
    return (this.recent.get(pairKey(a.userId, b.userId)) ?? 0) <= nowMs;
  }

  private openToAnyone(entry: QueueEntry, nowMs: number): boolean {
    return entry.interests.length === 0 || nowMs - entry.joinedAtMs >= this.options.fallbackAfterMs;
  }

  /** Pairs whoever can be paired now and takes them out of the queue. */
  match(nowMs: number): MatchedPair[] {
    const waiting = [...this.entries.values()]
      .sort((x, y) => x.joinedAtMs - y.joinedAtMs)
      .slice(0, this.options.maxScan ?? 500);
    const taken = new Set<string>();
    const pairs: MatchedPair[] = [];
    const take = (a: QueueEntry, b: QueueEntry, sharedInterests: string[]) => {
      taken.add(a.userId);
      taken.add(b.userId);
      this.entries.delete(a.userId);
      this.entries.delete(b.userId);
      pairs.push({ a, b, sharedInterests });
    };

    // 1. Shared interests: most shared first, then the pair that has waited longest.
    const candidates: { a: QueueEntry; b: QueueEntry; shared: string[] }[] = [];
    waiting.forEach((a, index) => {
      if (a.interests.length === 0) return;
      for (const b of waiting.slice(index + 1)) {
        if (b.interests.length === 0 || !this.compatible(a, b, nowMs)) continue;
        const shared = sharedInterestsOf(a.interests, b.interests);
        if (shared.length > 0) candidates.push({ a, b, shared });
      }
    });
    candidates.sort(
      (x, y) =>
        y.shared.length - x.shared.length ||
        x.a.joinedAtMs - y.a.joinedAtMs ||
        x.b.joinedAtMs - y.b.joinedAtMs,
    );
    for (const { a, b, shared } of candidates) {
      if (!taken.has(a.userId) && !taken.has(b.userId)) take(a, b, shared);
    }

    // 2. Anyone: both have no interests to wait for, or have waited long enough.
    const open = waiting.filter((e) => !taken.has(e.userId) && this.openToAnyone(e, nowMs));
    for (const a of open) {
      if (taken.has(a.userId)) continue;
      const b = open.find((e) => !taken.has(e.userId) && this.compatible(a, e, nowMs));
      if (b) take(a, b, []);
    }
    return pairs;
  }
}
