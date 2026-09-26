/**
 * lib/release-verify.ts: the checks a learner copy from the database passes
 * before a browser shows it (docs/platform.md 4.7), and which release is
 * newer.
 *
 * Each defect is made on a copy of the committed baseline and, unless the
 * hash itself is the defect, re-hashed, so the check that refuses it is the
 * one under test and not the hash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isNewerRelease,
  learnerContentHash,
  releaseStep,
  releaseAnswer,
  verifyLearnerCopy,
} from '../lib/release-verify.ts';

const FILE = JSON.parse(
  readFileSync(new URL('../content/release.json', import.meta.url), 'utf8'),
);

/** A deep copy of the baseline, edited by `edit`, then re-hashed. */
function defect(edit, { rehash = true } = {}) {
  const copy = structuredClone(FILE);
  edit(copy);
  if (rehash) copy.contentHash = learnerContentHash(copy);
  return copy;
}
const firstLesson = (copy) => copy.courses[0].units[0].lessons[0];
const secondLesson = (copy) => copy.courses[0].units[0].lessons[1];

function refused(copy, pattern) {
  const result = verifyLearnerCopy(copy);
  assert.equal(result.ok, false, `accepted: expected ${pattern}`);
  assert.match(result.reason, pattern);
}

// ---------------------------------------------------------------------------
// verifyLearnerCopy
// ---------------------------------------------------------------------------

test('the committed baseline verifies, and its hash recomputes', () => {
  const result = verifyLearnerCopy(FILE);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.copy, FILE);
  assert.equal(learnerContentHash(FILE), FILE.contentHash);
});

test('the hash covers languages, varieties, courses and keymap only', () => {
  const renamed = { ...FILE, release: 'content@2026.10.4', commit: null };
  assert.equal(learnerContentHash(renamed), FILE.contentHash);
  assert.equal(verifyLearnerCopy(renamed).ok, true);
  // Key order does not matter; the canonical JSON sorts keys.
  const reordered = Object.fromEntries(Object.entries(FILE).reverse());
  assert.equal(verifyLearnerCopy(reordered).ok, true);
});

test('a copy from the database verifies: a release name and no commit', () => {
  const copy = defect((c) => {
    c.release = 'content@2026.09.2';
    c.commit = null;
  });
  assert.equal(verifyLearnerCopy(copy).ok, true);
});

test('development build names are accepted as names', () => {
  for (const release of [
    'content@2026.09.dev+f76adfa',
    'content@2026.09.dev+f76adfa.dirty',
    'content@2026.09.dev+nogit.dirty',
  ])
    assert.equal(verifyLearnerCopy({ ...FILE, release }).ok, true, release);
});

test('what is not a learner copy at all is refused, never thrown', () => {
  for (const x of [undefined, null, 0, 'text', [], [FILE], true])
    assert.equal(verifyLearnerCopy(x).ok, false, JSON.stringify(x));
  // A getter that throws is refused like anything else unreadable.
  const hostile = { ...FILE };
  Object.defineProperty(hostile, 'courses', {
    enumerable: true,
    get() {
      throw new Error('no');
    },
  });
  const result = verifyLearnerCopy(hostile);
  assert.equal(result.ok, false);
  assert.equal(typeof result.reason, 'string');
});

test('another format or schema version is refused', () => {
  refused({ ...FILE, format: 'polilingo.content@1' }, /format/);
  refused({ ...FILE, format: undefined }, /format/);
  refused({ ...FILE, schemaVersion: 2 }, /schemaVersion/);
  refused({ ...FILE, schemaVersion: '1' }, /schemaVersion/);
});

test('a release that is not a content release name is refused', () => {
  for (const release of [
    'content@2026.9.1',
    'content@2026.09',
    '2026.09.1',
    'content@2026.09.1 ',
    'content@2026.09.dev+XYZ',
    42,
    null,
  ])
    refused({ ...FILE, release }, /release/);
});

test('commit is a full commit id or null, nothing else', () => {
  assert.equal(verifyLearnerCopy({ ...FILE, commit: null }).ok, true);
  for (const commit of ['f76adfa', '', 'x'.repeat(40), undefined, 7])
    refused({ ...FILE, commit }, /commit/);
});

test('a contentHash that is malformed or does not match the content is refused', () => {
  refused({ ...FILE, contentHash: 'sha256-abc' }, /contentHash/);
  refused({ ...FILE, contentHash: undefined }, /contentHash/);
  refused(
    { ...FILE, contentHash: FILE.contentHash.toUpperCase() },
    /contentHash/,
  );
  refused(
    defect(
      (c) => {
        firstLesson(c).title = 'Tampered';
      },
      { rehash: false },
    ),
    /does not match/,
  );
  refused(
    defect(
      (c) => {
        c.keymap.lessons.pop();
      },
      { rehash: false },
    ),
    /does not match/,
  );
});

