-- supabase/seeds/10_people.sql: the local test accounts (docs/platform.md §2).
-- LOCAL STACK ONLY. Runs before 20_content_fixture.sql and does not depend on
-- it. Fixed UUIDs, so tests and docs can name them. Nobody has a password:
-- sign in with the email code (`npm run otp -- <email>` prints it).
--
--   admin@polilingo.test         admin                          ctr-0101
--   editor@polilingo.test        editor, all languages          ctr-0102
--   reviewer.ps@polilingo.test   reviewer, ps-var-yusufzai      ctr-0103
--   reviewer.ps2@polilingo.test  reviewer, ps-var-yusufzai      ctr-0104
--   reviewer.hno@polilingo.test  reviewer, hno-var-hazara       ctr-0105
--   learner@polilingo.test       no role
--   learner2@polilingo.test      no role
--   teen@polilingo.test          13-17, no role
--
-- Every insert is `on conflict do nothing`, so running it twice on the local
-- stack is harmless.
--
-- The guard below refuses to run on a database that holds anything but local
-- test data: a hosted project must never get a known admin (which would also
-- block private.bootstrap_first_admin for good, since role grants are never
-- deleted). Never run `supabase db push --include-seed` or
-- `supabase db reset --linked`. The guard cannot tell a brand-new, empty
-- hosted project from a fresh local one; that is what the rule is for.
--
-- One transaction. Seeding mode is on only inside it (set local): the
-- languages and varieties below are recorded with the revision reason
-- 'import', as the content seed records its own.

begin;

set local polilingo.seeding = 'on';

do $local_only$
begin
  if exists (select 1 from auth.users u where u.email is null or lower(u.email) not like '%@polilingo.test')
     or exists (select 1 from content.releases r where r.kind <> 'seed')
     or exists (select 1 from content.courses c where c.variety_id <> 'ps-var-fixture')
     or exists (select 1 from public.audit_events a where a.actor_kind in ('contributor', 'bootstrap'))
  then
    raise exception 'supabase/seeds/10_people.sql is for the local stack only, and this database holds more than local test data.'
      using errcode = 'P0001',
            hint = 'Never run supabase db push --include-seed or supabase db reset --linked against a hosted project.';
  end if;
end
$local_only$;

-- The two varieties the reviewer grants name, so the grants' foreign keys
-- hold whatever else is seeded. Values are the content repository's YAML;
-- the content seed skips rows that already exist.
insert into content.languages (code, name, native_name, script, direction, locale, status, publish_gate)
values
  ('ps', 'Pashto', 'پښتو', 'Arab', 'rtl', 'ps-Arab-PK', 'provisional', 'open'),
  ('hno', 'Hindko', 'ہندکو', 'Arab', 'rtl', 'hno-Arab-PK', 'provisional', 'blocked')
on conflict (code) do nothing;

insert into content.varieties (id, language_code, name, learner_label, region, status, publish_gate)
values
  ('ps-var-yusufzai', 'ps', 'Northern Pashto (Peshawar / Yusufzai)',
   'Northern Pashto, as spoken around Peshawar',
   'Khyber Pakhtunkhwa — Peshawar valley and surrounding districts', 'provisional', 'open'),
  ('hno-var-hazara', 'hno', 'Hazara Hindko',
   'Hindko, as spoken in Hazara and Abbottabad',
   'Hazara division — Abbottabad and surrounding districts', 'provisional', 'blocked')
on conflict (id) do nothing;

-- Accounts. The empty strings matter: GoTrue cannot read NULL in these columns.
with people (n, email) as (
  values
    ('0101', 'admin@polilingo.test'),
    ('0102', 'editor@polilingo.test'),
    ('0103', 'reviewer.ps@polilingo.test'),
    ('0104', 'reviewer.ps2@polilingo.test'),
    ('0105', 'reviewer.hno@polilingo.test'),
    ('0201', 'learner@polilingo.test'),
    ('0202', 'learner2@polilingo.test'),
    ('0203', 'teen@polilingo.test')
)
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  ('00000000-0000-4000-8000-00000000' || n)::uuid,
  'authenticated',
  'authenticated',
  email,
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  '', '', '', '',
  now(),
  now()
