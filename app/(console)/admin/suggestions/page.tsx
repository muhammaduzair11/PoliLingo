import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/console/empty-state';
import { Notice } from '@/components/console/notice';
import { PageHeader } from '@/components/console/page-header';
import { StatusBadge } from '@/components/console/status-badge';
import { FieldDiff } from '@/components/console/review/field-diff';
import { LoadError } from '@/components/console/review/load-error';
import { OutcomeProvider } from '@/components/console/review/outcome';
import { PhraseSummary } from '@/components/console/review/phrase';
import { SuggestionActions } from '@/components/console/review/suggestion-actions';
import { requireRole } from '@/lib/console/access';
import {
  adminOverviewPath,
  adminSuggestionsPath,
  reviewItemPath,
} from '@/lib/console/paths';
import {
  SUGGESTION_STATUS_LABELS,
  agoLabel,
  badgeFor,
  dateTimeLabel,
  suggestionDiff,
  type AdminSuggestionsPage,
} from '@/lib/console/review';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';
import { acceptSuggestion, declineSuggestion } from './actions';

export const metadata: Metadata = { title: 'Suggestions' };

export default async function AdminSuggestionsPage() {
  const gate = await requireRole('editor');
  if (!gate.ok) return gate.view;

  const result = await callRpc<AdminSuggestionsPage>(
    await serverSupabase(),
    'page_admin_suggestions',
  );
  if (!result.ok)
    return (
      <LoadError
        error={result.error}
        what="list of suggestions"
        retryHref={adminSuggestionsPath()}
        backHref={adminOverviewPath()}
        backLabel="Back to the overview"
      />
    );

  const page = result.data;
  const now = page.generated_at;

  return (
    <div className="review-page">
      <PageHeader
        eyebrow="Admin"
        title="Suggested fixes"
        description="Reviewers suggest fixes to phrases they can't approve as written. Accepting one applies it word for word and sends the phrase back for another reviewer to approve."
      />

      <OutcomeProvider>
        {page.open.length === 0 ? (
          <EmptyState title="No suggestions waiting">
            <p>
              When a reviewer suggests a fix, it appears here with the current
              text beside it.
            </p>
          </EmptyState>
        ) : (
          <ul className="review-suggestion-list" aria-label="Open suggestions">
            {page.open.map((s) => {
              const changes = suggestionDiff(s.current, s.proposed);
              const suggester =
                s.suggester_name ?? `Contributor ${s.suggester_id}`;
              return (
                <li key={s.id} className="review-card review-suggestion">
                  <div className="review-suggestion-head">
                    <div>
                      <p className="review-suggestion-meta">
                        {s.variety_name} · {s.lesson_title}
                      </p>
                      <h2 className="review-suggestion-title">
                        <Link href={reviewItemPath(s.item_id)}>
                          <PhraseSummary
                            native={s.current.native}
                            romanisation={s.current.romanisation}
                            meaning={s.current.meaning}
                            lang={s.language}
                            dir={s.direction}
                          />
                        </Link>
                      </h2>
                    </div>
                    <StatusBadge
                      status={badgeFor({
                        review_status: s.review_status,
                        submitted: s.lesson_submitted,
                        retired: s.item_retired,
                      })}
                    />
                  </div>
                  <p className="review-entry-head">
                    Suggested by <strong>{suggester}</strong> ·{' '}
                    <time
                      dateTime={s.created_at}
                      title={dateTimeLabel(s.created_at)}
                    >
                      {agoLabel(s.created_at, now)}
                    </time>
                  </p>
                  {s.note && (
                    <blockquote className="review-quote">{s.note}</blockquote>
                  )}
                  {changes.length > 0 ? (
                    <FieldDiff
                      changes={changes}
                      lang={s.language}
                      dir={s.direction}
                      beforeLabel="Now"
                      afterLabel="Suggested"
                      caption={`Suggested changes to ${s.current.meaning}`}
                    />
                  ) : (
                    <p className="console-hint">
                      The phrase already reads this way.
                    </p>
                  )}
                  {s.item_retired ? (
                    <Notice tone="info" title="This phrase was retired">
                      It is no longer taught, so the fix can&apos;t be applied.
                      Decline the suggestion to close it.
                    </Notice>
                  ) : (
                    s.stale && (
                      <Notice tone="warning" title="The phrase changed since">
                        Someone edited this phrase after the suggestion was
                        made, so it can&apos;t be applied as it is. Decline it,
                        and the reviewer can suggest a fresh fix.
                      </Notice>
                    )
                  )}
                  {!s.can_resolve && (
                    <Notice tone="info">
                      You don&apos;t edit {s.language_name}, so an editor for it
                      needs to decide.
                    </Notice>
                  )}
                  {s.can_resolve && (
                    <SuggestionActions
                      suggestionId={s.id}
                      fingerprint={s.review_fingerprint}
                      suggesterName={suggester}
                      canAccept={
                        !s.stale && !s.item_retired && changes.length > 0
                      }
                      accept={acceptSuggestion}
                      decline={declineSuggestion}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {page.recent.length > 0 && (
          <section className="review-card" aria-labelledby="recent-suggestions">
            <h2 id="recent-suggestions" className="review-section-title">
              Recently handled
            </h2>
            <ul className="review-recent">
              {page.recent.map((r) => (
                <li key={r.id}>
                  <Link href={reviewItemPath(r.item_id)}>
                    {SUGGESTION_STATUS_LABELS[r.status]}
                  </Link>{' '}
                  · from {r.suggester_name ?? 'a reviewer'}
                  {r.resolved_by_name && `, by ${r.resolved_by_name}`}
                  {r.resolved_at && (
                    <>
                      {' '}
                      ·{' '}
                      <time
                        dateTime={r.resolved_at}
                        title={dateTimeLabel(r.resolved_at)}
                      >
                        {agoLabel(r.resolved_at, now)}
                      </time>
                    </>
                  )}
                  {r.resolution_note && (
                    <span className="review-recent-note">
                      {' '}
                      — {r.resolution_note}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </OutcomeProvider>
    </div>
  );
}
