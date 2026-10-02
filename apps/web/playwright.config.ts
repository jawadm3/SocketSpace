/**
 * End-to-end tests: a real browser (Chromium locally, to spare RAM; the full matrix runs in CI)
 * against a production build of the web app (`next start`), backed by a fresh database.
 *
 * Before running locally: `pnpm db:start` (local PostgreSQL), `pnpm --filter @socketspace/web build`.
 * Run with `pnpm --filter @socketspace/web e2e`.
 *
 * Every value below is a test-only placeholder for this throwaway setup, not a real secret.
 */
import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${String(port)}`;

export const E2E = {
  baseURL,
  databaseUrl:
    process.env.E2E_DATABASE_URL ?? 'postgres://socketspace@127.0.0.1:54329/socketspace_e2e',
  adminDatabaseUrl:
    process.env.E2E_DATABASE_ADMIN_URL ?? 'postgres://socketspace@127.0.0.1:54329/postgres',
  mailDir: resolve(repoRoot, '.cache', 'e2e-mail'),
};

export default defineConfig({
  testDir: './e2e',
  // One server, one database: run serially and predictably.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './e2e/global-setup.ts',
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm start',
    url: `${baseURL}/sign-in`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(port),
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      DATABASE_URL: E2E.databaseUrl,
      BETTER_AUTH_SECRET: 'x'.repeat(48),
      BETTER_AUTH_URL: baseURL,
      REALTIME_PUBLIC_URL: 'http://localhost:4100',
      INTERNAL_EVENTS_SECRET: 'y'.repeat(48),
      EMAIL_DRIVER: 'file',
      DEV_MAIL_DIR: E2E.mailDir,
      // The breached-password check needs a third-party service; it is covered by integration
      // tests with a stub instead, so these runs do not depend on someone else's uptime.
      HIBP_ENABLED: 'false',
      LOG_LEVEL: 'warn',
    },
  },
});
