import type { ReactNode } from 'react';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

/**
 * A message in the console. Errors and warnings are announced at once
 * (role="alert"); the rest politely (role="status"). `code` is for support
 * only: it waits, folded, under "Details for support", so nobody has to
 * read a raw error code to understand what happened.
 */
export function Notice({
  tone = 'info',
  title,
  code,
  children,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  code?: string | null;
  children?: ReactNode;
}) {
  const urgent = tone === 'error' || tone === 'warning';
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={`console-notice console-notice-${tone}`}
    >
      {title && <p className="console-notice-title">{title}</p>}
      {children && <div className="console-notice-body">{children}</div>}
      {code && <SupportDetails code={code} />}
    </div>
  );
}

/** A support reference, folded away: "Details for support" opens it. */
export function SupportDetails({ code }: { code: string }) {
  return (
    <details className="console-support">
      <summary>Details for support</summary>
      <p>
        Reference <code>{code}</code>
      </p>
    </details>
  );
}
