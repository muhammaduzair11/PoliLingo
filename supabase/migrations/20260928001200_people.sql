-- 20260928001200_people.sql
-- Owner: Track C, people and overview (docs/platform.md §1, §3.9 C).
--
-- Invitations (create, revoke, peek, accept), ending a role, editing a
-- contributor, and the two admin pages: people and the overview.
--
-- Conventions (§3.2): writes are SECURITY DEFINER with search_path '' and
-- every object schema-qualified; checks run 401 → profile/age → role → 422
-- input → 404 → scope 403 → 409 state; refusals go through private.raise
-- with codes from supabase/error-codes.json; every change is audited.
--
-- Invitation tokens: 32 random bytes, base64url without padding (43
-- characters). Only sha256(token) is stored; the token itself is returned
-- once, by create_invitation, and never again.

-- ---------------------------------------------------------------------------
-- Private helpers (no grants: only the definer functions below call them)
-- ---------------------------------------------------------------------------

-- "amina.k@gmail.com" → "a•••@gmail.com". Enough for a person to recognise
-- their own address, not enough to learn someone else's.
create function private.mask_email(p_email text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when position('@' in p_email) = 0 then '•••'
    else left(split_part(p_email, '@', 1), 1) || '•••@' || split_part(p_email, '@', 2)
  end
$$;

-- The stored form of an invitation token.
create function private.invitation_token_hash(p_token text)
returns bytea
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
$$;

-- A lower-cased, trimmed email, or null when it does not look like one.
create function private.clean_email(p_email text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_email is null then null
    when char_length(pg_catalog.btrim(p_email)) > 254 then null
    when pg_catalog.lower(pg_catalog.btrim(p_email)) ~ '^[^@\s]+@[^@\s]+\.[^@\s.]+$'
      then pg_catalog.lower(pg_catalog.btrim(p_email))
    else null
  end
$$;

-- Whether contributor p_contributor is an admin right now: an admin grant
-- already started and not ended, held by an active, 18+ contributor with an
-- account. An invitation is only as good as its sender: once they stop being
-- an admin, their open invitations can't be accepted.
create function private.contributor_is_admin(p_contributor text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_grants g
    join public.contributors c on c.id = g.contributor_id
    join public.profiles p on p.user_id = c.user_id
    where c.id = p_contributor
      and g.role = 'admin'
      and c.status = 'active'
      and p.age_band = '18+'
      and g.starts_at <= now()
      and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
  )
$$;

-- Whether an admin other than grant p_except_grant (and other than
-- contributor p_except_contributor) stays one after the change: an admin
-- grant already started and with no end date, held by an active, 18+
-- contributor with an account. Used before ending or pausing an admin. An
-- admin whose role is due to end doesn't count, so staggered end dates can't
-- leave the workspace with nobody in charge.
create function private.other_lasting_admin(p_except_grant uuid, p_except_contributor text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_grants g
    join public.contributors c on c.id = g.contributor_id
    join public.profiles p on p.user_id = c.user_id
    where g.role = 'admin'
      and g.id is distinct from p_except_grant
      and c.id is distinct from p_except_contributor
      and c.status = 'active'
      and p.age_band = '18+'
      and g.starts_at <= now()
      and g.ends_at is null
  )
$$;

-- Ends every grant of p_contributor that hasn't ended yet, now (one not yet
-- started ends as it starts), and records each. Used when a contributor
-- leaves, and when someone who left or was paused accepts a new invitation,
-- so that only the role they were just invited to is live.
create function private.end_open_grants(p_contributor text, p_revoked_by text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.role_grants%rowtype;
begin
  for v_grant in
    update public.role_grants g
    set ends_at = greatest(now(), g.starts_at + interval '1 second'),
        revoked_by = p_revoked_by,
        revoke_reason = p_reason
    where g.contributor_id = p_contributor
      and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
    returning g.*
  loop
    perform private.audit('role.revoked', 'role_grant', v_grant.id::text, jsonb_build_object(
      'contributor_id', v_grant.contributor_id,
      'role', v_grant.role,
      'language', v_grant.language_code,
      'variety', v_grant.variety_id,
      'ends_at', v_grant.ends_at,
      'reason', p_reason
    ));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- create_invitation (admin)
-- ---------------------------------------------------------------------------

create function public.create_invitation(
  p_role text,
  p_email text,
  p_language text default null,
  p_variety text default null,
  p_display_name text default null,
  p_expires_in_days int default 7,
  p_grant_ends_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin text;
  v_email text;
  v_language text := nullif(pg_catalog.btrim(p_language), '');
  v_variety text := nullif(pg_catalog.btrim(p_variety), '');
  v_variety_language text;
  v_name text := nullif(pg_catalog.btrim(p_display_name), '');
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not private.is_admin() then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can invite people.');
  end if;
  v_admin := private.current_contributor_id();

  -- Scope: admin has none; an editor may have a language (none = all
  -- languages); a reviewer has a variety, and its language.
  if p_role is null or p_role not in ('admin', 'editor', 'language_reviewer') then
    perform private.raise('PL422_BAD_SCOPE', 'Choose a role: admin, editor or reviewer.');
  end if;
  if p_role = 'admin' and (v_language is not null or v_variety is not null) then
    perform private.raise('PL422_BAD_SCOPE', 'An admin covers every language, so leave the language and variety empty.');
  end if;
  if p_role = 'editor' and v_variety is not null then
    perform private.raise('PL422_BAD_SCOPE', 'An editor works on a whole language. Leave the variety empty.');
  end if;
  if p_role = 'language_reviewer' and v_variety is null then
    perform private.raise('PL422_BAD_SCOPE', 'A reviewer needs a variety to review.');
  end if;
  if v_variety is not null then
    select v.language_code into v_variety_language from content.varieties v where v.id = v_variety;
    if v_variety_language is null then
      perform private.raise('PL422_BAD_SCOPE', 'That variety doesn''t exist.', jsonb_build_object('variety', v_variety));
    end if;
    if v_language is not null and v_language <> v_variety_language then
      perform private.raise('PL422_BAD_SCOPE', 'That variety belongs to a different language.', jsonb_build_object('variety', v_variety));
    end if;
    v_language := v_variety_language;
  end if;
  if v_language is not null and not exists (select 1 from content.languages l where l.code = v_language) then
    perform private.raise('PL422_BAD_SCOPE', 'That language doesn''t exist.', jsonb_build_object('language', v_language));
  end if;

  v_email := private.clean_email(p_email);
  if v_email is null then
    perform private.raise('PL422_BAD_EMAIL', 'That doesn''t look like an email address.');
  end if;

  if p_expires_in_days is null or p_expires_in_days < 1 or p_expires_in_days > 30 then
    perform private.raise('PL422_BAD_EXPIRY', 'Choose an expiry between 1 and 30 days.');
  end if;
  v_expires := now() + pg_catalog.make_interval(days => p_expires_in_days);

  if p_grant_ends_at is not null and p_grant_ends_at <= now() then
    perform private.raise('PL422_BAD_DATE', 'The role can end on a later date, not today or in the past.');
  end if;
  if v_name is not null and char_length(v_name) > 60 then
    perform private.raise('PL422_LENGTH', 'A name can be at most 60 characters.');
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    perform private.raise('PL422_LENGTH', 'A note can be at most 1,000 characters.');
  end if;

  -- 32 random bytes as base64url without padding: 43 characters.
  v_token := pg_catalog.rtrim(
    pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), E'+/\n', '-_'),
    '='
  );

  insert into public.invitations (
    token_hash, role, language_code, variety_id, email, display_name, note,
    grant_ends_at, created_by, expires_at
  ) values (
    private.invitation_token_hash(v_token), p_role, v_language, v_variety, v_email, v_name, v_note,
    p_grant_ends_at, v_admin, v_expires
  )
  returning id into v_id;

  perform private.audit('invitation.created', 'invitation', v_id::text, jsonb_build_object(
    'role', p_role,
    'language', v_language,
    'variety', v_variety,
    'email_masked', private.mask_email(v_email),
    'expires_at', v_expires,
    'grant_ends_at', p_grant_ends_at
  ));

  return jsonb_build_object(
    'invitation_id', v_id,
    'token', v_token,
    'path', '/invite/' || v_token,
    'expires_at', v_expires
  );
end $$;

-- ---------------------------------------------------------------------------
-- revoke_invitation (admin)
-- ---------------------------------------------------------------------------

create function public.revoke_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not private.is_admin() then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can cancel an invitation.');
  end if;
  if p_invitation_id is null then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that invitation.');
  end if;

  select * into v_inv from public.invitations i where i.id = p_invitation_id for update;
  if not found then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that invitation.');
  end if;
  if v_inv.accepted_at is not null then
    perform private.raise('PL410_INVITATION_USED', 'This invitation has already been accepted. End the role instead.',
      jsonb_build_object('invitation_id', v_inv.id, 'grant_id', v_inv.grant_id));
  end if;

  -- Cancelling twice changes nothing and is not an error.
  if v_inv.revoked_at is null then
    update public.invitations
    set revoked_at = now(), revoked_by = private.current_contributor_id()
    where id = v_inv.id
    returning * into v_inv;

    perform private.audit('invitation.revoked', 'invitation', v_inv.id::text, jsonb_build_object(
      'role', v_inv.role, 'language', v_inv.language_code, 'variety', v_inv.variety_id
    ));
  end if;

  return jsonb_build_object('invitation_id', v_inv.id, 'revoked_at', v_inv.revoked_at);
end $$;

-- ---------------------------------------------------------------------------
-- peek_invitation (signed in): what the invitation page shows. No side effects.
-- ---------------------------------------------------------------------------

create function public.peek_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invitations%rowtype;
  v_caller_email text;
begin
  if v_uid is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in to open this invitation.');
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform private.raise('PL404_INVITATION_NOT_FOUND', 'We couldn''t find that invitation.');
  end if;

  select * into v_inv from public.invitations i where i.token_hash = private.invitation_token_hash(p_token);
  if not found then
    perform private.raise('PL404_INVITATION_NOT_FOUND', 'We couldn''t find that invitation.');
  end if;

  select pg_catalog.lower(pg_catalog.btrim(u.email)) into v_caller_email from auth.users u where u.id = v_uid;

  return jsonb_build_object(
    'role', v_inv.role,
    'language', v_inv.language_code,
    'language_name', (select l.name from content.languages l where l.code = v_inv.language_code),
    'variety', v_inv.variety_id,
    'variety_name', (select v.name from content.varieties v where v.id = v_inv.variety_id),
    'display_name', v_inv.display_name,
    'email_masked', private.mask_email(v_inv.email),
    'email_matches', v_caller_email is not distinct from v_inv.email,
    'expires_at', v_inv.expires_at,
    'grant_ends_at', v_inv.grant_ends_at,
    'accepted_by_you', v_inv.accepted_by_user is not distinct from v_uid and v_inv.accepted_at is not null,
    'status', case
      when v_inv.revoked_at is not null then 'revoked'
      when v_inv.accepted_at is not null then 'used'
      -- As accept_invitation sees it: the sender is no longer an admin.
      when not private.contributor_is_admin(v_inv.created_by) then 'revoked'
      when now() >= v_inv.expires_at
        or (v_inv.grant_ends_at is not null and now() >= v_inv.grant_ends_at) then 'expired'
      else 'open'
    end
  );
end $$;

-- ---------------------------------------------------------------------------
-- accept_invitation (signed in)
-- ---------------------------------------------------------------------------

create function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invitations%rowtype;
  v_user_email text;
  v_confirmed timestamptz;
  v_band text;
  v_contributor public.contributors%rowtype;
  v_grant uuid;
begin
  -- 1. Signed in.
  if v_uid is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in to accept this invitation.');
  end if;

  -- 2. The invitation, locked so two accepts of one link serialise.
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform private.raise('PL404_INVITATION_NOT_FOUND', 'We couldn''t find that invitation.');
  end if;
  select * into v_inv
  from public.invitations i
  where i.token_hash = private.invitation_token_hash(p_token)
  for update;
  if not found then
    perform private.raise('PL404_INVITATION_NOT_FOUND', 'We couldn''t find that invitation.');
  end if;

  -- 3. Revoked, expired, used. The person who accepted it gets the same
  --    answer again, however often they open the link.
  if v_inv.revoked_at is not null then
    perform private.raise('PL410_INVITATION_REVOKED', 'This invitation was cancelled.');
  end if;
  if v_inv.accepted_at is not null and v_inv.accepted_by_user = v_uid then
    return jsonb_build_object(
      'contributor_id', v_inv.accepted_contributor_id,
      'grant_id', v_inv.grant_id,
      'role', v_inv.role,
      'language', v_inv.language_code,
      'variety', v_inv.variety_id
    );
  end if;
  if v_inv.accepted_at is null and (
    now() >= v_inv.expires_at
    or (v_inv.grant_ends_at is not null and now() >= v_inv.grant_ends_at)
  ) then
    perform private.raise('PL410_INVITATION_EXPIRED', 'This invitation has expired.');
  end if;
  if v_inv.accepted_at is not null then
    perform private.raise('PL410_INVITATION_USED', 'This invitation has already been used.');
  end if;
  -- An invitation is only as good as its sender: one sent by someone who is
  -- no longer an admin is void, whatever its expiry says.
  if not private.contributor_is_admin(v_inv.created_by) then
    perform private.raise('PL410_INVITATION_REVOKED', 'This invitation is no longer valid.');
  end if;

  -- 4. The caller's address is confirmed and is the invited one.
  select pg_catalog.lower(pg_catalog.btrim(u.email)), u.email_confirmed_at
  into v_user_email, v_confirmed
  from auth.users u
  where u.id = v_uid;
  if v_confirmed is null then
    perform private.raise('PL403_EMAIL_UNVERIFIED', 'Please confirm your email address first.');
  end if;
  if v_user_email is distinct from v_inv.email then
    perform private.raise(
      'PL403_WRONG_EMAIL',
      format('This invitation was sent to %s. Sign in with that address to accept it.', private.mask_email(v_inv.email)),
      jsonb_build_object('email_masked', private.mask_email(v_inv.email))
    );
  end if;

  -- 5. Profile and age: every staff role is for adults.
  select p.age_band into v_band from public.profiles p where p.user_id = v_uid;
  if v_band is null then
    perform private.raise('PL403_NO_PROFILE', 'Tell us your age band first.');
  end if;
  if v_band <> '18+' then
    perform private.raise('PL403_UNDER_18', 'Team roles are for people 18 and over.');
  end if;

  -- 6. The contributor: found, created, or, when they had left or were
  --    paused, made active again. An admin invited them back to one role,
  --    so any older role still open ends here: only the new one is live.
  select * into v_contributor from public.contributors c where c.user_id = v_uid for update;
  if not found then
    insert into public.contributors (user_id, display_name, created_by)
    values (
      v_uid,
      coalesce(v_inv.display_name, left(split_part(v_inv.email, '@', 1), 60)),
      v_inv.created_by
    )
    returning * into v_contributor;
  elsif v_contributor.status <> 'active' then
    perform private.end_open_grants(v_contributor.id, v_inv.created_by, 'Replaced by a new invitation');
    update public.contributors set status = 'active' where id = v_contributor.id
    returning * into v_contributor;
  end if;

  insert into public.contributor_private (contributor_id, contact_email, updated_by)
  values (v_contributor.id, v_inv.email, v_inv.created_by)
  on conflict (contributor_id) do update
    set contact_email = coalesce(public.contributor_private.contact_email, excluded.contact_email);

  -- 7. Role rules: an admin is never also a reviewer, and nobody holds the
  --    same role twice. Grants that have not ended (including ones ending on
  --    a future date) count.
  if v_inv.role in ('admin', 'language_reviewer') and exists (
    select 1 from public.role_grants g
    where g.contributor_id = v_contributor.id
      and g.role = case v_inv.role when 'admin' then 'language_reviewer' else 'admin' end
      and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
  ) then
    perform private.raise(
      'PL409_ROLE_CONFLICT',
      'An admin can''t also be a reviewer. End one role before accepting the other.',
      jsonb_build_object('contributor_id', v_contributor.id)
    );
  end if;
  if exists (
    select 1 from public.role_grants g
    where g.contributor_id = v_contributor.id
      and g.role = v_inv.role
      and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
      and (
        (g.language_code is not distinct from v_inv.language_code and g.variety_id is not distinct from v_inv.variety_id)
        -- An editor of every language already edits this one.
        or (g.role = 'editor' and g.language_code is null)
      )
  ) then
    perform private.raise(
      'PL409_ALREADY_HAS_ROLE',
      'You already have this role.',
      jsonb_build_object('contributor_id', v_contributor.id)
    );
  end if;

  -- 8. The grant, the invitation marked used, the audit trail.
  insert into public.role_grants (
    contributor_id, role, language_code, variety_id, starts_at, ends_at, invitation_id, granted_by
  ) values (
    v_contributor.id, v_inv.role, v_inv.language_code, v_inv.variety_id, now(), v_inv.grant_ends_at,
    v_inv.id, v_inv.created_by
  )
  returning id into v_grant;

  update public.invitations
  set accepted_at = now(),
      accepted_by_user = v_uid,
      accepted_contributor_id = v_contributor.id,
      grant_id = v_grant
  where id = v_inv.id;

  perform private.audit('invitation.accepted', 'invitation', v_inv.id::text, jsonb_build_object(
    'contributor_id', v_contributor.id, 'grant_id', v_grant
  ));
  perform private.audit('role.granted', 'role_grant', v_grant::text, jsonb_build_object(
    'contributor_id', v_contributor.id,
    'role', v_inv.role,
    'language', v_inv.language_code,
    'variety', v_inv.variety_id,
    'ends_at', v_inv.grant_ends_at,
    'invitation_id', v_inv.id,
    'granted_by', v_inv.created_by
  ));

  return jsonb_build_object(
    'contributor_id', v_contributor.id,
    'grant_id', v_grant,
    'role', v_inv.role,
    'language', v_inv.language_code,
    'variety', v_inv.variety_id
  );
end $$;

-- ---------------------------------------------------------------------------
-- revoke_role (admin): end a grant now or on a later date
-- ---------------------------------------------------------------------------

create function public.revoke_role(
  p_grant_id uuid,
  p_effective_at timestamptz default now(),
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.role_grants%rowtype;
  v_at timestamptz := coalesce(p_effective_at, now());
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not private.is_admin() then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can end a role.');
  end if;
  if v_at < now() then
    perform private.raise('PL422_BAD_DATE', 'A role can end now or later, not in the past.');
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    perform private.raise('PL422_LENGTH', 'A reason can be at most 500 characters.');
  end if;
  if p_grant_id is null then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that role.');
  end if;

  -- One lock for every change that can remove an admin (delete_my_account,
  -- revoke_role, update_contributor), taken first, so two of them at the same
  -- moment cannot both pass the last-admin check.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('polilingo.admins', 0));
  select * into v_grant from public.role_grants g where g.id = p_grant_id for update;
  if not found then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that role.');
  end if;
  if v_grant.ends_at is not null and v_grant.ends_at <= now() then
    perform private.raise('PL409_ALREADY_ENDED', 'This role has already ended.', jsonb_build_object('grant_id', v_grant.id));
  end if;
  -- Ending brings a role's end forward; it never pushes it later.
  if v_grant.ends_at is not null and v_at > v_grant.ends_at then
    perform private.raise(
      'PL422_BAD_DATE',
      'This role already ends sooner than that. Choose an earlier date, or end it now.',
      jsonb_build_object('grant_id', v_grant.id, 'ends_at', v_grant.ends_at)
    );
  end if;
  -- Another admin with no end date must remain, whenever this one ends.
  if v_grant.role = 'admin' and not private.other_lasting_admin(v_grant.id, null) then
    perform private.raise(
      'PL409_LAST_ADMIN',
      'This is the last admin role, so the workspace would have no admin. Add another admin first.',
      jsonb_build_object('grant_id', v_grant.id)
    );
  end if;

  -- A grant that starts later than it would end is ended at its start.
  update public.role_grants
  set ends_at = greatest(v_at, v_grant.starts_at + interval '1 second'),
      revoked_by = private.current_contributor_id(),
      revoke_reason = v_reason
  where id = v_grant.id
  returning * into v_grant;

  perform private.audit('role.revoked', 'role_grant', v_grant.id::text, jsonb_build_object(
    'contributor_id', v_grant.contributor_id,
    'role', v_grant.role,
    'language', v_grant.language_code,
    'variety', v_grant.variety_id,
    'ends_at', v_grant.ends_at,
    'reason', v_reason
  ));

  return jsonb_build_object(
    'grant_id', v_grant.id,
    'contributor_id', v_grant.contributor_id,
    'ends_at', v_grant.ends_at
  );
end $$;

-- ---------------------------------------------------------------------------
-- update_contributor (admin: every field; the person themself: attribution)
-- ---------------------------------------------------------------------------

create function public.update_contributor(p_contributor_id text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
  v_self boolean;
  v_public_keys text[] := array['display_name', 'attribution_name', 'status'];
  v_private_keys text[] := array[
    'legal_name', 'contact_email', 'phone', 'whatsapp', 'region',
    'engagement_ref', 'age_verified_note', 'notes'
  ];
  v_key text;
  v_value jsonb;
  v_text text;
  v_row public.contributors%rowtype;
  v_status text;
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  v_admin := private.is_admin();
  v_self := coalesce(p_contributor_id = private.current_contributor_id(), false);
  if not v_admin and not v_self then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can change someone''s details.');
  end if;

  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    perform private.raise('PL422_BAD_INPUT', 'Nothing to change.');
  end if;
  for v_key, v_value in select e.key, e.value from pg_catalog.jsonb_each(p_patch) e loop
    if not (v_key = any (v_public_keys || v_private_keys)) then
      perform private.raise('PL422_BAD_INPUT', format('%s can''t be changed here.', v_key));
    end if;
    if not v_admin and v_key <> 'attribution_name' then
      perform private.raise('PL403_NOT_ADMIN', 'You can change your attribution name. An admin changes the rest.');
    end if;
    if pg_catalog.jsonb_typeof(v_value) not in ('string', 'null') then
      perform private.raise('PL422_BAD_INPUT', format('%s must be text.', v_key));
    end if;
    v_text := nullif(pg_catalog.btrim(v_value #>> '{}'), '');
    if v_key = 'display_name' and (v_text is null or char_length(v_text) > 60) then
      perform private.raise('PL422_BAD_INPUT', 'A name needs 1 to 60 characters.');
    end if;
    if v_key = 'attribution_name' and v_text is not null and char_length(v_text) > 60 then
      perform private.raise('PL422_BAD_INPUT', 'An attribution name can be at most 60 characters.');
    end if;
    if v_key = 'status' and (v_text is null or v_text not in ('active', 'paused', 'ended')) then
      perform private.raise('PL422_BAD_INPUT', 'Status is active, paused or ended.');
    end if;
    if v_key = 'contact_email' and v_text is not null and private.clean_email(v_text) is null then
      perform private.raise('PL422_BAD_INPUT', 'That contact email doesn''t look right.');
    end if;
    if v_key = any (v_private_keys) and v_text is not null and char_length(v_text) > 2000 then
      perform private.raise('PL422_BAD_INPUT', format('%s is too long.', v_key));
    end if;
  end loop;

  -- One lock for every change that can remove an admin (delete_my_account,
  -- revoke_role, update_contributor), taken first, so two of them at the same
  -- moment cannot both pass the last-admin check.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('polilingo.admins', 0));
  select * into v_row from public.contributors c where c.id = p_contributor_id for update;
  if not found then
    perform private.raise('PL404_NOT_FOUND', 'We couldn''t find that person.');
  end if;

  v_status := coalesce(nullif(pg_catalog.btrim(p_patch ->> 'status'), ''), v_row.status);
  if v_status <> 'active' and v_row.status = 'active'
     and exists (
       select 1 from public.role_grants g
       where g.contributor_id = v_row.id and g.role = 'admin'
         and g.starts_at <= now() and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
     )
     and not private.other_lasting_admin(null, v_row.id) then
    perform private.raise('PL409_LAST_ADMIN', 'This is the last admin, so they can''t be paused or ended. Add another admin first.');
  end if;

  -- Leaving ends every role that is still open, so nothing comes back if
  -- they are ever made active again.
  if v_status = 'ended' and v_row.status <> 'ended' then
    perform private.end_open_grants(v_row.id, private.current_contributor_id(), 'Left the team');
  end if;

  update public.contributors c
  set display_name = case when p_patch ? 'display_name' then pg_catalog.btrim(p_patch ->> 'display_name') else c.display_name end,
      attribution_name = case when p_patch ? 'attribution_name' then nullif(pg_catalog.btrim(p_patch ->> 'attribution_name'), '') else c.attribution_name end,
      status = v_status
  where c.id = v_row.id
  returning * into v_row;

  if p_patch ?| v_private_keys then
    insert into public.contributor_private (contributor_id, updated_by)
    values (v_row.id, private.current_contributor_id())
    on conflict (contributor_id) do nothing;

    update public.contributor_private cp
    set legal_name = case when p_patch ? 'legal_name' then nullif(pg_catalog.btrim(p_patch ->> 'legal_name'), '') else cp.legal_name end,
        contact_email = case when p_patch ? 'contact_email' then private.clean_email(p_patch ->> 'contact_email') else cp.contact_email end,
        phone = case when p_patch ? 'phone' then nullif(pg_catalog.btrim(p_patch ->> 'phone'), '') else cp.phone end,
        whatsapp = case when p_patch ? 'whatsapp' then nullif(pg_catalog.btrim(p_patch ->> 'whatsapp'), '') else cp.whatsapp end,
        region = case when p_patch ? 'region' then nullif(pg_catalog.btrim(p_patch ->> 'region'), '') else cp.region end,
        engagement_ref = case when p_patch ? 'engagement_ref' then nullif(pg_catalog.btrim(p_patch ->> 'engagement_ref'), '') else cp.engagement_ref end,
        age_verified_note = case when p_patch ? 'age_verified_note' then nullif(pg_catalog.btrim(p_patch ->> 'age_verified_note'), '') else cp.age_verified_note end,
        notes = case when p_patch ? 'notes' then nullif(pg_catalog.btrim(p_patch ->> 'notes'), '') else cp.notes end,
        updated_at = now(),
        updated_by = private.current_contributor_id()
    where cp.contributor_id = v_row.id;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'display_name', v_row.display_name,
    'attribution_name', v_row.attribution_name,
    'status', v_row.status
  );
end $$;

-- ---------------------------------------------------------------------------
-- page_admin_people (admin)
-- ---------------------------------------------------------------------------

create function public.page_admin_people()
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
  if not private.is_admin() then
    perform private.raise('PL403_NOT_ADMIN', 'Only an admin can see the team.');
  end if;

  return jsonb_build_object(
    'now', now(),
    'me', private.current_contributor_id(),
    'people', coalesce((
      select jsonb_agg(person order by status_rank, lower(display_name) collate "C", id collate "C")
      from (
        select
          c.id,
          c.display_name,
          case c.status when 'active' then 0 when 'paused' then 1 else 2 end as status_rank,
          jsonb_build_object(
            'id', c.id,
            'display_name', c.display_name,
            'attribution_name', c.attribution_name,
            'status', c.status,
            'created_at', c.created_at,
            'has_account', c.user_id is not null,
            'email', u.email,
            'age_band', p.age_band,
            'last_sign_in_at', u.last_sign_in_at,
            'private', case when cp.contributor_id is null then null else jsonb_build_object(
              'legal_name', cp.legal_name,
              'contact_email', cp.contact_email,
              'phone', cp.phone,
              'whatsapp', cp.whatsapp,
              'region', cp.region,
              'engagement_ref', cp.engagement_ref,
              'age_verified_note', cp.age_verified_note,
              'notes', cp.notes
            ) end,
            'grants', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', g.id,
                'role', g.role,
                'language', g.language_code,
                'language_name', l.name,
                'variety', g.variety_id,
                'variety_name', v.name,
                'starts_at', g.starts_at,
                'ends_at', g.ends_at,
                'state', case
                  when g.starts_at > now() then 'scheduled'
                  when g.ends_at is null then 'active'
                  when g.ends_at > now() then 'ending'
                  else 'ended'
                end,
                'granted_by', g.granted_by,
                'revoked_by', g.revoked_by,
                'revoke_reason', g.revoke_reason
              ) order by (g.ends_at is not null and g.ends_at <= now()), g.starts_at desc, g.id)
              from public.role_grants g
              left join content.languages l on l.code = g.language_code
              left join content.varieties v on v.id = g.variety_id
              where g.contributor_id = c.id
            ), '[]'::jsonb)
          ) as person
        from public.contributors c
        left join auth.users u on u.id = c.user_id
        left join public.profiles p on p.user_id = c.user_id
        left join public.contributor_private cp on cp.contributor_id = c.id
      ) people
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'role', i.role,
        'language', i.language_code,
        'language_name', l.name,
        'variety', i.variety_id,
        'variety_name', v.name,
        'email', i.email,
        'display_name', i.display_name,
        'note', i.note,
        'created_at', i.created_at,
        'created_by', i.created_by,
        'created_by_name', cb.display_name,
        'expires_at', i.expires_at,
        'grant_ends_at', i.grant_ends_at,
        -- As accept_invitation sees it: a link whose role would already
        -- have ended can't be accepted either, nor one whose sender is no
        -- longer an admin.
        'state', case
          when now() >= i.expires_at
            or (i.grant_ends_at is not null and now() >= i.grant_ends_at) then 'expired'
          when not private.contributor_is_admin(i.created_by) then 'void'
          else 'open'
        end
      ) order by i.created_at desc, i.id)
      from public.invitations i
      left join content.languages l on l.code = i.language_code
      left join content.varieties v on v.id = i.variety_id
      left join public.contributors cb on cb.id = i.created_by
      where i.accepted_at is null
        and i.revoked_at is null
        and i.expires_at > now() - interval '14 days'
    ), '[]'::jsonb),
    'languages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', l.code,
        'name', l.name,
        'varieties', coalesce((
          select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name) order by v.name collate "C", v.id collate "C")
          from content.varieties v
          where v.language_code = l.code
        ), '[]'::jsonb)
      ) order by l.name collate "C", l.code collate "C")
      from content.languages l
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- page_admin_overview (staff; the accounts section for admins only)
-- ---------------------------------------------------------------------------

