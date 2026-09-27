/**
 * The app's view of the curriculum.
 *
 * Content lives in the content repository as reviewed YAML (ADR-0006). Each
 * content release builds a learner copy (format polilingo.learner@1), and that
 * file is committed here as content/release.json, one pull request per release
 * (ADR-0028). It is generated, never edited by hand. This module is its only
 * importer, so moving delivery to a build-time fetch changes this file and no
 * other. It presents the Course / Lesson / Phrase / Exercise shapes the
 * screens use, so the screens do not know where the content came from.
 *
 * The learner copy holds only what learners may see: lessons whose publish
 * gate is open all the way down, with learner-facing fields only. A language
 * with nothing open, such as Hindko until it is reviewed, is simply absent:
 * no entry, no ids, no keymap rows. So nothing here is hidden at run time,
 * and no setting can show more than the file holds.
 *
 * What this module adds on the way:
 *
 *   - permanent IDs. A lesson is `ps-lsn-0a41c2`, never a position. They are
 *     what audio, mastery records and analytics will reference, and they are
 *     designed to appear in URLs (docs repo, technical/content-model.md).
 *   - a stable answer position, varied across exercises (see shuffled()).
 *
 * Live content (docs/platform.md 4.7). The committed file is the baseline:
 * the server renders it and the build's redirects come from it. In the
 * browser, a newer verified learner copy published from the database can
 * replace it (lib/release-cache.ts, components/release-refresher.tsx).
 * `learnerCopy`, `contentVersion`, `courses` and `legacyLessonIds` are live
 * bindings that activateRelease() reassigns, and getCourse(), lessonSize(),
 * knownLesson() and selectedCourse() read whichever copy is active. Only
 * browser effects activate a release, so the first render in the browser
 * always matches the server's.
 */
import release from '../content/release.json' with { type: 'json' };

// The MVP's course slugs. They are the URL segments (/learn/pashto), the value
// of ProgressState.selected, and the keys learners have bookmarked, so they
// stay as they are; the permanent course id sits beside them.
export type CourseId = 'pashto' | 'hindko' | 'urdu';
export type Phrase = {
  id: string;
  native: string;
  roman: string;
  meaning: string;
  context: string;
  note: string;
  /** Where the phrase comes from: the release's citation, not always a URL. */
  source: string;
};
type ExerciseKind =
  | 'meaning'
  | 'translation'
  | 'match'
  | 'assemble'
  | 'context';
export type Exercise = {
  id: string;
  kind: ExerciseKind;
  phrase: Phrase;
  /** For choice and match exercises: the answer and its distractors, in display order. */
  options: Phrase[];
  prompt: string;
  /** For assemble exercises: the extra English words shown beside the answer's. */
  tiles: string[];
};
export type Lesson = {
  id: string;
  title: string;
  subtitle: string;
  objective: string;
  unitId: string;
  unitTitle: string;
  phrases: Phrase[];
  exercises: Exercise[];
};
export type Course = {
  /** The slug: route segment and stored `selected` value. */
  id: CourseId;
  /** The permanent course id, e.g. ps-crs-foundation. */
  courseId: string;
  /** ISO 639 code, also the `lang` attribute on native-script text. */
  lang: string;
  /** The language's writing direction, the `dir` attribute on native-script text. */
  dir: 'rtl' | 'ltr';
  name: string;
  courseName: string;
  native: string;
  /**
   * The permanent id of the variety the course teaches, e.g. ps-var-yusufzai.
   * Anything that keys, stores or routes on a variety uses this.
   */
  varietyId: string;
  /**
   * The variety's learner-facing label, e.g. "Northern Pashto, as spoken
   * around Peshawar". Display only: it is written for learners and may be
   * reworded in any release, so it is never a key, id, URL segment or stored
   * value.
   */
  varietyLabel: string;
  tagline: string;
  color: string;
  image: string;
  lessons: Lesson[];
};

// ---------------------------------------------------------------------------
// The learner copy, exactly as the content build writes it (the content
// repository's scripts/build.mjs, learnerCopy()). Every field it has, and
// no other.
// ---------------------------------------------------------------------------

