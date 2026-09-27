-- 20260928000200_content_model.sql
-- Owner: Foundation (docs/platform.md §3.4, §3.5, §3.10).
--
-- Every content table and view, the derive/void/revision/guard triggers, and
-- the shared content helpers: native_problems, lesson_problems,
-- effective_gate and lesson_json. Content is written only by SECURITY
-- DEFINER functions (tracks D, E, F) and by the seed; nobody else has a
-- write grant (20260928000500_access.sql).
--
-- Session settings the triggers read (all optional, transaction-local):
--   polilingo.seeding          'on' while a seed runs: revisions get reason
--                              'import', demo rows may be inserted, demo
--                              items may change, and fingerprint changes
--                              caused by loading children do not void.
--   polilingo.revision_reason  the reason written to revisions (default
--                              'create' on insert, 'edit' on update).
--   polilingo.change_author    the contributor id to record as the author
--                              instead of the caller (accept_suggestion
--                              sets it to the suggester).
--   polilingo.suggestion_id    written to revisions.suggestion_id.

-- ---------------------------------------------------------------------------
-- Languages and varieties
-- ---------------------------------------------------------------------------

create table content.languages (
  code text primary key check (code ~ '^[a-z]{2,3}$'),
  name text not null,
  native_name text not null,
  script text not null,
  direction text not null check (direction in ('rtl', 'ltr')),
  locale text not null,
  status text not null default 'provisional',
  publish_gate text not null default 'open' check (publish_gate in ('open', 'blocked')),
  reviewer_of_record text,
  notes text,
  revision_no int not null default 1
);

create table content.varieties (
  id text primary key check (id ~ '^[a-z]{2,3}-var-[a-z0-9-]+$'),
  language_code text not null references content.languages (code),
  name text not null,
  learner_label text not null,
  region text,
  status text not null default 'provisional',
  publish_gate text not null default 'open' check (publish_gate in ('open', 'blocked')),
  reviewer_of_record text,
  pronunciation_notes text,
  notes text,
  revision_no int not null default 1,
  unique (id, language_code),
  check (split_part(id, '-', 1) = language_code)
);

-- ---------------------------------------------------------------------------
-- Courses, units, lessons, items, exercises
-- ---------------------------------------------------------------------------

create table content.courses (
  id text primary key check (id ~ '^[a-z]{2,3}-crs-[a-z0-9-]+$'),
  language_code text not null references content.languages (code),
  variety_id text not null,
  name text not null check (char_length(name) between 1 and 120),
  tagline text not null default '',
  target_learner text,
  outcomes text[] not null default '{}',
  version text,
  status text,
  publish_gate text not null default 'open' check (publish_gate in ('open', 'blocked')),
  scope jsonb,
  retired_at timestamptz,
  revision_no int not null default 1,
  foreign key (variety_id, language_code) references content.varieties (id, language_code),
  check (split_part(id, '-', 1) = language_code)
);

create table content.units (
  id text primary key check (id ~ '^[a-z]{2,3}-unt-[0-9a-f]{6}$'),
  course_id text not null references content.courses (id),
  position int check (position >= 1),
  title text not null check (char_length(title) between 1 and 60),
  goal text not null check (char_length(goal) >= 10),
  theme text,
  -- Units created in the app start held back; the seed passes each unit's YAML gate.
  publish_gate text not null default 'blocked' check (publish_gate in ('open', 'blocked')),
  retired_at timestamptz,
  revision_no int not null default 1,
  unique (id, course_id),
  constraint units_course_position_key unique (course_id, position) deferrable initially deferred,
  check ((position is null) = (retired_at is not null)),
  check (split_part(id, '-', 1) = split_part(course_id, '-', 1))
);

create table content.lessons (
  id text primary key check (id ~ '^[a-z]{2,3}-lsn-[0-9a-f]{6}$'),
  course_id text not null,
  unit_id text not null,
  position int check (position >= 1),
  title text not null check (char_length(title) between 1 and 60),
  subtitle text not null default '' check (char_length(subtitle) <= 120),
  objective text not null check (char_length(objective) >= 10),
  variety_id text not null references content.varieties (id),
  estimated_minutes int check (estimated_minutes between 3 and 15),
  publish_gate text not null default 'open' check (publish_gate in ('open', 'blocked')),
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'approved', 'changes_requested', 'rejected')),
  current_decision_id uuid,
  review_fingerprint char(16),
  last_approved_seq bigint,
  submitted_at timestamptz,
  text_author text,
  retired_at timestamptz,
  revision_no int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- on update cascade: moving a unit to another course (move_content) carries
  -- its lessons' course_id with it in one statement; lesson_derive counts it
  -- as a change, so each lesson gets a revision with the move's reason.
  foreign key (unit_id, course_id) references content.units (id, course_id) on update cascade,
  constraint lessons_unit_position_key unique (unit_id, position) deferrable initially deferred,
  check ((position is null) = (retired_at is not null)),
  check (split_part(variety_id, '-', 1) = split_part(id, '-', 1)),
  check (split_part(course_id, '-', 1) = split_part(id, '-', 1))
);

create table content.items (
  id text primary key check (id ~ '^[a-z]{2,3}-itm-[0-9a-f]{6}$'),
  lesson_id text not null references content.lessons (id),
  position int check (position between 1 and 12),
  native text not null check (char_length(native) between 1 and 300),
  romanisation text not null check (char_length(romanisation) between 1 and 300),
  meaning text not null check (char_length(meaning) between 1 and 200),
  context text check (context is null or (char_length(context) <= 300 and btrim(context) <> '')),
  usage_note text check (usage_note is null or (char_length(usage_note) <= 500 and btrim(usage_note) <> '')),
  variety_id text not null references content.varieties (id),
  tags text[] not null default '{}',
  skills text[] not null default '{}',
  source_type text not null
    check (source_type in ('reviewer_attested', 'community_attested', 'published_work', 'original')),
  source_citation text not null check (char_length(source_citation) >= 3),
  source_licence text not null check (char_length(source_licence) >= 2),
  source_retrieved date,
  source_caveat text,
  alternatives jsonb not null default '[]' check (jsonb_typeof(alternatives) = 'array'),
  audio_default_asset_id text,
  legacy_ref text unique,
  text_fingerprint char(16) not null,
  review_fingerprint char(16) not null,
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'approved', 'changes_requested', 'rejected')),
  current_decision_id uuid,
  last_approved_seq bigint,
  text_author text,
  revision_no int not null default 1,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, lesson_id),
  constraint items_lesson_position_key unique (lesson_id, position) deferrable initially deferred,
  check ((position is null) = (retired_at is not null)),
  check (split_part(variety_id, '-', 1) = split_part(id, '-', 1)),
  check (split_part(lesson_id, '-', 1) = split_part(id, '-', 1))
);

