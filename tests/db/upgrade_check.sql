\pset pager off
-- 0001 was live with a squatter + a verified owner; then 0002 is applied.
select 'UPGRADE squatter cleaned: ' || (select (matric_number is null and full_name is null and level is null)::text from public.profiles where email='sq@x.com');
select 'UPGRADE verified user untouched: ' || (select (matric_number='FU/50/0005' and profile_complete)::text from public.profiles where email='ok@x.com');
update auth.users set email_confirmed_at = now() where email='sq@x.com';
select 'UPGRADE squatter verifies later -> claim applied from retained metadata (matric not owned by anyone else): ' || (select (matric_number='FU/50/0009')::text from public.profiles where email='sq@x.com');
