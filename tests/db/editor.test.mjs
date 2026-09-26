// The editor's database functions (docs/platform.md §3.9 E): every refusal
// each one can raise, called directly, plus the behaviour the course maker
// relies on (ids, positions, voiding, retiring, submitting, page reads).
// Every test runs in a rolled-back transaction.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  as,
  asPostgres,
  expectCode,
  grant,
  one,
  seedLesson,
  tx,
  user,
  value,
} from './helpers.mjs';

// Letters in every Arabic-script character list (ps, ur, hno).
const NATIVE = [
  'سلام',
  'بابا',
  'ماما',
  'نان',
  'تار',
  'دل',
  'سر',
  'بار',
  'لب',
  'مست',
  'دست',
  'رسم',
  'مار',
];

/** A plain code-unit sort, for comparing lists of ids. */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const FIXTURE_COURSE = 'ps-crs-fixture';
const FIXTURE_UNIT = 'ps-unt-f00001';
const DEMO_LESSON = 'ps-lsn-f00001';
const DEMO_ITEM = 'ps-itm-f00001';

const item = (i, extra = {}) => ({
  native: NATIVE[i % NATIVE.length],
  romanisation: `Word ${i + 1}`,
  meaning: `Meaning ${i + 1}`,
  source_type: 'original',
  source_citation: 'Written for a database test',
  source_licence: 'Test data only',
  ...extra,
});

const rpc = (client, fn, args = []) =>
  client.query(
    `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`,
    args,
  );
const call = async (client, fn, args = []) =>
  (await rpc(client, fn, args)).rows[0].r;

/** Signed in as `authenticated` with no subject: auth.uid() is null. */
async function asNobody(client) {
  await client.query('set local role authenticated');
  await client.query(
    "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', '', true)",
    [JSON.stringify({ role: 'authenticated' })],
  );
}

/** A fresh editor (all languages unless `language`), acting now. */
async function editor(client, { language } = {}) {
  await asPostgres(client);
  const u = await user(client);
  const { contributorId } = await grant(client, u, 'editor', { language });
  await as(client, u);
  return { ...u, contributorId };
}

async function admin(client) {
  await asPostgres(client);
  const u = await user(client);
  const { contributorId } = await grant(client, u, 'admin');
  await as(client, u);
  return { ...u, contributorId };
}

/** A new unit in the fixture course and a Yusufzai lesson in it, as `ed`. */
async function newLesson(client, { items = 0, exercises = false } = {}) {
  const unitId = await call(client, 'create_unit', [
    FIXTURE_COURSE,
    'Getting around',
    'Ask for directions and understand the answer.',
  ]);
  const lessonId = await call(client, 'create_lesson', [
    unitId,
    'Asking the way',
    'Ask where something is, politely.',
    '',
    'ps-var-yusufzai',
  ]);
  const itemIds = [];
  for (let i = 0; i < items; i++)
    itemIds.push((await call(client, 'create_item', [lessonId, item(i)])).id);
  const exerciseIds = [];
  if (exercises)
    for (const [i, answer] of itemIds.entries()) {
      const others = itemIds.filter((id) => id !== answer);
      exerciseIds.push(
        await call(client, 'create_exercise', [
          lessonId,
          {
            kind: 'meaning',
            answer,
            prompt: 'What does this mean?',
            options: others.slice(0, 3),
          },
        ]),
      );
      exerciseIds.push(
        await call(client, 'create_exercise', [
          lessonId,
          {
            kind: 'translation',
            answer,
            prompt: `How do you say "meaning ${i + 1}"?`,
            options: others.slice(0, 3),
          },
        ]),
      );
    }
  return { unitId, lessonId, itemIds, exerciseIds };
}

const positions = async (client, table, parentCol, parentId) =>
  (
    await client.query(
      `select id, position from content.${table}
       where ${parentCol} = $1 and retired_at is null order by position`,
      [parentId],
    )
  ).rows;

// ---------------------------------------------------------------------------

// Every function with a representative argument list.
const ALL_CALLS = [
  ['reserve_content_id', ['item', 'ps']],
  ['create_unit', [FIXTURE_COURSE, 'A unit', 'A goal of ten.']],
  ['create_lesson', [FIXTURE_UNIT, 'A lesson', 'An objective.']],
  ['create_item', [DEMO_LESSON, item(0)]],
  [
    'create_exercise',
    [DEMO_LESSON, { kind: 'assemble', answer: DEMO_ITEM, prompt: 'x' }],
  ],
  ['update_unit', [FIXTURE_UNIT, 1, { title: 'x' }]],
  ['update_lesson', [DEMO_LESSON, 1, { title: 'x' }]],
  ['update_item', [DEMO_ITEM, 1, { meaning: 'x' }]],
  ['update_exercise', ['ps-exr-f00001', 1, { prompt: 'x' }]],
  ['move_content', ['item', DEMO_ITEM, 'ps-lsn-f00002']],
  ['reorder_children', ['unit', FIXTURE_UNIT, [DEMO_LESSON]]],
  ['retire_content', ['item', DEMO_ITEM, 'x']],
  ['submit_lesson', [DEMO_LESSON]],
  ['withdraw_lesson_submission', [DEMO_LESSON]],
  ['set_publish_gate', ['unit', FIXTURE_UNIT, 'open', 'x']],
  ['set_demo_sunset', ['ps', '2030-01-01', 'x']],
  ['check_text', ['ps', 'سلام', 'Salaam']],
  ['check_lesson', [DEMO_LESSON]],
  ['page_edit_tree', []],
  ['page_edit_lesson', [DEMO_LESSON]],
];
const INVOKER_READS = new Set([
  'check_text',
  'check_lesson',
  'page_edit_tree',
  'page_edit_lesson',
]);

