-- Track G: the learner release read (docs/platform.md 3.9 G, 4.7).
--
-- public.get_learner_release is the one function anon may execute. The web
-- app's /api/release route calls it through PostgREST with the publishable
-- key (a GET, so the function is stable), caches the answer for everyone,
-- and hands browsers a newer learner copy when there is one.
--
-- It reads only the latest row of content.releases, whose payload is the
-- learner copy: lessons whose publish gate is open all the way down, with
-- learner-facing fields only. That is exactly what the committed baseline
-- (content/release.json) already shows every visitor, so nothing here is
-- more than a learner may see. content.releases is readable only by staff
-- through RLS, hence SECURITY DEFINER.
--
-- Answers:
--   null                                   the overlay kill switch is off
--                                          (private.app_settings
--                                          overlay_enabled), or nothing has
--                                          been released yet: learners keep
--                                          the content they have.
--   {release, contentHash, unchanged: true} p_known_hash is the latest
--                                          release's hash.
--   {release, contentHash, payload}        otherwise: the whole copy.
--
-- "Latest" is the highest seq. Releases are append-only and a rollback is a
-- new release carrying an older payload, so the newest row is always what
-- learners should see.

create function public.get_learner_release(p_known_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_hash text;
  v_payload jsonb;
begin
  if not private.setting_on('overlay_enabled') then
    return null;
  end if;

  select r.name, r.content_hash
    into v_name, v_hash
    from content.releases r
    order by r.seq desc
    limit 1;
  if not found then
    return null;
  end if;

  if p_known_hash is not null and p_known_hash = v_hash then
    return jsonb_build_object('release', v_name, 'contentHash', v_hash, 'unchanged', true);
  end if;

  select r.payload into v_payload
    from content.releases r
    where r.name = v_name;
  return jsonb_build_object('release', v_name, 'contentHash', v_hash, 'payload', v_payload);
end $$;

comment on function public.get_learner_release(text) is
  'The latest published learner copy for the web app (docs/platform.md 4.7). The only function anon may execute.';

revoke all on function public.get_learner_release(text) from public, anon, authenticated;
grant execute on function public.get_learner_release(text) to anon, authenticated;