create index items_variety_status_idx on content.items (variety_id, review_status);
create index items_lesson_idx on content.items (lesson_id);

create table content.exercises (
  id text primary key check (id ~ '^[a-z]{2,3}-exr-[0-9a-f]{6}$'),
  lesson_id text not null references content.lessons (id),
  position int check (position >= 1),
  kind text not null check (kind in ('meaning', 'translation', 'match', 'assemble', 'context')),
  answer_item_id text not null,
  prompt text not null check (char_length(prompt) between 1 and 300),
  options text[] not null default '{}',
  difficulty smallint check (difficulty between 1 and 5),
  skills text[] not null default '{}',
  retired_at timestamptz,
  revision_no int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exercises_answer_fkey foreign key (answer_item_id, lesson_id)
    references content.items (id, lesson_id) deferrable initially deferred,
  constraint exercises_lesson_position_key unique (lesson_id, position) deferrable initially deferred,
  check ((position is null) = (retired_at is not null)),
  check (split_part(lesson_id, '-', 1) = split_part(id, '-', 1))
);

create index exercises_lesson_idx on content.exercises (lesson_id);

-- ---------------------------------------------------------------------------
-- Review: decisions, countersignatures, suggestions, comments
-- ---------------------------------------------------------------------------

create table content.review_decisions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  target_type text not null check (target_type in ('item', 'lesson')),
  item_id text references content.items (id),
  lesson_id text references content.lessons (id),
  variety_id text not null references content.varieties (id),
  decision text not null check (decision in ('approve', 'request_changes', 'reject')),
  reviewer_contributor_id text not null,
  grant_id uuid,
  seen_fingerprint char(16) not null,
  target_revision_no int,
  scope text[],
  sole_reviewer boolean not null default false,
  comment text check (char_length(comment) <= 2000),
  redacted_at timestamptz,
  at timestamptz not null default now(),
  check (
    (target_type = 'item' and item_id is not null and lesson_id is null)
    or (target_type = 'lesson' and lesson_id is not null and item_id is null)
  )
);

create index review_decisions_item_idx on content.review_decisions (item_id);
create index review_decisions_lesson_idx on content.review_decisions (lesson_id);

alter table content.items
  add constraint items_current_decision_fkey foreign key (current_decision_id) references content.review_decisions (id);
alter table content.lessons
  add constraint lessons_current_decision_fkey foreign key (current_decision_id) references content.review_decisions (id);

create table content.countersignatures (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null unique references content.review_decisions (id),
  variety_id text not null references content.varieties (id),
  admin_contributor_id text not null,
  grant_id uuid,
  comment text check (char_length(comment) <= 2000),
  at timestamptz not null default now()
);

create table content.suggestions (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references content.items (id),
  variety_id text not null references content.varieties (id),
  suggester_contributor_id text not null,
  base_review_fingerprint char(16) not null,
  proposed jsonb not null check (
    jsonb_typeof(proposed) = 'object'
    and proposed <> '{}'::jsonb
    and (proposed - array['native', 'romanisation', 'meaning', 'context', 'usage_note']) = '{}'::jsonb
  ),
  note text check (char_length(note) <= 2000),
  status text not null default 'open'
    check (status in ('open', 'accepted', 'declined', 'withdrawn', 'superseded')),
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text check (char_length(resolution_note) <= 2000),
  created_at timestamptz not null default now()
);

create index suggestions_item_idx on content.suggestions (item_id, status);

create table content.review_comments (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('item', 'lesson', 'suggestion', 'decision')),
  target_id text not null,
  variety_id text not null references content.varieties (id),
  parent_id uuid references content.review_comments (id),
  author_contributor_id text not null,
  body text not null check (char_length(body) between 1 and 4000),
  redacted_at timestamptz,
  at timestamptz not null default now()
);

create index review_comments_target_idx on content.review_comments (target_type, target_id);

-- ---------------------------------------------------------------------------
-- Revisions, the ID registry, demo rows, keymap, orthography
-- ---------------------------------------------------------------------------

create table content.revisions (
  seq bigint generated always as identity primary key,
  object_type text not null
    check (object_type in ('language', 'variety', 'course', 'unit', 'lesson', 'item', 'exercise')),
  object_id text not null,
  revision_no int not null,
  lesson_id text,
  variety_id text,
  author_contributor_id text,
  reason text not null
    check (reason in ('import', 'create', 'edit', 'suggestion', 'move', 'reorder', 'retire', 'gate')),
  suggestion_id uuid,
  snapshot jsonb not null,
  text_fingerprint char(16),
  review_fingerprint char(16),
  at timestamptz not null default now(),
  unique (object_type, object_id, revision_no)
);

create index revisions_lesson_idx on content.revisions (lesson_id, seq);
create index revisions_object_idx on content.revisions (object_type, object_id, seq);

create table content.id_registry (
  id text primary key check (id ~ '^[a-z]{2,3}-(var|crs|unt|lsn|itm|exr|aud)-[a-z0-9-]+$'),
  type text not null check (type in ('variety', 'course', 'unit', 'lesson', 'item', 'exercise', 'audio')),
  language_code text not null check (language_code ~ '^[a-z]{2,3}$'),
  minted_on date not null default current_date,
  legacy text,
  note text,
  minted_by text,
  retired_at timestamptz,
  check (split_part(id, '-', 1) = language_code)
);

create table content.demo_items (
  item_id text primary key references content.items (id),
  ml_training text not null check (ml_training = 'not_granted')
);

create table content.demo_period (
  language_code text primary key references content.languages (code),
  sunset date not null,
  live boolean not null
);

create table content.keymap_lessons (
  legacy_key text primary key,
  lesson_id text not null references content.lessons (id),
  course_id text not null references content.courses (id),
  position int not null unique
);

create table content.keymap_items (
  legacy_ref text primary key,
  item_id text not null references content.items (id),
  position int not null unique
);

