#!/usr/bin/env node
/**
 * Runs database work under a cross-worktree lock, because every worktree
 * and agent shares ONE local Supabase stack (docs/platform.md §2).
 *
 *   npm run test:db
 *     = node scripts/with-db-lock.mjs
 *     -> under the lock: `supabase db reset` (this worktree's migrations and
 *        seeds), then `node --test --test-concurrency=1 tests/db/*.test.mjs`
 *
 *   node scripts/with-db-lock.mjs <command...>
 *     -> under the lock: runs <command...> instead (through the shell)
 *
 * The lock is a directory, os.tmpdir()/polilingo-db-lock, created with
 * mkdir (atomic on every OS). The holder refreshes its timestamp every
 * minute; a lock not refreshed for 10 minutes is stale and taken over. A
 * waiter gives up after 20 minutes. The lock is always released, including
 * on Ctrl+C, and the exit code of the failing step is passed through.
 *
 * DATABASE_URL defaults to the local stack,
 * postgresql://postgres:postgres@127.0.0.1:54322/postgres.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LOCK_DIR = join(tmpdir(), 'polilingo-db-lock');
const STALE_MS = 10 * 60 * 1000;
const WAIT_MS = 20 * 60 * 1000;
const POLL_MS = 2000;
const REPORT_MS = 30 * 1000;
const HEARTBEAT_MS = 60 * 1000;

export const DEFAULT_DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function describeHolder() {
  try {
    const owner = JSON.parse(
      readFileSync(join(LOCK_DIR, 'owner.json'), 'utf8'),
    );
    return `pid ${owner.pid} in ${owner.cwd}, since ${owner.startedAt}`;
  } catch {
    return 'an unknown process';
  }
}

/** Takes the lock, waiting up to 20 minutes. Returns a release function. */
export async function acquireLock() {
  const started = Date.now();
  let lastReport = 0;
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      writeFileSync(
        join(LOCK_DIR, 'owner.json'),
        JSON.stringify({
          pid: process.pid,
          cwd: process.cwd(),
          startedAt: new Date().toISOString(),
        }),
      );
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let age = 0;
    try {
      age = Date.now() - statSync(LOCK_DIR).mtimeMs;
    } catch {
      continue; // released between mkdir and stat: try again at once
    }
    if (age > STALE_MS) {
      console.error(
        `[db-lock] Taking over a stale lock (${Math.round(age / 60000)} min old, held by ${describeHolder()}).`,
      );
      rmSync(LOCK_DIR, { recursive: true, force: true });
      continue;
    }
    const waited = Date.now() - started;
    if (waited > WAIT_MS) {
      throw new Error(
        `[db-lock] Gave up after 20 minutes: the local database is still locked by ${describeHolder()}. ` +
          `If nothing is running, delete ${LOCK_DIR}.`,
      );
    }
    if (Date.now() - lastReport >= REPORT_MS) {
      lastReport = Date.now();
      console.error(
        `[db-lock] Waiting for the local database (held by ${describeHolder()}); ${Math.round(waited / 1000)}s so far.`,
      );
    }
    await sleep(POLL_MS);
  }

  const heartbeat = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(LOCK_DIR, now, now);
    } catch {
      // The lock was taken over or removed; the release below is then a no-op.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    try {
      const owner = JSON.parse(
        readFileSync(join(LOCK_DIR, 'owner.json'), 'utf8'),
      );
      if (owner.pid !== process.pid) return; // someone took over a stale lock
    } catch {
      // No owner file: remove the directory anyway, it is ours.
    }
    rmSync(LOCK_DIR, { recursive: true, force: true });
  };
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      release();
      process.exit(130);
    });
  }
  return release;
}

/** Runs fn() while holding the lock, and always releases it. */
export async function withDbLock(fn) {
  const release = await acquireLock();
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * The Supabase CLI of this repository (the `supabase` devDependency), run
 * with node directly so no shell is needed; `npx supabase` otherwise.
 */
export function supabaseCli(cwd = ROOT) {
  const local = join(cwd, 'node_modules', 'supabase', 'dist', 'supabase.js');
  if (existsSync(local)) return { command: process.execPath, prefix: [local] };
  return { command: 'npx', prefix: ['supabase'], shell: true };
}

/** Runs a command with inherited stdio and returns its exit status. */
export function run(command, args, { shell = false, env } = {}) {
  const shown = [command === process.execPath ? 'node' : command, ...args].join(
    ' ',
  );
  console.error(`[db-lock] $ ${shown}`);
  const result = shell
    ? spawnSync([command, ...args].join(' '), {
        stdio: 'inherit',
        shell: true,
        env: env ?? process.env,
      })
    : spawnSync(command, args, { stdio: 'inherit', env: env ?? process.env });
  if (result.error) {
    console.error(`[db-lock] Could not run ${shown}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/** `supabase <args>` in this repository. */
export function supabase(args, options) {
  const cli = supabaseCli();
  return run(cli.command, [...cli.prefix, ...args], {
    shell: cli.shell,
    ...options,
  });
}

/** Quotes one argument for the shell when it holds spaces or quotes. */
function quote(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

async function main(argv) {
  const env = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  };
  const status = await withDbLock(async () => {
    if (argv.length > 0) {
      return run(argv.map(quote).join(' '), [], { shell: true, env });
    }
    const reset = supabase(['db', 'reset'], { env });
    if (reset !== 0) return reset;
    return run(
      process.execPath,
      ['--test', '--test-concurrency=1', 'tests/db/*.test.mjs'],
      { env },
    );
  });
  process.exitCode = status;
}

const invoked = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
