# Configuration and secrets

**The app needs exactly two environment variables, and both are public by design:** the
Supabase project URL and its publishable key. There is no secret key in this app, in its
repository or in Vercel, and there never will be. Every privileged action is a database
function that checks who is calling (`auth.uid()`), and every table has Row Level Security.

Without the two variables the build still passes and learner pages behave exactly as they
always have: static, with progress in the browser. Sign-in is hidden and the workspace
(`/review`, `/edit`, `/admin`) says it is not configured.

`.env.example` is the authoritative list of variables. When you add one anywhere in the
code, add it there in the same pull request.

---

## The rule

In Next.js, a variable named `NEXT_PUBLIC_*` is **compiled into the JavaScript bundle and
downloaded by every visitor**. It is published to the world, permanently, in a public
repository's build output. Anything without that prefix is readable only by server-side
code.

So:

| Prefix          | Visibility             | Use for                          |
| --------------- | ---------------------- | -------------------------------- |
| `NEXT_PUBLIC_*` | Every visitor, forever | Values that are public by design |
| No prefix       | Server only            | Everything else                  |

The worst available mistake on this project is putting Supabase's secret (service-role) key
anywhere near the app, above all as `NEXT_PUBLIC_…`. It bypasses Row Level Security
entirely; publishing it hands every visitor full read and write access to all learner data.
The app does not use it, so there is never a reason to copy it. The `Secrets` CI workflow
fails the build if any variable name combines `NEXT_PUBLIC_` with `SERVICE_ROLE`,
`SERVICE_KEY`, `SECRET`, `PRIVATE_KEY`, `PASSWORD` or `_TOKEN`, and
`tests/boundaries.test.mjs` fails if a secret or service-role key appears in the code.

**A public prefix on a private value is not caught by review. It is caught by naming
discipline and by those checks.**

---

## Environments

One real Supabase project, plus a local stack for development. There is no staging or demo
project (decided 2026-09-26).

| Environment               | Where                                 | Database                              |
| ------------------------- | ------------------------------------- | ------------------------------------- |
| **Local**                 | `npm run dev` with `npm run db:start` | the Supabase CLI stack in Docker      |
| **Production**            | `main` → `poli-lingo.vercel.app`      | `polilingo` (Singapore)               |
| **Preview of `platform`** | the `platform` branch's preview URL   | `polilingo`, the same project         |
| **Every other preview**   | each pull request's preview           | none: the variables are not set there |

A preview builds unreviewed code from a public repository, so only the preview of
`platform`, the team's own integration branch, gets the Supabase variables. Because the app
holds no secret, even that preview can do no more than any visitor with the public key:
what Row Level Security and the database functions allow a signed-in person. The Auth
redirect list names only production, that preview and localhost, so a sign-in cannot
complete on any other preview.

Set this in Vercel at **Project → Settings → Environment Variables**, ticking Production,
and Preview limited to the `platform` branch. Getting the tick boxes wrong is the failure
mode; the variable names are the easy part. Both values are compiled into the build, so
redeploy after changing them.

---

## The variables

### In the app

| Variable                               | Public?        | Source                                                   |
| -------------------------------------- | -------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes            | Supabase → Project Settings → Data API → Project URL     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes, by design | Supabase → Project Settings → API Keys → Publishable key |

The publishable key (`sb_publishable_…`; the legacy anon key also works) identifies the
project and authorises nothing on its own. **RLS is the security boundary**, and a missing
policy is a data breach, not a bug; `tests/db/invariants.test.mjs` checks that RLS is on
everywhere and that `anon` can call exactly one function, `get_learner_release`.

`lib/supabase/env.ts` reads both literally, so Next inlines them, and returns nothing when
either is missing. Learner code never imports it; the few learner files that need to know
whether sign-in exists read the variables the same literal way.

Vercel sets `VERCEL_ENV` itself. When it is `production`, `next.config.ts` refuses a
`content/release.json` whose release is not a tag (`content@YYYY.MM.N`), so a development
build of content (`content@YYYY.MM.dev+<sha>`) can reach previews but never production.

### Local only

| Variable                                                     | Used by                              | Default                                                   |
| ------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------- |
| `DATABASE_URL`                                               | `npm run test:db`, `db:real-content` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `POLILINGO_MAIL_URL`                                         | `npm run otp`                        | `http://127.0.0.1:54324` (the local mail catcher)         |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `…_GOOGLE_SECRET` | `supabase/config.toml`               | unset: Google is off locally; use the email code          |

### In the content repository

`POLILINGO_CONTENT_ROOT` points `scripts/seed-supabase.mjs` at a clean checkout of the tag it
seeds from. The Actions secret `SUPABASE_DB_URL` (the production connection string) is used
only by its nightly `snapshot.yml`, which dumps the `content` schema.

