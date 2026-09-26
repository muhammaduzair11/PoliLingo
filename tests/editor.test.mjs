// lib/console/editor.ts: the course maker's statuses, tree counts, reorder
// arithmetic, readiness checklist and form parsing (which mirrors the
// database's rules in supabase/migrations/20260928001400_editor.sql).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS,
  charLength,
  clean,
  countStatuses,
  isPastOrToday,
  itemStatus,
  lessonStatus,
  moveInList,
  movedAnnouncement,
  nonZeroCounts,
  parseExerciseForm,
  parseItemForm,
  parseLessonForm,
  parseReason,
  parseRevision,
  parseUnitForm,
  readiness,
  relativeTime,
  treeView,
  utcToday,
  choiceOptions,
  echo,
  formValues,
  gateLabel,
  handoffCopy,
  itemById,
  lessonLocked,
  noticeTone,
  provenanceDefaults,
  formatDay,
  historyRows,
} from '../lib/console/editor.ts';

/** A FormData from plain entries; arrays become repeated fields. */
function form(entries) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries))
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
}

const lesson = (over = {}) => ({
  id: 'ps-lsn-000001',
  title: 'Greetings',
  subtitle: '',
  position: 1,
  variety_id: 'ps-var-yusufzai',
  publish_gate: 'open',
  review_status: 'unreviewed',
  submitted_at: null,
  updated_at: '2026-09-26T10:00:00Z',
  revision_no: 1,
  items: 3,
  exercises: 6,
  demo: false,
  ...over,
});

test('lesson status: demo and retired win, in review is submitted and unreviewed', () => {
  assert.equal(lessonStatus(lesson()), 'draft');
  assert.equal(
    lessonStatus(lesson({ submitted_at: '2026-09-26T10:00:00Z' })),
    'in_review',
  );
  assert.equal(
    lessonStatus(
      lesson({
        submitted_at: '2026-09-26T10:00:00Z',
        review_status: 'approved',
      }),
    ),
    'approved',
  );
  assert.equal(
    lessonStatus(lesson({ review_status: 'changes_requested' })),
    'changes_requested',
  );
  assert.equal(lessonStatus(lesson({ review_status: 'rejected' })), 'rejected');
  assert.equal(lessonStatus(lesson({ demo: true, submitted_at: 'x' })), 'demo');
  assert.equal(
    lessonStatus({ ...lesson({ demo: true }), retired_at: '2026-09-01' }),
    'retired',
  );
});

test('phrase status follows its lesson’s submission', () => {
  const item = { review_status: 'unreviewed', demo: false };
  assert.equal(itemStatus(item, false), 'draft');
  assert.equal(itemStatus(item, true), 'in_review');
  assert.equal(
    itemStatus({ ...item, review_status: 'approved' }, true),
    'approved',
  );
  assert.equal(itemStatus({ ...item, demo: true }, true), 'demo');
});

