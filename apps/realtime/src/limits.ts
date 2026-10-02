/**
 * In-memory limits for one realtime instance (with one instance on the free tier this is exact;
 * with several, each instance limits its own share, decision D-010).
 *
 * - Token buckets per user and event: `burst` tokens, refilled at `perSecond`.
 * - Connection caps per user and per IP, plus new connections per IP per minute.
 */
import type { BucketSpec } from '@socketspace/shared/limits';

export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; updatedMs: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Takes one token. Returns 0 if allowed, otherwise the milliseconds until one is available. */
  take(key: string, spec: BucketSpec): number {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: spec.burst, updatedMs: now };
    const refilled = Math.min(
      spec.burst,
      bucket.tokens + ((now - bucket.updatedMs) / 1000) * spec.perSecond,
    );
    if (refilled >= 1) {
      this.buckets.set(key, { tokens: refilled - 1, updatedMs: now });
      return 0;
    }
    this.buckets.set(key, { tokens: refilled, updatedMs: now });
    return Math.ceil(((1 - refilled) / spec.perSecond) * 1000);
  }

  /** Drops buckets that have been full for a while, so memory does not grow without limit. */
  sweep(idleMs = 10 * 60_000): void {
    const cutoff = this.now() - idleMs;
    for (const [key, bucket] of this.buckets)
      if (bucket.updatedMs < cutoff) this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Counts violations in a sliding window (for "20 rate-limit hits in a minute disconnects"). */
export class ViolationCounter {
  private readonly hits: number[] = [];

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records one violation and returns how many fall inside the window. */
  record(): number {
    const now = this.now();
    this.hits.push(now);
    while (this.hits.length > 0 && (this.hits[0] ?? now) <= now - this.windowMs) this.hits.shift();
    return this.hits.length;
  }
}

export interface ConnectionCaps {
  perUser: number;
  perIp: number;
  newPerIpPerMinute: number;
}

export type ConnectionRefusal = 'too_many_for_user' | 'too_many_for_ip' | 'too_fast_from_ip';

export class ConnectionTracker {
  private readonly byUser = new Map<string, number>();
  private readonly byIp = new Map<string, number>();
  private readonly recentByIp = new Map<string, number[]>();

  constructor(
    private readonly caps: ConnectionCaps,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts a new connection attempt from `ip`; refuses if it arrives too fast. */
  noteAttempt(ip: string): ConnectionRefusal | null {
    const now = this.now();
    const recent = (this.recentByIp.get(ip) ?? []).filter((t) => t > now - 60_000);
    recent.push(now);
    this.recentByIp.set(ip, recent);
    return recent.length > this.caps.newPerIpPerMinute ? 'too_fast_from_ip' : null;
  }

  /** Reserves a slot for an authenticated connection, or says why it cannot have one. */
  acquire(userId: string, ip: string): ConnectionRefusal | null {
    if ((this.byUser.get(userId) ?? 0) >= this.caps.perUser) return 'too_many_for_user';
    if ((this.byIp.get(ip) ?? 0) >= this.caps.perIp) return 'too_many_for_ip';
    this.byUser.set(userId, (this.byUser.get(userId) ?? 0) + 1);
    this.byIp.set(ip, (this.byIp.get(ip) ?? 0) + 1);
    return null;
  }

  release(userId: string, ip: string): void {
    decrement(this.byUser, userId);
    decrement(this.byIp, ip);
  }

  sweep(): void {
    const cutoff = this.now() - 60_000;
    for (const [ip, times] of this.recentByIp) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) this.recentByIp.delete(ip);
      else this.recentByIp.set(ip, recent);
    }
  }
}

function decrement(map: Map<string, number>, key: string): void {
  const next = (map.get(key) ?? 0) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}
