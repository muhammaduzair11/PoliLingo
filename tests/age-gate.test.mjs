// lib/age-gate.ts: the age question before sign-in. Only the birth month and
// year are asked, so a birthday counts from the last day of its month.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGE_BAND_COOKIE,
  AGE_BAND_MAX_AGE,
  ageBandCookie,
  ageBandFor,
  ageOn,
  birthProblem,
  isAgeBand,
  parseAgeBand,
  readBirth,
} from '../lib/age-gate.ts';

/** A local date at noon, so no time zone moves it. */
const day = (y, m, d) => new Date(y, m - 1, d, 12);

test('turning 13 today: the last day of the birth month', () => {
  // Born September 2013; September has 30 days.
  assert.equal(ageBandFor(2013, 9, day(2026, 9, 29)), 'under-13');
  assert.equal(ageBandFor(2013, 9, day(2026, 9, 30)), '13-17');
  assert.equal(ageBandFor(2013, 9, day(2026, 10, 1)), '13-17');
  assert.equal(ageBandFor(2013, 9, day(2026, 9, 1)), 'under-13');
  // Born in a month that ended last month.
  assert.equal(ageBandFor(2013, 8, day(2026, 9, 1)), '13-17');
  // A month that is still to come this year.
  assert.equal(ageBandFor(2013, 10, day(2026, 9, 30)), 'under-13');
});

test('turning 18 today', () => {
  assert.equal(ageBandFor(2008, 9, day(2026, 9, 29)), '13-17');
  assert.equal(ageBandFor(2008, 9, day(2026, 9, 30)), '18+');
  assert.equal(ageBandFor(2008, 12, day(2026, 12, 30)), '13-17');
  assert.equal(ageBandFor(2008, 12, day(2026, 12, 31)), '18+');
  assert.equal(ageBandFor(2008, 1, day(2026, 1, 31)), '18+');
  assert.equal(ageBandFor(2008, 1, day(2026, 1, 30)), '13-17');
  assert.equal(ageBandFor(1990, 6, day(2026, 9, 26)), '18+');
});

test('month edges: February in leap and common years, December into January', () => {
  // February 2026 has 28 days; February 2028 has 29.
  assert.equal(ageOn(2013, 2, day(2026, 2, 27)), 12);
  assert.equal(ageOn(2013, 2, day(2026, 2, 28)), 13);
  assert.equal(ageOn(2015, 2, day(2028, 2, 28)), 12);
  assert.equal(ageOn(2015, 2, day(2028, 2, 29)), 13);
  assert.equal(ageOn(2012, 12, day(2026, 1, 1)), 13);
  assert.equal(ageOn(2013, 12, day(2026, 12, 31)), 13);
  assert.equal(ageOn(2013, 1, day(2026, 1, 31)), 13);
  assert.equal(ageOn(2013, 1, day(2026, 1, 1)), 12);
});

test('future dates and nonsense are refused, and never let anyone through', () => {
  const today = day(2026, 9, 26);
  assert.equal(birthProblem(2026, 10, today), 'future');
  assert.equal(birthProblem(2027, 1, today), 'future');
  assert.equal(birthProblem(2026, 9, today), null);
  assert.equal(birthProblem(1906, 1, today), null);
  assert.equal(birthProblem(1905, 12, today), 'too-long-ago');
  for (const [y, m] of [
    [Number.NaN, 5],
    [1990, Number.NaN],
    [1990, 0],
    [1990, 13],
    [1990.5, 5],
    [90, 5],
    [19900, 5],
  ])
    assert.equal(birthProblem(y, m, today), 'incomplete', `${y}-${m}`);
  assert.equal(ageBandFor(2027, 1, today), 'under-13');
  assert.equal(ageBandFor(Number.NaN, 1, today), 'under-13');
  assert.equal(ageBandFor(1800, 1, today), 'under-13');
});

test('reading the form', () => {
  assert.deepEqual(readBirth('9', '2008'), { month: 9, year: 2008 });
  assert.deepEqual(readBirth(' 12 ', '1990 '), { month: 12, year: 1990 });
  for (const [m, y] of [
    ['', '2008'],
    ['9', ''],
    ['9', '20o8'],
    ['9', '2008.5'],
    [null, undefined],
    ['9', '-2008'],
  ]) {
    const { month, year } = readBirth(m, y);
    assert.ok(Number.isNaN(month) || Number.isNaN(year), `${m} ${y}`);
  }
});

test('the band cookie: 30 minutes, whole site, first-party, Secure on https', () => {
  assert.equal(AGE_BAND_COOKIE, 'pl_age_band');
  assert.equal(AGE_BAND_MAX_AGE, 1800);
  assert.equal(
    ageBandCookie('18+', true),
    'pl_age_band=18%2B; Path=/; Max-Age=1800; SameSite=Lax; Secure',
  );
  assert.equal(
    ageBandCookie('13-17', false),
    'pl_age_band=13-17; Path=/; Max-Age=1800; SameSite=Lax',
  );
  assert.equal(parseAgeBand('18%2B'), '18+');
  assert.equal(parseAgeBand('18+'), '18+');
  assert.equal(parseAgeBand('13-17'), '13-17');
  for (const bad of [null, '', 'under-13', '%E0%A4%A', '12', '18'])
    assert.equal(parseAgeBand(bad), null, String(bad));
  assert.equal(isAgeBand('18+'), true);
  assert.equal(isAgeBand('under-13'), false);
});
