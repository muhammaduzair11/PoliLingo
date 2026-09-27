import { StatusBadge } from '@/components/console/status-badge';
import type { ActionResult } from '@/lib/console/action-result';
import {
  DECISION_LABELS,
  FIELD_LABELS,
  FIELD_ORDER,
  REVISION_REASON_LABELS,
  SCOPE_LABELS,
  SUGGESTION_STATUS_LABELS,
  agoLabel,
  buildHistory,
  commentReplies,
  dateTimeLabel,
  revisionChanges,
  type CommentRow,
  type DecisionRow,
  type Direction,
  type HistoryEntry,
  type RevisionRow,
  type SuggestionRow,
} from '@/lib/console/review';
import { CommentForm } from './comment-form';
import { FieldDiff } from './field-diff';
import { FieldValue } from './phrase';
import { RedactButton, WithdrawButton } from './small-actions';

type FormAction<T> = (
  previous: ActionResult<T> | null,
  formData: FormData,
) => Promise<ActionResult<T>>;

function When({ at, now }: { at: string; now: string }) {
  return (
    <time className="review-when" dateTime={at} title={dateTimeLabel(at)}>
      {agoLabel(at, now)}
    </time>
  );
}

const who = (name: string | null, id: string | null) =>
  name ?? (id ? `Contributor ${id}` : 'The course files');

/**
 * Everything that happened to a phrase or lesson, newest first: its
 * revisions, review decisions, comments (with replies) and suggestions.
 * History is append-only; an admin can only blank a comment's text.
 */
