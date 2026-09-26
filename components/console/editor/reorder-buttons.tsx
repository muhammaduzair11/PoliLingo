'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { reorderChildren, type ParentType } from '@/app/(console)/edit/actions';
import {
  moveInList,
  movedAnnouncement,
  type MoveDirection,
} from '@/lib/console/editor';

/**
 * Move up / Move down for one child of a parent (a unit in its course, a
 * lesson in its unit, a phrase or an exercise in its lesson). Plain buttons,
 * so the keyboard works as it does everywhere; after a move, focus stays on
 * the button that was pressed (or its partner at the ends) and the new
 * position is announced.
 */
export function ReorderButtons({
  parentType,
  parentId,
  ids,
  id,
  label,
  disabled = false,
}: {
  parentType: ParentType;
  parentId: string;
  /** Every live sibling, in the current order. */
  ids: string[];
  id: string;
  /** What moves, for the buttons' names and the announcement: "Hello". */
  label: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<{
    message: string;
    stale: boolean;
  } | null>(null);
  const router = useRouter();
  const [refocus, setRefocus] = useState<MoveDirection | null>(null);
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);
  const index = ids.indexOf(id);
  const first = index <= 0;
  const last = index === ids.length - 1;

  useEffect(() => {
    if (!refocus || pending) return;
    const wanted = refocus === 'up' ? up.current : down.current;
    const other = refocus === 'up' ? down.current : up.current;
    (wanted && !wanted.disabled ? wanted : other)?.focus();
  }, [refocus, pending, ids]);

  function move(direction: MoveDirection) {
    const next = moveInList(ids, id, direction);
    if (!next) return;
    setError(null);
    setRefocus(null);
    startTransition(async () => {
      const result = await reorderChildren(parentType, parentId, next);
      if (result.ok) {
        const text = movedAnnouncement(label, next, id);
        setMessage(text.charAt(0).toUpperCase() + text.slice(1));
        setRefocus(direction);
      } else {
        // The database refuses a list that no longer matches (another tab
        // or editor changed it): say so, and offer the fresh list.
        const stale = result.code === 'PL422_BAD_INPUT';
        setError({
          message: stale
            ? 'This list changed since you opened the page.'
            : result.message,
          stale,
        });
      }
    });
  }

  if (ids.length < 2) return null;
  return (
    <div className="editor-reorder">
      <button
        ref={up}
        type="button"
        className="editor-icon-button"
        onClick={() => move('up')}
        disabled={disabled || pending || first}
        aria-label={`Move ${label} up`}
        title="Move up"
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        ref={down}
        type="button"
        className="editor-icon-button"
        onClick={() => move('down')}
        disabled={disabled || pending || last}
        aria-label={`Move ${label} down`}
        title="Move down"
      >
        <span aria-hidden="true">↓</span>
      </button>
      <span className="editor-visually-hidden" aria-live="polite">
        {pending ? 'Moving…' : message}
      </span>
      {error && (
        <div className="editor-reorder-error" role="alert">
          <p>{error.message}</p>
          {error.stale && (
            <button
              type="button"
              className="console-button console-button-outline editor-inline-button"
              onClick={() => {
                setError(null);
                router.refresh();
              }}
            >
              Load the latest version
            </button>
          )}
        </div>
      )}
    </div>
  );
}
