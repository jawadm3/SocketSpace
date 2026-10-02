/**
 * Tells the realtime server about changes it must act on immediately, for example "this session
 * was signed out: disconnect its sockets" (realtime-protocol.md, "Internal events").
 *
 * Each event is signed with HMAC-SHA256 and sent up to 3 times with short pauses. If every attempt
 * fails (for example the free realtime server is asleep), the event is stored in
 * `realtime_outbox`, which the realtime server drains when it starts.
 */
import 'server-only';

import { newId, schema, type Database } from '@socketspace/db';
import {
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  signInternalRequest,
  type InternalEvent,
} from '@socketspace/shared/internal-events';

import type { Logger } from './log';

/** An internal event without the `id` and `at` fields, which are filled in when it is sent. */
export type InternalEventInput = InternalEvent extends infer E
  ? E extends InternalEvent
    ? Omit<E, 'id' | 'at'>
    : never
  : never;

export interface RealtimeNotifier {
  notify(event: InternalEventInput): Promise<void>;
}

export interface NotifierOptions {
  /** Base URL of the realtime server, for example https://socketspace-rt.onrender.com */
  url: string;
  secret: string;
  db: Database;
  logger: Logger;
  fetchImpl?: typeof fetch;
  attempts?: number;
}

export function createRealtimeNotifier(options: NotifierOptions): RealtimeNotifier {
  const fetchImpl = options.fetchImpl ?? fetch;
  const attempts = options.attempts ?? 3;
  const endpoint = `${options.url}/internal/events`;

  return {
    async notify(input) {
      const event = { id: newId(), at: new Date().toISOString(), ...input };
      const body = JSON.stringify(event);
      let lastError = 'unknown';
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const timestamp = String(Date.now());
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              [INTERNAL_TIMESTAMP_HEADER]: timestamp,
              [INTERNAL_SIGNATURE_HEADER]: await signInternalRequest(
                options.secret,
                timestamp,
                body,
              ),
            },
            body,
            signal: AbortSignal.timeout(3000),
          });
          if (response.ok) return;
          lastError = `HTTP ${String(response.status)}`;
          // A 4xx other than 429 will not get better by retrying.
          if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
        } catch (error) {
          lastError = error instanceof Error ? error.name : 'error';
        }
        if (attempt < attempts) await new Promise((done) => setTimeout(done, 200 * attempt));
      }

      options.logger.warn('realtime event not delivered; stored in outbox', {
        type: event.type,
        eventId: event.id,
        lastError,
      });
      await options.db.insert(schema.realtimeOutbox).values({
        eventId: event.id,
        type: event.type,
        payload: event,
        attempts,
        lastError,
      });
    },
  };
}

/** For tests and local runs without a realtime server: remembers events instead of sending. */
export class RecordingNotifier implements RealtimeNotifier {
  readonly events: InternalEventInput[] = [];

  notify(event: InternalEventInput): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}
