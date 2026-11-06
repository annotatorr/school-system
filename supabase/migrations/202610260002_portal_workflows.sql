create or replace function public.update_school_branding(
  p_school_id uuid,
  p_name text,
  p_motto text default null,
  p_school_type text default null,
  p_county text default null,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_logo_path text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not (
    public.is_platform_admin()
    or public.has_school_role(
      p_school_id,
      array['school_admin']::public.platform_user_role[]
    )
  ) then
    raise exception 'School administrator access required';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'School name is required';
  end if;
  if p_logo_path is not null
    and split_part(p_logo_path, '/', 1) <> p_school_id::text then
    raise exception 'School logo must be stored in this school folder';
  end if;

  update public.schools
  set name = trim(p_name),
      motto = nullif(trim(p_motto), ''),
      school_type = nullif(trim(p_school_type), ''),
      county = nullif(trim(p_county), ''),
      phone = nullif(trim(p_phone), ''),
      email = nullif(trim(p_email), ''),
      address = nullif(trim(p_address), ''),
      logo_path = p_logo_path,
      updated_at = now()
  where id = p_school_id;

  if not found then
    raise exception 'School not found';
  end if;
end;
$$;

revoke all on function public.update_school_branding(uuid, text, text, text, text, text, text, text, text)
from public, anon;
grant execute on function public.update_school_branding(uuid, text, text, text, text, text, text, text, text)
to authenticated;

-- Teachers can see only the classes and subjects assigned to them.
drop policy if exists classes_teacher_read_assigned on public.classes;
create policy classes_teacher_read_assigned
on public.classes
for select to authenticated
using (
  public.has_school_role(
    school_id,
    array['teacher']::public.platform_user_role[]
  )
  and (
    class_teacher_id = auth.uid()
    or exists (
      select 1 from public.teacher_assignments ta
      where ta.school_id = classes.school_id
        and ta.class_id = classes.id
        and ta.teacher_id = auth.uid()
    )
  )
);

drop policy if exists subjects_teacher_read_assigned on public.subjects;
create policy subjects_teacher_read_assigned
on public.subjects
for select to authenticated
using (
  public.has_school_role(
    school_id,
    array['teacher']::public.platform_user_role[]
  )
  and exists (
    select 1 from public.teacher_assignments ta
    where ta.school_id = subjects.school_id
      and ta.subject_id = subjects.id
      and ta.teacher_id = auth.uid()
  )
);

drop policy if exists teacher_assignments_read_assigned on public.teacher_assignments;
create policy teacher_assignments_read_assigned
on public.teacher_assignments
for select to authenticated
using (
  teacher_id = auth.uid()
  and public.has_school_role(
    school_id,
    array['teacher']::public.platform_user_role[]
  )
);

drop policy if exists assignments_teacher_insert on public.assignments;
create policy assignments_teacher_insert
on public.assignments
for insert to authenticated
with check (
  teacher_id = auth.uid()
  and status = 'draft'
  and public.has_school_role(
    school_id,
    array['teacher']::public.platform_user_role[]
  )
  and exists (
    select 1 from public.teacher_assignments ta
    where ta.school_id = assignments.school_id
      and ta.teacher_id = auth.uid()
      and ta.class_id = assignments.class_id
      and (assignments.subject_id is null or ta.subject_id = assignments.subject_id)
  )
);

-- Assigned teachers can create and maintain attendance for their classes.
drop policy if exists attendance_sessions_teacher_read on public.attendance_sessions;
create policy attendance_sessions_teacher_read
on public.attendance_sessions
for select to authenticated
using (
  public.has_school_role(
    school_id,
    array['teacher']::public.platform_user_role[]
  )
  and exists (
    select 1 from public.teacher_assignments ta
    where ta.school_id = attendance_sessions.school_id
      and ta.class_id = attendance_sessions.class_id
      and ta.teacher_id = auth.uid()
  )
);

drop policy if exists attendance_sessions_teacher_insert on public.attendance_sessions;
create policy attendance_sessions_teacher_insert
on public.attendance_sessions
for insert to authenticated
with check (
  recorded_by = auth.uid()
  and public.has_school_role(
    school_id,
    array['teacher']::public.platform_user_role[]
  )
  and exists (
    select 1 from public.teacher_assignments ta
    where ta.school_id = attendance_sessions.school_id
      and ta.class_id = attendance_sessions.class_id
      and ta.teacher_id = auth.uid()
  )
);

drop policy if exists attendance_records_teacher_insert on public.attendance_records;
create policy attendance_records_teacher_insert
on public.attendance_records
for insert to authenticated
with check (
  updated_by = auth.uid()
  and public.has_school_role(
    school_id,
    array['teacher']::public.platform_user_role[]
  )
  and exists (
    select 1
    from public.students st
    join public.attendance_sessions ses
      on ses.id = attendance_records.session_id
    join public.teacher_assignments ta
      on ta.school_id = st.school_id
     and ta.class_id = st.class_id
     and ta.teacher_id = auth.uid()
    where st.id = attendance_records.student_id
      and st.school_id = attendance_records.school_id
      and ses.school_id = attendance_records.school_id
      and ses.class_id = st.class_id
  )
);

drop policy if exists attendance_records_teacher_update on public.attendance_records;
create policy attendance_records_teacher_update
on public.attendance_records
for update to authenticated
using (
  public.has_school_role(
    school_id,
    array['teacher']::public.platform_user_role[]
  )
  and exists (
    select 1
    from public.students st
    join public.attendance_sessions ses
      on ses.id = attendance_records.session_id
    join public.teacher_assignments ta
      on ta.school_id = st.school_id
     and ta.class_id = st.class_id
     and ta.teacher_id = auth.uid()
    where st.id = attendance_records.student_id
      and st.school_id = attendance_records.school_id
      and ses.school_id = attendance_records.school_id
      and ses.class_id = st.class_id
  )
)
with check (
  updated_by = auth.uid()
  and public.has_school_role(
    school_id,
    array['teacher']::public.platform_user_role[]
  )
  and exists (
    select 1
    from public.students st
    join public.attendance_sessions ses
      on ses.id = attendance_records.session_id
    join public.teacher_assignments ta
      on ta.school_id = st.school_id
     and ta.class_id = st.class_id
     and ta.teacher_id = auth.uid()
    where st.id = attendance_records.student_id
      and st.school_id = attendance_records.school_id
      and ses.school_id = attendance_records.school_id
      and ses.class_id = st.class_id
  )
);

-- Students and linked guardians can read their own submission results.
drop policy if exists assignment_submissions_read_related on public.assignment_submissions;
create policy assignment_submissions_read_related
on public.assignment_submissions
for select to authenticated
using (
  public.is_platform_admin()
  or public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
  or public.can_access_student(student_id)
  or exists (
    select 1
    from public.assignments a
    join public.teacher_assignments ta
      on ta.school_id = a.school_id
     and ta.class_id = a.class_id
     and ta.subject_id = a.subject_id
    where a.id = assignment_submissions.assignment_id
      and ta.teacher_id = auth.uid()
      and public.has_school_role(
        a.school_id,
        array['teacher']::public.platform_user_role[]
      )
  )
);

drop policy if exists assignment_submissions_student_insert on public.assignment_submissions;
create policy assignment_submissions_student_insert
on public.assignment_submissions
for insert to authenticated
with check (
  exists (
    select 1
    from public.students st
    join public.assignments a
      on a.school_id = st.school_id
     and a.class_id = st.class_id
    where st.id = assignment_submissions.student_id
      and st.user_id = auth.uid()
      and st.status = 'active'
      and a.id = assignment_submissions.assignment_id
      and a.status = 'published'
      and a.school_id = assignment_submissions.school_id
  )
);

drop policy if exists assignment_submissions_teacher_update on public.assignment_submissions;
create policy assignment_submissions_teacher_update
on public.assignment_submissions
for update to authenticated
using (
  exists (
    select 1
    from public.assignments a
    join public.teacher_assignments ta
      on ta.school_id = a.school_id
     and ta.class_id = a.class_id
     and ta.subject_id = a.subject_id
    where a.id = assignment_submissions.assignment_id
      and ta.teacher_id = auth.uid()
      and public.has_school_role(
        a.school_id,
        array['teacher']::public.platform_user_role[]
      )
  )
)
with check (
  exists (
    select 1
    from public.assignments a
    join public.teacher_assignments ta
      on ta.school_id = a.school_id
     and ta.class_id = a.class_id
     and ta.subject_id = a.subject_id
    where a.id = assignment_submissions.assignment_id
      and ta.teacher_id = auth.uid()
      and public.has_school_role(
        a.school_id,
        array['teacher']::public.platform_user_role[]
      )
  )
);

-- Applicants can review their own admission request status.
drop policy if exists admission_applications_read_applicant on public.admission_applications;
create policy admission_applications_read_applicant
on public.admission_applications
for select to authenticated
using (guardian_user_id = auth.uid());

drop policy if exists admission_applications_insert_guardian on public.admission_applications;
create policy admission_applications_insert_guardian
on public.admission_applications
for insert to authenticated
with check (
  guardian_user_id = auth.uid()
  and exists (
    select 1 from public.schools s
    where s.id = admission_applications.school_id
      and s.status = 'active'
  )
  and (
    requested_class_id is null
    or exists (
      select 1 from public.classes c
      where c.id = admission_applications.requested_class_id
        and c.school_id = admission_applications.school_id
    )
  )
);
