'use client';
import { useId, useState } from 'react';
import { ConfirmAction } from '@/components/console/confirm-action';
import { Notice } from '@/components/console/notice';
import type { ActionResult } from '@/lib/console/action-result';
import { ReleaseOutcome } from './release-outcome';
import type { PublishOutcome, PublishState } from './types';

/** Refusals after which the page shows a new preview (the action refreshes it). */
const STALE = new Set(['PL409_RELEASE_CHANGED', 'PL409_NOTHING_TO_PUBLISH']);

type StaleRefusal = { code: string; message: string };

function StaleNotice({ refusal }: { refusal: StaleRefusal }) {
  if (refusal.code === 'PL409_NOTHING_TO_PUBLISH')
    return (
      <Notice tone="warning" title="Nothing was published" code={refusal.code}>
        {refusal.message}
      </Notice>
    );
  return (
    <Notice
      tone="warning"
      title="Nothing was published: the preview changed"
      code={refusal.code}
    >
      Something changed while you were looking. The preview on this page is up
      to date now, so check it again before you publish.
    </Notice>
  );
}

/**
 * The Publish button, what stands in for it when there is nothing to
 * publish, and what came of the last publish. It stays mounted across the
 * refresh a publish causes, so the result stays on screen (and is announced)
 * after the preview turns to "up to date".
 *
 * The confirm dialog is keyed by the previewed contentHash: when a stale
 * preview is refused, the page refreshes, the dialog closes, and the refusal
 * shows here beside the new preview, so the admin never confirms a preview
 * they haven't seen.
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
  const [stale, setStale] = useState<StaleRefusal | null>(null);

  const run = async (
    previous: ActionResult<PublishOutcome> | null,
    formData: FormData,
  ): Promise<ActionResult<PublishOutcome>> => {
    const result = await action(previous, formData);
    setStale(
      !result.ok && STALE.has(result.code)
        ? { code: result.code, message: result.message }
        : null,
    );
    return result;
  };

  return (
    <div className="publish-control">
      {state === 'ready' && (
        <ConfirmAction
          key={contentHash}
          action={run}
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
        {stale && <StaleNotice refusal={stale} />}
        {outcome && <ReleaseOutcome key={outcome.name} outcome={outcome} />}
      </div>
    </div>
  );
}
