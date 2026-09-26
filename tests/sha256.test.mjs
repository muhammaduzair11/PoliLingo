// lib/sha256.ts, the pure synchronous SHA-256 used to recompute content
// hashes and text fingerprints in the browser, against node:crypto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../lib/canonical-json.ts';
import { sha256, sha256Bytes } from '../lib/sha256.ts';

const node = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

test('the standard test vectors', () => {
  assert.equal(
    sha256(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('Pashto, Urdu and other scripts, encoded as UTF-8', () => {
  for (const text of [
    'ستړي مه شې',
    'آپ کیسے ہیں؟',
    'سلام ورور',
    '‏سلام‎',
    'Café and Café',
    '🦜 poli',
    'Stəṛay ma she — ستړي مه شې',
    '日本語のテキスト',
    '\u0000\u0001\u007f',
    'a b c',
  ])
    assert.equal(sha256(text), node(text), JSON.stringify(text));
});

test('every length across the padding boundaries', () => {
  for (let length = 0; length <= 300; length++) {
    const text = 'ا'.repeat(Math.floor(length / 2)) + 'x'.repeat(length % 2);
    assert.equal(sha256(text), node(text), `length ${length}`);
    const ascii = 'q'.repeat(length);
    assert.equal(sha256(ascii), node(ascii), `ascii length ${length}`);
  }
});

test('random byte strings and long input', () => {
  for (let i = 0; i < 200; i++) {
    const bytes = randomBytes(i * 7);
    assert.equal(
      sha256Bytes(new Uint8Array(bytes)),
      createHash('sha256').update(bytes).digest('hex'),
    );
  }
  const long = 'پښتو '.repeat(50_000);
  assert.equal(sha256(long), node(long));
});

test('with canonicalJson, it recomputes the committed learner copy contentHash', () => {
  const raw = readFileSync(
    new URL('../content/release.json', import.meta.url),
    'utf8',
  );
  const { languages, varieties, courses, keymap, contentHash } =
    JSON.parse(raw);
  assert.equal(sha256(raw), node(raw));
  assert.equal(
    `sha256-${sha256(canonicalJson({ languages, varieties, courses, keymap }))}`,
    contentHash,
  );
});

test('fingerprint vectors: sha256 of the normalised text', () => {
  const { vectors } = JSON.parse(
    readFileSync(
      new URL('./fixtures/fingerprint-vectors.json', import.meta.url),
      'utf8',
    ),
  );
  for (const v of vectors) {
    assert.equal(sha256(v.normalised), v.sha256, v.name);
    assert.equal(sha256(v.normalised).slice(0, 16), v.fingerprint, v.name);
  }
});