create table content.keymap_courses (
  legacy_id text primary key,
  course_id text not null references content.courses (id),
  position int not null unique
);

-- Flattened: hno holds ur's codepoints plus its own additions.
create table content.orthography_allowlist (
  language_code text not null references content.languages (code),
  cp int not null check (cp between 0 and 1114111),
  primary key (language_code, cp)
);

-- ---------------------------------------------------------------------------
-- Releases
-- ---------------------------------------------------------------------------

create table content.releases (
  seq bigint generated always as identity primary key,
  name text not null unique check (name ~ '^content@\d{4}\.\d{2}\.\d{1,6}$'),
  y int generated always as (split_part(substr(name, 9), '.', 1)::int) stored,
  m int generated always as (split_part(substr(name, 9), '.', 2)::int) stored,
  n int generated always as (split_part(substr(name, 9), '.', 3)::int) stored,
  kind text not null check (kind in ('seed', 'publish', 'rollback')),
  content_hash text not null check (content_hash ~ '^sha256-[0-9a-f]{64}$'),
  payload jsonb not null,
  published_by text,
  published_at timestamptz not null default now(),
  note text,
  stats jsonb,
  unique (y, m, n)
);

create table content.release_lessons (
  release_seq bigint not null references content.releases (seq),
  lesson_id text not null references content.lessons (id),
  lesson_class text not null check (lesson_class in ('demo', 'reviewed')),
  source text not null check (source in ('current', 'carried', 'seed')),
  review_fingerprint char(16),
  decision_id uuid references content.review_decisions (id),
  primary key (release_seq, lesson_id)
);

create table content.release_items (
  release_seq bigint not null references content.releases (seq),
  item_id text not null references content.items (id),
  lesson_id text not null references content.lessons (id),
  is_demo boolean not null,
  review_fingerprint char(16),
  decision_id uuid references content.review_decisions (id),
  primary key (release_seq, item_id)
);

-- ---------------------------------------------------------------------------
-- Small shared helpers
-- ---------------------------------------------------------------------------

create function private.seeding()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('polilingo.seeding', true), '') = 'on'
$$;

-- The item's review fingerprint: the first 16 hex of sha256 over the
-- canonical JSON of {native, romanisation, meaning, context, usage_note,
-- variety, citation}. Absent (null) context and usage_note are left out,
-- exactly as the learner copy leaves them out.
create function private.item_review_fingerprint(
  p_native text,
  p_romanisation text,
  p_meaning text,
  p_context text,
  p_usage_note text,
  p_variety text,
  p_citation text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select left(encode(sha256(convert_to(private.canonical_json(jsonb_strip_nulls(jsonb_build_object(
    'native', p_native,
    'romanisation', p_romanisation,
    'meaning', p_meaning,
    'context', p_context,
    'usage_note', p_usage_note,
    'variety', p_variety,
    'citation', p_citation
  ))), 'UTF8')), 'hex'), 16)
$$;

-- The lesson's review fingerprint (§3.5): {title, subtitle, objective,
-- variety, ordered live item ids, ordered live exercises (id, kind, answer,
-- prompt, options)}.
create function private.lesson_review_fingerprint(
  p_lesson_id text,
  p_title text,
  p_subtitle text,
  p_objective text,
  p_variety text
)
returns text
language sql
stable
set search_path = ''
as $$
  select left(encode(sha256(convert_to(private.canonical_json(jsonb_build_object(
    'title', p_title,
    'subtitle', p_subtitle,
    'objective', p_objective,
    'variety', p_variety,
    'items', coalesce((
      select jsonb_agg(i.id order by i.position)
      from content.items i
      where i.lesson_id = p_lesson_id and i.retired_at is null
    ), '[]'::jsonb),
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'kind', e.kind,
        'answer', e.answer_item_id,
        'prompt', e.prompt,
        'options', to_jsonb(e.options)
      ) order by e.position)
      from content.exercises e
      where e.lesson_id = p_lesson_id and e.retired_at is null
    ), '[]'::jsonb)
  )), 'UTF8')), 'hex'), 16)
$$;

-- ---------------------------------------------------------------------------
-- Text rules (§3.5): the same checks as the content validator's V001-V006
-- ---------------------------------------------------------------------------

-- Returns a JSON array of {code, message, char, position}; position is the
-- 1-based code point index. Empty when the text is clean. The allowlist is
-- checked only when the language has allowlist rows.
create function private.native_problems(p_language text, p_native text, p_romanisation text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_seen int[] := '{}';
  v_has_list boolean := false;
  v_language_name text;
  v_ch text;
  v_cp int;
  v_hex text;
  v_name text;
  v_i int;
begin
  if p_native is not null then
    if p_language is not null then
      v_has_list := exists (
        select 1 from content.orthography_allowlist a where a.language_code = p_language
      );
      select l.name into v_language_name from content.languages l where l.code = p_language;
    end if;

    for v_i in 1 .. char_length(p_native) loop
      v_ch := substr(p_native, v_i, 1);
      v_cp := ascii(v_ch);
      if v_cp = any (v_seen) then
        continue;
      end if;
      v_hex := upper(lpad(to_hex(v_cp), 4, '0'));
      v_name := case v_cp
        when 8206 then 'left-to-right mark'
        when 8207 then 'right-to-left mark'
        when 8234 then 'left-to-right embedding'
        when 8235 then 'right-to-left embedding'
        when 8236 then 'pop directional formatting'
        when 8237 then 'left-to-right override'
        when 8238 then 'right-to-left override'
        when 8203 then 'zero-width space'
        when 160 then 'no-break space'
        when 65279 then 'zero-width no-break space'
      end;

      if v_name is not null then
        v_seen := v_seen || v_cp;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'code', 'PL422_INVISIBLE_CHAR',
          'message', format(
            'There''s an invisible %s (U+%s) at position %s. Delete it or retype the text: it changes how the line looks without showing in review.',
            v_name, v_hex, v_i),
          'char', v_ch,
          'position', v_i
        ));
      elsif v_cp in (8216, 8217, 8220, 8221) then
        v_seen := v_seen || v_cp;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'code', 'PL422_SMART_QUOTE',
          'message', format('There''s a curly quote (%s) at position %s. Use a straight quote, or none.', v_ch, v_i),
          'char', v_ch,
          'position', v_i
        ));
      elsif v_cp between 1632 and 1641 or v_cp between 1776 and 1785 then
        v_seen := v_seen || v_cp;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'code', 'PL422_ARABIC_DIGIT',
          'message', format('There''s an Arabic-Indic digit (%s) at position %s. Use 0-9, or spell the number out.', v_ch, v_i),
          'char', v_ch,
          'position', v_i
        ));
      elsif v_has_list and not exists (
        select 1 from content.orthography_allowlist a
        where a.language_code = p_language and a.cp = v_cp
      ) then
        v_seen := v_seen || v_cp;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'code', 'PL422_CHAR_NOT_ALLOWED',
          'message', format(
            '"%s" (U+%s) at position %s isn''t in the %s character list. If it belongs there, ask an admin to add it.',
            v_ch, v_hex, v_i, coalesce(v_language_name, p_language)),
          'char', v_ch,
          'position', v_i
        ));
      end if;
    end loop;
  end if;

  if p_romanisation is not null then
    for v_i in 1 .. char_length(p_romanisation) loop
      v_ch := substr(p_romanisation, v_i, 1);
      v_cp := ascii(v_ch);
      if v_cp between 1536 and 1791 or v_cp between 1872 and 1919 then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'code', 'PL422_ROMANISATION_SCRIPT',
          'message', format(
            'The romanisation has a native-script letter (%s) at position %s. It should be Latin letters only, like "Salaam".',
            v_ch, v_i),
          'char', v_ch,
          'position', v_i
        ));
        exit;
      end if;
    end loop;
    if p_romanisation !~ '[A-Za-z]' then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'code', 'PL422_ROMANISATION_NO_LATIN',
        'message', 'The romanisation has no Latin letters. It should look like "Salaam" or "Kya haal hai?".',
        'char', null,
        'position', null
      ));
    end if;
  end if;

  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers: revision numbers and the revisions writer
