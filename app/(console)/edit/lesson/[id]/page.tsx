import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { Notice } from '@/components/console/notice';
import { PageHeader } from '@/components/console/page-header';
import { StatusBadge } from '@/components/console/status-badge';
import { EditorLoadError } from '@/components/console/editor/editor-states';
import { ExerciseList } from '@/components/console/editor/exercise-editor';
import { ItemList } from '@/components/console/editor/item-editor';
import { HistoryList } from '@/components/console/editor/lesson-aside';
import {
  GeneratePanel,
  LessonDetails,
  SubmitPanel,
} from '@/components/console/editor/lesson-panels';
import {
  LessonStatusProvider,
  LessonStatusStrip,
} from '@/components/console/editor/lesson-status';
import {
  GateControl,
  RetireButton,
} from '@/components/console/editor/reason-dialog';
import { requireRole } from '@/lib/console/access';
import {
  MAX_ITEMS,
  editorProblems,
  handoffCopy,
  lessonLocked,
  lessonStatus,
  nextStep,
  provenanceDefaults,
  readiness,
  utcToday,
  varietyEyebrow,
  type EditLessonPage,
} from '@/lib/console/editor';
import { editLessonPath, editTreePath } from '@/lib/console/paths';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

/** One read per request, shared by the page and its title. */
const loadLesson = cache(async (id: string) =>
  callRpc<EditLessonPage>(await serverSupabase(), 'page_edit_lesson', {
    p_lesson_id: id,
  }),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await loadLesson(id);
  // The lesson’s own name first, so a row of tabs tells lessons apart.
  return {
    title: result.ok ? `${result.data.lesson.title} · Edit` : 'Edit lesson',
  };
}

