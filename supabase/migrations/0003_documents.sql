-- Stash Phase 3: private document storage, metadata, server-side quota.
-- Apply AFTER 0001 and 0002. Idempotent. NOT applied to any live project by this repository.
--
-- Model
--   * Files live in a PRIVATE Storage bucket "documents" at  <user_id>/<document_id>  (no user-chosen path).
--   * public.documents holds metadata. Browsers can only SELECT their own rows; every write goes through
--     the SECURITY DEFINER functions below, which enforce ownership, validation and quota.
--   * Upload is two-phase:  begin_upload (reserves quota, creates a 'pending' row)
--                        -> client uploads the object (Storage RLS only allows the exact pending path)
--                        -> finalize_upload (reads the REAL object size from storage.objects; 'ready' or 'failed').
--   * Delete is two-phase: begin_delete ('deleting') -> client removes the object -> confirm_removed (row deleted
--     only when the object is really gone). Quota is freed only then, so quota can't be dodged by half-deleting.
--   * Failed / expired uploads keep counting against quota until the object is verified gone.
--
-- Assumptions to verify on a real project (see docs/SETUP_PHASE3.md): storage.objects.metadata->>'size' and
-- ->>'mimetype' are populated once an upload completes; the postgres role may create policies on storage.objects.

-- ------------------------------------------------------------------ tables
-- Who is on which tier. Written ONLY by an administrator / the future payment backend (service role). Absent row = free.
create table if not exists public.user_entitlements (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  tier       text not null default 'free' check (tier in ('free', 'paid')),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  local_ref     text,
  status        text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'deleting')),
  title         text not null,
  original_name text not null,
  mime_type     text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  declared_size bigint not null check (declared_size > 0 and declared_size <= 10485760),
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  sha256        text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  category      text,
  tags          text[] not null default '{}',
  notes         text,
  ocr_text      text,
  metadata      jsonb not null default '{}'::jsonb,
  storage_path  text not null unique,
  search        tsvector,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  uploaded_at   timestamptz,
  expires_at    timestamptz,
  constraint documents_title_len   check (char_length(title) between 1 and 200 and title !~ '[[:cntrl:]]'),
  constraint documents_name_len    check (char_length(original_name) between 1 and 255 and original_name !~ '[[:cntrl:]]'),
  constraint documents_tags_len    check (cardinality(tags) <= 20),
  constraint documents_notes_len   check (notes is null or char_length(notes) <= 5000),
  constraint documents_ocr_len     check (ocr_text is null or char_length(ocr_text) <= 200000),
  constraint documents_category_len check (category is null or char_length(category) <= 60),
  constraint documents_meta_obj    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 16384),
  constraint documents_path_owner  check (storage_path = user_id::text || '/' || id::text)
);
create unique index if not exists documents_user_local_ref on public.documents (user_id, local_ref) where local_ref is not null;
create index if not exists documents_user_status on public.documents (user_id, status);
create index if not exists documents_user_created on public.documents (user_id, created_at desc);
create index if not exists documents_search on public.documents using gin (search);

-- Objects that must be removed from Storage by an administrator job (account deletion, etc.). Service role only.
create table if not exists public.storage_deletion_queue (
  id          bigint generated always as identity primary key,
  storage_path text not null unique,
  reason      text not null,
  queued_at   timestamptz not null default now()
);

alter table public.user_entitlements    enable row level security;
alter table public.documents            enable row level security;
alter table public.storage_deletion_queue enable row level security;
revoke all on public.user_entitlements     from public, anon, authenticated;
revoke all on public.storage_deletion_queue from public, anon, authenticated;
revoke all on public.documents              from public, anon, authenticated;
grant select on public.documents to authenticated;
drop policy if exists documents_select_own on public.documents;
create policy documents_select_own on public.documents for select to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------------ constants (in one place)
-- Free 1 GiB, paid 5 GiB (binary). Per-file cap 10 MiB = the existing client-side cap (data.json upload.maxFileSizeMB).
create or replace function public.storage_limit_bytes(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select case coalesce((select tier from public.user_entitlements where user_id = p_user), 'free')
           when 'paid' then 5368709120::bigint else 1073741824::bigint end
$$;

-- ------------------------------------------------------------------ search vector + updated_at
create or replace function public.documents_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search :=
    setweight(to_tsvector('simple', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.original_name, '') || ' ' || coalesce(new.category, '') || ' ' || array_to_string(new.tags, ' ')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.notes, '')), 'C') ||
    setweight(to_tsvector('simple', left(coalesce(new.ocr_text, ''), 100000)), 'D');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists documents_before_write on public.documents;
