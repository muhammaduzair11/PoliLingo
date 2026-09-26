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
