/**
 * Checks a learner copy that did not come from this build before the app
 * shows it (docs/platform.md 4.7).
 *
 * The committed baseline, content/release.json, is checked by the build and
 * its tests. A release published from the database reaches the browser at
 * run time instead (app/api/release, then localStorage), so everything the
 * screens rely on is checked here first, and a copy that fails any check is
 * never activated: the learner keeps the content they have.
 *
 * Pure and synchronous: the same checks run in the tests, on the server and
 * in the browser.
 */
import { canonicalJson } from './canonical-json.ts';
import {
  LEARNER_FORMAT,
  LEARNER_SCHEMA_VERSION,
  PRESENTED_LANGUAGES,
  type LearnerCopy,
} from './content.ts';
import { sha256 } from './sha256.ts';

export type VerifyResult =
  | { ok: true; copy: LearnerCopy }
  | { ok: false; reason: string };

/**
 * content@YYYY.MM.N, or a development build of content: dev+<sha>, with
 * .dirty for uncommitted changes, or dev+nogit for a corpus built outside
 * git (the content build's own names).
 */
const RELEASE_OR_DEV =
  /^content@\d{4}\.\d{2}\.(\d+|dev\+([0-9a-f]{7,40}|nogit)(\.dirty)?)$/;
const RELEASE = /^content@(\d{4})\.(\d{2})\.(\d+)$/;
const COMMIT = /^[0-9a-f]{40}$/;
const CONTENT_HASH = /^sha256-[0-9a-f]{64}$/;
const LANGUAGE_CODE = /^[a-z]{2,3}$/;
const EXERCISE_KINDS = new Set([
  'meaning',
  'translation',
  'match',
  'assemble',
  'context',
]);

/** The hash the content build writes: over languages, varieties, courses and keymap only. */
export function learnerContentHash(copy: {
  languages?: unknown;
  varieties?: unknown;
  courses?: unknown;
  keymap?: unknown;
}): string {
  const { languages, varieties, courses, keymap } = copy;
  return `sha256-${sha256(canonicalJson({ languages, varieties, courses, keymap }))}`;
}

class Refusal extends Error {}
function refuse(reason: string): never {
  throw new Refusal(reason);
}

type Json = Record<string, unknown>;
const isRecord = (x: unknown): x is Json =>
  x !== null && typeof x === 'object' && !Array.isArray(x);

function record(x: unknown, where: string): Json {
  if (!isRecord(x)) refuse(`${where} is not an object`);
  return x;
}
function list(x: unknown, where: string): unknown[] {
  if (!Array.isArray(x)) refuse(`${where} is not a list`);
  return x;
}
function text(x: unknown, where: string, { empty = false } = {}): string {
  if (typeof x !== 'string') refuse(`${where} is not text`);
  if (!empty && x.trim() === '') refuse(`${where} is empty`);
  return x;
}
function optionalText(x: unknown, where: string): void {
  // Left out when there is none; never null (the content build omits it).
  if (x !== undefined) text(x, where);
}
function order(x: unknown, where: string): void {
  if (!Number.isSafeInteger(x)) refuse(`${where} is not a whole number`);
}
function unique(seen: Set<string>, id: string, what: string): void {
  if (seen.has(id)) refuse(`${what} ${id} appears twice`);
  seen.add(id);
}

/**
 * Only what hashes the same in the database and here (docs/platform.md 3.3):
 * integers below 2^53 and ASCII keys. Anything else could never have been
 * built by the database, and its hash could not be trusted to mean the same.
 */
function withinCanonicalLimits(x: unknown, where: string): void {
  if (typeof x === 'number') {
    if (!Number.isSafeInteger(x))
      refuse(`${where} holds a number that is not a whole number`);
    return;
  }
  if (Array.isArray(x)) {
    x.forEach((entry, i) => withinCanonicalLimits(entry, `${where}[${i}]`));
    return;
  }
  if (isRecord(x))
    for (const [key, entry] of Object.entries(x)) {
      // oxlint-disable-next-line no-control-regex -- ASCII is the point.
      if (!/^[\x00-\x7f]*$/.test(key))
        refuse(`${where} has a key that is not ASCII`);
      withinCanonicalLimits(entry, `${where}.${key}`);
    }
}

