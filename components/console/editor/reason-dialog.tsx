'use client';
import { useActionState, useId, useRef, useState, type ReactNode } from 'react';
import { Notice } from '@/components/console/notice';
import {
  SubmitButton,
  type ButtonTone,
} from '@/components/console/submit-button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { retireContent, setPublishGate } from '@/app/(console)/edit/actions';
import {
  EXERCISE_KIND_LABELS,
  type EditExercise,
  type EditorResult,
  type Gate,
} from '@/lib/console/editor';

/**
 * A confirm dialog with a "why?" box, for the changes the history keeps a
 * reason for: it closes when the change is made, and stays open with the
 * refusal in plain words otherwise. The box is controlled, so a refusal
 * does not wipe what was typed. It is the kit's ConfirmAction with one
 * difference: the trigger can carry an aria-label, so a short visible word
 * ("Retire") is read with what it acts on ("Retire phrase 3") without
 * hidden text inside the button.
 */
function ReasonDialog({
  action,
  fields,
  triggerLabel,
  triggerAriaLabel,
  triggerTone = 'quiet',
  title,
  description,
  confirmLabel,
  pendingLabel,
  tone,
  onSuccess,
}: {
  action: typeof retireContent;
  fields: Record<string, string>;
  triggerLabel: ReactNode;
  /** Starts with the visible words, so speech input finds it by them. */
  triggerAriaLabel?: string;
  triggerTone?: ButtonTone;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: ReactNode;
  pendingLabel: ReactNode;
  tone: 'primary' | 'danger';
  onSuccess?: () => void;
}) {
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [result, formAction] = useActionState(
    async (previous: EditorResult<unknown> | null, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.ok) {
        setOpen(false);
        setReason('');
        onSuccess?.();
      }
      return next;
    },
    null,
  );
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        className={`console-button console-button-${triggerTone}`}
        aria-label={triggerAriaLabel}
      >
        {triggerLabel}
      </AlertDialogTrigger>
      <AlertDialogContent className="console-dialog">
        <form action={formAction} className="console-dialog-form">
          <AlertDialogHeader className="console-dialog-header">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div className="console-dialog-fields">
            <div className="console-field">
              <label htmlFor={reasonId} className="console-label">
                Why? A short note for the history
              </label>
              <textarea
                id={reasonId}
                name="reason"
                className="console-input"
                rows={2}
                maxLength={500}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </div>
          {result && !result.ok && (
            <Notice tone="error" code={result.code}>
              {result.message}
            </Notice>
          )}
          <AlertDialogFooter className="console-dialog-footer">
            <AlertDialogCancel className="console-button console-button-outline">
              Cancel
            </AlertDialogCancel>
            <SubmitButton
              tone={tone === 'danger' ? 'danger' : 'primary'}
              pendingLabel={pendingLabel}
            >
              {confirmLabel}
            </SubmitButton>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Retire, after a confirm dialog that asks why. Nothing is deleted: the
 * database keeps the history. A calm red text button, so it never reads
 * as the card’s main action.
 */
export function RetireButton({
  type,
  id,
  lessonId,
  what,
  description,
  triggerLabel,
  onRetired,
}: {
  type: 'unit' | 'lesson' | 'item' | 'exercise';
  id: string;
  /** The lesson page to refresh, when the target belongs to one. */
  lessonId?: string;
  /** "this phrase", "Unit 2" */
  what: string;
  description?: ReactNode;
  triggerLabel?: ReactNode;
  /** After it is retired: the list moves focus on and says so. */
  onRetired?: () => void;
}) {
  const fields: Record<string, string> = { type, id };
  if (lessonId) fields.lesson_id = lessonId;
  return (
    <span className="editor-retire">
      <ReasonDialog
        action={retireContent}
        fields={fields}
        triggerLabel={triggerLabel ?? 'Retire'}
        triggerAriaLabel={triggerLabel ? undefined : `Retire ${what}`}
        title={`Retire ${what}?`}
        description={
          description ??
          'It leaves the lesson for good. Nothing is deleted: its history stays.'
        }
        confirmLabel="Retire"
        pendingLabel="Retiring…"
        tone="danger"
        onSuccess={onRetired}
      />
    </span>
  );
}

