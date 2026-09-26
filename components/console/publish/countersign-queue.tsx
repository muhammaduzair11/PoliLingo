'use client';
import { useId, useState } from 'react';
import { ConfirmAction } from '@/components/console/confirm-action';
import { DataTable } from '@/components/console/data-table';
import { EmptyState } from '@/components/console/empty-state';
import { Notice } from '@/components/console/notice';
import { NativeText } from '@/components/native';
import type { ActionResult } from '@/lib/console/action-result';
import type { AwaitingCountersign } from './types';

export type CountersignRow = AwaitingCountersign & {
  /** Preformatted on the server, so server and browser agree. */
  approvedOn: string;
};

/**
 * Sole-reviewer approvals waiting for an admin (docs/platform.md 3.5): each
 * with a Countersign button when track D's countersign_decision is
 * installed. A countersigned approval leaves the list on the refresh; the
 * sentence below says what happened.
 */
export function CountersignQueue({
  rows,
  available,
  action,
}: {
  rows: CountersignRow[];
  available: boolean;
  action: (
    previous: ActionResult<{ decision_id: string }> | null,
    formData: FormData,
  ) => Promise<ActionResult<{ decision_id: string }>>;
}) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="publish-countersign">
      {rows.length === 0 ? (
        <EmptyState title="No approvals are waiting for a countersign">
          <p>
            When a variety has only one reviewer, their approvals come here for
            an admin to confirm before learners see them.
          </p>
        </EmptyState>
      ) : (
        <>
          {!available && (
            <Notice tone="info">
              Countersigning opens with the review tools. Until then these
              approvals stay out of releases.
            </Notice>
          )}
          <DataTable
            rows={rows}
            rowKey={(row) => row.decision_id}
            columns={[
              {
                key: 'what',
                header: 'Approval',
                cell: (row) => <Target row={row} />,
              },
              {
                key: 'variety',
                header: 'Variety',
                cell: (row) => row.variety_name,
              },
              {
                key: 'reviewer',
                header: 'Reviewer',
                cell: (row) => row.reviewer_name ?? row.reviewer_id,
              },
              {
                key: 'at',
                header: 'Approved',
                cell: (row) => row.approvedOn,
                hideOnMobile: true,
              },
              ...(available
                ? [
                    {
                      key: 'action',
                      header: 'Action',
                      align: 'end' as const,
                      cell: (row: CountersignRow) => (
                        <CountersignButton
                          row={row}
                          action={action}
                          onDone={setDone}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </>
      )}
      <div aria-live="polite">
        {done && (
          <Notice tone="success">
            Countersigned: {done}. It goes out with the next release.
          </Notice>
        )}
      </div>
    </div>
  );
}

const labelFor = (row: AwaitingCountersign) =>
  row.target_type === 'lesson'
    ? `the lesson “${row.lesson_title ?? row.target_id}”`
    : `“${row.meaning ?? row.target_id}” in ${row.lesson_title ?? 'its lesson'}`;

function Target({ row }: { row: AwaitingCountersign }) {
  if (row.target_type === 'lesson')
    return (
      <span className="publish-lesson">
        <span className="publish-lesson-title">
          {row.lesson_title ?? row.target_id}
        </span>
        <span className="publish-lesson-meta">Whole lesson</span>
      </span>
    );
  return (
    <span className="publish-lesson">
      {row.native && (
        <NativeText text={row.native} lang={row.language} dir={row.direction} />
      )}
      <span className="publish-lesson-meta">
        {row.meaning}
        {row.lesson_title && <> · in {row.lesson_title}</>}
      </span>
    </span>
  );
}

function CountersignButton({
  row,
  action,
  onDone,
}: {
  row: AwaitingCountersign;
  action: (
    previous: ActionResult<{ decision_id: string }> | null,
    formData: FormData,
  ) => Promise<ActionResult<{ decision_id: string }>>;
  onDone: (label: string) => void;
}) {
  const commentId = useId();
  const label = labelFor(row);
  return (
    <ConfirmAction
      action={action}
      triggerLabel="Countersign"
      title="Countersign this approval?"
      description={
        <>
          {row.reviewer_name ?? 'The reviewer'} is the only {row.variety_name}{' '}
          reviewer, so their approval of {label} needs an admin to confirm it.
          Once you countersign, it can go out with the next release.
        </>
      }
      confirmLabel="Countersign"
      pendingLabel="Countersigning…"
      fields={{ decision_id: row.decision_id }}
      onSuccess={() => onDone(label)}
    >
      <div className="console-field">
        <label htmlFor={commentId} className="console-label">
          Comment <span className="publish-optional">(optional)</span>
        </label>
        <textarea
          id={commentId}
          name="comment"
          rows={2}
          maxLength={2000}
          className="console-input"
        />
      </div>
    </ConfirmAction>
  );
}
