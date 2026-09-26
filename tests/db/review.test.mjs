// Track D, review (docs/platform.md §3.5, §3.9 D). Every refusal the review
// functions can raise is proved here by calling the function directly.
// Needs a database with the migrations and seeds applied: `npm run test:db`
// (local stack, under the lock) or `npm run test:db:ci`. Every test runs in
// a rolled-back transaction.

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

const YUSUFZAI = 'ps-var-yusufzai';
const HAZARA = 'hno-var-hazara';
const NOBODY_FP = '0000000000000000';
const RANDOM_UUID = '5d6f0a52-4f8e-4c38-9a3e-1f0f2b7c9d11';

/** Signed in as the authenticated role, but with no user in the token. */
async function asNobody(client) {
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: 'authenticated' }),
  ]);
}

/** A fresh 18+ user with a role. Returns { ...user, contributorId, grantId }. */
async function person(client, role, scope = {}) {
  const u = await user(client);
  const g = await grant(client, u, role, scope);
  return { ...u, ...g };
}

/** The target's current review fingerprint, read as postgres. */
async function fingerprint(client, table, id) {
  await asPostgres(client);
  return value(
    client,
    `select review_fingerprint from content.${table} where id = $1`,
    [id],
  );
}

/**
 * Writes a revision of an item as `contributorId` (as the editor track's
 * functions would), by changing its meaning as postgres.
 */
async function authorItem(client, contributorId, itemId, meaning) {
  await asPostgres(client);
  await client.query("select set_config('polilingo.change_author', $1, true)", [
    contributorId,
  ]);
  await client.query('update content.items set meaning = $2 where id = $1', [
    itemId,
    meaning,
  ]);
  await client.query("select set_config('polilingo.change_author', '', true)");
}

const decide = (client, args) =>
  client.query(
    'select public.record_review_decision($1, $2, $3, $4, $5, $6) as r',
    [
      args.type ?? 'item',
      args.id,
      args.decision ?? 'approve',
      args.fp,
      args.scope === undefined
        ? ['text', 'romanisation', 'meaning']
        : args.scope,
      args.comment ?? null,
    ],
  );

async function approve(client, reviewer, itemId, extra = {}) {
  const fp = await fingerprint(client, 'items', itemId);
  await as(client, reviewer);
  return (await decide(client, { id: itemId, fp, ...extra })).rows[0].r;
}

const suggest = (client, itemId, fp, proposed, note = null) =>
  client.query('select public.create_suggestion($1, $2, $3, $4) as id', [
    itemId,
    fp,
    JSON.stringify(proposed),
    note,
  ]);

// ---------------------------------------------------------------------------
// record_review_decision
// ---------------------------------------------------------------------------

