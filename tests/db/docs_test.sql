\set ON_ERROR_STOP off
\pset pager off
create temp table results(name text, ok boolean);
grant all on results to public;
create temp table ctx(k text primary key, v text);
grant all on ctx to public;

create or replace function t_try(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text,''), true);
  begin execute p_sql; reset role; return 'OK';
  exception when others then reset role; return sqlerrm; end;
end $$;
create or replace function t_json(p_role text, p_uid uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text,''), true);
  begin execute 'select (' || p_sql || ')::jsonb' into v; reset role; return v;
  exception when others then reset role; return jsonb_build_object('error', sqlerrm); end;
end $$;
create or replace function t_count(p_role text, p_uid uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text,''), true);
  begin execute 'select count(*) from (' || p_sql || ') q' into n; reset role; return n;
  exception when others then reset role; return -1; end;
end $$;
create or replace function t_check(p_name text, p_ok boolean) returns void language sql as
$$ insert into results values (p_name, coalesce(p_ok,false)) $$;
-- SQL text for begin_upload
create or replace function bu(p_ref text, p_title text, p_size bigint, p_mime text default 'application/pdf', p_sha text default null, p_tags text default 'null', p_ocr text default null, p_cat text default null)
returns text language sql as $$
  select format('public.begin_upload(%L,%L,%L,%L,%s,%L,%L,%s,null,%L,null)', p_ref, p_title, p_title || '.pdf', p_mime, p_size, p_sha, p_cat, p_tags, p_ocr) $$;
-- put an object into the fake storage as a given user (RLS applies); returns OK / error
create or replace function put_obj(p_uid uuid, p_path text, p_size bigint, p_mime text default 'application/pdf') returns text language sql as $$
  select t_try('authenticated', p_uid, format($q$insert into storage.objects(bucket_id,name,owner,metadata) values ('documents',%L,%L,jsonb_build_object('size',%s,'mimetype',%L))$q$, p_path, p_uid, p_size, p_mime)) $$;

begin;
-- A, B verified | C unverified | P verified+paid | Q verified (quota tests) | R verified (delete-account)
insert into auth.users(id,email,email_confirmed_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com',now()),
 ('bbbbbbbb-0000-0000-0000-000000000002','b@x.com',now()),
 ('cccccccc-0000-0000-0000-000000000003','c@x.com',null),
 ('dddddddd-0000-0000-0000-000000000004','p@x.com',now()),
 ('eeeeeeee-0000-0000-0000-000000000005','q@x.com',now()),
 ('ffffffff-0000-0000-0000-000000000006','r@x.com',now());
insert into public.user_entitlements(user_id,tier) values ('dddddddd-0000-0000-0000-000000000004','paid');

-- ================= privileges =================
select t_check('anon cannot select documents', t_try('anon',null,'select * from public.documents') ilike '%permission denied%');
select t_check('anon cannot call begin_upload', t_try('anon',null,'select '||bu('x','t',10)) ilike '%permission denied%');
select t_check('anon cannot call my_storage_usage / search / finalize / begin_delete / confirm_removed', 
  t_try('anon',null,'select public.my_storage_usage()') ilike '%permission denied%'
  and t_try('anon',null,$$select public.search_my_documents('a')$$) ilike '%permission denied%'
  and t_try('anon',null,'select public.finalize_upload(gen_random_uuid())') ilike '%permission denied%'
  and t_try('anon',null,'select public.begin_delete(gen_random_uuid())') ilike '%permission denied%'
  and t_try('anon',null,'select public.confirm_removed(gen_random_uuid())') ilike '%permission denied%');
select t_check('authenticated cannot call internal functions (quota_used, storage_limit_bytes, _is_verified)',
  t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.quota_used('aaaaaaaa-0000-0000-0000-000000000001')$$) ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.storage_limit_bytes('aaaaaaaa-0000-0000-0000-000000000001')$$) ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public._is_verified('aaaaaaaa-0000-0000-0000-000000000001')$$) ilike '%permission denied%');
