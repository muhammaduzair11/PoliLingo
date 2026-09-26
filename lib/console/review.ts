/**
 * Review screens' logic (docs/platform.md 3.5, 4.10): the parts a reviewer
 * must tick to approve an item, status labels, the queue's grouping and
 * order, the history timeline and the difference between a suggestion and
 * the current text. Pure functions, no I/O, so tests/review.test.mjs can
 * run them.
 *
 * The database decides everything here again (record_review_decision,
 * page_review_*); this only chooses what to show.
 */
import { normaliseNative } from '../script-check.ts';

// ---------------------------------------------------------------------------
// Shapes the page reads return (supabase/migrations/20260928001300_review.sql)
// ---------------------------------------------------------------------------

export type ReviewStatus =
  | 'unreviewed'
  | 'approved'
  | 'changes_requested'
  | 'rejected';
export type Decision = 'approve' | 'request_changes' | 'reject';
export type ScopePart = 'text' | 'romanisation' | 'meaning' | 'usage';
export type Direction = 'rtl' | 'ltr';

/** The learner-visible text of an item: what review and suggestions cover. */
export type ItemFields = {
  native: string;
  romanisation: string;
  meaning: string;
  context: string | null;
  usage_note: string | null;
};
export type ItemField = keyof ItemFields;

export type QueueVariety = {
  id: string;
  name: string;
  language: string;
  language_name: string;
  direction: Direction;
  can_review: boolean;
  reviewer_count: number;
};
export type QueueLesson = {
  id: string;
  title: string;
  subtitle: string;
  variety_id: string;
  submitted_at: string | null;
  changed_at: string;
  item_count: number;
  unreviewed_items: number;
  exercise_count: number;
  is_author: boolean;
};
export type QueueItem = {
  id: string;
  lesson_id: string;
  lesson_title: string;
  position: number | null;
  native: string;
  romanisation: string;
  meaning: string;
  variety_id: string;
  in_review: boolean;
  submitted_at: string | null;
  changed_at: string;
  is_author: boolean;
  open_suggestions: number;
};
export type QueuePage = {
  generated_at: string;
  varieties: QueueVariety[];
  lessons: QueueLesson[];
  items: QueueItem[];
};

export type Language = { code: string; name: string; direction: Direction };
export type Variety = { id: string; name: string; learner_label: string };

export type DecisionRow = {
  id: string;
  decision: Decision;
  reviewer_id: string;
  reviewer_name: string | null;
  seen_fingerprint: string;
  target_revision_no: number | null;
  scope: ScopePart[] | null;
  sole_reviewer: boolean;
  comment: string | null;
  redacted: boolean;
  at: string;
  current: boolean;
  countersign: {
    admin_id: string;
    admin_name: string | null;
    comment: string | null;
    at: string;
  } | null;
};
export type CommentRow = {
  id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string | null;
  body: string;
  redacted: boolean;
  at: string;
};
export type RevisionRow = {
  seq: number;
  revision_no: number;
  reason: string;
  author_id: string | null;
  author_name: string | null;
  suggestion_id: string | null;
  review_fingerprint: string | null;
  at: string;
  fields: Partial<ItemFields> & { source_citation?: string | null };
};
export type SuggestionStatus =
  | 'open'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'superseded';
export type SuggestionRow = {
  id: string;
  suggester_id: string;
  suggester_name: string | null;
  proposed: Partial<ItemFields>;
  note: string | null;
  status: SuggestionStatus;
  resolution_note: string | null;
  resolved_at: string | null;
  stale: boolean;
  mine: boolean;
  created_at: string;
};
export type Viewer = {
  contributor_id: string | null;
  can_review: boolean;
  is_author: boolean;
  sole_reviewer: boolean;
  reviewer_count: number;
  can_approve: boolean;
  can_suggest?: boolean;
  is_admin: boolean;
};

export type ItemPage = {
  generated_at: string;
  item: ItemFields & {
    id: string;
    position: number | null;
    variety_id: string;
    source_type: string;
    source_citation: string;
    source_licence: string;
    source_retrieved: string | null;
    source_caveat: string | null;
    review_status: ReviewStatus;
    review_fingerprint: string;
    revision_no: number;
    current_decision_id: string | null;
    text_author_id: string | null;
    text_author_name: string | null;
    is_demo: boolean;
    retired: boolean;
    updated_at: string;
  };
  language: Language;
  variety: Variety;
  lesson: {
    id: string;
    title: string;
    subtitle: string;
    submitted_at: string | null;
    review_status: ReviewStatus;
  };
  siblings: {
    id: string;
    position: number;
    native: string;
    romanisation: string;
    meaning: string;
    review_status: ReviewStatus;
  }[];
  revisions: RevisionRow[];
  decisions: DecisionRow[];
  comments: CommentRow[];
  suggestions: SuggestionRow[];
  required_scope: ScopePart[];
  viewer: Viewer;
};

