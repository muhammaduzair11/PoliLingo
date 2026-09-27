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

/**
 * The first seeded order `bad` does not refuse. When every one is refused,
 * the first one `fallback` (a looser test) accepts, or else the plain
 * seeded order.
 */
function seededOrder<T>(
  list: T[],
  seed: string,
  bad: (order: T[]) => boolean,
  fallback?: (order: T[]) => boolean,
): T[] {
  for (let n = 0; n < TRIES; n++) {
    const order = shuffled(list, n ? `${seed}~${n}` : seed);
    if (!bad(order)) return order;
  }
  if (fallback) return seededOrder(list, seed, fallback);
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
 * Whether any two of the answer's words sit side by side in the answer's
 * order: "is Sara" in "My fine is Sara am name" starts the answer off.
 */
export function pairsAnswer(words: string[], answer: string[]): boolean {
  for (let i = 0; i + 1 < answer.length; i++)
    if (spellsAnswer(words, answer.slice(i, i + 2))) return true;
  return false;
}

/**
 * The word bank's order, as indexes into `bank`, whose first `answerLength`
 * words are the answer. No two of the answer's words sit side by side in
 * the answer's order (or, when no order manages that, at least not the
 * whole answer), and no earlier attempt's order comes back.
 */
export function bankOrder(
  bank: string[],
  answerLength: number,
  seeds: string[],
): number[] {
  const answer = bank.slice(0, answerLength);
  const indexes = bank.map((_, i) => i);
  const words = (o: number[]) => o.map((i) => bank[i]);
  const shown: number[][] = [];
  const repeats = (o: number[]) => shown.some((s) => sameOrder(s, o));
  for (const seed of seeds)
    shown.push(
      seededOrder(
        indexes,
        seed,
        (o) => pairsAnswer(words(o), answer) || repeats(o),
        (o) => spellsAnswer(words(o), answer) || repeats(o),
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

/** The Arabic-script words in `text`. */
function scriptWords(text: string): string[] {
  return [...text.matchAll(SCRIPT_RUN)].flatMap((m) =>
    m[0].split(/[\s‌‍]+/).filter(Boolean),
  );
}

/**
 * Whether `text` names a word that only the right choice's script has, when
 * the choices are shown in script: "ښه is read here…" points straight at
 * زه ښه یم. A word every choice shares, or one of a wrong choice's, is fair.
 */
export function pointsAtAnswer(text: string, exercise: Exercise): boolean {
  if (exercise.kind === 'meaning') return false;
  const said = scriptWords(text);
  if (said.length === 0) return false;
  const answer = new Set(scriptWords(exercise.phrase.native));
  const elsewhere = new Set(
    exercise.options
      .filter((p) => p.id !== exercise.phrase.id)
      .flatMap((p) => scriptWords(p.native)),
  );
  return said.some((w) => answer.has(w) && !elsewhere.has(w));
}

/**
 * What "A little hint?" says for a choice exercise: the phrase's situation
 * or its usage note, whichever comes first and neither says the answer nor
 * names a word only the answer has. A context exercise already sets the
 * scene, so only its note is used. Empty when neither will do; Poli then
 * crosses out a wrong choice instead.
 */
export function hintNudge(exercise: Exercise): string {
  const { context, note } = exercise.phrase;
  const candidates = exercise.kind === 'context' ? [note] : [context, note];
  return (
    candidates.find(
      (c) =>
        c.trim() &&
        !givesAway(c, exercise.phrase) &&
        !pointsAtAnswer(c, exercise),
    ) ?? ''
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
