// lib/console/release-diff.ts: what changes for learners between two
// learner copies, in the detail the publish page shows, and the contentHash
// check it runs on what it shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkContentHash,
  contentHashOf,
  describeLessonChange,
  diffReleases,
  lessonPlaces,
  readBackVerdict,
} from '../lib/console/release-diff.ts';

const baseline = JSON.parse(
  readFileSync(new URL('../content/release.json', import.meta.url), 'utf8'),
);

const item = (id, fields = {}) => ({
  id,
  native: `native ${id}`,
  romanisation: `Roman ${id}`,
  meaning: `Meaning ${id}`,
  variety: 'ps-var-yusufzai',
  citation: 'Written for a test',
  ...fields,
});
const exercise = (id, answer, options = []) => ({
  id,
  kind: options.length ? 'meaning' : 'assemble',
  item: answer,
  prompt: 'What does this mean?',
  options,
});
const lesson = (id, order, fields = {}) => ({
  id,
  order,
  title: `Lesson ${id}`,
  subtitle: '',
  objective: 'Say hello and thank someone.',
  variety: 'ps-var-yusufzai',
  items: [item(`${id}-a`), item(`${id}-b`)],
  exercises: [
    exercise(`${id}-x1`, `${id}-a`, [`${id}-b`]),
    exercise(`${id}-x2`, `${id}-b`),
  ],
  ...fields,
});
const copy = (units, languages = ['ps']) => ({
  format: 'polilingo.learner@1',
  schemaVersion: 1,
  release: 'content@2026.09.1',
  commit: null,
  languages: languages.map((code) => ({
    code,
    name: code,
    native_name: code,
    direction: 'rtl',
  })),
  varieties: [],
  courses: [
    {
      id: 'ps-crs-a',
      language: 'ps',
      variety: 'ps-var-yusufzai',
      name: 'Pashto',
      tagline: '',
      units: units.map(([id, lessons], i) => ({
        id,
        order: i + 1,
        title: `Unit ${id}`,
        lessons,
      })),
    },
  ],
  keymap: { lessons: [], courses: [], items: [] },
});

test('a copy compared with itself has no changes', () => {
  const diff = diffReleases(baseline, structuredClone(baseline));
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.changed, []);
  assert.equal(diff.unchanged, lessonPlaces(baseline).size);
  assert.ok(diff.unchanged > 0);
});

test('with nothing published before, every lesson is added', () => {
  const after = copy([['u1', [lesson('l1', 1), lesson('l2', 2)]]]);
  const diff = diffReleases(null, after);
  assert.deepEqual(
    diff.added.map((l) => [l.id, l.unitTitle, l.courseName, l.language]),
    [
      ['l1', 'Unit u1', 'Pashto', 'ps'],
      ['l2', 'Unit u1', 'Pashto', 'ps'],
    ],
  );
  assert.deepEqual(diff.languagesAdded, ['ps']);
  assert.deepEqual(diff.languagesRemoved, []);
});

test('lessons added and removed, in each copy’s own order', () => {
  const before = copy([['u1', [lesson('l1', 1), lesson('l2', 2)]]]);
  const after = copy([['u1', [lesson('l1', 1), lesson('l3', 2)]]]);
  const diff = diffReleases(before, after);
  assert.deepEqual(
    diff.added.map((l) => l.id),
    ['l3'],
  );
  assert.deepEqual(
    diff.removed.map((l) => l.id),
    ['l2'],
  );
  assert.equal(diff.unchanged, 1);
});

test('a changed lesson says which fields, phrases and exercises changed', () => {
  const before = copy([['u1', [lesson('l1', 1)]]]);
  const edited = lesson('l1', 1, { title: 'A warmer hello' });
  edited.items[0] = { ...edited.items[0], meaning: 'Hello there' };
  edited.items[1] = { ...edited.items[1], usage_note: 'Said with a smile.' };
  edited.items.push(item('l1-c'));
  edited.exercises[0] = { ...edited.exercises[0], prompt: 'Pick the meaning' };
  edited.exercises.push(exercise('l1-x3', 'l1-c', ['l1-a']));
  const diff = diffReleases(before, copy([['u1', [edited]]]));

  assert.equal(diff.changed.length, 1);
  const [change] = diff.changed;
  assert.equal(change.id, 'l1');
  assert.equal(change.title, 'A warmer hello');
  assert.deepEqual(change.fields, ['title']);
  assert.deepEqual(change.items.added, ['l1-c']);
  assert.deepEqual(change.items.removed, []);
  assert.deepEqual(change.items.changed, [
    { id: 'l1-a', fields: ['meaning'] },
    { id: 'l1-b', fields: ['usage_note'] },
  ]);
  assert.equal(change.items.reordered, false);
  assert.deepEqual(change.exercises.added, ['l1-x3']);
  assert.deepEqual(change.exercises.changed, ['l1-x1']);
  assert.deepEqual(describeLessonChange(change), [
    'New title',
    '1 phrase added',
    '2 phrases edited (meaning, usage note)',
    '1 exercise added',
    '1 exercise edited',
  ]);
});

