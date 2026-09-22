# Configuration and secrets

**Today this app requires no environment variables at all.** It is static content plus
browser state, with progress in `localStorage`. That is a genuine property worth keeping
as long as possible — it is why there is currently no way to leak a credential from this
codebase.

That changes during Stage 1. This document is the contract, written before the first
secret exists rather than after the first mistake.

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

The worst available mistake on this project is `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`.
The service-role key bypasses Row Level Security entirely; publishing it hands every
visitor full read and write access to all learner data. The `Secrets` CI workflow fails the
build if any variable name combines `NEXT_PUBLIC_` with `SERVICE_ROLE`, `SECRET`,
`PRIVATE_KEY`, `PASSWORD` or `_TOKEN`.

**A public prefix on a private value is not caught by review. It is caught by naming
discipline and by that check.**

---

## Environments

| Environment     | Where                               | Database            |
| --------------- | ----------------------------------- | ------------------- |
| **Development** | `npm run dev` locally               | `polilingo-dev`     |
| **Preview**     | Every pull request's Vercel preview | `polilingo-staging` |
| **Production**  | `main` → `poli-lingo.vercel.app`    | `polilingo-prod`    |

**Preview deployments must never point at the production database.** A preview builds
unreviewed code from a public repository; anyone who opens a pull request could read or
destroy real learner data. This is why there are three Supabase projects rather than one —
it costs nothing on the free tier and removes the entire category of accident.

Set this in Vercel at **Project → Settings → Environment Variables**, ticking the correct
environment boxes for each variable. Getting the tick boxes wrong is the failure mode; the
variable names are the easy part.

---

## The variables

### Now

None.

### D2 — accounts and progress sync, around week 4

| Variable                        | Public?        | Source                                     |
| ------------------------------- | -------------- | ------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes            | Supabase → Settings → API → Project URL    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes, by design | Supabase → Settings → API → `anon public`  |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Never**      | Supabase → Settings → API → `service_role` |

The anon key is _meant_ to be public. It identifies the project and authorises nothing on
its own — everything it can do is decided by Row Level Security policies. That means **RLS
is the security boundary**, and a missing policy is a data breach, not a bug. See
`docs/technical/data-model.md` in the docs repository.

The service-role key should ideally not be in Vercel at all. It belongs in the `content`
repository's release workflow secrets, which is the only place that needs privileged
database writes. If you find yourself adding it here, stop and ask what server route needs
to bypass RLS and whether it should.

### D5 — native audio, around week 5

| Variable                     | Public? | Notes                                                                              |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_AUDIO_BASE_URL` | Yes     | The R2 public bucket's custom domain. It appears in every `<audio>` element anyway |

The app needs **no** R2 credentials. It reads public audio over plain HTTPS. Writing to R2
happens in the content repository's release workflow, using a token scoped to the buckets
that job actually touches.

### D3, D4 — content, around week 3

| Variable                      | Public? | Notes                                                                                                                               |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONTENT_VERSION` | Yes     | Which content release this build used, e.g. `content@2026.10.1`. Set by CI. Makes a learner's bug report traceable to exact content |
| `CONTENT_CHANNEL`             | Server  | `published` in production, `preview` locally to see unreviewed drafts                                                               |

### D10 — analytics, around week 8

None, and there should never be one. ADR-0015 records the decision to use first-party
analytics only: practice events go into our own Postgres, with no third-party analytics,
tag manager or ad SDK on the learner path. Adding one is an architecture decision, not a
configuration change.

---

## Local development

```powershell
Copy-Item .env.example .env.local
```

`.env.local` is gitignored. Do not rename it, do not commit it, and do not paste its
contents into an issue.

Use the **development** Supabase project's credentials locally. Never production's — not
even read-only, not even briefly.

---

## Where secrets actually live

| Secret                    | Lives in                           | Who can read it      |
| ------------------------- | ---------------------------------- | -------------------- |
| Supabase anon key         | Vercel env vars, and every browser | Everyone. By design  |
| Supabase service-role key | `content` repo → Actions secrets   | The release workflow |
| R2 write token            | `content` repo → Actions secrets   | The release workflow |
| R2 read token             | Not needed — public bucket         | —                    |
| Vercel deploy token       | Not needed — Git integration       | —                    |

Everything also goes in the shared password vault with a backup owner, per
`docs/ops/access-register.md`. A secret only one person can reach is a single point of
failure for the company, not just for the deployment.

---

## If a secret is committed

In this order. Do not start with git history.

1. **Rotate the credential first.** Assume it is compromised the moment it is pushed. A
   public repository is indexed by bots within minutes. Generate a new key in the provider's
   dashboard and revoke the old one.
2. Update it in Vercel and in the password vault.
3. Remove it from the code and open a pull request.
4. Only then consider the history. On a public repository, rewriting history does not
   un-publish anything — anyone may already have cloned it. This is why step 1 is step 1.
5. Note it in the weekly log. Not to assign blame — so the next person understands why the
   naming rules exist.
