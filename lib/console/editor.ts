/**
 * The course maker’s pure logic (docs/platform.md 4.10): the shapes of the
 * editor’s page reads, the status a lesson or phrase shows, the tree’s
 * status counts, the reorder arithmetic behind the up and down buttons, the
 * readiness checklist, and form parsing that mirrors the database’s length
 * and provenance rules (supabase/migrations/20260928001400_editor.sql), so
 * most mistakes are caught before a round trip. The database still decides.
 *
 * No React, no Supabase: tests/editor.test.mjs imports it directly.
 */
import { normaliseNative } from '../script-check.ts';

// ---------------------------------------------------------------------------
// Page shapes: public.page_edit_tree() and public.page_edit_lesson()
// ---------------------------------------------------------------------------

export type Gate = 'open' | 'blocked';
export type ReviewStatus =
  | 'unreviewed'
  | 'approved'
  | 'changes_requested'
  | 'rejected';
export type Direction = 'rtl' | 'ltr';

export type TreeLesson = {
  id: string;
  title: string;
  subtitle: string;
  position: number;
  variety_id: string;
  publish_gate: Gate;
  review_status: ReviewStatus;
  submitted_at: string | null;
  updated_at: string;
  revision_no: number;
  items: number;
  exercises: number;
  demo: boolean;
};

export type TreeUnit = {
  id: string;
  title: string;
  goal: string;
  theme: string | null;
  position: number;
  publish_gate: Gate;
  revision_no: number;
  lessons: TreeLesson[];
};

export type TreeCourse = {
  id: string;
  name: string;
  variety_id: string;
  publish_gate: Gate;
  units: TreeUnit[];
};

export type TreeVariety = {
  id: string;
  name: string;
  learner_label: string;
  publish_gate: Gate;
  reviewers: number;
};

export type TreeLanguage = {
  code: string;
  name: string;
  native_name: string;
  direction: Direction;
  publish_gate: Gate;
  demo_period: { sunset: string; live: boolean } | null;
  varieties: TreeVariety[];
  courses: TreeCourse[];
};

export type EditTree = {
  is_admin: boolean;
  me: string | null;
  languages: TreeLanguage[];
};

export type Decision = {
  decision: 'approve' | 'request_changes' | 'reject';
  comment: string | null;
  at: string;
  current: boolean;
};

export type SourceType =
  | 'reviewer_attested'
  | 'community_attested'
  | 'published_work'
  | 'original';

export type EditItem = {
  id: string;
  position: number;
  native: string;
  romanisation: string;
  meaning: string;
  context: string | null;
  usage_note: string | null;
  variety_id: string;
  source_type: SourceType;
  source_citation: string;
  source_licence: string;
  source_retrieved: string | null;
  source_caveat: string | null;
  tags: string[];
  skills: string[];
  review_status: ReviewStatus;
  revision_no: number;
  text_fingerprint: string;
  review_fingerprint: string;
  updated_at: string;
  demo: boolean;
  used_by: number;
  last_decision: Decision | null;
};

export type ExerciseKind =
  | 'meaning'
  | 'translation'
  | 'match'
  | 'assemble'
  | 'context';

export type EditExercise = {
  id: string;
  position: number;
  kind: ExerciseKind;
  answer_item_id: string;
  prompt: string;
  options: string[];
  difficulty: number | null;
  skills: string[];
  revision_no: number;
};

export type Problem = {
  severity: 'blocking' | 'warning';
  code: string;
  message: string;
  target_type?: 'lesson' | 'item' | 'exercise';
  target_id?: string;
};

export type RevisionEntry = {
  object_type: string;
  object_id: string;
  revision_no: number;
  reason: string;
  at: string;
  mine: boolean;
  author: string | null;
};

