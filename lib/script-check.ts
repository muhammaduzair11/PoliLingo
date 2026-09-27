/**
 * The text rules for a phrase's native text and romanisation, run live in
 * the console while someone types (components/console/script-field.tsx).
 *
 * They are the same checks the database makes before it stores an item,
 * private.native_problems() (docs/platform.md 3.5), and the content
 * repository's validator made before that (scripts/validate.mjs, V001-V006):
 *
 *   native text
 *     PL422_INVISIBLE_CHAR       U+200E U+200F U+202A-U+202E U+200B U+00A0 U+FEFF
 *     PL422_SMART_QUOTE          ‘ ’ “ ”
 *     PL422_ARABIC_DIGIT         U+0660-U+0669, U+06F0-U+06F9
 *     PL422_CHAR_NOT_ALLOWED     anything else outside the language's list
 *     LATIN_IN_NATIVE (warning)  any A-Z or a-z
 *   romanisation
 *     PL422_ROMANISATION_SCRIPT  any Arabic-script letter (U+0600-U+06FF, U+0750-U+077F)
 *     PL422_ROMANISATION_NO_LATIN no A-Z or a-z at all
 *
 * Each problem names the character and its 1-based position, counted in
 * code points as Postgres counts characters, and is reported once per
 * distinct character, at its first position. A character with a rule of its
 * own is not reported again as not allowed. A Latin letter is not in any
 * list, so it is an error (not allowed) and also gets the warning, which
 * says what probably happened.
 *
 * The database normalises native text before it checks it (normaliseNative:
 * NFC, trimmed, whitespace runs to one space, as the content repository's
 * normalise() does), so a no-break space never reaches the check there. Run
 * the check on normaliseNative(text) to see exactly what the database would
 * refuse; run it on the raw text to catch the paste as it happens.
 */
import ps from './orthography/ps.json' with { type: 'json' };
import ur from './orthography/ur.json' with { type: 'json' };
import hno from './orthography/hno.json' with { type: 'json' };
import { sha256 } from './sha256.ts';

export type ScriptIssueCode =
  | 'PL422_INVISIBLE_CHAR'
  | 'PL422_SMART_QUOTE'
  | 'PL422_ARABIC_DIGIT'
  | 'PL422_CHAR_NOT_ALLOWED'
  | 'PL422_ROMANISATION_SCRIPT'
  | 'PL422_ROMANISATION_NO_LATIN'
  | 'LATIN_IN_NATIVE';

export type ScriptIssue = {
  code: ScriptIssueCode;
  severity: 'error' | 'warning';
  field: 'native' | 'romanisation';
  message: string;
  /** The character, or null when the problem is not one character. */
  char: string | null;
  /** 1-based, in code points; null with `char`. */
  position: number | null;
};

type Orthography = {
  language: string;
  name: string;
  codepoints: number[];
  hints: { from: number; to: number; note: string }[];
};

const ORTHOGRAPHIES = new Map<
  string,
  { spec: Orthography; allowed: Set<number> }
>(
  [ps, ur, hno].map((spec: Orthography) => [
    spec.language,
    { spec, allowed: new Set(spec.codepoints) },
  ]),
);

/** The languages with a character list. Others skip that one check. */
export const orthographyLanguages = [...ORTHOGRAPHIES.keys()];

export const INVISIBLE_CHARS: ReadonlyMap<number, string> = new Map([
  [0x200e, 'left-to-right mark'],
  [0x200f, 'right-to-left mark'],
  [0x202a, 'left-to-right embedding'],
  [0x202b, 'right-to-left embedding'],
  [0x202c, 'pop directional formatting mark'],
  [0x202d, 'left-to-right override'],
  [0x202e, 'right-to-left override'],
  [0x200b, 'zero-width space'],
  [0x00a0, 'no-break space'],
  [0xfeff, 'zero-width no-break space'],
]);
const SMART_QUOTES = new Set([0x2018, 0x2019, 0x201c, 0x201d]);
const isArabicDigit = (cp: number) =>
  (cp >= 0x0660 && cp <= 0x0669) || (cp >= 0x06f0 && cp <= 0x06f9);
const isArabicScript = (cp: number) =>
  (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f);
const isLatinLetter = (cp: number) =>
  (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);

