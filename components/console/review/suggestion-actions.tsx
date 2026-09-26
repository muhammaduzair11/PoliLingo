'use client';
import { ConfirmAction } from '@/components/console/confirm-action';
import type { ActionResult } from '@/lib/console/action-result';
import { useOutcome } from './outcome';

type FormAction = (
  previous: ActionResult<unknown> | null,
  formData: FormData,
) => Promise<ActionResult<unknown>>;

/**
 * Accept or Decline one suggested fix. Accept sends the fingerprint of the
 * phrase as shown, so it applies only to the text on screen. Either one
 * takes the suggestion off the list, so the confirmation goes to the page's
 * OutcomeProvider.
 */
export function SuggestionActions({
  suggestionId,
  fingerprint,
  suggesterName,
  canAccept,
  accept,
  decline,
}: {
  suggestionId: string;
  fingerprint: string;
  suggesterName: string;
  canAccept: boolean;
  accept: FormAction;
  decline: FormAction;
}) {
  const announce = useOutcome();
  return (
    <div className="console-actions review-suggestion-actions">
      {canAccept && (
        <ConfirmAction
          action={accept}
          triggerTone="primary"
          triggerLabel="Accept"
          title="Apply this fix?"
          description={`The phrase changes exactly as shown, with ${suggesterName} as its author. It goes back into review, and another reviewer approves the new text.`}
          confirmLabel="Apply fix"
          pendingLabel="Applying…"
          onSuccess={() =>
            announce(
              `Fix applied. The phrase is back in review, with ${suggesterName} as its author.`,
            )
          }
          fields={{
            suggestion_id: suggestionId,
            seen_fingerprint: fingerprint,
          }}
        />
      )}
      <ConfirmAction
        action={decline}
        triggerTone="outline"
        triggerLabel="Decline"
        title="Decline this fix?"
        description={`${suggesterName} sees your reason next to their suggestion.`}
        confirmLabel="Decline"
        pendingLabel="Declining…"
        tone="danger"
        fields={{ suggestion_id: suggestionId }}
        onSuccess={() =>
          announce(`Declined. ${suggesterName} will see your reason.`)
        }
      >
        <div className="console-field review-dialog-field">
          <label className="console-label" htmlFor={`decline-${suggestionId}`}>
            Reason
          </label>
          <textarea
            id={`decline-${suggestionId}`}
            name="reason"
            rows={3}
            maxLength={2000}
            required
            className="console-input"
            placeholder="For example: the current meaning is the more common one."
          />
        </div>
      </ConfirmAction>
    </div>
  );
}
