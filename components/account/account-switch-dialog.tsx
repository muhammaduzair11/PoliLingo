'use client';
import { useEffect, useRef } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/**
 * Asked when someone signs in on a device that last saved its progress to a
 * different account (lib/sync.ts accountChoice() === 'ask'). Nothing is sent
 * until they choose "Add to my account". "Not now" (or Escape) pauses saving for this tab
 * and changes nothing on the device. Either way the progress on this device
 * stays exactly where it is.
 *
 * Once Add has landed the dialog stays open on its done state ("Saved to
 * <email>", with what the account now holds) until the learner closes it
 * with Done or Escape, so the success is seen, not just announced.
 */
export function AccountSwitchDialog({
  open,
  email,
  lessons,
  xp,
  streakDays,
  pending,
  done,
  error,
  onAdd,
  onNotNow,
  onDone,
}: {
  open: boolean;
  /** The account signed in now. */
  email: string | null;
  /** What this device holds, to say what Add brings along (after Add: the merged total). */
  lessons: number;
  xp: number;
  streakDays: number;
  /** True while the Add sync is on its way. */
  pending: boolean;
  /** True once Add has saved this device's progress to the account. */
  done: boolean;
  /** A sentence for a failed Add (lib/db-errors.ts), or null. */
  error: string | null;
  onAdd: () => void;
  onNotNow: () => void;
  /** Closes the done state. */
  onDone: () => void;
}) {
  const account = email ?? 'this account';
  const facts = [
    lessons > 0 && plural(lessons, 'lesson', 'lessons'),
    xp > 0 && `${xp.toLocaleString('en')} XP`,
    streakDays > 0 && `${streakDays}-day streak`,
  ].filter((fact): fact is string => typeof fact === 'string');

  // The Add button becomes Done in place; keep the keyboard on it.
  const actionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (done) actionRef.current?.focus();
  }, [done]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (next || pending) return;
        if (done) onDone();
        else onNotNow();
      }}
    >
      <AlertDialogContent className="account-switch">
        <AlertDialogHeader className="account-switch-header">
          <AlertDialogTitle className="account-switch-title">
            {done ? (
              <>
                <span aria-hidden="true" className="account-switch-check">
                  ✓{' '}
                </span>
                Saved to {account}
              </>
            ) : (
              <>Add this device’s progress to {account}?</>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription className="account-switch-text">
            {done ? (
              <>
                This device’s progress is in your account now, and it keeps
                saving as you learn. Nothing on this device was removed.
              </>
            ) : (
              <>
                This device last saved progress to a different account. Add it
                to <strong className="account-switch-email">{account}</strong>{' '}
                and it’s kept there too. Nothing on this device is removed,
                whichever you choose.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {facts.length > 0 && (
          <ul
            className="account-switch-facts"
            aria-label={done ? 'In your account' : 'On this device'}
          >
            {facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        )}
        {error && !done && (
          <p role="alert" className="account-switch-error">
            {error}
          </p>
        )}
        <AlertDialogFooter className="account-switch-footer">
          {!done && (
            <AlertDialogCancel
              className="account-switch-later"
              disabled={pending}
            >
              Not now
            </AlertDialogCancel>
          )}
          <AlertDialogAction
            ref={actionRef}
            className="account-switch-add"
            onClick={done ? onDone : onAdd}
            disabled={pending}
            focusableWhenDisabled
            aria-busy={pending || undefined}
          >
            {done
              ? 'Done'
              : pending
                ? 'Adding…'
                : error
                  ? 'Try again'
                  : 'Add to my account'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
