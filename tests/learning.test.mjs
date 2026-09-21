import test from 'node:test';
import assert from 'node:assert/strict';
import { courses, evaluate } from '../lib/courses.ts';
import {
  initialState,
  newSession,
  recordAnswer,
  advanceSession,
  lessonKey,
  unlocked,
  parseState,
  localDate,
  streak,
} from '../lib/progress.ts';

test('six complete, sourced lessons with eight exercises each', () => {
  assert.equal(courses.length, 2);
  for (const c of courses) {
    assert.equal(c.lessons.length, 3);
    for (const l of c.lessons) {
      assert.equal(l.exercises.length, 8);
      assert.equal(l.phrases.length, 4);
      assert.equal(new Set(l.exercises.map((e) => e.id)).size, 8);
      for (const p of l.phrases) {
        assert.match(p.source, /^https:\/\//);
        assert.ok(p.native && p.roman && p.note);
      }
    }
  }
});
test('all answer types accept correct answers and reject incorrect answers', () => {
  for (const c of courses)
    for (const l of c.lessons)
      for (const e of l.exercises) {
        const correct =
          e.kind === 'assemble'
            ? e.phrase.meaning.split(' ')
            : e.kind === 'match'
              ? Object.fromEntries(e.options.map((p) => [p.id, p.id]))
              : e.phrase.id;
        assert.equal(evaluate(e, correct), true, e.id);
        assert.equal(
          evaluate(
            e,
            e.kind === 'assemble'
              ? ['incorrect']
              : e.kind === 'match'
                ? {}
                : 'incorrect',
          ),
          false,
          e.id,
        );
      }
  const e = courses[0].lessons[1].exercises.find((e) => e.kind === 'assemble');
  assert.equal(evaluate(e, e.phrase.meaning.split(' ').reverse()), false);
  const m = courses[0].lessons[0].exercises.find((e) => e.kind === 'match');
  const swapped = Object.fromEntries(
    m.options.map((p, i) => [p.id, m.options[(i + 1) % 4].id]),
  );
  assert.equal(evaluate(m, swapped), false);
});
test('both courses unlock sequentially and preserve independent progress', () => {
  let s = initialState();
  let id = 0;
  for (const c of courses) {
    for (const [i, l] of c.lessons.entries()) {
      assert.equal(unlocked(s, c.id, l.id), true);
      if (i < 2) assert.equal(unlocked(s, c.id, c.lessons[i + 1].id), false);
      const key = lessonKey(c.id, l.id);
      s = {
        ...s,
        sessions: {
          ...s.sessions,
          [key]: newSession(c.id, l.id, String(++id)),
        },
      };
      for (let q = 0; q < 8; q++) {
        s.sessions[key] = recordAnswer(s.sessions[key], true);
        s = advanceSession(s, key, '2026-09-08');
      }
      assert.equal(s.sessions[key].done, true);
      assert.equal(s.completed[key], true);
      assert.equal(s.sessions[key].firstCorrect, 8);
    }
  }
  assert.equal(s.xp, 120);
  assert.equal(Object.keys(s.completed).length, 6);
  assert.equal(s.activity['2026-09-08'], 6);
  assert.equal(streak(s.activity, new Date(2026, 8, 8)), 1);
});
test('mistakes reappear and repeated checking cannot duplicate an attempt', () => {
  const key = 'hindko/greetings';
  let s = initialState();
  s.sessions[key] = newSession('hindko', 'greetings', 'mistake');
  s.sessions[key] = recordAnswer(s.sessions[key], false);
  assert.equal(s.sessions[key].queue.length, 9);
  assert.equal(s.sessions[key].queue[8], 0);
  const once = s.sessions[key];
  assert.equal(recordAnswer(once, false), once);
  s = advanceSession(s, key, '2026-09-08');
  for (let i = 1; i < 8; i++) {
    s.sessions[key] = recordAnswer(s.sessions[key], true);
    s = advanceSession(s, key, '2026-09-08');
  }
  assert.equal(s.sessions[key].done, false);
  assert.equal(s.xp, 0);
  s.sessions[key] = recordAnswer(s.sessions[key], false);
  s = advanceSession(s, key, '2026-09-08');
  assert.equal(s.sessions[key].done, false);
  s.sessions[key] = recordAnswer(s.sessions[key], true);
  s = advanceSession(s, key, '2026-09-08');
  assert.equal(s.sessions[key].done, true);
  assert.equal(s.sessions[key].firstCorrect, 7);
  assert.equal(s.sessions[key].attempts, 10);
  assert.equal(s.xp, 20);
});
test('completion reward is idempotent; replay is worth five XP', () => {
  const key = 'pashto/greetings';
  let s = initialState();
  for (const [run, reward] of [
    [1, 20],
    [2, 5],
  ]) {
    s.sessions[key] = newSession('pashto', 'greetings', `run-${run}`);
    for (let q = 0; q < 8; q++) {
      s.sessions[key] = recordAnswer(s.sessions[key], true);
      s = advanceSession(s, key, '2026-09-08');
    }
    assert.equal(s.sessions[key].reward, reward);
    const done = JSON.stringify(s);
    s = advanceSession(s, key, '2026-09-08');
    assert.equal(JSON.stringify(s), done);
    s = parseState(JSON.stringify(s));
    s = advanceSession(s, key, '2026-09-08');
    assert.equal(JSON.stringify(s), done);
  }
  assert.equal(s.xp, 25);
  assert.equal(s.activity['2026-09-08'], 2);
  assert.equal(streak(s.activity, new Date(2026, 8, 8)), 1);
});
test('unfinished lesson and feedback survive serialization', () => {
  const s = initialState();
  s.selected = 'hindko';
  s.prefs.sound = true;
  s.dailyGoal = 3;
  s.sessions['hindko/greetings'] = recordAnswer(
    { ...newSession('hindko', 'greetings', 'resume'), studied: true },
    false,
  );
  assert.deepEqual(parseState(JSON.stringify(s)), s);
});
test('invalid or unavailable storage recovers to defaults', () => {
  for (const raw of [
    null,
    '{broken',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...initialState(), version: 8 }),
    JSON.stringify({ ...initialState(), dailyGoal: 9 }),
    JSON.stringify({ ...initialState(), xp: -10 }),
    JSON.stringify({ ...initialState(), prefs: { sound: 'yes' } }),
  ])
    assert.deepEqual(parseState(raw), initialState());
  const s = initialState();
  s.sessions['hindko/greetings'] = {
    ...newSession('hindko', 'greetings', 'bad'),
    cursor: 999,
  };
  assert.deepEqual(parseState(JSON.stringify(s)), initialState());
});
test('progress from a retired course is dropped without resetting the rest', () => {
  const s = initialState();
  s.xp = 40;
  s.selected = 'urdu';
  s.completed['pashto/greetings'] = true;
  s.completed['urdu/greetings'] = true;
  s.sessions['urdu/greetings'] = newSession('urdu', 'greetings', 'retired');
  s.activity['2026-09-08'] = 2;
  const parsed = parseState(JSON.stringify(s));
  assert.equal(parsed.selected, null);
  assert.equal(parsed.xp, 40);
  assert.deepEqual(parsed.completed, { 'pashto/greetings': true });
  assert.deepEqual(parsed.sessions, {});
  assert.equal(parsed.activity['2026-09-08'], 2);
});
test('local calendar streak survives today, yesterday, month boundaries and resets after gaps', () => {
  assert.equal(localDate(new Date(2026, 0, 2, 0, 1)), '2026-01-02');
  assert.equal(
    streak({ '2026-08-31': 1, '2026-09-01': 2 }, new Date(2026, 8, 1, 23, 59)),
    2,
  );
  assert.equal(
    streak({ '2026-08-31': 1, '2026-09-01': 2 }, new Date(2026, 8, 2, 0, 1)),
    2,
  );
  assert.equal(streak({ '2026-09-01': 1 }, new Date(2026, 8, 3)), 0);
  assert.equal(streak({}, new Date(2026, 8, 8)), 0);
});
test('reset creates independent clean state', () => {
  const a = initialState();
  a.xp = 50;
  a.completed['hindko/greetings'] = true;
  const b = initialState();
  assert.equal(b.xp, 0);
  assert.deepEqual(b.completed, {});
  assert.equal(b.prefs.sound, false);
});
