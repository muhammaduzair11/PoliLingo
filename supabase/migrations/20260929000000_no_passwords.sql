-- PoliLingo never uses passwords (ADR-0030): people sign in with Google or a
-- 6-digit email code. Supabase Auth still accepts password sign-ups through the
-- public API, so someone could pre-register another person's email with a
-- password of their own; when that person later confirms the account with an
-- email code, the stranger's password would open it, with its roles and
-- progress. Auth writes passwords into auth.users.encrypted_password, so any
-- password it tries to store is blanked here, and password sign-in can never
-- succeed. Google and email-code accounts already have an empty password.
create or replace function private.forbid_passwords()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.encrypted_password is not null and new.encrypted_password <> '' then
    new.encrypted_password := '';
  end if;
  return new;
end
$$;

revoke all on function private.forbid_passwords() from public, anon, authenticated;

drop trigger if exists polilingo_no_passwords on auth.users;
create trigger polilingo_no_passwords
  before insert or update of encrypted_password on auth.users
  for each row execute function private.forbid_passwords();
