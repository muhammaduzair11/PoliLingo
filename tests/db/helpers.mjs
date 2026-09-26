// Database test helpers (docs/platform.md §3.11). Not part of `npm test`:
// run with `npm run test:db` (local stack, under the cross-agent lock) or
// `npm run test:db:ci` (a fresh CI stack).
//
// Every test works inside tx(): BEGIN ... ROLLBACK, so nothing is left
// behind. Inside tx() each statement runs in its own savepoint, so a refused
// statement (expectCode) does not abort the rest of the test.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

export const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** A new, unconnected pg.Client on DATABASE_URL. */
export function db() {
  return new pg.Client({ connectionString: DATABASE_URL });
}

/**
 * Runs fn(client) inside BEGIN ... ROLLBACK and returns its result. Each
 * client.query() runs in a savepoint, so a failing statement is undone on
 * its own and the transaction carries on.
 */
export async function tx(fn) {
  const client = db();
  await client.connect();
  const raw = client.query.bind(client);
  let depth = 0;
  client.query = async (text, values) => {
    const name = `pl_q${depth}`;
    depth += 1;
    try {
      await raw(`savepoint ${name}`);
      try {
        const result = await raw(text, values);
        await raw(`release savepoint ${name}`);
        return result;
      } catch (err) {
        await raw(`rollback to savepoint ${name}`);
        throw err;
      }
    } finally {
      depth -= 1;
    }
  };
  try {
    await raw('begin');
    return await fn(client);
  } finally {
    try {
      await raw('rollback');
    } finally {
      await client.end();
    }
  }
}

/** One row, or undefined. */
export async function one(client, text, values) {
  const { rows } = await client.query(text, values);
  return rows[0];
}

/** The single value of a one-column, one-row query. */
export async function value(client, text, values) {
  const row = await one(client, text, values);
  return row === undefined ? undefined : Object.values(row)[0];
}

/**
 * Runs fn as postgres and puts the caller's role and JWT claims back
 * afterwards, so helpers can be called whoever the test is acting as.
 */
async function asOwner(client, fn) {
  const role = await value(client, "select current_setting('role')");
  const claims = await value(
    client,
    "select coalesce(current_setting('request.jwt.claims', true), '')",
  );
  await client.query('reset role');
  try {
    return await fn();
  } finally {
    if (role && role !== 'none') {
      await client.query(`set local role ${pg.escapeIdentifier(role)}`);
    }
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      claims,
    ]);
  }
}

/**
 * Inserts an auth.users row (and a profile when ageBand is set) and returns
 * { id, email }. ageBand null means no profile.
 */
export async function user(
  client,
  { email, ageBand = '18+', emailConfirmed = true } = {},
) {
  const id = randomUUID();
  const address = (email ?? `test-${id}@polilingo.test`).toLowerCase();
  await asOwner(client, async () => {
    await client.query(
      `insert into auth.users (
         instance_id, id, aud, role, email, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data,
         confirmation_token, recovery_token, email_change_token_new, email_change,
         created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated',
         'authenticated', $2, case when $3 then now() end,
         '{"provider":"email","providers":["email"]}', '{}', '', '', '', '',
         now(), now())`,
      [id, address, emailConfirmed],
    );
    if (ageBand) {
      await client.query(
        'insert into public.profiles (user_id, age_band) values ($1, $2)',
        [id, ageBand],
      );
    }
  });
  return { id, email: address };
}

/** Acts as a signed-in user for the rest of the transaction. */
export async function as(client, u) {
  await client.query('set local role authenticated');
  await client.query(
    "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', '', true)",
    [JSON.stringify({ sub: u.id, role: 'authenticated', email: u.email })],
  );
}

/** Acts as an anonymous visitor (the publishable key, no session). */
export async function asAnon(client) {
  await client.query('set local role anon');
  await client.query(
    "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', '', true)",
    [JSON.stringify({ role: 'anon' })],
  );
}

/** Back to the migration role (postgres). Claims are left as they are. */
export async function asPostgres(client) {
  await client.query('reset role');
}

/**
 * Gives a test user a contributor (created once) and a role grant. Returns
 * { contributorId, grantId }. Reviewers need a variety; their language
 * defaults to the variety's prefix.
 */
export async function grant(client, u, role, { language, variety } = {}) {
  return asOwner(client, async () => {
    let contributorId = await value(
      client,
      'select id from public.contributors where user_id = $1',
      [u.id],
    );
    if (!contributorId) {
      contributorId = await value(
        client,
        `insert into public.contributors (user_id, display_name)
         values ($1, $2) returning id`,
        [u.id, u.email.split('@')[0].slice(0, 60)],
      );
    }
    const lang = language ?? (variety ? variety.split('-')[0] : null) ?? null;
    const grantId = await value(
      client,
      `insert into public.role_grants (contributor_id, role, language_code, variety_id, starts_at)
       values ($1, $2, $3, $4, now() - interval '1 minute') returning id`,
      [contributorId, role, role === 'admin' ? null : lang, variety ?? null],
    );
    return { contributorId, grantId };
  });
}

/**
 * Asserts that a promise is refused with a PL error code and returns the
 * error, e.g. await expectCode(client.query(...), 'PL403_OUTSIDE_VARIETY').
 * A code without the PL prefix (a SQLSTATE such as '42501') is compared
 * with err.code instead.
 */
