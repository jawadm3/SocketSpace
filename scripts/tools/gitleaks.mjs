#!/usr/bin/env node
// Runs gitleaks (a secret scanner) from a pinned, checksum-verified release.
//
// The binary is downloaded once into .cache/tools/ (inside the project, on the D: drive) and reused.
// The SHA-256 hashes below were copied from the official gitleaks_8.30.1_checksums.txt release file
// on 2026-10-02 and are compared before anything is unpacked, so a tampered download is refused.
//
// Usage: node scripts/tools/gitleaks.mjs <gitleaks arguments>
//   e.g. node scripts/tools/gitleaks.mjs git --redact -v .
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '8.30.1';
const ASSETS = {
  'win32-x64': {
    file: `gitleaks_${VERSION}_windows_x64.zip`,
    sha256: 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
  },
  'win32-arm64': {
    file: `gitleaks_${VERSION}_windows_arm64.zip`,
    sha256: 'b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f',
  },
  'linux-x64': {
    file: `gitleaks_${VERSION}_linux_x64.tar.gz`,
    sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  },
  'linux-arm64': {
    file: `gitleaks_${VERSION}_linux_arm64.tar.gz`,
    sha256: 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
  },
  'darwin-x64': {
    file: `gitleaks_${VERSION}_darwin_x64.tar.gz`,
    sha256: 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  },
  'darwin-arm64': {
    file: `gitleaks_${VERSION}_darwin_arm64.tar.gz`,
    sha256: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  },
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const toolsDir = join(root, '.cache', 'tools');
const installDir = join(toolsDir, `gitleaks-${VERSION}`);
const exe = join(installDir, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');

// GitHub's download host sometimes drops a connection; retry a few times with growing pauses.
async function download(url, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      console.error(`[gitleaks] downloading ${url} (attempt ${attempt})`);
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= attempts)
        throw new Error(`Download failed after ${attempts} attempts`, { cause: error });
      await new Promise((done) => setTimeout(done, attempt * 2000));
    }
  }
}

async function install() {
  const key = `${process.platform}-${process.arch}`;
  const asset = ASSETS[key];
  if (!asset) {
    throw new Error(`No pinned gitleaks build for ${key}. Add one to scripts/tools/gitleaks.mjs.`);
  }
  const downloads = join(toolsDir, 'downloads');
  mkdirSync(downloads, { recursive: true });
  const archive = join(downloads, asset.file);

  if (!existsSync(archive)) {
    const url = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${asset.file}`;
    writeFileSync(archive, await download(url));
  }

  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (actual !== asset.sha256) {
    throw new Error(
      `Checksum mismatch for ${asset.file}: expected ${asset.sha256}, got ${actual}. Refusing to run it.`,
    );
  }

  mkdirSync(installDir, { recursive: true });
  // Windows 10+ ships bsdtar as System32\tar.exe, which can unpack .zip files.
  // Git Bash's GNU tar cannot, so call the system one explicitly on Windows.
  const tar =
    process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  const binary = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
  const result = spawnSync(tar, ['-xf', archive, '-C', installDir, binary], { stdio: 'inherit' });
  if (result.status !== 0 || !existsSync(exe)) {
    throw new Error(`Could not unpack ${asset.file} with ${tar}.`);
  }
  console.error(`[gitleaks] installed ${VERSION} at ${installDir}`);
}

if (!existsSync(exe)) {
  await install();
}

const run = spawnSync(exe, process.argv.slice(2), { stdio: 'inherit', cwd: root });
process.exit(run.status ?? 1);
