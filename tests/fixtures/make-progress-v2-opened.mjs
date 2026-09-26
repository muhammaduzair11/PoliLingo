// Opens v0.2's own storage code (#19, before content releases) for a learner who
// went straight from the MVP to content releases, so has no v2 key, as if the
// app had been rolled back one deploy, and prints the `polilingo.progress.v2`
// blob v0.2 stores without the learner doing anything. See README.md in this
// folder for how progress-v2-opened.json was made with it.
//
//   node tests/fixtures/make-progress-v2-opened.mjs <folder holding v0.2's lib/>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const lib = (name) =>
  import(pathToFileURL(join(process.argv[2], 'lib', name)).href);
const {
  hydrateProgress,
  parseState,
  BACKUP_KEY_PREFIX,
  STORAGE_KEY,
  STORAGE_KEY_V1,
} = await lib('progress.ts');
const { randomId } = await lib('random-id.ts');

// The learner from progress-v1-mvp.json first came back after content
// releases were live. That build backed up the v1 key and wrote only
// polilingo.progress.v3, which v0.2 does not read. So after the rollback v0.2
// finds the v1 key, its backup and no v2 key.
const v1 = JSON.stringify(
  JSON.parse(
    readFileSync(new URL('./progress-v1-mvp.json', import.meta.url), 'utf8'),
  ),
);
const storage = new Map([
  [STORAGE_KEY_V1, v1],
  [BACKUP_KEY_PREFIX + '2026-09-25', v1],
  ['polilingo.progress.v3', '{"version":3}'],
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
// The backup exists, so hydration itself writes nothing.
assert.equal(storage.has(STORAGE_KEY), false);
const s = loaded.state;

// The learner only opens the app. Once hydrated, v0.2's provider writes the
// whole state to the v2 key, and its own reader must accept it unchanged.
const raw = JSON.stringify(s);
assert.deepEqual(parseState(raw), s);
assert.equal(s.xp, 65);
assert.equal(typeof s.v1Fingerprint, 'string');
process.stdout.write(raw + '\n');
