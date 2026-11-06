\set ON_ERROR_STOP off
\set ON_ERROR_ROLLBACK on
\pset pager off
-- Cafe Print (0004) tests against REAL PostgreSQL. now() is frozen inside one transaction, so time travel is done by
-- rewriting timestamps as the superuser (exactly what "time passing" does to the rows).
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

-- helpers
create or replace function mk(p_uid text, p_doc text) returns jsonb language sql as
$$ select t_json('authenticated', p_uid::uuid, format('select public.cafe_create_pin(%L)', p_doc)) $$;
create or replace function redeem(p_pin text, p_ip text) returns jsonb language sql as
$$ select t_json('service_role', null, format($q$select public.cafe_redeem(%L, sha256(convert_to(%L,'UTF8')))$q$, p_pin, p_ip)) $$;
create or replace function refresh(p_rc text, p_ip text) returns jsonb language sql as
$$ select t_json('service_role', null, format($q$select public.cafe_refresh(%L, sha256(convert_to(%L,'UTF8')))$q$, p_rc, p_ip)) $$;
create or replace function revoke_pin(p_uid uuid, p_id uuid) returns jsonb language sql as
$$ select t_json('authenticated', p_uid, format('select public.cafe_revoke_pin(%L)', p_id)) $$;
create or replace function mkdoc(p_uid uuid, p_status text, p_object boolean default true) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_path text;
begin
  v_path := p_uid::text || '/' || v_id::text;
  insert into public.documents(id,user_id,status,title,original_name,mime_type,declared_size,size_bytes,storage_path)
    values (v_id,p_uid,p_status,'Doc '||left(v_id::text,4),'f.pdf','application/pdf',100,case when p_status='ready' then 100 end,v_path);
  if p_object then insert into storage.objects(bucket_id,name,owner,metadata) values ('documents',v_path,p_uid,'{"size":100,"mimetype":"application/pdf"}'); end if;
  return v_id;
end $$;
create or replace function reset_limits() returns void language sql as $$
  update public.cafe_settings set ttl_seconds=600, create_per_hour=12, ip_req_per_min=30, ip_fail_limit=5, ip_window_seconds=900, ip_lock_seconds=900,
    global_fail_limit=120, global_window_seconds=3600, receipt_ttl_seconds=300, receipt_max_uses=3;
  delete from public.cafe_attempts; update public.cafe_global set fail_count=0, window_start=now(); $$;
-- a fresh active PIN for user/doc; returns the plaintext code (clears any previous live pin first)
create or replace function newpin(p_uid text, p_doc text) returns text language plpgsql as $$
declare j jsonb;
begin
  update public.cafe_pins set status='expired' where owner_id=p_uid::uuid and status='active';
  update public.cafe_pins set created_at = created_at - interval '2 hours' where owner_id=p_uid::uuid and created_at > now() - interval '1 hour';  -- keep the hourly create cap out of unrelated tests
  j := mk(p_uid, p_doc);
  if j->>'status' <> 'ok' then return 'ERR:' || j::text; end if;
  return j->>'pin_code';
end $$;

begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com',now()),
 ('bbbbbbbb-0000-0000-0000-000000000002','b@x.com',now()),
 ('cccccccc-0000-0000-0000-000000000003','c@x.com',null),
 ('dddddddd-0000-0000-0000-000000000004','d@x.com',now());
insert into ctx values ('ADOC', mkdoc('aaaaaaaa-0000-0000-0000-000000000001','ready')),
                       ('BDOC', mkdoc('bbbbbbbb-0000-0000-0000-000000000002','ready')),
                       ('PEND', mkdoc('aaaaaaaa-0000-0000-0000-000000000001','pending')),
                       ('FAILD', mkdoc('aaaaaaaa-0000-0000-0000-000000000001','failed')),
                       ('DELD', mkdoc('aaaaaaaa-0000-0000-0000-000000000001','deleting')),
                       ('NOOBJ', mkdoc('aaaaaaaa-0000-0000-0000-000000000001','ready', false));
create or replace function c(p text) returns text language sql as $$ select v from ctx where k=p $$;

