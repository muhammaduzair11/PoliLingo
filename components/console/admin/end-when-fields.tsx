'use client';
import { useId, useState } from 'react';

/**
 * Inside the "End role" dialog: end it now, or at the start of a chosen
 * day (UTC), plus an optional reason kept in the role's history. For a role
 * already due to end, `maxDate` is its end day: ending only brings it
 * forward, so no later day is offered, and none at all when it ends before
 * the earliest day that can be picked.
 */
export function EndWhenFields({
  minDate,
  maxDate = null,
}: {
  minDate: string;
  maxDate?: string | null;
}) {
  const id = useId();
  const [when, setWhen] = useState<'now' | 'date'>('now');
  const canPickDate = maxDate === null || maxDate >= minDate;
  return (
    <>
      {canPickDate ? (
        <fieldset className="console-choices end-when">
          <legend className="console-label">When should it end?</legend>
          <label className="console-choice">
            <input
              type="radio"
              name="when"
              value="now"
              checked={when === 'now'}
              onChange={() => setWhen('now')}
            />
            <span>Now</span>
          </label>
          <label className="console-choice">
            <input
              type="radio"
              name="when"
              value="date"
              checked={when === 'date'}
              onChange={() => setWhen('date')}
            />
            <span>On a date</span>
          </label>
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="when" value="now" />
          <p className="console-hint">
            It already ends before tomorrow, so it can only end now.
          </p>
        </>
      )}
      {canPickDate && when === 'date' && (
        <div className="console-field">
          <label htmlFor={`${id}-date`} className="console-label">
            End date
          </label>
          <input
            id={`${id}-date`}
            name="end_date"
            type="date"
            min={minDate}
            max={maxDate ?? undefined}
            defaultValue={minDate}
            required
            className="console-input"
            aria-describedby={`${id}-date-hint`}
          />
          <p id={`${id}-date-hint`} className="console-hint">
            The role ends as this day begins (UTC). Until then nothing changes
            for them.
          </p>
        </div>
      )}
      <div className="console-field">
        <label htmlFor={`${id}-reason`} className="console-label">
          Reason <span className="invite-optional">(optional)</span>
        </label>
        <textarea
          id={`${id}-reason`}
          name="reason"
          rows={2}
          maxLength={500}
          className="console-input"
          placeholder="For example: project finished"
        />
      </div>
    </>
  );
}