function check(x: unknown): LearnerCopy {
  const copy = record(x, 'The copy');
  if (copy.format !== LEARNER_FORMAT)
    refuse(`format is ${JSON.stringify(copy.format)}, not ${LEARNER_FORMAT}`);
  if (copy.schemaVersion !== LEARNER_SCHEMA_VERSION)
    refuse(
      `schemaVersion is ${JSON.stringify(copy.schemaVersion)}, not ${LEARNER_SCHEMA_VERSION}`,
    );
  if (typeof copy.release !== 'string' || !RELEASE_OR_DEV.test(copy.release))
    refuse(
      `release ${JSON.stringify(copy.release)} is not a content release name`,
    );
  if (
    copy.commit !== null &&
    (typeof copy.commit !== 'string' || !COMMIT.test(copy.commit))
  )
    refuse('commit is neither null nor a commit id');
  if (
    typeof copy.contentHash !== 'string' ||
    !CONTENT_HASH.test(copy.contentHash)
  )
    refuse('contentHash is not a sha256- hash');
  withinCanonicalLimits(copy, 'The copy');

  const languages = new Map<string, Json>();
  for (const [i, entry] of list(copy.languages, 'languages').entries()) {
    const language = record(entry, `languages[${i}]`);
    const code = text(language.code, `languages[${i}].code`);
    if (!LANGUAGE_CODE.test(code))
      refuse(`language code ${code} is not a language code`);
    if (languages.has(code)) refuse(`language ${code} appears twice`);
    if (!PRESENTED_LANGUAGES.includes(code))
      refuse(`language ${code} is not one this app can show`);
    text(language.name, `language ${code} name`);
    text(language.native_name, `language ${code} native_name`);
    if (language.direction !== 'rtl' && language.direction !== 'ltr')
      refuse(
        `language ${code} has direction ${JSON.stringify(language.direction)}`,
      );
    languages.set(code, language);
  }

  const varieties = new Map<string, string>();
  for (const [i, entry] of list(copy.varieties, 'varieties').entries()) {
    const variety = record(entry, `varieties[${i}]`);
    const id = text(variety.id, `varieties[${i}].id`);
    if (varieties.has(id)) refuse(`variety ${id} appears twice`);
    const language = text(variety.language, `variety ${id} language`);
    if (!languages.has(language))
      refuse(`variety ${id} is in a language the copy does not list`);
    text(variety.learner_label, `variety ${id} learner_label`);
    varieties.set(id, language);
  }

  const courseIds = new Set<string>();
  const courseLanguages = new Set<string>();
  const unitIds = new Set<string>();
  const lessonIds = new Set<string>();
  const itemIds = new Set<string>();
  const exerciseIds = new Set<string>();
  for (const [ci, entry] of list(copy.courses, 'courses').entries()) {
    const course = record(entry, `courses[${ci}]`);
    const id = text(course.id, `courses[${ci}].id`);
    unique(courseIds, id, 'course');
    const language = text(course.language, `course ${id} language`);
    if (!languages.has(language))
      refuse(`course ${id} is in a language the copy does not list`);
    // One course per language: the language is the course's slug and URL.
    if (courseLanguages.has(language)) refuse(`two courses teach ${language}`);
    courseLanguages.add(language);
    const variety = text(course.variety, `course ${id} variety`);
    if (varieties.get(variety) !== language)
      refuse(
        `course ${id} teaches a variety the copy does not list for ${language}`,
      );
    text(course.name, `course ${id} name`);
    text(course.tagline, `course ${id} tagline`, { empty: true });

    for (const [ui, unitEntry] of list(
      course.units,
      `course ${id} units`,
    ).entries()) {
      const unit = record(unitEntry, `course ${id} units[${ui}]`);
      const unitId = text(unit.id, `course ${id} units[${ui}].id`);
      unique(unitIds, unitId, 'unit');
      order(unit.order, `unit ${unitId} order`);
      text(unit.title, `unit ${unitId} title`);

      for (const [li, lessonEntry] of list(
        unit.lessons,
        `unit ${unitId} lessons`,
      ).entries()) {
        const lesson = record(lessonEntry, `unit ${unitId} lessons[${li}]`);
        const lessonId = text(lesson.id, `unit ${unitId} lessons[${li}].id`);
        unique(lessonIds, lessonId, 'lesson');
        order(lesson.order, `lesson ${lessonId} order`);
        text(lesson.title, `lesson ${lessonId} title`);
        text(lesson.subtitle, `lesson ${lessonId} subtitle`, { empty: true });
        text(lesson.objective, `lesson ${lessonId} objective`);
        const lessonVariety = text(
          lesson.variety,
          `lesson ${lessonId} variety`,
        );
        if (varieties.get(lessonVariety) !== language)
          refuse(
            `lesson ${lessonId} is in a variety the copy does not list for ${language}`,
          );

        const items = list(lesson.items, `lesson ${lessonId} items`);
        if (items.length === 0) refuse(`lesson ${lessonId} has no phrases`);
        const own = new Map<string, string>();
        for (const [ii, itemEntry] of items.entries()) {
          const item = record(itemEntry, `lesson ${lessonId} items[${ii}]`);
          const itemId = text(item.id, `lesson ${lessonId} items[${ii}].id`);
          unique(itemIds, itemId, 'phrase');
          text(item.native, `phrase ${itemId} native`);
          text(item.romanisation, `phrase ${itemId} romanisation`);
          const meaning = text(item.meaning, `phrase ${itemId} meaning`);
          optionalText(item.context, `phrase ${itemId} context`);
          optionalText(item.usage_note, `phrase ${itemId} usage_note`);
          const itemVariety = text(item.variety, `phrase ${itemId} variety`);
          if (varieties.get(itemVariety) !== language)
            refuse(
              `phrase ${itemId} is in a variety the copy does not list for ${language}`,
            );
          text(item.citation, `phrase ${itemId} citation`);
          own.set(itemId, meaning);
        }

        const exercises = list(
          lesson.exercises,
          `lesson ${lessonId} exercises`,
        );
        if (exercises.length === 0)
          refuse(`lesson ${lessonId} has no exercises`);
        for (const [ei, exerciseEntry] of exercises.entries()) {
          const exercise = record(
            exerciseEntry,
            `lesson ${lessonId} exercises[${ei}]`,
          );
          const exerciseId = text(
            exercise.id,
            `lesson ${lessonId} exercises[${ei}].id`,
          );
          unique(exerciseIds, exerciseId, 'exercise');
          const kind = exercise.kind;
          if (typeof kind !== 'string' || !EXERCISE_KINDS.has(kind))
            refuse(`exercise ${exerciseId} has kind ${JSON.stringify(kind)}`);
          const answer = text(exercise.item, `exercise ${exerciseId} item`);
          if (!own.has(answer))
            refuse(
              `exercise ${exerciseId} asks about a phrase outside its lesson`,
            );
          text(exercise.prompt, `exercise ${exerciseId} prompt`);
          const options = list(
            exercise.options,
            `exercise ${exerciseId} options`,
          );
          if (kind === 'assemble' ? options.length > 0 : options.length === 0)
            refuse(
              kind === 'assemble'
                ? `assemble exercise ${exerciseId} has options`
                : `exercise ${exerciseId} has no options`,
            );
          const seen = new Set<string>();
          for (const option of options) {
            const optionId = text(option, `exercise ${exerciseId} option`);
            if (!own.has(optionId))
              refuse(
                `exercise ${exerciseId} offers a phrase outside its lesson`,
              );
            if (optionId === answer)
              refuse(`exercise ${exerciseId} offers its answer twice`);
            unique(seen, optionId, `exercise ${exerciseId} option`);
          }
        }
      }
    }
  }

  const keymap = record(copy.keymap, 'keymap');
  for (const [i, entry] of list(keymap.lessons, 'keymap.lessons').entries()) {
    const row = record(entry, `keymap.lessons[${i}]`);
    text(row.legacy_key, `keymap.lessons[${i}].legacy_key`);
    if (!lessonIds.has(text(row.lesson_id, `keymap.lessons[${i}].lesson_id`)))
      refuse(`keymap.lessons[${i}] points at a lesson the copy does not hold`);
    if (!courseIds.has(text(row.course_id, `keymap.lessons[${i}].course_id`)))
      refuse(`keymap.lessons[${i}] points at a course the copy does not hold`);
  }
  for (const [i, entry] of list(keymap.courses, 'keymap.courses').entries()) {
    const row = record(entry, `keymap.courses[${i}]`);
    text(row.legacy_id, `keymap.courses[${i}].legacy_id`);
    if (!courseIds.has(text(row.course_id, `keymap.courses[${i}].course_id`)))
      refuse(`keymap.courses[${i}] points at a course the copy does not hold`);
  }
  for (const [i, entry] of list(keymap.items, 'keymap.items').entries()) {
    const row = record(entry, `keymap.items[${i}]`);
    text(row.legacy_ref, `keymap.items[${i}].legacy_ref`);
    if (!itemIds.has(text(row.item_id, `keymap.items[${i}].item_id`)))
      refuse(`keymap.items[${i}] points at a phrase the copy does not hold`);
  }

  // Last, because it is the slowest: the content is exactly what was hashed.
  if (learnerContentHash(copy) !== copy.contentHash)
    refuse('contentHash does not match the content');
  return copy as LearnerCopy;
}

