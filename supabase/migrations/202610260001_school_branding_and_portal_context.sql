alter table public.schools add column if not exists motto text;

-- School identity is visible to active members and verified students/guardians.
drop policy if exists schools_read_member on public.schools;
create policy schools_read_member
on public.schools
for select to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.school_memberships m
    where m.school_id = schools.id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
  or exists (
    select 1 from public.students st
    where st.school_id = schools.id
      and st.user_id = auth.uid()
      and st.status = 'active'
  )
  or exists (
    select 1
    from public.guardians g
    join public.student_guardians sg on sg.guardian_id = g.id
    join public.students st on st.id = sg.student_id
    where g.school_id = schools.id
      and sg.school_id = schools.id
      and st.school_id = schools.id
      and g.user_id = auth.uid()
      and st.status = 'active'
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'school-logos',
  'school-logos',
  true,
  2097152,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists school_logos_public_read on storage.objects;
create policy school_logos_public_read
on storage.objects
for select to anon, authenticated
using (bucket_id = 'school-logos');

drop policy if exists school_logos_school_admin_write on storage.objects;
create policy school_logos_school_admin_write
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'school-logos'
  and (
    public.is_platform_admin()
    or exists (
      select 1 from public.school_memberships m
      join public.schools s on s.id = m.school_id
      where m.school_id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role = 'school_admin'
        and s.status = 'active'
    )
  )
);

drop policy if exists school_logos_school_admin_update on storage.objects;
create policy school_logos_school_admin_update
on storage.objects
for update to authenticated
using (
  bucket_id = 'school-logos'
  and (
    public.is_platform_admin()
    or exists (
      select 1 from public.school_memberships m
      join public.schools s on s.id = m.school_id
      where m.school_id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role = 'school_admin'
        and s.status = 'active'
    )
  )
)
with check (
  bucket_id = 'school-logos'
  and (
    public.is_platform_admin()
    or exists (
      select 1 from public.school_memberships m
      join public.schools s on s.id = m.school_id
      where m.school_id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role = 'school_admin'
        and s.status = 'active'
    )
  )
);
