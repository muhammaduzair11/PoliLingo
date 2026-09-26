/**
 * lib/sync.ts: the envelope a device sends, the snapshot it applies, and the
 * rules the sync agent follows (docs/platform.md 3.7, 4.9). The database
 * side is tests/db/sync.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { courses } from '../lib/content.ts';
import { canonicalJson } from '../lib/canonical-json.ts';
import { sha256 } from '../lib/sha256.ts';
import {
  advanceSession,
  initialState,
  newSession,
  parseState,
  recordAnswer,
  streak,
} from '../lib/progress.ts';
import {
  FOCUS_INTERVAL_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  SYNC_FORMAT,
  SYNC_LIMITS,
  UNKNOWN_DEVICE,
  accountChoice,
  applySnapshot,
  buildEnvelope,
  envelopeKey,
  focusDue,
  holdsProgress,
  isSyncDate,
  ledgerXp,
  parseSnapshot,
  retryDelay,
  snapshotToState,
  syncFailure,
} from '../lib/sync.ts';

const NOW = new Date('2026-09-27T10:00:00.000Z');
const TODAY = '2026-09-27';

/** mulberry32: a small deterministic generator, so a failing run replays. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * Plays `runs` lessons through the real lesson code: random lessons of this
 * release, random mistakes, replays, and runs left half-way.
 */
function play(seed, runs, deviceId = `device-${seed}`) {
  const random = rng(seed);
  const lessons = courses.flatMap((c) =>
    c.lessons.map((l) => ({
      course: c.id,
      id: l.id,
      size: l.exercises.length,
    })),
  );
  let s = initialState(deviceId);
  for (let r = 0; r < runs; r++) {
    const l = lessons[Math.floor(random() * lessons.length)];
    const day = `2026-09-${String(10 + Math.floor(random() * 15)).padStart(2, '0')}`;
    s = {
      ...s,
      sessions: {
        ...s.sessions,
        [l.id]: newSession(l.course, l.id, `${deviceId}-run-${r}`, l.size),
      },
    };
    const stopAt = random() < 0.2 ? Math.floor(random() * l.size) : Infinity;
    for (let step = 0; step < 200 && !s.sessions[l.id].done; step++) {
      if (step >= stopAt) break;
      s = {
        ...s,
        sessions: {
          ...s.sessions,
          [l.id]: recordAnswer(s.sessions[l.id], random() < 0.8),
        },
      };
      s = advanceSession(s, l.id, day);
    }
  }
  return s;
}

/** The snapshot the database would hold after these devices synced. */
function serverSnapshot(...states) {
  const completed = {};
  const activity = {};
  const rewarded = [];
  let reported = 0;
  for (const s of states) {
    const e = buildEnvelope(s, TODAY);
    for (const [k, v] of Object.entries(e.completed))
      if (!(k in completed) || v < completed[k]) completed[k] = v;
    for (const [d, n] of Object.entries(e.activity))
      activity[d] = Math.max(activity[d] ?? 0, n);
    for (const id of e.rewarded) if (!rewarded.includes(id)) rewarded.push(id);
    reported = Math.max(reported, e.xp);
  }
  const ledger = ledgerXp({ completed, rewarded });
  return {
    xp: Math.max(ledger, reported),
    completed,
    activity,
    rewarded,
    dailyGoal: null,
    selected: null,
  };
}

const fixtures = readdirSync(new URL('./fixtures/', import.meta.url))
  .filter((f) => /^progress-.*\.json$/.test(f))
  .map((name) => ({
    name,
    raw: JSON.stringify(
      JSON.parse(
        readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
      ),
    ),
  }));

test('the XP identity holds for every progress fixture', () => {
  assert.ok(fixtures.length >= 5, 'the progress fixtures are all read');
  for (const { name, raw } of fixtures) {
    const state = parseState(raw, 'fixture-device');
    assert.ok(state.xp > 0, `${name} holds progress`);
    assert.equal(ledgerXp(state), state.xp, name);
  }
});

test('the XP identity holds for runs played through advanceSession', () => {
  let replays = 0;
  let unfinished = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = play(seed, 1 + (seed % 25));
    assert.equal(ledgerXp(s), s.xp, `seed ${seed}`);
    const runs = Object.values(s.sessions);
    replays += runs.filter((r) => r.reward === 5).length;
    unfinished += runs.filter((r) => !r.done).length;
  }
  // The generated runs really do earn first clears, replays and leave runs
  // half-way, so the identity is tested on all three.
  assert.ok(replays > 0, 'some runs are replays');
  assert.ok(unfinished > 0, 'some runs are left half-way');
  assert.ok(play(40, 25).xp > 100);
});