describe('record_review_decision', () => {
  test('refuses someone who is not signed in', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      await asNobody(client);
      await expectCode(
        decide(client, { id: lesson.itemIds[0], fp: NOBODY_FP }),
        'PL401_NOT_SIGNED_IN',
      );
    }));

  test('refuses anyone who is not a reviewer: a learner, an editor, an admin', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const learner = await user(client);
      const editor = await person(client, 'editor');
      const admin = await person(client, 'admin');
      for (const who of [learner, editor, admin]) {
        const fp = await fingerprint(client, 'items', lesson.itemIds[0]);
        await as(client, who);
        await expectCode(
          decide(client, { id: lesson.itemIds[0], fp }),
          'PL403_NOT_REVIEWER',
        );
      }
    }));

  test('refuses a reviewer whose role was revoked', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      await asPostgres(client);
      await client.query(
        'update public.role_grants set ends_at = now(), revoked_by = $2 where id = $1',
        [reviewer.grantId, 'ctr-0101'],
      );
      const fp = await fingerprint(client, 'items', lesson.itemIds[0]);
      await as(client, reviewer);
      await expectCode(
        decide(client, { id: lesson.itemIds[0], fp }),
        'PL403_NOT_REVIEWER',
      );
      await expectCode(
        suggest(client, lesson.itemIds[0], fp, { meaning: 'Hello there' }),
        'PL403_NOT_REVIEWER',
      );
    }));

  test('refuses bad input: target type, decision, fingerprint, scope', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const fp = await fingerprint(client, 'items', lesson.itemIds[0]);
      await as(client, reviewer);
      const id = lesson.itemIds[0];
      await expectCode(
        decide(client, { type: 'unit', id, fp }),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        decide(client, { id, fp, decision: 'maybe' }),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        decide(client, { id, fp: 'not-a-fingerprint' }),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        decide(client, { id, fp, scope: ['text', 'spelling'] }),
        'PL422_BAD_INPUT',
      );
    }));

  test('request changes and reject need a comment', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const fp = await fingerprint(client, 'items', lesson.itemIds[0]);
      await as(client, reviewer);
      for (const decision of ['request_changes', 'reject']) {
        await expectCode(
          decide(client, { id: lesson.itemIds[0], fp, decision }),
          'PL422_COMMENT_REQUIRED',
        );
        await expectCode(
          decide(client, {
            id: lesson.itemIds[0],
            fp,
            decision,
            comment: '   ',
          }),
          'PL422_COMMENT_REQUIRED',
        );
      }
      const r = (
        await decide(client, {
          id: lesson.itemIds[0],
          fp,
          decision: 'request_changes',
          comment: 'The meaning is too literal.',
        })
      ).rows[0].r;
      assert.equal(r.status, 'changes_requested');
      assert.equal(r.sole_reviewer, false);
      const row = await one(
        client,
        'select review_status, current_decision_id from content.items where id = $1',
        [lesson.itemIds[0]],
      );
      assert.equal(row.review_status, 'changes_requested');
      assert.equal(row.current_decision_id, r.decision_id);
    }));

  test('refuses a target that does not exist, or is retired', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      await asPostgres(client);
      const retired = lesson.itemIds[5];
      await client.query('delete from content.exercises where lesson_id = $1', [
        lesson.lessonId,
      ]);
      await client.query(
        'update content.items set retired_at = now(), position = null where id = $1',
        [retired],
      );
      await as(client, reviewer);
      await expectCode(
        decide(client, { id: 'ps-itm-ffffff', fp: NOBODY_FP }),
        'PL404_NOT_FOUND',
      );
      await expectCode(
        decide(client, { type: 'lesson', id: 'ps-lsn-ffffff', fp: NOBODY_FP }),
        'PL404_NOT_FOUND',
      );
      await expectCode(
        decide(client, { id: retired, fp: NOBODY_FP }),
        'PL404_NOT_FOUND',
      );
    }));

  test('a Pashto reviewer cannot review a Hindko item, and is told who can', () =>
    tx(async (client) => {
      const hindko = await seedLesson(client, {
        language: 'hno',
        variety: HAZARA,
      });
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      await as(client, reviewer);
      const error = await expectCode(
        decide(client, { id: hindko.itemIds[0], fp: NOBODY_FP }),
        'PL403_OUTSIDE_VARIETY',
      );
      assert.match(
        error.message,
        /Hazara Hindko needs a Hazara Hindko reviewer\./,
      );
      await expectCode(
        decide(client, {
          type: 'lesson',
          id: hindko.lessonId,
          fp: NOBODY_FP,
        }),
        'PL403_OUTSIDE_VARIETY',
      );
    }));

  test('refuses a stale fingerprint and says what is current', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const fp = await fingerprint(client, 'items', lesson.itemIds[0]);
      await as(client, reviewer);
      const error = await expectCode(
        decide(client, { id: lesson.itemIds[0], fp: NOBODY_FP }),
        'PL409_STALE',
      );
      assert.equal(JSON.parse(error.detail).current_fingerprint, fp);
    }));

  test('a demo item or demo lesson is never approved', () =>
    tx(async (client) => {
      const demo = await seedLesson(client, {
        variety: 'ps-var-demotest',
        demo: true,
      });
      const reviewer = await person(client, 'language_reviewer', {
        variety: 'ps-var-demotest',
      });
      const itemFp = await fingerprint(client, 'items', demo.itemIds[0]);
      const lessonFp = await fingerprint(client, 'lessons', demo.lessonId);
      await as(client, reviewer);
      await expectCode(
        decide(client, { id: demo.itemIds[0], fp: itemFp }),
        'PL409_DEMO_NEVER_APPROVED',
      );
      await expectCode(
        decide(client, {
          id: demo.itemIds[0],
          fp: itemFp,
          decision: 'reject',
          comment: 'Not needed.',
        }),
        'PL409_DEMO_NEVER_APPROVED',
      );
      await expectCode(
        decide(client, {
          type: 'lesson',
          id: demo.lessonId,
          fp: lessonFp,
          scope: null,
        }),
        'PL409_DEMO_NEVER_APPROVED',
      );
    }));

  test('an item needs every required part ticked, usage too when it has a note', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, {
        items: [{ usage_note: 'Said to elders.' }, {}],
        exercises: 0,
      });
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const fp = await fingerprint(client, 'items', lesson.itemIds[0]);
      await as(client, reviewer);
      const error = await expectCode(
        decide(client, { id: lesson.itemIds[0], fp }),
        'PL422_SCOPE_INCOMPLETE',
      );
      assert.deepEqual(JSON.parse(error.detail).missing, ['usage']);
      await expectCode(
        decide(client, { id: lesson.itemIds[0], fp, scope: ['text'] }),
        'PL422_SCOPE_INCOMPLETE',
      );
      await expectCode(
        decide(client, { id: lesson.itemIds[0], fp, scope: null }),
        'PL422_SCOPE_INCOMPLETE',
      );
      const r = (
        await decide(client, {
          id: lesson.itemIds[0],
          fp,
          scope: ['usage', 'meaning', 'romanisation', 'text'],
        })
      ).rows[0].r;
      assert.equal(r.status, 'approved');
      assert.equal(r.countersign_required, false);

      // Without a context or usage note, usage is not required.
      const fp2 = await fingerprint(client, 'items', lesson.itemIds[1]);
      await as(client, reviewer);
      const r2 = (await decide(client, { id: lesson.itemIds[1], fp: fp2 }))
        .rows[0].r;
      assert.equal(r2.status, 'approved');
      await asPostgres(client);
      const row = await one(
        client,
        `select i.review_status, i.last_approved_seq, d.scope, d.seen_fingerprint, d.target_revision_no
         from content.items i join content.review_decisions d on d.id = i.current_decision_id
         where i.id = $1`,
        [lesson.itemIds[1]],
      );
      assert.equal(row.review_status, 'approved');
      assert.ok(Number(row.last_approved_seq) > 0);
      assert.deepEqual(row.scope, ['meaning', 'romanisation', 'text']);
      assert.equal(row.seen_fingerprint, fp2);
      assert.equal(row.target_revision_no, 1);
      assert.equal(
        await value(
          client,
          `select count(*)::int from public.audit_events where action = 'review.approve' and target_id = $1`,
          [lesson.itemIds[1]],
        ),
        1,
      );
    }));

  test('own text is refused while another reviewer exists; the other reviewer approves', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const a = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const b = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const id = lesson.itemIds[0];
      await authorItem(client, a.contributorId, id, 'Hello, friend');
      const fp = await fingerprint(client, 'items', id);
      await as(client, a);
      await expectCode(decide(client, { id, fp }), 'PL403_OWN_TEXT');
      // Asking for changes to your own text is allowed.
      const asked = (
        await decide(client, {
          id,
          fp,
          decision: 'request_changes',
          comment: 'I need to fix my own typo.',
        })
      ).rows[0].r;
      assert.equal(asked.status, 'changes_requested');
      const r = await approve(client, b, id);
      assert.equal(r.status, 'approved');
      assert.equal(r.sole_reviewer, false);
    }));

  test('own text is allowed for a sole reviewer, and then needs a countersign', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, { variety: 'ps-var-solo' });
      const solo = await person(client, 'language_reviewer', {
        variety: 'ps-var-solo',
      });
      const admin = await person(client, 'admin');
      const id = lesson.itemIds[0];
      await authorItem(client, solo.contributorId, id, 'Hello, friend');
      const r = await approve(client, solo, id);
      assert.deepEqual(
        { status: r.status, sole: r.sole_reviewer, cs: r.countersign_required },
        { status: 'approved', sole: true, cs: true },
      );
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          'select count(*)::int from content.awaiting_countersign where decision_id = $1',
          [r.decision_id],
        ),
        1,
      );

      // A reviewer cannot countersign; an admin can, once.
      await as(client, solo);
      await expectCode(
        client.query('select public.countersign_decision($1)', [r.decision_id]),
        'PL403_NOT_ADMIN',
      );
      await as(client, admin);
      const cs = await value(
        client,
        'select public.countersign_decision($1, $2)',
        [r.decision_id, 'Checked with the author.'],
      );
      assert.equal(cs.decision_id, r.decision_id);
      await expectCode(
        client.query('select public.countersign_decision($1)', [r.decision_id]),
        'PL409_ALREADY_COUNTERSIGNED',
      );
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          'select count(*)::int from content.awaiting_countersign where decision_id = $1',
          [r.decision_id],
        ),
        0,
      );
    }));

  test('a sole approval keeps its author an author until it is countersigned', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, { variety: 'ps-var-solo' });
      const solo = await person(client, 'language_reviewer', {
        variety: 'ps-var-solo',
      });
      const admin = await person(client, 'admin');
      const id = lesson.itemIds[0];
      await authorItem(client, solo.contributorId, id, 'Hello, friend');
      const first = await approve(client, solo, id);
      assert.equal(first.sole_reviewer, true);

      // Approving again is still a sole approval that needs a countersign.
      const again = await approve(client, solo, id);
      assert.deepEqual(
        { sole: again.sole_reviewer, cs: again.countersign_required },
        { sole: true, cs: true },
      );
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          'select count(*)::int from content.awaiting_countersign d join content.items i on i.current_decision_id = d.decision_id where i.id = $1',
          [id],
        ),
        1,
      );
      await as(client, solo);
      const before = await value(client, 'select public.page_review_item($1)', [
        id,
      ]);
      assert.equal(before.viewer.is_author, true);

      // Once countersigned, the approval clears authorship.
      await as(client, admin);
      await value(client, 'select public.countersign_decision($1)', [
        again.decision_id,
      ]);
      await as(client, solo);
      const after = await value(client, 'select public.page_review_item($1)', [
        id,
      ]);
      assert.equal(after.viewer.is_author, false);
    }));

  test('after a sole approval, a new second reviewer means the author is refused', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, { variety: 'ps-var-solo' });
      const solo = await person(client, 'language_reviewer', {
        variety: 'ps-var-solo',
      });
      const id = lesson.itemIds[0];
      await authorItem(client, solo.contributorId, id, 'Hello, friend');
      const first = await approve(client, solo, id);
      assert.equal(first.countersign_required, true);
      const second = await person(client, 'language_reviewer', {
        variety: 'ps-var-solo',
      });
      const fp = await fingerprint(client, 'items', id);
      await as(client, solo);
      await expectCode(decide(client, { id, fp }), 'PL403_OWN_TEXT');
      const r = await approve(client, second, id);
      assert.equal(r.sole_reviewer, false);
    }));

  test('the reviewer of an uncountersigned sole approval is its author, whatever the baseline says', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, { variety: 'ps-var-solo' });
      const solo = await person(client, 'language_reviewer', {
        variety: 'ps-var-solo',
      });
      const id = lesson.itemIds[0];
      await authorItem(client, solo.contributorId, id, 'Hello, friend');
      await approve(client, solo, id);
      // A baseline moved past the author's revision (as the old code did).
      await asPostgres(client);
      await client.query(
        'update content.items set last_approved_seq = (select max(seq) from content.revisions) where id = $1',
        [id],
      );
      const again = await approve(client, solo, id);
      assert.equal(again.countersign_required, true);
      await person(client, 'language_reviewer', { variety: 'ps-var-solo' });
      const fp = await fingerprint(client, 'items', id);
      await as(client, solo);
      await expectCode(decide(client, { id, fp }), 'PL403_OWN_TEXT');
    }));

  test('the same for a lesson: sole approval twice, then a second reviewer', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, { variety: 'ps-var-solo' });
      const solo = await person(client, 'language_reviewer', {
        variety: 'ps-var-solo',
      });
      const admin = await person(client, 'admin');
      await asPostgres(client);
      await client.query(
        "select set_config('polilingo.change_author', $1, true)",
        [solo.contributorId],
      );
      await client.query(
        `update content.exercises set prompt = 'Pick the meaning.' where id = $1`,
        [lesson.exerciseIds[0]],
      );
      await client.query(
        "select set_config('polilingo.change_author', '', true)",
      );
      const lessonApprove = async (who) => {
        const fp = await fingerprint(client, 'lessons', lesson.lessonId);
        await as(client, who);
        return decide(client, {
          type: 'lesson',
          id: lesson.lessonId,
          fp,
          scope: null,
        });
      };

      const first = (await lessonApprove(solo)).rows[0].r;
      assert.equal(first.countersign_required, true);
      const again = (await lessonApprove(solo)).rows[0].r;
      assert.deepEqual(
        { sole: again.sole_reviewer, cs: again.countersign_required },
        { sole: true, cs: true },
      );
      await as(client, solo);
      const page = await value(client, 'select public.page_review_lesson($1)', [
        lesson.lessonId,
      ]);
      assert.equal(page.viewer.is_author, true);

      const second = await person(client, 'language_reviewer', {
        variety: 'ps-var-solo',
      });
      await expectCode(lessonApprove(solo), 'PL403_OWN_TEXT');

      // A countersign still lets the sole approval through, and clears
      // authorship for the next round.
      await as(client, admin);
      await value(client, 'select public.countersign_decision($1)', [
        again.decision_id,
      ]);
      await asPostgres(client);
      await client.query(
        'update public.role_grants set ends_at = now() where id = $1',
        [second.grantId],
      );
      const clean = (await lessonApprove(solo)).rows[0].r;
      assert.equal(clean.sole_reviewer, false);
    }));

  test('a lesson needs 6 exercises and no blocking problems; its author is refused', () =>
    tx(async (client) => {
      const short = await seedLesson(client, { exercises: 5 });
      const broken = await seedLesson(client, { items: 7, exercises: 7 });
      const good = await seedLesson(client);
      const a = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const b = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });

      // The answer of exercise 7 is retired: a blocking problem.
      await asPostgres(client);
      await client.query(
        'update content.items set retired_at = now(), position = null where id = $1',
        [broken.itemIds[6]],
      );

      const lessonDecide = async (who, lessonId) => {
        const fp = await fingerprint(client, 'lessons', lessonId);
        await as(client, who);
        return decide(client, {
          type: 'lesson',
          id: lessonId,
          fp,
          scope: null,
        });
      };

      const few = await expectCode(
        lessonDecide(a, short.lessonId),
        'PL422_TOO_FEW_EXERCISES',
      );
      assert.equal(JSON.parse(few.detail).exercises, 5);
      const problems = await expectCode(
        lessonDecide(a, broken.lessonId),
        'PL422_LESSON_PROBLEMS',
      );
      assert.ok(JSON.parse(problems.detail).problems.length >= 1);

      // A writes an exercise revision: A is now an author of the lesson.
      await asPostgres(client);
      await client.query(
        "select set_config('polilingo.change_author', $1, true)",
        [a.contributorId],
      );
      await client.query(
        `update content.exercises set prompt = 'Pick the meaning.' where id = $1`,
        [good.exerciseIds[0]],
      );
      await client.query(
        "select set_config('polilingo.change_author', '', true)",
      );
      await expectCode(lessonDecide(a, good.lessonId), 'PL403_OWN_TEXT');
      const ok = (await lessonDecide(b, good.lessonId)).rows[0].r;
      assert.equal(ok.status, 'approved');
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          'select review_status from content.lessons where id = $1',
          [good.lessonId],
        ),
        'approved',
      );
    }));
});

