import Link from 'next/link';
import type { ReactNode } from 'react';
import type { DbError } from '@/lib/db-errors';
import { Notice } from './notice';

/**
 * In place of a page the caller's roles do not cover. It is cosmetic: the
 * database refuses the reads and writes anyway.
 */
export function NoAccess({
  title = "This part of the workspace isn't open to you",
  reason,
  children,
}: {
  title?: string;
  /** Why the check could not be made, when it failed rather than said no. */
  reason?: DbError;
  children?: ReactNode;
}) {
  return (
    <section className="console-panel console-no-access">
      <h1>{title}</h1>
      {reason ? (
        <Notice tone="error" code={reason.code}>
          {reason.message}
        </Notice>
      ) : (
        (children ?? (
          <p>
            Your account doesn&apos;t have a role here. If you were invited,
            open the invitation link again while signed in with the email it was
            sent to.
          </p>
        ))
      )}
      <p className="console-actions">
        <Link className="console-button console-button-outline" href="/account">
          Your account
        </Link>
        <Link className="console-button console-button-quiet" href="/learn">
          Back to learning
        </Link>
      </p>
    </section>
  );
}