export type EditLessonPage = {
  me: string | null;
  is_admin: boolean;
  language: {
    code: string;
    name: string;
    native_name: string;
    direction: Direction;
  };
  course: { id: string; name: string; variety_id: string };
  unit: { id: string; title: string; position: number; publish_gate: Gate };
  varieties: { id: string; name: string; learner_label: string }[];
  lesson: {
    id: string;
    title: string;
    subtitle: string;
    objective: string;
    variety_id: string;
    estimated_minutes: number | null;
    position: number | null;
    publish_gate: Gate;
    effective_gate: Gate | null;
    review_status: ReviewStatus;
    review_fingerprint: string;
    submitted_at: string | null;
    /** Sent back by a reviewer and changed since, so it may go again. */
    changed_since_review: boolean;
    /** Active reviewers of the lesson’s variety. */
    reviewers: number;
    revision_no: number;
    updated_at: string;
    retired_at: string | null;
    demo: boolean;
    last_decision: Decision | null;
  };
  items: EditItem[];
  exercises: EditExercise[];
  problems: Problem[];
  revisions: { count: number; recent: RevisionEntry[] };
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** The badge a lesson or phrase shows; a subset of the kit’s StatusBadge. */
export type EditorStatus =
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'demo'
  | 'retired';

export const EDITOR_STATUSES: readonly EditorStatus[] = [
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'rejected',
  'demo',
  'retired',
];

/**
 * "In review" is not stored (docs/platform.md 3.5): it is an unreviewed
 * lesson that has been submitted. Demo and retired win over everything.
 */
export function lessonStatus(lesson: {
  review_status: ReviewStatus;
  submitted_at: string | null;
  demo: boolean;
  retired_at?: string | null;
}): EditorStatus {
  if (lesson.retired_at) return 'retired';
  if (lesson.demo) return 'demo';
  switch (lesson.review_status) {
    case 'approved':
      return 'approved';
    case 'changes_requested':
      return 'changes_requested';
    case 'rejected':
      return 'rejected';
    default:
      return lesson.submitted_at ? 'in_review' : 'draft';
  }
}

/** A phrase is "in review" while its lesson is submitted and it is unreviewed. */
export function itemStatus(
  item: { review_status: ReviewStatus; demo: boolean },
  lessonSubmitted: boolean,
): EditorStatus {
  if (item.demo) return 'demo';
  switch (item.review_status) {
    case 'approved':
      return 'approved';
    case 'changes_requested':
      return 'changes_requested';
    case 'rejected':
      return 'rejected';
    default:
      return lessonSubmitted ? 'in_review' : 'draft';
  }
}

export type StatusCounts = Record<EditorStatus, number>;

export function emptyCounts(): StatusCounts {
  return {
    draft: 0,
    in_review: 0,
    changes_requested: 0,
    approved: 0,
    rejected: 0,
    demo: 0,
    retired: 0,
  };
}

export function countStatuses(
  lessons: readonly TreeLesson[],
  into: StatusCounts = emptyCounts(),
): StatusCounts {
  for (const lesson of lessons) into[lessonStatus(lesson)] += 1;
  return into;
}

/** The non-zero counts, in badge order, for a compact summary. */
export function nonZeroCounts(
  counts: StatusCounts,
): { status: EditorStatus; count: number }[] {
  return EDITOR_STATUSES.filter((s) => counts[s] > 0).map((status) => ({
    status,
    count: counts[status],
  }));
}

export type TreeLessonView = TreeLesson & { status: EditorStatus };
export type TreeUnitView = Omit<TreeUnit, 'lessons'> & {
  lessons: TreeLessonView[];
  counts: StatusCounts;
};
export type TreeCourseView = Omit<TreeCourse, 'units'> & {
  units: TreeUnitView[];
  counts: StatusCounts;
  varietyName: string;
};
export type TreeLanguageView = Omit<TreeLanguage, 'courses'> & {
  courses: TreeCourseView[];
  counts: StatusCounts;
};
export type TreeView = {
  isAdmin: boolean;
  languages: TreeLanguageView[];
  counts: StatusCounts;
  lessonCount: number;
};

/**
 * page_edit_tree() with statuses and counts at every level. Languages that
 * have courses come first (in the order the database gave), so the work is
 * at the top and a language with nothing to edit yet sits quietly below.
 */
export function treeView(tree: EditTree): TreeView {
  const total = emptyCounts();
  let lessonCount = 0;
  const ordered = [
    ...tree.languages.filter((l) => l.courses.length > 0),
    ...tree.languages.filter((l) => l.courses.length === 0),
  ];
  const languages = ordered.map((language) => {
    const languageCounts = emptyCounts();
    const varietyNames = new Map(language.varieties.map((v) => [v.id, v.name]));
    const courses = language.courses.map((course) => {
      const courseCounts = emptyCounts();
      const units = course.units.map((unit) => {
        const lessons = unit.lessons.map((lesson) => ({
          ...lesson,
          status: lessonStatus(lesson),
        }));
        const counts = countStatuses(unit.lessons);
        countStatuses(unit.lessons, courseCounts);
        countStatuses(unit.lessons, languageCounts);
        countStatuses(unit.lessons, total);
        lessonCount += lessons.length;
        return { ...unit, lessons, counts };
      });
      return {
        ...course,
        units,
        counts: courseCounts,
        varietyName: varietyNames.get(course.variety_id) ?? course.variety_id,
      };
    });
    return { ...language, courses, counts: languageCounts };
  });
  return { isAdmin: tree.is_admin, languages, counts: total, lessonCount };
}

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

export type MoveDirection = 'up' | 'down';

/**
 * The ids with `id` swapped one place up or down, or null when it cannot
 * move that way (already first or last, or not in the list).
 */
export function moveInList(
  ids: readonly string[],
  id: string,
  direction: MoveDirection,
): string[] | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** "Moved to position 2 of 5." for the live region. */
export function movedAnnouncement(
  label: string,
  ids: readonly string[],
  id: string,
): string {
  const at = ids.indexOf(id);
  return at < 0
    ? `${label} moved.`
    : `${label} moved to position ${at + 1} of ${ids.length}.`;
}

// ---------------------------------------------------------------------------
// Readiness: what submit_lesson() will ask for
// ---------------------------------------------------------------------------

export const MAX_ITEMS = 12;
export const MIN_EXERCISES = 6;

export type ReadinessCheck = {
  key: 'items' | 'exercises' | 'problems' | 'request';
  ok: boolean;
  label: string;
  detail: string;
};

/** Where the lesson sits under its publish gates, for the held-back note. */
export type LessonGates = { lesson: Gate; unit: Gate };

/**
 * The held-back note in plain words: which gate is closed when we can tell
 * (the lesson’s own, or its unit’s), and who opens it.
 */
export function heldBackMessage(gates?: LessonGates): string {
  if (gates?.lesson === 'blocked')
    return 'This lesson is still held back, so learners won’t see it yet. An admin opens it.';
  if (gates?.unit === 'blocked')
    return 'This unit is still held back, so learners won’t see the lesson yet. An admin opens it.';
  return 'Its course is still held back, so learners won’t see the lesson yet. An admin opens it.';
}

/**
 * The lesson’s problems as the editor lists them. The database words the
 * exercise count two ways (blocking "at least one" at none, a warning under
 * six), but submit_lesson() refuses anything under six, so the editor shows
 * one blocking line that says six. The held-back warning is reworded without
 * the database’s terms. readiness() counts this same list.
 */
export function editorProblems(
  page: {
    exercises: readonly unknown[];
    problems: readonly Problem[];
  },
  gates?: LessonGates,
): Problem[] {
  const exercises = page.exercises.length;
  const problems = page.problems
    .filter((p) => p.code !== 'PL422_TOO_FEW_EXERCISES')
    .map((p) =>
      p.code === 'PL409_NOT_PUBLISHABLE' && p.severity === 'warning'
        ? { ...p, message: heldBackMessage(gates) }
        : p,
    );
  if (exercises < MIN_EXERCISES)
    problems.push({
      severity: 'blocking',
      code: 'PL422_TOO_FEW_EXERCISES',
      message: `A reviewed lesson needs at least ${MIN_EXERCISES} exercises. This one has ${exercises}.`,
      target_type: 'lesson',
    });
  return problems;
}

/**
 * A problem the checklist already says in its own row: too few exercises
 * (the Exercises row), and no phrases or too many (the Phrases row). The
 * review panel lists the rest under "Problems", so no sentence shows twice.
 */
export function coveredByChecklist(problem: Problem): boolean {
  if (problem.code === 'PL422_TOO_FEW_EXERCISES') return true;
  return (
    problem.target_type === 'lesson' &&
    (problem.code === 'PL422_BAD_INPUT' || problem.code === 'PL422_LESSON_FULL')
  );
}

/** The problems the review panel lists: blocking ones to fix, and notes. */
export function checklistProblems(problems: readonly Problem[]): {
  blocking: Problem[];
  notes: Problem[];
} {
  const shown = problems.filter((p) => !coveredByChecklist(p));
  return {
    blocking: shown.filter((p) => p.severity === 'blocking'),
    notes: shown.filter((p) => p.severity !== 'blocking'),
  };
}

/** Whether a reviewer sent the lesson back (asked for changes or rejected it). */
export const sentBack = (lesson: { review_status: ReviewStatus }): boolean =>
  lesson.review_status === 'changes_requested' ||
  lesson.review_status === 'rejected';

/**
 * The review checklist: what submit_lesson() will ask for, plus, for a
 * lesson a reviewer sent back, a change since that review (the database
 * refuses to take the same text back).
 */
export function readiness(
  page: {
    items: readonly unknown[];
    exercises: readonly unknown[];
    problems: readonly Problem[];
  },
  lesson?: { review_status: ReviewStatus; changed_since_review: boolean },
  gates?: LessonGates,
): { ready: boolean; checks: ReadinessCheck[] } {
  const items = page.items.length;
  const exercises = page.exercises.length;
  const blocking = checklistProblems(editorProblems(page, gates)).blocking
    .length;
  const checks: ReadinessCheck[] = [
    {
      key: 'items',
      ok: items >= 1 && items <= MAX_ITEMS,
      label: 'Phrases',
      detail:
        items === 0
          ? 'Add at least one phrase.'
          : `${items} of up to ${MAX_ITEMS}.`,
    },
    {
      key: 'exercises',
      ok: exercises >= MIN_EXERCISES,
      label: 'Exercises',
      detail:
        exercises >= MIN_EXERCISES
          ? `${exercises}, at least ${MIN_EXERCISES} needed.`
          : `${exercises} so far. A reviewed lesson needs at least ${MIN_EXERCISES}.`,
    },
    {
      key: 'problems',
      ok: blocking === 0,
      label: 'Problems',
      detail:
        blocking === 0
          ? 'Nothing to fix.'
          : `${blocking} ${blocking === 1 ? 'problem' : 'problems'} to fix.`,
    },
  ];
  if (lesson && sentBack(lesson))
    checks.push({
      key: 'request',
      ok: lesson.changed_since_review,
      label: 'Reviewer’s request',
      detail: lesson.changed_since_review
        ? 'Changed since the review.'
        : 'Not changed since the review yet.',
    });
  return { ready: checks.every((c) => c.ok), checks };
}

/** The checks still to do, for the status strip ("2 checks to do"). */
export const checksToDo = (checks: readonly ReadinessCheck[]): number =>
  checks.filter((c) => !c.ok).length;

export type NextStep =
  | { kind: 'locked' }
  | { kind: 'waiting' }
  | { kind: 'approved' }
  | { kind: 'submit'; resend: boolean }
  | { kind: 'todo'; count: number };

/**
 * The one thing the lesson needs next, for the status strip and the phone’s
 * bottom bar: send it (or send it back), finish the checks, or nothing while
 * it waits or once it is approved.
 */
export function nextStep(
  lesson: {
    review_status: ReviewStatus;
    submitted_at: string | null;
  },
  checks: readonly ReadinessCheck[],
  locked: boolean,
): NextStep {
  if (locked) return { kind: 'locked' };
  if (lesson.submitted_at !== null && lesson.review_status === 'unreviewed')
    return { kind: 'waiting' };
  if (lesson.review_status === 'approved') return { kind: 'approved' };
  const count = checksToDo(checks);
  if (count > 0) return { kind: 'todo', count };
  return { kind: 'submit', resend: sentBack(lesson) };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const EXERCISE_KIND_LABELS: Record<ExerciseKind, string> = {
  meaning: 'Meaning',
  translation: 'Translation',
  match: 'Match',
  assemble: 'Build the sentence',
  context: 'In context',
};

export const EXERCISE_KIND_HINTS: Record<ExerciseKind, string> = {
  meaning: 'The learner reads the phrase and picks its meaning.',
  translation: 'The learner reads the meaning and picks the phrase.',
  match: 'The learner matches each phrase to its meaning.',
  assemble: 'The learner builds the meaning from word tiles. No choices.',
  context: 'The learner reads a situation and picks what to say.',
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  original: 'Written for PoliLingo',
  reviewer_attested: 'Confirmed by a reviewer',
  community_attested: 'Confirmed by native speakers',
  published_work: 'From a published work',
};

export const REVISION_REASON_LABELS: Record<string, string> = {
  import: 'imported',
  create: 'created',
  edit: 'edited',
  suggestion: 'changed by a suggestion',
  move: 'moved',
  reorder: 'reordered',
  retire: 'retired',
  gate: 'gate changed',
};

export const OBJECT_TYPE_LABELS: Record<string, string> = {
  lesson: 'Lesson',
  item: 'Phrase',
  exercise: 'Exercise',
  unit: 'Unit',
  course: 'Course',
};

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", or the date. */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return then.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Form parsing, mirroring the database’s rules
// ---------------------------------------------------------------------------

/** The database’s length limits, in characters (code points). */
export const LIMITS = {
  unitTitle: { min: 1, max: 60 },
  unitGoal: { min: 10, max: 300 },
  unitTheme: { min: 0, max: 60 },
  lessonTitle: { min: 1, max: 60 },
  lessonSubtitle: { min: 0, max: 120 },
  lessonObjective: { min: 10, max: 300 },
  minutes: { min: 3, max: 15 },
  native: { min: 1, max: 300 },
  romanisation: { min: 1, max: 300 },
  meaning: { min: 1, max: 200 },
  context: { min: 0, max: 300 },
  usageNote: { min: 0, max: 500 },
  citation: { min: 3, max: 300 },
  licence: { min: 2, max: 200 },
  caveat: { min: 0, max: 500 },
  prompt: { min: 1, max: 300 },
  reason: { min: 1, max: 500 },
  options: { min: 1, max: 11 },
} as const;

export const SOURCE_TYPES: readonly SourceType[] = [
  'original',
  'reviewer_attested',
  'community_attested',
  'published_work',
];

export const EXERCISE_KINDS: readonly ExerciseKind[] = [
  'meaning',
  'translation',
  'match',
  'assemble',
  'context',
];

/** Anything with FormData’s get (and optionally getAll). */
export type FormLike = {
  get(name: string): unknown;
  getAll?(name: string): unknown[];
};

export type FieldError = { field: string; code: string; message: string };
export type Parsed<T> = { ok: true; value: T } | ({ ok: false } & FieldError);

/** JavaScript’s \s trimmed, as the database trims (private.js_ws). */
export function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/^\s+|\s+$/g, '') : '';
}

