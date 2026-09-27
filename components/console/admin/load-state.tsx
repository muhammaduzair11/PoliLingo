import Link from 'next/link';
import type { DbError } from '@/lib/db-errors';
import { Notice } from '../notice';

/** A page's data could not be loaded: what happened, and how to try again. */
export function LoadError({
  error,
  retryHref,
  what,
}: {
  error: DbError;
  retryHref: string;
  /** "the overview", "the team" */
  what: string;
}) {
  return (
    <div className="admin-load-error">
      <Notice tone="error" title={`We couldn't load ${what}`} code={error.code}>
        <p>{error.message}</p>
      </Notice>
      <p className="console-actions">
        <Link
          className="console-button console-button-outline"
          href={retryHref}
        >
          Try again
        </Link>
      </p>
    </div>
  );
}

/**
 * Grey placeholders in the shape of the page while its data loads.
 * Announced once to screen readers; still under reduced motion.
 */
export function AdminSkeleton({
  label,
  variant,
}: {
  label: string;
  variant: 'overview' | 'people' | 'invite';
}) {
  return (
    <div
      className={`admin-skeleton admin-skeleton-${variant}`}
      aria-busy="true"
    >
      <output className="admin-visually-hidden">{label}</output>
      {variant === 'overview' && (
        <>
          <span className="admin-skeleton-block admin-skeleton-strip" />
          <span className="admin-skeleton-row">
            <span className="admin-skeleton-block admin-skeleton-stat" />
            <span className="admin-skeleton-block admin-skeleton-stat" />
            <span className="admin-skeleton-block admin-skeleton-stat" />
            <span className="admin-skeleton-block admin-skeleton-stat" />
          </span>
          <span className="admin-skeleton-row">
            <span className="admin-skeleton-block admin-skeleton-card" />
            <span className="admin-skeleton-block admin-skeleton-card" />
          </span>
        </>
      )}
      {variant === 'people' && (
        <>
          <span className="admin-skeleton-row">
            <span className="admin-skeleton-block admin-skeleton-stat" />
            <span className="admin-skeleton-block admin-skeleton-stat" />
            <span className="admin-skeleton-block admin-skeleton-stat" />
          </span>
          <span className="admin-skeleton-block admin-skeleton-table" />
          <span className="admin-skeleton-block admin-skeleton-strip" />
        </>
      )}
      {variant === 'invite' && (
        <span className="admin-skeleton-block admin-skeleton-invite" />
      )}
    </div>
  );
}
