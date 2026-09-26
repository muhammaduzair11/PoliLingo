// Track F, publish (docs/platform.md §3.5, §3.9 F). Needs a database with the
// migrations and the fixture seed applied: `npm run test:db` (local stack,
// under the lock) or `npm run test:db:ci`. Every test runs in a rolled-back
// transaction.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { canonicalJson } from '../../lib/canonical-json.ts';
import { sha256 } from '../../lib/sha256.ts';
import {
  as,
  asAnon,
  asPostgres,
  expectCode,
  grant,
  one,
  seedLesson,
  tx,
  user,
  value,
} from './helpers.mjs';

// The seeded local accounts (supabase/seeds/10_people.sql).
const person = (n, email) => ({
  id: `00000000-0000-4000-8000-00000000${n}`,
  email,
});
const ADMIN = person('0101', 'admin@polilingo.test');
const EDITOR = person('0102', 'editor@polilingo.test');
const REVIEWER = person('0103', 'reviewer.ps@polilingo.test');
const LEARNER = person('0201', 'learner@polilingo.test');
const NOBODY = { id: null, email: null };

const SEED_RELEASE = 'content@2026.09.1';
const SEED_TODAY = '2026-09-01';
const FIXTURE_COURSE = 'ps-crs-fixture';
const FIXTURE_UNIT = 'ps-unt-f00001';
const DEMO_LESSONS = ['ps-lsn-f00001', 'ps-lsn-f00002'];
const ZERO_HASH = `sha256-${'0'.repeat(64)}`;

const hex6 = () => randomBytes(3).toString('hex');

/** contentHash recomputed in node, as lib/release-verify.ts (G) and the page do. */
function nodeHash(copy) {
  const { languages, varieties, courses, keymap } = copy;
  return `sha256-${sha256(canonicalJson({ languages, varieties, courses, keymap }))}`;
}

const lessonsOf = (copy) =>
  copy.courses.flatMap((c) => c.units.flatMap((u) => u.lessons));
const lessonIdsOf = (copy) => lessonsOf(copy).map((l) => l.id);

/** Signs in as u, or with no user at all (auth.uid() null) for NOBODY. */
async function signIn(client, u) {
  if (u.id) return as(client, u);
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claims', '{}', true)");
}

async function preview(client, u = ADMIN) {
  await signIn(client, u);
  const data = await value(client, 'select public.preview_release()');
  await asPostgres(client);
  return data;
}

async function publish(client, hash, note = null, u = ADMIN) {
  await signIn(client, u);
  try {
    return await value(client, 'select public.publish_release($1, $2)', [
      hash,
      note,
    ]);
  } finally {
    await asPostgres(client);
  }
}

async function build(client, release, today) {
  await asPostgres(client);
  return value(client, 'select private.build_learner_copy($1, $2::date)', [
    release,
    today,
  ]);
}

async function plan(client, release, today) {
  await asPostgres(client);
  const { rows } = await client.query(
    'select * from private.release_plan($1, $2::date)',
    [release, today],
  );
  return new Map(rows.map((r) => [r.lesson_id, r]));
}

const today = (client) =>
  value(
    client,
    "select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD')",
  );

/** Keeps the fixture demo live whatever day the tests run. */
async function keepDemoLive(client) {
  await asPostgres(client);
  await client.query(
    "update content.demo_period set sunset = date '2099-12-31' where language_code = 'ps'",
  );
}

/**
 * A non-demo lesson of `items` phrases and `exercises` exercises, added to
 * an existing unit (by default the fixture unit, next to the demo lessons)
 * through direct inserts as postgres.
 */
async function addLesson(
  client,
  {
    unitId = FIXTURE_UNIT,
    courseId = FIXTURE_COURSE,
    variety = 'ps-var-yusufzai',
    position = 3,
    items = 6,
    exercises = 6,
    title = 'Reviewed greetings',
  } = {},
) {
  await asPostgres(client);
  const lessonId = `ps-lsn-${hex6()}`;
  await client.query(
    `insert into content.lessons (id, course_id, unit_id, position, title, objective, variety_id)
     values ($1, $2, $3, $4, $5, 'Greet someone and thank them.', $6)`,
    [lessonId, courseId, unitId, position, title, variety],
  );
  const natives = ['سلام', 'بابا', 'ماما', 'نان', 'تار', 'دل', 'سر', 'بار'];
  const itemIds = [];
  for (let i = 0; i < items; i += 1) {
    const id = `ps-itm-${hex6()}`;
    await client.query(
      `insert into content.items (id, lesson_id, position, native, romanisation, meaning,
         variety_id, source_type, source_citation, source_licence)
       values ($1, $2, $3, $4, $5, $6, $7, 'original', 'Written for a database test', 'Test data only')`,
      [
        id,
        lessonId,
        i + 1,
        natives[i],
        `Word ${i + 1}`,
        `Meaning ${i + 1}`,
        variety,
      ],
    );
    itemIds.push(id);
  }
  const exerciseIds = [];
  for (let i = 0; i < exercises; i += 1) {
    const id = `ps-exr-${hex6()}`;
    await client.query(
      `insert into content.exercises (id, lesson_id, position, kind, answer_item_id, prompt, options)
       values ($1, $2, $3, 'meaning', $4, 'What does this mean?', $5)`,
      [id, lessonId, i + 1, itemIds[i % items], [itemIds[(i + 1) % items]]],
    );
    exerciseIds.push(id);
  }
  return { lessonId, itemIds, exerciseIds };
}

