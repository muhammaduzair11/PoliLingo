// Track C, people and overview (docs/platform.md §3.9 C): invitations,
// ending roles, editing contributors, and the people and overview pages.
// Every refusal each function can make is called directly here. Every test
// runs in a rolled-back transaction.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

// The seeded local accounts (supabase/seeds/10_people.sql).
const SEED = {
  admin: {
    id: '00000000-0000-4000-8000-000000000101',
    email: 'admin@polilingo.test',
    grant: '00000000-0000-4000-a000-000000000101',
  },
  editor: {
    id: '00000000-0000-4000-8000-000000000102',
    email: 'editor@polilingo.test',
  },
  reviewerPs: {
    id: '00000000-0000-4000-8000-000000000103',
    email: 'reviewer.ps@polilingo.test',
    grant: '00000000-0000-4000-a000-000000000103',
  },
  learner: {
    id: '00000000-0000-4000-8000-000000000201',
    email: 'learner@polilingo.test',
  },
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Signed in as the role `authenticated`, but with no user: auth.uid() is null. */
async function asNobody(client) {
  await client.query('set local role authenticated');
  await client.query(
    "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', '', true)",
    [JSON.stringify({ role: 'authenticated' })],
  );
}

async function rpc(client, fn, args = {}) {
  const names = Object.keys(args);
  const list = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
  const row = await one(
    client,
    `select public.${fn}(${list}) as r`,
    names.map((n) => args[n]),
  );
  return row.r;
}

/** An invitation made by the seeded admin; returns create_invitation's result. */
async function invite(client, args) {
  await as(client, SEED.admin);
  return rpc(client, 'create_invitation', {
    p_role: 'language_reviewer',
    p_variety: 'ps-var-yusufzai',
    ...args,
  });
}

describe('create_invitation', () => {
  test('returns a 43-character base64url token once and stores only its sha256', () =>
    tx(async (client) => {
      const r = await invite(client, {
        p_email: '  Amina.K@Example.org ',
        p_display_name: 'Amina',
        p_expires_in_days: 5,
      });
      assert.match(r.token, TOKEN);
      assert.equal(r.path, `/invite/${r.token}`);
      assert.ok(r.invitation_id);
      await asPostgres(client);
      const row = await one(
        client,
        `select i.*, encode(i.token_hash, 'hex') as hash_hex,
                i.expires_at - i.created_at as ttl
         from public.invitations i where i.id = $1`,
        [r.invitation_id],
      );
      assert.equal(
        row.hash_hex,
        createHash('sha256').update(r.token).digest('hex'),
      );
      assert.equal(row.email, 'amina.k@example.org');
      assert.equal(row.language_code, 'ps');
      assert.equal(row.variety_id, 'ps-var-yusufzai');
      assert.equal(row.created_by, 'ctr-0101');
      assert.equal(row.display_name, 'Amina');
      // The raw token appears nowhere: not in the invitation, not in the audit log.
      const leaks = await value(
        client,
        `select count(*)::int from (
           select to_jsonb(i)::text as t from public.invitations i
           union all select to_jsonb(a)::text from public.audit_events a
         ) x where position($1 in x.t) > 0`,
        [r.token],
      );
      assert.equal(leaks, 0);
      const audit = await one(
        client,
        `select * from public.audit_events where action = 'invitation.created' and target_id = $1`,
        [r.invitation_id],
      );
      assert.equal(audit.actor_contributor_id, 'ctr-0101');
      assert.equal(audit.detail.email_masked, 'a•••@example.org');
    }));

  test('two invitations never share a token', () =>
    tx(async (client) => {
      const a = await invite(client, { p_email: 'a@example.org' });
      const b = await invite(client, { p_email: 'a@example.org' });
      assert.notEqual(a.token, b.token);
    }));

  test('an editor may be scoped to a language or to all; an admin to nothing', () =>
    tx(async (client) => {
      await as(client, SEED.admin);
      const editorAll = await rpc(client, 'create_invitation', {
        p_role: 'editor',
        p_email: 'e1@example.org',
      });
      const editorPs = await rpc(client, 'create_invitation', {
        p_role: 'editor',
        p_email: 'e2@example.org',
        p_language: 'ps',
      });
      const admin = await rpc(client, 'create_invitation', {
        p_role: 'admin',
        p_email: 'a@example.org',
      });
      await asPostgres(client);
      const rows = await client.query(
        `select id::text, role, language_code, variety_id from public.invitations where id = any ($1::uuid[])`,
        [
          [
            editorAll.invitation_id,
            editorPs.invitation_id,
            admin.invitation_id,
          ],
        ],
      );
      const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
      assert.equal(byId[editorAll.invitation_id].language_code, null);
      assert.equal(byId[editorPs.invitation_id].language_code, 'ps');
      assert.equal(byId[admin.invitation_id].language_code, null);
    }));

  test('refusals: 401, 403 not admin, 422 scope, email, expiry, date, length', () =>
    tx(async (client) => {
      const call = (args) =>
        rpc(client, 'create_invitation', {
          p_role: 'language_reviewer',
          p_email: 'x@example.org',
          p_variety: 'ps-var-yusufzai',
          ...args,
        });

      await asNobody(client);
      await expectCode(call({}), 'PL401_NOT_SIGNED_IN');

      for (const who of [SEED.editor, SEED.reviewerPs, SEED.learner]) {
        await as(client, who);
        await expectCode(call({}), 'PL403_NOT_ADMIN');
      }

      await as(client, SEED.admin);
      await expectCode(call({ p_role: 'owner' }), 'PL422_BAD_SCOPE');
      await expectCode(
        call({ p_role: 'admin', p_variety: null, p_language: 'ps' }),
        'PL422_BAD_SCOPE',
      );
      await expectCode(call({ p_role: 'editor' }), 'PL422_BAD_SCOPE');
      await expectCode(call({ p_variety: null }), 'PL422_BAD_SCOPE');
      await expectCode(
        call({ p_variety: 'ps-var-nowhere' }),
        'PL422_BAD_SCOPE',
      );
      await expectCode(call({ p_language: 'hno' }), 'PL422_BAD_SCOPE');
      await expectCode(
        call({ p_role: 'editor', p_variety: null, p_language: 'zz' }),
        'PL422_BAD_SCOPE',
      );
      for (const email of ['', 'no-at-sign', 'a@b', 'two@@example.org', null])
        await expectCode(call({ p_email: email }), 'PL422_BAD_EMAIL');
      for (const days of [0, 31, -1, null])
        await expectCode(call({ p_expires_in_days: days }), 'PL422_BAD_EXPIRY');
      await expectCode(
        call({ p_grant_ends_at: new Date(Date.now() - 86_400_000) }),
        'PL422_BAD_DATE',
      );
      await expectCode(
        call({ p_display_name: 'x'.repeat(61) }),
        'PL422_LENGTH',
      );
      await expectCode(call({ p_note: 'x'.repeat(1001) }), 'PL422_LENGTH');
    }));

  test('anon cannot call it; authenticated can', () =>
    tx(async (client) => {
      const row = await one(
        client,
        `select has_function_privilege('anon', 'public.create_invitation(text,text,text,text,text,int,timestamptz,text)', 'execute') as anon,
                has_function_privilege('authenticated', 'public.create_invitation(text,text,text,text,text,int,timestamptz,text)', 'execute') as authed,
                has_function_privilege('authenticated', 'private.mask_email(text)', 'execute') as helper`,
      );
      assert.deepEqual(row, { anon: false, authed: true, helper: false });
    }));
});

describe('revoke_invitation', () => {
  test('cancels an open invitation once, and the link stops working', () =>
    tx(async (client) => {
      const inv = await invite(client, { p_email: 'r@example.org' });
      const first = await rpc(client, 'revoke_invitation', {
        p_invitation_id: inv.invitation_id,
      });
      assert.ok(first.revoked_at);
      const again = await rpc(client, 'revoke_invitation', {
        p_invitation_id: inv.invitation_id,
      });
      assert.equal(again.revoked_at, first.revoked_at);
      const invitee = await user(client, { email: 'r@example.org' });
      await as(client, invitee);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: inv.token }),
        'PL410_INVITATION_REVOKED',
      );
      const peek = await rpc(client, 'peek_invitation', { p_token: inv.token });
      assert.equal(peek.status, 'revoked');
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          `select count(*)::int from public.audit_events where action = 'invitation.revoked' and target_id = $1`,
          [inv.invitation_id],
        ),
        1,
      );
    }));

  test('refusals: 401, 403 not admin, 404, 410 used', () =>
    tx(async (client) => {
      const inv = await invite(client, { p_email: 'used@example.org' });
      await asNobody(client);
      await expectCode(
        rpc(client, 'revoke_invitation', {
          p_invitation_id: inv.invitation_id,
        }),
        'PL401_NOT_SIGNED_IN',
      );
      await as(client, SEED.editor);
      await expectCode(
        rpc(client, 'revoke_invitation', {
          p_invitation_id: inv.invitation_id,
        }),
        'PL403_NOT_ADMIN',
      );
      await as(client, SEED.admin);
      await expectCode(
        rpc(client, 'revoke_invitation', {
          p_invitation_id: '00000000-0000-4000-8000-00000000dead',
        }),
        'PL404_NOT_FOUND',
      );
      const invitee = await user(client, { email: 'used@example.org' });
      await as(client, invitee);
      await rpc(client, 'accept_invitation', { p_token: inv.token });
      await as(client, SEED.admin);
      await expectCode(
        rpc(client, 'revoke_invitation', {
          p_invitation_id: inv.invitation_id,
        }),
        'PL410_INVITATION_USED',
      );
    }));
});

