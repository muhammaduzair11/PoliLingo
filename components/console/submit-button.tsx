'use client';
import type { ComponentProps, ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export type ButtonTone = 'primary' | 'outline' | 'danger' | 'quiet';

/**
 * A form's submit button that shows it is working and cannot be pressed
 * twice while the server action runs.
 */
export function SubmitButton({
  children,
  pendingLabel = 'Working…',
  tone = 'primary',
  className,
  disabled,
  ...rest
}: Omit<ComponentProps<'button'>, 'type'> & {
  pendingLabel?: ReactNode;
  tone?: ButtonTone;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      {...rest}
      type="submit"
      className={`console-button console-button-${tone}${className ? ` ${className}` : ''}`}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