-- ===== privileges =====
select t_check('anon: no access to cafe tables or functions',
  t_try('anon',null,'select * from public.cafe_pins') ilike '%permission denied%'
  and t_try('anon',null,'select * from public.cafe_attempts') ilike '%permission denied%'
  and t_try('anon',null,'select * from public.cafe_settings') ilike '%permission denied%'
  and t_try('anon',null,'select public.cafe_my_pins()') ilike '%permission denied%'
  and t_try('anon',null,'select public.cafe_create_pin(gen_random_uuid())') ilike '%permission denied%'
  and t_try('anon',null,$$select public.cafe_redeem('123456', sha256('x'::bytea))$$) ilike '%permission denied%'
  and t_try('anon',null,$$select public.cafe_refresh(repeat('a',64), sha256('x'::bytea))$$) ilike '%permission denied%');
select t_check('authenticated (a logged-in student) cannot call redeem / refresh / cleanup / internals',
  t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.cafe_redeem('123456', sha256('x'::bytea))$$) ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.cafe_refresh(repeat('a',64), sha256('x'::bytea))$$) ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select public.cafe_cleanup()') ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public._cafe_hash('123456')$$) ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select public._cafe_random_pin()') ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select public._cafe_throttle(sha256(''x''::bytea))') ilike '%permission denied%');
select t_check('service_role cannot call student functions; cannot read tables directly',
  t_try('service_role',null,'select public.cafe_my_pins()') ilike '%permission denied%'
  and t_try('service_role',null,'select * from public.cafe_pins') ilike '%permission denied%'
  and t_try('service_role',null,'select pepper from public.cafe_settings') ilike '%permission denied%');
select t_check('students cannot read the pepper/settings/attempts or write pins directly',
  t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select pepper from public.cafe_settings') ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select * from public.cafe_attempts') ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select * from public.cafe_global') ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',format($$insert into public.cafe_pins(owner_id,document_id,pin_hash,expires_at) values ('aaaaaaaa-0000-0000-0000-000000000001',%L,sha256('x'::bytea),now()+interval '1 day')$$,c('ADOC'))) ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$update public.cafe_pins set status='active'$$) ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$delete from public.cafe_pins$$) ilike '%permission denied%');
select t_check('students cannot read pin_hash / receipt columns directly',
  t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select pin_hash from public.cafe_pins') ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select receipt_hash from public.cafe_pins') ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select * from public.cafe_pins') ilike '%permission denied%'
  and t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select id,status,expires_at from public.cafe_pins')='OK');
select t_check('all four cafe tables have RLS enabled', (select count(*) from pg_class where relname in ('cafe_pins','cafe_attempts','cafe_global','cafe_settings') and relrowsecurity)=4);

-- ===== creation =====
select reset_limits();
insert into ctx values ('j1', mk('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC'))::text);
select t_check('create: ready cloud document -> ok with a 6-digit PIN', (c('j1')::jsonb)->>'status'='ok' and (c('j1')::jsonb)->>'pin_code' ~ '^[0-9]{6}$');
select t_check('create: expiry is exactly 10 minutes of DATABASE time',
  (select expires_at - created_at = interval '600 seconds' and created_at = now() from public.cafe_pins where id = ((c('j1')::jsonb)->'pin'->>'id')::uuid));
select t_check('create: only a salted hash is stored (no plaintext, not a bare sha256)',
  (select pin_hash = public._cafe_hash((c('j1')::jsonb)->>'pin_code') and pin_hash <> sha256(convert_to((c('j1')::jsonb)->>'pin_code','UTF8')) from public.cafe_pins where id = ((c('j1')::jsonb)->'pin'->>'id')::uuid)
  and not exists (select 1 from public.cafe_pins p where to_jsonb(p)::text like '%'||((c('j1')::jsonb)->>'pin_code')||'"%'));
select t_check('create: pin is bound to owner and document', (select owner_id='aaaaaaaa-0000-0000-0000-000000000001' and document_id=c('ADOC')::uuid and status='active' from public.cafe_pins where id = ((c('j1')::jsonb)->'pin'->>'id')::uuid));
insert into ctx values ('j2', mk('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC'))::text);
select t_check('create: second request while one is live -> active_exists, PIN not re-shown, still one row',
  (c('j2')::jsonb)->>'status'='active_exists' and not (c('j2')::jsonb ? 'pin_code') and (c('j2')::jsonb)->'pin'->>'id' = (c('j1')::jsonb)->'pin'->>'id'
  and (select count(*) from public.cafe_pins where owner_id='aaaaaaaa-0000-0000-0000-000000000001' and status='active')=1);