describe('peek_invitation', () => {
  test('shows the scope, a masked email and the status, and changes nothing', () =>
    tx(async (client) => {
      const inv = await invite(client, {
        p_email: 'amina@example.org',
        p_display_name: 'Amina',
      });
      await asPostgres(client);
      const before = await one(
        client,
        'select to_jsonb(i) as j from public.invitations i where id = $1',
        [inv.invitation_id],
      );
      const audits = await value(
        client,
        'select count(*)::int from public.audit_events',
      );

      const someone = await user(client, { email: 'someone@example.org' });
      await as(client, someone);
      const peek = await rpc(client, 'peek_invitation', { p_token: inv.token });
      assert.equal(peek.role, 'language_reviewer');
      assert.equal(peek.language, 'ps');
      assert.equal(peek.language_name, 'Pashto');
      assert.equal(peek.variety, 'ps-var-yusufzai');
      assert.equal(peek.variety_name, 'Northern Pashto (Peshawar / Yusufzai)');
      assert.equal(peek.display_name, 'Amina');
      assert.equal(peek.email_masked, 'a•••@example.org');
      assert.equal(peek.email_matches, false);
      assert.equal(peek.accepted_by_you, false);
      assert.equal(peek.status, 'open');
      assert.ok(peek.expires_at);
      assert.equal(JSON.stringify(peek).includes('amina@'), false);

      await asPostgres(client);
      const after = await one(
        client,
        'select to_jsonb(i) as j from public.invitations i where id = $1',
        [inv.invitation_id],
      );
      assert.deepEqual(after.j, before.j);
      assert.equal(
        await value(client, 'select count(*)::int from public.audit_events'),
        audits,
      );
      assert.equal(
        await value(
          client,
          `select provolatile from pg_proc where oid = 'public.peek_invitation(text)'::regprocedure`,
        ),
        's',
      );
    }));

  test('status follows expiry and acceptance', () =>
    tx(async (client) => {
      const inv = await invite(client, { p_email: 'late@example.org' });
      const invitee = await user(client, { email: 'late@example.org' });
      await as(client, invitee);
      const open = await rpc(client, 'peek_invitation', { p_token: inv.token });
      assert.equal(open.status, 'open');
      assert.equal(open.email_matches, true);
      await rpc(client, 'accept_invitation', { p_token: inv.token });
      const used = await rpc(client, 'peek_invitation', { p_token: inv.token });
      assert.equal(used.status, 'used');
      assert.equal(used.accepted_by_you, true);

      const old = await invite(client, { p_email: 'late@example.org' });
      await asPostgres(client);
      await client.query(
        `update public.invitations set created_at = now() - interval '3 days', expires_at = now() - interval '1 day' where id = $1`,
        [old.invitation_id],
      );
      await as(client, invitee);
      const expired = await rpc(client, 'peek_invitation', {
        p_token: old.token,
      });
      assert.equal(expired.status, 'expired');
    }));

  test('refusals: 401 and 404 for an unknown or malformed token', () =>
    tx(async (client) => {
      const inv = await invite(client, { p_email: 'p@example.org' });
      await asNobody(client);
      await expectCode(
        rpc(client, 'peek_invitation', { p_token: inv.token }),
        'PL401_NOT_SIGNED_IN',
      );
      await as(client, SEED.learner);
      for (const token of [
        'A'.repeat(43),
        'short',
        '',
        null,
        `${inv.token}x`,
        inv.token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
      ])
        await expectCode(
          rpc(client, 'peek_invitation', { p_token: token }),
          'PL404_INVITATION_NOT_FOUND',
        );
    }));
});

