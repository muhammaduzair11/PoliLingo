-- 20260928001400_editor.sql
-- Owner: Track E, the editor (docs/platform.md §3.9 E, §4.10).
--
-- Everything the course maker writes and reads: minting ids, creating and
-- editing units, lessons, items (phrases) and exercises, moving, reordering
-- and retiring them, submitting a lesson for review, the publish gates and
-- the demo sunset (admin), and the editor's page reads.
--
-- Conventions (§3.2): writes are SECURITY DEFINER with search_path '' and
-- every name qualified; page reads are SECURITY INVOKER over RLS. Checks run
-- in the order 401 → profile → role → 422 input → 404 → 403 scope → 409
-- state → 422 content. The content triggers (20260928000200) still do the
-- deep work: normalising and checking native text, fingerprints, voiding an
-- approval when learner-visible text changes, the exercise option rules and
-- the revisions log. These functions only choose what to write, in what
-- order, and with which revision reason.
--
-- Editors are scoped to a language: an editor grant with a null language
-- (and every admin) covers them all. Demo lessons and their phrases and
-- exercises are frozen (PL409_DEMO_FROZEN); a demo lesson may still change
-- position when a lesson is added, reordered or retired around it.

-- ---------------------------------------------------------------------------
-- Internal helpers. No grants: only the definer functions below call them,
-- as the owner.
-- ---------------------------------------------------------------------------

-- Six random hex digits. Its own function so a test can make it collide.
create function private.editor_random_hex6()
returns text
language sql
volatile
set search_path = ''
as $$
  select encode(extensions.gen_random_bytes(3), 'hex')
$$;

-- 401 → profile → role. Returns the caller's contributor id.
create function private.editor_gate()
returns text
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid()) then
    perform private.raise('PL403_NO_PROFILE', 'Tell us your age band first, then try again.');
  end if;
  if not exists (
    select 1 from private.my_active_grants() g where g.role in ('admin', 'editor')
  ) then
    perform private.raise('PL403_NOT_EDITOR', 'Only an editor can change lessons.');
  end if;
  return private.current_contributor_id();
end $$;

-- 401 → profile → admin role, for the gate and sunset switches.
create function private.editor_admin_gate()
returns text
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid()) then
    perform private.raise('PL403_NO_PROFILE', 'Tell us your age band first, then try again.');
  end if;
  if not private.is_admin() then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can do that.');
  end if;
  return private.current_contributor_id();
end $$;