export type LessonProblem = {
  severity: 'blocking' | 'warning';
  code: string;
  message: string;
  target_type?: string;
  target_id?: string;
};

export type LessonPage = {
  generated_at: string;
  lesson: {
    id: string;
    title: string;
    subtitle: string;
    objective: string;
    variety_id: string;
    review_status: ReviewStatus;
    review_fingerprint: string;
    revision_no: number;
    current_decision_id: string | null;
    submitted_at: string | null;
    is_demo: boolean;
    retired: boolean;
    updated_at: string;
  };
  language: Language;
  variety: Variety;
  items: {
    id: string;
    position: number;
    native: string;
    romanisation: string;
    meaning: string;
    review_status: ReviewStatus;
    is_demo: boolean;
    awaiting_countersign: boolean;
  }[];
  exercises: {
    id: string;
    position: number;
    kind: string;
    prompt: string;
    answer_item_id: string;
    options: string[];
  }[];
  exercise_count: number;
  problems: LessonProblem[];
  decisions: DecisionRow[];
  comments: CommentRow[];
  viewer: Viewer;
};

export type AdminSuggestion = {
  id: string;
  item_id: string;
  lesson_id: string;
  lesson_title: string;
  variety_id: string;
  variety_name: string;
  language: string;
  language_name: string;
  direction: Direction;
  suggester_id: string;
  suggester_name: string | null;
  note: string | null;
  proposed: Partial<ItemFields>;
  current: ItemFields;
  review_fingerprint: string;
  review_status: ReviewStatus;
  /** The phrase's lesson is submitted, so an unreviewed phrase is "In review". */
  lesson_submitted: boolean;
  /** The phrase was retired: the suggestion can only be declined. */
  item_retired: boolean;
  stale: boolean;
  can_resolve: boolean;
  created_at: string;
};
export type AdminSuggestionsPage = {
  generated_at: string;
  open: AdminSuggestion[];
  recent: {
    id: string;
    item_id: string;
    status: SuggestionStatus;
    suggester_name: string | null;
    resolved_by_name: string | null;
    resolution_note: string | null;
    resolved_at: string | null;
  }[];
};

// ---------------------------------------------------------------------------
// Scope: what a reviewer ticks to approve
// ---------------------------------------------------------------------------

export const SCOPE_ORDER: readonly ScopePart[] = [
  'text',
  'romanisation',
  'meaning',
  'usage',
];

export const SCOPE_LABELS: Readonly<
  Record<ScopePart, { label: string; hint: string }>
> = {
  text: {
    label: 'Native text',
    hint: 'Spelling, letters and word order, as a native speaker writes it.',
  },
  romanisation: {
    label: 'Romanisation',
    hint: 'It says the phrase the way a learner should say it.',
  },
  meaning: {
    label: 'Meaning',
    hint: 'The English is right, natural and not too literal.',
  },
  usage: {
    label: 'Context and usage note',
    hint: 'When and with whom the phrase is used is true to life.',
  },
};

const blank = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === '';

/**
 * The parts an item's approval must cover, as the database requires them
 * (private.review_required_scope): text, romanisation and meaning always;
 * usage when the item has a context or a usage note.
 */
export function requiredScopes(item: {
  context?: string | null;
  usage_note?: string | null;
}): ScopePart[] {
  const parts: ScopePart[] = ['text', 'romanisation', 'meaning'];
  if (!blank(item.context) || !blank(item.usage_note)) parts.push('usage');
  return parts;
}

/** The required parts not ticked yet, in display order. */
export function missingScopes(
  required: readonly ScopePart[],
  ticked: Iterable<string>,
): ScopePart[] {
  const have = new Set(ticked);
  return SCOPE_ORDER.filter((p) => required.includes(p) && !have.has(p));
}

/** Only the known parts, deduplicated, in display order. */
export function cleanScope(values: Iterable<unknown>): ScopePart[] {
  const have = new Set(values);
  return SCOPE_ORDER.filter((p) => have.has(p));
}

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------

