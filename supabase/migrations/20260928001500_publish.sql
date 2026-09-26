-- 20260928001500_publish.sql
-- Owner: Track F (publish). docs/platform.md §3.5, §3.9 (F), §4.10.
--
-- In-app publish: what may reach learners, the learner copy the database
-- builds from it, the preview an admin looks at, and the publish itself.
--
--   private.item_reviewed_ok(item)          one reviewed phrase is publishable
--   private.lesson_reviewed_ok(lesson)      one lesson passes the reviewed rules
--   private.lesson_candidates(today)        every live lesson, its class and why it can't publish
--   private.previous_release_seq(release)   the release a build carries forward from
--   private.release_plan(release, today)    every lesson in or out of a build, and why
--   private.assemble_learner_copy(...)      the learner copy from a plan
--   private.build_learner_copy(release, today)
--   private.verify_learner_copy(copy, today) independent checks; [] when clean
--   private.next_release_name(at)           content@YYYY.MM.N by UTC date
--   public.preview_release()                editor/admin
--   public.publish_release(hash, note)      admin
--   public.rollback_release(name, reason)   admin: an earlier release again, as a new one
--   public.page_admin_publish()             admin: history plus the preview
--
-- The learner copy is field-for-field learnerCopy() in the content
-- repository's scripts/build.mjs: courses by id (collate "C"), units and
-- lessons by position, items and exercises by position (private.lesson_json),
-- tagline/subtitle default '', context/usage_note left out when null,
-- varieties then languages only when something left refers to them, keymap
-- rows in position order whose targets are present, commit null, and
-- contentHash over private.canonical_json({languages, varieties, courses,
-- keymap}). The fixture seed checks that rebuilding its release #1 gives the
-- same contentHash; tests/db/publish.test.mjs checks the whole payload.

-- ---------------------------------------------------------------------------
-- Publishable (§3.5)
-- ---------------------------------------------------------------------------

-- A decision still stands for a target: it approves, it saw the target's
-- current fingerprint, and a sole-reviewer approval has its countersign.
create function private.decision_current(p_decision_id uuid, p_fingerprint text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select d.decision = 'approve'
       and d.seen_fingerprint = p_fingerprint
       and (not d.sole_reviewer
            or exists (select 1 from content.countersignatures c where c.decision_id = d.id))
    from content.review_decisions d
    where d.id = p_decision_id
  ), false)
$$;

-- Reviewed item: live, not demo, approved, its current decision approves
-- the current text, and not sole-reviewer or countersigned.
create function private.item_reviewed_ok(p_item_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select i.retired_at is null
       and i.review_status = 'approved'
       and not exists (select 1 from content.demo_items x where x.item_id = i.id)
       and private.decision_current(i.current_decision_id, i.review_fingerprint)
    from content.items i
    where i.id = p_item_id
  ), false)
$$;

-- Reviewed lesson: no demo phrases, the lesson approved and current (plus
-- countersign when sole), 1..12 live phrases each publishable, and at least
-- 6 live exercises. Gates and blocking problems are checked separately.
create function private.lesson_reviewed_ok(p_lesson_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select l.retired_at is null
       and l.review_status = 'approved'
       and private.decision_current(l.current_decision_id, l.review_fingerprint)
       and not exists (
         select 1 from content.items i join content.demo_items x on x.item_id = i.id
         where i.lesson_id = l.id and i.retired_at is null)
       and (select count(*) from content.items i
            where i.lesson_id = l.id and i.retired_at is null) between 1 and 12
       and not exists (
         select 1 from content.items i
         where i.lesson_id = l.id and i.retired_at is null
           and not private.item_reviewed_ok(i.id))
       and (select count(*) from content.exercises e
            where e.lesson_id = l.id and e.retired_at is null) >= 6
    from content.lessons l
    where l.id = p_lesson_id
  ), false)
$$;

