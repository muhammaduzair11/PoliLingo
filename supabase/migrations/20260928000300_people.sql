-- 20260928000300_people.sql
-- Owner: Foundation (docs/platform.md §3.4, §3.6, §3.10).
--
-- Contributors, their private details, role grants and invitations; the
-- access helpers every policy and function uses (§3.6); my_context() and
-- bootstrap_first_admin().

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- ctr-0001..ctr-0105 are reserved for seeds; the app mints from 106.
create sequence private.contributor_seq start 106;

create table public.contributors (
  id text primary key
    default ('ctr-' || lpad(nextval('private.contributor_seq')::text, 4, '0'))
    check (id ~ '^ctr-[0-9]{4}$'),
  user_id uuid unique references auth.users (id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 60),
  attribution_name text check (attribution_name is null or char_length(attribution_name) between 1 and 60),
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  created_at timestamptz not null default now(),
  created_by text
);

create table public.contributor_private (
  contributor_id text primary key references public.contributors (id) on delete cascade,
  legal_name text,
  contact_email text,
  phone text,
  whatsapp text,
  region text,
  engagement_ref text,
  age_verified_note text,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  role text not null check (role in ('admin', 'editor', 'language_reviewer')),
  language_code text references content.languages (code),
  variety_id text,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  display_name text check (display_name is null or char_length(display_name) between 1 and 60),
  note text,
  grant_ends_at timestamptz,
  created_by text not null references public.contributors (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user uuid references auth.users (id) on delete set null,
  accepted_contributor_id text references public.contributors (id),
  grant_id uuid,
  revoked_at timestamptz,
  revoked_by text,
  foreign key (variety_id, language_code) references content.varieties (id, language_code),
  check ((role = 'language_reviewer') = (variety_id is not null)),
  check (role <> 'language_reviewer' or language_code is not null),
  check (role <> 'admin' or (language_code is null and variety_id is null)),
  check (expires_at <= created_at + interval '30 days')
);

create table public.role_grants (
  id uuid primary key default gen_random_uuid(),
  contributor_id text not null references public.contributors (id),
  role text not null check (role in ('admin', 'editor', 'language_reviewer')),
  language_code text references content.languages (code),
  variety_id text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  invitation_id uuid references public.invitations (id),
  granted_by text,
  revoked_by text,
  revoke_reason text,
  foreign key (variety_id, language_code) references content.varieties (id, language_code),
  check ((role = 'language_reviewer') = (variety_id is not null)),
  check (role <> 'language_reviewer' or language_code is not null),
  check (role <> 'admin' or (language_code is null and variety_id is null)),
  check (ends_at is null or ends_at > starts_at)
);

create index role_grants_contributor_idx on public.role_grants (contributor_id);
create index role_grants_variety_idx on public.role_grants (variety_id) where variety_id is not null;

alter table public.invitations
  add constraint invitations_grant_fkey foreign key (grant_id) references public.role_grants (id);

-- Contributor references from content (contributors are never deleted).
alter table content.review_decisions
  add constraint review_decisions_reviewer_fkey foreign key (reviewer_contributor_id) references public.contributors (id),
  add constraint review_decisions_grant_fkey foreign key (grant_id) references public.role_grants (id);
alter table content.countersignatures
  add constraint countersignatures_admin_fkey foreign key (admin_contributor_id) references public.contributors (id),
  add constraint countersignatures_grant_fkey foreign key (grant_id) references public.role_grants (id);
alter table content.suggestions
  add constraint suggestions_suggester_fkey foreign key (suggester_contributor_id) references public.contributors (id);
alter table content.review_comments
  add constraint review_comments_author_fkey foreign key (author_contributor_id) references public.contributors (id);

-- ---------------------------------------------------------------------------
-- Role grant guards
-- ---------------------------------------------------------------------------

-- A grant is never deleted. After insert only ends_at (to a time not in the
-- past, and only while the grant has not ended) and the revoke fields change.
create function private.role_grants_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.raise('PL409_APPEND_ONLY', 'Role grants are never deleted. End one instead.');
  end if;
  if (to_jsonb(new) - array['ends_at', 'revoked_by', 'revoke_reason'])
     <> (to_jsonb(old) - array['ends_at', 'revoked_by', 'revoke_reason']) then
    perform private.raise('PL409_APPEND_ONLY', 'Only a grant''s end date and revoke details can change.');
  end if;
  if new.ends_at is distinct from old.ends_at then
    if old.ends_at is not null and old.ends_at <= now() then
      perform private.raise('PL409_ALREADY_ENDED', 'This role has already ended.', jsonb_build_object('grant_id', old.id));
    end if;
    if new.ends_at is null or new.ends_at < now() then
      perform private.raise('PL422_BAD_DATE', 'A role can end now or later, not in the past.', jsonb_build_object('grant_id', old.id));
    end if;
  end if;
  return new;
end $$;

-- An admin never also holds a reviewer role (non-negotiable 6).
-- Grant inserts for one contributor are serialised first: without the lock,
-- two transactions inserting an admin and a reviewer grant at the same time
-- (two invitations accepted at once) would each miss the other's uncommitted
-- row. Under READ COMMITTED the check below runs with a fresh snapshot after
-- the lock is granted, so the second one sees the first grant and is refused.
create function private.role_grants_conflict()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('polilingo.role_grants:' || new.contributor_id, 0)
  );
  if new.role in ('admin', 'language_reviewer') and exists (
    select 1
    from public.role_grants g
    where g.contributor_id = new.contributor_id
      and g.id <> new.id
      and g.role = case new.role when 'admin' then 'language_reviewer' else 'admin' end
      and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
  ) then
    perform private.raise(
      'PL409_ROLE_CONFLICT',
      'An admin can''t also be a reviewer. End one role before granting the other.',
      jsonb_build_object('contributor_id', new.contributor_id)
    );
  end if;
  return new;
