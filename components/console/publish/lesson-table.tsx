import { DataTable, type Column } from '@/components/console/data-table';
import { StatusBadge } from '@/components/console/status-badge';
import type { LessonSummary } from './types';

/** "Demo" for starter lessons, "Reviewed" for the rest. */
export function ClassBadge({
  lessonClass,
}: {
  lessonClass: LessonSummary['class'];
}) {
  if (lessonClass === 'demo') return <StatusBadge status="demo" />;
  if (lessonClass === 'reviewed')
    return <StatusBadge status="approved" label="Reviewed" />;
  return <StatusBadge status="draft" label="Not ready" />;
}

/**
 * For a lesson left out of the next release: the main reason in one badge
 * (the Why column says the rest).
 */
export function HeldBadge({ row }: { row: LessonSummary }) {
  const codes = new Set(row.reasons.map((reason) => reason.code));
  if (codes.has('retired')) return <StatusBadge status="retired" />;
  if (codes.has('gated')) return <StatusBadge status="gated" />;
  if (row.class === 'demo' || codes.has('demo_exit'))
    return <StatusBadge status="demo" />;
  if (codes.has('lesson_not_approved') || codes.has('items_not_approved'))
    return <StatusBadge status="in_review" label="Needs review" />;
  if (codes.has('awaiting_countersign'))
    return <StatusBadge status="sole_reviewer" />;
  return <StatusBadge status="draft" label="Not ready" />;
}

function LessonCell({ row }: { row: LessonSummary }) {
  const where = [row.unit_title, row.course_name].filter(Boolean).join(' · ');
  return (
    <span className="publish-lesson">
      <span className="publish-lesson-title">{row.title ?? row.id}</span>
      {where && <span className="publish-lesson-meta">{where}</span>}
    </span>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <ul className="publish-chips">
      {items.map((item) => (
        <li key={item} className="publish-chip">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Reasons({ row, fallback }: { row: LessonSummary; fallback?: string }) {
  if (row.reasons.length === 0)
    return fallback ? <span className="publish-muted">{fallback}</span> : null;
  return (
    <ul className="publish-reasons">
      {row.reasons.map((reason, i) => (
        <li key={`${reason.code}-${i}`}>{reason.message}</li>
      ))}
    </ul>
  );
}

/**
 * Lessons in one group of the preview. `detail` adds a column: what changed
 * (from lib/console/release-diff.ts), why a lesson is left out, the size, or
 * for a lesson carried at its published version, what its edit still needs.
 */
export function LessonTable({
  rows,
  detail,
  changes,
  caption,
}: {
  rows: LessonSummary[];
  detail: 'changes' | 'reasons' | 'size' | 'pending';
  /** Plain-English changes per lesson id, for detail="changes". */
  changes?: Map<string, string[]>;
  caption?: string;
}) {
  const columns: Column<LessonSummary>[] = [
    {
      key: 'lesson',
      header: 'Lesson',
      cell: (row) => <LessonCell row={row} />,
    },
    {
      key: 'language',
      header: 'Language',
      cell: (row) => row.language_name ?? row.language,
    },
    detail === 'reasons'
      ? {
          key: 'state',
          header: 'State',
          cell: (row) => <HeldBadge row={row} />,
        }
      : {
          key: 'class',
          header: 'Content',
          cell: (row) => <ClassBadge lessonClass={row.class} />,
        },
  ];
  if (detail === 'changes')
    columns.push({
      key: 'changes',
      header: 'What changed',
      cell: (row) => <Chips items={changes?.get(row.id) ?? ['Updated']} />,
    });
  if (detail === 'reasons')
    columns.push({
      key: 'reasons',
      header: 'Why',
      cell: (row) => <Reasons row={row} />,
    });
  if (detail === 'pending')
    columns.push({
      key: 'pending',
      header: 'Still needs',
      cell: (row) => <Reasons row={row} fallback="A review of the changes." />,
    });
  if (detail === 'size')
    columns.push({
      key: 'size',
      header: 'Phrases',
      align: 'end',
      cell: (row) => row.items,
    });
  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
    />
  );
}
