/**
 * The admin overview (docs/platform.md 3.9 C, 4.10) as a view model: what
 * page_admin_overview() returns, turned into the cards, rows and numbers the
 * page shows. Pure: no React, no Supabase.
 *
 * Honesty rules: the reviewed count is what reviewers have approved, never
 * padded with starter (demo) phrases, and the target line always shows next
 * to it.
 */
import { formatDay, formatWeekday } from './invite-link.ts';

/** page_admin_overview(), as the database returns it. */
export type OverviewData = {
  generated_at: string;
  target: { reviewed_target_min: number; reviewed_target_max: number };
  latest_release: {
    name: string;
    kind: 'seed' | 'publish' | 'rollback';
    published_at: string;
    lessons: number;
    items: number;
  } | null;
  languages: OverviewLanguage[];
  varieties: OverviewVariety[];
  /** Null for staff who are not admins. */
  accounts: {
    total: number;
    adults: number;
    active_7d: number;
    learners_with_completion: number;
    completions: number;
    team: number;
    activity_7d: { date: string; accounts: number }[] | null;
  } | null;
};

export type OverviewLanguage = {
  code: string;
  name: string;
  native_name: string;
  direction: 'rtl' | 'ltr';
  publish_gate: 'open' | 'blocked';
  demo_period: { sunset: string; live: boolean } | null;
  lessons: number;
  items: number;
  demo: number;
  draft: number;
  in_review: number;
  changes_requested: number;
  reviewed: number;
  approved_waiting: number;
  live: number;
  reviewed_live: number;
  demo_live: number;
  gated: number;
};

export type OverviewVariety = {
  id: string;
  language: string;
  language_name: string;
  name: string;
  publish_gate: 'open' | 'blocked';
  reviewers: number;
  reviewer_names: string[];
};

export type PipelineStep = {
  key: 'draft' | 'in_review' | 'changes_requested' | 'waiting' | 'live';
  label: string;
  value: number;
  hint: string;
};

export type LanguageCard = {
  code: string;
  name: string;
  nativeName: string;
  dir: 'rtl' | 'ltr';
  /** The language's own gate is closed: learners see none of it. */
  hidden: boolean;
  /** "Reviewed items: 12 — target 250–400 per language" */
  reviewedLine: string;
  reviewed: number;
  /** 0..1, reviewed items against the lower target. */
  progress: number;
  progressLabel: string;
  steps: PipelineStep[];
  items: number;
  lessons: number;
  live: { total: number; reviewed: number; demo: number };
  gated: number;
  /** A sentence about the starter phrases, or null when there are none. */
  demoNote: string | null;
};

export type Coverage = 'none' | 'sole' | 'ok';

export type VarietyRow = {
  id: string;
  name: string;
  languageName: string;
  reviewers: number;
  names: string[];
  coverage: Coverage;
  note: string;
};

export type ActivityBar = {
  date: string;
  /** "Mon" */
  day: string;
  /** "Mon 28 Sep" */
  label: string;
  accounts: number;
  /** 0..100, against the busiest day (at least 1). */
  height: number;
};

export type AccountsView = {
  total: number;
  adults: number;
  active7d: number;
  learnersWithCompletion: number;
  completions: number;
  team: number;
  activity: ActivityBar[];
};

export type OverviewView = {
  release: {
    name: string;
    publishedLabel: string;
    lessons: number;
    items: number;
    kindLabel: string;
  } | null;
  target: { min: number; max: number };
  languages: LanguageCard[];
  varieties: VarietyRow[];
  accounts: AccountsView | null;
  /** Totals across languages, for the headline row. */
  totals: { reviewed: number; inReview: number; waiting: number; live: number };
};

/** 1234 → "1,234". By hand, so every runtime prints the same. */
export function formatCount(n: number): string {
  const whole = Number.isFinite(n) ? Math.trunc(n) : 0;
  const digits = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return whole < 0 ? `-${digits}` : digits;
}

/** "Reviewed items: N — target 250–400 per language": the honest line. */
export function reviewedLine(
  reviewed: number,
  min: number,
  max: number,
): string {
  return `Reviewed items: ${formatCount(reviewed)} — target ${formatCount(min)}–${formatCount(max)} per language`;
}

/** Reviewed items as a share of the lower target, between 0 and 1. */
export function targetProgress(reviewed: number, min: number): number {
  if (!(min > 0) || !(reviewed > 0)) return 0;
  return Math.min(1, reviewed / min);
}

