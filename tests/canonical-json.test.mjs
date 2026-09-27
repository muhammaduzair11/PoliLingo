// lib/canonical-json.ts against vectors made with the content repository's
// own canonicalJson() (tests/fixtures/canonical-json-vectors.json). The
// database's private.canonical_json() is held to the same file by
// tests/db/invariants.test.mjs, so all three agree byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../lib/canonical-json.ts';

const { vectors } = JSON.parse(
  readFileSync(
    new URL('./fixtures/canonical-json-vectors.json', import.meta.url),
    'utf8',
  ),
);

test('the shared vectors cover what the contract promises', () => {
  const names = vectors.map((v) => v.name).join(' ');
  for (const topic of [
    'pashto',
    'urdu',
    'nbsp',
    'combining',
    'nested',
    'unicode keys',
    'arrays',
    'control',
    'quotes',
    'whitespace',
    'null',
    'true',
    'false',
  ])
    assert.match(names, new RegExp(topic), `a vector for ${topic}`);
  assert.ok(vectors.length >= 20);
});

for (const vector of vectors)
  test(`canonical JSON: ${vector.name}`, () => {
    const text = canonicalJson(vector.input);
    assert.equal(text, vector.canonical);
    assert.equal(
      createHash('sha256').update(text, 'utf8').digest('hex'),
      vector.sha256,
    );
  });

test('keys are sorted at every depth and whitespace is dropped', () => {
  assert.equal(
    canonicalJson({ b: { d: 1, c: [2, { f: 3, e: 4 }] }, a: '' }),
    '{"a":"","b":{"c":[2,{"e":4,"f":3}],"d":1}}',
  );
});

test('undefined is dropped from objects and null in arrays, as JSON.stringify does', () => {
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalJson([undefined, 1]), '[null,1]');
});

test('the result parses back to the same value', () => {
  for (const vector of vectors)
    assert.deepEqual(JSON.parse(canonicalJson(vector.input)), vector.input);
});
