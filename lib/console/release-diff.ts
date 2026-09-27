/**
 * What changes for learners between two learner copies (docs/platform.md
 * 4.10): lessons added, removed and changed, and for a changed lesson which
 * of its fields, phrases and exercises changed. Pure, so the publish page
 * can explain a release in plain English and the tests can pin it down.
 *
 * The database's preview_release() already sorts lessons into added,
 * changed, removed and carried (it knows why a lesson is left out or kept
 * at its last published version). This module adds the field-level detail
 * for a changed lesson, and recomputes a copy's contentHash so the page can
 * check what it shows.
 *
 * Imported by node tests: relative imports with .ts, erasable TypeScript only.
 */
import { canonicalJson } from '../canonical-json.ts';
import { sha256 } from '../sha256.ts';

// The learner copy's shapes (polilingo.learner@1), as far as a diff needs them.
export type CopyItem = {
  id: string;
  native: string;
  romanisation: string;
  meaning: string;
  context?: string;
  usage_note?: string;
  variety: string;
  citation: string;
};
export type CopyExercise = {
  id: string;
  kind: string;
  item: string;
  prompt: string;
  options: string[];
};
export type CopyLesson = {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  objective: string;
  variety: string;
  items: CopyItem[];
  exercises: CopyExercise[];
};
export type CopyUnit = {
  id: string;
  order: number;
  title: string;
  lessons: CopyLesson[];
};
export type CopyCourse = {
  id: string;
  language: string;
  variety: string;
  name: string;
  tagline: string;
  units: CopyUnit[];
};
export type ReleaseCopy = {
  release?: string;
  contentHash?: string;
  languages: {
    code: string;
    name: string;
    native_name: string;
    direction: string;
  }[];
  varieties: { id: string; language: string; learner_label: string }[];
  courses: CopyCourse[];
  keymap: {
    lessons: { legacy_key: string; lesson_id: string; course_id: string }[];
    courses: { legacy_id: string; course_id: string }[];
    items: { legacy_ref: string; item_id: string }[];
  };
};

/** Where a lesson sits in a copy. */
export type LessonPlace = {
  id: string;
  title: string;
  language: string;
  courseId: string;
  courseName: string;
  unitId: string;
  unitTitle: string;
  order: number;
};

export type LessonField =
  | 'title'
  | 'subtitle'
  | 'objective'
  | 'variety'
  | 'unit'
  | 'order';

export type ItemField =
  | 'native'
  | 'romanisation'
  | 'meaning'
  | 'context'
  | 'usage_note'
  | 'variety'
  | 'citation';

export type ItemChange = { id: string; fields: ItemField[] };

export type LessonChange = LessonPlace & {
  /** The lesson's own fields that changed, in a fixed order. */
  fields: LessonField[];
  items: {
    added: string[];
    removed: string[];
    changed: ItemChange[];
    /** The phrases both copies hold are in a different order. */
    reordered: boolean;
  };
  exercises: {
    added: string[];
    removed: string[];
    changed: string[];
    reordered: boolean;
  };
};

export type ReleaseDiff = {
  added: LessonPlace[];
  removed: LessonPlace[];
  changed: LessonChange[];
  /** Lessons in both copies with nothing changed. */
  unchanged: number;
  /** Language codes only one of the copies holds. */
  languagesAdded: string[];
  languagesRemoved: string[];
};

const LESSON_FIELDS: readonly LessonField[] = [
  'title',
  'subtitle',
  'objective',
  'variety',
  'unit',
  'order',
];
const ITEM_FIELDS: readonly ItemField[] = [
  'native',
  'romanisation',
  'meaning',
  'context',
  'usage_note',
  'variety',
  'citation',
];

type Placed = LessonPlace & { lesson: CopyLesson };

/** Every lesson of a copy with its place, in the copy's own order. */
export function lessonPlaces(copy: ReleaseCopy | null): Map<string, Placed> {
  const out = new Map<string, Placed>();
  for (const course of copy?.courses ?? [])
    for (const unit of course.units)
      for (const lesson of unit.lessons)
        out.set(lesson.id, {
          id: lesson.id,
          title: lesson.title,
          language: course.language,
          courseId: course.id,
          courseName: course.name,
          unitId: unit.id,
          unitTitle: unit.title,
          order: lesson.order,
          lesson,
        });
  return out;
}

