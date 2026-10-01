#!/usr/bin/env node
// Points git at the project's hooks folder (.githooks), so the gitleaks pre-commit hook runs.
// Runs automatically after `pnpm install` (the root "prepare" script). Safe to run many times.
// Skipped in CI and outside a git checkout (for example inside a Docker build).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.CI) {
  console.log('[hooks] CI detected: not installing git hooks.');
} else if (!existsSync(join(root, '.git'))) {
  console.log('[hooks] not a git checkout: not installing git hooks.');
} else {
  const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status === 0)
    console.log('[hooks] git hooks enabled (.githooks/pre-commit runs gitleaks).');
  else
    console.warn('[hooks] could not set core.hooksPath; run: git config core.hooksPath .githooks');
}
