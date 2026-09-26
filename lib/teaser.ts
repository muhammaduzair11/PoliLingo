/**
 * The landing page's "try it" card: one question from the content release,
 * so it can never name a language, or show a phrase, the release does not
 * hold. Nothing here is written by hand except the card's own wording.
 */
import type { Course, Lesson, Phrase } from './content.ts';

export type Teaser = {
  course: Course;
  lesson: Lesson;
  /** The question, as its lesson asks it, with typographic quotes. */
  prompt: string;
  answer: Phrase;
  /** Three choices, the answer where its lesson places it. */
  options: Phrase[];
};

/** How many choices the card shows, as it was drawn. */
const CHOICES = 3;

/** Paired straight double quotes as curly ones: "thank you" -> “thank you”. */
export function curlyQuotes(text: string): string {
  return text.replace(/"([^"]*)"/g, '“$1”');
}

/** A phrase said with delight, whatever it ends with: "Shukriya!", "Tsanga ye!". */
export function exclaimed(phrase: string): string {
  return `${phrase.replace(/[\s?!.,;:]+$/, '')}!`;
}

/**
 * The card's question: the first question that asks for a phrase in the
 * language (a `translation` exercise with at least CHOICES choices), from
 * the earliest lesson that has one. It comes from `preferred`, Urdu, the
 * course the card was designed around, when the release holds it, and
 * otherwise from the first course, in display order, that has one.
 * Undefined when none does; the page then leaves the card out.
 */
export function landingTeaser(
  courses: Course[],
  preferred = 'urdu',
): Teaser | undefined {
  const ordered = [
    ...courses.filter((c) => c.id === preferred),
    ...courses.filter((c) => c.id !== preferred),
  ];
  for (const course of ordered)
    for (const lesson of course.lessons) {
      const exercise = lesson.exercises.find(
        (e) => e.kind === 'translation' && e.options.length >= CHOICES,
      );
      if (!exercise) continue;
      // The answer, and the first others in the order the lesson shows them.
      let others = 0;
      const options = exercise.options.filter(
        (p) => p.id === exercise.phrase.id || ++others < CHOICES,
      );
      return {
        course,
        lesson,
        prompt: curlyQuotes(exercise.prompt),
        answer: exercise.phrase,
        options,
      };
    }
  return undefined;
}
