#!/usr/bin/env node
// Bundles the realtime server and all of its dependencies into one file, dist/server.mjs.
// The Docker image then needs only Node.js and that file: no node_modules, a small attack surface
// and a fast start.
//
// Optional native add-ons that the bundled libraries try to load when present (pg-native, the
// WebSocket speed-ups bufferutil and utf-8-validate) are left out; the libraries fall back to
// their pure JavaScript versions.
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'dist');
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src', 'server.ts')],
  outfile: join(outdir, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  minify: false,
  legalComments: 'linked',
  external: ['pg-native', 'bufferutil', 'utf-8-validate'],
  // Bundled CommonJS libraries call require(); give ES modules a require() that works.
  banner: {
    js: "import { createRequire as __ssCreateRequire } from 'node:module'; const require = __ssCreateRequire(import.meta.url);",
  },
  metafile: true,
  logLevel: 'warning',
});

const bytes = statSync(join(outdir, 'server.mjs')).size;
const inputs = Object.keys(result.metafile.inputs).length;
console.log(
  `[build] dist/server.mjs: ${(bytes / 1024).toFixed(0)} KB from ${String(inputs)} source files`,
);
