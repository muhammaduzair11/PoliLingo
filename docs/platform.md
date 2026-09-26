# Platform contract: accounts, sync, review, admin, course maker, publish

This is the build contract for the PoliLingo platform (Stage 1, phases P1–P7). Every agent
building a part of it reads this first and codes against it. **If this document and your
instinct disagree, this document wins; if this document is wrong or silent, stop and say so
in your report rather than inventing a second convention.**

The platform has been built to this contract. Where the build settled a detail the contract
left open, or had to differ from it, the text is marked **As built**; those parts are the
contract now. How the result fits together is in [`architecture.md`](architecture.md), and
how to deploy it in [`runbook-deploy.md`](runbook-deploy.md).

Decided by the founder on 2026-09-26, overriding older docs where they differ:

- **One real production Supabase project** (`polilingo`, Singapore). No demo environment, no
  personas, no demo banner. Reviewers are real invited people.
- **Supabase is authoritative for the curriculum ("in-app publish").** Editors write content
  in the app, reviewers approve in the app, an admin presses Publish, and the database builds
  a new learner copy. The web app fetches it at runtime. The private `polilingo-content`
  repository is the one-time seed plus a nightly snapshot.
- Sign-in is **optional**, Google or a 6-digit email code, behind an age gate. There are no
  passwords, and anonymous learning stays exactly as it is.

Non-negotiable (a change that breaks one of these is wrong even if tests pass):

1. No service-role/secret key in the web app or Vercel. Every privileged action is a database
   function checked against `auth.uid()`.
2. RLS is enabled on every table; `anon` reads nothing except the published learner copy
   (through one function). A CI test proves it.
3. Anonymous learning creates no server data. Learner pages stay static and never load
   supabase-js for an anonymous visitor.
4. Local progress is never cleared or deleted, not on sign-in, sign-out, account switch or
   deletion.
5. Review authority is scoped to language **and variety**; no self-approval (except the
   sole-reviewer path with an admin countersign); editing learner-visible text voids
   approval; review history is append-only. **All enforced in the database.**
6. An admin cannot also hold a reviewer role (`PL409_ROLE_CONFLICT`).
7. Hindko is never shown to learners until reviewed; demo items are never approved.
8. The age gate comes before any sign-in button; under-13 creates nothing; accounts can be
   deleted.
9. AI agents (including you) never operate a reviewer account on the real project and never
   call review actions there. Local test accounts on the local stack are fine.

---

## 1. Ownership: who may touch which file

Work is split into a **Foundation** step, seven **Tracks** (A–G) that run in parallel in
separate git worktrees, and **Integration**. A file belongs to exactly one of them. A track
that needs a change to a file it does not own writes the need in its final report; it does
not edit the file.

