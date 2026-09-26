-- 20260928001000_accounts.sql
-- Owner: Track A, accounts and legal (docs/platform.md §1, §3.9 A).
--
-- A signed-in person's own account: their age band (ensure_profile,
-- set_age_band), a copy of everything held about them (export_my_data) and
-- deleting it (delete_my_account); plus the daily purge of sign-ins that
-- never finished the age question (private.purge_profileless_users).
--
-- Functions only. Checks run in the §3.2 order: 401 → profile/age → role →
-- 422 input → 404 → scope 403 → 409 state.

-- ---------------------------------------------------------------------------
-- ensure_profile: the age band a person declared before signing in
-- ---------------------------------------------------------------------------

-- Creates the caller's profile when there is none. An existing profile is
-- returned unchanged (set_age_band changes it), so calling this again after
-- every sign-in is harmless.
create function public.ensure_profile(p_age_band text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_created boolean := false;
begin
  if v_uid is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if p_age_band is null or p_age_band not in ('13-17', '18+') then
    perform private.raise('PL422_BAD_AGE_BAND', 'Choose 13 to 17, or 18 or over.');
  end if;

  insert into public.profiles (user_id, age_band)
  values (v_uid, p_age_band)
  on conflict (user_id) do nothing
  returning * into v_profile;
  v_created := v_profile.user_id is not null;
  if not v_created then
    select * into v_profile from public.profiles p where p.user_id = v_uid;
  end if;

  return jsonb_build_object(
    'age_band', v_profile.age_band,
    'created', v_created,
    'created_at', v_profile.created_at
  );
end $$;

-- ---------------------------------------------------------------------------
-- set_age_band: the caller changes their own band
-- ---------------------------------------------------------------------------

-- A team member (any active staff grant) cannot declare 13-17: staff roles
-- are for adults, and a band that quietly switched their roles off would
-- hide the problem instead of saying it.
create function public.set_age_band(p_age_band text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current text;
begin
  if v_uid is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  select p.age_band into v_current from public.profiles p where p.user_id = v_uid for update;
  if v_current is null then
    perform private.raise('PL403_NO_PROFILE', 'Tell us your age band first.');
  end if;
  if p_age_band is null or p_age_band not in ('13-17', '18+') then
    perform private.raise('PL422_BAD_AGE_BAND', 'Choose 13 to 17, or 18 or over.');
  end if;
  if p_age_band = '13-17' and private.is_staff() then
    perform private.raise('PL409_STAFF_AGE', 'Team members need to be 18 or over.');
  end if;

  if p_age_band <> v_current then
    update public.profiles
    set age_band = p_age_band, updated_at = now()
    where user_id = v_uid;
  end if;

  return jsonb_build_object('age_band', p_age_band, 'changed', p_age_band <> v_current);
end $$;

-- ---------------------------------------------------------------------------
-- export_my_data: everything held about the caller, as one JSON document
-- ---------------------------------------------------------------------------

create function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ctr text;
begin
  if v_uid is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  select c.id into v_ctr from public.contributors c where c.user_id = v_uid;

  return jsonb_build_object(
    'format', 'polilingo.account-export@1',
    'exported_at', now(),
    'account', (
      select jsonb_build_object(
        'email', u.email,
        'email_confirmed_at', u.email_confirmed_at,
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at
      )
      from auth.users u where u.id = v_uid
    ),
    'profile', (
      select jsonb_build_object('age_band', p.age_band, 'created_at', p.created_at, 'updated_at', p.updated_at)
      from public.profiles p where p.user_id = v_uid
    ),
    'progress', jsonb_build_object(
      'completions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'lesson_id', x.lesson_id, 'first_release', x.first_release, 'updated_at', x.updated_at
        ) order by x.lesson_id collate "C")
        from public.progress_completions x where x.user_id = v_uid
      ), '[]'::jsonb),
      'activity', coalesce((
        select jsonb_agg(jsonb_build_object('local_date', x.local_date, 'count', x.count) order by x.local_date)
        from public.progress_activity x where x.user_id = v_uid
      ), '[]'::jsonb),
      'xp_awards', coalesce((
        select jsonb_agg(jsonb_build_object(
          'award_key', x.award_key, 'amount', x.amount, 'lesson_id', x.lesson_id,
          'source', x.source, 'created_at', x.created_at
        ) order by x.created_at, x.award_key collate "C")
        from public.xp_awards x where x.user_id = v_uid
      ), '[]'::jsonb),
      'devices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'device_id', x.device_id, 'reported_xp', x.reported_xp, 'last_seen_at', x.last_seen_at
        ) order by x.device_id collate "C")
        from public.progress_devices x where x.user_id = v_uid
      ), '[]'::jsonb),
      'prefs', (
        select jsonb_build_object(
          'daily_goal', x.daily_goal, 'selected_course', x.selected_course, 'updated_at', x.updated_at
        )
        from public.learner_prefs x where x.user_id = v_uid
      ),
      'imports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'envelope_hash', x.envelope_hash, 'device_id', x.device_id,
          'imported_at', x.imported_at, 'summary', x.summary
        ) order by x.imported_at, x.envelope_hash)
        from public.progress_imports x where x.user_id = v_uid
      ), '[]'::jsonb)
    ),
    'contributor', (
      select jsonb_build_object(
        'id', c.id, 'display_name', c.display_name, 'attribution_name', c.attribution_name,
        'status', c.status, 'created_at', c.created_at,
        'private', (
          select jsonb_build_object(
            'legal_name', cp.legal_name, 'contact_email', cp.contact_email, 'phone', cp.phone,
            'whatsapp', cp.whatsapp, 'region', cp.region, 'engagement_ref', cp.engagement_ref,
            'age_verified_note', cp.age_verified_note, 'notes', cp.notes, 'updated_at', cp.updated_at
          )
          from public.contributor_private cp where cp.contributor_id = c.id
        )
      )
      from public.contributors c where c.id = v_ctr
    ),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'role', g.role, 'language', g.language_code, 'variety', g.variety_id,
        'starts_at', g.starts_at, 'ends_at', g.ends_at, 'revoke_reason', g.revoke_reason
      ) order by g.starts_at, g.id)
      from public.role_grants g where g.contributor_id = v_ctr
    ), '[]'::jsonb),
    'review', jsonb_build_object(
      'decisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id, 'target_type', d.target_type, 'item_id', d.item_id, 'lesson_id', d.lesson_id,
          'variety_id', d.variety_id, 'decision', d.decision, 'scope', d.scope,
          'sole_reviewer', d.sole_reviewer, 'comment', d.comment, 'at', d.at
        ) order by d.seq)
        from content.review_decisions d where d.reviewer_contributor_id = v_ctr
      ), '[]'::jsonb),
      'countersignatures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'decision_id', s.decision_id, 'variety_id', s.variety_id,
          'comment', s.comment, 'at', s.at
        ) order by s.at, s.id)
        from content.countersignatures s where s.admin_contributor_id = v_ctr
      ), '[]'::jsonb),
      'suggestions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'item_id', s.item_id, 'variety_id', s.variety_id, 'proposed', s.proposed,
          'note', s.note, 'status', s.status, 'created_at', s.created_at, 'resolved_at', s.resolved_at
        ) order by s.created_at, s.id)
        from content.suggestions s where s.suggester_contributor_id = v_ctr
      ), '[]'::jsonb),
      'comments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'target_type', m.target_type, 'target_id', m.target_id,
          'variety_id', m.variety_id, 'parent_id', m.parent_id, 'body', m.body,
          'redacted_at', m.redacted_at, 'at', m.at
        ) order by m.at, m.id)
        from content.review_comments m where m.author_contributor_id = v_ctr
      ), '[]'::jsonb)
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- delete_my_account
-- ---------------------------------------------------------------------------

