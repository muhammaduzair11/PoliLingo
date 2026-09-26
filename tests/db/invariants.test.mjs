// Database invariants (docs/platform.md §3.3–§3.8, §3.11). Needs a database
// with the migrations applied: `npm run test:db` (local stack, under the
// lock) or `npm run test:db:ci`. Every test runs in a rolled-back transaction.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
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

const OUR_SCHEMAS = ['public', 'content', 'private'];

// Schemas the Supabase platform and its extensions own, plus ours. Anything
// else is a schema nobody declared.
const DECLARED_SCHEMAS = [
  ...OUR_SCHEMAS,
  'auth',
  'extensions',
  'graphql',
  'graphql_public',
  'pgbouncer',
  'realtime',
  '_realtime',
  'storage',
  'supabase_functions',
  'supabase_migrations',
  'vault',
  'net',
  'pgsodium',
  'pgsodium_masks',
  'cron',
  '_analytics',
  '_supavisor',
  'pgmq',
  'pgtle',
  'information_schema',
];

const APPEND_ONLY = [
  'public.audit_events',
  'public.xp_awards',
  'public.progress_imports',
  'content.revisions',
  'content.releases',
  'content.release_lessons',
  'content.release_items',
  'content.review_decisions',
  'content.countersignatures',
  'content.review_comments',
  'content.keymap_lessons',
  'content.keymap_items',
  'content.keymap_courses',
];

const OWN_ROW_TABLES = [
  'profiles',
  'progress_completions',
  'progress_activity',
  'xp_awards',
  'progress_devices',
  'learner_prefs',
  'progress_imports',
];

const fixture = (name) => new URL(`../fixtures/${name}`, import.meta.url);

function readVectors(name) {
  const url = fixture(name);
  if (!existsSync(url)) return null;
  const json = JSON.parse(readFileSync(url, 'utf8'));
  return Array.isArray(json) ? json : (json.vectors ?? json.cases ?? null);
}

async function rows(client, text, values) {
  return (await client.query(text, values)).rows;
}

// ---------------------------------------------------------------------------
// The schema contract: each query must return zero rows
// ---------------------------------------------------------------------------

describe('schema contract', () => {
  test('RLS is enabled on every table in public, content and private', () =>
    tx(async (client) => {
      const found = await rows(
        client,
        `select n.nspname || '.' || c.relname as t
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = any ($1) and c.relkind in ('r', 'p') and not c.relrowsecurity`,
        [OUR_SCHEMAS],
      );
      assert.deepEqual(found, []);
    }));

  test('there is no undeclared schema', () =>
    tx(async (client) => {
      const found = await rows(
        client,
        `select nspname from pg_namespace
         where nspname not like 'pg\\_%' and nspname <> all ($1)`,
        [DECLARED_SCHEMAS],
      );
      assert.deepEqual(found, []);
    }));

  test('anon and PUBLIC hold no table privilege; authenticated none in public or private', () =>
    tx(async (client) => {
      const found = await rows(
        client,
        `select n.nspname || '.' || c.relname as t, a.privilege_type,
                coalesce(r.rolname, 'PUBLIC') as grantee
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral aclexplode(c.relacl) a
         left join pg_roles r on r.oid = a.grantee
         where n.nspname = any ($1)
           and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
           and (a.grantee = 0 or r.rolname = 'anon'
                or (r.rolname = 'authenticated' and n.nspname in ('public', 'private')))`,
        [OUR_SCHEMAS],
      );
      assert.deepEqual(found, []);
    }));

  test('authenticated holds only SELECT in content', () =>
    tx(async (client) => {
      const found = await rows(
        client,
        `select c.relname, a.privilege_type
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral aclexplode(c.relacl) a
         join pg_roles r on r.oid = a.grantee
         where n.nspname = 'content' and r.rolname = 'authenticated'
           and a.privilege_type <> 'SELECT'`,
      );
      assert.deepEqual(found, []);
    }));

  test('anon may execute no function except public.get_learner_release(text)', () =>
    tx(async (client) => {
      const found = await rows(
        client,
        `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = any ($1)
           and has_function_privilege('anon', p.oid, 'execute')
           and not (n.nspname = 'public' and p.proname = 'get_learner_release'
                    and p.proargtypes::oid[] = array['text'::regtype::oid])`,
        [OUR_SCHEMAS],
      );
      assert.deepEqual(found, []);
    }));

  test('every SECURITY DEFINER function pins its search_path', () =>
    tx(async (client) => {
      const found = await rows(
        client,
        `select n.nspname || '.' || p.proname as f
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = any ($1) and p.prosecdef
           and not exists (
             select 1 from unnest(coalesce(p.proconfig, '{}')) s where s like 'search_path=%'
           )`,
        [OUR_SCHEMAS],
      );
      assert.deepEqual(found, []);
    }));

  test('every view is security_invoker', () =>
    tx(async (client) => {
      const found = await rows(
        client,
        `select n.nspname || '.' || c.relname as v
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = any ($1) and c.relkind in ('v', 'm')
           and not coalesce(array_to_string(c.reloptions, ',') ~ 'security_invoker=(true|on|1)', false)`,
        [OUR_SCHEMAS],
      );
      assert.deepEqual(found, []);
    }));

  test('default privileges give anon, authenticated and PUBLIC nothing new', () =>
    tx(async (client) => {
      // Objects the migration role creates later (tracks' functions) must
      // start with no grant, so each API function is granted explicitly.
      const found = await rows(
        client,
        `select coalesce(n.nspname, '(global)') as schema, d.defaclobjtype as kind,
                coalesce(r.rolname, 'PUBLIC') as grantee
         from pg_default_acl d
         left join pg_namespace n on n.oid = d.defaclnamespace
         cross join lateral aclexplode(d.defaclacl) a
         left join pg_roles r on r.oid = a.grantee
         where d.defaclrole = (select oid from pg_roles where rolname = current_user)
           and (d.defaclnamespace = 0 or n.nspname = any ($1))
           and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))`,
        [OUR_SCHEMAS],
      );
      assert.deepEqual(found, []);
      const publicExecute = await value(
        client,
        `select not exists (
           select 1 from pg_default_acl d
           where d.defaclrole = (select oid from pg_roles where rolname = current_user)
             and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
         )`,
      );
      assert.equal(
        publicExecute,
        false,
        'EXECUTE for PUBLIC on new functions is revoked globally',
      );
    }));

  test('bootstrap_first_admin is executable by nobody but its owner', () =>
    tx(async (client) => {
      const found = await rows(
        client,
        `select r.rolname from pg_roles r
         where r.rolname in ('anon', 'authenticated', 'authenticator', 'service_role')
           and has_function_privilege(r.oid, 'private.bootstrap_first_admin(text)', 'execute')`,
      );
      assert.deepEqual(found, []);
    }));
});

