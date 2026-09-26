-- 20260928001100_sync.sql
-- Owner: Track B, Sync (docs/platform.md §3.7, §3.9 B, §4.9).
--
-- A signed-in learner's device sends its local progress as a
-- polilingo.sync@1 envelope; the database merges it into the account and
-- answers with the account's whole state, which the device merges back.
-- Every part of the merge only grows: completions are a union keeping the
-- earliest release, activity takes each day's maximum, XP awards are
-- inserted if absent, a device's reported XP only rises, and preferences
-- are filled in only where the account has none. So replaying an envelope,
-- or two devices syncing in any order, always lands on the same state, and
-- nothing a device sends can take progress away.
--
-- Functions only; the tables, guards, grants and policies are the
-- foundation's (…000400_progress_tables.sql, …000500_access.sql).

-- ---------------------------------------------------------------------------
-- Private helpers (no grants: they take a user id, so only the definer
-- functions below may call them)
-- ---------------------------------------------------------------------------

-- The key a completion is stored under, the same key the device keeps
-- (lib/progress.ts fromLegacyKey): a permanent lesson id as it is; an MVP
-- "course/lesson" key moved to the lesson's permanent id when the keymap
-- maps it to a lesson in the latest release, which is the keymap the
-- learner copy carries; any other key kept as it is. So while Hindko is
-- held back, "hindko/greetings" stays "hindko/greetings" here as on the
-- device, although the full keymap already has a row for it.
create function private.resolve_lesson_key(p_key text)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select case
    when p_key ~ '^[a-z]{2,3}-lsn-[0-9a-f]{6}$' then p_key
    else coalesce(
      (select k.lesson_id
       from content.keymap_lessons k
       where k.legacy_key = p_key
         and exists (
           select 1 from content.release_lessons rl
           where rl.lesson_id = k.lesson_id
             and rl.release_seq = (select max(r.seq) from content.releases r)
         )),
      p_key
    )
  end
$$;

comment on function private.resolve_lesson_key(text) is
  'The stored key for a completion: a permanent lesson id, an MVP key''s lesson id when the latest release has that lesson, or the key itself.';

-- The lesson a completion pays its 15 XP for: an MVP key's lesson id by the
-- whole keymap, released or not. So "hindko/greetings" (stored as it is
-- while Hindko is held back) and, after a later release, its permanent id
-- share one award: the account never pays for one lesson twice.
create function private.award_lesson_key(p_key text)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select case
    when p_key ~ '^[a-z]{2,3}-lsn-[0-9a-f]{6}$' then p_key
    else coalesce(
      (select k.lesson_id from content.keymap_lessons k where k.legacy_key = p_key),
      p_key
    )
  end
$$;

comment on function private.award_lesson_key(text) is
  'The lesson a completion''s 15 XP award is keyed by: a permanent lesson id, any mapped MVP key''s lesson id, or the key itself.';

