# PoliLingo

A playful, responsive language-learning app for Pakistan's languages: the languages in the
current content release, Pashto and Urdu today.
Built with Next.js, React 19, TypeScript, Tailwind CSS, and customised shadcn / Base UI
primitives.

**Live:** <https://poli-lingo.vercel.app>

---

## Run locally

```sh
npm install
npm run dev
```

That is enough for the learner app: with no Supabase settings it runs exactly as it always
has, sign-in is hidden, and the workspace says it is not configured. For accounts and the
workspace, add Docker Desktop and the local Supabase stack (the CLI is a dev dependency):

```sh
npm run db:start                 # first start downloads the images
npx supabase status -o env       # the local URL and publishable key
cp .env.example .env.local       # PowerShell: Copy-Item .env.example .env.local
                                 # then fill in the two NEXT_PUBLIC_SUPABASE_* values
npm run dev
```

Sign in at `/sign-in` as one of the local test accounts, such as `admin@polilingo.test`,
with "Email me a code", then `npm run otp -- admin@polilingo.test` prints the code. The
accounts, the database tests (`npm run test:db`) and the rest of the local stack are in
[`docs/testing.md`](docs/testing.md).

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

The homepage leads into two-step onboarding and a course for each language in the
content release. Lessons contain study cards and exercises, with repeat practice for
mistakes. Every count on the screens (languages, lessons, the learning map and its badges)
comes from the release, so a release with more or fewer lessons needs no code change.

Progress and in-flight feedback are stored under `polilingo.progress.v3` in `localStorage`.
The first load after v0.2 copies any older `polilingo.progress.v1` blob verbatim to
`polilingo.progress.v1.bak-<date>` before migrating it. Neither that key nor v0.2's own,
`polilingo.progress.v2`, is ever written again, so a rollback finds its key as it left it.
If that copy cannot be made, the learner keeps going in memory and nothing is saved that
session. Anything an older build later writes to either old key, during a rollback or in a
tab left open from before, is merged in on the next load.
Settings can export progress to a JSON file and import one back. An import combines
completed lessons and streak days with what is already there; XP shows the higher of the
two totals.
A completed run earns 20 XP first time and 5 XP on replay. Session IDs prevent
double-awarding on refresh. Calendar dates use the learner's browser-local timezone.

### What's in the app

- **Optional accounts.** Learning never needs an account. A learner who wants to keep their
  progress safe signs in with Google or a 6-digit email code, after an age question (under
  13s keep learning without one). Their lessons, XP and streak then save to the account and
  come back on any device. Nothing on the device is ever deleted by signing in, out or
  deleting the account.
- **The workspace** at `/review`, `/edit` and `/admin`, for invited team members only.
  Reviewers approve phrases and lessons for their own language and variety; editors write
  and arrange lessons and generate exercises; admins invite people, see the overview, and
  publish. The review rules (no self-approval, variety scope, an edit voids approval) are
  enforced in the database.
- **In-app publishing.** An admin previews what will change and presses Publish. The
  database builds the new learner copy, and learners with the app open get it within about
  a minute, without a deploy. An earlier release can be brought back the same way.

Learner pages stay static: an anonymous visitor never loads Supabase code and creates no
server data. The database is one Supabase project; the app holds no secret key.

**Not implemented:** native-speaker audio, speaking practice, pronunciation scoring,
payments, public leaderboards.

