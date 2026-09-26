import type { Metadata } from 'next';
import Link from 'next/link';
import { Notice } from '@/components/console/notice';
import { PageHeader } from '@/components/console/page-header';
import { StatusBadge } from '@/components/console/status-badge';
import { NativeText } from '@/components/native';
import { DecisionPanel } from '@/components/console/review/decision-panel';
import { ReviewHistory } from '@/components/console/review/history';
import { LoadError } from '@/components/console/review/load-error';
import { PhraseSummary } from '@/components/console/review/phrase';
import { CountersignButton } from '@/components/console/review/small-actions';
import { OutcomeProvider } from '@/components/console/review/outcome';
import { StanceNotice } from '@/components/console/review/stance-notice';
import { requireRole } from '@/lib/console/access';
import {
  reviewItemPath,
  reviewLessonPath,
  reviewQueuePath,
} from '@/lib/console/paths';
import {
  EXERCISE_KIND_LABELS,
  approvalStance,
  awaitingCountersign,
  badgeFor,
  type LessonPage,
} from '@/lib/console/review';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';
import {
  addComment,
  countersignDecision,
  recordDecision,
  redactComment,
} from '../../actions';

export const metadata: Metadata = { title: 'Review a lesson' };

const MIN_EXERCISES = 6;

export default async function ReviewLessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const gate = await requireRole('staff');
  if (!gate.ok) return gate.view;

  const result = await callRpc<LessonPage>(
    await serverSupabase(),
    'page_review_lesson',
    { p_lesson_id: id },
  );
  if (!result.ok)
    return (
      <LoadError
        error={result.error}
        what="lesson"
        retryHref={reviewLessonPath(id)}
        backHref={reviewQueuePath()}
        backLabel="Back to the queue"
      />
    );

  const page = result.data;
  const { lesson, language, variety, viewer } = page;
  const lang = language.code;
  const dir = language.direction;
  const submitted = lesson.submitted_at !== null;
  const pendingCountersign = awaitingCountersign(page.decisions);
  // A sole approval by the viewer, still waiting: approving again adds nothing.
  const myPendingApproval =
    pendingCountersign !== null &&
    pendingCountersign.reviewer_id === viewer.contributor_id;
  const stance = approvalStance({
    viewer,
    is_demo: lesson.is_demo,
    retired: lesson.retired,
  });
  const blocking = page.problems.filter((p) => p.severity === 'blocking');
  const warnings = page.problems.filter(
    (p) => p.severity === 'warning' && p.code !== 'PL422_TOO_FEW_EXERCISES',
  );
  const itemsById = new Map(page.items.map((i) => [i.id, i]));
  const approvedItems = page.items.filter(
    (i) => i.review_status === 'approved',
  ).length;

  const approveBlocked = !submitted ? (
    <>
      Approve the lesson once the editor submits it. Until then you can review
      its phrases, comment or request changes.
    </>
  ) : myPendingApproval ? (
    <>
      You approved this lesson. It is waiting for an admin to countersign, so
      there is nothing more to approve.
    </>
  ) : page.exercise_count < MIN_EXERCISES ? (
    <>
      This lesson has {page.exercise_count} exercise
      {page.exercise_count === 1 ? '' : 's'}. A lesson needs at least{' '}
      {MIN_EXERCISES} before it can be approved. Ask the editor to add{' '}
      {MIN_EXERCISES - page.exercise_count} more, or request changes.
    </>
  ) : blocking.length > 0 ? (
    <>
      Fix {blocking.length === 1 ? 'the problem' : 'the problems'} listed on
      this page first. You can request changes to let the editor know.
    </>
  ) : undefined;

  return (
    <div className="review-page">
      <nav className="review-breadcrumb" aria-label="Breadcrumb">
        <Link href={reviewQueuePath()}>Queue</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{lesson.title}</span>
      </nav>
      <PageHeader
        eyebrow={variety.name}
        title={lesson.title}
        description={lesson.subtitle || lesson.objective}
        actions={
          <StatusBadge
            status={badgeFor({
              review_status: lesson.review_status,
              submitted,
              is_demo: lesson.is_demo,
              retired: lesson.retired,
              awaiting_countersign: pendingCountersign !== null,
            })}
          />
        }
      />

      <OutcomeProvider>
        <StanceNotice
          stance={stance}
          what="lesson"
          varietyName={variety.name}
        />

        {!submitted && !lesson.is_demo && (
          <Notice tone="info" title="Not submitted yet">
            The editor is still working on this lesson. You can review its
            phrases now, and approve the lesson itself once they submit it.
          </Notice>
        )}

        {pendingCountersign && (
          <Notice tone="warning" title="Waiting for an admin's countersign">
            <p>
              {pendingCountersign.reviewer_name ?? 'The reviewer'} approved a
              lesson they worked on, as the only {variety.name} reviewer.
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

        {blocking.length > 0 && (
          <Notice tone="error" title="Problems to fix before approval">
            <ul className="review-problems">
              {blocking.map((p, i) => (
                <li key={`${p.code}-${p.target_id ?? i}`}>{p.message}</li>
              ))}
            </ul>
          </Notice>
        )}
        {warnings.length > 0 && (
          <Notice tone="info" title="Good to know">
            <ul className="review-problems">
              {warnings.map((p, i) => (
                <li key={`${p.code}-${p.target_id ?? i}`}>{p.message}</li>
              ))}
            </ul>
          </Notice>
        )}

        <div className="review-layout">
          <div className="review-main">
            <section className="review-card" aria-labelledby="lesson-about">
              <h2 id="lesson-about" className="review-section-title">
                What learners should be able to do
              </h2>
              <p>{lesson.objective}</p>
            </section>

            <section className="review-card" aria-labelledby="lesson-phrases">
              <h2 id="lesson-phrases" className="review-section-title">
                Phrases{' '}
                <span className="review-count">
                  {approvedItems} of {page.items.length} approved
                </span>
              </h2>
              {page.items.length === 0 ? (
                <p className="console-hint">This lesson has no phrases yet.</p>
              ) : (
                <ol className="review-siblings">
                  {page.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={reviewItemPath(item.id)}
                        className="review-sibling-link"
                      >
                        <span className="review-position">{item.position}</span>
                        <PhraseSummary
                          native={item.native}
                          romanisation={item.romanisation}
                          meaning={item.meaning}
                          lang={lang}
                          dir={dir}
                        />
                      </Link>
                      <StatusBadge
                        status={badgeFor({
                          review_status: item.review_status,
                          submitted,
                          is_demo: item.is_demo,
                          awaiting_countersign: item.awaiting_countersign,
                        })}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="review-card" aria-labelledby="lesson-exercises">
              <h2 id="lesson-exercises" className="review-section-title">
                Exercises{' '}
                <span
                  className={`review-count${page.exercise_count < MIN_EXERCISES ? ' review-count-short' : ''}`}
                >
                  {page.exercise_count} of at least {MIN_EXERCISES}
                </span>
              </h2>
              {page.exercises.length === 0 ? (
                <p className="console-hint">No exercises yet.</p>
              ) : (
                <ol className="review-exercises">
                  {page.exercises.map((exercise) => {
                    const answer = itemsById.get(exercise.answer_item_id);
                    return (
                      <li key={exercise.id} className="review-exercise">
                        <p className="review-exercise-kind">
                          {EXERCISE_KIND_LABELS[exercise.kind] ?? exercise.kind}
                        </p>
                        <p className="review-exercise-prompt">
                          {exercise.prompt}
                        </p>
                        <p className="review-exercise-answer">
                          <span className="review-exercise-label">Answer</span>
                          {answer ? (
                            <span className="review-choice review-choice-answer">
                              <NativeText
                                text={answer.native}
                                lang={lang}
                                dir={dir}
                              />
                              <span className="review-choice-meaning">
                                {answer.meaning}
                              </span>
                            </span>
                          ) : (
                            <em className="review-empty">(missing phrase)</em>
                          )}
                        </p>
                        {exercise.options.length > 0 && (
                          <div className="review-exercise-answer">
                            <span className="review-exercise-label">
                              Wrong choices
                            </span>
                            <ul className="review-choices">
                              {exercise.options.map((optionId) => {
                                const option = itemsById.get(optionId);
                                return (
                                  <li key={optionId} className="review-choice">
                                    {option ? (
                                      <>
                                        <NativeText
                                          text={option.native}
                                          lang={lang}
                                          dir={dir}
                                        />
                                        <span className="review-choice-meaning">
                                          {option.meaning}
                                        </span>
                                      </>
                                    ) : (
                                      <em className="review-empty">
                                        (missing phrase)
                                      </em>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>

          <aside className="review-side" aria-labelledby="lesson-review-title">
            <section className="review-card review-actions-card">
              <h2 id="lesson-review-title" className="review-section-title">
                Your review of the lesson
              </h2>
              {(stance.kind === 'can-approve' ||
                stance.kind === 'sole-author') && (
                <p className="console-hint">
                  Each phrase is approved on its own page. Here you approve the
                  lesson as a whole: the order, the title and every exercise.
                </p>
              )}
              <DecisionPanel
                key={lesson.review_fingerprint}
                targetType="lesson"
                targetId={lesson.id}
                fingerprint={lesson.review_fingerprint}
                stance={stance}
                approveBlocked={approveBlocked}
                approveBlockedTitle={
                  submitted && myPendingApproval
                    ? 'Already approved'
                    : undefined
                }
                varietyName={variety.name}
                lang={lang}
                dir={dir}
                action={recordDecision}
              />
            </section>
          </aside>
        </div>

        <ReviewHistory
          targetType="lesson"
          targetId={lesson.id}
          decisions={page.decisions}
          comments={page.comments}
          now={page.generated_at}
          lang={lang}
          dir={dir}
          isAdmin={viewer.is_admin}
          addComment={addComment}
          redactComment={redactComment}
        />
      </OutcomeProvider>
    </div>
  );
}
