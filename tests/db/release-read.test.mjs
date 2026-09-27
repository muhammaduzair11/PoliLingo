// Track G: public.get_learner_release (docs/platform.md 3.9 G, 4.7). Needs a
// database with the migrations and seeds applied: `npm run test:db` (local
// stack, under the lock) or `npm run test:db:ci`. Every test runs in a
// rolled-back transaction.
//
// The function raises no refusal codes: whatever goes wrong, a learner keeps
// the content they have. So these tests pin its three answers, who may call
// it, and that what it hands anon is a learner copy the app accepts.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  learnerContentHash,
  verifyLearnerCopy,
} from '../../lib/release-verify.ts';
import {
  as,
  asAnon,
  asPostgres,
  expectCode,
  one,
  tx,
  user,
  value,
} from './helpers.mjs';

const CALL = 'select public.get_learner_release($1) as r';

async function latest(client) {
  await asPostgres(client);
  return one(
    client,
    'select name, content_hash, payload from content.releases order by seq desc limit 1',
  );
}

async function call(client, known = null) {
  return value(client, CALL, [known]);
}

/**
 * Appends a release as the migration role, as publish_release (F) would:
 * the latest payload with one lesson title changed, under the next name.
 */
async function publishEdited(client, name) {
  const base = await latest(client);
  const payload = structuredClone(base.payload);
  payload.courses[0].units[0].lessons[0].title = 'A retitled lesson';
  payload.release = name;
  payload.contentHash = learnerContentHash(payload);
  await client.query(
    `insert into content.releases (name, kind, content_hash, payload, published_by, note)
     values ($1, 'publish', $2, $3, null, 'A database test release')`,
    [name, payload.contentHash, payload],
  );
  return payload;
}

describe('get_learner_release', () => {
  test('anon may call it, and it answers with the latest release in full', () =>
    tx(async (client) => {
      const row = await latest(client);
      assert.ok(row, 'the fixture seed holds a release');
      await asAnon(client);
      const answer = await call(client);
      assert.deepEqual(Object.keys(answer).sort(), [
        'contentHash',
        'payload',
        'release',
      ]);
      assert.equal(answer.release, row.name);
      assert.equal(answer.contentHash, row.content_hash);
      assert.deepEqual(answer.payload, row.payload);
      // What anon receives is a learner copy the app would show.
      const verified = verifyLearnerCopy(answer.payload);
      assert.equal(verified.ok, true, verified.reason);
      assert.equal(answer.payload.release, answer.release);
      assert.equal(answer.payload.contentHash, answer.contentHash);
    }));

  test('a signed-in learner may call it too', () =>
    tx(async (client) => {
      const row = await latest(client);
      const learner = await user(client);
      await as(client, learner);
      const answer = await call(client);
      assert.equal(answer.release, row.name);
      assert.equal(answer.contentHash, row.content_hash);
    }));

  test('the argument defaults to null: no hash means the full copy', () =>
    tx(async (client) => {
      const row = await latest(client);
      await asAnon(client);
      const answer = await value(
        client,
        'select public.get_learner_release() as r',
      );
      assert.equal(answer.release, row.name);
      assert.deepEqual(answer.payload, row.payload);
    }));

  test('a caller that has the latest release is told it is unchanged, without the payload', () =>
    tx(async (client) => {
      const row = await latest(client);
      await asAnon(client);
      assert.deepEqual(await call(client, row.content_hash), {
        release: row.name,
        contentHash: row.content_hash,
        unchanged: true,
      });
    }));

  test('a caller with another hash, or rubbish, gets the full copy', () =>
    tx(async (client) => {
      const row = await latest(client);
      await asAnon(client);
      for (const known of [
        `sha256-${'0'.repeat(64)}`,
        '',
        'not a hash',
        row.content_hash.toUpperCase(),
      ]) {
        const answer = await call(client, known);
        assert.equal(answer.unchanged, undefined, JSON.stringify(known));
        assert.equal(answer.contentHash, row.content_hash);
        assert.deepEqual(answer.payload, row.payload);
      }
    }));

  test('it follows the newest release, including a rollback to older content', () =>
    tx(async (client) => {
      const seeded = await latest(client);
      const published = await publishEdited(client, 'content@2026.09.2');

      await asAnon(client);
      const answer = await call(client, seeded.content_hash);
      assert.equal(answer.release, 'content@2026.09.2');
      assert.equal(answer.contentHash, published.contentHash);
      assert.deepEqual(answer.payload, published);
      assert.equal(verifyLearnerCopy(answer.payload).ok, true);
      assert.deepEqual(await call(client, published.contentHash), {
        release: 'content@2026.09.2',
        contentHash: published.contentHash,
        unchanged: true,
      });

      // A rollback is a new release carrying an older payload: learners
      // who have the edited copy are sent the seeded content again.
      await asPostgres(client);
      const rolledBack = {
        ...seeded.payload,
        release: 'content@2026.09.3',
      };
      await client.query(
        `insert into content.releases (name, kind, content_hash, payload, note)
         values ('content@2026.09.3', 'rollback', $1, $2, 'Back to the seed')`,
        [seeded.content_hash, rolledBack],
      );
      await asAnon(client);
      const back = await call(client, published.contentHash);
      assert.equal(back.release, 'content@2026.09.3');
      assert.equal(back.contentHash, seeded.content_hash);
      assert.deepEqual(back.payload, rolledBack);
    }));

  test('the overlay kill switch makes it answer null for everyone', () =>
    tx(async (client) => {
      const row = await latest(client);
      await client.query(
        "update private.app_settings set value = 'false'::jsonb where key = 'overlay_enabled'",
      );
      await asAnon(client);
      assert.equal(await call(client), null);
      assert.equal(await call(client, row.content_hash), null);
      const learner = await user(client);
      await as(client, learner);
      assert.equal(await call(client), null);

      // A missing setting is off too (private.setting_on).
      await asPostgres(client);
      await client.query(
        "delete from private.app_settings where key = 'overlay_enabled'",
      );
      await asAnon(client);
      assert.equal(await call(client), null);

      // Switched back on, the latest release is served again.
      await asPostgres(client);
      await client.query(
        "insert into private.app_settings (key, value) values ('overlay_enabled', 'true'::jsonb)",
      );
      await asAnon(client);
      assert.equal((await call(client)).release, row.name);
    }));

  test('it is a stable SECURITY DEFINER function with a pinned search_path, executable by anon and authenticated only', () =>
    tx(async (client) => {
      const fn = await one(
        client,
        `select p.prosecdef, p.provolatile, p.proconfig,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                exists (
                  select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE'
                ) as public
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'get_learner_release'`,
      );
      assert.equal(fn.prosecdef, true);
      assert.equal(fn.provolatile, 's');
      assert.deepEqual(fn.proconfig, ['search_path=""']);
      assert.equal(fn.anon, true);
      assert.equal(fn.authenticated, true);
      assert.equal(fn.public, false);
    }));

  test('anon still reads no release table directly', () =>
    tx(async (client) => {
      await asAnon(client);
      await expectCode(
        client.query('select 1 from content.releases limit 1'),
        '42501',
      );
      await expectCode(
        client.query('select 1 from private.app_settings limit 1'),
        '42501',
      );
    }));
});