### Not configuration

Content needs no variable. The build's baseline is `content/release.json`; newer releases
are published in the app and fetched at run time from `/api/release`. Settings shows which
release a learner is using. There is no content channel: a learner copy holds only lessons
whose publish gate is open, so no variable can reveal gated content such as Hindko.

### D5 — native audio (later)

| Variable                     | Public? | Notes                                                                              |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_AUDIO_BASE_URL` | Yes     | The R2 public bucket's custom domain. It appears in every `<audio>` element anyway |

The app needs **no** R2 credentials. It reads public audio over plain HTTPS. Writing to R2
happens in the content repository's release workflow, using a token scoped to the buckets
that job actually touches.

### D10 — analytics

None, and there should never be one. ADR-0015 records the decision to use first-party
analytics only: practice events go into our own Postgres, with no third-party analytics,
tag manager or ad SDK on the learner path. Adding one is an architecture decision, not a
configuration change.

---

## Where each setting lives

Most of the platform's settings are not environment variables. The runbook
([`runbook-deploy.md`](runbook-deploy.md), "Supabase: first deploy") gives the values.

| Setting                                                    | Where                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Tables, functions, grants, RLS, the daily purge job        | `supabase/migrations/`, applied with `npx supabase db push`                   |
| `pg_cron` extension                                        | Supabase → Database → Extensions (enable before the first push)               |
| Site URL, redirect URLs                                    | Supabase → Authentication → URL Configuration                                 |
| Anonymous sign-ins off, confirm email, email OTP length 6  | Supabase → Authentication → Sign In / Providers                               |
| Sign-in email ("Magic Link" and "Confirm signup")          | Supabase → Authentication → Emails, from `supabase/templates/magic-link.html` |
| Google client ID and secret                                | Google Cloud → Credentials; entered in Supabase → Authentication → Google     |
| Custom SMTP (optional)                                     | Supabase → Authentication → Emails → SMTP                                     |
| Kill switches `sync_enabled`, `overlay_enabled`            | the database: `private.app_settings`, set in the SQL editor                   |
| The first admin                                            | the database: `private.bootstrap_first_admin(email)` in the SQL editor        |
| Everyone else's roles                                      | the app: `/admin/people`                                                      |
| The two public variables                                   | Vercel → Settings → Environment Variables                                     |
| Function region `sin1` (Singapore)                         | Vercel → Settings → Functions                                                 |
| The local stack (ports, local auth, local email templates) | `supabase/config.toml` — local only; `db push` does not apply it              |

---

## Local development

```powershell
npm run db:start
npx supabase status -o env
Copy-Item .env.example .env.local
```

In `.env.local`, set `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the local anon/publishable key that `status`
printed. `.env.local` is gitignored. Do not rename it, do not commit it, and do not paste its
contents into an issue.

Use the local stack's values. Never production's — not even read-only, not even briefly.
[`testing.md`](testing.md) has the local accounts and commands.

---

## Where secrets actually live

| Secret                             | Lives in                                                 | Who can read it      |
| ---------------------------------- | -------------------------------------------------------- | -------------------- |
| Supabase publishable key           | Vercel env vars, and every browser                       | Everyone. By design  |
| Supabase database password         | Password vault; typed into `npx supabase link`           | The founders         |
| Production connection string       | `content` repo → Actions secret `SUPABASE_DB_URL`        | The nightly snapshot |
| Google OAuth client secret         | Supabase Auth settings, and the vault                    | The founders         |
| SMTP credentials, if set           | Supabase Auth settings, and the vault                    | The founders         |
| Supabase secret / service-role key | Nowhere we copy it. Not in Vercel, not in any repository | —                    |
| R2 write token (later)             | `content` repo → Actions secrets                         | The release workflow |
| Vercel deploy token                | Not needed — Git integration                             | —                    |

Everything also goes in the shared password vault with a backup owner, per
`docs/ops/access-register.md`. A secret only one person can reach is a single point of
failure for the company, not just for the deployment.

---

## If a secret is committed

In this order. Do not start with git history.

1. **Rotate the credential first.** Assume it is compromised the moment it is pushed. A
   public repository is indexed by bots within minutes. Generate a new key in the provider's
   dashboard and revoke the old one.
2. Update it wherever it is used (Vercel, Supabase, the content repository's secrets) and in
   the password vault.
3. Remove it from the code and open a pull request.
4. Only then consider the history. On a public repository, rewriting history does not
   un-publish anything — anyone may already have cloned it. This is why step 1 is step 1.
5. Note it in the weekly log. Not to assign blame — so the next person understands why the
   naming rules exist.
