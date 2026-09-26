'use client';
import { useActionState } from 'react';
import type { ActionResult } from '@/lib/console/action-result';
import { Notice } from './notice';
import { SubmitButton } from './submit-button';

/**
 * Shown by the console layout to a signed-in person with no profile yet:
 * one question, their age band, saved by ensure_profile(). Team roles need
 * 18 or over; the database checks that too.
 */
export function AgeBandPanel({
  action,
}: {
  action: (
    previous: ActionResult<unknown> | null,
    formData: FormData,
  ) => Promise<ActionResult<unknown>>;
}) {
  const [result, formAction] = useActionState(action, null);
  return (
    <section className="console-panel console-age-panel">
      <h1>One quick question</h1>
      <p>
        Before you open the workspace, tell us your age band. It stays with your
        account and nothing else is asked.
      </p>
      <form action={formAction} className="console-form">
        <fieldset className="console-choices">
          <legend className="console-label">How old are you?</legend>
          <label className="console-choice">
            <input type="radio" name="age_band" value="18+" required />
            <span>18 or over</span>
          </label>
          <label className="console-choice">
            <input type="radio" name="age_band" value="13-17" />
            <span>13 to 17</span>
          </label>
        </fieldset>
        <p className="console-hint">
          Reviewing, editing and admin roles are open to people 18 and over.
        </p>
        {result && !result.ok && (
          <Notice tone="error" code={result.code}>
            {result.message}
          </Notice>
        )}
        <div className="console-actions">
          <SubmitButton pendingLabel="Saving…">Continue</SubmitButton>
        </div>
      </form>
    </section>
  );
}
