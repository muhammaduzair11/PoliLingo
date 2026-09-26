/**
 * lib/release-cache.ts: the stored newer release and what activating it does
 * to progress (docs/platform.md 4.7). Storage is a stub, so corrupt data,
 * blocked storage and a full quota can all be made to happen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as content from '../lib/content.ts';
import {
  activateRelease,
  baselineCopy,
  lessonSize,
  resetToBaseline,
} from '../lib/content.ts';
import { initialState, newSession } from '../lib/progress.ts';
import {
  RELEASE_STORAGE_KEY,
  activateCachedRelease,
  fitSessions,
  forgetRelease,
  storeRelease,
} from '../lib/release-cache.ts';
import { learnerContentHash } from '../lib/release-verify.ts';

/** A localStorage stand-in; `fail` makes reads or writes throw. */
function stubStorage(entries = {}, { fail } = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem(key) {
      if (fail === 'read') throw new Error('SecurityError');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (fail === 'write') {
        const error = new Error('The quota has been exceeded.');
        error.name = 'QuotaExceededError';
        throw error;
      }
      map.set(key, String(value));
    },
    removeItem(key) {
      if (fail === 'write') throw new Error('SecurityError');
      map.delete(key);
    },
  };
}

/** This build's Supabase project, and another one. */
const HERE = 'https://here.supabase.co';
const THERE = 'http://127.0.0.1:54321';

/** The baseline under another name, its first lesson one exercise longer. */
function release(name, { grow = true } = {}) {
  const copy = structuredClone(baselineCopy);
  copy.release = name;
  copy.commit = null;
  if (grow) {
    const lesson = copy.courses[0].units[0].lessons[0];
    lesson.exercises.push({
      ...lesson.exercises.find((e) => e.kind === 'meaning'),
      id: 'ps-exr-fff002',
    });
  }
  copy.contentHash = learnerContentHash(copy);
  return copy;
}
const stored = (copy, source = HERE) => ({
  [RELEASE_STORAGE_KEY]: JSON.stringify({ source, copy }),
});

test.afterEach(() => resetToBaseline());

// ---------------------------------------------------------------------------
// activateCachedRelease
// ---------------------------------------------------------------------------

test('a stored newer release is verified, activated and named', () => {
  const copy = release('content@2026.10.1');
  const name = activateCachedRelease(stubStorage(stored(copy)), HERE);
  assert.equal(name, 'content@2026.10.1');
  assert.equal(content.contentVersion, 'content@2026.10.1');
  assert.equal(content.learnerCopy.contentHash, copy.contentHash);
  const lesson = copy.courses[0].units[0].lessons[0];
  assert.equal(lessonSize(lesson.id), lesson.exercises.length);
});

test('nothing stored, or no storage at all, keeps the baseline', () => {
  assert.equal(
    activateCachedRelease(stubStorage(), HERE),
    baselineCopy.release,
  );
  assert.equal(activateCachedRelease(null, HERE), baselineCopy.release);
  assert.equal(content.learnerCopy, baselineCopy);
});

test('corrupt or refused data keeps the baseline and never throws', () => {
  const tampered = release('content@2026.10.1');
  tampered.courses[0].units[0].lessons[0].title = 'Tampered';
  const wrapped = (copy) => JSON.stringify({ source: HERE, copy });
  for (const raw of [
    '',
    '{',
    'null',
    '"text"',
    '[]',
    '{"format":"polilingo.learner@1"}',
    wrapped({ format: 'polilingo.learner@1' }),
    wrapped({
      ...baselineCopy,
      release: 'content@2026.10.1',
      schemaVersion: 2,
    }),
    wrapped(tampered),
    // A bare copy, without the project it came from.
    JSON.stringify(release('content@2026.10.1')),
  ]) {
    const storage = stubStorage({ [RELEASE_STORAGE_KEY]: raw });
    assert.equal(
      activateCachedRelease(storage, HERE),
      baselineCopy.release,
      raw,
    );
    assert.equal(content.learnerCopy, baselineCopy);
  }
});

test('storage that throws on reading keeps the baseline and never throws', () => {
  const storage = stubStorage(stored(release('content@2026.10.1')), {
    fail: 'read',
  });
  assert.equal(activateCachedRelease(storage, HERE), baselineCopy.release);
  assert.equal(content.learnerCopy, baselineCopy);
});

test('a stored copy that is not newer than the baseline is not activated', () => {
  // The baseline itself, and a development build: a development name is
  // never newer than anything.
  for (const copy of [
    baselineCopy,
    release('content@2026.08.dev+aaaaaaa'),
    release(baselineCopy.release),
  ]) {
    assert.equal(
      activateCachedRelease(stubStorage(stored(copy)), HERE),
      baselineCopy.release,
      copy.release,
    );
    assert.equal(content.learnerCopy, baselineCopy);
  }
});

test('a copy stored from another Supabase project, or with none configured, is not activated', () => {
  // The founder ran the app against the local fixture stack, then pointed it
  // at the hosted project: the fixture's copy must not come back.
  const storage = stubStorage(stored(release('content@2026.10.1'), THERE));
  assert.equal(activateCachedRelease(storage, HERE), baselineCopy.release);
  assert.equal(content.learnerCopy, baselineCopy);
  // Without Supabase settings nothing stored is shown.
  const here = stubStorage(stored(release('content@2026.10.1')));
  assert.equal(activateCachedRelease(here, null), baselineCopy.release);
  assert.equal(content.learnerCopy, baselineCopy);
  // Back on the project it came from, it is.
  assert.equal(activateCachedRelease(storage, THERE), 'content@2026.10.1');
});