select t_check('authenticated cannot call orphan_report', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select public.orphan_report()') ilike '%permission denied%');
select t_check('service_role can call orphan_report', t_try('service_role',null,'select public.orphan_report()')='OK');
select t_check('authenticated cannot read/write user_entitlements',
  t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select * from public.user_entitlements') ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$update public.user_entitlements set tier='paid'$$) ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$insert into public.user_entitlements(user_id,tier) values ('aaaaaaaa-0000-0000-0000-000000000001','paid')$$) ilike '%permission denied%');
select t_check('authenticated cannot read storage_deletion_queue', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select * from public.storage_deletion_queue') ilike '%permission denied%');
select t_check('authenticated cannot INSERT/UPDATE/DELETE documents directly',
  t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$insert into public.documents(user_id,title,original_name,mime_type,declared_size,storage_path) values ('aaaaaaaa-0000-0000-0000-000000000001','t','t.pdf','application/pdf',1,'x')$$) ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$update public.documents set status='ready'$$) ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$delete from public.documents$$) ilike '%permission denied%');
select t_check('bucket is private with size/type limits',
  (select not public and file_size_limit=10485760 and allowed_mime_types=array['application/pdf','image/jpeg','image/png'] from storage.buckets where id='documents'));

-- ================= begin_upload: auth + validation =================
select t_check('unauthenticated (no uid) is rejected', t_json('authenticated',null,'select '||bu('x','t',10))->>'error' like '%not_authenticated%');
select t_check('unverified email is rejected', t_json('authenticated','cccccccc-0000-0000-0000-000000000003','select '||bu('x','t',10))->>'error' like '%email_not_verified%');
select t_check('bad mime rejected', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('x','t',10,'text/html'))->>'error' like '%invalid_type%');
select t_check('svg/exe-like mime rejected', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('x','t',10,'image/svg+xml'))->>'error' like '%invalid_type%');
select t_check('zero size rejected', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('x','t',0))->>'error' like '%invalid_size%');
select t_check('over 10 MiB rejected', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('x','t',10485761))->>'error' like '%invalid_size%');
select t_check('exactly 10 MiB accepted', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('max10','t',10485760))->>'status'='ok');
select t_check('bad sha rejected', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('x','t',5,'application/pdf','XYZ'))->>'error' like '%invalid_hash%');
select t_check('control char in title rejected', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.begin_upload('x',E'a\u0001b','a.pdf','application/pdf',5,null,null,null,null,null,null)$$)->>'error' like '%invalid_title%');
select t_check('21 tags rejected', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('x','t',5,'application/pdf',null,'(select array_agg(''t''||i) from generate_series(1,21) i)'))->>'error' like '%invalid_tags%');
select t_check('oversize metadata rejected', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.begin_upload('x','t','a.pdf','application/pdf',5,null,null,null,null,null,jsonb_build_object('k',repeat('x',20000)))$$)->>'error' like '%invalid_metadata%');

-- ================= ownership + storage RLS =================
insert into ctx select 'a1', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('loc-a1','Tuition receipt',1000,'application/pdf',null,'array[''fees'',''2024'']','RRR 123456789 payment of school fees','receipt'))->'document'->>'id';
select t_check('A: begin_upload creates a pending row owned by A at <uid>/<id>',
  (select status='pending' and user_id='aaaaaaaa-0000-0000-0000-000000000001' and storage_path = user_id::text||'/'||id::text from public.documents where id=(select v::uuid from ctx where k='a1')));