// ---------------------------------------------------------------------------
// countersign_decision
// ---------------------------------------------------------------------------

describe('countersign_decision', () => {
  test('refuses a missing decision, one that is not sole, and a stale one', () =>
    tx(async (client) => {
      const shared = await seedLesson(client);
      const solo = await seedLesson(client, { variety: 'ps-var-solo' });
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const soloReviewer = await person(client, 'language_reviewer', {
        variety: 'ps-var-solo',
      });
      const admin = await person(client, 'admin');

      const normal = await approve(client, reviewer, shared.itemIds[0]);
      await authorItem(
        client,
        soloReviewer.contributorId,
        solo.itemIds[0],
        'Hi',
      );
      const sole = await approve(client, soloReviewer, solo.itemIds[0]);
      // The text changes after the sole approval: nothing left to countersign.
      await authorItem(client, 'ctr-0102', solo.itemIds[0], 'Hi there');

      await asNobody(client);
      await expectCode(
        client.query('select public.countersign_decision($1)', [RANDOM_UUID]),
        'PL401_NOT_SIGNED_IN',
      );
      await as(client, admin);
      await expectCode(
        client.query('select public.countersign_decision($1)', [RANDOM_UUID]),
        'PL404_NOT_FOUND',
      );
      await expectCode(
        client.query('select public.countersign_decision($1)', [
          normal.decision_id,
        ]),
        'PL409_NOT_SOLE',
      );
      await expectCode(
        client.query('select public.countersign_decision($1)', [
          sole.decision_id,
        ]),
        'PL409_STALE',
      );
    }));

  test('an admin cannot countersign their own review', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, { variety: 'ps-var-solo' });
      const once = await person(client, 'language_reviewer', {
        variety: 'ps-var-solo',
      });
      await authorItem(client, once.contributorId, lesson.itemIds[0], 'Hi');
      const r = await approve(client, once, lesson.itemIds[0]);
      assert.equal(r.countersign_required, true);

      // Later the reviewer role ends and the same person becomes an admin.
      await asPostgres(client);
      await client.query(
        'update public.role_grants set ends_at = now() where id = $1',
        [once.grantId],
      );
      await grant(client, once, 'admin');
      await as(client, once);
      await expectCode(
        client.query('select public.countersign_decision($1)', [r.decision_id]),
        'PL403_SELF_COUNTERSIGN',
      );
    }));
});

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