| Owner                     | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Foundation**            | `package.json`, `package-lock.json`, `.env.example`, `.gitignore`, `app/layout.tsx`, `app/globals.css`, every **new** `app/styles/*.css` partial (created empty with an owner comment where a track fills it), `app/(console)/layout.tsx`, `components/learning-provider.tsx`, `components/account-boot.tsx`, `components/native.tsx`, `components/console/*` (the kit; tracks put screen components in `components/console/<area>/`), `lib/supabase/*`, `proxy.ts`, `lib/rpc.ts`, `lib/db-errors.ts`, `lib/console/{access,action-result,paths}.ts`, `lib/{canonical-json,sha256,auth-hint,account-store,script-check}.ts`, `lib/orthography/*.json`, `supabase/config.toml`, `supabase/templates/*`, `supabase/error-codes.json`, `supabase/seed.sql`, `supabase/seeds/*`, migrations `20260928000100`–`20260928000500`, `tests/db/helpers.mjs`, `tests/db/invariants.test.mjs`, `tests/{canonical-json,sha256,db-errors,auth-hint,account-store,script-check,boundaries}.test.mjs`, `scripts/{with-db-lock,local-otp,local-real-content}.mjs`, `.github/workflows/db.yml`, `docs/validation.md`, this file. **Stubs with final signatures** for `components/account/runtime.tsx` (A), `components/account/sync-agent.tsx` (B), `lib/release-cache.ts` and `components/release-refresher.tsx` (G) |
| **A Accounts & legal**    | `app/sign-in/**`, `app/auth/**`, `app/account/**`, `app/privacy/**`, `app/terms/**`, `components/account/*` except `sync-agent.tsx` and `account-switch-dialog.tsx`, `lib/{age-gate,safe-next,in-app-browser}.ts`, `app/styles/account.css`, edits to `components/site-chrome.tsx` (chip), `components/lesson-player.tsx` (save-progress prompt on the finish screen), `components/settings.tsx` (account row), `components/onboarding.tsx` (the "no sign-up needed" copy); migration `20260928001000_accounts.sql`; `tests/{age-gate,safe-next,in-app-browser}.test.mjs`, `tests/db/accounts.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **B Sync**                | `lib/sync.ts`, `components/account/{sync-agent,account-switch-dialog}.tsx`, `lib/progress.ts` (only the `importedIntoAccounts` TODOs), `tests/sync.test.mjs`, `tests/learning.test.mjs` additions; migration `20260928001100_sync.sql`; `tests/db/sync.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **C People & overview**   | `app/(console)/admin/page.tsx`, `app/(console)/admin/people/**`, `app/invite/**`, `components/console/admin/*`, `lib/console/{invite-link,overview}.ts`, `app/styles/console-admin.css`; migration `20260928001200_people.sql`; `tests/{invite-link,overview}.test.mjs`, `tests/db/people.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **D Review**              | `app/(console)/review/**`, `app/(console)/admin/suggestions/**`, `components/console/review/*`, `lib/console/review.ts`, `app/styles/console-review.css`; migration `20260928001300_review.sql`; `tests/review.test.mjs`, `tests/db/review.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **E Editor**              | `app/(console)/edit/**`, `components/console/editor/*`, `lib/console/{editor,exercise-generator}.ts`, `app/styles/console-editor.css`; migration `20260928001400_editor.sql`; `tests/{editor,exercise-generator}.test.mjs`, `tests/db/editor.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **F Publish**             | `app/(console)/admin/publish/**`, `components/console/publish/*`, `lib/console/release-diff.ts`, `app/styles/console-publish.css`; migration `20260928001500_publish.sql`; `tests/release-diff.test.mjs`, `tests/db/publish.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **G Learner runtime**     | `lib/content.ts`, `lib/redirects.ts`, `lib/release-verify.ts`, `lib/release-cache.ts`, `components/release-refresher.tsx`, `app/api/release/route.ts`; migration `20260928001600_release_read.sql`; `tests/{release-verify,release-cache,content-live}.test.mjs`, `tests/db/release-read.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Integration**           | `README.md`, `CHANGELOG.md`, `docs/{architecture,configuration,runbook-deploy,testing}.md`, merge fixes, migrations `20260929000000+`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Content repo (F-SEED)** | `E:\Polilingo\content`: `scripts/seed-supabase.mjs`, `tests/seed-supabase.test.mjs`, `.github/workflows/snapshot.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Repository idioms that bind everyone (from the existing code):

- Tests are `node --test` `.mjs` files importing `.ts` directly (Node type stripping). **Any
  module a test imports uses relative imports with the `.ts` extension and only erasable
  TypeScript** (no enums, namespaces, parameter properties). Components may use `@/…`.
- No Jest, Vitest, Playwright or component-render tests (ADR-0012/0013). Logic goes in `lib/`
  as pure functions, with tests.
- oxlint (with `react/react-compiler`) and oxfmt (`singleQuote`, width 80) must pass; run
  `npm run format` and commit its output **for files you own**.
- Plain CSS partials with semantic class names; tokens in `app/styles/tokens.css`. Ivory
  canvas, aubergine ink, violet `--primary`, yellow only on violet, Outfit type, radii 1rem
  and 1.5rem, no dark mode, every animation off under both reduced-motion switches. Native
  script always renders through `components/native.tsx` with `lang` and `dir`.
- Microcopy is warm, short, second person, and plain English. Learner surfaces never mention
  review state, "demo", "sample" or Hindko (`docs/validation.md` greps for it).
- Next.js 16: dynamic `params` are promises (`const { id } = await params`). `proxy.ts`
  replaces `middleware.ts`.

---

## 2. Local development

- Docker Desktop plus the Supabase CLI (`npx supabase`, the `supabase` devDependency). One
  shared local stack for everyone, started once:
  `npx supabase start -x studio,imgproxy,storage-api,realtime,edge-runtime,logflare,vector,postgres-meta,supavisor`
  API `http://127.0.0.1:54321`, DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`,
  local mail (Mailpit/Inbucket) `http://127.0.0.1:54324`.
- `.env.local` (never committed): `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` the local anon/publishable key from
  `npx supabase status -o env`.
- `npm run test:db` = `node scripts/with-db-lock.mjs` (a cross-worktree file lock in the OS
  temp dir, stale after 10 minutes) around `npx supabase db reset` (migrations plus seeds of
  **the current worktree**) followed by `node --test tests/db/*.test.mjs`. Never run
  `supabase db reset` outside the lock: other agents share the stack.
- `npm run otp -- <email>` prints the latest 6-digit code sent to that address by the local
  stack (`scripts/local-otp.mjs`, reads the Mailpit API and falls back to Inbucket's).
- `npm run db:real-content` (`scripts/local-real-content.mjs`) resets under the lock, then
  loads `../content/dist/seed.sql` (built locally from the private repo, never committed) in
  place of the fixture content, for end-to-end checks with the real curriculum.
- Seeded local accounts (fixed UUIDs in `supabase/seeds/10_people.sql`, all `18+`):
  `admin@polilingo.test` (admin, ctr-0101), `editor@polilingo.test` (editor, all languages,
  ctr-0102), `reviewer.ps@polilingo.test` and `reviewer.ps2@polilingo.test` (language
  reviewers, Pashto `ps-var-yusufzai`, ctr-0103/0104), `reviewer.hno@polilingo.test` (Hindko
  `hno-var-hazara`, ctr-0105), `learner@polilingo.test` and `learner2@polilingo.test` (no
  role), `teen@polilingo.test` (`13-17`, no role). Each has an `auth.identities` row, so the
  local email-code sign-in works for it. `10_people.sql` also inserts the `ps` and `hno`
  languages and the two varieties its grants name.
- The committed fixture content (`seeds/20_content_fixture.sql`) is two demo lessons in the
  synthetic variety `ps-var-fixture`. Demo items are never reviewed, so the seeded reviewers'
  queues start empty. To try the review flow locally, sign in as `editor@polilingo.test`,
  create a lesson in the fixture course with variety `ps-var-yusufzai`, add items and submit
  it; `reviewer.ps` and `reviewer.ps2` can then review it. `npm run db:real-content` gives
  them the real Yusufzai lessons instead.
- Local mail is Mailpit, configured under `[local_smtp]` in `config.toml` (CLI 2.118 has no
  `[inbucket]` section).

---

## 3. Database

### 3.1 Schemas, exposure and grants

- `public`: learner and people tables (**no table grants to `anon` or `authenticated` at
  all**) and every API function. It is the only schema PostgREST exposes
  (`[api] schemas = ["public", "graphql_public"]`).
- `content`: curriculum, review, releases, the ID registry. Not exposed. `authenticated` has
  `USAGE` and `SELECT` on its tables, **filtered by RLS**, so `SECURITY INVOKER` page
  functions can read what the caller may see. No write grants to anyone but the owner.
- `private`: helpers, trigger functions, builders, settings, seed bookkeeping. Not exposed.
  `authenticated` gets `EXECUTE` only on the RLS helper functions policies call (§3.6) and,
  **as built**, on the pure or RLS-scoped helpers that `SECURITY INVOKER` page functions
  call: `raise`, `js_ws`, `normalise_native`, `text_fingerprint`, `canonical_json`,
  `native_problems`, `lesson_problems`, `effective_gate`, `lesson_json`. Everything else in
  `private` (builders, `bootstrap_first_admin`, trigger functions) has no grant. A track
  that needs another `private` function from an invoker function asks the foundation for
  the grant.
- Default privileges: `revoke all on tables, sequences from anon, authenticated` and `revoke
execute on functions from public, anon, authenticated` in all three schemas. Each API
  function then gets an explicit `grant execute … to authenticated` (and, for
  `get_learner_release` only, `to anon`).
- `auth.uid()` is the caller. Nothing reads `request.jwt.claims` directly except
  `auth.uid()`/`auth.jwt()`.

### 3.2 Conventions

- **Errors:** `private.raise(p_code text, p_message text, p_detail jsonb default null)` →
  `raise exception using errcode = 'P0001', message = p_code || ': ' || p_message, detail =
coalesce(p_detail::text, '')`. Codes are `PL` + HTTP-like number + `_` + NAME, e.g.
  `PL403_OUTSIDE_VARIETY`. The web parses `^(PL\d{3}_[A-Z0-9_]+):\s*(.*)$` from the message.
  Every code in §3.9 is listed in `supabase/error-codes.json` as `{ "PL403_OUTSIDE_VARIETY":
"…plain English…" }` and mapped by `lib/db-errors.ts`. The database's own message text may
  carry specifics (for example the variety name) and **is** safe to show when the code is
  known; unknown errors show a generic sentence and never raw database text.
- Functions: `snake_case`, arguments `p_*`, never overloaded, `set search_path = ''`, every
  object schema-qualified (`content.items`, `auth.uid()`, `extensions.gen_random_bytes`).
  Writes are `SECURITY DEFINER`. Page reads are `page_<screen>(…) returns jsonb`,
  `SECURITY INVOKER` when they touch only `content` (RLS scopes them), otherwise `SECURITY
DEFINER` with an explicit role check first.
- Text columns with `CHECK` constraints, not enum types. Timestamps `timestamptz default
now()`. Every text `ORDER BY` in builders uses `collate "C"`.
- Check order in every function: `401` (not signed in) → profile/age → role → `422` input →
  `404` → scope `403` → `409` state → content `422`.
- Audit: `private.audit(p_action text, p_target_type text, p_target_id text, p_detail jsonb)`
  inserts into `public.audit_events` with the caller's contributor id. Actions:
  `invitation.created|revoked|accepted`, `role.granted|revoked`, `admin.bootstrap`,
  `review.approve|request_changes|reject`, `countersign`, `suggestion.created|accepted|declined|withdrawn`,
  `content.created|updated|moved|reordered|retired|gate_changed|submitted`,
  `demo.sunset_changed`, `release.published|rolled_back`, `account.deleted`,
  `comment.redacted`.
- Kill switches: `private.app_settings(key text primary key, value jsonb)` seeded with
  `sync_enabled = true`, `overlay_enabled = true`. Readers use `private.setting_on(key)`.

### 3.3 Shared SQL primitives (migration 0100)

```sql
-- JSON with sorted keys and no whitespace: identical to canonicalJson() in content scripts/build.mjs
create function private.canonical_json(p jsonb) returns text language plpgsql immutable strict parallel safe set search_path = '' as $$
declare r text;
begin
  case jsonb_typeof(p)
    when 'object' then
      select '{' || coalesce(string_agg(to_json(k)::text || ':' || private.canonical_json(v), ',' order by k collate "C"), '') || '}' into r from jsonb_each(p) e(k, v);
    when 'array' then
      select '[' || coalesce(string_agg(private.canonical_json(v), ',' order by i), '') || ']' into r from jsonb_array_elements(p) with ordinality a(v, i);
    else r := p::text;
  end case;
  return r;
end $$;
-- JS \s as a regex class, so normalise matches text.normalize('NFC').trim().replace(/\s+/g, ' ')
create function private.js_ws() returns text language sql immutable parallel safe as $$
  select '[' || E'\t\n\x0b\f\r ' || U&'\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF' || ']' $$;
create function private.normalise_native(t text) returns text language sql immutable strict parallel safe set search_path = '' as $$
  select regexp_replace(regexp_replace(normalize(t, NFC), '^' || private.js_ws() || '+|' || private.js_ws() || '+$', '', 'g'), private.js_ws() || '+', ' ', 'g') $$;
create function private.text_fingerprint(t text) returns text language sql immutable strict parallel safe set search_path = '' as $$
  select left(encode(sha256(convert_to(private.normalise_native(t), 'UTF8')), 'hex'), 16) $$;
```

"Identical" holds within a limit: object keys that are ASCII or at least in the Basic
Multilingual Plane (SQL sorts keys by code point with `collate "C"`, JavaScript's `.sort()`
by UTF-16 code unit, which differ only for keys with characters beyond U+FFFF), and numbers
that are integers below 2^53 (jsonb prints `1e21` as `1000000000000000000000` and `1.5e-7`
as `0.00000015`; JavaScript prints `1e+21` and `1.5e-7`). Everything hashed today is inside
it: learner-copy keys are ASCII field names, envelope keys are lesson ids and dates, and
every number is a small integer. Where the input is untrusted, the reader enforces the limit:
`import_local_progress` (B) refuses an envelope with a non-integer number or a non-ASCII key
(`PL422_BAD_ENVELOPE`), and `verifyLearnerCopy` (G) refuses such a copy.

`tests/fixtures/{fingerprint,canonical-json}-vectors.json` hold shared vectors (Pashto,
Urdu, whitespace, NBSP, combining marks, nested objects, unicode keys). Node tests assert
the JS side (`lib/canonical-json.ts`, `lib/sha256.ts`, and the content repo's `fingerprint`)
and `tests/db/invariants.test.mjs` asserts the SQL side against the same file.

`private.forbid_change()` is the append-only trigger: it raises `PL409_APPEND_ONLY` on
update, delete and truncate. Called as `forbid_change('user_owned')` it lets a delete through
only when `current_setting('polilingo.account_deletion', true)` equals the row's `user_id`
(so `delete_my_account` can remove the caller's own ledger rows). Called as
`forbid_change('redactable')` it lets an update through only when the setting
`polilingo.redaction` is on and the only change is `body := '[removed]'` (on
`review_decisions`, `comment := '[removed]'`) plus `redacted_at`.

### 3.4 Tables

RLS is enabled on **every** table. `d` = `deferrable initially deferred`. AO = append-only
via `forbid_change`.

**public** (foundation creates all):

| Table                                           | Key columns and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`                                      | `user_id uuid pk references auth.users on delete cascade`, `age_band text not null check in ('13-17','18+')`, `created_at`, `updated_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `audit_events` (AO)                             | `id bigint identity pk`, `at`, `actor_contributor_id text`, `actor_kind check in ('contributor','system','bootstrap','seed')`, `action`, `target_type`, `target_id`, `detail jsonb`; indexes `(at desc)`, `(target_type, target_id)`                                                                                                                                                                                                                                                                                                                                                                                    |
| `contributors`                                  | `id text pk check ~ '^ctr-[0-9]{4}$'` (from `private.contributor_seq start 106`, formatted `ctr-` + 4 digits; ids ≤ 0105 are reserved for seeds), `user_id uuid unique references auth.users on delete set null`, `display_name 1..60`, `attribution_name null`, `status check in ('active','paused','ended') default 'active'`, `created_at`, `created_by`                                                                                                                                                                                                                                                             |
| `contributor_private`                           | `contributor_id pk references contributors on delete cascade`, `legal_name`, `contact_email`, `phone`, `whatsapp`, `region`, `engagement_ref`, `age_verified_note`, `notes`, `updated_at`, `updated_by`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `role_grants` (never deleted)                   | `id uuid pk`, `contributor_id references contributors`, `role check in ('admin','editor','language_reviewer')`, `language_code references content.languages null`, `variety_id null`, `foreign key (variety_id, language_code) references content.varieties (id, language_code)`, checks: reviewer ⇔ `variety_id` not null, reviewer ⇒ language not null, admin ⇒ language and variety null; `starts_at default now()`, `ends_at null check > starts_at`, `invitation_id`, `granted_by`, `revoked_by`, `revoke_reason`. A guard trigger allows only setting `ends_at` (to a time not in the past) and the revoke fields |
| `invitations`                                   | `id uuid pk`, `token_hash bytea unique not null` (sha256 of the token, 32 bytes), `role`, `language_code`, `variety_id` (same checks as grants), `email text not null` (lower-case), `display_name`, `note`, `grant_ends_at`, `created_by not null`, `created_at`, `expires_at check <= created_at + 30 days`, `accepted_at`, `accepted_by_user`, `accepted_contributor_id`, `grant_id`, `revoked_at`, `revoked_by`                                                                                                                                                                                                     |
| `progress_completions`                          | pk `(user_id, lesson_id)`, `user_id references auth.users on delete cascade`, `lesson_id check ~ '^([a-z]{2,3}-lsn-[0-9a-f]{6}\|[a-z]+/[a-z0-9-]+)$'`, `first_release text not null` (`'mvp'` or `content@YYYY.MM.N` or a dev name), `updated_at`. Guard: `first_release` may only move earlier by `private.release_sort_key`                                                                                                                                                                                                                                                                                           |
| `progress_activity`                             | pk `(user_id, local_date)`, `local_date date check >= '2020-01-01'` with the comment **"The device's local date. Never derive it from a server timestamp: that shifts streaks for travellers."**, `count int check 1..1000`. Guard: `count` may only increase                                                                                                                                                                                                                                                                                                                                                           |
| `xp_awards` (AO except account deletion)        | pk `(user_id, award_key)`, `award_key check ~ '^(lesson:[a-z0-9/-]{3,80}\|session:[^\s]{1,100})$'`, `amount smallint check in (5, 15)`, `lesson_id null`, `source check in ('lesson','session')`, `created_at`. `lesson:<id>` rows are 15, `session:<id>` rows are 5 (§3.7)                                                                                                                                                                                                                                                                                                                                             |
| `progress_devices`                              | pk `(user_id, device_id)`, `device_id text 1..100`, `reported_xp int check >= 0`, `last_seen_at`. Guard: `reported_xp` may only increase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `learner_prefs`                                 | `user_id pk`, `daily_goal smallint check 1..3 null`, `selected_course text check ~ '^[a-z]{2,20}$' null`, `updated_at`. Written insert-if-absent by the import; never silently overwritten                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `progress_imports` (AO except account deletion) | pk `(user_id, envelope_hash char(64))`, `device_id`, `imported_at`, `summary jsonb`; index `(user_id, imported_at desc)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**content** (foundation creates all; written only by definer functions and the seed):

| Table                                                   | Key columns and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `languages`                                             | `code pk check ~ '^[a-z]{2,3}$'`, `name`, `native_name`, `script`, `direction check in ('rtl','ltr')`, `locale`, `status`, `publish_gate check in ('open','blocked') default 'open'`, `reviewer_of_record`, `notes`, `revision_no`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `varieties`                                             | `id pk check ~ '^[a-z]{2,3}-var-[a-z0-9-]+$'`, `language_code references languages`, `unique (id, language_code)`, id prefix equals the language, `name`, `learner_label not null`, `region`, `status`, `publish_gate`, `pronunciation_notes`, `notes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `courses`                                               | `id pk` (`<lang>-crs-<slug>`, in `id_registry`), `language_code`, `variety_id`, `foreign key (variety_id, language_code) → varieties`, `name`, `tagline not null default ''`, `target_learner`, `outcomes text[]`, `version`, `status`, `publish_gate`, `scope jsonb`, `retired_at`, `revision_no`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `units`                                                 | `id pk` (`<lang>-unt-<hex6>`), `course_id references courses`, `unique (id, course_id)`, `position int null` (null ⇔ retired; `unique (course_id, position) d`), `title 1..60`, `goal text check length >= 10`, `theme`, `publish_gate default 'blocked'` for units created in the app (seeded units keep their YAML gate), `retired_at`, `revision_no`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `lessons`                                               | `id pk` (`-lsn-`), `course_id`, `unit_id`, `foreign key (unit_id, course_id) → units (id, course_id) on update cascade` (moving a unit carries its lessons), `position` (`unique (unit_id, position) d`), `title 1..60`, `subtitle not null default '' ≤ 120`, `objective ≥ 10`, `variety_id references varieties`, `estimated_minutes 3..15 null`, `publish_gate default 'open'`, `review_status check in ('unreviewed','approved','changes_requested','rejected') default 'unreviewed'`, `current_decision_id uuid null` (FK added after `review_decisions`), `review_fingerprint char(16)`, `last_approved_seq bigint`, `submitted_at`, `text_author text`, `retired_at`, `revision_no`                                                                                                                                                                                                                                       |
| `items`                                                 | `id pk` (`-itm-`), `lesson_id references lessons`, `unique (id, lesson_id)`, `position int check 1..12` (`unique (lesson_id, position) d`; null when retired), `native text 1..300` stored normalised, `romanisation 1..300`, `meaning 1..200`, `context ≤ 300 null`, `usage_note ≤ 500 null` (not blank), `variety_id references varieties` (same language as the id prefix), `tags text[]`, `skills text[]`, `source_type check in ('reviewer_attested','community_attested','published_work','original')`, `source_citation ≥ 3`, `source_licence ≥ 2`, `source_retrieved date null`, `source_caveat null`, `alternatives jsonb default '[]'`, `audio_default_asset_id null`, `legacy_ref unique null`, `text_fingerprint char(16)`, `review_fingerprint char(16)`, `review_status` (as lessons), `current_decision_id`, `last_approved_seq`, `text_author`, `revision_no`, `retired_at`; index `(variety_id, review_status)` |
| `exercises`                                             | `id pk` (`-exr-`), `lesson_id`, `position` (`unique (lesson_id, position) d`), `kind check in ('meaning','translation','match','assemble','context')`, `answer_item_id`, `foreign key (answer_item_id, lesson_id) → items (id, lesson_id) d`, `prompt 1..300`, `options text[] not null default '{}'`, `difficulty 1..5 null`, `skills text[]`, `retired_at`, `revision_no`. Trigger: `assemble` ⇔ empty options; otherwise 1..11 distinct live items of the same lesson, never the answer                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `revisions` (AO)                                        | `seq bigint identity pk`, `object_type check in ('language','variety','course','unit','lesson','item','exercise')`, `object_id`, `revision_no`, `unique (object_type, object_id, revision_no)`, `lesson_id null`, `variety_id null`, `author_contributor_id null`, `reason check in ('import','create','edit','suggestion','move','reorder','retire','gate')`, `suggestion_id null`, `snapshot jsonb`, `text_fingerprint`, `review_fingerprint`, `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `id_registry`                                           | `id pk`, `type check in ('variety','course','unit','lesson','item','exercise','audio')`, `language_code`, `minted_on date`, `legacy`, `note`, `minted_by`, `retired_at` (set once, never cleared). Never deleted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `demo_items`                                            | `item_id pk references items`, `ml_training text not null check = 'not_granted'`. Insert only while seeding (`polilingo.seeding = 'on'`), never update or delete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `demo_period`                                           | `language_code pk`, `sunset date not null`, `live boolean not null` (ps, ur `true`; hno `false`, immutable)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `keymap_lessons`, `keymap_items`, `keymap_courses` (AO) | the YAML keymap rows plus `position int unique` (file order): `(legacy_key, lesson_id, course_id)`, `(legacy_ref, item_id)`, `(legacy_id, course_id)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `orthography_allowlist`                                 | pk `(language_code, cp int)`, flattened (hno = ur plus its additions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `releases` (AO)                                         | `seq bigint identity pk`, `name text unique check ~ '^content@\d{4}\.\d{2}\.\d{1,6}$'`, `y`, `m`, `n` generated from the name with `unique (y, m, n)`, `kind check in ('seed','publish','rollback')`, `content_hash check ~ '^sha256-[0-9a-f]{64}$'`, `payload jsonb not null`, `published_by`, `published_at`, `note`, `stats jsonb`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `release_lessons` (AO)                                  | pk `(release_seq, lesson_id)`, `lesson_class check in ('demo','reviewed')`, `source check in ('current','carried','seed')`, `review_fingerprint`, `decision_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `release_items` (AO)                                    | pk `(release_seq, item_id)`, `lesson_id`, `is_demo`, `review_fingerprint`, `decision_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `review_decisions` (AO)                                 | `id uuid pk`, `seq bigint identity`, `target_type check in ('item','lesson')`, exactly one of `item_id`/`lesson_id`, `variety_id`, `decision check in ('approve','request_changes','reject')`, `reviewer_contributor_id not null`, `grant_id`, `seen_fingerprint`, `target_revision_no`, `scope text[]`, `sole_reviewer boolean`, `comment ≤ 2000`, `redacted_at`, `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `countersignatures` (AO)                                | `id`, `decision_id unique references review_decisions`, `variety_id`, `admin_contributor_id`, `grant_id`, `comment`, `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `suggestions`                                           | `id uuid pk`, `item_id`, `variety_id`, `suggester_contributor_id`, `base_review_fingerprint`, `proposed jsonb` (keys ⊆ native, romanisation, meaning, context, usage_note), `note`, `status check in ('open','accepted','declined','withdrawn','superseded')`, `resolved_by`, `resolved_at`, `resolution_note`, `created_at`. Guard: updates only from `open`, only status and resolution fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `review_comments` (AO, redactable)                      | `id uuid pk`, `target_type check in ('item','lesson','suggestion','decision')`, `target_id`, `variety_id`, `parent_id null`, `author_contributor_id`, `body 1..4000`, `redacted_at`, `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

As built, beyond the lists above: `varieties` also has `reviewer_of_record` and
`revision_no`; `lessons`, `items` and `exercises` have `created_at` and `updated_at`; on
`units`, `lessons`, `items` and `exercises`, `position` is null exactly when `retired_at`
is set; ids carry prefix checks (`<lang>-unt-<hex6>` and so on, and the language prefix
matches the parent's and the variety's). `role_grants` also has a before-insert trigger that
raises `PL409_ROLE_CONFLICT` (admin plus reviewer; it first takes a per-contributor
transaction advisory lock, so two concurrent grant inserts for one person are serialised and
the second sees the first), and its guard raises `PL422_BAD_DATE`
(an end in the past) and `PL409_ALREADY_ENDED`. `units.publish_gate` defaults to `'blocked'`,
so the seed passes each unit's gate explicitly.

Views (all `with (security_invoker = true)`): `content.review_queue`,
`content.awaiting_countersign`, `content.needs_recheck`, `content.pending_publish`,
`content.item_history`.

**private**: `contributor_seq`, `app_settings`, `seed_runs (corpus_hash pk, release_name,
run_at)`, all non-API functions.

### 3.5 Derivations and the state machine

**Item trigger (before insert or update):** normalise `native`; check it and `romanisation`
with `private.native_problems(language, native, romanisation)` (codes
`PL422_INVISIBLE_CHAR`, `PL422_SMART_QUOTE`, `PL422_ARABIC_DIGIT`, `PL422_CHAR_NOT_ALLOWED`,
`PL422_ROMANISATION_SCRIPT`, `PL422_ROMANISATION_NO_LATIN`; problems carry the character and
its 1-based position); compute `text_fingerprint = private.text_fingerprint(native)` and
`review_fingerprint = left(sha256(canonical_json({native, romanisation, meaning, context,
usage_note, variety, citation})), 16)`, with (**as built**) a null `context` or
`usage_note` left out, as the learner copy leaves them out. When `review_fingerprint`
changes on update: `review_status := 'unreviewed'`, `current_decision_id := null`,
`text_author := private.change_author()` (the caller's contributor id, or the suggester
during `accept_suggestion`), `revision_no := revision_no + 1`. An after trigger writes a
`revisions` row (reason `import` while seeding, otherwise from
`current_setting('polilingo.revision_reason', true)`, defaulting, **as built**, to `create`
on insert and `edit` on update; `polilingo.suggestion_id` fills `suggestion_id`). Demo
items reject any update (`PL409_DEMO_FROZEN`) except while seeding. `revision_no` is owned
by the database on every content table: it goes up by one whenever anything but
bookkeeping changes, and it is what `p_expected_revision` compares with.

Transaction-local settings the triggers read: `polilingo.seeding` (`'on'` inside each seed's
own transaction, always with `set local` or `set_config(…, true)`),
`polilingo.revision_reason` (`move`, `reorder`, `retire`, `gate`, `suggestion`, …),
`polilingo.change_author` (the suggester, set by `accept_suggestion`),
`polilingo.suggestion_id`, `polilingo.redaction` (`'on'` in `redact_comment`) and
`polilingo.account_deletion` (the caller's uid, set by `delete_my_account` before it deletes
`auth.users`).

**Lesson fingerprint** covers `{title, subtitle, objective, variety, ordered live item ids,
ordered live exercises (id, kind, answer, prompt, options)}`. Any change to it voids the
lesson's approval the same way. Exercise and item changes recompute their lesson's
fingerprint.

**Statuses** (items and lessons): `unreviewed → approved | changes_requested | rejected`;
any learner-visible edit returns to `unreviewed`. "In review" is not stored: an unreviewed
item in a lesson with `submitted_at` set is shown as "In review".

**Author rule:** the caller is an author of a target if they wrote any `revisions` row for it
(for a lesson: its own and its exercises' rows) with `seq > last_approved_seq`. An author's
approval is refused (`PL403_OWN_TEXT`) unless `private.active_reviewer_count(variety) = 1`,
in which case the decision is stored with `sole_reviewer = true` and is **not publishable
until** an admin who is not the reviewer countersigns it. A later non-sole approval
supersedes it.

**Suggestions:** reviewer `create_suggestion` → editor/admin `accept_suggestion` applies it
verbatim with the suggester as author (voiding approval; other open suggestions on the item
become `superseded`) → a different reviewer approves (or the suggester approves as sole
reviewer plus a countersign).

**Publishable:**

- _Reviewed item:_ live, not demo, `approved`, current decision is `approve` with
  `seen_fingerprint = review_fingerprint`, and not sole-reviewer or countersigned.
- _Exercise:_ live; answer and options are live items of the same lesson; no option shares
  the answer's native text or meaning; `assemble` ⇔ no options.
- _Lesson:_ effective gate open through language, course, course variety, unit, lesson,
  lesson variety and every item's variety; 1–12 live items; ≥ 1 exercise; no blocking
  problems; and either **reviewed** (no demo items, lesson approved and current plus
  countersign if sole, every item publishable, ≥ 6 exercises) or **demo** (every item demo,
  `demo_period.live`, UTC today ≤ `sunset`). A mixed or empty lesson never publishes.
- _Carry-forward:_ a lesson that is not publishable now but was in the previous release is
  carried as that release's JSON (with `order` updated) if its gate is still open, its class
  is still allowed and none of its items is retired.
- _Demo exit:_ when a language has a unit whose candidates are all `reviewed`, that
  language's demo lessons are dropped in the same release.
- _Hindko:_ its demo never goes live. Opening any variety or language gate needs an active
  reviewer for it (`PL409_NO_REVIEWER`).

### 3.6 Helpers (foundation, migration 0300)

All `SECURITY DEFINER`, `stable`, `set search_path = ''`, `EXECUTE` granted to
`authenticated`. A staff grant counts only when the contributor is `active`, the profile is
`18+`, and `starts_at <= now() < coalesce(ends_at, 'infinity')`.

- `private.current_contributor_id() → text`
- `private.is_admin() → boolean`, `private.is_staff() → boolean` (any active staff grant)
- `private.can_edit_language(p_language text) → boolean` (admin, or editor unscoped or for
  that language)
- `private.review_grant_for(p_variety text) → uuid`, `private.has_review_authority(p_variety
text) → boolean`, `private.active_reviewer_count(p_variety text) → int`
- `private.readable_varieties() → text[]` (admin: all; editor: their language's, or all if
  unscoped; reviewer: their varieties)
- `private.change_author() → text`
- `public.my_context() → jsonb` (definer, signed in): `{ user_id, email, profile: {age_band}
| null, contributor: {id, display_name} | null, is_admin, editor_languages: [..] | 'all',
review_varieties: [{id, language, name}], sole_reviewer_varieties: [..] }`.
- `private.bootstrap_first_admin(p_email text) → text`: no grants; refuses when
  `session_user = 'authenticator'`; works only when no active admin exists (advisory lock);
  finds the auth user by email, requires an `18+` profile, creates the contributor and the
  admin grant, audits `admin.bootstrap`. Errors: `PL409_ADMIN_EXISTS`, `PL404_NOT_FOUND`,
  `PL403_NO_PROFILE`, `PL403_UNDER_18`. Run once in the Supabase SQL editor.

### 3.7 Progress sync (track B)

Envelope `polilingo.sync@1`, built on the device from the existing v3 state (no storage
migration):

```json
{
  "format": "polilingo.sync@1",
  "deviceId": "…",
  "localDate": "2026-09-27",
  "xp": 65,
  "completed": {
    "ps-lsn-0a41c2": "content@2026.09.1",
    "pashto/greetings": "mvp"
  },
  "activity": { "2026-09-26": 1, "2026-09-27": 2 },
  "rewarded": ["<session id>", "…"],
  "dailyGoal": 2,
  "selected": "pashto"
}
```

**XP identity:** in the v3 model every reward appends one session id to `rewarded` and pays
20 when the lesson is new to `completed`, else 5, so local XP = 15·|completed| +
5·|rewarded|. The server therefore writes `lesson:<lesson_id>` = 15 per completion and
`session:<id>` = 5 per rewarded session (insert if absent; clients never send amounts), keeps
each device's reported XP in `progress_devices`, and reports
`xp = greatest(sum(xp_awards.amount), max(progress_devices.reported_xp))`. XP never
decreases. (Trade-off, documented: the same lesson first completed on two devices counts one
first completion.)

`public.import_local_progress(p_envelope jsonb) → jsonb` (definer, `authenticated`):
`PL401_NOT_SIGNED_IN`, `PL403_NO_PROFILE`, `PL460_SYNC_DISABLED` (kill switch),
`PL422_BAD_ENVELOPE` (format, sizes: ≤ 5 000 completions, ≤ 10 000 rewarded, ≤ 3 000
activity days, dates `YYYY-MM-DD`, counts 1..1000), `PL429_RATE_LIMITED` (> 120 applied
imports per hour). It takes a per-user advisory lock, hashes
`private.canonical_json(p_envelope)`; an already-recorded hash returns the state with
`applied: false`. Otherwise: completions union (earliest release by
`private.release_sort_key`; legacy keys resolved through `content.keymap_lessons` when
mapped), activity per date maximum (never summed), awards insert-if-absent, device XP
maximum, prefs insert-if-absent. Returns `private.progress_state(uid) || {applied,
envelope_hash}` where the state is `{ xp, completed: {lesson: release}, activity: {date: n},
rewarded: [session ids], dailyGoal, selected }`.

`public.get_my_progress() → jsonb` (definer, stable) returns the same state.

**As built**, three account-wide limits sit beside the per-envelope ones, so no account can
grow without end across imports: at most 5 000 completions and 20 000 session awards per
account (an import that would pass either is refused with `PL422_BAD_ENVELOPE`, detail
`{limit}`; an account at a limit still syncs what it already holds), and at most 20
devices: a new device past that is folded into the account's device with the highest
reported XP, which leaves the account's XP unchanged. A completion's 15 XP award is keyed by
the lesson's id through the whole keymap (`private.award_lesson_key`), so an MVP key and its
permanent id never pay twice.

**As built**, Reset in Settings while signed in clears only this device (the device's
`userId` goes with it, so the next sync does not ask): the account keeps its copy, and it
returns at the next save. Settings says so before the learner confirms.

### 3.8 Row Level Security

`SELECT` policies `to authenticated` (writes have no policies; only definer functions write).
`public` tables carry no grants, so their policies are defence in depth plus the tested
contract. `anon` has nothing anywhere.

| Table                                                                                                                                       | `using (…)`                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `profiles`, `progress_*`, `xp_awards`, `learner_prefs`                                                                                      | `user_id = (select auth.uid())`                                                                                            |
| `contributors`                                                                                                                              | `(select private.is_staff()) or user_id = (select auth.uid())`                                                             |
| `contributor_private`, `role_grants`                                                                                                        | `(select private.is_admin()) or contributor_id = (select private.current_contributor_id())`                                |
| `invitations`, `audit_events`                                                                                                               | `(select private.is_admin())`                                                                                              |
| `content.languages`, `varieties`, `courses`, `units`, `id_registry`, `releases`, `release_*`, `demo_*`, `keymap_*`, `orthography_allowlist` | `(select private.is_staff())`                                                                                              |
| `content.lessons`, `items`, `review_decisions`, `countersignatures`, `suggestions`, `review_comments`                                       | `variety_id = any ((select private.readable_varieties())::text[])`                                                         |
| `content.exercises`                                                                                                                         | `exists (select 1 from content.lessons l where l.id = exercises.lesson_id)`                                                |
| `content.revisions`                                                                                                                         | `(variety_id is null and (select private.is_staff())) or variety_id = any ((select private.readable_varieties())::text[])` |
| `private.*`                                                                                                                                 | no grants, no policies                                                                                                     |

**As built**, the variety policies read `variety_id = any ((select
private.readable_varieties())::text[])`. The `::text[]` cast matters: without it Postgres
parses `any ((select …))` as `ANY (subquery)` and fails with `operator does not exist: text
= text[]`. Write the same form in any query of your own.

`tests/db/invariants.test.mjs` asserts, each returning zero rows: RLS off anywhere in
`public/content/private`; an undeclared schema; any table privilege held by `anon`,
`PUBLIC`, or (in `public`) `authenticated`; any `anon`-executable function other than
`public.get_learner_release(text)`; any `SECURITY DEFINER` function without a pinned
`search_path`; any view without `security_invoker`. It also proves learner A cannot read
learner B (through the RPCs, and through the policies directly by granting `select` inside
the rolled-back test transaction) and that a signed-in user without a role reads zero
`content` rows.

### 3.9 Functions by track

Codes below omit the `PL` prefix. Signatures are final; tracks implement them exactly.

**Foundation** (0300): `my_context()`, `private.bootstrap_first_admin(p_email)` (§3.6).

**A — accounts** (`…001000_accounts.sql`):

- `ensure_profile(p_age_band text) → jsonb` (definer): `401_NOT_SIGNED_IN`,
  `422_BAD_AGE_BAND`; creates the profile if absent; an existing profile is returned
  unchanged.
- `set_age_band(p_age_band text) → jsonb` (definer, own): `401`, `403_NO_PROFILE`,
  `422_BAD_AGE_BAND`, `409_STAFF_AGE` (a staff member cannot declare `13-17`).
- `delete_my_account() → jsonb` (definer): `401`, `409_LAST_ADMIN`. Sets
  `polilingo.account_deletion`, deletes the `auth.users` row (cascades profile, progress,
  prefs, imports, awards), sets `contributors.user_id` null and `status = 'ended'`, deletes
  `contributor_private`, ends every active grant, audits `account.deleted` with the ctr id
  only. Review decisions stay under the ctr id.
- `export_my_data() → jsonb` (definer, stable): the caller's profile, progress, awards,
  devices, prefs, contributor, grants, and their own decisions/suggestions/comments.
- `private.purge_profileless_users()`: deletes `auth.users` rows older than 24 hours with no
  profile; scheduled daily with `pg_cron` when the extension is available. **As built**: the
  job is `polilingo-purge-profileless-users` at `17 3 * * *` (UTC); the migration schedules
  it only when `pg_cron` is installed or can be, so the runbook enables the extension before
  the first push. `delete_my_account` also revokes the open invitations the person issued.

**B — sync** (`…001100_sync.sql`): `import_local_progress(p_envelope jsonb)`,
`get_my_progress()`, `private.progress_state(uuid)`, `private.xp_total(uuid)`,
`private.resolve_lesson_key(text) → text` (§3.7). `private.release_sort_key(text) → int[]`
(`mvp` = `{0}` < `content@Y.M.N` = `{1,Y,M,N}` < dev names = `{2}`) already exists in the
foundation's `…000400_progress_tables.sql`, because the completions guard needs it: use it,
do not define it again.

**C — people** (`…001200_people.sql`):

- `create_invitation(p_role text, p_email text, p_language text default null, p_variety text
default null, p_display_name text default null, p_expires_in_days int default 7,
p_grant_ends_at timestamptz default null, p_note text default null) → jsonb {invitation_id,
token, path, expires_at}` (definer, admin): `401`, `403_NOT_ADMIN`, `422_BAD_SCOPE`,
  `422_BAD_EMAIL`, `422_BAD_EXPIRY`. Token: 32 random bytes from
  `extensions.gen_random_bytes`, base64url without padding (43 chars); only
  `sha256(token)` is stored; the raw token is returned once. `path = '/invite/' || token`.
- `revoke_invitation(p_invitation_id uuid) → jsonb` (admin): `403_NOT_ADMIN`, `404_NOT_FOUND`,
  `410_INVITATION_USED`.
- `peek_invitation(p_token text) → jsonb {role, language, variety, variety_name, email_masked,
expires_at, status}` (definer, signed in): `401`, `404_INVITATION_NOT_FOUND`.
- `accept_invitation(p_token text) → jsonb {contributor_id, grant_id, role, language,
variety}` (definer, signed in), checked in this order: `401`; lookup by hash `for update`
  (`404_INVITATION_NOT_FOUND`); `410_INVITATION_REVOKED`, `410_INVITATION_EXPIRED`,
  `410_INVITATION_USED` (the same user accepting again gets the same success); the caller's
  `auth.users.email_confirmed_at` set (`403_EMAIL_UNVERIFIED`) and email equal to the
  invitation's (`403_WRONG_EMAIL`, message shows it masked); profile exists
  (`403_NO_PROFILE`) and is `18+` for every staff role (`403_UNDER_18`); then find or create
  the contributor (reactivating an ended one) and `contributor_private`; refuse an admin +
  reviewer mix on one person (`409_ROLE_CONFLICT`) or a duplicate active grant
  (`409_ALREADY_HAS_ROLE`); insert the grant (`ends_at = grant_ends_at`), mark accepted,
  audit.
- `revoke_role(p_grant_id uuid, p_effective_at timestamptz default now(), p_reason text default
null) → jsonb` (admin): `403_NOT_ADMIN`, `404_NOT_FOUND`, `422_BAD_DATE`,
  `409_ALREADY_ENDED`, `409_LAST_ADMIN`.
- `update_contributor(p_contributor_id text, p_patch jsonb) → jsonb` (admin for every field;
  the contributor themself for `attribution_name` only): `401`, `403_NOT_ADMIN`,
  `422_BAD_INPUT`.
- `page_admin_people() → jsonb` (definer, admin): contributors with private details, grants
  (active and ended), open invitations (never the token).
- `page_admin_overview() → jsonb` (definer, staff; accounts section admin only): per language
  `{items, in_review, approved_waiting (approved and not in the latest release), live (in the
latest release), gated, demo, reviewed_live}`; reviewers per variety; accounts total,
  signed in within 7 days (from `progress_imports`), learners with a completion, completions
  total; latest release `{name, published_at}`; target line `{reviewed_target_min: 250,
reviewed_target_max: 400}`.

**As built** (people and roles):

- **Leaving ends every open role.** `update_contributor` setting `status` to `ended` ends
  every grant that has not ended yet, now, and records each (`role.revoked`).
- **Coming back replaces old roles.** When someone whose contributor is `ended` or `paused`
  accepts an invitation, the contributor is made active again and every older role still
  open ends first, so only the role they were just invited to is live.
- **The last-admin check needs a lasting admin.** Ending or pausing an admin (`revoke_role`,
  `update_contributor`) is refused with `409_LAST_ADMIN` unless another active, 18+ admin
  holds a grant with **no end date**; an admin whose role is due to end does not count, so
  staggered end dates cannot leave nobody in charge. (`delete_my_account`'s own check, in
  track A, needs another admin active now.)
- **Invitations.** Once accepted or revoked, an invitation is void: nobody can accept a
  revoked one (`410_INVITATION_REVOKED`), and nobody but the person who accepted it can
  accept a used one (`410_INVITATION_USED`; that person gets the same success however often
  they open the link). An accepted invitation cannot be revoked (`410_INVITATION_USED`: end
  the role instead); revoking twice is not an error. An invitation whose sender is no longer
  an admin is void too (`410_INVITATION_REVOKED`, shown as `void` on `/admin/people`),
  whatever its expiry says.
- **One lock for admin changes.** `revoke_role`, `update_contributor` and
  `delete_my_account` take the same transaction advisory lock,
  `hashtextextended('polilingo.admins', 0)`, so two admins removing each other or
  themselves at once cannot both pass the last-admin check.

**D — review** (`…001300_review.sql`):

- `record_review_decision(p_target_type text, p_target_id text, p_decision text,
p_seen_fingerprint text, p_scope text[] default null, p_comment text default null) → jsonb
{decision_id, status, sole_reviewer, countersign_required}` (definer, reviewer): `401`,
  `403_NOT_REVIEWER`, `422_BAD_INPUT`, `422_COMMENT_REQUIRED` (non-approve without a comment),
  `404_NOT_FOUND`, `403_OUTSIDE_VARIETY` (message: "<Variety name> needs a <Variety name>
  reviewer."), `409_STALE` (detail carries the current fingerprint), `409_DEMO_NEVER_APPROVED`,
  `403_OWN_TEXT` (unless sole reviewer), `422_SCOPE_INCOMPLETE` (items must cover text,
  romanisation, meaning, and usage when the item has context or a usage note),
  `422_TOO_FEW_EXERCISES` (lesson < 6), `422_LESSON_PROBLEMS`.
- `countersign_decision(p_decision_id uuid, p_comment text default null) → jsonb` (admin):
  `403_NOT_ADMIN`, `404`, `409_NOT_SOLE`, `403_SELF_COUNTERSIGN`, `409_ALREADY_COUNTERSIGNED`,
  `409_STALE`.
- `create_suggestion(p_item_id text, p_seen_fingerprint text, p_proposed jsonb, p_note text
default null) → uuid` (reviewer of the variety): `403_NOT_REVIEWER`, `404`,
  `403_OUTSIDE_VARIETY`, `409_STALE`, `409_DEMO_FROZEN`, `422_NO_CHANGE`, text-rule `422`s.
- `withdraw_suggestion(p_suggestion_id uuid) → jsonb` (suggester): `403_NOT_SUGGESTER`,
  `409_SUGGESTION_CLOSED`.
- `accept_suggestion(p_suggestion_id uuid, p_seen_fingerprint text) → jsonb` (editor of the
  language or admin): `403_NOT_EDITOR`, `404`, `409_SUGGESTION_CLOSED`, `409_STALE`,
  `409_STALE_SUGGESTION`, text-rule `422`s.
- `decline_suggestion(p_suggestion_id uuid, p_reason text) → jsonb` (editor/admin):
  `422_COMMENT_REQUIRED`, `409_SUGGESTION_CLOSED`.
- `add_review_comment(p_target_type text, p_target_id text, p_body text, p_parent_id uuid
default null) → uuid` (staff who can read the target): `403_OUTSIDE_VARIETY`, `422_LENGTH`.
- `redact_comment(p_comment_id uuid, p_reason text) → jsonb` (admin): `403_NOT_ADMIN`.
- Page reads (invoker): `page_review_queue() → jsonb` (caller's readable varieties only;
  items and submitted lessons with status, variety, lesson, age; order: submitted lessons
  first, then oldest unreviewed), `page_review_item(p_item_id text) → jsonb` (item, its
  lesson and siblings for the learner preview, revisions, decisions, comments, open
  suggestions, `can_approve`, `is_author`, `sole_reviewer`; raises `403_OUTSIDE_VARIETY`
  with the variety name when the item exists but is outside the caller's scope — check with
  a definer helper, since RLS alone would say 404), `page_review_lesson(p_lesson_id text) →
jsonb`, `page_admin_suggestions() → jsonb`.

**E — editor** (`…001400_editor.sql`). Every write first refuses with `403_NOT_EDITOR` or
`403_OUTSIDE_LANGUAGE`, and `404`/`409_RETIRED` for a missing or retired target:

- `reserve_content_id(p_type text, p_language text) → text`: mints `<lang>-<unt|lsn|itm|exr>-`
  - 6 random hex, collision-checked against `id_registry`, and registers it.
- `create_unit(p_course_id text, p_title text, p_goal text, p_theme text default null,
p_position int default null) → text` (new units start `blocked`).
- `create_lesson(p_unit_id text, p_title text, p_objective text, p_subtitle text default '',
p_variety_id text default null, p_estimated_minutes int default null, p_position int default
null) → text`: `422_VARIETY_MISMATCH`, `422_LENGTH`.
- `create_item(p_lesson_id text, p_fields jsonb, p_position int default null) → jsonb {id,
text_fingerprint, review_fingerprint, revision_no}`: `409_DEMO_FROZEN`, `422_LESSON_FULL`,
  text-rule `422`s, `422_LENGTH`, `422_PROVENANCE`.
- `create_exercise(p_lesson_id text, p_fields jsonb, p_position int default null) → text`:
  `422_BAD_OPTION`, `422_OPTION_EQUALS_ANSWER`.
- `update_unit`, `update_lesson`, `update_item`, `update_exercise` `(p_id text,
p_expected_revision int, p_patch jsonb) → jsonb`: the create codes plus `409_STALE_EDIT`,
  `422_NO_CHANGE`.
- `move_content(p_type text, p_id text, p_new_parent_id text, p_position int default null) →
jsonb`: `409_ITEM_IN_USE`, `409_DEMO_FROZEN`.
- `reorder_children(p_parent_type text, p_parent_id text, p_child_ids text[]) → jsonb`:
  `422_BAD_INPUT`.
- `retire_content(p_type text, p_id text, p_reason text) → jsonb` (courses: admin only):
  `409_ITEM_IN_USE`.
- `submit_lesson(p_lesson_id text) → jsonb`, `withdraw_lesson_submission(p_lesson_id text) →
jsonb`: `409_DEMO_FROZEN`.
- `set_publish_gate(p_type text, p_id text, p_gate text, p_reason text) → jsonb` (admin):
  `403_NOT_ADMIN`, `404`, `409_NO_REVIEWER`.
- `set_demo_sunset(p_language text, p_sunset date, p_reason text) → jsonb` (admin).
- `check_text(p_language text, p_native text, p_romanisation text) → jsonb` (invoker, staff):
  the problem list, no refusals.
- `check_lesson(p_lesson_id text) → jsonb` (invoker, staff).
- Page reads (invoker): `page_edit_tree() → jsonb` (languages → courses → units → lessons
  the caller can edit, with status counts), `page_edit_lesson(p_lesson_id text) → jsonb`
  (lesson, items, exercises, problems, revisions summary, submitted state).

**F — publish** (`…001500_publish.sql`): `private.item_reviewed_ok(text)`,
`private.lesson_reviewed_ok(text)`, `private.lesson_candidates(p_today date)`,
`private.build_learner_copy(p_release text, p_today date) → jsonb` (field-for-field equal to
`learnerCopy()` in the content repo's `scripts/build.mjs`: courses by id `collate "C"`, units
and lessons by position, items and exercises by position, `tagline`/`subtitle` default `''`,
`context`/`usage_note` omitted when null, varieties then languages only when referenced,
keymap rows in position order whose targets are present, `commit: null`, `contentHash` from
`private.canonical_json`), `private.verify_learner_copy(p jsonb, p_today date)`,
`preview_release() → jsonb {payload, contentHash, diff, excluded, awaiting_countersign}`
(editor/admin), `publish_release(p_expected_content_hash text, p_note text default null) →
jsonb {name, contentHash, lessons, items}` (admin; advisory lock, `share` locks on content
tables, build, verify, insert, audit; next name `content@<UTC YYYY>.<MM>.<n+1>`, or `.1` in a
new month): `403_NOT_ADMIN`, `409_RELEASE_CHANGED` (the preview is stale),
`409_NOTHING_TO_PUBLISH`, `422_EMPTY_RELEASE`, `409_RELEASE_CLOCK`, `500_BUILD_BUG`;
optional `rollback_release(p_release_name text, p_reason text)`; `page_admin_publish() →
jsonb` (release history plus the preview). **Test:** the fixture seed's release #1 rebuilt by
`build_learner_copy` has the same `contentHash`.

**As built**, `rollback_release(p_release_name text, p_reason text) → jsonb {name,
contentHash, lessons, items, restored}` (admin) is implemented. It appends a new release
(`kind = 'rollback'`, the next name, the reason as its note) whose payload is the named
release's learner copy with `release` renamed and `commit: null`, copies that release's
`release_lessons` (source `carried`) and `release_items`, and audits `release.rolled_back`;
`restored` is the name brought back. History is never rewritten. It takes the publish lock
and the same `share` locks, and refuses in this order: `401_NOT_SIGNED_IN`,
`403_NOT_ADMIN`, `422_BAD_INPUT` (not a release name), `422_COMMENT_REQUIRED` (no reason),
`422_LENGTH` (reason over 500 characters), `404_NOT_FOUND` (no such release),
`409_RELEASE_CLOCK`, `409_NOTHING_TO_PUBLISH` (the latest release already has that content
hash), and `409_NOT_PUBLISHABLE` when the copy can no longer be shown: one of its lessons or
phrases is missing, retired or moved, its gate is closed, a demo phrase is past its
language's sunset, or reviewed lessons have since replaced its demo lessons (the detail lists
`lessons` and `problems`). Because it checks the caller is an admin, it runs from the app,
not the SQL editor.

**G — release read** (`…001600_release_read.sql`): `get_learner_release(p_known_hash text
default null) → jsonb` (definer, stable, **the only function `anon` may execute**): returns
null when `overlay_enabled` is off (**as built**: also when nothing has been released);
`{release, contentHash, unchanged: true}` when the hash matches the latest release;
otherwise `{release, contentHash, payload}`. "Latest" is the highest `seq`, so a rollback,
being a new release, is what learners get.

**Error code catalogue** (`supabase/error-codes.json`, every one mapped in
`lib/db-errors.ts`): `401_NOT_SIGNED_IN`; `403_NO_PROFILE`, `403_NOT_ADMIN`,
`403_NOT_EDITOR`, `403_NOT_REVIEWER`, `403_OUTSIDE_LANGUAGE`, `403_OUTSIDE_VARIETY`,
`403_OWN_TEXT`, `403_SELF_COUNTERSIGN`, `403_NOT_SUGGESTER`, `403_EMAIL_UNVERIFIED`,
`403_WRONG_EMAIL`, `403_UNDER_18`; `404_NOT_FOUND`, `404_INVITATION_NOT_FOUND`;
`409_STALE`, `409_STALE_EDIT`, `409_STALE_SUGGESTION`, `409_DEMO_FROZEN`,
`409_DEMO_NEVER_APPROVED`, `409_ROLE_CONFLICT`, `409_ALREADY_HAS_ROLE`, `409_LAST_ADMIN`,
`409_ADMIN_EXISTS`, `409_ALREADY_ENDED`, `409_NOT_SOLE`, `409_ALREADY_COUNTERSIGNED`,
`409_SUGGESTION_CLOSED`, `409_ITEM_IN_USE`, `409_RETIRED`, `409_NO_REVIEWER`,
`409_RELEASE_CHANGED`, `409_NOTHING_TO_PUBLISH`, `409_RELEASE_CLOCK`,
`409_NOT_PUBLISHABLE`, `409_APPEND_ONLY`, `409_SEED_MISMATCH`, `409_STAFF_AGE`;
`410_INVITATION_REVOKED`, `410_INVITATION_EXPIRED`, `410_INVITATION_USED`;
`422_BAD_INPUT`, `422_BAD_AGE_BAND`, `422_BAD_ENVELOPE`, `422_BAD_SCOPE`, `422_BAD_EMAIL`,
`422_BAD_EXPIRY`, `422_BAD_DATE`, `422_COMMENT_REQUIRED`, `422_SCOPE_INCOMPLETE`,
`422_TOO_FEW_EXERCISES`, `422_LESSON_PROBLEMS`, `422_LENGTH`, `422_VARIETY_MISMATCH`,
`422_LESSON_FULL`, `422_INVISIBLE_CHAR`, `422_SMART_QUOTE`, `422_ARABIC_DIGIT`,
`422_CHAR_NOT_ALLOWED`, `422_ROMANISATION_SCRIPT`, `422_ROMANISATION_NO_LATIN`,
`422_PROVENANCE`, `422_BAD_OPTION`, `422_OPTION_EQUALS_ANSWER`, `422_NO_CHANGE`,
`422_EMPTY_RELEASE`, `422_HASH_MISMATCH`; `429_RATE_LIMITED`; `460_SYNC_DISABLED`;
`500_BUILD_BUG`.

### 3.10 Migrations and seeds

| File                                 | Owner       | Contents                                                                                                                                                                                                    |
| ------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260928000100_foundation.sql`      | Foundation  | schemas, default privileges, `private.raise`, `canonical_json`, `js_ws`, `normalise_native`, `text_fingerprint`, `forbid_change`, `app_settings`, `setting_on`, `profiles`, `audit_events`, `private.audit` |
| `20260928000200_content_model.sql`   | Foundation  | every `content` table and view, the derive/void/revision/guard triggers, `native_problems`, `lesson_problems`, `effective_gate`, `lesson_json`                                                              |
| `20260928000300_people.sql`          | Foundation  | people tables, `contributor_seq`, the §3.6 helpers, `my_context`, `bootstrap_first_admin`                                                                                                                   |
| `20260928000400_progress_tables.sql` | Foundation  | progress tables and guards, `private.release_sort_key`                                                                                                                                                      |
| `20260928000500_access.sql`          | Foundation  | every grant and RLS policy in §3.8, view grants                                                                                                                                                             |
| `20260928001000`–`001600`            | Tracks A–G  | functions only, as in §3.9                                                                                                                                                                                  |
| `20260929000000+`                    | Integration | fixes                                                                                                                                                                                                       |

Seeds (`config.toml`: `[db.seed] sql_paths = ['./seed.sql', './seeds/*.sql']`):
`seed.sql` only makes sure `polilingo.seeding` is off for the session and holds nothing
else (seeding mode is never set for a whole session: a pooled connection would carry it to
the next client); `seeds/10_people.sql` holds the test accounts in §2, in one transaction
with `set local polilingo.seeding = 'on'`; `seeds/20_content_fixture.sql` is generated by
the content repo's `node scripts/seed-supabase.mjs --fixture` from its synthetic fixture
corpus (no real phrases) and committed. Real content never goes in this public repository.

These seeds are for the **local stack only**. Both refuse to run on a database that holds
more than local test data (an `auth.users` email outside `@polilingo.test`, a release that
is not a seed, or a staff or bootstrap action in `audit_events`; the people seed also
refuses a course outside `ps-var-fixture`, and the fixture seed a different corpus through
`PL409_SEED_MISMATCH`). They cannot tell a brand-new, empty hosted project from a fresh
local one, so: **never run `supabase db push --include-seed` or `supabase db reset
--linked`** against the hosted project. A seeded known admin would block
`bootstrap_first_admin` for good, and releases, the ID registry, revisions and demo items
are append-only.

### 3.11 Database tests

`node:test` + `pg` (`tests/db/*.test.mjs`, **not** part of `npm test`). `tests/db/helpers.mjs`
exports:

- `db()` → a `pg.Client` on `process.env.DATABASE_URL ??
'postgresql://postgres:postgres@127.0.0.1:54322/postgres'`.
- `tx(fn)` → runs `fn(client)` inside `BEGIN … ROLLBACK`, so tests never leave data behind.
- `user(client, { email, ageBand = '18+', emailConfirmed = true })` → inserts into
  `auth.users` (and a profile when `ageBand` is set) and returns `{ id, email }`.
- `as(client, u)` → `set local role authenticated` plus `set_config('request.jwt.claims',
{sub, role: 'authenticated', email}, true)`; `asAnon(client)`; `asPostgres(client)`
  (`reset role`).
- `grant(client, u, role, { language, variety })` → a contributor and grant for a test user.
- `expectCode(promise, 'PL403_OUTSIDE_VARIETY')` → asserts the refusal code.
- `seedLesson(client, { language, variety, items, exercises, demo })` → builds content for a
  test through direct inserts as `postgres` with `polilingo.seeding` on.

Every refusal in §3.9 has a test that calls the function directly. The CI workflow
`db.yml` starts a fresh stack, runs `supabase db reset`, then `npm run test:db:ci` (the tests
without the lock).

---

## 4. Web

### 4.1 Environment

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the publishable/anon
key; public by design). Nothing else. `lib/supabase/env.ts` reads them **literally**
(`process.env.NEXT_PUBLIC_SUPABASE_URL`) so Next inlines them, and returns `null` when either
is missing: the build must pass without them, learner pages behave exactly as today, and
console pages render a "not configured" notice.

### 4.2 Supabase clients and the proxy

- `lib/supabase/browser.ts`: `browserSupabase()` → a `createBrowserClient` singleton, or null.
  Imported only by `components/account/**`, `app/sign-in/**`, `app/invite/**` client parts.
- `lib/supabase/server.ts`: `import 'server-only'`; `async function serverSupabase()` using
  `await cookies()` `getAll`/`setAll` (`setAll` inside try/catch for server components).
- `lib/supabase/proxy.ts`: `updateSession(request)` refreshes the session cookies and returns
  `{ response, user }`.
- `proxy.ts`: `export async function proxy(request)`; redirects to
  `/sign-in?next=<path>` when there is no user; `export const config = { matcher:
['/account/:path*', '/review/:path*', '/admin/:path*', '/edit/:path*', '/invite/:path*'] }`
  written as a literal. Learner routes, `/sign-in` and `/auth/*` never run the proxy.
- Vercel Functions region `sin1`, next to the Supabase project, so the proxy, every console
  page and action and `/api/release` do not pay a trans-Pacific round trip per call. It is a
  project setting, not code: Vercel dashboard → Project → Settings → Functions → Function
  Region → Singapore (`sin1`). Next 16 deprecates the `preferredRegion` segment config, and
  the deploy docs keep "no `vercel.json`"; Integration records the step in
  `docs/runbook-deploy.md` (or, if the founder prefers it in the repository, a
  Foundation-owned `vercel.json` with `{ "regions": ["sin1"] }`). **As built**: the runbook
  step, no `vercel.json`.

### 4.3 Reads, writes and errors in the console

- **Reads:** server components call one page RPC through `lib/rpc.ts`:
  `callRpc<T>(supabase, fn: string, args?: object) → Promise<{ ok: true, data: T } | { ok:
false, error: DbError }>`.
- **Writes:** Server Actions only (`'use server'` files named `actions.ts` next to the page),
  each returning `ActionResult<T> = { ok: true; data: T } | { ok: false; code: string;
message: string }` (`lib/console/action-result.ts`) and calling `revalidatePath` on
  success. Forms use `useActionState`; pending buttons use the kit's `SubmitButton`.
- `lib/db-errors.ts`: `describeDbError(error) → { code, message }`. Known `PL…` codes map to
  their catalogue sentence, or to the database's own message when that carries specifics;
  `23505` "That already exists."; `42501` "Your account doesn't have access to this.";
  JWT/session errors "Your session ended. Please sign in again."; network failures "We can't
  reach PoliLingo's server right now. Nothing was changed."; anything else "Something went
  wrong. Nothing was changed." Raw database text is never shown for unknown errors; the code
  is shown in small print for support.
- `lib/console/access.ts` (server-only): `getAccess = cache(async () => my_context())`,
  `requireRole('admin' | 'editor' | 'reviewer' | 'staff')` →
  `{ ok: true, context } | { ok: false, view }` (**as built**; a page never throws or
  redirects for a missing role), where `view` is the kit's `NoAccess` panel.
  A page writes `const gate = await requireRole('admin'); if (!gate.ok) return gate.view;`.
  UI guards are cosmetic; the database decides.
- `lib/console/paths.ts`: route builders (`reviewItemPath(id)`, `editLessonPath(id)`, …).

### 4.4 Console shell and kit (foundation)

`app/(console)/layout.tsx` (dynamic): loads `getAccess()`; not signed in → redirect to
`/sign-in?next=…`; no profile → the age declaration panel; renders `ConsoleShell` with nav
entries by role: **Review** (reviewers), **Edit** (editors, admins), **Admin** (admins:
Overview, People, Suggestions, Publish). **As built**, an editor who is not an admin also
gets **Suggestions** under Edit, since editors accept and decline them. The shell has a top
bar (brand, "Workspace", the account menu with sign-out) and a side nav on desktop that
becomes a tab strip under 800px (reviewers use phones).

Kit (`components/console/`): `shell.tsx`, `nav.tsx` (client, `usePathname`),
`page-header.tsx` (`title`, `description`, `actions`), `data-table.tsx` (stacks into cards
under 580px), `status-badge.tsx` (`draft | in_review | changes_requested | approved |
rejected | live | gated | retired | demo | sole_reviewer`), `stat.tsx`, `empty-state.tsx`,
`submit-button.tsx` (`useFormStatus`), `confirm-action.tsx` (AlertDialog plus a server action
plus the mapped error), `notice.tsx` (`role="status"` or `role="alert"`), `no-access.tsx`,
`script-field.tsx` (input or textarea with `lang`/`dir` plus live issues from
`lib/script-check.ts`), `native-preview.tsx` (renders a phrase the way a learner sees it,
through `components/native.tsx`).

`components/native.tsx` gains `export function NativeText({ text, lang, dir, large })` for
console use; `Native` stays as it is.

CSS partials (imported by `app/globals.css` after `dialogs.css`, before `keyframes.css`):
`console.css` (foundation: shell and kit), `account.css` (A), `console-admin.css` (C),
`console-review.css` (D), `console-editor.css` (E), `console-publish.css` (F). Console
density is higher than learner pages; same tokens, same fonts.

### 4.5 Learner pages stay static

- The committed `content/release.json` stays the baseline learner copy.
- No learner file imports `@supabase/*`, `lib/supabase/*` or `lib/rpc.ts`.
  `tests/boundaries.test.mjs` scans `components/*.tsx` (excluding `components/account/**`,
  `components/console/**`, `components/ui/**`), `app/` (excluding `(console)`, `account`,
  `sign-in`, `auth`, `invite`, `api`) and `lib/` (excluding `supabase/`, `console/`,
  `rpc.ts`) and fails on any such import. It also asserts that `components/account-boot.tsx`
  loads the runtime only through a dynamic `import(` and that `proxy.ts`'s matcher holds only
  the console prefixes.
- Learner route render modes in the build output do not change.

### 4.6 Account boot, runtime and store

- `lib/auth-hint.ts`: `hasSessionHint(cookie: string) → boolean`, true when
  `/(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/` matches (never the `-code-verifier` cookie).
- `lib/account-store.ts`: an external store for `useSyncExternalStore`:
  `{ status: 'unknown' | 'anonymous' | 'signed-in', userId, email, initial, sync: 'idle' |
'syncing' | 'synced' | 'offline' | 'error' | 'paused', lastSyncedAt }`, with
  `getAccountSnapshot()`, `subscribeAccount(fn)`, `setAccount(patch)`, `useAccount()`.
- `components/account-boot.tsx` (foundation), mounted by `app/layout.tsx` inside
  `LearningProvider`: after mount, no hint → `setAccount({ status: 'anonymous' })`; hint →
  `lazy(() => import('./account/runtime'))`.
- `components/account/runtime.tsx` (A; foundation ships a stub with this signature):
  `export default function AccountRuntime()`, which creates the browser client, reads the
  session, subscribes to `onAuthStateChange`, publishes to the store, and renders
  `<SyncAgent />`. After an OTP verify or the OAuth callback the app does a full navigation
  (`location.assign(next)`) so the provider boots with the hint.
- `components/account/sync-agent.tsx` (B; stub `export function SyncAgent() { return null
}`).

### 4.7 Live content (G)

- `lib/content.ts` keeps its exports but makes them **live bindings**: `export let
learnerCopy`, `contentVersion`, `courses`, `legacyLessonIds`, plus `export const
baselineCopy`, `export function activateRelease(copy)` and `resetToBaseline()`.
  `getCourse`, `lessonSize`, `knownLesson` and `selectedCourse` read the active copy.
  `hiddenCourseSlugs` and `lib/redirects.ts` use `baselineCopy` (redirects are fixed at
  build time). Activation happens only in browser effects.
- `lib/release-verify.ts` (pure): `verifyLearnerCopy(x) → { ok: true, copy } | { ok: false,
reason }` (format and schemaVersion, recomputed `contentHash` with `lib/canonical-json.ts`
  and `lib/sha256.ts`, unique ids, directions, exercise kinds, every exercise item and option
  inside its lesson, ≥ 1 exercise per lesson, every language in `PRESENTATION`, `commit` may
  be null); `isNewerRelease(a, b)` compares `content@YYYY.MM.N` numerically, and dev names
  are never newer.
- `lib/release-cache.ts` (foundation stub, G fills it): `activateCachedRelease(storage:
StorageLike | null) → string` (reads `polilingo.content.release`, verifies, activates if
  newer than the baseline, returns the active release name), `storeRelease(storage, copy)`,
  `fitSessions(state) → state` (drops unfinished runs whose `lessonSize` changed, as
  `playable()` does). **As built**: the stored value is `{ source, copy }`, where `source`
  is the Supabase project URL, so a copy from one project (a local stack) is never shown
  against another; `forgetRelease(storage)` removes it.
- `app/api/release/route.ts`: `GET ?known=<hash>` → fetches `get_learner_release()` from
  Supabase REST with the publishable key through `fetch(…, { next: { tags:
['learner-release'] } })` (one cached upstream fetch for everyone), compares with
  `known`, and returns `{ unchanged: true }` or `{ release, contentHash, payload }` with
  `Cache-Control: no-store`. With no env it returns `{ unchanged: true }`. Publish (F) calls
  `revalidateTag('learner-release')`. **As built**: the fetch is a GET with only the
  `apikey` header (so Next caches it) and a 60-second `revalidate` beside the tag, so a
  kill-switch change, which nothing can tag, is picked up within a minute; an upstream
  failure or timeout (8 s) answers `{ unchanged: true }`; and
  when the function answers null (the kill switch is off, or nothing is released) the route
  answers **`{ reset: true }`**, always with status 200. `releaseAnswer()` and
  `releaseStep()` in `lib/release-verify.ts` hold the rules: on `{ reset: true }`, or a
  release that is not newer than the baseline, the browser forgets its stored copy and goes
  back to the baseline. Publish and rollback call **`updateTag('learner-release')`** in their
  Server Actions, which expires the tag at once rather than serving the old answer once more.
- `components/release-refresher.tsx` (foundation stub, G fills it): mounted by the provider;
  fetches after ready, on `visibilitychange` to visible, on `online`, and every 60 s while
  visible; on a verified newer copy stores it and, unless the path starts with `/lesson/`
  (then it waits for the next path change), calls the provider's `refreshContent(name)`.
- `components/learning-provider.tsx` (foundation): in the single mount effect,
  `activateCachedRelease(browserStorage())` **before** `hydrateProgress(…)`; context adds
  `contentRelease: string` and `refreshContent(name)`, which sets it and runs
  `update(fitSessions)`, so every `useLearning()` consumer re-renders.

### 4.8 Sign-in and account (A)

- `/sign-in?next=…`: step 1 age gate (birth year and month, `lib/age-gate.ts`
  `ageBandFor(year, month, today) → 'under-13' | '13-17' | '18+'`); under 13 shows only "You
  can keep learning without an account" and nothing else; otherwise a 30-minute
  `pl_age_band` cookie is set and step 2 shows **Continue with Google** and **Email me a
  code** (6-digit input with `input-otp`). `lib/in-app-browser.ts` detects WhatsApp,
  Instagram and Facebook in-app browsers and shows "Open in Chrome/Safari" plus the email
  option instead of Google.
- Google: `signInWithOAuth({ provider: 'google', options: { redirectTo:
origin + '/auth/callback?next=' + next } })`.
- Email: `signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo:
origin + '/auth/confirm?next=' + encodeURIComponent(next) } })`, then `verifyOtp({ email,
token, type: 'email' })`, then `ensure_profile(band)`, then `location.assign(next)`. The
  email's button is built from that redirect (`supabase/templates/magic-link.html`:
  `{{ .RedirectTo }}&token_hash=…&type=email`), so `emailRedirectTo` must always carry
  `?next=` and be on the Auth redirect allow list (with the hosted project using the same
  template). A redirect that is not allowed falls back to the Site URL, and the link is then
  `<Site URL>/auth/confirm?token_hash=…&type=email` with no `next`. Email confirmations are
  on (`[auth.email] enable_confirmations = true`, and "Confirm email" on the hosted
  project): a new address gets the confirmation template, which carries the same code.
- `app/auth/callback/route.ts`: `exchangeCodeForSession(code)`, `ensure_profile` from the
  cookie, redirect to `safeNext(next)`. `app/auth/confirm/route.ts`: `verifyOtp({ token_hash,
type })`, same. `lib/safe-next.ts` `safeNext(x) → string` allows only same-origin paths
  (rejects `//x`, `/\x`, schemes, and anything not starting with a single `/`).
- **As built**, `/auth/confirm` **GET never uses the token**: mail scanners open every link
  in an email, and a GET that signed in would use up the code in the same email (and a link
  crafted by someone else would sign a visitor in to that person's account). GET redirects
  (303, `no-store`, `no-referrer`) to `/sign-in/confirm?token_hash=…&type=…&next=…`, a page
  with a **Finish signing in** button whose form POSTs back to `/auth/confirm`. Only that
  POST, and only when it is same-origin (`Origin` or `Sec-Fetch-Site`, checked by
  `isSameOriginPost()` in `lib/safe-next.ts`), calls `verifyOtp` and finishes like Google
  (`app/auth/finish.ts`). Anything else goes back to `/sign-in` with a plain sentence.
- `/account`: profile (email, age band), roles, sync status, **Download my data**
  (`export_my_data` as a JSON file), **Delete my account** (confirm dialog, `delete_my_account`,
  sign out, local progress kept), **Sign out** (`signOut({ scope: 'local' })`, local progress
  kept).
- Header chip in `.header-actions`: anonymous → an icon link to `/sign-in` labelled "Sign in
  to save your progress"; signed in → the initial in a circle linking to `/account`, with a
  small sync dot. Rules for 580px and 350px live in `account.css`.
- The lesson finish screen offers "Save your streak — sign in" to anonymous learners with a
  streak of at least 2 days, dismissible, never before the first completed lesson.
- `/privacy` and `/terms`: drafts from the docs archive templates
  (`E:\Polilingo\docs\archive\policy\privacy-policy.md`, `terms-of-service.md`), bannered
  "Draft — pending legal review", describing only what the system actually does.

### 4.9 Sync (B)

`lib/sync.ts` (pure): `buildEnvelope(state, today) → Envelope`, `envelopeKey(envelope) →
string`, `snapshotToState(snapshot, base) → ProgressState`, `applySnapshot(local, snapshot,
userId, now) → ProgressState` (= `mergeProgress(local, snapshotToState(…))` plus `userId`,
`lastSyncedAt`, and `importedIntoAccounts ∪ { userId }`), `accountChoice(state, userId) →
'sync' | 'ask'` (ask when the device already synced to a different account and holds
progress), `ledgerXp(state) = 15·|completed| + 5·|rewarded|`.
`components/account/sync-agent.tsx`: syncs on mount after sign-in, whenever
`state.rewarded.length` grows, on focus (at most every 15 s) and on `online`; single-flight
with exponential backoff; writes status to the account store. `'ask'` opens
`AccountSwitchDialog` ("Add this device's progress to <email>?" / "Not now"); "Not now"
pauses sync for the tab and never touches local data.

### 4.10 Console screens (tracks C–F)

- `/admin` (C): overview from `page_admin_overview`: per-language pipeline, reviewers per
  variety, accounts and activity, latest release, the honest line "Reviewed items: N (target
  250–400 per language)".
- `/admin/people` (C): people with roles and dates; **Invite** (role, language, variety,
  email, name, expiry) → a one-time link with **Copy** and **Share on WhatsApp**
  (`https://wa.me/?text=` + an encoded message); revoke a role now or on a date; revoke an
  open invitation. `/invite/[token]` (C): `peek_invitation` → "You're invited to review
  Northern Pashto" → **Accept** → the console. Sends `Referrer-Policy: no-referrer`; the GET
  has no side effects.
- `/review` (D): the queue for the caller's varieties; `/review/item/[id]`: learner preview,
  history, **Approve** (the scope checkboxes; all required ones must be ticked), **Request
  changes**, **Reject** (comment required), **Suggest a fix** (script-checked fields),
  **Comment**; every refusal in plain English. `/review/lesson/[id]`; `/admin/suggestions`
  (D): open suggestions with **Accept** / **Decline**.
- `/edit` (E): the tree; `/edit/lesson/[id]`: lesson metadata, items (native, romanisation,
  meaning, context, usage note, source) with live script checks, exercises with **Generate
  exercises** (`lib/console/exercise-generator.ts`, deterministic: per item one `meaning`
  and one `translation` with distractors from the same lesson, plus one `match` and one
  `assemble` when there are enough items, giving at least 6), reorder, retire, **Submit for
  review**; new unit, new lesson, new item.
- `/admin/publish` (F): the preview diff (lessons added, changed, removed, carried),
  problems and held-back lessons, the countersign queue, **Publish** (confirm dialog),
  release history.

---

## 5. Content repository (F-SEED)

`scripts/seed-supabase.mjs --release content@2026.09.1 > dist/seed.sql` (from a clean
checkout of the tag) and `--fixture > ../web/supabase/seeds/20_content_fixture.sql`. It
reuses `loadCorpus`/`learnerCopy`/`canonicalJson` from `scripts/build.mjs` and emits **one
transaction**: `set local polilingo.seeding = 'on'`; a guard on `private.seed_runs` (same
corpus hash → no-op; different hash → `PL409_SEED_MISMATCH`); languages and varieties
(`on conflict … do update` only where a value differs, so the YAML wins over the rows
`seeds/10_people.sql` adds for its local grants);
`demo_period` (ps, ur live with their sunset; hno not live); the orthography allowlists;
`id_registry` from `ids/registry.jsonl`; courses, units, lessons, items, exercises (`on
conflict (id) do nothing`; revisions written by the triggers with reason `import`); demo
items and the keymap; release #1 (`kind = 'seed'`, `payload` = the learner copy verbatim)
with `release_lessons`/`release_items`; then assertions that roll everything back on failure:
every stored `text_fingerprint` equals the YAML value, the stored `contentHash` equals
`private.canonical_json` recomputed, and — when `private.build_learner_copy` exists —
rebuilding the release reproduces its `contentHash`; counts match. Finally `seed_runs` and
an audit row.

**As built**, the production seed is built with `--out dist/seed.sql` (in Windows PowerShell
`>` writes UTF-16, which Postgres cannot read; `dist/` is ignored by git, and `--out` outside
the content repository is refused), with `POLILINGO_CONTENT_ROOT` naming a clean checkout of
the tag, and run once in the Supabase SQL editor ([`runbook-deploy.md`](runbook-deploy.md)).

`.github/workflows/snapshot.yml` (nightly and on demand): `pg_dump --data-only --schema=content`
from the production database (secret `SUPABASE_DB_URL`) into `snapshots/content.sql`,
committed only when it changed.
