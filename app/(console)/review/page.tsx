import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTable } from '@/components/console/data-table';
import { EmptyState } from '@/components/console/empty-state';
import { Notice } from '@/components/console/notice';
import { PageHeader } from '@/components/console/page-header';
import { Stat, StatGrid } from '@/components/console/stat';
import { StatusBadge } from '@/components/console/status-badge';
import { LoadError } from '@/components/console/review/load-error';
import { PhraseSummary } from '@/components/console/review/phrase';
import { requireRole } from '@/lib/console/access';
import {
  learnPath,
  reviewItemPath,
  reviewLessonPath,
  reviewQueuePath,
} from '@/lib/console/paths';
import {
  ageLabel,
  arrangeQueue,
  listNames,
  waitingLabel,
  type QueueItem,
  type QueuePage,
  type QueueVariety,
} from '@/lib/console/review';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Review queue' };

export default async function ReviewQueuePage() {
  const gate = await requireRole('reviewer');
  if (!gate.ok) return gate.view;
  const { context } = gate;

  const result = await callRpc<QueuePage>(
    await serverSupabase(),
    'page_review_queue',
  );
  if (!result.ok)
    return (
      <LoadError
        error={result.error}
        what="queue"
        retryHref={reviewQueuePath()}
        backHref={learnPath()}
        backLabel="Back to learning"
      />
    );

  const page = result.data;
  const now = page.generated_at;
  const varieties = new Map(page.varieties.map((v) => [v.id, v]));
  const { lessons, groups, total } = arrangeQueue(page);
  const reviewNames = page.varieties
    .filter((v) => v.can_review)
    .map((v) => v.name);
  const soleNames = context.review_varieties
    .filter((v) => context.sole_reviewer_varieties.includes(v.id))
    .map((v) => v.name);
  const oldest = [
    ...page.items.map((i) => i.changed_at),
    ...page.lessons.map((l) => l.submitted_at ?? l.changed_at),
  ].sort()[0];
  const inReviewCount = page.items.filter((i) => i.in_review).length;

  return (
    <div className="review-page">
      <PageHeader
        eyebrow="Review"
        title="Your review queue"
        description={
          reviewNames.length
            ? `Phrases and lessons waiting for a ${listNames(reviewNames)} reviewer. The longest-waiting come first.`
            : 'Phrases and lessons waiting for review.'
        }
      />

      {soleNames.length > 0 && (
        <Notice tone="info" title="You're the only reviewer here right now">
          As the only {listNames(soleNames)} reviewer, you can approve text you
          wrote yourself. An admin countersigns those approvals before learners
          see them.
        </Notice>
      )}

      {total === 0 ? (
        <EmptyState
          title="You're all caught up"
          action={
            <Link
              className="console-button console-button-outline"
              href={learnPath()}
            >
              Try the app as a learner
            </Link>
          }
        >
          <p>
            Nothing is waiting for you. New phrases show up here as soon as an
            editor writes them, and lessons once they&apos;re submitted.
          </p>
        </EmptyState>
      ) : (
        <>
          <StatGrid>
            <Stat label="Lessons submitted" value={lessons.length} />
            <Stat
              label="Phrases waiting"
              value={page.items.length}
              hint={
                inReviewCount < page.items.length
                  ? `${inReviewCount} in submitted lessons`
                  : undefined
              }
            />
            <Stat
              label="Longest wait"
              value={oldest ? ageLabel(oldest, now) : '—'}
            />
          </StatGrid>

          {lessons.length > 0 && (
            <section
              className="review-queue-section"
              aria-labelledby="queue-lessons"
            >
              <h2 id="queue-lessons" className="review-section-title">
                Lessons submitted for review
              </h2>
              <ul className="review-lesson-list">
                {lessons.map((lesson) => (
                  <li key={lesson.id} className="review-lesson-card">
                    <div className="review-lesson-card-main">
                      <p className="review-lesson-card-meta">
                        <StatusBadge status="in_review" />
                        <span>
                          {varietyLabel(varieties, lesson.variety_id)}
                        </span>
                        {lesson.is_author && (
                          <span className="review-tag">
                            You wrote part of this
                          </span>
                        )}
                      </p>
                      <h3 className="review-lesson-card-title">
                        <Link href={reviewLessonPath(lesson.id)}>
                          {lesson.title}
                        </Link>
                      </h3>
                      <p className="review-lesson-card-facts">
                        {lesson.item_count} phrases · {lesson.exercise_count}{' '}
                        exercises
                        {lesson.unreviewed_items > 0 &&
                          ` · ${lesson.unreviewed_items} phrase${lesson.unreviewed_items === 1 ? '' : 's'} still to approve`}
                      </p>
                    </div>
                    <div className="review-lesson-card-side">
                      <p className="review-waiting">
                        {waitingLabel(lesson.submitted_at, now)}
                      </p>
                      <Link
                        className="console-button console-button-outline"
                        href={reviewLessonPath(lesson.id)}
                      >
                        Review lesson
                        <span className="review-visually-hidden">
                          : {lesson.title}
                        </span>
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {groups.length > 0 && (
            <section
              className="review-queue-section"
              aria-labelledby="queue-phrases"
            >
              <h2 id="queue-phrases" className="review-section-title">
                Phrases
              </h2>
              {groups.map((group) => {
                const variety = varieties.get(group.varietyId);
                return (
                  <div key={group.lessonId} className="review-queue-group">
                    <h3 className="review-queue-group-title">
                      <Link href={reviewLessonPath(group.lessonId)}>
                        {group.lessonTitle}
                      </Link>
                      <span className="review-queue-group-meta">
                        {varietyLabel(varieties, group.varietyId)}
                        {!group.inReview && ' · not submitted yet'}
                      </span>
                    </h3>
                    <DataTable<QueueItem>
                      rows={group.items}
                      rowKey={(item) => item.id}
                      caption={`Phrases from ${group.lessonTitle}`}
                      columns={[
                        {
                          key: 'phrase',
                          header: 'Phrase',
                          cell: (item) => (
                            <Link
                              href={reviewItemPath(item.id)}
                              className="review-phrase-link"
                            >
                              <PhraseSummary
                                native={item.native}
                                romanisation={item.romanisation}
                                meaning={item.meaning}
                                lang={
                                  variety?.language ?? item.id.split('-')[0]
                                }
                                dir={variety?.direction ?? 'rtl'}
                              />
                            </Link>
                          ),
                        },
                        {
                          key: 'status',
                          header: 'Status',
                          cell: (item) => (
                            <span className="review-status-cell">
                              <StatusBadge
                                status={item.in_review ? 'in_review' : 'draft'}
                                label={
                                  item.in_review ? undefined : 'Not submitted'
                                }
                              />
                              {item.is_author && (
                                <span className="review-tag">Yours</span>
                              )}
                              {item.open_suggestions > 0 && (
                                <span className="review-tag">
                                  {item.open_suggestions} suggestion
                                  {item.open_suggestions === 1 ? '' : 's'}
                                </span>
                              )}
                            </span>
                          ),
                        },
                        {
                          key: 'age',
                          header: 'Waiting',
                          cell: (item) => ageLabel(item.changed_at, now),
                        },
                        {
                          key: 'open',
                          header: 'Action',
                          align: 'end',
                          cell: (item) => (
                            <Link
                              className="console-button console-button-outline review-open-button"
                              href={reviewItemPath(item.id)}
                            >
                              Review
                              <span className="review-visually-hidden">
                                : {item.meaning}
                              </span>
                            </Link>
                          ),
                        },
                      ]}
                    />
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function varietyLabel(varieties: Map<string, QueueVariety>, id: string) {
  return varieties.get(id)?.name ?? id;
}
