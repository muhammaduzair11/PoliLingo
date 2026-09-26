# Testing strategy

Small, honest, and matched to a two-person team on a twelve-week deadline. The goal is to
catch the failures that would actually hurt, not to reach a coverage number.

There are two suites, both on `node --test`: **unit tests** of pure logic, which need
nothing but Node, and **database tests**, which need the local Supabase stack.

---

## The runner

`node --test`, built into Node. There is no test framework dependency.

```powershell
npm test                              # every unit test
node --test tests/learning.test.mjs   # one file
node --test --test-name-pattern="streak"
```

Tests are `.mjs` files in `tests/`, using `node:test` and `node:assert/strict`, and import
the TypeScript modules directly (Node strips the types):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceSession, initialState } from '../lib/progress.ts';

test('replaying a finished lesson awards 5 XP, not 20', () => {
  // ...
  assert.equal(next.xp, 25);
});
```

So a module a test imports uses relative imports with the `.ts` extension and only erasable
TypeScript (no enums, namespaces or parameter properties).

Do not add Jest or Vitest. ADR-0012 records why, and names the trigger for
revisiting it.

---

## What gets tested

### Always: pure learning logic

`lib/progress.ts` is the highest-value test target in the codebase, because it is the only
place where a bug **destroys something the learner cannot get back**. A rendering bug is
visible and fixable. A streak wrongly reset is gone.

Every one of these needs a test, and `tests/learning.test.mjs` already covers some:

- `parseState` recovers from corrupt, truncated, empty and future-versioned stored data
- `advanceSession` awards 20 XP on first completion and 5 on replay
- The same session ID never awards twice, however many times it is replayed
- `streak` is correct across midnight, across a missed day, and across a timezone change
- `unlocked` enforces sequential progression and cannot be skipped
- `recordAnswer` queues a mistake once, not once per attempt

These functions are pure, so testing them is cheap. There is no excuse for an untested
change here, and `CODEOWNERS` flags the file for review.

### Always: sync, live content and the platform's rules

The same approach covers the platform. Each piece of logic lives in `lib/` as a pure
function with its own test file:

- `sync.test.mjs` — the envelope a device sends, merging the account's copy back, the
  account-switch question, and the XP identity (15 per completed lesson plus 5 per rewarded
  session)
- `release-verify.test.mjs`, `release-cache.test.mjs`, `content-live.test.mjs` — checking
  a published learner copy, keeping it in the browser, and switching the app's content to it
- `canonical-json.test.mjs`, `sha256.test.mjs` — the hashing the database repeats; shared
  vectors in `tests/fixtures/` are checked on both sides
- `age-gate`, `safe-next`, `in-app-browser`, `auth-hint`, `account-store` — sign-in
- `db-errors.test.mjs` — every database error code has a plain-English sentence, and an
  unknown error never shows raw database text
- `invite-link`, `overview`, `review`, `editor`, `exercise-generator`, `release-diff`,
  `script-check` — the workspace's screens
- `boundaries.test.mjs` — the lines learner pages never cross: no learner file imports
  Supabase or the console, the account code loads only through a dynamic import, the proxy
  runs only on workspace routes, and no secret key appears in the app

### Always: the database

Every rule that matters is enforced in the database, so it is tested there:
`tests/db/*.test.mjs`, using `pg` against the local stack. Each test runs inside a
transaction that is rolled back, calls the database functions directly as a given user,
and checks the refusal code.

- `invariants.test.mjs` — RLS is on for every table; `anon` holds no table privilege and
  can execute exactly one function, `get_learner_release`; every definer function pins its
  `search_path`; one learner cannot read another; a signed-in user with no role reads no
  content; the SQL hashing matches the shared vectors
- `accounts`, `sync`, `people`, `review`, `editor`, `publish`, `release-read` — each
  function's refusals, one test per code, and the behaviour around them (for example: no
  self-approval, an admin cannot also be a reviewer, the last admin cannot leave, a rebuilt
  seed release has the same content hash)

`tests/db/helpers.mjs` gives the building blocks: `tx()`, `user()`, `as()`, `asAnon()`,
`grant()`, `expectCode()` and `seedLesson()`.

The database tests are **not** part of `npm test`. Run them with the local stack up:

```powershell
npm run test:db
```

That takes a lock shared by every worktree on the machine (one local stack serves them all),
runs `supabase db reset` (this worktree's migrations and seeds), then the tests. Never run
`supabase db reset` outside it.

### Always: content data

In the `content` repository, not here. `npm run validate` checks schema conformance plus
the things a schema cannot: duplicate IDs, orphan references, a distractor equal to its
own correct answer, missing romanisation, unreviewed content in a published course.

Content bugs reach learners as wrong language, which is the most damaging kind of bug this
project can ship.

Here, `tests/content-release.test.mjs` checks the committed baseline learner copy,
`content/release.json`: its content hash, recomputed exactly as the content build does, so
a hand edit fails; that it holds only learner-copy fields and no Hindko; and the invariants
the app relies on, such as every course having lessons and every exercise using only its
own lesson's phrases. It asserts **invariants, never counts**: no "three lessons", no "four
phrases", no XP total worked out from today's lessons. A release with more, fewer or
resized lessons must keep `npm test` green; tests in `learning.test.mjs` take their lessons
and sizes from whichever release is committed for the same reason. A release published in
the app is checked by the database's own `verify_learner_copy` and again in the browser by
`verifyLearnerCopy` before a learner sees it.

### Sometimes: React components

**Not in v1.** ADR-0013 records this.

Adding a component test framework means adding React Testing Library, jsdom, and a runner
that understands JSX — which means adding back the framework `node --test` was chosen to
avoid. For two people over twelve weeks, on a UI that is still changing shape weekly, that
cost buys very little: tests written against a moving target get deleted rather than
maintained.

Instead: pure logic is extracted out of components and tested, and the UI is verified by
the scripted manual pass below. `tests/screens.test.mjs` is where the learner screens'
logic is tested: which course a returning learner is taken to (`selectedCourse()`), where a
lesson the release no longer holds leads (`missingLessonRedirect()`), how the learning map
counts and draws a course of one, three or eight lessons (`lib/learning-map.ts`), the
credits in Settings, the landing page's try-it question (`lib/teaser.ts`), and wording that
depends on how many languages or lessons there are.

Revisit when the UI stops changing weekly, or when a third developer joins — whichever
comes first.

### Before each release: the manual pass

`docs/validation.md` is the scripted checklist. It is not optional and it is not "click
around a bit" — it is a fixed sequence run on a real phone and a desktop browser, covering
onboarding, a full lesson, the review queue, streak rollover, reduced motion, RTL rendering
and offline behaviour.

Run it against the **Vercel preview** before merging anything that touches the lesson flow,
and against production after every release.

---

## The local stack

Docker Desktop plus the Supabase CLI (`npx supabase`, a dev dependency). One stack for
every worktree on the machine.

| Command                      | What it does                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `npm run db:start`           | Starts the stack: API `http://127.0.0.1:54321`, database on port 54322, mail on 54324 |
| `npm run db:stop`            | Stops it                                                                              |
| `npx supabase status -o env` | Prints the local URL and publishable key for `.env.local`                             |
| `npm run test:db`            | Resets the database under the shared lock, then runs `tests/db/`                      |
| `npm run otp -- <email>`     | Prints the latest 6-digit sign-in code the stack emailed to that address              |
| `npm run db:real-content`    | Resets with the real curriculum in place of the fixture (below)                       |

The reset loads `supabase/seed.sql` and `supabase/seeds/`: the test accounts below, and
`20_content_fixture.sql`, two synthetic demo lessons in the made-up variety
`ps-var-fixture` (no real phrases; generated by the content repository and committed).
`npm run db:real-content` loads `../content/dist/seed.sql` instead, which you build in the
private content repository and never commit. Any later reset puts the fixture back.

These seeds are for the local stack only: see the runbook before pointing the CLI at the
real project.

### Local test accounts

`supabase/seeds/10_people.sql`. Nobody has a password: sign in at `/sign-in` with "Email me
a code", then `npm run otp -- <email>`.

| Email                         | Role                                          |
| ----------------------------- | --------------------------------------------- |
| `admin@polilingo.test`        | admin                                         |
| `editor@polilingo.test`       | editor, all languages                         |
| `reviewer.ps@polilingo.test`  | reviewer, Northern Pashto (`ps-var-yusufzai`) |
| `reviewer.ps2@polilingo.test` | reviewer, Northern Pashto (`ps-var-yusufzai`) |
| `reviewer.hno@polilingo.test` | reviewer, Hindko (`hno-var-hazara`)           |
| `learner@polilingo.test`      | no role                                       |
| `learner2@polilingo.test`     | no role                                       |
| `teen@polilingo.test`         | no role, age band 13–17                       |

Demo items are never reviewed, so the reviewers' queues start empty. To try review, sign in
as the editor, add a lesson to the fixture course with variety `ps-var-yusufzai`, give it
phrases and exercises, and submit it; either Pashto reviewer can then review it.

AI agents use these local accounts only. They never operate a reviewer account on the real
project.

---

## Regression rule

**Every bug fix ships with a test that fails before the fix and passes after it.**

This is the only coverage rule. There is no percentage target, because a coverage gate on
a codebase this size produces tests written to satisfy the gate rather than to catch bugs.

If a bug genuinely cannot be tested — a rendering artefact, a Safari-specific layout issue —
say so in the pull request and describe how you verified it instead. An honest "not tested,
here is what I checked manually" is fine. Silence is not.

---

## What we deliberately do not do

| Not doing                 | Why                                                      | Revisit when                                             |
| ------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Coverage thresholds       | Produces gaming, not tests                               | Never, probably                                          |
| Component render tests    | Framework cost vs a UI still changing weekly             | UI stabilises, or a third developer joins                |
| End-to-end suite          | Tests against a moving target get deleted                | The UI stabilises: three Playwright smoke tests, no more |
| Visual regression testing | Needs a stable design and a budget                       | Stage 2                                                  |
| Load testing              | Fewer than a thousand learners on managed infrastructure | Before any paid acquisition                              |
| Mutation testing          | Interesting; not at this size                            | No                                                       |

---

## Accessibility and performance

Both are already-made promises in `docs/design.md`, not new work — the MVP honours reduced
motion, uses real HTML text, sets `lang` and RTL direction on native-script runs, and gates
audio behind a user gesture. They stay promises only if they are checked.

Per release, on the preview deployment:

- **Lighthouse** on the landing page and one lesson page, on mobile emulation. Record the
  four scores in the release notes. A drop is a regression like any other.
- **Keyboard only.** Complete one whole lesson without touching the mouse.
- **Reduced motion.** Turn it on at the OS level and confirm decorative animation stops.
- **RTL.** Confirm Pashto and Urdu text renders right-to-left with correct
  `lang` attributes, and that mixed English-and-native lines do not scramble.

The last one matters more here than on most projects. Getting Arabic-script rendering
subtly wrong is not a cosmetic bug for this audience — it undermines the product's claim to
take these languages seriously.

---

## In CI

`.github/workflows/ci.yml` runs four gates on every pull request, in ascending order of
cost so the cheapest failure reports first:

```
npm run typecheck   →  npm run lint  →  npm test  →  npm run build
```

`verify` and `pr-title` are required checks and must pass before merge. Formatting runs as
a separate, non-blocking job so a stray space cannot mask a real type error behind it.

`.github/workflows/db.yml` runs the database tests on every pull request (and on pushes to
`main` and `platform`): it starts a fresh local stack, runs `supabase db reset`, then
`npm run test:db:ci` (the same tests, without the lock). It needs Docker and takes a few
minutes, so it reports without being a required check. Read it before merging anything that
touches `supabase/`.