select t_check('create: same answer even for a DIFFERENT document while one is live (one live PIN per student)',
  (select count(*) from public.cafe_pins where owner_id='aaaaaaaa-0000-0000-0000-000000000001' and status='active')=1);
select t_check('create: pending / failed / deleting uploads are rejected',
  mk('bbbbbbbb-0000-0000-0000-000000000002', c('PEND'))->>'status'='not_found'  -- not B's
  and (select count(*) from public.cafe_pins where document_id in (c('PEND')::uuid,c('FAILD')::uuid,c('DELD')::uuid))=0);
update public.cafe_pins set status='expired' where owner_id='aaaaaaaa-0000-0000-0000-000000000001';
select t_check('create: pending upload -> not_ready', mk('aaaaaaaa-0000-0000-0000-000000000001', c('PEND'))->>'status'='not_ready');
select t_check('create: failed upload -> not_ready', mk('aaaaaaaa-0000-0000-0000-000000000001', c('FAILD'))->>'status'='not_ready');
select t_check('create: document being deleted -> not_ready', mk('aaaaaaaa-0000-0000-0000-000000000001', c('DELD'))->>'status'='not_ready');
select t_check('create: ready row but object missing from the bucket -> object_missing', mk('aaaaaaaa-0000-0000-0000-000000000001', c('NOOBJ'))->>'status'='object_missing');
select t_check('create: unknown document -> not_found', mk('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid()::text)->>'status'='not_found');
select t_check('create: someone else''s document -> not_found (no PIN row created)',
  mk('bbbbbbbb-0000-0000-0000-000000000002', c('ADOC'))->>'status'='not_found'
  and (select count(*) from public.cafe_pins where owner_id='bbbbbbbb-0000-0000-0000-000000000002')=0);
select t_check('create: null document id -> not_found', mk('aaaaaaaa-0000-0000-0000-000000000001', null)->>'status'='not_found');
select t_check('create: unauthenticated and unverified users rejected',
  t_json('authenticated',null,format('select public.cafe_create_pin(%L)',c('ADOC')))->>'error' like '%not_authenticated%'
  and t_json('authenticated','cccccccc-0000-0000-0000-000000000003',format('select public.cafe_create_pin(%L)',c('ADOC')))->>'error' like '%email_not_verified%');
select t_check('create: client cannot choose owner (function takes only a document id; owner comes from auth.uid)',
  (select pronargs=1 from pg_proc where proname='cafe_create_pin'));

-- create after revoke / after expiry
select reset_limits();
update public.cafe_pins set status='expired' where status='active';
insert into ctx values ('j3', mk('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC'))::text);
select t_check('create: new PIN allowed once previous is not live', (c('j3')::jsonb)->>'status'='ok');
insert into ctx values ('rv1', revoke_pin('aaaaaaaa-0000-0000-0000-000000000001', (((c('j3')::jsonb)->'pin'->>'id')::uuid))::text);
select t_check('revoke: owner revokes live PIN immediately', (c('rv1')::jsonb)->>'status'='revoked'
  and (select status='revoked' and revoked_at is not null from public.cafe_pins where id=(((c('j3')::jsonb)->'pin'->>'id')::uuid)));
select t_check('revoke: second revoke -> not_active; unknown id -> not_found',
  revoke_pin('aaaaaaaa-0000-0000-0000-000000000001', (((c('j3')::jsonb)->'pin'->>'id')::uuid))->>'status'='not_active'
  and revoke_pin('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid())->>'status'='not_found');
insert into ctx values ('j4', mk('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC'))::text);
select t_check('create: new PIN allowed after revoke, and differs in row id', (c('j4')::jsonb)->>'status'='ok' and (c('j4')::jsonb)->'pin'->>'id' <> (c('j3')::jsonb)->'pin'->>'id');
select t_check('revoke: another student cannot revoke it', revoke_pin('bbbbbbbb-0000-0000-0000-000000000002', (((c('j4')::jsonb)->'pin'->>'id')::uuid))->>'status'='not_found'
  and (select status='active' from public.cafe_pins where id=(((c('j4')::jsonb)->'pin'->>'id')::uuid)));
update public.cafe_pins set created_at=now()-interval '11 minutes', expires_at=now()-interval '1 minute' where id=(((c('j4')::jsonb)->'pin'->>'id')::uuid);
select t_check('revoke: cannot revoke an already expired PIN', revoke_pin('aaaaaaaa-0000-0000-0000-000000000001', (((c('j4')::jsonb)->'pin'->>'id')::uuid))->>'status'='not_active');
insert into ctx values ('j5', mk('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC'))::text);
select t_check('create: new PIN allowed after the previous one expired; stale row is marked expired',
  (c('j5')::jsonb)->>'status'='ok' and (select status='expired' from public.cafe_pins where id=(((c('j4')::jsonb)->'pin'->>'id')::uuid)));
select t_check('history: expired live-looking PIN reads as expired even before cleanup',
  (select public._cafe_pin_view(p)->>'status'='expired' from public.cafe_pins p where id=(((c('j4')::jsonb)->'pin'->>'id')::uuid)));

-- create rate limit
select reset_limits();
update public.cafe_pins set status='expired' where status='active';
update public.cafe_settings set create_per_hour = (select count(*)+1 from public.cafe_pins where owner_id='aaaaaaaa-0000-0000-0000-000000000001' and created_at > now()-interval '1 hour');
select t_check('create: per-student hourly cap allows up to the cap', mk('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC'))->>'status'='ok');
update public.cafe_pins set status='expired' where status='active';
select t_check('create: ...then answers rate_limited', mk('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC'))->>'status'='rate_limited');
select reset_limits();

