'use client';
import Link from 'next/link';
import { Notice } from '@/components/console/notice';
import { describeDbError } from '@/lib/db-errors';
import { editTreePath } from '@/lib/console/paths';

/**
 * When an editor page fails to render: a plain sentence (never the raw
 * error), a retry, and a way back to the lessons.
 */
export default function EditErrorBoundary({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const { code, message } = describeDbError(error);
  return (
    <section className="console-panel editor-load-error">
      <h1>This page didn&apos;t load</h1>
      <Notice tone="error" code={code}>
        {message}
      </Notice>
      <p className="console-actions">
        <button
          type="button"
          className="console-button console-button-primary"
          onClick={reset}
        >
          Try again
        </button>
        <Link
          className="console-button console-button-outline"
          href={editTreePath()}
        >
          Back to the lessons
        </Link>
      </p>
    </section>
  );
}