function progressLabel(reviewed: number, min: number, max: number): string {
  if (reviewed >= max) return 'Target reached';
  if (reviewed >= min)
    return `Past ${formatCount(min)}: on the way to ${formatCount(max)}`;
  const left = min - reviewed;
  return `${formatCount(left)} more to reach ${formatCount(min)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

export function pipelineSteps(l: OverviewLanguage): PipelineStep[] {
  return [
    {
      key: 'draft',
      label: 'Being written',
      value: l.draft,
      hint: 'New phrases not yet sent for review',
    },
    {
      key: 'in_review',
      label: 'In review',
      value: l.in_review,
      hint: 'Waiting for a native-speaker reviewer',
    },
    {
      key: 'changes_requested',
      label: 'Changes asked for',
      value: l.changes_requested,
      hint: 'Back with the editor to fix',
    },
    {
      key: 'waiting',
      label: 'Approved, waiting to publish',
      value: l.approved_waiting,
      hint: 'Ready for the next release',
    },
    {
      key: 'live',
      label: 'Reviewed and live',
      value: l.reviewed_live,
      hint: 'Reviewed phrases learners see now',
    },
  ];
}

function demoNote(l: OverviewLanguage): string | null {
  if (l.demo_live === 0 && l.demo === 0) return null;
  if (l.demo_live === 0)
    return `${plural(l.demo, 'starter phrase is', 'starter phrases are')} kept but no longer shown.`;
  const sunset = l.demo_period?.sunset ? formatDay(l.demo_period.sunset) : '';
  return `${plural(l.demo_live, 'starter phrase', 'starter phrases')} ${l.demo_live === 1 ? 'fills' : 'fill'} in until reviewed lessons replace ${l.demo_live === 1 ? 'it' : 'them'}${sunset ? ` (by ${sunset} at the latest)` : ''}.`;
}

export function languageCard(
  l: OverviewLanguage,
  target: { min: number; max: number },
): LanguageCard {
  return {
    code: l.code,
    name: l.name,
    nativeName: l.native_name,
    dir: l.direction,
    hidden: l.publish_gate === 'blocked',
    reviewedLine: reviewedLine(l.reviewed, target.min, target.max),
    reviewed: l.reviewed,
    progress: targetProgress(l.reviewed, target.min),
    progressLabel: progressLabel(l.reviewed, target.min, target.max),
    steps: pipelineSteps(l),
    items: l.items,
    lessons: l.lessons,
    live: { total: l.live, reviewed: l.reviewed_live, demo: l.demo_live },
    gated: l.gated,
    demoNote: demoNote(l),
  };
}

export function varietyRow(v: OverviewVariety): VarietyRow {
  const names = [...v.reviewer_names].sort((a, b) => a.localeCompare(b, 'en'));
  const coverage: Coverage =
    v.reviewers <= 0 ? 'none' : v.reviewers === 1 ? 'sole' : 'ok';
  const note =
    coverage === 'none'
      ? 'No reviewer yet. Invite one to start reviewing.'
      : coverage === 'sole'
        ? 'Only one reviewer, so an admin countersigns when they approve text they wrote.'
        : 'Reviewers can check each other’s work.';
  return {
    id: v.id,
    name: v.name,
    languageName: v.language_name,
    reviewers: Math.max(0, v.reviewers),
    names,
    coverage,
    note,
  };
}

export function activityBars(
  days: { date: string; accounts: number }[] | null | undefined,
): ActivityBar[] {
  const list = days ?? [];
  const peak = Math.max(1, ...list.map((d) => d.accounts));
  return list.map((d) => {
    const label = /^\d{4}-\d{2}-\d{2}$/.test(d.date)
      ? formatWeekday(`${d.date}T00:00:00Z`)
      : '';
    return {
      date: d.date,
      day: label ? label.slice(0, 3) : d.date,
      label: label || d.date,
      accounts: d.accounts,
      height: Math.round((d.accounts / peak) * 100),
    };
  });
}

const KIND_LABELS: Record<string, string> = {
  seed: 'First release',
  publish: 'Published',
  rollback: 'Rolled back',
};

export function buildOverview(data: OverviewData): OverviewView {
  const target = {
    min: data.target?.reviewed_target_min ?? 250,
    max: data.target?.reviewed_target_max ?? 400,
  };
  const languages = (data.languages ?? []).map((l) => languageCard(l, target));
  const sum = (pick: (l: OverviewLanguage) => number) =>
    (data.languages ?? []).reduce((total, l) => total + pick(l), 0);
  const r = data.latest_release;
  const a = data.accounts;
  return {
    release: r
      ? {
          name: r.name,
          publishedLabel: formatDay(r.published_at),
          lessons: r.lessons,
          items: r.items,
          kindLabel: KIND_LABELS[r.kind] ?? 'Published',
        }
      : null,
    target,
    languages,
    varieties: (data.varieties ?? []).map(varietyRow),
    accounts: a
      ? {
          total: a.total,
          adults: a.adults,
          active7d: a.active_7d,
          learnersWithCompletion: a.learners_with_completion,
          completions: a.completions,
          team: a.team,
          activity: activityBars(a.activity_7d),
        }
      : null,
    totals: {
      reviewed: sum((l) => l.reviewed),
      inReview: sum((l) => l.in_review),
      waiting: sum((l) => l.approved_waiting),
      live: sum((l) => l.live),
    },
  };
}
