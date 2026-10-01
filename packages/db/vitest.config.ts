import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'db',
    // Each test file starts its own PGlite database and applies every migration (a second or two).
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