export function ReviewHistory({
  targetType,
  targetId,
  revisions = [],
  decisions,
  comments,
  suggestions = [],
  now,
  lang,
  dir,
  isAdmin,
  addComment,
  redactComment,
  withdrawSuggestion,
}: {
  targetType: 'item' | 'lesson';
  targetId: string;
  revisions?: RevisionRow[];
  decisions: DecisionRow[];
  comments: CommentRow[];
  suggestions?: SuggestionRow[];
  now: string;
  lang: string;
  dir: Direction;
  isAdmin: boolean;
  addComment: FormAction<string>;
  redactComment: FormAction<unknown>;
  withdrawSuggestion?: FormAction<unknown>;
}) {
  const entries = buildHistory({ revisions, decisions, comments, suggestions });
  const changes = revisionChanges(revisions);
  const replies = commentReplies(comments);
  const previousOf = new Map<string, RevisionRow>();
  const bySeq = [...revisions].sort((a, b) => a.seq - b.seq);
  bySeq.forEach((r, i) => {
    if (i > 0) previousOf.set(String(r.seq), bySeq[i - 1]);
  });

  const renderComment = (c: CommentRow, reply = false) => (
    <div
      key={c.id}
      className={`review-comment${reply ? ' review-comment-reply' : ''}`}
    >
      <p className="review-entry-head">
        <strong>{who(c.author_name, c.author_id)}</strong>
        {reply ? ' replied' : ' commented'} · <When at={c.at} now={now} />
      </p>
      {c.redacted ? (
        <p className="review-removed">This comment was removed by an admin.</p>
      ) : (
        <p className="review-comment-body">{c.body}</p>
      )}
      {isAdmin && !c.redacted && (
        <RedactButton commentId={c.id} action={redactComment} />
      )}
    </div>
  );

  const renderEntry = (entry: HistoryEntry) => {
    switch (entry.kind) {
      case 'revision': {
        const r = entry.revision;
        const diff = changes.get(r.seq) ?? [];
        return (
          <>
            <p className="review-entry-head">
              <strong>{REVISION_REASON_LABELS[r.reason] ?? r.reason}</strong>
              {' by '}
              {who(r.author_name, r.author_id)} · <When at={r.at} now={now} />
              <span className="review-entry-tag">Revision {r.revision_no}</span>
            </p>
            {diff.length > 0 ? (
              <FieldDiff
                changes={diff}
                lang={lang}
                dir={dir}
                beforeLabel="Before"
                afterLabel="After"
                caption={`What revision ${r.revision_no} changed`}
              />
            ) : previousOf.has(String(r.seq)) ? (
              <p className="console-hint">
                No change to the learner-visible text (source or position).
              </p>
            ) : (
              <p className="console-hint">Where this phrase started.</p>
            )}
          </>
        );
      }
      case 'decision': {
        const d = entry.decision;
        return (
          <>
            <p className="review-entry-head">
              <strong>{DECISION_LABELS[d.decision]}</strong>
              {' by '}
              {who(d.reviewer_name, d.reviewer_id)} ·{' '}
              <When at={d.at} now={now} />
              {d.current && <span className="review-entry-tag">Current</span>}
              {d.sole_reviewer && d.decision === 'approve' && (
                <StatusBadge
                  status={d.countersign ? 'approved' : 'sole_reviewer'}
                  label={d.countersign ? 'Countersigned' : undefined}
                />
              )}
            </p>
            {d.scope && d.scope.length > 0 && (
              <p className="review-entry-scope">
                Checked:{' '}
                {d.scope
                  .map((s) => SCOPE_LABELS[s]?.label.toLowerCase() ?? s)
                  .join(', ')}
                {d.target_revision_no !== null &&
                  ` (revision ${d.target_revision_no})`}
              </p>
            )}
            {d.comment &&
              (d.redacted ? (
                <p className="review-removed">
                  This note was removed by an admin.
                </p>
              ) : (
                <blockquote className="review-quote">{d.comment}</blockquote>
              ))}
            {d.countersign && (
              <p className="console-hint">
                Countersigned by{' '}
                {who(d.countersign.admin_name, d.countersign.admin_id)} ·{' '}
                <When at={d.countersign.at} now={now} />
              </p>
            )}
            {isAdmin && d.comment && !d.redacted && (
              <RedactButton commentId={d.id} action={redactComment} />
            )}
          </>
        );
      }
      case 'comment': {
        const c = entry.comment;
        return (
          <>
            {renderComment(c)}
            {(replies.get(c.id) ?? []).map((r) => renderComment(r, true))}
            <details className="review-reply">
              <summary>Reply</summary>
              <CommentForm
                targetType={targetType}
                targetId={targetId}
                parentId={c.id}
                action={addComment}
                label="Your reply"
                placeholder=""
              />
            </details>
          </>
        );
      }
      case 'suggestion': {
        const s = entry.suggestion;
        const proposed = FIELD_ORDER.filter((f) =>
          Object.hasOwn(s.proposed, f),
        );
        return (
          <>
            <p className="review-entry-head">
              <strong>Suggested a fix</strong>
              {' · '}
              {who(s.suggester_name, s.suggester_id)} ·{' '}
              <When at={s.created_at} now={now} />
              <span className="review-entry-tag">
                {SUGGESTION_STATUS_LABELS[s.status]}
              </span>
            </p>
            <ul className="review-proposed">
              {proposed.map((field) => (
                <li key={field}>
                  <span className="review-proposed-label">
                    {FIELD_LABELS[field]}:
                  </span>{' '}
                  <FieldValue
                    field={field}
                    value={s.proposed[field] ?? null}
                    lang={lang}
                    dir={dir}
                  />
                </li>
              ))}
            </ul>
            {s.note && (
              <blockquote className="review-quote">{s.note}</blockquote>
            )}
            {s.mine && s.status === 'open' && withdrawSuggestion && (
              <WithdrawButton suggestionId={s.id} action={withdrawSuggestion} />
            )}
            {s.resolution_note && (
              <p className="console-hint">
                Editor&apos;s reason: {s.resolution_note}
              </p>
            )}
          </>
        );
      }
    }
  };

  return (
    <section className="review-card" aria-labelledby="review-history-title">
      <h2 id="review-history-title" className="review-section-title">
        History
      </h2>
      <CommentForm
        targetType={targetType}
        targetId={targetId}
        action={addComment}
      />
      {entries.length === 0 ? (
        <p className="console-hint">Nothing has happened here yet.</p>
      ) : (
        <ol className="review-history">
          {entries.map((entry) => (
            <li
              key={entry.key}
              className={`review-history-entry review-history-${entry.kind}`}
            >
              {renderEntry(entry)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