export async function expectCode(promise, code) {
  let error;
  try {
    await promise;
  } catch (err) {
    error = err;
  }
  assert.ok(error, `expected ${code}, but the call succeeded`);
  if (code.startsWith('PL')) {
    const match = /^(PL\d{3}_[A-Z0-9_]+):\s*/.exec(error.message ?? '');
    assert.equal(match?.[1], code, `expected ${code}, got: ${error.message}`);
  } else {
    assert.equal(error.code, code, `expected ${code}, got: ${error.message}`);
  }
  return error;
}

const hex6 = () => randomBytes(3).toString('hex');

// Letters every Arabic-script allowlist here holds (ps, ur, hno), so the
// phrases pass whichever orthography is loaded.
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
];

/**
 * Builds one lesson through direct inserts as postgres with
 * polilingo.seeding on (then off again), and returns its ids.
 *
 *   items      a count (default 6) or an array of partial item fields
 *   exercises  a count (default 6) or an array of partial exercise fields
 *   demo       true: every item goes on the demo list
 */
export async function seedLesson(
  client,
  {
    language = 'ps',
    variety = `${language === 'ps' ? 'ps-var-yusufzai' : `${language}-var-test`}`,
    items = 6,
    exercises = 6,
    demo = false,
  } = {},
) {
  return asOwner(client, async () => {
    await client.query("select set_config('polilingo.seeding', 'on', true)");
    try {
      await client.query(
        `insert into content.languages (code, name, native_name, script, direction, locale)
         values ($1, $1, $1, 'Arab', 'rtl', $1 || '-Arab') on conflict (code) do nothing`,
        [language],
      );
      await client.query(
        `insert into content.varieties (id, language_code, name, learner_label)
         values ($1, $2, $1, $1) on conflict (id) do nothing`,
        [variety, language],
      );
      const courseId = `${language}-crs-t${hex6()}`;
      const unitId = `${language}-unt-${hex6()}`;
      const lessonId = `${language}-lsn-${hex6()}`;
      await client.query(
        `insert into content.courses (id, language_code, variety_id, name, publish_gate)
         values ($1, $2, $3, 'Test course', 'open')`,
        [courseId, language, variety],
      );
      await client.query(
        `insert into content.units (id, course_id, position, title, goal, publish_gate)
         values ($1, $2, 1, 'Test unit', 'A unit for a database test.', 'open')`,
        [unitId, courseId],
      );
      await client.query(
        `insert into content.lessons (id, course_id, unit_id, position, title, objective, variety_id)
         values ($1, $2, $3, 1, 'Test lesson', 'A lesson for a database test.', $4)`,
        [lessonId, courseId, unitId, variety],
      );

      const itemSpecs = Array.isArray(items)
        ? items
        : Array.from({ length: items }, () => ({}));
      const itemIds = [];
      for (const [i, spec] of itemSpecs.entries()) {
        const id = spec.id ?? `${language}-itm-${hex6()}`;
        await client.query(
          `insert into content.items (
             id, lesson_id, position, native, romanisation, meaning, context, usage_note,
             variety_id, source_type, source_citation, source_licence)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id,
            lessonId,
            spec.position ?? i + 1,
            spec.native ?? NATIVE[i % NATIVE.length],
            spec.romanisation ?? `Word ${i + 1}`,
            spec.meaning ?? `Meaning ${i + 1}`,
            spec.context ?? null,
            spec.usage_note ?? null,
            spec.variety ?? variety,
            spec.source_type ?? 'original',
            spec.source_citation ?? 'Written for a database test',
            spec.source_licence ?? 'Test data only',
          ],
        );
        itemIds.push(id);
      }

      const exerciseSpecs = Array.isArray(exercises)
        ? exercises
        : itemIds.length >= 2
          ? Array.from({ length: exercises }, () => ({}))
          : [];
      const exerciseIds = [];
      for (const [i, spec] of exerciseSpecs.entries()) {
        const id = spec.id ?? `${language}-exr-${hex6()}`;
        const answer = spec.answer ?? itemIds[i % itemIds.length];
        const kind = spec.kind ?? 'meaning';
        const options =
          spec.options ??
          (kind === 'assemble'
            ? []
            : [itemIds[(i + 1) % itemIds.length]].filter((o) => o !== answer));
        await client.query(
          `insert into content.exercises (id, lesson_id, position, kind, answer_item_id, prompt, options)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            lessonId,
            spec.position ?? i + 1,
            kind,
            answer,
            spec.prompt ?? 'What does this mean?',
            options,
          ],
        );
        exerciseIds.push(id);
      }

      if (demo) {
        await client.query(
          `insert into content.demo_period (language_code, sunset, live)
           values ($1, current_date + 365, true) on conflict (language_code) do nothing`,
          [language],
        );
        for (const id of itemIds) {
          await client.query(
            `insert into content.demo_items (item_id, ml_training) values ($1, 'not_granted')`,
            [id],
          );
        }
      }
      return {
        language,
        variety,
        courseId,
        unitId,
        lessonId,
        itemIds,
        exerciseIds,
      };
    } finally {
      await client.query("select set_config('polilingo.seeding', '', true)");
    }
  });
}