/** "U+06A9" */
export function codepointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * The content repository's normalise(): NFC, trimmed, and every run of
 * whitespace (JavaScript's \s, which includes the no-break space) made one
 * ordinary space. The database's private.normalise_native() is the same.
 */
export function normaliseNative(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** The first 16 hex digits of SHA-256 over the normalised text: an item's text_fingerprint. */
export function textFingerprint(text: string): string {
  return sha256(normaliseNative(text)).slice(0, 16);
}

/** Each distinct code point in `text` with its first 1-based position. */
function firstPositions(text: string): Map<number, number> {
  const seen = new Map<number, number>();
  let position = 0;
  for (const ch of text) {
    position++;
    const cp = ch.codePointAt(0) as number;
    if (!seen.has(cp)) seen.set(cp, position);
  }
  return seen;
}

function issue(
  code: ScriptIssueCode,
  field: ScriptIssue['field'],
  message: string,
  cp: number | null = null,
  position: number | null = null,
  severity: ScriptIssue['severity'] = 'error',
): ScriptIssue {
  return {
    code,
    severity,
    field,
    message,
    char: cp === null ? null : String.fromCodePoint(cp),
    position,
  };
}

/** Problems with a phrase's native text in `language` (ps, ur, hno, …). */
export function checkNative(language: string, text: string): ScriptIssue[] {
  const orthography = ORTHOGRAPHIES.get(language);
  const issues: ScriptIssue[] = [];
  const positions = firstPositions(text);
  for (const [cp, at] of positions) {
    const invisible = INVISIBLE_CHARS.get(cp);
    if (invisible) {
      issues.push(
        issue(
          'PL422_INVISIBLE_CHAR',
          'native',
          `There's an invisible ${invisible} (${codepointLabel(cp)}) at position ${at}. It usually comes along when text is copied from a website or Word. Delete it, or retype that spot.`,
          cp,
          at,
        ),
      );
    } else if (SMART_QUOTES.has(cp)) {
      issues.push(
        issue(
          'PL422_SMART_QUOTE',
          'native',
          `There's a curly quote (${String.fromCodePoint(cp)}) at position ${at}. Use a straight quote, or none.`,
          cp,
          at,
        ),
      );
    } else if (isArabicDigit(cp)) {
      issues.push(
        issue(
          'PL422_ARABIC_DIGIT',
          'native',
          `There's an Arabic-Indic digit (${String.fromCodePoint(cp)}) at position ${at}. Use 0-9, or spell the number out.`,
          cp,
          at,
        ),
      );
    } else if (orthography && !orthography.allowed.has(cp)) {
      const hint = orthography.spec.hints.find((h) => h.from === cp);
      const fix = hint
        ? ` Use ${String.fromCodePoint(hint.to)} (${codepointLabel(hint.to)}) instead.`
        : ` If it really belongs in ${orthography.spec.name}, ask an admin to add it to the character list.`;
      issues.push(
        issue(
          'PL422_CHAR_NOT_ALLOWED',
          'native',
          `"${String.fromCodePoint(cp)}" (${codepointLabel(cp)}) at position ${at} isn't in the ${orthography.spec.name} character list.${fix}`,
          cp,
          at,
        ),
      );
    }
  }
  const latin = [...positions].find(([cp]) => isLatinLetter(cp));
  if (latin)
    issues.push(
      issue(
        'LATIN_IN_NATIVE',
        'native',
        `The native text has Latin letters, starting at position ${latin[1]}. Did the romanisation end up in this field?`,
        latin[0],
        latin[1],
        'warning',
      ),
    );
  return issues;
}

/** Problems with a phrase's romanisation. */
export function checkRomanisation(text: string): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const positions = firstPositions(text);
  const arabic = [...positions].find(([cp]) => isArabicScript(cp));
  if (arabic)
    issues.push(
      issue(
        'PL422_ROMANISATION_SCRIPT',
        'romanisation',
        `The romanisation has native-script letters, starting at position ${arabic[1]}. Write it in Latin letters, the way a learner would say it, like "Salaam".`,
        arabic[0],
        arabic[1],
      ),
    );
  if (![...positions.keys()].some(isLatinLetter))
    issues.push(
      issue(
        'PL422_ROMANISATION_NO_LATIN',
        'romanisation',
        'The romanisation needs Latin letters, like "Salaam" or "Kya haal hai?".',
      ),
    );
  return issues;
}

/** Both fields' problems, native first. */
export function checkPhrase(
  language: string,
  native: string,
  romanisation: string,
): ScriptIssue[] {
  return [...checkNative(language, native), ...checkRomanisation(romanisation)];
}

/** True when nothing would stop the database storing it (warnings allowed). */
export function isStorable(issues: ScriptIssue[]): boolean {
  return issues.every((i) => i.severity !== 'error');
}
