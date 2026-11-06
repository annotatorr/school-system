create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
grant select on public.platform_admins to authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

insert into public.platform_admins(user_id)
select distinct m.user_id
from public.school_memberships m
where m.role = 'platform_admin'
  and m.status = 'active'
on conflict (user_id) do nothing;

drop policy if exists memberships_manage_admin on public.school_memberships;
create policy memberships_manage_admin
on public.school_memberships
for all to authenticated
using (
  public.is_platform_admin()
  or (
    role <> 'platform_admin'
    and public.has_school_role(
      school_id,
      array['school_admin','principal']::public.platform_user_role[]
    )
  )
)
with check (
  public.is_platform_admin()
  or (
    role <> 'platform_admin'
    and public.has_school_role(
      school_id,
      array['school_admin','principal']::public.platform_user_role[]
    )
  )
);

create or replace function public.can_access_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and (
        s.user_id = auth.uid()
        or exists (
          select 1
          from public.student_guardians sg
          join public.guardians g on g.id = sg.guardian_id
          where sg.student_id = s.id
            and g.user_id = auth.uid()
        )
        or public.has_school_role(
          s.school_id,
          array['school_admin','principal','secretary']
            ::public.platform_user_role[]
        )
        or (
          public.has_school_role(
            s.school_id,
            array['teacher']::public.platform_user_role[]
          )
          and exists (
            select 1
            from public.teacher_assignments ta
            where ta.school_id = s.school_id
              and ta.teacher_id = auth.uid()
              and ta.class_id = s.class_id
          )
        )
      )
  );
$$;

drop policy if exists students_read_authorized on public.students;
create policy students_read_authorized
on public.students
for select to authenticated
using (
  public.is_platform_admin()
  or public.can_access_student(id)
);

drop policy if exists students_staff_update on public.students;
create policy students_staff_update
on public.students
for update to authenticated
using (
  public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
  or (
    public.has_school_role(
      school_id,
      array['teacher']::public.platform_user_role[]
    )
    and exists (
      select 1 from public.teacher_assignments ta
      where ta.school_id = students.school_id
        and ta.teacher_id = auth.uid()
        and ta.class_id = students.class_id
    )
  )
)
with check (
  public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
  or (
    public.has_school_role(
      school_id,
      array['teacher']::public.platform_user_role[]
    )
    and exists (
      select 1 from public.teacher_assignments ta
      where ta.school_id = students.school_id
        and ta.teacher_id = auth.uid()
        and ta.class_id = students.class_id
    )
  )
);

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
  or exists (
    select 1
    from public.student_guardians sg
    join public.students s on s.id = sg.student_id
    where sg.guardian_id = guardians.id
      and public.has_school_role(
        s.school_id,
        array['teacher']::public.platform_user_role[]
      )
      and exists (
        select 1 from public.teacher_assignments ta
        where ta.school_id = s.school_id
          and ta.teacher_id = auth.uid()
          and ta.class_id = s.class_id
      )
  )
);

drop policy if exists assignment_student_read on public.assignments;
create policy assignment_student_read
on public.assignments
for select to authenticated
using (
  (
    status = 'published'
    and public.can_access_student((
      select s.id from public.students s
      where s.class_id = assignments.class_id
        and s.user_id = auth.uid()
      limit 1
    ))
  )
  or (
    teacher_id = auth.uid()
    and public.has_school_role(
      school_id,
      array['teacher']::public.platform_user_role[]
    )
  )
  or public.has_school_role(
    school_id,
    array['school_admin','principal','secretary']::public.platform_user_role[]
  )
);

drop policy if exists platform_admins_read_self on public.platform_admins;
create policy platform_admins_read_self
on public.platform_admins
for select to authenticated
using (user_id = auth.uid() or public.is_platform_admin());

alter table public.schools add column if not exists subscription_plan text;
alter table public.schools add column if not exists subscription_amount_kes numeric(12,2);
alter table public.schools add column if not exists subscription_started_at date;
alter table public.schools add column if not exists subscription_ends_at date;
alter table public.schools add column if not exists subscription_notes text;

create table if not exists public.school_admin_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  applicant_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  unique (school_id, applicant_user_id)
);