describe('suggestions', () => {
  test('suggest, accept, then the suggester cannot approve but another reviewer can', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const a = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const b = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const editor = await person(client, 'editor', { language: 'ps' });
      const id = lesson.itemIds[0];

      const fp = await fingerprint(client, 'items', id);
      await as(client, a);
      const sid = (
        await suggest(
          client,
          id,
          fp,
          { meaning: '  Peace be with you ', romanisation: 'Word 1' },
          'More natural.',
        )
      ).rows[0].id;
      await as(client, b);
      const other = (await suggest(client, id, fp, { meaning: 'Hi' })).rows[0]
        .id;

      await asPostgres(client);
      const stored = await one(
        client,
        'select proposed, status, base_review_fingerprint from content.suggestions where id = $1',
        [sid],
      );
      assert.deepEqual(
        stored.proposed,
        { meaning: 'Peace be with you' },
        'only the changed field, trimmed',
      );
      assert.equal(stored.status, 'open');
      assert.equal(stored.base_review_fingerprint, fp);

      await as(client, editor);
      const accepted = await value(
        client,
        'select public.accept_suggestion($1, $2)',
        [sid, fp],
      );
      assert.equal(accepted.review_status, 'unreviewed');
      assert.equal(accepted.superseded, 1);

      await asPostgres(client);
      const item = await one(
        client,
        'select meaning, text_author, review_fingerprint from content.items where id = $1',
        [id],
      );
      assert.equal(item.meaning, 'Peace be with you');
      assert.equal(item.text_author, a.contributorId);
      const revision = await one(
        client,
        `select reason, author_contributor_id, suggestion_id from content.revisions
         where object_type = 'item' and object_id = $1 order by seq desc limit 1`,
        [id],
      );
      assert.deepEqual(revision, {
        reason: 'suggestion',
        author_contributor_id: a.contributorId,
        suggestion_id: sid,
      });
      assert.equal(
        await value(
          client,
          'select status from content.suggestions where id = $1',
          [other],
        ),
        'superseded',
      );
      assert.equal(
        await value(
          client,
          "select current_setting('polilingo.change_author', true)",
        ),
        '',
      );

      const fp2 = item.review_fingerprint;
      await as(client, a);
      await expectCode(decide(client, { id, fp: fp2 }), 'PL403_OWN_TEXT');
      const r = await approve(client, b, id);
      assert.equal(r.status, 'approved');
      assert.equal(r.sole_reviewer, false);
    }));

  test('create_suggestion refusals', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const demo = await seedLesson(client, {
        variety: 'ps-var-demotest',
        demo: true,
      });
      const hindko = await seedLesson(client, {
        language: 'hno',
        variety: HAZARA,
      });
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      await grant(client, reviewer, 'language_reviewer', {
        variety: 'ps-var-demotest',
      });
      const editor = await person(client, 'editor');
      const id = lesson.itemIds[0];
      const fp = await fingerprint(client, 'items', id);
      const demoFp = await fingerprint(client, 'items', demo.itemIds[0]);

      await asNobody(client);
      await expectCode(
        suggest(client, id, fp, { meaning: 'Hi' }),
        'PL401_NOT_SIGNED_IN',
      );
      await as(client, editor);
      await expectCode(
        suggest(client, id, fp, { meaning: 'Hi' }),
        'PL403_NOT_REVIEWER',
      );
      await as(client, reviewer);
      await expectCode(
        suggest(client, id, fp, { title: 'Hi' }),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        suggest(client, id, 'nope', { meaning: 'Hi' }),
        'PL422_BAD_INPUT',
      );
      await expectCode(
        suggest(client, 'ps-itm-ffffff', fp, { meaning: 'Hi' }),
        'PL404_NOT_FOUND',
      );
      const outside = await expectCode(
        suggest(client, hindko.itemIds[0], fp, { meaning: 'Hi' }),
        'PL403_OUTSIDE_VARIETY',
      );
      assert.match(outside.message, /Hazara Hindko/);
      await expectCode(
        suggest(client, id, NOBODY_FP, { meaning: 'Hi' }),
        'PL409_STALE',
      );
      await expectCode(
        suggest(client, demo.itemIds[0], demoFp, { meaning: 'Hi' }),
        'PL409_DEMO_FROZEN',
      );
      await expectCode(
        suggest(client, id, fp, { meaning: 'Meaning 1' }),
        'PL422_NO_CHANGE',
      );
      await expectCode(
        suggest(client, id, fp, { meaning: '   ' }),
        'PL422_LENGTH',
      );
      await expectCode(
        suggest(client, id, fp, { usage_note: 'x'.repeat(501) }),
        'PL422_LENGTH',
      );
      const script = await expectCode(
        suggest(client, id, fp, { romanisation: 'Salaam سلام' }),
        'PL422_ROMANISATION_SCRIPT',
      );
      assert.equal(JSON.parse(script.detail).problems[0].position, 8);
      await expectCode(
        suggest(client, id, fp, { native: 'سل​ام' }),
        'PL422_INVISIBLE_CHAR',
      );
      // A context can be added, and cleared again later.
      const sid = (await suggest(client, id, fp, { context: 'A greeting.' }))
        .rows[0].id;
      assert.ok(sid);
    }));

  test('withdraw_suggestion refusals', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const a = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const b = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const fp = await fingerprint(client, 'items', lesson.itemIds[0]);
      await as(client, a);
      const sid = (
        await suggest(client, lesson.itemIds[0], fp, { meaning: 'Hi' })
      ).rows[0].id;
      await as(client, b);
      await expectCode(
        client.query('select public.withdraw_suggestion($1)', [sid]),
        'PL403_NOT_SUGGESTER',
      );
      await expectCode(
        client.query('select public.withdraw_suggestion($1)', [RANDOM_UUID]),
        'PL404_NOT_FOUND',
      );
      await as(client, a);
      const r = await value(client, 'select public.withdraw_suggestion($1)', [
        sid,
      ]);
      assert.equal(r.status, 'withdrawn');
      await expectCode(
        client.query('select public.withdraw_suggestion($1)', [sid]),
        'PL409_SUGGESTION_CLOSED',
      );
    }));

  test('accept_suggestion refusals', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const editor = await person(client, 'editor', { language: 'ps' });
      const hnoEditor = await person(client, 'editor', { language: 'hno' });
      const [first, second, third] = lesson.itemIds;
      const fps = {};
      for (const id of [first, second, third])
        fps[id] = await fingerprint(client, 'items', id);

      await as(client, reviewer);
      const s1 = (await suggest(client, first, fps[first], { meaning: 'Hi' }))
        .rows[0].id;
      const s2 = (
        await suggest(client, second, fps[second], { meaning: 'Hey' })
      ).rows[0].id;
      const s3 = (
        await suggest(client, third, fps[third], { native: 'بابا بابا' })
      ).rows[0].id;

      const accept = (id, fp) =>
        client.query('select public.accept_suggestion($1, $2)', [id, fp]);

      await asNobody(client);
      await expectCode(accept(s1, fps[first]), 'PL401_NOT_SIGNED_IN');
      await as(client, reviewer);
      await expectCode(accept(s1, fps[first]), 'PL403_NOT_EDITOR');
      await as(client, editor);
      await expectCode(accept(s1, 'x'), 'PL422_BAD_INPUT');
      await expectCode(accept(RANDOM_UUID, fps[first]), 'PL404_NOT_FOUND');
      await as(client, hnoEditor);
      await expectCode(accept(s1, fps[first]), 'PL403_OUTSIDE_LANGUAGE');
      await as(client, editor);
      await expectCode(accept(s1, NOBODY_FP), 'PL409_STALE');

      // The phrase changes after the suggestion was made.
      await authorItem(client, 'ctr-0102', second, 'Hello again');
      const newFp = await fingerprint(client, 'items', second);
      await as(client, editor);
      await expectCode(accept(s2, newFp), 'PL409_STALE_SUGGESTION');

      // A letter leaves the character list after the suggestion was made:
      // the database's text rules still refuse it.
      await asPostgres(client);
      await client.query(
        `delete from content.orthography_allowlist where language_code = 'ps' and cp = 1576`,
      );
      await as(client, editor);
      await expectCode(accept(s3, fps[third]), 'PL422_CHAR_NOT_ALLOWED');

      await accept(s1, fps[first]);
      await expectCode(accept(s1, fps[first]), 'PL409_SUGGESTION_CLOSED');

      // The phrase is retired while a suggestion for it is still open.
      const fourth = lesson.itemIds[3];
      const fp4 = await fingerprint(client, 'items', fourth);
      await as(client, reviewer);
      const s4 = (await suggest(client, fourth, fp4, { meaning: 'Hiya' }))
        .rows[0].id;
      await asPostgres(client);
      await client.query(
        'update content.items set retired_at = now(), position = null where id = $1',
        [fourth],
      );
      await as(client, editor);
      await expectCode(accept(s4, fp4), 'PL409_RETIRED');
    }));

  test('decline_suggestion refusals', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const admin = await person(client, 'admin');
      const hnoEditor = await person(client, 'editor', { language: 'hno' });
      const fp = await fingerprint(client, 'items', lesson.itemIds[0]);
      await as(client, reviewer);
      const sid = (
        await suggest(client, lesson.itemIds[0], fp, { meaning: 'Hi' })
      ).rows[0].id;
      const decline = (id, reason) =>
        client.query('select public.decline_suggestion($1, $2)', [id, reason]);

      await expectCode(decline(sid, 'No.'), 'PL403_NOT_EDITOR');
      await as(client, admin);
      await expectCode(decline(sid, '  '), 'PL422_COMMENT_REQUIRED');
      await expectCode(decline(RANDOM_UUID, 'No.'), 'PL404_NOT_FOUND');
      await as(client, hnoEditor);
      await expectCode(decline(sid, 'No.'), 'PL403_OUTSIDE_LANGUAGE');
      await as(client, admin);
      const r = await value(
        client,
        'select public.decline_suggestion($1, $2)',
        [sid, 'The current meaning is the common one.'],
      );
      assert.equal(r.status, 'declined');
      await expectCode(decline(sid, 'Again.'), 'PL409_SUGGESTION_CLOSED');
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          'select resolution_note from content.suggestions where id = $1',
          [sid],
        ),
        'The current meaning is the common one.',
      );
    }));
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