/** Characters as the database counts them (code points). */
export const charLength = (text: string): number => Array.from(text).length;

/** The length rule for one field, or null when it passes. */
export function lengthError(
  field: string,
  label: string,
  text: string,
  limit: { min: number; max: number },
): FieldError | null {
  const length = charLength(text);
  if (length === 0 && limit.min > 0)
    return { field, code: 'PL422_LENGTH', message: `${label} can’t be empty.` };
  if (length > 0 && length < limit.min)
    return {
      field,
      code: 'PL422_LENGTH',
      message: `${label} needs at least ${limit.min} characters.`,
    };
  if (length > limit.max)
    return {
      field,
      code: 'PL422_LENGTH',
      message: `${label} can be at most ${limit.max} characters. This one has ${length}.`,
    };
  return null;
}

const fail = <T>(error: FieldError): Parsed<T> => ({ ok: false, ...error });

function firstError(checks: (FieldError | null)[]): FieldError | null {
  return checks.find((c) => c !== null) ?? null;
}

export type UnitFields = { title: string; goal: string; theme: string | null };

export function parseUnitForm(form: FormLike): Parsed<UnitFields> {
  const title = clean(form.get('title'));
  const goal = clean(form.get('goal'));
  const theme = clean(form.get('theme'));
  const error = firstError([
    lengthError('title', 'The unit title', title, LIMITS.unitTitle),
    lengthError('goal', 'The unit goal', goal, LIMITS.unitGoal),
    lengthError('theme', 'The theme', theme, LIMITS.unitTheme),
  ]);
  if (error) return fail(error);
  return { ok: true, value: { title, goal, theme: theme || null } };
}

