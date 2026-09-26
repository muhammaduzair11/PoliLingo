/**
 * lib/content.ts as live bindings (docs/platform.md 4.7): activating a newer
 * learner copy changes what every screen and progress helper reads, and
 * resetting puts the baseline back. What is fixed at build time (the
 * redirects, hiddenCourseSlugs) never moves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as content from '../lib/content.ts';
import {
  activateRelease,
  baselineCopy,
  baselineCourses,
  getCourse,
  hiddenCourseSlugs,
  knownLesson,
  lessonSize,
  missingLessonRedirect,
  resetToBaseline,
  selectedCourse,
} from '../lib/content.ts';
import { contentRedirects } from '../lib/redirects.ts';
import {
  advanceSession,
  initialState,
  newSession,
  recordAnswer,
} from '../lib/progress.ts';
import {
  learnerContentHash,
  verifyLearnerCopy,
} from '../lib/release-verify.ts';

const NEXT = 'content@2026.10.1';

/**
 * The baseline as a later release might change it: the first Pashto lesson
 * retitled and one exercise longer, and the last Pashto lesson retired
 * (with its keymap rows, as the build drops them).
 */
function nextCopy() {
  const copy = structuredClone(baselineCopy);
  copy.release = NEXT;
  copy.commit = null;
  const pashto = copy.courses.find((c) => c.language === 'ps');
  const lessons = pashto.units.flatMap((u) => u.lessons);
  const grown = lessons[0];
  const retired = lessons.at(-1);
  grown.title = 'Hello again';
  grown.exercises.push({
    ...grown.exercises.find((e) => e.kind === 'meaning'),
    id: 'ps-exr-fff001',
  });
  for (const unit of pashto.units)
    unit.lessons = unit.lessons.filter((l) => l.id !== retired.id);
  const gone = new Set(retired.items.map((i) => i.id));
  copy.keymap.lessons = copy.keymap.lessons.filter(
    (row) => row.lesson_id !== retired.id,
  );
  copy.keymap.items = copy.keymap.items.filter((row) => !gone.has(row.item_id));
  copy.contentHash = learnerContentHash(copy);
  const verified = verifyLearnerCopy(copy);
  assert.equal(verified.ok, true, verified.reason);
  return { copy, grown: grown.id, retired: retired.id };
}

test.afterEach(() => resetToBaseline());

test('the baseline is active until something is activated', () => {
  assert.equal(content.learnerCopy, baselineCopy);
  assert.equal(content.contentVersion, baselineCopy.release);
  assert.equal(content.courses, baselineCourses);
});

test('activateRelease makes every live binding and reader answer from the new copy', () => {
  const { copy, grown, retired } = nextCopy();
  const baselineSize = lessonSize(grown);
  const retiredLegacy = baselineCopy.keymap.lessons.find(
    (row) => row.lesson_id === retired,
  )?.legacy_key;

  activateRelease(copy);

  assert.equal(content.learnerCopy, copy);
  assert.equal(content.contentVersion, NEXT);
  assert.notEqual(content.courses, baselineCourses);
  const pashto = getCourse('pashto');
  assert.ok(pashto);
  assert.equal(
    content.courses.find((c) => c.id === 'pashto'),
    pashto,
  );
  assert.equal(pashto.lessons[0].title, 'Hello again');
  assert.equal(pashto.lessons[0].exercises.length, baselineSize + 1);
  assert.equal(
    pashto.lessons.some((l) => l.id === retired),
    false,
  );
  assert.equal(selectedCourse('pashto'), pashto);
  assert.equal(lessonSize(grown), baselineSize + 1);
  assert.equal(knownLesson(retired), false);
  assert.equal(lessonSize(retired), undefined);
  // A bookmark of the retired lesson lands on its course's map.
  assert.equal(missingLessonRedirect('pashto', retired), '/learn/pashto');
  assert.equal(missingLessonRedirect('pashto', grown), null);
  if (retiredLegacy)
    assert.equal(content.legacyLessonIds[retiredLegacy], undefined);
  // Urdu, untouched, is still there.
  assert.ok(getCourse('urdu'));
});

test("advanceSession's default release is the active one", () => {
  const { copy, grown } = nextCopy();
  activateRelease(copy);
  const size = lessonSize(grown);
  let state = {
    ...initialState('device'),
    sessions: { [grown]: newSession('pashto', grown, 'run-1', size) },
  };
  for (let q = 0; q < size; q++) {
    state.sessions[grown] = recordAnswer(state.sessions[grown], true);
    state = advanceSession(state, grown, '2026-09-28');
  }
  assert.equal(state.sessions[grown].done, true);
  assert.equal(state.completed[grown], NEXT);
});

test('what is fixed at build time reads the baseline, whatever is active', () => {
  const before = {
    hidden: [...hiddenCourseSlugs],
    redirects: JSON.stringify(contentRedirects()),
  };
  activateRelease(nextCopy().copy);
  assert.deepEqual(hiddenCourseSlugs, before.hidden);
  assert.equal(JSON.stringify(contentRedirects()), before.redirects);
});

test('resetToBaseline restores the baseline exactly', () => {
  const grownBaseline = baselineCopy.courses[0].units[0].lessons[0];
  const legacy = { ...content.legacyLessonIds };
  activateRelease(nextCopy().copy);
  resetToBaseline();
  assert.equal(content.learnerCopy, baselineCopy);
  assert.equal(content.contentVersion, baselineCopy.release);
  assert.equal(content.courses, baselineCourses);
  assert.deepEqual(content.legacyLessonIds, legacy);
  assert.equal(lessonSize(grownBaseline.id), grownBaseline.exercises.length);
  for (const lesson of baselineCopy.courses.flatMap((c) =>
    c.units.flatMap((u) => u.lessons),
  ))
    assert.equal(knownLesson(lesson.id), true);
});

test('activating the baseline is the same as resetting', () => {
  activateRelease(nextCopy().copy);
  activateRelease(baselineCopy);
  assert.equal(content.learnerCopy, baselineCopy);
  assert.equal(content.courses, baselineCourses);
  assert.equal(content.contentVersion, baselineCopy.release);
});

test('a later activation replaces an earlier one', () => {
  activateRelease(nextCopy().copy);
  const later = structuredClone(nextCopy().copy);
  later.release = 'content@2026.10.2';
  activateRelease(later);
  assert.equal(content.contentVersion, 'content@2026.10.2');
  assert.equal(content.learnerCopy, later);
});