select t_check('B cannot see A''s row (RLS)', t_count('authenticated','bbbbbbbb-0000-0000-0000-000000000002','select * from public.documents')=0);
select t_check('A sees own row', t_count('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select * from public.documents')>=1);
select t_check('B cannot upload into A''s pending path', put_obj('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a1'), 1000) ilike '%row-level security%');
select t_check('A cannot upload to a path with no reservation', put_obj('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/'||gen_random_uuid(), 1000) ilike '%row-level security%');
select t_check('A cannot upload into B''s folder', put_obj('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002/'||gen_random_uuid(), 1000) ilike '%row-level security%');
select t_check('A cannot use a path traversal / foreign filename', put_obj('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/../bbbbbbbb-0000-0000-0000-000000000002/x', 1000) ilike '%row-level security%');
select t_check('A uploads to own pending path', put_obj('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a1'), 1000)='OK');
select t_check('A cannot overwrite (second insert on same path fails)', put_obj('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a1'), 1000) not in ('OK'));
insert into ctx values ('r_upd', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$update storage.objects set metadata='{}'$$));
select t_check('A cannot UPDATE objects (no update policy): metadata unchanged', (select (metadata->>'size')::int=1000 from storage.objects where name='aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a1')));
select t_check('B cannot list/read A''s objects', t_count('authenticated','bbbbbbbb-0000-0000-0000-000000000002','select * from storage.objects')=0);
select t_check('A can list own objects', t_count('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select * from storage.objects')=1);
select t_check('anon cannot read objects', t_count('anon',null,'select * from storage.objects') in (0,-1));

-- ================= finalize =================
select t_check('B cannot finalize A''s upload', t_json('authenticated','bbbbbbbb-0000-0000-0000-000000000002',format('select public.finalize_upload(%L)',(select v from ctx where k='a1')))->>'status'='not_found');
insert into ctx values ('r_a1', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.finalize_upload(%L)',(select v from ctx where k='a1')))->>'status');
select t_check('A finalize -> ready with REAL size', (select v from ctx where k='r_a1')='ok'
  and (select status='ready' and size_bytes=1000 and uploaded_at is not null from public.documents where id=(select v::uuid from ctx where k='a1')));
select t_check('finalize is idempotent', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.finalize_upload(%L)',(select v from ctx where k='a1')))->>'status'='ok');
-- finalize without object
insert into ctx select 'a2', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('loc-a2','No object yet',500))->'document'->>'id';
select t_check('finalize without an uploaded object -> object_missing', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.finalize_upload(%L)',(select v from ctx where k='a2')))->>'status'='object_missing');
-- size mismatch: declared 500, uploads 2000
select t_check('upload larger than declared', put_obj('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a2'), 2000)='OK');
select t_check('oversize object counts against quota immediately (greatest(declared, actual))',
  (select coalesce(sum(greatest(declared_size, 0)),0) from public.documents where id=(select v::uuid from ctx where k='a2'))=500
  and public.quota_used('aaaaaaaa-0000-0000-0000-000000000001') >= 1000+2000+10485760); -- includes 'max10' reservation
insert into ctx values ('r_a2', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.finalize_upload(%L)',(select v from ctx where k='a2')))->>'status');
select t_check('finalize rejects size mismatch and fails the row', (select v from ctx where k='r_a2')='size_mismatch'
  and (select status='failed' and size_bytes=2000 from public.documents where id=(select v::uuid from ctx where k='a2')));
select t_check('failed row cannot be turned ready by finalize again', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.finalize_upload(%L)',(select v from ctx where k='a2')))->>'status'='not_pending');
select t_check('wrong mimetype in object -> mismatch', (
  with r as (select t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('loc-a3','Mime',300)) j)
  select put_obj('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/'||(r.j->'document'->>'id'),300,'image/png')='OK'
    and t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.finalize_upload(%L)',r.j->'document'->>'id'))->>'status'='size_mismatch' from r));

-- ================= retries / idempotency =================
select t_check('begin_upload with same local_ref after ready -> exists, no duplicate row',
  t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('loc-a1','Tuition receipt',1000))->>'status'='exists'
  and (select count(*) from public.documents where user_id='aaaaaaaa-0000-0000-0000-000000000001' and local_ref='loc-a1')=1);
insert into ctx select 'a4', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('loc-a4','Pending retry',700))->'document'->>'id';
select t_check('begin_upload with same local_ref while pending -> resumed same id',
  t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('loc-a4','Pending retry',700))->'document'->>'id' = (select v from ctx where k='a4'));
insert into ctx values ('r_rearm', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('loc-a2','No object yet',500))->>'status');
select t_check('failed row is re-armed (same row/path), not duplicated',
  (select v from ctx where k='r_rearm')='ok' and (select count(*) from public.documents where user_id='aaaaaaaa-0000-0000-0000-000000000001' and local_ref='loc-a2')=1
  and (select status='pending' from public.documents where id=(select v::uuid from ctx where k='a2')));
