/**
 * The age question before sign-in (docs/platform.md 4.8, non-negotiable 8).
 *
 * We ask for the birth month and year only, never the day, and keep only
 * the band that follows from them: under 13 creates nothing at all; 13 and
 * over may sign in, and the band travels to the database in a 30-minute
 * cookie that the sign-in callback reads once and clears.
 *
 * Without the day, a birthday is counted from the LAST day of its month: on
 * 30 September 2026 someone born in September 2013 is 13, on the 29th they
 * are still 12. That errs towards the younger band at both thresholds,
 * which is the safe side for both.
 *
 * Pure: `today` is passed in, and read in the person's own time zone by the
 * caller (new Date()), since that is the date they know.
 */

export type AgeBand = '13-17' | '18+';
export type GateResult = 'under-13' | AgeBand;

/** The cookie holding the declared band between the age question and the callback. */
export const AGE_BAND_COOKIE = 'pl_age_band';
/** Thirty minutes, in seconds: long enough to fetch an email code. */
export const AGE_BAND_MAX_AGE = 30 * 60;
/** The oldest birth year the form accepts, as years before today. */
export const OLDEST_AGE = 120;

export function isAgeBand(value: unknown): value is AgeBand {
  return value === '13-17' || value === '18+';
}

/** Days in a month (1-12) of a year, leap years included. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole years of age on `today`, the birthday taken as the month's last day. */
export function ageOn(year: number, month: number, today: Date): number {
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  const birthday = daysInMonth(ty, month);
  const hadBirthday = tm > month || (tm === month && td >= birthday);
  return ty - year - (hadBirthday ? 0 : 1);
}

/**
 * The band for a birth month and year. A date in the future, or anything
 * that is not a whole year and month, is treated as under 13: the caller
 * checks birthProblem() first, and a mistake never lets anyone through.
 */
export function ageBandFor(
  year: number,
  month: number,
  today: Date,
): GateResult {
  if (birthProblem(year, month, today)) return 'under-13';
  const age = ageOn(year, month, today);
  if (age < 13) return 'under-13';
  if (age < 18) return '13-17';
  return '18+';
}

export type BirthProblem = 'incomplete' | 'future' | 'too-long-ago';

/** Why a birth month and year cannot be used, or null when they can. */
export function birthProblem(
  year: number,
  month: number,
  today: Date,
): BirthProblem | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    year < 1000 ||
    year > 9999
  )
    return 'incomplete';
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  if (year > ty || (year === ty && month > tm)) return 'future';
  if (year < ty - OLDEST_AGE) return 'too-long-ago';
  return null;
}

/** What to say about a problem, in the form's own words. */
export const BIRTH_PROBLEM_MESSAGES: Readonly<Record<BirthProblem, string>> = {
  incomplete: 'Choose the month and type the year you were born, like 1998.',
  future: 'That date hasn’t happened yet. Check the year.',
  'too-long-ago': 'That year looks a little too long ago. Check it.',
};

/** Reads a form's month and year fields as numbers (NaN when blank or odd). */
export function readBirth(
  month: string | null | undefined,
  year: string | null | undefined,
): { month: number; year: number } {
  const num = (value: string | null | undefined) =>
    /^\s*\d{1,4}\s*$/.test(value ?? '') ? Number(value) : Number.NaN;
  return { month: num(month), year: num(year) };
}

/**
 * The Set-Cookie attributes for the declared band: 30 minutes, the whole
 * site, first-party only, and Secure on https.
 */
export function ageBandCookie(band: AgeBand, secure: boolean): string {
  return [
    `${AGE_BAND_COOKIE}=${encodeURIComponent(band)}`,
    'Path=/',
    `Max-Age=${AGE_BAND_MAX_AGE}`,
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** The band in a cookie value (URL-encoded or not), or null. */
export function parseAgeBand(value: string | null | undefined): AgeBand | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  return isAgeBand(decoded) ? decoded : null;
}