/** An approve decision by ctr-0103 on the target's current text, made current. */
async function decide(
  client,
  type,
  id,
  { sole = false, countersign = false } = {},
) {
  await asPostgres(client);
  const table = type === 'item' ? 'content.items' : 'content.lessons';
  const target = await one(
    client,
    `select variety_id, review_fingerprint from ${table} where id = $1`,
    [id],
  );
  const decision = await one(
    client,
    `insert into content.review_decisions (target_type, item_id, lesson_id, variety_id, decision,
       reviewer_contributor_id, grant_id, seen_fingerprint, sole_reviewer)
     values ($1::text, case when $1::text = 'item' then $2::text end,
             case when $1::text = 'lesson' then $2::text end, $3, 'approve',
             'ctr-0103', '00000000-0000-4000-a000-000000000103', $4, $5)
     returning id, seq`,
    [type, id, target.variety_id, target.review_fingerprint, sole],
  );
  await client.query(
    `update ${table} set review_status = 'approved', current_decision_id = $2, last_approved_seq = $3
     where id = $1`,
    [id, decision.id, decision.seq],
  );
  if (countersign) await countersignDecision(client, decision.id);
  return decision.id;
}

async function countersignDecision(client, decisionId) {
  await asPostgres(client);
  await client.query(
    `insert into content.countersignatures (decision_id, variety_id, admin_contributor_id, grant_id)
     select d.id, d.variety_id, 'ctr-0101', '00000000-0000-4000-a000-000000000101'
     from content.review_decisions d where d.id = $1`,
    [decisionId],
  );
}

/** Approves every live phrase of a lesson and then the lesson. */
async function approveLesson(client, lessonId, options = {}) {
  await asPostgres(client);
  const { rows } = await client.query(
    'select id from content.items where lesson_id = $1 and retired_at is null order by position',
    [lessonId],
  );
  for (const { id } of rows) await decide(client, 'item', id);
  return decide(client, 'lesson', lessonId, options);
}

const reasonCodes = (row) => (row?.reasons ?? []).map((r) => r.code);

// ---------------------------------------------------------------------------
// Parity with the content repository's build
// ---------------------------------------------------------------------------

describe('the learner copy', () => {
  test('build_learner_copy reproduces the seeded release #1, payload and hash', () =>
    tx(async (client) => {
      const release = await one(
        client,
        'select name, content_hash, payload from content.releases where name = $1',
        [SEED_RELEASE],
      );
      assert.ok(release, 'the fixture seed holds release #1');
      const built = await build(client, SEED_RELEASE, SEED_TODAY);
      assert.deepEqual(built, release.payload);
      assert.equal(built.contentHash, release.content_hash);
      // The same hash from the web's own canonical JSON and SHA-256.
      assert.equal(nodeHash(built), release.content_hash);
      assert.equal(nodeHash(release.payload), release.content_hash);
      assert.deepEqual(
        await value(
          client,
          'select private.verify_learner_copy($1, $2::date)',
          [built, SEED_TODAY],
        ),
        [],
      );
    }));

  test('the fixture lessons are demo candidates, publishable while the demo lasts', () =>
    tx(async (client) => {
      await asPostgres(client);
      const { rows } = await client.query(
        'select * from private.lesson_candidates($1::date) order by lesson_id',
        [SEED_TODAY],
      );
      assert.deepEqual(
        rows.map((r) => [r.lesson_id, r.lesson_class, r.publishable]),
        DEMO_LESSONS.map((id) => [id, 'demo', true]),
      );
    }));

  test('verify_learner_copy names what is wrong with a tampered copy', () =>
    tx(async (client) => {
      const built = await build(client, SEED_RELEASE, SEED_TODAY);
      const tampered = structuredClone(built);
      tampered.courses[0].units[0].lessons[0].title = 'Changed by hand';
      tampered.courses[0].units[0].lessons[0].exercises[0].options = [
        'ps-itm-f00003',
      ];
      const problems = await value(
        client,
        'select private.verify_learner_copy($1, $2::date)',
        [tampered, SEED_TODAY],
      );
      assert.ok(problems.some((p) => p.startsWith('contentHash')));
      assert.ok(problems.some((p) => p.startsWith('Exercises that use')));
      // Past the sunset, the same demo phrases must not ship.
      const late = await value(
        client,
        'select private.verify_learner_copy($1, $2::date)',
        [built, '2026-12-12'],
      );
      assert.ok(late.some((p) => p.startsWith('Starter phrases')));
    }));
});

// ---------------------------------------------------------------------------
// Who may preview, publish and open the page
// ---------------------------------------------------------------------------

