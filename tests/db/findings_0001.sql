\pset pager off
-- Demonstrates audit findings against the ORIGINAL migration (0001 only). Expected: findings are CONFIRMED.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('11111111-0000-0000-0000-00000000000a','squatter@throwaway.test',null,'{"full_name":"Squat Ter","matric_number":"FU/20/7777","level":"100L"}');
select 'S1 unverified signup already holds the matric number: ' ||
  coalesce((select matric_number from public.profiles where email='squatter@throwaway.test'),'(none)') as finding;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('22222222-0000-0000-0000-00000000000b','owner@school.test',now(),'{}');
begin; set local role authenticated; select set_config('request.jwt.claim.sub','22222222-0000-0000-0000-00000000000b',true) \g /dev/null
do $$ declare r text; begin
  begin perform public.save_my_profile('Real Owner','FU/20/7777','100L'); r:='accepted';
  exception when others then r:=sqlerrm; end;
  raise notice 'S1b real owner then onboarding with that matric -> %', r;
end $$;
-- S2: unlimited oracle
do $$ declare hits int:=0; i int; begin
  for i in 1..30 loop
    begin perform public.save_my_profile('Real Owner','FU/20/'||lpad(i::text,4,'0'),'100L'); exception when others then if sqlerrm like '%matric_taken%' then hits:=hits+1; end if; end;
  end loop;
  raise notice 'S2 probing 30 matrics: % responses distinguished a registered number, none throttled', hits;
end $$;
rollback;
