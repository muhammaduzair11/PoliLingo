// lib/console/exercise-generator.ts: "Generate exercises" in the lesson
// editor. The plan must be deterministic, its wrong choices must pass the
// database's option rules, and a lesson of 3 or more phrases gets at least
// 6 exercises.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemblePrompt,
  generateExercises,
  isValidDistractor,
  longestMeaningIndex,
  meaningKey,
  nativeKey,
  pickDistractors,
  planCounts,
  translationPrompt,
} from '../lib/console/exercise-generator.ts';

const ITEMS = [
  { id: 'ps-itm-000001', native: 'سلام', meaning: 'Hello' },
  { id: 'ps-itm-000002', native: 'مننه', meaning: 'Thank you' },
  {
    id: 'ps-itm-000003',
    native: 'زما نوم سارا دی',
    meaning: 'My name is Sara',
  },
  { id: 'ps-itm-000004', native: 'زه ښه یم', meaning: 'I am fine' },
  {
    id: 'ps-itm-000005',
    native: 'ستا نوم څه دی؟',
    meaning: 'What is your name?',
  },
];

const byId = new Map(ITEMS.map((i) => [i.id, i]));

function assertOptionRules(plan, items) {
  const lesson = new Map(items.map((i) => [i.id, i]));
  for (const exercise of plan) {
    const answer = lesson.get(exercise.answer);
    assert.ok(answer, `${exercise.key}: the answer is in the lesson`);
    if (exercise.kind === 'assemble') {
      assert.deepEqual(exercise.options, [], `${exercise.key}: no choices`);
      continue;
    }
    assert.ok(exercise.options.length >= 1, `${exercise.key}: has choices`);
    assert.ok(exercise.options.length <= 3, `${exercise.key}: at most 3`);
    assert.equal(
      new Set(exercise.options).size,
      exercise.options.length,
      `${exercise.key}: distinct`,
    );
    for (const id of exercise.options) {
      const option = lesson.get(id);
      assert.ok(option, `${exercise.key}: ${id} is from the same lesson`);
      assert.notEqual(id, answer.id);
      assert.notEqual(nativeKey(option.native), nativeKey(answer.native));
      assert.notEqual(meaningKey(option.meaning), meaningKey(answer.meaning));
    }
    const natives = exercise.options.map((id) =>
      nativeKey(lesson.get(id).native),
    );
    const meanings = exercise.options.map((id) =>
      meaningKey(lesson.get(id).meaning),
    );
    assert.equal(new Set(natives).size, natives.length);
    assert.equal(new Set(meanings).size, meanings.length);
  }
}

test('the same phrases always give the same plan', () => {
  const first = generateExercises(ITEMS);
  const second = generateExercises(structuredClone(ITEMS));
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((e) => e.key),
    [
      'meaning:ps-itm-000001',
      'translation:ps-itm-000001',
      'meaning:ps-itm-000002',
      'translation:ps-itm-000002',
      'meaning:ps-itm-000003',
      'translation:ps-itm-000003',
      'meaning:ps-itm-000004',
      'translation:ps-itm-000004',
      'meaning:ps-itm-000005',
      'translation:ps-itm-000005',
      'match:ps-itm-000001',
      'assemble:ps-itm-000005',
    ],
  );
  // Keys are unique, so they can key a preview list.
  assert.equal(new Set(first.map((e) => e.key)).size, first.length);
});

test('choices come from the lesson, walking forwards for meaning and backwards for translation', () => {
  assert.deepEqual(pickDistractors(ITEMS, 0, 1), [
    'ps-itm-000002',
    'ps-itm-000003',
    'ps-itm-000004',
  ]);
  assert.deepEqual(pickDistractors(ITEMS, 0, -1), [
    'ps-itm-000005',
    'ps-itm-000004',
    'ps-itm-000003',
  ]);
  const plan = generateExercises(ITEMS);
  assertOptionRules(plan, ITEMS);
});

