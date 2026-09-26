'use client';
import { useId, useState } from 'react';
import { ConfirmAction } from '@/components/console/confirm-action';
import { Notice } from '@/components/console/notice';
import type { ActionResult } from '@/lib/console/action-result';
import { ReleaseOutcome } from './release-outcome';
import type { PublishOutcome, PublishState } from './types';

/**
 * The Publish button, what stands in for it when there is nothing to
 * publish, and what came of the last publish. It stays mounted across the
 * refresh a publish causes, so the result stays on screen (and is announced)
 * after the preview turns to "up to date".
 */
export function PublishControl({
  state,
  release,
  contentHash,
  summary,
  action,
}: {
  state: PublishState;
  /** The name the next release will get, e.g. content@2026.09.2. */
  release: string;
  /** The previewed contentHash: the database refuses the publish if it changed. */
  contentHash: string;
  /** One sentence on what learners get, for the confirm dialog. */
  summary: string;
  action: (
    previous: ActionResult<PublishOutcome> | null,
    formData: FormData,
  ) => Promise<ActionResult<PublishOutcome>>;
}) {
  const noteId = useId();
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  return (
    <div className="publish-control">
      {state === 'ready' && (
        <ConfirmAction
          action={action}
          triggerLabel={`Publish ${release}`}
          triggerTone="primary"
          title={`Publish ${release}?`}
          description={
            <>
              {summary} Learners&apos; apps pick it up the next time they open,
              within a minute. If something&apos;s wrong, you can go back to an
              earlier release from the history.
            </>
          }
          confirmLabel="Publish now"
          pendingLabel="Publishing…"
          fields={{ expected_hash: contentHash }}
          onSuccess={setOutcome}
        >
          <div className="console-field">
            <label htmlFor={noteId} className="console-label">
              Note for the history{' '}
              <span className="publish-optional">(optional)</span>
            </label>
            <textarea
              id={noteId}
              name="note"
              rows={2}
              maxLength={500}
              className="console-input"
              placeholder="What's new, in a few words"
            />
          </div>
        </ConfirmAction>
      )}
      {state === 'empty' && (
        <Notice tone="warning" code="PL422_EMPTY_RELEASE">
          This release would have no lessons in it, so it can&apos;t be
          published. Check the lessons held back below.
        </Notice>
      )}
      {state === 'clock' && (
        <Notice tone="warning" code="PL409_RELEASE_CLOCK">
          A release is dated later than today, so the next name can&apos;t be
          worked out. Publishing is paused until the clock is fixed. Please tell
          the team.
        </Notice>
      )}
      {state === 'check_failed' && (
        <Notice tone="warning" code="PL422_HASH_MISMATCH">
          The preview didn&apos;t pass its content check, so publishing is
          paused. Nothing was changed. Please tell the team.
        </Notice>
      )}
      <div aria-live="polite" className="publish-outcome">
        {outcome && <ReleaseOutcome key={outcome.name} outcome={outcome} />}
      </div>
    </div>
  );
}
