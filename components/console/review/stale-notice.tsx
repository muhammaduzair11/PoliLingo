'use client';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
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

// Two contexts: the setter never changes, so what calls it is not
// re-rendered by the notice it sets; only the slot reads the notice.
const StaleShow = createContext<((notice: ReactNode) => void) | null>(null);
const StaleShown = createContext<ReactNode>(null);

/**
 * Lets the page’s stale notice sit above both columns, full width, where
 * the before-and-after table has room, instead of inside the narrow side
 * column the decision buttons live in. Wrap the page; put <StaleSlot />
 * where the notice goes.
 */
export function StaleHost({ children }: { children: ReactNode }) {
  const [notice, show] = useState<ReactNode>(null);
  return (
    <StaleShow value={show}>
      <StaleShown value={notice}>{children}</StaleShown>
    </StaleShow>
  );
}

/** Where a StaleHost shows its notice. */
export function StaleSlot() {
  const notice = useContext(StaleShown);
  return notice ? <div className="review-stale-slot">{notice}</div> : null;
}

/**
 * Shows `notice` (memoised by the caller) in the page’s StaleSlot while it
 * is set; returns false when there is no host, so the caller shows it
 * itself.
 */
export function useStaleSlot(notice: ReactNode): boolean {
  const show = useContext(StaleShow);
  useEffect(() => {
    if (!show) return;
    show(notice);
    return () => show(null);
  }, [show, notice]);
  return show !== null;
}