test('an envelope carries progress only: never sessions, prefs or accounts', () => {
  const s = {
    ...play(7, 12),
    userId: 'account-a',
    importedIntoAccounts: ['account-a'],
    lastSyncedAt: NOW.toISOString(),
    selected: 'pashto',
    dailyGoal: 2,
  };
  const e = buildEnvelope(s, TODAY);
  assert.deepEqual(Object.keys(e).sort(), [
    'activity',
    'completed',
    'dailyGoal',
    'deviceId',
    'format',
    'localDate',
    'rewarded',
    'selected',
    'xp',
  ]);
  assert.equal(e.format, SYNC_FORMAT);
  assert.equal(e.deviceId, 'device-7');
  assert.equal(e.localDate, TODAY);
  assert.equal(e.xp, s.xp);
  assert.deepEqual(e.completed, s.completed);
  assert.deepEqual(e.activity, s.activity);
  assert.deepEqual(e.rewarded, s.rewarded);
  assert.equal(e.dailyGoal, 2);
  assert.equal(e.selected, 'pashto');
  const text = JSON.stringify(e);
  for (const word of ['sessions', 'prefs', 'queue', 'account-a', 'userId'])
    assert.ok(!text.includes(word), `the envelope does not mention ${word}`);
});

test('an envelope keeps a Hindko MVP key and every fixture as it is', () => {
  for (const { name, raw } of fixtures) {
    const state = parseState(raw, 'fixture-device');
    const e = buildEnvelope(state, TODAY);
    assert.deepEqual(e.completed, state.completed, name);
    assert.deepEqual(e.rewarded, state.rewarded, name);
    assert.deepEqual(e.activity, state.activity, name);
    assert.equal(e.xp, state.xp, name);
  }
  const hindko = buildEnvelope(
    { ...initialState('d'), completed: { 'hindko/greetings': 'mvp' } },
    TODAY,
  );
  assert.deepEqual(hindko.completed, { 'hindko/greetings': 'mvp' });
});

test('an envelope leaves out what the database would refuse, and nothing else', () => {
  const s = {
    ...initialState(''),
    xp: 35,
    selected: 'Not A Slug',
    dailyGoal: 1,
    completed: {
      'ps-lsn-0a41c2': 'content@2026.09.1',
      'pashto/greetings': 'mvp',
      'Bad Key': 'mvp',
      'ps-lsn-0a41c3': 'release with spaces',
      [`${'a'.repeat(40)}/${'b'.repeat(40)}`]: 'mvp',
    },
    activity: {
      '2026-09-26': 1,
      '2026-09-27': 0,
      '2026-02-31': 1,
      '2019-12-31': 2,
      '2026-09-25': 5000,
    },
    rewarded: ['s1', 's2', 's1', 'has space', '', 'x'.repeat(101)],
  };
  const e = buildEnvelope(s, TODAY);
  assert.equal(e.deviceId, UNKNOWN_DEVICE);
  assert.deepEqual(e.completed, {
    'ps-lsn-0a41c2': 'content@2026.09.1',
    'pashto/greetings': 'mvp',
  });
  assert.deepEqual(e.activity, { '2026-09-25': 1000, '2026-09-26': 1 });
  assert.deepEqual(e.rewarded, ['s1', 's2']);
  assert.equal(e.selected, null);
  assert.equal(e.dailyGoal, 1);
  // The state itself is untouched.
  assert.equal(Object.keys(s.completed).length, 5);
  assert.equal(s.rewarded.length, 6);
});

test('an envelope over a size limit sends the newest entries', () => {
  const rewarded = Array.from(
    { length: SYNC_LIMITS.rewarded + 5 },
    (_, i) => `s${i}`,
  );
  const activity = {};
  const start = Date.UTC(2020, 0, 1);
  for (let i = 0; i < SYNC_LIMITS.activity + 3; i++)
    activity[new Date(start + i * 86400000).toISOString().slice(0, 10)] = 1;
  const e = buildEnvelope({ ...initialState('d'), rewarded, activity }, TODAY);
  assert.equal(e.rewarded.length, SYNC_LIMITS.rewarded);
  assert.equal(e.rewarded[0], 's5');
  assert.equal(Object.keys(e.activity).length, SYNC_LIMITS.activity);
  assert.ok(!('2020-01-01' in e.activity));
});

test('isSyncDate accepts real dates from 2020 only', () => {
  assert.equal(isSyncDate('2026-09-27'), true);
  assert.equal(isSyncDate('2024-02-29'), true);
  assert.equal(isSyncDate('2026-02-29'), false);
  assert.equal(isSyncDate('2026-13-01'), false);
  assert.equal(isSyncDate('2019-12-31'), false);
  assert.equal(isSyncDate('2026-9-27'), false);
});