export type LessonFields = {
  title: string;
  subtitle: string;
  objective: string;
  variety: string | null;
  estimated_minutes: number | null;
};

export function parseLessonForm(form: FormLike): Parsed<LessonFields> {
  const title = clean(form.get('title'));
  const subtitle = clean(form.get('subtitle'));
  const objective = clean(form.get('objective'));
  const variety = clean(form.get('variety'));
  const minutesText = clean(form.get('estimated_minutes'));
  const error = firstError([
    lengthError('title', 'The lesson title', title, LIMITS.lessonTitle),
    lengthError('subtitle', 'The subtitle', subtitle, LIMITS.lessonSubtitle),
    lengthError(
      'objective',
      'The objective',
      objective,
      LIMITS.lessonObjective,
    ),
  ]);
  if (error) return fail(error);
  let estimated_minutes: number | null = null;
  if (minutesText !== '') {
    const minutes = Number(minutesText);
    if (
      !Number.isInteger(minutes) ||
      minutes < LIMITS.minutes.min ||
      minutes > LIMITS.minutes.max
    )
      return fail({
        field: 'estimated_minutes',
        code: 'PL422_BAD_INPUT',
        message: `A lesson takes between ${LIMITS.minutes.min} and ${LIMITS.minutes.max} minutes.`,
      });
    estimated_minutes = minutes;
  }
  return {
    ok: true,
    value: {
      title,
      subtitle,
      objective,
      variety: variety || null,
      estimated_minutes,
    },
  };
}