describe('comments', () => {
  test('add_review_comment: scope, length, replies', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const hindko = await seedLesson(client, {
        language: 'hno',
        variety: HAZARA,
      });
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const learner = await user(client);
      const comment = (type, id, body, parent = null) =>
        client.query('select public.add_review_comment($1, $2, $3, $4) as id', [
          type,
          id,
          body,
          parent,
        ]);

      await asNobody(client);
      await expectCode(
        comment('item', lesson.itemIds[0], 'Hi'),
        'PL401_NOT_SIGNED_IN',
      );
      await as(client, learner);
      await expectCode(
        comment('item', lesson.itemIds[0], 'Hi'),
        'PL403_OUTSIDE_VARIETY',
      );
      await as(client, reviewer);
      await expectCode(comment('unit', lesson.unitId, 'Hi'), 'PL422_BAD_INPUT');
      await expectCode(
        comment('item', lesson.itemIds[0], '   '),
        'PL422_LENGTH',
      );
      await expectCode(
        comment('item', lesson.itemIds[0], 'x'.repeat(4001)),
        'PL422_LENGTH',
      );
      await expectCode(
        comment('item', 'ps-itm-ffffff', 'Hi'),
        'PL404_NOT_FOUND',
      );
      const outside = await expectCode(
        comment('item', hindko.itemIds[0], 'Hi'),
        'PL403_OUTSIDE_VARIETY',
      );
      assert.match(outside.message, /Hazara Hindko/);

      const first = (
        await comment('item', lesson.itemIds[0], '  Is this formal?  ')
      ).rows[0].id;
      const reply = (await comment('item', lesson.itemIds[0], 'Yes.', first))
        .rows[0].id;
      assert.ok(reply);
      await expectCode(
        comment('lesson', lesson.lessonId, 'Wrong thread', first),
        'PL422_BAD_INPUT',
      );
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          'select body from content.review_comments where id = $1',
          [first],
        ),
        'Is this formal?',
      );
    }));

  test('redact_comment: admins only, a reason, and the row stays', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const admin = await person(client, 'admin');
      await as(client, reviewer);
      const cid = await value(
        client,
        'select public.add_review_comment($1, $2, $3)',
        ['item', lesson.itemIds[0], 'A phone number: 0300 0000000'],
      );
      const fp = await fingerprint(client, 'items', lesson.itemIds[0]);
      await as(client, reviewer);
      const decision = (
        await decide(client, {
          id: lesson.itemIds[0],
          fp,
          decision: 'reject',
          comment: 'Call me on 0300 0000000',
        })
      ).rows[0].r;

      const redact = (id, reason) =>
        client.query('select public.redact_comment($1, $2)', [id, reason]);
      await expectCode(redact(cid, 'Personal data'), 'PL403_NOT_ADMIN');
      await as(client, admin);
      await expectCode(redact(cid, ' '), 'PL422_COMMENT_REQUIRED');
      await expectCode(redact(RANDOM_UUID, 'Personal data'), 'PL404_NOT_FOUND');
      await redact(cid, 'Personal data');
      await redact(decision.decision_id, 'Personal data');
      const again = await value(
        client,
        'select public.redact_comment($1, $2)',
        [cid, 'Personal data'],
      );
      assert.equal(again.already, true);
      await asPostgres(client);
      const row = await one(
        client,
        'select body, redacted_at from content.review_comments where id = $1',
        [cid],
      );
      assert.equal(row.body, '[removed]');
      assert.ok(row.redacted_at);
      assert.equal(
        await value(
          client,
          'select comment from content.review_decisions where id = $1',
          [decision.decision_id],
        ),
        '[removed]',
      );
      assert.equal(
        await value(
          client,
          "select current_setting('polilingo.redaction', true)",
        ),
        '',
      );
    }));
});

