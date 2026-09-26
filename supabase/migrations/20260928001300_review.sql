-- 20260928001300_review.sql
-- Owner: Track D (review). docs/platform.md §3.5, §3.9 (D), §4.10.
--
-- Review decisions, countersignatures, suggestions and comments, and the
-- page reads behind /review and /admin/suggestions. Writes are SECURITY
-- DEFINER and check the caller against auth.uid() first; page reads are
-- SECURITY INVOKER, so RLS scopes them to the caller's varieties.
--
-- Check order in every write (§3.2): 401 -> role -> 422 input -> 404 ->
-- scope 403 -> 409 state -> content 422.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The variety of a review target, and whether it exists. Definer, so the
-- page reads can tell "outside your varieties" from "does not exist", which
-- RLS alone would both report as nothing. Staff only: anyone else gets null,
-- so it never confirms that an id exists to a learner.
create function private.review_target_scope(p_target_type text, p_target_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.is_staff() then null else (
    select jsonb_build_object(
      'variety_id', t.variety_id,
      'variety_name', v.name,
      'readable', t.variety_id = any (private.readable_varieties())
    )
    from (
      select i.variety_id from content.items i
      where p_target_type = 'item' and i.id = p_target_id
      union all
      select l.variety_id from content.lessons l
      where p_target_type = 'lesson' and l.id = p_target_id
      union all
      select s.variety_id from content.suggestions s
      where p_target_type = 'suggestion' and s.id::text = p_target_id
      union all
      select d.variety_id from content.review_decisions d
      where p_target_type = 'decision' and d.id::text = p_target_id
    ) t
    join content.varieties v on v.id = t.variety_id
    limit 1
  ) end
$$;

-- A contributor's display name, for history and suggestion lists. The
-- contributors table has no grant to authenticated, so invoker page reads
-- ask here. Staff only, as the contributors policy allows.
create function private.contributor_name(p_contributor_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.display_name
  from public.contributors c
  where c.id = p_contributor_id and private.is_staff()
$$;

-- The author rule (§3.5): the contributor wrote a revision of the target
-- after its last approval. For a lesson that is its own revisions and its
-- exercises'. Invoker: RLS applies when a page read calls it.
create function private.review_is_author(p_target_type text, p_target_id text, p_contributor_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_contributor_id is not null and exists (
    select 1
    from content.revisions r
    where r.author_contributor_id = p_contributor_id
      and r.seq > coalesce(case p_target_type
        when 'item' then (select i.last_approved_seq from content.items i where i.id = p_target_id)
        when 'lesson' then (select l.last_approved_seq from content.lessons l where l.id = p_target_id)
      end, 0)
      and (
        (p_target_type = 'item' and r.object_type = 'item' and r.object_id = p_target_id)
        or (p_target_type = 'lesson' and (
          (r.object_type = 'lesson' and r.object_id = p_target_id)
          or (r.object_type = 'exercise' and r.lesson_id = p_target_id)
        ))
      )
  )
$$;

-- The parts of an item a reviewer must tick to approve it: text,
-- romanisation and meaning always, usage when it has a context or a usage
-- note. Kept in step with requiredScopes() in lib/console/review.ts.
create function private.review_required_scope(p_context text, p_usage_note text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['text', 'romanisation', 'meaning']
    || case when p_context is not null or p_usage_note is not null then array['usage'] else '{}'::text[] end
$$;

-- "Hazara Hindko needs a Hazara Hindko reviewer."
create function private.raise_outside_variety(p_variety_id text, p_variety_name text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.raise(
    'PL403_OUTSIDE_VARIETY',
    format('%s needs a %s reviewer.', coalesce(p_variety_name, p_variety_id), coalesce(p_variety_name, p_variety_id)),
    jsonb_build_object('variety_id', p_variety_id, 'variety_name', p_variety_name)
  );
end $$;

-- True when the caller holds any active reviewer grant.
create function private.is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.my_active_grants() g where g.role = 'language_reviewer')
$$;

-- True when the caller is an admin or holds any editor grant.
create function private.is_editor_or_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.my_active_grants() g where g.role in ('admin', 'editor'))
$$;

-- Refuses when the caller is not signed in.
create function private.require_signed_in()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- record_review_decision
-- ---------------------------------------------------------------------------

create function public.record_review_decision(
  p_target_type text,
  p_target_id text,
  p_decision text,
  p_seen_fingerprint text,
  p_scope text[] default null,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_scope text[];
  v_required text[];
  v_missing text[];
  v_variety text;
  v_variety_name text;
  v_fingerprint text;
  v_revision int;
  v_retired timestamptz;
  v_context text;
  v_usage text;
  v_is_demo boolean;
  v_grant uuid;
  v_author boolean;
  v_sole boolean := false;
  v_exercises int;
  v_problems jsonb;
  v_decision uuid;
  v_status text;
  v_seq bigint;
begin
  -- 401, role
  perform private.require_signed_in();
  v_me := private.current_contributor_id();
  if not private.is_reviewer() then
    perform private.raise('PL403_NOT_REVIEWER', 'Only a reviewer can record a review.');
  end if;

  -- 422 input
  if p_target_type is null or p_target_type not in ('item', 'lesson')
     or p_target_id is null
     or p_decision is null or p_decision not in ('approve', 'request_changes', 'reject')
     or p_seen_fingerprint is null or p_seen_fingerprint !~ '^[0-9a-f]{16}$' then
    perform private.raise('PL422_BAD_INPUT', 'That review could not be read. Reload the page and try again.');
  end if;
  if p_scope is not null and exists (
    select 1 from unnest(p_scope) s where s is null or s not in ('text', 'romanisation', 'meaning', 'usage')
  ) then
    perform private.raise('PL422_BAD_INPUT', 'That review could not be read. Reload the page and try again.');
  end if;
  if v_comment is not null and char_length(v_comment) > 2000 then
    perform private.raise('PL422_BAD_INPUT', 'A review note can be up to 2,000 characters.');
  end if;
  if p_decision <> 'approve' and v_comment is null then
    perform private.raise('PL422_COMMENT_REQUIRED', 'Please add a short note to explain.');
  end if;
  v_scope := case when p_scope is null then null else (
    select coalesce(array_agg(distinct s order by s), '{}') from unnest(p_scope) s
  ) end;

  -- 404
  if p_target_type = 'item' then
    select i.variety_id, i.review_fingerprint, i.revision_no, i.retired_at, i.context, i.usage_note,
           exists (select 1 from content.demo_items d where d.item_id = i.id)
      into v_variety, v_fingerprint, v_revision, v_retired, v_context, v_usage, v_is_demo
    from content.items i
    where i.id = p_target_id
    for update;
  else
    select l.variety_id, l.review_fingerprint, l.revision_no, l.retired_at,
           exists (
             select 1 from content.items i join content.demo_items d on d.item_id = i.id
             where i.lesson_id = l.id and i.retired_at is null
           )
      into v_variety, v_fingerprint, v_revision, v_retired, v_is_demo
    from content.lessons l
    where l.id = p_target_id
    for update;
  end if;
  if v_variety is null or v_retired is not null then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that. It may have been moved or removed.',
      jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id));
  end if;

  -- 403 scope
  v_grant := private.review_grant_for(v_variety);
  if v_grant is null then
    select v.name into v_variety_name from content.varieties v where v.id = v_variety;
    perform private.raise_outside_variety(v_variety, v_variety_name);
  end if;

  -- 409 state
  if v_fingerprint <> p_seen_fingerprint then
    perform private.raise('PL409_STALE', 'This changed while you were looking at it. Reload to see the latest version.',
      jsonb_build_object('current_fingerprint', v_fingerprint, 'revision_no', v_revision));
  end if;
  if v_is_demo then
    perform private.raise('PL409_DEMO_NEVER_APPROVED', 'Starter content is never reviewed.',
      jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id));
  end if;

  if p_decision = 'approve' then
    -- A sole approval does not move last_approved_seq until it is
    -- countersigned, so its author is still an author here. Belt and braces:
    -- the reviewer of an uncountersigned sole approval that is still current
    -- is treated as its author too, so approving again can never turn it
    -- into an ordinary approval that skips the countersign.
    v_author := private.review_is_author(p_target_type, p_target_id, v_me)
      or exists (
        select 1
        from content.review_decisions d
        where d.id = case p_target_type
            when 'item' then (select i.current_decision_id from content.items i where i.id = p_target_id)
            else (select l.current_decision_id from content.lessons l where l.id = p_target_id)
          end
          and d.decision = 'approve'
          and d.sole_reviewer
          and d.reviewer_contributor_id = v_me
          and not exists (select 1 from content.countersignatures c where c.decision_id = d.id)
      );
    if v_author then
      if private.active_reviewer_count(v_variety) = 1 then
        v_sole := true;
      else
        perform private.raise('PL403_OWN_TEXT', 'You wrote part of this, so another reviewer needs to approve it.',
          jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id));
      end if;
    end if;

    -- content 422
    if p_target_type = 'item' then
      v_required := private.review_required_scope(v_context, v_usage);
      select coalesce(array_agg(r order by o), '{}') into v_missing
      from unnest(v_required) with ordinality u(r, o)
      where not (r = any (coalesce(v_scope, '{}')));
      if cardinality(v_missing) > 0 then
        perform private.raise('PL422_SCOPE_INCOMPLETE',
          format('Tick %s too. Each part must be checked before you approve.',
            array_to_string(array(
              select case m when 'text' then 'the native text' when 'usage' then 'usage' else m end
              from unnest(v_missing) m
            ), ', ')),
          jsonb_build_object('missing', to_jsonb(v_missing), 'required', to_jsonb(v_required)));
      end if;
    else
      select count(*) into v_exercises
      from content.exercises e
      where e.lesson_id = p_target_id and e.retired_at is null;
      if v_exercises < 6 then
        perform private.raise('PL422_TOO_FEW_EXERCISES',
          format('A lesson needs at least 6 exercises before it can be approved. This one has %s.', v_exercises),
          jsonb_build_object('exercises', v_exercises));
      end if;
      select coalesce(jsonb_agg(p), '[]'::jsonb) into v_problems
      from jsonb_array_elements(private.lesson_problems(p_target_id)) p
      where p ->> 'severity' = 'blocking';
      if jsonb_array_length(v_problems) > 0 then
        perform private.raise('PL422_LESSON_PROBLEMS',
          format('This lesson has %s to fix first: %s',
            case jsonb_array_length(v_problems) when 1 then 'a problem' else jsonb_array_length(v_problems) || ' problems' end,
            v_problems -> 0 ->> 'message'),
          jsonb_build_object('problems', v_problems));
      end if;
    end if;
  end if;

  insert into content.review_decisions (
    target_type, item_id, lesson_id, variety_id, decision, reviewer_contributor_id, grant_id,
    seen_fingerprint, target_revision_no, scope, sole_reviewer, comment
  ) values (
    p_target_type,
    case when p_target_type = 'item' then p_target_id end,
    case when p_target_type = 'lesson' then p_target_id end,
    v_variety, p_decision, v_me, v_grant,
    p_seen_fingerprint, v_revision, v_scope, v_sole, v_comment
  )
  returning id into v_decision;

  v_status := case p_decision when 'approve' then 'approved' when 'request_changes' then 'changes_requested' else 'rejected' end;
  select coalesce(max(r.seq), 0) into v_seq from content.revisions r;

  -- Only an independent approval clears authorship (§3.5). A sole approval
  -- keeps the old baseline until an admin countersigns it (see
  -- countersign_decision), so its author stays an author until then.
  if p_target_type = 'item' then
    update content.items i
    set review_status = v_status,
        current_decision_id = v_decision,
        last_approved_seq = case when p_decision = 'approve' and not v_sole then v_seq else i.last_approved_seq end
    where i.id = p_target_id;
  else
    update content.lessons l
    set review_status = v_status,
        current_decision_id = v_decision,
        last_approved_seq = case when p_decision = 'approve' and not v_sole then v_seq else l.last_approved_seq end
    where l.id = p_target_id;
  end if;

  perform private.audit('review.' || p_decision, p_target_type, p_target_id,
    jsonb_build_object('decision_id', v_decision, 'variety_id', v_variety, 'sole_reviewer', v_sole,
                       'seen_fingerprint', p_seen_fingerprint));

  return jsonb_build_object(
    'decision_id', v_decision,
    'status', v_status,
    'sole_reviewer', v_sole,
    'countersign_required', v_sole and p_decision = 'approve'
  );
