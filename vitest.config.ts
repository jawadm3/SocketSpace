import { defineConfig } from 'vitest/config';

// Runs every v2 package's tests from the repository root (for example with coverage in CI).
// v1/ is never included: only apps/* and packages/* are listed.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
    exclude: ['**/node_modules/**', '**/dist/**', 'v1/**'],
  },
});
