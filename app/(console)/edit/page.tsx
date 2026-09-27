import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/console/empty-state';
import { PageHeader } from '@/components/console/page-header';
import { Stat, StatGrid } from '@/components/console/stat';
import { StatusBadge } from '@/components/console/status-badge';
import { EditorLoadError } from '@/components/console/editor/editor-states';
import {
  GateControl,
  RetireButton,
} from '@/components/console/editor/reason-dialog';
import { ReorderButtons } from '@/components/console/editor/reorder-buttons';
import { StatusCounts } from '@/components/console/editor/status-counts';
import {
  DemoSunsetForm,
  NewLessonForm,
  NewUnitForm,
} from '@/components/console/editor/tree-forms';
import { NativeText } from '@/components/native';
import { requireRole } from '@/lib/console/access';
import {
  formatDay,
  gateLabel,
  treeView,
  utcToday,
  type EditTree,
  type TreeCourseView,
  type TreeLanguageView,
  type TreeUnitView,
} from '@/lib/console/editor';
import { editLessonPath, editTreePath, learnPath } from '@/lib/console/paths';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Lessons' };

export default async function EditTreePage() {
  const gate = await requireRole('editor');
  if (!gate.ok) return gate.view;

  const result = await callRpc<EditTree>(
    await serverSupabase(),
    'page_edit_tree',
  );
  if (!result.ok)
    return (
      <EditorLoadError
        error={result.error}
        what="lessons"
        retryHref={editTreePath()}
        backHref={learnPath()}
        backLabel="Back to learning"
      />
    );

  const tree = treeView(result.data);
  const today = utcToday(new Date());
  const { counts } = tree;

  return (
    <div className="editor-page">
      <PageHeader
        eyebrow="Edit"
        title="Lessons"
        description="Every course you can edit, unit by unit. Open a lesson to write its phrases and exercises, then send it for review."
      />

      <StatGrid>
        <Stat label="Lessons" value={tree.lessonCount} />
        <Stat label="Drafts" value={counts.draft} hint="Still being written" />
        <Stat
          label="In review"
          value={counts.in_review}
          hint="Waiting for a reviewer"
        />
        <Stat
          label="Need changes"
          value={counts.changes_requested + counts.rejected}
          hint="A reviewer sent them back"
        />
        <Stat label="Approved" value={counts.approved} />
      </StatGrid>

      {tree.languages.map((language) => (
        <LanguageSection
          key={language.code}
          language={language}
          isAdmin={tree.isAdmin}
          today={today}
        />
      ))}
    </div>
  );
}

function LanguageSection({
  language,
  isAdmin,
  today,
}: {
  language: TreeLanguageView;
  isAdmin: boolean;
  today: string;
}) {
  const headingId = `lang-${language.code}`;
  const hasDemo = language.courses.some((c) =>
    c.units.some((u) => u.lessons.some((l) => l.demo)),
  );
  return (
    <section className="editor-language" aria-labelledby={headingId}>
      <header className="editor-language-header">
        <div>
          <h2 id={headingId}>
            {language.name}{' '}
            <NativeText
              text={language.native_name}
              lang={language.code}
              dir={language.direction}
            />
          </h2>
          <StatusCounts counts={language.counts} />
        </div>
        {language.publish_gate === 'blocked' && (
          <StatusBadge status="gated" label="Held back from learners" />
        )}
      </header>

      <ul className="editor-varieties" aria-label="Varieties">
        {language.varieties.map((variety) => (
          <li key={variety.id} className="editor-variety">
            <span className="editor-variety-name">{variety.name}</span>
            <span className="editor-variety-meta">
              {variety.reviewers === 0
                ? 'No reviewer yet'
                : `${variety.reviewers} ${variety.reviewers === 1 ? 'reviewer' : 'reviewers'}`}
            </span>
            {variety.publish_gate === 'blocked' && (
              <StatusBadge status="gated" label="Held back" />
            )}
            {isAdmin && (
              <GateControl
                type="variety"
                id={variety.id}
                gate={variety.publish_gate}
                name={variety.name}
              />
            )}
          </li>
        ))}
      </ul>

      {language.demo_period && hasDemo && (
        <div className="editor-demo-note">
          <p>
            <StatusBadge status="demo" /> Demo lessons are starter content:
            read-only, never reviewed, and replaced by reviewed lessons.
            {language.demo_period.live
              ? ` They stay live until ${formatDay(language.demo_period.sunset)}.`
              : ' They are never shown to learners.'}
          </p>
          {isAdmin && language.demo_period.live && (
            <DemoSunsetForm
              language={language.code}
              languageName={language.name}
              sunset={language.demo_period.sunset}
              today={today}
            />
          )}
        </div>
      )}

      {language.courses.length === 0 ? (
        <EmptyState title={`No ${language.name} courses yet`}>
          <p>
            Courses come from the curriculum. Ask an admin to add one, then you
            can write its units and lessons here.
          </p>
        </EmptyState>
      ) : (
        language.courses.map((course) => (
          <CourseCard
            key={course.id}
            course={course}
            language={language}
            isAdmin={isAdmin}
          />
        ))
      )}
    </section>
  );
}

