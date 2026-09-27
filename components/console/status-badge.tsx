export type ContentStatus =
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'live'
  | 'gated'
  | 'retired'
  | 'demo'
  | 'sole_reviewer';

export const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  live: 'Live',
  gated: 'Gated',
  retired: 'Retired',
  demo: 'Demo',
  sole_reviewer: 'Needs countersign',
};

/** A small coloured label for a content state. Staff only: never on a learner page. */
export function StatusBadge({
  status,
  label,
}: {
  status: ContentStatus;
  label?: string;
}) {
  return (
    <span className={`status-badge status-badge-${status}`}>
      {label ?? STATUS_LABELS[status]}
    </span>
  );
}
