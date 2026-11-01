-- Stash Phase 2: student profiles, validation, RLS.
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to run once.
-- Auth identities live in Supabase's auth.users; this table holds only the
-- student's academic profile and is keyed 1:1 by auth.users.id.

-- ---------------------------------------------------------------- institutions
-- One row today (FULAFIA). Adding a university later = inserting a row,
-- no schema change.
create table if not exists public.institutions (
  code text primary key check (code ~ '^[A-Z0-9_]{2,16}$'),
  name text not null
);
insert into public.institutions (code, name)
values ('FULAFIA', 'Federal University of Lafia')
on conflict (code) do nothing;

alter table public.institutions enable row level security;
drop policy if exists institutions_read on public.institutions;
create policy institutions_read on public.institutions
  for select to anon, authenticated using (true);
revoke all on public.institutions from anon, authenticated;
grant select on public.institutions to anon, authenticated;

-- -------------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text,
  full_name      text,
  matric_number  text,
  level          text,
  institution    text not null default 'FULAFIA' references public.institutions (code),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint profiles_full_name_len check (
    full_name is null or char_length(btrim(full_name)) between 2 and 80),
  -- Basic shape only: the real FULAFIA format is not documented in the project.
  -- 4-24 chars of A-Z, 0-9, "/", "-", "_", stored upper-case with no spaces.
  constraint profiles_matric_shape check (
    matric_number is null or matric_number ~ '^[A-Z0-9][A-Z0-9/_-]{3,23}$'),
  constraint profiles_level_valid check (
    level is null or level in ('100L','200L','300L','400L','500L')),

  -- Computed by the database; the browser can never set it.
  profile_complete boolean generated always as (
    full_name is not null and matric_number is not null and level is not null) stored
);

-- One matric number per institution (no two accounts may claim the same one).
create unique index if not exists profiles_institution_matric_key
  on public.profiles (institution, matric_number) where matric_number is not null;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------------ RLS
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

-- Deliberately NO insert/update/delete policies and NO write privileges:
-- the browser (anon key + user JWT) can only READ its own row. Every write goes
-- through the validated SECURITY DEFINER functions below.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- ------------------------------------------------------------------- helpers
create or replace function public.normalize_matric(p text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(btrim(coalesce(p, '')), '\s+', '', 'g'))
$$;

-- Create the profile row whenever an auth user is created (email signup or
-- Google). Metadata supplied at signup is UNTRUSTED: it is only used if it
-- passes the same constraints, and never makes signup fail.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name   text := nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name',
                                         new.raw_user_meta_data->>'name', '')), '');
  v_matric text := nullif(public.normalize_matric(new.raw_user_meta_data->>'matric_number'), '');
  v_level  text := nullif(btrim(coalesce(new.raw_user_meta_data->>'level', '')), '');
begin
  begin
    insert into public.profiles (id, email, full_name, matric_number, level)
    values (new.id, new.email, v_name, v_matric, v_level);
  exception when unique_violation or check_violation then
    -- bad / duplicate metadata: fall back to an empty profile -> onboarding
    insert into public.profiles (id, email) values (new.id, new.email)
    on conflict (id) do nothing;
  end;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------- write: save profile
-- The only way to set/modify name, matric number and level.
-- Errors use stable machine codes in the message: not_authenticated,
-- email_not_verified, invalid_name, invalid_matric, invalid_level,
-- matric_taken, matric_locked.
-- (dropped first so this file can be re-run after 0002 changed the return type; 0002 always re-applies the hardened version)
drop function if exists public.save_my_profile(text, text, text);
create function public.save_my_profile(
  p_full_name text, p_matric text, p_level text)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := btrim(coalesce(p_full_name, ''));
  v_matric  text := public.normalize_matric(p_matric);
  v_current public.profiles;
  v_row     public.profiles;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  if not exists (select 1 from auth.users u
                 where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'email_not_verified';
  end if;

  if char_length(v_name) not between 2 and 80 then raise exception 'invalid_name'; end if;
  if v_matric !~ '^[A-Z0-9][A-Z0-9/_-]{3,23}$' then raise exception 'invalid_matric'; end if;
  if p_level is null or p_level not in ('100L','200L','300L','400L','500L') then
    raise exception 'invalid_level'; end if;

  select * into v_current from public.profiles where id = v_uid;
  -- Once a matric number is set it cannot be edited by the student
  -- (it will identify them for paid access later).
  if v_current.matric_number is not null and v_current.matric_number <> v_matric then
    raise exception 'matric_locked'; end if;

  begin
    insert into public.profiles (id, email, full_name, matric_number, level)
    select v_uid, u.email, v_name, v_matric, p_level from auth.users u where u.id = v_uid
    on conflict (id) do update
      set full_name = excluded.full_name,
          matric_number = excluded.matric_number,
          level = excluded.level,
          email = excluded.email
    returning * into v_row;
  exception when unique_violation then
    raise exception 'matric_taken';
  end;
  return v_row;
end $$;

-- Delete the caller's own account: auth.users row, which cascades to profiles.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  delete from auth.users where id = v_uid;
end $$;

revoke all on function public.save_my_profile(text, text, text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
grant execute on function public.save_my_profile(text, text, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
