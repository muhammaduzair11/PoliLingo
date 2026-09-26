// lib/console/invite-link.ts: the one-time invitation link, its WhatsApp
// share, what an invitation says, and the dates on the people page.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPIRY_CHOICES,
  consoleHomeFor,
  endOfRoleTimestamp,
  endRoleRefusal,
  formatDay,
  grantWindowLabel,
  inviteHeadline,
  inviteMessage,
  inviteRefusal,
  inviteUrl,
  isInviteRole,
  isInviteToken,
  latestEndDate,
  roleDuties,
  roleLabel,
  scopeLabel,
  tomorrowUtc,
  whatsAppShareUrl,
} from '../lib/console/invite-link.ts';
import { ERROR_SENTENCES } from '../lib/db-errors.ts';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const PATH = `/invite/${TOKEN}`;
const REVIEWER = {
  role: 'language_reviewer',
  language_name: 'Pashto',
  variety_name: 'Northern Pashto (Peshawar / Yusufzai)',
};

test('a token is 43 base64url characters', () => {
  assert.equal(TOKEN.length, 43);
  assert.equal(isInviteToken(TOKEN), true);
  for (const bad of [
    '',
    TOKEN.slice(1),
    `${TOKEN}A`,
    `${TOKEN.slice(1)}=`,
    `${TOKEN.slice(1)}+`,
    `${TOKEN.slice(1)}/`,
    null,
    undefined,
    43,
  ])
    assert.equal(isInviteToken(bad), false, String(bad));
});

test('the full link joins the returned path to the site origin', () => {
  assert.equal(
    inviteUrl(PATH, 'https://polilingo.app'),
    `https://polilingo.app${PATH}`,
  );
  assert.equal(
    inviteUrl(PATH, 'https://polilingo.app/admin/people?x=1'),
    `https://polilingo.app${PATH}`,
  );
  assert.equal(
    inviteUrl(PATH, 'http://localhost:3000'),
    `http://localhost:3000${PATH}`,
  );
});

test('anything but an invitation path on a web origin gives no link', () => {
  for (const [path, origin] of [
    ['/invite/short', 'https://polilingo.app'],
    [`//evil.example${PATH}`, 'https://polilingo.app'],
    [`https://evil.example${PATH}`, 'https://polilingo.app'],
    [`/admin/${TOKEN}`, 'https://polilingo.app'],
    [PATH, 'javascript:alert(1)'],
    [PATH, 'not a url'],
    [PATH, ''],
  ])
    assert.equal(inviteUrl(path, origin), null, `${path} on ${origin}`);
});

test('the WhatsApp link carries the whole message, encoded', () => {
  const message =
    'Salaam Amina!\n\nOpen: https://polilingo.app/invite/x?a=1&b=2';
  const url = whatsAppShareUrl(message);
  assert.ok(url.startsWith('https://wa.me/?text='));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('text'), message);
  assert.equal(url.includes('&b=2'), false, 'the & inside is encoded');
  assert.equal(url.includes('\n'), false);
});

test('the message greets by first name, names the scope, the link and the expiry', () => {
  const url = `https://polilingo.app${PATH}`;
  const message = inviteMessage({
    ...REVIEWER,
    url,
    name: '  Amina  Khan ',
    email: 'amina.k@example.org',
    expiresAt: '2026-10-05T09:30:00Z',
  });
  assert.match(message, /^Salaam Amina! /);
  assert.match(message, /sign in with amina\.k@example\.org to join/);
  assert.match(
    message,
    /to review Northern Pashto \(Peshawar \/ Yusufzai\) on PoliLingo\./,
  );
  assert.match(message, /works once and expires on 5 Oct 2026/);
  assert.ok(message.endsWith(url));

  const plain = inviteMessage({
    role: 'editor',
    language_name: null,
    url,
    expiresAt: '2026-10-05T00:00:00Z',
  });
  assert.match(
    plain,
    /^Salaam! You're invited to write lessons on PoliLingo\./,
  );
  assert.match(plain, /sign in with the email address this was sent to/);
  assert.match(
    inviteMessage({ role: 'admin', url, expiresAt: 'soon' }),
    /help run PoliLingo\.[\s\S]*works once:/,
  );
});

test('roles and scopes read as words', () => {
  assert.equal(roleLabel('language_reviewer'), 'Reviewer');
  assert.equal(roleLabel('editor'), 'Editor');
  assert.equal(roleLabel('admin'), 'Admin');
  assert.equal(roleLabel('owner'), 'Team member');
  assert.equal(isInviteRole('editor'), true);
  assert.equal(isInviteRole('learner'), false);
  assert.equal(scopeLabel(REVIEWER), 'Northern Pashto (Peshawar / Yusufzai)');
  assert.equal(
    scopeLabel({ role: 'editor', language_name: 'Pashto' }),
    'Pashto',
  );
  assert.equal(scopeLabel({ role: 'editor' }), 'Every language');
  assert.equal(scopeLabel({ role: 'admin' }), 'The whole workspace');
});

test('the invitation headline says what the person is invited to do', () => {
  assert.equal(
    inviteHeadline(REVIEWER),
    "You're invited to review Northern Pashto (Peshawar / Yusufzai)",
  );
  assert.equal(
    inviteHeadline({ role: 'editor', language_name: 'Pashto' }),
    "You're invited to write Pashto lessons",
  );
  assert.equal(
    inviteHeadline({ role: 'editor' }),
    "You're invited to write lessons for PoliLingo",
  );
  assert.equal(
    inviteHeadline({ role: 'admin' }),
    "You're invited to help run PoliLingo",
  );
  for (const scope of [REVIEWER, { role: 'editor' }, { role: 'admin' }])
    assert.equal(roleDuties(scope).length, 3);
});

