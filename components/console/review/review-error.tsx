'use client';
import Link from 'next/link';
import { Notice } from '@/components/console/notice';

/**
 * The error boundary's view for the review screens: something failed that
 * was not a refusal. Nothing raw is shown; the digest, when there is one,
 * goes in small print for support.
 */
export function ReviewError({
  error,
  retry,
  backHref,
  backLabel,
}: {
  error: unknown;
  retry: () => void;
  backHref: string;
  backLabel: string;
}) {
  const raw =
    typeof error === 'object' && error !== null && 'digest' in error
      ? (error as { digest?: unknown }).digest
      : null;
  const digest = typeof raw === 'string' ? raw : '';
  return (
    <section className="console-panel review-load-error">
      <h1>This page didn&apos;t load</h1>
      <Notice tone="error" code={digest || null}>
        Something went wrong on our side. Nothing was changed.
      </Notice>
      <p className="console-actions">
        <button
          type="button"
          className="console-button console-button-primary"
          onClick={retry}
        >
          Try again
        </button>
        <Link className="console-button console-button-outline" href={backHref}>
          {backLabel}
        </Link>
      </p>
    </section>
  );
}
