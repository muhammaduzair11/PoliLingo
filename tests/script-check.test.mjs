// lib/script-check.ts: the text rules the console runs as someone types.
// The cases here are the parity contract with the database's
// private.native_problems() (docs/platform.md 3.5): the same input must give
// the same codes, characters and 1-based positions there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkNative,
  checkPhrase,
  checkRomanisation,
  isStorable,
  normaliseNative,
  orthographyLanguages,
  textFingerprint,
} from '../lib/script-check.ts';

const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const codes = (issues) =>
  issues.map((i) => [i.code, i.char, i.position, i.severity]);

test('clean Pashto and Urdu pass', () => {
  assert.deepEqual(checkNative('ps', 'ستړي مه شې'), []);
  assert.deepEqual(checkNative('ps', 'ښه راغلاست!'), []);
  assert.deepEqual(checkNative('ur', 'آپ کیسے ہیں'), []);
  assert.deepEqual(checkNative('hno', 'تساں کیسے او'), []);
  assert.deepEqual(checkRomanisation('Stəṛay ma she'), []);
  assert.deepEqual(checkPhrase('ur', 'شکریہ', 'Shukriya'), []);
});

test('invisible characters, each with its first position', () => {
  const cases = [
    [0x200e, 'ل‎س'],
    [0x200f, '‏سلام'],
    [0x202a, 'س‪'],
    [0x202b, 'س‫'],
    [0x202c, 'س‬'],
    [0x202d, 'س‭'],
    [0x202e, 'س‮'],
    [0x200b, 'س​'],
    [0x00a0, 'س س'],
    [0xfeff, 'س﻿'],
  ];
  for (const [cp, text] of cases) {
    const issues = checkNative('ps', text);
    const at = Array.from(text).findIndex((c) => c.codePointAt(0) === cp) + 1;
    assert.deepEqual(
      codes(issues),
      [['PL422_INVISIBLE_CHAR', String.fromCodePoint(cp), at, 'error']],
      `U+${cp.toString(16)}`,
    );
    assert.match(issues[0].message, new RegExp(`position ${at}`));
  }
});

test('a repeated character is reported once, at its first position', () => {
  assert.deepEqual(codes(checkNative('ps', 'سس‏ل‏م')), [
    ['PL422_INVISIBLE_CHAR', '‏', 3, 'error'],
  ]);
});

test('smart quotes and Arabic-Indic digits have their own codes', () => {
  assert.deepEqual(codes(checkNative('ur', '“سلام”')), [
    ['PL422_SMART_QUOTE', '“', 1, 'error'],
    ['PL422_SMART_QUOTE', '”', 6, 'error'],
  ]);
  assert.deepEqual(codes(checkNative('ur', 'س‘')), [
    ['PL422_SMART_QUOTE', '‘', 2, 'error'],
  ]);
  assert.deepEqual(codes(checkNative('ps', 'سل ۳ ٣')), [
    ['PL422_ARABIC_DIGIT', '۳', 4, 'error'],
    ['PL422_ARABIC_DIGIT', '٣', 6, 'error'],
  ]);
});

test('characters outside the language list, with a fix when there is one', () => {
  // Arabic kaf (U+0643) is not Pashto's or Urdu's; keheh (U+06A9) is.
  const [kaf] = checkNative('ur', 'كتاب');
  assert.equal(kaf.code, 'PL422_CHAR_NOT_ALLOWED');
  assert.equal(kaf.char, 'ك');
  assert.equal(kaf.position, 1);
  assert.match(kaf.message, /U\+0643/);
  assert.match(kaf.message, /U\+06A9/);
  // Pashto letters are not Urdu's.
  assert.deepEqual(codes(checkNative('ur', 'ښا')), [
    ['PL422_CHAR_NOT_ALLOWED', 'ښ', 1, 'error'],
  ]);
  // A question mark: Urdu's ؟ is allowed, ASCII ? is not.
  assert.deepEqual(codes(checkNative('ur', 'کیا?')), [
    ['PL422_CHAR_NOT_ALLOWED', '?', 4, 'error'],
  ]);
});

test('Latin letters in native text: not allowed, plus a warning saying why', () => {
  assert.deepEqual(codes(checkNative('ps', 'سلام Salaam')), [
    ['PL422_CHAR_NOT_ALLOWED', 'S', 6, 'error'],
    ['PL422_CHAR_NOT_ALLOWED', 'a', 7, 'error'],
    ['PL422_CHAR_NOT_ALLOWED', 'l', 8, 'error'],
    ['PL422_CHAR_NOT_ALLOWED', 'm', 11, 'error'],
    ['LATIN_IN_NATIVE', 'S', 6, 'warning'],
  ]);
});

