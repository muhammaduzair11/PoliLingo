-- 20260928000100_foundation.sql
-- Owner: Foundation (docs/platform.md §1, §3.1–§3.4, §3.10).
--
-- Schemas and default privileges, the shared SQL primitives (§3.3), the
-- error helper (§3.2), the append-only trigger, the kill switches, profiles
-- and the audit log. Everything later builds on these.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Schemas and default privileges (§3.1)
-- ---------------------------------------------------------------------------

create schema if not exists content;
create schema if not exists private;

revoke all on schema content from public;
revoke all on schema private from public;

comment on schema content is
  'Curriculum, review, releases and the ID registry. Not exposed by PostgREST. authenticated reads it through RLS; only the owner writes.';
comment on schema private is
  'Helpers, trigger functions, builders, settings and seed bookkeeping. Not exposed. authenticated may execute only the helpers policies and invoker page functions call.';

-- Nothing created from here on is reachable by the API roles unless a later
-- statement grants it explicitly. Per-schema default privileges can only add
-- to the global ones, so EXECUTE for PUBLIC is revoked globally as well.
alter default privileges revoke execute on functions from public;
-- Global entries too, in case the platform set any for the migration role:
-- a per-schema revoke cannot remove a global grant.
alter default privileges revoke execute on functions from anon, authenticated;
alter default privileges revoke all on tables from anon, authenticated;
alter default privileges revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema content revoke all on tables from anon, authenticated;
alter default privileges in schema private revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema content revoke all on sequences from anon, authenticated;
alter default privileges in schema private revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema content revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Errors (§3.2)
-- ---------------------------------------------------------------------------

-- The one way a function refuses. The web parses ^(PL\d{3}_[A-Z0-9_]+):\s*(.*)$
-- from the message; the detail carries structured specifics as JSON text.
create function private.raise(p_code text, p_message text, p_detail jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_code || ': ' || p_message,
    detail = coalesce(p_detail::text, '');
end $$;

-- ---------------------------------------------------------------------------
-- Shared SQL primitives (§3.3), verbatim
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Append-only (§3.3)
-- ---------------------------------------------------------------------------

-- Row trigger (before update or delete) and statement trigger (before
-- truncate). Modes, passed as the trigger argument:
--   (none)        refuse every update, delete and truncate.
--   'user_owned'  a delete passes only when polilingo.account_deletion equals
--                 the row's user_id (delete_my_account removes the caller's
--                 own ledger rows through the auth.users cascade).
--   'redactable'  an update passes only when polilingo.redaction is 'on' and
--                 the only change is body (or comment) := '[removed]' plus
--                 redacted_at.
create function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode text := coalesce(tg_argv[0], '');
  v_changed text[];
begin
  if tg_op = 'DELETE' and v_mode = 'user_owned' then
    if (to_jsonb(old) ->> 'user_id') = nullif(current_setting('polilingo.account_deletion', true), '') then
      return old;
    end if;
  end if;

  if tg_op = 'UPDATE' and v_mode = 'redactable'
     and coalesce(current_setting('polilingo.redaction', true), '') = 'on' then
    select coalesce(array_agg(n.key), '{}') into v_changed
    from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key);
    if v_changed <@ array['body', 'comment', 'redacted_at']
       and 'redacted_at' = any (v_changed)
       and (to_jsonb(new) ->> 'redacted_at') is not null
       and (not ('body' = any (v_changed)) or (to_jsonb(new) ->> 'body') = '[removed]')
       and (not ('comment' = any (v_changed)) or (to_jsonb(new) ->> 'comment') = '[removed]') then
      return new;
    end if;
  end if;

  perform private.raise(
    'PL409_APPEND_ONLY',
    format('%s.%s is append-only: rows are never changed or removed.', tg_table_schema, tg_table_name)
  );
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Kill switches (§3.2)
-- ---------------------------------------------------------------------------

create table private.app_settings (
  key text primary key,
  value jsonb not null
);

insert into private.app_settings (key, value) values
  ('sync_enabled', 'true'::jsonb),
  ('overlay_enabled', 'true'::jsonb);

create function private.setting_on(p_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select s.value = 'true'::jsonb from private.app_settings s where s.key = p_key), false)
$$;

-- Seed bookkeeping (§3.4, private): one row per applied content seed.
create table private.seed_runs (
  corpus_hash text primary key,
  release_name text not null,
  run_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles and the audit log (§3.4, public)
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  age_band text not null check (age_band in ('13-17', '18+')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_contributor_id text,
  actor_kind text not null check (actor_kind in ('contributor', 'system', 'bootstrap', 'seed')),
  action text not null,
  target_type text,
  target_id text,
  detail jsonb
);

create index audit_events_at_idx on public.audit_events (at desc);
create index audit_events_target_idx on public.audit_events (target_type, target_id);

create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function private.forbid_change();
create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function private.forbid_change();

-- Records an action under the caller's contributor id. private.current_contributor_id()
-- is defined in 20260928000300_people.sql; PL/pgSQL resolves it at call time.
create function private.audit(p_action text, p_target_type text, p_target_id text, p_detail jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_contributor text := private.current_contributor_id();
begin
  insert into public.audit_events (actor_contributor_id, actor_kind, action, target_type, target_id, detail)
  values (
    v_contributor,
    case
      when v_contributor is not null then 'contributor'
      when coalesce(current_setting('polilingo.seeding', true), '') = 'on' then 'seed'
      else 'system'
    end,
    p_action,
    p_target_type,
    p_target_id,
    p_detail
  );
end $$;