export type ItemFields = {
  native: string;
  romanisation: string;
  meaning: string;
  context: string | null;
  usage_note: string | null;
  variety?: string;
  source_type: SourceType;
  source_citation: string;
  source_licence: string;
  source_retrieved: string | null;
  source_caveat: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date, YYYY-MM-DD, not after `today` (YYYY-MM-DD). */
export function isPastOrToday(date: string, today: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date &&
    date <= today
  );
}

/**
 * The phrase form. Native text is normalised as the database stores it;
 * the script rules themselves are ScriptField’s (lib/script-check.ts) and
 * the database’s.
 */
export function parseItemForm(
  form: FormLike,
  today: string,
): Parsed<ItemFields> {
  const native = normaliseNative(
    typeof form.get('native') === 'string'
      ? (form.get('native') as string)
      : '',
  );
  const romanisation = clean(form.get('romanisation'));
  const meaning = clean(form.get('meaning'));
  const context = clean(form.get('context'));
  const usageNote = clean(form.get('usage_note'));
  const variety = clean(form.get('variety'));
  const sourceType = clean(form.get('source_type'));
  const citation = clean(form.get('source_citation'));
  const licence = clean(form.get('source_licence'));
  const retrieved = clean(form.get('source_retrieved'));
  const caveat = clean(form.get('source_caveat'));

  const error = firstError([
    lengthError('native', 'The phrase', native, LIMITS.native),
    lengthError(
      'romanisation',
      'The romanisation',
      romanisation,
      LIMITS.romanisation,
    ),
    lengthError('meaning', 'The meaning', meaning, LIMITS.meaning),
    lengthError('context', 'The context', context, LIMITS.context),
    lengthError('usage_note', 'The usage note', usageNote, LIMITS.usageNote),
    (SOURCE_TYPES as readonly string[]).includes(sourceType)
      ? null
      : {
          field: 'source_type',
          code: 'PL422_PROVENANCE',
          message: 'Choose where this phrase comes from.',
        },
    charLength(citation) >= LIMITS.citation.min &&
    charLength(citation) <= LIMITS.citation.max
      ? null
      : {
          field: 'source_citation',
          code: 'PL422_PROVENANCE',
          message: `Say where this phrase comes from, in ${LIMITS.citation.min} to ${LIMITS.citation.max} characters.`,
        },
    charLength(licence) >= LIMITS.licence.min &&
    charLength(licence) <= LIMITS.licence.max
      ? null
      : {
          field: 'source_licence',
          code: 'PL422_PROVENANCE',
          message: `Say what licence it’s used under, in ${LIMITS.licence.min} to ${LIMITS.licence.max} characters.`,
        },
    retrieved === '' || isPastOrToday(retrieved, today)
      ? null
      : {
          field: 'source_retrieved',
          code: 'PL422_PROVENANCE',
          message: 'The retrieved date must be a real date, not in the future.',
        },
    lengthError('source_caveat', 'The caveat', caveat, LIMITS.caveat),
  ]);
  if (error) return fail(error);
  const value: ItemFields = {
    native,
    romanisation,
    meaning,
    context: context || null,
    usage_note: usageNote || null,
    source_type: sourceType as SourceType,
    source_citation: citation,
    source_licence: licence,
    source_retrieved: retrieved || null,
    source_caveat: caveat || null,
  };
  if (variety) value.variety = variety;
  return { ok: true, value };
}