-- ---------------------------------------------------------------------------

-- Before update on languages, varieties, courses, units and exercises:
-- revision_no is owned by the database. It goes up by one when anything
-- else in the row changes, and never otherwise.
create function private.bump_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'revision_no' - 'updated_at') <> (to_jsonb(old) - 'revision_no' - 'updated_at') then
    new.revision_no := old.revision_no + 1;
    if to_jsonb(new) ? 'updated_at' then
      new := jsonb_populate_record(new, jsonb_build_object('updated_at', now()));
    end if;
  else
    new.revision_no := old.revision_no;
  end if;
  return new;
end $$;

-- After insert or update: one revisions row per revision_no. Argument: the object type.
create function private.write_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text := tg_argv[0];
  v_row jsonb := to_jsonb(new);
  v_lesson text;
  v_variety text;
  v_reason text;
begin
  if tg_op = 'UPDATE' and new.revision_no = old.revision_no then
    return null;
  end if;

  case v_type
    when 'language' then
      v_lesson := null;
      v_variety := null;
    when 'variety' then
      v_variety := v_row ->> 'id';
    when 'course' then
      v_variety := v_row ->> 'variety_id';
    when 'unit' then
      v_variety := null;
    when 'lesson' then
      v_lesson := v_row ->> 'id';
      v_variety := v_row ->> 'variety_id';
    when 'item' then
      v_lesson := v_row ->> 'lesson_id';
      v_variety := v_row ->> 'variety_id';
    when 'exercise' then
      v_lesson := v_row ->> 'lesson_id';
      select l.variety_id into v_variety from content.lessons l where l.id = v_lesson;
  end case;

  v_reason := case
    when private.seeding() then 'import'
    else coalesce(
      nullif(current_setting('polilingo.revision_reason', true), ''),
      case tg_op when 'INSERT' then 'create' else 'edit' end
    )
  end;

  insert into content.revisions (
    object_type, object_id, revision_no, lesson_id, variety_id, author_contributor_id,
    reason, suggestion_id, snapshot, text_fingerprint, review_fingerprint
  ) values (
    v_type,
    coalesce(v_row ->> 'id', v_row ->> 'code'),
    (v_row ->> 'revision_no')::int,
    v_lesson,
    v_variety,
    private.change_author(),
    v_reason,
    nullif(current_setting('polilingo.suggestion_id', true), '')::uuid,
    v_row,
    v_row ->> 'text_fingerprint',
    v_row ->> 'review_fingerprint'
  );
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers: items (derive, check, void, freeze demo)
-- ---------------------------------------------------------------------------

create function private.item_derive()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_problems jsonb;
  v_bookkeeping text[] := array[
    'review_status', 'current_decision_id', 'last_approved_seq', 'text_author',
    'revision_no', 'updated_at', 'text_fingerprint', 'review_fingerprint'
  ];
begin
  if tg_op = 'UPDATE' and not private.seeding()
     and exists (select 1 from content.demo_items d where d.item_id = old.id) then
    perform private.raise(
      'PL409_DEMO_FROZEN',
      'Demo phrases can''t be changed. Write a new phrase instead.',
      jsonb_build_object('item_id', old.id)
    );
  end if;

  new.native := private.normalise_native(new.native);

  if tg_op = 'INSERT'
     or new.native is distinct from old.native
     or new.romanisation is distinct from old.romanisation then
    v_problems := private.native_problems(split_part(new.id, '-', 1), new.native, new.romanisation);
    if jsonb_array_length(v_problems) > 0 then
      perform private.raise(
        v_problems -> 0 ->> 'code',
        v_problems -> 0 ->> 'message',
        jsonb_build_object('item_id', new.id, 'problems', v_problems)
      );
    end if;
  end if;

  new.text_fingerprint := private.text_fingerprint(new.native);
  new.review_fingerprint := private.item_review_fingerprint(
    new.native, new.romanisation, new.meaning, new.context, new.usage_note, new.variety_id, new.source_citation
  );

  if tg_op = 'INSERT' then
    if not private.seeding() then
      new.review_status := 'unreviewed';
      new.current_decision_id := null;
      new.last_approved_seq := null;
      new.revision_no := 1;
    end if;
    new.text_author := coalesce(new.text_author, private.change_author());
    return new;
  end if;

  if new.review_fingerprint is distinct from old.review_fingerprint then
    -- Learner-visible text changed: approval is void (§3.5).
    new.review_status := 'unreviewed';
    new.current_decision_id := null;
    new.text_author := private.change_author();
    new.revision_no := old.revision_no + 1;
    new.updated_at := now();
  elsif (to_jsonb(new) - v_bookkeeping) <> (to_jsonb(old) - v_bookkeeping) then
    new.revision_no := old.revision_no + 1;
    new.updated_at := now();
  else
    new.revision_no := old.revision_no;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers: lessons (fingerprint and void)