test('each role lands in its own part of the workspace', () => {
  assert.equal(consoleHomeFor('language_reviewer'), '/review');
  assert.equal(consoleHomeFor('editor'), '/edit');
  assert.equal(consoleHomeFor('admin'), '/admin');
});

test('every refusal the invitation page can meet has a title, a reason and a next step', () => {
  for (const code of [
    'PL401_NOT_SIGNED_IN',
    'PL404_INVITATION_NOT_FOUND',
    'PL410_INVITATION_REVOKED',
    'PL410_INVITATION_EXPIRED',
    'PL410_INVITATION_USED',
    'PL403_EMAIL_UNVERIFIED',
    'PL403_WRONG_EMAIL',
    'PL403_NO_PROFILE',
    'PL403_UNDER_18',
    'PL409_ROLE_CONFLICT',
    'PL409_ALREADY_HAS_ROLE',
  ]) {
    assert.ok(Object.hasOwn(ERROR_SENTENCES, code), `${code} is catalogued`);
    const refusal = inviteRefusal(code);
    assert.ok(refusal, code);
    for (const part of [refusal.title, refusal.message, refusal.next])
      assert.ok(part.length > 10 && !/PL\d{3}/.test(part), code);
  }
  assert.equal(
    inviteRefusal('PL403_WRONG_EMAIL').next,
    'Sign in with the address the invitation was sent to.',
  );
  assert.equal(inviteRefusal('PL500_BUILD_BUG'), null);
  assert.equal(inviteRefusal('toString'), null);
});

test('dates are shown as a UTC day', () => {
  assert.equal(formatDay('2026-10-05T00:00:00Z'), '5 Oct 2026');
  assert.equal(formatDay('2026-10-04T23:59:59Z'), '4 Oct 2026');
  assert.equal(formatDay(new Date('2026-09-28T12:00:00Z')), '28 Sep 2026');
  assert.equal(formatDay(null), '');
  assert.equal(formatDay('not a date'), '');
});

test('a grant says since when, until when, or when it ended', () => {
  const starts_at = '2026-09-02T08:00:00Z';
  assert.equal(
    grantWindowLabel({ starts_at, ends_at: null, state: 'active' }),
    'Since 2 Sep 2026',
  );
  assert.equal(
    grantWindowLabel({
      starts_at,
      ends_at: '2026-10-05T00:00:00Z',
      state: 'ending',
    }),
    'Until 5 Oct 2026',
  );
  assert.equal(
    grantWindowLabel({
      starts_at,
      ends_at: '2026-09-20T10:00:00Z',
      state: 'ended',
    }),
    'Ended 20 Sep 2026',
  );
  assert.equal(
    grantWindowLabel({
      starts_at: '2026-10-09T00:00:00Z',
      ends_at: null,
      state: 'scheduled',
    }),
    'Starts 9 Oct 2026',
  );
});

test('a role can end from tomorrow (UTC), at the start of the chosen day', () => {
  const now = new Date('2026-09-28T22:30:00Z');
  assert.equal(tomorrowUtc(now), '2026-09-29');
  assert.equal(tomorrowUtc(new Date('2026-12-31T01:00:00Z')), '2027-01-01');
  assert.equal(
    endOfRoleTimestamp('2026-09-29', now),
    '2026-09-29T00:00:00.000Z',
  );
  assert.equal(
    endOfRoleTimestamp('2027-02-01', now),
    '2027-02-01T00:00:00.000Z',
  );
  for (const bad of [
    '2026-09-28',
    '2026-09-01',
    '2026-02-30',
    '2026-9-29',
    '',
    null,
    '2026-09-29T00:00:00Z',
  ])
    assert.equal(endOfRoleTimestamp(bad, now), null, String(bad));
});

test('expiry choices stay inside what create_invitation accepts', () => {
  assert.ok(EXPIRY_CHOICES.includes(7));
  assert.ok(
    EXPIRY_CHOICES.every((d) => Number.isInteger(d) && d >= 1 && d <= 30),
  );
});

test('ending a role offers no day later than its current end', () => {
  assert.equal(latestEndDate(null), null);
  assert.equal(latestEndDate('2026-10-05T00:00:00Z'), '2026-10-05');
  // A mid-day end: that day's start is still not later than it.
  assert.equal(latestEndDate('2026-10-05T17:30:00Z'), '2026-10-05');
  assert.equal(latestEndDate('not a date'), null);
  const at = endOfRoleTimestamp(
    latestEndDate('2026-10-05T17:30:00Z'),
    new Date('2026-09-28T09:00:00Z'),
  );
  assert.ok(at && at <= '2026-10-05T17:30:00.000Z');
});

test("the End role dialog's own sentences for a last admin and a later date", () => {
  assert.match(
    endRoleRefusal({ code: 'PL409_LAST_ADMIN' }) ?? '',
    /workspace would be left without an admin/,
  );
  assert.doesNotMatch(
    endRoleRefusal({ code: 'PL409_LAST_ADMIN' }) ?? '',
    /You're the last admin/,
  );
  assert.equal(
    endRoleRefusal({
      code: 'PL422_BAD_DATE',
      detail: { grant_id: 'g', ends_at: '2026-10-05T00:00:00+00:00' },
    }),
    'This role already ends on 5 Oct 2026. Choose that day or an earlier one, or end it now.',
  );
  // A past date has no end date in its detail: the catalogue sentence stands.
  assert.equal(
    endRoleRefusal({ code: 'PL422_BAD_DATE', detail: { grant_id: 'g' } }),
    null,
  );
  assert.equal(endRoleRefusal({ code: 'PL409_ALREADY_ENDED' }), null);
});