end $$;

-- ---------------------------------------------------------------------------
-- countersign_decision
-- ---------------------------------------------------------------------------

create function public.countersign_decision(p_decision_id uuid, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_grant uuid;
  v_decision content.review_decisions%rowtype;
  v_current_id uuid;
  v_current_fp text;
  v_id uuid;
  v_seq bigint;
begin
  perform private.require_signed_in();
  v_me := private.current_contributor_id();
  if not private.is_admin() then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can countersign a review.');
  end if;
  if p_decision_id is null or (v_comment is not null and char_length(v_comment) > 2000) then
    perform private.raise('PL422_BAD_INPUT', 'That countersignature could not be read. A note can be up to 2,000 characters.');
  end if;

  select * into v_decision from content.review_decisions d where d.id = p_decision_id;
  if not found then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that review.');
  end if;

  if not v_decision.sole_reviewer or v_decision.decision <> 'approve' then
    perform private.raise('PL409_NOT_SOLE', 'This review doesn''t need a countersign.');
  end if;
  if v_decision.reviewer_contributor_id = v_me then
    perform private.raise('PL403_SELF_COUNTERSIGN', 'Another admin needs to countersign your own review.');
  end if;
  if exists (select 1 from content.countersignatures c where c.decision_id = p_decision_id) then
    perform private.raise('PL409_ALREADY_COUNTERSIGNED', 'This review has already been countersigned.');
  end if;

  if v_decision.target_type = 'item' then
    select i.current_decision_id, i.review_fingerprint into v_current_id, v_current_fp
    from content.items i where i.id = v_decision.item_id for update;
  else
    select l.current_decision_id, l.review_fingerprint into v_current_id, v_current_fp
    from content.lessons l where l.id = v_decision.lesson_id for update;
  end if;
  if v_current_id is distinct from p_decision_id or v_current_fp <> v_decision.seen_fingerprint then
    perform private.raise('PL409_STALE', 'This changed after the review, so there''s nothing to countersign. It needs a fresh review.',
      jsonb_build_object('current_fingerprint', v_current_fp, 'current_decision_id', v_current_id));
  end if;

  select g.id into v_grant from private.my_active_grants() g where g.role = 'admin' order by g.starts_at limit 1;

  insert into content.countersignatures (decision_id, variety_id, admin_contributor_id, grant_id, comment)
  values (p_decision_id, v_decision.variety_id, v_me, v_grant, v_comment)
  returning id into v_id;

  -- The countersigned approval now clears authorship, as an independent
  -- approval does. The target row is locked above and still carries the
  -- fingerprint the reviewer saw, so nothing learner-visible changed since.
  select coalesce(max(r.seq), 0) into v_seq from content.revisions r;
  if v_decision.target_type = 'item' then
    update content.items i set last_approved_seq = v_seq where i.id = v_decision.item_id;
  else
    update content.lessons l set last_approved_seq = v_seq where l.id = v_decision.lesson_id;
  end if;

  perform private.audit('countersign', v_decision.target_type, coalesce(v_decision.item_id, v_decision.lesson_id),
    jsonb_build_object('decision_id', p_decision_id, 'countersignature_id', v_id));

  return jsonb_build_object('countersignature_id', v_id, 'decision_id', p_decision_id);
end $$;

-- ---------------------------------------------------------------------------
-- Suggestions
-- ---------------------------------------------------------------------------

create function public.create_suggestion(
  p_item_id text,
  p_seen_fingerprint text,
  p_proposed jsonb,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_item content.items%rowtype;
  v_variety_name text;
  v_key text;
  v_value jsonb;
  v_text text;
  v_proposed jsonb := '{}'::jsonb;
  v_native text;
  v_roman text;
  v_problems jsonb;
  v_id uuid;
begin
  perform private.require_signed_in();
  v_me := private.current_contributor_id();
  if not private.is_reviewer() then
    perform private.raise('PL403_NOT_REVIEWER', 'Only a reviewer can suggest a fix.');
  end if;

  if p_item_id is null or p_seen_fingerprint is null or p_seen_fingerprint !~ '^[0-9a-f]{16}$'
     or p_proposed is null or jsonb_typeof(p_proposed) <> 'object' then
    perform private.raise('PL422_BAD_INPUT', 'That suggestion could not be read. Reload the page and try again.');
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(p_proposed) e loop
    if v_key not in ('native', 'romanisation', 'meaning', 'context', 'usage_note')
       or jsonb_typeof(v_value) not in ('string', 'null') then
      perform private.raise('PL422_BAD_INPUT', 'A suggestion can change the native text, romanisation, meaning, context or usage note.');
    end if;
  end loop;
  if v_note is not null and char_length(v_note) > 2000 then
    perform private.raise('PL422_LENGTH', 'A note can be up to 2,000 characters.');
  end if;

  select * into v_item from content.items i where i.id = p_item_id for update;
  if not found or v_item.retired_at is not null then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that phrase. It may have been moved or removed.');
  end if;

  if private.review_grant_for(v_item.variety_id) is null then
    select v.name into v_variety_name from content.varieties v where v.id = v_item.variety_id;
    perform private.raise_outside_variety(v_item.variety_id, v_variety_name);
  end if;

  if v_item.review_fingerprint <> p_seen_fingerprint then
    perform private.raise('PL409_STALE', 'This changed while you were looking at it. Reload to see the latest version.',
      jsonb_build_object('current_fingerprint', v_item.review_fingerprint, 'revision_no', v_item.revision_no));
  end if;
  if exists (select 1 from content.demo_items d where d.item_id = v_item.id) then
    perform private.raise('PL409_DEMO_FROZEN', 'Starter phrases can''t be changed, so they take no suggestions.');
  end if;

  -- Keep only what differs from the current text, stored as it would be saved.
  for v_key, v_value in select e.key, e.value from jsonb_each(p_proposed) e loop
    v_text := case when jsonb_typeof(v_value) = 'string' then v_value #>> '{}' end;
    if v_key = 'native' then
      v_text := private.normalise_native(coalesce(v_text, ''));
    else
      v_text := btrim(coalesce(v_text, ''));
    end if;
    if v_key in ('native', 'romanisation', 'meaning') and v_text = '' then
      perform private.raise('PL422_LENGTH',
        format('The %s can''t be empty.', case v_key when 'native' then 'native text' else v_key end),
        jsonb_build_object('field', v_key));
    end if;
    if v_text = '' then
      v_text := null;
    end if;
    if char_length(v_text) > (case v_key when 'meaning' then 200 when 'context' then 300 when 'usage_note' then 500 else 300 end) then
      perform private.raise('PL422_LENGTH',
        format('The %s is too long: it can be up to %s characters.',
          replace(case v_key when 'native' then 'native text' else v_key end, '_', ' '),
          case v_key when 'meaning' then 200 when 'context' then 300 when 'usage_note' then 500 else 300 end),
        jsonb_build_object('field', v_key));
    end if;
    if v_text is distinct from (to_jsonb(v_item) ->> v_key) then
      v_proposed := v_proposed || jsonb_build_object(v_key, v_text);
    end if;
  end loop;

  if v_proposed = '{}'::jsonb then
    perform private.raise('PL422_NO_CHANGE', 'That is the same as the current text, so there''s nothing to suggest.');
  end if;

  if v_proposed ? 'native' or v_proposed ? 'romanisation' then
    v_native := coalesce(v_proposed ->> 'native', v_item.native);
    v_roman := coalesce(v_proposed ->> 'romanisation', v_item.romanisation);
    v_problems := private.native_problems(split_part(v_item.id, '-', 1), v_native, v_roman);
    if jsonb_array_length(v_problems) > 0 then
      perform private.raise(v_problems -> 0 ->> 'code', v_problems -> 0 ->> 'message',
        jsonb_build_object('item_id', v_item.id, 'problems', v_problems));
    end if;
  end if;

  insert into content.suggestions (item_id, variety_id, suggester_contributor_id, base_review_fingerprint, proposed, note)
  values (v_item.id, v_item.variety_id, v_me, v_item.review_fingerprint, v_proposed, v_note)
  returning id into v_id;

  perform private.audit('suggestion.created', 'item', v_item.id,
    jsonb_build_object('suggestion_id', v_id, 'fields', (select jsonb_agg(k order by k) from jsonb_object_keys(v_proposed) k)));

  return v_id;
end $$;

create function public.withdraw_suggestion(p_suggestion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text;
  v_s content.suggestions%rowtype;
begin
  perform private.require_signed_in();
  v_me := private.current_contributor_id();

  select * into v_s from content.suggestions s where s.id = p_suggestion_id for update;
  if not found then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that suggestion.');
  end if;
  if v_me is null or v_s.suggester_contributor_id <> v_me then
    perform private.raise('PL403_NOT_SUGGESTER', 'Only the person who made this suggestion can withdraw it.');
  end if;
  if v_s.status <> 'open' then
    perform private.raise('PL409_SUGGESTION_CLOSED', 'This suggestion has already been dealt with.',
      jsonb_build_object('status', v_s.status));
  end if;

  update content.suggestions
  set status = 'withdrawn', resolved_by = v_me, resolved_at = now()
  where id = p_suggestion_id;

  perform private.audit('suggestion.withdrawn', 'item', v_s.item_id, jsonb_build_object('suggestion_id', p_suggestion_id));
  return jsonb_build_object('suggestion_id', p_suggestion_id, 'status', 'withdrawn');
end $$;

create function public.accept_suggestion(p_suggestion_id uuid, p_seen_fingerprint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text;
  v_s content.suggestions%rowtype;
  v_item content.items%rowtype;
  v_after content.items%rowtype;
  v_language text;
  v_superseded int;
begin
  perform private.require_signed_in();
  v_me := private.current_contributor_id();
  if not private.is_editor_or_admin() then
    perform private.raise('PL403_NOT_EDITOR', 'Only an editor or an admin can accept a suggestion.');
  end if;
  if p_suggestion_id is null or p_seen_fingerprint is null or p_seen_fingerprint !~ '^[0-9a-f]{16}$' then
    perform private.raise('PL422_BAD_INPUT', 'That suggestion could not be read. Reload the page and try again.');
  end if;

  select * into v_s from content.suggestions s where s.id = p_suggestion_id for update;
  if not found then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that suggestion.');
  end if;
  select * into v_item from content.items i where i.id = v_s.item_id for update;

  v_language := split_part(v_item.id, '-', 1);
  if not private.can_edit_language(v_language) then
    perform private.raise('PL403_OUTSIDE_LANGUAGE',
      format('You don''t edit %s, so a %s editor needs to do this.',
        coalesce((select l.name from content.languages l where l.code = v_language), v_language),
        coalesce((select l.name from content.languages l where l.code = v_language), v_language)),
      jsonb_build_object('language', v_language));
  end if;

  if v_s.status <> 'open' then
    perform private.raise('PL409_SUGGESTION_CLOSED', 'This suggestion has already been dealt with.',
      jsonb_build_object('status', v_s.status));
  end if;
  if v_item.retired_at is not null then
    perform private.raise('PL409_RETIRED', 'This phrase has been retired, so it can''t be changed.');
  end if;
  if v_item.review_fingerprint <> p_seen_fingerprint then
    perform private.raise('PL409_STALE', 'This changed while you were looking at it. Reload to see the latest version.',
      jsonb_build_object('current_fingerprint', v_item.review_fingerprint, 'revision_no', v_item.revision_no));
  end if;
  if v_s.base_review_fingerprint <> v_item.review_fingerprint then
    perform private.raise('PL409_STALE_SUGGESTION', 'The phrase changed after this suggestion was made, so it can''t be applied as it is.',
      jsonb_build_object('current_fingerprint', v_item.review_fingerprint, 'base_fingerprint', v_s.base_review_fingerprint));
  end if;

  -- Applied verbatim, recorded against the suggester (§3.5). The triggers
  -- read these settings: the revision's reason and suggestion, and who the
  -- change author is.
  perform set_config('polilingo.revision_reason', 'suggestion', true);
  perform set_config('polilingo.change_author', v_s.suggester_contributor_id, true);
  perform set_config('polilingo.suggestion_id', v_s.id::text, true);

  update content.items i
  set native = case when v_s.proposed ? 'native' then v_s.proposed ->> 'native' else i.native end,
      romanisation = case when v_s.proposed ? 'romanisation' then v_s.proposed ->> 'romanisation' else i.romanisation end,
      meaning = case when v_s.proposed ? 'meaning' then v_s.proposed ->> 'meaning' else i.meaning end,
      context = case when v_s.proposed ? 'context' then v_s.proposed ->> 'context' else i.context end,
      usage_note = case when v_s.proposed ? 'usage_note' then v_s.proposed ->> 'usage_note' else i.usage_note end
  where i.id = v_item.id
  returning * into v_after;

  perform set_config('polilingo.revision_reason', '', true);
  perform set_config('polilingo.change_author', '', true);
  perform set_config('polilingo.suggestion_id', '', true);

  update content.suggestions
  set status = 'accepted', resolved_by = v_me, resolved_at = now()
  where id = v_s.id;

  update content.suggestions
  set status = 'superseded', resolved_by = v_me, resolved_at = now(),
      resolution_note = 'Another suggestion for this phrase was accepted.'
  where item_id = v_item.id and status = 'open' and id <> v_s.id;
  get diagnostics v_superseded = row_count;

  perform private.audit('suggestion.accepted', 'item', v_item.id,
    jsonb_build_object('suggestion_id', v_s.id, 'suggester', v_s.suggester_contributor_id, 'superseded', v_superseded));

  return jsonb_build_object(
    'suggestion_id', v_s.id,
    'item_id', v_item.id,
    'review_fingerprint', v_after.review_fingerprint,
    'revision_no', v_after.revision_no,
    'review_status', v_after.review_status,
    'superseded', v_superseded
  );
end $$;

create function public.decline_suggestion(p_suggestion_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_s content.suggestions%rowtype;
  v_language text;
begin
  perform private.require_signed_in();
  v_me := private.current_contributor_id();
  if not private.is_editor_or_admin() then
    perform private.raise('PL403_NOT_EDITOR', 'Only an editor or an admin can decline a suggestion.');
  end if;
  if v_reason is null then
    perform private.raise('PL422_COMMENT_REQUIRED', 'Please say why, so the reviewer knows.');
  end if;
  if char_length(v_reason) > 2000 then
    perform private.raise('PL422_LENGTH', 'A reason can be up to 2,000 characters.');
  end if;

  select * into v_s from content.suggestions s where s.id = p_suggestion_id for update;
  if not found then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that suggestion.');
  end if;
  v_language := split_part(v_s.item_id, '-', 1);
  if not private.can_edit_language(v_language) then
    perform private.raise('PL403_OUTSIDE_LANGUAGE',
      format('You don''t edit %s, so a %s editor needs to do this.',
        coalesce((select l.name from content.languages l where l.code = v_language), v_language),
        coalesce((select l.name from content.languages l where l.code = v_language), v_language)),
      jsonb_build_object('language', v_language));
  end if;
  if v_s.status <> 'open' then
    perform private.raise('PL409_SUGGESTION_CLOSED', 'This suggestion has already been dealt with.',
      jsonb_build_object('status', v_s.status));
  end if;

  update content.suggestions
  set status = 'declined', resolved_by = v_me, resolved_at = now(), resolution_note = v_reason
  where id = v_s.id;

  perform private.audit('suggestion.declined', 'item', v_s.item_id, jsonb_build_object('suggestion_id', v_s.id));
  return jsonb_build_object('suggestion_id', v_s.id, 'status', 'declined');
end $$;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

create function public.add_review_comment(
  p_target_type text,
  p_target_id text,
  p_body text,
  p_parent_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text;
  v_body text := btrim(coalesce(p_body, ''));
  v_scope jsonb;
  v_parent content.review_comments%rowtype;
  v_id uuid;
begin
  perform private.require_signed_in();
  v_me := private.current_contributor_id();
  if p_target_type is null or p_target_type not in ('item', 'lesson', 'suggestion', 'decision') or p_target_id is null then
    perform private.raise('PL422_BAD_INPUT', 'That comment could not be read. Reload the page and try again.');
  end if;
  if char_length(v_body) not between 1 and 4000 then
    perform private.raise('PL422_LENGTH',
      case when v_body = '' then 'Write something first.' else 'A comment can be up to 4,000 characters.' end);
  end if;

  v_scope := private.review_target_scope(p_target_type, p_target_id);
  if v_scope is null and private.is_staff() then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that. It may have been moved or removed.');
  end if;
  if v_scope is null or v_me is null or not (v_scope ->> 'readable')::boolean then
    perform private.raise('PL403_OUTSIDE_VARIETY',
      coalesce(format('%s isn''t one of the varieties you work on.', v_scope ->> 'variety_name'),
               'This belongs to a variety you don''t work on.'),
      jsonb_build_object('variety_id', v_scope ->> 'variety_id'));
  end if;

  if p_parent_id is not null then
    select * into v_parent from content.review_comments c where c.id = p_parent_id;
    if not found or v_parent.target_type <> p_target_type or v_parent.target_id <> p_target_id then
      perform private.raise('PL422_BAD_INPUT', 'You can only reply to a comment on the same thing.');
    end if;
  end if;

  insert into content.review_comments (target_type, target_id, variety_id, parent_id, author_contributor_id, body)
  values (p_target_type, p_target_id, v_scope ->> 'variety_id', p_parent_id, v_me, v_body)
  returning id into v_id;
  return v_id;
end $$;

-- Replaces a comment's body (or a decision's comment) with '[removed]'.
-- The row stays: history is append-only.
create function public.redact_comment(p_comment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_kind text;
  v_redacted timestamptz;
  v_target_type text;
  v_target_id text;
begin
  perform private.require_signed_in();
  if not private.is_admin() then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can remove a comment.');
  end if;
  if v_reason is null then
    perform private.raise('PL422_COMMENT_REQUIRED', 'Please say why this comment is being removed.');
  end if;

  select 'comment', c.redacted_at, c.target_type, c.target_id into v_kind, v_redacted, v_target_type, v_target_id
  from content.review_comments c where c.id = p_comment_id;
  if v_kind is null then
    select 'decision', d.redacted_at, d.target_type, coalesce(d.item_id, d.lesson_id)
      into v_kind, v_redacted, v_target_type, v_target_id
    from content.review_decisions d where d.id = p_comment_id and d.comment is not null;
  end if;
  if v_kind is null then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that comment.');
  end if;
  if v_redacted is not null then
    return jsonb_build_object('comment_id', p_comment_id, 'redacted', true, 'already', true);
  end if;

  perform set_config('polilingo.redaction', 'on', true);
  if v_kind = 'comment' then
    update content.review_comments set body = '[removed]', redacted_at = now() where id = p_comment_id;
  else
    update content.review_decisions set comment = '[removed]', redacted_at = now() where id = p_comment_id;
  end if;
  perform set_config('polilingo.redaction', '', true);

  perform private.audit('comment.redacted', v_target_type, v_target_id,
    jsonb_build_object('comment_id', p_comment_id, 'kind', v_kind, 'reason', v_reason));
  return jsonb_build_object('comment_id', p_comment_id, 'redacted', true, 'already', false);
end $$;

-- ---------------------------------------------------------------------------
-- Page reads (invoker: RLS scopes every row to the caller's varieties)
-- ---------------------------------------------------------------------------

-- Decisions on one target, newest first, with who made them and any countersign.
create function private.review_decisions_json(p_target_type text, p_target_id text, p_current uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'decision', d.decision,
    'reviewer_id', d.reviewer_contributor_id,
    'reviewer_name', private.contributor_name(d.reviewer_contributor_id),
    'seen_fingerprint', d.seen_fingerprint,
    'target_revision_no', d.target_revision_no,
    'scope', to_jsonb(d.scope),
    'sole_reviewer', d.sole_reviewer,
    'comment', d.comment,
    'redacted', d.redacted_at is not null,
    'at', d.at,
    'current', d.id = p_current,
    'countersign', (
      select jsonb_build_object(
        'admin_id', c.admin_contributor_id,
        'admin_name', private.contributor_name(c.admin_contributor_id),
        'comment', c.comment,
        'at', c.at)
      from content.countersignatures c where c.decision_id = d.id
    )
  ) order by d.seq desc), '[]'::jsonb)
  from content.review_decisions d
  where (p_target_type = 'item' and d.item_id = p_target_id)
     or (p_target_type = 'lesson' and d.lesson_id = p_target_id)
$$;

create function private.review_comments_json(p_target_type text, p_target_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'parent_id', c.parent_id,
    'author_id', c.author_contributor_id,
    'author_name', private.contributor_name(c.author_contributor_id),
    'body', c.body,
    'redacted', c.redacted_at is not null,
    'at', c.at
  ) order by c.at desc, c.id), '[]'::jsonb)
  from content.review_comments c
  where c.target_type = p_target_type and c.target_id = p_target_id
$$;

-- Refuses a page read the caller cannot make: 401, then not staff, then
-- 404 or outside their varieties.
create function private.review_page_guard(p_target_type text, p_target_id text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_scope jsonb;
begin
  perform private.require_signed_in();
  if not private.is_staff() then
    perform private.raise('PL403_NOT_REVIEWER', 'Only a reviewer can open this.');
  end if;
  v_scope := private.review_target_scope(p_target_type, p_target_id);
  if v_scope is null then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that. It may have been moved or removed.');
  end if;
  if not (v_scope ->> 'readable')::boolean then
    perform private.raise_outside_variety(v_scope ->> 'variety_id', v_scope ->> 'variety_name');
  end if;
end $$;

create function public.page_review_queue()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_me text;
  v_varieties text[];
begin
  perform private.require_signed_in();
  v_me := private.current_contributor_id();

  -- The varieties this queue covers: a reviewer's own varieties (even when
  -- they also edit), otherwise everything the caller may read.
  select coalesce(array_agg(v.id), '{}') into v_varieties
  from content.varieties v
  where v.id = any ((select private.readable_varieties())::text[])
    and (private.has_review_authority(v.id) or not private.is_reviewer());

  return jsonb_build_object(
    'generated_at', now(),
    'varieties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'language', v.language_code,
        'language_name', lang.name,
        'direction', lang.direction,
        'can_review', private.has_review_authority(v.id),
        'reviewer_count', private.active_reviewer_count(v.id)
      ) order by v.name collate "C")
      from content.varieties v
      join content.languages lang on lang.code = v.language_code
      where v.id = any (v_varieties)
    ), '[]'::jsonb),
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'title', l.title,
        'subtitle', l.subtitle,
        'variety_id', l.variety_id,
        'submitted_at', l.submitted_at,
        'changed_at', l.updated_at,
        'item_count', (select count(*) from content.items i where i.lesson_id = l.id and i.retired_at is null),
        'unreviewed_items', (select count(*) from content.items i where i.lesson_id = l.id and i.retired_at is null and i.review_status <> 'approved'),
        'exercise_count', (select count(*) from content.exercises e where e.lesson_id = l.id and e.retired_at is null),
        'is_author', private.review_is_author('lesson', l.id, v_me)
      ) order by l.submitted_at, l.id)
      from content.review_queue q
      join content.lessons l on l.id = q.target_id
      where q.target_type = 'lesson' and q.variety_id = any (v_varieties)
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'lesson_id', i.lesson_id,
        'lesson_title', l.title,
        'position', i.position,
        'native', i.native,
        'romanisation', i.romanisation,
        'meaning', i.meaning,
        'variety_id', i.variety_id,
        'in_review', q.in_review,
        'submitted_at', q.submitted_at,
        'changed_at', q.changed_at,
        'is_author', private.review_is_author('item', i.id, v_me),
        'open_suggestions', (select count(*) from content.suggestions s where s.item_id = i.id and s.status = 'open')
      ) order by q.in_review desc, q.changed_at, i.id)
      from content.review_queue q
      join content.items i on i.id = q.target_id
      join content.lessons l on l.id = i.lesson_id
      where q.target_type = 'item' and q.variety_id = any (v_varieties)
    ), '[]'::jsonb)
  );
