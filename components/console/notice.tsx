import type { ReactNode } from 'react';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

/**
 * A message in the console. Errors and warnings are announced at once
 * (role="alert"); the rest politely (role="status"). `code` goes in small
 * print, for support.
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
      {code && <small className="console-notice-code">Code: {code}</small>}
    </div>
  );
}
