-- Stash Phase 2 hardening. Apply AFTER 0001_profiles.sql. Idempotent: safe to re-run.
--
-- Fixes (found in the independent review):
--  S1  A matric number could be claimed by an UNVERIFIED sign-up (squatting). Sign-up
--      metadata is now applied only once the email is verified.
--  S2  "matric taken" was an unthrottled yes/no oracle about other students. The
--      database now answers with one neutral status and throttles repeated failures.
--  S3  No controlled way to correct a locked matric number: audited admin function added.
--  S4  profiles.email could drift from the sign-in email: now kept in sync.
--  S5  Control characters were allowed in names.
--  S6  Function privileges tightened for Supabase's default EXECUTE grants.

-- ------------------------------------------------------------ S5: name hygiene
alter table public.profiles drop constraint if exists profiles_full_name_chars;
alter table public.profiles add constraint profiles_full_name_chars
  check (full_name is null or full_name !~ '[[:cntrl:]]');

-- ------------------------------------------------------------ tables (private)
create table if not exists public.profile_save_attempts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  outcome      text not null
);
create index if not exists profile_save_attempts_user_time
  on public.profile_save_attempts (user_id, attempted_at);

-- Audit trail of administrator matric corrections. No FK on purpose: the record
-- must outlive the account.
create table if not exists public.matric_corrections (
  id            bigint generated always as identity primary key,
  user_id       uuid not null,
  old_matric    text,
  new_matric    text not null,
  reason        text not null,
  corrected_by  text not null default current_user,
  corrected_at  timestamptz not null default now()
);

alter table public.profile_save_attempts enable row level security;
alter table public.matric_corrections    enable row level security;
-- RLS enabled with NO policies + no grants: only the table owner / service role can touch them.
revoke all on public.profile_save_attempts from public, anon, authenticated;
revoke all on public.matric_corrections    from public, anon, authenticated;