end $$;

create function public.page_review_item(p_item_id text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_me text;
  v_item content.items%rowtype;
  v_lesson content.lessons%rowtype;
  v_is_demo boolean;
  v_can_review boolean;
  v_is_author boolean;
  v_sole boolean;
begin
  perform private.review_page_guard('item', p_item_id);
  v_me := private.current_contributor_id();

  select * into v_item from content.items i where i.id = p_item_id;
  select * into v_lesson from content.lessons l where l.id = v_item.lesson_id;
  v_is_demo := exists (select 1 from content.demo_items d where d.item_id = v_item.id);
  v_can_review := private.has_review_authority(v_item.variety_id);
  v_is_author := private.review_is_author('item', v_item.id, v_me);
  v_sole := private.active_reviewer_count(v_item.variety_id) = 1;

  return jsonb_build_object(
    'generated_at', now(),
    'item', jsonb_build_object(
      'id', v_item.id,
      'position', v_item.position,
      'native', v_item.native,
      'romanisation', v_item.romanisation,
      'meaning', v_item.meaning,
      'context', v_item.context,
      'usage_note', v_item.usage_note,
      'variety_id', v_item.variety_id,
      'source_type', v_item.source_type,
      'source_citation', v_item.source_citation,
      'source_licence', v_item.source_licence,
      'source_retrieved', v_item.source_retrieved,
      'source_caveat', v_item.source_caveat,
      'review_status', v_item.review_status,
      'review_fingerprint', v_item.review_fingerprint,
      'revision_no', v_item.revision_no,
      'current_decision_id', v_item.current_decision_id,
      'text_author_id', v_item.text_author,
      'text_author_name', private.contributor_name(v_item.text_author),
      'is_demo', v_is_demo,
      'retired', v_item.retired_at is not null,
      'updated_at', v_item.updated_at
    ),
    'language', (
      select jsonb_build_object('code', lang.code, 'name', lang.name, 'direction', lang.direction)
      from content.languages lang where lang.code = split_part(v_item.id, '-', 1)
    ),
    'variety', (
      select jsonb_build_object('id', v.id, 'name', v.name, 'learner_label', v.learner_label)
      from content.varieties v where v.id = v_item.variety_id
    ),
    'lesson', jsonb_build_object(
      'id', v_lesson.id,
      'title', v_lesson.title,
      'subtitle', v_lesson.subtitle,
      'submitted_at', v_lesson.submitted_at,
      'review_status', v_lesson.review_status
    ),
    'siblings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'position', s.position,
        'native', s.native,
        'romanisation', s.romanisation,
        'meaning', s.meaning,
        'review_status', s.review_status
      ) order by s.position)
      from content.items s
      where s.lesson_id = v_item.lesson_id and s.retired_at is null
    ), '[]'::jsonb),
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seq', r.seq,
        'revision_no', r.revision_no,
        'reason', r.reason,
        'author_id', r.author_contributor_id,
        'author_name', private.contributor_name(r.author_contributor_id),
        'suggestion_id', r.suggestion_id,
        'review_fingerprint', r.review_fingerprint,
        'at', r.at,
        'fields', jsonb_build_object(
          'native', r.snapshot -> 'native',
          'romanisation', r.snapshot -> 'romanisation',
          'meaning', r.snapshot -> 'meaning',
          'context', r.snapshot -> 'context',
          'usage_note', r.snapshot -> 'usage_note',
          'source_citation', r.snapshot -> 'source_citation'
        )
      ) order by r.seq desc)
      from content.revisions r
      where r.object_type = 'item' and r.object_id = v_item.id
    ), '[]'::jsonb),
    'decisions', private.review_decisions_json('item', v_item.id, v_item.current_decision_id),
    'comments', private.review_comments_json('item', v_item.id),
    'suggestions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'suggester_id', s.suggester_contributor_id,
        'suggester_name', private.contributor_name(s.suggester_contributor_id),
        'proposed', s.proposed,
        'note', s.note,
        'status', s.status,
        'resolution_note', s.resolution_note,
        'resolved_at', s.resolved_at,
        'stale', s.base_review_fingerprint <> v_item.review_fingerprint,
        'mine', s.suggester_contributor_id = v_me,
        'created_at', s.created_at
      ) order by s.created_at desc)
      from content.suggestions s
      where s.item_id = v_item.id
    ), '[]'::jsonb),
    'required_scope', to_jsonb(private.review_required_scope(v_item.context, v_item.usage_note)),
    'viewer', jsonb_build_object(
      'contributor_id', v_me,
      'can_review', v_can_review,
      'is_author', v_is_author,
      'sole_reviewer', v_sole,
      'reviewer_count', private.active_reviewer_count(v_item.variety_id),
      'can_approve', v_can_review and not v_is_demo and v_item.retired_at is null and (not v_is_author or v_sole),
      'can_suggest', v_can_review and not v_is_demo and v_item.retired_at is null,
      'is_admin', private.is_admin()
    )
  );
