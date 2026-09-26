// Writes a `polilingo.progress.v1` blob with the MVP's own storage code, the way
// the MVP's screens drove it, and prints it exactly as the MVP stored it.
// See README.md in this folder for how progress-v1-mvp.json was made with it.
//
//   node tests/fixtures/make-progress-v1-mvp.mjs <folder holding the MVP's lib/>
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const mvp = await import(
  pathToFileURL(join(process.argv[2], 'lib', 'progress.ts')).href
);
const {
  initialState,
  newSession,
  recordAnswer,
  advanceSession,
  lessonKey,
  unlocked,
  parseState,
} = mvp;

// Onboarding: Pashto, two lessons a day.
let s = { ...initialState(), selected: 'pashto', dailyGoal: 2 };

function setSession(key, session) {
  s = { ...s, sessions: { ...s.sessions, [key]: session } };
}
/** Opens a lesson, reads the study cards, then checks each answer in turn. */
function play(course, lesson, answers, day, { stopOnLast = false } = {}) {
  assert.ok(unlocked(s, course, lesson), `${course}/${lesson} is locked`);
  const key = lessonKey(course, lesson);
  s = { ...s, selected: course };
  setSession(key, newSession(course, lesson, crypto.randomUUID()));
  setSession(key, { ...s.sessions[key], studied: true });
  for (const [i, correct] of answers.entries()) {
    setSession(key, recordAnswer(s.sessions[key], correct));
    if (!(stopOnLast && i === answers.length - 1))
      s = advanceSession(s, key, day);
  }
}
const right = (n) => Array.from({ length: n }, () => true);

// Day one: two Pashto lessons, one mistake reviewed at the end.
play('pashto', 'greetings', [true, true, false, ...right(6)], '2026-09-20');
play('pashto', 'introductions', right(8), '2026-09-20');
// Day two: a Hindko lesson, a Pashto replay, and a lesson left mid-way with
// the feedback for a wrong answer still on screen.
play('hindko', 'greetings', right(8), '2026-09-21');
play('pashto', 'greetings', right(8), '2026-09-21');
play('pashto', 'essentials', [true, true, true, false], '2026-09-21', {
  stopOnLast: true,
});
// Settings: sounds on, transliteration off.
s = { ...s, prefs: { ...s.prefs, sound: true, transliteration: false } };

// The MVP's own reader must accept it unchanged.
const raw = JSON.stringify(s);
assert.deepEqual(parseState(raw), s);
assert.equal(s.xp, 65);
process.stdout.write(raw + '\n');
