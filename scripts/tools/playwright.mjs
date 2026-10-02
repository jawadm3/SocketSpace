#!/usr/bin/env node
// Runs the Playwright command line with its browsers stored in <repo>/.cache/ms-playwright
// (on the D: drive, inside the project) instead of the user's profile on C:.
//
// Usage (from a package that depends on @playwright/test):
//   node ../../scripts/tools/playwright.mjs install chromium
//   node ../../scripts/tools/playwright.mjs test
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(root, '.cache', 'ms-playwright');

// Resolve the CLI from the package we are run in, so its own @playwright/test version is used.
const require = createRequire(join(process.cwd(), 'package.json'));
const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
});
process.exit(result.status ?? 1);