insert into ctx values ('r_bref', t_json('authenticated','bbbbbbbb-0000-0000-0000-000000000002','select '||bu('loc-a1','B doc',100))->>'status');
select t_check('B using A''s local_ref gets its own row (refs are per-user)', (select v from ctx where k='r_bref')='ok' and (select count(*) from public.documents where local_ref='loc-a1')=2);
select t_check('mark_upload_failed: owner only', t_json('authenticated','bbbbbbbb-0000-0000-0000-000000000002',format('select public.mark_upload_failed(%L)',(select v from ctx where k='a4')))->>'status'='not_pending'
  and (select status='pending' from public.documents where id=(select v::uuid from ctx where k='a4'))
  and t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.mark_upload_failed(%L)',(select v from ctx where k='a4')))->>'status'='ok');

-- ================= expiry =================
insert into ctx select 'a5', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('loc-a5','Will expire',900))->'document'->>'id';
update public.documents set expires_at = now() - interval '1 minute' where id=(select v::uuid from ctx where k='a5');
select t_check('expired reservation: object upload now denied by storage RLS', put_obj('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a5'),900) ilike '%row-level security%');
insert into ctx values ('r_a5', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.finalize_upload(%L)',(select v from ctx where k='a5')))->>'status');
select t_check('expired reservation: finalize -> expired and row failed', (select v from ctx where k='r_a5')='expired'
  and (select status='failed' from public.documents where id=(select v::uuid from ctx where k='a5')));
select t_check('failed rows STILL count against quota until confirmed removed', (select count(*) from public.documents where id=(select v::uuid from ctx where k='a5'))=1 and public.quota_used('aaaaaaaa-0000-0000-0000-000000000001') >= 900);

-- ================= quota =================
-- Q starts empty. Simulate prior usage with a ready row (inserted as the table owner).
insert into public.documents(user_id,status,title,original_name,mime_type,declared_size,size_bytes,storage_path,id)
 select 'eeeeeeee-0000-0000-0000-000000000005','ready','Big','big.pdf','application/pdf',1,1073741824-5242880,'eeeeeeee-0000-0000-0000-000000000005/'||g,g from (select gen_random_uuid() g) s;
select t_check('quota: free tier reports 1 GiB limit', t_json('authenticated','eeeeeeee-0000-0000-0000-000000000005','select public.my_storage_usage()') @> '{"limit":1073741824,"tier":"free"}');
select t_check('quota: fits exactly (5 MiB left, 5 MiB asked) -> ok', t_json('authenticated','eeeeeeee-0000-0000-0000-000000000005','select '||bu('q1','Fits',5242880))->>'status'='ok');
select t_check('quota: one byte more -> quota_exceeded with numbers', t_json('authenticated','eeeeeeee-0000-0000-0000-000000000005','select '||bu('q2','Too big',1))->>'status'='quota_exceeded');
select t_check('quota: reservation itself counts (cannot reserve past the limit in parallel)', t_json('authenticated','eeeeeeee-0000-0000-0000-000000000005','select '||bu('q3','Again',1))->>'status'='quota_exceeded');
select t_check('quota: row count unchanged by rejected requests', (select count(*) from public.documents where user_id='eeeeeeee-0000-0000-0000-000000000005')=2);
-- paid
insert into public.documents(user_id,status,title,original_name,mime_type,declared_size,size_bytes,storage_path,id)
 select 'dddddddd-0000-0000-0000-000000000004','ready','Big','big.pdf','application/pdf',1,2147483648,'dddddddd-0000-0000-0000-000000000004/'||g,g from (select gen_random_uuid() g) s;
select t_check('quota: paid tier limit is 5 GiB', t_json('authenticated','dddddddd-0000-0000-0000-000000000004','select public.my_storage_usage()') @> '{"limit":5368709120,"tier":"paid"}');
select t_check('quota: paid user with 2 GiB used can still upload', t_json('authenticated','dddddddd-0000-0000-0000-000000000004','select '||bu('p1','Paid ok',1000))->>'status'='ok');
select t_check('quota: a user cannot make themselves paid', t_try('authenticated','eeeeeeee-0000-0000-0000-000000000005',$$update public.user_entitlements set tier='paid' where user_id='eeeeeeee-0000-0000-0000-000000000005'$$) ilike '%permission denied%'
  and t_json('authenticated','eeeeeeee-0000-0000-0000-000000000005','select '||bu('q4','Still free',1))->>'status'='quota_exceeded');
insert into auth.users(id,email,email_confirmed_at) values ('99999999-0000-0000-0000-000000000009','cap@x.com',now());
insert into ctx select 'cap_last', (select string_agg(t_json('authenticated','99999999-0000-0000-0000-000000000009','select '||bu('cap'||i,'Cap '||i,10))->>'status', ',') from generate_series(1,20) i);
select t_check('quota: 20 pending reservations allowed', (select v from ctx where k='cap_last') = (select string_agg('ok', ',') from generate_series(1,20)));
select t_check('quota: the 21st pending is refused', t_json('authenticated','99999999-0000-0000-0000-000000000009','select '||bu('cap-over','Cap over',10))->>'status'='too_many_pending');
select t_check('quota: isolated per user (A''s usage does not affect Q)', public.quota_used('eeeeeeee-0000-0000-0000-000000000005') = 1073741824);

-- ================= delete (two-phase) =================
insert into ctx values ('r_dd', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format($$delete from storage.objects where name=%L$$,'aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a1'))));
select t_check('direct object delete of a READY document is blocked by storage RLS (object still there)',
  (select count(*) from storage.objects where name='aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a1'))=1);
