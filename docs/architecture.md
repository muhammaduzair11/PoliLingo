# PoliLingo architecture — as built

> **Scope.** This document describes **what is deployed today**, and nothing else. If a
> sentence here is not true of the current `main` branch, it is a bug in this document.
>
> The _target_ architecture — seven layers, Supabase, Cloudflare R2, a content database,
> community review workflows — lives in `technical/architecture-target.md` in the
> [docs repository](https://github.com/muhammaduzair11/polilingo-docs), together with the ordered path
> from here to there.
>
> Keeping the two apart is deliberate. A document that mixes what exists with what is
> planned stops being usable for either purpose within a month.

## Overview

PoliLingo is a language-learning web app with a client-first architecture. Content is
static, state lives in the browser, and there is no backend. That is a real property, not
an omission: it is why the app has no credentials to leak, no database to migrate and no
server to fall over.

## 1. Stack

- **Next.js 16** with App Router and Turbopack, **React 19**, **TypeScript** in strict mode
- **Tailwind CSS v4** via `@tailwindcss/postcss`, with theme tokens bridged through CSS
  custom properties in `app/styles/tokens.css`
- **shadcn / Base UI** primitives in `components/ui/`
- **oxlint** (type-aware, through `oxlint-tsgolint`) and **oxfmt**, replacing ESLint and
  Prettier
- **`node --test`** for testing, rather than Jest or Vitest
- Node `>= 22.13.0`, `"type": "module"`
- **No database, no server functions, no environment variables** — fully static plus
  client state

## 2. Routes

| Route                       | Rendering | Purpose                                                          |
| --------------------------- | --------- | ---------------------------------------------------------------- |
| `/`                         | Static    | Landing: hero, language cards, how it works, a try-it question   |
| `/onboarding/[course]`      | Dynamic   | Two-step course introduction and commitment                      |
| `/learn`                    | Static    | The remembered course, or the language picker when there is none |
| `/learn/[course]`           | Dynamic   | Learning map: lesson path, streak, badges                        |
| `/lesson/[course]/[lesson]` | Dynamic   | Study cards plus the lesson's exercises                          |
| `/settings`                 | Static    | Sound, motion, goal, export/import and reset controls            |
| `/_not-found`               | Static    | Fallback                                                         |

Course segments are the slugs `pashto` and `urdu`; lesson segments are permanent lesson ids
such as `ps-lsn-0a41c2`, which never change when a lesson is reordered. Both are resolved by
`lib/content.ts`. A course segment the release does not hold, other than a redirected one
below, is the not-found view. A lesson segment the release does not hold, in a course it
shows, is a lesson that has left the release, or an old bookmark or remembered redirect to
one: `/lesson/<course>/<lesson>` then replaces itself with that course's map
(`missingLessonRedirect()`), rather than showing "not found" for a lesson the learner may
have completed.

The learner's remembered course (`selected` in stored progress) is resolved when it is
read, by one helper, `selectedCourse()` in `lib/content.ts`: the course it names if the
release holds it, otherwise nothing. The header's links and its "Keep going" / "Let's go"
button, the home page's "Welcome back", the Settings back link and `/learn` all use it. With
no course the learner can see, because nothing is chosen yet or the stored slug is a course
the release does not hold (a Hindko learner from the MVP), the button reads "Let's go" and
those links lead to the home page's language picker (`#languages` on the home page, `/`
elsewhere), and there is no "Welcome back"; `/learn` replaces itself with `/#languages`.
The app never chooses a language for the learner and never writes a fallback to storage, so
the stored slug stays as it is. Only opening a course (`/learn/<slug>`, onboarding or a
lesson) records a new choice.

`next.config.ts` serves redirects that `lib/redirects.ts` works out from the content release,
so nobody keeps a list by hand:

- **A language the release does not hold** (Hindko, until it is reviewed): one pattern,
  `/:section(learn|lesson|onboarding)/hindko/:rest*`, to `/learn`. Temporary (307), never
  permanent, so browsers do not remember it; the day Hindko is in a release, the redirect is
  no longer generated and its links work again. No lesson id is named.