/**
 * Whether `x` is a learner copy this app can show, with the reason when it
 * is not. Never throws, whatever it is given.
 */
export function verifyLearnerCopy(x: unknown): VerifyResult {
  try {
    return { ok: true, copy: check(x) };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message };
    // A copy so strange that reading it threw (a getter, a cycle): refused.
    return { ok: false, reason: 'The copy could not be read' };
  }
}

function releaseNumbers(name: string): [number, number, number] | null {
  const match = RELEASE.exec(name);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * Whether release `a` is newer than release `b`, comparing content@YYYY.MM.N
 * by its numbers (content@2026.10.1 is newer than content@2026.09.12).
 *
 * A development build's name (content@2026.09.dev+f76adfa) is never newer
 * than anything: it is a local or preview build, not something published.
 * A published release is newer than a development build, because the
 * database is where published content lives: a preview built from a
 * development copy of content shows what has actually been published.
 */
export function isNewerRelease(a: string, b: string): boolean {
  const newer = releaseNumbers(a);
  if (!newer) return false;
  const older = releaseNumbers(b);
  if (!older) return true;
  for (let i = 0; i < 3; i++)
    if (newer[i] !== older[i]) return newer[i] > older[i];
  return false;
}

/** What GET /api/release answers (docs/platform.md 4.7). */
export type ReleaseAnswer =
  | { unchanged: true }
  | { reset: true }
  | { release: string; contentHash: string; payload: unknown };

/**
 * The answer for a client that already has `known` (a contentHash, or null),
 * given what get_learner_release() returned upstream, or `undefined` when
 * the route could not ask (no Supabase settings, the database unreachable,
 * an error status):
 *
 *   - `{ reset: true }` when the function answered null: the overlay kill
 *     switch is off, or nothing has been released. The server then vouches
 *     for no copy, so browsers go back to the build's own content.
 *   - `{ unchanged: true }` when the client is up to date, and whenever the
 *     route could not ask or the answer is not the shape the function
 *     returns, so a fault upstream never reaches a learner as anything but
 *     "nothing new".
 *   - the whole copy otherwise.
 */
export function releaseAnswer(
  upstream: unknown,
  known: string | null,
): ReleaseAnswer {
  if (upstream === null) return { reset: true };
  if (!isRecord(upstream)) return { unchanged: true };
  const { release, contentHash, payload } = upstream;
  if (typeof release !== 'string' || typeof contentHash !== 'string')
    return { unchanged: true };
  if (known !== null && known === contentHash) return { unchanged: true };
  if (!isRecord(payload)) return { unchanged: true };
  return { release, contentHash, payload };
}

/** A learner copy, as far as telling copies apart goes. */
export type CopyId = { release: string; contentHash: string };

/**
 * What a client does with an answer of GET /api/release:
 *
 *   - `adopt`: store `copy` and show it.
 *   - `baseline`: forget the stored copy and show the build's own content.
 *   - `keep`: change nothing.
 *
 * `skip`, when present, is the contentHash to send as `known` from now on,
 * so a copy that was refused, or that changes nothing, is not downloaded
 * again every minute.
 */
export type ReleaseStep =
  | { action: 'adopt'; copy: LearnerCopy }
  | { action: 'baseline'; skip?: string }
  | { action: 'keep'; skip?: string };

/**
 * The step a client takes on `answer`, given the copy it shows now (or is
 * waiting to show), `active`, and the build's own copy, `baseline`.
 *
 * The server is authoritative for what it serves: its latest release
 * replaces the active copy whenever the two differ, by name or by content,
 * whichever name is higher. A project that was reset restarts its names,
 * and two projects (a local fixture stack and the hosted one, say) can hold
 * different content under the same name; comparing names alone would pin a
 * browser to the wrong copy for good. Only the build's own content outranks
 * the server: a release that is not newer than the baseline sends the client
 * back to the baseline, and so does `{ reset: true }` (the kill switch, or
 * nothing released).
 *
 * `keep` for "unchanged", for anything that is not the shape the route
 * returns, for a development name, and for a payload that fails
 * verifyLearnerCopy() or does not hash to the answer's contentHash: this
 * build cannot show it, so the client keeps what it has.
 *
 * An adopted copy is named after the release that published it. A rollback
 * is a new release (content@2026.10.3) carrying an earlier payload, whose
 * own `release` field may still say content@2026.10.1. `release` is outside
 * the hashed content, so renaming it keeps the copy verifiable.
 */
export function releaseStep(
  answer: unknown,
  active: CopyId,
  baseline: CopyId,
): ReleaseStep {
  const onBaseline =
    active.release === baseline.release &&
    active.contentHash === baseline.contentHash;
  if (!isRecord(answer) || answer.unchanged === true) return { action: 'keep' };
  if (answer.reset === true)
    return { action: onBaseline ? 'keep' : 'baseline' };
  const { release, contentHash, payload } = answer;
  if (
    typeof release !== 'string' ||
    !RELEASE.test(release) ||
    typeof contentHash !== 'string'
  )
    return { action: 'keep' };
  if (!isNewerRelease(release, baseline.release))
    return { action: onBaseline ? 'keep' : 'baseline', skip: contentHash };
  if (release === active.release && contentHash === active.contentHash)
    return { action: 'keep', skip: contentHash };
  const verified = verifyLearnerCopy(payload);
  if (!verified.ok || verified.copy.contentHash !== contentHash)
    return { action: 'keep', skip: contentHash };
  return {
    action: 'adopt',
    copy:
      verified.copy.release === release
        ? verified.copy
        : { ...verified.copy, release },
  };
}
