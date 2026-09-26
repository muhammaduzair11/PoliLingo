import type { Metadata } from 'next';
import Link from 'next/link';
import { Notice } from '@/components/console/notice';
import { PageHeader } from '@/components/console/page-header';
import { StatusBadge } from '@/components/console/status-badge';
import { DecisionPanel } from '@/components/console/review/decision-panel';
import { ReviewHistory } from '@/components/console/review/history';
import { ItemFields } from '@/components/console/review/item-fields';
import { LearnerPreview } from '@/components/console/review/learner-preview';
import { LoadError } from '@/components/console/review/load-error';
import { PhraseSummary } from '@/components/console/review/phrase';
import { CountersignButton } from '@/components/console/review/small-actions';
import { StanceNotice } from '@/components/console/review/stance-notice';
import { OutcomeProvider } from '@/components/console/review/outcome';
import { SuggestFix } from '@/components/console/review/suggest-fix';
import { requireRole } from '@/lib/console/access';
import {
  reviewItemPath,
  reviewLessonPath,
  reviewQueuePath,
} from '@/lib/console/paths';
import {
  approvalStance,
  awaitingCountersign,
  badgeFor,
  type ItemPage,
} from '@/lib/console/review';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';
import {
  addComment,
  countersignDecision,
  recordDecision,
  redactComment,
  suggestFix,
  withdrawSuggestion,
} from '../../actions';

export const metadata: Metadata = { title: 'Review a phrase' };

