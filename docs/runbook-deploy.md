# Runbook: deploy and rollback

Keep this short enough to follow while something is broken.

---

## How deployment works

The app and the database are deployed separately.

```
merge a pull request into main  →  Vercel builds  →  poli-lingo.vercel.app updates
a new file in supabase/migrations  →  you run `npx supabase db push`  →  the database updates
```

Vercel's Git integration watches `main`. Every pull request also gets its own preview
deployment at a unique URL, built from that branch.

No `vercel.json`. No custom build settings. Next.js is auto-detected, `npm run build` runs,
and the `.next` output is served. Keep it that way — the absence of deployment configuration
is why deployment has never been a source of problems here.

The database is one Supabase project, `polilingo` (Singapore). It is production; there is no
staging or demo project. Nothing deploys to it automatically.

---

## Supabase: first deploy and every migration after it

The first deploy is these steps in this order. After that, only "Every migration after
that" and the kill switches are needed.

### 1. Enable `pg_cron` first

Supabase dashboard → **Database → Extensions** → `pg_cron` → enable. The accounts migration
schedules a daily job, `polilingo-purge-profileless-users` (03:17 UTC), that deletes
sign-ins older than 24 hours that never answered the age question. The migration tries to
enable the extension itself; if it cannot, it still applies but nothing is scheduled. To
schedule the job afterwards, in the SQL editor:

```sql
select cron.schedule('polilingo-purge-profileless-users', '17 3 * * *',
  'select private.purge_profileless_users()');
```

Check it with `select jobname, schedule from cron.job;`.

### 2. Push the migrations

From a clean checkout of this repository:

```powershell
npx supabase login
npx supabase link --project-ref <ref>     # asks for the database password
npx supabase db push --dry-run            # lists what would be applied
npx supabase db push
```

**Never `npx supabase db push --include-seed`, and never `npx supabase db reset --linked`.**
The seeds in `supabase/seed.sql` and `supabase/seeds/` are local test data, including a
known admin; the reset wipes the database. The seeds also refuse to run on a database that
holds real accounts or releases, but they cannot tell a brand-new hosted project from a
fresh local one, so the rule is the protection. Releases, the ID registry, review history
and demo items are append-only: a mistake there cannot be deleted.

### 3. Seed the curriculum, once

Supabase is authoritative for the curriculum. The private content repository seeds it once,
from the tag the app's baseline was built from. In the content repository, with a clean
checkout of the tag beside it:

```powershell
$env:POLILINGO_CONTENT_ROOT = '<clean checkout of content@2026.09.1>'
node scripts/seed-supabase.mjs --release content@2026.09.1 --out dist/seed.sql
```

Use `--out`: in Windows PowerShell `>` writes UTF-16, which Postgres cannot read. Never
commit `dist/seed.sql` anywhere; it is the real curriculum.