/** The kit's StatusBadge states this screen uses (components/console/status-badge.tsx). */
export type BadgeStatus =
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'retired'
  | 'demo'
  | 'sole_reviewer';

/**
 * Which badge a phrase or lesson gets. "In review" is not stored (§3.5): an
 * unreviewed target in a submitted lesson is in review, otherwise it is a
 * draft. A current sole-reviewer approval with no countersign yet shows
 * "Needs countersign".
 */
export function badgeFor(target: {
  review_status: ReviewStatus;
  submitted?: boolean;
  is_demo?: boolean;
  retired?: boolean;
  awaiting_countersign?: boolean;
}): BadgeStatus {
  if (target.retired) return 'retired';
  if (target.is_demo) return 'demo';
  switch (target.review_status) {
    case 'approved':
      return target.awaiting_countersign ? 'sole_reviewer' : 'approved';
    case 'changes_requested':
      return 'changes_requested';
    case 'rejected':
      return 'rejected';
    default:
      return target.submitted ? 'in_review' : 'draft';
  }
}

export const DECISION_LABELS: Readonly<Record<Decision, string>> = {
  approve: 'Approved',
  request_changes: 'Asked for changes',
  reject: 'Rejected',
};

export const REVISION_REASON_LABELS: Readonly<Record<string, string>> = {
  import: 'Imported from the course files',
  create: 'Written',
  edit: 'Edited',
  suggestion: 'Suggested fix applied',
  move: 'Moved',
  reorder: 'Reordered',
  retire: 'Retired',
  gate: 'Visibility changed',
};

export const SUGGESTION_STATUS_LABELS: Readonly<
  Record<SuggestionStatus, string>
> = {
  open: 'Waiting for an editor',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  superseded: 'Replaced by another fix',
};

export const EXERCISE_KIND_LABELS: Readonly<Record<string, string>> = {
  meaning: 'Pick the meaning',
  translation: 'Pick the phrase',
  match: 'Match pairs',
  assemble: 'Build the phrase',
  context: 'Choose for the situation',
};

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

/** Submitted lessons, the longest-waiting first. */
export function orderLessons(lessons: readonly QueueLesson[]): QueueLesson[] {
  return [...lessons].sort(
    (a, b) =>
      time(a.submitted_at) - time(b.submitted_at) ||
      a.id.localeCompare(b.id, 'en'),
  );
}

/**
 * Phrases in review (their lesson is submitted) before phrases still being
 * written, then the oldest change first, so nothing waits forever.
 */
export function orderItems(items: readonly QueueItem[]): QueueItem[] {
  return [...items].sort(
    (a, b) =>
      Number(b.in_review) - Number(a.in_review) ||
      time(a.changed_at) - time(b.changed_at) ||
      a.id.localeCompare(b.id, 'en'),
  );
}

export type QueueGroup = {
  lessonId: string;
  lessonTitle: string;
  varietyId: string;
  inReview: boolean;
  /** The oldest change among its phrases. */
  oldest: string;
  items: QueueItem[];
};

/**
 * The phrases grouped by lesson. Groups keep the order of orderItems (a
 * group sits where its longest-waiting phrase would), and phrases inside a
 * group follow their position in the lesson.
 */
export function groupQueueItems(items: readonly QueueItem[]): QueueGroup[] {
  const groups = new Map<string, QueueGroup>();
  for (const item of orderItems(items)) {
    let group = groups.get(item.lesson_id);
    if (!group) {
      group = {
        lessonId: item.lesson_id,
        lessonTitle: item.lesson_title,
        varietyId: item.variety_id,
        inReview: item.in_review,
        oldest: item.changed_at,
        items: [],
      };
      groups.set(item.lesson_id, group);
    }
    group.items.push(item);
  }
  for (const group of groups.values())
    group.items.sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) -
          (b.position ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id, 'en'),
    );
  return [...groups.values()];
}

/** The queue as the page shows it: lessons first, then phrases by lesson. */
export function arrangeQueue(page: QueuePage): {
  lessons: QueueLesson[];
  groups: QueueGroup[];
  total: number;
} {
  const lessons = orderLessons(page.lessons);
  const groups = groupQueueItems(page.items);
  return { lessons, groups, total: lessons.length + page.items.length };
}

/** "Northern Pashto" or "Northern Pashto and Hazara Hindko". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * How long something has waited, in words: "just now", "5 minutes",
 * "3 hours", "2 days", "3 weeks". `now` is the database's generated_at,
 * so the server render and the numbers agree.
 */
