-- Run this in Supabase Dashboard > SQL Editor and send the result.
-- It shows how platform admins are linked and which function schools RLS uses.

select 'platform_admins' as source,
       pa.user_id,
       u.email,
       null::text as status
from public.platform_admins pa
left join auth.users u on u.id = pa.user_id

union all

select 'school_memberships' as source,
       m.user_id,
       u.email,
       m.status::text
from public.school_memberships m
left join auth.users u on u.id = m.user_id
where m.role = 'platform_admin';

select pg_get_functiondef('public.is_platform_admin()'::regprocedure)
       as is_platform_admin_definition;

select count(*) as schools_count from public.schools;
select count(*) as admin_requests_count from public.school_admin_requests;