test("envelopeKey is the SHA-256 of the envelope's canonical JSON", () => {
  const e = buildEnvelope(play(3, 6), TODAY);
  assert.match(envelopeKey(e), /^[0-9a-f]{64}$/);
  assert.equal(envelopeKey(e), sha256(canonicalJson(e)));
  // Key order does not matter; content does.
  const reordered = Object.fromEntries(Object.entries(e).reverse());
  assert.equal(envelopeKey(reordered), envelopeKey(e));
  assert.notEqual(envelopeKey({ ...e, xp: e.xp + 5 }), envelopeKey(e));
});

test('applying a snapshot twice is the same as once', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const local = play(seed, 8);
    const other = play(seed + 100, 8);
    const snap = serverSnapshot(local, other);
    const once = applySnapshot(local, snap, 'account-a', NOW);
    const twice = applySnapshot(once, snap, 'account-a', NOW);
    assert.deepEqual(twice, once, `seed ${seed}`);
  }
});

test('XP and the streak never go down when a snapshot is applied', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const local = play(seed, 10);
    // A snapshot that knows less than the device: an older account.
    const older = serverSnapshot(play(seed + 500, seed % 4));
    for (const snap of [older, serverSnapshot(local), serverSnapshot()]) {
      const after = applySnapshot(local, snap, 'account-a', NOW);
      assert.ok(after.xp >= local.xp, `seed ${seed}: XP kept`);
      assert.ok(after.xp >= snap.xp, `seed ${seed}: the account's XP arrives`);
      assert.ok(
        streak(after.activity, NOW) >= streak(local.activity, NOW),
        `seed ${seed}: streak kept`,
      );
      for (const [day, n] of Object.entries(local.activity))
        assert.ok(after.activity[day] >= n);
      for (const key of Object.keys(local.completed))
        assert.ok(after.completed[key]);
      // Runs in progress and settings stay as they were.
      assert.deepEqual(after.sessions, local.sessions);
      assert.deepEqual(after.prefs, local.prefs);
      assert.equal(after.dailyGoal, local.dailyGoal);
      assert.equal(after.deviceId, local.deviceId);
    }
  }
});

test('two devices that sync converge, with the XP the ledger gives', () => {
  const a = play(11, 9, 'phone');
  const b = play(12, 9, 'laptop');
  const snap = serverSnapshot(a, b);
  const a2 = applySnapshot(a, snap, 'account-a', NOW);
  const b2 = applySnapshot(b, snap, 'account-a', NOW);
  assert.deepEqual(
    Object.keys(a2.completed).sort(),
    Object.keys(b2.completed).sort(),
  );
  assert.deepEqual([...a2.rewarded].sort(), [...b2.rewarded].sort());
  assert.deepEqual(a2.activity, b2.activity);
  assert.equal(a2.xp, b2.xp);
  assert.equal(a2.xp, ledgerXp(a2));
});

test('a snapshot marks the state as synced to that account', () => {
  const local = { ...play(5, 3), importedIntoAccounts: ['account-b'] };
  const after = applySnapshot(local, serverSnapshot(local), 'account-a', NOW);
  assert.equal(after.userId, 'account-a');
  assert.equal(after.lastSyncedAt, NOW.toISOString());
  assert.deepEqual(after.importedIntoAccounts, ['account-b', 'account-a']);
});

test("snapshotToState keeps the device's own fields and takes no runs", () => {
  const base = { ...play(9, 4), selected: null, dailyGoal: 3 };
  const s = snapshotToState(
    {
      xp: 40,
      completed: { 'ps-lsn-0a41c2': 'mvp' },
      activity: { '2026-09-20': 2 },
      rewarded: ['a', 'b'],
      dailyGoal: 1,
      selected: 'urdu',
    },
    base,
  );
  assert.equal(s.deviceId, base.deviceId);
  assert.deepEqual(s.sessions, {});
  assert.deepEqual(s.prefs, base.prefs);
  assert.equal(s.xp, 40);
  assert.equal(s.selected, 'urdu');
  // A course the device has not chosen yet comes from the account; a daily
  // goal the device already has is never overwritten by an apply.
  const applied = applySnapshot(
    base,
    { ...serverSnapshot(), selected: 'urdu', dailyGoal: 1 },
    'u',
    NOW,
  );
  assert.equal(applied.selected, 'urdu');
  assert.equal(applied.dailyGoal, 3);
});

