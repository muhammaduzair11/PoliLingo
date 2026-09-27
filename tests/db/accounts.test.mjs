// Track A: accounts (docs/platform.md §3.9 A). Needs a database with the
// migrations applied: `npm run test:db` (local stack, under the lock) or
// `npm run test:db:ci`. Every test runs in a rolled-back transaction, and
// every refusal a function can raise is called directly.

import assert from 'node:assert/strict';
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

/** As postgres with no JWT: auth.uid() is null. */
async function asNobody(client) {
  await asPostgres(client);
  await client.query("select set_config('request.jwt.claims', '', true)");
}

async function count(client, sql, params) {
  return Number(await value(client, sql, params));
}

/** Fills every per-user progress table for a user (as postgres). */
async function fillProgress(client, u, lesson) {
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
     values ($1, $2, 15, $3, 'lesson'), ($1, $4, 5, null, 'session')`,
    [u.id, `lesson:${lesson}`, lesson, `session:${u.id}`],
  );
  await client.query(
    `insert into public.progress_devices (user_id, device_id, reported_xp) values ($1, $2, 20)`,
    [u.id, `device-${u.id}`],
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

const PROGRESS_TABLES = [
  'profiles',
  'progress_completions',
  'progress_activity',
  'xp_awards',
  'progress_devices',
  'learner_prefs',
  'progress_imports',
];

async function rowsFor(client, u) {
  const out = {};
  for (const t of PROGRESS_TABLES)
    out[t] = await count(
      client,
      `select count(*) from public.${t} where user_id = $1`,
      [u.id],
    );
  return out;
}

/** Ends every admin grant but those of `keep` (the seeded admin, say). */
async function endOtherAdmins(client) {
  await asPostgres(client);
  await client.query(
    `update public.role_grants set ends_at = now()
     where role = 'admin' and (ends_at is null or ends_at > now())`,
  );
}

/** A decision, a suggestion and a comment written by a reviewer (as postgres). */
async function reviewHistory(client, contributorId) {
  const lesson = await seedLesson(client, { variety: 'ps-var-yusufzai' });
  await asPostgres(client);
  const decisionId = await value(
    client,
    `insert into content.review_decisions (target_type, item_id, variety_id, decision, reviewer_contributor_id, seen_fingerprint, comment)
     select 'item', i.id, i.variety_id, 'request_changes', $2, i.review_fingerprint, 'Check the vowel.'
     from content.items i where i.id = $1 returning id`,
    [lesson.itemIds[0], contributorId],
  );
  const suggestionId = await value(
    client,
    `insert into content.suggestions (item_id, variety_id, suggester_contributor_id, base_review_fingerprint, proposed)
     select i.id, i.variety_id, $2, i.review_fingerprint, '{"meaning":"Hello there"}'
     from content.items i where i.id = $1 returning id`,
    [lesson.itemIds[1], contributorId],
  );
  const commentId = await value(
    client,
    `insert into content.review_comments (target_type, target_id, variety_id, author_contributor_id, body)
     values ('item', $1, 'ps-var-yusufzai', $2, 'A note from the reviewer.') returning id`,
    [lesson.itemIds[0], contributorId],
  );
  return { lesson, decisionId, suggestionId, commentId };
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

describe('account function grants', () => {
  test('authenticated may call the four account functions; anon none; nobody the purge', () =>
    tx(async (client) => {
      const fns = [
        'public.ensure_profile(text)',
        'public.set_age_band(text)',
        'public.delete_my_account()',
        'public.export_my_data()',
      ];
      for (const fn of fns) {
        assert.equal(
          await value(
            client,
            `select has_function_privilege('authenticated', $1, 'execute')`,
            [fn],
          ),
          true,
          `${fn} for authenticated`,
        );
        assert.equal(
          await value(
            client,
            `select has_function_privilege('anon', $1, 'execute')`,
            [fn],
          ),
          false,
          `${fn} not for anon`,
        );
      }
      for (const role of ['anon', 'authenticated'])
        assert.equal(
          await value(
            client,
            `select has_function_privilege($1, 'private.purge_profileless_users()', 'execute')`,
            [role],
          ),
          false,
        );
      await asAnon(client);
      await expectCode(
        client.query(`select public.ensure_profile('18+')`),
        '42501',
      );
      await expectCode(
        client.query('select public.delete_my_account()'),
        '42501',
      );
      const learner = await (async () => {
        await asPostgres(client);
        return user(client);
      })();
      await as(client, learner);
      await expectCode(
        client.query('select private.purge_profileless_users()'),
        '42501',
      );
    }));
});

// ---------------------------------------------------------------------------
// ensure_profile
// ---------------------------------------------------------------------------

describe('ensure_profile', () => {
  test('refuses without a session, and a band that is not one of the two', () =>
    tx(async (client) => {
      await asNobody(client);
      await expectCode(
        client.query(`select public.ensure_profile('18+')`),
        'PL401_NOT_SIGNED_IN',
      );
      const newcomer = await user(client, { ageBand: null });
      await as(client, newcomer);
      for (const bad of [null, '', '12', 'under-13', '18', '18 +', '13-17 '])
        await expectCode(
          client.query('select public.ensure_profile($1)', [bad]),
          'PL422_BAD_AGE_BAND',
        );
      await asPostgres(client);
      assert.equal(
        await count(
          client,
          'select count(*) from public.profiles where user_id = $1',
          [newcomer.id],
        ),
        0,
      );
    }));

  test('creates the profile once; an existing profile comes back unchanged', () =>
    tx(async (client) => {
      const newcomer = await user(client, { ageBand: null });
      await as(client, newcomer);
      const first = await value(
        client,
        `select public.ensure_profile('13-17')`,
      );
      assert.equal(first.age_band, '13-17');
      assert.equal(first.created, true);
      const again = await value(client, `select public.ensure_profile('18+')`);
      assert.equal(again.age_band, '13-17');
      assert.equal(again.created, false);
      assert.equal(again.created_at, first.created_at);
      assert.deepEqual(
        (await value(client, 'select public.my_context()')).profile,
        { age_band: '13-17' },
      );
    }));
});

// ---------------------------------------------------------------------------
// set_age_band
// ---------------------------------------------------------------------------

describe('set_age_band', () => {
  test('refuses without a session, without a profile, and a bad band', () =>
    tx(async (client) => {
      await asNobody(client);
      await expectCode(
        client.query(`select public.set_age_band('18+')`),
        'PL401_NOT_SIGNED_IN',
      );
      const newcomer = await user(client, { ageBand: null });
      await as(client, newcomer);
      await expectCode(
        client.query(`select public.set_age_band('18+')`),
        'PL403_NO_PROFILE',
      );
      // The profile check comes first, even for a bad band.
      await expectCode(
        client.query(`select public.set_age_band('7')`),
        'PL403_NO_PROFILE',
      );
      await asPostgres(client);
      const learner = await user(client);
      await as(client, learner);
      for (const bad of [null, 'adult', '13-18'])
        await expectCode(
          client.query('select public.set_age_band($1)', [bad]),
          'PL422_BAD_AGE_BAND',
        );
    }));

  test('a learner changes their band either way', () =>
    tx(async (client) => {
      const learner = await user(client, { ageBand: '13-17' });
      await as(client, learner);
      assert.deepEqual(
        await value(client, `select public.set_age_band('18+')`),
        {
          age_band: '18+',
          changed: true,
        },
      );
      assert.deepEqual(
        await value(client, `select public.set_age_band('18+')`),
        {
          age_band: '18+',
          changed: false,
        },
      );
      assert.deepEqual(
        await value(client, `select public.set_age_band('13-17')`),
        { age_band: '13-17', changed: true },
      );
    }));

  test('a team member cannot declare 13-17; once their role ends they can', () =>
    tx(async (client) => {
      const reviewer = await user(client);
      const { grantId } = await grant(client, reviewer, 'language_reviewer', {
        variety: 'ps-var-yusufzai',
      });
      await as(client, reviewer);
      await expectCode(
        client.query(`select public.set_age_band('13-17')`),
        'PL409_STAFF_AGE',
      );
      assert.equal(
        (await value(client, `select public.set_age_band('18+')`)).changed,
        false,
      );
      await asPostgres(client);
      await client.query(
        'update public.role_grants set ends_at = now() where id = $1',
        [grantId],
      );
      await as(client, reviewer);
      assert.equal(
        (await value(client, `select public.set_age_band('13-17')`)).age_band,
        '13-17',
      );
    }));
});

// ---------------------------------------------------------------------------
// delete_my_account
// ---------------------------------------------------------------------------

describe('delete_my_account', () => {
  test('refuses without a session', () =>
    tx(async (client) => {
      await asNobody(client);
      await expectCode(
        client.query('select public.delete_my_account()'),
        'PL401_NOT_SIGNED_IN',
      );
    }));

  test("a learner's sign-in, profile and progress all go; nobody else's", () =>
    tx(async (client) => {
      const learner = await user(client);
      const other = await user(client);
      await fillProgress(client, learner, 'ps-lsn-aaaaaa');
      await fillProgress(client, other, 'ps-lsn-bbbbbb');
      const before = await rowsFor(client, learner);
      assert.ok(Object.values(before).every((n) => n > 0));
      const auditBefore = await count(
        client,
        `select count(*) from public.audit_events where action = 'account.deleted'`,
      );

      await as(client, learner);
      const result = await value(client, 'select public.delete_my_account()');
      assert.equal(result.deleted, true);
      assert.equal(
        await value(
          client,
          "select coalesce(current_setting('polilingo.account_deletion', true), '')",
        ),
        '',
        'the deletion setting does not outlive the call',
      );

      await asPostgres(client);
      assert.equal(
        await count(client, 'select count(*) from auth.users where id = $1', [
          learner.id,
        ]),
        0,
      );
      assert.deepEqual(
        Object.values(await rowsFor(client, learner)),
        PROGRESS_TABLES.map(() => 0),
      );
      assert.deepEqual(
        await rowsFor(client, other),
        before,
        "another learner's rows are untouched",
      );
      const audit = await one(
        client,
        `select actor_contributor_id, actor_kind, target_type, target_id, detail
         from public.audit_events where action = 'account.deleted' order by id desc limit 1`,
      );
      assert.equal(
        await count(
          client,
          `select count(*) from public.audit_events where action = 'account.deleted'`,
        ),
        auditBefore + 1,
      );
      assert.deepEqual(audit, {
        actor_contributor_id: null,
        actor_kind: 'system',
        target_type: 'account',
        target_id: null,
        detail: null,
      });
    }));

  test("a team member's decisions stay under their ctr id; the person goes", () =>
    tx(async (client) => {
      const reviewer = await user(client);
      const { contributorId, grantId } = await grant(
        client,
        reviewer,
        'language_reviewer',
        { variety: 'ps-var-yusufzai' },
      );
      const { grantId: editorGrant } = await grant(client, reviewer, 'editor', {
        language: 'ps',
      });
      // A grant that starts next week ends too.
      const future = await value(
        client,
        `insert into public.role_grants (contributor_id, role, language_code, starts_at)
         values ($1, 'editor', 'ps', now() + interval '7 days') returning id`,
        [contributorId],
      );
      // One that has already ended keeps its end.
      await client.query(
        `insert into public.role_grants (contributor_id, role, language_code, starts_at, ends_at)
         values ($1, 'editor', 'ps', now() - interval '2 days', now() - interval '1 day')`,
        [contributorId],
      );
      await client.query(
        `insert into public.contributor_private (contributor_id, legal_name, contact_email, phone)
         values ($1, 'Test Person', $2, '+920000000000')`,
        [contributorId, reviewer.email],
      );
      await fillProgress(client, reviewer, 'ps-lsn-cccccc');
      const history = await reviewHistory(client, contributorId);

      await as(client, reviewer);
      assert.equal(await value(client, 'select private.is_staff()'), true);
      const result = await value(client, 'select public.delete_my_account()');
      assert.equal(result.deleted, true);
      assert.equal(result.grants_ended, 3);

      await asPostgres(client);
      assert.equal(
        await count(client, 'select count(*) from auth.users where id = $1', [
          reviewer.id,
        ]),
        0,
      );
      assert.deepEqual(
        await one(
          client,
          'select user_id, status from public.contributors where id = $1',
          [contributorId],
        ),
        { user_id: null, status: 'ended' },
      );
      assert.equal(
        await count(
          client,
          'select count(*) from public.contributor_private where contributor_id = $1',
          [contributorId],
        ),
        0,
      );
      const open = await count(
        client,
        `select count(*) from public.role_grants
         where contributor_id = $1
           and (ends_at is null or ends_at > greatest(now(), starts_at + interval '1 second'))`,
        [contributorId],
      );
      assert.equal(open, 0, 'no grant is left running');
      const reasons = await client.query(
        `select id, revoke_reason, revoked_by from public.role_grants where contributor_id = $1 order by starts_at`,
        [contributorId],
      );
      for (const g of reasons.rows)
        if ([grantId, editorGrant, future].includes(g.id))
          assert.deepEqual(
            [g.revoke_reason, g.revoked_by],
            ['Account deleted', contributorId],
          );
      assert.equal(reasons.rows.length, 4, 'grants are never deleted');

      // The review history stays, attributed to the ctr id.
      assert.equal(
        await value(
          client,
          'select reviewer_contributor_id from content.review_decisions where id = $1',
          [history.decisionId],
        ),
        contributorId,
      );
      assert.equal(
        await value(
          client,
          'select suggester_contributor_id from content.suggestions where id = $1',
          [history.suggestionId],
        ),
        contributorId,
      );
      assert.equal(
        await value(
          client,
          'select author_contributor_id from content.review_comments where id = $1',
          [history.commentId],
        ),
        contributorId,
      );

      const audit = await one(
        client,
        `select actor_contributor_id, actor_kind, target_type, target_id, detail
         from public.audit_events where action = 'account.deleted' and target_id = $1`,
        [contributorId],
      );
      assert.equal(audit.actor_contributor_id, contributorId);
      assert.equal(audit.actor_kind, 'contributor');
      assert.equal(audit.target_type, 'contributor');
      const text = JSON.stringify(audit);
      assert.ok(!text.includes(reviewer.id), 'no user id in the audit');
      assert.ok(!text.includes(reviewer.email), 'no email in the audit');
      assert.deepEqual(
        Object.values(await rowsFor(client, reviewer)),
        [0, 0, 0, 0, 0, 0, 0],
      );
    }));

  test('the last admin is refused; with another admin they can go', () =>
    tx(async (client) => {
      await endOtherAdmins(client);
      const admin = await user(client);
      const { contributorId } = await grant(client, admin, 'admin');
      await as(client, admin);
      await expectCode(
        client.query('select public.delete_my_account()'),
        'PL409_LAST_ADMIN',
      );

      // An admin who is paused, or under 18, does not count as another.
      await asPostgres(client);
      const paused = await user(client);
      const { contributorId: pausedCtr } = await grant(client, paused, 'admin');
      await client.query(
        `update public.contributors set status = 'paused' where id = $1`,
        [pausedCtr],
      );
      await as(client, admin);
      await expectCode(
        client.query('select public.delete_my_account()'),
        'PL409_LAST_ADMIN',
      );
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          'select user_id from public.contributors where id = $1',
          [contributorId],
        ),
        admin.id,
        'nothing changed on a refusal',
      );

      const second = await user(client);
      await grant(client, second, 'admin');
      await as(client, admin);
      assert.equal(
        (await value(client, 'select public.delete_my_account()')).deleted,
        true,
      );
      await as(client, second);
      assert.equal(await value(client, 'select private.is_admin()'), true);
      await expectCode(
        client.query('select public.delete_my_account()'),
        'PL409_LAST_ADMIN',
      );
    }));
});

/** An invitation row, inserted as postgres; returns its id. */
async function invite(
  client,
  createdBy,
  email,
  { role = 'editor', language = 'ps', ageDays = 0, expiresInDays = 7 } = {},
) {
  await asPostgres(client);
  return value(
    client,
    `insert into public.invitations (token_hash, role, language_code, email, display_name, note,
       created_by, created_at, expires_at)
     values (decode(md5(random()::text) || md5(random()::text), 'hex'), $1, $2, $3,
       'Invited Person', 'Met at the workshop.', $4,
       now() - make_interval(days => $5), now() - make_interval(days => $5) + make_interval(days => $6))
     returning id`,
    [
      role,
      role === 'admin' ? null : language,
      email,
      createdBy,
      ageDays,
      expiresInDays,
    ],
  );
}

describe('delete_my_account and invitations', () => {
  test('the email address leaves every invitation that is over; an open one stays', () =>
    tx(async (client) => {
      const admin = await user(client);
      const { contributorId: adminCtr } = await grant(client, admin, 'admin');
      const editor = await user(client);
      const { contributorId: editorCtr, grantId } = await grant(
        client,
        editor,
        'editor',
        { language: 'ps' },
      );
      const accepted = await invite(client, adminCtr, editor.email);
      await client.query(
        `update public.invitations
         set accepted_at = now(), accepted_by_user = $2, accepted_contributor_id = $3, grant_id = $4
         where id = $1`,
        [accepted, editor.id, editorCtr, grantId],
      );
      const expired = await invite(client, adminCtr, editor.email, {
        ageDays: 10,
        expiresInDays: 3,
      });
      const revoked = await invite(client, adminCtr, editor.email);
      await client.query(
        `update public.invitations set revoked_at = now(), revoked_by = $2 where id = $1`,
        [revoked, adminCtr],
      );
      const open = await invite(client, adminCtr, editor.email);
      const someoneElse = await invite(
        client,
        adminCtr,
        'someone.else@example.com',
      );

      await as(client, editor);
      assert.equal(
        (await value(client, 'select public.delete_my_account()')).deleted,
        true,
      );

      await asPostgres(client);
      const rows = await client.query(
        `select id, email, display_name, note, role, accepted_contributor_id
         from public.invitations where id = any($1::uuid[])`,
        [[accepted, expired, revoked, open, someoneElse]],
      );
      const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
      for (const id of [accepted, expired, revoked]) {
        const row = byId[id];
        assert.equal(
          row.email,
          `removed-${id.replaceAll('-', '')}@deleted.invalid`,
        );
        assert.equal(row.display_name, null);
        assert.equal(row.note, null);
        assert.equal(row.role, 'editor', 'the role and dates stay');
      }
      assert.equal(byId[accepted].accepted_contributor_id, editorCtr);
      assert.equal(
        byId[open].email,
        editor.email,
        'an open invitation is an admin’s offer and stays',
      );
      assert.equal(byId[someoneElse].email, 'someone.else@example.com');
      assert.equal(
        await count(
          client,
          `select count(*) from public.invitations
           where email = $1 and (accepted_at is not null or revoked_at is not null or expires_at <= now())`,
          [editor.email],
        ),
        0,
        'no finished invitation still holds the address',
      );
      assert.equal(
        await count(
          client,
          `select count(*) from public.invitations where accepted_contributor_id = $1 and email not like 'removed-%'`,
          [editorCtr],
        ),
        0,
        'the ctr id is no longer linked to an address',
      );
    }));

  test("a departing admin's open invitations are revoked, and counted", () =>
    tx(async (client) => {
      const admin = await user(client);
      const { contributorId: adminCtr } = await grant(client, admin, 'admin');
      const other = await user(client);
      const { contributorId: otherCtr } = await grant(client, other, 'admin');
      const openAdmin = await invite(
        client,
        adminCtr,
        'next.admin@example.com',
        {
          role: 'admin',
        },
      );
      const openEditor = await invite(
        client,
        adminCtr,
        'editor.to.be@example.com',
      );
      const expired = await invite(client, adminCtr, 'late@example.com', {
        ageDays: 10,
        expiresInDays: 3,
      });
      const byOther = await invite(client, otherCtr, 'kept@example.com');

      await as(client, admin);
      const result = await value(client, 'select public.delete_my_account()');
      assert.equal(result.invitations_revoked, 2);

      await asPostgres(client);
      const rows = await client.query(
        `select id, revoked_at is not null as revoked, revoked_by
         from public.invitations where id = any($1::uuid[])`,
        [[openAdmin, openEditor, expired, byOther]],
      );
      const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
      assert.deepEqual(
        [byId[openAdmin].revoked, byId[openAdmin].revoked_by],
        [true, adminCtr],
      );
      assert.deepEqual(
        [byId[openEditor].revoked, byId[openEditor].revoked_by],
        [true, adminCtr],
      );
      assert.equal(
        byId[expired].revoked,
        false,
        'an expired one is left as it was',
      );
      assert.equal(byId[byOther].revoked, false, "another admin's stays open");
      assert.equal(
        await count(
          client,
          `select count(*) from public.invitations
           where created_by = $1 and revoked_at is null and accepted_at is null and expires_at > now()`,
          [adminCtr],
        ),
        0,
      );
      const audit = await one(
        client,
        `select detail from public.audit_events where action = 'account.deleted' and target_id = $1`,
        [adminCtr],
      );
      assert.deepEqual(audit.detail, {
        grants_ended: 1,
        invitations_revoked: 2,
      });
    }));

  test('a display name made from the email becomes the contributor number; a chosen one stays', () =>
    tx(async (client) => {
      const derived = await user(client, {
        email: 'Real.Person@Example.com',
      });
      const { contributorId: derivedCtr } = await grant(
        client,
        derived,
        'editor',
        { language: 'ps' },
      );
      const chosen = await user(client);
      const { contributorId: chosenCtr } = await grant(
        client,
        chosen,
        'editor',
        {
          language: 'ps',
        },
      );
      await client.query(
        `update public.contributors set display_name = 'Aisha K.' where id = $1`,
        [chosenCtr],
      );

      for (const person of [derived, chosen]) {
        await as(client, person);
        await value(client, 'select public.delete_my_account()');
      }

      await asPostgres(client);
      assert.equal(
        await value(
          client,
          'select display_name from public.contributors where id = $1',
          [derivedCtr],
        ),
        `Former team member (${derivedCtr})`,
      );
      assert.equal(
        await value(
          client,
          'select display_name from public.contributors where id = $1',
          [chosenCtr],
        ),
        'Aisha K.',
      );
    }));
});

// ---------------------------------------------------------------------------
// export_my_data
// ---------------------------------------------------------------------------

describe('export_my_data', () => {
  test('refuses without a session', () =>
    tx(async (client) => {
      await asNobody(client);
      await expectCode(
        client.query('select public.export_my_data()'),
        'PL401_NOT_SIGNED_IN',
      );
    }));

  test("holds the caller's own data and nobody else's", () =>
    tx(async (client) => {
      const me = await user(client);
      const other = await user(client);
      await fillProgress(client, me, 'ps-lsn-aaaaaa');
      await fillProgress(client, other, 'ps-lsn-bbbbbb');
      const { contributorId: otherCtr } = await grant(
        client,
        other,
        'language_reviewer',
        { variety: 'ps-var-yusufzai' },
      );
      await reviewHistory(client, otherCtr);
      // What Google shares, and the two ways this account signs in.
      await asPostgres(client);
      await client.query(
        `update auth.users set raw_user_meta_data = '{"full_name":"Test Person","avatar_url":"https://example.com/p.png"}'
         where id = $1`,
        [me.id],
      );
      await client.query(
        `insert into auth.identities (user_id, provider_id, provider, identity_data, created_at, last_sign_in_at)
         values ($1::text::uuid, $1::text, 'email', jsonb_build_object('sub', $1::text, 'email', $2::text), now(), now()),
                ($1::text::uuid, 'google-' || $1::text, 'google', jsonb_build_object('sub', 'g', 'email', $2::text), now(), now()),
                ($3::text::uuid, $3::text, 'email', jsonb_build_object('sub', $3::text, 'email', $4::text), now(), now())`,
        [me.id, me.email, other.id, other.email],
      );

      await as(client, me);
      const data = await value(client, 'select public.export_my_data()');
      assert.equal(data.format, 'polilingo.account-export@1');
      assert.equal(data.account.email, me.email);
      assert.deepEqual(data.account.metadata, {
        full_name: 'Test Person',
        avatar_url: 'https://example.com/p.png',
      });
      assert.deepEqual(
        data.account.sign_in_methods.map((m) => m.provider),
        ['email', 'google'],
      );
      assert.ok(data.account.sign_in_methods.every((m) => m.created_at));
      assert.deepEqual(data.profile.age_band, '18+');
      assert.deepEqual(
        data.progress.completions.map((c) => [c.lesson_id, c.first_release]),
        [['ps-lsn-aaaaaa', 'mvp']],
      );
      assert.deepEqual(data.progress.activity, [
        { local_date: '2026-09-27', count: 2 },
      ]);
      assert.equal(data.progress.xp_awards.length, 2);
      assert.equal(data.progress.devices.length, 1);
      assert.equal(data.progress.prefs.selected_course, 'pashto');
      assert.equal(data.progress.imports.length, 1);
      assert.equal(data.contributor, null);
      assert.deepEqual(data.grants, []);
      assert.deepEqual(data.review, {
        decisions: [],
        countersignatures: [],
        suggestions: [],
        comments: [],
      });
      const text = JSON.stringify(data);
      for (const leak of [other.id, other.email, 'ps-lsn-bbbbbb', otherCtr])
        assert.ok(!text.includes(leak), `${leak} is not in my export`);
    }));

  test("a team member's export has their contributor record, grants and review history", () =>
    tx(async (client) => {
      const reviewer = await user(client);
      const { contributorId, grantId } = await grant(
        client,
        reviewer,
        'language_reviewer',
        { variety: 'ps-var-yusufzai' },
      );
      await client.query(
        `insert into public.contributor_private (contributor_id, legal_name, region)
         values ($1, 'Test Person', 'Peshawar')`,
        [contributorId],
      );
      const history = await reviewHistory(client, contributorId);
      const peer = await user(client);
      const { contributorId: peerCtr } = await grant(
        client,
        peer,
        'language_reviewer',
        { variety: 'ps-var-yusufzai' },
      );
      const peerHistory = await reviewHistory(client, peerCtr);

      await as(client, reviewer);
      const data = await value(client, 'select public.export_my_data()');
      assert.equal(data.contributor.id, contributorId);
      assert.equal(data.contributor.private.legal_name, 'Test Person');
      assert.deepEqual(
        data.grants.map((g) => [g.id, g.role, g.variety]),
        [[grantId, 'language_reviewer', 'ps-var-yusufzai']],
      );
      assert.deepEqual(
        data.review.decisions.map((d) => d.id),
        [history.decisionId],
      );
      assert.deepEqual(
        data.review.suggestions.map((s) => s.id),
        [history.suggestionId],
      );
      assert.deepEqual(
        data.review.comments.map((c) => c.id),
        [history.commentId],
      );
      const text = JSON.stringify(data);
      for (const leak of [
        peerCtr,
        peer.email,
        peerHistory.decisionId,
        peerHistory.suggestionId,
        peerHistory.commentId,
      ])
        assert.ok(!text.includes(leak), `${leak} is not in my export`);
    }));
});

// ---------------------------------------------------------------------------
// private.purge_profileless_users
// ---------------------------------------------------------------------------

describe('purge_profileless_users', () => {
  test('deletes only sign-ins older than a day with no profile and no contributor', () =>
    tx(async (client) => {
      const age = async (u, interval) =>
        client.query(
          `update auth.users set created_at = now() - $2::interval where id = $1`,
          [u.id, interval],
        );
      const stale = await user(client, { ageBand: null });
      await age(stale, '25 hours');
      const staleWithLedger = await user(client, { ageBand: null });
      await age(staleWithLedger, '3 days');
      await client.query(
        `insert into public.xp_awards (user_id, award_key, amount, source) values ($1, 'session:x', 5, 'session')`,
        [staleWithLedger.id],
      );
      const fresh = await user(client, { ageBand: null });
      await age(fresh, '23 hours');
      const learner = await user(client);
      await age(learner, '30 days');
      const staff = await user(client, { ageBand: null });
      await age(staff, '30 days');
      await client.query(
        `insert into public.contributors (user_id, display_name) values ($1, 'Kept')`,
        [staff.id],
      );

      await asPostgres(client);
      await client.query("select set_config('request.jwt.claims', '', true)");
      const purged = await value(
        client,
        'select private.purge_profileless_users()',
      );
      assert.ok(purged >= 2);
      const left = async (u) =>
        count(client, 'select count(*) from auth.users where id = $1', [u.id]);
      assert.equal(await left(stale), 0);
      assert.equal(await left(staleWithLedger), 0);
      assert.equal(await left(fresh), 1);
      assert.equal(await left(learner), 1);
      assert.equal(await left(staff), 1);
      assert.equal(
        await value(
          client,
          "select coalesce(current_setting('polilingo.account_deletion', true), '')",
        ),
        '',
      );
    }));

  test('is scheduled daily when pg_cron is installed', () =>
    tx(async (client) => {
      const cron = await value(
        client,
        `select exists (select 1 from pg_extension where extname = 'pg_cron')`,
      );
      if (!cron) {
        console.log('# pg_cron is not installed here; nothing to check');
        return;
      }
      assert.equal(
        await value(
          client,
          `select schedule from cron.job where jobname = 'polilingo-purge-profileless-users'`,
        ),
        '17 3 * * *',
      );
    }));
});