export function ageLabel(fromIso: string | null, nowIso: string): string {
  const from = time(fromIso);
  const now = time(nowIso);
  if (!Number.isFinite(from) || !Number.isFinite(now)) return '';
  const minutes = Math.max(0, Math.floor((now - from) / 60_000));
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 14) return plural(days, 'day');
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return plural(weeks, 'week');
  return plural(Math.floor(days / 30), 'month');
}

/** "5 minutes ago", or "just now". */
export function agoLabel(fromIso: string | null, nowIso: string): string {
  const age = ageLabel(fromIso, nowIso);
  return age === '' || age === 'just now' ? age : `${age} ago`;
}

/** 26 Sep 2026, 14:05 (UTC, so server and client agree). */
export function dateTimeLabel(iso: string | null): string {
  const t = time(iso);
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(t);
}

// ---------------------------------------------------------------------------
// Differences: suggestions, revisions, stale reloads
// ---------------------------------------------------------------------------

export const FIELD_ORDER: readonly ItemField[] = [
  'native',
  'romanisation',
  'meaning',
  'context',
  'usage_note',
];

export const FIELD_LABELS: Readonly<Record<ItemField, string>> = {
  native: 'Native text',
  romanisation: 'Romanisation',
  meaning: 'Meaning',
  context: 'Context',
  usage_note: 'Usage note',
};

export type FieldChange = {
  field: ItemField;
  label: string;
  before: string | null;
  after: string | null;
};

/** A field's value as the database would store it, for comparing. */
export function storedValue(
  field: ItemField,
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const text = field === 'native' ? normaliseNative(value) : value.trim();
  return text === '' ? null : text;
}

/**
 * What differs between two versions of an item's text, field by field in
 * display order. Only fields present in `after` are compared, so a
 * suggestion (which holds only what it changes) diffs cleanly.
 */
export function diffFields(
  before: Partial<ItemFields>,
  after: Partial<ItemFields>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of FIELD_ORDER) {
    if (!Object.hasOwn(after, field)) continue;
    const was = storedValue(field, before[field]);
    const now = storedValue(field, after[field]);
    if (was !== now)
      changes.push({
        field,
        label: FIELD_LABELS[field],
        before: was,
        after: now,
      });
  }
  return changes;
}

/** A suggestion against the item's current text. */
export function suggestionDiff(
  current: ItemFields,
  proposed: Partial<ItemFields>,
): FieldChange[] {
  return diffFields(current, proposed);
}

/**
 * The payload for create_suggestion from what the reviewer typed: every
 * field as it would be stored, keeping only those that differ from the
 * current text. Empty when nothing changed.
 */
export function proposedChanges(
  current: ItemFields,
  typed: Partial<Record<ItemField, string | null>>,
): Partial<ItemFields> {
  const out: Partial<Record<ItemField, string | null>> = {};
  for (const field of FIELD_ORDER) {
    if (!Object.hasOwn(typed, field)) continue;
    const value = storedValue(field, typed[field]);
    if (value !== storedValue(field, current[field])) out[field] = value;
  }
  return out as Partial<ItemFields>;
}

/**
 * For each revision (newest first, as page_review_item returns them), what
 * it changed from the revision before it. The first revision changed
 * nothing: it is where the phrase started.
 */
export function revisionChanges(
  revisions: readonly RevisionRow[],
): Map<number, FieldChange[]> {
  const bySeq = [...revisions].sort((a, b) => a.seq - b.seq);
  const out = new Map<number, FieldChange[]>();
  let previous: Partial<ItemFields> | null = null;
  for (const revision of bySeq) {
    const fields = Object.fromEntries(
      FIELD_ORDER.map((field) => [field, revision.fields[field] ?? null]),
    ) as Partial<ItemFields>;
    out.set(revision.seq, previous ? diffFields(previous, fields) : []);
    previous = fields;
  }
  return out;
}

// ---------------------------------------------------------------------------
// History: revisions, decisions, comments and suggestions on one timeline
// ---------------------------------------------------------------------------

export type HistoryEntry =
  | { kind: 'revision'; at: string; key: string; revision: RevisionRow }
  | { kind: 'decision'; at: string; key: string; decision: DecisionRow }
  | { kind: 'comment'; at: string; key: string; comment: CommentRow }
  | {
      kind: 'suggestion';
      at: string;
      key: string;
      suggestion: SuggestionRow;
    };

