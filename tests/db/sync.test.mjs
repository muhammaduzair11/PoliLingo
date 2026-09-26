// Progress sync in the database (docs/platform.md §3.7, §3.9 B):
// import_local_progress, get_my_progress and their private helpers. Every
// refusal is called directly. Every test runs in a rolled-back transaction.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { buildEnvelope, envelopeKey } from '../../lib/sync.ts';
import { initialState } from '../../lib/progress.ts';
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

/** A polilingo.sync@1 envelope with sensible defaults. */
function envelope(fields = {}) {
  return {
    format: 'polilingo.sync@1',
    deviceId: 'device-phone',
    localDate: '2026-09-27',
    xp: 0,
    completed: {},
    activity: {},
    rewarded: [],
    dailyGoal: null,
    selected: null,
    ...fields,
  };
}

/** A device's envelope after first clears of `lessons`, one session each. */
function played(deviceId, lessons, day = '2026-09-27') {
  const rewarded = lessons.map((l) => `${deviceId}-${l}`);
  return envelope({
    deviceId,
    xp: 20 * lessons.length,
    completed: Object.fromEntries(lessons.map((l) => [l, 'content@2026.09.1'])),
    activity: lessons.length ? { [day]: lessons.length } : {},
    rewarded,
  });
}

async function importAs(client, env) {
  return value(client, 'select public.import_local_progress($1::jsonb)', [
    typeof env === 'string' ? env : JSON.stringify(env),
  ]);
}

async function progress(client) {
  return value(client, 'select public.get_my_progress()');
}

/** The state without the import's own fields. */
function stateOf(result) {
  const { applied: _applied, envelope_hash: _hash, ...state } = result;
  return state;
}

async function signedIn(client, options) {
  const u = await user(client, options);
  await as(client, u);
  return u;
}

