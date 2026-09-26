// Picks up the learner in progress-v1-mvp.json on the MVP's own storage code, as
// if the app had been rolled back past v0.2, and prints the `polilingo.progress.v1`
// blob the MVP stored afterwards. See README.md in this folder for how
// progress-v1-mvp-after-rollback.json was made with it.
//
//   node tests/fixtures/make-progress-v1-mvp-after-rollback.mjs <folder holding the MVP's lib/>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const mvp = await import(
  pathToFileURL(join(process.argv[2], 'lib', 'progress.ts')).href
);
const { newSession, recordAnswer, advanceSession, parseState } = mvp;

// The MVP loads the v1 key as it was left before v0.2.
const before = readFileSync(
  new URL('./progress-v1-mvp.json', import.meta.url),
  'utf8',
);
let s = parseState(JSON.stringify(JSON.parse(before)));
const key = 'pashto/essentials';
const day = '2026-09-25';
function setSession(session) {
  s = { ...s, sessions: { ...s.sessions, [key]: session } };
}
/** Presses Continue on the feedback showing, then answers the next question. */
function answer(correct) {
  s = advanceSession(s, key, day);
  setSession(recordAnswer(s.sessions[key], correct));
}

// "Let's keep going" on the resume card: the wrong answer's feedback is still
// showing. The rest of the lesson, then its review question, all right.
assert.deepEqual(s.sessions[key].feedback, { correct: false });
while (s.sessions[key].cursor < s.sessions[key].queue.length - 1) answer(true);
s = advanceSession(s, key, day);
assert.equal(s.sessions[key].done, true);
// "Play this lesson again", the study cards, two answers, then "Save and
// leave lesson".
setSession(newSession('pashto', 'essentials', crypto.randomUUID()));
setSession({ ...s.sessions[key], studied: true });
setSession(recordAnswer(s.sessions[key], true));
answer(true);
s = advanceSession(s, key, day);

// The MVP's own reader must accept it unchanged.
const raw = JSON.stringify(s);
assert.deepEqual(parseState(raw), s);
assert.equal(s.xp, 85);
process.stdout.write(raw + '\n');
