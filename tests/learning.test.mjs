import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  allCourses,
  courses,
  evaluate,
  getCourse,
  selectedCourse,
} from '../lib/courses.ts';
import nextConfig from '../next.config.ts';
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
  loadProgress,
  exportProgress,
  importProgress,
  mergeProgress,
  hydrateProgress,
  resetProgress,
  BACKUP_KEY_PREFIX,
  UNKNOWN_KEY_PREFIX,
  STORAGE_KEY,
  STORAGE_KEY_V1,
} from '../lib/progress.ts';
import { randomId } from '../lib/random-id.ts';

test('nine complete, sourced lessons with eight exercises each', () => {
  assert.equal(allCourses.length, 3);
  for (const c of allCourses) {
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
  for (const c of allCourses)
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
test('all three courses unlock sequentially and preserve independent progress', () => {
  let s = initialState();
  let id = 0;
  for (const c of allCourses) {
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
  assert.equal(s.xp, 180);
  assert.equal(Object.keys(s.completed).length, 9);
  assert.equal(s.activity['2026-09-08'], 9);
  assert.equal(streak(s.activity, new Date(2026, 8, 8)), 1);
});
test('Hindko is hidden from learners, and a Hindko learner keeps their progress', () => {
  assert.deepEqual(
    courses.map((c) => c.id),
    ['pashto', 'urdu'],
  );
  assert.equal(getCourse('hindko'), undefined);
  assert.equal(selectedCourse('hindko'), undefined);
  assert.equal(selectedCourse(null), undefined);
  assert.equal(selectedCourse('urdu')?.id, 'urdu');

  // A returning Hindko learner: their choice, completions, XP and an
  // unfinished session all survive a reload unchanged.
  const s = initialState();
  s.selected = 'hindko';
  s.xp = 45;
  s.completed['hindko/greetings'] = true;
  s.completed['pashto/greetings'] = true;
  s.rewarded.push('hindko/greetings');
  s.sessions['hindko/introductions'] = recordAnswer(
    { ...newSession('hindko', 'introductions', 'kept'), studied: true },
    true,
  );
  assert.deepEqual(parseState(JSON.stringify(s)), s);
  assert.equal(unlocked(s, 'hindko', 'introductions'), true);
});
test('Hindko URLs redirect temporarily to /learn', async () => {
  const rules = await nextConfig.redirects();
  const hindko = rules.filter((r) => r.source.includes('hindko'));
  assert.equal(hindko.length, 1);
  assert.equal(hindko[0].destination, '/learn');
  // Never permanent: browsers cache a 308, and these links must work again
  // the day Hindko returns.
  assert.equal(hindko[0].permanent, false);
});
test('mistakes reappear and repeated checking cannot duplicate an attempt', () => {
  const key = 'urdu/greetings';
  let s = initialState();
  s.sessions[key] = newSession('urdu', 'greetings', 'mistake');
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
  s.sessions['urdu/greetings'] = {
    ...newSession('urdu', 'greetings', 'bad'),
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
  a.completed['urdu/greetings'] = true;
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
 * Plays a lesson to the end with every answer right, with today's lesson code.
 * What an older build writes comes from the fixtures instead.
 */
function complete(state, course, lesson, id, day) {
  const key = lessonKey(course, lesson);
  let s = {
    ...state,
    sessions: { ...state.sessions, [key]: newSession(course, lesson, id) },
  };
  for (let q = 0; q < 8; q++) {
    s.sessions[key] = recordAnswer(s.sessions[key], true);
    s = advanceSession(s, key, day);
  }
  return s;
}
test('a v1 blob migrates to v2 with every field carried across', () => {
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
  assert.deepEqual(parseState(V1_RAW, 'device-1'), v2);
  // The captured blob really holds what the migration has to carry.
  assert.equal(v2.xp, 65);
  assert.equal(v2.completed['hindko/greetings'], true);
  assert.deepEqual(v2.sessions['pashto/essentials'].feedback, {
    correct: false,
  });
});
test('parseState keeps a v2 blob as it is and rejects a damaged one', () => {
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
    ...migrateV1toV2(legacyState(), 'dev'),
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
  // On v0.2 the learner finishes an Urdu lesson; only the v2 key changes.
  const onV2 = complete(
    first.state,
    'urdu',
    'greetings',
    'v2-run',
    '2026-09-24',
  );
  // Rolled back, the MVP read v1 as it was, finished the Pashto lesson left
  // half-way, and wrote v1 again (tests/fixtures/README.md).
  const rolledBack = JSON.parse(V1_AFTER_ROLLBACK_RAW);
  const finishedRun = legacyState().sessions['pashto/essentials'].id;
  const forward = loadProgress(
    { v1: V1_AFTER_ROLLBACK_RAW, v2: JSON.stringify(onV2), backupExists: true },
    '2026-09-26',
    'ignored',
  );
  assert.deepEqual(forward.writes, []);
  const s = forward.state;
  assert.equal(s.deviceId, 'dev');
  assert.equal(s.completed['urdu/greetings'], true);
  assert.equal(s.completed['pashto/essentials'], true);
  assert.equal(s.completed['hindko/greetings'], true);
  assert.equal(s.activity['2026-09-24'], 1);
  assert.equal(s.activity['2026-09-25'], 1);
  assert.ok(s.rewarded.includes('v2-run'));
  assert.ok(s.rewarded.includes(finishedRun));
  assert.equal(s.xp, Math.max(onV2.xp, rolledBack.xp));
  assert.notEqual(s.v1Fingerprint, first.state.v1Fingerprint);
  // Loading again changes nothing.
  const twice = loadProgress(
    { v1: V1_AFTER_ROLLBACK_RAW, v2: JSON.stringify(s), backupExists: true },
    '2026-09-27',
    'ignored',
  );
  assert.deepEqual(twice, { state: s, writes: [] });
});
test('a run finished and started again elsewhere replaces the unfinished copy here', () => {
  // v0.2 still holds the Pashto run the fixture left half-way. During the
  // rollback the MVP finished that run, then started the lesson again.
  const key = 'pashto/essentials';
  const first = loadProgress(
    { v1: V1_RAW, v2: null, backupExists: false },
    '2026-09-23',
    'dev',
  );
  const s = loadProgress(
    {
      v1: V1_AFTER_ROLLBACK_RAW,
      v2: JSON.stringify(first.state),
      backupExists: true,
    },
    '2026-09-26',
    'dev',
  ).state;
  const replay = JSON.parse(V1_AFTER_ROLLBACK_RAW).sessions[key];
  assert.deepEqual(s.sessions[key], replay);
  // The learner can play it to the end, for a replay's 5 XP.
  let t = { ...s, sessions: { ...s.sessions } };
  for (let q = replay.cursor; q < 8; q++) {
    t.sessions[key] = recordAnswer(t.sessions[key], true);
    t = advanceSession(t, key, '2026-09-26');
  }
  assert.equal(t.sessions[key].done, true);
  assert.equal(t.sessions[key].reward, 5);
  assert.equal(t.xp, s.xp + 5);
  // Merging the same blob again, or the two the other way round as an import
  // would, keeps the newer run too.
  const rolledBack = migrateV1toV2(JSON.parse(V1_AFTER_ROLLBACK_RAW), 'b');
  assert.deepEqual(mergeProgress(s, rolledBack), s);
  assert.deepEqual(
    mergeProgress(rolledBack, migrateV1toV2(legacyState(), 'a')).sessions[key],
    replay,
  );
});
test('a v1 blob this build cannot read is left for a build that can', () => {
  // Say an older build knew a lesson this one does not.
  const old = legacyState();
  old.completed['pashto/a-retired-lesson'] = true;
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
    { v1: unreadable, v2: JSON.stringify(first.state), backupExists: true },
    '2026-09-24',
    'dev',
  );
  assert.deepEqual(again, { state: first.state, writes: [] });
  // So once the v1 key holds progress that can be read, it is merged in.
  const readable = loadProgress(
    { v1: V1_RAW, v2: JSON.stringify(again.state), backupExists: true },
    '2026-09-25',
    'dev',
  ).state;
  assert.equal(readable.xp, 65);
  // After a merge, an unreadable blob leaves the last fingerprint in place.
  assert.deepEqual(
    loadProgress(
      { v1: unreadable, v2: JSON.stringify(readable), backupExists: true },
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
    { v1: V1_RAW, v2: JSON.stringify(reset), backupExists: true },
    '2026-09-24',
    'dev',
  );
  assert.deepEqual(reload, { state: reset, writes: [] });
  // An older build writing to v1 after the reset is still merged back in. The
  // v1 blob is a whole state, so what it held before the reset returns with it.
  const merged = loadProgress(
    {
      v1: V1_AFTER_ROLLBACK_RAW,
      v2: JSON.stringify(reset),
      backupExists: true,
    },
    '2026-09-26',
    'dev',
  ).state;
  assert.equal(merged.completed['pashto/essentials'], true);
  assert.equal(merged.completed['pashto/greetings'], true);
  assert.equal(merged.xp, 85);
});
test('a blob from a newer app version is kept aside, not discarded', () => {
  const future = JSON.stringify({
    ...initialState('dev'),
    version: 3,
    somethingNew: true,
  });
  const r = loadProgress(
    { v1: null, v2: future, backupExists: true },
    '2026-09-23',
    'dev',
  );
  assert.deepEqual(r.state, initialState('dev'));
  assert.deepEqual(r.writes, [
    { key: UNKNOWN_KEY_PREFIX + '3', value: future },
  ]);
  assert.notEqual(STORAGE_KEY, STORAGE_KEY_V1);
  // Beside a v1 blob, the newer blob is kept aside just the same, and the
  // learner sees their pre-v0.2 progress instead of a fresh start.
  const withV1 = loadProgress(
    { v1: V1_RAW, v2: future, backupExists: true },
    '2026-09-23',
    'dev',
  );
  assert.deepEqual(withV1.writes, r.writes);
  assert.deepEqual(withV1.state, {
    ...migrateV1toV2(legacyState(), 'dev'),
    v1Fingerprint: withV1.state.v1Fingerprint,
  });
  assert.equal(typeof withV1.state.v1Fingerprint, 'string');
});
test('export then import round-trips, and importing twice changes nothing', () => {
  const source = migrateV1toV2(legacyState(), 'source');
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
  for (const bad of [
    '{nope',
    '"text"',
    '{}',
    JSON.stringify({ format: 'polilingo.progress.export@1', state: {} }),
  ])
    assert.equal(importProgress(fresh, bad).ok, false);
});
test('merging never loses progress: sets grow, counts take the maximum, finished beats unfinished', () => {
  const local = {
    ...initialState('l'),
    xp: 30,
    completed: { 'pashto/greetings': true },
    activity: { '2026-09-20': 1, '2026-09-21': 3 },
    rewarded: ['a'],
    sessions: {
      'pashto/greetings': {
        ...newSession('pashto', 'greetings', 'a'),
        cursor: 3,
        studied: true,
      },
    },
  };
  const incoming = {
    ...initialState('i'),
    xp: 20,
    completed: { 'pashto/introductions': true },
    activity: { '2026-09-21': 1, '2026-09-22': 2 },
    rewarded: ['a', 'b'],
    sessions: {
      'pashto/greetings': {
        ...newSession('pashto', 'greetings', 'a'),
        cursor: 8,
        done: true,
        reward: 20,
        firstCorrect: 8,
        attempts: 8,
        studied: true,
      },
    },
  };
  const merged = mergeProgress(local, incoming);
  assert.equal(merged.xp, 30);
  assert.deepEqual(merged.completed, {
    'pashto/greetings': true,
    'pashto/introductions': true,
  });
  assert.deepEqual(merged.activity, {
    '2026-09-20': 1,
    '2026-09-21': 3,
    '2026-09-22': 2,
  });
  assert.deepEqual(merged.rewarded, ['a', 'b']);
  assert.equal(merged.sessions['pashto/greetings'].done, true);
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
  assert.deepEqual(r.state.completed, legacyState().completed);
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.data.has(STORAGE_KEY), false);
  assert.equal(storage.data.get(STORAGE_KEY_V1), V1_RAW);
});
test('a newer blob that cannot be stashed stays where it is', () => {
  const future = JSON.stringify({ ...initialState('dev'), version: 3 });
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
    { v1: V1_RAW, v2: JSON.stringify(r.state), backupExists: true },
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