describe('import_local_progress', () => {
  test('an import merges the envelope and returns the whole state', () =>
    tx(async (client) => {
      await signedIn(client);
      const env = envelope({
        xp: 45,
        completed: {
          'ps-lsn-0a41c2': 'content@2026.09.1',
          'ps-lsn-0b52d3': 'mvp',
        },
        activity: { '2026-09-26': 1, '2026-09-27': 2 },
        rewarded: ['s-1', 's-2', 's-3'],
        dailyGoal: 2,
        selected: 'pashto',
      });
      const r = await importAs(client, env);
      assert.equal(r.applied, true);
      assert.match(r.envelope_hash, /^[0-9a-f]{64}$/);
      assert.deepEqual(stateOf(r), {
        xp: 45,
        completed: {
          'ps-lsn-0a41c2': 'content@2026.09.1',
          'ps-lsn-0b52d3': 'mvp',
        },
        activity: { '2026-09-26': 1, '2026-09-27': 2 },
        rewarded: ['s-1', 's-2', 's-3'],
        dailyGoal: 2,
        selected: 'pashto',
      });
      assert.deepEqual(await progress(client), stateOf(r));
      // The ledger: 15 per lesson, 5 per session, amounts from the server.
      await asPostgres(client);
      const awards = await client.query(
        `select award_key, amount from public.xp_awards
         where user_id = (select user_id from public.progress_imports where envelope_hash = $1)
         order by award_key collate "C"`,
        [r.envelope_hash],
      );
      assert.deepEqual(
        awards.rows.map((a) => [a.award_key, Number(a.amount)]),
        [
          ['lesson:ps-lsn-0a41c2', 15],
          ['lesson:ps-lsn-0b52d3', 15],
          ['session:s-1', 5],
          ['session:s-2', 5],
          ['session:s-3', 5],
        ],
      );
    }));

  test("the envelope's hash is the device's envelopeKey()", () =>
    tx(async (client) => {
      await signedIn(client);
      const env = buildEnvelope(
        {
          ...initialState('device-hash'),
          xp: 25,
          completed: { 'ps-lsn-0a41c2': 'content@2026.09.1' },
          activity: { '2026-09-27': 1 },
          rewarded: ['9b0c1a4e-5f7d-4c3b-8a2e-1d6f0e9c8b7a', 'second'],
          selected: 'pashto',
          dailyGoal: 2,
        },
        '2026-09-27',
      );
      const r = await importAs(client, env);
      assert.equal(r.envelope_hash, envelopeKey(env));
    }));

  test('replaying the same envelope is a no-op', () =>
    tx(async (client) => {
      await signedIn(client);
      const env = played('device-phone', ['ps-lsn-0a41c2', 'ps-lsn-0b52d3']);
      const first = await importAs(client, env);
      const second = await importAs(client, env);
      assert.equal(first.applied, true);
      assert.equal(second.applied, false);
      assert.equal(second.envelope_hash, first.envelope_hash);
      assert.deepEqual(stateOf(second), stateOf(first));
      // Key order does not change the hash: the same progress is the same envelope.
      const reordered = JSON.stringify(
        Object.fromEntries(Object.entries(env).reverse()),
      );
      const third = await importAs(client, reordered);
      assert.equal(third.applied, false);
      await asPostgres(client);
      assert.equal(
        Number(
          await value(
            client,
            'select count(*) from public.progress_imports where envelope_hash = $1',
            [first.envelope_hash],
          ),
        ),
        1,
      );
    }));

  test('two devices with different lessons converge, and XP sums correctly', () =>
    tx(async (client) => {
      await signedIn(client);
      const phone = await importAs(
        client,
        played('device-phone', ['ps-lsn-0a41c2']),
      );
      assert.equal(phone.xp, 20);
      const laptop = await importAs(
        client,
        played(
          'device-laptop',
          ['ps-lsn-0b52d3', 'ur-lsn-0c63e4'],
          '2026-09-26',
        ),
      );
      // 3 lessons x 15 + 3 sessions x 5.
      assert.equal(laptop.xp, 60);
      assert.deepEqual(Object.keys(laptop.completed).sort(), [
        'ps-lsn-0a41c2',
        'ps-lsn-0b52d3',
        'ur-lsn-0c63e4',
      ]);
      assert.deepEqual(laptop.activity, { '2026-09-26': 2, '2026-09-27': 1 });
      assert.equal(laptop.rewarded.length, 3);
      // The phone syncs again with what it has now: same state for both.
      const phoneAgain = await importAs(
        client,
        played('device-phone', ['ps-lsn-0a41c2'], '2026-09-27'),
      );
      assert.deepEqual(stateOf(phoneAgain), stateOf(laptop));
    }));

  test('the same lesson first completed on two devices counts one first clear', () =>
    tx(async (client) => {
      await signedIn(client);
      await importAs(client, played('device-phone', ['ps-lsn-0a41c2']));
      const r = await importAs(
        client,
        played('device-laptop', ['ps-lsn-0a41c2']),
      );
      // 15 for the lesson + 5 + 5 for the two sessions.
      assert.equal(r.xp, 25);
    }));

  test('XP never decreases: the most any device reported, or the ledger', () =>
    tx(async (client) => {
      await signedIn(client);
      // A device whose XP is ahead of its ledger (it counts).
      const high = await importAs(
        client,
        envelope({ deviceId: 'old-phone', xp: 500 }),
      );
      assert.equal(high.xp, 500);
      // Another device reporting less takes nothing away.
      const low = await importAs(
        client,
        played('device-laptop', ['ps-lsn-0a41c2']),
      );
      assert.equal(low.xp, 500);
      // The same device reporting less later does not lower its own maximum.
      const lower = await importAs(
        client,
        envelope({ deviceId: 'old-phone', xp: 10, localDate: '2026-09-28' }),
      );
      assert.equal(lower.xp, 500);
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          `select reported_xp from public.progress_devices where device_id = 'old-phone'`,
        ),
        500,
      );
    }));

  test('the ledger wins when it is ahead of every device', () =>
    tx(async (client) => {
      await signedIn(client);
      const r = await importAs(
        client,
        envelope({
          xp: 0,
          completed: { 'ps-lsn-0a41c2': 'mvp' },
          rewarded: ['a', 'b'],
        }),
      );
      assert.equal(r.xp, 25);
    }));

  test('activity takes the maximum per day, never a sum', () =>
    tx(async (client) => {
      await signedIn(client);
      await importAs(
        client,
        envelope({ activity: { '2026-09-26': 2, '2026-09-27': 1 } }),
      );
      const r = await importAs(
        client,
        envelope({
          deviceId: 'device-laptop',
          activity: { '2026-09-26': 1, '2026-09-27': 3, '2026-09-28': 1 },
        }),
      );
      assert.deepEqual(r.activity, {
        '2026-09-26': 2,
        '2026-09-27': 3,
        '2026-09-28': 1,
      });
    }));

  test("a Hindko MVP key is kept; a mapped MVP key moves to its lesson's id", () =>
    tx(async (client) => {
      await signedIn(client);
      const r = await importAs(
        client,
        envelope({
          xp: 50,
          completed: {
            'hindko/greetings': 'mvp',
            'pashto/greetings': 'mvp',
          },
          rewarded: ['h1', 'p1'],
        }),
      );
      // seeds/20_content_fixture.sql maps pashto/greetings to ps-lsn-f00001.
      assert.deepEqual(r.completed, {
        'hindko/greetings': 'mvp',
        'ps-lsn-f00001': 'mvp',
      });
      assert.equal(r.xp, 50);
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          `select private.resolve_lesson_key('hindko/greetings')`,
        ),
        'hindko/greetings',
      );
      assert.equal(
        await value(
          client,
          `select private.resolve_lesson_key('ps-lsn-0a41c2')`,
        ),
        'ps-lsn-0a41c2',
      );
      assert.ok(
        await value(
          client,
          `select exists (select 1 from public.xp_awards where award_key = 'lesson:hindko/greetings')`,
        ),
      );
    }));

  test('a completion keeps the earliest release it was completed in', () =>
    tx(async (client) => {
      await signedIn(client);
      const lesson = 'ps-lsn-0a41c2';
      let r = await importAs(
        client,
        envelope({ completed: { [lesson]: 'content@2026.10.2' } }),
      );
      assert.equal(r.completed[lesson], 'content@2026.10.2');
      r = await importAs(
        client,
        envelope({
          deviceId: 'd2',
          completed: { [lesson]: 'content@2026.09.10' },
        }),
      );
      assert.equal(r.completed[lesson], 'content@2026.09.10');
      r = await importAs(
        client,
        envelope({ deviceId: 'd3', completed: { [lesson]: 'mvp' } }),
      );
      assert.equal(r.completed[lesson], 'mvp');
      r = await importAs(
        client,
        envelope({
          deviceId: 'd4',
          completed: { [lesson]: 'content@2026.09.1' },
        }),
      );
      assert.equal(r.completed[lesson], 'mvp');
      // An MVP key and its permanent id in one envelope: the earlier wins.
      r = await importAs(
        client,
        envelope({
          deviceId: 'd5',
          completed: {
            'pashto/introductions': 'mvp',
            'ps-lsn-f00002': 'content@2026.09.1',
          },
        }),
      );
      assert.equal(r.completed['ps-lsn-f00002'], 'mvp');
    }));

  test('preferences are filled in where absent, never overwritten', () =>
    tx(async (client) => {
      await signedIn(client);
      let r = await importAs(client, envelope({ selected: 'pashto' }));
      assert.equal(r.selected, 'pashto');
      assert.equal(r.dailyGoal, null);
      r = await importAs(
        client,
        envelope({ deviceId: 'd2', selected: 'urdu', dailyGoal: 3 }),
      );
      assert.equal(r.selected, 'pashto');
      assert.equal(r.dailyGoal, 3);
      r = await importAs(
        client,
        envelope({ deviceId: 'd3', selected: 'hindko', dailyGoal: 1 }),
      );
      assert.equal(r.selected, 'pashto');
      assert.equal(r.dailyGoal, 3);
    }));

  test('learner A never sees learner B', () =>
    tx(async (client) => {
      const a = await user(client);
      const b = await user(client);
      await as(client, a);
      await importAs(client, played('device-a', ['ps-lsn-aaaaaa']));
      await as(client, b);
      const rb = await importAs(client, played('device-b', ['ps-lsn-bbbbbb']));
      assert.deepEqual(Object.keys(rb.completed), ['ps-lsn-bbbbbb']);
      assert.equal(rb.xp, 20);
      assert.ok(!JSON.stringify(await progress(client)).includes('aaaaaa'));
      // The same envelope from A is new to B: hashes are per learner.
      const same = played('device-a', ['ps-lsn-aaaaaa']);
      await as(client, a);
      assert.equal((await importAs(client, same)).applied, false);
      const ra = await progress(client);
      assert.deepEqual(Object.keys(ra.completed), ['ps-lsn-aaaaaa']);
      assert.equal(ra.xp, 20);
    }));

  test('an unauthenticated caller is refused', () =>
    tx(async (client) => {
      await asAnon(client);
      await expectCode(importAs(client, envelope()), '42501');
      await expectCode(progress(client), '42501');
      // Signed-in role without a user: the functions refuse themselves.
      await client.query('set local role authenticated');
      await client.query(
        "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', '', true)",
        [JSON.stringify({ role: 'authenticated' })],
      );
      await expectCode(importAs(client, envelope()), 'PL401_NOT_SIGNED_IN');
      await expectCode(progress(client), 'PL401_NOT_SIGNED_IN');
    }));

  test('a signed-in user without a profile is refused', () =>
    tx(async (client) => {
      await signedIn(client, { ageBand: null });
      await expectCode(importAs(client, envelope()), 'PL403_NO_PROFILE');
    }));

  test('the kill switch refuses imports and keeps reads working', () =>
    tx(async (client) => {
      await asPostgres(client);
      await client.query(
        `update private.app_settings set value = 'false'::jsonb where key = 'sync_enabled'`,
      );
      await signedIn(client);
      await expectCode(
        importAs(client, played('device-phone', ['ps-lsn-0a41c2'])),
        'PL460_SYNC_DISABLED',
      );
      assert.equal((await progress(client)).xp, 0);
    }));

  test('more than 120 applied imports an hour are refused; replays are not', () =>
    tx(async (client) => {
      const u = await signedIn(client);
      const first = await importAs(client, envelope({ xp: 5 }));
      await asPostgres(client);
      for (let i = 0; i < 118; i++)
        await client.query(
          `insert into public.progress_imports (user_id, envelope_hash, device_id) values ($1, $2, 'filler')`,
          [u.id, randomBytes(32).toString('hex')],
        );
      await as(client, u);
      // The 120th applied import in the hour still goes through.
      const hundredTwentieth = await importAs(client, envelope({ xp: 6 }));
      assert.equal(hundredTwentieth.applied, true);
      await expectCode(
        importAs(client, envelope({ xp: 7 })),
        'PL429_RATE_LIMITED',
      );
      // A replay changes nothing, so it is still answered.
      const replay = await importAs(client, envelope({ xp: 5 }));
      assert.equal(replay.applied, false);
      assert.equal(replay.envelope_hash, first.envelope_hash);
      // Imports older than an hour do not count.
      await asPostgres(client);
      await client.query(
        `alter table public.progress_imports disable trigger progress_imports_append_only`,
      );
      await client.query(
        `update public.progress_imports set imported_at = now() - interval '61 minutes' where device_id = 'filler'`,
      );
      await client.query(
        `alter table public.progress_imports enable trigger progress_imports_append_only`,
      );
      await as(client, u);
      assert.equal((await importAs(client, envelope({ xp: 7 }))).applied, true);
    }));

  test('malformed envelopes are refused', () =>
    tx(async (client) => {
      await signedIn(client);
      const bad = [
        ['an array', '[]'],
        ['a string', '"polilingo.sync@1"'],
        ['another format', envelope({ format: 'polilingo.sync@2' })],
        ['no format', (({ format: _f, ...e }) => e)(envelope())],
        ['runs in progress', { ...envelope(), sessions: {} }],
        ['settings', { ...envelope(), prefs: { sound: true } }],
        ['no device id', (({ deviceId: _d, ...e }) => e)(envelope())],
        ['an empty device id', envelope({ deviceId: '' })],
        ['a long device id', envelope({ deviceId: 'd'.repeat(101) })],
        ['no local date', envelope({ localDate: null })],
        [
          'a local date that is not a date',
          envelope({ localDate: '2026-02-31' }),
        ],
        ['a local date before 2020', envelope({ localDate: '2019-12-31' })],
        ['XP as text', envelope({ xp: '65' })],
        ['fractional XP', envelope({ xp: 1.5 })],
        [
          'XP written as 65.0',
          JSON.stringify(envelope()).replace('"xp":0', '"xp":65.0'),
        ],
        ['negative XP', envelope({ xp: -1 })],
        ['absurd XP', envelope({ xp: 10000001 })],
        ['completions as an array', envelope({ completed: [] })],
        [
          'a non-ASCII lesson key',
          envelope({ completed: { 'pashto/سلام': 'mvp' } }),
        ],
        [
          'a malformed lesson key',
          envelope({ completed: { 'Bad Key': 'mvp' } }),
        ],
        [
          'a release that is not text',
          envelope({ completed: { 'ps-lsn-0a41c2': 5 } }),
        ],
        ['an empty release', envelope({ completed: { 'ps-lsn-0a41c2': '' } })],
        ['activity as an array', envelope({ activity: [] })],
        ['a day count of 0', envelope({ activity: { '2026-09-27': 0 } })],
        [
          'a day count over 1000',
          envelope({ activity: { '2026-09-27': 1001 } }),
        ],
        [
          'a fractional day count',
          envelope({ activity: { '2026-09-27': 1.5 } }),
        ],
        [
          'a day that is not a date',
          envelope({ activity: { '2026-13-01': 1 } }),
        ],
        ['a day before 2020', envelope({ activity: { '2019-12-31': 1 } })],
        [
          'a day in another format',
          envelope({ activity: { '27/09/2026': 1 } }),
        ],
        ['rewarded as an object', envelope({ rewarded: {} })],
        ['a rewarded number', envelope({ rewarded: [1] })],
        ['a rewarded id with a space', envelope({ rewarded: ['a b'] })],
        ['a long rewarded id', envelope({ rewarded: ['x'.repeat(101)] })],
        ['a daily goal of 4', envelope({ dailyGoal: 4 })],
        ['a daily goal as text', envelope({ dailyGoal: '2' })],
        [
          'a selected course that is not a slug',
          envelope({ selected: 'Pashto' }),
        ],
        [
          'over 5,000 completions',
          envelope({
            completed: Object.fromEntries(
              Array.from({ length: 5001 }, (_, i) => [
                `ps-lsn-${i.toString(16).padStart(6, '0')}`,
                'mvp',
              ]),
            ),
          }),
        ],
        [
          'over 10,000 rewarded sessions',
          envelope({
            rewarded: Array.from({ length: 10001 }, (_, i) => `s${i}`),
          }),
        ],
        [
          'over 3,000 activity days',
          envelope({
            activity: Object.fromEntries(
              Array.from({ length: 3001 }, (_, i) => [
                new Date(Date.UTC(2020, 0, 1) + i * 86400000)
                  .toISOString()
                  .slice(0, 10),
                1,
              ]),
            ),
          }),
        ],
      ];
      for (const [what, env] of bad) {
        const err = await expectCode(
          importAs(client, env),
          'PL422_BAD_ENVELOPE',
        );
        assert.ok(err, what);
      }
      // Nothing was recorded.
      assert.equal((await progress(client)).xp, 0);
    }));

  test('the limits themselves are accepted', () =>
    tx(async (client) => {
      await signedIn(client);
      const r = await importAs(
        client,
        envelope({
          xp: 10000000,
          activity: { '2020-01-01': 1000 },
          rewarded: ['x'.repeat(100)],
          deviceId: 'd'.repeat(100),
          dailyGoal: 3,
          completed: {
            [`${'a'.repeat(40)}/${'b'.repeat(39)}`]: 'r'.repeat(100),
          },
        }),
      );
      assert.equal(r.applied, true);
      assert.equal(r.xp, 10000000);
    }));
});