-- The closed gates above a lesson, in words, or null when all are open.
create function private.closed_gates(p_lesson_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(concat_ws(', ',
    case when lang.publish_gate = 'blocked' then format('the %s language', lang.name) end,
    case when c.publish_gate = 'blocked' then format('the course "%s"', c.name) end,
    case when cv.publish_gate = 'blocked' then format('the variety %s', cv.name) end,
    case when u.publish_gate = 'blocked' then format('the unit "%s"', u.title) end,
    case when l.publish_gate = 'blocked' then 'the lesson itself' end,
    case when lv.publish_gate = 'blocked' and lv.id <> cv.id then format('the variety %s', lv.name) end,
    (select 'a phrase''s variety (' || string_agg(distinct iv.name, ', ') || ')'
     from content.items i join content.varieties iv on iv.id = i.variety_id
     where i.lesson_id = l.id and i.retired_at is null and iv.publish_gate = 'blocked')
  ), '')
  from content.lessons l
  join content.units u on u.id = l.unit_id
  join content.courses c on c.id = l.course_id
  join content.languages lang on lang.code = c.language_code
  join content.varieties cv on cv.id = c.variety_id
  join content.varieties lv on lv.id = l.variety_id
  where l.id = p_lesson_id
$$;

-- Every live lesson (not retired), its class and the reasons it can't
-- publish now. publishable = no reasons and a class of demo or reviewed.
--   lesson_class  'demo'     every live phrase is on the demo list
--                 'reviewed' no live phrase is
--                 'mixed'    some are (never publishes)
--                 'empty'    no live phrases (never publishes)
--   reasons       [{code, message}], plain English, empty when publishable
create function private.lesson_candidates(p_today date)
returns table (
  lesson_id text,
  course_id text,
  unit_id text,
  language_code text,
  variety_id text,
  lesson_class text,
  publishable boolean,
  reasons jsonb
)
language plpgsql
stable
set search_path = ''
as $$
declare
  r record;
  v_reasons jsonb;
  v_items int;
  v_demo int;
  v_exercises int;
  v_gates text;
  v_dp content.demo_period%rowtype;
  v_decision content.review_decisions%rowtype;
  v_not_ok int;
  v_countersign int;
  v_problems jsonb;
  v_count int;
begin
  for r in
    select l.*, u.retired_at as unit_retired_at, c.retired_at as course_retired_at,
           c.language_code as lang, lang.name as language_name
    from content.lessons l
    join content.units u on u.id = l.unit_id
    join content.courses c on c.id = l.course_id
    join content.languages lang on lang.code = c.language_code
    where l.retired_at is null
    order by l.course_id collate "C", u.position, l.position
  loop
    v_reasons := '[]'::jsonb;

    select count(*), count(x.item_id) into v_items, v_demo
    from content.items i
    left join content.demo_items x on x.item_id = i.id
    where i.lesson_id = r.id and i.retired_at is null;

    select count(*) into v_exercises
    from content.exercises e
    where e.lesson_id = r.id and e.retired_at is null;

    lesson_class := case
      when v_items = 0 then 'empty'
      when v_demo = v_items then 'demo'
      when v_demo = 0 then 'reviewed'
      else 'mixed'
    end;

    if r.unit_retired_at is not null or r.course_retired_at is not null then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'retired', 'message', 'Its unit or course is retired.'));
    end if;

    v_gates := private.closed_gates(r.id);
    if v_gates is not null then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'gated', 'message', format('Held back: the publish gate is closed on %s.', v_gates)));
    end if;

    -- Blocking problems (phrases, exercises, a mixed lesson), at most three
    -- by name and a count of the rest.
    select coalesce(jsonb_agg(p.value order by p.ord), '[]'::jsonb), count(*)
      into v_problems, v_count
    from jsonb_array_elements(private.lesson_problems(r.id)) with ordinality p(value, ord)
    where p.value ->> 'severity' = 'blocking';
    if v_count > 0 then
      v_reasons := v_reasons || (
        select coalesce(jsonb_agg(jsonb_build_object(
          'code', 'problem', 'message', p.value ->> 'message',
          'problem_code', p.value ->> 'code') order by p.ord), '[]'::jsonb)
        from jsonb_array_elements(v_problems) with ordinality p(value, ord)
        where p.ord <= 3);
      if v_count > 3 then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'problem', 'message', format('And %s more problems to fix.', v_count - 3)));
      end if;
    end if;

    if lesson_class = 'demo' then
      select * into v_dp from content.demo_period d where d.language_code = r.lang;
      if not found or not v_dp.live then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'demo_not_live',
          'message', format('Starter content for %s is never shown to learners.', r.language_name)));
      elsif p_today > v_dp.sunset then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'demo_ended',
          'message', format('Starter content for %s ended on %s.', r.language_name,
                            trim(to_char(v_dp.sunset, 'FMDD Mon YYYY')))));
      end if;
    elsif lesson_class = 'reviewed' then
      if r.review_status <> 'approved' then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'lesson_not_approved',
          'message', case r.review_status
            when 'changes_requested' then 'A reviewer asked for changes to this lesson.'
            when 'rejected' then 'A reviewer turned this lesson down.'
            else case
              when r.last_approved_seq is not null then 'The lesson changed after it was approved and needs another look.'
              when r.submitted_at is not null then 'The lesson is waiting for review.'
              else 'The lesson hasn''t been sent for review yet.'
            end
          end));
      else
        select * into v_decision from content.review_decisions d where d.id = r.current_decision_id;
        if not found or v_decision.decision <> 'approve' or v_decision.seen_fingerprint <> r.review_fingerprint then
          v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
            'code', 'lesson_stale', 'message', 'The lesson''s approval no longer matches it and needs another look.'));
        elsif v_decision.sole_reviewer
              and not exists (select 1 from content.countersignatures c where c.decision_id = v_decision.id) then
          v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
            'code', 'awaiting_countersign', 'message', 'The lesson''s approval needs an admin''s countersign.'));
        end if;
      end if;

      select count(*) filter (where not private.item_reviewed_ok(i.id)),
             count(*) filter (
               where i.review_status = 'approved'
                 and exists (
                   select 1 from content.review_decisions d
                   where d.id = i.current_decision_id and d.decision = 'approve'
                     and d.seen_fingerprint = i.review_fingerprint and d.sole_reviewer
                     and not exists (select 1 from content.countersignatures c where c.decision_id = d.id)))
        into v_not_ok, v_countersign
      from content.items i
      where i.lesson_id = r.id and i.retired_at is null;
      if v_not_ok - v_countersign > 0 then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'items_not_approved',
          'message', case
            when v_not_ok - v_countersign = v_items and v_items = 1
              then 'Its phrase isn''t approved yet.'
            when v_not_ok - v_countersign = v_items
              then format('None of its %s phrases is approved yet.', v_items)
            when v_not_ok - v_countersign = 1
              then format('1 of its %s phrases isn''t approved yet.', v_items)
            else format('%s of its %s phrases aren''t approved yet.', v_not_ok - v_countersign, v_items) end));
      end if;
      if v_countersign > 0 then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'awaiting_countersign',
          'message', case when v_countersign = 1
            then '1 phrase''s approval needs an admin''s countersign.'
            else format('%s phrases'' approvals need an admin''s countersign.', v_countersign) end));
      end if;
      if v_exercises between 1 and 5 then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'too_few_exercises',
          'message', format('A reviewed lesson needs at least 6 exercises. This one has %s.', v_exercises)));
      end if;
    end if;

    lesson_id := r.id;
    course_id := r.course_id;
    unit_id := r.unit_id;
    language_code := r.lang;
    variety_id := r.variety_id;
    publishable := jsonb_array_length(v_reasons) = 0 and lesson_class in ('demo', 'reviewed');
    reasons := v_reasons;
    return next;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The plan: which lessons a build holds, from where, and why others don't
-- ---------------------------------------------------------------------------

