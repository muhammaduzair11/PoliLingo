// Picks up the learner in progress-v2.json on v0.2's own storage code, as if the
// app had been rolled back one deploy, from content releases to v0.2, and prints
// the `polilingo.progress.v2` blob v0.2 stored afterwards. See README.md in this
// folder for how progress-v2-after-rollback.json was made with it.
//
//   node tests/fixtures/make-progress-v2-after-rollback.mjs <folder holding v0.2's lib/>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const lib = (name) =>
  import(pathToFileURL(join(process.argv[2], 'lib', name)).href);
const {
  hydrateProgress,
  newSession,
  recordAnswer,
  advanceSession,
  lessonKey,
  unlocked,
  parseState,
  BACKUP_KEY_PREFIX,
  STORAGE_KEY,
  STORAGE_KEY_V1,
} = await lib('progress.ts');
const { randomId } = await lib('random-id.ts');

const fixture = (name) =>
  JSON.stringify(
    JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')),
  );
// After the rollback, v0.2 finds what it left: the v1 key and its backup,
// untouched, and its own v2 key as it was before content releases arrived
// (they write polilingo.progress.v3 and never touch v2).
const v1 = fixture('progress-v1-mvp.json');
const v2 = fixture('progress-v2.json');
const storage = new Map([
  [STORAGE_KEY_V1, v1],
  [BACKUP_KEY_PREFIX + '2026-09-22', v1],
  [STORAGE_KEY, v2],
]);
const local = {
  get length() {
    return storage.size;
  },
  key: (i) => [...storage.keys()][i] ?? null,
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => void storage.set(k, v),
};
const loaded = hydrateProgress(local, '2026-09-27', randomId);
assert.equal(loaded.persist, true);
let s = loaded.state;
assert.deepEqual(s, JSON.parse(v2), 'nothing to merge: v1 is unchanged');
const day = '2026-09-27';

/** Presses Continue on the feedback showing, then answers the next question. */
function answer(key, correct) {
  s = advanceSession(s, key, day);
  s = {
    ...s,
    sessions: { ...s.sessions, [key]: recordAnswer(s.sessions[key], correct) },
  };
}
// "Let's keep going" on the Pashto lesson the MVP left half-way, with the
// wrong answer's feedback still showing: the rest of it and its review
// question, all right.
const essentials = lessonKey('pashto', 'essentials');
assert.deepEqual(s.sessions[essentials].feedback, { correct: false });
while (s.sessions[essentials].cursor < s.sessions[essentials].queue.length - 1)
  answer(essentials, true);
s = advanceSession(s, essentials, day);
assert.equal(s.sessions[essentials].done, true);

// Then the second Urdu lesson, from its study cards, with one mistake.
const intro = lessonKey('urdu', 'introductions');
assert.ok(unlocked(s, 'urdu', 'introductions'));
s = {
  ...s,
  selected: 'urdu',
  sessions: {
    ...s.sessions,
    [intro]: {
      ...newSession('urdu', 'introductions', randomId()),
      studied: true,
    },
  },
};
for (const correct of [true, false, ...Array(7).fill(true)]) {
  s = {
    ...s,
    sessions: {
      ...s.sessions,
      [intro]: recordAnswer(s.sessions[intro], correct),
    },
  };
  s = advanceSession(s, intro, day);
}
assert.equal(s.sessions[intro].done, true);

// v0.2's own reader must accept it unchanged.
const raw = JSON.stringify(s);
assert.deepEqual(parseState(raw), s);
assert.equal(s.xp, 125);
process.stdout.write(raw + '\n');