export type ExerciseFields = {
  kind: ExerciseKind;
  answer: string;
  prompt: string;
  options: string[];
  difficulty: number | null;
};

/**
 * The exercise form: an assemble exercise has no choices; the others need
 * 1 to 11 distinct choices, never the answer itself.
 */
export function parseExerciseForm(form: FormLike): Parsed<ExerciseFields> {
  const kind = clean(form.get('kind'));
  const answer = clean(form.get('answer'));
  const prompt = clean(form.get('prompt'));
  const difficultyText = clean(form.get('difficulty'));
  const rawOptions = form.getAll ? form.getAll('options') : [];
  const options = [...new Set(rawOptions.map(clean).filter((o) => o !== ''))];

  if (!(EXERCISE_KINDS as readonly string[]).includes(kind))
    return fail({
      field: 'kind',
      code: 'PL422_BAD_INPUT',
      message: 'Choose a kind of exercise.',
    });
  if (answer === '')
    return fail({
      field: 'answer',
      code: 'PL422_BAD_INPUT',
      message: 'Choose the phrase that answers this exercise.',
    });
  const promptError = lengthError(
    'prompt',
    'The prompt',
    prompt,
    LIMITS.prompt,
  );
  if (promptError) return fail(promptError);

  const finalOptions = kind === 'assemble' ? [] : options;
  if (kind !== 'assemble') {
    if (finalOptions.includes(answer))
      return fail({
        field: 'options',
        code: 'PL422_OPTION_EQUALS_ANSWER',
        message: 'The answer can’t also be a wrong choice.',
      });
    if (
      finalOptions.length < LIMITS.options.min ||
      finalOptions.length > LIMITS.options.max
    )
      return fail({
        field: 'options',
        code: 'PL422_BAD_OPTION',
        message: `Pick between ${LIMITS.options.min} and ${LIMITS.options.max} wrong choices.`,
      });
  }
  let difficulty: number | null = null;
  if (difficultyText !== '') {
    const n = Number(difficultyText);
    if (!Number.isInteger(n) || n < 1 || n > 5)
      return fail({
        field: 'difficulty',
        code: 'PL422_BAD_INPUT',
        message: 'Difficulty is a whole number from 1 to 5.',
      });
    difficulty = n;
  }
  return {
    ok: true,
    value: {
      kind: kind as ExerciseKind,
      answer,
      prompt,
      options: finalOptions,
      difficulty,
    },
  };
}

/** A retire or gate reason: 1 to 500 characters. */
export function parseReason(form: FormLike): Parsed<string> {
  const reason = clean(form.get('reason'));
  if (reason === '')
    return fail({
      field: 'reason',
      code: 'PL422_COMMENT_REQUIRED',
      message: 'Please add a short note to say why.',
    });
  const error = lengthError('reason', 'The note', reason, LIMITS.reason);
  return error ? fail(error) : { ok: true, value: reason };
}

/** A positive whole number from a form, or null. */
export function parseRevision(value: unknown): number | null {
  const text = clean(value);
  if (!/^\d{1,9}$/.test(text)) return null;
  return Number(text);
}

/** Today in UTC as YYYY-MM-DD. */
export const utcToday = (now: Date): string => now.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Server action results and form echoes
// ---------------------------------------------------------------------------

/**
 * What an editor server action returns: the kit’s ActionResult, plus, on a
 * refusal, the text the person typed (so the form shows it again after
 * React resets it) and the field at fault when we know it.
 */
export type EditorResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: string;
      message: string;
      values?: Record<string, string>;
      field?: string;
      detail?: unknown;
    };

/** The named text fields of a form, as typed, for EditorResult.values. */
export function formValues(
  form: FormLike,
  names: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = form.get(name);
    if (typeof value === 'string') out[name] = value;
  }
  return out;
}

