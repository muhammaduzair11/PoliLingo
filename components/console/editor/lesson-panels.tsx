'use client';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { Notice } from '@/components/console/notice';
import { SubmitButton } from '@/components/console/submit-button';
import {
  generateExercises,
  updateLesson,
  withdrawSubmission,
} from '@/app/(console)/edit/lesson/[id]/actions';
import {
  EXERCISE_KIND_LABELS,
  LIMITS,
  MIN_EXERCISES,
  checklistProblems,
  echo,
  formatDay,
  handoffCopy,
  sentBack,
  type EditExercise,
  type EditItem,
  type EditLessonPage,
  type Problem,
  type ReadinessCheck,
} from '@/lib/console/editor';
import {
  generateExercises as planExercises,
  planCounts,
  type GeneratedKind,
} from '@/lib/console/exercise-generator';
import { ActionNotice } from './action-notice';
import { ProblemLines } from './lesson-aside';
import { SubmitForReview, useLessonStatus } from './lesson-status';
import { UnsavedNote, useDirtyForm } from './unsaved';

type Lesson = EditLessonPage['lesson'];
type Variety = { id: string; name: string };

/** The lesson’s title, subtitle, objective, variety and length. */
function LessonMetaForm({
  lesson,
  varieties,
  onSaved,
  onCancel,
}: {
  lesson: Lesson;
  varieties: Variety[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [result, formAction] = useActionState(
    async (
      previous: Awaited<ReturnType<typeof updateLesson>> | null,
      formData: FormData,
    ) => {
      const next = await updateLesson(previous, formData);
      if (next.ok) onSaved();
      return next;
    },
    null,
  );
  const values = result && !result.ok ? result.values : undefined;
  const field = result && !result.ok ? result.field : undefined;
  const { ref, dirty, onChange } = useDirtyForm();
  const titleId = useId();
  const subtitleId = useId();
  const objectiveId = useId();
  const varietyId = useId();
  const minutesId = useId();
  return (
    <form
      ref={ref}
      action={formAction}
      onChange={onChange}
      className="console-form"
    >
      <input type="hidden" name="lesson_id" value={lesson.id} />
      <input type="hidden" name="revision_no" value={lesson.revision_no} />
      <div className="console-field">
        <label htmlFor={titleId} className="console-label">
          Title
        </label>
        <input
          id={titleId}
          name="title"
          className="console-input"
          required
          maxLength={LIMITS.lessonTitle.max}
          defaultValue={echo(values, 'title', lesson.title)}
          aria-invalid={field === 'title' || undefined}
        />
      </div>
      <div className="console-field">
        <label htmlFor={subtitleId} className="console-label">
          Subtitle <span className="editor-optional">(optional)</span>
        </label>
        <input
          id={subtitleId}
          name="subtitle"
          className="console-input"
          maxLength={LIMITS.lessonSubtitle.max}
          defaultValue={echo(values, 'subtitle', lesson.subtitle)}
          aria-invalid={field === 'subtitle' || undefined}
        />
      </div>
      <div className="console-field">
        <label htmlFor={objectiveId} className="console-label">
          Objective
        </label>
        <textarea
          id={objectiveId}
          name="objective"
          className="console-input"
          rows={2}
          required
          maxLength={LIMITS.lessonObjective.max}
          defaultValue={echo(values, 'objective', lesson.objective)}
          aria-describedby={`${objectiveId}-hint`}
          aria-invalid={field === 'objective' || undefined}
        />
        <p id={`${objectiveId}-hint`} className="console-hint">
          What the learner can do by the end, in one sentence.
        </p>
      </div>
      <div className="editor-field-row editor-field-row-minutes">
        <div className="console-field">
          <label htmlFor={varietyId} className="console-label">
            Variety
          </label>
          <select
            id={varietyId}
            name="variety"
            className="console-input"
            defaultValue={echo(values, 'variety', lesson.variety_id)}
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
            defaultValue={echo(
              values,
              'estimated_minutes',
              lesson.estimated_minutes,
            )}
            aria-describedby={`${minutesId}-hint`}
            aria-invalid={field === 'estimated_minutes' || undefined}
          />
          <p id={`${minutesId}-hint`} className="console-hint">
            Up to {LIMITS.minutes.max} minutes.
          </p>
        </div>
      </div>
      <ActionNotice result={result} />
      <div className="console-actions">
        <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
        <button
          type="button"
          className="console-button console-button-quiet"
          onClick={onCancel}
        >
          Cancel
        </button>
        <UnsavedNote dirty={dirty} />
      </div>
    </form>
  );
}

/**
 * "About this lesson": a short summary (objective, variety, length), with
 * "Edit details" opening the form in its place, as a phrase card does. The
 * form is out of the way until it is wanted, so the phrases are near the top.
 */
export function LessonDetails({
  lesson,
  varieties,
  varietyName,
  locked,
}: {
  lesson: Lesson;
  varieties: Variety[];
  varietyName: string;
  locked: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const section = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const was = useRef(editing);
  useEffect(() => {
    if (editing && !was.current)
      section.current
        ?.querySelector<HTMLElement>('input:not([type=hidden]), textarea')
        ?.focus();
    if (!editing && was.current) trigger.current?.focus();
    was.current = editing;
  }, [editing]);
  return (
    <section
      ref={section}
      className="editor-section"
      aria-labelledby="details-heading"
    >
      <div className="editor-section-head">
        <h2 id="details-heading">About this lesson</h2>
        {!locked && !editing && (
          <button
            ref={trigger}
            type="button"
            className="console-button console-button-outline editor-small-button"
            aria-expanded={false}
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            Edit details
          </button>
        )}
      </div>
      {editing ? (
        <LessonMetaForm
          lesson={lesson}
          varieties={varieties}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <dl className="editor-details">
          <dt>Objective</dt>
          <dd>{lesson.objective}</dd>
          {lesson.subtitle && (
            <>
              <dt>Subtitle</dt>
              <dd>{lesson.subtitle}</dd>
            </>
          )}
          <dt>Variety</dt>
          <dd>{varietyName}</dd>
          <dt>Length</dt>
          <dd>
            {lesson.estimated_minutes
              ? `About ${lesson.estimated_minutes} minutes`
              : 'Not set'}
          </dd>
        </dl>
      )}
      <div className="editor-result" aria-live="polite">
        {saved && !editing && (
          <p className="editor-saved">Lesson details saved.</p>
        )}
      </div>
    </section>
  );
}

const KIND_ORDER: GeneratedKind[] = [
  'meaning',
  'translation',
  'match',
  'assemble',
];

/** "4 meaning, 4 translation, 1 match and 1 build the sentence" */
function planSummary(counts: Record<GeneratedKind, number>): string {
  const parts = KIND_ORDER.filter((k) => counts[k] > 0).map(
    (k) => `${counts[k]} ${EXERCISE_KIND_LABELS[k].toLowerCase()}`,
  );
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * "Generate exercises": previews the plan the generator makes from the
 * phrases (the same plan the server makes again when saving), then adds it.
 * The button goes once everything is planned, so focus moves to the
 * confirmation rather than falling back to the top of the page.
 */
export function GeneratePanel({
  lessonId,
  items,
  exercises,
}: {
  lessonId: string;
  items: EditItem[];
  exercises: EditExercise[];
}) {
  const [result, formAction] = useActionState(generateExercises, null);
  const [showPlan, setShowPlan] = useState(false);
  const planId = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const plan = planExercises(items, exercises);
  const meaningOf = new Map(items.map((i) => [i.id, i.meaning]));
  const success =
    result?.ok &&
    `Added ${result.data.added} ${result.data.added === 1 ? 'exercise' : 'exercises'}. Check them below; you can edit or reorder any of them.`;
  useEffect(() => {
    if (!result) return;
    const frame = requestAnimationFrame(() => resultRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [result]);
  return (
    <div className="editor-generate">
      <div className="editor-generate-text">
        <p className="editor-generate-title">Generate exercises</p>
        {items.length === 0 ? (
          <p className="editor-muted">
            Add phrases first: exercises are made from them.
          </p>
        ) : plan.length === 0 ? (
          <p className="editor-muted">
            Every phrase already has its exercises. Add a phrase to get more.
          </p>
        ) : (
          <p className="editor-muted">
            Adds {planSummary(planCounts(plan))}, with wrong choices from this
            lesson’s own phrases.
            {items.length < 3 &&
              ` With 3 or more phrases you get at least ${MIN_EXERCISES}.`}
          </p>
        )}
      </div>
      {plan.length > 0 && (
        <form action={formAction} className="console-actions">
          <input type="hidden" name="lesson_id" value={lessonId} />
          <SubmitButton pendingLabel="Adding exercises…">
            Add {plan.length} {plan.length === 1 ? 'exercise' : 'exercises'}
          </SubmitButton>
          <button
            type="button"
            className="console-button console-button-quiet"
            aria-expanded={showPlan}
            aria-controls={planId}
            onClick={() => setShowPlan((s) => !s)}
          >
            {showPlan ? 'Hide the list' : 'See the list'}
          </button>
        </form>
      )}
      <ol
        id={planId}
        className="editor-plan"
        hidden={!showPlan || plan.length === 0}
      >
        {plan.map((e) => (
          <li key={e.key}>
            <span className="editor-kind">{EXERCISE_KIND_LABELS[e.kind]}</span>{' '}
            {e.prompt}
            {(e.kind === 'meaning' || e.kind === 'assemble') && (
              <span className="editor-muted"> ({meaningOf.get(e.answer)})</span>
            )}
          </li>
        ))}
      </ol>
      <div ref={resultRef} tabIndex={-1} className="editor-generate-result">
        <ActionNotice result={result} success={success} />
      </div>
    </div>
  );
}

/**
 * The lesson’s review hand-off, in one panel: the checklist (each problem
 * under it with a link to the phrase or exercise at fault), what happens
 * next, Submit for review when it is ready (a confirm first), Withdraw
 * while it waits, and anything else worth knowing as a quiet footnote.
 */
export function SubmitPanel({
  lesson,
  checks,
  problems,
  ready,
  varietyName,
  locked,
}: {
  lesson: Lesson;
  checks: ReadinessCheck[];
  /** editorProblems(page): the panel lists those the rows don’t cover. */
  problems: Problem[];
  ready: boolean;
  varietyName: string;
  locked: boolean;
}) {
  const { sent, clearSent } = useLessonStatus();
  const heading = useRef<HTMLHeadingElement>(null);
  const [withdrawResult, withdrawAction] = useActionState(
    async (
      previous: Awaited<ReturnType<typeof withdrawSubmission>> | null,
      formData: FormData,
    ) => {
      const next = await withdrawSubmission(previous, formData);
      if (next.ok) clearSent();
      return next;
    },
    null,
  );
  const hintId = useId();
  const inReview =
    lesson.submitted_at !== null && lesson.review_status === 'unreviewed';
  const back = sentBack(lesson);
  const copy = handoffCopy(varietyName, lesson.reviewers);
  const { blocking, notes } = checklistProblems(problems);

  // After Submit (here or in the status strip) the button that had focus is
  // gone: focus the panel’s heading, where the confirmation now is. After
  // the confirm dialog has closed and handed focus back.
  useEffect(() => {
    if (sent === 0) return;
    const timer = window.setTimeout(() => heading.current?.focus(), 150);
    return () => window.clearTimeout(timer);
  }, [sent]);

  return (
    <section
      className="editor-panel editor-review-panel"
      aria-labelledby="submit-heading"
    >
      <h2
        id="submit-heading"
        ref={heading}
        tabIndex={-1}
        className="editor-panel-title"
      >
        Review
      </h2>
      {sent > 0 && inReview && <Notice tone="success">{copy.sent}</Notice>}
      {!locked && (
        <ul className="editor-checks">
          {checks.map((check) => (
            <li
              key={check.key}
              className={`editor-check editor-check-${check.ok ? 'ok' : 'todo'}`}
            >
              <span className="editor-check-mark" aria-hidden="true">
                {check.ok ? '✓' : '•'}
              </span>
              <span className="editor-check-body">
                <strong>{check.label}</strong>{' '}
                <span className="editor-visually-hidden">
                  {check.ok ? '(done)' : '(to do)'}
                </span>
                <span className="editor-check-detail">{check.detail}</span>
                {check.key === 'problems' && blocking.length > 0 && (
                  <ProblemLines problems={blocking} />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="editor-panel-text">
        {locked
          ? 'This lesson can’t be sent for review.'
          : inReview
            ? `${copy.waiting} since ${formatDay(lesson.submitted_at)}. You can keep editing: changes go to the reviewer too.`
            : lesson.review_status === 'approved'
              ? 'Approved. Any change to it sends it back to review.'
              : back && lesson.changed_since_review
                ? ready
                  ? 'You’ve changed it since the review. Send it back when you’re ready.'
                  : 'You’ve changed it since the review. Finish the checks, then send it back.'
                : lesson.review_status === 'changes_requested'
                  ? 'The reviewer asked for changes. Make them, then send it back.'
                  : lesson.review_status === 'rejected'
                    ? 'The reviewer turned this lesson down. Rework it, then send it again.'
                    : ready
                      ? copy.ready
                      : 'When every check is done, send it to a reviewer.'}
      </p>
      {!locked && inReview && (
        <form action={withdrawAction}>
          <input type="hidden" name="lesson_id" value={lesson.id} />
          <SubmitButton tone="outline" pendingLabel="Withdrawing…">
            Withdraw from review
          </SubmitButton>
        </form>
      )}
      {!locked &&
        !inReview &&
        lesson.review_status !== 'approved' &&
        (ready ? (
          <SubmitForReview
            lessonId={lesson.id}
            resend={back}
            confirm={copy.confirm}
          />
        ) : (
          <div className="editor-submit-off">
            <button
              type="button"
              className="console-button console-button-primary"
              disabled
              aria-describedby={hintId}
            >
              {back ? 'Send back to reviewer' : 'Submit for review'}
            </button>
            <p id={hintId} className="editor-submit-hint">
              {back && !lesson.changed_since_review
                ? 'Change something the reviewer asked about first.'
                : 'Finish the checks above first.'}
            </p>
          </div>
        ))}
      {withdrawResult && !withdrawResult.ok && (
        <ActionNotice result={withdrawResult} />
      )}
      {!locked && notes.length > 0 && (
        <div className="editor-panel-notes">
          <p className="editor-panel-notes-title">Good to know</p>
          <ProblemLines problems={notes} quiet />
        </div>
      )}
    </section>
  );
}
