-- Stash Phase 4a: Cafe Print (one-time, 10-minute, 6-digit PINs for ONE private document).
-- Apply AFTER 0001, 0002 and 0003. Idempotent. NOT applied to any live project by this repository.
--
-- Model
--   * A student (authenticated, email-verified) calls cafe_create_pin(document_id). The PIN is generated HERE with the
--     database CSPRNG (gen_random_uuid -> pg_strong_random, rejection sampling => uniform 000000-999999), returned ONCE and
--     stored only as sha256(pepper || ':' || pin). The pepper lives in cafe_settings, which no API role can read.
--   * The cafe computer has no login. It calls the Vercel endpoint /api/cafe/redeem, which calls cafe_redeem() with the
--     SERVICE ROLE (the only role allowed to). cafe_redeem atomically claims the PIN in ONE UPDATE ... RETURNING, so two
--     simultaneous requests can never both win, then the endpoint signs a short-lived URL for that single object.
--   * Rate limits are enforced in the database before the PIN lookup: per-IP request flood, per-IP failed-guess lockout and a
--     global failed-guess ceiling (fail-closed). Success NEVER resets a failure counter.
--   * A successful redemption also returns a "receipt" (256-bit random, stored hashed, short-lived, few uses). If the file
--     download/print fails after redemption, the receipt can fetch a fresh signed URL for the SAME document. The PIN itself
--     never becomes reusable.
--   * Browsers get NO direct write access and no access to pin_hash; anon gets nothing.
--
-- Time: every expiry decision uses now() of the database server, never a client timestamp.

-- ------------------------------------------------------------------ settings (single row, no API access)
create table if not exists public.cafe_settings (
  id                   boolean primary key default true check (id),
  pepper               text    not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  ttl_seconds          int     not null default 600  check (ttl_seconds between 30 and 3600),
  create_per_hour      int     not null default 12   check (create_per_hour between 1 and 1000),
  ip_req_per_min       int     not null default 30   check (ip_req_per_min >= 1),
  ip_fail_limit        int     not null default 5    check (ip_fail_limit >= 1),
  ip_window_seconds    int     not null default 900  check (ip_window_seconds >= 1),
  ip_lock_seconds      int     not null default 900  check (ip_lock_seconds >= 1),
  global_fail_limit    int     not null default 120  check (global_fail_limit >= 1),
  global_window_seconds int    not null default 3600 check (global_window_seconds >= 1),
  receipt_ttl_seconds  int     not null default 300  check (receipt_ttl_seconds between 10 and 1800),
  receipt_max_uses     int     not null default 3    check (receipt_max_uses between 0 and 10),
  history_days         int     not null default 7    check (history_days between 1 and 90)
);
insert into public.cafe_settings (id) values (true) on conflict (id) do nothing;