function CourseCard({
  course,
  language,
  isAdmin,
}: {
  course: TreeCourseView;
  language: TreeLanguageView;
  isAdmin: boolean;
}) {
  const unitIds = course.units.map((u) => u.id);
  return (
    <article className="editor-course" aria-labelledby={`course-${course.id}`}>
      <header className="editor-course-header">
        <div>
          <h3 id={`course-${course.id}`}>{course.name}</h3>
          <p className="editor-muted">
            {course.varietyName} · {course.units.length}{' '}
            {course.units.length === 1 ? 'unit' : 'units'}
          </p>
        </div>
        <StatusCounts counts={course.counts} />
      </header>

      {course.units.length === 0 ? (
        <EmptyState title="No units yet">
          <p>Start with a unit: a theme and a goal for a few lessons.</p>
        </EmptyState>
      ) : (
        <ol className="editor-units">
          {course.units.map((unit) => (
            <UnitBlock
              key={unit.id}
              unit={unit}
              course={course}
              unitIds={unitIds}
              language={language}
              isAdmin={isAdmin}
            />
          ))}
        </ol>
      )}

      <NewUnitForm courseId={course.id} courseName={course.name} />
    </article>
  );
}

function UnitBlock({
  unit,
  course,
  unitIds,
  language,
  isAdmin,
}: {
  unit: TreeUnitView;
  course: TreeCourseView;
  unitIds: string[];
  language: TreeLanguageView;
  isAdmin: boolean;
}) {
  const label = `Unit ${unit.position}`;
  const lessonIds = unit.lessons.map((l) => l.id);
  const hasDemo = unit.lessons.some((l) => l.demo);
  return (
    <li className="editor-unit">
      <div className="editor-unit-header">
        <div className="editor-unit-heading">
          <p className="editor-unit-number">{label}</p>
          <h4>{unit.title}</h4>
          <p className="editor-muted">{unit.goal}</p>
        </div>
        <div className="editor-unit-tools">
          {unit.publish_gate === 'blocked' && (
            <StatusBadge status="gated" label={gateLabel(unit.publish_gate)} />
          )}
          <ReorderButtons
            parentType="course"
            parentId={course.id}
            ids={unitIds}
            id={unit.id}
            label={`${label}, ${unit.title}`}
          />
          {isAdmin && (
            <GateControl
              type="unit"
              id={unit.id}
              gate={unit.publish_gate}
              name={label}
            />
          )}
          {!hasDemo && (
            <RetireButton
              type="unit"
              id={unit.id}
              what={`${label}, “${unit.title}”`}
              description={
                unit.lessons.length > 0
                  ? `Its ${unit.lessons.length} ${unit.lessons.length === 1 ? 'lesson goes' : 'lessons go'} with it, with their phrases and exercises. Nothing is deleted: the history stays.`
                  : undefined
              }
            />
          )}
        </div>
      </div>

      {unit.lessons.length === 0 ? (
        <p className="editor-unit-empty">No lessons in this unit yet.</p>
      ) : (
        <ol className="editor-lessons">
          {unit.lessons.map((lesson) => (
            <li key={lesson.id} className="editor-lesson-row">
              <span className="editor-lesson-number" aria-hidden="true">
                {lesson.position}
              </span>
              <div className="editor-lesson-main-cell">
                <Link
                  href={editLessonPath(lesson.id)}
                  className="editor-lesson-link"
                >
                  {lesson.title}
                </Link>
                <p className="editor-muted">
                  {lesson.items} {lesson.items === 1 ? 'phrase' : 'phrases'} ·{' '}
                  {lesson.exercises}{' '}
                  {lesson.exercises === 1 ? 'exercise' : 'exercises'}
                  {lesson.variety_id !== course.variety_id &&
                    ` · ${
                      language.varieties.find((v) => v.id === lesson.variety_id)
                        ?.name ?? lesson.variety_id
                    }`}
                </p>
              </div>
              <div className="editor-lesson-tools">
                <StatusBadge status={lesson.status} />
                {lesson.publish_gate === 'blocked' && (
                  <StatusBadge status="gated" label="Held back" />
                )}
                <ReorderButtons
                  parentType="unit"
                  parentId={unit.id}
                  ids={lessonIds}
                  id={lesson.id}
                  label={lesson.title}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      <NewLessonForm
        unitId={unit.id}
        unitLabel={`${label}, “${unit.title}”`}
        varieties={language.varieties.map((v) => ({ id: v.id, name: v.name }))}
        defaultVariety={course.variety_id}
      />
    </li>
  );
}
