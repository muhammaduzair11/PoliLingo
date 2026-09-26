// What the screens decide, kept in lib/ so it can be tested without React
// (ADR-0013): which course a learner is returned to, where a lesson the
// release no longer holds leads, how the learning map counts and draws a
// course of any length, the variety a course is keyed by, the credits line,
// the landing page's try-it question, and wording that depends on how much
// the release holds. The screens themselves are checked by hand (docs/validation.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  courses,
  getCourse,
  hiddenCourseSlugs,
  missingLessonRedirect,
  phraseSources,
  selectedCourse,
} from '../lib/content.ts';
import {
  courseProgress,
  mapPath,
  stopClass,
  stopIcon,
  TROPHY_X,
} from '../lib/learning-map.ts';
import { initialState, parseState } from '../lib/progress.ts';
import { curlyQuotes, exclaimed, landingTeaser } from '../lib/teaser.ts';
import { countWord, listJoin, plural } from '../lib/words.ts';

const FILE = JSON.parse(
  readFileSync(new URL('../content/release.json', import.meta.url), 'utf8'),
);

/** A course of `n` lessons, with made-up ids, for counts the release does not have today. */
const courseOf = (n) => ({
  id: 'pashto',
  lessons: Array.from({ length: n }, (_, i) => ({ id: `xx-lsn-${i}` })),
});

// ---------------------------------------------------------------------------
// The remembered course
// ---------------------------------------------------------------------------

test('the remembered course is resolved when it is read, and only a visible one counts', () => {
  for (const c of courses) assert.equal(selectedCourse(c.id), c);
  // Nothing chosen yet, a language the release does not hold (a Hindko
  // learner from the MVP), and a slug no build ever had: all undefined, so
  // the screens offer the language picker and choose nothing for them.
  assert.equal(selectedCourse(null), undefined);
  assert.equal(selectedCourse(''), undefined);
  for (const slug of [...hiddenCourseSlugs, 'klingon'])
    assert.equal(selectedCourse(slug), undefined, slug);
  assert.ok(hiddenCourseSlugs.includes('hindko'));
});
test('a stored choice the release does not show is kept as it is', () => {
  // The read-time helper never writes, and reading a record does not change
  // `selected` either: the day Hindko is in a release, it is their course.
  const stored = { ...initialState('device'), selected: 'hindko' };
  const read = parseState(JSON.stringify(stored));
  assert.equal(read.selected, 'hindko');
  assert.equal(selectedCourse(read.selected), undefined);
});

test('a lesson the release no longer holds opens its course’s map, not “not found”', () => {
  for (const c of courses) {
    // A retired lesson, or an old bookmark or remembered redirect to one.
    assert.equal(
      missingLessonRedirect(c.id, `${c.lang}-lsn-000000`),
      `/learn/${c.id}`,
    );
    // Every lesson the release holds plays as usual.
    for (const l of c.lessons)
      assert.equal(missingLessonRedirect(c.id, l.id), null);
  }
  // A course learners cannot see stays not found (or its own redirect).
  for (const slug of [...hiddenCourseSlugs, 'klingon'])
    assert.equal(missingLessonRedirect(slug, 'any-lesson'), null);
});

// ---------------------------------------------------------------------------
// Varieties: keyed by id, labelled for learners
// ---------------------------------------------------------------------------

test('each course carries its variety id, and the label is only a label', () => {
  const labels = new Map(FILE.varieties.map((v) => [v.id, v]));
  for (const c of courses) {
    const file = FILE.courses.find((x) => x.id === c.courseId);
    assert.equal(c.varietyId, file.variety);
    assert.match(c.varietyId, new RegExp(`^${c.lang}-var-[a-z0-9-]+$`));
    const row = labels.get(c.varietyId);
    assert.ok(row, `${c.varietyId} has no variety row`);
    assert.equal(row.language, c.lang);
    assert.equal(c.varietyLabel, row.learner_label);
    assert.ok(c.varietyLabel.trim(), `${c.varietyId} has no learner label`);
    // Nothing that routes or is stored is made from the label.
    for (const key of [c.id, c.courseId, ...c.lessons.map((l) => l.id)])
      assert.ok(!key.includes(c.varietyLabel), key);
  }
});

// ---------------------------------------------------------------------------
// The learning map, for any number of lessons
// ---------------------------------------------------------------------------

