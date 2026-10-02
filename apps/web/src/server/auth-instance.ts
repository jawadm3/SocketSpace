/**
 * The app's single Better Auth instance, wired to the real database, email driver and realtime
 * notifier. Created on first use (not at import), because `next build` imports this module
 * without the runtime environment.
 */
import 'server-only';

import { after } from 'next/server';

import { createAuth, type Auth } from './auth';
import { getDb } from './db';
import { createEmailSender } from './email';
import { getWebEnv } from './env';
import { getLogger } from './logger-instance';
import { createRealtimeNotifier } from './realtime-events';

let instance: Auth | undefined;

export function getAuth(): Auth {
  if (!instance) {
    const env = getWebEnv();
    const db = getDb();
    const logger = getLogger();
    instance = createAuth({
      db,
      env,
      logger,
      email: createEmailSender({
        driver: env.EMAIL_DRIVER,
        from: env.EMAIL_FROM,
        resendApiKey: env.RESEND_API_KEY,
        devMailDir: env.DEV_MAIL_DIR,
      }),
      notifier: createRealtimeNotifier({
        url: env.REALTIME_INTERNAL_URL ?? env.REALTIME_PUBLIC_URL,
        secret: env.INTERNAL_EVENTS_SECRET,
        db,
        logger,
      }),
      // Next.js runs `after` callbacks once the response has been sent (on Vercel too).
      defer: (task) => {
        after(task);
      },
    });
  }
  return instance;
}
