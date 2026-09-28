'use client';
import { useActionState, useId, useState } from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { Notice } from '@/components/console/notice';
import { SubmitButton } from '@/components/console/submit-button';
import { NativeText } from '@/components/native';
import {
  createExercise,
  updateExercise,
} from '@/app/(console)/edit/lesson/[id]/actions';
import {
  EXERCISE_KINDS,
  EXERCISE_KIND_HINTS,
  EXERCISE_KIND_LABELS,
  LIMITS,
  choiceOptions,
  echo,
  itemById,
  type EditExercise,
  type EditItem,
  type EditorResult,
  type ExerciseKind,
} from '@/lib/console/editor';
import {
  MAX_DISTRACTORS,
  defaultPrompt,
  pickDistractors,
} from '@/lib/console/exercise-generator';
import { ActionNotice } from './action-notice';
import {
  Disclosure,
  useEditFocus,
  useRefocus,
  useRetiredFocus,
} from './disclosure';
import type { EditorLanguage } from './item-editor';
import { RetireButton } from './reason-dialog';
import { ReorderButtons } from './reorder-buttons';
import { UnsavedNote, useDirtyForm } from './unsaved';

type ExerciseResult = Awaited<ReturnType<typeof updateExercise>>;

/** The wrong choices "Generate exercises" would pick for `answerId`. */
function generatedChoices(items: readonly EditItem[], answerId: string) {
  const index = items.findIndex((i) => i.id === answerId);
  return index < 0 ? [] : pickDistractors(items, index, 1, MAX_DISTRACTORS);
}

/**
 * The exercise form: its kind, the phrase that answers it, the prompt, and
 * the wrong choices, picked from the lesson’s other phrases. A new exercise
 * starts ready to save: the generator’s prompt and up to 3 wrong choices.
 * Choices the database would refuse (the same text or meaning as the
 * answer) are shown but cannot be ticked; "Build the sentence" has no
 * choices at all. Too few or too many choices say so at once, before any
 * round trip. The prompt follows the kind and answer until it is changed.
 */
