// lib/safe-next.ts: after sign-in, only a path on this site is followed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NEXT,
  EMAIL_LINK_COOKIE,
  SIGN_IN_WORDS,
  emailLinkCookie,
  emailLinkMatches,
  emailLinkNonce,
  emailLinkRedirect,
  newEmailLinkNonce,
  readEmailLinkCookie,
  emailLinkToken,
  emailLinkType,
  isSameOriginPost,
  learnerBack,
  safeNext,
  signInAudience,
  signInHref,
  stepEyebrow,
  withSignedIn,
} from '../lib/safe-next.ts';

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

test('the way back only goes to learner pages, and says where', () => {
  for (const [input, href, label] of [
    ['/learn/pashto?x', '/learn/pashto?x', 'Back to your map'],
    ['/learn', '/learn', 'Back to your map'],
    ['/lesson/ps-lsn-aaaaaa', '/lesson/ps-lsn-aaaaaa', 'Back to your lesson'],
    ['/settings', '/settings', 'Back to settings'],
    ['/settings#account', '/settings#account', 'Back to settings'],
    ['/onboarding', '/onboarding', 'Back to PoliLingo'],
    ['/', '/', 'Back to PoliLingo'],
    ['/admin', '/', 'Back to PoliLingo'],
    ['/review/item/x', '/', 'Back to PoliLingo'],
    ['/invite/abc_DEF-123', '/', 'Back to PoliLingo'],
    ['/account', DEFAULT_NEXT, 'Back to your map'],
    ['/learner', DEFAULT_NEXT, 'Back to your map'],
    ['/settingsx', DEFAULT_NEXT, 'Back to your map'],
    // A next that came back from a callback still flagged.
    ['/learn?signed_in=1', '/learn', 'Back to your map'],
    ['/settings?x=1&signed_in=1#a', '/settings?x=1#a', 'Back to settings'],
  ])
    assert.deepEqual(learnerBack(input), { href, label }, input);
});

test('withSignedIn flags next once, keeping its query and hash', () => {
  assert.equal(withSignedIn('/settings'), '/settings?signed_in=1');
  assert.equal(
    withSignedIn('/learn/pashto?from=lesson#top'),
    '/learn/pashto?from=lesson&signed_in=1#top',
  );
  assert.equal(
    withSignedIn(withSignedIn('/settings')),
    '/settings?signed_in=1',
  );
  // Still a path safeNext keeps, so the callbacks follow it.
  assert.equal(
    safeNext(withSignedIn('/learn/pashto')),
    '/learn/pashto?signed_in=1',
  );
});

test('the eyebrow counts three steps', () => {
  assert.equal(
    stepEyebrow(SIGN_IN_WORDS.learner.eyebrow, 1),
    'SAVE YOUR PROGRESS · STEP 1 OF 3',
  );
  assert.equal(
    stepEyebrow(SIGN_IN_WORDS.workspace.eyebrow, 3),
    'SIGN IN TO THE WORKSPACE · STEP 3 OF 3',
  );
});

