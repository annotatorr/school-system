-- Fix infinite recursion between the guardians and student_guardians RLS policies.
-- The guardians policy used to query student_guardians, whose policy queried
-- guardians again, causing PostgreSQL error 42P17 on any query touching schools,
-- profiles, assessments, assignments, materials or messages.
--
-- The teacher branch now uses a SECURITY DEFINER helper, so the policy lookup
-- does not re-enter row-level security on student_guardians.

create or replace function public.is_teacher_of_guardian(p_guardian_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.student_guardians sg
    join public.students s on s.id = sg.student_id
    join public.teacher_assignments ta on ta.class_id = s.class_id
    where sg.guardian_id = p_guardian_id
      and ta.teacher_id = auth.uid()
      and ta.school_id = s.school_id
      and public.has_school_role(
        s.school_id,
        array['teacher']::public.platform_user_role[]
      )
  );
$$;

revoke all on function public.is_teacher_of_guardian(uuid) from public, anon;
grant execute on function public.is_teacher_of_guardian(uuid) to authenticated;

drop policy if exists guardians_read_related on public.guardians;
create policy guardians_read_related
on public.guardians
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_platform_admin()
  or public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
  or public.is_teacher_of_guardian(guardians.id)
);