describe('accept_invitation', () => {
  test('grants the role once, creates the contributor, and is idempotent for the same person', () =>
    tx(async (client) => {
      const inv = await invite(client, {
        p_email: 'amina@example.org',
        p_display_name: 'Amina Khan',
      });
      const invitee = await user(client, { email: 'Amina@Example.org' });
      await as(client, invitee);
      const first = await rpc(client, 'accept_invitation', {
        p_token: inv.token,
      });
      assert.match(first.contributor_id, /^ctr-\d{4}$/);
      assert.ok(first.grant_id);
      assert.equal(first.role, 'language_reviewer');
      assert.equal(first.language, 'ps');
      assert.equal(first.variety, 'ps-var-yusufzai');

      const context = await rpc(client, 'my_context');
      assert.equal(context.contributor.display_name, 'Amina Khan');
      assert.deepEqual(
        context.review_varieties.map((v) => v.id),
        ['ps-var-yusufzai'],
      );

      const again = await rpc(client, 'accept_invitation', {
        p_token: inv.token,
      });
      assert.deepEqual(again, first);

      await asPostgres(client);
      const grants = await value(
        client,
        'select count(*)::int from public.role_grants where contributor_id = $1',
        [first.contributor_id],
      );
      assert.equal(grants, 1);
      const row = await one(
        client,
        'select * from public.invitations where id = $1',
        [inv.invitation_id],
      );
      assert.equal(row.accepted_by_user, invitee.id);
      assert.equal(row.accepted_contributor_id, first.contributor_id);
      assert.equal(row.grant_id, first.grant_id);
      const g = await one(
        client,
        'select * from public.role_grants where id = $1',
        [first.grant_id],
      );
      assert.equal(g.invitation_id, inv.invitation_id);
      assert.equal(g.granted_by, 'ctr-0101');
      assert.equal(g.ends_at, null);
      assert.equal(
        await value(
          client,
          'select contact_email from public.contributor_private where contributor_id = $1',
          [first.contributor_id],
        ),
        'amina@example.org',
      );
      const actions = (
        await client.query(
          `select action from public.audit_events
           where actor_contributor_id = $1 order by id`,
          [first.contributor_id],
        )
      ).rows.map((r) => r.action);
      assert.deepEqual(actions, ['invitation.accepted', 'role.granted']);
    }));

  test('a grant end date on the invitation carries to the grant', () =>
    tx(async (client) => {
      const ends = new Date(Date.now() + 90 * 86_400_000);
      const inv = await invite(client, {
        p_email: 'temp@example.org',
        p_grant_ends_at: ends,
      });
      const invitee = await user(client, { email: 'temp@example.org' });
      await as(client, invitee);
      const r = await rpc(client, 'accept_invitation', { p_token: inv.token });
      await asPostgres(client);
      const endsAt = await value(
        client,
        'select ends_at from public.role_grants where id = $1',
        [r.grant_id],
      );
      assert.equal(endsAt.getTime(), ends.getTime());
    }));

  test('an ended contributor is brought back', () =>
    tx(async (client) => {
      const person = await user(client, { email: 'back@example.org' });
      const { contributorId } = await grant(client, person, 'editor');
      await asPostgres(client);
      await client.query(
        `update public.contributors set status = 'ended' where id = $1`,
        [contributorId],
      );
      const inv = await invite(client, { p_email: 'back@example.org' });
      await as(client, person);
      const r = await rpc(client, 'accept_invitation', { p_token: inv.token });
      assert.equal(r.contributor_id, contributorId);
      await asPostgres(client);
      assert.equal(
        await value(
          client,
          'select status from public.contributors where id = $1',
          [contributorId],
        ),
        'active',
      );
    }));

  test('refusals in the contract order: 401, 404, 410 revoked, expired, used', () =>
    tx(async (client) => {
      const inv = await invite(client, { p_email: 'one@example.org' });
      await asNobody(client);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: inv.token }),
        'PL401_NOT_SIGNED_IN',
      );
      const invitee = await user(client, { email: 'one@example.org' });
      await as(client, invitee);
      for (const token of ['B'.repeat(43), 'nope', null])
        await expectCode(
          rpc(client, 'accept_invitation', { p_token: token }),
          'PL404_INVITATION_NOT_FOUND',
        );

      // Expired, by date and by the role's own end date having passed.
      const expired = await invite(client, { p_email: 'one@example.org' });
      const ended = await invite(client, {
        p_email: 'one@example.org',
        p_grant_ends_at: new Date(Date.now() + 86_400_000),
      });
      await asPostgres(client);
      await client.query(
        `update public.invitations set created_at = now() - interval '10 days', expires_at = now() - interval '1 second' where id = $1`,
        [expired.invitation_id],
      );
      await client.query(
        `update public.invitations set grant_ends_at = now() - interval '1 second' where id = $1`,
        [ended.invitation_id],
      );
      await as(client, invitee);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: expired.token }),
        'PL410_INVITATION_EXPIRED',
      );
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: ended.token }),
        'PL410_INVITATION_EXPIRED',
      );

      // Revoked comes before expired.
      await as(client, SEED.admin);
      await rpc(client, 'revoke_invitation', {
        p_invitation_id: expired.invitation_id,
      });
      await as(client, invitee);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: expired.token }),
        'PL410_INVITATION_REVOKED',
      );

      // Used by someone else: refused before their email is even looked at.
      await rpc(client, 'accept_invitation', { p_token: inv.token });
      const other = await user(client, { email: 'one@example.org' });
      await as(client, other);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: inv.token }),
        'PL410_INVITATION_USED',
      );
      await as(client, SEED.learner);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: inv.token }),
        'PL410_INVITATION_USED',
      );
    }));

  test('refusals: unverified email, wrong email (masked), no profile, under 18', () =>
    tx(async (client) => {
      const inv = await invite(client, { p_email: 'amina@example.org' });

      const unverified = await user(client, {
        email: 'amina@example.org',
        emailConfirmed: false,
      });
      await as(client, unverified);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: inv.token }),
        'PL403_EMAIL_UNVERIFIED',
      );

      const wrong = await user(client, { email: 'someone.else@example.org' });
      await as(client, wrong);
      const err = await expectCode(
        rpc(client, 'accept_invitation', { p_token: inv.token }),
        'PL403_WRONG_EMAIL',
      );
      assert.match(err.message, /a•••@example\.org/);
      assert.equal(err.message.includes('amina@'), false);

      const noProfile = await user(client, {
        email: 'amina@example.org',
        ageBand: null,
      });
      await as(client, noProfile);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: inv.token }),
        'PL403_NO_PROFILE',
      );

      const teen = await user(client, {
        email: 'amina@example.org',
        ageBand: '13-17',
      });
      await as(client, teen);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: inv.token }),
        'PL403_UNDER_18',
      );

      // None of the refusals used up the invitation.
      await asPostgres(client);
      const row = await one(
        client,
        'select accepted_at, grant_id from public.invitations where id = $1',
        [inv.invitation_id],
      );
      assert.deepEqual(row, { accepted_at: null, grant_id: null });
      assert.equal(
        await value(
          client,
          'select count(*)::int from public.contributors where user_id = any ($1::uuid[])',
          [[unverified.id, wrong.id, noProfile.id, teen.id]],
        ),
        0,
      );
    }));

  test('refusals: an admin cannot also be a reviewer, either way round', () =>
    tx(async (client) => {
      const reviewer = await user(client, { email: 'rev@example.org' });
      await grant(client, reviewer, 'language_reviewer', {
        variety: 'ps-var-yusufzai',
      });
      const asAdmin = await invite(client, {
        p_role: 'admin',
        p_variety: null,
        p_email: 'rev@example.org',
      });
      await as(client, reviewer);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: asAdmin.token }),
        'PL409_ROLE_CONFLICT',
      );

      const admin = await user(client, { email: 'adm@example.org' });
      await grant(client, admin, 'admin');
      const asReviewer = await invite(client, {
        p_variety: 'hno-var-hazara',
        p_email: 'adm@example.org',
      });
      await as(client, admin);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: asReviewer.token }),
        'PL409_ROLE_CONFLICT',
      );
    }));

  test('refusals: a role the person already holds', () =>
    tx(async (client) => {
      const reviewer = await user(client, { email: 'dup@example.org' });
      await grant(client, reviewer, 'language_reviewer', {
        variety: 'ps-var-yusufzai',
      });
      const same = await invite(client, { p_email: 'dup@example.org' });
      await as(client, reviewer);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: same.token }),
        'PL409_ALREADY_HAS_ROLE',
      );
      // A different variety is a different role.
      const other = await invite(client, {
        p_variety: 'hno-var-hazara',
        p_email: 'dup@example.org',
      });
      await as(client, reviewer);
      await rpc(client, 'accept_invitation', { p_token: other.token });

      // An editor of every language already edits Pashto.
      const editor = await user(client, { email: 'ed@example.org' });
      await grant(client, editor, 'editor');
      const scoped = await invite(client, {
        p_role: 'editor',
        p_variety: null,
        p_language: 'ps',
        p_email: 'ed@example.org',
      });
      await as(client, editor);
      await expectCode(
        rpc(client, 'accept_invitation', { p_token: scoped.token }),
        'PL409_ALREADY_HAS_ROLE',
      );
    }));
});