describe('who may edit', () => {
  test('every function refuses a caller with no session; writes need a profile', () =>
    tx(async (client) => {
      await asNobody(client);
      for (const [fn, args] of ALL_CALLS)
        await expectCode(rpc(client, fn, args), 'PL401_NOT_SIGNED_IN');
      await asPostgres(client);
      const noProfile = await user(client, { ageBand: null });
      await as(client, noProfile);
      for (const [fn, args] of ALL_CALLS)
        if (!INVOKER_READS.has(fn))
          await expectCode(rpc(client, fn, args), 'PL403_NO_PROFILE');
    }));

  test('not signed in, no profile, no editor role: refused before anything else', () =>
    tx(async (client) => {
      await asNobody(client);
      await expectCode(
        rpc(client, 'reserve_content_id', ['item', 'ps']),
        'PL401_NOT_SIGNED_IN',
      );
      await expectCode(rpc(client, 'page_edit_tree'), 'PL401_NOT_SIGNED_IN');
      await expectCode(
        rpc(client, 'check_text', ['ps', 'سلام', 'Salaam']),
        'PL401_NOT_SIGNED_IN',
      );
      await expectCode(
        rpc(client, 'set_publish_gate', ['unit', FIXTURE_UNIT, 'open', 'x']),
        'PL401_NOT_SIGNED_IN',
      );

      await asPostgres(client);
      const noProfile = await user(client, { ageBand: null });
      await as(client, noProfile);
      await expectCode(
        rpc(client, 'create_unit', [
          FIXTURE_COURSE,
          'A unit',
          'A goal of ten.',
        ]),
        'PL403_NO_PROFILE',
      );
      await expectCode(
        rpc(client, 'set_demo_sunset', ['ps', '2030-01-01', 'x']),
        'PL403_NO_PROFILE',
      );

      await asPostgres(client);
      const learner = await user(client);
      await as(client, learner);
      for (const [fn, args] of [
        ['reserve_content_id', ['item', 'ps']],
        ['create_unit', [FIXTURE_COURSE, 'A unit', 'A goal of ten.']],
        ['create_lesson', [FIXTURE_UNIT, 'A lesson', 'An objective.']],
        ['create_item', ['ps-lsn-f00001', item(0)]],
        ['create_exercise', ['ps-lsn-f00001', { kind: 'assemble' }]],
        ['update_unit', [FIXTURE_UNIT, 1, { title: 'x' }]],
        ['update_lesson', [DEMO_LESSON, 1, { title: 'x' }]],
        ['update_item', [DEMO_ITEM, 1, { meaning: 'x' }]],
        ['update_exercise', ['ps-exr-f00001', 1, { prompt: 'x' }]],
        ['move_content', ['item', DEMO_ITEM, 'ps-lsn-f00002']],
        ['reorder_children', ['unit', FIXTURE_UNIT, [DEMO_LESSON]]],
        ['retire_content', ['item', DEMO_ITEM, 'x']],
        ['submit_lesson', [DEMO_LESSON]],
        ['withdraw_lesson_submission', [DEMO_LESSON]],
        ['page_edit_tree', []],
        ['page_edit_lesson', [DEMO_LESSON]],
        ['check_text', ['ps', 'سلام', 'Salaam']],
        ['check_lesson', [DEMO_LESSON]],
      ])
        await expectCode(rpc(client, fn, args), 'PL403_NOT_EDITOR');

      // A reviewer reviews; they do not edit.
      await asPostgres(client);
      const reviewer = await user(client);
      await grant(client, reviewer, 'language_reviewer', {
        variety: 'ps-var-yusufzai',
      });
      await as(client, reviewer);
      await expectCode(
        rpc(client, 'create_lesson', [
          FIXTURE_UNIT,
          'A lesson',
          'An objective.',
        ]),
        'PL403_NOT_EDITOR',
      );
      await expectCode(rpc(client, 'page_edit_tree'), 'PL403_NOT_EDITOR');
      // …but can check text, as staff.
      const checked = await call(client, 'check_text', ['ps', 'سلام', 'Salaam']);
      assert.deepEqual(checked.problems, []);
    }));

  test('the admin switches refuse an editor', () =>
    tx(async (client) => {
      await editor(client);
      await expectCode(
        rpc(client, 'set_publish_gate', [
          'unit',
          FIXTURE_UNIT,
          'open',
          'Ready',
        ]),
        'PL403_NOT_ADMIN',
      );
      await expectCode(
        rpc(client, 'set_demo_sunset', ['ps', '2030-01-01', 'Longer']),
        'PL403_NOT_ADMIN',
      );
      await expectCode(
        rpc(client, 'retire_content', ['course', FIXTURE_COURSE, 'Old']),
        'PL403_NOT_ADMIN',
      );
    }));

  test('an editor scoped to one language is refused in another', () =>
    tx(async (client) => {
      await asPostgres(client);
      const other = await seedLesson(client, { language: 'ur', items: 3 });
      await editor(client, { language: 'ur' });

      const refusal = await expectCode(
        rpc(client, 'create_unit', [
          FIXTURE_COURSE,
          'A unit',
          'A goal of ten.',
        ]),
        'PL403_OUTSIDE_LANGUAGE',
      );
      assert.match(refusal.message, /Pashto/);
      for (const [fn, args] of [
        ['reserve_content_id', ['item', 'ps']],
        ['create_lesson', [FIXTURE_UNIT, 'A lesson', 'An objective.']],
        ['create_item', [DEMO_LESSON, item(0)]],
        [
          'create_exercise',
          [DEMO_LESSON, { kind: 'assemble', answer: DEMO_ITEM, prompt: 'x' }],
        ],
        ['update_unit', [FIXTURE_UNIT, 1, { title: 'x' }]],
        ['update_lesson', [DEMO_LESSON, 1, { title: 'x' }]],
        ['update_item', [DEMO_ITEM, 1, { meaning: 'x' }]],
        ['update_exercise', ['ps-exr-f00001', 1, { prompt: 'x' }]],
        ['move_content', ['lesson', DEMO_LESSON, FIXTURE_UNIT]],
        ['reorder_children', ['unit', FIXTURE_UNIT, [DEMO_LESSON]]],
        ['retire_content', ['exercise', 'ps-exr-f00001', 'x']],
        ['submit_lesson', [DEMO_LESSON]],
        ['withdraw_lesson_submission', [DEMO_LESSON]],
        ['page_edit_lesson', [DEMO_LESSON]],
      ])
        await expectCode(rpc(client, fn, args), 'PL403_OUTSIDE_LANGUAGE');

      // Their own language works, and the tree shows only it.
      const tree = await call(client, 'page_edit_tree');
      assert.deepEqual(
        tree.languages.map((l) => l.code),
        ['ur'],
      );
      const id = await call(client, 'create_item', [other.lessonId, item(5)]);
      assert.match(id.id, /^ur-itm-[0-9a-f]{6}$/);
    }));
});

describe('ids', () => {
  test('reserve_content_id mints <lang>-<type>-<hex6> and registers it', () =>
    tx(async (client) => {
      const ed = await editor(client);
      for (const [type, infix] of [
        ['unit', 'unt'],
        ['lesson', 'lsn'],
        ['item', 'itm'],
        ['exercise', 'exr'],
      ]) {
        const id = await call(client, 'reserve_content_id', [type, 'ps']);
        assert.match(id, new RegExp(`^ps-${infix}-[0-9a-f]{6}$`));
        const row = await one(
          client,
          'select type, language_code, minted_by, minted_on, retired_at from content.id_registry where id = $1',
          [id],
        );
        assert.equal(row.type, type);
        assert.equal(row.language_code, 'ps');
        assert.equal(row.minted_by, ed.contributorId);
        assert.equal(row.retired_at, null);
      }
      await expectCode(
        rpc(client, 'reserve_content_id', ['course', 'ps']),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'reserve_content_id', ['item', 'xx']),
        'PL404_NOT_FOUND',
      );

      // Every create registers what it makes.
      const { unitId, lessonId, itemIds } = await newLesson(client, {
        items: 1,
      });
      const registered = await value(
        client,
        'select count(*)::int from content.id_registry where id = any ($1)',
        [[unitId, lessonId, ...itemIds]],
      );
      assert.equal(registered, 3);
    }));

  test('a colliding id is retried, against the registry and unregistered rows', () =>
    tx(async (client) => {
      await asPostgres(client);
      const seeded = await seedLesson(client, { items: 1, exercises: 0 });
      const unregistered = seeded.itemIds[0].split('-')[2];
      await client.query(
        "insert into content.id_registry (id, type, language_code) values ('ps-itm-aaaaaa', 'item', 'ps')",
      );
      await client.query('create sequence private.editor_test_seq');
      await client.query(
        `create or replace function private.editor_random_hex6() returns text
         language sql volatile set search_path = '' as $f$
           select case nextval('private.editor_test_seq')
             when 1 then 'aaaaaa' when 2 then '${unregistered}' else 'c0ffee' end
         $f$`,
      );
      const ed = await editor(client);
      // ps-itm-aaaaaa is only in the registry; the seeded item exists but
      // was never registered. Both are skipped.
      assert.equal(
        await call(client, 'reserve_content_id', ['item', 'ps']),
        'ps-itm-c0ffee',
      );
      await asPostgres(client);
      assert.equal(
        await value(client, "select nextval('private.editor_test_seq')::int"),
        4,
      );
      await as(client, ed);
      // A reserved id can then be claimed once by create_item.
      const { lessonId } = await newLesson(client);
      const made = await call(client, 'create_item', [
        lessonId,
        item(0, { id: 'ps-itm-c0ffee' }),
      ]);
      assert.equal(made.id, 'ps-itm-c0ffee');
      await expectCode(
        rpc(client, 'create_item', [
          lessonId,
          item(1, { id: 'ps-itm-c0ffee' }),
        ]),
        'PL422_BAD_INPUT',
      );
      // An id nobody reserved is refused.
      await expectCode(
        rpc(client, 'create_exercise', [
          lessonId,
          {
            id: 'ps-exr-000000',
            kind: 'assemble',
            answer: made.id,
            prompt: 'Build it.',
          },
        ]),
        'PL422_BAD_INPUT',
      );
    }));

  test('a reserved id is claimed only by the editor who reserved it', () =>
    tx(async (client) => {
      const a = await editor(client, { language: 'ps' });
      const itemId = await call(client, 'reserve_content_id', ['item', 'ps']);
      const exerciseId = await call(client, 'reserve_content_id', [
        'exercise',
        'ps',
      ]);
      const b = await editor(client, { language: 'ps' });
      const { lessonId, itemIds } = await newLesson(client, { items: 2 });
      const taken = await expectCode(
        rpc(client, 'create_item', [lessonId, item(5, { id: itemId })]),
        'PL422_BAD_INPUT',
      );
      assert.match(taken.message, /isn't a free reserved id/);
      await expectCode(
        rpc(client, 'create_exercise', [
          lessonId,
          {
            id: exerciseId,
            kind: 'meaning',
            answer: itemIds[0],
            prompt: 'What does this mean?',
            options: [itemIds[1]],
          },
        ]),
        'PL422_BAD_INPUT',
      );
      assert.equal(
        await value(
          client,
          'select count(*)::int from content.items where id = $1',
          [itemId],
        ),
        0,
      );

      // The editor who reserved them still can, in any lesson they edit.
      await as(client, a);
      assert.equal(
        (await call(client, 'create_item', [lessonId, item(5, { id: itemId })]))
          .id,
        itemId,
      );
      assert.equal(
        await call(client, 'create_exercise', [
          lessonId,
          {
            id: exerciseId,
            kind: 'meaning',
            answer: itemIds[0],
            prompt: 'What does this mean?',
            options: [itemIds[1]],
          },
        ]),
        exerciseId,
      );
      const minted = await one(
        client,
        'select minted_by from content.id_registry where id = $1',
        [itemId],
      );
      assert.equal(minted.minted_by, a.contributorId);
      assert.notEqual(a.contributorId, b.contributorId);
    }));
});