end $$;

create function public.page_review_lesson(p_lesson_id text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_me text;
  v_lesson content.lessons%rowtype;
  v_is_demo boolean;
  v_can_review boolean;
  v_is_author boolean;
  v_sole boolean;
  v_exercises int;
  v_problems jsonb;
begin
  perform private.review_page_guard('lesson', p_lesson_id);
  v_me := private.current_contributor_id();

  select * into v_lesson from content.lessons l where l.id = p_lesson_id;
  v_is_demo := exists (
    select 1 from content.items i join content.demo_items d on d.item_id = i.id
    where i.lesson_id = v_lesson.id and i.retired_at is null
  );
  v_can_review := private.has_review_authority(v_lesson.variety_id);
  v_is_author := private.review_is_author('lesson', v_lesson.id, v_me);
  v_sole := private.active_reviewer_count(v_lesson.variety_id) = 1;
  select count(*) into v_exercises from content.exercises e where e.lesson_id = v_lesson.id and e.retired_at is null;
  v_problems := coalesce(private.lesson_problems(v_lesson.id), '[]'::jsonb);

  return jsonb_build_object(
    'generated_at', now(),
    'lesson', jsonb_build_object(
      'id', v_lesson.id,
      'title', v_lesson.title,
      'subtitle', v_lesson.subtitle,
      'objective', v_lesson.objective,
      'variety_id', v_lesson.variety_id,
      'review_status', v_lesson.review_status,
      'review_fingerprint', v_lesson.review_fingerprint,
      'revision_no', v_lesson.revision_no,
      'current_decision_id', v_lesson.current_decision_id,
      'submitted_at', v_lesson.submitted_at,
      'is_demo', v_is_demo,
      'retired', v_lesson.retired_at is not null,
      'updated_at', v_lesson.updated_at
    ),
    'language', (
      select jsonb_build_object('code', lang.code, 'name', lang.name, 'direction', lang.direction)
      from content.languages lang where lang.code = split_part(v_lesson.id, '-', 1)
    ),
    'variety', (
      select jsonb_build_object('id', v.id, 'name', v.name, 'learner_label', v.learner_label)
      from content.varieties v where v.id = v_lesson.variety_id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'position', i.position,
        'native', i.native,
        'romanisation', i.romanisation,
        'meaning', i.meaning,
        'review_status', i.review_status,
        'is_demo', exists (select 1 from content.demo_items d where d.item_id = i.id),
        'awaiting_countersign', exists (
          select 1 from content.review_decisions d
          where d.id = i.current_decision_id and d.sole_reviewer and d.decision = 'approve'
            and not exists (select 1 from content.countersignatures c where c.decision_id = d.id)
        )
      ) order by i.position)
      from content.items i
      where i.lesson_id = v_lesson.id and i.retired_at is null
    ), '[]'::jsonb),
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'position', e.position,
        'kind', e.kind,
        'prompt', e.prompt,
        'answer_item_id', e.answer_item_id,
        'options', to_jsonb(e.options)
      ) order by e.position)
      from content.exercises e
      where e.lesson_id = v_lesson.id and e.retired_at is null
    ), '[]'::jsonb),
    'exercise_count', v_exercises,
    'problems', v_problems,
    'decisions', private.review_decisions_json('lesson', v_lesson.id, v_lesson.current_decision_id),
    'comments', private.review_comments_json('lesson', v_lesson.id),
    'viewer', jsonb_build_object(
      'contributor_id', v_me,
      'can_review', v_can_review,
      'is_author', v_is_author,
      'sole_reviewer', v_sole,
      'reviewer_count', private.active_reviewer_count(v_lesson.variety_id),
      'can_approve', v_can_review and not v_is_demo and v_lesson.retired_at is null
        and (not v_is_author or v_sole) and v_exercises >= 6
        and not exists (select 1 from jsonb_array_elements(v_problems) p where p ->> 'severity' = 'blocking'),
      'is_admin', private.is_admin()
    )
  );
