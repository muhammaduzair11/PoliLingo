'use client';
import { useActionState, useId, useState } from 'react';
import { Notice } from '@/components/console/notice';
import { ScriptField } from '@/components/console/script-field';
import { SubmitButton } from '@/components/console/submit-button';
import type { ActionResult } from '@/lib/console/action-result';
import {
  FIELD_LABELS,
  proposedChanges,
  suggestionDiff,
  type Direction,
  type ItemField,
  type ItemFields,
  type StaleSnapshot,
} from '@/lib/console/review';
import { FieldDiff } from './field-diff';
import { StaleNotice } from './stale-notice';

type SuggestAction = (
  previous: ActionResult<string> | null,
  formData: FormData,
) => Promise<ActionResult<string> & { stale?: StaleSnapshot }>;

type Values = Record<ItemField, string>;

const valuesOf = (item: ItemFields): Values => ({
  native: item.native,
  romanisation: item.romanisation,
  meaning: item.meaning,
  context: item.context ?? '',
  usage_note: item.usage_note ?? '',
});

/**
 * "Suggest a fix": the phrase's fields, prefilled, with the same live
 * script checks the editor has. A native-script letter in the
 * romanisation, or an invisible character in the native text, is flagged
 * as it is typed. An editor applies the fix word for word later; the
 * reviewer who suggested it cannot then approve it alone.
 */
export function SuggestFix({
  itemId,
  fingerprint,
  current,
  lang,
  dir,
  action,
}: {
  itemId: string;
  fingerprint: string;
  current: ItemFields;
  lang: string;
  dir: Direction;
  action: SuggestAction;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const [values, setValues] = useState<Values>(() => valuesOf(current));
  const [scriptErrors, setScriptErrors] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState(false);
  const [result, formAction] = useActionState(
    async (previous: ActionResult<string> | null, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.ok) {
        setOpen(false);
        setSent(true);
        setValues(valuesOf(current));
        setScriptErrors({});
        setRound((r) => r + 1);
      }
      return next;
    },
    null,
  );

  const changes = suggestionDiff(current, proposedChanges(current, values));
  const blocked = Object.values(scriptErrors).some(Boolean);
  const set = (field: ItemField) => (value: string) =>
    setValues((now) => ({ ...now, [field]: value }));
  const stale =
    result && !result.ok && result.code === 'PL409_STALE'
      ? ((result as { stale?: StaleSnapshot }).stale ?? {
          review_fingerprint: fingerprint,
          revision_no: 0,
        })
      : null;

  if (!open)
    return (
      <div className="review-suggest">
        {sent && (
          <Notice tone="success">
            Thanks. Your suggestion is with the editors. Once one applies it,
            another reviewer checks the new text.
          </Notice>
        )}
        <button
          type="button"
          className="console-button console-button-outline"
          onClick={() => {
            setSent(false);
            setOpen(true);
          }}
        >
          Suggest a fix
        </button>
      </div>
    );

  return (
    <form
      key={round}
      id={`${id}-form`}
      action={formAction}
      className="console-form review-suggest-form"
      aria-labelledby={`${id}-title`}
    >
      <div className="review-suggest-head">
        <h3 id={`${id}-title`} className="review-subtitle">
          Suggest a fix
        </h3>
        <p className="console-hint">
          Change only what&apos;s wrong. An editor applies your fix exactly as
          you write it.
        </p>
      </div>
      <input type="hidden" name="item_id" value={itemId} />
      <input type="hidden" name="seen_fingerprint" value={fingerprint} />
      <ScriptField
        name="native"
        label={FIELD_LABELS.native}
        language={lang}
        dir={dir}
        kind="native"
        defaultValue={current.native}
        required
        onValueChange={(value, issues) => {
          set('native')(value);
          setScriptErrors((now) => ({
            ...now,
            native: issues.some((i) => i.severity === 'error'),
          }));
        }}
      />
      <ScriptField
        name="romanisation"
        label={FIELD_LABELS.romanisation}
        language={lang}
        dir={dir}
        kind="romanisation"
        defaultValue={current.romanisation}
        required
        hint="Latin letters only, the way a learner says it."
        onValueChange={(value, issues) => {
          set('romanisation')(value);
          setScriptErrors((now) => ({
            ...now,
            romanisation: issues.some((i) => i.severity === 'error'),
          }));
        }}
      />
      <div className="console-field">
        <label className="console-label" htmlFor={`${id}-meaning`}>
          {FIELD_LABELS.meaning}
        </label>
        <input
          id={`${id}-meaning`}
          name="meaning"
          className="console-input"
          required
          maxLength={200}
          value={values.meaning}
          onChange={(event) => set('meaning')(event.target.value)}
        />
      </div>
      <div className="console-field">
        <label className="console-label" htmlFor={`${id}-context`}>
          {FIELD_LABELS.context}
        </label>
        <textarea
          id={`${id}-context`}
          name="context"
          className="console-input"
          rows={2}
          maxLength={300}
          value={values.context}
          onChange={(event) => set('context')(event.target.value)}
        />
      </div>
      <div className="console-field">
        <label className="console-label" htmlFor={`${id}-usage`}>
          {FIELD_LABELS.usage_note}
        </label>
        <textarea
          id={`${id}-usage`}
          name="usage_note"
          className="console-input"
          rows={2}
          maxLength={500}
          value={values.usage_note}
          onChange={(event) => set('usage_note')(event.target.value)}
        />
      </div>
      <div className="console-field">
        <label className="console-label" htmlFor={`${id}-note`}>
          Why? (optional)
        </label>
        <textarea
          id={`${id}-note`}
          name="note"
          className="console-input"
          rows={2}
          maxLength={2000}
          placeholder="For example: this is how people in Peshawar say it."
        />
      </div>

      <div className="review-suggest-summary" aria-live="polite">
        {changes.length === 0 ? (
          <p className="console-hint">
            Nothing changed yet. Edit a field above to suggest a fix.
          </p>
        ) : (
          <>
            <p className="review-suggest-count">
              Your fix changes{' '}
              {changes.map((c) => c.label.toLowerCase()).join(', ')}.
            </p>
            <FieldDiff
              changes={changes}
              lang={lang}
              dir={dir}
              beforeLabel="Now"
              afterLabel="Your fix"
              caption="Your suggested changes"
            />
          </>
        )}
      </div>

      {stale ? (
        <StaleNotice
          what="phrase"
          seen={current}
          stale={stale}
          lang={lang}
          dir={dir}
        />
      ) : (
        result &&
        !result.ok && (
          <Notice tone="error" code={result.code}>
            {result.message}
          </Notice>
        )
      )}

      <div className="console-actions">
        <SubmitButton
          pendingLabel="Sending…"
          disabled={changes.length === 0 || blocked}
        >
          Send suggestion
        </SubmitButton>
        <button
          type="button"
          className="console-button console-button-quiet"
          onClick={() => {
            setOpen(false);
            setValues(valuesOf(current));
            setScriptErrors({});
          }}
        >
          Cancel
        </button>
      </div>
      {blocked && (
        <p className="console-hint review-suggest-blocked">
          Fix the flagged characters first. The database would refuse them.
        </p>
      )}
    </form>
  );
}