describe('creating', () => {
  test('units start held back and take the position asked for', () =>
    tx(async (client) => {
      await editor(client);
      const a = await call(client, 'create_unit', [
        FIXTURE_COURSE,
        'Second unit',
        'Comes after the fixture unit.',
      ]);
      const b = await call(client, 'create_unit', [
        FIXTURE_COURSE,
        'First now',
        'Goes to the very front.',
        'travel',
        1,
      ]);
      const gate = await value(
        client,
        'select publish_gate from content.units where id = $1',
        [a],
      );
      assert.equal(gate, 'blocked');
      assert.deepEqual(
        (await positions(client, 'units', 'course_id', FIXTURE_COURSE)).map(
          (r) => r.id,
        ),
        [b, FIXTURE_UNIT, a],
      );
      await client.query('set constraints all immediate');

      await expectCode(
        rpc(client, 'create_unit', [FIXTURE_COURSE, '', 'A goal of ten.']),
        'PL422_LENGTH',
      );
      const long = await expectCode(
        rpc(client, 'create_unit', [
          FIXTURE_COURSE,
          'x'.repeat(61),
          'A goal of ten.',
        ]),
        'PL422_LENGTH',
      );
      assert.match(long.message, /at most 60 characters\. This one has 61/);
      await expectCode(
        rpc(client, 'create_unit', [FIXTURE_COURSE, 'Unit', 'Short']),
        'PL422_LENGTH',
      );
      await expectCode(
        rpc(client, 'create_unit', [
          FIXTURE_COURSE,
          'Unit',
          'A goal of ten.',
          null,
          9,
        ]),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'create_unit', [
          'ps-crs-nothing',
          'Unit',
          'A goal of ten.',
        ]),
        'PL404_NOT_FOUND',
      );
    }));

  test('lessons: variety defaults to the course, must share its language', () =>
    tx(async (client) => {
      await editor(client);
      const lesson = await call(client, 'create_lesson', [
        FIXTURE_UNIT,
        'Third lesson',
        'Follows the two fixture lessons.',
      ]);
      const row = await one(
        client,
        'select variety_id, position, review_status, publish_gate from content.lessons where id = $1',
        [lesson],
      );
      assert.deepEqual(row, {
        variety_id: 'ps-var-fixture',
        position: 3,
        review_status: 'unreviewed',
        publish_gate: 'open',
      });
      await expectCode(
        rpc(client, 'create_lesson', [
          FIXTURE_UNIT,
          'Wrong',
          'A Hindko variety in Pashto.',
          '',
          'hno-var-hazara',
        ]),
        'PL422_VARIETY_MISMATCH',
      );
      await expectCode(
        rpc(client, 'create_lesson', [
          FIXTURE_UNIT,
          'Minutes',
          'Far too long.',
          '',
          null,
          40,
        ]),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'create_lesson', [FIXTURE_UNIT, 'Short', 'Too short']),
        'PL422_LENGTH',
      );
      await expectCode(
        rpc(client, 'create_lesson', [
          'ps-unt-000000',
          'Lesson',
          'An objective.',
        ]),
        'PL404_NOT_FOUND',
      );
    }));

  test('items: stored normalised, fingerprinted, provenance required', () =>
    tx(async (client) => {
      const ed = await editor(client);
      const { lessonId } = await newLesson(client);
      const made = await call(client, 'create_item', [
        lessonId,
        item(0, { native: '  سلام  ', context: '  ', usage_note: 'Formal.' }),
      ]);
      assert.match(made.text_fingerprint, /^[0-9a-f]{16}$/);
      assert.equal(made.revision_no, 1);
      const row = await one(
        client,
        'select native, context, usage_note, variety_id, text_author, position from content.items where id = $1',
        [made.id],
      );
      assert.deepEqual(row, {
        native: 'سلام',
        context: null,
        usage_note: 'Formal.',
        variety_id: 'ps-var-yusufzai',
        text_author: ed.contributorId,
        position: 1,
      });

      await expectCode(
        rpc(client, 'create_item', [
          lessonId,
          item(1, { source_type: 'a blog' }),
        ]),
        'PL422_PROVENANCE',
      );
      await expectCode(
        rpc(client, 'create_item', [
          lessonId,
          item(1, { source_citation: 'ab' }),
        ]),
        'PL422_PROVENANCE',
      );
      await expectCode(
        rpc(client, 'create_item', [lessonId, item(1, { source_licence: '' })]),
        'PL422_PROVENANCE',
      );
      await expectCode(
        rpc(client, 'create_item', [
          lessonId,
          item(1, { source_retrieved: 'soon' }),
        ]),
        'PL422_PROVENANCE',
      );
      await expectCode(
        rpc(client, 'create_item', [
          lessonId,
          item(1, { meaning: 'm'.repeat(201) }),
        ]),
        'PL422_LENGTH',
      );
      await expectCode(
        rpc(client, 'create_item', [lessonId, item(1, { native: ' ' })]),
        'PL422_LENGTH',
      );
      await expectCode(
        rpc(client, 'create_item', [lessonId, { ...item(1), colour: 'red' }]),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'create_item', [lessonId, item(1, { tags: 'a' })]),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'create_item', [
          lessonId,
          item(1, { variety: 'hno-var-hazara' }),
        ]),
        'PL422_VARIETY_MISMATCH',
      );
      await expectCode(
        rpc(client, 'create_item', ['ps-lsn-000000', item(1)]),
        'PL404_NOT_FOUND',
      );
    }));

  test('text rules are refused with the character and its position', () =>
    tx(async (client) => {
      await editor(client);
      const { lessonId } = await newLesson(client);
      const cases = [
        ['PL422_SMART_QUOTE', { native: 'سل’ام' }, '’', 3],
        ['PL422_INVISIBLE_CHAR', { native: 'سل​ام' }, '​', 3],
        ['PL422_ARABIC_DIGIT', { native: 'سلام ۲' }, '۲', 6],
        ['PL422_CHAR_NOT_ALLOWED', { native: 'سلامx' }, 'x', 5],
        ['PL422_ROMANISATION_SCRIPT', { romanisation: 'Salسm' }, 'س', 4],
        ['PL422_ROMANISATION_NO_LATIN', { romanisation: '123' }, null, null],
      ];
      for (const [code, fields, char, position] of cases) {
        const refusal = await expectCode(
          rpc(client, 'create_item', [lessonId, item(0, fields)]),
          code,
        );
        const detail = JSON.parse(refusal.detail);
        const problem = detail.problems.find((p) => p.code === code);
        assert.equal(problem.char, char, code);
        assert.equal(problem.position, position, code);
        if (typeof position === 'number')
          assert.ok(
            refusal.message.includes(`position ${position}`),
            refusal.message,
          );
      }
      // check_text gives the same list without storing anything.
      const checked = await call(client, 'check_text', [
        'ps',
        ' سل’ام ',
        '123',
      ]);
      assert.equal(checked.native, 'سل’ام');
      assert.deepEqual(
        checked.problems.map((p) => [p.code, p.position]),
        [
          ['PL422_SMART_QUOTE', 3],
          ['PL422_ROMANISATION_NO_LATIN', null],
        ],
      );
      assert.equal(
        await value(
          client,
          'select count(*)::int from content.items where lesson_id = $1',
          [lessonId],
        ),
        0,
      );
    }));

  test('a lesson holds at most 12 phrases', () =>
    tx(async (client) => {
      await editor(client);
      const { lessonId } = await newLesson(client, { items: 12 });
      await expectCode(
        rpc(client, 'create_item', [lessonId, item(12)]),
        'PL422_LESSON_FULL',
      );
      // A new phrase can go in at a position, pushing the rest down.
      const { lessonId: other } = await newLesson(client, { items: 3 });
      const first = await call(client, 'create_item', [other, item(9), 1]);
      const order = await positions(client, 'items', 'lesson_id', other);
      assert.equal(order[0].id, first.id);
      assert.deepEqual(
        order.map((r) => r.position),
        [1, 2, 3, 4],
      );
      await client.query('set constraints all immediate');
    }));

  test('exercise option rules', () =>
    tx(async (client) => {
      await editor(client);
      const { lessonId, itemIds } = await newLesson(client, { items: 4 });
      const [a, b, c, d] = itemIds;
      const ex = (fields) => rpc(client, 'create_exercise', [lessonId, fields]);
      const ok = await call(client, 'create_exercise', [
        lessonId,
        {
          kind: 'meaning',
          answer: a,
          prompt: 'What does this mean?',
          options: [b, c, d],
        },
      ]);
      assert.match(ok, /^ps-exr-[0-9a-f]{6}$/);
      await call(client, 'create_exercise', [
        lessonId,
        {
          kind: 'assemble',
          answer: a,
          prompt: 'Build the sentence "Meaning 1".',
        },
      ]);

      await expectCode(
        ex({ kind: 'meaning', answer: a, prompt: 'x', options: [a, b] }),
        'PL422_OPTION_EQUALS_ANSWER',
      );
      await expectCode(
        ex({ kind: 'assemble', answer: a, prompt: 'x', options: [b] }),
        'PL422_BAD_OPTION',
      );
      await expectCode(
        ex({ kind: 'translation', answer: a, prompt: 'x', options: [] }),
        'PL422_BAD_OPTION',
      );
      await expectCode(
        ex({ kind: 'meaning', answer: a, prompt: 'x', options: [DEMO_ITEM] }),
        'PL422_BAD_OPTION',
      );
      await expectCode(
        ex({ kind: 'meaning', answer: DEMO_ITEM, prompt: 'x', options: [b] }),
        'PL422_BAD_OPTION',
      );
      await expectCode(
        ex({ kind: 'meaning', answer: a, prompt: 'x', options: [b, b] }),
        'PL422_BAD_OPTION',
      );
      await expectCode(
        ex({ kind: 'riddle', answer: a, prompt: 'x' }),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        ex({ kind: 'meaning', prompt: 'x', options: [b] }),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        ex({
          kind: 'meaning',
          answer: a,
          prompt: 'x',
          options: [b],
          difficulty: 9,
        }),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        ex({ kind: 'meaning', answer: a, prompt: '', options: [b] }),
        'PL422_LENGTH',
      );

      // A choice with the same meaning as the answer is refused too.
      const twin = await call(client, 'create_item', [
        lessonId,
        item(7, { meaning: ' meaning 1 ' }),
      ]);
      await expectCode(
        ex({ kind: 'meaning', answer: a, prompt: 'x', options: [twin.id] }),
        'PL422_OPTION_EQUALS_ANSWER',
      );
    }));
});