- **The MVP's lesson URLs**, such as `/lesson/pashto/greetings`, to the permanent id,
  `/lesson/pashto/ps-lsn-0a41c2`, one per keymap row in the release. Permanent (308): the
  old address will never mean anything else.

## 3. State model

All learner progress is in `localStorage` under `polilingo.progress.v3`, managed by
`components/learning-provider.tsx`. There are no accounts and no synchronisation. Each
storage version has its own key, and v3 is the only one this build writes:

- `polilingo.progress.v1`, the MVP's key, is copied verbatim to
  `polilingo.progress.v1.bak-<date>` once, before anything else is written, and is never
  written again. Its reader is never deleted.
- `polilingo.progress.v2`, v0.2's key from before content releases, is migrated on the first
  load and never written again. It stays exactly as v0.2 left it, so a rollback of one
  deploy finds it intact, and it is a backup of the v2 state.

Both old keys are still read on every load. v0.2 writes only v2, and builds before it only
v1, so whatever a learner adds there during a rollback, or in a tab left open from before,
is merged into the v3 state with `mergeProgress()` on the next load, v2 first. The v3 state
records a fingerprint of each blob it last merged (`v2Fingerprint`, `v1Fingerprint`), so an
unchanged blob is not merged again; a v2 blob carries the fingerprint of the v1 blob v0.2
merged, so that one is not merged twice. A blob this build cannot read is left in place
and not recorded, so a later build that can read it still merges it. A reset keeps both
fingerprints, both keys and the backups, so it stays reset unless an older build writes to
one of those keys again. One such write adds nothing: v0.2, opened during a rollback where
there is no v2 key (a learner who went straight from the MVP to content releases), migrates
the v1 key and saves it at once, although the learner does nothing. A new v2 blob that holds
only the v1 blob the state has already merged is therefore recorded, not merged. If it holds
anything more (a lesson, a replay, a streak day, XP), the whole blob is merged, and with it
what it held before the reset.

Two tabs open on this build, or on either side of a deploy, both write the whole state to
the v3 key, and there is no merge between them: the tab that saves last wins, so a lesson
finished in one tab can be lost when a tab still showing older state saves a change such
as a preference. This was so before content releases too. The fix is to merge the other
tab's record on the browser's `storage` event; it needs a decision on how a reset in
another tab is treated, and is left to a follow-up.

A blob from a newer app version, in any of the three keys, is kept verbatim under
`polilingo.progress.unknown-<version>` before anything replaces it. It is kept once, and
never over a different blob already there, which goes to `unknown-<version>-<n>` instead.
The learner then sees the progress the older keys hold, otherwise a fresh start.

`completed` maps each finished lesson to the content release it was **first** completed in,
such as `content@2026.09.1`; a replay under a later release leaves it as it was, and a lesson
completed on both sides of a merge keeps the local value. Completions carried over from v1
and v2 record `mvp`: they were made before content releases existed, as was any `true` in an
older export. This is how the Gate 1 report tells completions made in the demo period from
completions of reviewed content. Practice events will carry the release id too when they arrive
(D10). Every value is a non-empty string, so a truthiness check still reads "completed".

**Progress is never deleted because the app does not recognise it.** Reading a record checks
only that it is well formed (the right types, in range), never what the content release
holds, so no release can make a learner's record unreadable:

- A completion on a lesson the release does not have, because it was retired or is not in
  this learner copy, is kept: stored, just not shown.
- An MVP key the keymap does not map, such as `hindko/greetings` while the release has no
  Hindko, is kept as it is. The learner copy has keymap rows only for lessons it holds, so
  a lesson held back from one release leaves its MVP key unmapped for learners who migrate
  under it. Every read of a v3 record moves an MVP key the current release maps to its
  permanent id (an entry already under that id wins), so the completion shows again once
  the lesson returns, and a lesson is never kept under two keys.
- A finished run is kept whatever the release says. Only an unfinished run whose lesson the
  release no longer has, or has at another size, is left out, because carrying on would
  ask different questions; the lesson starts again. The v1/v2 -> v3 migration leaves out
  every unfinished MVP run for the same reason.