-- ------------------------------------------------ S1: apply metadata only when verified
create or replace function public.apply_signup_metadata(p_id uuid, p_meta jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name   text := nullif(btrim(coalesce(p_meta->>'full_name', p_meta->>'name', '')), '');
  v_matric text := nullif(public.normalize_matric(p_meta->>'matric_number'), '');
  v_level  text := nullif(btrim(coalesce(p_meta->>'level', '')), '');
begin
  begin
    update public.profiles
       set full_name     = coalesce(full_name, v_name),
           matric_number = coalesce(matric_number, v_matric),
           level         = coalesce(level, v_level)
     where id = p_id;
  exception when unique_violation or check_violation then
    -- bad or already-claimed metadata: keep at most a valid name, never fail verification
    begin
      update public.profiles set full_name = coalesce(full_name, v_name) where id = p_id;
    exception when check_violation then null;
    end;
  end;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  -- Google (and any provider that verifies the email) arrives already confirmed.
  if new.email_confirmed_at is not null then
    perform public.apply_signup_metadata(new.id, new.raw_user_meta_data);
  end if;
  return new;
end $$;

create or replace function public.handle_user_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;           -- S4
  end if;
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform public.apply_signup_metadata(new.id, new.raw_user_meta_data);      -- S1
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated after update of email, email_confirmed_at on auth.users
  for each row execute function public.handle_user_update();

-- Clean up any claims made through the old (pre-verification) path.
update public.profiles p
   set full_name = null, matric_number = null, level = null
 where p.matric_number is not null
   and exists (select 1 from auth.users u where u.id = p.id and u.email_confirmed_at is null);

-- ---------------------------------------- S2: neutral duplicate answer + throttle
drop function if exists public.save_my_profile(text, text, text);
create function public.save_my_profile(p_full_name text, p_matric text, p_level text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := btrim(coalesce(p_full_name, ''));
  v_matric  text := public.normalize_matric(p_matric);
  v_current public.profiles;
  v_row     public.profiles;
  v_recent  int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'email_not_verified';
  end if;

  -- Throttle: at most 5 rejected matric attempts per hour per account.
  delete from public.profile_save_attempts where attempted_at < now() - interval '1 day';
  select count(*) into v_recent from public.profile_save_attempts
   where user_id = v_uid and attempted_at > now() - interval '1 hour';
  if v_recent >= 5 then return jsonb_build_object('status', 'too_many_attempts'); end if;

  if char_length(v_name) not between 2 and 80 or v_name ~ '[[:cntrl:]]' then raise exception 'invalid_name'; end if;
  if v_matric !~ '^[A-Z0-9][A-Z0-9/_-]{3,23}$' then raise exception 'invalid_matric'; end if;
  if p_level is null or p_level not in ('100L','200L','300L','400L','500L') then raise exception 'invalid_level'; end if;

  select * into v_current from public.profiles where id = v_uid;
  if v_current.matric_number is not null and v_current.matric_number <> v_matric then
    raise exception 'matric_locked';
  end if;

  begin
    insert into public.profiles (id, email, full_name, matric_number, level)
    select v_uid, u.email, v_name, v_matric, p_level from auth.users u where u.id = v_uid
    on conflict (id) do update
      set full_name = excluded.full_name, matric_number = excluded.matric_number,
          level = excluded.level, email = excluded.email
    returning * into v_row;
  exception when unique_violation then
    -- Same neutral answer whatever the reason; recorded for throttling.
    insert into public.profile_save_attempts (user_id, outcome) values (v_uid, 'matric_unavailable');
    return jsonb_build_object('status', 'matric_unavailable');
  end;
  return jsonb_build_object('status', 'ok', 'profile', to_jsonb(v_row));
end $$;

-- ------------------------------------ S3: controlled, audited matric correction
-- NOT callable by students. Run by an administrator (SQL editor as postgres, or the
-- service role) after checking evidence. See docs/MATRIC_CORRECTION.md.
create or replace function public.admin_correct_matric(p_user_id uuid, p_new_matric text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_new text := public.normalize_matric(p_new_matric);
  v_old text;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason_required: describe the evidence checked (at least 10 characters)';
  end if;
  if v_new !~ '^[A-Z0-9][A-Z0-9/_-]{3,23}$' then raise exception 'invalid_matric'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null) then
    raise exception 'user_not_found_or_unverified';
  end if;
  select matric_number into v_old from public.profiles where id = p_user_id;
  if v_old is not distinct from v_new then raise exception 'no_change'; end if;
  begin
    update public.profiles set matric_number = v_new where id = p_user_id;
  exception when unique_violation then
    raise exception 'matric_in_use_by_another_account';
  end;
  insert into public.matric_corrections (user_id, old_matric, new_matric, reason)
  values (p_user_id, v_old, v_new, btrim(p_reason));
  return jsonb_build_object('user_id', p_user_id, 'old_matric', v_old, 'new_matric', v_new);
end $$;

-- ------------------------------------------------- S6: privileges (explicit, minimal)
-- Supabase grants EXECUTE on new public functions to anon/authenticated/service_role by default.
revoke all on function public.apply_signup_metadata(uuid, jsonb)            from public, anon, authenticated, service_role;
revoke all on function public.handle_new_user()                             from public, anon, authenticated, service_role;
revoke all on function public.handle_user_update()                          from public, anon, authenticated, service_role;
revoke all on function public.touch_updated_at()                            from public, anon, authenticated, service_role;
revoke all on function public.normalize_matric(text)                        from public, anon, authenticated, service_role;
revoke all on function public.save_my_profile(text, text, text)             from public, anon;
revoke all on function public.delete_my_account()                           from public, anon;
revoke all on function public.admin_correct_matric(uuid, text, text)        from public, anon, authenticated;
grant execute on function public.save_my_profile(text, text, text)          to authenticated;
grant execute on function public.delete_my_account()                        to authenticated;
grant execute on function public.admin_correct_matric(uuid, text, text)     to service_role;
