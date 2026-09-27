import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/console/empty-state';
import { PageHeader } from '@/components/console/page-header';
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
  type EditorStatus,
  type StatusCounts as Counts,
  type TreeCourseView,
  type TreeLanguageView,
  type TreeUnitView,
  type TreeView,
} from '@/lib/console/editor';
import { editLessonPath, editTreePath, learnPath } from '@/lib/console/paths';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Lessons' };

/** The groups the stats count, each lesson in exactly one. */
const STAT_GROUPS: {
  key: string;
  label: string;
  statuses: EditorStatus[];
}[] = [
  { key: 'draft', label: 'Drafts', statuses: ['draft'] },
  { key: 'in-review', label: 'In review', statuses: ['in_review'] },
  {
    key: 'changes',
    label: 'Need changes',
    statuses: ['changes_requested', 'rejected'],
  },
  { key: 'approved', label: 'Approved', statuses: ['approved'] },
  { key: 'starter', label: 'Starter', statuses: ['demo'] },
  { key: 'retired', label: 'Retired', statuses: ['retired'] },
];

const groupOf = (status: EditorStatus) =>
  STAT_GROUPS.find((g) => g.statuses.includes(status))?.key ?? status;

/** The first lesson of each stat group, in tree order: where its stat jumps. */
function firstOfEach(tree: TreeView): Map<string, string> {
  const firsts = new Map<string, string>();
  for (const language of tree.languages)
    for (const course of language.courses)
      for (const unit of course.units)
        for (const lesson of unit.lessons) {
          const group = groupOf(lesson.status);
          if (!firsts.has(group)) firsts.set(group, lesson.id);
        }
  return firsts;
}

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
  const firsts = firstOfEach(tree);
  // Languages with courses first (treeView orders them so); the rest are
  // one quiet line each at the foot, not a big empty panel above the work.
  const working = tree.languages.filter((l) => l.courses.length > 0);
  const empty = tree.languages.filter((l) => l.courses.length === 0);

  return (
    <div className="editor-page">
      <PageHeader
        eyebrow="Edit"
        title="Lessons"
        description="Open a lesson to write its phrases and exercises, then send it for review."
      />

      <StatusStats
        total={tree.lessonCount}
        counts={tree.counts}
        firsts={firsts}
      />

      {working.map((language) => (
        <LanguageSection
          key={language.code}
          language={language}
          isAdmin={tree.isAdmin}
          today={today}
          firsts={firsts}
          showCounts={working.length > 1}
        />
      ))}

      {empty.length > 0 && (
        <section
          className="editor-languages-empty"
          aria-label="Languages without courses"
        >
          {empty.map((language, i) => (
            <p key={language.code} className="editor-language-empty">
              <strong>{language.name}</strong>{' '}
              <NativeText
                text={language.native_name}
                lang={language.code}
                dir={language.direction}
              />
              : no courses yet.
              {i === empty.length - 1 &&
                ' New courses are added by the PoliLingo team.'}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}

/**
 * How many lessons are in each state. The groups add up to the total, and
 * each count jumps to the first lesson in that state. On a phone they are
 * one row of chips.
 */
function StatusStats({
  total,
  counts,
  firsts,
}: {
  total: number;
  counts: Counts;
  firsts: Map<string, string>;
}) {
  const groups = STAT_GROUPS.map((g) => ({
    ...g,
    count: g.statuses.reduce((sum, s) => sum + counts[s], 0),
    // Starter and retired lessons are the exception: no tile when none.
  })).filter((g) => g.count > 0 || !['starter', 'retired'].includes(g.key));
  return (
    <nav className="editor-stats" aria-label="Lessons by status">
      <ul>
        <li>
          <span className="editor-stat editor-stat-total">
            <span className="editor-stat-value">{total}</span>
            <span className="editor-stat-label">Lessons</span>
          </span>
        </li>
        {groups.map((g) => {
          const body = (
            <>
              <span className="editor-stat-value">{g.count}</span>
              <span className="editor-stat-label">{g.label}</span>
            </>
          );
          const first = firsts.get(g.key);
          return (
            <li key={g.key}>
              {g.count > 0 && first ? (
                <a
                  href={`#lesson-${first}`}
                  className="editor-stat editor-stat-link"
                >
                  {body}
                </a>
              ) : (
                <span className="editor-stat">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function LanguageSection({
  language,
  isAdmin,
  today,
  firsts,
  showCounts,
}: {
  language: TreeLanguageView;
  isAdmin: boolean;
  today: string;
  firsts: Map<string, string>;
  /**
   * Counts at a level only when it has siblings: with one language (or one
   * course) they would repeat the numbers above them.
   */
  showCounts: boolean;
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
          {showCounts && <StatusCounts counts={language.counts} />}
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
            <StatusBadge status="demo" /> lessons are read-only and never
            reviewed; reviewed lessons replace them.
            {language.demo_period.live
              ? ` Live until ${formatDay(language.demo_period.sunset)}.`
              : ' Never shown to learners.'}
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

      {language.courses.map((course) => (
        <CourseCard
          key={course.id}
          course={course}
          language={language}
          isAdmin={isAdmin}
          firsts={firsts}
          showCounts={language.courses.length > 1}
        />
      ))}
    </section>
  );
}

function CourseCard({
  course,
  language,
  isAdmin,
  firsts,
  showCounts,
}: {
  course: TreeCourseView;
  language: TreeLanguageView;
  isAdmin: boolean;
  firsts: Map<string, string>;
  showCounts: boolean;
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
        {showCounts && <StatusCounts counts={course.counts} />}
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
              firsts={firsts}
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
  firsts,
}: {
  unit: TreeUnitView;
  course: TreeCourseView;
  unitIds: string[];
  language: TreeLanguageView;
  isAdmin: boolean;
  firsts: Map<string, string>;
}) {
  const label = `Unit ${unit.position}`;
  const lessonIds = unit.lessons.map((l) => l.id);
  const hasDemo = unit.lessons.some((l) => l.demo);
  return (
    <li id={`unit-${unit.id}`} className="editor-unit">
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
            <li
              key={lesson.id}
              id={
                firsts.get(groupOf(lesson.status)) === lesson.id
                  ? `lesson-${lesson.id}`
                  : undefined
              }
              className="editor-lesson-row"
            >
              <span className="editor-lesson-number" aria-hidden="true">
                {lesson.position}
              </span>
              <div className="editor-lesson-main-cell">
                {/* Stretched over the whole row (CSS), under the tools. */}
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