alter table public.school_admin_requests enable row level security;
grant select on public.school_admin_requests to authenticated;
drop policy if exists school_admin_requests_read_scope on public.school_admin_requests;
create policy school_admin_requests_read_scope
on public.school_admin_requests
for select to authenticated
using (
  applicant_user_id = auth.uid()
  or public.is_platform_admin()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_school_id uuid;
begin
  insert into public.profiles(id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'New user'),
    new.email,
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;

  if new.raw_user_meta_data->>'requested_portal' = 'school_admin' then
    begin
      requested_school_id :=
        (new.raw_user_meta_data->>'requested_school_id')::uuid;
    exception when invalid_text_representation then
      requested_school_id := null;
    end;

    if requested_school_id is not null and exists (
      select 1 from public.schools
      where id = requested_school_id and status = 'active'
    ) then
      insert into public.school_admin_requests(
        school_id, applicant_user_id, reason
      )
      values (
        requested_school_id,
        new.id,
        nullif(trim(new.raw_user_meta_data->>'application_reason'), '')
      )
      on conflict (school_id, applicant_user_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop function if exists public.platform_review_school_admin_request(uuid, text, text);

create function public.platform_review_school_admin_request(
  p_request_id uuid,
  p_decision text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  request_row public.school_admin_requests%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select * into request_row
  from public.school_admin_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Administrator request not found';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'Administrator request has already been reviewed';
  end if;

  update public.school_admin_requests
  set status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = nullif(trim(p_notes), '')
  where id = request_row.id;

  if p_decision = 'approved' then
    insert into public.school_memberships(
      school_id, user_id, role, status, approved_by, approved_at
    )
    values (
      request_row.school_id, request_row.applicant_user_id,
      'school_admin', 'active', auth.uid(), now()
    )
    on conflict (school_id, user_id, role) do update
    set status = 'active', approved_by = auth.uid(), approved_at = now();
  end if;

  insert into public.audit_logs(
    school_id, actor_user_id, action, entity_type, entity_id, after_data
  )
  values (
    request_row.school_id, auth.uid(),
    'school_admin_request_' || p_decision,
    'school_admin_request', request_row.id,
    jsonb_build_object('applicant_user_id', request_row.applicant_user_id,
                       'notes', nullif(trim(p_notes), ''))
  );
end;
$$;

revoke all on function public.platform_review_school_admin_request(uuid, text, text)
from public, anon;
grant execute on function public.platform_review_school_admin_request(uuid, text, text)
to authenticated;

drop function if exists public.platform_admin_overview();
create function public.platform_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;

  return jsonb_build_object(
    'total_schools', (select count(*)::integer from public.schools),
    'pending_schools', (select count(*)::integer from public.schools where status = 'pending'),
    'active_schools', (select count(*)::integer from public.schools where status = 'active'),
    'suspended_schools', (select count(*)::integer from public.schools where status = 'suspended'),
    'trial_subscriptions', (select count(*)::integer from public.schools where subscription_status = 'trial'),
    'active_subscriptions', (select count(*)::integer from public.schools where subscription_status = 'active'),
    'overdue_subscriptions', (select count(*)::integer from public.schools where subscription_status = 'overdue'),
    'cancelled_subscriptions', (select count(*)::integer from public.schools where subscription_status = 'cancelled')
  );
end;
$$;

drop function if exists public.list_active_schools();
create function public.list_active_schools()
returns table(id uuid, name text, slug text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name, s.slug
  from public.schools s
  where s.status = 'active'
  order by s.name;
$$;

grant execute on function public.list_active_schools() to anon, authenticated;

drop function if exists public.platform_register_school(text, text, text, text, text, text, text, text, text);
create function public.platform_register_school(
  p_name text,
  p_slug text,
  p_registration_number text default null,
  p_school_type text default null,
  p_county text default null,
  p_sub_county text default null,
  p_address text default null,
  p_phone text default null,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  new_school_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;
  if nullif(trim(p_name), '') is null
    or nullif(trim(p_slug), '') is null
    or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'A school name and valid school code are required';
  end if;

  insert into public.schools(
    name, slug, registration_number, school_type, county,
    sub_county, address, phone, email, status
  )
  values (
    trim(p_name), p_slug, nullif(trim(p_registration_number), ''),
    nullif(trim(p_school_type), ''), nullif(trim(p_county), ''),
    nullif(trim(p_sub_county), ''), nullif(trim(p_address), ''),
    nullif(trim(p_phone), ''), nullif(trim(p_email), ''), 'pending'
  )
  returning id into new_school_id;

  insert into public.audit_logs(
    school_id, actor_user_id, action, entity_type, entity_id, after_data
  )
  values (
    new_school_id, auth.uid(), 'school_registered', 'school', new_school_id,
    jsonb_build_object('name', trim(p_name), 'slug', p_slug)
  );

  return new_school_id;
end;
$$;

drop function if exists public.platform_set_school_status(uuid, text, text);
create function public.platform_set_school_status(
  p_school_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  school_name text;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Status must be active or suspended';
  end if;

  update public.schools
  set status = p_status::public.school_status,
      suspended_at = case when p_status = 'suspended' then now() else null end,
      suspension_reason = case when p_status = 'suspended' then nullif(trim(p_reason), '') else null end,
      updated_at = now()
  where id = p_school_id
  returning name into school_name;

  if not found then
    raise exception 'School not found';
  end if;

  insert into public.audit_logs(
    school_id, actor_user_id, action, entity_type, entity_id, after_data
  )
  values (
    p_school_id, auth.uid(), 'school_status_changed', 'school', p_school_id,
    jsonb_build_object('status', p_status, 'reason', nullif(trim(p_reason), ''))
  );
end;
$$;

drop function if exists public.platform_update_subscription(uuid, text, text, numeric, timestamptz, timestamptz, text);
drop function if exists public.platform_update_subscription(uuid, text, text, numeric, date, date, text);
create function public.platform_update_subscription(
  p_school_id uuid,
  p_subscription_status text,
  p_plan text default null,
  p_amount_kes numeric default null,
  p_started_at date default null,
  p_ends_at date default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access required';
  end if;
  if p_subscription_status not in ('trial', 'active', 'overdue', 'cancelled') then
    raise exception 'Unsupported subscription status';
  end if;
  if p_amount_kes is not null and p_amount_kes < 0 then
    raise exception 'Subscription amount cannot be negative';
  end if;
  if p_started_at is not null and p_ends_at is not null and p_ends_at < p_started_at then
    raise exception 'Subscription end cannot be before its start';
  end if;

  update public.schools
  set subscription_status = p_subscription_status,
      subscription_plan = nullif(trim(p_plan), ''),
      subscription_amount_kes = p_amount_kes,
      subscription_started_at = p_started_at,
      subscription_ends_at = p_ends_at,
      subscription_notes = nullif(trim(p_notes), ''),
      updated_at = now()
  where id = p_school_id;

  if not found then
    raise exception 'School not found';
  end if;

  insert into public.audit_logs(
    school_id, actor_user_id, action, entity_type, entity_id, after_data
  )
  values (
    p_school_id, auth.uid(), 'subscription_updated', 'school', p_school_id,
    jsonb_build_object('status', p_subscription_status, 'plan', nullif(trim(p_plan), ''),
                       'amount_kes', p_amount_kes, 'started_at', p_started_at,
                       'ends_at', p_ends_at)
  );
end;
$$;

revoke all on function public.platform_admin_overview() from public, anon;
revoke all on function public.platform_register_school(text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.platform_set_school_status(uuid, text, text) from public, anon;
revoke all on function public.platform_update_subscription(uuid, text, text, numeric, date, date, text) from public, anon;
grant execute on function public.platform_admin_overview() to authenticated;
grant execute on function public.platform_register_school(text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.platform_set_school_status(uuid, text, text) to authenticated;
grant execute on function public.platform_update_subscription(uuid, text, text, numeric, date, date, text) to authenticated;

create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  audience text not null default 'all_active'
    check (audience in ('all_active','school_admins','selected_schools')),
  target_school_ids uuid[] not null default '{}'::uuid[],
  published_by uuid not null default auth.uid() references public.profiles(id),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (audience <> 'selected_schools' or cardinality(target_school_ids) > 0)
);

create index if not exists platform_announcements_published_idx
on public.platform_announcements(published_at desc);

alter table public.platform_announcements enable row level security;
grant select, insert on public.platform_announcements to authenticated;

create or replace function public.can_read_platform_announcement(
  p_audience text,
  p_target_school_ids uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.schools s
    where s.status = 'active'
      and (
        (
          (
            p_audience = 'all_active'
            or (
              p_audience = 'selected_schools'
              and s.id = any(coalesce(p_target_school_ids, '{}'::uuid[]))
            )
          )
          and (
            exists (
              select 1 from public.school_memberships m
              where m.school_id = s.id
                and m.user_id = auth.uid()
                and m.status = 'active'
            )
            or exists (
              select 1 from public.students st
              where st.school_id = s.id
                and st.user_id = auth.uid()
                and st.status = 'active'
            )
            or exists (
              select 1
              from public.guardians g
              join public.student_guardians sg on sg.guardian_id = g.id
              join public.students st on st.id = sg.student_id
              where g.school_id = s.id
                and sg.school_id = s.id
                and st.school_id = s.id
                and g.user_id = auth.uid()
                and st.status = 'active'
            )
          )
        )
        or (
          p_audience = 'school_admins'
          and exists (
            select 1 from public.school_memberships admins
            where admins.school_id = s.id
              and admins.user_id = auth.uid()
              and admins.status = 'active'
              and admins.role = 'school_admin'
          )
        )
      )
  );
$$;

revoke all on function public.can_read_platform_announcement(text, uuid[])
from public, anon;
grant execute on function public.can_read_platform_announcement(text, uuid[])
to authenticated;

drop policy if exists platform_announcements_read_recipient on public.platform_announcements;
create policy platform_announcements_read_recipient
on public.platform_announcements
for select to authenticated
using (
  public.can_read_platform_announcement(audience, target_school_ids)
);
drop policy if exists platform_announcements_insert_admin on public.platform_announcements;
create policy platform_announcements_insert_admin
on public.platform_announcements
for insert to authenticated
with check (public.is_platform_admin() and published_by = auth.uid());

create or replace function public.audit_platform_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.audience = 'selected_schools' and exists (
    select 1
    from unnest(new.target_school_ids) as target(school_id)
    where not exists (
      select 1 from public.schools s
      where s.id = target.school_id and s.status = 'active'
    )
  ) then
    raise exception 'Selected schools must all be active';
  end if;

  insert into public.audit_logs(
    school_id, actor_user_id, action, entity_type, entity_id, after_data
  )
  values (
    null, new.published_by, 'platform_announcement_published',
    'platform_announcement', new.id,
    jsonb_build_object(
      'title', new.title,
      'audience', new.audience,
      'target_school_ids', new.target_school_ids
    )
  );

  return new;
end;
$$;

drop trigger if exists platform_announcement_audit on public.platform_announcements;
create trigger platform_announcement_audit
after insert on public.platform_announcements
for each row execute function public.audit_platform_announcement();

-- The table is read through RLS by each signed-in portal; Realtime refreshes
-- the in-app feed when an administrator publishes an announcement.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'platform_announcements'
     ) then
    alter publication supabase_realtime add table public.platform_announcements;
  end if;
end;
$$;

-- Platform administrators may inspect profiles and create signed photo URLs.
drop policy if exists profiles_read_self_or_same_school on public.profiles;
create policy profiles_read_self_or_same_school
on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.is_platform_admin()
  or exists (
    select 1
    from public.school_memberships mine
    join public.school_memberships theirs
      on mine.school_id = theirs.school_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and mine.role in ('school_admin','principal','secretary')
      and theirs.user_id = profiles.id
      and theirs.status = 'active'
  )
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and (
    avatar_url is null
    or split_part(avatar_url, '/', 1) = auth.uid()::text
  )
);

drop policy if exists private_school_documents_read on storage.objects;
create policy private_school_documents_read
on storage.objects
for select to authenticated
using (
  bucket_id = 'school-private-documents'
  and (
    public.is_platform_admin()
    or exists (
      select 1
      from public.school_memberships m
      join public.schools s on s.id = m.school_id
      where m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('school_admin','principal','secretary')
        and s.status = 'active'
        and (storage.foldername(name))[1] = m.school_id::text
    )
  )
);

drop policy if exists "Users can read own profile photos" on storage.objects;
create policy "Users can read own profile photos"
on storage.objects
for select to authenticated
using (
  bucket_id = 'profile-photos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_platform_admin()
  )
);
