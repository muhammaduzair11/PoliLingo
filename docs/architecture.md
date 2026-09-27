# PoliLingo architecture — as built

> **Scope.** This document describes **what is deployed today**, and nothing else. If a
> sentence here is not true of the current `main` branch, it is a bug in this document.
>
> The detailed build contract for the platform — every table, function, refusal code and
> screen — is [`platform.md`](platform.md). The _target_ architecture (native audio on
> Cloudflare R2, practice analytics, community contributions) lives in
> `technical/architecture-target.md` in the
> [docs repository](https://github.com/muhammaduzair11/polilingo-docs), together with the
> ordered path from here to there.
>
> Keeping the two apart is deliberate. A document that mixes what exists with what is
> planned stops being usable for either purpose within a month.

## Overview

PoliLingo is a language-learning web app with two halves that share one codebase.

- **Learner pages** are client-first: static pages, the curriculum shipped with the build,
  progress in the browser. An anonymous learner creates no server data and never downloads
  Supabase code. Signing in is optional; it adds progress sync and nothing else.
- **The workspace** (`/review`, `/edit`, `/admin`) is where invited reviewers, editors and
  admins write, review and publish the curriculum. It is server-rendered per person and
  backed by one Supabase project, `polilingo` (Postgres and Auth, Singapore).

Supabase is authoritative for the curriculum. An admin publishes a release in the app; the
database builds the learner copy; learners' browsers fetch it at run time. The committed
`content/release.json` is the baseline every build ships with.

The app holds no secret. Its only credentials are the project URL and the publishable key,
both public by design; every privileged action is a database function that checks who is
calling, and every table has Row Level Security.

## 1. Stack

- **Next.js 16** with App Router and Turbopack, **React 19**, **TypeScript** in strict mode
- **Tailwind CSS v4** via `@tailwindcss/postcss`, with theme tokens bridged through CSS
  custom properties in `app/styles/tokens.css`
- **shadcn / Base UI** primitives in `components/ui/`
- **Supabase**: Postgres 17 and Auth, reached through `@supabase/ssr` and
  `@supabase/supabase-js`; the Supabase CLI and Docker for the local stack; `pg` for the
  database tests
- **oxlint** (type-aware, through `oxlint-tsgolint`) and **oxfmt**, replacing ESLint and
  Prettier
- **`node --test`** for testing, rather than Jest or Vitest
- Node `>= 22.13.0`, `"type": "module"`

## 2. Routes

| Route                                                          | Rendering     | Purpose                                                                  |
| -------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `/`                                                            | Static        | Landing: hero, language cards, how it works, a try-it question           |
| `/onboarding/[course]`                                         | Dynamic       | Two-step course introduction and commitment                              |
| `/learn`                                                       | Static        | The remembered course, or the language picker when there is none         |
| `/learn/[course]`                                              | Dynamic       | Learning map: lesson path, streak, badges                                |
| `/lesson/[course]/[lesson]`                                    | Dynamic       | Study cards plus the lesson's exercises                                  |
| `/settings`                                                    | Static        | Sound, motion, goal, export/import, reset, the account row               |
| `/privacy`, `/terms`                                           | Static        | Drafts, bannered "pending legal review"                                  |
| `/sign-in`                                                     | Dynamic       | Age gate, then Google or a 6-digit email code                            |
| `/sign-in/confirm`                                             | Dynamic       | "Finish signing in" for someone who taps the email's button              |
| `/auth/callback`                                               | Route handler | Google returns here; the session is saved and the age band recorded      |
| `/auth/confirm`                                                | Route handler | The email's button: GET only redirects; a same-origin POST signs in      |
| `/api/release`                                                 | Route handler | The latest published learner copy, for browsers (section 5)              |
| `/account` \*                                                  | Dynamic       | Age band, roles, sync status, download my data, delete account, sign out |
| `/invite/[token]` \*                                           | Dynamic       | Accept an invitation to the team                                         |
| `/review` \*, `/review/item/[id]` \*, `/review/lesson/[id]` \* | Dynamic       | The review queue for the reviewer's varieties; one phrase; one lesson    |
| `/edit` \*, `/edit/lesson/[id]` \*                             | Dynamic       | The course maker: the course tree; one lesson's phrases and exercises    |
| `/admin` \*                                                    | Dynamic       | Overview: the pipeline per language, reviewers, accounts, latest release |
| `/admin/people` \*                                             | Dynamic       | People, roles and invitations                                            |
| `/admin/suggestions` \*                                        | Dynamic       | Reviewers' suggested fixes, to accept or decline                         |
| `/admin/publish` \*                                            | Dynamic       | Preview, publish, countersign, release history and going back            |
| `/_not-found`                                                  | Static        | Fallback                                                                 |

\* Behind `proxy.ts` (section 7). Every workspace page is `force-dynamic`: per person, never
cached. The learner routes render exactly as they did before the platform.

Course segments are the slugs `pashto` and `urdu`; lesson segments are permanent lesson ids
such as `ps-lsn-0a41c2`, which never change when a lesson is reordered. Both are resolved by
`lib/content.ts`. A course segment the active release does not hold, other than a
redirected one below, is the not-found view. A lesson segment the active release does not
hold, in a course it shows, is a lesson that has left the release, or an old bookmark or
remembered redirect to one: `/lesson/<course>/<lesson>` then replaces itself with that
course's map (`missingLessonRedirect()`), rather than showing "not found" for a lesson the
learner may have completed. It decides only once the provider is ready, because a lesson
that exists only in a published release (section 5) becomes known after mount.

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

`next.config.ts` serves redirects that `lib/redirects.ts` works out from the baseline
content release, so nobody keeps a list by hand:

- **A language the release does not hold** (Hindko, until it is reviewed): one pattern,
  `/:section(learn|lesson|onboarding)/hindko/:rest*`, to `/learn`. Temporary (307), never
  permanent, so browsers do not remember it; the day Hindko is in a release, the redirect is
  no longer generated and its links work again. No lesson id is named.
- **The MVP's lesson URLs**, such as `/lesson/pashto/greetings`, to the permanent id,
  `/lesson/pashto/ps-lsn-0a41c2`, one per keymap row in the release. Permanent (308): the
  old address will never mean anything else.

Redirects are fixed at build time, so they come from the baseline, not from a published
release.

## 3. State model

All learner progress is in `localStorage` under `polilingo.progress.v3`, managed by
`components/learning-provider.tsx`. It is the learner's own copy whether or not they sign
in; a signed-in device also keeps it in step with their account (section 6). Each storage
version has its own key, and v3 is the only one this build writes:

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
another tab is treated, and is left to a follow-up. For a signed-in learner the account
holds whatever either tab synced, and brings it back on the next sync.

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
  every unfinished MVP run for the same reason, and so does switching to a newly published
  release (`fitSessions()`).
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
  The device's account fields (`userId`, `lastSyncedAt`, `importedIntoAccounts`) always stay
  its own: a file cannot make a device claim account merges it did not make.
  Importing the same file twice changes nothing. A file that does not import says why: it
  is not a progress file, it comes from a newer version of the app, or it cannot be read
- **Reset** — `resetProgress(state)` is a clean state that keeps the device ID and both
  fingerprints. For a signed-in learner it clears this device only: the account keeps its
  copy, and the next sync brings it back
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

The curriculum lives in the database (section 8) and is written in the workspace. What
learners see is a **learner copy** (format `polilingo.learner@1`): only lessons whose
publish gate is open all the way down (language, course, unit, lesson and their varieties),
and only learner-facing fields (text, romanisation, meaning, context, usage note, citation,
exercises, order, the variety's learner label, and the MVP keymap rows for what it holds).
A language with nothing open, such as Hindko until it is reviewed, has no entry, no ids and
no keymap rows. So nothing is hidden at run time: there is no content channel, and no
setting can show more than the copy holds.

`content/release.json` is the **baseline** learner copy, `content@2026.09.1`, the release
the database was seeded with from the content repository. Every build ships it; the server
renders it; the redirects come from it. It is **never edited by hand**. It records its
release, the content commit and a content hash. A newer release published in the app
replaces it in the browser (section 5), and Settings names the release in use.

`lib/content.ts` is the only module that imports the file. It checks the file's `format`
and `schemaVersion` and throws otherwise, which fails the build and the tests, and presents
the `Course`, `Lesson`, `Phrase` and `Exercise` types the screens use, so no screen knows
where content comes from. `learnerCopy`, `contentVersion`, `courses` and `legacyLessonIds`
are live bindings: `activateRelease(copy)` switches them to a published copy and
`resetToBaseline()` switches back, and `getCourse()`, `lessonSize()`, `knownLesson()` and
`selectedCourse()` read whichever copy is active. Only browser effects call them, so the
first render in the browser always matches the server's. What it adds on the way:

- **Permanent ids.** Lessons are `ps-lsn-0a41c2`, items `ps-itm-7f3a91`. They are the keys
  in stored progress, the lesson segment in URLs, and what audio and mastery will reference.
- **Only what the release holds.** `courses`, `knownLesson()` and `lessonSize()` know the
  active learner copy's lessons and no others. Stored progress on any other lesson, retired
  or in a language not shown, is kept all the same (section 3).
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
citation, not always a URL; the rest of its provenance stays in the database. Settings
credits each language's sources from those citations (`phraseSources()`): the distinct
citations of its phrases, where one that only adds a note to another (such as
"<source>; the name Sara inserted into a sourced template") is covered by it. Each
phrase's full citation is shown with its lesson hint.

**The screens take every count from the release.** How many languages the landing page
announces, how many lessons a course card and onboarding promise, and the learning map's
counts, "all done" check, badges, stops and path are all worked out from the courses and
lessons the release holds (`lib/learning-map.ts`, `lib/words.ts`), never written into the
copy. The map was drawn for three lessons and draws exactly that for three; it fits one,
eight or any other number. The site's meta description names the baseline's languages.

**Learners never see the state of the content.** The phrases in the baseline are demo
data (the MVP's seed phrases, live until reviewed content replaces them); "demo" is an
internal word. The rule for screen copy: never say demo, sample, reviewed, unreviewed or
pending review, or anything else about review state, and let a language the release does
not hold simply be absent, with no "coming soon". No test enforces it; the release pass in
[`validation.md`](validation.md) checks it.

Checks keep the baseline honest. `tests/content-release.test.mjs` recomputes the content
hash exactly as the content build does, so a hand edit fails CI, and checks the file holds
only the learner copy's fields, no Hindko, and the invariants the app relies on (never
today's counts). And `next.config.ts` refuses a production build (`VERCEL_ENV=production`)
when the file's release is not a tag, `content@YYYY.MM.N`: a development build of content,
`content@YYYY.MM.dev+<sha>`, can reach previews but never production.

## 5. Live content

How a release published in the workspace reaches a learner who already has the app open:

1. **Publish.** `/admin/publish` shows `preview_release()`: the learner copy the database
   would build now and how it differs from the latest release. **Publish** calls
   `publish_release(expected_hash)`, which refuses if anything changed since the preview,
   builds the copy in SQL (`private.build_learner_copy`, field for field the content
   repository's `learnerCopy()`), verifies it, and appends it to `content.releases` as
   `content@YYYY.MM.N`. The server action then calls `updateTag('learner-release')` and reads
   the release back to recompute its hash. **Go back** in the release history
   (`rollback_release`) appends a new release carrying an earlier one's copy; history is never
   rewritten.
2. **Serve.** `GET /api/release?known=<contentHash>` fetches
   `public.get_learner_release()` through Supabase's REST API with the publishable key: the
   one function `anon` may execute. The answer is kept in the Next data cache under the tag
   `learner-release` and refreshed every 60 seconds, so every learner's poll is answered from
   the cache. It returns `{ release, contentHash, payload }` when the browser has something
   else, `{ unchanged: true }` when it is up to date or the route could not ask, and
   `{ reset: true }` when the function answered null (the `overlay_enabled` kill switch is
   off): always status 200, `Cache-Control: no-store`.
3. **Fetch and verify.** `components/release-refresher.tsx`, mounted by the provider, asks
   once the app is ready, when the tab becomes visible, when the browser comes back online,
   and every minute while the tab is visible. `lib/release-verify.ts` checks a payload
   before anything uses it: format and schema version, the content hash recomputed with
   `lib/canonical-json.ts` and `lib/sha256.ts`, unique ids, and every exercise inside its
   lesson. A copy that fails is ignored, and the learner keeps what they have.
4. **Show.** A verified newer copy is stored under `polilingo.content.release`, tied to the
   Supabase project URL it came from (`lib/release-cache.ts`), and activated through the
   provider's `refreshContent()`, which re-renders every screen and drops only unfinished
   runs the new copy cannot continue. Never in the middle of a lesson: on `/lesson/…` it
   waits until the learner leaves. `{ reset: true }`, or a release not newer than the
   baseline, forgets the stored copy and goes back to the baseline.
5. **Next visit.** The provider activates the stored copy, if it verifies and is newer than
   the baseline, before it hydrates progress.

So a publish reaches open apps within about a minute, and nothing about it needs a deploy.

## 6. Accounts and sync

Signing in is optional and only saves progress. The age gate comes first: `/sign-in` asks
for birth year and month (`lib/age-gate.ts`); under 13 is told to keep learning without an
account, and nothing is created. Otherwise the band goes in a 30-minute cookie and the page
offers **Continue with Google** or **Email me a code** (6 digits). There are no passwords.
In the WhatsApp, Instagram and Facebook in-app browsers it suggests opening the page in the
phone's browser and offers the email code instead of Google.

- **Google** returns to `/auth/callback`, which exchanges the code for a session.
- **The email code** is typed on `/sign-in`. The email also has a button, which goes to
  `/auth/confirm`; its GET never uses the token, because mail scanners open every link.
  It redirects to `/sign-in/confirm`, whose **Finish signing in** button POSTs back, and only
  a same-origin POST verifies the token.
- Both finish in `app/auth/finish.ts`: the declared band becomes the profile
  (`ensure_profile`), and the person goes on to where they were (`lib/safe-next.ts` allows
  only same-origin paths). A sign-in with no profile is asked the question on `/account`;
  one that never answers is deleted by a daily `pg_cron` job after 24 hours.

Sessions are cookies set by `@supabase/ssr`. `/account` shows the email and age band, roles,
sync status, **Download my data** (`export_my_data` as a JSON file), **Delete my account**
and **Sign out**. Deleting removes the account and everything it synced; signing out and
deleting both leave the device's own progress where it is. **Local progress is never cleared
by anything account-related.**

**Sync** (`lib/sync.ts`, `components/account/sync-agent.tsx`) runs only for a signed-in
learner: after sign-in, whenever a lesson is rewarded, on focus (at most every 15 seconds)
and when the browser comes back online, one request at a time, with backoff after a
failure. The device sends its v3 state as a `polilingo.sync@1` envelope to
`import_local_progress`, which merges it into the account in a way that only grows
(completions union, keeping the earliest release; each day's activity takes the maximum;
XP awards are inserted if absent) and answers with the account's whole state, which the
device merges back with `mergeProgress()`. The server never takes an XP amount from a
device: it writes 15 per completed lesson and 5 per rewarded session, which is exactly the
20-then-5 rule, and reports the greater of that ledger and the highest XP any device
reported. XP never goes down.

A device that last synced to a different account, and holds progress, asks first: "Add this
device's progress to <email>?" **Not now** pauses sync in that tab and touches nothing.
Status ("Saved", "Saving…", "Offline", "Saving paused" and so on) shows as a dot on the
header chip and on `/account`.

## 7. The workspace

Roles are `admin`, `editor` (for one language or all) and `language_reviewer` (for one
language **and variety**). Nobody signs up for a role: an admin invites a person by email
from `/admin/people`, which makes a one-time link (copy it, or share it on WhatsApp); the
person signs in with that address and accepts on `/invite/[token]`. Only 18+ accounts hold
roles. The first admin is created once from the SQL editor (runbook).

- **Review.** A reviewer sees a queue for their varieties, previews each phrase as a learner
  would, and approves (ticking what they checked), requests changes, rejects, suggests a fix
  or comments. Editors and admins accept or decline suggestions.
- **Edit.** Editors build courses in `/edit`: units, lessons, phrases with live script
  checks, and exercises (**Generate exercises** makes a deterministic set, six or more from
  three phrases), then submit a lesson for review.
- **Admin.** The overview, people and invitations, and publishing.

The rules live in the database, not the pages: review authority is scoped to a variety; a
reviewer cannot approve text they wrote unless they are the variety's only reviewer, and
then an admin must countersign before it can publish; editing learner-visible text voids
its approval; review history is append-only; an admin cannot also be a reviewer; demo items
are never approved; Hindko is never shown to learners until it is reviewed. Every team
action is recorded in `public.audit_events`.

`proxy.ts` runs only on `/account`, `/review`, `/admin`, `/edit` and `/invite` (a literal
matcher). It refreshes the session and sends someone who is not signed in to
`/sign-in?next=…`. `app/(console)/layout.tsx` then loads `my_context()`, asks the age
question if there is no profile, and draws the shell (`components/console/`) with the
sections the person's roles allow. Pages check roles with `requireRole()`
(`lib/console/access.ts`), which returns `{ ok: true, context }` or `{ ok: false, view }`.
That check is cosmetic: the database decides. Without the Supabase variables the workspace
says it is not configured.

## 8. Database

One Supabase project, `polilingo`, Postgres 17, in Singapore; locally the Supabase CLI
stack. Migrations are in `supabase/migrations/` and are applied by hand with
`npx supabase db push` ([`runbook-deploy.md`](runbook-deploy.md)); the seeds in
`supabase/seeds/` are for the local stack only.

**Three schemas.**

- `public` — people and progress tables (profiles, contributors, role grants, invitations,
  progress, XP awards, the audit log) and every function the app calls. It is the only schema
  the API exposes. Its tables carry no grants to `anon` or `authenticated` at all: they are
  reached only through functions.
- `content` — the curriculum, review decisions, suggestions, comments, revisions, releases
  and the ID registry. Not exposed. Signed-in users may `SELECT` its tables, filtered by Row
  Level Security to the varieties they may read, so page functions that run as the caller see
  only what the caller may see.
- `private` — helpers, triggers, the learner-copy builder, the kill switches
  (`private.app_settings`) and seed bookkeeping. Not exposed, no grants beyond the helpers
  the policies and page functions call.

**The RLS invariant.** Row Level Security is on for every table. Writes have no policies:
only `SECURITY DEFINER` functions write, each checking `auth.uid()`, the profile, the role
and its scope first. `anon` can execute exactly one function, `get_learner_release`, which
returns the published learner copy. `tests/db/invariants.test.mjs` proves all of this, and
that one learner cannot read another, on every pull request.

**One read, then server actions.** Beside the layout's `my_context()`, each workspace page
makes one read: a server component calls one `page_<screen>()` function through `callRpc()`
(`lib/rpc.ts`). Every write is a
Server Action in an `actions.ts` beside the page, calling one database function and
returning `ActionResult` (`{ ok: true, data }` or `{ ok: false, code, message }`), then
revalidating the page. `/account` and `/invite` work the same way. From the browser, only the
sign-in page (saving the age band after an email code) and the sync agent call the
database, as the signed-in person.

**Errors.** A function refuses with a code and a sentence, `PL403_OUTSIDE_VARIETY: …`. The
catalogue is `supabase/error-codes.json`; `lib/db-errors.ts` maps each code to plain
English, and maps duplicates, missing access, an ended session and network failures to
their own sentences. An unknown error shows "Something went wrong. Nothing was changed.",
never raw database text; the code is shown in small print for support.

**Kill switches.** `sync_enabled` pauses saving progress to accounts; `overlay_enabled` sends
every learner back to the baseline content. Both are rows in `private.app_settings`, set in
the SQL editor; the runbook says what each does.

## 9. How learner pages stay static

An anonymous visitor gets the same static pages as before the platform, and never downloads
Supabase code:

- No learner file imports `@supabase/*`, `lib/supabase/*`, `lib/rpc.ts` or the console.
  `tests/boundaries.test.mjs` fails `npm test` if one does.
- `components/account-boot.tsx` looks for a Supabase session cookie after mount. With none,
  the learner is anonymous and nothing more loads. With one, it loads the account runtime
  (`components/account/runtime.tsx`, which brings supabase-js and the sync agent) through a
  dynamic `import()`, so it is a separate chunk.
- The header chip, the finish screen's "Save your streak — sign in" and Settings' account
  row need only to know whether sign-in exists, which they read from the two public
  variables directly.
- `proxy.ts` never runs on learner routes, `/sign-in` or `/auth/*`.
- Live content is a plain `fetch` to `/api/release`, and the server always renders the
  baseline, so the static HTML is the same for everyone.

## 10. Components

- **`components/home.tsx`**, **`onboarding.tsx`**, **`dashboard.tsx`**, **`settings.tsx`** —
  one module per screen. What they decide lives in `lib/` as pure functions with tests
  (ADR-0013): `selectedCourse()` and `phraseSources()` in `lib/content.ts`, the learning
  map's progress, stops and path in `lib/learning-map.ts`, and count wording in
  `lib/words.ts`
- **`components/site-chrome.tsx`** — `Brand`, `Header` (with the account chip), `Footer`,
  `MotionButton`
- **`components/native.tsx`** — `Native`, script-safe text with correct `lang` and `dir`,
  and `NativeText` for the workspace
- **`components/art.tsx`** — `Art` and `Poli`, image delivery from the pre-baked ladder
- **`components/status-views.tsx`** — `Loading`, `NotFoundView`
- **`components/lesson-player.tsx`** — exercise flow, feedback, completion
- **`components/learning-provider.tsx`** — state provider, persistence, the active content
  release, and the `data-motion` attribute that drives reduced-motion behaviour
- **`components/release-refresher.tsx`** — live content (section 5)
- **`components/account-boot.tsx`** and **`components/account/`** — sign-in, the account
  page, the header chip, the sync agent and the account-switch question
- **`components/console/`** — the workspace kit (shell, navigation, page header, data table,
  status badge, confirm dialog, script-checked fields, a learner-style preview), with each
  area's screens in `admin/`, `review/`, `editor/` and `publish/`

> The product UI used to be one 41 KB `components/polilingo.tsx`, which every feature
> touched. It was split into the modules above (#12) so that two developers can work in
> parallel without meeting in one file; `app/globals.css` is split in the same issue.

## 11. Image pipeline

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

## 12. Quality gates

All four run on every pull request via `.github/workflows/ci.yml`, and should be run
locally before pushing:

```sh
npm run typecheck   # tsc --noEmit, strict
npm run lint        # oxlint, type-aware, 0 errors expected
npm test            # node --test tests/*.test.mjs
npm run build       # next build; all routes must compile
```

The database tests (`tests/db/`) run in `.github/workflows/db.yml` on a fresh local stack,
and locally with `npm run test:db` ([`testing.md`](testing.md)).

`.oxlintrc.json` enables type-aware rules and exempts `typescript/no-floating-promises` for
test files.

## 13. Deployment contract

- **Source** — Vercel deploys from `muhammaduzair11/PoliLingo` on `main` via the Git integration
- **Configuration** — no `vercel.json`, no custom build settings; Next.js is auto-detected.
  Functions run in Singapore (`sin1`), next to the database, a project setting in Vercel
- **Environment** — `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  both public, for Production and the `platform` branch's preview only
  ([`configuration.md`](configuration.md)). No secret. A production build also reads
  Vercel's `VERCEL_ENV` to refuse a content release that is not tagged
- **Database** — migrations are pushed by hand with the Supabase CLI; Auth settings live in
  the Supabase dashboard ([`runbook-deploy.md`](runbook-deploy.md))
- **Commit identity** — commits must use a GitHub-recognised email, or the deployment can
  be rejected. Use your GitHub no-reply address
- **Caching** — the Vercel CDN serves `public/` with strong caching, so a new asset width
  requires a deploy to become visible. The learner release is cached in the Next data cache
  under `learner-release` for up to a minute

Rollback and incident steps are in [`runbook-deploy.md`](runbook-deploy.md).

## 14. Directory map

```
app/              Learner routes, sign-in and auth routes, /account, /invite, /api/release,
                  /privacy and /terms
app/(console)/    The workspace: /review, /edit, /admin; its layout loads the person's roles
app/styles/       The design system, one partial per screen or concern, imported in order
assets-src/       Lossless PNG masters (tracked, not deployed)
components/       Product UI, lesson player, state provider, release refresher, account boot
components/account/  Sign-in, the account page and chip, the sync agent
components/console/  The workspace kit, and each area's screens
components/ui/    shadcn / Base UI primitives
content/          release.json — the baseline learner copy every build ships with
docs/             This folder — as-built notes, and platform.md, the build contract
hooks/            use-mobile
lib/              content.ts (the active learner copy), progress.ts (state), sync.ts,
                  release-verify.ts and release-cache.ts (live content), db-errors.ts,
                  rpc.ts, redirects.ts, learning-map.ts and words.ts, the sign-in helpers
lib/console/      The workspace's access checks, route paths and pure screen logic
lib/supabase/     The browser, server and proxy clients, and env.ts
proxy.ts          Session refresh and sign-in redirect for the workspace routes
public/assets/    Generated AVIF/WebP ladder (deployed)
scripts/          optimize-assets.mjs; with-db-lock, local-otp and local-real-content for the
                  local stack
supabase/         config.toml (local stack), migrations/, seed.sql and seeds/ (local only),
                  templates/ (the sign-in email), error-codes.json
tests/            Unit tests (npm test); tests/db/ database tests (npm run test:db)
```

## 15. What this architecture does not have

Stated plainly, because the gap between this and the target is the rest of Stage 1:

no native-speaker audio · no speaking practice · no speech recognition · no practice
analytics · no public or community contributions (the team is invited) · no passwords · no
payments · no leaderboards · no offline support beyond ordinary browser caching · no
staging or demo database

Each of these is a numbered deliverable or a recorded decision. See `plan/stage1-plan.md` in
the docs repository.