end $$;

create trigger role_grants_guard before update or delete on public.role_grants
  for each row execute function private.role_grants_guard();
create trigger role_grants_conflict before insert on public.role_grants
  for each row execute function private.role_grants_conflict();
create trigger role_grants_no_truncate before truncate on public.role_grants
  for each statement execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Helpers (§3.6). SECURITY DEFINER, stable, search_path pinned. A staff
-- grant counts only when the contributor is active, the profile is 18+,
-- and starts_at <= now() < coalesce(ends_at, 'infinity').
-- ---------------------------------------------------------------------------

create function private.current_contributor_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.contributors c where c.user_id = (select auth.uid())
$$;

-- The caller's active staff grants. Internal: called only by other definer functions.
create function private.my_active_grants()
returns setof public.role_grants
language sql
stable
security definer
set search_path = ''
as $$
  select g.*
  from public.role_grants g
  join public.contributors c on c.id = g.contributor_id
  join public.profiles p on p.user_id = c.user_id
  where c.user_id = (select auth.uid())
    and c.status = 'active'
    and p.age_band = '18+'
    and g.starts_at <= now()
    and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.my_active_grants() g where g.role = 'admin')
$$;

create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.my_active_grants())
$$;

-- Admin, or an editor unscoped or scoped to that language.
create function private.can_edit_language(p_language text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.my_active_grants() g
    where g.role = 'admin'
      or (g.role = 'editor' and (g.language_code is null or g.language_code = p_language))
  )
$$;

-- The caller's active reviewer grant for a variety, or null.
create function private.review_grant_for(p_variety text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.id
  from private.my_active_grants() g
  where g.role = 'language_reviewer' and g.variety_id = p_variety
  order by g.starts_at, g.id
  limit 1
$$;

create function private.has_review_authority(p_variety text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.review_grant_for(p_variety) is not null
$$;

-- How many people can review a variety right now (anyone, not only the caller).
create function private.active_reviewer_count(p_variety text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct c.id)::int
  from public.role_grants g
  join public.contributors c on c.id = g.contributor_id
  join public.profiles p on p.user_id = c.user_id
  where g.role = 'language_reviewer'
    and g.variety_id = p_variety
    and c.status = 'active'
    and p.age_band = '18+'
    and g.starts_at <= now()
    and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
$$;

-- Admin: every variety; editor: their language's (all if unscoped);
-- reviewer: their varieties. Empty for everyone else.
create function private.readable_varieties()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(v.id order by v.id collate "C"), '{}')
  from content.varieties v
  where exists (
    select 1
    from private.my_active_grants() g
    where g.role = 'admin'
      or (g.role = 'editor' and (g.language_code is null or g.language_code = v.language_code))
      or (g.role = 'language_reviewer' and g.variety_id = v.id)
  )
$$;

-- Who a content change is recorded against: the caller, or the suggester
-- while accept_suggestion applies a suggestion (it sets polilingo.change_author).
create function private.change_author()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('polilingo.change_author', true), ''),
    private.current_contributor_id()
  )
