// No passwords (migration 20260929000000_no_passwords.sql, ADR-0030): any
// password Supabase Auth tries to store is blanked, so a stranger cannot
// pre-register someone's email with a password and take the account over once
// its owner confirms it with an email code. Every test runs in a rolled-back
// transaction.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { asPostgres, tx, user, value } from './helpers.mjs';

const BCRYPT = '$2a$10$abcdefghijklmnopqrstuuJ4b1Sx2tEy6Yb0t3yJm8Wv0q1Zz0Zz2';

describe('passwords are never stored', () => {
  test('a password written on sign-up is blanked', () =>
    tx(async (client) => {
      await asPostgres(client);
      const id = await value(
        client,
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
           raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
           email_change_token_new, email_change, created_at, updated_at)
         values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
           'authenticated', 'authenticated', 'someone.else@example.org', $1,
           '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', now(), now())
         returning id`,
        [BCRYPT],
      );
      assert.equal(
        await value(
          client,
          'select encrypted_password from auth.users where id = $1',
          [id],
        ),
        '',
      );
    }));

  test('a password set later (update or recovery) is blanked too', () =>
    tx(async (client) => {
      const u = await user(client, { email: 'learner.pw@example.org' });
      await asPostgres(client);
      await client.query(
        'update auth.users set encrypted_password = $2 where id = $1',
        [u.id, BCRYPT],
      );
      assert.equal(
        await value(
          client,
          'select encrypted_password from auth.users where id = $1',
          [u.id],
        ),
        '',
      );
    }));

  test('other updates to a user leave the empty password alone', () =>
    tx(async (client) => {
      const u = await user(client, { email: 'learner.other@example.org' });
      await asPostgres(client);
      await client.query(
        'update auth.users set raw_user_meta_data = \'{"x":1}\' where id = $1',
        [u.id],
      );
      const stored = await value(
        client,
        'select encrypted_password from auth.users where id = $1',
        [u.id],
      );
      assert.ok(stored === null || stored === '');
    }));
});