function place({ lesson: _lesson, ...rest }: Placed): LessonPlace {
  return rest;
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** Whether the ids both lists hold appear in a different order. */
function reorderedIds(before: string[], after: string[]): boolean {
  const kept = new Set(after);
  const both = before.filter((id) => kept.has(id));
  const shared = new Set(both);
  const inAfter = after.filter((id) => shared.has(id));
  return both.some((id, i) => inAfter[i] !== id);
}

function diffList<T extends { id: string }>(
  before: T[],
  after: T[],
): {
  added: string[];
  removed: string[];
  common: [T, T][];
  reordered: boolean;
} {
  const old = new Map(before.map((x) => [x.id, x]));
  const now = new Map(after.map((x) => [x.id, x]));
  return {
    added: after.filter((x) => !old.has(x.id)).map((x) => x.id),
    removed: before.filter((x) => !now.has(x.id)).map((x) => x.id),
    common: after.flatMap((x) => {
      const was = old.get(x.id);
      return was ? [[was, x] as [T, T]] : [];
    }),
    reordered: reorderedIds(
      before.map((x) => x.id),
      after.map((x) => x.id),
    ),
  };
}

/** The field-level change of one lesson, or null when nothing changed. */
export function diffLesson(before: Placed, after: Placed): LessonChange | null {
  const fields = LESSON_FIELDS.filter((field) => {
    switch (field) {
      case 'unit':
        return before.unitId !== after.unitId;
      case 'order':
        return (
          before.unitId === after.unitId &&
          before.lesson.order !== after.lesson.order
        );
      default:
        return before.lesson[field] !== after.lesson[field];
    }
  });

  const items = diffList(before.lesson.items, after.lesson.items);
  const itemChanges: ItemChange[] = items.common.flatMap(([was, now]) => {
    const changed = ITEM_FIELDS.filter((field) => was[field] !== now[field]);
    return changed.length ? [{ id: now.id, fields: changed }] : [];
  });

  const exercises = diffList(before.lesson.exercises, after.lesson.exercises);
  const exerciseChanges = exercises.common
    .filter(([was, now]) => !same(was, now))
    .map(([, now]) => now.id);

  const change: LessonChange = {
    ...place(after),
    fields,
    items: {
      added: items.added,
      removed: items.removed,
      changed: itemChanges,
      reordered: items.reordered,
    },
    exercises: {
      added: exercises.added,
      removed: exercises.removed,
      changed: exerciseChanges,
      reordered: exercises.reordered,
    },
  };
  const nothing =
    fields.length === 0 &&
    items.added.length === 0 &&
    items.removed.length === 0 &&
    itemChanges.length === 0 &&
    !items.reordered &&
    exercises.added.length === 0 &&
    exercises.removed.length === 0 &&
    exerciseChanges.length === 0 &&
    !exercises.reordered;
  // Anything else that differs (a field this module does not know yet)
  // still counts as a change, with no detail.
  if (nothing && same(before.lesson, after.lesson)) return null;
  return change;
}

/**
 * What changes for learners going from `before` (the live copy, or null
 * when nothing was ever published) to `after`. Lessons keep `after`'s order;
 * removed ones keep `before`'s.
 */
export function diffReleases(
  before: ReleaseCopy | null,
  after: ReleaseCopy,
): ReleaseDiff {
  const old = lessonPlaces(before);
  const now = lessonPlaces(after);
  const added: LessonPlace[] = [];
  const changed: LessonChange[] = [];
  let unchanged = 0;
  for (const [id, lesson] of now) {
    const was = old.get(id);
    if (!was) {
      added.push(place(lesson));
      continue;
    }
    const change = diffLesson(was, lesson);
    if (change) changed.push(change);
    else unchanged += 1;
  }
  const removed = [...old.values()]
    .filter((lesson) => !now.has(lesson.id))
    .map(place);
  const oldLanguages = new Set((before?.languages ?? []).map((l) => l.code));
  const newLanguages = new Set(after.languages.map((l) => l.code));
  return {
    added,
    removed,
    changed,
    unchanged,
    languagesAdded: [...newLanguages].filter((c) => !oldLanguages.has(c)),
    languagesRemoved: [...oldLanguages].filter((c) => !newLanguages.has(c)),
  };
}

const ITEM_FIELD_WORDS: Record<ItemField, string> = {
  native: 'text',
  romanisation: 'romanisation',
  meaning: 'meaning',
  context: 'context',
  usage_note: 'usage note',
  variety: 'variety',
  citation: 'source',
};

const LESSON_FIELD_WORDS: Record<LessonField, string> = {
  title: 'New title',
  subtitle: 'New subtitle',
  objective: 'New goal',
  variety: 'Different variety',
  unit: 'Moved to another unit',
  order: 'New place in its unit',
};

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * A changed lesson in short plain-English phrases, for the publish page:
 * ["New title", "2 phrases added", "1 phrase edited (meaning)", …].
 */
export function describeLessonChange(change: LessonChange): string[] {
  const out = change.fields.map((field) => LESSON_FIELD_WORDS[field]);
  const { items, exercises } = change;
  if (items.added.length)
    out.push(`${count(items.added.length, 'phrase', 'phrases')} added`);
  if (items.removed.length)
    out.push(`${count(items.removed.length, 'phrase', 'phrases')} removed`);
  if (items.changed.length) {
    const fields = ITEM_FIELDS.filter((field) =>
      items.changed.some((c) => c.fields.includes(field)),
    ).map((field) => ITEM_FIELD_WORDS[field]);
    out.push(
      `${count(items.changed.length, 'phrase', 'phrases')} edited (${fields.join(', ')})`,
    );
  }
  if (items.reordered) out.push('Phrases in a new order');
  if (exercises.added.length)
    out.push(`${count(exercises.added.length, 'exercise', 'exercises')} added`);
  if (exercises.removed.length)
    out.push(
      `${count(exercises.removed.length, 'exercise', 'exercises')} removed`,
    );
  if (exercises.changed.length)
    out.push(
      `${count(exercises.changed.length, 'exercise', 'exercises')} edited`,
    );
  if (exercises.reordered) out.push('Exercises in a new order');
  return out.length ? out : ['Small changes'];
}

/**
 * "sha256-" and the SHA-256 of the canonical JSON of a copy's languages,
 * varieties, courses and keymap: the contentHash the content build and the
 * database both compute.
 */
export function contentHashOf(copy: ReleaseCopy): string {
  const { languages, varieties, courses, keymap } = copy;
  return `sha256-${sha256(canonicalJson({ languages, varieties, courses, keymap }))}`;
}

export type HashCheck =
  | { ok: true; hash: string }
  | { ok: false; expected: string | null; actual: string };

/**
 * Recomputes a copy's contentHash and compares it with `expected` (by
 * default the hash the copy states). Anything that is not a copy fails.
 */
export function checkContentHash(
  copy: unknown,
  expected?: string | null,
): HashCheck {
  const stated =
    expected ??
    (copy && typeof copy === 'object'
      ? ((copy as { contentHash?: unknown }).contentHash ?? null)
      : null);
  const want = typeof stated === 'string' ? stated : null;
  if (
    !copy ||
    typeof copy !== 'object' ||
    !Array.isArray((copy as ReleaseCopy).courses)
  )
    return { ok: false, expected: want, actual: '' };
  const actual = contentHashOf(copy as ReleaseCopy);
  return actual === want
    ? { ok: true, hash: actual }
    : { ok: false, expected: want, actual };
}

/**
 * The verdict on a release read back after a publish: 'verified' when the
 * hash recomputed from the copy, the hash the copy states, the hash it was
 * served with and the hash the publish returned are all the same;
 * otherwise 'mismatch'. The learner app runs the same recomputation and
 * refuses a copy that fails it.
 */
export function readBackVerdict(
  copy: unknown,
  servedHash: unknown,
  publishedHash: string,
): 'verified' | 'mismatch' {
  const check = checkContentHash(copy, publishedHash);
  const stated =
    copy && typeof copy === 'object'
      ? (copy as { contentHash?: unknown }).contentHash
      : undefined;
  return check.ok && stated === publishedHash && servedHash === publishedHash
    ? 'verified'
    : 'mismatch';
}