create function public.page_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_latest content.releases%rowtype;
  v_admin boolean;
begin
  if auth.uid() is null then
    perform private.raise('PL401_NOT_SIGNED_IN', 'Please sign in first.');
  end if;
  if not private.is_staff() then
    perform private.raise('PL403_NOT_ADMIN', 'The overview is for the PoliLingo team.');
  end if;
  v_admin := private.is_admin();

  select * into v_latest from content.releases r order by r.seq desc limit 1;

  return jsonb_build_object(
    'generated_at', now(),
    'target', jsonb_build_object('reviewed_target_min', 250, 'reviewed_target_max', 400),
    'latest_release', case when v_latest.seq is null then null else jsonb_build_object(
      'name', v_latest.name,
      'kind', v_latest.kind,
      'published_at', v_latest.published_at,
      'lessons', (select count(*) from content.release_lessons rl where rl.release_seq = v_latest.seq),
      'items', (select count(*) from content.release_items ri where ri.release_seq = v_latest.seq)
    ) end,
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
        'lessons', s.lessons,
        'items', s.items,
        'demo', s.demo,
        'draft', s.draft,
        'in_review', s.in_review,
        'changes_requested', s.changes_requested,
        'reviewed', s.reviewed,
        'approved_waiting', s.approved_waiting,
        'live', s.live,
        'reviewed_live', s.reviewed_live,
        'demo_live', s.live - s.reviewed_live,
        'gated', s.gated
      ) order by l.name collate "C", l.code collate "C")
      from content.languages l
      cross join lateral (
        select
          (select count(*) from content.lessons ls
             where ls.retired_at is null and split_part(ls.id, '-', 1) = l.code)::int as lessons,
          count(i.id)::int as items,
          count(i.id) filter (where i.is_demo)::int as demo,
          count(i.id) filter (where not i.is_demo and i.review_status = 'unreviewed' and not i.submitted)::int as draft,
          count(i.id) filter (where not i.is_demo and i.review_status = 'unreviewed' and i.submitted)::int as in_review,
          count(i.id) filter (where not i.is_demo and i.review_status in ('changes_requested', 'rejected'))::int as changes_requested,
          count(i.id) filter (where not i.is_demo and i.review_status = 'approved')::int as reviewed,
          count(i.id) filter (where not i.is_demo and i.review_status = 'approved' and not i.live_current)::int as approved_waiting,
          count(i.id) filter (where i.gated)::int as gated,
          (select count(*) from content.release_items ri
             where ri.release_seq = v_latest.seq and split_part(ri.item_id, '-', 1) = l.code)::int as live,
          (select count(*) from content.release_items ri
             where ri.release_seq = v_latest.seq and not ri.is_demo and split_part(ri.item_id, '-', 1) = l.code)::int as reviewed_live
        from (
          select
            it.id,
            it.review_status,
            exists (select 1 from content.demo_items d where d.item_id = it.id) as is_demo,
            ls.submitted_at is not null as submitted,
            exists (
              select 1 from content.release_items ri
              where ri.release_seq = v_latest.seq and ri.item_id = it.id
                and ri.review_fingerprint = it.review_fingerprint
            ) as live_current,
            private.effective_gate(ls.id) = 'blocked' as gated
          from content.items it
          join content.lessons ls on ls.id = it.lesson_id
          where it.retired_at is null and ls.retired_at is null
            and split_part(it.id, '-', 1) = l.code
        ) i
      ) s
    ), '[]'::jsonb),
    'varieties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'language', v.language_code,
        'language_name', l.name,
        'name', v.name,
        'publish_gate', v.publish_gate,
        'reviewers', private.active_reviewer_count(v.id),
        'reviewer_names', coalesce((
          select jsonb_agg(distinct c.display_name)
          from public.role_grants g
          join public.contributors c on c.id = g.contributor_id
          join public.profiles p on p.user_id = c.user_id
          where g.role = 'language_reviewer' and g.variety_id = v.id
            and c.status = 'active' and p.age_band = '18+'
            and g.starts_at <= now() and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
        ), '[]'::jsonb)
      ) order by l.name collate "C", v.name collate "C", v.id collate "C")
      from content.varieties v
      join content.languages l on l.code = v.language_code
    ), '[]'::jsonb),
    'accounts', case when not v_admin then null else jsonb_build_object(
      'total', (select count(*) from public.profiles)::int,
      'adults', (select count(*) from public.profiles p where p.age_band = '18+')::int,
      'active_7d', (
        select count(distinct pi.user_id) from public.progress_imports pi
        where pi.imported_at >= now() - interval '7 days'
      )::int,
      'learners_with_completion', (select count(distinct pc.user_id) from public.progress_completions pc)::int,
      'completions', (select count(*) from public.progress_completions)::int,
      'team', (
        select count(distinct c.id) from public.contributors c
        join public.role_grants g on g.contributor_id = c.id
        where c.status = 'active' and g.starts_at <= now() and now() < coalesce(g.ends_at, 'infinity'::timestamptz)
      )::int,
      'activity_7d', (
        select jsonb_agg(jsonb_build_object(
          'date', d.day,
          'accounts', (
            select count(distinct pi.user_id) from public.progress_imports pi
            where pi.imported_at >= pg_catalog.timezone('UTC', d.day::timestamp)
              and pi.imported_at < pg_catalog.timezone('UTC', (d.day + 1)::timestamp)
          )
        ) order by d.day)
        from (
          -- The last seven UTC days, today included.
          select (pg_catalog.timezone('UTC', now())::date - g.n) as day
          from pg_catalog.generate_series(6, 0, -1) g(n)
        ) d
      )
    ) end
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants: the API functions to signed-in users only
-- ---------------------------------------------------------------------------

revoke all on function
  private.mask_email(text),
  private.invitation_token_hash(text),
  private.clean_email(text),
  private.contributor_is_admin(text),
  private.other_lasting_admin(uuid, text),
  private.end_open_grants(text, text, text),
  public.create_invitation(text, text, text, text, text, int, timestamptz, text),
  public.revoke_invitation(uuid),
  public.peek_invitation(text),
  public.accept_invitation(text),
  public.revoke_role(uuid, timestamptz, text),
  public.update_contributor(text, jsonb),
  public.page_admin_people(),
  public.page_admin_overview()
from public, anon, authenticated;

grant execute on function
  public.create_invitation(text, text, text, text, text, int, timestamptz, text),
  public.revoke_invitation(uuid),
  public.peek_invitation(text),
  public.accept_invitation(text),
  public.revoke_role(uuid, timestamptz, text),
  public.update_contributor(text, jsonb),
  public.page_admin_people(),
  public.page_admin_overview()
to authenticated;
