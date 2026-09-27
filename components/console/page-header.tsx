import type { ReactNode } from 'react';

/** A console page's title, a line about it, and its main actions. */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="console-page-header">
      <div className="console-page-heading">
        {eyebrow && <p className="console-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && (
          <p className="console-page-description">{description}</p>
        )}
      </div>
      {actions && <div className="console-actions">{actions}</div>}
    </header>
  );
}