// ---------------------------------------------------------------------------
// History is append-only
// ---------------------------------------------------------------------------

describe('history', () => {
  test('decisions, countersignatures, comments and revisions cannot be changed or removed', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, { variety: 'ps-var-solo' });
      const solo = await person(client, 'language_reviewer', {
        variety: 'ps-var-solo',
      });
      const admin = await person(client, 'admin');
      await authorItem(client, solo.contributorId, lesson.itemIds[0], 'Hi');
      const r = await approve(client, solo, lesson.itemIds[0]);
      await as(client, solo);
      await value(client, 'select public.add_review_comment($1, $2, $3)', [
        'item',
        lesson.itemIds[0],
        'Looks right.',
      ]);
      await as(client, admin);
      await value(client, 'select public.countersign_decision($1)', [
        r.decision_id,
      ]);

      // Through the API role there is no write grant at all.
      await as(client, admin);
      await expectCode(
        client.query(
          `update content.review_decisions set decision = 'reject' where id = $1`,
          [r.decision_id],
        ),
        '42501',
      );

      // Even as the owner, the append-only triggers refuse.
      await asPostgres(client);
      const statements = [
        [
          `update content.review_decisions set decision = 'reject' where id = $1`,
          r.decision_id,
        ],
        ['delete from content.review_decisions where id = $1', r.decision_id],
        [
          `update content.countersignatures set comment = 'x' where decision_id = $1`,
          r.decision_id,
        ],
        [
          'delete from content.countersignatures where decision_id = $1',
          r.decision_id,
        ],
        [
          `update content.review_comments set body = 'x' where target_id = $1`,
          lesson.itemIds[0],
        ],
        [
          'delete from content.review_comments where target_id = $1',
          lesson.itemIds[0],
        ],
        [
          `update content.revisions set reason = 'edit' where object_id = $1`,
          lesson.itemIds[0],
        ],
        [
          'delete from content.revisions where object_id = $1',
          lesson.itemIds[0],
        ],
      ];
      for (const [sql, arg] of statements)
        await expectCode(client.query(sql, [arg]), 'PL409_APPEND_ONLY');
    }));
});