const KIND_RANK: Record<HistoryEntry['kind'], number> = {
  decision: 0,
  comment: 1,
  suggestion: 2,
  revision: 3,
};

/**
 * One timeline, newest first. Entries at the same moment put decisions
 * before comments before suggestions before revisions (a decision is
 * recorded after the text it judged). Replies to a comment are not listed
 * on their own: they sit under their parent (see commentReplies).
 */
export function buildHistory(input: {
  revisions?: readonly RevisionRow[];
  decisions?: readonly DecisionRow[];
  comments?: readonly CommentRow[];
  suggestions?: readonly SuggestionRow[];
}): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    ...(input.revisions ?? []).map(
      (revision): HistoryEntry => ({
        kind: 'revision',
        at: revision.at,
        key: `r-${revision.seq}`,
        revision,
      }),
    ),
    ...(input.decisions ?? []).map(
      (decision): HistoryEntry => ({
        kind: 'decision',
        at: decision.at,
        key: `d-${decision.id}`,
        decision,
      }),
    ),
    ...(input.comments ?? [])
      .filter((c) => c.parent_id === null)
      .map(
        (comment): HistoryEntry => ({
          kind: 'comment',
          at: comment.at,
          key: `c-${comment.id}`,
          comment,
        }),
      ),
    ...(input.suggestions ?? []).map(
      (suggestion): HistoryEntry => ({
        kind: 'suggestion',
        at: suggestion.created_at,
        key: `s-${suggestion.id}`,
        suggestion,
      }),
    ),
  ];
  return entries.sort(
    (a, b) =>
      time(b.at) - time(a.at) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      b.key.localeCompare(a.key, 'en'),
  );
}

