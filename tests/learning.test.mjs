import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  courses,
  knownLesson,
  lessonSize,
  legacyLessonIds,
  contentVersion,
} from '../lib/content.ts';
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
  migrateV1toV2,
  migrateV2toV3,
  loadProgress,
  exportProgress,
  importProgress,
  mergeProgress,
  hydrateProgress,
  latestStored,
  resetProgress,
  BACKUP_KEY_PREFIX,
  EXPORT_FORMAT,
  INVALID_KEY_PREFIX,
  MVP_RELEASE,
  UNKNOWN_KEY_PREFIX,
  STORAGE_KEY,
  STORAGE_KEY_V1,
  STORAGE_KEY_V2,
} from '../lib/progress.ts';
import { randomId } from '../lib/random-id.ts';

// The content release itself is tested in content-release.test.mjs. The
// tests here take their lessons, and how many exercises each has, from
// whichever release is committed, never from today's demo lessons, so a new
// release keeps them green.

/** XP for the first completion of a lesson; a replay earns 5. */
const FIRST_CLEAR_XP = 20;
/** A lesson of this release, whichever it is, and its size. */
const ONE = {
  course: courses[0].id,
  id: courses[0].lessons[0].id,
  size: courses[0].lessons[0].exercises.length,
};

test('every visible course unlocks sequentially and preserves independent progress', () => {
  let s = initialState();
  let id = 0;
  const lessons = courses.flatMap((c) => c.lessons);
  for (const c of courses) {
    for (const [i, l] of c.lessons.entries()) {
      assert.equal(unlocked(s, c.id, l.id), true);
      const after = c.lessons[i + 1];
      if (after) assert.equal(unlocked(s, c.id, after.id), false);
      const key = lessonKey(c.id, l.id);
      s = {
        ...s,
        sessions: {
          ...s.sessions,
          [key]: newSession(c.id, l.id, String(++id), l.exercises.length),
        },
      };
      for (let q = 0; q < l.exercises.length; q++) {
        s.sessions[key] = recordAnswer(s.sessions[key], true);
        s = advanceSession(s, key, '2026-09-08');
      }
      assert.equal(s.sessions[key].done, true);
      assert.equal(s.completed[key], contentVersion);
      assert.equal(s.sessions[key].firstCorrect, l.exercises.length);
    }
  }
  // A full clear earns the first-clear reward once for every lesson in the
  // release.
  assert.equal(s.xp, FIRST_CLEAR_XP * lessons.length);
  assert.equal(Object.keys(s.completed).length, lessons.length);
  assert.equal(s.activity['2026-09-08'], lessons.length);
  assert.equal(streak(s.activity, new Date(2026, 8, 8)), 1);
});
test('mistakes reappear and repeated checking cannot duplicate an attempt', () => {
  const key = ONE.id;
  let s = initialState();
  s.sessions[key] = newSession(ONE.course, ONE.id, 'mistake', ONE.size);
  s.sessions[key] = recordAnswer(s.sessions[key], false);
  assert.equal(s.sessions[key].queue.length, ONE.size + 1);
  assert.equal(s.sessions[key].queue[ONE.size], 0);
  const once = s.sessions[key];
  assert.equal(recordAnswer(once, false), once);
  s = advanceSession(s, key, '2026-09-08');
  for (let i = 1; i < ONE.size; i++) {
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
  assert.equal(s.sessions[key].firstCorrect, ONE.size - 1);
  assert.equal(s.sessions[key].attempts, ONE.size + 2);
  assert.equal(s.xp, FIRST_CLEAR_XP);
});
test('completion reward is idempotent; replay is worth five XP', () => {
  const key = ONE.id;
  let s = initialState();
  for (const [run, reward] of [
    [1, 20],
    [2, 5],
  ]) {
    s.sessions[key] = newSession(ONE.course, ONE.id, `run-${run}`, ONE.size);
    for (let q = 0; q < ONE.size; q++) {
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
  const [l] = courses[0].lessons;
  const s = initialState();
  // A course this build does not show is kept as the learner's choice.
  s.selected = 'hindko';
  s.prefs.sound = true;
  s.dailyGoal = 3;
  s.sessions[l.id] = recordAnswer(
    {
      ...newSession(courses[0].id, l.id, 'resume', l.exercises.length),
      studied: true,
    },
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
  s.sessions[ONE.id] = {
    ...newSession(ONE.course, ONE.id, 'bad', ONE.size),
    cursor: 999,
  };
  assert.deepEqual(parseState(JSON.stringify(s)), initialState());
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
  a.completed[ONE.id] = contentVersion;
  const b = initialState();
  assert.equal(b.xp, 0);
  assert.deepEqual(b.completed, {});
  assert.equal(b.prefs.sound, false);
});

/**
 * v1 blobs exactly as the MVP stored them, written by the MVP's own code (see
 * tests/fixtures/README.md). Browsers hold them as one line, which is what
 * JSON.stringify gives back from the pretty-printed files.
 */
const fixture = (name) =>
  JSON.stringify(
    JSON.parse(
      readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
    ),
  );
const V1_RAW = fixture('progress-v1-mvp.json');
const legacyState = () => JSON.parse(V1_RAW);
/** The same learner, after carrying on in the MVP during a rollback. */
const V1_AFTER_ROLLBACK_RAW = fixture('progress-v1-mvp-after-rollback.json');
/**
 * v2 blobs written by v0.2's own code (#19), the build before content releases:
 * the same learner after a day on v0.2, and after a rollback of one deploy
 * back to it (tests/fixtures/README.md).
 */
const V2_RAW = fixture('progress-v2.json');
const V2_AFTER_ROLLBACK_RAW = fixture('progress-v2-after-rollback.json');
/**
 * What v0.2 writes to v2 when it is only opened, during a rollback, by a
 * learner who went straight from the MVP to content releases and so had no v2
 * key (tests/fixtures/README.md).
 */
const V2_OPENED_RAW = fixture('progress-v2-opened.json');
/** The permanent id the release's keymap gives an MVP lesson key. */
const lessonOf = (legacy) => legacyLessonIds[legacy] ?? legacy;
/**
 * Plays a lesson to the end with every answer right, with today's lesson code.
 * `size` is how many exercises the lesson had then, by default what this
 * release gives it. What an older build writes comes from the fixtures instead.
 */
function complete(state, course, lesson, id, day, size = lessonSize(lesson)) {
  const key = lessonKey(course, lesson);
  let s = {
    ...state,
    sessions: {
      ...state.sessions,
      [key]: newSession(course, lesson, id, size),
    },
  };
  for (let q = 0; q < size; q++) {
    s.sessions[key] = recordAnswer(s.sessions[key], true);
    s = advanceSession(s, key, day);
  }
  return s;
}
test('a v1 blob migrates to v2 with every field carried across, then to v3', () => {
  const v1 = legacyState();
  const v2 = migrateV1toV2(v1, 'device-1');
  assert.equal(v2.version, 2);
  assert.equal(v2.deviceId, 'device-1');
  assert.equal(v2.userId, null);
  assert.equal(v2.lastSyncedAt, null);
  assert.deepEqual(v2.importedIntoAccounts, []);
  assert.equal(v2.v1Fingerprint, null);
  for (const k of [
    'selected',
    'dailyGoal',
    'xp',
    'completed',
    'activity',
    'rewarded',
    'sessions',
    'prefs',
  ])
    assert.deepEqual(v2[k], v1[k], k);
  // The captured blob really holds what the migration has to carry.
  assert.equal(v2.xp, 65);
  assert.equal(v2.completed['hindko/greetings'], true);
  assert.deepEqual(v2.sessions['pashto/essentials'].feedback, {
    correct: false,
  });
  const v3 = migrateV2toV3(v2);
  assert.equal(v3.version, 3);
  // Completed before content releases existed.
  assert.deepEqual(v3.completed, {
    [lessonOf('pashto/greetings')]: MVP_RELEASE,
    [lessonOf('pashto/introductions')]: MVP_RELEASE,
    [lessonOf('hindko/greetings')]: MVP_RELEASE,
  });
  // Finished runs are kept beside their completions, with the eight
  // exercises they were played with; the unfinished one is not carried over.
  for (const [key, run] of Object.entries(v1.sessions))
    assert.deepEqual(
      v3.sessions[lessonOf(key)],
      run.done ? { ...run, lesson: lessonOf(key), size: 8 } : undefined,
      key,
    );
  assert.equal(v3.xp, 65);
  assert.deepEqual(v3.rewarded, v1.rewarded);
  assert.deepEqual(parseState(V1_RAW, 'device-1'), v3);
});
test('v2 -> v3 keeps every completion: through the keymap, or as it was', () => {
  const unmapped = 'atlantis/greetings';
  assert.equal(legacyLessonIds[unmapped], undefined);
  const v2 = migrateV1toV2(
    {
      ...legacyState(),
      completed: {
        'hindko/greetings': true,
        'pashto/greetings': true,
        [unmapped]: true,
      },
    },
    'd',
  );
  const v3 = migrateV2toV3(v2);
  assert.deepEqual(v3.completed, {
    [lessonOf('hindko/greetings')]: MVP_RELEASE,
    [lessonOf('pashto/greetings')]: MVP_RELEASE,
    [unmapped]: MVP_RELEASE,
  });
  assert.deepEqual(
    parseState(JSON.stringify(v3), 'd'),
    v3,
    'completions the release does not show still read back',
  );
});
/**
 * A learner's record as a later release reads it: `lessons` are two lessons
 * of this release. One was finished, and another started, under a release
 * that gave each `extra` more exercises than this one does.
 */
function underAnotherRelease(extra) {
  const [a, b] = courses.flatMap((c) =>
    c.lessons.map((l) => ({
      course: c.id,
      id: l.id,
      size: l.exercises.length,
    })),
  );
  let s = complete(
    { ...initialState('d'), selected: a.course },
    a.course,
    a.id,
    'finished',
    '2026-09-23',
    a.size + extra,
  );
  s = complete(s, a.course, a.id, 'replayed', '2026-09-24', a.size + extra);
  s.sessions[b.id] = recordAnswer(
    newSession(b.course, b.id, 'unfinished', b.size + extra),
    true,
  );
  return { s, a, b };
}
/** XP, the streak, the award ledger and completions: what must never be lost. */
function assertEarnedKept(read, s) {
  assert.equal(read.xp, s.xp);
  assert.deepEqual(read.activity, s.activity);
  assert.equal(
    streak(read.activity, new Date(2026, 8, 24)),
    streak(s.activity, new Date(2026, 8, 24)),
  );
  assert.deepEqual(read.rewarded, s.rewarded);
  assert.deepEqual(read.completed, s.completed);
}
test("a release that changes a lesson's size keeps everything earned", () => {
  const { s, a, b } = underAnotherRelease(3);
  assert.equal(s.xp, 25);
  assert.equal(streak(s.activity, new Date(2026, 8, 24)), 2);
  const raw = JSON.stringify(s);
  const read = parseState(raw, 'd');
  assertEarnedKept(read, s);
  // The finished run is kept; the unfinished one would now ask different
  // questions, so it alone is left out, and the lesson starts again.
  assert.deepEqual(read.sessions[a.id], s.sessions[a.id]);
  assert.equal(read.sessions[b.id], undefined);
  // Nothing was unreadable, so nothing is set aside, and a second load
  // changes nothing more.
  const loaded = loadProgress(
    { v3: raw, backupExists: true },
    '2026-09-25',
    'd',
  );
  assert.deepEqual(loaded, { state: read, writes: [] });
  assert.deepEqual(parseState(JSON.stringify(read), 'd'), read);
  // A run this release still fits is kept, unfinished or not.
  const same = underAnotherRelease(0).s;
  assert.deepEqual(parseState(JSON.stringify(same), 'd'), same);
});
test('a lesson retired from the release keeps its completion and finished run', () => {
  const retired = 'ps-lsn-000000';
  const alsoRetired = 'ur-lsn-000000';
  assert.equal(knownLesson(retired), false);
  assert.equal(knownLesson(alsoRetired), false);
  const s = complete(
    initialState('d'),
    'pashto',
    retired,
    'r',
    '2026-09-24',
    6,
  );
  s.sessions[alsoRetired] = recordAnswer(
    newSession('urdu', alsoRetired, 'u', 6),
    false,
  );
  const read = parseState(JSON.stringify(s), 'd');
  assertEarnedKept(read, s);
  assert.equal(read.completed[retired], contentVersion);
  assert.deepEqual(read.sessions, { [retired]: s.sessions[retired] });
});
test('an MVP lesson key the keymap does not map is kept as it is', () => {
  const unmapped = 'pashto/a-lesson-no-release-maps';
  assert.equal(legacyLessonIds[unmapped], undefined);
  const v1 = legacyState();
  v1.completed[unmapped] = true;
  v1.sessions[unmapped] = {
    ...v1.sessions['pashto/greetings'],
    id: 'unmapped-run',
    lesson: 'a-lesson-no-release-maps',
  };
  v1.rewarded.push('unmapped-run');
  const read = parseState(JSON.stringify(v1), 'd');
  assert.equal(read.xp, v1.xp);
  assert.deepEqual(read.activity, v1.activity);
  assert.deepEqual(read.rewarded, v1.rewarded);
  assert.deepEqual(
    Object.keys(read.completed).sort(),
    Object.keys(v1.completed).map(lessonOf).sort(),
  );
  assert.equal(read.completed[unmapped], MVP_RELEASE);
  assert.equal(read.sessions[unmapped].id, 'unmapped-run');
  // And it reads back as it is.
  assert.deepEqual(parseState(JSON.stringify(read), 'd'), read);
});
test('an MVP key kept while a release did not map it moves to its permanent id once one does', (t) => {
  const row = Object.entries(legacyLessonIds)[0];
  if (!row) return t.skip('this release maps no MVP lesson');
  const [legacy, id] = row;
  const course = courses.find((c) => c.lessons.some((l) => l.id === id));
  // A v3 record migrated under a release that held this lesson back: that
  // learner copy had no keymap row for it, so the MVP key and its finished
  // run were kept as they were.
  const finished = {
    ...newSession(course.id, legacy, 'mvp-run', 8),
    cursor: 8,
    firstCorrect: 8,
    attempts: 8,
    studied: true,
    done: true,
    reward: 20,
  };
  const held = {
    ...initialState('d'),
    xp: 20,
    completed: { [legacy]: MVP_RELEASE },
    activity: { '2026-09-20': 1 },
    rewarded: ['mvp-run'],
    sessions: { [legacy]: finished },
  };
  // This release maps it, so it is read under the permanent id: the lesson
  // shows as done, and the one after it opens.
  const read = parseState(JSON.stringify(held), 'd');
  assert.deepEqual(read.completed, { [id]: MVP_RELEASE });
  assert.deepEqual(read.sessions, { [id]: { ...finished, lesson: id } });
  assert.equal(read.xp, held.xp);
  assert.deepEqual(read.rewarded, held.rewarded);
  const i = course.lessons.findIndex((l) => l.id === id);
  if (course.lessons[i + 1])
    assert.ok(unlocked(read, course.id, course.lessons[i + 1].id));
  // Reading again, or loading, changes nothing more.
  assert.deepEqual(parseState(JSON.stringify(read), 'd'), read);
  assert.deepEqual(
    loadProgress(
      { v3: JSON.stringify(held), backupExists: true },
      '2026-09-25',
      'd',
    ),
    { state: read, writes: [] },
  );
  // An entry already under the permanent id wins, and keeps its own value.
  const current = newSession(course.id, id, 'current', lessonSize(id));
  const both = parseState(
    JSON.stringify({
      ...held,
      completed: { [id]: 'content@2026.09.1', [legacy]: MVP_RELEASE },
      sessions: { [legacy]: finished, [id]: current },
    }),
    'd',
  );
  assert.deepEqual(both.completed, { [id]: 'content@2026.09.1' });
  assert.deepEqual(both.sessions, { [id]: current });
  // An import is read the same way.
  const imported = importProgress(initialState('d'), JSON.stringify(held));
  assert.ok(imported.ok);
  assert.deepEqual(imported.state.completed, { [id]: MVP_RELEASE });
});
test('an unreadable live record is kept aside before a fresh start, never over another', () => {
  const cases = [
    ['{broken', 'none'],
    [JSON.stringify({ ...initialState('d'), xp: -1 }), '3'],
    [JSON.stringify({ ...initialState('d'), version: 0 }), '0'],
  ];
  for (const [raw, version] of cases)
    assert.deepEqual(
      loadProgress({ v3: raw, backupExists: true }, '2026-09-25', 'd'),
      {
        state: initialState('d'),
        writes: [{ key: `${INVALID_KEY_PREFIX}${version}-1`, value: raw }],
      },
      raw,
    );
  const [[raw]] = cases.slice(1);
  const kept = {
    [INVALID_KEY_PREFIX + '3-1']: 'kept earlier',
    [INVALID_KEY_PREFIX + '3-4']: 'kept earlier still',
  };
  assert.deepEqual(
    loadProgress({ v3: raw, backupExists: true, kept }, '2026-09-25', 'd')
      .writes,
    [{ key: INVALID_KEY_PREFIX + '3-5', value: raw }],
  );
  // Kept already, it is not kept twice.
  assert.deepEqual(
    loadProgress(
      {
        v3: raw,
        backupExists: true,
        kept: { ...kept, [INVALID_KEY_PREFIX + '3-5']: raw },
      },
      '2026-09-25',
      'd',
    ).writes,
    [],
  );
  // Beside it, the older keys still bring their progress back.
  const withV2 = loadProgress(
    { v1: V1_RAW, v2: V2_RAW, v3: raw, backupExists: true },
    '2026-09-25',
    'd',
  );
  assert.equal(withV2.state.xp, JSON.parse(V2_RAW).xp);
  assert.deepEqual(withV2.writes, [
    { key: INVALID_KEY_PREFIX + '3-1', value: raw },
  ]);
});
test('parseState keeps a v3 blob as it is and rejects a damaged one', () => {
  const s = { ...initialState('device-2'), xp: 5 };
  assert.deepEqual(parseState(JSON.stringify(s), 'other'), s);
  assert.equal(
    parseState(JSON.stringify({ ...s, deviceId: '' }), 'filled').deviceId,
    'filled',
  );
  const { v1Fingerprint, ...withoutFingerprint } = s;
  assert.equal(v1Fingerprint, null);
  assert.deepEqual(parseState(JSON.stringify(withoutFingerprint), 'other'), s);
  for (const bad of [
    { ...s, deviceId: 7 },
    { ...s, userId: 3 },
    { ...s, lastSyncedAt: 0 },
    { ...s, importedIntoAccounts: 'x' },
  ])
    assert.deepEqual(parseState(JSON.stringify(bad), 'd'), initialState('d'));
});
test('first load backs up the v1 blob verbatim, exactly once, before migrating', () => {
  const first = loadProgress(
    { v1: V1_RAW, v2: null, backupExists: false },
    '2026-09-23',
    'dev',
  );
  assert.deepEqual(first.writes, [
    { key: BACKUP_KEY_PREFIX + '2026-09-23', value: V1_RAW },
  ]);
  assert.deepEqual(first.state, {
    ...migrateV2toV3(migrateV1toV2(legacyState(), 'dev')),
    v1Fingerprint: first.state.v1Fingerprint,
  });
  assert.equal(typeof first.state.v1Fingerprint, 'string');
  const again = loadProgress(
    { v1: V1_RAW, v2: null, backupExists: true },
    '2026-09-24',
    'dev',
  );
  assert.deepEqual(again.writes, []);
  assert.deepEqual(again.state, first.state);
});
test('progress an older build writes to v1 after the migration is merged back in', () => {
  const first = loadProgress(
    { v1: V1_RAW, v2: null, backupExists: false },
    '2026-09-23',
    'dev',
  );
  // On this build the learner finishes an Urdu lesson; only the v3 key
  // changes.
  const onV3 = complete(
    first.state,
    'urdu',
    lessonOf('urdu/greetings'),
    'v3-run',
    '2026-09-24',
  );
  // Rolled back past v0.2, the MVP read v1 as it was, finished the Pashto
  // lesson left half-way, and wrote v1 again (tests/fixtures/README.md).
  const rolledBack = JSON.parse(V1_AFTER_ROLLBACK_RAW);
  const finishedRun = legacyState().sessions['pashto/essentials'].id;
  const forward = loadProgress(
    { v1: V1_AFTER_ROLLBACK_RAW, v3: JSON.stringify(onV3), backupExists: true },
    '2026-09-26',
    'ignored',
  );
  assert.deepEqual(forward.writes, []);
  const s = forward.state;
  assert.equal(s.deviceId, 'dev');
  assert.equal(s.completed[lessonOf('urdu/greetings')], contentVersion);
  assert.equal(s.completed[lessonOf('pashto/essentials')], MVP_RELEASE);
  assert.equal(s.completed[lessonOf('hindko/greetings')], MVP_RELEASE);
  assert.equal(s.activity['2026-09-24'], 1);
  assert.equal(s.activity['2026-09-25'], 1);
  assert.ok(s.rewarded.includes('v3-run'));
  assert.ok(s.rewarded.includes(finishedRun));
  assert.equal(s.xp, Math.max(onV3.xp, rolledBack.xp));
  assert.notEqual(s.v1Fingerprint, first.state.v1Fingerprint);
  // Loading again changes nothing.
  const twice = loadProgress(
    { v1: V1_AFTER_ROLLBACK_RAW, v3: JSON.stringify(s), backupExists: true },
    '2026-09-27',
    'ignored',
  );
  assert.deepEqual(twice, { state: s, writes: [] });
});
test('a run finished and started again elsewhere replaces the unfinished copy here', () => {
  // Here, a run left after one answer. Elsewhere, that run was finished and
  // the lesson started again.
  const c = courses[0];
  const l = c.lessons[0];
  const key = lessonKey(c.id, l.id);
  const size = l.exercises.length;
  const start = (state, id) => ({
    ...state,
    sessions: { ...state.sessions, [key]: newSession(c.id, l.id, id, size) },
  });
  const answer = (state, day = '2026-09-26') => {
    const s = { ...state, sessions: { ...state.sessions } };
    s.sessions[key] = recordAnswer(s.sessions[key], true);
    return advanceSession(s, key, day);
  };
  const here = answer(start(initialState('here'), 'run-1'));
  let there = { ...here, deviceId: 'there' };
  while (!there.sessions[key].done) there = answer(there, '2026-09-25');
  there = answer(start(there, 'run-2'));
  const s = mergeProgress(here, there);
  assert.deepEqual(s.sessions[key], there.sessions[key]);
  // The learner can play it to the end, for a replay's 5 XP.
  let t = s;
  while (!t.sessions[key].done) t = answer(t);
  assert.equal(t.sessions[key].reward, 5);
  assert.equal(t.xp, s.xp + 5);
  // Merging the same state again, or the two the other way round as an
  // import would, keeps the newer run too.
  assert.deepEqual(mergeProgress(s, there), s);
  assert.deepEqual(
    mergeProgress(there, here).sessions[key],
    there.sessions[key],
  );
});
test('a v1 blob this build cannot read is left for a build that can', () => {
  // Say an older build wrote a run in a shape this one cannot read.
  const old = legacyState();
  old.sessions['pashto/essentials'].queue = 'a shape from elsewhere';
  const unreadable = JSON.stringify(old);
  const first = loadProgress(
    { v1: unreadable, v2: null, backupExists: false },
    '2026-09-23',
    'dev',
  );
  assert.deepEqual(first, {
    state: initialState('dev'),
    writes: [{ key: BACKUP_KEY_PREFIX + '2026-09-23', value: unreadable }],
  });
  // It is not recorded as merged, and loading again changes nothing.
  const again = loadProgress(
    { v1: unreadable, v3: JSON.stringify(first.state), backupExists: true },
    '2026-09-24',
    'dev',
  );
  assert.deepEqual(again, { state: first.state, writes: [] });
  // So once the v1 key holds progress that can be read, it is merged in.
  const readable = loadProgress(
    { v1: V1_RAW, v3: JSON.stringify(again.state), backupExists: true },
    '2026-09-25',
    'dev',
  ).state;
  assert.equal(readable.xp, 65);
  // After a merge, an unreadable blob leaves the last fingerprint in place.
  assert.deepEqual(
    loadProgress(
      { v1: unreadable, v3: JSON.stringify(readable), backupExists: true },
      '2026-09-26',
      'dev',
    ).state,
    readable,
  );
});
test('a reset stays reset across reloads, though the v1 key is still there', () => {
  const first = loadProgress(
    { v1: V1_RAW, v2: null, backupExists: false },
    '2026-09-23',
    'dev',
  );
  const reset = resetProgress(first.state);
  assert.deepEqual(reset, {
    ...initialState('dev'),
    v1Fingerprint: first.state.v1Fingerprint,
  });
  const reload = loadProgress(
    { v1: V1_RAW, v3: JSON.stringify(reset), backupExists: true },
    '2026-09-24',
    'dev',
  );
  assert.deepEqual(reload, { state: reset, writes: [] });
  // An older build writing to v1 after the reset is still merged back in. The
  // v1 blob is a whole state, so what it held before the reset returns with it.
  const merged = loadProgress(
    {
      v1: V1_AFTER_ROLLBACK_RAW,
      v3: JSON.stringify(reset),
      backupExists: true,
    },
    '2026-09-26',
    'dev',
  ).state;
  assert.equal(merged.completed[lessonOf('pashto/essentials')], MVP_RELEASE);
  assert.equal(merged.completed[lessonOf('pashto/greetings')], MVP_RELEASE);
  assert.equal(merged.xp, 85);
});
test('the v2 state moves to its own key, and nothing writes v2 again', () => {
  const storage = stubStorage({
    [STORAGE_KEY_V1]: V1_RAW,
    [BACKUP_KEY_PREFIX + '2026-09-22']: V1_RAW,
    [STORAGE_KEY_V2]: V2_RAW,
  });
  const r = hydrateProgress(storage, '2026-09-25', () => 'new-device');
  assert.equal(r.persist, true);
  assert.deepEqual(storage.writes, []);
  const v2 = JSON.parse(V2_RAW);
  assert.deepEqual(r.state, {
    ...migrateV2toV3(v2),
    v2Fingerprint: r.state.v2Fingerprint,
  });
  assert.equal(typeof r.state.v2Fingerprint, 'string');
  assert.equal(r.state.deviceId, v2.deviceId);
  assert.equal(r.state.xp, v2.xp);
  // v0.2 had already merged this v1 blob, so it is not merged again.
  assert.equal(r.state.v1Fingerprint, v2.v1Fingerprint);
  // The provider writes only the live key, and the live key is not v2.
  const provider = readFileSync(
    new URL('../components/learning-provider.tsx', import.meta.url),
    'utf8',
  );
  assert.deepEqual(provider.match(/setItem\([^,]*/g), ['setItem(STORAGE_KEY']);
  assert.notEqual(STORAGE_KEY, STORAGE_KEY_V2);
  storage.setItem(STORAGE_KEY, JSON.stringify(r.state));
  // Loading again changes nothing, and v2 is still exactly as v0.2 left it.
  const again = hydrateProgress(storage, '2026-09-26', () => 'new-device');
  assert.deepEqual(again.state, r.state);
  assert.deepEqual(storage.writes, [STORAGE_KEY]);
  assert.equal(storage.data.get(STORAGE_KEY_V2), V2_RAW);
});
test('a rollback of one deploy finds v2 intact, and what it adds there is merged back', () => {
  // The first load of this build, then a lesson replayed on it.
  const first = loadProgress(
    { v1: V1_RAW, v2: V2_RAW, backupExists: true },
    '2026-09-25',
    'ignored',
  );
  assert.deepEqual(first.writes, []);
  const c = courses[0];
  const onV3 = complete(
    first.state,
    c.id,
    c.lessons[0].id,
    'v3-run',
    '2026-09-26',
  );
  // Rolled back, v0.2 found v2 as it had left it, since this build never
  // writes it, carried on there and wrote v2 again (tests/fixtures/README.md).
  const back = JSON.parse(V2_AFTER_ROLLBACK_RAW);
  const stored = {
    v1: V1_RAW,
    v2: V2_AFTER_ROLLBACK_RAW,
    v3: JSON.stringify(onV3),
    backupExists: true,
  };
  const forward = loadProgress(stored, '2026-09-28', 'ignored');
  assert.deepEqual(forward.writes, []);
  const s = forward.state;
  assert.equal(s.deviceId, onV3.deviceId);
  for (const key of Object.keys(back.completed))
    assert.ok(s.completed[lessonOf(key)], key);
  for (const key of Object.keys(onV3.completed)) assert.ok(s.completed[key]);
  for (const id of [...back.rewarded, ...onV3.rewarded])
    assert.ok(s.rewarded.includes(id), id);
  assert.equal(s.xp, Math.max(onV3.xp, back.xp));
  assert.equal(s.activity['2026-09-26'], 1);
  assert.equal(s.activity['2026-09-27'], back.activity['2026-09-27']);
  // The streak runs across the days on both builds.
  assert.equal(streak(s.activity, new Date(2026, 8, 27)), 2);
  assert.notEqual(s.v2Fingerprint, first.state.v2Fingerprint);
  assert.equal(s.v1Fingerprint, first.state.v1Fingerprint);
  // Loading again changes nothing.
  assert.deepEqual(
    loadProgress({ ...stored, v3: JSON.stringify(s) }, '2026-09-29', 'ignored'),
    { state: s, writes: [] },
  );
});
test('a reset stays reset with the v2 key still there', () => {
  const first = loadProgress(
    { v1: V1_RAW, v2: V2_RAW, backupExists: true },
    '2026-09-25',
    'ignored',
  ).state;
  const reset = resetProgress(first);
  assert.deepEqual(reset, {
    ...initialState(first.deviceId),
    v1Fingerprint: first.v1Fingerprint,
    v2Fingerprint: first.v2Fingerprint,
  });
  const stored = {
    v1: V1_RAW,
    v2: V2_RAW,
    v3: JSON.stringify(reset),
    backupExists: true,
  };
  assert.deepEqual(loadProgress(stored, '2026-09-26', 'ignored'), {
    state: reset,
    writes: [],
  });
  // What v0.2 writes to v2 after the reset, during a rollback, still comes
  // back. The v2 blob is a whole state, so it brings what it held before.
  const merged = loadProgress(
    { ...stored, v2: V2_AFTER_ROLLBACK_RAW },
    '2026-09-28',
    'ignored',
  ).state;
  assert.equal(merged.xp, JSON.parse(V2_AFTER_ROLLBACK_RAW).xp);
});
test('a reset stays reset when a rollback only opens v0.2 where there was no v2 key', () => {
  // Straight from the MVP to content releases: a v1 key and no v2 key.
  const first = loadProgress(
    { v1: V1_RAW, backupExists: false },
    '2026-09-25',
    'dev',
  ).state;
  assert.equal(first.v2Fingerprint, null);
  const reset = resetProgress(first);
  // Rolled back, v0.2 migrated the v1 key and saved it to v2 as soon as it
  // was opened, and the learner did nothing more.
  const opened = JSON.parse(V2_OPENED_RAW);
  assert.equal(opened.v1Fingerprint, first.v1Fingerprint);
  const stored = {
    v1: V1_RAW,
    v2: V2_OPENED_RAW,
    v3: JSON.stringify(reset),
    backupExists: true,
  };
  const forward = loadProgress(stored, '2026-09-28', 'dev');
  assert.deepEqual(forward.writes, []);
  // Its fingerprint is recorded, and nothing of it is merged.
  assert.equal(typeof forward.state.v2Fingerprint, 'string');
  assert.deepEqual(forward.state, {
    ...reset,
    v2Fingerprint: forward.state.v2Fingerprint,
  });
  assert.deepEqual(
    loadProgress(
      { ...stored, v3: JSON.stringify(forward.state) },
      '2026-09-29',
      'dev',
    ),
    { state: forward.state, writes: [] },
  );
  // Without a reset it adds nothing either.
  const kept = loadProgress(
    { ...stored, v3: JSON.stringify(first) },
    '2026-09-28',
    'dev',
  ).state;
  assert.deepEqual(kept, { ...first, v2Fingerprint: kept.v2Fingerprint });
  // The same through hydration, with the keys a real browser would hold.
  const storage = stubStorage({
    [STORAGE_KEY_V1]: V1_RAW,
    [BACKUP_KEY_PREFIX + '2026-09-25']: V1_RAW,
    [STORAGE_KEY_V2]: V2_OPENED_RAW,
    [STORAGE_KEY]: JSON.stringify(reset),
  });
  const hydrated = hydrateProgress(storage, '2026-09-28', () => 'new');
  assert.equal(hydrated.persist, true);
  assert.deepEqual(hydrated.state, forward.state);
  assert.deepEqual(storage.writes, []);
});
test('what v0.2 adds where there was no v2 key is still merged back after a reset', () => {
  const first = loadProgress(
    { v1: V1_RAW, backupExists: false },
    '2026-09-25',
    'dev',
  ).state;
  const reset = resetProgress(first);
  // progress-v2.json is v0.2 opened with only the v1 key, as here, after
  // which the learner finished the first Urdu lesson on it.
  const v2 = JSON.parse(V2_RAW);
  assert.equal(v2.v1Fingerprint, first.v1Fingerprint);
  const merged = loadProgress(
    { v1: V1_RAW, v2: V2_RAW, v3: JSON.stringify(reset), backupExists: true },
    '2026-09-28',
    'dev',
  ).state;
  assert.equal(merged.completed[lessonOf('urdu/greetings')], MVP_RELEASE);
  assert.equal(merged.xp, v2.xp);
  for (const id of v2.rewarded) assert.ok(merged.rewarded.includes(id), id);
  assert.equal(merged.activity['2026-09-22'], v2.activity['2026-09-22']);
});
test('a blob from a newer app version is kept aside, not discarded', () => {
  const future = JSON.stringify({
    ...initialState('dev'),
    version: 4,
    somethingNew: true,
  });
  const r = loadProgress(
    { v1: null, v3: future, backupExists: true },
    '2026-09-23',
    'dev',
  );
  assert.deepEqual(r.state, initialState('dev'));
  assert.deepEqual(r.writes, [
    { key: UNKNOWN_KEY_PREFIX + '4', value: future },
  ]);
  assert.notEqual(STORAGE_KEY, STORAGE_KEY_V1);
  // Beside a v1 blob, the newer blob is kept aside just the same, and the
  // learner sees their pre-v0.2 progress instead of a fresh start.
  const withV1 = loadProgress(
    { v1: V1_RAW, v3: future, backupExists: true },
    '2026-09-23',
    'dev',
  );
  assert.deepEqual(withV1.writes, r.writes);
  assert.deepEqual(withV1.state, {
    ...migrateV2toV3(migrateV1toV2(legacyState(), 'dev')),
    v1Fingerprint: withV1.state.v1Fingerprint,
  });
  assert.equal(typeof withV1.state.v1Fingerprint, 'string');
});
test('a newer blob in any key is kept aside once, and never over another', () => {
  const newer = (version, extra = {}) =>
    JSON.stringify({ ...initialState('dev'), version, ...extra });
  const r = loadProgress(
    { v1: V1_RAW, v2: newer(5), v3: newer(4), backupExists: true },
    '2026-09-25',
    'dev',
  );
  assert.deepEqual(r.writes, [
    { key: UNKNOWN_KEY_PREFIX + '4', value: newer(4) },
    { key: UNKNOWN_KEY_PREFIX + '5', value: newer(5) },
  ]);
  // Neither is read: the learner sees the v1 progress.
  assert.equal(r.state.xp, 65);
  // Kept already, so the next load writes nothing.
  const kept = Object.fromEntries(r.writes.map((w) => [w.key, w.value]));
  assert.deepEqual(
    loadProgress(
      { v1: V1_RAW, v2: newer(5), v3: newer(4), backupExists: true, kept },
      '2026-09-26',
      'dev',
    ).writes,
    [],
  );
  // A different blob of a version already kept aside goes beside it.
  const other = newer(4, { xp: 9 });
  assert.deepEqual(
    loadProgress({ v3: other, backupExists: true, kept }, '2026-09-26', 'dev')
      .writes,
    [{ key: UNKNOWN_KEY_PREFIX + '4-1', value: other }],
  );
});
test('export then import round-trips, and importing twice changes nothing', () => {
  const source = migrateV2toV3(migrateV1toV2(legacyState(), 'source'));
  const file = exportProgress(source, '2026-09-23T10:00:00.000Z');
  const fresh = initialState('target');
  const once = importProgress(fresh, file);
  assert.equal(once.ok, true);
  assert.equal(once.state.deviceId, 'target');
  assert.equal(once.state.xp, 65);
  assert.deepEqual(once.state.completed, source.completed);
  assert.deepEqual(once.state.activity, source.activity);
  assert.deepEqual(once.state.rewarded, source.rewarded);
  assert.deepEqual(once.state.sessions, source.sessions);
  assert.equal(once.state.selected, 'pashto');
  assert.deepEqual(once.state.prefs, fresh.prefs);
  assert.equal(once.state.dailyGoal, fresh.dailyGoal);
  const twice = importProgress(once.state, file);
  assert.deepEqual(twice.state, once.state);
  assert.equal(importProgress(fresh, V1_RAW).ok, true);
});
test("an export keeps the device's accounts, and an import never takes them on", () => {
  const synced = {
    ...migrateV2toV3(migrateV1toV2(legacyState(), 'source')),
    userId: 'account-a',
    lastSyncedAt: '2026-09-27T09:00:00.000Z',
    importedIntoAccounts: ['account-a'],
  };
  // The file is the state exactly as stored, account bookkeeping included.
  const file = exportProgress(synced, '2026-09-27T10:00:00.000Z');
  assert.deepEqual(JSON.parse(file).state.importedIntoAccounts, ['account-a']);
  assert.equal(JSON.parse(file).state.userId, 'account-a');
  // A device that never synced takes the progress but claims no account.
  const fresh = importProgress(initialState('target'), file);
  assert.equal(fresh.ok, true);
  assert.deepEqual(fresh.state.importedIntoAccounts, []);
  assert.equal(fresh.state.userId, null);
  assert.equal(fresh.state.lastSyncedAt, null);
  assert.deepEqual(fresh.state.completed, synced.completed);
  // A device synced to another account keeps its own.
  const other = {
    ...initialState('other'),
    userId: 'account-b',
    lastSyncedAt: '2026-09-26T08:00:00.000Z',
    importedIntoAccounts: ['account-b'],
  };
  const merged = importProgress(other, file);
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.state.importedIntoAccounts, ['account-b']);
  assert.equal(merged.state.userId, 'account-b');
  assert.equal(merged.state.lastSyncedAt, '2026-09-26T08:00:00.000Z');
  // mergeProgress directly, as loadProgress() uses it, is the same.
  assert.deepEqual(mergeProgress(other, synced).importedIntoAccounts, [
    'account-b',
  ]);
});
test("an old export imports: from v0.2, or with an older release's lessons", () => {
  const here = initialState('here');
  // An export made on v0.2 (#19), before content releases.
  const fromV2 = importProgress(
    here,
    JSON.stringify({
      format: EXPORT_FORMAT,
      exportedAt: '2026-09-22T18:00:00.000Z',
      state: JSON.parse(V2_RAW),
    }),
  );
  assert.equal(fromV2.ok, true);
  const v2 = JSON.parse(V2_RAW);
  assert.equal(fromV2.state.xp, v2.xp);
  assert.deepEqual(
    fromV2.state.completed,
    Object.fromEntries(
      Object.keys(v2.completed).map((key) => [lessonOf(key), MVP_RELEASE]),
    ),
  );
  // An export made under a release that had a lesson this one has retired,
  // and gave another lesson three more exercises.
  const [l] = courses[0].lessons;
  const retired = 'ps-lsn-000000';
  let old = complete(
    initialState('there'),
    'pashto',
    retired,
    'r',
    '2026-09-20',
    6,
  );
  old = complete(
    old,
    courses[0].id,
    l.id,
    'f',
    '2026-09-21',
    l.exercises.length + 3,
  );
  old.sessions[l.id] = newSession(
    courses[0].id,
    l.id,
    'u',
    l.exercises.length + 3,
  );
  const fromOld = importProgress(
    here,
    exportProgress(old, '2026-09-21T18:00:00.000Z'),
  );
  assert.equal(fromOld.ok, true);
  assert.equal(fromOld.state.xp, old.xp);
  assert.deepEqual(fromOld.state.completed, old.completed);
  assert.deepEqual(fromOld.state.rewarded, old.rewarded);
  assert.deepEqual(fromOld.state.activity, old.activity);
  assert.deepEqual(fromOld.state.sessions, {
    [retired]: old.sessions[retired],
  });
});
test('a completion records the content release it was first completed in', () => {
  const c = courses[0];
  const [l] = c.lessons;
  let s = complete(initialState('d'), c.id, l.id, 'first', '2026-09-24');
  assert.equal(s.completed[l.id], contentVersion);
  // A replay under a later release keeps the first one.
  s = {
    ...s,
    sessions: {
      ...s.sessions,
      [l.id]: newSession(c.id, l.id, 'replay', l.exercises.length),
    },
  };
  for (let q = 0; q < l.exercises.length; q++) {
    s.sessions[l.id] = recordAnswer(s.sessions[l.id], true);
    s = advanceSession(s, l.id, '2026-12-01', 'content@2026.12.1');
  }
  assert.equal(s.sessions[l.id].reward, 5);
  assert.equal(s.completed[l.id], contentVersion);
  // It is still what unlocks the next lesson.
  if (c.lessons[1]) assert.equal(unlocked(s, c.id, c.lessons[1].id), true);
  // Any release name reads back; an empty one, or a number, is not a release.
  const named = {
    ...initialState('d'),
    completed: { [l.id]: 'content@2031.01.7+preview' },
  };
  assert.deepEqual(parseState(JSON.stringify(named), 'd'), named);
  for (const bad of ['', 7, null])
    assert.deepEqual(
      parseState(
        JSON.stringify({ ...initialState('d'), completed: { [l.id]: bad } }),
        'd',
      ),
      initialState('d'),
      String(bad),
    );
  // The export carries it, and an early export's `true` imports as the MVP's.
  const round = importProgress(
    initialState('here'),
    exportProgress(s, '2026-12-01T10:00:00.000Z'),
  );
  assert.equal(round.state.completed[l.id], contentVersion);
  const early = importProgress(
    initialState('here'),
    exportProgress(
      { ...initialState('there'), completed: { [l.id]: true, gone: false } },
      '2026-09-23T10:00:00.000Z',
    ),
  );
  assert.deepEqual(early.state.completed, { [l.id]: MVP_RELEASE });
});
test('only a file that is not a progress export is called one', () => {
  const fresh = initialState('target');
  const why = (raw) => {
    const r = importProgress(fresh, raw);
    assert.equal(r.ok, false, raw);
    return r.reason;
  };
  for (const raw of ['{nope', '"text"', '[]', '{}', '{"name":"PoliLingo"}'])
    assert.equal(why(raw), 'not-progress', raw);
  for (const raw of [
    JSON.stringify({ format: 'polilingo.progress.export@2', state: {} }),
    JSON.stringify({ ...initialState(), version: 4 }),
    exportProgress({ ...initialState(), version: 4 }, '2027-01-01'),
  ])
    assert.equal(why(raw), 'newer', raw);
  for (const raw of [
    JSON.stringify({ format: EXPORT_FORMAT, state: {} }),
    JSON.stringify({ format: EXPORT_FORMAT }),
    JSON.stringify({ ...initialState(), xp: -5 }),
    exportProgress({ ...initialState(), dailyGoal: 9 }, '2026-09-25'),
  ])
    assert.equal(why(raw), 'damaged', raw);
});
test('merging never loses progress: sets grow, counts take the maximum, finished beats unfinished', () => {
  // Another lesson, whichever: merging never asks the release.
  const OTHER = 'xx-lsn-000001';
  const local = {
    ...initialState('l'),
    xp: 30,
    completed: { [ONE.id]: 'content@2026.09.1' },
    activity: { '2026-09-20': 1, '2026-09-21': 3 },
    rewarded: ['a'],
    sessions: {
      [ONE.id]: {
        ...newSession(ONE.course, ONE.id, 'a', ONE.size),
        cursor: ONE.size - 1,
        studied: true,
      },
    },
  };
  const incoming = {
    ...initialState('i'),
    xp: 20,
    completed: { [ONE.id]: MVP_RELEASE, [OTHER]: 'content@2026.10.1' },
    activity: { '2026-09-21': 1, '2026-09-22': 2 },
    rewarded: ['a', 'b'],
    sessions: {
      [ONE.id]: {
        ...newSession(ONE.course, ONE.id, 'a', ONE.size),
        cursor: ONE.size,
        done: true,
        reward: 20,
        firstCorrect: ONE.size,
        attempts: ONE.size,
        studied: true,
      },
    },
  };
  const merged = mergeProgress(local, incoming);
  assert.equal(merged.xp, 30);
  // A union; a lesson completed on both sides keeps the release recorded here.
  assert.deepEqual(merged.completed, {
    [ONE.id]: 'content@2026.09.1',
    [OTHER]: 'content@2026.10.1',
  });
  assert.deepEqual(merged.activity, {
    '2026-09-20': 1,
    '2026-09-21': 3,
    '2026-09-22': 2,
  });
  assert.deepEqual(merged.rewarded, ['a', 'b']);
  assert.equal(merged.sessions[ONE.id].done, true);
  assert.equal(merged.deviceId, 'l');
  assert.deepEqual(mergeProgress(merged, incoming), merged);
});
/**
 * A stand-in for localStorage that records every write, and can refuse writes
 * or reads of chosen keys, or refuse to be read at all, as real browsers do.
 */
function stubStorage(
  entries,
  { refuseWrite = () => false, refuseRead = () => false, blocked = false } = {},
) {
  const data = new Map(Object.entries(entries));
  const writes = [];
  const read = (refuse = blocked) => {
    if (refuse)
      throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return {
    data,
    writes,
    get length() {
      read();
      return data.size;
    },
    key(i) {
      read();
      return [...data.keys()][i] ?? null;
    },
    getItem(k) {
      read(blocked || refuseRead(k));
      return data.get(k) ?? null;
    },
    setItem(k, v) {
      if (refuseWrite(k))
        throw new DOMException(
          'The quota has been exceeded.',
          'QuotaExceededError',
        );
      writes.push(k);
      data.set(k, v);
    },
  };
}
test('hydration makes the backup itself before the live key may be written', () => {
  const storage = stubStorage({ [STORAGE_KEY_V1]: V1_RAW });
  const r = hydrateProgress(storage, '2026-09-24', () => 'dev');
  assert.equal(r.persist, true);
  assert.deepEqual(storage.writes, [BACKUP_KEY_PREFIX + '2026-09-24']);
  assert.equal(storage.data.get(BACKUP_KEY_PREFIX + '2026-09-24'), V1_RAW);
  assert.equal(r.state.xp, 65);
  assert.equal(r.state.deviceId, 'dev');
});
test('a backup that cannot be written keeps progress on screen and the live key unwritten', () => {
  const storage = stubStorage(
    { [STORAGE_KEY_V1]: V1_RAW },
    { refuseWrite: (k) => k.startsWith(BACKUP_KEY_PREFIX) },
  );
  const r = hydrateProgress(storage, '2026-09-24', () => 'dev');
  assert.equal(r.persist, false);
  assert.equal(r.state.xp, 65);
  assert.deepEqual(
    r.state.completed,
    migrateV2toV3(migrateV1toV2(legacyState(), 'dev')).completed,
  );
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.data.has(STORAGE_KEY), false);
  assert.equal(storage.data.get(STORAGE_KEY_V1), V1_RAW);
});
test('a newer blob that cannot be stashed stays where it is', () => {
  const future = JSON.stringify({ ...initialState('dev'), version: 4 });
  const storage = stubStorage(
    {
      [STORAGE_KEY]: future,
      [STORAGE_KEY_V1]: V1_RAW,
      [BACKUP_KEY_PREFIX + '2026-09-23']: V1_RAW,
    },
    { refuseWrite: (k) => k.startsWith(UNKNOWN_KEY_PREFIX) },
  );
  const r = hydrateProgress(storage, '2026-09-24', () => 'dev');
  assert.equal(r.persist, false);
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.data.get(STORAGE_KEY), future);
  // The learner still sees their older progress rather than nothing.
  assert.equal(r.state.xp, 65);
});
test('an unreadable live record is kept aside first, or not written over at all', () => {
  const damaged = JSON.stringify({ ...initialState('dev'), xp: -1 });
  const refusing = stubStorage(
    { [STORAGE_KEY]: damaged },
    { refuseWrite: (k) => k.startsWith(INVALID_KEY_PREFIX) },
  );
  const refused = hydrateProgress(refusing, '2026-09-25', () => 'dev');
  assert.equal(refused.persist, false);
  assert.deepEqual(refusing.writes, []);
  assert.equal(refusing.data.get(STORAGE_KEY), damaged);
  const storage = stubStorage({ [STORAGE_KEY]: damaged });
  const r = hydrateProgress(storage, '2026-09-25', () => 'dev');
  assert.equal(r.persist, true);
  assert.deepEqual(storage.writes, [INVALID_KEY_PREFIX + '3-1']);
  assert.equal(storage.data.get(INVALID_KEY_PREFIX + '3-1'), damaged);
});
test('hydration reads what is already kept aside, so it keeps a blob only once', () => {
  const future = JSON.stringify({ ...initialState('dev'), version: 4 });
  const storage = stubStorage({
    [STORAGE_KEY]: future,
    [UNKNOWN_KEY_PREFIX + '4']: future,
  });
  const r = hydrateProgress(storage, '2026-09-24', () => 'dev');
  assert.equal(r.persist, true);
  assert.deepEqual(storage.writes, []);
});
test('storage that cannot be read runs the session in memory and writes nothing', () => {
  const entries = { [STORAGE_KEY_V1]: V1_RAW };
  const storages = [
    stubStorage(entries, { blocked: true }),
    // Listing the keys works, but reading any of them fails.
    stubStorage(entries, { refuseRead: () => true }),
    // The v1 key reads, then the read of the live key fails part-way.
    stubStorage(entries, { refuseRead: (k) => k === STORAGE_KEY }),
  ];
  for (const s of [...storages, null]) {
    const r = hydrateProgress(s, '2026-09-24', () => 'dev');
    assert.equal(r.persist, false);
    assert.deepEqual(r.state, initialState('dev'));
  }
  for (const s of storages) assert.deepEqual(s.writes, []);
});
test('hydration survives an ID generator that throws', () => {
  const storage = stubStorage({ [STORAGE_KEY_V1]: V1_RAW });
  const r = hydrateProgress(storage, '2026-09-24', () => {
    throw new TypeError('crypto.randomUUID is not a function');
  });
  assert.equal(r.persist, true);
  assert.equal(r.state.xp, 65);
  assert.equal(r.state.deviceId, '');
  const next = loadProgress(
    { v1: V1_RAW, v3: JSON.stringify(r.state), backupExists: true },
    '2026-09-25',
    'later',
  );
  assert.equal(next.state.deviceId, 'later');
});
test('randomId falls back when randomUUID is missing or throws', () => {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.equal(randomId({ randomUUID: () => 'from-crypto' }), 'from-crypto');
  const bytes = { getRandomValues: (a) => crypto.getRandomValues(a) };
  const refuse = () => {
    throw new Error('refused');
  };
  for (const source of [
    bytes, // plain http on a LAN address: no randomUUID
    { ...bytes, randomUUID: refuse },
    { getRandomValues: refuse },
    {}, // no Web Crypto at all
  ]) {
    const id = randomId(source);
    assert.match(id, uuid);
    assert.notEqual(randomId(source), id);
  }
  assert.match(randomId(), uuid);
});

test('a change in an idle tab keeps the lessons another tab saved', () => {
  const [a, b, c] = courses.flatMap((course) =>
    course.lessons.map((l) => ({ course: course.id, id: l.id })),
  );
  const day = '2026-09-24';
  // Tab B loaded earlier and holds one lesson; tab A then finished two more
  // and saved them to the live key.
  const tabB = complete(
    { ...initialState('d'), selected: a.course },
    a.course,
    a.id,
    'first',
    day,
  );
  const tabA = complete(
    complete(tabB, b.course, b.id, 'second', day),
    c.course,
    c.id,
    'third',
    day,
  );
  const storage = {
    getItem: (key) => (key === STORAGE_KEY ? JSON.stringify(tabA) : null),
  };

  // A release activating in tab B starts from both, so its write loses nothing.
  const next = latestStored(tabB, storage);
  const sorted = (list) => [...list].sort((p, q) => p.localeCompare(q));
  assert.deepEqual(
    sorted(Object.keys(next.completed)),
    sorted(Object.keys(tabA.completed)),
  );
  assert.deepEqual(sorted(next.rewarded), sorted(tabA.rewarded));
  assert.equal(next.xp, tabA.xp);
  assert.deepEqual(next.activity, tabA.activity);

  // Nothing newer stored, or nothing readable: the tab's own copy, unchanged.
  assert.equal(latestStored(tabA, storage), tabA);
  assert.equal(latestStored(tabB, { getItem: () => null }), tabB);
  assert.equal(latestStored(tabB, { getItem: () => '{"version":9}' }), tabB);
  assert.equal(latestStored(tabB, { getItem: () => 'not json' }), tabB);
  assert.equal(latestStored(tabB, null), tabB);
  assert.equal(
    latestStored(tabB, {
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    }),
    tabB,
  );
});