-- ---------------------------------------------------------------------------

create function private.lesson_derive()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bookkeeping text[] := array[
    'review_status', 'current_decision_id', 'last_approved_seq', 'text_author',
    'revision_no', 'updated_at', 'review_fingerprint', 'submitted_at'
  ];
begin
  new.review_fingerprint := private.lesson_review_fingerprint(
    new.id, new.title, new.subtitle, new.objective, new.variety_id
  );

  if tg_op = 'INSERT' then
    if not private.seeding() then
      new.review_status := 'unreviewed';
      new.current_decision_id := null;
      new.last_approved_seq := null;
      new.revision_no := 1;
    end if;
    new.text_author := coalesce(new.text_author, private.change_author());
    return new;
  end if;

  if new.review_fingerprint is distinct from old.review_fingerprint and not private.seeding() then
    -- The lesson's learner-visible shape changed: approval is void (§3.5).
    new.review_status := 'unreviewed';
    new.current_decision_id := null;
    new.text_author := private.change_author();
    new.revision_no := old.revision_no + 1;
    new.updated_at := now();
  elsif (to_jsonb(new) - v_bookkeeping) <> (to_jsonb(old) - v_bookkeeping) then
    new.revision_no := old.revision_no + 1;
    new.updated_at := now();
  else
    new.revision_no := old.revision_no;
  end if;
  return new;
end $$;

-- After a change to items or exercises: recompute the fingerprint of every
-- lesson the change touches, by re-saving the lesson row (lesson_derive does
-- the work). Argument: 'item' or 'exercise'.
create function private.touch_lesson()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lessons text[];
begin
  if tg_op = 'INSERT' then
    v_lessons := array[new.lesson_id];
  elsif tg_op = 'DELETE' then
    v_lessons := array[old.lesson_id];
  elsif tg_argv[0] = 'item' then
    if new.lesson_id is not distinct from old.lesson_id
       and new.position is not distinct from old.position
       and new.retired_at is not distinct from old.retired_at then
      return null;
    end if;
    v_lessons := array[old.lesson_id, new.lesson_id];
  else
    if (to_jsonb(new) - 'revision_no' - 'updated_at' - 'difficulty' - 'skills')
       = (to_jsonb(old) - 'revision_no' - 'updated_at' - 'difficulty' - 'skills') then
      return null;
    end if;
    v_lessons := array[old.lesson_id, new.lesson_id];
  end if;

  update content.lessons l
  set review_fingerprint = l.review_fingerprint
  where l.id = any (v_lessons)
    and l.review_fingerprint is distinct from private.lesson_review_fingerprint(
      l.id, l.title, l.subtitle, l.objective, l.variety_id
    );
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers: exercises (option rules)
-- ---------------------------------------------------------------------------

-- assemble ⇔ no options; otherwise 1..11 distinct live items of the same
-- lesson, never the answer and never sharing its native text or meaning.
create function private.exercise_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_answer content.items%rowtype;
  v_bad text;
begin
  if new.retired_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.kind = old.kind
     and new.answer_item_id = old.answer_item_id
     and new.options = old.options
     and new.lesson_id = old.lesson_id
     and old.retired_at is null then
    return new;
  end if;

  select * into v_answer from content.items i where i.id = new.answer_item_id and i.lesson_id = new.lesson_id;
  if not found or v_answer.retired_at is not null then
    perform private.raise(
      'PL422_BAD_OPTION',
      'The answer must be a live phrase of this lesson.',
      jsonb_build_object('exercise_id', new.id, 'item_id', new.answer_item_id)
    );
  end if;

  if new.kind = 'assemble' then
    if cardinality(new.options) > 0 then
      perform private.raise(
        'PL422_BAD_OPTION',
        'An assemble exercise has no choices: the learner builds the answer.',
        jsonb_build_object('exercise_id', new.id)
      );
    end if;
    return new;
  end if;

  if cardinality(new.options) not between 1 and 11 then
    perform private.raise(
      'PL422_BAD_OPTION',
      'This exercise needs between 1 and 11 wrong choices.',
      jsonb_build_object('exercise_id', new.id, 'count', cardinality(new.options))
    );
  end if;
  if (select count(distinct o) from unnest(new.options) o) <> cardinality(new.options) then
    perform private.raise(
      'PL422_BAD_OPTION',
      'The same choice is listed twice.',
      jsonb_build_object('exercise_id', new.id)
    );
  end if;
  if new.answer_item_id = any (new.options) then
    perform private.raise(
      'PL422_OPTION_EQUALS_ANSWER',
      'The answer is also listed as a wrong choice.',
      jsonb_build_object('exercise_id', new.id, 'item_id', new.answer_item_id)
    );
  end if;

  select o into v_bad
  from unnest(new.options) o
  where not exists (
    select 1 from content.items i
    where i.id = o and i.lesson_id = new.lesson_id and i.retired_at is null
  )
  limit 1;
  if v_bad is not null then
    perform private.raise(
      'PL422_BAD_OPTION',
      format('%s is not a live phrase of this lesson. Choices come from the lesson''s own phrases.', v_bad),
      jsonb_build_object('exercise_id', new.id, 'item_id', v_bad)
    );
  end if;

  select i.id into v_bad
  from content.items i
  where i.id = any (new.options)
    and (
      i.native = v_answer.native
      or lower(private.normalise_native(i.meaning)) = lower(private.normalise_native(v_answer.meaning))
    )
  limit 1;
  if v_bad is not null then
    perform private.raise(
      'PL422_OPTION_EQUALS_ANSWER',
      format('%s has the same text or meaning as the answer, so a learner choosing it would be marked wrong for a right answer.', v_bad),
      jsonb_build_object('exercise_id', new.id, 'item_id', v_bad)
    );
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers: guards
-- ---------------------------------------------------------------------------