describe('sync helpers', () => {
  test('only the two API functions are callable by signed-in users', () =>
    tx(async (client) => {
      const row = await one(
        client,
        `select
           has_function_privilege('authenticated', 'public.import_local_progress(jsonb)', 'execute') as import,
           has_function_privilege('authenticated', 'public.get_my_progress()', 'execute') as read,
           has_function_privilege('authenticated', 'private.progress_state(uuid)', 'execute') as state,
           has_function_privilege('authenticated', 'private.xp_total(uuid)', 'execute') as xp,
           has_function_privilege('authenticated', 'private.resolve_lesson_key(text)', 'execute') as resolve,
           has_function_privilege('authenticated', 'private.check_sync_envelope(jsonb)', 'execute') as check_env,
           has_function_privilege('anon', 'public.import_local_progress(jsonb)', 'execute') as anon_import,
           has_function_privilege('anon', 'public.get_my_progress()', 'execute') as anon_read`,
      );
      assert.deepEqual(row, {
        import: true,
        read: true,
        state: false,
        xp: false,
        resolve: false,
        check_env: false,
        anon_import: false,
        anon_read: false,
      });
    }));

  test('get_my_progress for a new learner is an empty state', () =>
    tx(async (client) => {
      await signedIn(client);
      assert.deepEqual(await progress(client), {
        xp: 0,
        completed: {},
        activity: {},
        rewarded: [],
        dailyGoal: null,
        selected: null,
      });
    }));
});
