'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Notice } from '@/components/console/notice';
import {
  staleChanges,
  type Direction,
  type ItemFields,
  type StaleSnapshot,
} from '@/lib/console/review';
import { FieldDiff } from './field-diff';

/**
 * Shown when an action was refused because the text changed while the
 * reviewer had it open (PL409_STALE): what changed, and a button that
 * loads the latest version. Nothing was recorded.
 */
export function StaleNotice({
  what,
  seen,
  stale,
  lang,
  dir,
}: {
  /** "phrase" or "lesson" */
  what: string;
  /** The text the reviewer was looking at (items only). */
  seen?: ItemFields;
  stale: StaleSnapshot;
  lang: string;
  dir: Direction;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const changes = seen ? staleChanges(seen, stale) : [];
  return (
    <Notice
      tone="warning"
      title={`This ${what} changed while you had it open`}
      code="PL409_STALE"
    >
      <p>
        Nothing was recorded.{' '}
        {changes.length > 0
          ? 'Here is what changed. Load the latest version, check it again, then decide.'
          : `Someone saved a new version${stale.revision_no > 0 ? ` (revision ${stale.revision_no})` : ''}. Load it, check it again, then decide.`}
      </p>
      {changes.length > 0 && (
        <FieldDiff
          changes={changes}
          lang={lang}
          dir={dir}
          beforeLabel="You saw"
          afterLabel="Now"
          caption="What changed since you opened this page"
        />
      )}
      <p className="console-actions review-stale-actions">
        <button
          type="button"
          className="console-button console-button-primary"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() => startTransition(() => router.refresh())}
        >
          {pending ? 'Loading…' : 'Load the latest version'}
        </button>
      </p>
    </Notice>
  );
}