describe('editing', () => {
  test('a stale revision is refused; nothing changed is refused', () =>
    tx(async (client) => {
      await editor(client);
      const { unitId, lessonId, itemIds } = await newLesson(client, {
        items: 2,
      });
      await expectCode(
        rpc(client, 'update_item', [itemIds[0], 7, { meaning: 'Hello there' }]),
        'PL409_STALE_EDIT',
      );
      await expectCode(
        rpc(client, 'update_item', [itemIds[0], 1, { meaning: 'Meaning 1' }]),
        'PL422_NO_CHANGE',
      );
      const saved = await call(client, 'update_item', [
        itemIds[0],
        1,
        { meaning: 'Hello there' },
      ]);
      assert.equal(saved.revision_no, 2);
      // The editor who saw revision 1 is now stale.
      const stale = await expectCode(
        rpc(client, 'update_item', [itemIds[0], 1, { meaning: 'Hi' }]),
        'PL409_STALE_EDIT',
      );
      assert.equal(JSON.parse(stale.detail).current_revision, 2);

      const lessonRev = await value(
        client,
        'select revision_no from content.lessons where id = $1',
        [lessonId],
      );
      await expectCode(
        rpc(client, 'update_lesson', [
          lessonId,
          lessonRev + 1,
          { title: 'New' },
        ]),
        'PL409_STALE_EDIT',
      );
      await expectCode(
        rpc(client, 'update_lesson', [lessonId, lessonRev, {}]),
        'PL422_NO_CHANGE',
      );
      const lesson = await call(client, 'update_lesson', [
        lessonId,
        lessonRev,
        { title: 'Finding the way', estimated_minutes: 5 },
      ]);
      assert.equal(lesson.revision_no, lessonRev + 1);
      await expectCode(
        rpc(client, 'update_lesson', [
          lessonId,
          lesson.revision_no,
          { variety: 'hno-var-hazara' },
        ]),
        'PL422_VARIETY_MISMATCH',
      );
      await expectCode(
        rpc(client, 'update_lesson', [
          lessonId,
          lesson.revision_no,
          { estimated_minutes: 60 },
        ]),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'update_lesson', [
          lessonId,
          lesson.revision_no,
          { review_status: 'approved' },
        ]),
        'PL422_BAD_INPUT',
      );

      await expectCode(
        rpc(client, 'update_unit', [unitId, 2, { title: 'Around town' }]),
        'PL409_STALE_EDIT',
      );
      await expectCode(
        rpc(client, 'update_unit', [unitId, 1, { goal: 'Short' }]),
        'PL422_LENGTH',
      );
      assert.equal(
        (
          await call(client, 'update_unit', [
            unitId,
            1,
            { title: 'Around town' },
          ])
        ).revision_no,
        2,
      );
      await expectCode(
        rpc(client, 'update_unit', ['ps-unt-000000', 1, { title: 'x' }]),
        'PL404_NOT_FOUND',
      );
      await expectCode(
        rpc(client, 'update_unit', [unitId, 2, { title: 'Around town' }]),
        'PL422_NO_CHANGE',
      );
      await expectCode(
        rpc(client, 'update_lesson', ['ps-lsn-000000', 1, { title: 'x' }]),
        'PL404_NOT_FOUND',
      );
      await expectCode(
        rpc(client, 'create_exercise', [
          'ps-lsn-000000',
          { kind: 'assemble', answer: itemIds[0], prompt: 'x' },
        ]),
        'PL404_NOT_FOUND',
      );
      // Editing text runs the same text rules.
      const smart = await expectCode(
        rpc(client, 'update_item', [itemIds[1], 1, { native: 'سل“ام' }]),
        'PL422_SMART_QUOTE',
      );
      assert.match(smart.message, /position 3/);
      await expectCode(
        rpc(client, 'update_item', [itemIds[1], null, { meaning: 'x' }]),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'update_item', ['ps-itm-000000', 1, { meaning: 'x' }]),
        'PL404_NOT_FOUND',
      );
    }));

  test('a text edit voids the approval of the phrase and its lesson', () =>
    tx(async (client) => {
      const ed = await editor(client);
      const { lessonId, itemIds } = await newLesson(client, { items: 2 });
      await asPostgres(client);
      await client.query(
        "update content.items set review_status = 'approved', last_approved_seq = 1 where id = $1",
        [itemIds[0]],
      );
      await client.query(
        "update content.lessons set review_status = 'approved', last_approved_seq = 1 where id = $1",
        [lessonId],
      );
      await as(client, ed);
      const rev = await value(
        client,
        'select revision_no from content.items where id = $1',
        [itemIds[0]],
      );
      // Only the source caveat: not learner-visible, the approval stands.
      const quiet = await call(client, 'update_item', [
        itemIds[0],
        rev,
        { source_caveat: 'Checked twice.' },
      ]);
      assert.equal(quiet.review_status, 'approved');
      const edited = await call(client, 'update_item', [
        itemIds[0],
        quiet.revision_no,
        { native: 'سلامونه' },
      ]);
      assert.equal(edited.review_status, 'unreviewed');
      const row = await one(
        client,
        `select i.text_author, i.review_status, (select count(*)::int from content.revisions r
           where r.object_type = 'item' and r.object_id = i.id and r.reason = 'edit') as edits
         from content.items i where i.id = $1`,
        [itemIds[0]],
      );
      assert.deepEqual(row, {
        text_author: ed.contributorId,
        review_status: 'unreviewed',
        edits: 2,
      });

      // The lesson's approval goes when its exercises change.
      await asPostgres(client);
      await client.query(
        "update content.lessons set review_status = 'approved' where id = $1",
        [lessonId],
      );
      await as(client, ed);
      await call(client, 'create_exercise', [
        lessonId,
        {
          kind: 'meaning',
          answer: itemIds[0],
          prompt: 'What does this mean?',
          options: [itemIds[1]],
        },
      ]);
      assert.equal(
        await value(
          client,
          'select review_status from content.lessons where id = $1',
          [lessonId],
        ),
        'unreviewed',
      );
    }));

  test('exercises update under the same rules', () =>
    tx(async (client) => {
      await editor(client);
      const { itemIds, exerciseIds } = await newLesson(client, {
        items: 3,
        exercises: true,
      });
      const [first] = exerciseIds;
      const saved = await call(client, 'update_exercise', [
        first,
        1,
        { prompt: 'What does it mean?', difficulty: 2 },
      ]);
      assert.equal(saved.revision_no, 2);
      await expectCode(
        rpc(client, 'update_exercise', [first, 1, { prompt: 'x' }]),
        'PL409_STALE_EDIT',
      );
      await expectCode(
        rpc(client, 'update_exercise', [first, 2, { options: [itemIds[0]] }]),
        'PL422_OPTION_EQUALS_ANSWER',
      );
      await expectCode(
        rpc(client, 'update_exercise', [first, 2, { kind: 'assemble' }]),
        'PL422_BAD_OPTION',
      );
      const assembled = await call(client, 'update_exercise', [
        first,
        2,
        { kind: 'assemble', options: [] },
      ]);
      assert.equal(assembled.revision_no, 3);
      await expectCode(
        rpc(client, 'update_exercise', [
          first,
          3,
          { prompt: 'What does it mean?' },
        ]),
        'PL422_NO_CHANGE',
      );
      await expectCode(
        rpc(client, 'update_exercise', ['ps-exr-000000', 1, { prompt: 'x' }]),
        'PL404_NOT_FOUND',
      );
    }));

  test('a new lesson variety carries the phrases in the old one', () =>
    tx(async (client) => {
      const ed = await editor(client);
      const { lessonId, itemIds } = await newLesson(client, { items: 2 });
      // A third phrase set to another variety on purpose stays where it is.
      const odd = (
        await call(client, 'create_item', [
          lessonId,
          item(2, { variety: 'ps-var-fixture' }),
        ])
      ).id;
      await asPostgres(client);
      await client.query(
        "update content.items set review_status = 'approved', last_approved_seq = 1 where id = any ($1)",
        [itemIds],
      );
      await as(client, ed);
      const rev = await value(
        client,
        'select revision_no from content.lessons where id = $1',
        [lessonId],
      );
      await call(client, 'update_lesson', [
        lessonId,
        rev,
        { variety: 'ps-var-fixture' },
      ]);
      const rows = (
        await client.query(
          'select id, variety_id, review_status from content.items where lesson_id = $1 order by position',
          [lessonId],
        )
      ).rows;
      assert.deepEqual(rows, [
        {
          id: itemIds[0],
          variety_id: 'ps-var-fixture',
          review_status: 'unreviewed',
        },
        {
          id: itemIds[1],
          variety_id: 'ps-var-fixture',
          review_status: 'unreviewed',
        },
        { id: odd, variety_id: 'ps-var-fixture', review_status: 'unreviewed' },
      ]);

      // Back again: the two that followed come back; the one that was
      // already in the new variety follows as well, since it is now in the
      // lesson's old variety.
      const rev2 = await value(
        client,
        'select revision_no from content.lessons where id = $1',
        [lessonId],
      );
      await call(client, 'update_lesson', [
        lessonId,
        rev2,
        { variety: 'ps-var-yusufzai' },
      ]);
      assert.deepEqual(
        (
          await client.query(
            'select distinct variety_id from content.items where lesson_id = $1',
            [lessonId],
          )
        ).rows,
        [{ variety_id: 'ps-var-yusufzai' }],
      );
      await asPostgres(client);
      const audit = await one(
        client,
        "select detail from public.audit_events where action = 'content.updated' and target_type = 'lesson' and target_id = $1 order by id desc limit 1",
        [lessonId],
      );
      assert.deepEqual(audit.detail.variety, {
        from: 'ps-var-fixture',
        to: 'ps-var-yusufzai',
      });
      assert.equal(audit.detail.items_moved_variety.length, 3);
    }));
});