-- Suggestions change only while open, and only their status and resolution.
create function private.suggestion_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.raise('PL409_APPEND_ONLY', 'Suggestions are kept: close one instead of deleting it.');
  end if;
  if old.status <> 'open' then
    perform private.raise(
      'PL409_SUGGESTION_CLOSED',
      'This suggestion is already closed.',
      jsonb_build_object('suggestion_id', old.id, 'status', old.status)
    );
  end if;
  if (to_jsonb(new) - array['status', 'resolved_by', 'resolved_at', 'resolution_note'])
     <> (to_jsonb(old) - array['status', 'resolved_by', 'resolved_at', 'resolution_note']) then
    perform private.raise('PL409_APPEND_ONLY', 'Only a suggestion''s status and resolution can change.');
  end if;
  return new;
end $$;

-- Demo rows are written only by the seed.
create function private.demo_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.seeding() then
    perform private.raise('PL409_DEMO_FROZEN', 'The demo list is fixed. Only the seed adds to it.');
  end if;
  return new;
end $$;

-- demo_period: the sunset may move; the language and the live flag never change.
create function private.demo_period_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.raise('PL409_APPEND_ONLY', 'A demo period is never removed.');
  end if;
  if new.language_code <> old.language_code or new.live <> old.live then
    perform private.raise(
      'PL409_DEMO_FROZEN',
      'Whether a language''s demo is live is fixed. Only its sunset date can change.',
      jsonb_build_object('language', old.language_code)
    );
  end if;
  return new;
end $$;

-- id_registry: never deleted; retired_at is set once and never cleared.
create function private.id_registry_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.raise('PL409_APPEND_ONLY', 'Registered ids are never removed.');
  end if;
  if old.retired_at is not null
     or new.retired_at is null
     or (to_jsonb(new) - 'retired_at') <> (to_jsonb(old) - 'retired_at') then
    perform private.raise('PL409_APPEND_ONLY', 'A registered id can only be retired, once.');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Trigger wiring
-- ---------------------------------------------------------------------------

create trigger languages_bump before update on content.languages
  for each row execute function private.bump_revision();
create trigger languages_revision after insert or update on content.languages
  for each row execute function private.write_revision('language');

create trigger varieties_bump before update on content.varieties
  for each row execute function private.bump_revision();
create trigger varieties_revision after insert or update on content.varieties
  for each row execute function private.write_revision('variety');

create trigger courses_bump before update on content.courses
  for each row execute function private.bump_revision();
create trigger courses_revision after insert or update on content.courses
  for each row execute function private.write_revision('course');

create trigger units_bump before update on content.units
  for each row execute function private.bump_revision();
create trigger units_revision after insert or update on content.units
  for each row execute function private.write_revision('unit');

create trigger lessons_derive before insert or update on content.lessons
  for each row execute function private.lesson_derive();
create trigger lessons_revision after insert or update on content.lessons
  for each row execute function private.write_revision('lesson');

create trigger items_derive before insert or update on content.items
  for each row execute function private.item_derive();
create trigger items_revision after insert or update on content.items
  for each row execute function private.write_revision('item');
create trigger items_touch_lesson after insert or update or delete on content.items
  for each row execute function private.touch_lesson('item');

create trigger exercises_check before insert or update on content.exercises
  for each row execute function private.exercise_check();
create trigger exercises_bump before update on content.exercises
  for each row execute function private.bump_revision();
create trigger exercises_revision after insert or update on content.exercises
  for each row execute function private.write_revision('exercise');
create trigger exercises_touch_lesson after insert or update or delete on content.exercises
  for each row execute function private.touch_lesson('exercise');

create trigger suggestions_guard before update or delete on content.suggestions
  for each row execute function private.suggestion_guard();
create trigger suggestions_no_truncate before truncate on content.suggestions
  for each statement execute function private.forbid_change();

create trigger demo_items_insert before insert on content.demo_items
  for each row execute function private.demo_items_guard();
create trigger demo_items_append_only before update or delete on content.demo_items
  for each row execute function private.forbid_change();
create trigger demo_items_no_truncate before truncate on content.demo_items
  for each statement execute function private.forbid_change();

create trigger demo_period_guard before update or delete on content.demo_period
  for each row execute function private.demo_period_guard();
create trigger demo_period_no_truncate before truncate on content.demo_period
  for each statement execute function private.forbid_change();

create trigger id_registry_guard before update or delete on content.id_registry
  for each row execute function private.id_registry_guard();
create trigger id_registry_no_truncate before truncate on content.id_registry
  for each statement execute function private.forbid_change();

-- Append-only tables (AO in §3.4).
create trigger revisions_append_only before update or delete on content.revisions
  for each row execute function private.forbid_change();
create trigger revisions_no_truncate before truncate on content.revisions
  for each statement execute function private.forbid_change();

create trigger releases_append_only before update or delete on content.releases
  for each row execute function private.forbid_change();
create trigger releases_no_truncate before truncate on content.releases
  for each statement execute function private.forbid_change();

create trigger release_lessons_append_only before update or delete on content.release_lessons
  for each row execute function private.forbid_change();
create trigger release_lessons_no_truncate before truncate on content.release_lessons
  for each statement execute function private.forbid_change();

create trigger release_items_append_only before update or delete on content.release_items
  for each row execute function private.forbid_change();
create trigger release_items_no_truncate before truncate on content.release_items
  for each statement execute function private.forbid_change();

-- A decision's comment can be redacted (redact_comment); nothing else changes.
create trigger review_decisions_append_only before update or delete on content.review_decisions
  for each row execute function private.forbid_change('redactable');
create trigger review_decisions_no_truncate before truncate on content.review_decisions
  for each statement execute function private.forbid_change();

create trigger countersignatures_append_only before update or delete on content.countersignatures
  for each row execute function private.forbid_change();
create trigger countersignatures_no_truncate before truncate on content.countersignatures
  for each statement execute function private.forbid_change();

create trigger review_comments_append_only before update or delete on content.review_comments
  for each row execute function private.forbid_change('redactable');
create trigger review_comments_no_truncate before truncate on content.review_comments
  for each statement execute function private.forbid_change();

create trigger keymap_lessons_append_only before update or delete on content.keymap_lessons
  for each row execute function private.forbid_change();
create trigger keymap_lessons_no_truncate before truncate on content.keymap_lessons
  for each statement execute function private.forbid_change();
create trigger keymap_items_append_only before update or delete on content.keymap_items
  for each row execute function private.forbid_change();
create trigger keymap_items_no_truncate before truncate on content.keymap_items
  for each statement execute function private.forbid_change();
create trigger keymap_courses_append_only before update or delete on content.keymap_courses
  for each row execute function private.forbid_change();
