/**
 * The lesson player's pure decisions, kept out of components/lesson-player.tsx
 * so the tests can check them without a browser: the order each attempt
 * shows its choices in, what a hint may say, and how a phrase's own words
 * are set for the screen.
 *
 * Orders are seeded by the exercise, the run and the attempt's place in the
 * run's queue. A reload shows the same order, a second try a different one,
 * and a new run a new one, and none of them is a pattern that answers the
 * question for the learner.
 */
import { shuffled, type Exercise, type Phrase } from '../../lib/content.ts';
import { curlyQuotes } from '../../lib/teaser.ts';

/** How many seeds to try before settling for the first order. */
const TRIES = 32;

function sameOrder<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Whether `order` is `base` turned round by some number of places, itself included. */
export function isRotation<T>(order: T[], base: T[]): boolean {
  const n = base.length;
  if (order.length !== n) return false;
  for (let r = 0; r < n; r++)
    if (order.every((x, i) => x === base[(i + r) % n])) return true;
  return false;
}

/** The first seeded order `bad` accepts, or the plain seeded order when none is. */
function seededOrder<T>(
  list: T[],
  seed: string,
  bad: (order: T[]) => boolean,
): T[] {
  for (let n = 0; n < TRIES; n++) {
    const order = shuffled(list, n ? `${seed}~${n}` : seed);
    if (!bad(order)) return order;
  }
  return shuffled(list, seed);
}

/**
 * The seed of every attempt at the exercise the run is on, first try first:
 * one per place in the queue that holds that exercise, up to the cursor.
 */
export function attemptSeeds(
  exerciseId: string,
  sessionId: string,
  queue: number[],
  cursor: number,
): string[] {
  const at = queue[Math.min(cursor, queue.length - 1)];
  const seeds: string[] = [];
  for (let c = 0; c <= cursor && c < queue.length; c++)
    if (queue[c] === at) seeds.push(`${exerciseId}:${sessionId}:${c}`);
  return seeds.length ? seeds : [`${exerciseId}:${sessionId}:${cursor}`];
}

/** The choices, in an order no earlier attempt at the exercise showed. */
export function choiceOrder<T>(options: T[], seeds: string[]): T[] {
  const shown: T[][] = [];
  for (const seed of seeds)
    shown.push(
      seededOrder(options, seed, (o) => shown.some((s) => sameOrder(s, o))),
    );
  return shown[shown.length - 1];
}

/**
 * A match board: the expressions on the left and their meanings on the
 * right, each in its own order. The right column is never the left one
 * turned round (which includes the same order), so no row pattern pairs
 * them, and neither column repeats an earlier attempt's order.
 */
export function matchOrders<T>(
  options: T[],
  seeds: string[],
): { left: T[]; right: T[] } {
  const lefts: T[][] = [];
  const rights: T[][] = [];
  for (const seed of seeds) {
    const left = seededOrder(options, seed, (o) =>
      lefts.some((s) => sameOrder(s, o)),
    );
    const right = seededOrder(
      options,
      `${seed}:meanings`,
      (o) =>
        (options.length > 2 && isRotation(o, left)) ||
        rights.some((s) => sameOrder(s, o)),
    );
    lefts.push(left);
    rights.push(right);
  }
  return { left: lefts[lefts.length - 1], right: rights[rights.length - 1] };
}

/** Whether a row of words holds `answer`, word for word and side by side. */
export function spellsAnswer(words: string[], answer: string[]): boolean {
  if (answer.length < 2) return false;
  return ` ${words.join(' ')} `.includes(` ${answer.join(' ')} `);
}

/**
 * The word bank's order, as indexes into `bank`, whose first `answerLength`
 * words are the answer. It never shows the answer's words side by side in
 * the answer's order, and never repeats an earlier attempt's order.
 */
export function bankOrder(
  bank: string[],
  answerLength: number,
  seeds: string[],
): number[] {
  const answer = bank.slice(0, answerLength);
  const indexes = bank.map((_, i) => i);
  const shown: number[][] = [];
  for (const seed of seeds)
    shown.push(
      seededOrder(
        indexes,
        seed,
        (o) =>
          spellsAnswer(
            o.map((i) => bank[i]),
            answer,
          ) || shown.some((s) => sameOrder(s, o)),
      ),
    );
  return shown[shown.length - 1];
}

/** Lowercase letters and digits only, so "How are you?" matches "how are you". */
function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

/** Whether `text` says any form of the phrase: its meaning, romanisation or script. */
export function givesAway(text: string, phrase: Phrase): boolean {
  const said = ` ${plain(text)} `;
  return [phrase.meaning, phrase.roman, phrase.native].some((form) => {
    const f = plain(form);
    return f !== '' && said.includes(f);
  });
}

/**
 * What "A little hint?" says for a choice exercise: the phrase's situation
 * or its usage note, whichever comes first and does not say the answer. A
 * context exercise already sets the scene, so only its note is used. Empty
 * when neither will do; Poli then crosses out a wrong choice instead.
 */
export function hintNudge(exercise: Exercise): string {
  const { context, note } = exercise.phrase;
  const candidates = exercise.kind === 'context' ? [note] : [context, note];
  return (
    candidates.find((c) => c.trim() && !givesAway(c, exercise.phrase)) ?? ''
  );
}

/** The wrong choice Poli crosses out when the hint has no safe words to say. */
export function crossedOut(exercise: Exercise, seed: string): string {
  const wrong = exercise.options.filter((p) => p.id !== exercise.phrase.id);
  return wrong.length > 1 ? shuffled(wrong, `${seed}:hint`)[0].id : '';
}

/**
 * The scene of a context exercise without its closing question: "You meet a
 * friend. What do you ask?" is "You meet a friend." The screen asks the
 * question itself.
 */
export function contextScene(prompt: string): string {
  const text = prompt.trim();
  const found = /^(.*?[.!])\s+(?:What|How|Which)\b[^.!?]*\?$/.exec(text);
  return found ? found[1] : text;
}

/**
 * Typographic punctuation for the content's plain text: curly quotes and
 * apostrophes, and an en dash for a spaced hyphen. "God's protection" - a
 * note becomes “God’s protection” – a note.
 */
export function typeset(text: string): string {
  return curlyQuotes(text)
    .replace(/(\p{L})'(\p{L})/gu, '$1’$2')
    .replace(/ - /g, ' – ');
}

/** Arabic-script letters, marks and the joiners used within words. */
const SCRIPT_RUN =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+(?:[\s\u200C\u200D]+[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)*/gu;

/**
 * A note split into its English and its Arabic-script runs, so the script
 * can carry its own lang, dir and typeface: "ستاسې is the respectful “your”."
 */
export function scriptRuns(text: string): { text: string; script: boolean }[] {
  const runs: { text: string; script: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(SCRIPT_RUN)) {
    const start = match.index ?? 0;
    if (start > last)
      runs.push({ text: text.slice(last, start), script: false });
    runs.push({ text: match[0], script: true });
    last = start + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), script: false });
  return runs;
}

/**
 * What the feedback says after a wrong choice, from the phrases themselves:
 * the one picked and what it is, then the answer.
 */
export function wrongChoiceCopy(
  kind: Exercise['kind'],
  picked: Phrase,
  answer: Phrase,
): { picked: string; answer: string } {
  return {
    picked:
      kind === 'meaning'
        ? `You picked “${picked.meaning}”, which is “${picked.roman}”.`
        : `You picked “${picked.roman}”, which means “${picked.meaning}”.`,
    answer: `“${answer.roman}” means “${answer.meaning}”.`,
  };
}