-- ===== redemption =====
insert into ctx values ('P1', newpin('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')));
select t_check('redeem: valid PIN from a different, anonymous client (service role, no student JWT) succeeds',
  redeem(c('P1'),'cafe-pc-1')->>'status'='ok');
select reset_limits();
insert into ctx values ('P2', newpin('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')));
insert into ctx values ('R2', redeem(c('P2'),'cafe-pc-2')::text);
select t_check('redeem: returns exactly the owner''s document path, mime, title and a receipt; no owner/user info',
  (c('R2')::jsonb)->>'storage_path' = 'aaaaaaaa-0000-0000-0000-000000000001/' || c('ADOC')
  and (c('R2')::jsonb)->>'mime_type'='application/pdf' and (c('R2')::jsonb)->>'receipt' ~ '^[0-9a-f]{64}$'
  and not ((c('R2')::jsonb) ? 'owner_id') and not ((c('R2')::jsonb) ? 'user_id') and not ((c('R2')::jsonb) ? 'document_id'));
select t_check('redeem: PIN row is now redeemed with a timestamp', (select status='redeemed' and redeemed_at is not null from public.cafe_pins where pin_hash=public._cafe_hash(c('P2')) and status='redeemed' limit 1));
select t_check('redeem: SECOND use of the same PIN fails (one-time)', redeem(c('P2'),'cafe-pc-3')->>'status'='invalid');
select t_check('redeem: receipt is stored only hashed', exists (select 1 from public.cafe_pins where receipt_hash = sha256(convert_to((c('R2')::jsonb)->>'receipt','UTF8')) and status='redeemed'));

-- invalid classes are indistinguishable
select reset_limits();
insert into ctx values ('PX', newpin('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')));
insert into ctx values ('PB', newpin('bbbbbbbb-0000-0000-0000-000000000002', c('BDOC')));
update public.cafe_pins set created_at=now()-interval '11 minutes', expires_at=now()-interval '1 second' where pin_hash=public._cafe_hash(c('PX')) and status='active';
select t_check('redeem: expired PIN rejected', redeem(c('PX'),'cafe-pc-4')->>'status'='invalid');
insert into ctx values ('PR', newpin('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')));
select t_check('redeem: revoked PIN rejected', (
  select (revoke_pin('aaaaaaaa-0000-0000-0000-000000000001', (select id from public.cafe_pins where pin_hash=public._cafe_hash(c('PR')) and status='active'))->>'status')='revoked'
     and redeem(c('PR'),'cafe-pc-5')->>'status'='invalid'));
