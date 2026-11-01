\set ON_ERROR_STOP off
\pset pager off
create temp table results(name text, ok boolean);
grant all on results to public;

-- run a statement as (role, user); returns 'OK' or the error text
create or replace function t_try(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text,''), true);
  begin execute p_sql; reset role; return 'OK';
  exception when others then reset role; return sqlerrm; end;
end $$;
-- run a scalar query as (role,user); returns its text value or the error text
create or replace function t_val(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text,''), true);
  begin execute 'select (' || p_sql || ')::text' into v; reset role; return v;
  exception when others then reset role; return 'ERR:' || sqlerrm; end;
end $$;
create or replace function t_count(p_role text, p_uid uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text,''), true);
  execute 'select count(*) from (' || p_sql || ') q' into n; reset role; return n;
end $$;
create or replace function t_check(p_name text, p_ok boolean) returns void language sql as
$$ insert into results values (p_name, coalesce(p_ok,false)) $$;

begin;
-- A verified+complete metadata | B Google (name only) | C unverified | D verified, DUPLICATE matric metadata | E verified, INVALID metadata
-- U unverified with matric metadata (squatting attempt) | F verified, owns a matric | G verified, fresh (throttle test)
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com',now(),'{"full_name":"Ada Okafor","matric_number":"fu/20/1234","level":"200L"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','b@x.com',now(),'{"name":"Google Bola"}'),
 ('cccccccc-0000-0000-0000-000000000003','c@x.com',null,'{}'),
 ('dddddddd-0000-0000-0000-000000000004','d@x.com',now(),'{"full_name":"Dup","matric_number":"FU/20/1234","level":"100L"}'),
 ('eeeeeeee-0000-0000-0000-000000000005','e@x.com',now(),'{"full_name":"X","matric_number":"!!","level":"900L"}'),
 ('11111111-0000-0000-0000-0000000000aa','u@x.com',null,'{"full_name":"Squat Ter","matric_number":"fu/30/0001","level":"100L"}'),
 ('ffffffff-0000-0000-0000-000000000006','f@x.com',now(),'{}'),
 ('77777777-0000-0000-0000-000000000007','g@x.com',now(),'{}');

-- ================= triggers / S1 =================
select t_check('trigger: a profile row exists for every auth user', (select count(*) from public.profiles)=8);
select t_check('trigger: verified user + valid metadata -> normalised + complete',
  (select profile_complete and matric_number='FU/20/1234' and level='200L' from public.profiles where email='a@x.com'));
select t_check('trigger: Google user (name only) is INCOMPLETE',
  (select not profile_complete and full_name='Google Bola' and matric_number is null from public.profiles where email='b@x.com'));
select t_check('trigger: duplicate-matric metadata never breaks signup; keeps name only, incomplete',
  (select not profile_complete and matric_number is null and full_name='Dup' from public.profiles where email='d@x.com'));
select t_check('trigger: invalid metadata -> empty profile, signup survives',
  (select full_name is null and matric_number is null and level is null from public.profiles where email='e@x.com'));
select t_check('S1: UNVERIFIED signup does NOT claim a matric number (no squatting)',
  (select matric_number is null and full_name is null and level is null from public.profiles where email='u@x.com'));
select t_check('S1: owner of a matric the squatter attempted can still claim it',
  t_val('authenticated','ffffffff-0000-0000-0000-000000000006',$$public.save_my_profile('Real Owner','FU/30/0001','100L')->>'status'$$)='ok');
update auth.users set email_confirmed_at = now() where email='u@x.com';
select t_check('S1: when the squatter later verifies, the already-claimed matric is NOT stolen/doesn''t break verification',
  (select matric_number is null and full_name='Squat Ter' from public.profiles where email='u@x.com'));
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('22222222-0000-0000-0000-0000000000bb','late@x.com',null,'{"full_name":"Late Verifier","matric_number":"FU/31/0002","level":"300L"}');
select t_check('S1: unverified -> no matric yet', (select matric_number is null from public.profiles where email='late@x.com'));
update auth.users set email_confirmed_at = now() where email='late@x.com';
select t_check('S1: on verification the signup metadata IS applied (complete profile)',
  (select profile_complete and matric_number='FU/31/0002' and level='300L' from public.profiles where email='late@x.com'));
update auth.users set raw_user_meta_data='{"matric_number":"FU/99/9999"}' where email='late@x.com';
select t_check('S1: editing metadata after verification changes nothing', (select matric_number='FU/31/0002' from public.profiles where email='late@x.com'));

-- ================= RLS reads =================
select t_check('RLS: A sees exactly its own row', t_count('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select * from public.profiles')=1);
select t_check('RLS: A cannot read B by id', t_count('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select * from public.profiles where id='bbbbbbbb-0000-0000-0000-000000000002'$$)=0);
select t_check('RLS: A cannot read B by matric/email filter', t_count('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select * from public.profiles where email='b@x.com' or matric_number='FU/31/0002'$$)=0);
select t_check('RLS: anon denied on profiles', t_try('anon',null,'select * from public.profiles') ilike '%permission denied%');
select t_check('RLS: anon can read institutions', t_count('anon',null,'select * from public.institutions')=1);
select t_check('private tables: authenticated cannot read profile_save_attempts', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select * from public.profile_save_attempts') ilike '%permission denied%');
select t_check('private tables: authenticated cannot read matric_corrections', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select * from public.matric_corrections') ilike '%permission denied%');
select t_check('private tables: anon cannot write matric_corrections', t_try('anon',null,$$insert into public.matric_corrections(user_id,new_matric,reason) values (gen_random_uuid(),'X1234','xxxxxxxxxxx')$$) ilike '%permission denied%');

-- ================= direct writes blocked =================
select t_check('write: cannot UPDATE own profile', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$update public.profiles set level='500L'$$) ilike '%permission denied%');
select t_check('write: cannot UPDATE someone else', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$update public.profiles set full_name='pwn' where id='bbbbbbbb-0000-0000-0000-000000000002'$$) ilike '%permission denied%');
select t_check('write: cannot INSERT a profile', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$insert into public.profiles(id) values (gen_random_uuid())$$) ilike '%permission denied%');
select t_check('write: cannot DELETE profiles', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','delete from public.profiles') ilike '%permission denied%');
select t_check('write: cannot set generated profile_complete', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$update public.profiles set profile_complete=true$$) ~ 'permission denied|can only be updated to DEFAULT');
select t_check('write: institutions not writable', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$insert into public.institutions values ('EVIL','x')$$) ilike '%permission denied%');

-- ================= S6: function privileges under Supabase-style default grants =================
select t_check('S6: anon cannot call save_my_profile', t_try('anon',null,$$select public.save_my_profile('Abc','FU/1/1','100L')$$) ilike '%permission denied%');
select t_check('S6: anon cannot call delete_my_account', t_try('anon',null,'select public.delete_my_account()') ilike '%permission denied%');
select t_check('S6: anon cannot call admin_correct_matric', t_try('anon',null,$$select public.admin_correct_matric(gen_random_uuid(),'FU/1/1','long enough reason')$$) ilike '%permission denied%');
select t_check('S6: authenticated cannot call admin_correct_matric', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.admin_correct_matric(gen_random_uuid(),'FU/1/1','long enough reason')$$) ilike '%permission denied%');
select t_check('S6: authenticated cannot call internal apply_signup_metadata', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001',$$select public.apply_signup_metadata('aaaaaaaa-0000-0000-0000-000000000001','{"matric_number":"FU/5/5555"}')$$) ilike '%permission denied%');
select t_check('S6: authenticated cannot call handle_new_user / handle_user_update / touch_updated_at',
  t_try('authenticated',null,'select public.handle_new_user()') ilike '%permission denied%'
  and t_try('authenticated',null,'select public.handle_user_update()') ilike '%permission denied%'
  and t_try('authenticated',null,'select public.touch_updated_at()') ilike '%permission denied%');
select t_check('S6: normalize_matric not exposed to anon/authenticated',
  t_try('anon',null,$$select public.normalize_matric('x')$$) ilike '%permission denied%' and t_try('authenticated',null,$$select public.normalize_matric('x')$$) ilike '%permission denied%');

-- ================= save_my_profile =================
select t_check('rpc: unauthenticated rejected', t_try('authenticated',null,$$select public.save_my_profile('Abc','FU/1/1','100L')$$) ilike '%not_authenticated%');
select t_check('rpc: UNVERIFIED email rejected', t_try('authenticated','cccccccc-0000-0000-0000-000000000003',$$select public.save_my_profile('Cee Cee','FU/22/1','100L')$$) ilike '%email_not_verified%');
select t_check('rpc: invalid name (too short)', t_try('authenticated','dddddddd-0000-0000-0000-000000000004',$$select public.save_my_profile('A','FU/22/9','100L')$$) ilike '%invalid_name%');
select t_check('S5: control characters in name rejected', t_try('authenticated','dddddddd-0000-0000-0000-000000000004',$$select public.save_my_profile('Dee'||chr(10)||'Dee','FU/22/9','100L')$$) ilike '%invalid_name%');
select t_check('S5: table constraint also rejects control characters', t_try('postgres',null,$$update public.profiles set full_name='a'||chr(7)||'bc' where email='a@x.com'$$) ilike '%profiles_full_name_chars%');
select t_check('rpc: invalid matric', t_try('authenticated','dddddddd-0000-0000-0000-000000000004',$$select public.save_my_profile('Dee Dee','x','100L')$$) ilike '%invalid_matric%');
select t_check('rpc: injection-ish matric rejected', t_try('authenticated','dddddddd-0000-0000-0000-000000000004',$$select public.save_my_profile('Dee Dee','FU/1; drop table','100L')$$) ilike '%invalid_matric%');
select t_check('rpc: invalid level', t_try('authenticated','dddddddd-0000-0000-0000-000000000004',$$select public.save_my_profile('Dee Dee','FU/22/9','900L')$$) ilike '%invalid_level%');
select t_check('S2: format errors are not counted as matric attempts', (select count(*) from public.profile_save_attempts where user_id='dddddddd-0000-0000-0000-000000000004')=0);
select t_check('S2: duplicate matric -> NEUTRAL status (no "taken", no owner info)',
  t_val('authenticated','dddddddd-0000-0000-0000-000000000004',$$public.save_my_profile('Dee Dee',' fu/20/1234 ','100L')$$)='{"status": "matric_unavailable"}');
select t_check('S2: the failed attempt was recorded for throttling', (select count(*) from public.profile_save_attempts where user_id='dddddddd-0000-0000-0000-000000000004')=1);
select t_check('rpc: D completes with its own matric', t_val('authenticated','dddddddd-0000-0000-0000-000000000004',$$public.save_my_profile('Dee Dee','FU/22/9','100L')->>'status'$$)='ok');
select t_check('rpc: result carries the saved profile incl. profile_complete',
  (select profile_complete and matric_number='FU/22/9' from public.profiles where email='d@x.com'));
select t_check('rpc: level may change (student progresses)', t_val('authenticated','dddddddd-0000-0000-0000-000000000004',$$public.save_my_profile('Dee Dee','FU/22/9','200L')->>'status'$$)='ok');
select t_check('rpc: level change persisted', (select level='200L' from public.profiles where email='d@x.com'));
select t_check('rpc: matric LOCKED once set', t_try('authenticated','dddddddd-0000-0000-0000-000000000004',$$select public.save_my_profile('Dee Dee','FU/22/10','200L')$$) ilike '%matric_locked%');
select t_check('rpc: other users untouched', (select full_name='Ada Okafor' from public.profiles where email='a@x.com'));
select t_check('constraint: bad level blocked at table level', t_try('postgres',null,$$update public.profiles set level='X' where email='a@x.com'$$) ilike '%profiles_level_valid%');
select t_check('constraint: lowercase matric blocked at table level', t_try('postgres',null,$$update public.profiles set matric_number='fu/1/1' where email='a@x.com'$$) ilike '%profiles_matric_shape%');
select t_check('constraint: unique (institution, matric) at database level', t_try('postgres',null,$$update public.profiles set matric_number='FU/20/1234' where email='b@x.com'$$) ilike '%profiles_institution_matric_key%');

-- ================= S2 throttle =================
select t_check('S2: attempts 1-4 on a taken matric get the neutral answer',
  (select bool_and(t_val('authenticated','77777777-0000-0000-0000-000000000007',$$public.save_my_profile('Eff Eff','FU/20/1234','100L')->>'status'$$)='matric_unavailable') from generate_series(1,4)));
select t_check('S2: 5th failure recorded, 6th attempt is throttled',
  t_val('authenticated','77777777-0000-0000-0000-000000000007',$$public.save_my_profile('Eff Eff','FU/20/1234','100L')->>'status'$$)='matric_unavailable'
  and t_val('authenticated','77777777-0000-0000-0000-000000000007',$$public.save_my_profile('Eff Eff','FU/20/1234','100L')->>'status'$$)='too_many_attempts');
select t_check('S2: while throttled even a FREE matric is refused (no probing signal)',
  t_val('authenticated','77777777-0000-0000-0000-000000000007',$$public.save_my_profile('Eff Eff','FU/40/4040','100L')->>'status'$$)='too_many_attempts');
select t_check('S2: throttle is per account (another student unaffected)',
  t_val('authenticated','bbbbbbbb-0000-0000-0000-000000000002',$$public.save_my_profile('Bola Ade','FU/21/777','300L')->>'status'$$)='ok');
update public.profile_save_attempts set attempted_at = now() - interval '2 hours';
select t_check('S2: throttle expires after the window',
  t_val('authenticated','77777777-0000-0000-0000-000000000007',$$public.save_my_profile('Eff Eff','FU/40/4040','100L')->>'status'$$)='ok');

-- ================= S3 admin correction =================
select t_check('S3: service_role can run the correction (correct, evidence recorded)',
  t_val('service_role',null,$$public.admin_correct_matric('dddddddd-0000-0000-0000-000000000004','FU/22/99','Checked ID card + admission letter, ticket 41')->>'new_matric'$$)='FU/22/99');
select t_check('S3: audit row written (old, new, reason, who, when)',
  (select old_matric='FU/22/9' and new_matric='FU/22/99' and reason like 'Checked ID%' and corrected_by is not null and corrected_at is not null from public.matric_corrections order by id desc limit 1));
select t_check('S3: profile updated, owner id unchanged', (select matric_number='FU/22/99' from public.profiles where id='dddddddd-0000-0000-0000-000000000004'));
select t_check('S3: student still cannot edit it themselves', t_try('authenticated','dddddddd-0000-0000-0000-000000000004',$$select public.save_my_profile('Dee Dee','FU/22/9','200L')$$) ilike '%matric_locked%');
select t_check('S3: student may re-save with the corrected matric', t_val('authenticated','dddddddd-0000-0000-0000-000000000004',$$public.save_my_profile('Dee Dee','FU/22/99','200L')->>'status'$$)='ok');
select t_check('S3: revalidation - reason required', t_val('service_role',null,$$public.admin_correct_matric('dddddddd-0000-0000-0000-000000000004','FU/22/98','short')$$) like '%reason_required%');
select t_check('S3: revalidation - format enforced', t_val('service_role',null,$$public.admin_correct_matric('dddddddd-0000-0000-0000-000000000004','!!','long enough reason here')$$) like '%invalid_matric%');
select t_check('S3: revalidation - uniqueness enforced', t_val('service_role',null,$$public.admin_correct_matric('dddddddd-0000-0000-0000-000000000004','FU/20/1234','long enough reason here')$$) like '%matric_in_use_by_another_account%');
select t_check('S3: revalidation - unverified/unknown users refused', t_val('service_role',null,$$public.admin_correct_matric('cccccccc-0000-0000-0000-000000000003','FU/22/98','long enough reason here')$$) like '%user_not_found_or_unverified%');
select t_check('S3: no-op correction refused', t_val('service_role',null,$$public.admin_correct_matric('dddddddd-0000-0000-0000-000000000004','FU/22/99','long enough reason here')$$) like '%no_change%');
select t_check('S3: failed corrections left no audit rows and no changes', (select count(*) from public.matric_corrections)=1);

-- ================= S4 email sync =================
update auth.users set email='d-new@x.com' where email='d@x.com';
select t_check('S4: profile email follows the sign-in email', (select email='d-new@x.com' from public.profiles where id='dddddddd-0000-0000-0000-000000000004'));

-- ================= delete account =================
select t_check('delete_my_account: unauthenticated rejected', t_try('authenticated',null,'select public.delete_my_account()') ilike '%not_authenticated%');
select t_check('delete_my_account: call succeeds', t_try('authenticated','aaaaaaaa-0000-0000-0000-000000000001','select public.delete_my_account()')='OK');
select t_check('delete_my_account: only the caller removed (auth user + cascaded profile)',
  (select count(*) from auth.users where email='a@x.com')=0 and (select count(*) from public.profiles where email='a@x.com')=0
  and (select count(*) from auth.users where email='b@x.com')=1);
select t_check('delete_my_account: cascades the throttle log, keeps the correction audit trail',
  (select count(*) from public.profile_save_attempts where user_id='aaaaaaaa-0000-0000-0000-000000000001')=0 and (select count(*) from public.matric_corrections)=1);
select t_check('delete_my_account: the freed matric becomes available again (documented limitation)',
  t_val('authenticated','eeeeeeee-0000-0000-0000-000000000005',$$public.save_my_profile('Ee Ee','FU/20/1234','100L')->>'status'$$) in ('ok','too_many_attempts'));

select case when ok then 'PASS' else 'FAIL' end || ' | ' || name from results order by (select 1);
select 'TOTAL ' || count(*) || ', FAILED ' || count(*) filter (where not ok) from results;
rollback;