create trigger documents_before_write before insert or update on public.documents
  for each row execute function public.documents_before_write();

-- ------------------------------------------------------------------ quota
-- Bytes that count against the user: every row that may still have an object. For rows without a confirmed size the
-- larger of the declared size and the object actually present is used, so oversize uploads count immediately.
create or replace function public.quota_used(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(coalesce(d.size_bytes, greatest(d.declared_size,
           coalesce((select (o.metadata ->> 'size')::bigint from storage.objects o
                      where o.bucket_id = 'documents' and o.name = d.storage_path), 0)))), 0)::bigint
    from public.documents d where d.user_id = p_user
$$;

create or replace function public._is_verified(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null)
$$;

-- ------------------------------------------------------------------ validation helper
create or replace function public._clean_meta(p_title text, p_category text, p_tags text[], p_notes text, p_ocr text, p_meta jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare t text;
begin
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200 or p_title ~ '[[:cntrl:]]' then raise exception 'invalid_title'; end if;
  if p_category is not null and char_length(p_category) > 60 then raise exception 'invalid_category'; end if;
  if p_tags is not null then
    if cardinality(p_tags) > 20 then raise exception 'invalid_tags'; end if;
    foreach t in array p_tags loop
      if t is null or char_length(t) not between 1 and 40 or t ~ '[[:cntrl:]]' then raise exception 'invalid_tags'; end if;
    end loop;
  end if;
  if p_notes is not null and char_length(p_notes) > 5000 then raise exception 'invalid_notes'; end if;
  if p_ocr is not null and char_length(p_ocr) > 200000 then raise exception 'invalid_text'; end if;
  if p_meta is not null and (jsonb_typeof(p_meta) <> 'object' or octet_length(p_meta::text) > 16384) then raise exception 'invalid_metadata'; end if;
end $$;

-- ------------------------------------------------------------------ begin_upload
create or replace function public.begin_upload(
  p_local_ref text, p_title text, p_original_name text, p_mime text, p_size bigint, p_sha256 text,
  p_category text, p_tags text[], p_notes text, p_ocr_text text, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.documents;
  v_used bigint; v_limit bigint; v_pending int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public._is_verified(v_uid) then raise exception 'email_not_verified'; end if;
  if p_mime not in ('application/pdf', 'image/jpeg', 'image/png') then raise exception 'invalid_type'; end if;
  if p_size is null or p_size < 1 or p_size > 10485760 then raise exception 'invalid_size'; end if;
  if p_sha256 is not null and p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid_hash'; end if;
  if char_length(btrim(coalesce(p_original_name, ''))) not between 1 and 255 or p_original_name ~ '[[:cntrl:]]' then raise exception 'invalid_name'; end if;
  if p_local_ref is not null and char_length(p_local_ref) > 100 then raise exception 'invalid_local_ref'; end if;
  perform public._clean_meta(p_title, p_category, p_tags, p_notes, p_ocr_text, p_metadata);

  -- Expire abandoned reservations (they keep counting until their object is verified gone).
  update public.documents set status = 'failed', expires_at = null
   where user_id = v_uid and status = 'pending' and expires_at < now();

  -- Idempotent retry / resume by local_ref.
  if p_local_ref is not null then
    select * into v_row from public.documents where user_id = v_uid and local_ref = p_local_ref;
    if found then
      if v_row.status = 'ready'    then return jsonb_build_object('status', 'exists',   'document', to_jsonb(v_row)); end if;
      if v_row.status = 'deleting' then return jsonb_build_object('status', 'deleting', 'document', to_jsonb(v_row)); end if;
      if v_row.status = 'pending'  then return jsonb_build_object('status', 'ok', 'resumed', true, 'document', to_jsonb(v_row)); end if;
      -- failed: re-arm the SAME row/path (its old object may still exist; finalize validates it).
      v_used := public.quota_used(v_uid) - coalesce(v_row.size_bytes, v_row.declared_size);
      v_limit := public.storage_limit_bytes(v_uid);
      if v_used + p_size > v_limit then
        return jsonb_build_object('status', 'quota_exceeded', 'used', v_used, 'limit', v_limit);
      end if;
      update public.documents set status = 'pending', declared_size = p_size, size_bytes = null, sha256 = p_sha256,
             mime_type = p_mime, expires_at = now() + interval '1 hour'
       where id = v_row.id returning * into v_row;
      return jsonb_build_object('status', 'ok', 'resumed', true, 'document', to_jsonb(v_row));
    end if;
  end if;

  select count(*) into v_pending from public.documents where user_id = v_uid and status = 'pending';
  if v_pending >= 20 then return jsonb_build_object('status', 'too_many_pending'); end if;

  v_used := public.quota_used(v_uid); v_limit := public.storage_limit_bytes(v_uid);
  if v_used + p_size > v_limit then
    return jsonb_build_object('status', 'quota_exceeded', 'used', v_used, 'limit', v_limit);
  end if;

  v_row.id := gen_random_uuid();
  insert into public.documents (id, user_id, local_ref, status, title, original_name, mime_type, declared_size, sha256,
                                category, tags, notes, ocr_text, metadata, storage_path, expires_at)
  values (v_row.id, v_uid, p_local_ref, 'pending', btrim(p_title), p_original_name, p_mime, p_size, p_sha256,
          p_category, coalesce(p_tags, '{}'), p_notes, p_ocr_text, coalesce(p_metadata, '{}'::jsonb),
          v_uid::text || '/' || v_row.id::text, now() + interval '1 hour')
  returning * into v_row;
  return jsonb_build_object('status', 'ok', 'document', to_jsonb(v_row));
end $$;

-- ------------------------------------------------------------------ finalize_upload
create or replace function public.finalize_upload(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_row public.documents; v_obj record; v_size bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.documents where id = p_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.status = 'ready' then return jsonb_build_object('status', 'ok', 'document', to_jsonb(v_row)); end if;
  if v_row.status <> 'pending' then return jsonb_build_object('status', 'not_pending', 'document_status', v_row.status); end if;
  if v_row.expires_at < now() then
    update public.documents set status = 'failed', expires_at = null where id = v_row.id;
    return jsonb_build_object('status', 'expired');
  end if;

  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'documents' and o.name = v_row.storage_path;
  if not found or (v_obj.metadata ->> 'size') is null then return jsonb_build_object('status', 'object_missing'); end if;
  v_size := (v_obj.metadata ->> 'size')::bigint;

  if v_size <> v_row.declared_size or coalesce(v_obj.metadata ->> 'mimetype', v_row.mime_type) <> v_row.mime_type then
    update public.documents set status = 'failed', size_bytes = v_size, expires_at = null where id = v_row.id;
    return jsonb_build_object('status', 'size_mismatch', 'declared', v_row.declared_size, 'actual', v_size);
  end if;

  update public.documents set status = 'ready', size_bytes = v_size, uploaded_at = now(), expires_at = null
   where id = v_row.id returning * into v_row;
  return jsonb_build_object('status', 'ok', 'document', to_jsonb(v_row));
end $$;

-- Client gives up on an upload (after retries). Row becomes 'failed'; the object (if any) must still be removed.
create or replace function public.mark_upload_failed(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); n int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.documents set status = 'failed', expires_at = null where id = p_id and user_id = v_uid and status = 'pending';
  get diagnostics n = row_count;
  return jsonb_build_object('status', case when n = 1 then 'ok' else 'not_pending' end);
end $$;

-- ------------------------------------------------------------------ delete (two-phase)
create or replace function public.begin_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.documents;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.documents set status = 'deleting', expires_at = null
   where id = p_id and user_id = v_uid returning * into v_row;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok', 'storage_path', v_row.storage_path);
end $$;

-- Deletes the row (and so frees quota) ONLY when the object is verifiably absent from Storage.
create or replace function public.confirm_removed(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.documents;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.documents where id = p_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.status not in ('deleting', 'failed') then return jsonb_build_object('status', 'not_removable', 'document_status', v_row.status); end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = v_row.storage_path) then
    return jsonb_build_object('status', 'object_still_present');
  end if;
  delete from public.documents where id = v_row.id;
  return jsonb_build_object('status', 'ok');
end $$;

-- ------------------------------------------------------------------ metadata edits (organisation)
create or replace function public.update_document_meta(
  p_id uuid, p_title text, p_category text, p_tags text[], p_notes text, p_ocr_text text, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.documents;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public._clean_meta(p_title, p_category, p_tags, p_notes, p_ocr_text, p_metadata);
  update public.documents set title = btrim(p_title), category = p_category, tags = coalesce(p_tags, '{}'),
         notes = p_notes, ocr_text = p_ocr_text, metadata = coalesce(p_metadata, '{}'::jsonb)
   where id = p_id and user_id = v_uid and status = 'ready' returning * into v_row;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok', 'document', to_jsonb(v_row));
end $$;

-- ------------------------------------------------------------------ usage + search
create or replace function public.my_storage_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object(
    'used', public.quota_used(v_uid), 'limit', public.storage_limit_bytes(v_uid),
    'tier', coalesce((select tier from public.user_entitlements where user_id = v_uid), 'free'),
    'documents', (select count(*) from public.documents where user_id = v_uid and status = 'ready'));
end $$;

create or replace function public.search_my_documents(p_query text, p_category text default null, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_terms text[]; v_q tsquery; v_res jsonb;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100); v_off int := greatest(coalesce(p_offset, 0), 0);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select array_agg(t) into v_terms from (
    select t from regexp_split_to_table(lower(left(coalesce(p_query, ''), 200)), '[^[:alnum:]]+') t where t <> '' limit 8) s;
  if v_terms is not null then
    v_q := to_tsquery('simple', (select string_agg(t || ':*', ' & ') from unnest(v_terms) t));
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) - 'search' - 'ocr_text'), '[]'::jsonb) into v_res from (
    select d.* from public.documents d
     where d.user_id = v_uid and d.status = 'ready'
       and (p_category is null or d.category = p_category)
       and (v_q is null or d.search @@ v_q)
     order by case when v_q is null then 0 else ts_rank(d.search, v_q) end desc, d.created_at desc
     limit v_limit offset v_off) r;
  return v_res;
end $$;

-- ------------------------------------------------------------------ account deletion must not orphan files
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  insert into public.storage_deletion_queue (storage_path, reason)
    select storage_path, 'account_deleted' from public.documents where user_id = v_uid
    on conflict (storage_path) do nothing;
  delete from auth.users where id = v_uid;
end $$;

-- ------------------------------------------------------------------ operator report (service role / postgres only)
create or replace function public.orphan_report() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'objects_without_row', coalesce((select jsonb_agg(o.name) from storage.objects o
        where o.bucket_id = 'documents'
          and not exists (select 1 from public.documents d where d.storage_path = o.name)), '[]'::jsonb),
    'ready_rows_without_object', coalesce((select jsonb_agg(d.id) from public.documents d
        where d.status = 'ready'
          and not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = d.storage_path)), '[]'::jsonb),
    'stale_failed_rows', coalesce((select jsonb_agg(d.id) from public.documents d
        where d.status in ('failed', 'deleting') and d.updated_at < now() - interval '1 day'), '[]'::jsonb),
    'deletion_queue', coalesce((select jsonb_agg(q.storage_path) from public.storage_deletion_queue q), '[]'::jsonb))
