import type { ReactNode } from 'react';

/** One number with its label, for overview grids. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="console-stat">
      <p className="console-stat-label">{label}</p>
      <p className="console-stat-value">{value}</p>
      {hint && <p className="console-stat-hint">{hint}</p>}
    </div>
  );
}

/** A responsive grid of Stat tiles. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="console-stat-grid">{children}</div>;
}