select t_check('redeem: malformed PIN (5 digits, 7 digits, letters, empty, null, SQL-ish) rejected',
  redeem('12345','cafe-pc-6')->>'status'='invalid' and redeem('1234567','cafe-pc-6')->>'status'='invalid'
  and redeem('12a456','cafe-pc-6')->>'status'='invalid' and redeem('','cafe-pc-6')->>'status'='invalid'
  and redeem($$1' or '1'='1$$,'cafe-pc-6')->>'status'='invalid');
select t_check('redeem: unknown PIN, a PIN of ANOTHER student that is no longer valid and a revoked PIN give byte-identical answers',
  redeem('000000','cafe-pc-7') = redeem(c('PR'),'cafe-pc-7') and redeem('000000','cafe-pc-7') = redeem(c('P2'),'cafe-pc-7')
  and redeem('000000','cafe-pc-7') = jsonb_build_object('status','invalid'));
select reset_limits();
update public.documents set status='deleting' where id=c('BDOC')::uuid;
select t_check('redeem: document deleted after PIN creation -> rejected, no signed path', redeem(c('PB'),'cafe-pc-8')->>'status'='invalid');
update public.documents set status='ready' where id=c('BDOC')::uuid;
delete from storage.objects where name='bbbbbbbb-0000-0000-0000-000000000002/'||c('BDOC');
select t_check('redeem: object removed from the bucket after PIN creation -> rejected', redeem(c('PB'),'cafe-pc-9')->>'status'='invalid');
insert into storage.objects(bucket_id,name,owner,metadata) values ('documents','bbbbbbbb-0000-0000-0000-000000000002/'||c('BDOC'),'bbbbbbbb-0000-0000-0000-000000000002','{"size":100}');
select t_check('redeem: failed attempts did not burn a still-valid PIN (it works once the document is back)', redeem(c('PB'),'cafe-pc-10')->>'status'='ok');
select t_check('cross-user isolation: PIN of B opens B''s document only',
  redeem(newpin('bbbbbbbb-0000-0000-0000-000000000002', c('BDOC')),'cafe-pc-11')->>'storage_path' like 'bbbbbbbb-0000-0000-0000-000000000002/%');
insert into public.cafe_pins(owner_id,document_id,pin_hash,expires_at) values ('bbbbbbbb-0000-0000-0000-000000000002', c('ADOC')::uuid, public._cafe_hash('424242'), now()+interval '5 minutes');
select t_check('redeem: a PIN row whose document belongs to someone else can never be redeemed (defence in depth)', redeem('424242','cafe-pc-12')->>'status'='invalid');
delete from public.cafe_pins where pin_hash=public._cafe_hash('424242');

-- ===== throttling =====
select reset_limits();
insert into ctx values ('PL', newpin('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')));
select t_check('lockout: 5 wrong guesses from one client are answered "invalid"',
  (select bool_and(redeem(lpad(g::text,6,'1'),'atk-1')->>'status'='invalid') from generate_series(1,5) g));
select t_check('lockout: afterwards even the CORRECT PIN is refused with rate_limited + retry_after',
  (select j->>'status'='rate_limited' and (j->>'retry_after')::int > 0 from (select redeem(c('PL'),'atk-1') j) q));
