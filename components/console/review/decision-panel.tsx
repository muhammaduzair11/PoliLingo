'use client';
import { useState, type ReactNode } from 'react';
import { ConfirmAction } from '@/components/console/confirm-action';
import { Notice } from '@/components/console/notice';
import type { ActionResult } from '@/lib/console/action-result';
import type {
  ApprovalStance,
  Direction,
  ItemFields,
  ScopePart,
  StaleSnapshot,
} from '@/lib/console/review';
import { ScopeChecklist } from './scope-checklist';
import { StaleNotice } from './stale-notice';

type DecisionData = {
  decision_id: string;
  status: string;
  sole_reviewer: boolean;
  countersign_required: boolean;
};
type DecisionAction = (
  previous: ActionResult<DecisionData> | null,
  formData: FormData,
) => Promise<ActionResult<DecisionData> & { stale?: StaleSnapshot }>;

/**
 * Approve, Request changes and Reject for one phrase or lesson. Every form
 * sends the fingerprint of the version on screen, so a decision can only
 * land on the text the reviewer actually read; if it changed meanwhile the
 * page says what changed and offers the latest version.
 *
 * Remount it (key it by the fingerprint) when a new version loads.
 */
export function DecisionPanel({
  targetType,
  targetId,
  fingerprint,
  stance,
  requiredScope,
  approveBlocked,
  varietyName,
  seen,
  lang,
  dir,
  action,
}: {
  targetType: 'item' | 'lesson';
  targetId: string;
  fingerprint: string;
  stance: ApprovalStance;
  /** Items: the parts to tick. Lessons: none. */
  requiredScope?: ScopePart[];
  /** Why a lesson cannot be approved yet (too few exercises, problems). */
  approveBlocked?: ReactNode;
  varietyName: string;
  seen?: ItemFields;
  lang: string;
  dir: Direction;
  action: DecisionAction;
}) {
  const [stale, setStale] = useState<StaleSnapshot | null>(null);
  const [done, setDone] = useState<ReactNode>(null);
  const what = targetType === 'item' ? 'phrase' : 'lesson';

  const run: DecisionAction = async (previous, formData) => {
    const result = await action(previous, formData);
    if (!result.ok && result.code === 'PL409_STALE')
      setStale(
        result.stale ?? { review_fingerprint: fingerprint, revision_no: 0 },
      );
    return result;
  };

  const fields = (decision: string) => ({
    target_type: targetType,
    target_id: targetId,
    seen_fingerprint: fingerprint,
    decision,
  });

  const staleNotice = stale && (
    <StaleNotice what={what} seen={seen} stale={stale} lang={lang} dir={dir} />
  );

  if (
    stance.kind === 'demo' ||
    stance.kind === 'retired' ||
    stance.kind === 'outside'
  )
    return null;

  const canApprove =
    stance.kind === 'can-approve' || stance.kind === 'sole-author';

  return (
    <div className="review-decisions">
      {staleNotice}
      {done && <Notice tone="success">{done}</Notice>}
      {canApprove && approveBlocked && (
        <Notice tone="info" title="Not ready to approve yet">
          {approveBlocked}
        </Notice>
      )}
      <div className="review-decision-buttons">
        {canApprove && !approveBlocked && (
          <ConfirmAction<DecisionData>
            action={run}
            triggerTone="primary"
            triggerLabel={`Approve ${what}`}
            title={`Approve this ${what}?`}
            description={
              targetType === 'item'
                ? 'Your approval covers exactly the text on this page.'
                : 'Your approval covers the lesson as it stands: its title, its phrases in order and its exercises.'
            }
            confirmLabel="Approve"
            pendingLabel="Approving…"
            fields={fields('approve')}
            onSuccess={(data) =>
              setDone(
                data.countersign_required
                  ? 'Approved. Because you wrote part of it, an admin will countersign before learners see it.'
                  : `Approved. Thank you for checking this ${what}.`,
              )
            }
          >
            {stance.kind === 'sole-author' && (
              <Notice tone="info" title="You wrote part of this">
                You&apos;re the only {varietyName} reviewer, so you can approve
                it. An admin will countersign before learners see it.
              </Notice>
            )}
            {requiredScope && requiredScope.length > 0 ? (
              <ScopeChecklist required={requiredScope} />
            ) : (
              <p className="console-hint">
                Approve the lesson once its phrases read well together and every
                exercise has one clear right answer.
              </p>
            )}
            <div className="console-field review-dialog-field">
              <label
                className="console-label"
                htmlFor={`${targetId}-approve-note`}
              >
                Note (optional)
              </label>
              <textarea
                id={`${targetId}-approve-note`}
                name="comment"
                rows={2}
                maxLength={2000}
                className="console-input"
              />
            </div>
            {staleNotice}
          </ConfirmAction>
        )}
        <ConfirmAction<DecisionData>
          action={run}
          triggerTone="outline"
          triggerLabel="Request changes"
          title="What needs to change?"
          description={`The editor sees your note next to the ${what}. Be specific: which word, and what it should be.`}
          confirmLabel="Send request"
          pendingLabel="Sending…"
          fields={fields('request_changes')}
          onSuccess={() =>
            setDone(`Sent. The editor will see your note on this ${what}.`)
          }
        >
          <div className="console-field review-dialog-field">
            <label
              className="console-label"
              htmlFor={`${targetId}-changes-note`}
            >
              Your note
            </label>
            <textarea
              id={`${targetId}-changes-note`}
              name="comment"
              rows={4}
              maxLength={2000}
              required
              className="console-input"
            />
          </div>
          {staleNotice}
        </ConfirmAction>
        <ConfirmAction<DecisionData>
          action={run}
          tone="danger"
          triggerTone="quiet"
          triggerLabel={`Reject ${what}`}
          title={`Reject this ${what}?`}
          description={`Reject it when it shouldn't be taught at all. To fix a word, request changes or suggest a fix instead.`}
          confirmLabel="Reject"
          pendingLabel="Rejecting…"
          fields={fields('reject')}
          onSuccess={() => setDone(`Rejected. The editor will see why.`)}
        >
          <div className="console-field review-dialog-field">
            <label
              className="console-label"
              htmlFor={`${targetId}-reject-note`}
            >
              Why shouldn&apos;t learners see this?
            </label>
            <textarea
              id={`${targetId}-reject-note`}
              name="comment"
              rows={4}
              maxLength={2000}
              required
              className="console-input"
            />
          </div>
          {staleNotice}
        </ConfirmAction>
      </div>
    </div>
  );
}
