/**
 * The committed learner copy, content/release.json, and what the app makes
 * of it.
 *
 * Everything here is an invariant: true of any release the content
 * repository may cut, never a count from today's demo lessons. A new
 * release that adds, retires or resizes lessons keeps this file green; one
 * that breaks the contract between the two repositories turns it red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match.js';
import {
  LEARNER_FORMAT,
  LEARNER_SCHEMA_VERSION,
  contentVersion,
  courses,
  evaluate,
  getCourse,
  hiddenCourseSlugs,
  isReleaseName,
  knownLesson,
  learnerCopy,
  legacyLessonIds,
  lessonSize,
  productionReleaseProblem,
  readLearnerCopy,
  shuffled,
} from '../lib/content.ts';
import { contentRedirects } from '../lib/redirects.ts';
import nextConfig from '../next.config.ts';

const RAW = readFileSync(
  new URL('../content/release.json', import.meta.url),
  'utf8',
);
const FILE = JSON.parse(RAW);
const LESSONS = FILE.courses.flatMap((c) =>
  c.units.flatMap((u) => u.lessons.map((l) => ({ course: c, lesson: l }))),
);

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/**
 * The content repository's canonicalJson() and contentHash(), from its
 * scripts/build.mjs, reproduced exactly: keys sorted at every depth by
 * JavaScript's default sort, arrays in their order, no whitespace, an
 * undefined dropped from an object and null in an array, UTF-8, SHA-256 in
 * lowercase hex after "sha256-". Only languages, varieties, courses and
 * keymap are hashed.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? 'null' : canonicalJson(entry))).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function contentHash({ languages, varieties, courses, keymap }) {
  const digest = createHash('sha256')
    .update(canonicalJson({ languages, varieties, courses, keymap }), 'utf8')
    .digest('hex');
  return `sha256-${digest}`;
}

test('release.json is the learner copy exactly as the content build wrote it', () => {
  // A hand edit to the content changes the hash; the file must be changed
  // upstream and re-released instead.
  assert.equal(contentHash(FILE), FILE.contentHash);
  // Byte for byte as the build serialises it, so regenerating it from the same
  // tag gives no diff, and no formatter has been over it.
  assert.equal(RAW, JSON.stringify(FILE, null, 2) + '\n');
  assert.deepEqual(learnerCopy, FILE);
  assert.equal(FILE.format, LEARNER_FORMAT);
  assert.equal(FILE.schemaVersion, LEARNER_SCHEMA_VERSION);
  assert.equal(contentVersion, FILE.release);
  // A release, content@YYYY.MM.N, or a development build of content.
  assert.match(
    FILE.release,
    /^content@\d{4}\.\d{2}\.(\d+|dev\+[0-9a-f]{7}(\.dirty)?)$/,
  );
  assert.match(FILE.commit, /^[0-9a-f]{40}$/);
});
test('the hash notices a changed phrase, and ignores key order', () => {
  const edited = structuredClone(FILE);
  edited.courses[0].units[0].lessons[0].items[0].meaning += '!';
  assert.notEqual(contentHash(edited), FILE.contentHash);
  const reordered = Object.fromEntries(Object.entries(FILE).reverse());
  assert.equal(contentHash(reordered), FILE.contentHash);
  assert.equal(
    canonicalJson({ b: 1, a: [{ d: 'é', c: undefined }, undefined, null] }),
    '{"a":[{"d":"é"},null,null],"b":1}',
  );
});
test('release.json holds only the learner copy’s fields', () => {
  // The same list as the LearnerCopy type in lib/content.ts. Anything else
  // (review state, licences, source records, gates, planning fields) belongs
  // to the private artefact and must never be committed here.
  const allowed = {
    copy: 'format schemaVersion release commit contentHash languages varieties courses keymap',
    language: 'code name native_name direction',
    variety: 'id language learner_label',
    course: 'id language variety name tagline units',
    unit: 'id order title lessons',
    lesson: 'id order title subtitle objective variety items exercises',
    item: 'id native romanisation meaning context usage_note variety citation',
    exercise: 'id kind item prompt options',
    keymap: 'lessons courses items',
    keymapLesson: 'legacy_key lesson_id course_id',
    keymapCourse: 'legacy_id course_id',
    keymapItem: 'legacy_ref item_id',
  };
  const only = (level, record) => {
    const extra = Object.keys(record).filter(
      (key) => !allowed[level].split(' ').includes(key),
    );
    assert.deepEqual(extra, [], `${level} ${record.id ?? ''}`);
  };
  only('copy', FILE);
  FILE.languages.forEach((x) => only('language', x));
  FILE.varieties.forEach((x) => only('variety', x));
  for (const c of FILE.courses) {
    only('course', c);
    for (const u of c.units) {
      only('unit', u);
      for (const l of u.lessons) {
        only('lesson', l);
        l.items.forEach((x) => only('item', x));
        l.exercises.forEach((x) => only('exercise', x));
      }
    }
  }
  only('keymap', FILE.keymap);
  FILE.keymap.lessons.forEach((x) => only('keymapLesson', x));
  FILE.keymap.courses.forEach((x) => only('keymapCourse', x));
  FILE.keymap.items.forEach((x) => only('keymapItem', x));
});
test('a file that is not a learner copy is refused with a reason', () => {
  const ok = { ...FILE };
  assert.equal(readLearnerCopy(ok), ok);
  for (const [file, says] of [
    [{ ...FILE, format: 'polilingo.content@1' }, /polilingo\.content@1/],
    [{ ...FILE, schemaVersion: 2 }, /schemaVersion 2/],
    [{ ...FILE, format: undefined }, /format undefined/],
    [null, /not a learner copy/],
    ['text', /not a learner copy/],
    [[], /not a learner copy/],
  ])
    assert.throws(() => readLearnerCopy(file), says);
});
test('no Hindko in the learner copy: no language, id or keymap row', () => {
  // Hindko is not shown until it is reviewed (decided 2026-09-24), so the
  // content build leaves it out entirely. The day it is published, this test
  // changes with that decision.
  const ids = [
    ...FILE.languages.map((x) => x.code),
    ...FILE.varieties.flatMap((x) => [x.id, x.language]),
    ...FILE.courses.flatMap((c) => [
      c.id,
      c.language,
      c.variety,
      ...c.units.map((u) => u.id),
    ]),
    ...LESSONS.flatMap(({ lesson: l }) => [
      l.id,
      l.variety,
      ...l.items.flatMap((i) => [i.id, i.variety]),
      ...l.exercises.flatMap((e) => [e.id, e.item, ...e.options]),
    ]),
    ...FILE.keymap.lessons.flatMap((r) => [r.lesson_id, r.course_id]),
    ...FILE.keymap.courses.map((r) => r.course_id),
    ...FILE.keymap.items.map((r) => r.item_id),
  ];
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(!/^hno(-|$)/.test(id), id);
  for (const row of FILE.keymap.lessons)
    assert.ok(!row.legacy_key.startsWith('hindko/'), row.legacy_key);
  for (const row of FILE.keymap.courses)
    assert.notEqual(row.legacy_id, 'hindko');
  assert.equal(getCourse('hindko'), undefined);
});

// ---------------------------------------------------------------------------
// What the app reads from it
// ---------------------------------------------------------------------------

test('every course in the copy is shown, each with lessons, permanent ids and sourced phrases', () => {
  assert.ok(courses.length >= 1);
  // A language the app has no slug, tint or art for would be dropped quietly.
  assert.equal(courses.length, FILE.courses.length);
  assert.equal(new Set(courses.map((c) => c.id)).size, courses.length);
  const lessonIds = new Set();
  for (const c of courses) {
    assert.equal(getCourse(c.id), c);
    assert.match(c.courseId, /^[a-z]{2,3}-crs-[a-z0-9-]+$/);
    assert.ok(c.courseId.startsWith(`${c.lang}-`), c.courseId);
    assert.ok(c.name && c.native, c.id);
    assert.ok(['rtl', 'ltr'].includes(c.dir), c.id);
    assert.ok(c.lessons.length >= 1, `${c.id} has no lessons`);
    for (const l of c.lessons) {
      assert.match(l.id, new RegExp(`^${c.lang}-lsn-[0-9a-f]{6}$`));
      assert.ok(!lessonIds.has(l.id), `${l.id} twice`);
      lessonIds.add(l.id);
      assert.ok(knownLesson(l.id));
      assert.ok(l.exercises.length >= 1, `${l.id} has no exercises`);
      assert.equal(lessonSize(l.id), l.exercises.length);
      assert.equal(
        new Set(l.exercises.map((e) => e.id)).size,
        l.exercises.length,
      );
      for (const p of l.phrases)
        assert.ok(p.native && p.roman && p.meaning && p.source, p.id);
    }
  }
  assert.equal(lessonIds.size, LESSONS.length);
  assert.equal(knownLesson('xx-lsn-000000'), false);
  assert.equal(lessonSize('xx-lsn-000000'), undefined);
});
test('every exercise uses only its own lesson’s phrases, and is a kind the player shows', () => {
  const kinds = ['meaning', 'translation', 'match', 'assemble', 'context'];
  for (const { lesson: l } of LESSONS) {
    const own = new Set(l.items.map((i) => i.id));
    assert.equal(own.size, l.items.length, `${l.id} repeats a phrase`);
    for (const e of l.exercises) {
      assert.ok(kinds.includes(e.kind), `${e.id} is a ${e.kind}`);
      assert.ok(own.has(e.item), `${e.id} answers with ${e.item}`);
      for (const o of e.options) assert.ok(own.has(o), `${e.id} offers ${o}`);
      assert.equal(
        new Set([e.item, ...e.options]).size,
        e.options.length + 1,
        `${e.id} offers a phrase twice`,
      );
    }
  }
  for (const c of courses)
    for (const l of c.lessons)
      for (const e of l.exercises) {
        assert.ok(l.phrases.includes(e.phrase), e.id);
        for (const o of e.options) assert.ok(l.phrases.includes(o), e.id);
      }
});
test('every exercise accepts its correct answer and rejects incorrect ones', () => {
  const all = courses.flatMap((c) => c.lessons).flatMap((l) => l.exercises);
  for (const e of all) {
    const correct =
      e.kind === 'assemble'
        ? e.phrase.meaning.split(' ')
        : e.kind === 'match'
          ? Object.fromEntries(e.options.map((p) => [p.id, p.id]))
          : e.phrase.id;
    assert.equal(evaluate(e, correct), true, e.id);
    const incorrect =
      e.kind === 'assemble' ? ['incorrect'] : e.kind === 'match' ? {} : 'x';
    assert.equal(evaluate(e, incorrect), false, e.id);
    if (e.kind === 'assemble') {
      const words = e.phrase.meaning.split(' ');
      if (new Set(words).size > 1)
        assert.equal(evaluate(e, [...words].reverse()), false, e.id);
      assert.ok(e.tiles.length <= 2, e.id);
      for (const t of e.tiles)
        assert.ok(!words.includes(t), `${e.id} tile duplicates the answer`);
    } else if (e.kind === 'match') {
      const swapped = Object.fromEntries(
        e.options.map((p, i) => [
          p.id,
          e.options[(i + 1) % e.options.length].id,
        ]),
      );
      if (e.options.length > 1) assert.equal(evaluate(e, swapped), false, e.id);
    } else {
      assert.equal(e.options.filter((p) => p.id === e.phrase.id).length, 1);
      for (const wrong of e.options.filter((p) => p.id !== e.phrase.id))
        assert.equal(evaluate(e, wrong.id), false, e.id);
    }
  }
});
test('the answer is not always in the same slot, and the order is stable', () => {
  const choice = courses
    .flatMap((c) => c.lessons)
    .flatMap((l) => l.exercises)
    .filter((e) => e.kind !== 'assemble' && e.kind !== 'match');
  const slots = new Set(
    choice.map((e) => e.options.findIndex((p) => p.id === e.phrase.id)),
  );
  if (choice.length >= 3)
    assert.ok(slots.size >= 2, `answers land in ${[...slots].join(',')} only`);
  // Seeded by the exercise id: the same order on every render and device.
  const list = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(
    shuffled(list, 'ps-exr-a10394'),
    shuffled(list, 'ps-exr-a10394'),
  );
  assert.deepEqual([...shuffled(list, 'x')].sort(), list);
  assert.deepEqual(list, ['a', 'b', 'c', 'd', 'e']);
});
test('the keymap names only what the copy holds', () => {
  const lessonCourse = new Map(
    LESSONS.map(({ course, lesson }) => [lesson.id, course.id]),
  );
  const items = new Set(
    LESSONS.flatMap(({ lesson }) => lesson.items.map((i) => i.id)),
  );
  const courseIds = new Set(FILE.courses.map((c) => c.id));
  for (const row of FILE.keymap.lessons) {
    assert.equal(
      lessonCourse.get(row.lesson_id),
      row.course_id,
      row.legacy_key,
    );
    assert.equal(legacyLessonIds[row.legacy_key], row.lesson_id);
  }
  for (const row of FILE.keymap.courses)
    assert.ok(courseIds.has(row.course_id), row.legacy_id);
  for (const row of FILE.keymap.items)
    assert.ok(items.has(row.item_id), row.legacy_ref);
});

// ---------------------------------------------------------------------------
// Production takes only a tagged release
// ---------------------------------------------------------------------------

test('a release name is content@YYYY.MM.N, and a development build is not one', () => {
  for (const name of ['content@2026.09.1', 'content@2026.12.14'])
    assert.equal(isReleaseName(name), true, name);
  for (const name of [
    'content@2026.09.dev+f76adfa',
    'content@2026.09.dev+f76adfa.dirty',
    'content@2026.09.dev+nogit.dirty',
    'content@2026.9.1',
    'content@26.09.1',
    'content@2026.09.1-rc1',
    'content@2026.09.1 ',
    'content@2026.09',
    'v0.2.0',
    '',
  ])
    assert.equal(isReleaseName(name), false, name);
});
test('a production build refuses a development release; previews and local builds take it', () => {
  const dev = 'content@2026.09.dev+f76adfa';
  assert.match(
    productionReleaseProblem('production', dev),
    /content@2026\.09\.dev\+f76adfa/,
  );
  assert.equal(
    productionReleaseProblem('production', 'content@2026.09.1'),
    null,
  );
  for (const env of ['preview', 'development', undefined, ''])
    assert.equal(productionReleaseProblem(env, dev), null, String(env));
});

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

const REDIRECTS = contentRedirects();
/** Where Next.js would send `path`, with its own matcher, or undefined. */
function redirected(path) {
  for (const r of REDIRECTS) {
    const params = getPathMatch(r.source, {
      removeUnnamedParams: true,
      strict: true,
    })(path);
    if (params) return r;
  }
  return undefined;
}