test('a choice never shares the answer’s text or meaning, as the database compares them', () => {
  const items = [
    { id: 'a', native: 'سلام', meaning: 'Hello' },
    { id: 'b', native: ' سلام ', meaning: 'Hi there' }, // same text once normalised
    { id: 'c', native: 'مننه', meaning: '  hello ' }, // same meaning, other case
    { id: 'd', native: 'ښه', meaning: 'Good' },
    { id: 'e', native: 'بد', meaning: 'good' }, // same meaning as d
  ];
  assert.equal(isValidDistractor(items[0], items[1]), false);
  assert.equal(isValidDistractor(items[0], items[2]), false);
  assert.equal(isValidDistractor(items[0], items[3]), true);
  // For a, only d or e qualify, and not both (they share a meaning).
  assert.deepEqual(pickDistractors(items, 0, 1), ['d']);
  const plan = generateExercises(items);
  assertOptionRules(plan, items);
});

test('at least 6 exercises whenever the lesson has 3 or more phrases', () => {
  for (let n = 3; n <= 12; n++) {
    const items = Array.from({ length: n }, (_, i) => ({
      id: `ps-itm-${String(i).padStart(6, '0')}`,
      native: `نوم ${'ب'.repeat(i + 1)}`,
      meaning: `Meaning number ${i + 1}`,
    }));
    const plan = generateExercises(items);
    assert.ok(plan.length >= 6, `${n} phrases: ${plan.length} exercises`);
    const counts = planCounts(plan);
    assert.equal(counts.meaning, n);
    assert.equal(counts.translation, n);
    assert.equal(counts.match, n >= 4 ? 1 : 0);
    assert.equal(counts.assemble, 1);
    assertOptionRules(plan, items);
  }
});

test('assemble goes to the longest meaning and never has choices', () => {
  assert.equal(longestMeaningIndex(ITEMS), 4);
  assert.equal(
    longestMeaningIndex([
      { id: 'a', native: 'x', meaning: 'Same length' },
      { id: 'b', native: 'y', meaning: 'same length' },
    ]),
    0,
  );
  const assemble = generateExercises(ITEMS).find((e) => e.kind === 'assemble');
  assert.equal(assemble.answer, 'ps-itm-000005');
  assert.deepEqual(assemble.options, []);
  assert.equal(assemble.prompt, 'Build the sentence "What is your name?"');
});

test('match only with 4 or more phrases', () => {
  assert.equal(
    generateExercises(ITEMS.slice(0, 3)).some((e) => e.kind === 'match'),
    false,
  );
  const match = generateExercises(ITEMS.slice(0, 4)).find(
    (e) => e.kind === 'match',
  );
  assert.equal(match.options.length, 3);
});

test('what the lesson already has is not planned again', () => {
  const plan = generateExercises(ITEMS);
  const existing = plan.map((e) => ({
    kind: e.kind,
    answer_item_id: e.answer,
  }));
  assert.deepEqual(generateExercises(ITEMS, existing), []);
  // A new phrase adds only its own exercises.
  const more = [
    ...ITEMS,
    { id: 'ps-itm-000006', native: 'خدای پامان', meaning: 'Goodbye' },
  ];
  assert.deepEqual(
    generateExercises(more, existing).map((e) => e.key),
    ['meaning:ps-itm-000006', 'translation:ps-itm-000006'],
  );
});

test('small lessons: one phrase gets only an assemble; none gets nothing', () => {
  assert.deepEqual(generateExercises([]), []);
  const one = generateExercises([ITEMS[0]]);
  assert.deepEqual(
    one.map((e) => e.kind),
    ['assemble'],
  );
  // Phrases that all mean the same thing cannot be each other's choices.
  const twins = generateExercises([
    { id: 'a', native: 'سلام', meaning: 'Hello' },
    { id: 'b', native: 'سلامونه', meaning: 'hello' },
  ]);
  assert.deepEqual(
    twins.map((e) => e.kind),
    ['assemble'],
  );
});

test('prompts read naturally', () => {
  assert.equal(translationPrompt('Thank you'), 'How do you say "Thank you"?');
  assert.equal(translationPrompt('I am fine.'), 'How do you say "I am fine"?');
  assert.equal(
    translationPrompt('What is your name?'),
    'How do you ask "What is your name?"',
  );
  assert.equal(translationPrompt('Welcome!'), 'How do you say "Welcome!"');
  assert.equal(
    assemblePrompt(' My name  is Sara. '),
    'Build the sentence "My name is Sara".',
  );
  for (const e of generateExercises(ITEMS))
    assert.ok(e.prompt.length >= 1 && e.prompt.length <= 300);
  assert.equal(byId.size, ITEMS.length);
});