describe('ordering and moving', () => {
  test('reorder_children sets positions in the given order', () =>
    tx(async (client) => {
      await editor(client);
      const { lessonId, itemIds, exerciseIds } = await newLesson(client, {
        items: 3,
        exercises: true,
      });
      const reversed = [...itemIds].reverse();
      const result = await call(client, 'reorder_children', [
        'lesson',
        lessonId,
        reversed,
      ]);
      assert.equal(result.child_type, 'item');
      assert.deepEqual(
        (await positions(client, 'items', 'lesson_id', lessonId)).map(
          (r) => r.id,
        ),
        reversed,
      );
      const reasons = await value(
        client,
        `select array_agg(distinct reason) from content.revisions
         where object_type = 'item' and object_id = any ($1) and revision_no > 1`,
        [itemIds],
      );
      assert.deepEqual(reasons, ['reorder']);

      const exOrder = [exerciseIds[5], ...exerciseIds.slice(0, 5)];
      assert.equal(
        (await call(client, 'reorder_children', ['lesson', lessonId, exOrder]))
          .child_type,
        'exercise',
      );
      assert.deepEqual(
        (await positions(client, 'exercises', 'lesson_id', lessonId)).map(
          (r) => r.id,
        ),
        exOrder,
      );
      await client.query('set constraints all immediate');

      await expectCode(
        rpc(client, 'reorder_children', ['lesson', lessonId, itemIds.slice(1)]),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'reorder_children', [
          'lesson',
          lessonId,
          [itemIds[0], itemIds[0], itemIds[1]],
        ]),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'reorder_children', [
          'lesson',
          lessonId,
          [itemIds[0], exerciseIds[0]],
        ]),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'reorder_children', ['galaxy', lessonId, itemIds]),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'reorder_children', ['lesson', 'ps-lsn-000000', itemIds]),
        'PL404_NOT_FOUND',
      );

      // Units in a course and lessons in a unit.
      const units = (
        await positions(client, 'units', 'course_id', FIXTURE_COURSE)
      ).map((r) => r.id);
      await call(client, 'reorder_children', [
        'course',
        FIXTURE_COURSE,
        [...units].reverse(),
      ]);
      assert.deepEqual(
        (await positions(client, 'units', 'course_id', FIXTURE_COURSE)).map(
          (r) => r.id,
        ),
        [...units].reverse(),
      );
      await call(client, 'reorder_children', [
        'unit',
        FIXTURE_UNIT,
        ['ps-lsn-f00002', 'ps-lsn-f00001'],
      ]);
      await client.query('set constraints all immediate');
    }));

  test('move_content carries a phrase, a lesson or a unit and closes the gap', () =>
    tx(async (client) => {
      const ed = await editor(client);
      const from = await newLesson(client, { items: 3 });
      const to = await newLesson(client, { items: 1 });
      const moved = await call(client, 'move_content', [
        'item',
        from.itemIds[0],
        to.lessonId,
        1,
      ]);
      assert.equal(moved.position, 1);
      assert.deepEqual(
        (await positions(client, 'items', 'lesson_id', from.lessonId)).map(
          (r) => [r.id, r.position],
        ),
        [
          [from.itemIds[1], 1],
          [from.itemIds[2], 2],
        ],
      );
      assert.deepEqual(
        (await positions(client, 'items', 'lesson_id', to.lessonId)).map(
          (r) => r.id,
        ),
        [from.itemIds[0], to.itemIds[0]],
      );
      assert.equal(
        await value(
          client,
          "select reason from content.revisions where object_type = 'item' and object_id = $1 order by seq desc limit 1",
          [from.itemIds[0]],
        ),
        'move',
      );

      // A phrase an exercise uses stays put.
      await call(client, 'create_exercise', [
        from.lessonId,
        {
          kind: 'meaning',
          answer: from.itemIds[1],
          prompt: 'What does this mean?',
          options: [from.itemIds[2]],
        },
      ]);
      await expectCode(
        rpc(client, 'move_content', ['item', from.itemIds[2], to.lessonId]),
        'PL409_ITEM_IN_USE',
      );
      await expectCode(
        rpc(client, 'move_content', ['item', to.itemIds[0], to.lessonId]),
        'PL422_NO_CHANGE',
      );
      await expectCode(
        rpc(client, 'move_content', ['exercise', 'ps-exr-f00001', to.lessonId]),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'move_content', ['item', to.itemIds[0], 'ur-lsn-000000']),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'move_content', ['item', to.itemIds[0], 'ps-lsn-000000']),
        'PL404_NOT_FOUND',
      );
      const full = await newLesson(client, { items: 12 });
      await expectCode(
        rpc(client, 'move_content', ['item', to.itemIds[0], full.lessonId]),
        'PL422_LESSON_FULL',
      );

      // A lesson to another unit takes the unit's course along.
      await call(client, 'move_content', ['lesson', to.lessonId, from.unitId]);
      const lesson = await one(
        client,
        'select unit_id, course_id, position from content.lessons where id = $1',
        [to.lessonId],
      );
      assert.deepEqual(lesson, {
        unit_id: from.unitId,
        course_id: FIXTURE_COURSE,
        position: 2,
      });
      // A unit to another course of the same language.
      await asPostgres(client);
      await client.query(
        `insert into content.courses (id, language_code, variety_id, name) values ('ps-crs-second', 'ps', 'ps-var-yusufzai', 'Second course')`,
      );
      await as(client, ed);
      await call(client, 'move_content', [
        'unit',
        from.unitId,
        'ps-crs-second',
      ]);
      assert.equal(
        await value(
          client,
          'select course_id from content.lessons where id = $1',
          [to.lessonId],
        ),
        'ps-crs-second',
      );
      await client.query('set constraints all immediate');
    }));
});

