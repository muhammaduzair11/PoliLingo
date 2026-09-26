'use client';
import { useActionState, useId, useState } from 'react';
import { SubmitButton } from '@/components/console/submit-button';
import {
  createLesson,
  createUnit,
  setDemoSunset,
} from '@/app/(console)/edit/actions';
import { LIMITS, echo, type EditorResult } from '@/lib/console/editor';
import { ActionNotice } from './action-notice';
import { Disclosure } from './disclosure';

type Variety = { id: string; name: string };

/** One labelled input or textarea, with its hint tied to it. */
function TextField({
  name,
  label,
  hint,
  defaultValue,
  required = false,
  multiline = false,
  maxLength,
  invalid,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue: string;
  required?: boolean;
  multiline?: boolean;
  maxLength: number;
  invalid?: boolean;
}) {
  const id = useId();
  const props = {
    id,
    name,
    defaultValue,
    required,
    maxLength,
    className: 'console-input',
    'aria-describedby': hint ? `${id}-hint` : undefined,
    'aria-invalid': invalid || undefined,
  };
  return (
    <div className="console-field">
      <label htmlFor={id} className="console-label">
        {label}
        {!required && <span className="editor-optional"> (optional)</span>}
      </label>
      {multiline ? <textarea rows={2} {...props} /> : <input {...props} />}
      {hint && (
        <p id={`${id}-hint`} className="console-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

/** "New unit" at the foot of a course. The unit starts held back. */
export function NewUnitForm({
  courseId,
  courseName,
}: {
  courseId: string;
  courseName: string;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [result, formAction] = useActionState(
    async (
      previous: EditorResult<{ id: string }> | null,
      formData: FormData,
    ) => {
      const next = await createUnit(previous, formData);
      if (next.ok) {
        const title = formData.get('title');
        setSaved(typeof title === 'string' ? title.trim() : '');
        setOpen(false);
      }
      return next;
    },
    null,
  );
  const values = result && !result.ok ? result.values : undefined;
  const field = result && !result.ok ? result.field : undefined;
  return (
    <div className="editor-new">
      <Disclosure
        label="New unit"
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setSaved(null);
        }}
      >
        <form action={formAction} className="console-form editor-inline-form">
          <p className="editor-form-title">New unit in {courseName}</p>
          <input type="hidden" name="course_id" value={courseId} />
          <TextField
            name="title"
            label="Title"
            hint="Short and concrete, like “At the market”."
            defaultValue={echo(values, 'title', '')}
            maxLength={LIMITS.unitTitle.max}
            required
            invalid={field === 'title'}
          />
          <TextField
            name="goal"
            label="Goal"
            hint="What a learner can do after this unit, in a sentence."
            defaultValue={echo(values, 'goal', '')}
            maxLength={LIMITS.unitGoal.max}
            multiline
            required
            invalid={field === 'goal'}
          />
          <TextField
            name="theme"
            label="Theme"
            defaultValue={echo(values, 'theme', '')}
            maxLength={LIMITS.unitTheme.max}
            invalid={field === 'theme'}
          />
          <ActionNotice result={result} />
          <div className="console-actions">
            <SubmitButton pendingLabel="Adding…">Add unit</SubmitButton>
            <button
              type="button"
              className="console-button console-button-quiet"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </Disclosure>
      {saved !== null && !open && (
        <output className="editor-saved">
          Unit “{saved}” added at the end. It stays held back from learners
          until an admin opens it.
        </output>
      )}
    </div>
  );
}

/** "New lesson" at the foot of a unit. Saving opens the new lesson. */
export function NewLessonForm({
  unitId,
  unitLabel,
  varieties,
  defaultVariety,
}: {
  unitId: string;
  unitLabel: string;
  varieties: Variety[];
  defaultVariety: string;
}) {
  const [open, setOpen] = useState(false);
  const [result, formAction] = useActionState(createLesson, null);
  const values = result && !result.ok ? result.values : undefined;
  const field = result && !result.ok ? result.field : undefined;
  const varietyId = useId();
  const minutesId = useId();
  return (
    <div className="editor-new">
      <Disclosure
        label="New lesson"
        tone="quiet"
        open={open}
        onOpenChange={setOpen}
      >
        <form action={formAction} className="console-form editor-inline-form">
          <p className="editor-form-title">New lesson in {unitLabel}</p>
          <input type="hidden" name="unit_id" value={unitId} />
          <TextField
            name="title"
            label="Title"
            hint="What learners see in the lesson list, like “Saying hello”."
            defaultValue={echo(values, 'title', '')}
            maxLength={LIMITS.lessonTitle.max}
            required
            invalid={field === 'title'}
          />
          <TextField
            name="objective"
            label="Objective"
            hint="What the learner can do by the end, in one sentence."
            defaultValue={echo(values, 'objective', '')}
            maxLength={LIMITS.lessonObjective.max}
            multiline
            required
            invalid={field === 'objective'}
          />
          <TextField
            name="subtitle"
            label="Subtitle"
            defaultValue={echo(values, 'subtitle', '')}
            maxLength={LIMITS.lessonSubtitle.max}
            invalid={field === 'subtitle'}
          />
          <div className="editor-field-row">
            <div className="console-field">
              <label htmlFor={varietyId} className="console-label">
                Variety
              </label>
              <select
                id={varietyId}
                name="variety"
                className="console-input"
                defaultValue={echo(values, 'variety', defaultVariety)}
              >
                {varieties.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="console-field">
              <label htmlFor={minutesId} className="console-label">
                Minutes <span className="editor-optional">(optional)</span>
              </label>
              <input
                id={minutesId}
                name="estimated_minutes"
                type="number"
                inputMode="numeric"
                min={LIMITS.minutes.min}
                max={LIMITS.minutes.max}
                className="console-input"
                defaultValue={echo(values, 'estimated_minutes', '')}
                aria-invalid={field === 'estimated_minutes' || undefined}
              />
            </div>
          </div>
          <ActionNotice result={result} />
          <div className="console-actions">
            <SubmitButton pendingLabel="Creating…">
              Create and open
            </SubmitButton>
            <button
              type="button"
              className="console-button console-button-quiet"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </Disclosure>
    </div>
  );
}

/** Admin only: the last day a language's demo lessons stay live. */
export function DemoSunsetForm({
  language,
  languageName,
  sunset,
  today,
}: {
  language: string;
  languageName: string;
  sunset: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [result, formAction] = useActionState(
    async (previous: EditorResult<unknown> | null, formData: FormData) => {
      const next = await setDemoSunset(previous, formData);
      if (next.ok) setOpen(false);
      return next;
    },
    null,
  );
  const values = result && !result.ok ? result.values : undefined;
  const dateId = useId();
  return (
    <div className="editor-new">
      <Disclosure
        label="Change date"
        tone="quiet"
        open={open}
        onOpenChange={setOpen}
      >
        <form action={formAction} className="console-form editor-inline-form">
          <p className="editor-form-title">Demo lessons in {languageName}</p>
          <input type="hidden" name="language" value={language} />
          <div className="console-field">
            <label htmlFor={dateId} className="console-label">
              Last day they stay live
            </label>
            <input
              id={dateId}
              name="sunset"
              type="date"
              min={today}
              required
              className="console-input"
              defaultValue={echo(values, 'sunset', sunset)}
            />
          </div>
          <TextField
            name="reason"
            label="Why? A short note for the history"
            defaultValue={echo(values, 'reason', '')}
            maxLength={500}
            multiline
            required
          />
          <ActionNotice result={result} />
          <div className="console-actions">
            <SubmitButton pendingLabel="Saving…">Save date</SubmitButton>
            <button
              type="button"
              className="console-button console-button-quiet"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </Disclosure>
      {result?.ok && !open && (
        <output className="editor-saved">
          Saved. The new date applies from the next release.
        </output>
      )}
    </div>
  );
}