from people
on conflict (id) do nothing;

with people (n, email) as (
  values
    ('0101', 'admin@polilingo.test'),
    ('0102', 'editor@polilingo.test'),
    ('0103', 'reviewer.ps@polilingo.test'),
    ('0104', 'reviewer.ps2@polilingo.test'),
    ('0105', 'reviewer.hno@polilingo.test'),
    ('0201', 'learner@polilingo.test'),
    ('0202', 'learner2@polilingo.test'),
    ('0203', 'teen@polilingo.test')
)
insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  ('00000000-0000-4000-9000-00000000' || n)::uuid,
  ('00000000-0000-4000-8000-00000000' || n)::uuid,
  '00000000-0000-4000-8000-00000000' || n,
  'email',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000' || n,
    'email', email,
    'email_verified', true
  ),
  null,
  now(),
  now()
from people
on conflict (id) do nothing;

insert into public.profiles (user_id, age_band)
values
  ('00000000-0000-4000-8000-000000000101', '18+'),
  ('00000000-0000-4000-8000-000000000102', '18+'),
  ('00000000-0000-4000-8000-000000000103', '18+'),
  ('00000000-0000-4000-8000-000000000104', '18+'),
  ('00000000-0000-4000-8000-000000000105', '18+'),
  ('00000000-0000-4000-8000-000000000201', '18+'),
  ('00000000-0000-4000-8000-000000000202', '18+'),
  ('00000000-0000-4000-8000-000000000203', '13-17')
on conflict (user_id) do nothing;

insert into public.contributors (id, user_id, display_name, status, created_by)
values
  ('ctr-0101', '00000000-0000-4000-8000-000000000101', 'Local Admin', 'active', null),
  ('ctr-0102', '00000000-0000-4000-8000-000000000102', 'Local Editor', 'active', 'ctr-0101'),
  ('ctr-0103', '00000000-0000-4000-8000-000000000103', 'Local Pashto Reviewer', 'active', 'ctr-0101'),
  ('ctr-0104', '00000000-0000-4000-8000-000000000104', 'Local Pashto Reviewer 2', 'active', 'ctr-0101'),
  ('ctr-0105', '00000000-0000-4000-8000-000000000105', 'Local Hindko Reviewer', 'active', 'ctr-0101')
on conflict (id) do nothing;

insert into public.contributor_private (contributor_id, contact_email, notes, updated_by)
values
  ('ctr-0101', 'admin@polilingo.test', 'Local test account.', 'ctr-0101'),
  ('ctr-0102', 'editor@polilingo.test', 'Local test account.', 'ctr-0101'),
  ('ctr-0103', 'reviewer.ps@polilingo.test', 'Local test account.', 'ctr-0101'),
  ('ctr-0104', 'reviewer.ps2@polilingo.test', 'Local test account.', 'ctr-0101'),
  ('ctr-0105', 'reviewer.hno@polilingo.test', 'Local test account.', 'ctr-0101')
on conflict (contributor_id) do nothing;

insert into public.role_grants (id, contributor_id, role, language_code, variety_id, starts_at, granted_by)
values
  ('00000000-0000-4000-a000-000000000101', 'ctr-0101', 'admin', null, null, now() - interval '1 day', null),
  ('00000000-0000-4000-a000-000000000102', 'ctr-0102', 'editor', null, null, now() - interval '1 day', 'ctr-0101'),
  ('00000000-0000-4000-a000-000000000103', 'ctr-0103', 'language_reviewer', 'ps', 'ps-var-yusufzai', now() - interval '1 day', 'ctr-0101'),
  ('00000000-0000-4000-a000-000000000104', 'ctr-0104', 'language_reviewer', 'ps', 'ps-var-yusufzai', now() - interval '1 day', 'ctr-0101'),
  ('00000000-0000-4000-a000-000000000105', 'ctr-0105', 'language_reviewer', 'hno', 'hno-var-hazara', now() - interval '1 day', 'ctr-0101')
on conflict (id) do nothing;

commit;