create trigger keymap_courses_no_truncate before truncate on content.keymap_courses
  for each statement execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Gates, problems and the learner JSON of one lesson
-- ---------------------------------------------------------------------------

-- 'open' or 'blocked' through language, course, course variety, unit,
-- lesson, lesson variety and every live item's variety, as build.mjs
-- assemble() resolves it. Null when the lesson does not exist (or the
-- caller cannot read it). Retirement is not a gate: check retired_at
-- separately.
create function private.effective_gate(p_lesson_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when not exists (select 1 from content.lessons l where l.id = p_lesson_id) then null
    when exists (
      select 1
      from content.lessons l
      join content.units u on u.id = l.unit_id
      join content.courses c on c.id = l.course_id
      join content.languages lang on lang.code = c.language_code
      join content.varieties cv on cv.id = c.variety_id
      join content.varieties lv on lv.id = l.variety_id
      where l.id = p_lesson_id
        and 'blocked' in (lang.publish_gate, c.publish_gate, cv.publish_gate, u.publish_gate, l.publish_gate, lv.publish_gate)
    ) then 'blocked'
    when exists (
      select 1
      from content.items i
      join content.varieties iv on iv.id = i.variety_id
      where i.lesson_id = p_lesson_id and i.retired_at is null and iv.publish_gate = 'blocked'
    ) then 'blocked'
    else 'open'
  end
$$;

-- One lesson exactly as learnerLesson() in the content repo's
-- scripts/build.mjs emits it: {id, order, title, subtitle, objective,
-- variety, items, exercises}; items {id, native, romanisation, meaning,
-- context?, usage_note?, variety, citation} by position; exercises {id,
-- kind, item, prompt, options} by position. Live items and exercises only.
-- Null when the lesson does not exist.
create function private.lesson_json(p_lesson_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id,
    'order', l.position,
    'title', l.title,
    'subtitle', coalesce(l.subtitle, ''),
    'objective', l.objective,
    'variety', l.variety_id,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'native', i.native,
          'romanisation', i.romanisation,
          'meaning', i.meaning,
          'variety', i.variety_id,
          'citation', i.source_citation
        )
        || case when i.context is null then '{}'::jsonb else jsonb_build_object('context', i.context) end
        || case when i.usage_note is null then '{}'::jsonb else jsonb_build_object('usage_note', i.usage_note) end
        order by i.position
      )
      from content.items i
      where i.lesson_id = l.id and i.retired_at is null
    ), '[]'::jsonb),
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'kind', e.kind,
        'item', e.answer_item_id,
        'prompt', e.prompt,
        'options', to_jsonb(e.options)
      ) order by e.position)
      from content.exercises e
      where e.lesson_id = l.id and e.retired_at is null
    ), '[]'::jsonb)
  )
  from content.lessons l
  where l.id = p_lesson_id
$$;

