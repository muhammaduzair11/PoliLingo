// lib/db-errors.ts: every refusal the database can make has a plain English
// sentence, and nothing the database says about an unknown error ever
// reaches the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DUPLICATE_MESSAGE,
  ERROR_SENTENCES,
  GENERIC_MESSAGE,
  NETWORK_MESSAGE,
  NO_ACCESS_MESSAGE,
  SESSION_MESSAGE,
  SPECIFIC_MESSAGE_CODES,
  describeDbError,
  sentenceFor,
} from '../lib/db-errors.ts';
import { callRpc } from '../lib/rpc.ts';
import { fromRpc, actionError } from '../lib/console/action-result.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const catalogueFile = JSON.parse(read('../supabase/error-codes.json'));

/** The codes docs/platform.md lists in its error code catalogue (3.9). */
function contractCodes() {
  const doc = read('../docs/platform.md');
  const start = doc.indexOf('**Error code catalogue**');
  const end = doc.indexOf('### 3.10');
  assert.ok(
    start > 0 && end > start,
    'the catalogue section is in platform.md',
  );
  return [...doc.slice(start, end).matchAll(/`(\d{3}_[A-Z0-9_]+)`/g)].map(
    (m) => `PL${m[1]}`,
  );
}

/** A PostgREST error for a private.raise() refusal. */
const raised = (code, message = 'db text', detail = '') => ({
  code: 'P0001',
  message: `${code}: ${message}`,
  details: detail,
  hint: null,
});

test('error-codes.json holds exactly the catalogue in docs/platform.md', () => {
  const contract = contractCodes();
  assert.ok(contract.length >= 70);
  assert.deepEqual(
    Object.keys(catalogueFile).sort(),
    [...new Set(contract)].sort(),
  );
});

test('every sentence is plain, short and ends like a sentence', () => {
  for (const [code, sentence] of Object.entries(catalogueFile)) {
    assert.match(code, /^PL\d{3}_[A-Z0-9_]+$/);
    assert.ok(sentence.length >= 10 && sentence.length <= 160, code);
    assert.match(sentence, /[.?!]$/, code);
    assert.doesNotMatch(
      sentence,
      /PL\d{3}|SQL|null|undefined|exception/i,
      code,
    );
  }
  assert.equal(
    sentenceFor('PL403_OUTSIDE_VARIETY'),
    "This belongs to a variety you don't review.",
  );
});

test('every catalogue code maps to its sentence', () => {
  for (const code of contractCodes()) {
    const described = describeDbError(raised(code, ''));
    assert.equal(described.code, code);
    assert.equal(described.message, ERROR_SENTENCES[code], code);
  }
});

test("known codes with specifics show the database's own message", () => {
  const described = describeDbError(
    raised('PL403_OUTSIDE_VARIETY', 'Hazara needs a Hazara reviewer.'),
  );
  assert.deepEqual(described, {
    code: 'PL403_OUTSIDE_VARIETY',
    message: 'Hazara needs a Hazara reviewer.',
    detail: null,
  });
  for (const code of SPECIFIC_MESSAGE_CODES)
    assert.ok(catalogueFile[code], `${code} is a catalogue code`);
});

test('other known codes show the catalogue sentence, not the database text', () => {
  const described = describeDbError(
    raised('PL409_LAST_ADMIN', 'select count(*) from public.role_grants = 1'),
  );
  assert.equal(described.message, catalogueFile.PL409_LAST_ADMIN);
  assert.doesNotMatch(described.message, /select|role_grants/);
});

test("a refusal's detail comes back parsed", () => {
  const described = describeDbError(
    raised(
      'PL409_STALE',
      'changed',
      '{"current_fingerprint":"0123456789abcdef"}',
    ),
  );
  assert.equal(described.code, 'PL409_STALE');
  assert.deepEqual(described.detail, {
    current_fingerprint: '0123456789abcdef',
  });
  assert.equal(describeDbError(raised('PL409_STALE')).detail, null);
});

test('multi-line database messages still parse', () => {
  const described = describeDbError(
    raised('PL422_LESSON_PROBLEMS', 'Two problems:\n- one\n- two'),
  );
  assert.equal(described.code, 'PL422_LESSON_PROBLEMS');
  assert.equal(described.message, 'Two problems:\n- one\n- two');
});

test('an unknown PL code keeps its code but shows the generic sentence', () => {
  const described = describeDbError(raised('PL418_TEAPOT', 'secret internals'));
  assert.equal(described.code, 'PL418_TEAPOT');
  assert.equal(described.message, GENERIC_MESSAGE);
});