/** The typed value of `name` after a refusal, else the saved one. */
export function echo(
  values: Record<string, string> | undefined,
  name: string,
  saved: string | number | null | undefined,
): string {
  if (values && Object.hasOwn(values, name)) return values[name];
  return saved === null || saved === undefined ? '' : String(saved);
}

/** "Nothing has changed" is news, not an error. */
export function noticeTone(code: string): 'info' | 'error' {
  return code === 'PL422_NO_CHANGE' ? 'info' : 'error';
}

export const ITEM_FIELDS = [
  'native',
  'romanisation',
  'meaning',
  'context',
  'usage_note',
  'source_type',
  'source_citation',
  'source_licence',
  'source_retrieved',
  'source_caveat',
] as const;

export const LESSON_FIELDS = [
  'title',
  'subtitle',
  'objective',
  'variety',
  'estimated_minutes',
] as const;

export const UNIT_FIELDS = ['title', 'goal', 'theme'] as const;

export const EXERCISE_FIELDS = [
  'kind',
  'answer',
  'prompt',
  'difficulty',
] as const;

/** A phrase the team wrote itself: who to credit, and under what terms. */
export const ORIGINAL_PROVENANCE = {
  source_citation: 'PoliLingo team',
  source_licence: 'Written for PoliLingo',
} as const;

/**
 * Where a new phrase comes from, by default: the same as the lesson’s last
 * phrase, so a lesson written from one source asks for it once; in a new
 * lesson, written by the team for PoliLingo.
 */
export function provenanceDefaults(
  items: readonly Pick<
    EditItem,
    'source_type' | 'source_citation' | 'source_licence'
  >[],
): {
  source_type: SourceType;
  source_citation: string;
  source_licence: string;
} {
  const last = items.at(-1);
  return last
    ? {
        source_type: last.source_type,
        source_citation: last.source_citation,
        source_licence: last.source_licence,
      }
    : { source_type: 'original', ...ORIGINAL_PROVENANCE };
}

/** Only a published work or a community source has a date it was read on. */
export const sourceHasDate = (type: string): boolean =>
  type === 'published_work' || type === 'community_attested';

/** Whether the citation and licence would pass the database’s rules. */
export function provenanceValid(citation: string, licence: string): boolean {
  const c = charLength(clean(citation));
  const l = charLength(clean(licence));
  return (
    c >= LIMITS.citation.min &&
    c <= LIMITS.citation.max &&
    l >= LIMITS.licence.min &&
    l <= LIMITS.licence.max
  );
}

/**
 * Another live phrase of the lesson with the same text or the same meaning
 * (compared as the database compares them), for the "Same as phrase 2"
 * warning while typing. `exceptId` is the phrase being edited.
 */
export function duplicateOf<
  T extends Pick<EditItem, 'id' | 'native' | 'meaning' | 'position'>,
>(
  items: readonly T[],
  typed: { native: string; meaning: string },
  exceptId?: string | null,
): T | null {
  const native = typed.native.trim() ? normaliseNative(typed.native) : '';
  const meaning = typed.meaning.trim()
    ? normaliseNative(typed.meaning).toLowerCase()
    : '';
  if (!native && !meaning) return null;
  return (
    items.find(
      (i) =>
        i.id !== exceptId &&
        ((native !== '' && normaliseNative(i.native) === native) ||
          (meaning !== '' &&
            normaliseNative(i.meaning).toLowerCase() === meaning)),
    ) ?? null
  );
}

/**
 * The exercises that use a phrase, as the answer or a wrong choice (what
 * retire_content() checks before it retires a phrase), and how many have it
 * as the answer.
 */
export function exercisesUsing<
  T extends Pick<EditExercise, 'answer_item_id' | 'options'>,
>(itemId: string, exercises: readonly T[]): { using: T[]; answerIn: number } {
  const using = exercises.filter(
    (e) => e.answer_item_id === itemId || e.options.includes(itemId),
  );
  return {
    using,
    answerIn: using.filter((e) => e.answer_item_id === itemId).length,
  };
}

// ---------------------------------------------------------------------------
// Exercise choices
// ---------------------------------------------------------------------------

export type ChoiceOption = {
  id: string;
  native: string;
  meaning: string;
  /** Why it cannot be a wrong choice for this answer, or null when it can. */
  blocked: string | null;
};

const sameText = (a: string, b: string) =>
  normaliseNative(a) === normaliseNative(b);
const sameMeaning = (a: string, b: string) =>
  normaliseNative(a).toLowerCase() === normaliseNative(b).toLowerCase();

/**
 * The lesson’s other phrases as wrong choices for `answerId`, each marked
 * when the database would refuse it (the answer itself, or the same text or
 * meaning as the answer, compared as the database compares them).
 */
