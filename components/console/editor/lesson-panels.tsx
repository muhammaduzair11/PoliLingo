'use client';
import { useActionState, useId, useState } from 'react';
import { ConfirmAction } from '@/components/console/confirm-action';
import { SubmitButton } from '@/components/console/submit-button';
import {
  generateExercises,
  submitLesson,
  updateLesson,
  withdrawSubmission,
} from '@/app/(console)/edit/lesson/[id]/actions';
import {
  EXERCISE_KIND_LABELS,
  LIMITS,
  MIN_EXERCISES,
  echo,
  formatDay,
  handoffCopy,
  type EditExercise,
  type EditItem,
  type EditLessonPage,
  type ReadinessCheck,
} from '@/lib/console/editor';
import {
  generateExercises as planExercises,
  planCounts,
  type GeneratedKind,
} from '@/lib/console/exercise-generator';
import { ActionNotice } from './action-notice';

type Lesson = EditLessonPage['lesson'];
type Variety = { id: string; name: string };

/** The lesson's title, subtitle, objective, variety and length. */
export function LessonMetaForm({
  lesson,
  varieties,
}: {
  lesson: Lesson;
  varieties: Variety[];
}) {
  const [result, formAction] = useActionState(updateLesson, null);
  const values = result && !result.ok ? result.values : undefined;
  const field = result && !result.ok ? result.field : undefined;
  const titleId = useId();
  const subtitleId = useId();
  const objectiveId = useId();
  const varietyId = useId();
  const minutesId = useId();
  return (
    <form action={formAction} className="console-form">
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
      <div className="editor-field-row">
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
            aria-invalid={field === 'estimated_minutes' || undefined}
          />
        </div>
      </div>
      <ActionNotice result={result} success="Lesson details saved." />
      <div className="console-actions">
        <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
      </div>
    </form>
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
  const plan = planExercises(items, exercises);
  const meaningOf = new Map(items.map((i) => [i.id, i.meaning]));
  const success =
    result?.ok &&
    `Added ${result.data.added} ${result.data.added === 1 ? 'exercise' : 'exercises'}. Check them below; you can edit or reorder any of them.`;
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
            lesson&apos;s own phrases.
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
            {e.kind === 'meaning' && (
              <span className="editor-muted"> ({meaningOf.get(e.answer)})</span>
            )}
          </li>
        ))}
      </ol>
      <ActionNotice result={result} success={success} />
    </div>
  );
}

/**
 * The lesson's readiness and its review hand-off: Submit for review when it
 * is ready (a confirm first), Withdraw while it waits.
 */
export function SubmitPanel({
  lesson,
  checks,
  ready,
  varietyName,
  locked,
}: {
  lesson: Lesson;
  checks: ReadinessCheck[];
  ready: boolean;
  varietyName: string;
  locked: boolean;
}) {
  const [withdrawResult, withdrawAction] = useActionState(
    withdrawSubmission,
    null,
  );
  const inReview =
    lesson.submitted_at !== null && lesson.review_status === 'unreviewed';
  const sentBack =
    lesson.review_status === 'changes_requested' ||
    lesson.review_status === 'rejected';
  const copy = handoffCopy(varietyName, lesson.reviewers);
  return (
    <section className="editor-panel" aria-labelledby="submit-heading">
      <h2 id="submit-heading" className="editor-panel-title">
        Review
      </h2>
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
              <span>
                <strong>{check.label}</strong>{' '}
                <span className="editor-visually-hidden">
                  {check.ok ? '(done)' : '(to do)'}
                </span>
                <span className="editor-check-detail">{check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="editor-panel-text" aria-live="polite">
        {locked
          ? "This lesson can't be sent for review."
          : inReview
            ? `${copy.waiting} since ${formatDay(lesson.submitted_at)}. You can keep editing: changes go to the reviewer too.`
            : lesson.review_status === 'approved'
              ? 'Approved. Any change to it sends it back to review.'
              : sentBack && lesson.changed_since_review
                ? ready
                  ? "You've changed it since the review. Send it back when you're ready."
                  : "You've changed it since the review. Finish the checks, then send it back."
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
      {!locked && !inReview && lesson.review_status !== 'approved' && (
        <SubmitButtonWithConfirm
          lessonId={lesson.id}
          ready={ready && (!sentBack || lesson.changed_since_review)}
          hint={
            sentBack && !lesson.changed_since_review
              ? 'Change something the reviewer asked about first.'
              : 'Finish the checks above first.'
          }
          confirm={copy.confirm}
        />
      )}
      {withdrawResult && !withdrawResult.ok && (
        <ActionNotice result={withdrawResult} />
      )}
    </section>
  );
}

function SubmitButtonWithConfirm({
  lessonId,
  ready,
  hint,
  confirm,
}: {
  lessonId: string;
  ready: boolean;
  /** Why the button is off, for screen readers. */
  hint: string;
  confirm: string;
}) {
  const hintId = useId();
  if (!ready)
    return (
      <>
        <button
          type="button"
          className="console-button console-button-primary"
          disabled
          aria-describedby={hintId}
        >
          Submit for review
        </button>
        <p id={hintId} className="editor-visually-hidden">
          {hint}
        </p>
      </>
    );
  return (
    <ConfirmAction
      action={submitLesson}
      triggerLabel="Submit for review"
      triggerTone="primary"
      title="Send this lesson for review?"
      description={confirm}
      confirmLabel="Submit for review"
      pendingLabel="Sending…"
      fields={{ lesson_id: lessonId }}
      successMessage="Sent. It's in the review queue now."
    />
  );
}