describe('retiring', () => {
  test('a phrase in use is refused; retiring closes the gap and retires the id', () =>
    tx(async (client) => {
      await editor(client);
      const { lessonId, itemIds, exerciseIds } = await newLesson(client, {
        items: 3,
        exercises: true,
      });
      const inUse = await expectCode(
        rpc(client, 'retire_content', ['item', itemIds[1], 'Not needed']),
        'PL409_ITEM_IN_USE',
      );
      assert.ok(JSON.parse(inUse.detail).exercises.length > 0);
      await expectCode(
        rpc(client, 'retire_content', ['item', itemIds[1], '  ']),
        'PL422_COMMENT_REQUIRED',
      );
      await expectCode(
        rpc(client, 'retire_content', ['planet', itemIds[1], 'x']),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'retire_content', ['item', 'ps-itm-000000', 'x']),
        'PL404_NOT_FOUND',
      );

      // Retire the exercises that use it, then the phrase.
      for (const id of exerciseIds) {
        const ex = await one(
          client,
          'select answer_item_id, options from content.exercises where id = $1',
          [id],
        );
        if (ex.answer_item_id === itemIds[1] || ex.options.includes(itemIds[1]))
          await call(client, 'retire_content', [
            'exercise',
            id,
            'Uses a retired phrase',
          ]);
      }
      const done = await call(client, 'retire_content', [
        'item',
        itemIds[1],
        'Not needed',
      ]);
      assert.deepEqual(done.retired, [itemIds[1]]);
      assert.deepEqual(
        (await positions(client, 'items', 'lesson_id', lessonId)).map((r) => [
          r.id,
          r.position,
        ]),
        [
          [itemIds[0], 1],
          [itemIds[2], 2],
        ],
      );
      assert.ok(
        await value(
          client,
          'select retired_at is not null from content.id_registry where id = $1',
          [itemIds[1]],
        ),
      );
      await expectCode(
        rpc(client, 'retire_content', ['item', itemIds[1], 'Again']),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'update_item', [itemIds[1], 2, { meaning: 'x' }]),
        'PL409_RETIRED',
      );
      await client.query('set constraints all immediate');
    }));

  test('a lesson takes its phrases and exercises; a unit its lessons', () =>
    tx(async (client) => {
      await editor(client);
      const a = await newLesson(client, { items: 3, exercises: true });
      const result = await call(client, 'retire_content', [
        'unit',
        a.unitId,
        'Merged elsewhere',
      ]);
      assert.deepEqual(
        [...result.retired].sort(byText),
        [...a.exerciseIds, ...a.itemIds, a.lessonId, a.unitId].sort(byText),
      );
      const live = await value(
        client,
        `select count(*)::int from content.items where lesson_id = $1 and retired_at is null`,
        [a.lessonId],
      );
      assert.equal(live, 0);
      await expectCode(
        rpc(client, 'create_item', [a.lessonId, item(4)]),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'create_lesson', [
          a.unitId,
          'Late',
          'Into a retired unit.',
        ]),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'submit_lesson', [a.lessonId]),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'reorder_children', ['lesson', a.lessonId, a.itemIds]),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'move_content', ['lesson', a.lessonId, FIXTURE_UNIT]),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'update_unit', [a.unitId, 1, { title: 'Back' }]),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'update_lesson', [a.lessonId, 99, { title: 'Back' }]),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'update_exercise', [
          a.exerciseIds[0],
          99,
          { prompt: 'Back' },
        ]),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'create_exercise', [
          a.lessonId,
          { kind: 'assemble', answer: a.itemIds[0], prompt: 'Build it.' },
        ]),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'withdraw_lesson_submission', [a.lessonId]),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'retire_content', ['lesson', a.lessonId, 'Twice']),
        'PL409_RETIRED',
      );

      // Courses: admin only, and they take everything under them.
      await asPostgres(client);
      await client.query(
        "insert into content.courses (id, language_code, variety_id, name) values ('ps-crs-old', 'ps', 'ps-var-yusufzai', 'Old course')",
      );
      await admin(client);
      const u = await call(client, 'create_unit', [
        'ps-crs-old',
        'Old unit',
        'Kept for a while.',
      ]);
      const gone = await call(client, 'retire_content', [
        'course',
        'ps-crs-old',
        'Replaced',
      ]);
      assert.deepEqual(
        [...gone.retired].sort(byText),
        ['ps-crs-old', u].sort(byText),
      );
      await expectCode(
        rpc(client, 'create_unit', [
          'ps-crs-old',
          'New unit',
          'Into a retired course.',
        ]),
        'PL409_RETIRED',
      );
      await expectCode(
        rpc(client, 'set_publish_gate', [
          'course',
          'ps-crs-old',
          'blocked',
          'x',
        ]),
        'PL409_RETIRED',
      );
      await client.query('set constraints all immediate');
    }));
});

