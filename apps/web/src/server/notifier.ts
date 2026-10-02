/**
 * The web app's one realtime notifier: how server actions tell the realtime server that something
 * changed (realtime-protocol.md, "Internal events"). Created on first use.
 */
import 'server-only';

import { getDb } from './db';
import { getWebEnv } from './env';
import { getLogger } from './logger-instance';
import { createRealtimeNotifier, type RealtimeNotifier } from './realtime-events';

let notifier: RealtimeNotifier | undefined;

export function getNotifier(): RealtimeNotifier {
  if (!notifier) {
    const env = getWebEnv();
    notifier = createRealtimeNotifier({
      url: env.REALTIME_INTERNAL_URL ?? env.REALTIME_PUBLIC_URL,
      secret: env.INTERNAL_EVENTS_SECRET,
      db: getDb(),
      logger: getLogger(),
    });
  }
  return notifier;
}