// ---------------------------------------------------------------------------
// Row Level Security
// ---------------------------------------------------------------------------

describe('row level security', () => {
  test('learner A cannot read learner B, through the policies or the RPCs', () =>
    tx(async (client) => {
      const a = await user(client);
      const b = await user(client);
      for (const [u, lesson] of [
        [a, 'ps-lsn-aaaaaa'],
        [b, 'ps-lsn-bbbbbb'],
      ]) {
        await client.query(
          `insert into public.progress_completions (user_id, lesson_id, first_release) values ($1, $2, 'mvp')`,
          [u.id, lesson],
        );
        await client.query(
          `insert into public.progress_activity (user_id, local_date, count) values ($1, '2026-09-27', 2)`,
          [u.id],
        );
        await client.query(
          `insert into public.xp_awards (user_id, award_key, amount, lesson_id, source)
           values ($1, 'lesson:' || $2, 15, $2, 'lesson')`,
          [u.id, lesson],
        );
        await client.query(
          `insert into public.progress_devices (user_id, device_id, reported_xp) values ($1, 'device-1', 20)`,
          [u.id],
        );
        await client.query(
          `insert into public.learner_prefs (user_id, daily_goal, selected_course) values ($1, 2, 'pashto')`,
          [u.id],
        );
        await client.query(
          `insert into public.progress_imports (user_id, envelope_hash, device_id) values ($1, $2, 'device-1')`,
          [u.id, (u.id.replaceAll('-', '') + '0'.repeat(64)).slice(0, 64)],
        );
      }
      // public tables carry no grants; grant SELECT inside this rolled-back
      // transaction so the policies themselves are what is tested.
      for (const t of OWN_ROW_TABLES) {
        await client.query(`grant select on public.${t} to authenticated`);
      }
      await as(client, a);
      for (const t of OWN_ROW_TABLES) {
        const seen = await rows(client, `select user_id from public.${t}`);
        assert.ok(seen.length > 0, `${t}: A sees their own rows`);
        assert.ok(
          seen.every((r) => r.user_id === a.id),
          `${t}: A sees only their own rows`,
        );
      }
      await asPostgres(client);
      const rpc = await value(
        client,
        `select to_regprocedure('public.get_my_progress()') is not null`,
      );
      if (rpc) {
        await as(client, a);
        const state = await value(client, 'select public.get_my_progress()');
        assert.ok(!JSON.stringify(state).includes('ps-lsn-bbbbbb'));
        assert.ok(JSON.stringify(state).includes('ps-lsn-aaaaaa'));
      }
    }));

  test('a signed-in user without a role reads zero content rows', () =>
    tx(async (client) => {
      await seedLesson(client);
      const relations = (
        await rows(
          client,
          `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'content' and c.relkind in ('r', 'p', 'v') order by 1`,
        )
      ).map((r) => r.relname);
      assert.ok(relations.includes('items'));
      assert.ok(
        Number(await value(client, 'select count(*) from content.items')) > 0,
      );
      const learner = await user(client);
      await as(client, learner);
      for (const r of relations) {
        const n = Number(
          await value(client, `select count(*) from content.${r}`),
        );
        assert.equal(n, 0, `content.${r} is readable by a learner`);
      }
    }));

  test('anon reads nothing and cannot call my_context', () =>
    tx(async (client) => {
      await asAnon(client);
      await expectCode(
        client.query('select 1 from content.items limit 1'),
        '42501',
      );
      await expectCode(
        client.query('select 1 from public.profiles limit 1'),
        '42501',
      );
      await expectCode(
        client.query('select 1 from private.app_settings limit 1'),
        '42501',
      );
      await expectCode(client.query('select public.my_context()'), '42501');
    }));

  test('a reviewer reads only their own variety', () =>
    tx(async (client) => {
      const mine = await seedLesson(client, { variety: 'ps-var-yusufzai' });
      const other = await seedLesson(client, { variety: 'ps-var-othertest' });
      const reviewer = await user(client);
      await grant(client, reviewer, 'language_reviewer', {
        variety: 'ps-var-yusufzai',
      });
      await as(client, reviewer);

      const lessons = await rows(
        client,
        'select id, variety_id from content.lessons',
      );
      assert.ok(lessons.some((l) => l.id === mine.lessonId));
      assert.ok(lessons.every((l) => l.variety_id === 'ps-var-yusufzai'));
      const items = await rows(
        client,
        'select variety_id, lesson_id from content.items',
      );
      assert.ok(items.some((i) => i.lesson_id === mine.lessonId));
      assert.ok(items.every((i) => i.variety_id === 'ps-var-yusufzai'));
      assert.equal(
        Number(
          await value(
            client,
            'select count(*) from content.exercises where lesson_id = $1',
            [other.lessonId],
          ),
        ),
        0,
      );
      assert.equal(
        Number(
          await value(
            client,
            'select count(*) from content.exercises where lesson_id = $1',
            [mine.lessonId],
          ),
        ),
        6,
      );
      assert.equal(
        Number(
          await value(
            client,
            `select count(*) from content.revisions where variety_id = 'ps-var-othertest'`,
          ),
        ),
        0,
      );
      // Staff-wide tables are visible to any staff member.
      assert.ok(
        Number(await value(client, 'select count(*) from content.languages')) >
          0,
      );
    }));

  test('an editor scoped to a language reads its varieties; an admin reads all', () =>
    tx(async (client) => {
      const ps = await seedLesson(client, { variety: 'ps-var-yusufzai' });
      const ur = await seedLesson(client, {
        language: 'ur',
        variety: 'ur-var-test',
      });
      const editor = await user(client);
      await grant(client, editor, 'editor', { language: 'ps' });
      const admin = await user(client);
      await grant(client, admin, 'admin');

      await as(client, editor);
      const seen = (await rows(client, 'select id from content.lessons')).map(
        (r) => r.id,
      );
      assert.ok(seen.includes(ps.lessonId));
      assert.ok(!seen.includes(ur.lessonId));
      assert.equal(
        await value(client, 'select private.can_edit_language($1)', ['ps']),
        true,
      );
      assert.equal(
        await value(client, 'select private.can_edit_language($1)', ['ur']),
        false,
      );

      await as(client, admin);
      const all = (await rows(client, 'select id from content.lessons')).map(
        (r) => r.id,
      );
      assert.ok(all.includes(ps.lessonId) && all.includes(ur.lessonId));
    }));

  test('a staff grant counts only while active, for an active 18+ contributor', () =>
    tx(async (client) => {
      const reviewer = await user(client);
      const { contributorId, grantId } = await grant(
        client,
        reviewer,
        'language_reviewer',
        {
          variety: 'ps-var-yusufzai',
        },
      );
      await as(client, reviewer);
      assert.equal(await value(client, 'select private.is_staff()'), true);
      await asPostgres(client);
      await client.query(
        `update public.contributors set status = 'paused' where id = $1`,
        [contributorId],
      );
      await as(client, reviewer);
      assert.equal(await value(client, 'select private.is_staff()'), false);
      await asPostgres(client);
      await client.query(
        `update public.contributors set status = 'active' where id = $1`,
        [contributorId],
      );
      await client.query(
        `update public.role_grants set ends_at = now() where id = $1`,
        [grantId],
      );
      await as(client, reviewer);
      assert.equal(await value(client, 'select private.is_staff()'), false);
    }));
});