/** The format this app reads. The full private artefact, polilingo.content@1, is refused. */
export const LEARNER_FORMAT = 'polilingo.learner@1';
export const LEARNER_SCHEMA_VERSION = 1;

type LearnerItem = {
  id: string;
  native: string;
  romanisation: string;
  meaning: string;
  /** Left out when a phrase has none; never null. */
  context?: string;
  /** Left out when a phrase has none; never null. */
  usage_note?: string;
  variety: string;
  /** Where the phrase comes from, e.g. a book or a website's name. Not always a URL. */
  citation: string;
};
type LearnerExercise = {
  id: string;
  kind: ExerciseKind;
  /** The answer: an item of the same lesson. */
  item: string;
  prompt: string;
  /** Distractors, items of the same lesson, in the order the content lists them. Empty for assemble. */
  options: string[];
};
type LearnerLesson = {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  objective: string;
  variety: string;
  items: LearnerItem[];
  exercises: LearnerExercise[];
};
type LearnerUnit = {
  id: string;
  order: number;
  title: string;
  lessons: LearnerLesson[];
};
type LearnerCourse = {
  id: string;
  language: string;
  variety: string;
  name: string;
  tagline: string;
  units: LearnerUnit[];
};
export type LearnerCopy = {
  format: typeof LEARNER_FORMAT;
  schemaVersion: typeof LEARNER_SCHEMA_VERSION;
  /** content@YYYY.MM.N for a release; content@YYYY.MM.dev+<sha> for a development build. */
  release: string;
  /** The content commit it was built from. Null only for a corpus built outside git. */
  commit: string | null;
  /** "sha256-" and the hex SHA-256 of the canonical JSON of languages, varieties, courses and keymap. */
  contentHash: string;
  languages: {
    code: string;
    name: string;
    native_name: string;
    direction: 'rtl' | 'ltr';
  }[];
  varieties: { id: string; language: string; learner_label: string }[];
  courses: LearnerCourse[];
  /** The MVP's keys for what this copy holds, and nothing it does not. */
  keymap: {
    lessons: { legacy_key: string; lesson_id: string; course_id: string }[];
    courses: { legacy_id: string; course_id: string }[];
    items: { legacy_ref: string; item_id: string }[];
  };
};

/**
 * Checks that a file is a learner copy this app can read, and returns it.
 * Anything else throws, which fails the build and the tests: the full
 * artefact (which must never reach this repository), an older or newer
 * format, or something else entirely.
 */
export function readLearnerCopy(file: unknown): LearnerCopy {
  const { format, schemaVersion } =
    file && typeof file === 'object'
      ? (file as { format?: unknown; schemaVersion?: unknown })
      : {};
  if (format !== LEARNER_FORMAT || schemaVersion !== LEARNER_SCHEMA_VERSION)
    throw new Error(
      `content/release.json is not a learner copy this app can read. It says format ` +
        `${JSON.stringify(format)}, schemaVersion ${JSON.stringify(schemaVersion)}; this app ` +
        `reads format "${LEARNER_FORMAT}", schemaVersion ${LEARNER_SCHEMA_VERSION}. ` +
        'Regenerate it in the content repository, from a clean checkout of a content@ tag: ' +
        'npm run build -- --target learner --release <tag> --out <web>/content/release.json. ' +
        'Never commit the full artefact (dist/content.json), and never edit the file by hand.',
    );
  return file as LearnerCopy;
}

/**
 * The learner copy this build was made from, checked: the baseline. What is
 * fixed at build time (the redirects, hiddenCourseSlugs) reads this, never
 * the active copy.
 */
export const baselineCopy: LearnerCopy = readLearnerCopy(release);

/**
 * The active learner copy: the baseline, or a newer published release the
 * browser has verified and activated. Screens use `courses`; this is for
 * what describes the copy itself.
 */
export let learnerCopy: LearnerCopy = baselineCopy;

/** Which content release is active, e.g. content@2026.09.1. */
export let contentVersion: string = baselineCopy.release;

/**
 * A release name, content@YYYY.MM.N: the tag a learner copy was built from.
 * A development build, content@YYYY.MM.dev+<sha>, never matches. The same
 * pattern as the content build's RELEASE_NAME.
 */
