/**
 * The random-match events (realtime-protocol.md, "Events: random-match mode"). Each handler is a
 * thin door into the RandomManager (random/manager.ts), which holds the queue and the chats.
 *
 * When random mode is switched off (`RANDOM_MODE_ENABLED=false`, RAND-11) there is no manager,
 * and every event is refused with the same answer.
 *
 * Guests send at half the rate of signed-in people (RAND-10).
 */
import { ackError, type Ack } from '@socketspace/shared/errors';
import { RANDOM_GUEST_MESSAGE_LIMIT } from '@socketspace/shared/limits';

import { RANDOM_OFF_MESSAGE, type RandomManager } from '../random/manager';
import type { HandlerContext, IoSocket } from '../types';
import { registerHandler, registerSignal, type InFlight } from './define';

export function registerRandomHandlers(
  socket: IoSocket,
  ctx: HandlerContext,
  inFlight: InFlight,
): void {
  /** Runs `action` with the manager, or refuses when random mode is switched off. */
  const withRandom = <T>(action: (random: RandomManager) => Ack<T> | Promise<Ack<T>>) =>
    Promise.resolve(ctx.random ? action(ctx.random) : ackError('FORBIDDEN', RANDOM_OFF_MESSAGE));

  registerHandler(socket, ctx, inFlight, 'random:join', ({ interests }, who) =>
    withRandom((random) => random.join(who, interests)),
  );
  registerHandler(socket, ctx, inFlight, 'random:leave', (_payload, who) =>
    withRandom((random) => random.leave(who)),
  );
  registerHandler(
    socket,
    ctx,
    inFlight,
    'random:message',
    (payload, who) => withRandom((random) => random.message(who, payload)),
    (who) => (who.data.guest ? RANDOM_GUEST_MESSAGE_LIMIT : undefined),
  );
  registerSignal(socket, ctx, 'random:typing', (payload, who) => {
    ctx.random?.typing(who, payload);
  });
  registerHandler(socket, ctx, inFlight, 'random:next', ({ sessionId }, who) =>
    withRandom((random) => random.next(who, sessionId)),
  );
  registerHandler(socket, ctx, inFlight, 'random:end', ({ sessionId }, who) =>
    withRandom((random) => random.end(who, sessionId)),
  );
  registerHandler(socket, ctx, inFlight, 'random:report', (payload, who) =>
    withRandom((random) => random.report(who, payload)),
  );
  registerHandler(socket, ctx, inFlight, 'random:block', ({ sessionId }, who) =>
    withRandom((random) => random.block(who, sessionId)),
  );
  registerHandler(socket, ctx, inFlight, 'random:offer', (payload, who) =>
    withRandom((random) => random.offer(who, payload, false)),
  );
  registerHandler(socket, ctx, inFlight, 'random:accept', (payload, who) =>
    withRandom((random) => random.offer(who, payload, true)),
  );
  registerHandler(socket, ctx, inFlight, 'random:resume', ({ sessionId }, who) =>
    withRandom((random) => random.resume(who, sessionId)),
  );
}
