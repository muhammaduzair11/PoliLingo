// lib/safe-next.ts: after sign-in, only a path on this site is followed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NEXT, safeNext, signInHref } from '../lib/safe-next.ts';

test('same-site paths are kept, with their query and hash', () => {
  for (const [input, expected] of [
    ['/learn/pashto?x', '/learn/pashto?x'],
    ['/learn/pashto?from=lesson&x=1', '/learn/pashto?from=lesson&x=1'],
    ['/account', '/account'],
    ['/review/item/ps-itm-7f3a91', '/review/item/ps-itm-7f3a91'],
    ['/invite/abc_DEF-123', '/invite/abc_DEF-123'],
    ['/settings#account', '/settings#account'],
    ['/', '/'],
    ['/learn/./pashto', '/learn/pashto'],
    ['/%2F%2Fexample.com', '/%2F%2Fexample.com'],
  ])
    assert.equal(safeNext(input), expected, input);
});

test('anything that could leave the site falls back', () => {
  for (const input of [
    '',
    null,
    undefined,
    '//x',
    '//evil.example/path',
    '/\\x',
    '/\\evil.example',
    '\\\\evil.example',
    '/a\\b',
    'http://evil.example',
    'https://evil.example/learn',
    'http:/evil.example',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,hi',
    'learn/pashto',
    ' /learn',
    '/\t/evil.example',
    '/\n/evil.example',
    '/learn\r\n',
    '/ /evil.example',
    '/a/../..//evil.example',
    '/..//evil.example',
    '/' + 'a'.repeat(2001),
  ])
    assert.equal(safeNext(input), DEFAULT_NEXT, JSON.stringify(input));
});

test('sign-in and auth paths fall back, so nobody loops', () => {
  for (const input of [
    '/sign-in',
    '/sign-in?next=/learn',
    '/auth/callback?code=x',
    '/auth/confirm',
  ])
    assert.equal(safeNext(input), DEFAULT_NEXT, input);
  assert.equal(safeNext('/sign-in-help'), '/sign-in-help');
});

test('a fallback of your own', () => {
  assert.equal(safeNext('//x', '/account'), '/account');
  assert.equal(safeNext(null, ''), '');
  assert.equal(safeNext(42), DEFAULT_NEXT);
});

test('signInHref carries a safe next and drops an unsafe one', () => {
  assert.equal(signInHref('/learn/pashto'), '/sign-in?next=%2Flearn%2Fpashto');
  assert.equal(signInHref('//evil.example'), '/sign-in');
  assert.equal(signInHref(null), '/sign-in');
});
