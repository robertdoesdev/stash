-- TEST ONLY: minimal stand-in for Supabase Storage's schema (buckets, objects, RLS, foldername).
-- ASSUMPTION encoded here (verify on a real project): once an upload completes, storage.objects.metadata
-- contains {"size": <bytes>, "mimetype": "<type>"}.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as
$$ select string_to_array(name, '/') $$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;   -- Supabase grants these; RLS decides
grant select on storage.buckets to authenticated;
grant all on storage.objects, storage.buckets to service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