describe('demo content', () => {
  test('demo lessons, phrases and exercises are frozen', () =>
    tx(async (client) => {
      await editor(client);
      for (const [fn, args] of [
        ['update_item', [DEMO_ITEM, 1, { meaning: 'Hi' }]],
        ['update_lesson', [DEMO_LESSON, 1, { title: 'Hi' }]],
        ['update_exercise', ['ps-exr-f00001', 1, { prompt: 'Hi' }]],
        ['create_item', [DEMO_LESSON, item(0)]],
        [
          'create_exercise',
          [
            DEMO_LESSON,
            { kind: 'assemble', answer: DEMO_ITEM, prompt: 'Build it.' },
          ],
        ],
        [
          'reorder_children',
          ['lesson', DEMO_LESSON, ['ps-itm-f00002', DEMO_ITEM]],
        ],
        ['move_content', ['item', DEMO_ITEM, 'ps-lsn-f00002']],
        ['move_content', ['lesson', DEMO_LESSON, FIXTURE_UNIT]],
        ['retire_content', ['item', DEMO_ITEM, 'Old']],
        ['retire_content', ['exercise', 'ps-exr-f00001', 'Old']],
        ['retire_content', ['lesson', DEMO_LESSON, 'Old']],
        ['retire_content', ['unit', FIXTURE_UNIT, 'Old']],
        ['submit_lesson', [DEMO_LESSON]],
        ['withdraw_lesson_submission', [DEMO_LESSON]],
      ])
        await expectCode(rpc(client, fn, args), 'PL409_DEMO_FROZEN');
      // A new phrase cannot move into a demo lesson either.
      const { itemIds } = await newLesson(client, { items: 1 });
      await expectCode(
        rpc(client, 'move_content', ['item', itemIds[0], DEMO_LESSON]),
        'PL409_DEMO_FROZEN',
      );
      // Demo lessons may still shift when a lesson goes in before them.
      await call(client, 'create_lesson', [
        FIXTURE_UNIT,
        'Before',
        'Goes first in the unit.',
        '',
        null,
        null,
        1,
      ]);
      assert.equal(
        await value(
          client,
          'select position from content.lessons where id = $1',
          [DEMO_LESSON],
        ),
        2,
      );
    }));
});

describe('review hand-off', () => {
  test('submit needs a sound lesson with 6 exercises; withdraw undoes it', () =>
    tx(async (client) => {
      const ed = await editor(client);
      const empty = await newLesson(client);
      const noItems = await expectCode(
        rpc(client, 'submit_lesson', [empty.lessonId]),
        'PL422_LESSON_PROBLEMS',
      );
      assert.match(noItems.message, /Fix this first: /);

      const few = await newLesson(client, { items: 3 });
      for (const answer of few.itemIds.slice(0, 1))
        await call(client, 'create_exercise', [
          few.lessonId,
          {
            kind: 'meaning',
            answer,
            prompt: 'What does this mean?',
            options: [few.itemIds[1]],
          },
        ]);
      await expectCode(
        rpc(client, 'submit_lesson', [few.lessonId]),
        'PL422_TOO_FEW_EXERCISES',
      );

      const ready = await newLesson(client, { items: 3, exercises: true });
      const submitted = await call(client, 'submit_lesson', [ready.lessonId]);
      assert.equal(submitted.already, false);
      assert.ok(submitted.submitted_at);
      const queued = await value(
        client,
        "select count(*)::int from content.review_queue where lesson_id = $1 and target_type = 'lesson'",
        [ready.lessonId],
      );
      assert.equal(queued, 1);
      assert.equal(
        (await call(client, 'submit_lesson', [ready.lessonId])).already,
        true,
      );
      const withdrawn = await call(client, 'withdraw_lesson_submission', [
        ready.lessonId,
      ]);
      assert.equal(withdrawn.submitted_at, null);
      assert.equal(
        (await call(client, 'withdraw_lesson_submission', [ready.lessonId]))
          .already,
        true,
      );
      await expectCode(
        rpc(client, 'submit_lesson', ['ps-lsn-000000']),
        'PL404_NOT_FOUND',
      );
      await expectCode(
        rpc(client, 'withdraw_lesson_submission', ['ps-lsn-000000']),
        'PL404_NOT_FOUND',
      );

      // An approved lesson is refused: nothing to review.
      await asPostgres(client);
      await client.query(
        "update content.lessons set review_status = 'approved' where id = $1",
        [ready.lessonId],
      );
      await as(client, ed);
      await expectCode(
        rpc(client, 'submit_lesson', [ready.lessonId]),
        'PL422_NO_CHANGE',
      );
    }));

  test('a lesson sent back by a reviewer goes again only after a change', () =>
    tx(async (client) => {
      const ed = await editor(client);
      const { lessonId, itemIds } = await newLesson(client, {
        items: 3,
        exercises: true,
      });

      // Everything so far happened an hour ago; a reviewer decided half an
      // hour ago. (The test is one transaction, so now() never moves.)
      const sendBack = async (decision) => {
        await asPostgres(client);
        await client.query("set local session_replication_role = 'replica'");
        await client.query(
          "update content.revisions set at = at - interval '1 hour' where lesson_id = $1 and at > now() - interval '1 minute'",
          [lessonId],
        );
        await client.query("set local session_replication_role = 'origin'");
        const fingerprint = await value(
          client,
          'select review_fingerprint from content.lessons where id = $1',
          [lessonId],
        );
        const decisionId = await value(
          client,
          `insert into content.review_decisions
             (target_type, lesson_id, variety_id, decision, reviewer_contributor_id, seen_fingerprint, comment, at)
           values ('lesson', $1, 'ps-var-yusufzai', $2, $3, $4, 'Fix the second phrase.', now() - interval '30 minutes')
           returning id`,
          [lessonId, decision, ed.contributorId, fingerprint],
        );
        await client.query(
          `update content.lessons set review_status = $2, current_decision_id = $3, submitted_at = null
           where id = $1`,
          [
            lessonId,
            decision === 'reject' ? 'rejected' : 'changes_requested',
            decisionId,
          ],
        );
        await as(client, ed);
        return decisionId;
      };

      await sendBack('request_changes');
      const before = await call(client, 'page_edit_lesson', [lessonId]);
      assert.equal(before.lesson.changed_since_review, false);
      const unchanged = await expectCode(
        rpc(client, 'submit_lesson', [lessonId]),
        'PL422_NO_CHANGE',
      );
      assert.match(unchanged.message, /Nothing has changed since the review/);

      // A phrase's text is not in the lesson's fingerprint, but it counts.
      const rev = await value(
        client,
        'select revision_no from content.items where id = $1',
        [itemIds[1]],
      );
      await call(client, 'update_item', [
        itemIds[1],
        rev,
        { meaning: 'A clearer meaning' },
      ]);
      assert.equal(
        await value(
          client,
          'select review_status from content.lessons where id = $1',
          [lessonId],
        ),
        'changes_requested',
      );
      const after = await call(client, 'page_edit_lesson', [lessonId]);
      assert.equal(after.lesson.changed_since_review, true);
      const revisionBefore = after.lesson.revision_no;
      const resent = await call(client, 'submit_lesson', [lessonId]);
      assert.equal(resent.already, false);
      assert.equal(resent.review_status, 'unreviewed');
      assert.ok(resent.submitted_at);
      const row = await one(
        client,
        'select review_status, current_decision_id, submitted_at is not null as submitted, revision_no from content.lessons where id = $1',
        [lessonId],
      );
      assert.deepEqual(row, {
        review_status: 'unreviewed',
        current_decision_id: null,
        submitted: true,
        revision_no: revisionBefore,
      });
      assert.equal(
        await value(
          client,
          "select count(*)::int from content.review_queue where lesson_id = $1 and target_type = 'lesson'",
          [lessonId],
        ),
        1,
      );
      await asPostgres(client);
      const audit = await one(
        client,
        "select detail from public.audit_events where action = 'content.submitted' and target_id = $1 order by id desc limit 1",
        [lessonId],
      );
      assert.equal(audit.detail.previous_status, 'changes_requested');
      await as(client, ed);

      // A rejected lesson: the same rule.
      await sendBack('reject');
      await expectCode(
        rpc(client, 'submit_lesson', [lessonId]),
        'PL422_NO_CHANGE',
      );
      const exRev = await value(
        client,
        'select revision_no from content.items where id = $1',
        [itemIds[0]],
      );
      await call(client, 'update_item', [
        itemIds[0],
        exRev,
        { usage_note: 'Said to elders.' },
      ]);
      assert.equal(
        (await call(client, 'submit_lesson', [lessonId])).review_status,
        'unreviewed',
      );
    }));

  test('check_lesson and the page reads', () =>
    tx(async (client) => {
      const ed = await editor(client);
      const { lessonId, unitId, itemIds } = await newLesson(client, {
        items: 3,
        exercises: true,
      });
      const checked = await call(client, 'check_lesson', [lessonId]);
      assert.equal(checked.blocking, 0);
      assert.equal(checked.effective_gate, 'blocked');
      await expectCode(
        rpc(client, 'check_lesson', ['ps-lsn-000000']),
        'PL404_NOT_FOUND',
      );

      const tree = await call(client, 'page_edit_tree');
      const ps = tree.languages.find((l) => l.code === 'ps');
      assert.ok(
        ps.varieties.some(
          (v) => v.id === 'ps-var-yusufzai' && v.reviewers === 2,
        ),
      );
      const course = ps.courses.find((c) => c.id === FIXTURE_COURSE);
      const unit = course.units.find((u) => u.id === unitId);
      assert.equal(unit.publish_gate, 'blocked');
      assert.deepEqual(
        unit.lessons.map((l) => [l.id, l.items, l.exercises, l.demo]),
        [[lessonId, 3, 6, false]],
      );
      const fixture = course.units.find((u) => u.id === FIXTURE_UNIT);
      assert.ok(fixture.lessons.every((l) => l.demo));

      const page = await call(client, 'page_edit_lesson', [lessonId]);
      assert.equal(page.language.direction, 'rtl');
      assert.equal(page.lesson.demo, false);
      assert.equal(page.lesson.reviewers, 2);
      assert.equal(page.lesson.changed_since_review, false);
      assert.deepEqual(
        page.items.map((i) => i.id),
        itemIds,
      );
      assert.ok(page.items.every((i) => i.used_by > 0));
      assert.equal(page.exercises.length, 6);
      assert.ok(page.revisions.count >= 10);
      assert.ok(page.revisions.recent.every((r) => r.mine));
      assert.equal(page.me, ed.contributorId);
      await expectCode(
        rpc(client, 'page_edit_lesson', ['ps-lsn-000000']),
        'PL404_NOT_FOUND',
      );
      await expectCode(
        rpc(client, 'page_edit_lesson', ['nonsense']),
        'PL404_NOT_FOUND',
      );
    }));
});