- The course slug in `selected` is kept as it is, even for a course this build does not
  show. The screens resolve it when they read it (section 2) and never write back a
  fallback.

A v3 record that is not well formed, or does not parse at all, is copied verbatim to
`polilingo.progress.invalid-<version>-<n>` (`none` when it has no version; n one more than
any kept before, never over an existing copy) before a fresh start can replace it. The old
keys still merge in beside it. The v1 and v2 keys are never written, so an unreadable blob
there simply stays where it is.

The provider writes the v3 key only after hydration succeeds. If storage cannot be read, or
the backup or a copy kept aside cannot be written, the session runs in memory with the
storage warning showing, and the v3 key is not written until a later load succeeds.

Pure state logic lives in `lib/progress.ts` and contains no React and no browser APIs, so
it can be tested directly:

- **Hydration** — `parseState(raw)` reads a v1, v2 or v3 blob and always returns v3,
  falling back to `initialState()` rather than throwing on corrupt data. `loadProgress()`
  decides the backup, the unknown-version stash and the v2 and v1 merges without touching
  storage.
  `hydrateProgress(storage, today, newId)` runs it against any Storage-like object, makes
  those writes and says whether the session may persist, so every rule is unit-tested with
  a stub storage. Device and lesson-run IDs come from `randomId()` in `lib/random-id.ts`,
  which still works where `crypto.randomUUID` is missing, such as plain http on a LAN
  address
- **Export and import** — `exportProgress()` writes a dated envelope; `importProgress()`
  accepts an envelope or a bare blob of any version, from any content release, and merges
  it with
  `mergeProgress()`, the ADR-0010 algebra: sets grow, per-day counts take the maximum,
  ledgers append, XP takes the maximum, preferences stay the learner's own. For each lesson
  a finished run beats an unfinished one, a local unfinished run that has already been
  rewarded gives way to the other side's newer run, and otherwise the local run stays.
  Importing the same file twice changes nothing. A file that does not import says why: it
  is not a progress file, it comes from a newer version of the app, or it cannot be read
- **Reset** — `resetProgress(state)` is a clean state that keeps the device ID and both
  fingerprints
- **Sessions** — `newSession(course, lesson, id, size)` takes a caller-supplied ID, which is
  what prevents a refresh from awarding XP twice, and the lesson's exercise count
- **Recording** — `recordAnswer(session, correct)` queues mistakes and ignores duplicate
  attempts
- **Advancement** — `advanceSession(state, key, date)` completes a lesson, records the
  content release it was first completed in, awards XP (20 on
  first completion, 5 on replay) and updates the activity record
- **Unlocking** — `unlocked(state, course, lesson)` enforces sequential progression
- **Streaks** — `streak(activity, now)` and `localDate(date)` compute calendar streaks in
  the learner's browser-local timezone

`tests/learning.test.mjs` covers serialisation recovery and idempotent rewards, and tests
the migrations against v1 blobs written by the MVP's own code and v2 blobs written by
v0.2's (`tests/fixtures/`). New
state rules belong in this file as pure functions, with a test.

> This module is the highest-consequence code in the repository. A rendering bug is
> visible and fixable; a wrongly reset streak is gone. It is flagged in `CODEOWNERS` for
> that reason.

## 4. Content model

Curriculum is not authored here. `content/release.json` is the **learner copy** of a content
release (format `polilingo.learner@1`), built by the content repository's
`npm run build -- --target learner` (git is authoritative — ADR-0006 — and this file is a
projection of it, like the database will be). It is committed by a pull request per release
(ADR-0028) and **never edited by hand**: a content change is made in the content repository
and re-released. It records its release, the content commit and a content hash; Settings
shows the release.

The learner copy holds only what learners may see: lessons whose publish gate is open all the
way down (language, course, unit, lesson and their varieties), and only learner-facing fields
(text, romanisation, meaning, context, usage note, citation, exercises, order, the variety's
learner label, and the MVP keymap rows for what it holds). A language with nothing open, such
as Hindko until it is reviewed, has no entry, no ids and no keymap rows. So nothing is hidden
at run time: there is no content channel, and no setting can show more than the file holds.