-- The language scope check (403_OUTSIDE_LANGUAGE), naming the language.
create function private.editor_scope(p_language text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
begin
  if not private.can_edit_language(p_language) then
    select l.name into v_name from content.languages l where l.code = p_language;
    perform private.raise(
      'PL403_OUTSIDE_LANGUAGE',
      format('This belongs to %s, which your editor role doesn''t cover.', coalesce(v_name, p_language)),
      jsonb_build_object('language', p_language)
    );
  end if;
end $$;

-- A trimmed text field with its length rules (422_LENGTH). p_min 0 means
-- optional: empty comes back as null. Lengths count characters, as
-- char_length does.
create function private.editor_text(p_value text, p_label text, p_min int, p_max int)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v text := nullif(
    regexp_replace(coalesce(p_value, ''), '^' || private.js_ws() || '+|' || private.js_ws() || '+$', '', 'g'),
    ''
  );
  v_len int := coalesce(char_length(v), 0);
begin
  if v is null then
    if p_min > 0 then
      perform private.raise('PL422_LENGTH', format('%s can''t be empty.', p_label),
        jsonb_build_object('field', p_label, 'min', p_min, 'max', p_max, 'length', 0));
    end if;
    return null;
  end if;
  if v_len < p_min then
    perform private.raise('PL422_LENGTH', format('%s needs at least %s characters.', p_label, p_min),
      jsonb_build_object('field', p_label, 'min', p_min, 'max', p_max, 'length', v_len));
  end if;
  if v_len > p_max then
    perform private.raise('PL422_LENGTH',
      format('%s can be at most %s characters. This one has %s.', p_label, p_max, v_len),
      jsonb_build_object('field', p_label, 'min', p_min, 'max', p_max, 'length', v_len));
  end if;
  return v;
end $$;

-- A JSON list of strings as text[] (422_BAD_INPUT otherwise). Null or JSON
-- null is an empty list.
create function private.editor_text_array(p jsonb, p_label text)
returns text[]
language plpgsql
set search_path = ''
as $$
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return '{}';
  end if;
  if jsonb_typeof(p) <> 'array'
     or exists (select 1 from jsonb_array_elements(p) e where jsonb_typeof(e) <> 'string') then
    perform private.raise('PL422_BAD_INPUT', format('%s must be a list of words.', p_label));
  end if;
  return array(select e from jsonb_array_elements_text(p) with ordinality a(e, i) order by i);
end $$;

-- Refuses keys outside p_allowed (422_BAD_INPUT), and a non-object.
create function private.editor_keys(p jsonb, p_allowed text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_bad text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    perform private.raise('PL422_BAD_INPUT', 'The changes must be sent as an object.');
  end if;
  select k into v_bad from jsonb_object_keys(p) k where k <> all (p_allowed) limit 1;
  if v_bad is not null then
    perform private.raise('PL422_BAD_INPUT', format('%s is not a field that can be set here.', v_bad),
      jsonb_build_object('field', v_bad));
  end if;
end $$;

-- The position a new child takes among p_count live siblings: the end when
-- p_position is null, otherwise 1..p_count+1.
create function private.editor_slot(p_count int, p_position int)
returns int
language plpgsql
set search_path = ''
as $$
begin
  if p_position is null then
    return p_count + 1;
  end if;
  if p_position < 1 or p_position > p_count + 1 then
    perform private.raise('PL422_BAD_INPUT', format('The position must be between 1 and %s.', p_count + 1),
      jsonb_build_object('position', p_position, 'max', p_count + 1));
  end if;
  return p_position;
end $$;

-- Moves every live sibling at or after p_from by p_delta, recorded as a
-- reorder. Positions are unique but deferred, so the shift can pass
-- through duplicates.
create function private.editor_shift(p_table text, p_parent_col text, p_parent text, p_from int, p_delta int)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_table not in ('units', 'lessons', 'items', 'exercises') then
    raise exception 'editor_shift: unknown table %', p_table;
  end if;
  perform set_config('polilingo.revision_reason', 'reorder', true);
  execute format(
    'update content.%I set position = position + $1 where %I = $2 and retired_at is null and position >= $3',
    p_table, p_parent_col
  ) using p_delta, p_parent, p_from;
  perform set_config('polilingo.revision_reason', '', true);
end $$;

-- A new id <lang>-<unt|lsn|itm|exr>-<6 hex>, registered in id_registry. A
-- collision (with the registry or with a row that was never registered)
-- simply tries again.
create function private.editor_mint(p_type text, p_language text, p_contributor text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_infix text := case p_type
    when 'unit' then 'unt' when 'lesson' then 'lsn' when 'item' then 'itm' when 'exercise' then 'exr'
  end;
  v_id text;
  v_rows int;
begin
  if v_infix is null then
    perform private.raise('PL422_BAD_INPUT', 'Ids are made for units, lessons, items and exercises.');
  end if;
  for v_try in 1 .. 25 loop
    v_id := p_language || '-' || v_infix || '-' || lower(coalesce(private.editor_random_hex6(), ''));
    continue when v_id !~ ('^[a-z]{2,3}-' || v_infix || '-[0-9a-f]{6}$');
    continue when case p_type
      when 'unit' then exists (select 1 from content.units t where t.id = v_id)
      when 'lesson' then exists (select 1 from content.lessons t where t.id = v_id)
      when 'item' then exists (select 1 from content.items t where t.id = v_id)
      else exists (select 1 from content.exercises t where t.id = v_id)
    end;
    insert into content.id_registry (id, type, language_code, minted_by)
    values (v_id, p_type, p_language, p_contributor)
    on conflict (id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      return v_id;
    end if;
  end loop;
  raise exception 'No free % id for % after 25 tries.', p_type, p_language;
end $$;

-- A reserved id handed in by the web (reserve_content_id), checked: minted
-- for this type and language, not retired, and not used yet.
create function private.editor_claim(p_id text, p_type text, p_language text)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from content.id_registry r
    where r.id = p_id and r.type = p_type and r.language_code = p_language and r.retired_at is null
  ) or (p_type = 'item' and exists (select 1 from content.items i where i.id = p_id))
    or (p_type = 'exercise' and exists (select 1 from content.exercises e where e.id = p_id)) then
    perform private.raise('PL422_BAD_INPUT', format('%s isn''t a free reserved id for a new %s.', p_id, p_type),
      jsonb_build_object('id', p_id));
  end if;
  return p_id;
end $$;

-- Whether a lesson holds demo phrases (then it is frozen).
create function private.editor_lesson_is_demo(p_lesson_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from content.items i
    join content.demo_items d on d.item_id = i.id
    where i.lesson_id = p_lesson_id
  )
$$;

create function private.editor_demo_frozen(p_what text, p_id text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.raise(
    'PL409_DEMO_FROZEN',
    format('%s is starter content, so it can''t be changed. Write new phrases in a lesson of your own.', p_what),
    jsonb_build_object('id', p_id)
  );
end $$;

create function private.editor_not_found(p_what text, p_id text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.raise('PL404_NOT_FOUND', format('We couldn''t find that %s.', p_what),
    jsonb_build_object('id', p_id));
end $$;

create function private.editor_retired(p_what text, p_id text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.raise('PL409_RETIRED', format('This %s has been retired, so it can''t be changed.', p_what),
    jsonb_build_object('id', p_id));
end $$;

-- The item fields in p (create_item's p_fields, update_item's p_patch),
-- checked and cleaned: 422_LENGTH, 422_PROVENANCE, 422_BAD_INPUT. Keys that
-- are absent stay absent; present ones come back with their clean value
-- (JSON null for a cleared optional field).
create function private.editor_item_fields(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb;
  v_date date;
  v_bad boolean := false;
begin
  if p ? 'native' then
    v := v || jsonb_build_object('native',
      private.editor_text(private.normalise_native(coalesce(p ->> 'native', '')), 'The phrase', 1, 300));
  end if;
  if p ? 'romanisation' then
    v := v || jsonb_build_object('romanisation', private.editor_text(p ->> 'romanisation', 'The romanisation', 1, 300));
  end if;
  if p ? 'meaning' then
    v := v || jsonb_build_object('meaning', private.editor_text(p ->> 'meaning', 'The meaning', 1, 200));
  end if;
  if p ? 'context' then
    v := v || jsonb_build_object('context', private.editor_text(p ->> 'context', 'The context', 0, 300));
  end if;
  if p ? 'usage_note' then
    v := v || jsonb_build_object('usage_note', private.editor_text(p ->> 'usage_note', 'The usage note', 0, 500));
  end if;
  if p ? 'variety' then
    v := v || jsonb_build_object('variety', nullif(btrim(coalesce(p ->> 'variety', '')), ''));
  end if;
  if p ? 'source_type' then
    if coalesce(p ->> 'source_type', '') not in ('reviewer_attested', 'community_attested', 'published_work', 'original') then
      perform private.raise('PL422_PROVENANCE', 'Choose where this phrase comes from.',
        jsonb_build_object('field', 'source_type'));
    end if;
    v := v || jsonb_build_object('source_type', p ->> 'source_type');
  end if;
  if p ? 'source_citation' then
    if char_length(btrim(coalesce(p ->> 'source_citation', ''))) not between 3 and 300 then
      perform private.raise('PL422_PROVENANCE', 'Say where this phrase comes from, in 3 to 300 characters.',
        jsonb_build_object('field', 'source_citation'));
    end if;
    v := v || jsonb_build_object('source_citation', btrim(p ->> 'source_citation'));
  end if;
  if p ? 'source_licence' then
    if char_length(btrim(coalesce(p ->> 'source_licence', ''))) not between 2 and 200 then
      perform private.raise('PL422_PROVENANCE', 'Say what licence this phrase is used under, in 2 to 200 characters.',
        jsonb_build_object('field', 'source_licence'));
    end if;
    v := v || jsonb_build_object('source_licence', btrim(p ->> 'source_licence'));
  end if;
  if p ? 'source_retrieved' then
    if nullif(btrim(coalesce(p ->> 'source_retrieved', '')), '') is null then
      v := v || jsonb_build_object('source_retrieved', null);
    else
      begin
        v_date := (p ->> 'source_retrieved')::date;
      exception when others then
        v_bad := true;
      end;
      if v_bad or v_date > (now() at time zone 'utc')::date + 1 then
        perform private.raise('PL422_PROVENANCE', 'The retrieved date must be a real date, not in the future.',
          jsonb_build_object('field', 'source_retrieved'));
      end if;
      v := v || jsonb_build_object('source_retrieved', v_date);
    end if;
  end if;
  if p ? 'source_caveat' then
    v := v || jsonb_build_object('source_caveat', private.editor_text(p ->> 'source_caveat', 'The source caveat', 0, 500));
  end if;
  if p ? 'tags' then
    v := v || jsonb_build_object('tags', to_jsonb(private.editor_text_array(p -> 'tags', 'Tags')));
  end if;
  if p ? 'skills' then
    v := v || jsonb_build_object('skills', to_jsonb(private.editor_text_array(p -> 'skills', 'Skills')));
  end if;
  return v;
end $$;

-- The exercise fields in p, checked and cleaned (422_BAD_INPUT, 422_LENGTH).
create function private.editor_exercise_fields(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb;
  v_difficulty int;
begin
  if p ? 'kind' then
    if coalesce(p ->> 'kind', '') not in ('meaning', 'translation', 'match', 'assemble', 'context') then
      perform private.raise('PL422_BAD_INPUT', 'Choose a kind of exercise.', jsonb_build_object('field', 'kind'));
    end if;
    v := v || jsonb_build_object('kind', p ->> 'kind');
  end if;
  if p ? 'answer' then
    if jsonb_typeof(p -> 'answer') is distinct from 'string' or btrim(p ->> 'answer') = '' then
      perform private.raise('PL422_BAD_INPUT', 'Choose the phrase that answers this exercise.',
        jsonb_build_object('field', 'answer'));
    end if;
    v := v || jsonb_build_object('answer', btrim(p ->> 'answer'));
  end if;
  if p ? 'prompt' then
    v := v || jsonb_build_object('prompt', private.editor_text(p ->> 'prompt', 'The prompt', 1, 300));
  end if;
  if p ? 'options' then
    v := v || jsonb_build_object('options', to_jsonb(private.editor_text_array(p -> 'options', 'The choices')));
  end if;
  if p ? 'difficulty' then
    if jsonb_typeof(p -> 'difficulty') = 'null' then
      v := v || jsonb_build_object('difficulty', null);
    else
      if jsonb_typeof(p -> 'difficulty') <> 'number'
         or (p ->> 'difficulty') !~ '^[1-5]$' then
        perform private.raise('PL422_BAD_INPUT', 'Difficulty is a whole number from 1 to 5.',
          jsonb_build_object('field', 'difficulty'));
      end if;
      v_difficulty := (p ->> 'difficulty')::int;
      v := v || jsonb_build_object('difficulty', v_difficulty);
    end if;
  end if;
  if p ? 'skills' then
    v := v || jsonb_build_object('skills', to_jsonb(private.editor_text_array(p -> 'skills', 'Skills')));
  end if;
  return v;
end $$;

-- The variety a lesson or item uses: it must exist (404) and be of the
-- same language (422_VARIETY_MISMATCH).
create function private.editor_variety(p_variety text, p_language text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_language text;
begin
  select v.language_code into v_language from content.varieties v where v.id = p_variety;
  if not found then
    perform private.editor_not_found('variety', p_variety);
  end if;
  if v_language <> p_language then
    perform private.raise('PL422_VARIETY_MISMATCH', 'That variety belongs to a different language.',
      jsonb_build_object('variety', p_variety, 'language', p_language));
  end if;
  return p_variety;
end $$;

-- Retires one lesson with its live exercises and items (in that order, so
-- no live exercise is left pointing at a retired phrase). Returns the ids.
create function private.editor_retire_lesson_tree(p_lesson_id text)
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_ids text[] := '{}';
  v_part text[];
begin
  perform set_config('polilingo.revision_reason', 'retire', true);
  with r as (
    update content.exercises e set retired_at = now(), position = null
    where e.lesson_id = p_lesson_id and e.retired_at is null
    returning e.id
  ) select coalesce(array_agg(r.id), '{}') into v_part from r;
  v_ids := v_ids || v_part;
  with r as (
    update content.items i set retired_at = now(), position = null
    where i.lesson_id = p_lesson_id and i.retired_at is null
    returning i.id
  ) select coalesce(array_agg(r.id), '{}') into v_part from r;
  v_ids := v_ids || v_part;
  update content.lessons l set retired_at = now(), position = null
  where l.id = p_lesson_id and l.retired_at is null;
  v_ids := v_ids || p_lesson_id;
  perform set_config('polilingo.revision_reason', '', true);
  return v_ids;
end $$;

-- ---------------------------------------------------------------------------
-- reserve_content_id
-- ---------------------------------------------------------------------------

create function public.reserve_content_id(p_type text, p_language text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
begin
  if p_type is null or p_type not in ('unit', 'lesson', 'item', 'exercise') then
    perform private.raise('PL422_BAD_INPUT', 'Ids are made for units, lessons, items and exercises.',
      jsonb_build_object('type', p_type));
  end if;
  if not exists (select 1 from content.languages l where l.code = p_language) then
    perform private.editor_not_found('language', p_language);
  end if;
  perform private.editor_scope(p_language);
  return private.editor_mint(p_type, p_language, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- create_unit, create_lesson, create_item, create_exercise
-- ---------------------------------------------------------------------------

create function public.create_unit(
  p_course_id text,
  p_title text,
  p_goal text,
  p_theme text default null,
  p_position int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_title text := private.editor_text(p_title, 'The unit title', 1, 60);
  v_goal text := private.editor_text(p_goal, 'The unit goal', 10, 300);
  v_theme text := private.editor_text(p_theme, 'The theme', 0, 60);
  v_course content.courses%rowtype;
  v_count int;
  v_pos int;
  v_id text;
begin
  select * into v_course from content.courses c where c.id = p_course_id for update;
  if not found then
    perform private.editor_not_found('course', p_course_id);
  end if;
  perform private.editor_scope(v_course.language_code);
  if v_course.retired_at is not null then
    perform private.editor_retired('course', p_course_id);
  end if;

  select count(*) into v_count from content.units u where u.course_id = p_course_id and u.retired_at is null;
  v_pos := private.editor_slot(v_count, p_position);
  if v_pos <= v_count then
    perform private.editor_shift('units', 'course_id', p_course_id, v_pos, 1);
  end if;

  v_id := private.editor_mint('unit', v_course.language_code, v_me);
  -- New units start held back: an admin opens the gate once the unit is ready.
  insert into content.units (id, course_id, position, title, goal, theme, publish_gate)
  values (v_id, p_course_id, v_pos, v_title, v_goal, v_theme, 'blocked');

  perform private.audit('content.created', 'unit', v_id,
    jsonb_build_object('course_id', p_course_id, 'position', v_pos));
  return v_id;
end $$;

create function public.create_lesson(
  p_unit_id text,
  p_title text,
  p_objective text,
  p_subtitle text default '',
  p_variety_id text default null,
  p_estimated_minutes int default null,
  p_position int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_title text := private.editor_text(p_title, 'The lesson title', 1, 60);
  v_objective text := private.editor_text(p_objective, 'The objective', 10, 300);
  v_subtitle text := coalesce(private.editor_text(p_subtitle, 'The subtitle', 0, 120), '');
  v_unit content.units%rowtype;
  v_course content.courses%rowtype;
  v_variety text;
  v_count int;
  v_pos int;
  v_id text;
begin
  if p_estimated_minutes is not null and p_estimated_minutes not between 3 and 15 then
    perform private.raise('PL422_BAD_INPUT', 'A lesson takes between 3 and 15 minutes.',
      jsonb_build_object('field', 'estimated_minutes'));
  end if;

  select * into v_unit from content.units u where u.id = p_unit_id for update;
  if not found then
    perform private.editor_not_found('unit', p_unit_id);
  end if;
  select * into v_course from content.courses c where c.id = v_unit.course_id;
  perform private.editor_scope(v_course.language_code);
  if v_unit.retired_at is not null then
    perform private.editor_retired('unit', p_unit_id);
  end if;
  if v_course.retired_at is not null then
    perform private.editor_retired('course', v_course.id);
  end if;

  v_variety := private.editor_variety(
    coalesce(nullif(btrim(coalesce(p_variety_id, '')), ''), v_course.variety_id),
    v_course.language_code
  );

  select count(*) into v_count from content.lessons l where l.unit_id = p_unit_id and l.retired_at is null;
  v_pos := private.editor_slot(v_count, p_position);
  if v_pos <= v_count then
    perform private.editor_shift('lessons', 'unit_id', p_unit_id, v_pos, 1);
  end if;

  v_id := private.editor_mint('lesson', v_course.language_code, v_me);
  insert into content.lessons (
    id, course_id, unit_id, position, title, subtitle, objective, variety_id, estimated_minutes
  ) values (
    v_id, v_course.id, p_unit_id, v_pos, v_title, v_subtitle, v_objective, v_variety, p_estimated_minutes
  );

  perform private.audit('content.created', 'lesson', v_id,
    jsonb_build_object('unit_id', p_unit_id, 'position', v_pos, 'variety', v_variety));
  return v_id;
end $$;

create function public.create_item(p_lesson_id text, p_fields jsonb, p_position int default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_f jsonb;
  v_lesson content.lessons%rowtype;
  v_language text;
  v_variety text;
  v_count int;
  v_pos int;
  v_id text;
  v_item content.items%rowtype;
begin
  perform private.editor_keys(p_fields, array[
    'id', 'native', 'romanisation', 'meaning', 'context', 'usage_note', 'variety', 'source_type',
    'source_citation', 'source_licence', 'source_retrieved', 'source_caveat', 'tags', 'skills'
  ]);
  -- Every required field is checked, present or not.
  v_f := private.editor_item_fields(
    jsonb_build_object('native', null, 'romanisation', null, 'meaning', null,
      'source_type', null, 'source_citation', null, 'source_licence', null) || p_fields
  );

  select * into v_lesson from content.lessons l where l.id = p_lesson_id for update;
  if not found then
    perform private.editor_not_found('lesson', p_lesson_id);
  end if;
  v_language := split_part(v_lesson.id, '-', 1);
  perform private.editor_scope(v_language);
  if v_lesson.retired_at is not null then
    perform private.editor_retired('lesson', p_lesson_id);
  end if;
  if private.editor_lesson_is_demo(p_lesson_id) then
    perform private.editor_demo_frozen('This lesson', p_lesson_id);
  end if;

  select count(*) into v_count from content.items i where i.lesson_id = p_lesson_id and i.retired_at is null;
  if v_count >= 12 then
    perform private.raise('PL422_LESSON_FULL', 'A lesson holds at most 12 phrases. Start a new lesson for more.',
      jsonb_build_object('lesson_id', p_lesson_id, 'items', v_count));
  end if;
  v_pos := private.editor_slot(v_count, p_position);
  v_variety := private.editor_variety(coalesce(v_f ->> 'variety', v_lesson.variety_id), v_language);

  if nullif(btrim(coalesce(p_fields ->> 'id', '')), '') is not null then
    v_id := private.editor_claim(btrim(p_fields ->> 'id'), 'item', v_language);
  else
    v_id := private.editor_mint('item', v_language, v_me);
  end if;
  if v_pos <= v_count then
    perform private.editor_shift('items', 'lesson_id', p_lesson_id, v_pos, 1);
  end if;

  -- The item trigger normalises the text again, applies the text rules
  -- (their 422s name the character and its position) and fingerprints it.
  insert into content.items (
    id, lesson_id, position, native, romanisation, meaning, context, usage_note, variety_id,
    tags, skills, source_type, source_citation, source_licence, source_retrieved, source_caveat
  ) values (
    v_id, p_lesson_id, v_pos, v_f ->> 'native', v_f ->> 'romanisation', v_f ->> 'meaning',
    v_f ->> 'context', v_f ->> 'usage_note', v_variety,
    private.editor_text_array(v_f -> 'tags', 'tags'),
    private.editor_text_array(v_f -> 'skills', 'skills'),
    v_f ->> 'source_type', v_f ->> 'source_citation', v_f ->> 'source_licence',
    (v_f ->> 'source_retrieved')::date, v_f ->> 'source_caveat'
  )
  returning * into v_item;

  perform private.audit('content.created', 'item', v_id,
    jsonb_build_object('lesson_id', p_lesson_id, 'position', v_pos));
  return jsonb_build_object(
    'id', v_item.id,
    'text_fingerprint', v_item.text_fingerprint,
    'review_fingerprint', v_item.review_fingerprint,
    'revision_no', v_item.revision_no
  );
end $$;

create function public.create_exercise(p_lesson_id text, p_fields jsonb, p_position int default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_f jsonb;
  v_lesson content.lessons%rowtype;
  v_language text;
  v_count int;
  v_pos int;
  v_id text;
begin
  perform private.editor_keys(p_fields, array['id', 'kind', 'answer', 'prompt', 'options', 'difficulty', 'skills']);
  v_f := private.editor_exercise_fields(
    jsonb_build_object('kind', null, 'answer', null, 'prompt', null) || p_fields
  );

  select * into v_lesson from content.lessons l where l.id = p_lesson_id for update;
  if not found then
    perform private.editor_not_found('lesson', p_lesson_id);
  end if;
  v_language := split_part(v_lesson.id, '-', 1);
  perform private.editor_scope(v_language);
  if v_lesson.retired_at is not null then
    perform private.editor_retired('lesson', p_lesson_id);
  end if;
  if private.editor_lesson_is_demo(p_lesson_id) then
    perform private.editor_demo_frozen('This lesson', p_lesson_id);
  end if;

  select count(*) into v_count from content.exercises e where e.lesson_id = p_lesson_id and e.retired_at is null;
  v_pos := private.editor_slot(v_count, p_position);
  if nullif(btrim(coalesce(p_fields ->> 'id', '')), '') is not null then
    v_id := private.editor_claim(btrim(p_fields ->> 'id'), 'exercise', v_language);
  else
    v_id := private.editor_mint('exercise', v_language, v_me);
  end if;
  if v_pos <= v_count then
    perform private.editor_shift('exercises', 'lesson_id', p_lesson_id, v_pos, 1);
  end if;

  -- The exercise trigger applies the option rules (422_BAD_OPTION,
  -- 422_OPTION_EQUALS_ANSWER).
  insert into content.exercises (id, lesson_id, position, kind, answer_item_id, prompt, options, difficulty, skills)
  values (
    v_id, p_lesson_id, v_pos, v_f ->> 'kind', v_f ->> 'answer', v_f ->> 'prompt',
    private.editor_text_array(v_f -> 'options', 'options'),
    (v_f ->> 'difficulty')::smallint,
    private.editor_text_array(v_f -> 'skills', 'skills')
  );

  perform private.audit('content.created', 'exercise', v_id,
    jsonb_build_object('lesson_id', p_lesson_id, 'position', v_pos, 'kind', v_f ->> 'kind'));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- update_unit, update_lesson, update_item, update_exercise
--
-- p_expected_revision is the revision_no the editor saw; a different one is
-- 409_STALE_EDIT. A patch that changes nothing is 422_NO_CHANGE (the
-- revision triggers keep revision_no when nothing but bookkeeping changes).
-- ---------------------------------------------------------------------------

create function private.editor_stale(p_what text, p_id text, p_expected int, p_current int)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_expected is distinct from p_current then
    perform private.raise('PL409_STALE_EDIT',
      format('Someone saved a newer version of this %s while you were editing. Reload, then make your change again.', p_what),
      jsonb_build_object('id', p_id, 'expected_revision', p_expected, 'current_revision', p_current));
  end if;
end $$;

create function private.editor_no_change(p_id text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.raise('PL422_NO_CHANGE', 'Nothing has changed, so there''s nothing to save.',
    jsonb_build_object('id', p_id));
end $$;

create function public.update_unit(p_id text, p_expected_revision int, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_title text;
  v_goal text;
  v_theme text;
  v_unit content.units%rowtype;
  v_new int;
begin
  perform private.editor_keys(p_patch, array['title', 'goal', 'theme']);
  if p_expected_revision is null then
    perform private.raise('PL422_BAD_INPUT', 'Say which version you edited.');
  end if;
  if p_patch ? 'title' then v_title := private.editor_text(p_patch ->> 'title', 'The unit title', 1, 60); end if;
  if p_patch ? 'goal' then v_goal := private.editor_text(p_patch ->> 'goal', 'The unit goal', 10, 300); end if;
  if p_patch ? 'theme' then v_theme := private.editor_text(p_patch ->> 'theme', 'The theme', 0, 60); end if;

  select * into v_unit from content.units u where u.id = p_id for update;
  if not found then
    perform private.editor_not_found('unit', p_id);
  end if;
  perform private.editor_scope(split_part(p_id, '-', 1));
  if v_unit.retired_at is not null then
    perform private.editor_retired('unit', p_id);
  end if;
  perform private.editor_stale('unit', p_id, p_expected_revision, v_unit.revision_no);

  update content.units u set
    title = case when p_patch ? 'title' then v_title else u.title end,
    goal = case when p_patch ? 'goal' then v_goal else u.goal end,
    theme = case when p_patch ? 'theme' then v_theme else u.theme end
  where u.id = p_id
  returning u.revision_no into v_new;
  if v_new = v_unit.revision_no then
    perform private.editor_no_change(p_id);
  end if;

  perform private.audit('content.updated', 'unit', p_id,
    jsonb_build_object('fields', (select jsonb_agg(k order by k) from jsonb_object_keys(p_patch) k), 'revision_no', v_new));
  return jsonb_build_object('id', p_id, 'revision_no', v_new);
end $$;

create function public.update_lesson(p_id text, p_expected_revision int, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_title text;
  v_subtitle text;
  v_objective text;
  v_minutes int;
  v_variety text;
  v_lesson content.lessons%rowtype;
  v_after content.lessons%rowtype;
begin
  perform private.editor_keys(p_patch, array['title', 'subtitle', 'objective', 'variety', 'estimated_minutes']);
  if p_expected_revision is null then
    perform private.raise('PL422_BAD_INPUT', 'Say which version you edited.');
  end if;
  if p_patch ? 'title' then v_title := private.editor_text(p_patch ->> 'title', 'The lesson title', 1, 60); end if;
  if p_patch ? 'subtitle' then v_subtitle := coalesce(private.editor_text(p_patch ->> 'subtitle', 'The subtitle', 0, 120), ''); end if;
  if p_patch ? 'objective' then v_objective := private.editor_text(p_patch ->> 'objective', 'The objective', 10, 300); end if;
  if p_patch ? 'estimated_minutes' and jsonb_typeof(p_patch -> 'estimated_minutes') <> 'null' then
    if (p_patch ->> 'estimated_minutes') !~ '^[0-9]{1,2}$'
       or (p_patch ->> 'estimated_minutes')::int not between 3 and 15 then
      perform private.raise('PL422_BAD_INPUT', 'A lesson takes between 3 and 15 minutes.',
        jsonb_build_object('field', 'estimated_minutes'));
    end if;
    v_minutes := (p_patch ->> 'estimated_minutes')::int;
  end if;
  if p_patch ? 'variety' then
    v_variety := nullif(btrim(coalesce(p_patch ->> 'variety', '')), '');
    if v_variety is null then
      perform private.raise('PL422_BAD_INPUT', 'Choose a variety for this lesson.', jsonb_build_object('field', 'variety'));
    end if;
  end if;

  select * into v_lesson from content.lessons l where l.id = p_id for update;
  if not found then
    perform private.editor_not_found('lesson', p_id);
  end if;
  perform private.editor_scope(split_part(p_id, '-', 1));
  if v_lesson.retired_at is not null then
    perform private.editor_retired('lesson', p_id);
  end if;
  if private.editor_lesson_is_demo(p_id) then
    perform private.editor_demo_frozen('This lesson', p_id);
  end if;
  perform private.editor_stale('lesson', p_id, p_expected_revision, v_lesson.revision_no);
  if v_variety is not null then
    perform private.editor_variety(v_variety, split_part(p_id, '-', 1));
  end if;

  update content.lessons l set
    title = case when p_patch ? 'title' then v_title else l.title end,
    subtitle = case when p_patch ? 'subtitle' then v_subtitle else l.subtitle end,
    objective = case when p_patch ? 'objective' then v_objective else l.objective end,
    variety_id = case when p_patch ? 'variety' then v_variety else l.variety_id end,
    estimated_minutes = case when p_patch ? 'estimated_minutes' then v_minutes else l.estimated_minutes end
  where l.id = p_id
  returning * into v_after;
  if v_after.revision_no = v_lesson.revision_no then
    perform private.editor_no_change(p_id);
  end if;

  perform private.audit('content.updated', 'lesson', p_id,
    jsonb_build_object('fields', (select jsonb_agg(k order by k) from jsonb_object_keys(p_patch) k), 'revision_no', v_after.revision_no));
  return jsonb_build_object(
    'id', p_id,
    'revision_no', v_after.revision_no,
    'review_fingerprint', v_after.review_fingerprint,
    'review_status', v_after.review_status
  );
end $$;

create function public.update_item(p_id text, p_expected_revision int, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_f jsonb;
  v_item content.items%rowtype;
  v_after content.items%rowtype;
  v_language text := split_part(p_id, '-', 1);
begin
  perform private.editor_keys(p_patch, array[
    'native', 'romanisation', 'meaning', 'context', 'usage_note', 'variety', 'source_type',
    'source_citation', 'source_licence', 'source_retrieved', 'source_caveat', 'tags', 'skills'
  ]);
  if p_expected_revision is null then
    perform private.raise('PL422_BAD_INPUT', 'Say which version you edited.');
  end if;
  if p_patch ? 'variety' and nullif(btrim(coalesce(p_patch ->> 'variety', '')), '') is null then
    perform private.raise('PL422_BAD_INPUT', 'Choose a variety for this phrase.', jsonb_build_object('field', 'variety'));
  end if;
  v_f := private.editor_item_fields(p_patch);

  select * into v_item from content.items i where i.id = p_id for update;
  if not found then
    perform private.editor_not_found('phrase', p_id);
  end if;
  perform private.editor_scope(v_language);
  if v_item.retired_at is not null then
    perform private.editor_retired('phrase', p_id);
  end if;
  if exists (select 1 from content.demo_items d where d.item_id = p_id) then
    perform private.editor_demo_frozen('This phrase', p_id);
  end if;
  perform private.editor_stale('phrase', p_id, p_expected_revision, v_item.revision_no);
  if v_f ? 'variety' then
    perform private.editor_variety(v_f ->> 'variety', v_language);
  end if;

  update content.items i set
    native = case when v_f ? 'native' then v_f ->> 'native' else i.native end,
    romanisation = case when v_f ? 'romanisation' then v_f ->> 'romanisation' else i.romanisation end,
    meaning = case when v_f ? 'meaning' then v_f ->> 'meaning' else i.meaning end,
    context = case when v_f ? 'context' then v_f ->> 'context' else i.context end,
    usage_note = case when v_f ? 'usage_note' then v_f ->> 'usage_note' else i.usage_note end,
    variety_id = case when v_f ? 'variety' then v_f ->> 'variety' else i.variety_id end,
    source_type = case when v_f ? 'source_type' then v_f ->> 'source_type' else i.source_type end,
    source_citation = case when v_f ? 'source_citation' then v_f ->> 'source_citation' else i.source_citation end,
    source_licence = case when v_f ? 'source_licence' then v_f ->> 'source_licence' else i.source_licence end,
    source_retrieved = case when v_f ? 'source_retrieved' then (v_f ->> 'source_retrieved')::date else i.source_retrieved end,
    source_caveat = case when v_f ? 'source_caveat' then v_f ->> 'source_caveat' else i.source_caveat end,
    tags = case when v_f ? 'tags' then private.editor_text_array(v_f -> 'tags', 'tags') else i.tags end,
    skills = case when v_f ? 'skills' then private.editor_text_array(v_f -> 'skills', 'skills') else i.skills end
  where i.id = p_id
  returning * into v_after;
  if v_after.revision_no = v_item.revision_no then
    perform private.editor_no_change(p_id);
  end if;

  perform private.audit('content.updated', 'item', p_id,
    jsonb_build_object('fields', (select jsonb_agg(k order by k) from jsonb_object_keys(p_patch) k),
      'revision_no', v_after.revision_no,
      'approval_voided', v_item.review_status <> 'unreviewed' and v_after.review_status = 'unreviewed'));
  return jsonb_build_object(
    'id', p_id,
    'text_fingerprint', v_after.text_fingerprint,
    'review_fingerprint', v_after.review_fingerprint,
    'revision_no', v_after.revision_no,
    'review_status', v_after.review_status
  );
end $$;

create function public.update_exercise(p_id text, p_expected_revision int, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_f jsonb;
  v_ex content.exercises%rowtype;
  v_new int;
begin
  perform private.editor_keys(p_patch, array['kind', 'answer', 'prompt', 'options', 'difficulty', 'skills']);
  if p_expected_revision is null then
    perform private.raise('PL422_BAD_INPUT', 'Say which version you edited.');
  end if;
  v_f := private.editor_exercise_fields(p_patch);

  select * into v_ex from content.exercises e where e.id = p_id for update;
  if not found then
    perform private.editor_not_found('exercise', p_id);
  end if;
  perform private.editor_scope(split_part(p_id, '-', 1));
  if v_ex.retired_at is not null then
    perform private.editor_retired('exercise', p_id);
  end if;
  if private.editor_lesson_is_demo(v_ex.lesson_id) then
    perform private.editor_demo_frozen('This exercise', p_id);
  end if;
  perform private.editor_stale('exercise', p_id, p_expected_revision, v_ex.revision_no);

  update content.exercises e set
    kind = case when v_f ? 'kind' then v_f ->> 'kind' else e.kind end,
    answer_item_id = case when v_f ? 'answer' then v_f ->> 'answer' else e.answer_item_id end,
    prompt = case when v_f ? 'prompt' then v_f ->> 'prompt' else e.prompt end,
    options = case when v_f ? 'options' then private.editor_text_array(v_f -> 'options', 'options') else e.options end,
    difficulty = case when v_f ? 'difficulty' then (v_f ->> 'difficulty')::smallint else e.difficulty end,
    skills = case when v_f ? 'skills' then private.editor_text_array(v_f -> 'skills', 'skills') else e.skills end
  where e.id = p_id
  returning e.revision_no into v_new;
  if v_new = v_ex.revision_no then
    perform private.editor_no_change(p_id);
  end if;

  perform private.audit('content.updated', 'exercise', p_id,
    jsonb_build_object('fields', (select jsonb_agg(k order by k) from jsonb_object_keys(p_patch) k), 'revision_no', v_new));
  return jsonb_build_object('id', p_id, 'revision_no', v_new);
end $$;

-- ---------------------------------------------------------------------------
-- move_content: a unit to another course, a lesson to another unit, a
-- phrase to another lesson. Exercises stay with their lesson's phrases.
-- ---------------------------------------------------------------------------

create function public.move_content(p_type text, p_id text, p_new_parent_id text, p_position int default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_unit content.units%rowtype;
  v_course content.courses%rowtype;
  v_lesson content.lessons%rowtype;
  v_target_unit content.units%rowtype;
  v_target_lesson content.lessons%rowtype;
  v_item content.items%rowtype;
  v_old_parent text;
  v_old_pos int;
  v_count int;
  v_pos int;
begin
  if p_type is null or p_type not in ('unit', 'lesson', 'item') then
    perform private.raise('PL422_BAD_INPUT',
      'Units, lessons and phrases can move. An exercise belongs with its lesson''s phrases; make a new one there instead.',
      jsonb_build_object('type', p_type));
  end if;
  if split_part(coalesce(p_id, ''), '-', 1) <> split_part(coalesce(p_new_parent_id, ''), '-', 1) then
    perform private.raise('PL422_BAD_INPUT', 'Things can only move within their own language.',
      jsonb_build_object('id', p_id, 'new_parent_id', p_new_parent_id));
  end if;

  if p_type = 'unit' then
    select * into v_unit from content.units u where u.id = p_id for update;
    if not found then perform private.editor_not_found('unit', p_id); end if;
    select * into v_course from content.courses c where c.id = p_new_parent_id for update;
    if not found then perform private.editor_not_found('course', p_new_parent_id); end if;
    perform private.editor_scope(split_part(p_id, '-', 1));
    if v_unit.retired_at is not null then perform private.editor_retired('unit', p_id); end if;
    if v_course.retired_at is not null then perform private.editor_retired('course', p_new_parent_id); end if;
    if exists (
      select 1 from content.lessons l
      where l.unit_id = p_id and l.retired_at is null and private.editor_lesson_is_demo(l.id)
    ) then
      perform private.editor_demo_frozen('A lesson in this unit', p_id);
    end if;
    if v_unit.course_id = p_new_parent_id then perform private.editor_no_change(p_id); end if;

    v_old_parent := v_unit.course_id;
    v_old_pos := v_unit.position;
    select count(*) into v_count from content.units u where u.course_id = p_new_parent_id and u.retired_at is null;
    v_pos := private.editor_slot(v_count, p_position);
    perform private.editor_shift('units', 'course_id', v_old_parent, v_old_pos + 1, -1);
    perform private.editor_shift('units', 'course_id', p_new_parent_id, v_pos, 1);
    perform set_config('polilingo.revision_reason', 'move', true);
    -- The lessons' course_id follows through the cascading foreign key.
    update content.units u set course_id = p_new_parent_id, position = v_pos where u.id = p_id;
    perform set_config('polilingo.revision_reason', '', true);

  elsif p_type = 'lesson' then
    select * into v_lesson from content.lessons l where l.id = p_id for update;
    if not found then perform private.editor_not_found('lesson', p_id); end if;
    select * into v_target_unit from content.units u where u.id = p_new_parent_id for update;
    if not found then perform private.editor_not_found('unit', p_new_parent_id); end if;
    perform private.editor_scope(split_part(p_id, '-', 1));
    if v_lesson.retired_at is not null then perform private.editor_retired('lesson', p_id); end if;
    if v_target_unit.retired_at is not null then perform private.editor_retired('unit', p_new_parent_id); end if;
    if private.editor_lesson_is_demo(p_id) then perform private.editor_demo_frozen('This lesson', p_id); end if;
    if v_lesson.unit_id = p_new_parent_id then perform private.editor_no_change(p_id); end if;

    v_old_parent := v_lesson.unit_id;
    v_old_pos := v_lesson.position;
    select count(*) into v_count from content.lessons l where l.unit_id = p_new_parent_id and l.retired_at is null;
    v_pos := private.editor_slot(v_count, p_position);
    perform private.editor_shift('lessons', 'unit_id', v_old_parent, v_old_pos + 1, -1);
    perform private.editor_shift('lessons', 'unit_id', p_new_parent_id, v_pos, 1);
    perform set_config('polilingo.revision_reason', 'move', true);
    update content.lessons l
    set unit_id = p_new_parent_id, course_id = v_target_unit.course_id, position = v_pos
    where l.id = p_id;
    perform set_config('polilingo.revision_reason', '', true);

  else
    select * into v_item from content.items i where i.id = p_id for update;
    if not found then perform private.editor_not_found('phrase', p_id); end if;
    select * into v_target_lesson from content.lessons l where l.id = p_new_parent_id for update;
    if not found then perform private.editor_not_found('lesson', p_new_parent_id); end if;
    perform private.editor_scope(split_part(p_id, '-', 1));
    if v_item.retired_at is not null then perform private.editor_retired('phrase', p_id); end if;
    if v_target_lesson.retired_at is not null then perform private.editor_retired('lesson', p_new_parent_id); end if;
    if exists (select 1 from content.demo_items d where d.item_id = p_id) then
      perform private.editor_demo_frozen('This phrase', p_id);
    end if;
    if private.editor_lesson_is_demo(p_new_parent_id) then
      perform private.editor_demo_frozen('That lesson', p_new_parent_id);
    end if;
    if v_item.lesson_id = p_new_parent_id then perform private.editor_no_change(p_id); end if;
    -- Any exercise that still names it (a retired one's answer included:
    -- its foreign key ties the phrase to this lesson).
    if exists (
      select 1 from content.exercises e
      where e.lesson_id = v_item.lesson_id
        and (e.answer_item_id = p_id or (e.retired_at is null and p_id = any (e.options)))
    ) then
      perform private.raise('PL409_ITEM_IN_USE',
        'An exercise in this lesson uses this phrase, so it can''t move. Change or retire that exercise first.',
        jsonb_build_object('item_id', p_id));
    end if;
    select count(*) into v_count from content.items i where i.lesson_id = p_new_parent_id and i.retired_at is null;
    if v_count >= 12 then
      perform private.raise('PL422_LESSON_FULL', 'That lesson already has 12 phrases.',
        jsonb_build_object('lesson_id', p_new_parent_id, 'items', v_count));
    end if;

    v_old_parent := v_item.lesson_id;
    v_old_pos := v_item.position;
    v_pos := private.editor_slot(v_count, p_position);
    perform private.editor_shift('items', 'lesson_id', v_old_parent, v_old_pos + 1, -1);
    perform private.editor_shift('items', 'lesson_id', p_new_parent_id, v_pos, 1);
    perform set_config('polilingo.revision_reason', 'move', true);
    update content.items i set lesson_id = p_new_parent_id, position = v_pos where i.id = p_id;
    perform set_config('polilingo.revision_reason', '', true);
  end if;

  perform private.audit('content.moved', p_type, p_id,
    jsonb_build_object('from', v_old_parent, 'to', p_new_parent_id, 'position', v_pos));
  return jsonb_build_object('type', p_type, 'id', p_id, 'parent_id', p_new_parent_id, 'position', v_pos);
end $$;

-- ---------------------------------------------------------------------------
-- reorder_children: p_child_ids lists every live child of the parent, in
-- the new order. A lesson's children are its phrases or its exercises, told
-- apart by the ids.
-- ---------------------------------------------------------------------------

create function public.reorder_children(p_parent_type text, p_parent_id text, p_child_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_child text;
  v_live text[];
  v_retired timestamptz;
  v_found boolean;
begin
  if p_parent_type is null or p_parent_type not in ('course', 'unit', 'lesson') then
    perform private.raise('PL422_BAD_INPUT', 'Reorder the units of a course, the lessons of a unit, or a lesson''s phrases or exercises.');
  end if;
  if p_child_ids is null or cardinality(p_child_ids) = 0
     or array_position(p_child_ids, null) is not null
     or (select count(distinct c) from unnest(p_child_ids) c) <> cardinality(p_child_ids) then
    perform private.raise('PL422_BAD_INPUT', 'Send each child once, in the new order.');
  end if;
  v_child := case p_parent_type
    when 'course' then 'unit'
    when 'unit' then 'lesson'
    else case
      when (select bool_and(c ~ '^[a-z]{2,3}-itm-') from unnest(p_child_ids) c) then 'item'
      when (select bool_and(c ~ '^[a-z]{2,3}-exr-') from unnest(p_child_ids) c) then 'exercise'
    end
  end;
  if v_child is null then
    perform private.raise('PL422_BAD_INPUT', 'Reorder a lesson''s phrases and its exercises separately.');
  end if;

  case p_parent_type
    when 'course' then
      select c.retired_at, true into v_retired, v_found from content.courses c where c.id = p_parent_id for update;
    when 'unit' then
      select u.retired_at, true into v_retired, v_found from content.units u where u.id = p_parent_id for update;
    else
      select l.retired_at, true into v_retired, v_found from content.lessons l where l.id = p_parent_id for update;
  end case;
  if v_found is null then
    perform private.editor_not_found(p_parent_type, p_parent_id);
  end if;
  perform private.editor_scope(split_part(p_parent_id, '-', 1));
  if v_retired is not null then
    perform private.editor_retired(p_parent_type, p_parent_id);
  end if;
  if p_parent_type = 'lesson' and private.editor_lesson_is_demo(p_parent_id) then
    perform private.editor_demo_frozen('This lesson', p_parent_id);
  end if;

  v_live := case v_child
    when 'unit' then array(select u.id from content.units u where u.course_id = p_parent_id and u.retired_at is null)
    when 'lesson' then array(select l.id from content.lessons l where l.unit_id = p_parent_id and l.retired_at is null)
    when 'item' then array(select i.id from content.items i where i.lesson_id = p_parent_id and i.retired_at is null)
    else array(select e.id from content.exercises e where e.lesson_id = p_parent_id and e.retired_at is null)
  end;
  if not (v_live <@ p_child_ids and p_child_ids <@ v_live) then
    perform private.raise('PL422_BAD_INPUT',
      'The list doesn''t match what''s there now. Reload, then reorder again.',
      jsonb_build_object('expected', to_jsonb(v_live)));
  end if;

  perform set_config('polilingo.revision_reason', 'reorder', true);
  case v_child
    when 'unit' then
      update content.units t set position = o.pos
      from unnest(p_child_ids) with ordinality o(id, pos)
      where t.id = o.id and t.position is distinct from o.pos::int;
    when 'lesson' then
      update content.lessons t set position = o.pos
      from unnest(p_child_ids) with ordinality o(id, pos)
      where t.id = o.id and t.position is distinct from o.pos::int;
    when 'item' then
      update content.items t set position = o.pos
      from unnest(p_child_ids) with ordinality o(id, pos)
      where t.id = o.id and t.position is distinct from o.pos::int;
    else
      update content.exercises t set position = o.pos
      from unnest(p_child_ids) with ordinality o(id, pos)
      where t.id = o.id and t.position is distinct from o.pos::int;
  end case;
  perform set_config('polilingo.revision_reason', '', true);

  perform private.audit('content.reordered', p_parent_type, p_parent_id,
    jsonb_build_object('child_type', v_child, 'order', to_jsonb(p_child_ids)));
  return jsonb_build_object('parent_type', p_parent_type, 'parent_id', p_parent_id,
    'child_type', v_child, 'order', to_jsonb(p_child_ids));
end $$;

-- ---------------------------------------------------------------------------
-- retire_content: never deleted, only retired. A lesson takes its phrases
-- and exercises with it; a unit its lessons; a course (admin only) its
-- units. The siblings close the gap. Ids are retired in the registry too.
-- ---------------------------------------------------------------------------

create function public.retire_content(p_type text, p_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_reason text;
  v_parent text;
  v_pos int;
  v_retired timestamptz;
  v_found boolean;
  v_ids text[] := '{}';
  r record;
begin
  if p_type is null or p_type not in ('course', 'unit', 'lesson', 'item', 'exercise') then
    perform private.raise('PL422_BAD_INPUT', 'Courses, units, lessons, phrases and exercises can be retired.');
  end if;
  if p_type = 'course' and not private.is_admin() then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can retire a course.');
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    perform private.raise('PL422_COMMENT_REQUIRED', 'Please add a short note to say why.');
  end if;
  v_reason := private.editor_text(p_reason, 'The reason', 1, 500);

  case p_type
    when 'course' then
      select c.retired_at, null, null, true into v_retired, v_parent, v_pos, v_found
      from content.courses c where c.id = p_id for update;
    when 'unit' then
      select u.retired_at, u.course_id, u.position, true into v_retired, v_parent, v_pos, v_found
      from content.units u where u.id = p_id for update;
    when 'lesson' then
      select l.retired_at, l.unit_id, l.position, true into v_retired, v_parent, v_pos, v_found
      from content.lessons l where l.id = p_id for update;
    when 'item' then
      select i.retired_at, i.lesson_id, i.position, true into v_retired, v_parent, v_pos, v_found
      from content.items i where i.id = p_id for update;
    else
      select e.retired_at, e.lesson_id, e.position, true into v_retired, v_parent, v_pos, v_found
      from content.exercises e where e.id = p_id for update;
  end case;
  if v_found is null then
    perform private.editor_not_found(case p_type when 'item' then 'phrase' else p_type end, p_id);
  end if;
  perform private.editor_scope(split_part(p_id, '-', 1));
  if v_retired is not null then
    perform private.raise('PL409_RETIRED', 'This has already been retired.', jsonb_build_object('id', p_id));
  end if;

  -- Demo content stays as it is.
  if (p_type = 'item' and exists (select 1 from content.demo_items d where d.item_id = p_id))
     or (p_type in ('exercise', 'item') and private.editor_lesson_is_demo(v_parent))
     or (p_type = 'lesson' and private.editor_lesson_is_demo(p_id))
     or (p_type = 'unit' and exists (
       select 1 from content.lessons l
       where l.unit_id = p_id and l.retired_at is null and private.editor_lesson_is_demo(l.id)))
     or (p_type = 'course' and exists (
       select 1 from content.lessons l
       where l.course_id = p_id and l.retired_at is null and private.editor_lesson_is_demo(l.id))) then
    perform private.editor_demo_frozen(case p_type when 'item' then 'This phrase' else 'This' end, p_id);
  end if;

  if p_type = 'item' and exists (
    select 1 from content.exercises e
    where e.lesson_id = v_parent and e.retired_at is null
      and (e.answer_item_id = p_id or p_id = any (e.options))
  ) then
    perform private.raise('PL409_ITEM_IN_USE',
      format('%s exercise(s) use this phrase. Change or retire them first.', (
        select count(*) from content.exercises e
        where e.lesson_id = v_parent and e.retired_at is null
          and (e.answer_item_id = p_id or p_id = any (e.options)))),
      jsonb_build_object('item_id', p_id, 'exercises', (
        select jsonb_agg(e.id order by e.position) from content.exercises e
        where e.lesson_id = v_parent and e.retired_at is null
          and (e.answer_item_id = p_id or p_id = any (e.options)))));
  end if;

  case p_type
    when 'exercise' then
      perform set_config('polilingo.revision_reason', 'retire', true);
      update content.exercises e set retired_at = now(), position = null where e.id = p_id;
      v_ids := array[p_id];
      perform private.editor_shift('exercises', 'lesson_id', v_parent, v_pos + 1, -1);
    when 'item' then
      perform set_config('polilingo.revision_reason', 'retire', true);
      update content.items i set retired_at = now(), position = null where i.id = p_id;
      v_ids := array[p_id];
      perform private.editor_shift('items', 'lesson_id', v_parent, v_pos + 1, -1);
    when 'lesson' then
      v_ids := private.editor_retire_lesson_tree(p_id);
      perform private.editor_shift('lessons', 'unit_id', v_parent, v_pos + 1, -1);
    when 'unit' then
      for r in select l.id from content.lessons l where l.unit_id = p_id and l.retired_at is null loop
        v_ids := v_ids || private.editor_retire_lesson_tree(r.id);
      end loop;
      perform set_config('polilingo.revision_reason', 'retire', true);
      update content.units u set retired_at = now(), position = null where u.id = p_id;
      v_ids := v_ids || p_id;
      perform private.editor_shift('units', 'course_id', v_parent, v_pos + 1, -1);
    else
      for r in select l.id from content.lessons l where l.course_id = p_id and l.retired_at is null loop
        v_ids := v_ids || private.editor_retire_lesson_tree(r.id);
      end loop;
      perform set_config('polilingo.revision_reason', 'retire', true);
      with gone as (
        update content.units u set retired_at = now(), position = null
        where u.course_id = p_id and u.retired_at is null
        returning u.id
      ) select v_ids || coalesce(array_agg(gone.id), '{}') into v_ids from gone;
      update content.courses c set retired_at = now() where c.id = p_id;
      v_ids := v_ids || p_id;
  end case;
  perform set_config('polilingo.revision_reason', '', true);

  update content.id_registry g set retired_at = now()
  where g.id = any (v_ids) and g.retired_at is null;

  perform private.audit('content.retired', p_type, p_id,
    jsonb_build_object('reason', v_reason, 'retired', to_jsonb(v_ids)));
  return jsonb_build_object('type', p_type, 'id', p_id, 'retired', to_jsonb(v_ids));
end $$;

-- ---------------------------------------------------------------------------
-- submit_lesson, withdraw_lesson_submission
--
-- "In review" is not stored: it is an unreviewed lesson with submitted_at
-- set (§3.5). submitted_at is bookkeeping, so it does not bump the
-- revision or touch the fingerprint.
-- ---------------------------------------------------------------------------

create function public.submit_lesson(p_lesson_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_lesson content.lessons%rowtype;
  v_blocking jsonb;
  v_exercises int;
begin
  select * into v_lesson from content.lessons l where l.id = p_lesson_id for update;
  if not found then
    perform private.editor_not_found('lesson', p_lesson_id);
  end if;
  perform private.editor_scope(split_part(p_lesson_id, '-', 1));
  if v_lesson.retired_at is not null then
    perform private.editor_retired('lesson', p_lesson_id);
  end if;
  if private.editor_lesson_is_demo(p_lesson_id) then
    perform private.raise('PL409_DEMO_FROZEN',
      'This is starter content. Starter lessons are never reviewed; reviewed lessons replace them.',
      jsonb_build_object('id', p_lesson_id));
  end if;
  if v_lesson.submitted_at is not null and v_lesson.review_status = 'unreviewed' then
    return jsonb_build_object('lesson_id', p_lesson_id, 'submitted_at', v_lesson.submitted_at,
      'review_status', v_lesson.review_status, 'already', true);
  end if;
  if v_lesson.review_status <> 'unreviewed' then
    perform private.raise('PL422_NO_CHANGE',
      case v_lesson.review_status
        when 'approved' then 'This lesson is already approved. Change it first if it needs another review.'
        else 'Nothing has changed since the review. Make the changes the reviewer asked for, then send it back.'
      end,
      jsonb_build_object('lesson_id', p_lesson_id, 'review_status', v_lesson.review_status));
  end if;

  select coalesce(jsonb_agg(p), '[]'::jsonb) into v_blocking
  from jsonb_array_elements(private.lesson_problems(p_lesson_id)) p
  where p ->> 'severity' = 'blocking';
  if jsonb_array_length(v_blocking) > 0 then
    perform private.raise('PL422_LESSON_PROBLEMS',
      format('Fix this first: %s%s', v_blocking -> 0 ->> 'message',
        case when jsonb_array_length(v_blocking) > 1
          then format(' (and %s more)', jsonb_array_length(v_blocking) - 1) else '' end),
      jsonb_build_object('lesson_id', p_lesson_id, 'problems', v_blocking));
  end if;
  select count(*) into v_exercises from content.exercises e where e.lesson_id = p_lesson_id and e.retired_at is null;
  if v_exercises < 6 then
    perform private.raise('PL422_TOO_FEW_EXERCISES',
      format('A lesson needs at least 6 exercises before review. This one has %s.', v_exercises),
      jsonb_build_object('lesson_id', p_lesson_id, 'exercises', v_exercises));
  end if;

  update content.lessons l set submitted_at = now() where l.id = p_lesson_id
  returning * into v_lesson;
  perform private.audit('content.submitted', 'lesson', p_lesson_id,
    jsonb_build_object('submitted', true, 'review_fingerprint', v_lesson.review_fingerprint));
  return jsonb_build_object('lesson_id', p_lesson_id, 'submitted_at', v_lesson.submitted_at,
    'review_status', v_lesson.review_status, 'already', false);
end $$;

create function public.withdraw_lesson_submission(p_lesson_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_gate();
  v_lesson content.lessons%rowtype;
begin
  select * into v_lesson from content.lessons l where l.id = p_lesson_id for update;
  if not found then
    perform private.editor_not_found('lesson', p_lesson_id);
  end if;
  perform private.editor_scope(split_part(p_lesson_id, '-', 1));
  if v_lesson.retired_at is not null then
    perform private.editor_retired('lesson', p_lesson_id);
  end if;
  if private.editor_lesson_is_demo(p_lesson_id) then
    perform private.editor_demo_frozen('This lesson', p_lesson_id);
  end if;
  if v_lesson.submitted_at is null then
    return jsonb_build_object('lesson_id', p_lesson_id, 'submitted_at', null,
      'review_status', v_lesson.review_status, 'already', true);
  end if;

  update content.lessons l set submitted_at = null where l.id = p_lesson_id;
  perform private.audit('content.submitted', 'lesson', p_lesson_id, jsonb_build_object('submitted', false));
  return jsonb_build_object('lesson_id', p_lesson_id, 'submitted_at', null,
    'review_status', v_lesson.review_status, 'already', false);
end $$;

-- ---------------------------------------------------------------------------
-- set_publish_gate, set_demo_sunset (admin)
-- ---------------------------------------------------------------------------

create function public.set_publish_gate(p_type text, p_id text, p_gate text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_admin_gate();
  v_reason text;
  v_gate text;
  v_retired timestamptz;
  v_found boolean;
  v_name text;
begin
  if p_type is null or p_type not in ('language', 'variety', 'course', 'unit', 'lesson') then
    perform private.raise('PL422_BAD_INPUT', 'Gates are set on a language, variety, course, unit or lesson.');
  end if;
  if p_gate is null or p_gate not in ('open', 'blocked') then
    perform private.raise('PL422_BAD_INPUT', 'A gate is open or blocked.');
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    perform private.raise('PL422_COMMENT_REQUIRED', 'Please add a short note to say why.');
  end if;
  v_reason := private.editor_text(p_reason, 'The reason', 1, 500);

  case p_type
    when 'language' then
      select l.publish_gate, null, true, l.name into v_gate, v_retired, v_found, v_name
      from content.languages l where l.code = p_id for update;
    when 'variety' then
      select v.publish_gate, null, true, v.name into v_gate, v_retired, v_found, v_name
      from content.varieties v where v.id = p_id for update;
    when 'course' then
      select c.publish_gate, c.retired_at, true, c.name into v_gate, v_retired, v_found, v_name
      from content.courses c where c.id = p_id for update;
    when 'unit' then
      select u.publish_gate, u.retired_at, true, u.title into v_gate, v_retired, v_found, v_name
      from content.units u where u.id = p_id for update;
    else
      select l.publish_gate, l.retired_at, true, l.title into v_gate, v_retired, v_found, v_name
      from content.lessons l where l.id = p_id for update;
  end case;
  if v_found is null then
    perform private.editor_not_found(p_type, p_id);
  end if;
  if v_retired is not null then
    perform private.editor_retired(p_type, p_id);
  end if;

  -- Opening a language or variety to learners needs someone who can review it.
  if p_gate = 'open' and p_type = 'variety' and private.active_reviewer_count(p_id) = 0 then
    perform private.raise('PL409_NO_REVIEWER',
      format('%s has no active reviewer, so it can''t be opened to learners yet.', v_name),
      jsonb_build_object('variety', p_id));
  end if;
  if p_gate = 'open' and p_type = 'language' and not exists (
    select 1 from content.varieties v
    where v.language_code = p_id and private.active_reviewer_count(v.id) > 0
  ) then
    perform private.raise('PL409_NO_REVIEWER',
      format('%s has no active reviewer, so it can''t be opened to learners yet.', v_name),
      jsonb_build_object('language', p_id));
  end if;
  if v_gate = p_gate then
    perform private.raise('PL422_NO_CHANGE', format('The gate is already %s.', p_gate),
      jsonb_build_object('type', p_type, 'id', p_id, 'gate', p_gate));
  end if;

  perform set_config('polilingo.revision_reason', 'gate', true);
  case p_type
    when 'language' then update content.languages l set publish_gate = p_gate where l.code = p_id;
    when 'variety' then update content.varieties v set publish_gate = p_gate where v.id = p_id;
    when 'course' then update content.courses c set publish_gate = p_gate where c.id = p_id;
    when 'unit' then update content.units u set publish_gate = p_gate where u.id = p_id;
    else update content.lessons l set publish_gate = p_gate where l.id = p_id;
  end case;
  perform set_config('polilingo.revision_reason', '', true);

  perform private.audit('content.gate_changed', p_type, p_id,
    jsonb_build_object('from', v_gate, 'to', p_gate, 'reason', v_reason));
  return jsonb_build_object('type', p_type, 'id', p_id, 'gate', p_gate);
end $$;

create function public.set_demo_sunset(p_language text, p_sunset date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me text := private.editor_admin_gate();
  v_reason text;
  v_period content.demo_period%rowtype;
begin
  if p_sunset is null then
    perform private.raise('PL422_BAD_DATE', 'Choose the last day the demo lessons stay live.');
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    perform private.raise('PL422_COMMENT_REQUIRED', 'Please add a short note to say why.');
  end if;
  v_reason := private.editor_text(p_reason, 'The reason', 1, 500);

  select * into v_period from content.demo_period d where d.language_code = p_language for update;
  if not found then
    perform private.raise('PL404_NOT_FOUND', 'That language has no demo period.',
      jsonb_build_object('language', p_language));
  end if;
  if p_sunset < (now() at time zone 'utc')::date then
    perform private.raise('PL422_BAD_DATE', 'The sunset can be today or later, not in the past.',
      jsonb_build_object('sunset', p_sunset));
  end if;
  if p_sunset = v_period.sunset then
    perform private.raise('PL422_NO_CHANGE', 'That is already the sunset date.',
      jsonb_build_object('sunset', p_sunset));
  end if;

  update content.demo_period d set sunset = p_sunset where d.language_code = p_language;
  perform private.audit('demo.sunset_changed', 'language', p_language,
    jsonb_build_object('from', v_period.sunset, 'to', p_sunset, 'reason', v_reason));
  return jsonb_build_object('language', p_language, 'sunset', p_sunset, 'live', v_period.live);
end $$;

-- ---------------------------------------------------------------------------
-- Checks and page reads (SECURITY INVOKER: RLS decides what the caller
-- sees; only granted private helpers are called)
-- ---------------------------------------------------------------------------

-- The text rules for a phrase, without storing anything: the problem list
-- private.native_problems gives, for the text as it would be stored.
create function public.check_text(p_language text, p_native text, p_romanisation text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_native text := nullif(private.normalise_native(coalesce(p_native, '')), '');
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not private.is_staff() then
    perform private.raise('PL403_NOT_EDITOR', 'Only the team can check text here.');
  end if;
  return jsonb_build_object(
    'language', p_language,
    'native', v_native,
    'text_fingerprint', case when v_native is null then null else private.text_fingerprint(v_native) end,
    'problems', private.native_problems(p_language, v_native, p_romanisation)
  );
end $$;

-- A lesson's problems (blocking and warnings) and its effective gate.
create function public.check_lesson(p_lesson_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_problems jsonb;
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not private.is_staff() then
    perform private.raise('PL403_NOT_EDITOR', 'Only the team can check lessons.');
  end if;
  v_problems := private.lesson_problems(p_lesson_id);
  if v_problems is null then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that lesson.', jsonb_build_object('id', p_lesson_id));
  end if;
  return jsonb_build_object(
    'lesson_id', p_lesson_id,
    'effective_gate', private.effective_gate(p_lesson_id),
    'problems', v_problems,
    'blocking', (select count(*) from jsonb_array_elements(v_problems) p where p ->> 'severity' = 'blocking'),
    'warnings', (select count(*) from jsonb_array_elements(v_problems) p where p ->> 'severity' = 'warning')
  );
end $$;

-- Languages → courses → units → lessons the caller can edit, live ones
-- only, each lesson with what the tree shows about it.
create function public.page_edit_tree()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_languages text[];
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  select coalesce(array_agg(l.code order by l.code collate "C"), '{}') into v_languages
  from content.languages l
  where private.can_edit_language(l.code);
  if cardinality(v_languages) = 0 then
    perform private.raise('PL403_NOT_EDITOR', 'Only an editor can open the lessons.');
  end if;

  return jsonb_build_object(
    'is_admin', private.is_admin(),
    'me', private.current_contributor_id(),
    'languages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', l.code,
        'name', l.name,
        'native_name', l.native_name,
        'direction', l.direction,
        'publish_gate', l.publish_gate,
        'demo_period', (
          select jsonb_build_object('sunset', d.sunset, 'live', d.live)
          from content.demo_period d where d.language_code = l.code
        ),
        'varieties', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', v.id,
            'name', v.name,
            'learner_label', v.learner_label,
            'publish_gate', v.publish_gate,
            'reviewers', private.active_reviewer_count(v.id)
          ) order by v.id collate "C")
          from content.varieties v where v.language_code = l.code
        ), '[]'::jsonb),
        'courses', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'variety_id', c.variety_id,
            'publish_gate', c.publish_gate,
            'units', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', u.id,
                'title', u.title,
                'goal', u.goal,
                'theme', u.theme,
                'position', u.position,
                'publish_gate', u.publish_gate,
                'revision_no', u.revision_no,
                'lessons', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', ls.id,
                    'title', ls.title,
                    'subtitle', ls.subtitle,
                    'position', ls.position,
                    'variety_id', ls.variety_id,
                    'publish_gate', ls.publish_gate,
                    'review_status', ls.review_status,
                    'submitted_at', ls.submitted_at,
                    'updated_at', ls.updated_at,
                    'revision_no', ls.revision_no,
                    'items', (select count(*) from content.items i where i.lesson_id = ls.id and i.retired_at is null),
                    'exercises', (select count(*) from content.exercises e where e.lesson_id = ls.id and e.retired_at is null),
                    'demo', exists (
                      select 1 from content.items i join content.demo_items d on d.item_id = i.id
                      where i.lesson_id = ls.id
                    )
                  ) order by ls.position)
                  from content.lessons ls
                  where ls.unit_id = u.id and ls.retired_at is null
                ), '[]'::jsonb)
              ) order by u.position)
              from content.units u
              where u.course_id = c.id and u.retired_at is null
            ), '[]'::jsonb)
          ) order by c.name collate "C", c.id collate "C")
          from content.courses c
          where c.language_code = l.code and c.retired_at is null
        ), '[]'::jsonb)
      ) order by l.name collate "C")
      from content.languages l
      where l.code = any (v_languages)
    ), '[]'::jsonb)
  );
end $$;

-- One lesson for the editor: the lesson with its unit, course and
-- language, the varieties it may use, its live phrases and exercises, its
-- problems and a summary of its revisions.
create function public.page_edit_lesson(p_lesson_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_language text := split_part(coalesce(p_lesson_id, ''), '-', 1);
  v_lesson content.lessons%rowtype;
  v_lang content.languages%rowtype;
  v_me text;
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not exists (select 1 from content.languages l where private.can_edit_language(l.code)) then
    perform private.raise('PL403_NOT_EDITOR', 'Only an editor can open lessons here.');
  end if;
  if coalesce(p_lesson_id, '') !~ '^[a-z]{2,3}-lsn-[0-9a-f]{6}$' then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that lesson.', jsonb_build_object('id', p_lesson_id));
  end if;
  if not private.can_edit_language(v_language) then
    select * into v_lang from content.languages l where l.code = v_language;
    perform private.raise('PL403_OUTSIDE_LANGUAGE',
      format('This lesson is in %s, which your editor role doesn''t cover.', coalesce(v_lang.name, v_language)),
      jsonb_build_object('language', v_language));
  end if;
  select * into v_lesson from content.lessons l where l.id = p_lesson_id;
  if not found then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that lesson.', jsonb_build_object('id', p_lesson_id));
  end if;
  select * into v_lang from content.languages l where l.code = v_language;
  v_me := private.current_contributor_id();

  return jsonb_build_object(
    'me', v_me,
    'is_admin', private.is_admin(),
    'language', jsonb_build_object(
      'code', v_lang.code, 'name', v_lang.name, 'native_name', v_lang.native_name,
      'direction', v_lang.direction
    ),
    'course', (
      select jsonb_build_object('id', c.id, 'name', c.name, 'variety_id', c.variety_id)
      from content.courses c where c.id = v_lesson.course_id
    ),
    'unit', (
      select jsonb_build_object('id', u.id, 'title', u.title, 'position', u.position, 'publish_gate', u.publish_gate)
      from content.units u where u.id = v_lesson.unit_id
    ),
    'varieties', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'learner_label', v.learner_label)
        order by v.id collate "C")
      from content.varieties v where v.language_code = v_language
    ), '[]'::jsonb),
    'lesson', jsonb_build_object(
      'id', v_lesson.id,
      'title', v_lesson.title,
      'subtitle', v_lesson.subtitle,
      'objective', v_lesson.objective,
      'variety_id', v_lesson.variety_id,
      'estimated_minutes', v_lesson.estimated_minutes,
      'position', v_lesson.position,
      'publish_gate', v_lesson.publish_gate,
      'effective_gate', private.effective_gate(v_lesson.id),
      'review_status', v_lesson.review_status,
      'review_fingerprint', v_lesson.review_fingerprint,
      'submitted_at', v_lesson.submitted_at,
      'revision_no', v_lesson.revision_no,
      'updated_at', v_lesson.updated_at,
      'retired_at', v_lesson.retired_at,
      'demo', exists (
        select 1 from content.items i join content.demo_items d on d.item_id = i.id
        where i.lesson_id = v_lesson.id
      ),
      'last_decision', (
        select jsonb_build_object('decision', d.decision, 'comment', d.comment, 'at', d.at,
          'current', d.id = v_lesson.current_decision_id)
        from content.review_decisions d
        where d.lesson_id = v_lesson.id
        order by d.seq desc limit 1
      )
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'position', i.position,
        'native', i.native,
        'romanisation', i.romanisation,
        'meaning', i.meaning,
        'context', i.context,
        'usage_note', i.usage_note,
        'variety_id', i.variety_id,
        'source_type', i.source_type,
        'source_citation', i.source_citation,
        'source_licence', i.source_licence,
        'source_retrieved', i.source_retrieved,
        'source_caveat', i.source_caveat,
        'tags', to_jsonb(i.tags),
        'skills', to_jsonb(i.skills),
        'review_status', i.review_status,
        'revision_no', i.revision_no,
        'text_fingerprint', i.text_fingerprint,
        'review_fingerprint', i.review_fingerprint,
        'updated_at', i.updated_at,
        'demo', exists (select 1 from content.demo_items d where d.item_id = i.id),
        'used_by', (
          select count(*) from content.exercises e
          where e.lesson_id = i.lesson_id and e.retired_at is null
            and (e.answer_item_id = i.id or i.id = any (e.options))
        ),
        'last_decision', (
          select jsonb_build_object('decision', d.decision, 'comment', d.comment, 'at', d.at,
            'current', d.id = i.current_decision_id)
          from content.review_decisions d
          where d.item_id = i.id
          order by d.seq desc limit 1
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
        'answer_item_id', e.answer_item_id,
        'prompt', e.prompt,
        'options', to_jsonb(e.options),
        'difficulty', e.difficulty,
        'skills', to_jsonb(e.skills),
        'revision_no', e.revision_no
      ) order by e.position)
      from content.exercises e
      where e.lesson_id = v_lesson.id and e.retired_at is null
    ), '[]'::jsonb),
    'problems', coalesce(private.lesson_problems(v_lesson.id), '[]'::jsonb),
    'revisions', jsonb_build_object(
      'count', (select count(*) from content.revisions r where r.lesson_id = v_lesson.id),
      'recent', coalesce((
        select jsonb_agg(jsonb_build_object(
          'object_type', r.object_type,
          'object_id', r.object_id,
          'revision_no', r.revision_no,
          'reason', r.reason,
          'at', r.at,
          'mine', r.author_contributor_id is not distinct from v_me and v_me is not null,
          'author', r.author_contributor_id
        ) order by r.seq desc)
        from (
          select * from content.revisions r
          where r.lesson_id = v_lesson.id
          order by r.seq desc
          limit 8
        ) r
      ), '[]'::jsonb)
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants: the API functions to authenticated only; the helpers to nobody.
-- ---------------------------------------------------------------------------

revoke all on function
  private.editor_random_hex6(),
  private.editor_gate(),
  private.editor_admin_gate(),
  private.editor_scope(text),
  private.editor_text(text, text, int, int),
  private.editor_text_array(jsonb, text),
  private.editor_keys(jsonb, text[]),
  private.editor_slot(int, int),
  private.editor_shift(text, text, text, int, int),
  private.editor_mint(text, text, text),
  private.editor_claim(text, text, text),
  private.editor_lesson_is_demo(text),
  private.editor_demo_frozen(text, text),
  private.editor_not_found(text, text),
  private.editor_retired(text, text),
  private.editor_item_fields(jsonb),
  private.editor_exercise_fields(jsonb),
  private.editor_variety(text, text),
  private.editor_retire_lesson_tree(text),
  private.editor_stale(text, text, int, int),
  private.editor_no_change(text)
from public, anon, authenticated;

revoke all on function
  public.reserve_content_id(text, text),
  public.create_unit(text, text, text, text, int),
  public.create_lesson(text, text, text, text, text, int, int),
  public.create_item(text, jsonb, int),
  public.create_exercise(text, jsonb, int),
  public.update_unit(text, int, jsonb),
  public.update_lesson(text, int, jsonb),
  public.update_item(text, int, jsonb),
  public.update_exercise(text, int, jsonb),
  public.move_content(text, text, text, int),
  public.reorder_children(text, text, text[]),
  public.retire_content(text, text, text),
  public.submit_lesson(text),
  public.withdraw_lesson_submission(text),
  public.set_publish_gate(text, text, text, text),
  public.set_demo_sunset(text, date, text),
  public.check_text(text, text, text),
  public.check_lesson(text),
  public.page_edit_tree(),
  public.page_edit_lesson(text)
from public, anon;

grant execute on function
  public.reserve_content_id(text, text),
  public.create_unit(text, text, text, text, int),
  public.create_lesson(text, text, text, text, text, int, int),
  public.create_item(text, jsonb, int),
  public.create_exercise(text, jsonb, int),
  public.update_unit(text, int, jsonb),
  public.update_lesson(text, int, jsonb),
  public.update_item(text, int, jsonb),
  public.update_exercise(text, int, jsonb),
  public.move_content(text, text, text, int),
  public.reorder_children(text, text, text[]),
  public.retire_content(text, text, text),
  public.submit_lesson(text),
  public.withdraw_lesson_submission(text),
  public.set_publish_gate(text, text, text, text),
  public.set_demo_sunset(text, date, text),
  public.check_text(text, text, text),
  public.check_lesson(text),
  public.page_edit_tree(),
  public.page_edit_lesson(text)
to authenticated;