select t_check('lockout: the refused PIN was not consumed', (select status='active' from public.cafe_pins where pin_hash=public._cafe_hash(c('PL')) and status='active'));
select t_check('lockout: a different client is unaffected and can redeem it', redeem(c('PL'),'cafe-clean')->>'status'='ok');
select reset_limits();
insert into ctx values ('PLK', newpin('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')));
select (select bool_and(redeem('11111'||g,'lk')->>'status'='invalid') from generate_series(1,5) g);
select t_check('lockout: client is locked', redeem(c('PLK'),'lk')->>'status'='rate_limited');
update public.cafe_attempts set locked_until = now() - interval '1 second' where ip_hash=sha256(convert_to('lk','UTF8'));
select t_check('lockout: ends after the cool-down; the same client can then redeem', redeem(c('PLK'),'lk')->>'status'='ok');
select reset_limits();
insert into ctx values ('PM', newpin('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')));
-- success must NOT reset the failure counter
select t_check('counters: 4 failures, 1 success, then 1 more failure -> locked (success never resets failures)', (
  select bool_and(redeem(lpad(g::text,6,'2'),'atk-2')->>'status'='invalid') from generate_series(1,4) g)
  and redeem(c('PM'),'atk-2')->>'status'='ok'
  and redeem('999999','atk-2')->>'status'='invalid'
  and redeem('999998','atk-2')->>'status'='rate_limited');
select t_check('counters: a client cannot reset counters (no function or table access)',
  t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','update public.cafe_attempts set fail_count=0') ilike '%permission denied%'
  and t_try('anon',null,'delete from public.cafe_attempts') ilike '%permission denied%'
  and t_try('service_role',null,'update public.cafe_attempts set fail_count=0') ilike '%permission denied%');
select t_check('counters: lock sets locked_until ~15 min ahead in DATABASE time', (select locked_until = now() + interval '900 seconds' from public.cafe_attempts where ip_hash=sha256(convert_to('atk-2','UTF8'))));
-- flood
select reset_limits();
update public.cafe_settings set ip_req_per_min = 3;
select t_check('flood: 3 requests/min allowed, the 4th is rate_limited (even for garbage input)',
  redeem('abc','fl')->>'status'='invalid' and redeem('abc','fl')->>'status'='invalid' and redeem('abc','fl')->>'status'='invalid'
  and redeem('abc','fl')->>'status'='rate_limited');
update public.cafe_attempts set req_window_start = now() - interval '61 seconds';
select t_check('flood: window rolls over after 60s', redeem('abc','fl')->>'status'='invalid');
update public.cafe_attempts set req_count = 99 where ip_hash=sha256(convert_to('fl','UTF8'));
select t_check('flood: refresh endpoint shares the flood gate', refresh(repeat('a',64),'fl')->>'status'='rate_limited');
select reset_limits();
-- global ceiling (distributed guessing): many clients, few guesses each
update public.cafe_settings set global_fail_limit = 6;
insert into ctx values ('PG', newpin('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')));
select t_check('distributed: 6 failures spread over 6 different clients', (select bool_and(redeem('777777','dist-'||g)->>'status'='invalid') from generate_series(1,6) g));
select t_check('distributed: global ceiling now refuses everyone, even a brand-new client with the correct PIN (fail-closed)',
  redeem(c('PG'),'dist-new')->>'status'='rate_limited');
update public.cafe_global set window_start = now() - interval '2 hours';
select t_check('distributed: ceiling lifts when its window ends', redeem(c('PG'),'dist-new2')->>'status'='ok');
select reset_limits();

-- ===== receipts: retry after a failed download =====
insert into ctx values ('PRC', newpin('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')));
insert into ctx values ('RC', (redeem(c('PRC'),'rc-1')->>'receipt'));
select t_check('receipt: refresh returns the SAME document again, up to the cap (3), then stops', 
  refresh(c('RC'),'rc-1')->>'storage_path' = 'aaaaaaaa-0000-0000-0000-000000000001'||'/'||c('ADOC')
  and refresh(c('RC'),'rc-1')->>'status'='ok' and refresh(c('RC'),'rc-1')->>'refreshes_left'='0'
  and refresh(c('RC'),'rc-1')->>'status'='invalid');
select t_check('receipt: PIN is still NOT reusable after refreshes', redeem(c('PRC'),'rc-2')->>'status'='invalid');
select reset_limits();
insert into ctx values ('PRC2', newpin('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')));
insert into ctx values ('RC2', (redeem(c('PRC2'),'rc-3')->>'receipt'));
select t_check('receipt: wrong / malformed / null receipt rejected',
  refresh(repeat('0',64),'rc-3')->>'status'='invalid' and refresh('nothex','rc-3')->>'status'='invalid' and refresh(null,'rc-3')->>'status'='invalid');