-- ------------------------------------------------------------------ pins
create table if not exists public.cafe_pins (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users (id) on delete cascade,
  document_id        uuid not null references public.documents (id) on delete cascade,
  pin_hash           bytea not null check (octet_length(pin_hash) = 32),
  status             text not null default 'active' check (status in ('active', 'redeemed', 'revoked', 'expired')),
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  redeemed_at        timestamptz,
  revoked_at         timestamptz,
  receipt_hash       bytea check (receipt_hash is null or octet_length(receipt_hash) = 32),
  receipt_expires_at timestamptz,
  receipt_uses       int not null default 0 check (receipt_uses >= 0),
  check (expires_at > created_at),
  check ((status = 'redeemed') = (redeemed_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);
-- At most one live PIN per student, and no two live PINs with the same hash (so a PIN identifies one row).
create unique index if not exists cafe_pins_active_hash_uq  on public.cafe_pins (pin_hash)  where status = 'active';
create unique index if not exists cafe_pins_active_owner_uq on public.cafe_pins (owner_id)  where status = 'active';
create unique index if not exists cafe_pins_receipt_uq      on public.cafe_pins (receipt_hash) where receipt_hash is not null;
create index if not exists cafe_pins_owner_created_idx on public.cafe_pins (owner_id, created_at desc);
create index if not exists cafe_pins_active_expiry_idx on public.cafe_pins (expires_at) where status = 'active';

-- Per-client-fingerprint throttling. ip_hash is a salted hash computed by the API; raw IPs are never stored.
create table if not exists public.cafe_attempts (
  ip_hash          bytea primary key check (octet_length(ip_hash) = 32),
  req_count        int not null default 0,
  req_window_start timestamptz not null default now(),
  fail_count       int not null default 0,
  fail_window_start timestamptz not null default now(),
  locked_until     timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists cafe_attempts_updated_idx on public.cafe_attempts (updated_at);

create table if not exists public.cafe_global (
  id           boolean primary key default true check (id),
  fail_count   int not null default 0,
  window_start timestamptz not null default now()
);
insert into public.cafe_global (id) values (true) on conflict (id) do nothing;

alter table public.cafe_settings enable row level security;
alter table public.cafe_pins     enable row level security;
alter table public.cafe_attempts enable row level security;
alter table public.cafe_global   enable row level security;

-- Students may SELECT (never write) their own rows, and only non-secret columns (see column grants below).
drop policy if exists cafe_pins_select_own on public.cafe_pins;
create policy cafe_pins_select_own on public.cafe_pins for select to authenticated using (owner_id = auth.uid());

-- ------------------------------------------------------------------ helpers (not callable by any API role)
create or replace function public._cafe_hash(p_pin text) returns bytea
language sql stable security definer set search_path = '' as
$$ select sha256(convert_to((select pepper from public.cafe_settings where id) || ':' || p_pin, 'UTF8')) $$;

-- Uniform 6-digit PIN: take 32 random bits, reject the biased tail, reduce mod 10^6.
create or replace function public._cafe_random_pin() returns text
language plpgsql volatile set search_path = '' as $$
declare b bytea; n bigint;
begin
  loop
    b := uuid_send(gen_random_uuid());                        -- bytes 0..3 are fully random
    n := get_byte(b, 0)::bigint * 16777216 + get_byte(b, 1) * 65536 + get_byte(b, 2) * 256 + get_byte(b, 3);
    exit when n < 4294000000;                                  -- 4294 * 10^6: every residue equally likely
  end loop;
  return lpad((n % 1000000)::text, 6, '0');
end $$;

create or replace function public._cafe_random_token() returns text
language sql volatile set search_path = '' as
$$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;

-- Is the document still redeemable? (ready, owned by the pin owner, and the object really exists in the private bucket.)
create or replace function public._cafe_doc_ok(p_doc uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.documents d
                   where d.id = p_doc and d.user_id = p_owner and d.status = 'ready'
                     and exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = d.storage_path)) $$;

-- Flood + lockout gate. Takes the row lock for this client, so concurrent requests from it are counted exactly.
-- Returns 0 when the request may proceed, otherwise the number of seconds to wait.
create or replace function public._cafe_throttle(p_ip bytea) returns int
language plpgsql security definer set search_path = '' as $$
declare s public.cafe_settings; a public.cafe_attempts; v_wait int := 0;
begin
  if p_ip is null or octet_length(p_ip) <> 32 then raise exception 'invalid_client'; end if;
  select * into s from public.cafe_settings where id;
  insert into public.cafe_attempts (ip_hash) values (p_ip) on conflict (ip_hash) do nothing;
  select * into a from public.cafe_attempts where ip_hash = p_ip for update;
  if now() - a.req_window_start >= interval '60 seconds' then a.req_count := 0; a.req_window_start := now(); end if;
  a.req_count := a.req_count + 1;
  if a.locked_until is not null and a.locked_until > now() then
    v_wait := greatest(1, ceil(extract(epoch from (a.locked_until - now())))::int);
  elsif a.req_count > s.ip_req_per_min then
    v_wait := greatest(1, ceil(extract(epoch from (a.req_window_start + interval '60 seconds' - now())))::int);
  end if;
  update public.cafe_attempts set req_count = a.req_count, req_window_start = a.req_window_start, updated_at = now() where ip_hash = p_ip;
  return v_wait;
end $$;

create or replace function public._cafe_record_failure(p_ip bytea) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.cafe_settings; a public.cafe_attempts;
begin
  select * into s from public.cafe_settings where id;
  select * into a from public.cafe_attempts where ip_hash = p_ip for update;
  if now() - a.fail_window_start >= make_interval(secs => s.ip_window_seconds) then a.fail_count := 0; a.fail_window_start := now(); end if;
  a.fail_count := a.fail_count + 1;
  -- reaching the limit starts the lock and a fresh counter, so one lock cannot chain into the next after it ends
  update public.cafe_attempts
     set fail_count = case when a.fail_count >= s.ip_fail_limit then 0 else a.fail_count end,
         fail_window_start = a.fail_window_start, updated_at = now(),
         locked_until = case when a.fail_count >= s.ip_fail_limit then now() + make_interval(secs => s.ip_lock_seconds) else locked_until end
   where ip_hash = p_ip;
  update public.cafe_global
     set fail_count = case when now() - window_start >= make_interval(secs => s.global_window_seconds) then 1 else fail_count + 1 end,
         window_start = case when now() - window_start >= make_interval(secs => s.global_window_seconds) then now() else window_start end
   where id;
end $$;

create or replace function public._cafe_global_blocked() returns boolean
language sql stable security definer set search_path = '' as
$$ select g.fail_count >= s.global_fail_limit and now() - g.window_start < make_interval(secs => s.global_window_seconds)
     from public.cafe_global g, public.cafe_settings s where g.id and s.id $$;

-- ------------------------------------------------------------------ student API (authenticated)
create or replace function public._cafe_pin_view(p public.cafe_pins) returns jsonb
language sql stable set search_path = '' as
$$ select jsonb_build_object('id', p.id, 'document_id', p.document_id,
     'status', case when p.status = 'active' and p.expires_at <= now() then 'expired' else p.status end,
     'created_at', p.created_at, 'expires_at', p.expires_at, 'redeemed_at', p.redeemed_at, 'revoked_at', p.revoked_at) $$;

create or replace function public.cafe_create_pin(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); s public.cafe_settings; v_pin text; v_row public.cafe_pins; v_con text; v_try int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public._is_verified(v_uid) then raise exception 'email_not_verified'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cafe_create:' || v_uid::text, 0));   -- one create at a time per student
  select * into s from public.cafe_settings where id;

  update public.cafe_pins set status = 'expired' where owner_id = v_uid and status = 'active' and expires_at <= now();

  if p_document_id is null or not exists (select 1 from public.documents where id = p_document_id and user_id = v_uid) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if not exists (select 1 from public.documents where id = p_document_id and user_id = v_uid and status = 'ready') then
    return jsonb_build_object('status', 'not_ready');
  end if;
  if not public._cafe_doc_ok(p_document_id, v_uid) then
    return jsonb_build_object('status', 'object_missing');
  end if;

  select * into v_row from public.cafe_pins where owner_id = v_uid and status = 'active';
  if found then return jsonb_build_object('status', 'active_exists', 'pin', public._cafe_pin_view(v_row), 'server_now', now()); end if;

  if (select count(*) from public.cafe_pins where owner_id = v_uid and created_at > now() - interval '1 hour') >= s.create_per_hour then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  loop
    v_try := v_try + 1;
    if v_try > 25 then raise exception 'pin_space_busy'; end if;
    v_pin := public._cafe_random_pin();
    begin
      insert into public.cafe_pins (owner_id, document_id, pin_hash, expires_at)
      values (v_uid, p_document_id, public._cafe_hash(v_pin), now() + make_interval(secs => s.ttl_seconds))
      returning * into v_row;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      if v_con = 'cafe_pins_active_hash_uq' then continue;                 -- collided with someone's live PIN: draw again
      elsif v_con = 'cafe_pins_active_owner_uq' then
        select * into v_row from public.cafe_pins where owner_id = v_uid and status = 'active';
        return jsonb_build_object('status', 'active_exists', 'pin', public._cafe_pin_view(v_row), 'server_now', now());
      else raise; end if;
    end;
  end loop;
  return jsonb_build_object('status', 'ok', 'pin_code', v_pin, 'pin', public._cafe_pin_view(v_row), 'server_now', now());
end $$;

create or replace function public.cafe_my_pins() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); s public.cafe_settings;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into s from public.cafe_settings where id;
  return jsonb_build_object('server_now', now(), 'pins', coalesce((
    select jsonb_agg(v order by (v->>'created_at') desc) from (
      select public._cafe_pin_view(p) || jsonb_build_object(
               'title', d.title,
               'document_available', (d.status = 'ready')) as v
        from public.cafe_pins p join public.documents d on d.id = p.document_id
       where p.owner_id = v_uid and p.created_at > now() - make_interval(days => s.history_days)
       order by p.created_at desc limit 50) q), '[]'::jsonb));
end $$;

create or replace function public.cafe_revoke_pin(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.cafe_pins;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.cafe_pins set status = 'revoked', revoked_at = now()
   where id = p_id and owner_id = v_uid and status = 'active' and expires_at > now()
  returning * into v_row;
  if found then return jsonb_build_object('status', 'revoked', 'pin', public._cafe_pin_view(v_row)); end if;
  if exists (select 1 from public.cafe_pins where id = p_id and owner_id = v_uid) then return jsonb_build_object('status', 'not_active'); end if;
  return jsonb_build_object('status', 'not_found');
end $$;

-- ------------------------------------------------------------------ cafe API (service role only, called by /api/cafe/*)
create or replace function public.cafe_redeem(p_pin text, p_ip bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_wait int; v_row public.cafe_pins; v_receipt text; s public.cafe_settings; d public.documents;
begin
  v_wait := public._cafe_throttle(p_ip);
  if v_wait > 0 then return jsonb_build_object('status', 'rate_limited', 'retry_after', v_wait); end if;
  if public._cafe_global_blocked() then return jsonb_build_object('status', 'rate_limited', 'retry_after', 60); end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    perform public._cafe_record_failure(p_ip);
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into s from public.cafe_settings where id;
  v_receipt := public._cafe_random_token();

  -- THE atomic claim. Under concurrency the loser re-evaluates "status = 'active'" after the winner commits and gets no row.
  update public.cafe_pins p
     set status = 'redeemed', redeemed_at = now(),
         receipt_hash = sha256(convert_to(v_receipt, 'UTF8')),
         receipt_expires_at = now() + make_interval(secs => s.receipt_ttl_seconds), receipt_uses = 0
   where p.pin_hash = public._cafe_hash(p_pin) and p.status = 'active' and p.expires_at > now()
     and public._cafe_doc_ok(p.document_id, p.owner_id)
  returning p.* into v_row;

  if not found then
    perform public._cafe_record_failure(p_ip);
    return jsonb_build_object('status', 'invalid');            -- same answer for unknown / expired / revoked / used / unavailable
  end if;
  select * into d from public.documents where id = v_row.document_id;
  return jsonb_build_object('status', 'ok', 'storage_path', d.storage_path, 'title', d.title, 'mime_type', d.mime_type,
                            'receipt', v_receipt, 'receipt_ttl', s.receipt_ttl_seconds);
end $$;

-- Retry after a failed download: same document, never re-opens the PIN. Limited by lifetime, use count and the flood gate.
create or replace function public.cafe_refresh(p_receipt text, p_ip bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_wait int; v_row public.cafe_pins; s public.cafe_settings; d public.documents;
begin
  v_wait := public._cafe_throttle(p_ip);
  if v_wait > 0 then return jsonb_build_object('status', 'rate_limited', 'retry_after', v_wait); end if;
  if p_receipt is null or p_receipt !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status', 'invalid'); end if;
  select * into s from public.cafe_settings where id;
  update public.cafe_pins p set receipt_uses = receipt_uses + 1
   where p.receipt_hash = sha256(convert_to(p_receipt, 'UTF8')) and p.status = 'redeemed'
     and p.receipt_expires_at > now() and p.receipt_uses < s.receipt_max_uses
     and public._cafe_doc_ok(p.document_id, p.owner_id)
  returning p.* into v_row;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  select * into d from public.documents where id = v_row.document_id;
  return jsonb_build_object('status', 'ok', 'storage_path', d.storage_path, 'title', d.title, 'mime_type', d.mime_type,
                            'refreshes_left', s.receipt_max_uses - v_row.receipt_uses);
end $$;

-- Housekeeping: run daily by /api/cafe/cleanup (Vercel cron) or, optionally, pg_cron.
create or replace function public.cafe_cleanup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.cafe_settings; n_exp int; n_pins int; n_att int;
begin
  select * into s from public.cafe_settings where id;
  update public.cafe_pins set status = 'expired' where status = 'active' and expires_at <= now();
  get diagnostics n_exp = row_count;
  update public.cafe_pins set receipt_hash = null, receipt_expires_at = null
   where receipt_hash is not null and (receipt_expires_at is null or receipt_expires_at <= now());
  delete from public.cafe_pins where status <> 'active' and created_at < now() - make_interval(days => s.history_days);
  get diagnostics n_pins = row_count;
  delete from public.cafe_attempts
   where updated_at < now() - greatest(make_interval(secs => s.ip_window_seconds), interval '1 hour')
     and (locked_until is null or locked_until <= now());
  get diagnostics n_att = row_count;
  return jsonb_build_object('expired', n_exp, 'pins_deleted', n_pins, 'attempt_rows_deleted', n_att);
end $$;

-- ------------------------------------------------------------------ privileges
revoke all on public.cafe_settings, public.cafe_pins, public.cafe_attempts, public.cafe_global from public, anon, authenticated, service_role;
-- Students read only non-secret columns of their own rows. pin_hash, receipt_* are not readable.
grant select (id, document_id, status, created_at, expires_at, redeemed_at, revoked_at) on public.cafe_pins to authenticated;

do $$ declare f text; begin
  foreach f in array array['_cafe_hash(text)', '_cafe_random_pin()', '_cafe_random_token()', '_cafe_doc_ok(uuid,uuid)', '_cafe_throttle(bytea)',
    '_cafe_record_failure(bytea)', '_cafe_global_blocked()', '_cafe_pin_view(public.cafe_pins)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
  end loop;
  foreach f in array array['cafe_create_pin(uuid)', 'cafe_my_pins()', 'cafe_revoke_pin(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('revoke all on function public.%s from service_role', f);
  end loop;
  foreach f in array array['cafe_redeem(text,bytea)', 'cafe_refresh(text,bytea)', 'cafe_cleanup()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