test('the tree view counts lesson statuses at every level', () => {
  const tree = {
    is_admin: false,
    me: 'ctr-0102',
    languages: [
      {
        code: 'ps',
        name: 'Pashto',
        native_name: 'پښتو',
        direction: 'rtl',
        publish_gate: 'open',
        demo_period: { sunset: '2026-12-11', live: true },
        varieties: [
          {
            id: 'ps-var-fixture',
            name: 'Fixture variety',
            learner_label: 'Fixture',
            publish_gate: 'open',
            reviewers: 0,
          },
        ],
        courses: [
          {
            id: 'ps-crs-fixture',
            name: 'Fixture course',
            variety_id: 'ps-var-fixture',
            publish_gate: 'open',
            units: [
              {
                id: 'ps-unt-000001',
                title: 'One',
                goal: 'The first unit.',
                theme: null,
                position: 1,
                publish_gate: 'open',
                revision_no: 1,
                lessons: [
                  lesson({ demo: true }),
                  lesson({ id: 'b', demo: true }),
                  lesson({ id: 'c', submitted_at: 'x' }),
                ],
              },
              {
                id: 'ps-unt-000002',
                title: 'Two',
                goal: 'The second unit.',
                theme: null,
                position: 2,
                publish_gate: 'blocked',
                revision_no: 1,
                lessons: [
                  lesson({ id: 'd' }),
                  lesson({ id: 'e', review_status: 'approved' }),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const view = treeView(tree);
  assert.equal(view.lessonCount, 5);
  assert.deepEqual(nonZeroCounts(view.counts), [
    { status: 'draft', count: 1 },
    { status: 'in_review', count: 1 },
    { status: 'approved', count: 1 },
    { status: 'demo', count: 2 },
  ]);
  const course = view.languages[0].courses[0];
  assert.equal(course.varietyName, 'Fixture variety');
  assert.equal(course.units[0].counts.demo, 2);
  assert.equal(course.units[1].counts.draft, 1);
  assert.equal(course.units[0].lessons[2].status, 'in_review');
  assert.deepEqual(course.counts, view.languages[0].counts);
  assert.equal(countStatuses([]).draft, 0);
});

test('moving up and down swaps neighbours, and refuses the ends', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(moveInList(ids, 'b', 'up'), ['b', 'a', 'c']);
  assert.deepEqual(moveInList(ids, 'b', 'down'), ['a', 'c', 'b']);
  assert.equal(moveInList(ids, 'a', 'up'), null);
  assert.equal(moveInList(ids, 'c', 'down'), null);
  assert.equal(moveInList(ids, 'z', 'up'), null);
  assert.deepEqual(ids, ['a', 'b', 'c'], 'the input is not changed');
  assert.equal(
    movedAnnouncement('“Hello”', ['b', 'a', 'c'], 'b'),
    '“Hello” moved to position 1 of 3.',
  );
});

test('readiness mirrors what submit_lesson asks for', () => {
  const none = readiness({ items: [], exercises: [], problems: [] });
  assert.equal(none.ready, false);
  assert.deepEqual(
    none.checks.map((c) => [c.key, c.ok]),
    [
      ['items', false],
      ['exercises', false],
      ['problems', true],
    ],
  );
  const ready = readiness({
    items: [1, 2, 3],
    exercises: [1, 2, 3, 4, 5, 6],
    problems: [
      { severity: 'warning', code: 'PL409_NOT_PUBLISHABLE', message: 'x' },
    ],
  });
  assert.equal(ready.ready, true);
  const blocked = readiness({
    items: [1, 2, 3],
    exercises: [1, 2, 3, 4, 5, 6],
    problems: [
      { severity: 'blocking', code: 'PL422_BAD_OPTION', message: 'x' },
      // Counted by the exercises check instead.
      { severity: 'blocking', code: 'PL422_TOO_FEW_EXERCISES', message: 'x' },
    ],
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.checks[2].detail, '1 problem to fix.');
});

test('lengths count characters, as the database does', () => {
  assert.equal(charLength('سلام'), 4);
  assert.equal(charLength('😀a'), 2);
  assert.equal(clean('  hi  '), 'hi');
  assert.equal(clean(null), '');
});

test('the unit and lesson forms', () => {
  assert.deepEqual(
    parseUnitForm(
      form({ title: ' Travel ', goal: 'Get from A to B.', theme: '' }),
    ),
    {
      ok: true,
      value: { title: 'Travel', goal: 'Get from A to B.', theme: null },
    },
  );
  const short = parseUnitForm(form({ title: 'Travel', goal: 'Short' }));
  assert.equal(short.ok, false);
  assert.equal(short.field, 'goal');
  assert.equal(short.code, 'PL422_LENGTH');
  const long = parseUnitForm(
    form({ title: 'x'.repeat(61), goal: 'Long enough goal.' }),
  );
  assert.equal(
    long.message,
    'The unit title can be at most 60 characters. This one has 61.',
  );

  const ok = parseLessonForm(
    form({
      title: 'Greetings',
      objective: 'Say hello and goodbye.',
      subtitle: '',
      variety: 'ps-var-yusufzai',
      estimated_minutes: '5',
    }),
  );
  assert.deepEqual(ok.value, {
    title: 'Greetings',
    subtitle: '',
    objective: 'Say hello and goodbye.',
    variety: 'ps-var-yusufzai',
    estimated_minutes: 5,
  });
  const minutes = parseLessonForm(
    form({
      title: 'G',
      objective: 'Say hello and goodbye.',
      estimated_minutes: '30',
    }),
  );
  assert.equal(minutes.field, 'estimated_minutes');
  assert.equal(
    parseLessonForm(form({ title: '', objective: 'Say hello and goodbye.' }))
      .field,
    'title',
  );
});

const goodItem = {
  native: '  سلام  ',
  romanisation: 'Salaam',
  meaning: 'Hello',
  context: '',
  usage_note: 'Friendly.',
  source_type: 'original',
  source_citation: 'Written for PoliLingo',
  source_licence: 'CC BY 4.0',
  source_retrieved: '2026-09-20',
  source_caveat: '',
};

test('the phrase form normalises the text and checks provenance', () => {
  const ok = parseItemForm(form(goodItem), '2026-09-26');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, {
    native: 'سلام',
    romanisation: 'Salaam',
    meaning: 'Hello',
    context: null,
    usage_note: 'Friendly.',
    source_type: 'original',
    source_citation: 'Written for PoliLingo',
    source_licence: 'CC BY 4.0',
    source_retrieved: '2026-09-20',
    source_caveat: null,
  });
  const cases = [
    [{ native: ' ' }, 'native', 'PL422_LENGTH'],
    [
      { meaning: 'm'.repeat(LIMITS.meaning.max + 1) },
      'meaning',
      'PL422_LENGTH',
    ],
    [{ usage_note: 'u'.repeat(501) }, 'usage_note', 'PL422_LENGTH'],
    [{ source_type: 'a blog' }, 'source_type', 'PL422_PROVENANCE'],
    [{ source_citation: 'ab' }, 'source_citation', 'PL422_PROVENANCE'],
    [{ source_licence: 'x' }, 'source_licence', 'PL422_PROVENANCE'],
    [
      { source_retrieved: '2026-02-30' },
      'source_retrieved',
      'PL422_PROVENANCE',
    ],
    [
      { source_retrieved: '2026-12-01' },
      'source_retrieved',
      'PL422_PROVENANCE',
    ],
  ];
  for (const [over, field, code] of cases) {
    const result = parseItemForm(form({ ...goodItem, ...over }), '2026-09-26');
    assert.equal(result.ok, false, field);
    assert.equal(result.field, field);
    assert.equal(result.code, code);
  }
  const withVariety = parseItemForm(
    form({ ...goodItem, variety: 'ps-var-yusufzai' }),
    '2026-09-26',
  );
  assert.equal(withVariety.value.variety, 'ps-var-yusufzai');
  assert.equal(isPastOrToday('2026-09-26', '2026-09-26'), true);
  assert.equal(isPastOrToday('26/09/2026', '2026-09-26'), false);
});

test('the exercise form: kinds, choices and assemble', () => {
  const meaning = parseExerciseForm(
    form({
      kind: 'meaning',
      answer: 'a',
      prompt: 'What does this mean?',
      options: ['b', 'c', 'b'],
      difficulty: '',
    }),
  );
  assert.deepEqual(meaning.value, {
    kind: 'meaning',
    answer: 'a',
    prompt: 'What does this mean?',
    options: ['b', 'c'],
    difficulty: null,
  });
  // Choices left ticked are dropped for assemble.
  const assemble = parseExerciseForm(
    form({
      kind: 'assemble',
      answer: 'a',
      prompt: 'Build it.',
      options: ['b'],
    }),
  );
  assert.deepEqual(assemble.value.options, []);
  const cases = [
    [{ kind: 'riddle' }, 'kind', 'PL422_BAD_INPUT'],
    [{ answer: '' }, 'answer', 'PL422_BAD_INPUT'],
    [{ prompt: '' }, 'prompt', 'PL422_LENGTH'],
    [{ options: [] }, 'options', 'PL422_BAD_OPTION'],
    [{ options: ['a', 'b'] }, 'options', 'PL422_OPTION_EQUALS_ANSWER'],
    [
      { options: Array.from({ length: 12 }, (_, i) => `o${i}`) },
      'options',
      'PL422_BAD_OPTION',
    ],
    [{ difficulty: '7' }, 'difficulty', 'PL422_BAD_INPUT'],
  ];
  for (const [over, field, code] of cases) {
    const result = parseExerciseForm(
      form({
        kind: 'translation',
        answer: 'a',
        prompt: 'How do you say "Hello"?',
        options: ['b'],
        ...over,
      }),
    );
    assert.equal(result.ok, false, JSON.stringify(over));
    assert.equal(result.field, field);
    assert.equal(result.code, code);
  }
});

test('reasons, revisions, dates and relative times', () => {
  assert.equal(
    parseReason(form({ reason: '  ' })).code,
    'PL422_COMMENT_REQUIRED',
  );
  assert.equal(
    parseReason(form({ reason: 'r'.repeat(501) })).code,
    'PL422_LENGTH',
  );
  assert.deepEqual(parseReason(form({ reason: ' Merged ' })), {
    ok: true,
    value: 'Merged',
  });
  assert.equal(parseRevision('3'), 3);
  assert.equal(parseRevision('-1'), null);
  assert.equal(parseRevision(null), null);
  const now = new Date('2026-09-26T12:00:00Z');
  assert.equal(utcToday(now), '2026-09-26');
  assert.equal(relativeTime('2026-09-26T11:59:30Z', now), 'just now');
  assert.equal(relativeTime('2026-09-26T11:59:00Z', now), '1 minute ago');
  assert.equal(relativeTime('2026-09-26T09:00:00Z', now), '3 hours ago');
  assert.equal(relativeTime('2026-09-24T12:00:00Z', now), '2 days ago');
  assert.equal(relativeTime('2026-08-01T12:00:00Z', now), '2026-08-01');
});

test('a refused form echoes what was typed; otherwise the saved value', () => {
  const values = formValues(
    form({ title: '  Greetings ', goal: 'x', other: 'y' }),
    ['title', 'goal', 'missing'],
  );
  assert.deepEqual(values, { title: '  Greetings ', goal: 'x' });
  assert.equal(echo(values, 'title', 'Saved'), '  Greetings ');
  assert.equal(echo(values, 'theme', 'Saved'), 'Saved');
  assert.equal(echo(undefined, 'theme', null), '');
  assert.equal(echo(undefined, 'minutes', 5), '5');
  assert.equal(noticeTone('PL422_NO_CHANGE'), 'info');
  assert.equal(noticeTone('PL409_STALE_EDIT'), 'error');
});

test('a new phrase takes the provenance of the lesson’s last phrase', () => {
  assert.deepEqual(provenanceDefaults([]), {
    source_type: 'original',
    source_citation: '',
    source_licence: '',
  });
  const items = [
    { source_type: 'original', source_citation: 'A', source_licence: 'L1' },
    {
      source_type: 'published_work',
      source_citation: 'Book, p. 4',
      source_licence: 'CC BY 4.0',
    },
  ];
  assert.deepEqual(provenanceDefaults(items), {
    source_type: 'published_work',
    source_citation: 'Book, p. 4',
    source_licence: 'CC BY 4.0',
  });
});

test('wrong choices: the other phrases, marked when the database would refuse them', () => {
  const items = [
    { id: 'a', native: 'سلام', meaning: 'Hello' },
    { id: 'b', native: ' سلام ', meaning: 'Hi' },
    { id: 'c', native: 'مننه', meaning: ' hello ' },
    { id: 'd', native: 'ښه', meaning: 'Good' },
  ];
  assert.deepEqual(
    choiceOptions(items, 'a').map((o) => [o.id, o.blocked]),
    [
      ['b', 'Same text as the answer'],
      ['c', 'Same meaning as the answer'],
      ['d', null],
    ],
  );
  // No answer chosen yet: everything is offered, nothing blocked.
  assert.equal(
    choiceOptions(items, '').every((o) => o.blocked === null),
    true,
  );
  assert.equal(itemById(items)('d')?.meaning, 'Good');
  assert.equal(itemById(items)('z'), undefined);
});

test('gates and locks', () => {
  assert.equal(gateLabel('blocked'), 'Held back');
  assert.equal(gateLabel('open'), 'Open');
  assert.equal(lessonLocked({ demo: false, retired_at: null }), null);
  assert.equal(lessonLocked({ demo: true, retired_at: null }), 'demo');
  assert.equal(
    lessonLocked({ demo: true, retired_at: '2026-09-26' }),
    'retired',
  );
});

test('dates read as words; lesson rows that only echo a child change are left out', () => {
  assert.equal(formatDay('2026-12-11'), '11 December 2026');
  assert.equal(formatDay('2026-09-26T23:30:00Z'), '26 September 2026');
  assert.equal(formatDay(null), '');
  assert.equal(formatDay('not a date'), '');
  const row = (object_type, reason, at) => ({
    object_type,
    object_id: `${object_type}-1`,
    revision_no: 1,
    reason,
    at,
    mine: true,
    author: 'ctr-0102',
  });
  const rows = [
    row('lesson', 'edit', '2026-09-26T10:00:01Z'),
    row('lesson', 'reorder', '2026-09-26T10:00:02Z'),
    row('item', 'create', '2026-09-26T10:00:00Z'),
    row('lesson', 'edit', '2026-09-26T09:00:00Z'),
    row('lesson', 'create', '2026-09-26T08:00:00Z'),
  ];
  assert.deepEqual(
    historyRows(rows).map(
      (r) => `${r.object_type}:${r.reason}:${r.at.slice(11, 19)}`,
    ),
    ['item:create:10:00:00', 'lesson:edit:09:00:00', 'lesson:create:08:00:00'],
  );
});

test('the review hand-off names reviewers only when the variety has some', () => {
  const some = handoffCopy('Yusufzai', 2);
  assert.equal(some.ready, 'Ready. Yusufzai reviewers will see it next.');
  assert.match(
    some.confirm,
    /^Yusufzai reviewers see it in their queue next\./,
  );
  assert.equal(some.waiting, 'Waiting for a Yusufzai reviewer');
  const none = handoffCopy('Yusufzai', 0);
  for (const line of [none.ready, none.confirm, none.waiting])
    assert.match(line, /no one reviews Yusufzai yet/i);
  assert.match(none.confirm, /until an admin invites a reviewer/);
  assert.doesNotMatch(none.ready, /reviewers will see it/);
});
