#!/usr/bin/env node
// Fails if a source file contains invisible or direction-changing characters written literally.
//
// Such characters can make code display differently from how it runs ("Trojan Source",
// CVE-2021-42574), and they are easy to introduce by accident when copying text. Write them as
// escapes instead (for example "\u202E"). The zero-width joiner (U+200D) is allowed because emoji
// sequences need it.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['apps', 'packages', 'scripts'];
const EXTENSIONS = /\.(?:[cm]?[jt]sx?|json|css|sql)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', 'coverage']);
// Controls (except tab, LF, CR), bidi marks/overrides/isolates, zero-width spaces, BOM,
// and combining marks on their own (they silently change the letter before them).
/* eslint-disable no-control-regex, no-misleading-character-class -- these characters are what we look for */
const FORBIDDEN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u061C\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u0300-\u036F]/g;
/* eslint-enable no-control-regex, no-misleading-character-class */

const problems = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (EXTENSIONS.test(entry.name)) check(path);
  }
}

function check(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const found = line.match(FORBIDDEN);
    if (found) {
      const codes = found.map(
        (c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
      );
      problems.push(`${relative(root, path)}:${String(index + 1)}  ${codes.join(' ')}`);
    }
  });
}

for (const dir of ROOTS) walk(join(root, dir));

if (problems.length > 0) {
  console.error('Invisible or bidi characters found (write them as \\uXXXX escapes):');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('[source-chars] no invisible or bidi characters in source files');
