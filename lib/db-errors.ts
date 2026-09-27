/**
 * Turns anything a Supabase call can fail with into a code and one plain
 * English sentence that is safe to show (docs/platform.md 3.2, 4.3).
 *
 * The database refuses with `PLnnn_NAME: message` (private.raise). A code in
 * the catalogue, supabase/error-codes.json, shows its sentence, or, for the
 * codes whose message is written to be read (it names the variety, the
 * character and its position, the masked email), the database's own
 * message. Postgres and PostgREST codes we expect get a sentence of their
 * own. Anything else shows a generic sentence and never the raw text, which
 * can hold table names and SQL; its code is kept for the small print.
 */
import catalogue from '../supabase/error-codes.json' with { type: 'json' };

export type DbError = {
  /** `PL403_OUTSIDE_VARIETY`, `23505`, `NETWORK`, … shown in small print. */
  code: string;
  /** One sentence for the person, never raw database text for an unknown error. */
  message: string;
  /** The refusal's detail (private.raise's p_detail), parsed, or null. */
  detail: unknown;
};

export const ERROR_SENTENCES: Readonly<Record<string, string>> = catalogue;

/**
 * Codes whose database message carries specifics worth more than the
 * catalogue sentence. Their message is shown when it is not empty.
 */
export const SPECIFIC_MESSAGE_CODES: ReadonlySet<string> = new Set([
  'PL403_OUTSIDE_VARIETY',
  'PL403_OUTSIDE_LANGUAGE',
  'PL403_WRONG_EMAIL',
  'PL422_INVISIBLE_CHAR',
  'PL422_SMART_QUOTE',
  'PL422_ARABIC_DIGIT',
  'PL422_CHAR_NOT_ALLOWED',
  'PL422_ROMANISATION_SCRIPT',
  'PL422_ROMANISATION_NO_LATIN',
  'PL422_LENGTH',
  'PL422_LESSON_PROBLEMS',
  'PL422_SCOPE_INCOMPLETE',
  'PL422_TOO_FEW_EXERCISES',
  'PL422_NO_CHANGE',
  'PL422_BAD_OPTION',
  'PL422_OPTION_EQUALS_ANSWER',
  'PL422_PROVENANCE',
  'PL409_NO_REVIEWER',
  'PL409_ITEM_IN_USE',
  'PL409_NOT_PUBLISHABLE',
]);

export const GENERIC_MESSAGE = 'Something went wrong. Nothing was changed.';
export const NETWORK_MESSAGE =
  "We can't reach PoliLingo's server right now. Nothing was changed.";
export const SESSION_MESSAGE = 'Your session ended. Please sign in again.';
export const DUPLICATE_MESSAGE = 'That already exists.';
export const NO_ACCESS_MESSAGE = "Your account doesn't have access to this.";
export const NOT_CONFIGURED_MESSAGE =
  "The workspace isn't connected to its database yet.";

const PL_MESSAGE = /^(PL\d{3}_[A-Z0-9_]+):\s*([\s\S]*)$/;
const JWT_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303']);
const JWT_TEXT =
  /\bJWT\b|jwt expired|invalid claim|refresh token|auth session missing|session (?:not found|expired)/i;
const NETWORK_TEXT =
  /failed to fetch|fetch failed|networkerror|network request failed|load failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseDetail(details: unknown): unknown {
  if (details === undefined || details === null || details === '') return null;
  if (typeof details !== 'string') return details;
  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
}

/** The sentence for a PoliLingo code, or null when the catalogue lacks it. */
export function sentenceFor(code: string): string | null {
  return Object.hasOwn(ERROR_SENTENCES, code) ? ERROR_SENTENCES[code] : null;
}

/**
 * `{ code, message, detail }` for a Supabase/PostgREST error, a thrown
 * Error, or anything else.
 */
export function describeDbError(error: unknown): DbError {
  const e = (error ?? {}) as Record<string, unknown>;
  const rawMessage =
    text(e.message) || (typeof error === 'string' ? error : '');
  const rawCode = text(e.code);
  const detail = parseDetail(e.details ?? e.detail);

  const pl = rawMessage.match(PL_MESSAGE);
  if (pl) {
    const [, code, own] = pl;
    const sentence = sentenceFor(code);
    if (!sentence) return { code, message: GENERIC_MESSAGE, detail };
    const specific = SPECIFIC_MESSAGE_CODES.has(code) && own.trim() !== '';
    return { code, message: specific ? own.trim() : sentence, detail };
  }
  if (rawCode === '23505')
    return { code: rawCode, message: DUPLICATE_MESSAGE, detail: null };
  if (rawCode === '42501')
    return { code: rawCode, message: NO_ACCESS_MESSAGE, detail: null };
  if (
    JWT_CODES.has(rawCode) ||
    text(e.name) === 'AuthSessionMissingError' ||
    JWT_TEXT.test(rawMessage)
  )
    return {
      code: rawCode || 'SESSION_ENDED',
      message: SESSION_MESSAGE,
      detail: null,
    };
  if (
    text(e.name) === 'AbortError' ||
    NETWORK_TEXT.test(rawMessage) ||
    NETWORK_TEXT.test(text(e.details))
  )
    return { code: 'NETWORK', message: NETWORK_MESSAGE, detail: null };
  if (rawCode === 'NOT_CONFIGURED')
    return { code: rawCode, message: NOT_CONFIGURED_MESSAGE, detail: null };
  return {
    code: /^[A-Z0-9_]{1,40}$/i.test(rawCode) ? rawCode : 'UNKNOWN',
    message: GENERIC_MESSAGE,
    detail: null,
  };
}
