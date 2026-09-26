# Testing strategy

Small, honest, and matched to a two-person team on a twelve-week deadline. The goal is to
catch the failures that would actually hurt, not to reach a coverage number.

---

## The runner

`node --test`, built into Node. There is no test framework dependency.

```powershell
npm test                              # every test
node --test tests/learning.test.mjs   # one file
node --test --test-name-pattern="streak"
```

Tests are `.mjs` files in `tests/`, using `node:test` and `node:assert/strict`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceSession, initialState } from '../lib/progress.js';

test('replaying a finished lesson awards 5 XP, not 20', () => {
  // ...
  assert.equal(next.xp, 25);
});
```

Do not add Jest or Vitest. ADR-0012 records why, and names the trigger for revisiting it.

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

### Always: content data

In the `content` repository, not here. `npm run validate` checks schema conformance plus
the things a schema cannot: duplicate IDs, orphan references, a distractor equal to its
own correct answer, missing romanisation, unreviewed content in a published course.

Content bugs reach learners as wrong language, which is the most damaging kind of bug this
project can ship.

Here, `tests/content-release.test.mjs` checks the committed learner copy,
`content/release.json`: its content hash, recomputed exactly as the content build does, so
a hand edit fails; that it holds only learner-copy fields and no Hindko; and the invariants
the app relies on, such as every course having lessons and every exercise using only its
own lesson's phrases. It asserts **invariants, never counts**: no "three lessons", no "four
phrases", no XP total worked out from today's lessons. A content release that adds, retires
or resizes lessons must keep `npm test` green; tests in `learning.test.mjs` take their
lessons and sizes from whichever release is committed for the same reason.

### Sometimes: React components

**Not in v1.** ADR-0013 records this.

Adding a component test framework means adding React Testing Library, jsdom, and a runner
that understands JSX — which means adding back the framework `node --test` was chosen to
avoid. For two people over twelve weeks, on a UI that is still changing shape weekly, that
cost buys very little: tests written against a moving target get deleted rather than
maintained.

Instead: pure logic is extracted out of components and tested, and the UI is verified by
the scripted manual pass below. `tests/screens.test.mjs` is where that logic is tested:
which course a returning learner is taken to (`selectedCourse()`), where a lesson the
release no longer holds leads (`missingLessonRedirect()`), how the learning map counts and
draws a course of one, three or eight lessons (`lib/learning-map.ts`), the credits in
Settings, the landing page's try-it question (`lib/teaser.ts`), and wording that depends
on how many languages or lessons there are.

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

## Regression rule

**Every bug fix ships with a test that fails before the fix and passes after it.**

This is the only coverage rule. There is no percentage target, because a coverage gate on
a codebase this size produces tests written to satisfy the gate rather than to catch bugs.

If a bug genuinely cannot be tested — a rendering artefact, a Safari-specific layout issue —
say so in the pull request and describe how you verified it instead. An honest "not tested,
here is what I checked manually" is fine. Silence is not.

---

## What we deliberately do not do

| Not doing                     | Why                                                      | Revisit when                                                     |
| ----------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Coverage thresholds           | Produces gaming, not tests                               | Never, probably                                                  |
| Component render tests        | Framework cost vs a UI still changing weekly             | UI stabilises, or a third developer joins                        |
| End-to-end suite in weeks 1–4 | Tests against a moving target get deleted                | ~week 6, after auth lands: three Playwright smoke tests, no more |
| Visual regression testing     | Needs a stable design and a budget                       | Stage 2                                                          |
| Load testing                  | Fewer than a thousand learners on managed infrastructure | Before any paid acquisition                                      |
| Mutation testing              | Interesting; not at this size                            | No                                                               |

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