// ---------------------------------------------------------------------------
// Append-only
// ---------------------------------------------------------------------------

describe('append-only tables', () => {
  async function fillAppendOnly(client) {
    const lesson = await seedLesson(client);
    const u = await user(client);
    const { contributorId } = await grant(client, u, 'language_reviewer', {
      variety: 'ps-var-yusufzai',
    });
    const pos = 900000 + Math.floor(Math.random() * 90000);
    await client.query(
      `insert into public.audit_events (actor_kind, action) values ('system', 'test.append_only')`,
    );
    await client.query(
      `insert into public.xp_awards (user_id, award_key, amount, source) values ($1, 'session:s1', 5, 'session')`,
      [u.id],
    );
    await client.query(
      `insert into public.progress_imports (user_id, envelope_hash) values ($1, repeat('a', 64))`,
      [u.id],
    );
    const seq = await value(
      client,
      `insert into content.releases (name, kind, content_hash, payload)
       values ('content@2099.12.999999', 'publish', 'sha256-' || repeat('0', 64), '{}') returning seq`,
    );
    await client.query(
      `insert into content.release_lessons (release_seq, lesson_id, lesson_class, source) values ($1, $2, 'reviewed', 'current')`,
      [seq, lesson.lessonId],
    );
    await client.query(
      `insert into content.release_items (release_seq, item_id, lesson_id, is_demo) values ($1, $2, $3, false)`,
      [seq, lesson.itemIds[0], lesson.lessonId],
    );
    const decision = await value(
      client,
      `insert into content.review_decisions (target_type, item_id, variety_id, decision, reviewer_contributor_id, seen_fingerprint, comment)
       select 'item', i.id, i.variety_id, 'approve', $2, i.review_fingerprint, 'Looks right.'
       from content.items i where i.id = $1 returning id`,
      [lesson.itemIds[0], contributorId],
    );
    await client.query(
      `insert into content.countersignatures (decision_id, variety_id, admin_contributor_id) values ($1, 'ps-var-yusufzai', $2)`,
      [decision, contributorId],
    );
    await client.query(
      `insert into content.review_comments (target_type, target_id, variety_id, author_contributor_id, body)
       values ('item', $1, 'ps-var-yusufzai', $2, 'A comment.')`,
      [lesson.itemIds[0], contributorId],
    );
    await client.query(
      `insert into content.keymap_lessons (legacy_key, lesson_id, course_id, position) values ('test/append-only', $1, $2, $3)`,
      [lesson.lessonId, lesson.courseId, pos],
    );
    await client.query(
      `insert into content.keymap_items (legacy_ref, item_id, position) values ('test-append-only-0', $1, $2)`,
      [lesson.itemIds[0], pos],
    );
    await client.query(
      `insert into content.keymap_courses (legacy_id, course_id, position) values ('testappendonly', $1, $2)`,
      [lesson.courseId, pos],
    );
    return { lesson, u, contributorId };
  }

  test('update and delete are refused, even as postgres', () =>
    tx(async (client) => {
      await fillAppendOnly(client);
      for (const t of APPEND_ONLY) {
        const count = Number(await value(client, `select count(*) from ${t}`));
        assert.ok(count > 0, `${t} has a row to test with`);
        const col = await value(
          client,
          `select a.attname from pg_attribute a
           where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
             and a.attidentity = '' and a.attgenerated = ''
           order by a.attnum desc limit 1`,
          [t],
        );
        await expectCode(
          client.query(`update ${t} set ${col} = ${col}`),
          'PL409_APPEND_ONLY',
        );
        await expectCode(client.query(`delete from ${t}`), 'PL409_APPEND_ONLY');
      }
    }));

  test('truncate is refused', () =>
    tx(async (client) => {
      await fillAppendOnly(client);
      for (const t of [
        'public.audit_events',
        'public.xp_awards',
        'public.progress_imports',
        'content.release_items',
        'content.countersignatures',
        'content.keymap_items',
      ]) {
        await expectCode(client.query(`truncate ${t}`), 'PL409_APPEND_ONLY');
      }
    }));

  test('a comment can only be redacted, and only in redaction mode', () =>
    tx(async (client) => {
      await fillAppendOnly(client);
      const id = await value(
        client,
        'select id from content.review_comments limit 1',
      );
      await expectCode(
        client.query(
          `update content.review_comments set body = '[removed]', redacted_at = now() where id = $1`,
          [id],
        ),
        'PL409_APPEND_ONLY',
      );
      await client.query(
        "select set_config('polilingo.redaction', 'on', true)",
      );
      await expectCode(
        client.query(
          `update content.review_comments set body = 'Changed.', redacted_at = now() where id = $1`,
          [id],
        ),
        'PL409_APPEND_ONLY',
      );
      await client.query(
        `update content.review_comments set body = '[removed]', redacted_at = now() where id = $1`,
        [id],
      );
      assert.equal(
        await value(
          client,
          'select body from content.review_comments where id = $1',
          [id],
        ),
        '[removed]',
      );
    }));

  test("a learner's ledger rows go only with their own account deletion", () =>
    tx(async (client) => {
      const { u } = await fillAppendOnly(client);
      const learner = await user(client);
      await client.query(
        `insert into public.xp_awards (user_id, award_key, amount, source) values ($1, 'session:s2', 5, 'session')`,
        [learner.id],
      );
      await expectCode(
        client.query('delete from auth.users where id = $1', [learner.id]),
        'PL409_APPEND_ONLY',
      );
      await client.query(
        "select set_config('polilingo.account_deletion', $1, true)",
        [u.id],
      );
      await expectCode(
        client.query('delete from auth.users where id = $1', [learner.id]),
        'PL409_APPEND_ONLY',
      );
      await client.query(
        "select set_config('polilingo.account_deletion', $1, true)",
        [learner.id],
      );
      await client.query('delete from auth.users where id = $1', [learner.id]);
      assert.equal(
        Number(
          await value(
            client,
            'select count(*) from public.xp_awards where user_id = $1',
            [learner.id],
          ),
        ),
        0,
      );
    }));
});