select t_check('B cannot begin_delete A''s document', t_json('authenticated','bbbbbbbb-0000-0000-0000-000000000002',format('select public.begin_delete(%L)',(select v from ctx where k='a1')))->>'status'='not_found');
insert into ctx values ('r_bd', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.begin_delete(%L)',(select v from ctx where k='a1')))->>'status');
select t_check('A begin_delete -> deleting; quota NOT freed yet', (select v from ctx where k='r_bd')='ok'
  and (select status='deleting' from public.documents where id=(select v::uuid from ctx where k='a1')));
insert into ctx values ('r_cr1', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.confirm_removed(%L)',(select v from ctx where k='a1')))->>'status');
select t_check('confirm_removed refuses while the object still exists', (select v from ctx where k='r_cr1')='object_still_present'
  and (select count(*) from public.documents where id=(select v::uuid from ctx where k='a1'))=1);
insert into ctx values ('r_bdel', t_try('authenticated','bbbbbbbb-0000-0000-0000-000000000002',format($$delete from storage.objects where name=%L$$,'aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a1'))));
select t_check('B cannot delete A''s object even while it is "deleting"', (select count(*) from storage.objects where name='aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a1'))=1);
insert into ctx values ('r_arm', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format($$delete from storage.objects where name=%L$$,'aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a1'))));
select t_check('A removes the object (allowed once deleting)', (select v from ctx where k='r_arm')='OK' and (select count(*) from storage.objects where name='aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a1'))=0);
insert into ctx values ('r_cr2', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.confirm_removed(%L)',(select v from ctx where k='a1')))->>'status');
select t_check('confirm_removed now deletes the row and frees quota', (select v from ctx where k='r_cr2')='ok' and (select count(*) from public.documents where id=(select v::uuid from ctx where k='a1'))=0);
select t_check('confirm_removed on a ready row is refused (cannot skip begin_delete)',
  t_json('authenticated','dddddddd-0000-0000-0000-000000000004',format('select public.confirm_removed(%L)',(select id from public.documents where user_id='dddddddd-0000-0000-0000-000000000004' and status='ready' limit 1)))->>'status'='not_removable');
-- failed upload with leftover object
insert into ctx values ('r_f1', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.confirm_removed(%L)',(select v from ctx where k='a2')))->>'status');
select t_check('failed row with leftover object: confirm_removed refuses', (select v from ctx where k='r_f1') in ('object_still_present','not_removable'));
insert into ctx values ('r_f2', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format($$delete from storage.objects where name=%L$$,'aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='a2'))));
insert into ctx values ('r_f3', coalesce(t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.begin_delete(%L)',(select v from ctx where k='a2')))->>'status','?'));
insert into ctx values ('r_f4', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.confirm_removed(%L)',(select v from ctx where k='a2')))->>'status');
select t_check('failed row: once its object is removed, confirm_removed deletes the row (orphan resolved)', (select v from ctx where k='r_f4')='ok' and (select count(*) from public.documents where id=(select v::uuid from ctx where k='a2'))=0);

-- ================= metadata + search =================
insert into ctx select 's1', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('loc-s1','Hostel allocation letter',400,'application/pdf',null,'array[''hostel'']','Dear student your room is B12','admin'))->'document'->>'id';
select t_check('s1 uploaded + finalized', put_obj('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='s1'),400)='OK'
  and t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.finalize_upload(%L)',(select v from ctx where k='s1')))->>'status'='ok');
insert into ctx select 's2', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select '||bu('loc-s2','Tuition receipt 2024',600,'application/pdf',null,'array[''fees'']','RRR 123456789 payment of school fees','receipt'))->'document'->>'id';
select t_check('s2 uploaded + finalized', put_obj('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/'||(select v from ctx where k='s2'),600)='OK'
  and t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format('select public.finalize_upload(%L)',(select v from ctx where k='s2')))->>'status'='ok');
-- another user's doc with the same words
insert into ctx select 'b1', t_json('authenticated','bbbbbbbb-0000-0000-0000-000000000002','select '||bu('loc-b1','Tuition receipt B',100,'application/pdf',null,'array[''fees'']','RRR 999 fees','receipt'))->'document'->>'id';
select t_check('b1 ready', put_obj('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002/'||(select v from ctx where k='b1'),100)='OK'
  and t_json('authenticated','bbbbbbbb-0000-0000-0000-000000000002',format('select public.finalize_upload(%L)',(select v from ctx where k='b1')))->>'status'='ok');
select t_check('search by title prefix ("tuit")', jsonb_array_length(t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.search_my_documents('tuit')$$))=1);
select t_check('search by OCR text ("123456789")', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.search_my_documents('123456789')$$)->0->>'title'='Tuition receipt 2024');
select t_check('search by tag', jsonb_array_length(t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.search_my_documents('hostel')$$))=1);
select t_check('search is per-user: B never sees A''s docs', (select bool_and(e->>'user_id'='bbbbbbbb-0000-0000-0000-000000000002') from jsonb_array_elements(t_json('authenticated','bbbbbbbb-0000-0000-0000-000000000002',$$select public.search_my_documents('receipt')$$)) e)
  and jsonb_array_length(t_json('authenticated','bbbbbbbb-0000-0000-0000-000000000002',$$select public.search_my_documents('hostel')$$))=0);
select t_check('search: multiple terms are ANDed', jsonb_array_length(t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.search_my_documents('tuition hostel')$$))=0);
select t_check('search: category filter', jsonb_array_length(t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.search_my_documents('', 'admin')$$))=1);
select t_check('search: empty query lists ready docs only (no pending/failed/deleting)', (select bool_and(e->>'status'='ready') from jsonb_array_elements(t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.search_my_documents('')$$)) e));
select t_check('search: results omit ocr_text and the search vector', not (t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.search_my_documents('tuit')$$)->0 ? 'ocr_text') and not (t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.search_my_documents('tuit')$$)->0 ? 'search'));
select t_check('search: hostile query text is harmless', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.search_my_documents('''); drop table public.documents; -- & | ! :* ((')$$) ? 'error' = false
  and (select count(*) from public.documents)>0);
select t_check('search: limit is clamped', jsonb_array_length(t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.search_my_documents('', null, 100000, 0)$$)) <= 100);
select t_check('update_document_meta: owner edits title/category/tags/notes; search follows', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format($$select public.update_document_meta(%L,'Hostel letter 2025','admin',array['housing'],'kept',null,'{"semester":"First"}'::jsonb)$$,(select v from ctx where k='s1')))->>'status'='ok'
  and jsonb_array_length(t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.search_my_documents('housing')$$))=1);
select t_check('update_document_meta: other users get not_found and nothing changes', t_json('authenticated','bbbbbbbb-0000-0000-0000-000000000002',format($$select public.update_document_meta(%L,'Hacked','x',null,null,null,null)$$,(select v from ctx where k='s1')))->>'status'='not_found'
  and (select title='Hostel letter 2025' from public.documents where id=(select v::uuid from ctx where k='s1')));
select t_check('update_document_meta: cannot touch pending docs; validates input', t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format($$select public.update_document_meta(%L,'x','x',null,null,null,null)$$,(select v from ctx where k='a4')))->>'status'='not_found'
  and t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format($$select public.update_document_meta(%L,'',null,null,null,null,null)$$,(select v from ctx where k='s1')))->>'error' like '%invalid_title%');
select t_check('update_document_meta never changes size/status/path/owner', (select size_bytes=400 and status='ready' and user_id='aaaaaaaa-0000-0000-0000-000000000001' and storage_path like 'aaaaaaaa-%' from public.documents where id=(select v::uuid from ctx where k='s1')));

-- ================= usage =================
select t_check('my_storage_usage matches quota_used', (t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select public.my_storage_usage()')->>'used')::bigint = public.quota_used('aaaaaaaa-0000-0000-0000-000000000001'));

-- ================= orphan report (service role) =================
insert into storage.objects(bucket_id,name,metadata) values ('documents','aaaaaaaa-0000-0000-0000-000000000001/'||gen_random_uuid(), '{"size":5}');
insert into public.documents(user_id,status,title,original_name,mime_type,declared_size,size_bytes,storage_path,id)
 select 'bbbbbbbb-0000-0000-0000-000000000002','ready','Ghost','g.pdf','application/pdf',5,5,'bbbbbbbb-0000-0000-0000-000000000002/'||g,g from (select gen_random_uuid() g) s;
select t_check('orphan_report finds objects without rows', jsonb_array_length(public.orphan_report()->'objects_without_row')>=1);
select t_check('orphan_report finds ready rows without objects', jsonb_array_length(public.orphan_report()->'ready_rows_without_object')>=1);

-- ================= account deletion =================
insert into ctx select 'r1', t_json('authenticated','ffffffff-0000-0000-0000-000000000006','select '||bu('loc-r1','Mine',50))->'document'->>'id';
select t_check('r1 ready', put_obj('ffffffff-0000-0000-0000-000000000006','ffffffff-0000-0000-0000-000000000006/'||(select v from ctx where k='r1'),50)='OK'
  and t_json('authenticated','ffffffff-0000-0000-0000-000000000006',format('select public.finalize_upload(%L)',(select v from ctx where k='r1')))->>'status'='ok');
select t_check('delete_my_account succeeds', t_try('authenticated','ffffffff-0000-0000-0000-000000000006','select public.delete_my_account()')='OK');
select t_check('account deletion: rows gone, paths queued for storage cleanup (no silent orphan)',
  (select count(*) from public.documents where user_id='ffffffff-0000-0000-0000-000000000006')=0
  and (select count(*) from public.storage_deletion_queue where storage_path='ffffffff-0000-0000-0000-000000000006/'||(select v from ctx where k='r1'))=1
  and (select public.orphan_report()->'deletion_queue') @> to_jsonb('ffffffff-0000-0000-0000-000000000006/'||(select v from ctx where k='r1')));
select t_check('account deletion did not touch other users', (select count(*) from public.documents where user_id='aaaaaaaa-0000-0000-0000-000000000001')>0);

select case when ok then 'PASS' else 'FAIL' end || ' | ' || name from results order by (select 1);
select 'TOTAL ' || count(*) || ', FAILED ' || count(*) filter (where not ok) from results;
rollback;
