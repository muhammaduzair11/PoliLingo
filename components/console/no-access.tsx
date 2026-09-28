import Link from 'next/link';
import type { ReactNode } from 'react';
import type { DbError } from '@/lib/db-errors';
import { Notice } from './notice';

/**
 * In place of a page the caller's roles do not cover. It is cosmetic: the
 * database refuses the reads and writes anyway.
 *
 * A team member gets `body` (whose page this is, where their own work is)
 * and `home`, the way to it. An account with no role gets the invitation
 * copy.
 */
export function NoAccess({
  title = 'This part of the workspace isn’t open to you',
  reason,
  body,
  home,
  children,
}: {
  title?: string;
  /** Why the check could not be made, when it failed rather than said no. */
  reason?: DbError;
  /** One sentence for a team member: what they do, and where. */
  body?: ReactNode;
  /** Their own part of the workspace, as the main button. */
  home?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <section className="console-panel console-no-access">
      <h1>{title}</h1>
      {reason ? (
        <Notice tone="error" code={reason.code}>
          {reason.message}
        </Notice>
      ) : body ? (
        <p>{body}</p>
      ) : (
        (children ?? (
          <p>
            Your account doesn’t have a role here. If you were invited, open the
            invitation link again while signed in with the email it was sent to.
          </p>
        ))
      )}
      <p className="console-actions">
        {home && (
          <Link
            className="console-button console-button-primary"
            href={home.href}
          >
            {home.label}
          </Link>
        )}
        <Link className="console-button console-button-outline" href="/account">
          Your account
        </Link>
        {!home && (
          <Link className="console-button console-button-quiet" href="/learn">
            Back to learning
          </Link>
        )}
      </p>
    </section>
  );
}
