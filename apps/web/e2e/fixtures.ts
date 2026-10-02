/**
 * Every test (and every extra "device" a test opens) appears to come from its own IP address,
 * like real people on different networks. Without this, all tests would share one address and
 * trip each other's sign-in rate limits (3 per 10 seconds per IP), which work as designed.
 *
 * Addresses come from the three ranges reserved for documentation (RFC 5737). The counter lives
 * on `globalThis`, so it keeps counting across test files in the same run (a module-level counter
 * restarted per file, and files then shared addresses and each other's limits).
 */
import { test as base, type Browser, type BrowserContext } from '@playwright/test';

const RANGES = ['203.0.113', '198.51.100', '192.0.2'];
const counter = globalThis as { e2eNextIp?: number };

export function freshIp(): string {
  const next = (counter.e2eNextIp ?? 0) + 1;
  counter.e2eNextIp = next;
  const range = RANGES[Math.floor(next / 250) % RANGES.length] ?? RANGES[0];
  return `${String(range)}.${String((next % 250) + 1)}`;
}

/** A separate browser profile (cookies, storage) on its own IP: another device. */
export function newDevice(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': freshIp() } });
}

export const test = base.extend({
  context: async ({ browser }, use) => {
    const context = await newDevice(browser);
    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';
