import {
  OBJECT_TYPE_LABELS,
  REVISION_REASON_LABELS,
  historyRows,
  relativeTime,
  type EditExercise,
  type EditItem,
  type Problem,
  type RevisionEntry,
} from '@/lib/console/editor';

/**
 * What the database says is wrong with the lesson (private.lesson_problems):
 * blocking problems first, then warnings, each linking to the phrase or
 * exercise at fault.
 */
export function ProblemList({ problems }: { problems: Problem[] }) {
  const sorted = [...problems].sort(
    (a, b) =>
      Number(a.severity !== 'blocking') - Number(b.severity !== 'blocking'),
  );
  return (
    <section className="editor-panel" aria-labelledby="problems-heading">
      <h2 id="problems-heading" className="editor-panel-title">
        Checks
      </h2>
      {sorted.length === 0 ? (
        <p className="editor-panel-text">
          Nothing to fix. The database found no problems.
        </p>
      ) : (
        <ul className="editor-problems">
          {sorted.map((problem, i) => {
            const anchor =
              problem.target_type === 'item'
                ? `#item-${problem.target_id}`
                : problem.target_type === 'exercise'
                  ? `#exercise-${problem.target_id}`
                  : null;
            return (
              <li
                key={`${problem.code}-${problem.target_id ?? ''}-${i}`}
                className={`editor-problem editor-problem-${problem.severity}`}
              >
                <span className="editor-problem-severity">
                  {problem.severity === 'blocking' ? 'Fix' : 'Note'}
                </span>
                <span>
                  {problem.message}
                  {anchor && (
                    <>
                      {' '}
                      <a href={anchor} className="editor-problem-link">
                        Show me
                      </a>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The lesson's latest changes, newest first, with who made them. */
export function HistoryList({
  revisions,
  total,
  items,
  exercises,
  now,
}: {
  revisions: RevisionEntry[];
  total: number;
  items: EditItem[];
  exercises: EditExercise[];
  now: Date;
}) {
  const rows = historyRows(revisions);
  const itemPos = new Map(items.map((i) => [i.id, i.position]));
  const exercisePos = new Map(exercises.map((e) => [e.id, e.position]));
  const what = (r: RevisionEntry): string => {
    if (r.object_type === 'item')
      return itemPos.has(r.object_id)
        ? `Phrase ${itemPos.get(r.object_id)}`
        : 'A phrase';
    if (r.object_type === 'exercise')
      return exercisePos.has(r.object_id)
        ? `Exercise ${exercisePos.get(r.object_id)}`
        : 'An exercise';
    return OBJECT_TYPE_LABELS[r.object_type] ?? 'The lesson';
  };
  return (
    <section className="editor-panel" aria-labelledby="history-heading">
      <h2 id="history-heading" className="editor-panel-title">
        Recent changes
      </h2>
      {rows.length === 0 ? (
        <p className="editor-panel-text">No changes yet.</p>
      ) : (
        <>
          <ol className="editor-history">
            {rows.map((r) => (
              <li key={`${r.object_type}-${r.object_id}-${r.revision_no}`}>
                <span>
                  {what(r)} {REVISION_REASON_LABELS[r.reason] ?? r.reason}
                  {r.mine ? ' by you' : ''}
                </span>
                <time dateTime={r.at} className="editor-muted">
                  {relativeTime(r.at, now)}
                </time>
              </li>
            ))}
          </ol>
          {total > revisions.length && (
            <p className="editor-muted">
              {total} changes in all. Every one is kept.
            </p>
          )}
        </>
      )}
    </section>
  );
}
