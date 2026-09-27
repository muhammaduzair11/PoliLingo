'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Notice } from '@/components/console/notice';
import type { ActionResult } from '@/lib/console/action-result';
import { AgeStep } from './sign-in-flow';

/**
 * /account for someone signed in with no profile yet: the email link was
 * opened on another device, or the age answer timed out. The same age
 * question as sign-in comes first. 13 and over saves the band; under 13
 * deletes the new sign-in at once, so nothing is kept, and the action
 * then opens /sign-in/goodbye?reason=age, which says learning works
 * without an account.
 */
export function ProfileSetup({
  declareAgeBand,
  deleteMyAccount,
}: {
  declareAgeBand: (
    previous: ActionResult<unknown> | null,
    formData: FormData,
  ) => Promise<ActionResult<unknown>>;
  deleteMyAccount: (
    previous: ActionResult<null> | null,
    formData: FormData,
  ) => Promise<ActionResult<null>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ code: string; text: string } | null>(
    null,
  );

  return (
    <>
      <AgeStep
        eyebrow="ONE QUICK QUESTION"
        title="One last thing: when were you born?"
        lead="You’re signed in. Accounts are for people 13 and over, so we ask everyone once. We keep only your age band, never your birthday."
        pose="thinking"
        says="Then you’re all set."
        busy={pending}
        onDone={(band) =>
          startTransition(async () => {
            setError(null);
            if (band === 'under-13') {
              const form = new FormData();
              form.set('reason', 'age');
              // On success the action leaves for the goodbye page itself.
              const removed = await deleteMyAccount(null, form);
              if (!removed.ok)
                setError({ code: removed.code, text: removed.message });
              return;
            }
            const form = new FormData();
            form.set('age_band', band);
            const saved = await declareAgeBand(null, form);
            if (saved.ok) router.refresh();
            else setError({ code: saved.code, text: saved.message });
          })
        }
      />
      {error && (
        <div className="account-setup-error">
          <Notice tone="error" code={error.code}>
            {error.text}
          </Notice>
        </div>
      )}
    </>
  );
}