test('ids must be unique across the copy', () => {
  refused(
    defect((c) => {
      c.courses[1].id = c.courses[0].id;
    }),
    /course .* appears twice/,
  );
  refused(
    defect((c) => {
      c.courses[1].units[0].id = c.courses[0].units[0].id;
    }),
    /unit .* appears twice/,
  );
  refused(
    defect((c) => {
      secondLesson(c).id = firstLesson(c).id;
    }),
    /lesson .* appears twice/,
  );
  refused(
    defect((c) => {
      secondLesson(c).items[0].id = firstLesson(c).items[0].id;
    }),
    /phrase .* appears twice/,
  );
  refused(
    defect((c) => {
      secondLesson(c).exercises[0].id = firstLesson(c).exercises[0].id;
    }),
    /exercise .* appears twice/,
  );
  refused(
    defect((c) => {
      c.languages.push({ ...c.languages[0] });
    }),
    /language .* appears twice/,
  );
  refused(
    defect((c) => {
      c.varieties.push({ ...c.varieties[0] });
    }),
    /variety .* appears twice/,
  );
});

test('a language needs a direction the screens know', () => {
  for (const direction of ['up', 'RTL', '', undefined])
    refused(
      defect((c) => {
        c.languages[0].direction = direction;
      }),
      /direction/,
    );
});

test('every language must be one this app can present', () => {
  refused(
    defect((c) => {
      c.languages[0].code = 'fr';
    }),
    /fr is not one this app can show/,
  );
});

test('an exercise needs a kind the player knows', () => {
  for (const kind of ['essay', 'Meaning', '', undefined])
    refused(
      defect((c) => {
        firstLesson(c).exercises[0].kind = kind;
      }),
      /has kind/,
    );
});

test('an exercise asks about, and offers, only phrases of its own lesson', () => {
  refused(
    defect((c) => {
      firstLesson(c).exercises[0].item = secondLesson(c).items[0].id;
    }),
    /asks about a phrase outside its lesson/,
  );
  refused(
    defect((c) => {
      firstLesson(c).exercises[0].item = 'ps-itm-ffffff';
    }),
    /outside its lesson/,
  );
  refused(
    defect((c) => {
      const exercise = firstLesson(c).exercises.find(
        (e) => e.kind !== 'assemble',
      );
      exercise.options[0] = secondLesson(c).items[0].id;
    }),
    /offers a phrase outside its lesson/,
  );
});

test('choices must make sense: no answer among its own distractors, none twice, none on assemble', () => {
  refused(
    defect((c) => {
      const exercise = firstLesson(c).exercises[0];
      exercise.options = [exercise.item, ...exercise.options];
    }),
    /offers its answer twice/,
  );
  refused(
    defect((c) => {
      const exercise = firstLesson(c).exercises[0];
      exercise.options = [exercise.options[0], exercise.options[0]];
    }),
    /appears twice/,
  );
  refused(
    defect((c) => {
      firstLesson(c).exercises[0].options = [];
    }),
    /has no options/,
  );
  refused(
    defect((c) => {
      const lesson = secondLesson(c);
      const assemble = lesson.exercises.find((e) => e.kind === 'assemble');
      assemble.options = [lesson.items.find((i) => i.id !== assemble.item).id];
    }),
    /assemble exercise .* has options/,
  );
});

test('every lesson has at least one exercise and one phrase', () => {
  refused(
    defect((c) => {
      firstLesson(c).exercises = [];
    }),
    /has no exercises/,
  );
  refused(
    defect((c) => {
      firstLesson(c).items = [];
      firstLesson(c).exercises = [];
    }),
    /has no phrases/,
  );
});

test('text the screens show must be text', () => {
  refused(
    defect((c) => {
      firstLesson(c).items[0].native = '  ';
    }),
    /native is empty/,
  );
  refused(
    defect((c) => {
      firstLesson(c).items[0].meaning = null;
    }),
    /meaning is not text/,
  );
  refused(
    defect((c) => {
      firstLesson(c).items[0].context = null;
    }),
    /context is not text/,
  );
  refused(
    defect((c) => {
      firstLesson(c).title = 7;
    }),
    /title is not text/,
  );
});

test('varieties and courses must agree on language', () => {
  refused(
    defect((c) => {
      c.courses[0].variety = c.varieties.find(
        (v) => v.language !== c.courses[0].language,
      ).id;
    }),
    /variety the copy does not list/,
  );
  refused(
    defect((c) => {
      firstLesson(c).items[0].variety = 'ps-var-nowhere';
    }),
    /variety the copy does not list/,
  );
  refused(
    defect((c) => {
      c.courses[1].language = c.courses[0].language;
      c.courses[1].variety = c.courses[0].variety;
    }),
    /two courses teach/,
  );
});