-- XP (§3.7): the award ledger's sum, or the most any one device has reported,
-- whichever is greater. Both only grow, so XP never decreases.
create function private.xp_total(p_user uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select greatest(
    coalesce((select sum(a.amount)::int from public.xp_awards a where a.user_id = p_user), 0),
    coalesce((select max(d.reported_xp) from public.progress_devices d where d.user_id = p_user), 0)
  )
$$;

-- The account's progress in the shape the device merges:
-- { xp, completed: {lesson: release}, activity: {date: n}, rewarded: [session
-- ids], dailyGoal, selected }. Ordered, so the same state is the same JSON.
create function private.progress_state(p_user uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'xp', private.xp_total(p_user),
    -- Keys as the device holds them now: a legacy key stored while its
    -- lesson was held back comes back as the lesson's id once the latest
    -- release has it, merged with that id's own row (the earlier release wins).
    'completed', coalesce(
      (select jsonb_object_agg(k.lesson, k.first_release order by k.lesson collate "C")
       from (
         select distinct on (r.lesson) r.lesson, r.first_release
         from (
           select private.resolve_lesson_key(c.lesson_id) as lesson, c.first_release
           from public.progress_completions c
           where c.user_id = p_user
         ) r
         order by r.lesson, private.release_sort_key(r.first_release), r.first_release collate "C"
       ) k),
      '{}'::jsonb
    ),
    'activity', coalesce(
      (select jsonb_object_agg(to_char(a.local_date, 'YYYY-MM-DD'), a.count order by a.local_date)
       from public.progress_activity a where a.user_id = p_user),
      '{}'::jsonb
    ),
    'rewarded', coalesce(
      (select jsonb_agg(substr(x.award_key, 9) order by x.created_at, x.award_key collate "C")
       from public.xp_awards x where x.user_id = p_user and x.source = 'session'),
      '[]'::jsonb
    ),
    'dailyGoal', (select to_jsonb(p.daily_goal) from public.learner_prefs p where p.user_id = p_user),
    'selected', (select to_jsonb(p.selected_course) from public.learner_prefs p where p.user_id = p_user)
  )
$$;

-- Refuses an envelope that is not a well-formed polilingo.sync@1 (§3.7):
-- only the known fields; integers written as integers (a canonical hash of
-- 65.0 would not match the device's 65); every key ASCII, which the key
-- patterns guarantee; the size limits; real calendar dates.
create function private.check_sync_envelope(p jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_int constant text := '^(0|[1-9][0-9]{0,9})$';
  v_date constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_bad text;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.raise('PL422_BAD_ENVELOPE', 'The progress envelope must be a JSON object.');
  end if;

  select k into v_bad from jsonb_object_keys(p) k
  where k not in ('format', 'deviceId', 'localDate', 'xp', 'completed', 'activity', 'rewarded', 'dailyGoal', 'selected')
  limit 1;
  if v_bad is not null then
    perform private.raise('PL422_BAD_ENVELOPE', 'The progress envelope has a field it should not.', jsonb_build_object('field', left(v_bad, 40)));
  end if;

  if p -> 'format' is distinct from to_jsonb('polilingo.sync@1'::text) then
    perform private.raise('PL422_BAD_ENVELOPE', 'The progress envelope is not polilingo.sync@1.');
  end if;

  if jsonb_typeof(p -> 'deviceId') is distinct from 'string'
     or char_length(p ->> 'deviceId') not between 1 and 100 then
    perform private.raise('PL422_BAD_ENVELOPE', 'The device id must be 1 to 100 characters.');
  end if;

  if jsonb_typeof(p -> 'localDate') is distinct from 'string' or (p ->> 'localDate') !~ v_date then
    perform private.raise('PL422_BAD_ENVELOPE', 'The local date must be YYYY-MM-DD.');
  end if;

  if jsonb_typeof(p -> 'xp') is distinct from 'number'
     or (p -> 'xp')::text !~ v_int
     or (p -> 'xp')::text::bigint > 10000000 then
    perform private.raise('PL422_BAD_ENVELOPE', 'XP must be a whole number from 0 to 10,000,000.');
  end if;

  if p ? 'dailyGoal' and jsonb_typeof(p -> 'dailyGoal') <> 'null'
     and (p -> 'dailyGoal')::text not in ('1', '2', '3') then
    perform private.raise('PL422_BAD_ENVELOPE', 'The daily goal must be 1, 2 or 3.');
  end if;

  if p ? 'selected' and jsonb_typeof(p -> 'selected') <> 'null'
     and (jsonb_typeof(p -> 'selected') <> 'string' or (p ->> 'selected') !~ '^[a-z]{2,20}$') then
    perform private.raise('PL422_BAD_ENVELOPE', 'The selected course must be a course slug.');
  end if;

  -- Completions: { lesson key: release it was first completed in }.
  if jsonb_typeof(p -> 'completed') is distinct from 'object' then
    perform private.raise('PL422_BAD_ENVELOPE', 'Completions must be an object.');
  end if;
  if (select count(*) from jsonb_object_keys(p -> 'completed')) > 5000 then
    perform private.raise('PL422_BAD_ENVELOPE', 'An envelope holds at most 5,000 completions.');
  end if;
  select e.key into v_bad from jsonb_each(p -> 'completed') e
  where e.key !~ '^([a-z]{2,3}-lsn-[0-9a-f]{6}|[a-z]+/[a-z0-9-]+)$'
     or char_length(e.key) > 80
     or jsonb_typeof(e.value) <> 'string'
     or (e.value #>> '{}') !~ '^[!-~]{1,100}$'
  limit 1;
  if v_bad is not null then
    perform private.raise('PL422_BAD_ENVELOPE', 'A completion has a malformed lesson key or release.', jsonb_build_object('lesson', left(v_bad, 80)));
  end if;

  -- Activity: { local date: lessons finished that day }.
  if jsonb_typeof(p -> 'activity') is distinct from 'object' then
    perform private.raise('PL422_BAD_ENVELOPE', 'Activity must be an object.');
  end if;
  if (select count(*) from jsonb_object_keys(p -> 'activity')) > 3000 then
    perform private.raise('PL422_BAD_ENVELOPE', 'An envelope holds at most 3,000 activity days.');
  end if;
  select e.key into v_bad from jsonb_each(p -> 'activity') e
  where e.key !~ v_date
     or jsonb_typeof(e.value) <> 'number'
     or e.value::text !~ v_int
     or e.value::text::bigint not between 1 and 1000
  limit 1;
  if v_bad is not null then
    perform private.raise('PL422_BAD_ENVELOPE', 'Activity days are YYYY-MM-DD with a count from 1 to 1,000.', jsonb_build_object('date', left(v_bad, 40)));
  end if;

  -- Real dates, from 2020 on (one subtransaction for all of them).
  begin
    select k into v_bad
    from (select p ->> 'localDate' as k union all select jsonb_object_keys(p -> 'activity')) d
    where d.k::date < date '2020-01-01' or d.k::date >= date '2100-01-01'
    limit 1;
  exception when datetime_field_overflow or invalid_datetime_format then
    v_bad := 'not a date';
  end;
  if v_bad is not null then
    perform private.raise('PL422_BAD_ENVELOPE', 'A date in the envelope is not a real date from 2020 on.', jsonb_build_object('date', left(v_bad, 40)));
  end if;

  -- Rewarded session ids.
  if jsonb_typeof(p -> 'rewarded') is distinct from 'array' then
    perform private.raise('PL422_BAD_ENVELOPE', 'Rewarded sessions must be an array.');
  end if;
  if jsonb_array_length(p -> 'rewarded') > 10000 then
    perform private.raise('PL422_BAD_ENVELOPE', 'An envelope holds at most 10,000 rewarded sessions.');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p -> 'rewarded') r
    where jsonb_typeof(r) <> 'string' or (r #>> '{}') !~ '^\S{1,100}$'
  ) then
    perform private.raise('PL422_BAD_ENVELOPE', 'A rewarded session id is malformed.');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- API
-- ---------------------------------------------------------------------------

create function public.import_local_progress(p_envelope jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_device text;
  v_completions int;
  v_activity int;
  v_awards int;
  v_before int;
  -- What one account may hold in total (§3.7). The envelope limits cap one
  -- import; these stop an account growing without end across imports, so
  -- no account can fill the shared database. Far above a real learner: the
  -- releases hold dozens of lessons, and at twenty sessions a day 20,000
  -- takes years.
  c_max_completions constant int := 5000;
  c_max_sessions constant int := 20000;
  c_max_devices constant int := 20;
begin
  if v_uid is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in to save your progress.');
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = v_uid) then
    perform private.raise('PL403_NO_PROFILE', 'Tell us your age band first, then try again.');
  end if;
  if not private.setting_on('sync_enabled') then
    perform private.raise('PL460_SYNC_DISABLED', 'Saving progress to accounts is paused for now.');
  end if;

  perform private.check_sync_envelope(p_envelope);

  -- One import at a time per learner, so two tabs cannot interleave.
  perform pg_advisory_xact_lock(hashtextextended('polilingo.sync:' || v_uid::text, 0));

  v_hash := encode(sha256(convert_to(private.canonical_json(p_envelope), 'UTF8')), 'hex');
  if exists (select 1 from public.progress_imports i where i.user_id = v_uid and i.envelope_hash = v_hash) then
    return private.progress_state(v_uid) || jsonb_build_object('applied', false, 'envelope_hash', v_hash);
  end if;

  if (select count(*) from public.progress_imports i
      where i.user_id = v_uid and i.imported_at > now() - interval '1 hour') >= 120 then
    perform private.raise('PL429_RATE_LIMITED', 'Too many progress saves in the last hour.');
  end if;

  -- The account-wide limits: what the account holds plus what this envelope
  -- would add. An account at a limit still syncs everything it already has.
  if (select count(*) from public.progress_completions c where c.user_id = v_uid)
     + (select count(distinct private.resolve_lesson_key(k))
        from jsonb_object_keys(p_envelope -> 'completed') k
        where not exists (
          select 1 from public.progress_completions c
          where c.user_id = v_uid and c.lesson_id = private.resolve_lesson_key(k)
        )) > c_max_completions then
    perform private.raise(
      'PL422_BAD_ENVELOPE',
      'This account already holds the most lessons it can.',
      jsonb_build_object('limit', c_max_completions)
    );
  end if;
  if (select count(*) from public.xp_awards a where a.user_id = v_uid and a.source = 'session')
     + (select count(distinct r #>> '{}')
        from jsonb_array_elements(p_envelope -> 'rewarded') r
        where not exists (
          select 1 from public.xp_awards a
          where a.user_id = v_uid and a.award_key = 'session:' || (r #>> '{}')
        )) > c_max_sessions then
    perform private.raise(
      'PL422_BAD_ENVELOPE',
      'This account already holds the most practice sessions it can.',
      jsonb_build_object('limit', c_max_sessions)
    );
  end if;

  v_device := p_envelope ->> 'deviceId';
  -- A new device past the device limit is folded into the account's
  -- leading device (the highest reported XP), which keeps the account's XP
  -- exactly the same: it is the most any device reported either way.
  if not exists (select 1 from public.progress_devices d where d.user_id = v_uid and d.device_id = v_device)
     and (select count(*) from public.progress_devices d where d.user_id = v_uid) >= c_max_devices then
    select d.device_id into v_device
    from public.progress_devices d
    where d.user_id = v_uid
    order by d.reported_xp desc, d.device_id collate "C"
    limit 1;
  end if;
  v_before := private.xp_total(v_uid);

  -- Completions: a union. Two keys for one lesson (an MVP key and its
  -- permanent id) keep the earlier release; an existing row only moves to an
  -- earlier release (the foundation's guard enforces the same).
  with incoming as (
    select distinct on (lesson_id) lesson_id, release
    from (
      select private.resolve_lesson_key(e.key) as lesson_id, e.value #>> '{}' as release
      from jsonb_each(p_envelope -> 'completed') e
    ) r
    order by lesson_id, private.release_sort_key(release), release collate "C"
  )
  insert into public.progress_completions as c (user_id, lesson_id, first_release)
  select v_uid, i.lesson_id, i.release from incoming i
  on conflict (user_id, lesson_id) do update
    set first_release = excluded.first_release, updated_at = now()
    where private.release_sort_key(excluded.first_release) < private.release_sort_key(c.first_release);
  get diagnostics v_completions = row_count;

  -- Activity: each day's maximum, never a sum (the same lesson reported by
  -- two syncs of one device must not count twice).
  insert into public.progress_activity as a (user_id, local_date, count)
  select v_uid, e.key::date, (e.value #>> '{}')::int
  from jsonb_each(p_envelope -> 'activity') e
  on conflict (user_id, local_date) do update
    set count = excluded.count
    where excluded.count > a.count;
  get diagnostics v_activity = row_count;

  -- The award ledger: 15 per completed lesson, 5 per rewarded session,
  -- inserted if absent. Amounts come from here, never from the device. A
  -- lesson's award is keyed by its id through the whole keymap
  -- (private.award_lesson_key), so one lesson pays once under any key.
  -- Only this envelope's lessons: every stored completion came in through
  -- an envelope and got its award then.
  with added as (
    insert into public.xp_awards (user_id, award_key, amount, lesson_id, source)
    select distinct v_uid, 'lesson:' || l.lesson, 15, l.lesson, 'lesson'
    from (
      select private.award_lesson_key(private.resolve_lesson_key(k)) as lesson
      from jsonb_object_keys(p_envelope -> 'completed') k
    ) l
    union all
    select distinct v_uid, 'session:' || (r #>> '{}'), 5, null, 'session'
    from jsonb_array_elements(p_envelope -> 'rewarded') r
    on conflict (user_id, award_key) do nothing
    returning 1
  )
  select count(*) into v_awards from added;

  -- The device's own XP: the most it has ever reported.
  insert into public.progress_devices as d (user_id, device_id, reported_xp, last_seen_at)
  values (v_uid, v_device, (p_envelope ->> 'xp')::int, now())
  on conflict (user_id, device_id) do update
    set reported_xp = greatest(d.reported_xp, excluded.reported_xp), last_seen_at = now();

  -- Preferences: filled in where the account has none, never overwritten.
  insert into public.learner_prefs as l (user_id, daily_goal, selected_course)
  values (v_uid, (p_envelope ->> 'dailyGoal')::smallint, p_envelope ->> 'selected')
  on conflict (user_id) do update
    set daily_goal = coalesce(l.daily_goal, excluded.daily_goal),
        selected_course = coalesce(l.selected_course, excluded.selected_course),
        updated_at = now()
    where (l.daily_goal is null and excluded.daily_goal is not null)
       or (l.selected_course is null and excluded.selected_course is not null);

  insert into public.progress_imports (user_id, envelope_hash, device_id, summary)
  values (
    v_uid,
    v_hash,
    p_envelope ->> 'deviceId',
    jsonb_build_object(
      'local_date', p_envelope ->> 'localDate',
      'completed', (select count(*) from jsonb_object_keys(p_envelope -> 'completed')),
      'rewarded', jsonb_array_length(p_envelope -> 'rewarded'),
      'activity_days', (select count(*) from jsonb_object_keys(p_envelope -> 'activity')),
      'completions_changed', v_completions,
      'activity_changed', v_activity,
      'awards_added', v_awards,
      'xp_before', v_before,
      'xp_after', private.xp_total(v_uid)
    )
  );

  return private.progress_state(v_uid) || jsonb_build_object('applied', true, 'envelope_hash', v_hash);
end $$;

comment on function public.import_local_progress(jsonb) is
  'Merges a polilingo.sync@1 envelope into the caller''s account and returns the account''s state plus {applied, envelope_hash}. Replaying an envelope changes nothing (docs/platform.md §3.7).';

create function public.get_my_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in to see your saved progress.');
  end if;
  return private.progress_state(v_uid);
end $$;

comment on function public.get_my_progress() is
  'The caller''s account progress: { xp, completed, activity, rewarded, dailyGoal, selected } (docs/platform.md §3.7).';

-- ---------------------------------------------------------------------------
-- Grants: the two API functions to signed-in users; the helpers to nobody
-- ---------------------------------------------------------------------------

revoke execute on function
  private.resolve_lesson_key(text),
  private.award_lesson_key(text),
  private.xp_total(uuid),
  private.progress_state(uuid),
  private.check_sync_envelope(jsonb),
  public.import_local_progress(jsonb),
  public.get_my_progress()
from public, anon, authenticated;

grant execute on function
  public.import_local_progress(jsonb),
  public.get_my_progress()
to authenticated;
