'use client';
import { useId, useState } from 'react';
import { ConfirmAction } from '@/components/console/confirm-action';
import { DataTable, type Column } from '@/components/console/data-table';
import { EmptyState } from '@/components/console/empty-state';
import { StatusBadge } from '@/components/console/status-badge';
import type { ActionResult } from '@/lib/console/action-result';
import { count, listJoin } from './format';
import { ReleaseOutcome } from './release-outcome';
import type { PublishOutcome, ReleaseRow } from './types';

export type HistoryRow = ReleaseRow & {
  /** Preformatted on the server, so server and browser agree. */
  publishedLabel: string;
};

type RollbackAction = (
  previous: ActionResult<PublishOutcome> | null,
  formData: FormData,
) => Promise<ActionResult<PublishOutcome>>;

const KIND_BY: Record<ReleaseRow['kind'], string> = {
  seed: 'First content load',
  publish: 'an admin',
  rollback: 'an admin',
};

function Contents({ row }: { row: ReleaseRow }) {
  const parts = [
    row.reviewed_lessons ? `${row.reviewed_lessons} reviewed` : '',
    row.demo_lessons ? `${row.demo_lessons} demo` : '',
    row.kind !== 'rollback' && row.carried_lessons
      ? `${row.carried_lessons} kept as before`
      : '',
  ].filter(Boolean);
  return (
    <span className="publish-lesson">
      <span>
        {count(row.lessons, 'lesson', 'lessons')},{' '}
        {count(row.items, 'phrase', 'phrases')}
      </span>
      {parts.length > 0 && (
        <span className="publish-lesson-meta">{listJoin(parts)}</span>
      )}
    </span>
  );
}

function Published({ row }: { row: HistoryRow }) {
  return (
    <span className="publish-lesson">
      <time dateTime={row.published_at}>{row.publishedLabel}</time>
      <span className="publish-lesson-meta">
        {row.kind === 'seed' && !row.published_by_name
          ? KIND_BY.seed
          : `By ${row.published_by_name ?? KIND_BY[row.kind]}`}
      </span>
    </span>
  );
}

function ReleaseName({ row, live }: { row: ReleaseRow; live: boolean }) {
  return (
    <span className="publish-lesson">
      <span className="publish-release-name">
        <span>{row.name}</span>
        {live && <StatusBadge status="live" label="Live now" />}
      </span>
      {row.kind === 'rollback' && row.restored && (
        <span className="publish-lesson-meta">Went back to {row.restored}</span>
      )}
      {row.note && (
        <span className="publish-note" title={row.note}>
          {row.note}
        </span>
      )}
    </span>
  );
}

/**
 * Every release, newest first; the first is what learners have now. An
 * older release with different content can be brought back: that publishes
 * its lessons again as a new release, and both stay in the history.
 */
export function ReleaseHistory({
  releases,
  nextName,
  action,
}: {
  releases: HistoryRow[];
  /** The name the next release gets, for the rollback dialog. */
  nextName: string;
  action: RollbackAction;
}) {
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  if (releases.length === 0)
    return (
      <EmptyState title="Nothing has been published yet">
        <p>
          Your first release will show here, with who published it and when.
        </p>
      </EmptyState>
    );
  const live = releases[0];
  const columns: Column<HistoryRow>[] = [
    {
      key: 'name',
      header: 'Release',
      cell: (row) => <ReleaseName row={row} live={row.name === live.name} />,
    },
    {
      key: 'at',
      header: 'Published',
      cell: (row) => <Published row={row} />,
    },
    {
      key: 'lessons',
      header: 'Contents',
      cell: (row) => <Contents row={row} />,
    },
  ];
  const canGoBack = (row: HistoryRow) =>
    row.name !== live.name && row.content_hash !== live.content_hash;
  if (releases.some(canGoBack))
    columns.push({
      key: 'action',
      header: 'Go back',
      align: 'end',
      cell: (row) =>
        canGoBack(row) ? (
          <RollbackButton
            row={row}
            liveName={live.name}
            nextName={nextName}
            action={action}
            onDone={setOutcome}
          />
        ) : (
          <span className="publish-muted">—</span>
        ),
    });
  return (
    <div className="publish-history">
      <div aria-live="polite" className="publish-outcome">
        {outcome && <ReleaseOutcome key={outcome.name} outcome={outcome} />}
      </div>
      <DataTable rows={releases} rowKey={(row) => row.name} columns={columns} />
    </div>
  );
}

function RollbackButton({
  row,
  liveName,
  nextName,
  action,
  onDone,
}: {
  row: HistoryRow;
  liveName: string;
  nextName: string;
  action: RollbackAction;
  onDone: (outcome: PublishOutcome) => void;
}) {
  const reasonId = useId();
  const hintId = useId();
  return (
    <ConfirmAction
      action={action}
      triggerLabel={
        <>
          Go back<span className="sr-only"> to {row.name}</span>
        </>
      }
      title={`Go back to ${row.name}?`}
      description={
        <>
          Learners get the {count(row.lessons, 'lesson', 'lessons')} of{' '}
          {row.name} again, exactly as they were, in a new release, {nextName}.{' '}
          {liveName} stays in the history. Lessons that are ready now come back
          in the next preview, so close a lesson&apos;s publish gate first if it
          must stay out.
        </>
      }
      confirmLabel={`Go back to ${row.name}`}
      pendingLabel="Going back…"
      tone="danger"
      fields={{ release: row.name }}
      onSuccess={onDone}
    >
      <div className="console-field">
        <label htmlFor={reasonId} className="console-label">
          Why? (for the history)
        </label>
        <textarea
          id={reasonId}
          name="reason"
          rows={2}
          required
          maxLength={500}
          aria-describedby={hintId}
          className="console-input"
          placeholder="For example: a phrase in the new lesson is wrong"
        />
        <p id={hintId} className="console-hint">
          Required. Up to 500 characters.
        </p>
      </div>
    </ConfirmAction>
  );
}