function ExerciseForm({
  lessonId,
  exercise,
  items,
  language,
  action,
  result,
  submitLabel,
  pendingLabel,
  onCancel,
  onKindChange,
}: {
  lessonId: string;
  exercise: EditExercise | null;
  items: EditItem[];
  language: EditorLanguage;
  action: (formData: FormData) => void;
  result: EditorResult<unknown> | null;
  submitLabel: string;
  pendingLabel: string;
  onCancel: () => void;
  /** The card’s badge follows the form. */
  onKindChange?: (kind: ExerciseKind) => void;
}) {
  const values = result && !result.ok ? result.values : undefined;
  const find = itemById(items);
  const { ref, dirty, onChange } = useDirtyForm();
  const startKind =
    (echo(values, 'kind', exercise?.kind ?? 'meaning') as ExerciseKind) ||
    'meaning';
  const startAnswer = echo(
    values,
    'answer',
    exercise?.answer_item_id ?? items[0]?.id,
  );
  const startPrompt = echo(values, 'prompt', exercise?.prompt);
  const [kind, setKind] = useState<ExerciseKind>(startKind);
  const [answer, setAnswer] = useState(startAnswer);
  const [options, setOptions] = useState<string[]>(
    () => exercise?.options ?? generatedChoices(items, startAnswer),
  );
  const [choicesTouched, setChoicesTouched] = useState(exercise !== null);
  const [prompt, setPrompt] = useState(startPrompt);
  // A saved prompt that is still the default for its kind counts as not
  // written by hand: changing the kind swaps it for the new default.
  const [promptTouched, setPromptTouched] = useState(
    startPrompt !== '' &&
      startPrompt !==
        defaultPrompt(startKind, find(startAnswer)?.meaning ?? ''),
  );
  const kindId = useId();
  const answerId = useId();
  const promptId = useId();
  const difficultyId = useId();
  const choicesHintId = useId();
  const choicesErrorId = useId();

  const answerItem = find(answer);
  const choices = choiceOptions(items, answer);
  const allowed = new Set(
    choices.filter((c) => c.blocked === null).map((c) => c.id),
  );
  const chosen = options.filter((id) => allowed.has(id));
  const suggested = defaultPrompt(kind, answerItem?.meaning ?? '');
  const shownPrompt = promptTouched ? prompt : suggested;
  const most = Math.min(LIMITS.options.max, allowed.size);
  const choicesError =
    kind === 'assemble'
      ? null
      : allowed.size === 0
        ? 'Add another phrase to this lesson first: it has nothing to offer as a wrong choice.'
        : chosen.length < LIMITS.options.min || chosen.length > most
          ? most === 1
            ? 'Pick 1 wrong choice.'
            : `Pick 1 to ${most} wrong choices.`
          : null;

  return (
    <form
      ref={ref}
      action={action}
      onChange={onChange}
      className="console-form editor-exercise-form"
    >
      <input type="hidden" name="lesson_id" value={lessonId} />
      {exercise && (
        <>
          <input type="hidden" name="exercise_id" value={exercise.id} />
          <input
            type="hidden"
            name="revision_no"
            value={exercise.revision_no}
          />
        </>
      )}
      <div className="editor-field-row">
        <div className="console-field">
          <label htmlFor={kindId} className="console-label">
            Kind
          </label>
          <select
            id={kindId}
            name="kind"
            className="console-input"
            value={kind}
            aria-describedby={`${kindId}-hint`}
            onChange={(event) => {
              const next = event.target.value as ExerciseKind;
              if (
                promptTouched &&
                prompt === defaultPrompt(kind, answerItem?.meaning ?? '')
              )
                setPromptTouched(false);
              setKind(next);
              onKindChange?.(next);
            }}
          >
            {EXERCISE_KINDS.map((k) => (
              <option key={k} value={k}>
                {EXERCISE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <p id={`${kindId}-hint`} className="console-hint">
            {EXERCISE_KIND_HINTS[kind]}
          </p>
        </div>
        <div className="console-field">
          <label htmlFor={answerId} className="console-label">
            Answer
          </label>
          <select
            id={answerId}
            name="answer"
            className="console-input"
            value={answer}
            required
            onChange={(event) => {
              const next = event.target.value;
              if (
                promptTouched &&
                prompt === defaultPrompt(kind, answerItem?.meaning ?? '')
              )
                setPromptTouched(false);
              setAnswer(next);
              setOptions((current) =>
                choicesTouched
                  ? current.filter((id) => id !== next)
                  : generatedChoices(items, next),
              );
            }}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.position}. {item.meaning} ({item.romanisation})
              </option>
            ))}
          </select>
          {answerItem && (
            <p className="editor-answer-native">
              <NativeText
                text={answerItem.native}
                lang={language.code}
                dir={language.direction}
              />
            </p>
          )}
        </div>
      </div>

      <div className="console-field">
        <label htmlFor={promptId} className="console-label">
          Prompt
        </label>
        <input
          id={promptId}
          name="prompt"
          className="console-input"
          required
          maxLength={LIMITS.prompt.max}
          value={shownPrompt}
          aria-describedby={`${promptId}-hint`}
          onChange={(event) => {
            setPromptTouched(true);
            setPrompt(event.target.value);
          }}
        />
        <p id={`${promptId}-hint`} className="console-hint">
          {kind === 'context' && !promptTouched ? (
            'Describe the moment first, like “You meet a friend. What do you say?”'
          ) : promptTouched && suggested && suggested !== prompt ? (
            <>
              Suggested: “{suggested}”{' '}
              <button
                type="button"
                className="editor-link-button"
                onClick={() => {
                  setPrompt(suggested);
                  setPromptTouched(false);
                }}
              >
                Use it
              </button>
            </>
          ) : (
            'What the learner is asked. Written for you; change it if you like.'
          )}
        </p>
      </div>

      {kind === 'assemble' ? (
        <p className="editor-muted editor-no-choices">
          Build the sentence has no wrong choices: the learner puts the words of
          the answer in order.
        </p>
      ) : (
        <fieldset
          className="editor-fieldset"
          aria-describedby={
            choicesError ? `${choicesHintId} ${choicesErrorId}` : choicesHintId
          }
          aria-invalid={choicesError ? true : undefined}
        >
          <legend className="console-label">Wrong choices</legend>
          <p id={choicesHintId} className="console-hint">
            {kind === 'match'
              ? 'The phrases matched alongside the answer.'
              : 'Other phrases from this lesson, shown next to the answer.'}{' '}
            {chosen.length} chosen.
          </p>
          {choices.length > 0 && (
            <ul className="editor-choices">
              {choices.map((choice) => {
                const blocked = choice.blocked !== null;
                return (
                  <li key={blocked ? `${choice.id}-blocked` : choice.id}>
                    <label
                      className={`editor-choice${blocked ? ' editor-choice-blocked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        name="options"
                        value={choice.id}
                        checked={!blocked && chosen.includes(choice.id)}
                        disabled={blocked}
                        onChange={(event) => {
                          setChoicesTouched(true);
                          setOptions((current) =>
                            event.target.checked
                              ? [...current, choice.id]
                              : current.filter((id) => id !== choice.id),
                          );
                        }}
                      />
                      <span className="editor-choice-text">
                        <NativeText
                          text={choice.native}
                          lang={language.code}
                          dir={language.direction}
                        />
                        <span className="editor-choice-meaning">
                          {choice.meaning}
                          {blocked && ` · ${choice.blocked}`}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p
            id={choicesErrorId}
            className="editor-field-error"
            aria-live="polite"
          >
            {choicesError}
          </p>
        </fieldset>
      )}

      <div className="console-field editor-narrow-field">
        <label htmlFor={difficultyId} className="console-label">
          Difficulty <span className="editor-optional">(optional)</span>
        </label>
        <select
          id={difficultyId}
          name="difficulty"
          className="console-input"
          defaultValue={echo(values, 'difficulty', exercise?.difficulty)}
        >
          <option value="">Not set</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <ActionNotice result={result} />
      <div className="console-actions">
        <SubmitButton
          pendingLabel={pendingLabel}
          disabled={choicesError !== null}
          aria-describedby={choicesError ? choicesErrorId : undefined}
        >
          {submitLabel}
        </SubmitButton>
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

/** One exercise: its kind, prompt, answer and choices, and its tools. */
function ExerciseCard({
  exercise,
  ids,
  items,
  lessonId,
  language,
  locked,
  onRetired,
}: {
  exercise: EditExercise;
  ids: string[];
  items: EditItem[];
  lessonId: string;
  language: EditorLanguage;
  locked: boolean;
  onRetired: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftKind, setDraftKind] = useState<ExerciseKind>(exercise.kind);
  const { containerRef, triggerRef } = useEditFocus(editing);
  const [saved, setSaved] = useState(false);
  const [result, formAction] = useActionState(
    async (previous: ExerciseResult | null, formData: FormData) => {
      const next = await updateExercise(previous, formData);
      if (next.ok) {
        setEditing(false);
        setSaved(true);
      }
      return next;
    },
    null,
  );
  const find = itemById(items);
  const answer = find(exercise.answer_item_id);
  const label = `${EXERCISE_KIND_LABELS[exercise.kind].toLowerCase()} exercise for “${answer?.meaning ?? exercise.prompt}”`;
  return (
    <li
      ref={containerRef}
      id={`exercise-${exercise.id}`}
      className="editor-card"
    >
      <div className="editor-card-head">
        <span className="editor-card-number" aria-hidden="true">
          {exercise.position}
        </span>
        <span className="editor-kind">
          {EXERCISE_KIND_LABELS[editing ? draftKind : exercise.kind]}
        </span>
        {!locked && !editing && (
          <div className="editor-card-tools">
            <button
              ref={triggerRef}
              type="button"
              data-card-edit
              className="console-button console-button-outline editor-small-button"
              onClick={() => {
                setSaved(false);
                setDraftKind(exercise.kind);
                setEditing(true);
              }}
              aria-label={`Edit ${label}`}
            >
              Edit
            </button>
            <ReorderButtons
              parentType="lesson"
              parentId={lessonId}
              ids={ids}
              id={exercise.id}
              label={label}
            />
            <RetireButton
              type="exercise"
              id={exercise.id}
              lessonId={lessonId}
              what={label}
              onRetired={onRetired}
            />
          </div>
        )}
      </div>
      {editing ? (
        <ExerciseForm
          lessonId={lessonId}
          exercise={exercise}
          items={items}
          language={language}
          action={formAction}
          result={result}
          submitLabel="Save exercise"
          pendingLabel="Saving…"
          onCancel={() => setEditing(false)}
          onKindChange={setDraftKind}
        />
      ) : (
        <div className="editor-exercise">
          <p className="editor-exercise-prompt">{exercise.prompt}</p>
          <p className="editor-exercise-line">
            <span className="editor-exercise-key">Answer</span>
            {answer ? (
              <>
                <NativeText
                  text={answer.native}
                  lang={language.code}
                  dir={language.direction}
                />
                <span className="editor-muted">{answer.meaning}</span>
              </>
            ) : (
              <span className="editor-muted">A retired phrase</span>
            )}
          </p>
          {exercise.options.length > 0 && (
            <div className="editor-exercise-line">
              <span className="editor-exercise-key">Choices</span>
              <ul className="editor-chips">
                {exercise.options.map((id) => {
                  const option = find(id);
                  return (
                    <li key={id} className="editor-chip">
                      {option ? (
                        <>
                          <NativeText
                            text={option.native}
                            lang={language.code}
                            dir={language.direction}
                          />
                          <span className="editor-muted">{option.meaning}</span>
                        </>
                      ) : (
                        'A retired phrase'
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="editor-result" aria-live="polite">
        {saved && !editing && <p className="editor-saved">Saved.</p>}
      </div>
    </li>
  );
}

/** The lesson’s exercises, in order, and "Add an exercise" at the foot. */
export function ExerciseList({
  lessonId,
  exercises,
  items,
  language,
  locked,
}: {
  lessonId: string;
  exercises: EditExercise[];
  items: EditItem[];
  language: EditorLanguage;
  locked: boolean;
}) {
  const ids = exercises.map((e) => e.id);
  const [adding, setAdding] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const newFormRef = useRefocus(formKey);
  const [added, setAdded] = useState(false);
  const { listRef, announcement, markRetired, clear } =
    useRetiredFocus(exercises);
  const [result, formAction] = useActionState(
    async (
      previous: Awaited<ReturnType<typeof createExercise>> | null,
      formData: FormData,
    ) => {
      const next = await createExercise(previous, formData);
      if (next.ok) {
        setAdded(true);
        setAdding(false);
        setFormKey((k) => k + 1);
      }
      return next;
    },
    null,
  );
  return (
    <div ref={listRef} className="editor-exercises">
      {exercises.length === 0 ? (
        !locked && (
          <EmptyState title="No exercises yet">
            <p>
              Generate them from the phrases above, or add them one by one. A
              lesson needs at least 6 before review.
            </p>
          </EmptyState>
        )
      ) : (
        <ol className="editor-cards">
          {exercises.map((exercise, index) => (
            <ExerciseCard
              key={exercise.id}
              exercise={exercise}
              ids={ids}
              items={items}
              lessonId={lessonId}
              language={language}
              locked={locked}
              onRetired={() => {
                setAdded(false);
                markRetired(
                  exercise.id,
                  index,
                  `Exercise ${exercise.position} retired.`,
                );
              }}
            />
          ))}
        </ol>
      )}
      <div className="editor-result" aria-live="polite">
        {announcement && <Notice tone="success">{announcement}</Notice>}
      </div>
      {!locked && items.length > 0 && (
        <>
          <div className="editor-result" aria-live="polite">
            {added && !adding && (
              <p className="editor-saved">Exercise added at the end.</p>
            )}
          </div>
          <Disclosure
            label="Add an exercise"
            open={adding}
            onOpenChange={(open) => {
              setAdding(open);
              setAdded(false);
              clear();
            }}
          >
            <div ref={newFormRef} className="editor-card editor-card-new">
              <p className="editor-form-title">New exercise</p>
              <ExerciseForm
                key={formKey}
                lessonId={lessonId}
                exercise={null}
                items={items}
                language={language}
                action={formAction}
                result={result?.ok ? null : result}
                submitLabel="Add exercise"
                pendingLabel="Adding…"
                onCancel={() => setAdding(false)}
              />
            </div>
          </Disclosure>
        </>
      )}
    </div>
  );
}
