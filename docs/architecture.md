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

| Route                       | Rendering | Purpose                                                           |
| --------------------------- | --------- | ----------------------------------------------------------------- |
| `/`                         | Static    | Landing: hero, language cards, how it works, sample lesson teaser |
| `/onboarding/[course]`      | Dynamic   | Two-step course introduction and commitment                       |
| `/learn/[course]`           | Dynamic   | Learning map: lesson path, streak, badges                         |
| `/lesson/[course]/[lesson]` | Dynamic   | Study cards plus eight exercises                                  |
| `/settings`                 | Static    | Sound, motion, goal, export/import and reset controls             |
| `/_not-found`               | Static    | Fallback                                                          |

Course identifiers are `pashto`, `hindko` and `urdu`, mapped in `lib/courses.ts`.
Hindko is hidden from learners until it has been reviewed: `courses` and `getCourse`
see only Pashto and Urdu, while progress is validated against `allCourses`, so a
learner's stored Hindko progress stays valid. `/learn/hindko`, `/lesson/hindko/*` and
`/onboarding/hindko` redirect temporarily (307) to `/learn` (`next.config.ts`), and
`/learn` shows the language picker to anyone without a course they can see, rather than
choosing one for them.

## 3. State model

All learner progress is in `localStorage` under `polilingo.progress.v2`, managed by
`components/learning-provider.tsx`. There are no accounts and no synchronisation. The
pre-v0.2 key, `polilingo.progress.v1`, is copied verbatim to
`polilingo.progress.v1.bak-<date>` once, before the v2 key is first written, and is never
written again; its reader is never deleted.

The v1 key is still read on every load. Builds before v0.2 write only that key, so whatever
a learner adds there during a rollback, or in a tab left open from before, is merged into
the v2 state with `mergeProgress()` on the next load. The v2 state records a fingerprint of
the v1 blob it last merged (`v1Fingerprint`), so an unchanged v1 blob is not merged again.
A v1 blob this build cannot read is left in place and not recorded, so a later build that
can read it still merges it. A reset keeps the fingerprint, the v1 key and its backups, so
it stays reset unless an older build writes to the v1 key again.

A blob in the v2 key from a newer app version is kept verbatim under
`polilingo.progress.unknown-<version>` before anything replaces it. The learner then sees
their pre-v0.2 progress from the v1 key if there is any, otherwise a fresh start.

The provider writes the v2 key only after hydration succeeds. If storage cannot be read, or
the backup or the unknown-version stash cannot be written, the session runs in memory with
the storage warning showing, and the v2 key is not written until a later load succeeds.

Pure state logic lives in `lib/progress.ts` and contains no React and no browser APIs, so
it can be tested directly:

- **Hydration** — `parseState(raw)` reads a v1 or v2 blob and always returns v2, falling
  back to `initialState()` rather than throwing on corrupt data. `loadProgress()` decides
  the backup, the unknown-version stash and the v1 merge without touching storage.
  `hydrateProgress(storage, today, newId)` runs it against any Storage-like object, makes
  those writes and says whether the session may persist, so every rule is unit-tested with
  a stub storage. Device and lesson-run IDs come from `randomId()` in `lib/random-id.ts`,
  which still works where `crypto.randomUUID` is missing, such as plain http on a LAN
  address
- **Export and import** — `exportProgress()` writes a dated envelope; `importProgress()`
  accepts an envelope or a bare blob of either version and merges it with
  `mergeProgress()`, the ADR-0010 algebra: sets grow, per-day counts take the maximum,
  ledgers append, XP takes the maximum, preferences stay the learner's own. For each lesson
  a finished run beats an unfinished one, a local unfinished run that has already been
  rewarded gives way to the other side's newer run, and otherwise the local run stays.
  Importing the same file twice changes nothing
- **Reset** — `resetProgress(state)` is a clean state that keeps the device ID and the v1
  fingerprint
- **Sessions** — `newSession(course, lesson, id)` takes a caller-supplied ID, which is what
  prevents a refresh from awarding XP twice
- **Recording** — `recordAnswer(session, correct)` queues mistakes and ignores duplicate
  attempts
- **Advancement** — `advanceSession(state, key, date)` completes a lesson, awards XP (20 on
  first completion, 5 on replay) and updates the activity record
- **Unlocking** — `unlocked(state, course, lesson)` enforces sequential progression
- **Streaks** — `streak(activity, now)` and `localDate(date)` compute calendar streaks in
  the learner's browser-local timezone

`tests/learning.test.mjs` covers serialisation recovery and idempotent rewards, and tests
the migration against a v1 blob written by the MVP's own code (`tests/fixtures/`). New
state rules belong in this file as pure functions, with a test.

> This module is the highest-consequence code in the repository. A rendering bug is
> visible and fixable; a wrongly reset streak is gone. It is flagged in `CODEOWNERS` for
> that reason.

## 4. Content model

`lib/courses.ts` defines the `Course` and `Phrase` types and the exercise union
(`assemble`, `match`, `select`). Each course has three lessons; each lesson has four
phrases and eight exercises — **36 phrases and 72 exercises in total**.

Every phrase carries a `source` URL and a `note`. This is a seeded sample, not a certified
curriculum; see `provenance.md` in the content repository for what each source is and what
it does and does not establish.

> **This file is scheduled to be replaced.** During v0.2, curriculum moves out of the
> codebase into the `content` repository as reviewed data with stable IDs. See
> `archive/technical/migration-content-to-db.md` in the docs repository. Until then, changes here
> are content changes in a TypeScript costume and deserve the same scrutiny.

## 5. Components

- **`components/home.tsx`**, **`onboarding.tsx`**, **`dashboard.tsx`**, **`settings.tsx`** —
  one module per screen
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
- **Environment** — no environment variables, no server runtime state
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
lib/            courses.ts (content), progress.ts (state), art-widths.mjs
public/assets/  Generated AVIF/WebP ladder (deployed)
scripts/        optimize-assets.mjs
tests/          learning.test.mjs
```

## 10. What this architecture does not have

Stated plainly, because the gap between this and the target is the whole of Stage 1:

no accounts · no cloud sync · no database · no server-side code · no environment variables
· no native-speaker audio · no speaking practice · no speech recognition · no content
management system · no review workflow · no community contributions · no analytics · no
payments · no leaderboards · no offline support beyond ordinary browser caching

Each of these is a numbered deliverable. See `plan/stage1-plan.md` in the docs
repository.