describe('revoke_role', () => {
  test('a future end date keeps the role until then; ending it now removes it at once', () =>
    tx(async (client) => {
      const reviewer = await user(client, { email: 'ending@example.org' });
      const { contributorId, grantId } = await grant(
        client,
        reviewer,
        'language_reviewer',
        { variety: 'ps-var-yusufzai' },
      );
      const later = new Date(Date.now() + 7 * 86_400_000);

      await as(client, SEED.admin);
      const r = await rpc(client, 'revoke_role', {
        p_grant_id: grantId,
        p_effective_at: later,
        p_reason: 'Contract ends next week',
      });
      assert.equal(new Date(r.ends_at).getTime(), later.getTime());
      assert.equal(r.contributor_id, contributorId);

      await as(client, reviewer);
      assert.equal(
        await value(
          client,
          `select private.has_review_authority('ps-var-yusufzai')`,
        ),
        true,
      );
      const people = await (async () => {
        await as(client, SEED.admin);
        return rpc(client, 'page_admin_people');
      })();
      const g = people.people
        .find((p) => p.id === contributorId)
        .grants.find((x) => x.id === grantId);
      assert.equal(g.state, 'ending');
      assert.equal(g.revoke_reason, 'Contract ends next week');
      assert.equal(g.revoked_by, 'ctr-0101');

      // Brought forward to now: gone at once.
      await rpc(client, 'revoke_role', { p_grant_id: grantId });
      await as(client, reviewer);
      assert.equal(
        await value(
          client,
          `select private.has_review_authority('ps-var-yusufzai')`,
        ),
        false,
      );
      const context = await rpc(client, 'my_context');
      assert.deepEqual(context.review_varieties, []);

      await as(client, SEED.admin);
      await expectCode(
        rpc(client, 'revoke_role', { p_grant_id: grantId }),
        'PL409_ALREADY_ENDED',
      );

      // Ended, it no longer blocks a new invitation to the same role.
      const inv = await invite(client, { p_email: 'ending@example.org' });
      await as(client, reviewer);
      await rpc(client, 'accept_invitation', { p_token: inv.token });
      assert.equal(
        await value(
          client,
          `select private.has_review_authority('ps-var-yusufzai')`,
        ),
        true,
      );

      await asPostgres(client);
      assert.equal(
        await value(
          client,
          `select count(*)::int from public.audit_events where action = 'role.revoked' and target_id = $1`,
          [grantId],
        ),
        2,
      );
    }));

  test('refusals: 401, 403 not admin, 422 past date, 404, 409 already ended', () =>
    tx(async (client) => {
      await asNobody(client);
      await expectCode(
        rpc(client, 'revoke_role', { p_grant_id: SEED.reviewerPs.grant }),
        'PL401_NOT_SIGNED_IN',
      );
      for (const who of [SEED.editor, SEED.reviewerPs, SEED.learner]) {
        await as(client, who);
        await expectCode(
          rpc(client, 'revoke_role', { p_grant_id: SEED.reviewerPs.grant }),
          'PL403_NOT_ADMIN',
        );
      }
      await as(client, SEED.admin);
      await expectCode(
        rpc(client, 'revoke_role', {
          p_grant_id: SEED.reviewerPs.grant,
          p_effective_at: new Date(Date.now() - 86_400_000),
        }),
        'PL422_BAD_DATE',
      );
      await expectCode(
        rpc(client, 'revoke_role', {
          p_grant_id: SEED.reviewerPs.grant,
          p_reason: 'x'.repeat(501),
        }),
        'PL422_LENGTH',
      );
      await expectCode(
        rpc(client, 'revoke_role', {
          p_grant_id: '00000000-0000-4000-8000-00000000dead',
        }),
        'PL404_NOT_FOUND',
      );
      await rpc(client, 'revoke_role', { p_grant_id: SEED.reviewerPs.grant });
      await expectCode(
        rpc(client, 'revoke_role', { p_grant_id: SEED.reviewerPs.grant }),
        'PL409_ALREADY_ENDED',
      );
    }));

  test('refusals: the last admin, now or by a date after every other admin has gone', () =>
    tx(async (client) => {
      await as(client, SEED.admin);
      await expectCode(
        rpc(client, 'revoke_role', { p_grant_id: SEED.admin.grant }),
        'PL409_LAST_ADMIN',
      );

      const second = await user(client, { email: 'admin2@example.org' });
      const { grantId } = await grant(client, second, 'admin');
      // The second admin leaves in 3 days: the first may not leave in 5.
      await as(client, SEED.admin);
      await rpc(client, 'revoke_role', {
        p_grant_id: grantId,
        p_effective_at: new Date(Date.now() + 3 * 86_400_000),
      });
      await expectCode(
        rpc(client, 'revoke_role', {
          p_grant_id: SEED.admin.grant,
          p_effective_at: new Date(Date.now() + 5 * 86_400_000),
        }),
        'PL409_LAST_ADMIN',
      );
      // But may leave in 2, while the second is still there.
      await rpc(client, 'revoke_role', {
        p_grant_id: SEED.admin.grant,
        p_effective_at: new Date(Date.now() + 2 * 86_400_000),
      });
    }));
});