test('next.config.ts serves the redirects the release implies', async () => {
  assert.deepEqual(await nextConfig.redirects(), REDIRECTS);
});
test('a language the copy does not hold redirects temporarily to /learn, by one pattern', () => {
  assert.deepEqual(hiddenCourseSlugs, ['hindko']);
  const temporary = REDIRECTS.filter((r) => !r.permanent);
  assert.deepEqual(temporary, [
    {
      source: '/:section(learn|lesson|onboarding)/hindko/:rest*',
      destination: '/learn',
      permanent: false,
    },
  ]);
  for (const path of [
    '/learn/hindko',
    '/onboarding/hindko',
    '/lesson/hindko/greetings',
    '/lesson/hindko/any-lesson-at-all',
  ])
    assert.equal(redirected(path), temporary[0], path);
  for (const path of ['/learn', '/learn/pashto', '/learn/hindkoo', '/settings'])
    assert.equal(redirected(path), undefined, path);
});
test('the MVP’s Pashto and Urdu lesson URLs redirect permanently to lessons in the release', () => {
  const permanent = REDIRECTS.filter((r) => r.permanent);
  assert.equal(permanent.length, FILE.keymap.lessons.length);
  assert.equal(new Set(permanent.map((r) => r.source)).size, permanent.length);
  for (const r of permanent) {
    assert.equal(r.permanent, true);
    // Literal paths: nothing in them that Next.js would read as a pattern.
    assert.match(r.source, /^\/lesson\/[a-z]+\/[a-z-]+$/);
    const [, , slug, lesson] = r.destination.split('/');
    assert.equal(r.destination, `/lesson/${slug}/${lesson}`);
    assert.ok(
      getCourse(slug)?.lessons.some((l) => l.id === lesson),
      `${r.destination} is not a lesson in this release`,
    );
    assert.equal(r.source, `/lesson/${slug}/${r.source.split('/')[3]}`);
    assert.equal(legacyLessonIds[r.source.slice('/lesson/'.length)], lesson);
    assert.ok(!/hindko|hno/.test(r.source + r.destination), r.source);
    assert.equal(redirected(r.source), r);
    assert.equal(redirected(r.destination), undefined, 'no loop');
  }
});