end $$;

create function public.page_admin_suggestions()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.require_signed_in();
  if not private.is_editor_or_admin() then
    perform private.raise('PL403_NOT_EDITOR', 'Only an editor or an admin can open suggestions.');
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'item_id', s.item_id,
        'lesson_id', i.lesson_id,
        'lesson_title', l.title,
        'variety_id', s.variety_id,
        'variety_name', v.name,
        'language', lang.code,
        'language_name', lang.name,
        'direction', lang.direction,
        'suggester_id', s.suggester_contributor_id,
        'suggester_name', private.contributor_name(s.suggester_contributor_id),
        'note', s.note,
        'proposed', s.proposed,
        'current', jsonb_build_object(
          'native', i.native,
          'romanisation', i.romanisation,
          'meaning', i.meaning,
          'context', i.context,
          'usage_note', i.usage_note
        ),
        'review_fingerprint', i.review_fingerprint,
        'review_status', i.review_status,
        'lesson_submitted', l.submitted_at is not null,
        'item_retired', i.retired_at is not null,
        'stale', s.base_review_fingerprint <> i.review_fingerprint,
        'can_resolve', private.can_edit_language(lang.code),
        'created_at', s.created_at
      ) order by s.created_at, s.id)
      from content.suggestions s
      join content.items i on i.id = s.item_id
      join content.lessons l on l.id = i.lesson_id
      join content.varieties v on v.id = s.variety_id
      join content.languages lang on lang.code = v.language_code
      where s.status = 'open'
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(r order by r ->> 'resolved_at' desc)
      from (
        select jsonb_build_object(
          'id', s.id,
          'item_id', s.item_id,
          'status', s.status,
          'suggester_name', private.contributor_name(s.suggester_contributor_id),
          'resolved_by_name', private.contributor_name(s.resolved_by),
          'resolution_note', s.resolution_note,
          'resolved_at', s.resolved_at
        ) as r
        from content.suggestions s
        where s.status <> 'open'
        order by s.resolved_at desc nulls last
        limit 10
      ) recent
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function
  public.record_review_decision(text, text, text, text, text[], text),
  public.countersign_decision(uuid, text),
  public.create_suggestion(text, text, jsonb, text),
  public.withdraw_suggestion(uuid),
  public.accept_suggestion(uuid, text),
  public.decline_suggestion(uuid, text),
  public.add_review_comment(text, text, text, uuid),
  public.redact_comment(uuid, text),
  public.page_review_queue(),
  public.page_review_item(text),
  public.page_review_lesson(text),
  public.page_admin_suggestions()