describe('update_contributor', () => {
  test('an admin changes any field; a person changes only their own attribution', () =>
    tx(async (client) => {
      await as(client, SEED.admin);
      const r = await rpc(client, 'update_contributor', {
        p_contributor_id: 'ctr-0103',
        p_patch: {
          display_name: '  Gul Pari ',
          status: 'paused',
          phone: '+92 300 0000000',
          notes: '',
        },
      });
      assert.deepEqual(r, {
        id: 'ctr-0103',
        display_name: 'Gul Pari',
        attribution_name: null,
        status: 'paused',
      });
      await asPostgres(client);
      const p = await one(
        client,
        'select phone, notes, updated_by from public.contributor_private where contributor_id = $1',
        ['ctr-0103'],
      );
      assert.deepEqual(p, {
        phone: '+92 300 0000000',
        notes: null,
        updated_by: 'ctr-0101',
      });

      await as(client, SEED.editor);
      const own = await rpc(client, 'update_contributor', {
        p_contributor_id: 'ctr-0102',
        p_patch: { attribution_name: 'Editor, Peshawar' },
      });
      assert.equal(own.attribution_name, 'Editor, Peshawar');
    }));

  test('refusals: 401, 403 not admin, 422 bad input, 404, 409 last admin', () =>
    tx(async (client) => {
      const call = (id, patch) =>
        rpc(client, 'update_contributor', {
          p_contributor_id: id,
          p_patch: patch,
        });
      await asNobody(client);
      await expectCode(
        call('ctr-0102', { attribution_name: 'x' }),
        'PL401_NOT_SIGNED_IN',
      );

      await as(client, SEED.editor);
      await expectCode(
        call('ctr-0103', { attribution_name: 'x' }),
        'PL403_NOT_ADMIN',
      );
      await expectCode(
        call('ctr-0102', { display_name: 'Me' }),
        'PL403_NOT_ADMIN',
      );
      await as(client, SEED.learner);
      await expectCode(
        call('ctr-0102', { attribution_name: 'x' }),
        'PL403_NOT_ADMIN',
      );

      await as(client, SEED.admin);
      for (const patch of [
        {},
        null,
        { favourite_colour: 'violet' },
        { display_name: '' },
        { display_name: 'x'.repeat(61) },
        { status: 'retired' },
        { contact_email: 'not an email' },
        { phone: 42 },
      ])
        await expectCode(call('ctr-0103', patch), 'PL422_BAD_INPUT');
      await expectCode(
        call('ctr-9999', { display_name: 'Nobody' }),
        'PL404_NOT_FOUND',
      );
      await expectCode(
        call('ctr-0101', { status: 'paused' }),
        'PL409_LAST_ADMIN',
      );
    }));
});