select t_check('receipt: a PIN is not a receipt', refresh(c('PRC2'),'rc-3')->>'status'='invalid');
update public.cafe_pins set receipt_expires_at = now() - interval '1 second' where receipt_hash = sha256(convert_to(c('RC2'),'UTF8'));
select t_check('receipt: expires with its own short lifetime', refresh(c('RC2'),'rc-3')->>'status'='invalid');
update public.cafe_pins set receipt_expires_at = now() + interval '5 minutes' where receipt_hash = sha256(convert_to(c('RC2'),'UTF8'));
update public.documents set status='deleting' where id=c('ADOC')::uuid;
select t_check('receipt: refused once the document is deleted', refresh(c('RC2'),'rc-3')->>'status'='invalid');
update public.documents set status='ready' where id=c('ADOC')::uuid;

-- ===== concurrency inside one session is covered by tests/db/cafe_concurrency.sh (real parallel connections) =====

-- ===== my_pins / isolation =====
select reset_limits();
update public.cafe_pins set status='expired' where status='active';
insert into ctx values ('MA', mk('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC'))::text);
select t_check('my_pins: student sees only own PINs, with status and title, and NO secret fields', (
  with m as (select t_json('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select public.cafe_my_pins()') j)
  select jsonb_array_length(j->'pins') >= 3
     and not exists (select 1 from jsonb_array_elements(j->'pins') e where e ? 'pin_hash' or e ? 'receipt_hash' or e ? 'pin_code' or e ? 'owner_id')
     and (j->>'server_now') is not null from m));
select t_check('my_pins: another student sees none of them', jsonb_array_length(t_json('authenticated','dddddddd-0000-0000-0000-000000000004','select public.cafe_my_pins()')->'pins')=0
  and t_count('authenticated','bbbbbbbb-0000-0000-0000-000000000002','select id from public.cafe_pins') = (select count(*) from public.cafe_pins where owner_id='bbbbbbbb-0000-0000-0000-000000000002')
  and t_count('authenticated','bbbbbbbb-0000-0000-0000-000000000002',format('select id from public.cafe_pins where id in (select id from public.cafe_pins) and status=%L','active')) <= 1);
select t_check('my_pins: direct SELECT through RLS sees only own rows', t_count('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select id,status from public.cafe_pins') = (select count(*) from public.cafe_pins where owner_id='aaaaaaaa-0000-0000-0000-000000000001'));
select t_check('my_pins: requires a session', t_json('authenticated',null,'select public.cafe_my_pins()')->>'error' like '%not_authenticated%');

-- ===== randomness =====
create temp table rnd as select public._cafe_random_pin() p from generate_series(1,20000);
select t_check('random: every PIN is exactly 6 digits', (select bool_and(p ~ '^[0-9]{6}$') from rnd));
select t_check('random: leading zeros occur (PINs are zero-padded, not 100000-999999)', (select count(*) > 1000 from rnd where p like '0%'));
select t_check('random: each leading digit appears ~2000x of 20000 (within 6 sigma)', (select bool_and(n between 1700 and 2300) and count(*)=10 from (select left(p,1), count(*) n from rnd group by 1) q));
select t_check('random: each last digit also uniform', (select bool_and(n between 1700 and 2300) and count(*)=10 from (select right(p,1), count(*) n from rnd group by 1) q));
select t_check('random: no obvious repetition (>= 19000 distinct of 20000)', (select count(distinct p) >= 19000 from rnd));
select t_check('random: successive PINs differ in distribution of consecutive pairs (no sequential counter)', (select count(*) < 200 from (select p, lag(p) over () l from rnd) q where abs(p::int - l::int) = 1));

