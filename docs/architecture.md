# PoliLingo Architecture

How the app is put together: routing, state, content, the image pipeline,
quality gates and the deployment contract. Visual decisions live in
`docs/design.md`; content provenance in `docs/content-notes.md`; asset
generation prompts in `docs/assets-prompts.md`; the verification checklist in
`docs/validation.md`.

## 1. Stack

- **Next.js 16** (App Router, Turbopack build), **React 19**, **TypeScript**
  in strict mode.
- **Tailwind CSS v4** through `@tailwindcss/postcss` (`postcss.config.mjs`);
  theme tokens are bridged from CSS custom properties in `app/globals.css`.
- **shadcn / Base UI** primitives under `components/ui/`. The product screens
  mostly use bespoke classes in `app/globals.css`; the primitives exist for
  dialogs, switches, progress and similar controls.
- **oxlint** (type-aware) and **oxfmt** for lint and format; `node --test`
  for tests. No ESLint, no Jest.
- No database, no server functions, no environment variables. The app is
  fully static-plus-client-state.

## 2. Routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | Static | Marketing landing: hero, language cards, how-it-works, sample lesson teaser |
| `/onboarding/[course]` | Dynamic | Two-step course intro and commitment |
| `/learn/[course]` | Dynamic | Learning map: lesson path, streak, badges |
| `/lesson/[course]/[lesson]` | Dynamic | Study cards plus eight exercises |
| `/settings` | Static | Sound, motion, goal and reset controls |
| `/_not-found` | Static | Fallback |

Course slugs are `pashto`, `hindko`, `urdu` (the `id` field in
`lib/courses.ts`).

## 3. State model

All learner state is client-side, in `localStorage` under
`polilingo.progress.v1`, wrapped by `LearningProvider`
(`components/learning-provider.tsx`). There are no accounts and no sync.

`lib/progress.ts` holds the pure state machine, which is what makes the
model testable:

- `initialState()` / `parseState(raw)` — schema-tolerant hydration; unknown
  or corrupt payloads fall back to defaults.
- `newSession(course, lesson, id)` — a session carries a caller-supplied id
  so a refresh cannot double-award XP.
- `recordAnswer(session, correct)` — queues mistakes for repeat practice;
  repeated checks cannot duplicate an attempt.
- `advanceSession(state, key, date)` — completes lessons, awards 20 XP first
  run and 5 XP on replay, updates the calendar-streak map.
- `unlocked(state, course, lesson)` — sequential unlocking per course,
  independent across courses.
- `streak(activity, now)` / `localDate(date)` — calendar streaks computed in
  the learner's browser-local timezone.

`tests/learning.test.mjs` covers all of the above, including serialization
recovery and idempotent rewards. Keep new state rules as pure functions and
extend that file.

## 4. Content model

`lib/courses.ts` defines `Course`, `Phrase` and the exercise union
(`assemble`, `match`, `select`-style kinds). Each course has three lessons,
each lesson four phrases and eight exercises. Every phrase records a
`source` URL; the corpus is a seeded sample, not a certified curriculum —
see `docs/content-notes.md` before extending it.

## 5. Components

- `components/polilingo.tsx` — the product UI: `Header`, page sections,
  `Native` (script-safe text), `Poli` and `Art` (image delivery),
  `MotionButton`, dialogs.
- `components/lesson-player.tsx` — exercise flow, feedback, completion.
- `components/learning-provider.tsx` — state provider, persistence, and the
  `data-motion` attribute that drives the in-app reduced-motion switch.

## 6. Image pipeline

Art is the heaviest content in the product, so it is pre-baked at build time
and served verbatim. **No runtime image optimizer is in the path** — letting
one re-encode the ladder previously caused a visible quality regression
(double lossy compression) and `next/image`'s srcset produced ~1:1 variants
with no supersampling margin.

1. **Masters** — lossless PNGs in `assets-src/` (tracked in git, never
   deployed): five Poli poses at 900×900 and three world dioramas at
   1000×1000.
2. **`npm run optimize-assets`** (`scripts/optimize-assets.mjs`, sharp):
   - builds a **2× Lanczos intermediate** per master, so every output rung is
     a downsample rather than an upscale;
   - emits a **360 / 560 / 840 / 1200 / 1600** width ladder (the single source
     of truth for rungs is `lib/art-widths.mjs`);
   - encodes each rung as **AVIF (q60)** and **WebP (q90)** into
     `public/assets/<name>-<width>.<ext>`.
3. **Delivery** — the `Art` component renders a `<picture>` with AVIF and
   WebP `<source>` srcsets plus a WebP `<img>` fallback, native
   `loading`/`fetchPriority`/`decoding`, and explicit `width`/`height` for
   layout stability. `picture { display: contents; }` in `app/globals.css`
   keeps existing CSS selectors matching the inner `img`.
4. **`sizes` discipline** — every slot declares its true rendered width
   (hero mascot 560px, language cards 36vw, onboarding world 60vw, map banner
   200px). A shared or understated `sizes` makes the browser upscale a small
   rung, which reads as blur; this has bitten the project twice.

Resulting landing-page image weight: **189 KB at DPR1, 494 KB at DPR2**,
against 4.66 MB for the original PNGs. Above-the-fold art (hero, onboarding
world, map banner) is eager; below-the-fold cards stay lazy.

Masters cap at 900–1000px. The 2× intermediates keep everything up to 1600
device px crisp; slots needing more require new higher-res renders dropped
into `assets-src/` followed by `npm run optimize-assets`.

## 7. Quality gates

Run all four before pushing; CI-less repos live or die by these:

```sh
npm run typecheck   # tsc --noEmit, strict
npm test            # node --test tests/*.test.mjs
npm run lint        # oxlint, type-aware, 0 errors expected
npm run build       # next build; all routes must compile
```

`.oxlintrc.json` enables type-aware rules project-wide and scopes
`typescript/no-floating-promises` off for `tests/**/*.mjs`, where the
`node:test` runner owns the promise that `test()` returns.

## 8. Deployment contract

- Vercel deploys from the GitHub repository `muhammaduzair11/PoliLingo`,
  branch `main`, via the Git integration. Next.js is detected automatically;
  there is no `vercel.json` and no custom build/output configuration. Keep
  `next.config.ts` empty unless a change truly requires it.
- The build needs **no environment variables** and produces no server
  runtime state.
- **Commit identity must be a valid, GitHub-matching email.** A placeholder
  author email once blocked a deployment outright; the repo is configured
  with the account's noreply address
  (`71087478+muhammaduzair11@users.noreply.github.com`).
- Because the app is static-first, Vercel serves `public/` from its CDN with
  strong caching; new asset rungs therefore need a deploy to become visible.

## 9. Directory map

```
app/            Routes and global styles (globals.css holds the design system)
assets-src/     Lossless PNG masters (tracked, not deployed)
components/     Product UI, lesson player, state provider
components/ui/  shadcn / Base UI primitives
docs/           Design, architecture, content, asset and validation notes
hooks/          use-mobile
lib/            courses.ts (content), progress.ts (state), art-widths.mjs
public/assets/  Generated AVIF/WebP ladder (deployed)
scripts/        optimize-assets.mjs
tests/          learning.test.mjs
```