export default async function ReviewItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const gate = await requireRole('staff');
  if (!gate.ok) return gate.view;

  const result = await callRpc<ItemPage>(
    await serverSupabase(),
    'page_review_item',
    { p_item_id: id },
  );
  if (!result.ok)
    return (
      <LoadError
        error={result.error}
        what="phrase"
        retryHref={reviewItemPath(id)}
        backHref={reviewQueuePath()}
        backLabel="Back to the queue"
      />
    );

  const page = result.data;
  const { item, language, variety, lesson, viewer } = page;
  const lang = language.code;
  const dir = language.direction;
  const pendingCountersign = awaitingCountersign(page.decisions);
  // A sole approval by the viewer, still waiting: approving again adds nothing.
  const myPendingApproval =
    pendingCountersign !== null &&
    pendingCountersign.reviewer_id === viewer.contributor_id;
  const stance = approvalStance({
    viewer,
    is_demo: item.is_demo,
    retired: item.retired,
  });
  const badge = badgeFor({
    review_status: item.review_status,
    submitted: lesson.submitted_at !== null,
    is_demo: item.is_demo,
    retired: item.retired,
    awaiting_countersign: pendingCountersign !== null,
  });
  const seen = {
    native: item.native,
    romanisation: item.romanisation,
    meaning: item.meaning,
    context: item.context,
    usage_note: item.usage_note,
  };
  const current = page.decisions.find((d) => d.current) ?? null;
  const openSuggestions = page.suggestions.filter((s) => s.status === 'open');
  const others = page.siblings.filter((s) => s.id !== item.id);

  return (
    <div className="review-page">
      <nav className="review-breadcrumb" aria-label="Breadcrumb">
        <Link href={reviewQueuePath()}>Queue</Link>
        <span aria-hidden="true">/</span>
        <Link href={reviewLessonPath(lesson.id)}>{lesson.title}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Phrase {item.position ?? ''}</span>
      </nav>
      <PageHeader
        eyebrow={variety.name}
        title={<>&ldquo;{item.meaning}&rdquo;</>}
        description={
          <>
            Phrase {item.position} of {page.siblings.length} in{' '}
            <Link href={reviewLessonPath(lesson.id)}>{lesson.title}</Link>
            {item.text_author_name && (
              <> · written by {item.text_author_name}</>
            )}
          </>
        }
        actions={<StatusBadge status={badge} />}
      />

      <OutcomeProvider>
        <StanceNotice
          stance={stance}
          what="phrase"
          varietyName={variety.name}
        />

        {pendingCountersign && (
          <Notice tone="warning" title="Waiting for an admin's countersign">
            <p>
              {pendingCountersign.reviewer_name ?? 'The reviewer'} approved text
              they wrote, as the only {variety.name} reviewer. It won&apos;t
              reach learners until an admin countersigns, or another reviewer
              approves it.
            </p>
            {viewer.is_admin &&
              pendingCountersign.reviewer_id !== viewer.contributor_id && (
                <CountersignButton
                  decisionId={pendingCountersign.id}
                  reviewerName={
                    pendingCountersign.reviewer_name ?? 'The reviewer'
                  }
                  action={countersignDecision}
                />
              )}
          </Notice>
        )}

        {item.review_status !== 'unreviewed' &&
          current?.comment &&
          !current.redacted && (
            <Notice
              tone={item.review_status === 'approved' ? 'success' : 'warning'}
              title={
                item.review_status === 'approved'
                  ? `Approved by ${current.reviewer_name ?? 'a reviewer'}`
                  : item.review_status === 'rejected'
                    ? `Rejected by ${current.reviewer_name ?? 'a reviewer'}`
                    : `${current.reviewer_name ?? 'A reviewer'} asked for changes`
              }
            >
              {current.comment}
            </Notice>
          )}

        <div className="review-layout">
          <div className="review-main">
            <LearnerPreview
              native={item.native}
              romanisation={item.romanisation}
              meaning={item.meaning}
              context={item.context}
              usageNote={item.usage_note}
              lang={lang}
              dir={dir}
              learnerLabel={variety.learner_label}
            />
            <ItemFields item={item} lang={lang} dir={dir} />
          </div>

          <aside className="review-side" aria-labelledby="review-actions-title">
            <section className="review-card review-actions-card">
              <h2 id="review-actions-title" className="review-section-title">
                Your review
              </h2>
              {stance.kind === 'can-approve' ||
              stance.kind === 'sole-author' ? (
                <p className="console-hint">
                  Read it aloud as a {variety.name} speaker would. Approve only
                  what you would teach your own family.
                </p>
              ) : null}
              <DecisionPanel
                key={item.review_fingerprint}
                targetType="item"
                targetId={item.id}
                fingerprint={item.review_fingerprint}
                stance={stance}
                requiredScope={page.required_scope}
                approveBlocked={
                  myPendingApproval
                    ? 'You approved this phrase. It is waiting for an admin to countersign, so there is nothing more to approve.'
                    : undefined
                }
                approveBlockedTitle="Already approved"
                varietyName={variety.name}
                seen={seen}
                lang={lang}
                dir={dir}
                action={recordDecision}
              />
              {viewer.can_suggest && (
                <SuggestFix
                  key={`suggest-${item.review_fingerprint}`}
                  itemId={item.id}
                  fingerprint={item.review_fingerprint}
                  current={seen}
                  lang={lang}
                  dir={dir}
                  action={suggestFix}
                />
              )}
              {openSuggestions.length > 0 && (
                <p className="console-hint">
                  {openSuggestions.length} suggested fix
                  {openSuggestions.length === 1 ? ' is' : 'es are'} waiting for
                  an editor. See the history below.
                </p>
              )}
            </section>

            {others.length > 0 && (
              <section
                className="review-card"
                aria-labelledby="review-siblings-title"
              >
                <h2 id="review-siblings-title" className="review-section-title">
                  Also in this lesson
                </h2>
                <ol className="review-siblings">
                  {page.siblings.map((s) => (
                    <li
                      key={s.id}
                      className={
                        s.id === item.id ? 'review-sibling-current' : undefined
                      }
                    >
                      {s.id === item.id ? (
                        <span
                          aria-current="true"
                          className="review-sibling-link"
                        >
                          <PhraseSummary
                            native={s.native}
                            romanisation={s.romanisation}
                            meaning={s.meaning}
                            lang={lang}
                            dir={dir}
                          />
                        </span>
                      ) : (
                        <Link
                          href={reviewItemPath(s.id)}
                          className="review-sibling-link"
                        >
                          <PhraseSummary
                            native={s.native}
                            romanisation={s.romanisation}
                            meaning={s.meaning}
                            lang={lang}
                            dir={dir}
                          />
                        </Link>
                      )}
                      <StatusBadge
                        status={badgeFor({
                          review_status: s.review_status,
                          submitted: lesson.submitted_at !== null,
                        })}
                      />
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </aside>
        </div>

        <ReviewHistory
          targetType="item"
          targetId={item.id}
          revisions={page.revisions}
          decisions={page.decisions}
          comments={page.comments}
          suggestions={page.suggestions}
          now={page.generated_at}
          lang={lang}
          dir={dir}
          isAdmin={viewer.is_admin}
          addComment={addComment}
          redactComment={redactComment}
          withdrawSuggestion={withdrawSuggestion}
        />
      </OutcomeProvider>
    </div>
  );
}
