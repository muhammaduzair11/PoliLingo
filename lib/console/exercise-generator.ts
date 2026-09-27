/**
 * "Generate exercises" in the lesson editor (docs/platform.md 4.10): a
 * deterministic plan of exercises for a lesson's phrases, which the editor
 * previews and then saves, one create_exercise() per entry, each with an id
 * reserved by reserve_content_id() at save time.
 *
 * The plan, for phrases in lesson order:
 *   - per phrase, one `meaning` exercise (read the phrase, pick its meaning)
 *     and one `translation` exercise (read the meaning, pick the phrase),
 *     each with up to 3 wrong choices from the same lesson;
 *   - one `match` when the lesson has at least 4 phrases;
 *   - one `assemble` for the phrase with the longest meaning (no choices:
 *     the learner builds the meaning from word tiles).
 *
 * A wrong choice is never the answer and never shares its native text or
 * its meaning (compared as the database compares them: native text
 * normalised, meaning normalised and lower-cased), so the database's option
 * rules (422_BAD_OPTION, 422_OPTION_EQUALS_ANSWER) always accept it. Choices
 * are also distinct from each other in text and meaning, so a learner never
 * sees the same choice twice. With 3 or more phrases whose text and meaning
 * differ, the plan has at least 6 exercises.
 *
 * Exercises the lesson already has are not planned again: a meaning,
 * translation or assemble exercise for the same phrase, or any match. So
 * generating twice adds nothing the second time, and generating after
 * adding a phrase adds only that phrase's exercises.
 *
 * Pure and deterministic: the same phrases give the same plan, in the same
 * order, with the same choices. No randomness, no clock.
 */
import { normaliseNative } from '../script-check.ts';

export type GeneratorItem = {
  id: string;
  native: string;
  meaning: string;
};

export type GeneratedKind = 'meaning' | 'translation' | 'match' | 'assemble';

export type ExistingExercise = {
  kind: string;
  answer_item_id: string;
};

export type GeneratedExercise = {
  /** Stable within a plan: `<kind>:<answer id>`. */
  key: string;
  kind: GeneratedKind;
  /** The answer item's id. */
  answer: string;
  prompt: string;
  /** Wrong choices (item ids); empty for assemble. */
  options: string[];
};

/** Up to this many wrong choices per exercise. */
export const MAX_DISTRACTORS = 3;

export const MEANING_PROMPT = 'What does this mean?';
export const MATCH_PROMPT = 'Match each expression to its meaning.';

/** How the database compares native text: normalised. */
export const nativeKey = (native: string): string => normaliseNative(native);

/** How the database compares meanings: normalised and lower-cased. */
export const meaningKey = (meaning: string): string =>
  normaliseNative(meaning).toLowerCase();

/** "How do you say "Thank you"?" / "How do you ask "What is your name?"" */
export function translationPrompt(meaning: string): string {
  const text = normaliseNative(meaning).replace(/\.+$/, '');
  if (text.endsWith('?')) return `How do you ask "${text}"`;
  if (text.endsWith('!')) return `How do you say "${text}"`;
  return `How do you say "${text}"?`;
}

/** "Build the sentence "My name is Sara"." / "Build the sentence "Where are you from?"" */
export function assemblePrompt(meaning: string): string {
  const text = normaliseNative(meaning).replace(/\.+$/, '');
  return /[?!]$/.test(text)
    ? `Build the sentence "${text}"`
    : `Build the sentence "${text}".`;
}

/** The prompt a new exercise of `kind` starts with. */
export function defaultPrompt(kind: string, meaning: string): string {
  switch (kind) {
    case 'meaning':
      return MEANING_PROMPT;
    case 'translation':
      return translationPrompt(meaning);
    case 'match':
      return MATCH_PROMPT;
    case 'assemble':
      return assemblePrompt(meaning);
    default:
      return '';
  }
}

/** Whether `candidate` may be a wrong choice for `answer`. */
export function isValidDistractor(
  answer: GeneratorItem,
  candidate: GeneratorItem,
): boolean {
  return (
    candidate.id !== answer.id &&
    nativeKey(candidate.native) !== nativeKey(answer.native) &&
    meaningKey(candidate.meaning) !== meaningKey(answer.meaning)
  );
}

/**
 * Up to `max` wrong choices for `items[index]`, walking the lesson from the
 * next phrase onwards (`step` 1) or backwards (`step` -1), wrapping round,
 * and skipping any that would repeat a choice already taken.
 */
export function pickDistractors(
  items: readonly GeneratorItem[],
  index: number,
  step: 1 | -1 = 1,
  max: number = MAX_DISTRACTORS,
): string[] {
  const answer = items[index];
  if (!answer) return [];
  const picked: GeneratorItem[] = [];
  const n = items.length;
  for (let k = 1; k < n && picked.length < max; k++) {
    const candidate = items[(((index + step * k) % n) + n) % n];
    if (!isValidDistractor(answer, candidate)) continue;
    if (
      picked.some(
        (p) =>
          nativeKey(p.native) === nativeKey(candidate.native) ||
          meaningKey(p.meaning) === meaningKey(candidate.meaning),
      )
    )
      continue;
    picked.push(candidate);
  }
  return picked.map((p) => p.id);
}

/** The index of the phrase with the longest meaning; the first one on a tie. */
export function longestMeaningIndex(items: readonly GeneratorItem[]): number {
  let best = -1;
  let bestLength = -1;
  for (const [i, item] of items.entries()) {
    const length = Array.from(normaliseNative(item.meaning)).length;
    if (length > bestLength) {
      best = i;
      bestLength = length;
    }
  }
  return best;
}

/** The plan for `items` (in lesson order), leaving out what `existing` has. */
export function generateExercises(
  items: readonly GeneratorItem[],
  existing: readonly ExistingExercise[] = [],
): GeneratedExercise[] {
  const has = new Set(existing.map((e) => `${e.kind}:${e.answer_item_id}`));
  const hasKind = (kind: string) => existing.some((e) => e.kind === kind);
  const plan: GeneratedExercise[] = [];
  const add = (
    kind: GeneratedKind,
    answer: GeneratorItem,
    options: string[],
  ) => {
    const key = `${kind}:${answer.id}`;
    if (has.has(key)) return;
    if (kind !== 'assemble' && options.length === 0) return;
    plan.push({
      key,
      kind,
      answer: answer.id,
      prompt: defaultPrompt(kind, answer.meaning),
      options: kind === 'assemble' ? [] : options,
    });
  };

  for (const [i, item] of items.entries()) {
    add('meaning', item, pickDistractors(items, i, 1));
    add('translation', item, pickDistractors(items, i, -1));
  }

  if (items.length >= 4 && !hasKind('match'))
    add('match', items[0], pickDistractors(items, 0, 1));

  const longest = longestMeaningIndex(items);
  if (longest >= 0 && !hasKind('assemble')) add('assemble', items[longest], []);

  return plan;
}

/** "3 meaning, 3 translation, 1 match and 1 assemble" style counts by kind. */
export function planCounts(
  plan: readonly GeneratedExercise[],
): Record<GeneratedKind, number> {
  const counts: Record<GeneratedKind, number> = {
    meaning: 0,
    translation: 0,
    match: 0,
    assemble: 0,
  };
  for (const exercise of plan) counts[exercise.kind] += 1;
  return counts;
}
