// The lesson player's pure decisions (app/lesson/lesson-logic.ts): answer
// orders that change on a second try and never spell the answer, hints that
// nudge without naming it, and the content's plain text set for the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { courses } from '../lib/content.ts';
import {
  attemptSeeds,
  bankOrder,
  choiceOrder,
  contextScene,
  crossedOut,
  givesAway,
  hintNudge,
  isRotation,
  matchOrders,
  scriptRuns,
  spellsAnswer,
  typeset,
  wrongChoiceCopy,
} from '../app/lesson/lesson-logic.ts';

const exercises = courses.flatMap((c) => c.lessons.flatMap((l) => l.exercises));
const ids = (list) => list.map((p) => p.id);
const sorted = (list) => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** A run of `size` questions whose first one was answered wrong once. */
const retryQueue = (size) => [...Array(size).keys(), 0];

test('each attempt has its own seed, and a retry remembers the first try', () => {
  assert.deepEqual(attemptSeeds('ex', 'run', [0, 1, 2, 3], 2), ['ex:run:2']);
  // Exercise 0 again, at the end of the queue: both its attempts.
  assert.deepEqual(attemptSeeds('ex', 'run', retryQueue(4), 4), [
    'ex:run:0',
    'ex:run:4',
  ]);
});

test('choices come in a new order on a second try', () => {
  for (const ex of exercises.filter((e) => e.options.length > 2)) {
    for (const run of ['a', 'b', 'c']) {
      const first = choiceOrder(
        ex.options,
        attemptSeeds(ex.id, run, retryQueue(4), 0),
      );
      const second = choiceOrder(
        ex.options,
        attemptSeeds(ex.id, run, retryQueue(4), 4),
      );
      assert.notDeepEqual(ids(second), ids(first), `${ex.id} run ${run}`);
      // Same choices, only reordered: grading is by id, so it is unaffected.
      assert.deepEqual(sorted(ids(second)), sorted(ids(ex.options)));
    }
  }
});

test('a reload shows the same order; a new run shows its own', () => {
  const ex = exercises.find((e) => e.kind === 'meaning');
  const seeds = attemptSeeds(ex.id, 'run-1', [0, 1, 2, 3], 0);
  assert.deepEqual(
    ids(choiceOrder(ex.options, seeds)),
    ids(choiceOrder(ex.options, seeds)),
  );
  const orders = new Set(
    Array.from({ length: 12 }, (_, i) =>
      ids(
        choiceOrder(ex.options, attemptSeeds(ex.id, `run-${i}`, [0], 0)),
      ).join(),
    ),
  );
  assert.ok(orders.size > 1);
});

test('a match board’s meanings are never its expressions turned round', () => {
  assert.ok(isRotation([3, 4, 1, 2], [1, 2, 3, 4]));
  assert.ok(isRotation([1, 2, 3, 4], [1, 2, 3, 4]));
  assert.ok(!isRotation([2, 1, 3, 4], [1, 2, 3, 4]));
  for (const ex of exercises.filter((e) => e.kind === 'match'))
    for (let run = 0; run < 25; run++) {
      const queue = retryQueue(4);
      for (const cursor of [0, 4]) {
        const { left, right } = matchOrders(
          ex.options,
          attemptSeeds(ex.id, `r${run}`, queue, cursor),
        );
        assert.ok(!isRotation(ids(right), ids(left)), `${ex.id} r${run}`);
        assert.deepEqual(sorted(ids(right)), sorted(ids(ex.options)));
      }
      const first = matchOrders(
        ex.options,
        attemptSeeds(ex.id, `r${run}`, retryQueue(4), 0),
      );
      const second = matchOrders(
        ex.options,
        attemptSeeds(ex.id, `r${run}`, retryQueue(4), 4),
      );
      assert.notDeepEqual(ids(second.right), ids(first.right));
    }
});