-- Deletes the caller's sign-in and everything that is only theirs: the
-- auth.users row cascades to the profile, progress, awards, devices, prefs
-- and imports (the append-only ledgers let those rows go because
-- polilingo.account_deletion names this user). A team member's contributor
-- row stays, unlinked and ended, so the review history they wrote stays
-- attributed to the same ctr id; their private details are deleted and every
-- grant still running is ended.
--
-- The last active admin is refused (PL409_LAST_ADMIN): the workspace would
-- have nobody to invite anyone. Admin changes take one advisory lock,
-- hashtextextended('polilingo.admins', 0), so two admins deleting themselves
-- at once cannot both pass the check.
create function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ctr text;
  v_ended int := 0;
begin
  if v_uid is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('polilingo.admins', 0));

  if private.is_admin() and not exists (
    select 1
    from public.role_grants g
    join public.contributors c on c.id = g.contributor_id
    join public.profiles p on p.user_id = c.user_id
    where g.role = 'admin'
      and c.user_id <> v_uid
      and c.status = 'active'
      and p.age_band = '18+'
      and g.starts_at <= now()
      and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
  ) then
    perform private.raise(
      'PL409_LAST_ADMIN',
      'You''re the last admin. Make someone else an admin before deleting your account.'
    );
  end if;

  select c.id into v_ctr from public.contributors c where c.user_id = v_uid for update;

  if v_ctr is not null then
    -- End every grant that has not ended. A grant that starts later ends
    -- just after it starts (ends_at must follow starts_at); the contributor
    -- is ended too, so it never counts.
    update public.role_grants g
    set ends_at = greatest(now(), g.starts_at + interval '1 second'),
        revoked_by = v_ctr,
        revoke_reason = 'Account deleted'
    where g.contributor_id = v_ctr
      and (g.ends_at is null or g.ends_at > now());
    get diagnostics v_ended = row_count;

    delete from public.contributor_private cp where cp.contributor_id = v_ctr;

    -- Recorded while the contributor is still linked, so the actor is them.
    -- The ctr id only: no email, no user id.
    perform private.audit('account.deleted', 'contributor', v_ctr, jsonb_build_object('grants_ended', v_ended));

    update public.contributors
    set user_id = null, status = 'ended'
    where id = v_ctr;
  else
    -- A learner: that an account was deleted, and nothing about whose.
    perform private.audit('account.deleted', 'account', null, null);
  end if;

  perform pg_catalog.set_config('polilingo.account_deletion', v_uid::text, true);
  delete from auth.users u where u.id = v_uid;
  perform pg_catalog.set_config('polilingo.account_deletion', '', true);

  return jsonb_build_object('deleted', true, 'grants_ended', v_ended);
