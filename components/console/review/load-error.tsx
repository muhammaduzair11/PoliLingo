import Link from 'next/link';
import { Notice } from '@/components/console/notice';
import type { DbError } from '@/lib/db-errors';

/**
 * In place of a review page whose read was refused or failed: what
 * happened in plain English, with a way back. A phrase in someone else's
 * variety gets its own title; the database's sentence already names who
 * can review it.
 */
export function LoadError({
  error,
  what,
  retryHref,
  backHref,
  backLabel,
}: {
  error: DbError;
  /** "phrase", "lesson", "queue", "suggestions" */
  what: string;
  retryHref: string;
  backHref: string;
  backLabel: string;
}) {
  const title =
    error.code === 'PL403_OUTSIDE_VARIETY'
      ? `This ${what} is for another variety`
      : error.code === 'PL404_NOT_FOUND'
        ? `We couldn't find that ${what}`
        : error.code === 'PL403_NOT_REVIEWER' ||
            error.code === 'PL403_NOT_EDITOR'
          ? `This ${what} isn't open to you`
          : `We couldn't open this ${what}`;
  const retry = !['PL403_OUTSIDE_VARIETY', 'PL404_NOT_FOUND'].includes(
    error.code,
  );
  return (
    <section className="console-panel review-load-error">
      <h1>{title}</h1>
      <Notice
        tone={error.code === 'PL404_NOT_FOUND' ? 'info' : 'error'}
        code={error.code}
      >
        {error.message}
      </Notice>
      <p className="console-actions">
        {retry && (
          <a className="console-button console-button-primary" href={retryHref}>
            Try again
          </a>
        )}
        <Link
          className={`console-button console-button-${retry ? 'outline' : 'primary'}`}
          href={backHref}
        >
          {backLabel}
        </Link>
      </p>
    </section>
  );
}