// ---------------------------------------------------------------------------
// Derivations and the state machine (§3.5)
// ---------------------------------------------------------------------------

describe('derivations', () => {
  test('editing an item text voids its approval and writes a revision', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const id = lesson.itemIds[0];
      await client.query(
        `update content.items set review_status = 'approved' where id = $1`,
        [id],
      );
      const before = await one(
        client,
        'select * from content.items where id = $1',
        [id],
      );
      assert.equal(before.review_status, 'approved');

      await client.query(
        `update content.items set native = '  سلام   سلام ' where id = $1`,
        [id],
      );
      const after = await one(
        client,
        'select * from content.items where id = $1',
        [id],
      );
      assert.equal(after.native, 'سلام سلام', 'native is stored normalised');
      assert.equal(after.review_status, 'unreviewed');
      assert.equal(after.current_decision_id, null);
      assert.equal(after.revision_no, before.revision_no + 1);
      assert.notEqual(after.text_fingerprint, before.text_fingerprint);
      assert.notEqual(after.review_fingerprint, before.review_fingerprint);
      assert.equal(
        after.text_fingerprint,
        await value(client, 'select private.text_fingerprint($1)', ['سلام سلام']),
      );
      const revision = await one(
        client,
        `select reason, text_fingerprint from content.revisions
         where object_type = 'item' and object_id = $1 and revision_no = $2`,
        [id, after.revision_no],
      );
      assert.equal(revision.reason, 'edit');
      assert.equal(revision.text_fingerprint, after.text_fingerprint);
      const imported = await value(
        client,
        `select reason from content.revisions where object_type = 'item' and object_id = $1 and revision_no = 1`,
        [id],
      );
      assert.equal(imported, 'import');
    }));

  test('a change that is not learner-visible keeps the approval', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const id = lesson.itemIds[0];
      await client.query(
        `update content.items set review_status = 'approved' where id = $1`,
        [id],
      );
      await client.query(
        `update content.items set tags = array['greeting'] where id = $1`,
        [id],
      );
      const row = await one(
        client,
        'select review_status, revision_no from content.items where id = $1',
        [id],
      );
      assert.equal(row.review_status, 'approved');
      assert.equal(row.revision_no, 2);
    }));

  test('the revision reason comes from polilingo.revision_reason', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      await client.query(
        "select set_config('polilingo.revision_reason', 'suggestion', true)",
      );
      await client.query(
        `update content.items set meaning = 'Greetings' where id = $1`,
        [lesson.itemIds[0]],
      );
      const reason = await value(
        client,
        `select reason from content.revisions where object_type = 'item' and object_id = $1 order by seq desc limit 1`,
        [lesson.itemIds[0]],
      );
      assert.equal(reason, 'suggestion');
    }));

  test('the lesson fingerprint follows its items and exercises', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const approve = () =>
        client.query(
          `update content.lessons set review_status = 'approved' where id = $1`,
          [lesson.lessonId],
        );
      const status = () =>
        value(
          client,
          'select review_status from content.lessons where id = $1',
          [lesson.lessonId],
        );

      await approve();
      await client.query(
        `update content.items set meaning = 'Hello there' where id = $1`,
        [lesson.itemIds[0]],
      );
      assert.equal(
        await status(),
        'approved',
        'item text is not part of the lesson fingerprint',
      );

      await client.query(
        `update content.exercises set prompt = 'Which one means this?' where id = $1`,
        [lesson.exerciseIds[0]],
      );
      assert.equal(
        await status(),
        'unreviewed',
        'an exercise prompt edit voids the lesson',
      );

      await approve();
      await client.query(
        `update content.lessons set title = 'Another title' where id = $1`,
        [lesson.lessonId],
      );
      assert.equal(
        await status(),
        'unreviewed',
        'a title edit voids the lesson',
      );

      await approve();
      await client.query(
        `update content.exercises set retired_at = now(), position = null where id = $1`,
        [lesson.exerciseIds[5]],
      );
      assert.equal(
        await status(),
        'unreviewed',
        'retiring an exercise voids the lesson',
      );

      await approve();
      await client.query(
        `update content.lessons set submitted_at = now() where id = $1`,
        [lesson.lessonId],
      );
      assert.equal(await status(), 'approved', 'submitting is not an edit');
    }));

  test('moving a unit to another course carries its lessons, with a move revision', () =>
    tx(async (client) => {
      const { language, variety, unitId, lessonId } = await seedLesson(client, {
        items: 2,
        exercises: 1,
      });
      const target = `${language}-crs-tmove${Date.now().toString(36)}`;
      await client.query(
        `insert into content.courses (id, language_code, variety_id, name, publish_gate)
         values ($1, $2, $3, 'Second test course', 'open')`,
        [target, language, variety],
      );
      const before = await one(
        client,
        'select revision_no, review_fingerprint from content.lessons where id = $1',
        [lessonId],
      );
      await client.query(
        "select set_config('polilingo.revision_reason', 'move', true)",
      );
      // One statement, as move_content writes it: the lessons follow the unit.
      await client.query(
        'update content.units set course_id = $1 where id = $2',
        [target, unitId],
      );
      const after = await one(
        client,
        'select course_id, revision_no, review_fingerprint from content.lessons where id = $1',
        [lessonId],
      );
      assert.equal(after.course_id, target);
      assert.equal(after.revision_no, before.revision_no + 1);
      assert.equal(after.review_fingerprint, before.review_fingerprint);
      assert.deepEqual(
        await rows(
          client,
          `select object_type, reason from content.revisions
           where object_id in ($1, $2) and revision_no > 1 order by object_type`,
          [lessonId, unitId],
        ),
        [
          { object_type: 'lesson', reason: 'move' },
          { object_type: 'unit', reason: 'move' },
        ],
      );
    }));

  test('text rules refuse a phrase with an invisible character', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const err = await expectCode(
        client.query(`update content.items set native = $2 where id = $1`, [
          lesson.itemIds[0],
          'سل‏ام',
        ]),
        'PL422_INVISIBLE_CHAR',
      );
      assert.match(err.detail, /"position": ?3/);
    }));

  test('native_problems reports every rule with the character and its position', () =>
    tx(async (client) => {
      await client.query(
        `insert into content.languages (code, name, native_name, script, direction, locale)
         values ('zzq', 'Testish', 'Testish', 'Arab', 'rtl', 'zzq-Arab') on conflict do nothing`,
      );
      for (const ch of ['س', 'ل', 'ا', 'م', ' ']) {
        await client.query(
          `insert into content.orthography_allowlist (language_code, cp) values ('zzq', $1) on conflict do nothing`,
          [ch.codePointAt(0)],
        );
      }
      const problems = await value(
        client,
        'select private.native_problems($1, $2, $3)',
        ['zzq', 'سلام‎“ب٣', 'سلام'],
      );
      const codes = problems.map((p) => p.code);
      assert.deepEqual(codes, [
        'PL422_INVISIBLE_CHAR',
        'PL422_SMART_QUOTE',
        'PL422_CHAR_NOT_ALLOWED',
        'PL422_ARABIC_DIGIT',
        'PL422_ROMANISATION_SCRIPT',
        'PL422_ROMANISATION_NO_LATIN',
      ]);
      assert.deepEqual(
        problems.slice(0, 4).map((p) => [p.char, p.position]),
        [
          ['‎', 5],
          ['“', 6],
          ['ب', 7],
          ['٣', 8],
        ],
      );
      assert.deepEqual(
        await value(client, 'select private.native_problems($1, $2, $3)', [
          'zzq',
          'سلام',
          'Salaam',
        ]),
        [],
      );
      // No allowlist rows: the character list is not checked.
      assert.deepEqual(
        await value(client, 'select private.native_problems($1, $2, $3)', [
          'qqz',
          'بب',
          'Bab',
        ]),
        [],
      );
    }));

  test('exercise options must be other live phrases of the same lesson', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const other = await seedLesson(client);
      const insert = (kind, answer, options) =>
        client.query(
          `insert into content.exercises (id, lesson_id, position, kind, answer_item_id, prompt, options)
           values ('ps-exr-' || substr(md5(random()::text), 1, 6), $1, 50, $2, $3, 'Pick one', $4)`,
          [lesson.lessonId, kind, answer, options],
        );
      const [a, b] = lesson.itemIds;
      await expectCode(insert('meaning', a, [a]), 'PL422_OPTION_EQUALS_ANSWER');
      await expectCode(insert('meaning', a, []), 'PL422_BAD_OPTION');
      await expectCode(insert('assemble', a, [b]), 'PL422_BAD_OPTION');
      await expectCode(
        insert('meaning', a, [other.itemIds[0]]),
        'PL422_BAD_OPTION',
      );
      await expectCode(insert('meaning', a, [b, b]), 'PL422_BAD_OPTION');
      await client.query(
        `update content.items set meaning = 'Meaning 1' where id = $1`,
        [b],
      );
      await expectCode(insert('meaning', a, [b]), 'PL422_OPTION_EQUALS_ANSWER');
      await insert('assemble', a, []);
    }));

  test('effective_gate, lesson_problems and lesson_json', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, { variety: 'ps-var-gatetest' });
      assert.equal(
        await value(client, 'select private.effective_gate($1)', [
          lesson.lessonId,
        ]),
        'open',
      );
      await client.query(
        `update content.varieties set publish_gate = 'blocked' where id = 'ps-var-gatetest'`,
      );
      assert.equal(
        await value(client, 'select private.effective_gate($1)', [
          lesson.lessonId,
        ]),
        'blocked',
      );
      assert.equal(
        await value(client, 'select private.effective_gate($1)', [
          'ps-lsn-000000',
        ]),
        null,
      );

      const clean = await value(client, 'select private.lesson_problems($1)', [
        lesson.lessonId,
      ]);
      assert.deepEqual(
        clean.filter((p) => p.severity === 'blocking'),
        [],
      );
      const thin = await seedLesson(client, { items: 3, exercises: 2 });
      const warnings = await value(
        client,
        'select private.lesson_problems($1)',
        [thin.lessonId],
      );
      assert.ok(
        warnings.some(
          (p) =>
            p.severity === 'warning' && p.code === 'PL422_TOO_FEW_EXERCISES',
        ),
      );
      const bare = await seedLesson(client, { items: 1, exercises: 0 });
      const blocking = await value(
        client,
        'select private.lesson_problems($1)',
        [bare.lessonId],
      );
      assert.ok(
        blocking.some(
          (p) =>
            p.severity === 'blocking' && p.code === 'PL422_TOO_FEW_EXERCISES',
        ),
      );

      const json = await value(client, 'select private.lesson_json($1)', [
        lesson.lessonId,
      ]);
      assert.deepEqual(Object.keys(json).sort(), [
        'exercises',
        'id',
        'items',
        'objective',
        'order',
        'subtitle',
        'title',
        'variety',
      ]);
      assert.equal(json.items.length, 6);
      assert.deepEqual(Object.keys(json.items[0]).sort(), [
        'citation',
        'id',
        'meaning',
        'native',
        'romanisation',
        'variety',
      ]);
      assert.deepEqual(Object.keys(json.exercises[0]).sort(), [
        'id',
        'item',
        'kind',
        'options',
        'prompt',
      ]);
    }));

  test('lesson_json reproduces every lesson of the seeded release', () =>
    tx(async (client) => {
      const release = await one(
        client,
        `select name, payload from content.releases where kind = 'seed' order by seq limit 1`,
      );
      if (!release) {
        console.log('# no seed release in this database; skipped');
        return;
      }
      const lessons = release.payload.courses.flatMap((c) =>
        c.units.flatMap((u) => u.lessons),
      );
      assert.ok(lessons.length > 0);
      for (const lesson of lessons) {
        const built = await value(client, 'select private.lesson_json($1)', [
          lesson.id,
        ]);
        assert.deepEqual(built, lesson, `${release.name}: ${lesson.id}`);
      }
    }));
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('guards', () => {
  test('demo phrases are frozen and the demo list grows only while seeding', () =>
    tx(async (client) => {
      const demo = await seedLesson(client, {
        demo: true,
        language: 'ps',
        items: 2,
        exercises: 1,
      });
      await expectCode(
        client.query(
          `update content.items set meaning = 'Changed' where id = $1`,
          [demo.itemIds[0]],
        ),
        'PL409_DEMO_FROZEN',
      );
      const plain = await seedLesson(client);
      await expectCode(
        client.query(
          `insert into content.demo_items (item_id, ml_training) values ($1, 'not_granted')`,
          [plain.itemIds[0]],
        ),
        'PL409_DEMO_FROZEN',
      );
      await expectCode(
        client.query('delete from content.demo_items where item_id = $1', [
          demo.itemIds[0],
        ]),
        'PL409_APPEND_ONLY',
      );
      await expectCode(
        client.query(
          `update content.demo_period set live = not live where language_code = 'ps'`,
        ),
        'PL409_DEMO_FROZEN',
      );
      await client.query(
        `update content.demo_period set sunset = sunset + 1 where language_code = 'ps'`,
      );
      await client.query("select set_config('polilingo.seeding', 'on', true)");
      await client.query(
        `update content.items set meaning = 'Changed' where id = $1`,
        [demo.itemIds[0]],
      );
    }));

  test('progress only moves forward', () =>
    tx(async (client) => {
      const u = await user(client);
      await client.query(
        `insert into public.progress_completions (user_id, lesson_id, first_release) values ($1, 'ps-lsn-abcdef', 'content@2026.09.2')`,
        [u.id],
      );
      const setRelease = (r) =>
        client.query(
          `update public.progress_completions set first_release = $2 where user_id = $1 and lesson_id = 'ps-lsn-abcdef'`,
          [u.id, r],
        );
      await expectCode(setRelease('content@2026.10.1'), 'PL409_APPEND_ONLY');
      await expectCode(
        setRelease('content@2026.09.dev+abc1234'),
        'PL409_APPEND_ONLY',
      );
      await setRelease('content@2026.09.1');
      await setRelease('mvp');
      await expectCode(setRelease('content@2026.09.1'), 'PL409_APPEND_ONLY');

      await client.query(
        `insert into public.progress_activity (user_id, local_date, count) values ($1, '2026-09-27', 3)`,
        [u.id],
      );
      await expectCode(
        client.query(
          `update public.progress_activity set count = 2 where user_id = $1`,
          [u.id],
        ),
        'PL409_APPEND_ONLY',
      );
      await client.query(
        `update public.progress_activity set count = 5 where user_id = $1`,
        [u.id],
      );

      await client.query(
        `insert into public.progress_devices (user_id, device_id, reported_xp) values ($1, 'd1', 50)`,
        [u.id],
      );
      await expectCode(
        client.query(
          `update public.progress_devices set reported_xp = 40 where user_id = $1`,
          [u.id],
        ),
        'PL409_APPEND_ONLY',
      );
      await client.query(
        `update public.progress_devices set reported_xp = 60 where user_id = $1`,
        [u.id],
      );

      assert.deepEqual(
        await value(
          client,
          `select private.release_sort_key('mvp') < private.release_sort_key('content@2026.09.1')`,
        ),
        true,
      );
      assert.deepEqual(
        await value(
          client,
          `select private.release_sort_key('content@2026.09.2') < private.release_sort_key('content@2026.10.1')
             and private.release_sort_key('content@2026.10.1') < private.release_sort_key('content@2026.10.dev+abc')`,
        ),
        true,
      );
    }));

  test('role grants change only their end and revoke fields, and are never deleted', () =>
    tx(async (client) => {
      const u = await user(client);
      const { contributorId, grantId } = await grant(client, u, 'editor', {
        language: 'ps',
      });
      await expectCode(
        client.query(
          `update public.role_grants set language_code = 'hno' where id = $1`,
          [grantId],
        ),
        'PL409_APPEND_ONLY',
      );
      await expectCode(
        client.query(
          `update public.role_grants set ends_at = now() - interval '1 hour' where id = $1`,
          [grantId],
        ),
        'PL422_BAD_DATE',
      );
      await expectCode(
        client.query('delete from public.role_grants where id = $1', [grantId]),
        'PL409_APPEND_ONLY',
      );
      await client.query(
        `update public.role_grants set ends_at = now() + interval '1 day', revoked_by = $2, revoke_reason = 'Test'
         where id = $1`,
        [grantId, contributorId],
      );

      const admin = await user(client);
      await grant(client, admin, 'admin');
      await expectCode(
        grant(client, admin, 'language_reviewer', {
          variety: 'ps-var-yusufzai',
        }),
        'PL409_ROLE_CONFLICT',
      );
      const reviewer = await user(client);
      await grant(client, reviewer, 'language_reviewer', {
        variety: 'ps-var-yusufzai',
      });
      await expectCode(grant(client, reviewer, 'admin'), 'PL409_ROLE_CONFLICT');
    }));

  test('a grant insert first locks its contributor, so concurrent grants serialise', () =>
    tx(async (client) => {
      const u = await user(client);
      const { contributorId } = await grant(client, u, 'editor', {
        language: 'ps',
      });
      // The per-contributor advisory lock is held until the transaction ends.
      const held = await value(
        client,
        `select exists (
           select 1
           from pg_locks l,
                (select hashtextextended('polilingo.role_grants:' || $1, 0) as k) x
           where l.locktype = 'advisory'
             and l.pid = pg_backend_pid()
             and l.objsubid = 1
             and l.classid::bigint = (x.k >> 32) & 4294967295
             and l.objid::bigint = x.k & 4294967295)`,
        [contributorId],
      );
      assert.equal(held, true);
    }));

  test('the local seeds refuse a database that holds more than local test data', () =>
    tx(async (client) => {
      const seed = (name) =>
        readFileSync(
          new URL(`../../supabase/seeds/${name}`, import.meta.url),
          'utf8',
        ).replace(/^(begin|commit);$/gm, '');
      await user(client, { email: 'someone@example.org' });
      await assert.rejects(
        client.query(seed('10_people.sql')),
        /for the local stack only/,
      );
      // The fixture seed is a no-op on a database seeded with it; without the
      // record it reaches its local-only guard.
      await client.query('delete from private.seed_runs');
      await assert.rejects(
        client.query(seed('20_content_fixture.sql')),
        /for the local stack only/,
      );
    }));

  test('suggestions change only while open', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client);
      const u = await user(client);
      const { contributorId } = await grant(client, u, 'language_reviewer', {
        variety: 'ps-var-yusufzai',
      });
      const id = await value(
        client,
        `insert into content.suggestions (item_id, variety_id, suggester_contributor_id, base_review_fingerprint, proposed)
         select i.id, i.variety_id, $2, i.review_fingerprint, '{"meaning": "Hi"}'
         from content.items i where i.id = $1 returning id`,
        [lesson.itemIds[0], contributorId],
      );
      await expectCode(
        client.query(
          `update content.suggestions set proposed = '{"meaning": "Hey"}' where id = $1`,
          [id],
        ),
        'PL409_APPEND_ONLY',
      );
      await expectCode(
        client.query('delete from content.suggestions where id = $1', [id]),
        'PL409_APPEND_ONLY',
      );
      await client.query(
        `update content.suggestions set status = 'accepted', resolved_by = $2, resolved_at = now() where id = $1`,
        [id, contributorId],
      );
      await expectCode(
        client.query(
          `update content.suggestions set status = 'declined' where id = $1`,
          [id],
        ),
        'PL409_SUGGESTION_CLOSED',
      );
    }));

  test('id_registry rows are retired once and never removed', () =>
    tx(async (client) => {
      await client.query(
        `insert into content.id_registry (id, type, language_code) values ('ps-itm-fedcba', 'item', 'ps')`,
      );
      await expectCode(
        client.query(
          `delete from content.id_registry where id = 'ps-itm-fedcba'`,
        ),
        'PL409_APPEND_ONLY',
      );
      await client.query(
        `update content.id_registry set retired_at = now() where id = 'ps-itm-fedcba'`,
      );
      await expectCode(
        client.query(
          `update content.id_registry set retired_at = null where id = 'ps-itm-fedcba'`,
        ),
        'PL409_APPEND_ONLY',
      );
    }));
});