test('Hindko uses Urdu’s list exactly, as the content validator does', () => {
  const ur = read('../lib/orthography/ur.json');
  const hno = read('../lib/orthography/hno.json');
  assert.deepEqual(hno.codepoints, ur.codepoints);
  assert.deepEqual(orthographyLanguages.sort(), ['hno', 'ps', 'ur']);
  for (const lang of ['ps', 'ur', 'hno']) {
    const { codepoints } = read(`../lib/orthography/${lang}.json`);
    assert.deepEqual(
      codepoints,
      [...codepoints].sort((a, b) => a - b),
    );
    assert.equal(new Set(codepoints).size, codepoints.length);
    assert.ok(codepoints.includes(0x20), `${lang} allows a space`);
  }
});

test('the flattened lists match the content repository when it is checked out', (t) => {
  let source;
  try {
    source = (name) =>
      JSON.parse(
        readFileSync(
          new URL(`../../content/schemas/orthography/${name}`, import.meta.url),
          'utf8',
        ),
      );
    source('ps.allowlist.json');
  } catch {
    t.skip('the content repository is not next to this one');
    return;
  }
  const flat = (spec) =>
    [...new Set(spec.allowed.map((a) => parseInt(a.cp, 16)))].sort(
      (a, b) => a - b,
    );
  assert.deepEqual(
    read('../lib/orthography/ps.json').codepoints,
    flat(source('ps.allowlist.json')),
  );
  const ur = source('ur.allowlist.json');
  assert.deepEqual(read('../lib/orthography/ur.json').codepoints, flat(ur));
  const hno = source('hno.allowlist.json');
  assert.equal(hno.extends, 'ur.allowlist.json');
  assert.deepEqual(
    read('../lib/orthography/hno.json').codepoints,
    flat({ allowed: [...ur.allowed, ...(hno.additional_allowed ?? [])] }),
  );
});

test('a language without a list skips only that check', () => {
  assert.deepEqual(checkNative('xx', 'anything goes'), [
    {
      code: 'LATIN_IN_NATIVE',
      severity: 'warning',
      field: 'native',
      message: checkNative('xx', 'anything goes')[0].message,
      char: 'a',
      position: 1,
    },
  ]);
  assert.deepEqual(
    codes(checkNative('xx', 'x‏y')).map((c) => c[0]),
    ['PL422_INVISIBLE_CHAR', 'LATIN_IN_NATIVE'],
  );
});

test('romanisation: no native script, and some Latin', () => {
  assert.deepEqual(codes(checkRomanisation('Salaam سلام')), [
    ['PL422_ROMANISATION_SCRIPT', 'س', 8, 'error'],
  ]);
  assert.deepEqual(codes(checkRomanisation('سلام')), [
    ['PL422_ROMANISATION_SCRIPT', 'س', 1, 'error'],
    ['PL422_ROMANISATION_NO_LATIN', null, null, 'error'],
  ]);
  assert.deepEqual(codes(checkRomanisation('123 !')), [
    ['PL422_ROMANISATION_NO_LATIN', null, null, 'error'],
  ]);
  // Arabic Supplement (U+0750-U+077F) counts as native script too.
  assert.equal(
    checkRomanisation('Salaam ݐ')[0].code,
    'PL422_ROMANISATION_SCRIPT',
  );
  // Diacritics and IPA-ish letters are fine as long as there is Latin.
  assert.deepEqual(checkRomanisation('Stəṛay ma she'), []);
});

test('positions count code points, as Postgres counts characters', () => {
  // The emoji is two UTF-16 units but one character.
  assert.deepEqual(codes(checkNative('ps', '🦜س‏')).slice(-1), [
    ['PL422_INVISIBLE_CHAR', '‏', 3, 'error'],
  ]);
});

test('normalising first, as the database does, removes what it would fix', () => {
  const raw = '  سلام \tورور ﻿';
  assert.equal(normaliseNative(raw), 'سلام ورور');
  assert.deepEqual(checkNative('ps', normaliseNative(raw)), []);
  assert.deepEqual(
    checkNative('ps', raw).map((i) => i.code),
    ['PL422_INVISIBLE_CHAR', 'PL422_CHAR_NOT_ALLOWED', 'PL422_INVISIBLE_CHAR'],
  );
  // Invisible marks that are not whitespace survive normalising.
  assert.equal(
    checkNative('ps', normaliseNative('‏سلام'))[0].code,
    'PL422_INVISIBLE_CHAR',
  );
});

test('normaliseNative and textFingerprint match the shared vectors', () => {
  const { vectors } = read('./fixtures/fingerprint-vectors.json');
  assert.ok(vectors.length >= 20);
  for (const v of vectors) {
    assert.equal(normaliseNative(v.text), v.normalised, v.name);
    assert.equal(textFingerprint(v.text), v.fingerprint, v.name);
  }
});

test('warnings alone still let an item be stored', () => {
  assert.equal(isStorable([]), true);
  assert.equal(isStorable(checkNative('xx', 'abc')), true);
  assert.equal(isStorable(checkNative('ps', 'abc')), false);
});
