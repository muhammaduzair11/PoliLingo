/**
 * The shapes public.page_admin_publish() and public.publish_release()
 * return (supabase/migrations/20260928001500_publish.sql), for the
 * /admin/publish screen.
 */
import type { ReleaseCopy } from '@/lib/console/release-diff';

/** Why a lesson is not in the next release, in words. */
export type Reason = {
  code: string;
  message: string;
  problem_code?: string;
};

export type LessonClass = 'demo' | 'reviewed' | 'mixed' | 'empty';

/** One lesson as the preview lists it. */
export type LessonSummary = {
  id: string;
  title: string | null;
  language: string;
  language_name: string | null;
  direction: 'rtl' | 'ltr' | null;
  course_id: string | null;
  course_name: string | null;
  unit_title: string | null;
  class: LessonClass | null;
  source: 'current' | 'carried' | null;
  items: number;
  exercises: number;
  reasons: Reason[];
  in_previous: boolean;
};

/** A sole-reviewer approval waiting for an admin's countersign. */
export type AwaitingCountersign = {
  decision_id: string;
  target_type: 'item' | 'lesson';
  target_id: string;
  lesson_id: string | null;
  lesson_title: string | null;
  native: string | null;
  romanisation: string | null;
  meaning: string | null;
  variety_id: string;
  variety_name: string;
  language: string;
  language_name: string;
  direction: 'rtl' | 'ltr';
  reviewer_id: string;
  reviewer_name: string | null;
  at: string;
};

/** public.preview_release() */
export type ReleasePreview = {
  release: string;
  today: string;
  generated_at: string;
  payload: ReleaseCopy;
  contentHash: string;
  base: { name: string; contentHash: string; published_at: string } | null;
  unchanged: boolean;
  empty: boolean;
  clock_ok: boolean;
  diff: {
    added: LessonSummary[];
    changed: LessonSummary[];
    carried: LessonSummary[];
    removed: LessonSummary[];
    unchanged: number;
  };
  excluded: LessonSummary[];
  awaiting_countersign: AwaitingCountersign[];
  stats: {
    lessons: number;
    demo_lessons: number;
    reviewed_lessons: number;
    carried_lessons: number;
    held_back: number;
    items: number;
    exercises: number;
    languages: number;
  };
};

/** One row of the release history. */
export type ReleaseRow = {
  name: string;
  kind: 'seed' | 'publish' | 'rollback';
  content_hash: string;
  published_at: string;
  published_by: string | null;
  published_by_name: string | null;
  note: string | null;
  /** For a rollback: the release whose lessons it brought back. */
  restored: string | null;
  lessons: number;
  items: number;
  demo_lessons: number;
  reviewed_lessons: number;
  carried_lessons: number;
};

/** public.page_admin_publish() */
export type PublishPageData = {
  preview: ReleasePreview;
  latest: {
    name: string;
    kind: ReleaseRow['kind'];
    contentHash: string;
    published_at: string;
    payload: ReleaseCopy;
  } | null;
  releases: ReleaseRow[];
  countersign_available: boolean;
};

/** public.publish_release() */
export type PublishResult = {
  name: string;
  contentHash: string;
  lessons: number;
  items: number;
};

/** public.rollback_release(): the new release and the one it brought back. */
export type RollbackResult = PublishResult & { restored: string };

/**
 * How the self-check after a publish or rollback went: the new release was
 * read back and its contentHash recomputed ('verified' or 'mismatch'); it
 * checked out but live updates are switched off ('overlay_off'); or it
 * couldn't be read back ('unavailable').
 */
export type PublishCheck =
  | 'verified'
  | 'mismatch'
  | 'overlay_off'
  | 'unavailable';

export type PublishOutcome = PublishResult & {
  check: PublishCheck;
  /** Set when the release is a rollback. */
  restored?: string;
};

/** What the publish control can offer right now. */
export type PublishState =
  | 'ready'
  | 'unchanged'
  | 'empty'
  | 'clock'
  | 'check_failed';