export default async function EditLessonRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const gate = await requireRole('editor');
  if (!gate.ok) return gate.view;
  const { id } = await params;

  const result = await loadLesson(id);
  if (!result.ok)
    return (
      <EditorLoadError
        error={result.error}
        what="lesson"
        retryHref={editLessonPath(id)}
        backHref={editTreePath()}
        backLabel="Back to the lessons"
      />
    );

  const page = result.data;
  const { lesson, language, items, exercises } = page;
  const now = new Date();
  const today = utcToday(now);
  const locked = lessonLocked(lesson);
  const status = lessonStatus(lesson);
  const submitted =
    lesson.submitted_at !== null && lesson.review_status === 'unreviewed';
  const variety =
    page.varieties.find((v) => v.id === lesson.variety_id)?.name ??
    lesson.variety_id;
  const gates = { lesson: lesson.publish_gate, unit: page.unit.publish_gate };
  const problems = editorProblems(page, gates);
  const { ready, checks } = readiness(page, lesson, gates);
  const step = nextStep(lesson, checks, locked !== null);
  const copy = handoffCopy(variety, lesson.reviewers);
  const eyebrow = varietyEyebrow(language.name, variety);
  const editorLanguage = { code: language.code, direction: language.direction };
  const decision = lesson.last_decision;

  return (
    <LessonStatusProvider>
      <div className="editor-page editor-lesson-page">
        <nav aria-label="Breadcrumb" className="editor-breadcrumb">
          <ol>
            <li>
              <Link href={editTreePath()}>Lessons</Link>
            </li>
            <li>{page.course.name}</li>
            <li>
              <Link href={`${editTreePath()}#unit-${page.unit.id}`}>
                Unit {page.unit.position}: {page.unit.title}
              </Link>
            </li>
          </ol>
        </nav>

        <PageHeader
          eyebrow={
            <>
              <span className="editor-eyebrow-long">{eyebrow.long}</span>
              <span className="editor-eyebrow-short">{eyebrow.short}</span>
            </>
          }
          title={lesson.title}
          description={lesson.subtitle || lesson.objective}
          actions={
            <div className="editor-header-badges">
              {locked ? (
                <StatusBadge status={status} />
              ) : (
                <a href="#submit-heading" className="editor-status-link">
                  <StatusBadge status={status} />
                  <span className="editor-visually-hidden">
                    : go to the review panel
                  </span>
                </a>
              )}
              {page.lesson.effective_gate === 'blocked' && (
                <StatusBadge status="gated" label="Held back" />
              )}
            </div>
          }
        />

        <LessonStatusStrip
          lessonId={lesson.id}
          status={status}
          step={step}
          waiting={copy.waiting}
          confirm={copy.confirm}
        />

        {locked === 'demo' && (
          <Notice tone="info" title="A starter lesson">
            <p>
              Starter lessons are read-only, so this one’s phrases are never
              changed or reviewed. Reviewed lessons replace it. To teach these
              phrases properly, write them in a lesson of your own.
            </p>
          </Notice>
        )}
        {locked === 'retired' && (
          <Notice tone="info" title="Retired">
            <p>
              This lesson was retired, so it can’t be changed. Its history is
              kept.
            </p>
          </Notice>
        )}
        {!locked &&
          decision?.current &&
          decision.decision !== 'approve' &&
          decision.comment && (
            <Notice
              tone="warning"
              title={
                decision.decision === 'reject'
                  ? 'The reviewer turned this lesson down'
                  : 'The reviewer asked for changes'
              }
            >
              <p>{decision.comment}</p>
            </Notice>
          )}

        <div className="editor-lesson-layout">
          <div className="editor-lesson-main">
            <LessonDetails
              lesson={lesson}
              varieties={page.varieties}
              varietyName={variety}
              locked={locked !== null}
            />

            <section className="editor-section" aria-labelledby="items-heading">
              <div className="editor-section-head">
                <h2 id="items-heading" tabIndex={-1}>
                  Phrases
                </h2>
                <p className="editor-muted">
                  {items.length} of up to {MAX_ITEMS}
                </p>
              </div>
              <ItemList
                lessonId={lesson.id}
                items={items}
                exercises={exercises}
                language={editorLanguage}
                submitted={submitted}
                lessonStatus={status}
                locked={locked !== null}
                provenance={provenanceDefaults(items)}
                today={today}
                lessonVariety={lesson.variety_id}
                varietyNames={Object.fromEntries(
                  page.varieties.map((v) => [v.id, v.name]),
                )}
              />
            </section>

            <section
              className="editor-section"
              aria-labelledby="exercises-heading"
            >
              <div className="editor-section-head">
                <h2 id="exercises-heading">Exercises</h2>
                <p className="editor-muted">
                  {exercises.length}{' '}
                  {exercises.length === 1 ? 'exercise' : 'exercises'}
                </p>
              </div>
              {!locked && (
                <GeneratePanel
                  lessonId={lesson.id}
                  items={items}
                  exercises={exercises}
                />
              )}
              <ExerciseList
                lessonId={lesson.id}
                exercises={exercises}
                items={items}
                language={editorLanguage}
                locked={locked !== null}
              />
            </section>
          </div>

          <aside className="editor-lesson-aside" aria-label="Lesson status">
            <SubmitPanel
              lesson={lesson}
              checks={checks}
              problems={problems}
              ready={ready}
              varietyName={variety}
              locked={locked !== null}
            />
            <HistoryList
              revisions={page.revisions.recent}
              total={page.revisions.count}
              items={items}
              exercises={exercises}
              now={now}
            />
            {!locked && (
              <section className="editor-panel" aria-labelledby="more-heading">
                <h2 id="more-heading" className="editor-panel-title">
                  More
                </h2>
                <div className="editor-more">
                  {page.is_admin && (
                    <GateControl
                      type="lesson"
                      id={lesson.id}
                      gate={lesson.publish_gate}
                      name="this lesson"
                      lessonId={lesson.id}
                    />
                  )}
                  <RetireButton
                    type="lesson"
                    id={lesson.id}
                    lessonId={lesson.id}
                    what="this lesson"
                    triggerLabel="Retire lesson"
                    description="Its phrases and exercises go with it. Nothing is deleted: the history stays, and learners who finished it keep their progress."
                  />
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </LessonStatusProvider>
  );
}
