/**
 * End-to-end tests: a real browser (Chromium locally, to spare RAM; the full matrix runs in CI)
 * against a production build of the web app (`next start`), backed by a fresh database.
 *
 * Before running locally: `pnpm db:start` (local PostgreSQL) and `pnpm build` (web app and the
 * bundled realtime server).
 * Run with `pnpm --filter @socketspace/web e2e`.
 *
 * Every value below is a test-only placeholder for this throwaway setup, not a real secret.
 */
import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${String(port)}`;
const realtimePort = Number(process.env.E2E_REALTIME_PORT ?? 4100);
// 127.0.0.1, not localhost: the realtime server binds IPv4, and localhost may resolve to ::1 first.
const realtimeURL = `http://127.0.0.1:${String(realtimePort)}`;
const internalSecret = 'y'.repeat(48);

export const E2E = {
  baseURL,
  realtimeURL,
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
  webServer: [
    {
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
        REALTIME_PUBLIC_URL: realtimeURL,
        INTERNAL_EVENTS_SECRET: internalSecret,
        EMAIL_DRIVER: 'file',
        DEV_MAIL_DIR: E2E.mailDir,
        // The breached-password check needs a third-party service; it is covered by integration
        // tests with a stub instead, so these runs do not depend on someone else's uptime.
        HIBP_ENABLED: 'false',
        LOG_LEVEL: 'warn',
      },
    },
    {
      // The bundled realtime server, exactly as it runs in Docker.
      command: 'node ../realtime/dist/server.mjs',
      url: `${realtimeURL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'production',
        PORT: String(realtimePort),
        HOST: '127.0.0.1',
        DATABASE_URL: E2E.databaseUrl,
        WEB_ORIGINS: baseURL,
        AUTH_JWKS_URL: `${baseURL}/api/auth/jwks`,
        AUTH_ISSUER: baseURL,
        INTERNAL_EVENTS_SECRET: internalSecret,
        METRICS_TOKEN: 'z'.repeat(32),
        LOG_LEVEL: 'warn',
        // Like Render's proxy in production: each test "device" sends its own X-Forwarded-For
        // (e2e/fixtures.ts), so per-IP connection limits apply per device, not to 127.0.0.1.
        TRUST_PROXY_HOPS: '1',
      },
    },
  ],
});
