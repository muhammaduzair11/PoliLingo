'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import type { ActionResult } from '@/lib/console/action-result';
import { consoleHomeFor, inviteRefusal } from '@/lib/console/invite-link';
import { Notice } from '../notice';
import { SubmitButton } from '../submit-button';

type Action<T> = (
  previous: ActionResult<T> | null,
  formData: FormData,
) => Promise<ActionResult<T>>;

/**
 * The Accept button. On success the server action opens the workspace; a
 * refusal shows what happened and what to do next, in plain English.
 */
export function AcceptInvitation({
  action,
  token,
  role,
}: {
  action: Action<unknown>;
  token: string;
  role: string;
}) {
  const [result, formAction] = useActionState(action, null);
  const refusal = result && !result.ok ? inviteRefusal(result.code) : null;
  return (
    <form action={formAction} className="invite-accept">
      <input type="hidden" name="token" value={token} />
      {result && !result.ok && (
        <Notice
          tone={result.code === 'PL409_ALREADY_HAS_ROLE' ? 'info' : 'error'}
          title={refusal?.title}
          code={result.code}
        >
          <p>{refusal ? refusal.message : result.message}</p>
          {refusal && <p>{refusal.next}</p>}
        </Notice>
      )}
      <div className="console-actions">
        {result && !result.ok && result.code === 'PL409_ALREADY_HAS_ROLE' ? (
          <Link
            className="console-button console-button-primary invite-accept-button"
            href={consoleHomeFor(role)}
          >
            Open the workspace
          </Link>
        ) : (
          <SubmitButton
            className="invite-accept-button"
            pendingLabel="Joining the team…"
          >
            Accept invitation
          </SubmitButton>
        )}
      </div>
    </form>
  );
}

/** Signs out here and goes to sign-in, which returns to this invitation. */
export function SwitchAccount({
  action,
  token,
  label = 'Sign in with a different account',
}: {
  action: Action<{ next: string }>;
  token: string;
  label?: string;
}) {
  const [result, formAction] = useActionState(
    async (
      previous: ActionResult<{ next: string }> | null,
      formData: FormData,
    ) => {
      const next = await action(previous, formData);
      if (next.ok) window.location.assign(next.data.next);
      return next;
    },
    null,
  );
  return (
    <form action={formAction} className="invite-accept">
      <input type="hidden" name="token" value={token} />
      {result && !result.ok && (
        <Notice tone="error" code={result.code}>
          {result.message}
        </Notice>
      )}
      <div className="console-actions">
        <SubmitButton pendingLabel="Signing out…">{label}</SubmitButton>
      </div>
    </form>
  );
}