// ---------------------------------------------------------------------------
// storeRelease and forgetRelease
// ---------------------------------------------------------------------------

test('storeRelease keeps the copy, with its project, for the next visit', () => {
  const copy = release('content@2026.10.1');
  const storage = stubStorage();
  storeRelease(storage, copy, HERE);
  assert.deepEqual(JSON.parse(storage.map.get(RELEASE_STORAGE_KEY)), {
    source: HERE,
    copy,
  });
  // And the next visit starts from it.
  assert.equal(activateCachedRelease(storage, HERE), 'content@2026.10.1');
});

test('storeRelease replaces a stored copy, even one of the same name', () => {
  const storage = stubStorage(stored(release('content@2026.10.1')));
  storeRelease(storage, release('content@2026.10.2', { grow: false }), HERE);
  assert.equal(
    JSON.parse(storage.map.get(RELEASE_STORAGE_KEY)).copy.release,
    'content@2026.10.2',
  );
  // The same name with other content: the server's copy wins.
  const same = release('content@2026.10.2');
  storeRelease(storage, same, HERE);
  assert.equal(activateCachedRelease(storage, HERE), 'content@2026.10.2');
  assert.equal(content.learnerCopy.contentHash, same.contentHash);
});

test('storeRelease stores nothing without a project', () => {
  const storage = stubStorage();
  storeRelease(storage, release('content@2026.10.1'), null);
  assert.equal(storage.map.size, 0);
});

test('a full quota, blocked storage or none at all never throws', () => {
  const copy = release('content@2026.10.1');
  const full = stubStorage({}, { fail: 'write' });
  assert.equal(storeRelease(full, copy, HERE), undefined);
  assert.equal(full.map.size, 0);
  assert.equal(storeRelease(null, copy, HERE), undefined);
  forgetRelease(full);
  forgetRelease(null);
});

test('forgetRelease makes the next visit start from the baseline', () => {
  const storage = stubStorage(stored(release('content@2026.10.1')));
  forgetRelease(storage);
  assert.equal(storage.map.has(RELEASE_STORAGE_KEY), false);
  assert.equal(activateCachedRelease(storage, HERE), baselineCopy.release);
  // Storage without removeItem is emptied instead.
  const bare = stubStorage(stored(release('content@2026.10.1')));
  delete bare.removeItem;
  forgetRelease(bare);
  assert.equal(activateCachedRelease(bare, HERE), baselineCopy.release);
});

// ---------------------------------------------------------------------------
// fitSessions
// ---------------------------------------------------------------------------

function progress() {
  const lessons = baselineCopy.courses[0].units[0].lessons;
  const [grown, same, other] = lessons.map((l) => l.id);
  const state = initialState('device');
  state.xp = 145;
  state.completed = { [grown]: baselineCopy.release, 'xx-lsn-000000': 'mvp' };
  state.activity = { '2026-09-27': 3 };
  state.rewarded = ['run-0'];
  const run = (lesson, id, extra = {}) => ({
    ...newSession('pashto', lesson, id, lessonSize(lesson)),
    ...extra,
  });
  state.sessions = {
    // Unfinished on the lesson that grows: dropped once the new copy is active.
    [grown]: run(grown, 'run-1', { cursor: 2, attempts: 2, firstCorrect: 2 }),
    // Unfinished, the same size in both: kept.
    [same]: run(same, 'run-2', { cursor: 1, attempts: 1 }),
    // Finished: kept whatever the release says.
    [other]: run(other, 'run-3', { done: true, reward: 20, size: 99 }),
    // Unfinished on a lesson no release has: dropped, as loading drops it.
    'xx-lsn-000000': {
      ...newSession('pashto', 'xx-lsn-000000', 'run-4', 4),
      cursor: 1,
    },
  };
  return { state, grown, same, other };
}

test('fitSessions drops unfinished runs the active release cannot continue, and nothing else', () => {
  const { state, grown, same, other } = progress();
  const before = structuredClone(state);
  activateRelease(release('content@2026.10.1'));
  const fitted = fitSessions(state);
  assert.deepEqual(Object.keys(fitted.sessions).sort(), [other, same].sort());
  assert.deepEqual(fitted.sessions[same], state.sessions[same]);
  assert.deepEqual(fitted.sessions[other], state.sessions[other]);
  assert.equal(fitted.sessions[grown], undefined);
  // Completions, XP, activity and the award ledger are untouched.
  assert.deepEqual(fitted.completed, before.completed);
  assert.equal(fitted.xp, before.xp);
  assert.deepEqual(fitted.activity, before.activity);
  assert.deepEqual(fitted.rewarded, before.rewarded);
  assert.equal(fitted.deviceId, before.deviceId);
  // The input is not changed.
  assert.deepEqual(state, before);
});

test('fitSessions returns the same state when every run still fits', () => {
  const { state, grown, same, other } = progress();
  delete state.sessions['xx-lsn-000000'];
  // Under the baseline every remaining run fits.
  assert.equal(fitSessions(state), state);
  // And under a release that changes none of these lessons.
  activateRelease(release('content@2026.10.1', { grow: false }));
  const fitted = fitSessions(state);
  assert.equal(fitted, state);
  assert.deepEqual(
    Object.keys(fitted.sessions).sort(),
    [grown, same, other].sort(),
  );
});

test('fitSessions keeps an empty state as it is', () => {
  const state = initialState('device');
  assert.equal(fitSessions(state), state);
});