-- The release a build of p_release carries forward from: the newest one
-- that sorts before it (for a new name, simply the newest).
create function private.previous_release_seq(p_release text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select r.seq
  from content.releases r
  where private.release_sort_key(r.name) < private.release_sort_key(p_release)
  order by r.seq desc
  limit 1
$$;

-- Every lesson a build of p_release on p_today considers: each live lesson
-- and each lesson of the previous release. One row per lesson:
--   source    'current' (built from the tables now), 'carried' (the previous
--             release's JSON, order updated) or null (left out)
--   lesson    the learner JSON that goes in, null when left out
--   in_previous  whether the previous release held it
-- Carry-forward (§3.5): not publishable now, in the previous release, not
-- retired, its gate still open, its class still allowed, and every phrase
-- it showed still live in it. Demo exit: a language with a unit whose
-- candidates are all in the build as reviewed drops its demo lessons.
create function private.release_plan(p_release text, p_today date)
returns table (
  lesson_id text,
  course_id text,
  unit_id text,
  language_code text,
  lesson_class text,
  source text,
  included boolean,
  in_previous boolean,
  reasons jsonb,
  lesson jsonb
)
language sql
stable
set search_path = ''
as $$
  with prev as (
    select r.seq, r.payload
    from content.releases r
    where r.seq = private.previous_release_seq(p_release)
  ),
  prev_lessons as (
    select pl.value ->> 'id' as lesson_id,
           pl.value as lesson,
           coalesce(rl.lesson_class,
             case when not exists (
               select 1 from jsonb_array_elements(pl.value -> 'items') it
               where not exists (select 1 from content.demo_items x where x.item_id = it.value ->> 'id'))
             then 'demo' else 'reviewed' end) as lesson_class
    from prev
    cross join lateral jsonb_array_elements(prev.payload -> 'courses') c
    cross join lateral jsonb_array_elements(c.value -> 'units') u
    cross join lateral jsonb_array_elements(u.value -> 'lessons') pl
    left join content.release_lessons rl
      on rl.release_seq = prev.seq and rl.lesson_id = pl.value ->> 'id'
  ),
  cand as (
    select * from private.lesson_candidates(p_today)
  ),
  lesson_keys as (
    select c.lesson_id from cand c
    union
    select p.lesson_id from prev_lessons p
  ),
  base as (
    select
      k.lesson_id,
      l.course_id,
      l.unit_id,
      split_part(k.lesson_id, '-', 1) as language_code,
      c.lesson_class as cand_class,
      coalesce(c.publishable, false) as publishable,
      c.reasons as cand_reasons,
      p.lesson as prev_lesson,
      p.lesson_class as prev_class,
      l.position,
      l.retired_at,
      lang.name as language_name,
      dp.live as demo_live,
      dp.sunset as demo_sunset,
      (c.lesson_id is not null) as is_candidate
    from lesson_keys k
    left join cand c on c.lesson_id = k.lesson_id
    left join prev_lessons p on p.lesson_id = k.lesson_id
    left join content.lessons l on l.id = k.lesson_id
    left join content.languages lang on lang.code = split_part(k.lesson_id, '-', 1)
    left join content.demo_period dp on dp.language_code = split_part(k.lesson_id, '-', 1)
  ),
  carry as (
    select b.*,
      case
        when b.publishable or b.prev_lesson is null then null
        when b.retired_at is not null or not b.is_candidate
             or b.cand_reasons @> '[{"code":"retired"}]'::jsonb then 'retired'
        when private.effective_gate(b.lesson_id) is distinct from 'open' then 'gated'
        when b.prev_class = 'demo'
             and not (coalesce(b.demo_live, false) and p_today <= b.demo_sunset) then 'demo'
        when exists (
          select 1 from jsonb_array_elements(b.prev_lesson -> 'items') it
          where not exists (
            select 1 from content.items i
            where i.id = it.value ->> 'id' and i.retired_at is null and i.lesson_id = b.lesson_id)
        ) then 'items'
        else 'ok'
      end as carry_state
    from base b
  ),
  first_pass as (
    select c.*,
      case
        when c.publishable then 'current'
        when c.carry_state = 'ok' then 'carried'
      end as source0,
      case
        when c.publishable then c.cand_class
        when c.carry_state = 'ok' then c.prev_class
        else coalesce(c.cand_class, c.prev_class)
      end as class0
    from carry c
  ),
  -- Demo exit: languages with a unit whose every candidate is in the build as reviewed.
  exit_units as (
    select f.unit_id
    from first_pass f
    where f.is_candidate
    group by f.unit_id
    having bool_and(f.source0 is not null and f.class0 = 'reviewed')
  ),
  exit_languages as (
    select distinct split_part(e.unit_id, '-', 1) as language_code from exit_units e
  ),
  decided as (
    select f.*,
      (f.class0 = 'demo' and f.source0 is not null
        and f.language_code in (select e.language_code from exit_languages e)) as exited
    from first_pass f
  )
  select
    d.lesson_id,
    d.course_id,
    d.unit_id,
    d.language_code,
    d.class0 as lesson_class,
    case when d.source0 is not null and not d.exited then d.source0 end as source,
    (d.source0 is not null and not d.exited) as included,
    (d.prev_lesson is not null) as in_previous,
    case
      when d.source0 is not null and not d.exited then '[]'::jsonb
      when d.exited then jsonb_build_array(jsonb_build_object(
        'code', 'demo_exit',
        'message', format('Reviewed lessons now replace the starter content for %s.', d.language_name)))
      else coalesce(d.cand_reasons, '[]'::jsonb)
        || case
             when d.carry_state = 'retired' and d.cand_reasons is null then jsonb_build_array(jsonb_build_object(
               'code', 'retired', 'message', 'This lesson is retired.'))
             when d.carry_state = 'items' then jsonb_build_array(jsonb_build_object(
               'code', 'not_carried',
               'message', 'It can''t stay at its last published version: a phrase it showed was retired or moved.'))
             else '[]'::jsonb
           end
    end as reasons,
    case
      when d.source0 is null or d.exited then null
      when d.source0 = 'current' then private.lesson_json(d.lesson_id)
      else jsonb_set(d.prev_lesson, '{order}', to_jsonb(d.position))
    end as lesson
  from decided d
$$;

-- The learner copy for p_release from the lessons given as a JSON array of
-- {lesson_id, lesson}: everything else comes from the tables now.
create function private.assemble_learner_copy(p_release text, p_lessons jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_courses jsonb;
  v_varieties jsonb;
  v_languages jsonb;
  v_keymap jsonb;
  v_lesson_ids text[];
  v_course_ids text[];
  v_item_ids text[];
  v_variety_ids text[];
  v_language_codes text[];
  v_content jsonb;
begin
  with chosen as (
    select x.value ->> 'lesson_id' as lesson_id, x.value -> 'lesson' as lesson
    from jsonb_array_elements(coalesce(p_lessons, '[]'::jsonb)) x
  ),
  by_unit as (
    select l.unit_id, jsonb_agg(ch.lesson order by l.position) as lessons
    from chosen ch
    join content.lessons l on l.id = ch.lesson_id
    group by l.unit_id
  ),
  by_course as (
    select u.course_id,
           jsonb_agg(jsonb_build_object(
             'id', u.id, 'order', u.position, 'title', u.title, 'lessons', bu.lessons
           ) order by u.position) as units
    from by_unit bu
    join content.units u on u.id = bu.unit_id
    group by u.course_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'language', c.language_code,
           'variety', c.variety_id,
           'name', c.name,
           'tagline', coalesce(c.tagline, ''),
           'units', bc.units
         ) order by c.id collate "C"), '[]'::jsonb)
    into v_courses
  from by_course bc
  join content.courses c on c.id = bc.course_id;

  select coalesce(array_agg(l.value ->> 'id'), '{}')
    into v_lesson_ids
  from jsonb_array_elements(v_courses) c,
       jsonb_array_elements(c.value -> 'units') u,
       jsonb_array_elements(u.value -> 'lessons') l;
  select coalesce(array_agg(c.value ->> 'id'), '{}')
    into v_course_ids
  from jsonb_array_elements(v_courses) c;
  select coalesce(array_agg(i.value ->> 'id'), '{}')
    into v_item_ids
  from jsonb_array_elements(v_courses) c,
       jsonb_array_elements(c.value -> 'units') u,
       jsonb_array_elements(u.value -> 'lessons') l,
       jsonb_array_elements(l.value -> 'items') i;

  -- Varieties that something left refers to: courses, lessons and items.
  select coalesce(array_agg(distinct v), '{}') into v_variety_ids
  from (
    select c.value ->> 'variety' as v from jsonb_array_elements(v_courses) c
    union all
    select l.value ->> 'variety'
    from jsonb_array_elements(v_courses) c,
         jsonb_array_elements(c.value -> 'units') u,
         jsonb_array_elements(u.value -> 'lessons') l
    union all
    select i.value ->> 'variety'
    from jsonb_array_elements(v_courses) c,
         jsonb_array_elements(c.value -> 'units') u,
         jsonb_array_elements(u.value -> 'lessons') l,
         jsonb_array_elements(l.value -> 'items') i
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'language', v.language_code, 'learner_label', v.learner_label
         ) order by v.id collate "C"), '[]'::jsonb)
    into v_varieties
  from content.varieties v
  where v.id = any (v_variety_ids);

  select coalesce(array_agg(distinct code), '{}') into v_language_codes
  from (
    select c.value ->> 'language' as code from jsonb_array_elements(v_courses) c
    union all
    select v.value ->> 'language' from jsonb_array_elements(v_varieties) v
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', l.code, 'name', l.name, 'native_name', l.native_name, 'direction', l.direction
         ) order by l.code collate "C"), '[]'::jsonb)
    into v_languages
  from content.languages l
  where l.code = any (v_language_codes);

  v_keymap := jsonb_build_object(
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'legacy_key', k.legacy_key, 'lesson_id', k.lesson_id, 'course_id', k.course_id
             ) order by k.position)
      from content.keymap_lessons k
      where k.lesson_id = any (v_lesson_ids) and k.course_id = any (v_course_ids)
    ), '[]'::jsonb),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object('legacy_id', k.legacy_id, 'course_id', k.course_id) order by k.position)
      from content.keymap_courses k
      where k.course_id = any (v_course_ids)
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('legacy_ref', k.legacy_ref, 'item_id', k.item_id) order by k.position)
      from content.keymap_items k
      where k.item_id = any (v_item_ids)
    ), '[]'::jsonb)
  );

  v_content := jsonb_build_object(
    'languages', v_languages,
    'varieties', v_varieties,
    'courses', v_courses,
    'keymap', v_keymap
  );

  return jsonb_build_object(
    'format', 'polilingo.learner@1',
    'schemaVersion', 1,
    'release', p_release,
    'commit', null,
    'contentHash', 'sha256-' || encode(sha256(convert_to(private.canonical_json(v_content), 'UTF8')), 'hex')
  ) || v_content;
