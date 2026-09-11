# PoliLingo

A playful, responsive language-learning MVP for Pashto, Hazara/Abbottabad Hindko, and Urdu. Built with Next.js, React 19, TypeScript, Tailwind CSS, and customized Shadcn/Base UI primitives.

## Run locally

```sh
npm install
npm run dev
```

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

The homepage leads into two-step onboarding and a three-lesson course for each language. Lessons contain study cards and eight exercises, with repeat practice for mistakes. Progress and in-flight feedback are stored under `polilingo.progress.v1` in localStorage. A completed run earns 20 XP initially and 5 XP on replay. Session IDs prevent double-awarding on refresh. Calendar dates use the learner's browser-local timezone. No app accounts, cloud sync, pronunciation audio, payments, or public leaderboards are implemented.

## Content and assets

`lib/courses.ts` contains typed phrase records, exercise definitions, source links and local usage notes. Every phrase is a seed sample, not a claim of a certified curriculum. Hindko especially needs review by a Hazara/Abbottabad-speaking teacher. See `docs/content-notes.md` before extending or publishing the curriculum broadly.

The character is Poli, a cream markhor with violet spiral horns and an orange satchel. Lossless PNG masters live in `assets-src/`; `npm run optimize-assets` generates an AVIF/WebP width ladder into `public/assets`, which is what the site serves. Render specifications are recorded in `docs/assets-prompts.md`, and the pipeline in `docs/architecture.md`.

## Documentation

- `docs/design.md` — the design system: colour, typography, layout, mascot, motion and accessibility rules.
- `docs/architecture.md` — routing, state model, content model, image pipeline, quality gates and the Vercel deployment contract.
- `docs/content-notes.md` — corpus provenance and review caveats.
- `docs/assets-prompts.md` — generation specifications for the mascot and world renders.
- `docs/validation.md` — the verification checklist.

Decorative animation respects both the OS preference and an app setting. Text remains actual HTML; native-script runs have explicit language and RTL direction. Optional sounds use the Web Audio API after a user gesture. The interface uses Outfit and Noto Naskh Arabic with local fallback fonts.

## Deploy to Vercel

Import the GitHub repository into Vercel. Vercel detects Next.js automatically, runs `npm run build`, and publishes from the `.next` output without custom framework settings.

For a command-line preview deployment:

```sh
npx vercel
```

For a production deployment:

```sh
npx vercel --prod
```