`lib/content.ts` is the file's only importer, so moving delivery to a build-time fetch changes
one file. It checks the file's `format` and `schemaVersion` and throws otherwise, which fails
the build and the tests, and presents the `Course`, `Lesson`, `Phrase` and `Exercise` types
the screens use, so no screen knows where content comes from. What it adds on the way:

- **Permanent ids.** Lessons are `ps-lsn-0a41c2`, items `ps-itm-7f3a91`. They are the keys
  in stored progress, the lesson segment in URLs, and what audio and mastery will reference.
- **Only what the release holds.** `courses`, `knownLesson()` and `lessonSize()` know the
  learner copy's lessons and no others. Stored progress on any other lesson, retired or in a
  language not shown, is kept all the same (section 3).
- **Deterministic option order.** Distractors come from the release; the answer's slot is
  decided by a shuffle seeded on the exercise id, so it varies across exercises and is
  stable across renders.
- **Assemble tiles** are the other phrases' English words, not a fixed pair.
- **Varieties by id.** Each `Course` carries `varietyId`, the variety's permanent id
  (`ps-var-yusufzai`), for anything that keys, stores or routes on a variety, and
  `varietyLabel`, the learner label, for display only. The label is written for learners
  and may be reworded in any release, so it is never a key, id, URL segment or stored
  value.
- **Writing direction.** Each `Course` carries its language's `dir` from the release, and
  native-script text uses it rather than assuming right-to-left.

Each lesson's exercise count is its own, and sessions record it. Every item carries a
citation, not always a URL; the rest of its provenance stays in the content repository.
Settings credits each language's sources from those citations (`phraseSources()`): the
distinct citations of its phrases, where one that only adds a note to another (such as
"<source>; the name Sara inserted into a sourced template") is covered by it. Each
phrase's full citation is shown with its lesson hint.

**The screens take every count from the release.** How many languages the landing page
announces, how many lessons a course card and onboarding promise, and the learning map's
counts, "all done" check, badges, stops and path are all worked out from the courses and
lessons the release holds (`lib/learning-map.ts`, `lib/words.ts`), never written into the
copy. The map was drawn for three lessons and draws exactly that for three; it fits one,
eight or any other number. The site's meta description names the release's languages.

