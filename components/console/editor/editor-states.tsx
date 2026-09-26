import Link from 'next/link';
import { Notice } from '@/components/console/notice';
import type { DbError } from '@/lib/db-errors';

/**
 * In place of an editor page whose read was refused or failed: what
 * happened in plain English, with a way back.
 */
export function EditorLoadError({
  error,
  what,
  retryHref,
  backHref,
  backLabel,
}: {
  error: DbError;
  /** "lesson", "lessons" */
  what: string;
  retryHref: string;
  backHref: string;
  backLabel: string;
}) {
  const title =
    error.code === 'PL404_NOT_FOUND'
      ? `We couldn't find that ${what}`
      : error.code === 'PL403_OUTSIDE_LANGUAGE'
        ? `This ${what} is in a language you don't edit`
        : error.code === 'PL403_NOT_EDITOR'
          ? what.endsWith('s')
            ? `The ${what} aren't open to you`
            : `This ${what} isn't open to you`
          : `We couldn't open the ${what}`;
  const retry = ![
    'PL404_NOT_FOUND',
    'PL403_OUTSIDE_LANGUAGE',
    'PL403_NOT_EDITOR',
  ].includes(error.code);
  return (
    <section className="console-panel editor-load-error">
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

/**
 * What an editor page shows while it loads: its shape in soft blocks,
 * announced once. The shimmer stops under both reduced-motion switches.
 */
export function EditorSkeleton({
  label,
  variant,
}: {
  label: string;
  variant: 'tree' | 'lesson';
}) {
  return (
    <div className="editor-skeleton" aria-busy="true">
      <output className="editor-visually-hidden">{label}</output>
      <div aria-hidden="true">
        <div className="editor-skeleton-line editor-skeleton-eyebrow" />
        <div className="editor-skeleton-line editor-skeleton-title" />
        <div className="editor-skeleton-line editor-skeleton-text" />
        {variant === 'tree' ? (
          <>
            <div className="editor-skeleton-block editor-skeleton-stats" />
            <div className="editor-skeleton-block editor-skeleton-tall" />
            <div className="editor-skeleton-block" />
          </>
        ) : (
          <div className="editor-skeleton-split">
            <div>
              <div className="editor-skeleton-block editor-skeleton-tall" />
              <div className="editor-skeleton-block" />
              <div className="editor-skeleton-block" />
            </div>
            <div className="editor-skeleton-block editor-skeleton-tall" />
          </div>
        )}
      </div>
    </div>
  );
}