// ---------------------------------------------------------------------------
// Page reads
// ---------------------------------------------------------------------------

describe('page reads', () => {
  test('page_review_queue shows only the caller’s varieties, lessons first', () =>
    tx(async (client) => {
      const mine = await seedLesson(client);
      const hindko = await seedLesson(client, {
        language: 'hno',
        variety: HAZARA,
      });
      const demo = await seedLesson(client, {
        variety: 'ps-var-demotest',
        demo: true,
      });
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      await grant(client, reviewer, 'language_reviewer', {
        variety: 'ps-var-demotest',
      });
      // Editing Hindko as well does not put Hindko in their review queue.
      await grant(client, reviewer, 'editor', { language: 'hno' });
      await asPostgres(client);
      await client.query(
        'update content.lessons set submitted_at = now() where id = any ($1)',
        [[mine.lessonId, hindko.lessonId]],
      );

      await asNobody(client);
      await expectCode(
        client.query('select public.page_review_queue()'),
        'PL401_NOT_SIGNED_IN',
      );
      await as(client, reviewer);
      const page = await value(client, 'select public.page_review_queue()');
      assert.deepEqual(
        page.lessons.map((l) => l.id),
        [mine.lessonId],
      );
      const itemIds = page.items.map((i) => i.id);
      for (const id of mine.itemIds) assert.ok(itemIds.includes(id));
      for (const id of [...hindko.itemIds, ...demo.itemIds])
        assert.ok(!itemIds.includes(id), 'no Hindko and no demo items');
      assert.ok(page.items.every((i) => i.in_review === true));
      assert.ok(
        page.varieties.every((v) =>
          [YUSUFZAI, 'ps-var-demotest'].includes(v.id),
        ),
      );
      assert.equal(page.lessons[0].exercise_count, 6);
    }));

  test('page_review_item: the whole picture, and who may do what', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, {
        items: [{ context: 'Meeting someone.' }, {}],
        exercises: 0,
      });
      const hindko = await seedLesson(client, {
        language: 'hno',
        variety: HAZARA,
      });
      const a = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const learner = await user(client);
      const id = lesson.itemIds[0];
      await authorItem(client, a.contributorId, id, 'Hello, friend');

      await as(client, learner);
      await expectCode(
        client.query('select public.page_review_item($1)', [id]),
        'PL403_NOT_REVIEWER',
      );
      await as(client, a);
      await expectCode(
        client.query('select public.page_review_item($1)', ['ps-itm-ffffff']),
        'PL404_NOT_FOUND',
      );
      const outside = await expectCode(
        client.query('select public.page_review_item($1)', [hindko.itemIds[0]]),
        'PL403_OUTSIDE_VARIETY',
      );
      assert.match(
        outside.message,
        /Hazara Hindko needs a Hazara Hindko reviewer\./,
      );

      await value(client, 'select public.add_review_comment($1, $2, $3)', [
        'item',
        id,
        'Check the vowel.',
      ]);
      const page = await value(client, 'select public.page_review_item($1)', [
        id,
      ]);
      assert.equal(page.item.id, id);
      assert.equal(page.item.meaning, 'Hello, friend');
      assert.equal(page.language.direction, 'rtl');
      assert.equal(page.variety.id, YUSUFZAI);
      assert.equal(page.siblings.length, 2);
      assert.equal(page.revisions.length, 2);
      assert.equal(page.revisions[0].reason, 'edit');
      assert.equal(page.revisions[0].author_id, a.contributorId);
      assert.ok(page.revisions[0].author_name);
      assert.equal(page.comments.length, 1);
      assert.deepEqual(page.required_scope, [
        'text',
        'romanisation',
        'meaning',
        'usage',
      ]);
      assert.equal(page.viewer.is_author, true);
      assert.equal(page.viewer.sole_reviewer, false);
      assert.equal(page.viewer.can_approve, false);
      assert.equal(page.viewer.can_suggest, true);
    }));

  test('page_review_lesson and page_admin_suggestions', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, { exercises: 5 });
      const hindko = await seedLesson(client, {
        language: 'hno',
        variety: HAZARA,
      });
      const reviewer = await person(client, 'language_reviewer', {
        variety: YUSUFZAI,
      });
      const editor = await person(client, 'editor', { language: 'ps' });

      await as(client, reviewer);
      const outside = await expectCode(
        client.query('select public.page_review_lesson($1)', [hindko.lessonId]),
        'PL403_OUTSIDE_VARIETY',
      );
      assert.match(
        outside.message,
        /Hazara Hindko needs a Hazara Hindko reviewer\./,
      );
      await expectCode(
        client.query('select public.page_review_lesson($1)', ['ps-lsn-ffffff']),
        'PL404_NOT_FOUND',
      );
      const page = await value(client, 'select public.page_review_lesson($1)', [
        lesson.lessonId,
      ]);
      assert.equal(page.items.length, 6);
      assert.equal(page.exercises.length, 5);
      assert.equal(page.exercise_count, 5);
      assert.equal(page.viewer.can_approve, false, 'fewer than 6 exercises');
      assert.ok(Array.isArray(page.problems));

      const fp =
        page.lesson && (await fingerprint(client, 'items', lesson.itemIds[0]));
      await as(client, reviewer);
      await suggest(client, lesson.itemIds[0], fp, { meaning: 'Hi' });
      await expectCode(
        client.query('select public.page_admin_suggestions()'),
        'PL403_NOT_EDITOR',
      );
      await as(client, editor);
      const admin = await value(
        client,
        'select public.page_admin_suggestions()',
      );
      const open = admin.open.find((s) => s.item_id === lesson.itemIds[0]);
      assert.ok(open);
      assert.deepEqual(open.proposed, { meaning: 'Hi' });
      assert.equal(open.current.meaning, 'Meaning 1');
      assert.equal(open.stale, false);
      assert.equal(open.can_resolve, true);
      assert.equal(open.direction, 'rtl');
      assert.equal(open.lesson_submitted, false);
      assert.equal(open.item_retired, false);

      // Submitted lesson, retired phrase: both are said, so the page can
      // badge it "In review" or "Retired" and offer only Decline.
      await asPostgres(client);
      await client.query(
        'update content.lessons set submitted_at = now() where id = $1',
        [lesson.lessonId],
      );
      await client.query(
        'update content.items set retired_at = now(), position = null where id = $1',
        [lesson.itemIds[0]],
      );
      await as(client, editor);
      const later = await value(
        client,
        'select public.page_admin_suggestions()',
      );
      const retired = later.open.find((s) => s.item_id === lesson.itemIds[0]);
      assert.equal(retired.lesson_submitted, true);
      assert.equal(retired.item_retired, true);
    }));
});
