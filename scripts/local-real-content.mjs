#!/usr/bin/env node
/**
 * Resets the LOCAL database with the real curriculum in place of the
 * synthetic fixture, for end-to-end checks (docs/platform.md §2):
 *
 *   npm run db:real-content
 *
 * First build the seed in the private content repository, from a clean
 * checkout of the release tag (it is never committed anywhere):
 *
 *   cd ../content && node scripts/seed-supabase.mjs --release content@2026.09.1 > dist/seed.sql
 *
 * Then, under the shared database lock (scripts/with-db-lock.mjs):
 *   1. supabase db reset --sql-paths ./seed.sql --sql-paths ./seeds/10_people.sql
 *      (migrations plus the test accounts, without seeds/20_content_fixture.sql)
 *   2. runs ../content/dist/seed.sql against DATABASE_URL with node + pg
 *      (the Supabase CLI 2.118 has no `db execute`; the file is one
 *      transaction and rolls itself back on any failed assertion)
 *
 * `npm run test:db` (or any reset) puts the fixture back.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DEFAULT_DATABASE_URL, supabase, withDbLock } from './with-db-lock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = resolve(ROOT, '..', 'content', 'dist', 'seed.sql');
const DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

async function load(file) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    client.on('notice', (notice) => console.log(`[seed] ${notice.message}`));
    await client.query(readFileSync(file, 'utf8'));
    const { rows } = await client.query(
      `select r.name, r.content_hash,
              (select count(*) from content.lessons) as lessons,
              (select count(*) from content.items) as items
       from content.releases r order by r.seq desc limit 1`,
    );
    return rows[0];
  } finally {
    await client.end();
  }
}

async function main() {
  if (!existsSync(SEED)) {
    console.error(
      `${SEED} does not exist. Build it in the content repository first:\n` +
        '  cd ../content && node scripts/seed-supabase.mjs --release content@2026.09.1 > dist/seed.sql',
    );
    process.exitCode = 1;
    return;
  }
  if (!existsSync(join(ROOT, 'supabase', 'seeds', '10_people.sql'))) {
    console.error('supabase/seeds/10_people.sql is missing.');
    process.exitCode = 1;
    return;
  }
  process.exitCode = await withDbLock(async () => {
    const reset = supabase([
      'db',
      'reset',
      '--sql-paths',
      './seed.sql',
      '--sql-paths',
      './seeds/10_people.sql',
    ]);
    if (reset !== 0) return reset;
    try {
      const latest = await load(SEED);
      console.log(
        `Loaded ${SEED}: ${latest?.name ?? 'no release'} (${latest?.content_hash ?? '-'}), ` +
          `${latest?.lessons ?? 0} lessons, ${latest?.items ?? 0} items.`,
      );
      return 0;
    } catch (err) {
      console.error(`Loading ${SEED} failed: ${err.message}`);
      return 1;
    }
  });
}

await main();
