-- 20260928000400_progress_tables.sql
-- Owner: Foundation (docs/platform.md §3.4, §3.7, §3.10).
--
-- The synced learner progress: completions, activity, the XP ledger,
-- devices, preferences and the import log, with their guards. Track B
-- writes them (import_local_progress); nothing here clears progress.

-- ---------------------------------------------------------------------------
-- Release order (§3.7): mvp < content@Y.M.N (by numbers) < dev names
-- ---------------------------------------------------------------------------

-- Defined here, not in track B's migration, because the completions guard
-- needs it. Track B uses it as is.
create function private.release_sort_key(p_release text)
returns int[]
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when p_release = 'mvp' then array[0]
    when p_release ~ '^content@\d{4}\.\d{2}\.\d{1,6}$' then array[
      1,
      split_part(substr(p_release, 9), '.', 1)::int,
      split_part(substr(p_release, 9), '.', 2)::int,
      split_part(substr(p_release, 9), '.', 3)::int
    ]
    else array[2]
  end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.progress_completions (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null check (lesson_id ~ '^([a-z]{2,3}-lsn-[0-9a-f]{6}|[a-z]+/[a-z0-9-]+)$'),
  first_release text not null check (char_length(first_release) between 1 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table public.progress_activity (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null check (local_date >= date '2020-01-01'),
  count int not null check (count between 1 and 1000),
  primary key (user_id, local_date)
);

comment on column public.progress_activity.local_date is
  'The device''s local date. Never derive it from a server timestamp: that shifts streaks for travellers.';

create table public.xp_awards (
  user_id uuid not null references auth.users (id) on delete cascade,
  award_key text not null check (award_key ~ '^(lesson:[a-z0-9/-]{3,80}|session:[^\s]{1,100})$'),
  amount smallint not null check (amount in (5, 15)),
  lesson_id text,
  source text not null check (source in ('lesson', 'session')),
  created_at timestamptz not null default now(),
  primary key (user_id, award_key),
  check (
    (source = 'lesson' and amount = 15 and award_key like 'lesson:%')
    or (source = 'session' and amount = 5 and award_key like 'session:%')
  )
);

create table public.progress_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 1 and 100),
  reported_xp int not null default 0 check (reported_xp >= 0),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table public.learner_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  daily_goal smallint check (daily_goal between 1 and 3),
  selected_course text check (selected_course ~ '^[a-z]{2,20}$'),
  updated_at timestamptz not null default now()
);

create table public.progress_imports (
  user_id uuid not null references auth.users (id) on delete cascade,
  envelope_hash char(64) not null check (envelope_hash ~ '^[0-9a-f]{64}$'),
  device_id text,
  imported_at timestamptz not null default now(),
  summary jsonb,
  primary key (user_id, envelope_hash)
);

create index progress_imports_recent_idx on public.progress_imports (user_id, imported_at desc);

-- ---------------------------------------------------------------------------
-- Guards: progress only moves forward
-- ---------------------------------------------------------------------------

-- A completion's first release only moves earlier, never later.
create function private.completions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.lesson_id <> old.lesson_id then
    perform private.raise('PL409_APPEND_ONLY', 'A completion belongs to one learner and one lesson.');
  end if;
  if new.first_release <> old.first_release
     and not (private.release_sort_key(new.first_release) < private.release_sort_key(old.first_release)) then
    perform private.raise(
      'PL409_APPEND_ONLY',
      'A completion''s first release can only move earlier.',
      jsonb_build_object('lesson_id', old.lesson_id, 'first_release', old.first_release)
    );
  end if;
  return new;
end $$;

-- A day's activity count only goes up.
create function private.activity_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.local_date <> old.local_date then
    perform private.raise('PL409_APPEND_ONLY', 'An activity day belongs to one learner and one date.');
  end if;
  if new.count < old.count then
    perform private.raise(
      'PL409_APPEND_ONLY',
      'A day''s activity count only goes up.',
      jsonb_build_object('local_date', old.local_date, 'count', old.count)
    );
  end if;
  return new;
end $$;

-- A device's reported XP only goes up.
create function private.devices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.device_id <> old.device_id then
    perform private.raise('PL409_APPEND_ONLY', 'A device row belongs to one learner and one device.');
  end if;
  if new.reported_xp < old.reported_xp then
    perform private.raise(
      'PL409_APPEND_ONLY',
      'A device''s reported XP only goes up.',
      jsonb_build_object('device_id', old.device_id, 'reported_xp', old.reported_xp)
    );
  end if;
  return new;
end $$;

create trigger progress_completions_guard before update on public.progress_completions
  for each row execute function private.completions_guard();
create trigger progress_activity_guard before update on public.progress_activity
  for each row execute function private.activity_guard();
create trigger progress_devices_guard before update on public.progress_devices
  for each row execute function private.devices_guard();

-- Append-only except for the caller's own account deletion.
create trigger xp_awards_append_only before update or delete on public.xp_awards
  for each row execute function private.forbid_change('user_owned');
create trigger xp_awards_no_truncate before truncate on public.xp_awards
  for each statement execute function private.forbid_change();
create trigger progress_imports_append_only before update or delete on public.progress_imports
  for each row execute function private.forbid_change('user_owned');
create trigger progress_imports_no_truncate before truncate on public.progress_imports
  for each statement execute function private.forbid_change();
