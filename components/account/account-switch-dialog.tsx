'use client';
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
 * until they choose Add. "Not now" (or Escape) pauses saving for this tab
 * and changes nothing on the device. Either way the progress on this device
 * stays exactly where it is.
 */
export function AccountSwitchDialog({
  open,
  email,
  lessons,
  xp,
  streakDays,
  pending,
  error,
  onAdd,
  onNotNow,
}: {
  open: boolean;
  /** The account signed in now. */
  email: string | null;
  /** What this device holds, to say what Add brings along. */
  lessons: number;
  xp: number;
  streakDays: number;
  /** True while the Add sync is on its way. */
  pending: boolean;
  /** A sentence for a failed Add (lib/db-errors.ts), or null. */
  error: string | null;
  onAdd: () => void;
  onNotNow: () => void;
}) {
  const account = email ?? 'this account';
  const facts = [
    lessons > 0 && plural(lessons, 'lesson', 'lessons'),
    xp > 0 && `${xp.toLocaleString('en')} XP`,
    streakDays > 0 && `${streakDays}-day streak`,
  ].filter((fact): fact is string => typeof fact === 'string');
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onNotNow();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">
            Add this device&apos;s progress to {account}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This device last saved progress to a different account. Add it to{' '}
            <strong className="[overflow-wrap:anywhere]">{account}</strong> and
            it&apos;s kept there too. Nothing on this device is removed,
            whichever you choose.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {facts.length > 0 && (
          <ul
            className="flex flex-wrap gap-2 p-0 m-0 list-none"
            aria-label="On this device"
          >
            {facts.map((fact) => (
              <li
                key={fact}
                className="rounded-full bg-secondary text-secondary-foreground px-3 py-1 text-sm font-semibold"
              >
                {fact}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="m-0 text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Not now</AlertDialogCancel>
          <AlertDialogAction
            onClick={onAdd}
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? 'Adding…' : error ? 'Try again' : 'Add'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