describe('page_admin_people', () => {
  test('lists people with private details and grants, and open invitations without tokens', () =>
    tx(async (client) => {
      const inv = await invite(client, {
        p_email: 'waiting@example.org',
        p_display_name: 'Waiting',
      });
      const page = await rpc(client, 'page_admin_people');
      assert.equal(page.me, 'ctr-0101');
      const ids = page.people.map((p) => p.id);
      for (const id of [
        'ctr-0101',
        'ctr-0102',
        'ctr-0103',
        'ctr-0104',
        'ctr-0105',
      ])
        assert.ok(ids.includes(id), id);
      const rev = page.people.find((p) => p.id === 'ctr-0103');
      assert.equal(rev.email, 'reviewer.ps@polilingo.test');
      assert.equal(rev.private.contact_email, 'reviewer.ps@polilingo.test');
      assert.equal(rev.grants.length, 1);
      assert.deepEqual(
        {
          role: rev.grants[0].role,
          language: rev.grants[0].language,
          variety: rev.grants[0].variety,
          variety_name: rev.grants[0].variety_name,
          state: rev.grants[0].state,
        },
        {
          role: 'language_reviewer',
          language: 'ps',
          variety: 'ps-var-yusufzai',
          variety_name: 'Northern Pashto (Peshawar / Yusufzai)',
          state: 'active',
        },
      );
      const open = page.invitations.find((i) => i.id === inv.invitation_id);
      assert.equal(open.email, 'waiting@example.org');
      assert.equal(open.state, 'open');
      assert.equal(open.created_by_name, 'Local Admin');
      const text = JSON.stringify(page);
      assert.equal(text.includes(inv.token), false);
      assert.equal(text.includes('token'), false);
      const ps = page.languages.find((l) => l.code === 'ps');
      assert.ok(ps.varieties.some((v) => v.id === 'ps-var-yusufzai'));
    }));

  test('an invitation reads as expired when its link or its role end has passed; used and cancelled ones leave the list', () =>
    tx(async (client) => {
      const linkGone = await invite(client, { p_email: 'late1@example.org' });
      const roleGone = await invite(client, {
        p_email: 'late2@example.org',
        p_grant_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
      });
      const cancelled = await invite(client, { p_email: 'gone@example.org' });
      await rpc(client, 'revoke_invitation', {
        p_invitation_id: cancelled.invitation_id,
      });
      await asPostgres(client);
      await client.query(
        `update public.invitations
         set created_at = now() - interval '2 days', expires_at = now() - interval '1 minute'
         where id = $1`,
        [linkGone.invitation_id],
      );
      await client.query(
        `update public.invitations set grant_ends_at = now() - interval '1 minute' where id = $1`,
        [roleGone.invitation_id],
      );
      await as(client, SEED.admin);
      const page = await rpc(client, 'page_admin_people');
      const state = (id) => page.invitations.find((i) => i.id === id)?.state;
      assert.equal(state(linkGone.invitation_id), 'expired');
      assert.equal(state(roleGone.invitation_id), 'expired');
      assert.equal(state(cancelled.invitation_id), undefined);
    }));

  test('refusals: 401 and 403 not admin', () =>
    tx(async (client) => {
      await asNobody(client);
      await expectCode(rpc(client, 'page_admin_people'), 'PL401_NOT_SIGNED_IN');
      for (const who of [SEED.editor, SEED.reviewerPs, SEED.learner]) {
        await as(client, who);
        await expectCode(rpc(client, 'page_admin_people'), 'PL403_NOT_ADMIN');
      }
    }));
});