describe('access', () => {
  test('preview_release: editors and admins only', () =>
    tx(async (client) => {
      await signIn(client, NOBODY);
      await expectCode(
        client.query('select public.preview_release()'),
        'PL401_NOT_SIGNED_IN',
      );
      for (const u of [LEARNER, REVIEWER]) {
        await signIn(client, u);
        await expectCode(
          client.query('select public.preview_release()'),
          'PL403_NOT_EDITOR',
        );
      }
      await asAnon(client);
      await expectCode(
        client.query('select public.preview_release()'),
        '42501',
      );
      for (const u of [EDITOR, ADMIN]) {
        const data = await preview(client, u);
        assert.match(data.contentHash, /^sha256-[0-9a-f]{64}$/);
      }
    }));

  test('preview_release: an editor scoped to one language sees only its lessons and countersigns', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId } = await addLesson(client, {
        title: 'Secret draft title',
      });
      const decisionId = await approveLesson(client, lessonId, { sole: true });
      const scoped = await user(client);
      await grant(client, scoped, 'editor', { language: 'hno' });

      // The admin sees the Pashto lesson held back and waiting.
      const full = await preview(client);
      assert.ok(full.excluded.some((l) => l.id === lessonId));
      assert.ok(
        full.awaiting_countersign.some((a) => a.decision_id === decisionId),
      );

      const data = await preview(client, scoped);
      assert.deepEqual(data.excluded, []);
      assert.deepEqual(data.awaiting_countersign, []);
      for (const list of ['added', 'changed', 'carried', 'removed'])
        assert.ok(data.diff[list].every((l) => l.language === 'hno'));
      assert.ok(!JSON.stringify(data.excluded).includes('Secret draft title'));
      // What the button would publish is still whole.
      assert.equal(data.contentHash, full.contentHash);

      // An unscoped editor sees everything.
      const all = await preview(client, EDITOR);
      assert.ok(all.excluded.some((l) => l.id === lessonId));
      assert.ok(
        all.awaiting_countersign.some((a) => a.decision_id === decisionId),
      );
    }));

  test('publish_release: admins only, and the hash must look like one', () =>
    tx(async (client) => {
      await signIn(client, NOBODY);
      await expectCode(
        client.query('select public.publish_release($1)', [ZERO_HASH]),
        'PL401_NOT_SIGNED_IN',
      );
      for (const u of [EDITOR, REVIEWER, LEARNER]) {
        await signIn(client, u);
        await expectCode(
          client.query('select public.publish_release($1)', [ZERO_HASH]),
          'PL403_NOT_ADMIN',
        );
      }
      await asAnon(client);
      await expectCode(
        client.query('select public.publish_release($1)', [ZERO_HASH]),
        '42501',
      );
      await expectCode(publish(client, 'not-a-hash'), 'PL422_BAD_INPUT');
      await expectCode(publish(client, null), 'PL422_BAD_INPUT');
      await expectCode(
        publish(client, ZERO_HASH, 'x'.repeat(501)),
        'PL422_LENGTH',
      );
    }));

  test('page_admin_publish: admins only, with history and the preview', () =>
    tx(async (client) => {
      await signIn(client, NOBODY);
      await expectCode(
        client.query('select public.page_admin_publish()'),
        'PL401_NOT_SIGNED_IN',
      );
      await signIn(client, EDITOR);
      await expectCode(
        client.query('select public.page_admin_publish()'),
        'PL403_NOT_ADMIN',
      );
      await signIn(client, ADMIN);
      const page = await value(client, 'select public.page_admin_publish()');
      assert.equal(page.latest.name, SEED_RELEASE);
      assert.equal(nodeHash(page.latest.payload), page.latest.contentHash);
      assert.equal(page.releases[0].name, SEED_RELEASE);
      assert.equal(page.releases[0].kind, 'seed');
      assert.equal(page.releases[0].lessons, 2);
      assert.equal(page.releases[0].items, 4);
      assert.equal(page.releases[0].demo_lessons, 2);
      assert.equal(typeof page.countersign_available, 'boolean');
      assert.match(page.preview.release, /^content@\d{4}\.\d{2}\.\d+$/);
      assert.ok(Array.isArray(page.preview.diff.added));
    }));

  test('the private builders are executable by nobody but their owner', () =>
    tx(async (client) => {
      const { rows } = await client.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private'
           and p.proname in ('build_learner_copy', 'release_plan', 'lesson_candidates',
                             'verify_learner_copy', 'preview_body', 'item_reviewed_ok',
                             'lesson_reviewed_ok', 'next_release_name', 'assemble_learner_copy')
           and (has_function_privilege('authenticated', p.oid, 'execute')
                or has_function_privilege('anon', p.oid, 'execute'))`,
      );
      assert.deepEqual(rows, []);
    }));
});

// ---------------------------------------------------------------------------
// What a build holds
// ---------------------------------------------------------------------------

describe('publishable', () => {
  test('nothing new is refused: PL409_NOTHING_TO_PUBLISH', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const data = await preview(client);
      assert.equal(data.unchanged, true);
      assert.equal(data.base.name, SEED_RELEASE);
      assert.deepEqual(data.diff.added, []);
      assert.deepEqual(data.diff.removed, []);
      await expectCode(
        publish(client, data.contentHash),
        'PL409_NOTHING_TO_PUBLISH',
      );
    }));

  test('an unapproved lesson is held back, with its reasons', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId } = await addLesson(client);
      const data = await preview(client);
      assert.ok(!lessonIdsOf(data.payload).includes(lessonId));
      const held = data.excluded.find((l) => l.id === lessonId);
      assert.ok(held, 'listed as held back');
      assert.deepEqual(reasonCodes(held), [
        'lesson_not_approved',
        'items_not_approved',
      ]);
      assert.equal(held.title, 'Reviewed greetings');
      assert.equal(data.unchanged, true);
    }));

  test('an approved, reviewed lesson with 6 exercises is added, and publishes', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId, itemIds } = await addLesson(client);
      const lessonDecision = await approveLesson(client, lessonId);

      assert.equal(
        await value(client, 'select private.lesson_reviewed_ok($1)', [
          lessonId,
        ]),
        true,
      );
      const data = await preview(client);
      assert.deepEqual(
        data.diff.added.map((l) => [l.id, l.class, l.language]),
        [[lessonId, 'reviewed', 'ps']],
      );
      // The demo lessons stay: their unit is not all reviewed.
      assert.deepEqual(lessonIdsOf(data.payload), [...DEMO_LESSONS, lessonId]);
      assert.equal(nodeHash(data.payload), data.contentHash);

      const expectedName = await value(
        client,
        'select private.next_release_name(now())',
      );
      const result = await publish(
        client,
        data.contentHash,
        'First reviewed lesson',
      );
      assert.deepEqual(result, {
        name: expectedName,
        contentHash: data.contentHash,
        lessons: 3,
        items: 10,
      });

      const stored = await one(
        client,
        'select seq, kind, content_hash, payload, published_by, note from content.releases where name = $1',
        [expectedName],
      );
      assert.equal(stored.kind, 'publish');
      assert.equal(stored.published_by, 'ctr-0101');
      assert.equal(stored.note, 'First reviewed lesson');
      assert.equal(stored.payload.release, expectedName);
      assert.equal(nodeHash(stored.payload), stored.content_hash);

      const { rows: lessons } = await client.query(
        `select lesson_id, lesson_class, source, decision_id from content.release_lessons
         where release_seq = $1 order by lesson_id`,
        [stored.seq],
      );
      const byId = new Map(lessons.map((l) => [l.lesson_id, l]));
      assert.equal(byId.get(lessonId).lesson_class, 'reviewed');
      assert.equal(byId.get(lessonId).source, 'current');
      assert.equal(byId.get(lessonId).decision_id, lessonDecision);
      for (const id of DEMO_LESSONS) {
        assert.equal(byId.get(id).lesson_class, 'demo');
        assert.equal(byId.get(id).decision_id, null);
      }
      assert.equal(
        await value(
          client,
          `select count(*)::int from content.release_items
           where release_seq = $1 and item_id = any ($2) and not is_demo and decision_id is not null`,
          [stored.seq, itemIds],
        ),
        6,
      );
      const audit = await one(
        client,
        `select actor_contributor_id, detail from public.audit_events
         where action = 'release.published' and target_id = $1`,
        [expectedName],
      );
      assert.equal(audit.actor_contributor_id, 'ctr-0101');
      assert.equal(audit.detail.content_hash, data.contentHash);

      // Published: the next preview has nothing new.
      const after = await preview(client);
      assert.equal(after.unchanged, true);
      assert.equal(after.base.name, expectedName);
    }));

  test('a reviewed lesson with fewer than 6 exercises is held back', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId } = await addLesson(client, { exercises: 5 });
      await approveLesson(client, lessonId);
      const rows = await plan(client, 'content@2099.01.1', await today(client));
      assert.equal(rows.get(lessonId).included, false);
      assert.deepEqual(reasonCodes(rows.get(lessonId)), ['too_few_exercises']);
    }));

  test('a sole-reviewer approval waits for its countersign', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId } = await addLesson(client);
      const decisionId = await approveLesson(client, lessonId, { sole: true });
      let data = await preview(client);
      assert.deepEqual(
        reasonCodes(data.excluded.find((l) => l.id === lessonId)),
        ['awaiting_countersign'],
      );
      const waiting = data.awaiting_countersign.find(
        (a) => a.decision_id === decisionId,
      );
      assert.ok(waiting, 'in the countersign queue');
      assert.equal(waiting.lesson_title, 'Reviewed greetings');
      assert.equal(waiting.reviewer_name, 'Local Pashto Reviewer');

      await countersignDecision(client, decisionId);
      data = await preview(client);
      assert.ok(lessonIdsOf(data.payload).includes(lessonId));
      assert.ok(
        !data.awaiting_countersign.some((a) => a.decision_id === decisionId),
      );
    }));

  test('a lesson mid-edit is carried forward as it was published', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId, itemIds } = await addLesson(client);
      await approveLesson(client, lessonId);
      const first = await preview(client);
      const { name } = await publish(client, first.contentHash);

      // An editor changes a phrase: its approval is void until re-reviewed.
      await asPostgres(client);
      await client.query(
        "update content.items set meaning = 'Greetings!' where id = $1",
        [itemIds[0]],
      );
      assert.equal(
        await value(client, 'select private.item_reviewed_ok($1)', [
          itemIds[0],
        ]),
        false,
      );

      const data = await preview(client);
      assert.deepEqual(
        data.diff.carried.map((l) => l.id),
        [lessonId],
      );
      // The page can say what the edit still needs.
      assert.deepEqual(reasonCodes(data.diff.carried[0]), [
        'items_not_approved',
      ]);
      const lesson = lessonsOf(data.payload).find((l) => l.id === lessonId);
      assert.equal(
        lesson.items[0].meaning,
        'Meaning 1',
        'learners keep the approved text',
      );
      assert.equal(data.unchanged, true);
      await expectCode(
        publish(client, data.contentHash),
        'PL409_NOTHING_TO_PUBLISH',
      );

      // Retiring a phrase it showed ends the carry: the lesson is removed.
      await asPostgres(client);
      await client.query(
        'update content.items set retired_at = now(), position = null where id = $1',
        [itemIds[5]],
      );
      const later = await preview(client);
      const removed = later.diff.removed.find((l) => l.id === lessonId);
      assert.ok(removed, `removed from ${name}`);
      assert.ok(reasonCodes(removed).includes('not_carried'));
    }));

  test('gated and retired lessons are left out', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId } = await addLesson(client);
      await approveLesson(client, lessonId);
      await asPostgres(client);
      await client.query(
        "update content.lessons set publish_gate = 'blocked' where id = $1",
        [lessonId],
      );
      await client.query(
        "update content.lessons set retired_at = now(), position = null where id = 'ps-lsn-f00002'",
      );
      const data = await preview(client);
      const ids = lessonIdsOf(data.payload);
      assert.ok(!ids.includes(lessonId));
      assert.ok(!ids.includes('ps-lsn-f00002'));
      assert.deepEqual(
        reasonCodes(data.excluded.find((l) => l.id === lessonId)),
        ['gated'],
      );
      const removed = data.diff.removed.find((l) => l.id === 'ps-lsn-f00002');
      assert.deepEqual(reasonCodes(removed), ['retired']);
      assert.equal(removed.title, 'Fixture introductions');
      // A closed gate on the language holds back everything in it.
      await client.query(
        "update content.languages set publish_gate = 'blocked' where code = 'ps'",
      );
      const rows = await plan(client, 'content@2099.01.1', await today(client));
      assert.ok(reasonCodes(rows.get('ps-lsn-f00001')).includes('gated'));
      assert.match(
        rows.get('ps-lsn-f00001').reasons[0].message,
        /the Pashto language/,
      );
    }));

  test('demo lessons leave after their sunset (the sunset day included)', () =>
    tx(async (client) => {
      const onSunset = await build(client, 'content@2026.12.1', '2026-12-11');
      assert.deepEqual(lessonIdsOf(onSunset), DEMO_LESSONS);
      const after = await build(client, 'content@2026.12.2', '2026-12-12');
      assert.deepEqual(after.courses, []);
      assert.deepEqual(after.languages, []);
      assert.deepEqual(after.keymap, { lessons: [], courses: [], items: [] });
      const rows = await plan(client, 'content@2026.12.2', '2026-12-12');
      assert.deepEqual(reasonCodes(rows.get('ps-lsn-f00001')), ['demo_ended']);
      assert.equal(rows.get('ps-lsn-f00001').in_previous, true);
    }));

  test("demo exit: a unit that is all reviewed replaces the language's demo", () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const when = await today(client);
      const seeded = await seedLesson(client, { language: 'ps' });
      // Not yet approved: the new unit is not all reviewed, the demo stays.
      let copy = await build(client, 'content@2099.01.1', when);
      assert.deepEqual(lessonIdsOf(copy), DEMO_LESSONS);

      await approveLesson(client, seeded.lessonId);
      copy = await build(client, 'content@2099.01.1', when);
      assert.deepEqual(lessonIdsOf(copy), [seeded.lessonId]);
      assert.ok(!copy.varieties.some((v) => v.id === 'ps-var-fixture'));
      assert.deepEqual(copy.keymap, { lessons: [], courses: [], items: [] });
      const rows = await plan(client, 'content@2099.01.1', when);
      assert.deepEqual(reasonCodes(rows.get('ps-lsn-f00001')), ['demo_exit']);

      const data = await preview(client);
      assert.deepEqual(
        data.diff.removed.map((l) => l.id),
        DEMO_LESSONS,
      );
      assert.equal(data.stats.demo_lessons, 0);
      assert.equal(data.stats.reviewed_lessons, 1);
    }));

  test('Hindko is never published: its demo is never live, its gate stays shut', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      await asPostgres(client);
      await client.query(
        "insert into content.demo_period (language_code, sunset, live) values ('hno', date '2099-12-31', false)",
      );
      // Even with the language gate open, Hindko demo content stays out.
      await client.query(
        "update content.languages set publish_gate = 'open' where code = 'hno'",
      );
      const demo = await seedLesson(client, { language: 'hno', demo: true });
      const when = await today(client);
      let rows = await plan(client, 'content@2099.01.1', when);
      assert.deepEqual(reasonCodes(rows.get(demo.lessonId)), ['demo_not_live']);

      // A reviewed Hindko lesson behind the closed language gate stays out too.
      await client.query(
        "update content.languages set publish_gate = 'blocked' where code = 'hno'",
      );
      const reviewed = await seedLesson(client, {
        language: 'hno',
        variety: 'hno-var-hazara',
      });
      await approveLesson(client, reviewed.lessonId);
      rows = await plan(client, 'content@2099.01.1', when);
      assert.equal(rows.get(reviewed.lessonId).included, false);
      assert.ok(reasonCodes(rows.get(reviewed.lessonId)).includes('gated'));

      const copy = await build(client, 'content@2099.01.1', when);
      assert.ok(!copy.languages.some((l) => l.code === 'hno'));
      assert.ok(!JSON.stringify(copy).includes('hno-'));
      const data = await preview(client);
      assert.equal(data.unchanged, true);
    }));
});

// ---------------------------------------------------------------------------
// Names and refusals
// ---------------------------------------------------------------------------

describe('publishing', () => {
  test('names: content@YYYY.MM.N by UTC date, .1 in a new month', () =>
    tx(async (client) => {
      await asPostgres(client);
      const name = (at) =>
        value(client, 'select private.next_release_name($1::timestamptz)', [
          at,
        ]);
      assert.equal(await name('2026-09-15T12:00:00Z'), 'content@2026.09.2');
      assert.equal(await name('2026-09-30T23:59:59Z'), 'content@2026.09.2');
      // 02:00 in Pakistan on 1 October is still 30 September in UTC.
      assert.equal(
        await name('2026-10-01T02:00:00+05:00'),
        'content@2026.09.2',
      );
      assert.equal(await name('2026-10-01T00:00:00Z'), 'content@2026.10.1');
      assert.equal(await name('2027-01-05T00:00:00Z'), 'content@2027.01.1');

      const seed = await one(
        client,
        'select content_hash, payload from content.releases where name = $1',
        [SEED_RELEASE],
      );
      await client.query(
        `insert into content.releases (name, kind, content_hash, payload, published_at)
         values ('content@2026.09.2', 'publish', $1, $2, '2026-09-20T00:00:00Z')`,
        [seed.content_hash, seed.payload],
      );
      assert.equal(await name('2026-09-21T00:00:00Z'), 'content@2026.09.3');
      assert.equal(await name('2026-10-02T00:00:00Z'), 'content@2026.10.1');
    }));

  test('a stale preview is refused: PL409_RELEASE_CHANGED', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const before = await preview(client);
      const { lessonId } = await addLesson(client);
      await approveLesson(client, lessonId);
      const err = await expectCode(
        publish(client, before.contentHash),
        'PL409_RELEASE_CHANGED',
      );
      const detail = JSON.parse(err.detail);
      const after = await preview(client);
      assert.equal(detail.current, after.contentHash);
      await expectCode(publish(client, ZERO_HASH), 'PL409_RELEASE_CHANGED');
    }));

  test('an empty release is refused: PL422_EMPTY_RELEASE', () =>
    tx(async (client) => {
      await asPostgres(client);
      await client.query(
        "update content.languages set publish_gate = 'blocked' where code = 'ps'",
      );
      const data = await preview(client);
      assert.equal(data.empty, true);
      assert.deepEqual(
        data.diff.removed.map((l) => l.id),
        DEMO_LESSONS,
      );
      await expectCode(
        publish(client, data.contentHash),
        'PL422_EMPTY_RELEASE',
      );
    }));

  test('a release dated in the future stops publishing: PL409_RELEASE_CLOCK', () =>
    tx(async (client) => {
      await asPostgres(client);
      const seed = await one(
        client,
        'select content_hash, payload from content.releases where name = $1',
        [SEED_RELEASE],
      );
      await client.query(
        `insert into content.releases (name, kind, content_hash, payload)
         values ('content@2099.01.1', 'publish', $1, $2)`,
        [seed.content_hash, seed.payload],
      );
      const data = await preview(client);
      assert.equal(data.clock_ok, false);
      await expectCode(
        publish(client, data.contentHash),
        'PL409_RELEASE_CLOCK',
      );
    }));

  test('rollback_release: admins only, a named release and a reason', () =>
    tx(async (client) => {
      const call = (name, reason) =>
        client.query('select public.rollback_release($1, $2)', [name, reason]);
      await signIn(client, NOBODY);
      await expectCode(call(SEED_RELEASE, 'Why'), 'PL401_NOT_SIGNED_IN');
      for (const u of [EDITOR, REVIEWER, LEARNER]) {
        await signIn(client, u);
        await expectCode(call(SEED_RELEASE, 'Why'), 'PL403_NOT_ADMIN');
      }
      await asAnon(client);
      await expectCode(call(SEED_RELEASE, 'Why'), '42501');

      await signIn(client, ADMIN);
      await expectCode(call('latest', 'Why'), 'PL422_BAD_INPUT');
      await expectCode(call(null, 'Why'), 'PL422_BAD_INPUT');
      await expectCode(call(SEED_RELEASE, '   '), 'PL422_COMMENT_REQUIRED');
      await expectCode(call(SEED_RELEASE, null), 'PL422_COMMENT_REQUIRED');
      await expectCode(call(SEED_RELEASE, 'x'.repeat(501)), 'PL422_LENGTH');
      await expectCode(call('content@2020.01.1', 'Why'), 'PL404_NOT_FOUND');
      // The seed is what learners have: nothing to go back to.
      await expectCode(call(SEED_RELEASE, 'Why'), 'PL409_NOTHING_TO_PUBLISH');
    }));

  test('rollback_release gives learners an earlier release again, as a new one', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId } = await addLesson(client);
      await approveLesson(client, lessonId);
      const first = await preview(client);
      const published = await publish(client, first.contentHash);

      const seed = await one(
        client,
        'select seq, content_hash, payload from content.releases where name = $1',
        [SEED_RELEASE],
      );
      const expectedName = await value(
        client,
        'select private.next_release_name(now())',
      );
      await signIn(client, ADMIN);
      const result = await value(
        client,
        'select public.rollback_release($1, $2)',
        [SEED_RELEASE, '  The new lesson has a typo  '],
      );
      await asPostgres(client);
      assert.deepEqual(result, {
        name: expectedName,
        contentHash: seed.content_hash,
        lessons: 2,
        items: 4,
        restored: SEED_RELEASE,
      });

      const stored = await one(
        client,
        'select seq, kind, content_hash, payload, published_by, note, stats from content.releases where name = $1',
        [expectedName],
      );
      assert.equal(stored.kind, 'rollback');
      assert.equal(stored.published_by, 'ctr-0101');
      assert.equal(stored.note, 'The new lesson has a typo');
      assert.equal(stored.stats.rolledBackTo, SEED_RELEASE);
      // The same lessons as the seed, under the new name.
      assert.deepEqual(
        { ...stored.payload, release: SEED_RELEASE },
        seed.payload,
      );
      assert.equal(stored.payload.release, expectedName);
      assert.equal(nodeHash(stored.payload), stored.content_hash);
      const { rows: lessons } = await client.query(
        `select lesson_id, lesson_class, source from content.release_lessons
         where release_seq = $1 order by lesson_id`,
        [stored.seq],
      );
      assert.deepEqual(
        lessons.map((l) => [l.lesson_id, l.lesson_class, l.source]),
        DEMO_LESSONS.map((id) => [id, 'demo', 'carried']),
      );
      assert.equal(
        await value(
          client,
          'select count(*)::int from content.release_items where release_seq = $1',
          [stored.seq],
        ),
        4,
      );
      const audit = await one(
        client,
        `select actor_contributor_id, detail from public.audit_events
         where action = 'release.rolled_back' and target_id = $1`,
        [expectedName],
      );
      assert.equal(audit.actor_contributor_id, 'ctr-0101');
      assert.equal(audit.detail.restored, SEED_RELEASE);
      assert.equal(audit.detail.previous, published.name);

      // The history shows it, and the lesson that is still ready comes back
      // in the next preview.
      await signIn(client, ADMIN);
      const page = await value(client, 'select public.page_admin_publish()');
      await asPostgres(client);
      assert.equal(page.releases[0].name, expectedName);
      assert.equal(page.releases[0].kind, 'rollback');
      assert.equal(page.releases[0].restored, SEED_RELEASE);
      assert.equal(page.releases[1].restored, null);
      assert.equal(page.preview.unchanged, false);
      assert.deepEqual(
        page.preview.diff.added.map((l) => l.id),
        [lessonId],
      );
      assert.equal(page.preview.contentHash, first.contentHash);
    }));

  test('rollback_release refuses a release that can no longer be shown', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId } = await addLesson(client);
      await approveLesson(client, lessonId);
      const first = await preview(client);
      await publish(client, first.contentHash);
      // The seed's demo period has ended since.
      await asPostgres(client);
      await client.query(
        "update content.demo_period set sunset = (now() at time zone 'UTC')::date - 1 where language_code = 'ps'",
      );
      await signIn(client, ADMIN);
      const err = await expectCode(
        client.query('select public.rollback_release($1, $2)', [
          SEED_RELEASE,
          'Why',
        ]),
        'PL409_NOT_PUBLISHABLE',
      );
      const detail = JSON.parse(err.detail);
      assert.equal(detail.release, SEED_RELEASE);
      assert.ok(detail.problems.some((p) => p.startsWith('Starter phrases')));
    }));

  /**
   * Publishes a reviewed lesson next to the demo, then as `pull` closes or
   * retires something, publishes again (the lesson leaves) and tries to go
   * back to the release that held it.
   */
  async function rollbackAfter(client, pull) {
    await keepDemoLive(client);
    const added = await addLesson(client);
    await approveLesson(client, added.lessonId);
    const first = await preview(client);
    const { name } = await publish(client, first.contentHash);
    await asPostgres(client);
    await pull(added);
    const second = await preview(client);
    assert.ok(
      second.diff.removed.some((l) => l.id === added.lessonId),
      'the pulled lesson leaves in the next release',
    );
    await publish(client, second.contentHash);
    await signIn(client, ADMIN);
    try {
      const err = await expectCode(
        client.query('select public.rollback_release($1, $2)', [name, 'Why']),
        'PL409_NOT_PUBLISHABLE',
      );
      return { detail: JSON.parse(err.detail), added, name };
    } finally {
      await asPostgres(client);
    }
  }

  test('rollback_release refuses a lesson whose publish gate has closed since', () =>
    tx(async (client) => {
      const { detail, added, name } = await rollbackAfter(
        client,
        ({ lessonId }) =>
          client.query(
            "update content.lessons set publish_gate = 'blocked' where id = $1",
            [lessonId],
          ),
      );
      assert.equal(detail.release, name);
      assert.deepEqual(detail.lessons, [added.lessonId]);
      assert.ok(
        detail.problems.some((p) => p.startsWith('Lessons that are retired')),
      );
    }));

  test('rollback_release refuses a lesson behind a closed unit gate', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId } = await addLesson(client);
      await approveLesson(client, lessonId);
      const first = await preview(client);
      await publish(client, first.contentHash);
      await asPostgres(client);
      await client.query(
        "update content.units set publish_gate = 'blocked' where id = $1",
        [FIXTURE_UNIT],
      );
      await signIn(client, ADMIN);
      const err = await expectCode(
        client.query('select public.rollback_release($1, $2)', [
          SEED_RELEASE,
          'Why',
        ]),
        'PL409_NOT_PUBLISHABLE',
      );
      assert.deepEqual(JSON.parse(err.detail).lessons, DEMO_LESSONS);
    }));

  test('rollback_release refuses a lesson retired since', () =>
    tx(async (client) => {
      const { detail, added } = await rollbackAfter(client, ({ lessonId }) =>
        client.query(
          'update content.lessons set retired_at = now(), position = null where id = $1',
          [lessonId],
        ),
      );
      assert.deepEqual(detail.lessons, [added.lessonId]);
    }));

  test('rollback_release refuses a phrase retired since', () =>
    tx(async (client) => {
      const { detail, added } = await rollbackAfter(client, ({ itemIds }) =>
        client.query(
          'update content.items set retired_at = now(), position = null where id = $1',
          [itemIds[5]],
        ),
      );
      assert.deepEqual(detail.lessons, [added.lessonId]);
      assert.ok(
        detail.problems.some(
          (p) =>
            p.startsWith('Phrases that are retired') &&
            p.includes(added.itemIds[5]),
        ),
      );
    }));

  test('rollback_release refuses starter lessons after reviewed ones replace them', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const seeded = await seedLesson(client, { language: 'ps' });
      await approveLesson(client, seeded.lessonId);
      const data = await preview(client);
      assert.deepEqual(lessonIdsOf(data.payload), [seeded.lessonId]);
      await publish(client, data.contentHash);
      await signIn(client, ADMIN);
      const err = await expectCode(
        client.query('select public.rollback_release($1, $2)', [
          SEED_RELEASE,
          'Why',
        ]),
        'PL409_NOT_PUBLISHABLE',
      );
      const detail = JSON.parse(err.detail);
      assert.deepEqual(detail.lessons, DEMO_LESSONS);
      assert.ok(
        detail.problems.some((p) =>
          p.startsWith('Reviewed lessons have replaced'),
        ),
      );
    }));

  test('verify_learner_copy refuses gated and retired lessons and phrases', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId, itemIds } = await addLesson(client);
      await approveLesson(client, lessonId);
      const when = await today(client);
      const built = await build(client, 'content@2099.01.1', when);
      assert.ok(lessonIdsOf(built).includes(lessonId));
      const check = () =>
        value(client, 'select private.verify_learner_copy($1, $2::date)', [
          built,
          when,
        ]);
      assert.deepEqual(await check(), []);

      await client.query(
        "update content.lessons set publish_gate = 'blocked' where id = 'ps-lsn-f00001'",
      );
      await client.query(
        'update content.items set retired_at = now(), position = null where id = $1',
        [itemIds[5]],
      );
      const problems = await check();
      assert.ok(
        problems.some(
          (p) =>
            p.startsWith('Lessons that are retired') &&
            p.includes('ps-lsn-f00001'),
        ),
      );
      assert.ok(
        problems.some(
          (p) =>
            p.startsWith('Phrases that are retired') && p.includes(itemIds[5]),
        ),
      );
    }));

  test('rollback_release stops when the release clock is wrong', () =>
    tx(async (client) => {
      await asPostgres(client);
      const seed = await one(
        client,
        'select content_hash, payload from content.releases where name = $1',
        [SEED_RELEASE],
      );
      await client.query(
        `insert into content.releases (name, kind, content_hash, payload)
         values ('content@2099.01.1', 'publish', $1, $2)`,
        [`sha256-${'1'.repeat(64)}`, seed.payload],
      );
      await signIn(client, ADMIN);
      await expectCode(
        client.query('select public.rollback_release($1, $2)', [
          SEED_RELEASE,
          'Why',
        ]),
        'PL409_RELEASE_CLOCK',
      );
    }));

  test('a build that fails its own checks is refused: PL500_BUILD_BUG', () =>
    tx(async (client) => {
      await keepDemoLive(client);
      const { lessonId } = await addLesson(client);
      await approveLesson(client, lessonId);
      const data = await preview(client);
      // Stand in a broken verifier for this transaction only.
      await asPostgres(client);
      await client.query(
        `create or replace function private.verify_learner_copy(p jsonb, p_today date)
         returns jsonb language sql stable set search_path = '' as $$ select '["broken on purpose"]'::jsonb $$`,
      );
      const err = await expectCode(
        publish(client, data.contentHash),
        'PL500_BUILD_BUG',
      );
      assert.deepEqual(JSON.parse(err.detail).problems, ['broken on purpose']);
      assert.equal(
        await value(
          client,
          "select count(*)::int from content.releases where kind = 'publish'",
        ),
        0,
      );
    }));
});