test('the sign-in words follow where next leads', () => {
  for (const [input, expected] of [
    ['/invite/abc_DEF-123', 'invite'],
    ['/admin', 'workspace'],
    ['/admin/people', 'workspace'],
    ['/edit/lesson/ps-lsn-aaaaaa', 'workspace'],
    ['/review?x=1', 'workspace'],
    ['/review#top', 'workspace'],
    ['/learn', 'learner'],
    ['/lesson/ps-lsn-aaaaaa', 'learner'],
    ['/account', 'learner'],
    ['/invite', 'learner'],
    ['/reviewers', 'learner'],
    ['/editor', 'learner'],
    [DEFAULT_NEXT, 'learner'],
  ])
    assert.equal(signInAudience(input), expected, input);
  assert.equal(SIGN_IN_WORDS.invite.title, 'Accept your invitation');
  assert.equal(SIGN_IN_WORDS.workspace.eyebrow, 'SIGN IN TO THE WORKSPACE');
  assert.equal(SIGN_IN_WORDS.learner.eyebrow, 'SAVE YOUR PROGRESS');
  // Only a learner is told about progress on this device.
  for (const audience of ['invite', 'workspace']) {
    assert.doesNotMatch(SIGN_IN_WORDS[audience].lead, /progress/);
    assert.doesNotMatch(SIGN_IN_WORDS[audience].ageLead, /progress|learn/i);
    assert.doesNotMatch(SIGN_IN_WORDS[audience].hello, /lesson|streak|XP/);
  }
  assert.match(SIGN_IN_WORDS.learner.lead, /progress/);
  assert.match(SIGN_IN_WORDS.learner.ageLead, /only your age band/);
  // Curly apostrophes only, in every sentence shown.
  for (const words of Object.values(SIGN_IN_WORDS))
    for (const sentence of Object.values(words))
      assert.doesNotMatch(sentence, /'/, sentence);
});

test('email link types and token hashes: only what the email can carry', () => {
  for (const type of ['email', 'magiclink', 'signup'])
    assert.equal(emailLinkType(type), type);
  for (const type of ['recovery', 'invite', '', null, undefined, 3])
    assert.equal(emailLinkType(type), null, String(type));

  const hex = 'a'.repeat(56);
  assert.equal(emailLinkToken(hex), hex);
  assert.equal(emailLinkToken(`pkce_${hex}`), `pkce_${hex}`);
  for (const bad of [
    '',
    null,
    undefined,
    'short',
    'a'.repeat(201),
    `${hex}&next=//evil`,
    `${hex} `,
    `${hex}/`,
  ])
    assert.equal(emailLinkToken(bad), null, String(bad));
});

test('an email link works only in the browser that asked for the code', () => {
  const mine = newEmailLinkNonce();
  assert.match(mine, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(newEmailLinkNonce(), mine);
  assert.equal(emailLinkNonce(mine), mine);
  for (const bad of ['', null, undefined, 'short', `${mine}&x`, 'a'.repeat(65)])
    assert.equal(emailLinkNonce(bad), null, String(bad));

  // The cookie this browser sets, read back as document.cookie shows it.
  const cookie = emailLinkCookie(mine, true);
  assert.equal(
    cookie,
    `${EMAIL_LINK_COOKIE}=${mine}; Path=/; Max-Age=3600; SameSite=Lax; Secure`,
  );
  assert.equal(
    readEmailLinkCookie(`pl_age_band=18%2B; ${EMAIL_LINK_COOKIE}=${mine}`),
    mine,
  );
  assert.equal(readEmailLinkCookie('pl_age_band=18%2B'), null);
  assert.equal(readEmailLinkCookie(`${EMAIL_LINK_COOKIE}=`), null);

  // The link carries the same value after next.
  assert.equal(
    emailLinkRedirect('https://polilingo.app', '/learn/pashto', mine),
    `https://polilingo.app/auth/confirm?next=%2Flearn%2Fpashto&n=${mine}`,
  );

  // Someone else's link (their value, or none) in this browser: refused.
  assert.equal(emailLinkMatches(mine, mine), true);
  assert.equal(emailLinkMatches(mine, newEmailLinkNonce()), false);
  assert.equal(emailLinkMatches(undefined, mine), false);
  assert.equal(emailLinkMatches(mine, null), false);
  assert.equal(emailLinkMatches(undefined, undefined), false);
  assert.equal(emailLinkMatches('', ''), false);
});

test('a sign-in POST must come from this site', () => {
  const host = 'polilingo.app';
  const ok = (origin, secFetchSite, h = host) =>
    isSameOriginPost({ origin, secFetchSite, host: h });
  assert.equal(ok('https://polilingo.app', 'same-origin'), true);
  assert.equal(ok('https://polilingo.app', null), true);
  assert.equal(ok(null, 'same-origin'), true);
  assert.equal(ok('http://localhost:3000', null, 'localhost:3000'), true);
  assert.equal(ok('https://POLILINGO.app', null, 'Polilingo.App'), true);

  assert.equal(ok('https://evil.example', 'cross-site'), false);
  assert.equal(ok('https://evil.example', null), false);
  assert.equal(ok('https://polilingo.app.evil.example', null), false);
  assert.equal(ok('https://polilingo.app', 'cross-site'), false);
  assert.equal(ok('https://polilingo.app', 'same-site'), false);
  assert.equal(ok('null', null), false);
  assert.equal(ok(null, null), false);
  assert.equal(ok(null, 'none'), false);
  assert.equal(ok('https://polilingo.app', null, null), false);
  assert.equal(ok('not a url', null), false);
});