test('accountChoice asks only when another account synced a device holding progress', () => {
  const fresh = initialState('d');
  const withProgress = play(21, 4);
  assert.ok(holdsProgress(withProgress));
  assert.equal(holdsProgress(fresh), false);
  // Never synced: progress simply joins the account.
  assert.equal(accountChoice(withProgress, 'a'), 'sync');
  assert.equal(accountChoice(fresh, 'a'), 'sync');
  // Last synced to this account.
  const syncedA = applySnapshot(withProgress, serverSnapshot(), 'a', NOW);
  assert.equal(accountChoice(syncedA, 'a'), 'sync');
  // Last synced to another account, with progress on the device: ask.
  assert.equal(accountChoice(syncedA, 'b'), 'ask');
  // ... but a device that holds nothing has nothing to ask about.
  assert.equal(
    accountChoice({ ...fresh, userId: 'a', importedIntoAccounts: ['a'] }, 'b'),
    'sync',
  );
  // After "Add", B is the last account; going back to A asks again.
  const syncedB = applySnapshot(syncedA, serverSnapshot(), 'b', NOW);
  assert.equal(accountChoice(syncedB, 'b'), 'sync');
  assert.equal(accountChoice(syncedB, 'a'), 'ask');
  // A state whose userId is missing still remembers its last account.
  assert.equal(
    accountChoice(
      { ...withProgress, userId: null, importedIntoAccounts: ['a'] },
      'b',
    ),
    'ask',
  );
  assert.equal(
    accountChoice(
      { ...withProgress, userId: null, importedIntoAccounts: ['a'] },
      'a',
    ),
    'sync',
  );
});

test('parseSnapshot reads what the database returns and nothing else', () => {
  const good = {
    xp: 65,
    completed: { 'ps-lsn-0a41c2': 'content@2026.09.1' },
    activity: { '2026-09-27': 2 },
    rewarded: ['s1'],
    dailyGoal: 2,
    selected: 'pashto',
    applied: true,
    envelope_hash: 'a'.repeat(64),
  };
  assert.deepEqual(parseSnapshot(good), {
    xp: 65,
    completed: good.completed,
    activity: good.activity,
    rewarded: good.rewarded,
    dailyGoal: 2,
    selected: 'pashto',
  });
  assert.equal(
    parseSnapshot({ ...good, dailyGoal: null, selected: null }).dailyGoal,
    null,
  );
  for (const bad of [
    null,
    [],
    'x',
    { ...good, xp: -1 },
    { ...good, xp: 1.5 },
    { ...good, completed: [] },
    { ...good, completed: { a: '' } },
    { ...good, activity: { yesterday: 1 } },
    { ...good, activity: { '2026-09-27': -1 } },
    { ...good, rewarded: [1] },
    { ...good, dailyGoal: 7 },
    { ...good, selected: 3 },
  ])
    assert.equal(parseSnapshot(bad), null, JSON.stringify(bad));
});

test('retries back off exponentially, up to a ceiling', () => {
  assert.equal(retryDelay(1), RETRY_BASE_MS);
  assert.equal(retryDelay(2), RETRY_BASE_MS * 2);
  assert.equal(retryDelay(3), RETRY_BASE_MS * 4);
  assert.equal(retryDelay(50), RETRY_MAX_MS);
  assert.equal(retryDelay(0), RETRY_BASE_MS);
  for (let n = 1; n < 30; n++) assert.ok(retryDelay(n + 1) >= retryDelay(n));
});

test('a focus syncs at most every 15 seconds', () => {
  assert.equal(focusDue(null, 1000), true);
  assert.equal(focusDue(1000, 1000 + FOCUS_INTERVAL_MS - 1), false);
  assert.equal(focusDue(1000, 1000 + FOCUS_INTERVAL_MS), true);
});

test('failures map to a status, and only retry when trying again can help', () => {
  assert.deepEqual(syncFailure('NETWORK'), { status: 'offline', retry: true });
  assert.deepEqual(syncFailure('PL460_SYNC_DISABLED'), {
    status: 'paused',
    retry: true,
  });
  assert.deepEqual(syncFailure('PL429_RATE_LIMITED'), {
    status: 'error',
    retry: true,
  });
  for (const code of [
    'PL401_NOT_SIGNED_IN',
    'PL403_NO_PROFILE',
    'PL422_BAD_ENVELOPE',
    'SESSION_ENDED',
    'NOT_CONFIGURED',
  ])
    assert.equal(syncFailure(code).retry, false, code);
  assert.deepEqual(syncFailure('UNKNOWN'), { status: 'error', retry: true });
});
