import type { ReactNode } from 'react';

export type Column<Row> = {
  /** Unique within the table. */
  key: string;
  /** Plain text: it also labels the cell when the table stacks into cards. */
  header: string;
  cell: (row: Row) => ReactNode;
  /** Right-aligned, for numbers. */
  align?: 'start' | 'end';
  /** Left out of the stacked card layout under 580px. */
  hideOnMobile?: boolean;
};

/**
 * A table of rows that stacks into one card per row under 580px, each cell
 * labelled with its column's header (console.css).
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  caption?: ReactNode;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={columnClass(column)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-label={column.header}
                  className={columnClass(column)}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function columnClass(column: {
  align?: 'start' | 'end';
  hideOnMobile?: boolean;
}): string | undefined {
  const names = [
    column.align === 'end' ? 'data-table-end' : '',
    column.hideOnMobile ? 'data-table-optional' : '',
  ].filter(Boolean);
  return names.length ? names.join(' ') : undefined;
}
