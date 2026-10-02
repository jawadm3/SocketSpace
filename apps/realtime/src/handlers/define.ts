/**
 * The wrapper every acknowledged event goes through (realtime-protocol.md, "Message shapes"):
 *
 * 1. the browser must pass an acknowledgement callback;
 * 2. per-user rate limit (token bucket); 20 violations in a minute disconnects the socket;
 * 3. the payload is validated with the shared Zod schema (unknown fields refused);
 * 4. the handler runs; any thrown error becomes `UNAVAILABLE` (database or dependency down,
 *    safe to retry) or `INTERNAL`, without internal details reaching the browser.
 */
import { ABUSE, RATE_LIMITS, type BucketSpec } from '@socketspace/shared/limits';
import { ackError, type Ack } from '@socketspace/shared/errors';
import {
  CLIENT_EVENTS,
  type AckData,
  type AckedClientEventName,
  type ClientPayload,
} from '@socketspace/shared/events';

import type { HandlerContext, IoSocket } from '../types';

export type Handler<E extends AckedClientEventName> = (
  payload: ClientPayload<E>,
  socket: IoSocket,
) => Promise<Ack<AckData<E>>>;

const DEFAULT_BUCKET: BucketSpec = { burst: 30, perSecond: 1 };

/** PostgreSQL connection-level failures (class 08, admin shutdown) and network errors. */
export function isUnavailableError(error: unknown): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      if (code.startsWith('08') || code === '57P01' || code === '57P03' || code === '53300')
        return true;
      if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'].includes(code))
        return true;
    }
    const message = (current as { message?: unknown }).message;
    if (
      typeof message === 'string' &&
      /timeout exceeded when trying to connect|Connection terminated/i.test(message)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A log-safe description of an error: names and codes only. Database driver messages can contain
 * the query's parameters (for example a message's text), so messages are never logged.
 */
export function describeError(error: unknown): { name: string; code?: string } {
  let name = 'Error';
  let code: string | undefined;
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    const candidate = current as { name?: unknown; code?: unknown };
    if (typeof candidate.name === 'string') name = candidate.name;
    if (typeof candidate.code === 'string') code = candidate.code;
  }
  return code === undefined ? { name } : { name, code };
}

/** Tracks handlers still running, so a graceful shutdown can wait for them. */
export class InFlight {
  private count = 0;
  private waiters: (() => void)[] = [];

  start(): void {
    this.count += 1;
  }

  finish(): void {
    this.count -= 1;
    if (this.count === 0) for (const done of this.waiters.splice(0)) done();
  }

  get size(): number {
    return this.count;
  }

  /** Resolves when nothing is running, or after `timeoutMs`. */
  idle(timeoutMs: number): Promise<void> {
    if (this.count === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export function registerHandler<E extends AckedClientEventName>(
  socket: IoSocket,
  ctx: HandlerContext,
  inFlight: InFlight,
  event: E,
  handler: Handler<E>,
): void {
  const spec: BucketSpec = (RATE_LIMITS as Record<string, BucketSpec>)[event] ?? DEFAULT_BUCKET;
  const schema = CLIENT_EVENTS[event].payload;

  // The typed event maps describe what well-behaved browsers send; at run time anything can
  // arrive, so the listener takes unknown arguments and checks them itself.
  const listen = socket.on.bind(socket) as unknown as (
    name: string,
    listener: (...args: unknown[]) => void,
  ) => void;

  listen(event, (payload: unknown, ack: unknown) => {
    if (typeof ack !== 'function') {
      ctx.metrics.increment('ss_events_total', { event, result: 'NO_ACK' });
      return;
    }
    const reply = (response: Ack<unknown>) => {
      ctx.metrics.increment('ss_events_total', {
        event,
        result: response.ok ? 'OK' : response.error.code,
      });
      (ack as (response: Ack<unknown>) => void)(response);
    };

    const waitMs = ctx.buckets.take(`${socket.data.userId}:${event}`, spec);
    if (waitMs > 0) {
      ctx.metrics.increment('ss_rate_limited_total', { event });
      const violations = socket.data.violations.record();
      reply(ackError('RATE_LIMITED', 'You are doing that too fast. Please wait a moment.', waitMs));
      if (violations >= ABUSE.violationsBeforeDisconnect) {
        ctx.logger.warn(
          { socketId: socket.id, userId: socket.data.userId, event },
          'disconnecting socket after repeated rate-limit violations',
        );
        socket.emit('session:ended', { reason: 'abuse' });
        socket.disconnect(true);
      }
      return;
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      reply(ackError('VALIDATION', issue?.message ?? 'The request was not valid.'));
      return;
    }

    inFlight.start();
    handler(parsed.data as ClientPayload<E>, socket)
      .then(reply, (error: unknown) => {
        const unavailable = isUnavailableError(error);
        ctx.logger.error(
          { socketId: socket.id, error: describeError(error), event, userId: socket.data.userId },
          'event handler failed',
        );
        reply(
          unavailable
            ? ackError(
                'UNAVAILABLE',
                'The chat server is having trouble. Your message will be retried.',
              )
            : ackError('INTERNAL', 'Something went wrong on our side.'),
        );
      })
      .finally(() => {
        inFlight.finish();
      });
  });
}
