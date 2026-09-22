# Runbook: deploy and rollback

Keep this short enough to follow while something is broken.

---

## How deployment works

There is no deploy command and no deploy script.

```
merge a pull request into main  →  Vercel builds  →  poli-lingo.vercel.app updates
```

Vercel's Git integration watches `main`. Every pull request also gets its own preview
deployment at a unique URL, built from that branch.

No `vercel.json`. No custom build settings. Next.js is auto-detected, `npm run build` runs,
and the `.next` output is served. Keep it that way — the absence of deployment configuration
is why deployment has never been a source of problems here.

---

## Releasing

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

---

## Rollback

**Symptom: the site is broken and you need it working now.**

### Fastest: promote the previous deployment (under a minute)

1. <https://vercel.com/dashboard> → the PoliLingo project → **Deployments**
2. Find the last deployment that was good. Check the commit message and timestamp.
3. **⋯** → **Promote to Production**
4. Confirm, then reload <https://poli-lingo.vercel.app> in a private window.

This does not touch git. Production now serves the older build while `main` still has the
broken commit — so **do step two below, or the next merge re-deploys the breakage.**

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

---

## When the build fails on `main` but preview passed

Almost always one of:

- **A dependency resolved differently.** `npm ci` in CI uses the lockfile exactly; a local
  `npm install` may not. Check `package-lock.json` is committed and current.
- **A case-sensitive import.** Windows and macOS do not care that you wrote
  `components/Polilingo.tsx` instead of `components/polilingo.tsx`. Vercel's Linux builders
  do. This is the single most common cause.
- **An environment variable exists in Preview but not Production**, or vice versa. Check
  the tick boxes in Vercel → Settings → Environment Variables.
- **Out of memory on the asset pipeline.** `sharp` processing large PNG masters can exceed
  the build memory limit. Assets are pre-baked and committed, so `optimize-assets` should
  not run during a Vercel build — if it is, that is the bug.

---

## When the site is up but wrong

**Stale assets.** Vercel's CDN caches `public/` aggressively. A new image width or audio
file needs a deploy to appear. If a _replaced_ asset shows the old version, it was
overwritten at the same path instead of published at a new one — which is exactly why audio
uses immutable revision prefixes.

**Content looks wrong.** Check `NEXT_PUBLIC_CONTENT_VERSION` on the deployment. Content is
baked in at build time, so a content fix needs a content release _and_ a redeploy of the
app.

**One learner's progress is wrong, nobody else's.** Their `localStorage` state. Ask for
the output of `localStorage.getItem('polilingo.progress.v1')` from the browser console —
it contains only their own learning progress, no personal details. Nearly every state bug
is solved in one step from that blob.

---

## If learner data is at risk

Different situation, different priority. Stop deploying.

1. **Stop the bleeding.** Promote the last known-good deployment.
2. **Work out the blast radius** before fixing anything. How many accounts? Which fields?
   Since when?
3. **Do not run manual `UPDATE` statements against production.** Every such fix has been
   overwritten by the next content sync, in every project that has ever tried it.
4. Restore from a Supabase point-in-time backup if data is genuinely lost.
5. Write it up in `docs/journey/` the same week, while you still remember the details.

---

## Contacts and access

|                          | Where                                                |
| ------------------------ | ---------------------------------------------------- |
| Who can access what      | `docs/ops/access-register.md` in the docs repository |
| Vercel                   | <https://vercel.com/dashboard>                       |
| Supabase                 | <https://supabase.com/dashboard>                     |
| Cloudflare R2            | <https://dash.cloudflare.com>                        |
| Status of GitHub Actions | <https://www.githubstatus.com>                       |
| Status of Vercel         | <https://www.vercel-status.com>                      |

Before assuming your change broke something, check those last two. It is occasionally not
your fault.