end $$;

-- The learner copy a release named p_release holds on p_today (UTC).
create function private.build_learner_copy(p_release text, p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.assemble_learner_copy(
    p_release,
    coalesce((
      select jsonb_agg(jsonb_build_object('lesson_id', p.lesson_id, 'lesson', p.lesson))
      from private.release_plan(p_release, p_today) p
      where p.included
    ), '[]'::jsonb)
  )
$$;

-- Independent last checks on a built copy. Returns a JSON array of problems
-- in words; empty when the copy is sound. publish_release refuses anything
-- else with PL500_BUILD_BUG.
create function private.verify_learner_copy(p jsonb, p_today date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_out text[] := '{}';
  v_bad text;
  v_hash text;
  v_lessons jsonb;
  v_items jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_array('The copy is not a JSON object.');
  end if;
  if p ->> 'format' is distinct from 'polilingo.learner@1' or p -> 'schemaVersion' is distinct from '1'::jsonb then
    v_out := v_out || 'The format or schema version is wrong.'::text;
  end if;
  if coalesce(p ->> 'release', '') !~ '^content@\d{4}\.\d{2}\.\d{1,6}$' then
    v_out := v_out || format('The release name %s is not content@YYYY.MM.N.', p ->> 'release');
  end if;
  v_hash := 'sha256-' || encode(sha256(convert_to(private.canonical_json(jsonb_build_object(
    'languages', p -> 'languages', 'varieties', p -> 'varieties',
    'courses', p -> 'courses', 'keymap', p -> 'keymap')), 'UTF8')), 'hex');
  if v_hash is distinct from p ->> 'contentHash' then
    v_out := v_out || format('contentHash %s does not recompute (%s).', p ->> 'contentHash', v_hash);
  end if;

  -- The copy's lessons and phrases as rows, for the checks below.
  select coalesce(jsonb_agg(jsonb_build_object(
           'course_id', c.value ->> 'id', 'unit_id', u.value ->> 'id',
           'lesson_id', l.value ->> 'id', 'variety', l.value ->> 'variety', 'lesson', l.value)), '[]'::jsonb)
    into v_lessons
  from jsonb_array_elements(coalesce(p -> 'courses', '[]'::jsonb)) c,
       jsonb_array_elements(coalesce(c.value -> 'units', '[]'::jsonb)) u,
       jsonb_array_elements(coalesce(u.value -> 'lessons', '[]'::jsonb)) l;
  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson_id', l.value ->> 'lesson_id', 'item_id', i.value ->> 'id', 'variety', i.value ->> 'variety')), '[]'::jsonb)
    into v_items
  from jsonb_array_elements(v_lessons) l,
       jsonb_array_elements(coalesce(l.value #> '{lesson,items}', '[]'::jsonb)) i;

  -- Every id once.
  select string_agg(d.id, ', ') into v_bad from (
    select x.id from (
      select c.value ->> 'id' as id from jsonb_array_elements(coalesce(p -> 'courses', '[]'::jsonb)) c
      union all select u.unit_id from (
        select distinct l.course_id, l.unit_id
        from jsonb_to_recordset(v_lessons) l(course_id text, unit_id text)) u
      union all select l.lesson_id from jsonb_to_recordset(v_lessons) l(lesson_id text)
      union all select i.item_id from jsonb_to_recordset(v_items) i(item_id text)
      union all select e.value ->> 'id'
        from jsonb_array_elements(v_lessons) l,
             jsonb_array_elements(coalesce(l.value #> '{lesson,exercises}', '[]'::jsonb)) e
    ) x group by x.id having count(*) > 1
  ) d;
  if v_bad is not null then
    v_out := v_out || format('Ids appear twice: %s.', v_bad);
  end if;

  select string_agg(l.lesson_id, ', ') into v_bad
  from jsonb_to_recordset(v_lessons) l(lesson_id text, lesson jsonb)
  where jsonb_array_length(coalesce(l.lesson -> 'items', '[]'::jsonb)) not between 1 and 12
     or jsonb_array_length(coalesce(l.lesson -> 'exercises', '[]'::jsonb)) < 1;
  if v_bad is not null then
    v_out := v_out || format('Lessons without 1-12 phrases and an exercise: %s.', v_bad);
  end if;

  select string_agg(e.value ->> 'id', ', ') into v_bad
  from jsonb_to_recordset(v_lessons) l(lesson_id text, lesson jsonb),
       jsonb_array_elements(coalesce(l.lesson -> 'exercises', '[]'::jsonb)) e
  where coalesce(e.value ->> 'kind', '') not in ('meaning', 'translation', 'match', 'assemble', 'context')
     or not exists (
       select 1 from jsonb_to_recordset(v_items) i(lesson_id text, item_id text)
       where i.lesson_id = l.lesson_id and i.item_id = e.value ->> 'item')
     or exists (
       select 1 from jsonb_array_elements_text(coalesce(e.value -> 'options', '[]'::jsonb)) o
       where not exists (
         select 1 from jsonb_to_recordset(v_items) i(lesson_id text, item_id text)
         where i.lesson_id = l.lesson_id and i.item_id = o));
  if v_bad is not null then
    v_out := v_out || format('Exercises that use a phrase outside their lesson: %s.', v_bad);
  end if;

  select string_agg(distinct s.v, ', ') into v_bad
  from (
    select c.value ->> 'variety' as v from jsonb_array_elements(coalesce(p -> 'courses', '[]'::jsonb)) c
    union all select l.variety from jsonb_to_recordset(v_lessons) l(variety text)
    union all select i.variety from jsonb_to_recordset(v_items) i(variety text)
  ) s
  where not exists (
    select 1 from jsonb_array_elements(coalesce(p -> 'varieties', '[]'::jsonb)) vv
    where vv.value ->> 'id' = s.v);
  if v_bad is not null then
    v_out := v_out || format('Varieties referred to but not listed: %s.', v_bad);
  end if;

  select string_agg(distinct s.code, ', ') into v_bad
  from (
    select c.value ->> 'language' as code from jsonb_array_elements(coalesce(p -> 'courses', '[]'::jsonb)) c
    union all select v.value ->> 'language' from jsonb_array_elements(coalesce(p -> 'varieties', '[]'::jsonb)) v
  ) s
  where not exists (
    select 1 from jsonb_array_elements(coalesce(p -> 'languages', '[]'::jsonb)) ll
    where ll.value ->> 'code' = s.code);
  if v_bad is not null then
    v_out := v_out || format('Languages referred to but not listed: %s.', v_bad);
  end if;

  select string_agg(s.x, ', ') into v_bad
  from (
    select l.code as x from content.languages l
    where l.publish_gate = 'blocked'
      and exists (select 1 from jsonb_array_elements(coalesce(p -> 'languages', '[]'::jsonb)) ll
                  where ll.value ->> 'code' = l.code)
    union all
    select v.id from content.varieties v
    where v.publish_gate = 'blocked'
      and exists (select 1 from jsonb_array_elements(coalesce(p -> 'varieties', '[]'::jsonb)) vv
                  where vv.value ->> 'id' = v.id)
  ) s;
  if v_bad is not null then
    v_out := v_out || format('Publish-gated languages or varieties reached the copy: %s.', v_bad);
  end if;

  -- Demo phrases only while their language's demo is live and not past its sunset.
  select string_agg(i.item_id, ', ') into v_bad
  from jsonb_to_recordset(v_items) i(item_id text)
  join content.demo_items x on x.item_id = i.item_id
  left join content.demo_period dp on dp.language_code = split_part(i.item_id, '-', 1)
  where not coalesce(dp.live and p_today <= dp.sunset, false);
  if v_bad is not null then
    v_out := v_out || format('Starter phrases that must not be shown reached the copy: %s.', v_bad);
  end if;

  -- Every other phrase is reviewed and publishable now, or was published before (carried).
  select string_agg(i.item_id, ', ') into v_bad
  from jsonb_to_recordset(v_items) i(item_id text)
  where not exists (select 1 from content.demo_items x where x.item_id = i.item_id)
    and not private.item_reviewed_ok(i.item_id)
    and not exists (select 1 from content.release_items ri where ri.item_id = i.item_id);
  if v_bad is not null then
    v_out := v_out || format('Phrases that were never approved reached the copy: %s.', v_bad);
  end if;

  select string_agg(k.value::text, ', ') into v_bad
  from jsonb_array_elements(coalesce(p #> '{keymap,lessons}', '[]'::jsonb)) k
  where not exists (
    select 1 from jsonb_to_recordset(v_lessons) l(course_id text, lesson_id text)
    where l.lesson_id = k.value ->> 'lesson_id' and l.course_id = k.value ->> 'course_id');
  if v_bad is not null then
    v_out := v_out || format('Keymap lesson rows that do not resolve: %s.', v_bad);
  end if;
  select string_agg(k.value::text, ', ') into v_bad
  from jsonb_array_elements(coalesce(p #> '{keymap,items}', '[]'::jsonb)) k
  where not exists (
    select 1 from jsonb_to_recordset(v_items) i(item_id text)
    where i.item_id = k.value ->> 'item_id');
  if v_bad is not null then
    v_out := v_out || format('Keymap item rows that do not resolve: %s.', v_bad);
  end if;

  return to_jsonb(v_out);
end $$;

-- content@<UTC YYYY>.<MM>.<n+1>, or .1 in a new month.
create function private.next_release_name(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  with t as (
    select extract(year from p_at at time zone 'UTC')::int as y,
           extract(month from p_at at time zone 'UTC')::int as m
  )
  select format('content@%s.%s.%s', t.y, lpad(t.m::text, 2, '0'),
                coalesce((select max(r.n) from content.releases r where r.y = t.y and r.m = t.m), 0) + 1)
  from t
$$;

-- Whether the release clock can be trusted at p_at: no release is named
-- for a later month, and none was published in the future.
create function private.release_clock_ok(p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1 from content.releases r
    where (r.y, r.m) > (extract(year from p_at at time zone 'UTC')::int,
                        extract(month from p_at at time zone 'UTC')::int)
       or r.published_at > p_at + interval '5 minutes'
  )
$$;

-- ---------------------------------------------------------------------------
-- Preview (editor/admin)
-- ---------------------------------------------------------------------------

-- The preview body for a plan already worked out. Internal: preview_release
-- and page_admin_publish call it after their role checks.
create function private.preview_body()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_today date := (now() at time zone 'UTC')::date;
  v_name text := private.next_release_name(now());
  v_plan jsonb;
  v_copy jsonb;
  v_latest content.releases%rowtype;
  v_latest_lessons jsonb := '{}'::jsonb;
  v_diff jsonb;
  v_excluded jsonb;
  v_awaiting jsonb;
  v_stats jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(p) order by p.lesson_id collate "C"), '[]'::jsonb)
    into v_plan
  from private.release_plan(v_name, v_today) p;

  v_copy := private.assemble_learner_copy(v_name, coalesce((
    select jsonb_agg(jsonb_build_object('lesson_id', x.value ->> 'lesson_id', 'lesson', x.value -> 'lesson'))
    from jsonb_array_elements(v_plan) x
    where (x.value ->> 'included')::boolean
  ), '[]'::jsonb));

  select * into v_latest from content.releases r order by r.seq desc limit 1;
  if found then
    select coalesce(jsonb_object_agg(l.value ->> 'id', jsonb_build_object(
             'lesson', l.value,
             'course_id', c.value ->> 'id',
             'course_name', c.value ->> 'name',
             'unit_title', u.value ->> 'title',
             'language', c.value ->> 'language')), '{}'::jsonb)
      into v_latest_lessons
    from jsonb_array_elements(v_latest.payload -> 'courses') c,
         jsonb_array_elements(c.value -> 'units') u,
         jsonb_array_elements(u.value -> 'lessons') l;
  end if;

  -- One row per lesson for the preview lists.
  with plan as (
    select x.value as p from jsonb_array_elements(v_plan) x
  ),
  lr as (
    select
      p ->> 'lesson_id' as id,
      (p ->> 'included')::boolean as included,
      p ->> 'source' as source,
      p ->> 'lesson_class' as lesson_class,
      p -> 'reasons' as reasons,
      p -> 'lesson' as lesson,
      v_latest_lessons -> (p ->> 'lesson_id') as old,
      jsonb_build_object(
        'id', p ->> 'lesson_id',
        'title', coalesce(p #>> '{lesson,title}', l.title, v_latest_lessons #>> array[p ->> 'lesson_id', 'lesson', 'title']),
        'language', split_part(p ->> 'lesson_id', '-', 1),
        'language_name', lang.name,
        'direction', lang.direction,
        'course_id', coalesce(c.id, v_latest_lessons #>> array[p ->> 'lesson_id', 'course_id']),
        'course_name', coalesce(c.name, v_latest_lessons #>> array[p ->> 'lesson_id', 'course_name']),
        'unit_title', coalesce(u.title, v_latest_lessons #>> array[p ->> 'lesson_id', 'unit_title']),
        'class', p ->> 'lesson_class',
        'source', p ->> 'source',
        'items', coalesce(jsonb_array_length(p #> '{lesson,items}'), 0),
        'exercises', coalesce(jsonb_array_length(p #> '{lesson,exercises}'), 0),
        'reasons', p -> 'reasons',
        'in_previous', (p ->> 'in_previous')::boolean,
        'sort', format('%s/%s/%s', coalesce(c.id, ''), lpad(coalesce(u.position, 0)::text, 6, '0'), lpad(coalesce(l.position, 0)::text, 6, '0'))
      ) as summary
    from plan
    left join content.lessons l on l.id = p ->> 'lesson_id'
    left join content.units u on u.id = l.unit_id
    left join content.courses c on c.id = l.course_id
    left join content.languages lang on lang.code = split_part(p ->> 'lesson_id', '-', 1)
  )
  select
    jsonb_build_object(
      'added', coalesce(jsonb_agg(r.summary order by r.summary ->> 'sort' collate "C")
                 filter (where r.included and r.old is null), '[]'::jsonb),
      'changed', coalesce(jsonb_agg(r.summary order by r.summary ->> 'sort' collate "C")
                 filter (where r.included and r.source = 'current' and r.old is not null
                           and (r.old -> 'lesson') is distinct from r.lesson), '[]'::jsonb),
      'carried', coalesce(jsonb_agg(r.summary order by r.summary ->> 'sort' collate "C")
                 filter (where r.included and r.source = 'carried'), '[]'::jsonb),
      'removed', coalesce(jsonb_agg(r.summary order by r.summary ->> 'sort' collate "C")
                 filter (where not r.included and r.old is not null), '[]'::jsonb),
      'unchanged', count(*) filter (where r.included and r.source = 'current' and (r.old -> 'lesson') = r.lesson)
    ),
    coalesce(jsonb_agg(r.summary order by r.summary ->> 'sort' collate "C")
      filter (where not r.included and r.old is null), '[]'::jsonb)
    into v_diff, v_excluded
  from lr r;

  select coalesce(jsonb_agg(jsonb_build_object(
           'decision_id', a.decision_id,
           'target_type', a.target_type,
           'target_id', a.target_id,
           'lesson_id', coalesce(i.lesson_id, l.id),
           'lesson_title', coalesce(il.title, l.title),
           'native', i.native,
           'romanisation', i.romanisation,
           'meaning', i.meaning,
           'variety_id', a.variety_id,
           'variety_name', v.name,
           'language', v.language_code,
           'language_name', lang.name,
           'direction', lang.direction,
           'reviewer_id', a.reviewer_contributor_id,
           'reviewer_name', rc.display_name,
           'at', a.at
         ) order by a.at, a.decision_id), '[]'::jsonb)
    into v_awaiting
  from content.awaiting_countersign a
  left join content.items i on a.target_type = 'item' and i.id = a.target_id
  left join content.lessons il on il.id = i.lesson_id
  left join content.lessons l on a.target_type = 'lesson' and l.id = a.target_id
  join content.varieties v on v.id = a.variety_id
  join content.languages lang on lang.code = v.language_code
  left join public.contributors rc on rc.id = a.reviewer_contributor_id;

  select jsonb_build_object(
    'lessons', count(*) filter (where (x.value ->> 'included')::boolean),
    'demo_lessons', count(*) filter (where (x.value ->> 'included')::boolean and x.value ->> 'lesson_class' = 'demo'),
    'reviewed_lessons', count(*) filter (where (x.value ->> 'included')::boolean and x.value ->> 'lesson_class' = 'reviewed'),
    'carried_lessons', count(*) filter (where x.value ->> 'source' = 'carried'),
    'held_back', count(*) filter (where not (x.value ->> 'included')::boolean),
    'items', coalesce(sum(jsonb_array_length(x.value #> '{lesson,items}')) filter (where (x.value ->> 'included')::boolean), 0),
    'exercises', coalesce(sum(jsonb_array_length(x.value #> '{lesson,exercises}')) filter (where (x.value ->> 'included')::boolean), 0),
    'languages', jsonb_array_length(v_copy -> 'languages')
  ) into v_stats
  from jsonb_array_elements(v_plan) x;

  return jsonb_build_object(
    'release', v_name,
    'today', v_today,
    'generated_at', v_now,
    'payload', v_copy,
    'contentHash', v_copy ->> 'contentHash',
    'base', case when v_latest.seq is null then null else jsonb_build_object(
      'name', v_latest.name,
      'contentHash', v_latest.content_hash,
      'published_at', v_latest.published_at) end,
    'unchanged', v_latest.seq is not null and v_latest.content_hash = v_copy ->> 'contentHash',
    'empty', jsonb_array_length(v_copy -> 'courses') = 0,
    'clock_ok', private.release_clock_ok(v_now),
    'diff', v_diff,
    'excluded', v_excluded,
    'awaiting_countersign', v_awaiting,
    'stats', v_stats
  );
end $$;

-- What the next publish would give learners (§3.9 F): {release, payload,
-- contentHash, base, unchanged, empty, clock_ok, diff {added, changed,
-- carried, removed, unchanged}, excluded, awaiting_countersign, stats}.
-- Editors and admins; definer, so an editor scoped to one language still
-- sees the whole release the button would publish.
create function public.preview_release()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not exists (select 1 from private.my_active_grants() g where g.role in ('admin', 'editor')) then
    perform private.raise('PL403_NOT_EDITOR', 'Only editors and admins can preview a release.');
  end if;
  return private.preview_body();
end $$;

-- ---------------------------------------------------------------------------
-- Publish (admin)
-- ---------------------------------------------------------------------------

create function public.publish_release(p_expected_content_hash text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_today date := (now() at time zone 'UTC')::date;
  v_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_plan jsonb;
  v_copy jsonb;
  v_hash text;
  v_latest content.releases%rowtype;
  v_prev_seq bigint;
  v_seq bigint;
  v_problems jsonb;
  v_lessons int;
  v_items int;
  v_stats jsonb;
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not private.is_admin() then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can publish a release.');
  end if;
  if p_expected_content_hash is null or p_expected_content_hash !~ '^sha256-[0-9a-f]{64}$' then
    perform private.raise('PL422_BAD_INPUT', 'Open the preview first, then publish what it shows.');
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    perform private.raise('PL422_LENGTH', 'Keep the release note under 500 characters.');
  end if;

  -- One publish at a time, and no content change while this one builds.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('polilingo.publish_release', 0));
  lock table content.languages, content.varieties, content.courses, content.units,
             content.lessons, content.items, content.exercises, content.demo_items,
             content.demo_period, content.review_decisions, content.countersignatures,
             content.keymap_lessons, content.keymap_items, content.keymap_courses
    in share mode;

  if not private.release_clock_ok(v_now) then
    perform private.raise('PL409_RELEASE_CLOCK',
      'A release is dated later than now, so the next name can''t be worked out.',
      jsonb_build_object('now', v_now));
  end if;
  v_name := private.next_release_name(v_now);

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_plan
  from private.release_plan(v_name, v_today) p
  where p.included;
  v_copy := private.assemble_learner_copy(v_name, (
    select coalesce(jsonb_agg(jsonb_build_object('lesson_id', x.value ->> 'lesson_id', 'lesson', x.value -> 'lesson')), '[]'::jsonb)
    from jsonb_array_elements(v_plan) x));
  v_hash := v_copy ->> 'contentHash';

  if v_hash is distinct from p_expected_content_hash then
    perform private.raise('PL409_RELEASE_CHANGED',
      'Something changed since the preview was opened.',
      jsonb_build_object('expected', p_expected_content_hash, 'current', v_hash));
  end if;

  select * into v_latest from content.releases r order by r.seq desc limit 1;
  if found and v_latest.content_hash = v_hash then
    perform private.raise('PL409_NOTHING_TO_PUBLISH',
      format('Learners already have this content in %s.', v_latest.name),
      jsonb_build_object('release', v_latest.name));
  end if;

  v_lessons := jsonb_array_length(v_plan);
  if v_lessons = 0 then
    perform private.raise('PL422_EMPTY_RELEASE', 'This release would have no lessons in it.');
  end if;

  v_problems := private.verify_learner_copy(v_copy, v_today);
  if jsonb_array_length(v_problems) > 0 then
    perform private.raise('PL500_BUILD_BUG',
      'The built release failed its own checks, so nothing was published.',
      jsonb_build_object('problems', v_problems));
  end if;

  v_prev_seq := private.previous_release_seq(v_name);
  select count(*) into v_items
  from jsonb_array_elements(v_plan) x, jsonb_array_elements(x.value #> '{lesson,items}') i;

  v_stats := jsonb_build_object(
    'languages', jsonb_array_length(v_copy -> 'languages'),
    'varieties', jsonb_array_length(v_copy -> 'varieties'),
    'courses', jsonb_array_length(v_copy -> 'courses'),
    'lessons', v_lessons,
    'items', v_items,
    'exercises', (select count(*) from jsonb_array_elements(v_plan) x, jsonb_array_elements(x.value #> '{lesson,exercises}') e),
    'demoLessons', (select count(*) from jsonb_array_elements(v_plan) x where x.value ->> 'lesson_class' = 'demo'),
    'reviewedLessons', (select count(*) from jsonb_array_elements(v_plan) x where x.value ->> 'lesson_class' = 'reviewed'),
    'carriedLessons', (select count(*) from jsonb_array_elements(v_plan) x where x.value ->> 'source' = 'carried'),
    'releaseLessons', v_lessons,
    'releaseItems', v_items
  );

  insert into content.releases (name, kind, content_hash, payload, published_by, published_at, note, stats)
  values (v_name, 'publish', v_hash, v_copy, private.current_contributor_id(), v_now, v_note, v_stats)
  returning seq into v_seq;

  insert into content.release_lessons (release_seq, lesson_id, lesson_class, source, review_fingerprint, decision_id)
  select v_seq,
         x.value ->> 'lesson_id',
         x.value ->> 'lesson_class',
         x.value ->> 'source',
         case when x.value ->> 'source' = 'current' then l.review_fingerprint else prev.review_fingerprint end,
         case
           when x.value ->> 'source' = 'carried' then prev.decision_id
           when x.value ->> 'lesson_class' = 'reviewed' then l.current_decision_id
         end
  from jsonb_array_elements(v_plan) x
  join content.lessons l on l.id = x.value ->> 'lesson_id'
  left join content.release_lessons prev on prev.release_seq = v_prev_seq and prev.lesson_id = x.value ->> 'lesson_id';

  insert into content.release_items (release_seq, item_id, lesson_id, is_demo, review_fingerprint, decision_id)
  select v_seq,
         it.value ->> 'id',
         x.value ->> 'lesson_id',
         exists (select 1 from content.demo_items d where d.item_id = it.value ->> 'id'),
         case when x.value ->> 'source' = 'current' then i.review_fingerprint else prev.review_fingerprint end,
         case
           when x.value ->> 'source' = 'carried' then prev.decision_id
           when x.value ->> 'lesson_class' = 'reviewed' then i.current_decision_id
         end
  from jsonb_array_elements(v_plan) x
  cross join lateral jsonb_array_elements(x.value #> '{lesson,items}') it
  join content.items i on i.id = it.value ->> 'id'
  left join content.release_items prev on prev.release_seq = v_prev_seq and prev.item_id = it.value ->> 'id';

  perform private.audit('release.published', 'release', v_name, jsonb_build_object(
    'kind', 'publish',
    'content_hash', v_hash,
    'previous', v_latest.name,
    'note', v_note,
    'stats', v_stats
  ));

  return jsonb_build_object('name', v_name, 'contentHash', v_hash, 'lessons', v_lessons, 'items', v_items);
end $$;

-- ---------------------------------------------------------------------------
-- Rollback (admin, optional in §3.9 F)
-- ---------------------------------------------------------------------------

-- Gives learners an earlier release's lessons again, exactly as they were,
-- as a new release (kind 'rollback') under the next name: releases are
-- append-only, so nothing is deleted and the history shows both. The copy is
-- the earlier payload with only its release name changed, so its
-- contentHash is the earlier one. It must still pass verify_learner_copy
-- today: a demo whose period has ended or a language whose gate has closed
-- since cannot come back (PL409_NOT_PUBLISHABLE).
--
-- The next preview is built from the tables as always, so lessons that are
-- ready now appear in it again; a lesson that must stay out needs its
-- publish gate closed.
create function public.rollback_release(p_release_name text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_today date := (now() at time zone 'UTC')::date;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target content.releases%rowtype;
  v_latest content.releases%rowtype;
  v_name text;
  v_copy jsonb;
  v_problems jsonb;
  v_seq bigint;
  v_lessons int;
  v_items int;
  v_stats jsonb;
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not private.is_admin() then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can roll back a release.');
  end if;
  if p_release_name is null or p_release_name !~ '^content@\d{4}\.\d{2}\.\d{1,6}$' then
    perform private.raise('PL422_BAD_INPUT', 'Choose a release from the history to go back to.');
  end if;
  if v_reason is null then
    perform private.raise('PL422_COMMENT_REQUIRED', 'Say in a few words why learners should go back to it.');
  end if;
  if char_length(v_reason) > 500 then
    perform private.raise('PL422_LENGTH', 'Keep the reason under 500 characters.');
  end if;

  -- The same lock as publish_release: one release at a time.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('polilingo.publish_release', 0));

  select * into v_target from content.releases r where r.name = p_release_name;
  if not found then
    perform private.raise('PL404_NOT_FOUND', format('There is no release called %s.', p_release_name));
  end if;

  if not private.release_clock_ok(v_now) then
    perform private.raise('PL409_RELEASE_CLOCK',
      'A release is dated later than now, so the next name can''t be worked out.',
      jsonb_build_object('now', v_now));
  end if;

  select * into v_latest from content.releases r order by r.seq desc limit 1;
  if v_latest.content_hash = v_target.content_hash then
    perform private.raise('PL409_NOTHING_TO_PUBLISH',
      format('Learners already have this content in %s.', v_latest.name),
      jsonb_build_object('release', v_latest.name));
  end if;

  v_name := private.next_release_name(v_now);
  v_copy := v_target.payload || jsonb_build_object('release', v_name, 'commit', null);

  v_problems := private.verify_learner_copy(v_copy, v_today);
  if jsonb_array_length(v_problems) > 0 then
    perform private.raise('PL409_NOT_PUBLISHABLE',
      format('%s can''t come back as it was: some of its lessons can''t be shown to learners any more.', v_target.name),
      jsonb_build_object('release', v_target.name, 'problems', v_problems));
  end if;

  select count(*) into v_lessons from content.release_lessons rl where rl.release_seq = v_target.seq;
  select count(*) into v_items from content.release_items ri where ri.release_seq = v_target.seq;
  v_stats := coalesce(v_target.stats, '{}'::jsonb) || jsonb_build_object(
    'releaseLessons', v_lessons,
    'releaseItems', v_items,
    'rolledBackTo', v_target.name
  );

  insert into content.releases (name, kind, content_hash, payload, published_by, published_at, note, stats)
  values (v_name, 'rollback', v_target.content_hash, v_copy, private.current_contributor_id(), v_now, v_reason, v_stats)
  returning seq into v_seq;

  insert into content.release_lessons (release_seq, lesson_id, lesson_class, source, review_fingerprint, decision_id)
  select v_seq, rl.lesson_id, rl.lesson_class, 'carried', rl.review_fingerprint, rl.decision_id
  from content.release_lessons rl
  where rl.release_seq = v_target.seq;

  insert into content.release_items (release_seq, item_id, lesson_id, is_demo, review_fingerprint, decision_id)
  select v_seq, ri.item_id, ri.lesson_id, ri.is_demo, ri.review_fingerprint, ri.decision_id
  from content.release_items ri
  where ri.release_seq = v_target.seq;

  perform private.audit('release.rolled_back', 'release', v_name, jsonb_build_object(
    'kind', 'rollback',
    'restored', v_target.name,
    'content_hash', v_target.content_hash,
    'previous', v_latest.name,
    'reason', v_reason
  ));

  return jsonb_build_object(
    'name', v_name,
    'contentHash', v_target.content_hash,
    'lessons', v_lessons,
    'items', v_items,
    'restored', v_target.name
  );
end $$;

-- ---------------------------------------------------------------------------
-- The page (admin): release history plus the preview
-- ---------------------------------------------------------------------------

create function public.page_admin_publish()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_latest content.releases%rowtype;
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not private.is_admin() then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can open Publish.');
  end if;

  select * into v_latest from content.releases r order by r.seq desc limit 1;

  return jsonb_build_object(
    'preview', private.preview_body(),
    'latest', case when v_latest.seq is null then null else jsonb_build_object(
      'name', v_latest.name,
      'kind', v_latest.kind,
      'contentHash', v_latest.content_hash,
      'published_at', v_latest.published_at,
      'payload', v_latest.payload) end,
    'releases', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', r.name,
               'kind', r.kind,
               'content_hash', r.content_hash,
               'published_at', r.published_at,
               'published_by', r.published_by,
               'published_by_name', c.display_name,
               'note', r.note,
               'restored', r.stats ->> 'rolledBackTo',
               'lessons', (select count(*) from content.release_lessons rl where rl.release_seq = r.seq),
               'items', (select count(*) from content.release_items ri where ri.release_seq = r.seq),
               'demo_lessons', (select count(*) from content.release_lessons rl where rl.release_seq = r.seq and rl.lesson_class = 'demo'),
               'reviewed_lessons', (select count(*) from content.release_lessons rl where rl.release_seq = r.seq and rl.lesson_class = 'reviewed'),
               'carried_lessons', (select count(*) from content.release_lessons rl where rl.release_seq = r.seq and rl.source = 'carried')
             ) order by r.seq desc)
      from (select * from content.releases order by seq desc limit 50) r
      left join public.contributors c on c.id = r.published_by
    ), '[]'::jsonb),
    'countersign_available', to_regprocedure('public.countersign_decision(uuid,text)') is not null
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants (§3.1): the three API functions to authenticated; private ones to nobody.
-- ---------------------------------------------------------------------------

revoke all on function
  private.decision_current(uuid, text),
  private.item_reviewed_ok(text),
  private.lesson_reviewed_ok(text),
  private.closed_gates(text),
  private.lesson_candidates(date),
  private.previous_release_seq(text),
  private.release_plan(text, date),
  private.assemble_learner_copy(text, jsonb),
  private.build_learner_copy(text, date),
  private.verify_learner_copy(jsonb, date),
  private.next_release_name(timestamptz),
  private.release_clock_ok(timestamptz),
  private.preview_body()
from public, anon, authenticated;

revoke all on function
  public.preview_release(),
  public.publish_release(text, text),
  public.rollback_release(text, text),
  public.page_admin_publish()
from public, anon;

grant execute on function
  public.preview_release(),
  public.publish_release(text, text),
  public.rollback_release(text, text),
  public.page_admin_publish()
to authenticated;
