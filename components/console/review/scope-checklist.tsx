'use client';
import { useEffect, useId, useRef, useState } from 'react';
import {
  SCOPE_LABELS,
  missingScopes,
  type ScopePart,
} from '@/lib/console/review';

/**
 * The parts of a phrase the reviewer confirms they checked. Every listed
 * part is required: the dialog keeps Approve off until each is ticked (and
 * the database refuses an incomplete scope too), and the count below says
 * how far along they are. The whole card is the checkbox’s label, so a tap
 * anywhere on it ticks it; there is no `required` attribute, so the browser
 * never puts up its own bubble.
 */
export function ScopeChecklist({
  required,
  onProgress,
}: {
  required: ScopePart[];
  /** Hears whether every part is ticked. */
  onProgress?: (complete: boolean) => void;
}) {
  const id = useId();
  const fieldset = useRef<HTMLFieldSetElement>(null);
  const [ticked, setTicked] = useState<ScopePart[]>([]);
  // React resets the form after its server action returns, which unticks the
  // boxes on screen; clear the state with it, so the count never says "All
  // checked" over empty boxes (after a stale-text refusal, the reviewer
  // checks the new text again anyway).
  useEffect(() => {
    const form = fieldset.current?.form;
    if (!form) return;
    const clear = () => setTicked([]);
    form.addEventListener('reset', clear);
    return () => form.removeEventListener('reset', clear);
  }, []);
  const missing = missingScopes(required, ticked);
  const done = required.length - missing.length;
  const complete = missing.length === 0;
  useEffect(() => {
    onProgress?.(complete);
  }, [complete, onProgress]);
  return (
    <fieldset ref={fieldset} className="review-scope">
      <legend className="console-label">What did you check?</legend>
      <p className="console-hint">
        Tick each part once you’re sure of it. All {required.length} are needed
        to approve.
      </p>
      <div className="review-scope-options">
        {required.map((part) => {
          const inputId = `${id}-${part}`;
          const { label, hint } = SCOPE_LABELS[part];
          return (
            <label key={part} htmlFor={inputId} className="review-scope-option">
              <input
                id={inputId}
                type="checkbox"
                name="scope"
                value={part}
                aria-describedby={`${inputId}-hint`}
                checked={ticked.includes(part)}
                onChange={(event) =>
                  setTicked((now) =>
                    event.target.checked
                      ? [...now, part]
                      : now.filter((p) => p !== part),
                  )
                }
              />
              <span className="review-scope-label">{label}</span>
              <span id={`${inputId}-hint`} className="review-scope-hint">
                {hint}
              </span>
            </label>
          );
        })}
      </div>
      <p
        className={`review-scope-count${complete ? ' review-scope-count-done' : ''}`}
        aria-live="polite"
      >
        {complete
          ? 'All checked. Ready to approve.'
          : `${done} of ${required.length} checked`}
      </p>
    </fieldset>
  );
}
