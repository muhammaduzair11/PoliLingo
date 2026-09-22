# PoliLingo

A playful, responsive language-learning app for Pashto, Hazara/Abbottabad Hindko, and Urdu.
Built with Next.js, React 19, TypeScript, Tailwind CSS, and customised shadcn / Base UI
primitives.

**Live:** <https://poli-lingo.vercel.app>

---

## Run locally

```sh
npm install
npm run dev
```

Quality gates — all four run in CI on every pull request:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Full setup instructions for a bare Windows machine: [`docs/local-setup-windows.md`](docs/local-setup-windows.md)

---

## What it does today

The homepage leads into two-step onboarding and a three-lesson course for each language.
Lessons contain study cards and eight exercises, with repeat practice for mistakes.

Progress and in-flight feedback are stored under `polilingo.progress.v1` in `localStorage`.
A completed run earns 20 XP first time and 5 XP on replay. Session IDs prevent
double-awarding on refresh. Calendar dates use the learner's browser-local timezone.

**Not implemented:** accounts, cloud sync, native-speaker audio, speaking practice,
pronunciation scoring, payments, public leaderboards.

Those are Stage 1 deliverables — see
[`plan/stage1-plan.md`](https://github.com/muhammaduzair11/polilingo-docs/blob/main/plan/stage1-plan.md).

---

## Content and assets

`lib/courses.ts` contains typed phrase records, exercise definitions, source links and
usage notes. **Every phrase is a seed sample, not a certified curriculum.** Hindko in
particular still needs review by a Hazara/Abbottabad-speaking teacher.

> Curriculum is moving out of this repository into
> [muhammaduzair11/polilingo-content](https://github.com/muhammaduzair11/polilingo-content), where it becomes reviewed data
> with stable IDs, provenance and a review workflow — so that language reviewers can
> contribute without touching application code. See
> [`migration-content-to-db.md`](https://github.com/muhammaduzair11/polilingo-docs/blob/main/archive/technical/migration-content-to-db.md).

The character is Poli, a cream markhor with violet spiral horns and an orange satchel.
Lossless PNG masters live in `assets-src/`; `npm run optimize-assets` generates an
AVIF/WebP width ladder into `public/assets/`, which is what the site serves.

---

## Documentation

**In this repository — how the app works today:**

|                                                              |                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [`docs/architecture.md`](docs/architecture.md)               | Routing, state model, content model, image pipeline, quality gates, deployment |
| [`docs/design.md`](docs/design.md)                           | Colour, typography, layout, mascot, motion, accessibility                      |
| [`docs/local-setup-windows.md`](docs/local-setup-windows.md) | Getting a development machine running                                          |
| [`docs/configuration.md`](docs/configuration.md)             | Environment variables and secrets                                              |
| [`docs/testing.md`](docs/testing.md)                         | What we test, and what we deliberately do not                                  |
| [`docs/validation.md`](docs/validation.md)                   | The manual verification pass before a release                                  |
| [`docs/runbook-deploy.md`](docs/runbook-deploy.md)           | Deploying, rolling back, and what to do when it breaks                         |
| [`docs/assets-prompts.md`](docs/assets-prompts.md)           | Generation specifications for the mascot and world renders                     |

**In [muhammaduzair11/polilingo-docs](https://github.com/muhammaduzair11/polilingo-docs) — product, plans and decisions:**
vision, the Stage 1 plan and its twelve deliverables, target architecture, data model, architecture
decision records, how we work, content operations, and the project
journey log.

**In [muhammaduzair11/polilingo-content](https://github.com/muhammaduzair11/polilingo-content) — the curriculum:** phrases,
exercises, audio metadata, reviewer guides, recording handbook, and the provenance notes
that used to live at `docs/content-notes.md`.

---

## Accessibility

Decorative animation respects both the OS preference and an in-app setting. Text is real
HTML, never baked into images. Native-script runs carry explicit `lang` and RTL direction.
Optional sounds use the Web Audio API only after a user gesture. The interface uses Outfit
and Noto Naskh Arabic with local fallback fonts.

---

## Deployment

Vercel deploys from `main` automatically. There is no `vercel.json` and no custom build
configuration — Next.js is auto-detected. Every pull request also gets its own preview
deployment.

See [`docs/runbook-deploy.md`](docs/runbook-deploy.md) for releases and rollback.

---

## Contributing

Most useful contributions are **not code**. To correct a phrase, offer a voice recording,
or review a language as a native speaker, go to
[muhammaduzair11/polilingo-content](https://github.com/muhammaduzair11/polilingo-content/issues/new/choose) — no git
knowledge required.

For code: [`CONTRIBUTING.md`](CONTRIBUTING.md).

Security and privacy concerns:
[report privately](https://github.com/muhammaduzair11/PoliLingo/security/advisories/new), see
[`SECURITY.md`](SECURITY.md).

---

## Licence

**Copyright © 2026 PoliLingo. All rights reserved.**

This repository is public so that the work can be read, referenced and reported on. It is
**not** open source. No licence is granted to use, copy, modify or redistribute this code
or the curriculum content within it.

The curriculum, the recorded voices and the language metadata carry separate terms — see
[`content/LICENSE-CONTENT.md`](https://github.com/muhammaduzair11/polilingo-content/blob/main/LICENSE-CONTENT.md)
and
[`content/CONSENT-POLICY.md`](https://github.com/muhammaduzair11/polilingo-content/blob/main/CONSENT-POLICY.md).
Voice recordings are used under individual speaker releases and are not licensed to third
parties under any circumstances.

If you want to use something here, ask.