-- ===== cleanup =====
select reset_limits();
update public.cafe_pins set status='expired' where status='active';
insert into ctx values ('CL', newpin('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')));
update public.cafe_pins set created_at=now()-interval '11 minutes', expires_at=now()-interval '1 minute' where status='active';
insert into public.cafe_pins(owner_id,document_id,pin_hash,status,created_at,expires_at) values ('aaaaaaaa-0000-0000-0000-000000000001', c('ADOC')::uuid, sha256('old'::bytea),'expired',now()-interval '30 days',now()-interval '30 days'+interval '10 minutes');
insert into public.cafe_attempts(ip_hash,updated_at) values (sha256('stale'::bytea), now()-interval '3 days');
select t_check('cleanup: only service_role may run it', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select public.cafe_cleanup()') ilike '%permission denied%' and t_try('anon',null,'select public.cafe_cleanup()') ilike '%permission denied%');
insert into ctx values ('CR', t_json('service_role',null,'select public.cafe_cleanup()')::text);
select t_check('cleanup: marks lapsed PINs expired, deletes >7-day-old PIN rows and stale throttle rows',
  (c('CR')::jsonb->>'expired')::int >= 1 and (c('CR')::jsonb->>'pins_deleted')::int >= 1 and (c('CR')::jsonb->>'attempt_rows_deleted')::int >= 1
  and not exists (select 1 from public.cafe_pins where status='active' and expires_at <= now())
  and not exists (select 1 from public.cafe_pins where created_at < now()-interval '7 days'));
update public.cafe_pins set receipt_hash=sha256(convert_to('r'||id::text,'UTF8')), receipt_expires_at=now()-interval '1 minute' where status='redeemed';
select public.cafe_cleanup();
select t_check('cleanup: strips lapsed receipts', not exists (select 1 from public.cafe_pins where receipt_hash is not null and receipt_expires_at <= now()));

-- ===== lifecycle cascades =====
insert into ctx values ('XD', mkdoc('aaaaaaaa-0000-0000-0000-000000000001','ready'));
insert into public.cafe_pins(owner_id,document_id,pin_hash,expires_at) values ('aaaaaaaa-0000-0000-0000-000000000001', c('XD')::uuid, sha256('cascade'::bytea), now()+interval '5 min');
delete from public.documents where id=c('XD')::uuid;
select t_check('deleting a document cascades its PIN rows', not exists (select 1 from public.cafe_pins where document_id=c('XD')::uuid));
delete from auth.users where id='aaaaaaaa-0000-0000-0000-000000000001';
select t_check('deleting a user cascades all their PINs', not exists (select 1 from public.cafe_pins where owner_id='aaaaaaaa-0000-0000-0000-000000000001'));

-- ===== collisions (last: it replaces the PIN generator inside this rolled-back transaction) =====
select reset_limits();
update public.cafe_pins set status='expired' where status='active';
create temp table rndcnt(n int); insert into rndcnt values (0); grant all on rndcnt to public;
insert into auth.users(id,email,email_confirmed_at) values ('eeeeeeee-0000-0000-0000-000000000005','e@x.com',now());
insert into ctx values ('EDOC', mkdoc('eeeeeeee-0000-0000-0000-000000000005','ready'));
insert into public.cafe_pins(owner_id,document_id,pin_hash,expires_at) values ('bbbbbbbb-0000-0000-0000-000000000002', c('BDOC')::uuid, public._cafe_hash('555555'), now()+interval '5 minutes');
create or replace function public._cafe_random_pin() returns text language plpgsql volatile set search_path = '' as $f$
begin update rndcnt set n = n + 1; if (select n from rndcnt) <= 2 then return '555555'; end if; return '123123'; end $f$;
insert into ctx values ('CO', mk('eeeeeeee-0000-0000-0000-000000000005', c('EDOC'))::text);
select t_check('collision: PIN equal to ANOTHER student''s live PIN is silently redrawn (never reissued, no error)',
  (c('CO')::jsonb)->>'status'='ok' and (c('CO')::jsonb)->>'pin_code'='123123' and (select n from rndcnt)=3);
select t_check('collision: unique index forbids two live PINs with one hash',
  t_try('postgres',null, format('insert into public.cafe_pins(owner_id,document_id,pin_hash,expires_at) values (%L,%L,public._cafe_hash(%L),now()+interval ''1 hour'')','dddddddd-0000-0000-0000-000000000004',c('BDOC'),'555555')) ilike '%cafe_pins_active_hash_uq%');

select 'PASS ' || name from results where ok order by name;
select 'FAIL ' || name from results where not ok order by name;
select 'TOTAL ' || count(*) filter (where ok) || '/' || count(*) from results;
rollback;