from public, anon;

grant execute on function
  public.record_review_decision(text, text, text, text, text[], text),
  public.countersign_decision(uuid, text),
  public.create_suggestion(text, text, jsonb, text),
  public.withdraw_suggestion(uuid),
  public.accept_suggestion(uuid, text),
  public.decline_suggestion(uuid, text),
  public.add_review_comment(text, text, text, uuid),
  public.redact_comment(uuid, text),
  public.page_review_queue(),
  public.page_review_item(text),
  public.page_review_lesson(text),
  public.page_admin_suggestions()
to authenticated;

-- The helpers the invoker page reads above call. Definer ones answer only
-- for staff; the rest read through the caller's RLS.
revoke all on function
  private.review_target_scope(text, text),
  private.contributor_name(text),
  private.review_is_author(text, text, text),
  private.review_required_scope(text, text),
  private.raise_outside_variety(text, text),
  private.is_reviewer(),
  private.is_editor_or_admin(),
  private.require_signed_in(),
  private.review_decisions_json(text, text, uuid),
  private.review_comments_json(text, text),
  private.review_page_guard(text, text)
from public, anon;

grant execute on function
  private.review_target_scope(text, text),
  private.contributor_name(text),
  private.review_is_author(text, text, text),
  private.review_required_scope(text, text),
  private.raise_outside_variety(text, text),
  private.is_reviewer(),
  private.is_editor_or_admin(),
  private.require_signed_in(),
  private.review_decisions_json(text, text, uuid),
  private.review_comments_json(text, text),
  private.review_page_guard(text, text)
to authenticated;
