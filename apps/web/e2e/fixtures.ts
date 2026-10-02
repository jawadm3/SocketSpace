/**
 * Every test (and every extra "device" a test opens) appears to come from its own IP address,
 * like real people on different networks. Without this, all tests would share one address and
 * trip each other's sign-in rate limits (3 per 10 seconds per IP), which work as designed.
 *
 * Addresses come from 203.0.113.0/24, a range reserved for documentation (RFC 5737).
 */
import { test as base, type Browser, type BrowserContext } from '@playwright/test';

let next = 0;

export function freshIp(): string {
  next += 1;
  return `203.0.113.${String((next % 250) + 1)}`;
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