/**
 * Retire for a phrase that exercises still use: the database would refuse
 * it, so instead of a reason box and a red button that can only fail, it
 * says why and links to each exercise. "Show me" closes the dialog, then
 * goes to the exercise and puts focus on its Edit button.
 */
export function RetireBlocked({
  what,
  exercises,
  itemId,
}: {
  /** "phrase 3" */
  what: string;
  exercises: Pick<
    EditExercise,
    'id' | 'position' | 'kind' | 'answer_item_id'
  >[];
  itemId: string;
}) {
  const [open, setOpen] = useState(false);
  const target = useRef<string | null>(null);
  const n = exercises.length;
  return (
    <span className="editor-retire">
      <AlertDialog
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(isOpen) => {
          const id = target.current;
          if (isOpen || !id) return;
          // Once the dialog has let go of the page’s scroll: go there, so
          // the card is :target (highlighted), then focus its Edit button
          // (after the dialog’s own focus handling, which is told to stay
          // out of it while `target` is set).
          window.location.hash = `exercise-${id}`;
          window.setTimeout(() => {
            document
              .querySelector<HTMLElement>(`#exercise-${id} [data-card-edit]`)
              ?.focus({ preventScroll: true });
            target.current = null;
          }, 50);
        }}
      >
        <AlertDialogTrigger
          className="console-button console-button-quiet"
          aria-label={`Retire ${what}`}
        >
          Retire
        </AlertDialogTrigger>
        <AlertDialogContent
          className="console-dialog editor-in-use-dialog"
          finalFocus={() => target.current === null}
        >
          <AlertDialogHeader className="console-dialog-header">
            <AlertDialogTitle>
              {what.charAt(0).toUpperCase() + what.slice(1)} is still in use
            </AlertDialogTitle>
            <AlertDialogDescription>
              This phrase is used by {n} {n === 1 ? 'exercise' : 'exercises'}.
              Change or retire {n === 1 ? 'it' : 'them'} first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="editor-in-use">
            {exercises.map((exercise) => (
              <li key={exercise.id}>
                <span className="editor-in-use-what">
                  <strong>Exercise {exercise.position}</strong>{' '}
                  <span className="editor-kind">
                    {EXERCISE_KIND_LABELS[exercise.kind]}
                  </span>{' '}
                  <span className="editor-muted">
                    {exercise.answer_item_id === itemId
                      ? 'its answer'
                      : 'a wrong choice'}
                  </span>
                </span>
                <a
                  href={`#exercise-${exercise.id}`}
                  className="editor-problem-link"
                  aria-label={`Show me exercise ${exercise.position}`}
                  onClick={(event) => {
                    event.preventDefault();
                    target.current = exercise.id;
                    setOpen(false);
                  }}
                >
                  Show me
                </a>
              </li>
            ))}
          </ul>
          <AlertDialogFooter className="console-dialog-footer">
            <AlertDialogCancel className="console-button console-button-outline">
              Close
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}

/**
 * Admin only: open something to learners, or hold it back. Opening a
 * variety needs an active reviewer for it; the database refuses otherwise.
 */
export function GateControl({
  type,
  id,
  gate,
  name,
  lessonId,
}: {
  type: 'variety' | 'unit' | 'lesson';
  id: string;
  gate: Gate;
  /** "Unit 2", "Yusufzai" */
  name: string;
  lessonId?: string;
}) {
  const opening = gate === 'blocked';
  const fields: Record<string, string> = {
    type,
    id,
    gate: opening ? 'open' : 'blocked',
  };
  if (lessonId) fields.lesson_id = lessonId;
  return (
    <ReasonDialog
      action={setPublishGate}
      fields={fields}
      triggerLabel={opening ? 'Open to learners' : 'Hold back'}
      triggerAriaLabel={
        opening ? `Open to learners: ${name}` : `Hold back ${name}`
      }
      title={opening ? `Open ${name} to learners?` : `Hold back ${name}?`}
      description={
        opening
          ? 'Its reviewed lessons go out with the next release. Anything not reviewed yet stays out.'
          : 'It stays out of the next release, and anything of it that is live now leaves learners then.'
      }
      confirmLabel={opening ? 'Open to learners' : 'Hold back'}
      pendingLabel="Saving…"
      tone="primary"
    />
  );
}