export const RELEASE_NAME = /^content@\d{4}\.\d{2}\.\d+$/;
export function isReleaseName(name: string): boolean {
  return RELEASE_NAME.test(name);
}

/**
 * Why a build must not go to production, or null when it may. Production
 * serves only a tagged content release (ADR-0028); a development build of
 * content is for previews and local work. `vercelEnv` is VERCEL_ENV, which
 * Vercel sets to "production" only for production builds. next.config.ts
 * throws with this message.
 */
export function productionReleaseProblem(
  vercelEnv: string | undefined,
  releaseName: string,
): string | null {
  if (vercelEnv !== 'production' || isReleaseName(releaseName)) return null;
  return (
    `This is a production build, and content/release.json is ${JSON.stringify(releaseName)}, ` +
    'which is not a content release (content@YYYY.MM.N). Production serves only a tagged ' +
    'release: regenerate the file from a clean checkout of the tag with --release <tag>, ' +
    'and merge that first.'
  );
}

// Presentation is the app's, not the curriculum's: which slug, tint and
// world illustration each language gets. Order is the order courses are shown.
// A language here that the learner copy does not hold is not shown, and its
// old URLs redirect (lib/redirects.ts).
const PRESENTATION: Record<
  string,
  { id: CourseId; color: string; image: string }
> = {
  ps: { id: 'pashto', color: '#c4e5ff', image: 'world-pashto' },
  hno: { id: 'hindko', color: '#d3f4d8', image: 'world-hindko' },
  ur: { id: 'urdu', color: '#ffd3df', image: 'world-urdu' },
};

/**
 * The language codes the app knows how to present. A learner copy holding
 * any other language is refused before it is activated
 * (lib/release-verify.ts): the screens would have no slug for it.
 */
export const PRESENTED_LANGUAGES: readonly string[] = Object.keys(PRESENTATION);