end $$;

-- ---------------------------------------------------------------------------
-- private.purge_profileless_users: sign-ins that never finished
-- ---------------------------------------------------------------------------

-- Someone who reaches Supabase but never gets a profile (they closed the tab
-- before the age band was saved) leaves an auth.users row holding an email
-- and nothing else. After 24 hours it is deleted. A user linked to a
-- contributor is left alone: that is staff history, never purged here.
create function private.purge_profileless_users()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_count int := 0;
begin
  for v_user in
    select u.id
    from auth.users u
    where u.created_at < now() - interval '24 hours'
      and not exists (select 1 from public.profiles p where p.user_id = u.id)
      and not exists (select 1 from public.contributors c where c.user_id = u.id)
    for update of u skip locked
  loop
    perform pg_catalog.set_config('polilingo.account_deletion', v_user::text, true);
    delete from auth.users u where u.id = v_user;
    v_count := v_count + 1;
  end loop;
  perform pg_catalog.set_config('polilingo.account_deletion', '', true);
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Grants (§3.1): the four API functions to authenticated, nothing to anon;
-- the purge to nobody (pg_cron runs it as the owner).
-- ---------------------------------------------------------------------------

revoke all on function public.ensure_profile(text) from public, anon;
revoke all on function public.set_age_band(text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function private.purge_profileless_users() from public, anon, authenticated;

grant execute on function public.ensure_profile(text) to authenticated;
grant execute on function public.set_age_band(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- The daily purge, when pg_cron is there
-- ---------------------------------------------------------------------------

-- Scheduled only when the pg_cron extension is installed, or can be (it is
-- available on Supabase). Without it (a plain Postgres, the test stand-in)
-- nothing is scheduled and the migration still applies; the function can be
-- run by hand. Scheduling again replaces the job of the same name.
do $cron$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron could not be enabled (%); the profileless purge is not scheduled.', sqlerrm;
    end;
  end if;
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    execute $sql$select cron.schedule('polilingo-purge-profileless-users', '17 3 * * *', 'select private.purge_profileless_users()')$sql$;
  end if;
end
$cron$;