**Learners never see the state of the content.** The phrases in the release today are demo
data (the MVP's seed phrases, live until reviewed content replaces them); "demo" is an
internal word. The rule for screen copy: never say demo, sample, reviewed, unreviewed or
pending review, or anything else about review state, and let a language the release does
not hold simply be absent, with no "coming soon". No test enforces it; the release pass in
[`validation.md`](validation.md) checks it.

Checks keep the file honest. `tests/content-release.test.mjs` recomputes the content
hash exactly as the content build does, so a hand edit fails CI, and checks the file holds
only the learner copy's fields, no Hindko, and the invariants the app relies on (never
today's counts). And `next.config.ts` refuses a production build (`VERCEL_ENV=production`)
when the file's release is not a tag, `content@YYYY.MM.N`: a development build of content,
`content@YYYY.MM.dev+<sha>`, can reach previews but never production.

## 5. Components

- **`components/home.tsx`**, **`onboarding.tsx`**, **`dashboard.tsx`**, **`settings.tsx`** —
  one module per screen. What they decide lives in `lib/` as pure functions with tests
  (ADR-0013): `selectedCourse()` and `phraseSources()` in `lib/content.ts`, the learning
  map's progress, stops and path in `lib/learning-map.ts`, and count wording in
  `lib/words.ts`
- **`components/site-chrome.tsx`** — `Brand`, `Header`, `Footer`, `MotionButton`
- **`components/native.tsx`** — `Native`, script-safe text with correct `lang` and `dir`
- **`components/art.tsx`** — `Art` and `Poli`, image delivery from the pre-baked ladder
- **`components/status-views.tsx`** — `Loading`, `NotFoundView`
- **`components/lesson-player.tsx`** — exercise flow, feedback, completion
- **`components/learning-provider.tsx`** — state provider, persistence, and the
  `data-motion` attribute that drives reduced-motion behaviour

> The product UI used to be one 41 KB `components/polilingo.tsx`, which every feature
> touched. It was split into the modules above (#12) so that two developers can work in
> parallel without meeting in one file; `app/globals.css` is split in the same issue.

## 6. Image pipeline

Art is pre-baked at build time. Nothing is optimised at runtime, which avoids
double-compression.

1. **Masters** — lossless PNGs in `assets-src/`, tracked in git but never deployed: five
   character poses at 900×900 and three dioramas at 1000×1000
2. **Optimisation** — `npm run optimize-assets` runs `scripts/optimize-assets.mjs` with
   `sharp`. It builds a 2× Lanczos intermediate per master, then emits a **360 / 560 / 840
   / 1200 / 1600** width ladder (defined in `lib/art-widths.mjs`) as AVIF q60 and WebP q90
   into `public/assets/`
3. **Delivery** — the `Art` component renders a `<picture>` with AVIF and WebP srcsets,
   native loading hints, and explicit dimensions so layout does not shift
4. **`sizes` discipline** — every slot declares its true rendered width, so no image is
   ever upscaled

Landing-page image weight is **189 KB at DPR1 and 494 KB at DPR2**, against 4.66 MB for the
original PNGs. Above-the-fold art loads eagerly; below-the-fold cards stay lazy.

Masters are capped at 900–1000 px, and the 2× intermediate keeps output crisp to 1600
device pixels. Anything higher needs new renders in `assets-src/` and a re-run.

## 7. Quality gates

All four run on every pull request via `.github/workflows/ci.yml`, and should be run
locally before pushing:

```sh
npm run typecheck   # tsc --noEmit, strict
npm run lint        # oxlint, type-aware, 0 errors expected
npm test            # node --test tests/*.test.mjs
npm run build       # next build; all routes must compile
```

`.oxlintrc.json` enables type-aware rules and exempts `typescript/no-floating-promises` for
test files.

## 8. Deployment contract

- **Source** — Vercel deploys from `muhammaduzair11/PoliLingo` on `main` via the Git integration
- **Configuration** — no `vercel.json`, no custom build settings; Next.js is auto-detected
- **Environment** — no environment variables of our own, no server runtime state. A
  production build reads Vercel's `VERCEL_ENV` to refuse a content release that is not tagged
- **Commit identity** — commits must use a GitHub-recognised email, or the deployment can
  be rejected. Use your GitHub no-reply address
- **Caching** — the Vercel CDN serves `public/` with strong caching, so a new asset width
  requires a deploy to become visible

Rollback and incident steps are in [`runbook-deploy.md`](runbook-deploy.md).

## 9. Directory map

```
app/            Routes; globals.css imports the design system from app/styles/ in cascade order
app/styles/     The design system, one partial per screen or concern, imported in order
assets-src/     Lossless PNG masters (tracked, not deployed)
components/     Product UI, lesson player, state provider
components/ui/  shadcn / Base UI primitives
docs/           This folder — as-built notes only
hooks/          use-mobile
lib/            content.ts (the release, read), redirects.ts, progress.ts (state),
                learning-map.ts and words.ts (what the screens work out), art-widths.mjs
content/        release.json — the learner copy of the content release this build was made from
public/assets/  Generated AVIF/WebP ladder (deployed)
scripts/        optimize-assets.mjs
tests/          learning.test.mjs (progress), content-release.test.mjs (the release, redirects),
                screens.test.mjs (the screens' helpers)
```

## 10. What this architecture does not have

Stated plainly, because the gap between this and the target is the whole of Stage 1:

no accounts · no cloud sync · no database · no server-side code · no environment variables
· no native-speaker audio · no speaking practice · no speech recognition · no content
management system · no review workflow · no community contributions · no analytics · no
payments · no leaderboards · no offline support beyond ordinary browser caching

Each of these is a numbered deliverable. See `plan/stage1-plan.md` in the docs
repository.