test('moves: to another unit, or to a new place in the same unit', () => {
  const before = copy([
    ['u1', [lesson('l1', 1), lesson('l2', 2)]],
    ['u2', [lesson('l3', 1)]],
  ]);
  const after = copy([
    ['u1', [lesson('l2', 1)]],
    ['u2', [lesson('l1', 1), lesson('l3', 2)]],
  ]);
  const byId = new Map(
    diffReleases(before, after).changed.map((c) => [c.id, c]),
  );
  assert.deepEqual(byId.get('l1').fields, ['unit']);
  assert.deepEqual(byId.get('l2').fields, ['order']);
  assert.deepEqual(byId.get('l3').fields, ['order']);
  assert.deepEqual(describeLessonChange(byId.get('l1')), [
    'Moved to another unit',
  ]);
  assert.deepEqual(describeLessonChange(byId.get('l2')), [
    'New place in its unit',
  ]);
});

test('phrases and exercises in a new order, and removed ones', () => {
  const before = copy([['u1', [lesson('l1', 1)]]]);
  const shuffled = lesson('l1', 1);
  shuffled.items.reverse();
  shuffled.exercises = [shuffled.exercises[1]];
  const [change] = diffReleases(before, copy([['u1', [shuffled]]])).changed;
  assert.equal(change.items.reordered, true);
  assert.deepEqual(change.exercises.removed, ['l1-x1']);
  assert.equal(change.exercises.reordered, false);
  assert.deepEqual(describeLessonChange(change), [
    'Phrases in a new order',
    '1 exercise removed',
  ]);
});

test('a phrase that gains context or a new source is an edit', () => {
  const before = copy([['u1', [lesson('l1', 1)]]]);
  const after = lesson('l1', 1);
  after.items[0] = {
    ...after.items[0],
    context: 'At the door',
    citation: 'A reviewer',
  };
  after.items[1] = { ...after.items[1], native: 'نوی' };
  const [change] = diffReleases(before, copy([['u1', [after]]])).changed;
  assert.deepEqual(describeLessonChange(change), [
    '2 phrases edited (text, context, source)',
  ]);
});

test('an unknown difference still counts as a change', () => {
  const before = copy([['u1', [lesson('l1', 1)]]]);
  const after = lesson('l1', 1, { audio: 'new' });
  const [change] = diffReleases(before, copy([['u1', [after]]])).changed;
  assert.deepEqual(describeLessonChange(change), ['Small changes']);
});

test('languages that appear or leave', () => {
  const before = copy([['u1', [lesson('l1', 1)]]], ['ps', 'ur']);
  const after = copy([['u1', [lesson('l1', 1)]]], ['ps', 'hno']);
  const diff = diffReleases(before, after);
  assert.deepEqual(diff.languagesAdded, ['hno']);
  assert.deepEqual(diff.languagesRemoved, ['ur']);
});

test('contentHashOf matches the committed learner copy', () => {
  assert.equal(contentHashOf(baseline), baseline.contentHash);
  assert.deepEqual(checkContentHash(baseline), {
    ok: true,
    hash: baseline.contentHash,
  });
});

test('checkContentHash notices a hand edit, a wrong hash and a non-copy', () => {
  const edited = structuredClone(baseline);
  edited.courses[0].units[0].lessons[0].title = 'Edited by hand';
  const check = checkContentHash(edited);
  assert.equal(check.ok, false);
  assert.equal(check.expected, baseline.contentHash);
  assert.match(check.actual, /^sha256-[0-9a-f]{64}$/);

  assert.equal(
    checkContentHash(baseline, `sha256-${'0'.repeat(64)}`).ok,
    false,
  );
  assert.deepEqual(checkContentHash(null), {
    ok: false,
    expected: null,
    actual: '',
  });
  assert.equal(checkContentHash({ contentHash: 'x' }).ok, false);
});

test('readBackVerdict: every hash must agree with the published one', () => {
  const hash = baseline.contentHash;
  assert.equal(readBackVerdict(baseline, hash, hash), 'verified');
  // Served under another hash, or published under another.
  assert.equal(
    readBackVerdict(baseline, `sha256-${'0'.repeat(64)}`, hash),
    'mismatch',
  );
  assert.equal(
    readBackVerdict(baseline, hash, `sha256-${'0'.repeat(64)}`),
    'mismatch',
  );
  // Content that no longer adds up to what it states.
  const edited = structuredClone(baseline);
  edited.courses[0].units[0].lessons[0].title = 'Edited by hand';
  assert.equal(readBackVerdict(edited, hash, hash), 'mismatch');
  // A copy stating a different hash than it was published with.
  assert.equal(
    readBackVerdict({ ...baseline, contentHash: 'sha256-x' }, hash, hash),
    'mismatch',
  );
  assert.equal(readBackVerdict(null, hash, hash), 'mismatch');
});