test('the keymap may point only at what the copy holds', () => {
  refused(
    defect((c) => {
      c.keymap.lessons[0].lesson_id = 'ps-lsn-ffffff';
    }),
    /keymap.lessons\[0\] points at a lesson/,
  );
  refused(
    defect((c) => {
      c.keymap.courses[0].course_id = 'ps-crs-nowhere';
    }),
    /keymap.courses\[0\] points at a course/,
  );
  refused(
    defect((c) => {
      c.keymap.items[0].item_id = 'ps-itm-ffffff';
    }),
    /keymap.items\[0\] points at a phrase/,
  );
});

test('numbers and keys stay inside what hashes the same in the database', () => {
  refused(
    defect((c) => {
      firstLesson(c).order = 1.5;
    }),
    /not a whole number/,
  );
  refused(
    defect((c) => {
      firstLesson(c).order = 2 ** 53;
    }),
    /not a whole number/,
  );
  refused(
    defect((c) => {
      firstLesson(c).items[0]['näme'] = 'x';
    }),
    /not ASCII/,
  );
});

// ---------------------------------------------------------------------------
// isNewerRelease
// ---------------------------------------------------------------------------

test('isNewerRelease compares year, month and number as numbers', () => {
  assert.equal(isNewerRelease('content@2026.09.2', 'content@2026.09.1'), true);
  assert.equal(isNewerRelease('content@2026.09.10', 'content@2026.09.9'), true);
  assert.equal(isNewerRelease('content@2026.10.1', 'content@2026.09.12'), true);
  assert.equal(isNewerRelease('content@2027.01.1', 'content@2026.12.40'), true);
  assert.equal(isNewerRelease('content@2026.09.1', 'content@2026.09.1'), false);
  assert.equal(isNewerRelease('content@2026.09.1', 'content@2026.09.2'), false);
  assert.equal(
    isNewerRelease('content@2026.09.9', 'content@2026.09.10'),
    false,
  );
  assert.equal(
    isNewerRelease('content@2026.09.12', 'content@2026.10.1'),
    false,
  );
});

test('a development build is never newer; a published release is newer than one', () => {
  const dev = 'content@2026.09.dev+f76adfa';
  assert.equal(isNewerRelease(dev, 'content@2026.09.1'), false);
  assert.equal(isNewerRelease(dev, 'content@2020.01.1'), false);
  assert.equal(isNewerRelease(dev, 'content@2026.08.dev+aaaaaaa'), false);
  assert.equal(isNewerRelease('content@2026.09.1', dev), true);
  assert.equal(isNewerRelease('content@2020.01.1', dev), true);
});

test('isNewerRelease: rubbish is never newer', () => {
  for (const name of ['', 'mvp', 'content@2026.9.1', 'content@x.y.z'])
    assert.equal(isNewerRelease(name, 'content@2026.09.1'), false, name);
});

// ---------------------------------------------------------------------------
// releaseAnswer (the route) and releaseStep (the refresher)
// ---------------------------------------------------------------------------

const UPSTREAM = {
  release: 'content@2026.09.2',
  contentHash: FILE.contentHash,
  payload: { ...FILE, release: 'content@2026.09.2', commit: null },
};

test('releaseAnswer: the full copy for a client that does not have it', () => {
  assert.deepEqual(releaseAnswer(UPSTREAM, null), UPSTREAM);
  assert.deepEqual(releaseAnswer(UPSTREAM, 'sha256-other'), UPSTREAM);
});

test('releaseAnswer: reset when the function answers null (the kill switch, or nothing released)', () => {
  assert.deepEqual(releaseAnswer(null, null), { reset: true });
  assert.deepEqual(releaseAnswer(null, FILE.contentHash), { reset: true });
});

test('releaseAnswer: unchanged for a client that has it, or when there is nothing to give', () => {
  assert.deepEqual(releaseAnswer(UPSTREAM, FILE.contentHash), {
    unchanged: true,
  });
  for (const upstream of [
    undefined, // the route could not ask: no settings, unreachable, an error status
    'text',
    [],
    { release: 'content@2026.09.2', contentHash: FILE.contentHash }, // no payload
    { ...UPSTREAM, payload: 'x' },
    { ...UPSTREAM, release: 3 },
    { ...UPSTREAM, contentHash: null },
    { message: 'permission denied', code: '42501' }, // a PostgREST error body
  ])
    assert.deepEqual(releaseAnswer(upstream, null), { unchanged: true });
});

/** The baseline under a published name (content@YYYY.MM.N), for releaseStep's `baseline`. */
const BASE = { release: 'content@2026.09.1', contentHash: FILE.contentHash };
/** Another copy: the baseline with its first lesson retitled, re-hashed. */
const OTHER = defect((c) => {
  firstLesson(c).title = 'Hello again';
});
const other = (release) => ({
  release,
  contentHash: OTHER.contentHash,
  payload: { ...OTHER, release, commit: null },
});

