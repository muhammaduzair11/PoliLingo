# Test fixtures

## `progress-v1-mvp.json`

A `polilingo.progress.v1` blob written by the MVP's own storage code, which every
release before v0.2 shipped. The migration tests read it, so they check what is really in
learners' browsers rather than a shape rebuilt from today's code, which would change
whenever the code does.

**Generated** on 2026-09-24 with Node 24, from `lib/progress.ts` and `lib/courses.ts` at
`903efc0` on `main`. `lib/progress.ts` there is unchanged since the MVP commit, `406aa15`.

```sh
mkdir -p /tmp/mvp/lib
git show 903efc0:lib/progress.ts > /tmp/mvp/lib/progress.ts
git show 903efc0:lib/courses.ts > /tmp/mvp/lib/courses.ts
node tests/fixtures/make-progress-v1-mvp.mjs /tmp/mvp
```

`make-progress-v1-mvp.mjs` drives the MVP's functions the way its screens did, checks that
the MVP's own `parseState` accepts the result unchanged, and prints it exactly as the MVP
stored it. Over two days it completes three lessons (one of them Hindko), makes and reviews
a mistake, replays a lesson for 5 XP, and leaves a fourth lesson half-way with the feedback
for a wrong answer still showing. It ends with 65 XP, a two-lesson daily goal, sounds on
and transliteration off.

Browsers hold the blob as one line. This file is the same JSON pretty-printed by oxfmt, so
the tests use `JSON.stringify(JSON.parse(file))`, which gives back the stored string byte
for byte.

Do not regenerate it. The session IDs are random, and the point is that it stays fixed. If
a test needs a different blob, add a new fixture beside this one.

## `progress-v1-mvp-after-rollback.json`

The same learner a few days later, after the app was rolled back past v0.2: the blob the
MVP writes to `polilingo.progress.v1` once they carry on there. The rollback and reset tests
use it as what an older build leaves in the v1 key, so they merge back what the MVP really
writes and not a blob made with today's lesson code.

**Generated** on 2026-09-24 with Node 24, from the same `lib/` at `903efc0` as above,
starting from `progress-v1-mvp.json`:

```sh
node tests/fixtures/make-progress-v1-mvp-after-rollback.mjs /tmp/mvp
```

On 2026-09-25 the learner finishes the Pashto lesson left half-way (20 XP, so 85 in all),
taps "Play this lesson again", and leaves the new run after two answers. That new run
replaces the one they finished, which is what a merge has to handle. The same rules apply:
do not regenerate it.

## `progress-v2.json`

A `polilingo.progress.v2` blob written by v0.2's own storage code: the build before content
releases, which is pull request #19 (`feat/progress-backup-export-import`). v0.2 is the
last build to write the v2 key; the migration and one-deploy rollback tests read it.

**Generated** on 2026-09-25 with Node 24, from `lib/progress.ts`, `lib/courses.ts` and
`lib/random-id.ts` at `713afa7`, the head of #19, which is what `main` holds once #19 is
merged:

```sh
mkdir -p /tmp/v02/lib
for f in progress.ts courses.ts random-id.ts; do git show 713afa7:lib/$f > /tmp/v02/lib/$f; done
node tests/fixtures/make-progress-v2.mjs /tmp/v02
```

It starts from `progress-v1-mvp.json`, as the learner's first load of v0.2 did: v0.2's own
`hydrateProgress()` backs up and migrates the v1 key, and on 2026-09-22 the learner
finishes the first Urdu lesson. It ends with 85 XP, the v1 blob's fingerprint recorded as
merged, and the Pashto lesson the MVP left half-way still in progress. The same rules as
above apply: pretty-printed by oxfmt, and do not regenerate it.

## `progress-v2-after-rollback.json`

The same learner after the app was rolled back one deploy, from content releases to v0.2:
the blob v0.2 writes to `polilingo.progress.v2` once they carry on there. The rollback
tests use it as what v0.2 leaves in the v2 key, since the current build never writes it.

**Generated** on 2026-09-25 with Node 24, from the same `lib/` at `713afa7` as above,
starting from `progress-v2.json` and the unchanged v1 key and backup:

```sh
node tests/fixtures/make-progress-v2-after-rollback.mjs /tmp/v02
```

On 2026-09-27 the learner finishes the Pashto lesson left half-way, then the second Urdu
lesson with one mistake, for 125 XP in all. Do not regenerate it.

## `progress-v2-opened.json`

What v0.2 writes to `polilingo.progress.v2` when it is only opened, after a rollback of one
deploy, by a learner who went straight from the MVP to content releases and so had no v2
key. v0.2 migrates the v1 key, as it always does, and its provider saves the result as soon
as the app has loaded, although the learner does nothing. The reset tests use it to check
that such a blob does not bring back progress a reset took away.

**Generated** on 2026-09-25 with Node 24, from the same `lib/` at `713afa7` as above,
starting from `progress-v1-mvp.json`, its backup and a `polilingo.progress.v3` key, which
v0.2 does not read:

```sh
node tests/fixtures/make-progress-v2-opened.mjs /tmp/v02
```

It ends with the MVP learner's 65 XP and the v1 blob's fingerprint recorded as merged. Do
not regenerate it.