test('23505, 42501, JWT and network errors have their own sentences', () => {
  assert.deepEqual(
    describeDbError({
      code: '23505',
      message:
        'duplicate key value violates unique constraint "contributors_user_id_key"',
      details: 'Key (user_id)=(…) already exists.',
    }),
    { code: '23505', message: DUPLICATE_MESSAGE, detail: null },
  );
  assert.deepEqual(
    describeDbError({
      code: '42501',
      message: 'permission denied for function page_admin_people',
    }),
    { code: '42501', message: NO_ACCESS_MESSAGE, detail: null },
  );
  for (const error of [
    { code: 'PGRST301', message: 'JWSError JWSInvalidSignature' },
    { code: 'PGRST303', message: 'JWT expired' },
    { code: '', message: 'JWT expired' },
    { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
    new Error('Invalid Refresh Token: Refresh Token Not Found'),
  ])
    assert.equal(describeDbError(error).message, SESSION_MESSAGE);
  for (const error of [
    new TypeError('Failed to fetch'),
    new TypeError('fetch failed'),
    { code: '', message: 'TypeError: fetch failed', details: '' },
    { message: 'NetworkError when attempting to fetch resource.' },
    { message: 'Load failed' },
    { message: 'connect ECONNREFUSED 127.0.0.1:54321' },
  ]) {
    const described = describeDbError(error);
    assert.equal(described.message, NETWORK_MESSAGE);
    assert.equal(described.code, 'NETWORK');
  }
});

test('unknown errors never leak raw text', () => {
  const leaks = [
    {
      code: '22P02',
      message: 'invalid input syntax for type uuid: "x" in private.secret_fn',
    },
    { code: 'XX000', message: 'internal error at content.items line 42' },
    { code: 'P0001', message: 'raise without a code: password=hunter2' },
    new Error('Cannot read properties of undefined (reading "rows")'),
    'a bare string with internals',
    { message: 'relation "public.profiles" does not exist', code: '42P01' },
    { code: 'not a code; drop table', message: 'x' },
    null,
    undefined,
    42,
  ];
  for (const error of leaks) {
    const described = describeDbError(error);
    assert.equal(described.message, GENERIC_MESSAGE, JSON.stringify(error));
    assert.equal(described.detail, null);
    assert.match(described.code, /^[A-Z0-9_]+$/i);
    assert.doesNotMatch(
      `${described.code} ${described.message}`,
      /private|content\.items|password|profiles|drop table|undefined/,
    );
  }
  assert.equal(describeDbError({ code: '22P02', message: 'x' }).code, '22P02');
  assert.equal(describeDbError(new Error('boom')).code, 'UNKNOWN');
});

test('callRpc returns data or a mapped error, and never throws', async () => {
  const client = (reply) => ({
    rpc: async (fn, args) => {
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(fn, args) : reply;
    },
  });
  assert.deepEqual(
    await callRpc(
      client((fn, args) => ({ data: { fn, args }, error: null })),
      'my_context',
      { p: 1 },
    ),
    { ok: true, data: { fn: 'my_context', args: { p: 1 } } },
  );
  const refused = await callRpc(
    client({ data: null, error: raised('PL403_NOT_ADMIN', 'no') }),
    'page_admin_people',
  );
  assert.deepEqual(refused, {
    ok: false,
    error: {
      code: 'PL403_NOT_ADMIN',
      message: catalogueFile.PL403_NOT_ADMIN,
      detail: null,
    },
  });
  const thrown = await callRpc(client(new TypeError('fetch failed')), 'x');
  assert.equal(thrown.ok, false);
  assert.equal(thrown.error.message, NETWORK_MESSAGE);
  const unconfigured = await callRpc(null, 'x');
  assert.equal(unconfigured.ok, false);
  assert.equal(unconfigured.error.code, 'NOT_CONFIGURED');
  assert.doesNotMatch(unconfigured.error.message, /undefined|null/);

  assert.deepEqual(fromRpc(refused), {
    ok: false,
    code: 'PL403_NOT_ADMIN',
    message: catalogueFile.PL403_NOT_ADMIN,
  });
  assert.deepEqual(fromRpc({ ok: true, data: 3 }), { ok: true, data: 3 });
  assert.deepEqual(actionError(raised('PL422_NO_CHANGE')), {
    ok: false,
    code: 'PL422_NO_CHANGE',
    message: catalogueFile.PL422_NO_CHANGE,
  });
});
