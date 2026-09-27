-- 20260928000500_access.sql
-- Owner: Foundation (docs/platform.md §3.1, §3.8, §3.10).
--
-- Row Level Security on every table, every grant, every SELECT policy.
-- Writes have no policies: only SECURITY DEFINER functions (owned by the
-- migration role) and the seed write. anon holds nothing anywhere; track G
-- grants it EXECUTE on public.get_learner_release alone.

-- ---------------------------------------------------------------------------
-- RLS on, everywhere
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'content', 'private')
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table %I.%I enable row level security', r.nspname, r.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Grants (§3.1)
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public, content, private from public, anon, authenticated;
revoke all on all sequences in schema public, content, private from public, anon, authenticated;
revoke all on all functions in schema public, content, private from public, anon, authenticated;

-- content: readable by signed-in users, filtered by RLS; written by nobody but the owner.
grant usage on schema content to authenticated;
grant select on all tables in schema content to authenticated;

-- private: the RLS helpers policies call (§3.6), and the pure or RLS-scoped
-- helpers that SECURITY INVOKER page functions (tracks D, E) call.
grant usage on schema private to authenticated;
grant execute on function
  private.current_contributor_id(),
  private.is_admin(),
  private.is_staff(),
  private.can_edit_language(text),
  private.review_grant_for(text),
  private.has_review_authority(text),
  private.active_reviewer_count(text),
  private.readable_varieties(),
  private.change_author(),
  private.raise(text, text, jsonb),
  private.js_ws(),
  private.normalise_native(text),
  private.text_fingerprint(text),
  private.canonical_json(jsonb),
  private.native_problems(text, text, text),
  private.lesson_problems(text),
  private.effective_gate(text),
  private.lesson_json(text)
to authenticated;

-- public API functions from the foundation.
grant execute on function public.my_context() to authenticated;

-- ---------------------------------------------------------------------------
-- Policies (§3.8): SELECT only, to authenticated
-- ---------------------------------------------------------------------------

-- Own rows.
create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy progress_completions_select_own on public.progress_completions
  for select to authenticated using (user_id = (select auth.uid()));
create policy progress_activity_select_own on public.progress_activity
  for select to authenticated using (user_id = (select auth.uid()));
create policy progress_devices_select_own on public.progress_devices
  for select to authenticated using (user_id = (select auth.uid()));
create policy progress_imports_select_own on public.progress_imports
  for select to authenticated using (user_id = (select auth.uid()));
create policy xp_awards_select_own on public.xp_awards
  for select to authenticated using (user_id = (select auth.uid()));
create policy learner_prefs_select_own on public.learner_prefs
  for select to authenticated using (user_id = (select auth.uid()));

-- People.
create policy contributors_select on public.contributors
  for select to authenticated
  using ((select private.is_staff()) or user_id = (select auth.uid()));
create policy contributor_private_select on public.contributor_private
  for select to authenticated
  using ((select private.is_admin()) or contributor_id = (select private.current_contributor_id()));
create policy role_grants_select on public.role_grants
  for select to authenticated
  using ((select private.is_admin()) or contributor_id = (select private.current_contributor_id()));
create policy invitations_select_admin on public.invitations
  for select to authenticated using ((select private.is_admin()));
create policy audit_events_select_admin on public.audit_events
  for select to authenticated using ((select private.is_admin()));

-- Content any staff member reads.
create policy languages_select_staff on content.languages
  for select to authenticated using ((select private.is_staff()));
create policy varieties_select_staff on content.varieties
  for select to authenticated using ((select private.is_staff()));
create policy courses_select_staff on content.courses
  for select to authenticated using ((select private.is_staff()));
create policy units_select_staff on content.units
  for select to authenticated using ((select private.is_staff()));
create policy id_registry_select_staff on content.id_registry
  for select to authenticated using ((select private.is_staff()));
create policy releases_select_staff on content.releases
  for select to authenticated using ((select private.is_staff()));
create policy release_lessons_select_staff on content.release_lessons
  for select to authenticated using ((select private.is_staff()));
create policy release_items_select_staff on content.release_items
  for select to authenticated using ((select private.is_staff()));
create policy demo_items_select_staff on content.demo_items
  for select to authenticated using ((select private.is_staff()));
create policy demo_period_select_staff on content.demo_period
  for select to authenticated using ((select private.is_staff()));
create policy keymap_lessons_select_staff on content.keymap_lessons
  for select to authenticated using ((select private.is_staff()));
create policy keymap_items_select_staff on content.keymap_items
  for select to authenticated using ((select private.is_staff()));
create policy keymap_courses_select_staff on content.keymap_courses
  for select to authenticated using ((select private.is_staff()));
create policy orthography_allowlist_select_staff on content.orthography_allowlist
  for select to authenticated using ((select private.is_staff()));

-- Content scoped to the caller's readable varieties.
create policy lessons_select_scoped on content.lessons
  for select to authenticated using (variety_id = any ((select private.readable_varieties())::text[]));
create policy items_select_scoped on content.items
  for select to authenticated using (variety_id = any ((select private.readable_varieties())::text[]));
create policy review_decisions_select_scoped on content.review_decisions
  for select to authenticated using (variety_id = any ((select private.readable_varieties())::text[]));
create policy countersignatures_select_scoped on content.countersignatures
  for select to authenticated using (variety_id = any ((select private.readable_varieties())::text[]));
create policy suggestions_select_scoped on content.suggestions
  for select to authenticated using (variety_id = any ((select private.readable_varieties())::text[]));
create policy review_comments_select_scoped on content.review_comments
  for select to authenticated using (variety_id = any ((select private.readable_varieties())::text[]));

create policy exercises_select_scoped on content.exercises
  for select to authenticated
  using (exists (select 1 from content.lessons l where l.id = exercises.lesson_id));

create policy revisions_select_scoped on content.revisions
  for select to authenticated
  using (
    (variety_id is null and (select private.is_staff()))
    or variety_id = any ((select private.readable_varieties())::text[])
  );

-- private.app_settings and private.seed_runs: RLS on, no grants, no policies.