Those are Stage 1 deliverables — see
[`plan/stage1-plan.md`](https://github.com/muhammaduzair11/polilingo-docs/blob/main/plan/stage1-plan.md).

---

## Content and assets

The curriculum lives in the database, with permanent IDs, provenance and review history, and
is written, reviewed and published in the workspace. It was seeded once from
[muhammaduzair11/polilingo-content](https://github.com/muhammaduzair11/polilingo-content)
(release `content@2026.09.1`), which now keeps a nightly snapshot. Each release is a
**learner copy**: only the lessons whose publish gate is open all the way down, and only the
fields a learner sees.

`content/release.json` is the **baseline** learner copy, the seed release, which every build
ships with; a newer published release replaces it in the learner's browser.
`lib/content.ts` is the only module that imports it, and presents the `Course`, `Lesson`,
`Phrase` and `Exercise` shapes the screens use. Nothing about the curriculum is written in
this repository.

**`content/release.json` is generated. Never edit it by hand.** It records its release, the
content commit and a content hash. `npm test` recomputes the hash, so a hand edit fails CI.
A production build refuses a file that is not a tagged release: a development build of
content, named `content@YYYY.MM.dev+<sha>`, can reach preview deployments but never
production. Settings shows which release the learner is using.

**The current phrases are demo data:** the MVP's seed phrases, live for testing until
reviewed content replaces them. "Demo" is an internal word. The app never says it, and never
tells learners anything about review state. Settings credits each language's sources, from
the citations in the release.

Hindko is not in the learner copy until a Hazara/Abbottabad-speaking reviewer has checked
it, so the app does not show it, with no message. Its old URLs redirect temporarily to
`/learn`. A returning Hindko learner sees the language picker rather than a missing page or
another language, and their stored choice and progress are kept. The MVP's Pashto and Urdu
lesson URLs (`/lesson/pashto/greetings`) redirect permanently to the lesson's permanent id.

The character is Poli, a cream markhor with violet spiral horns and an orange satchel.
Lossless PNG masters live in `assets-src/`; `npm run optimize-assets` generates an
AVIF/WebP width ladder into `public/assets/`, which is what the site serves.

---

## Documentation

**In this repository — how the app works today:**

|                                                              |                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md)               | Routes, state, content, live content, accounts, the workspace, the database     |
| [`docs/platform.md`](docs/platform.md)                       | The platform's build contract: tables, functions, refusal codes, screens        |
| [`docs/design.md`](docs/design.md)                           | Colour, typography, layout, mascot, motion, accessibility                       |
| [`docs/local-setup-windows.md`](docs/local-setup-windows.md) | Getting a development machine running                                           |
| [`docs/configuration.md`](docs/configuration.md)             | Environment variables, secrets, and where each platform setting lives           |
| [`docs/testing.md`](docs/testing.md)                         | What we test, the local Supabase stack and its test accounts                    |
| [`docs/validation.md`](docs/validation.md)                   | The manual verification pass before a release                                   |
| [`docs/runbook-deploy.md`](docs/runbook-deploy.md)           | Deploying the app and the database, rolling back, and what to do when it breaks |
| [`docs/assets-prompts.md`](docs/assets-prompts.md)           | Generation specifications for the mascot and world renders                      |

**In [muhammaduzair11/polilingo-docs](https://github.com/muhammaduzair11/polilingo-docs) — product, plans and decisions:**
vision, the Stage 1 plan and its twelve deliverables, target architecture, data model, architecture
decision records, how we work, content operations, and the project
journey log.

**In [muhammaduzair11/polilingo-content](https://github.com/muhammaduzair11/polilingo-content) — the curriculum's origin:**
the corpus the database was seeded from and its nightly snapshot, audio metadata, reviewer
guides, recording handbook, and the provenance notes that used to live at
`docs/content-notes.md`.

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
deployment. Database migrations are applied separately, by hand, with the Supabase CLI.

See [`docs/runbook-deploy.md`](docs/runbook-deploy.md) for the first Supabase deploy, releases,
kill switches and rollback.

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
**not** open source. There is no licence file, and `package.json` says
`"license": "UNLICENSED"` (ADR-0022). No licence is granted to use, copy, modify or
redistribute the code, or the curriculum content in `content/release.json`.

The curriculum is proprietary. Recorded voices are used under individual speaker releases
and are not licensed to third parties under any circumstances.

If you want to use something here, ask.
