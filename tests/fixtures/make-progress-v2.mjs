// Writes the `polilingo.progress.v2` blob that v0.2's own storage code (#19,
// before content releases) leaves in a browser, the way its provider and screens
// drove it, and prints it exactly as that build stored it. See README.md in this
// folder for how progress-v2.json was made with it.
//
//   node tests/fixtures/make-progress-v2.mjs <folder holding v0.2's lib/>
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
  STORAGE_KEY,
  STORAGE_KEY_V1,
} = await lib('progress.ts');
const { randomId } = await lib('random-id.ts');

// The learner from progress-v1-mvp.json opens v0.2 for the first time. Its
// provider hydrates from localStorage, which holds only the MVP's v1 key.
const v1 = JSON.stringify(
  JSON.parse(
    readFileSync(new URL('./progress-v1-mvp.json', import.meta.url), 'utf8'),
  ),
);
const storage = new Map([[STORAGE_KEY_V1, v1]]);
const local = {
  get length() {
    return storage.size;
  },
  key: (i) => [...storage.keys()][i] ?? null,
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => void storage.set(k, v),
};
const loaded = hydrateProgress(local, '2026-09-22', randomId);
assert.equal(loaded.persist, true);
let s = loaded.state;

/** Opens a lesson, reads the study cards, then checks each answer in turn. */
function play(course, lesson, answers, day) {
  assert.ok(unlocked(s, course, lesson), `${course}/${lesson} is locked`);
  const key = lessonKey(course, lesson);
  const set = (session) => {
    s = { ...s, sessions: { ...s.sessions, [key]: session } };
  };
  s = { ...s, selected: course };
  set(newSession(course, lesson, randomId()));
  set({ ...s.sessions[key], studied: true });
  for (const correct of answers) {
    set(recordAnswer(s.sessions[key], correct));
    s = advanceSession(s, key, day);
  }
}

// The same day, on v0.2: the first Urdu lesson, all right.
play('urdu', 'greetings', Array(8).fill(true), '2026-09-22');

// The provider writes the whole state to the v2 key. v0.2's own reader must
// accept it unchanged.
const raw = JSON.stringify(s);
assert.deepEqual(parseState(raw), s);
assert.equal(storage.has(STORAGE_KEY), false);
assert.equal(s.xp, 85);
process.stdout.write(raw + '\n');
