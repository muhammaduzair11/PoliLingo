'use client';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/lib/console/action-result';

/**
 * Signs out on this device through a server action, then does a full
 * navigation home, so the learner app boots again without the session.
 * Local progress is never touched.
 */
export function SignOutButton({
  action,
}: {
  action: () => Promise<ActionResult<null>>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="console-menu-item"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await action();
            if (result.ok) window.location.assign('/');
            else setError(result.message);
          })
        }
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && (
        <p role="alert" className="console-menu-error">
          {error}
        </p>
      )}
    </>
  );
}
