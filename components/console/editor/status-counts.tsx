import { StatusBadge } from '@/components/console/status-badge';
import {
  nonZeroCounts,
  type EditorStatus,
  type StatusCounts,
} from '@/lib/console/editor';

const PLAIN: Record<EditorStatus, [string, string]> = {
  draft: ['draft', 'drafts'],
  in_review: ['in review', 'in review'],
  changes_requested: ['needs changes', 'need changes'],
  approved: ['approved', 'approved'],
  rejected: ['rejected', 'rejected'],
  demo: ['demo', 'demo'],
  retired: ['retired', 'retired'],
};

/** "2 drafts · 1 in review" as small badges, or `empty` when there are none. */
export function StatusCounts({
  counts,
  empty = 'No lessons yet',
}: {
  counts: StatusCounts;
  empty?: string;
}) {
  const shown = nonZeroCounts(counts);
  if (shown.length === 0) return <p className="editor-counts-empty">{empty}</p>;
  return (
    <ul className="editor-counts" aria-label="Lessons by status">
      {shown.map(({ status, count }) => (
        <li key={status}>
          <StatusBadge
            status={status}
            label={`${count} ${PLAIN[status][count === 1 ? 0 : 1]}`}
          />
        </li>
      ))}
    </ul>
  );
}
