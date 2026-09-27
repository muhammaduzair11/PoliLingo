'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ArrowRight } from 'lucide-react';
import { Notice } from '@/components/console/notice';
import type { ActionResult } from '@/lib/console/action-result';
import { setAccount } from '@/lib/account-store';
import { AgeStep, Card } from './sign-in-flow';

/**
 * /account for someone signed in with no profile yet: the email link was
 * opened on another device, or the age answer timed out. The same age
 * question as sign-in comes first. 13 and over saves the band; under 13
 * deletes the new sign-in at once, so nothing is kept, and says learning
 * works without an account.
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
  const [under13, setUnder13] = useState(false);
  const [error, setError] = useState<{ code: string; text: string } | null>(
    null,
  );

  if (under13)
    return (
      <Card>
        <h1 className="signin-title" tabIndex={-1} ref={(n) => n?.focus()}>
          You can keep learning without an account
        </h1>
        {/* A full page load, so the removed session is gone from memory too. */}
        <button
          type="button"
          className="button button-purple full-width"
          onClick={() => window.location.assign('/learn')}
        >
          Back to learning <ArrowRight size={19} />
        </button>
      </Card>
    );

  return (
    <>
      <AgeStep
        back={null}
        eyebrow="ONE QUICK QUESTION"
        busy={pending}
        onDone={(band) =>
          startTransition(async () => {
            setError(null);
            if (band === 'under-13') {
              const removed = await deleteMyAccount(null, new FormData());
              if (!removed.ok) {
                setError({ code: removed.code, text: removed.message });
                return;
              }
              setAccount({ status: 'anonymous' });
              setUnder13(true);
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