$$;

-- ---------------------------------------------------------------------------
-- my_context (§3.6)
-- ---------------------------------------------------------------------------

create function public.my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_contributor public.contributors%rowtype;
  v_editor jsonb;
begin
  if v_uid is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;

  select * into v_contributor from public.contributors c where c.user_id = v_uid;

  select case
    when bool_or(g.role = 'admin' or (g.role = 'editor' and g.language_code is null)) then to_jsonb('all'::text)
    else coalesce(
      jsonb_agg(distinct g.language_code) filter (where g.role = 'editor' and g.language_code is not null),
      '[]'::jsonb
    )
  end
  into v_editor
  from private.my_active_grants() g;

  return jsonb_build_object(
    'user_id', v_uid,
    'email', (select u.email from auth.users u where u.id = v_uid),
    'profile', (
      select jsonb_build_object('age_band', p.age_band)
      from public.profiles p
      where p.user_id = v_uid
    ),
    'contributor', case
      when v_contributor.id is null then null
      else jsonb_build_object('id', v_contributor.id, 'display_name', v_contributor.display_name)
    end,
    'is_admin', private.is_admin(),
    'editor_languages', coalesce(v_editor, '[]'::jsonb),
    'review_varieties', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'language', v.language_code, 'name', v.name) order by v.id collate "C")
      from content.varieties v
      where exists (
        select 1 from private.my_active_grants() g
        where g.role = 'language_reviewer' and g.variety_id = v.id
      )
    ), '[]'::jsonb),
    'sole_reviewer_varieties', coalesce((
      select jsonb_agg(v.id order by v.id collate "C")
      from content.varieties v
      where exists (
        select 1 from private.my_active_grants() g
        where g.role = 'language_reviewer' and g.variety_id = v.id
      )
      and private.active_reviewer_count(v.id) = 1
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- bootstrap_first_admin (§3.6). No grants: run once in the SQL editor.
-- ---------------------------------------------------------------------------

create function private.bootstrap_first_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_band text;
  v_contributor text;
  v_grant uuid;
begin
  if session_user = 'authenticator' then
    perform private.raise('PL403_NOT_ADMIN', 'Run this once in the Supabase SQL editor, not through the API.');
  end if;

  perform pg_advisory_xact_lock(hashtext('polilingo.bootstrap_first_admin'));

  if exists (
    select 1
    from public.role_grants g
    join public.contributors c on c.id = g.contributor_id
    where g.role = 'admin'
      and c.status = 'active'
      and g.starts_at <= now()
      and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
  ) then
    perform private.raise('PL409_ADMIN_EXISTS', 'An admin already exists. Ask them to invite you.');
  end if;

  select u.id into v_user
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  order by u.created_at
  limit 1;
  if v_user is null then
    perform private.raise('PL404_NOT_FOUND', 'No account uses that email. Sign in once with it first.');
  end if;

  select p.age_band into v_band from public.profiles p where p.user_id = v_user;
  if v_band is null then
    perform private.raise('PL403_NO_PROFILE', 'That account has no profile yet. Finish signing in once first.');
  end if;
  if v_band <> '18+' then
    perform private.raise('PL403_UNDER_18', 'Staff roles are for adults only.');
  end if;

  select c.id into v_contributor from public.contributors c where c.user_id = v_user;
  if v_contributor is null then
    insert into public.contributors (user_id, display_name, created_by)
    values (v_user, left(split_part(lower(btrim(p_email)), '@', 1), 60), null)
    returning id into v_contributor;
  else
    update public.contributors set status = 'active' where id = v_contributor;
  end if;

  insert into public.contributor_private (contributor_id, contact_email)
  values (v_contributor, lower(btrim(p_email)))
  on conflict (contributor_id) do nothing;

  insert into public.role_grants (contributor_id, role)
  values (v_contributor, 'admin')
  returning id into v_grant;

  insert into public.audit_events (actor_contributor_id, actor_kind, action, target_type, target_id, detail)
  values (v_contributor, 'bootstrap', 'admin.bootstrap', 'contributor', v_contributor,
          jsonb_build_object('grant_id', v_grant));

  return v_contributor;
end $$;
