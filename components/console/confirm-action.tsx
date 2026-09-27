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
  onSuccess?: (data: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [result, formAction] = useActionState(
    async (previous: ActionResult<T> | null, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.ok) {
        setOpen(false);
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
        <AlertDialogContent className="console-dialog">
          <form action={formAction} className="console-dialog-form">
            <AlertDialogHeader>
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
            <AlertDialogFooter>
              <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
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