/** Replies to each comment, oldest first, keyed by the parent's id. */
export function commentReplies(
  comments: readonly CommentRow[],
): Map<string, CommentRow[]> {
  const out = new Map<string, CommentRow[]>();
  for (const c of comments) {
    if (!c.parent_id) continue;
    const list = out.get(c.parent_id) ?? [];
    list.push(c);
    out.set(c.parent_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => time(a.at) - time(b.at));
  return out;
}

/** The current sole-reviewer approval still waiting for a countersign, if any. */
export function awaitingCountersign(
  decisions: readonly DecisionRow[],
): DecisionRow | null {
  return (
    decisions.find(
      (d) =>
        d.current &&
        d.decision === 'approve' &&
        d.sole_reviewer &&
        d.countersign === null,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Who may do what, in words
// ---------------------------------------------------------------------------

export type ApprovalStance =
  | { kind: 'can-approve' }
  | { kind: 'sole-author' }
  | { kind: 'own-text' }
  | { kind: 'demo' }
  | { kind: 'retired' }
  | { kind: 'outside' };

/**
 * Why the viewer can or cannot approve, so the page can say it up front
 * instead of waiting for a refusal. The database applies the same rules.
 */
export function approvalStance(input: {
  viewer: Viewer;
  is_demo: boolean;
  retired: boolean;
}): ApprovalStance {
  const { viewer } = input;
  if (input.retired) return { kind: 'retired' };
  if (input.is_demo) return { kind: 'demo' };
  if (!viewer.can_review) return { kind: 'outside' };
  if (viewer.is_author)
    return viewer.sole_reviewer
      ? { kind: 'sole-author' }
      : { kind: 'own-text' };
  return { kind: 'can-approve' };
}

/** A 16-hex review fingerprint, as the database checks it. */
export function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

// ---------------------------------------------------------------------------
// Forms: what the server actions read, checked before the database sees it
// ---------------------------------------------------------------------------

/** FormData, or anything with its get/getAll. */
export type FormLike = {
  get(name: string): unknown;
  getAll(name: string): unknown[];
};

export type Refusal = { ok: false; code: string; message: string };

const BAD_INPUT: Refusal = {
  ok: false,
  code: 'PL422_BAD_INPUT',
  message:
    'Something in the form isn’t quite right. Reload the page and try again.',
};

/** A trimmed string field, or null when missing or blank. */
export function formText(form: FormLike, name: string): string | null {
  const value = form.get(name);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/** A string field exactly as typed (untrimmed), or null when missing. */
function formRaw(form: FormLike, name: string): string | null {
  const value = form.get(name);
  return typeof value === 'string' ? value : null;
}

export type DecisionInput = {
  target_type: 'item' | 'lesson';
  target_id: string;
  decision: Decision;
  seen_fingerprint: string;
  scope: ScopePart[] | null;
  comment: string | null;
};

/**
 * The review form: target, decision, the fingerprint the reviewer saw, the
 * ticked parts and the note. Refuses what the database would refuse
 * anyway, before a round trip: a note is required to ask for changes or
 * reject.
 */
export function parseDecisionForm(
  form: FormLike,
): { ok: true; value: DecisionInput } | Refusal {
  const targetType = formText(form, 'target_type');
  const targetId = formText(form, 'target_id');
  const decision = formText(form, 'decision');
  const seen = formText(form, 'seen_fingerprint');
  if (
    (targetType !== 'item' && targetType !== 'lesson') ||
    !targetId ||
    (decision !== 'approve' &&
      decision !== 'request_changes' &&
      decision !== 'reject') ||
    !isFingerprint(seen)
  )
    return BAD_INPUT;
  const comment = formText(form, 'comment');
  if (decision !== 'approve' && !comment)
    return {
      ok: false,
      code: 'PL422_COMMENT_REQUIRED',
      message:
        decision === 'reject'
          ? 'Please say why this should not be used.'
          : 'Please say what needs to change.',
    };
  if (comment && comment.length > 2000)
    return {
      ok: false,
      code: 'PL422_LENGTH',
      message: 'A note can be up to 2,000 characters.',
    };
  const ticked = form.getAll('scope');
  return {
    ok: true,
    value: {
      target_type: targetType,
      target_id: targetId,
      decision,
      seen_fingerprint: seen,
      scope:
        decision === 'approve' || ticked.length ? cleanScope(ticked) : null,
      comment,
    },
  };
}

export type SuggestionInput = {
  item_id: string;
  seen_fingerprint: string;
  /** Every field as typed; the database keeps only what changed. */
  proposed: Partial<Record<ItemField, string | null>>;
  note: string | null;
};

/** The "Suggest a fix" form. */
export function parseSuggestionForm(
  form: FormLike,
): { ok: true; value: SuggestionInput } | Refusal {
  const itemId = formText(form, 'item_id');
  const seen = formText(form, 'seen_fingerprint');
  if (!itemId || !isFingerprint(seen)) return BAD_INPUT;
  const proposed: Partial<Record<ItemField, string | null>> = {};
  for (const field of FIELD_ORDER) {
    const value = formRaw(form, field);
    if (value !== null) proposed[field] = value;
  }
  if (Object.keys(proposed).length === 0) return BAD_INPUT;
  const note = formText(form, 'note');
  if (note && note.length > 2000)
    return {
      ok: false,
      code: 'PL422_LENGTH',
      message: 'A note can be up to 2,000 characters.',
    };
  return {
    ok: true,
    value: { item_id: itemId, seen_fingerprint: seen, proposed, note },
  };
}

// ---------------------------------------------------------------------------
// Stale: the text changed while the reviewer was looking at it
// ---------------------------------------------------------------------------

/** What a refused action (PL409_STALE) sends back so the page can say what changed. */
export type StaleSnapshot = {
  review_fingerprint: string;
  revision_no: number;
  /** An item's current text; absent for a lesson. */
  fields?: ItemFields;
};

/** The item's current text from page_review_item, for a StaleSnapshot. */
export function staleFromItemPage(page: {
  item: ItemFields & { review_fingerprint: string; revision_no: number };
}): StaleSnapshot {
  const { item } = page;
  return {
    review_fingerprint: item.review_fingerprint,
    revision_no: item.revision_no,
    fields: {
      native: item.native,
      romanisation: item.romanisation,
      meaning: item.meaning,
      context: item.context,
      usage_note: item.usage_note,
    },
  };
}

/**
 * What to tell a reviewer whose view went stale: the fields that changed
 * since they opened the page, or, when the text is the same (a change they
 * cannot see, such as its source), that it changed in another way.
 */
export function staleChanges(
  seen: ItemFields,
  stale: StaleSnapshot,
): FieldChange[] {
  return stale.fields ? diffFields(seen, stale.fields) : [];
}

/** "Waiting 3 hours", or "Just arrived". */
export function waitingLabel(fromIso: string | null, nowIso: string): string {
  const age = ageLabel(fromIso, nowIso);
  if (age === '') return '';
  return age === 'just now' ? 'Just arrived' : `Waiting ${age}`;
}