test('course progress counts the release’s lessons, for one, three or eight', () => {
  for (const n of [1, 3, 8]) {
    const course = courseOf(n);
    const none = courseProgress({}, course);
    assert.deepEqual(none, {
      done: 0,
      total: n,
      finished: false,
      next: course.lessons[0],
    });

    const completed = {};
    for (const [i, l] of course.lessons.entries()) {
      completed[l.id] = 'content@2026.09.1';
      const p = courseProgress(completed, course);
      assert.equal(p.done, i + 1);
      assert.equal(p.finished, i === n - 1, `${i + 1} of ${n}`);
      // The next lesson is the first not done; once all are, the first.
      assert.equal(p.next, course.lessons[i + 1] ?? course.lessons[0]);
    }
    // A completion kept for a lesson this release does not have is not
    // counted, so it can never finish a course.
    const retired = courseProgress({ 'xx-lsn-gone': 'mvp' }, course);
    assert.equal(retired.done, 0);
    assert.equal(retired.finished, false);
  }
  // A release that adds a lesson un-finishes the course; one with none is
  // never finished.
  const three = Object.fromEntries(
    courseOf(3).lessons.map((l) => [l.id, 'mvp']),
  );
  assert.equal(courseProgress(three, courseOf(3)).finished, true);
  assert.equal(courseProgress(three, courseOf(4)).finished, false);
  assert.equal(courseProgress({}, courseOf(0)).finished, false);
  assert.equal(courseProgress({}, courseOf(0)).next, undefined);
});
test('the map path is the original drawing for three stops', () => {
  assert.deepEqual(mapPath(3), {
    d: 'M190 25 C390 120 35 160 145 265 S350 360 210 490',
    height: 530,
  });
  // The drawing ends at the trophy, which every other count ends at too.
  assert.equal(TROPHY_X, 210);
});
test('the map path runs from the first stop to the trophy, for any count', () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 12]) {
    const { d, height } = mapPath(n);
    const numbers = d.match(/-?\d+(\.\d+)?/g).map(Number);
    const points = [];
    for (let i = 0; i < numbers.length; i += 2)
      points.push([numbers[i], numbers[i + 1]]);
    assert.ok(d.startsWith('M190 25 C'), d);
    // Two bends for every three stops, as the drawing has, and at least one.
    assert.equal(
      (d.match(/[CS]/g) ?? []).length,
      Math.max(1, Math.round((2 * n) / 3)),
      `${n} stops`,
    );
    for (const [x, y] of points) {
      assert.ok(Number.isFinite(x) && x >= 0 && x <= 400, `${n}: x ${x}`);
      assert.ok(Number.isFinite(y) && y >= 0 && y <= height, `${n}: y ${y}`);
    }
    // One stop (155 units) per lesson, ending where the trophy sits, across
    // and down, with the drawing's space below it.
    const end = points[points.length - 1];
    assert.equal(end[0], TROPHY_X, `${n} stops`);
    assert.equal(end[1], 25 + 155 * n, `${n} stops`);
    assert.equal(height, end[1] + 40, `${n} stops`);
  }
});
test('every stop gets an icon and a place on the map, whatever the count', () => {
  assert.equal(stopIcon(0, 1), 'star');
  assert.deepEqual(
    [0, 1, 2].map((i) => stopIcon(i, 3)),
    ['star', 'heart', 'flag'],
  );
  const eight = Array.from({ length: 8 }, (_, i) => stopIcon(i, 8));
  assert.deepEqual(eight, [
    'star',
    'heart',
    'heart',
    'heart',
    'heart',
    'heart',
    'heart',
    'flag',
  ]);
  // The three positions repeat, and the stylesheet places each of them.
  const css = readFileSync(
    new URL('../app/styles/dashboard.css', import.meta.url),
    'utf8',
  );
  const classes = new Set(Array.from({ length: 8 }, (_, i) => stopClass(i)));
  assert.deepEqual([...classes], ['stop-0', 'stop-1', 'stop-2']);
  for (const name of classes) assert.ok(css.includes(`.${name} {`), name);
  // The path and the area grow with the lesson count, from what they are
  // for three.
  assert.match(css, /min-height: calc\(535px \+ \(var\(--stops, 3\) - 3\)/);
  assert.match(css, /height: calc\(420px \+ \(var\(--stops, 3\) - 3\)/);
});

// ---------------------------------------------------------------------------
// Credits and wording
// ---------------------------------------------------------------------------

test('the credits name where each visible language’s phrases come from', () => {
  for (const c of courses) {
    const sources = phraseSources(c);
    assert.ok(sources.length >= 1, c.id);
    assert.equal(new Set(sources).size, sources.length, c.id);
    // Every phrase is credited, by its own citation or by the one it adds a
    // note to.
    for (const p of c.lessons.flatMap((l) => l.phrases))
      assert.ok(
        sources.some((s) => p.source === s || p.source.startsWith(`${s};`)),
        `${p.id}: ${p.source}`,
      );
  }
  const phrase = (source) => ({ source });
  const course = {
    lessons: [
      { phrases: ['A', 'A; the name inserted', 'B'].map(phrase) },
      { phrases: ['A', 'C; a note with no plain C'].map(phrase) },
    ],
  };
  assert.deepEqual(phraseSources(course), [
    'A',
    'B',
    'C; a note with no plain C',
  ]);
});
test('the landing page’s try-it question comes from a course the release holds', () => {
  const teaser = landingTeaser(courses);
  // There is a card whenever some lesson asks for a phrase with three choices.
  const asks = courses.some((c) =>
    c.lessons.some((l) =>
      l.exercises.some(
        (e) => e.kind === 'translation' && e.options.length >= 3,
      ),
    ),
  );
  assert.equal(!!teaser, asks);
  if (!teaser) return;
  // A visible course, one of its lessons, and a question that lesson asks.
  assert.equal(getCourse(teaser.course.id), teaser.course);
  assert.ok(teaser.course.lessons.includes(teaser.lesson));
  const exercise = teaser.lesson.exercises.find(
    (e) => e.phrase === teaser.answer && e.kind === 'translation',
  );
  assert.ok(exercise);
  assert.equal(teaser.prompt, curlyQuotes(exercise.prompt));
  // Three choices from the lesson, the answer among them where the lesson
  // puts it, each a phrase the lesson teaches.
  assert.equal(teaser.options.length, 3);
  assert.equal(new Set(teaser.options).size, 3);
  assert.ok(teaser.options.includes(teaser.answer));
  for (const p of teaser.options) assert.ok(teaser.lesson.phrases.includes(p));
  assert.deepEqual(
    teaser.options,
    exercise.options.filter((p) => teaser.options.includes(p)),
  );
  // The course the card was drawn for while the release holds it...
  if (getCourse('urdu')) assert.equal(teaser.course.id, 'urdu');
  // ...and otherwise another course; with no question at all, no card.
  const withoutUrdu = courses.filter((c) => c.id !== 'urdu');
  const other = landingTeaser(withoutUrdu);
  if (other) assert.ok(withoutUrdu.includes(other.course));
  assert.equal(landingTeaser([]), undefined);
  const noQuestions = courses.map((c) => ({
    ...c,
    lessons: c.lessons.map((l) => ({
      ...l,
      exercises: l.exercises.filter((e) => e.kind !== 'translation'),
    })),
  }));
  assert.equal(landingTeaser(noQuestions), undefined);
  // Its wording.
  assert.equal(
    curlyQuotes('How do you say "thank you"?'),
    'How do you say “thank you”?',
  );
  assert.equal(exclaimed('Shukriya'), 'Shukriya!');
  assert.equal(exclaimed('Tsanga ye?'), 'Tsanga ye!');
  assert.equal(exclaimed('Manana.'), 'Manana!');
});
test('wording that depends on the release reads right for any count', () => {
  assert.equal(countWord(1), 'One');
  assert.equal(countWord(2), 'Two');
  assert.equal(countWord(3), 'Three');
  assert.equal(countWord(8), 'Eight');
  assert.equal(countWord(12), '12');
  assert.equal(plural(1, 'lesson'), 'lesson');
  assert.equal(plural(0, 'lesson'), 'lessons');
  assert.equal(plural(8, 'LESSON'), 'LESSONS');
  assert.equal(listJoin([]), '');
  assert.equal(listJoin(['Pashto']), 'Pashto');
  assert.equal(listJoin(['Pashto', 'Urdu']), 'Pashto and Urdu');
  assert.equal(
    listJoin(['Pashto', 'Hindko', 'Urdu']),
    'Pashto, Hindko and Urdu',
  );
  // The site description names the release's languages and no others.
  const names = listJoin(courses.map((c) => c.name));
  for (const c of courses) assert.ok(names.includes(c.name));
  assert.ok(!/Hindko/.test(names));
  assert.equal(getCourse('hindko'), undefined);
});
