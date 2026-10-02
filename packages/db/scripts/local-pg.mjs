#!/usr/bin/env node
// A local PostgreSQL 17 server for development, with no Docker and no administrator rights.
//
// The PostgreSQL binaries come from the `embedded-postgres` npm packages (official PostgreSQL
// builds packaged per platform). Data lives in <repo>/.cache/postgres on the D: drive.
// The server listens on 127.0.0.1 only and uses "trust" authentication, which is safe here because
// nothing outside this laptop can reach it. Never use these settings on a server.
//
//   pnpm db:start    create the data folder on first run, start the server, create the database
//   pnpm db:stop     stop the server
//   pnpm db:status   show whether it is running
//
// Connection string: postgres://socketspace@127.0.0.1:54329/socketspace
// (port and database name can be changed with LOCAL_PG_PORT and LOCAL_PG_DATABASE).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const baseDir = join(repoRoot, '.cache', 'postgres', '17');
const dataDir = join(baseDir, 'data');
const logFile = join(baseDir, 'postgres.log');
const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const database = process.env.LOCAL_PG_DATABASE ?? 'socketspace';
const superuser = 'socketspace';

const PLATFORM_PACKAGES = {
  'win32-x64': '@embedded-postgres/windows-x64',
  'darwin-arm64': '@embedded-postgres/darwin-arm64',
  'darwin-x64': '@embedded-postgres/darwin-x64',
  'linux-x64': '@embedded-postgres/linux-x64',
  'linux-arm64': '@embedded-postgres/linux-arm64',
};

async function binaries() {
  const name = PLATFORM_PACKAGES[`${process.platform}-${process.arch}`];
  if (!name)
    throw new Error(`No embedded PostgreSQL build for ${process.platform}-${process.arch}.`);
  // The platform package is a dependency of embedded-postgres, so resolve it from there.
  const fromEmbedded = createRequire(createRequire(import.meta.url).resolve('embedded-postgres'));
  const entry = fromEmbedded.resolve(name);
  return import(pathToFileURL(entry).href);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

/**
 * Quotes one argument for a Windows command line, following the rules programs use to split it
 * back into arguments (CommandLineToArgvW). Backslashes are literal except just before a double
 * quote, so a run of backslashes before a quote, or before the closing quote, is doubled.
 * Example: C:\dir\ becomes "C:\dir\\", and a"b becomes "a\"b".
 */
function quoteWindowsArgument(value) {
  if (value !== '' && !/[\s"]/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/**
 * On Windows, pg_ctl starts the server with handle inheritance switched on, so the long-lived
 * server would inherit every inheritable handle this Node process holds, including the output
 * pipe to whoever started us. That pipe would then never close, and a terminal pipe or CI log
 * reading it would wait forever. PowerShell's Start-Process launches pg_ctl through
 * ShellExecute, which passes no handles on. (`Start-Process -Wait` would also wait for the
 * server, a descendant, so the script waits for pg_ctl alone with WaitForExit.)
 */
function startDetachedOnWindows(exe, args) {
  const argumentLine = args.map(quoteWindowsArgument).join(' ');
  const ps = (value) => `'${value.replace(/'/g, "''")}'`;
  const script =
    `$p = Start-Process -FilePath ${ps(exe)} -ArgumentList ${ps(argumentLine)} ` +
    '-WindowStyle Hidden -PassThru; $p.WaitForExit(); exit $p.ExitCode';
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore',
  }).status;
}

async function status() {
  const { pg_ctl } = await binaries();
  if (!existsSync(join(dataDir, 'PG_VERSION'))) return 'not-initialised';
  const result = run(pg_ctl, ['status', '-D', dataDir]);
  return result.status === 0 ? 'running' : 'stopped';
}

async function ensureDatabase() {
  const client = new pg.Client({ host: '127.0.0.1', port, user: superuser, database: 'postgres' });
  await client.connect();
  try {
    const found = await client.query('select 1 from pg_database where datname = $1', [database]);
    if (found.rowCount === 0) {
      await client.query(`CREATE DATABASE "${database}"`);
      console.log(`[db] created database "${database}"`);
    }
  } finally {
    await client.end();
  }
}

async function start() {
  const { initdb, pg_ctl } = await binaries();
  mkdirSync(baseDir, { recursive: true });

  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    console.log(`[db] initialising a new data folder in ${dataDir}`);
    const init = run(
      initdb,
      [
        '-D',
        dataDir,
        '-U',
        superuser,
        '--auth=trust',
        '--encoding=UTF8',
        '--locale=C',
        '--no-sync',
      ],
      { stdio: 'inherit' },
    );
    if (init.status !== 0) throw new Error('initdb failed');
  }

  if ((await status()) === 'running') {
    console.log('[db] already running');
  } else {
    // `pg_ctl start` launches the server in the background and returns once it accepts connections.
    const options = `-p ${String(port)} -c listen_addresses=127.0.0.1 -c max_connections=50`;
    const args = ['start', '-D', dataDir, '-l', logFile, '-w', '-t', '60', '-o', options];
    const exitCode =
      process.platform === 'win32'
        ? startDetachedOnWindows(pg_ctl, args)
        : run(pg_ctl, args, { stdio: 'ignore' }).status;
    if (exitCode !== 0) throw new Error(`pg_ctl start failed; see ${logFile}`);
  }

  await ensureDatabase();
  console.log(`[db] ready: postgres://${superuser}@127.0.0.1:${String(port)}/${database}`);
}

async function stop() {
  const { pg_ctl } = await binaries();
  if ((await status()) !== 'running') {
    console.log('[db] not running');
    return;
  }
  const stopped = run(pg_ctl, ['stop', '-D', dataDir, '-m', 'fast', '-w'], { stdio: 'inherit' });
  if (stopped.status !== 0) throw new Error('pg_ctl stop failed');
}

const command = process.argv[2];
try {
  if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else if (command === 'status') console.log(`[db] ${await status()}`);
  else {
    console.error('Usage: node scripts/local-pg.mjs <start|stop|status>');
    process.exit(2);
  }
} catch (error) {
  console.error(`[db] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
