'use client';
import { ConfirmAction } from '@/components/console/confirm-action';
import type { ActionResult } from '@/lib/console/action-result';
import { useOutcome } from './outcome';

type FormAction = (
  previous: ActionResult<unknown> | null,
  formData: FormData,
) => Promise<ActionResult<unknown>>;

/** An admin removes the text of a comment; the entry stays in the history. */
export function RedactButton({
  commentId,
  action,
}: {
  commentId: string;
  action: FormAction;
}) {
  return (
    <ConfirmAction
      action={action}
      triggerTone="quiet"
      triggerLabel="Remove text"
      title="Remove this comment's text?"
      description="The entry stays in the history as “[removed]”. Use this for personal details or anything abusive."
      confirmLabel="Remove text"
      pendingLabel="Removing…"
      tone="danger"
      fields={{ comment_id: commentId }}
    >
      <div className="console-field review-dialog-field">
        <label className="console-label" htmlFor={`redact-${commentId}`}>
          Reason (kept in the audit log)
        </label>
        <textarea
          id={`redact-${commentId}`}
          name="reason"
          rows={2}
          maxLength={500}
          required
          className="console-input"
        />
      </div>
    </ConfirmAction>
  );
}

/** The suggester takes back their open suggestion. */
export function WithdrawButton({
  suggestionId,
  action,
}: {
  suggestionId: string;
  action: FormAction;
}) {
  return (
    <ConfirmAction
      action={action}
      triggerTone="quiet"
      triggerLabel="Withdraw"
      title="Withdraw your suggestion?"
      description="Editors won't see it any more. You can suggest a new fix at any time."
      confirmLabel="Withdraw"
      pendingLabel="Withdrawing…"
      fields={{ suggestion_id: suggestionId }}
    />
  );
}

/**
 * An admin countersigns a sole reviewer's approval of text they wrote, so
 * it can publish. The database refuses the reviewer themself. The button
 * leaves the page once the review is countersigned, so the confirmation goes
 * to the page's OutcomeProvider.
 */
export function CountersignButton({
  decisionId,
  reviewerName,
  action,
}: {
  decisionId: string;
  reviewerName: string;
  action: FormAction;
}) {
  const announce = useOutcome();
  return (
    <ConfirmAction
      action={action}
      triggerTone="primary"
      triggerLabel="Countersign"
      title="Countersign this approval?"
      description={`${reviewerName} approved text they wrote, as the only reviewer for this variety. Your countersignature lets it publish.`}
      confirmLabel="Countersign"
      pendingLabel="Countersigning…"
      fields={{ decision_id: decisionId }}
      onSuccess={() =>
        announce(
          `Countersigned. ${reviewerName}'s approval can go into the next release.`,
        )
      }
    >
      <div className="console-field review-dialog-field">
        <label className="console-label" htmlFor={`countersign-${decisionId}`}>
          Note (optional)
        </label>
        <textarea
          id={`countersign-${decisionId}`}
          name="comment"
          rows={2}
          maxLength={2000}
          className="console-input"
        />
      </div>
    </ConfirmAction>
  );
}