-- The problems that keep a lesson from publishing ('blocking') or that an
-- editor should know about ('warning'), as a JSON array of {severity, code,
-- message} plus target_type/target_id where one part is at fault. Codes are
-- from the error catalogue. Null when the lesson does not exist.
create function private.lesson_problems(p_lesson_id text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lesson content.lessons%rowtype;
  v_out jsonb := '[]'::jsonb;
  v_language text;
  v_items int;
  v_demo int;
  v_exercises int;
  r record;
  p jsonb;
begin
  select * into v_lesson from content.lessons l where l.id = p_lesson_id;
  if not found then
    return null;
  end if;
  v_language := split_part(v_lesson.id, '-', 1);

  if v_lesson.retired_at is not null then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'severity', 'blocking', 'code', 'PL409_RETIRED',
      'message', 'This lesson is retired.',
      'target_type', 'lesson', 'target_id', v_lesson.id));
  end if;

  select count(*), count(d.item_id) into v_items, v_demo
  from content.items i
  left join content.demo_items d on d.item_id = i.id
  where i.lesson_id = v_lesson.id and i.retired_at is null;

  if v_items = 0 then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'severity', 'blocking', 'code', 'PL422_BAD_INPUT',
      'message', 'This lesson has no phrases yet. Add at least one.',
      'target_type', 'lesson', 'target_id', v_lesson.id));
  elsif v_items > 12 then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'severity', 'blocking', 'code', 'PL422_LESSON_FULL',
      'message', format('This lesson has %s phrases. A lesson holds at most 12.', v_items),
      'target_type', 'lesson', 'target_id', v_lesson.id));
  end if;

  if v_demo > 0 and v_demo < v_items then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'severity', 'blocking', 'code', 'PL409_NOT_PUBLISHABLE',
      'message', 'This lesson mixes demo phrases with new ones, so it can never publish. Put the new phrases in a lesson of their own.',
      'target_type', 'lesson', 'target_id', v_lesson.id));
  end if;

  for r in
    select i.id, i.position, i.native, i.romanisation
    from content.items i
    where i.lesson_id = v_lesson.id and i.retired_at is null
    order by i.position
  loop
    for p in select value from jsonb_array_elements(private.native_problems(v_language, r.native, r.romanisation)) loop
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'severity', 'blocking', 'code', p ->> 'code',
        'message', format('Phrase %s: %s', r.position, p ->> 'message'),
        'target_type', 'item', 'target_id', r.id));
    end loop;
  end loop;

  select count(*) into v_exercises
  from content.exercises e
  where e.lesson_id = v_lesson.id and e.retired_at is null;

  if v_exercises = 0 then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'severity', 'blocking', 'code', 'PL422_TOO_FEW_EXERCISES',
      'message', 'This lesson needs at least one exercise.',
      'target_type', 'lesson', 'target_id', v_lesson.id));
  elsif v_exercises < 6 and v_demo = 0 then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'severity', 'warning', 'code', 'PL422_TOO_FEW_EXERCISES',
      'message', format('A reviewed lesson needs at least 6 exercises. This one has %s.', v_exercises),
      'target_type', 'lesson', 'target_id', v_lesson.id));
  end if;

  for r in
    select e.id, e.position, e.kind, e.options, e.answer_item_id,
           a.native as answer_native, a.meaning as answer_meaning,
           (a.id is not null and a.retired_at is null and a.lesson_id = e.lesson_id) as answer_live
    from content.exercises e
    left join content.items a on a.id = e.answer_item_id
    where e.lesson_id = v_lesson.id and e.retired_at is null
    order by e.position
  loop
    if not r.answer_live then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'severity', 'blocking', 'code', 'PL422_BAD_OPTION',
        'message', format('Exercise %s: its answer is not a live phrase of this lesson.', r.position),
        'target_type', 'exercise', 'target_id', r.id));
    end if;
    if (r.kind = 'assemble') <> (cardinality(r.options) = 0) then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'severity', 'blocking', 'code', 'PL422_BAD_OPTION',
        'message', case when r.kind = 'assemble'
          then format('Exercise %s: an assemble exercise has no choices.', r.position)
          else format('Exercise %s: it needs at least one wrong choice.', r.position) end,
        'target_type', 'exercise', 'target_id', r.id));
    end if;
    if exists (
      select 1 from unnest(r.options) o
      where not exists (
        select 1 from content.items i
        where i.id = o and i.lesson_id = v_lesson.id and i.retired_at is null
      )
    ) then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'severity', 'blocking', 'code', 'PL422_BAD_OPTION',
        'message', format('Exercise %s: a choice is not a live phrase of this lesson.', r.position),
        'target_type', 'exercise', 'target_id', r.id));
    end if;
    if r.answer_item_id = any (r.options) or exists (
      select 1 from content.items i
      where i.id = any (r.options)
        and i.id <> r.answer_item_id
        and (
          i.native = r.answer_native
          or lower(private.normalise_native(i.meaning)) = lower(private.normalise_native(r.answer_meaning))
        )
    ) then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'severity', 'blocking', 'code', 'PL422_OPTION_EQUALS_ANSWER',
        'message', format('Exercise %s: a wrong choice has the same text or meaning as the answer.', r.position),
        'target_type', 'exercise', 'target_id', r.id));
    end if;
  end loop;

  if private.effective_gate(v_lesson.id) = 'blocked' then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'severity', 'warning', 'code', 'PL409_NOT_PUBLISHABLE',
      'message', 'A publish gate above this lesson is closed, so learners won''t see it yet.',
      'target_type', 'lesson', 'target_id', v_lesson.id));
  end if;

  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Views (security_invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------------

-- What waits for a reviewer: live non-demo items that are unreviewed, and
-- submitted lessons that are unreviewed. in_review = its lesson is submitted.
create view content.review_queue with (security_invoker = true) as
select
  'item'::text as target_type,
  i.id as target_id,
  i.lesson_id,
  i.variety_id,
  i.review_status,
  i.review_fingerprint,
  l.submitted_at,
  (l.submitted_at is not null) as in_review,
  i.updated_at as changed_at
from content.items i
join content.lessons l on l.id = i.lesson_id
where i.retired_at is null
  and i.review_status = 'unreviewed'
  and not exists (select 1 from content.demo_items d where d.item_id = i.id)
union all
select
  'lesson'::text,
  l.id,
  l.id,
  l.variety_id,
  l.review_status,
  l.review_fingerprint,
  l.submitted_at,
  true,
  l.updated_at
from content.lessons l
where l.retired_at is null
  and l.submitted_at is not null
  and l.review_status = 'unreviewed';

-- Sole-reviewer approvals that are still current and not yet countersigned.
create view content.awaiting_countersign with (security_invoker = true) as
select
  d.id as decision_id,
  d.target_type,
  coalesce(d.item_id, d.lesson_id) as target_id,
  d.variety_id,
  d.reviewer_contributor_id,
  d.seen_fingerprint,
  d.at
from content.review_decisions d
where d.sole_reviewer
  and d.decision = 'approve'
  and not exists (select 1 from content.countersignatures c where c.decision_id = d.id)
  and (
    exists (select 1 from content.items i where i.current_decision_id = d.id)
    or exists (select 1 from content.lessons l where l.current_decision_id = d.id)
  );

-- Once-approved targets that need another look: changed since approval, or
-- approved under a fingerprint that is no longer current.
create view content.needs_recheck with (security_invoker = true) as
select
  'item'::text as target_type,
  i.id as target_id,
  i.lesson_id,
  i.variety_id,
  i.review_status,
  i.review_fingerprint,
  d.seen_fingerprint,
  i.last_approved_seq
from content.items i
left join content.review_decisions d on d.id = i.current_decision_id
where i.retired_at is null
  and (
    (i.review_status = 'unreviewed' and i.last_approved_seq is not null)
    or (i.review_status = 'approved' and (d.id is null or d.seen_fingerprint <> i.review_fingerprint))
  )
union all
select
  'lesson'::text,
  l.id,
  l.id,
  l.variety_id,
  l.review_status,
  l.review_fingerprint,
  d.seen_fingerprint,
  l.last_approved_seq
from content.lessons l
left join content.review_decisions d on d.id = l.current_decision_id
where l.retired_at is null
  and (
    (l.review_status = 'unreviewed' and l.last_approved_seq is not null)
    or (l.review_status = 'approved' and (d.id is null or d.seen_fingerprint <> l.review_fingerprint))
  );

-- Approved live items whose current text is not in the latest release.
create view content.pending_publish with (security_invoker = true) as
select
  i.id as item_id,
  i.lesson_id,
  i.variety_id,
  i.review_fingerprint,
  i.current_decision_id
from content.items i
where i.retired_at is null
  and i.review_status = 'approved'
  and not exists (
    select 1
    from content.release_items ri
    where ri.release_seq = (select max(r.seq) from content.releases r)
      and ri.item_id = i.id
      and ri.review_fingerprint = i.review_fingerprint
  );

-- One timeline per item: its revisions, decisions and suggestions.
create view content.item_history with (security_invoker = true) as
select
  r.object_id as item_id,
  'revision'::text as kind,
  r.at,
  r.author_contributor_id as contributor_id,
  r.reason as detail,
  r.revision_no,
  r.review_fingerprint,
  r.seq as ref_seq,
  null::uuid as ref_id
from content.revisions r
where r.object_type = 'item'
union all
select
  d.item_id,
  'decision',
  d.at,
  d.reviewer_contributor_id,
  d.decision,
  d.target_revision_no,
  d.seen_fingerprint,
  d.seq,
  d.id
from content.review_decisions d
where d.target_type = 'item'
union all
select
  s.item_id,
  'suggestion',
  s.created_at,
  s.suggester_contributor_id,
  s.status,
  null::int,
  s.base_review_fingerprint,
  null::bigint,
  s.id
from content.suggestions s;
