'use client';
import { useId, useState } from 'react';
import {
  SCOPE_LABELS,
  missingScopes,
  type ScopePart,
} from '@/lib/console/review';

/**
 * The parts of a phrase the reviewer confirms they checked. Every listed
 * part is required (the browser will not submit the form until each is
 * ticked, and the database refuses an incomplete scope too); the count
 * below says how far along they are.
 */
export function ScopeChecklist({ required }: { required: ScopePart[] }) {
  const id = useId();
  const [ticked, setTicked] = useState<ScopePart[]>([]);
  const missing = missingScopes(required, ticked);
  const done = required.length - missing.length;
  return (
    <fieldset className="review-scope">
      <legend className="console-label">What did you check?</legend>
      <p className="console-hint">
        Tick each part once you&apos;re sure of it. All {required.length} are
        needed to approve.
      </p>
      <div className="review-scope-options">
        {required.map((part) => {
          const inputId = `${id}-${part}`;
          const { label, hint } = SCOPE_LABELS[part];
          return (
            <div key={part} className="review-scope-option">
              <input
                id={inputId}
                type="checkbox"
                name="scope"
                value={part}
                required
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
              <label htmlFor={inputId} className="review-scope-label">
                {label}
              </label>
              <span id={`${inputId}-hint`} className="review-scope-hint">
                {hint}
              </span>
            </div>
          );
        })}
      </div>
      <p
        className={`review-scope-count${missing.length === 0 ? ' review-scope-count-done' : ''}`}
        aria-live="polite"
      >
        {missing.length === 0
          ? 'All checked. Ready to approve.'
          : `${done} of ${required.length} checked`}
      </p>
    </fieldset>
  );
}