$$;

-- ------------------------------------------------------------------ Storage: private bucket + policies
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

drop policy if exists docs_select_own on storage.objects;
create policy docs_select_own on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- Upload only to the exact path of the caller's own live 'pending' reservation. No UPDATE policy: no overwrite/upsert.
drop policy if exists docs_insert_pending on storage.objects;
create policy docs_insert_pending on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and exists (
    select 1 from public.documents d
     where d.user_id = auth.uid() and d.storage_path = name and d.status = 'pending' and d.expires_at > now()));

-- Remove only objects of rows that are being deleted, failed, or still pending. A 'ready' file cannot be removed
-- directly, so quota can't be freed without going through begin_delete / confirm_removed.
drop policy if exists docs_delete_removable on storage.objects;
create policy docs_delete_removable on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and exists (
    select 1 from public.documents d
     where d.user_id = auth.uid() and d.storage_path = name and d.status in ('deleting', 'failed', 'pending')));

-- ------------------------------------------------------------------ privileges
revoke all on function public.storage_limit_bytes(uuid)       from public, anon, authenticated, service_role;
revoke all on function public.quota_used(uuid)                from public, anon, authenticated, service_role;
revoke all on function public._is_verified(uuid)              from public, anon, authenticated, service_role;
revoke all on function public._clean_meta(text, text, text[], text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.documents_before_write()        from public, anon, authenticated, service_role;
revoke all on function public.orphan_report()                 from public, anon, authenticated;
grant execute on function public.orphan_report()              to service_role;
do $$ declare f text; begin
  foreach f in array array[
    'begin_upload(text,text,text,text,bigint,text,text,text[],text,text,jsonb)', 'finalize_upload(uuid)',
    'mark_upload_failed(uuid)', 'begin_delete(uuid)', 'confirm_removed(uuid)',
    'update_document_meta(uuid,text,text,text[],text,text,jsonb)', 'my_storage_usage()',
    'search_my_documents(text,text,int,int)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