test('releaseStep: adopts a verified newer copy', () => {
  const step = releaseStep(other('content@2026.09.2'), BASE, BASE);
  assert.equal(step.action, 'adopt');
  assert.equal(step.copy.release, 'content@2026.09.2');
  assert.equal(step.copy.contentHash, OTHER.contentHash);
  // Against a development baseline, any published release is newer.
  const dev = { release: FILE.release, contentHash: FILE.contentHash };
  assert.equal(releaseStep(UPSTREAM, dev, dev).action, 'adopt');
});

test('releaseStep: the same name with other content is replaced', () => {
  // A browser that stored the fixture stack's content@2026.09.2, now
  // talking to the hosted project, whose content@2026.09.2 differs.
  const active = {
    release: 'content@2026.09.2',
    contentHash: 'sha256-fixture',
  };
  const step = releaseStep(other('content@2026.09.2'), active, BASE);
  assert.equal(step.action, 'adopt');
  assert.equal(step.copy.contentHash, OTHER.contentHash);
});

test('releaseStep: a lower name from the server replaces a higher one (a reset project)', () => {
  const active = { release: 'content@2026.09.5', contentHash: 'sha256-old' };
  const step = releaseStep(other('content@2026.09.2'), active, BASE);
  assert.equal(step.action, 'adopt');
  assert.equal(step.copy.release, 'content@2026.09.2');
});

test('releaseStep: keeps a copy it already shows, and skips downloading it again', () => {
  const active = {
    release: 'content@2026.09.2',
    contentHash: OTHER.contentHash,
  };
  assert.deepEqual(releaseStep(other('content@2026.09.2'), active, BASE), {
    action: 'keep',
    skip: OTHER.contentHash,
  });
});

test('releaseStep: back to the baseline on reset, or when the server has nothing newer than the build', () => {
  const active = {
    release: 'content@2026.09.2',
    contentHash: OTHER.contentHash,
  };
  assert.deepEqual(releaseStep({ reset: true }, active, BASE), {
    action: 'baseline',
  });
  // Already on the baseline: nothing to do.
  assert.deepEqual(releaseStep({ reset: true }, BASE, BASE), {
    action: 'keep',
  });
  // The build ships a later release than the server's latest.
  const later = { release: 'content@2026.10.1', contentHash: FILE.contentHash };
  assert.deepEqual(releaseStep(other('content@2026.09.2'), active, later), {
    action: 'baseline',
    skip: OTHER.contentHash,
  });
  assert.deepEqual(releaseStep(other('content@2026.09.2'), later, later), {
    action: 'keep',
    skip: OTHER.contentHash,
  });
  // The baseline's own name is not newer than itself.
  assert.equal(
    releaseStep(other('content@2026.09.1'), active, BASE).action,
    'baseline',
  );
});

test('releaseStep: keeps what it has for anything it cannot show', () => {
  for (const answer of [
    { unchanged: true },
    null,
    undefined,
    'x',
    [],
    { ...UPSTREAM, release: 3 },
    { ...UPSTREAM, contentHash: null },
    // A development name from upstream is never adopted.
    { ...UPSTREAM, release: 'content@2026.09.dev+f76adfa' },
  ])
    assert.deepEqual(releaseStep(answer, BASE, BASE), { action: 'keep' });
  // A payload that fails verification, or hashes to something else: kept,
  // and not downloaded again.
  const bad = other('content@2026.09.2');
  bad.payload = { ...bad.payload, schemaVersion: 2 };
  assert.deepEqual(releaseStep(bad, BASE, BASE), {
    action: 'keep',
    skip: OTHER.contentHash,
  });
  const zero = `sha256-${'0'.repeat(64)}`;
  assert.deepEqual(
    releaseStep(
      { ...other('content@2026.09.2'), contentHash: zero },
      BASE,
      BASE,
    ),
    { action: 'keep', skip: zero },
  );
});

test('releaseStep names a rolled-back payload after the release that published it', () => {
  const rollback = {
    release: 'content@2026.09.3',
    contentHash: FILE.contentHash,
    payload: { ...FILE, release: 'content@2026.09.1', commit: null },
  };
  const active = {
    release: 'content@2026.09.2',
    contentHash: OTHER.contentHash,
  };
  const dev = { release: FILE.release, contentHash: FILE.contentHash };
  const step = releaseStep(rollback, active, dev);
  assert.equal(step.action, 'adopt');
  assert.equal(step.copy.release, 'content@2026.09.3');
  assert.equal(verifyLearnerCopy(step.copy).ok, true);
  // The payload itself is left as it was.
  assert.equal(rollback.payload.release, 'content@2026.09.1');
});
