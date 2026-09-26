/**
 * Small helpers for learner-facing wording that depends on the content
 * release: how many languages or lessons there are, and lists of names. The
 * screens use these instead of writing a count into their copy, so a release
 * with more or fewer lessons reads correctly.
 */

const NUMBER_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
];

/** "Three" for 3, as a word up to ten and in digits after that. */
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** "lesson" for 1, "lessons" otherwise; "LESSONS" for an uppercase word. */
export function plural(n: number, word: string): string {
  if (n === 1) return word;
  return `${word}${word === word.toUpperCase() ? 'S' : 's'}`;
}

/** "Pashto", "Pashto and Urdu", "Pashto, Hindko and Urdu". */
export function listJoin(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