Open **SQL editor** in the Supabase dashboard, paste the file and run it once. It is one
transaction and checks itself (fingerprints, the release's content hash, counts); any
failure rolls it all back. Running the same seed again changes nothing; a different corpus
is refused with `PL409_SEED_MISMATCH`. Afterwards
`select name, kind, content_hash from content.releases;` shows `content@2026.09.1`, kind
`seed`, with the same `contentHash` as `content/release.json`, so learners see no change.

From then on the content repository only receives a nightly snapshot of the `content`
schema (its `snapshot.yml`, secret `SUPABASE_DB_URL`).

### 4. Auth settings (dashboard only, not in migrations)

Supabase dashboard → **Authentication**:

- **URL Configuration.** Site URL `https://poli-lingo.vercel.app`. Redirect URLs:
  `https://poli-lingo.vercel.app/**`, the `platform` branch's preview domain
  (`https://poli-lingo-git-platform-<team>.vercel.app/**`) and `http://localhost:3000/**`.
  A redirect that is not listed falls back to the Site URL, and the email link then loses
  where the person was going.
- **Sign In / Providers.** Anonymous sign-ins **off**. Email on, "Confirm email" on, email
  OTP length **6**.
- **Emails → Templates.** Replace **both** "Magic Link" and "Confirm signup" with the
  contents of `supabase/templates/magic-link.html` (subject: "Your PoliLingo sign-in
  code"). A new address gets "Confirm signup", a returning one "Magic Link"; both must
  carry the 6-digit `{{ .Token }}` that `/sign-in` asks for.
- **Google.** Enable the provider with the client ID and secret from Google Cloud →
  APIs & Services → Credentials (a web OAuth client whose authorised redirect URI is
  `https://<ref>.supabase.co/auth/v1/callback`).
- **SMTP (optional).** Supabase's built-in sender is for testing: a few emails an hour, and
  it may deliver only to the organisation's own members. Until custom SMTP is set, Google is
  the main way in.

### 5. Vercel settings

- **Settings → Environment Variables:** `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Supabase → Project Settings → Data API and API
  Keys), ticked for **Production** and for **Preview on the `platform` branch only**. Every
  other preview gets neither, so it never talks to the database. No secret or service-role
  key, ever. Both are compiled into the build, so redeploy after changing them.
- **Settings → Functions → Function Region:** Singapore (`sin1`), next to the database.

### 6. The first admin

Sign in once in the app with the admin's own address and answer the age question (18 and
over). Then, in the SQL editor:

```sql
select private.bootstrap_first_admin('<email>');
```

It returns the new contributor id. It refuses when an admin already exists
(`PL409_ADMIN_EXISTS`), when nobody has signed in with that address (`PL404_NOT_FOUND`),
before the age question is answered (`PL403_NO_PROFILE`) and for under-18s
(`PL403_UNDER_18`). It works only from the SQL editor, never from the app. Everyone else is
invited from **/admin/people**.

### Every migration after that

A new migration arrives in `supabase/migrations/` through a reviewed pull request, and the
database workflow (`db.yml`) has run it on a fresh local stack. Push it from a clean
checkout of that commit, with `db push --dry-run` first, before or as the deployment that
calls it goes live: until then, whatever calls a function that is not there yet shows
"Something went wrong. Nothing was changed." (code `PGRST202`). `npx supabase migration list`
shows what is applied. There are no down migrations. A migration that turns out wrong is
fixed by the next one.

### Kill switches

Two switches in the database, set in the SQL editor. They take effect without a deploy.

```sql
-- off
update private.app_settings set value = 'false'::jsonb
  where key in ('sync_enabled', 'overlay_enabled');
-- back on
update private.app_settings set value = 'true'::jsonb
  where key in ('sync_enabled', 'overlay_enabled');
```

Use one key to flip one switch.

- **`sync_enabled`** stops saving progress to accounts: `import_local_progress` refuses
  with `PL460_SYNC_DISABLED`. Signed-in learners see "Saving paused", keep everything on
  their device and retry later; the first save after the switch is back on catches up.
  Sign-in, the workspace and publishing carry on.
- **`overlay_enabled`** sends every learner back to the content built into the app
  (`content/release.json`): `get_learner_release` answers null and `/api/release` answers
  `{ reset: true }` within about a minute. Progress is kept; only an unfinished lesson
  that changed size starts again. Publishing still records releases, and learners get the
  latest one when the switch is back on.

---

## Releasing

### Content: publish in the app

An admin opens **/admin/publish**, reads the preview (lessons added, changed, removed,
carried, held back), and presses **Publish**. The database builds the learner copy and
records a new release, `content@YYYY.MM.N`. Open apps pick it up within about a minute, never
in the middle of a lesson. No pull request, no deploy.

### The app

1. Confirm `main` is green in Actions.
2. Run the manual pass in [`validation.md`](validation.md) against the production URL.
3. Update `CHANGELOG.md` — move `Unreleased` into a version heading with today's date.
4. Tag it:

   ```powershell
   git checkout main
   git pull
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

5. Create the GitHub Release from the tag, pasting the changelog section.
6. Record Lighthouse scores in the release notes.

The tag is a record, not a trigger. The site updated when the pull request merged.

### A pull request that changes `content/release.json`

Rare now: the file is the baseline every build ships with, and content changes are
published in the app. If it is replaced, a production build refuses a development build of
content (`content@YYYY.MM.dev+<sha>`) by design, so merge only a file whose `release` is a
tag, `content@YYYY.MM.N`. Never edit it by hand: `npm test` recomputes its content hash.

---

## Rollback

**Symptom: the site is broken and you need it working now.** First decide which part is
broken: the content learners see, or the app itself.

### A bad content release

**/admin/publish → Release history → Go back** on the last good release, with a reason. It
publishes a new release (the next name, kind `rollback`) carrying that release's learner
copy exactly as it was; learners get it within about a minute. The button calls
`public.rollback_release(p_release_name, p_reason)`, which checks that the caller is an
admin, so it works from the app and not from the SQL editor.

It is refused when learners already have that content (`PL409_NOTHING_TO_PUBLISH`), and when
some of its lessons can no longer be shown (retired since, held back by a publish gate,
starter content past its end date or replaced by reviewed lessons: `PL409_NOT_PUBLISHABLE`).
Then publish a fix instead, and meanwhile, if it is urgent, turn `overlay_enabled` off so
everyone is back on the app's own content.

### The app: promote the previous deployment (under a minute)

1. <https://vercel.com/dashboard> → the PoliLingo project → **Deployments**
2. Find the last deployment that was good. Check the commit message and timestamp.
3. **⋯** → **Promote to Production**
4. Confirm, then reload <https://poli-lingo.vercel.app> in a private window.

This does not touch git or the database. Production now serves the older build while `main`
still has the broken commit — so **do step two below, or the next merge re-deploys the
breakage.** Migrations stay applied: they add functions and tables, and an older build simply
does not call the new ones.

### Then: fix the repository

Either revert:

```powershell
git checkout main
git pull
git revert <bad-commit-sha>
git push
```

Or roll forward with a fix if the cause is understood and small. Reverting is the default:
it is always safe, and it takes the pressure off diagnosing under time pressure.

Open a pull request either way. The branch ruleset applies during an incident too — use the
documented solo-merge bypass if the other developer is unreachable, and say in the pull
request that you did and why.

**Learner progress is safe across an app rollback.** The platform did not change the storage
version: every build since content releases reads and writes `polilingo.progress.v3` (the
account fields were already part of it), so a promoted older build reads the same record.
A newer published release is kept under `polilingo.content.release`; a build from before
live content ignores it and shows its own content, and the next build uses it again. Builds
further back keep their own keys: builds before v0.2 read and write only
`polilingo.progress.v1`, v0.2 only `polilingo.progress.v2` (merging v1 into it). The first
load after rolling forward merges those older keys into `polilingo.progress.v3`: lessons and
streak days are combined, and XP shows the higher of the two totals. An account's progress
lives in the database, which a rollback does not touch.

---

## When the build fails on `main` but preview passed

Almost always one of:

- **A dependency resolved differently.** `npm ci` in CI uses the lockfile exactly; a local
  `npm install` may not. Check `package-lock.json` is committed and current.
- **A case-sensitive import.** Windows and macOS do not care that you wrote
  `components/Dashboard.tsx` instead of `components/dashboard.tsx`. Vercel's Linux builders
  do. This is the single most common cause.
- **An environment variable exists in Preview but not Production**, or vice versa. Check
  the tick boxes in Vercel → Settings → Environment Variables. The build passes without the
  Supabase variables; it is the running app that then says the workspace is not configured.
- **A development build of content.** The error begins `This is a production build` and
  names the release, `content@YYYY.MM.dev+<sha>`. Production takes only a tagged content
  release; previews take a development one. Do not rename the `release` in the file by
  hand: the content hash does not cover it, so only review would notice.
- **Out of memory on the asset pipeline.** `sharp` processing large PNG masters can exceed
  the build memory limit. Assets are pre-baked and committed, so `optimize-assets` should
  not run during a Vercel build — if it is, that is the bug.

---

## When the site is up but wrong

**Stale assets.** Vercel's CDN caches `public/` aggressively. A new image width or audio
file needs a deploy to appear. If a _replaced_ asset shows the old version, it was
overwritten at the same path instead of published at a new one — which is exactly why audio
uses immutable revision prefixes.

**Content looks wrong.** Settings shows which content release the learner is using: the
latest published one, or the app's own `content/release.json` when nothing newer has
reached them. Fix the text in the workspace (**/edit**), have it reviewed, and publish; or go
back to an earlier release (above). A learner's app asks for news every minute while it is
open, so a fix reaches them without a reload.

**Sign-in or saving fails for everyone.** Check the Supabase status page and the Auth
settings above (redirect URLs, templates, OTP length). An email that arrives without a
6-digit code means a template was not replaced. Learners can keep learning signed out
throughout: their progress stays on the device.

**One learner's progress is wrong, nobody else's.** Their `localStorage` state. Ask for
the output of the console one-liner in the bug form. It gives `polilingo.progress.v3`
without the device ID and account fields — what is left is only their own learning
progress, no personal details. Where the current build has not saved yet, for example
because the first load could not make the backup, it gives v0.2's `polilingo.progress.v2`
or the MVP's `polilingo.progress.v1` instead, and `{}` when nothing is saved. For a
migration or merge bug, also ask for `localStorage.getItem('polilingo.progress.v1')`: no
current build writes that key, and it holds no device ID, so it can be pasted as it is.
v0.2's key holds a device ID, so ask for it through the bug form's one-liner with
`polilingo.progress.v2` alone. A learner from before v0.2 also holds a
verbatim copy of their old state under `polilingo.progress.v1.bak-<date>`. Nearly every
state bug is solved in one step from those blobs. A signed-in learner's account copy is
what **Download my data** on **/account** gives them; it includes their email address, so
never ask for it in a public issue.

---

## If learner data is at risk

Different situation, different priority. Stop deploying.

1. **Stop the bleeding.** Turn off the kill switch that fits (`sync_enabled` for account
   progress), and promote the last known-good deployment if the app is at fault.
2. **Work out the blast radius** before fixing anything. How many accounts? Which fields?
   Since when? `public.audit_events` records every team action.
3. **Do not run manual `UPDATE` statements against production data** (the kill switches
   are the one exception). Content and progress are written only by database functions
   that check who is calling, keep the revision history and void approvals; many tables
   are append-only and refuse. A fix is a migration, reviewed like any other.
4. Restore from a Supabase backup (Database → Backups) if data is genuinely lost.
5. Write it up in `docs/journey/` the same week, while you still remember the details.

---

## Contacts and access

|                          | Where                                                |
| ------------------------ | ---------------------------------------------------- |
| Who can access what      | `docs/ops/access-register.md` in the docs repository |
| Vercel                   | <https://vercel.com/dashboard>                       |
| Supabase                 | <https://supabase.com/dashboard>                     |
| Google Cloud (OAuth)     | <https://console.cloud.google.com>                   |
| Cloudflare R2            | <https://dash.cloudflare.com>                        |
| Status of GitHub Actions | <https://www.githubstatus.com>                       |
| Status of Vercel         | <https://www.vercel-status.com>                      |
| Status of Supabase       | <https://status.supabase.com>                        |

Before assuming your change broke something, check the status pages. It is occasionally not
your fault.
