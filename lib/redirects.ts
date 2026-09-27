/**
 * The redirects the content release implies, for next.config.ts. Worked out
 * from the learner copy through lib/content.ts, so they change with the
 * release and nobody keeps a list by hand.
 *
 * Redirects are fixed when the app is built, so they come from the baseline
 * copy (content/release.json) and never from a newer release a browser has
 * activated since (docs/platform.md 4.7).
 */
import {
  baselineCopy,
  baselineCourses,
  hiddenCourseSlugs,
  type CourseId,
} from './content.ts';

/** The shape next.config.ts's redirects() returns. */
export type Redirect = {
  source: string;
  destination: string;
  permanent: boolean;
};

/**
 * A language the learner copy does not hold, such as Hindko until it is
 * reviewed: one pattern for all of its URLs, to /learn, which shows the
 * language picker to anyone without a course they can see. Temporary (307),
 * never permanent: browsers remember a 308, and these links must work again
 * the day the language returns. That day its course is in the copy, and the
 * redirect is not generated any more. No lesson id is named.
 */
function hiddenCourse(slug: CourseId): Redirect {
  return {
    source: `/:section(learn|lesson|onboarding)/${slug}/:rest*`,
    destination: '/learn',
    permanent: false,
  };
}

/**
 * The MVP's lesson URLs, /lesson/pashto/greetings, to the lesson's permanent
 * id, /lesson/pashto/ps-lsn-0a41c2, from the keymap rows the learner copy
 * carries. It carries a row only for a lesson it holds, so every target
 * exists and a hidden language has none. Permanent (308): the old address
 * will never mean anything else, so bookmarks and shared links can update.
 */
function legacyLessons(): Redirect[] {
  const slug = new Map(baselineCourses.map((c) => [c.courseId, c.id]));
  return baselineCopy.keymap.lessons.flatMap((row) => {
    const course = slug.get(row.course_id);
    return course
      ? [
          {
            source: `/lesson/${row.legacy_key}`,
            destination: `/lesson/${course}/${row.lesson_id}`,
            permanent: true,
          },
        ]
      : [];
  });
}

/** Every redirect the release implies, in the order Next.js should try them. */
export function contentRedirects(): Redirect[] {
  return [...hiddenCourseSlugs.map(hiddenCourse), ...legacyLessons()];
}