test('the word bank never spells the answer, and changes on a second try', () => {
  assert.ok(
    spellsAnswer(
      ['x', 'My', 'name', 'is', 'Sara'],
      ['My', 'name', 'is', 'Sara'],
    ),
  );
  assert.ok(
    !spellsAnswer(['My', 'is', 'name', 'Sara'], ['My', 'name', 'is', 'Sara']),
  );
  // One word is never "in order" in a way that gives anything away.
  assert.ok(!spellsAnswer(['Help'], ['Help']));
  for (const ex of exercises.filter((e) => e.kind === 'assemble')) {
    const answer = ex.phrase.meaning.split(' ');
    const bank = [...answer, ...ex.tiles];
    for (let run = 0; run < 40; run++) {
      const first = bankOrder(
        bank,
        answer.length,
        attemptSeeds(ex.id, `r${run}`, retryQueue(4), 0),
      );
      const second = bankOrder(
        bank,
        answer.length,
        attemptSeeds(ex.id, `r${run}`, retryQueue(4), 4),
      );
      for (const order of [first, second]) {
        assert.deepEqual(
          sorted(order),
          bank.map((_, i) => i),
        );
        assert.ok(
          !spellsAnswer(
            order.map((i) => bank[i]),
            answer,
          ),
          `${ex.id} r${run}`,
        );
      }
      assert.notDeepEqual(second, first, `${ex.id} r${run}`);
    }
  }
});

test('a hint never says the answer; without safe words, Poli crosses out a wrong choice', () => {
  const phrase = {
    meaning: 'How are you?',
    roman: 'Tsanga ye?',
    native: 'څنګه یې؟',
  };
  assert.ok(givesAway('Ask “how are you” kindly.', phrase));
  assert.ok(givesAway('Say tsanga ye to a friend.', phrase));
  assert.ok(!givesAway('Ask a friend how they are.', phrase));
  for (const ex of exercises.filter((e) =>
    ['meaning', 'translation', 'context'].includes(e.kind),
  )) {
    const nudge = hintNudge(ex);
    if (nudge) {
      assert.ok(!givesAway(nudge, ex.phrase), ex.id);
      assert.ok(!/source/i.test(nudge), ex.id);
    } else {
      const crossed = crossedOut(ex, `${ex.id}:run:0`);
      assert.ok(ids(ex.options).includes(crossed), ex.id);
      assert.notEqual(crossed, ex.phrase.id, ex.id);
    }
  }
});

test('a context exercise’s scene is its prompt without the closing question', () => {
  assert.equal(
    contextScene('You meet a friend. What do you ask?'),
    'You meet a friend.',
  );
  assert.equal(
    contextScene('Someone asks how you are. What do you say?'),
    'Someone asks how you are.',
  );
  assert.equal(contextScene('What do you say?'), 'What do you say?');
  for (const ex of exercises.filter((e) => e.kind === 'context'))
    assert.ok(!contextScene(ex.prompt).endsWith('?'), ex.prompt);
});

test('plain text is set with curly quotes, apostrophes and dashes', () => {
  assert.equal(
    typeset('Literally "in God\'s protection".'),
    'Literally “in God’s protection”.',
  );
  assert.equal(typeset('four phrases - the ones'), 'four phrases – the ones');
  for (const ex of exercises) {
    assert.ok(!typeset(ex.prompt).includes('"'), ex.prompt);
    assert.ok(!typeset(ex.phrase.note).includes('"'), ex.phrase.note);
  }
});

test('Arabic-script runs inside a note are found whole', () => {
  assert.deepEqual(scriptRuns('The fuller form السلام علیکم is used.'), [
    { text: 'The fuller form ', script: false },
    { text: 'السلام علیکم', script: true },
    { text: ' is used.', script: false },
  ]);
  assert.deepEqual(scriptRuns('No script here.'), [
    { text: 'No script here.', script: false },
  ]);
});

test('wrong-answer feedback names what was picked and what was right', () => {
  const salaam = { roman: 'Salaam', meaning: 'Hello' };
  const manana = { roman: 'Manana', meaning: 'Thank you' };
  assert.deepEqual(wrongChoiceCopy('translation', manana, salaam), {
    picked: 'You picked “Manana”, which means “Thank you”.',
    answer: '“Salaam” means “Hello”.',
  });
  assert.equal(
    wrongChoiceCopy('meaning', manana, salaam).picked,
    'You picked “Thank you”, which is “Manana”.',
  );
});