describe('gates and the demo sunset', () => {
  test('opening a variety or language gate needs an active reviewer', () =>
    tx(async (client) => {
      await admin(client);
      // The fixture variety has no reviewer.
      await call(client, 'set_publish_gate', [
        'variety',
        'ps-var-fixture',
        'blocked',
        'Hold',
      ]);
      const refusal = await expectCode(
        rpc(client, 'set_publish_gate', [
          'variety',
          'ps-var-fixture',
          'open',
          'Go',
        ]),
        'PL409_NO_REVIEWER',
      );
      assert.match(refusal.message, /Fixture variety/);
      // Yusufzai has two.
      await call(client, 'set_publish_gate', [
        'variety',
        'ps-var-yusufzai',
        'blocked',
        'Hold',
      ]);
      const opened = await call(client, 'set_publish_gate', [
        'variety',
        'ps-var-yusufzai',
        'open',
        'Reviewers ready',
      ]);
      assert.equal(opened.gate, 'open');

      // A language with no reviewer anywhere stays shut.
      await asPostgres(client);
      await seedLesson(client, { language: 'ur', items: 1 });
      await client.query(
        "update content.languages set publish_gate = 'blocked' where code = 'ur'",
      );
      await admin(client);
      await expectCode(
        rpc(client, 'set_publish_gate', ['language', 'ur', 'open', 'Go']),
        'PL409_NO_REVIEWER',
      );
      // Hindko has its reviewer.
      await call(client, 'set_publish_gate', [
        'language',
        'hno',
        'open',
        'Reviewer in place',
      ]);

      // Units, with the revision reason 'gate'.
      await call(client, 'set_publish_gate', [
        'unit',
        FIXTURE_UNIT,
        'blocked',
        'Tidy',
      ]);
      assert.equal(
        await value(
          client,
          "select reason from content.revisions where object_type = 'unit' and object_id = $1 order by seq desc limit 1",
          [FIXTURE_UNIT],
        ),
        'gate',
      );
      await expectCode(
        rpc(client, 'set_publish_gate', [
          'unit',
          FIXTURE_UNIT,
          'blocked',
          'Again',
        ]),
        'PL422_NO_CHANGE',
      );
      await expectCode(
        rpc(client, 'set_publish_gate', ['unit', FIXTURE_UNIT, 'ajar', 'x']),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        rpc(client, 'set_publish_gate', ['unit', FIXTURE_UNIT, 'open', '']),
        'PL422_COMMENT_REQUIRED',
      );
      await expectCode(
        rpc(client, 'set_publish_gate', ['unit', 'ps-unt-000000', 'open', 'x']),
        'PL404_NOT_FOUND',
      );
      await asPostgres(client);
      const audit = await value(
        client,
        "select count(*)::int from public.audit_events where action = 'content.gate_changed'",
      );
      assert.ok(audit >= 4);
    }));

  test('set_demo_sunset moves the date, never into the past', () =>
    tx(async (client) => {
      await admin(client);
      const moved = await call(client, 'set_demo_sunset', [
        'ps',
        '2030-06-30',
        'Reviews running late',
      ]);
      assert.equal(moved.live, true);
      await expectCode(
        rpc(client, 'set_demo_sunset', ['ps', '2030-06-30', 'Same']),
        'PL422_NO_CHANGE',
      );
      await expectCode(
        rpc(client, 'set_demo_sunset', ['ps', '2020-01-01', 'Past']),
        'PL422_BAD_DATE',
      );
      await expectCode(
        rpc(client, 'set_demo_sunset', ['ps', null, 'None']),
        'PL422_BAD_DATE',
      );
      await expectCode(
        rpc(client, 'set_demo_sunset', ['ps', '2031-01-01', ' ']),
        'PL422_COMMENT_REQUIRED',
      );
      await expectCode(
        rpc(client, 'set_demo_sunset', ['hno', '2031-01-01', 'No demo']),
        'PL404_NOT_FOUND',
      );
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          "select count(*)::int from public.audit_events where action = 'demo.sunset_changed'",
        ),
        1,
      );
    }));
});