// ---------------------------------------------------------------------------
// Deterministic ordering. Distractors are listed in the content in a fixed
// order; showing them that way would put the answer in the same slot every
// time. A shuffle seeded by the exercise id varies the slot across exercises
// while keeping it stable across renders and sessions, so the hint a learner
// remembers is not "the third one".
// ---------------------------------------------------------------------------

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function shuffled<T>(list: T[], seedText: string): T[] {
  const out = [...list];
  let seed = seedFrom(seedText) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const words = (meaning: string) => meaning.split(' ').filter(Boolean);

function toPhrase(item: LearnerItem): Phrase {
  return {
    id: item.id,
    native: item.native,
    roman: item.romanisation,
    meaning: item.meaning,
    context: item.context ?? '',
    note: item.usage_note ?? '',
    source: item.citation,
  };
}

function toExercise(ex: LearnerExercise, phrases: Phrase[]): Exercise {
  const byId = new Map(phrases.map((p) => [p.id, p]));
  const phrase = byId.get(ex.item)!;
  const distractors = ex.options.map((id) => byId.get(id)!);
  if (ex.kind === 'assemble') {
    // Extra tiles come from the other phrases' meanings, so they are real
    // words from this lesson rather than a fixed pair, and never words the
    // answer itself contains.
    const answer = new Set(words(phrase.meaning).map((w) => w.toLowerCase()));
    // Distractors lose trailing punctuation ("mean?" -> "mean"); the answer's
    // own words keep theirs, because the assembled line must equal the meaning.
    const candidates = [
      ...new Set(
        phrases
          .filter((p) => p.id !== phrase.id)
          .flatMap((p) => words(p.meaning))
          .map((w) => w.replace(/[?!.,]+$/, ''))
          .filter((w) => w && !answer.has(w.toLowerCase())),
      ),
    ];
    return {
      id: ex.id,
      kind: ex.kind,
      phrase,
      options: [],
      prompt: ex.prompt,
      tiles: shuffled(candidates, ex.id).slice(0, 2),
    };
  }
  return {
    id: ex.id,
    kind: ex.kind,
    phrase,
    options: shuffled([phrase, ...distractors], ex.id),
    prompt: ex.prompt,
    tiles: [],
  };
}

function toCourses(copy: LearnerCopy): Course[] {
  const language = new Map(copy.languages.map((l) => [l.code, l]));
  const variety = new Map(copy.varieties.map((v) => [v.id, v]));
  const order = Object.keys(PRESENTATION);
  return copy.courses
    .filter((c) => PRESENTATION[c.language] && language.has(c.language))
    .sort((a, b) => order.indexOf(a.language) - order.indexOf(b.language))
    .map((c) => {
      const lang = language.get(c.language)!;
      const look = PRESENTATION[c.language];
      const lessons: Lesson[] = c.units.flatMap((u) =>
        u.lessons.map((l) => {
          const phrases = l.items.map(toPhrase);
          return {
            id: l.id,
            title: l.title,
            subtitle: l.subtitle,
            objective: l.objective,
            unitId: u.id,
            unitTitle: u.title,
            phrases,
            exercises: l.exercises.map((ex) => toExercise(ex, phrases)),
          };
        }),
      );
      return {
        id: look.id,
        courseId: c.id,
        lang: c.language,
        dir: lang.direction,
        name: lang.name,
        courseName: c.name,
        native: lang.native_name,
        varietyId: c.variety,
        varietyLabel: variety.get(c.variety)?.learner_label ?? '',
        tagline: c.tagline,
        color: look.color,
        image: look.image,
        lessons,
      };
    });
}

/** The baseline's courses, for what is fixed at build time (lib/redirects.ts). */
export const baselineCourses: Course[] = toCourses(baselineCopy);

/** The courses learners see: every course in the active learner copy, in display order. */
export let courses: Course[] = baselineCourses;

/** A course the learner can see, by slug. A language not in the release is not found. */
export function getCourse(id: string): Course | undefined {
  return courses.find((c) => c.id === id);
}

/**
 * The learner's remembered course, resolved when it is read: the course
 * `selected` names, or undefined when nothing is chosen yet or the stored
 * slug is a course this release does not hold, such as `hindko` from the MVP.
 * With undefined, the screens offer the language picker instead of choosing a
 * language for the learner. Nothing writes this back: a returning Hindko
 * learner keeps `selected: 'hindko'` in storage, and the day Hindko is in a
 * release, it is their course again.
 */
export function selectedCourse(selected: string | null): Course | undefined {
  return selected ? getCourse(selected) : undefined;
}

/**
 * Where a lesson URL goes when its course is one learners can see but this
 * release does not hold the lesson: that course's map. A lesson leaves a
 * release when it is retired, and browsers remember the permanent redirects
 * from the MVP's lesson URLs, so old bookmarks and links then land on the map
 * rather than on "not found". Null for a lesson the release holds, and for a
 * course it does not show, which stays the not-found view (or its redirect).
 * The lesson page writes nothing; the map then records the course the URL
 * named as the learner's choice, as it does whenever it is opened.
 */
export function missingLessonRedirect(
  courseSlug: string,
  lessonId: string,
): string | null {
  const course = getCourse(courseSlug);
  if (!course || course.lessons.some((l) => l.id === lessonId)) return null;
  return `/learn/${course.id}`;
}

/**
 * Where a course's phrases come from, for the credits in Settings: each
 * distinct citation of its phrases, in lesson order. A citation that only
 * adds a note to one already listed, such as "<source>; the name Sara
 * inserted into a sourced template", is covered by that one and not listed
 * again. Each phrase's full citation is still shown with its lesson hint.
 */
export function phraseSources(course: Course): string[] {
  const all = [
    ...new Set(course.lessons.flatMap((l) => l.phrases.map((p) => p.source))),
  ];
  return all.filter(
    (source) => !all.some((other) => source.startsWith(`${other};`)),
  );
}

/**
 * The slugs of languages the app knows how to show but the baseline learner
 * copy does not hold, such as `hindko` until it is reviewed. Their old URLs
 * redirect, temporarily, to /learn (lib/redirects.ts). Fixed at build time,
 * like the redirects, so it reads the baseline and never the active copy.
 */
export const hiddenCourseSlugs: CourseId[] = Object.values(PRESENTATION)
  .map((look) => look.id)
  .filter((slug) => !baselineCourses.some((c) => c.id === slug));

// Every lesson in a learner copy. Stored progress on a lesson the copy does
// not hold (retired, or in a language not shown) is kept all the same
// (lib/progress.ts); these only say what the active release has.
function lessonIndex(copy: LearnerCopy): Map<string, LearnerLesson> {
  return new Map(
    copy.courses.flatMap((c) =>
      c.units.flatMap((u) => u.lessons.map((l) => [l.id, l] as const)),
    ),
  );
}
function legacyIndex(copy: LearnerCopy): Record<string, string> {
  return Object.fromEntries(
    copy.keymap.lessons.map((row) => [row.legacy_key, row.lesson_id]),
  );
}
let everyLesson = lessonIndex(baselineCopy);
export function knownLesson(id: string): boolean {
  return everyLesson.has(id);
}
/** How many exercises a lesson has in the active release. */
export function lessonSize(id: string): number | undefined {
  return everyLesson.get(id)?.exercises.length;
}

/** legacy "pashto/greetings" -> "ps-lsn-0a41c2", from the keymap that travels with the release. */
export let legacyLessonIds: Record<string, string> = legacyIndex(baselineCopy);

/**
 * `copy` without the courses whose slug this build hides (hiddenCourseSlugs),
 * and without their keymap rows. The build's redirects send those slugs'
 * URLs to /learn, so a course a published release adds in such a language
 * (Hindko, once reviewed) would be a card whose every link bounces. It is
 * shown from the next deploy, whose baseline holds it. The copy itself, and
 * its hash, are left as they are.
 */
function shownCopy(copy: LearnerCopy): LearnerCopy {
  const hidden = new Set(
    copy.courses
      .filter((c) => {
        const slug = PRESENTATION[c.language]?.id;
        return slug !== undefined && hiddenCourseSlugs.includes(slug);
      })
      .map((c) => c.id),
  );
  if (hidden.size === 0) return copy;
  return {
    ...copy,
    courses: copy.courses.filter((c) => !hidden.has(c.id)),
    keymap: {
      ...copy.keymap,
      lessons: copy.keymap.lessons.filter((row) => !hidden.has(row.course_id)),
      courses: copy.keymap.courses.filter((row) => !hidden.has(row.course_id)),
    },
  };
}

// The baseline's derived views, kept so resetToBaseline() puts back the very
// objects the module started with.
const baseline = {
  everyLesson,
  legacyLessonIds,
};

/**
 * Makes `copy` the active learner copy: every live binding above, and every
 * reader (getCourse, lessonSize, knownLesson, selectedCourse,
 * missingLessonRedirect), now answers from it, less any course this build
 * hides (shownCopy()). The caller has verified it
 * (lib/release-verify.ts). Called only from browser effects, never while the
 * server renders.
 */
export function activateRelease(copy: LearnerCopy): void {
  if (copy === baselineCopy) {
    resetToBaseline();
    return;
  }
  // Everything is derived first, so a copy that cannot be read leaves the
  // active one exactly as it was.
  const shown = shownCopy(copy);
  const next = {
    courses: toCourses(shown),
    everyLesson: lessonIndex(shown),
    legacyLessonIds: legacyIndex(shown),
  };
  learnerCopy = copy;
  contentVersion = copy.release;
  courses = next.courses;
  everyLesson = next.everyLesson;
  legacyLessonIds = next.legacyLessonIds;
}

/** Makes the committed baseline the active learner copy again. */
export function resetToBaseline(): void {
  learnerCopy = baselineCopy;
  contentVersion = baselineCopy.release;
  courses = baselineCourses;
  everyLesson = baseline.everyLesson;
  legacyLessonIds = baseline.legacyLessonIds;
}

export function evaluate(
  exercise: Exercise,
  answer: string | string[] | Record<string, string>,
): boolean {
  if (exercise.kind === 'assemble')
    return (
      Array.isArray(answer) && answer.join(' ') === exercise.phrase.meaning
    );
  if (exercise.kind === 'match')
    return (
      typeof answer === 'object' &&
      !Array.isArray(answer) &&
      exercise.options.every((p) => answer[p.id] === p.id)
    );
  return answer === exercise.phrase.id;
}
