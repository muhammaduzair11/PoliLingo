import type { ReactNode } from 'react';

/** What a list says when there is nothing in it, and what to do next. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="console-empty">
      <p className="console-empty-title">{title}</p>
      {children && <div className="console-empty-body">{children}</div>}
      {action && <div className="console-actions">{action}</div>}
    </div>
  );
}
