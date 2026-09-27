'use client';
import { useActionState, useState, type ReactNode } from 'react';
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
import type { ActionResult } from '@/lib/console/action-result';
import { useAnnounce, useKeepFocus } from './announcer';
import { Notice } from './notice';
import { SubmitButton, type ButtonTone } from './submit-button';

/**
 * A button that asks first, then runs a server action and shows what came
 * back: on success the dialog closes (and `successMessage` shows beside the
 * button); on a refusal the dialog stays open with the mapped sentence and
 * its code.
 *
 * `fields` become hidden inputs; `children` are extra inputs inside the
 * dialog, such as a reason. `action` must be a server action (a
 * 'use server' function) returning ActionResult.
 *
 * `announce` says the outcome in the console's live region at the top of
 * the page, which outlives a trigger the action removes; `focusAfter` is
 * the id of what takes focus then (a section heading), if focus was lost.
 *
 * The dialog wears the console's own buttons, left-aligned text at every
 * width, and for a danger action the safe choice first on phones.
 */
export function ConfirmAction<T>({
  action,
  triggerLabel,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  pendingLabel = 'Working…',
  tone = 'primary',
  triggerTone = 'outline',
  fields,
  children,
  successMessage,
  announce,
  focusAfter,
  onSuccess,
}: {
  action: (
    previous: ActionResult<T> | null,
    formData: FormData,
  ) => Promise<ActionResult<T>>;
  triggerLabel: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  pendingLabel?: ReactNode;
  tone?: 'primary' | 'danger';
  triggerTone?: ButtonTone;
  fields?: Record<string, string>;
  children?: ReactNode;
  successMessage?: ReactNode;
  /** Said in the page's live region on success. */
  announce?: ReactNode | ((data: T) => ReactNode);
  /** The id of the element to focus on success when focus was lost. */
  focusAfter?: string;
  onSuccess?: (data: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const say = useAnnounce();
  const keepFocus = useKeepFocus();
  const [result, formAction] = useActionState(
    async (previous: ActionResult<T> | null, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.ok) {
        setOpen(false);
        if (announce)
          say(typeof announce === 'function' ? announce(next.data) : announce);
        keepFocus(focusAfter);
        onSuccess?.(next.data);
      }
      return next;
    },
    null,
  );
  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          className={`console-button console-button-${triggerTone}`}
        >
          {triggerLabel}
        </AlertDialogTrigger>
        <AlertDialogContent
          className={`console-dialog${tone === 'danger' ? ' console-dialog-danger' : ''}`}
        >
          <form action={formAction} className="console-dialog-form">
            <AlertDialogHeader className="console-dialog-header">
              <AlertDialogTitle>{title}</AlertDialogTitle>
              {description && (
                <AlertDialogDescription>{description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            {fields &&
              Object.entries(fields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
            {children && (
              <div className="console-dialog-fields">{children}</div>
            )}
            {result && !result.ok && (
              <Notice tone="error" code={result.code}>
                {result.message}
              </Notice>
            )}
            <AlertDialogFooter className="console-dialog-footer">
              <AlertDialogCancel className="console-button console-button-outline">
                {cancelLabel}
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
      {result?.ok && successMessage && (
        <Notice tone="success">{successMessage}</Notice>
      )}
    </>
  );
}