describe('page_admin_overview', () => {
  test('the numbers on the seeded fixture', () =>
    tx(async (client) => {
      await as(client, SEED.admin);
      const o = await rpc(client, 'page_admin_overview');
      assert.deepEqual(o.target, {
        reviewed_target_min: 250,
        reviewed_target_max: 400,
      });
      assert.equal(o.latest_release.name, 'content@2026.09.1');
      assert.equal(o.latest_release.kind, 'seed');
      assert.equal(o.latest_release.lessons, 2);
      assert.equal(o.latest_release.items, 4);

      const ps = o.languages.find((l) => l.code === 'ps');
      const pick = (l) => ({
        lessons: l.lessons,
        items: l.items,
        demo: l.demo,
        draft: l.draft,
        in_review: l.in_review,
        changes_requested: l.changes_requested,
        reviewed: l.reviewed,
        approved_waiting: l.approved_waiting,
        live: l.live,
        reviewed_live: l.reviewed_live,
        demo_live: l.demo_live,
        gated: l.gated,
      });
      assert.deepEqual(pick(ps), {
        lessons: 2,
        items: 4,
        demo: 4,
        draft: 0,
        in_review: 0,
        changes_requested: 0,
        reviewed: 0,
        approved_waiting: 0,
        live: 4,
        reviewed_live: 0,
        demo_live: 4,
        gated: 0,
      });
      assert.deepEqual(ps.demo_period, { sunset: '2026-12-11', live: true });
      const hno = o.languages.find((l) => l.code === 'hno');
      assert.equal(hno.items, 0);
      assert.equal(hno.publish_gate, 'blocked');

      const reviewers = Object.fromEntries(
        o.varieties.map((v) => [v.id, v.reviewers]),
      );
      assert.deepEqual(reviewers, {
        'hno-var-hazara': 1,
        'ps-var-fixture': 0,
        'ps-var-yusufzai': 2,
      });
      assert.deepEqual(
        o.varieties
          .find((v) => v.id === 'ps-var-yusufzai')
          .reviewer_names.sort(),
        ['Local Pashto Reviewer', 'Local Pashto Reviewer 2'],
      );

      const { activity_7d: activity, ...accounts } = o.accounts;
      assert.deepEqual(accounts, {
        total: 8,
        adults: 7,
        active_7d: 0,
        learners_with_completion: 0,
        completions: 0,
        team: 5,
      });
      assert.equal(activity.length, 7);
      assert.ok(activity.every((d) => d.accounts === 0));
    }));

  test('the pipeline follows drafts, review, approval, gates and activity', () =>
    tx(async (client) => {
      const lesson = await seedLesson(client, { items: 6 });
      await asPostgres(client);
      await client.query(
        'update content.lessons set submitted_at = now() where id = $1',
        [lesson.lessonId],
      );
      await client.query(
        `update content.items set review_status = 'approved' where id = any ($1)`,
        [lesson.itemIds.slice(0, 2)],
      );
      await client.query(
        `update content.items set review_status = 'changes_requested' where id = $1`,
        [lesson.itemIds[2]],
      );
      await client.query(
        `update content.units set publish_gate = 'blocked' where id = $1`,
        [lesson.unitId],
      );
      const hno = await seedLesson(client, {
        language: 'hno',
        variety: 'hno-var-hazara',
        items: 2,
        exercises: 1,
      });
      const learner = await user(client);
      await client.query(
        `insert into public.progress_imports (user_id, envelope_hash, device_id, summary)
         values ($1, repeat('a', 64), 'device', '{}')`,
        [learner.id],
      );
      await client.query(
        `insert into public.progress_completions (user_id, lesson_id, first_release)
         values ($1, 'ps-lsn-f00001', 'content@2026.09.1'), ($1, 'ps-lsn-f00002', 'content@2026.09.1')`,
        [learner.id],
      );

      await as(client, SEED.admin);
      const o = await rpc(client, 'page_admin_overview');
      const ps = o.languages.find((l) => l.code === 'ps');
      assert.equal(ps.lessons, 3);
      assert.equal(ps.items, 10);
      assert.equal(ps.draft, 0);
      assert.equal(ps.in_review, 3);
      assert.equal(ps.changes_requested, 1);
      assert.equal(ps.reviewed, 2);
      assert.equal(ps.approved_waiting, 2);
      assert.equal(ps.gated, 6);
      assert.equal(ps.live, 4);
      const h = o.languages.find((l) => l.code === 'hno');
      assert.equal(h.items, 2);
      assert.equal(h.draft, 2);
      assert.equal(h.gated, 2, 'Hindko is gated until reviewed');
      assert.equal(hno.itemIds.length, 2);

      assert.equal(o.accounts.total, 9);
      assert.equal(o.accounts.active_7d, 1);
      assert.equal(o.accounts.learners_with_completion, 1);
      assert.equal(o.accounts.completions, 2);
      assert.equal(o.accounts.activity_7d.at(-1).accounts, 1);
    }));

  test('staff who are not admins see the pipeline but not the accounts', () =>
    tx(async (client) => {
      await as(client, SEED.reviewerPs);
      const o = await rpc(client, 'page_admin_overview');
      assert.equal(o.accounts, null);
      assert.ok(o.languages.length >= 2);
    }));

  test('refusals: 401 and 403 for someone without a role', () =>
    tx(async (client) => {
      await asNobody(client);
      await expectCode(
        rpc(client, 'page_admin_overview'),
        'PL401_NOT_SIGNED_IN',
      );
      await as(client, SEED.learner);
      await expectCode(rpc(client, 'page_admin_overview'), 'PL403_NOT_ADMIN');
    }));
});