// ---------------------------------------------------------------------------
// Shared vectors: the SQL primitives equal the JavaScript ones (§3.3)
// ---------------------------------------------------------------------------

describe('shared vectors', () => {
  test('canonical_json equals tests/fixtures/canonical-json-vectors.json', async (t) => {
    const vectors = readVectors('canonical-json-vectors.json');
    if (!vectors) {
      t.skip(
        'tests/fixtures/canonical-json-vectors.json is absent (F-WEB writes it)',
      );
      return;
    }
    await tx(async (client) => {
      for (const v of vectors) {
        const input = v.input ?? v.value;
        const expected = v.canonical ?? v.expected ?? v.output;
        const row = await one(
          client,
          `select private.canonical_json($1::jsonb) as c,
                  encode(sha256(convert_to(private.canonical_json($1::jsonb), 'UTF8')), 'hex') as h`,
          [JSON.stringify(input === undefined ? null : input)],
        );
        assert.equal(row.c, expected, `canonical_json: ${v.name}`);
        if (v.sha256) assert.equal(row.h, v.sha256, `sha256: ${v.name}`);
      }
    });
  });

  test('normalise_native and text_fingerprint equal tests/fixtures/fingerprint-vectors.json', async (t) => {
    const vectors = readVectors('fingerprint-vectors.json');
    if (!vectors) {
      t.skip(
        'tests/fixtures/fingerprint-vectors.json is absent (F-WEB writes it)',
      );
      return;
    }
    await tx(async (client) => {
      for (const v of vectors) {
        const text = v.text ?? v.input;
        const row = await one(
          client,
          'select private.normalise_native($1) as n, private.text_fingerprint($1) as f',
          [text],
        );
        if (v.normalised !== undefined)
          assert.equal(row.n, v.normalised, `normalise_native: ${v.name}`);
        assert.equal(
          row.f,
          v.fingerprint ?? v.expected,
          `text_fingerprint: ${v.name}`,
        );
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Foundation functions (§3.6)
// ---------------------------------------------------------------------------

describe('foundation functions', () => {
  test('bootstrap_first_admin works once, and refuses when an admin exists', () =>
    tx(async (client) => {
      await asPostgres(client);
      await client.query("select set_config('request.jwt.claims', '', true)");
      await client.query(
        `update public.role_grants set ends_at = now()
         where role = 'admin' and (ends_at is null or ends_at > now())`,
      );
      const bootstrap = (email) =>
        value(client, 'select private.bootstrap_first_admin($1)', [email]);

      await expectCode(
        bootstrap('nobody-here@polilingo.test'),
        'PL404_NOT_FOUND',
      );
      const noProfile = await user(client, { ageBand: null });
      await expectCode(bootstrap(noProfile.email), 'PL403_NO_PROFILE');
      const teen = await user(client, { ageBand: '13-17' });
      await expectCode(bootstrap(teen.email), 'PL403_UNDER_18');

      const first = await user(client);
      const contributorId = await bootstrap(first.email.toUpperCase());
      assert.match(contributorId, /^ctr-\d{4}$/);
      assert.equal(
        await value(
          client,
          `select count(*)::int from public.role_grants where contributor_id = $1 and role = 'admin' and ends_at is null`,
          [contributorId],
        ),
        1,
      );
      assert.equal(
        await value(
          client,
          `select actor_kind from public.audit_events where action = 'admin.bootstrap' and target_id = $1`,
          [contributorId],
        ),
        'bootstrap',
      );
      await as(client, first);
      assert.equal(await value(client, 'select private.is_admin()'), true);
      await expectCode(
        client.query('select private.bootstrap_first_admin($1)', [first.email]),
        '42501',
      );
      await asPostgres(client);

      const second = await user(client);
      await expectCode(bootstrap(second.email), 'PL409_ADMIN_EXISTS');
    }));

  test('my_context has the documented shape', () =>
    tx(async (client) => {
      await asPostgres(client);
      await client.query("select set_config('request.jwt.claims', '', true)");
      await expectCode(
        client.query('select public.my_context()'),
        'PL401_NOT_SIGNED_IN',
      );

      const keys = [
        'contributor',
        'editor_languages',
        'email',
        'is_admin',
        'profile',
        'review_varieties',
        'sole_reviewer_varieties',
        'user_id',
      ];

      const learner = await user(client);
      await as(client, learner);
      const plain = await value(client, 'select public.my_context()');
      assert.deepEqual(Object.keys(plain).sort(), keys);
      assert.deepEqual(plain, {
        user_id: learner.id,
        email: learner.email,
        profile: { age_band: '18+' },
        contributor: null,
        is_admin: false,
        editor_languages: [],
        review_varieties: [],
        sole_reviewer_varieties: [],
      });

      await asPostgres(client);
      const newcomer = await user(client, { ageBand: null });
      await as(client, newcomer);
      assert.equal(
        (await value(client, 'select public.my_context()')).profile,
        null,
      );

      await asPostgres(client);
      await seedLesson(client, {
        variety: 'ps-var-solotest',
        items: 2,
        exercises: 1,
      });
      const reviewer = await user(client);
      const { contributorId } = await grant(
        client,
        reviewer,
        'language_reviewer',
        { variety: 'ps-var-solotest' },
      );
      await grant(client, reviewer, 'language_reviewer', {
        variety: 'ps-var-yusufzai',
      });
      const peer = await user(client);
      await grant(client, peer, 'language_reviewer', {
        variety: 'ps-var-yusufzai',
      });
      await as(client, reviewer);
      const ctx = await value(client, 'select public.my_context()');
      assert.deepEqual(ctx.contributor, {
        id: contributorId,
        display_name: reviewer.email.split('@')[0].slice(0, 60),
      });
      assert.equal(ctx.is_admin, false);
      assert.deepEqual(ctx.editor_languages, []);
      assert.deepEqual(
        ctx.review_varieties.map((v) => [v.id, v.language, typeof v.name]),
        [
          ['ps-var-solotest', 'ps', 'string'],
          ['ps-var-yusufzai', 'ps', 'string'],
        ],
      );
      assert.deepEqual(ctx.sole_reviewer_varieties, ['ps-var-solotest']);

      await asPostgres(client);
      const editor = await user(client);
      await grant(client, editor, 'editor', { language: 'ps' });
      await as(client, editor);
      assert.deepEqual(
        (await value(client, 'select public.my_context()')).editor_languages,
        ['ps'],
      );

      await asPostgres(client);
      const admin = await user(client);
      await grant(client, admin, 'admin');
      await as(client, admin);
      const adminCtx = await value(client, 'select public.my_context()');
      assert.equal(adminCtx.is_admin, true);
      assert.equal(adminCtx.editor_languages, 'all');
    }));

  test('the seeded local accounts can sign in with an email code', () =>
    tx(async (client) => {
      const seeded = await rows(
        client,
        `select u.email, u.instance_id, u.aud, u.role, u.email_confirmed_at is not null as confirmed,
                u.confirmation_token, u.recovery_token, u.email_change_token_new, u.email_change,
                i.provider, i.provider_id = u.id::text as identity_matches, p.age_band
         from auth.users u
         left join auth.identities i on i.user_id = u.id
         left join public.profiles p on p.user_id = u.id
         where u.email like '%@polilingo.test' and u.id::text like '00000000-0000-4000-8000-%'
         order by u.email`,
      );
      if (seeded.length === 0) {
        console.log(
          '# seeds/10_people.sql not applied in this database; skipped',
        );
        return;
      }
      assert.equal(seeded.length, 8);
      for (const s of seeded) {
        assert.equal(s.instance_id, '00000000-0000-0000-0000-000000000000');
        assert.equal(s.aud, 'authenticated');
        assert.equal(s.role, 'authenticated');
        assert.equal(s.confirmed, true);
        for (const k of [
          'confirmation_token',
          'recovery_token',
          'email_change_token_new',
          'email_change',
        ]) {
          assert.equal(s[k], '', `${s.email}: ${k} is ''`);
        }
        assert.equal(s.provider, 'email');
        assert.equal(s.identity_matches, true);
        assert.equal(
          s.age_band,
          s.email === 'teen@polilingo.test' ? '13-17' : '18+',
        );
      }
      const grants = await rows(
        client,
        `select g.contributor_id, g.role, g.variety_id from public.role_grants g
         where g.contributor_id between 'ctr-0101' and 'ctr-0105' order by 1`,
      );
      assert.deepEqual(
        grants.map((g) => [g.contributor_id, g.role, g.variety_id]),
        [
          ['ctr-0101', 'admin', null],
          ['ctr-0102', 'editor', null],
          ['ctr-0103', 'language_reviewer', 'ps-var-yusufzai'],
          ['ctr-0104', 'language_reviewer', 'ps-var-yusufzai'],
          ['ctr-0105', 'language_reviewer', 'hno-var-hazara'],
        ],
      );
    }));
});