export function choiceOptions(
  items: readonly Pick<EditItem, 'id' | 'native' | 'meaning'>[],
  answerId: string,
): ChoiceOption[] {
  const answer = items.find((i) => i.id === answerId);
  return items
    .filter((i) => i.id !== answerId)
    .map((i) => ({
      id: i.id,
      native: i.native,
      meaning: i.meaning,
      blocked: !answer
        ? null
        : sameText(i.native, answer.native)
          ? 'Same text as the answer'
          : sameMeaning(i.meaning, answer.meaning)
            ? 'Same meaning as the answer'
            : null,
    }));
}

/** The phrase for an id, for showing an exercise’s answer and choices. */
export function itemById<T extends { id: string }>(
  items: readonly T[],
): (id: string) => T | undefined {
  const map = new Map(items.map((i) => [i.id, i]));
  return (id) => map.get(id);
}

/**
 * A variety’s name without its parenthesis ("Northern Pashto (Peshawar /
 * Yusufzai)" is "Northern Pashto"), and the page eyebrow built from it: the
 * short name alone when it already names the language, so a phone shows
 * one line.
 */
export function shortVarietyName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
}

export function varietyEyebrow(
  languageName: string,
  varietyName: string,
): { long: string; short: string } {
  const short = shortVarietyName(varietyName);
  return {
    long: `${languageName} · ${varietyName}`,
    short: short.toLowerCase().includes(languageName.toLowerCase())
      ? short
      : `${languageName} · ${short}`,
  };
}

/** "Open" or "Held back", for a publish gate. */
export function gateLabel(gate: Gate | null): string {
  return gate === 'blocked' ? 'Held back' : 'Open';
}

/** Whether the lesson can be changed in the editor at all. */
export function lessonLocked(lesson: {
  demo: boolean;
  retired_at: string | null;
}): 'demo' | 'retired' | null {
  if (lesson.retired_at) return 'retired';
  if (lesson.demo) return 'demo';
  return null;
}

// ---------------------------------------------------------------------------
// Dates and the history list
// ---------------------------------------------------------------------------

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

// Pakistan Standard Time is UTC+5 all year, so a timestamp moved on five
// hours and read in UTC is the day it was in Pakistan, where the team
// works (as the admin pages show it).
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * "26 September 2026" for an ISO date as it stands, or for a timestamp the
 * day it was in Pakistan; '' when unreadable.
 */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const date = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return '';
  return DAY_FORMAT.format(
    dateOnly ? date : new Date(date.getTime() + PKT_OFFSET_MS),
  );
}

/** Lesson rows that a child’s change writes too (its fingerprint follows them). */
const ECHO_REASONS = ['edit', 'reorder', 'retire', 'create'];

/**
 * The history worth showing: a lesson row written only because one of its
 * phrases or exercises was created, changed, moved or retired (its
 * fingerprint follows them) is left out when that change is listed within a
 * few seconds of it. Otherwise retiring one phrase would also read as
 * "Lesson retired".
 */
export function historyRows(
  revisions: readonly RevisionEntry[],
  windowMs = 5000,
): RevisionEntry[] {
  const childTimes = revisions
    .filter((r) => r.object_type === 'item' || r.object_type === 'exercise')
    .map((r) => new Date(r.at).getTime());
  return revisions.filter((r) => {
    if (r.object_type !== 'lesson' || !ECHO_REASONS.includes(r.reason))
      return true;
    const at = new Date(r.at).getTime();
    return !childTimes.some((t) => Math.abs(t - at) <= windowMs);
  });
}

// ---------------------------------------------------------------------------
// Review hand-off copy
// ---------------------------------------------------------------------------

export type HandoffCopy = {
  /** The panel’s line when the lesson is ready to send. */
  ready: string;
  /** The line while it waits in the queue (after "since <day>."). */
  waiting: string;
  /** The submit confirm’s description. */
  confirm: string;
  /** The success notice once it is sent. */
  sent: string;
};

/**
 * What the review panel says about who sees a lesson next. A variety with
 * no active reviewer gets the truth: the lesson waits until an admin
 * invites one.
 */
export function handoffCopy(
  varietyName: string,
  reviewers: number,
): HandoffCopy {
  const keepEditing = 'You can keep editing, or take it back, while it waits.';
  if (reviewers > 0)
    return {
      ready: `Ready. ${varietyName} reviewers will see it next.`,
      waiting: `Waiting for a ${varietyName} reviewer`,
      confirm: `${varietyName} reviewers see it in their queue next. ${keepEditing}`,
      sent: `Sent to the ${varietyName} reviewers. We’ll show their note here.`,
    };
  return {
    ready: `Ready. No one reviews ${varietyName} yet, so it will wait in the queue until an admin invites a reviewer.`,
    waiting: `Waiting for a reviewer (no one reviews ${varietyName} yet)`,
    confirm: `No one reviews ${varietyName} yet. It will wait in the queue until an admin invites a reviewer. ${keepEditing}`,
    sent: `Sent. It waits in the queue until an admin invites a ${varietyName} reviewer. We’ll show their note here.`,
  };
}
